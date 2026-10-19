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
  computeTdf, emptyTerms, nextTdfCode, supplierKeyOf, tdfMaterialKey, canonicalUnit, shortSupplierName,
  TdfAiReview, TdfComputed, TdfForm, TdfHistory, TdfLine, TdfOffer, TdfTermKey, TDF_TERM_KEYS, TdfWarningLevel
} from '../src/utils/tdfEngine';
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
  backupFile?: string;
  now?: () => Date;
  log?: Pick<Console, 'log' | 'warn'>;
}

// ---------------------------------------------------------------------------
// Teklifi okunmuş fatura verisinden TDF teklifine çevirme (saf, test edilir)
// ---------------------------------------------------------------------------

export interface ExtractedTerms {
  supplier?: string; inn?: string; docNumber?: string; docDate?: string;
  payment?: string; delivery?: string; deliveryPlace?: string; validity?: string; installation?: string; warranty?: string;
  conflicts?: Partial<Record<TdfTermKey, string>>;
  lineDelivery?: Array<{ name?: string; delivery?: string }>;
  notes?: string[];
}

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'value' in (v as any) ? String((v as any).value ?? '') : String(v)).trim();
const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const isoDate = (v: unknown) => { const s = str(v); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };

export function offerFromExtracted(extracted: any, terms: ExtractedTerms | null, meta: { fileName?: string; fileUrl?: string; nowIso: string; termsError?: string }): Omit<TdfOffer, 'id'> {
  const ex = extracted || {};
  const t = emptyTerms();
  for (const k of TDF_TERM_KEYS) {
    const v = str((terms as any)?.[k]);
    if (v && !/^(не указ[а-яё]*|нет|отсутствует|null|none|n\/a|yok|belirtilmemiş|-+|—)\.?$/i.test(v)) t[k] = { value: v, source: 'offer' };
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
  if (meta.termsError) readWarnings.push(`Ticari şartlar otomatik okunamadı (${meta.termsError}); kutular elle doldurulmalı.`);
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
Sadece ticari şartları çıkar. Değerleri belgede yazdığı dilde ve kısa yaz (ör. "30 дн. от даты отгрузки", "в наличии", "доставка на объект", "5 банковских дней").
Belgede yoksa alanı boş string bırak, asla tahmin etme.
Aynı şart belgede iki farklı şekilde yazıyorsa (ör. bir yerde 30 gün, başka yerde 45 gün) "conflicts" içine Türkçe kısa açıklama yaz.
Kalem bazında farklı teslim süresi yazıyorsa "lineDelivery" listesine kalem adını belgedeki gibi ve teslim bilgisini yaz.
Sadece şu JSON'u döndür:
{"supplier":"","inn":"","docNumber":"","docDate":"YYYY-MM-DD","payment":"","delivery":"","deliveryPlace":"","validity":"","installation":"","warranty":"","conflicts":{},"lineDelivery":[{"name":"","delivery":""}],"notes":[]}
Alanlar: payment = ödeme şartı (avans, vade); delivery = teslim süresi/stok durumu; deliveryPlace = teslim yeri ve nakliye (dahil mi, depo mu, adres);
validity = teklif/fatura geçerlilik süresi; installation = montaj (dahil/değil); warranty = garanti; notes = siparişi etkileyen önemli dipnotlar (tolerans, minimum sipariş, fiyat değişebilir vb.), Türkçe, en fazla 3.`;

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
  if (ocr.status === 'rejected') throw new Error(`Teklif okunamadı: ${ocr.reason?.message || ocr.reason}`);
  return offerFromExtracted(ocr.value.extracted, terms.status === 'fulfilled' ? terms.value : null, {
    fileName: input.fileName,
    fileUrl: meta.fileUrl,
    nowIso,
    termsError: terms.status === 'rejected' ? String(terms.reason?.message || terms.reason).slice(0, 120) : undefined
  });
}

export function buildAiReviewPrompt(form: TdfForm, computed: TdfComputed): string {
  const sup = computed.suppliers.map(s => ({
    key: s.key, name: s.name, inn: s.offer.inn || '', total: Math.round(s.total), covered: s.covered,
    terms: Object.fromEntries(TDF_TERM_KEYS.map(k => [k, s.offer.terms?.[k]?.value || ''])), note: s.offer.note || ''
  }));
  const mats = computed.materials.map(m => ({
    key: m.key, name: m.name, unit: m.unit, qty: m.orderQty,
    offers: Object.fromEntries(computed.suppliers.filter(s => m.cells[s.key]).map(s => [shortSupplierName(s.name), { offered: m.cells[s.key]!.name, brand: m.cells[s.key]!.brand || '', price: Math.round(m.cells[s.key]!.unitPrice) }]))
  }));
  return `Sen deneyimli bir inşaat satınalma uzmanısın (Rusya, Moskova; ГОСТ/СП standartları). Aşağıda bir teklif değerlendirme formunun verisi var.
Görevlerin:
1) "summary": Satınalma müdürüne 2-4 cümlelik Türkçe yorum: hangi teklif neden öne çıkıyor, nelere dikkat edilmeli. Rakamları veriden al, uydurma.
2) "qualityNotes": Malzeme anahtarı -> Türkçe kalite yorumu (1-3 cümle). Malzemenin ilgili ГОСТ/ТУ'su, sınıf/kalınlık/yoğunluk/RAL gibi özelliklerin anlamı, firmaların teklif ettiği ürünler arasında teknik fark veya muadil riski. Aynı türden kalemleri tek yorumda toplayabilirsin (anahtar olarak ilk kalemin anahtarını kullan).
3) "extraWarnings": Kurallarla yakalanmamış önemli riskler (ör. farklı sınıf/kalınlık/yoğunluk/renk, muadil marka, eksik sertifika, gerçek dışı düşük fiyat). Her biri {"level":"critical|warning|info","text":"...","action":"..."}; en fazla 6, Türkçe.
4) "vendorChecks": Firma anahtarı -> {"status":"faaliyette / tasfiye ...","founded":"yıl","capital":"","risk":"düşük|orta|yüksek|bilinmiyor","notes":"","sources":["url"]}. Bunu SADECE Google aramasında bulduğun kaynaklara dayanarak doldur (rusprofile, list-org, checko, zachestnyibiznes, egrul.nalog.ru vb.). Kaynak bulamazsan risk "bilinmiyor" ve notes "Kaynak bulunamadı" yaz, tahmin etme.
5) "sources": Kullandığın kaynak URL'leri.
Sadece JSON döndür: {"summary":"","qualityNotes":{},"extraWarnings":[],"vendorChecks":{},"sources":[]}

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
      sources
    };
  });
  const sources = (Array.isArray(raw?.sources) ? raw.sources : []).map(str).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 12);
  return { generatedAt: nowIso || new Date().toISOString(), model, summary: str(raw?.summary).slice(0, 1500), qualityNotes, extraWarnings, vendorChecks, sources };
}

