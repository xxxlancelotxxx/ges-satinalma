/**
 * Berkant'ın gönderdiği UB10 armatür TDF'inden (2026-10-14/15 teklifleri) türetilmiş örnek form.
 * Motor, Excel ve HTML testleri bu veriyi kullanır.
 */
import rows from './tdfRebarData.json';
import { emptyTerms, TdfForm, TdfOffer, TdfTermKey } from '../src/utils/tdfEngine';

type Row = [string, number, Record<string, number | null>, Record<string, number | null>, Record<string, string>, Record<string, number | null>];
const DATA = rows as unknown as Row[];

const SUPPLIERS: Array<{ k: string; name: string; inn?: string; doc?: string; date: string; terms: Partial<Record<TdfTermKey, string>>; conflict?: string; note?: string }> = [
  { k: 'bmz', name: 'ООО «Торговый дом БМЗ»', inn: '3245005110', doc: 'NU-3315', date: '2026-10-15', terms: { payment: '30 дн. от даты отгрузки', delivery: 'в наличии; Ø18 в пути, 26.10', validity: '5 дней' }, conflict: 'TDF\'de 30 gün, faturada 45 gün yazıyor.', note: 'Ø18 yolda, 26.10 gelir.' },
  { k: 'tula', name: 'ООО «ТД «ТУЛА-СТАЛЬ»', inn: '7105504223', doc: 'ВЕ.П-40060021', date: '2026-10-14', terms: { payment: '30 дн. от даты отгрузки', delivery: 'до 31.10.2026', deliveryPlace: 'доставка поставщиком на объект UB10' }, note: 'Ağırlık toleransı ±5%.' },
  { k: 'evraz', name: 'АО «ЕВРАЗ МАРКЕТ»', date: '2026-10-14', terms: { delivery: 'по заявке' } },
  { k: 'uvm', name: 'ООО «УВМ-СТАЛЬ»', inn: '5024199555', doc: 'КА-89057', date: '2026-10-14', terms: { payment: '45 дн. от поставки', delivery: 'в наличии', deliveryPlace: 'склад Нахабино', validity: '1 банковский день' } },
  { k: 'dipos', name: 'ООО «ПКФ «ДиПОС»', inn: '5027240790', doc: 'УП-156407', date: '2026-10-15', terms: { payment: '30 дн. от даты отгрузки', delivery: 'в наличии', deliveryPlace: 'склад Лыткарино' } }
];

function offerOf(k: string, opts: { first?: boolean } = {}): TdfOffer {
  const s = SUPPLIERS.find(x => x.k === k)!;
  const terms = emptyTerms();
  (Object.keys(s.terms) as TdfTermKey[]).forEach(t => { terms[t] = { value: s.terms[t]!, source: 'offer' }; });
  if (s.conflict && !opts.first) terms.payment.conflict = s.conflict;
  const lines = DATA.map(([n, q, p, oq, d, f], i) => {
    const price = opts.first ? f[k] : p[k];
    if (!price) return null;
    return { id: `${k}${opts.first ? '0' : ''}-${i}`, name: n, unit: 'т', quantity: Number(oq[k] ?? q), unitPrice: price, deliveryNote: d[k] && d[k] !== '—' ? d[k] : '' };
  }).filter(Boolean) as TdfOffer['lines'];
  return {
    id: `${k}${opts.first ? '-first' : ''}`,
    supplier: s.name,
    inn: s.inn,
    docNumber: s.doc,
    docDate: opts.first ? '2026-10-14' : s.date,
    createdAt: opts.first ? '2026-10-14T08:00:00Z' : '2026-10-15T09:00:00Z',
    fileName: `${k}.pdf`,
    currency: 'RUB',
    terms,
    note: opts.first ? '' : s.note,
    lines
  };
}

export function rebarForm(): TdfForm {
  return {
    id: 'tdf-test',
    code: 'TDF-2026-0001',
    title: 'Арматура А500С · VEER UB10',
    jobsiteName: 'VEER UB10',
    address: 'ул. Верейская, з/у 29/42',
    requestNumbers: 'MTF-1042',
    status: 'draft',
    createdAt: '2026-10-19T08:00:00Z',
    updatedAt: '2026-10-19T08:00:00Z',
    offers: [offerOf('bmz', { first: true }), offerOf('bmz'), offerOf('tula'), offerOf('evraz'), offerOf('uvm'), offerOf('dipos')]
  };
}
