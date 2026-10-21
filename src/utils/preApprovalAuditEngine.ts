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
import {
  areSpecSignaturesCompatible,
  extractTechnicalStandardAndGrade,
  areTechnicalVariantsCompatible,
  formatTechnicalVariantBadges,
  TechnicalVariantProfile
} from './materialGroupIntegrity';
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

  let score = 0.92;
  if (specA.diameter && specB.diameter) score += 0.04;
  if (specA.grade && specB.grade) score += 0.04;

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

interface IndexedHistoricalEntry {
  inv: InvoiceRecord;
  pastIt: any;
  invSupplier: string;
  invJobsiteId: string;
  cleanInvNo: string;
  pastSig: ReturnType<typeof buildSmartOriginalSignature>;
  pastSpecs: ReturnType<typeof extractTechnicalSpecs>;
  pastProcessed: ReturnType<typeof processItem>;
  pastGrossUnitPrice: number;
  orderFeatures: {
    detectedBrand: string;
    specTokens: string[];
    meaningfulTokens: string[];
    bilingualConcepts: string[];
  };
  sourceType: 'GES_ARCHIVE' | 'PRIZMA_ERP';
}

const HISTORICAL_INDEX_CACHE = new WeakMap<InvoiceRecord[], {
  entries: IndexedHistoricalEntry[];
  crossBrandFamilies: ReturnType<typeof buildMode2CrossBrandFamilies>;
}>();

const BILINGUAL_MATERIAL_CONCEPTS: Array<{ id: string; patterns: RegExp[] }> = [
  { id: 'CABLE_VVG', patterns: [/ввг/i, /\bvvg\b/i, /\bnyy\b/i] },
  { id: 'REBAR_STEEL', patterns: [/арматур/i, /inşaat\s*demir/i, /insaat\s*demir/i, /nervürlü\s*demir/i, /nervurlu\s*demir/i] },
  { id: 'GYPSUM_BOARD', patterns: [/гипсокартон/i, /\bгкл\b/i, /\bgkl\b/i, /alçıpan/i, /alcipan/i] },
  { id: 'CERAMIC_GLUE', patterns: [/клей\s+для\s+плитк/i, /плиточн\w*\s+клей/i, /seramik\s+yapıştırıcı/i, /seramik\s+yapistirici/i, /\bcm\s*11\b/i, /\bcm\s*17\b/i] },
  { id: 'FLOOR_GLUE', patterns: [/клей\s+для\s+напольн/i, /zemin\s+yapıştırıcı/i, /\b26a\b/i] },
  { id: 'LINOLEUM_COVER', patterns: [/напольн\w*\s+покрыт/i, /линолеум/i, /linolyum/i, /pvc\s+zemin/i, /master\s+proxi/i] },
  { id: 'PU_FOAM', patterns: [/пена\s+монтажн/i, /монтажн\w*\s+пен/i, /poliüretan\s+köpük/i, /montaj\s+köpü/i] },
  { id: 'MINERAL_WOOL', patterns: [/минват/i, /каменн\w*\s+ват/i, /базальт\w*\s+утеплит/i, /taş\s*yünü/i, /tasyunu/i, /mineral\s*yün/i] },
  { id: 'XPS_FOAM', patterns: [/пеноплэкс/i, /техноплекс/i, /экструдирован\w*\s+пенополистирол/i, /\bxps\b/i] },
  { id: 'PRIMER_GRUNT', patterns: [/грунтовк/i, /бетоноконтакт/i, /\bгрунт\b/i, /\bastar\b/i, /betokontakt/i] },
  { id: 'PUTTY_SHPAKLEVKA', patterns: [/шпатлевк/i, /шпаклевк/i, /\bmacun\b/i, /alçı\s*sıva/i, /ротбанд/i, /rotband/i] },
  { id: 'PLYWOOD_FANERA', patterns: [/фанер/i, /\bосб\b/i, /\bosb\b/i, /kontrplak/i, /plywood/i] },
  { id: 'PIPE_PPR', patterns: [/труб\w*.*полипропилен/i, /труб\w*\s+ппр/i, /\bppr\s+boru/i, /pprc\s+boru/i] },
  { id: 'PIPE_STEEL', patterns: [/труб\w*\s+стальн/i, /труб\w*\s+профильн/i, /труб\w*\s+вгп/i, /çelik\s+boru/i, /kutu\s+profil/i] },
  { id: 'CEMENT_MIX', patterns: [/цемент/i, /пескобетон/i, /çimento/i, /cimento/i, /\bм300\b/i, /\bm300\b/i, /\bм500\b/i] },
  { id: 'VALVE_KRAN', patterns: [/кран\s+шаров/i, /задвижк/i, /клапан/i, /küresel\s+vana/i, /\bvana\b/i] },
  { id: 'SOCKET_SWITCH', patterns: [/розетк/i, /выключател/i, /автоматическ\w*\s+выключател/i, /\bpriz\b/i, /anahtar\s+priz/i, /sigorta\s+otomat/i] },
  { id: 'LED_LUMINAIRE', patterns: [/светильник/i, /прожектор/i, /led\s+armatür/i, /led\s+projektör/i] },
  { id: 'SAFETY_GLOVES', patterns: [/перчатк/i, /рукавиц/i, /iş\s*eldiven/i, /\beldiven\b/i] },
  { id: 'CUTTING_DISC', patterns: [/круг\s+отрезн/i, /диск\s+отрезн/i, /диск\s+алмазн/i, /kesme\s+taşı/i, /kesici\s+disk/i, /elmas\s+disk/i] },
  { id: 'ELECTRODE_WELD', patterns: [/электрод/i, /проволок\w*\s+сварочн/i, /kaynak\s+elektrod/i, /gazaltı\s+tel/i] },
  { id: 'BOLT_NUT_ANCHOR', patterns: [/\bболт\b/i, /\bгайк/i, /шпильк\w*\s+резьбов/i, /\bанкер/i, /саморез/i, /дюбел/i, /saplama/i, /civat/i, /somun/i, /dübel/i, /akıllı\s+vida/i] },
  { id: 'WATERPROOF_MEMBRANE', patterns: [/гидроизоляц/i, /техноэласт/i, /унифлекс/i, /бикрост/i, /su\s+yalıtım/i, /bitümlü\s+membran/i] },
  { id: 'PAINT_ENAMEL', patterns: [/\bкраск/i, /\bэмаль/i, /водоэмульсион/i, /\bboya\b/i, /iç\s+cephe\s+boya/i, /dış\s+cephe\s+boya/i] },
];

