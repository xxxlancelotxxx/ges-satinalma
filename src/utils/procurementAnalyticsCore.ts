/**
 * ============================================================================
 * SINGLE SOURCE OF TRUTH (SSOT) PROCUREMENT & SPENDING ANALYTICS ENGINE
 * GES CONSTRUCTION PROCUREMENT PLATFORM
 * ============================================================================
 * Centralized, deterministic calculation engine for all screens:
 * - Dashboard.tsx (Genel Bakış & Kategori Dağılımı)
 * - SpecialMaterialAnalytics.tsx (Özel Malzeme Analizi - Demir, Çelik, Gazblok, İzolasyon)
 * - MaterialPriceComparison.tsx (Malzeme Fiyat Karşılaştırma & Kategori İstatistikleri)
 * - CategoryAnalyticsModal.tsx & Raporlama modülleri
 *
 * GUARANTEES:
 * 1. Filtering: Permanently and reliably filters deleted/test invoices across all views.
 * 2. Net Realized Spend: Calculates item and invoice totals kuruşu kuruşuna identically.
 * 3. Canonical 28 Categories: Every single item maps to one of the 28 Canonical Categories.
 * 4. Special Material Subtypes: Sum of sub-types strictly equals the category total.
 * 5. Full Reactive Synchronization: All screens produce identical spending numbers.
 * ============================================================================
 */

import { InvoiceRecord, InvoiceItem } from '../types';
import { normalizeCategoryName, CANONICAL_28_CATEGORIES } from './categoryClassifier';
import { normalizeUnit } from './comparativeCalculation';
import { areVendorsEqual } from './vendorNormalizer';

export type SpecialCategoryKey = 'DEMIR' | 'CELIK' | 'GAZBLOK' | 'IZOLASYON';

export interface NormalizedProcurementItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  jobsiteId: string;
  jobsiteName: string;
  supplier: string;
  supervisorId: string;
  supervisorName: string;
  category: string;
  canonicalCategory: string;
  materialName: string;
  originalName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  fileUrl?: string;
  subType?: string;
  specialCategoryKey?: SpecialCategoryKey;
  rawInvoice: InvoiceRecord;
  rawItem?: InvoiceItem;
}

export interface ProcurementFilterOptions {
  dateRange?: string;
  customStartDate?: string;
  customEndDate?: string;
  selectedJobsiteId?: string;
  selectedJobsite?: string;
  selectedVendor?: string;
  selectedSupervisorId?: string;
  selectedSupervisor?: string;
  selectedCategory?: string;
  searchTerm?: string;
  invoiceNoFilter?: string;
}

export interface CategorySpendingData {
  category: string;
  spend: number;
  percentage: number;
  itemCount: number;
  invoiceCount: number;
  items: NormalizedProcurementItem[];
}

export interface SpecialMaterialSummary {
  categoryKey: SpecialCategoryKey;
  categoryLabel: string;
  totalSpend: number;
  itemCount: number;
  invoiceCount: number;
  items: NormalizedProcurementItem[];
  subTypeBreakdown: Array<{
    subType: string;
    spend: number;
    quantity: number;
    unit: string;
    percentage: number;
    itemCount: number;
  }>;
  jobsiteBreakdown: Array<{
    jobsiteId: string;
    jobsiteName: string;
    spend: number;
    percentage: number;
    itemCount: number;
  }>;
  vendorBreakdown: Array<{
    vendorName: string;
    spend: number;
    percentage: number;
    itemCount: number;
  }>;
  monthlyTrend: Array<{
    monthKey: string;
    monthLabel: string;
    spend: number;
    itemCount: number;
  }>;
}

// Special material to canonical category mapping
export const SPECIAL_CATEGORY_MAP: Record<SpecialCategoryKey, { canonicalCategory: string; label: string }> = {
  DEMIR: { canonicalCategory: 'İnşaat Demiri', label: 'İnşaat Demiri' },
  CELIK: { canonicalCategory: 'Çelik Malzemeler', label: 'Çelik Malzemeler' },
  GAZBLOK: { canonicalCategory: 'Tuğla, Gazbeton & Duvar Blokları', label: 'Gazbeton & Duvar Bloğu' },
  IZOLASYON: { canonicalCategory: 'Yalıtım & Alçıpan', label: 'İzolasyon & Yalıtım' }
};

