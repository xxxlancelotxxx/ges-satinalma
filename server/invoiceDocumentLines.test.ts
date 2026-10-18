import assert from 'node:assert/strict';
import { parseInvoiceText, verifyParsedInvoice, mapDocumentUnit } from '../src/utils/invoiceLineParser';
import { readInvoiceDocumentText, buildLineCheck } from './invoiceDocumentLines';
import { getMaterialBenchmarkUnit, convertMaterialUnit } from '../src/utils/constructionUnitConverter';

// 1C "Счет на оплату" düzeni (Fatura 20560, STF.013158'in pdf-parse metin çıktısıyla aynı biçim):
// çok satırlı isimler, artikel kodları, birimi boş satır (10), sayfa sonu ve tekrar eden başlık.
const SCHET_VAT_INCLUDED = `Счет на оплату № 20560 от 27 августа 2026 г.
Поставщик: ООО "САМ"
№ Фото Артикул Товары (работы, услуги) Количество Цена Ставка
НДС Сумма НДС Сумма
1 Картинка	SR-08234114
Уровень алюминиевый магнитный 600 мм
УСМ-0,5-600, фрезер, 3 глазка, рукоятки Сибртех
34114 6 шт 700,83 22% 758,28 4 204,98
2
Уровень алюминиевый УСМ-0,5-2000,
фрезерованный, 3 глазка, магнитный, рукоятки, 2000
мм Сибртех 2 шт 1 532,00 22% 552,52 3 064,00
3
Саморез кровельный цинк, с шайбой EPDM, PT-3,
4,8х25 К КРЕП-КОМП Средняя фасовка (300шт) 15 упак 387,45 22% 1 048,02 5 811,75
4
Клапан огнепреградительный КОК-Р кислородный (в
разрыв рукава) 10 590,00 22% 1 063,93 5 900,00
5 SR-091РПГР50
Рукав пожарный для ПК Ду50мм в сборе с ГР-50 (1,0
МПа) 20 м 15 шт 1 425,00 22% 3 854,51 21 375,00

-- 1 of 2 --

№ Фото Артикул Товары (работы, услуги) Количество Цена Ставка
НДС Сумма НДС Сумма
6
SR-091РНГР80(1
,0)
Рукав пожарный напорный 80 мм. с головками (20м.)
(1,0 МПа) 10 шт 3 687,00 22% 6 648,69 36 870,00
7
SR-023ХЧ0812-2
5 Хомут червячный 8-12 мм. (уп.25шт.) 2 упак 195,00 22% 70,33 390,00
8 SR-043000520TN
Очиститель монтажной пены Технониколь Master
520/300 мл 20 шт 146,25 22% 527,46 2 925,00
Итого: 80 540,73
В т.ч. НДС (22%): 14 523,62
Итого с НДС: 80 540,73
Всего наименований 8, на сумму 80 540,73 RUB`;

const doc1 = parseInvoiceText(SCHET_VAT_INCLUDED);
assert.equal(doc1.lines.length, 8);
assert.equal(doc1.pricesIncludeVat, true);
assert.equal(doc1.declaredLineCount, 8);
assert.deepEqual(doc1.lines.map(l => [l.quantity, l.unitRaw, l.price, l.amount]), [
  [6, 'шт', 700.83, 4204.98],
  [2, 'шт', 1532, 3064],
  [15, 'упак', 387.45, 5811.75],
  [10, '', 590, 5900],          // birim sütunu boş: "10 590,00" 10590 sanılmamalı
  [15, 'шт', 1425, 21375],
  [10, 'шт', 3687, 36870],
  [2, 'упак', 195, 390],
  [20, 'шт', 146.25, 2925]
]);
assert.equal(doc1.lines[4].name, 'Рукав пожарный для ПК Ду50мм в сборе с ГР-50 (1,0 МПа) 20 м');
assert.equal(doc1.lines[4].article, 'SR-091РПГР50');
assert.equal(doc1.lines[5].name, 'Рукав пожарный напорный 80 мм. с головками (20м.) (1,0 МПа)');
assert.equal(doc1.lines[6].name, 'Хомут червячный 8-12 мм. (уп.25шт.)');
assert.equal(doc1.lines[0].name, 'Уровень алюминиевый магнитный 600 мм УСМ-0,5-600, фрезер, 3 глазка, рукоятки Сибртех 34114');
assert.equal(verifyParsedInvoice(doc1, 80540.73).verified, true);

// Fatura tutarı tutmuyorsa (Prizma tutarı farklı) belge kabul edilmez, tahmin yapılmaz
const wrongTotal = verifyParsedInvoice(doc1, 83472.46);
assert.equal(wrongTotal.verified, false);
assert.equal(wrongTotal.diff, 2931.73);

