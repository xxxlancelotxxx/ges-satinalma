import assert from 'node:assert';
import {
  calculateComparativeSavings,
  normalizeQuantityAndPrice,
  normalizeVatPrice,
  extractTechnicalSpecs,
  calculateMatchScore
} from '../src/utils/comparativeCalculation';
import { CanonicalMaterial, ComparativeDocument } from '../src/types';

console.log('--- RUNNING COMPARATIVE CALCULATION TESTS ---');

// TEST 1: User's explicit prompt scenario
// - Satın alınan Firma A ilk teklif: 70.000 RUB/ton
// - Firma B ilk teklif: 69.000 RUB/ton
// - Firma C ilk teklif: 68.000 RUB/ton
// - Firma A son fiyat: 65.000 RUB/ton
// - Miktar: 100 ton
// Beklenen:
// - Piyasa referans: 68.000 RUB/ton
// - Firma içi indirim: 5.000 RUB/ton
// - Gerçek pazarlık kazanımı: 3.000 RUB/ton
// - Gerçek toplam kazanım: 300.000 RUB
// - Gerçek indirim oranı: %4.41

const mockDocs: ComparativeDocument[] = [
  {
    id: 'doc_1',
    fileName: 'Firma_A_Ilk_Teklif.pdf',
    fileUrl: '/api/files/doc1.pdf',
    supplier: 'Firma A',
    documentRole: 'FIRST_OFFER',
    roleConfidence: 0.98,
    totalAmount: 7000000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_2',
    fileName: 'Firma_B_Ilk_Teklif.pdf',
    fileUrl: '/api/files/doc2.pdf',
    supplier: 'Firma B',
    documentRole: 'COMPETITOR_FIRST_OFFER',
    roleConfidence: 0.95,
    totalAmount: 6900000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_3',
    fileName: 'Firma_C_Ilk_Teklif.pdf',
    fileUrl: '/api/files/doc3.pdf',
    supplier: 'Firma C',
    documentRole: 'COMPETITOR_FIRST_OFFER',
    roleConfidence: 0.95,
    totalAmount: 6800000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  },
  {
    id: 'doc_4',
    fileName: 'Firma_A_Son_Fatura.pdf',
    fileUrl: '/api/files/doc4.pdf',
    supplier: 'Firma A',
    documentRole: 'FINAL_INVOICE',
    roleConfidence: 0.99,
    totalAmount: 6500000,
    currency: 'RUB',
    isVatIncluded: true,
    isShippingIncluded: true,
    isExcluded: false,
    items: []
  }
];

const mockMaterials: CanonicalMaterial[] = [
  {
    id: 'mat_1',
    commonName: '12 mm A500C nervürlü inşaat demiri',
    materialType: 'İnşaat Demiri',
    standardUnit: 'ton',
    specs: { diameter: 'Ø12 mm', grade: 'A500C', standard: 'ГОСТ 34028' },
    purchasedQuantity: 100,
    purchasedUnitPrice: 65000,
    purchasedSupplier: 'Firma A',
    marketReferenceUnitPrice: 0,
    marketReferenceSupplier: '',
    realUnitSavings: 0,
    realTotalSavings: 0,
    realSavingsPercentage: 0,
    internalVendorUnitDiscount: 0,
    internalVendorTotalDiscount: 0,
    isAboveBestOffer: false,
    status: 'auto_matched',
    matchConfidence: 0.98,
    lines: [
      {
        documentId: 'doc_1',
        documentRole: 'FIRST_OFFER',
        supplierName: 'Firma A',
        originalDescription: 'Сталь для армирования d 12 мм',
        quantity: 100,
        unit: 'ton',
        normalizedQuantity: 100,
        normalizedUnit: 'ton',
        rawUnitPrice: 70000,
        normalizedUnitPrice: 70000,
        totalPrice: 7000000,
        isVatIncluded: true,
        matchConfidence: 0.96,
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: false,
        isInitialOffer: true
      },
      {
        documentId: 'doc_2',
        documentRole: 'COMPETITOR_FIRST_OFFER',
        supplierName: 'Firma B',
        originalDescription: 'Арматура А500С Ø12',
        quantity: 100,
        unit: 'ton',
        normalizedQuantity: 100,
        normalizedUnit: 'ton',
        rawUnitPrice: 69000,
        normalizedUnitPrice: 69000,
        totalPrice: 6900000,
        isVatIncluded: true,
        matchConfidence: 0.98,
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: true,
        isInitialOffer: true
      },
      {
        documentId: 'doc_3',
        documentRole: 'COMPETITOR_FIRST_OFFER',
        supplierName: 'Firma C',
        originalDescription: 'Арматурная сталь ф 12 А500С',
        quantity: 100,
        unit: 'ton',
        normalizedQuantity: 100,
        normalizedUnit: 'ton',
        rawUnitPrice: 68000,
        normalizedUnitPrice: 68000,
        totalPrice: 6800000,
        isVatIncluded: true,
        matchConfidence: 0.98,
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: true,
        isInitialOffer: true
      },
      {
        documentId: 'doc_4',
        documentRole: 'FINAL_INVOICE',
        supplierName: 'Firma A',
        originalDescription: 'Арматура А500С Ø12 (11.7м)',
        quantity: 100,
        unit: 'ton',
        normalizedQuantity: 100,
        normalizedUnit: 'ton',
        rawUnitPrice: 65000,
        normalizedUnitPrice: 65000,
        totalPrice: 6500000,
        isVatIncluded: true,
        matchConfidence: 0.99,
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: false,
        isInitialOffer: false
      }
    ]
  }
];

