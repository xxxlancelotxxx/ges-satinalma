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
    .replace(/^[OО]{3}(?=[\s"«»]|$)/i, 'ООО')
    .replace(/^[AА][OО](?=[\s"«»]|$)/i, 'АО')
    .replace(/^3[AА][OО](?=[\s"«»]|$)/i, 'ЗАО')
    .replace(/(?:[\s"«»]|^)[OО]{3}$/i, ' ООО')
    .replace(/(?:[\s"«»]|^)[AА][OО]$/i, ' АО');
}

// Buyer (Own Company) identifiers that must never be treated as Supplier
const BUYER_INNS = new Set(['9714014365', '771401001']);

export function isBuyerOrganization(raw?: string): boolean {
  if (!raw) return false;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    s.includes('9714014365') ||
    /гэс\s*констракшн/i.test(s) ||
    /ges\s*construction/i.test(s) ||
    /гэс\s*строй/i.test(s) ||
    /^(?:покупатель|поставщик|плательщик|грузополучатель|грузоотправитель|заказчик|продавец|получатель|исполнитель|tedarikçi|tedarikçi\s*firma|alıcı)[:.\s]*$/i.test(s)
  );
}

/**
 * Checks whether an extracted line item is actually invoice header/address/tax-ID/bank metadata
 * or a corrupted comma-split fragment rather than a real material/product row.
 */
export function isInvoiceHeaderOrAddressGarbage(
  itemText?: string,
  quantity?: number,
  unitPrice?: number,
  totalPrice?: number
): boolean {
  const txt = String(itemText || '').trim();
  if (!txt) return true;

  // 1. Explicit header / legal entity / bank / signatory labels
  if (
    /(?:^|[\s,;:(])(?:Поставщик|Грузоотправитель|Покупатель|Грузополучатель|Плательщик|Заказчик|Банк\s+получателя|Получатель\s+платежа|Счет\s+на\s+оплату|Счёт\s+на\s+оплату|Руководитель|Бухгалтер|Главный\s+бухгалтер|Уполномоченный|Основание\s*:|Всего\s+наименований|Внимание\s*!)(?:[\s,:;)]|$)/i.test(txt)
  ) {
    return true;
  }

  // 2. Tax IDs / Bank account numbers inside item name
  if (/(?:^|[\s,;:()])(?:ИНН|КПП|БИК|ОГРН|ОКПО|Сч\.\s*№|Р\/сч|К\/сч|р\/с|к\/с)[\s:№]*\d{6,}/i.test(txt)) {
    return true;
  }

  // 3. Pure street/city address fragments turned into items by comma splitting
  if (
    /^(?:Гостиничный\s+проезд|Ленинградский\s+пр-кт|пр-кт\s+Ленинградский|дом\s*№?\s*\d|корпус\s*\d|офис\s*\d|г\.?\s*Москва|Город\s+Москва|Москва\s+г|Московская\s+обл|ул\.\s+[А-Яа-яЁё]+,?\s*д\.)/i.test(txt)
  ) {
    return true;
  }

  // 4. Corrupted comma-split price tail turned into item name (e.g. "3 Rulo 5 274", "1 Adet 9 672", "Строительно-монтажный материал / ТМЦ (3 Rulo 5 274)")
  if (
    /Строительно-монтажный\s+материал\s*\/\s*ТМЦ\s*\(\s*\d+\s+(?:Adet|Rulo|Set|Paket|m|m²|m³|kg|Ton|Litre|Torba|Çift)/i.test(txt) ||
    /^\d+\s+(?:Adet|Rulo|Set|Paket|m|m²|m³|kg|Ton|Litre|Torba|Çift|рул\.?|шт\.?|упак\.?|компл\.?|м3|м2|п\.?\s*м\.?)\s+\d+(?:[\s\u00A0]\d{3})*$/i.test(txt)
  ) {
    return true;
  }

  // 5. Tax ID / KPP / INN parsed as quantity (e.g. qty = 771501001 or 9714014365, or qty >= 500000 with unitPrice === 0)
  const q = Number(quantity) || 0;
  const u = Number(unitPrice) || 0;
  const t = Number(totalPrice) || 0;
  if (q >= 10000000) return true;
  if (q >= 100000 && (u === 0 || t === 0)) return true;
  if (q >= 500000 && u < 50) return true;

  return false;
}

/**
 * Extracts a 10 or 12 digit Russian INN from raw text if present (ignoring buyer INN).
 */
export function extractVendorInn(raw?: string): string {
  if (!raw) return '';
  const m = String(raw).match(/ИНН(?:\/КПП)?[\s:№]*(\d{10}|\d{12})\b/i);
  if (m && m[1] && !BUYER_INNS.has(m[1])) {
    return m[1];
  }
  return '';
}

/**
 * Checks whether an extracted or stored invoice number is a genuine, specific document number.
 * Rejects Russian header words ("действителен", "-оферта", "-договор", "должен", "подлежит", "б/н"),
 * system placeholders (FT-, TKF-, ARCH-, BLG-), and 20-digit Russian bank account numbers (30101..., 40702...).
 */
export function isValidInvoiceNumber(rawNum?: string): boolean {
  if (!rawNum) return false;
  const s = String(rawNum).trim();
  if (!s || s.length < 1 || s.length > 40) return false;

  const upper = s.toUpperCase();
  if (
    upper.startsWith('FT-') ||
    upper.startsWith('TKF-') ||
    upper.startsWith('ARCH-') ||
    upper.startsWith('BLG-')
  ) {
    return false;
  }

  // Must contain at least one digit to be a specific invoice number
  if (!/\d/.test(s)) return false;

  // Reject 20-digit Russian bank accounts (Р/с 40702..., К/с 30101...) and 9-digit BIK (044525...)
  const digitsOnly = s.replace(/\D/g, '');
  if (digitsOnly.length === 20 && /^(?:30101|40702|40802|40817)/.test(digitsOnly)) {
    return false;
  }
  if (digitsOnly.length === 9 && /^04\d{7}$/.test(digitsOnly)) {
    return false;
  }

  // Reject common Russian warning/header words
  const lower = s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  const bannedWords = new Set([
    'действителен',
    'оферта',
    'счетоферта',
    'договор',
    'счетдоговор',
    'должен',
    'подлежит',
    'оплату',
    'покупателю',
    'счет',
    'счёт',
    'бн',
    'безномера',
    'ный',
    'ов',
    'наоплату'
  ]);
  if (bannedWords.has(lower)) return false;

  return true;
}

/**
 * Strips Russian/Turkish tax IDs (ИНН, КПП, ОГРН), postal codes, addresses, phone numbers,
 * and manager/code suffixes that OCR or PDF parsers sometimes attach to supplier names.
 */
export function stripVendorMetadataNoise(raw?: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // Remove leading "Поставщик:", "Продавец:", "Исполнитель:" labels if present
  s = s.replace(/^(?:Поставщик\s*(?:\([^)]*\))?|Продавец\s*(?:\([^)]*\))?|Исполнитель|Грузоотправитель|Организация|Получатель)\s*[:：\-]?\s*/i, '').trim();

  // If string starts with ИНН / КПП before the legal entity (e.g. "ИНН 7743772031, КПП 771501001, Общество с ограниченной ответственностью ТД "Поинтер", 127106...")
  const entityAfterTaxMatch = s.match(/(?:^|[,;\s]+)((?:Общество\s+с\s+ограниченной\s+ответственностью|Акционерное\s+общество|Закрытое\s+акционерное\s+общество|Публичное\s+акционерное\s+общество|Индивидуальный\s+предприниматель|ООО|OОО|АО|AO|ЗАО|ПАО|НАО|ИП)\s+.*)$/i);
  if (entityAfterTaxMatch && /^(?:ИНН|КПП|ОГРН|\d{10})/i.test(s)) {
    s = entityAfterTaxMatch[1].trim();
  }

  // Cut off everything starting from ИНН, КПП, ОГРН, ОКПО, Адрес, тел., р/с, к/с, БИК, Код:, Юр. адрес (Note: \b does not work on Cyrillic in JS RegExp!)
  s = s.split(/(?:[,;.\s]+|^)(?:ИНН|КПП|ОГРН|ОКПО|Адрес|Юр\.?\s*адрес|Факт\.?\s*адрес|тел\.?|телефон|р\/с|к\/с|БИК|Код\s*:|e-?mail)(?![A-Za-zА-Яа-яЁё])/i)[0].trim();

  // Cut off trailing 6-digit Russian postal code + address (e.g. ", 119331, Москва г, ..." or ", 115419,")
  s = s.replace(/[,;\s]+\d{6}(?![0-9]).*$/i, '').trim();

  // Cut off trailing city/region fragments if they follow a comma
  s = s.replace(/,\s*(?:г\.?\s*Москва|Город\s+Москва|Москва\s+г|Московская\s+обл|Россия|Российская\s+Федерация|г\.?\s*Санкт-Петербург|вн\.?\s*тер\.?\s*г)(?![А-Яа-яЁё]).*$/i, '').trim();

  // Fix spaced punctuation inside quotes like " Строительный двор . Комплектация "
  s = s.replace(/\s+\./g, '.').replace(/\s+,/g, ',');

  // Clean trailing punctuation/commas/quotes left dangling
  s = s.replace(/[,;:\s]+$/, '').trim();
  return s;
}

/**
 * İki tedarikçi adının aynı şirketi temsil edip etmediğini belirleyen benzersiz karşılaştırma anahtarı.
 */
export function getVendorKey(name?: string): string {
  if (!name) return '';
  let s = stripVendorMetadataNoise(name).toLowerCase();
  if (!s) return '';
  
  // Script lookalikes (including mixed Latin/Cyrillic OОО / AО)
  s = s.replace(/(^|[\s"«»])[oо]{3}(?=[\s"«»]|$)/gi, '$1ооо')
       .replace(/(^|[\s"«»])[aа][oо](?=[\s"«»]|$)/gi, '$1ао');

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
 * Tüzel kişilik eklerinden (ооо, ао, зао, пао, ип, тд, тк, гк, ltd, as vb.) arındırılmış
 * saf çekirdek şirket adını döndürür. Böylece iki farklı "ООО" şirketi karşılaştırılırken
 * ortak "ооо" kelimesi nedeniyle sahte benzerlik oluşmaz.
 */
export function getCoreVendorKey(name?: string): string {
  const fullKey = getVendorKey(name);
  if (!fullKey) return '';
  const stopTokens = new Set([
    'ооо', 'ooo', 'ао', 'ao', 'зао', 'пао', 'нао', 'ип',
    'тд', 'тк', 'тск', 'гк', 'пк', 'нпо', 'стд',
    'торговый', 'дом', 'группа', 'компаний', 'компания', 'фирма',
    'ltd', 'sti', 'as', 'san', 'tic', 'sanayi', 'ticaret'
  ]);
  const tokens = fullKey.split(' ').filter(t => t && !stopTokens.has(t));
  return tokens.length > 0 ? tokens.join(' ') : fullKey;
}

/**
 * İki tedarikçi adının aynı firma olup olmadığını kontrol eder.
 */
export function areVendorsEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const innA = extractVendorInn(a);
  const innB = extractVendorInn(b);
  if (innA && innB) {
    return innA === innB;
  }
  const coreA = getCoreVendorKey(a);
  const coreB = getCoreVendorKey(b);
  if (coreA.length >= 2 && coreB.length >= 2) {
    return coreA === coreB;
  }
  const keyA = getVendorKey(a);
  const keyB = getVendorKey(b);
  return keyA.length > 0 && keyA === keyB;
}

/**
 * Ham tedarikçi adını temiz, standart ve profesyonel kanonik ada dönüştürür.
 */
export function normalizeVendorName(name?: string): string {
  if (!name) return '';
  let clean = stripVendorMetadataNoise(name);
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
    let core = stripVendorMetadataNoise(prefixMatch[2]);

    // Strip any quotes anywhere from core name to reconstruct a pristine single pair of quotes
    core = core.replace(/[«»"'“”„`´\x27]/g, ' ').trim();
    // Strip trailing dots, commas, or dashes from core
    core = core.replace(/[\s.,;\-]+$/, '').trim();
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
    let core = stripVendorMetadataNoise(suffixMatch[1]);
    core = core.replace(/[«»"'“”„`´\x27]/g, ' ').trim();
    core = core.replace(/[\s.,;\-]+$/, '').trim();
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
