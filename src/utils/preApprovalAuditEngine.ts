/**
 * PRE-APPROVAL AUDIT ENGINE (Hızlı Onay Öncesi Fiyat Denetimi Motoru)
 * 
 * Compares unapproved/draft invoice items against historical approved purchases.
 * Performs deep semantic, technical specification, unit, currency, and VAT normalization.
 * Generates actionable procurement decisions:
 * - ONAYLANABİLİR (APPROVABLE)
 * - İNDİRİM TALEP EDİLMELİ (DISCOUNT RECOMMENDED)
 * - YÖNETİCİ İNCELEMESİ GEREKLİ (MANAGER REVIEW REQUIRED)
 * - KARŞILAŞTIRILABİLİR KAYIT YOK (NO COMPARABLE RECORD)
 * - DÜŞÜK GÜVENLİ EŞLEŞME (LOW CONFIDENCE MATCH)
 */

import { InvoiceRecord, InvoiceItem, DiscountRecord } from '../types';
import { processItem, ProcessItemInput, ProcessedItemResult } from './aiDecisionEngine';
import { extractTechnicalSpecs } from './comparativeCalculation';
import { formatTechnicalVariantBadges } from './materialGroupIntegrity';
import { comparisonMultiplierForVat } from './vatBasis';
import {
  buildSmartOriginalSignature,
  findCheaperEquivalentBrandSuggestion,
  SmartOriginalInvoiceSignature
} from './dualMaterialComparisonEngine';
import {
  buildStrictOriginalMaterialSignature,
  buildMaterialMatchProfile,
  compareMaterialProfiles,
  convertUnitPriceStrict,
  isPlausibleSameMaterialPriceRatio,
  isPurchaseAfter,
  isSamePurchaseCopy,
  cleanDocumentNumber,
  vendorKeyForMatching,
  parsePurchaseDate,
  amountsReconcile,
  rebarBarKey,
  MaterialMatchProfile
} from './sameMaterialMatcher';

export { buildStrictOriginalMaterialSignature } from './sameMaterialMatcher';
export type { StrictOriginalMaterialSignature } from './sameMaterialMatcher';

export type PreApprovalStatus =
  | 'ONAYLANABİLİR'
  | 'İNDİRİM TALEP EDİLMELİ'
  | 'YÖNETİCİ İNCELEMESİ GEREKLİ'
  | 'KARŞILAŞTIRILABİLİR KAYIT YOK'
  | 'DÜŞÜK GÜVENLİ EŞLEŞME';

export type ComparisonLevel =
  | 'LEVEL_1_SAME_VARIANT'       // 1. Aynı malzeme ve aynı teknik varyant (çap, kalite, ölçü tam eşleşme)
  | 'LEVEL_2_SAME_SUPPLIER'      // 2. Aynı tedarikçiden geçmiş alımlar
  | 'LEVEL_3_OTHER_SUPPLIERS'    // 3. Diğer tedarikçilerden geçmiş alımlar
  | 'LEVEL_4_OTHER_JOBSITES'     // 4. Diğer şantiyelerdeki geçmiş alımlar
  | 'NONE';

export interface HistoricalPricePoint {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  supplier: string;
  jobsiteId?: string;
  jobsiteName?: string;
  rawMaterialName: string;
  canonicalName: string;
  rawUnitPrice: number;
  normalizedUnitPrice: number; // Normalized to draft item's unit, currency and net VAT
  unit: string;
  quantity: number;
  currency: string;
  isVatIncluded?: boolean;
  matchScore: number;
  comparisonLevel: ComparisonLevel;
  specs: Record<string, string | undefined>;
}

export interface LineAuditResult {
  lineIndex: number;
  draftItem: {
    materialName: string;
    originalName?: string;
    category?: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    currency: string;
    isVatIncluded?: boolean;
    taxRate?: number;
    supplier?: string;
    jobsiteId?: string;
    brand?: string;
    diameter?: string;
    grade?: string;
    dimensions?: string;
    /** KDV hariç birim fiyat (belgeden) */
    unitPriceNet?: number;
    vatPercentage?: number;
    /** false: satır belgeyle doğrulanamadı (miktar × fiyat ≠ tutar ya da toplam tutmuyor) */
    lineVerified?: boolean;
  };
  processed: ProcessedItemResult;
  normalizedDraftUnitPrice: number; // Excl. VAT / standard currency
  
  // Historical Benchmark Statistics
  hasHistoricalMatch: boolean;
  matchConfidence: number; // 0.00 - 1.00
  comparisonLevel: ComparisonLevel;
  
  bestHistoricalMatch?: HistoricalPricePoint;
  allHistoricalMatches: HistoricalPricePoint[];
  minHistoricalPrice: number;
  maxHistoricalPrice: number;
  avgHistoricalPrice: number;
  lastHistoricalPrice: number;
  historicalPurchasesCount: number;
  
  // Variance
  absolutePriceDiff: number; // current - bestPast (RUB)
  percentagePriceDiff: number; // ((current - bestPast) / bestPast) * 100
  potentialSavings: number; // absolutePriceDiff * quantity
  
  // Decision & Alerts
  status: PreApprovalStatus;
  statusColor: 'green' | 'amber' | 'rose' | 'slate' | 'orange';
  decisionReasoning: string;
  
  // Specialized Context Badges
  isSingleVendor: boolean;
  isUrgentPurchase: boolean;
  isLowConfidence: boolean;
  isScopeChange: boolean;
  isCheaperPastPurchaseAvailable: boolean;
  
  // Suggested Negotiation Action
  suggestedAction?: {
    recommendedTargetPrice: number;
    potentialDiscountAmount: number;
    negotiationScript: string;
  };

  // Mode 1 Original Invoice Signature & Mode 2 Cross-Brand Equivalent Economy Suggestion
  smartSignature?: SmartOriginalInvoiceSignature;
  crossBrandEconomySuggestion?: ReturnType<typeof findCheaperEquivalentBrandSuggestion>;
}

export interface InvoiceAuditSummary {
  invoiceNumber?: string;
  supplier?: string;
  jobsiteId?: string;
  date?: string;
  totalAmount: number;
  currency: string;
  
  overallStatus: PreApprovalStatus;
  overallStatusColor: 'green' | 'amber' | 'rose' | 'slate' | 'orange';
  overallConfidenceScore: number;
  overallReasoning: string;
  
  totalItemsCount: number;
  approvableItemsCount: number;
  discountRecommendedItemsCount: number;
  managerReviewRequiredItemsCount: number;
  noHistoryItemsCount: number;
  lowConfidenceItemsCount: number;
  
  totalPotentialSavings: number;
  maxPriceIncreasePercentage: number;
  flaggedItemsCount: number;
  
  // Special warning flags
  hasSingleVendorAlert: boolean;
  hasUrgentPurchaseAlert: boolean;
  hasCheaperPastPurchases: boolean;
  requiresMandatoryJustification: boolean;
  
  lineResults: LineAuditResult[];
  auditTimestamp: string;
}

