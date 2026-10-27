import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2pdf from 'html2pdf.js';
import {
  AlertTriangle, ArrowLeft, Bot, Check, ChevronDown, ChevronUp, Copy, Download, FileSpreadsheet, FileText, FileUp, Link2, Loader2,
  Plus, Printer, RefreshCw, Scale, Split, Trash2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Jobsite } from '../types';
import {
  computeTdf, DEFAULT_TDF_WEIGHTS, shortSupplierName, TdfForm, TdfLine, TdfMaterialRow, TdfOffer, TdfTerm,
  TdfTermKey, TDF_TERM_LABELS, tdfFormat, TdfWeights, termFields, termValueFromFields
} from '../utils/tdfEngine';
import { buildTdfReport, cellBrandNote, cellOfferedName, freightText, materialSpecText, offerDocLabel, TDF_LEVEL_LABEL, TDF_UNIT_LABEL } from '../utils/tdfReport';
import { cleanReadWarning } from '../utils/tdfTerms';
import { renderTdfHtml } from '../utils/tdfHtml';

interface TdfSummary {
  id: string; code: string; title: string; jobsiteName: string; status: string; createdAt: string; updatedAt: string;
  offerCount: number; suppliers: string[]; materialCount: number; planTotal: number | null; criticalCount: number;
}
interface UploadItem { key: string; name: string; status: 'waiting' | 'reading' | 'done' | 'error'; msg?: string }

