import assert from 'node:assert/strict';
import {
  getNormalizedProcurementItems,
  getCategorySpendingSummary,
  getSpecialMaterialAnalyticsData,
  verifyProcurementDataIntegrity,
  isValidProcurementInvoice,
  SPECIAL_CATEGORY_MAP,
  getDashboardSpendItems,
  resolveSpendJobsite,
  sumSpend,
  UNASSIGNED_JOBSITE_ID
} from './procurementAnalyticsCore';
import { calculateKPIStats, getJobsiteSpendingDistribution, getMonthlySpendingTrend, getCategorySpendingDistribution } from './dashboardStats';
import { InvoiceRecord } from '../types';

console.log('=== RUNNING PROCUREMENT ANALYTICS CORE INTEGRITY TESTS ===');

// Mock test dataset
const mockInvoices: InvoiceRecord[] = [
  {
    id: 'inv_1',
    invoiceNumber: 'INV-2026-001',
    date: '2026-03-01',
    supplier: 'Severstal',
    jobsiteId: 'site_1',
    jobsiteName: 'Riva Konutları',
    uploadedBySupervisorId: 'sup_1',
    uploadedBySupervisorName: 'Nuri Buğa',
    category: 'İnşaat Demiri & Çelik',
    totalAmount: 10_000_000,
    items: [
      {
        id: 'it_1',
        materialName: 'A500C İnşaat Demiri Ø12 (11.7m GOST 34028)',
        originalName: 'Арматура А500С ф12 мм',
        quantity: 100,
        unit: 'ton',
        unitPrice: 60_000,
        totalPrice: 6_000_000,
        category: 'İnşaat Demiri'
      },
      {
        id: 'it_2',
        materialName: 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)',
        originalName: 'Арматура А500С ф16 мм',
        quantity: 50,
        unit: 'ton',
        unitPrice: 60_000,
        totalPrice: 3_000_000,
        category: 'İnşaat Demiri'
      },
      {
        id: 'it_3',
        materialName: 'Köşebent Demir 50x50x5 (6m)',
        originalName: 'Уголок 50х50х5',
        quantity: 20,
        unit: 'ton',
        unitPrice: 50_000,
        totalPrice: 1_000_000,
        category: 'Çelik Malzemeler'
      }
    ]
  },
  {
    id: 'inv_2',
    invoiceNumber: 'INV-2026-002',
    date: '2026-03-05',
    supplier: 'Bonolit Blok',
    jobsiteId: 'site_2',
    jobsiteName: 'Merkez Şantiye',
    uploadedBySupervisorId: 'sup_2',
    uploadedBySupervisorName: 'Muhammed Hancı',
    category: 'Tuğla, Gazbeton & Duvar Blokları',
    totalAmount: 2_500_000,
    items: [
      {
        id: 'it_4',
        materialName: 'Bonolit D500 Gazbeton Blok 600x250x200',
        originalName: 'Блок газобетонный D500',
        quantity: 500,
        unit: 'm³',
        unitPrice: 5_000,
        totalPrice: 2_500_000,
        category: 'Tuğla, Gazbeton & Duvar Blokları'
      }
    ]
  },
  {
    id: 'inv_3_deleted',
    invoiceNumber: 'INV-DEL-999',
    date: '2026-03-10',
    supplier: 'Deleted Supplier',
    isDeleted: true,
    totalAmount: 50_000_000,
    items: [
      {
        id: 'it_del',
        materialName: 'A500C İnşaat Demiri Ø20',
        quantity: 500,
        unit: 'ton',
        unitPrice: 60_000,
        totalPrice: 30_000_000,
        category: 'İnşaat Demiri'
      }
    ]
  }
];

// Test 1: Deleted invoices are completely ignored
const validItems = getNormalizedProcurementItems(mockInvoices);
assert.equal(validItems.length, 4, 'Deleted invoice items must NOT be included');
console.log('✓ Test 1 Passed: Deleted invoices strictly filtered');

// Test 2: Category Summary vs Special Material Spend Equality
const summary = getCategorySpendingSummary(mockInvoices);
const rebarSpecial = getSpecialMaterialAnalyticsData(mockInvoices, 'DEMIR');
const celikSpecial = getSpecialMaterialAnalyticsData(mockInvoices, 'CELIK');
const gazblokSpecial = getSpecialMaterialAnalyticsData(mockInvoices, 'GAZBLOK');

const rebarSummarySpend = summary.categoryMap.get('İnşaat Demiri')?.spend || 0;
assert.equal(rebarSummarySpend, 9_000_000, 'İnşaat demiri summary spend must be 9,000,000');
assert.equal(rebarSpecial.totalSpend, 9_000_000, 'Special material spend must be exactly 9,000,000');
assert.equal(rebarSummarySpend, rebarSpecial.totalSpend, 'Dashboard Rebar Spend === Special Analytics Rebar Spend');
console.log('✓ Test 2 Passed: Dashboard Demir === Special Analytics Demir (Kuruşu kuruşuna)');

