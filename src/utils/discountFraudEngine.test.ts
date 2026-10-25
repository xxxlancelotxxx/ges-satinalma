import assert from 'node:assert/strict';
import { analyzeDiscountFraudPortfolio, analyzeDraftDiscountFraud } from './discountFraudEngine';

console.log('=== AKILLI İNDİRİM HİLE DENETİMİ TESTLERİ ===');

const base = (over: any) => ({
  status: 'Onaylandı',
  supervisorId: 'sup_1',
  supervisorName: 'Şef A',
  jobsiteId: 'job_1',
  jobsiteName: 'Şantiye',
  category: 'Kaba İnşaat',
  isDeleted: false,
  ...over
});

const hose = 'Рукав антистатический для воды и воздуха «STAVRO-AS», вн. диам. 19мм';
const glue = 'Клей плиточный Ceresit CM 11 Plus 25 кг';

const invoice = (id: string, supplier: string, date: string, no: string, name: string, qty: number, price: number, extra: any = {}) => ({
  id,
  supplier,
  date,
  invoiceNumber: no,
  totalAmount: qty * price,
  isDeleted: false,
  items: [{ originalName: name, materialName: name, quantity: qty, unit: 'Adet', unitPrice: price, totalPrice: qty * price }],
  ...extra
});

// 2) Şişirilmiş ilk teklif: aynı tedarikçi 2 hafta önce 400 ₽'ye satmış, ilk teklif 560, son 400 → kritik
const history = [
  invoice('prizma_1', 'ООО "ТРЕЙДМИ"', '2026-09-01', 'P-1', glue, 100, 400, { sourceCollection: 'prizma_invoices' }),
  invoice('inv_2', 'ООО "СТРОЙ"', '2026-09-05', 'G-2', glue, 50, 410)
];
const inflated = base({
  id: 'disc_inflated',
  vendorName: 'ООО "ТРЕЙДМИ"',
  invoiceNo: '5001',
  orderDate: '2026-09-15',
  created_at: '2026-09-15T10:00:00Z',
  offerPrice: 56000,
  agreedPrice: 40000,
  discountAmount: 16000,
  items: [{ originalName: glue, materialName: glue, quantity: 100, unit: 'Adet', unitPrice: 400, totalPrice: 40000 }]
});
let res = analyzeDiscountFraudPortfolio([inflated] as any, history as any);
let rep = res.byId.get('disc_inflated')!;
const inf = rep.findings.find(f => f.code === 'INFLATED_FIRST_OFFER');
assert.ok(inf, 'şişirilmiş ilk teklif bulunmalı');
assert.equal(inf!.severity, 'CRITICAL');
assert.equal(rep.riskLevel, 'CRITICAL');
assert.equal(inf!.impactRub, 16000);
console.log('✓ şişirilmiş ilk teklif (tedarikçinin kendi eski fiyatı) kritik');

// 3) Gerçek indirim: geçmiş 400, ilk teklif 420, son 360 → bulgu yok
const genuine = base({ ...inflated, id: 'disc_genuine', offerPrice: 42000, agreedPrice: 36000, discountAmount: 6000,
  items: [{ originalName: glue, materialName: glue, quantity: 100, unit: 'Adet', unitPrice: 360, totalPrice: 36000 }] });
res = analyzeDiscountFraudPortfolio([genuine] as any, history as any);
assert.equal(res.byId.get('disc_genuine')!.riskLevel, 'CLEAN');
console.log('✓ geçmiş fiyatın altına inen gerçek indirim temiz');

// 4) Sonraki alım, farklı malzeme ve eski (pencere dışı) fiyat referans olmaz
const misleading = [
  invoice('inv_late', 'ООО "ТРЕЙДМИ"', '2026-10-01', 'L-1', glue, 100, 300),
  invoice('inv_other', 'ООО "СТРОЙ"', '2026-09-05', 'O-1', 'Клей плиточный Ceresit CM 17 25 кг', 100, 300),
  invoice('inv_old', 'ООО "ТРЕЙДМИ"', '2026-01-10', 'X-1', glue, 100, 300)
];
res = analyzeDiscountFraudPortfolio([inflated] as any, misleading as any);
assert.equal(res.byId.get('disc_inflated')!.findings.filter(f => f.code === 'INFLATED_FIRST_OFFER' || f.code === 'PHANTOM_SAVINGS').length, 0);
console.log('✓ sonraki alım / farklı model / eski fiyat ile iddia yok');