// Currency conversion baseline (if differing currencies are detected)
const CURRENCY_RATES_TO_RUB: Record<string, number> = {
  RUB: 1.0,
  RUR: 1.0,
  USD: 92.5,
  EUR: 100.2,
  TRY: 2.85,
  TL: 2.85,
  CNY: 12.8
};

/**
 * Normalizes price to net RUB (excl. VAT if known or harmonized)
 */
export function normalizePriceForComparison(
  price: number,
  currency: string = 'RUB',
  isVatIncluded: boolean = false,
  taxRate: number = 20
): number {
  if (!price || price <= 0) return 0;
  const curr = (currency || 'RUB').toUpperCase();
  const rate = CURRENCY_RATES_TO_RUB[curr] || 1.0;
  let rubPrice = price * rate;
  
  // If comparing KDV dahil vs KDV hariç, normalize to net (KDV hariç)
  if (isVatIncluded && taxRate > 0) {
    rubPrice = rubPrice / (1 + taxRate / 100);
  }
  return Math.round(rubPrice * 100) / 100;
}

/**
 * Kıyaslama tabanı: %22 KDV DAHİL birim fiyat (Berkant kararı, 2026-10-18; bkz. vatBasis.ts).
 * Sunucudan gelen arşiv kalemlerinde unitPrice bazen net, bazen brüt tutulur; tek doğru taban
 * unitPriceNet × KDV çarpanıdır. Net bilgisi olmayan (taslak) satırda unitPrice faturadaki KDV dahil fiyattır.
 */
export function comparisonGrossUnitPrice(item: { unitPrice?: number; unitPriceNet?: number; vatPercentage?: number; grossUnitPrice?: number; isGrossInvoicePrice?: boolean } | null | undefined): number {
  if (!item) return 0;
  const net = Number(item.unitPriceNet) || 0;
  const grossStored = Number(item.grossUnitPrice) || 0;
  // %22'lik satırın belgedeki KDV dahil fiyatı zaten tabandır (net'ten geri hesaplamak kuruş kaydırır).
  if (Number(item.vatPercentage) === 22 && grossStored > 0) return Number(grossStored.toFixed(2));
  if (net > 0 && item.vatPercentage !== undefined && item.vatPercentage !== null) {
    return Number((net * comparisonMultiplierForVat(item.vatPercentage)).toFixed(2));
  }
  const gross = Number(item.grossUnitPrice) || 0;
  if (gross > 0) return Number(gross.toFixed(2));
  return Number((Number(item.unitPrice) || 0).toFixed(2));
}

/** Satır kendi içinde tutarlı mı (miktar × birim fiyat ≈ satır tutarı)? Tutar yoksa kontrol edilemez → true. */
export function isLineArithmeticConsistent(item: { quantity?: number; unitPrice?: number; totalPrice?: number; discountAmount?: number }): boolean {
  const qty = Number(item.quantity) || 0;
  const price = Number(item.unitPrice) || 0;
  const total = Number(item.totalPrice) || 0;
  if (!(qty > 0 && price > 0 && total > 0)) return true;
  const expected = qty * price - (Number(item.discountAmount) || 0);
  return Math.abs(expected - total) <= Math.max(1, total * 0.01);
}

const cleanDocNo = (v: string | undefined): string => cleanDocumentNumber(v);

/**
 * Checks whether two sets of technical specs match or conflict.
 * If diameter or grade or thickness conflict, returns false.
 */
export function areTechnicalSpecsCompatible(
  specA: Record<string, string | undefined>,
  specB: Record<string, string | undefined>
): { compatible: boolean; specMatchScore: number; reason?: string } {
  // 1. Diameter check
  if (specA.diameter && specB.diameter) {
    const cleanA = specA.diameter.replace(/[^\d.]/g, '');
    const cleanB = specB.diameter.replace(/[^\d.]/g, '');
    if (cleanA && cleanB && cleanA !== cleanB) {
      return { compatible: false, specMatchScore: 0, reason: `Çap uyuşmazlığı: ${specA.diameter} vs ${specB.diameter}` };
    }
  }

  // 2. Grade check (e.g. A500C vs A400 or B25 vs B30)
  if (specA.grade && specB.grade) {
    const cleanA = specA.grade.toUpperCase().replace(/\s+/g, '');
    const cleanB = specB.grade.toUpperCase().replace(/\s+/g, '');
    if (cleanA && cleanB && cleanA !== cleanB) {
      return { compatible: false, specMatchScore: 0, reason: `Kalite/Sınıf uyuşmazlığı: ${specA.grade} vs ${specB.grade}` };
    }
  }

  // 3. Dimensions / thickness check (e.g. 18mm vs 21mm plywood)
  if (specA.dimensions && specB.dimensions) {
    const cleanA = specA.dimensions.replace(/\s+/g, '').toLowerCase();
    const cleanB = specB.dimensions.replace(/\s+/g, '').toLowerCase();
    if (cleanA && cleanB && cleanA !== cleanB) {
      return { compatible: false, specMatchScore: 0.2, reason: `Ölçü/Boyut uyuşmazlığı: ${specA.dimensions} vs ${specB.dimensions}` };
    }
  }

  let score = 0.92;
  if (specA.diameter && specB.diameter) score += 0.04;
  if (specA.grade && specB.grade) score += 0.04;

  return { compatible: true, specMatchScore: Math.min(score, 1.0) };
}

export interface PreApprovalAuditOptions {
  /** Denetlenen faturanın numarası: arşivdeki aynı faturayla kendini kıyaslamayı önler */
  draftInvoiceNumber?: string;
  /** Denetlenen faturanın tarihi: bundan sonraki alımlar "daha önce alınmış" sayılmaz */
  draftDate?: string;
  isUrgent?: boolean;
  isUrgentPurchase?: boolean;
  isSingleVendor?: boolean;
  isScopeChange?: boolean;
}

// ============================================================================
// ORTAK GEÇMİŞ ALIM İNDEKSİ (Ön Onay, İndirim Ön Denetimi ve Yönetici Denetimi aynı kuralları kullanır)
// ============================================================================

export type HistoricalSourceType = 'GES_ARCHIVE' | 'PRIZMA_ERP';

interface HistoricalPriceEntry {
  inv: InvoiceRecord;
  pastIt: any;
  profile: MaterialMatchProfile;
  rebarKey: string;
  /** %22 KDV dahil, faturada kayıtlı birim fiyat */
  grossUnitPrice: number;
  unit: string;
  quantity: number;
  date: string;
  supplier: string;
  cleanInvNo: string;
  sourceType: HistoricalSourceType;
}

interface HistoricalPriceIndex {
  entries: HistoricalPriceEntry[];
  byExactKey: Map<string, HistoricalPriceEntry[]>;
  byStem: Map<string, HistoricalPriceEntry[]>;
  byRebarKey: Map<string, HistoricalPriceEntry[]>;
}

const HISTORICAL_PRICE_INDEX_CACHE = new WeakMap<InvoiceRecord[], HistoricalPriceIndex>();

function isPrizmaInvoice(inv: any): boolean {
  return Boolean(
    inv?.sourceCollection === 'prizma_invoices' ||
    String(inv?.id || '').startsWith('prizma_') ||
    (inv?.prizmaProcessId && !inv?.uploadedBySupervisorId)
  );
}

