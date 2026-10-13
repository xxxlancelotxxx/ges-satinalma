export interface StageDocumentItem {
  stageNumber: number;
  stageType: 'first' | 'round' | 'final' | 'comparison';
  stageLabel: string;
  stageSubtitle: string;
  amount: number;
  hasFile: boolean;
  fileUrl?: string;
  fileName?: string;
  isFinal?: boolean;
  roundIndex?: number;
}

export function getEffectiveAgreedPrice(record: any): number {
  if (!record) return 0;
  if (record.agreedPrice !== undefined && Number(record.agreedPrice) > 0) {
    return Number(record.agreedPrice);
  }
  if (Array.isArray(record.negotiationRounds) && record.negotiationRounds.length > 0) {
    const last = record.negotiationRounds[record.negotiationRounds.length - 1];
    if (last && last.quotedPrice) return Number(last.quotedPrice);
  }
  return Number(record.offerPrice || 0);
}

export function getEffectiveDiscount(record: any): {
  discountAmount: number;
  discountPercentage: number;
  effectiveAgreed: number;
  baseline: number;
} {
  if (!record) return { discountAmount: 0, discountPercentage: 0, effectiveAgreed: 0, baseline: 0 };

  const effectiveAgreed = getEffectiveAgreedPrice(record);

  // If record originates from comparative offer analysis (market baseline vs final purchase)
  if (record.calculationMethod === 'MARKET_BASELINE_TO_FINAL' || record.comparativeAnalysisId) {
    const realSavings = typeof record.realMarketSavings === 'number'
      ? record.realMarketSavings
      : (typeof record.discountAmount === 'number' ? record.discountAmount : 0);
    const baseline = Number(record.marketReferencePrice || (effectiveAgreed + realSavings) || record.offerPrice || 0);
    const discountAmount = realSavings;
    const discountPercentage = typeof record.realSavingsPercentage === 'number'
      ? record.realSavingsPercentage
      : (typeof record.discountPercentage === 'number'
          ? record.discountPercentage
          : (baseline > 0 ? Number(((discountAmount / baseline) * 100).toFixed(2)) : 0));
    return { discountAmount, discountPercentage, effectiveAgreed, baseline };
  }

  const baseline = Number(record.adjustedOfferPrice || record.offerPrice || 0);
  const discountAmount = Math.max(0, baseline - effectiveAgreed);
  const discountPercentage = baseline > 0 ? Number(((discountAmount / baseline) * 100).toFixed(2)) : 0;
  return { discountAmount, discountPercentage, effectiveAgreed, baseline };
}