/**
 * Returns true if the invoice is an auto-synced Prizma ERP reference record
 * rather than an invoice entered through GES platform modules (Yeni Satınalma İndirim Girişi,
 * Karşılaştırmalı Teklif Analizi TDF, AI Otomatik Fatura / Çek Okuma & Muhasebeleştirme).
 */
export function isPrizmaAutoSyncedInvoice(inv?: InvoiceRecord | any): boolean {
  if (!inv) return false;
  const id = String(inv.id || '').trim();
  if (id.startsWith('inv_prizma_') || id.startsWith('prizma_')) return true;
  if (
    inv.prizmaSource === true &&
    !id.startsWith('inv_sync_') &&
    !id.startsWith('inv_cmp_') &&
    !inv.discountId &&
    (!inv.uploadedBySupervisorId ||
      inv.uploadedBySupervisorName === 'Prizma ERP' ||
      inv.uploadedBySupervisorName === 'automatic.system')
  ) {
    return true;
  }
  return false;
}

/**
 * Validates invoice status (filters out deleted, cancelled, test, and Prizma auto-synced reference invoices)
 */
export function isValidProcurementInvoice(inv?: InvoiceRecord | any): boolean {
  if (!inv) return false;
  if (inv.isDeleted === true || (inv as any).isPermanentlyDeleted === true) return false;
  if (inv.status === 'deleted' || inv.status === 'İptal Edildi' || inv.status === 'Silindi') return false;
  if (inv.test === true) return false;
  if (isPrizmaAutoSyncedInvoice(inv)) return false;
  return true;
}

/**
 * Extracts subType for Special Material Analytics in a fully exhaustive way.
 * Guaranteed that every item in the category gets a subType, so NO items/spend are dropped.
 */
