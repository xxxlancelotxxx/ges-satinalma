/**
 * Malzeme fiyat kıyaslamasının tek fiyat tabanı: %22 KDV (НДС) DAHİL birim fiyat (Berkant kararı, 2026-10-18).
 * - %20 veya %22 KDV'li satırlar: net × 1,22 (2025'in %20'li faturaları da %22 tabanına taşınır)
 * - KDV'siz / muaf (%0) satırlar: ödenen fiyat, üstüne KDV eklenmez
 * - %10 indirimli oran: kendi KDV dahil fiyatı
 * Sunucudaki /api/materials/compare aynı kuralı uygular (COMPARISON_VAT_BASIS_PCT).
 */
export const COMPARISON_VAT_BASIS_PCT = 22;

export function comparisonMultiplierForVat(vatPercentage: number | undefined | null): number {
  const vat = Number(vatPercentage);
  if (vatPercentage === undefined || vatPercentage === null || Number.isNaN(vat)) return 1 + COMPARISON_VAT_BASIS_PCT / 100;
  if (vat === 20 || vat === 22) return 1 + COMPARISON_VAT_BASIS_PCT / 100;
  return vat > 0 ? 1 + vat / 100 : 1;
}

/** Normalize edilmiş bir fatura kaleminin (unitPrice = net) kıyaslamada kullanılan %22 KDV dahil birim fiyatı. */
export function comparisonUnitPriceOfItem(item: { unitPrice?: number; unitPriceNet?: number; vatPercentage?: number } | null | undefined): number {
  if (!item) return 0;
  const net = Number(item.unitPriceNet ?? item.unitPrice) || 0;
  if (!(net > 0)) return 0;
  return Number((net * comparisonMultiplierForVat(item.vatPercentage)).toFixed(2));
}
