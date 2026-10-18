/**
 * Fatura belgesindeki (Счет на оплату / УПД) kalem tablosunu metin katmanından okur.
 *
 * Prizma'daki STF sipariş satırları faturanın kendisi DEĞİLDİR: tedarikçi ambalaj değiştirebilir
 * (5000 adet vida yerine 15 paket × 300 adet), siparişte olmayan kalem ekleyebilir veya metreyle
 * sipariş edilen ürünü adet olarak faturalayabilir. Bu modül faturadaki gerçek satırları çıkarır ve
 * yalnızca aritmetik olarak kendi içinde tutarlıysa (miktar × fiyat = tutar, satır toplamı = fatura
 * toplamı) "doğrulanmış" kabul eder. Tahmin yapmaz: tutmayan belge reddedilir.
 */

export interface ParsedInvoiceLine {
  no: number;
  name: string;
  /** Tedarikçinin artikel kodu (belgede varsa) */
  article?: string;
  quantity: number;
  unitRaw: string;
  price: number;
  /** Satır tutarı (belgedeki "Сумма" sütunu) */
  amount: number;
  /** Satırın KDV oranı (belgede sütun varsa) */
  vatPct?: number;
  vatAmount?: number;
  /** Bu satırın KDV dahil tutarı */
  grossAmount: number;
  /** Bu satırın KDV hariç tutarı */
  netAmount: number;
}

export interface ParsedInvoiceDocument {
  lines: ParsedInvoiceLine[];
  /** Belgedeki KDV dahil genel toplam ("Итого с НДС" / "Всего к оплате") */
  totalWithVat?: number;
  /** Belgedeki "Итого" (satır tutarlarının toplamı) */
  itogo?: number;
  docVatAmount?: number;
  docVatPct?: number;
  /** true: satır fiyatları KDV dahil ("В т.ч. НДС"), false: KDV hariç, null: belirlenemedi */
  pricesIncludeVat: boolean | null;
  declaredLineCount?: number;
  warnings: string[];
}

export interface InvoiceLineVerification {
  verified: boolean;
  grossSum: number;
  netSum: number;
  expectedTotal: number;
  diff: number;
  reason?: string;
}

const MONEY = String.raw`\d{1,3}(?: \d{3})*[.,]\d{2}`;
const QTY = String.raw`\d{1,3}(?: \d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?`;
const UNIT = String.raw`[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.²³0-9/-]{0,11}`;
const VAT = String.raw`(?:(\d{1,2}(?:[.,]\d+)?)\s?%|[Бб]ез\s+НДС)`;

