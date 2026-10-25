/**
 * ORTAK "AYNI MALZEME" EŞLEŞTİRİCİSİ (tek kural seti)
 *
 * Hızlı Ön Onay Fiyat Denetimi, yeni indirim kaydının kaydetme öncesi kontrolü,
 * Anomali & Fiyat Artış Paneli ve Yönetici "İndirimli Kayıtta Farklı Faturalar" denetimi
 * iki fatura satırının aynı malzeme olup olmadığına ve hangi fiyatın gerçek kıyas fiyatı
 * olduğuna bu modülle karar verir.
 *
 * Kurallar (Berkant, 2026-10-25):
 * - Yalnızca aynı malzeme kıyaslanır: marka, model ve tüm teknik özellikler aynı olmalı.
 *   Farklı marka, model, ölçü, sınıf veya varyant asla kıyaslanmaz.
 * - Fiyat uydurulmaz: yalnızca faturada kayıtlı gerçek birim fiyat kullanılır. Birim farklıysa
 *   yalnızca kesin metrik dönüşüm (kg ⟷ ton, g ⟷ kg, ml ⟷ l) yapılır; yoğunluk, paket, plaka gibi
 *   tahmine dayalı dönüşümlerle fiyat türetilmez.
 * - Fiyat tabanı %22 KDV dahil birim fiyattır (vatBasis.ts).
 */
import {
  extractTechnicalStandardAndGrade,
  areTechnicalVariantsCompatible,
  TechnicalVariantProfile
} from './materialGroupIntegrity';
import { getProductIdentity, compareProductIdentities, ProductIdentity } from './sameMaterialGuard';
import { normalizeUnit } from './comparativeCalculation';
import { getCoreVendorKey } from './vendorNormalizer';

