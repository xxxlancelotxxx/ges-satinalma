import assert from 'node:assert/strict';
import { isSameProductForPriceAlert, clusterSameProductRows } from './sameMaterialGuard';
import { buildSameMaterialPriceAlerts, isMinorPriceAlert } from './priceAnomalyEngine';

console.log('=== SAME-MATERIAL PRICE ALERT GUARD TESTS ===');

const same = (a: string, b: string, mat = 'Malzeme', cat = '') =>
  isSameProductForPriceAlert({ originalName: a }, { originalName: b }, mat, cat).same;

// Farklı marka / model / varyant: asla aynı malzeme değil (gerçek fatura satırları)
const different: Array<[string, string]> = [
  ['Гипсокартон Knauf 2500х1200х12,5 мм', 'Гипсокартон Волма 2500х1200х12,5 мм'],
  ['Техноэласт ЭПП Технониколь 4mm', 'Изопласт ЭПП 4,0 мм'],
  ['Ротационный лазерный нивелир RGK sp-610G', 'RGK Лазерный нивелир SP-100 4610011871399'],
  ['AMO LN 4D-360 Green лазерный уровень', 'LT Профессиональный Лазерный уровень 3D-А12 + Т1000 L12-360A/1м'],
  ['Блок ISTKULT 625X250X200 ММ B5,0 D600 56', 'Блок газобетонный стеновой D600 (625*200*250)'],
  ['Блок газобетонный стеновой D500 (600*250*200)', 'Блок газобетонный стеновой D600 (625*200*250)'],
  ['Диск отрезной по металлу "Karbosan" (230х2,5х22)', '758230252 1 Диск отрезной 41 230x2,5x22,23 WA36 RBF 2в1 TSR Standard'],
  ['Светильник подвесной LED Chronos Retail Emergency (ВАР) CRI 90, 15 W', 'Светильник подвесной LED Chronos Retail CRI 90, 15 W'],
  ['Краска пиканте стоп KM0 рал 7037 (Грунтовка)', 'Краска пиканте стоп KM0 рал 7037'],
  ['Шайба плоская DIN 125 нерж А2 М10', 'Шайба DIN 125 оцинкованная М10'],
  ['Арм. Пруток МД 36х11700 А500С ГОСТ 34028-2016', 'Арматура А500С Ø20 (11,7м ГОСТ 34028)']
];
different.forEach(([a, b]) => assert.equal(same(a, b), false, `farklı ürün sayılmalı: ${a} ⟷ ${b}`));
console.log(`✓ ${different.length} farklı marka/model/varyant çifti ayrıldı`);

// Aynı ürünün farklı yazımları: kıyaslanmaya devam etmeli
const equal: Array<[string, string]> = [
  ['Гипсокартон Knauf 2500х1200х12,5 мм влагостойкий', 'КНАУФ Гипсокартон влагостойкий 2500*1200*12,5мм'],
  ['ПЕНОПЛЭКС ГЕО С 1185х585х100 Т-15 (0,2772)', 'ЭП Пеноплэкс Гео С 100х1185х585 мм 0,2772 м3'],
  ['Комплектная трансформаторная подстанция КТПТО - 80-У1', 'Трансформаторная подстанция КТПТО-80-11 У1'],
  ['Перчатка термоусаживаемая 5ТПИнг-70/120 КВТ', 'КВТ Термо изолирован ная перчатка 5ТПИнг 70 на 120 70094'],
  ['Электроды Рутил 3,25х350 (упаковка 3,2 кг) "Askaynak" AS R-143 TR', 'Электроды AS R-143 3,2/350 (3,2 кг)'],
  ['Арм. Пруток МД 12х11700 А500С ГОСТ 34028-2016', 'Арматура ребристая Q12 mm (A500C)'],
  ['Колодка штепсельная каучук_3-гн. с крышками с/з 16А', 'Колодка однофазная каучуковая три гнезда с крышкой, с заземлением, 220-250В, 16А, IP54'],
  ['Масло для опалубки', 'Масло опалубочное']
];
equal.forEach(([a, b]) => assert.equal(same(a, b), true, `aynı ürün sayılmalı: ${a} ⟷ ${b}`));
console.log(`✓ ${equal.length} aynı ürün yazımı birlikte kaldı`);

// Kümeleme: aynı katalog grubundaki iki marka ayrı kümelere düşer
const rows = [
  { originalName: 'Гипсокартон Knauf 12,5 мм', unitPrice: 300 },
  { originalName: 'Гипсокартон Волма 12,5 мм', unitPrice: 200 },
  { originalName: 'КНАУФ Гипсокартон 12,5мм', unitPrice: 330 }
];
const clusters = clusterSameProductRows(rows, 'Alçıpan Levha 12.5 mm', 'Yalıtım & Alçıpan');
assert.deepEqual(clusters.map(c => c.length), [2, 1]);
console.log('✓ Knauf ve Volma satırları ayrı kümelere ayrıldı');

