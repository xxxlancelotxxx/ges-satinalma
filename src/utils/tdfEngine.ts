/**
 * TDF (Teklif Değerlendirme Formu) hesap motoru.
 *
 * Saf fonksiyonlar: hem sunucu (Excel/HTML çıktısı) hem ekran aynı sonucu üretir.
 * Kurallar:
 *  - Tüm fiyatlar KDV (НДС) dahil birim fiyattır (Berkant kararı, 2026-10-18).
 *  - Aynı firmanın birden fazla teklifi varsa en yenisi "güncel", eskisi "ilk teklif" sayılır (indirim takibi).
 *  - Farklı firmaların aynı malzemesi tek satırda birleşir; sınıf/çap/boy/RAL/yoğunluk farkı varsa
 *    birleştirilmez, kullanıcı elle birleştirirse hücre uyarı taşır.
 */
import { materialFingerprint } from './materialFingerprint';
import { getVendorKey } from './vendorNormalizer';
import {
  cleanReadWarning, formatDelivery, formatDeliveryPlace, formatPayment, formatValidity,
  parseDeliveryPlaceText, parseDeliveryText, parsePaymentText, parseValidityText, TdfTermFields
} from './tdfTerms';

/** Malzeme alımında montaj olmadığı için şartlardan çıkarıldı (eski kayıtlardaki `installation` yok sayılır). */
export type TdfTermKey = 'payment' | 'delivery' | 'deliveryPlace' | 'validity' | 'warranty';
export const TDF_TERM_KEYS: TdfTermKey[] = ['payment', 'delivery', 'deliveryPlace', 'validity', 'warranty'];
export const TDF_TERM_LABELS: Record<TdfTermKey, { tr: string; ru: string }> = {
  payment: { tr: 'Ödeme şartı', ru: 'Условия оплаты' },
  delivery: { tr: 'Teslim süresi', ru: 'Срок поставки' },
  deliveryPlace: { tr: 'Teslim yeri', ru: 'Место поставки' },
  validity: { tr: 'Teklif geçerliliği', ru: 'Срок действия' },
  warranty: { tr: 'Garanti', ru: 'Гарантия' }
};

export interface TdfTerm extends TdfTermFields {
  /** Kutuda görünen kısa metin (yapılandırılmış alandan üretilir: "Avans %50", "Vadeli 30 gün", "Şantiye teslim") */
  value: string;
  /** offer: tekliften okundu, user: elle girildi, '': boş */
  source: 'offer' | 'user' | '';
  /** Belgede yazan asıl ifade (ör. "30 дн. с даты отгрузки") */
  raw?: string;
  /** Belgelerde birbirini tutmayan bilgi (ör. "faturada 45 gün yazıyor") */
  conflict?: string;
}

export interface TdfLine {
  id: string;
  name: string;
  brand?: string;
  unit: string;
  quantity: number;
  /** KDV dahil birim fiyat */
  unitPrice: number;
  totalPrice?: number;
  vatPercentage?: number;
  deliveryNote?: string;
}

export interface TdfOffer {
  id: string;
  supplier: string;
  inn?: string;
  docNumber?: string;
  docDate?: string; // YYYY-MM-DD
  fileName?: string;
  fileUrl?: string;
  currency?: string;
  totalAmount?: number;
  /** Ayrı yazılan nakliye bedeli (KDV dahil). Boş: şantiye teslimde fiyata dahil sayılır. */
  freightAmount?: number;
  terms: Record<TdfTermKey, TdfTerm>;
  note?: string;
  noteBy?: string;
  noteAt?: string;
  lines: TdfLine[];
  readWarnings?: string[];
  createdAt?: string;
}

export interface TdfWeights { price: number; coverage: number; payment: number; delivery: number; documents: number }
export const DEFAULT_TDF_WEIGHTS: TdfWeights = { price: 50, coverage: 10, payment: 15, delivery: 15, documents: 10 };

export interface TdfAiReview {
  generatedAt?: string;
  model?: string;
  qualityNotes?: Record<string, string>;
  extraWarnings?: Array<{ level: TdfWarningLevel; text: string; action?: string }>;
  summary?: string;
  vendorChecks?: Record<string, { status?: string; founded?: string; capital?: string; risk?: string; notes?: string; reviews?: string; sources?: string[] }>;
  /** malzeme anahtarı → ürün ve marka araştırması */
  materialInsights?: Record<string, { product?: string; brand?: string; notes?: string; sources?: string[] }>;
  sources?: string[];
}

export interface TdfVendorHistory { invoiceCount: number; totalAmount: number; firstDate?: string; lastDate?: string }
export interface TdfLastPrice { unitPrice: number; unit: string; date: string; supplier: string; invoiceNumber?: string }
export interface TdfHistory {
  builtAt: string;
  /** firma anahtarı (supplierKeyOf) → bizdeki faturalar */
  vendors: Record<string, TdfVendorHistory>;
  /** malzeme anahtarı → son alış (KDV dahil, malzeme satırının birimiyle) */
  lastPrices: Record<string, TdfLastPrice>;
}

export interface TdfForm {
  id: string;
  code: string;
  title: string;
  jobsiteId?: string;
  jobsiteName?: string;
  address?: string;
  requestNumbers?: string;
  status: 'draft' | 'ready' | 'approved';
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  offers: TdfOffer[];
  /** lineId -> malzeme anahtarı (elle birleştir / ayır) */
  materialOverrides?: Record<string, string>;
  /** lineId -> malzeme anahtarı (yapay zekâ eşleştirmesi; elle yapılan eşleştirme her zaman önce gelir) */
  aiGroups?: Record<string, string>;
  /** malzeme anahtarı -> yapay zekânın önerdiği tam ad (ad, özellik, marka) */
  aiNames?: Record<string, string>;
  aiMatchedAt?: string;
  aiMatchError?: string;
  /** malzeme anahtarı -> sipariş miktarı */
  orderQty?: Record<string, number>;
  /** malzeme anahtarı -> görünen ad */
  materialNames?: Record<string, string>;
  /** malzeme anahtarı -> kullanıcının kalite yorumu */
  qualityNotes?: Record<string, string>;
  weights?: TdfWeights;
  recommendationNote?: string;
  ai?: TdfAiReview;
  /** Bizim fatura arşivimizden: firma geçmişi ve malzemenin son alış fiyatı (sunucu doldurur) */
  history?: TdfHistory;
  isDeleted?: boolean;
  deletedAt?: string;
}

export type TdfWarningLevel = 'critical' | 'warning' | 'info';
export interface TdfWarning { level: TdfWarningLevel; text: string; action: string; supplierKey?: string; materialKey?: string }

export interface TdfSpecs { grade?: string; diameter?: string; length?: string; ral?: string; density?: string; thickness?: string; size?: string; gost?: string }

export interface TdfCell {
  offerId: string;
  lineId: string;
  name: string;
  brand?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  delivery?: string;
  specs: TdfSpecs;
  warning?: string;
  convertedFrom?: string;
}

