import {
  extractRebarDiameter,
  getRebarWeightPerMeter,
  extractRollAreaM2,
  extractBoardAreaM2,
  normalizeStandardUnit,
  getMaterialBenchmarkUnit,
  convertMaterialUnit,
  areUnitsConvertible
} from './constructionUnitConverter';

console.log('=== TEST: GES İNŞAAT AKILLI BİRİM ÇEVRİM VE EŞDEĞERLİK MOTORU ===');

// 1. Rebar Spec & Weight Test
console.log('\n[TEST 1] Rebar Diameter Extraction & Meter-to-Ton Conversion');
const rebar1 = 'Арматура А500С ф12 мм L=11.7м';
const diam1 = extractRebarDiameter(rebar1);
console.log(`- Malzeme: "${rebar1}" -> Tespit Edilen Çap: Ø${diam1} mm`);
if (diam1 !== 12) throw new Error('Ø12 rebar diameter detection failed');

const kgPerM = getRebarWeightPerMeter(12);
console.log(`- Ø12 Metre Ağırlığı: ${kgPerM} kg/m (Beklenen: 0.888 kg/m)`);
if (Math.abs(kgPerM - 0.888) > 0.001) throw new Error('Ø12 linear mass calculation mismatch');

// Metre Fiyatını Tona Çevirme (Örn: 58 ₽/m -> Ton Fiyatı)
const rebarConv = convertMaterialUnit({
  materialName: rebar1,
  fromUnit: 'metre',
  toUnit: 'ton',
  unitPrice: 58,
  quantity: 5000 // 5000 metre
});
console.log(`- 58 ₽/metre -> Ton Fiyatı: ${rebarConv.convertedUnitPrice} ₽/ton (Formül: ${rebarConv.formula})`);
console.log(`- 5000 Metre -> Ton Miktarı: ${rebarConv.convertedQuantity} ton`);
if (rebarConv.convertedUnitPrice < 60000 || rebarConv.convertedUnitPrice > 70000) {
  throw new Error('Metre to Ton conversion price is out of expected ~65,315 range');
}

// 2. Membrane Roll to M² Test
console.log('\n[TEST 2] Waterproofing Membrane Roll to M² Conversion');
const mem1 = 'Изопласт ЭПП-4.0 (10м2)';
const rollArea1 = extractRollAreaM2(mem1);
console.log(`- Malzeme: "${mem1}" -> Tespit Edilen Rulo Alanı: ${rollArea1} m²`);
if (rollArea1 !== 10) throw new Error('Roll area extraction failed');

// 2,500 ₽/rulo -> m² Fiyatı
const memConv = convertMaterialUnit({
  materialName: mem1,
  fromUnit: 'rulo',
  toUnit: 'm²',
  unitPrice: 2500,
  quantity: 50 // 50 rulo
});
console.log(`- 2.500 ₽/rulo -> m² Fiyatı: ${memConv.convertedUnitPrice} ₽/m² (Beklenen: 250 ₽/m²)`);
console.log(`- 50 Rulo -> Toplam Alan: ${memConv.convertedQuantity} m² (Beklenen: 500 m²)`);
if (memConv.convertedUnitPrice !== 250) throw new Error('Membrane price conversion mismatch');
if (memConv.convertedQuantity !== 500) throw new Error('Membrane quantity conversion mismatch');

// 3. Drywall / GKL Board to M² Test
console.log('\n[TEST 3] Drywall Board to M² Conversion');
const gkl1 = 'Гипсокартон Knauf ГСП-А 12.5мм 1200х2500';
const gklArea = extractBoardAreaM2(gkl1);
console.log(`- Malzeme: "${gkl1}" -> Tespit Edilen Plaka Alanı: ${gklArea} m²`);
if (gklArea !== 3.0) throw new Error('GKL area extraction mismatch');

const gklConv = convertMaterialUnit({
  materialName: gkl1,
  fromUnit: 'plaka',
  toUnit: 'm²',
  unitPrice: 450,
  quantity: 100
});
console.log(`- 450 ₽/plaka -> m² Fiyatı: ${gklConv.convertedUnitPrice} ₽/m² (Beklenen: 150 ₽/m²)`);
if (gklConv.convertedUnitPrice !== 150) throw new Error('Drywall conversion mismatch');

// 4. Concrete M³ to Ton Test
console.log('\n[TEST 4] Ready-Mix Concrete M³ to Ton Conversion');
const conc1 = 'Товарный бетон B25 W6 F150';
const concConv = convertMaterialUnit({
  materialName: conc1,
  fromUnit: 'm³',
  toUnit: 'ton',
  unitPrice: 6000,
  quantity: 20
});
console.log(`- 6.000 ₽/m³ -> Ton Fiyatı: ${concConv.convertedUnitPrice} ₽/ton (Beklenen: 2500 ₽/ton)`);
if (concConv.convertedUnitPrice !== 2500) throw new Error('Concrete conversion mismatch');

