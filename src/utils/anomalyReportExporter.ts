/**
 * Admin Fiyat Anomali Denetimi — Kalem Bazlı Karşılaştırmalı Rapor & İndirme Motoru
 * TDF (Teklif Değerlendirme Formu) görsel dilini (lacivert başlık bantları, KPI özet kutuları,
 * gruplanmış sütun başlıkları, yeşil/kırmızı fiyat vurguları ve Excel formülleri) izler.
 */
import ExcelJS from 'exceljs';
import { DiscountHistoricalAnomalyRecord } from '../types';

export interface AnomalyReportFlatRow {
  rowNo: number;
  recordSource: 'DISCOUNT_CENTER' | 'DIRECT_INVOICE';
  recordSourceLabel: string;
  invoiceNo: string;
  orderDate: string;
  vendorName: string;
  jobsiteName: string;
  supervisorName: string;
  currentOriginalRussianName: string;
  currentTurkishName: string;
  historicalOriginalRussianName: string;
  historicalInvoiceNo: string;
  historicalDate: string;
  historicalSupplier: string;
  historicalJobsiteName: string;
  historicalSourceLabel: string;
  quantity: number;
  unit: string;
  currentUnitPrice: number;
  historicalBestUnitPrice: number;
  unitOverpayment: number;
  overpaymentPercentage: number;
  totalLineOverpayment: number;
}

export interface AnomalyReportOptions {
  filterLabel?: string;
  generatedBy?: string;
  todayIso?: string;
  embedded?: boolean;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtRub = (n: number) =>
  Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtIntRub = (n: number) => {
  const val = Number(n || 0);
  return Math.abs(val - Math.round(val)) >= 0.005
    ? val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(val).toLocaleString('tr-TR');
};

const fmtDate = (raw?: string) => {
  const s = String(raw || '').trim();
  if (!s || s === '-') return '-';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10).split('-').reverse().join('.');
  }
  return s;
};

export function flattenAnomalyRecordsToRows(
  anomalies: DiscountHistoricalAnomalyRecord[]
): AnomalyReportFlatRow[] {
  const rows: AnomalyReportFlatRow[] = [];
  let counter = 1;

  for (const anom of anomalies || []) {
    const src = anom.recordSource === 'DIRECT_INVOICE' ? 'DIRECT_INVOICE' : 'DISCOUNT_CENTER';
    const srcLabel =
      src === 'DIRECT_INVOICE'
        ? 'AI Otomatik Fatura Okuma (Doğrudan)'
        : 'Şef İndirim & Teklif Merkezi';

    for (const line of anom.affectedLines || []) {
      const curRus = String(line.originalName || line.materialName || '').trim();
      const curTr = String(line.materialName || '').trim();
      const hisRus = String(line.historicalOriginalName || line.originalName || line.materialName || '').trim();

      rows.push({
        rowNo: counter++,
        recordSource: src,
        recordSourceLabel: srcLabel,
        invoiceNo: anom.invoiceNo || '-',
        orderDate: fmtDate(anom.orderDate),
        vendorName: anom.vendorName || '-',
        jobsiteName: anom.jobsiteName || '-',
        supervisorName: anom.supervisorName || '-',
        currentOriginalRussianName: curRus,
        currentTurkishName: curTr && curTr !== curRus ? curTr : '',
        historicalOriginalRussianName: hisRus,
        historicalInvoiceNo: line.historicalInvoiceNo || '-',
        historicalDate: fmtDate(line.historicalDate),
        historicalSupplier: line.historicalSupplier || '-',
        historicalJobsiteName: line.historicalJobsiteName || '-',
        historicalSourceLabel: line.historicalSource === 'PRIZMA_ERP' ? 'Prizma ERP' : 'GES Arşivi',
        quantity: Number(line.quantity) || 1,
        unit: line.unit || 'Adet',
        currentUnitPrice: Number(line.currentUnitPrice) || 0,
        historicalBestUnitPrice: Number(line.historicalBestUnitPrice) || 0,
        unitOverpayment: Number(line.unitOverpayment) || 0,
        overpaymentPercentage: Number(line.overpaymentPercentage) || 0,
        totalLineOverpayment: Number(line.totalLineOverpayment) || 0
      });
    }
  }

  return rows;
}

