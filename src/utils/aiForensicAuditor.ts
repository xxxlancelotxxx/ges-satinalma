import { DiscountRecord, MaterialComparison, InvoiceRecord } from '../types';
import { formatRuble } from './format';
import {
  convertMaterialUnit,
  normalizeStandardUnit
} from './constructionUnitConverter';
import {
  isExemptFromBenchmarkAudit,
  BenchmarkExemptionResult
} from './auditRiskEngine';

export type ForensicRiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ForensicCheckDetail {
  detected: boolean;
  scoreImpact: number;
  title: string;
  summary: string;
  details: string;
  evidence?: string[];
}

export interface AIForensicVerdict {
  recordId: string;
  riskLevel: ForensicRiskLevel;
  riskScore: number; // 0 (tamamen temiz) - 100 (aşırı şüpheli/sahte)
  badgeLabel: string;
  badgeClass: string;
  headline: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  checks: {
    initialPriceInflation: ForensicCheckDetail;
    marketBenchmark: ForensicCheckDetail;
    basketShrinkage: ForensicCheckDetail;
    splitInvoice: ForensicCheckDetail;
    negotiationRounds: ForensicCheckDetail;
    vendorConcentration: ForensicCheckDetail;
    documentIntegrity: ForensicCheckDetail;
    roundNumberAnomaly: ForensicCheckDetail;
  };
  exemptions: {
    exemptItemsCount: number;
    details: string[];
  };
  humanAuditorNarrative: string;
  executiveRecommendation: string;
  recommendedAction: 'FREEZE' | 'APPROVE' | 'REQUEST_INSPECTION';
  isAiGenerated?: boolean;
}

/**
 * Derin Sezgisel Kıdemli Adli Satınalma Başdenetçisi Motoru (Senior AI Forensic Chief Auditor)
 * 
 * HİÇBİR SATINALMACININ SİSTEMİ KANDIRAMAYACAĞI 8 DERİN DENETİM BOYUTU:
 * 1. Şişirilmiş Liste Fiyatı & Kapanış Analizi (Kapanış fiyatı piyasa ortalamasının üzerindeyse sahte indirimdir)
 * 2. Emsal Piyasa Fiyat Karşılaştırması (Lojistik/Nakliye ve Özel Çizimli Donatı Karkasları MUAF TUTULUR)
 * 3. Sepet Küçültme & Miktar Kısma İllüzyonu (Daha az malzeme alıp indirim aldım deme hilesi)
 * 4. Parçalı Sipariş / Eşik Atlama (Split Invoices - 72 saat içinde aynı firmaya parçalı alımlar)
 * 5. Formalite / Kurgusal Müzakere Turları (Gerçek fiyat kırımı olmadan yapay tur ekleme)
 * 6. Tedarikçi Tekeli ve Şüpheli Yakınlık (Satınalmacı-tedarikçi konsantrasyon analizi)
 * 7. Evrak ve Arşiv Bütünlüğü (1. Teklif ve Son Resmi Fatura zorunluluğu)
 * 8. Yuvarlak Rakam ve Kalemsiz Tutar Anomalisi (Detaysız kaba tutar beyanları)
 */
