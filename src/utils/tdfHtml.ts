/**
 * TDF formunun tek başına açılabilen HTML hâli.
 * Aynı çıktı: ekrandaki "TDF formu" adımı (iframe), "HTML indir" ve "PDF indir" (html2pdf) için kullanılır.
 */
import { computeTdf, TdfComputed, TdfForm, tdfFormat } from './tdfEngine';
import { buildTdfReport, cellDelivery, TDF_LEVEL_LABEL, TDF_TERM_ROWS, TDF_UNIT_LABEL, termText } from './tdfReport';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl2br = (v: unknown) => esc(v).replace(/\n/g, '<br>');

const CSS = `
:root{--ink:#0f1b2d;--muted:#5a6579;--line:#c9cfda;--navy:#102c54;--navy2:#1e3f6e;--head:#d6dce4;--sum:#d9e1f2;--best:#ffeb9c;
--accent:#2f5bd3;--accent-soft:#e9efff;--good:#0b7a4b;--good-soft:#e2f5ec;--warn:#a15c00;--warn-soft:#fff3d6;--bad:#b42318;--bad-soft:#fde8e6;--grey:#f5f6f8}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--ink);font-family:"IBM Plex Sans","Segoe UI",Arial,system-ui,sans-serif;font-size:12.5px;line-height:1.4}
.paper{max-width:1500px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:20px}
.ph{background:var(--navy);color:#fff;padding:16px 22px;display:flex;justify-content:space-between;gap:16px;border-radius:4px}
.ph .t{font-size:17px;font-weight:700}
.ph .s{font-size:11.5px;opacity:.88;margin-top:4px}
.ph .logo{font-weight:800;font-size:22px;letter-spacing:.08em;align-self:center}
.sec{break-inside:auto}
.sec h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;margin:0 0 8px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;color:var(--navy)}
.sec h3 .ru{font-weight:400;color:var(--muted);letter-spacing:.03em}
.ai{font-size:10px;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0;border:1px solid var(--accent);border-radius:999px;padding:0 7px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.kpi{border:1px solid var(--line);border-radius:6px;padding:9px 12px}
.kpi .k{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.kpi .v{font-size:17px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi .h{font-size:11.5px;color:var(--muted)}
.reco{border:1.5px solid var(--good);background:var(--good-soft);border-radius:6px;padding:12px 16px;display:flex;flex-direction:column;gap:5px}
.reco b.big{font-size:14.5px}
.reco ol{margin:4px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:3px}
.reco .user{border-top:1px dashed var(--good);padding-top:6px;margin-top:4px}
.alerts{display:flex;flex-direction:column;gap:6px}
.al{display:grid;grid-template-columns:70px 1fr;gap:10px;border:1px solid var(--line);border-radius:6px;padding:7px 10px;align-items:start;break-inside:avoid}
.al .lv{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 6px;border-radius:4px;text-align:center}
.al.critical{border-color:var(--bad)} .al.critical .lv{background:var(--bad-soft);color:var(--bad)}
.al.warning .lv{background:var(--warn-soft);color:var(--warn)}
.al.info .lv{background:var(--accent-soft);color:var(--accent)}
.al p{margin:0} .al .act{font-size:11.5px;color:var(--muted);margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.chip{font-size:10.5px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.hint{color:var(--muted);font-size:11.5px;margin:6px 0 0}
table{border-collapse:collapse;width:100%;font-size:11.5px}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
thead th{background:var(--head);font-size:10.5px;font-weight:600;line-height:1.2}
thead th .ru,td .ru{display:block;font-weight:400;opacity:.75}
th.sup{background:var(--navy);color:#fff;text-align:center;font-size:12px}
th.bestH{background:var(--best);color:var(--ink);text-align:center}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.c{text-align:center}
td.low{background:var(--good-soft);color:var(--good);font-weight:700}
td.high{background:var(--bad-soft);color:var(--bad)}
td.empty{color:var(--muted);text-align:center}
td.del{font-size:10.5px;color:var(--muted)}
td.bestC{background:var(--best);font-weight:600}
td.w{background:var(--warn-soft);color:var(--warn);font-weight:700;box-shadow:inset 0 0 0 2px var(--warn)}
td.w .why{display:block;font-size:10px;font-weight:400;white-space:normal;text-align:left;max-width:220px}
td.miss{background:var(--warn-soft);color:var(--warn)}
td.bad{background:var(--bad-soft);color:var(--bad)}
tr.sum td{font-weight:700;background:var(--sum)}
tr.terms td{background:var(--grey);font-size:11px}
tr.terms td.miss{background:var(--warn-soft)}
tr{break-inside:avoid}
.tag{font-size:9.5px;padding:0 5px;border-radius:999px;font-weight:600;white-space:nowrap}
.tag.user{background:var(--accent-soft);color:var(--accent)} .tag.bad{background:var(--bad-soft);color:var(--bad)}
.qual{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.qual div{border:1px solid var(--line);border-radius:6px;padding:8px 10px;break-inside:avoid}
.qual b{display:block;margin-bottom:2px}
.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:12px}
.sign div{border-top:1.5px solid var(--ink);padding-top:6px;font-size:11px;color:var(--muted);min-height:54px}
.foot{font-size:10.5px;color:var(--muted);display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line);padding-top:6px}
a{color:var(--accent)}
@page{size:A3 landscape;margin:10mm}
@media print{.paper{padding:0;max-width:none}.ph,.reco,td,th,.al,.kpi{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export interface TdfHtmlOptions { todayIso?: string; computed?: TdfComputed; embedded?: boolean }

export function renderTdfHtml(form: TdfForm, opts: TdfHtmlOptions = {}): string {
  const todayIso = opts.todayIso || new Date().toISOString().slice(0, 10);
  const c = opts.computed || computeTdf(form, todayIso);
  const r = buildTdfReport(form, c, todayIso);
  const { rub, pct, qty } = tdfFormat;
  const S = r.suppliers;
  const nMat = c.materials.length;
  let h = '';

  h += `<div class="ph"><div><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></div><div class="logo">GES</div></div>`;

  if (!S.length || !nMat) {
    h += `<div class="sec"><p>Henüz teklif yüklenmedi. Teklifleri ekledikten sonra form burada oluşur.</p></div>`;
    return wrap(form, h, opts);
  }

  // Özet
  h += `<div class="sec"><h3>Özet <span class="ru">Итог</span></h3><div class="kpis">${r.kpis.map(k => `<div class="kpi"><div class="k">${esc(k.k)}</div><div class="v">${esc(k.v)}</div><div class="h">${esc(k.h)}</div></div>`).join('')}</div></div>`;

  // Öneri
  if (r.reco) {
    h += `<div class="sec"><h3>Sistemin önerisi <span class="ru">Рекомендация</span> <span class="ai">otomatik öneri · satınalmacı düzenleyebilir</span></h3><div class="reco">`;
    h += `<b class="big">${esc(r.reco.headline)}</b>`;
    if (r.reco.aiSummary) h += `<span>${nl2br(r.reco.aiSummary)}</span>`;
    if (r.reco.lines.length) h += `<ol>${r.reco.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
    if (r.reco.userNote) h += `<div class="user"><b>Satınalmacının değerlendirmesi:</b> ${nl2br(r.reco.userNote)}</div>`;
    h += `</div></div>`;
  }

  // Uyarılar
  h += `<div class="sec"><h3>Dikkat edilecek noktalar <span class="ru">Риски и замечания</span> <span class="ai">sistem otomatik buldu</span></h3>`;
  h += c.warnings.length
    ? `<div class="alerts">${c.warnings.map(w => `<div class="al ${w.level}"><span class="lv">${TDF_LEVEL_LABEL[w.level]}</span><div><p>${esc(w.text)}</p>${w.action ? `<p class="act">${esc(w.action)}</p>` : ''}</div></div>`).join('')}</div>`
    : `<p class="hint">Otomatik kontrolde sorun bulunmadı.</p>`;
  h += `<p class="hint">Sistem her teklifte şu farkları arar:</p><div class="chips">${r.checkedDifferences.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div>`;

  // 1 · Fiyat matrisi
  h += `<div class="sec"><h3>1 · Fiyat karşılaştırması <span class="ru">Сравнение цен (₽ с НДС 22%)</span></h3><table><thead><tr>`;
  h += `<th rowspan="2">№</th><th rowspan="2">Açıklama<span class="ru">Описание</span></th><th rowspan="2">Miktar<span class="ru">Кол-во</span></th>`;
  S.forEach(s => { h += `<th class="sup" colspan="3">${esc(s.short)}</th>`; });
  h += `<th class="bestH" colspan="3">En iyi fiyat · Лучшая цена</th></tr><tr>`;
  S.forEach(() => { h += `<th>Birim fiyat<span class="ru">Цена за ед.</span></th><th>Toplam<span class="ru">Сумма, ₽</span></th><th>Teslim<span class="ru">Срок</span></th>`; });
  h += `<th class="bestH">Firma<span class="ru">Поставщик ✓</span></th><th class="bestH">Birim fiyat</th><th class="bestH">1. ile 2. fark<span class="ru">Разница</span></th></tr></thead><tbody>`;
  c.materials.forEach((m, i) => {
    const unit = TDF_UNIT_LABEL[m.unit] || m.unit;
    const comparableCount = S.filter(s => { const x = m.cells[s.key]; return x && !(x.warning && /Teknik fark|Birim farklı/.test(x.warning)); }).length;
    h += `<tr><td class="num">${i + 1}</td><td>${esc(m.name)}</td><td class="num">${qty(m.orderQty)} ${esc(unit)}</td>`;
    S.forEach(s => {
      const x = m.cells[s.key];
      if (!x) { h += `<td class="empty" colspan="3">—</td>`; return; }
      const excluded = !!(x.warning && /Teknik fark|Birim farklı/.test(x.warning));
      const cls = x.warning ? 'w' : (m.bestPrice !== null && Math.abs(x.unitPrice - m.bestPrice) < 0.005 ? 'low' : (comparableCount > 2 && m.worstPrice !== null && Math.abs(x.unitPrice - m.worstPrice) < 0.005 && m.worstPrice !== m.bestPrice ? 'high' : ''));
      const why = x.warning ? `<span class="why">${esc(x.warning)}${excluded ? ' · kıyasa katılmadı' : ''}</span>` : '';
      const conv = x.convertedFrom ? ` title="${esc(x.convertedFrom)}"` : '';
      h += `<td class="num ${cls}"${conv}>${rub(x.unitPrice)}${x.warning ? ' !' : ''}${why}</td><td class="num">${rub(x.total)}</td><td class="del">${esc(cellDelivery(m, s.col))}</td>`;
    });
    const best = m.bestSuppliers.map(k => S.find(s => s.key === k)?.short || k).join(', ');
    h += m.bestPrice === null
      ? `<td class="bestC" colspan="3">Kıyaslanabilir fiyat yok</td>`
      : `<td class="bestC">✓ ${esc(best)}</td><td class="num bestC">${rub(m.bestPrice)}</td><td class="num bestC">${m.diffBestSecond === null ? '—' : pct(m.diffBestSecond)}</td>`;
    h += `</tr>`;
  });
  h += `<tr class="sum"><td colspan="3">GENEL TOPLAM · ИТОГО (с НДС 22%)</td>`;
  S.forEach(s => { h += `<td colspan="3" class="num">${rub(s.col.total)}${s.col.covered < nMat ? `<span class="ru">${s.col.covered}/${nMat} kalem</span>` : ''}</td>`; });
  h += `<td colspan="3" class="num">${rub(c.mixTotal)}<span class="ru">kalem kalem en iyi</span></td></tr>`;
  if (S.some(s => s.col.freight > 0)) {
    h += `<tr class="terms"><td colspan="3"><b>Nakliye (fiyata dahil değil) · Доставка</b></td>`;
    S.forEach(s => { h += `<td colspan="3" class="num">${s.col.freight > 0 ? `${rub(s.col.freight)} ₽` : '—'}</td>`; });
    h += `<td colspan="3"></td></tr>`;
  }
  h += `<tr class="terms"><td colspan="3"><b>Ödeme · Условия оплаты</b></td>`;
  S.forEach(s => {
    const t = s.col.offer.terms?.payment;
    const v = termText(s.col, 'payment');
    h += `<td colspan="3" class="${v ? (t?.conflict ? 'bad' : '') : 'miss'}">${v ? esc(v) : 'Teklifte yok'}${t?.conflict ? `<span class="ru">! ${esc(t.conflict)}</span>` : ''}</td>`;
  });
  h += `<td colspan="3"></td></tr>`;
  h += `<tr class="terms"><td colspan="3"><b>Satınalmacının notu · Примечание</b></td>`;
  S.forEach(s => { h += `<td colspan="3">${nl2br(s.col.offer.note || '')}</td>`; });
  h += `<td colspan="3"></td></tr></tbody></table>`;

  if (c.comparisons.length) {
    h += `<table style="margin-top:10px"><thead><tr><th>Kıyaslanabilir hacimde karşılaştırma · Сравнение на сопоставимом объёме</th><th>Fark, ₽</th><th>Fark, %</th><th>Açıklama</th></tr></thead><tbody>`;
    c.comparisons.forEach(x => { h += `<tr><td>${esc(x.label)}</td><td class="num"><b>${x.diff >= 0 ? '+' : '−'}${rub(Math.abs(x.diff))}</b></td><td class="num">${x.diff >= 0 ? '+' : '−'}${pct(Math.abs(x.pct))}</td><td>${esc(x.note)}</td></tr>`; });
    h += `</tbody></table>`;
  }
  if (c.mergeSuggestions.length) {
    h += `<p class="hint">Birleştirilmemiş benzer kalemler: ${c.mergeSuggestions.map(x => `${esc(c.materials.find(m => m.key === x.a)?.name)} / ${esc(c.materials.find(m => m.key === x.b)?.name)} (${esc(x.reason)})`).join(' · ')}. Aynı ürünse karşılaştırma ekranında birleştirilebilir.</p>`;
  }
  h += `</div>`;

  // 2 · Ticari şartlar
  h += `<div class="sec"><h3>2 · Ticari şartlar <span class="ru">Коммерческие условия</span></h3><table><thead><tr><th>Şart · Условие</th>${S.map(s => `<th class="sup">${esc(s.short)}</th>`).join('')}</tr></thead><tbody>`;
  TDF_TERM_ROWS.forEach(row => {
    h += `<tr><td><b>${esc(row.label)}</b></td>`;
    S.forEach(s => {
      const t = s.col.offer.terms?.[row.key];
      const v = termText(s.col, row.key);
      const optional = row.key === 'installation' || row.key === 'warranty';
      h += `<td class="${!v && !optional ? 'miss' : (t?.conflict ? 'bad' : '')}">${v ? esc(v) : (optional ? '—' : 'Teklifte yok')}${t?.source === 'user' && v ? ' <span class="tag user">elle</span>' : ''}${t?.conflict ? `<span class="ru">! ${esc(t.conflict)}</span>` : ''}</td>`;
    });
    h += `</tr>`;
  });
  h += `<tr><td><b>Belge · Документ</b></td>${S.map(s => `<td>${esc(r.documents.find(d => d.supplier === s.short)?.current || '')}</td>`).join('')}</tr>`;
  h += `<tr><td><b>INN</b></td>${S.map(s => `<td>${esc(s.col.offer.inn || '—')}</td>`).join('')}</tr>`;
  if (S.some(s => (s.col.offer.note || '').trim())) h += `<tr><td><b>Satınalmacının notu · Примечание</b></td>${S.map(s => `<td>${nl2br(s.col.offer.note || '')}</td>`).join('')}</tr>`;
  h += `</tbody></table></div>`;

  // 3 · Miktar
  h += `<div class="sec"><h3>3 · Sipariş miktarı ve teklif miktarı <span class="ru">Заказ и объёмы в КП</span></h3><table><thead><tr><th>№</th><th>Kalem</th><th>Sipariş</th>${S.map(s => `<th class="sup">${esc(s.short)}</th>`).join('')}</tr></thead><tbody>`;
  c.materials.forEach((m, i) => {
    h += `<tr><td class="num">${i + 1}</td><td>${esc(m.name)}</td><td class="num">${qty(m.orderQty)} ${esc(TDF_UNIT_LABEL[m.unit] || m.unit)}</td>`;
    S.forEach(s => {
      const x = m.cells[s.key];
      if (!x) { h += `<td class="empty">—</td>`; return; }
      const diff = m.orderQty > 0 && Math.abs(x.quantity - m.orderQty) / m.orderQty > 0.0005;
      h += `<td class="num ${diff ? 'w' : ''}">${qty(x.quantity)}</td>`;
    });
    h += `</tr>`;
  });
  h += `<tr class="sum"><td colspan="2">TOPLAM</td><td class="num">${qty(c.orderTotalQty)}</td>${S.map(s => `<td class="num">${qty(c.materials.reduce((a, m) => a + (m.cells[s.key]?.quantity || 0), 0))}</td>`).join('')}</tr></tbody></table>`;
  h += `<p class="hint">Karşılaştırma sipariş miktarıyla yapılır. Sarı hücre: firma miktarı değiştirmiş veya yuvarlamış.</p></div>`;

  // 4 · İndirim takibi
  const withHistory = S.filter(s => s.col.previousOffers.length);
  h += `<div class="sec"><h3>4 · İndirim takibi <span class="ru">Динамика цен и скидки</span></h3>`;
  if (withHistory.length) {
    h += `<table><thead><tr><th>Firma</th><th>İlk teklif, ₽<span class="ru">Было</span></th><th>Güncel, ₽<span class="ru">Стало</span></th><th>İndirim, ₽</th><th>İndirim, %</th><th>Belgeler (ilk → güncel)</th></tr></thead><tbody>`;
    S.forEach(s => {
      const doc = r.documents.find(d => d.supplier === s.short)!;
      const first = s.col.firstTotal;
      const disc = first ? first - s.col.total : 0;
      h += `<tr><td>${esc(s.short)}</td><td class="num">${first ? rub(first) : rub(s.col.total)}</td><td class="num">${rub(s.col.total)}</td><td class="num ${disc > 0.5 ? 'low' : ''}">${rub(disc)}</td><td class="num">${first ? pct(disc / first) : '—'}</td><td>${doc.previous.length ? `${esc(doc.previous.join(', '))} → ${esc(doc.current)}` : 'Tek teklif, değişiklik yok'}</td></tr>`;
    });
    h += `</tbody></table><p class="hint">İlk teklif tutarı, güncel teklifteki kalemler ve sipariş miktarı üzerinden hesaplanır.</p>`;
  } else {
    h += `<p class="hint">Hiçbir firmadan ikinci (indirimli) teklif yüklenmedi. Aynı firmanın yeni teklifi eklendiğinde burada было / стало karşılaştırması çıkar.</p>`;
  }
  h += `</div>`;

  // 5 · Kalite
  h += `<div class="sec"><h3>5 · Malzeme ve kalite değerlendirmesi <span class="ru">Качество</span>${form.ai?.generatedAt ? ' <span class="ai">yapay zekâ araştırması · kontrol edilmeli</span>' : ''}</h3>`;
  h += r.qualityItems.length
    ? `<div class="qual">${r.qualityItems.map(q => `<div><b>${esc(q.title)}${q.source === 'user' ? ' <span class="tag user">satınalmacı</span>' : ''}</b>${nl2br(q.text)}</div>`).join('')}</div>`
    : `<p class="hint">Kalite değerlendirmesi henüz yapılmadı. Karşılaştırma ekranındaki "Yapay zekâ değerlendirmesi" düğmesi bu bölümü doldurur; satınalmacı da kendi yorumunu yazabilir.</p>`;
  if (form.ai?.sources?.length) h += `<p class="hint">Kaynaklar: ${form.ai.sources.slice(0, 8).map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join(' · ')}</p>`;
  h += `</div>`;

  // 6 · Firma güvenilirliği
  h += `<div class="sec"><h3>6 · Firma güvenilirliği <span class="ru">Надёжность поставщика</span></h3><table><thead><tr><th>Firma</th><th>INN</th><th>Bizdeki geçmiş alımlar</th><th>Durum · kuruluş · sermaye</th><th>Risk</th><th>Not ve kaynak</th></tr></thead><tbody>`;
  r.vendorRows.forEach(v => {
    h += `<tr><td>${esc(v.name)}</td><td>${esc(v.inn || '—')}</td><td>${esc(v.history || '—')}</td><td>${esc(v.aiStatus || '—')}</td><td>${esc(v.aiRisk || '—')}</td><td>${esc(v.aiNotes)}${v.sources.length ? `<span class="ru">${v.sources.slice(0, 3).map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\//, '').slice(0, 40))}</a>`).join(' · ')}</span>` : ''}</td></tr>`;
  });
  h += `</tbody></table>`;
  if (!form.ai?.vendorChecks || !Object.keys(form.ai.vendorChecks).length) h += `<p class="hint">Durum, sermaye ve risk sütunları yapay zekâ değerlendirmesi çalıştırılınca kaynaklı olarak dolar. Bilgi bulunamazsa boş kalır, tahmin yazılmaz.</p>`;
  if (r.lastPrices.length) {
    h += `<table style="margin-top:10px"><thead><tr><th>Bizdeki son alış fiyatı · Последняя закупка</th><th>Son alış (KDV dahil)</th><th>Tarih</th><th>Firma</th><th>Bu TDF'deki en iyi</th><th>Fark</th></tr></thead><tbody>`;
    r.lastPrices.forEach(lp => { h += `<tr><td>${esc(lp.material)}</td><td class="num">${rub(lp.lastPrice)} ₽/${esc(lp.unit)}</td><td>${esc(lp.date)}</td><td>${esc(lp.supplier)}</td><td class="num">${lp.best !== null ? `${rub(lp.best)} ₽` : '—'}</td><td class="num ${lp.diffPct !== null && lp.diffPct > 0.05 ? 'high' : (lp.diffPct !== null && lp.diffPct < 0 ? 'low' : '')}">${lp.diffPct === null ? '—' : `${lp.diffPct >= 0 ? '+' : '−'}${pct(Math.abs(lp.diffPct))}`}</td></tr>`; });
    h += `</tbody></table>`;
  }
  h += `</div>`;

  // 7 · Puanlama
  const W = c.weights;
  const rows: Array<[string, (x: typeof c.scores[number]) => string]> = [
    [`Fiyat (${W.price})`, x => (x.price === null ? '—' : String(x.price))],
    [`Kapsam (${W.coverage})`, x => String(x.coverage)],
    [`Ödeme vadesi (${W.payment})`, x => String(x.payment)],
    [`Teslim ve stok (${W.delivery})`, x => String(x.delivery)],
    [`Belge eksiksizliği (${W.documents})`, x => String(x.documents)]
  ];
  h += `<div class="sec"><h3>7 · Puanlama <span class="ru">Оценка</span> <span class="ai">ağırlıklar değiştirilebilir</span></h3><table><thead><tr><th>Ölçüt (ağırlık)</th>${S.map(s => `<th class="sup">${esc(s.short)}</th>`).join('')}</tr></thead><tbody>`;
  rows.forEach(([label, fn]) => { h += `<tr><td>${esc(label)}</td>${S.map(s => `<td class="num">${fn(c.scores.find(x => x.supplierKey === s.key)!)}</td>`).join('')}</tr>`; });
  const maxTotal = Math.max(...c.scores.map(x => x.total));
  h += `<tr class="sum"><td>TOPLAM (100)</td>${S.map(s => { const t = c.scores.find(x => x.supplierKey === s.key)!.total; return `<td class="num ${t === maxTotal ? 'low' : ''}">${t}</td>`; }).join('')}</tr></tbody></table>`;
  h += `<p class="hint">Fiyat puanı ortak kalemler üzerinden hesaplanır; her %1 pahalılık fiyat puanının %5'ini düşürür. Kalemlerin yarısından azına fiyat veren firma fiyatta puanlanmaz.</p></div>`;

  h += `<div class="sign"><div>Hazırlayan · Подготовил</div><div>Kontrol · Проверил</div><div>Onay · Утвердил</div></div>`;
  h += `<div class="foot"><span>${esc(form.code)} · GES Satınalma · ${form.offers.length} teklif belgesi</span><span>${esc(r.dateStr)}</span></div>`;
  return wrap(form, h, opts);
}

function wrap(form: TdfForm, body: string, opts: TdfHtmlOptions): string {
  if (opts.embedded) return `<style>${CSS}</style><div class="paper">${body}</div>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(form.code)} · ${esc(form.title)}</title><style>${CSS}</style></head><body><div class="paper">${body}</div></body></html>`;
}
