import { extractOriginalBrandAndSeries } from './materialGroupIntegrity';
import { analyzeMaterialSegment } from './materialSegmentIntelligence';

/**
 * Anomali / fiyat artışı paneli için "gerçekten aynı ürün mü?" kapısı.
 *
 * Katalog (catalogKey) iki fatura satırını aynı malzeme grubuna koyar; bu modül
 * o grubun içinde orijinal fatura metnine bakarak farklı marka, farklı model kodu
 * veya farklı varyant (nem dayanımlı, acil durum, ağaç türü…) olan satırları ayırır.
 * Böylece "Knauf'a karşı Volma" gibi marka farkları fiyat artışı diye gösterilmez.
 */

export interface ProductIdentity {
  text: string;
  /** Sözlükten tanınan marka (KNAUF, VOLMA, TECHNONICOL…) */
  dictionaryBrand?: string;
  /** Sözlük dışı, metinden yakalanan marka/model kelimesi */
  dynamicBrand?: string;
  modelCodes: Set<string>;
  /** Sınıf/marka değerleri: D500, M10, B5, A500 → { d: ['500'], … } */
  grades: Map<string, Set<string>>;
  /** Donatı çapı (mm) */
  rebarDiameter?: string;
  variants: Set<string>;
  isCommodity: boolean;
}

export interface SameProductVerdict {
  same: boolean;
  reason?: string;
}

// Bir tarafta olup diğerinde olmayan bu işaretler ürünü değiştirir
const VARIANT_MARKERS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'nem dayanımlı', pattern: /влагостойк|гклв|gklv|nem\s*dayan/i },
  { key: 'yangın dayanımlı', pattern: /огнестойк|гкло|gklo|yang[ıi]n\s*dayan/i },
  { key: 'acil durum', pattern: /emergency|аварийн|\(вар\)/i },
  { key: 'astar', pattern: /грунтовк|грунт-эмал/i },
  { key: 'galvaniz', pattern: /оцинк|(?:^|[^а-я])цинк|zinc|galvaniz/i },
  { key: 'paslanmaz', pattern: /нержав|paslanmaz|\baisi\b/i },
  { key: 'çift cidarlı', pattern: /двустенн|çift\s*cidar/i },
  { key: 'kavak', pattern: /осина|осинов/i },
  { key: 'huş', pattern: /берез/i },
  { key: 'karaçam', pattern: /лиственниц/i }
];

// Tek harf + sayı (D600, M10, B5, W8, F150, A500) ve standart/özellik kısaltmaları model kodu değildir
const SPEC_TOKEN_RE = /^(?:[a-zа-я]\d+(?:[.,]\d+)?[a-zа-я]?|ip\d+|ral\d+|sn\d+|cri\d*|гост\d*|din\d*|ту\d*|сорт\d*|\d+в\d+)$/i;
const UNIT_SUFFIX_RE = /^\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?(?:мм|mm|см|cm|м|m|кг|kg|л|l|мл|ml|в|v|а|a|вт|w|квт|kw|мкр|мкм|шт|м2|м3|т|кв|кн|мпа|ч)$/i;

function normalize(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/([a-zа-я0-9])\s+-\s*(?=[a-zа-я0-9])/gi, '$1-')
    // Ölçüleri (2500х1200х12,5 / 625*200*250) model kodu sanmamak için çıkar
    .replace(/\d+(?:[.,]\d+)?(?:\s*[хx*×]\s*\d+(?:[.,]\d+)?)+(?:\s*(?:мм|mm|м|m))?/gi, ' ');
}