export function runForensicAudit(
  record: DiscountRecord,
  comparisons: MaterialComparison[] = [],
  matchedInvoice?: InvoiceRecord | null,
  allDiscounts: DiscountRecord[] = []
): AIForensicVerdict {
  const offerPrice = Number(record.offerPrice || 0);
  const agreedPrice = Number(record.agreedPrice || 0);
  const discountAmount = Number(record.discountAmount || Math.max(0, offerPrice - agreedPrice));
  const discountPct = Number(record.discountPercentage) || (offerPrice > 0 ? (discountAmount / offerPrice) * 100 : 0);
  const vendorName = record.vendorName || 'Bilinmeyen Tedarikçi';
  const category = record.category || 'Genel';
  const supervisorName = record.supervisorName || 'Satınalmacı';
  const personnelName = record.performedByPersonnelName;
  const items = record.items || matchedInvoice?.items || [];

  let riskScore = 8; // Temel taban

  // =========================================================================
  // BOYUT 1: BELGE BÜTÜNLÜĞÜ VE DİJİTAL KANIT ZİNCİRİ
  // =========================================================================
  const hasFirstDoc = Boolean(record.firstOfferFileUrl || record.firstOfferDriveFileId || record.firstOfferFileName);
  const hasFinalDoc = Boolean(record.finalOfferFileUrl || record.finalOfferDriveFileId || matchedInvoice?.fileUrl || matchedInvoice?.driveFileId);

  let docCheck: ForensicCheckDetail;
  if (!hasFirstDoc && !hasFinalDoc) {
    riskScore += 35;
    docCheck = {
      detected: true,
      scoreImpact: 35,
      title: 'İki Belge de Sistemde Yok (Tamamen Beyana Dayalı)',
      summary: 'Ne başlangıç teklif mektubu ne de son fatura sisteme yüklenmemiş.',
      details: 'Satınalmacı resmi evrak sunmadan sistemde indirim beyan etmiştir. İndirimin fiziki gerçekliği kanıtlanamaz.'
    };
  } else if (!hasFirstDoc) {
    riskScore += 25;
    docCheck = {
      detected: true,
      scoreImpact: 25,
      title: '1. Teklif Belgesi Eksik',
      summary: 'Son fatura mevcut ancak pazarlık öncesi ilk teklif mektubu yüklenmemiş.',
      details: 'Pazarlığa gerçekten bu fiyattan mı başlandığı teyit edilemiyor. Fiyatın satınalmacı tarafından yüksek gösterilme riski mevcuttur.'
    };
  } else if (!hasFinalDoc) {
    riskScore += 20;
    docCheck = {
      detected: true,
      scoreImpact: 20,
      title: 'Son Resmi Fatura Eksik',
      summary: '1. teklif yüklenmiş ancak faturanın kesildiği henüz doğrulanmamış.',
      details: 'İşlem henüz faturalaşmamış veya proforma aşamasında kalmış olabilir.'
    };
  } else {
    docCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Evrak Bütünlüğü Tam',
      summary: 'Hem 1. teklif belgesi hem de son resmi fatura dijital arşivde mevcut.',
      details: 'Gerekli iki belge de doğrulanabilir şekilde sistemde kayıtlıdır.'
    };
  }

  // =========================================================================
  // BOYUT 2: EMSAL PİYASA FİYAT DENETİMİ (Lojistik ve Özel Karkaslar MUAFTIR!)
  // =========================================================================
  const exemptionDetails: string[] = [];
  let exemptItemsCount = 0;
  let worstDiff = 0;
  let worstItemName = '';
  let worstOffered = 0;
  let worstAvg = 0;
  let worstUnit = '';
  let worstConvNote = '';
  let worstClosingPrice = 0;
  let isClosingAboveMarket = false;

  if (items.length > 0 && comparisons.length > 0) {
    for (const it of items) {
      const rawName = (it.materialName || it.description || '').trim();
      if (!rawName) continue;
      const itCategory = it.category || category;

      // Lojistik ve Özel İmalat Karkas Muafiyet Filtresi
      const exemption = isExemptFromBenchmarkAudit(rawName, itCategory);
      if (exemption.isExempt) {
        exemptItemsCount++;
        exemptionDetails.push(`🛡️ '${rawName}': ${exemption.label} - ${exemption.explanation}`);
        continue; // Emsal fiyat karşılaştırmasından muaf tut!
      }

      const comp = comparisons.find(c => {
        const cName = (c?.materialName || '').toLowerCase().trim();
        const nLower = rawName.toLowerCase();
        return cName === nLower || (nLower.length > 4 && cName.includes(nLower)) || (cName.length > 4 && nLower.includes(cName));
      });
      if (!comp) continue;

      const benchmarkAvg = Number(comp?.avgUnitPrice || comp?.avgPrice || 0);
      if (benchmarkAvg > 0 && it.unitPrice) {
        const itPrice = Number(it.unitPrice);
        const itUnit = it.unit || 'adet';
        const benchmarkUnit = comp.standardUnit || comp.unit || 'adet';

        // Akıllı şantiye birim dönüşümü
        const conv = convertMaterialUnit({
          materialName: rawName,
          category: itCategory,
          fromUnit: itUnit,
          toUnit: benchmarkUnit,
          unitPrice: itPrice,
          quantity: Number(it.quantity) || 1
        });

        if (conv.conversionApplied || normalizeStandardUnit(itUnit) === normalizeStandardUnit(benchmarkUnit)) {
          const effectivePrice = conv.conversionApplied ? conv.convertedUnitPrice : itPrice;
          const diff = ((effectivePrice - benchmarkAvg) / benchmarkAvg) * 100;
          if (diff > worstDiff) {
            worstDiff = diff;
            worstItemName = rawName;
            worstOffered = effectivePrice;
            worstAvg = benchmarkAvg;
            worstUnit = benchmarkUnit;
            worstConvNote = conv.conversionApplied ? ` (${itPrice} ₽/${itUnit} -> ${effectivePrice} ₽/${benchmarkUnit} [${conv.formula}])` : '';
            worstClosingPrice = effectivePrice;
          }
        }
      }
    }
  }

  let marketCheck: ForensicCheckDetail;
  if (worstDiff >= 30) {
    riskScore += 35;
    marketCheck = {
      detected: true,
      scoreImpact: 35,
      title: `Emsal Fiyat Üzerinde Başlangıç (+%${worstDiff.toFixed(0)} Fahiş Fiyat)`,
      summary: `'${worstItemName}' için başlangıç birim fiyatı şirket ortalamasının çok üstünde.`,
      details: `Teklif birim fiyatı: ${formatRuble(worstOffered)}/${worstUnit}${worstConvNote}, GES şirket geçmiş ortalaması: ${formatRuble(worstAvg)}/${worstUnit}. Tedarikçi malzemeyi zaten %${worstDiff.toFixed(0)} pahalıya teklif etmiş, indirim ancak gerçek piyasa seviyesine çekmiştir.`,
      evidence: [`Malzeme: ${worstItemName}`, `Teklif Fiyatı: ${formatRuble(worstOffered)}/${worstUnit}${worstConvNote}`, `GES Piyasa Ortalaması: ${formatRuble(worstAvg)}/${worstUnit}`]
    };
  } else if (exemptItemsCount > 0 && worstDiff === 0) {
    marketCheck = {
      detected: false,
      scoreImpact: 0,
      title: `Emsal Denetimi Temiz (${exemptItemsCount} Kalem Muaf Tutuldu)`,
      summary: `Standart kalemlerde emsal sapması yok; ${exemptItemsCount} lojistik/karkas kalemi özel statüde değerlendirildi.`,
      details: 'Nakliye ve özel imalat karkas giderleri proje dinamiklerine göre değişken olduğundan haksız birim fiyat uyarısı verilmedi.'
    };
  } else {
    marketCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Emsal Birim Fiyatlar Uyumlu',
      summary: 'GES arşivindeki geçmiş alım fiyatlarıyla uyumlu, fahiş bir sapma tespit edilmedi.',
      details: 'Birim fiyatlar şirket geçmiş ortalamalarına yakın seyretmektedir.'
    };
  }

  // =========================================================================
  // BOYUT 3: KURGUSAL LİSTE FİYATI / ŞİŞİRİLMİŞ İNDİRİM TUZAĞI
  // =========================================================================
  // Eğer satınalmacı %25+ indirim beyan etmiş ama anlaşılan kapanış fiyatı
  // piyasa ortalamasının dahi üzerindeyse, bu %100 şişirilmiş liste fiyatı tuzağıdır!
  if (worstAvg > 0 && worstClosingPrice > worstAvg && discountPct >= 20) {
    isClosingAboveMarket = true;
  }

  let inflationCheck: ForensicCheckDetail;
  if (isClosingAboveMarket && discountPct >= 25) {
    riskScore += 45;
    inflationCheck = {
      detected: true,
      scoreImpact: 45,
      title: `Kurgusal Liste Fiyatı Tuzağı! (İndirime Rağmen Piyasa Üstü Kapanış)`,
      summary: `Satınalmacı %${discountPct.toFixed(1)} indirim aldığını beyan etmiş, ancak nihai fiyat GES ortalamasının üzerindedir!`,
      details: `Piyasa ortalaması ${formatRuble(worstAvg)}/${worstUnit} olan '${worstItemName}' malzemesi, %${discountPct.toFixed(1)} indirim yapıldıktan sonra bile ${formatRuble(worstClosingPrice)}/${worstUnit} seviyesinden kapatılmıştır. Şirkete reel bir tasarruf sağlanmamış, liste fiyatı baştan tavandan açılarak yapay indirim puanı üretilmiştir!`
    };
  } else if (discountPct >= 40) {
    riskScore += 40;
    inflationCheck = {
      detected: true,
      scoreImpact: 40,
      title: `Olağandışı Aşırı İskonto Marjı (%${discountPct.toFixed(1)})`,
      summary: `Toptan inşaat tedarik marjlarının (%5-%15) fersah fersah üzerinde.`,
      details: `Tedarikçinin ticari gerekçe olmadan %${discountPct.toFixed(0)} iskonto vermesi olağandışıdır. Bu durum %90 ihtimalle liste fiyatının şişirilmesine veya sepet küçülmesine işaret eder.`
    };
  } else if (discountPct >= 25) {
    riskScore += 20;
    inflationCheck = {
      detected: true,
      scoreImpact: 20,
      title: `Yüksek İskonto Oranı Şüphesi (%${discountPct.toFixed(1)})`,
      summary: `Piyasa teamüllerine göre yüksek iskonto marjı.`,
      details: `Normal inşaat malzeme alımlarında nadir rastlanan %25 üzeri oran. Tedarikçinin liste fiyatını yüksek açıp açmadığı 1. teklif formuyla doğrulanmalıdır.`
    };
  } else {
    inflationCheck = {
      detected: false,
      scoreImpact: 0,
      title: `Normal Ticari İndirim Oranı (%${discountPct.toFixed(1)})`,
      summary: `İnşaat malzeme pazarlık teamüllerine (%3-%20) uygun.`,
      details: `Teklif ile anlaşılan tutar arasındaki marj olağan piyasa bandındadır.`
    };
  }

  // =========================================================================
  // BOYUT 4: SEPET KÜÇÜLTME VE MİKTAR EKSİLTME İLLÜZYONU
  // =========================================================================
  let basketCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Sepet ve Miktar Teyidi Temiz',
    summary: 'Miktar eksiltilerek tutar düşürme bulgusu yok.',
    details: 'Teklif ve fatura kalemlerinin fiziki hacmi tutarlı görünüyor.'
  };

  if (matchedInvoice && Array.isArray(matchedInvoice.items) && record.items && record.items.length > 0) {
    if (matchedInvoice.items.length < record.items.length) {
      const missingCount = record.items.length - matchedInvoice.items.length;
      riskScore += 35;
      basketCheck = {
        detected: true,
        scoreImpact: 35,
        title: `Sepetten Kalem Çıkarılmış (${missingCount} Kalem Eksik)`,
        summary: '1. teklifteki bazı malzemeler son faturada yer almıyor.',
        details: `1. teklifte ${record.items.length} kalem malzeme varken, kesilen son faturada yalnızca ${matchedInvoice.items.length} kalem bulunmaktadır. Fatura tutarındaki düşüş gerçek bir birim fiyat indirimi değil, malzeme çıkarılması (sepet küçültmesi) sonucu oluşmuştur!`
      };
    } else {
      // Kalem sayıları aynıysa toplam miktar düşüşü var mı kontrol et
      const offerTotalQty = record.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const invTotalQty = matchedInvoice.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      if (offerTotalQty > 0 && invTotalQty > 0 && invTotalQty < offerTotalQty * 0.85) {
        riskScore += 30;
        basketCheck = {
          detected: true,
          scoreImpact: 30,
          title: `Miktar Eksiltilerek Tutar Düşürülmüş (Hacim Azalması)`,
          summary: `Fatura toplam miktarı 1. tekliftekinden %${Math.round(((offerTotalQty - invTotalQty) / offerTotalQty) * 100)} daha az.`,
          details: 'Birim fiyatlar değişmeden yalnızca sipariş miktarı kısılarak toplam tutar düşürülmüş. Bu bir pazarlık başarısı değil, şantiye ihtiyacından vazgeçilmesidir.'
        };
      }
    }
  }

  // =========================================================================
  // BOYUT 5: PARÇALI SİPARİŞ & DENETİMDEN KAÇINMA (SPLIT INVOICE DETECTOR)
  // =========================================================================
  let splitCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Parçalı Sipariş Riski Yok',
    summary: 'Aynı tedarikçiden kısa aralıklarla parçalı alım tespit edilmedi.',
    details: 'İşlem bağımsız ve tekil bir satınalma sürecidir.'
  };

  if (allDiscounts && allDiscounts.length > 0) {
    const orderTime = new Date(record.orderDate || record.created_at || Date.now()).getTime();
    const vNameClean = vendorName.toLowerCase().trim();
    const sNameClean = supervisorName.toLowerCase().trim();

    const nearbySameVendorOrders = allDiscounts.filter(d => {
      if (d.id === record.id) return false;
      const dTime = new Date(d.orderDate || d.created_at || Date.now()).getTime();
      const dVName = (d.vendorName || '').toLowerCase().trim();
      const dSName = (d.supervisorName || '').toLowerCase().trim();
      const hoursDiff = Math.abs(orderTime - dTime) / (1000 * 60 * 60);

      return hoursDiff <= 72 && dVName === vNameClean && (dSName === sNameClean || d.jobsiteId === record.jobsiteId);
    });

    if (nearbySameVendorOrders.length >= 2) {
      riskScore += 25;
      const totalCombined = nearbySameVendorOrders.reduce((s, d) => s + (Number(d.agreedPrice) || 0), agreedPrice);
      splitCheck = {
        detected: true,
        scoreImpact: 25,
        title: `Parçalı Sipariş Şüphesi (${nearbySameVendorOrders.length + 1} İşlem / 72 Saat)`,
        summary: `Aynı tedarikçiye (${vendorName}) 72 saat içinde toplam ${formatRuble(totalCombined)} tutarında parçalı sipariş açılmış.`,
        details: 'Tek bir büyük ihale açmak yerine siparişlerin parçalanarak yönetim onay limitlerinin veya adli denetim radarlarının altından geçirilmeye çalışılma riski mevcuttur.'
      };
    }
  }

  // =========================================================================
  // BOYUT 6: MÜZAKERE TURLARI VE KURGUSAL TUR BASMA DENETİMİ
  // =========================================================================
  let roundsCheck: ForensicCheckDetail;
  const rounds = Array.isArray(record.negotiationRounds) ? record.negotiationRounds.length : (Number(record.negotiationCount) || 0);
  const roundsList = record.negotiationRounds || [];

  // Turlar inceleniyor: Turlar arasında gerçekten fiyat revizyonu var mı?
  let isRoundsFabricated = false;
  if (roundsList.length >= 3) {
    const prices = roundsList.map(r => Number(r.revisedPrice || r.offerPrice || 0)).filter(p => p > 0);
    if (prices.length >= 3) {
      const allEqual = prices.every(p => p === prices[0]);
      if (allEqual) isRoundsFabricated = true;
    }
  }

  if (isRoundsFabricated) {
    riskScore += 25;
    roundsCheck = {
      detected: true,
      scoreImpact: 25,
      title: 'Formalite / Yapay Müzakere Turları',
      summary: 'Müzakere turları eklenmiş ancak turlar arasında hiçbir fiyat revizyonu yapılmamış.',
      details: 'Satınalmacı çok turlu müzakere puanı kazanmak için sisteme formalite turlar basmış görünmektedir.'
    };
  } else if (rounds >= 3) {
    riskScore = Math.max(0, riskScore - 15);
    roundsCheck = {
      detected: false,
      scoreImpact: -15,
      title: `Çok Turlu Müzakere (${rounds} Tur Kanıtlı)`,
      summary: 'Adım adım fiyat kırımı yapılmış, gerçek bir pazarlık süreci var.',
      details: 'Satınalmacı tedarikçiyi aşamalı teklif revizyonlarıyla geriletmiş.'
    };
  } else if (rounds === 1 && discountPct > 20) {
    riskScore += 10;
    roundsCheck = {
      detected: true,
      scoreImpact: 10,
      title: 'Tek Hamlede Büyük İndirim',
      summary: 'Hiçbir ara tur veya revizyon olmadan tek hamlede beyan edilmiş.',
      details: 'Çok turlu müzakere kaydı yok. Teklif birden aşağı çekilmiş.'
    };
  } else {
    roundsCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Standart Müzakere Akışı',
      summary: `${rounds} tur müzakere gerçekleştirilmiş.`,
      details: 'Olağandışı bir tur anomalisi tespit edilmedi.'
    };
  }

  // =========================================================================
  // BOYUT 7: TEDARİKÇİ TEKELİ VE DANIŞIKLI İSKONTO RİSKİ
  // =========================================================================
  let vendorConcentrationCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Tedarikçi Dağılımı Sağlıklı',
    summary: 'Portföyde şüpheli bir tedarikçi tekeli veya konsantrasyonu tespit edilmedi.',
    details: 'Alımlar farklı piyasa aktörlerine dengeli şekilde dağıtılmıştır.'
  };

  if (allDiscounts && allDiscounts.length >= 5) {
    const sNameClean = supervisorName.toLowerCase().trim();
    const vNameClean = vendorName.toLowerCase().trim();
    const buyerDiscounts = allDiscounts.filter(d => (d.supervisorName || '').toLowerCase().trim() === sNameClean);

    if (buyerDiscounts.length >= 5) {
      const vendorDiscounts = buyerDiscounts.filter(d => (d.vendorName || '').toLowerCase().trim() === vNameClean);
      const concentrationRate = (vendorDiscounts.length / buyerDiscounts.length) * 100;
      if (concentrationRate >= 70) {
        riskScore += 15;
        vendorConcentrationCheck = {
          detected: true,
          scoreImpact: 15,
          title: `Tedarikçi Yoğunlaşması (%${concentrationRate.toFixed(0)} Tek Firma)`,
          summary: `Satınalmacının ${buyerDiscounts.length} işleminin ${vendorDiscounts.length} adedi bu firmaya gitmiş.`,
          details: 'Aynı firmayla sürekli yüksek indirim beyan edilmesi, alternatif rekabet oluşturulmadan danışıklı teklifler üzerinden yapay indirim üretilme riskini doğurur.'
        };
      }
    }
  }

  // =========================================================================
  // BOYUT 8: YUVARLAK RAKAM VE KALEMSİZ TUTAR ANOMALİSİ
  // =========================================================================
  let roundNumCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Tutar Kuruş Bütünlüğü Tam',
    summary: 'Rakamlar kalem bazlı gerçek hesaplamalardan türemiştir.',
    details: 'Tutarlarda yapay düzleme veya kaba tahmin emaresi yoktur.'
  };

  const isOfferRound = offerPrice >= 1_000_000 && offerPrice % 1_000_000 === 0;
  const isAgreedRound = agreedPrice >= 1_000_000 && agreedPrice % 1_000_000 === 0;
  const isItemsEmpty = !items || items.length === 0;

  if (isOfferRound && isAgreedRound && isItemsEmpty) {
    riskScore += 15;
    roundNumCheck = {
      detected: true,
      scoreImpact: 15,
      title: 'Yuvarlak Rakam / Kalemsiz Tutar Beyanı',
      summary: `İlk teklif (${formatRuble(offerPrice)}) ve kapanış (${formatRuble(agreedPrice)}) tamamen düz yuvarlak tutarlardır.`,
      details: 'Kalem kalem birim fiyat analizi yapılmadan düz yuvarlak milyonluk tutarlar girilmiştir. Resmî teklif formundaki kalem dökümü incelenmelidir.'
    };
  }

  // Clamp riskScore 0 - 100
  riskScore = Math.min(100, Math.max(5, Math.round(riskScore)));

  // Risk Seviyesi ve Etiket Belirleme
  let riskLevel: ForensicRiskLevel = 'LOW';
  let badgeLabel = '✓ Organik İndirim';
  let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  let headline = 'İşlem Güvenli ve Doğrulanabilir';
  let recommendedAction: 'FREEZE' | 'APPROVE' | 'REQUEST_INSPECTION' = 'APPROVE';
  let executiveRecommendation = 'İşlemi onaylayabilir ve satınalmacının hanesine efor puanını güvenle yazabilirsiniz.';

  if (riskScore >= 70) {
    riskLevel = 'CRITICAL';
    badgeLabel = '🚨 Kritik Adli Risk';
    badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 ring-1 ring-rose-400';
    headline = isClosingAboveMarket
      ? 'Kurgusal Liste Fiyatı: İndirime Rağmen Piyasa Üstü Kapanış!'
      : 'Yüksek İhtimalle Şişirilmiş Teklif veya Sepet İllüzyonu!';
    recommendedAction = 'FREEZE';
    executiveRecommendation = 'Efor puanını derhal dondurun! Satınalmacıdan kaşeli 1. teklif mektubunu, tedarikçi yazışmalarını ve alternatif teklifleri talep edin.';
  } else if (riskScore >= 45) {
    riskLevel = 'HIGH';
    badgeLabel = '⚠️ Yüksek Şüphe';
    badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    headline = 'Piyasa Emsalleri ve İskonto Marjı Tutarsız';
    recommendedAction = 'FREEZE';
    executiveRecommendation = '1. Teklif formu ile son faturadaki malzeme kalemlerini tek tek karşılaştırıp onay vermeden önce dondurun.';
  } else if (riskScore >= 25) {
    riskLevel = 'MEDIUM';
    badgeLabel = '🔍 İnceleme Gerekli';
    badgeClass = 'bg-sky-100 text-sky-800 border-sky-300';
    headline = 'Emsal veya Belge Teyidi Gerektiren İşlem';
    recommendedAction = 'REQUEST_INSPECTION';
    executiveRecommendation = 'Eksik belgeleri tamamlatın ve fatura birim fiyatlarını onaylayarak serbest bırakın.';
  }

  // Yönetici Onaylamışsa
  if (record.auditStatus === 'EXECUTIVE_APPROVED') {
    badgeLabel = '✓ Yönetici Tarafından Doğrulandı';
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
    recommendedAction = 'APPROVE';
    executiveRecommendation = 'Yönetici fiziki evrakları inceleyip işlemi serbest bırakmıştır.';
  }

  // Gerçek Bir İnsan Başdenetçi Gibi Yazılmış Derin Rapor Metni
  const actor = personnelName ? `${personnelName} (Asist)` : `${supervisorName} (Satınalma Şefi)`;
  const humanAuditorNarrative = generateHumanAuditorNarrative({
    record,
    actor,
    vendorName,
    category,
    offerPrice,
    agreedPrice,
    discountAmount,
    discountPct,
    riskScore,
    riskLevel,
    inflationCheck,
    marketCheck,
    basketCheck,
    splitCheck,
    docCheck,
    roundsCheck,
    vendorConcentrationCheck,
    roundNumCheck,
    exemptItemsCount,
    exemptionDetails
  });

  return {
    recordId: record.id,
    riskLevel,
    riskScore,
    badgeLabel,
    badgeClass,
    headline,
    confidence: 'HIGH',
    checks: {
      initialPriceInflation: inflationCheck,
      marketBenchmark: marketCheck,
      basketShrinkage: basketCheck,
      splitInvoice: splitCheck,
      negotiationRounds: roundsCheck,
      vendorConcentration: vendorConcentrationCheck,
      documentIntegrity: docCheck,
      roundNumberAnomaly: roundNumCheck
    },
    exemptions: {
      exemptItemsCount,
      details: exemptionDetails
    },
    humanAuditorNarrative,
    executiveRecommendation,
    recommendedAction
  };
}