// Sütun düzenleri (soldan sağa): miktar [birim] fiyat ...
const ROW_PATTERNS: Array<{ kind: 'A' | 'B' | 'C' | 'E'; re: RegExp }> = [
  // A: miktar birim fiyat %KDV KDVtutarı Tutar   (1C "Счет на оплату" KDV sütunlu)
  { kind: 'A', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${MONEY})\s+${VAT}\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // E: miktar birim fiyat Tutar(KDV hariç) %KDV KDVtutarı Tutar(KDV dahil)   (УПД / счет-фактура)
  { kind: 'E', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${MONEY})\s+(${MONEY})\s+${VAT}\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // C: miktar birim fiyat %KDV Tutar
  { kind: 'C', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${MONEY})\s+${VAT}\s+(${MONEY})(?=\s|$)`, 'y') },
  // B: miktar birim fiyat Tutar   (KDV sütunu yok)
  { kind: 'B', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') }
];

export function parseRuNumber(raw: string | undefined): number {
  if (!raw) return NaN;
  const s = String(raw).replace(/[\s ]/g, '').replace(',', '.');
  return s === '' ? NaN : Number(s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const amountsAgree = (a: number, b: number, relTol = 0.0025, absTol = 0.06) =>
  Math.abs(a - b) <= Math.max(absTol, Math.abs(b) * relTol);

interface TailMatch {
  start: number;
  end: number;
  quantity: number;
  unitRaw: string;
  price: number;
  amount: number;
  vatPct?: number;
  vatAmount?: number;
  netAmount?: number;
  grossAmount?: number;
  /** Satır KDV sütunundan anlaşılan fiyat esası */
  includesVat?: boolean;
}

function vatPctFrom(raw: string | undefined): number {
  if (raw === undefined) return 0; // "Без НДС"
  return parseRuNumber(raw);
}

/** Satır metninde (isim + rakamlar) geçerli bir sayı kuyruğu arar; en sondaki geçerli eşleşmeyi döndürür. */
function findRowTail(segment: string): TailMatch | null {
  const candidates: TailMatch[] = [];
  const starts: number[] = [0];
  for (let i = 1; i < segment.length; i++) if (segment[i - 1] === ' ' && segment[i] !== ' ') starts.push(i - 1);

  for (const start of starts) {
    for (const { kind, re } of ROW_PATTERNS) {
      re.lastIndex = start;
      const m = re.exec(segment);
      if (!m) continue;
      const qty = parseRuNumber(m[1]);
      const unitRaw = (m[2] || '').trim();
      const price = parseRuNumber(m[3]);
      if (!(qty > 0) || !(price >= 0)) continue;
      // Birim yerine yakalanan "%" vb. kelimeler zaten regex dışı; isim kelimesi birim sanılmasın diye uzunluk sınırı var.
      let tail: TailMatch | null = null;
      if (kind === 'A') {
        const vatPct = vatPctFrom(m[4]);
        const vatAmount = parseRuNumber(m[5]);
        const amount = parseRuNumber(m[6]);
        if (!amountsAgree(qty * price, amount)) continue;
        let includesVat: boolean | undefined;
        if (vatPct > 0) {
          if (amountsAgree(amount * vatPct / (100 + vatPct), vatAmount, 0.003, 0.03)) includesVat = true;
          else if (amountsAgree(amount * vatPct / 100, vatAmount, 0.003, 0.03)) includesVat = false;
          else continue;
        } else {
          includesVat = true;
        }
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount, vatPct, vatAmount, includesVat,
          grossAmount: includesVat ? amount : round2(amount + vatAmount),
          netAmount: includesVat ? round2(amount - vatAmount) : amount
        };
      } else if (kind === 'E') {
        const net = parseRuNumber(m[4]);
        const vatPct = vatPctFrom(m[5]);
        const vatAmount = parseRuNumber(m[6]);
        const gross = parseRuNumber(m[7]);
        if (!amountsAgree(net + vatAmount, gross, 0.001, 0.03)) continue;
        if (!amountsAgree(qty * price, net) && !amountsAgree(qty * price, gross)) continue;
        if (vatPct > 0 && !amountsAgree(net * vatPct / 100, vatAmount, 0.003, 0.03)) continue;
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount: gross, vatPct, vatAmount,
          includesVat: amountsAgree(qty * price, gross), grossAmount: gross, netAmount: net
        };
      } else if (kind === 'C') {
        const vatPct = vatPctFrom(m[4]);
        const amount = parseRuNumber(m[5]);
        if (!amountsAgree(qty * price, amount)) continue;
        tail = { start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount, vatPct };
      } else {
        const amount = parseRuNumber(m[4]);
        if (!amountsAgree(qty * price, amount)) continue;
        tail = { start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount };
      }
      if (tail) candidates.push(tail);
    }
  }
  if (candidates.length === 0) return null;
  // En sondaki (tutar sütunu satırın en sağında) ve en çok sütun içeren eşleşme
  candidates.sort((a, b) => (b.end - a.end) || (a.start - b.start));
  return candidates[0];
}

const PAGE_NOISE = /^(?:--\s*\d+\s+of\s+\d+\s*--|№\s+.*(?:Товар|Наименование).*|НДС\s+Сумма(?:\s+НДС)?(?:\s+Сумма)?|Ставка|Кол-?во.*|Количество|Цена|Сумма)$/i;

function findAmount(text: string, re: RegExp): { value: number; pct?: number } | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const value = parseRuNumber(m[m.length - 1]);
  if (!Number.isFinite(value)) return undefined;
  const pct = m.length > 2 && m[1] !== undefined ? parseRuNumber(m[1]) : undefined;
  return { value, pct: Number.isFinite(pct as number) ? pct : undefined };
}

export function parseInvoiceText(rawText: string): ParsedInvoiceDocument {
  const warnings: string[] = [];
  const text = String(rawText || '').replace(/ /g, ' ').replace(/\t/g, ' ').replace(/\r/g, '');
  const allLines = text.split('\n').map(l => l.replace(/ {2,}/g, ' ').trim());

  const headerIdx = allLines.findIndex(l => /(Товары|Наименование|Товар\s*\(|Товары\s*\(работы)/i.test(l) && /(Кол|Цена|Сумма)/i.test(l));
  const totalIdx = allLines.findIndex((l, i) => i > headerIdx && /^(Итого|Всего\s+к\s+оплате|Всего\s+наименований)/i.test(l));
  const tableLines = allLines.slice(headerIdx >= 0 ? headerIdx + 1 : 0, totalIdx >= 0 ? totalIdx : allLines.length)
    .filter(l => l && !PAGE_NOISE.test(l));

  // Satırları sıra numarasına göre böl. Yeni satır yalnızca beklenen numarayla başlar ve
  // önceki satırın rakam kuyruğu tamamlanmışsa açılır (isimde geçen sayılar satır başı sanılmaz).
  const segments: Array<{ no: number; text: string }> = [];
  let expected = 1;
  for (const line of tableLines) {
    const m = line.match(/^(\d{1,3})(?:\s+|$)(.*)$/);
    const current = segments[segments.length - 1];
    const currentComplete = !current || Boolean(findRowTail(current.text));
    if (m && Number(m[1]) === expected && currentComplete) {
      segments.push({ no: expected, text: m[2] || '' });
      expected++;
    } else if (current) {
      current.text = `${current.text} ${line}`.trim();
    }
  }

  const lines: ParsedInvoiceLine[] = [];
  for (const seg of segments) {
    const t = seg.text.replace(/\s+/g, ' ').trim();
    const tail = findRowTail(t);
    if (!tail) {
      warnings.push(`Satır ${seg.no}: miktar/fiyat/tutar okunamadı`);
      continue;
    }
    let name = `${t.slice(0, tail.start)} ${t.slice(tail.end)}`
      .replace(/(^|\s)Картинка(?=\s|$)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Baştaki tedarikçi artikel kodu (ör. "SR-091РНГР80(1 ,0)", "SAMC-03620000 1") ürün adı değildir.
    let article: string | undefined;
    const art = name.match(/^([A-ZА-Я]{2,6}-[0-9A-Za-zА-Яа-я()\-]+)(?:\s+([0-9,()]{1,4}))?(?=\s+\S)/);
    if (art) {
      article = `${art[1]}${art[2] || ''}`.replace(/\s+/g, '');
      name = name.slice(art[0].length).trim();
    }
    lines.push({
      no: seg.no,
      name,
      ...(article ? { article } : {}),
      quantity: tail.quantity,
      unitRaw: tail.unitRaw,
      price: tail.price,
      amount: tail.amount,
      vatPct: tail.vatPct,
      vatAmount: tail.vatAmount,
      grossAmount: tail.grossAmount ?? tail.amount,
      netAmount: tail.netAmount ?? tail.amount,
      ...(tail.includesVat === undefined ? {} : { _includesVat: tail.includesVat })
    } as ParsedInvoiceLine);
  }

  const footer = allLines.slice(totalIdx >= 0 ? totalIdx : 0).join('\n');
  const totalWithVat = findAmount(footer, new RegExp(String.raw`(?:Итого\s+с\s+НДС|Всего\s+к\s+оплате|Итого\s+к\s+оплате)\s*:?\s*(${MONEY})`, 'i'));
  const itogo = findAmount(footer, new RegExp(String.raw`Итого\s*:\s*(${MONEY})`, 'i'));
  const vatIncl = findAmount(footer, new RegExp(String.raw`В\s*т(?:\.|ом)?\s*ч(?:\.|исле)?\s*НДС\s*(?:\(\s*(\d{1,2})\s*%\s*\))?\s*:?\s*(${MONEY})`, 'i'));
  const vatExcl = vatIncl ? undefined : findAmount(footer, new RegExp(String.raw`(?:^|\n)\s*(?:Сумма\s+)?НДС\s*(?:\(\s*(\d{1,2})\s*%\s*\))?\s*:?\s*(${MONEY})`, 'i'));
  const declared = /Всего\s+наименований\s+(\d+)/i.exec(text);

  let pricesIncludeVat: boolean | null = null;
  const rowVatFlags = lines.map(l => (l as any)._includesVat).filter((v: any) => v !== undefined);
  if (rowVatFlags.length > 0 && rowVatFlags.every((v: boolean) => v === rowVatFlags[0])) {
    pricesIncludeVat = rowVatFlags[0];
  } else if (vatIncl) {
    pricesIncludeVat = true;
  } else if (vatExcl && itogo && totalWithVat && amountsAgree(itogo.value + vatExcl.value, totalWithVat.value, 0.0005, 0.05)) {
    pricesIncludeVat = false;
  } else if (/Без\s+(?:налога\s*\(\s*)?НДС/i.test(footer)) {
    pricesIncludeVat = true;
  }

  const docVatPct = vatIncl?.pct ?? vatExcl?.pct;
  // KDV sütunu olmayan satırlar için brüt/net tutarı belge seviyesindeki orandan türet
  for (const l of lines) {
    delete (l as any)._includesVat;
    if (l.vatAmount !== undefined) continue;
    const pct = l.vatPct ?? docVatPct;
    if (pct === undefined || pricesIncludeVat === null) continue;
    l.vatPct = pct;
    if (pricesIncludeVat) {
      l.grossAmount = l.amount;
      l.netAmount = round2(l.amount / (1 + pct / 100));
    } else {
      l.netAmount = l.amount;
      l.grossAmount = round2(l.amount * (1 + pct / 100));
    }
  }

  return {
    lines,
    totalWithVat: totalWithVat?.value,
    itogo: itogo?.value,
    docVatAmount: (vatIncl || vatExcl)?.value,
    docVatPct,
    pricesIncludeVat,
    declaredLineCount: declared ? Number(declared[1]) : undefined,
    warnings
  };
}

/**
 * Okunan satırların faturayı birebir temsil edip etmediğini denetler.
 * expectedTotal: ERP'deki (Prizma) KDV dahil fatura tutarı.
 */
export function verifyParsedInvoice(doc: ParsedInvoiceDocument, expectedTotal: number): InvoiceLineVerification {
  const grossSum = round2(doc.lines.reduce((s, l) => s + l.grossAmount, 0));
  const netSum = round2(doc.lines.reduce((s, l) => s + l.netAmount, 0));
  const base = { grossSum, netSum, expectedTotal, diff: round2(expectedTotal - grossSum) };
  const fail = (reason: string): InvoiceLineVerification => ({ verified: false, ...base, reason });

  if (doc.lines.length === 0) return fail('Belgede okunabilir kalem satırı yok');
  if (doc.warnings.length > 0) return fail(doc.warnings.join('; '));
  if (doc.pricesIncludeVat === null) return fail('Fiyatların KDV dahil/hariç olduğu belgeden anlaşılamadı');
  if (doc.declaredLineCount !== undefined && doc.declaredLineCount !== doc.lines.length) {
    return fail(`Belgede ${doc.declaredLineCount} kalem yazıyor, ${doc.lines.length} kalem okundu`);
  }
  const rowSum = round2(doc.lines.reduce((s, l) => s + l.amount, 0));
  if (doc.itogo !== undefined && !amountsAgree(rowSum, doc.itogo, 0.0002, 0.05)) {
    return fail(`Satır toplamı (${rowSum}) belgedeki "Итого" (${doc.itogo}) ile tutmuyor`);
  }
  const tol = Math.max(1, expectedTotal * 0.0005);
  if (!(expectedTotal > 0) || Math.abs(grossSum - expectedTotal) > tol) {
    return fail(`KDV dahil satır toplamı (${grossSum}) fatura tutarı (${expectedTotal}) ile tutmuyor`);
  }
  return { verified: true, ...base };
}

/** Belgedeki birim yazımını uygulamanın birim koduna çevirir. */
export function mapDocumentUnit(unitRaw: string): string {
  const u = String(unitRaw || '').toLowerCase().replace(/[.\s]/g, '');
  if (!u) return 'ADET';
  if (/^(шт|штук|штука|ед|pcs)$/.test(u)) return 'ADET';
  if (/^(упак|уп|упаковка|пач|пачка|пак|пакет)$/.test(u)) return 'PAKET';
  if (/^(м|мп|пм|погм|метр|m)$/.test(u)) return 'MT';
  if (/^(м2|м²|квм)$/.test(u)) return 'M2';
  if (/^(м3|м³|кубм)$/.test(u)) return 'M3';
  if (/^(кг)$/.test(u)) return 'KG';
  if (/^(т|тн|тонн|тонна)$/.test(u)) return 'TON';
  if (/^(л|литр)$/.test(u)) return 'LITRE';
  if (/^(рул|рулон)$/.test(u)) return 'RULO';
  if (/^(пар|пара)$/.test(u)) return 'CIFT';
  if (/^(компл|комплект|к-т|кт|набор)$/.test(u)) return 'TAKIM';
  if (/^(боб|бобина)$/.test(u)) return 'BOBIN';
  if (/^(лист)$/.test(u)) return 'PLAKA';
  if (/^(меш|мешок)$/.test(u)) return 'TORBA';
  return unitRaw.toUpperCase();
}
