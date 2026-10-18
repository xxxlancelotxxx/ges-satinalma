import assert from 'node:assert/strict';
import { comparisonUnitPriceOfItem, comparisonMultiplierForVat } from './vatBasis';

// %22 KDV'li kalem: net 2.513,34 → 3.066,27 (Fatura 671 örneği)
assert.equal(comparisonUnitPriceOfItem({ unitPrice: 2513.34, vatPercentage: 22 }), 3066.27);
// 2025 faturası %20 KDV: aynı net fiyat da %22 tabanına taşınır, fiyat farkı gibi görünmez
assert.equal(comparisonUnitPriceOfItem({ unitPriceNet: 2513.34, vatPercentage: 20 }), 3066.27);
// KDV'siz / muaf satıra KDV eklenmez
assert.equal(comparisonUnitPriceOfItem({ unitPrice: 1500, vatPercentage: 0 }), 1500);
// %10 indirimli oran kendi brütüyle
assert.equal(comparisonUnitPriceOfItem({ unitPrice: 100, vatPercentage: 10 }), 110);
// KDV oranı bilinmiyorsa standart %22
assert.equal(comparisonMultiplierForVat(undefined), 1.22);
assert.equal(comparisonUnitPriceOfItem({ unitPrice: 0, vatPercentage: 22 }), 0);
console.log('vatBasis.test.ts: tüm testler geçti');
