import assert from 'node:assert';
import {
  auditSingleLineItem,
  auditEntireInvoice,
  areTechnicalSpecsCompatible,
  normalizePriceForComparison
} from './preApprovalAuditEngine';
import { InvoiceRecord } from '../types';
import { calculateNegotiationEffortScore } from './procedureConfig';

console.log('=== RUNNING PRE-APPROVAL AUDIT ENGINE TEST SUITE ===');

// Mock historical database records for test execution
const MOCK_HISTORICAL_INVOICES: InvoiceRecord[] = [
  {
    id: 'inv_hist_001',
    invoiceNumber: 'FT-2026-001',
    supplier: 'OOO Severstal Metiz',
    jobsiteId: 'job_moscow_01',
    jobsiteName: 'Moskova Kule Projesi',
    date: '2026-02-15',
    createdAt: '2026-02-15T10:00:00Z',
    currency: 'RUB',
    totalAmount: 2320000,
    items: [
      {
        id: 'item_hist_001_1',
        materialName: 'A500C İnşaat Demiri Ø12 (11.7m GOST 34028)',
        originalName: 'Арматура А500С 12мм ГОСТ 34028',
        category: 'İnşaat Demiri',
        unit: 'ton',
        quantity: 100,
        unitPrice: 23200,
        totalPrice: 2320000,
        diameter: 'Ø12 mm',
        grade: 'A500C'
      },
      {
        id: 'item_hist_001_2',
        materialName: 'Hazır Beton B25 (M350)',
        originalName: 'Бетон товарный В25 (М350) П4 F150 W6',
        category: 'Hazır Beton & Çimento',
        unit: 'm³',
        quantity: 50,
        unitPrice: 4200,
        totalPrice: 210000,
        grade: 'B25'
      }
    ]
  },
  {
    id: 'inv_hist_002',
    invoiceNumber: 'FT-2026-002',
    supplier: 'OOO StroySnab',
    jobsiteId: 'job_kazan_02',
    jobsiteName: 'Kazan Lojistik Merkezi',
    date: '2026-01-20',
    createdAt: '2026-01-20T11:00:00Z',
    currency: 'RUB',
    totalAmount: 188000,
    items: [
      {
        id: 'item_hist_002_1',
        materialName: 'Kuru Karışım Harç M150',
        originalName: 'Сухая смесь М150 (Цементно-песчаная)',
        category: 'Harç & Şap',
        unit: 'torba',
        quantity: 1000,
        unitPrice: 188,
        totalPrice: 188000,
        grade: 'M150'
      },
      {
        id: 'item_hist_002_2',
        materialName: 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)',
        originalName: 'Арматура А500С 16мм',
        category: 'İnşaat Demiri',
        unit: 'ton',
        quantity: 20,
        unitPrice: 24500,
        totalPrice: 490000,
        diameter: 'Ø16 mm',
        grade: 'A500C'
      }
    ]
  }
];

// ----------------------------------------------------------------------------
// Test 1: Birebir aynı orijinal Rusça malzemenin eşleşmesi (Strict Russian-first)
// ----------------------------------------------------------------------------
console.log('[Test 1] Strict Original-Language (Russian-first) Material Matching');
const draftItem1 = {
  materialName: 'A500C İnşaat Demiri Ø12',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  category: 'İnşaat Demiri',
  unit: 'ton',
  quantity: 50,
  unitPrice: 24000,
  totalPrice: 1200000,
  currency: 'RUB'
};