/**
 * İnsan Denetçi Üslubunda Ayrıntılı Adli İnceleme Tutanağı Metni
 */
function generateHumanAuditorNarrative(ctx: {
  record: DiscountRecord;
  actor: string;
  vendorName: string;
  category: string;
  offerPrice: number;
  agreedPrice: number;
  discountAmount: number;
  discountPct: number;
  riskScore: number;
  riskLevel: ForensicRiskLevel;
  inflationCheck: ForensicCheckDetail;
  marketCheck: ForensicCheckDetail;
  basketCheck: ForensicCheckDetail;
  splitCheck: ForensicCheckDetail;
  docCheck: ForensicCheckDetail;
  roundsCheck: ForensicCheckDetail;
  vendorConcentrationCheck: ForensicCheckDetail;
  roundNumCheck: ForensicCheckDetail;
  exemptItemsCount: number;
  exemptionDetails: string[];
}): string {
  const { actor, vendorName, category, offerPrice, agreedPrice, discountAmount, discountPct, riskScore, riskLevel } = ctx;

  let narrative = `GES Construction Kıdemli Adli Satınalma Başdenetçisi İnceleme Tutanağı:\n\n`;
  narrative += `1. VAKIA ÖZETİ: Satınalma sorumlusu ${actor}, ${category} kategorisinde ${vendorName} firmasından toplam ${formatRuble(offerPrice)} tutarında alım sürecine girmiş ve işlemi ${formatRuble(agreedPrice)} seviyesine çekerek ${formatRuble(discountAmount)} (%${discountPct.toFixed(1)}) tasarruf sağladığını beyan etmiştir.\n\n`;

  narrative += `2. ADLİ ŞÜPHE VE UYANIKLIK TAKTİKLERİ TAHLİLİ (Risk Skoru: ${riskScore}/100):\n`;

  if (ctx.inflationCheck.detected) {
    narrative += `• ${ctx.inflationCheck.title}: ${ctx.inflationCheck.details}\n`;
  }
  if (ctx.marketCheck.detected) {
    narrative += `• Emsal Fiyat Karşılaştırması: ${ctx.marketCheck.details}\n`;
  }
  if (ctx.basketCheck.detected) {
    narrative += `• Sepet Küçültme İllüzyonu: ${ctx.basketCheck.details}\n`;
  }
  if (ctx.splitCheck.detected) {
    narrative += `• Parçalı Sipariş (Split Invoice): ${ctx.splitCheck.details}\n`;
  }
  if (ctx.roundsCheck.detected) {
    narrative += `• Müzakere Süreci: ${ctx.roundsCheck.details}\n`;
  }
  if (ctx.vendorConcentrationCheck.detected) {
    narrative += `• Tedarikçi Konsantrasyonu: ${ctx.vendorConcentrationCheck.details}\n`;
  }
  if (ctx.docCheck.detected) {
    narrative += `• Belge Eksikliği: ${ctx.docCheck.details}\n`;
  }
  if (ctx.roundNumCheck.detected) {
    narrative += `• Tutar Anomalisi: ${ctx.roundNumCheck.details}\n`;
  }

  if (ctx.exemptItemsCount > 0) {
    narrative += `• 🛡️ Özel Statü & Muafiyetler: İşlemde yer alan ${ctx.exemptItemsCount} adet kalem (nakliye / özel imalat karkas) serbest piyasa ve çizim dinamikleri gereği emsal kıyaslamasından muaf tutulmuştur.\n`;
  }

  narrative += `\n3. BAŞDENETÇİ HÜKMÜ VE YÖNETİCİYE TAVSİYE:\n`;
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
    narrative += `Şirket kasasından çıkan para gerçekten optimize edilmiş midir, yoksa havadan şişirilmiş bir fiyattan geri mi gelinmiştir? Mevcut adli veriler ışığında, satınalmacının indirim efor puanının bu işlem doğrulanana kadar DONDURULMASI ve tedarikçinin orijinal kaşeli ilk teklifinin incelenmesi şarttır.`;
  } else {
    narrative += `İşlem sağlıklı bir pazarlık başarısıdır, şirket menfaatine net tasarruf sağlanmıştır. Efor puanı güvenle serbest bırakılabilir.`;
  }

  return narrative;
}