export interface TdfMaterialRow {
  key: string;
  name: string;
  unit: string;
  orderQty: number;
  cells: Record<string, TdfCell | undefined>;
  bestSuppliers: string[];
  bestPrice: number | null;
  worstPrice: number | null;
  diffBestSecond: number | null;
  offerCount: number;
  /** Kalemin teknik özellikleri (ilk tekliften) */
  specs: TdfSpecs;
  /** Firmaların yazdığı markalar */
  brands: string[];
  /** Nasıl birleşti: aynı ad, benzer ad (kontrol edilmeli), yapay zekâ veya elle */
  match: 'single' | 'exact' | 'similar' | 'ai' | 'manual';
}

export interface TdfSupplierCol {
  key: string;
  name: string;
  offer: TdfOffer;
  previousOffers: TdfOffer[];
  total: number;
  firstTotal: number | null;
  covered: number;
  /** Nakliye bedeli (ayrı yazıldıysa) */
  freight: number;
  /** separate: ayrı bedel var; included: fiyata dahil (şantiye teslim, ayrı bedel yok); missing: fabrika teslim ama nakliye girilmedi */
  freightMode: 'separate' | 'included' | 'missing';
  /** Malzeme + nakliye */
  grandTotal: number;
}

export interface TdfScoreRow { supplierKey: string; price: number | null; coverage: number; payment: number; delivery: number; documents: number; total: number }

export interface TdfComparison { label: string; diff: number; pct: number; note: string }

export interface TdfRecommendation {
  headline: string;
  plan: Array<{ supplierKey: string; materialKeys: string[]; amount: number }>;
  planTotal: number;
  bestSingle?: { supplierKey: string; total: number };
  mixTotal: number;
  points: string[];
}

export interface TdfComputed {
  suppliers: TdfSupplierCol[];
  materials: TdfMaterialRow[];
  orderTotalQty: number;
  mixTotal: number;
  comparisons: TdfComparison[];
  warnings: TdfWarning[];
  recommendation: TdfRecommendation | null;
  scores: TdfScoreRow[];
  weights: TdfWeights;
  mergeSuggestions: Array<{ a: string; b: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

export function emptyTerms(): Record<TdfTermKey, TdfTerm> {
  return TDF_TERM_KEYS.reduce((acc, k) => { acc[k] = { value: '', source: '' }; return acc; }, {} as Record<TdfTermKey, TdfTerm>);
}

const UNIT_MAP: Array<[RegExp, string]> = [
  [/^(т|тн|тонн[аы]?|ton|tonne|tonnes|tn|t)$/i, 't'],
  [/^(кг|kg|килограмм)$/i, 'kg'],
  [/^(м3|м³|m3|m³|куб|куб\.?м)$/i, 'm³'],
  [/^(м2|м²|m2|m²|кв\.?м)$/i, 'm²'],
  [/^(м|м\.п|п\.?м|пог\.?\s?м|m|mt|metre|метр)$/i, 'm'],
  [/^(шт|штук[аи]?|adet|ad|pcs)$/i, 'adet'],
  [/^(л|литр|lt|litre|l)$/i, 'l']
];

export function canonicalUnit(raw?: string): string {
  const u = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
  if (!u) return 'adet';
  for (const [re, out] of UNIT_MAP) if (re.test(u)) return out;
  return u;
}

/** Birim dönüştürme çarpanı: 1 `from` = factor × `to`. Bilinmiyorsa null. */
function unitFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  if (from === 'kg' && to === 't') return 0.001;
  if (from === 't' && to === 'kg') return 1000;
  return null;
}

const HOMO: Record<string, string> = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };
const latinUpper = (s: string) => s.toUpperCase().replace(/[АВСЕКМНОРТХ]/g, ch => HOMO[ch] || ch);

const REBAR_GRADE_RE = /^A(?:240|300|400|500|600|800|1000)[CС]?$/i;

export function isRebarMaterial(name: string, grade?: string): boolean {
  const s = String(name || '');
  if (/(?:^|[^А-Яа-яЁёA-Za-z])(?:арм\.?|арматур[а-я]*|армирован[а-я]*|катанка)(?:$|[^А-Яа-яЁёA-Za-z])/i.test(s)) return true;
  if (/(?:пруток|прутках)/i.test(s) && grade && REBAR_GRADE_RE.test(grade)) return true;
  return false;
}

export function extractTdfSpecs(name: string): TdfSpecs {
  const s = String(name || '').replace(/\s+/g, ' ');
  const specs: TdfSpecs = {};
  const grade = s.match(/(?:^|[^A-Za-zА-Яа-я0-9])([AАaа]\s?-?\s?(?:240|300|400|500|600|800|1000)\s?[CСcс]?|[BВ]\s?\d{2}(?:[.,]\d)?\b|[MМ]\s?\d{3}\b|S\d{3}[A-Z0-9]*|С\d{3}\b)/);
  if (grade) specs.grade = latinUpper(grade[1]).replace(/[\s-]/g, '');
  const rebar = isRebarMaterial(s, specs.grade);
  const rebarDimMm = rebar ? s.match(/(?:^|[^\d.,])(\d{1,2}(?:[.,]\d+)?)\s?[xхХ×*]\s?(11700|11750|12000|6000|9000|3000)\b/) : null;
  if (rebarDimMm) {
    specs.diameter = rebarDimMm[1].replace(',', '.');
    specs.length = String(parseFloat(rebarDimMm[2]) / 1000);
  }
  if (!specs.diameter) {
    const dia = s.match(/(?<![A-Za-zА-Яа-яЁё])(?:Ø|ø|⌀|ф|Ф|d|д|D|диам\.?\s?)\s*=?\s*(\d+(?:[.,]\d+)?)/) || s.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s?(?:мм|mm)(?![а-яёa-z])(?!\s?[xх*×])/i);
    if (dia) specs.diameter = dia[1].replace(',', '.');
  }
  if (!specs.length) {
    const len = s.match(/(?:L\s*=?\s*|длин[аой]*\s*)(\d+(?:[.,]\d+)?)\s?(?:м|m)(?![а-яёa-z0-9²³])/i) || s.match(/\b(\d+(?:[.,]\d+)?)\s?(?:м|m)(?![а-яёa-z0-9²³])(?!\s?[23²³])/);
    if (len) specs.length = len[1].replace(',', '.');
    else if (rebar) {
      const lenMm = s.match(/(?:^|[\s(])(11700|11750|12000|6000|9000|3000)(?:\s?(?:мм|mm))?(?=$|[\s),;])/i);
      if (lenMm) specs.length = String(parseInt(lenMm[1], 10) / 1000);
    }
  }
  const ral = s.match(/RAL\s?(\d{4})/i);
  if (ral) specs.ral = ral[1];
  const dens = s.match(/(\d{2,4})\s?(?:кг\/м3|кг\/м³|kg\/m3|kg\/m³)/i) || s.match(/(?:плотн[а-яё]*\.?|yoğunluk)\s?(\d{2,4})/i);
  if (dens) specs.density = dens[1];
  const thick = s.match(/(?:толщ[а-яё]*\.?|s\s?=|t\s?=|kalınlık)\s?(\d+(?:[.,]\d+)?)/i) || s.match(/\b(\d+(?:[.,]\d+)?)\s?(?:мм|mm)\s?(?:толщ|лист)/i);
  if (thick) specs.thickness = thick[1].replace(',', '.');
  if (!rebarDimMm) {
    const size = s.match(/(\d+(?:[.,]\d+)?)\s?[xхХ×*]\s?(\d+(?:[.,]\d+)?)(?:\s?[xхХ×*]\s?(\d+(?:[.,]\d+)?))?/);
    if (size) {
      const nums = [size[1], size[2], size[3]].filter(Boolean).map(x => parseFloat(x!.replace(',', '.'))).sort((a, b) => b - a);
      specs.size = nums.slice(0, 2).map(n => String(n)).join('x');
    }
  }
  const gost = s.match(/(?:ГОСТ|GOST)\s?(?:Р\s?)?([\d.-]+)/i);
  if (gost) specs.gost = gost[1].replace(/[.-]$/, '');
  return specs;
}