export function extractSpecialMaterialSubType(
  categoryKey: SpecialCategoryKey,
  materialName: string,
  originalName: string = '',
  rawText: string = ''
): string {
  const text = `${materialName} ${originalName} ${rawText}`.toLowerCase();

  switch (categoryKey) {
    case 'DEMIR': {
      if (text.includes('ø8') || text.includes('d 8') || text.includes('d8') || text.includes(' 8 мм') || text.includes('диам. 8') || text.includes('8мм')) {
        return 'Ø8 mm İnşaat Demiri';
      } else if (text.includes('ø10') || text.includes('d 10') || text.includes('d10') || text.includes(' 10 мм') || text.includes('диам. 10') || text.includes('10мм')) {
        return 'Ø10 mm İnşaat Demiri';
      } else if (text.includes('ø12') || text.includes('d 12') || text.includes('d12') || text.includes(' 12 мм') || text.includes('диам. 12') || text.includes('12мм')) {
        return 'Ø12 mm İnşaat Demiri';
      } else if (text.includes('ø14') || text.includes('d 14') || text.includes('d14') || text.includes(' 14 мм') || text.includes('диам. 14') || text.includes('14мм')) {
        return 'Ø14 mm İnşaat Demiri';
      } else if (text.includes('ø16') || text.includes('d 16') || text.includes('d16') || text.includes(' 16 мм') || text.includes('диам. 16') || text.includes('16мм')) {
        return 'Ø16 mm İnşaat Demiri';
      } else if (text.includes('ø18') || text.includes('d 18') || text.includes('d18') || text.includes(' 18 мм') || text.includes('диам. 18') || text.includes('18мм')) {
        return 'Ø18 mm İnşaat Demiri';
      } else if (text.includes('ø20') || text.includes('d 20') || text.includes('d20') || text.includes(' 20 мм') || text.includes('диам. 20') || text.includes('20мм')) {
        return 'Ø20 mm İnşaat Demiri';
      } else if (text.includes('ø22') || text.includes('d 22') || text.includes('d22') || text.includes(' 22 мм') || text.includes('диам. 22') || text.includes('22мм')) {
        return 'Ø22 mm İnşaat Demiri';
      } else if (text.includes('ø25') || text.includes('d 25') || text.includes('d25') || text.includes(' 25 мм') || text.includes('диам. 25') || text.includes('25мм')) {
        return 'Ø25 mm İnşaat Demiri';
      } else if (text.includes('ø28') || text.includes('d 28') || text.includes('d28') || text.includes(' 28 мм') || text.includes('диам. 28') || text.includes('28мм')) {
        return 'Ø28 mm İnşaat Demiri';
      } else if (text.includes('ø32') || text.includes('d 32') || text.includes('d32') || text.includes(' 32 мм') || text.includes('диам. 32') || text.includes('32мм')) {
        return 'Ø32 mm İnşaat Demiri';
      } else if (text.includes('ø36') || text.includes('d 36') || text.includes('d36') || text.includes(' 36 мм') || text.includes('диам. 36') || text.includes('36мм')) {
        return 'Ø36 mm İnşaat Demiri';
      } else if (text.includes('ø40') || text.includes('d 40') || text.includes('d40') || text.includes(' 40 мм') || text.includes('диам. 40') || text.includes('40мм')) {
        return 'Ø40 mm İnşaat Demiri';
      }
      return 'Standart A500C İnşaat Demiri';
    }

    case 'CELIK': {
      if (text.includes('угол') || text.includes('köşebent') || text.includes('kosebent')) {
        return 'Köşebent Profil';
      } else if (text.includes('труб') || text.includes('boru') || text.includes('profil') || text.includes('kutu')) {
        return 'Kutu Profil & Boru';
      } else if (text.includes('лист') || text.includes('sac') || text.includes('levha')) {
        return 'Çelik Sac & Levha';
      } else if (text.includes('швеллер') || text.includes('şveller') || text.includes('sveller') || text.includes('двутавр') || text.includes('ipe') || text.includes('hea')) {
        return 'Şveller & Profil';
      } else if (text.includes('сетка') || text.includes('hasır') || text.includes('hasir')) {
        return 'Çelik Hasır';
      }
      return 'Genel Çelik Malzemeleri';
    }

    case 'GAZBLOK': {
      if (text.includes('d500') || text.includes('д500')) {
        return 'Gazbeton D500 Blok';
      } else if (text.includes('d600') || text.includes('д600')) {
        return 'Gazbeton D600 Blok';
      } else if (text.includes('d400') || text.includes('д400')) {
        return 'Gazbeton D400 Blok';
      } else if (text.includes('перемычк') || text.includes('lento') || text.includes('lentolar')) {
        return 'Lento Elemanları';
      } else if (text.includes('кбб') || text.includes('kbb') || text.includes('beton blok') || text.includes('бетонный блок')) {
        return 'KBB Beton Blok';
      } else if (text.includes('клей') || text.includes('yapıştırıcı') || text.includes('harç') || text.includes('harc')) {
        return 'Gazbeton Yapıştırıcı & Harç';
      }
      return 'Tuğla & Diğer Duvar Blokları';
    }

    case 'IZOLASYON': {
      if (text.includes('пеноплэкс') || text.includes('penoplex') || text.includes('xps') || text.includes('пенопласт') || text.includes('strafor')) {
        return 'XPS & Strafor Levha';
      } else if (text.includes('мембран') || text.includes('техноэласт') || text.includes('унифлекс') || text.includes('icopal') || text.includes('membran') || text.includes('su yalıtım')) {
        return 'Su Yalıtım Membranı';
      } else if (text.includes('минвата') || text.includes('каменная вата') || text.includes('rockwool') || text.includes('техноруф') || text.includes('taşyünü') || text.includes('tasyunu') || text.includes('cam yünü')) {
        return 'Taşyünü & Cam Yünü';
      } else if (text.includes('гипсокартон') || text.includes('гкл') || text.includes('alçıpan') || text.includes('alcipan') || text.includes('кнауф') || text.includes('knauf')) {
        return 'Alçıpan & Profil';
      } else if (text.includes('пароизоляц') || text.includes('изоспан') || text.includes('geotextile') || text.includes('геотекстиль') || text.includes('buhar bariyeri')) {
        return 'Buhar & Nem Bariyeri';
      }
      return 'Genel Yalıtım & İzolasyon';
    }

    default:
      return 'Genel Malzeme';
  }
}

/**
 * Extracts and normalizes all line items from invoices.
 * Single source of truth for item parsing.
 */