const BRAND_SYNONYMS_MAP: Record<string, string> = {
  'кнауф': 'knauf', 'knauf': 'knauf',
  'церезит': 'ceresit', 'ceresit': 'ceresit',
  'технониколь': 'technonicol', 'technonicol': 'technonicol', 'tn': 'technonicol',
  'роквул': 'rockwool', 'rockwool': 'rockwool',
  'пеноплэкс': 'penoplex', 'penoplex': 'penoplex',
  'соудал': 'soudal', 'soudal': 'soudal',
  'макрофлекс': 'makroflex', 'makroflex': 'makroflex',
  'титан': 'tytan', 'tytan': 'tytan',
  'иэк': 'iek', 'iek': 'iek',
  'экф': 'ekf', 'ekf': 'ekf',
  'шнайдер': 'schneider', 'schneider': 'schneider',
  'абб': 'abb', 'abb': 'abb',
  'легран': 'legrand', 'legrand': 'legrand',
  'дкс': 'dkc', 'dkc': 'dkc',
  'остендорф': 'ostendorf', 'ostendorf': 'ostendorf',
  'рехау': 'rehau', 'rehau': 'rehau',
  'валтек': 'valtec', 'valtec': 'valtec',
  'грундфос': 'grundfos', 'grundfos': 'grundfos',
  'вило': 'wilo', 'wilo': 'wilo',
  'данфосс': 'danfoss', 'danfoss': 'danfoss',
  'бош': 'bosch', 'bosch': 'bosch',
  'макита': 'makita', 'makita': 'makita',
  'деволт': 'dewalt', 'dewalt': 'dewalt',
  'хилти': 'hilti', 'hilti': 'hilti',
  'эсаб': 'esab', 'esab': 'esab',
  'тиккурила': 'tikkurila', 'tikkurila': 'tikkurila',
  'дюлакс': 'dulux', 'dulux': 'dulux',
  'капарол': 'caparol', 'caparol': 'caparol',
  'мастер': 'master', 'master': 'master',
  'литокол': 'litokol', 'litokol': 'litokol',
  'мапей': 'mapei', 'mapei': 'mapei',
  'вебер': 'weber', 'weber': 'weber',
  'ветонит': 'vetonit', 'vetonit': 'vetonit',
  'юнис': 'unis', 'unis': 'unis',
  'бергауф': 'bergauf', 'bergauf': 'bergauf',
  'волма': 'volma', 'volma': 'volma',
  'старатели': 'starateli', 'starateli': 'starateli',
  'основит': 'osnovit', 'osnovit': 'osnovit',
  'сика': 'sika', 'sika': 'sika',
  'фишер': 'fischer', 'fischer': 'fischer',
  'сормат': 'sormat', 'sormat': 'sormat',
  'зубр': 'zubr', 'zubr': 'zubr',
  'луга': 'luga', 'lugaa': 'luga',
  'торекс': 'torex', 'torex': 'torex',
  'керама': 'kerama', 'kerama': 'kerama',
  'марацци': 'marazzi', 'marazzi': 'marazzi',
  'эстима': 'estima', 'estima': 'estima',
  'церсанит': 'cersanit', 'cersanit': 'cersanit',
  'грое': 'grohe', 'grohe': 'grohe',
  'геберит': 'geberit', 'geberit': 'geberit'
};

const STOP_WORDS_ORDER_INDEPENDENT = new Set([
  'для', 'или', 'при', 'под', 'над', 'без', 'изделия', 'изделие', 'материал', 'материалы',
  'строительный', 'строительные', 'товар', 'товары', 'комплект', 'компл', 'упак', 'упаковка',
  'шт', 'штук', 'пог', 'мп', 'м2', 'м3', 'кг', 'тонн', 'литр', 'рулон', 'лист', 'мешок',
  've', 'ile', 'için', 'icin', 'malzeme', 'inşaat', 'insaat', 'ürün', 'urun', 'adet', 'paket',
  'gost', 'гост', 'ту', 'din', 'iso', 'ral', 'тип', 'марка', 'модель', 'цвет', 'размер', 'мм', 'см',
  'белый', 'серый', 'черный', 'красный', 'синий', 'зеленый', 'коричневый', 'желтый'
]);