/**
 * Canlı Gemini Yapay Zeka Başdenetçisi Çağrısı (Server Proxy Üzerinden)
 */
export async function fetchLiveAIForensicAnalysis(
  record: DiscountRecord,
  comparisons: MaterialComparison[] = [],
  matchedInvoice?: InvoiceRecord | null,
  allDiscounts: DiscountRecord[] = []
): Promise<AIForensicVerdict> {
  try {
    const payload = {
      record: {
        id: record.id,
        vendorName: record.vendorName,
        supervisorName: record.supervisorName,
        performedByPersonnelName: record.performedByPersonnelName,
        jobsiteName: record.jobsiteName,
        category: record.category,
        orderDate: record.orderDate,
        invoiceNo: record.invoiceNo,
        offerPrice: record.offerPrice,
        agreedPrice: record.agreedPrice,
        discountAmount: record.discountAmount,
        discountPercentage: record.discountPercentage,
        items: record.items || matchedInvoice?.items || [],
        negotiationRounds: record.negotiationRounds || [],
        firstOfferFileName: record.firstOfferFileName,
        finalOfferFileName: record.finalOfferFileName || matchedInvoice?.rawFileName
      },
      benchmark: comparisons.slice(0, 15),
      hasMatchedInvoice: Boolean(matchedInvoice)
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('/api/ai/audit-discount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.verdict) {
        return {
          ...data.verdict,
          isAiGenerated: true
        };
      }
    }
  } catch (err) {
    console.warn('[AI AUDITOR] Server AI çağrısı başarısız oldu, yerel adli motor devrede:', err);
  }

  // Fallback to resilient in-memory algorithmic engine
  return runForensicAudit(record, comparisons, matchedInvoice, allDiscounts);
}

