/**
 * AI DECISION ENGINE - CENTRALIZED PRODUCT NORMALIZATION & CATEGORIZATION
 * 
 * Provides unified, deterministic item processing across the entire platform:
 * - Canonical Product IDs (CPID): Unique, stable, taxonomy-based product identifiers
 * - Normalized Attributes: Standardized dimensions, diameters, grades, units, and brands
 * - Functional Classification: Precise domain categorization with strict boundary enforcement
 *   (e.g., distinguishing structural 'Ankraj Sistemleri' from general 'Sarf Malzeme & Hırdavat')
 * - Multilingual Russian & Turkish construction ontology awareness
 */

import { normalizeUnit, extractTechnicalSpecs } from './comparativeCalculation';
import { normalizeCategoryName, CANONICAL_28_CATEGORIES } from './categoryClassifier';
import {
  extractAngleDimensions,
  extractMeshSpecs,
  extractProfilePipeSpecs,
  extractChannelSpecs,
  extractRebarDiameter,
  extractRollAreaM2,
  extractBoardAreaM2,
  extractGazbetonDimensions,
  extractPackageVolumeOrWeight
} from './constructionUnitConverter';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type FunctionalDomain =
  | 'STRUCTURAL'    // Load-bearing elements, anchors, rebar, steel, concrete, masonry blocks
  | 'ENVELOPE'      // Insulation, waterproofing, roofing, facades
  | 'MEP'           // Electrical, mechanical, HVAC, plumbing
  | 'FINISHING'     // Paint, ceramics, drywall, screed, flooring, doors, signage
  | 'FORMWORK'      // Scaffolding, timber, plywood, formwork props
  | 'CONSUMABLE'    // Everyday site disposables, light hardware, drill bits, vehicle tires
  | 'SERVICE'       // Logistics, equipment rental, shipping, crane services
  | 'IT_OFFICE'     // IT, office stationery, administrative supplies, pantry, food
  | 'MOBILIZATION'  // Camp furniture, beds, lockers, containers, mobile WC
  | 'SURVEYING'     // Surveying, geodesy, total stations, prisms, tripods
  | 'SAFETY'        // PPE, workwear, safety harnesses, helmets
  | 'OTHER';

export interface ProcessItemInput {
  id?: string;
  materialName?: string;
  originalName?: string;
  name?: string;
  description?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
  brand?: string;
  model?: string;
  dimensions?: string;
  diameter?: string;
  grade?: string;
  standard?: string;
  vendorName?: string;
  supplier?: string;
  [key: string]: any;
}

export interface ExtractedAttributes {
  canonicalName: string;
  standardUnit: string;
  brand?: string;
  diameter?: string;
  grade?: string;
  dimensions?: string;
  standard?: string;
  volumeOrWeight?: string;
  materialType?: string;
  isHeavyDuty: boolean;
  rawCleanText: string;
}

export interface ClassificationResult {
  category: string;
  subCategory: string;
  functionalDomain: FunctionalDomain;
  confidence: number;
  reasoning: string;
  matchedKeywords: string[];
}

export interface ProcessedItemResult {
  id?: string;
  canonicalProductId: string;
  canonicalName: string;
  originalName: string;
  category: string;
  subCategory: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  functionalDomain: FunctionalDomain;
  confidence: number;
  attributes: ExtractedAttributes;
  classification: ClassificationResult;
  isAnchoringSystem: boolean;
  isConsumable: boolean;
}

export interface ProcessItemOptions {
  fallbackCategory?: string;
  preserveCustomCategory?: boolean;
  strictAnchoringCheck?: boolean;
  catalogHints?: string[];
  defaultSupplier?: string;
}

// ============================================================================
// STANDARD TAXONOMY CODES & CONSTANTS
// ============================================================================

export const CATEGORY_CODES: Record<string, string> = {
  'Ankraj Sistemleri': 'ANKRAJ',
  'İnşaat Demiri': 'DEMIR',
  'Donatı Malzemeleri': 'DONATI',
  'Çelik Malzemeler': 'CELIK',
  'Çelik Borular': 'BORU-CELIK',
  'Kalıp & İskele Sistemleri': 'KALIP',
  'Hazır Beton & Çimento': 'BETON',
  'Harç & Şap': 'HARC',
  'Duvar Elemanları & Gazbeton': 'DUVAR-BLOK',
  'Yapı Kimyasalları': 'KIMYASAL',
  'Kimyasallar & Boya': 'KIMYASAL',
  'Yalıtım & Alçıpan': 'YALITIM',
  'Elektrik & Otomasyon': 'ELEKTRIK',
  'Mekanik & Tesisat': 'MEKANIK',
  'Seramik & Vitrifiye': 'SERAMIK',
  'Boya & Dış Cephe': 'BOYA',
  'İnce Yapı & Kapı/Yönlendirme': 'INCE-YAPI',
  'Ölçüm & Saha Cihazları': 'OLCUM',
  'Şantiye Mobilizasyon & Yaşam': 'MOBILIZASYON',
  'Ofis & Mutfak Giderleri': 'OFIS-MUTFAK',
  'Ofis & Kırtasiye': 'OFIS',
  'İş Güvenliği & KKD': 'ISG',
  'Sarf Malzeme & Hırdavat': 'SARF',
  'Sarf Malzeme': 'SARF',
  'Hizmet & Lojistik': 'LOJISTIK',
  'Bilgi İşlem & IT': 'IT',
  'Diğer Malzeme': 'DIGER'
};

const STANDARD_REBAR_MAP: Record<number, string> = {
  8: 'A500C İnşaat Demiri Ø8 (11.7m GOST 34028)',
  10: 'A500C İnşaat Demiri Ø10 (11.7m GOST 34028)',
  12: 'A500C İnşaat Demiri Ø12 (11.7m GOST 34028)',
  14: 'A500C İnşaat Demiri Ø14 (11.7m GOST 34028)',
  16: 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)',
  18: 'A500C İnşaat Demiri Ø18 (11.7m GOST 34028)',
  20: 'A500C İnşaat Demiri Ø20 (11.7m GOST 34028)',
  22: 'A500C İnşaat Demiri Ø22 (11.7m GOST 34028)',
  25: 'A500C İnşaat Demiri Ø25 (11.7m GOST 34028)',
  28: 'A500C İnşaat Demiri Ø28 (11.7m GOST 34028)',
  32: 'A500C İnşaat Demiri Ø32 (11.7m GOST 34028)',
  36: 'A500C İnşaat Demiri Ø36 (11.7m GOST 34028)',
  40: 'A500C İnşaat Demiri Ø40 (11.7m GOST 34028)'
};

// ============================================================================
// SPECIALIZED ANCHORING VS. CONSUMABLE DETECTORS
// ============================================================================

/**
 * Detects if an item belongs to structural 'Ankraj Sistemleri'
 * (Chemical anchors, injection resins, mechanical heavy-duty wedge/undercut anchors,
 * rebar dowels, post-tensioning anchorages, heavy threaded anchor studs).
 */
export function isAnchoringSystem(combinedText: string): boolean {
  if (!combinedText) return false;
  const text = combinedText.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

  // Explicit negative exclusions: light plastic drywall toggles, light nail plugs
  if (
    text.includes('дюбель для теплоизоляци') ||
    text.includes('дюбель-гвоздь 6х') ||
    text.includes('дюбель-гвоздь 6x') ||
    text.includes('plastik dübel 6') ||
    text.includes('alçıpan dübeli') ||
    text.includes('kelebek dübel')
  ) {
    return false;
  }

  // 1. Chemical Anchors & Injection Mortars
  const isChemical =
    text.includes('химический анкер') ||
    text.includes('хим. анкер') ||
    text.includes('хим анкер') ||
    text.includes('инъекционный состав') ||
    text.includes('kimyasal ankraj') ||
    text.includes('kimyasal dubel') ||
    text.includes('kimyasal dübel') ||
    text.includes('enjeksiyon harcı') ||
    text.includes('hit-re') ||
    text.includes('hit-hy') ||
    text.includes('hit re') ||
    text.includes('hit hy') ||
    text.includes('fis v') ||
    text.includes('fis sb') ||
    text.includes('fis em') ||
    text.includes('fischer fis');

  if (isChemical) return true;

  // 2. Heavy Structural Mechanical Anchors & Undercut Systems
  const isMechanicalHeavyAnchor =
    text.includes('анкер') ||
    text.includes('ankraj') ||
    text.includes('anchor') ||
    text.includes('kesmeli ankraj') ||
    text.includes('alttan kesmeli') ||
    text.includes('undercut') ||
    text.includes('ağır yük ankrajı') ||
    text.includes('klipsli ankraj') ||
    text.includes('ankraj civatası') ||
    text.includes('ankraj cıvatası') ||
    text.includes('ankraj bulonu') ||
    text.includes('ankraj saplaması') ||
    text.includes('ankraj tij') ||
    text.includes('çelik ankraj') ||
    text.includes('sismik ankraj') ||
    text.includes('kaya ankrajı') ||
    text.includes('zemin ankrajı') ||
    text.includes('gömme ankraj') ||
    text.includes('kesme ankrajı') ||
    text.includes('hilti hst') ||
    text.includes('hilti hda') ||
    text.includes('hilti hsa') ||
    text.includes('hilti hvz') ||
    text.includes('fischer faz') ||
    text.includes('fischer fbn') ||
    text.includes('fischer fza') ||
    text.includes('mungo m2');

  if (isMechanicalHeavyAnchor) return true;

  // 3. Generic Anchor with Structural Sizing (M12, M16, M20, M24, M27, M30, M36)
  if (
    (text.includes('анкер') || text.includes('ankraj')) &&
    (/\bm\s*(?:8|10|12|14|16|20|24|27|30|36)\b/i.test(text) ||
     text.includes('8.8') ||
     text.includes('10.9') ||
     text.includes('a4-70') ||
     text.includes('a4-80'))
  ) {
    return true;
  }

  return false;
}

/**
 * Detects if an item is a site consumable or light hardware ('Sarf Malzeme & Hırdavat')
 */