// Kalem sayısı belgedekiyle tutmuyorsa (okunamayan satır) reddedilir
assert.equal(verifyParsedInvoice(parseInvoiceText(SCHET_VAT_INCLUDED.replace('Всего наименований 8', 'Всего наименований 9')), 80540.73).verified, false);

// Kalemler belgeden kurulur: KDV dahil fiyat belgedeki gibi, KDV hariç fiyat %22'den türetilir
const built = readInvoiceDocumentText(SCHET_VAT_INCLUDED, { invoiceTotal: 80540.73, docYear: '2026', stfItems: [
  { originalName: 'Рукав пожарный для ПК Ду50мм в сборе с ГР-50 (1,0 МПа) 20 м', materialCode: '150.01.013.02.0999' }
] });
assert.equal(built.verified, true);
const hose = built.items!.find(it => /Ду50/.test(it.originalName))!;
assert.equal(hose.quantity, 15);
assert.equal(hose.unit, 'ADET');
assert.equal(hose.grossUnitPrice, 1425);
assert.equal(hose.unitPriceNet, 1168.03);
assert.equal(hose.grossTotalPrice, 21375);
assert.equal(hose.vatPercentage, 22);
assert.equal(hose.lineSource, 'invoice_pdf');
assert.equal(hose.materialCode, '150.01.013.02.0999');
const screws = built.items!.find(it => /4,8х25/.test(it.originalName))!;
assert.deepEqual([screws.quantity, screws.unit, screws.grossUnitPrice], [15, 'PAKET', 387.45]);
const sumGross = built.items!.reduce((s, it) => s + it.grossTotalPrice, 0);
assert.ok(Math.abs(sumGross - 80540.73) < 0.01);
assert.equal(buildLineCheck({ items: built.items!, freightGross: 0, invoiceTotal: 80540.73, source: 'invoice_pdf' }).diff, 0);

// KDV hariç fiyatlı düzen (KDV sütunu yok; "Итого / НДС / Всего к оплате") ve açık nakliye satırı
const SCHET_NET = `Счет на оплату № 777 от 1 сентября 2026 г.
№ Товары (работы, услуги) Кол-во Ед. Цена Сумма
1 Арматура А500С 12 мм 2 т 60 000,00 120 000,00
2 Доставка автотранспортом 1 рейс 5 000,00 5 000,00
Итого: 125 000,00
НДС (22%): 27 500,00
Всего к оплате: 152 500,00
Всего наименований 2, на сумму 152 500,00 руб.`;
const doc2 = parseInvoiceText(SCHET_NET);
assert.equal(doc2.pricesIncludeVat, false);
assert.equal(verifyParsedInvoice(doc2, 152500).verified, true);
const built2 = readInvoiceDocumentText(SCHET_NET, { invoiceTotal: 152500, docYear: '2026' });
assert.equal(built2.items!.length, 1);
assert.deepEqual([built2.items![0].unit, built2.items![0].unitPriceNet, built2.items![0].grossUnitPrice], ['TON', 60000, 73200]);
assert.deepEqual([built2.freightNet, built2.freightGross], [5000, 6100]);

// STF satırları fatura tutarını tutmuyorsa fark "nakliye" yapılmaz, fatura doğrulanmadı işaretlenir
const stfCheck = buildLineCheck({
  items: [{ grossTotalPrice: 161760.79 }], freightGross: 0, invoiceTotal: 164692.52, source: 'stf_order'
});
assert.equal(stfCheck.status, 'mismatch');
assert.equal(stfCheck.diff, 2931.73);

assert.equal(mapDocumentUnit('шт'), 'ADET');
assert.equal(mapDocumentUnit('м'), 'MT');
assert.equal(mapDocumentUnit('упак'), 'PAKET');

// Yangın hortumu (20 m set) her zaman adet başına kıyaslanır
const hoseName = 'Yangın Hortumu DN50 (Рукав пожарный Ду50, 20 m, 1.0 MPa) [Seri: В сборе с ГР]';
assert.equal(getMaterialBenchmarkUnit(hoseName, 'Mekanik & Tesisat', ['MT', 'ADET']), 'adet');
assert.equal(getMaterialBenchmarkUnit(hoseName, 'Mekanik & Tesisat', ['MT']), 'adet');
// Prizma'da "10 MT" girilmiş ama fiyat 1 set fiyatı (1320 ₽): metreyle çarpılmaz, 10 adet set sayılır
const conv = convertMaterialUnit({ materialName: hoseName, rawItemName: 'Рукав пожарный для ПК Ду50мм в сборе с ГР-50 (1,0 МПа)', fromUnit: 'MT', toUnit: 'adet', unitPrice: 1320, quantity: 10 });
assert.deepEqual([conv.convertedUnitPrice, conv.convertedQuantity], [1320, 10]);

console.log('invoiceDocumentLines.test.ts: tüm testler geçti');