// Test 3: Subtype sum strictly equals category total
const rebarSubtypesSum = rebarSpecial.subTypeBreakdown.reduce((acc, s) => acc + s.spend, 0);
assert.equal(rebarSubtypesSum, rebarSpecial.totalSpend, 'Subtype spend breakdown must strictly equal category total spend');
console.log('✓ Test 3 Passed: Rebar Subtype Breakdown Sum === Category Total');

// Test 4: Other Special Categories Equality
assert.equal(summary.categoryMap.get('Çelik Malzemeler')?.spend, celikSpecial.totalSpend);
assert.equal(summary.categoryMap.get('Tuğla, Gazbeton & Duvar Blokları')?.spend, gazblokSpecial.totalSpend);
console.log('✓ Test 4 Passed: Çelik and Gazbeton cross-screen equality verified');

// Test 5: verifyProcurementDataIntegrity Helper
const integrity = verifyProcurementDataIntegrity(mockInvoices);
assert.equal(integrity.isValid, true, 'Integrity check must return isValid = true');
assert.equal(integrity.discrepancies.length, 0, 'There must be zero discrepancies');
console.log('✓ Test 5 Passed: verifyProcurementDataIntegrity succeeded with zero discrepancies');

// Test 6: Genel Bakış panelleri tek defterden — net kalemler KDV dahil fatura toplamına ölçeklenir
const ledgerInvoices: InvoiceRecord[] = [
  {
    id: 'inv_vat_1', invoiceNumber: 'V-1', date: '2026-09-10', supplier: 'Beton OOO', jobsiteId: 'site_1', jobsiteName: 'Riva Konutları',
    totalAmount: 122_000, // KDV dahil
    items: [
      { id: 'v1', materialName: 'Бетон B25 W6 F150', category: 'Hazır Beton', quantity: 10, unit: 'm3', unitPrice: 6_000, totalPrice: 60_000 },
      { id: 'v2', materialName: 'Арматура A500C d12', category: 'İnşaat Demiri', quantity: 1, unit: 'tn', unitPrice: 40_000, totalPrice: 40_000 }
    ]
  } as any,
  {
    id: 'inv_vat_2', invoiceNumber: 'V-2', date: '2026-09-12', supplier: 'Metal OOO', jobsiteName: 'riva konutları',
    totalAmount: 24_400,
    items: [{ id: 'v3', materialName: 'Арматура A500C d16', category: 'İnşaat Demiri', quantity: 1, unit: 'tn', unitPrice: 20_000, totalPrice: 20_000 }]
  } as any,
  { id: 'inv_vat_3', invoiceNumber: 'V-3', date: '2026-09-15', supplier: 'Hırdavat OOO', totalAmount: 5_000, items: [] } as any
];
const ledgerSites = [{ id: 'site_1', name: 'Riva Konutları', budget: 1_000_000 }];
const ledger = getDashboardSpendItems(ledgerInvoices);
assert.equal(sumSpend(ledger), 151_400, 'Defter toplamı = faturaların KDV dahil toplamı');
const kpi6 = calculateKPIStats({ currentInvoices: ledgerInvoices, currentSpendTotal: sumSpend(ledger), previousSpendTotal: 0 });
const sites6 = getJobsiteSpendingDistribution(ledgerInvoices, ledgerSites, 8);
const months6 = getMonthlySpendingTrend(ledgerInvoices.map(i => ({ ...i, date: new Date().toISOString().slice(0, 10) })), [], 12);
const cats6 = getCategorySpendingDistribution(ledgerInvoices, 50);
assert.equal(kpi6.totalSpend, 151_400);
assert.equal(Math.round(sites6.reduce((a: number, r: any) => a + r.spend, 0)), 151_400, 'Şantiye dağılımı toplamı = KPI');
assert.equal(Math.round(months6.reduce((a: number, r: any) => a + r.spend, 0)), 151_400, 'Aylık trend toplamı = KPI');
assert.equal(Math.round(cats6.reduce((a: number, r: any) => a + r.spend, 0)), 151_400, 'Kategori toplamı = KPI');
const riva = sites6.find((r: any) => r.jobsiteId === 'site_1');
assert.equal(Math.round(riva.spend), 146_400, 'İsimle eşleşen fatura aynı şantiyeye yazılır');
assert.equal(riva.invoiceCount, 2);
assert.ok(sites6.some((r: any) => r.jobsiteId === UNASSIGNED_JOBSITE_ID && Math.round(r.spend) === 5_000), 'Şantiyesiz fatura kaybolmaz');
assert.deepEqual(resolveSpendJobsite({ jobsiteName: 'Merkez', rawInvoice: {} }, ledgerSites), { id: UNASSIGNED_JOBSITE_ID, name: 'Şantiye Belirtilmemiş' });
const rebarOnly = getDashboardSpendItems(ledgerInvoices, { selectedCategory: 'İnşaat Demiri' });
assert.equal(Math.round(sumSpend(rebarOnly)), 73_200, 'Kategori filtresinde yalnızca o kategorinin kalemleri sayılır');
console.log('✓ Test 6 Passed: KPI = kategori = şantiye = aylık trend (KDV dahil fatura toplamı)');

console.log('>>> ALL PROCUREMENT ANALYTICS CORE TESTS PASSED SUCCESSFULLY! <<<');
