/**
 * İndirim Alınmayan Faturalar (Doğrudan Fatura Girişleri) Denetim, Baskı ve Savunma Raporu Motoru
 * AI Otomatik Fatura Okuma -> Sistemde Kayıtlı Faturalar & Malzeme Kalemleri içindeki faturalardan,
 * Şef İndirim & TDF Teklif Merkezi sekmesinden kaydedilen indirimli faturalar HARİCİ olanları tespit eder.
 * Şef bazlı özet karne ve detaylı fatura sorgu listesini Excel (.xlsx), PDF (.pdf) ve HTML (.html) olarak üretir.
 */
import ExcelJS from 'exceljs';
import { DiscountRecord, InvoiceItem, InvoiceRecord, Jobsite, PurchasingSupervisor } from '../types';
import { areVendorsEqual } from './vendorNormalizer';

export interface UndiscountedInvoiceRow {
  rowNo: number;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  createdAt: string;
  supervisorId: string;
  supervisorName: string;
  jobsiteId: string;
  jobsiteName: string;
  supplier: string;
  category: string;
  itemCount: number;
  itemsSummary: string;
  items: InvoiceItem[];
  totalAmount: number;
  targetDiscountPct: number;
  estimatedLostDiscount: number;
  defenseNote: string;
  fileUrl?: string;
  rawInvoice: InvoiceRecord;
}

export interface SupervisorUndiscountedScorecard {
  supervisorId: string;
  supervisorName: string;
  primaryJobsiteName: string;
  jobsiteNames: string[];
  discountedInvoiceCount: number;
  discountedTotalAgreed: number;
  discountedTotalSavings: number;
  undiscountedInvoiceCount: number;
  undiscountedTotalAmount: number;
  totalInvoiceCount: number;
  undiscountedRatioPct: number;
  UndiscountedAmountRatioPct: number;
  estimatedLostDiscountTotal: number;
}

export interface UndiscountedReportOptions {
  filterLabel?: string;
  targetDiscountPct?: number;
  generatedBy?: string;
  todayIso?: string;
  embedded?: boolean;
  includeScorecard?: boolean;
  focusedSupervisorName?: string;
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

export const fmtDateDisplay = (raw?: string) => {
  const s = String(raw || '').trim();
  if (!s || s === '-') return '-';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10).split('-').reverse().join('.');
  }
  return s;
};

/**
 * Normalizes an invoice number for reliable cross-module matching
 * between `invoices` (AI Otomatik Fatura Okuma) and `discounts` (Şef İndirim & TDF Teklif Merkezi).
 */
export function cleanInvoiceDocNo(raw?: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === '-' || s === 'belirtilmedi' || s === 'yok') return '';
  return s.replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Determines whether a given `InvoiceRecord` from `invoices` is already recorded
 * in `discounts` (Şef İndirim & TDF Teklif Merkezi).
 */