/**
 * Fatura kalemleri belgeyle doğrulanamamışsa (okuma hatası şüphesi) o faturanın fiyatları referans olamaz.
 * İndirim kaydından senkronlanan faturalarda kalemler fatura toplamını vermiyorsa kalem fiyatları
 * ödenen fiyat değildir (ilk teklif veya dağıtılmış tutar) ve referans alınmaz.
 */
export function isTrustedPriceSourceInvoice(inv: any): boolean {
  if (!inv || inv.isDeleted || !Array.isArray(inv.items) || inv.items.length === 0) return false;
  if (inv.linesReconciled === false) return false;
  const lineCheckStatus = typeof inv.lineCheck === 'string' ? inv.lineCheck : inv.lineCheck?.status;
  if (lineCheckStatus === 'mismatch') return false;
  const isDiscountCopy = /^inv_(?:sync|cmp)_/.test(String(inv.id || '')) || Boolean(inv.discountId);
  if (isDiscountCopy) {
    const total = Number(inv.totalAmount) || 0;
    const linesGross = inv.items.reduce((s: number, it: any) => s + (Number(it?.quantity) || 0) * comparisonGrossUnitPrice(it), 0);
    if (!amountsReconcile(linesGross, total)) return false;
  }
  return true;
}

/** İndirim kaydının kalem fiyatları gerçekten ödenen (son anlaşılan) fiyat mı? */
export function discountLinesArePaidPrices(disc: any): boolean {
  const items = Array.isArray(disc?.items) ? disc.items : [];
  if (items.length === 0) return false;
  const agreed = Number(disc.agreedPrice) || 0;
  const sum = items.reduce((s: number, it: any) => s + (Number(it?.quantity) || 0) * comparisonGrossUnitPrice(it), 0);
  return amountsReconcile(sum, agreed);
}

function isTrustedPriceLine(item: any): boolean {
  if (!item) return false;
  if (item.lineVerified === false) return false;
  return isLineArithmeticConsistent(item);
}

