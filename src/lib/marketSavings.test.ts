import assert from 'node:assert/strict';
import { calculateMarketSavings } from './marketSavings';

// 1. Normal comparison with multiple vendors
const normal = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 70000, unit: 'ton', isWinner: true, confidence: 0.99 },
    { supplierId: 'B', unitPrice: 69000, unit: 'ton', confidence: 0.99 },
    { supplierId: 'C', unitPrice: 68000, unit: 'ton', confidence: 0.99 },
  ],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1',
  documentKey: 'doc-1'
});
assert.equal(normal.marketSavings, 3000);
assert.equal(normal.supplierInternalDiscount, 5000);
assert.equal(normal.totalSavings, 3000);
assert.equal(normal.kpiEligible, true);

// 2. Single vendor check
const single = calculateMarketSavings({
  offers: [{ supplierId: 'A', unitPrice: 70000, unit: 'ton', confidence: 0.99 }],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1'
});
assert.equal(single.marketSavings, 0);
assert(single.flags.includes('SINGLE_VENDOR'));

// 3. Above best offer
const above = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 68000, unit: 'ton' },
    { supplierId: 'B', unitPrice: 69000, unit: 'ton' }
  ],
  finalUnitPrice: 70000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1'
});
assert.equal(above.marketSavings, -2000);
assert(above.flags.includes('ABOVE_BEST_OFFER'));

// 4. Pending site allocation
const pending = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 70000, unit: 'ton' },
    { supplierId: 'B', unitPrice: 68000, unit: 'ton' }
  ],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton'
});
assert(!pending.kpiEligible);
assert(pending.flags.includes('PENDING_SITE'));

// 5. Duplicate document key
const duplicate = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 70000, unit: 'ton' },
    { supplierId: 'B', unitPrice: 68000, unit: 'ton' }
  ],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1',
  documentKey: 'doc-2',
  existingDocumentKeys: ['doc-2']
});
assert(!duplicate.kpiEligible);
assert(duplicate.flags.includes('DUPLICATE_DOCUMENT'));

// 6. Low match confidence threshold
const lowConfidence = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 70000, unit: 'ton', confidence: 0.2 },
    { supplierId: 'B', unitPrice: 68000, unit: 'ton', confidence: 0.99 }
  ],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1'
});
assert(!lowConfidence.kpiEligible);
assert(lowConfidence.flags.includes('NEEDS_MATCH_REVIEW'));

// 7. Unit conversion: kg to ton
const kgTon = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 70, unit: 'kg' },
    { supplierId: 'B', unitPrice: 68, unit: 'kg' }
  ],
  finalUnitPrice: 65000,
  finalQuantity: 1,
  finalUnit: 'ton',
  jobsiteId: 'site-1'
});
assert.equal(kgTon.marketBaselineUnitPrice, 68000);
assert.equal(kgTon.marketSavings, 3000);

// 8. Unknown length conversion: m to piece
const unknownLength = calculateMarketSavings({
  offers: [
    { supplierId: 'A', unitPrice: 10, unit: 'm' },
    { supplierId: 'B', unitPrice: 9, unit: 'm' }
  ],
  finalUnitPrice: 8,
  finalQuantity: 10,
  finalUnit: 'piece',
  jobsiteId: 'site-1'
});
assert(!unknownLength.kpiEligible);
assert(unknownLength.flags.includes('NEEDS_UNIT_REVIEW'));

// 9. Backward compatibility: Legacy calculation method
const legacy = calculateMarketSavings([70000, 68000], 65000, 1, 70000);
assert.equal(legacy.calculationMethod, 'LEGACY_FIRST_TO_FINAL');
assert(!legacy.kpiEligible);
assert(legacy.flags.includes('LEGACY_RECORD'));

// 10. Strict KPI Eligibility & Legacy Separation Filter Rule
// (Ensures kpiEligible !== false is rejected and only calculationMethod === 'MARKET_BASELINE_TO_FINAL' && kpiEligible === true is accepted)
interface TestRecord {
  id: string;
  calculationMethod?: 'MARKET_BASELINE_TO_FINAL' | 'LEGACY_FIRST_TO_FINAL';
  kpiEligible?: boolean;
  realMarketSavings?: number;
  offerPrice: number;
  agreedPrice: number;
}

const testRecords: TestRecord[] = [
  // Record 1: Valid Market Baseline with KPI Eligible = true -> INCLUDED in Market KPI pool
  { id: '1', calculationMethod: 'MARKET_BASELINE_TO_FINAL', kpiEligible: true, realMarketSavings: 3000, offerPrice: 70000, agreedPrice: 65000 },
  // Record 2: Single vendor with KPI Eligible = false -> EXCLUDED from Market KPI pool
  { id: '2', calculationMethod: 'MARKET_BASELINE_TO_FINAL', kpiEligible: false, realMarketSavings: 0, offerPrice: 70000, agreedPrice: 65000 },
  // Record 3: Legacy or unvalidated with kpiEligible = undefined -> EXCLUDED from Market KPI pool (must not pass loose !== false check)
  { id: '3', calculationMethod: 'MARKET_BASELINE_TO_FINAL', kpiEligible: undefined, realMarketSavings: 2000, offerPrice: 70000, agreedPrice: 68000 },
  // Record 4: Explicit legacy FIRST_TO_FINAL record -> EXCLUDED from Market KPI pool, INCLUDED in Legacy pool
  { id: '4', calculationMethod: 'LEGACY_FIRST_TO_FINAL', kpiEligible: false, realMarketSavings: 0, offerPrice: 60000, agreedPrice: 55000 },
  // Record 5: Historical record without calculationMethod -> EXCLUDED from Market KPI pool, INCLUDED in Legacy pool
  { id: '5', calculationMethod: undefined, kpiEligible: undefined, realMarketSavings: undefined, offerPrice: 50000, agreedPrice: 47000 }
];

// Strict Market KPI calculation (as implemented in SupervisorPerformanceReport)
const marketKpiSavings = testRecords.reduce((acc, d) => {
  if (d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true) {
    return acc + (Number(d.realMarketSavings) || 0);
  }
  return acc;
}, 0);

const marketKpiCount = testRecords.filter(
  d => d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true
).length;

// Legacy savings calculation (separate without deleting legacy records)
const legacySavings = testRecords.reduce((acc, d) => {
  const isStrictMarketEligible = d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true;
  if (!isStrictMarketEligible) {
    return acc + Math.max(0, (Number(d.offerPrice) || 0) - (Number(d.agreedPrice) || 0));
  }
  return acc;
}, 0);

const legacyCount = testRecords.filter(
  d => !(d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true)
).length;

// Assertions for strict market baseline KPI
assert.equal(marketKpiSavings, 3000, 'Only record 1 (kpiEligible === true) should contribute to market KPI savings');
assert.equal(marketKpiCount, 1, 'Only record 1 should be counted in market KPI files count');

// Assertions for legacy records preservation and separation
// Record 2 diff: 5000, Record 3 diff: 2000, Record 4 diff: 5000, Record 5 diff: 3000 -> Total = 15000
assert.equal(legacySavings, 15000, 'All non-market-KPI records must be preserved and aggregated in legacy pool');
assert.equal(legacyCount, 4, '4 records must be preserved in legacy/separate pool');

console.log('All marketSavings test assertions passed successfully.');