const result1 = calculateComparativeSavings({
  canonicalMaterials: mockMaterials,
  documents: mockDocs,
  winningSupplier: 'Firma A'
});

const mat1 = result1.canonicalMaterials[0];
console.log('Test 1 Results:');
console.log(' - Market Reference Price:', mat1.marketReferenceUnitPrice, 'RUB');
console.log(' - Real Unit Savings:', mat1.realUnitSavings, 'RUB');
console.log(' - Real Total Savings:', mat1.realTotalSavings, 'RUB');
console.log(' - Real Savings Percentage:', mat1.realSavingsPercentage, '%');
console.log(' - Internal Vendor Unit Discount:', mat1.internalVendorUnitDiscount, 'RUB');

assert.strictEqual(mat1.marketReferenceUnitPrice, 68000, 'Market reference must be 68.000 RUB (MIN of initial offers)');
assert.strictEqual(mat1.internalVendorUnitDiscount, 5000, 'Internal vendor discount must be 5.000 RUB (70k - 65k)');
assert.strictEqual(mat1.realUnitSavings, 3000, 'Real unit savings must be 3.000 RUB (68k - 65k)');
assert.strictEqual(mat1.realTotalSavings, 300000, 'Real total savings must be 300.000 RUB (3k * 100)');
assert.strictEqual(mat1.realSavingsPercentage, 4.41, 'Real savings percentage must be 4.41%');
assert.strictEqual(mat1.isAboveBestOffer, false);
console.log('✓ TEST 1 PASSED: User scenario calculated with 100% precision!');

// TEST 2: Negative result scenario (son fiyat referansın üzerinde)
// Reference: 68.000, Final: 69.000 -> -1.000 RUB diff, isAboveBestOffer = true
const mockNegativeMaterials: CanonicalMaterial[] = [
  {
    ...mockMaterials[0],
    purchasedUnitPrice: 69000,
    lines: mockMaterials[0].lines.map(l => {
      if (l.documentRole === 'FINAL_INVOICE') {
        return { ...l, rawUnitPrice: 69000, normalizedUnitPrice: 69000 };
      }
      return l;
    })
  }
];

const result2 = calculateComparativeSavings({
  canonicalMaterials: mockNegativeMaterials,
  documents: mockDocs,
  winningSupplier: 'Firma A'
});

const mat2 = result2.canonicalMaterials[0];
console.log('\nTest 2 Negative Result:');
console.log(' - Real Unit Savings:', mat2.realUnitSavings, 'RUB');
console.log(' - isAboveBestOffer:', mat2.isAboveBestOffer);
console.log(' - Warning:', mat2.warningMessage);