function pushTo<K>(map: Map<K, HistoricalPriceEntry[]>, key: K, entry: HistoricalPriceEntry) {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

function getOrBuildHistoricalPriceIndex(historicalInvoices: InvoiceRecord[]): HistoricalPriceIndex {
  const cached = HISTORICAL_PRICE_INDEX_CACHE.get(historicalInvoices);
  if (cached) return cached;

  const index: HistoricalPriceIndex = { entries: [], byExactKey: new Map(), byStem: new Map(), byRebarKey: new Map() };
  const seenPurchases = new Set<string>();

  for (const inv of historicalInvoices || []) {
    if (!isTrustedPriceSourceInvoice(inv)) continue;
    const sourceType: HistoricalSourceType = isPrizmaInvoice(inv) ? 'PRIZMA_ERP' : 'GES_ARCHIVE';
    const supplier = String(inv.supplier || (inv as any).vendorName || '').trim();
    const date = inv.date || (inv as any).createdAt || '';
    const cleanInvNo = cleanDocumentNumber(inv.invoiceNumber || inv.invoiceNo);

    for (const pastIt of inv.items) {
      if (!isTrustedPriceLine(pastIt)) continue;
      const grossUnitPrice = comparisonGrossUnitPrice(pastIt as any);
      if (!(grossUnitPrice > 0)) continue;
      const profile = buildMaterialMatchProfile({
        originalName: pastIt.originalName,
        materialName: pastIt.materialName,
        brand: (pastIt as any).brand,
        category: pastIt.category || inv.category
      });
      if (!profile) continue;

      const quantity = Number(pastIt.quantity) || 0;
      // Aynı alım hem GES Arşivinde hem Prizma ERP'de (veya indirim kopyasında) olabilir: tek kez say
      const purchaseKey = `${vendorKeyForMatching(supplier)}|${parsePurchaseDate(date) ?? date}|${profile.sig.exactKey}|${quantity}|${grossUnitPrice.toFixed(2)}`;
      const docKey = cleanInvNo ? `${cleanInvNo}|${profile.sig.exactKey}|${quantity}|${grossUnitPrice.toFixed(2)}` : '';
      if (seenPurchases.has(purchaseKey) || (docKey && seenPurchases.has(docKey))) continue;
      seenPurchases.add(purchaseKey);
      if (docKey) seenPurchases.add(docKey);

      const entry: HistoricalPriceEntry = {
        inv,
        pastIt,
        profile,
        rebarKey: rebarBarKey(profile),
        grossUnitPrice,
        unit: pastIt.unit || 'adet',
        quantity,
        date,
        supplier,
        cleanInvNo,
        sourceType
      };
      index.entries.push(entry);
      pushTo(index.byExactKey, profile.sig.exactKey, entry);
      for (const stem of profile.sig.stems) pushTo(index.byStem, stem, entry);
      if (entry.rebarKey) pushTo(index.byRebarKey, entry.rebarKey, entry);
    }
  }

  HISTORICAL_PRICE_INDEX_CACHE.set(historicalInvoices, index);
  return index;
}

export interface SameMaterialHistoryContext {
  supplier?: string;
  jobsiteId?: string;
  /** Kıyaslanan kaydın tarihi: bundan SONRA yapılmış alımlar "daha önce alınmış" sayılmaz */
  date?: string;
  invoiceNo?: string;
  excludeInvoiceId?: string;
  excludeDiscountId?: string;
}

export interface SameMaterialHistoryMatch {
  entry: HistoricalPriceEntry;
  /** Taslak satırın biriminde, %22 KDV dahil gerçek fiyat (yalnızca kesin metrik dönüşüm) */
  comparablePrice: number;
  /** Taslak birimine çevrilmiş miktar */
  comparableQuantity: number;
  exact: boolean;
}

/**
 * Bir satır için aynı malzemenin geçmiş gerçek alım fiyatlarını bulur. Tek ortak kural:
 * aynı malzeme (compareMaterialProfiles), aynı/kesin çevrilebilir birim, kayıttan önce yapılmış alım,
 * aynı faturanın kopyası değil, makul fiyat oranı (≤3x).
 */
export function findSameMaterialHistory(
  item: { originalName?: string; materialName?: string; brand?: string; category?: string; unit?: string; quantity?: number },
  currentUnitPrice: number,
  context: SameMaterialHistoryContext,
  historicalInvoices: InvoiceRecord[]
): SameMaterialHistoryMatch[] {
  if (!Array.isArray(historicalInvoices) || historicalInvoices.length === 0) return [];
  const profile = buildMaterialMatchProfile(item);
  if (!profile) return [];
  const index = getOrBuildHistoricalPriceIndex(historicalInvoices);

  // Aday havuzu: birebir aynı metin + aynı ürün adını paylaşan kayıtlar + aynı donatı çapı/sınıfı
  const candidates = new Set<HistoricalPriceEntry>(index.byExactKey.get(profile.sig.exactKey) || []);
  const rebarKey = rebarBarKey(profile);
  if (rebarKey) for (const e of index.byRebarKey.get(rebarKey) || []) candidates.add(e);
  const rarestStem = [...profile.sig.stems]
    .map(s => index.byStem.get(s) || [])
    .sort((a, b) => a.length - b.length)[0];
  for (const e of rarestStem || []) candidates.add(e);
  // En nadir kök ortak değilse diğer köklerden de aday ekle (yazım farkı ön elemesi compareMaterialProfiles'ta)
  for (const s of profile.sig.stems) {
    const list = index.byStem.get(s);
    if (list && list.length <= 400) for (const e of list) candidates.add(e);
  }

  const cleanCtxNo = cleanDocumentNumber(context.invoiceNo);
  const excludeInvId = context.excludeInvoiceId || (context.excludeDiscountId ? `inv_sync_${context.excludeDiscountId}` : '');
  const excludeDiscId = context.excludeDiscountId || '';
  const currentQty = Number(item.quantity) || 0;
  const matches: SameMaterialHistoryMatch[] = [];

  for (const cand of candidates) {
    // Kendi kopyasıyla kıyas yapılmaz
    if (excludeInvId && cand.inv.id === excludeInvId) continue;
    if (excludeDiscId && (cand.inv as any).discountId === excludeDiscId) continue;
    if (cleanCtxNo && cand.cleanInvNo && cand.cleanInvNo === cleanCtxNo) continue;
    if (isSamePurchaseCopy({ supplier: context.supplier, date: context.date, quantity: currentQty }, cand)) continue;
    // Sonraki alım "daha önce alınmış" referansı olamaz
    if (isPurchaseAfter(cand.date, context.date)) continue;

    const verdict = compareMaterialProfiles(profile, cand.profile);
    if (!verdict.same) continue;

    const comparablePrice = convertUnitPriceStrict(cand.grossUnitPrice, cand.unit, item.unit);
    if (comparablePrice === null || !(comparablePrice > 0)) continue;
    if (currentUnitPrice > 0 && !isPlausibleSameMaterialPriceRatio(currentUnitPrice, comparablePrice)) continue;

    const comparableQuantity = comparablePrice !== cand.grossUnitPrice && comparablePrice > 0
      ? Number(((cand.quantity * cand.grossUnitPrice) / comparablePrice).toFixed(3))
      : cand.quantity;
    matches.push({ entry: cand, comparablePrice: Number(comparablePrice.toFixed(2)), comparableQuantity, exact: verdict.exact });
  }

  return matches.sort((a, b) => a.comparablePrice - b.comparablePrice);
}

function historicalSupplierLabel(entry: HistoricalPriceEntry): string {
  const base = String(entry.supplier || (entry.sourceType === 'PRIZMA_ERP' ? 'Prizma Tedarikçisi' : 'Geçmiş Tedarikçi'))
    .replace(/\s*\(Prizma ERP\)\s*$/, '')
    .trim();
  return entry.sourceType === 'PRIZMA_ERP' ? `${base} (Prizma ERP)` : base;
}

/**
 * Audits a single line item against historical approved invoices and Prizma ERP records
 * using the shared same-material matcher (sameMaterialMatcher.ts).
 */
export function auditSingleLineItem(
  draftItem: LineAuditResult['draftItem'],
  lineIndex: number,
  historicalInvoices: InvoiceRecord[],
  options?: PreApprovalAuditOptions
): LineAuditResult {
  const processed = processItem({
    materialName: draftItem.materialName,
    originalName: draftItem.originalName,
    category: draftItem.category,
    unit: draftItem.unit,
    quantity: draftItem.quantity,
    unitPrice: draftItem.unitPrice,
    totalPrice: draftItem.totalPrice,
    brand: draftItem.brand,
    dimensions: draftItem.dimensions,
    diameter: draftItem.diameter,
    grade: draftItem.grade
  });

  const draftSpecs = extractTechnicalSpecs(`${draftItem.materialName} ${draftItem.originalName || ''} ${draftItem.dimensions || ''} ${draftItem.diameter || ''}`);
  if (draftItem.diameter && !draftSpecs.diameter) draftSpecs.diameter = draftItem.diameter;
  if (draftItem.grade && !draftSpecs.grade) draftSpecs.grade = draftItem.grade;
  if (draftItem.dimensions && !draftSpecs.dimensions) draftSpecs.dimensions = draftItem.dimensions;

  // Taslak satırın kıyas fiyatı: geçmiş kayıtlarla aynı taban (%22 KDV dahil birim fiyat, comparisonGrossUnitPrice);
  // KDV bilgisi yoksa faturadaki birim fiyat olduğu gibi alınır. Yalnızca para birimi çevrilir.
  // Taslakta unitPrice faturadaki KDV dahil fiyattır; yalnızca %20'lik faturalar %22 tabanına taşınır.
  const draftBasisPrice = Number(draftItem.vatPercentage) === 20 && Number(draftItem.unitPriceNet) > 0
    ? comparisonGrossUnitPrice({ unitPriceNet: draftItem.unitPriceNet, vatPercentage: 20 })
    : draftItem.unitPrice;
  const normalizedDraftUnitPrice = normalizePriceForComparison(
    draftBasisPrice,
    draftItem.currency,
    false
  );

  const draftSupplier = (draftItem.supplier || '').trim();
  const draftSupplierKey = vendorKeyForMatching(draftSupplier);
  const draftJobsiteId = draftItem.jobsiteId || '';

  const draftSig = buildSmartOriginalSignature({
    originalName: draftItem.originalName,
    materialName: draftItem.materialName,
    category: draftItem.category,
    unit: draftItem.unit,
    unitPrice: draftItem.unitPrice
  });

  const crossBrandEconomySuggestion = undefined;

  const strictSig = buildStrictOriginalMaterialSignature({
    originalName: draftItem.originalName,
    materialName: draftItem.materialName,
    brand: draftItem.brand
  });
  if (strictSig?.techVariant) {
    const badgeStr = formatTechnicalVariantBadges(strictSig.techVariant);
    if (badgeStr && !processed.canonicalName.includes(badgeStr)) {
      processed.canonicalName = `${processed.canonicalName.replace(/\s*\(1\.\s*Sınıf\s*GOST\)/gi, '')} ${badgeStr}`.trim();
    }
  }

  const sameMaterialMatches = findSameMaterialHistory(
    draftItem,
    normalizedDraftUnitPrice,
    {
      supplier: draftItem.supplier,
      jobsiteId: draftItem.jobsiteId,
      date: options?.draftDate,
      invoiceNo: options?.draftInvoiceNumber
    },
    historicalInvoices
  );

  const candidateHistoricalMatches: HistoricalPricePoint[] = [];
  for (const m of sameMaterialMatches) {
    const { entry } = m;
    const inv = entry.inv;
    const normalizedPastUnitPrice = normalizePriceForComparison(m.comparablePrice, (inv as any).currency || 'RUB', false);
    if (!(normalizedPastUnitPrice > 0)) continue;

    const candSupplierKey = vendorKeyForMatching(entry.supplier);
    const isSameSupplier = Boolean(draftSupplierKey && candSupplierKey && draftSupplierKey === candSupplierKey);
    const invJobsiteId = inv.jobsiteId || '';
    const isSameJobsite = Boolean(draftJobsiteId && invJobsiteId && draftJobsiteId === invJobsiteId);
    const level: ComparisonLevel = isSameSupplier
      ? 'LEVEL_2_SAME_SUPPLIER'
      : (!isSameJobsite ? 'LEVEL_4_OTHER_JOBSITES' : 'LEVEL_3_OTHER_SUPPLIERS');

    candidateHistoricalMatches.push({
      invoiceId: inv.id || '',
      invoiceNumber: inv.invoiceNumber || inv.invoiceNo || (entry.sourceType === 'PRIZMA_ERP' ? 'PRIZMA-ERP' : 'FT-GECMIS'),
      date: entry.date,
      supplier: historicalSupplierLabel(entry),
      jobsiteId: invJobsiteId,
      jobsiteName: inv.jobsiteName || (inv as any).prizmaJobsite || 'Bilinmeyen Şantiye',
      rawMaterialName: entry.profile.sig.rawOriginalText,
      canonicalName: processed.canonicalName,
      rawUnitPrice: entry.grossUnitPrice,
      normalizedUnitPrice: normalizedPastUnitPrice,
      unit: draftItem.unit,
      quantity: m.comparableQuantity,
      currency: 'RUB',
      isVatIncluded: true,
      matchScore: m.exact ? 1.0 : 0.95,
      comparisonLevel: level,
      specs: draftSpecs
    });
  }

  // 3. Analyze Historical Matches
  if (candidateHistoricalMatches.length === 0) {
    return {
      lineIndex,
      draftItem,
      processed,
      normalizedDraftUnitPrice,
      hasHistoricalMatch: false,
      matchConfidence: 0.0,
      comparisonLevel: 'NONE',
      allHistoricalMatches: [],
      minHistoricalPrice: 0,
      maxHistoricalPrice: 0,
      avgHistoricalPrice: 0,
      lastHistoricalPrice: 0,
      historicalPurchasesCount: 0,
      absolutePriceDiff: 0,
      percentagePriceDiff: 0,
      potentialSavings: 0,
      status: 'KARŞILAŞTIRILABİLİR KAYIT YOK',
      statusColor: 'slate',
      decisionReasoning: 'Bu malzemenin aynısı (aynı marka, model ve tüm ölçü/teknik özellikler, aynı birim) için sistemde belgeyle doğrulanmış geçmiş alım kaydı bulunamadı. Farklı marka veya özellikteki malzemelerle kıyaslama yapılmaz.',
      isSingleVendor: !!options?.isSingleVendor,
      isUrgentPurchase: !!options?.isUrgentPurchase,
      isLowConfidence: false,
      isScopeChange: !!options?.isScopeChange,
      isCheaperPastPurchaseAvailable: false,
      smartSignature: draftSig,
      crossBrandEconomySuggestion
    };
  }

  // Sort matches by lowest comparable price first
  candidateHistoricalMatches.sort((a, b) => a.normalizedUnitPrice - b.normalizedUnitPrice);

  const bestMatch = candidateHistoricalMatches[0];
  const prices = candidateHistoricalMatches.map(m => m.normalizedUnitPrice);
  const minHistoricalPrice = Math.min(...prices);
  const maxHistoricalPrice = Math.max(...prices);
  const avgHistoricalPrice = Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100;
  
  // Last historical purchase by date
  const sortedByDate = [...candidateHistoricalMatches].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastHistoricalPrice = sortedByDate[0].normalizedUnitPrice;

  // Compute variance against the MINIMUM historical price (require >= 1.0% difference to flag anomaly)
  const rawPriceDiff = Math.round((normalizedDraftUnitPrice - minHistoricalPrice) * 100) / 100;
  const rawPctDiff = minHistoricalPrice > 0
    ? Math.round(((normalizedDraftUnitPrice - minHistoricalPrice) / minHistoricalPrice) * 1000) / 10
    : 0;
  const isCheaperPastPurchaseAvailable = rawPriceDiff > 0.01 && rawPctDiff >= 1.0;
  const absolutePriceDiff = isCheaperPastPurchaseAvailable ? rawPriceDiff : 0;
  const percentagePriceDiff = isCheaperPastPurchaseAvailable ? rawPctDiff : 0;
  const potentialSavings = isCheaperPastPurchaseAvailable ? Math.round(rawPriceDiff * (draftItem.quantity || 1)) : 0;

  // Eşleşmeler ortak eşleştiriciden geçti (aynı marka/model/özellik); güven düşük değildir
  const isLowConfidence = false;

  // Determine Line Status
  let status: PreApprovalStatus = 'ONAYLANABİLİR';
  let statusColor: LineAuditResult['statusColor'] = 'green';
  let decisionReasoning = '';

  if (isCheaperPastPurchaseAvailable) {
    if (percentagePriceDiff >= 15 || potentialSavings >= 100000) {
      status = 'YÖNETİCİ İNCELEMESİ GEREKLİ';
      statusColor = 'rose';
      decisionReasoning = `⚠️ Yüksek Fiyat Artışı (%${percentagePriceDiff}): Aynı malzeme (${bestMatch.rawMaterialName}) daha önce ${bestMatch.date} tarihinde ${bestMatch.supplier} firmasından (Fatura No: ${bestMatch.invoiceNumber}) ${minHistoricalPrice.toLocaleString('tr-TR')} RUB birim fiyatla alınmıştı. Toplam ${potentialSavings.toLocaleString('tr-TR')} RUB ek maliyet riski bulunmaktadır.`;
    } else {
      status = 'İNDİRİM TALEP EDİLMELİ';
      statusColor = 'amber';
      decisionReasoning = `Aynı malzeme (${bestMatch.rawMaterialName}) daha önce daha düşük fiyata alınmış (${bestMatch.date} / ${bestMatch.supplier} / Fatura No: ${bestMatch.invoiceNumber} - ${minHistoricalPrice.toLocaleString('tr-TR')} RUB). Satınalmacının tedarikçiden en az %${percentagePriceDiff} indirim talep etmesi önerilir.`;
    }
  } else {
    status = 'ONAYLANABİLİR';
    statusColor = 'green';
    decisionReasoning = `Birim fiyat (${normalizedDraftUnitPrice.toLocaleString('tr-TR')} RUB), geçmiş en iyi fiyatla (${minHistoricalPrice.toLocaleString('tr-TR')} RUB - Fatura No: ${bestMatch.invoiceNumber}) uyumlu veya daha avantajlıdır.`;
  }

  // Suggested negotiation action
  let suggestedAction: LineAuditResult['suggestedAction'];
  if (isCheaperPastPurchaseAvailable) {
    suggestedAction = {
      recommendedTargetPrice: minHistoricalPrice,
      potentialDiscountAmount: potentialSavings,
      negotiationScript: `Sayın ${draftItem.supplier || 'Tedarikçi'}, ${draftItem.materialName} kalemi için teklif edilen ${draftItem.unitPrice} birim fiyat, projemiz geçmiş alım referansımızın (${minHistoricalPrice} RUB) %${percentagePriceDiff} üzerindedir. Fiyatın revize edilmesini rica ederiz.`
    };
  }

  // Taslak satır belgeyle doğrulanamadıysa (okuma hatası şüphesi) fiyat farkı iddia edilmez.
  if (draftItem.lineVerified === false || !isLineArithmeticConsistent(draftItem)) {
    status = 'DÜŞÜK GÜVENLİ EŞLEŞME';
    statusColor = 'orange';
    decisionReasoning = `Bu satırın fiyatı belgeden doğrulanamadı (miktar × birim fiyat satır tutarını veya kalem toplamı fatura toplamını vermiyor). Fark iddiası yapılmadı; faturadaki rakamları kontrol edin. Geçmiş en iyi fiyat: ${minHistoricalPrice.toLocaleString('tr-TR')} RUB.`;
    suggestedAction = undefined;
  }
  const draftUnverified = status === 'DÜŞÜK GÜVENLİ EŞLEŞME' && (draftItem.lineVerified === false || !isLineArithmeticConsistent(draftItem));

  return {
    lineIndex,
    draftItem,
    processed,
    normalizedDraftUnitPrice,
    hasHistoricalMatch: true,
    matchConfidence: bestMatch.matchScore,
    comparisonLevel: bestMatch.comparisonLevel,
    bestHistoricalMatch: bestMatch,
    allHistoricalMatches: candidateHistoricalMatches,
    minHistoricalPrice,
    maxHistoricalPrice,
    avgHistoricalPrice,
    lastHistoricalPrice,
    historicalPurchasesCount: candidateHistoricalMatches.length,
    absolutePriceDiff: draftUnverified ? 0 : absolutePriceDiff,
    percentagePriceDiff: draftUnverified ? 0 : percentagePriceDiff,
    potentialSavings: draftUnverified ? 0 : potentialSavings,
    status,
    statusColor,
    decisionReasoning,
    isSingleVendor: !!options?.isSingleVendor,
    isUrgentPurchase: !!options?.isUrgentPurchase,
    isLowConfidence: isLowConfidence || draftUnverified,
    isScopeChange: !!options?.isScopeChange,
    isCheaperPastPurchaseAvailable: draftUnverified ? false : isCheaperPastPurchaseAvailable,
    suggestedAction,
    smartSignature: draftSig,
    crossBrandEconomySuggestion
  };
}

/**
 * Audits an entire draft invoice against historical records.
 */
export function auditEntireInvoice(
  draftInvoice: {
    invoiceNumber?: string;
    supplier?: string;
    jobsiteId?: string;
    date?: string;
    totalAmount?: number;
    currency?: string;
    items: LineAuditResult['draftItem'][];
  },
  historicalInvoices: InvoiceRecord[],
  options?: PreApprovalAuditOptions
): InvoiceAuditSummary {
  const lineResults: LineAuditResult[] = (draftInvoice.items || []).map((item, index) => {
    return auditSingleLineItem(
      {
        ...item,
        supplier: item.supplier || draftInvoice.supplier,
        jobsiteId: item.jobsiteId || draftInvoice.jobsiteId,
        currency: item.currency || draftInvoice.currency || 'RUB'
      },
      index,
      historicalInvoices,
      {
        ...options,
        draftInvoiceNumber: options?.draftInvoiceNumber || draftInvoice.invoiceNumber,
        draftDate: options?.draftDate || draftInvoice.date
      }
    );
  });

  const totalItemsCount = lineResults.length;
  const approvableItemsCount = lineResults.filter(l => l.status === 'ONAYLANABİLİR').length;
  const discountRecommendedItemsCount = lineResults.filter(l => l.status === 'İNDİRİM TALEP EDİLMELİ').length;
  const managerReviewRequiredItemsCount = lineResults.filter(l => l.status === 'YÖNETİCİ İNCELEMESİ GEREKLİ').length;
  const noHistoryItemsCount = lineResults.filter(l => l.status === 'KARŞILAŞTIRILABİLİR KAYIT YOK').length;
  const lowConfidenceItemsCount = lineResults.filter(l => l.status === 'DÜŞÜK GÜVENLİ EŞLEŞME').length;

  const totalPotentialSavings = lineResults.reduce((acc, l) => acc + (l.potentialSavings || 0), 0);
  const maxPriceIncreasePercentage = lineResults.reduce((max, l) => Math.max(max, l.percentagePriceDiff || 0), 0);
  const flaggedItemsCount = discountRecommendedItemsCount + managerReviewRequiredItemsCount + lowConfidenceItemsCount;

  // Overall Status Resolution
  let overallStatus: PreApprovalStatus = 'ONAYLANABİLİR';
  let overallStatusColor: InvoiceAuditSummary['overallStatusColor'] = 'green';
  let overallReasoning = 'Fatura genelinde tüm kalemler geçmiş onaylı fiyatlarla uyumludur.';

  if (managerReviewRequiredItemsCount > 0 || options?.isSingleVendor || (options?.isUrgent && flaggedItemsCount > 0)) {
    overallStatus = 'YÖNETİCİ İNCELEMESİ GEREKLİ';
    overallStatusColor = 'rose';
    overallReasoning = `${managerReviewRequiredItemsCount} kalemde kritik fiyat artışı veya özel risk faktörü (Tek Tedarikçi / Acil Alım) tespit edildi. Yönetici onayı şarttır.`;
  } else if (discountRecommendedItemsCount > 0) {
    overallStatus = 'İNDİRİM TALEP EDİLMELİ';
    overallStatusColor = 'amber';
    overallReasoning = `${discountRecommendedItemsCount} kalemde daha önce daha ucuz fiyata alım yapıldığı tespit edildi. Toplam ${totalPotentialSavings.toLocaleString('tr-TR')} RUB potansiyel tasarruf için indirim istenmelidir.`;
  } else if (noHistoryItemsCount === totalItemsCount) {
    overallStatus = 'KARŞILAŞTIRILABİLİR KAYIT YOK';
    overallStatusColor = 'slate';
    overallReasoning = 'Faturadaki hiçbir malzeme için veritabanında geçmiş alım kaydı bulunmamaktadır. İlk alım olduğu için piyasa araştırması kontrol edilmelidir.';
  } else if (lowConfidenceItemsCount > 0 && approvableItemsCount === 0) {
    overallStatus = 'DÜŞÜK GÜVENLİ EŞLEŞME';
    overallStatusColor = 'orange';
    overallReasoning = 'Eşleşen kayıtlar düşük güven skoruna sahiptir. Satır kalemlerinin teknik özelliklerini kontrol ediniz.';
  }

  // Calculate Overall Confidence Score
  const confScores = lineResults.map(l => l.matchConfidence);
  const avgConf = confScores.length > 0 ? (confScores.reduce((a, b) => a + b, 0) / confScores.length) : 0;

  const hasCheaperPastPurchases = lineResults.some(l => l.isCheaperPastPurchaseAvailable);
  const requiresMandatoryJustification = hasCheaperPastPurchases && (discountRecommendedItemsCount > 0 || managerReviewRequiredItemsCount > 0);

  return {
    invoiceNumber: draftInvoice.invoiceNumber,
    supplier: draftInvoice.supplier,
    jobsiteId: draftInvoice.jobsiteId,
    date: draftInvoice.date,
    totalAmount: draftInvoice.totalAmount || lineResults.reduce((sum, it) => sum + (it.draftItem.totalPrice || 0), 0),
    currency: draftInvoice.currency || 'RUB',
    overallStatus,
    overallStatusColor,
    overallConfidenceScore: Number(avgConf.toFixed(2)),
    overallReasoning,
    totalItemsCount,
    approvableItemsCount,
    discountRecommendedItemsCount,
    managerReviewRequiredItemsCount,
    noHistoryItemsCount,
    lowConfidenceItemsCount,
    totalPotentialSavings,
    maxPriceIncreasePercentage,
    flaggedItemsCount,
    hasSingleVendorAlert: !!options?.isSingleVendor,
    hasUrgentPurchaseAlert: !!options?.isUrgentPurchase,
    hasCheaperPastPurchases,
    requiresMandatoryJustification,
    lineResults,
    auditTimestamp: new Date().toISOString()
  };
}

// ============================================================================
// KAYDETME ÖNCESİ / YÖNETİCİ DENETİMİ: DAHA UCUZ GEÇMİŞ ALIM
// ============================================================================

/**
 * Bir taslak faturanın veya indirim kaydının kalemleri için aynı malzemenin (aynı marka, model ve
 * teknik özellik) daha önce en az %1 daha ucuza alınıp alınmadığını ortak eşleştiriciyle kontrol eder.
 */
export function findCheaperHistoricalBenchmarksForItems(
  items: any[],
  context: {
    supplier?: string;
    jobsiteId?: string;
    invoiceNo?: string;
    orderDate?: string;
    excludeDiscountId?: string;
    excludeInvoiceId?: string;
  },
  historicalInvoices: InvoiceRecord[]
): import('../types').CheaperHistoricalBenchmark[] {
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(historicalInvoices) || historicalInvoices.length === 0) {
    return [];
  }

  const results: import('../types').CheaperHistoricalBenchmark[] = [];

  items.forEach((rawIt, idx) => {
    if (!rawIt) return;
    // Belgeyle doğrulanamayan satırda fiyat farkı iddia edilmez
    if (!isTrustedPriceLine(rawIt)) return;
    const currentUnitPrice = comparisonGrossUnitPrice(rawIt);
    const qty = Number(rawIt.quantity) || 1;
    if (currentUnitPrice <= 0 || qty <= 0) return;

    const validMatches = findSameMaterialHistory(
      rawIt,
      currentUnitPrice,
      {
        supplier: context.supplier,
        jobsiteId: context.jobsiteId,
        date: context.orderDate,
        invoiceNo: context.invoiceNo,
        excludeInvoiceId: context.excludeInvoiceId,
        excludeDiscountId: context.excludeDiscountId
      },
      historicalInvoices
    );
    if (validMatches.length === 0) return;

    const cheapest = validMatches[0];

    // Kullanıcı kuralı: en az %1 fark varsa göster
    if (currentUnitPrice < cheapest.comparablePrice * 1.01) return;

    const unitOverpayment = Number((currentUnitPrice - cheapest.comparablePrice).toFixed(2));
    const overpaymentPercentage = Number(((unitOverpayment / cheapest.comparablePrice) * 100).toFixed(1));
    if (unitOverpayment <= 0.01 || overpaymentPercentage < 1.0) return;

    const totalLineOverpayment = Number((unitOverpayment * qty).toFixed(2));
    const avgPrice = Number(
      (validMatches.reduce((s, m) => s + m.comparablePrice, 0) / validMatches.length).toFixed(2)
    );

    const bestInv = cheapest.entry.inv;
    const isPrizma = cheapest.entry.sourceType === 'PRIZMA_ERP';
    const rawSupplier = String(cheapest.entry.supplier || 'Geçmiş Tedarikçi')
      .replace(/\s*\(Prizma ERP\)\s*$/, '')
      .trim();

    const prizmaDemandId =
      (bestInv as any).prizmaDemandId ||
      (isPrizma && String(bestInv.id || '').startsWith('prizma_')
        ? String(bestInv.id).replace(/^prizma_/, '')
        : undefined);
    const lineCheckFileId = (bestInv as any).lineCheck?.fileId || (bestInv as any).invoiceFileId;
    const historicalFileUrl =
      bestInv.fileUrl ||
      (prizmaDemandId ? `/api/prizma/invoice-file/${prizmaDemandId}?type=schet` : undefined) ||
      (lineCheckFileId ? `/api/prizma/file/${lineCheckFileId}` : undefined);
    const historicalPrizmaUrl = (bestInv as any).prizmaBtfUrl || (bestInv as any).prizmaUrl || undefined;
    const sig = buildStrictOriginalMaterialSignature(rawIt);

    results.push({
      lineIndex: idx,
      materialName: rawIt.materialName || sig?.rawOriginalText || '',
      originalName: sig?.rawOriginalText || rawIt.originalName,
      historicalOriginalName: cheapest.entry.profile.sig.rawOriginalText,
      brand: rawIt.brand || (sig?.brand ? sig.brand.toUpperCase() : undefined),
      unit: rawIt.unit || 'Adet',
      quantity: qty,
      currentUnitPrice: Number(currentUnitPrice.toFixed(2)),
      historicalBestUnitPrice: Number(cheapest.comparablePrice.toFixed(2)),
      historicalAvgUnitPrice: avgPrice,
      historicalSupplier: rawSupplier,
      historicalJobsiteName: bestInv.jobsiteName || (bestInv as any).prizmaJobsite || 'Merkez / Şantiye',
      historicalDate: cheapest.entry.date || '-',
      historicalInvoiceNo: bestInv.invoiceNumber || bestInv.invoiceNo || '-',
      historicalInvoiceId: bestInv.id,
      historicalFileUrl,
      historicalPrizmaDemandId: prizmaDemandId,
      historicalPrizmaUrl,
      historicalSource: isPrizma ? 'PRIZMA_ERP' : 'GES_ARCHIVE',
      historicalPurchasesCount: validMatches.length,
      unitOverpayment,
      totalLineOverpayment,
      overpaymentPercentage,
      matchReason: cheapest.exact
        ? `Orijinal Rusça tanımı, markası, modeli ve tüm ölçü/teknik özellikleri birebir aynı olan bu malzeme ${rawSupplier} firmasından ${cheapest.comparablePrice.toLocaleString('tr-TR')} ₽ birim fiyata alınmıştır.`
        : `Aynı marka, model ve teknik özellikteki bu malzeme (faturada farklı yazımla: "${cheapest.entry.profile.sig.rawOriginalText}") ${rawSupplier} firmasından ${cheapest.comparablePrice.toLocaleString('tr-TR')} ₽ birim fiyata alınmıştır.`
    });
  });

  return results;
}

