export const NEGOTIATION_THRESHOLD = 500000;

export const NEGOTIATION_EFFORT_COEFF = {
  goalsWeight: 0.30,        // Bireysel GOL (Doğrudan pazarlık icrası ve indirim isteme azmi)
  transactionsWeight: 0.20, // İşlem Kapsamı (Her alımda indirim talep etme kararlılığı)
  assistsWeight: 0.15,      // Ekip Asistleri (Organizasyonel liderlik)
  savingsVolumeWeight: 0.20,// Reel Tasarruf Hacmi (Kasaya kazandırılan net para)
  discountRateWeight: 0.10, // İskonto Yüzdesi (%)
  roundsWeight: 0.05        // Müzakere Turları
};

export function calculateNegotiationEffortScore(
  avgDiscountPercentage: number,
  avgNegotiationRounds: number,
  newVendorRatio: number = 0,
  newVendorsCount: number = 0,
  assistsCount: number = 0,
  totalTransactions: number = 0,
  golCount: number = 0,
  totalDiscountAmount: number = 0
): number {
  const effectiveTx = totalTransactions > 0 ? totalTransactions : (golCount + assistsCount);
  const effectiveGoals = golCount > 0 ? golCount : Math.max(0, effectiveTx - assistsCount);

  if (effectiveTx > 0 || effectiveGoals > 0) {
    // 1. Gol Emeği (Bireysel Doğrudan Pazarlık İcrası - 45 gol = 100 tam puan):
    // 45 defa masaya oturup indirim koparmak muazzam bir efordur; 0 gol 0 puan alır.
    const normGoals = Math.min(100, Math.max(0, (effectiveGoals / 45) * 100));

    // 2. Toplam İşlem ve Pazarlık Israrı (55 işlem = 100 puan):
    const normTx = Math.min(100, Math.max(0, (effectiveTx / 55) * 100));

    // 3. Ekip Asisti (25 asist = 100 puan):
    const normAssists = Math.min(100, Math.max(0, (assistsCount / 25) * 100));

    // 4. Tasarruf Hacmi (10.000.000 ₽ / TL = 100 puan):
    // 6.9M kazandıran şef ile 1M kazandıran şef arasındaki ekonomik fark korunur.
    const normVolume = totalDiscountAmount > 0
      ? Math.min(100, Math.max(0, (totalDiscountAmount / 10000000) * 100))
      : Math.min(100, Math.max(0, (avgDiscountPercentage / 10) * 100));

    // 5. İskonto Oranı Verimi (%10 = 100 puan):
    const normDiscount = Math.min(100, Math.max(0, (avgDiscountPercentage / 10) * 100));

    // 6. Tur ve Yeni Firma Katkısı:
    const normRoundsAndVendor = Math.min(100, (avgNegotiationRounds * 8) + (newVendorsCount * 20) + (newVendorRatio * 40));

    let score: number;
    if (totalDiscountAmount > 0) {
      score =
        normGoals * NEGOTIATION_EFFORT_COEFF.goalsWeight +
        normTx * NEGOTIATION_EFFORT_COEFF.transactionsWeight +
        normAssists * NEGOTIATION_EFFORT_COEFF.assistsWeight +
        normVolume * NEGOTIATION_EFFORT_COEFF.savingsVolumeWeight +
        normDiscount * NEGOTIATION_EFFORT_COEFF.discountRateWeight +
        normRoundsAndVendor * NEGOTIATION_EFFORT_COEFF.roundsWeight;
    } else {
      score =
        normGoals * 0.35 +
        normTx * 0.25 +
        normAssists * 0.20 +
        normDiscount * 0.15 +
        normRoundsAndVendor * 0.05;
    }
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  // Fallback for legacy calls with only percentage & rounds:
  const legacyNormDiscount = Math.min(100, Math.max(0, (avgDiscountPercentage / 25) * 100));
  const legacyNormRounds = Math.min(100, Math.max(0, (avgNegotiationRounds / 3) * 100));
  const legacyNormVendor = Math.min(100, Math.max(0, (newVendorRatio || (newVendorsCount > 0 ? 0.3 : 0)) * 100));
  const legacyNormAssists = Math.min(100, Math.max(0, (assistsCount / 5) * 100));
  const legacyScore =
    legacyNormDiscount * 0.35 +
    legacyNormRounds * 0.25 +
    legacyNormVendor * 0.20 +
    legacyNormAssists * 0.20;
  return Math.round(Math.min(100, Math.max(0, legacyScore)));
}

export interface Procedure52Input {
  offerPrice: number;
  agreedPrice: number;
  negotiationRounds?: any[];
  crossNegotiationApplied?: boolean;
  vendorName?: string;
  recordOriginType?: string;
}

export interface Procedure52Result {
  isValid: boolean;
  warnings: string[];
}

export function validateProcedure52(params: Procedure52Input): Procedure52Result {
  const warnings: string[] = [];
  const rounds = params.negotiationRounds || [];
  const roundsCount = rounds.length;

  if (params.offerPrice >= NEGOTIATION_THRESHOLD || params.agreedPrice >= NEGOTIATION_THRESHOLD) {
    if (roundsCount < 1) {
      warnings.push('500.000 ₽ üzeri alımlarda en az 1 tur müzakere kaydı eklenmelidir.');
    }
    const hasDocs = rounds.some(r => r.documentName || r.documentUrl);
    if (roundsCount > 0 && !hasDocs) {
      warnings.push('Müzakere turları için destekleyici teklif belgesi yüklenmelidir.');
    }
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}