export function getDiscountDocumentStages(record: any): StageDocumentItem[] {
  if (!record) return [];

  // 1. If the record already has pre-structured stageDocuments, use them directly
  if (Array.isArray(record.stageDocuments) && record.stageDocuments.length > 0) {
    return record.stageDocuments.map((doc: any, idx: number) => {
      const isFirst = idx === 0 || doc.stageNumber === 1;
      const isLast = idx === record.stageDocuments.length - 1 || doc.isFinal;
      return {
        stageNumber: doc.stageNumber || idx + 1,
        stageType: isFirst ? 'first' : (isLast ? 'final' : 'round'),
        stageLabel: doc.title || (isFirst ? '1. Aşama: İlk Teklif / Fatura' : isLast ? `${idx + 1}. Aşama: Nihai Anlaşılan Fatura` : `${idx + 1}. Aşama: Ara Pazarlık Teklifi`),
        stageSubtitle: isFirst ? 'İndirimsiz Liste Fiyatı' : (isLast ? 'Pazarlık Sonucu Mutabık Kalınan Nihai Fatura' : 'Ara İndirim Faturası / Teklifi'),
        amount: Number(doc.amount || 0),
        hasFile: Boolean(doc.fileUrl || doc.fileName || doc.driveFileId),
        fileUrl: doc.fileUrl,
        fileName: doc.fileName || `Belge_${idx + 1}.pdf`,
        isFinal: isLast,
        roundIndex: doc.roundIndex !== undefined ? doc.roundIndex : (isFirst || isLast ? undefined : idx - 1)
      };
    });
  }

  const invoiceNo = record.invoiceNo || record.documentNumber || record.finalInvoiceDetails?.invoiceNumber || '';
  const isCmp = record.calculationMethod === 'MARKET_BASELINE_TO_FINAL' || Boolean(record.comparativeAnalysisId);
  const stages: StageDocumentItem[] = [];

  // Aşama 1: İlk Teklif (Bargaining Baseline)
  const firstAmount = isCmp && record.internalVendorDiscount
    ? (Number(record.agreedPrice || 0) + Number(record.internalVendorDiscount || 0))
    : Number(record.firstOfferAmount || record.adjustedOfferPrice || record.offerPrice || 0);

  stages.push({
    stageNumber: 1,
    stageType: 'first',
    stageLabel: '1. Aşama: İlk Teklif (Bargaining Baseline)',
    stageSubtitle: isCmp ? 'Aynı Firmanın İlk Liste Fiyatı' : 'Tedarikçiden Alınan İlk Fiyat Teklifi / Proforma Belge',
    amount: firstAmount,
    hasFile: Boolean(record.firstOfferFileUrl || record.firstOfferFileName),
    fileUrl: record.firstOfferFileUrl,
    fileName: record.firstOfferFileName || (invoiceNo ? `Ilk_Teklif_${invoiceNo}.pdf` : '1_Teklif_Belgesi.pdf'),
    isFinal: false,
  });

  // Ara turlar varsa
  const rounds = Array.isArray(record.negotiationRounds) ? record.negotiationRounds : [];
  rounds.forEach((rnd: any, idx: number) => {
    stages.push({
      stageNumber: stages.length + 1,
      stageType: 'round',
      stageLabel: `${stages.length + 1}. Aşama: ${idx + 1}. Tur Pazarlık`,
      stageSubtitle: rnd.notes || rnd.note || `${idx + 1}. Tur Revize Teklif`,
      amount: Number(rnd.quotedPrice || 0),
      hasFile: Boolean(rnd.documentUrl || rnd.documentName),
      fileUrl: rnd.documentUrl,
      fileName: rnd.documentName || `${idx + 1}_Tur_Teklif.pdf`,
      roundIndex: idx,
      isFinal: false,
    });
  });

  // Nihai Anlaşılan Satınalma Faturası
  const fallbackInvoiceUrl = record.fileUrl || (invoiceNo ? `/api/files/Fatura_${invoiceNo}.pdf` : undefined);
  const finalFileUrl = record.finalOfferFileUrl || record.finalInvoiceFileUrl || fallbackInvoiceUrl;
  const finalFileName = record.finalOfferFileName || record.finalInvoiceFileName || record.rawFileName || (invoiceNo ? `Fatura_${invoiceNo}.pdf` : 'Son_Fatura_Belgesi.pdf');
  const finalAmount = Number(record.agreedPrice || record.totalAmount || 0);

  const finalStageNum = stages.length + 1;
  stages.push({
    stageNumber: finalStageNum,
    stageType: 'final',
    stageLabel: `${finalStageNum}. Aşama: Nihai Anlaşılan Satınalma Faturası`,
    stageSubtitle: 'Pazarlık Sonucu Mutabık Kalınan ve Muhasebeye İşlenen Nihai Sevk Faturası',
    amount: finalAmount,
    hasFile: Boolean(finalFileUrl),
    fileUrl: finalFileUrl,
    fileName: finalFileName,
    isFinal: true,
  });

  // Karşılaştırmalı Teklif & Piyasa Analiz Çizelgesi (Sadece kıyas tablosu veya kıyas analizi varsa)
  if (record.comparativeAnalysisId || record.comparisonSheetFileUrl || record.calculationMethod === 'MARKET_BASELINE_TO_FINAL') {
    const analysisId = record.comparativeAnalysisId || record.analysisId || record.analysis?.id || (record.calculationMethod === 'MARKET_BASELINE_TO_FINAL' ? record.id : undefined);
    const cmpExcelUrl = analysisId
      ? `/api/comparative-analyses/${analysisId}/excel`
      : (invoiceNo ? `/api/files/Piyasa_Teklif_Kiyas_Tablosu_${invoiceNo}.xlsx` : `/api/files/Piyasa_Teklif_Kiyas_Tablosu.xlsx`);
    const cmpFileUrl = record.comparisonSheetFileUrl || cmpExcelUrl;
    const cmpFileName = record.comparisonSheetFileName || (invoiceNo ? `Piyasa_Teklif_Kiyas_Tablosu_${invoiceNo}.xlsx` : 'Piyasa_Teklif_Kiyas_Tablosu.xlsx');

    stages.push({
      stageNumber: stages.length + 1,
      stageType: 'comparison',
      stageLabel: `${stages.length + 1}. Aşama: Karşılaştırmalı Teklif & Piyasa Analiz Çizelgesi`,
      stageSubtitle: 'Birden fazla firmanın tekliflerinin kıyaslandığı onaylı seçim tablosu',
      amount: Number(record.marketReferencePrice || record.firstOfferAmount || record.agreedPrice || 0),
      hasFile: Boolean(cmpFileUrl),
      fileUrl: cmpFileUrl,
      fileName: cmpFileName,
      isFinal: false,
    });
  }

  return stages;
}

/**
 * Bir indirim kaydında gerçekten ara pazarlık turu yapılıp yapılmadığını kesin ve güvenilir şekilde tespit eder.
 * Yalnızca standart ilk teklif ve son indirimli fatura girilmişse (2 belge / doğrudan anlaşma), 0 döner.
 * Gerçek ara pazarlık belgesi veya ara aşamalar eklenmişse gerçek tur sayısını döner.
 */
export function getGenuineNegotiationRoundCount(record: any): number {
  if (!record) return 0;

  // 1. Doğrudan negotiationRounds dizisi kontrolü
  const rounds = Array.isArray(record.negotiationRounds) ? record.negotiationRounds : [];
  if (rounds.length > 0) {
    const valid = rounds.filter((r: any) => {
      if (!r || typeof r !== 'object') return false;
      const hasDoc = Boolean(r.documentName || r.documentUrl || r.documentFileName || r.fileName || r.fileUrl);
      return hasDoc || Boolean(r.notes || r.note);
    });
    if (valid.length > 0) return valid.length;
  }

  // 2. Çok aşamalı belgeler (stageDocuments) kontrolü:
  // 1. İlk Teklif ve Son Nihai Fatura haricindeki ara indirimli teklifler turdur
  const stages = Array.isArray(record.stageDocuments) ? record.stageDocuments : [];
  if (stages.length > 2) {
    const intermediate = stages.filter((s: any) => {
      const isFirst = s.stageNumber === 1 || String(s.title || '').includes('1. İlk');
      const isFinal = s.isFinal || String(s.title || '').includes('Nihai') || String(s.title || '').includes('Son Tur Sonrası');
      const hasDoc = Boolean(s.fileName || s.fileUrl || s.driveFileId);
      return !isFirst && !isFinal && hasDoc;
    });
    if (intermediate.length > 0) return intermediate.length;
    return stages.length - 2;
  }

  return 0;
}
