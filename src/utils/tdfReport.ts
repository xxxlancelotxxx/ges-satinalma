/**
 * TDF çıktılarının (ekrandaki form, HTML, PDF, Excel) ortak metin modeli.
 * Hesaplar tdfEngine'de; burada sadece okunacak metinler ve özet kutuları üretilir,
 * böylece dört çıktı da aynı cümleleri ve aynı rakamları gösterir.
 */
import {
  compactOfferedName, TdfComputed, TdfForm, TdfMaterialRow, TdfSupplierCol, TdfTermKey, TDF_TERM_KEYS, TDF_TERM_LABELS,
  shortSupplierName, tdfFormat, TdfWarningLevel
} from './tdfEngine';

export interface TdfReportSupplier { key: string; short: string; full: string; col: TdfSupplierCol }
export interface TdfKpi { k: string; v: string; h: string }
export interface TdfQualityItem { title: string; text: string; source: 'user' | 'ai'; product?: string; brand?: string; notes?: string; sources?: string[] }
export interface TdfVendorRow {
  key: string; name: string; inn: string; doc: string;
  history: string; aiStatus: string; aiRisk: string; aiNotes: string; aiReviews: string; sources: string[];
}
export interface TdfLastPriceRow { material: string; unit: string; lastPrice: number; date: string; supplier: string; best: number | null; diffPct: number | null }

export interface TdfReport {
  title: string;
  subtitle: string;
  dateStr: string;
  unitLabel: string;
  suppliers: TdfReportSupplier[];
  kpis: TdfKpi[];
  reco: { headline: string; lines: string[]; userNote: string; aiSummary: string } | null;
  qualityItems: TdfQualityItem[];
  vendorRows: TdfVendorRow[];
  lastPrices: TdfLastPriceRow[];
  documents: Array<{ supplier: string; current: string; previous: string[]; note: string }>;
  checkedDifferences: string[];
}

export const TDF_LEVEL_LABEL: Record<TdfWarningLevel, string> = { critical: 'Kritik', warning: 'Uyarı', info: 'Bilgi' };
export const TDF_UNIT_LABEL: Record<string, string> = { t: 't', kg: 'kg', 'm³': 'm³', 'm²': 'm²', m: 'm', adet: 'adet', l: 'l' };
export const TDF_CHECKED_DIFFERENCES = [
  'çelik sınıfı (А240 / А400 / А500С)', 'çap ve et kalınlığı', 'boy (6 m / 11,7 m)', 'RAL renk kodu', 'yoğunluk (kg/m³)',
  'ebat (1525×1525 vb.)', 'marka ve muadil', 'ГОСТ / ТУ', 'birim (t, kg, m, m²)', 'miktar yuvarlama', 'ödeme çelişkisi', 'geçerlilik süresi', 'teslim yeri ve nakliye'
];

const ddmmyyyy = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : '');

export function offerDocLabel(o: { docNumber?: string; docDate?: string; fileName?: string }): string {
  const parts = [o.docNumber ? `№ ${o.docNumber}` : '', o.docDate ? `от ${ddmmyyyy(o.docDate)}` : ''].filter(Boolean).join(' ');
  return parts || o.fileName || 'Belge numarası yok';
}

export function termText(col: TdfSupplierCol, key: TdfTermKey): string {
  const t = col.offer.terms?.[key];
  if (t?.value?.trim()) return t.value.trim();
  if (key === 'delivery') {
    const notes = [...new Set((col.offer.lines || []).map(l => (l.deliveryNote || '').trim()).filter(Boolean))];
    if (notes.length) return notes.length > 2 ? `${notes.slice(0, 2).join('; ')} …` : notes.join('; ');
  }
  return '';
}

/** Kalemin teknik özellikleri tek satırda: "A500C · 12 mm · 11.7 m · 1525x1525". */
export function materialSpecText(m: TdfMaterialRow): string {
  const sp = m.specs || {};
  return [sp.grade, sp.size ? sp.size.replace('x', '×') : '', sp.thickness ? `kalınlık ${sp.thickness} mm` : '', sp.diameter ? `Ø${sp.diameter} mm` : '',
    sp.length ? `${sp.length} m` : '', sp.density ? `${sp.density} kg/m³` : '', sp.ral ? `RAL ${sp.ral}` : '', sp.gost ? `ГОСТ ${sp.gost}` : '']
    .filter(Boolean).join(' · ');
}

/** Firma hücresinin alt satırı: marka ve kaleme özel teslim notu. */
export function cellBrandNote(m: TdfMaterialRow, col: TdfSupplierCol): string {
  const c = m.cells[col.key];
  if (!c) return '';
  const d = (c.delivery || '').trim();
  return [c.brand ? c.brand : '', /^наличи$/i.test(d) ? 'в наличии' : d].filter(Boolean).join(' · ');
}