/**
 * Scans all DiscountRecord entries with the shared same-material matcher
 * to build the Admin-only "İndirimli Kayıtta Farklı Faturalar" invoice-level anomaly list.
 */
export function scanDiscountRecordsForHistoricalAnomalies(
  discounts: import('../types').DiscountRecord[],
  historicalInvoices: InvoiceRecord[]
): import('../types').DiscountHistoricalAnomalyRecord[] {
  if (!Array.isArray(discounts) || discounts.length === 0 || !Array.isArray(historicalInvoices) || historicalInvoices.length === 0) {
    return [];
  }

  const anomalyRecords: import('../types').DiscountHistoricalAnomalyRecord[] = [];

  for (const disc of discounts) {
    if (!disc || disc.isDeleted) continue;
    if (!Array.isArray(disc.items) || disc.items.length === 0) continue;
    // Kalemler son anlaşılan tutarı vermiyorsa (ilk teklif fiyatları ya da dağıtılmış tutar) ödenen fiyat bilinmez: iddia yok
    if (!discountLinesArePaidPrices(disc)) continue;

    // Always evaluate with the strict original-language (Russian) 100% exact matcher
    const affectedLines = findCheaperHistoricalBenchmarksForItems(
      disc.items,
      {
        supplier: disc.vendorName,
        jobsiteId: disc.jobsiteId,
        invoiceNo: disc.invoiceNo || disc.invoiceNumber,
        orderDate: disc.orderDate,
        excludeDiscountId: disc.id,
        excludeInvoiceId: `inv_sync_${disc.id}`
      },
      historicalInvoices
    );

    if (affectedLines.length === 0) continue;

    const totalPotentialExtraSavings = Number(
      affectedLines.reduce((sum, l) => sum + (Number(l.totalLineOverpayment) || 0), 0).toFixed(2)
    );
    if (totalPotentialExtraSavings <= 0) continue;

    const storedAlert = (disc as any).historicalBenchmarkAlert;
    const offerPrice = Number(disc.offerPrice) || 0;
    const agreedPrice = Number(disc.agreedPrice) || 0;
    const claimedDiscountAmount = Number(disc.discountAmount) || Math.max(0, offerPrice - agreedPrice);

    anomalyRecords.push({
      discountId: disc.id,
      recordSource: 'DISCOUNT_CENTER',
      invoiceNo: disc.invoiceNo || disc.invoiceNumber || '-',
      orderDate: disc.orderDate || '-',
      vendorName: disc.vendorName || 'Bilinmeyen Tedarikçi',
      jobsiteName: disc.jobsiteName || 'Belirtilmemiş Şantiye',
      supervisorId: disc.supervisorId || '',
      supervisorName: disc.supervisorName || 'Atanmamış',
      offerPrice,
      agreedPrice,
      claimedDiscountAmount,
      totalPotentialExtraSavings,
      buyerNotifiedBeforeSave: Boolean(storedAlert?.buyerNotifiedBeforeSave ?? true),
      notifiedAt: storedAlert?.notifiedAt || disc.created_at || disc.orderDate,
      firstOfferFileUrl: disc.firstOfferFileUrl,
      finalOfferFileUrl: disc.finalOfferFileUrl,
      affectedLines
    });
  }

  return anomalyRecords.sort((a, b) => b.totalPotentialExtraSavings - a.totalPotentialExtraSavings);
}

