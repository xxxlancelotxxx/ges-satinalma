/**
 * TDF (Teklif Değerlendirme Formu) sunucu modülü.
 * - Kendi Firestore koleksiyonu: tdf_forms (faturalar / indirimler / karşılaştırmalı analizlere dokunmaz).
 * - Teklif okuma: mevcut fatura OCR'ı (processInvoiceTwoStages, tam tarama) + ticari şartlar için ayrı kısa Gemini çağrısı.
 * - Yapay zekâ değerlendirmesi: kalite yorumu, ek uyarılar, firma bilgisi (Google araması ile, kaynaklı).
 * - Çıktılar: Excel (exceljs) ve tek dosya HTML; PDF tarayıcıda HTML'den üretilir.
 */
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import {
  computeTdf, emptyTerms, extractTdfSpecs, nextTdfCode, specDifferences, supplierKeyOf, tdfMaterialKey, canonicalUnit, shortSupplierName, termFields, termValueFromFields,
  TdfAiReview, TdfComputed, TdfForm, TdfHistory, TdfLine, TdfOffer, TdfTerm, TdfTermKey, TDF_TERM_KEYS, TdfWarningLevel
} from '../src/utils/tdfEngine';
import { friendlyAiError, localTermsFromText } from '../src/utils/tdfTerms';
import { comparisonUnitPriceOfItem } from '../src/utils/vatBasis';

import { renderTdfHtml } from '../src/utils/tdfHtml';
import { buildTdfXlsxBuffer } from './tdfExcel';

export const TDF_COLLECTION = 'tdf_forms';

export interface TdfReadInput { fileBase64?: string; mimeType?: string; fileName?: string; excelCsv?: string; fileTextContext?: string }

export interface TdfDeps {
  getDb: () => any;
  /** Normalize edilmiş aktif faturalar (son alış fiyatı ve firma geçmişi için) */
  getInvoices?: () => Promise<any[]>;
  readOffer?: (input: TdfReadInput) => Promise<Omit<TdfOffer, 'id'>>;
  aiReview?: (form: TdfForm, computed: TdfComputed) => Promise<TdfAiReview>;
  /** Farklı firmaların aynı ürününü eşleştirir (yapay zekâ); yoksa eşleştirme kurallarla yapılır */
  aiMatch?: (form: TdfForm, computed: TdfComputed) => Promise<TdfAiMatchResult>;
  backupFile?: string;
  now?: () => Date;
  log?: Pick<Console, 'log' | 'warn'>;
}

// ---------------------------------------------------------------------------
// Teklifi okunmuş fatura verisinden TDF teklifine çevirme (saf, test edilir)
// ---------------------------------------------------------------------------

export interface TdfAiMatchResult { groups: Array<{ lineIds: string[]; name?: string }>; model?: string }

export interface ExtractedTerms {
  supplier?: string; inn?: string; docNumber?: string; docDate?: string;
  /** belgede yazan asıl ifadeler */
  payment?: string; delivery?: string; deliveryPlace?: string; validity?: string; warranty?: string;
  /** yapılandırılmış: advance | deferred */
  paymentMode?: string; advancePercent?: number | string; paymentDays?: number | string;
  /** teslim: stokta mı, kaç gün */
  inStock?: boolean; deliveryDays?: number | string;
  /** site | factory */
  deliveryPlaceType?: string;
  validityDays?: number | string;
  conflicts?: Partial<Record<TdfTermKey, string>>;
  lineDelivery?: Array<{ name?: string; delivery?: string }>;
  notes?: string[];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'value' in (v as any) ? String((v as any).value ?? '') : String(v)).trim();