export function isGeneralConsumable(combinedText: string): boolean {
  if (!combinedText) return false;
  const text = combinedText.toLowerCase();

  // If it's a structural anchor, it is NOT general consumable
  if (isAnchoringSystem(text)) return false;

  return (
    // Fasteners (Light screws, nails, small rivets, washers)
    text.includes('саморез') ||
    text.includes('шуруп') ||
    text.includes('гвоздь') ||
    text.includes('шайба') ||
    text.includes('дюбель-гвоздь') ||
    text.includes('дюбель распорный') ||
    text.includes('vida') ||
    text.includes('sunta vidası') ||
    text.includes('alçıpan vidası') ||
    text.includes('trapez vida') ||
    text.includes('akıllı vida') ||
    text.includes('matkap uçlu vida') ||
    text.includes('plastik dübel') ||
    text.includes('çatı pulu') ||
    text.includes('perçin') ||
    // Cutting & Grinding Abrasives, Drill Bits
    text.includes('диск отрезной') ||
    text.includes('диск алмазный') ||
    text.includes('диск зачистной') ||
    text.includes('сверло') ||
    text.includes('бур sds') ||
    text.includes('бита') ||
    text.includes('коронка') ||
    text.includes('kesici taş') ||
    text.includes('taşlama diski') ||
    text.includes('elmas testere') ||
    text.includes('matkap ucu') ||
    text.includes('sds uç') ||
    text.includes('bits ucu') ||
    // Personal Protective Equipment (PPE) & Hygiene
    text.includes('перчатки') ||
    text.includes('очки защитные') ||
    text.includes('респиратор') ||
    text.includes('каска') ||
    text.includes('eldiven') ||
    text.includes('iş eldiveni') ||
    text.includes('toz maskesi') ||
    text.includes('koruyucu gözlük') ||
    text.includes('baret') ||
    // Packaging, Cleaning & Tapes
    text.includes('стретч') ||
    text.includes('скотч') ||
    text.includes('лента малярная') ||
    text.includes('мешки для мусора') ||
    text.includes('ведро') ||
    text.includes('швабр') ||
    text.includes('çöp poşeti') ||
    text.includes('koli bandı') ||
    text.includes('maskeleme bandı') ||
    text.includes('streç film') ||
    text.includes('moloz çuvalı') ||
    text.includes('hırdavat') ||
    text.includes('sarf malzeme')
  );
}

// ============================================================================
// ATTRIBUTE EXTRACTOR
// ============================================================================

export function extractNormalizedAttributes(
  rawName: string,
  rawOriginal: string = '',
  unit: string = 'adet'
): ExtractedAttributes {
  const cleanName = (rawName || '').trim();
  const cleanOriginal = (rawOriginal || '').trim();
  const combined = `${cleanName} ${cleanOriginal}`.toLowerCase();

  const specs = extractTechnicalSpecs(`${cleanName} ${cleanOriginal}`);
  const standardUnit = normalizeUnit(unit);

  // Extract Brand
  let brand: string | undefined = specs.brand;
  if (!brand) {
    if (/hilti|хилти/i.test(combined)) brand = 'Hilti';
    else if (/fischer|фишер/i.test(combined)) brand = 'Fischer';
    else if (/sika|сика/i.test(combined)) brand = 'Sika';
    else if (/knauf|кнауф/i.test(combined)) brand = 'Knauf';
    else if (/severstal|северсталь/i.test(combined)) brand = 'Severstal';
    else if (/evraz|евраз/i.test(combined)) brand = 'EVRAZ';
    else if (/nlmk|нлмк/i.test(combined)) brand = 'NLMK';
    else if (/baumak|баумак/i.test(combined)) brand = 'Baumak';
    else if (/mungo|мунго/i.test(combined)) brand = 'Mungo';
    else if (/doka|дока/i.test(combined)) brand = 'Doka';
    else if (/peri|пери/i.test(combined)) brand = 'Peri';
    else if (/rockwool|роквул/i.test(combined)) brand = 'Rockwool';
    else if (/technonicol|технониколь/i.test(combined)) brand = 'TechnoNICOL';
  }

  // Extract Volume or Weight (e.g. 500 ml, 330 ml, 25 kg, 50 kg)
  const volWeightMatch = combined.match(/\b(\d+(?:[.,]\d+)?)\s*(?:мл|ml|л|l|кг|kg|gr|г)\b/i);
  const volumeOrWeight = volWeightMatch ? `${volWeightMatch[1]} ${volWeightMatch[0].replace(volWeightMatch[1], '').trim()}` : undefined;

  const isHeavyDuty = isAnchoringSystem(combined) || combined.includes('ağır yük') || combined.includes('тяжелых нагрузок');

  return {
    canonicalName: cleanName,
    standardUnit,
    brand,
    diameter: specs.diameter,
    grade: specs.grade,
    dimensions: specs.dimensions,
    standard: specs.standard,
    volumeOrWeight,
    isHeavyDuty,
    rawCleanText: combined
  };
}

// ============================================================================
// FUNCTIONAL CLASSIFIER
// ============================================================================

export function classifyItem(
  name: string,
  originalName: string = '',
  attrs: ExtractedAttributes,
  supplier: string = ''
): ClassificationResult {
  const result = classifyItemInternal(name, originalName, attrs, supplier);
  const combined = `${name} ${originalName}`.trim();
  const canonicalCategory = normalizeCategoryName(result.category, combined);
  return {
    ...result,
    category: canonicalCategory
  };
}