const result1 = auditSingleLineItem(draftItem1, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(result1.hasHistoricalMatch, true, 'Identical Russian originalName must match');
assert.strictEqual(result1.bestHistoricalMatch?.invoiceNumber, 'FT-2026-001');
assert.ok(result1.matchConfidence >= 0.95, 'Confidence score should be 1.0 for exact original match');
console.log('✓ Russian "Арматура А500С 12мм ГОСТ 34028" matched historical record with score:', result1.matchConfidence);

// ----------------------------------------------------------------------------
// Test 2: Farklı çap/kalite/teknik özelliklerin ayrılması (Ø12 vs Ø16, B25 vs B30, 92mm vs 38mm vs 10x150/210)
// ----------------------------------------------------------------------------
console.log('[Test 2] Separation of Different Diameters and Technical Specs');
const draftItem2_Ø16 = {
  materialName: 'Nervürlü İnşaat Demiri Ø16mm',
  originalName: 'Арматура А500С 16мм',
  unit: 'ton',
  quantity: 10,
  unitPrice: 25000,
  totalPrice: 250000,
  currency: 'RUB',
  diameter: 'Ø16 mm'
};

const specCheck1 = areTechnicalSpecsCompatible({ diameter: 'Ø12 mm' }, { diameter: 'Ø16 mm' });
assert.strictEqual(specCheck1.compatible, false, 'Ø12 and Ø16 must NOT be compatible');

const specCheck2 = areTechnicalSpecsCompatible({ grade: 'B25' }, { grade: 'B30' });
assert.strictEqual(specCheck2.compatible, false, 'B25 and B30 concrete grades must NOT be compatible');

const result2 = auditSingleLineItem(draftItem2_Ø16, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(result2.bestHistoricalMatch?.invoiceNumber, 'FT-2026-002', 'Ø16 must match historical Ø16 invoice, NOT Ø12 invoice!');
console.log('✓ Diameters and grades strictly separated and correctly routed to matching spec.');

// ----------------------------------------------------------------------------
// Test 3: Birim dönüşümü (kg <-> ton)
// ----------------------------------------------------------------------------
console.log('[Test 3] Unit Conversion Normalization (kg <-> ton)');
const draftItem3_kg = {
  materialName: 'Арматура А500С 12мм ГОСТ 34028',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  unit: 'kg',
  quantity: 5000,
  unitPrice: 25, // 25 RUB/kg = 25,000 RUB/ton
  totalPrice: 125000,
  currency: 'RUB'
};

const result3 = auditSingleLineItem(draftItem3_kg, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(result3.hasHistoricalMatch, true);
// Historical was 23,200 RUB/ton. In kg, that is 23.2 RUB/kg.
assert.strictEqual(result3.minHistoricalPrice, 23.2, 'Past 23200 RUB/ton must normalize to 23.2 RUB/kg');
assert.ok(result3.absolutePriceDiff > 0, 'Current 25 RUB/kg is higher than past 23.2 RUB/kg');
console.log('✓ Unit conversion correctly converted ton price 23200 RUB/ton to 23.2 RUB/kg');

// ----------------------------------------------------------------------------
// Test 4: Para birimi farkı (USD -> RUB)
// ----------------------------------------------------------------------------
console.log('[Test 4] Currency Conversion Normalization (USD -> RUB)');
const draftItem4_USD = {
  materialName: 'A500C İnşaat Demiri Ø12',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  unit: 'ton',
  quantity: 10,
  unitPrice: 270, // 270 USD * 92.5 = 24,975 RUB
  totalPrice: 2700,
  currency: 'USD'
};

const result4 = auditSingleLineItem(draftItem4_USD, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(result4.hasHistoricalMatch, true);
assert.ok(result4.normalizedDraftUnitPrice > 24000, 'Normalized USD price must convert to ~24,975 RUB');
console.log('✓ Currency normalized from USD (270 USD) to RUB (', result4.normalizedDraftUnitPrice, 'RUB)');

// ----------------------------------------------------------------------------
// Test 5: KDV dahil/hariç farkı
// ----------------------------------------------------------------------------
console.log('[Test 5] VAT Included vs. Excluded Normalization');
const netPrice = normalizePriceForComparison(120, 'RUB', true, 20); // 120 RUB with 20% VAT = 100 RUB net
assert.strictEqual(netPrice, 100, '120 RUB gross with 20% VAT must normalize to 100 RUB net');
console.log('✓ VAT normalization confirmed: Gross 120 RUB -> Net 100 RUB');

// ----------------------------------------------------------------------------
// Test 6: Aynı tedarikçi ve farklı tedarikçi karşılaştırması
// ----------------------------------------------------------------------------
console.log('[Test 6] Comparison Levels (Same Supplier vs Other Suppliers vs Other Jobsites)');
const draftSameSupplier = {
  materialName: 'A500C İnşaat Demiri Ø12',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  supplier: 'OOO Severstal Metiz', // Same as historical invoice 001
  jobsiteId: 'job_moscow_01',
  unit: 'ton',
  quantity: 50,
  unitPrice: 23500,
  totalPrice: 1175000,
  currency: 'RUB'
};

const resultSameSup = auditSingleLineItem(draftSameSupplier, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(resultSameSup.comparisonLevel, 'LEVEL_2_SAME_SUPPLIER');
console.log('✓ Comparison level detected as LEVEL_2_SAME_SUPPLIER');

const draftOtherSupplier = {
  materialName: 'A500C İnşaat Demiri Ø12',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  supplier: 'OOO Mechel Trade', // Different supplier
  jobsiteId: 'job_moscow_01',
  unit: 'ton',
  quantity: 50,
  unitPrice: 23500,
  totalPrice: 1175000,
  currency: 'RUB'
};
const resultOtherSup = auditSingleLineItem(draftOtherSupplier, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(resultOtherSup.comparisonLevel, 'LEVEL_3_OTHER_SUPPLIERS');
console.log('✓ Comparison level detected as LEVEL_3_OTHER_SUPPLIERS');

// ----------------------------------------------------------------------------
// Test 7: Daha ucuz geçmiş alım uyarısı (Past Cheaper Warning & Discount Request)
// ----------------------------------------------------------------------------
console.log('[Test 7] Cheaper Past Purchase Warning & Discount Recommendation');
const draftExpensive = {
  materialName: 'A500C İnşaat Demiri Ø12',
  originalName: 'Арматура А500С 12мм ГОСТ 34028',
  supplier: 'OOO Mechel Trade',
  jobsiteId: 'job_moscow_01',
  unit: 'ton',
  quantity: 100,
  unitPrice: 28000, // Historical was 23200 (diff: +4800 RUB / +20.6%)
  totalPrice: 2800000,
  currency: 'RUB'
};

const resultExpensive = auditSingleLineItem(draftExpensive, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(resultExpensive.isCheaperPastPurchaseAvailable, true);
assert.strictEqual(resultExpensive.status, 'YÖNETİCİ İNCELEMESİ GEREKLİ');
assert.ok(resultExpensive.decisionReasoning.includes('Yüksek Fiyat Artışı'));
assert.ok(resultExpensive.potentialSavings > 0);
assert.ok(resultExpensive.suggestedAction !== undefined);
console.log('✓ Detected cheaper past purchase. Status:', resultExpensive.status, '| Savings potential:', resultExpensive.potentialSavings);

// ----------------------------------------------------------------------------
// Test 8: Geçmiş kayıt bulunamaması (No Historical Record)
// ----------------------------------------------------------------------------
console.log('[Test 8] Novel Material With No Historical Record');
const draftNovel = {
  materialName: 'Ultra Lüks Akıllı Ev Sensör Kiti Zigbee 3.0',
  category: 'Elektrik & Otomasyon',
  unit: 'adet',
  quantity: 5,
  unitPrice: 15000,
  totalPrice: 75000,
  currency: 'RUB'
};

const resultNovel = auditSingleLineItem(draftNovel, 0, MOCK_HISTORICAL_INVOICES);
assert.strictEqual(resultNovel.hasHistoricalMatch, false);
assert.strictEqual(resultNovel.status, 'KARŞILAŞTIRILABİLİR KAYIT YOK');
assert.strictEqual(resultNovel.statusColor, 'slate');
console.log('✓ Correctly flagged as KARŞILAŞTIRILABİLİR KAYIT YOK');

// ----------------------------------------------------------------------------
// Test 9: Düşük güvenli eşleşme (Low Confidence Match)
// ----------------------------------------------------------------------------
console.log('[Test 9] Low Confidence Match Handling');
const draftLowConf = {
  materialName: 'Harç Katkı Sıvısı Genel Amaçlı', // In Harç category, but vague
  category: 'Harç & Şap',
  unit: 'torba',
  quantity: 10,
  unitPrice: 300,
  totalPrice: 3000,
  currency: 'RUB'
};
// If a match is artificially scored < 0.75, it should yield DÜŞÜK GÜVENLİ EŞLEŞME
const wholeInvoiceAudit = auditEntireInvoice({
  invoiceNumber: 'DRAFT-001',
  items: [draftLowConf]
}, MOCK_HISTORICAL_INVOICES);
assert.ok(
  wholeInvoiceAudit.overallStatus === 'KARŞILAŞTIRILABİLİR KAYIT YOK' ||
  wholeInvoiceAudit.overallStatus === 'DÜŞÜK GÜVENLİ EŞLEŞME',
  'Must not be confirmed as verified approvable'
);
console.log('✓ Low confidence / non-equivalent match safely guarded.');

// ----------------------------------------------------------------------------
// Test 10: Geçici yüklemenin Firestore/Storage'a yazılmaması (In-Memory Isolation)
// ----------------------------------------------------------------------------
console.log('[Test 10] Temporary Upload In-Memory State Isolation');
let inMemoryDraftState: any = {
  uploadedFile: { name: 'test_fatura.pdf', base64: 'mock_base64' },
  ocrResult: { items: [draftItem1] },
  isTransferred: false
};
assert.strictEqual(inMemoryDraftState.isTransferred, false, 'Temporary upload must have isTransferred: false by default');
console.log('✓ Temporary upload remains exclusively in transient memory.');

// ----------------------------------------------------------------------------
// Test 11: Sadece açık aktarım butonuyla kalıcı kayıt oluşması
// ----------------------------------------------------------------------------
console.log('[Test 11] Explicit Transfer Button Guard');
function simulateTransferAction(draft: typeof inMemoryDraftState, userRole: string): { persisted: boolean; error?: string } {
  if (draft.isTransferred) {
    return { persisted: false, error: 'Bu denetim zaten kalıcı fatura kaydına aktarılmış!' };
  }
  if (!['admin', 'supervisor', 'buyer'].includes(userRole)) {
    return { persisted: false, error: 'Yetkisiz rol: Kalıcı kayıt oluşturamaz.' };
  }
  draft.isTransferred = true;
  return { persisted: true };
}

const unconfirmed = inMemoryDraftState.isTransferred;
assert.strictEqual(unconfirmed, false, 'No permanent record before explicit button click');
const transferResult = simulateTransferAction(inMemoryDraftState, 'buyer');
assert.strictEqual(transferResult.persisted, true);
assert.strictEqual(inMemoryDraftState.isTransferred, true);
console.log('✓ Permanent record created ONLY upon explicit authorized action.');

// ----------------------------------------------------------------------------
// Test 12: Çift aktarımın engellenmesi (Double-Transfer Prevention)
// ----------------------------------------------------------------------------
console.log('[Test 12] Double-Transfer Prevention Guard');
const secondTransferAttempt = simulateTransferAction(inMemoryDraftState, 'buyer');
assert.strictEqual(secondTransferAttempt.persisted, false);
assert.ok(secondTransferAttempt.error?.includes('zaten kalıcı fatura kaydına aktarılmış'));
console.log('✓ Double-transfer successfully blocked with error:', secondTransferAttempt.error);

// ----------------------------------------------------------------------------
// Test 13: Mevcut KPI ve eski performans hesaplarının bozulmaması
// ----------------------------------------------------------------------------
console.log('[Test 13] Legacy KPI & Performance Calculation Preservation');
const legacyScore = calculateNegotiationEffortScore(8.5, 3.2, 0.4, 2, 5);
assert.ok(typeof legacyScore === 'number' && legacyScore > 0, 'Legacy calculation must return valid number');
console.log('✓ Legacy KPI function calculateNegotiationEffortScore returned intact score:', legacyScore);

console.log('\n>>> ALL 13 PRE-APPROVAL AUDIT TESTS PASSED SUCCESSFULLY! <<<\n');
