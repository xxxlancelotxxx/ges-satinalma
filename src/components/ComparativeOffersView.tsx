import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Jobsite, PurchasingSupervisor, Personnel, ComparativeAnalysisRecord } from '../types';
import { ComparativeOfferAnalysisModal } from './ComparativeOfferAnalysisModal';
import { ComparativeAnalysisDetailModal } from './ComparativeAnalysisDetailModal';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import {
  Scale,
  PlusCircle,
  Search,
  Building2,
  Calendar,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
  Layers,
  CheckCircle2,
  Eye,
  ChevronDown,
  ChevronUp,
  FileText,
  Edit3,
  ExternalLink,
  Boxes,
  TrendingDown,
  Award
} from 'lucide-react';

interface Props {
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  personnel: Personnel[];
  onNavigateToTab?: (tab: string) => void;
  onRefreshData?: () => void;
}

export const ComparativeOffersView: React.FC<Props> = ({
  jobsites = [],
  supervisors = [],
  personnel = [],
  onNavigateToTab,
  onRefreshData
}) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const isRu = language === 'ru';

  const [analyses, setAnalyses] = useState<ComparativeAnalysisRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedJobsite, setSelectedJobsite] = useState<string>('all');
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('all');
  const [showInlineWorkbench, setShowInlineWorkbench] = useState<boolean>(true);
  const [editingAnalysis, setEditingAnalysis] = useState<ComparativeAnalysisRecord | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDetailAnalysis, setSelectedDetailAnalysis] = useState<ComparativeAnalysisRecord | null>(null);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'x-session-token': user?.token || '',
    'x-user-role': encodeURIComponent(user?.role || ''),
    'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
    'x-user-name': encodeURIComponent(user?.displayName || '')
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const loadAnalyses = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/comparative-analyses?_t=${Date.now()}`, {
        headers: authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setAnalyses(list);
      }
    } catch (err: any) {
      console.error('[LOAD COMPARATIVE ANALYSES ERROR]:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyses();
  }, []);

  const handleDelete = async (id: string) => {
    const confirmText = isRu
      ? 'Вы уверены, что хотите удалить этот сравнительный анализ?'
      : 'Bu karşılaştırmalı teklif analizini silmek istediğinizden emin misiniz?';
    if (!window.confirm(confirmText)) return;

    try {
      setDeletingId(id);
      const res = await fetch(`/api/comparative-analyses/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok) {
        showToast(isRu ? 'Анализ успешно удален' : 'Analiz kaydı başarıyla silindi.');
        setAnalyses(prev => prev.filter(a => a.id !== id));
        onRefreshData?.();
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(`Hata: ${errData.error || 'Silme işlemi başarısız'}`);
      }
    } catch (err: any) {
      showToast(`Hata: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // Filter & Strict Deduplication (prevents duplicate TDF records with same supplier + invoice + amount)
  const filteredAnalyses = useMemo(() => {
    const seenCompositeKeys = new Set<string>();
    const uniqueAnalyses: ComparativeAnalysisRecord[] = [];

    for (const a of analyses) {
      if ((a as any).isDeleted) continue;
      const finalDoc = (a.documents || []).find(d => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'));
      const invNo = (
        a.finalInvoice?.documentNumber ||
        a.finalInvoiceDetails?.invoiceNumber ||
        a.summary?.finalInvoiceNumber ||
        finalDoc?.documentNumber ||
        a.invoiceNo ||
        ''
      ).trim().toLowerCase();
      const supKey = (a.winningSupplier || a.finalInvoiceDetails?.supplier || finalDoc?.supplier || '').trim().toLowerCase().replace(/["'«»]/g, '');
      const amountKey = Math.round(Number(a.totalFinalPurchase ?? a.summary?.finalPurchaseAmount ?? 0));

      const compositeKey = `${supKey}__${invNo}__${amountKey}`;

      if (!seenCompositeKeys.has(compositeKey)) {
        seenCompositeKeys.add(compositeKey);
        uniqueAnalyses.push(a);
      }
    }

    return uniqueAnalyses.filter(a => {
      if (selectedJobsite !== 'all' && a.jobsiteId !== selectedJobsite && a.jobsiteName !== selectedJobsite) {
        return false;
      }
      if (selectedSupervisor !== 'all' && a.supervisorId !== selectedSupervisor && a.supervisorName !== selectedSupervisor) {
        return false;
      }
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const supMatch = (a.winningSupplier || '').toLowerCase().includes(q);
        const jobMatch = (a.jobsiteName || '').toLowerCase().includes(q);
        const chefMatch = (a.supervisorName || '').toLowerCase().includes(q);
        const invMatch = (a.finalInvoice?.documentNumber || a.finalInvoiceDetails?.invoiceNumber || a.invoiceNo || '').toLowerCase().includes(q);
        return supMatch || jobMatch || chefMatch || invMatch;
      }
      return true;
    });
  }, [analyses, selectedJobsite, selectedSupervisor, searchTerm]);

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalSavings = 0;
    let totalInitial = 0;
    let totalFinal = 0;
    let totalRounds = 0;

    filteredAnalyses.forEach(a => {
      const sav = Number(a.realMarketSavings ?? a.summary?.realMarketSavings ?? 0);
      const fin = Number(a.totalFinalPurchase ?? a.summary?.finalPurchaseAmount ?? 0);
      const init = Number(a.totalInitialLowestOffer ?? a.summary?.lowestInitialOfferAmount ?? (fin + sav));
      const rounds = Number(a.negotiationRoundsCount || (a.negotiationStages ? a.negotiationStages.length : 1));

      totalSavings += sav;
      totalFinal += fin;
      totalInitial += init;
      totalRounds += rounds;
    });

    const avgRate = totalInitial > 0 ? (totalSavings / totalInitial) * 100 : 0;
    const avgRounds = filteredAnalyses.length > 0 ? (totalRounds / filteredAnalyses.length).toFixed(1) : '1.0';

    return {
      count: filteredAnalyses.length,
      totalSavings,
      totalFinal,
      totalInitial,
      avgRate,
      avgRounds
    };
  }, [filteredAnalyses]);

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl border border-indigo-500/30 flex items-center space-x-3 text-sm animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Hero Header */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white border border-indigo-500/20 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center space-x-2 bg-indigo-500/20 border border-indigo-500/30 px-3 py-1 rounded-full text-indigo-300 text-xs font-bold uppercase tracking-wider">
              <Scale className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isRu ? 'Форма оценки коммерческих предложений (TDF 1M+ ₽)' : 'TDF — Teklif Değerlendirme Formu & Dip Fiyat Analizi'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center space-x-3">
              <span>{isRu ? 'Сравнительный анализ коммерческих предложений (TDF)' : 'Karşılaştırmalı Teklif Analizi (1M+ ₽ TDF)'}</span>
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isRu
                ? 'Загрузите первые КП от разных компаний, промежуточные раунды торга и окончательный согласованный счет. Система автоматически находит самое низкое первое предложение (Dip Fiyat) и рассчитывает чистую экономию.'
                : 'Farklı firmalardan toplanan ilk teklifleri, varsa ara pazarlık tekliflerini ve en son nihai anlaşılan faturayı doğrudan aşağıdaki TDF çalışma alanına yükleyin. Sistem ilk gelen tekliflerden en düşük faturayı dip fiyat alarak son anlaşılan fatura ile arasındaki gerçek indirimi hesaplar ve sisteme işler.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0">
            <button
              onClick={() => {
                setEditingAnalysis(null);
                setShowInlineWorkbench(prev => !prev);
              }}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-extrabold text-sm shadow-lg shadow-indigo-500/30 border border-indigo-400/40 flex items-center space-x-2.5 transition-all cursor-pointer"
            >
              <PlusCircle className="w-5 h-5 text-white" />
              <span>
                {showInlineWorkbench
                  ? (isRu ? 'Скрыть панель загрузки TDF' : 'TDF Giriş Panelini Daralt')
                  : (isRu ? '+ Открыть панель TDF (Новый анализ)' : '+ Yeni TDF Analizi / Teklif Yükleme Panelini Aç')}
              </span>
            </button>
            <button
              onClick={loadAnalyses}
              className="p-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 transition-all cursor-pointer"
              title={isRu ? 'Обновить' : 'Yenile'}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* 4 KPI Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-indigo-500/20">
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              {isRu ? 'Всего записей TDF' : 'Toplam TDF Kaydı'}
            </div>
            <div className="text-2xl font-black text-white">{metrics.count}</div>
            <div className="text-[10px] text-indigo-300 font-semibold mt-1">
              {isRu ? 'Уникальные анализы без дубликатов' : 'Tekilleştirilmiş onaylı TDF analizi'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              {isRu ? 'База первых КП (Dip Fiyat)' : 'İlk Teklifler Dip Fiyat Toplamı'}
            </div>
            <div className="text-2xl font-black text-slate-200 font-mono">
              {formatRuble(metrics.totalInitial)}
            </div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1">
              {isRu ? 'Сумма минимальных первых КП' : 'En düşük ilk teklifler referansı'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              {isRu ? 'Фактические закупки' : 'Toplam Nihai Anlaşılan Fatura'}
            </div>
            <div className="text-2xl font-black text-white font-mono">
              {formatRuble(metrics.totalFinal)}
            </div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1">
              {isRu ? 'Сумма окончательных счетов' : 'Kesinleşen fatura toplamı'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-emerald-500/30">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
              {isRu ? 'Реальная экономия от Dip Fiyat' : 'Gerçek Dip Fiyat Tasarrufu'}
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {formatRuble(metrics.totalSavings)}
            </div>
            <div className="text-[10px] text-emerald-300/90 font-semibold mt-1">
              %{metrics.avgRate.toFixed(2)} {isRu ? 'ср. скидка' : 'ortalama gerçek indirim'} ({metrics.avgRounds} tur)
            </div>
          </div>
        </div>
      </div>

      {/* INLINE TDF WORKBENCH (Directly at the top of the tab!) */}
      {showInlineWorkbench && (
        <div className="transition-all duration-300">
          <ComparativeOfferAnalysisModal
            isOpen={true}
            inline={true}
            initialAnalysis={editingAnalysis}
            onClose={() => {
              setEditingAnalysis(null);
            }}
            jobsites={jobsites}
            supervisors={supervisors}
            personnelList={personnel}
            onAnalysisSaved={(saved) => {
              setEditingAnalysis(null);
              loadAnalyses();
              if (saved?.id) setExpandedRowId(saved.id);
              onRefreshData?.();
              showToast(
                isRu
                  ? 'Сравнительный анализ TDF успешно сохранен!'
                  : 'TDF karşılaştırmalı teklif analizi dip fiyat referansıyla başarıyla kaydedildi!'
              );
            }}
          />
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isRu ? 'Поиск по поставщику, объекту, шефу или номеру счета...' : 'Tedarikçi, şantiye, şef veya fatura no ile ara...'}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedJobsite}
            onChange={(e) => setSelectedJobsite(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
          >
            <option value="all">{isRu ? 'Все объекты' : 'Tüm Şantiyeler'}</option>
            {jobsites.map(j => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>

          <select
            value={selectedSupervisor}
            onChange={(e) => setSelectedSupervisor(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
          >
            <option value="all">{isRu ? 'Все шефы' : 'Tüm Şefler'}</option>
            {supervisors.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Analyses Table with Click-to-Expand Full Details */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-extrabold text-slate-900">
              {isRu ? 'Записи сравнительного анализа (TDF)' : 'Kayıtlı 1M+ ₽ Karşılaştırmalı Teklif Analizleri (TDF)'}
            </h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredAnalyses.length}
            </span>
          </div>
          <span className="text-[11px] text-indigo-600 font-semibold">
            {isRu ? '💡 Нажмите на любую строку, чтобы увидеть все загруженные КП и детали материалов' : '💡 Teklif belgelerini, ara turları ve malzeme kırılımını görmek için satıra tıklayın'}
          </span>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-xs font-bold text-slate-500">
              {isRu ? 'Загрузка сравнительных анализов...' : 'Karşılaştırmalı teklif analizleri yükleniyor...'}
            </div>
          </div>
        ) : filteredAnalyses.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Scale className="w-12 h-12 text-slate-300 mx-auto" />
            <div className="text-sm font-bold text-slate-700">
              {isRu ? 'Записей сравнительного анализа не найдено' : 'Henüz kayıtlı karşılaştırmalı analiz bulunamadı'}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4">{isRu ? 'Дата / Счет' : 'Tarih / Fatura No'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Объект' : 'Şantiye / Proje'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Ответственный шеф' : 'Sorumlu Şef'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Выбранный поставщик' : 'Nihai Anlaşılan Firma'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'База (Лучшее первое КП)' : 'İlk Teklif Dip Fiyatı'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'Итоговый счет' : 'Nihai Anlaşılan Fatura'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'Реальная экономия' : 'Gerçek Dip Fiyat İndirimi'}</th>
                  <th className="py-3.5 px-4 text-center">{isRu ? 'Документы / Туры' : 'Teklifler & Tur'}</th>
                  <th className="py-3.5 px-4 text-center">{isRu ? 'Действия' : 'İşlemler'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAnalyses.map((a) => {
                  const sav = Number(a.realMarketSavings ?? a.summary?.realMarketSavings ?? 0);
                  const fin = Number(a.totalFinalPurchase ?? a.summary?.finalPurchaseAmount ?? 0);
                  const init = Number(a.totalInitialLowestOffer ?? a.summary?.lowestInitialOfferAmount ?? (fin + sav));
                  const rate = Number(a.realSavingsRate ?? a.summary?.realSavingsPercentage ?? (init > 0 ? (sav / init) * 100 : 0));
                  const internalSav = Number(a.internalVendorSavings ?? a.summary?.internalSupplierSavings ?? 0);
                  const winningInitial = Number(a.summary?.winningSupplierInitialOffer ?? 0);
                  const lowestSupplier = a.summary?.lowestInitialOfferSupplier || 'En Düşük İlk Teklif';
                  const rounds = a.negotiationRoundsCount || (a.negotiationStages ? a.negotiationStages.length : 1);
                  const finalDoc = (a.documents || []).find(d => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'));
                  const invNo = a.finalInvoice?.documentNumber || a.finalInvoiceDetails?.invoiceNumber || a.summary?.finalInvoiceNumber || finalDoc?.documentNumber || a.invoiceNo || 'TDF';
                  const dt = (a.date || a.finalInvoice?.date || finalDoc?.date || a.created_at || '').split('T')[0];
                  const isExpanded = expandedRowId === a.id;
                  const docs = (a.documents || []).filter(d => !d.isExcluded);
                  const mats = (a.canonicalMaterials || []).filter(m => !m.isExcluded);

                  return (
                    <React.Fragment key={a.id}>
                      <tr
                        onClick={() => setSelectedDetailAnalysis(a)}
                        className="transition-colors cursor-pointer hover:bg-indigo-50/40 group"
                      >
                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-2">
                            <div>
                              <div className="font-extrabold text-slate-900 group-hover:text-indigo-600 transition-colors">#{invNo}</div>
                              <div className="text-[10px] text-slate-500 flex items-center space-x-1 mt-0.5">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                <span>{dt || '-'}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-800">{a.jobsiteName || 'Genel Şantiye'}</div>
                          <div className="text-[10px] text-slate-400">{a.analysisCode || 'TDF Analizi'}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-800">{a.supervisorName || '-'}</div>
                          {a.performedByPersonnelName && (
                            <div className="text-[10px] text-indigo-600 font-semibold">
                              {a.performedByPersonnelName}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-indigo-900">
                            {a.winningSupplier || a.finalInvoice?.supplier || finalDoc?.supplier || 'Seçilen Tedarikçi'}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {mats.length} kalem • {docs.length} belge
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="font-mono font-bold text-slate-800">
                            {formatRuble(init)}
                          </div>
                          <div className="text-[10px] text-indigo-700 font-semibold truncate max-w-[160px] ml-auto" title={lowestSupplier}>
                            Dip Teklif: {lowestSupplier}
                          </div>
                          {winningInitial > init && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              (Firma İlk: {formatRuble(winningInitial)})
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="font-mono font-black text-slate-900">
                            {formatRuble(fin)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {a.winningSupplier || finalDoc?.supplier || ''}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="font-mono font-black text-emerald-600">
                            {formatRuble(sav)}
                          </div>
                          <div className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full inline-block mt-0.5 border border-emerald-200">
                            %{rate.toFixed(2)}
                          </div>
                          {internalSav > sav && (
                            <div className="text-[10px] text-slate-400 mt-0.5" title="Kazanan firmanın kendi ilk teklifine göre yaptığı indirim">
                              Firma içi: {formatRuble(internalSav)}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {docs.length} Teklif / {rounds} {isRu ? 'тур' : 'Tur'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              onClick={() => setSelectedDetailAnalysis(a)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition border cursor-pointer flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-2xs"
                              title="TDF Karşılaştırmalı Teklif Değerlendirme Detayını Ayrı Ekranda Aç"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isRu ? 'Детали' : 'Detay'}</span>
                            </button>
                            <button
                              onClick={() => {
                                setEditingAnalysis(a);
                                setShowInlineWorkbench(true);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="p-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition border border-amber-200 cursor-pointer"
                              title="Analizi Yukarıdaki TDF Çalışma Alanında Düzenle / Belge Ekle"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={`/api/comparative-analyses/${a.id}/excel`}
                              download
                              className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200"
                              title={isRu ? 'Скачать Excel отчет' : 'Excel TDF Raporu İndir'}
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5" />
                            </a>
                            <button
                              onClick={() => handleDelete(a.id)}
                              disabled={deletingId === a.id}
                              className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition border border-rose-200 cursor-pointer disabled:opacity-50"
                              title={isRu ? 'Удалить' : 'Sil'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline detail removed in favor of dedicated top-level ComparativeAnalysisDetailModal */}
                      {false && isExpanded && (
                        <tr className="bg-slate-50/90 border-b border-indigo-100">
                          <td colSpan={9} className="p-5">
                            <div className="bg-white rounded-2xl border border-indigo-200/80 shadow-sm p-5 space-y-5">
                              {/* Top Summary Banner */}
                              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <Award className="w-5 h-5 text-indigo-600" />
                                    <h3 className="text-sm font-black text-slate-900">
                                      TDF Karşılaştırmalı Teklif Değerlendirme Detayı (#{invNo})
                                    </h3>
                                  </div>
                                  <p className="text-xs text-slate-600 mt-1">
                                    İlk teklifler havuzundaki en düşük dip fiyat: <strong className="text-indigo-900 font-mono">{formatRuble(init)}</strong> ({lowestSupplier})
                                    {' → '}Nihai anlaşılan fatura: <strong className="text-slate-900 font-mono">{formatRuble(fin)}</strong> ({a.winningSupplier})
                                    {' → '}Gerçek Piyasa İndirimi: <strong className="text-emerald-700 font-mono">{formatRuble(sav)} (%{rate.toFixed(2)})</strong>
                                    {winningInitial > init && (
                                      <span className="text-slate-500 ml-2">
                                        [Kazanan firmanın kendi ilk teklifi {formatRuble(winningInitial)} üzerinden firma içi indirim: {formatRuble(internalSav)}]
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <div className="flex items-center space-x-2 shrink-0">
                                  <button
                                    onClick={() => setSelectedDetailAnalysis(a)}
                                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                                  >
                                    Tam Ekran Görünüm
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingAnalysis(a);
                                      setShowInlineWorkbench(true);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition cursor-pointer flex items-center space-x-1.5"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    <span>TDF Çalışma Alanında Düzenle</span>
                                  </button>
                                </div>
                              </div>

                              {/* 1. Uploaded Documents / Offers Grid */}
                              <div>
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-3 flex items-center space-x-1.5">
                                  <FileText className="w-4 h-4 text-indigo-600" />
                                  <span>Yüklenen Teklifler, Ara Pazarlık Turları ve Nihai Fatura ({docs.length} Belge)</span>
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  {docs.map((docItem, dIdx) => {
                                    const role = docItem.documentRole;
                                    const isFinal = role === 'FINAL_INVOICE' || role === 'FINAL_OFFER';
                                    const isInitial = role === 'INITIAL_OFFER' || role === 'FIRST_OFFER' || role === 'COMPETITOR_FIRST_OFFER' || docItem.isInitialOffer;
                                    const isLowestDip = isInitial && docItem.supplier === lowestSupplier;

                                    return (
                                      <div
                                        key={docItem.id || dIdx}
                                        className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 ${
                                          isFinal
                                            ? 'bg-emerald-50/70 border-emerald-300'
                                            : isLowestDip
                                            ? 'bg-indigo-50/70 border-indigo-300'
                                            : 'bg-slate-50 border-slate-200'
                                        }`}
                                      >
                                        <div>
                                          <div className="flex items-center justify-between gap-2 mb-1">
                                            <span
                                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                                                isFinal
                                                  ? 'bg-emerald-600 text-white'
                                                  : isLowestDip
                                                  ? 'bg-indigo-600 text-white'
                                                  : isInitial
                                                  ? 'bg-slate-200 text-slate-800'
                                                  : 'bg-amber-100 text-amber-800'
                                              }`}
                                            >
                                              {isFinal
                                                ? 'Nihai Anlaşılan Fatura'
                                                : isLowestDip
                                                ? 'En Düşük İlk Teklif (Dip Fiyat)'
                                                : isInitial
                                                ? 'İlk Teklif (Rakip / İlk)'
                                                : 'Ara Pazarlık Teklifi'}
                                            </span>
                                            {docItem.documentNumber && (
                                              <span className="text-[10px] font-mono text-slate-500">
                                                No: #{docItem.documentNumber}
                                              </span>
                                            )}
                                          </div>
                                          <div className="font-extrabold text-slate-900 text-xs mt-1">
                                            {docItem.supplier || 'Tedarikçi'}
                                          </div>
                                          <div className="font-mono font-black text-sm text-slate-900 mt-1">
                                            {formatRuble(docItem.totalAmount || 0)}
                                          </div>
                                          {docItem.items && docItem.items.length > 0 && (
                                            <div className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                                              {docItem.items[0].originalName} ({docItem.items[0].quantity} {docItem.items[0].unit} × {formatRuble(docItem.items[0].unitPrice)})
                                            </div>
                                          )}
                                        </div>

                                        {docItem.fileUrl && (
                                          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                                            <span className="text-[10px] text-slate-500 truncate max-w-[160px]">
                                              {docItem.fileName || 'Belge.pdf'}
                                            </span>
                                            <button
                                              onClick={() => openOriginalFileViewer(docItem.fileUrl, docItem.fileName || 'Teklif.pdf', { invoiceNo: docItem.documentNumber })}
                                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 cursor-pointer"
                                            >
                                              <ExternalLink className="w-3 h-3" />
                                              <span>Belgeyi Aç</span>
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* 2. Canonical Material Comparison Matrix */}
                              {mats.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-3 flex items-center space-x-1.5">
                                    <Boxes className="w-4 h-4 text-indigo-600" />
                                    <span>Kalem Bazlı Birim Fiyat & Dip Fiyat Kıyaslama Tablosu ({mats.length} Kalem)</span>
                                  </h4>
                                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                                    <table className="w-full text-left border-collapse text-xs">
                                      <thead>
                                        <tr className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                                          <th className="py-2.5 px-3">Malzeme Tanımı</th>
                                          <th className="py-2.5 px-3 text-center">Standart Birim</th>
                                          <th className="py-2.5 px-3 text-right">Alınan Miktar</th>
                                          <th className="py-2.5 px-3 text-right">En Düşük İlk Teklif (Dip Birim)</th>
                                          <th className="py-2.5 px-3 text-right">Nihai Anlaşılan Birim</th>
                                          <th className="py-2.5 px-3 text-right">Kalem Net Tasarruf</th>
                                          <th className="py-2.5 px-3">Tüm Firma Teklifleri (Birim Bazlı)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {mats.map((m, mIdx) => {
                                          const qty = Number(m.purchasedQuantity || m.quantity || 1);
                                          const refUnit = Number(m.marketReferenceUnitPrice || m.lowestInitialUnitPrice || 0);
                                          const finUnit = Number(m.purchasedUnitPrice || m.finalUnitPrice || 0);
                                          const rowSav = Number(m.realMarketSavings ?? ((refUnit - finUnit) * qty));

                                          return (
                                            <tr key={m.id || mIdx} className="hover:bg-slate-50">
                                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                                <div>{m.commonName || m.canonicalName}</div>
                                                {m.materialType && (
                                                  <span className="text-[10px] text-indigo-600 font-bold">{m.materialType}</span>
                                                )}
                                              </td>
                                              <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                                                {m.standardUnit || 'Adet'}
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">
                                                {qty.toLocaleString('tr-TR')}
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono">
                                                <div className="font-bold text-indigo-900">{formatRuble(refUnit)}</div>
                                                <div className="text-[10px] text-slate-500">{m.marketReferenceSupplier || lowestSupplier}</div>
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono">
                                                <div className="font-bold text-slate-900">{formatRuble(finUnit)}</div>
                                                <div className="text-[10px] text-emerald-700">{m.purchasedSupplier || a.winningSupplier}</div>
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-600">
                                                {formatRuble(rowSav)}
                                              </td>
                                              <td className="py-2.5 px-3">
                                                <div className="flex flex-wrap gap-1.5">
                                                  {(m.lines || []).map((ln, lIdx) => (
                                                    <span
                                                      key={lIdx}
                                                      className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] text-slate-700 font-mono"
                                                      title={ln.conversionFormula || ln.originalName}
                                                    >
                                                      <strong>{ln.supplier}:</strong> {formatRuble(ln.standardUnitPrice || ln.unitPrice)}/{m.standardUnit}
                                                      {ln.conversionApplied && ln.conversionFormula ? ` (${ln.conversionFormula})` : ''}
                                                    </span>
                                                  ))}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Full Screen Detail Modal */}
      <ComparativeAnalysisDetailModal
        isOpen={!!selectedDetailAnalysis}
        onClose={() => setSelectedDetailAnalysis(null)}
        analysis={selectedDetailAnalysis}
        onEdit={(rec) => {
          setEditingAnalysis(rec);
          setShowInlineWorkbench(true);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onDelete={(id) => {
          handleDelete(id);
          setSelectedDetailAnalysis(null);
        }}
      />
    </div>
  );
};
