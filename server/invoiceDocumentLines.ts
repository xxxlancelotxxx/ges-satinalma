/**
 * Prizma faturalarının kalemlerini faturanın kendisinden (Счет на оплату PDF) kurar.
 *
 * Önceden kalemler yalnızca STF sipariş satırlarından geliyordu. Sipariş ≠ fatura:
 * tedarikçi ambalajı değiştirir, kalem ekler/çıkarır, metre siparişini adet faturalar.
 * Aradaki tutar farkı da "nakliye" diye etiketleniyordu. Bu modül:
 *  1. Fatura PDF'inin metin katmanını okur ve satırları çıkarır,
 *  2. Satırlar fatura tutarını kuruşu kuruşuna tutuyorsa kalemleri faturadan kurar,
 *  3. Tutmuyorsa STF satırlarını korur ama faturayı "doğrulanmadı" diye işaretler (fark uydurulmaz).
 */
import { PDFParse } from 'pdf-parse';
import { Type } from '@google/genai';
import { parseInvoiceText, verifyParsedInvoice, mapDocumentUnit, ParsedInvoiceDocument, ParsedInvoiceLine } from '../src/utils/invoiceLineParser';
import { normalizeCategoryName, translateRussianMaterialToTurkish } from '../src/utils/categoryClassifier';
import { getGenAI, robustParseJSON, generateContentWithResilience } from './aiOcrEngine';

export type InvoiceLineCheckStatus =
  | 'verified'            // kalemler fatura belgesinden okundu ve tutarı tutuyor
  | 'stf_matches_total'   // belge okunamadı ama STF satırları fatura tutarını tutuyor
  | 'mismatch';           // belge okunamadı ve STF satırları fatura tutarını tutmuyor

export interface InvoiceLineCheck {
  status: InvoiceLineCheckStatus;
  source: 'invoice_pdf' | 'stf_order';
  checkedAt: string;
  invoiceTotal: number;
  linesGrossSum: number;
  /** fatura tutarı − (kalemler + açık nakliye satırları), KDV dahil */
  diff: number;
  /** Bu sonucu üreten belge okuyucu sürümü; eski sürümle doğrulanamayan faturalar yeniden okunur */
  parserVersion?: number;
  fileId?: number;
  documentNote?: string;
}

export interface DocumentLinesResult {
  fileId?: number;
  verified: boolean;
  note: string;
  items?: any[];
  freightNet?: number;
  freightGross?: number;
  grossSum?: number;
  parserVersion?: number;
}

// 3: Kiril nakliye/hizmet satırı tespiti düzeltildi, AI okuması satır aritmetiğiyle doğrulanıyor,
//    doğrulanamayan faturalar yeni sürümle bir kez daha okunuyor.
export const CURRENT_DOC_LINES_PARSER_VERSION = 3;

// JS'te \b yalnızca Latin harflerde çalışır; Kiril kelime başı için açık sınır kullanılır
const FREIGHT_OR_SERVICE_RE = /(?:^|[^a-zа-яё0-9])(?:доставк[a-zа-яё]*|организация\s*доставк[a-zа-яё]*|грузоперевоз[a-zа-яё]*|перевозк[a-zа-яё]*|транспортн[a-zа-яё]+\s*(?:услуг|расход)[a-zа-яё]*|автоуслуг[a-zа-яё]*|манипулятор[a-zа-яё]*|логистик[a-zа-яё]*|погрузк[a-zа-яё]*|погрузочн[a-zа-яё]*|разгрузк[a-zа-яё]*|разгрузочн[a-zа-яё]*|такелаж[a-zа-яё]*|аренд[аы]|kiralama|услуг[аи]\s+по|работы\s+по|nakliye|teslimat\s*hizmet|kargo)/i;
const FREIGHT_EXCEPTION_RE = /шлифмашин|диск|круг|лента|шкурка|смесь|клей|раствор|состав|пен[аы]|пистолет|коробк|клин|дюбел|анкер|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер|блок|плит|пила|хомут|профиль|шина|паста/i;