function classifyItemInternal(
  name: string,
  originalName: string = '',
  attrs: ExtractedAttributes,
  supplier: string = ''
): ClassificationResult {
  const cleanName = (name || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  const cleanOrig = (originalName || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
  const combined = `${cleanName} ${cleanOrig}`.trim();
  const supp = (supplier || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();

  // 1. PRIORITY DOMAIN: ANKRAJ SİSTEMLERİ
  if (isAnchoringSystem(combined)) {
    let subCategory = 'Ağır Yük Ankrajı';
    const matchedKeywords: string[] = ['ankraj'];

    if (combined.includes('хим') || combined.includes('kimyasal') || combined.includes('hit-re') || combined.includes('hit-hy') || combined.includes('инъекцион')) {
      subCategory = 'Kimyasal Ankraj & Enjeksiyon';
      matchedKeywords.push('kimyasal ankraj');
    } else if (combined.includes('клинов') || combined.includes('klipsli') || combined.includes('kanca')) {
      subCategory = 'Mekanik Klipsli Ankraj';
      matchedKeywords.push('klipsli ankraj');
    } else if (combined.includes('шпильк') || combined.includes('saplama') || combined.includes('tij') || combined.includes('тяга')) {
      subCategory = 'Ankraj Saplaması & Tij';
      matchedKeywords.push('ankraj saplaması');
    }

    return {
      category: 'Ankraj Sistemleri',
      subCategory,
      functionalDomain: 'STRUCTURAL',
      confidence: 0.98,
      reasoning: `Belirlenen ${subCategory} yapısal yük taşıyıcı ankraj kriterlerine uyuyor. Sarf malzemelerden ayrıştırıldı.`,
      matchedKeywords
    };
  }

  // 1.5. EVRENSEL "İÇİN / ДЛЯ" VE AKSESUAR AYRIŞTIRMA KURALLARI (PRIORITY DOMAIN ACCESSORIES & CONSUMABLES)
  // A. İnşaat Demiri Güvenlik Başlıkları / Mantar Tipi Koruyucular (ASLA İNŞAAT DEMİRİ OLAMAZ!)
  if (
    combined.includes('колпачок') ||
    combined.includes('грибок') ||
    combined.includes('güvenlik mantar') ||
    combined.includes('koruyucu başlık') ||
    combined.includes('koruyucu baslik') ||
    combined.includes('güvenlik başlığı') ||
    combined.includes('guvenlik basligi') ||
    combined.includes('kolpaçok') ||
    combined.includes('kolpacok')
  ) {
    return {
      category: 'Sarf Malzeme & Hırdavat',
      subCategory: 'İş Güvenliği & Koruyucu Donatı Başlığı',
      functionalDomain: 'CONSUMABLE',
      confidence: 0.99,
      reasoning: 'İnşaat demiri koruyucu güvenlik mantarı/başlığı sarf malzeme olarak sınıflandırıldı. Asla yapısal donatı olamaz.',
      matchedKeywords: ['güvenlik başlığı', 'колпачок', 'грибок']
    };
  }

  // B. Demir Bağlama / Kesme / Bükme El Aletleri & Ekipmanları
  if (
    combined.includes('крючок') ||
    combined.includes('пистолет для вязки') ||
    combined.includes('ножницы для арматур') ||
    combined.includes('станок для гибки') ||
    combined.includes('kesme makas') ||
    combined.includes('bükme aparat') ||
    (combined.includes('зубило') && !combined.includes('сталь')) ||
    (combined.includes('keski') && !combined.includes('çelik profil'))
  ) {
    return {
      category: 'Sarf Malzeme & Hırdavat',
      subCategory: 'El Aletleri & Şantiye Ekipmanları',
      functionalDomain: 'CONSUMABLE',
      confidence: 0.98,
      reasoning: 'Donatı kesme, bükme veya bağlama aparatı sarf/alet olarak sınıflandırıldı.',
      matchedKeywords: ['demir bükme', 'kesme makası', 'bağlama aparatı']
    };
  }

  // C. Kalıp Yağı & Donatı Kimyasalları
  if (
    combined.includes('смазка для форм') ||
    combined.includes('смазка опалуб') ||
    combined.includes('эмульсол') ||
    combined.includes('kalıp yağı') ||
    combined.includes('kalip yagi') ||
    combined.includes('добавка для бетон') ||
    combined.includes('beton katkı') ||
    combined.includes('клей для плитки') ||
    combined.includes('fayans yapıştırıcı') ||
    combined.includes('затирка') ||
    combined.includes('derz dolgu')
  ) {
    return {
      category: 'Yapı Kimyasalları',
      subCategory: 'Katkı, Ayırıcı & Harç Kimyasalları',
      functionalDomain: 'FINISHING',
      confidence: 0.98,
      reasoning: 'Beton/kalıp katkısı veya seramik yapıştırıcı yapı kimyasalı olarak sınıflandırıldı.',
      matchedKeywords: ['kalıp yağı', 'beton katkısı', 'fayans yapıştırıcısı']
    };
  }

  // D. Tesisat / Kablo / Altyapı Boru ve Aksesuar Ayrıştırması ("для")
  if (
    combined.includes('труба для кабел') ||
    combined.includes('kablo borusu') ||
    combined.includes('гофра') ||
    combined.includes('гофрированная труб') ||
    combined.includes('koruge')
  ) {
    return {
      category: 'Elektrik & Otomasyon',
      subCategory: 'Kablo Kanal & Koruma Boruları',
      functionalDomain: 'MEP',
      confidence: 0.98,
      reasoning: 'Kablo koruma/koruge borusu Elektrik & Otomasyon olarak sınıflandırıldı.',
      matchedKeywords: ['kablo borusu', 'koruge', 'гофра']
    };
  }

  if (
    combined.includes('изоляция для труб') ||
    combined.includes('boru yalıtımı') ||
    combined.includes('boru yalitim') ||
    combined.includes('энергофлекс') ||
    combined.includes('energoflex')
  ) {
    return {
      category: 'Yalıtım & Alçıpan',
      subCategory: 'Boru & Mekanik Yalıtım',
      functionalDomain: 'ENVELOPE',
      confidence: 0.98,
      reasoning: 'Boru yalıtım malzemesi Yalıtım & Alçıpan olarak sınıflandırıldı.',
      matchedKeywords: ['boru yalıtımı', 'энергофлекс']
    };
  }

  if (
    combined.includes('хомут для труб') ||
    combined.includes('boru kelepçesi') ||
    combined.includes('boru kelepcesi') ||
    combined.includes('саморез для гипсокартон') ||
    combined.includes('alçıpan vidası') ||
    combined.includes('чашка по бетону') ||
    combined.includes('алмазная чашка') ||
    combined.includes('крестики для плитки') ||
    combined.includes('fayans artısı') ||
    combined.includes('валик') ||
    combined.includes('кисть') ||
    combined.includes('rulo fırça')
  ) {
    return {
      category: 'Sarf Malzeme & Hırdavat',
      subCategory: 'Bağlantı Elemanları & Şantiye Sarfiyatı',
      functionalDomain: 'CONSUMABLE',
      confidence: 0.98,
      reasoning: 'Kelepçe, vida, rulo veya aşındırıcı sarf malzeme olarak sınıflandırıldı.',
      matchedKeywords: ['sarf malzeme', 'kelepçe', 'vida', 'rulo']
    };
  }

  // 2. DONATI MALZEMELERİ & COUPLERS (Not raw rebar, not standard anchors)
  const isDonatiAccessory =
    (combined.includes('муфта') ||
     combined.includes('manşon') ||
     combined.includes('manson') ||
     combined.includes('donatı kafes') ||
     combined.includes('каркас кр') ||
     (combined.includes('проволока') && (combined.includes('отожжен') || combined.includes('то') || combined.includes('бухты') || combined.includes('вязальн'))) ||
     combined.includes('bağ teli') ||
     combined.includes('bag teli') ||
     combined.includes('bağlama teli') ||
     combined.includes('paspay') ||
     combined.includes('паспой') ||
     combined.includes('фиксатор') ||
     combined.includes('donatı sehp') ||
     combined.includes('çiroz') ||
     combined.includes('ciroz') ||
     combined.includes('лягушк')) &&
    !combined.includes('dn32') &&
    !combined.includes('dişli manşon') &&
    !combined.includes('kilit');

  if (isDonatiAccessory) {
    return {
      category: 'Donatı Malzemeleri',
      subCategory: combined.includes('manşon') || combined.includes('муфта') ? 'Donatı Manşonu (Coupler)' : (combined.includes('проволока') || combined.includes('tel') ? 'Bağlama Teli' : 'Paspayı & Aksesuar'),
      functionalDomain: 'STRUCTURAL',
      confidence: 0.95,
      reasoning: 'Donatı ekleme, paspayı veya bağ teli elemanı olarak sınıflandırıldı.',
      matchedKeywords: ['donatı manşonu', 'paspayı', 'bağ teli']
    };
  }

  // 3. İNŞAAT DEMİRİ (SADECE Yapısal Betonarme Donatısı, Nervürlü Demir & Hasır Çelik)
  const isRebarNegativeFiltered =
    combined.includes('колпачок') ||
    combined.includes('грибок') ||
    combined.includes('güvenlik mantar') ||
    combined.includes('koruyucu başlık') ||
    combined.includes('güvenlik başlığı') ||
    combined.includes('фиксатор') ||
    combined.includes('паспой') ||
    combined.includes('paspay') ||
    combined.includes('çiroz') ||
    combined.includes('ciroz') ||
    combined.includes('donatı sehp') ||
    combined.includes('лягушк') ||
    combined.includes('крючок') ||
    combined.includes('пистолет') ||
    combined.includes('ножниц') ||
    combined.includes('станок') ||
    combined.includes('смазка') ||
    combined.includes('зубило') ||
    combined.includes('keski') ||
    combined.includes('kesme') ||
    combined.includes('bükme') ||
    combined.includes('вязальн') ||
    combined.includes('bağ teli') ||
    combined.includes('tavlı tel');

  if (
    !isRebarNegativeFiltered &&
    !/базальт|bazalt|duvar.*örgü/i.test(combined) &&
    (combined.includes('арматур') ||
    combined.includes('inşaat demir') ||
    combined.includes('insaat demir') ||
    combined.includes('nervürlü demir') ||
    combined.includes('rebar') ||
    combined.includes('пруток') ||
    combined.includes('a500') ||
    combined.includes('а500') ||
    combined.includes('filmaşin') ||
    combined.includes('hasır çelik') ||
    combined.includes('çelik hasır') ||
    combined.includes('hasır tel') ||
    combined.includes('вр-1') ||
    combined.includes('сетка кладочн') ||
    combined.includes('сетка арматурн'))
  ) {
    return {
      category: 'İnşaat Demiri',
      subCategory: combined.includes('hasır') || combined.includes('сетка') || combined.includes('вр-1') ? 'Hasır Çelik' : 'Nervürlü İnşaat Demiri',
      functionalDomain: 'STRUCTURAL',
      confidence: 0.98,
      reasoning: 'Yapısal betonarme inşaat demiri / hasır çelik tespiti.',
      matchedKeywords: ['inşaat demiri', 'a500c', 'hasır çelik']
    };
  }

  // 4. HİZMET & LOJİSTİK (Nakliye, Teslimat, Navlun, Vinç & Makine Kiralama, Boşaltma, Asansör & Klima Montaj Bedeli)
  if (
    /доставка|перевозк|организация.*доставк|транспортн|аренда.*манипулятор|аренда.*автокран|аренда.*кран|аренда.*техник|рейс|nakliye|teslimat|navlun|lojistik|araç ile nakliye|vinç kiralama|boşaltma|yükleme|разгрузка|манипулятор.*разгрузка|монтажные работы.*лифт|asansör.*montaj|klima.*montaj|ünite.*montaj|sahaya çıkış bedeli|montaj bedeli|montajı\b|çıkış bedeli/i.test(combined) ||
    (supp.includes('стандартпарк') && combined.includes('nakliye')) ||
    (supp.includes('дипломат') && combined.includes('nakliye')) ||
    (supp.includes('металл-инвест') && /доставк|nakliye/i.test(combined))
  ) {
    return {
      category: 'Hizmet & Lojistik',
      subCategory: /аренда|kiralama/i.test(combined) ? 'Vinç & Ekipman Kiralama' : (/лифт|asansör|klima|montaj/i.test(combined) ? 'Saha Montaj & Kurulum Hizmeti' : 'Nakliye & Lojistik Hizmeti'),
      functionalDomain: 'SERVICE',
      confidence: 0.96,
      reasoning: 'Şantiye lojistik, taşıma, tahliye veya iş makinesi/montaj hizmeti tespit edildi.',
      matchedKeywords: ['nakliye', 'lojistik', 'teslimat', 'montaj bedeli']
    };
  }

  // 5. BİLGİ İŞLEM & IT (Toner, Kartuş, Bilgisayar, Monitör, Yazıcı, RAM, SSD, Network, Güçlendirici Set, Smart TV)
  if (
    /тонер|картридж|ноутбук|компьютер|системный блок|монитор|клавиатур|мышь|ssd|hdd|ddr4|ddr5|ram|память|процессор|роутер|коммутатор|патч-корд|принтер|мфу|сканер|усиления сотовой|сигнал.*интернет|интернет.*комплект|wifi|вайфай|bilgisayar|dizüstü|laptop|monitör|klavye|mouse|yazıcı|tarayıcı|kartuş|toner|mfp|intel|amd|ryzen|geforce|rtx|kingston|logitech|patriot|lenovo|xiaomi.*curved|pantum|kyocera|canon.*mf|canon.*lbp|televizyon|qled|digma|smart tv|google tv/i.test(combined)
  ) {
    return {
      category: 'Bilgi İşlem & IT',
      subCategory: /тонер|картридж|kartuş|toner/i.test(combined) ? 'Toner & Kartuş Sarfiyatı' : (/принтер|мфу|сканер|yazıcı|tarayıcı/i.test(combined) ? 'Yazıcı & Çevre Birimleri' : 'Bilgisayar & Donanım'),
      functionalDomain: 'IT_OFFICE',
      confidence: 0.98,
      reasoning: 'Bilgi işlem, çevre birimi, donanım, network veya yazıcı sarf malzemesi.',
      matchedKeywords: ['it', 'bilgisayar', 'yazıcı', 'toner', 'kartuş']
    };
  }

  // 6. İŞ GÜVENLİĞİ & KKD (İş Elbisesi, Tulum, Baret, Reflektörlü Yelek, İş Botu, Eldiven, Sapan, İkaz Bandı)
  if (
    /костюм.*рабоч|спецодежд|куртка.*рабоч|брюки.*рабоч|полукомбинезон|комбинезон|жилет.*сигнальн|каска|щиток.*защитн|щиток.*лицев|очки.*защитн|респиратор|берцы|ботинки.*рабоч|сапоги|перчатк|рукавиц|краги|пояс.*монтажн|привязь|манекен|строп|sapan|tekstil sapan|огнетушитель|ствол.*пожарн|рукав.*пожарн|дождевик|плащ.*дождевик|свисток|düdük|галоши.*диэлектрическ|диэлектрическ|yangın söndür|yangın nozul|yangın hortumu|iş elbisesi|iş tulumu|iş montu|reflektörlü yelek|baret|siperlik|koruyucu gözlük|toz maskesi|iş ayakkabısı|iş botu|çizme|iş eldiveni|kaynakçı eldiveni|kaynakçı maskesi|маска сварщика|emniyet kemeri|paraşüt tipi kemer|ikaz bandı|лента сигнальн|насадка.*для.*промывания.*глаз|göz duşu|göz yıkama|güvenlik kıyafeti|iş önlüğü|iş takımı|ikaz.*şeridi|emniyet şeridi|gigant.*ikaz|önlük/i.test(combined) ||
    supp.includes('веста')
  ) {
    return {
      category: 'İş Güvenliği & KKD',
      subCategory: /строп|sapan/i.test(combined) ? 'Kaldırma & Güvenlik Sapanları' : (/огнетушитель|пожарн|yangın/i.test(combined) ? 'Yangın Güvenlik Ekipmanları' : (/краги|eldiven|перчатк/i.test(combined) ? 'Koruyucu İş Eldivenleri' : 'Kişisel Koruyucu Donanım & Kıyafet')),
      functionalDomain: 'SAFETY',
      confidence: 0.95,
      reasoning: 'İş sağlığı ve güvenliği (İSG) koruyucu donanım, sapan veya şantiye güvenlik teçhizatı.',
      matchedKeywords: ['iş güvenliği', 'isg', 'baret', 'iş elbisesi', 'sapan', 'kkd']
    };
  }

  // 7. ÖLÇÜM & SAHA CİHAZLARI (Harita, Geodezi, Taheometre, Nivo, Reflektör, Statif, Su Terazisi, Gönye, Şerit Metre, Çırpı İpi, Lazer, Lazer Şakül)
  if (
    !/жилет|куртк|брюк|костюм|yelek|ceket|pantolon|elbise/i.test(combined) &&
    (/тахеометр|нивелир|теодолит|отражател|отражающ.*марк|призма|штатив|веха|трегер|дальномер|лазерн.*уровень|уровень.*алюмин|уровень.*магнитн|уровень.*строительн|su terazisi|рулетк|şerit metre|шнур.*разметочный|çırpı ipi|маркер.*строительн|лазерная указка|lazer işaretçi|geb364|batarya.*leica|leica|topcon|sokkia|trimble|nedo|geomax|\bмарка.*оп\b|\bоп50\b|\bop50\b|рейка.*телескопическ|rgk.*ts|mira|угольник.*малярн|угольник.*столярн|marangoz gönyesi|lazer şakül|düşey projeksiyon|rgk v200|projeksiyon cihazı/i.test(combined) ||
    supp.includes('бим прибор'))
  ) {
    return {
      category: 'Ölçüm & Saha Cihazları',
      subCategory: /рулетк|şerit metre|уровень|su terazisi|шнур|угольник/i.test(combined) ? 'Saha Hizalama & Mekanik Ölçüm' : 'Geodezi & Optik Harita Cihazları',
      functionalDomain: 'SURVEYING',
      confidence: 0.97,
      reasoning: 'Hassas şantiye ölçüm, harita, nivo, su terazisi veya optik teçhizat.',
      matchedKeywords: ['taheometre', 'reflektör', 'ölçüm cihazı', 'su terazisi', 'şerit metre']
    };
  }

  // 8. İNCE YAPI, KAPI & YÖNLENDİRME (İç Kapı, DPG, Pervaz, Kapı Kolu, Kilit, Menteşe, Daire Numarası, Levhalar, Tabela, Posteri, Küresel Yol Aynası)
  if (
    /дверь|дверн|наличник|добор|плинтус|ручка.*дверн|замок.*врезн|петля.*дверн|петли.*дверн|указател|табличк|навигаци|номер.*квартир|значок.*уборн|значок.*коляск|значок.*самокат|буквы.*над|надпись.*dream|постер.*план|план.*из.*пвх|plan posteri|iç kapı|dpg kapı|kapı kasası|pervaz|kapı kolu|kilit|menteşe|süpürgelik|yönlendirme|kat tabelası|daire numarası|merdiven levhası|otopark yönlendirme|nest-|sadece personel|posta kutu|harfleri seti|kat numara|katlarda.*harf|bina ismi|blok.*ismi|panel üzeri|yol aynası|küresel.*ayna/i.test(combined) ||
    supp.includes('splus') ||
    supp.includes('малявин')
  ) {
    return {
      category: 'İnce Yapı & Kapı/Yönlendirme',
      subCategory: /дверь|kapı|наличник|pervaz|ручка.*дверн|петл|menteşe/i.test(combined) ? 'İç Kapı Sistemleri & Doğrama' : 'Yönlendirme Panoları & Tabelalar',
      functionalDomain: 'FINISHING',
      confidence: 0.96,
      reasoning: 'İnce yapı mimari kapı doğrama veya kat yönlendirme işaretleri.',
      matchedKeywords: ['iç kapı', 'yönlendirme tabelası', 'menteşe']
    };
  }

  // 9. ŞANTİYE MOBİLİZASYON & YAŞAM (Konteyner, Ranza, Yatak, Dolap, Mutfak/WC, Keson, Komodin, Çalışma Masası, Sandalye, Askılık, Treydmi)
  if (
    /кровать|двухъярусн|матрас|подушка|одеяло|постельн|наволочк|простын|пододеяльник|шкаф.*одежд|шкаф.*хозяйственн|шкаф.*металлическ|шкаф.*раздевал|сушилка.*бель|биотуалет|туалетн.*кабин|бытовка|блок-контейнер|контейнер.*тр|ящик-контейнер|стеллаж|полка.*ярус|балка.*ms|рама.*profi|клетка.*для.*хранения.*баллон|тележка.*баллон|tüp arabası|tüp taşıma|tüp kafesi|ranza|yatak|yastık|yorgan|nevresim|çarşaf|soyunma dolabı|elbise dolabı|erzak dolabı|tuvalet kabini|seyyar tuvalet|blok konteyner|konteyner sandık|mobilizasyon|ecolight|тара.*металлическ|бак.*мусорн|контейнер-бак|бензовоз|топливозаправщик|азс|мобильн.*азс|аккумуляторн.*станци|генератор|дизель-генератор|обогреватель|тепловая пушка|стол.*журнальн|подставка.*для.*ног|sehpa|mobil akaryakıt|jeneratör kayışı|bakım seti.*0-1000|keson|komodin|ayakkabılık|çalışma masası|sandalye|echair|askılık|kartoteks|dosya dolabı|praktik afc/i.test(combined) ||
    supp.includes('рус-гарант') ||
    supp.includes('трейдми') ||
    supp.includes('ликвид газ')
  ) {
    return {
      category: 'Şantiye Mobilizasyon & Yaşam',
      subCategory: /шкаф|dolap|стеллаж|raf|keson|komodin|kartoteks|çalışma masası|sandalye|ayakkabılık/i.test(combined) ? 'Ofis Mobilyası & Depolama Sistemleri' : (/баллон|tüp|азс|akaryakıt|генератор/i.test(combined) ? 'Şantiye Enerji & Yakıt Donanımı' : 'Mobilizasyon & Yaşam Donanımı'),
      functionalDomain: 'MOBILIZATION',
      confidence: 0.95,
      reasoning: 'Şantiye kamp yaşamı, mobilya, yatakhane, soyunma, yakıt tankı veya mobilizasyon ekipmanı.',
      matchedKeywords: ['mobilizasyon', 'konteyner', 'yatak', 'dolap', 'mobilya']
    };
  }

  // 10. OFİS & KIRTASİYE (Kağıt, Dosya, Laminasyon, Kırtasiye Bandı, Fairy, Deterjan, Sanoks, Pisuvar Koku, Luscan, Klorlu Kireç, Waffle Bez, Gıda Kabı)
  if (
    /бумага|папка|скоросшивател|регистратор|файлы|скрепк|степлер|скобы|антистеплер|ножницы|линейка|клей-карандаш|штрих|корректор|ручка.*шариков|ручка.*гелев|стержень|карандаш|маркер|текстовыделител|ластик|точилка|лоток.*для.*бумаг|органайзер|блокнот|тетрадь|ежедневник|стикер|клейкие закладки|делопроизводство|архивн.*короб|бланки|печать.*штамп|штамп|зажим.*для.*бумаг|датер|калькулятор|доска.*магнитн|бейдж|чайник.*электрическ|чайник|самовар|кофеварка|кофемашин|кофе|чай|сахар|сахарниц|сливки|конфеты|печенье|шоколад|snickers|bounty|посуда|кружка|стакан|тарелка|ложка|вилка|салфетки|полотенца.*бумажн|туалетная бумага|мыло|дозатор|освежитель|белизна|отбеливатель|чистящее|моющее|прогресс|мистер мускул|доместос|сиф|утёнок|губка.*посуд|тряпка|микрофибра|перчатки.*хозяйственн|швабра|ведро.*уборк|пакеты.*для.*мусора|урна|педальное ведро|çöp kovası|çöp kutusu|vileda|temizlik süngeri|bulaşık süngeri|aşındırıcı sünger|çamaşır suyu|temizleyici|sıvı sabun|peçete|kağıt havlu|tuvalet kağıdı|ataş|ataç|zımba|delgeç|klasör|arşiv kutusu|not kağıdı|yapışkanlı not|şeker|kahve|çay|çaykur|ahmad|çikolata|kaşe|evrak klipsi|sayfa ayırıcı|разделитель листов|кухни настенный|kettle|su ısıtıcı|bref|domestos|laminasyon|ciltleme|etiket|promega|workmate|evrak kıskacı|kıskacı|kırtasiye bandı|fairy|bulaşık|sanoks|kireç sökücü|pisuvar|paspas|nem alıcı giriş paspası|luscan|klorlu kireç|хлорн|хлорка|synergetic|waffle bez|вафельное полотно|gıda saklama kabı|saklama kabı|bıçak tutucu|attache|yedek başlık|sünger.*109w|art\. 109w/i.test(combined) ||
    ((combined.includes('ручка') || combined.includes('kalem')) && !combined.includes('двер') && !combined.includes('kapı')) ||
    supp.includes('комус') ||
    supp.includes('поинтер') ||
    supp.includes('самснаб')
  ) {
    return {
      category: 'Ofis & Kırtasiye',
      subCategory: /чай|кофе|сахар|соль|snickers|bounty|печенье|шоколад|kahve|çay|şeker|mutfak|saklama kabı|bıçak tutucu/i.test(combined) ? 'Mutfak & İkram Giderleri' : (/белизна|мыло|губка|тряпка|доместос|сиф|vileda|temizlik|fairy|sanoks|luscan|хлорн|хлорка|synergetic|waffle bez/i.test(combined) ? 'Temizlik & Hijyen Sarfiyatı' : 'Ofis & Kırtasiye Malzemeleri'),
      functionalDomain: 'IT_OFFICE',
      confidence: 0.96,
      reasoning: 'Şantiye idari ofis kırtasiyesi, hijyen ve mutfak sarf gideri.',
      matchedKeywords: ['ofis', 'kırtasiye', 'mutfak', 'temizlik']
    };
  }

  // 11. DUVAR ELEMANLARI & GAZBETON (Gazbeton Blok, Lento, Briket, Tuğla, Bazalt File, KBB Keramzitbeton Blok, İstkult)
  if (
    /газобетон|газосиликат|перемычка.*газобетон|поритеп|poritep|бонолит|bonolit|ytong|исткульт|istkult|керамзитобетон|шлакоблок|кбб|кирпич|сетка.*базальтов|gazbeton|gazbeton lento|gazbeton pervaz|briket|duvar bloku|tuğla|bazalt donatı filesi|duvar örgü filesi/i.test(combined) ||
    supp.includes('исткульт')
  ) {
    return {
      category: 'Duvar Elemanları & Gazbeton',
      subCategory: 'Gazbeton, Blok & Duvar Örgü Malzemeleri',
      functionalDomain: 'STRUCTURAL',
      confidence: 0.96,
      reasoning: 'Duvar örme elemanları, gazbeton blok, lento ve duvar donatı filesi.',
      matchedKeywords: ['gazbeton', 'blok', 'tuğla', 'istkult']
    };
  }

  // 12. HAZIR BETON, ÇİMENTO & AGREGA (Beton, Çimento, Mıcır, Kum, Keramzit, Dolgu, PAG Plaka, FBS Temel Blokları)
  if (
    !/бур|сверл|диск|коронк|франкфурт|шлифовальн|обдирочн|matkap|kesici|delici/i.test(combined) &&
    (/бетон|раствор|цемент|паг-18|паг-14|паг 18|паг 14|плита.*аэродромн|beton.*kaplama.*plaka|b15|b20|b25|b30|b35|в15|в20|в25|в30|в35|m200|m250|m300|m350|керамзит|щебень|гравий|песок.*строительн|пескогрунт|грунт.*растительн|mıcır|kalker mıcırı|taş ocağı mıcırı|kırma taş|kum|şap kumu|dolgu toprağı|toprak dolgu|genleştirilmiş kil|keramzit|fbs-|фбс|temel bloğu/i.test(combined) ||
    (supp.includes('стройавангард') && /mıcır|toprak|kum|щебень|песок|грунт/i.test(combined)) ||
    (supp.includes('строительный двор') && combined.includes('паг')))
  ) {
    return {
      category: 'Hazır Beton & Çimento',
      subCategory: /паг|аэродромн|kaplama|fbs|temel bloğu/i.test(combined) ? 'Prefabrik Beton Yol & Temel Elemanları' : (/керамзит|щебень|песок|mıcır|kum|toprak/i.test(combined) ? 'Agrega, Mıcır & Dolgu' : (combined.includes('цемент') || combined.includes('çimento') ? 'Torbalı / Dökme Çimento' : 'Hazır Beton')),
      functionalDomain: 'STRUCTURAL',
      confidence: 0.96,
      reasoning: 'Hazır beton sınıfı, bağlayıcı çimento, prefabrik yol/temel betonu veya agrega/dolgu malzemesi.',
      matchedKeywords: ['beton', 'çimento', 'agrega', 'mıcır', 'fbs']
    };
  }

  // 12. ÇELİK BORULAR & YAPISAL BORULAR
  if (
    combined.includes('труба профильн') ||
    combined.includes('труба стальн') ||
    combined.includes('труба эл/св') ||
    combined.includes('çelik boru') ||
    combined.includes('profil boru') ||
    (combined.includes('труба') && (combined.includes('сталь') || combined.includes('металл') || combined.includes('вгп') || combined.includes('б/ш')))
  ) {
    return {
      category: 'Çelik Borular',
      subCategory: 'Sanayi & Profil Boruları',
      functionalDomain: 'STRUCTURAL',
      confidence: 0.95,
      reasoning: 'Çelik konstrüksiyon profil ve sanayi boruları.',
      matchedKeywords: ['çelik boru']
    };
  }

  // 13. ÇELİK MALZEMELER & HADDE PROFİLLER (Şveller, Köşebent, Sac, Lama, IPE, HEA)
  if (
    combined.includes('швеллер') ||
    combined.includes('уголок') ||
    combined.includes('угол 50') ||
    combined.includes('угол 63') ||
    combined.includes('угол 75') ||
    combined.includes('двутавр') ||
    combined.includes('балка стальн') ||
    combined.includes('балка двутавр') ||
    combined.includes('лист г/к') ||
    combined.includes('лист х/к') ||
    combined.includes('лист стальн') ||
    combined.includes('полоса стальн') ||
    combined.includes('квадрат стальн') ||
    combined.includes('köşebent') ||
    combined.includes('kosebent') ||
    combined.includes('kutu profil') ||
    combined.includes('çelik sac') ||
    combined.includes('çelik profil') ||
    combined.includes('hea') ||
    combined.includes('heb') ||
    combined.includes('ipe') ||
    supp.includes('металл-инвест')
  ) {
    return {
      category: 'Çelik Malzemeler',
      subCategory: 'Hadde Profil & Yapısal Çelik Sac',
      functionalDomain: 'STRUCTURAL',
      confidence: 0.96,
      reasoning: 'Yapısal çelik konstrüksiyon profilleri, şveller, köşebent ve saclar.',
      matchedKeywords: ['çelik profil', 'şveller', 'sac', 'köşebent']
    };
  }

  // 14. KALIP & İSKELE SİSTEMLERİ (Plywood, Kereste, İskele, H20, Baumak, Cuplock, Merdivenler, Demir Makineleri, Kalıp Vibratörü, Beton Dağıtıcı Bom, Kompresör)
  if (
    /опалубк|фанер|двп|оргалит|брус|доска|стойк|треног|унивилк|h20|х20|клин.*кован|вставка.*соединительн|элемент.*горизонтальн|элемент.*вертикальн|тяж.*винтов|гайка.*опалубк|cuplock|каплок|ригель|втулка.*cuplock|подкос|вибратор|vpk|площадка.*крепления.*вибратор|домкрат.*опалуб|домкрат.*каплок|связь.*каплок|связь.*вертикальн|связь.*горизонтальн|угол.*внутренн|угол.*наружн|соединительный элемент|kalıp|iskele|kontrplak|plywood|kereste|tahta|kalas|payanda|kalıp vibratörü|лестниц.*алюмин|лестница.*трехсекцион|стремянк|akrobat merdiven|merdiven|baumak|баумак|доска.*обрезн|станок.*рубочн|станок.*гибочн|demir kesme makine|demir bükme makine|beton dağıtıcı bom|dağıtıcı bom|sany hg|hgy 15|бетонораспределительн|компрессор|kompresör|xas88/i.test(combined) ||
    supp.includes('профмастер') ||
    supp.includes('промстройконтракт') ||
    supp.includes('пск') ||
    supp.includes('рока') ||
    supp.includes('колорадо') ||
    supp.includes('baumak') ||
    supp.includes('баумак') ||
    supp.includes('гмс') ||
    supp.includes('атмос') ||
    supp.includes('м.с.к') ||
    (supp.includes('системный специалист') && /вибратор|vpk|площадка/i.test(combined))
  ) {
    return {
      category: 'Kalıp & İskele Sistemleri',
      subCategory: /фанер|plywood|kontrplak|доска/i.test(combined) ? 'Kalıplık Plywood & Ahşap' : (/лестниц|merdiven/i.test(combined) ? 'İskele & Şantiye Merdivenleri' : (/станок|demir.*kesme|demir.*bükme/i.test(combined) ? 'Demir İşleme Makineleri' : (/стрела|bom|компрессор|kompresör/i.test(combined) ? 'Beton Dağıtıcı Bom & Şantiye Makineleri' : 'Kalıp & İskele Donanımı'))),
      functionalDomain: 'FORMWORK',
      confidence: 0.96,
      reasoning: 'Kalıp, iskele parçaları, cuplock, vibratör, merdiven, demir makinesi, dağıtıcı bom veya plywood.',
      matchedKeywords: ['kalıp', 'iskele', 'plywood', 'cuplock', 'dağıtıcı bom']
    };
  }

  // 15. HARÇ & ŞAP (Litokol Yapıştırma Harcı, Grout, Tamir Harçları, Sıva, Şap, Alüminyum Mastar, Malalar, Spatula)
  if (
    /grout|граут|штукатурк|стяжк|шпаклевк|клей.*плиточн|ровнитель|сухая смесь|ротбанд|смесь.*цементно|воссмеси|цпс|tamir harc|sıva|şap|harç|fayans yapıştırıcı|litokol|клеевая смесь|гиперфлекс|суперфлекс|мастерок|правило|правило.*алюмин|şpatel|шпатель|spatula|sıva malası|alüminyum mastar/i.test(combined) ||
    (supp.includes('литокол') && /клей|смесь|harç/i.test(combined))
  ) {
    return {
      category: 'Harç & Şap',
      subCategory: /правило|мастерок|шпатель|spatula|mala|mastar/i.test(combined) ? 'Sıva & Şap El Aletleri' : (combined.includes('grout') || combined.includes('tamir') ? 'Grout & Tamir Harçları' : 'Kuru Harç & Yapıştırma Harçları'),
      functionalDomain: 'FINISHING',
      confidence: 0.96,
      reasoning: 'Kuru karışım harç, şap, fayans yapıştırıcı veya sıva mastar/mala aletleri.',
      matchedKeywords: ['harç', 'şap', 'grout', 'litokol', 'mastar']
    };
  }

  // 16. YAPI KİMYASALLARI (Su ile Şişen Kauçuk Profil, Lateks Katkı, Montaj Köpüğü, Silikon, Mastik, Epoksi, Su Yalıtımı, Dilatasyon Bandı, Alüminyum Bant, Kaydırmaz Bant, Kür Malzemesi)
  if (
    /набухающий.*профиль|гидроизоляц|резиновый профиль|латексная добавка|пена.*монтажн|samflex|soudal|tytan|герметик|силикон|мастика|праймер|эпоксид|добавка.*в.*бетон|пластификатор|dilatec|keragum|su yalıtım bandı|su ile şişen|lateks katkı|montaj köpüğü|yapı kimyasal|mastik|alüminyum.*yapışkan bant|kaydırmaz.*bant|çift taraflı.*bant|unibob|kontakt dom|moment.*yapıştırıcı|kür malzemesi|пленкообразующ|кюринг|\btent\b/i.test(combined) ||
    supp.includes('энкастрой') ||
    (supp.includes('урбанснаб') && /dilatec|sika|лента/i.test(combined))
  ) {
    return {
      category: 'Yapı Kimyasalları',
      subCategory: /лента|bant/i.test(combined) ? 'Teknik İzolasyon & Montaj Bantları' : 'Sızdırmazlık & Su Yalıtım Kimyasalları',
      functionalDomain: 'ENVELOPE',
      confidence: 0.95,
      reasoning: 'Montaj köpüğü, poliüretan mastik, su ile şişen profil, kür kimyasalı veya teknik bantlar.',
      matchedKeywords: ['yapı kimyasalları', 'köpük', 'mastik', 'yalıtım bandı', 'su yalıtım']
    };
  }

  // 17. YALITIM & ALÇIPAN (Taşyünü, Camyünü, EPS, Dornit Geotekstil, Dış Cephe Filesi, Alçıpan Levhalar, Knauf Profilleri, ÇSP)
  if (
    !combined.includes('саморез') &&
    !combined.includes('vida') &&
    !combined.includes('диск') &&
    !combined.includes('taşlama') &&
    (/минват|утеплител|пеноплекс|пенополистирол|гипсокартон|гкл|гвл|rockwool|isover|технониколь|рейка.*прижимн|планка.*прижимн|baskı çıtası|alçıpan|taşyünü|camyünü|izolasyon|yalıtım|strafor|пленка.*укрывн|пленка.*техническ|naylon örtü|koruma naylonu|koruyucu naylon|сетка.*серпянк|derz filesi|плита.*цсп|цсп|профиль.*knauf|knauf.*профиль|knauf.*50х40|u-profil 50x40|dornit|дорнит|geotekstil|геотекстиль|dış cephe filesi|cam elyaf.*file/i.test(combined) ||
    supp.includes('дипломат'))
  ) {
    return {
      category: 'Yalıtım & Alçıpan',
      subCategory: /дорнит|dornit|geotekstil|геотекстиль|dış cephe filesi/i.test(combined) ? 'Geotekstil Keçe & Cephe Donatı Filesi' : (/пленка|naylon/i.test(combined) ? 'Teknik Koruma Örtü & Naylonlar' : (/серпянк|derz filesi|профиль.*knauf|цсп/i.test(combined) ? 'Alçıpan Profilleri & Aksesuarları' : 'Isı & Ses Yalıtımı')),
      functionalDomain: 'ENVELOPE',
      confidence: 0.96,
      reasoning: 'Isı/ses yalıtım levhaları, geotekstil keçe, dış cephe filesi veya koruma naylonu.',
      matchedKeywords: ['yalıtım', 'alçıpan', 'geotekstil', 'koruma naylonu', 'knauf']
    };
  }

  // 18. ELEKTRİK & OTOMASYON (Kablo, Aydınlatma, Şalt, Pano, Bez İzole Bant, Piller, NIO Tornavida Takımı, KT Pense, Fotosel, El Feneri)
  if (
    /кабель|провод|автомат|рубильник|щит|ввг|свет|светильник|прожектор|освещен|трансформатор|розетк|выключател|клемма|изолятор|изолента|tdm|фонарь|fener|el feneri|трубка.*термоусадочн|вилка.*каучуков|фотореле|фотоэлемент|fotosel|бокорезы|индикаторн.*отвертк|нио-02|proline.*квт|kt 207d|kablo|sigorta|pano|aydınlatma|trafo|elektrik|\bpil\b|duracell|батарейк/i.test(combined) ||
    (combined.includes('gp') && /pil|battery|пакет/i.test(combined)) ||
    supp.includes('энергия') ||
    supp.includes('системные решения')
  ) {
    return {
      category: 'Elektrik & Otomasyon',
      subCategory: combined.includes('кабель') || combined.includes('kablo') ? 'Güç & Sinyal Kabloları' : (combined.includes('прожектор') || combined.includes('свет') || combined.includes('aydınlatma') || combined.includes('фонарь') ? 'Aydınlatma & Fener' : (/pil|duracell|батарей/i.test(combined) ? 'Piller & Mobil Enerji' : 'Şalt & Elektrik Malzemeleri')),
      functionalDomain: 'MEP',
      confidence: 0.96,
      reasoning: 'Elektrik altyapı kablolama, piller, projektör, izole bant, şalt veya test ekipmanları.',
      matchedKeywords: ['elektrik', 'kablo', 'aydınlatma', 'pil']
    };
  }

  // 19. MEKANİK & TESİSAT (Boru Tesisatı, Vana, Split Klima, Uç Hortumu, HDPE Boru, Hava Sterilizatörü, Damacana Pompası, Emniyet Valfi, Asansörler)
  if (
    !combined.includes('болт') &&
    !combined.includes('гайка') &&
    !combined.includes('cıvata') &&
    !combined.includes('somun') &&
    (/кран|вентиль|фланец|фитинг|отвод|тройник|задвижк|насос|счетчик|сантехник|отоплен|вентиляц|радиатор|шланг.*поливочн|рукав.*для.*воды|sulama hortumu|hava hortumu|titan lock|hantos|лифт|asansör|пассажирский.*лифт|грузовой.*лифт|трубный выпуск|гидрозатвор|уловитель|решетка водоприемн|водоприемн.*решетка|лоток.*дренажн|дренажный лоток|дренаж|vana|fittings|boru tesisat|klima|split klima|suzuki.*split|hdpe boru|uç hortumu|sk uç hortumu|damacana pompası|mekanik su pompası|emniyet valfi|alev emniyet|hava sterilizatörü|megidez|resirkülatör/i.test(combined) ||
    supp.includes('стандартпарк') ||
    supp.includes('щлз'))
  ) {
    return {
      category: 'Mekanik & Tesisat',
      subCategory: /лифт|asansör/i.test(combined) ? 'Asansör Sistemleri' : (/klima|sterilizatör|resirkülatör/i.test(combined) ? 'İklimlendirme, Havalandırma & Klima' : (/шланг|рукав|uç hortumu|hortum/i.test(combined) ? 'Endüstriyel Su & Beton/Hava Hortumları' : (/решетка|выпуск|лоток|дренаж|hdpe/i.test(combined) ? 'Altyapı & Drenaj Hatları' : 'Sıhhi Tesisat & Mekanik'))),
      functionalDomain: 'MEP',
      confidence: 0.96,
      reasoning: 'Mekanik tesisat ekipmanları, asansörler, klima sistemleri veya endüstriyel hortumlar.',
      matchedKeywords: ['mekanik tesisat', 'klima', 'hortum', 'asansör', 'vana']
    };
  }

  // 20. SERAMİK & VİTRİFİYE (Granit, Doğaltaş Bordür, Karo, Vitrifiye)
  if (
    !/bref|domestos|temizleyic|klozet bloğu|sabun|deterjan/i.test(combined) &&
    (/плитк|керамогранит|унитаз|раковин|смесител|ванна|санфаянс|камбулатовск|бордюр.*таш|плита.*термо|granit plaka|bordür taşı|fayans|seramik|vitrifiye|lavabo|klozet/i.test(combined) ||
    supp.includes('камнеобрабатывающий'))
  ) {
    return {
      category: 'Seramik & Vitrifiye',
      subCategory: /камбулатовск|бордюр|термо|granit/i.test(combined) ? 'Granit & Doğaltaş Kaplama' : 'Zemin/Duvar Seramikleri & Vitrifiye',
      functionalDomain: 'FINISHING',
      confidence: 0.95,
      reasoning: 'Doğaltaş granit, bordür, seramik karo ve vitrifiye ürünleri.',
      matchedKeywords: ['seramik', 'vitrifiye', 'granit']
    };
  }

  // 21. BOYA & DIŞ CEPHE
  if (/грунтовк|краск|эмаль|аэрозоль.*эмаль|валик.*малярн|валик.*мех|кисть.*малярн|ванночка.*малярн|boya|astar|sprey boya|vernik|boya rulosu|boya fırçası|лак|tikkurila|jotun|fawori/i.test(combined)) {
    return {
      category: 'Boya & Dış Cephe',
      subCategory: 'Boyalar & Uygulama Ekipmanları',
      functionalDomain: 'FINISHING',
      confidence: 0.95,
      reasoning: 'Boya, astar, vernik, boya rulosu veya cephe koruma malzemeleri.',
      matchedKeywords: ['boya', 'astar', 'boya rulosu']
    };
  }

  // 22. SARF MALZEME & HIRDAVAT (Kırıcı Uçlar SDS, Taşlama Çanağı, Maket Bıçağı, Manivela, Kaynak, DIN 1480 Talrep, DIN 985 Somun, DIN 933 Cıvata, Zımpara, Tork Anahtarı, Marş Motoru, Kelepçe, Kürek)
  if (
    isGeneralConsumable(combined) ||
    /автошина|колесо|шина|топ-шина|диск|сверло|бур|бита|коронка|зубило|пика|лом|гвоздодер|нож.*строительн|лезвие|шпатель|тальреп|стрейч|скотч|лента.*монтажн|лента.*малярн|мешки.*пп|мусорн.*мешк|гнездо.*сварочн|вилка.*сварочн|скр-|горелка.*газов|pürmüz|şalümo|manivela|murç|keski|din 933|din 985|din 1480|din1480|gost 7805|саморез|шуруп|дюбель|молоток|черенок|щетка|çekiç|balyoz|keser|fırça|süpürge|электрод|рутил|kaynak|замок.*навесн|фильтр|сепаратор|yağ|antifriz|масло.*моторн|антифриз|тосол|смазка|зарядное устройство|gal 1880|текер|ось|mil|aks|трос|канат|ип|полипропилен.*ип|ip|kare somun|karbosan|matrix|чашка.*алмазн|somun sıkma|btiw-|zımpara|mikser ucu|sds-plus.*mikser|depo kapağı|fan çarkı|pervane|yanma kontrol|rotor|hortum kelepçesi|kelepçe|ecofix|tork anahtarı|stahlwille|kürek|франкфурт|marş motoru|krauf|boru anahtarı|sibrteh|zubr|пружина|tecnol|icepro|сварки и резки|maket bıçağı ucu/i.test(combined) ||
    supp.includes('топ-шина') ||
    supp.includes('всеинструменты') ||
    supp.includes('бид тулс') ||
    supp.includes('снабтех') ||
    supp.includes('дипос') ||
    supp.includes('технорум') ||
    supp.includes('системный специалист') ||
    supp.includes('сам')
  ) {
    let sub = 'Genel Hırdavat & Bağlantı';
    if (/автошина|колесо|lastik|teker|фильтр|масло|antifriz|yağ|сепаратор|ось|mil|aks|marş motoru|krauf|rotor|fan çarkı|depo kapağı/i.test(combined)) {
      sub = 'Araç & Makine Bakım Sarfiyatı';
    } else if (/зубило|пика|диск|сверло|бур|бита|коронка|чашка.*алмазн|франкфурт|zımpara|mikser ucu|kesici|delici/i.test(combined)) {
      sub = 'Kesici & Delici Sarf Uçlar';
    } else if (/горелка|скр-|вилка.*сварочн|электрод|рутил|kaynak|сварки/i.test(combined)) {
      sub = 'Kaynak Sarfiyatı & Ekipman';
    } else if (/нож|лезвие|лом|гвоздодер|manivela|çekiç|balyoz|süpürge|fırça|tork anahtarı|boru anahtarı|kürek|somun sıkma/i.test(combined)) {
      sub = 'Şantiye El Aletleri & Ekipman';
    } else if (/мешки|стрейч|скотч|лента|тальреп|ip|канат|трос|kelepçe|пружина/i.test(combined)) {
      sub = 'Şantiye Paketleme & Sarf Malzeme';
    }

    return {
      category: 'Sarf Malzeme & Hırdavat',
      subCategory: sub,
      functionalDomain: 'CONSUMABLE',
      confidence: 0.95,
      reasoning: 'Şantiye sarf malzemesi, delici/kesici uç, kaynak sarfiyatı, el aleti veya makine ekipmanı.',
      matchedKeywords: ['sarf malzeme', 'hırdavat']
    };
  }

  // 23. AGGRESSIVE SUPPLIER HEURISTIC FALLBACK (Never surrender to Diğer Malzeme!)
  if (supp) {
    if (supp.includes('комус') || supp.includes('поинтер') || supp.includes('самснаб')) {
      return {
        category: 'Ofis & Kırtasiye',
        subCategory: 'Ofis & Tüketim Malzemeleri',
        functionalDomain: 'IT_OFFICE',
        confidence: 0.90,
        reasoning: 'Tedarikçi profili ve ürün özellikleri ofis/kırtasiye kategorisiyle eşleştirildi.',
        matchedKeywords: ['tedarikçi: ofis/kırtasiye']
      };
    }
    if (supp.includes('бим прибор')) {
      return {
        category: 'Ölçüm & Saha Cihazları',
        subCategory: 'Geodezi & Harita Ölçüm Ekipmanları',
        functionalDomain: 'SURVEYING',
        confidence: 0.90,
        reasoning: 'BİM Ölçüm ve Geodezi Cihazları tedarikçi uzmanlığına göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: bim pribor']
      };
    }
    if (supp.includes('литокол') || supp.includes('энкастрой')) {
      return {
        category: 'Harç & Şap',
        subCategory: 'Yapı Harçları & Kimyasalları',
        functionalDomain: 'FINISHING',
        confidence: 0.90,
        reasoning: 'Yapı kimyasalı ve harç tedarikçisi profiline göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: litokol/harç']
      };
    }
    if (supp.includes('дипломат') || supp.includes('технониколь')) {
      return {
        category: 'Yalıtım & Alçıpan',
        subCategory: 'Yalıtım & Koruma Malzemeleri',
        functionalDomain: 'ENVELOPE',
        confidence: 0.90,
        reasoning: 'Yalıtım ve kuru yapı tedarikçisi profiline göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: yalıtım']
      };
    }
    if (supp.includes('щлз')) {
      return {
        category: 'Mekanik & Tesisat',
        subCategory: 'Asansör Ekipmanları',
        functionalDomain: 'MEP',
        confidence: 0.90,
        reasoning: 'Asansör fabrikası tedarikçi profiline göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: asansör']
      };
    }
    if (supp.includes('исткульт')) {
      return {
        category: 'Duvar Elemanları & Gazbeton',
        subCategory: 'Gazbeton Blok & Lento',
        functionalDomain: 'STRUCTURAL',
        confidence: 0.95,
        reasoning: 'İstkult gazbeton üreticisi tedarikçi profiline göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: istkult']
      };
    }
    if (supp.includes('металл') || supp.includes('северсталь') || supp.includes('нлмк') || supp.includes('эльба') || supp.includes('дипос')) {
      return {
        category: 'Çelik Malzemeler',
        subCategory: 'Çelik & Metal Ürünleri',
        functionalDomain: 'STRUCTURAL',
        confidence: 0.90,
        reasoning: 'Metal/çelik üreticisi tedarikçi profiline göre kategorize edildi.',
        matchedKeywords: ['tedarikçi: çelik/metal']
      };
    }
    if (supp.includes('петрович') || supp.includes('строительный двор')) {
      return {
        category: 'Harç & Şap',
        subCategory: 'Genel İnşaat Malzemeleri',
        functionalDomain: 'FINISHING',
        confidence: 0.85,
        reasoning: 'İnşaat market tedarikçi profiline göre yapı malzemesi havuzuna aktarıldı.',
        matchedKeywords: ['tedarikçi: inşaat market']
      };
    }
    if (supp.includes('трейдми') || supp.includes('рус-гарант')) {
      return {
        category: 'Şantiye Mobilizasyon & Yaşam',
        subCategory: 'Depolama & Şantiye Donanımı',
        functionalDomain: 'MOBILIZATION',
        confidence: 0.90,
        reasoning: 'Şantiye donanım ve depolama tedarikçisi profiline göre kategorize edildi.',
        matchedKeywords: ['tedarikçi: mobilizasyon']
      };
    }
    if (supp.includes('промстройконтракт') || supp.includes('профмастер') || supp.includes('рока') || supp.includes('баумак') || supp.includes('гмс')) {
      return {
        category: 'Kalıp & İskele Sistemleri',
        subCategory: 'Kalıp & İskele Donanımı',
        functionalDomain: 'FORMWORK',
        confidence: 0.90,
        reasoning: 'Kalıp ve iskele tedarikçi uzmanlığına göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: kalıp/iskele']
      };
    }
    if (supp.includes('веста')) {
      return {
        category: 'İş Güvenliği & KKD',
        subCategory: 'Kaldırma & Güvenlik Ekipmanı',
        functionalDomain: 'SAFETY',
        confidence: 0.90,
        reasoning: 'İş güvenliği ve kaldırma ekipmanları tedarikçi profiline göre eşleştirildi.',
        matchedKeywords: ['tedarikçi: vesta isg']
      };
    }
    if (supp.includes('стандартпарк')) {
      return {
        category: 'Mekanik & Tesisat',
        subCategory: 'Altyapı & Drenaj Hatları',
        functionalDomain: 'MEP',
        confidence: 0.90,
        reasoning: 'Standartpark altyapı drenaj ve tesisat tedarikçisi profiline göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: standartpark drenaj']
      };
    }
    if (supp.includes('энергия') || supp.includes('системные решения')) {
      return {
        category: 'Elektrik & Otomasyon',
        subCategory: 'Şalt & Elektrik Malzemeleri',
        functionalDomain: 'MEP',
        confidence: 0.90,
        reasoning: 'Elektrik malzemeleri tedarikçi uzmanlığına göre sınıflandırıldı.',
        matchedKeywords: ['tedarikçi: elektrik']
      };
    }
    if (supp.includes('сам') || supp.includes('снабтех') || supp.includes('бид тулс') || supp.includes('технорум') || supp.includes('всеинструменты')) {
      return {
        category: 'Sarf Malzeme & Hırdavat',
        subCategory: 'Genel Hırdavat & Bağlantı',
        functionalDomain: 'CONSUMABLE',
        confidence: 0.90,
        reasoning: 'Hırdavat ve el aletleri tedarikçi profiline göre sarf kategorisine aktarıldı.',
        matchedKeywords: ['tedarikçi: hırdavat/sarf']
      };
    }
  }

  // Default Fallback (Single Source of Truth: Canonical Category)
  return {
    category: 'Sarf Malzeme & Hırdavat',
    subCategory: 'Genel Şantiye İhtiyaçları',
    functionalDomain: 'CONSUMABLE',
    confidence: 0.50,
    reasoning: 'Spesifik eşleşme bulunamadı, sarf malzeme ve hırdavat kategorisine alındı.',
    matchedKeywords: []
  };
}

