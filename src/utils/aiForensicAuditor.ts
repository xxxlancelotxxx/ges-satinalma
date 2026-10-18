import { DiscountRecord, MaterialComparison, InvoiceRecord } from '../types';
import { formatRuble } from './format';
import {
  convertMaterialUnit,
  normalizeStandardUnit
} from './constructionUnitConverter';
import {
  isExemptFromBenchmarkAudit
} from './auditRiskEngine';
export { isExemptFromBenchmarkAudit };

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
 * Elma-Elma (Apples-to-Apples) Teknik Ölçü Uyum Kontrolü:
 * İki malzeme adının çap (Ø), kalınlık, ebat veya güç değerleri farklıysa asla birbirine emsal alınmaz.
 */
function hasConflictingSpecs(nameA: string, nameB: string): boolean {
  const a = nameA.toLowerCase().replace(/,/g, '.');
  const b = nameB.toLowerCase().replace(/,/g, '.');

  // Çap kontrolü: Ø12 vs Ø16 vb.
  const diamA = a.match(/(?:ø|ф|d|çap)\s*(\d{1,3})\b/i)?.[1];
  const diamB = b.match(/(?:ø|ф|d|çap)\s*(\d{1,3})\b/i)?.[1];
  if (diamA && diamB && diamA !== diamB) return true;

  // Boyut kontrolü: 100x100 vs 50x50 vb.
  const dimA = a.match(/\b(\d{1,4}\s*[xх*×]\s*\d{1,4}(?:\s*[xх*×]\s*\d{1,4})?)\b/i)?.[1]?.replace(/\s+/g, '').replace(/[х*×]/g, 'x');
  const dimB = b.match(/\b(\d{1,4}\s*[xх*×]\s*\d{1,4}(?:\s*[xх*×]\s*\d{1,4})?)\b/i)?.[1]?.replace(/\s+/g, '').replace(/[х*×]/g, 'x');
  if (dimA && dimB && dimA !== dimB) return true;

  return false;
}

/**
 * Derin Sezgisel Kıdemli Adli Satınalma Başdenetçisi Motoru (Senior AI Forensic Chief Auditor)
 *
 * Sıfır Yanlış Pozitif (Zero Hallucination) & Sıfır Hile Toleransı:
 * 1. Belge Bütünlüğü: Hem `firstOfferFileUrl`/`finalOfferFileUrl` hem de genel `fileUrl`/`driveFileId`/`comparativeAnalysisId` kontrol edilir.
 * 2. Elma-Elma Emsal Piyasa Fiyat Denetimi: Yalnızca birebir aynı malzeme ve aynı/dönüştürülebilir birimde (en az 2 geçmiş alımı olan) emsallerle kıyaslanır.
 * 3. Kurgusal Liste Fiyatı / Şişirilmiş İlk Teklif Hilesi: İlk teklifin geçmiş emsale göre yapay şişirilip şişirilmediği ve kapanış fiyatının emsalin üstünde kalıp kalmadığı denetlenir.
 * 4. Aynı Tedarikçi Zam + Sahte İndirim Oyunu: Tedarikçinin bir önceki faturasına göre zam yapıp "indirim" adı altında eski fiyatın üstünde satıp satmadığı yakalanır.
 * 5. Sepet Küçültme & Miktar Kısma Hilesi: Birim fiyat düşmeden miktar düşürülerek fatura tutarının düşürülmesi hilesi yakalanır.
 * 6. Gerçek Parçalı Fatura (TDF 1M+ ₽ Eşiği Atlatma / Smurfing): Mükerrer kayıtlar elenerek 72 saat içinde farklı fatura numaralarıyla 1M ₽ sınırını aşan bölünmüş alımlar tespit edilir.
 */
