import assert from 'node:assert';
import {
  processItem,
  batchProcessItems,
  isAnchoringSystem,
  isGeneralConsumable,
  generateCanonicalProductId
} from './aiDecisionEngine';

console.log('--- Testing AI Decision Engine: processItem & Categorization ---');

// Test 1: Ankraj Sistemleri vs. Sarf Malzeme (The core requirement)
console.log('[Test 1] Anchoring Systems vs. Consumables Differentiation');

// Case A: Chemical Anchor
const chemicalAnchor = processItem({
  materialName: 'Hilti HIT-RE 500 V4 500ml Kimyasal Ankraj Kartuşu',
  originalName: 'Химический анкер Hilti HIT-RE 500 V4/500',
  unit: 'adet',
  quantity: 50,
  unitPrice: 1200
});

assert.strictEqual(chemicalAnchor.category, 'Ankraj Sistemleri', 'Chemical anchor must be Ankraj Sistemleri');
assert.strictEqual(chemicalAnchor.isAnchoringSystem, true, 'isAnchoringSystem flag must be true');
assert.strictEqual(chemicalAnchor.isConsumable, false, 'Chemical anchor must NOT be consumable');
assert.strictEqual(chemicalAnchor.functionalDomain, 'STRUCTURAL');
assert.ok(chemicalAnchor.canonicalProductId.startsWith('CPID-ANKRAJ-'), 'CPID must start with CPID-ANKRAJ-');
console.log('✓ Chemical Anchor correctly classified:', chemicalAnchor.canonicalProductId, '->', chemicalAnchor.category);

// Case B: Heavy Mechanical Wedge Anchor (FAZ II M16)
const wedgeAnchor = processItem({
  materialName: 'Fischer FAZ II 16/50 Klipsli Ağır Yük Çelik Ankraj Cıvatası',
  originalName: 'Анкер клиновой Fischer FAZ II 16/50',
  unit: 'adet',
  quantity: 200,
  unitPrice: 85
});

assert.strictEqual(wedgeAnchor.category, 'Ankraj Sistemleri');
assert.strictEqual(wedgeAnchor.isAnchoringSystem, true);
assert.strictEqual(wedgeAnchor.isConsumable, false);
console.log('✓ Mechanical Wedge Anchor correctly classified:', wedgeAnchor.canonicalProductId, '->', wedgeAnchor.category);

// Case C: M20 High-Strength Anchor Stud
const anchorStud = processItem({
  materialName: 'M20x300 8.8 Kalite Ankraj Saplaması ve Somunları',
  originalName: 'Анкерная шпилька М20х300 кл.пр. 8.8',
  unit: 'adet',
  quantity: 100,
  unitPrice: 150
});

assert.strictEqual(anchorStud.category, 'Ankraj Sistemleri');
assert.strictEqual(anchorStud.isAnchoringSystem, true);
console.log('✓ Structural Anchor Stud correctly classified:', anchorStud.canonicalProductId, '->', anchorStud.category);

// Case D: General Consumable: Drywall Screw
const drywallScrew = processItem({
  materialName: 'Alçıpan Vidası Sivri Uçlu 3.5x25mm (1000 Adet/Kutu)',
  originalName: 'Саморез для гипсокартона 3.5х25',
  unit: 'kutu',
  quantity: 20,
  unitPrice: 110
});

assert.strictEqual(drywallScrew.category, 'Sarf Malzeme & Hırdavat');
assert.strictEqual(drywallScrew.isConsumable, true);
assert.strictEqual(drywallScrew.isAnchoringSystem, false);
assert.strictEqual(drywallScrew.functionalDomain, 'CONSUMABLE');
assert.ok(drywallScrew.canonicalProductId.startsWith('CPID-SARF-'));
console.log('✓ Drywall Screw correctly classified as Consumable:', drywallScrew.canonicalProductId);

