import assert from 'node:assert/strict';
import { buildMergeSuggestions, differsByVariant, numericSignature } from './materialMergeSuggestions';

console.log('=== MATERIAL MERGE SUGGESTION TESTS ===');

// 1. OCR (Rusça) ve Prizma (Türkçe) kaydı aynı ölçü ve benzer satırla önerilir
const s1 = buildMergeSuggestions([
  { id: 'a', materialName: 'Саморез по металлу 4,2х76', unit: 'adet', avgUnitPrice: 5, history: [{ originalName: 'Саморез по металлу 4,2х76' }] },
  { id: 'b', materialName: 'SAC VİDASI 4.2X76', unit: 'adet', avgUnitPrice: 6, history: [{ originalName: 'Саморез по металлу 4.2 x 76 мм' }, { originalName: 'Саморез 4,2*76 по металлу' }] }
]);
assert.equal(s1.length, 1);
assert.equal(s1[0].targetId, 'b'); // daha çok satırı olan hedef
assert.equal(s1[0].sourceId, 'a');
console.log('✓ Aynı ölçülü OCR/Prizma kayıtları öneriliyor, hedef büyük grup');

// 2. Farklı ölçü asla önerilmez
const s2 = buildMergeSuggestions([
  { id: 'a', materialName: 'Саморез 4,2х76', history: [{ originalName: 'Саморез по металлу 4,2х76' }] },
  { id: 'b', materialName: 'Саморез 4,2х70', history: [{ originalName: 'Саморез по металлу 4,2х70' }] }
]);
assert.equal(s2.length, 0);
console.log('✓ Farklı ölçüler önerilmiyor');

// 3. Renk / beden / model harfi / marka varyantları önerilmez
assert.ok(differsByVariant('Картридж HP 117A синий', 'Картридж HP 117A желтый'));
assert.ok(differsByVariant('Перчатки рабочие размер L', 'Перчатки рабочие размер M'));
assert.ok(differsByVariant('Шоколад Mars 50 г', 'Шоколад Snickers 50 г'));
assert.ok(differsByVariant('Kağıt A4 [Marka: Комус]', 'Kağıt A4 [Marka: SvetoCopy]'));
assert.ok(!differsByVariant('Саморез по металлу 4,2х76', 'Саморез 4.2x76 по металлу'));
const s3 = buildMergeSuggestions([
  { id: 'a', materialName: 'Шоколад Mars 50 г', history: [{ originalName: 'Шоколад Mars 50 г' }] },
  { id: 'b', materialName: 'Шоколад Snickers 50 г', history: [{ originalName: 'Шоколад Snickers 50 г' }] },
  { id: 'c', materialName: 'Картридж 117A синий', history: [{ originalName: 'Картридж 117A синий' }] },
  { id: 'd', materialName: 'Картридж 117A желтый', history: [{ originalName: 'Картридж 117A желтый' }] }
]);
assert.equal(s3.length, 0);
console.log('✓ Renk / beden / marka varyantları önerilmiyor');

// 4. Aynı birimde fiyatı 2 kattan fazla farklı olanlar önerilmez
const s4 = buildMergeSuggestions([
  { id: 'a', materialName: 'Ведро 12 л', unit: 'adet', avgUnitPrice: 100, history: [{ originalName: 'Ведро пластиковое 12 л' }] },
  { id: 'b', materialName: 'Kova 12 L', unit: 'adet', avgUnitPrice: 450, history: [{ originalName: 'Ведро пластиковое 12л' }] }
]);
assert.equal(s4.length, 0);
console.log('✓ Fiyatı uyumsuz kayıtlar önerilmiyor');

// 5. Ortak Prizma stok kodu en güçlü sinyal; kilitli grup hedef olur; iki kilitli grup önerilmez
const s5 = buildMergeSuggestions([
  { id: 'a', materialName: 'Цемент М500 50 кг', history: [{ originalName: 'Цемент М500 50кг', materialCode: 'st-1' }] },
  { id: 'b', materialName: 'Çimento 50 kg', catalogLocked: true, history: [{ originalName: 'Портландцемент 50 кг', materialCode: 'ST-1' }] }
]);
assert.equal(s5.length, 1);
assert.equal(s5[0].targetId, 'b');
assert.ok(s5[0].score >= 0.95);
const s5b = buildMergeSuggestions([
  { id: 'a', materialName: 'X 1', catalogLocked: true, history: [{ originalName: 'Цемент 50кг', materialCode: 'st-1' }] },
  { id: 'b', materialName: 'Y 1', catalogLocked: true, history: [{ originalName: 'Цемент 50кг', materialCode: 'st-1' }] }
]);
assert.equal(s5b.length, 0);
console.log('✓ Stok kodu, kilitli hedef ve iki kilitli grup kuralları doğru');

// 6. Sayısal imza yazımdan bağımsız
assert.deepEqual(numericSignature(['Лента 48мм х 50м']), numericSignature(['Лента 48 mm * 50 m']));
console.log('✓ Sayısal imza yazımdan bağımsız');

// 7. Aynı stok kodu ama fiyatı 2.5 kattan fazla farklı (kod başka ürüne yeniden verilmiş) → önerilmez
const s7 = buildMergeSuggestions([
  { id: 'a', materialName: 'Кабель 3x2.5', unit: 'm', avgUnitPrice: 50, history: [{ originalName: 'Кабель ВВГ 3x2.5', materialCode: 'st-9' }] },
  { id: 'b', materialName: 'Кабель 3x6', unit: 'm', avgUnitPrice: 200, history: [{ originalName: 'Кабель ВВГ 3x6', materialCode: 'st-9' }] }
]);
assert.equal(s7.length, 0);
console.log('✓ Stok kodu ortak ama fiyat uyumsuzsa önerilmiyor');

console.log('ALL MERGE SUGGESTION TESTS PASSED');
