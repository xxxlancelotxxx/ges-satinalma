/**
 * Akıllı Tedarikçi Normalizasyon ve Birleştirme Motoru
 * (Smart Vendor Normalizer & Entity Resolution Engine)
 * 
 * Bu modül:
 * 1. Yazım hatalarını, eksik/fazla tırnak işaretlerini ("... vs "..." vs «...»), 
 *    Rusça/Türkçe tüzel kişilik biçimlerini (ООО vs Общество с ограниченной ответственностью vs OOO)
 *    akıllıca tespit edip birleştirir.
 * 2. "ООО \"УВМ-СТАЛЬ" ile "ООО \"УВМ-СТАЛЬ\"" gibi tekrarları tek ve standart bir kanonik ada dönüştürür.
 * 3. Arama ve filtreleme için benzersiz normalizasyon anahtarı (vendorKey) üretir.
 */

// Latin lookalike to Cyrillic normalization for legal entities
function fixScriptLookalikes(s: string): string {
  if (!s) return '';
  return s
    .replace(/^OOO(?=[\s"«»]|$)/i, 'ООО')
    .replace(/^AO(?=[\s"«»]|$)/i, 'АО')
    .replace(/^3AO(?=[\s"«»]|$)/i, 'ЗАО')
    .replace(/(?:[\s"«»]|^)OOO$/i, ' ООО')
    .replace(/(?:[\s"«»]|^)AO$/i, ' АО');
}

/**
 * İki tedarikçi adının aynı şirketi temsil edip etmediğini belirleyen benzersiz karşılaştırma anahtarı.
 * Örn:
 * "ООО \"УВМ-СТАЛЬ" -> "ооо увм сталь"
 * "ООО \"УВМ-СТАЛЬ\"" -> "ооо увм сталь"
 * "Общество с ограниченной ответственностью \"Системные Решения\"" -> "ооо системные решения"
 */
export function getVendorKey(name?: string): string {
  if (!name) return '';
  let s = String(name).trim().toLowerCase();
  
  // Script lookalikes
  s = s.replace(/(^|[\s"«»])ooo(?=[\s"«»]|$)/gi, '$1ооо')
       .replace(/(^|[\s"«»])ao(?=[\s"«»]|$)/gi, '$1ао');

  // Legal entity expansions to uniform canonical tokens
  s = s.replace(/общество с ограниченной ответственностью/gi, 'ооо');
  s = s.replace(/акционерное общество/gi, 'ао');
  s = s.replace(/закрытое акционерное общество/gi, 'зао');
  s = s.replace(/публичное акционерное общество/gi, 'пао');
  s = s.replace(/индивидуальный предприниматель/gi, 'ип');
  
  // Turkish legal forms
  s = s.replace(/limited şirketi|ltd\.?\s*şti\.?/gi, 'ltd');
  s = s.replace(/anonim şirketi|a\.?\s*ş\.?|a\.?\s*s\.?/gi, 'as');

  // Strip all quotation marks (straight, curly, guillemets, single quotes)
  s = s.replace(/[«»"'“”„`´\x27]/g, ' ');

  // Strip punctuation
  s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_~()]/g, ' ');

  // Turkish char folding for resilient key comparisons
  s = s.replace(/ı/g, 'i')
       .replace(/ğ/g, 'g')
       .replace(/ü/g, 'u')
       .replace(/ş/g, 's')
       .replace(/ö/g, 'o')
       .replace(/ç/g, 'c');

  // Collapse whitespace
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * İki tedarikçi adının aynı firma olup olmadığını kontrol eder.
 */
export function areVendorsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const keyA = getVendorKey(a);
  const keyB = getVendorKey(b);
  return keyA.length > 0 && keyA === keyB;
}

/**
 * Ham tedarikçi adını temiz, standart ve profesyonel kanonik ada dönüştürür.
 * Örn:
 * - "ООО \"УВМ-СТАЛЬ" -> "ООО \"УВМ-СТАЛЬ\""
 * - "Общество с ограниченной ответственностью \"Системные Решения\"" -> "ООО \"Системные Решения\""
 * - "АО «ПРОМСТРОЙКОНТРАКТ" -> "АО \"ПРОМСТРОЙКОНТРАКТ\""
 */
export function normalizeVendorName(name?: string): string {
  if (!name) return '';
  let clean = String(name).trim();
  if (!clean) return '';

  // 1. Fix Latin OOO / AO at start or end
  clean = fixScriptLookalikes(clean);

  // 2. Normalize full-form Russian legal entities to standard clean acronyms
  clean = clean.replace(/^(общество с ограниченной ответственностью|ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ)\s*/i, 'ООО ');
  clean = clean.replace(/^(акционерное общество|АКЦИОНЕРНОЕ ОБЩЕСТВО)\s*/i, 'АО ');
  clean = clean.replace(/^(закрытое акционерное общество|ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО)\s*/i, 'ЗАО ');
  clean = clean.replace(/^(публичное акционерное общество|ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО)\s*/i, 'ПАО ');
  clean = clean.replace(/^(индивидуальный предприниматель|ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ)\s*/i, 'ИП ');

  // 3. Detect prefix legal entity (ООО, АО, ЗАО, ПАО, ИП)
  const prefixRegex = /^(ООО|АО|ЗАО|ПАО|ИП)(?:[\s"«»]+|$)(.*)$/i;
  const prefixMatch = clean.match(prefixRegex);

  if (prefixMatch) {
    const prefix = prefixMatch[1].toUpperCase();
    let core = prefixMatch[2].trim();

    // Strip any quotes anywhere from core name to reconstruct a pristine single pair of quotes
    core = core.replace(/[«»"'“”„`´\x27]/g, '').trim();
    // Strip trailing dots or dashes from core
    core = core.replace(/[\s\.\-]+$/, '').trim();
    // Collapse multiple internal spaces
    core = core.replace(/\s+/g, ' ');

    if (core) {
      return `${prefix} "${core}"`;
    }
    return prefix;
  }

  // 4. Detect suffix legal entity (e.g. "УВМ-СТАЛЬ" ООО)
  const suffixRegex = /^(.*?)(?:[\s"«»]+)(ООО|АО|ЗАО|ПАО|ИП)$/i;
  const suffixMatch = clean.match(suffixRegex);
  if (suffixMatch) {
    const suffix = suffixMatch[2].toUpperCase();
    let core = suffixMatch[1].trim();
    core = core.replace(/[«»"'“”„`´\x27]/g, '').trim();
    core = core.replace(/[\s\.\-]+$/, '').trim();
    core = core.replace(/\s+/g, ' ');
    if (core) {
      return `${suffix} "${core}"`;
    }
    return suffix;
  }

  // 5. If no standard Russian prefix/suffix, clean up dangling quotation marks
  // Count quotes: if odd number, close it
  const quoteCount = (clean.match(/"/g) || []).length;
  if (quoteCount === 1) {
    if (clean.includes('"') && !clean.endsWith('"')) {
      clean = clean + '"';
    } else if (clean.startsWith('"')) {
      clean = clean.slice(1);
    }
  }

  // Clean mismatched guillemets
  if (clean.includes('«') && !clean.includes('»')) {
    clean = clean.replace('«', '"') + '"';
  } else if (clean.includes('«') && clean.includes('»')) {
    clean = clean.replace(/«/g, '"').replace(/»/g, '"');
  }

  return clean.replace(/\s+/g, ' ').trim();
}

export interface CanonicalVendorItem {
  key: string;
  name: string;
  count: number;
  originalVariants: string[];
}

/**
 * Verilen kayıt listesindeki tüm tedarikçileri birleştirir,
 * tekrarları eler ve adetleriyle birlikte sıralı liste döndürür.
 */
export function extractCanonicalVendors(
  records: Array<{ vendorName?: string; supplier?: string }>
): CanonicalVendorItem[] {
  const map = new Map<string, { name: string; count: number; variants: Set<string> }>();

  records.forEach(r => {
    const raw = r.vendorName || r.supplier;
    if (!raw || !String(raw).trim()) return;
    const cleanRaw = String(raw).trim();
    const key = getVendorKey(cleanRaw);
    if (!key) return;

    const norm = normalizeVendorName(cleanRaw);

    if (!map.has(key)) {
      map.set(key, {
        name: norm,
        count: 1,
        variants: new Set([cleanRaw])
      });
    } else {
      const entry = map.get(key)!;
      entry.count += 1;
      entry.variants.add(cleanRaw);
      // Prefer properly quoted name
      if (norm.includes('"') && !entry.name.includes('"')) {
        entry.name = norm;
      }
    }
  });

  const list: CanonicalVendorItem[] = Array.from(map.entries()).map(([key, val]) => ({
    key,
    name: val.name,
    count: val.count,
    originalVariants: Array.from(val.variants)
  }));

  // Alphabetical sort by clean name
  list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return list;
}
