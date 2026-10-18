import assert from 'node:assert/strict';
import { materialFingerprint as fp, isDistinctiveFingerprint } from './materialFingerprint';

console.log('=== MATERIAL FINGERPRINT TESTS ===');

const same = (a: string, b: string, label: string) => {
  assert.equal(fp(a), fp(b), `${label}: "${a}" ≡ "${b}" (${fp(a)} vs ${fp(b)})`);
  console.log(`✓ ${label}`);
};
const differ = (a: string, b: string, label: string) => {
  assert.notEqual(fp(a), fp(b), `${label}: "${a}" ≠ "${b}"`);
  console.log(`✓ ${label}`);
};

// Aynı malzeme, farklı yazım → aynı parmak izi
same('Саморез по металлу 4,2х76', 'Саморез 4.2x76 по металлу', 'Ondalık virgül/nokta, x/х ve kelime sırası');
same('Саморез по металлу 4,2*76', 'Саморез по металлу 4.2 × 76', 'Ölçü ayırıcıları * ve ×');
same('Пена монтажная проф. SOUDAL 750 мл', 'Пена монтажная проф. Soudal 750мл', 'Bitişik birim ve büyük/küçük harf');
same('Арматура А500С ф12', 'Арматура A500C Ø12', 'Kiril/Latin benzer harfler ve çap işaretleri');
same('Электроды МР-3 d3,0 мм (уп. 5 кг)', 'Электроды MP-3 ф3 мм уп. 5кг', 'Gereksiz ondalık sıfır ve kg');
same('ÇİMENTO PORTLAND M500 50 KG', 'Çimento Portland M500 50kg', 'Türkçe büyük harf (İ/Ç)');
same('Лента малярная 48мм х 50м', 'Лента малярная 48 мм*50 м', 'Araya birim girmiş ölçü');
same('Мешок для мусора 120 л', 'Мешок 120л для мусора', 'Litre ve dolgu kelimeleri');
same('Кабель ВВГнг-LS 3х2,5', 'Кабель ВВГнг-LS 3x2.5', 'Kablo kesiti');
same('Ёлка', 'Елка', 'ё ≡ е');

// Farklı ölçü / farklı ürün → farklı parmak izi (yanlış birleşme olmamalı)
differ('Саморез по металлу 4,2х76', 'Саморез по металлу 4,2х70', 'Farklı uzunluk ayrı kalır');
differ('Арматура А500С ф12', 'Арматура А500С ф14', 'Farklı çap ayrı kalır');
differ('Пена монтажная 750 мл', 'Пена монтажная 1000 мл', 'Farklı hacim ayrı kalır');
differ('Кабель ВВГнг-LS 3х2,5', 'Кабель ВВГнг-LS 3х1,5', 'Farklı kesit ayrı kalır');
differ('Шпилька М12х1000', 'Шпилька М10х1000', 'Farklı diş ayrı kalır');
differ('Труба 50х50х3', 'Труба 50х50х2', 'Farklı et kalınlığı ayrı kalır');

// Boş girişler
assert.equal(fp(''), '');
assert.equal(fp(undefined), '');
console.log('✓ Boş giriş');

// Ayırt edicilik: tek kelime veya sadece sayı alias anahtarı olamaz
assert.equal(isDistinctiveFingerprint(fp('Материал')), false);
assert.equal(isDistinctiveFingerprint(fp('12 50')), false);
assert.equal(isDistinctiveFingerprint(fp('Саморез 4,2х76')), true);
console.log('✓ Ayırt edicilik kontrolü');

console.log('✅ Tüm parmak izi testleri geçti');
