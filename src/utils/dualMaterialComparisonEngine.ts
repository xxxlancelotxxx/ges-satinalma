import { MaterialComparison } from '../types';
import { analyzeMaterialSegment, MaterialQualitySegment } from './materialSegmentIntelligence';
import { extractSpecSignature, getSpecConflicts, extractOriginalBrandAndSeries } from './materialGroupIntegrity';

export type DualComparisonLens = 'MODE_1_APPLE_TO_APPLE' | 'MODE_2_BRAND_EQUIVALENT';

export interface SmartOriginalInvoiceSignature {
  rawOriginalText: string;
  isCommodity: boolean;
  canonicalFamilyKey: string;
  canonicalFamilyTitleRu: string;
  canonicalFamilyTitleTr: string;
  canonicalSpecKey: string;
  canonicalSpecLabel: string;
  canonicalBrandKey: string;
  canonicalBrandDisplay: string;
  subBrandOrSeries?: string;
  qualitySegment: MaterialQualitySegment;
  normalizedDimensions?: string;
  thicknessMm?: number;
  weightKg?: number;
  volumeLitre?: number;
  rebarDiameterMm?: number;
}

export interface BrandBreakdownEntry {
  brandKey: string;
  brandDisplay: string;
  qualitySegment: MaterialQualitySegment;
  totalQuantity: number;
  totalSpend: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  avgUnitPrice: number;
  jobsites: string[];
  suppliers: string[];
  invoiceCount: number;
  originalWritings: string[];
  diffVsCheapestRub: number;
  diffVsCheapestPct: number;
  potentialSavingsIfSwitchedToCheapest: number;
  history: MaterialComparison['history'];
}

export interface CrossBrandEquivalentFamily {
  familyId: string;
  category: string;
  unit: string;
  canonicalFamilyTitleRu: string;
  canonicalFamilyTitleTr: string;
  canonicalSpecLabel: string;
  originalSpecSummary: string;
  brands: BrandBreakdownEntry[];
  cheapestBrand: BrandBreakdownEntry;
  priciestBrand: BrandBreakdownEntry;
  totalFamilyQuantity: number;
  totalFamilySpend: number;
  totalPotentialEconomyRub: number;
  maxBrandPriceGapPct: number;
  hasMultipleBrandsInInvoices: boolean;
  isReferenceEnriched?: boolean;
}

/**
 * Canonical Brand & Sub-Series Dictionary
 * Recognizes Cyrillic, Latin, abbreviations, and product-line names (e.g., Rotband -> Knauf, Technoelast -> TechnoNICOL)
 * strictly from original invoice text so different vendor phrasings resolve to the exact same canonical brand.
 */