const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const isoDate = (v: unknown) => { const s = str(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };

const EMPTY_TERM = /^(не указ[а-яё]*|нет|отсутствует|null|none|n\/a|yok|belirtilmemiş|-+|—)\.?$/i;

/** Yapay zekânın yapılandırılmış alanları (yoksa belge ifadesi) → kutu. */
function termFromExtracted(k: TdfTermKey, terms: ExtractedTerms): TdfTerm | null {
  const raw = str((terms as any)[k]);
  const rawOk = raw && !EMPTY_TERM.test(raw) ? raw : '';
  let fields: { mode?: string; num?: number } = {};
  if (k === 'payment') {
    const mode = str(terms.paymentMode).toLowerCase();
    if (mode === 'advance') fields = { mode, num: num(terms.advancePercent) || 100 };
    else if (mode === 'deferred') fields = { mode, num: num(terms.paymentDays) };
  } else if (k === 'delivery') {
    if (terms.inStock === true || str(terms.inStock) === 'true') fields = { mode: 'stock', num: 0 };
    else if (num(terms.deliveryDays) > 0) fields = { mode: 'days', num: num(terms.deliveryDays) };
  } else if (k === 'deliveryPlace') {
    const tp = str(terms.deliveryPlaceType).toLowerCase();
    if (tp === 'site' || tp === 'factory') fields = { mode: tp };
  } else if (k === 'validity') {
    if (num(terms.validityDays) > 0) fields = { mode: /банк|раб|iş|banka/i.test(rawOk) ? 'workdays' : 'days', num: num(terms.validityDays) };
  }
  if (!fields.mode && rawOk) fields = termFields(k, { value: rawOk, source: 'offer' });
  const value = termValueFromFields(k, fields) || (k === 'warranty' ? rawOk : '');
  if (!value && !rawOk) return null;
  const t: TdfTerm = { value: value || rawOk, source: 'offer' };
  if (fields.mode) { t.mode = fields.mode; if (fields.num !== undefined && Number.isFinite(fields.num)) t.num = fields.num; }
  if (rawOk && rawOk !== t.value) t.raw = rawOk;
  return t;
}

export function offerFromExtracted(extracted: any, terms: ExtractedTerms | null, meta: { fileName?: string; fileUrl?: string; nowIso: string; termsError?: string; termsFromText?: boolean; localItems?: boolean }): Omit<TdfOffer, 'id'> {
  const ex = extracted || {};
  const t = emptyTerms();
  for (const k of TDF_TERM_KEYS) {
    const term = terms ? termFromExtracted(k, terms) : null;
    if (term) t[k] = term;
    const conflict = str(terms?.conflicts?.[k]);
    if (conflict) t[k].conflict = conflict;
  }
  const lineDelivery = (terms?.lineDelivery || []).filter(x => str(x?.name) && str(x?.delivery));
  const lines: TdfLine[] = (Array.isArray(ex.items) ? ex.items : [])
    .map((it: any, i: number) => {
      const name = str(it.originalName) || str(it.materialName) || str(it.name);
      const qty = num(it.quantity);
      const gross = num(it.grossUnitPrice) || num(it.unitPrice);
      if (!name || (!(qty > 0) && !(gross > 0))) return null;
      const key = tdfMaterialKey(name);
      const del = lineDelivery.find(x => str(x.name) === name || tdfMaterialKey(str(x.name)) === key);
      const line: TdfLine = {
        id: `l${i}_${crypto.randomBytes(3).toString('hex')}`,
        name,
        unit: str(it.unit) || 'Adet',
        quantity: qty,
        unitPrice: Math.round(gross * 100) / 100,
        totalPrice: num(it.grossTotalPrice) || num(it.totalPrice) || Math.round(qty * gross * 100) / 100
      };
      const brand = [str(it.brand), str(it.model)].filter(Boolean).join(' ');
      if (brand) line.brand = brand;
      if (num(it.vatPercentage)) line.vatPercentage = num(it.vatPercentage);
      if (del) line.deliveryNote = str(del.delivery);
      return line;
    })
    .filter(Boolean) as TdfLine[];

  const readWarnings: string[] = [];
  if (meta.termsError || meta.localItems) {
    const read = [meta.localItems ? 'kalemler' : '', meta.termsFromText ? 'şartlar' : ''].filter(Boolean).join(' ve ');
    const head = meta.termsError ? `Yapay zekâ kullanılamadı: ${meta.termsError}.` : 'Kalemler yapay zekâ olmadan okundu.';
    readWarnings.push(read
      ? `${head} ${read.charAt(0).toUpperCase()}${read.slice(1)} belge metninden okundu; ad, miktar, fiyat ve şartları kontrol edin.`
      : `${head} Ticari şartlar otomatik okunamadı; kutuları seçerek doldurun.`);
  }
  const total = num(ex.totalAmount);
  const freight = num(ex.excludedFreightGrossAmount);
  const linesSum = lines.reduce((a, l) => a + (l.totalPrice || l.quantity * l.unitPrice), 0);
  if (total > 0 && linesSum > 0 && Math.abs(total - freight - linesSum) / total > 0.01) {
    readWarnings.push(`Kalemlerin toplamı (${Math.round(linesSum).toLocaleString('ru-RU')} ₽) belge toplamını (${Math.round(total).toLocaleString('ru-RU')} ₽) tutmuyor.`);
  }
  if (!lines.length) readWarnings.push('Belgeden kalem okunamadı; kalemler elle eklenmeli.');
  (terms?.notes || []).map(str).filter(Boolean).slice(0, 3).forEach(n => readWarnings.push(n));

  const supplier = str(ex.supplier) || str(terms?.supplier) || 'Tedarikçi (okunamadı)';
  const offer: Omit<TdfOffer, 'id'> = {
    supplier,
    inn: str(ex.taxId) || str(terms?.inn) || undefined,
    docNumber: str(ex.invoiceNumber) || str(terms?.docNumber) || undefined,
    docDate: isoDate(ex.date) || isoDate(terms?.docDate) || undefined,
    fileName: meta.fileName,
    fileUrl: meta.fileUrl,
    currency: str(ex.currency) || 'RUB',
    totalAmount: total || undefined,
    freightAmount: freight || undefined,
    terms: t,
    lines,
    readWarnings,
    createdAt: meta.nowIso
  };
  return offer;
}

// ---------------------------------------------------------------------------
// Fatura arşivinden geçmiş (firma ve son alış fiyatı)
// ---------------------------------------------------------------------------

export function buildTdfHistory(form: TdfForm, computed: TdfComputed, invoices: any[], nowIso: string): TdfHistory {
  const vendors: TdfHistory['vendors'] = {};
  const supplierKeys = new Set(computed.suppliers.map(s => s.key));
  const matKeyIndex = new Map<string, string>(); // satır adı anahtarı -> malzeme anahtarı
  for (const m of computed.materials) {
    Object.values(m.cells).forEach(c => { if (c) matKeyIndex.set(tdfMaterialKey(c.name), m.key); });
    matKeyIndex.set(tdfMaterialKey(m.name), m.key);
  }
  const lastPrices: TdfHistory['lastPrices'] = {};
  for (const inv of invoices || []) {
    if (!inv || inv.isDeleted) continue;
    const supplier = str(inv.supplier) || str(inv.vendorName);
    const date = isoDate(inv.date) || isoDate(inv.created_at);
    const sk = supplierKeyOf({ supplier } as TdfOffer);
    if (supplierKeys.has(sk)) {
      const v = vendors[sk] || (vendors[sk] = { invoiceCount: 0, totalAmount: 0 });
      v.invoiceCount++;
      v.totalAmount += num(inv.totalAmount);
      if (date && (!v.firstDate || date < v.firstDate)) v.firstDate = date;
      if (date && (!v.lastDate || date > v.lastDate)) v.lastDate = date;
    }
    for (const it of Array.isArray(inv.items) ? inv.items : []) {
      const names = [str(it.originalName), str(it.materialName)].filter(Boolean);
      let mk: string | undefined;
      for (const n of names) { mk = matKeyIndex.get(tdfMaterialKey(n)); if (mk) break; }
      if (!mk) continue;
      const row = computed.materials.find(m => m.key === mk)!;
      const u = canonicalUnit(it.unit);
      let factor: number | null = u === row.unit ? 1 : (u === 'kg' && row.unit === 't' ? 1000 : (u === 't' && row.unit === 'kg' ? 0.001 : null));
      if (factor === null) continue;
      const price = comparisonUnitPriceOfItem(it) * factor;
      if (!(price > 0)) continue;
      const prev = lastPrices[mk];
      if (!prev || (date && date > prev.date)) {
        lastPrices[mk] = { unitPrice: Math.round(price * 100) / 100, unit: row.unit, date: date || '', supplier, invoiceNumber: str(inv.invoiceNumber) || undefined };
      }
    }
  }
  Object.values(vendors).forEach(v => { v.totalAmount = Math.round(v.totalAmount * 100) / 100; });
  return { builtAt: nowIso, vendors, lastPrices };
}

// ---------------------------------------------------------------------------
// Gemini çağrıları (canlı ortamda; testlerde deps ile değiştirilir)
// ---------------------------------------------------------------------------

const TERMS_PROMPT = `Sen bir satınalma uzmanısın. Ekteki belge bir tedarikçi teklifi, KP (коммерческое предложение), fatura (счёт) veya spesifikasyondur.
Sadece ticari şartları çıkar. Belgede yoksa alanı boş bırak, asla tahmin etme.
Metin alanlarına (payment, delivery, deliveryPlace, validity, warranty) belgede yazan ifadeyi kısa ve belgedeki dilde yaz (ör. "30 дн. от даты отгрузки", "в наличии", "доставка на объект", "5 банковских дней").
Yapılandırılmış alanlar:
- paymentMode: "advance" (ön ödeme / предоплата / аванс, kısmi avans dahil) veya "deferred" (отсрочка / постоплата / по факту). advancePercent: avans yüzdesi (yazmıyorsa 100). paymentDays: vade günü.
  "Счёт на оплату" ise ve başka şart yazmıyorsa paymentMode "advance", advancePercent 100.
- inStock: "в наличии" / stokta ise true. deliveryDays: teslim/sevk süresi gün olarak (hafta yazıyorsa ×7).
- deliveryPlaceType: "site" (şantiyeye / objeye teslim, доставка до объекта, цена с доставкой) veya "factory" (самовывоз, склад/завод поставщика, EXW).
- validityDays: teklif/fatura geçerlilik süresi gün olarak.
Aynı şart belgede iki farklı şekilde yazıyorsa (ör. bir yerde 30 gün, başka yerde 45 gün) "conflicts" içine Türkçe kısa açıklama yaz.
Kalem bazında farklı teslim süresi yazıyorsa "lineDelivery" listesine kalem adını belgedeki gibi ve teslim bilgisini yaz.
notes = siparişi etkileyen önemli dipnotlar (tolerans, minimum sipariş, fiyat değişebilir vb.), Türkçe, en fazla 3.
Sadece şu JSON'u döndür:
{"supplier":"","inn":"","docNumber":"","docDate":"YYYY-MM-DD","payment":"","paymentMode":"","advancePercent":null,"paymentDays":null,"delivery":"","inStock":false,"deliveryDays":null,"deliveryPlace":"","deliveryPlaceType":"","validity":"","validityDays":null,"warranty":"","conflicts":{},"lineDelivery":[{"name":"","delivery":""}],"notes":[]}`;

/** Belgenin metin katmanı (PDF) veya tablo metni; yapay zekâ çalışmazsa şartlar buradan okunur. */
async function documentText(input: TdfReadInput): Promise<string> {
  const parts = [input.excelCsv, input.fileTextContext].filter(Boolean) as string[];
  try {
    const { inspectAndNormalizeDocumentInput } = await import('./aiOcrEngine');
    const norm = inspectAndNormalizeDocumentInput(input.fileBase64, input.mimeType, input.fileName);
    if (norm.extractedExcelCsv) parts.push(norm.extractedExcelCsv);
    if (norm.isPdf && norm.cleanBase64) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: Buffer.from(norm.cleanBase64, 'base64') });
      const out = await parser.getText();
      await parser.destroy().catch(() => undefined);
      if (out?.text) parts.push(out.text);
    }
  } catch { /* metin katmanı yoksa boş döner */ }
  return parts.join('\n\n').slice(0, 60000);
}