// 5) Tek başka firma alımı "normal fiyat" kanıtı sayılmaz
res = analyzeDiscountFraudPortfolio([inflated] as any, [history[1]] as any);
assert.equal(res.byId.get('disc_inflated')!.findings.filter(f => f.code === 'INFLATED_FIRST_OFFER').length, 0);
console.log('✓ tek bir başka firma fiyatıyla şişirme iddiası yok');

// 6) Hayali indirim (çok kalemli, ilk teklif satırı bilinmiyor): ödenen fiyat geçmişle aynı
const tile = 'Плитка керамогранит Estima Standard ST01 600x600x10 мм';
const multiHistory = [
  ...history,
  invoice('prizma_3', 'ООО "ТРЕЙДМИ"', '2026-09-02', 'P-3', tile, 200, 900, { sourceCollection: 'prizma_invoices' })
];
const phantom = base({
  id: 'disc_phantom',
  vendorName: 'ООО "ТРЕЙДМИ"',
  invoiceNo: '5002',
  orderDate: '2026-09-20',
  created_at: '2026-09-20T10:00:00Z',
  offerPrice: 250000,
  agreedPrice: 220000,
  discountAmount: 30000,
  items: [
    { originalName: glue, materialName: glue, quantity: 100, unit: 'Adet', unitPrice: 400, totalPrice: 40000 },
    { originalName: tile, materialName: tile, quantity: 200, unit: 'Adet', unitPrice: 900, totalPrice: 180000 }
  ]
});
res = analyzeDiscountFraudPortfolio([phantom] as any, multiHistory as any);
rep = res.byId.get('disc_phantom')!;
const ph = rep.findings.find(f => f.code === 'PHANTOM_SAVINGS');
assert.ok(ph, 'hayali indirim bulunmalı');
assert.equal(rep.verifiedRealSaving, 0);
assert.equal(ph!.impactRub, 30000);
console.log('✓ hayali indirim: beyan 30.000 ₽, gerçek tasarruf 0');

// 7) Aynı fatura iki kez + ikiz kayıt + aynı belge iki aşamada
const first = base({ id: 'disc_a', vendorName: 'ООО "ТРЕЙДМИ"', invoiceNo: '4497', orderDate: '2026-09-30', created_at: '2026-10-05T08:11:00Z',
  offerPrice: 146396, agreedPrice: 145000, discountAmount: 1396,
  items: [{ originalName: hose, materialName: hose, quantity: 200, unit: 'm', unitPrice: 725, totalPrice: 145000 }],
  firstOfferFileName: 'Счет 4497 от 30.09.2026.pdf', finalOfferFileName: 'Счет 4497 от 30.09.2026 (1).pdf' });
const twin = { ...first, id: 'disc_b', invoiceNo: '4498', created_at: '2026-10-05T08:13:00Z',
  firstOfferFileName: 'Счет 4498 от 30.09.2026.pdf', finalOfferFileName: 'Счет 4498 от 30.09.2026 (1).pdf' };
const dupInvoice = { ...first, id: 'disc_c', created_at: '2026-10-06T08:00:00Z', firstOfferFileName: 'x1234567.pdf', finalOfferFileName: 'y7654321.pdf' };
const sameDoc = base({ id: 'disc_d', vendorName: 'ООО "ТД ТУЛА-СТАЛЬ"', invoiceNo: 'СБ.П-42450015', orderDate: '2026-09-30', created_at: '2026-10-02T07:38:00Z',
  offerPrice: 13495000, agreedPrice: 12685000, discountAmount: 810000, items: [],
  firstOfferFileName: 'Спецификация СБ.П-42450015 от 30.09.2026.pdf', finalOfferFileName: 'Спецификация СБ.П-42450015 от 30.09.2026.pdf' });