async function reviewWithAi(form: TdfForm, computed: TdfComputed): Promise<TdfAiReview> {
  const { getGenAI, generateContentWithResilience, robustParseJSON } = await import('./aiOcrEngine');
  const ai = getGenAI();
  const prompt = buildAiReviewPrompt(form, computed);
  const { text, usedModel } = await generateContentWithResilience(ai, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    validateText: (t: string) => /\{/.test(t)
  });
  return sanitizeAiReview(robustParseJSON(text) || {}, form, computed, usedModel);
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

const EDITABLE_FORM_FIELDS = ['title', 'jobsiteId', 'jobsiteName', 'address', 'requestNumbers', 'status', 'materialOverrides', 'orderQty', 'materialNames', 'qualityNotes', 'weights', 'recommendationNote'] as const;
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
  const respond = (res: Response, form: TdfForm) => res.json({ form, computed: computeTdf(form, today()) });
  const fail = (res: Response, e: any, status = 500) => { (deps.log || console).warn('[TDF]', e?.message || e); res.status(status).json({ error: String(e?.message || e) }); };

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
        const read = await readOffer(input);
        offer = { ...read, id: `of_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, fileUrl: str(body.fileUrl) || read.fileUrl, fileName: read.fileName || input.fileName };
      }
      const f = await store.mutate(id, form => { form.offers.push(clean(offer)); });
      if (!f) return res.status(404).json({ error: 'TDF bulunamadı' });
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
      const review = await aiReview(base, computeTdf(base, today()));
      const f = await store.mutate(req.params.id, form => { form.ai = review; });
      respond(res, f!);
    } catch (e) { fail(res, e, 502); }
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
