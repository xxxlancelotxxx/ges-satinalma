/**
 * Şef indirim / TDF teklif merkezi ve Hızlı Onay Öncesi Fiyat Denetimi fiyat hataları için regresyon testleri.
 * Gerçek belge: ООО "САМ" Счет на оплату № 25400 от 19.10.2026 (tests/fixtures/sam-25400-invoice.txt).
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { extractDocumentHeaderDate, extractContractDates } from '../src/utils/invoiceLineParser';
import { matchLines, lineSimilarity } from '../src/utils/invoiceLineMatcher';
import { buildDiscountLineComparisons } from '../src/utils/discountLineReference';
import { calculateMatchScore } from '../src/utils/comparativeCalculation';
import { auditEntireInvoice } from '../src/utils/preApprovalAuditEngine';
import { fallbackExtractInvoiceFromTextOrCsv } from './aiTwoStageOcr';
import { readVerifiedDocument, planDiscountRepair, VerifiedDocument } from './discountLineRepair';

const text = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/sam-25400-invoice.txt'), 'utf-8');
let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log('İndirim / ön onay fiyat düzeltmeleri');

// ---------------------------------------------------------------------------------------------
test('belge tarihi başlıktan okunur, sözleşme tarihi (02.02.2023) belge tarihi sayılmaz', () => {
  assert.strictEqual(extractDocumentHeaderDate(text), '2026-10-19');
  assert.deepStrictEqual(extractContractDates(text), ['2023-02-02']);
  const fb = fallbackExtractInvoiceFromTextOrCsv(text, '234.pdf', false);
  assert.strictEqual(fb.date.value, '2026-10-19');
  assert.strictEqual(fb.invoiceNumber.value, '25400');
});

const finalDoc = readVerifiedDocument(text);
test('fatura satırları belgeden kuruşu kuruşuna doğrulanır', () => {
  assert.ok(finalDoc, 'belge doğrulanmalı');
  assert.strictEqual(finalDoc!.lines.length, 6);
  assert.strictEqual(finalDoc!.total, 257460.98);
  assert.deepStrictEqual(finalDoc!.lines.map(l => l.price), [137.16, 663.04, 967.2, 3057.76, 1117.5, 1040]);
});

// Aynı tedarikçinin ilk teklifi: farklı satır sırası, iki kalemde daha yüksek fiyat (140,40 ve 673,40).
const finalLines = finalDoc!.lines.map(l => ({ originalName: l.name, article: l.article }));
const initialOrder = [1, 0, 3, 2, 5, 4];
const initialPrices: Record<number, number> = { 0: 140.4, 1: 673.4 };
const initialDoc: VerifiedDocument = {
  ...finalDoc!,
  lines: initialOrder.map((i, k) => {
    const l = finalDoc!.lines[i];
    const price = initialPrices[i] ?? l.price;
    const amount = Math.round(price * l.quantity * 100) / 100;
    return { ...l, no: k + 1, price, amount, grossAmount: amount, netAmount: Math.round((amount / 1.22) * 100) / 100 };
  }),
  total: 261683.94
};

test('eski eşleştirici tüm "Genel Malzeme" kalemlerini tek satıra bağlıyordu (hatanın kanıtı)', () => {
  const picks = finalDoc!.lines.map(f => {
    let best = -1;
    let bi = -1;
    initialDoc.lines.forEach((c, j) => {
      const sc = calculateMatchScore({ description: f.name }, { description: c.name }).score;
      if (sc > best) { best = sc; bi = j; }
    });
    return bi;
  });
  assert.ok(new Set(picks).size < 4, `eski yöntem çoğu kalemi aynı satıra bağlar: ${picks}`);
});

test('yeni eşleştirici her kalemi ilk teklifteki kendi satırına bire bir bağlar', () => {
  const map = matchLines(finalLines, initialDoc.lines.map(l => ({ originalName: l.name, article: l.article })));
  map.forEach((m, i) => assert.strictEqual(initialOrder[m], i, `kalem ${i + 1}`));
  // Farklı ürünler asla eşleşmez
  assert.strictEqual(lineSimilarity({ originalName: finalDoc!.lines[2].name }, { originalName: finalDoc!.lines[3].name }), 0);
  // Ölçü farkı (70 mm ↔ 100 mm) eşleşmeyi engeller
  assert.strictEqual(lineSimilarity({ originalName: 'Маяки реперные Rocks 70 мм 50 шт.' }, { originalName: 'Маяки реперные Rocks 100 мм 50 шт.' }), 0);
});

// Ekran görüntüsündeki kayıt: eski kanonik referanslar (1. satır 140,40; diğerleri yanlışlıkla 673,40)
const screenshotDiscount = {
  id: 'disc_25400',
  vendorName: 'ООО "САМ"',
  invoiceNo: '25400',
  orderDate: '2023-02-02',
  offerPrice: 261683.94,
  agreedPrice: 257460.98,
  calculationMethod: 'MARKET_BASELINE_TO_FINAL',
  category: 'Sarf Malzeme & Hırdavat',
  items: finalDoc!.lines.map(l => ({ materialName: l.name, originalName: l.name, quantity: l.quantity, unit: 'Adet', unitPrice: l.price, totalPrice: l.amount })),
  canonicalMaterials: finalDoc!.lines.map((l, i) => ({
    id: `can_mat_${i + 1}`,
    commonName: l.name,
    purchasedUnitPrice: l.price,
    marketReferenceUnitPrice: i === 0 ? 140.4 : 673.4,
    marketReferenceSupplier: 'ООО "САМ"'
  }))
};

test('detay ekranı eski kayıttaki yanlış referansları göstermez (673,40 artık her satırda görünmez)', () => {
  const rows = buildDiscountLineComparisons(screenshotDiscount as any);
  assert.strictEqual(rows[0].hasReference, true);
  assert.strictEqual(rows[0].refPrice, 140.4);
  for (const r of rows.slice(1)) {
    assert.strictEqual(r.hasReference, false);
    assert.strictEqual(r.totalSavings, 0);
  }
  // Anlaşılan birim her zaman faturadaki gerçek fiyattır
  assert.deepStrictEqual(rows.map(r => r.finalPrice), [137.16, 663.04, 967.2, 3057.76, 1117.5, 1040]);
});

test('detay ekranı başka bir analizin kalemlerini bu kayda bağlamaz', () => {
  const foreign = { id: 'cmp_other', canonicalMaterials: [{ commonName: 'Арматура А500С 12мм', marketReferenceUnitPrice: 50000, lineMatchVersion: 2 }] };
  const rows = buildDiscountLineComparisons({ ...screenshotDiscount, canonicalMaterials: [] } as any, foreign as any);
  assert.ok(rows.every(r => !r.hasReference));
});

const plan = planDiscountRepair(screenshotDiscount, finalDoc, [{ doc: initialDoc, supplier: 'ООО "САМ"' }]);
test('onarım: tarih 2023-02-02 → 2026-10-19 ve kalem referansları belgeden yeniden kurulur', () => {
  assert.ok(plan.changed);
  assert.strictEqual(plan.discountUpdate.orderDate, '2026-10-19');
  assert.strictEqual(plan.invoiceUpdate.date, '2026-10-19');
  const refs = plan.discountUpdate.canonicalMaterials.map((c: any) => c.marketReferenceUnitPrice);
  assert.deepStrictEqual(refs, [140.4, 673.4, 967.2, 3057.76, 1117.5, 1040]);
  assert.ok(plan.discountUpdate.canonicalMaterials.every((c: any) => c.lineMatchVersion === 2 && c.referenceFound === true));
  // Tutarlar zaten doğru: dokunulmaz
  assert.strictEqual(plan.discountUpdate.agreedPrice, undefined);
  assert.strictEqual(plan.discountUpdate.offerPrice, undefined);
  const rows = buildDiscountLineComparisons({ ...screenshotDiscount, ...plan.discountUpdate } as any);
  const total = rows.reduce((s, r) => s + r.totalSavings, 0);
  assert.strictEqual(Math.round(total * 100) / 100, 4222.96);
});

test('onarım: yanlış okunmuş birim fiyat belgedeki fiyatla düzeltilir', () => {
  const misread = { ...screenshotDiscount, orderDate: '2026-10-19', canonicalMaterials: [], items: screenshotDiscount.items.map((it, i) => i === 2 ? { ...it, unitPrice: 976.2, totalPrice: 3904.8 } : it) };
  const p = planDiscountRepair(misread, finalDoc, []);
  assert.ok(p.changed);
  assert.strictEqual(p.discountUpdate.items[2].unitPrice, 967.2);
  assert.strictEqual(p.discountUpdate.items[2].lineVerified, true);
  assert.strictEqual(p.discountUpdate.orderDate, undefined);
});

test('onarım: belgeler doğrulanamazsa yalnızca bilinen hata imzalı referanslar kaldırılır', () => {
  const p = planDiscountRepair(screenshotDiscount, null, []);
  assert.ok(p.changed);
  const c = p.discountUpdate.canonicalMaterials;
  assert.strictEqual(c[0].referenceFound, undefined);
  assert.ok(c.slice(1).every((x: any) => x.referenceFound === false));
});

test('onarım: doğru kayıt ikinci kez değiştirilmez', () => {
  const repaired = { ...screenshotDiscount, ...plan.discountUpdate };
  const again = planDiscountRepair(repaired, finalDoc, [{ doc: initialDoc, supplier: 'ООО "САМ"' }]);
  assert.strictEqual(again.changed, false, again.notes.join(' | '));
});

// ---------------------------------------------------------------------------------------------
// Hızlı Onay Öncesi Fiyat Denetimi
const draft = {
  invoiceNumber: '25400',
  supplier: 'ООО "САМ"',
  totalAmount: 257460.98,
  items: finalDoc!.lines.map(l => ({
    materialName: l.name, originalName: l.name, unit: 'adet', quantity: l.quantity,
    unitPrice: l.price, totalPrice: l.amount, unitPriceNet: Math.round((l.price / 1.22) * 100) / 100, vatPercentage: 22,
    currency: 'RUB', lineVerified: true
  }))
};
const histInvoice = (over: any, itemOver: any = {}) => ({
  id: 'inv_hist', invoiceNumber: '777', supplier: 'ООО "ДРУГОЙ"', date: '2026-09-01', isDeleted: false, totalAmount: 0,
  items: [{
    materialName: finalDoc!.lines[1].name, originalName: finalDoc!.lines[1].name, unit: 'adet', quantity: 100,
    // Arşivde net saklanan kalem: unitPrice = net, unitPriceNet = net, KDV %22
    unitPrice: 543.48, unitPriceNet: 543.48, vatPercentage: 22, totalPrice: 54348, ...itemOver
  }],
  ...over
});

test('denetim: arşivdeki net fiyat KDV dahil tabana çekilir, sahte %22 fark çıkmaz', () => {
  const s = auditEntireInvoice(draft as any, [histInvoice({}) as any]);
  const line = s.lineResults[1];
  assert.ok(line.hasHistoricalMatch, 'aynı kalem bulunmalı');
  assert.strictEqual(line.minHistoricalPrice, 663.05);
  assert.ok(Math.abs(line.percentagePriceDiff) < 0.1, `fark ~0 olmalı: ${line.percentagePriceDiff}`);
  assert.strictEqual(line.potentialSavings, 0);
});

test('denetim: kalemleri fatura toplamını tutmayan arşiv faturası referans olmaz', () => {
  const s = auditEntireInvoice(draft as any, [histInvoice({ linesReconciled: false }, { unitPrice: 300, unitPriceNet: 300, totalPrice: 30000 }) as any]);
  assert.strictEqual(s.lineResults[1].hasHistoricalMatch, false);
});

test('denetim: kendi içinde tutarsız arşiv satırı (miktar × fiyat ≠ tutar) referans olmaz', () => {
  const s = auditEntireInvoice(draft as any, [histInvoice({}, { unitPrice: 300, unitPriceNet: 300, totalPrice: 54348 }) as any]);
  assert.strictEqual(s.lineResults[1].hasHistoricalMatch, false);
});

test('denetim: denetlenen faturanın arşivdeki kopyası kendisiyle kıyaslanmaz', () => {
  const s = auditEntireInvoice(draft as any, [histInvoice({ invoiceNumber: '25400', supplier: 'ООО "САМ"' }, { unitPrice: 600, unitPriceNet: 491.8, totalPrice: 60000 }) as any]);
  assert.strictEqual(s.lineResults[1].hasHistoricalMatch, false);
});

test('denetim: belgeyle doğrulanamayan taslak satırında fiyat farkı iddia edilmez', () => {
  const unverified = { ...draft, items: draft.items.map((it, i) => i === 1 ? { ...it, unitPrice: 763.04, lineVerified: false } : it) };
  const s = auditEntireInvoice(unverified as any, [histInvoice({}) as any]);
  const line = s.lineResults[1];
  assert.strictEqual(line.status, 'DÜŞÜK GÜVENLİ EŞLEŞME');
  assert.strictEqual(line.potentialSavings, 0);
  assert.strictEqual(line.isCheaperPastPurchaseAvailable, false);
});

test('denetim: gerçek fiyat artışı hâlâ yakalanır', () => {
  const s = auditEntireInvoice(draft as any, [histInvoice({}, { unitPrice: 491.8, unitPriceNet: 491.8, totalPrice: 49180 }) as any]);
  const line = s.lineResults[1];
  assert.ok(line.isCheaperPastPurchaseAvailable);
  assert.strictEqual(line.minHistoricalPrice, 600);
  assert.strictEqual(line.potentialSavings, Math.round((663.04 - 600) * 250));
});

console.log(`\n${passed} test geçti.`);
