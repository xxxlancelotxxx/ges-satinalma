import assert from 'assert';
import { calculateComparativeSavings } from './comparativeCalculation';
import { ComparativeDocument, CanonicalMaterial } from '../types';

console.log('--- Testing Comparative Offer Analysis - Lowest Initial Offer Baseline ---');

// 1. Setup Documents:
// - Vendor A First Offer: 14,500,000 RUB
// - Vendor B First Offer: 13,800,000 RUB (Lowest Initial Offer Baseline!)
// - Vendor C First Offer: 15,000,000 RUB
// - Vendor B Intermediate Negotiation Round: 13,200,000 RUB
// - Vendor B Final Agreed Invoice: 12,744,990 RUB

const docs: ComparativeDocument[] = [
  {
    id: 'doc_1',
    fileName: 'teklif_vendor_A.pdf',
    fileUrl: '/test_A.pdf',
    supplier: 'Firma A',
    documentRole: 'COMPETITOR_FIRST_OFFER',
    roleConfidence: 1.0,
    totalAmount: 14500000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_2',
    fileName: 'teklif_vendor_B_ilk.pdf',
    fileUrl: '/test_B.pdf',
    supplier: 'Firma B',
    documentRole: 'FIRST_OFFER',
    roleConfidence: 1.0,
    totalAmount: 13800000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_3',
    fileName: 'teklif_vendor_C.pdf',
    fileUrl: '/test_C.pdf',
    supplier: 'Firma C',
    documentRole: 'COMPETITOR_FIRST_OFFER',
    roleConfidence: 1.0,
    totalAmount: 15000000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_4',
    fileName: 'pazarlik_vendor_B.pdf',
    fileUrl: '/test_B_pazarlik.pdf',
    supplier: 'Firma B',
    documentRole: 'DISCOUNT_ROUND_1',
    roleConfidence: 1.0,
    totalAmount: 13200000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_5',
    fileName: 'fatura_vendor_B_final.pdf',
    fileUrl: '/test_B_final.pdf',
    supplier: 'Firma B',
    documentNumber: 'UPD-2026-894',
    date: '2026-03-20',
    documentRole: 'FINAL_INVOICE',
    roleConfidence: 1.0,
    totalAmount: 12744990,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  }
];

const result = calculateComparativeSavings(docs, []);

console.log('Result Winning Supplier:', result.winningSupplier);
console.log('Total Initial Lowest Offer:', result.summary.totalInitialLowestOffer);
console.log('Total Final Purchase:', result.summary.totalFinalPurchase);
console.log('Real Market Savings:', result.summary.realMarketSavings);
console.log('Real Savings Rate (%):', result.summary.realSavingsRate);

// Assertions:
// 1. Winning supplier must strictly be the Final Invoice supplier ('Firma B')
assert.strictEqual(result.winningSupplier, 'Firma B', 'Winning supplier should be Firma B');

// 2. The baseline initial offer must be the lowest among initial offers (13,800,000 RUB)
assert.strictEqual(result.summary.totalInitialLowestOffer, 13800000, 'Baseline should be 13,800,000 RUB');

// 3. Final purchase amount must be 12,744,990 RUB
assert.strictEqual(result.summary.totalFinalPurchase, 12744990, 'Final purchase should be 12,744,990 RUB');

// 4. Real Market Savings = 13,800,000 - 12,744,990 = 1,055,010 RUB
assert.strictEqual(result.summary.realMarketSavings, 1055010, 'Savings should be 1,055,010 RUB');

// 5. Real Savings Rate = (1,055,010 / 13,800,000) * 100 = 7.65%
assert.strictEqual(result.summary.realSavingsRate, 7.65, 'Rate should be 7.65%');

// 6. Canonical materials fallback row must exist and be fully populated
assert.strictEqual(result.canonicalMaterials.length, 1, 'Should have 1 fallback material row');
assert.strictEqual(result.canonicalMaterials[0].purchasedSupplier, 'Firma B');
assert.strictEqual(result.canonicalMaterials[0].marketReferenceSupplier, 'Firma B');
assert.strictEqual(result.canonicalMaterials[0].realTotalSavings, 1055010);

console.log('All Comparative Offer Analysis assertions PASSED successfully!');