export function getNormalizedProcurementItems(invoices: InvoiceRecord[] = []): NormalizedProcurementItem[] {
  const result: NormalizedProcurementItem[] = [];

  invoices.forEach((inv, invIndex) => {
    if (!isValidProcurementInvoice(inv)) return;

    const invItems = Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : [];
    const invId = inv.id || `inv_${invIndex}`;
    const invNumber = inv.invoiceNumber || inv.invoiceNo || 'No Belirtilmedi';
    const invDate = inv.date || (inv.created_at ? inv.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
    const jobsiteId = inv.jobsiteId || '';
    const jobsiteName = inv.jobsiteName || 'Merkez';
    const supplier = inv.supplier || inv.vendorName || 'Bilinmeyen Tedarikçi';
    const supervisorId = inv.uploadedBySupervisorId || inv.supervisorId || '';
    const supervisorName = inv.uploadedBySupervisorName || inv.supervisorName || 'Satınalma Şefi';
    const fileUrl = inv.fileUrl || inv.rawFileName;

    if (invItems.length > 0) {
      invItems.forEach((it, itIndex) => {
        const rawName = it.materialName || it.originalName || 'Malzeme Kalemi';
        const rawOrig = it.originalName || it.materialName || '';
        const rawCat = it.category || inv.category;
        const canonCat = normalizeCategoryName(rawCat, `${rawName} ${rawOrig} ${supplier}`);
        const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
        const uPrice = Number(it.unitPrice) || 0;
        const totPrice = Number(it.totalPrice) > 0 ? Number(it.totalPrice) : uPrice * qty;
        const normUnit = normalizeUnit(it.unit || 'adet');

        // Determine special category key if any
        let specKey: SpecialCategoryKey | undefined = undefined;
        if (canonCat === 'İnşaat Demiri') specKey = 'DEMIR';
        else if (canonCat === 'Çelik Malzemeler') specKey = 'CELIK';
        else if (canonCat === 'Tuğla, Gazbeton & Duvar Blokları') specKey = 'GAZBLOK';
        else if (canonCat === 'Yalıtım & Alçıpan') specKey = 'IZOLASYON';

        const subType = specKey ? extractSpecialMaterialSubType(specKey, rawName, rawOrig, `${canonCat} ${supplier}`) : undefined;

        result.push({
          id: it.id || `${invId}_item_${itIndex}`,
          invoiceId: invId,
          invoiceNumber: invNumber,
          date: invDate,
          jobsiteId,
          jobsiteName,
          supplier,
          supervisorId,
          supervisorName,
          category: canonCat,
          canonicalCategory: canonCat,
          materialName: rawName,
          originalName: rawOrig,
          quantity: qty,
          unit: normUnit,
          unitPrice: uPrice,
          totalPrice: totPrice,
          fileUrl,
          subType,
          specialCategoryKey: specKey,
          rawInvoice: inv,
          rawItem: it
        });
      });
    } else {
      // Legacy invoice without item breakdown
      const rawCat = inv.category;
      const canonCat = normalizeCategoryName(rawCat, supplier);
      const totPrice = Number(inv.totalAmount) || 0;

      let specKey: SpecialCategoryKey | undefined = undefined;
      if (canonCat === 'İnşaat Demiri') specKey = 'DEMIR';
      else if (canonCat === 'Çelik Malzemeler') specKey = 'CELIK';
      else if (canonCat === 'Tuğla, Gazbeton & Duvar Blokları') specKey = 'GAZBLOK';
      else if (canonCat === 'Yalıtım & Alçıpan') specKey = 'IZOLASYON';

      const subType = specKey ? extractSpecialMaterialSubType(specKey, supplier, '', canonCat) : undefined;

      result.push({
        id: `${invId}_item_0`,
        invoiceId: invId,
        invoiceNumber: invNumber,
        date: invDate,
        jobsiteId,
        jobsiteName,
        supplier,
        supervisorId,
        supervisorName,
        category: canonCat,
        canonicalCategory: canonCat,
        materialName: `${supplier} Faturası`,
        originalName: supplier,
        quantity: 1,
        unit: 'adet',
        unitPrice: totPrice,
        totalPrice: totPrice,
        fileUrl,
        subType,
        specialCategoryKey: specKey,
        rawInvoice: inv
      });
    }
  });

  return result;
}

/**
 * Universal item filter function supporting all UI filters
 */
export function filterNormalizedProcurementItems(
  items: NormalizedProcurementItem[] = [],
  options?: ProcurementFilterOptions
): NormalizedProcurementItem[] {
  if (!options) return items;

  return items.filter(item => {
    // 1. Jobsite Filter
    const jId = options.selectedJobsiteId || options.selectedJobsite;
    if (jId && jId !== 'ALL' && item.jobsiteId !== jId && item.jobsiteName !== jId) {
      return false;
    }

    // 2. Vendor / Supplier Filter
    const vName = options.selectedVendor;
    if (vName && vName !== 'ALL' && !areVendorsEqual(item.supplier, vName)) {
      return false;
    }

    // 3. Supervisor Filter
    const sId = options.selectedSupervisorId || options.selectedSupervisor;
    if (sId && sId !== 'ALL' && item.supervisorId !== sId && item.supervisorName !== sId) {
      return false;
    }

    // 4. Category Filter
    if (options.selectedCategory && options.selectedCategory !== 'ALL') {
      const targetCat = normalizeCategoryName(options.selectedCategory);
      if (item.canonicalCategory !== targetCat && item.category !== targetCat) {
        return false;
      }
    }

    // 5. Invoice Number Filter
    if (options.invoiceNoFilter && options.invoiceNoFilter.trim() !== '') {
      const q = options.invoiceNoFilter.toLowerCase().trim();
      if (!item.invoiceNumber.toLowerCase().includes(q)) {
        return false;
      }
    }

    // 6. Search Term Filter
    if (options.searchTerm && options.searchTerm.trim() !== '') {
      const q = options.searchTerm.toLowerCase().trim();
      const match =
        item.materialName.toLowerCase().includes(q) ||
        item.originalName.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q) ||
        item.invoiceNumber.toLowerCase().includes(q) ||
        item.jobsiteName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.subType && item.subType.toLowerCase().includes(q));
      if (!match) return false;
    }

    // 7. Date Range Filter
    if (options.customStartDate || options.customEndDate) {
      if (item.date) {
        if (options.customStartDate && item.date < options.customStartDate) return false;
        if (options.customEndDate && item.date > options.customEndDate) return false;
      }
    }

    return true;
  });
}