const CANONICAL_BRAND_RULES: Array<{
  brandKey: string;
  brandDisplay: string;
  tier: MaterialQualitySegment;
  patterns: RegExp[];
  subSeriesPatterns?: Array<{ pattern: RegExp; seriesName: string }>;
}> = [
  {
    brandKey: 'KNAUF',
    brandDisplay: 'Knauf (Кнауф)',
    tier: 'PREMIUM',
    patterns: [
      /\bknauf\b|кнауф/i,
      /ротбанд|rotband/i,
      /фуген|fugen/i,
      /унифлот|uniflot/i,
      /тифенгрунд|tiefengrund/i,
      /бетоконтакт\s*кнауф|мп[\s-]*75|\bmp[\s-]*75\b/i,
      /гольдбанд|goldband|севенер|sevener|диамант\s*кнауф|аквапанель|aquapanel|суперпол/i
    ],
    subSeriesPatterns: [
      { pattern: /ротбанд|rotband/i, seriesName: 'Кнауф-Ротбанд' },
      { pattern: /фуген|fugen/i, seriesName: 'Кнауф-Фуген' },
      { pattern: /тифенгрунд|tiefengrund/i, seriesName: 'Кнауф-Тифенгрунд' },
      { pattern: /мп[\s-]*75|\bmp[\s-]*75\b/i, seriesName: 'Кнауф МП-75' }
    ]
  },
  {
    brandKey: 'VOLMA',
    brandDisplay: 'Volma (Волма)',
    tier: 'STANDARD',
    patterns: [
      /\bvolma\b|волма/i,
      /волма[\s-]*слой|волма[\s-]*аква|волма[\s-]*монтаж|волма[\s-]*гипс|волма[\s-]*пласт|волма[\s-]*шов/i
    ],
    subSeriesPatterns: [
      { pattern: /волма[\s-]*слой/i, seriesName: 'Волма-Слой' },
      { pattern: /волма[\s-]*монтаж/i, seriesName: 'Волма-Монтаж' }
    ]
  },
  {
    brandKey: 'GYPROC',
    brandDisplay: 'Gyproc (Гипрок)',
    tier: 'STANDARD',
    patterns: [/\bgyproc\b|гипрок/i]
  },
  {
    brandKey: 'MAGMA',
    brandDisplay: 'Magma (Магма)',
    tier: 'ECONOMY',
    patterns: [/\bmagma\b|магма/i]
  },
  {
    brandKey: 'TECHNONICOL',
    brandDisplay: 'ТехноНИКОЛЬ (TechnoNICOL)',
    tier: 'STANDARD',
    patterns: [
      /технониколь|technonicol|техноэласт|technoelast|унифлекс|uniflex|биполь|bipol|линокром|linokrom|бикрост|bikrost/i,
      /техновент|технофас|техноблок|техноруф|технофлор|технолайт|техноакустик|техноплекс|роклайт|rocklight|carbon\s*prof|карбон\s*проф|logicpir|логикпир|logicbase|плантер|planter/i,
      /(?:^|\s)тн\s+(?:техно|унифлекс|биполь|роклайт|карбон|плантер)/i
    ],
    subSeriesPatterns: [
      { pattern: /техновент\s*оптима/i, seriesName: 'Техновент Оптима' },
      { pattern: /техновент\s*стандарт/i, seriesName: 'Техновент Стандарт' },
      { pattern: /техновент\s*проф/i, seriesName: 'Техновент Проф' },
      { pattern: /техновент\s*н\b/i, seriesName: 'Техновент Н' },
      { pattern: /техновент/i, seriesName: 'Техновент' },
      { pattern: /техноэласт|technoelast/i, seriesName: 'Техноэласт' },
      { pattern: /унифлекс|uniflex/i, seriesName: 'Унифлекс' },
      { pattern: /биполь|bipol/i, seriesName: 'Биполь' },
      { pattern: /линокром|linokrom/i, seriesName: 'Линокром' },
      { pattern: /бикрост|bikrost/i, seriesName: 'Бикрост' },
      { pattern: /роклайт|rocklight/i, seriesName: 'Роклайт' },
      { pattern: /техноблок/i, seriesName: 'Техноблок' },
      { pattern: /технофас/i, seriesName: 'Технофас' },
      { pattern: /техноруф/i, seriesName: 'Техноруф' },
      { pattern: /технофлор/i, seriesName: 'Технофлор' },
      { pattern: /carbon\s*prof|карбон\s*проф/i, seriesName: 'Carbon Prof' }
    ]
  },
  {
    brandKey: 'BASWOOL',
    brandDisplay: 'Baswool (Басвул)',
    tier: 'STANDARD',
    patterns: [/\bbaswool\b|басвул/i]
  },
  {
    brandKey: 'ICOPAL',
    brandDisplay: 'Icopal (Икопал)',
    tier: 'PREMIUM',
    patterns: [/икопал|icopal|ультранап|виллатекс|villateks|синтофойл/i]
  },
  {
    brandKey: 'IZOPLAST',
    brandDisplay: 'Изопласт (Izoplast)',
    tier: 'STANDARD',
    patterns: [/изопласт|izoplast/i]
  },
  {
    brandKey: 'PENOPLEX',
    brandDisplay: 'Пеноплэкс (Penoplex)',
    tier: 'PREMIUM',
    patterns: [/пеноплэкс|пеноплекс|penoplex/i]
  },
  {
    brandKey: 'ROCKWOOL',
    brandDisplay: 'Rockwool (Роквул)',
    tier: 'PREMIUM',
    patterns: [/роквул|rockwool|лайт\s*баттс|флор\s*баттс|фасад\s*баттс|руф\s*баттс|акустик\s*баттс/i]
  },
  {
    brandKey: 'ISOVER',
    brandDisplay: 'Isover (Изовер)',
    tier: 'STANDARD',
    patterns: [/изовер|isover/i]
  },
  {
    brandKey: 'URSA',
    brandDisplay: 'Ursa (Урса)',
    tier: 'STANDARD',
    patterns: [/\bursa\b|урса/i]
  },
  {
    brandKey: 'CERESIT',
    brandDisplay: 'Ceresit (Церезит)',
    tier: 'PREMIUM',
    patterns: [/церезит|ceresit|\bсм\s*11\b|\bcm\s*11\b|\bсм\s*14\b|\bсм\s*16\b|\bсм\s*17\b|\bст\s*17\b|\bct\s*17\b|\bст\s*16\b/i]
  },
  {
    brandKey: 'VETONIT',
    brandDisplay: 'Weber-Vetonit (Ветонит)',
    tier: 'PREMIUM',
    patterns: [/ветонит|vetonit|\bweber\b|вебер\b/i]
  },
  {
    brandKey: 'UNIS',
    brandDisplay: 'Unis (Юнис)',
    tier: 'STANDARD',
    patterns: [/юнис|\bunis\b|юнис\s*плюс|юнис\s*2000/i]
  },
  {
    brandKey: 'OSNOVIT',
    brandDisplay: 'Основит (Osnovit)',
    tier: 'STANDARD',
    patterns: [/основит|osnovit/i]
  },
  {
    brandKey: 'STARATELI',
    brandDisplay: 'Старатели (Starateli)',
    tier: 'STANDARD',
    patterns: [/старатели|starateli/i]
  },
  {
    brandKey: 'BOLARS',
    brandDisplay: 'Боларс (Bolars)',
    tier: 'STANDARD',
    patterns: [/боларс|bolars/i]
  },
  {
    brandKey: 'LITOKOL',
    brandDisplay: 'Litokol (Литокол)',
    tier: 'PREMIUM',
    patterns: [/литокол|litokol|литофлекс|litoflex|\bk80\b|\bk55\b/i]
  },
  {
    brandKey: 'MAPEI',
    brandDisplay: 'Mapei (Мапей)',
    tier: 'PREMIUM',
    patterns: [/мапей|mapei|kerabond|adesilex/i]
  },
  {
    brandKey: 'SIKA',
    brandDisplay: 'Sika (Зика)',
    tier: 'PREMIUM',
    patterns: [/\bsika\b|sikaplan|sikaflex|sikatop|waterbar|сика\b|зика\b/i]
  },
  {
    brandKey: 'TIKKURILA',
    brandDisplay: 'Tikkurila (Тиккурила)',
    tier: 'PREMIUM',
    patterns: [/тиккурила|tikkurila|euro\s*power|luja|harmony/i]
  },
  {
    brandKey: 'PICANTE',
    brandDisplay: 'Picante (Пиканте)',
    tier: 'STANDARD',
    patterns: [/\bpicante\b|пиканте/i]
  },
  {
    brandKey: 'TEKS',
    brandDisplay: 'ТЕКС (Teks)',
    tier: 'ECONOMY',
    patterns: [/(?:^|[^а-яa-z])текс(?![а-яa-z])|\bteks\b/i]
  },
  {
    brandKey: 'LAKRA',
    brandDisplay: 'Лакра (Lakra)',
    tier: 'ECONOMY',
    patterns: [/лакра|lakra/i]
  },
  {
    brandKey: 'PENOSIL',
    brandDisplay: 'Penosil (Пеносил)',
    tier: 'PREMIUM',
    patterns: [/пеносил|penosil/i]
  },
  {
    brandKey: 'TYTAN',
    brandDisplay: 'Tytan (Титан)',
    tier: 'PREMIUM',
    patterns: [/титан\s*проф|\btytan\b/i]
  },
  {
    brandKey: 'SOUDAL',
    brandDisplay: 'Soudal (Соудал)',
    tier: 'PREMIUM',
    patterns: [/соудал|soudal/i]
  },
  {
    brandKey: 'KUDO',
    brandDisplay: 'Kudo (Кудо)',
    tier: 'STANDARD',
    patterns: [/кудо|\bkudo\b/i]
  },
  {
    brandKey: 'HILTI',
    brandDisplay: 'Hilti (Хилти)',
    tier: 'PREMIUM',
    patterns: [/\bhilti\b|хилти/i]
  },
  {
    brandKey: 'BOSCH',
    brandDisplay: 'Bosch (Бош)',
    tier: 'PREMIUM',
    patterns: [/\bbosch\b|бош\b/i]
  },
  {
    brandKey: 'MAKITA',
    brandDisplay: 'Makita (Макита)',
    tier: 'PREMIUM',
    patterns: [/\bmakita\b|макита/i]
  },
  {
    brandKey: 'DEWALT',
    brandDisplay: 'DeWalt (Деволт)',
    tier: 'PREMIUM',
    patterns: [/\bdewalt\b|деволт|девальт/i]
  },
  {
    brandKey: 'METABO',
    brandDisplay: 'Metabo (Метабо)',
    tier: 'PREMIUM',
    patterns: [/\bmetabo\b|метабо/i]
  },
  {
    brandKey: 'RENNBOHR',
    brandDisplay: 'Rennbohr',
    tier: 'PREMIUM',
    patterns: [/rennbohr|реннбор/i]
  },
  {
    brandKey: 'ARMATA',
    brandDisplay: 'АРМАТА (Armata)',
    tier: 'ECONOMY',
    patterns: [/армата|\barmata\b/i]
  },
  {
    brandKey: 'MESSER',
    brandDisplay: 'Messer',
    tier: 'PREMIUM',
    patterns: [/\bmesser\b|мессер/i]
  },
  {
    brandKey: 'HANSKONNER',
    brandDisplay: 'Hanskonner',
    tier: 'PREMIUM',
    patterns: [/hanskonner|хансконнер/i]
  },
  {
    brandKey: 'SPETS',
    brandDisplay: 'СПЕЦ (Spets)',
    tier: 'ECONOMY',
    patterns: [/(?:^|[^а-яa-z])спец(?![а-яa-z])/i]
  },
  {
    brandKey: 'ZUBR',
    brandDisplay: 'Зубр (Zubr)',
    tier: 'STANDARD',
    patterns: [/зубр|\bzubr\b/i]
  },
  {
    brandKey: 'KRAFTOOL',
    brandDisplay: 'Kraftool (Крафтул)',
    tier: 'STANDARD',
    patterns: [/крафтул|kraftool/i]
  },
  {
    brandKey: 'STAYER',
    brandDisplay: 'Stayer (Стайер)',
    tier: 'ECONOMY',
    patterns: [/стайер|stayer/i]
  },
  {
    brandKey: 'GIGANT',
    brandDisplay: 'Gigant (Гигант)',
    tier: 'STANDARD',
    patterns: [/\bgigant\b|гигант/i]
  },
  {
    brandKey: 'INFORCE',
    brandDisplay: 'Inforce (Инфорс)',
    tier: 'STANDARD',
    patterns: [/инфорс|inforce/i]
  },
  {
    brandKey: 'GROSS',
    brandDisplay: 'Gross (Гросс)',
    tier: 'PREMIUM',
    patterns: [/\bgross\b|гросс/i]
  },
  {
    brandKey: 'SPARTA_MATRIX',
    brandDisplay: 'Sparta / Matrix (Спарта / Матрикс)',
    tier: 'ECONOMY',
    patterns: [/спарта|\bsparta\b|матрикс|\bmatrix\b|сибртех|ермак/i]
  },
  {
    brandKey: 'LUGA',
    brandDisplay: 'ЛугаАбразив (Luga)',
    tier: 'STANDARD',
    patterns: [/луга|luga/i]
  },
  {
    brandKey: 'KARBOSAN',
    brandDisplay: 'Karbosan (Карбосан)',
    tier: 'PREMIUM',
    patterns: [/карбосан|karbosan/i]
  },
  {
    brandKey: 'ESAB',
    brandDisplay: 'ESAB (ЭСАБ)',
    tier: 'PREMIUM',
    patterns: [/\besab\b|эсаб|ок\s*46|уони\s*esab/i]
  },
  {
    brandKey: 'MONOLIT',
    brandDisplay: 'Monolit (Монолит)',
    tier: 'STANDARD',
    patterns: [/монолит\s*рц|\bmonolit\b/i]
  },
  {
    brandKey: 'ABB',
    brandDisplay: 'ABB',
    tier: 'PREMIUM',
    patterns: [/\babb\b/i]
  },
  {
    brandKey: 'SCHNEIDER',
    brandDisplay: 'Schneider Electric (Шнайдер)',
    tier: 'PREMIUM',
    patterns: [/schneider|шнайдер/i]
  },
  {
    brandKey: 'LEGRAND',
    brandDisplay: 'Legrand (Легран)',
    tier: 'PREMIUM',
    patterns: [/legrand|легран/i]
  },
  {
    brandKey: 'DKC',
    brandDisplay: 'DKC (ДКС)',
    tier: 'PREMIUM',
    patterns: [/\bdkc\b|дкс\b/i]
  },
  {
    brandKey: 'IEK',
    brandDisplay: 'IEK (ИЭК)',
    tier: 'STANDARD',
    patterns: [/\biek\b|иэк\b/i]
  },
  {
    brandKey: 'EKF',
    brandDisplay: 'EKF (ЭКФ)',
    tier: 'STANDARD',
    patterns: [/\bekf\b|экф\b/i]
  },
  {
    brandKey: 'TDM',
    brandDisplay: 'TDM Electric (ТДМ)',
    tier: 'ECONOMY',
    patterns: [/\btdm\b|тдм\b/i]
  }
];

/**
 * Resolves the canonical brand & product series from the original Russian invoice text (`originalName`),
 * combining the 3-layer `extractOriginalBrandAndSeries` engine (which covers sub-brands, density classes,
 * and dynamic unknown brands) with `CANONICAL_BRAND_RULES`.
 */
export function resolveCanonicalBrandFromOriginal(
  originalName?: string,
  fallbackMaterialName?: string
): {
  brandKey: string;
  brandDisplay: string;
  subSeries?: string;
  tier: MaterialQualitySegment;
} {
  const primaryText = String(originalName || '').trim();
  const secondaryText = String(fallbackMaterialName || '').trim();
  const deepInfo = extractOriginalBrandAndSeries(primaryText || secondaryText);
  const searchTargets = primaryText ? [primaryText, `${primaryText} ${secondaryText}`] : [secondaryText];

  for (const target of searchTargets) {
    if (!target) continue;
    for (const rule of CANONICAL_BRAND_RULES) {
      if (rule.patterns.some(p => p.test(target))) {
        let subSeries = deepInfo.seriesLabel;
        if (!subSeries && rule.subSeriesPatterns) {
          const hit = rule.subSeriesPatterns.find(sp => sp.pattern.test(target));
          if (hit) subSeries = hit.seriesName;
        }
        return {
          brandKey: rule.brandKey,
          brandDisplay: rule.brandDisplay,
          subSeries,
          tier: rule.tier
        };
      }
    }
  }

  // Fallback to 3-layer dynamic brand & series extractor (handles unknown Latin/Cyrillic/quoted brands)
  if (deepInfo.brandKey && deepInfo.brandKey !== 'GENERIC') {
    return {
      brandKey: deepInfo.brandKey,
      brandDisplay: deepInfo.brandLabel || deepInfo.brandKey,
      subSeries: deepInfo.seriesLabel,
      tier: deepInfo.tier === 'COMMODITY' ? 'STANDARD' : deepInfo.tier
    };
  }

  return {
    brandKey: 'UNSPECIFIED_STANDARD',
    brandDisplay: 'Standart / Belirtilmemiş Marka',
    subSeries: deepInfo.seriesLabel,
    tier: 'STANDARD'
  };
}