// ============================================================================
// CANONICAL PRODUCT ID (CPID) GENERATOR
// ============================================================================

export function generateCanonicalProductId(
  category: string,
  canonicalName: string,
  attrs: ExtractedAttributes
): string {
  const catCode = CATEGORY_CODES[category] || 'GENEL';

  // Slugify canonical name
  const cleanName = canonicalName
    .toUpperCase()
    .replace(/[İIŞĞÜÖÇ]/g, (m) => {
      const trMap: Record<string, string> = { İ: 'I', I: 'I', Ş: 'S', Ğ: 'G', Ü: 'U', Ö: 'O', Ç: 'C' };
      return trMap[m] || m;
    })
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  // Key attributes slug
  const parts: string[] = [];
  if (attrs.diameter) parts.push(attrs.diameter.replace(/[^A-Z0-9]/gi, ''));
  if (attrs.grade) parts.push(attrs.grade.replace(/[^A-Z0-9]/gi, ''));
  if (attrs.dimensions) parts.push(attrs.dimensions.replace(/[^A-Z0-9]/gi, ''));
  if (attrs.volumeOrWeight) parts.push(attrs.volumeOrWeight.replace(/[^A-Z0-9]/gi, ''));
  if (attrs.brand) parts.push(attrs.brand.toUpperCase().replace(/[^A-Z0-9]/gi, ''));

  const attrSlug = parts.filter(Boolean).join('-');
  return attrSlug ? `CPID-${catCode}-${cleanName}-${attrSlug}` : `CPID-${catCode}-${cleanName}`;
}