export function isInvoiceRecordedInDiscountCenter(
  inv: InvoiceRecord,
  discounts: DiscountRecord[],
  discountIdSet?: Set<string>,
  discountInvNoSet?: Set<string>
): boolean {
  if (!inv) return true;

  // 1. Synced copy created automatically by Discount Center
  const invId = String(inv.id || '');
  if (invId.startsWith('inv_sync_')) return true;

  // 2. Explicit discountId reference
  const linkedDiscountId = String((inv as any).discountId || '').trim();
  if (linkedDiscountId) {
    if (discountIdSet ? discountIdSet.has(linkedDiscountId) : discounts.some(d => !d.isDeleted && d.id === linkedDiscountId)) {
      return true;
    }
  }

  // 3. Normalized Invoice Number match
  const cleanNo = cleanInvoiceDocNo(inv.invoiceNumber || inv.invoiceNo);
  if (cleanNo && cleanNo.length >= 2) {
    if (discountInvNoSet) {
      if (discountInvNoSet.has(cleanNo)) return true;
    } else {
      for (const d of discounts || []) {
        if (!d || d.isDeleted) continue;
        if (cleanInvoiceDocNo(d.invoiceNo || d.invoiceNumber) === cleanNo) {
          return true;
        }
      }
    }
  }

  // 4. Fallback: Same supplier + same date + same total amount (within 5 RUB)
  const invTotal = Number(inv.totalAmount) || 0;
  const invDate = String(inv.date || '').slice(0, 10);
  const invSupplier = String(inv.supplier || (inv as any).vendorName || '').trim();

  if (invTotal > 0 && invDate && invSupplier) {
    for (const d of discounts || []) {
      if (!d || d.isDeleted) continue;
      const dDate = String(d.orderDate || d.finalNegotiationDate || '').slice(0, 10);
      const dAgreed = Number(d.agreedPrice) || 0;
      if (dDate === invDate && Math.abs(invTotal - dAgreed) <= 5 && areVendorsEqual(invSupplier, d.vendorName || '')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extracts all Undiscounted Invoices from `invoices` (excluding deleted, Prizma ERP reference records,
 * and invoices recorded in `discounts`) and computes supervisor scorecards.
 */
export function extractUndiscountedInvoicesData(params: {
  invoices: InvoiceRecord[];
  discounts: DiscountRecord[];
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  targetDiscountPct: number;
  customDefenseNotes?: Record<string, string>;
}): {
  allUndiscountedRows: UndiscountedInvoiceRow[];
  supervisorScorecards: SupervisorUndiscountedScorecard[];
} {
  const {
    invoices = [],
    discounts = [],
    supervisors = [],
    jobsites = [],
    targetDiscountPct = 5,
    customDefenseNotes = {}
  } = params;

  const activeDiscounts = (discounts || []).filter(d => d && !d.isDeleted && !(d as any).test);
  const discountIdSet = new Set<string>();
  const discountInvNoSet = new Set<string>();

  for (const d of activeDiscounts) {
    if (d.id) discountIdSet.add(d.id);
    const cNo = cleanInvoiceDocNo(d.invoiceNo || d.invoiceNumber);
    if (cNo && cNo.length >= 2) {
      discountInvNoSet.add(cNo);
    }
  }

  // Filter `invoices` to genuine GES Archive invoices that were NOT recorded in Discount Center
  const undiscountedInvoices: InvoiceRecord[] = [];
  for (const inv of invoices || []) {
    if (!inv || inv.isDeleted) continue;

    // Exclude Prizma ERP reference records if any
    const isPrizma = Boolean(
      (inv as any).sourceCollection === 'prizma_invoices' ||
      String(inv.id || '').startsWith('prizma_') ||
      ((inv as any).prizmaProcessId && !inv.uploadedBySupervisorId)
    );
    if (isPrizma) continue;

    if (isInvoiceRecordedInDiscountCenter(inv, activeDiscounts, discountIdSet, discountInvNoSet)) {
      continue;
    }

    undiscountedInvoices.push(inv);
  }

  // Sort newest first by invoice date / created_at
  undiscountedInvoices.sort((a, b) => {
    const tA = new Date(a.date || a.created_at || (a as any).createdAt || 0).getTime();
    const tB = new Date(b.date || b.created_at || (b as any).createdAt || 0).getTime();
    return tB - tA;
  });

  const allUndiscountedRows: UndiscountedInvoiceRow[] = undiscountedInvoices.map((inv, idx) => {
    const supObj = supervisors.find(
      s => s.id === inv.uploadedBySupervisorId || s.name.toLowerCase() === String(inv.uploadedBySupervisorName || '').toLowerCase()
    );
    const jobObj = jobsites.find(
      j => j.id === inv.jobsiteId || j.name.toLowerCase() === String(inv.jobsiteName || '').toLowerCase()
    );

    const resolvedSupervisorId = supObj?.id || inv.uploadedBySupervisorId || 'unassigned';
    const resolvedSupervisorName = supObj?.name || inv.uploadedBySupervisorName || 'Şef Belirtilmemiş';
    const resolvedJobsiteId = jobObj?.id || inv.jobsiteId || 'unassigned';
    const resolvedJobsiteName = jobObj?.name || inv.jobsiteName || 'Şantiye Belirtilmemiş';
    const items = Array.isArray(inv.items) ? inv.items : [];
    const itemCount = items.length;

    const topItemsText = items
      .slice(0, 3)
      .map(it => {
        const name = it.materialName || it.originalName || 'Malzeme';
        const qty = Number(it.quantity) || 1;
        const unit = it.unit || 'Adet';
        return `${name} (${qty} ${unit})`;
      })
      .join(', ');
    const itemsSummary =
      itemCount > 3
        ? `${topItemsText} (+${itemCount - 3} kalem daha)`
        : topItemsText || (inv.category ? `${inv.category}` : 'Kalem detayı yok');

    const resolvedCategory =
      inv.category ||
      (items.length > 0 && items[0].category ? items[0].category : 'Genel Malzeme');

    const totalAmount = Number(inv.totalAmount) || 0;
    const estimatedLostDiscount = Number(((totalAmount * targetDiscountPct) / 100).toFixed(2));
    const defenseNote =
      customDefenseNotes[inv.id] !== undefined
        ? customDefenseNotes[inv.id]
        : String((inv as any).undiscountedDefenseNote || inv.notes || '').trim();

    return {
      rowNo: idx + 1,
      invoiceId: inv.id,
      invoiceNo: String(inv.invoiceNumber || inv.invoiceNo || '-').trim() || '-',
      invoiceDate: inv.date || (inv as any).createdAt || inv.created_at || '-',
      createdAt: inv.created_at || (inv as any).createdAt || inv.date || '-',
      supervisorId: resolvedSupervisorId,
      supervisorName: resolvedSupervisorName,
      jobsiteId: resolvedJobsiteId,
      jobsiteName: resolvedJobsiteName,
      supplier: String(inv.supplier || (inv as any).vendorName || 'Bilinmeyen Tedarikçi').trim(),
      category: resolvedCategory,
      itemCount,
      itemsSummary,
      items,
      totalAmount,
      targetDiscountPct,
      estimatedLostDiscount,
      defenseNote,
      fileUrl: inv.fileUrl,
      rawInvoice: inv
    };
  });

  // Build Supervisor Undiscounted Scorecards
  const scorecardMap = new Map<
    string,
    {
      supervisorId: string;
      supervisorName: string;
      jobsiteSet: Set<string>;
      jobsiteCounts: Map<string, number>;
      discountedInvoiceCount: number;
      discountedTotalAgreed: number;
      discountedTotalSavings: number;
      undiscountedInvoiceCount: number;
      undiscountedTotalAmount: number;
    }
  >();

  const ensureSupEntry = (id: string, name: string) => {
    const key = id && id !== 'unassigned' ? id : `name_${name.toLowerCase()}`;
    if (!scorecardMap.has(key)) {
      scorecardMap.set(key, {
        supervisorId: id || key,
        supervisorName: name || 'Şef Belirtilmemiş',
        jobsiteSet: new Set<string>(),
        jobsiteCounts: new Map<string, number>(),
        discountedInvoiceCount: 0,
        discountedTotalAgreed: 0,
        discountedTotalSavings: 0,
        undiscountedInvoiceCount: 0,
        undiscountedTotalAmount: 0
      });
    }
    return scorecardMap.get(key)!;
  };

  // Seed with known supervisors
  for (const s of supervisors || []) {
    if (s && s.id && s.name) {
      ensureSupEntry(s.id, s.name);
    }
  }

  // Count discounted records per supervisor
  for (const d of activeDiscounts) {
    const supObj = supervisors.find(
      s => s.id === d.supervisorId || s.name.toLowerCase() === String(d.supervisorName || '').toLowerCase()
    );
    const entry = ensureSupEntry(supObj?.id || d.supervisorId || 'unassigned', supObj?.name || d.supervisorName || 'Şef Belirtilmemiş');
    entry.discountedInvoiceCount += 1;
    entry.discountedTotalAgreed += Number(d.agreedPrice) || 0;
    const diff = Math.max(0, (Number(d.offerPrice) || 0) - (Number(d.agreedPrice) || 0));
    entry.discountedTotalSavings += Number(d.discountAmount) || diff;
    if (d.jobsiteName) {
      entry.jobsiteSet.add(d.jobsiteName);
      entry.jobsiteCounts.set(d.jobsiteName, (entry.jobsiteCounts.get(d.jobsiteName) || 0) + 1);
    }
  }

  // Count undiscounted records per supervisor
  for (const row of allUndiscountedRows) {
    const entry = ensureSupEntry(row.supervisorId, row.supervisorName);
    entry.undiscountedInvoiceCount += 1;
    entry.undiscountedTotalAmount += row.totalAmount;
    if (row.jobsiteName && row.jobsiteName !== 'Şantiye Belirtilmemiş') {
      entry.jobsiteSet.add(row.jobsiteName);
      entry.jobsiteCounts.set(row.jobsiteName, (entry.jobsiteCounts.get(row.jobsiteName) || 0) + 1);
    }
  }

  const supervisorScorecards: SupervisorUndiscountedScorecard[] = Array.from(scorecardMap.values())
    .filter(e => e.undiscountedInvoiceCount > 0 || e.discountedInvoiceCount > 0)
    .map(e => {
      const totalInvoiceCount = e.discountedInvoiceCount + e.undiscountedInvoiceCount;
      const undiscountedRatioPct =
        totalInvoiceCount > 0 ? Number(((e.undiscountedInvoiceCount / totalInvoiceCount) * 100).toFixed(1)) : 0;
      const totalVolume = e.discountedTotalAgreed + e.undiscountedTotalAmount;
      const UndiscountedAmountRatioPct =
        totalVolume > 0 ? Number(((e.undiscountedTotalAmount / totalVolume) * 100).toFixed(1)) : 0;
      const estimatedLostDiscountTotal = Number(((e.undiscountedTotalAmount * targetDiscountPct) / 100).toFixed(2));

      let primaryJobsiteName = '-';
      let maxCount = 0;
      e.jobsiteCounts.forEach((cnt, jName) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          primaryJobsiteName = jName;
        }
      });

      return {
        supervisorId: e.supervisorId,
        supervisorName: e.supervisorName,
        primaryJobsiteName,
        jobsiteNames: Array.from(e.jobsiteSet),
        discountedInvoiceCount: e.discountedInvoiceCount,
        discountedTotalAgreed: e.discountedTotalAgreed,
        discountedTotalSavings: e.discountedTotalSavings,
        undiscountedInvoiceCount: e.undiscountedInvoiceCount,
        undiscountedTotalAmount: e.undiscountedTotalAmount,
        totalInvoiceCount,
        undiscountedRatioPct,
        UndiscountedAmountRatioPct,
        estimatedLostDiscountTotal
      };
    })
    .sort((a, b) => {
      if (b.undiscountedTotalAmount !== a.undiscountedTotalAmount) {
        return b.undiscountedTotalAmount - a.undiscountedTotalAmount;
      }
      return b.undiscountedInvoiceCount - a.undiscountedInvoiceCount;
    });

  return {
    allUndiscountedRows,
    supervisorScorecards
  };
}

const REPORT_CSS = `
:root{--ink:#0f1b2d;--muted:#5a6579;--line:#c9cfda;--navy:#102c54;--navy2:#1e3f6e;--head:#d6dce4;--sum:#d9e1f2;--best:#ffeb9c;
--accent:#2f5bd3;--accent-soft:#e9efff;--good:#0b7a4b;--good-soft:#e2f5ec;--warn:#a15c00;--warn-soft:#fff8e6;--bad:#b42318;--bad-soft:#fde8e6;--grey:#f5f6f8}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--ink);font-family:"IBM Plex Sans","Segoe UI",Arial,system-ui,sans-serif;font-size:11.5px;line-height:1.4}
.paper{max-width:1620px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.ph{background:linear-gradient(135deg,#7f1d1d 0%,#102c54 65%,#0f172a 100%);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;gap:16px;border-radius:8px}
.ph .t{font-size:17px;font-weight:800;letter-spacing:.01em}
.ph .s{font-size:11.5px;opacity:.92;margin-top:4px}
.ph .logo{font-weight:900;font-size:22px;letter-spacing:.08em;align-self:center;background:rgba(255,255,255,.14);padding:6px 16px;border-radius:6px;border:1px solid rgba(255,255,255,.25)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{border:1px solid var(--line);border-radius:6px;padding:10px 14px;background:var(--grey)}
.kpi .k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.kpi .v{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px;color:var(--navy)}
.kpi.bad{background:var(--bad-soft);border-color:#f5c2c0}
.kpi.bad .v{color:var(--bad)}
.kpi.warn{background:var(--warn-soft);border-color:#f5d996}
.kpi.warn .v{color:var(--warn)}
.kpi .h{font-size:10.5px;color:var(--muted);margin-top:2px}
.directiveBox{border:2px solid var(--bad);background:var(--bad-soft);border-radius:8px;padding:12px 16px;font-size:12px;color:#7f1d1d}
.directiveBox b{color:#991b1b;text-transform:uppercase;letter-spacing:.02em}
.secTitle{font-size:13px;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.04em;margin-top:4px;margin-bottom:2px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--navy);padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:11px}
th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:middle}
thead th.grpNavy{background:var(--navy);color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.grpCrimson{background:#8a1c12;color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.grpAmber{background:#92400e;color:#fff;text-align:center;font-size:11px;font-weight:800;letter-spacing:.04em;padding:6px}
thead th.sub{background:var(--head);color:var(--ink);font-size:10.5px;font-weight:700;line-height:1.25}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.c{text-align:center}
td.amtCell{font-weight:800;color:var(--ink);background:#f8fafc}
td.lostCell{background:var(--bad-soft);color:var(--bad);font-weight:800}
td.defenseCell{background:var(--warn-soft);color:#78350f;font-weight:600;min-width:240px}
.defensePlaceholder{color:#9a6700;font-style:italic;font-weight:500;font-size:10.5px;display:block;min-height:22px}
.subText{font-size:10px;color:var(--muted);display:block;margin-top:2px}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:9.5px;font-weight:700}
.badge.high{background:#fde8e6;color:#b42318;border:1px solid #f5c2c0}
.badge.med{background:#fff3d6;color:#a15c00;border:1px solid #f5d996}
.badge.ok{background:#e2f5ec;color:#0b7a4b;border:1px solid #a7f3d0}
tr.grand td{background:var(--sum);font-weight:800;font-size:11.5px}
tr{break-inside:avoid}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:16px}
.sign div{border-top:1.5px solid var(--ink);padding-top:6px;font-size:11px;color:var(--muted);min-height:54px}
.foot{font-size:10px;color:var(--muted);display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px}
@page{size:A3 landscape;margin:8mm}
@media print{.paper{padding:0;max-width:none}.ph,.kpi,.directiveBox,td,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

/**
 * Generates Corporate Standalone or Embedded HTML for Undiscounted Invoices Audit Report
 */
export function renderUndiscountedInvoicesHtml(
  rows: UndiscountedInvoiceRow[],
  scorecards: SupervisorUndiscountedScorecard[],
  opts: UndiscountedReportOptions = {}
): string {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const dateStr = fmtDateDisplay(todayIso);
  const targetPct = opts.targetDiscountPct ?? 5;
  const filterLabel = opts.filterLabel || 'Tüm Şefler ve Şantiyeler';
  const includeScorecard = opts.includeScorecard !== false;

  const totalUndiscountedCount = rows.length;
  const totalUndiscountedAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalEstimatedLost = rows.reduce((s, r) => s + r.estimatedLostDiscount, 0);
  const totalItemsCount = rows.reduce((s, r) => s + r.itemCount, 0);
  const distinctSuppliers = new Set(rows.map(r => r.supplier)).size;
  const distinctSupervisors = new Set(rows.map(r => r.supervisorName)).size;

  let body = `<div class="paper">`;

  // Header Banner
  body += `
    <div class="ph">
      <div>
        <div class="t">İNDİRİM ALINMAYAN FATURALAR (DOĞRUDAN GİRİŞLER) DENETİM, SORGU VE SAVUNMA RAPORU</div>
        <div class="s">Kurum: АО «ГЭС Констракшн» · Kapsam: ${esc(filterLabel)} · Rapor Tarihi: ${esc(dateStr)} · Hedef İndirim Bazı: %${targetPct}</div>
      </div>
      <div class="logo">GES</div>
    </div>
  `;

  // Official Management Directive Box
  body += `
    <div class="directiveBox">
      <b>⚠️ YÖNETİM DENETİM VE SAVUNMA TALİMATI:</b> Aşağıda listelenen <b>${totalUndiscountedCount} adet fatura (${fmtIntRub(totalUndiscountedAmount)} ₽)</b>, <i>"AI Otomatik Fatura Okuma -> Sistemde Kayıtlı Faturalar"</i> arşivine doğrudan yüklenmiş olup <i>"Şef İndirim & TDF Teklif Merkezi"</i> üzerinden herhangi bir rekabetçi teklif veya pazarlık indirimi kaydı girilmemiştir. İlgili satınalma şeflerinin her bir fatura için <b>"Neden İndirim Alınmadı? (Şef Savunma / Açıklama)"</b> sütununu gerekçeleriyle doldurarak yönetime sunması ve bundan sonraki alımlarda pazarlık prosedürüne riayet etmesi zorunludur.
    </div>
  `;

  // 4 KPI Cards
  body += `
    <div class="kpis">
      <div class="kpi bad">
        <div class="k">İNDİRİMSİZ DOĞRUDAN FATURA SAYISI</div>
        <div class="v">${totalUndiscountedCount} Fatura</div>
        <div class="h">Toplam ${totalItemsCount} malzeme kalemi · ${distinctSuppliers} farklı tedarikçi</div>
      </div>
      <div class="kpi">
        <div class="k">İNDİRİMSİZ TOPLAM FATURA HACMİ</div>
        <div class="v">${fmtIntRub(totalUndiscountedAmount)} ₽</div>
        <div class="h">Pazarlık kaydı olmadan onaylanan doğrudan fatura tutarı</div>
      </div>
      <div class="kpi warn">
        <div class="k">KAÇIRILAN POTANSİYEL İNDİRİM (HEDEF %${targetPct})</div>
        <div class="v">+${fmtIntRub(totalEstimatedLost)} ₽</div>
        <div class="h">Ortalama %${targetPct} pazarlık indirimi alınsaydı sağlanacak tasarruf</div>
      </div>
      <div class="kpi">
        <div class="k">DENETLENEN ŞEF / SORUMLU SAYISI</div>
        <div class="v">${distinctSupervisors} Satınalma Şefi</div>
        <div class="h">${esc(opts.focusedSupervisorName ? `Odak: ${opts.focusedSupervisorName}` : 'Şef bazlı karne ve fatura bazlı savunma listesi')}</div>
      </div>
    </div>
  `;

  // Section 1: Supervisor Scorecard Table
  if (includeScorecard && scorecards.length > 0) {
    const sumDiscCount = scorecards.reduce((s, c) => s + c.discountedInvoiceCount, 0);
    const sumUndiscCount = scorecards.reduce((s, c) => s + c.undiscountedInvoiceCount, 0);
    const sumTotalCount = sumDiscCount + sumUndiscCount;
    const sumUndiscRatio = sumTotalCount > 0 ? ((sumUndiscCount / sumTotalCount) * 100).toFixed(1) : '0.0';
    const sumUndiscAmt = scorecards.reduce((s, c) => s + c.undiscountedTotalAmount, 0);
    const sumLostAmt = scorecards.reduce((s, c) => s + c.estimatedLostDiscountTotal, 0);
    const sumSavedAmt = scorecards.reduce((s, c) => s + c.discountedTotalSavings, 0);

    body += `
      <div class="secTitle">
        <span>1. SATINALMA ŞEFLERİ İNDİRİMSİZ FATURA ÖZET KARNESİ</span>
        <span style="font-size:11px;font-weight:600;color:var(--muted)">İndirimli (Teklif Merkezi) vs İndirimsiz (Doğrudan Fatura) Karşılaştırması</span>
      </div>
      <table>
        <thead>
          <tr>
            <th class="sub">#</th>
            <th class="sub">Satınalma Şefi</th>
            <th class="sub">Sorumlu Olduğu Şantiyeler</th>
            <th class="sub" style="text-align:center">İndirimli Fatura (Adet)</th>
            <th class="sub" style="text-align:center">İndirimsiz Fatura (Adet)</th>
            <th class="sub" style="text-align:center">Toplam Fatura</th>
            <th class="sub" style="text-align:center">İndirimsiz Oran (%)</th>
            <th class="sub" style="text-align:right">Kazanılan Mevcut İndirim (₽)</th>
            <th class="sub" style="text-align:right">İndirimsiz Fatura Tutarı (₽)</th>
            <th class="sub" style="text-align:right">Tahmini Kayıp İndirim (%${targetPct})</th>
            <th class="sub" style="text-align:center">Denetim Durumu</th>
          </tr>
        </thead>
        <tbody>
    `;

    scorecards.forEach((sc, i) => {
      const badgeClass = sc.undiscountedRatioPct >= 50 ? 'high' : sc.undiscountedRatioPct >= 25 ? 'med' : 'ok';
      const statusText =
        sc.undiscountedInvoiceCount === 0
          ? 'Tam Uyumlu (Tümünde İndirim Var)'
          : sc.undiscountedRatioPct >= 50
          ? 'KRİTİK — Savunma & İndirim Baskısı Gerekli'
          : sc.undiscountedRatioPct >= 25
          ? 'ORTA RİSK — İndirimsiz Faturalar Sorgulanmalı'
          : 'DÜŞÜK — Münferit Faturalar';

      body += `
        <tr>
          <td class="c"><b>${i + 1}</b></td>
          <td><b>${esc(sc.supervisorName)}</b></td>
          <td>${esc(sc.jobsiteNames.join(', ') || sc.primaryJobsiteName)}</td>
          <td class="c" style="color:var(--good);font-weight:700">${sc.discountedInvoiceCount}</td>
          <td class="c" style="color:var(--bad);font-weight:800">${sc.undiscountedInvoiceCount}</td>
          <td class="c"><b>${sc.totalInvoiceCount}</b></td>
          <td class="c"><span class="badge ${badgeClass}">%${sc.undiscountedRatioPct}</span></td>
          <td class="num" style="color:var(--good);font-weight:700">+${fmtIntRub(sc.discountedTotalSavings)} ₽</td>
          <td class="num amtCell">${fmtIntRub(sc.undiscountedTotalAmount)} ₽</td>
          <td class="num lostCell">+${fmtIntRub(sc.estimatedLostDiscountTotal)} ₽</td>
          <td class="c"><span class="badge ${badgeClass}">${esc(statusText)}</span></td>
        </tr>
      `;
    });

    body += `
          <tr class="grand">
            <td colspan="3" style="text-align:right">GENEL TOPLAM / ORTALAMA:</td>
            <td class="c" style="color:var(--good)">${sumDiscCount}</td>
            <td class="c" style="color:var(--bad)">${sumUndiscCount}</td>
            <td class="c">${sumTotalCount}</td>
            <td class="c">%${sumUndiscRatio}</td>
            <td class="num" style="color:var(--good)">+${fmtIntRub(sumSavedAmt)} ₽</td>
            <td class="num">${fmtIntRub(sumUndiscAmt)} ₽</td>
            <td class="num" style="color:var(--bad)">+${fmtIntRub(sumLostAmt)} ₽</td>
            <td class="c">-</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  // Section 2: Detailed Undiscounted Invoices Table
  body += `
    <div class="secTitle">
      <span>2. İNDİRİM ALINMAYAN FATURALAR DETAYLI SORGU VE ŞEF SAVUNMA LİSTESİ (${totalUndiscountedCount} FATURA)</span>
      <span style="font-size:11px;font-weight:600;color:var(--bad)">Her Fatura İçin "Neden İndirim Alınmadı?" Açıklaması Zorunludur</span>
    </div>
    <table>
      <thead>
        <tr>
          <th colspan="6" class="grpNavy">1. FATURA, ŞEF, ŞANTİYE VE TEDARİKÇİ BİLGİLERİ</th>
          <th colspan="3" class="grpCrimson">2. FATURA KALEMLERİ, TUTAR VE KAÇIRILAN İNDİRİM ANALİZİ</th>
          <th colspan="1" class="grpAmber">3. ŞEF SAVUNMA & GEREKÇE BEYANI</th>
        </tr>
        <tr>
          <th class="sub">#</th>
          <th class="sub">Fatura Tarihi</th>
          <th class="sub">Satınalma Şefi</th>
          <th class="sub">Şantiye</th>
          <th class="sub">Tedarikçi Firma</th>
          <th class="sub">Fatura Numarası</th>
          <th class="sub">Kalem Sayısı & Malzeme Özeti</th>
          <th class="sub" style="text-align:right">Fatura Toplam Tutarı (₽)</th>
          <th class="sub" style="text-align:right">Tahmini Kayıp İndirim (%${targetPct})</th>
          <th class="sub">NEDEN İNDİRİM ALINMADI? (ŞEF SAVUNMA / AÇIKLAMA)</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (rows.length === 0) {
    body += `<tr><td colspan="10" class="c" style="padding:24px;color:var(--muted)">Seçili filtre kriterlerine uygun indirimsiz doğrudan fatura bulunmadı.</td></tr>`;
  } else {
    for (const r of rows) {
      body += `
        <tr>
          <td class="c"><b>${r.rowNo}</b></td>
          <td class="c"><b>${esc(fmtDateDisplay(r.invoiceDate))}</b><span class="subText">Kayıt: ${esc(fmtDateDisplay(r.createdAt))}</span></td>
          <td><b>${esc(r.supervisorName)}</b></td>
          <td><b>${esc(r.jobsiteName)}</b></td>
          <td><b>${esc(r.supplier)}</b><span class="subText">${esc(r.category)}</span></td>
          <td class="c"><b style="font-family:monospace;font-size:11.5px">#${esc(r.invoiceNo)}</b></td>
          <td>
            <b>${r.itemCount} Kalem:</b> ${esc(r.itemsSummary)}
          </td>
          <td class="num amtCell">${fmtRub(r.totalAmount)} ₽</td>
          <td class="num lostCell">+${fmtRub(r.estimatedLostDiscount)} ₽</td>
          <td class="defenseCell">
            ${
              r.defenseNote
                ? `<b>${esc(r.defenseNote)}</b>`
                : `<span class="defensePlaceholder">[Şef Açıklaması Bekleniyor: Bu faturada neden indirim / karşı teklif alınmadığını yazınız...]</span>`
            }
          </td>
        </tr>
      `;
    }

    body += `
      <tr class="grand">
        <td colspan="7" style="text-align:right">GENEL TOPLAM (${totalUndiscountedCount} İndirimsiz Fatura / ${totalItemsCount} Malzeme Kalemi):</td>
        <td class="num">${fmtRub(totalUndiscountedAmount)} ₽</td>
        <td class="num" style="color:var(--bad)">+${fmtRub(totalEstimatedLost)} ₽</td>
        <td>Hedef %${targetPct} İndirim Bazında Toplam Potansiyel Kayıp</td>
      </tr>
    `;
  }

  body += `
      </tbody>
    </table>
    <div class="sign">
      <div><b>İlgili Satınalma Şefi Savunma & İmza</b><br>Yukarıdaki faturalara ilişkin indirimsiz alım gerekçelerimi beyan ederim.<br>İmza / Tarih:</div>
      <div><b>Satınalma Koordinatörlüğü İncelemesi</b><br>Savunma Değerlendirmesi & Aksiyon Notu<br>İmza / Tarih:</div>
      <div><b>Yönetim / Denetim Onayı</b><br>АО «ГЭС Констракшн»<br>İmza / Tarih:</div>
    </div>
    <div class="foot">
      <span>АО «ГЭС Констракшн» · İndirim Alınmayan Faturalar (Doğrudan Fatura Girişleri) Denetim ve Savunma Raporu</span>
      <span>Hazırlayan: ${esc(opts.generatedBy || 'Satınalma Yönetimi')} · Tarih: ${esc(dateStr)}</span>
    </div>
  </div>`;

  if (opts.embedded) {
    return `<style>${REPORT_CSS}</style>${body}`;
  }

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GES İndirimsiz Faturalar Denetim Raporu - ${esc(dateStr)}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}

/**
 * Generates a 2-sheet corporate Excel (.xlsx) file:
 * Sheet 1: Şef Bazlı İndirimsiz Fatura Karnesi
 * Sheet 2: İndirim Alınmayan Faturalar Detaylı Sorgu & Şef Savunma Listesi
 */
export async function downloadUndiscountedInvoicesExcel(
  rows: UndiscountedInvoiceRow[],
  scorecards: SupervisorUndiscountedScorecard[],
  opts: UndiscountedReportOptions = {}
): Promise<void> {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const dateStr = fmtDateDisplay(todayIso);
  const targetPct = opts.targetDiscountPct ?? 5;
  const filterLabel = opts.filterLabel || 'Tüm Şefler ve Şantiyeler';

  const NAVY = 'FF102C54',
    NAVY2 = 'FF1E3F6E',
    REDGROUP = 'FF8A1C12',
    AMBERGROUP = 'FF92400E',
    HEAD = 'FFD6DCE4',
    SUM = 'FFD9E1F2',
    GOOD = 'FFE2F5EC',
    GOODF = 'FF0B7A4B',
    BAD = 'FFFDE8E6',
    BADF = 'FFB42318',
    WARN = 'FFFFF8E1',
    WARNF = 'FF92400E',
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

  const makeBoxHelper = (ws: ExcelJS.Worksheet) => (
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

  const totalUndiscountedCount = rows.length;
  const totalUndiscountedAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
  const totalEstimatedLost = rows.reduce((s, r) => s + r.estimatedLostDiscount, 0);
  const totalItemsCount = rows.reduce((s, r) => s + r.itemCount, 0);

  // =========================================================================
  // SHEET 1: İNDİRİMSİZ FATURALAR SORGU & ŞEF SAVUNMA LİSTESİ (PRIMARY)
  // =========================================================================
  const wsList = wb.addWorksheet('İndirimsiz Faturalar Sorgu', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 11 }]
  });
  const boxList = makeBoxHelper(wsList);

  const listWidths = [7, 13, 13, 24, 22, 30, 18, 18, 10, 44, 18, 13, 20, 48];
  const NC_LIST = listWidths.length;
  listWidths.forEach((w, i) => {
    wsList.getColumn(i + 1).width = w;
  });

  let row = 1;
  boxList(
    row,
    row,
    1,
    NC_LIST,
    'İNDİRİM ALINMAYAN FATURALAR (DOĞRUDAN GİRİŞLER) DENETİM, SORGU VE ŞEF SAVUNMA FORMU',
    { bg: REDGROUP, fc: WHITE, b: true, sz: 13.5, border: false }
  );
  wsList.getRow(row).height = 30;
  row++;

  boxList(
    row,
    row,
    1,
    NC_LIST,
    `Kurum: АО «ГЭС Констракшн» · Kapsam: ${filterLabel} · Rapor Tarihi: ${dateStr} · Hedef İndirim Oranı: %${targetPct}`,
    { bg: NAVY, fc: WHITE, b: false, sz: 9.5, border: false }
  );
  wsList.getRow(row).height = 20;
  row++;

  boxList(
    row,
    row,
    1,
    NC_LIST,
    '⚠️ TALİMAT: Bu listedeki faturalar Şef İndirim & TDF Teklif Merkezi üzerinden indirim kaydı girilmeden doğrudan sisteme işlenmiştir. Lütfen en sağdaki sarı sütuna her bir fatura için neden indirim alınmadığını açıklayınız.',
    { bg: WARN, fc: WARNF, b: true, sz: 9.5 }
  );
  wsList.getRow(row).height = 24;
  row += 2;

  // 4 KPI Cards on Sheet 1
  const kpiCards = [
    {
      k: 'İNDİRİMSİZ FATURA SAYISI',
      v: `${totalUndiscountedCount} Fatura`,
      h: `Toplam ${totalItemsCount} malzeme kalemi`,
      c1: 1,
      c2: 4,
      vc: BADF
    },
    {
      k: 'İNDİRİMSİZ TOPLAM FATURA HACMİ',
      v: `${fmtIntRub(totalUndiscountedAmount)} ₽`,
      h: 'Pazarlık kaydı girilmeyen faturalar toplamı',
      c1: 5,
      c2: 7,
      vc: NAVY
    },
    {
      k: `KAÇIRILAN POTANSİYEL İNDİRİM (%${targetPct})`,
      v: `+${fmtIntRub(totalEstimatedLost)} ₽`,
      h: `Hedef %${targetPct} indirim alınsaydı kazanılacak tutar`,
      c1: 8,
      c2: 11,
      vc: BADF
    },
    {
      k: 'SORUMLU ŞEF SAVUNMA DURUMU',
      v: 'AÇIKLAMA BEKLENİYOR',
      h: 'Sarı sütunu doldurup yönetime iletiniz',
      c1: 12,
      c2: NC_LIST,
      vc: WARNF
    }
  ];

  for (const kp of kpiCards) {
    boxList(row, row, kp.c1, kp.c2, kp.k, { bg: GREY, fc: MUTED, sz: 8.5, b: true });
    boxList(row + 1, row + 1, kp.c1, kp.c2, kp.v, { bg: WHITE, fc: kp.vc, sz: 13.5, b: true });
    boxList(row + 2, row + 2, kp.c1, kp.c2, kp.h, { bg: WHITE, fc: MUTED, sz: 9 });
  }
  wsList.getRow(row).height = 17;
  wsList.getRow(row + 1).height = 24;
  wsList.getRow(row + 2).height = 18;
  row += 4;

  // Group Headers
  boxList(row, row, 1, 8, '1. FATURA, SATINALMA ŞEFİ, ŞANTİYE VE TEDARİKÇİ BİLGİLERİ', {
    bg: NAVY,
    fc: WHITE,
    b: true,
    sz: 10,
    al: 'center'
  });
  boxList(row, row, 9, 13, '2. KALEMLER, FATURA TUTARI VE KAÇIRILAN POTANSİYEL İNDİRİM', {
    bg: REDGROUP,
    fc: WHITE,
    b: true,
    sz: 10,
    al: 'center'
  });
  boxList(row, row, 14, 14, '3. ŞEF SAVUNMA & AÇIKLAMA BEYANI (DOLDURULACAK ALAN)', {
    bg: AMBERGROUP,
    fc: WHITE,
    b: true,
    sz: 10,
    al: 'center'
  });
  wsList.getRow(row).height = 24;
  row++;

  const cols: Array<{ title: string; al?: 'left' | 'center' | 'right' }> = [
    { title: 'Sıra\n№', al: 'center' },
    { title: 'Fatura Tarihi\nДата счета', al: 'center' },
    { title: 'Kayıt Tarihi\nДата записи', al: 'center' },
    { title: 'Satınalma Şefi\nРуководитель закупок' },
    { title: 'Şantiye\nОбъект' },
    { title: 'Tedarikçi Firma\nПоставщик' },
    { title: 'Fatura Numarası\n№ счета', al: 'center' },
    { title: 'Kategori\nКатегория' },
    { title: 'Kalem\nПоз.', al: 'center' },
    { title: 'Fatura Kalemleri Özeti\nКраткое описание позиций' },
    { title: 'Fatura Tutarı (₽)\nСумма счета', al: 'right' },
    { title: 'Hedef İnd. (%)\nЦель %', al: 'right' },
    { title: 'Tahmini Kayıp İndirim (₽)\nУпущенная скидка', al: 'right' },
    { title: 'NEDEN İNDİRİM ALINMADI? (ŞEF SAVUNMA / GEREKÇE)\nПричина отсутствия скидки (Заполняется шефом)' }
  ];

  cols.forEach((c, idx) => {
    boxList(row, row, idx + 1, idx + 1, c.title, {
      bg: idx === 13 ? WARN : HEAD,
      fc: idx === 13 ? WARNF : BLACK,
      b: true,
      sz: 9.5,
      al: c.al || 'left'
    });
  });
  wsList.getRow(row).height = 30;
  row++;

  const firstDataRow = row;
  for (const r of rows) {
    boxList(row, row, 1, 1, r.rowNo, { al: 'center', b: true, bg: WHITE });
    boxList(row, row, 2, 2, fmtDateDisplay(r.invoiceDate), { al: 'center', b: true, bg: WHITE });
    boxList(row, row, 3, 3, fmtDateDisplay(r.createdAt), { al: 'center', sz: 9, fc: MUTED, bg: WHITE });
    boxList(row, row, 4, 4, r.supervisorName, { b: true, bg: WHITE });
    boxList(row, row, 5, 5, r.jobsiteName, { b: true, bg: WHITE });
    boxList(row, row, 6, 6, r.supplier, { b: true, bg: WHITE });
    boxList(row, row, 7, 7, `#${r.invoiceNo}`, { al: 'center', b: true, bg: WHITE });
    boxList(row, row, 8, 8, r.category, { sz: 9, bg: WHITE });
    boxList(row, row, 9, 9, r.itemCount, { al: 'center', b: true, bg: WHITE });
    boxList(row, row, 10, 10, r.itemsSummary, { sz: 9.5, bg: WHITE });
    boxList(row, row, 11, 11, r.totalAmount, {
      al: 'right',
      b: true,
      bg: GREY,
      fmt: '#,##0.00 "₽"'
    });
    boxList(row, row, 12, 12, r.targetDiscountPct / 100, {
      al: 'right',
      b: true,
      bg: WHITE,
      fc: MUTED,
      fmt: '0.0%'
    });
    boxList(
      row,
      row,
      13,
      13,
      { formula: `K${row}*L${row}`, result: r.estimatedLostDiscount },
      {
        al: 'right',
        b: true,
        bg: BAD,
        fc: BADF,
        fmt: '+#,##0.00 "₽"'
      }
    );
    boxList(row, row, 14, 14, r.defenseNote || '', {
      al: 'left',
      b: Boolean(r.defenseNote),
      bg: WARN,
      fc: WARNF,
      sz: 9.5
    });

    const estLines = Math.max(2, Math.ceil(r.itemsSummary.length / 42));
    wsList.getRow(row).height = Math.max(26, estLines * 14);
    row++;
  }

  const lastDataRow = row - 1;
  if (rows.length > 0) {
    boxList(
      row,
      row,
      1,
      10,
      `GENEL TOPLAM (${totalUndiscountedCount} İndirimsiz Fatura / ${totalItemsCount} Malzeme Kalemi):`,
      { bg: SUM, fc: NAVY, b: true, sz: 10.5, al: 'right' }
    );
    boxList(
      row,
      row,
      11,
      11,
      { formula: `SUM(K${firstDataRow}:K${lastDataRow})`, result: totalUndiscountedAmount },
      { bg: SUM, fc: NAVY, b: true, sz: 11, al: 'right', fmt: '#,##0.00 "₽"' }
    );
    boxList(row, row, 12, 12, targetPct / 100, {
      bg: SUM,
      fc: NAVY,
      b: true,
      sz: 10.5,
      al: 'right',
      fmt: '0.0%'
    });
    boxList(
      row,
      row,
      13,
      13,
      { formula: `SUM(M${firstDataRow}:M${lastDataRow})`, result: totalEstimatedLost },
      { bg: BAD, fc: BADF, b: true, sz: 11, al: 'right', fmt: '+#,##0.00 "₽"' }
    );
    boxList(row, row, 14, 14, 'Şef Savunma Sütunu (Tüm satırlar doldurulmalıdır)', {
      bg: SUM,
      fc: WARNF,
      b: true,
      sz: 9.5
    });
    wsList.getRow(row).height = 26;
  }

  // =========================================================================
  // SHEET 2: ŞEF BAZLI İNDİRİMSİZ FATURA ÖZET KARNESİ
  // =========================================================================
  const wsScore = wb.addWorksheet('Şef Özet Karnesi', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 6 }]
  });
  const boxScore = makeBoxHelper(wsScore);

  const scoreWidths = [7, 26, 34, 18, 18, 16, 18, 22, 22, 22, 32];
  const NC_SCORE = scoreWidths.length;
  scoreWidths.forEach((w, i) => {
    wsScore.getColumn(i + 1).width = w;
  });

  let sRow = 1;
  boxScore(
    sRow,
    sRow,
    1,
    NC_SCORE,
    'SATINALMA ŞEFLERİ İNDİRİMSİZ FATURA KARNESİ (TEKLİF MERKEZİ VS DOĞRUDAN GİRİŞ KARŞILAŞTIRMASI)',
    { bg: NAVY, fc: WHITE, b: true, sz: 13, border: false }
  );
  wsScore.getRow(sRow).height = 28;
  sRow++;

  boxScore(
    sRow,
    sRow,
    1,
    NC_SCORE,
    `Kurum: АО «ГЭС Констракшн» · Kapsam: ${filterLabel} · Tarih: ${dateStr} · Hedef İndirim Oranı: %${targetPct}`,
    { bg: NAVY2, fc: WHITE, b: false, sz: 9.5, border: false }
  );
  wsScore.getRow(sRow).height = 19;
  sRow += 2;

  const scoreHeaders: Array<{ title: string; al?: 'left' | 'center' | 'right' }> = [
    { title: 'Sıra', al: 'center' },
    { title: 'Satınalma Şefi' },
    { title: 'Sorumlu Olduğu Şantiyeler' },
    { title: 'İndirimli Fatura\n(Teklif Merkezi)', al: 'center' },
    { title: 'İndirimsiz Fatura\n(Doğrudan Giriş)', al: 'center' },
    { title: 'Toplam Fatura', al: 'center' },
    { title: 'İndirimsiz Oran (%)', al: 'right' },
    { title: 'Kazanılan Mevcut İndirim (₽)', al: 'right' },
    { title: 'İndirimsiz Fatura Tutarı (₽)', al: 'right' },
    { title: `Tahmini Kayıp İndirim (%${targetPct})`, al: 'right' },
    { title: 'Denetim Durumu & Yönetim Uyarısı', al: 'center' }
  ];

  scoreHeaders.forEach((sh, idx) => {
    boxScore(sRow, sRow, idx + 1, idx + 1, sh.title, {
      bg: HEAD,
      fc: BLACK,
      b: true,
      sz: 9.5,
      al: sh.al || 'left'
    });
  });
  wsScore.getRow(sRow).height = 28;
  sRow++;

  const firstScoreRow = sRow;
  scorecards.forEach((sc, idx) => {
    const isHigh = sc.undiscountedRatioPct >= 50;
    const isMed = sc.undiscountedRatioPct >= 25 && sc.undiscountedRatioPct < 50;
    const statusLabel =
      sc.undiscountedInvoiceCount === 0
        ? 'TAM UYUMLU'
        : isHigh
        ? 'KRİTİK — SAVUNMA İSTENMELİ'
        : isMed
        ? 'ORTA RİSK — SORGULANMALI'
        : 'DÜŞÜK — MÜNFERİT';

    boxScore(sRow, sRow, 1, 1, idx + 1, { al: 'center', b: true, bg: WHITE });
    boxScore(sRow, sRow, 2, 2, sc.supervisorName, { b: true, bg: WHITE });
    boxScore(sRow, sRow, 3, 3, sc.jobsiteNames.join(', ') || sc.primaryJobsiteName, { sz: 9.5, bg: WHITE });
    boxScore(sRow, sRow, 4, 4, sc.discountedInvoiceCount, { al: 'center', b: true, bg: GOOD, fc: GOODF });
    boxScore(sRow, sRow, 5, 5, sc.undiscountedInvoiceCount, {
      al: 'center',
      b: true,
      bg: sc.undiscountedInvoiceCount > 0 ? BAD : WHITE,
      fc: sc.undiscountedInvoiceCount > 0 ? BADF : BLACK
    });
    boxScore(sRow, sRow, 6, 6, sc.totalInvoiceCount, { al: 'center', b: true, bg: WHITE });
    boxScore(sRow, sRow, 7, 7, sc.undiscountedRatioPct / 100, {
      al: 'right',
      b: true,
      bg: isHigh ? BAD : isMed ? WARN : GOOD,
      fc: isHigh ? BADF : isMed ? WARNF : GOODF,
      fmt: '0.0%'
    });
    boxScore(sRow, sRow, 8, 8, sc.discountedTotalSavings, {
      al: 'right',
      b: true,
      bg: GOOD,
      fc: GOODF,
      fmt: '+#,##0.00 "₽"'
    });
    boxScore(sRow, sRow, 9, 9, sc.undiscountedTotalAmount, {
      al: 'right',
      b: true,
      bg: GREY,
      fmt: '#,##0.00 "₽"'
    });
    boxScore(sRow, sRow, 10, 10, sc.estimatedLostDiscountTotal, {
      al: 'right',
      b: true,
      bg: BAD,
      fc: BADF,
      fmt: '+#,##0.00 "₽"'
    });
    boxScore(sRow, sRow, 11, 11, statusLabel, {
      al: 'center',
      b: true,
      sz: 9,
      bg: isHigh ? BAD : isMed ? WARN : GOOD,
      fc: isHigh ? BADF : isMed ? WARNF : GOODF
    });
    wsScore.getRow(sRow).height = 24;
    sRow++;
  });

  const lastScoreRow = sRow - 1;
  if (scorecards.length > 0) {
    boxScore(sRow, sRow, 1, 3, 'GENEL TOPLAM:', { bg: SUM, fc: NAVY, b: true, sz: 10.5, al: 'right' });
    boxScore(
      sRow,
      sRow,
      4,
      4,
      { formula: `SUM(D${firstScoreRow}:D${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.discountedInvoiceCount, 0) },
      { bg: SUM, fc: GOODF, b: true, al: 'center' }
    );
    boxScore(
      sRow,
      sRow,
      5,
      5,
      { formula: `SUM(E${firstScoreRow}:E${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.undiscountedInvoiceCount, 0) },
      { bg: SUM, fc: BADF, b: true, al: 'center' }
    );
    boxScore(
      sRow,
      sRow,
      6,
      6,
      { formula: `SUM(F${firstScoreRow}:F${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.totalInvoiceCount, 0) },
      { bg: SUM, fc: NAVY, b: true, al: 'center' }
    );
    boxScore(sRow, sRow, 7, 7, '-', { bg: SUM, fc: NAVY, b: true, al: 'center' });
    boxScore(
      sRow,
      sRow,
      8,
      8,
      { formula: `SUM(H${firstScoreRow}:H${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.discountedTotalSavings, 0) },
      { bg: SUM, fc: GOODF, b: true, al: 'right', fmt: '+#,##0.00 "₽"' }
    );
    boxScore(
      sRow,
      sRow,
      9,
      9,
      { formula: `SUM(I${firstScoreRow}:I${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.undiscountedTotalAmount, 0) },
      { bg: SUM, fc: NAVY, b: true, al: 'right', fmt: '#,##0.00 "₽"' }
    );
    boxScore(
      sRow,
      sRow,
      10,
      10,
      { formula: `SUM(J${firstScoreRow}:J${lastScoreRow})`, result: scorecards.reduce((s, c) => s + c.estimatedLostDiscountTotal, 0) },
      { bg: BAD, fc: BADF, b: true, al: 'right', fmt: '+#,##0.00 "₽"' }
    );
    boxScore(sRow, sRow, 11, 11, '', { bg: SUM, fc: NAVY, b: true });
    wsScore.getRow(sRow).height = 25;
  }

  const safeSupSuffix = opts.focusedSupervisorName
    ? `_${opts.focusedSupervisorName.replace(/\s+/g, '_')}`
    : '';
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GES_Indirim_Alinmayan_Faturalar_Sorgu_Raporu${safeSupSuffix}_${todayIso}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Downloads Standalone Corporate HTML file (.html)
 */
export function downloadUndiscountedInvoicesHtml(
  rows: UndiscountedInvoiceRow[],
  scorecards: SupervisorUndiscountedScorecard[],
  opts: UndiscountedReportOptions = {}
): void {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const safeSupSuffix = opts.focusedSupervisorName
    ? `_${opts.focusedSupervisorName.replace(/\s+/g, '_')}`
    : '';
  const html = renderUndiscountedInvoicesHtml(rows, scorecards, { ...opts, todayIso, embedded: false });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `GES_Indirim_Alinmayan_Faturalar_Sorgu_Raporu${safeSupSuffix}_${todayIso}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Downloads A3 Landscape Corporate PDF file (.pdf) using html2pdf.js
 */
export async function downloadUndiscountedInvoicesPdf(
  rows: UndiscountedInvoiceRow[],
  scorecards: SupervisorUndiscountedScorecard[],
  opts: UndiscountedReportOptions = {}
): Promise<void> {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const safeSupSuffix = opts.focusedSupervisorName
    ? `_${opts.focusedSupervisorName.replace(/\s+/g, '_')}`
    : '';
  const html2pdfMod = await import('html2pdf.js');
  const html2pdf = (html2pdfMod as any).default || html2pdfMod;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-10000px;top:0;width:1620px;background:#fff';
  container.innerHTML = renderUndiscountedInvoicesHtml(rows, scorecards, { ...opts, todayIso, embedded: true });
  document.body.appendChild(container);
  try {
    await html2pdf()
      .set({
        margin: [6, 6, 8, 6],
        filename: `GES_Indirim_Alinmayan_Faturalar_Sorgu_Raporu${safeSupSuffix}_${todayIso}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 1.6, useCORS: true, logging: false, windowWidth: 1620 },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.kpi', '.directiveBox'] }
      })
      .from(container.querySelector('.paper') || container)
      .save();
  } finally {
    container.remove();
  }
}
