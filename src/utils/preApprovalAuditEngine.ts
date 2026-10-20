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
import { normalizeUnit, normalizeQuantityAndPrice, extractTechnicalSpecs } from './comparativeCalculation';
import { areSpecSignaturesCompatible } from './materialGroupIntegrity';
import { comparisonMultiplierForVat } from './vatBasis';
import {
  buildSmartOriginalSignature,
  buildMode2CrossBrandFamilies,
  findCheaperEquivalentBrandSuggestion,
  SmartOriginalInvoiceSignature
} from './dualMaterialComparisonEngine';

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

function cleanDocNo(v: string | undefined): string {
  return String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

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

  let score = 0.8;
  if (specA.diameter && specB.diameter) score += 0.1;
  if (specA.grade && specB.grade) score += 0.1;

  return { compatible: true, specMatchScore: Math.min(score, 1.0) };
}

export interface PreApprovalAuditOptions {
  /** Denetlenen faturanın numarası: arşivdeki aynı faturayla kendini kıyaslamayı önler */
  draftInvoiceNumber?: string;
  isUrgent?: boolean;
  isUrgentPurchase?: boolean;
  isSingleVendor?: boolean;
  isScopeChange?: boolean;
}

/**
 * Audits a single line item against all historical approved invoices and discounts.
 */
