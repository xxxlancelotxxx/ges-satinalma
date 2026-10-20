import assert from 'node:assert';
import {
  computeTdf, tdfMaterialKey, extractTdfSpecs, specDifferences, paymentDays, validityEndDate,
  canonicalUnit, nextTdfCode, shortSupplierName, supplierKeyOf
} from './tdfEngine';
import { rebarForm } from '../../tests/tdfFixture';
import { parsePaymentText, parseDeliveryText, parseDeliveryPlaceText, parseValidityText, friendlyAiError, cleanReadWarning } from './tdfTerms';
import type { TdfForm, TdfOffer as Offer } from './tdfEngine';

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

// Ticari şart ayrıştırma (avans % / vade gün, teslim yeri, süreler)
assert.deepStrictEqual(parsePaymentText('100% предоплата'), { mode: 'advance', num: 100 });
assert.deepStrictEqual(parsePaymentText('Предоплата 30%, остаток по факту поставки'), { mode: 'advance', num: 30 });
assert.deepStrictEqual(parsePaymentText('Отсрочка платежа 45 календарных дней'), { mode: 'deferred', num: 45 });
assert.deepStrictEqual(parsePaymentText('30 дн. от даты отгрузки'), { mode: 'deferred', num: 30 });
assert.deepStrictEqual(parsePaymentText('Товар отпускается по факту прихода денег на р/с Поставщика, самовывозом'), { mode: 'advance', num: 100 });
assert.deepStrictEqual(parsePaymentText('Срок оплаты покупателем по настоящему счету составляет не более 2-х банковских дней'), { mode: 'advance', num: 100 });
assert.deepStrictEqual(parsePaymentText('оплата по факту поставки в течение 10 дней'), { mode: 'deferred', num: 10 });
assert.deepStrictEqual(parseDeliveryText('в наличии'), { mode: 'stock', num: 0 });
assert.deepStrictEqual(parseDeliveryText('10 рабочих дней'), { mode: 'days', num: 10 });
assert.deepStrictEqual(parseDeliveryText('2 недели'), { mode: 'days', num: 14 });
assert.deepStrictEqual(parseDeliveryPlaceText('самовывоз со склада'), { mode: 'factory' });
assert.deepStrictEqual(parseDeliveryPlaceText('доставка до объекта включена'), { mode: 'site' });
assert.deepStrictEqual(parseValidityText('3 банковских дня'), { mode: 'workdays', num: 3 });
const capErr = '{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend","status":"RESOURCE_EXHAUSTED"}}';
assert.ok(/harcama limiti/.test(friendlyAiError(capErr)));
assert.ok(/istek sınırında/.test(friendlyAiError('429 Too Many Requests')));
const stored = 'Ticari şartlar otomatik okunamadı ({"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai); kutular elle doldurulmalı.';
assert.ok(!cleanReadWarning(stored).includes('{"error"') && /harcama limiti/.test(cleanReadWarning(stored)), cleanReadWarning(stored));
console.log('✓ şart ayrıştırma ve anlaşılır hata mesajları');

// Kontrplak: iki firma aynı ürünü farklı yazmış → tek satır; farklı kalınlık ayrı kalır
const term = (value: string, mode?: string, num?: number) => ({ value, source: 'user' as const, ...(mode ? { mode } : {}), ...(num !== undefined ? { num } : {}) });
const offer = (id: string, supplier: string, lines: Array<[string, number, number]>, extra: Partial<Offer> = {}): Offer => ({
  id, supplier, docDate: '2026-10-16', terms: { payment: term('Avans %100', 'advance', 100), delivery: term('3 gün', 'days', 3), deliveryPlace: term('Şantiye teslim', 'site'), validity: term('3 gün', 'days', 3), warranty: term('') } as any,
  lines: lines.map(([name, quantity, unitPrice], i) => ({ id: `${id}${i}`, name, unit: 'шт', quantity, unitPrice })), ...extra
});
const ply: TdfForm = { id: 'p', code: 'TDF-2026-0002', title: 'playwood', status: 'draft', createdAt: '', updatedAt: '', offers: [
  offer('tr', 'ООО "ТРЕЙДМИ"', [['Фанера ФСФ 18 мм 1525х1525 сорт 2/2', 44, 1200]]),
  offer('ro', 'ООО "РОКА"', [['Фанера березовая ФСФ 1525*1525*18мм, сорт 2/2 Ш1', 44, 1150], ['Фанера ФСФ 21 мм 1525х1525 сорт 2/2', 10, 1500]])
] };
const cp = computeTdf(ply, '2026-10-20');
assert.strictEqual(cp.materials.length, 2, cp.materials.map(m => m.name).join(' | '));
const p18 = cp.materials.find(m => m.offerCount === 2)!;
assert.ok(p18, 'iki firmanın 18 mm kontrplakı tek satırda');
assert.strictEqual(p18.match, 'similar');
assert.strictEqual(p18.specs.size, '1525x1525');
assert.ok(cp.materials.some(m => m.name.includes('21 мм') && m.offerCount === 1), '21 mm ayrı satır');
console.log('✓ farklı yazılmış aynı ürün tek satır, farklı kalınlık ayrı');

