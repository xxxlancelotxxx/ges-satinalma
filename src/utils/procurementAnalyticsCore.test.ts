import assert from 'node:assert/strict';
import {
  getNormalizedProcurementItems,
  getCategorySpendingSummary,
  getSpecialMaterialAnalyticsData,
  verifyProcurementDataIntegrity,
  isValidProcurementInvoice,
  SPECIAL_CATEGORY_MAP
} from './procurementAnalyticsCore';
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

console.log('>>> ALL PROCUREMENT ANALYTICS CORE TESTS PASSED SUCCESSFULLY! <<<');
