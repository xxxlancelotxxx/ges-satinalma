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
import { parseInvoiceText, verifyParsedInvoice, mapDocumentUnit, ParsedInvoiceDocument } from '../src/utils/invoiceLineParser';
import { normalizeCategoryName, translateRussianMaterialToTurkish } from '../src/utils/categoryClassifier';

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
}

const FREIGHT_OR_SERVICE_RE = /шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|nakliye|teslimat\s*hizmet|kargo/i;
const FREIGHT_EXCEPTION_RE = /шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер/i;

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
    if (isFreightOrServiceText(line.name)) {
      freightNet += line.netAmount;
      freightGross += line.grossAmount;
      continue;
    }
    const vatPct = line.vatPct ?? doc.docVatPct ?? defaultVat;
    const qty = line.quantity || 1;
    const grossUnitPrice = round2(line.grossAmount / qty);
    const unitPriceNet = round2(line.netAmount / qty);
    const translated = translateRussianMaterialToTurkish(line.name) || line.name;
    const stf = bestStfMatch(line.name, ctx.stfItems || []);
    items.push({
      id: `inv_line_${line.no}`,
      materialName: translated,
      originalName: line.name,
      ...(stf?.materialCode ? { materialCode: stf.materialCode } : {}),
      ...(line.article ? { article: line.article } : {}),
      quantity: qty,
      unit: mapDocumentUnit(line.unitRaw),
      unitPrice: unitPriceNet,
      unitPriceNet,
      grossUnitPrice,
      totalPrice: round2(line.netAmount),
      grossTotalPrice: round2(line.grossAmount),
      vatPercentage: vatPct,
      isNetNormalized: true,
      lineSource: 'invoice_pdf',
      invoiceLineNo: line.no,
      category: normalizeCategoryName('', `${line.name} ${translated}`)
    });
  }
  return { items, freightNet: round2(freightNet), freightGross: round2(freightGross) };
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
    return { fileId: ctx.fileId, verified: false, note: check.reason || 'Belge doğrulanamadı', grossSum: check.grossSum };
  }
  const built = buildItemsFromParsedInvoice(parsed, { docYear: ctx.docYear, stfItems: ctx.stfItems });
  return {
    fileId: ctx.fileId,
    verified: true,
    note: `${parsed.lines.length} kalem fatura belgesinden okundu`,
    items: built.items,
    freightNet: built.freightNet,
    freightGross: built.freightGross,
    grossSum: check.grossSum
  };
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
    ...(params.fileId ? { fileId: params.fileId } : {}),
    ...(params.documentNote ? { documentNote: params.documentNote } : {})
  };
}
