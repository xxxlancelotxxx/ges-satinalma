import assert from 'node:assert/strict';
import { isSameMaterialLine, convertUnitPriceStrict, isExactUnitConversion } from './sameMaterialMatcher';
import {
  findCheaperHistoricalBenchmarksForItems,
  scanDiscountRecordsForHistoricalAnomalies,
  auditSingleLineItem
} from './preApprovalAuditEngine';
import { buildSameMaterialPriceAlerts } from './priceAnomalyEngine';

console.log('=== ORTAK AYNI MALZEME EŞLEŞTİRİCİ TESTLERİ ===');

const same = (a: string, b: string) => isSameMaterialLine({ originalName: a }, { originalName: b }).same;

// Gerçek fatura satırlarından: farklı malzeme / farklı özellik asla kıyaslanmaz
const different: Array<[string, string]> = [
  ['Скотч малярный 50 мм х 50 м "S"', 'Скотч прозрачный 50 мм х 50 м'],
  ['Скотч прозрачный 50 мм х 50 м', 'Скотч прозрачный 50 мм х 100 м'],
  ['Муфта D14 d=28 мм', 'Муфта стандартная d=28 мм'],
  ['Болт М16', 'Болт 16 х 140'],
  ['Гипсокартон Knauf 2500х1200х12,5 мм', 'Гипсокартон Волма 2500х1200х12,5 мм'],
  ['Арматура А500С Ø12 (11,7м ГОСТ 34028)', 'Арматура А500С Ø16 (11,7м ГОСТ 34028)'],
  ['Арматура А500С Ø12 (11,7м ГОСТ 34028)', 'Арм. Пруток МД 12х11700 А240С ГОСТ 34028-2016'],
  ['01-14Г Доска обрезная ЕВ 50*100*6000 (сорт-1, ГОСТ) 33шт. в 1м.куб', 'Профилированная доска ГОСТ 50х100х6000 1 куб 33 шт'],
  ['Каркас арматур. Кр-1', 'Каркас арматур. Кр-1'],
  ['Герметик для фасадов и крыш гибридный Axton 280 мл белый', 'Герметик силиконовый универсальный КМ бесцветный 280 мл'],
  ['Гвоздь строительный 2,5х60 мм (фасовка по 5 кг)', 'Гвоздь строительный 2,5х60 мм (фасовка по 25 кг)'],
  ['Пленка укрывная техническая 3х100м (300м2) 100 мкр, рулон', 'Пленка укрывная техническая 3х100м (300м2) 200 мкр, рулон']
];
different.forEach(([a, b]) => assert.equal(same(a, b), false, `farklı malzeme sayılmalı: ${a} ⟷ ${b}`));
console.log(`✓ ${different.length} farklı malzeme/özellik çifti kıyaslanmadı`);

// Aynı malzemenin farklı yazımları (stok kodu, satır no, boy, tedarikçi yazımı) kıyaslanır
const equal: Array<[string, string]> = [
  ['0000068540 0 Дверь межкомнатная ДПГ 900х2000 мм финишпленка белая глухая с замком', 'Дверь межкомнатная ДПГ 900х2000 мм финишпленка белая глухая с замком'],
  ['3217 Пила дисковая DEVON 3217, 185 мм, 1300 Вт', 'Пила дисковая DEVON 3217, 185 мм, 1300 Вт'],
  ['8 Нож строительный со сменным лезвием 18 мм. SAMTOOLS "S"', 'Нож строительный со сменным лезвием 18 мм. SAMTOOLS "S"'],
  ['Сталь углеродистая для армирования железобетонных конструкций периодического профиля d 12 мм; А500С', 'Арм. Пруток МД 12х11700 А500С ГОСТ 34028-2016'],
  ['Арматура А500С Ø12 (11,7м ГОСТ 34028)', 'Арматура ребристая Q12 mm (A500C)'],
  ['Труба профильная 40х40х2 дл.6000', 'Труба профильная 40х40х2.0'],
  ['Хим анкер SORMAT ITH 585 EPOXЕ 450 мл', 'SORMAT Анкер химический ITH 585 EPOXЕ 450 мл 9640072945 в наличии в наличии'],
  ['Гипсокартон Knauf 2500х1200х12,5 мм влагостойкий', 'ГКЛ Knauf 2500х1200х12,5мм влагостойкий'],
  ['Ручка дверная для замка 2014/2018 круглая розетка хром (680206) Счет № ММЭ00184265 от 05 августа 2026 г. Страница 2', 'Ручка дверная для замка 2014/2018 круглая розетка хром (680206)']
];
equal.forEach(([a, b]) => assert.equal(same(a, b), true, `aynı malzeme sayılmalı: ${a} ⟷ ${b}`));
console.log(`✓ ${equal.length} aynı malzeme yazımı eşleşti`);