/**
 * Tüm portföyün adli röntgenini çeken global özet fonksiyonu
 */
export function generatePortfolioForensicSummary(
  auditedItems: Array<{
    record: DiscountRecord;
    verdict: AIForensicVerdict;
  }>
) {
  let criticalCount = 0;
  let highRiskCount = 0;
  let normalCount = 0;
  let totalScrutinizedSpend = 0;
  let totalClaimedDiscount = 0;
  let totalExemptItemsCount = 0;
  let evasionTacticsCount = 0;

  const vendorRiskMap: Record<string, { totalDiscounts: number; highRiskCount: number; spend: number }> = {};

  for (const item of auditedItems) {
    const rec = item.record;
    const v = item.verdict;
    totalScrutinizedSpend += Number(rec.agreedPrice || 0);
    totalClaimedDiscount += Number(rec.discountAmount || 0);
    totalExemptItemsCount += v.exemptions?.exemptItemsCount || 0;

    if (v.checks.initialPriceInflation.detected) evasionTacticsCount++;
    if (v.checks.basketShrinkage.detected) evasionTacticsCount++;
    if (v.checks.splitInvoice?.detected) evasionTacticsCount++;

    if (v.riskLevel === 'CRITICAL') criticalCount++;
    else if (v.riskLevel === 'HIGH') highRiskCount++;
    else normalCount++;

    const vName = rec.vendorName || 'Bilinmeyen';
    if (!vendorRiskMap[vName]) {
      vendorRiskMap[vName] = { totalDiscounts: 0, highRiskCount: 0, spend: 0 };
    }
    vendorRiskMap[vName].totalDiscounts++;
    vendorRiskMap[vName].spend += Number(rec.agreedPrice || 0);
    if (v.riskLevel === 'CRITICAL' || v.riskLevel === 'HIGH') {
      vendorRiskMap[vName].highRiskCount++;
    }
  }

  const riskyVendors = Object.entries(vendorRiskMap)
    .filter(([_, data]) => data.highRiskCount > 0)
    .sort((a, b) => b[1].highRiskCount - a[1].highRiskCount)
    .slice(0, 5)
    .map(([name, data]) => ({
      name,
      highRiskCount: data.highRiskCount,
      totalCount: data.totalDiscounts,
      spend: data.spend
    }));

  return {
    totalRecords: auditedItems.length,
    criticalCount,
    highRiskCount,
    normalCount,
    totalScrutinizedSpend,
    totalClaimedDiscount,
    totalExemptItemsCount,
    evasionTacticsCount,
    riskyVendors,
    cleanRatePct: auditedItems.length > 0 ? Math.round((normalCount / auditedItems.length) * 100) : 100
  };
}

