/**
 * Market-baseline savings engine for procurement performance.
 * New records use MARKET_BASELINE_TO_FINAL; legacy records remain explicit.
 */
export type CalculationMethod = 'MARKET_BASELINE_TO_FINAL' | 'LEGACY_FIRST_TO_FINAL';
export type QuoteUnit = 'kg' | 'ton' | 'm' | 'piece' | 'adet' | string;

export interface QuoteOffer {
  supplierId: string;
  unitPrice: number;
  unit: QuoteUnit;
  quantity?: number;
  isComparable?: boolean;
  confidence?: number;
  isWinner?: boolean;
  pieceLengthMeters?: number;
}

export interface MarketSavingsInput {
  offers?: QuoteOffer[];
  finalUnitPrice?: number;
  finalQuantity?: number;
  finalUnit?: QuoteUnit;
  jobsiteId?: string | null;
  documentKey?: string;
  existingDocumentKeys?: string[];
  calculationMethod?: CalculationMethod;
  confidenceThreshold?: number;
  // Backward-compatible legacy inputs.
  initialPrices?: number[];
  finalPrice?: number;
  quantity?: number;
  winningSupplierInitialPrice?: number;
}

export interface MarketSavingsResult {
  calculationMethod: CalculationMethod;
  marketBaselineUnitPrice: number | null;
  marketSavings: number;
  supplierInternalDiscount: number;
  totalSavings: number;
  finalUnitPrice: number;
  finalQuantity: number;
  kpiEligible: boolean;
  flags: string[];
  comparableSupplierCount: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sameUnit(a: QuoteUnit, b: QuoteUnit): boolean {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function normalizeUnitPrice(offer: QuoteOffer, targetUnit: QuoteUnit): number | null {
  if (!finitePositive(offer.unitPrice)) return null;
  const from = String(offer.unit || '').toLowerCase();
  const to = String(targetUnit || '').toLowerCase();
  if (!from || !to) return null;
  if (sameUnit(from, to)) return offer.unitPrice;
  if (from === 'kg' && to === 'ton') return offer.unitPrice * 1000;
  if (from === 'ton' && to === 'kg') return offer.unitPrice / 1000;
  const fromMeters = from === 'm';
  const fromPieces = from === 'piece' || from === 'adet';
  const toMeters = to === 'm';
  const toPieces = to === 'piece' || to === 'adet';
  if ((fromMeters && toPieces) || (fromPieces && toMeters)) {
    const length = offer.pieceLengthMeters;
    if (!finitePositive(length)) return null;
    return fromMeters ? offer.unitPrice * length : offer.unitPrice / length;
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMarketSavings(input: MarketSavingsInput): MarketSavingsResult;
export function calculateMarketSavings(initialPrices: number[], finalPrice: number, quantity?: number, winningSupplierInitialPrice?: number): MarketSavingsResult;
export function calculateMarketSavings(
  inputOrInitialPrices: MarketSavingsInput | number[],
  finalPriceParam?: number,
  quantityParam = 1,
  winningSupplierInitialPriceParam?: number,
): MarketSavingsResult {
  const input: MarketSavingsInput = Array.isArray(inputOrInitialPrices)
    ? { initialPrices: inputOrInitialPrices, finalPrice: finalPriceParam, quantity: quantityParam, winningSupplierInitialPrice: winningSupplierInitialPriceParam, calculationMethod: 'LEGACY_FIRST_TO_FINAL' }
    : inputOrInitialPrices;
  const method = input.calculationMethod || (input.offers?.length ? 'MARKET_BASELINE_TO_FINAL' : 'LEGACY_FIRST_TO_FINAL');
  const finalPrice = input.finalUnitPrice ?? input.finalPrice ?? 0;
  const quantity = input.finalQuantity ?? input.quantity ?? 1;
  const flags: string[] = [];
  const threshold = input.confidenceThreshold ?? 0.8;
  const finalUnit = input.finalUnit || 'unknown';
  const validFinal = finitePositive(finalPrice) && finitePositive(quantity);
  if (!validFinal) flags.push('INVALID_FINAL_PRICE_OR_QUANTITY');
  if (!input.jobsiteId) flags.push('PENDING_SITE');
  if (input.documentKey && (input.existingDocumentKeys || []).includes(input.documentKey)) flags.push('DUPLICATE_DOCUMENT');

  if (method === 'LEGACY_FIRST_TO_FINAL') {
    const prices = (input.initialPrices || []).filter(finitePositive);
    const baseline = prices.length ? Math.min(...prices) : null;
    const winnerInitial = finitePositive(input.winningSupplierInitialPrice) ? input.winningSupplierInitialPrice : (prices[0] || finalPrice);
    const marketSavings = baseline === null || !validFinal ? 0 : roundMoney((baseline - finalPrice) * quantity);
    const internal = validFinal ? roundMoney((winnerInitial - finalPrice) * quantity) : 0;
    flags.push('LEGACY_RECORD');
    return { calculationMethod: method, marketBaselineUnitPrice: baseline, marketSavings, supplierInternalDiscount: internal, totalSavings: marketSavings, finalUnitPrice: finalPrice, finalQuantity: quantity, kpiEligible: false, flags, comparableSupplierCount: prices.length };
  }

  const offers = input.offers || [];
  const normalized: Array<{ offer: QuoteOffer; unitPrice: number }> = [];
  for (const offer of offers) {
    if (offer.isComparable === false) continue;
    if (offer.confidence !== undefined && offer.confidence < threshold) { flags.push('NEEDS_MATCH_REVIEW'); continue; }
    const unitPrice = normalizeUnitPrice(offer, finalUnit);
    if (unitPrice === null) { flags.push('NEEDS_UNIT_REVIEW'); continue; }
    normalized.push({ offer, unitPrice });
  }
  const suppliers = new Set(normalized.map(x => x.offer.supplierId).filter(Boolean));
  const baseline = normalized.length ? Math.min(...normalized.map(x => x.unitPrice)) : null;
  if (suppliers.size < 2) flags.push('SINGLE_VENDOR');
  if (baseline !== null && validFinal && finalPrice > baseline) flags.push('ABOVE_BEST_OFFER');
  const winner = normalized.find(x => x.offer.isWinner) || normalized[0];
  const marketSavings = baseline === null || suppliers.size < 2 || !validFinal ? 0 : roundMoney((baseline - finalPrice) * quantity);
  const internal = winner && validFinal ? roundMoney((winner.unitPrice - finalPrice) * quantity) : 0;
  const blocking = new Set(['PENDING_SITE', 'DUPLICATE_DOCUMENT', 'NEEDS_MATCH_REVIEW', 'NEEDS_UNIT_REVIEW', 'INVALID_FINAL_PRICE_OR_QUANTITY']);
  const kpiEligible = flags.every(flag => !blocking.has(flag)) && suppliers.size >= 2 && normalized.length > 0;
  return { calculationMethod: method, marketBaselineUnitPrice: baseline, marketSavings, supplierInternalDiscount: internal, totalSavings: marketSavings, finalUnitPrice: finalPrice, finalQuantity: quantity, kpiEligible, flags: [...new Set(flags)], comparableSupplierCount: suppliers.size };
}