export const BRAND_SYNONYMS_MAP: Record<string, string> = {
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

export function isFreightOrServiceLineText(text?: string): boolean {
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
  /** Metindeki tüm sayılar (tekrarlar korunur, küçükten büyüğe) */
  numbers: number[];
  gostKey: string;
  stems: string[];
  exactKey: string;
  techVariant: TechnicalVariantProfile;
}

const STRICT_SIGNATURE_CACHE = new Map<string, StrictOriginalMaterialSignature | null>();

/**
 * Fatura satırındaki 1C stok kodu, satır numarası ve sayfa altı metni gibi malzemeye ait olmayan
 * parçaları temizler ("0000068540 0 Дверь …", "8 Нож …", "… Счет № ММЭ00184265 от …").
 */
export function stripInvoiceLineNoise(text: string): string {
  let s = String(text || '').trim();
  // Fatura sayfa altı / başlık metni satıra yapışmışsa kes
  s = s
    .replace(/\s+(?:сч[её]т|счет-фактура|упд)\s*№.*$/i, '')
    .replace(/\s+страница\s+\d+.*$/i, '')
    .replace(/\s+(?:всего|итого)\s*:.*$/i, '');
  // Baştaki stok/artikel kodu (5+ hane) ve/veya satır numarası (1-3 hane), ardından ürün adı gelir
  s = s.replace(/^(?:[а-яa-z]{1,3}\d?[-/])?\d{5,12}\s+(?=[\dа-яёa-z])/i, '');
  s = s.replace(/^\d{1,3}\s+(?=[а-яё])/i, '');
  return s.trim();
}

/**
 * Orijinal dildeki (Kiril varsa Rusça) metinden sıra bağımsız kesin parmak izi çıkarır.
 * Her sayı (ölçü, kalınlık, çap, yoğunluk, ağırlık, paket adedi, model no), marka, standart (GOST/TU),
 * kalite sınıfı ve Rusça kelime kökü aynı olmalıdır.
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

  // Rusça orijinal metin her zaman tercih edilir; Türkçe çeviri asla eklenmez
  let raw = hasCyrOrig ? orig : (hasCyrMat ? mat : (orig || mat));
  if (!raw || isFreightOrServiceLineText(raw) || isFreightOrServiceLineText(mat)) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  // Teknik varyant profili (GOST/TU, Sort 1/2/3, nem, yüzey, ağaç türü, kesit) SKU önekleri silinmeden çıkarılır
  const techVariant = extractTechnicalStandardAndGrade(orig, mat);

  // Prizma şantiye önekleri ve sondaki köşeli parantezli çeviriler
  if (raw.includes('/') || raw.includes('\\')) {
    raw = raw.replace(/^[^\n]{1,60}?(?:ФАКТ|FAKT|ПЛАН|PLAN|АВАНС|AVANS|STF|BTF|СЧЕТ|SCHET)\s*[/|\\-]\s*/i, '');
  }
  if (raw.endsWith(']')) {
    raw = raw.replace(/\[[^\]]+\]$/g, '');
  }
  raw = stripInvoiceLineNoise(raw);

  if (!raw || isFreightOrServiceLineText(raw)) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  let s = raw.toLowerCase().replace(/ё/g, 'е');
  // Tedarikçi 1C nomenklatür önekleri ("у0-00029058 ", "01-09о ", "01-102г ")
  s = s
    .replace(/^(?:[а-яa-z]{1,3}\d?[-/])?\d{5,12}\s+(?=[а-яa-z])/i, '')
    .replace(/^\d{1,3}-\d{1,3}[а-яa-z]?\s+(?=[а-я])/i, '')
    .trim();
  s = s
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\b(?:d\.bor|д\.бор)\b/gi, 'dbor');

  const gostMatches: string[] = [];
  s = s.replace(/(?:^|[^а-яa-z0-9])(гост|ту|din|iso)\s*(?:р\s*)?(\d+(?:[.-]\d+)*)/gi, (_, std, num) => {
    const mainNum = String(num).split(/[.-]/)[0];
    gostMatches.push(`${String(std).toLowerCase()}:${mainNum}`);
    return ' ';
  });

  const numbers = (s.match(/\d+(?:\.\d+)?/g) || [])
    .map(n => Number(n))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  const numericSig = numbers.map(n => String(n)).join('|');

  const cleanTokens = s
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/[^а-яa-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

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
    // Standart kelimeleri techVariant yönetir: standart belirtilmeyen kayıt GOST'lu ve TU'lu kayıtla aynı kovaya düşer,
    // ama GOST ile TU birbirleriyle asla eşleşmez.
    if (tok === 'гост' || tok === 'gost' || tok === 'ту' || tok === 'tu') continue;
    const stem = stemOriginalRussianWord(tok);
    if (stem && stem.length >= 2 && !STRICT_STOP_WORDS.has(stem) && stem !== 'гост' && stem !== 'ту') {
      wordStems.push(stem);
    }
  }

  // Ürün adı yalnızca birim benzeri kelimeden oluşuyorsa ("Лист г/к 20х1500х6000") o kelime ürün adıdır
  if (wordStems.length === 0) {
    for (const tok of cleanTokens) {
      if (tok.length >= 3 && !['для', 'или', 'при', 'под', 'над', 'без', 'гост', 'gost'].includes(tok)) wordStems.push(stemOriginalRussianWord(tok));
    }
  }
  const uniqueStems = Array.from(new Set(wordStems)).sort();
  if (uniqueStems.length === 0 && !techVariant.isTimber) {
    STRICT_SIGNATURE_CACHE.set(cacheKey, null);
    return null;
  }

  // Kereste kalemlerinde kova anahtarı kesit/ölçüdür (TIMBER::50x100x6000); kova içindeki adaylar
  // compareMaterialSignatures ile ürün tipi, GOST/TU, Sort, nem, yüzey ve ağaç türüne göre kesin filtrelenir.
  const exactKey = (techVariant.isTimber && techVariant.crossSectionDims)
    ? `TIMBER::${techVariant.crossSectionDims}`
    : `${numericSig || '_'}::${uniqueStems.join('|')}`;

  const result: StrictOriginalMaterialSignature = {
    rawOriginalText: raw,
    hasCyrillic: hasCyrOrig || hasCyrMat,
    brand,
    numericSig,
    numbers,
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

// ---------------------------------------------------------------------------
// Malzeme profili ve "aynı malzeme mi?" kararı
// ---------------------------------------------------------------------------

export interface MaterialMatchProfile {
  sig: StrictOriginalMaterialSignature;
  identity: ProductIdentity;
}

const PROFILE_CACHE = new Map<string, MaterialMatchProfile | null>();

export function buildMaterialMatchProfile(item: {
  originalName?: string;
  materialName?: string;
  brand?: string;
  category?: string;
}): MaterialMatchProfile | null {
  const key = `${item.originalName || ''}\u0000${item.materialName || ''}\u0000${item.brand || ''}\u0000${item.category || ''}`;
  if (PROFILE_CACHE.has(key)) return PROFILE_CACHE.get(key)!;
  const sig = buildStrictOriginalMaterialSignature(item);
  const profile = sig
    ? { sig, identity: getProductIdentity(sig.rawOriginalText, item.materialName || '', item.category || '') }
    : null;
  if (PROFILE_CACHE.size < 25000) PROFILE_CACHE.set(key, profile);
  return profile;
}

export interface SameMaterialVerdict {
  same: boolean;
  /** true: orijinal metin (kelime kökleri + tüm sayılar) birebir aynı */
  exact: boolean;
  reason?: string;
}

const TIMBER_PRODUCT_RE = /(брус|доск|рейк|бревн|вагонк|планкен|брусок|горбыл|шпал)/;

function timberProductKind(text: string): string {
  const m = String(text || '').toLowerCase().replace(/ё/g, 'е').match(TIMBER_PRODUCT_RE);
  if (!m) return '';
  return m[1] === 'брусок' ? 'брус' : m[1];
}

const REBAR_BAR_RE = /арматур|пруток|армирован/;
const REBAR_ACCESSORY_RE = /фиксатор|каркас|муфт|сетк|хомут|вязальн|звездоч|стульчик|заглушк|колпач|проволок|гнут|изделие/;

/**
 * Donatı çubuğu ise "REBAR::<çap>::<sınıf>" anahtarı (sınıf yoksa boş değildir: '?').
 * Donatı aksesuarları (fiksatör, kafes, manşon, hasır) donatı çubuğu sayılmaz.
 */
export function rebarBarKey(p: MaterialMatchProfile): string {
  const text = p.sig.rawOriginalText.toLowerCase().replace(/ё/g, 'е');
  if (!REBAR_BAR_RE.test(text) || REBAR_ACCESSORY_RE.test(text)) return '';
  const diameter = p.identity.rebarDiameter;
  if (!diameter) return '';
  const grade = [...(p.identity.grades.get('a') || [])].sort().join('/') || '?';
  return `REBAR::${diameter}::${grade}`;
}

// Malzeme kimliği taşımayan kelime kökleri (stok durumu, "дл." kısaltması)
const NOISE_STEMS = new Set(['дл', 'налич', 'наличи', 'шт', 'нов', 'товар', 'цен', 'всег', 'итог']);

function stemsMatch(x: string, y: string): boolean {
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && long.startsWith(short);
}

function areStemSetsEquivalent(a: string[], b: string[]): boolean {
  const ca = a.filter(s => !NOISE_STEMS.has(s));
  const cb = b.filter(s => !NOISE_STEMS.has(s));
  if (ca.length === 0 || cb.length === 0) return false;
  return ca.every(x => cb.some(y => stemsMatch(x, y))) && cb.every(y => ca.some(x => stemsMatch(x, y)));
}

const PROJECT_SPECIFIC_RE = /(?:^|[^а-яa-z])(?:кр|кп|фр|зд|мн|мк|км|ск|пк|оп)[-\s.]?\d/;

/** Çizim işaretli projeye özel imalat kalemi mi (Каркас арматурный Кр-1, Закладная деталь ЗД-3)? */
export function isProjectSpecificItem(p: MaterialMatchProfile): boolean {
  const text = p.sig.rawOriginalText.toLowerCase().replace(/ё/g, 'е');
  return /каркас|закладн|изделие\s+по\s+черт|по\s+чертеж/.test(text) && PROJECT_SPECIFIC_RE.test(text);
}

/** a'nın sayıları b'nin içinde (tekrar sayısı dahil) var mı? */
function isNumberMultisetSubset(a: number[], b: number[]): boolean {
  let j = 0;
  for (const n of a) {
    while (j < b.length && b[j] < n) j++;
    if (j >= b.length || b[j] !== n) return false;
    j++;
  }
  return true;
}

/**
 * İki fatura satırı aynı malzeme mi? Ortak tek karar noktası.
 * 1. Orijinal metin birebir aynı (aynı kelime kökleri ve aynı sayılar) → aynı malzeme (exact).
 * 2. Yazımı farklı ama ürün kimliği aynı: aynı ürün adı, aynı marka/model kodu/sınıf/varyant ve
 *    kısa yazımdaki tüm ölçüler uzun yazımda da var (örn. "Труба профильная 40х40х2" ⟷ "Труба профильная 40х40х2 дл.6000").
 * Her iki durumda da teknik standart (GOST/TU), kalite sınıfı, nem/işlem, marka ve model farkı kıyası engeller.
 */
export function compareMaterialProfiles(a: MaterialMatchProfile, b: MaterialMatchProfile): SameMaterialVerdict {
  // Projeye özel imalat (çizim işaretli kafes: Кр-1, КП-2) her projede başka çap/boy/ağırlıktır; kıyaslanmaz
  // (auditRiskEngine.isExemptFromBenchmarkAudit ile aynı kural)
  if (isProjectSpecificItem(a) || isProjectSpecificItem(b)) {
    return { same: false, exact: false, reason: 'projeye özel imalat kalemi (çizim işaretli) kıyaslanmaz' };
  }
  const tech = areTechnicalVariantsCompatible(a.sig.techVariant, b.sig.techVariant);
  if (!tech.compatible) return { same: false, exact: false, reason: tech.conflictReason };

  if (a.sig.brand && b.sig.brand && a.sig.brand !== b.sig.brand) {
    return { same: false, exact: false, reason: `marka farkı: ${a.sig.brand} ⟷ ${b.sig.brand}` };
  }
  if (a.sig.gostKey && b.sig.gostKey && a.sig.gostKey !== b.sig.gostKey) {
    return { same: false, exact: false, reason: `standart farkı: ${a.sig.gostKey} ⟷ ${b.sig.gostKey}` };
  }

  const ta = a.sig.techVariant;
  const tb = b.sig.techVariant;
  if (ta.isTimber || tb.isTimber) {
    // Kerestede sınıf bilgisi bir tarafta var, diğerinde yoksa özellikler aynı değildir
    if ((ta.qualityGrade || null) !== (tb.qualityGrade || null)) {
      return { same: false, exact: false, reason: `kalite sınıfı farkı: ${ta.qualityGrade || 'belirtilmemiş'} ⟷ ${tb.qualityGrade || 'belirtilmemiş'}` };
    }
    const kindA = timberProductKind(a.sig.rawOriginalText);
    const kindB = timberProductKind(b.sig.rawOriginalText);
    if (kindA && kindB && kindA !== kindB) {
      return { same: false, exact: false, reason: `ürün tipi farkı: ${kindA} ⟷ ${kindB}` };
    }
  }

  const identityVerdict = compareProductIdentities(a.identity, b.identity);
  if (!identityVerdict.same) return { same: false, exact: false, reason: identityVerdict.reason };

  if (a.sig.exactKey === b.sig.exactKey) return { same: true, exact: true };

  // Donatı çubuğu: çap ve sınıf kimlikte kesin kontrol edildi (Ø12 A500С ⟷ Ø12 A500С);
  // tedarikçi yazımı ("Сталь … для армирования d 12" ⟷ "Арматура Ø12") ve boy yazımı (11,7 м ⟷ 11700) fark yaratmaz
  const rebarA = rebarBarKey(a);
  const rebarB = rebarBarKey(b);
  if (rebarA || rebarB) {
    if (rebarA && rebarB && rebarA === rebarB) return { same: true, exact: false };
    return { same: false, exact: false, reason: 'donatı çapı/sınıfı aynı değil' };
  }

  // Yazım farkı: tanımdaki kelimeler aynı olmalı (kısaltma toleransı: "хим" ⟷ "химический");
  // bir tarafta fazladan nitelik varsa (малярный ⟷ прозрачный, стандартная, DECK 350) aynı malzeme sayılmaz
  if (!areStemSetsEquivalent(a.sig.stems, b.sig.stems)) {
    return { same: false, exact: false, reason: 'tanım/nitelik farkı' };
  }

  const [shorter, longer] = a.sig.numbers.length <= b.sig.numbers.length
    ? [a.sig.numbers, b.sig.numbers]
    : [b.sig.numbers, a.sig.numbers];
  if (shorter.length === 0 || !isNumberMultisetSubset(shorter, longer)) {
    return { same: false, exact: false, reason: `ölçü/özellik farkı: ${a.sig.numericSig || '-'} ⟷ ${b.sig.numericSig || '-'}` };
  }
  // Uzun yazımdaki fazla bilgi yalnızca tek bir boy (mm) ya da artikel numarası olabilir (≥1000: "дл.6000", "9640072945").
  // Kısa bir sayı fazlası (Болт М16 ⟷ Болт 16х140, пленка … 5 кг) özelliğin belirtilmediği anlamına gelir: kıyaslanmaz.
  if (longer.length - shorter.length > 1) {
    return { same: false, exact: false, reason: `ölçü/özellik farkı: ${a.sig.numericSig || '-'} ⟷ ${b.sig.numericSig || '-'}` };
  }
  if (longer.length > shorter.length) {
    const extra = [...longer];
    for (const n of shorter) extra.splice(extra.indexOf(n), 1);
    if (!extra.every(n => n >= 1000)) {
      return { same: false, exact: false, reason: `ölçü/özellik farkı: ${a.sig.numericSig || '-'} ⟷ ${b.sig.numericSig || '-'}` };
    }
  }
  return { same: true, exact: false };
}

export function isSameMaterialLine(
  a: { originalName?: string; materialName?: string; brand?: string; category?: string },
  b: { originalName?: string; materialName?: string; brand?: string; category?: string }
): SameMaterialVerdict {
  const pa = buildMaterialMatchProfile(a);
  const pb = buildMaterialMatchProfile(b);
  if (!pa || !pb) return { same: false, exact: false, reason: 'malzeme tanımı okunamadı' };
  return compareMaterialProfiles(pa, pb);
}

// ---------------------------------------------------------------------------
// Fiyat: yalnızca gerçek kayıtlı fiyat
// ---------------------------------------------------------------------------

/** Aynı malzemenin iki gerçek fiyatı arasında bundan büyük oran birim/okuma hatası ya da farklı üründür. */
export const MAX_SAME_MATERIAL_PRICE_RATIO = 3;

export function isPlausibleSameMaterialPriceRatio(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.max(a, b) / Math.min(a, b) <= MAX_SAME_MATERIAL_PRICE_RATIO;
}

const METRIC_SCALE: Record<string, { dim: string; factor: number }> = {
  ton: { dim: 'mass', factor: 1000 },
  kg: { dim: 'mass', factor: 1 },
  g: { dim: 'mass', factor: 0.001 },
  l: { dim: 'volume', factor: 1 },
  ml: { dim: 'volume', factor: 0.001 }
};

function canonicalUnit(unit?: string): string {
  const u = normalizeUnit(unit || 'adet');
  if (u === 'г' || u === 'гр' || u === 'gr') return 'g';
  if (u === 'мл' || u === 'ml') return 'ml';
  // Levha/plaka satırı tek parçadır (лист ГКЛ = 1 adet); rulo, paket, torba ayrı birimdir
  if (['лист', 'лист.', 'plaka', 'levha', 'шт.', 'ед', 'ед.'].includes(u)) return 'adet';
  if (['mt', 'mtr', 'пм', 'п.м', 'п.м.', 'м.пог'].includes(u)) return 'm';
  return u;
}

export function areUnitsIdentical(fromUnit?: string, toUnit?: string): boolean {
  return canonicalUnit(fromUnit) === canonicalUnit(toUnit);
}

/**
 * Bir birim fiyatı hedef birime çevirir; yalnızca birimler aynıysa veya kesin metrik ölçek varsa.
 * Tahmin gerektiren dönüşümde (adet → m³, m³ → ton, rulo → m²…) null döner: o kayıt kıyaslanmaz.
 */
export function convertUnitPriceStrict(unitPrice: number, fromUnit?: string, toUnit?: string): number | null {
  if (!(unitPrice > 0)) return null;
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);
  if (from === to) return unitPrice;
  const a = METRIC_SCALE[from];
  const b = METRIC_SCALE[to];
  if (!a || !b || a.dim !== b.dim) return null;
  // fiyat / from-birimi → fiyat / to-birimi
  return Number((unitPrice * (b.factor / a.factor)).toFixed(4));
}