export interface SuperIntelligentAnomaly {
  id: string;
  type: 'CROSS_JOBSITE_ARBITRAGE' | 'SPLIT_INVOICE_SMURFING' | 'PRICE_CREEP' | 'BASKET_SHRINKAGE';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  category: string;
  materialName?: string;
  supplier?: string;
  vendorName?: string;
  jobsiteName?: string;
  impactAmount: number;
  percentageChange: number;
  date: string;
  evidence: string[];
  recommendation: string;
  isCommodityVolatile?: boolean;
}

/**
 * Günlük/haftalık borsa ve hammadde endeksine bağlı olarak fiyatı sürekli değişen
 * emtia grubu malzemeleri (Demir/Çelik, Hazır Beton, Bakır/Kablo, Akaryakıt) tespit eden motor.
 */
export function isCommodityVolatileMaterial(materialName?: string, category?: string): {
  isCommodity: boolean;
  type: 'STEEL_REBAR' | 'CONCRETE_CEMENT' | 'COPPER_CABLE' | 'FUEL' | 'NONE';
  label: string;
} {
  const text = `${materialName || ''} ${category || ''}`.toLowerCase();
  
  // 1. Demir, Çelik, Hasır Çelik, Profil, Sac vb. (Steel & Metals)
  if (
    text.includes('demir') || text.includes('donatı') || text.includes('donati') ||
    text.includes('hasır') || text.includes('hasir') || text.includes('profil') ||
    text.includes('çelik') || text.includes('celik') || text.includes('sac ') ||
    text.includes('арматур') || text.includes('сталь') || text.includes('металл') ||
    text.includes('швеллер') || text.includes('балк') || text.includes('уголок') ||
    text.includes('а500') || text.includes('a500') || text.includes('а400') ||
    text.includes('лист г/к') || text.includes('лист х/к') || text.includes('профнастил')
  ) {
    return { isCommodity: true, type: 'STEEL_REBAR', label: 'İnşaat Demiri & Çelik (Borsa Emtiası)' };
  }

  // 2. Hazır Beton, Çimento, Agrega (Concrete & Cement)
  if (
    text.includes('beton') || text.includes('çimento') || text.includes('cimento') ||
    text.includes('бетон') || text.includes('цемент') || text.includes('раствор') ||
    text.includes('песок') || text.includes('щебень') || text.includes('mıcır') || text.includes('micir')
  ) {
    return { isCommodity: true, type: 'CONCRETE_CEMENT', label: 'Hazır Beton & Çimento (Hammadde/Lojistik Endeksi)' };
  }

  // 3. Kablo, Bakır, İletken (Copper & Cables)
  if (
    text.includes('kablo') || text.includes('bakır') || text.includes('bakir') ||
    text.includes('кабель') || text.includes('медь') || text.includes('провод') ||
    text.includes('ввг') || text.includes('vvg')
  ) {
    return { isCommodity: true, type: 'COPPER_CABLE', label: 'Kablo & Bakır (LME Borsa Endeksi)' };
  }

  // 4. Akaryakıt, Mazot, Dizel (Fuel)
  if (
    text.includes('mazot') || text.includes('dizel') || text.includes('benzin') ||
    text.includes('akaryakıt') || text.includes('akaryakit') ||
    text.includes('топливо') || text.includes('дизель') || text.includes('солярк')
  ) {
    return { isCommodity: true, type: 'FUEL', label: 'Akaryakıt & Dizel (Günlük Pompa/Rafineri Fiyatı)' };
  }

  return { isCommodity: false, type: 'NONE', label: 'Standart Malzeme' };
}

/**
 * İnsandan Üstün Yapay Zeka Satınalma Beyni (Super-Intelligent Procurement Brain)
 * 
 * 4 Gizli ve Derin Anomali Tespit Motoru:
 * a) Çapraz Şantiye Fiyat Arbitrajı (Cross-Jobsite Arbitrage): Aynı malzemenin iki şantiye arasındaki haksız fiyat farkı ve tasarruf potansiyeli.
 * b) Eşik Atlatma & Parçalı Alım (Split Invoice / Smurfing): Aynı tedarikçiden 72 saat içinde onay limitinin hemen altında kesilen şüpheli parçalı alımlar.
 * c) Sinsi Fiyat Artışı (Price Creep): Tedarikçinin son faturalarda kademeli olarak birim fiyatı sinsice artırması.
 * d) Sepet Küçültme & Fiktif İndirim İllüzyonu: Teklifteki kalem sayısı ile kesilen fatura kalem sayısını kıyaslayıp sahte indirimleri deşifre etme.
 */