function extractOrderIndependentFeatures(rawText: string, sigBrand?: string) {
  const lower = String(rawText || '').toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`()[\]{}]/g, ' ')
    .replace(/[,;:/\\|]/g, ' ');

  let detectedBrand = '';
  if (sigBrand && sigBrand !== 'GENERIC' && sigBrand !== 'UNSPECIFIED') {
    const cleanSigBrand = sigBrand.toLowerCase();
    detectedBrand = BRAND_SYNONYMS_MAP[cleanSigBrand] || cleanSigBrand;
  }
  if (!detectedBrand) {
    for (const [rawKey, canonBrand] of Object.entries(BRAND_SYNONYMS_MAP)) {
      const rx = new RegExp(`(^|\\s|-)${rawKey}(\\s|-|$)`, 'i');
      if (rx.test(lower)) {
        detectedBrand = canonBrand;
        break;
      }
    }
  }

  const specMatches = lower.match(/\b(\d+(?:[.,]\d+)?(?:\s*[xх*×]\s*\d+(?:[.,]\d+)?)+|[dдфømм]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:мм|mm|см|cm|м|m|кг|kg|л|l|вт|w|а|a|квт|kw)|\b[a-zа-я]{1,4}[-]?\d{1,4}[a-zа-я]?\b)/gi) || [];
  const specTokens = Array.from(new Set(
    specMatches
      .map(s => s.replace(/\s+/g, '').replace(/,/g, '.').replace(/[х×*]/g, 'x').replace(/^(д|ф|ø)/, 'd').replace(/^м(\d)/, 'm$1'))
      .filter(s => s.length >= 2 && !/^(19|20)\d\d$/.test(s))
  )).sort();

  const words = lower
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(w => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(w => w.length >= 3 && !STOP_WORDS_ORDER_INDEPENDENT.has(w) && !/^\d+$/.test(w));

  const meaningfulTokens = Array.from(new Set(words)).sort();

  const bilingualConcepts: string[] = [];
  for (const c of BILINGUAL_MATERIAL_CONCEPTS) {
    if (c.patterns.some(p => p.test(lower))) {
      bilingualConcepts.push(c.id);
    }
  }

  return {
    detectedBrand,
    specTokens,
    meaningfulTokens,
    bilingualConcepts
  };
}

function getOrBuildHistoricalIndex(historicalInvoices: InvoiceRecord[]) {
  const cached = HISTORICAL_INDEX_CACHE.get(historicalInvoices);
  if (cached) return cached;

  const entries: IndexedHistoricalEntry[] = [];
  for (const inv of historicalInvoices || []) {
    if (!inv || inv.isDeleted) continue;
    if (!Array.isArray(inv.items)) continue;
    // Kalemleri fatura toplamını tutmayan (okuması doğrulanamamış) arşiv faturaları fiyat referansı olamaz.
    if ((inv as any).linesReconciled === false || (inv as any).lineCheck === 'mismatch') continue;

    const invSupplier = (inv.supplier || '').trim().toLowerCase();
    const invJobsiteId = inv.jobsiteId || (inv as any).prizmaJobsite || '';
    const cleanInvNo = cleanDocNo(inv.invoiceNumber || inv.invoiceNo);
    const isPrizma = Boolean(
      (inv as any).sourceCollection === 'prizma_invoices' ||
      String(inv.id || '').startsWith('prizma_') ||
      ((inv as any).prizmaProcessId && !inv.uploadedBySupervisorId)
    );

    for (const pastIt of inv.items) {
      if (!pastIt || !pastIt.unitPrice || pastIt.unitPrice <= 0) continue;
      if ((pastIt as any).lineVerified === false || !isLineArithmeticConsistent(pastIt as any)) continue;

      const combinedText = `${pastIt.originalName || ''} ${pastIt.materialName || ''}`.trim();
      if (!combinedText) continue;

      const pastSig = buildSmartOriginalSignature({
        originalName: pastIt.originalName,
        materialName: pastIt.materialName,
        category: pastIt.category,
        unit: pastIt.unit,
        unitPrice: pastIt.unitPrice
      });

      const pastSpecs = extractTechnicalSpecs(`${pastIt.materialName || ''} ${pastIt.originalName || ''} ${(pastIt as any).dimensions || ''} ${(pastIt as any).diameter || ''}`);
      if ((pastIt as any).diameter && !pastSpecs.diameter) pastSpecs.diameter = (pastIt as any).diameter;
      if ((pastIt as any).grade && !pastSpecs.grade) pastSpecs.grade = (pastIt as any).grade;
      if ((pastIt as any).dimensions && !pastSpecs.dimensions) pastSpecs.dimensions = (pastIt as any).dimensions;

      const pastProcessed = processItem({
        materialName: pastIt.materialName || pastIt.originalName || '',
        originalName: pastIt.originalName,
        category: pastIt.category || inv.category || 'Diğer Malzeme',
        unit: pastIt.unit || 'Adet',
        unitPrice: pastIt.unitPrice,
        brand: (pastIt as any).brand
      });

      const pastGrossUnitPrice = comparisonGrossUnitPrice(pastIt as any);
      const orderFeatures = extractOrderIndependentFeatures(combinedText, pastSig.canonicalBrandKey);

      entries.push({
        inv,
        pastIt,
        invSupplier,
        invJobsiteId,
        cleanInvNo,
        pastSig,
        pastSpecs,
        pastProcessed,
        pastGrossUnitPrice,
        orderFeatures,
        sourceType: isPrizma ? 'PRIZMA_ERP' : 'GES_ARCHIVE'
      });
    }
  }

  const crossBrandFamilies = buildMode2CrossBrandFamilies([]);
  const built = { entries, crossBrandFamilies };
  HISTORICAL_INDEX_CACHE.set(historicalInvoices, built);
  return built;
}

/**
 * Audits a single line item against all historical approved invoices and Prizma ERP records.
 * Handles vendor-independent brand placement (beginning/middle/end of line),
 * bilingual (Russian/Turkish) descriptions, and strict no-substitute (muadil olmaz) rules.
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

  const crossBrandEconomySuggestion = undefined;

  // 2. Scan historical invoices using the Strict Original-Language (Russian-first) O(1) Hash-Bucket Index
  // Every word stem in the original language, brand, standard (GOST/TU), and ALL numbers (dimensions, diameter, thickness, density, model) must match 100%.
  const candidateHistoricalMatches: HistoricalPricePoint[] = [];
  const draftDocNo = cleanDocNo(options?.draftInvoiceNumber);
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

  if (strictSig) {
    const strictBuckets = getOrBuildStrictOriginalIndex(historicalInvoices);
    const bucketCandidates = strictBuckets.get(strictSig.exactKey) || [];
    const draftUnitNorm = normalizeUnit(draftItem.unit || 'adet');

    for (const cand of bucketCandidates) {
      const { inv, pastIt, sig: candSig, grossUnitPrice: pastGrossUnitPrice, normalizedUnit: candUnitNorm, cleanInvNo, invSupplierLower, sourceType } = cand;

      // Never compare the draft invoice against its own archived copy
      if (draftDocNo && cleanInvNo === draftDocNo) {
        continue;
      }

      // 0. Technical Variant & Standard Lock (GOST vs TU, Sort 1/2/3, Moisture, Surface Treatment, Wood Species, Cross-section)
      const techCompat = areTechnicalVariantsCompatible(strictSig.techVariant, candSig.techVariant);
      if (!techCompat.compatible) {
        continue;
      }

      // If both specify a brand or GOST / TU / DIN / ISO standard, they must be 100% identical
      if (strictSig.brand && candSig.brand && strictSig.brand !== candSig.brand) {
        continue;
      }
      if (strictSig.gostKey && candSig.gostKey && strictSig.gostKey !== candSig.gostKey) {
        continue;
      }

      // Unit conversion check (KDV dahil %22 tabanındaki fiyat üzerinden)
      const sameUnit = candUnitNorm === draftUnitNorm;
      let comparablePastPrice = pastGrossUnitPrice;
      let convertedQuantity = Number(pastIt.quantity) || 1;

      if (!sameUnit) {
        const unitConversion = normalizeQuantityAndPrice(
          pastIt.quantity || 1,
          pastGrossUnitPrice,
          pastIt.unit || 'adet',
          draftItem.unit || 'adet',
          strictSig.rawOriginalText,
          draftItem.category || pastIt.category || ''
        );
        if (!unitConversion.conversionApplied || unitConversion.normalizedUnitPrice <= 0) continue;
        comparablePastPrice = Number(unitConversion.normalizedUnitPrice.toFixed(2));
        convertedQuantity = Number((unitConversion.normalizedQty || pastIt.quantity || 1).toFixed(3));
      }

      const normalizedPastUnitPrice = normalizePriceForComparison(
        comparablePastPrice,
        (inv as any).currency || 'RUB',
        false
      );

      if (normalizedPastUnitPrice <= 0) continue;

      // Sanity ratio guard: prevent extreme pack-vs-piece OCR unit errors (>10x difference) from polluting benchmark
      const priceRatio = normalizedDraftUnitPrice > 0
        ? Math.max(normalizedDraftUnitPrice / normalizedPastUnitPrice, normalizedPastUnitPrice / normalizedDraftUnitPrice)
        : 1;
      if (priceRatio > 10) continue;

      // Determine Comparison Level
      let level: ComparisonLevel = 'LEVEL_1_SAME_VARIANT';
      const isSameSupplier = draftSupplier && invSupplierLower && (draftSupplier.includes(invSupplierLower) || invSupplierLower.includes(draftSupplier));
      const invJobsiteId = inv.jobsiteId || '';
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
        invoiceNumber: inv.invoiceNumber || inv.invoiceNo || (sourceType === 'PRIZMA_ERP' ? 'PRIZMA-ERP' : 'FT-GECMIS'),
        date: inv.date || (inv as any).createdAt || '',
        supplier: sourceType === 'PRIZMA_ERP'
          ? `${String(inv.supplier || 'Prizma Tedarikçisi').replace(/\s*\(Prizma ERP\)\s*$/, '')} (Prizma ERP)`
          : (inv.supplier || 'Geçmiş Tedarikçi'),
        jobsiteId: invJobsiteId,
        jobsiteName: inv.jobsiteName || (inv as any).prizmaJobsite || 'Bilinmeyen Şantiye',
        rawMaterialName: candSig.rawOriginalText,
        canonicalName: processed.canonicalName,
        rawUnitPrice: pastGrossUnitPrice,
        normalizedUnitPrice: normalizedPastUnitPrice,
        unit: draftItem.unit,
        quantity: convertedQuantity,
        currency: 'RUB',
        isVatIncluded: true,
        matchScore: 1.0,
        comparisonLevel: level,
        specs: draftSpecs
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
      decisionReasoning: 'Bu malzeme (orijinal Rusça tanımı, markası ve tüm ölçü/teknik özellikleri birebir aynı) için sistemde geçmiş onaylı alım kaydı bulunamadı.',
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

  // Confidence assessment (always 1.0 for strict original-language match)
  const isLowConfidence = false;

  // Determine Line Status
  let status: PreApprovalStatus = 'ONAYLANABİLİR';
  let statusColor: LineAuditResult['statusColor'] = 'green';
  let decisionReasoning = '';

  if (isCheaperPastPurchaseAvailable) {
    if (percentagePriceDiff >= 15 || potentialSavings >= 100000) {
      status = 'YÖNETİCİ İNCELEMESİ GEREKLİ';
      statusColor = 'rose';
      decisionReasoning = `⚠️ Yüksek Fiyat Artışı (%${percentagePriceDiff}): Birebir aynı malzeme (${bestMatch.rawMaterialName}) daha önce ${bestMatch.date} tarihinde ${bestMatch.supplier} firmasından (Fatura No: ${bestMatch.invoiceNumber}) ${minHistoricalPrice.toLocaleString('tr-TR')} RUB birim fiyatla alınmıştı. Toplam ${potentialSavings.toLocaleString('tr-TR')} RUB ek maliyet riski bulunmaktadır.`;
    } else {
      status = 'İNDİRİM TALEP EDİLMELİ';
      statusColor = 'amber';
      decisionReasoning = `Birebir aynı malzeme (${bestMatch.rawMaterialName}) daha önce daha düşük fiyata alınmış (${bestMatch.date} / ${bestMatch.supplier} / Fatura No: ${bestMatch.invoiceNumber} - ${minHistoricalPrice.toLocaleString('tr-TR')} RUB). Satınalmacının tedarikçiden en az %${percentagePriceDiff} indirim talep etmesi önerilir.`;
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

// ============================================================================
// STRICT ORIGINAL-LANGUAGE (RUSSIAN-FIRST) O(1) HASH-BUCKET BENCHMARK ENGINE
// ============================================================================

const STRICT_STOP_WORDS = new Set([
  'для', 'или', 'при', 'под', 'над', 'без', 'из', 'по', 'на', 'от', 'до', 'со', 'во', 'в', 'с', 'к', 'у', 'о',
  'шт', 'штук', 'компл', 'комплект', 'упак', 'уп', 'пог', 'мп', 'м2', 'м3', 'куб', 'кв', 'кор', 'коробка',
  'мм', 'см', 'м', 'кг', 'г', 'гр', 'т', 'тн', 'тонн', 'л', 'мл', 'рул', 'рулон', 'пл', 'меш', 'мешок', 'лист',
  'марка', 'марки', 'тип', 'типа', 'вид', 'сорт', 'класс', 'класса',
  'плотн', 'плотность', 'плотностью', 'размер', 'размером', 'длина', 'длиной', 'ширина', 'шириной', 'толщина', 'толщиной',
  'диаметр', 'диаметром', 'сечение', 'сечением', 'вес', 'объем', 'цвет', 'арт', 'артикул', 'код', 'ф', 'd', 'д', 'ø', 'х', 'x'
]);

const STRICT_RUSSIAN_ABBREV_MAP: Record<string, string> = {
  'бум': 'бумажн',
  'прозр': 'прозрачн',
  'бел': 'бел',
  'чер': 'черн',
  'цел': 'целлюлозн',
  'оцинк': 'оцинкован',
  'пневматич': 'пневматическ',
  'метал': 'металлическ',
  'сл': 'слойн',
  'техн': 'техническ',
  'унив': 'универсальн',
  'проф': 'профессиональн'
};

function isFreightOrServiceLineText(text?: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return /^(?:доставка|транспортн\w*\s+услуг|услуг\w*\s+доставк|перевозк|автоуслуг|разгрузк|погрузк|аренда|услуга\s+по|nakliye\b)/i.test(t);
}

function stemOriginalRussianWord(w: string): string {
  if (STRICT_RUSSIAN_ABBREV_MAP[w]) return STRICT_RUSSIAN_ABBREV_MAP[w];
  if (w === 'гкл' || w.startsWith('гипсокартон')) return 'гипсокартон';
  if (w === 'гклв') return 'гклв';
  if (w === 'гвл' || w.startsWith('гипсоволокн')) return 'гипсоволокн';
  if (BRAND_SYNONYMS_MAP[w]) return BRAND_SYNONYMS_MAP[w];
  if (w === 'свеза' || w === 'sveza') return 'sveza';
  if (w === 'леика' || w === 'лейка' || w === 'leica') return 'leica';
  if (w === 'корда' || w === 'korda') return 'korda';
  if (w === 'сантал' || w === 'santal') return 'santal';
  if (w.length <= 3) return w;
  const stripped = w.replace(
    /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ую|юю|ами|ями|ах|ях|ов|ев|ей|ью|ии|ия|ие|ка|ки|ку|ке|а|я|о|е|ы|и|у|ю)$/,
    ''
  );
  return STRICT_RUSSIAN_ABBREV_MAP[stripped] || (stripped.length >= 2 ? stripped : w);
}

export interface StrictOriginalMaterialSignature {
  rawOriginalText: string;
  hasCyrillic: boolean;
  brand: string;
  numericSig: string;
  gostKey: string;
  stems: string[];
  exactKey: string;
  techVariant: TechnicalVariantProfile;
}

const STRICT_SIGNATURE_CACHE = new Map<string, StrictOriginalMaterialSignature | null>();

/**
 * Extracts a strict, order-independent fingerprint strictly from the original language
 * (Russian `originalName` whenever Cyrillic is present, never polluted by Turkish translations).
 * Every number (dimensions, thickness, diameter, density, weight, pack size, model number),
 * brand, standard (GOST vs TU), quality grade (Sort 1/2/3), and Russian word stem must match.
 */
export function buildStrictOriginalMaterialSignature(item: {
  originalName?: string;
  materialName?: string;
  brand?: string;
}): StrictOriginalMaterialSignature | null {
  const orig = String(item.originalName || '').trim();
  const mat = String(item.materialName || '').trim();
  const brandHint = String(item.brand || '').trim();
  const cacheKey = `${orig}\u0000${mat}\u0000${brandHint}`;

  if (STRICT_SIGNATURE_CACHE.has(cacheKey)) {
    return STRICT_SIGNATURE_CACHE.get(cacheKey)!;
  }

  const hasCyrOrig = /[а-яА-ЯёЁ]/.test(orig);
  const hasCyrMat = /[а-яА-ЯёЁ]/.test(mat);

  // Always prefer the original Russian text; never concatenate translated Turkish text when Russian exists
  let raw = hasCyrOrig ? orig : (hasCyrMat ? mat : (orig || mat));
  if (!raw || isFreightOrServiceLineText(raw) || isFreightOrServiceLineText(mat)) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  // Extract technical variant profile (GOST vs TU, Sort 1/2/3, moisture, surface treatment, wood species, cross-section) BEFORE stripping SKU prefixes like 01-09О / 01-14Г
  const techVariant = extractTechnicalStandardAndGrade(orig, mat);

  // Fast, non-backtracking strip of Prizma jobsite prefixes and trailing bracketed translations
  if (raw.includes('/') || raw.includes('\\')) {
    raw = raw.replace(/^[^\n]{1,60}?(?:ФАКТ|FAKT|ПЛАН|PLAN|АВАНС|AVANS|STF|BTF|СЧЕТ|SCHET)\s*[/|\\-]\s*/i, '');
  }
  if (raw.endsWith(']')) {
    raw = raw.replace(/\[[^\]]+\]$/g, '');
  }
  raw = raw.trim();

  if (!raw || isFreightOrServiceLineText(raw)) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  let s = raw.toLowerCase().replace(/ё/g, 'е');
  // Strip vendor-internal 1C accounting/warehouse nomenclature prefixes (e.g. "00029058 ", "у0-00029058 ", "01-09о ", "01-102г ") when followed by Cyrillic text
  s = s
    .replace(/^(?:[а-яa-z]{1,3}\d?[-/])?\d{5,12}\s+(?=[а-яa-z])/i, '')
    .replace(/^\d{1,3}-\d{1,3}[а-яa-z]?\s+(?=[а-я])/i, '')
    .trim();
  // Normalize decimal commas between digits (e.g. 12,5 -> 12.5) and dotted brand names (e.g. D.BOR -> dbor)
  s = s
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\b(?:d\.bor|д\.бор)\b/gi, 'dbor');

  // Extract GOST / TU / DIN / ISO standards into gostKey
  const gostMatches: string[] = [];
  s = s.replace(/(?:^|[^а-яa-z0-9])(гост|ту|din|iso)\s*(?:р\s*)?(\d+(?:[.-]\d+)*)/gi, (_, std, num) => {
    const mainNum = String(num).split(/[.-]/)[0];
    gostMatches.push(`${String(std).toLowerCase()}:${mainNum}`);
    return ' ';
  });

  // Extract all numbers (dimensions, thickness, diameter, density, weight, volume, pack count, model numbers)
  const rawNums = s.match(/\d+(?:\.\d+)?/g) || [];
  const normNums = rawNums
    .map(n => String(Number(n)))
    .filter(n => n !== 'NaN');
  const numericSig = normNums
    .slice()
    .sort((a, b) => Number(a) - Number(b))
    .join('|');

  // Extract word tokens from original text
  const cleanTokens = s
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/[^а-яa-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Extract brand in O(1) via token lookup
  let brand = '';
  if (brandHint && brandHint !== 'GENERIC' && brandHint !== 'UNSPECIFIED') {
    const cleanB = brandHint.toLowerCase().replace(/\b(?:d\.bor|д\.бор)\b/gi, 'dbor');
    brand = BRAND_SYNONYMS_MAP[cleanB] || cleanB;
  }
  if (!brand) {
    for (const tok of cleanTokens) {
      if (tok === 'dbor') {
        brand = 'dbor';
        break;
      }
      const mapped = BRAND_SYNONYMS_MAP[tok];
      if (mapped) {
        brand = mapped;
        break;
      }
    }
  }

  const wordStems: string[] = [];
  for (const tok of cleanTokens) {
    if (STRICT_STOP_WORDS.has(tok)) continue;
    // Standart kelimeleri (гост/gost/ту/tu) techVariant tarafından yönetilir;
    // böylece standart belirtilmeyen kayıtlar aynı kovaya düşüp hem GOST hem TU ile eşleşebilir,
    // ancak GOST ile TU birbirleriyle asla eşleşmez.
    if (tok === 'гост' || tok === 'gost' || tok === 'ту' || tok === 'tu') continue;
    const stem = stemOriginalRussianWord(tok);
    if (stem && stem.length >= 2 && !STRICT_STOP_WORDS.has(stem) && stem !== 'гост' && stem !== 'ту') {
      wordStems.push(stem);
    }
  }

  const uniqueStems = Array.from(new Set(wordStems)).sort();
  if (uniqueStems.length === 0 && !techVariant.isTimber) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  // Kereste kalemlerinde kova anahtarı tam kesit/ölçüye göre oluşturulur (örn. TIMBER::50x100x6000);
  // kova içindeki adaylar areTechnicalVariantsCompatible ile GOST/TU, Sort 1/1-2/2/3, Nem, Yüzey ve Ağaç Türü bazında kesin filtrelenir.
  const exactKey = (techVariant.isTimber && techVariant.crossSectionDims)
    ? `TIMBER::${techVariant.crossSectionDims}`
    : `${numericSig || '_'}::${uniqueStems.join('|')}`;

  const result: StrictOriginalMaterialSignature = {
    rawOriginalText: raw,
    hasCyrillic: hasCyrOrig || hasCyrMat,
    brand,
    numericSig,
    gostKey: gostMatches.sort().join(','),
    stems: uniqueStems,
    exactKey,
    techVariant
  };

  if (STRICT_SIGNATURE_CACHE.size < 25000) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, result);
  }
  return result;
}

interface StrictIndexedHistoricalItem {
  inv: InvoiceRecord;
  pastIt: any;
  sig: StrictOriginalMaterialSignature;
  grossUnitPrice: number;
  normalizedUnit: string;
  cleanInvNo: string;
  invSupplierLower: string;
  sourceType: 'GES_ARCHIVE' | 'PRIZMA_ERP';
}

const STRICT_ORIGINAL_INDEX_CACHE = new WeakMap<
  InvoiceRecord[],
  Map<string, StrictIndexedHistoricalItem[]>
>();

function getOrBuildStrictOriginalIndex(historicalInvoices: InvoiceRecord[]): Map<string, StrictIndexedHistoricalItem[]> {
  const cached = STRICT_ORIGINAL_INDEX_CACHE.get(historicalInvoices);
  if (cached) return cached;

  const buckets = new Map<string, StrictIndexedHistoricalItem[]>();

  for (const inv of historicalInvoices || []) {
    if (!inv || inv.isDeleted) continue;
    if (!Array.isArray(inv.items)) continue;
    if ((inv as any).linesReconciled === false || (inv as any).lineCheck === 'mismatch') continue;

    const cleanInvNo = cleanDocNo(inv.invoiceNumber || inv.invoiceNo);
    const invSupplierLower = String(inv.supplier || (inv as any).vendorName || '').trim().toLowerCase();
    const isPrizma = Boolean(
      (inv as any).sourceCollection === 'prizma_invoices' ||
      String(inv.id || '').startsWith('prizma_') ||
      ((inv as any).prizmaProcessId && !inv.uploadedBySupervisorId)
    );

    for (const pastIt of inv.items) {
      if (!pastIt) continue;
      if ((pastIt as any).lineVerified === false || !isLineArithmeticConsistent(pastIt as any)) continue;

      const grossUnitPrice = comparisonGrossUnitPrice(pastIt as any);
      if (!grossUnitPrice || grossUnitPrice <= 0) continue;

      const sig = buildStrictOriginalMaterialSignature({
        originalName: pastIt.originalName,
        materialName: pastIt.materialName,
        brand: (pastIt as any).brand
      });
      if (!sig) continue;

      const entry: StrictIndexedHistoricalItem = {
        inv,
        pastIt,
        sig,
        grossUnitPrice,
        normalizedUnit: normalizeUnit(pastIt.unit || 'adet'),
        cleanInvNo,
        invSupplierLower,
        sourceType: isPrizma ? 'PRIZMA_ERP' : 'GES_ARCHIVE'
      };

      const list = buckets.get(sig.exactKey);
      if (list) {
        list.push(entry);
      } else {
        buckets.set(sig.exactKey, [entry]);
      }
    }
  }

  STRICT_ORIGINAL_INDEX_CACHE.set(historicalInvoices, buckets);
  return buckets;
}

/**
 * Given a draft invoice or discount record's line items, checks in O(1) time via the
 * Strict Original-Language (Russian-first) Hash-Bucket Index whether the 100% identical material
 * (identical Russian words, brand, model, dimensions, thickness, diameter, density, and standard)
 * was purchased at a cheaper unit price (at least 1% difference) across the system.
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

  const buckets = getOrBuildStrictOriginalIndex(historicalInvoices);
  const results: import('../types').CheaperHistoricalBenchmark[] = [];
  const cleanContextInvNo = cleanDocNo(context.invoiceNo);
  const excludeInvId = context.excludeInvoiceId || (context.excludeDiscountId ? `inv_sync_${context.excludeDiscountId}` : '');
  const excludeDiscId = context.excludeDiscountId || '';

  items.forEach((rawIt, idx) => {
    if (!rawIt) return;
    const currentUnitPrice = comparisonGrossUnitPrice(rawIt);
    const qty = Number(rawIt.quantity) || 1;
    if (currentUnitPrice <= 0 || qty <= 0) return;

    const sig = buildStrictOriginalMaterialSignature({
      originalName: rawIt.originalName,
      materialName: rawIt.materialName,
      brand: rawIt.brand
    });
    if (!sig) return;

    const candidates = buckets.get(sig.exactKey);
    if (!candidates || candidates.length === 0) return;

    const draftUnitNorm = normalizeUnit(rawIt.unit || 'adet');
    const validMatches: Array<{ entry: StrictIndexedHistoricalItem; comparablePrice: number }> = [];

    for (const cand of candidates) {
      // Never compare a discount/invoice record against its own synced invoice copy
      if (excludeInvId && cand.inv.id === excludeInvId) continue;
      if (excludeDiscId && ((cand.inv as any).discountId === excludeDiscId || cand.inv.id === `inv_sync_${excludeDiscId}`)) continue;
      if (cleanContextInvNo && cand.cleanInvNo === cleanContextInvNo) continue;

      // 0. Technical Variant & Standard Lock (GOST vs TU, Sort 1/2/3, Moisture, Surface Treatment, Wood Species, Cross-section)
      const techCompat = areTechnicalVariantsCompatible(sig.techVariant, cand.sig.techVariant);
      if (!techCompat.compatible) continue;

      // If both specify a brand or GOST / TU / DIN standard, they must be 100% identical
      if (sig.brand && cand.sig.brand && sig.brand !== cand.sig.brand) continue;
      if (sig.gostKey && cand.sig.gostKey && sig.gostKey !== cand.sig.gostKey) continue;

      // Unit check: must be identical unit or mathematically convertible
      let comparablePrice = cand.grossUnitPrice;
      if (cand.normalizedUnit !== draftUnitNorm) {
        const conv = normalizeQuantityAndPrice(
          cand.pastIt.quantity || 1,
          cand.grossUnitPrice,
          cand.pastIt.unit || 'adet',
          rawIt.unit || 'adet',
          sig.rawOriginalText,
          rawIt.category || cand.pastIt.category || ''
        );
        if (!conv.conversionApplied || conv.normalizedUnitPrice <= 0) continue;
        comparablePrice = Number(conv.normalizedUnitPrice.toFixed(2));
      }

      if (comparablePrice <= 0) continue;

      // Sanity ratio guard against extreme pack-vs-piece OCR unit errors (>10x)
      const ratio = Math.max(currentUnitPrice / comparablePrice, comparablePrice / currentUnitPrice);
      if (ratio > 10) continue;

      validMatches.push({ entry: cand, comparablePrice });
    }

    if (validMatches.length === 0) return;

    validMatches.sort((a, b) => a.comparablePrice - b.comparablePrice);
    const cheapest = validMatches[0];

    // User confirmed rule: show when price difference is at least 1% (>= 1.0%)
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
    const rawSupplier = String(bestInv.supplier || (bestInv as any).vendorName || 'Geçmiş Tedarikçi')
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

    results.push({
      lineIndex: idx,
      materialName: rawIt.materialName || sig.rawOriginalText,
      originalName: sig.rawOriginalText,
      historicalOriginalName: cheapest.entry.sig.rawOriginalText,
      brand: rawIt.brand || (sig.brand ? sig.brand.toUpperCase() : undefined),
      unit: rawIt.unit || 'Adet',
      quantity: qty,
      currentUnitPrice: Number(currentUnitPrice.toFixed(2)),
      historicalBestUnitPrice: Number(cheapest.comparablePrice.toFixed(2)),
      historicalAvgUnitPrice: avgPrice,
      historicalSupplier: rawSupplier,
      historicalJobsiteName: bestInv.jobsiteName || (bestInv as any).prizmaJobsite || 'Merkez / Şantiye',
      historicalDate: bestInv.date || (bestInv as any).createdAt || '-',
      historicalInvoiceNo: bestInv.invoiceNumber || bestInv.invoiceNo || '-',
      historicalInvoiceId: bestInv.id,
      historicalFileUrl,
      historicalPrizmaDemandId: prizmaDemandId,
      historicalPrizmaUrl,
      historicalSource: isPrizma ? 'PRIZMA_ERP' : 'GES_ARCHIVE',
      unitOverpayment,
      totalLineOverpayment,
      overpaymentPercentage,
      matchReason: `Orijinal Rusça metni, markası, modeli ve tüm ölçü/teknik özellikleri birebir aynı olan bu malzeme ${rawSupplier} firmasından ${cheapest.comparablePrice.toLocaleString('tr-TR')} ₽ birim fiyata alınmıştır.`
    });
  });

  return results;
}

/**
 * Scans all DiscountRecord entries in milliseconds using the O(1) Strict Original-Language Index
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

    // Exclude Prizma ERP invoices
    const isPrizma = Boolean(
      (inv as any).sourceCollection === 'prizma_invoices' ||
      String(inv.id || '').startsWith('prizma_') ||
      ((inv as any).prizmaProcessId && !inv.uploadedBySupervisorId)
    );
    if (isPrizma) continue;

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