export function runForensicAudit(
  record: DiscountRecord,
  comparisons: MaterialComparison[] = [],
  matchedInvoice?: InvoiceRecord | null,
  allDiscounts: DiscountRecord[] = []
): AIForensicVerdict {
  const offerPrice = Number(record.offerPrice || 0);
  const agreedPrice = Number(record.agreedPrice || 0);
  const discountAmount = Number(record.discountAmount ?? Math.max(0, offerPrice - agreedPrice));
  const discountPct = Number(record.discountPercentage) || (offerPrice > 0 ? (discountAmount / offerPrice) * 100 : 0);
  const vendorName = (record.vendorName || 'Bilinmeyen Tedarikçi').trim();
  const category = record.category || 'Genel';
  const supervisorName = record.supervisorName || 'Satınalmacı';
  const personnelName = record.performedByPersonnelName;
  const items = (record.items && record.items.length > 0) ? record.items : (matchedInvoice?.items || []);

  let riskScore = 5; // Temiz başlangıç tabanı

  // =========================================================================
  // BOYUT 1: BELGE BÜTÜNLÜĞÜ VE DİJİTAL KANIT ZİNCİRİ (Doğru Alan Kontrolü)
  // =========================================================================
  const hasTdfLink = Boolean((record as any).comparativeAnalysisId);
  const hasGeneralFile = Boolean(record.fileUrl || record.driveFileId || matchedInvoice?.fileUrl || matchedInvoice?.driveFileId || matchedInvoice?.prizmaSource);
  const hasFirstDoc = Boolean(record.firstOfferFileUrl || record.firstOfferDriveFileId || record.firstOfferFileName || hasTdfLink);
  const hasFinalDoc = Boolean(record.finalOfferFileUrl || record.finalOfferDriveFileId || record.finalOfferFileName || hasGeneralFile || hasTdfLink);

  let docCheck: ForensicCheckDetail;
  if (!hasFirstDoc && !hasFinalDoc && !hasGeneralFile) {
    riskScore += 30;
    docCheck = {
      detected: true,
      scoreImpact: 30,
      title: 'Resmi Kanıt Belgesi Yüklenmemiş (Beyana Dayalı Kayıt)',
      summary: 'Sisteme ne ilk teklif ne de onaylı fatura dosyası eklenmiş.',
      details: 'İndirim beyanının doğrulanabilmesi için ilk teklif ve son fatura belgelerinin yüklenmesi gerekmektedir.'
    };
  } else if (!hasFirstDoc && discountPct >= 15) {
    riskScore += 18;
    docCheck = {
      detected: true,
      scoreImpact: 18,
      title: '1. Teklif Belgesi Eksik (Başlangıç Fiyatı Teyitsiz)',
      summary: 'Son fatura mevcut ancak %15 üzeri indirimin ilk teklif belgesi eklenmemiş.',
      details: 'Yüksek oranlı indirimlerde tedarikçinin ilk teklif fiyatını doğrulamak için 1. teklif belgesi şarttır.'
    };
  } else if (!hasFinalDoc) {
    riskScore += 15;
    docCheck = {
      detected: true,
      scoreImpact: 15,
      title: 'Son Onaylı Fatura Belgesi Eksik',
      summary: 'İlk teklif mevcut ancak kesilen nihai fatura dosyası henüz eşleşmemiş.',
      details: 'Anlaşılan nihai fiyatın faturalaştığını doğrulamak için son fatura belgesi eklenmelidir.'
    };
  } else {
    docCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Evrak ve Arşiv Bütünlüğü Tam',
      summary: 'İşleme ait kanıt belgeleri sistem arşivinde doğrulanabilir durumda.',
      details: 'Belge zinciri eksiksizdir.'
    };
  }

  // =========================================================================
  // BOYUT 2: ELMA-ELMA EMSAL PİYASA FİYAT & GEÇMİŞ FATURA DENETİMİ
  // =========================================================================
  const exemptionDetails: string[] = [];
  let exemptItemsCount = 0;
  let worstClosingDiffPct = 0;
  let worstInitialInflationPct = 0;
  let worstItemName = '';
  let worstClosingPrice = 0;
  let worstInitialUnitPrice = 0;
  let worstBenchmarkAvg = 0;
  let worstBenchmarkMin = 0;
  let worstUnit = '';
  let worstConvNote = '';
  let sameVendorPrevPrice = 0;
  let sameVendorPrevDate = '';

  const priceRatio = agreedPrice > 0 && offerPrice > agreedPrice ? (offerPrice / agreedPrice) : 1;

  if (items.length > 0 && comparisons.length > 0) {
    for (const it of items) {
      const rawName = (it.materialName || (it as any).description || it.originalName || '').trim();
      if (!rawName) continue;
      const itCategory = it.category || category;

      const exemption = isExemptFromBenchmarkAudit(rawName, itCategory);
      if (exemption.isExempt) {
        exemptItemsCount++;
        exemptionDetails.push(`🛡️ '${rawName}': ${exemption.label}`);
        continue;
      }

      // Sadece birebir aynı kanonik malzeme ve çelişmeyen teknik ölçülerle eşleştir (Elma-Elma!)
      const comp = comparisons.find(c => {
        if (!c || !c.materialName || (c.history?.length || 0) < 2) return false;
        const cName = c.materialName.toLowerCase().trim();
        const nLower = rawName.toLowerCase().trim();
        if (hasConflictingSpecs(cName, nLower)) return false;
        return cName === nLower;
      });
      if (!comp) continue;

      const itPrice = Number(it.unitPrice || 0);
      if (itPrice <= 0) continue;
      const itQty = Number(it.quantity) || 1;
      const itTotal = Number(it.totalPrice) || (itPrice * itQty);
      const itUnit = it.unit || 'Adet';
      const benchmarkUnit = comp.unit || 'Adet';

      // Materiality guard: ignore minor ancillary items (< 5,000 ₽ or < 3% of invoice total)
      if (itTotal < 5000 || (agreedPrice > 50000 && itTotal < agreedPrice * 0.03)) {
        continue;
      }

      const conv = convertMaterialUnit({
        materialName: rawName,
        category: itCategory,
        fromUnit: itUnit,
        toUnit: benchmarkUnit,
        unitPrice: itPrice,
        quantity: itQty
      });

      const unitsMatch = conv.conversionApplied || normalizeStandardUnit(itUnit) === normalizeStandardUnit(benchmarkUnit);
      if (!unitsMatch) continue; // Farklı ve çevrilemeyen birimleri (ör. Adet vs Ton) ASLA kıyaslama!

      const effectiveClosingUnit = conv.conversionApplied ? conv.convertedUnitPrice : itPrice;
      const effectiveInitialUnit = effectiveClosingUnit * priceRatio;
      const curDateMs = record.orderDate ? new Date(record.orderDate).getTime() : 0;

      // Bu faturanın kendisi hariç ve bu faturadan ÖNCE veya aynı dönemde alınmış geçmiş alımların ortalamasını hesapla
      const otherHistory = (comp.history || []).filter(h => {
        if (String(h.invoiceNumber || '').trim().toLowerCase() === String(record.invoiceNo || '').trim().toLowerCase()) return false;
        if (curDateMs > 0 && h.date) {
          const hMs = new Date(h.date).getTime();
          if (hMs > curDateMs + 15 * 86400000) return false;
        }
        return Number(h.unitPrice || 0) > 0;
      });
      if (otherHistory.length === 0) continue;

      const benchmarkAvg = otherHistory.reduce((s, h) => s + Number(h.unitPrice || 0), 0) / otherHistory.length;
      const benchmarkMin = Math.min(...otherHistory.map(h => Number(h.unitPrice || 0)).filter(p => p > 0));

      // Aynı tedarikçiden bu faturadan DAHA ÖNCE kaça alınmış kontrol et (sadece aynı malzeme için!)
      const vendorPrevPurchases = otherHistory
        .filter(h => {
          if ((h.supplier || '').toLowerCase().trim() !== vendorName.toLowerCase()) return false;
          if (curDateMs > 0 && h.date) {
            return new Date(h.date).getTime() <= curDateMs;
          }
          return true;
        })
        .sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime());

      let itemSameVendorPrevPrice = 0;
      let itemSameVendorPrevDate = '';
      if (vendorPrevPurchases.length > 0) {
        const prevP = Number(vendorPrevPurchases[0].unitPrice || 0);
        if (prevP > 0 && effectiveClosingUnit > prevP * 1.12) {
          itemSameVendorPrevPrice = prevP;
          itemSameVendorPrevDate = vendorPrevPurchases[0].date || '';
        }
      }

      if (benchmarkAvg > 0) {
        const closingDiffPct = ((effectiveClosingUnit - benchmarkAvg) / benchmarkAvg) * 100;
        const initialDiffPct = ((effectiveInitialUnit - benchmarkAvg) / benchmarkAvg) * 100;
        const vendorHikePct = itemSameVendorPrevPrice > 0 ? ((effectiveClosingUnit - itemSameVendorPrevPrice) / itemSameVendorPrevPrice) * 100 : 0;

        if (closingDiffPct > worstClosingDiffPct || initialDiffPct > worstInitialInflationPct || vendorHikePct > 12) {
          if (closingDiffPct >= worstClosingDiffPct || vendorHikePct > 12) {
            worstClosingDiffPct = Math.max(worstClosingDiffPct, closingDiffPct);
            worstItemName = comp.materialName;
            worstClosingPrice = effectiveClosingUnit;
            worstInitialUnitPrice = effectiveInitialUnit;
            worstBenchmarkAvg = benchmarkAvg;
            worstBenchmarkMin = benchmarkMin;
            worstUnit = benchmarkUnit;
            worstConvNote = conv.conversionApplied ? ` (${itPrice} ₽/${itUnit} → ${effectiveClosingUnit} ₽/${benchmarkUnit})` : '';
            sameVendorPrevPrice = itemSameVendorPrevPrice;
            sameVendorPrevDate = itemSameVendorPrevDate;
          }
          worstInitialInflationPct = Math.max(worstInitialInflationPct, initialDiffPct);
        }
      }
    }
  }

  let marketCheck: ForensicCheckDetail;
  if (sameVendorPrevPrice > 0 && worstClosingPrice > sameVendorPrevPrice * 1.12) {
    const hikePct = ((worstClosingPrice - sameVendorPrevPrice) / sameVendorPrevPrice) * 100;
    riskScore += 35;
    marketCheck = {
      detected: true,
      scoreImpact: 35,
      title: `Aynı Tedarikçide Gizli Zam + Sahte İndirim (+%${hikePct.toFixed(1)} Pahalı)`,
      summary: `${vendorName} firması '${worstItemName}' ürününü önceki faturasına göre zamlı satmış!`,
      details: `Aynı tedarikçiden ${sameVendorPrevDate} tarihinde ${formatRuble(sameVendorPrevPrice)}/${worstUnit} fiyata alınan '${worstItemName}', bu siparişte ilk teklif ${formatRuble(worstInitialUnitPrice)}/${worstUnit} gösterilip "indirimle" ${formatRuble(worstClosingPrice)}/${worstUnit} fiyata alınmıştır. Gerçekte indirim değil, önceki alıma göre +%${hikePct.toFixed(1)} fiyat artışı vardır!`,
      evidence: [
        `Malzeme: ${worstItemName}`,
        `Önceki Alım (${sameVendorPrevDate}): ${formatRuble(sameVendorPrevPrice)}/${worstUnit}`,
        `Şimdiki Anlaşılan Fiyat: ${formatRuble(worstClosingPrice)}/${worstUnit} (+%${hikePct.toFixed(1)} artış)`
      ]
    };
  } else if (worstClosingDiffPct >= 25) {
    riskScore += 32;
    marketCheck = {
      detected: true,
      scoreImpact: 32,
      title: `İndirime Rağmen Şirket Ortalamasından +%${worstClosingDiffPct.toFixed(0)} Pahalı Alım`,
      summary: `'${worstItemName}' anlaşılan birim fiyatı (${formatRuble(worstClosingPrice)}/${worstUnit}), şirket ortalamasının (${formatRuble(worstBenchmarkAvg)}/${worstUnit}) üzerindedir.`,
      details: `Satınalmacı indirim aldığını beyan etse de, anlaşılan son birim fiyat şirket içi elma-elma emsal ortalamasından %${worstClosingDiffPct.toFixed(1)} (en ucuz şantiye alımı ${formatRuble(worstBenchmarkMin)}/${worstUnit}) daha pahalıdır.`,
      evidence: [
        `Malzeme: ${worstItemName}${worstConvNote}`,
        `Anlaşılan Son Birim Fiyat: ${formatRuble(worstClosingPrice)}/${worstUnit}`,
        `Şirket Emsal Ortalaması: ${formatRuble(worstBenchmarkAvg)}/${worstUnit} (En İyi: ${formatRuble(worstBenchmarkMin)}/${worstUnit})`
      ]
    };
  } else {
    marketCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Elma-Elma Emsal Birim Fiyatlar Uyumlu',
      summary: 'Anlaşılan birim fiyatlar şirket içi geçmiş alım ortalamalarıyla uyumludur.',
      details: 'Geçmiş faturalardaki aynı malzeme ve aynı birim fiyatlarla yapılan elma-elma kıyaslamada fahiş sapma tespit edilmemiştir.'
    };
  }

  // =========================================================================
  // BOYUT 3: KURGUSAL LİSTE FİYATI / ŞİŞİRİLMİŞ İLK TEKLİF TUZAĞI
  // =========================================================================
  const isClosingAboveMarket = worstBenchmarkAvg > 0 && worstClosingPrice > worstBenchmarkAvg * 1.10 && discountPct >= 15;
  const isInitialArtificiallyInflated = worstBenchmarkAvg > 0 && worstInitialInflationPct >= 35 && discountPct >= 20;

  let inflationCheck: ForensicCheckDetail;
  if (isClosingAboveMarket || isInitialArtificiallyInflated) {
    riskScore += 42;
    inflationCheck = {
      detected: true,
      scoreImpact: 42,
      title: `Şişirilmiş İlk Teklif / Kurgusal İndirim Tuzağı!`,
      summary: `İlk teklif piyasa ortalamasının +%${worstInitialInflationPct.toFixed(0)} üzerinde açılıp %${discountPct.toFixed(1)} sahte iskonto gösterilmiş.`,
      details: `Normal piyasa ortalaması ${formatRuble(worstBenchmarkAvg)}/${worstUnit} olan '${worstItemName}' için ilk teklif ${formatRuble(worstInitialUnitPrice)}/${worstUnit} gibi şişirilmiş bir rakamdan başlatılmış, indirim sonrasında ${formatRuble(worstClosingPrice)}/${worstUnit} seviyesine inilmiştir. Bu işlem gerçek bir pazarlık başarısı değil, şişirilmiş liste fiyatından normal fiyata dönüş illüzyonudur!`
    };
  } else if (discountPct >= 42) {
    riskScore += 35;
    inflationCheck = {
      detected: true,
      scoreImpact: 35,
      title: `Olağandışı Yüksek İskonto Oranı (%${discountPct.toFixed(1)}) — İlk Teklif Şişirme Şüphesi`,
      summary: `İnşaat tedarik piyasası standartlarının (%3-%20) çok üzerinde iskonto beyanı.`,
      details: `Hiçbir tedarikçi normal piyasa fiyatından %${discountPct.toFixed(1)} zarar ederek mal satmaz. İlk teklifin kasten yüksek yazdırılıp yazdırılmadığı kontrol edilmelidir.`
    };
  } else {
    inflationCheck = {
      detected: false,
      scoreImpact: 0,
      title: `Gerçekçi Ticari İndirim Oranı (%${discountPct.toFixed(1)})`,
      summary: `İlk teklif ve kapanış tutarı makul ticari müzakere sınırları içerisindedir.`,
      details: `Yapay fiyat şişirme bulgusuna rastlanmadı.`
    };
  }

  // =========================================================================
  // BOYUT 4: SEPET KÜÇÜLTME, KALEM EKSİLTME VE MİKTAR KISMA HİLESİ
  // =========================================================================
  let basketCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Miktar ve Kalem Bütünlüğü Tam',
    summary: 'Miktar kısma veya kalem eksiltme yoluyla sahte indirim bulgusu yok.',
    details: 'Teklif ve fatura kalemleri tutarlıdır.'
  };

  if (matchedInvoice && Array.isArray(matchedInvoice.items) && record.items && record.items.length > 0) {
    if (matchedInvoice.items.length < record.items.length) {
      const missingCount = record.items.length - matchedInvoice.items.length;
      riskScore += 35;
      basketCheck = {
        detected: true,
        scoreImpact: 35,
        title: `Sepetten Kalem Çıkarılmış (${missingCount} Kalem Eksik)`,
        summary: 'İlk teklifteki bazı kalemler son faturadan çıkarılarak toplam tutar düşürülmüş.',
        details: `1. teklifte ${record.items.length} kalem varken son faturada ${matchedInvoice.items.length} kalem yer alıyor. Toplam tutardaki düşüş birim fiyat indiriminden değil, malzeme iptalinden kaynaklanmaktadır!`
      };
    } else {
      const offerTotalQty = record.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const invTotalQty = matchedInvoice.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      if (offerTotalQty > 0 && invTotalQty > 0 && invTotalQty < offerTotalQty * 0.88) {
        riskScore += 30;
        basketCheck = {
          detected: true,
          scoreImpact: 30,
          title: `Miktar Düşürülerek Sahte İndirim Gösterilmiş`,
          summary: `Fatura miktarı ilk teklife göre %${Math.round(((offerTotalQty - invTotalQty) / offerTotalQty) * 100)} azaltılmış.`,
          details: 'Birim fiyat indirilmeden sipariş adedi/tonajı düşürülerek fatura toplamı küçültülmüş ve aradaki fark indirim gibi beyan edilmiştir.'
        };
      }
    }
  }

  // =========================================================================
  // BOYUT 5: GERÇEK PARÇALI SİPARİŞ & 1M+ ₽ TDF EŞİĞİ ATLATMA (SMURFING)
  // =========================================================================
  let splitCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Bölünmüş / Parçalı Fatura Bulgusu Yok',
    summary: 'TDF onay limitini atlatmak için bölünmüş sipariş tespit edilmedi.',
    details: 'İşlem tekil ve kurallara uygundur.'
  };

  if (allDiscounts && allDiscounts.length > 0 && !hasTdfLink) {
    const orderTime = new Date(record.orderDate || record.created_at || Date.now()).getTime();
    const vNameClean = vendorName.toLowerCase().trim();
    const recInvNo = String(record.invoiceNo || '').trim().toLowerCase();

    // Yalnızca FARKLI fatura numarasına sahip gerçek ayrı siparişleri say (mükerrerleri sayma!)
    const nearbyDistinctOrders = allDiscounts.filter(d => {
      if (d.id === record.id || (d as any).isDeleted) return false;
      const dInvNo = String(d.invoiceNo || '').trim().toLowerCase();
      if (recInvNo && dInvNo && recInvNo === dInvNo) return false; // Aynı faturayı iki kez sayma!
      const dTime = new Date(d.orderDate || d.created_at || Date.now()).getTime();
      const dVName = (d.vendorName || '').toLowerCase().trim();
      const hoursDiff = Math.abs(orderTime - dTime) / (1000 * 60 * 60);
      return hoursDiff <= 72 && dVName === vNameClean && d.jobsiteId === record.jobsiteId;
    });

    const totalCombined = nearbyDistinctOrders.reduce((s, d) => s + (Number(d.agreedPrice) || 0), agreedPrice);
    if (nearbyDistinctOrders.length >= 1 && totalCombined >= 1_000_000 && agreedPrice < 1_000_000) {
      riskScore += 28;
      splitCheck = {
        detected: true,
        scoreImpact: 28,
        title: `1M+ ₽ TDF Zorunluluğunu Atlatmak İçin Bölünmüş Sipariş (${nearbyDistinctOrders.length + 1} Fatura)`,
        summary: `Aynı şantiyede ${vendorName} firmasına 72 saatte toplam ${formatRuble(totalCombined)} tutarında parçalı fatura kesilmiş!`,
        details: `Tek faturada 1.000.000 ₽ TDF (en az 2 rakip teklif toplama) zorunluluğuna takılmamak için alımın ${nearbyDistinctOrders.length + 1} ayrı faturaya bölündüğü tespit edilmiştir.`
      };
    }
  }

  // =========================================================================
  // BOYUT 6: MÜZAKERE TURLARI VE KURGUSAL TUR BASMA DENETİMİ
  // =========================================================================
  let roundsCheck: ForensicCheckDetail;
  const rounds = Array.isArray(record.negotiationRounds) ? record.negotiationRounds.length : (Number(record.negotiationCount) || 0);
  const roundsList = record.negotiationRounds || [];

  let isRoundsFabricated = false;
  if (roundsList.length >= 3) {
    const prices = roundsList.map(r => Number(r.revisedPrice || r.offerPrice || 0)).filter(p => p > 0);
    if (prices.length >= 3 && prices.every(p => p === prices[0])) {
      isRoundsFabricated = true;
    }
  }

  if (isRoundsFabricated) {
    riskScore += 25;
    roundsCheck = {
      detected: true,
      scoreImpact: 25,
      title: 'Kurgusal Müzakere Turları (Fiyat Değişimi Yok)',
      summary: 'Müzakere turları girilmiş ancak turlar arasında fiyat hiç düşmemiş.',
      details: 'Puan kazanmak amacıyla fiyat indirimi içermeyen formalite turlar eklenmiştir.'
    };
  } else if (rounds >= 2 || hasTdfLink) {
    riskScore = Math.max(5, riskScore - 8);
    roundsCheck = {
      detected: false,
      scoreImpact: -8,
      title: hasTdfLink ? 'Onaylı TDF Karşılaştırmalı Müzakere' : `Çok Turlu Müzakere (${rounds} Tur)`,
      summary: 'Fiyat kırımı aşamalı tekliflerle doğrulanmıştır.',
      details: 'Sağlıklı pazarlık süreci yürütülmüştür.'
    };
  } else {
    roundsCheck = {
      detected: false,
      scoreImpact: 0,
      title: 'Standart Müzakere Akışı',
      summary: 'Olağandışı bir tur anomalisi tespit edilmedi.',
      details: 'Müzakere kaydı normaldir.'
    };
  }

  // =========================================================================
  // BOYUT 7: TEDARİKÇİ TEKELİ VE DANIŞIKLI İSKONTO RİSKİ
  // =========================================================================
  let vendorConcentrationCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Tedarikçi Dağılımı Normal',
    summary: 'Şüpheli bir tedarikçi tekeli tespit edilmedi.',
    details: 'Alımlar farklı firmalara dengeli dağılmıştır.'
  };

  if (allDiscounts && allDiscounts.length >= 6 && discountPct >= 20) {
    const sNameClean = supervisorName.toLowerCase().trim();
    const vNameClean = vendorName.toLowerCase().trim();
    const buyerDiscounts = allDiscounts.filter(d => !(d as any).isDeleted && (d.supervisorName || '').toLowerCase().trim() === sNameClean);

    if (buyerDiscounts.length >= 6) {
      const vendorDiscounts = buyerDiscounts.filter(d => (d.vendorName || '').toLowerCase().trim() === vNameClean);
      const concentrationRate = (vendorDiscounts.length / buyerDiscounts.length) * 100;
      if (concentrationRate >= 75) {
        riskScore += 15;
        vendorConcentrationCheck = {
          detected: true,
          scoreImpact: 15,
          title: `Tek Tedarikçi Yoğunlaşması (%${concentrationRate.toFixed(0)})`,
          summary: `Şefin ${buyerDiscounts.length} işleminin ${vendorDiscounts.length} adedi tek firmaya (${vendorName}) yapılmış.`,
          details: 'Sürekli aynı firmadan yüksek oranlı indirim beyan edilmesi, ilk tekliflerin anlaşmalı olarak yüksek yazılıp yazılmadığının incelenmesini gerektirir.'
        };
      }
    }
  }

  // =========================================================================
  // BOYUT 8: KALEMSİZ YUVARLAK TUTAR BEYANI
  // =========================================================================
  let roundNumCheck: ForensicCheckDetail = {
    detected: false,
    scoreImpact: 0,
    title: 'Kalem ve Tutar Detayı Tam',
    summary: 'Tutarlar gerçek malzeme kalemlerinden oluşmaktadır.',
    details: 'Kalemsiz yuvarlak rakam anomalisi yoktur.'
  };

  const isOfferRound = offerPrice >= 500_000 && offerPrice % 100_000 === 0;
  const isAgreedRound = agreedPrice >= 500_000 && agreedPrice % 100_000 === 0;
  const isItemsEmpty = !items || items.length === 0;

  if (isOfferRound && isAgreedRound && isItemsEmpty) {
    riskScore += 18;
    roundNumCheck = {
      detected: true,
      scoreImpact: 18,
      title: 'Kalemsiz Yuvarlak Tutar Beyanı',
      summary: `Hiçbir malzeme kalemi girilmeden düz yuvarlak tutarlar (${formatRuble(offerPrice)} → ${formatRuble(agreedPrice)}) beyan edilmiş.`,
      details: 'Birim fiyat denetimi yapılabilmesi için faturadaki malzeme kalemlerinin girilmesi zorunludur.'
    };
  }

  riskScore = Math.min(100, Math.max(5, Math.round(riskScore)));

  let riskLevel: ForensicRiskLevel = 'LOW';
  let badgeLabel = '✓ Doğrulanmış Gerçek İndirim';
  let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  let headline = 'Elma-Elma Birim Fiyat ve Belge Denetimi Temiz';
  let recommendedAction: 'FREEZE' | 'APPROVE' | 'REQUEST_INSPECTION' = 'APPROVE';
  let executiveRecommendation = 'Birim fiyatlar şirket emsallerine uygun ve gerçek tasarruf sağlanmış. Güvenle onaylayabilirsiniz.';

  if (riskScore >= 65) {
    riskLevel = 'CRITICAL';
    badgeLabel = '🚨 Kritik Hile / Şişirilmiş Teklif Riski';
    badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 ring-1 ring-rose-400';
    headline = marketCheck.detected
      ? marketCheck.title
      : inflationCheck.detected
      ? inflationCheck.title
      : basketCheck.detected
      ? basketCheck.title
      : 'Yüksek Riskli İndirim Beyanı!';
    recommendedAction = 'FREEZE';
    executiveRecommendation = 'İndirim puanını dondurun! İlk teklif birim fiyatlarının şişirildiği veya emsal şantiye fiyatının üzerinde alım yapıldığı tespit edildi.';
  } else if (riskScore >= 40) {
    riskLevel = 'HIGH';
    badgeLabel = '⚠️ Yüksek Şüphe / İnceleme Şart';
    badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    headline = marketCheck.detected
      ? marketCheck.title
      : inflationCheck.detected
      ? inflationCheck.title
      : basketCheck.detected
      ? basketCheck.title
      : splitCheck.detected
      ? splitCheck.title
      : docCheck.detected
      ? docCheck.title
      : 'Yüksek Şüpheli İndirim / Emsal Fiyat İncelemesi';
    recommendedAction = 'FREEZE';
    executiveRecommendation = 'Onay vermeden önce ilk teklif belgesini ve şantiye emsal birim fiyatlarını kontrol edin.';
  } else if (riskScore >= 22) {
    riskLevel = 'MEDIUM';
    badgeLabel = '🔍 Belge / Emsal Teyidi';
    badgeClass = 'bg-sky-100 text-sky-800 border-sky-300';
    headline = docCheck.detected
      ? docCheck.title
      : inflationCheck.detected
      ? inflationCheck.title
      : splitCheck.detected
      ? splitCheck.title
      : 'Kontrollü İnceleme Gerektiren İşlem';
    recommendedAction = 'REQUEST_INSPECTION';
    executiveRecommendation = 'Eksik belgeyi tamamlatarak işlemi onaylayabilirsiniz.';
  }

  if (record.auditStatus === 'EXECUTIVE_APPROVED') {
    badgeLabel = '✓ Yönetici Tarafından Doğrulandı';
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
    recommendedAction = 'APPROVE';
    executiveRecommendation = 'Yönetici evrakları inceleyip işlemi onaylamıştır.';
  }

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

  let narrative = `GES Satınalma Adli Denetim Raporu:\n\n`;
  narrative += `1. İŞLEM ÖZETİ: ${actor}, ${category} kategorisinde ${vendorName} firmasından ${formatRuble(offerPrice)} ilk teklif referansıyla ${formatRuble(agreedPrice)} nihai tutara anlaşarak ${formatRuble(discountAmount)} (%${discountPct.toFixed(1)}) indirim beyan etmiştir.\n\n`;
  narrative += `2. BULGULAR (Risk Skoru: ${riskScore}/100):\n`;

  let anyDetected = false;
  for (const chk of [ctx.marketCheck, ctx.inflationCheck, ctx.basketCheck, ctx.splitCheck, ctx.roundsCheck, ctx.vendorConcentrationCheck, ctx.docCheck, ctx.roundNumCheck]) {
    if (chk.detected) {
      anyDetected = true;
      narrative += `• ${chk.title}: ${chk.details}\n`;
    }
  }
  if (!anyDetected) {
    narrative += `• Tüm elma-elma birim fiyat, miktar, sepet ve belge kontrolleri başarıyla geçmiştir.\n`;
  }

  if (ctx.exemptItemsCount > 0) {
    narrative += `• 🛡️ Muafiyet: ${ctx.exemptItemsCount} adet nakliye/özel imalat kalemi standart birim emsal denetiminden muaf tutulmuştur.\n`;
  }

  narrative += `\n3. SONUÇ: `;
  if (riskLevel === 'CRITICAL' || riskLevel === 'HIGH') {
    narrative += `Tespit edilen bulgular nedeniyle ilk teklif ve birim fiyatlar yönetici tarafından incelenmeden indirim onaylanmamalıdır.`;
  } else {
    narrative += `İşlem şirket menfaatine gerçek bir tasarruf sağlamıştır, onaylanmaya uygundur.`;
  }

  return narrative;
}