res = analyzeDiscountFraudPortfolio([first, twin, dupInvoice, sameDoc] as any, []);
assert.ok(res.byId.get('disc_c')!.findings.some(f => f.code === 'DUPLICATE_INVOICE' && f.severity === 'CRITICAL'), 'aynı fatura iki kez');
assert.equal(res.byId.get('disc_a')!.findings.length, 0, 'ilk kayıt asıl kayıttır');
// Berkant: aynı gün giriş, aynı sepetli farklı fatura ve iki aşamada aynı dosya normal iş akışıdır
assert.equal(res.byId.get('disc_b')!.riskLevel, 'CLEAN', 'aynı gün farklı fatura normal');
assert.equal(res.byId.get('disc_d')!.riskLevel, 'CLEAN', 'aynı dosya tek başına şüphe değil');
console.log('✓ mükerrer fatura yakalandı; aynı gün / aynı dosya normal sayıldı');

// 8) Aynı fiyata tekrar indirim: geçen ay indirimle 400'e alınmış, bu ay yine 400'e indirim beyanı
const prevSync = invoice('inv_sync_disc_prev', 'ООО "ТРЕЙДМИ"', '2026-08-20', '4100', glue, 100, 400, { discountId: 'disc_prev' });
const nails = 'Гвоздь строительный 2,5х60 мм (фасовка по 5 кг)';
const repeat = base({ ...inflated, id: 'disc_repeat', invoiceNo: '5100', orderDate: '2026-09-18', offerPrice: 52000, agreedPrice: 45000, discountAmount: 7000,
  items: [
    { originalName: glue, materialName: glue, quantity: 100, unit: 'Adet', unitPrice: 400, totalPrice: 40000 },
    { originalName: nails, materialName: nails, quantity: 10, unit: 'Adet', unitPrice: 500, totalPrice: 5000 }
  ] });
res = analyzeDiscountFraudPortfolio([repeat] as any, [prevSync] as any);
const rp = res.byId.get('disc_repeat')!.findings.find(f => f.code === 'REPEAT_DISCOUNT_SAME_PRICE');
assert.ok(rp && rp.impactRub === 7000, 'aynı fiyata tekrar indirim');
console.log('✓ aynı fiyata tekrar indirim yakalandı');

// 9) Faturada ödenen tutar = ilk teklif → indirim faturaya yansımamış
const paidFull = base({ id: 'disc_f', vendorName: 'ООО "ТРЕЙДМИ"', invoiceNo: '9001', orderDate: '2026-09-10', created_at: '2026-09-12T00:00:00Z',
  offerPrice: 100000, agreedPrice: 90000, discountAmount: 10000, items: [] });
const prizmaInv = invoice('prizma_9', 'ТРЕЙДМИ ООО', '2026-09-10', '9001', glue, 250, 400, { sourceCollection: 'prizma_invoices' });
res = analyzeDiscountFraudPortfolio([paidFull] as any, [prizmaInv] as any);
const itm = res.byId.get('disc_f')!.findings.find(f => f.code === 'INVOICE_TOTAL_MISMATCH');
assert.ok(itm && itm.severity === 'CRITICAL' && itm.impactRub === 10000);
// Fatura beyanı tutuyorsa sorun yok
const okInv = { ...prizmaInv, totalAmount: 90000 };
res = analyzeDiscountFraudPortfolio([paidFull] as any, [okInv] as any);
assert.equal(res.byId.get('disc_f')!.riskLevel, 'CLEAN');
console.log('✓ faturaya yansımayan indirim yakalandı, tutan fatura temiz');

// 10) Giriş anında taslak denetimi: aynı fatura daha önce indirimli girilmiş
const draft = analyzeDraftDiscountFraud({ ...first, id: undefined, created_at: undefined } as any, [first] as any, []);
assert.ok(draft.findings.some(f => f.code === 'DUPLICATE_INVOICE'));
console.log('✓ giriş anında mükerrer indirim uyarısı');

console.log('=== TÜM HİLE DENETİMİ TESTLERİ GEÇTİ ===');