const ESTIMATED_CONVERSION_RE = /≈|yoğunluk|yogunluk|tahmin|ortalama|yaklaşık|yaklasik|varsayılan|varsayilan|paket bazlı|paket bazli/i;

/**
 * Sunucu kıyas satırının fiyatı gerçek kayıtlı fiyattan mı geliyor?
 * - Dönüşüm yoksa birimler aynı olmalı (aksi halde başka birimin fiyatı karışmıştır).
 * - Dönüşüm varsa yalnızca ürün tanımında yazan ölçüden (25 кг torba, 2,5×1,2 m plaka, 33 adet/m³) ya da
 *   metrik ölçekten gelen dönüşüm kabul edilir; yoğunluk/ortalama gibi tahmine dayalı dönüşüm kabul edilmez.
 */
export function isExactUnitConversion(row: { conversionApplied?: boolean; conversionFormula?: string; unit?: string; originalUnit?: string }): boolean {
  const formula = String(row.conversionFormula || '');
  if (!row.conversionApplied) {
    if (!row.originalUnit || !row.unit) return true;
    return convertUnitPriceStrict(1, row.originalUnit, row.unit) !== null;
  }
  return !ESTIMATED_CONVERSION_RE.test(formula);
}

// ---------------------------------------------------------------------------
// Kayıt güvenilirliği, tarih ve aynı alımın kopyası
// ---------------------------------------------------------------------------

