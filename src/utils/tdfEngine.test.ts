import assert from 'node:assert';
import {
  computeTdf, tdfMaterialKey, extractTdfSpecs, specDifferences, paymentDays, validityEndDate,
  canonicalUnit, nextTdfCode, shortSupplierName, supplierKeyOf
} from './tdfEngine';
import { rebarForm } from '../../tests/tdfFixture';

console.log('--- TDF motoru ---');

// Yardımcılar
assert.strictEqual(canonicalUnit('т'), 't');
assert.strictEqual(canonicalUnit('тн.'), 't');
assert.strictEqual(canonicalUnit('кг'), 'kg');
assert.strictEqual(canonicalUnit('шт'), 'adet');
assert.strictEqual(canonicalUnit('м3'), 'm³');
assert.strictEqual(extractTdfSpecs('Арм. Ø8 А240С L=6 м').grade, 'A240C');
assert.strictEqual(extractTdfSpecs('Арм. Ø8 А240С L=6 м').diameter, '8');
assert.strictEqual(extractTdfSpecs('Арм. Ø8 А240С L=6 м').length, '6');
assert.strictEqual(extractTdfSpecs('Профлист С21 RAL 7024 толщ. 0,5').ral, '7024');
assert.strictEqual(extractTdfSpecs('Профлист С21 RAL 7024 толщ. 0,5').thickness, '0.5');
assert.strictEqual(extractTdfSpecs('Минвата 35 кг/м3 50 мм').density, '35');
assert.deepStrictEqual(specDifferences(extractTdfSpecs('Ø8 А400С'), extractTdfSpecs('Ø8 А240С')), ['sınıf A400C ≠ A240C']);
assert.strictEqual(tdfMaterialKey('Арм. Ø12 А500С'), tdfMaterialKey('Арматура 12 мм А500С'), 'kısaltma ve çap yazımı aynı anahtara düşmeli');
assert.notStrictEqual(tdfMaterialKey('Арм. Ø8 А500С'), tdfMaterialKey('Арм. Ø8 А240С'));
assert.strictEqual(paymentDays('30 дн. от даты отгрузки'), 30);
assert.strictEqual(paymentDays('100% предоплата'), 0);
assert.strictEqual(paymentDays(''), null);
assert.strictEqual(validityEndDate('5 дней', '2026-10-15'), '2026-10-20');
assert.strictEqual(validityEndDate('1 банковский день', '2026-10-16'), '2026-10-19', 'cuma + 1 banka günü = pazartesi');
assert.strictEqual(validityEndDate('до 31.10.2026'), '2026-10-31');
assert.strictEqual(nextTdfCode(['TDF-2026-0001', 'TDF-2026-0009', 'TDF-2025-0044'], 2026), 'TDF-2026-0010');
assert.strictEqual(shortSupplierName('ООО «Торговый дом БМЗ»'), 'ТД БМЗ');
assert.strictEqual(shortSupplierName('АО «ЕВРАЗ МАРКЕТ»'), 'ЕВРАЗ МАРКЕТ');
console.log('✓ yardımcılar');