// Birim: yalnızca aynı birim veya kesin metrik ölçek
assert.equal(convertUnitPriceStrict(60000, 'т', 'kg'), 60);
assert.equal(convertUnitPriceStrict(60, 'кг', 'Ton'), 60000);
assert.equal(convertUnitPriceStrict(350, 'шт', 'лист'), 350);
assert.equal(convertUnitPriceStrict(15790, 'm³', 'шт'), null);
assert.equal(convertUnitPriceStrict(5000, 'm³', 'ton'), null);
assert.equal(isExactUnitConversion({ conversionApplied: true, conversionFormula: 'Yoğunluk: 1 m³ ≈ 2.4 ton' }), false);
assert.equal(isExactUnitConversion({ conversionApplied: true, conversionFormula: '1 Ambalaj/Adet = 25 kg' }), true);
assert.equal(isExactUnitConversion({ conversionApplied: false, conversionFormula: 'Fiziksel boyut uyuşmazlığı (ton -> palet)', unit: 'Palet', originalUnit: 'ton' }), false);
console.log('✓ Birim dönüşümü yalnızca kesin ölçekle yapılıyor (tahmini dönüşümle fiyat türetilmiyor)');

// ---------------------------------------------------------------------------
// Ön onay / indirim ön denetimi: gerçek geçmiş alım kuralları
// ---------------------------------------------------------------------------
const rebarLine = (price: number, qty = 10) => ({
  originalName: 'Арматура А500С Ø12 (11,7м ГОСТ 34028)',
  materialName: 'A500C İnşaat Demiri Ø12',
  unit: 'т',
  quantity: qty,
  unitPrice: price,
  totalPrice: price * qty
});
const inv = (id: string, no: string, supplier: string, date: string, items: any[], extra: any = {}) => ({
  id, invoiceNumber: no, supplier, date, jobsiteId: 'job_1', jobsiteName: 'Şantiye 1',
  totalAmount: items.reduce((s, it) => s + it.totalPrice, 0), items, ...extra
});

const history: any[] = [
  inv('h1', 'A-100', 'ООО "Сталь"', '2026-09-01', [rebarLine(60000)]),
  // Kıyaslanan kayıttan SONRA yapılmış daha ucuz alım: "daha önce alınmış" sayılmaz
  inv('h2', 'A-200', 'ООО "Сталь"', '2026-10-20', [rebarLine(40000)]),
  // Kalemleri fatura belgesiyle doğrulanamamış fatura referans olamaz
  inv('h3', 'A-300', 'ООО "Металл"', '2026-08-01', [rebarLine(45000)], { lineCheck: { status: 'mismatch' } }),
  // İndirim kopyası: kalemler fatura toplamını vermiyor (ilk teklif fiyatları) → referans değil
  inv('inv_sync_disc_x', 'B-1', 'ООО "Металл"', '2026-08-02', [rebarLine(46000)], { totalAmount: 300000 }),
  // Farklı çap
  inv('h4', 'A-400', 'ООО "Металл"', '2026-08-03', [{ ...rebarLine(30000), originalName: 'Арматура А500С Ø16 (11,7м ГОСТ 34028)' }]),
  // Birim/okuma hatası: ton satırına kg fiyatı yazılmış (oran > 3)
  inv('h5', 'A-500', 'ООО "Металл"', '2026-08-04', [rebarLine(52)]),
  // Farklı birim, tahmin gerektiren dönüşüm (m³)
  inv('h6', 'A-600', 'ООО "Металл"', '2026-08-05', [{ ...rebarLine(9000), unit: 'm³' }])
];

const draftDate = '2026-10-01';
const cheaper = findCheaperHistoricalBenchmarksForItems([rebarLine(70000)], { supplier: 'ООО "Новый"', orderDate: draftDate, invoiceNo: 'N-1' }, history);
assert.equal(cheaper.length, 1);
assert.equal(cheaper[0].historicalBestUnitPrice, 60000, 'yalnızca önceki, doğrulanmış, aynı malzeme ve aynı birimdeki gerçek fiyat');
assert.equal(cheaper[0].historicalInvoiceNo, 'A-100');
assert.equal(cheaper[0].historicalPurchasesCount, 1);
console.log('✓ Sonraki alım, doğrulanmamış fatura, ilk teklif kopyası, farklı çap, okuma hatası ve tahmini birim dışarıda');