assert.strictEqual(mat2.realUnitSavings, -1000, 'Negative savings must be -1.000 RUB and NOT zeroed out');
assert.strictEqual(mat2.isAboveBestOffer, true, 'isAboveBestOffer must be true');
assert.ok(mat2.warningMessage?.includes('En iyi ilk teklif üzerinde kapanış'), 'Must have warning banner');
console.log('✓ TEST 2 PASSED: Negative differences preserved with warning flag!');

// TEST 3: Single vendor scenario (tek tedarikçi)
const result3 = calculateComparativeSavings({
  canonicalMaterials: mockMaterials,
  documents: [mockDocs[0], mockDocs[3]], // Only Firma A docs
  winningSupplier: 'Firma A'
});

const mat3 = result3.canonicalMaterials[0];
console.log('\nTest 3 Single Vendor:');
console.log(' - isSingleVendor:', result3.isSingleVendor);
console.log(' - Real Total Savings:', mat3.realTotalSavings);
console.log(' - Internal Discount:', mat3.internalVendorTotalDiscount);

assert.strictEqual(result3.isSingleVendor, true, 'isSingleVendor must be true');
assert.strictEqual(mat3.realTotalSavings, 0, 'No market savings when single vendor');
assert.strictEqual(mat3.internalVendorTotalDiscount, 500000, 'Internal discount is preserved');
console.log('✓ TEST 3 PASSED: Single vendor logic handled properly!');

// TEST 4: Technical Specs Extraction
console.log('\nTest 4 Spec Extraction:');
const specA = extractTechnicalSpecs('Сталь углеродистая для армирования железобетонных конструкций периодического профиля d 12 мм ГОСТ 34028');
const specB = extractTechnicalSpecs('Арматура А500С Ø12 (11,7м ГОСТ 34028)');
console.log(' - Spec A:', specA);
console.log(' - Spec B:', specB);

assert.strictEqual(specA.diameter, 'Ø12 mm');
assert.strictEqual(specB.diameter, 'Ø12 mm');
assert.strictEqual(specB.grade, 'A500C');