async function extractTermsWithAi(input: TdfReadInput): Promise<ExtractedTerms> {
  const { getGenAI, generateContentWithResilience, robustParseJSON, inspectAndNormalizeDocumentInput } = await import('./aiOcrEngine');
  const ai = getGenAI();
  const norm = inspectAndNormalizeDocumentInput(input.fileBase64, input.mimeType, input.fileName);
  const parts: any[] = [];
  const text = [input.excelCsv, input.fileTextContext, norm.extractedExcelCsv].filter(Boolean).join('\n\n').slice(0, 60000);
  if (norm.isSupportedVision && norm.cleanBase64 && Buffer.from(norm.cleanBase64, 'base64').length < 18 * 1024 * 1024) {
    parts.push({ inlineData: { data: norm.cleanBase64, mimeType: norm.mimeType } });
  }
  if (text) parts.push({ text: `BELGE METNİ / TABLO:\n${text}` });
  if (!parts.length) throw new Error('belge içeriği yok');
  parts.push({ text: TERMS_PROMPT });
  const { text: out } = await generateContentWithResilience(ai, {
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0 },
    validateText: (t: string) => /\{/.test(t)
  });
  const parsed = robustParseJSON(out) || {};
  return parsed as ExtractedTerms;
}

export async function readOfferWithAi(input: TdfReadInput, nowIso: string, meta: { fileUrl?: string } = {}): Promise<Omit<TdfOffer, 'id'>> {
  const { processInvoiceTwoStages } = await import('./aiTwoStageOcr');
  const [ocr, terms] = await Promise.allSettled([
    processInvoiceTwoStages({
      base64Input: input.fileBase64,
      mimeType: input.mimeType,
      excelCsv: input.excelCsv,
      fileTextContext: input.fileTextContext,
      fileName: input.fileName,
      scanMode: 'full',
      offerType: 'final',
      additionalPrompt: 'Bu belge bir tedarikçi teklifidir (KP / счёт / спецификация). Teklif değerlendirme formu için bütün kalemleri eksiksiz çıkar; kalem adlarını belgedeki gibi yaz, marka/model ve teknik özellikleri (sınıf, çap, boy, RAL, yoğunluk, kalınlık) kaybetme.'
    }),
    extractTermsWithAi(input)
  ]);
  // Yapay zekâ hiç çalışmazsa (anahtar yok, limit dolu) kalemler belge metninden basit okumayla çıkarılır
  let extracted: any;
  let localItems = false;
  let text: string | null = null;
  if (ocr.status === 'fulfilled') {
    extracted = ocr.value.extracted;
    localItems = /local/.test(String(ocr.value.usedModel || ''));
  } else {
    text = await documentText(input);
    const { fallbackExtractInvoiceFromTextOrCsv } = await import('./aiTwoStageOcr');
    const local = text ? fallbackExtractInvoiceFromTextOrCsv(text, input.fileName, false) : null;
    if (!local || !(Array.isArray(local.items) && local.items.length)) throw new Error(`Teklif okunamadı: ${friendlyAiError(ocr.reason)}`);
    extracted = local;
    localItems = true;
  }
  let termsValue: ExtractedTerms | null = terms.status === 'fulfilled' ? terms.value : null;
  let termsFromText = false;
  if (!termsValue) {
    const local = localTermsFromText(text ?? await documentText(input));
    if (Object.keys(local).length) { termsValue = local; termsFromText = true; }
  }
  return offerFromExtracted(extracted, termsValue, {
    fileName: input.fileName,
    fileUrl: meta.fileUrl,
    nowIso,
    termsError: terms.status === 'rejected' ? friendlyAiError(terms.reason) : undefined,
    termsFromText,
    localItems
  });
}