export function isFreightOrServiceText(text: string): boolean {
  return FREIGHT_OR_SERVICE_RE.test(text) && !FREIGHT_EXCEPTION_RE.test(text);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const tokenize = (s: string) => new Set(
  String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').split(' ').filter(t => t.length >= 2)
);

/** STF satırındaki stok kodunu (materialCode) en çok benzeyen fatura satırına taşır. */
function bestStfMatch(name: string, stfItems: any[]): any | undefined {
  const a = tokenize(name);
  let best: any; let bestScore = 0;
  for (const it of stfItems || []) {
    const b = tokenize(`${it.originalName || ''} ${it.materialName || ''}`);
    if (!a.size || !b.size) continue;
    let inter = 0;
    a.forEach(t => { if (b.has(t)) inter++; });
    const score = inter / Math.min(a.size, b.size);
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 0.6 ? best : undefined;
}

export function buildItemsFromParsedInvoice(
  doc: ParsedInvoiceDocument,
  ctx: { docYear: string; stfItems?: any[] }
): { items: any[]; freightNet: number; freightGross: number } {
  const defaultVat = ctx.docYear === '2025' ? 20 : 22;
  const items: any[] = [];
  let freightNet = 0;
  let freightGross = 0;

  for (const line of doc.lines) {
    const vatPct = line.vatPct ?? doc.docVatPct ?? (doc.docVatAmount === 0 ? 0 : defaultVat);
    const grossAmt = round2(line.grossAmount);
    // Eğer satırda KDV oranı > 0 olmasına rağmen netAmount grossAmount'a eşit kalmışsa (belge dipnotunda KDV yüzdesi yazmadığı için),
    // net tutarı KDV oranına bölerek kesin olarak ayrıştır.
    const netAmt = (vatPct > 0 && Math.abs(line.netAmount - grossAmt) < 0.01)
      ? round2(grossAmt / (1 + vatPct / 100))
      : round2(line.netAmount);

    if (isFreightOrServiceText(line.name)) {
      freightNet += netAmt;
      freightGross += grossAmt;
      continue;
    }
    const qty = line.quantity || 1;
    const grossUnitPrice = round2(grossAmt / qty);
    const unitPriceNet = round2(netAmt / qty);
    const lineName = cleanDocumentLineName(line.name);
    const translated = translateRussianMaterialToTurkish(lineName) || lineName;
    const stf = bestStfMatch(lineName, ctx.stfItems || []);
    items.push({
      id: `inv_line_${line.no}`,
      materialName: translated,
      originalName: lineName,
      ...(stf?.materialCode ? { materialCode: stf.materialCode } : {}),
      ...(line.article ? { article: line.article } : {}),
      quantity: qty,
      unit: documentLineUnit(line.name, line.unitRaw),
      unitPrice: unitPriceNet,
      unitPriceNet,
      grossUnitPrice,
      totalPrice: netAmt,
      grossTotalPrice: grossAmt,
      vatPercentage: vatPct,
      isNetNormalized: true,
      lineSource: 'invoice_pdf',
      invoiceLineNo: line.no,
      category: normalizeCategoryName('', `${lineName} ${translated}`)
    });
  }
  // Bir STF stok kodu birden çok farklı fatura satırına eşleştiyse hiçbirine verilmez
  const shared = sharedDocumentCodes(items);
  const finalItems = shared.size ? items.map(({ materialCode, ...rest }) => (materialCode && !shared.has(materialCode) ? { ...rest, materialCode } : rest)) : items;
  return { items: finalItems, freightNet: round2(freightNet), freightGross: round2(freightGross) };
}

export async function extractPdfText(data: Buffer): Promise<string> {
  const parser = new PDFParse({ data });
  try {
    const r = await parser.getText();
    return r.text || '';
  } finally {
    await (parser as any).destroy?.().catch?.(() => {});
  }
}

export function readInvoiceDocumentText(
  text: string,
  ctx: { invoiceTotal: number; docYear: string; stfItems?: any[]; fileId?: number }
): DocumentLinesResult {
  const parsed = parseInvoiceText(text);
  const check = verifyParsedInvoice(parsed, ctx.invoiceTotal);
  if (!check.verified) {
    return {
      fileId: ctx.fileId,
      verified: false,
      note: check.reason || 'Belge doğrulanamadı',
      grossSum: check.grossSum,
      parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
    };
  }
  const built = buildItemsFromParsedInvoice(parsed, { docYear: ctx.docYear, stfItems: ctx.stfItems });
  return {
    fileId: ctx.fileId,
    verified: true,
    note: `${parsed.lines.length} kalem fatura belgesinden okundu`,
    items: built.items,
    freightNet: built.freightNet,
    freightGross: built.freightGross,
    grossSum: check.grossSum,
    parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
  };
}

/**
 * Metin katmanı olmayan (taranmış resim) veya karmaşık sütun düzenli PDF faturalarını
 * Gemini (gemini-2.5-flash) ile okur ve yalnızca fatura toplamını (expectedTotal)
 * aritmetik olarak tutturursa doğrulanmış kabul eder.
 */
export async function readInvoiceDocumentWithGemini(
  pdfBuffer: Buffer,
  ctx: { invoiceTotal: number; docYear: string; stfItems?: any[]; fileId?: number; mimeType?: string }
): Promise<DocumentLinesResult> {
  if (!pdfBuffer || pdfBuffer.length < 100 || pdfBuffer.length > 15 * 1024 * 1024) {
    return {
      fileId: ctx.fileId,
      verified: false,
      note: 'PDF boyutu AI okuma için uygun değil',
      parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
    };
  }
  const isPdf = pdfBuffer.subarray(0, 5).toString('latin1') === '%PDF-';
  const mimeType = isPdf ? 'application/pdf' : (ctx.mimeType || 'application/pdf');
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return {
      fileId: ctx.fileId,
      verified: false,
      note: `Desteklenmeyen belge formatı (${mimeType})`,
      parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
    };
  }

  try {
    const ai = getGenAI();
    const { text: resText } = await generateContentWithResilience(ai, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: pdfBuffer.toString('base64')
              }
            },
            {
              text: `Извлеки все товарные строки из этого счета на оплату / УПД.
Правила:
1. Поле "name" должно содержать точное оригинальное наименование товара на русском языке со всеми размерами (например, 1200х600х180 мм, плотность, марка).
2. Поле "unitRaw" должно содержать точную единицу измерения из таблицы (шт, м3, м2, уп, пог. м, кг, т, рул и т.д.).
3. Поле "pricesIncludeVat": true, если сумма строки ("Сумма") уже включает НДС ("В том числе НДС" или "Без НДС"); false, если НДС начисляется сверху на сумму строки.
4. Проверь арифметику: quantity * price = amount.
5. Не подгоняй числа: переписывай только то, что напечатано в документе.`
            }
          ]
        }
      ],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pricesIncludeVat: { type: Type.BOOLEAN },
            docVatPct: { type: Type.NUMBER },
            docVatAmount: { type: Type.NUMBER },
            totalWithVat: { type: Type.NUMBER },
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  no: { type: Type.INTEGER },
                  name: { type: Type.STRING },
                  article: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitRaw: { type: Type.STRING },
                  price: { type: Type.NUMBER },
                  amount: { type: Type.NUMBER },
                  vatPct: { type: Type.NUMBER },
                  vatAmount: { type: Type.NUMBER }
                },
                required: ['no', 'name', 'quantity', 'unitRaw', 'price', 'amount']
              }
            }
          },
          required: ['pricesIncludeVat', 'lines']
        }
      }
    });

    const rawJson = robustParseJSON(resText || '{}');
    if (!rawJson || !Array.isArray(rawJson.lines) || rawJson.lines.length === 0) {
      return {
        fileId: ctx.fileId,
        verified: false,
        note: 'AI belgede okunabilir kalem tablosu bulamadı',
        parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
      };
    }

    const defaultVat = ctx.docYear === '2025' ? 20 : 22;
    const pricesIncludeVat = typeof rawJson.pricesIncludeVat === 'boolean' ? rawJson.pricesIncludeVat : true;
    const docVatPct = typeof rawJson.docVatPct === 'number' && rawJson.docVatPct >= 0 ? rawJson.docVatPct : defaultVat;

    const parsedLines: ParsedInvoiceLine[] = rawJson.lines.map((l: any, idx: number) => {
      const qty = Number(l.quantity) || 1;
      const price = Number(l.price) || 0;
      const amount = Number(l.amount) || round2(qty * price);
      const vatPct = typeof l.vatPct === 'number' && l.vatPct >= 0 ? l.vatPct : docVatPct;
      const grossAmount = pricesIncludeVat ? amount : round2(amount * (1 + vatPct / 100));
      const netAmount = pricesIncludeVat
        ? (vatPct > 0 ? round2(amount / (1 + vatPct / 100)) : amount)
        : amount;
      return {
        no: Number(l.no) || idx + 1,
        name: String(l.name || '').trim(),
        ...(l.article ? { article: String(l.article).trim() } : {}),
        quantity: qty,
        unitRaw: String(l.unitRaw || 'шт').trim(),
        price,
        amount,
        vatPct,
        ...(typeof l.vatAmount === 'number' ? { vatAmount: l.vatAmount } : {}),
        grossAmount,
        netAmount
      };
    });

    // AI'ın okuduğu her satır kendi içinde tutarlı olmalı (miktar × fiyat = tutar); tutmayan belge kabul edilmez
    const badLine = parsedLines.find(l => !l.name || !(l.quantity > 0) || !(l.amount > 0) ||
      Math.abs(l.quantity * l.price - l.amount) > Math.max(1, l.amount * 0.01));
    if (badLine) {
      return {
        fileId: ctx.fileId,
        verified: false,
        note: `AI OCR satır ${badLine.no}: miktar × fiyat tutarı vermiyor`,
        parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
      };
    }

    const parsedDoc: ParsedInvoiceDocument = {
      lines: parsedLines,
      totalWithVat: typeof rawJson.totalWithVat === 'number' ? rawJson.totalWithVat : undefined,
      docVatAmount: typeof rawJson.docVatAmount === 'number' ? rawJson.docVatAmount : undefined,
      docVatPct,
      pricesIncludeVat,
      warnings: []
    };

    const check = verifyParsedInvoice(parsedDoc, ctx.invoiceTotal);
    if (!check.verified) {
      return {
        fileId: ctx.fileId,
        verified: false,
        note: `AI OCR toplam doğrulaması tutmadı: ${check.reason || ''}`,
        grossSum: check.grossSum,
        parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
      };
    }

    const built = buildItemsFromParsedInvoice(parsedDoc, { docYear: ctx.docYear, stfItems: ctx.stfItems });
    return {
      fileId: ctx.fileId,
      verified: true,
      note: `${parsedDoc.lines.length} kalem fatura belgesinden (AI OCR) doğrulandı`,
      items: built.items,
      freightNet: built.freightNet,
      freightGross: built.freightGross,
      grossSum: check.grossSum,
      parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
    };
  } catch (err: any) {
    return {
      fileId: ctx.fileId,
      verified: false,
      note: `AI OCR hatası: ${err.message || 'Bilinmeyen hata'}`,
      parserVersion: CURRENT_DOC_LINES_PARSER_VERSION
    };
  }
}

