import * as XLSX from 'xlsx';
import { formatRuble } from './format';
import { processItem } from './aiDecisionEngine';
import { areVendorsEqual } from './vendorNormalizer';
import { CANONICAL_28_CATEGORIES, normalizeCategoryName, sortCategoriesByPriority } from './categoryClassifier';
import { getCategorySpendingSummary, verifyProcurementDataIntegrity, isPrizmaAutoSyncedInvoice, getDashboardSpendItems, resolveSpendJobsite, toProcurementFilterOptions } from './procurementAnalyticsCore';
import { detectSuperIntelligentProcurementAnomalies } from './aiForensicAuditor';
import { isLowPriorityConsumable } from './lowPriorityConsumables';
import { getSynchronizedAppleToAppleComparisons } from './dualMaterialComparisonEngine';
export { isPrizmaAutoSyncedInvoice, getSynchronizedAppleToAppleComparisons };
const ua = formatRuble;

/* Centralized 28 Canonical Categories - Single Source of Truth */
export const EP = [...CANONICAL_28_CATEGORIES];
const gY=new Set(["diğer malzeme","diğer","diger","genel malzeme","genel","malzeme","inşaat malzemesi","insaat malzemesi","muhtelif","other","general","uncategorized","bilinmeyen","", "i̇nşaat demiri & çelik", "inşaat demiri & çelik", "insaat demiri & celik", "i̇nşaat demiri & metal", "inşaat demiri & metal", "harç & şap", "hizmet & lojistik"]);
const AY=["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const mI={individualGoals:.25,teamAssists:.2,financialSavings:.25,negotiationRounds:.15,networkExpansion:.15};


export type DateRangePreset = 'THIS_MONTH' | 'LAST_3_MONTHS' | 'LAST_12_MONTHS' | 'ALL_TIME' | 'CUSTOM';

export interface DashboardFilterState {
  dateRange: DateRangePreset;
  customStartDate?: string;
  customEndDate?: string;
  selectedJobsiteId: string;
  selectedSupervisorId: string;
  selectedCategory: string;
  selectedVendor?: string;
  invoiceNo?: string;
  searchTerm: string;
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  return hs(String(value));
}

function resolveBounds(filter: DashboardFilterState, bounds?: { start?: any; end?: any }): { start: Date; end: Date } {
  if (bounds && (bounds.start || bounds.end)) {
    const s = toDate(bounds.start) || new Date(2000, 0, 1, 0, 0, 0, 0);
    const e0 = toDate(bounds.end) || new Date();
    const e = new Date(e0.getFullYear(), e0.getMonth(), e0.getDate(), 23, 59, 59, 999);
    return { start: s, end: e };
  }
  return pg(filter.dateRange, filter.customStartDate, filter.customEndDate);
}

export function getDateRangeBounds(preset: DateRangePreset, customStart?: string, customEnd?: string): { start?: string; end?: string } {
  const now = new Date();
  if (preset === 'THIS_MONTH') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  if (preset === 'LAST_3_MONTHS') {
    return { start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  if (preset === 'LAST_12_MONTHS') {
    return { start: new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
  }
  if (preset === 'CUSTOM') return { start: customStart, end: customEnd };
  return {};
}

export function getPreviousPeriodBounds(_preset: DateRangePreset, start?: string, end?: string): { start?: string; end?: string } {
  if (!start) return {};
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const diffMs = e.getTime() - s.getTime();
  const prevEnd = new Date(s.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - diffMs);
  return { start: prevStart.toISOString().split('T')[0], end: prevEnd.toISOString().split('T')[0] };
}

export function dedupeSyncedInvoices(invoices: any[] = [], _discounts: any[] = []): any[] {
  if (!Array.isArray(invoices)) return [];

  // Build an index of standalone (manually uploaded or direct) GES platform invoices
  const standaloneDiscountIds = new Set<string>();
  const standaloneInvoiceKeys = new Set<string>();

  invoices.forEach(inv => {
    if (!inv || inv.isDeleted || inv.isPermanentlyDeleted || isPrizmaAutoSyncedInvoice(inv)) return;
    const invId = String(inv.id || '');
    if (!invId.startsWith('inv_sync_')) {
      if (inv.discountId) {
        standaloneDiscountIds.add(String(inv.discountId));
      }
      const invNo = (inv.invoiceNumber || '').trim().toLowerCase();
      const supplier = (inv.supplier || '').trim().toLowerCase();
      if (invNo && supplier && !invNo.startsWith('tkf-') && !invNo.startsWith('ft-')) {
        standaloneInvoiceKeys.add(`${supplier}:::${invNo}`);
      }
    }
  });

  // Include all valid GES platform standalone invoices, and include synced invoices UNLESS
  // an equivalent standalone invoice already represents the exact same purchase.
  // Prizma auto-synced invoices are strictly excluded from Dashboard spending calculations.
  return invoices.filter(inv => {
    if (!inv || inv.isDeleted || inv.isPermanentlyDeleted || isPrizmaAutoSyncedInvoice(inv)) return false;
    const invId = String(inv.id || '');
    if (invId.startsWith('inv_sync_')) {
      const discId = inv.discountId ? String(inv.discountId) : invId.replace(/^inv_sync_/, '');
      if (standaloneDiscountIds.has(discId)) {
        return false;
      }
      const invNo = (inv.invoiceNumber || '').trim().toLowerCase();
      const supplier = (inv.supplier || '').trim().toLowerCase();
      if (invNo && supplier && !invNo.startsWith('tkf-') && !invNo.startsWith('ft-') && standaloneInvoiceKeys.has(`${supplier}:::${invNo}`)) {
        return false;
      }
    }
    return true;
  });
}

export function matchesDate(
  dateValue: any,
  dateRange: DateRangePreset,
  bounds?: { start?: Date; end?: Date }
): boolean {
  if (dateRange === 'ALL_TIME') {
    return true;
  }
  if (!dateValue || !String(dateValue).trim()) {
    return false;
  }
  const parsed = hs(dateValue);
  if (!parsed) {
    return false;
  }
  if (bounds) {
    if (bounds.start && parsed < bounds.start) return false;
    if (bounds.end && parsed > bounds.end) return false;
  }
  return true;
}

export function extractDistinctCategories(invoices: any[] = [], discounts: any[] = []): string[] {
  return NY(invoices, discounts) as string[];
}

export function filterInvoices(invoices: any[] = [], filter: DashboardFilterState, bounds?: { start?: any; end?: any }): any[] {
  return UN(invoices, filter, resolveBounds(filter, bounds));
}

export function filterDiscounts(discounts: any[] = [], filter: DashboardFilterState, bounds?: { start?: any; end?: any }): any[] {
  return HN(discounts, filter, resolveBounds(filter, bounds));
}

export function calculateKPIStats(params: any): any {
  return bY(params);
}

export function getMonthlySpendingTrend(invoices: any[] = [], discounts: any[] = [], monthsCount: number = 12, filter?: any): any[] {
  const list = SY(invoices, discounts, monthsCount, filter);
  return list.map((m: any) => ({ ...m, month: m.monthLabel, spending: m.spend }));
}

export function getJobsiteSpendingDistribution(invoices: any[] = [], jobsites: any[] = [], limit: number = 8, filter?: any): any[] {
  return kY(invoices, jobsites, limit, filter);
}

export function getCategorySpendingDistribution(
  invoices: any[] = [],
  limit: number = 30,
  comparisons?: any[],
  filter?: any
): any[] {
  return PY(invoices, limit, comparisons, filter);
}

export function getSupervisorPerformanceData(discounts: any[] = [], supervisors: any[] = []): any[] {
  return TY(discounts, supervisors);
}

export interface TopPriceGapFilterOptions {
  sourceFilter?: 'local_only' | 'all' | 'prizma_only';
  significantOnly?: boolean;
  minSpendRub?: number;
  minSavingsRub?: number;
  sortBy?: 'impact' | 'percentage' | 'spend';
}

export function getTopPriceDifferenceMaterials(
  comparisons: any[] = [],
  limit: number = 6,
  category?: string,
  search?: string,
  options?: TopPriceGapFilterOptions
): any[] {
  const sourceFilter = options?.sourceFilter || 'local_only';
  const significantOnly = options?.significantOnly !== false;
  const minSpendRub = options?.minSpendRub ?? 50000;
  const minSavingsRub = options?.minSavingsRub ?? 15000;
  const sortBy = options?.sortBy || 'impact';

  // Run the exact same Apple-to-Apple + Source Filter pipeline used by MaterialPriceComparison
  const synchronized = getSynchronizedAppleToAppleComparisons(comparisons, sourceFilter);

  const validGapItems = synchronized
    .filter(r => {
      if (!r || r.minUnitPrice <= 0 || r.maxUnitPrice <= r.minUnitPrice) return false;
      if (wY(r.materialName, r.category)) return false;
      const historyLen = Array.isArray(r.history) ? r.history.length : 0;
      if (historyLen < 2) return false;
      const pct = r.priceDifferencePercentage || Number((((r.maxUnitPrice - r.minUnitPrice) / r.minUnitPrice) * 100).toFixed(1));
      if (pct < 3) return false;
      if (category && category !== 'ALL') {
        const normCat = normalizeCategoryName(r.category, r.materialName).toLowerCase().trim();
        const targetCat = normalizeCategoryName(category).toLowerCase().trim();
        if (normCat !== targetCat && (r.category || '').toLowerCase().trim() !== category.toLowerCase().trim()) {
          return false;
        }
      }
      if (search && search.trim() !== '') {
        const n = search.toLowerCase().trim();
        const o = r.materialName && r.materialName.toLowerCase().includes(n);
        const u = r.category && r.category.toLowerCase().includes(n);
        const origMatch = Array.isArray(r.history) && r.history.some((h: any) => h.originalName && String(h.originalName).toLowerCase().includes(n));
        if (!o && !u && !origMatch) return false;
      }
      return true;
    })
    .map(r => {
      const history = Array.isArray(r.history) ? r.history : [];
      const minPrice = Number(r.minUnitPrice) || 0;
      const maxPrice = Number(r.maxUnitPrice) || 0;
      const avgPrice = Number(r.averageUnitPrice || r.avgUnitPrice) || minPrice;
      const totalSpend = Number(r.totalSpend) || 0;
      const totalQty = Number(r.totalQuantityPurchased) || 0;
      const priceDiffPercentage =
        r.priceDifferencePercentage ||
        (minPrice > 0 ? Number((((maxPrice - minPrice) / minPrice) * 100).toFixed(1)) : 0);

      // Realistic financial impact / savings potential:
      // Calculate excess paid above minUnitPrice across all history entries (or fallback to (avg - min)*qty)
      let excessPaidRub = 0;
      history.forEach((h: any) => {
        const p = Number(h.normalizedUnitPrice ?? h.unitPrice) || 0;
        const q = Number(h.normalizedQuantity ?? h.quantity) || 0;
        if (p > minPrice && q > 0) {
          excessPaidRub += (p - minPrice) * q;
        }
      });
      if (excessPaidRub <= 0 && maxPrice > minPrice && totalQty > 0) {
        excessPaidRub = (maxPrice - minPrice) * Math.min(totalQty, Math.max(1, totalQty * 0.5));
      }
      const potentialSavingsRub = Math.round(excessPaidRub);

      const cheapestEntry = history.find(
        (h: any) => Math.abs((Number(h.normalizedUnitPrice ?? h.unitPrice) || 0) - minPrice) < 0.01
      );
      const priciestEntry = history.find(
        (h: any) => Math.abs((Number(h.normalizedUnitPrice ?? h.unitPrice) || 0) - maxPrice) < 0.01
      );

      const isTrivial = isLowPriorityConsumable(r.materialName, r.category);
      const isMajorItem = !isTrivial && (totalSpend >= minSpendRub || potentialSavingsRub >= minSavingsRub);

      // Smart composite score combining financial impact (₽), total spend volume, and percentage spread
      const impactScore = potentialSavingsRub * 1.5 + totalSpend * 0.35 + priceDiffPercentage * 250;

      return {
        id: r.id || `${r.materialName}___${r.unit}`,
        materialName: r.materialName,
        category: r.category || 'Genel',
        unit: r.unit || 'Birim',
        minPrice,
        maxPrice,
        avgPrice,
        minUnitPrice: minPrice,
        maxUnitPrice: maxPrice,
        priceDiffPercentage,
        priceGapPercentage: priceDiffPercentage,
        priceDifferencePercentage: priceDiffPercentage,
        totalSpend,
        totalQuantityPurchased: totalQty,
        potentialSavingsRub,
        invoiceCount: history.length,
        cheapestJobsite: cheapestEntry?.jobsiteName || (r as any).cheapestJobsite || (r as any).cheapestJobsiteName || 'En Uygun Şantiye',
        priciestJobsite: priciestEntry?.jobsiteName || (r as any).priciestJobsite || (r as any).priciestJobsiteName || 'En Yüksek Şantiye',
        cheapestJobsiteName: cheapestEntry?.jobsiteName || (r as any).cheapestJobsite || (r as any).cheapestJobsiteName || 'En Uygun Şantiye',
        priciestJobsiteName: priciestEntry?.jobsiteName || (r as any).priciestJobsite || (r as any).priciestJobsiteName || 'En Yüksek Şantiye',
        cheapestSupplier: cheapestEntry?.supplier || '',
        priciestSupplier: priciestEntry?.supplier || '',
        isMajorItem,
        isTrivial,
        impactScore,
        sourceFilter
      };
    });

  let pool = validGapItems;
  if (significantOnly) {
    const majorOnly = validGapItems.filter(item => item.isMajorItem);
    // If the user filtered by a specific narrow category that only has medium items, fallback to non-trivial items in that category
    if (majorOnly.length > 0) {
      pool = majorOnly;
    } else if (category && category !== 'ALL') {
      pool = validGapItems.filter(item => !item.isTrivial && item.totalSpend >= 5000);
    } else {
      pool = majorOnly;
    }
  }

  pool.sort((a, b) => {
    if (sortBy === 'percentage') {
      if (b.priceDiffPercentage !== a.priceDiffPercentage) return b.priceDiffPercentage - a.priceDiffPercentage;
      return b.potentialSavingsRub - a.potentialSavingsRub;
    }
    if (sortBy === 'spend') {
      if (b.totalSpend !== a.totalSpend) return b.totalSpend - a.totalSpend;
      return b.potentialSavingsRub - a.potentialSavingsRub;
    }
    // Default 'impact': prioritize net financial savings impact & volume so major structural items come first
    return b.impactScore - a.impactScore;
  });

  return limit > 0 ? pool.slice(0, limit) : pool;
}

export function getRecentCombinedTransactions(invoices: any[] = [], discounts: any[] = [], limit: number = 0): any[] {
  return DY(invoices, discounts, limit);
}

export function getTopDiscountRecords(discounts: any[] = [], limit: number = 5): any[] {
  return OY(discounts, limit);
}

export function getDashboardAnomalies(
  invoices: any[] = [],
  discounts: any[] = [],
  comparisons: any[] = [],
  sourceFilter: 'local_only' | 'all' | 'prizma_only' = 'local_only'
): any[] {
  const syncedComparisons = getSynchronizedAppleToAppleComparisons(comparisons, sourceFilter);
  const significantSyncedComparisons = syncedComparisons.filter(
    c => !isLowPriorityConsumable(c.materialName, c.category) && (Number(c.totalSpend) || 0) >= 25000 && (c.history?.length || 0) >= 2
  );

  const legacy = MY(invoices, discounts, significantSyncedComparisons).map((a: any) => ({
    ...a,
    description: a.materialOrSupplier ? a.materialOrSupplier + ' - ' + a.title : a.title,
    rawRecord: undefined,
  }));

  const superAnomalies = detectSuperIntelligentProcurementAnomalies(invoices, discounts, significantSyncedComparisons).map((sa: any) => ({
    id: sa.id,
    type: sa.type,
    severity: sa.severity,
    title: sa.title,
    materialOrSupplier: sa.materialName || sa.supplier || sa.vendorName || sa.category,
    description: `${sa.title} (${sa.materialName || sa.supplier || sa.category})`,
    impactAmount: sa.impactAmount,
    percentageChange: sa.percentageChange,
    date: sa.date,
    evidence: sa.evidence,
    recommendation: sa.recommendation,
    jobsiteName: sa.jobsiteName,
    category: sa.category,
    materialName: sa.materialName,
    rawRecord: undefined
  }));

  // Combine and deduplicate by id
  const map = new Map<string, any>();
  superAnomalies.forEach((a: any) => map.set(a.id, a));
  legacy.forEach((a: any) => {
    if (!map.has(a.id)) map.set(a.id, a);
  });

  return Array.from(map.values()).filter((a: any) =>
    !isLowPriorityConsumable(a.materialName || a.materialOrSupplier, a.category, a.title) &&
    (Number(a.impactAmount) || 0) >= 10000
  ).sort((a: any, b: any) => {
    const sev = { CRITICAL: 1, WARNING: 2, INFO: 3 };
    const diff = (sev[a.severity as keyof typeof sev] || 2) - (sev[b.severity as keyof typeof sev] || 2);
    if (diff !== 0) return diff;
    return (b.impactAmount || 0) - (a.impactAmount || 0);
  });
}

export { detectSuperIntelligentProcurementAnomalies };

export function exportDashboardToExcel(data: any): void {
  CY(data);
}

export { exportDashboardToHtml, generateDashboardHtmlReport } from './dashboardHtmlReport';

export function classifyItemCategory(materialName?: string, originalName?: string, supplier?: string, category?: string): string {
  return normalizeCategoryName(category, materialName || originalName);
}

function j0(e: any ): any {return e?gY.has(e.toLowerCase().trim()):!0}
function KN(e: any ): any {
  if(!e)return"Sarf Malzeme & Hırdavat";
  return normalizeCategoryName(String(e));
}
function _s(e: any ,t: any ,a: any ,i: any ): any {
  return classifyItemCategory(e, t, a, i);
}
function ps(e: any ): any {
  const t=e.supplier||e.vendorName||"";
  const a=Array.isArray(e.items)?e.items:[];
  if(a.length>0){
    const r=new Map;
    a.forEach((c: any)=>{
      const f=normalizeCategoryName(c.category, c.materialName || c.originalName);
      const m=Number(c.totalPrice)||Number(c.unitPrice)*Number(c.quantity)||1;
      r.set(f,(r.get(f)||0)+m);
    });
    const sorted = Array.from(r.entries()).sort((c: any,f: any)=>f[1]-c[1]);
    if(sorted.length>0) return sorted[0][0];
  }
  if(e.category) return normalizeCategoryName(e.category, e.notes);
  return normalizeCategoryName(undefined, e.notes);
}
function hs(e: any ): any {if(!e)return null;const t=String(e).trim();if(!t)return null;const a=t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);if(a){const n=parseInt(a[1],10),o=parseInt(a[2],10)-1,u=parseInt(a[3],10),c=new Date(u,o,n);if(!isNaN(c.getTime()))return c}const i=t.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);if(i){const n=parseInt(i[1],10),o=parseInt(i[2],10)-1,u=parseInt(i[3],10),c=new Date(n,o,u);if(!isNaN(c.getTime()))return c}const r=new Date(t);return isNaN(r.getTime())?null:r}
function qN(e: any ): any {const t=hs(e);if(!t)return null;const a=t.getFullYear(),i=String(t.getMonth()+1).padStart(2,"0");return`${a}-${i}`}
function pg(e: any ,t: any ,a: any ): any {const i=new Date,r=new Date(i.getFullYear(),i.getMonth(),i.getDate(),23,59,59,999);let n;switch(e){case"THIS_MONTH":n=new Date(i.getFullYear(),i.getMonth(),1,0,0,0,0);break;case"LAST_3_MONTHS":n=new Date(i.getFullYear(),i.getMonth()-2,1,0,0,0,0);break;case"LAST_12_MONTHS":n=new Date(i.getFullYear(),i.getMonth()-11,1,0,0,0,0);break;case"CUSTOM":if(t){const o=hs(t);n=o?new Date(o.getFullYear(),o.getMonth(),o.getDate(),0,0,0,0):new Date(2e3,0,1)}else n=new Date(i.getFullYear(),i.getMonth()-11,1);if(a){const o=hs(a);if(o)return{start:n,end:new Date(o.getFullYear(),o.getMonth(),o.getDate(),23,59,59,999)}}break;case"ALL_TIME":default:n=new Date(2e3,0,1,0,0,0,0);break}return{start:n,end:r}}
function xY(e: any ,t: any ,a: any ): any {const i=a.getTime()-t.getTime(),r=new Date(t.getTime()-1);return{start:new Date(r.getTime()-i),end:r}}
function Wo(e: any ,t: any ): any {if(!e||!t)return!1;const a=e.trim().toLowerCase(),i=t.trim().toLowerCase();return a===i||KN(e).toLowerCase()===KN(t).toLowerCase()}
function UN(e: any ,t: any ,a: any ): any {if(!Array.isArray(e))return[];const i=a||pg(t.dateRange,t.customStartDate,t.customEndDate);return e.filter(r=>{if(r.isDeleted||r.isPermanentlyDeleted)return!1;if(!matchesDate(r.date,t.dateRange,i))return!1;if(t.selectedJobsiteId&&t.selectedJobsiteId!=="ALL"&&r.jobsiteId!==t.selectedJobsiteId||t.selectedSupervisorId&&t.selectedSupervisorId!=="ALL"&&r.uploadedBySupervisorId!==t.selectedSupervisorId)return!1;if(t.selectedVendor&&t.selectedVendor!=="ALL"&&!areVendorsEqual(r.supplier,t.selectedVendor))return!1;if(t.invoiceNo&&t.invoiceNo.trim()!==""&&(!r.invoiceNumber||!r.invoiceNumber.toLowerCase().includes(t.invoiceNo.toLowerCase().trim())))return!1;if(t.selectedCategory&&t.selectedCategory!=="ALL"){const n=t.selectedCategory,o=ps({supplier:r.supplier,notes:r.notes,items:r.items}),u=Wo(o,n),c=Array.isArray(r.items)&&r.items.some(f=>Wo(f.category,n)||Wo(_s(f.materialName,f.originalName,r.supplier,f.category),n));if(!u&&!c)return!1}if(t.searchTerm&&t.searchTerm.trim()!==""){const n=t.searchTerm.toLowerCase().trim(),o=r.supplier&&r.supplier.toLowerCase().includes(n),u=r.invoiceNumber&&r.invoiceNumber.toLowerCase().includes(n),c=r.jobsiteName&&r.jobsiteName.toLowerCase().includes(n),f=r.uploadedBySupervisorName&&r.uploadedBySupervisorName.toLowerCase().includes(n),m=Array.isArray(r.items)&&r.items.some(p=>p.materialName&&p.materialName.toLowerCase().includes(n)||p.originalName&&p.originalName.toLowerCase().includes(n));if(!o&&!u&&!c&&!f&&!m)return!1}return!0})}
function HN(e: any ,t: any ,a: any ): any {if(!Array.isArray(e))return[];const i=a||pg(t.dateRange,t.customStartDate,t.customEndDate);return e.filter(r=>{if(r.isDeleted||r.isPermanentlyDeleted)return!1;if(!matchesDate(r.orderDate,t.dateRange,i))return!1;if(t.selectedJobsiteId&&t.selectedJobsiteId!=="ALL"&&r.jobsiteId!==t.selectedJobsiteId||t.selectedSupervisorId&&t.selectedSupervisorId!=="ALL"&&r.supervisorId!==t.selectedSupervisorId)return!1;if(t.selectedVendor&&t.selectedVendor!=="ALL"&&!areVendorsEqual(r.vendorName,t.selectedVendor))return!1;if(t.invoiceNo&&t.invoiceNo.trim()!==""&&(!r.invoiceNo||!r.invoiceNo.toLowerCase().includes(t.invoiceNo.toLowerCase().trim())))return!1;if(t.selectedCategory&&t.selectedCategory!=="ALL"){const n=t.selectedCategory,o=ps({category:r.category,vendorName:r.vendorName,notes:r.notes,items:r.items}),u=Wo(r.category,n)||Wo(o,n),c=Array.isArray(r.items)&&r.items.some(f=>Wo(f.category,n)||Wo(_s(f.materialName,f.originalName,r.vendorName,f.category),n));if(!u&&!c)return!1}if(t.searchTerm&&t.searchTerm.trim()!==""){const n=t.searchTerm.toLowerCase().trim(),o=r.vendorName&&r.vendorName.toLowerCase().includes(n),u=r.jobsiteName&&r.jobsiteName.toLowerCase().includes(n),c=r.supervisorName&&r.supervisorName.toLowerCase().includes(n),f=r.notes&&r.notes.toLowerCase().includes(n),m=Array.isArray(r.items)&&r.items.some(p=>p.materialName&&p.materialName.toLowerCase().includes(n)||p.originalName&&p.originalName.toLowerCase().includes(n));if(!o&&!u&&!c&&!f&&!m)return!1}return!0})}
function GN(e: any ,t: any ): any {return t===0?e>0?100:0:Number(((e-t)/t*100).toFixed(1))}
function NY(e: any ,t: any ): any {const a=new Set;Array.isArray(e)&&e.forEach(r=>{if(r.isDeleted)return;const n=ps({supplier:r.supplier,notes:r.notes,items:r.items});n&&!j0(n)&&a.add(n),Array.isArray(r.items)&&r.items.forEach(o=>{const u=_s(o.materialName,o.originalName,r.supplier,o.category);u&&!j0(u)&&a.add(u)})}),Array.isArray(t)&&t.forEach(r=>{if(r.isDeleted)return;const n=ps({category:r.category,vendorName:r.vendorName,notes:r.notes,items:r.items});n&&!j0(n)&&a.add(n),Array.isArray(r.items)&&r.items.forEach(o=>{const u=_s(o.materialName,o.originalName,r.vendorName,o.category);u&&!j0(u)&&a.add(u)})});const i=Array.from(a);return i.length===0?Array.from(EP):i.sort()}
function bY(e: any ): any {
  const{currentInvoices:rawInvoices=[],currentDiscounts:rawDiscounts=[],previousInvoices:rawPrevInvoices=[],previousDiscounts:rawPrevDiscounts=[],jobsites:n=[],supervisors:o=[],anomaliesCount:u=0,categorySpending=[]}=e;
  const t=rawInvoices.filter((F: any)=>!F.isDeleted&&!F.isPermanentlyDeleted);
  const a=rawDiscounts.filter((F: any)=>!F.isDeleted&&!F.isPermanentlyDeleted);
  const i=rawPrevInvoices.filter((F: any)=>!F.isDeleted&&!F.isPermanentlyDeleted);
  const r=rawPrevDiscounts.filter((F: any)=>!F.isDeleted&&!F.isPermanentlyDeleted);
  const c=t;
  const invoiceTotalSum = c.reduce((F: any, ae: any) => F + (Number(ae.totalAmount) || 0), 0);
  const catTotalSpend = Array.isArray(categorySpending) && categorySpending.length > 0
    ? categorySpending.reduce((acc: number, curr: any) => acc + (Number(curr.spend) || 0), 0)
    : 0;
  // Toplam Harcama = paylaşılan harcama defteri (kategori/şantiye/aylık panellerle aynı kalemler).
  const hasLedgerTotal = typeof e.currentSpendTotal === 'number';
  const f = hasLedgerTotal ? e.currentSpendTotal : (invoiceTotalSum > 0 ? invoiceTotalSum : catTotalSpend);
  const m=c.reduce((F: any,ae: any)=>{const ue=Array.isArray(ae.items)?ae.items.reduce((re: any,Z: any)=>re+(Number(Z.discountAmount)||0),0):0;return F+(Number(ae.discount)||ue||0)},0);
  const p=a.reduce((F: any,ae: any)=>{const ue=Math.max(0,(Number(ae.offerPrice)||0)-(Number(ae.agreedPrice)||0));return F+(Number(ae.discountAmount)||ue||0)},0);
  const h=p>0?p:m;
  const v=a.reduce((F: any,ae: any)=>{const ue=Number(ae.offerPrice)||0,re=Number(ae.agreedPrice)||0,Z=Number(ae.discountAmount)||0;return F+(ue>0?ue:re+Z)},0);
  const N=v>0?v:f+h;
  const y=N>0&&h>0?Number((h/N*100).toFixed(2)):0;
  const S=typeof e.previousSpendTotal === 'number' ? e.previousSpendTotal : i.reduce((F: any,ae: any)=>F+(Number(ae.totalAmount)||0),0);
  const T=r.reduce((F: any,ae: any)=>F+(Number(ae.discountAmount)||0),0);
  const k=r.reduce((F: any,ae: any)=>F+(Number(ae.offerPrice)||Number(ae.agreedPrice)+Number(ae.discountAmount)||0),0)||S+T;
  const w=k>0&&T>0?Number((T/k*100).toFixed(2)):0;
  const M=GN(f,S);
  const D=GN(h,T);
  const E=Number((y-w).toFixed(2));
  const L=Array.isArray(n)?n.filter((F: any)=>F.status==="Aktif").length:0;
  const C=Array.isArray(o)?o.length:0;
  const B=a.filter((F: any)=>F.status==="Beklemede"||F.status==="İncelemede").length;
  const K=c.length+a.length;
  return{totalSpend:f,spendChangePercentage:M,totalDiscount:h,discountChangePercentage:D,avgDiscountRate:y,discountRateChangePercentage:E,activeJobsitesCount:L,supervisorsCount:C,anomaliesCount:u,pendingTransactionsCount:B,totalTransactionsCount:K,invoicesCount:c.length,discountsCount:a.length};
}
function SY(e: any ,t: any ,a: any =12, filter?: any): any {
  const months: any[] = [], now = new Date;
  for (let o = a - 1; o >= 0; o--) {
    const d = new Date(now.getFullYear(), now.getMonth() - o, 1), y = d.getFullYear(), m = d.getMonth();
    months.push({ monthKey: `${y}-${String(m + 1).padStart(2, "0")}`, monthLabel: `${AY[m]} ${y}`, spend: 0, discount: 0, netSpend: 0, transactionCount: 0 });
  }
  const byKey = new Map(months.map(m => [m.monthKey, m]));
  const countedInvoices = new Set<string>();
  getDashboardSpendItems(Array.isArray(e) ? e : [], filter).forEach(it => {
    const key = qN(it.rawInvoice?.date || it.date);
    const row = key ? byKey.get(key) : null;
    if (!row) return;
    row.spend += it.totalPrice;
    row.netSpend += it.totalPrice;
    if (!countedInvoices.has(it.invoiceId)) { countedInvoices.add(it.invoiceId); row.transactionCount += 1; }
  });
  Array.isArray(t) && t.forEach((o: any) => {
    const key = o.orderDate ? qN(o.orderDate) : null;
    const row = key ? byKey.get(key) : null;
    if (row) { row.discount += Number(o.discountAmount) || 0; row.transactionCount += 1; }
  });
  return months;
}
function kY(e: any ,t: any ,a: any =8, filter?: any): any {
  const jobsites = Array.isArray(t) ? t : [];
  const sites = new Map<string, { name: string; spend: number; invoiceIds: Set<string> }>();
  let total = 0;
  getDashboardSpendItems(Array.isArray(e) ? e : [], filter).forEach(it => {
    const ref = resolveSpendJobsite(it, jobsites);
    const row = sites.get(ref.id) || { name: ref.name, spend: 0, invoiceIds: new Set<string>() };
    row.spend += it.totalPrice;
    row.invoiceIds.add(it.invoiceId);
    sites.set(ref.id, row);
    total += it.totalPrice;
  });
  const budgets = new Map(jobsites.map((j: any) => [j.id, Number(j.budget) || 0]));
  const list = Array.from(sites.entries())
    .filter(([, v]) => v.spend > 0)
    .map(([id, v]) => {
      const budget = budgets.get(id) || 0;
      return {
        jobsiteId: id,
        jobsiteName: v.name,
        spend: v.spend,
        percentage: total > 0 ? Number(((v.spend / total) * 100).toFixed(1)) : 0,
        invoiceCount: v.invoiceIds.size,
        budget,
        budgetUsagePercentage: budget > 0 ? Number(((v.spend / budget) * 100).toFixed(1)) : 0
      };
    })
    .sort((x, y) => y.spend - x.spend);
  // Tek kalan şantiyeyi "Diğer (1)" diye gizleme; adıyla göster.
  if (list.length <= a + 1) return list;
  const head = list.slice(0, a), rest = list.slice(a), restSpend = rest.reduce((s, v) => s + v.spend, 0);
  head.push({
    jobsiteId: "others",
    jobsiteName: `Diğer Şantiyeler (${rest.length})`,
    spend: restSpend,
    percentage: total > 0 ? Number(((restSpend / total) * 100).toFixed(1)) : 0,
    invoiceCount: rest.reduce((s, v) => s + v.invoiceCount, 0),
    budget: 0,
    budgetUsagePercentage: 0
  });
  return head;
}
function PY(e: any = [], t: any = 30, _comparisons?: any[], filter?: any): any {
  const summary = getCategorySpendingSummary(e, toProcurementFilterOptions(filter));
  const nonZeroCategories = summary.categoriesList.filter(c => c.spend > 0);
  return t > 0 ? nonZeroCategories.slice(0, t) : nonZeroCategories;
}
function TY(e: any ,t: any ): any {const a=new Map;return Array.isArray(t)&&t.forEach(i=>{a.set(i.id,{name:i.name,discount:0,spend:0,count:0,totalList:0})}),Array.isArray(e)&&e.forEach(i=>{const r=i.supervisorId||"unknown",n=a.get(r)||{name:i.supervisorName||"Bilinmeyen Şef",discount:0,spend:0,count:0,totalList:0},o=Number(i.discountAmount)||0,u=Number(i.agreedPrice)||0,c=Number(i.offerPrice)||u+o;n.discount+=o,n.spend+=u,n.totalList+=c,n.count+=1,a.set(r,n)}),Array.from(a.entries()).map(([i,r])=>{const n=r.totalList>0?Number((r.discount/r.totalList*100).toFixed(1)):0;return{supervisorId:i,supervisorName:r.name,totalDiscount:r.discount,totalSpend:r.spend,avgDiscountPercentage:n,transactionCount:r.count}}).sort((i,r)=>r.totalDiscount-i.totalDiscount)}
function wY(e: any ,t: any ): any {const a=`${e||""} ${t||""}`.toLowerCase();return["nakliye","nakliyat","taşımacılık","taşıma","teslimat","dağıtım","transport","transportation","dostavka","доставка","перевозка","транспорт","lojistik","logistics","логистика","kargo","kurye","navlun","freight","hizmet","hizmeti","servis","услуга","услуги","işçilik","montaj","vinç","kiralama","taksi","tahmil","tahliye","hammaliye","yükleme","boşaltma","kira"].some(r=>a.includes(r))}
function EY(e: any ,t: any =6,a: any ,i: any ): any {return Array.isArray(e)?e.filter(r=>{if(!r||r.minUnitPrice<=0||r.maxUnitPrice<=r.minUnitPrice||wY(r.materialName,r.category)||a&&a!=="ALL"&&(!r.category||r.category.toLowerCase().trim()!==a.toLowerCase().trim()))return!1;if(i&&i.trim()!==""){const n=i.toLowerCase().trim(),o=r.materialName&&r.materialName.toLowerCase().includes(n),u=r.category&&r.category.toLowerCase().includes(n);if(!o&&!u)return!1}return!0}).map(r=>({materialName:r.materialName,category:r.category||"Genel",unit:r.unit||"Birim",minPrice:r.minUnitPrice,maxPrice:r.maxUnitPrice,priceDiffPercentage:r.priceDifferencePercentage||Number(((r.maxUnitPrice-r.minUnitPrice)/r.minUnitPrice*100).toFixed(1)),cheapestJobsite:r.cheapestJobsiteName||"En Uygun",priciestJobsite:r.priciestJobsiteName||"En Yüksek"})).sort((r,n)=>n.priceDiffPercentage-r.priceDiffPercentage).slice(0,t):[]}
function DY(e: any ,t: any ,a: any =20): any {const i=[];Array.isArray(e)&&e.forEach(n=>{if(n.isDeleted)return;const o=Number(n.totalAmount)||0,u=Array.isArray(n.items)?n.items.reduce((N,y)=>N+(Number(y.discountAmount)||0),0):0,c=Number(n.discount)||u||0,f=Number(n.subtotal)&&Number(n.subtotal)>o?Number(n.subtotal):o+c,m=f>0&&c>0?Number((c/f*100).toFixed(2)):0,p=Array.isArray(n.items)?n.items:[],h=ps({supplier:n.supplier,notes:n.notes,items:p}),v=p.length>0?p.length===1?p[0].materialName:`${p[0].materialName} (+${p.length-1} kalem)`:`${h} Faturası`;i.push({id:n.id,type:"INVOICE",date:n.date||n.created_at||new Date().toISOString().split("T")[0],title:`Fatura: ${n.invoiceNumber||"No Belirtilmedi"}`,invoiceNumber:n.invoiceNumber||"",supplier:n.supplier||"Tedarikçi Firma",jobsiteName:n.jobsiteName||"Şantiye",jobsiteId:n.jobsiteId||"",supervisorName:n.uploadedBySupervisorName||"Yetkili Şef",supervisorId:n.uploadedBySupervisorId||"",category:h,materialSummary:v,itemCount:p.length||1,initialPrice:f,amount:o,discountAmount:c,discountPercentage:m,status:"Onaylandı",hasFile:!!(n.fileUrl||n.rawFileName),fileUrl:n.fileUrl||void 0,rawRecord:n})}),Array.isArray(t)&&t.forEach(n=>{const o=Number(n.agreedPrice)||0;let u=n.discountAmount!=null?Number(n.discountAmount):0;const c=n.adjustedOfferPrice!=null?Number(n.adjustedOfferPrice):Number(n.offerPrice)||o+u,f=c;n.discountAmount==null&&c>o&&o>0&&(u=c-o);let m=Number(n.discountPercentage)||0;(!m||m<=0)&&f>0&&u>0&&(m=Number((u/f*100).toFixed(2)));const p=Array.isArray(n.items)?n.items:[],h=ps({category:n.category,vendorName:n.vendorName,notes:n.notes,items:p}),v=p.length>0?p.length===1?p[0].materialName:`${p[0].materialName} (+${p.length-1} kalem)`:`${h} Alımı`;i.push({id:n.id,type:"DISCOUNT",date:n.orderDate||n.created_at||new Date().toISOString().split("T")[0],title:`Pazarlık: ${n.category||"Malzeme"}`,invoiceNumber:n.invoiceNo||"",supplier:n.vendorName||"Tedarikçi",jobsiteName:n.jobsiteName||"Şantiye",jobsiteId:n.jobsiteId||"",supervisorName:n.supervisorName||"Yetkili Şef",supervisorId:n.supervisorId||"",category:h,materialSummary:v,itemCount:p.length||1,initialPrice:f,amount:o,discountAmount:u,discountPercentage:m,status:n.status||"Onaylandı",recordOriginType:n.recordOriginType||(n.performedByPersonnelId||n.performedByPersonnelName?"asist":"gol"),performedByPersonnelName:n.performedByPersonnelName||void 0,negotiationCount:Array.isArray(n.negotiationRounds)&&n.negotiationRounds.length>0?n.negotiationRounds.length:n.negotiationCount||0,crossNegotiationApplied:n.crossNegotiationApplied||!1,hasFile:!!(n.firstOfferFileUrl||n.finalOfferFileUrl),fileUrl:n.finalOfferFileUrl||n.firstOfferFileUrl||void 0,notes:n.notes||void 0,rawRecord:n})});const r=i.sort((n,o)=>{var f,m;const u=((f=hs(n.date))==null?void 0:f.getTime())||0;return(((m=hs(o.date))==null?void 0:m.getTime())||0)-u});return a>0?r.slice(0,a):r}
function OY(e: any ,t: any =5): any {return Array.isArray(e)?[...e].filter(a=>Number(a.discountPercentage)>0||Number(a.discountAmount)>0).sort((a,i)=>(Number(i.discountPercentage)||0)-(Number(a.discountPercentage)||0)).slice(0,t):[]}
function MY(e: any ,t: any ,a: any ): any {const i=[];return Array.isArray(a)&&a.forEach((r,n)=>{const o=r.priceDifferencePercentage||0;o>=20&&r.minUnitPrice>0&&i.push({id:`anom_comp_${n}`,type:"PRICE_GAP",severity:o>=40?"CRITICAL":"WARNING",title:`Şantiyeler Arası %${o.toFixed(0)} Fiyat Farkı`,materialOrSupplier:`${r.materialName} (${r.category})`,impactAmount:(r.maxUnitPrice-r.minUnitPrice)*(r.totalQuantityPurchased||1),percentageChange:o,date:r.history&&r.history.length>0?r.history[0].date:new Date().toISOString().split("T")[0]})}),Array.isArray(t)&&t.forEach(r=>{const n=Number(r.agreedPrice)||0,o=Number(r.discountPercentage)||0;n>=5e5&&o<2&&i.push({id:`anom_dsc_${r.id}`,type:"HIGH_VALUE_NO_DISCOUNT",severity:"WARNING",title:"Yüksek Tutarlı Düşük İskontolu Alım",materialOrSupplier:`${r.vendorName} - ${r.category}`,impactAmount:n*.05,percentageChange:o,date:r.orderDate||new Date().toISOString().split("T")[0]})}),i.slice(0,10)}
function CY(e: any ): any {const{kpis:t,filterInfo:a,jobsiteSpending:i,categorySpending:r,supervisorPerformance:n,recentTransactions:o}=e,u=XLSX.utils.book_new(),c=[["GES CONSTRUCTION - SATINALMA YÖNETİM RAPORU",""],["Rapor Oluşturma Tarihi:",new Date().toLocaleString("tr-TR")],["Filtre Tarih Aralığı:",a.dateRangeLabel],["Filtre Şantiye:",a.jobsiteLabel],["Filtre Kategori:",a.categoryLabel],[],["TEMEL PERFORMANS GÖSTERGELERİ (KPI)","DEĞER","ÖNCEKİ DÖNEME GÖRE DEĞİŞİM"],["Toplam Satınalma Harcaması (₽)",t.totalSpend,`%${t.spendChangePercentage}`],["Toplam Kazanılan İndirim (₽)",t.totalDiscount,`%${t.discountChangePercentage}`],["Ortalama İndirim Oranı (%)",`%${t.avgDiscountRate}`,`%${t.discountRateChangePercentage}`],["Aktif Şantiye Sayısı",t.activeJobsitesCount,"-"],["Satınalma Şefi Sayısı",t.supervisorsCount,"-"],["Tespit Edilen Anomali Sayısı",t.anomaliesCount,"-"],["Bekleyen / İncelemede Kayıt Sayısı",t.pendingTransactionsCount,"-"],["Toplam İşlem Sayısı (Fatura + İndirim)",t.totalTransactionsCount,"-"],["Fatura Sayısı",t.invoicesCount,"-"],["İndirim Kaydı Sayısı",t.discountsCount,"-"]],f=XLSX.utils.aoa_to_sheet(c);XLSX.utils.book_append_sheet(u,f,"Genel Özet & KPI");const m=[["ŞANTİYE BAZLI HARCAMA VE BÜTÇE KULLANIMI","","","",""],["Şantiye Adı","Toplam Harcama (₽)","Payı (%)","Fatura Sayısı","Toplam Bütçe (₽)","Bütçe Kullanımı (%)"]];i.forEach(k=>{m.push([k.jobsiteName,k.spend,`%${k.percentage}`,k.invoiceCount,k.budget>0?k.budget:"Bütçe Tanımsız",k.budget>0?`%${k.budgetUsagePercentage}`:"-"])});const p=XLSX.utils.aoa_to_sheet(m);XLSX.utils.book_append_sheet(u,p,"Şantiye Dağılımı");const h=[["KATEGORİ BAZLI SATINALMA DAĞILIMI","",""],["Kategori Adı","Toplam Harcama (₽)","Harcama Payı (%)","Kalem Sayısı"]];r.forEach(k=>{h.push([k.category,k.spend,`%${k.percentage}`,k.itemCount])});const v=XLSX.utils.aoa_to_sheet(h);XLSX.utils.book_append_sheet(u,v,"Kategori Dağılımı");const N=[["SATINALMA ŞEFLERİ İNDİRİM VE PERFORMANS TABLOSU","","","",""],["Şef Adı","Kazanılan Toplam İndirim (₽)","Yapılan Satınalma (₽)","Ortalama İndirim Oranı (%)","İşlem Sayısı"]];n.forEach(k=>{N.push([k.supervisorName,k.totalDiscount,k.totalSpend,`%${k.avgDiscountPercentage}`,k.transactionCount])});const y=XLSX.utils.aoa_to_sheet(N);XLSX.utils.book_append_sheet(u,y,"Şef Performansı");const b=[["SON SATINALMA VE İNDİRİM İŞLEMLERİ (DETAYLI LİSTE)","","","","","","","","","","","",""],["Tarih","İşlem Türü","Fatura / Belge No","Tedarikçi Firma","Kategori","Malzeme / Kalem","Şantiye","Yetkili Şef / Personel","İlk Teklif / Liste Fiyatı (₽)","Nihai / Fatura Tutarı (₽)","Kazanılan İndirim (₽)","İndirim Oranı (%)","Gol / Asist","Durum"]];o.forEach(k=>{b.push([k.date,k.type==="INVOICE"?"Fatura":"İndirim Girişi",k.invoiceNumber||k.title,k.supplier,k.category||"-",k.materialSummary||"-",k.jobsiteName,k.performedByPersonnelName?`${k.supervisorName} (${k.performedByPersonnelName})`:k.supervisorName,k.initialPrice||k.amount+(k.discountAmount||0),k.amount,k.discountAmount||0,`%${(k.discountPercentage||0).toFixed(2)}`,k.recordOriginType?k.recordOriginType==="gol"?"Gol":"Asist":"-",k.status])});const S=XLSX.utils.aoa_to_sheet(b);XLSX.utils.book_append_sheet(u,S,"Son İşlemler");const T=`GESCONS_Dashboard_Raporu_${new Date().toISOString().split("T")[0]}.xlsx`;XLSX.writeFile(u,T)}
function _I(e: any ): any {if(!e)return"ŞF";const t=String(e).trim().split(/\s+/);return t.length===1?t[0].substring(0,2).toUpperCase():(t[0][0]+t[t.length-1][0]).toUpperCase()}
function dc(e: any ,t: any ,a: any ): any {if(a===t)return e>0?100:0;const i=(e-t)/(a-t)*100;return Math.round(Math.max(0,Math.min(100,i)))}
function pI(e: any =[],t: any =[],a: any =[],i: any =[],r: any =mI,n: any ="MVP"): any {if(!t||t.length===0)return[];const o=e.filter(B=>!B.isDeleted&&B.status!=="İncelemede"),u=t.map(B=>{const K=o.filter(ie=>ie.supervisorId===B.id||ie.supervisorName&&ie.supervisorName.toLowerCase()===B.name.toLowerCase()),F=(a||[]).filter(ie=>ie.supervisorId===B.id),ae=new Set(F.map(ie=>ie.id));let ue=0,re=0,Z=0,te=0,fe=0,Q=0,Ae=0,Y=0,j=0;const G=new Set,H=[],W=new Map;F.forEach(ie=>{W.set(ie.id,{count:0,savings:0})}),K.forEach(ie=>{const Me=Number(ie.discountAmount)||0,R=Number(ie.adjustedOfferPrice||ie.offerPrice)||ie.agreedPrice+Me;ue+=Me,re+=R;const We=Array.isArray(ie.negotiationRounds)&&ie.negotiationRounds.length>0?ie.negotiationRounds.length:Number(ie.negotiationCount)||0;Ae+=We,We>0&&(Y+=1),We>1&&(j+=1),ie.isNewVendor&&ie.vendorName&&G.add(ie.vendorName.trim());const Ne=ie.recordOriginType==="asist"||ie.performedByPersonnelId&&ie.performedByPersonnelId!==B.id&&ae.has(ie.performedByPersonnelId);if(Ne){if(fe+=1,Q+=Me,ie.performedByPersonnelId&&W.has(ie.performedByPersonnelId)){const me=W.get(ie.performedByPersonnelId);me.count+=1,me.savings+=Me}}else Z+=1,te+=Me;H.push({id:ie.id,vendorName:ie.vendorName||"Bilinmeyen Tedarikçi",jobsiteName:ie.jobsiteName||"Merkez",category:ie.category||"Genel",discountAmount:Me,discountPercentage:Number(ie.discountPercentage)||0,roundsCount:We,date:ie.orderDate||"",orderOrigin:Ne?"asist":"gol",performedByName:ie.performedByPersonnelName})}),H.sort((ie,Me)=>Me.discountAmount-ie.discountAmount);const le=H.slice(0,5),Se=K.length>0?Number((Ae/K.length).toFixed(2)):0,Ee=re>0?Number((ue/re*100).toFixed(1)):0,se=F.map(ie=>{const Me=W.get(ie.id)||{count:0,savings:0};return{id:ie.id,name:ie.name,title:ie.title||"Satınalma Personeli",assistsCount:Me.count,savingsContributed:Me.savings}}).sort((ie,Me)=>Me.savingsContributed-ie.savingsContributed);return{supervisorId:B.id,supervisorName:B.name,title:B.title||"Satınalma Şefi",initials:_I(B.name),department:B.department||"Satınalma & Tedarik",teamSize:F.length,teamMembers:se,rawMetrics:{totalSavings:ue,totalListPrice:re,savingsRatePct:Ee,directGoalsCount:Z,directGoalsSavings:te,teamAssistsCount:fe,teamAssistsSavings:Q,totalNegotiationRounds:Ae,negotiatedDealsCount:Y,avgNegotiationRounds:Se,multiRoundDealsCount:j,newVendorsCount:G.size,newVendorNames:Array.from(G),totalTransactions:K.length},flagshipDeals:le}}),c=u.map(B=>B.rawMetrics.totalSavings),f=u.map(B=>B.rawMetrics.directGoalsCount),m=u.map(B=>B.rawMetrics.totalNegotiationRounds),p=u.map(B=>B.rawMetrics.teamAssistsCount),h=u.map(B=>B.rawMetrics.newVendorsCount),v=Math.min(...c,0),N=Math.max(...c,0),y=Math.min(...f,0),b=Math.max(...f,0),S=Math.min(...m,0),T=Math.max(...m,0),k=Math.min(...p,0),w=Math.max(...p,0),M=Math.min(...h,0),D=Math.max(...h,0),L=[...u.map(B=>{const K=dc(B.rawMetrics.totalSavings,v,N),F=dc(B.rawMetrics.directGoalsCount,y,b),ae=dc(B.rawMetrics.totalNegotiationRounds,S,T),ue=dc(B.rawMetrics.teamAssistsCount,k,w),re=dc(B.rawMetrics.newVendorsCount,M,D),Z=r.financialSavings*K+r.individualGoals*F+r.negotiationRounds*ae+r.teamAssists*ue+r.networkExpansion*re,te=Number(Z.toFixed(1));let fe=te,Q=`${te} MVP`;switch(n){case"MVP":{fe=te,Q=`${((K+F+ae+ue+re)/5).toFixed(1)} Ortalama`;break}case"GOL":fe=B.rawMetrics.directGoalsCount,Q=`${B.rawMetrics.directGoalsCount} İşlem`;break;case"ASIST":fe=B.rawMetrics.teamAssistsCount,Q=`${B.rawMetrics.teamAssistsCount} Asist`;break;case"NEGOTIATION_ROUNDS":fe=B.rawMetrics.totalNegotiationRounds,Q=B.rawMetrics.totalNegotiationRounds>0?`${B.rawMetrics.totalNegotiationRounds} Tur`:"0 Tur";break;case"NETWORK_EXPANSION":fe=B.rawMetrics.newVendorsCount,Q=`${B.rawMetrics.newVendorsCount} Firma`;break;case"FINANCIAL_SAVINGS":fe=B.rawMetrics.totalSavings,Q=ua(B.rawMetrics.totalSavings);break}return{...B,normalizedScores:{financialScore:K,goalsScore:F,roundsScore:ae,assistsScore:ue,networkScore:re},mvpScore:te,mvpRank:1,categoryRank:1,categoryScore:fe,categoryDisplayValue:Q}})].sort((B,K)=>K.mvpScore-B.mvpScore);L.forEach((B,K)=>{B.mvpRank=K+1});const C=[...L].sort((B,K)=>K.categoryScore!==B.categoryScore?K.categoryScore-B.categoryScore:K.rawMetrics.totalSavings-B.rawMetrics.totalSavings);return C.forEach((B,K)=>{B.categoryRank=K+1}),C}