// Case E: General Consumable: Cutting Disc
const cuttingDisc = processItem({
  materialName: 'Metal Kesici Taş 115x1.0mm Taşlama Diski',
  originalName: 'Диск отрезной по металлу 115х1.0',
  unit: 'adet',
  quantity: 500,
  unitPrice: 18
});

assert.strictEqual(cuttingDisc.category, 'Sarf Malzeme & Hırdavat');
assert.strictEqual(cuttingDisc.isConsumable, true);
assert.strictEqual(cuttingDisc.isAnchoringSystem, false);
console.log('✓ Cutting Disc correctly classified as Consumable:', cuttingDisc.canonicalProductId);

// Case F: Safety PPE: Gloves
const gloves = processItem({
  materialName: 'Nitril Kaplı İş Eldiveni No:10 Sarı',
  originalName: 'Перчатки рабочие с нитриловым покрытием',
  unit: 'çift',
  quantity: 300,
  unitPrice: 25
});

assert.strictEqual(gloves.category, 'İş Güvenliği & KKD');
console.log('✓ Work Gloves correctly classified as Safety/ISG:', gloves.canonicalProductId);

// Case G: Consumable Hardware
const cuttingTool = processItem({
  materialName: 'Karbosan Metal Kesici Taş 180x3.0mm',
  originalName: 'Отрезной круг по металлу 180х3.0',
  unit: 'adet',
  quantity: 50,
  unitPrice: 45
});
assert.strictEqual(cuttingTool.category, 'Sarf Malzeme & Hırdavat');
assert.strictEqual(cuttingTool.isConsumable, true);
console.log('✓ Cutting Abrasive correctly classified as Consumable:', cuttingTool.canonicalProductId);

// Test 2: Standard Construction Rebar Normalization
console.log('\n[Test 2] Rebar Diameter Normalization & Canonical Product ID');

const rebarItem = processItem({
  materialName: 'A500C Nervürlü İnşaat Demiri d=16mm 11.7m',
  originalName: 'Арматура строительная А500С ф16 мм L=11700',
  unit: 'ton',
  quantity: 45.2,
  unitPrice: 65000
});

assert.strictEqual(rebarItem.category, 'İnşaat Demiri');
assert.strictEqual(rebarItem.canonicalName, 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)');
assert.strictEqual(rebarItem.attributes.diameter, 'Ø16 mm');
assert.strictEqual(rebarItem.attributes.grade, 'A500C');
assert.ok(rebarItem.canonicalProductId.includes('CPID-DEMIR-'));
console.log('✓ Rebar normalized to:', rebarItem.canonicalName);
console.log('✓ Rebar CPID:', rebarItem.canonicalProductId);

// Test 3: Batch Processing
console.log('\n[Test 3] Batch Processing of Mixed Invoice Items');

const batch = batchProcessItems([
  { materialName: 'Hilti HIT-HY 200-A Kimyasal Dübel Kartuş 330ml', unit: 'adet', unitPrice: 950 },
  { materialName: 'Sika Grout 212 Akıcı Harç 25kg', unit: 'torba', unitPrice: 350 },
  { materialName: 'Plywood 18mm Huş 1250x2500 Kalıplık Kontrplak', unit: 'adet', unitPrice: 850 },
  { materialName: 'Koli Bandı Şeffaf 45mm x 100m', unit: 'adet', unitPrice: 40 }
]);

assert.strictEqual(batch.length, 4);
assert.strictEqual(batch[0].category, 'Ankraj Sistemleri');
assert.strictEqual(batch[1].category, 'Hazır Beton, Çimento & Agrega');
assert.strictEqual(batch[2].category, 'Kalıp & İskele Sistemleri');
assert.strictEqual(batch[3].category, 'Sarf Malzeme & Hırdavat');
console.log('✓ All 4 mixed items categorized cleanly in batch:');
batch.forEach((it) => console.log(`  - [${it.category}] ${it.canonicalName} (${it.canonicalProductId})`));

console.log('\nAll AI Decision Engine test assertions PASSED successfully!');