export async function fetchLiveAIForensicAnalysis(
  record: DiscountRecord,
  comparisons: MaterialComparison[] = [],
  matchedInvoice?: InvoiceRecord | null,
  allDiscounts: DiscountRecord[] = []
): Promise<AIForensicVerdict> {
  return runForensicAudit(record, comparisons, matchedInvoice, allDiscounts);
}

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

export function isCommodityVolatileMaterial(materialName?: string, category?: string): {
  isCommodity: boolean;
  type: 'STEEL_REBAR' | 'CONCRETE_CEMENT' | 'COPPER_CABLE' | 'FUEL' | 'NONE';
  label: string;
} {
  const text = `${materialName || ''} ${category || ''}`.toLowerCase();

  if (
    text.includes('demir') || text.includes('donatı') || text.includes('donati') ||
    text.includes('hasır') || text.includes('hasir') || text.includes('profil') ||
    text.includes('çelik') || text.includes('celik') || text.includes('sac ') ||
    text.includes('арматур') || text.includes('сталь') || text.includes('металл') ||
    text.includes('швеллер') || text.includes('балк') || text.includes('уголок')
  ) {
    return { isCommodity: true, type: 'STEEL_REBAR', label: 'İnşaat Demiri & Çelik (Borsa Emtiası)' };
  }

  if (
    text.includes('beton') || text.includes('çimento') || text.includes('cimento') ||
    text.includes('бетон') || text.includes('цемент') || text.includes('раствор') ||
    text.includes('песок') || text.includes('щебень')
  ) {
    return { isCommodity: true, type: 'CONCRETE_CEMENT', label: 'Hazır Beton & Çimento' };
  }

  if (
    text.includes('kablo') || text.includes('bakır') || text.includes('bakir') ||
    text.includes('кабель') || text.includes('медь') || text.includes('провод')
  ) {
    return { isCommodity: true, type: 'COPPER_CABLE', label: 'Kablo & Bakır (LME Endeksi)' };
  }

  if (
    text.includes('mazot') || text.includes('dizel') || text.includes('benzin') ||
    text.includes('akaryakıt') || text.includes('топливо') || text.includes('дизель')
  ) {
    return { isCommodity: true, type: 'FUEL', label: 'Akaryakıt & Dizel' };
  }

  return { isCommodity: false, type: 'NONE', label: 'Standart Malzeme' };
}