const REPORT_CSS = `
:root{--ink:#0f1b2d;--muted:#5a6579;--line:#c9cfda;--navy:#102c54;--navy2:#1e3f6e;--head:#d6dce4;--sum:#d9e1f2;--best:#ffeb9c;
--accent:#2f5bd3;--accent-soft:#e9efff;--good:#0b7a4b;--good-soft:#e2f5ec;--warn:#a15c00;--warn-soft:#fff3d6;--bad:#b42318;--bad-soft:#fde8e6;--grey:#f5f6f8}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--ink);font-family:"IBM Plex Sans","Segoe UI",Arial,system-ui,sans-serif;font-size:11.5px;line-height:1.38}
.paper{max-width:1680px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.ph{background:var(--navy);color:#fff;padding:16px 22px;display:flex;justify-content:space-between;gap:16px;border-radius:6px}
.ph .t{font-size:17px;font-weight:800;letter-spacing:.01em}
.ph .s{font-size:11.5px;opacity:.9;margin-top:4px}
.ph .logo{font-weight:900;font-size:22px;letter-spacing:.08em;align-self:center;background:rgba(255,255,255,.12);padding:6px 14px;border-radius:6px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{border:1px solid var(--line);border-radius:6px;padding:10px 14px;background:var(--grey)}
.kpi .k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.kpi .v{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px;color:var(--navy)}
.kpi.bad .v{color:var(--bad)}
.kpi .h{font-size:11px;color:var(--muted);margin-top:2px}
.noteBox{border:1.5px solid var(--navy2);background:var(--accent-soft);border-radius:6px;padding:10px 14px;font-size:11.5px;color:var(--ink)}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border:1px solid var(--line);padding:5px 7px;text-align:left;vertical-align:middle}
thead th.grp1{background:var(--navy);color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.grp2{background:#0b5d3b;color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.grp3{background:#8a1c12;color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.sub{background:var(--head);color:var(--ink);font-size:10.5px;font-weight:700;line-height:1.25}
thead th.sub .ru{display:block;font-weight:400;font-size:9.5px;color:var(--muted)}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.c{text-align:center}
td.curP{background:var(--bad-soft);color:var(--bad);font-weight:700}
td.bestP{background:var(--good-soft);color:var(--good);font-weight:700}
td.diffP{background:var(--best);color:var(--bad);font-weight:800}
.rusOrig{font-family:"IBM Plex Mono","Consolas",monospace;font-weight:700;font-size:11px;color:#0f172a;display:block}
.trSub{font-size:10px;color:var(--muted);display:block;margin-top:2px}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:700}
.badge.disc{background:#e0e7ff;color:#1e3a8a}
.badge.dir{background:#fef3c7;color:#92400e}
.badge.prizma{background:#dbeafe;color:#1e40af}
.badge.ges{background:#dcfce7;color:#166534}
tr.grand td{background:var(--sum);font-weight:800;font-size:12px}
tr{break-inside:avoid}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:14px}
.sign div{border-top:1.5px solid var(--ink);padding-top:6px;font-size:11px;color:var(--muted);min-height:48px}
.foot{font-size:10px;color:var(--muted);display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px}
@page{size:A3 landscape;margin:8mm}
@media print{.paper{padding:0;max-width:none}.ph,.kpi,td,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export function renderAnomalyReportHtml(
  anomalies: DiscountHistoricalAnomalyRecord[],
  opts: AnomalyReportOptions = {}
): string {
  const rows = flattenAnomalyRecordsToRows(anomalies);
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const dateStr = fmtDate(todayIso);
  const filterLabel = opts.filterLabel || 'Tüm Kaynaklar (Şef İndirim Merkezi + AI Otomatik Fatura Okuma)';
  const totalInvoices = anomalies.length;
  const totalLines = rows.length;
  const discountCenterInvoices = anomalies.filter(a => a.recordSource !== 'DIRECT_INVOICE').length;
  const directInvoices = anomalies.filter(a => a.recordSource === 'DIRECT_INVOICE').length;
  const totalOverpayment = rows.reduce((s, r) => s + r.totalLineOverpayment, 0);

  let body = `<div class="paper">`;
  body += `
    <div class="ph">
      <div>
        <div class="t">ADMİN FİYAT ANOMALİ VE BİREBİR ORİJİNAL RUSÇA MALZEME DENETİM RAPORU</div>
        <div class="s">Müşteri: АО «ГЭС Констракшн» · Kapsam: ${esc(filterLabel)} · Tarih: ${esc(dateStr)} · KDV (%22 НДС) Dahil Kıyaslama Tabanı</div>
      </div>
      <div class="logo">GES</div>
    </div>
  `;

  body += `
    <div class="kpis">
      <div class="kpi">
        <div class="k">TESPİT EDİLEN FATURA SAYISI</div>
        <div class="v">${totalInvoices} Fatura</div>
        <div class="h">${discountCenterInvoices} İndirim Merkezi · ${directInvoices} Doğrudan Fatura Okuma</div>
      </div>
      <div class="kpi">
        <div class="k">FİYAT FARKLI MALZEME KALEMİ</div>
        <div class="v">${totalLines} Kalem</div>
        <div class="h">Her satır %100 birebir aynı Rusça malzeme için kıyaslandı</div>
      </div>
      <div class="kpi">
        <div class="k">REFERANS KARŞILAŞTIRMA HAVUZU</div>
        <div class="v">GES Arşivi + Prizma ERP</div>
        <div class="h">Orijinal Rusça metin, marka, model, kalınlık, ölçü ve ГОСТ</div>
      </div>
      <div class="kpi bad">
        <div class="k">GEÇMİŞ EN UYGUN FİYATA GÖRE TOPLAM FARK</div>
        <div class="v">+${fmtIntRub(totalOverpayment)} ₽</div>
        <div class="h">Daha uygun referans birim fiyatlara göre oluşan toplam fark</div>
      </div>
    </div>
  `;

  body += `
    <div class="noteBox">
      <b>Doğrulama Kuralı (Проверка идентичности материала):</b> Bu raporda yalnızca faturadaki <b>orijinal Rusça yazılışı</b> üzerinden markası, modeli, kalınlığı, ölçüleri, yoğunluğu ve standardı (ГОСТ / ТУ) birebir aynı olan malzemeler listelenmiştir. Her satırda hem alınan faturadaki Rusça metin hem de en uygun referans faturadaki Rusça metin yan yana gösterilerek birebirlik teyit edilir.
    </div>
  `;

  body += `
    <table>
      <thead>
        <tr>
          <th colspan="6" class="grp1">1. DENETLENEN FATURA VE ALINAN MALZEME (ORİJİNAL RUSÇA)</th>
          <th colspan="4" class="grp2">2. EN UYGUN ALINAN REFERANS FATURA VE MALZEME (ORİJİNAL RUSÇA TEYİT)</th>
          <th colspan="5" class="grp3">3. MİKTAR, BİRİM FİYAT VE TOPLAM FARK ANALİZİ</th>
        </tr>
        <tr>
          <th class="sub">#<span class="ru">№</span></th>
          <th class="sub">Kaynak Modül<span class="ru">Источник</span></th>
          <th class="sub">Alınan Fatura & Tarih<span class="ru">Счет и дата</span></th>
          <th class="sub">Alınan Firma<span class="ru">Поставщик</span></th>
          <th class="sub">Şantiye & Şef<span class="ru">Объект / Рук.</span></th>
          <th class="sub">🇷🇺 Faturadaki Orijinal Rusça Kalem Adı<span class="ru">Наименование в счете (оригинал)</span></th>
          <th class="sub">🇷🇺 En Uygun Faturadaki Orijinal Rusça Adı (Teyit)<span class="ru">Эталонное наименование (оригинал)</span></th>
          <th class="sub">En Uygun Fatura & Tarih<span class="ru">Эталонный счет и дата</span></th>
          <th class="sub">En Uygun Firma & Kaynak<span class="ru">Поставщик эталона</span></th>
          <th class="sub">En Uygun Şantiye<span class="ru">Объект эталона</span></th>
          <th class="sub">Miktar<span class="ru">Кол-во</span></th>
          <th class="sub">Alınan Birim (₽)<span class="ru">Цена в счете</span></th>
          <th class="sub">En Uygun Birim (₽)<span class="ru">Лучшая цена</span></th>
          <th class="sub">Birim Fark (₽ / %)<span class="ru">Разница за ед.</span></th>
          <th class="sub">Toplam Fark (₽)<span class="ru">Сумма переплаты</span></th>
        </tr>
      </thead>
      <tbody>
  `;

  if (rows.length === 0) {
    body += `<tr><td colspan="15" class="c" style="padding:24px;color:var(--muted)">Seçili kriterlerde fiyat anomalisi içeren malzeme kalemi bulunmadı.</td></tr>`;
  } else {
    for (const r of rows) {
      const srcBadgeClass = r.recordSource === 'DIRECT_INVOICE' ? 'dir' : 'disc';
      const refBadgeClass = r.historicalSourceLabel === 'Prizma ERP' ? 'prizma' : 'ges';
      body += `
        <tr>
          <td class="c"><b>${r.rowNo}</b></td>
          <td><span class="badge ${srcBadgeClass}">${esc(r.recordSource === 'DIRECT_INVOICE' ? 'AI Fatura Okuma' : 'İndirim Merkezi')}</span></td>
          <td><b>#${esc(r.invoiceNo)}</b><span class="trSub">${esc(r.orderDate)}</span></td>
          <td><b>${esc(r.vendorName)}</b></td>
          <td><b>${esc(r.jobsiteName)}</b><span class="trSub">${esc(r.supervisorName)}</span></td>
          <td>
            <span class="rusOrig">${esc(r.currentOriginalRussianName)}</span>
            ${r.currentTurkishName ? `<span class="trSub">TR: ${esc(r.currentTurkishName)}</span>` : ''}
          </td>
          <td>
            <span class="rusOrig" style="color:#065f46">${esc(r.historicalOriginalRussianName)}</span>
          </td>
          <td><b>#${esc(r.historicalInvoiceNo)}</b><span class="trSub">${esc(r.historicalDate)}</span></td>
          <td>
            <b>${esc(r.historicalSupplier)}</b>
            <span class="trSub"><span class="badge ${refBadgeClass}">${esc(r.historicalSourceLabel)}</span></span>
          </td>
          <td><b>${esc(r.historicalJobsiteName)}</b></td>
          <td class="num">${r.quantity.toLocaleString('tr-TR')} ${esc(r.unit)}</td>
          <td class="num curP">${fmtRub(r.currentUnitPrice)} ₽</td>
          <td class="num bestP">${fmtRub(r.historicalBestUnitPrice)} ₽</td>
          <td class="num" style="color:var(--bad);font-weight:700">+${fmtRub(r.unitOverpayment)} ₽ (+%${r.overpaymentPercentage})</td>
          <td class="num diffP">+${fmtIntRub(r.totalLineOverpayment)} ₽</td>
        </tr>
      `;
    }
    body += `
      <tr class="grand">
        <td colspan="14" style="text-align:right">GENEL TOPLAM FİYAT FARKI (${rows.length} Malzeme Kalemi / ${totalInvoices} Fatura):</td>
        <td class="num" style="color:var(--bad)">+${fmtIntRub(totalOverpayment)} ₽</td>
      </tr>
    `;
  }

  body += `
      </tbody>
    </table>
    <div class="sign">
      <div><b>Hazırlayan / Denetim</b><br>GES Satınalma Denetim Sistemi (${esc(opts.generatedBy || 'Admin')})</div>
      <div><b>Satınalma Koordinatörlüğü Kontrolü</b><br>İmza / Tarih</div>
      <div><b>Yönetim Onayı</b><br>İmza / Tarih</div>
    </div>
    <div class="foot">
      <span>АО «ГЭС Констракшн» · Admin Fiyat Anomali Denetimi Kalem Bazlı Doğrulama Raporu</span>
      <span>Oluşturulma Tarihi: ${esc(dateStr)}</span>
    </div>
  </div>`;

  if (opts.embedded) {
    return `<style>${REPORT_CSS}</style>${body}`;
  }

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GES Admin Fiyat Anomali Raporu - ${esc(dateStr)}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}

/**
 * TDF (`server/tdfExcel.ts`) görsel dilinde şekilli, renkli, gruplanmış ve formüllü Excel (.xlsx) çıktısı üretir.
 */
export async function downloadAnomalyReportExcel(
  anomalies: DiscountHistoricalAnomalyRecord[],
  opts: AnomalyReportOptions = {}
): Promise<void> {
  const rows = flattenAnomalyRecordsToRows(anomalies);
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const dateStr = fmtDate(todayIso);
  const filterLabel = opts.filterLabel || 'Tüm Kaynaklar (Şef İndirim Merkezi + AI Otomatik Fatura Okuma)';

  const NAVY = 'FF102C54',
    NAVY2 = 'FF1E3F6E',
    GREENGROUP = 'FF0B5D3B',
    REDGROUP = 'FF8A1C12',
    HEAD = 'FFD6DCE4',
    SUM = 'FFD9E1F2',
    BEST = 'FFFFEB9C',
    GOOD = 'FFE2F5EC',
    GOODF = 'FF0B7A4B',
    BAD = 'FFFDE8E6',
    BADF = 'FFB42318',
    WARN = 'FFFFF3D6',
    WARNF = 'FFA15C00',
    INFO = 'FFE9EFFF',
    INFOF = 'FF2F5BD3',
    GREY = 'FFF5F6F8',
    WHITE = 'FFFFFFFF',
    BLACK = 'FF000000',
    MUTED = 'FF5A6579',
    LINE = 'FFC9CFDA';

  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: LINE } };
  const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: 'Arial', size: 10, ...o });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GES Satınalma Denetim Sistemi';
  wb.created = new Date();
  const ws = wb.addWorksheet('Fiyat Anomali Raporu', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 10 }]
  });

  const widths = [6, 18, 15, 13, 24, 22, 42, 42, 15, 13, 24, 20, 14, 14, 15, 15, 13, 18];
  const NC = widths.length;
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const box = (
    r1: number,
    r2: number,
    c1: number,
    c2: number,
    value: ExcelJS.CellValue,
    o: {
      bg?: string;
      fc?: string;
      b?: boolean;
      sz?: number;
      al?: 'left' | 'center' | 'right';
      border?: boolean;
      wrap?: boolean;
      fmt?: string;
    } = {}
  ) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
    const cell = ws.getCell(r1, c1);
    cell.value = value;
    cell.font = font({ bold: !!o.b, size: o.sz || 10, color: { argb: o.fc || BLACK } });
    cell.alignment = {
      horizontal: o.al || 'left',
      vertical: 'middle',
      wrapText: o.wrap !== false,
      indent: (o.al || 'left') === 'left' ? 1 : 0
    };
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

  let row = 1;
  box(row, row, 1, NC, 'ADMİN FİYAT ANOMALİ VE BİREBİR ORİJİNAL RUSÇA MALZEME DENETİM RAPORU (TDF FORMATI)', {
    bg: NAVY,
    fc: WHITE,
    b: true,
    sz: 14,
    border: false
  });
  ws.getRow(row).height = 30;
  row++;

  box(
    row,
    row,
    1,
    NC,
    `Müşteri: АО «ГЭС Констракшн» · Kapsam: ${filterLabel} · Tarih: ${dateStr} · Tüm fiyatlar НДС 22% dahil tabandadır`,
    { bg: NAVY2, fc: WHITE, b: false, sz: 9.5, border: false }
  );
  ws.getRow(row).height = 19;
  row += 2;

  // 4 KPI Summary Cards (Rows 4..6)
  const totalInvoices = anomalies.length;
  const totalLines = rows.length;
  const discountCenterInvoices = anomalies.filter(a => a.recordSource !== 'DIRECT_INVOICE').length;
  const directInvoices = anomalies.filter(a => a.recordSource === 'DIRECT_INVOICE').length;
  const totalOverpayment = rows.reduce((s, r) => s + r.totalLineOverpayment, 0);

  const kpiCards = [
    {
      k: 'TESPİT EDİLEN FATURA SAYISI',
      v: `${totalInvoices} Fatura`,
      h: `${discountCenterInvoices} İndirim Merkezi · ${directInvoices} AI Fatura Okuma`,
      c1: 1,
      c2: 4,
      vc: NAVY
    },
    {
      k: 'ETKİLENEN MALZEME KALEMİ',
      v: `${totalLines} Kalem`,
      h: 'Her satırda orijinal Rusça metin birebir doğrulandı',
      c1: 5,
      c2: 8,
      vc: NAVY
    },
    {
      k: 'KARŞILAŞTIRMA REFERANS HAVUZU',
      v: 'GES Arşivi + Prizma ERP',
      h: 'Marka, model, kalınlık, ölçü, yoğunluk ve ГОСТ %100 aynı',
      c1: 9,
      c2: 13,
      vc: GOODF
    },
    {
      k: 'GEÇMİŞ EN UYGUN FİYATA GÖRE TOPLAM FARK',
      v: `+${fmtIntRub(totalOverpayment)} ₽`,
      h: 'En az %1 ve üzeri birim fiyat farkı olan kalemler toplamı',
      c1: 14,
      c2: NC,
      vc: BADF
    }
  ];

  for (const kp of kpiCards) {
    box(row, row, kp.c1, kp.c2, kp.k, { bg: GREY, fc: MUTED, sz: 8.5, b: true });
    box(row + 1, row + 1, kp.c1, kp.c2, kp.v, { bg: WHITE, fc: kp.vc, sz: 14, b: true });
    box(row + 2, row + 2, kp.c1, kp.c2, kp.h, { bg: WHITE, fc: MUTED, sz: 9 });
  }
  ws.getRow(row).height = 17;
  ws.getRow(row + 1).height = 25;
  ws.getRow(row + 2).height = 19;
  row += 4;

  // Group Super-Headers (Row 9)
  box(row, row, 1, 7, '1. DENETLENEN FATURA VE ALINAN MALZEME (ORİJİNAL RUSÇA)', {
    bg: NAVY,
    fc: WHITE,
    b: true,
    sz: 10.5,
    al: 'center'
  });
  box(row, row, 8, 12, '2. EN UYGUN ALINAN REFERANS FATURA VE MALZEME (ORİJİNAL RUSÇA TEYİT)', {
    bg: GREENGROUP,
    fc: WHITE,
    b: true,
    sz: 10.5,
    al: 'center'
  });
  box(row, row, 13, NC, '3. MİKTAR, BİRİM FİYAT VE TOPLAM FİYAT FARKI ANALİZİ', {
    bg: REDGROUP,
    fc: WHITE,
    b: true,
    sz: 10.5,
    al: 'center'
  });
  ws.getRow(row).height = 24;
  row++;

  // Column Sub-Headers (Row 10)
  const colHeaders: Array<{ title: string; al?: 'left' | 'center' | 'right' }> = [
    { title: 'Sıra\n№', al: 'center' },
    { title: 'Kaynak Modül\nИсточник', al: 'center' },
    { title: 'Alınan Fatura No\n№ счета', al: 'center' },
    { title: 'Fatura Tarihi\nДата счета', al: 'center' },
    { title: 'Alınan Tedarikçi Firma\nПоставщик' },
    { title: 'Şantiye / Satınalma Şefi\nОбъект / Руководитель' },
    { title: '🇷🇺 Alınan Faturadaki Orijinal Rusça Malzeme Adı\nНаименование в проверяемом счете (оригинал)' },
    { title: '🇷🇺 En Uygun Faturadaki Orijinal Rusça Malzeme Adı (Teyit)\nЭталонное наименование в счете (оригинал)' },
    { title: 'En Uygun Fatura No\nЭталонный счет', al: 'center' },
    { title: 'En Uygun Tarih\nДата эталона', al: 'center' },
    { title: 'En Uygun Tedarikçi (Kaynak)\nПоставщик эталона' },
    { title: 'En Uygun Şantiye\nОбъект эталона' },
    { title: 'Miktar & Birim\nКол-во и ед.', al: 'right' },
    { title: 'Alınan Birim Fiyat (₽)\nЦена в счете', al: 'right' },
    { title: 'En Uygun Birim Fiyat (₽)\nЛучшая цена', al: 'right' },
    { title: 'Birim Fiyat Farkı (₽)\nРазница за ед.', al: 'right' },
    { title: 'Fark Oranı (%)\nРазница %', al: 'right' },
    { title: 'Toplam Fazla Ödeme (₽)\nСумма переплаты', al: 'right' }
  ];

  colHeaders.forEach((ch, idx) => {
    box(row, row, idx + 1, idx + 1, ch.title, {
      bg: HEAD,
      fc: BLACK,
      b: true,
      sz: 9.5,
      al: ch.al || 'left'
    });
  });
  ws.getRow(row).height = 30;
  row++;

  const firstDataRow = row;

  for (const r of rows) {
    const isDirect = r.recordSource === 'DIRECT_INVOICE';
    const curCellText = r.currentTurkishName
      ? `${r.currentOriginalRussianName}\n(TR: ${r.currentTurkishName})`
      : r.currentOriginalRussianName;

    box(row, row, 1, 1, r.rowNo, { al: 'center', b: true, bg: WHITE });
    box(row, row, 2, 2, isDirect ? 'AI Fatura Okuma' : 'İndirim Merkezi', {
      al: 'center',
      b: true,
      sz: 9,
      bg: isDirect ? WARN : INFO,
      fc: isDirect ? WARNF : INFOF
    });
    box(row, row, 3, 3, `#${r.invoiceNo}`, { al: 'center', b: true, bg: WHITE });
    box(row, row, 4, 4, r.orderDate, { al: 'center', bg: WHITE });
    box(row, row, 5, 5, r.vendorName, { b: true, bg: WHITE });
    box(row, row, 6, 6, `${r.jobsiteName}\n(${r.supervisorName})`, { sz: 9.5, bg: WHITE });
    box(row, row, 7, 7, curCellText, { b: true, sz: 9.5, bg: WHITE });
    box(row, row, 8, 8, r.historicalOriginalRussianName, {
      b: true,
      sz: 9.5,
      bg: GOOD,
      fc: GOODF
    });
    box(row, row, 9, 9, `#${r.historicalInvoiceNo}`, { al: 'center', b: true, bg: WHITE });
    box(row, row, 10, 10, r.historicalDate, { al: 'center', bg: WHITE });
    box(row, row, 11, 11, `${r.historicalSupplier}\n[${r.historicalSourceLabel}]`, {
      b: true,
      sz: 9.5,
      bg: WHITE
    });
    box(row, row, 12, 12, r.historicalJobsiteName, { sz: 9.5, bg: WHITE });
    box(row, row, 13, 13, `${r.quantity.toLocaleString('tr-TR')} ${r.unit}`, {
      al: 'right',
      b: true,
      bg: WHITE
    });
    box(row, row, 14, 14, r.currentUnitPrice, {
      al: 'right',
      b: true,
      bg: BAD,
      fc: BADF,
      fmt: '#,##0.00 "₽"'
    });
    box(row, row, 15, 15, r.historicalBestUnitPrice, {
      al: 'right',
      b: true,
      bg: GOOD,
      fc: GOODF,
      fmt: '#,##0.00 "₽"'
    });
    box(row, row, 16, 16, r.unitOverpayment, {
      al: 'right',
      b: true,
      fc: BADF,
      bg: WHITE,
      fmt: '+#,##0.00 "₽"'
    });
    box(row, row, 17, 17, r.overpaymentPercentage / 100, {
      al: 'right',
      b: true,
      fc: BADF,
      bg: WHITE,
      fmt: '+0.0%'
    });
    box(row, row, 18, 18, r.totalLineOverpayment, {
      al: 'right',
      b: true,
      bg: BEST,
      fc: BADF,
      fmt: '+#,##0.00 "₽"'
    });

    const maxChars = Math.max(curCellText.length, r.historicalOriginalRussianName.length);
    const estLines = Math.max(2, Math.ceil(maxChars / 38));
    ws.getRow(row).height = Math.max(28, estLines * 14);
    row++;
  }

  const lastDataRow = row - 1;
  if (rows.length > 0) {
    box(
      row,
      row,
      1,
      17,
      `GENEL TOPLAM FİYAT FARKI (${rows.length} Malzeme Kalemi / ${totalInvoices} Fatura):`,
      { bg: SUM, fc: NAVY, b: true, sz: 11, al: 'right' }
    );
    const sumCell = box(
      row,
      row,
      18,
      18,
      { formula: `SUM(R${firstDataRow}:R${lastDataRow})`, result: totalOverpayment },
      { bg: BEST, fc: BADF, b: true, sz: 11.5, al: 'right', fmt: '+#,##0.00 "₽"' }
    );
    sumCell.font = font({ bold: true, size: 11.5, color: { argb: BADF } });
    ws.getRow(row).height = 26;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GES_Admin_Fiyat_Anomali_Denetim_Raporu_${todayIso}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadAnomalyReportHtml(
  anomalies: DiscountHistoricalAnomalyRecord[],
  opts: AnomalyReportOptions = {}
): void {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const html = renderAnomalyReportHtml(anomalies, { ...opts, todayIso, embedded: false });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GES_Admin_Fiyat_Anomali_Denetim_Raporu_${todayIso}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadAnomalyReportPdf(
  anomalies: DiscountHistoricalAnomalyRecord[],
  opts: AnomalyReportOptions = {}
): Promise<void> {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const html2pdfMod = await import('html2pdf.js');
  const html2pdf = (html2pdfMod as any).default || html2pdfMod;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-10000px;top:0;width:1680px;background:#fff';
  container.innerHTML = renderAnomalyReportHtml(anomalies, { ...opts, todayIso, embedded: true });
  document.body.appendChild(container);
  try {
    await html2pdf()
      .set({
        margin: [6, 6, 8, 6],
        filename: `GES_Admin_Fiyat_Anomali_Denetim_Raporu_${todayIso}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.6, useCORS: true, logging: false, windowWidth: 1680 },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.kpi'] }
      })
      .from(container.querySelector('.paper') || container)
      .save();
  } finally {
    container.remove();
  }
}