/**
 * CENTRAL SPENDING MAP & SUMMARY GENERATOR
 * Returns unified category spending kuruşu kuruşuna across all 28 Canonical Categories.
 */
export function getCategorySpendingSummary(
  invoices: InvoiceRecord[] = [],
  options?: ProcurementFilterOptions
): {
  categoryMap: Map<string, CategorySpendingData>;
  categoriesList: CategorySpendingData[];
  totalSpend: number;
  totalItems: number;
} {
  const allItems = getNormalizedProcurementItems(invoices);
  const filteredItems = filterNormalizedProcurementItems(allItems, options);

  const categoryMap = new Map<string, CategorySpendingData>();
  let totalSpend = 0;

  // Initialize map with all canonical categories (preserving sort order)
  CANONICAL_28_CATEGORIES.forEach(cat => {
    categoryMap.set(cat, {
      category: cat,
      spend: 0,
      percentage: 0,
      itemCount: 0,
      invoiceCount: 0,
      items: []
    });
  });

  const invoiceIdSets = new Map<string, Set<string>>();

  filteredItems.forEach(item => {
    totalSpend += item.totalPrice;
    const cat = item.canonicalCategory;

    let data = categoryMap.get(cat);
    if (!data) {
      data = {
        category: cat,
        spend: 0,
        percentage: 0,
        itemCount: 0,
        invoiceCount: 0,
        items: []
      };
      categoryMap.set(cat, data);
    }

    data.spend += item.totalPrice;
    data.itemCount += 1;
    data.items.push(item);

    let idSet = invoiceIdSets.get(cat);
    if (!idSet) {
      idSet = new Set<string>();
      invoiceIdSets.set(cat, idSet);
    }
    idSet.add(item.invoiceId);
  });

  // Calculate percentages and invoice counts
  const categoriesList: CategorySpendingData[] = Array.from(categoryMap.values())
    .map(data => {
      const invSet = invoiceIdSets.get(data.category);
      const invCount = invSet ? invSet.size : 0;
      const pct = totalSpend > 0 ? Number(((data.spend / totalSpend) * 100).toFixed(2)) : 0;
      return {
        ...data,
        percentage: pct,
        invoiceCount: invCount
      };
    })
    .sort((a, b) => (b.spend !== a.spend ? b.spend - a.spend : a.category.localeCompare(b.category, 'tr')));

  return {
    categoryMap,
    categoriesList,
    totalSpend,
    totalItems: filteredItems.length
  };
}