export function buildAiReviewPrompt(form: TdfForm, computed: TdfComputed): string {
  const sup = computed.suppliers.map(s => ({
    key: s.key, name: s.name, inn: s.offer.inn || '', total: Math.round(s.total), covered: s.covered,
    terms: Object.fromEntries(TDF_TERM_KEYS.map(k => [k, s.offer.terms?.[k]?.value || ''])), note: s.offer.note || ''
  }));
  const mats = computed.materials.map(m => ({
    key: m.key, name: m.name, unit: m.unit, qty: m.orderQty, brands: m.brands,
    offers: Object.fromEntries(computed.suppliers.filter(s => m.cells[s.key]).map(s => [shortSupplierName(s.name), { offered: m.cells[s.key]!.name, brand: m.cells[s.key]!.brand || '', price: Math.round(m.cells[s.key]!.unitPrice) }]))
  }));
  return `Sen deneyimli bir inşaat satınalma uzmanısın (Rusya, Moskova; ГОСТ/СП standartları). Aşağıda bir teklif değerlendirme formunun verisi var.
Görevlerin:
1) "summary": Satınalma müdürüne 2-4 cümlelik Türkçe yorum: hangi teklif neden öne çıkıyor, nelere dikkat edilmeli. Rakamları veriden al, uydurma.
2) "qualityNotes": Malzeme anahtarı -> Türkçe kalite yorumu (1-3 cümle). Malzemenin ilgili ГОСТ/ТУ'su, sınıf/kalınlık/yoğunluk/RAL gibi özelliklerin anlamı, firmaların teklif ettiği ürünler arasında teknik fark veya muadil riski. Aynı türden kalemleri tek yorumda toplayabilirsin (anahtar olarak ilk kalemin anahtarını kullan).
2b) "materialInsights": Malzeme anahtarı -> {"product":"ürün hakkında kısa bilgi (ne işe yarar, şantiyede dikkat edilecek özellik)","brand":"teklif edilen marka/üretici hakkında bilgi (üretici, menşei, piyasadaki bilinirliği); marka yoksa boş","notes":"satınalmacının bilmesi gerekenler (sertifika, muadil, sık görülen kalite sorunları)","sources":["url"]}. Türkçe, her alan en fazla 2 cümle. Marka/üretici bilgisini Google aramasıyla doğrula; bulamazsan "brand" boş kalsın.
3) "extraWarnings": Kurallarla yakalanmamış önemli riskler (ör. farklı sınıf/kalınlık/yoğunluk/renk, muadil marka, eksik sertifika, gerçek dışı düşük fiyat). Her biri {"level":"critical|warning|info","text":"...","action":"..."}; en fazla 6, Türkçe.
4) "vendorChecks": Firma anahtarı -> {"status":"faaliyette / tasfiye ...","founded":"yıl","capital":"","risk":"düşük|orta|yüksek|bilinmiyor","notes":"mahkeme davaları, vergi borcu, faaliyet alanı gibi önemli bulgular","reviews":"müşteri yorumlarının kısa özeti (Yandex Haritalar, 2GIS, otzovik vb.); yorum yoksa boş","sources":["url"]}. Bunu SADECE Google aramasında bulduğun kaynaklara dayanarak doldur (rusprofile, list-org, checko, zachestnyibiznes, egrul.nalog.ru, yandex, 2gis vb.). Kaynak bulamazsan risk "bilinmiyor" ve notes "Kaynak bulunamadı" yaz, tahmin etme.
5) "sources": Kullandığın kaynak URL'leri.
Sadece JSON döndür: {"summary":"","qualityNotes":{},"materialInsights":{},"extraWarnings":[],"vendorChecks":{},"sources":[]}

FORM: ${JSON.stringify({ title: form.title, jobsite: form.jobsiteName || '', address: form.address || '' })}
FİRMALAR: ${JSON.stringify(sup)}
KALEMLER: ${JSON.stringify(mats).slice(0, 40000)}
SİSTEMİN BULDUĞU UYARILAR: ${JSON.stringify(computed.warnings.map(w => w.text)).slice(0, 6000)}`;
}

