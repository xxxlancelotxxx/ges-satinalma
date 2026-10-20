import assert from 'node:assert';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { registerTdfRoutes, offerFromExtracted, sanitizeAiReview, buildTdfHistory, applyAiMatch } from './tdfService';
import { localTermsFromText } from '../src/utils/tdfTerms';
import { computeTdf, supplierKeyOf, TdfOffer } from '../src/utils/tdfEngine';
import { rebarForm } from '../tests/tdfFixture';

console.log('--- TDF sunucu modülü ---');

// 1) OCR çıktısını TDF teklifine çevirme
const extracted = {
  supplier: 'ООО «ТД «ТУЛА-СТАЛЬ»', taxId: '7105504223', invoiceNumber: 'ВЕ.П-40060021', date: '14.10.2026', currency: 'RUB',
  totalAmount: 1541000 + 12000, excludedFreightGrossAmount: 12000,
  items: [
    { originalName: 'Арм. Ø8 А500С', materialName: 'Armatür Ø8 A500C', unit: 'Ton', quantity: 28, unitPrice: 54000, grossUnitPrice: 54000, unitPriceNet: 44262.3, totalPrice: 1512000, vatPercentage: 22 },
    { originalName: 'Арм. Ø8 А240С L=6 м', unit: 'Ton', quantity: 0.5, unitPrice: 58000, grossUnitPrice: 58000, totalPrice: 29000, brand: 'Тула' }
  ]
};
const o1 = offerFromExtracted(extracted, {
  payment: '30 дн. от даты отгрузки', delivery: 'до 31.10.2026', deliveryPlace: 'не указано', validity: '',
  conflicts: { payment: 'Spesifikasyonda 45 gün yazıyor.' }, lineDelivery: [{ name: 'Арм. Ø8 А240С L=6 м', delivery: 'по заявке' }], notes: ['Ağırlık toleransı ±5%']
}, { fileName: 'tula.pdf', nowIso: '2026-10-19T10:00:00Z' });
assert.strictEqual(o1.supplier, 'ООО «ТД «ТУЛА-СТАЛЬ»');
assert.strictEqual(o1.docDate, '2026-10-14');
assert.strictEqual(o1.lines.length, 2);
assert.strictEqual(o1.lines[0].unitPrice, 54000, 'KDV dahil birim fiyat kullanılmalı');
assert.strictEqual(o1.lines[1].deliveryNote, 'по заявке');
assert.strictEqual(o1.lines[1].brand, 'Тула');
assert.strictEqual(o1.terms.payment.value, 'Vadeli 30 gün', 'ödeme yapılandırılmış metne çevrilir');
assert.strictEqual(o1.terms.payment.mode, 'deferred');
assert.strictEqual(o1.terms.payment.num, 30);
assert.strictEqual(o1.terms.payment.raw, '30 дн. от даты отгрузки', 'belgedeki ifade saklanır');
assert.strictEqual(o1.terms.delivery.value, 'до 31.10.2026', 'tarihli teslim metin olarak kalır');
assert.strictEqual(o1.terms.payment.source, 'offer');
assert.strictEqual(o1.terms.payment.conflict, 'Spesifikasyonda 45 gün yazıyor.');
assert.strictEqual(o1.terms.deliveryPlace.value, '', '"не указано" boş sayılmalı');
assert.strictEqual(o1.freightAmount, 12000);
assert.ok(!o1.readWarnings!.some(w => w.includes('tutmuyor')), 'nakliye düşülünce toplam tutmalı');
assert.ok(o1.readWarnings!.includes('Ağırlık toleransı ±5%'));
const o2 = offerFromExtracted({ supplier: 'X', totalAmount: 1000, items: [{ originalName: 'Болт', unit: 'шт', quantity: 10, unitPrice: 50 }] }, null, { nowIso: 'x', termsError: 'zaman aşımı' });
assert.ok(o2.readWarnings!.some(w => w.includes('tutmuyor')), 'toplam tutmazsa uyarı');
assert.ok(o2.readWarnings!.some(w => w.includes('Ticari şartlar otomatik okunamadı')));
// yapay zekânın yapılandırılmış alanları
const o3 = offerFromExtracted({ supplier: 'ООО "РОКА"', items: [{ originalName: 'Фанера', unit: 'лист', quantity: 10, unitPrice: 1000 }] }, {
  payment: '50% предоплата, 50% по факту', paymentMode: 'advance', advancePercent: 50, inStock: true, delivery: 'в наличии',
  deliveryPlace: 'самовывоз со склада', deliveryPlaceType: 'factory', validity: '5 банковских дней', validityDays: 5
}, { nowIso: 'x' });
assert.strictEqual(o3.terms.payment.value, 'Avans %50');
assert.strictEqual(o3.terms.delivery.value, 'Stokta');
assert.strictEqual(o3.terms.deliveryPlace.value, 'Fabrika / depo teslim');
assert.strictEqual(o3.terms.validity.value, '5 iş günü');
assert.ok(!('installation' in o3.terms), 'montaj şartlardan çıkarıldı');
// yapay zekâ yokken belge metninden okuma
const invoiceText = `Счет на оплату № 4744 от 16 октября 2026 г.\nПоставщик: ООО "ТРЕЙДМИ"\nФанера ФСФ 18 мм 1525х1525 сорт 2/2 шт 44 1 200,00\nСчет действителен в течение 3 банковских дней.\nОплата данного счета означает согласие с условиями поставки товара.\nДоставка до объекта включена в стоимость.`;
const local = localTermsFromText(invoiceText);
assert.ok(local.validity && /3 банковских/.test(local.validity), JSON.stringify(local));
assert.ok(local.deliveryPlace && /Доставка до объекта/.test(local.deliveryPlace));
assert.ok(!local.payment, '"оплата данного счета означает согласие" ödeme şartı sayılmaz');
const o4 = offerFromExtracted({ supplier: 'ООО "ТРЕЙДМИ"', items: [] }, local, { nowIso: 'x', termsError: 'Gemini aylık harcama limiti dolmuş', termsFromText: true, localItems: true });
assert.strictEqual(o4.terms.validity.value, '3 iş günü');
assert.strictEqual(o4.terms.deliveryPlace.value, 'Şantiye teslim');
assert.strictEqual(o4.readWarnings!.filter(w => /yapay zekâ/i.test(w)).length, 1, 'yapay zekâ kesintisi tek uyarı');
assert.ok(o4.readWarnings!.some(w => w.includes('Belgeden kalem okunamadı')));
assert.ok(o4.readWarnings![0].startsWith('Yapay zekâ kullanılamadı: Gemini aylık harcama limiti dolmuş.') && o4.readWarnings![0].includes('Kalemler ve şartlar belge metninden okundu'), o4.readWarnings![0]);
assert.ok(!o4.readWarnings!.some(w => /\{"error"/.test(w)));
console.log('✓ OCR çıktısı → teklif (KDV dahil fiyat, yapılandırılmış şartlar, belge metninden okuma, uyarılar)');

// 1b) Yapay zekâ eşleştirmesi: aynı ürün tek satır, güvenlik kuralları
{
  const mk = (id: string, supplier: string, lines: Array<[string, string, number]>) => ({ id, supplier, terms: {} as any, lines: lines.map(([lid, name, price]) => ({ id: lid, name, unit: 'шт', quantity: 44, unitPrice: price })) });
  const f: any = { id: 'f', code: 'T', title: 'Фанера', status: 'draft', createdAt: '', updatedAt: '', offers: [
    mk('a', 'ООО "ТРЕЙДМИ"', [['a1', 'Фанера ФСФ ламинированная 18мм', 1200], ['a2', 'Брус 50х50', 300]]),
    mk('b', 'ООО "РОКА"', [['b1', 'Ламфанера березовая Россия 18 мм F/W', 1250], ['b2', 'Фанера ФК 21 мм', 1500]])
  ] };
  applyAiMatch(f, { groups: [{ lineIds: ['a1', 'b1'], name: 'Фанера ламинированная ФСФ 18 мм' }, { lineIds: ['a2', 'b2', 'a1'] }] }, '2026-10-20T07:00:00Z');
  assert.strictEqual(f.aiGroups.a1, f.aiGroups.b1, 'yapay zekânın eşlediği iki satır aynı grup');
  assert.ok(!f.aiGroups.a2 && !f.aiGroups.b2, 'aynı firmanın iki satırını içeren grup uygulanmaz');
  const cc = computeTdf(f, '2026-10-20');
  const row = cc.materials.find(m => m.match === 'ai')!;
  assert.ok(row, 'yapay zekâ satırı');
  assert.strictEqual(row.name, 'Фанера ламинированная ФСФ 18 мм');
  assert.strictEqual(row.offerCount, 2);
  // teknik farklı satırları yapay zekâ birleştirse bile reddedilir
  const f2: any = JSON.parse(JSON.stringify(f));
  applyAiMatch(f2, { groups: [{ lineIds: ['a1', 'b2'] }] }, 'x');
  assert.ok(!f2.aiGroups.a1, '18 mm ile 21 mm birleştirilmez');
  // elle ayrılan satıra dokunulmaz
  const f3: any = JSON.parse(JSON.stringify(f));
  f3.materialOverrides = { b1: 'ayri:b1' };
  applyAiMatch(f3, { groups: [{ lineIds: ['a1', 'b1'] }] }, 'x');
  assert.ok(!f3.aiGroups.b1);
}
console.log('✓ yapay zekâ eşleştirmesi (tek satır, aynı firma / teknik fark / elle ayırma korunuyor)');

// 2) Yapay zekâ çıktısı temizliği: kaynaksız firma riski gösterilmez
const base = rebarForm();
const comp = computeTdf(base, '2026-10-19');
const bmzKey = supplierKeyOf({ supplier: 'ООО «Торговый дом БМЗ»' } as TdfOffer);
const rev = sanitizeAiReview({
  summary: 'ТД БМЗ öne çıkıyor.',
  qualityNotes: { 'Арм. Ø10 А500С': 'ГОСТ 34028-2016.' },
  extraWarnings: [{ level: 'bogus', text: 'Sertifika yok' }, { level: 'critical', text: '' }],
  vendorChecks: { 'ТД БМЗ': { status: 'faaliyette', risk: 'düşük', sources: [] }, 'ЕВРАЗ МАРКЕТ': { status: 'faaliyette', risk: 'düşük', sources: ['https://www.rusprofile.ru/id/1'] } }
}, base, comp, 'm', '2026-10-19T10:00:00Z');
assert.strictEqual(rev.extraWarnings!.length, 1);
assert.strictEqual(rev.extraWarnings![0].level, 'info');
assert.strictEqual(rev.vendorChecks![bmzKey].risk, 'bilinmiyor', 'kaynaksız risk yazılmaz');
assert.strictEqual(rev.vendorChecks![supplierKeyOf({ supplier: 'АО «ЕВРАЗ МАРКЕТ»' } as TdfOffer)].risk, 'düşük');
assert.ok(Object.keys(rev.qualityNotes!).some(k => comp.materials.some(m => m.key === k)), 'kalite notu malzeme anahtarına bağlanmalı');
console.log('✓ yapay zekâ çıktısı temizleniyor (kaynaksız risk yok)');

// 3) Fatura arşivinden son alış ve firma geçmişi
const hist = buildTdfHistory(base, comp, [
  { supplier: 'ООО "Торговый дом БМЗ"', date: '2026-08-02', totalAmount: 1000000, items: [{ originalName: 'Арматура 12 мм А500С', unit: 'т', unitPrice: 65573.77, vatPercentage: 22 }] },
  { supplier: 'ООО "ГК АТМОС"', date: '2026-09-01', totalAmount: 500, items: [{ originalName: 'Арм. Ø12 А500С', unit: 'кг', unitPrice: 50, vatPercentage: 22 }] },
  { supplier: 'X', date: '2026-09-02', isDeleted: true, items: [{ originalName: 'Арм. Ø12 А500С', unit: 'т', unitPrice: 1 }] }
], '2026-10-19T10:00:00Z');
assert.strictEqual(hist.vendors[bmzKey].invoiceCount, 1);
const d12 = comp.materials.find(m => m.name.includes('Ø12'))!.key;
assert.strictEqual(hist.lastPrices[d12].date, '2026-09-01', 'en yeni alış');
assert.strictEqual(hist.lastPrices[d12].unitPrice, 61000, 'kg fiyatı t\'ye çevrilip KDV eklenmeli (50 × 1,22 × 1000)');
console.log('✓ son alış fiyatı ve firma geçmişi');

// 4) Rotalar (sahte okuma ve yapay zekâ ile, Firestore yok)
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tdf-test-'));
  const fixtureOffers = new Map(base.offers.map(o => [`${o.id}.pdf`, o]));
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  let reviewCalls = 0;
  let matchCalls = 0;
  registerTdfRoutes(app, {
    getDb: () => null,
    backupFile: path.join(tmp, 'tdf_forms.json'),
    now: () => new Date('2026-10-19T10:00:00Z'),
    log: { log: () => {}, warn: () => {} },
    getInvoices: async () => [{ supplier: 'ООО "УВМ-СТАЛЬ"', date: '2026-07-10', totalAmount: 250000, items: [] }],
    readOffer: async (input) => {
      await new Promise(r => setTimeout(r, Math.random() * 30));
      const o = fixtureOffers.get(input.fileName || '');
      if (!o) throw new Error('okunamadı');
      const { id: _id, ...rest } = JSON.parse(JSON.stringify(o));
      return rest;
    },
    aiReview: async () => {
      reviewCalls++;
      if (reviewCalls === 1) throw new Error('{"error":{"code":429,"message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend","status":"RESOURCE_EXHAUSTED"}}');
      return { generatedAt: '2026-10-19T10:00:00Z', summary: 'Özet', qualityNotes: {}, materialInsights: {}, extraWarnings: [{ level: 'warning', text: 'Sertifika istenmeli (yapay zekâ)', action: 'ГОСТ 34028 sertifikası' }], vendorChecks: {}, sources: [] };
    },
    aiMatch: async () => { matchCalls++; return { groups: [] }; }
  });
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const api = async (method: string, url: string, body?: any) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  try {
    const created = await api('POST', '/api/tdf', { title: 'Арматура А500С', jobsiteName: 'VEER UB10' });
    assert.strictEqual(created.status, 200);
    const id = created.data.form.id;
    assert.strictEqual(created.data.form.code, 'TDF-2026-0001');

    // altı dosya aynı anda: hiçbiri kaybolmamalı
    const ups = await Promise.all([...fixtureOffers.keys()].map(fn => api('POST', `/api/tdf/${id}/offers`, { fileBase64: 'JVBERi0=', mimeType: 'application/pdf', fileName: fn, fileUrl: `/api/files/${fn}` })));
    ups.forEach(u => assert.strictEqual(u.status, 200, JSON.stringify(u.data).slice(0, 200)));
    const bad = await api('POST', `/api/tdf/${id}/offers`, { fileBase64: 'x', fileName: 'yok.pdf' });
    assert.strictEqual(bad.status, 422);
    let g = await api('GET', `/api/tdf/${id}`);
    assert.strictEqual(g.data.form.offers.length, 6, 'eşzamanlı yüklemede teklif kaybı olmamalı');
    assert.strictEqual(Math.round(g.data.computed.recommendation.planTotal), 77731927);
    assert.ok(g.data.form.offers.every((o: any) => o.fileUrl.startsWith('/api/files/')));
    const uvmKey = supplierKeyOf({ supplier: 'ООО «УВМ-СТАЛЬ»' } as TdfOffer);
    assert.strictEqual(g.data.form.history.vendors[uvmKey].invoiceCount, 1, 'firma geçmişi doldu');

    // kutu düzenleme ve satınalmacı notu
    const evraz = g.data.form.offers.find((o: any) => o.supplier.includes('ЕВРАЗ'));
    const terms = { ...evraz.terms, payment: { value: 'Avans %100', mode: 'advance', num: 100, source: 'user' } };
    let p = await api('PUT', `/api/tdf/${id}`, { offers: [{ id: evraz.id, terms, note: 'Telefonda ödeme teyit edildi.', supplier: 'HACK', createdAt: 'x' }], recommendationNote: 'BMZ ile devam.' });
    assert.strictEqual(p.status, 200);
    const ev2 = p.data.form.offers.find((o: any) => o.id === evraz.id);
    assert.strictEqual(ev2.terms.payment.value, 'Avans %100');
    assert.strictEqual(ev2.note, 'Telefonda ödeme teyit edildi.');
    assert.strictEqual(ev2.createdAt, evraz.createdAt, 'izin verilmeyen alan değişmemeli');
    assert.ok(!p.data.computed.warnings.some((w: any) => w.text.startsWith('HACK') && w.text.includes('ödeme şartı')));

    // yapay zekâ değerlendirmesi
    assert.ok(matchCalls >= 5, 'iki firmadan sonra her yüklemede eşleştirme çalışır');
    const aiFail = await api('POST', `/api/tdf/${id}/ai-review`);
    assert.strictEqual(aiFail.status, 502);
    assert.ok(/harcama limiti/.test(aiFail.data.error) && !/\{"error"/.test(aiFail.data.error), aiFail.data.error);
    const ai = await api('POST', `/api/tdf/${id}/ai-review`);
    assert.strictEqual(ai.status, 200);
    assert.strictEqual(reviewCalls, 2);
    const am = await api('POST', `/api/tdf/${id}/ai-match`);
    assert.strictEqual(am.status, 200);
    assert.ok(am.data.form.aiMatchedAt);
    assert.ok(ai.data.computed.warnings.some((w: any) => w.text.includes('(yapay zekâ)')));

    // Excel
    const x = await api('GET', `/api/tdf/${id}/export?format=xlsx`);
    assert.strictEqual(x.status, 200);
    assert.ok(String(x.headers.get('content-disposition')).includes('TDF-2026-0001'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.data as Buffer);
    assert.deepStrictEqual(wb.worksheets.map(w => w.name), ['TDF', 'Miktar · Заказ', 'İndirim takibi', 'Teklif belgeleri']);
    const ws = wb.getWorksheet('TDF')!;
    let totalRow = 0, matRow = 0, freightRow = 0;
    ws.eachRow((row, n) => {
      const v = String(row.getCell(1).value || '');
      if (v.startsWith('GENEL TOPLAM')) totalRow = n;
      if (v.startsWith('Malzeme toplamı')) matRow = n;
      if (v.startsWith('Nakliye') && !freightRow) freightRow = n;
    });
    assert.ok(totalRow > 0 && matRow > 0 && freightRow > 0, 'malzeme, nakliye ve genel toplam satırları');
    const totals: number[] = [];
    for (let k = 0; k < 5; k++) {
      const v: any = ws.getRow(matRow).getCell(4 + 3 * k).value; totals.push(Math.round(v.result)); assert.ok(String(v.formula).startsWith('SUBTOTAL'));
      const g: any = ws.getRow(totalRow).getCell(4 + 3 * k).value; assert.ok(String(g.formula).includes(`${matRow}+IF(ISNUMBER(`), g.formula);
    }
    assert.ok(totals.includes(77704677) && totals.includes(78150641), totals.join(','));
    let noteFound = false, recoFound = false, warnFound = false;
    ws.eachRow(row => row.eachCell(c => {
      const v = String(c.value ?? '');
      if (v.includes('Telefonda ödeme teyit edildi.')) noteFound = true;
      if (v.startsWith('13 kalem ТД БМЗ')) recoFound = true;
      if (v === 'KRİTİK') warnFound = true;
    }));
    assert.ok(noteFound && recoFound && warnFound, `not ${noteFound} öneri ${recoFound} uyarı ${warnFound}`);

    // HTML
    const h = await api('GET', `/api/tdf/${id}/export?format=html`);
    assert.strictEqual(h.status, 200);
    const html = (h.data as Buffer).toString('utf8');
    assert.ok(html.includes('Telefonda ödeme teyit edildi.') && html.includes('BMZ ile devam.') && html.includes('77 731 927'));
    assert.ok(!/<script/i.test(html), 'HTML çıktısında script yok');

    // teklif silme, form silme, liste
    p = await api('DELETE', `/api/tdf/${id}/offers/${evraz.id}`);
    assert.strictEqual(p.data.form.offers.length, 5);
    const l1 = await api('GET', '/api/tdf');
    assert.strictEqual(l1.data.length, 1);
    assert.strictEqual(l1.data[0].offerCount, 5);
    const second = await api('POST', '/api/tdf', { title: 'Beton' });
    assert.strictEqual(second.data.form.code, 'TDF-2026-0002');
    await api('DELETE', `/api/tdf/${second.data.form.id}`);
    const l2 = await api('GET', '/api/tdf');
    assert.strictEqual(l2.data.length, 1, 'silinen form listede yok');
    assert.strictEqual((await api('GET', `/api/tdf/${second.data.form.id}`)).status, 404);
    const backup = JSON.parse(fs.readFileSync(path.join(tmp, 'tdf_forms.json'), 'utf8'));
    assert.strictEqual(backup.length, 2, 'yerel yedek iki formu da tutar (biri silinmiş işaretli)');
    console.log('✓ rotalar: oluştur, eşzamanlı yükleme, düzenle, yapay zekâ, Excel, HTML, sil');
    console.log('TDF sunucu testleri geçti.');
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