/**
 * Elma-Elma Anomali Tespit Motoru (Sıfır Halüsinasyon, Doğrudan Normalize Edilmiş Comparisons Tabanlı)
 */
export function detectSuperIntelligentProcurementAnomalies(
  invoices: InvoiceRecord[] = [],
  discounts: DiscountRecord[] = [],
  comparisons: MaterialComparison[] = []
): SuperIntelligentAnomaly[] {
  const anomalies: SuperIntelligentAnomaly[] = [];

  // 1. Parçalı Alım (Smurfing) — Mükerrer faturaları tekilleştirerek yalnızca farklı fatura numaralarını kontrol et
  const uniqueInvoicesByNo = new Map<string, { id: string; vendor: string; amount: number; time: number; jobsite: string; docNo: string; dateStr: string }>();
  invoices.filter(i => !i.isDeleted && !(i as any).comparativeAnalysisId).forEach(i => {
    const docNo = String(i.invoiceNumber || i.id || '').trim().toLowerCase();
    const vendor = (i.supplier || '').trim();
    const amount = Number(i.totalAmount || 0);
    if (!docNo || !vendor || amount <= 0) return;
    const key = `${vendor.toLowerCase()}__${docNo}`;
    if (!uniqueInvoicesByNo.has(key)) {
      const dateStr = i.date || i.created_at || '';
      uniqueInvoicesByNo.set(key, {
        id: i.id,
        vendor,
        amount,
        time: new Date(dateStr || Date.now()).getTime(),
        jobsite: i.jobsiteName || 'Genel Şantiye',
        docNo: i.invoiceNumber || docNo,
        dateStr
      });
    }
  });

  const vendorGroups = new Map<string, Array<{ id: string; vendor: string; amount: number; time: number; jobsite: string; docNo: string; dateStr: string }>>();
  uniqueInvoicesByNo.forEach(o => {
    const vKey = `${o.vendor.toLowerCase()}__${o.jobsite.toLowerCase()}`;
    if (!vendorGroups.has(vKey)) vendorGroups.set(vKey, []);
    vendorGroups.get(vKey)!.push(o);
  });

  vendorGroups.forEach((orders, vKey) => {
    if (orders.length >= 2) {
      orders.sort((a, b) => a.time - b.time);
      for (let i = 0; i < orders.length - 1; i++) {
        const cluster = [orders[i]];
        let clusterSum = orders[i].amount;

        for (let j = i + 1; j < orders.length; j++) {
          const hours = Math.abs(orders[j].time - orders[i].time) / (1000 * 3600);
          if (hours <= 72 && orders[j].docNo !== orders[i].docNo) {
            cluster.push(orders[j]);
            clusterSum += orders[j].amount;
          } else {
            break;
          }
        }

        // Eğer tekil faturalar 1M ₽ altında ama 72 saatteki toplamları 1M ₽ üstündeyse (TDF eşiği atlatma)
        if (cluster.length >= 2 && clusterSum >= 1_000_000 && cluster.every(c => c.amount < 1_000_000)) {
          const first = cluster[0];
          const last = cluster[cluster.length - 1];
          const anomalyId = `split_smurfing_${vKey.replace(/[^a-z0-9]/gi, '_')}_${first.id}`;
          if (!anomalies.some(a => a.id === anomalyId)) {
            anomalies.push({
              id: anomalyId,
              type: 'SPLIT_INVOICE_SMURFING',
              severity: clusterSum >= 1_500_000 ? 'CRITICAL' : 'WARNING',
              title: `1M+ ₽ TDF Eşiği Atlatma / Parçalı Fatura (${cluster.length} Ayrı Fatura / 72 Saat)`,
              category: 'Parçalı Fatura Denetimi',
              supplier: first.vendor,
              vendorName: first.vendor,
              jobsiteName: first.jobsite,
              impactAmount: Math.round(clusterSum * 0.05),
              percentageChange: 0,
              date: last.dateStr || new Date().toISOString().split('T')[0],
              evidence: [
                `Tedarikçi: ${first.vendor} (${first.jobsite})`,
                `72 Saat İçinde Kesilen Ayrı Faturalar Toplamı: ${formatRuble(clusterSum)} (${cluster.length} fatura)`,
                `Faturalar: ${cluster.map(c => `#${c.docNo} (${formatRuble(c.amount)})`).join(', ')}`
              ],
              recommendation: `1.000.000 ₽ TDF karşılaştırmalı teklif zorunluluğunu atlatmak için siparişin parçalandığı görülmektedir. Toplu ihale iskontosu talep edilmelidir.`
            });
          }
          i += cluster.length - 1;
        }
      }
    }
  });

  // 2. Sepet Küçültme (Basket Shrinkage) — Nakliye / Hizmet kalemlerini hariç tutarak gerçek malzeme sayısını kıyasla
  const FREIGHT_REGEX = /\b(доставка|транспортн|автоуслуг|перевозк|манипулятор|логистик|погруз|разгруз|резка|рубка|услуг[аи]?|аренда|nakliye|teslimat|kargo|sevkiyat|lojistik|vinç|kesim|indirme|yükleme)\b/i;
  discounts.forEach(dsc => {
    if ((dsc as any).isDeleted) return;
    const rawItems = dsc.items || [];
    const items = rawItems.filter((it: any) => !FREIGHT_REGEX.test(`${it.materialName || ''} ${it.originalName || ''} ${it.category || ''}`));
    if (items.length >= 2 && dsc.invoiceNo) {
      const invClean = (dsc.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const matched = invoices.find(i => {
        const num = (i.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        return num && num === invClean;
      });

      const matchedMaterialItems = (matched?.items || []).filter(
        (it: any) => !FREIGHT_REGEX.test(`${it.materialName || ''} ${it.originalName || ''} ${it.category || ''}`)
      );

      if (matched && matchedMaterialItems.length > 0 && matchedMaterialItems.length < items.length) {
        const missing = items.length - matchedMaterialItems.length;
        const claimedDiscount = Number(dsc.discountAmount) || 0;
        anomalies.push({
          id: `basket_shrinkage_${dsc.id}`,
          type: 'BASKET_SHRINKAGE',
          severity: 'CRITICAL',
          title: `Sepet Küçültme / Kalem Eksiltme İllüzyonu (${missing} Kalem Eksik)`,
          category: dsc.category || 'Genel',
          materialName: `${items.length} Kalem Teklif ➔ ${matchedMaterialItems.length} Kalem Fatura`,
          supplier: dsc.vendorName,
          vendorName: dsc.vendorName,
          jobsiteName: dsc.jobsiteName,
          impactAmount: Math.round(claimedDiscount),
          percentageChange: Number(dsc.discountPercentage) || 0,
          date: dsc.orderDate || new Date().toISOString().split('T')[0],
          evidence: [
            `İlk Teklifte: ${items.length} kalem malzeme`,
            `Kesilen Faturada: ${matchedMaterialItems.length} kalem malzeme`,
            `Beyan Edilen İndirim: ${formatRuble(claimedDiscount)}`
          ],
          recommendation: `Fatura tutarındaki düşüş kalem çıkarılmasından kaynaklanmaktadır. Birim fiyatlar birebir kontrol edilmelidir.`
        });
      }
    }
  });

  return anomalies;
}