// kg cinsinden yeni satır, ton geçmişiyle kesin ölçekle kıyaslanır
const kgCheck = findCheaperHistoricalBenchmarksForItems([{ ...rebarLine(70, 1000), unit: 'кг' }], { orderDate: draftDate }, history);
assert.equal(kgCheck.length, 1);
assert.equal(kgCheck[0].historicalBestUnitPrice, 60);
console.log('✓ kg ⟷ ton kesin ölçekle kıyaslandı (60.000 ₽/t = 60 ₽/kg)');

// Aynı alımın kopyası (aynı tedarikçi, aynı gün, aynı miktar) kendisiyle kıyaslanmaz
const copyCheck = findCheaperHistoricalBenchmarksForItems([rebarLine(65000)], { supplier: 'ООО "Сталь"', orderDate: '2026-09-01' }, history);
assert.equal(copyCheck.length, 0);
console.log('✓ Aynı faturanın GES/Prizma kopyası referans alınmadı');

// Ön onay paneli: daha ucuz olmasa da geçmiş gösterilir; sonraki alım listelenmez
const line = auditSingleLineItem({ ...rebarLine(59000), currency: 'RUB', supplier: 'ООО "Новый"' } as any, 0, history as any, { draftDate });
assert.equal(line.hasHistoricalMatch, true);
assert.deepEqual(line.allHistoricalMatches.map(m => m.invoiceNumber), ['A-100']);
assert.equal(line.status, 'ONAYLANABİLİR');
console.log('✓ Ön onay: geçmiş alım gösterildi, fiyat uyumlu → ONAYLANABİLİR');

// Yönetici denetimi: indirim kaydının kalemleri anlaşılan tutarı vermiyorsa (ilk teklif fiyatları) iddia yok
const discountWithOfferLines: any = {
  id: 'd1', invoiceNo: 'Z-1', vendorName: 'ООО "Новый"', orderDate: draftDate,
  offerPrice: 700000, agreedPrice: 600000, items: [rebarLine(70000)]
};
assert.equal(scanDiscountRecordsForHistoricalAnomalies([discountWithOfferLines], history as any).length, 0);
const discountPaid: any = { ...discountWithOfferLines, id: 'd2', agreedPrice: 700000 };
assert.equal(scanDiscountRecordsForHistoricalAnomalies([discountPaid], history as any).length, 1);
console.log('✓ Yönetici denetimi yalnızca gerçekten ödenen fiyatlar için fark gösteriyor');

// ---------------------------------------------------------------------------
// Anomali paneli: tahmini dönüşüm ve mükerrer kopya satırları fiyat farkı üretmez
// ---------------------------------------------------------------------------
const row = (name: string, price: number, extra: any = {}) => ({
  originalName: name, unitPrice: price, normalizedUnitPrice: price, quantity: 100, unit: 'Adet', originalUnit: 'Adet',
  supplier: 'ООО "А"', jobsiteName: 'Ş1', date: '2026-09-01', invoiceNumber: `F-${price}`, ...extra
});
const comp: any = {
  id: 'c1', materialName: 'Alçıpan', category: 'Yalıtım & Alçıpan', standardUnit: 'Adet',
  history: [
    row('Гипсокартон Knauf 2500х1200х12,5 мм', 300),
    row('Гипсокартон Knauf 2500х1200х12,5 мм', 900, { conversionApplied: true, conversionFormula: 'Yoğunluk: 1 m³ ≈ 2.4 ton' }),
    row('Гипсокартон Knauf 2500х1200х12,5 мм', 300, { supplier: 'ООО "А" (Prizma ERP)' }),
    row('Гипсокартон Волма 2500х1200х12,5 мм', 200, { supplier: 'ООО "Б"' })
  ]
};
const alerts = buildSameMaterialPriceAlerts([comp], { language: 'TR', getMarketCluster: () => 'GENERAL' });
assert.equal(alerts.length, 0, 'marka farkı, tahmini dönüşüm ve mükerrer kopya alarm üretmemeli');
comp.history.push(row('КНАУФ Гипсокартон 2500х1200х12,5 мм', 345, { supplier: 'ООО "В"', date: '2026-09-10' }));
const alerts2 = buildSameMaterialPriceAlerts([comp], { language: 'TR', getMarketCluster: () => 'GENERAL' });
assert.equal(alerts2.length, 1);
assert.equal(alerts2[0].previousPrice, 300);
assert.equal(alerts2[0].currentPrice, 345);
console.log('✓ Anomali paneli yalnızca aynı malzemenin gerçek kayıtlı fiyatlarını kıyaslıyor');

console.log('>>> ORTAK AYNI MALZEME EŞLEŞTİRİCİ TESTLERİ GEÇTİ <<<');
