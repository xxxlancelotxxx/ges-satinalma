import React, { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Jobsite, PurchasingSupervisor, Personnel, ComparativeAnalysisRecord } from '../types';
import { ComparativeOfferAnalysisModal } from './ComparativeOfferAnalysisModal';
import { formatRuble } from '../utils/format';
import {
  Scale,
  PlusCircle,
  Download,
  Search,
  Building2,
  Calendar,
  UserCheck,
  TrendingUp,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileCheck
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
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
        setAnalyses(Array.isArray(data) ? data : []);
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

  // Filter analyses
  const filteredAnalyses = useMemo(() => {
    return analyses.filter(a => {
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
        const invMatch = (a.finalInvoice?.documentNumber || a.invoiceNo || '').toLowerCase().includes(q);
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
              <span>{isRu ? 'Обязательный стандарт для закупок от 1 000 000 ₽' : '1.000.000 ₽ ve Üzeri Satınalma Zorunlu Standartı'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center space-x-3">
              <span>{isRu ? 'Сравнительный анализ коммерческих предложений (TDF)' : 'Karşılaştırmalı Teklif Analizi (1M+ ₽ TDF)'}</span>
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isRu
                ? 'Для всех закупок свыше 1 000 000 ₽ обязательно загружаются коммерческие предложения минимум 2 различных поставщиков. Фактическая экономия рассчитывается от минимальной рыночной цены на основе единичных расценок.'
                : '1 Milyon Ruble üzerindeki tüm malzeme ve hizmet alımlarında, en az 2 farklı tedarikçiden toplanan ilk tekliflerin en düşük birim fiyatı taban alınarak gerçek piyasa tasarrufu hesaplanır ve onaylı fatura ile sisteme işlenir.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0">
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-extrabold text-sm shadow-lg shadow-indigo-500/30 border border-indigo-400/40 flex items-center space-x-2.5 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <PlusCircle className="w-5 h-5 text-white" />
              <span>{isRu ? '+ Создать анализ (TDF 1M+ ₽)' : '+ Yeni 1M+ ₽ TDF Analizi Başlat'}</span>
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
              {isRu ? 'Всего записей TDF' : 'Toplam 1M+ ₽ TDF Kaydı'}
            </div>
            <div className="text-2xl font-black text-white">{metrics.count}</div>
            <div className="text-[10px] text-indigo-300 font-semibold mt-1">
              {isRu ? 'Анализы с документами' : 'Belgelenmiş onaylı analiz'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              {isRu ? 'Фактические закупки' : 'Toplam Gerçekleşen Alım'}
            </div>
            <div className="text-2xl font-black text-slate-100 font-mono">
              {formatRuble(metrics.totalFinal)}
            </div>
            <div className="text-[10px] text-slate-400 font-semibold mt-1">
              {isRu ? 'Сумма окончательных счетов' : 'Nihai fatura toplamı'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
              {isRu ? 'Рыночная экономия' : 'Sağlanan Net Tasarruf'}
            </div>
            <div className="text-2xl font-black text-emerald-400 font-mono">
              {formatRuble(metrics.totalSavings)}
            </div>
            <div className="text-[10px] text-emerald-300/80 font-semibold mt-1">
              {isRu ? 'От лучшего первого КП' : 'En düşük ilk teklif tabanından'}
            </div>
          </div>

          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-4 border border-slate-700/50">
            <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-1">
              {isRu ? 'Ср. ставка / Раунды' : 'Ort. İskonto / Müzakere'}
            </div>
            <div className="text-2xl font-black text-indigo-300">
              %{metrics.avgRate.toFixed(1)} <span className="text-xs font-normal text-slate-400">({metrics.avgRounds} tur)</span>
            </div>
            <div className="text-[10px] text-indigo-200/80 font-semibold mt-1">
              {isRu ? 'Средняя глубина торга' : 'Ortalama pazarlık derinliği'}
            </div>
          </div>
        </div>
      </div>

      {/* 3 Step Procedure Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-start space-x-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 font-black">
            1
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              {isRu ? '1. Загрузка первых КП' : '1. İlk Teklifleri / TDF Yükleyin'}
            </h3>
            <p className="text-xs text-slate-600">
              {isRu
                ? 'Загрузите КП минимум 2 поставщиков (PDF, Excel или фото).'
                : 'Piyasadan alınan en az 2 farklı tedarikçi teklifini (PDF/Excel) yükleyin.'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-start space-x-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 text-emerald-600 font-black">
            2
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              {isRu ? '2. Окончательный счет' : '2. Nihai Anlaşılan Faturayı Ekleyin'}
            </h3>
            <p className="text-xs text-slate-600">
              {isRu
                ? 'Прикрепите счет или накладную с итоговой согласованной суммой.'
                : 'Pazarlık sonucunda kesinleşen onaylı faturayı veya proformayı ekleyin.'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-start space-x-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 text-amber-600 font-black">
            3
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
              {isRu ? '3. ИИ расчет экономии' : '3. Otomatik Eşleştirme & Kayıt'}
            </h3>
            <p className="text-xs text-slate-600">
              {isRu
                ? 'ИИ сравнивает единичные расценки, рассчитывает реальную экономию и создает запись.'
                : 'Yapay zeka en ucuz birim fiyatı bulur, tasarrufu hesaplar ve onaylı indirim olarak kaydeder.'}
            </p>
          </div>
        </div>
      </div>

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
          {/* Jobsite filter */}
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

          {/* Supervisor filter */}
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

      {/* Analyses Table / List */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-extrabold text-slate-900">
              {isRu ? 'Записи сравнительного анализа (1M+ ₽)' : 'Kayıtlı 1M+ ₽ Karşılaştırmalı Teklif Analizleri'}
            </h2>
            <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredAnalyses.length}
            </span>
          </div>
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
              {isRu ? 'Записей сравнительного анализа не найдено' : 'Henüz kayıtlı 1M+ ₽ karşılaştırmalı analiz bulunamadı'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {isRu
                ? 'Нажмите кнопку выше, чтобы запустить процедуру сравнительного анализа для закупок свыше 1 млн рублей.'
                : '1.000.000 ₽ ve üzeri alımlarınız için yukarıdaki butondan yeni karşılaştırmalı teklif (TDF) analizi başlatabilirsiniz.'}
            </p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-2 px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition cursor-pointer"
            >
              {isRu ? '+ Создать новый анализ' : '+ Yeni 1M+ ₽ Analiz Başlat'}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4">{isRu ? 'Дата / Счет' : 'Tarih / Fatura No'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Объект' : 'Şantiye / Proje'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Ответственный шеф' : 'Sorumlu Şef'}</th>
                  <th className="py-3.5 px-4">{isRu ? 'Выбранный поставщик' : 'Seçilen Tedarikçi'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'База (Лучшее первое КП)' : 'İlk Teklif Tabanı'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'Итоговый счет' : 'Nihai Fatura'}</th>
                  <th className="py-3.5 px-4 text-right">{isRu ? 'Экономия' : 'Net Tasarruf'}</th>
                  <th className="py-3.5 px-4 text-center">{isRu ? 'Раунды' : 'Müzakere'}</th>
                  <th className="py-3.5 px-4 text-center">{isRu ? 'Действия' : 'İşlemler'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAnalyses.map((a) => {
                  const sav = Number(a.realMarketSavings ?? a.summary?.realMarketSavings ?? 0);
                  const fin = Number(a.totalFinalPurchase ?? a.summary?.finalPurchaseAmount ?? 0);
                  const init = Number(a.totalInitialLowestOffer ?? a.summary?.lowestInitialOfferAmount ?? (fin + sav));
                  const rate = Number(a.realSavingsRate ?? a.summary?.realSavingsPercentage ?? (init > 0 ? (sav / init) * 100 : 0));
                  const rounds = a.negotiationRoundsCount || (a.negotiationStages ? a.negotiationStages.length : 1);
                  const invNo = a.finalInvoice?.documentNumber || a.invoiceNo || 'TDF';
                  const dt = (a.date || a.finalInvoice?.date || a.created_at || '').split('T')[0];

                  return (
                    <tr key={a.id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900">{invNo}</div>
                        <div className="text-[10px] text-slate-500 flex items-center space-x-1 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{dt || '-'}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">{a.jobsiteName || 'Genel Şantiye'}</div>
                        <div className="text-[10px] text-slate-400">1M+ ₽ Proje</div>
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
                          {a.winningSupplier || a.finalInvoice?.supplier || 'Seçilen Tedarikçi'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {(a.canonicalMaterials || []).length} kalem malzeme
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-600">
                        {formatRuble(init)}
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatRuble(fin)}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="font-mono font-black text-emerald-600">
                          {formatRuble(sav)}
                        </div>
                        <div className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full inline-block mt-0.5">
                          %{rate.toFixed(1)}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {rounds} {isRu ? 'тур' : 'Tur'}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Integration */}
      <ComparativeOfferAnalysisModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        jobsites={jobsites}
        supervisors={supervisors}
        personnelList={personnel}
        onAnalysisSaved={() => {
          setIsModalOpen(false);
          loadAnalyses();
          onRefreshData?.();
          showToast(
            isRu
              ? 'Сравнительный анализ успешно сохранен с данными окончательного счета!'
              : 'Karşılaştırmalı analiz son anlaşılan fatura bilgileriyle başarıyla sisteme kaydedildi!'
          );
        }}
      />
    </div>
  );
};