/**
 * Belgeden okunmuş kalemler arasında kalmış nakliye/hizmet satırlarını (eski sürümde Kiril tespiti
 * çalışmadığı için malzeme sayılanlar) nakliye toplamına taşır. Tutarlar belgedeki gibi kalır.
 */
export function splitFreightFromDocumentItems(items: any[]): { items: any[]; freightNet: number; freightGross: number; moved: number } {
  const kept: any[] = [];
  let freightNet = 0;
  let freightGross = 0;
  let moved = 0;
  for (const it of items || []) {
    if (it?.lineSource === 'invoice_pdf' && isFreightOrServiceText(String(it.originalName || ''))) {
      freightNet += Number(it.totalPrice) || 0;
      freightGross += Number(it.grossTotalPrice) || 0;
      moved++;
      continue;
    }
    kept.push(it);
  }
  return { items: kept, freightNet: round2(freightNet), freightGross: round2(freightGross), moved };
}

// Bazı 1C düzenlerinde birim sütunu isimden sonra gelir ("Арм. Пруток ... ГОСТ 34028-2016 т  83,846  72 500,00"):
// birim boş okunur ve isim "т" ile biter. Ton dışındaki son ekler (25 кг, 200 л) ambalaj ölçüsüdür, birim değildir.
const TRAILING_TON_RE = /\sтн?\.?$/i;