/** Firmanın teklifinde yazan orijinal kalem adı (ortak addan farklıysa kısaltılmış alt bilgi olarak). */
export function cellOfferedName(m: TdfMaterialRow, col: TdfSupplierCol): string {
  const c = m.cells[col.key];
  if (!c || !c.name) return '';
  if (c.name.trim() === m.name.trim()) return '';
  return compactOfferedName(c.name);
}

/** Nakliye hücresi: ayrı bedel, fiyata dahil veya fabrika teslimde girilmemiş. */
export function freightText(col: TdfSupplierCol): string {
  if (col.freightMode === 'separate') return `${tdfFormat.rub(col.freight)} ₽`;
  if (col.freightMode === 'missing') return 'Fabrika teslim · nakliye girilmedi';
  return 'Fiyata dahil';
}

export function cellDelivery(m: TdfMaterialRow, col: TdfSupplierCol): string {
  const c = m.cells[col.key];
  if (!c) return '';
  const d = (c.delivery || '').trim();
  if (/^наличи$/i.test(d)) return 'в наличии';
  return d || col.offer.terms?.delivery?.value || '';
}

export function buildTdfReport(form: TdfForm, computed: TdfComputed, todayIso: string = new Date().toISOString().slice(0, 10)): TdfReport {
  const { rub, pct, qty } = tdfFormat;
  const suppliers: TdfReportSupplier[] = computed.suppliers.map(col => ({ key: col.key, short: shortSupplierName(col.name), full: col.name, col }));
  const nameOf = (k: string) => suppliers.find(s => s.key === k)?.short || k;
  const units = [...new Set(computed.materials.map(m => m.unit))];
  const unitLabel = units.length === 1 ? (TDF_UNIT_LABEL[units[0]] || units[0]) : 'birim';
  const nMat = computed.materials.length;

  const titleParts = [form.code, form.title, form.jobsiteName && !String(form.title || '').includes(form.jobsiteName) ? form.jobsiteName : ''].filter(Boolean);
  const subtitle = [
    form.address,
    form.requestNumbers ? `Talep (Заявка) ${form.requestNumbers}` : '',
    'Tüm fiyatlar НДС 22% dahil',
    ddmmyyyy(todayIso),
    `Sipariş ${qty(computed.orderTotalQty)} ${unitLabel} (${nMat} kalem)`,
    `${suppliers.length} firma, ${form.offers.length} teklif belgesi`
  ].filter(Boolean).join(' · ');

  // Özet kutuları
  const kpis: TdfKpi[] = [];
  const reco = computed.recommendation;
  if (reco) {
    const planSup = reco.plan.map(p => nameOf(p.supplierKey)).join(' + ');
    kpis.push({ k: 'Önerilen plan', v: `${rub(reco.planTotal)} ₽`, h: `${planSup} · ${nMat} kalem` });
  }
  const complete = suppliers.filter(s => computed.materials.every(m => m.cells[s.key])).sort((a, b) => a.col.grandTotal - b.col.grandTotal);
  if (complete[0]) {
    const diff = reco ? complete[0].col.grandTotal - reco.planTotal : 0;
    kpis.push({ k: 'En ucuz tam teklif (tek firma)', v: `${rub(complete[0].col.grandTotal)} ₽`, h: `${complete[0].short} · ${complete[0].col.freightMode === 'missing' ? 'nakliye hariç (girilmedi)' : 'nakliye dahil'}${reco && diff > 0.5 ? ` · plana göre +${rub(diff)} ₽ (+${pct(diff / reco.planTotal)})` : ''}` });
  }
  if (complete.length > 1 && reco) {
    const worst = complete[complete.length - 1];
    const diff = worst.col.grandTotal - reco.planTotal;
    kpis.push({ k: 'En yüksek teklif ile fark', v: `${rub(diff)} ₽`, h: `${worst.short} · +${pct(diff / reco.planTotal)}` });
  }
  const discounts = suppliers.filter(s => s.col.firstTotal && s.col.firstTotal - s.col.total > 0.5);
  if (discounts.length) {
    const sum = discounts.reduce((a, s) => a + (s.col.firstTotal! - s.col.total), 0);
    const top = [...discounts].sort((a, b) => (b.col.firstTotal! - b.col.total) - (a.col.firstTotal! - a.col.total))[0];
    kpis.push({ k: 'Pazarlıkla kazanılan', v: `${rub(sum)} ₽`, h: `${discounts.length > 1 ? `${discounts.length} firma · ` : ''}${top.short} ilk teklife göre −${pct((top.col.firstTotal! - top.col.total) / top.col.firstTotal!)}` });
  } else {
    kpis.push({ k: 'Kalem kalem en ucuz', v: `${rub(computed.mixTotal)} ₽`, h: 'Her kalem ayrı firmadan alınsaydı' });
  }

  // Öneri kutusu
  let recoBlock: TdfReport['reco'] = null;
  if (reco) {
    const lines = [...reco.points];
    const planKeys = new Set(reco.plan.map(p => p.supplierKey));
    computed.warnings
      .filter(w => w.level !== 'info' && w.supplierKey && planKeys.has(w.supplierKey))
      .slice(0, 4)
      .forEach(w => lines.push(`Siparişten önce: ${w.text} ${w.action}`));
    for (const p of reco.plan) {
      const col = suppliers.find(s => s.key === p.supplierKey)?.col;
      const v = col?.offer.terms?.validity?.value;
      if (v) lines.push(`${nameOf(p.supplierKey)} teklifinin geçerliliği: ${v}.`);
    }
    recoBlock = { headline: reco.headline, lines: [...new Set(lines)], userNote: (form.recommendationNote || '').trim(), aiSummary: (form.ai?.summary || '').trim() };
  }

  // Kalite
  const qualityItems: TdfQualityItem[] = [];
  const matName = (k: string) => computed.materials.find(m => m.key === k)?.name || k;
  Object.entries(form.qualityNotes || {}).forEach(([k, v]) => { if (v?.trim()) qualityItems.push({ title: matName(k), text: v.trim(), source: 'user' }); });
  Object.entries(form.ai?.qualityNotes || {}).forEach(([k, v]) => {
    if (v?.trim() && !(form.qualityNotes || {})[k]?.trim()) qualityItems.push({ title: computed.materials.some(m => m.key === k) ? matName(k) : k, text: v.trim(), source: 'ai' });
  });
  // Ürün ve marka araştırması aynı kalemin kalite kutusuna eklenir
  Object.entries(form.ai?.materialInsights || {}).forEach(([k, ins]) => {
    const title = matName(k);
    const item = qualityItems.find(q => q.title === title && q.source === 'ai') || qualityItems.find(q => q.title === title);
    if (item) Object.assign(item, { product: ins.product, brand: ins.brand, notes: ins.notes, sources: ins.sources });
    else qualityItems.push({ title, text: '', source: 'ai', product: ins.product, brand: ins.brand, notes: ins.notes, sources: ins.sources });
  });

  // Firma güvenilirliği
  const vendorRows: TdfVendorRow[] = suppliers.map(s => {
    const h = form.history?.vendors?.[s.key];
    const ai = form.ai?.vendorChecks?.[s.key];
    const history = h && h.invoiceCount > 0
      ? `${h.invoiceCount} fatura · ${rub(h.totalAmount)} ₽${h.lastDate ? ` · son ${ddmmyyyy(h.lastDate)}` : ''}`
      : (form.history ? 'Bizden daha önce alım yok' : '');
    return {
      key: s.key,
      name: s.full,
      inn: s.col.offer.inn || '',
      doc: offerDocLabel(s.col.offer),
      history,
      aiStatus: [ai?.status, ai?.founded ? `kuruluş ${ai.founded}` : '', ai?.capital ? `sermaye ${ai.capital}` : ''].filter(Boolean).join(' · '),
      aiRisk: ai?.risk || '',
      aiNotes: ai?.notes || '',
      aiReviews: ai?.reviews || '',
      sources: ai?.sources || []
    };
  });

  // Son alış fiyatları
  const lastPrices: TdfLastPriceRow[] = computed.materials
    .map(m => {
      const lp = form.history?.lastPrices?.[m.key];
      if (!lp) return null;
      return {
        material: m.name, unit: TDF_UNIT_LABEL[m.unit] || m.unit, lastPrice: lp.unitPrice, date: ddmmyyyy(lp.date), supplier: shortSupplierName(lp.supplier),
        best: m.bestPrice, diffPct: m.bestPrice && lp.unitPrice ? (m.bestPrice - lp.unitPrice) / lp.unitPrice : null
      };
    })
    .filter(Boolean) as TdfLastPriceRow[];

  const documents = suppliers.map(s => ({
    supplier: s.short,
    current: `${offerDocLabel(s.col.offer)}${s.col.offer.fileName ? ` · ${s.col.offer.fileName}` : ''}`,
    previous: s.col.previousOffers.map(o => `${offerDocLabel(o)}${o.fileName ? ` · ${o.fileName}` : ''}`),
    note: (s.col.offer.note || '').trim()
  }));

  return {
    title: `TEKLİF DEĞERLENDİRME FORMU · ТДФ — ${titleParts.join(' · ')}`,
    subtitle,
    dateStr: ddmmyyyy(todayIso),
    unitLabel,
    suppliers,
    kpis,
    reco: recoBlock,
    qualityItems,
    vendorRows,
    lastPrices,
    documents,
    checkedDifferences: TDF_CHECKED_DIFFERENCES
  };
}

export const TDF_TERM_ROWS: Array<{ key: TdfTermKey; label: string }> = TDF_TERM_KEYS.map(k => ({ key: k, label: `${TDF_TERM_LABELS[k].tr} · ${TDF_TERM_LABELS[k].ru}` }));