/**
 * Normalizes Russian & English dimensions from different vendor formats into a single canonical geometric signature.
 * Examples handled:
 * - "2500х1200х12,5 мм" === "12.5мм (1,2х2,5м)" === "12,5*1200*2500" -> { thicknessMm: 12.5, sheetDims: "1200x2500", specLabel: "12.5мм (1200x2500)" }
 * - "толщ. 4,0 мм (1х10м)" === "4мм" -> { thicknessMm: 4 }
 * - "1200х600х50 мм" === "50мм 0.6х1.2м" -> { thicknessMm: 50, sheetDims: "600x1200" }
 */
export function normalizeOriginalGeometryAndSpecs(rawOriginal: string): {
  thicknessMm?: number;
  sheetDims?: string;
  weightKg?: number;
  volumeLitre?: number;
  rebarDiameterMm?: number;
  strengthGrade?: string;
  specKey: string;
  specLabel: string;
} {
  const norm = String(rawOriginal || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/(\d)\s*[хx*×]\s*(?=\d)/g, '$1x');

  let thicknessMm: number | undefined;
  let sheetDims: string | undefined;
  let weightKg: number | undefined;
  let volumeLitre: number | undefined;
  let rebarDiameterMm: number | undefined;
  let strengthGrade: string | undefined;

  // 1. Check 3D dimensions (e.g. 2500x1200x12.5 or 12.5x1200x2500 or 1200x600x50)
  const dim3Match = norm.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (dim3Match) {
    const nums = [Number(dim3Match[1]), Number(dim3Match[2]), Number(dim3Match[3])].map(v => {
      // Convert meter sheet dimensions like 1.2 or 2.5 or 3.0 or 0.6 to mm if paired with sheet sizes
      if (v > 0.4 && v <= 6.0 && (v === 1.2 || v === 2.5 || v === 3.0 || v === 0.6 || v === 2.4)) {
        return Math.round(v * 1000);
      }
      return v;
    }).sort((a, b) => a - b);

    if (nums[0] >= 0.5 && nums[0] <= 250 && nums[1] >= 200 && nums[2] >= 300) {
      thicknessMm = nums[0];
      sheetDims = `${nums[1]}x${nums[2]}`;
    } else {
      sheetDims = nums.join('x');
    }
  } else {
    // Check 2D dimensions + separate thickness (e.g., "12.5мм (1.2х2.5м)" or "ГКЛ 12.5 мм 2500х1200")
    const dim2Match = norm.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    if (dim2Match) {
      const a = Number(dim2Match[1]);
      const b = Number(dim2Match[2]);
      const conv = (v: number) => (v >= 0.4 && v <= 6.0 ? Math.round(v * 1000) : v);
      const sorted = [conv(a), conv(b)].sort((x, y) => x - y);
      if (sorted[0] >= 100 && sorted[1] >= 200) {
        sheetDims = `${sorted[0]}x${sorted[1]}`;
      } else if (sorted[0] >= 1 && sorted[0] <= 100 && sorted[1] >= 300) {
        thicknessMm = sorted[0];
      }
    }
  }

  // Explicit thickness detection if not found in 3D (e.g., "12.5 мм", "9.5мм", "толщ. 4.0 мм", "ЭПП-4.0", "50 мм")
  if (!thicknessMm) {
    const thickMatch =
      norm.match(/(?:толщ[а-я.]*\s*|т\.\s*|эпп[\s-]*|ткп[\s-]*|хпп[\s-]*|экп[\s-]*)(\d+(?:\.\d+)?)\s*(?:мм|mm)?/) ||
      norm.match(/(?:^|[^\d.])(9\.5|12\.5|15|3\.0|3\.5|4\.0|4\.5|20|30|40|50|80|100|120|150)\s*(?:мм|mm)(?![а-яa-z0-9])/);
    if (thickMatch && thickMatch[1]) {
      const val = Number(thickMatch[1]);
      if (val >= 1.5 && val <= 250) {
        thicknessMm = val;
      }
    }
  }

  // Default standard drywall sheet size when ГКЛ / ГКЛВ has 9.5mm or 12.5mm thickness
  if (!sheetDims && (thicknessMm === 9.5 || thicknessMm === 12.5) && /гкл|гипсокартон|гипрок|гсп/i.test(norm)) {
    sheetDims = '1200x2500';
  }

  // Bag weight (kg) detection (e.g. 25 кг, 30кг, 20 кг)
  const kgMatch = norm.match(/(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s*(?:кг|kg)(?![а-яa-z])/);
  if (kgMatch) {
    const k = Number(kgMatch[1]);
    if (k >= 1 && k <= 65) weightKg = k;
  }

  // Volume (litre) detection (e.g. 10 л, 20л, 5 л)
  const litMatch = norm.match(/(?:^|[^\d.])(\d{1,3}(?:\.\d+)?)\s*(?:л|lt|литр)(?![а-яa-z])/);
  if (litMatch) {
    const l = Number(litMatch[1]);
    if (l >= 0.5 && l <= 250) volumeLitre = l;
  }

  // Rebar diameter (e.g. ф12, d12, Ø12, 12мм for арматура)
  if (/арматур|inşaat\s*demir|a500c|а500с/i.test(norm)) {
    const diaMatch =
      norm.match(/(?:[dдфø]\s*[:=]?\s*)(\d{1,2})(?![\d.])/) ||
      norm.match(/(?:^|[^\d.])(6|8|10|12|14|16|18|20|22|25|28|32|36|40)\s*(?:мм|mm)/);
    if (diaMatch) {
      rebarDiameterMm = Number(diaMatch[1]);
    }
  }

  // Concrete / Mortar / Steel Grade (e.g. А500С, В25, М300, М150, С245, D500)
  const gradeMatch = norm.match(/(?:^|[^а-яa-z0-9])([аa]500[сc]|[аa]240|[вb]\s*\d{2}|[мm]\s*(?:100|150|200|250|300|350|400|500)|[dд]\s*(?:400|500|600))(?![а-яa-z0-9])/i);
  if (gradeMatch) {
    strengthGrade = gradeMatch[1]
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace('А', 'A')
      .replace('С', 'C')
      .replace('В', 'B')
      .replace('М', 'M')
      .replace('Д', 'D');
  }

  const keyParts: string[] = [];
  const labelParts: string[] = [];

  if (rebarDiameterMm) {
    keyParts.push(`dia_${rebarDiameterMm}`);
    labelParts.push(`Ø${rebarDiameterMm} мм`);
  }
  if (strengthGrade) {
    keyParts.push(`grade_${strengthGrade}`);
    labelParts.push(strengthGrade);
  }
  if (thicknessMm) {
    keyParts.push(`th_${thicknessMm}`);
    labelParts.push(`${thicknessMm} мм`);
  }
  if (sheetDims) {
    keyParts.push(`dim_${sheetDims}`);
    labelParts.push(sheetDims);
  }
  if (weightKg && !rebarDiameterMm && !thicknessMm) {
    keyParts.push(`kg_${weightKg}`);
    labelParts.push(`${weightKg} кг`);
  }
  if (volumeLitre && !thicknessMm) {
    keyParts.push(`lt_${volumeLitre}`);
    labelParts.push(`${volumeLitre} л`);
  }

  // Fallback to SpecSignature from materialGroupIntegrity if none of the above hit
  if (keyParts.length === 0) {
    const fallbackSig = extractSpecSignature(rawOriginal);
    if (fallbackSig.dims) {
      keyParts.push(`dim_${fallbackSig.dims}`);
      labelParts.push(fallbackSig.dims);
    }
    if (fallbackSig.micron) {
      keyParts.push(`mic_${fallbackSig.micron}`);
      labelParts.push(`${fallbackSig.micron} мкм`);
    }
    if (fallbackSig.thread) {
      keyParts.push(`m_${fallbackSig.thread}`);
      labelParts.push(`M${fallbackSig.thread}`);
    }
    if (fallbackSig.pack) {
      keyParts.push(`pack_${fallbackSig.pack}`);
      labelParts.push(`${fallbackSig.pack} шт`);
    }
  }

  return {
    thicknessMm,
    sheetDims,
    weightKg,
    volumeLitre,
    rebarDiameterMm,
    strengthGrade,
    specKey: keyParts.length > 0 ? keyParts.join('_') : 'std_spec',
    specLabel: labelParts.length > 0 ? labelParts.join(' • ') : 'Standart Teknik Ölçü'
  };
}

/**
 * Semantic Product Family Resolver on Original Russian Invoice Text
 * Maps different supplier phrasings of the same construction material into a single canonical family key.
 */
const ORIGINAL_PRODUCT_FAMILY_RULES: Array<{
  familyKey: string;
  titleRu: string;
  titleTr: string;
  isCommodity: boolean;
  pattern: RegExp;
}> = [
  // 1. Drywall / Alçıpan (Brand Sensitive!)
  {
    familyKey: 'DRYWALL_GKLV_MOISTURE',
    titleRu: 'Гипсокартон влагостойкий (ГКЛВ)',
    titleTr: 'Suya Dayanıklı Yeşil Alçıpan Levha (ГКЛВ)',
    isCommodity: false,
    pattern: /гклв|гсп[\s-]*н2|(?:гипсокартон|гипрок|лист\s+гипсокартон)[а-я\s-]*влагостойк/i
  },
  {
    familyKey: 'DRYWALL_GKLO_FIRE',
    titleRu: 'Гипсокартон огнестойкий (ГКЛО)',
    titleTr: 'Yangına Dayanıklı Alçıpan Levha (ГКЛО)',
    isCommodity: false,
    pattern: /гкло|гклво|гсп[\s-]*df|(?:гипсокартон|лист\s+гипсокартон)[а-я\s-]*огнестойк/i
  },
  {
    familyKey: 'DRYWALL_GKL_STANDARD',
    titleRu: 'Гипсокартонный лист стандартный (ГКЛ)',
    titleTr: 'Standart Alçıpan Levha (ГКЛ)',
    isCommodity: false,
    pattern: /(?:^|[^а-яa-z])гкл(?![а-яa-z])|гсп[\s-]*а|гипсокартон|гипрок|gyproc|alçıpan|alcipan/i
  },
  // 2. Waterproofing & Bitumen Membranes (Brand Sensitive: Icopal vs TechnoNICOL vs Izoplast)
  {
    familyKey: 'MEMBRANE_BITUMEN_ROLL',
    titleRu: 'Рулонная битумная гидроизоляция (ЭПП / ТКП / ХПП)',
    titleTr: 'Bitümlü Su Yalıtım Membranı (Rulo)',
    isCommodity: false,
    pattern: /техноэласт|унифлекс|биполь|линокром|бикрост|икопал|icopal|изопласт|izoplast|виллатекс|гидроизоляц[а-я\s]*рулон|мембрана\s+кровельн|кровельн[а-я\s]*рулон/i
  },
  {
    familyKey: 'MEMBRANE_PVC_TPO',
    titleRu: 'ПВХ Мембрана гидроизоляционная (Logicbase / Sikaplan)',
    titleTr: 'PVC Su Yalıtım Membranı',
    isCommodity: false,
    pattern: /sikaplan|logicbase|пвх[\s-]*мембран|мембрана\s+пвх/i
  },
  {
    familyKey: 'BITUMEN_PRIMER',
    titleRu: 'Праймер битумный гидроизоляционный',
    titleTr: 'Bitüm Esaslı Su Yalıtım Astarı (Праймер)',
    isCommodity: false,
    pattern: /праймер\s*битумн|битумн[а-я\s]*праймер|праймер\s*технониколь|праймер\s*икопал/i
  },
  // 3. Thermal Insulation (XPS & Mineral Wool — Brand Sensitive: Penoplex vs TechnoNICOL vs Rockwool vs Baswool)
  {
    familyKey: 'INSULATION_XPS_BOARD',
    titleRu: 'Экструдированный пенополистирол (ЭППС / XPS)',
    titleTr: 'XPS Ekstrüde Polistiren Isı Yalıtım Levhası',
    isCommodity: false,
    pattern: /пеноплэкс|пеноплекс|penoplex|эппс|экструдирован[а-я\s]*пенополистирол|carbon\s*prof|карбон\s*проф|техноплекс|\bxps\b/i
  },
  {
    familyKey: 'INSULATION_MINERAL_WOOL',
    titleRu: 'Утеплитель базальтовый / Минвата (Каменная вата)',
    titleTr: 'Taşyünü / Mineral Yün Isı Yalıtım Levhası',
    isCommodity: false,
    pattern: /минвата|минераловат|каменн[а-я\s]*ват|базальтов[а-я\s]*утеплител|плит[аы]?\s+теплоизоляцион|негорюч[а-я\s]*плит|утеплитель\s*(?:роквул|технониколь|техновент|техноблок|технофас|техноруф|технофлор|роклайт|изовер|урса|baswool|басвул)|роквул|rockwool|роклайт|техновент|техноблок|технофас|техноруф|технофлор|baswool|басвул|лайт\s*баттс/i
  },
  // 4. Plasters, Putty, Tile Adhesives, Primers (Brand Sensitive: Knauf vs Volma vs Ceresit vs Vetonit)
  {
    familyKey: 'GYPSUM_PLASTER_MIX',
    titleRu: 'Штукатурка гипсовая сухая смесь',
    titleTr: 'Alçı Sıva (Гипсовая штукатурка)',
    isCommodity: false,
    pattern: /ротбанд|rotband|волма[\s-]*слой|штукатурк[а-я\s]*гипсов|гипсов[а-я\s]*штукатурк|мп[\s-]*75|\bmp[\s-]*75\b|гольдбанд/i
  },
  {
    familyKey: 'CEMENT_PLASTER_MIX',
    titleRu: 'Штукатурка цементная фасадная / выравнивающая',
    titleTr: 'Çimento Esaslı Sıva Harcı',
    isCommodity: false,
    pattern: /штукатурк[а-я\s]*цементн|цементн[а-я\s]*штукатурк|унтерпутц|севенер/i
  },
  {
    familyKey: 'PUTTY_SHPAKLEVKA',
    titleRu: 'Шпаклевка строительная (Финишная / Базовая)',
    titleTr: 'Macun / Yoklama Alçısı (Шпаклевка)',
    isCommodity: false,
    pattern: /шпаклевк|шпатлевк|фуген|fugen|ветонит\s*лр|vetonit\s*lr/i
  },
  {
    familyKey: 'TILE_ADHESIVE_KLEY',
    titleRu: 'Клей плиточный усиленный / стандартный',
    titleTr: 'Seramik & Fayans Yapıştırıcısı (Плиточный клей)',
    isCommodity: false,
    pattern: /клей\s*плиточн|плиточн[а-я\s]*клей|церезит\s*см|ceresit\s*cm|литофлекс|litoflex|юнис\s*плюс|юнис\s*2000/i
  },
  {
    familyKey: 'ACRYLIC_PRIMER_GRUNTOVKA',
    titleRu: 'Грунтовка глубокого проникновения / Бетоконтакт',
    titleTr: 'Akrilik Astar / Betokontakt (Грунтовка)',
    isCommodity: false,
    pattern: /грунтовк|тифенгрунд|tiefengrund|бетоконтакт|бетонконтакт|\bст\s*17\b|\bct\s*17\b/i
  },
  {
    familyKey: 'POLYURETHANE_FOAM',
    titleRu: 'Пена монтажная профессиональная',
    titleTr: 'Poliüretan Montaj Köpüğü (Монтажная пена)',
    isCommodity: false,
    pattern: /пена\s*монтажн|монтажн[а-я\s]*пен/i
  },
  {
    familyKey: 'PAINT_EMULSION_ENAMEL',
    titleRu: 'Краска водоэмульсионная / Эмаль строительная',
    titleTr: 'İç/Dış Cephe Boyası & Emaye Boya',
    isCommodity: false,
    pattern: /краска\s*(?:водоэмульсион|водно[\s-]*дисперсион|акрилов|интерьерн|фасадн|матов|моющая|огнезащитн)|эмаль\s*(?:пф|алкидн|акрилов|грунт)/i
  },
  // 5. Power Tools, Drill Bits, Cutting Discs, Welding Electrodes (Brand Sensitive)
  {
    familyKey: 'SDS_CONCRETE_DRILL',
    titleRu: 'Бур по бетону SDS-plus / SDS-max',
    titleTr: 'Beton Matkap Ucu (Бур по бетону SDS)',
    isCommodity: false,
    pattern: /(?:^|[^а-яa-z])бур\s*(?:по\s*бетону|sds|сдс|армата|rennbohr|квадро|quadro)|сверло\s*по\s*бетону/i
  },
  {
    familyKey: 'ABRASIVE_CUTTING_DISC',
    titleRu: 'Круг отрезной по металлу / бетону (Диск УШМ)',
    titleTr: 'Metal / Beton Kesici & Taşlama Diski',
    isCommodity: false,
    pattern: /круг\s*отрезн|диск\s*отрезн|круг\s*шлифовальн|диск\s*алмазн/i
  },
  {
    familyKey: 'WELDING_ELECTRODES',
    titleRu: 'Электроды сварочные покрытые',
    titleTr: 'Kaynak Elektrodu (Сварочные электроды)',
    isCommodity: false,
    pattern: /электрод[ыа]?\s*(?:сварочн|мр[\s-]*3|уони|ок\s*46|монолит|эсаб|esab)/i
  },
  // 6. Structural Commodities (Brand Independent! GOST/DIN rules)
  {
    familyKey: 'COMMODITY_REBAR_A500C',
    titleRu: 'Арматура строительная рифленая (ГОСТ 34028)',
    titleTr: 'Nervürlü İnşaat Demiri (GOST 34028)',
    isCommodity: true,
    pattern: /арматур[аы]?\s*(?:а500|a500|а240|a240|а400|рифлен|гладк|ст3|35гс|25г2с)|\bарматура\b/i
  },
  {
    familyKey: 'COMMODITY_STEEL_PIPE_PROFILE',
    titleRu: 'Труба стальная профильная / электросварная (ГОСТ)',
    titleTr: 'Çelik Kutu Profil & Dikişli Boru (GOST)',
    isCommodity: true,
    pattern: /труба\s*(?:профильн|э\/с|электросварн|вгп|бесшовн|стальн|квадратн|прямоугольн)/i
  },
  {
    familyKey: 'COMMODITY_STEEL_CHANNEL_ANGLE_SHEET',
    titleRu: 'Металлопрокат: Швеллер / Уголок / Лист стальной / Полоса',
    titleTr: 'Yapısal Çelik: Köşebent / Şveller / Çelik Sac / Lama',
    isCommodity: true,
    pattern: /швеллер|уголок\s*(?:стальн|равнополок|\d)|двутавр|лист\s*(?:стальн|г\/к|х\/к|рифлен|оцинк)|полоса\s*(?:стальн|оцинк)|сетка\s*сварн|катанка|проволока\s*вязальн/i
  },
  {
    familyKey: 'COMMODITY_READY_MIX_CONCRETE',
    titleRu: 'Бетон товарный готовый / ЦПС / Пескобетон (ГОСТ)',
    titleTr: 'Hazır Beton & Kuru Şap Harcı (ЦПС / Пескобетон)',
    isCommodity: true,
    pattern: /бетон\s*(?:товарн|готов|в\d|b\d|м\d|m\d)|пескобетон|смесь\s*сухая\s*(?:м150|м300|универсальн)|цпс\b/i
  },
  {
    familyKey: 'COMMODITY_TIMBER_PLYWOOD',
    titleRu: 'Пиломатериалы: Доска обрезная / Брус / Фанера ФСФ',
    titleTr: 'İnşaatlık Kereste, Kalas & Kalıplık Kontrplak',
    isCommodity: true,
    pattern: /доска\s*обрезн|брус\s*(?:обрезн|деревян|\d)|фанера\s*(?:фсф|фоф|ламинир|березов)/i
  }
];

/**
 * Analyzes an invoice item or history entry strictly prioritizing `originalName` (original Russian text on invoice)
 * while applying smart semantic normalization so different vendor phrasings of the same material & brand match accurately.
 */
export function buildSmartOriginalSignature(params: {
  originalName?: string;
  materialName?: string;
  category?: string;
  unit?: string;
  unitPrice?: number;
}): SmartOriginalInvoiceSignature {
  const rawOrig = String(params.originalName || '').trim();
  const fallbackMat = String(params.materialName || '').trim();
  // Strictly prefer originalName for technical & brand reasoning!
  const analysisSourceText = rawOrig || fallbackMat;

  const segAnalysis = analyzeMaterialSegment(fallbackMat, rawOrig, params.category, params.unitPrice);
  const brandInfo = resolveCanonicalBrandFromOriginal(rawOrig, fallbackMat);
  const geoSpecs = normalizeOriginalGeometryAndSpecs(analysisSourceText);

  // Match canonical product family from original text first, then fallback
  let matchedFamily = ORIGINAL_PRODUCT_FAMILY_RULES.find(f => f.pattern.test(analysisSourceText));
  if (!matchedFamily && fallbackMat && rawOrig) {
    matchedFamily = ORIGINAL_PRODUCT_FAMILY_RULES.find(f => f.pattern.test(`${rawOrig} ${fallbackMat}`));
  }

  const isCommodity = matchedFamily ? matchedFamily.isCommodity : segAnalysis.comparisonMode === 'COMMODITY_STANDARD';

  let canonicalFamilyKey = matchedFamily?.familyKey || '';
  let canonicalFamilyTitleRu = matchedFamily?.titleRu || rawOrig || fallbackMat;
  let canonicalFamilyTitleTr = matchedFamily?.titleTr || fallbackMat || rawOrig;

  if (!canonicalFamilyKey) {
    // Strip brand names and numbers from original text to create a clean technical family key
    let stripped = analysisSourceText
      .toLowerCase()
      .replace(/ё/g, 'е');
    CANONICAL_BRAND_RULES.forEach(r => {
      r.patterns.forEach(p => {
        stripped = stripped.replace(new RegExp(p.source, 'gi'), ' ');
      });
    });
    stripped = stripped
      .replace(/\b(?:ооо|ао|зао|ип|гост|ту|арт|код)\b[^,;\s]*/gi, ' ')
      .replace(/[^a-zа-яğüşıöç\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length >= 3)
      .slice(0, 3)
      .join('_');

    canonicalFamilyKey = stripped ? `FAM_${stripped.toUpperCase()}` : `FAM_${(params.category || 'GEN').toUpperCase()}`;
  }

  const formattedBrandDisplay = isCommodity
    ? 'GOST / DIN Standart (Marka Bağımsız)'
    : brandInfo.subSeries && !brandInfo.brandDisplay.toLowerCase().includes(brandInfo.subSeries.toLowerCase())
      ? `${brandInfo.brandDisplay} • ${brandInfo.subSeries}`
      : brandInfo.brandDisplay;

  return {
    rawOriginalText: analysisSourceText,
    isCommodity,
    canonicalFamilyKey,
    canonicalFamilyTitleRu,
    canonicalFamilyTitleTr,
    canonicalSpecKey: geoSpecs.specKey,
    canonicalSpecLabel: geoSpecs.specLabel,
    canonicalBrandKey: isCommodity ? 'COMMODITY_GOST' : brandInfo.brandKey,
    canonicalBrandDisplay: formattedBrandDisplay,
    subBrandOrSeries: brandInfo.subSeries,
    qualitySegment: isCommodity ? 'COMMODITY' : brandInfo.tier,
    normalizedDimensions: geoSpecs.sheetDims,
    thicknessMm: geoSpecs.thicknessMm,
    weightKg: geoSpecs.weightKg,
    volumeLitre: geoSpecs.volumeLitre,
    rebarDiameterMm: geoSpecs.rebarDiameterMm
  };
}

/**
 * Mode 1 (Elma-Elma Birebir Kıyaslama) Transformer:
 * Takes existing MaterialComparison items and ensures:
 * 1) For COMMODITY_STANDARD (Rebar, Steel, Concrete, Timber): All purchases with identical technical spec stay grouped together regardless of brand.
 * 2) For BRAND_SEGMENTED materials (Drywall, Waterproofing, Insulation, Plaster, Paint, Tools, PPE):
 *    - If a MaterialComparison group contains multiple distinct brands OR distinct product series/densities (e.g. ТЕХНОВЕНТ Н vs Baswool Фасад 120),
 *      it automatically splits them into separate Apple-to-Apple rows by `[CanonicalFamily + CanonicalSpec + CanonicalBrand + ProductSeries]`!
 *    - Conversely, if different suppliers wrote the same brand & spec in different ways (`КНАУФ ГКЛ 2500х1200х12,5` and `Гипсокартон Knauf 12.5мм`),
 *      they stay unified in the same Apple-to-Apple row and their distinct original invoice writings are exposed for full transparency!
 */
export function buildMode1AppleToAppleComparisons(
  comparisons: MaterialComparison[]
): Array<MaterialComparison & {
  smartSignature?: SmartOriginalInvoiceSignature;
  mergedOriginalWritings?: string[];
  detectedBrandDisplay?: string;
  isBrandSeparatedInMode1?: boolean;
}> {
  const result: Array<MaterialComparison & {
    smartSignature?: SmartOriginalInvoiceSignature;
    mergedOriginalWritings?: string[];
    detectedBrandDisplay?: string;
    isBrandSeparatedInMode1?: boolean;
  }> = [];

  const FREIGHT_REGEX = /\b(доставка|транспортн|автоуслуг|перевозк|манипулятор|логистик|погруз|разгруз|резка|рубка|услуг[аи]?|аренда|nakliye|teslimat|kargo|sevkiyat|lojistik|vinç|kesim|indirme|yükleme)\b/i;

  // Sunucu fiyatları %22 KDV dahil tabanda gönderir (normalizedUnitPrice = brüt); net yalnızca bilgi amaçlıdır.
  const computeGrossStats = (histRows: MaterialComparison['history']) => {
    const stats = (prices: number[]) => {
      const list = prices.filter(p => p > 0);
      return list.length > 0
        ? {
            min: Number(Math.min(...list).toFixed(2)),
            max: Number(Math.max(...list).toFixed(2)),
            avg: Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(2))
          }
        : { min: 0, max: 0, avg: 0 };
    };
    const gross = stats(histRows.map(h => Number(h.normalizedUnitPrice ?? h.unitPrice) || Number(h.grossUnitPrice) || 0));
    const net = stats(histRows.map(h => Number((h as any).normalizedNetUnitPrice ?? h.unitPriceNet) || 0));
    return {
      minGrossUnitPrice: gross.min,
      maxGrossUnitPrice: gross.max,
      avgGrossUnitPrice: gross.avg,
      minNetUnitPrice: net.min,
      maxNetUnitPrice: net.max,
      avgNetUnitPrice: net.avg
    };
  };

  comparisons.forEach(comp => {
    if (FREIGHT_REGEX.test(comp.materialName || '')) return;
    const history = (comp.history || []).filter(
      h => !FREIGHT_REGEX.test(`${h.originalName || ''} ${comp.materialName || ''}`)
    );
    if (history.length === 0) {
      return;
    }

    // Analyze each history line using its originalName
    const annotatedHistory = history.map(h => {
      const sig = buildSmartOriginalSignature({
        originalName: h.originalName,
        materialName: comp.materialName,
        category: comp.category,
        unit: h.unit || comp.unit,
        unitPrice: h.normalizedUnitPrice ?? h.unitPrice
      });
      return { h, sig };
    });

    // Check if commodity
    const isGroupCommodity = annotatedHistory.every(x => x.sig.isCommodity);
    if (isGroupCommodity) {
      const writings = Array.from(new Set(annotatedHistory.map(x => x.h.originalName).filter(Boolean))) as string[];
      const grossStats = computeGrossStats(history);
      result.push({
        ...comp,
        history,
        minGrossUnitPrice: comp.minGrossUnitPrice ?? grossStats.minGrossUnitPrice,
        maxGrossUnitPrice: comp.maxGrossUnitPrice ?? grossStats.maxGrossUnitPrice,
        avgGrossUnitPrice: comp.avgGrossUnitPrice ?? grossStats.avgGrossUnitPrice,
        smartSignature: annotatedHistory[0]?.sig,
        mergedOriginalWritings: writings,
        detectedBrandDisplay: 'GOST / DIN Standart (Marka Bağımsız)',
        isBrandSeparatedInMode1: false
      });
      return;
    }

    // Group history entries strictly by Canonical Brand + Product Series/Density
    const getEntryMode1BucketKey = (sig: SmartOriginalInvoiceSignature) => {
      const bKey = sig.canonicalBrandKey === 'UNSPECIFIED_STANDARD' ? 'DIGER_BELIRTILMEMIS' : sig.canonicalBrandKey;
      const sKey = sig.subBrandOrSeries ? `__${sig.subBrandOrSeries}` : '';
      return `${bKey}${sKey}`;
    };

    const distinctBuckets = Array.from(
      new Set(annotatedHistory.map(x => getEntryMode1BucketKey(x.sig)))
    );

    // If there are 2 or more distinct Brand+Series buckets inside the same comparison row, split them for Mode 1!
    if (distinctBuckets.length > 1) {
      const byBrandMap = new Map<string, typeof annotatedHistory>();
      annotatedHistory.forEach(item => {
        const bucketKey = getEntryMode1BucketKey(item.sig);
        if (!byBrandMap.has(bucketKey)) {
          byBrandMap.set(bucketKey, []);
        }
        byBrandMap.get(bucketKey)!.push(item);
      });

      byBrandMap.forEach((items, bKey) => {
        const subHistory = items.map(x => x.h);
        const firstSig = items[0].sig;
        const brandLabel = firstSig.canonicalBrandDisplay;
        let totalSpend = 0;
        let totalNetSpend = 0;
        let totalQty = 0;
        subHistory.forEach(h => {
          const qty = Number(h.normalizedQuantity ?? h.quantity) || 0;
          const price = Number(h.normalizedUnitPrice ?? h.unitPrice) || 0;
          const spend = (Number(h.originalUnitPrice ?? price) || 0) * (Number(h.originalQuantity ?? qty) || 1);
          const netPrice = Number((h as any).originalNetUnitPrice ?? h.unitPriceNet) || 0;
          totalSpend += spend;
          totalNetSpend += netPrice * (Number(h.originalQuantity ?? qty) || 1);
          totalQty += qty;
        });

        const unitPrices = subHistory.map(h => Number(h.normalizedUnitPrice ?? h.unitPrice) || 0).filter(p => p > 0);
        const minUnitPrice = unitPrices.length > 0 ? Math.min(...unitPrices) : 0;
        const maxUnitPrice = unitPrices.length > 0 ? Math.max(...unitPrices) : 0;
        const avgUnitPrice = totalQty > 0 ? totalSpend / totalQty : (unitPrices.length > 0 ? unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length : 0);
        const priceDiffPct = minUnitPrice > 0 && maxUnitPrice > minUnitPrice
          ? Math.round(((maxUnitPrice - minUnitPrice) / minUnitPrice) * 100)
          : 0;

        const cheapestEntry = subHistory.find(h => (Number(h.normalizedUnitPrice ?? h.unitPrice) || 0) === minUnitPrice);
        const priciestEntry = subHistory.find(h => (Number(h.normalizedUnitPrice ?? h.unitPrice) || 0) === maxUnitPrice);
        const writings = Array.from(new Set(subHistory.map(h => h.originalName).filter(Boolean))) as string[];
        const grossStats = computeGrossStats(subHistory);

        const baseCleanName = comp.materialName.replace(/\s*—\s*\[.*\]$/i, '').trim();
        const mode1Name = bKey.startsWith('DIGER_BELIRTILMEMIS') && !firstSig.subBrandOrSeries
          ? `${baseCleanName} — [Markasız / Standart]`
          : `${baseCleanName} — [${brandLabel}]`;

        result.push({
          ...comp,
          id: `${comp.id || comp.materialName}__BRAND_${bKey}`,
          materialName: mode1Name,
          brand: brandLabel,
          qualitySegment: firstSig.qualitySegment,
          history: subHistory,
          totalQuantityPurchased: Number(totalQty.toFixed(2)),
          totalSpend: Math.round(totalSpend),
          minUnitPrice: Number(minUnitPrice.toFixed(2)),
          maxUnitPrice: Number(maxUnitPrice.toFixed(2)),
          averageUnitPrice: Number(avgUnitPrice.toFixed(2)),
          avgUnitPrice: Number(avgUnitPrice.toFixed(2)),
          minGrossUnitPrice: grossStats.minGrossUnitPrice,
          maxGrossUnitPrice: grossStats.maxGrossUnitPrice,
          avgGrossUnitPrice: grossStats.avgGrossUnitPrice,
          minNetUnitPrice: grossStats.minNetUnitPrice,
          maxNetUnitPrice: grossStats.maxNetUnitPrice,
          avgNetUnitPrice: totalQty > 0 && totalNetSpend > 0 ? Number((totalNetSpend / totalQty).toFixed(2)) : grossStats.avgNetUnitPrice,
          priceDifferencePercentage: priceDiffPct,
          cheapestJobsite: cheapestEntry?.jobsiteName || comp.cheapestJobsite,
          cheapestJobsiteName: cheapestEntry?.jobsiteName || comp.cheapestJobsiteName,
          priciestJobsite: priciestEntry?.jobsiteName || comp.priciestJobsite,
          priciestJobsiteName: priciestEntry?.jobsiteName || comp.priciestJobsiteName,
          smartSignature: firstSig,
          mergedOriginalWritings: writings,
          detectedBrandDisplay: brandLabel,
          isBrandSeparatedInMode1: true
        });
      });
    } else {
      const dominantSig = annotatedHistory.find(x => x.sig.canonicalBrandKey !== 'UNSPECIFIED_STANDARD')?.sig || annotatedHistory[0].sig;
      const writings = Array.from(new Set(annotatedHistory.map(x => x.h.originalName).filter(Boolean))) as string[];
      const grossStats = computeGrossStats(history);
      result.push({
        ...comp,
        history,
        minGrossUnitPrice: comp.minGrossUnitPrice ?? grossStats.minGrossUnitPrice,
        maxGrossUnitPrice: comp.maxGrossUnitPrice ?? grossStats.maxGrossUnitPrice,
        avgGrossUnitPrice: comp.avgGrossUnitPrice ?? grossStats.avgGrossUnitPrice,
        brand: dominantSig.canonicalBrandDisplay,
        smartSignature: dominantSig,
        mergedOriginalWritings: writings,
        detectedBrandDisplay: dominantSig.canonicalBrandDisplay,
        isBrandSeparatedInMode1: false
      });
    }
  });

  return result;
}

/**
 * Curated Russian Construction Market Reference Families (used to enrich Mode 2 when a technical family has only 1 brand in current invoices,
 * or to guarantee instant simulation of flagship pairs like Knauf vs Volma and Icopal vs TechnoNICOL alongside live invoice data)
 */
const REFERENCE_EQUIVALENT_BENCHMARKS: Array<{
  familyKey: string;
  specKey: string;
  category: string;
  unit: string;
  titleRu: string;
  titleTr: string;
  specLabel: string;
  originalSpecSummary: string;
  referenceBrands: Array<{
    brandKey: string;
    brandDisplay: string;
    qualitySegment: MaterialQualitySegment;
    avgUnitPrice: number;
    minUnitPrice: number;
    maxUnitPrice: number;
    sampleOriginalWriting: string;
    sampleSupplier: string;
    sampleJobsite: string;
    sampleQty: number;
  }>;
}> = [
  {
    familyKey: 'DRYWALL_GKL_STANDARD',
    specKey: 'th_12.5_dim_1200x2500',
    category: 'Alçıpan, Yalıtım & Membran',
    unit: 'adet',
    titleRu: 'Гипсокартонный лист стандартный (ГКЛ) 12,5х1200х2500 мм',
    titleTr: 'Standart Alçıpan Levha (ГКЛ) — 12.5mm (1200x2500)',
    specLabel: '12.5 мм • 1200x2500 (3.0 m²/levha)',
    originalSpecSummary: 'ГКЛ ГОСТ 6266 / ГОСТ 32614 • Толщина 12.5 мм • Размер 1200х2500 мм',
    referenceBrands: [
      {
        brandKey: 'KNAUF',
        brandDisplay: 'Knauf (Кнауф)',
        qualitySegment: 'PREMIUM',
        avgUnitPrice: 465,
        minUnitPrice: 448,
        maxUnitPrice: 485,
        sampleOriginalWriting: 'Гипсокартонный лист КНАУФ ГКЛ 2500х1200х12,5 мм',
        sampleSupplier: 'ООО Петроविч / ТД СтройМастер',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 1200
      },
      {
        brandKey: 'VOLMA',
        brandDisplay: 'Volma (Волма)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 382,
        minUnitPrice: 368,
        maxUnitPrice: 395,
        sampleOriginalWriting: 'Лист гипсокартонный ВОЛМА ГКЛ 12,5х1200х2500 мм',
        sampleSupplier: 'ООО Сатурн СтройМаркет',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 1200
      },
      {
        brandKey: 'GYPROC',
        brandDisplay: 'Gyproc (Гипрок)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 418,
        minUnitPrice: 405,
        maxUnitPrice: 430,
        sampleOriginalWriting: 'ГКЛ Gyproc Оптима 12.5мм (1,2х2,5м)',
        sampleSupplier: 'ООО КомплектСервис',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 800
      }
    ]
  },
  {
    familyKey: 'DRYWALL_GKLV_MOISTURE',
    specKey: 'th_12.5_dim_1200x2500',
    category: 'Alçıpan, Yalıtım & Membran',
    unit: 'adet',
    titleRu: 'Гипсокартон влагостойкий (ГКЛВ) 12,5х1200х2500 мм',
    titleTr: 'Suya Dayanıklı Yeşil Alçıpan Levha (ГКЛВ) — 12.5mm (1200x2500)',
    specLabel: '12.5 мм • 1200x2500 • Влагостойкий (ГКЛВ)',
    originalSpecSummary: 'ГКЛВ влагостойкий ГОСТ 32614 • Толщина 12.5 мм • Размер 1200х2500 мм',
    referenceBrands: [
      {
        brandKey: 'KNAUF',
        brandDisplay: 'Knauf (Кнауф)',
        qualitySegment: 'PREMIUM',
        avgUnitPrice: 590,
        minUnitPrice: 570,
        maxUnitPrice: 615,
        sampleOriginalWriting: 'ГКЛВ КНАУФ влагостойкий 2500х1200х12,5 мм',
        sampleSupplier: 'СТД Петрович',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 950
      },
      {
        brandKey: 'VOLMA',
        brandDisplay: 'Volma (Волма)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 485,
        minUnitPrice: 470,
        maxUnitPrice: 505,
        sampleOriginalWriting: 'Гипсокартон ВОЛМА ГКЛВ 12.5мм (1,2х2,5м) влагостойкий',
        sampleSupplier: 'ООО СтройКомплект',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 950
      },
      {
        brandKey: 'MAGMA',
        brandDisplay: 'Magma (Магма)',
        qualitySegment: 'ECONOMY',
        avgUnitPrice: 452,
        minUnitPrice: 440,
        maxUnitPrice: 465,
        sampleOriginalWriting: 'Лист ГКЛВ Магма 12,5*1200*2500 влагостойкий',
        sampleSupplier: 'ООО РегионСнаб',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 600
      }
    ]
  },
  {
    familyKey: 'MEMBRANE_BITUMEN_ROLL',
    specKey: 'th_4',
    category: 'Alçıpan, Yalıtım & Membran',
    unit: 'm²',
    titleRu: 'Рулонная наплавляемая гидроизоляция ЭПП (Толщина 4,0 мм)',
    titleTr: 'Bitümlü Su Yalıtım Membranı (ЭПП 4.0 mm — Polyester Keçeli)',
    specLabel: '4.0 мм • Полиэфир (ЭПП)',
    originalSpecSummary: 'Гидроизоляция рулонная наплавляемая СБС-модифицированная • ЭПП • Толщина 4.0 мм',
    referenceBrands: [
      {
        brandKey: 'ICOPAL',
        brandDisplay: 'Icopal (Икопал)',
        qualitySegment: 'PREMIUM',
        avgUnitPrice: 495,
        minUnitPrice: 475,
        maxUnitPrice: 520,
        sampleOriginalWriting: 'Гидроизоляция ИКОПАЛ Ультра Н ЭПП 4,0 мм (рул. 10 м2)',
        sampleSupplier: 'ООО КровляПроф',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 3500
      },
      {
        brandKey: 'TECHNONICOL',
        brandDisplay: 'ТехноНИКОЛЬ (TechnoNICOL)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 368,
        minUnitPrice: 350,
        maxUnitPrice: 388,
        sampleOriginalWriting: 'Рулонный материал Техноэласт ЭПП-4,0 (1х10м) ТехноНИКОЛЬ',
        sampleSupplier: 'ООО ТехноНИКОЛЬ-Строительные Системы',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 3500
      },
      {
        brandKey: 'IZOPLAST',
        brandDisplay: 'Изопласт (Izoplast)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 325,
        minUnitPrice: 310,
        maxUnitPrice: 340,
        sampleOriginalWriting: 'Материал гидроизоляционный Изопласт ЭПП-4.0',
        sampleSupplier: 'ООО Изомаркет',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 2000
      }
    ]
  },
  {
    familyKey: 'INSULATION_XPS_BOARD',
    specKey: 'th_50',
    category: 'Alçıpan, Yalıtım & Membran',
    unit: 'm³',
    titleRu: 'Экструдированный пенополистирол ЭППС / XPS (Толщина 50 мм)',
    titleTr: 'XPS Isı Yalıtım Levhası — 50 mm (Пеноплэкс vs ТехноНИКОЛЬ)',
    specLabel: '50 мм • 1185x585 • ЭППС',
    originalSpecSummary: 'Плита теплоизоляционная ЭППС (XPS) • Толщина 50 мм • Прочность на сжатие ≥0.25 МПа',
    referenceBrands: [
      {
        brandKey: 'PENOPLEX',
        brandDisplay: 'Пеноплэкс (Penoplex)',
        qualitySegment: 'PREMIUM',
        avgUnitPrice: 7450,
        minUnitPrice: 7200,
        maxUnitPrice: 7750,
        sampleOriginalWriting: 'Плита теплоизоляционная ПЕНОПЛЭКС Комфорт 1185х585х50 мм',
        sampleSupplier: 'ООО СтройДвор',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 180
      },
      {
        brandKey: 'TECHNONICOL',
        brandDisplay: 'ТехноНИКОЛЬ (TechnoNICOL)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 6680,
        minUnitPrice: 6490,
        maxUnitPrice: 6890,
        sampleOriginalWriting: 'Экструзионный пенополистирол ТехноНИКОЛЬ CARBON PROF 1180х580х50 мм',
        sampleSupplier: 'ООО ТН-Снаб',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 180
      }
    ]
  },
  {
    familyKey: 'GYPSUM_PLASTER_MIX',
    specKey: 'kg_30',
    category: 'Harç, Sıva & Yapı Kimyasalları',
    unit: 'torba',
    titleRu: 'Штукатурка гипсовая сухая смесь (Мешок 30 кг)',
    titleTr: 'Alçı Sıva Harcı — 30 kg Torba (Кнауф-Ротбанд vs Волма-Слой)',
    specLabel: '30 кг • Гипсовая штукатурка',
    originalSpecSummary: 'Смесь сухая штукатурная на гипсовом вяжущем ГОСТ 31377 • Фасовка 30 кг',
    referenceBrands: [
      {
        brandKey: 'KNAUF',
        brandDisplay: 'Knauf (Кнауф)',
        qualitySegment: 'PREMIUM',
        avgUnitPrice: 615,
        minUnitPrice: 590,
        maxUnitPrice: 645,
        sampleOriginalWriting: 'Штукатурка гипсовая КНАУФ-Ротбанд 30 кг мешок',
        sampleSupplier: 'СТД Петрович',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 1500
      },
      {
        brandKey: 'VOLMA',
        brandDisplay: 'Volma (Волма)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 495,
        minUnitPrice: 478,
        maxUnitPrice: 515,
        sampleOriginalWriting: 'Смесь сухая штукатурная гипсовая ВОЛМА-Слой 30 кг',
        sampleSupplier: 'ООО Сатурн',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 1500
      },
      {
        brandKey: 'STARATELI',
        brandDisplay: 'Старатели (Starateli)',
        qualitySegment: 'STANDARD',
        avgUnitPrice: 468,
        minUnitPrice: 455,
        maxUnitPrice: 485,
        sampleOriginalWriting: 'Штукатурка гипсовая Старатели белая 30кг',
        sampleSupplier: 'ООО СтройБаза',
        sampleJobsite: 'Referans Piyasa / Şantiye Verisi',
        sampleQty: 900
      }
    ]
  }
];

/**
 * Mode 2 (Muadil Marka & Alternatif Ekonomi Analizi) Engine:
 * Groups non-commodity materials by their Original Technical Signature (`canonicalFamilyKey + canonicalSpecKey + normalizedUnit`)
 * across different brands, and computes:
 * - Each brand's weighted average & minimum unit price, jobsites, suppliers, and distinct original invoice writings
 * - Automatic savings potential if pricier brands were switched to the cheapest equivalent brand
 */
export function buildMode2CrossBrandFamilies(
  comparisons: MaterialComparison[]
): CrossBrandEquivalentFamily[] {
  const familyBuckets = new Map<
    string,
    {
      category: string;
      unit: string;
      sig: SmartOriginalInvoiceSignature;
      entries: Array<{
        h: MaterialComparison['history'][0];
        sig: SmartOriginalInvoiceSignature;
      }>;
    }
  >();

  comparisons.forEach(comp => {
    const history = comp.history || [];
    history.forEach(h => {
      const sig = buildSmartOriginalSignature({
        originalName: h.originalName,
        materialName: comp.materialName,
        category: comp.category,
        unit: h.unit || comp.unit,
        unitPrice: h.normalizedUnitPrice ?? h.unitPrice
      });

      // Commodities (rebar, steel, concrete, timber) are brand-agnostic and don't belong to Mode 2 brand substitution
      if (sig.isCommodity) return;

      // Group strictly by canonical technical family + canonical technical spec + unit
      const unitNorm = (comp.unit || h.unit || 'adet').toLowerCase().trim();
      const bucketId = `${sig.canonicalFamilyKey}__${sig.canonicalSpecKey}__${unitNorm}`;

      if (!familyBuckets.has(bucketId)) {
        familyBuckets.set(bucketId, {
          category: comp.category,
          unit: comp.unit || h.unit || 'adet',
          sig,
          entries: []
        });
      }
      familyBuckets.get(bucketId)!.entries.push({ h, sig });
    });
  });

  const families: CrossBrandEquivalentFamily[] = [];
  const coveredReferenceKeys = new Set<string>();

  familyBuckets.forEach((bucket, bucketId) => {
    const brandMap = new Map<string, Array<{ h: MaterialComparison['history'][0]; sig: SmartOriginalInvoiceSignature }>>();
    bucket.entries.forEach(item => {
      const bKey = item.sig.subBrandOrSeries
        ? `${item.sig.canonicalBrandKey}__${item.sig.subBrandOrSeries}`
        : item.sig.canonicalBrandKey;
      if (!brandMap.has(bKey)) {
        brandMap.set(bKey, []);
      }
      brandMap.get(bKey)!.push(item);
    });

    // Check if there is a matching reference benchmark to enrich single-brand families with market equivalent brands
    const refBench = REFERENCE_EQUIVALENT_BENCHMARKS.find(
      r => r.familyKey === bucket.sig.canonicalFamilyKey &&
           (r.specKey === bucket.sig.canonicalSpecKey || bucket.sig.canonicalSpecKey.includes(r.specKey.split('_')[1] || '__'))
    );

    let isReferenceEnriched = false;
    if (refBench) {
      coveredReferenceKeys.add(`${refBench.familyKey}__${refBench.specKey}`);
      const existingBaseBrands = new Set(bucket.entries.map(e => e.sig.canonicalBrandKey));
      refBench.referenceBrands.forEach(rb => {
        if (!existingBaseBrands.has(rb.brandKey) && !brandMap.has(rb.brandKey)) {
          isReferenceEnriched = true;
          brandMap.set(rb.brandKey, [
            {
              h: {
                date: new Date().toISOString().split('T')[0],
                jobsiteName: rb.sampleJobsite,
                supplier: rb.sampleSupplier,
                unitPrice: rb.avgUnitPrice,
                normalizedUnitPrice: rb.avgUnitPrice,
                quantity: rb.sampleQty,
                normalizedQuantity: rb.sampleQty,
                unit: bucket.unit,
                invoiceNumber: 'REF-PIYASA-MUADIL',
                originalName: rb.sampleOriginalWriting
              },
              sig: {
                ...bucket.sig,
                canonicalBrandKey: rb.brandKey,
                canonicalBrandDisplay: rb.brandDisplay,
                qualitySegment: rb.qualitySegment
              }
            }
          ]);
        }
      });
    }

    // Only include in Mode 2 if there are at least 2 distinct brands to compare (or if enriched)
    const distinctBrandKeys = Array.from(brandMap.keys());
    if (distinctBrandKeys.length < 2) return;

    const rawBrands: BrandBreakdownEntry[] = distinctBrandKeys.map(bKey => {
      const rows = brandMap.get(bKey)!;
      const firstSig = rows[0].sig;
      let totalQty = 0;
      let totalSpend = 0;
      const prices: number[] = [];
      const jobsites = new Set<string>();
      const suppliers = new Set<string>();
      const writings = new Set<string>();

      rows.forEach(({ h }) => {
        const q = Number(h.normalizedQuantity ?? h.quantity) || 0;
        const p = Number(h.normalizedUnitPrice ?? h.unitPrice) || 0;
        if (p > 0) {
          prices.push(p);
          totalQty += q;
          totalSpend += q * p;
        }
        if (h.jobsiteName) jobsites.add(h.jobsiteName);
        if (h.supplier) suppliers.add(h.supplier);
        if (h.originalName) writings.add(h.originalName);
      });

      const minUp = prices.length > 0 ? Math.min(...prices) : 0;
      const maxUp = prices.length > 0 ? Math.max(...prices) : 0;
      const avgUp = totalQty > 0 ? totalSpend / totalQty : (prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0);

      return {
        brandKey: bKey,
        brandDisplay: firstSig.canonicalBrandDisplay,
        qualitySegment: firstSig.qualitySegment,
        totalQuantity: Number(totalQty.toFixed(2)),
        totalSpend: Math.round(totalSpend),
        minUnitPrice: Number(minUp.toFixed(2)),
        maxUnitPrice: Number(maxUp.toFixed(2)),
        avgUnitPrice: Number(avgUp.toFixed(2)),
        jobsites: Array.from(jobsites),
        suppliers: Array.from(suppliers),
        invoiceCount: rows.length,
        originalWritings: Array.from(writings),
        diffVsCheapestRub: 0,
        diffVsCheapestPct: 0,
        potentialSavingsIfSwitchedToCheapest: 0,
        history: rows.map(r => r.h)
      };
    }).filter(b => b.avgUnitPrice > 0);

    if (rawBrands.length < 2) return;

    // Sort brands from cheapest avgUnitPrice to priciest
    rawBrands.sort((a, b) => a.avgUnitPrice - b.avgUnitPrice);
    const cheapestBrand = rawBrands[0];
    const priciestBrand = rawBrands[rawBrands.length - 1];

    let totalFamilyQty = 0;
    let totalFamilySpend = 0;
    let totalPotentialEconomyRub = 0;

    const finalizedBrands = rawBrands.map(b => {
      const diffRub = Math.max(0, Number((b.avgUnitPrice - cheapestBrand.avgUnitPrice).toFixed(2)));
      const diffPct = cheapestBrand.avgUnitPrice > 0
        ? Math.round(((b.avgUnitPrice - cheapestBrand.avgUnitPrice) / cheapestBrand.avgUnitPrice) * 100)
        : 0;
      const savingsRub = Math.round(diffRub * b.totalQuantity);

      totalFamilyQty += b.totalQuantity;
      totalFamilySpend += b.totalSpend;
      totalPotentialEconomyRub += savingsRub;

      return {
        ...b,
        diffVsCheapestRub: diffRub,
        diffVsCheapestPct: diffPct,
        potentialSavingsIfSwitchedToCheapest: savingsRub
      };
    });

    const maxGapPct = cheapestBrand.avgUnitPrice > 0
      ? Math.round(((priciestBrand.avgUnitPrice - cheapestBrand.avgUnitPrice) / cheapestBrand.avgUnitPrice) * 100)
      : 0;

    families.push({
      familyId: bucketId,
      category: bucket.category,
      unit: bucket.unit,
      canonicalFamilyTitleRu: refBench?.titleRu || bucket.sig.canonicalFamilyTitleRu,
      canonicalFamilyTitleTr: refBench?.titleTr || bucket.sig.canonicalFamilyTitleTr,
      canonicalSpecLabel: refBench?.specLabel || bucket.sig.canonicalSpecLabel,
      originalSpecSummary: refBench?.originalSpecSummary || `${bucket.sig.canonicalFamilyTitleRu} • ${bucket.sig.canonicalSpecLabel}`,
      brands: finalizedBrands,
      cheapestBrand: finalizedBrands[0],
      priciestBrand: finalizedBrands[finalizedBrands.length - 1],
      totalFamilyQuantity: Number(totalFamilyQty.toFixed(2)),
      totalFamilySpend: Math.round(totalFamilySpend),
      totalPotentialEconomyRub: Math.round(totalPotentialEconomyRub),
      maxBrandPriceGapPct: maxGapPct,
      hasMultipleBrandsInInvoices: !isReferenceEnriched,
      isReferenceEnriched
    });
  });

  // Also ensure any flagship reference benchmarks (like Knauf vs Volma or Icopal vs TechnoNICOL) not yet in coveredReferenceKeys are available for simulation
  REFERENCE_EQUIVALENT_BENCHMARKS.forEach(refBench => {
    const refKey = `${refBench.familyKey}__${refBench.specKey}`;
    if (coveredReferenceKeys.has(refKey)) return;

    const sortedRef = [...refBench.referenceBrands].sort((a, b) => a.avgUnitPrice - b.avgUnitPrice);
    const cheapest = sortedRef[0];
    const priciest = sortedRef[sortedRef.length - 1];

    let totalQty = 0;
    let totalSpend = 0;
    let totalEco = 0;

    const brands: BrandBreakdownEntry[] = sortedRef.map(rb => {
      const diffRub = Math.max(0, Number((rb.avgUnitPrice - cheapest.avgUnitPrice).toFixed(2)));
      const diffPct = Math.round(((rb.avgUnitPrice - cheapest.avgUnitPrice) / cheapest.avgUnitPrice) * 100);
      const spend = Math.round(rb.sampleQty * rb.avgUnitPrice);
      const eco = Math.round(diffRub * rb.sampleQty);

      totalQty += rb.sampleQty;
      totalSpend += spend;
      totalEco += eco;

      return {
        brandKey: rb.brandKey,
        brandDisplay: rb.brandDisplay,
        qualitySegment: rb.qualitySegment,
        totalQuantity: rb.sampleQty,
        totalSpend: spend,
        minUnitPrice: rb.minUnitPrice,
        maxUnitPrice: rb.maxUnitPrice,
        avgUnitPrice: rb.avgUnitPrice,
        jobsites: [rb.sampleJobsite],
        suppliers: [rb.sampleSupplier],
        invoiceCount: 1,
        originalWritings: [rb.sampleOriginalWriting],
        diffVsCheapestRub: diffRub,
        diffVsCheapestPct: diffPct,
        potentialSavingsIfSwitchedToCheapest: eco,
        history: [
          {
            date: new Date().toISOString().split('T')[0],
            jobsiteName: rb.sampleJobsite,
            supplier: rb.sampleSupplier,
            unitPrice: rb.avgUnitPrice,
            normalizedUnitPrice: rb.avgUnitPrice,
            quantity: rb.sampleQty,
            normalizedQuantity: rb.sampleQty,
            unit: refBench.unit,
            invoiceNumber: 'REF-PIYASA-MUADIL',
            originalName: rb.sampleOriginalWriting
          }
        ]
      };
    });

    families.push({
      familyId: `REF__${refKey}`,
      category: refBench.category,
      unit: refBench.unit,
      canonicalFamilyTitleRu: refBench.titleRu,
      canonicalFamilyTitleTr: refBench.titleTr,
      canonicalSpecLabel: refBench.specLabel,
      originalSpecSummary: refBench.originalSpecSummary,
      brands,
      cheapestBrand: brands[0],
      priciestBrand: brands[brands.length - 1],
      totalFamilyQuantity: totalQty,
      totalFamilySpend: totalSpend,
      totalPotentialEconomyRub: totalEco,
      maxBrandPriceGapPct: Math.round(((priciest.avgUnitPrice - cheapest.avgUnitPrice) / cheapest.avgUnitPrice) * 100),
      hasMultipleBrandsInInvoices: false,
      isReferenceEnriched: true
    });
  });

  return families.sort((a, b) => b.totalPotentialEconomyRub - a.totalPotentialEconomyRub);
}

/**
 * Helper for Pre-Approval Audit, Prizma Quick Compare, and Anomaly Alerts:
 * Finds if a given invoice line has a cheaper equivalent brand in Mode 2!
 */
export function findCheaperEquivalentBrandSuggestion(params: {
  originalName?: string;
  materialName?: string;
  category?: string;
  unit?: string;
  currentUnitPrice: number;
  quantity: number;
  families: CrossBrandEquivalentFamily[];
}): {
  hasCheaperEquivalent: boolean;
  currentBrandDisplay: string;
  suggestedBrandDisplay: string;
  suggestedUnitPrice: number;
  unitSavingsRub: number;
  totalSavingsRub: number;
  savingsPercentage: number;
  familyTitleRu: string;
  specLabel: string;
} | null {
  const sig = buildSmartOriginalSignature({
    originalName: params.originalName,
    materialName: params.materialName,
    category: params.category,
    unit: params.unit,
    unitPrice: params.currentUnitPrice
  });

  if (sig.isCommodity || params.currentUnitPrice <= 0) return null;

  const matchingFamily = params.families.find(
    f =>
      f.familyId.startsWith(`${sig.canonicalFamilyKey}__${sig.canonicalSpecKey}`) ||
      (f.familyId.includes(sig.canonicalFamilyKey) && f.canonicalSpecLabel === sig.canonicalSpecLabel)
  );

  if (!matchingFamily) return null;

  const cheapest = matchingFamily.cheapestBrand;
  if (!cheapest || cheapest.brandKey === sig.canonicalBrandKey) return null;

  if (params.currentUnitPrice <= cheapest.avgUnitPrice * 1.03) return null;

  const unitSavings = Number((params.currentUnitPrice - cheapest.avgUnitPrice).toFixed(2));
  const totalSavings = Math.round(unitSavings * (Number(params.quantity) || 1));
  const pct = Math.round((unitSavings / params.currentUnitPrice) * 100);

  return {
    hasCheaperEquivalent: true,
    currentBrandDisplay: sig.canonicalBrandDisplay,
    suggestedBrandDisplay: cheapest.brandDisplay,
    suggestedUnitPrice: cheapest.avgUnitPrice,
    unitSavingsRub: unitSavings,
    totalSavingsRub: totalSavings,
    savingsPercentage: pct,
    familyTitleRu: matchingFamily.canonicalFamilyTitleRu,
    specLabel: matchingFamily.canonicalSpecLabel
  };
}