/**
 * SPECIAL MATERIAL ANALYTICS CORE FUNCTION
 * Provides the exact data for SpecialMaterialAnalytics.tsx.
 * Guaranteed that categoryTotalSpend === Dashboard category spend.
 */
export function getSpecialMaterialAnalyticsData(
  invoices: InvoiceRecord[] = [],
  categoryKey: SpecialCategoryKey = 'DEMIR',
  options?: ProcurementFilterOptions
): SpecialMaterialSummary {
  const targetCategoryInfo = SPECIAL_CATEGORY_MAP[categoryKey];
  const targetCanonicalCat = targetCategoryInfo.canonicalCategory;

  const allItems = getNormalizedProcurementItems(invoices);
  const filteredItems = filterNormalizedProcurementItems(allItems, options);

  // Filter items matching this special category
  const categoryItems = filteredItems.filter(it => it.canonicalCategory === targetCanonicalCat);

  const categoryTotalSpend = categoryItems.reduce((acc, it) => acc + it.totalPrice, 0);
  const invoiceIds = new Set(categoryItems.map(it => it.invoiceId));

  // 1. SubType Breakdown (Sum of spend === categoryTotalSpend)
  const subTypeMap = new Map<string, { spend: number; quantity: number; unit: string; count: number }>();
  categoryItems.forEach(it => {
    const sub = it.subType || extractSpecialMaterialSubType(categoryKey, it.materialName, it.originalName, it.category);
    const curr = subTypeMap.get(sub) || { spend: 0, quantity: 0, unit: it.unit, count: 0 };
    curr.spend += it.totalPrice;
    curr.quantity += it.quantity;
    curr.count += 1;
    subTypeMap.set(sub, curr);
  });

  const subTypeBreakdown = Array.from(subTypeMap.entries())
    .map(([sub, data]) => ({
      subType: sub,
      spend: data.spend,
      quantity: data.quantity,
      unit: data.unit,
      percentage: categoryTotalSpend > 0 ? Number(((data.spend / categoryTotalSpend) * 100).toFixed(2)) : 0,
      itemCount: data.count
    }))
    .sort((a, b) => b.spend - a.spend);

  // 2. Jobsite Breakdown (Sum of spend === categoryTotalSpend)
  const jobsiteMap = new Map<string, { name: string; spend: number; count: number }>();
  categoryItems.forEach(it => {
    const jId = it.jobsiteId || 'merkez';
    const curr = jobsiteMap.get(jId) || { name: it.jobsiteName || 'Merkez', spend: 0, count: 0 };
    curr.spend += it.totalPrice;
    curr.count += 1;
    jobsiteMap.set(jId, curr);
  });

  const jobsiteBreakdown = Array.from(jobsiteMap.entries())
    .map(([jId, data]) => ({
      jobsiteId: jId,
      jobsiteName: data.name,
      spend: data.spend,
      percentage: categoryTotalSpend > 0 ? Number(((data.spend / categoryTotalSpend) * 100).toFixed(2)) : 0,
      itemCount: data.count
    }))
    .sort((a, b) => b.spend - a.spend);

  // 3. Vendor Breakdown (Sum of spend === categoryTotalSpend)
  const vendorMap = new Map<string, { spend: number; count: number }>();
  categoryItems.forEach(it => {
    const vName = it.supplier || 'Bilinmeyen Tedarikçi';
    const curr = vendorMap.get(vName) || { spend: 0, count: 0 };
    curr.spend += it.totalPrice;
    curr.count += 1;
    vendorMap.set(vName, curr);
  });

  const vendorBreakdown = Array.from(vendorMap.entries())
    .map(([vName, data]) => ({
      vendorName: vName,
      spend: data.spend,
      percentage: categoryTotalSpend > 0 ? Number(((data.spend / categoryTotalSpend) * 100).toFixed(2)) : 0,
      itemCount: data.count
    }))
    .sort((a, b) => b.spend - a.spend);

  // 4. Monthly Trend
  const monthlyMap = new Map<string, { label: string; spend: number; count: number }>();
  categoryItems.forEach(it => {
    const monthKey = it.date ? it.date.substring(0, 7) : 'Bilinmeyen';
    const curr = monthlyMap.get(monthKey) || { label: monthKey, spend: 0, count: 0 };
    curr.spend += it.totalPrice;
    curr.count += 1;
    monthlyMap.set(monthKey, curr);
  });

  const monthlyTrend = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mKey, data]) => ({
      monthKey: mKey,
      monthLabel: data.label,
      spend: data.spend,
      itemCount: data.count
    }));

  return {
    categoryKey,
    categoryLabel: targetCategoryInfo.label,
    totalSpend: categoryTotalSpend,
    itemCount: categoryItems.length,
    invoiceCount: invoiceIds.size,
    items: categoryItems,
    subTypeBreakdown,
    jobsiteBreakdown,
    vendorBreakdown,
    monthlyTrend
  };
}

