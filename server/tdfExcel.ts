/**
 * TDF Excel çıktısı (exceljs). Görünüm Berkant'ın TDF formatını izler: lacivert başlıklar, firma sütun grupları,
 * sarı "en iyi fiyat" bloğu, en düşük yeşil / en yüksek kırmızı, uyarılı hücrede açıklama notu,
 * öneri ve uyarı kutuları, ticari şartlar, kalite, firma güvenilirliği ve puanlama.
 * Toplamlar formüldür; Excel'de fiyat değiştirilirse satır toplamı, genel toplam ve en iyi fiyat yeniden hesaplanır.
 */
import ExcelJS from 'exceljs';
import { computeTdf, TdfComputed, TdfForm, tdfFormat } from '../src/utils/tdfEngine';
import { buildTdfReport, cellBrandNote, freightText, materialSpecText, TDF_LEVEL_LABEL, TDF_TERM_ROWS, TDF_UNIT_LABEL, termText } from '../src/utils/tdfReport';

const NAVY = 'FF102C54', NAVY2 = 'FF1E3F6E', HEAD = 'FFD6DCE4', SUM = 'FFD9E1F2', BEST = 'FFFFEB9C', GOOD = 'FFE2F5EC', GOODF = 'FF0B7A4B',
  BAD = 'FFFDE8E6', BADF = 'FFB42318', WARN = 'FFFFF3D6', WARNF = 'FFA15C00', GREY = 'FFF5F6F8', INFO = 'FFE9EFFF', INFOF = 'FF2F5BD3',
  WHITE = 'FFFFFFFF', BLACK = 'FF000000', MUTED = 'FF5A6579', LINE = 'FFC9CFDA', DARK = 'FF3A4352', REDBAND = 'FF8A1C12';
const NUM = '#,##0';
const QTY = '#,##0.000';
const PCT = '0.0%';

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: LINE } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...o });
const colL = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

interface BoxOpts { bg?: string; fc?: string; b?: boolean; sz?: number; al?: 'left' | 'center' | 'right'; border?: boolean; wrap?: boolean; fmt?: string; italic?: boolean }

function helpers(ws: ExcelJS.Worksheet, lastCol: number) {
  const box = (r1: number, r2: number, c1: number, c2: number, value: ExcelJS.CellValue, o: BoxOpts = {}) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
    const cell = ws.getCell(r1, c1);
    cell.value = value;
    cell.font = font({ bold: !!o.b, size: o.sz || 10, color: { argb: o.fc || BLACK }, italic: !!o.italic });
    cell.alignment = { horizontal: o.al || 'left', vertical: 'middle', wrapText: o.wrap !== false, indent: (o.al || 'left') === 'left' ? 1 : 0 };
    if (o.fmt) cell.numFmt = o.fmt;
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) {
        const x = ws.getCell(rr, cc);
        if (o.bg) x.fill = fill(o.bg);
        if (o.border !== false) x.border = BORDER;
      }
    }
    return cell;
  };
  const band = (r: number, text: string, o: { size?: number; color?: string; fc?: string; h?: number; bold?: boolean } = {}) => {
    const c = box(r, r, 1, lastCol, text, { bg: o.color || NAVY, fc: o.fc || WHITE, b: o.bold !== false, sz: o.size || 11, border: false });
    ws.getRow(r).height = o.h || 20;
    return c;
  };
  return { box, band };
}

/** Uzun metinler için yaklaşık satır yüksekliği (birleştirilmiş hücrede Excel kendisi büyütmez). */
function heightFor(text: string, widthChars: number, base = 15, min = 18): number {
  const lines = String(text || '').split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / Math.max(10, widthChars))), 0);
  return Math.max(min, lines * base);
}

