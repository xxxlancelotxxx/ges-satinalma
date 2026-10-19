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

const MONEY = String.raw`(?:\d{1,3}(?:[ ,]\d{3})*|\d+)[.,]\d{2}(?!\d)`;
const PRICE = String.raw`(?:\d{1,3}(?:[ ,]\d{3})*|\d+)[.,]\d{2,4}(?!\d)`;
const QTY = String.raw`\d{1,3}(?:[ ,]\d{3})+(?:[.,]\d{1,4})?(?!\d)|\d+(?:[.,]\d{1,4})?(?!\d)`;
const UNIT = String.raw`(?:пог\.?\s*м\.?|кв\.?\s*м\.?|куб\.?\s*м\.?|тыс\.?\s*шт\.?|п\.?\s*м\.?|м\.?\s*п\.?|[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.²³0-9/-]{0,11})`;
const VAT = String.raw`(?:(\d{1,2}(?:[.,]\d+)?)\s?%|[Бб]ез\s+НДС|[Нн]е\s+облагается)`;

// Sütun düzenleri (soldan sağa): miktar [birim] fiyat ... veya birim miktar fiyat ...
const ROW_PATTERNS: Array<{ kind: 'A' | 'B' | 'C' | 'E' | 'F' | 'P' | 'T' | 'RA' | 'RB'; re: RegExp }> = [
  // A: miktar birim fiyat %KDV KDVtutarı Tutar   (1C "Счет на оплату" KDV sütunlu)
  { kind: 'A', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+${VAT}\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // P: miktar birim [ağırlık] [hacim] %KDV KDVtutarı fiyat Tutar   (СТД "Петрович" formatı)
  { kind: 'P', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(${UNIT})(?:\s+(?:${QTY})){0,2}\s+${VAT}\s+(${MONEY})\s+(${PRICE})\s+(${MONEY})(?=\s|$)`, 'y') },
  // T: miktar birim fiyat(KDV dahil) fiyat(KDV hariç) %KDV Tutar   (Триада-Груп formatı)
  { kind: 'T', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+(${PRICE})\s+${VAT}\s+(${MONEY})(?=\s|$)`, 'y') },
  // E: miktar birim fiyat Tutar(KDV hariç) %KDV KDVtutarı Tutar(KDV dahil)   (УПД / счет-фактура)
  { kind: 'E', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+(${MONEY})\s+${VAT}\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // C: miktar birim fiyat %KDV Tutar
  { kind: 'C', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+${VAT}\s+(${MONEY})(?=\s|$)`, 'y') },
  // F: miktar birim fiyat1(KDV hariç/iskontosuz) fiyat2/tutar1 Tutar2
  { kind: 'F', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // B: miktar birim fiyat Tutar   (KDV sütunu yok)
  { kind: 'B', re: new RegExp(String.raw`(?:^|\s)(${QTY})\s+(?:(${UNIT})\s+)?(${PRICE})\s+(${MONEY})(?=\s|$)`, 'y') },
  // RA: birim miktar fiyat %KDV KDVtutarı Tutar   (Birim -> Miktar ters sütun düzeni)
  { kind: 'RA', re: new RegExp(String.raw`(?:^|\s)(${UNIT})\s+(${QTY})\s+(${PRICE})\s+${VAT}\s+(${MONEY})\s+(${MONEY})(?=\s|$)`, 'y') },
  // RB: birim miktar fiyat Tutar   (Birim -> Miktar ters sütun düzeni, KDV sütunu yok - Комус / Ситигрес)
  { kind: 'RB', re: new RegExp(String.raw`(?:^|\s)(${UNIT})\s+(${QTY})\s+(${PRICE})\s+(${MONEY})(?=\s|$)`, 'y') }
];

export function parseRuNumber(raw: string | undefined): number {
  if (!raw) return NaN;
  const trimmed = String(raw).replace(/[\s\u00a0]/g, '');
  if (trimmed === '') return NaN;
  if (trimmed.includes(',') && trimmed.includes('.')) {
    const lastComma = trimmed.lastIndexOf(',');
    const lastDot = trimmed.lastIndexOf('.');
    const cleaned = lastDot > lastComma
      ? trimmed.replace(/,/g, '')
      : trimmed.replace(/\./g, '').replace(',', '.');
    return Number(cleaned);
  }
  const s = trimmed.replace(',', '.');
  return Number(s);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const amountsAgree = (a: number, b: number, relTol = 0.0035, absTol = 0.08) =>
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
  if (raw === undefined) return 0; // "Без НДС" / "Не облагается"
  return parseRuNumber(raw);
}

const VALID_REVERSE_UNIT_RE = /^(?:шт|штук|уп|упак|м|мп|пм|пог\.?\s*м|м2|м²|кв\.?\s*м|м3|м³|куб\.?\s*м|кг|т|тн|тонн|л|литр|рул|пар|пара|компл|к-т|лист|меш|пач)\.?$/i;

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

      const isReversed = kind === 'RA' || kind === 'RB';
      const rawQtyStr = (isReversed ? m[2] : m[1]) || '';
      let qty = parseRuNumber(rawQtyStr);
      const unitRaw = (isReversed ? m[1] : (m[2] || '')).trim();
      const price = parseRuNumber(kind === 'P' ? m[5] : m[3]);
      if (!(qty > 0) || !(price >= 0)) continue;
      if (isReversed && !VALID_REVERSE_UNIT_RE.test(unitRaw)) continue;

      // İngiliz sayı formatlı 1C faturalarında ("2,022 м 437.48 ... 884,589.41") virgül binlik ayracı olabilir
      const adjustThousandsQty = (targetAmount: number) => {
        if (/^\d{1,3},\d{3}$/.test(rawQtyStr.trim()) && !amountsAgree(qty * price, targetAmount) && amountsAgree(qty * 1000 * price, targetAmount)) {
          qty = qty * 1000;
        }
      };

      let tail: TailMatch | null = null;
      if (kind === 'A' || kind === 'RA') {
        const vatPct = vatPctFrom(m[4]);
        const vatAmount = parseRuNumber(m[5]);
        const amount = parseRuNumber(m[6]);
        adjustThousandsQty(amount);
        if (!amountsAgree(qty * price, amount)) continue;
        let includesVat: boolean | undefined;
        if (vatPct > 0) {
          if (amountsAgree(amount * vatPct / (100 + vatPct), vatAmount, 0.003, 0.05)) includesVat = true;
          else if (amountsAgree(amount * vatPct / 100, vatAmount, 0.003, 0.05)) includesVat = false;
          else if (amountsAgree((amount - vatAmount) * vatPct / 100, vatAmount, 0.005, 0.08)) includesVat = true;
          else continue;
        } else {
          includesVat = true;
        }
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount, vatPct, vatAmount, includesVat,
          grossAmount: includesVat ? amount : round2(amount + vatAmount),
          netAmount: includesVat ? round2(amount - vatAmount) : amount
        };
      } else if (kind === 'P') {
        const vatPct = vatPctFrom(m[3]);
        const vatAmount = parseRuNumber(m[4]);
        const amount = parseRuNumber(m[6]);
        adjustThousandsQty(amount);
        if (!amountsAgree(qty * price, amount)) continue;
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount, vatPct, vatAmount,
          includesVat: true,
          grossAmount: amount,
          netAmount: vatAmount > 0 && amount > vatAmount ? round2(amount - vatAmount) : amount
        };
      } else if (kind === 'T') {
        const price2 = parseRuNumber(m[4]);
        const vatPct = vatPctFrom(m[5]);
        const amount = parseRuNumber(m[6]);
        adjustThousandsQty(amount);
        if (!amountsAgree(qty * price, amount) && !amountsAgree(qty * price2, amount)) continue;
        const grossPrice = amountsAgree(qty * price, amount) ? price : price2;
        const netAmt = vatPct > 0 ? round2(amount / (1 + vatPct / 100)) : amount;
        const vatAmt = round2(amount - netAmt);
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price: grossPrice, amount, vatPct, vatAmount: vatAmt,
          includesVat: true,
          grossAmount: amount,
          netAmount: netAmt
        };
      } else if (kind === 'E') {
        const net = parseRuNumber(m[4]);
        const vatPct = vatPctFrom(m[5]);
        const vatAmount = parseRuNumber(m[6]);
        const gross = parseRuNumber(m[7]);
        adjustThousandsQty(net);
        if (!amountsAgree(net + vatAmount, gross, 0.001, 0.05)) continue;
        if (!amountsAgree(qty * price, net) && !amountsAgree(qty * price, gross)) continue;
        if (vatPct > 0 && !amountsAgree(net * vatPct / 100, vatAmount, 0.003, 0.05)) continue;
        tail = {
          start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount: gross, vatPct, vatAmount,
          includesVat: amountsAgree(qty * price, gross), grossAmount: gross, netAmount: net
        };
      } else if (kind === 'C') {
        const vatPct = vatPctFrom(m[4]);
        const amount = parseRuNumber(m[5]);
        adjustThousandsQty(amount);
        if (!amountsAgree(qty * price, amount)) continue;
        tail = { start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount, vatPct };
      } else if (kind === 'F') {
        const col4 = parseRuNumber(m[4]);
        const amount = parseRuNumber(m[5]);
        adjustThousandsQty(amount);
        // col4 indirim sonrası fiyat veya KDV tutarı olabilir
        if (amountsAgree(qty * col4, amount)) {
          tail = { start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price: col4, amount };
        } else if (amountsAgree(qty * price, col4) && amountsAgree(col4 * 1.2, amount, 0.02, 0.5)) {
          const vatAmt = round2(amount - col4);
          tail = {
            start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price, amount,
            vatAmount: vatAmt, grossAmount: amount, netAmount: col4, includesVat: false
          };
        } else if (amountsAgree(qty * price - col4, amount, 0.003, 0.06) && col4 < qty * price) {
          tail = {
            start: m.index, end: re.lastIndex, quantity: qty, unitRaw, price: round2(amount / qty), amount
          };
        }
      } else {
        const amount = parseRuNumber(m[4]);
        adjustThousandsQty(amount);
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

const PAGE_NOISE = /^(?:--\s*\d+\s+of\s+\d+\s*--|№\s+.*(?:Товар|Наименование).*|Артикул\s+Наименование.*|НДС\s+Сумма(?:\s+НДС)?(?:\s+Сумма)?|Ставка|Кол-?во.*|Количество|Цена|Сумма|Страница\s+\d+.*)$/i;

function findAmount(text: string, re: RegExp): { value: number; pct?: number } | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const value = parseRuNumber(m[m.length - 1]);
  if (!Number.isFinite(value)) return undefined;
  const pct = m.length > 2 && m[1] !== undefined ? parseRuNumber(m[1]) : undefined;
  return { value, pct: Number.isFinite(pct as number) ? pct : undefined };
}

function inferStandardVatPct(vatAmount: number, baseNetAmount: number): number | undefined {
  if (!(vatAmount > 0) || !(baseNetAmount > 0)) return undefined;
  const rawPct = (vatAmount / baseNetAmount) * 100;
  if (rawPct >= 18.8 && rawPct <= 20.8) return 20;
  if (rawPct > 20.8 && rawPct <= 23.5) return 22;
  if (rawPct >= 9.0 && rawPct <= 11.0) return 10;
  if (rawPct >= 4.5 && rawPct <= 5.5) return 5;
  if (rawPct >= 6.5 && rawPct <= 7.5) return 7;
  return undefined;
}

export function parseInvoiceText(rawText: string): ParsedInvoiceDocument {
  const warnings: string[] = [];
  const text = String(rawText || '').replace(/\u00a0/g, ' ').replace(/\t/g, ' ').replace(/\r/g, '');
  const allLines = text.split('\n').map(l => l.replace(/ {2,}/g, ' ').trim());

  const headerIdx = allLines.findIndex(l => /(Товары|Наименование|Товар\b|Товары\s*\(работы|Номенклатура)/i.test(l) && /(Кол|Цена|Сумма|Ед\.?)/i.test(l));
  const totalIdx = allLines.findIndex((l, i) => i > headerIdx && /^(Итого|Всего\s+к\s+оплате|Всего\s+наименований|Всего\s+по\s+счету|К\s+оплате|Вес\s*\(|Счет\s+содержит)/i.test(l));
  const tableLines = allLines.slice(headerIdx >= 0 ? headerIdx + 1 : 0, totalIdx >= 0 ? totalIdx : allLines.length)
    .filter(l => l && !PAGE_NOISE.test(l));

  // Satırları sıra numarasına göre böl. Yeni satır yalnızca beklenen numarayla başlar ve
  // önceki satırın rakam kuyruğu tamamlanmışsa açılır (isimde geçen sayılar satır başı sanılmaz).
  // Bitişik sıra numaralarını da ("1Гидроизоляционная...", "1. ...") destekler.
  const segments: Array<{ no: number; text: string }> = [];
  let expected = 1;
  for (const line of tableLines) {
    // Petrovich gibi faturalarda tablo sonunda tek başına duran genel toplam satırını ("44 711,98") atla
    if (segments.length > 0 && Boolean(findRowTail(segments[segments.length - 1].text)) && new RegExp(String.raw`^${MONEY}$`).test(line)) {
      continue;
    }
    const m = line.match(/^(\d{1,3})(?:[.)]?\s+|(?=[А-ЯЁA-Z«"'])|$)(.*)$/);
    const current = segments[segments.length - 1];
    const currentComplete = !current || Boolean(findRowTail(current.text));
    if (m && Number(m[1]) === expected && currentComplete) {
      segments.push({ no: expected, text: m[2] || '' });
      expected++;
    } else if (current) {
      // Eğer mevcut satır zaten geçerli bir sayı kuyruğu ile bitiyorsa ve yeni satır eklenince kuyruk sonu
      // teslimat notu vb. ("3-4 рабочих дня") oluyorsa bile findRowTail içindeki 'y' regex en sondaki
      // geçerli sayı dizisini korur; ancak sayı içeren teslimat notu ("1500+522м") kuyruğu bozmasın diye kontrol et:
      const candidateText = `${current.text} ${line}`.trim();
      if (currentComplete && !findRowTail(candidateText)) {
        // Kuyruk tamamlandıktan sonra gelen teslimat süresi vb. notları ("3-4 рабочих дня") satıra ekleme
        continue;
      }
      current.text = candidateText;
    }
  }

  // Eğer 1, 2, 3 sıra numaralı satır bulunamadıysa, Комус gibi Артикул koduyla başlayan satırları kontrol et
  if (segments.length === 0) {
    let artSeq = 1;
    for (const line of tableLines) {
      const artMatch = line.match(/^(\d{5,10})\s+([А-ЯЁA-Za-z«"'].*)$/);
      const current = segments[segments.length - 1];
      const currentComplete = !current || Boolean(findRowTail(current.text));
      if (artMatch && currentComplete) {
        segments.push({ no: artSeq++, text: `${artMatch[1]} ${artMatch[2]}` });
      } else if (current) {
        const candidateText = `${current.text} ${line}`.trim();
        if (currentComplete && !findRowTail(candidateText)) continue;
        current.text = candidateText;
      }
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
    // Baştaki tedarikçi artikel kodu (ör. "SR-091РНГР80(1 ,0)", "SAMC-03620000 1", "00000627664", "0000063113 8", "2215694") ürün adı değildir.
    let article: string | undefined;
    const art =
      name.match(/^([A-ZА-Я]{2,6}-[0-9A-Za-zА-Яа-я()\-]+)(?:\s+([0-9,()]{1,4}))?(?=\s+\S)/) ||
      name.match(/^(\d{8,12})\s+(\d{1,3})(?=\s+[А-ЯЁA-Za-z«"'])/) ||
      name.match(/^(\d{5,12})(?=\s+[А-ЯЁA-Za-z«"'])/);
    if (art) {
      article = `${art[1]}${art[2] || ''}`.replace(/\s+/g, '');
      name = name.slice(art[0].length).trim();
    }

    // Sondaki fatura genel toplamı / dipnot sayı artıklarını temizle (ör. "т 625,508 45 036 573,38")
    name = name.replace(/\s+\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{1,4})?\s+\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})$/, '').trim();

    // Eğer tail.unitRaw boş ise ve ürün adının sonunda birim eki (ör. "т", "тн", "тонн", "кг", "м", "м2", "м3", "шт", "уп", "компл") kalmışsa
    let finalUnitRaw = tail.unitRaw;
    if (!finalUnitRaw) {
      const trailingUnitMatch = name.match(/\s+([тТ][нН]?|[тТ]онн[а-я]*|[кК][гГ]|[мМ][2²3³]?|[пП][\s.]*[мМ]|[шШ][тТ][а-я]*|[уУ][пП][а-я]*|[кК]омпл[а-я]*)\.?$/i);
      if (trailingUnitMatch) {
        finalUnitRaw = trailingUnitMatch[1];
        name = name.slice(0, trailingUnitMatch.index).trim();
      }
    }

    lines.push({
      no: seg.no,
      name,
      ...(article ? { article } : {}),
      quantity: tail.quantity,
      unitRaw: finalUnitRaw,
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
  const headerLine = headerIdx >= 0 ? allLines.slice(Math.max(0, headerIdx - 1), headerIdx + 3).join(' ') : '';
  const totalWithVat =
    findAmount(footer, new RegExp(String.raw`(?:Итого\s+с\s+НДС|Всего\s+к\s+оплате|Итого\s+к\s+оплате|Всего\s+по\s+счету)\s*:?\s*(${MONEY})`, 'i')) ||
    findAmount(footer, new RegExp(String.raw`К\s+оплате\s*:?[^\n]*\n\s*(${MONEY})`, 'i')) ||
    findAmount(text, new RegExp(String.raw`Всего\s+наименований\s+\d+\s*,?\s*на\s+сумму\s*:?\s*(${MONEY})`, 'i'));
  const itogo = findAmount(footer, new RegExp(String.raw`(?:^|\n)\s*Итого\s*(?:без\s+НДС)?\s*:?(?:\s+\d+[.,]\d{3,4})?\s*(${MONEY})`, 'i'));
  const vatIncl = findAmount(
    footer,
    new RegExp(String.raw`(?:В\s*т(?:\.|ом)?\s*ч(?:\.|исле)?\s*(?:сумма\s+)?НДС|Всего\s+НДС)\s*(?:\(?\s*(\d{1,2})\s*%\s*\)?)?\s*:?\s*(${MONEY})`, 'i')
  );
  const vatExcl = vatIncl
    ? undefined
    : findAmount(
        footer,
        new RegExp(String.raw`(?:^|\n)\s*(?:Итого\s+НДС|Сумма\s+НДС|НДС)\s*(?:\(?\s*(\d{1,2})\s*%\s*\)?)?\s*:?\s*(${MONEY})`, 'i')
      );
  const noVatFooter = /Без\s+налога\s*\(\s*НДС\s*\)|Без\s+НДС|НДС\s+не\s+облагается/i.test(footer);
  const declared = /Всего\s+наименований\s+(\d+)/i.exec(text);

  const rowSum = round2(lines.reduce((s, l) => s + l.amount, 0));
  const anyVat = vatIncl || vatExcl;

  let pricesIncludeVat: boolean | null = null;
  const rowVatFlags = lines.map(l => (l as any)._includesVat).filter((v: any) => v !== undefined);
  if (rowVatFlags.length > 0 && rowVatFlags.every((v: boolean) => v === rowVatFlags[0])) {
    pricesIncludeVat = rowVatFlags[0];
  } else if (vatIncl) {
    pricesIncludeVat = true;
  } else if (noVatFooter) {
    pricesIncludeVat = true;
  } else if (anyVat && totalWithVat && rowSum > 0) {
    if (amountsAgree(rowSum, totalWithVat.value, 0.001, 0.10)) {
      pricesIncludeVat = true;
    } else if (amountsAgree(rowSum + anyVat.value, totalWithVat.value, 0.001, 0.10)) {
      pricesIncludeVat = false;
    }
  } else if (vatExcl && itogo && totalWithVat && amountsAgree(itogo.value + vatExcl.value, totalWithVat.value, 0.001, 0.10)) {
    pricesIncludeVat = false;
  } else if (anyVat && itogo && rowSum > 0 && amountsAgree(rowSum, itogo.value, 0.001, 0.10)) {
    // "Итого: X" ve "Итого НДС: Y" var, X > Y ve Y X'in içindeki KDV (%20, %22, %10, %5, %7) ile uyumluysa KDV dahildir
    const impliedInclPct = inferStandardVatPct(anyVat.value, itogo.value - anyVat.value);
    if (impliedInclPct !== undefined) {
      pricesIncludeVat = true;
    }
  } else if (totalWithVat && rowSum > 0 && amountsAgree(rowSum, totalWithVat.value, 0.001, 0.10)) {
    pricesIncludeVat = true;
  } else if (/Сумма\s+с\s+НДС|Цена\s+с\s+НДС/i.test(headerLine)) {
    pricesIncludeVat = true;
  } else if (/Сумма\s+без\s+НДС|Цена\s+без\s+НДС/i.test(headerLine) && anyVat) {
    pricesIncludeVat = false;
  }

  let docVatPct = vatIncl?.pct ?? vatExcl?.pct ?? (noVatFooter ? 0 : undefined);
  if (docVatPct === undefined && anyVat && anyVat.value > 0) {
    const grossRef = totalWithVat?.value ?? (pricesIncludeVat ? (itogo?.value || rowSum) : undefined);
    const netRef = pricesIncludeVat === false ? (itogo?.value || rowSum) : (grossRef ? grossRef - anyVat.value : undefined);
    if (netRef && netRef > 0) {
      docVatPct = inferStandardVatPct(anyVat.value, netRef);
    }
  }

  // KDV sütunu olmayan satırlar için brüt/net tutarı belge seviyesindeki orandan türet
  for (const l of lines) {
    delete (l as any)._includesVat;
    if (l.vatAmount !== undefined) continue;
    const pct = l.vatPct ?? docVatPct;
    if (pct === undefined || pricesIncludeVat === null) continue;
    l.vatPct = pct;
    if (pricesIncludeVat) {
      l.grossAmount = l.amount;
      l.netAmount = pct > 0 ? round2(l.amount / (1 + pct / 100)) : l.amount;
    } else {
      l.netAmount = l.amount;
      l.grossAmount = pct > 0 ? round2(l.amount * (1 + pct / 100)) : l.amount;
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
  const rowSum = round2(doc.lines.reduce((s, l) => s + l.amount, 0));
  // Belge metninde KDV dipnotu silikse ancak satır tutarları toplamı ERP'deki KDV dahil fatura toplamını
  // kuruşu kuruşuna tutuyorsa, satır tutarlarının KDV dahil olduğu matematiksel olarak kesindir.
  if (doc.pricesIncludeVat === null && expectedTotal > 0 && doc.lines.length > 0 && amountsAgree(rowSum, expectedTotal, 0.0005, 0.5)) {
    doc.pricesIncludeVat = true;
    const pct = doc.docVatPct ?? (doc.docVatAmount && expectedTotal > doc.docVatAmount ? inferStandardVatPct(doc.docVatAmount, expectedTotal - doc.docVatAmount) : undefined);
    for (const l of doc.lines) {
      l.grossAmount = l.amount;
      if (pct !== undefined && pct > 0) {
        l.vatPct = pct;
        l.netAmount = round2(l.amount / (1 + pct / 100));
      }
    }
  }

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
  if (doc.itogo !== undefined && !amountsAgree(rowSum, doc.itogo, 0.0005, 0.10)) {
    // Bazı УПД belgelerinde Итого satırı KDV dahil toplamı, satır amount'u ise KDV dahil toplamı gösterir
    if (!amountsAgree(grossSum, doc.itogo, 0.0005, 0.10) && !amountsAgree(netSum, doc.itogo, 0.0005, 0.10)) {
      return fail(`Satır toplamı (${rowSum}) belgedeki "Итого" (${doc.itogo}) ile tutmuyor`);
    }
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
  if (/^(шт|штук|штука|ед|pcs|тысшт)$/.test(u)) return 'ADET';
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