// Berkant'ın UB10 armatür verisi
const form = rebarForm();
const c = computeTdf(form, '2026-10-19');
const key = (name: string) => supplierKeyOf({ supplier: name } as any);
const bmz = key('ООО «Торговый дом БМЗ»'), tula = key('ООО «ТД «ТУЛА-СТАЛЬ»'), uvm = key('ООО «УВМ-СТАЛЬ»'), dipos = key('ООО «ПКФ «ДиПОС»');
const sup = (k: string) => c.suppliers.find(s => s.key === k)!;
assert.strictEqual(c.suppliers.length, 5, 'BMZ\'nin iki teklifi tek firma sayılmalı');
assert.strictEqual(c.materials.length, 14);
assert.strictEqual(Math.round(c.orderTotalQty * 1000) / 1000, 1504.494);
assert.strictEqual(Math.round(sup(bmz).total), 77704677);
assert.strictEqual(sup(bmz).covered, 13);
assert.strictEqual(Math.round(sup(tula).total), 78150641);
assert.strictEqual(Math.round(sup(uvm).total), 85374569);
assert.strictEqual(sup(dipos).covered, 5);
assert.strictEqual(Math.round(c.mixTotal), 77726327);
assert.strictEqual(Math.round(sup(bmz).firstTotal! - sup(bmz).total), 2797127, 'BMZ pazarlık indirimi');
assert.ok(c.recommendation);
assert.strictEqual(Math.round(c.recommendation!.planTotal), 77731927);
assert.strictEqual(c.recommendation!.plan[0].supplierKey, bmz);
assert.strictEqual(c.recommendation!.plan[1].supplierKey, tula);
assert.ok(c.recommendation!.points[0].includes('418 714'), c.recommendation!.points[0]);
assert.ok(c.recommendation!.headline.startsWith('13 kalem ТД БМЗ'), c.recommendation!.headline);
// DiPOS kısmi teklif en ucuz toplam gibi görünmemeli
assert.ok(!c.recommendation!.plan.some(p => p.supplierKey === dipos));
const texts = c.warnings.map(w => `${w.level}|${w.text}`);
assert.strictEqual(c.warnings[0].level, 'critical');
assert.ok(texts.some(t => t.startsWith('critical|ООО «Торговый дом БМЗ»') || t.startsWith('critical|ТД БМЗ: ödeme')), 'BMZ ödeme çelişkisi kritik');
assert.ok(texts.some(t => t.startsWith('warning|ПКФ ДиПОС 14 kalemden 5')), 'DiPOS kısmi teklif uyarısı');
assert.ok(texts.some(t => t.startsWith('warning|УВМ-СТАЛЬ teklifinin geçerlilik süresi doldu')), 'UVM geçerlilik doldu');
assert.ok(texts.some(t => t.startsWith('warning|ЕВРАЗ МАРКЕТ teklifinde ödeme şartı')), 'Evraz ödeme şartı yok');
assert.ok(texts.some(t => t.startsWith('info|ТД БМЗ 8 kalemde miktarı')), 'BMZ yuvarlama');
const sc = (k: string) => c.scores.find(s => s.supplierKey === k)!;
assert.ok(sc(bmz).total > sc(uvm).total, 'pahalı UVM puanda öne geçmemeli');
assert.strictEqual(sc(dipos).price, null, 'kısmi teklif fiyat puanı almaz');
console.log('✓ UB10 armatür: toplamlar, öneri, uyarılar, puanlar');

// Evraz Ø8 kaleminde A240С yerine A400С verirse: otomatik birleşmez, elle birleştirilirse kritik uyarı
const f2 = rebarForm();
const ev = f2.offers.find(o => o.id === 'evraz')!;
const evLine = ev.lines.find(l => l.name.includes('А240С'))!;
evLine.name = 'Арм. Ø8 А400С L=6 м';
const c2 = computeTdf(f2, '2026-10-19');
assert.strictEqual(c2.materials.length, 15, 'farklı sınıf ayrı satır olmalı');
assert.ok(c2.mergeSuggestions.length >= 1, 'aynı çaplı farklı sınıf için birleştirme önerisi');
const a240 = c2.materials.find(m => m.name.includes('А240С'))!;
f2.materialOverrides = { [evLine.id]: a240.key };
const c3 = computeTdf(f2, '2026-10-19');
assert.strictEqual(c3.materials.length, 14);
const row = c3.materials.find(m => m.key === a240.key)!;
const evKey = key('АО «ЕВРАЗ МАРКЕТ»');
assert.ok(row.cells[evKey]?.warning?.includes('A400C'), row.cells[evKey]?.warning);
assert.ok(!row.bestSuppliers.includes(evKey));
assert.ok(c3.warnings.some(w => w.level === 'critical' && w.text.includes('farklı bir ürün')), 'teknik fark kritik uyarı');
console.log('✓ teknik fark (A400С ≠ A240С) birleşmiyor, elle birleşince uyarı veriyor');

// kg ↔ t dönüşümü
const f4 = rebarForm();
const uv = f4.offers.find(o => o.id === 'uvm')!;
const l40 = uv.lines.find(l => l.name.includes('Ø40'))!;
l40.unit = 'кг'; l40.quantity = 2000; l40.unitPrice = 56.5;
const c4 = computeTdf(f4, '2026-10-19');
const r40 = c4.materials.find(m => m.name.includes('Ø40'))!;
assert.strictEqual(r40.unit, 't');
assert.strictEqual(Math.round(r40.cells[uvm]!.unitPrice), 56500);
assert.strictEqual(Math.round(computeTdf(f4, '2026-10-19').suppliers.find(s => s.key === uvm)!.total), 85374569);
console.log('✓ kg → t dönüşümü');

console.log('TDF motoru testleri geçti.');