// 5. Benchmark Unit Detection Test
console.log('\n[TEST 5] Benchmark Reference Unit Selection');
const rebarBench = getMaterialBenchmarkUnit('Арматура А500С ф16', 'İnşaat Demiri', ['metre', 'ton']);
console.log(`- Demir Referans Birimi: ${rebarBench} (Beklenen: ton)`);
if (rebarBench !== 'ton') throw new Error('Rebar benchmark unit should be ton');

const memBench = getMaterialBenchmarkUnit('Техноэласт ЭПП', 'Yalıtım', ['rulo', 'm²']);
console.log(`- Membran Referans Birimi: ${memBench} (Beklenen: m²)`);
if (memBench !== 'm²') throw new Error('Membrane benchmark unit should be m²');

// 6. Köşebent Demir (L-Profil) Adet vs Metre vs Ton Test
console.log('\n[TEST 6] Köşebent Demir (L-Profil) Conversion');
const angle1 = 'Sıcak Haddelenmiş Köşebent 32x32x3 mm 3 m';
const angleConv = convertMaterialUnit({
  materialName: angle1,
  fromUnit: 'Adet',
  toUnit: 'metre',
  unitPrice: 658,
  quantity: 34
});
console.log(`- Köşebent 32x32x3 3m: 658 ₽/adet -> Metre Fiyatı: ${angleConv.convertedUnitPrice} ₽/m (Formül: ${angleConv.formula})`);
console.log(`- 34 Adet -> Metre Miktarı: ${angleConv.convertedQuantity} m`);
if (Math.abs(angleConv.convertedUnitPrice - 219.33) > 0.05) throw new Error('Köşebent Adet to Metre conversion failed');
if (angleConv.convertedQuantity !== 102) throw new Error('Köşebent quantity conversion failed');

// 7. Çelik Hasır Adet (kart) & Ton vs M² Test
console.log('\n[TEST 7] Çelik Hasır Adet (Kart) & Ton to M² Conversion');
const mesh1 = 'Сетка сварная 100х100х4 (2х6) ТУ';
const meshConv = convertMaterialUnit({
  materialName: mesh1,
  fromUnit: 'Adet',
  toUnit: 'm²',
  unitPrice: 1614,
  quantity: 100
});
console.log(`- Hasır 100x100x4 (2x6m): 1.614 ₽/adet -> m² Fiyatı: ${meshConv.convertedUnitPrice} ₽/m² (Formül: ${meshConv.formula})`);
console.log(`- 100 Adet -> Toplam Alan: ${meshConv.convertedQuantity} m²`);
if (meshConv.convertedUnitPrice !== 134.5) throw new Error('Çelik Hasır Adet to m² conversion failed');
if (meshConv.convertedQuantity !== 1200) throw new Error('Çelik Hasır quantity conversion failed');

// 8. Gazbeton Blok Adet to M³ Test
console.log('\n[TEST 8] Gazbeton Blok Adet to M³ Conversion');
const gaz1 = 'Gazbeton Bonolit 200х250х600 мм D600';
const gazConv = convertMaterialUnit({
  materialName: gaz1,
  fromUnit: 'Adet',
  toUnit: 'm³',
  unitPrice: 188.85,
  quantity: 333
});
console.log(`- Gazbeton 200x250x600: 188.85 ₽/adet -> m³ Fiyatı: ${gazConv.convertedUnitPrice} ₽/m³ (Formül: ${gazConv.formula})`);
if (Math.abs(gazConv.convertedUnitPrice - 6295) > 0.1) throw new Error('Gazbeton Adet to m³ conversion failed');

// 9. Are Units Convertible Test
console.log('\n[TEST 9] areUnitsConvertible Verification');
if (!areUnitsConvertible('L-Köşebent Demir 32x32x3 mm', 'm', 'adet')) throw new Error('Köşebent m <-> adet must be convertible');
if (!areUnitsConvertible('L-Köşebent Demir 32x32x3 mm', 'm', 'ton')) throw new Error('Köşebent m <-> ton must be convertible');
if (!areUnitsConvertible('Çelik Hasır 100x100x4 mm', 'm2', 'adet')) throw new Error('Çelik hasır m2 <-> adet must be convertible');
if (!areUnitsConvertible('Çelik Hasır 100x100x4 mm', 'm2', 'rulo')) throw new Error('Çelik hasır m2 <-> rulo must be convertible');
if (!areUnitsConvertible('Gazbeton Blok 200x250x600', 'm3', 'adet')) throw new Error('Gazbeton m3 <-> adet must be convertible');

console.log('\nALL 9 CONSTRUCTION UNIT CONVERSION TESTS PASSED PERFECTLY!\n');