function documentLineUnit(name: string, unitRaw: string): string {
  if (!String(unitRaw || '').trim() && TRAILING_TON_RE.test(String(name || '').trim())) return 'TON';
  return mapDocumentUnit(unitRaw);
}

function sharedDocumentCodes(items: any[]): Set<string> {
  const names = new Map<string, Set<string>>();
  for (const it of items || []) {
    if (it?.lineSource !== 'invoice_pdf' || !it.materialCode) continue;
    if (!names.has(it.materialCode)) names.set(it.materialCode, new Set());
    names.get(it.materialCode)!.add(String(it.originalName || '').toLowerCase().trim());
  }
  return new Set([...names].filter(([, n]) => n.size > 1).map(([code]) => code));
}

// Tablo başlığının sütun numaraları ("1 2 3 4 5 6 7") ilk satırın adına yapışabiliyor: "2 3 4 5 6 7 1 Вентилятор BL 8800"
export function cleanDocumentLineName(name: string): string {
  const text = String(name || '');
  const m = text.match(/^((?:\d{1,2}\s+){4,})(?=\S)/);
  if (!m) return text;
  const nums = m[1].trim().split(/\s+/).map(Number);
  const head = nums.slice(0, -1);
  const isColumnRun = head[0] === 2 && head.every((n, i) => n === 2 + i) && nums[nums.length - 1] === 1;
  return isColumnRun ? text.slice(m[1].length) : text;
}