// ============================================================================
// MAIN ENTRY POINT: processItem
// ============================================================================

/**
 * Centralized decision engine function that takes any invoice item, offer line,
 * or raw material input, performs attribute extraction, strict functional classification
 * (e.g. 'Ankraj Sistemleri' vs. 'Sarf Malzeme'), and generates a canonical product ID.
 */
export function processItem(
  rawItem: ProcessItemInput,
  options: ProcessItemOptions = {}
): ProcessedItemResult {
  const rawName = String(rawItem.materialName || rawItem.name || rawItem.description || '').trim();
  const rawOriginal = String(rawItem.originalName || '').trim();
  const rawUnit = String(rawItem.unit || 'adet').trim();

  // 1. Extract Normalized Attributes
  const attributes = extractNormalizedAttributes(rawName, rawOriginal, rawUnit);

  // Apply explicit overrides from input if provided
  if (rawItem.brand) attributes.brand = rawItem.brand;
  if (rawItem.diameter) attributes.diameter = rawItem.diameter;
  if (rawItem.grade) attributes.grade = rawItem.grade;
  if (rawItem.dimensions) attributes.dimensions = rawItem.dimensions;
  if (rawItem.standard) attributes.standard = rawItem.standard;

  // 2. Perform Functional Classification
  const supplier = (rawItem.supplier || options.defaultSupplier || '').trim();
  let classification = classifyItem(rawName, rawOriginal, attributes, supplier);

  // Optional preservation of custom high-confidence category
  if (options.preserveCustomCategory && rawItem.category && rawItem.category !== 'Genel' && rawItem.category !== 'Diğer Malzeme' && rawItem.category !== 'Diğer') {
    // Still strictly enforce Ankraj Sistemleri if item is detected as structural anchor
    if (!options.strictAnchoringCheck || !isAnchoringSystem(`${rawName} ${rawOriginal}`)) {
      classification = {
        ...classification,
        category: normalizeCategoryName(rawItem.category, `${rawName} ${rawOriginal}`),
        subCategory: rawItem.subCategory || classification.subCategory,
        confidence: 0.90,
        reasoning: 'Mevcut kullanıcı/sistem kategorisi normalize edilerek korundu.'
      };
    }
  }

  // 3. Resolve Canonical Name Standardizations (e.g. Rebar, Angle, Mesh, Pipe, Block mapping)
  let canonicalName = attributes.canonicalName;
  const combined = `${rawName} ${rawOriginal}`.toLowerCase();

  // A. KÖŞEBENT DEMİR (L-PROFİL)
  const angleSpec = extractAngleDimensions(combined);
  if (
    angleSpec &&
    (/köşebent|kosebent|уголок|l\s*demir|l\s*profil/i.test(combined) ||
     (combined.includes('угол') && /\d{2,3}\s*[*xх]\s*\d{2,3}/.test(combined))) &&
    !/папка|салфет|щеток|кровать|петля|двер|внутренний|наружный/i.test(combined)
  ) {
    canonicalName = `L-Köşebent Demir ${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness} mm (GOST 8509)`;
    classification.category = 'Çelik Malzemeler';
    classification.subCategory = 'Hadde Profil & Yapısal Çelik Sac';
    attributes.dimensions = `${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness} mm`;
  }
  // B1. BAZALT, CAM ELYAF VE DERZ FİLELERİ (Özel Donatı ve Cephe Fileleri)
  else if (/базальт|bazalt|duvar.*örgü.*file/i.test(combined)) {
    canonicalName = 'Bazalt Duvar Örgü Filesi 25x25 mm (50 m² Rulo)';
    classification.category = 'Duvar Elemanları & Gazbeton';
    classification.subCategory = 'Gazbeton, Blok & Duvar Örgü Malzemeleri';
  }
  else if (/стеклоткан|cam elyaf|фасадн.*сетк|dış cephe file/i.test(combined)) {
    canonicalName = 'Cam Elyaf Dış Cephe Donatı Filesi 165 g/m² (50 m² Rulo)';
    classification.category = 'Yalıtım & Alçıpan';
    classification.subCategory = 'Geotekstil Keçe & Cephe Donatı Filesi';
  }
  else if (/серпянк|derz file/i.test(combined)) {
    canonicalName = 'Kendinden Yapışkanlı Derz Filesi Bandı 50mm x 45m';
    classification.category = 'Yalıtım & Alçıpan';
    classification.subCategory = 'Alçıpan Profilleri & Aksesuarları';
  }
  // B2. ÇELİK HASIR & BETONARME DONATI HASIRI (GOST 23279 / TU)
  else if (
    (/hasır|hasir|çelik.*hasır|hasır.*çelik|сетк.*(сварн|арматурн|кладочн|вр)/i.test(combined) ||
     ((combined.includes('сетка') || combined.includes('hasır')) && (combined.includes('100х100') || combined.includes('100x100') || combined.includes('150x150') || combined.includes('150х150') || combined.includes('50x50') || combined.includes('50х50')))) &&
    !/кресло|кровать|ранза|koltuk|çit|çevre.*paneli/i.test(combined)
  ) {
    const meshSpec = extractMeshSpecs(combined) || { pitchX: 100, pitchY: 100, wireDiam: 4, weightPerM2: 1.97 };
    canonicalName = `Çelik Hasır ${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam} mm (Вр-1 GOST 23279)`;
    classification.category = 'İnşaat Demiri';
    classification.subCategory = 'Hasır Çelik';
    attributes.dimensions = `${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam} mm`;
  }
  // C. KUTU PROFİL / PROFİL BORU
  else if (
    (/труба.*профильн|профильн.*труб|kutu.*profil|profil.*boru/i.test(combined) ||
     (combined.includes('труб') && (combined.includes('40х20') || combined.includes('40x20') || combined.includes('40x40') || combined.includes('50x50') || combined.includes('60x40') || combined.includes('80x80') || combined.includes('100x100')))) &&
    !/каркас.*ворот|калитка|çit|çevre.*paneli|kapı.*karkası|yaya.*kapısı/i.test(combined)
  ) {
    const pipeSpec = extractProfilePipeSpecs(combined);
    if (pipeSpec) {
      canonicalName = `Kutu Profil ${pipeSpec.width}x${pipeSpec.height}x${pipeSpec.thickness} mm (GOST 8639/8645)`;
      classification.category = 'Çelik Borular';
      classification.subCategory = 'Sanayi & Profil Boruları';
      attributes.dimensions = `${pipeSpec.width}x${pipeSpec.height}x${pipeSpec.thickness} mm`;
    }
  }
  // D. ŞVELLER (U-PROFİL)
  else if (/швеллер|şveller|u\s*profil/i.test(combined)) {
    const chanSpec = extractChannelSpecs(combined);
    if (chanSpec) {
      canonicalName = `U-Profil Şveller ${chanSpec.channelNumber} (GOST 8240-97)`;
      classification.category = 'Çelik Malzemeler';
      classification.subCategory = 'Hadde Profil & Yapısal Çelik Sac';
    }
  }
  // E. GAZBETON BLOK
  else if (/газобетон|gazbeton|bonolit|poritep|ytong|istkult|исткульт/i.test(combined) && !/клей|harç|перемычка|lento/i.test(combined)) {
    const gazSpec = extractGazbetonDimensions(combined);
    const density = combined.includes('d500') ? 'D500' : 'D600';
    if (gazSpec) {
      canonicalName = `Gazbeton Blok ${gazSpec.width}x${gazSpec.height}x${gazSpec.length} mm ${density}`;
    } else {
      canonicalName = `Gazbeton Blok ${density}`;
    }
    classification.category = 'Duvar Elemanları & Gazbeton';
    classification.subCategory = 'Gazbeton, Blok & Duvar Örgü Malzemeleri';
  }
  // F. SU YALITIM MEMBRANI (İzoplast, Technoelast)
  else if (/изопласт|техноэласт|izoplast|technoelast/i.test(combined) && /рулон|rulo|эпп|экп|epp|ekp|мембран/i.test(combined)) {
    const brand = /техноэласт|technoelast/i.test(combined) ? 'Technoelast' : 'İzoplast';
    const type = /экп|ekp/i.test(combined) ? 'EKP' : 'EPP-4.0';
    canonicalName = `${brand} ${type} Su Yalıtım Membranı (10 m² Rulo)`;
    classification.category = 'Yalıtım & Alçıpan';
    classification.subCategory = 'Isı & Ses Yalıtımı';
  }
  // G. GEOTEKSTİL KEÇE (Dornit / Georex)
  else if (/дорнит|геотекстил|dornit|geotekstil|georex/i.test(combined) && !/сетка/i.test(combined)) {
    let density = 300;
    if (combined.includes('500')) density = 500;
    else if (combined.includes('400')) density = 400;
    else if (combined.includes('200')) density = 200;
    else if (combined.includes('250')) density = 250;
    else if (combined.includes('350')) density = 350;
    canonicalName = `Dornit Geotekstil Keçe ${density} g/m² (Rulo)`;
    classification.category = 'Yalıtım & Alçıpan';
    classification.subCategory = 'Geotekstil Keçe & Cephe Donatı Filesi';
  }
  // H. ALÇIPAN
  else if (/гипсокартон|alçıpan|alcipan|гкл/i.test(combined) && !/саморез|vida|dübel/i.test(combined)) {
    const isMoisture = /влагостой|suya|gklv|гклв/i.test(combined);
    canonicalName = isMoisture ? 'Knauf Suya Dayanıklı Alçıpan GKLV 12.5 mm (1.2x2.5 m)' : 'Knauf Standart Alçıpan GKL 12.5 mm (1.2x2.5 m)';
    classification.category = 'Yalıtım & Alçıpan';
    classification.subCategory = 'Isı & Ses Yalıtımı';
  }
  // H2. İNŞAAT DEMİRİ KORUYUCU GÜVENLİK BAŞLIĞI / MANTARI (Sarf Malzeme & Hırdavat)
  else if (/колпачок|грибок|güvenlik.*mantar|koruyucu.*başlık|güvenlik.*başlığı/i.test(combined)) {
    const isPack1000 = /1000|упак/i.test(combined);
    const packSuffix = isPack1000 ? ' (1000 Adetlik Paket)' : '';
    let diaRange = '10-18 mm';
    const mRange = combined.match(/(\d+[\s-–]+\d+)\s*(?:мм|mm)?/);
    if (mRange) diaRange = `${mRange[1].replace(/\s+/g, '')} mm`;
    canonicalName = `İnşaat Demiri Güvenlik Başlığı Mantar Tip ${diaRange}${packSuffix}`;
    classification.category = 'Sarf Malzeme & Hırdavat';
    classification.subCategory = 'İş Güvenliği & Koruyucu Donatı Başlığı';
    attributes.standardUnit = 'Adet';
  }
  // I. İNŞAAT DEMİRİ (A500C)
  else if (classification.category === 'İnşaat Demiri') {
    const diameters = [36, 32, 28, 25, 22, 20, 18, 16, 14, 12, 10, 8, 40];
    for (const d of diameters) {
      const regexes = [
        new RegExp(`(?:ø|d\\s*=?|диаметр\\s*=?|çap\\s*=?)\\s*${d}(?:$|[^a-zA-Zа-яА-Я0-9])`, 'i'),
        new RegExp(`(?:^|[^a-zA-Zа-яА-Я0-9])${d}\\s*[*xх]\\s*11700`, 'i'),
        new RegExp(`(?:^|[^a-zA-Zа-яА-Я0-9])${d}\\s*(?:мм|mm)(?:$|[^a-zA-Zа-яА-Я0-9])`, 'i'),
        new RegExp(`(?:^|[^a-zA-Zа-яА-Я0-9])(?:a500c|а500с)\\s*(?:ø|d)?\\s*${d}(?:$|[^a-zA-Zа-яА-Я0-9])`, 'i')
      ];
      if (regexes.some((r) => r.test(combined))) {
        canonicalName = STANDARD_REBAR_MAP[d];
        attributes.diameter = `Ø${d} mm`;
        attributes.grade = 'A500C';
        break;
      }
    }
  } else if (classification.category === 'Ankraj Sistemleri') {
    // Enhance chemical anchor naming clarity if volume and brand are recognized
    if (classification.subCategory.includes('Kimyasal') && attributes.brand && attributes.volumeOrWeight) {
      canonicalName = `${attributes.brand} Kimyasal Ankraj Kartuşu (${attributes.volumeOrWeight})`;
    }
  }

  attributes.canonicalName = canonicalName;

  // 4. Generate Deterministic Canonical Product ID
  const canonicalProductId = generateCanonicalProductId(classification.category, canonicalName, attributes);

  const quantity = Number(rawItem.quantity) || 1;
  const unitPrice = Number(rawItem.unitPrice) || 0;
  const totalPrice = Number(rawItem.totalPrice) || (quantity * unitPrice);

  return {
    id: rawItem.id,
    canonicalProductId,
    canonicalName,
    originalName: rawOriginal || rawName,
    category: normalizeCategoryName(classification.category, `${canonicalName} ${rawOriginal}`),
    subCategory: classification.subCategory,
    unit: attributes.standardUnit,
    quantity,
    unitPrice,
    totalPrice,
    functionalDomain: classification.functionalDomain,
    confidence: classification.confidence,
    attributes,
    classification,
    isAnchoringSystem: classification.category === 'Ankraj Sistemleri',
    isConsumable: classification.category === 'Sarf Malzeme & Hırdavat' || classification.category === 'Sarf Malzeme'
  };
}

/**
 * Batch processes multiple items consistently
 */
export function batchProcessItems(
  rawItems: ProcessItemInput[],
  options: ProcessItemOptions = {}
): ProcessedItemResult[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => processItem(item, options));
}