/**
 * INTEGRITY VERIFIER FOR PRODUCTION & TESTS
 * Asserts cross-screen equality and logs validation results.
 */
export function verifyProcurementDataIntegrity(invoices: InvoiceRecord[] = []): {
  isValid: boolean;
  totalNetSpend: number;
  totalItems: number;
  rebarSpendDashboard: number;
  rebarSpendSpecial: number;
  rebarSubtypesSpendSum: number;
  discrepancies: string[];
} {
  const summary = getCategorySpendingSummary(invoices);
  const rebarSpecial = getSpecialMaterialAnalyticsData(invoices, 'DEMIR');
  const celikSpecial = getSpecialMaterialAnalyticsData(invoices, 'CELIK');
  const gazblokSpecial = getSpecialMaterialAnalyticsData(invoices, 'GAZBLOK');
  const izolasyonSpecial = getSpecialMaterialAnalyticsData(invoices, 'IZOLASYON');

  const rebarDash = summary.categoryMap.get('İnşaat Demiri')?.spend || 0;
  const rebarSpec = rebarSpecial.totalSpend;
  const rebarSubtypesSum = rebarSpecial.subTypeBreakdown.reduce((acc, s) => acc + s.spend, 0);

  const celikDash = summary.categoryMap.get('Çelik Malzemeler')?.spend || 0;
  const celikSpec = celikSpecial.totalSpend;

  const gazblokDash = summary.categoryMap.get('Tuğla, Gazbeton & Duvar Blokları')?.spend || 0;
  const gazblokSpec = gazblokSpecial.totalSpend;

  const izolasyonDash = summary.categoryMap.get('Yalıtım & Alçıpan')?.spend || 0;
  const izolasyonSpec = izolasyonSpecial.totalSpend;

  const discrepancies: string[] = [];

  const EPSILON = 0.01;
  if (Math.abs(rebarDash - rebarSpec) > EPSILON) {
    discrepancies.push(`İnşaat Demiri Uyuşmazlığı: Dashboard (${rebarDash}) !== Özel Analiz (${rebarSpec})`);
  }
  if (Math.abs(rebarSpec - rebarSubtypesSum) > EPSILON) {
    discrepancies.push(`İnşaat Demiri Çap Kırılım Uyuşmazlığı: Özel Analiz (${rebarSpec}) !== Çaplar Toplamı (${rebarSubtypesSum})`);
  }
  if (Math.abs(celikDash - celikSpec) > EPSILON) {
    discrepancies.push(`Çelik Malzemeler Uyuşmazlığı: Dashboard (${celikDash}) !== Özel Analiz (${celikSpec})`);
  }
  if (Math.abs(gazblokDash - gazblokSpec) > EPSILON) {
    discrepancies.push(`Gazbeton Uyuşmazlığı: Dashboard (${gazblokDash}) !== Özel Analiz (${gazblokSpec})`);
  }
  if (Math.abs(izolasyonDash - izolasyonSpec) > EPSILON) {
    discrepancies.push(`İzolasyon Uyuşmazlığı: Dashboard (${izolasyonDash}) !== Özel Analiz (${izolasyonSpec})`);
  }

  const isValid = discrepancies.length === 0;

  console.log(
    `[VERİ DOĞRULAMA] Dashboard Demir: ${rebarDash.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₽ | Özel Analiz Demir: ${rebarSpec.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₽ | Eşit mi?: ${rebarDash === rebarSpec}`
  );

  return {
    isValid,
    totalNetSpend: summary.totalSpend,
    totalItems: summary.totalItems,
    rebarSpendDashboard: rebarDash,
    rebarSpendSpecial: rebarSpec,
    rebarSubtypesSpendSum: rebarSubtypesSum,
    discrepancies
  };
}