export async function buildTdfWorkbook(form: TdfForm, opts: { todayIso?: string; computed?: TdfComputed } = {}): Promise<ExcelJS.Workbook> {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const c = opts.computed || computeTdf(form, todayIso);
  const r = buildTdfReport(form, c, todayIso);
  const { rub, pct } = tdfFormat;
  const S = r.suppliers;
  const nS = S.length;
  const nMat = c.materials.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GES Satınalma';
  wb.created = new Date();
  const ws = wb.addWorksheet('TDF', { views: [{ showGridLines: false }] });
  const NC = 3 + 3 * nS + 3;
  const widths = [5, 30, 12, ...Array.from({ length: nS }, () => [11, 15, 13]).flat(), 19, 11, 11];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const { box, band } = helpers(ws, NC);
  const bc = 4 + 3 * nS; // en iyi fiyat bloğunun ilk sütunu
  const spanOf = (k: number) => [4 + 3 * k, 6 + 3 * k] as const;

  let row = 1;
  band(row, r.title, { size: 14, h: 30 }); row++;
  band(row, `Müşteri: АО «ГЭС Констракшн» · ${r.subtitle} · Hazırlayan: Satınalma`, { size: 9, color: NAVY2, h: 18, bold: false }); row += 2;

  if (!nS || !nMat) {
    box(row, row, 1, NC, 'Henüz teklif yüklenmedi.', { border: false });
    return wb;
  }

  // Özet kutuları
  const kp = r.kpis;
  const cuts = [1, Math.round(NC * 0.25) + 1, Math.round(NC * 0.5) + 1, Math.round(NC * 0.75) + 1, NC + 1];
  kp.slice(0, 4).forEach((k, i) => {
    const a = cuts[i], b = (i === kp.slice(0, 4).length - 1 ? NC : cuts[i + 1] - 1);
    box(row, row, a, b, k.k.toLocaleUpperCase('tr-TR'), { bg: GREY, fc: MUTED, sz: 8, b: true });
    box(row + 1, row + 1, a, b, k.v, { sz: 14, b: true });
    box(row + 2, row + 2, a, b, k.h, { fc: MUTED, sz: 9 });
  });
  ws.getRow(row + 1).height = 24;
  ws.getRow(row + 2).height = 26;
  row += 4;

  // Öneri
  if (r.reco) {
    band(row, 'SİSTEMİN ÖNERİSİ  ·  Рекомендация   (otomatik öneri, satınalmacı düzenleyebilir)', { size: 10, color: GOODF }); row++;
    const lines = [r.reco.headline, ...(r.reco.aiSummary ? [r.reco.aiSummary] : []), ...r.reco.lines.map((l, i) => `${i + 1}. ${l}`)];
    if (r.reco.userNote) lines.push(`Satınalmacının değerlendirmesi: ${r.reco.userNote}`);
    lines.forEach((t, i) => {
      box(row, row, 1, NC, t, { bg: GOOD, b: i === 0, sz: i === 0 ? 11 : 10 });
      ws.getRow(row).height = heightFor(t, totalWidth * 1.1, i === 0 ? 17 : 14, i === 0 ? 28 : 18);
      row++;
    });
    row++;
  }

  // 1 · Fiyat matrisi
  band(row, '1 · FİYAT KARŞILAŞTIRMASI  ·  Сравнение цен (₽ с НДС 22%)'); row++;
  const h1 = row, h2 = row + 1;
  box(h1, h2, 1, 1, '№', { bg: HEAD, b: true, sz: 9, al: 'center' });
  box(h1, h2, 2, 2, 'Açıklama\nОписание', { bg: HEAD, b: true, sz: 9, al: 'center' });
  box(h1, h2, 3, 3, `Miktar\nКол-во, ${r.unitLabel}`, { bg: HEAD, b: true, sz: 9, al: 'center' });
  S.forEach((s, k) => {
    const [a] = spanOf(k);
    box(h1, h1, a, a + 2, s.short, { bg: NAVY, fc: WHITE, b: true, sz: 11, al: 'center' });
    ['Birim fiyat KDV\'li\nЦена за ед.', 'Toplam fiyat\nОбщая стоимость', 'Marka · teslim\nБренд · срок'].forEach((t, j) => box(h2, h2, a + j, a + j, t, { bg: HEAD, b: true, sz: 8, al: 'center' }));
  });
  box(h1, h1, bc, bc + 2, 'En iyi fiyat · Лучшая цена', { bg: BEST, b: true, sz: 10, al: 'center' });
  ['Firma\nПоставщик ✓', 'Birim fiyat', '1. ile 2. fark\nРазница'].forEach((t, j) => box(h2, h2, bc + j, bc + j, t, { bg: BEST, b: true, sz: 8, al: 'center' }));
  ws.getRow(h2).height = 40;
  row = h2 + 1;
  const d0 = row;
  c.materials.forEach((m, i) => {
    const rr = row;
    ws.getCell(rr, 1).value = i + 1;
    const specText = materialSpecText(m);
    ws.getCell(rr, 2).value = specText ? { richText: [{ text: m.name, font: font({ bold: true }) }, { text: `\n${specText}`, font: font({ size: 8, color: { argb: MUTED } }) }] } : m.name;
    const q = ws.getCell(rr, 3); q.value = m.orderQty; q.numFmt = QTY;
    const comparableCols: string[] = [];
    let maxLen = m.name.length + (specText ? 30 : 0);
    S.forEach((s, k) => {
      const [a] = spanOf(k);
      const x = m.cells[s.key];
      if (!x) {
        for (let j = 0; j < 3; j++) { const e = ws.getCell(rr, a + j); e.value = '—'; e.alignment = { horizontal: 'center', vertical: 'middle' }; }
        return;
      }
      const p = ws.getCell(rr, a); p.value = Math.round(x.unitPrice * 100) / 100; p.numFmt = NUM;
      const t = ws.getCell(rr, a + 1); t.value = { formula: `C${rr}*${colL(a)}${rr}`, result: Math.round(x.total * 100) / 100 }; t.numFmt = NUM;
      const del = cellBrandNote(m, s.col);
      ws.getCell(rr, a + 2).value = del;
      maxLen = Math.max(maxLen, del.length * 0.9);
      const excluded = !!(x.warning && /Teknik fark|Birim farklı/.test(x.warning));
      if (!excluded && x.unitPrice > 0) comparableCols.push(`${colL(a)}${rr}`);
      if (x.warning || x.convertedFrom) {
        p.note = [x.warning, excluded ? 'Bu fiyat en iyi fiyat hesabına katılmadı.' : '', x.convertedFrom ? `Birim çevrildi: ${x.convertedFrom}` : ''].filter(Boolean).join('\n');
      }
      if (x.warning) { p.fill = fill(WARN); p.font = font({ bold: true, color: { argb: WARNF } }); }
    });
    const best = m.bestSuppliers.map(k => S.find(s => s.key === k)?.short || k).join(', ');
    ws.getCell(rr, bc).value = m.bestPrice === null ? 'Kıyaslanabilir fiyat yok' : `✓ ${best}`;
    const minCell = ws.getCell(rr, bc + 1);
    const diffCell = ws.getCell(rr, bc + 2);
    if (comparableCols.length && m.bestPrice !== null) {
      minCell.value = { formula: `MIN(${comparableCols.join(',')})`, result: m.bestPrice };
      diffCell.value = comparableCols.length > 1
        ? { formula: `IFERROR((SMALL((${comparableCols.join(',')}),2)-${colL(bc + 1)}${rr})/${colL(bc + 1)}${rr},"—")`, result: m.diffBestSecond ?? 0 }
        : '—';
    } else { minCell.value = null; diffCell.value = '—'; }
    minCell.numFmt = NUM; diffCell.numFmt = PCT;
    for (let cc = bc; cc < bc + 3; cc++) { ws.getCell(rr, cc).fill = fill(BEST); }
    ws.getCell(rr, bc).font = font({ bold: true });
    for (let cc = 1; cc <= NC; cc++) {
      const cell = ws.getCell(rr, cc);
      cell.border = BORDER;
      if (!cell.font || !cell.font.bold) cell.font = { ...font(), ...(cell.font || {}), name: 'Arial', size: cell.font?.size || 10 };
      const isNum = typeof cell.value === 'number' || (cell.value && typeof cell.value === 'object' && 'formula' in (cell.value as any));
      cell.alignment = { vertical: 'middle', horizontal: cc === 1 ? 'center' : (isNum ? 'right' : (cell.value === '—' ? 'center' : 'left')), wrapText: cc === 2 || (cc - 4) % 3 === 2 || cc === bc };
    }
    ws.getRow(rr).height = maxLen > 26 ? 28 : 17;
    row++;
  });
  const d1 = row - 1;
  // Koşullu biçim: satırda en düşük yeşil, en yüksek kırmızı (en az 3 fiyat varsa)
  const priceCols = S.map((_, k) => colL(spanOf(k)[0]));
  const rowRange = priceCols.map(x => `$${x}${d0}`).join(',');
  priceCols.forEach(pc => {
    ws.addConditionalFormatting({
      ref: `${pc}${d0}:${pc}${d1}`,
      rules: [
        { type: 'expression', priority: 1, formulae: [`AND(ISNUMBER(${pc}${d0}),${pc}${d0}=$${colL(bc + 1)}${d0})`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GOOD } }, font: { bold: true, color: { argb: GOODF } } } },
        { type: 'expression', priority: 2, formulae: [`AND(ISNUMBER(${pc}${d0}),${pc}${d0}=MAX(${rowRange}),COUNT(${rowRange})>2,${pc}${d0}<>$${colL(bc + 1)}${d0})`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: BAD } }, font: { color: { argb: BADF } } } }
      ]
    });
  });
  // Toplamlar
  const matRow = row;
  box(row, row, 1, 3, 'Malzeme toplamı · Материалы (с НДС 22%)', { bg: GREY, b: true, sz: 9 });
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    box(row, row, a, b, { formula: `SUBTOTAL(9,${colL(a + 1)}${d0}:${colL(a + 1)}${d1})`, result: Math.round(s.col.total * 100) / 100 }, { bg: GREY, al: 'right', fmt: NUM });
  });
  box(row, row, bc, bc + 2, { formula: `SUMPRODUCT(C${d0}:C${d1},${colL(bc + 1)}${d0}:${colL(bc + 1)}${d1})`, result: Math.round(c.mixTotal * 100) / 100 }, { bg: GREY, al: 'right', fmt: NUM });
  row++;
  const frRow = row;
  box(row, row, 1, 3, 'Nakliye · Доставка', { bg: GREY, b: true, sz: 9 });
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    const sep = s.col.freightMode === 'separate';
    const miss = s.col.freightMode === 'missing';
    box(row, row, a, b, sep ? s.col.freight : freightText(s.col), { bg: miss ? WARN : GREY, fc: miss ? WARNF : BLACK, b: miss, sz: 9, al: sep ? 'right' : 'center', fmt: sep ? NUM : undefined });
  });
  box(row, row, bc, bc + 2, 'kalem kalem en iyi (nakliye hariç)', { bg: GREY, sz: 8, al: 'center' });
  row++;
  box(row, row, 1, 3, 'GENEL TOPLAM · ИТОГО (nakliye dahil, с НДС 22%)', { bg: SUM, b: true });
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    const fr = `${colL(a)}${frRow}`;
    box(row, row, a, b, { formula: `${colL(a)}${matRow}+IF(ISNUMBER(${fr}),${fr},0)`, result: Math.round(s.col.grandTotal * 100) / 100 }, { bg: SUM, b: true, al: 'right', fmt: NUM });
  });
  box(row, row, bc, bc + 2, '', { bg: SUM });
  ws.getRow(row).height = 20; row++;
  box(row, row, 1, 3, 'Kalem sayısı · Позиций', { bg: GREY, b: true, sz: 9 });
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    const full = s.col.covered === nMat;
    box(row, row, a, b, `${s.col.covered}/${nMat}`, { bg: full ? GREY : WARN, fc: full ? BLACK : WARNF, b: !full, al: 'center', sz: 9 });
  });
  box(row, row, bc, bc + 2, '', { bg: GREY }); row++;
  (['payment', 'delivery', 'deliveryPlace'] as const).forEach(key => {
    box(row, row, 1, 3, TDF_TERM_ROWS.find(x => x.key === key)!.label, { bg: GREY, b: true, sz: 9 });
    let hh = 20;
    S.forEach((s, k) => {
      const [a, b] = spanOf(k);
      const t = s.col.offer.terms?.[key];
      const v = termText(s.col, key);
      const text = v ? `${v}${t?.conflict ? `\n! ${t.conflict}` : ''}` : 'TEKLİFTE YOK';
      const bad = !v || !!t?.conflict;
      box(row, row, a, b, text, { bg: bad ? WARN : GREY, fc: bad ? WARNF : BLACK, b: bad, sz: 9, al: 'center' });
      hh = Math.max(hh, heightFor(text, 36, 13, 20));
    });
    box(row, row, bc, bc + 2, '', { bg: GREY }); ws.getRow(row).height = hh; row++;
  });
  box(row, row, 1, 3, 'Satınalmacının notu · Примечание', { bg: GREY, b: true, sz: 9 });
  let noteH = 30;
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    const v = (s.col.offer.note || '').trim();
    box(row, row, a, b, v, { bg: GREY, sz: 8 });
    noteH = Math.max(noteH, heightFor(v, 40, 12, 30));
  });
  box(row, row, bc, bc + 2, '', { bg: GREY }); ws.getRow(row).height = Math.min(noteH, 160); row += 2;

  // Kıyaslanabilir hacim
  if (c.comparisons.length) {
    band(row, 'KIYASLANABİLİR HACİMDE KARŞILAŞTIRMA  ·  Сравнение на сопоставимом объёме', { size: 10, color: NAVY2 }); row++;
    const cA = Math.max(4, Math.round(NC * 0.45)), cB = Math.min(NC - 3, cA + 3), cC = Math.min(NC - 1, cB + 2);
    box(row, row, 1, cA, 'Karşılaştırma', { bg: HEAD, b: true, sz: 9 });
    box(row, row, cA + 1, cB, 'Fark, ₽', { bg: HEAD, b: true, sz: 9, al: 'center' });
    box(row, row, cB + 1, cC, 'Fark, %', { bg: HEAD, b: true, sz: 9, al: 'center' });
    box(row, row, cC + 1, NC, 'Açıklama', { bg: HEAD, b: true, sz: 9 }); row++;
    c.comparisons.forEach(x => {
      box(row, row, 1, cA, x.label, { sz: 9 });
      box(row, row, cA + 1, cB, Math.round(x.diff), { al: 'right', b: true, fmt: '+#,##0;-#,##0;0', fc: x.diff > 0 ? BADF : GOODF });
      box(row, row, cB + 1, cC, x.pct, { al: 'right', fmt: '+0.0%;-0.0%;0.0%' });
      box(row, row, cC + 1, NC, x.note, { sz: 9, fc: DARK });
      ws.getRow(row).height = 18; row++;
    });
    row++;
  }

  // Uyarılar
  band(row, 'DİKKAT EDİLECEK NOKTALAR  ·  Риски и замечания   (sistem otomatik buldu)', { size: 10, color: REDBAND }); row++;
  const wA = Math.max(6, Math.round(NC * 0.55));
  box(row, row, 1, 2, 'Seviye', { bg: HEAD, b: true, sz: 9 });
  box(row, row, 3, wA, 'Tespit · Замечание', { bg: HEAD, b: true, sz: 9 });
  box(row, row, wA + 1, NC, 'Ne yapılmalı · Действие', { bg: HEAD, b: true, sz: 9 }); row++;
  const lvColor = { critical: [BAD, BADF], warning: [WARN, WARNF], info: [INFO, INFOF] } as const;
  if (!c.warnings.length) { box(row, row, 1, NC, 'Otomatik kontrolde sorun bulunmadı.', { sz: 9 }); row++; }
  c.warnings.forEach(w => {
    const [bg, fc] = lvColor[w.level];
    box(row, row, 1, 2, TDF_LEVEL_LABEL[w.level].toLocaleUpperCase('tr-TR'), { bg, fc, b: true, sz: 9, al: 'center' });
    box(row, row, 3, wA, w.text, { sz: 9 });
    box(row, row, wA + 1, NC, w.action, { sz: 9, fc: DARK });
    ws.getRow(row).height = Math.max(heightFor(w.text, totalWidth * 0.5, 13, 20), heightFor(w.action, totalWidth * 0.4, 13, 20));
    row++;
  });
  box(row, row, 1, NC, `Sistemin her teklifte aradığı farklar: ${r.checkedDifferences.join(' · ')}`, { bg: GREY, fc: MUTED, sz: 8, border: false });
  ws.getRow(row).height = 24; row += 2;

  // 2 · Ticari şartlar
  band(row, '2 · TİCARİ ŞARTLAR  ·  Коммерческие условия'); row++;
  box(row, row, 1, 3, 'Şart · Условие', { bg: HEAD, b: true, sz: 9 });
  S.forEach((s, k) => { const [a, b] = spanOf(k); box(row, row, a, b, s.short, { bg: NAVY, fc: WHITE, b: true, al: 'center' }); });
  box(row, row, bc, bc + 2, '', { bg: HEAD }); row++;
  const termRows: Array<{ label: string; get: (sx: typeof S[number]) => { text: string; bad: boolean } }> = [
    ...TDF_TERM_ROWS.map(tr => ({
      label: tr.label,
      get: (sx: typeof S[number]) => {
        const t = sx.col.offer.terms?.[tr.key];
        const v = termText(sx.col, tr.key);
        const optional = tr.key === 'warranty';
        const raw = t?.raw && t.raw !== v ? `\nTeklifte: ${t.raw}` : '';
        return { text: v ? `${v}${t?.source === 'user' ? ' (elle)' : ''}${raw}${t?.conflict ? `\n! ${t.conflict}` : ''}` : (optional ? '—' : 'Teklifte yok'), bad: (!v && !optional) || !!t?.conflict };
      }
    })),
    { label: 'Nakliye · Доставка', get: sx => ({ text: freightText(sx.col), bad: sx.col.freightMode === 'missing' }) },
    { label: 'Belge · Документ', get: sx => ({ text: r.documents.find(d => d.supplier === sx.short)?.current || '', bad: false }) },
    { label: 'INN', get: sx => ({ text: sx.col.offer.inn || '—', bad: false }) }
  ];
  termRows.forEach(tr => {
    box(row, row, 1, 3, tr.label, { bg: GREY, b: true, sz: 9 });
    let hh = 20;
    S.forEach((s, k) => {
      const [a, b] = spanOf(k);
      const { text, bad } = tr.get(s);
      box(row, row, a, b, text, { bg: bad ? WARN : undefined, fc: bad ? WARNF : BLACK, sz: 9 });
      hh = Math.max(hh, heightFor(text, 38, 13, 20));
    });
    box(row, row, bc, bc + 2, '');
    ws.getRow(row).height = hh; row++;
  });
  row++;

  // 3 · Kalite
  band(row, `3 · MALZEME VE KALİTE DEĞERLENDİRMESİ  ·  Качество${form.ai?.generatedAt ? '   (yapay zekâ araştırması, kontrol edilmeli)' : ''}`); row++;
  if (r.qualityItems.length) {
    r.qualityItems.forEach(q => {
      const text = [q.text, q.product ? `Ürün: ${q.product}` : '', q.brand ? `Marka: ${q.brand}` : '', q.notes ? `Not: ${q.notes}` : ''].filter(Boolean).join('\n');
      box(row, row, 1, 3, `${q.title}${q.source === 'user' ? ' (satınalmacı)' : ''}`, { bg: GREY, b: true, sz: 9 });
      box(row, row, 4, NC, text, { sz: 9 });
      ws.getRow(row).height = heightFor(text, totalWidth - 47, 13, 22); row++;
    });
    if (form.ai?.sources?.length) { box(row, row, 1, NC, `Kaynaklar: ${form.ai.sources.slice(0, 8).join(' · ')}`, { fc: MUTED, sz: 8, border: false }); row++; }
  } else {
    box(row, row, 1, NC, 'Kalite değerlendirmesi henüz yapılmadı (yapay zekâ değerlendirmesi veya satınalmacı yorumu ile dolar).', { fc: MUTED, sz: 9, border: false }); row++;
  }
  row++;

  // 4 · Firma güvenilirliği
  band(row, '4 · FİRMA GÜVENİLİRLİĞİ  ·  Надёжность поставщика'); row++;
  const vCols = [[1, 2], [3, 3 + Math.max(1, Math.floor((NC - 3) * 0.12))]] as Array<[number, number]>;
  const rest = NC - vCols[1][1];
  const step = Math.max(1, Math.floor(rest / 4));
  for (let i = 0; i < 4; i++) { const a = vCols[vCols.length - 1][1] + 1; vCols.push([a, i === 3 ? NC : Math.min(NC, a + step - 1)]); }
  ['Firma', 'INN', 'Bizdeki geçmiş alımlar', 'Durum · kuruluş · sermaye', 'Risk', 'Not, yorumlar ve kaynak'].forEach((t, i) => box(row, row, vCols[i][0], vCols[i][1], t, { bg: HEAD, b: true, sz: 9 }));
  row++;
  r.vendorRows.forEach(v => {
    const vals = [v.name, v.inn || '—', v.history || '—', v.aiStatus || '—', v.aiRisk || '—', [v.aiNotes, v.aiReviews ? `Yorumlar: ${v.aiReviews}` : '', ...v.sources.slice(0, 3)].filter(Boolean).join('\n')];
    vals.forEach((t, i) => box(row, row, vCols[i][0], vCols[i][1], t, { sz: 9, b: i === 0 }));
    ws.getRow(row).height = heightFor(vals[5], 40, 12, 20); row++;
  });
  if (!form.ai?.vendorChecks || !Object.keys(form.ai.vendorChecks).length) {
    box(row, row, 1, NC, 'Durum, sermaye ve risk sütunları yapay zekâ değerlendirmesi çalıştırılınca kaynaklı olarak dolar. Bilgi bulunamazsa boş kalır, tahmin yazılmaz.', { fc: MUTED, sz: 8, border: false }); row++;
  }
  if (r.lastPrices.length) {
    row++;
    const lp = [[1, 3], [4, 6], [7, 8], [9, 11], [12, 14], [15, NC]] as Array<[number, number]>;
    if (NC < 15) lp.splice(0, lp.length, [1, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, NC]);
    ['Bizdeki son alış fiyatı · Последняя закупка', 'Son alış (KDV dahil)', 'Tarih', 'Firma', 'Bu TDF\'deki en iyi', 'Fark'].forEach((t, i) => box(row, row, lp[i][0], lp[i][1], t, { bg: HEAD, b: true, sz: 9 }));
    row++;
    r.lastPrices.forEach(x => {
      box(row, row, lp[0][0], lp[0][1], x.material, { sz: 9 });
      box(row, row, lp[1][0], lp[1][1], x.lastPrice, { sz: 9, al: 'right', fmt: `#,##0" ₽/${x.unit}"` });
      box(row, row, lp[2][0], lp[2][1], x.date, { sz: 9 });
      box(row, row, lp[3][0], lp[3][1], x.supplier, { sz: 9 });
      box(row, row, lp[4][0], lp[4][1], x.best ?? '—', { sz: 9, al: 'right', fmt: NUM });
      const up = x.diffPct !== null && x.diffPct > 0.05;
      box(row, row, lp[5][0], lp[5][1], x.diffPct ?? '—', { sz: 9, al: 'right', fmt: '+0.0%;-0.0%;0.0%', bg: up ? BAD : (x.diffPct !== null && x.diffPct < 0 ? GOOD : undefined), fc: up ? BADF : BLACK });
      row++;
    });
  }
  row++;

  // 5 · Puanlama
  const W = c.weights;
  band(row, '5 · PUANLAMA  ·  Оценка   (ağırlıklar değiştirilebilir)'); row++;
  box(row, row, 1, 3, 'Ölçüt (ağırlık)', { bg: HEAD, b: true, sz: 9 });
  S.forEach((s, k) => { const [a, b] = spanOf(k); box(row, row, a, b, s.short, { bg: NAVY, fc: WHITE, b: true, al: 'center' }); });
  row++;
  const ps = row;
  const scoreRows: Array<[string, (x: typeof c.scores[number]) => number | string]> = [
    [`Fiyat (${W.price})`, x => (x.price === null ? '—' : x.price)],
    [`Kapsam (${W.coverage})`, x => x.coverage],
    [`Ödeme vadesi (${W.payment})`, x => x.payment],
    [`Teslim ve stok (${W.delivery})`, x => x.delivery],
    [`Belge eksiksizliği (${W.documents})`, x => x.documents]
  ];
  scoreRows.forEach(([label, fn]) => {
    box(row, row, 1, 3, label, { sz: 9 });
    S.forEach((s, k) => { const [a, b] = spanOf(k); box(row, row, a, b, fn(c.scores.find(x => x.supplierKey === s.key)!), { al: 'center' }); });
    row++;
  });
  const maxTotal = Math.max(...c.scores.map(x => x.total));
  box(row, row, 1, 3, 'TOPLAM (100)', { bg: SUM, b: true });
  S.forEach((s, k) => {
    const [a, b] = spanOf(k);
    const t = c.scores.find(x => x.supplierKey === s.key)!.total;
    box(row, row, a, b, { formula: `SUM(${colL(a)}${ps}:${colL(a)}${row - 1})`, result: t }, { bg: t === maxTotal ? GOOD : SUM, fc: t === maxTotal ? GOODF : BLACK, b: true, al: 'center' });
  });
  row++;
  box(row, row, 1, NC, 'Fiyat puanı ortak kalemler üzerinden hesaplanır; her %1 pahalılık fiyat puanının %5\'ini düşürür. Kalemlerin yarısından azına fiyat veren firma fiyatta puanlanmaz.', { fc: MUTED, sz: 8, border: false });
  row += 3;

  // İmzalar
  const third = Math.floor(NC / 3);
  [[1, third - 1], [third + 1, 2 * third - 1], [2 * third + 1, NC]].forEach(([a, b], i) => {
    box(row, row, a, b, ['Hazırlayan · Подготовил', 'Kontrol · Проверил', 'Onay · Утвердил'][i], { fc: MUTED, sz: 9, border: false });
    for (let cc = a; cc <= b; cc++) ws.getCell(row, cc).border = { top: { style: 'medium', color: { argb: BLACK } } };
  });
  ws.getRow(row + 1).height = 30;

  ws.pageSetup = {
    orientation: 'landscape', paperSize: 8 as any, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printArea: `A1:${colL(NC)}${row + 1}`, ...(nMat > 25 ? { printTitlesRow: `${h1}:${h2}` } : {}),
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 }
  };
  ws.headerFooter = { oddFooter: `&C${form.code} · Sayfa &P / &N` };

  // Miktar sayfası
  const m = wb.addWorksheet('Miktar · Заказ', { views: [{ showGridLines: false, state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const mh = ['№', 'Kalem', 'Sipariş', 'Birim', ...S.map(s => s.short), 'Not'];
  [5, 30, 12, 7, ...S.map(() => 14), 44].forEach((w, i) => { m.getColumn(i + 1).width = w; });
  m.mergeCells(1, 1, 1, mh.length);
  const mt = m.getCell(1, 1); mt.value = 'SİPARİŞ MİKTARI VE TEKLİF MİKTARI · Объём заказа и объёмы в КП'; mt.font = font({ bold: true, size: 12, color: { argb: WHITE } }); mt.fill = fill(NAVY); m.getRow(1).height = 24;
  mh.forEach((t, j) => {
    const cell = m.getCell(3, j + 1); cell.value = t;
    const sup = j >= 4 && j < 4 + nS;
    cell.font = font({ bold: true, size: 9, color: { argb: sup ? WHITE : BLACK } }); cell.fill = fill(sup ? NAVY : HEAD); cell.border = BORDER; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  c.materials.forEach((mat, i) => {
    const rr = 4 + i;
    m.getCell(rr, 1).value = i + 1; m.getCell(rr, 2).value = mat.name;
    const q = m.getCell(rr, 3); q.value = mat.orderQty; q.numFmt = QTY;
    m.getCell(rr, 4).value = TDF_UNIT_LABEL[mat.unit] || mat.unit;
    const notes: string[] = [];
    S.forEach((s, k) => {
      const x = mat.cells[s.key];
      const cell = m.getCell(rr, 5 + k);
      if (!x) { cell.value = '—'; cell.alignment = { horizontal: 'center' }; return; }
      cell.value = Math.round(x.quantity * 1000) / 1000; cell.numFmt = QTY;
      if (mat.orderQty > 0 && Math.abs(x.quantity - mat.orderQty) / mat.orderQty > 0.0005) {
        cell.fill = fill(WARN); cell.font = font({ bold: true, color: { argb: WARNF } });
        notes.push(`${s.short}: ${tdfFormat.qty(x.quantity)}`);
      }
    });
    if (notes.length) { const n = m.getCell(rr, 5 + nS); n.value = `Miktar farklı: ${notes.join(' · ')}`; n.font = font({ size: 9, color: { argb: WARNF } }); }
    for (let j = 1; j <= mh.length; j++) { const cell = m.getCell(rr, j); cell.border = BORDER; if (!cell.font?.bold) cell.font = { ...font(), ...(cell.font || {}), name: 'Arial' }; }
  });
  const tr = 4 + nMat;
  m.getCell(tr, 2).value = 'TOPLAM'; m.getCell(tr, 2).font = font({ bold: true });
  [3, ...S.map((_, k) => 5 + k)].forEach(j => {
    const cell = m.getCell(tr, j);
    const sum = j === 3 ? c.orderTotalQty : c.materials.reduce((a, mat) => a + (mat.cells[S[j - 5].key]?.quantity || 0), 0);
    cell.value = { formula: `SUM(${colL(j)}4:${colL(j)}${tr - 1})`, result: Math.round(sum * 1000) / 1000 };
    cell.numFmt = QTY; cell.font = font({ bold: true }); cell.fill = fill(SUM); cell.border = BORDER;
  });

  // İndirim takibi
  const d = wb.addWorksheet('İndirim takibi', { views: [{ showGridLines: false }] });
  [24, 18, 18, 16, 11, 60].forEach((w, i) => { d.getColumn(i + 1).width = w; });
  d.mergeCells(1, 1, 1, 6);
  const dt = d.getCell(1, 1); dt.value = 'İNDİRİM TAKİBİ · Динамика цен и скидки'; dt.font = font({ bold: true, size: 12, color: { argb: WHITE } }); dt.fill = fill(NAVY); d.getRow(1).height = 24;
  ['Firma', 'İlk teklif, ₽ · Было', 'Güncel, ₽ · Стало', 'İndirim, ₽', 'İndirim, %', 'Belgeler (ilk → güncel)'].forEach((t, j) => {
    const cell = d.getCell(3, j + 1); cell.value = t; cell.font = font({ bold: true, size: 9 }); cell.fill = fill(HEAD); cell.border = BORDER; cell.alignment = { horizontal: 'center', wrapText: true };
  });
  S.forEach((s, i) => {
    const rr = 4 + i;
    const first = s.col.firstTotal ?? s.col.total;
    const doc = r.documents.find(x => x.supplier === s.short)!;
    d.getCell(rr, 1).value = s.short;
    d.getCell(rr, 2).value = Math.round(first * 100) / 100; d.getCell(rr, 2).numFmt = NUM;
    d.getCell(rr, 3).value = Math.round(s.col.total * 100) / 100; d.getCell(rr, 3).numFmt = NUM;
    d.getCell(rr, 4).value = { formula: `B${rr}-C${rr}`, result: Math.round((first - s.col.total) * 100) / 100 }; d.getCell(rr, 4).numFmt = NUM;
    d.getCell(rr, 5).value = { formula: `IF(B${rr}=0,"—",D${rr}/B${rr})`, result: first ? (first - s.col.total) / first : 0 }; d.getCell(rr, 5).numFmt = PCT;
    d.getCell(rr, 6).value = doc.previous.length ? `${doc.previous.join(', ')} → ${doc.current}` : 'Tek teklif, değişiklik yok';
    for (let j = 1; j <= 6; j++) { d.getCell(rr, j).border = BORDER; d.getCell(rr, j).font = font(); d.getCell(rr, j).alignment = { wrapText: j === 6, vertical: 'middle' }; }
    if (first - s.col.total > 0.5) for (const j of [4, 5]) { d.getCell(rr, j).fill = fill(GOOD); d.getCell(rr, j).font = font({ bold: true, color: { argb: GOODF } }); }
  });
  d.getCell(5 + nS, 1).value = 'İlk teklif tutarı, güncel teklifteki kalemler ve sipariş miktarı üzerinden hesaplanır.';
  d.getCell(5 + nS, 1).font = font({ size: 9, italic: true, color: { argb: MUTED } });

  // Teklif belgeleri
  const e = wb.addWorksheet('Teklif belgeleri', { views: [{ showGridLines: false }] });
  [24, 56, 70].forEach((w, i) => { e.getColumn(i + 1).width = w; });
  e.mergeCells(1, 1, 1, 3);
  const et = e.getCell(1, 1); et.value = 'TEKLİF BELGELERİ · КП / Счета'; et.font = font({ bold: true, size: 12, color: { argb: WHITE } }); et.fill = fill(NAVY); e.getRow(1).height = 24;
  ['Firma', 'Belge', 'Satınalmacının notu'].forEach((t, j) => { const cell = e.getCell(3, j + 1); cell.value = t; cell.font = font({ bold: true, size: 9 }); cell.fill = fill(HEAD); cell.border = BORDER; });
  r.documents.forEach((doc, i) => {
    const rr = 4 + i;
    const vals = [doc.supplier, [doc.current, ...doc.previous.map(p => `Önceki: ${p}`)].join('\n'), doc.note];
    vals.forEach((v, j) => { const cell = e.getCell(rr, j + 1); cell.value = v; cell.font = font({ bold: j === 0 }); cell.border = BORDER; cell.alignment = { wrapText: true, vertical: 'top' }; });
    e.getRow(rr).height = Math.max(heightFor(vals[1], 56, 13, 30), heightFor(vals[2], 70, 13, 30));
  });

  return wb;
}

export async function buildTdfXlsxBuffer(form: TdfForm, opts: { todayIso?: string; computed?: TdfComputed } = {}): Promise<Buffer> {
  const wb = await buildTdfWorkbook(form, opts);
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

export const tdfExcelInternals = { colL, rub: tdfFormat.rub, pct: tdfFormat.pct };