export function auditSingleLineItem(
  draftItem: LineAuditResult['draftItem'],
  lineIndex: number,
  historicalInvoices: InvoiceRecord[],
  options?: PreApprovalAuditOptions
): LineAuditResult {
  // 1. Process item through Central AI Decision Engine
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

  // Taslak satırın kıyas fiyatı: faturadaki KDV dahil birim fiyat (%22 tabanı), yalnızca para birimi çevrilir.
  // Taslakta unitPrice faturadaki KDV dahil fiyattır; yalnızca %20'lik faturalar %22 tabanına taşınır.
  const draftBasisPrice = Number(draftItem.vatPercentage) === 20 && Number(draftItem.unitPriceNet) > 0
    ? comparisonGrossUnitPrice({ unitPriceNet: draftItem.unitPriceNet, vatPercentage: 20 })
    : draftItem.unitPrice;
  const normalizedDraftUnitPrice = normalizePriceForComparison(
    draftBasisPrice,
    draftItem.currency,
    false
  );

  const draftSupplier = (draftItem.supplier || '').trim().toLowerCase();
  const draftJobsiteId = draftItem.jobsiteId || '';

  const draftSig = buildSmartOriginalSignature({
    originalName: draftItem.originalName,
    materialName: draftItem.materialName,
    category: draftItem.category,
    unit: draftItem.unit,
    unitPrice: draftItem.unitPrice
  });

  const referenceCrossBrandFamilies = buildMode2CrossBrandFamilies([]);
  const crossBrandEconomySuggestion = findCheaperEquivalentBrandSuggestion({
    originalName: draftItem.originalName,
    materialName: draftItem.materialName,
    category: draftItem.category,
    unit: draftItem.unit,
    currentUnitPrice: normalizedDraftUnitPrice || draftItem.unitPrice,
    quantity: draftItem.quantity || 1,
    families: referenceCrossBrandFamilies
  });

  // 2. Scan historical invoices for matching records (Mode 1: Apple-to-Apple)
  const candidateHistoricalMatches: HistoricalPricePoint[] = [];

  const draftDocNo = cleanDocNo(options?.draftInvoiceNumber);
  for (const inv of historicalInvoices) {
    if (inv.isDeleted) continue;
    if (!Array.isArray(inv.items)) continue;
    // Kalemleri fatura toplamını tutmayan (okuması doğrulanamamış) arşiv faturaları fiyat referansı olamaz.
    if ((inv as any).linesReconciled === false || (inv as any).lineCheck === 'mismatch') continue;

    const invSupplier = (inv.supplier || '').trim().toLowerCase();
    const invJobsiteId = inv.jobsiteId || '';
    // Denetlenen faturanın arşivdeki kopyası kendisiyle kıyaslanmaz.
    if (draftDocNo && cleanDocNo(inv.invoiceNumber) === draftDocNo && draftSupplier && invSupplier &&
        (draftSupplier.includes(invSupplier) || invSupplier.includes(draftSupplier))) continue;

    for (const pastIt of inv.items) {
      if (!pastIt.unitPrice || pastIt.unitPrice <= 0) continue;
      if ((pastIt as any).lineVerified === false || !isLineArithmeticConsistent(pastIt as any)) continue;

      const pastSig = buildSmartOriginalSignature({
        originalName: pastIt.originalName,
        materialName: pastIt.materialName,
        category: pastIt.category,
        unit: pastIt.unit,
        unitPrice: pastIt.unitPrice
      });

      // Mode 1 (Apple-to-Apple) Brand & Product Series Protection Rule:
      // For non-commodity branded materials (Drywall, Insulation, Waterproofing, Plaster, Paint, Tools),
      // never mix different canonical brands or product series/density classes (e.g., Техновент Н vs Baswool Фасад 120) in Mode 1 historical benchmark!
      if (!draftSig.isCommodity) {
        if (draftSig.canonicalBrandKey !== pastSig.canonicalBrandKey) {
          continue;
        }
        if ((draftSig.subBrandOrSeries || '') !== (pastSig.subBrandOrSeries || '')) {
          continue;
        }
      }

      // Check 3-layer original Russian specification signature compatibility (brand, series, density, pack weight, dimensions)
      if (
        (draftItem.originalName || draftItem.materialName) &&
        (pastIt.originalName || pastIt.materialName) &&
        !areSpecSignaturesCompatible(
          draftItem.originalName || draftItem.materialName,
          pastIt.originalName || pastIt.materialName
        )
      ) {
        continue;
      }

      // Extract past specs
      const pastSpecs = extractTechnicalSpecs(`${pastIt.materialName} ${pastIt.originalName || ''} ${(pastIt as any).dimensions || ''} ${(pastIt as any).diameter || ''}`);
      if ((pastIt as any).diameter && !pastSpecs.diameter) pastSpecs.diameter = (pastIt as any).diameter;
      if ((pastIt as any).grade && !pastSpecs.grade) pastSpecs.grade = (pastIt as any).grade;
      if ((pastIt as any).dimensions && !pastSpecs.dimensions) pastSpecs.dimensions = (pastIt as any).dimensions;

      // Check technical spec compatibility
      const specCompatibility = areTechnicalSpecsCompatible(draftSpecs, pastSpecs);
      if (!specCompatibility.compatible) {
        // Incompatible specs (e.g. Ø12 vs Ø16) - MUST NOT match!
        continue;
      }

      // Process past item
      const pastProcessed = processItem({
        materialName: pastIt.materialName,
        originalName: pastIt.originalName,
        category: pastIt.category,
        unit: pastIt.unit,
        unitPrice: pastIt.unitPrice,
        brand: (pastIt as any).brand
      });

      // Matching logic:
      // 0: Smart Original Russian Invoice Signature Match (handles different vendor phrasings of same product & brand)
      // A: CPID Exact match
      // B: Canonical Name Exact match
      // C: Same Category & strong keyword overlap
      let isMatch = false;
      let matchScore = 0.5;

      if (
        !draftSig.canonicalFamilyKey.startsWith('FAM_') &&
        draftSig.canonicalFamilyKey === pastSig.canonicalFamilyKey &&
        draftSig.canonicalSpecKey === pastSig.canonicalSpecKey &&
        (draftSig.isCommodity ||
          (draftSig.canonicalBrandKey === pastSig.canonicalBrandKey &&
           (draftSig.subBrandOrSeries || '') === (pastSig.subBrandOrSeries || '')))
      ) {
        isMatch = true;
        matchScore = 0.96 * specCompatibility.specMatchScore;
      } else if (pastProcessed.canonicalProductId === processed.canonicalProductId) {
        isMatch = true;
        matchScore = 0.95 * specCompatibility.specMatchScore;
      } else if (pastProcessed.canonicalName.toLowerCase() === processed.canonicalName.toLowerCase()) {
        isMatch = true;
        matchScore = 0.90 * specCompatibility.specMatchScore;
      } else if (
        pastProcessed.category === processed.category &&
        pastProcessed.functionalDomain === processed.functionalDomain
      ) {
        // Fuzzy token overlap in same category
        const tokensA = new Set(processed.canonicalName.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const tokensB = pastProcessed.canonicalName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const common = tokensB.filter(t => tokensA.has(t));
        if (common.length >= 2) {
          isMatch = true;
          matchScore = Math.min(0.70 + (common.length * 0.05), 0.85) * specCompatibility.specMatchScore;
        }
      }

      if (!isMatch) continue;

      // Unit conversion check (KDV dahil %22 tabanındaki fiyat üzerinden)
      const pastGrossUnitPrice = comparisonGrossUnitPrice(pastIt as any);
      const sameUnit = normalizeUnit(pastIt.unit || 'adet') === normalizeUnit(draftItem.unit || 'adet');
      const unitConversion = normalizeQuantityAndPrice(
        pastIt.quantity || 1,
        pastGrossUnitPrice,
        pastIt.unit || 'adet',
        draftItem.unit || 'adet',
        draftItem.materialName || pastIt.materialName || '',
        draftItem.category || pastIt.category || ''
      );
      // Farklı birim ve güvenilir dönüşüm yoksa (ör. рулон ↔ м²) fiyatlar kıyaslanamaz.
      if (!sameUnit && !unitConversion.conversionApplied) continue;

      // Normalization of past price (Currency; KDV tabanı zaten %22 dahil)
      const normalizedPastUnitPrice = normalizePriceForComparison(
        sameUnit ? pastGrossUnitPrice : unitConversion.normalizedUnitPrice,
        (inv as any).currency || 'RUB',
        false
      );

      // Determine Comparison Level
      let level: ComparisonLevel = 'LEVEL_1_SAME_VARIANT';
      const isSameSupplier = draftSupplier && invSupplier && (draftSupplier.includes(invSupplier) || invSupplier.includes(draftSupplier));
      const isSameJobsite = draftJobsiteId && invJobsiteId && draftJobsiteId === invJobsiteId;

      if (isSameSupplier) {
        level = 'LEVEL_2_SAME_SUPPLIER';
      } else if (!isSameJobsite) {
        level = 'LEVEL_4_OTHER_JOBSITES';
      } else {
        level = 'LEVEL_3_OTHER_SUPPLIERS';
      }

      candidateHistoricalMatches.push({
        invoiceId: inv.id || '',
        invoiceNumber: inv.invoiceNumber || 'FT-GECMIS',
        date: inv.date || inv.createdAt || '',
        supplier: inv.supplier || 'Geçmiş Tedarikçi',
        jobsiteId: invJobsiteId,
        jobsiteName: inv.jobsiteName || 'Bilinmeyen Şantiye',
        rawMaterialName: pastIt.originalName || pastIt.materialName,
        canonicalName: pastProcessed.canonicalName,
        rawUnitPrice: pastGrossUnitPrice,
        normalizedUnitPrice: normalizedPastUnitPrice,
        unit: draftItem.unit,
        quantity: sameUnit ? (pastIt.quantity || 1) : Number((unitConversion.normalizedQty || pastIt.quantity || 1).toFixed(3)),
        currency: 'RUB',
        isVatIncluded: true,
        matchScore: Number(matchScore.toFixed(2)),
        comparisonLevel: level,
        specs: pastSpecs
      });
    }
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
      decisionReasoning: 'Bu malzeme veya teknik özellik için sistemde geçmiş onaylı alım kaydı bulunamadı. Piyasa rayiç kontrolü yapılması önerilir.',
      isSingleVendor: !!options?.isSingleVendor,
      isUrgentPurchase: !!options?.isUrgentPurchase,
      isLowConfidence: false,
      isScopeChange: !!options?.isScopeChange,
      isCheaperPastPurchaseAvailable: false,
      smartSignature: draftSig,
      crossBrandEconomySuggestion
    };
  }

  // Sort matches by best match score, then lowest price
  candidateHistoricalMatches.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.normalizedUnitPrice - b.normalizedUnitPrice;
  });

  const bestMatch = candidateHistoricalMatches[0];
  const prices = candidateHistoricalMatches.map(m => m.normalizedUnitPrice);
  const minHistoricalPrice = Math.min(...prices);
  const maxHistoricalPrice = Math.max(...prices);
  const avgHistoricalPrice = Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100;
  
  // Last historical purchase by date
  const sortedByDate = [...candidateHistoricalMatches].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastHistoricalPrice = sortedByDate[0].normalizedUnitPrice;

  // Compute variance against the MINIMUM historical price
  const absolutePriceDiff = Math.round((normalizedDraftUnitPrice - minHistoricalPrice) * 100) / 100;
  const percentagePriceDiff = minHistoricalPrice > 0
    ? Math.round(((normalizedDraftUnitPrice - minHistoricalPrice) / minHistoricalPrice) * 1000) / 10
    : 0;
  const potentialSavings = absolutePriceDiff > 0 ? Math.round(absolutePriceDiff * (draftItem.quantity || 1)) : 0;

  // Confidence assessment
  const isLowConfidence = bestMatch.matchScore < 0.75;
  const isCheaperPastPurchaseAvailable = normalizedDraftUnitPrice > minHistoricalPrice;

  // Determine Line Status
  let status: PreApprovalStatus = 'ONAYLANABİLİR';
  let statusColor: LineAuditResult['statusColor'] = 'green';
  let decisionReasoning = '';

  if (isLowConfidence) {
    status = 'DÜŞÜK GÜVENLİ EŞLEŞME';
    statusColor = 'orange';
    decisionReasoning = `Eşleşme güven skoru (%${Math.round(bestMatch.matchScore * 100)}) düşüktür. Teknik varyant veya malzeme tanımında olası nüans farkı bulunabilir, manuel teyit önerilir.`;
  } else if (isCheaperPastPurchaseAvailable) {
    if (percentagePriceDiff >= 15 || potentialSavings >= 100000) {
      status = 'YÖNETİCİ İNCELEMESİ GEREKLİ';
      statusColor = 'rose';
      decisionReasoning = `⚠️ Yüksek Fiyat Artışı (%${percentagePriceDiff}): Bu malzeme daha önce ${bestMatch.date} tarihinde ${bestMatch.supplier} firmasından ${minHistoricalPrice.toLocaleString('tr-TR')} RUB birim fiyatla alınmıştı. Toplam ${potentialSavings.toLocaleString('tr-TR')} RUB ek maliyet riski bulunmaktadır.`;
    } else {
      status = 'İNDİRİM TALEP EDİLMELİ';
      statusColor = 'amber';
      decisionReasoning = `Bu malzeme daha önce daha düşük fiyata alınmış (${bestMatch.date} / ${bestMatch.supplier} - ${minHistoricalPrice.toLocaleString('tr-TR')} RUB). Satınalmacının tedarikçiden en az %${percentagePriceDiff} indirim talep etmesi önerilir.`;
    }
  } else {
    status = 'ONAYLANABİLİR';
    statusColor = 'green';
    decisionReasoning = `Birim fiyat (${normalizedDraftUnitPrice.toLocaleString('tr-TR')} RUB), geçmiş en iyi fiyatla (${minHistoricalPrice.toLocaleString('tr-TR')} RUB) uyumlu veya daha avantajlıdır.`;
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
      { ...options, draftInvoiceNumber: options?.draftInvoiceNumber || draftInvoice.invoiceNumber }
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