const SPEC_LABELS: Record<keyof TdfSpecs, string> = {
  grade: 'sınıf', diameter: 'çap', length: 'boy', ral: 'RAL renk', density: 'yoğunluk', thickness: 'kalınlık', size: 'ebat', gost: 'ГОСТ'
};

export function normSpecVal(k: keyof TdfSpecs, v?: string): string {
  if (!v) return '';
  if (k === 'gost') return v.trim().replace(/-\d{2,4}$/, '');
  if (k === 'grade') return v.trim().toUpperCase().replace(/^A240C$/, 'A240');
  return v.trim();
}

/** İki satırın teknik farkları (ikisinde de olan ama farklı olan özellikler). */
export function specDifferences(a: TdfSpecs, b: TdfSpecs): string[] {
  const out: string[] = [];
  (Object.keys(SPEC_LABELS) as Array<keyof TdfSpecs>).forEach(k => {
    if (a[k] && b[k] && normSpecVal(k, a[k]) !== normSpecVal(k, b[k])) {
      out.push(`${SPEC_LABELS[k]} ${a[k]} ≠ ${b[k]}`);
    }
  });
  return out;
}

export function compactOfferedName(raw: string): string {
  return String(raw || '')
    .replace(/Сталь\s+углеродистая\s+для\s+армирования\s+железобетонных\s+конструкций\s+периодического\s*профиля(?:\s+мерной\s+длины)?/gi, 'Сталь арм. пер. профиля')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalMaterialName(rawNames: string[], specs: TdfSpecs): string {
  const clean = rawNames.map(n => String(n || '').trim()).filter(Boolean);
  if (!clean.length) return '';
  const unique = [...new Set(clean)];
  const rebar = clean.some(n => isRebarMaterial(n, specs.grade));
  const hasVerboseOrVariantRebar = rebar && (
    unique.length > 1 ||
    clean.some(n => n.length > 42 || /Сталь\s+углеродистая|Пруток\s+МД|Катанка|\d{4,5}/i.test(n))
  );
  if (hasVerboseOrVariantRebar && specs.diameter && specs.grade) {
    const cyrGrade = specs.grade.replace(/A/g, 'А').replace(/C/g, 'С');
    const lenPart = specs.length ? ` (${specs.length.replace('.', ',')} м)` : '';
    return `Арматура ${cyrGrade} Ø${specs.diameter}${lenPart}`;
  }
  return unique[0];
}

const ABBREV: Array<[RegExp, string]> = [
  [/(^|[^а-яa-z])арм\.?(?=\s|$)/gi, '$1арматура '],
  [/(^|[^а-яa-z])armatür/gi, '$1арматура'],
  [/(^|[^а-яa-z])арматур[аы]?/gi, '$1арматура'],
  [/(^|[^а-яa-z])бет\.?(?=\s|$)/gi, '$1бетон '],
  [/(^|[^а-яёa-z])кл\.\s*/gi, '$1'],
  [/(^|[\s(])(\d+(?:[.,]\d+)?)\s*мм(?![а-яё])/gi, '$1d$2']
];

/** Teklif satırının otomatik malzeme anahtarı. */
export function tdfMaterialKey(name: string): string {
  let s = String(name || '');
  for (const [re, rep] of ABBREV) s = s.replace(re, rep);
  // Çap işaretli sayıyı tekleştir: "Ø8", "8 мм", "d8" → d8
  s = s.replace(/(?<![A-Za-zА-Яа-яЁё])(?:Ø|ø|⌀|ф|Ф)\s*(\d)/g, 'd$1');
  return materialFingerprint(s);
}

function numberTokens(key: string): string {
  return key.split(' ').filter(t => /\d/.test(t)).sort().join(' ');
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(t => { if (B.has(t)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** Addaki ölçü sayıları (ГОСТ/ТУ numaraları hariç), yazım biçiminden bağımsız. */
export function nameNumbers(name: string): Set<string> {
  const raw = String(name || '');
  const rebar = isRebarMaterial(raw, extractTdfSpecs(raw).grade);
  let s = raw
    .replace(/(?:ГОСТ|GOST|ТУ|TU|СТО)\s?(?:Р\s?)?[\d.\-–]+/gi, ' ')
    .replace(/ст\.?\s?3\s?(?:сп|пс|кп)(?:\/(?:сп|пс|кп))?/gi, ' ')
    .replace(/(\d),(\d)/g, '$1.$2');
  if (rebar) {
    s = s.replace(/(?:^|[^\d.])(\d{1,2}(?:\.\d+)?)\s?[xхХ×*]\s?(11700|11750|12000|6000|9000|3000)\b/g, (_, d, mm) => ` ${d} ${parseInt(mm, 10) / 1000} `);
    s = s.replace(/(?:^|[^\d.])(11700|11750|12000|6000|9000|3000)(?=$|[^\d.])/g, (_, mm) => ` ${parseInt(mm, 10) / 1000} `);
  }
  const out = new Set<string>();
  (s.match(/\d+(?:\.\d+)?/g) || []).forEach(n => out.add(String(parseFloat(n))));
  return out;
}

/** Kalemin cinsi: addaki ilk anlamlı kelime ("Фанера ФСФ 18 мм" → фанера). */
export function headWord(name: string): string {
  const raw = String(name || '');
  if (isRebarMaterial(raw, extractTdfSpecs(raw).grade)) return materialFingerprint('арматура');
  const w = raw.toLowerCase().match(/[a-zа-яёçğıöşü]{3,}/i);
  return w ? materialFingerprint(w[0]) : '';
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x));
const subsetOf = (a: Set<string>, b: Set<string>) => [...a].every(x => b.has(x));

export function parseRuNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/\s| /g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Kutudaki şartın yapılandırılmış alanları; eski kayıtlarda yalnız metin varsa metinden çıkarılır. */
export function termFields(key: TdfTermKey, t?: TdfTerm): TdfTermFields {
  if (!t) return {};
  if (t.mode) return { mode: t.mode, num: t.num };
  const text = t.value || t.raw || '';
  if (key === 'payment') return parsePaymentText(text);
  if (key === 'delivery') return parseDeliveryText(text);
  if (key === 'deliveryPlace') return parseDeliveryPlaceText(text);
  if (key === 'validity') return parseValidityText(text);
  return {};
}

/** Yapılandırılmış alandan kutu metni. */
export function termValueFromFields(key: TdfTermKey, f: TdfTermFields): string {
  if (key === 'payment') return formatPayment(f);
  if (key === 'delivery') return formatDelivery(f);
  if (key === 'deliveryPlace') return formatDeliveryPlace(f);
  if (key === 'validity') return formatValidity(f);
  return '';
}

/**
 * Puanlama için ödeme vadesinin gün karşılığı: tam vadeli → vade günü; avans → 0;
 * kısmi avans (ör. %30) → avans dışındaki pay için 30 gün varsayılır (%30 avans ≈ 21 gün).
 */
export function termPaymentDays(t?: TdfTerm): number | null {
  const f = termFields('payment', t);
  if (f.mode === 'deferred') return f.num ?? 0;
  if (f.mode === 'advance') return Math.round((1 - Math.min(100, f.num ?? 100) / 100) * 30);
  return paymentDays(t?.value);
}

/** Ödeme vadesi (gün). Ön ödeme → 0, bilinmiyor → null. */
export function paymentDays(text?: string): number | null {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return null;
  if (/100\s?%\s?(пред|ön|avans|prepay)|предоплат|ön ödeme|peşin/.test(s) && !/\d+\s?(дн|gün|day)/.test(s)) return 0;
  const m = s.match(/(\d{1,3})\s?(?:к\.?\s?)?(?:дн|день|дня|дней|gün|gun|day)/);
  if (m) return parseInt(m[1], 10);
  if (/по факту|teslimde|при получении/.test(s)) return 0;
  return null;
}

function deliveryScore(t: TdfTerm | undefined, fallbackText: string): number {
  const f = termFields('delivery', t?.value || t?.mode ? t : { value: fallbackText, source: '' });
  if (f.mode === 'stock') return 1;
  if (f.mode === 'days' && Number.isFinite(f.num)) return f.num! <= 3 ? 0.95 : f.num! <= 10 ? 0.85 : f.num! <= 30 ? 0.7 : 0.5;
  return deliveryScoreText(t?.value || fallbackText);
}

function deliveryScoreText(text?: string): number {
  const s = String(text || '').toLowerCase();
  if (!s.trim() || /не указ|belirtilm|—/.test(s)) return 0.25;
  if (/налич|stok|stock|склад/.test(s)) return 1;
  if (/по заявк|talep/.test(s)) return 0.4;
  if (/пути|yolda/.test(s)) return 0.8;
  if (/\d{1,2}[./]\d{1,2}|\d+\s?(?:дн|gün|day|раб)/.test(s)) return 0.85;
  return 0.6;
}

/** Geçerlilik süresi metni + teklif tarihi → son geçerlilik günü (YYYY-MM-DD) veya null. */
export function validityEndDate(validity?: string, docDate?: string): string | null {
  const s = String(validity || '').toLowerCase();
  if (!s.trim()) return null;
  const abs = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (abs) {
    const y = abs[3].length === 2 ? `20${abs[3]}` : abs[3];
    return `${y}-${abs[2].padStart(2, '0')}-${abs[1].padStart(2, '0')}`;
  }
  if (!docDate || !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return null;
  const m = s.match(/(\d{1,3})\s?(?:банк[а-яё]*\.?\s?|раб[а-яё]*\.?\s?|iş\s?|banka\s?)?(?:дн|день|дня|дней|gün|gun|day)/);
  if (!m) return null;
  const days = parseInt(m[1], 10);
  const workdays = /банк|раб|iş|banka/.test(s);
  const d = new Date(`${docDate}T00:00:00Z`);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (!workdays || (wd !== 0 && wd !== 6)) added++;
  }
  return d.toISOString().slice(0, 10);
}

const fmtRub = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
const fmtPct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')} %`;
const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }).replace(/ /g, ' ');

// ---------------------------------------------------------------------------
// Ana hesap
// ---------------------------------------------------------------------------

interface WorkLine { offer: TdfOffer; line: TdfLine; key: string; unit: string; specs: TdfSpecs; supplierKey: string }

/** Sütun başlıkları için kısa firma adı: "ООО «Торговый дом БМЗ»" → "ТД БМЗ". */
export function shortSupplierName(name: string): string {
  const s = String(name || '')
    .replace(/^\s*(?:ООО|АО|ПАО|ЗАО|ОАО|ИП|LLC|Ltd\.?|A\.Ş\.?)\s+/i, '')
    .replace(/[«»"“”]/g, '')
    .replace(/Торговый\s+дом/gi, 'ТД')
    .replace(/\s+/g, ' ')
    .trim();
  return s || String(name || '').trim();
}

export function supplierKeyOf(offer: TdfOffer): string {
  return getVendorKey(offer.supplier) || offer.supplier || offer.id;
}

function offerSortKey(o: TdfOffer): string {
  return `${o.docDate || ''}|${o.createdAt || ''}`;
}

export function computeTdf(form: TdfForm, todayIso: string = new Date().toISOString().slice(0, 10)): TdfComputed {
  const weights = { ...DEFAULT_TDF_WEIGHTS, ...(form.weights || {}) };
  const overrides = form.materialOverrides || {};

  // 1) Firmalar: aynı firmanın en yeni teklifi güncel teklif
  const bySupplier = new Map<string, TdfOffer[]>();
  for (const o of form.offers || []) {
    const k = supplierKeyOf(o);
    if (!bySupplier.has(k)) bySupplier.set(k, []);
    bySupplier.get(k)!.push(o);
  }
  const suppliers: TdfSupplierCol[] = [];
  bySupplier.forEach((offers, key) => {
    const sorted = [...offers].sort((a, b) => offerSortKey(a).localeCompare(offerSortKey(b)));
    const current = sorted[sorted.length - 1];
    const freight = Number(current.freightAmount) || 0;
    const place = termFields('deliveryPlace', current.terms?.deliveryPlace).mode;
    const freightMode: TdfSupplierCol['freightMode'] = freight > 0 ? 'separate' : place === 'factory' ? 'missing' : 'included';
    suppliers.push({ key, name: current.supplier, offer: current, previousOffers: sorted.slice(0, -1), total: 0, firstTotal: null, covered: 0, freight, freightMode, grandTotal: 0 });
  });

  // 2) Satırları malzemelere grupla (yalnızca güncel teklifler)
  const work: WorkLine[] = [];
  for (const sup of suppliers) {
    for (const line of sup.offer.lines || []) {
      if (!(Number(line.quantity) > 0) && !(Number(line.unitPrice) > 0)) continue;
      work.push({ offer: sup.offer, line, key: '', unit: canonicalUnit(line.unit), specs: extractTdfSpecs(line.name), supplierKey: sup.key });
    }
  }
  // en çok kalemli teklif sırayı belirler
  const anchorOrder = [...suppliers].sort((a, b) => (b.offer.lines?.length || 0) - (a.offer.lines?.length || 0));
  const aiGroups = form.aiGroups || {};
  type Group = { key: string; members: WorkLine[]; fp: string; specs: TdfSpecs; nums: Set<string>; head: string; match: TdfMaterialRow['match'] };
  const groups: Group[] = [];
  const groupByKey = new Map<string, number>();
  const ordered = anchorOrder.flatMap(s => work.filter(w => w.supplierKey === s.key));
  for (const w of ordered) {
    const manual = overrides[w.line.id];
    const ai = !manual ? aiGroups[w.line.id] : undefined;
    const fp = tdfMaterialKey(w.line.name);
    const nums = nameNumbers(w.line.name);
    const head = headWord(w.line.name);
    let match: TdfMaterialRow['match'] = 'single';
    if (manual) {
      w.key = manual;
      match = 'manual';
    } else if (ai) {
      w.key = ai;
      match = 'ai';
    } else {
      // 1) aynı ad  2) aynı sayılar + benzer kelimeler  3) aynı cins + aynı ölçüler (yazım farklı)
      let found: string | null = null;
      if (groupByKey.has(fp)) { found = fp; match = 'exact'; }
      if (!found) {
        let bestScore = 0;
        for (const g of groups) {
          if (g.match === 'manual' || g.match === 'ai') continue;
          if (g.members.some(m => m.supplierKey === w.supplierKey)) continue;
          if (specDifferences(g.specs, w.specs).length) continue;
          if (!unitFactor(g.members[0].unit, w.unit) && !unitFactor(w.unit, g.members[0].unit)) continue;
          const sc = jaccard(g.fp, fp);
          const sameRebar = g.head === 'apmatypa' && head === 'apmatypa'
            && !!g.specs.diameter && g.specs.diameter === w.specs.diameter
            && !!g.specs.grade && normSpecVal('grade', g.specs.grade) === normSpecVal('grade', w.specs.grade);
          const sameNums = numberTokens(g.fp) === numberTokens(fp) || (sameSet(g.nums, nums) && (nums.size > 0 || sc >= 0.6));
          const ok = sameRebar || (sameNums && (sc >= 0.6 || (g.head && g.head === head && sc >= 0.2)));
          const score = sameRebar ? Math.max(sc, 0.85) : sc;
          if (ok && score > bestScore) { bestScore = score; found = g.key; match = sc >= 0.999 ? 'exact' : 'similar'; }
        }
      }
      if (found) {
        const g = groups[groupByKey.get(found)!];
        if (g.members.some(m => m.supplierKey === w.supplierKey)) found = null; // aynı firma iki ayrı kalem
      }
      if (!found) match = 'single';
      w.key = found || fp || w.line.id;
      if (!found && groupByKey.has(w.key)) w.key = `${w.key}#${w.line.id}`;
    }
    if (!groupByKey.has(w.key)) {
      groupByKey.set(w.key, groups.length);
      groups.push({ key: w.key, members: [], fp, specs: { ...w.specs }, nums, head, match: match === 'similar' || match === 'exact' ? 'single' : match });
    }
    const g = groups[groupByKey.get(w.key)!];
    g.members.push(w);
    (Object.keys(SPEC_LABELS) as Array<keyof TdfSpecs>).forEach(k => {
      if (!g.specs[k] && w.specs[k]) g.specs[k] = w.specs[k];
    });
    if (g.members.length > 1 && (match === 'similar' || (match === 'exact' && g.match === 'single'))) g.match = match;
  }

  // Son adım: iki firmanın teklifinde tek kalmış, aynı cins ve çelişmeyen ölçülü kalemler
  // (ör. "Фанера ФСФ 18 мм" / "Фанера березовая 1525х1525х18 мм") karşılıklı tek aday ise birleştirilir.
  const free = (g: Group) => g.match !== 'manual' && g.match !== 'ai';
  const suppliersOf = (g: Group) => new Set(g.members.map(m => m.supplierKey));
  const looseOk = (a: Group, b: Group) => {
    if (!free(a) || !free(b) || !a.head || a.head !== b.head) return false;
    const sa = suppliersOf(a); if ([...suppliersOf(b)].some(k => sa.has(k))) return false;
    if (specDifferences(a.specs, b.specs).length) return false;
    if (!unitFactor(a.members[0].unit, b.members[0].unit) && !unitFactor(b.members[0].unit, a.members[0].unit)) return false;
    return subsetOf(a.nums, b.nums) || subsetOf(b.nums, a.nums);
  };
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const A = groups[i], B = groups[j];
        if (!looseOk(A, B)) continue;
        const candA = groups.filter(g => g !== A && looseOk(A, g));
        const candB = groups.filter(g => g !== B && looseOk(B, g));
        if (candA.length !== 1 || candB.length !== 1) continue;
        B.members.forEach(m => { m.key = A.key; A.members.push(m); });
        A.match = 'similar';
        groups.splice(j, 1);
        groupByKey.clear();
        groups.forEach((g, idx) => groupByKey.set(g.key, idx));
        changed = true;
        break outer;
      }
    }
  }

  // 3) Malzeme satırları
  const materials: TdfMaterialRow[] = groups.map(g => {
    const unitCounts = new Map<string, number>();
    g.members.forEach(m => unitCounts.set(m.unit, (unitCounts.get(m.unit) || 0) + 1));
    const unit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'adet';
    const cells: Record<string, TdfCell | undefined> = {};
    const qtys: number[] = [];
    for (const m of g.members) {
      if (cells[m.supplierKey]) continue; // aynı firmadan ikinci satır: ilk satır geçerli
      const f = unitFactor(m.unit, unit);
      const qty = Number(m.line.quantity) || 0;
      const price = Number(m.line.unitPrice) || 0;
      const cell: TdfCell = {
        offerId: m.offer.id,
        lineId: m.line.id,
        name: m.line.name,
        brand: m.line.brand,
        quantity: f ? qty * f : qty,
        unitPrice: f ? price / f : price,
        total: 0,
        delivery: m.line.deliveryNote || '',
        specs: m.specs
      };
      if (f && f !== 1) cell.convertedFrom = `${fmtQty(qty)} ${m.unit} × ${fmtRub(price)} ₽ → ${unit}`;
      if (!f) cell.warning = `Birim farklı (${m.unit} / ${unit}); fiyat kıyaslanamaz.`;
      cells[m.supplierKey] = cell;
      if (cell.quantity > 0) qtys.push(Math.round(cell.quantity * 1000) / 1000);
    }
    // Satırın referans/çoğunluk teknik özellikleri: yalnızca çoğunluktan sapan hücre uyarı alır
    const memberCells = Object.values(cells).filter(Boolean) as TdfCell[];
    const rowSpecs: TdfSpecs = { ...g.specs };
    (Object.keys(SPEC_LABELS) as Array<keyof TdfSpecs>).forEach(k => {
      const counts = new Map<string, { raw: string; count: number }>();
      for (const c of memberCells) {
        const val = c.specs[k];
        if (!val) continue;
        const nk = normSpecVal(k, val);
        const cur = counts.get(nk);
        if (cur) cur.count++;
        else counts.set(nk, { raw: val, count: 1 });
      }
      if (counts.size) {
        const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
        rowSpecs[k] = best.raw;
      }
    });
    for (const c of memberCells) {
      const diffs = specDifferences(rowSpecs, c.specs);
      if (diffs.length && !c.warning) c.warning = `Teknik fark: ${[...new Set(diffs)].join(', ')}`;
    }
    // Sipariş miktarı: kullanıcı > en sık tekrar eden > en büyük
    let orderQty = Number(form.orderQty?.[g.key]);
    if (!(orderQty > 0)) {
      const freq = new Map<number, number>();
      qtys.forEach(q => freq.set(q, (freq.get(q) || 0) + 1));
      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || String(b[0]).length - String(a[0]).length);
      orderQty = sorted[0]?.[0] || 0;
    }
    memberCells.forEach(c => { c.total = c.unitPrice * orderQty; });
    const stdName = canonicalMaterialName(g.members.map(m => m.line.name), rowSpecs) || g.members[0]?.line.name || g.key;
    const brands = [...new Set(g.members.map(m => (m.line.brand || '').trim()).filter(Boolean))];
    return {
      key: g.key,
      name: form.materialNames?.[g.key] || form.aiNames?.[g.key] || stdName,
      specs: rowSpecs,
      brands,
      match: memberCells.length > 1 ? g.match : 'single',
      unit,
      orderQty,
      cells,
      bestSuppliers: [],
      bestPrice: null,
      worstPrice: null,
      diffBestSecond: null,
      offerCount: memberCells.length
    };
  });

  // En iyi fiyat (birimi kıyaslanamayan / teknik farklı hücreler hariç)
  const comparable = (c?: TdfCell) => !!c && c.unitPrice > 0 && !(c.warning && /Birim farklı|Teknik fark/.test(c.warning));
  for (const m of materials) {
    const prices = suppliers.map(s => ({ k: s.key, c: m.cells[s.key] })).filter(x => comparable(x.c)).map(x => ({ k: x.k, p: x.c!.unitPrice }));
    if (!prices.length) continue;
    prices.sort((a, b) => a.p - b.p);
    m.bestPrice = prices[0].p;
    m.worstPrice = prices[prices.length - 1].p;
    m.bestSuppliers = prices.filter(x => Math.abs(x.p - prices[0].p) < 0.005).map(x => x.k);
    m.diffBestSecond = prices.length > 1 ? (prices[1].p - prices[0].p) / prices[0].p : null;
  }

  // 4) Firma toplamları
  for (const s of suppliers) {
    s.total = materials.reduce((acc, m) => acc + (m.cells[s.key]?.total || 0), 0);
    s.grandTotal = s.total + s.freight;
    s.covered = materials.filter(m => m.cells[s.key]).length;
    if (s.previousOffers.length) {
      const first = s.previousOffers[0];
      // ilk teklifin fiyatları, güncel satırlarla aynı malzeme anahtarına göre eşlenir
      let sum = 0; let any = false;
      for (const m of materials) {
        const cur = m.cells[s.key];
        if (!cur) continue;
        const prevLine = (first.lines || []).find(l => (overrides[l.id] || tdfMaterialKey(l.name)) === tdfMaterialKey(cur.name) || overrides[l.id] === m.key);
        const prevPrice = prevLine ? Number(prevLine.unitPrice) * (unitFactor(canonicalUnit(prevLine.unit), m.unit) ? 1 / unitFactor(canonicalUnit(prevLine.unit), m.unit)! : 1) : cur.unitPrice;
        if (prevLine) any = true;
        sum += prevPrice * m.orderQty;
      }
      s.firstTotal = any ? sum : null;
    }
  }
  const orderTotalQty = materials.reduce((a, m) => a + (m.orderQty || 0), 0);
  const mixTotal = materials.reduce((a, m) => a + (m.bestPrice !== null ? m.bestPrice * m.orderQty : 0), 0);

  // 5) Öneri: tek firma + eksik kalemleri en ucuzdan tamamla
  let recommendation: TdfRecommendation | null = null;
  const pricedMaterials = materials.filter(m => m.bestPrice !== null);
  if (suppliers.length && pricedMaterials.length) {
    const candidates = suppliers.filter(s => s.covered >= Math.max(1, Math.ceil(pricedMaterials.length * 0.5)));
    let best: { s: TdfSupplierCol; total: number; plan: TdfRecommendation['plan'] } | null = null;
    for (const s of candidates) {
      const fill = new Map<string, string[]>();
      let total = 0;
      for (const m of pricedMaterials) {
        const own = m.cells[s.key];
        if (comparable(own)) { total += own!.total; fill.set(s.key, [...(fill.get(s.key) || []), m.key]); continue; }
        const alt = m.bestSuppliers[0];
        total += (m.bestPrice || 0) * m.orderQty;
        fill.set(alt, [...(fill.get(alt) || []), m.key]);
      }
      const plan = [...fill.entries()].map(([supplierKey, materialKeys]) => ({
        supplierKey,
        materialKeys,
        amount: materialKeys.reduce((a, k) => {
          const m = materials.find(x => x.key === k)!;
          const c = m.cells[supplierKey];
          return a + (c ? c.total : 0);
        }, 0)
      })).sort((a, b) => b.materialKeys.length - a.materialKeys.length);
      // Nakliye: plandaki her firmanın ayrı yazdığı nakliye bedeli toplama eklenir
      total += plan.reduce((a, p) => a + (suppliers.find(x => x.key === p.supplierKey)?.freight || 0), 0);
      if (!best || total < best.total) best = { s, total, plan };
    }
    const complete = suppliers.filter(s => pricedMaterials.every(m => comparable(m.cells[s.key]))).sort((a, b) => a.grandTotal - b.grandTotal);
    const nameOf = (k: string) => shortSupplierName(suppliers.find(s => s.key === k)?.name || k);
    const matName = (k: string) => materials.find(m => m.key === k)?.name || k;
    if (best) {
      const points: string[] = [];
      const main = best.plan[0];
      const rest = best.plan.slice(1);
      let headline = rest.length
        ? `${main.materialKeys.length} kalem ${nameOf(main.supplierKey)} firmasından, ${rest.map(p => `${p.materialKeys.length > 2 ? `${p.materialKeys.length} kalem` : p.materialKeys.map(matName).join(', ')} ${nameOf(p.supplierKey)} firmasından`).join('; ')} alınmalı.`
        : `Tüm kalemler (${main.materialKeys.length}) ${nameOf(main.supplierKey)} firmasından alınmalı.`;
      const planFreight = best.plan.reduce((a, p) => a + (suppliers.find(x => x.key === p.supplierKey)?.freight || 0), 0);
      const missingFreight = best.plan.map(p => suppliers.find(x => x.key === p.supplierKey)).filter(x => x?.freightMode === 'missing');
      headline += missingFreight.length
        ? ` Toplam ${fmtRub(best.total)} ₽ (${missingFreight.map(x => shortSupplierName(x!.name)).join(', ')} nakliyesi hariç).`
        : ` Toplam ${fmtRub(best.total)} ₽ (nakliye dahil).`;
      const bestComplete = complete.find(c => c.key !== best!.s.key) || complete[0];
      if (bestComplete && bestComplete.grandTotal > best.total + 0.5) {
        points.push(`Tek firmadan en ucuz tam teklife (${shortSupplierName(bestComplete.name)}, ${fmtRub(bestComplete.grandTotal)} ₽) göre ${fmtRub(bestComplete.grandTotal - best.total)} ₽ (${fmtPct((bestComplete.grandTotal - best.total) / bestComplete.grandTotal)}) daha ucuz.`);
      }
      if (missingFreight.length) points.push(`${missingFreight.map(x => shortSupplierName(x!.name)).join(', ')} fabrika/depo teslim veriyor; nakliye bedeli girilmediği için toplama eklenmedi.`);
      const extra = best.total - planFreight - mixTotal;
      if (extra > 0.5) {
        const moves = pricedMaterials.filter(m => {
          const inPlan = best!.plan.find(p => p.materialKeys.includes(m.key));
          return inPlan && !m.bestSuppliers.includes(inPlan.supplierKey);
        });
        points.push(`Kalem kalem en ucuzu seçmek (${fmtRub(mixTotal)} ₽) bu plana göre sadece ${fmtRub(extra)} ₽ daha kazandırır (${moves.map(m => `${m.name}: ${nameOf(m.bestSuppliers[0])}`).join(', ')}). ${extra / best.total < 0.003 ? 'Ayrı sipariş açmaya değip değmeyeceğine bak.' : 'Bölmek düşünülebilir.'}`);
      }
      recommendation = { headline, plan: best.plan, planTotal: best.total, bestSingle: complete[0] ? { supplierKey: complete[0].key, total: complete[0].grandTotal } : undefined, mixTotal, points };
    }
  }

  // 6) Kıyaslanabilir hacimde karşılaştırma (en ucuz firmanın kalemleri üzerinden)
  const comparisons: TdfComparison[] = [];
  const ranked = [...suppliers].filter(s => s.covered > 0).sort((a, b) => b.covered - a.covered || a.total - b.total);
  const recoMain = recommendation?.plan[0]?.supplierKey;
  const base = suppliers.find(s => s.key === recoMain)
    || [...suppliers].filter(s => s.covered >= Math.max(1, Math.ceil(pricedMaterials.length * 0.5))).sort((a, b) => a.total - b.total)[0];
  const unitSet = [...new Set(materials.map(m => m.unit))];
  const unitWord = unitSet.length === 1 ? unitSet[0] : 'birim';
  if (base) {
    const baseKeys = materials.filter(m => comparable(m.cells[base.key])).map(m => m.key);
    for (const s of ranked) {
      if (s.key === base.key) continue;
      const common = baseKeys.filter(k => comparable(materials.find(m => m.key === k)!.cells[s.key]));
      if (!common.length) continue;
      const sumS = common.reduce((a, k) => a + materials.find(m => m.key === k)!.cells[s.key]!.total, 0);
      const sumB = common.reduce((a, k) => a + materials.find(m => m.key === k)!.cells[base.key]!.total, 0);
      const diff = sumS - sumB;
      comparisons.push({
        label: `${shortSupplierName(s.name)} / ${shortSupplierName(base.name)}`,
        diff,
        pct: sumB ? diff / sumB : 0,
        note: `Aynı ${common.length} kalemde (${fmtQty(common.reduce((a, k) => a + materials.find(m => m.key === k)!.orderQty, 0))} ${unitWord}). ${shortSupplierName(s.name)} ${Math.abs(diff) < 0.5 ? 'aynı fiyatta' : diff > 0 ? 'daha pahalı' : 'daha ucuz'}.`
      });
    }
    const planMaterials = recommendation ? recommendation.planTotal - recommendation.plan.reduce((a, p) => a + (suppliers.find(x => x.key === p.supplierKey)?.freight || 0), 0) : 0;
    if (recommendation && planMaterials - mixTotal > 0.5) {
      comparisons.push({ label: 'Kalem kalem en ucuz / önerilen plan', diff: mixTotal - planMaterials, pct: (mixTotal - planMaterials) / planMaterials, note: 'Her kalemi ayrı firmadan almak bu kadar daha ucuz (nakliye hariç); farkın geldiği kalemler öneri kutusunda.' });
    }
  }

  // 7) Uyarılar
  const warnings: TdfWarning[] = [];
  const aiReadNotes = new Set<string>();
  const aiReadSuppliers = new Set<string>();
  const W = (level: TdfWarningLevel, text: string, action: string, extra: Partial<TdfWarning> = {}) => warnings.push({ level, text, action, ...extra });
  for (const m of materials) {
    for (const s of suppliers) {
      const c = m.cells[s.key];
      if (c?.warning && /Teknik fark/.test(c.warning)) {
        W('critical', `${shortSupplierName(s.name)}, "${m.name}" kaleminde farklı bir ürün teklif etti: ${compactOfferedName(c.name)} (${c.warning.replace('Teknik fark: ', '')}).`, 'Fiyat tabloda bilgi amaçlı gösterildi, en ucuz hesabına katılmadı. Proje bu farkı kabul ediyorsa değerlendirilebilir.', { supplierKey: s.key, materialKey: m.key });
      } else if (c?.warning && /Birim farklı/.test(c.warning)) {
        W('warning', `${shortSupplierName(s.name)}, "${m.name}" kaleminde farklı birimle fiyat verdi.`, c.warning, { supplierKey: s.key, materialKey: m.key });
      }
    }
  }
  for (const s of suppliers) {
    const t = s.offer.terms || emptyTerms();
    for (const k of TDF_TERM_KEYS) {
      if (t[k]?.conflict) W('critical', `${shortSupplierName(s.name)}: ${TDF_TERM_LABELS[k].tr.toLowerCase()} belgelerde farklı. ${t[k].conflict}`, 'Siparişten önce firmadan yazılı teyit al.', { supplierKey: s.key });
    }
    if (pricedMaterials.length && s.covered < pricedMaterials.length) {
      const missing = materials.filter(m => !m.cells[s.key]).map(m => m.name);
      W(s.covered <= pricedMaterials.length / 2 ? 'warning' : 'info', `${shortSupplierName(s.name)} ${pricedMaterials.length} kalemden ${s.covered} tanesine fiyat verdi.`, `Eksik: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` ve ${missing.length - 8} kalem daha` : ''}. Toplamı diğerleriyle doğrudan kıyaslanamaz.`, { supplierKey: s.key });
    }
    if (s.freightMode === 'missing') W('warning', `${shortSupplierName(s.name)} fabrika/depo teslim veriyor; nakliye fiyata dahil değil.`, 'Nakliye bedelini firmadan iste veya teklif kartındaki "Nakliye" kutusuna tahmini tutarı yaz; genel toplam ona göre hesaplanır.', { supplierKey: s.key });
    const missingTerms: string[] = [];
    if (!t.payment?.value?.trim()) missingTerms.push('ödeme şartı');
    if (!t.deliveryPlace?.value?.trim()) missingTerms.push('teslim yeri');
    if (!t.validity?.value?.trim()) missingTerms.push('geçerlilik süresi');
    if (!t.delivery?.value?.trim() && !(s.offer.lines || []).some(l => l.deliveryNote)) missingTerms.push('teslim süresi');
    if (missingTerms.length) W(missingTerms.includes('ödeme şartı') ? 'warning' : 'info', `${shortSupplierName(s.name)} teklifinde ${missingTerms.join(', ')} yok.`, 'Firmadan istenmeli veya kutuya elle yazılmalı.', { supplierKey: s.key });
    const vf = termFields('validity', t.validity);
    const end = validityEndDate(vf.num ? `${vf.num} ${vf.mode === 'workdays' ? 'раб. дн' : 'дн'}` : t.validity?.value, s.offer.docDate);
    if (end && end < todayIso) W('warning', `${shortSupplierName(s.name)} teklifinin geçerlilik süresi doldu (son gün ${end.split('-').reverse().join('.')}).`, 'Bu firmayla devam edilecekse güncel teklif istenmeli.', { supplierKey: s.key });
    if (/по заявк|talep üzerine/i.test(t.delivery?.value || '') || (s.offer.lines || []).filter(l => /по заявк/i.test(l.deliveryNote || '')).length > (s.offer.lines || []).length / 2) {
      W('info', `${shortSupplierName(s.name)} teslim için "talep üzerine (по заявке)" yazıyor; stok teyidi yok.`, 'Termin önemliyse stok ve teslim tarihi yazılı istenmeli.', { supplierKey: s.key });
    }
    // Miktar yuvarlama
    const rounded = materials.filter(m => { const c = m.cells[s.key]; return c && m.orderQty > 0 && Math.abs(c.quantity - m.orderQty) / m.orderQty > 0.0005; });
    if (rounded.length) {
      const offerQty = rounded.reduce((a, m) => a + (m.cells[s.key]!.quantity - m.orderQty), 0);
      W('info', `${shortSupplierName(s.name)} ${rounded.length} kalemde miktarı değiştirmiş/yuvarlamış (toplam fark ${offerQty > 0 ? '+' : ''}${fmtQty(offerQty)}).`, 'Karşılaştırma sipariş miktarıyla yapıldı. Sevkiyatta tolerans sözleşmeye yazılmalı.', { supplierKey: s.key });
    }
    (s.offer.readWarnings || []).map(cleanReadWarning).forEach(rw => {
      // Yapay zekâ kesintisi bütün belgeler için aynıdır; listede bir kez gösterilir
      if (/^Yapay zekâ kullanılamadı|^Kalemler yapay zekâ olmadan|^Ticari şartlar otomatik okunamadı/.test(rw)) { aiReadNotes.add(rw.replace(/\s*(?:Kalemler|Şartlar|Kalemler ve şartlar) belge metninden okundu;.*$/, '').replace(/\s*Ticari şartlar otomatik okunamadı;.*$/, '')); aiReadSuppliers.add(shortSupplierName(s.name)); return; }
      W('info', `${shortSupplierName(s.name)}: ${rw}`, 'Okunan değerleri kontrol et.', { supplierKey: s.key });
    });
  }
  const worstComplete = [...suppliers].filter(s => s.covered === pricedMaterials.length && s.covered > 0).sort((a, b) => b.grandTotal - a.grandTotal)[0];
  if (recommendation && worstComplete && recommendation.planTotal > 0 && worstComplete.grandTotal / recommendation.planTotal - 1 > 0.05) {
    W('info', `${shortSupplierName(worstComplete.name)} en yüksek teklif: önerilen plana göre +${fmtRub(worstComplete.grandTotal - recommendation.planTotal)} ₽ (${fmtPct(worstComplete.grandTotal / recommendation.planTotal - 1)}).`, 'Pazarlıkta en iyi fiyat referans gösterilebilir.', { supplierKey: worstComplete.key });
  }
  if (aiReadNotes.size) W('info', `${[...aiReadNotes][0]} ${[...aiReadSuppliers].join(', ')} teklifleri belge metninden okundu.`, 'Kalem adı, miktar, fiyat ve şart kutularını belgeyle karşılaştır; yanlışsa kutudan düzelt.');
  (form.ai?.extraWarnings || []).forEach(w => W(w.level, w.text, w.action || ''));
  const order: Record<TdfWarningLevel, number> = { critical: 0, warning: 1, info: 2 };
  warnings.sort((a, b) => order[a.level] - order[b.level]);

  // Birleştirme önerileri: aynı çap + aynı kategori, farklı sınıf/boy, farklı firmalar
  const mergeSuggestions: TdfComputed['mergeSuggestions'] = [];
  for (let i = 0; i < materials.length; i++) {
    for (let j = i + 1; j < materials.length; j++) {
      const A = materials[i], B = materials[j];
      const aS = Object.keys(A.cells).filter(k => A.cells[k]), bS = Object.keys(B.cells).filter(k => B.cells[k]);
      if (aS.some(k => bS.includes(k))) continue;
      const aSpec = A.cells[aS[0]]!.specs, bSpec = B.cells[bS[0]]!.specs;
      if (!aSpec.diameter || aSpec.diameter !== bSpec.diameter) continue;
      const aWords = tdfMaterialKey(A.name).split(' ').filter(t => !/\d/.test(t));
      const bWords = tdfMaterialKey(B.name).split(' ').filter(t => !/\d/.test(t));
      if (!aWords.some(w => w.length > 3 && bWords.includes(w))) continue;
      mergeSuggestions.push({ a: A.key, b: B.key, reason: specDifferences(aSpec, bSpec).join(', ') || 'yazım farkı' });
    }
  }

  // 8) Puanlama
  const minComparable = (() => {
    if (!base) return null;
    return base;
  })();
  const scores: TdfScoreRow[] = suppliers.map(s => {
    let price: number | null = null;
    if (minComparable && s.covered >= Math.max(1, Math.ceil(pricedMaterials.length * 0.5))) {
      const common = materials.filter(m => comparable(m.cells[s.key]) && comparable(m.cells[minComparable.key]));
      const sumS = common.reduce((a, m) => a + m.cells[s.key]!.total, 0);
      const best = common.reduce((a, m) => a + (m.bestPrice || 0) * m.orderQty, 0);
      // %1 pahalılık fiyat puanının %5'ini götürür (%20 ve üzeri pahalı → 0)
      price = sumS > 0 ? Math.round(weights.price * Math.max(0, 1 - Math.max(0, sumS / best - 1) * 5)) : null;
    }
    const coverage = pricedMaterials.length ? Math.round(weights.coverage * s.covered / pricedMaterials.length) : 0;
    const t = s.offer.terms || emptyTerms();
    const pd = termPaymentDays(t.payment);
    const payment = pd === null ? 0 : Math.round(weights.payment * Math.min(1, 0.2 + (pd / 45) * 0.8));
    const deliveryText = t.delivery?.value || (s.offer.lines || []).map(l => l.deliveryNote).find(Boolean) || '';
    const delivery = Math.round(weights.delivery * deliveryScore(t.delivery, deliveryText));
    const filled = TDF_TERM_KEYS.filter(k => k !== 'warranty' && t[k]?.value?.trim()).length + (s.offer.docNumber ? 1 : 0) + (s.offer.inn ? 1 : 0);
    const documents = Math.round(weights.documents * filled / 6);
    return { supplierKey: s.key, price, coverage, payment, delivery, documents, total: (price || 0) + coverage + payment + delivery + documents };
  });

  return { suppliers, materials, orderTotalQty, mixTotal, comparisons, warnings, recommendation, scores, weights, mergeSuggestions };
}

export function nextTdfCode(existing: string[], year = new Date().getFullYear()): string {
  const prefix = `TDF-${year}-`;
  const max = existing.filter(c => c && c.startsWith(prefix)).map(c => parseInt(c.slice(prefix.length), 10)).filter(n => Number.isFinite(n)).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export const tdfFormat = { rub: fmtRub, pct: fmtPct, qty: fmtQty };