/**
 * Scans invoices uploaded directly via "AI Otomatik Fatura Okuma" (GES Archive `invoices`
 * that are NOT synced copies of `discounts`) using the exact same O(1) Strict Original-Language
 * (Russian-first) 100% exact material/brand/spec matcher.
 */
export function scanDirectInvoicesForHistoricalAnomalies(
  invoices: InvoiceRecord[],
  discounts: import('../types').DiscountRecord[],
  historicalInvoices: InvoiceRecord[]
): import('../types').DiscountHistoricalAnomalyRecord[] {
  if (!Array.isArray(invoices) || invoices.length === 0 || !Array.isArray(historicalInvoices) || historicalInvoices.length === 0) {
    return [];
  }

  const discountIds = new Set<string>();
  const discountInvNos = new Set<string>();
  for (const d of discounts || []) {
    if (!d || d.isDeleted) continue;
    if (d.id) discountIds.add(d.id);
    const cNo = cleanDocNo(d.invoiceNo || d.invoiceNumber);
    if (cNo) discountInvNos.add(cNo);
  }

  const anomalyRecords: import('../types').DiscountHistoricalAnomalyRecord[] = [];

  for (const inv of invoices) {
    if (!inv || inv.isDeleted) continue;
    if (!Array.isArray(inv.items) || inv.items.length === 0) continue;

    // Prizma ERP faturaları ve kalemleri belgeyle doğrulanamamış faturalar hariç
    if (isPrizmaInvoice(inv)) continue;
    if (!isTrustedPriceSourceInvoice(inv)) continue;

    // Exclude invoices that were synced from the Discount Center
    if (String(inv.id || '').startsWith('inv_sync_')) continue;
    if ((inv as any).discountId && discountIds.has((inv as any).discountId)) continue;
    const cleanNo = cleanDocNo(inv.invoiceNumber || inv.invoiceNo);
    if (cleanNo && discountInvNos.has(cleanNo)) continue;

    const affectedLines = findCheaperHistoricalBenchmarksForItems(
      inv.items,
      {
        supplier: inv.supplier || (inv as any).vendorName,
        jobsiteId: inv.jobsiteId,
        invoiceNo: inv.invoiceNumber || inv.invoiceNo,
        orderDate: inv.date,
        excludeInvoiceId: inv.id
      },
      historicalInvoices
    );

    if (affectedLines.length === 0) continue;

    const totalPotentialExtraSavings = Number(
      affectedLines.reduce((sum, l) => sum + (Number(l.totalLineOverpayment) || 0), 0).toFixed(2)
    );
    if (totalPotentialExtraSavings <= 0) continue;

    const totalAmount = Number(inv.totalAmount) || 0;

    anomalyRecords.push({
      discountId: `direct_${inv.id}`,
      invoiceId: inv.id,
      recordSource: 'DIRECT_INVOICE',
      invoiceNo: inv.invoiceNumber || inv.invoiceNo || '-',
      orderDate: inv.date || (inv as any).createdAt || '-',
      vendorName: inv.supplier || (inv as any).vendorName || 'Bilinmeyen Tedarikçi',
      jobsiteName: inv.jobsiteName || 'Belirtilmemiş Şantiye',
      supervisorId: inv.uploadedBySupervisorId || '',
      supervisorName: inv.uploadedBySupervisorName || 'Atanmamış',
      offerPrice: totalAmount,
      agreedPrice: totalAmount,
      claimedDiscountAmount: 0,
      totalPotentialExtraSavings,
      buyerNotifiedBeforeSave: true,
      notifiedAt: (inv as any).createdAt || inv.date,
      firstOfferFileUrl: undefined,
      finalOfferFileUrl: inv.fileUrl,
      affectedLines
    });
  }

  return anomalyRecords.sort((a, b) => b.totalPotentialExtraSavings - a.totalPotentialExtraSavings);
}