const matchScore = calculateMatchScore(
  { description: 'Сталь углеродистая для армирования периодического профиля d 12 мм', specs: specA },
  { description: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', specs: specB }
);
console.log(' - Hybrid Match Score:', matchScore.score, 'Reason:', matchScore.reason);
assert.ok(matchScore.score >= 0.85, 'Hybrid match score should be high for 12mm rebar');
console.log('✓ TEST 4 PASSED: Spec extraction and hybrid match working perfectly!');

// TEST 5: Unit & VAT Normalization
const unitConv = normalizeQuantityAndPrice(500, 70, 'kg', 'ton');
console.log('\nTest 5 Unit Conversion: 500 kg @ 70 RUB/kg ->', unitConv.normalizedQty, 'ton @', unitConv.normalizedUnitPrice, 'RUB/ton');
assert.strictEqual(unitConv.normalizedQty, 0.5);
assert.strictEqual(unitConv.normalizedUnitPrice, 70000);

const vatConv = normalizeVatPrice(1000, false, true, 0.20);
console.log('Test 5 VAT Normalization: 1000 RUB without VAT -> with 20% VAT:', vatConv.normalizedPrice);
assert.strictEqual(vatConv.normalizedPrice, 1200);
console.log('✓ TEST 5 PASSED: Unit & VAT normalization verified!');

// TEST 6: User's issue: Agreed offer has 7 items with specific tonnages, initial offers have different line counts/tonnages
// The agreed offer lines and tonnages must be preserved as the baseline.
console.log('\nTest 6 Agreed Offer Tonnage and 7 Items Baseline:');
const agreedMaterials: CanonicalMaterial[] = Array.from({ length: 7 }, (_, i) => ({
  id: `mat_${i + 1}`,
  commonName: `Арматура d${10 + i * 2} мм`,
  materialType: 'rebar',
  standardUnit: 'ton',
  specs: { diameter: `Ø${10 + i * 2} mm` },
  purchasedQuantity: 10 + i * 5, // 10, 15, 20, 25, 30, 35, 40 -> total 175 ton
  purchasedUnitPrice: 65000,
  purchasedSupplier: 'Firma Anlaşılan',
  marketReferenceUnitPrice: 68000,
  marketReferenceSupplier: 'Firma Rakip',
  realUnitSavings: 3000,
  realTotalSavings: 3000 * (10 + i * 5),
  realSavingsPercentage: 4.41,
  internalVendorUnitDiscount: 0,
  internalVendorTotalDiscount: 0,
  isAboveBestOffer: false,
  status: 'auto_matched',
  matchConfidence: 0.95,
  lines: [
    {
      documentId: 'doc_agreed',
      documentRole: 'FINAL_INVOICE',
      supplierName: 'Firma Anlaşılan',
      originalDescription: `Арматура d${10 + i * 2} мм`,
      quantity: 10 + i * 5,
      unit: 'ton',
      normalizedQuantity: 10 + i * 5,
      normalizedUnit: 'ton',
      rawUnitPrice: 65000,
      normalizedUnitPrice: 65000,
      totalPrice: (10 + i * 5) * 65000,
      isVatIncluded: true,
      matchConfidence: 1.0,
      isApprovedByUser: true,
      lineIndex: 0,
      isCompetitor: false,
      isInitialOffer: false
    },
    {
      documentId: 'doc_initial',
      documentRole: 'FIRST_OFFER',
      supplierName: 'Firma Rakip',
      originalDescription: `Арматура d${10 + i * 2} мм (farklı teklif tonajı)`,
      quantity: 50, // Initial offer quoted 50 ton for all
      unit: 'ton',
      normalizedQuantity: 50,
      normalizedUnit: 'ton',
      rawUnitPrice: 68000,
      normalizedUnitPrice: 68000,
      totalPrice: 50 * 68000,
      isVatIncluded: true,
      matchConfidence: 0.92,
      isApprovedByUser: true,
      lineIndex: 1,
      isCompetitor: true,
      isInitialOffer: true
    }
  ]
}));

const result6 = calculateComparativeSavings({
  canonicalMaterials: agreedMaterials,
  documents: [
    {
      id: 'doc_agreed',
      fileName: 'Anlasilan_Fatura.pdf',
      fileUrl: '/api/files/anlasilan.pdf',
      supplier: 'Firma Anlaşılan',
      documentRole: 'FINAL_INVOICE',
      roleConfidence: 1.0,
      totalAmount: 175 * 65000,
      currency: 'RUB',
      isVatIncluded: true,
      isShippingIncluded: true,
      isExcluded: false,
      items: []
    },
    {
      id: 'doc_initial',
      fileName: 'Ilk_Teklifler.pdf',
      fileUrl: '/api/files/ilk.pdf',
      supplier: 'Firma Rakip',
      documentRole: 'FIRST_OFFER',
      roleConfidence: 0.95,
      totalAmount: 350 * 68000, // Total had 350 tons in initial offer
      currency: 'RUB',
      isVatIncluded: true,
      isShippingIncluded: true,
      isExcluded: false,
      items: []
    }
  ],
  winningSupplier: 'Firma Anlaşılan'
});

assert.strictEqual(result6.canonicalMaterials.length, 7, 'Must retain exactly the 7 agreed items');
// Check item 1 quantity is 10 ton (from agreed offer), not 50 ton (from initial offer)
assert.strictEqual(result6.canonicalMaterials[0].purchasedQuantity, 10, 'Must use agreed quantity (10 ton), not initial offer quantity');
assert.strictEqual(result6.canonicalMaterials[0].realUnitSavings, 3000, 'Unit savings: 68000 - 65000 = 3000');
assert.strictEqual(result6.canonicalMaterials[0].realTotalSavings, 30000, 'Total savings on 10 ton: 30.000 RUB');
assert.strictEqual(result6.summary.totalFinalPurchase, 175 * 65000, 'Total final purchase matches agreed items sum');
assert.strictEqual(result6.summary.totalInitialLowestOffer, 175 * 68000, 'Total initial market baseline calculated on agreed 175 tons');
console.log('✓ TEST 6 PASSED: 7 agreed items and agreed tonnages strictly prioritized!');

console.log('\nALL TESTS PASSED SUCCESSFULLY! 100% SPEC COMPLIANCE.');