export function detectSuperIntelligentProcurementAnomalies(
  invoices: InvoiceRecord[] = [],
  discounts: DiscountRecord[] = [],
  comparisons: MaterialComparison[] = []
): SuperIntelligentAnomaly[] {
  const anomalies: SuperIntelligentAnomaly[] = [];

  // =========================================================================
  // MOTOR 1: ÇAPRAZ ŞANTİYE FİYAT ARBİTRAJI (Cross-Jobsite Arbitrage)
  // =========================================================================
  if (Array.isArray(comparisons) && comparisons.length > 0) {
    comparisons.forEach((comp, idx) => {
      const minP = Number(comp.minUnitPrice || 0);
      const maxP = Number(comp.maxUnitPrice || 0);
      const pct = Number(comp.priceDifferencePercentage || 0);

      // 1. Muafiyet kontrolü (Nakliye ve Özel Karkas muaftır)
      const exemption = isExemptFromBenchmarkAudit(comp.materialName, comp.category);
      if (exemption.isExempt) return;

      // 2. Emtia kontrolü (Demir, Beton, Kablo, Yakıt gibi günlük borsa oynaklığı olan ürünlerde tolerans genişletilir)
      const commodityInfo = isCommodityVolatileMaterial(comp.materialName, comp.category);
      const minRequiredThreshold = commodityInfo.isCommodity ? 22 : 12;

      if (minP > 0 && maxP > minP && pct >= minRequiredThreshold && comp.cheapestJobsiteName && comp.priciestJobsiteName && comp.cheapestJobsiteName !== comp.priciestJobsiteName) {
        const gap = maxP - minP;
        const estimatedQty = Number(comp.totalQuantityPurchased) || 5;
        const potentialSavings = gap * estimatedQty;

        anomalies.push({
          id: `super_arbitrage_${idx}_${comp.materialName.slice(0, 15).replace(/\s+/g, '_')}`,
          type: 'CROSS_JOBSITE_ARBITRAGE',
          severity: pct >= (commodityInfo.isCommodity ? 32 : 25) ? 'CRITICAL' : 'WARNING',
          title: `Çapraz Şantiye Fiyat Arbitrajı (%${pct.toFixed(0)} Makas)${commodityInfo.isCommodity ? ' [Borsa Emtiası]' : ''}`,
          category: comp.category || 'Genel Malzeme',
          materialName: comp.materialName,
          jobsiteName: `${comp.cheapestJobsiteName} ⟷ ${comp.priciestJobsiteName}`,
          impactAmount: Math.round(potentialSavings),
          percentageChange: pct,
          date: new Date().toISOString().split('T')[0],
          isCommodityVolatile: commodityInfo.isCommodity,
          evidence: [
            `En Uygun Şantiye: ${comp.cheapestJobsiteName} (${formatRuble(minP)}/${comp.unit || 'adet'})`,
            `En Yüksek Şantiye: ${comp.priciestJobsiteName} (${formatRuble(maxP)}/${comp.unit || 'adet'})`,
            `Tahmini Arbitraj Tasarruf Fırsatı: ${formatRuble(potentialSavings)}`,
            ...(commodityInfo.isCommodity ? [`Piyasa Türü: ${commodityInfo.label} (Farklı alım tarihlerinde spot borsa kuru teyit edilmelidir)`] : [])
          ],
          recommendation: commodityInfo.isCommodity
            ? `Emtia ürününde iki şantiye arasında belirgin makas (%${pct.toFixed(0)}) vardır. Alım tarihleri spot demir/çimento borsa endeksiyle teyit edilip ortak toplu tonaj siparişi açılmalıdır.`
            : `Pahalı alım yapan '${comp.priciestJobsiteName}' şantiyesi, '${comp.cheapestJobsiteName}' şantiyesinin anlaşmalı birim fiyatına (${formatRuble(minP)}) derhal çekilmeli veya ortak konsolide sipariş açılmalıdır.`
        });
      }
    });
  }

  // =========================================================================
  // MOTOR 2: EŞİK ATLATMA & PARÇALI ALIM (Split Invoice / Smurfing)
  // =========================================================================
  const allOrders = [
    ...invoices.filter(i => !i.isDeleted).map(i => ({
      id: i.id,
      vendor: (i.supplier || '').trim(),
      amount: Number(i.totalAmount || 0),
      date: i.date || i.created_at || '',
      jobsite: i.jobsiteName || 'Genel Şantiye',
      docNo: i.invoiceNumber || 'No yok',
      items: i.items || []
    })),
    ...discounts.filter(d => !d.isDeleted).map(d => ({
      id: d.id,
      vendor: (d.vendorName || '').trim(),
      amount: Number(d.agreedPrice || 0),
      date: d.orderDate || d.created_at || '',
      jobsite: d.jobsiteName || 'Genel Şantiye',
      docNo: d.invoiceNo || 'No yok',
      items: d.items || []
    }))
  ];

  const vendorGroups = new Map<string, Array<{ id: string; vendor: string; amount: number; time: number; jobsite: string; docNo: string; dateStr: string; isCommodity: boolean }>>();
  allOrders.forEach(o => {
    if (!o.vendor || o.amount <= 0) return;
    const vKey = o.vendor.toLowerCase();
    const time = new Date(o.date || Date.now()).getTime();
    const isComm = o.items.some((it: any) => isCommodityVolatileMaterial(it.materialName || it.originalName, it.category).isCommodity);
    if (!vendorGroups.has(vKey)) vendorGroups.set(vKey, []);
    vendorGroups.get(vKey)!.push({ ...o, time, dateStr: o.date, isCommodity: isComm });
  });

  vendorGroups.forEach((orders, vKey) => {
    if (orders.length >= 2) {
      orders.sort((a, b) => a.time - b.time);
      for (let i = 0; i < orders.length - 1; i++) {
        const cluster = [orders[i]];
        let clusterSum = orders[i].amount;

        for (let j = i + 1; j < orders.length; j++) {
          const hours = Math.abs(orders[j].time - orders[i].time) / (1000 * 3600);
          if (hours <= 72) {
            cluster.push(orders[j]);
            clusterSum += orders[j].amount;
          } else {
            break;
          }
        }

        const isMostlyCommodity = cluster.some(c => c.isCommodity);
        const requiredClusterSum = isMostlyCommodity ? 800000 : 400000;

        if (cluster.length >= 2 && clusterSum >= requiredClusterSum) {
          const first = cluster[0];
          const last = cluster[cluster.length - 1];
          const anomalyId = `split_smurfing_${vKey}_${first.id}_${cluster.length}`;
          if (!anomalies.some(a => a.id === anomalyId)) {
            anomalies.push({
              id: anomalyId,
              type: 'SPLIT_INVOICE_SMURFING',
              severity: clusterSum >= (isMostlyCommodity ? 2500000 : 1500000) ? 'CRITICAL' : 'WARNING',
              title: `Eşik Atlatma & Parçalı Alım (${cluster.length} Fatura / 72 Saat)${isMostlyCommodity ? ' [Tonaj/Sevkiyat]' : ''}`,
              category: isMostlyCommodity ? 'Hacimli Sevkiyat & Parçalı Alım' : 'Şüpheli İşlem & Onay Atlatma',
              supplier: first.vendor,
              vendorName: first.vendor,
              jobsiteName: first.jobsite,
              impactAmount: Math.round(clusterSum),
              percentageChange: 0,
              date: last.dateStr || new Date().toISOString().split('T')[0],
              isCommodityVolatile: isMostlyCommodity,
              evidence: [
                `Tedarikçi: ${first.vendor}`,
                `Toplam Konsolide Tutar: ${formatRuble(clusterSum)} (${cluster.length} parça)`,
                `Faturalar: ${cluster.map(c => `${c.docNo} (${formatRuble(c.amount)})`).slice(0, 3).join(', ')}`,
                ...(isMostlyCommodity ? ['Tonaj/Sevkiyat Notu: Tır ve mikser kapasitesi gereği parçalı teslimat yapılmış olabilir.'] : [])
              ],
              recommendation: isMostlyCommodity
                ? `Demir/beton tonaj sevkiyatı parçalı faturalandırılmış. Toplu alım tonaj iskontosu sözleşmesi yapıldığı teyit edilmelidir.`
                : `72 saat içinde tek ihale veya toplu pazarlık yapılmak yerine sipariş parçalanmış. Tedarikçiden toplu alım hacim iskontosu (%10+) talep edilmeli ve işlemler birleştirilmelidir.`
            });
          }
          i += cluster.length - 1;
        }
      }
    }
  });

  // =========================================================================
  // MOTOR 3: SİNSİ FİYAT ARTIŞI (Price Creep)
  // =========================================================================
  const priceHistoryMap = new Map<string, Array<{ date: string; time: number; unitPrice: number; supplier: string; jobsite: string; material: string; category: string }>>();
  invoices.forEach(inv => {
    if (inv.isDeleted || !Array.isArray(inv.items)) return;
    const invDate = inv.date || inv.created_at || '';
    const time = new Date(invDate || Date.now()).getTime();

    inv.items.forEach(it => {
      const mat = (it.materialName || it.originalName || '').trim();
      const sup = (inv.supplier || '').trim();
      const price = Number(it.unitPrice) || 0;
      if (!mat || !sup || price <= 0) return;

      const key = `${sup.toLowerCase()}:::${mat.toLowerCase()}`;
      if (!priceHistoryMap.has(key)) priceHistoryMap.set(key, []);
      priceHistoryMap.get(key)!.push({
        date: invDate,
        time,
        unitPrice: price,
        supplier: sup,
        jobsite: inv.jobsiteName || 'Şantiye',
        material: mat,
        category: it.category || 'Genel'
      });
    });
  });

  priceHistoryMap.forEach((history, key) => {
    if (history.length >= 2) {
      history.sort((a, b) => a.time - b.time);
      const first = history[0];
      const last = history[history.length - 1];

      const exemption = isExemptFromBenchmarkAudit(first.material, first.category);
      if (exemption.isExempt) return;

      const commodityInfo = isCommodityVolatileMaterial(first.material, first.category);
      // Emtia ürünlerinde (demir, çimento, kablo) %16 altındaki artışlar borsa dalgalanması sayılır, anomali üretilmez
      const minIncreasePct = commodityInfo.isCommodity ? 16 : 6;

      if (last.unitPrice > first.unitPrice * (1 + minIncreasePct / 100)) {
        const diffPct = ((last.unitPrice - first.unitPrice) / first.unitPrice) * 100;
        const totalDiff = last.unitPrice - first.unitPrice;

        anomalies.push({
          id: `price_creep_${key.replace(/[^a-z0-9]/gi, '_')}`,
          type: 'PRICE_CREEP',
          severity: diffPct >= (commodityInfo.isCommodity ? 26 : 18) ? 'CRITICAL' : 'WARNING',
          title: `Sinsi Fiyat Artışı: ${first.supplier} (+%${diffPct.toFixed(0)})${commodityInfo.isCommodity ? ' [Borsa Emtiası]' : ''}`,
          category: first.category,
          materialName: first.material,
          supplier: first.supplier,
          vendorName: first.supplier,
          jobsiteName: last.jobsite,
          impactAmount: Math.round(totalDiff * 20), // tahmini sipariş etkisi
          percentageChange: Number(diffPct.toFixed(1)),
          date: last.date || new Date().toISOString().split('T')[0],
          isCommodityVolatile: commodityInfo.isCommodity,
          evidence: [
            `İlk Anlaşma Fiyatı: ${formatRuble(first.unitPrice)} (${first.date})`,
            `Son Fatura Fiyatı: ${formatRuble(last.unitPrice)} (${last.date})`,
            `Fiyat Farkı: +${formatRuble(totalDiff)} birim başı (%${diffPct.toFixed(1)})`,
            ...(commodityInfo.isCommodity ? [`Emtia Notu: ${commodityInfo.label} (Fiyat artışı genel borsa zammından mı yoksa firmadan mı kaynaklandı kontrol edilmelidir)`] : [])
          ],
          recommendation: commodityInfo.isCommodity
            ? `Tedarikçinin birim fiyat artışı borsa endeksi artışının üzerindedir. Üretici fabrika liste fiyatı teyit edilmeli ve güncel iskontolu fiyat talep edilmelidir.`
            : `Tedarikçi faturalarda kademeli fiyat artışı uygulamıştır. Sözleşme başlangıç birim fiyatına (${formatRuble(first.unitPrice)}) iade veya geçmiş fark iade faturası kesilmelidir.`
        });
      }
    }
  });

  // =========================================================================
  // MOTOR 4: SEPET KÜÇÜLTME & FİKTİF İNDİRİM İLLÜZYONU (Basket Shrinkage)
  // =========================================================================
  discounts.forEach(dsc => {
    if (dsc.isDeleted) return;
    const items = dsc.items || [];
    if (items.length >= 2 && dsc.invoiceNo) {
      const invClean = (dsc.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const matched = invoices.find(i => {
        const num = (i.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        return num && num === invClean;
      });

      if (matched && Array.isArray(matched.items) && matched.items.length < items.length) {
        const missing = items.length - matched.items.length;
        const claimedDiscount = Number(dsc.discountAmount) || 0;

        anomalies.push({
          id: `basket_shrinkage_${dsc.id}`,
          type: 'BASKET_SHRINKAGE',
          severity: 'CRITICAL',
          title: `Sepet Küçültme & Fiktif İndirim İllüzyonu (${missing} Kalem Eksik)`,
          category: dsc.category || 'Genel',
          materialName: `${items.length} Kalem Teklif ➔ ${matched.items.length} Kalem Fatura`,
          supplier: dsc.vendorName,
          vendorName: dsc.vendorName,
          jobsiteName: dsc.jobsiteName,
          impactAmount: Math.round(claimedDiscount),
          percentageChange: Number(dsc.discountPercentage) || 0,
          date: dsc.orderDate || new Date().toISOString().split('T')[0],
          evidence: [
            `1. Teklif Formunda: ${items.length} kalem malzeme beyan edilmiş`,
            `Kesilen Son Faturada: Sadece ${matched.items.length} kalem malzeme mevcut`,
            `Şüpheli İndirim: ${formatRuble(claimedDiscount)} (%${(dsc.discountPercentage || 0).toFixed(1)})`
          ],
          recommendation: `Fatura tutarındaki düşüş gerçek bir pazarlık başarısı değil, tekliften kalem çıkarılması sonucudur. Satınalmacının indirim efor puanı dondurulmalı, gerçek birim fiyatlar baz alınmalıdır.`
        });
      }
    }
  });

  return anomalies.sort((a, b) => {
    const sev = { CRITICAL: 1, WARNING: 2, INFO: 3 };
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
    return b.impactAmount - a.impactAmount;
  });
}