/**
 * Eski sürümde okunmuş belge satırlarını onarır: birimi ADET kalmış "... т" satırları ton olur,
 * başlık sütun numarası yapışmış adlar temizlenir, aynı faturada birden çok farklı satıra dağıtılmış
 * STF stok kodu kaldırılır (kod ortak olunca "Вентилятор" ile "Рукав гофра" aynı malzeme sayılıyordu).
 * Miktar ve tutarlar belgedeki gibi kalır.
 */
export function repairDocumentItems(items: any[]): { items: any[]; fixed: number } {
  let fixed = 0;
  const sharedCodes = sharedDocumentCodes(items);
  const out = (items || []).map((it: any) => {
    if (it?.lineSource !== 'invoice_pdf') return it;
    let next = it;
    if (it.materialCode && sharedCodes.has(it.materialCode)) {
      const { materialCode, ...rest } = next;
      next = rest;
    }
    if (String(it.unit || '').toUpperCase() === 'ADET' && TRAILING_TON_RE.test(String(it.originalName || '').trim())) {
      next = { ...next, unit: 'TON' };
    }
    const cleanName = cleanDocumentLineName(it.originalName);
    if (cleanName !== it.originalName) {
      const cleanMaterial = cleanDocumentLineName(it.materialName);
      next = { ...next, originalName: cleanName, materialName: cleanMaterial !== it.materialName ? cleanMaterial : (translateRussianMaterialToTurkish(cleanName) || cleanName) };
    }
    if (next !== it) fixed++;
    return next;
  });
  return { items: out, fixed };
}

/** STF/belge kalemlerinin fatura tutarını tutup tutmadığını hesaplar (uydurma nakliye yok). */
export function buildLineCheck(params: {
  items: any[];
  freightGross: number;
  invoiceTotal: number;
  source: 'invoice_pdf' | 'stf_order';
  fileId?: number;
  documentNote?: string;
}): InvoiceLineCheck {
  const qtyOf = (it: any) => Number(it?.quantity) || 1;
  const grossOf = (it: any): number => {
    if (Number(it?.grossTotalPrice) > 0) return Number(it.grossTotalPrice);
    if (Number(it?.grossUnitPrice) > 0) return Number(it.grossUnitPrice) * qtyOf(it);
    // Eski STF kayıtları: fiyat Prizma'daki haliyle (KDV dahil) tek alanda
    if (!it?.isNetNormalized) return Number(it?.totalPrice) || (Number(it?.unitPrice) || 0) * qtyOf(it);
    const vat = Number(it?.vatPercentage);
    const net = Number(it?.totalPrice) || (Number(it?.unitPrice) || 0) * qtyOf(it);
    return net * (1 + (Number.isFinite(vat) ? vat : 22) / 100);
  };
  const linesGrossSum = round2((params.items || []).reduce((s, it) => s + grossOf(it), 0));
  const diff = round2(params.invoiceTotal - linesGrossSum - (params.freightGross || 0));
  const matches = params.invoiceTotal > 0 && Math.abs(diff) <= Math.max(1, params.invoiceTotal * 0.015);
  const status: InvoiceLineCheckStatus = params.source === 'invoice_pdf'
    ? 'verified'
    : (matches ? 'stf_matches_total' : 'mismatch');
  return {
    status,
    source: params.source,
    checkedAt: new Date().toISOString(),
    invoiceTotal: params.invoiceTotal,
    linesGrossSum,
    diff,
    parserVersion: CURRENT_DOC_LINES_PARSER_VERSION,
    ...(params.fileId ? { fileId: params.fileId } : {}),
    ...(params.documentNote ? { documentNote: params.documentNote } : {})
  };
}