export function parsePurchaseDate(value?: string): number | null {
  if (!value) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const ru = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (ru) return Date.UTC(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));
  return null;
}

/** Geçmiş alım, kıyaslanan kayıttan sonra mı yapılmış? (Sonraki alım "daha önce alınmış" sayılmaz.) */
export function isPurchaseAfter(historyDate?: string, currentDate?: string): boolean {
  const h = parsePurchaseDate(historyDate);
  const c = parsePurchaseDate(currentDate);
  if (h === null || c === null) return false;
  return h > c;
}

export function cleanDocumentNumber(v?: string): string {
  return String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function vendorKeyForMatching(name?: string): string {
  return getCoreVendorKey(String(name || '').replace(/\s*\(Prizma ERP\)\s*$/i, ''));
}

/**
 * Aynı alımın başka bir kopyası mı? (GES Arşivi + Prizma ERP, indirim kaydı + senkron fatura)
 * Aynı tedarikçi, aynı gün ve aynı miktar → aynı fatura satırıdır, fiyat referansı olamaz.
 */
export function isSamePurchaseCopy(
  a: { supplier?: string; date?: string; quantity?: number },
  b: { supplier?: string; date?: string; quantity?: number }
): boolean {
  const va = vendorKeyForMatching(a.supplier);
  const vb = vendorKeyForMatching(b.supplier);
  if (!va || !vb || va !== vb) return false;
  const da = parsePurchaseDate(a.date);
  const db = parsePurchaseDate(b.date);
  if (da === null || db === null || da !== db) return false;
  const qa = Number(a.quantity) || 0;
  const qb = Number(b.quantity) || 0;
  return qa > 0 && qb > 0 && Math.abs(qa - qb) <= Math.max(0.001, qa * 0.001);
}

/** Toplamlar birbirini tutuyor mu (±%1,5, en az 2 ₽)? */
export function amountsReconcile(sum: number, total: number): boolean {
  if (!(sum > 0) || !(total > 0)) return false;
  return Math.abs(sum - total) <= Math.max(2, total * 0.015);
}

/**
 * Satırları "aynı malzeme" kümelerine ayırır (Anomali paneli). Her satır, kümedeki TÜM satırlarla
 * aynı malzeme olduğu ilk kümeye girer; tanımı okunamayan satır hiçbir kümeye katılmaz.
 */
export function clusterSameMaterialRows<T extends { originalName?: string; materialName?: string }>(
  rows: T[],
  materialName: string,
  category?: string
): T[][] {
  const clusters: Array<{ profiles: MaterialMatchProfile[]; rows: T[] }> = [];
  for (const row of rows) {
    const profile = buildMaterialMatchProfile({
      originalName: row.originalName || row.materialName,
      materialName: row.materialName || materialName,
      category
    });
    if (!profile) continue;
    const target = clusters.find(c => c.profiles.every(p => compareMaterialProfiles(p, profile).same));
    if (target) {
      target.rows.push(row);
      target.profiles.push(profile);
    } else {
      clusters.push({ profiles: [profile], rows: [row] });
    }
  }
  return clusters.map(c => c.rows);
}
