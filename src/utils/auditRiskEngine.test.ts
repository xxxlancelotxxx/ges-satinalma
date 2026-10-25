import assert from 'node:assert/strict';
import { evaluateDiscountAudit } from './auditRiskEngine';

console.log('=== RUNNING AUDIT RISK ENGINE TEST SUITE ===');

// Test 1: Item description does not match any comparison (comp is undefined)
{
  const result = evaluateDiscountAudit(
    {
      offerPrice: 100000,
      agreedPrice: 90000,
      discountPercentage: 10,
      items: [
        { materialName: 'Bilinmeyen Özel Parça XYZ-999', unitPrice: 500, quantity: 10, unit: 'adet' }
      ]
    },
    [
      { materialName: 'Nervürlü İnşaat Demiri Ø12', avgUnitPrice: 65000, unit: 'ton' }
    ]
  );

  assert.equal(result.auditStatus, 'NORMAL');
  assert.equal(result.benchmarkComparison, undefined);
  console.log('✓ Test 1 Passed: Unmatched item (comp is undefined) handled gracefully without throwing.');
}

// Test 2: Comparisons is empty array
{
  const result = evaluateDiscountAudit(
    {
      offerPrice: 50000,
      agreedPrice: 45000,
      items: [
        { materialName: 'Herhangi Bir Malzeme', unitPrice: 100, quantity: 5 }
      ]
    },
    []
  );

  assert.equal(result.auditStatus, 'NORMAL');
  console.log('✓ Test 2 Passed: Empty comparisons array handled gracefully.');
}

// Test 3: Null/undefined items or comparison records
{
  const result = evaluateDiscountAudit(
    {
      offerPrice: 20000,
      agreedPrice: 18000,
      items: [null as any, { description: '' }, { materialName: 'Test' }]
    },
    [null as any, { materialName: '' }, { materialName: 'Test', avgUnitPrice: 100, unit: 'adet' }]
  );

  assert.equal(result.auditStatus, 'NORMAL');
  console.log('✓ Test 3 Passed: Null and empty item/comparison records handled safely.');
}

// Test 4: Excessive discount detection
{
  const result = evaluateDiscountAudit({
    offerPrice: 100000,
    agreedPrice: 60000, // 40% discount
    discountPercentage: 40
  });

  assert.equal(result.auditStatus, 'EXCESSIVE_DISCOUNT');
  assert.equal(result.isEffortScoreFrozen, true);
  console.log('✓ Test 4 Passed: Excessive discount threshold correctly triggered.');
}

// Test 5: Suspicious price detection when the same material has verified purchase history
{
  const result = evaluateDiscountAudit(
    {
      offerPrice: 100000,
      agreedPrice: 95000,
      orderDate: '2026-10-20',
      items: [
        { materialName: 'Nervürlü Demir', originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', unitPrice: 90000, quantity: 1, unit: 'ton' }
      ]
    } as any,
    [
      {
        materialName: 'Nervürlü Demir', unit: 'ton', standardUnit: 'ton',
        history: [
          { originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', unitPrice: 55000, normalizedUnitPrice: 55000, date: '2026-09-01', invoiceNumber: 'A-1' },
          { originalName: 'Арм. Пруток МД 12х11700 А500С ГОСТ 34028-2016', unitPrice: 65000, normalizedUnitPrice: 65000, date: '2026-09-10', invoiceNumber: 'A-2' }
        ]
      }
    ]
  );

  assert.equal(result.auditStatus, 'SUSPICIOUS_PRICE');
  assert.equal(result.isEffortScoreFrozen, true);
  assert.ok(result.benchmarkComparison);
  assert.equal(result.benchmarkComparison?.benchmarkAvgPrice, 60000);
  console.log('✓ Test 5 Passed: Suspicious price successfully detected against same-material purchase history.');
}

// Test 6: Group average without line history, other diameters, later purchases and estimated conversions are never a benchmark
{
  const item = { materialName: 'Nervürlü Demir', originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', unitPrice: 90000, quantity: 1, unit: 'ton' };
  const summaryOnly = evaluateDiscountAudit(
    { offerPrice: 100000, agreedPrice: 95000, items: [item] } as any,
    [{ materialName: 'Nervürlü Demir', avgUnitPrice: 60000, minUnitPrice: 55000, maxUnitPrice: 65000, unit: 'ton' }]
  );
  assert.equal(summaryOnly.auditStatus, 'NORMAL');

  const otherSpecs = evaluateDiscountAudit(
    { offerPrice: 100000, agreedPrice: 95000, orderDate: '2026-10-20', items: [item] } as any,
    [{
      materialName: 'Nervürlü Demir', unit: 'ton', standardUnit: 'ton',
      history: [
        { originalName: 'Арматура А500С Ø16 (11,7м ГОСТ 34028)', unitPrice: 55000, date: '2026-09-01', invoiceNumber: 'B-1' },
        { originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', unitPrice: 50000, date: '2026-10-25', invoiceNumber: 'B-2' },
        { originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', unitPrice: 50000, date: '2026-09-02', invoiceNumber: 'B-3', conversionApplied: true, conversionFormula: 'Yoğunluk: 1 m³ ≈ 2.4 ton', originalUnit: 'm³', unit: 'ton' }
      ]
    }]
  );
  assert.equal(otherSpecs.auditStatus, 'NORMAL');
  console.log('✓ Test 6 Passed: Other diameter, later purchase, estimated conversion and group average are not used as benchmark.');
}

console.log('>>> ALL AUDIT RISK ENGINE TESTS PASSED! <<<');