const { rub, pct, qty } = tdfFormat;
const STATUS_LABEL: Record<string, string> = { draft: 'Taslak', ready: 'Hazır', approved: 'Onaylandı' };
const STATUS_LABEL_RU: Record<string, string> = { draft: 'Черновик', ready: 'Готово', approved: 'Согласовано' };
const OFFER_EDIT_FIELDS: Array<keyof TdfOffer> = ['supplier', 'inn', 'docNumber', 'docDate', 'terms', 'note', 'noteBy', 'noteAt', 'lines', 'freightAmount'];
const ACCEPT = '.pdf,.xlsx,.xls,.csv,image/*';

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(r.error || new Error('Dosya okunamadı'));
  r.readAsDataURL(file);
});

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function TdfView({ jobsites }: { jobsites: Jobsite[] }) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isRu = language === 'RU';
  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-session-token': user?.token || '',
    'x-user-role': encodeURIComponent(user?.role || ''),
    'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
    'x-user-name': encodeURIComponent(user?.displayName || '')
  }), [user]);
  const api = useCallback(async (method: string, url: string, body?: any) => {
    const res = await fetch(url, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `İstek başarısız (${res.status})`);
    return data;
  }, [headers]);

  const [list, setList] = useState<TdfSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', jobsiteId: '', address: '', requestNumbers: '' });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try { setList(await api('GET', `/api/tdf?_t=${Date.now()}`)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoadingList(false); }
  }, [api]);
  useEffect(() => { if (!openId) loadList(); }, [openId, loadList]);

  const createForm = async () => {
    try {
      const js = jobsites.find(j => j.id === newForm.jobsiteId);
      const data = await api('POST', '/api/tdf', {
        title: newForm.title.trim() || 'Yeni teklif değerlendirmesi',
        jobsiteId: js?.id, jobsiteName: js?.name, address: newForm.address.trim() || js?.location || '',
        requestNumbers: newForm.requestNumbers.trim(), createdBy: user?.displayName || ''
      });
      setShowNew(false);
      setNewForm({ title: '', jobsiteId: '', address: '', requestNumbers: '' });
      setOpenId(data.form.id);
    } catch (e: any) { setError(e.message); }
  };

  const deleteForm = async (id: string) => {
    try { await api('DELETE', `/api/tdf/${id}`); setConfirmDelete(null); loadList(); } catch (e: any) { setError(e.message); }
  };

  if (openId) return <TdfEditor id={openId} api={api} headers={headers} userName={user?.displayName || ''} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2"><Scale className="w-5 h-5 text-indigo-600" />{isRu ? 'Форма оценки предложений (TDF / КЛ)' : 'Teklif Değerlendirme Formu (TDF)'}</h2>
          <p className="text-sm text-slate-500">{isRu ? 'Загрузите коммерческие предложения/счета для автоматического сравнения и экспорта в Excel, HTML или PDF.' : 'Teklifleri yükle, sistem okusun ve karşılaştırsın; formu Excel, HTML veya PDF olarak indir.'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadList} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 flex items-center gap-1.5"><RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />{isRu ? 'Обновить' : 'Yenile'}</button>
          <button onClick={() => setShowNew(v => !v)} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 flex items-center gap-1.5"><Plus className="w-4 h-4" />{isRu ? 'Новый TDF' : 'Yeni TDF'}</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex justify-between"><span>{error}</span><button onClick={() => setError(null)}><X className="w-4 h-4" /></button></div>}

      {showNew && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600 md:col-span-2">Konu / malzeme grubu
            <input autoFocus value={newForm.title} onChange={e => setNewForm({ ...newForm, title: e.target.value })} placeholder="ör. Armatür A500C" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Şantiye
            <select value={newForm.jobsiteId} onChange={e => setNewForm({ ...newForm, jobsiteId: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white">
              <option value="">Seçilmedi</option>
              {jobsites.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Talep (Заявка / MTF) no
            <input value={newForm.requestNumbers} onChange={e => setNewForm({ ...newForm, requestNumbers: e.target.value })} placeholder="isteğe bağlı" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" />
          </label>
          <label className="text-xs font-semibold text-slate-600 md:col-span-3">Teslim adresi
            <input value={newForm.address} onChange={e => setNewForm({ ...newForm, address: e.target.value })} placeholder="isteğe bağlı" className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" />
          </label>
          <div className="flex items-end gap-2">
            <button onClick={createForm} className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">Oluştur ve teklifleri yükle</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600">Vazgeç</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr><th className="text-left px-4 py-3">TDF</th><th className="text-left px-4 py-3">{isRu ? 'Объект' : 'Şantiye'}</th><th className="text-left px-4 py-3">{isRu ? 'Поставщики' : 'Firmalar'}</th><th className="text-right px-4 py-3">{isRu ? 'Рекоменд. план' : 'Önerilen plan'}</th><th className="text-left px-4 py-3">{isRu ? 'Статус' : 'Durum'}</th><th className="text-left px-4 py-3">{isRu ? 'Обновлено' : 'Güncellendi'}</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!list.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">{loadingList ? 'Yükleniyor…' : 'Henüz TDF yok. "Yeni TDF" ile başla.'}</td></tr>}
            {list.map(t => (
              <tr key={t.id} className="hover:bg-indigo-50/40 cursor-pointer" onClick={() => setOpenId(t.id)}>
                <td className="px-4 py-3"><div className="font-extrabold text-slate-900">{t.code}</div><div className="text-xs text-slate-500">{t.title}</div></td>
                <td className="px-4 py-3 text-slate-700">{t.jobsiteName || '—'}</td>
                <td className="px-4 py-3 text-slate-700"><div>{t.suppliers.join(', ') || '—'}</div><div className="text-xs text-slate-400">{t.offerCount} belge · {t.materialCount} kalem</div></td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{t.planTotal ? `${rub(t.planTotal)} ₽` : '—'}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{(isRu ? STATUS_LABEL_RU[t.status] : STATUS_LABEL[t.status]) || t.status}</span>{t.criticalCount > 0 && <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700">{t.criticalCount} {isRu ? 'крит.' : 'kritik'}</span>}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(t.updatedAt)}</td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  {confirmDelete === t.id
                    ? <span className="inline-flex gap-1"><button onClick={() => deleteForm(t.id)} className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-bold">Sil</button><button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded border text-xs">Vazgeç</button></span>
                    : <button onClick={() => setConfirmDelete(t.id)} className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600" title="Sil"><Trash2 className="w-4 h-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Düzenleyici
// ---------------------------------------------------------------------------

type Api = (method: string, url: string, body?: any) => Promise<any>;

function TdfEditor({ id, api, headers, userName, onBack }: { id: string; api: Api; headers: () => Record<string, string>; userName: string; onBack: () => void }) {
  const [form, setForm] = useState<TdfForm | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<TdfForm | null>(null);
  const rev = useRef(0);
  const savingPromise = useRef<Promise<void> | null>(null);
  formRef.current = form;

  const today = new Date().toISOString().slice(0, 10);
  const computed = useMemo(() => (form ? computeTdf(form, today) : null), [form, today]);

  useEffect(() => {
    api('GET', `/api/tdf/${id}`).then(d => setForm(d.form)).catch(e => setError(e.message));
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [id, api]);

  const doSave = useCallback(async () => {
    const f = formRef.current;
    if (!f) return;
    const myRev = rev.current;
    setSaveState('saving');
    try {
      const body: any = {
        title: f.title, jobsiteName: f.jobsiteName, address: f.address, requestNumbers: f.requestNumbers, status: f.status,
        materialOverrides: f.materialOverrides || {}, orderQty: f.orderQty || {}, materialNames: f.materialNames || {},
        qualityNotes: f.qualityNotes || {}, weights: f.weights || DEFAULT_TDF_WEIGHTS, recommendationNote: f.recommendationNote || '',
        offers: f.offers.map(o => Object.fromEntries([['id', o.id], ...OFFER_EDIT_FIELDS.map(k => [k, (o as any)[k] ?? null])]))
      };
      const d = await api('PUT', `/api/tdf/${id}`, body);
      if (rev.current === myRev) { setForm(d.form); setSaveState('saved'); } else setSaveState('pending');
    } catch (e: any) { setSaveState('error'); setError(`Kaydedilemedi: ${e.message}`); }
  }, [api, id]);

  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; savingPromise.current = doSave(); }
    if (savingPromise.current) await savingPromise.current.catch(() => undefined);
  }, [doSave]);

  const edit = useCallback((fn: (f: TdfForm) => void) => {
    setForm(prev => {
      if (!prev) return prev;
      const copy: TdfForm = JSON.parse(JSON.stringify(prev));
      fn(copy);
      formRef.current = copy;
      return copy;
    });
    rev.current++;
    setSaveState('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; savingPromise.current = doSave(); }, 900);
  }, [doSave]);

  const editOffer = (offerId: string, fn: (o: TdfOffer) => void) => edit(f => { const o = f.offers.find(x => x.id === offerId); if (o) fn(o); });

  // --- Yükleme ---
  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    const items: UploadItem[] = files.map((f, i) => ({ key: `${Date.now()}_${i}_${f.name}`, name: f.name, status: 'waiting' }));
    setUploads(prev => [...items, ...prev]);
    const setItem = (key: string, patch: Partial<UploadItem>) => setUploads(prev => prev.map(u => (u.key === key ? { ...u, ...patch } : u)));
    let idx = 0;
    const worker = async () => {
      while (idx < files.length) {
        const i = idx++;
        const file = files[i], item = items[i];
        setItem(item.key, { status: 'reading' });
        try {
          if (file.size > 25 * 1024 * 1024) throw new Error('25 MB sınırını aşıyor');
          const b64 = await fileToBase64(file);
          let fileUrl = '';
          try {
            const up = await fetch('/api/upload-file', { method: 'POST', headers: headers(), body: JSON.stringify({ fileName: file.name, fileData: b64, mimeType: file.type }) });
            const uj = await up.json().catch(() => ({}));
            fileUrl = uj?.fileUrl || uj?.url || '';
          } catch { /* dosya arşive yüklenemese de okuma devam eder */ }
          const d = await api('POST', `/api/tdf/${id}/offers`, { fileBase64: b64, mimeType: file.type, fileName: file.name, fileUrl });
          const o = (d.form as TdfForm).offers.find(x => x.id === d.offerId);
          setItem(item.key, { status: 'done', msg: o ? `${shortSupplierName(o.supplier)} · ${o.lines.length} kalem` : 'okundu' });
          await flush();
          const g = await api('GET', `/api/tdf/${id}`);
          if (!saveTimer.current) setForm(g.form);
        } catch (e: any) {
          setItem(item.key, { status: 'error', msg: e.message });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()].slice(0, Math.min(3, files.length)));
  };

  const addManualOffer = async () => {
    try { await flush(); const d = await api('POST', `/api/tdf/${id}/offers`, { manual: true, supplier: 'Yeni firma' }); setForm(d.form); } catch (e: any) { setError(e.message); }
  };
  const deleteOffer = async (offerId: string) => {
    try { await flush(); const d = await api('DELETE', `/api/tdf/${id}/offers/${offerId}`); setForm(d.form); } catch (e: any) { setError(e.message); }
  };
  const [aiError, setAiError] = useState<string | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const runAi = async () => {
    setAiBusy(true); setAiError(null);
    try { await flush(); const d = await api('POST', `/api/tdf/${id}/ai-review`); setForm(d.form); } catch (e: any) { setAiError(e.message); } finally { setAiBusy(false); }
  };
  const runMatch = async () => {
    setMatchBusy(true);
    try { await flush(); const d = await api('POST', `/api/tdf/${id}/ai-match`); setForm(d.form); } catch (e: any) { edit(f => { f.aiMatchError = e.message; }); } finally { setMatchBusy(false); }
  };

  // --- İndirme ---
  const download = async (format: 'xlsx' | 'html') => {
    try {
      await flush();
      const res = await fetch(`/api/tdf/${id}/export?format=${format}`, { headers: headers() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `İndirme başarısız (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${form!.code}_${form!.title}`.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 90) + (format === 'xlsx' ? '.xlsx' : '.html');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e: any) { setError(e.message); }
  };
  const downloadPdf = async () => {
    if (!form || !computed) return;
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-10000px;top:0;width:1500px;background:#fff';
    container.innerHTML = renderTdfHtml(form, { todayIso: today, computed, embedded: true });
    document.body.appendChild(container);
    try {
      await (html2pdf as any)().set({
        margin: [6, 6, 8, 6], filename: `${form.code}_${form.title}`.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 90) + '.pdf',
        image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 1.6, useCORS: true, logging: false, windowWidth: 1500 },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' }, pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.al', '.kpi', '.qual div'] }
      }).from(container.firstElementChild?.nextElementSibling || container).save();
    } catch (e: any) { setError(`PDF oluşturulamadı: ${e.message}`); } finally { container.remove(); }
  };
  const printForm = () => {
    if (!form || !computed) return;
    const w = window.open('', '_blank');
    if (!w) { setError('Yazdırma penceresi açılamadı (açılır pencere engelli olabilir).'); return; }
    w.document.write(renderTdfHtml(form, { todayIso: today, computed }));
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  if (!form || !computed) {
    return <div className="p-10 text-center text-slate-500">{error ? <span className="text-rose-600">{error}</span> : <Loader2 className="w-6 h-6 animate-spin inline" />}<div className="mt-3"><button onClick={onBack} className="text-sm text-indigo-600">Listeye dön</button></div></div>;
  }

  const nMat = computed.materials.length;
  const saveLabel = { idle: '', pending: 'Değişiklik var…', saving: 'Kaydediliyor…', saved: 'Kaydedildi', error: 'Kaydedilemedi' }[saveState];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={async () => { await flush(); onBack(); }} className="text-xs text-indigo-600 font-semibold flex items-center gap-1 mb-1"><ArrowLeft className="w-3.5 h-3.5" />Tüm TDF'ler</button>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl font-extrabold text-slate-900">{form.code}</span>
            <input value={form.title} onChange={e => edit(f => { f.title = e.target.value; })} className="text-xl font-extrabold text-slate-900 bg-transparent border-b border-dashed border-slate-300 focus:border-indigo-500 outline-none min-w-[200px]" aria-label="TDF başlığı" />
          </div>
          <div className="text-sm text-slate-500 flex flex-wrap gap-x-3 gap-y-1 mt-1">
            <span>{form.jobsiteName || 'Şantiye seçilmedi'}</span>
            <input value={form.address || ''} onChange={e => edit(f => { f.address = e.target.value; })} placeholder="teslim adresi" className="bg-transparent border-b border-dashed border-slate-200 outline-none text-sm min-w-[180px]" />
            <input value={form.requestNumbers || ''} onChange={e => edit(f => { f.requestNumbers = e.target.value; })} placeholder="Заявка / MTF no" className="bg-transparent border-b border-dashed border-slate-200 outline-none text-sm w-[140px]" />
            <span>{nMat} kalem · {qty(computed.orderTotalQty)} · {computed.suppliers.length} firma · {form.offers.length} belge</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={saveState === 'error' ? 'text-rose-600' : 'text-slate-400'}>{saveLabel}</span>
          <select value={form.status} onChange={e => edit(f => { f.status = e.target.value as TdfForm['status']; })} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex justify-between gap-2"><span>{error}</span><button onClick={() => setError(null)} aria-label="Kapat"><X className="w-4 h-4" /></button></div>}

      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 flex-wrap" role="tablist">
        {([[1, '1. Teklifler ve şartlar'], [2, '2. Karşılaştırma tablosu'], [3, '3. TDF formu ve indirme']] as const).map(([n, label]) => (
          <button key={n} role="tab" aria-selected={step === n} onClick={() => setStep(n)} className={`px-4 py-2 rounded-lg text-sm font-semibold ${step === n ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{label}</button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(Array.from(e.dataTransfer.files || [])); }}
            className={`bg-white border-2 border-dashed rounded-xl p-6 text-center ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'}`}
          >
            <FileUp className="w-8 h-8 mx-auto text-slate-400" />
            <div className="font-bold text-slate-800 mt-2">Teklif dosyalarını buraya sürükle veya seç</div>
            <div className="text-sm text-slate-500">PDF, Excel, fotoğraf · birden fazla dosya aynı anda · aynı firmanın ilk ve indirimli teklifi birlikte atılabilir</div>
            <div className="mt-3 flex justify-center gap-2 flex-wrap">
              <button onClick={() => fileInput.current?.click()} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold">Dosya seç</button>
              <button onClick={addManualOffer} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white">Elle firma ekle</button>
            </div>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => { uploadFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
            {!!uploads.length && (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {uploads.map(u => (
                  <span key={u.key} className={`text-xs rounded-full px-3 py-1 border flex items-center gap-1.5 ${u.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : u.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                    {u.status === 'reading' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {u.status === 'done' && <Check className="w-3 h-3" />}
                    {u.status === 'error' && <AlertTriangle className="w-3 h-3" />}
                    {u.name}{u.status === 'waiting' ? ' · sırada' : u.status === 'reading' ? ' · okunuyor' : u.msg ? ` · ${u.msg}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!!form.offers.length && <p className="text-xs text-slate-500">Yeşil etiket: tekliften otomatik okundu. Sarı: teklifte yok, seç veya yaz. Kırmızı: belgelerde farklı yazıyor. Değişiklikler otomatik kaydedilir.</p>}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))' }}>
            {computed.suppliers.flatMap(s => [s.offer, ...s.previousOffers.slice().reverse()].map((o, idx) => (
              <OfferCard key={o.id} offer={o} isPrevious={idx > 0} covered={idx === 0 ? s.covered : undefined} nMat={nMat}
                onEdit={fn => editOffer(o.id, fn)} onDelete={() => deleteOffer(o.id)} userName={userName} />
            )))}
          </div>
        </div>
      )}

      {step === 2 && <ComparisonStep form={form} computed={computed} edit={edit} aiBusy={aiBusy} aiError={aiError} onRunAi={runAi} matchBusy={matchBusy} onRunMatch={runMatch} />}

      {step === 3 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => download('xlsx')} className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-bold flex items-center gap-1.5"><FileSpreadsheet className="w-4 h-4" />Excel indir</button>
            <button onClick={() => download('html')} className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 flex items-center gap-1.5"><FileText className="w-4 h-4" />HTML indir</button>
            <button onClick={downloadPdf} className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Download className="w-4 h-4" />PDF indir</button>
            <button onClick={printForm} className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Printer className="w-4 h-4" />Yazdır</button>
            <button onClick={runAi} disabled={aiBusy || !form.offers.length} className="px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-sm font-semibold text-indigo-700 flex items-center gap-1.5 disabled:opacity-50">{aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}{form.ai?.generatedAt ? 'Yapay zekâ değerlendirmesini yenile' : 'Yapay zekâ değerlendirmesi'}</button>
          </div>
          {aiError && <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">Yapay zekâ değerlendirmesi yapılamadı: {aiError}. Form yapay zekâ olmadan da eksiksiz hazırlanır.</div>}
          <label className="block bg-white border border-slate-200 rounded-xl p-3 text-xs font-semibold text-slate-600">Satınalmacının değerlendirmesi (öneri kutusunda ve bütün çıktılarda görünür)
            <textarea value={form.recommendationNote || ''} onChange={e => edit(f => { f.recommendationNote = e.target.value; })} rows={2} placeholder="ör. Ödeme vadesi teyit edildikten sonra BMZ ile devam edilmesi önerilir." className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-normal" />
          </label>
          <iframe title="TDF formu" srcDoc={renderTdfHtml(form, { todayIso: today, computed })} className="w-full bg-white border border-slate-200 rounded-xl" style={{ height: '78vh' }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teklif kartı
// ---------------------------------------------------------------------------

interface OfferCardProps { offer: TdfOffer; isPrevious: boolean; covered?: number; nMat: number; onEdit: (fn: (o: TdfOffer) => void) => void; onDelete: () => void; userName: string }

const termTag = (t: TdfTerm | undefined, optional = false) => {
  if (t?.conflict) return <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-rose-100 text-rose-700 font-semibold" title={t.conflict}>çelişki</span>;
  if (t?.value && t.source === 'offer') return <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-emerald-100 text-emerald-700 font-semibold">teklifte bulundu</span>;
  if (t?.value) return <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700 font-semibold">elle girildi</span>;
  if (optional) return <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-slate-100 text-slate-500 font-semibold">isteğe bağlı</span>;
  return <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-amber-100 text-amber-700 font-semibold">teklifte yok</span>;
};

const Seg: React.FC<{ options: Array<[string, string]>; value?: string; onChange: (v: string) => void; warn?: boolean }> = ({ options, value, onChange, warn }) => (
  <div className={`inline-flex rounded-lg border p-0.5 ${warn ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
    {options.map(([v, label]) => (
      <button key={v} type="button" onClick={() => onChange(v)}
        className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${value === v ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{label}</button>
    ))}
  </div>
);

const NumBox: React.FC<{ value?: number; suffix: string; onChange: (v: number | undefined) => void; placeholder?: string; warn?: boolean; w?: string }> = ({ value, suffix, onChange, placeholder, warn, w = 'w-16' }) => {
  const [text, setText] = useState(value === undefined || value === null || Number.isNaN(value) ? '' : String(value));
  useEffect(() => {
    setText(prev => { const n = parseFloat(prev.replace(',', '.')); return (Number.isFinite(n) ? n : undefined) === value ? prev : (value === undefined || value === null || Number.isNaN(value) ? '' : String(value)); });
  }, [value]);
  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-1 ${warn ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <input inputMode="decimal" value={text} placeholder={placeholder}
        onChange={e => { const t = e.target.value.replace(/[^\d.,]/g, ''); setText(t); const n = parseFloat(t.replace(',', '.')); onChange(Number.isFinite(n) ? n : undefined); }}
        className={`${w} text-right text-sm text-slate-900 bg-transparent outline-none`} />
      <span className="ml-1 text-xs text-slate-500">{suffix}</span>
    </span>
  );
};

const TermRow: React.FC<{ label: string; t?: TdfTerm; optional?: boolean; children: React.ReactNode }> = ({ label, t, optional, children }) => (
  <div className="flex flex-col gap-1">
    <span className="flex justify-between items-center gap-1 text-xs text-slate-500">{label}{termTag(t, optional)}</span>
    <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    {t?.raw && t.raw !== t.value && <span className="text-[10px] text-slate-400 truncate" title={t.raw}>Teklifte: {t.raw}</span>}
    {t?.conflict && <span className="text-[11px] text-rose-700">{t.conflict} Değeri seçince uyarı kalkar.</span>}
  </div>
);

/** Eksik şartları firmaya sormak için kısa Rusça mesaj. */
function missingTermsRequest(offer: TdfOffer): string {
  const t = offer.terms || ({} as Record<TdfTermKey, TdfTerm>);
  const asks: string[] = [];
  if (!t.payment?.value) asks.push('условия оплаты (предоплата в % или отсрочка в днях)');
  if (!t.delivery?.value) asks.push('срок поставки (наличие на складе или срок в днях)');
  if (!t.deliveryPlace?.value) asks.push('место поставки: доставка до объекта включена в цену или самовывоз со склада');
  else if (termFields('deliveryPlace', t.deliveryPlace).mode === 'factory' && !(Number(offer.freightAmount) > 0)) asks.push('стоимость доставки до объекта');
  if (!t.validity?.value) asks.push('срок действия предложения');
  if (!asks.length) return '';
  return `Добрый день!\nСпасибо за коммерческое предложение${offer.docNumber ? ` № ${offer.docNumber}` : ''}. Для сравнения предложений просим уточнить:\n${asks.map((a, i) => `${i + 1}. ${a};`).join('\n')}\nЗаранее спасибо!`;
}

const OfferCard: React.FC<OfferCardProps> = ({ offer, isPrevious, covered, nMat, onEdit, onDelete, userName }) => {
  const [showLines, setShowLines] = useState(!offer.lines.length);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);
  const linesTotal = offer.lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const setLine = (lineId: string, patch: Partial<TdfLine>) => onEdit(o => { const l = o.lines.find(x => x.id === lineId); if (l) Object.assign(l, patch); });
  const term = (k: TdfTermKey) => offer.terms?.[k];
  const fields = (k: TdfTermKey) => termFields(k, term(k));
  const setTerm = (k: TdfTermKey, patch: { mode?: string; num?: number; value?: string }) => onEdit(o => {
    o.terms = o.terms || ({} as any);
    const prev = o.terms[k] || { value: '', source: '' };
    const f = { mode: patch.mode ?? termFields(k, prev).mode, num: 'num' in patch ? patch.num : termFields(k, prev).num };
    const value = patch.value !== undefined ? patch.value : termValueFromFields(k, f);
    const next: TdfTerm = { value, source: value ? 'user' : '' };
    if (f.mode) next.mode = f.mode;
    if (f.num !== undefined && Number.isFinite(f.num)) next.num = f.num;
    if (prev.raw) next.raw = prev.raw;
    o.terms[k] = next;
  });
  const pay = fields('payment');
  const del = fields('delivery');
  const place = fields('deliveryPlace');
  const val = fields('validity');
  const freight = Number(offer.freightAmount) || 0;
  const request = missingTermsRequest(offer);
  const warnings = (offer.readWarnings || []).map(cleanReadWarning);

  return (
    <div className={`bg-white border rounded-xl p-4 flex flex-col gap-3 min-w-0 ${isPrevious ? 'border-dashed border-slate-300 opacity-90' : 'border-slate-200'}`}>
      <div className="flex justify-between gap-2 items-start">
        <div className="min-w-0 flex-1">
          {isPrevious && <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Önceki teklif · indirim takibinde kullanılır</div>}
          <input value={offer.supplier} onChange={e => onEdit(o => { o.supplier = e.target.value; })} className="font-bold text-slate-900 w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-indigo-400 outline-none" aria-label="Firma adı" />
          <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
            <span>{offerDocLabel(offer)}</span>
            {offer.fileUrl && <a href={offer.fileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">belgeyi aç</a>}
          </div>
        </div>
        <div className="text-right whitespace-nowrap">
          <div className="font-mono font-semibold text-slate-900">{rub((offer.totalAmount || linesTotal))} ₽</div>
          <div className="text-[11px] text-slate-500">KDV dahil · {offer.lines.length} satır{covered !== undefined ? ` · ${covered}/${nMat} kalem` : ''}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <TermRow label={TDF_TERM_LABELS.payment.tr} t={term('payment')}>
          <Seg options={[['advance', 'Avans'], ['deferred', 'Vadeli']]} value={pay.mode} warn={!pay.mode}
            onChange={v => setTerm('payment', { mode: v, num: v === 'advance' ? (pay.mode === 'advance' ? pay.num : 100) : (pay.mode === 'deferred' ? pay.num : undefined) })} />
          {pay.mode === 'advance' && <NumBox value={pay.num} suffix="% avans" onChange={n => setTerm('payment', { mode: 'advance', num: n })} />}
          {pay.mode === 'deferred' && <NumBox value={pay.num} suffix="gün vade" placeholder="30" warn={!pay.num} onChange={n => setTerm('payment', { mode: 'deferred', num: n })} />}
        </TermRow>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TermRow label={TDF_TERM_LABELS.delivery.tr} t={term('delivery')}>
            <Seg options={[['stock', 'Stokta'], ['days', 'Gün']]} value={del.mode} warn={!del.mode}
              onChange={v => setTerm('delivery', { mode: v, num: v === 'stock' ? 0 : (del.mode === 'days' ? del.num : undefined) })} />
            {del.mode === 'days' && <NumBox value={del.num} suffix="gün" warn={!Number.isFinite(del.num)} onChange={n => setTerm('delivery', { mode: 'days', num: n })} />}
          </TermRow>
          <TermRow label={TDF_TERM_LABELS.validity.tr} t={term('validity')}>
            <NumBox value={val.num} suffix="gün" onChange={n => setTerm('validity', { mode: val.mode === 'workdays' ? 'workdays' : 'days', num: n })} />
          </TermRow>
        </div>
        <TermRow label={TDF_TERM_LABELS.deliveryPlace.tr} t={term('deliveryPlace')}>
          <Seg options={[['site', 'Şantiye teslim'], ['factory', 'Fabrika / depo teslim']]} value={place.mode} warn={!place.mode} onChange={v => setTerm('deliveryPlace', { mode: v })} />
        </TermRow>
        <div className="flex flex-col gap-1">
          <span className="flex justify-between items-center gap-1 text-xs text-slate-500">Nakliye
            {freight > 0
              ? <span className="text-[10px] px-1.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">ayrı bedel</span>
              : place.mode === 'factory'
                ? <span className="text-[10px] px-1.5 rounded-full bg-amber-100 text-amber-700 font-semibold">bedel girilmedi</span>
                : <span className="text-[10px] px-1.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">fiyata dahil</span>}
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <NumBox value={freight || undefined} suffix="₽" w="w-24" placeholder={place.mode === 'factory' ? 'tahmini' : '0'} warn={place.mode === 'factory' && !freight}
              onChange={n => onEdit(o => { o.freightAmount = n && n > 0 ? n : undefined; })} />
            <span>{place.mode === 'factory' ? 'Fabrika teslimde nakliye bedelini yaz; genel toplama eklenir.' : 'Boş bırakılırsa nakliye fiyata dahil sayılır.'}</span>
          </div>
        </div>
        <TermRow label={TDF_TERM_LABELS.warranty.tr} t={term('warranty')} optional>
          <input value={term('warranty')?.value || ''} placeholder="ör. 12 ay" onChange={e => setTerm('warranty', { value: e.target.value })}
            className="border border-slate-200 rounded-lg px-2.5 py-1 text-sm text-slate-900 bg-white w-40" />
        </TermRow>
      </div>

      {!!warnings.length && (
        <div className="flex flex-col gap-1">
          {warnings.map((w, i) => <div key={i} className="text-xs border-l-4 border-amber-400 bg-amber-50 text-amber-800 px-2 py-1 rounded-r">{w}</div>)}
        </div>
      )}
      {request && !isPrevious && (
        <button onClick={() => { navigator.clipboard?.writeText(request).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined); }}
          title={request} className="self-start text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Kopyalandı, firmaya gönderebilirsin' : 'Eksik bilgileri firmaya sor (Rusça mesajı kopyala)'}
        </button>
      )}
      <div className="border-t border-dashed border-slate-200 pt-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          <span className="flex justify-between">Satınalmacının notu <span className="text-[10px] px-1.5 rounded-full whitespace-nowrap bg-indigo-100 text-indigo-700 font-semibold">bütün çıktılarda görünür</span></span>
          <textarea value={offer.note || ''} rows={2} placeholder="Bu firma için notun varsa yaz"
            onChange={e => onEdit(o => { o.note = e.target.value; o.noteBy = userName; o.noteAt = new Date().toISOString(); })}
            className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 bg-slate-50" />
          {offer.noteBy && offer.note && <span className="text-[10px] text-slate-400">{offer.noteBy} · {fmtDate(offer.noteAt)}</span>}
        </label>
      </div>
      <div className="flex justify-between items-center gap-2">
        <button onClick={() => setShowLines(v => !v)} className="text-xs font-semibold text-indigo-600 flex items-center gap-1">{showLines ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}Kalemleri {showLines ? 'gizle' : 'gör / düzelt'}</button>
        {confirmDel
          ? <span className="flex gap-1"><button onClick={onDelete} className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-bold">Teklifi sil</button><button onClick={() => setConfirmDel(false)} className="px-2 py-1 rounded border text-xs">Vazgeç</button></span>
          : <button onClick={() => setConfirmDel(true)} className="text-xs text-slate-400 hover:text-rose-600 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />Sil</button>}
      </div>
      {showLines && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-500"><th className="text-left p-1">Kalem</th><th className="text-left p-1">Marka</th><th className="p-1">Birim</th><th className="p-1">Miktar</th><th className="p-1">Birim fiyat (KDV dahil)</th><th></th></tr></thead>
            <tbody>
              {offer.lines.map(l => (
                <tr key={l.id} className="align-top">
                  <td className="p-1 min-w-[150px]"><input value={l.name} onChange={e => setLine(l.id, { name: e.target.value })} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="p-1 w-24"><input value={l.brand || ''} onChange={e => setLine(l.id, { brand: e.target.value })} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="p-1 w-14"><input value={l.unit} onChange={e => setLine(l.id, { unit: e.target.value })} className="w-full border border-slate-200 rounded px-1.5 py-1" /></td>
                  <td className="p-1 w-20"><input type="number" step="any" value={l.quantity} onChange={e => setLine(l.id, { quantity: Number(e.target.value) })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-right" /></td>
                  <td className="p-1 w-24"><input type="number" step="any" value={l.unitPrice} onChange={e => setLine(l.id, { unitPrice: Number(e.target.value) })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-right" /></td>
                  <td className="p-1"><button onClick={() => onEdit(o => { o.lines = o.lines.filter(x => x.id !== l.id); })} className="text-slate-400 hover:text-rose-600" aria-label="Satırı sil"><X className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => onEdit(o => { o.lines.push({ id: `m_${Date.now()}`, name: '', unit: 'шт', quantity: 1, unitPrice: 0 }); })} className="mt-1 text-xs font-semibold text-indigo-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Satır ekle</button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Karşılaştırma adımı
// ---------------------------------------------------------------------------

function ComparisonStep({ form, computed, edit, aiBusy, aiError, onRunAi, matchBusy, onRunMatch }: {
  form: TdfForm; computed: ReturnType<typeof computeTdf>; edit: (fn: (f: TdfForm) => void) => void; aiBusy: boolean; aiError: string | null; onRunAi: () => void;
  matchBusy: boolean; onRunMatch: () => void;
}) {
  const S = computed.suppliers;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [showQuality, setShowQuality] = useState(false);
  const weights: TdfWeights = { ...DEFAULT_TDF_WEIGHTS, ...(form.weights || {}) };

  const mergeRows = (targetKey: string, sourceKey: string) => edit(f => {
    const c = computeTdf(f);
    const target = c.materials.find(m => m.key === targetKey);
    const source = c.materials.find(m => m.key === sourceKey);
    if (!target || !source) return;
    f.materialOverrides = { ...(f.materialOverrides || {}) };
    [target, source].forEach(m => Object.values(m.cells).forEach(cell => { if (cell) f.materialOverrides![cell.lineId] = targetKey; }));
  });
  const splitRow = (key: string) => edit(f => {
    const row = computeTdf(f).materials.find(m => m.key === key);
    if (!row) return;
    f.materialOverrides = { ...(f.materialOverrides || {}) };
    Object.values(row.cells).forEach(cell => { if (cell) f.materialOverrides![cell.lineId] = `ayri:${cell.lineId}`; });
  });

  const suggestions = computed.mergeSuggestions.filter(s => !dismissed.includes(`${s.a}|${s.b}`));
  const nameOf = (k: string) => computed.materials.find(m => m.key === k)?.name || k;
  const report = useMemo(() => buildTdfReport(form, computed), [form, computed]);

  if (!S.length) return <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">Önce teklif yükle; tablo burada oluşur.</div>;

  return (
    <div className="space-y-4">
      {!!report.kpis.length && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {report.kpis.map((k, idx) => (
            <div key={idx} className={`rounded-xl border p-3.5 ${idx === 0 ? 'bg-emerald-50/70 border-emerald-300 border-t-4 border-t-emerald-600' : 'bg-white border-slate-200 border-t-4 border-t-slate-800'}`}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k.k}</div>
              <div className="text-lg font-extrabold font-mono text-slate-900 mt-0.5">{k.v}</div>
              <div className="text-xs text-slate-500 mt-0.5">{k.h}</div>
            </div>
          ))}
        </div>
      )}

      {computed.recommendation && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Sistemin önerisi</div>
          <div className="font-bold text-slate-900 mt-1">{computed.recommendation.headline}</div>
          <ul className="list-disc pl-5 mt-1 text-sm text-slate-700 space-y-0.5">{computed.recommendation.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      {S.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-700">
            <span className="font-semibold">Aynı malzeme tek satırda standart adla gösterilir.</span>{' '}
            {form.aiMatchedAt && !form.aiMatchError
              ? <span className="text-slate-500">Firmaların kalemleri eşleştirildi ({fmtDate(form.aiMatchedAt)}). Yanlış eşleşme varsa satırdaki <Split className="w-3 h-3 inline" /> ile ayır.</span>
              : <span className="text-slate-500">Farklı yazılmış aynı ürünler teknik özelliklerine (çap, sınıf, boy, ГОСТ) göre otomatik eşleştirildi; firmanın yazdığı ad alt bilgi olarak görünür.</span>}
            {form.aiMatchError && <div className="text-xs text-amber-700 mt-0.5">Yapay zekâ eşleştirmesi yapılamadı: {form.aiMatchError}</div>}
          </div>
          <button onClick={onRunMatch} disabled={matchBusy} className="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
            {matchBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}Yapay zekâ ile eşleştir
          </button>
        </div>
      )}

      {!!suggestions.length && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="text-sm font-semibold text-amber-800">Benzer ama ayrı tutulan kalemler var. Aynı ürünse birleştir; değilse ayrı bırak.</div>
          {suggestions.map(s => (
            <div key={`${s.a}|${s.b}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-800">{nameOf(s.a)} <b className="text-slate-400">/</b> {nameOf(s.b)}</span>
              <span className="text-xs text-amber-700">({s.reason})</span>
              <button onClick={() => mergeRows(s.a, s.b)} className="px-2 py-1 rounded bg-amber-600 text-white text-xs font-bold">Aynı ürün, birleştir</button>
              <button onClick={() => setDismissed(d => [...d, `${s.a}|${s.b}`])} className="px-2 py-1 rounded border border-amber-300 text-amber-800 text-xs font-semibold">Ayrı kalsın</button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex flex-wrap justify-between gap-2 mb-2">
          <div>
            <div className="font-bold text-slate-900">Fiyat karşılaştırması · Сравнение цен</div>
            <div className="text-xs text-slate-500">Bütün fiyatlar KDV dahil (НДС 22%). Genel toplam nakliye dahildir. Sipariş miktarı değiştirilebilir; toplamlar ona göre hesaplanır.</div>
          </div>
          <div className="flex gap-3 text-xs text-slate-500 items-center flex-wrap">
            <span><span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300 align-middle mr-1" />en düşük</span>
            <span><span className="inline-block w-3 h-3 rounded bg-rose-100 border border-rose-300 align-middle mr-1" />en yüksek</span>
            <span><span className="inline-block w-3 h-3 rounded bg-amber-100 border-2 border-amber-500 align-middle mr-1" />teknik fark (bilgi amaçlı)</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse min-w-full">
            <thead>
              <tr>
                <th rowSpan={2} className="border border-slate-200 bg-slate-100 p-1.5">№</th>
                <th rowSpan={2} className="border border-slate-200 bg-slate-100 p-1.5 text-left min-w-[200px]">Standart Kalem Adı</th>
                <th rowSpan={2} className="border border-slate-200 bg-slate-100 p-1.5">Sipariş</th>
                {S.map(s => <th key={s.key} colSpan={3} className="border border-slate-200 bg-slate-900 text-white p-1.5 whitespace-nowrap">{shortSupplierName(s.name)}</th>)}
                <th colSpan={3} className="border border-slate-200 bg-yellow-100 p-1.5">En iyi fiyat</th>
                <th rowSpan={2} className="border border-slate-200 bg-slate-100 p-1.5"></th>
              </tr>
              <tr>
                {S.map(s => <React.Fragment key={s.key}><th className="border border-slate-200 bg-slate-100 p-1">Birim fiyat</th><th className="border border-slate-200 bg-slate-100 p-1">Toplam</th><th className="border border-slate-200 bg-slate-100 p-1">Teklif detayı · teslim</th></React.Fragment>)}
                <th className="border border-slate-200 bg-yellow-100 p-1">Firma</th><th className="border border-slate-200 bg-yellow-100 p-1">Fiyat</th><th className="border border-slate-200 bg-yellow-100 p-1">1.–2. fark</th>
              </tr>
            </thead>
            <tbody>
              {computed.materials.map((m, i) => <MatrixRow key={m.key} m={m} i={i} computed={computed} form={form} edit={edit} onMerge={mergeRows} onSplit={splitRow} />)}
              <tr className="bg-slate-50">
                <td colSpan={3} className="border border-slate-200 p-1.5 font-semibold">Malzeme toplamı</td>
                {S.map(s => <td key={s.key} colSpan={3} className="border border-slate-200 p-1.5 text-right font-mono">{rub(s.total)}{s.covered < computed.materials.length && <div className="text-[10px] font-normal text-amber-700">{s.covered}/{computed.materials.length} kalem</div>}</td>)}
                <td colSpan={3} className="border border-slate-200 p-1.5 text-right font-mono bg-yellow-50">{rub(computed.mixTotal)}<div className="text-[10px] font-normal text-slate-500">kalem kalem en iyi (nakliye hariç)</div></td>
                <td className="border border-slate-200" />
              </tr>
              <tr className="bg-slate-50">
                <td colSpan={3} className="border border-slate-200 p-1.5 font-semibold">Nakliye</td>
                {S.map(s => <td key={s.key} colSpan={3} className={`border border-slate-200 p-1.5 ${s.freightMode === 'missing' ? 'bg-amber-50 text-amber-700 font-semibold' : s.freightMode === 'separate' ? 'text-right font-mono' : 'text-emerald-700'}`}>{freightText(s)}</td>)}
                <td colSpan={4} className="border border-slate-200" />
              </tr>
              <tr className="bg-indigo-50 font-extrabold text-sm">
                <td colSpan={3} className="border border-slate-200 p-1.5">GENEL TOPLAM (nakliye dahil, KDV dahil)</td>
                {S.map(s => <td key={s.key} colSpan={3} className="border border-slate-200 p-1.5 text-right font-mono">{rub(s.grandTotal)}</td>)}
                <td colSpan={4} className="border border-slate-200" />
              </tr>
              {(['payment', 'delivery', 'deliveryPlace'] as const).map(k => (
                <tr key={k} className="bg-slate-50">
                  <td colSpan={3} className="border border-slate-200 p-1.5 font-semibold">{TDF_TERM_LABELS[k].tr}</td>
                  {S.map(s => { const t = s.offer.terms?.[k]; return <td key={s.key} colSpan={3} className={`border border-slate-200 p-1.5 ${t?.conflict ? 'bg-rose-50 text-rose-700' : !t?.value ? 'bg-amber-50 text-amber-700' : ''}`}>{t?.value || 'Teklifte yok'}{t?.conflict && <div className="text-[10px]">! {t.conflict}</div>}</td>; })}
                  <td colSpan={4} className="border border-slate-200" />
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td colSpan={3} className="border border-slate-200 p-1.5 font-semibold">Satınalmacının notu</td>
                {S.map(s => <td key={s.key} colSpan={3} className="border border-slate-200 p-1.5 whitespace-pre-line">{s.offer.note || ''}</td>)}
                <td colSpan={4} className="border border-slate-200" />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {!!computed.warnings.length && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="font-bold text-slate-900 mb-1">Dikkat edilecek noktalar</div>
          {computed.warnings.map((w, i) => (
            <div key={i} className={`grid grid-cols-[72px_1fr] gap-2 border rounded-lg p-2 text-sm ${w.level === 'critical' ? 'border-rose-300' : 'border-slate-200'}`}>
              <span className={`text-[10px] font-bold uppercase text-center rounded px-1 py-0.5 h-fit ${w.level === 'critical' ? 'bg-rose-100 text-rose-700' : w.level === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>{TDF_LEVEL_LABEL[w.level]}</span>
              <div><div className="text-slate-900">{w.text}</div>{w.action && <div className="text-xs text-slate-500">{w.action}</div>}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="font-bold text-slate-900">Puanlama ağırlıkları</div>
          <div className="text-xs text-slate-500 mb-2">Toplam 100 olması önerilir. Değişiklik formdaki puan tablosuna yansır.</div>
          <div className="grid grid-cols-5 gap-2">
            {([['price', 'Fiyat'], ['coverage', 'Kapsam'], ['payment', 'Ödeme'], ['delivery', 'Teslim'], ['documents', 'Belge']] as Array<[keyof TdfWeights, string]>).map(([k, label]) => (
              <label key={k} className="text-xs text-slate-500">{label}
                <input type="number" min={0} max={100} value={weights[k]} onChange={e => edit(f => { f.weights = { ...weights, [k]: Math.max(0, Number(e.target.value) || 0) }; })} className="mt-1 w-full border border-slate-200 rounded px-2 py-1 text-sm text-slate-900" />
              </label>
            ))}
          </div>
          <table className="w-full text-xs mt-3">
            <thead><tr className="text-slate-500"><th className="text-left">Firma</th><th>Fiyat</th><th>Kapsam</th><th>Ödeme</th><th>Teslim</th><th>Belge</th><th>Toplam</th></tr></thead>
            <tbody>{computed.scores.map(sc => <tr key={sc.supplierKey} className="text-center"><td className="text-left">{shortSupplierName(S.find(s => s.key === sc.supplierKey)?.name || '')}</td><td>{sc.price ?? '—'}</td><td>{sc.coverage}</td><td>{sc.payment}</td><td>{sc.delivery}</td><td>{sc.documents}</td><td className="font-bold">{sc.total}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-3">
          <div className="flex justify-between items-center gap-2">
            <div>
              <div className="font-bold text-slate-900">Ürün, marka ve firma araştırması</div>
              <div className="text-xs text-slate-500">Yapay zekâ internette arar; kaynak bulamazsa tahmin yazmaz.</div>
            </div>
            <button onClick={onRunAi} disabled={aiBusy} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap">{aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}{aiBusy ? 'Araştırılıyor…' : form.ai?.generatedAt ? 'Yenile' : 'Araştır'}</button>
          </div>
          {aiError && <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">Araştırma yapılamadı: {aiError}. Form yapay zekâ olmadan da hazırlanır; tekrar denemek için düğmeye bas.</div>}
          {form.ai?.generatedAt
            ? <>
              <div className="text-sm text-slate-700 space-y-1"><div className="text-xs text-slate-400">{fmtDate(form.ai.generatedAt)} · kaynakları kontrol edin</div>{form.ai.summary && <p>{form.ai.summary}</p>}</div>
              <div className="space-y-1.5">
                {S.map(s => {
                  const v = form.ai?.vendorChecks?.[s.key];
                  if (!v) return null;
                  const risk = (v.risk || '').toLowerCase();
                  const rc = /yüksek/.test(risk) ? 'bg-rose-100 text-rose-700' : /orta/.test(risk) ? 'bg-amber-100 text-amber-800' : /düşük/.test(risk) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';
                  return (
                    <div key={s.key} className="border border-slate-200 rounded-lg p-2 text-xs text-slate-700">
                      <div className="flex justify-between gap-2"><b className="text-slate-900">{shortSupplierName(s.name)}</b><span className={`px-1.5 rounded-full font-semibold ${rc}`}>risk: {v.risk || 'bilinmiyor'}</span></div>
                      {[v.status, v.founded ? `kuruluş ${v.founded}` : '', v.capital ? `sermaye ${v.capital}` : ''].filter(Boolean).length > 0 && <div className="text-slate-500">{[v.status, v.founded ? `kuruluş ${v.founded}` : '', v.capital ? `sermaye ${v.capital}` : ''].filter(Boolean).join(' · ')}</div>}
                      {v.notes && <div>{v.notes}</div>}
                      {v.reviews && <div><i>Yorumlar:</i> {v.reviews}</div>}
                      {!!v.sources?.length && <div className="truncate">{v.sources.slice(0, 3).map(u => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-indigo-600 underline mr-2">{u.replace(/^https?:\/\//, '').slice(0, 36)}</a>)}</div>}
                    </div>
                  );
                })}
              </div>
            </>
            : !aiError && <p className="text-xs text-slate-500">Her kalem için ürün ve marka bilgisi, kalite riskleri; her firma için resmi kayıt, risk ve müşteri yorumları getirir.</p>}
          <button onClick={() => setShowQuality(v => !v)} className="text-xs font-semibold text-indigo-600 flex items-center gap-1">{showQuality ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}Kalem bazında ürün ve kalite notları</button>
          {showQuality && (
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {computed.materials.map(m => {
                const ins = form.ai?.materialInsights?.[m.key];
                return (
                  <label key={m.key} className="block text-xs text-slate-600"><span className="font-semibold text-slate-800">{m.name}</span>
                    {form.ai?.qualityNotes?.[m.key] && <span className="block text-slate-500 italic">Kalite: {form.ai.qualityNotes[m.key]}</span>}
                    {ins?.product && <span className="block text-slate-500">Ürün: {ins.product}</span>}
                    {ins?.brand && <span className="block text-slate-500">Marka: {ins.brand}</span>}
                    {ins?.notes && <span className="block text-slate-500">Dikkat: {ins.notes}</span>}
                    <textarea rows={2} value={form.qualityNotes?.[m.key] || ''} onChange={e => edit(f => { f.qualityNotes = { ...(f.qualityNotes || {}), [m.key]: e.target.value }; })} placeholder="Satınalmacının kalite yorumu (isteğe bağlı)" className="mt-1 w-full border border-slate-200 rounded px-2 py-1 text-sm text-slate-900" />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MatrixRowProps {
  m: TdfMaterialRow; i: number; computed: ReturnType<typeof computeTdf>; form: TdfForm; edit: (fn: (f: TdfForm) => void) => void;
  onMerge: (target: string, source: string) => void; onSplit: (key: string) => void;
}
const MatrixRow: React.FC<MatrixRowProps> = ({ m, i, computed, form, edit, onMerge, onSplit }) => {
  const S = computed.suppliers;
  const comparableCount = S.filter(s => { const x = m.cells[s.key]; return x && !(x.warning && /Teknik fark|Birim farklı/.test(x.warning)); }).length;
  const [qtyText, setQtyText] = useState(String(m.orderQty));
  const spec = materialSpecText(m);
  useEffect(() => { setQtyText(String(m.orderQty)); }, [m.orderQty]);
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="border border-slate-200 p-1.5 text-right">{i + 1}</td>
      <td className="border border-slate-200 p-1.5 min-w-[220px]">
        <input value={form.materialNames?.[m.key] ?? m.name} onChange={e => edit(f => { f.materialNames = { ...(f.materialNames || {}), [m.key]: e.target.value }; })} className="w-full font-semibold text-slate-900 bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-indigo-300 rounded px-0.5" aria-label="Kalem adı" />
        {(spec || m.match === 'ai') && (
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {spec && <span className="text-[10px] text-slate-500 font-medium">{spec}</span>}
            {m.match === 'ai' && <span className="text-[10px] px-1.5 rounded bg-indigo-50 text-indigo-700 font-semibold">YZ eşleştirdi</span>}
          </div>
        )}
      </td>
      <td className="border border-slate-200 p-1 whitespace-nowrap">
        <input value={qtyText} onChange={e => setQtyText(e.target.value)} onBlur={() => { const v = Number(qtyText.replace(',', '.')); if (v > 0 && v !== m.orderQty) edit(f => { f.orderQty = { ...(f.orderQty || {}), [m.key]: v }; }); else setQtyText(String(m.orderQty)); }}
          className="w-20 text-right border border-slate-200 rounded px-1 py-0.5" aria-label="Sipariş miktarı" /> <span className="text-slate-500">{TDF_UNIT_LABEL[m.unit] || m.unit}</span>
      </td>
      {S.map(s => {
        const x = m.cells[s.key];
        if (!x) return <td key={s.key} colSpan={3} className="border border-slate-200 p-1.5 text-center text-slate-300">—</td>;
        const isLow = m.bestPrice !== null && Math.abs(x.unitPrice - m.bestPrice) < 0.005;
        const isHigh = comparableCount > 2 && m.worstPrice !== null && m.worstPrice !== m.bestPrice && Math.abs(x.unitPrice - m.worstPrice) < 0.005;
        const cls = x.warning ? 'bg-amber-50 text-amber-800 font-bold ring-1 ring-inset ring-amber-400' : isLow ? 'bg-emerald-50 text-emerald-700 font-bold' : isHigh ? 'bg-rose-50 text-rose-700' : '';
        const title = [x.name !== m.name ? `Teklifteki ad: ${x.name}` : '', x.brand ? `Marka: ${x.brand}` : '', x.warning || '', x.convertedFrom ? `Birim çevrildi: ${x.convertedFrom}` : ''].filter(Boolean).join('\n');
        const bn = cellBrandNote(m, s);
        const offName = cellOfferedName(m, s);
        const warnShort = x.warning ? x.warning.replace(/^Teknik fark:\s*/i, '') : '';
        return (
          <React.Fragment key={s.key}>
            <td className={`border border-slate-200 p-1.5 text-right font-mono whitespace-nowrap ${cls}`} title={title || undefined}>
              <div>{rub(x.unitPrice)}</div>
              {warnShort && <div className="text-[9.5px] font-sans font-semibold text-amber-700 leading-tight mt-0.5">⚠ {warnShort} · bilgi amaçlı</div>}
            </td>
            <td className="border border-slate-200 p-1.5 text-right font-mono whitespace-nowrap">{rub(x.total)}</td>
            <td className="border border-slate-200 p-1.5 text-slate-500 max-w-[165px]" title={x.name !== m.name ? x.name : undefined}>
              {bn && <div className="text-[10.5px] text-slate-600 leading-snug">{bn}</div>}
              {offName && <div className="text-[9.5px] text-slate-400 truncate leading-snug">{offName}</div>}
              {!bn && !offName && <span className="text-slate-300">—</span>}
            </td>
          </React.Fragment>
        );
      })}
      {m.bestPrice === null
        ? <td colSpan={3} className="border border-slate-200 p-1.5 bg-yellow-50 text-slate-500">kıyaslanabilir fiyat yok</td>
        : <>
          <td className="border border-slate-200 p-1.5 bg-yellow-50 font-semibold whitespace-nowrap">✓ {m.bestSuppliers.map(k => shortSupplierName(S.find(s => s.key === k)?.name || '')).join(', ')}</td>
          <td className="border border-slate-200 p-1.5 bg-yellow-50 text-right font-mono">{rub(m.bestPrice)}</td>
          <td className="border border-slate-200 p-1.5 bg-yellow-50 text-right">{m.diffBestSecond === null ? '—' : pct(m.diffBestSecond)}</td>
        </>}
      <td className="border border-slate-200 p-1 whitespace-nowrap">
        <select value="" onChange={e => { if (e.target.value) onMerge(e.target.value, m.key); }} className="text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white max-w-[120px]" title="Bu kalemi başka bir kalemle aynı ürün say">
          <option value="">Birleştir…</option>
          {computed.materials.filter(o => o.key !== m.key).map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
        </select>
        {m.offerCount > 1 && <button onClick={() => onSplit(m.key)} className="ml-1 text-slate-400 hover:text-indigo-600 align-middle" title="Firmaların satırlarını ayrı kalem yap"><Split className="w-3.5 h-3.5 inline" /></button>}
      </td>
    </tr>
  );
}

export default TdfView;