export function sanitizeAiReview(raw: any, form: TdfForm, computed: TdfComputed, model?: string, nowIso?: string): TdfAiReview {
  const matKeys = new Set(computed.materials.map(m => m.key));
  const supKeys = new Set(computed.suppliers.map(s => s.key));
  const levels: TdfWarningLevel[] = ['critical', 'warning', 'info'];
  const qualityNotes: Record<string, string> = {};
  Object.entries(raw?.qualityNotes || {}).forEach(([k, v]) => {
    const text = str(v);
    if (!text) return;
    // anahtar birebir değilse adı benzeyen kaleme bağla, yoksa başlık olarak kalsın
    const key = matKeys.has(k) ? k : (computed.materials.find(m => m.name === k || tdfMaterialKey(m.name) === tdfMaterialKey(k))?.key || k);
    qualityNotes[key] = text.slice(0, 1200);
  });
  const extraWarnings = (Array.isArray(raw?.extraWarnings) ? raw.extraWarnings : [])
    .map((w: any) => ({ level: (levels.includes(w?.level) ? w.level : 'info') as TdfWarningLevel, text: str(w?.text).slice(0, 400), action: str(w?.action).slice(0, 300) }))
    .filter((w: any) => w.text)
    .slice(0, 6)
    .map((w: any) => ({ ...w, text: `${w.text} (yapay zekâ)` }));
  const materialInsights: NonNullable<TdfAiReview['materialInsights']> = {};
  Object.entries(raw?.materialInsights || {}).forEach(([k, v]: [string, any]) => {
    if (!v || typeof v !== 'object') return;
    const key = matKeys.has(k) ? k : computed.materials.find(m => m.name === k || tdfMaterialKey(m.name) === tdfMaterialKey(k))?.key;
    if (!key) return;
    const item = {
      product: str(v.product).slice(0, 400), brand: str(v.brand).slice(0, 400), notes: str(v.notes).slice(0, 400),
      sources: (Array.isArray(v.sources) ? v.sources : []).map(str).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 4)
    };
    if (item.product || item.brand || item.notes) materialInsights[key] = item;
  });
  const vendorChecks: NonNullable<TdfAiReview['vendorChecks']> = {};
  Object.entries(raw?.vendorChecks || {}).forEach(([k, v]: [string, any]) => {
    const key = supKeys.has(k) ? k : (computed.suppliers.find(s => s.name === k || shortSupplierName(s.name) === k || supplierKeyOf({ supplier: k } as TdfOffer) === s.key)?.key);
    if (!key || !v) return;
    const sources = (Array.isArray(v.sources) ? v.sources : []).map(str).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 5);
    vendorChecks[key] = {
      status: str(v.status).slice(0, 120), founded: str(v.founded).slice(0, 40), capital: str(v.capital).slice(0, 60),
      // kaynaksız risk değerlendirmesi gösterilmez
      risk: sources.length ? str(v.risk).slice(0, 40) : 'bilinmiyor',
      notes: (sources.length ? str(v.notes) : 'Kaynak bulunamadı; bilgi doğrulanmadı.').slice(0, 500),
      reviews: sources.length ? str(v.reviews).slice(0, 500) : '',
      sources
    };
  });
  const sources = (Array.isArray(raw?.sources) ? raw.sources : []).map(str).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 12);
  return { generatedAt: nowIso || new Date().toISOString(), model, summary: str(raw?.summary).slice(0, 1500), qualityNotes, materialInsights, extraWarnings, vendorChecks, sources };
}