// Uçtan uca: marka farkı alarm üretmez, aynı markanın kendi içindeki farkı üretir
const comp: any = {
  id: 'gkl',
  materialName: 'Alçıpan Levha 12.5 mm',
  category: 'Yalıtım & Alçıpan',
  unit: 'm2',
  minUnitPrice: 200,
  maxUnitPrice: 330,
  avgUnitPrice: 276,
  priceDifferencePercentage: 65,
  history: [
    { date: '2026-08-01', supplier: 'Petrovich', unitPrice: 300, quantity: 400, invoiceNumber: 'A1', originalName: 'Гипсокартон Knauf 12,5 мм', jobsiteName: 'Şantiye 1' },
    { date: '2026-08-05', supplier: 'Tradmi', unitPrice: 200, quantity: 400, invoiceNumber: 'B1', originalName: 'Гипсокартон Волма 12,5 мм', jobsiteName: 'Şantiye 2' },
    { date: '2026-09-01', supplier: 'Petrovich', unitPrice: 330, quantity: 400, invoiceNumber: 'A2', originalName: 'КНАУФ Гипсокартон 12,5мм', jobsiteName: 'Şantiye 1' }
  ]
};
const alerts = buildSameMaterialPriceAlerts([comp], { language: 'TR', getMarketCluster: () => 'GENERAL' });
assert.ok(alerts.length > 0, 'Knauf kendi içindeki %10 artış alarm olmalı');
alerts.forEach(a => {
  assert.equal(a.minUnitPrice, 300, 'Volma (200 ₽) kıyasa girmemeli');
  assert.equal(a.percentageChange, 10);
  assert.ok(!/Tradmi/.test(a.vendorName), 'Volma tedarikçisi alarmda görünmemeli');
});
console.log(`✓ Uçtan uca: ${alerts.length} alarm, hepsi yalnızca Knauf satırlarından`);

// Önem eşiği: 10.000 ₽ altı fiyat farkı küçük sayılır, diğer alarm tipleri etkilenmez
assert.equal(isMinorPriceAlert({ type: 'JOBSITE_PRICE_GAP', financialImpact: 9999 }), true);
assert.equal(isMinorPriceAlert({ type: 'SAME_VENDOR_INFLATION', financialImpact: 12000 }), false);
assert.equal(isMinorPriceAlert({ type: 'BASKET_SHRINKAGE', financialImpact: 100 }), false);
console.log('✓ Küçük fiyat farkı eşiği doğru');

// KDV tabanı: fatura toplamıyla doğrulanmış iki satır arasındaki 1,22x fark gerçek zamdır (УВМ-СТАЛЬ 65.500 → 80.000 ₽/t),
// doğrulanmamış satırlarda aynı oran KDV karışıklığı sayılıp alarm üretilmez
const rebarComp = (verified: boolean): any => ({
  id: 'a500c_12',
  materialName: 'A500C İnşaat Demiri Ø12 (11.7m GOST 34028)',
  category: 'Demir & Çelik',
  unit: 'Ton',
  history: [
    { date: '2026-08-05', supplier: 'УВМ-СТАЛЬ', unitPrice: 80000, unitPriceNet: 65573.77, quantity: 52, invoiceNumber: 'КА-65342', originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', jobsiteName: 'Şantiye 1', vatBasisVerified: verified },
    { date: '2026-09-28', supplier: 'УВМ-СТАЛЬ', unitPrice: 65500, unitPriceNet: 53688.52, quantity: 81, invoiceNumber: '77855', originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)', jobsiteName: 'Şantiye 2', vatBasisVerified: verified }
  ]
});
const verifiedGap = buildSameMaterialPriceAlerts([rebarComp(true)], { language: 'TR', getMarketCluster: () => 'STEEL_REBAR' });
assert.ok(verifiedGap.some(a => a.type === 'JOBSITE_PRICE_GAP' && a.minUnitPrice === 65500 && a.maxUnitPrice === 80000), 'doğrulanmış 1,22x fark alarm olmalı');
const gapRow = verifiedGap.find(a => a.type === 'JOBSITE_PRICE_GAP')!;
assert.equal(gapRow.historyRows?.find(r => r.unitPrice === 80000)?.netUnitPrice, 65573.77, 'alarm satırı neti de taşımalı');
const unverifiedGap = buildSameMaterialPriceAlerts([rebarComp(false)], { language: 'TR', getMarketCluster: () => 'STEEL_REBAR' });
assert.equal(unverifiedGap.filter(a => a.type === 'JOBSITE_PRICE_GAP').length, 0, 'doğrulanmamış 1,22x fark KDV karışıklığı sayılmalı');
console.log('✓ KDV tabanı doğrulaması: gerçek %22 fark alarm, doğrulanmamış oran bastırıldı');

console.log('=== ALL SAME-MATERIAL GUARD TESTS PASSED ===');