// Nakliye: fabrika teslim + ayrı nakliye bedeli genel toplama eklenir, öneriyi değiştirir
const fr: TdfForm = { ...ply, offers: [
  offer('tr', 'ООО "ТРЕЙДМИ"', [['Фанера ФСФ 18 мм 1525х1525', 100, 1200]]),
  offer('ro', 'ООО "РОКА"', [['Фанера ФСФ 18 мм 1525х1525', 100, 1100]], { freightAmount: 15000, terms: { ...offer('x', 'x', []).terms, deliveryPlace: term('Fabrika / depo teslim', 'factory') } }),
  offer('ab', 'ООО "АБВ"', [['Фанера ФСФ 18 мм 1525х1525', 100, 1000]], { terms: { ...offer('x', 'x', []).terms, deliveryPlace: term('Fabrika / depo teslim', 'factory') } })
] };
const cf = computeTdf(fr, '2026-10-20');
const sk = (n: string) => key(n);
const roka = cf.suppliers.find(s => s.key === sk('ООО "РОКА"'))!;
const trd = cf.suppliers.find(s => s.key === sk('ООО "ТРЕЙДМИ"'))!;
const abv = cf.suppliers.find(s => s.key === sk('ООО "АБВ"'))!;
assert.strictEqual(roka.freightMode, 'separate');
assert.strictEqual(roka.grandTotal, 110000 + 15000);
assert.strictEqual(trd.freightMode, 'included');
assert.strictEqual(trd.grandTotal, 120000);
assert.strictEqual(abv.freightMode, 'missing');
assert.ok(cf.warnings.some(w => w.text.startsWith('АБВ fabrika/depo teslim')), 'nakliye girilmeyen fabrika teslim uyarısı');
assert.ok(cf.recommendation!.headline.includes('nakliye') , cf.recommendation!.headline);
if (cf.recommendation!.plan.some(p => p.supplierKey === sk('ООО "АБВ"'))) assert.ok(cf.recommendation!.headline.includes('АБВ nakliyesi hariç'), 'nakliyesi bilinmeyen firma başlıkta belirtilir');
const fr2: TdfForm = { ...fr, offers: fr.offers.filter(o => o.id !== 'ab') };
const cf2 = computeTdf(fr2, '2026-10-20');
assert.strictEqual(cf2.recommendation!.plan[0].supplierKey, sk('ООО "ТРЕЙДМИ"'), 'malzemede ucuz ama nakliyeyle pahalı РОКА önerilmez');
assert.strictEqual(cf2.recommendation!.planTotal, 120000);
assert.ok(cf2.recommendation!.headline.includes('(nakliye dahil)'));
// eski kayıt: montaj alanı ve yalnız metin şartlar sorun çıkarmaz
const legacy: TdfForm = JSON.parse(JSON.stringify(fr2));
(legacy.offers[0].terms as any).installation = { value: 'нет', source: 'offer' };
legacy.offers[0].terms.payment = { value: '30 дн. от даты отгрузки', source: 'offer' };
const cl = computeTdf(legacy, '2026-10-20');
assert.ok(cl.scores.find(s => s.supplierKey === sk('ООО "ТРЕЙДМИ"'))!.payment > cf2.scores.find(s => s.supplierKey === sk('ООО "ТРЕЙДМИ"'))!.payment, 'vadeli ödeme avanstan yüksek puan alır');
console.log('✓ nakliye dahil genel toplam ve öneri');

console.log('TDF motoru testleri geçti.');