async function reviewWithAi(form: TdfForm, computed: TdfComputed): Promise<TdfAiReview> {
  const { getGenAI, generateContentWithResilience, robustParseJSON } = await import('./aiOcrEngine');
  const ai = getGenAI();
  const prompt = buildAiReviewPrompt(form, computed);
  const call = (withSearch: boolean) => generateContentWithResilience(ai, {
    contents: [{ role: 'user', parts: [{ text: withSearch ? prompt : `${prompt}\n\nNOT: Bu çalışmada internet araması yok. vendorChecks ve kaynak isteyen alanları boş bırak; kalite yorumlarını genel bilginle yaz.` }] }],
    config: withSearch ? { tools: [{ googleSearch: {} }], temperature: 0.2 } : { responseMimeType: 'application/json', temperature: 0.2 },
    validateText: (t: string) => /\{/.test(t)
  });
  let res;
  try {
    res = await call(true);
  } catch (e: any) {
    // Harcama limiti / anahtar hatasında aramasız deneme de başarısız olur; diğer hatalarda aramasız tekrar dene
    if (/spending cap|billing|api[_ ]?key|ortam değişkeni/i.test(String(e?.message || e))) throw e;
    res = await call(false);
  }
  return sanitizeAiReview(robustParseJSON(res.text) || {}, form, computed, res.usedModel);
}

// ---------------------------------------------------------------------------
// Yapay zekâ ile kalem eşleştirme (farklı firmaların aynı ürünü tek satır)
// ---------------------------------------------------------------------------

export function buildAiMatchPrompt(form: TdfForm, computed: TdfComputed): string {
  const lines = computed.suppliers.flatMap(s => (s.offer.lines || []).filter(l => !form.materialOverrides?.[l.id]).map(l => ({
    id: l.id, firma: shortSupplierName(s.name), ad: l.name, marka: l.brand || '', birim: l.unit, miktar: l.quantity
  })));
  return `Sen inşaat malzemesi uzmanısın. Aşağıda farklı firmaların tekliflerindeki kalemler var. Aynı ürünü (aynı cins, aynı ölçü/kalınlık/sınıf/ebat) teklif eden satırları gruplandır.
Kurallar:
- Farklı ölçü, kalınlık, sınıf, ebat, yoğunluk veya renk = farklı ürün; asla aynı gruba koyma.
- Aynı firmanın iki satırı aynı gruba girmez.
- Yazım farkı, kısaltma, kelime sırası, marka adının eklenmesi aynı ürünü değiştirmez.
- Her grup için "name": ürünün kısa, tam adı Rusça (cins + ana özellikler + varsa marka), ör. "Фанера ФСФ 18 мм 1525×1525, сорт 2/2".
- Eşi olmayan satırları da tek başına grup olarak yaz.
Sadece JSON döndür: {"groups":[{"lineIds":["..."],"name":"..."}]}

KALEMLER: ${JSON.stringify(lines).slice(0, 40000)}`;
}

async function matchWithAi(form: TdfForm, computed: TdfComputed): Promise<TdfAiMatchResult> {
  const { getGenAI, generateContentWithResilience, robustParseJSON } = await import('./aiOcrEngine');
  const { text, usedModel } = await generateContentWithResilience(getGenAI(), {
    contents: [{ role: 'user', parts: [{ text: buildAiMatchPrompt(form, computed) }] }],
    config: { responseMimeType: 'application/json', temperature: 0 },
    validateText: (t: string) => /groups/.test(t)
  });
  const parsed = robustParseJSON(text) || {};
  return { groups: Array.isArray(parsed.groups) ? parsed.groups : [], model: usedModel };
}

/**
 * Yapay zekâ gruplarını forma uygular. Güvenlik: aynı firmadan iki satır veya teknik farkı olan satırlar
 * aynı gruba konmuşsa o grup yok sayılır; elle yapılan eşleştirmelere dokunulmaz.
 */
export function applyAiMatch(form: TdfForm, result: TdfAiMatchResult, nowIso: string): TdfForm {
  const c = computeTdf({ ...form, aiGroups: {}, aiNames: {} });
  const lineInfo = new Map<string, { supplierKey: string; name: string }>();
  c.suppliers.forEach(s => (s.offer.lines || []).forEach(l => lineInfo.set(l.id, { supplierKey: s.key, name: l.name })));
  const aiGroups: Record<string, string> = {};
  const aiNames: Record<string, string> = {};
  for (const g of result.groups || []) {
    const ids = (Array.isArray(g?.lineIds) ? g.lineIds : []).map(str).filter(id => lineInfo.has(id) && !form.materialOverrides?.[id]);
    if (ids.length < 2) continue;
    const sups = ids.map(id => lineInfo.get(id)!.supplierKey);
    if (new Set(sups).size !== sups.length) continue;
    const specs = ids.map(id => extractTdfSpecs(lineInfo.get(id)!.name));
    if (specs.some((a, i) => specs.some((b, j) => j > i && specDifferences(a, b).length > 0))) continue;
    const key = `ai:${tdfMaterialKey(lineInfo.get(ids[0])!.name) || ids[0]}`;
    ids.forEach(id => { aiGroups[id] = key; });
    const name = str(g.name).slice(0, 200);
    if (name) aiNames[key] = name;
  }
  form.aiGroups = aiGroups;
  form.aiNames = aiNames;
  form.aiMatchedAt = nowIso;
  delete form.aiMatchError;
  return form;
}

// ---------------------------------------------------------------------------
// Kayıt (Firestore + bellek + yerel yedek)
// ---------------------------------------------------------------------------

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function createTdfStore(deps: TdfDeps) {
  const mem = new Map<string, TdfForm>();
  const locks = new Map<string, Promise<unknown>>();
  let loaded = false;
  const log = deps.log || console;

  const saveBackup = () => {
    if (!deps.backupFile) return;
    try {
      fs.mkdirSync(path.dirname(deps.backupFile), { recursive: true });
      fs.writeFileSync(deps.backupFile, JSON.stringify([...mem.values()]), 'utf8');
    } catch (e: any) { log.warn('[TDF] yerel yedek yazılamadı:', e.message); }
  };

  async function load() {
    if (loaded) return;
    if (deps.backupFile && fs.existsSync(deps.backupFile)) {
      try { (JSON.parse(fs.readFileSync(deps.backupFile, 'utf8')) as TdfForm[]).forEach(f => f?.id && mem.set(f.id, f)); } catch { /* bozuk yedek yok sayılır */ }
    }
    const db = deps.getDb();
    if (db) {
      try {
        const snap = await getDocs(collection(db, TDF_COLLECTION));
        snap.forEach((d: any) => { const f = d.data() as TdfForm; if (f?.id) mem.set(f.id, f); });
      } catch (e: any) { log.warn('[TDF] Firestore okunamadı, bellekteki kayıtlar kullanılıyor:', e.message); }
    }
    loaded = true;
  }

  async function persist(form: TdfForm) {
    mem.set(form.id, form);
    saveBackup();
    const db = deps.getDb();
    if (db) await setDoc(doc(db, TDF_COLLECTION, form.id), clean(form));
  }

  async function list(): Promise<TdfForm[]> { await load(); return [...mem.values()].filter(f => !f.isDeleted); }
  async function get(id: string): Promise<TdfForm | undefined> { await load(); const f = mem.get(id); return f && !f.isDeleted ? f : undefined; }

  /** Aynı form üzerindeki değişiklikleri sıraya koyar (aynı anda yüklenen dosyalar birbirini ezmesin). */
  async function mutate(id: string, fn: (f: TdfForm) => TdfForm | void): Promise<TdfForm | undefined> {
    await load();
    const prev = locks.get(id) || Promise.resolve();
    let result: TdfForm | undefined;
    const next = prev.catch(() => undefined).then(async () => {
      const cur = mem.get(id);
      if (!cur || cur.isDeleted) { result = undefined; return; }
      const copy: TdfForm = clean(cur);
      const out = fn(copy) || copy;
      out.updatedAt = (deps.now ? deps.now() : new Date()).toISOString();
      await persist(out);
      result = out;
    });
    locks.set(id, next);
    try { await next; } finally { if (locks.get(id) === next) locks.delete(id); }
    return result;
  }

  async function create(data: Partial<TdfForm>): Promise<TdfForm> {
    await load();
    const now = (deps.now ? deps.now() : new Date());
    const nowIso = now.toISOString();
    const code = nextTdfCode([...mem.values()].map(f => f.code), now.getFullYear());
    const form: TdfForm = {
      id: `tdf_${now.getTime()}_${crypto.randomBytes(3).toString('hex')}`,
      code,
      title: str(data.title) || 'Yeni teklif değerlendirmesi',
      jobsiteId: str(data.jobsiteId) || undefined,
      jobsiteName: str(data.jobsiteName) || undefined,
      address: str(data.address) || undefined,
      requestNumbers: str(data.requestNumbers) || undefined,
      createdBy: str(data.createdBy) || undefined,
      status: 'draft',
      createdAt: nowIso,
      updatedAt: nowIso,
      offers: []
    };
    await persist(form);
    return form;
  }

  return { list, get, mutate, create, _mem: mem };
}

// ---------------------------------------------------------------------------
// Rotalar
// ---------------------------------------------------------------------------

const EDITABLE_FORM_FIELDS = ['title', 'jobsiteId', 'jobsiteName', 'address', 'requestNumbers', 'status', 'materialOverrides', 'aiGroups', 'orderQty', 'materialNames', 'qualityNotes', 'weights', 'recommendationNote'] as const;
const EDITABLE_OFFER_FIELDS = ['supplier', 'inn', 'docNumber', 'docDate', 'terms', 'note', 'noteBy', 'noteAt', 'lines', 'freightAmount'] as const;

export function summarizeTdf(form: TdfForm, computed: TdfComputed) {
  return {
    id: form.id, code: form.code, title: form.title, jobsiteName: form.jobsiteName || '', status: form.status,
    createdAt: form.createdAt, updatedAt: form.updatedAt, offerCount: form.offers.length,
    suppliers: computed.suppliers.map(s => shortSupplierName(s.name)),
    materialCount: computed.materials.length,
    planTotal: computed.recommendation?.planTotal ?? null,
    criticalCount: computed.warnings.filter(w => w.level === 'critical').length
  };
}

export function registerTdfRoutes(app: Express, deps: TdfDeps) {
  const store = createTdfStore(deps);
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  const today = () => nowIso().slice(0, 10);
  const readOffer = deps.readOffer || ((input: TdfReadInput) => readOfferWithAi(input, nowIso(), {}));
  const aiReview = deps.aiReview || reviewWithAi;
  const aiMatch = deps.aiMatch || matchWithAi;
  const respond = (res: Response, form: TdfForm) => res.json({ form, computed: computeTdf(form, today()) });
  const fail = (res: Response, e: any, status = 500) => { (deps.log || console).warn('[TDF]', e?.message || e); res.status(status).json({ error: String(e?.message || e) }); };
  const failAi = (res: Response, e: any) => { (deps.log || console).warn('[TDF] yapay zekâ:', e?.message || e); res.status(502).json({ error: friendlyAiError(e) }); };

  /** İki veya daha fazla firma varsa kalemleri yapay zekâyla eşleştirir; hata olursa kurallı eşleştirme geçerli kalır. */
  async function runAiMatch(id: string) {
    const f0 = await store.get(id);
    if (!f0) return;
    const c0 = computeTdf(f0, today());
    if (c0.suppliers.length < 2) return;
    try {
      const result = await aiMatch(f0, c0);
      await store.mutate(id, f => { applyAiMatch(f, result, nowIso()); });
    } catch (e: any) {
      (deps.log || console).warn('[TDF] yapay zekâ eşleştirmesi yapılamadı:', e?.message || e);
      await store.mutate(id, f => { f.aiMatchError = friendlyAiError(e); });
    }
  }

  async function refreshHistory(id: string) {
    if (!deps.getInvoices) return;
    try {
      const invoices = await deps.getInvoices();
      await store.mutate(id, f => { f.history = buildTdfHistory(f, computeTdf(f, today()), invoices, nowIso()); });
    } catch (e: any) { (deps.log || console).warn('[TDF] geçmiş alımlar okunamadı:', e.message); }
  }

  app.get('/api/tdf', async (_req: Request, res: Response) => {
    try {
      const forms = await store.list();
      forms.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      res.json(forms.map(f => summarizeTdf(f, computeTdf(f, today()))));
    } catch (e) { fail(res, e); }
  });

  app.post('/api/tdf', async (req: Request, res: Response) => {
    try { respond(res, await store.create(req.body || {})); } catch (e) { fail(res, e); }
  });

  app.get('/api/tdf/:id', async (req: Request, res: Response) => {
    try {
      const f = await store.get(req.params.id);
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      respond(res, f);
    } catch (e) { fail(res, e); }
  });

  app.put('/api/tdf/:id', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const f = await store.mutate(req.params.id, form => {
        for (const k of EDITABLE_FORM_FIELDS) if (k in body) (form as any)[k] = body[k];
        if (Array.isArray(body.offers)) {
          // sadece düzenlenebilir alanlar; teklif listesi ekle/sil ayrı rotalarda
          for (const patch of body.offers) {
            const o = form.offers.find(x => x.id === patch?.id);
            if (!o) continue;
            for (const k of EDITABLE_OFFER_FIELDS) if (k in patch) (o as any)[k] = patch[k];
          }
        }
      });
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      respond(res, f);
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/tdf/:id', async (req: Request, res: Response) => {
    try {
      const f = await store.mutate(req.params.id, form => { form.isDeleted = true; form.deletedAt = nowIso(); });
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      res.json({ success: true });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/tdf/:id/offers', async (req: Request, res: Response) => {
    try {
      const id = req.params.id;
      if (!(await store.get(id))) return res.status(404).json({ error: 'TDF bulunamadı' });
      const body = req.body || {};
      let offer: TdfOffer;
      if (body.manual) {
        offer = { id: `of_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, supplier: str(body.supplier) || 'Yeni firma', terms: emptyTerms(), lines: [], createdAt: nowIso(), readWarnings: [] };
      } else {
        const input: TdfReadInput = { fileBase64: body.fileBase64, mimeType: body.mimeType, fileName: body.fileName, excelCsv: body.excelCsv, fileTextContext: body.fileTextContext };
        if (!input.fileBase64 && !input.excelCsv && !input.fileTextContext) return res.status(400).json({ error: 'Dosya verisi yok.' });
        let read: Omit<TdfOffer, 'id'>;
        try { read = await readOffer(input); } catch (e: any) { return res.status(422).json({ error: /Teklif okunamadı/.test(String(e?.message)) ? e.message : `Teklif okunamadı: ${friendlyAiError(e)}` }); }
        offer = { ...read, id: `of_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, fileUrl: str(body.fileUrl) || read.fileUrl, fileName: read.fileName || input.fileName };
      }
      const f = await store.mutate(id, form => { form.offers.push(clean(offer)); });
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      if (!body.manual) await runAiMatch(id);
      await refreshHistory(id);
      const latest = (await store.get(id))!;
      res.json({ form: latest, computed: computeTdf(latest, today()), offerId: offer.id });
    } catch (e) { fail(res, e, 422); }
  });

  app.delete('/api/tdf/:id/offers/:offerId', async (req: Request, res: Response) => {
    try {
      const f = await store.mutate(req.params.id, form => {
        const removed = form.offers.find(o => o.id === req.params.offerId);
        form.offers = form.offers.filter(o => o.id !== req.params.offerId);
        if (removed && form.materialOverrides) removed.lines.forEach(l => { delete form.materialOverrides![l.id]; });
      });
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      respond(res, f);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/tdf/:id/refresh-history', async (req: Request, res: Response) => {
    try {
      if (!(await store.get(req.params.id))) return res.status(404).json({ error: 'TDF bulunamadı' });
      await refreshHistory(req.params.id);
      respond(res, (await store.get(req.params.id))!);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/tdf/:id/ai-review', async (req: Request, res: Response) => {
    try {
      const f0 = await store.get(req.params.id);
      if (!f0) return res.status(404).json({ error: 'TDF bulunamadı' });
      if (!f0.offers.length) return res.status(400).json({ error: 'Önce teklif yükleyin.' });
      const base = clean(f0);
      delete base.ai; // önceki yapay zekâ uyarıları yeni değerlendirmeyi etkilemesin
      let review: TdfAiReview;
      try { review = await aiReview(base, computeTdf(base, today())); } catch (e) { return failAi(res, e); }
      const f = await store.mutate(req.params.id, form => { form.ai = review; });
      respond(res, f!);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/tdf/:id/ai-match', async (req: Request, res: Response) => {
    try {
      const f0 = await store.get(req.params.id);
      if (!f0) return res.status(404).json({ error: 'TDF bulunamadı' });
      const c0 = computeTdf(f0, today());
      if (c0.suppliers.length < 2) return res.status(400).json({ error: 'Eşleştirme için en az iki firmanın teklifi gerekli.' });
      let result: TdfAiMatchResult;
      try { result = await aiMatch(f0, c0); } catch (e) { return failAi(res, e); }
      const f = await store.mutate(req.params.id, form => { applyAiMatch(form, result, nowIso()); });
      respond(res, f!);
    } catch (e) { fail(res, e); }
  });

  app.get('/api/tdf/:id/export', async (req: Request, res: Response) => {
    try {
      const f = await store.get(req.params.id);
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
      const format = String(req.query.format || 'xlsx').toLowerCase();
      const safe = `${f.code}_${f.title}`.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 90);
      const computed = computeTdf(f, today());
      if (format === 'html') {
        const html = renderTdfHtml(f, { todayIso: today(), computed });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${f.code}.html"; filename*=UTF-8''${encodeURIComponent(safe)}.html`);
        return res.send(html);
      }
      const buf = await buildTdfXlsxBuffer(f, { todayIso: today(), computed });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${f.code}.xlsx"; filename*=UTF-8''${encodeURIComponent(safe)}.xlsx`);
      res.send(buf);
    } catch (e) { fail(res, e); }
  });

  return store;
}