function tokenize(text: string): string[] {
  return normalize(text).split(/[\s,;()«»"'\/_|]+/).map(t => t.replace(/^[.\-]+|[.\-]+$/g, ''));
}

const GRADE_LETTERS: Record<string, string> = { a: 'a', а: 'a', b: 'b', в: 'b', d: 'd', д: 'd', f: 'f', m: 'm', м: 'm', w: 'w' };

function extractGrades(text: string): Map<string, Set<string>> {
  const grades = new Map<string, Set<string>>();
  // "А 500С" → "а500с"
  const joined = String(text || '').toLowerCase().replace(/(^|[^a-zа-я])([aаbвdдmмw])\s+(\d{2,3})(?=[^\d]|$)/gi, '$1$2$3');
  for (const token of tokenize(joined)) {
    const m = token.match(/^([abdfmwадмв])(\d+(?:[.,]\d+)?)[a-zа-я]?$/i);
    if (!m || /^[mм][23]$/i.test(token)) continue;
    const letter = GRADE_LETTERS[m[1].toLowerCase()];
    if (!letter) continue;
    if (!grades.has(letter)) grades.set(letter, new Set());
    grades.get(letter)!.add(String(Number(m[2].replace(',', '.'))));
  }
  return grades;
}

function extractRebarDiameter(text: string): string | undefined {
  const lower = String(text || '').toLowerCase();
  if (!/арматур|пруток|катанка|армирован|donat|demir/.test(lower)) return undefined;
  const m = lower.match(/(?:мд|q|d|ф|ø|⌀|д)\s*(\d{1,2})(?!\d)/) || lower.match(/(?:^|[^\d.,])(\d{1,2})\s*мм/);
  return m ? m[1] : undefined;
}

function extractModelCodes(text: string): Set<string> {
  const codes = new Set<string>();
  const tokens = tokenize(text);
  for (const token of tokens) {
    if (token.length < 3) continue;
    const hasDigit = /\d/.test(token);
    if (!hasDigit) continue;
    if (UNIT_SUFFIX_RE.test(token) || SPEC_TOKEN_RE.test(token)) continue;
    const hasLetter = /[a-zа-я]/i.test(token);
    // Harf+rakam karışık kod (SP-610G, RV-10.15.50, R-143) veya noktalı parça no (4105.062)
    const isDottedPartNo = /^\d{3,}\.\d{2,}(?:\.\d+)*$/.test(token);
    if (!hasLetter && !isDottedPartNo) continue;
    // Prizma stok kodu (150.01.013.03.0116) ürün kimliği değil kategori kodudur
    if (/^\d{3}\.\d{2}\.\d{2,3}\./.test(token)) continue;
    codes.add(token.replace(/[‐-―]/g, '-'));
  }
  return codes;
}

export function getProductIdentity(originalName: string, materialName = '', category = ''): ProductIdentity {
  const text = String(originalName || materialName || '');
  const brandInfo = extractOriginalBrandAndSeries(text);
  const brandKey = brandInfo.brandKey;
  const isDynamic = Boolean(brandKey && brandKey.startsWith('DYN_'));
  const variants = new Set<string>();
  for (const marker of VARIANT_MARKERS) {
    if (marker.pattern.test(text)) variants.add(marker.key);
  }
  const segment = analyzeMaterialSegment(materialName, originalName, category);
  return {
    text,
    dictionaryBrand: brandKey && !isDynamic ? brandKey : undefined,
    dynamicBrand: isDynamic ? brandKey : undefined,
    modelCodes: extractModelCodes(text),
    grades: extractGrades(text),
    rebarDiameter: extractRebarDiameter(text),
    variants,
    isCommodity: brandInfo.isCommodity || segment.comparisonMode === 'COMMODITY_STANDARD'
  };
}

// Aynı kodun farklı yazımları: "КТПТО-80-У1" ⟷ "КТПТО-80-11", "5ТПИнг-70" ⟷ "5ТПИнг 70"
function codeForms(code: string): string[] {
  const forms = [code.replace(/[^a-zа-я0-9]/gi, '')];
  const segments = code.split('-');
  if (segments.length >= 3) {
    const stem = `${segments[0]}-${segments[1]}`;
    if (/\d/.test(stem)) forms.push(stem);
  }
  return forms;
}

function shareAny(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  for (const ca of a) {
    const formsA = codeForms(ca);
    for (const cb of b) {
      const formsB = codeForms(cb);
      if (formsA.slice(1).some(f => formsB.slice(1).includes(f))) return true;
      const [x, y] = [formsA[0], formsB[0]].sort((p, q) => p.length - q.length);
      if (x.length >= 5 && y.startsWith(x)) return true;
    }
  }
  return false;
}

export function compareProductIdentities(a: ProductIdentity, b: ProductIdentity): SameProductVerdict {
  // 1. Varyant farkı (nem dayanımlı / normal, acil durum / normal, kavak / çam…)
  for (const v of a.variants) if (!b.variants.has(v)) return { same: false, reason: `varyant farkı: ${v}` };
  for (const v of b.variants) if (!a.variants.has(v)) return { same: false, reason: `varyant farkı: ${v}` };

  // 2. Aynı sınıf harfinde farklı değer (D500 ⟷ D600, A500 ⟷ A240, M8 ⟷ M10)
  for (const [letter, valuesA] of a.grades) {
    const valuesB = b.grades.get(letter);
    if (valuesB && !shareAny(valuesA, valuesB)) {
      return { same: false, reason: `sınıf farkı: ${letter.toUpperCase()}${[...valuesA][0]} ⟷ ${letter.toUpperCase()}${[...valuesB][0]}` };
    }
  }
  // 3. Donatı çapı farkı (Ø20 ⟷ Ø36)
  if (a.rebarDiameter && b.rebarDiameter && a.rebarDiameter !== b.rebarDiameter) {
    return { same: false, reason: `çap farkı: Ø${a.rebarDiameter} ⟷ Ø${b.rebarDiameter}` };
  }

  const sharesCode = shareAny(a.modelCodes, b.modelCodes);

  // 4. İki tarafta da tanınan marka var ve farklı (Knauf ⟷ Volma, ТехноНИКОЛЬ ⟷ Икопал)
  if (a.dictionaryBrand && b.dictionaryBrand && a.dictionaryBrand !== b.dictionaryBrand) {
    return { same: false, reason: `marka farkı: ${a.dictionaryBrand} ⟷ ${b.dictionaryBrand}` };
  }
  // 5. Bir tarafta tanınan marka var, diğerinde yok: ortak model kodu yoksa aynı ürün sayılmaz
  if (Boolean(a.dictionaryBrand) !== Boolean(b.dictionaryBrand) && !sharesCode) {
    return { same: false, reason: `markalı ⟷ markasız: ${a.dictionaryBrand || b.dictionaryBrand}` };
  }

  // GOST/DIN emtiada (demir, kereste, agrega) üretici kodu kıyası yapılmaz
  if (a.isCommodity && b.isCommodity) return { same: true };

  // 6. Sözlük dışı marka iki tarafta da var ve farklı
  if (!a.dictionaryBrand && !b.dictionaryBrand && a.dynamicBrand && b.dynamicBrand && a.dynamicBrand !== b.dynamicBrand && !sharesCode) {
    return { same: false, reason: `marka farkı: ${a.dynamicBrand.slice(4)} ⟷ ${b.dynamicBrand.slice(4)}` };
  }
  // 7. İki tarafta da model kodu var ama hiçbiri ortak değil (SP-100 ⟷ SP-610G)
  if (a.modelCodes.size > 0 && b.modelCodes.size > 0 && !sharesCode) {
    return { same: false, reason: `model farkı: ${[...a.modelCodes][0]} ⟷ ${[...b.modelCodes][0]}` };
  }
  return { same: true };
}

export function isSameProductForPriceAlert(
  a: { originalName?: string },
  b: { originalName?: string },
  materialName: string,
  category?: string
): SameProductVerdict {
  // Orijinal metin yoksa elimizdeki tek kimlik katalog grubudur
  if (!a?.originalName || !b?.originalName) return { same: true };
  return compareProductIdentities(
    getProductIdentity(a.originalName, materialName, category),
    getProductIdentity(b.originalName, materialName, category)
  );
}

/**
 * Bir katalog grubunun satırlarını "aynı ürün" kümelerine ayırır.
 * Her satır, temsilcisiyle (kümenin ilk satırı) aynı ürün olan ilk kümeye girer.
 */
export function clusterSameProductRows<T extends { originalName?: string }>(
  rows: T[],
  materialName: string,
  category?: string
): T[][] {
  const clusters: Array<{ rep: ProductIdentity | null; rows: T[] }> = [];
  for (const row of rows) {
    const identity = row.originalName ? getProductIdentity(row.originalName, materialName, category) : null;
    const target = clusters.find(c => !identity || !c.rep || compareProductIdentities(c.rep, identity).same);
    if (target) {
      target.rows.push(row);
      if (!target.rep && identity) target.rep = identity;
    } else {
      clusters.push({ rep: identity, rows: [row] });
    }
  }
  return clusters.map(c => c.rows);
}
