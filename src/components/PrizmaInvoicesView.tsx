import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  RefreshCw,
  Search,
  ExternalLink,
  Layers,
  Building2,
  DollarSign,
  Package,
  Calendar,
  Eye,
  CheckCircle2,
  Clock,
  Sparkles,
  X,
  TrendingDown,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  ShieldCheck,
  Database,
  ArrowRight
} from 'lucide-react';
import { formatRuble } from '../utils/format';
import { getPrizmaBtfUrl, getPrizmaStfUrl } from '../utils/prizmaUrlHelper';
import { PrizmaQuickCompareModal } from './PrizmaQuickCompareModal';
import { ensureRussianOriginalName } from '../utils/categoryClassifier';
import { PaginationControls } from './PaginationControls';

interface PrizmaItem {
  id: string;
  materialName: string;
  originalName?: string;
  materialCode?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  vatPercentage?: number;
  activityName?: string;
  category?: string;
}

export interface PrizmaInvoice {
  id: string;
  invoiceNumber: string;
  date: string;
  supplier: string;
  vendorName: string;
  supplierInn?: string;
  totalAmount: number;
  currency: string;
  jobsiteName: string;
  category: string;
  description?: string;
  prizmaDemandId: number;
  prizmaRequestCode: string;
  prizmaOrderCode?: string;
  prizmaOrderDemandId?: number;
  prizmaUserProcessId?: number;
  prizmaStatus?: string;
  prizmaCreatedBy?: string;
  prizmaUrl: string;
  prizmaBtfUrl?: string;
  prizmaStfUrl?: string;
  invoiceFileId?: number;
  items: PrizmaItem[];
  isDeleted: boolean;
  prizmaSource: boolean;
  syncedAt: string;
}

interface SyncStatus {
  isSyncing: boolean;
  progressPercent?: number;
  progressMessage?: string;
  lastSyncAt: string | null;
  lastError: string | null;
  totalSynced: number;
  totalAmount: number;
  uniqueSuppliers: number;
  uniqueJobsites: number;
  totalItems: number;
  dateRange: string;
  autoSchedule?: string;
}

interface Props {
  onNavigateToCompare?: (materialName: string) => void;
}

export const PrizmaInvoicesView: React.FC<Props> = ({ onNavigateToCompare }) => {
  const [invoices, setInvoices] = useState<PrizmaInvoice[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedJobsite, setSelectedJobsite] = useState<string>('all');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState<PrizmaInvoice | null>(null);
  const [compareInvoice, setCompareInvoice] = useState<PrizmaInvoice | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<any[]>([]);
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [integrating, setIntegrating] = useState<boolean>(false);
  const [integrationModal, setIntegrationModal] = useState<{
    addedCount: number;
    enrichedCount: number;
    skippedCount: number;
    totalPrizma: number;
    message: string;
  } | null>(null);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedJobsite, selectedSupplier, selectedStatus, dateFilter, startDate, endDate, pageSize]);

  const isAnyFilterActive = searchTerm !== '' || selectedJobsite !== 'all' || selectedSupplier !== 'all' || selectedStatus !== 'all' || dateFilter !== 'all' || startDate !== '' || endDate !== '';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedJobsite('all');
    setSelectedSupplier('all');
    setSelectedStatus('all');
    setDateFilter('all');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  useEffect(() => {
    if (selectedInvoice?.prizmaDemandId) {
      setLoadingFiles(true);
      fetch(`/api/prizma/demand-files/${selectedInvoice.prizmaDemandId}`)
        .then(r => r.json())
        .then(data => {
          setAttachedFiles(Array.isArray(data.files) ? data.files : []);
        })
        .catch(() => setAttachedFiles([]))
        .finally(() => setLoadingFiles(false));
    } else {
      setAttachedFiles([]);
    }
  }, [selectedInvoice]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [invRes, statusRes] = await Promise.all([
        fetch('/api/prizma/invoices?_t=' + Date.now()),
        fetch('/api/prizma/sync-status?_t=' + Date.now())
      ]);

      if (invRes.ok) {
        const invData = await invRes.json();
        setInvoices(Array.isArray(invData) ? invData : (invData.data || []));
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setSyncStatus(statusData);
      }
    } catch (err: any) {
      console.error('Prizma data load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSync = async (maxItems: number = 1500) => {
    try {
      setSyncing(true);
      showToast(`Prizma'dan son 3 ayın fatura ve malzeme verileri çekiliyor (${maxItems} adet hedefleniyor)...`);
      
      const pollTimer = setInterval(async () => {
        try {
          const sRes = await fetch('/api/prizma/sync-status?_t=' + Date.now());
          if (sRes.ok) {
            const sData = await sRes.json();
            setSyncStatus(sData);
          }
        } catch (_) {}
      }, 1500);

      const res = await fetch('/api/prizma/sync-last-3-months', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxItems })
      });
      clearInterval(pollTimer);
      const data = await res.json();
      if (data.success) {
        showToast(`✓ ${data.syncedCount} adet Prizma faturası başarıyla güncellendi!`);
        await loadData();
      } else {
        showToast(`Hata: ${data.message || 'Senkronizasyon başarısız'}`);
      }
    } catch (err: any) {
      showToast(`Senkronizasyon hatası: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleIntegrateInvoices = async () => {
    try {
      setIntegrating(true);
      showToast('Prizma faturaları taranıyor, mükerrer kayıtlar elenerek sisteme aktarılıyor...');
      const res = await fetch('/api/prizma/integrate-invoices', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIntegrationModal({
          addedCount: data.addedCount,
          enrichedCount: data.enrichedCount,
          skippedCount: data.skippedCount,
          totalPrizma: data.totalPrizma,
          message: data.message
        });
        showToast(`✓ ${data.addedCount} yeni fatura sisteme eklendi, ${data.enrichedCount} fatura mükerrer olmadan zenginleştirildi!`);
        await loadData();
      } else {
        showToast(`Hata: ${data.error || 'Entegrasyon başarısız'}`);
      }
    } catch (err: any) {
      showToast(`Entegrasyon hatası: ${err.message}`);
    } finally {
      setIntegrating(false);
    }
  };

  // Distinct jobsites for filter
  const uniqueJobsites = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach(i => {
      if (i.jobsiteName) set.add(i.jobsiteName);
    });
    return Array.from(set).sort();
  }, [invoices]);

  // Distinct suppliers for filter
  const uniqueSuppliers = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach(i => {
      if (i.supplier) set.add(i.supplier);
    });
    return Array.from(set).sort();
  }, [invoices]);

  // Distinct statuses for filter
  const uniqueStatuses = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach(i => {
      if (i.prizmaStatus) set.add(i.prizmaStatus);
    });
    return Array.from(set).sort();
  }, [invoices]);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const now = Date.now();

    return invoices.filter(inv => {
      // Jobsite filter
      if (selectedJobsite !== 'all' && inv.jobsiteName !== selectedJobsite) return false;

      // Supplier filter
      if (selectedSupplier !== 'all' && inv.supplier !== selectedSupplier) return false;

      // Status filter
      if (selectedStatus !== 'all' && inv.prizmaStatus !== selectedStatus) return false;

      // Date range filter
      if (dateFilter !== 'all') {
        const invTime = inv.date ? new Date(inv.date).getTime() : 0;
        if (dateFilter === '7d' && now - invTime > 7 * 24 * 3600 * 1000) return false;
        if (dateFilter === '30d' && now - invTime > 30 * 24 * 3600 * 1000) return false;
        if (dateFilter === '90d' && now - invTime > 90 * 24 * 3600 * 1000) return false;
        if (dateFilter === 'custom') {
          if (startDate && inv.date < startDate) return false;
          if (endDate && inv.date > endDate) return false;
        }
      }

      if (!q) return true;
      return (
        (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(q)) ||
        (inv.supplier && inv.supplier.toLowerCase().includes(q)) ||
        (inv.supplierInn && inv.supplierInn.includes(q)) ||
        (inv.prizmaRequestCode && inv.prizmaRequestCode.toLowerCase().includes(q)) ||
        (inv.prizmaOrderCode && inv.prizmaOrderCode.toLowerCase().includes(q)) ||
        (inv.jobsiteName && inv.jobsiteName.toLowerCase().includes(q)) ||
        (inv.description && inv.description.toLowerCase().includes(q)) ||
        (inv.items && inv.items.some(it => (it.materialName || '').toLowerCase().includes(q)))
      );
    });
  }, [invoices, searchTerm, selectedJobsite, selectedSupplier, selectedStatus, dateFilter, startDate, endDate]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedInvoices = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredInvoices.slice(startIndex, startIndex + pageSize);
  }, [filteredInvoices, safeCurrentPage, pageSize]);

  // Summary Metrics
  const summary = useMemo(() => {
    const count = filteredInvoices.length;
    const totalAmt = filteredInvoices.reduce((acc, cur) => acc + (cur.totalAmount || 0), 0);
    const totalMaterials = filteredInvoices.reduce((acc, cur) => acc + (cur.items?.length || 0), 0);
    const uniqueSuppliersCount = new Set(filteredInvoices.map(i => i.supplier).filter(Boolean)).size;
    return { count, totalAmt, totalMaterials, uniqueSuppliersCount };
  }, [filteredInvoices]);

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-xl border border-slate-700 flex items-center space-x-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-4">
          <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Compact Executive Header & Sync Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg shrink-0 shadow-xs">
              П
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  Prizma Referans Faturaları & Birim Fiyat Arşivi
                </h1>
                <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>pm.gescons.ru Canlı</span>
                </span>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200" title="Prizma faturaları geçmiş fiyat referansı ve kıyaslama içindir; Genel Bakış Toplam Harcama tutarına dahil edilmez.">
                  <ShieldCheck className="w-3 h-3 text-amber-600" />
                  <span>Fiyat Referans Arşivi (Genel Harcamaya Katılmaz)</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-1">
                <span>
                  Son Senkron: <strong className="text-slate-700">{syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString('tr-TR') : 'Hazır'}</strong>
                </span>
                <span>•</span>
                <span className="flex items-center space-x-1">
                  <Clock className="w-3 h-3 text-indigo-500" />
                  <span>Otomatik: <strong className="text-slate-700">{syncStatus?.autoSchedule || '21:00 & 02:30'}</strong></span>
                </span>
                {syncStatus?.dateRange && (
                  <>
                    <span>•</span>
                    <span>Kapsam: <strong className="text-slate-700">{syncStatus.dateRange}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={handleIntegrateInvoices}
              disabled={integrating || syncing || invoices.length === 0}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
              title="Prizma faturalarını çift kayıt yapmadan malzeme kıyaslama veritabanıyla eşleştir"
            >
              <CheckCircle2 className={`w-3.5 h-3.5 ${integrating ? 'animate-spin' : ''}`} />
              <span>{integrating ? 'Eşleştiriliyor...' : 'Veritabanına Eşleştir'}</span>
            </button>

            <button
              onClick={() => handleSync(1500)}
              disabled={syncing || integrating}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
              title="Son 3 ayın en güncel 1.500 faturasını çek"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Çekiliyor...' : '1.500 Fatura Güncelle'}</span>
            </button>

            <button
              onClick={() => handleSync(6000)}
              disabled={syncing || integrating}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-all cursor-pointer disabled:opacity-50"
              title="Son 3 aya ait tüm ödeme taleplerini (5.000+ fatura) derinlemesine tara"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Tümünü Tara (5.000+)</span>
            </button>

            <a
              href="https://pm.gescons.ru/process/payment-demand/2100/21009/list"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl font-bold text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all"
              title="Prizma Web Portalı - Ödeme Takip Listesini Aç"
            >
              <span className="font-black text-indigo-600">П</span>
              <span>Portal</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>

        {/* Live Sync Progress Bar */}
        {syncing && (
          <div className="mt-3 pt-3 border-t border-slate-100 animate-in fade-in">
            <div className="flex items-center justify-between text-xs text-indigo-700 font-semibold mb-1.5">
              <span className="flex items-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                <span>{syncStatus?.progressMessage || 'Prizma verileri senkronize ediliyor...'}</span>
              </span>
              <span className="font-mono font-bold text-slate-900">%{syncStatus?.progressPercent || 15}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(10, syncStatus?.progressPercent || 15)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Compact KPI Ribbon */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200/90 border-l-4 border-l-indigo-500 px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Arşiv Fatura Sayısı</div>
            <div className="text-xl font-black text-slate-900 font-mono mt-0.5">{summary.count}</div>
            <div className="text-[10px] text-slate-400">Filtrelenen / Toplam: {invoices.length}</div>
          </div>
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <FileText className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 border-l-4 border-l-emerald-500 px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Referans İşlem Hacmi</div>
            <div className="text-lg sm:text-xl font-black text-emerald-600 font-mono mt-0.5 truncate">
              {formatRuble(summary.totalAmt)}
            </div>
            <div className="text-[10px] text-slate-400">Geçmiş fiyat baz hacmi</div>
          </div>
          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg shrink-0">
            <DollarSign className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 border-l-4 border-l-violet-500 px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Malzeme Satırı</div>
            <div className="text-xl font-black text-violet-700 font-mono mt-0.5">{summary.totalMaterials}</div>
            <div className="text-[10px] text-slate-400">Birim fiyatlı referans kalemi</div>
          </div>
          <div className="p-2 bg-violet-50 text-violet-600 rounded-lg">
            <Package className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 border-l-4 border-l-amber-500 px-4 py-3 rounded-xl shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Kayıtlı Tedarikçi</div>
            <div className="text-xl font-black text-amber-600 font-mono mt-0.5">{summary.uniqueSuppliersCount}</div>
            <div className="text-[10px] text-slate-400">Farklı tedarikçi firma</div>
          </div>
          <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
            <Building2 className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Unified Compact Filter & Search Bar */}
      <div className="bg-white border border-slate-200/90 p-3.5 rounded-2xl shadow-xs space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
          {/* Search Input */}
          <div className="relative md:col-span-4">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Fatura No, Tedarikçi, INN, BTF/STF veya Malzeme ara..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-indigo-500 transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Aramayı Temizle"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Şantiye */}
          <div className="md:col-span-2">
            <select
              value={selectedJobsite}
              onChange={e => setSelectedJobsite(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-medium focus:outline-hidden focus:bg-white focus:border-indigo-500"
            >
              <option value="all">Tüm Şantiyeler ({uniqueJobsites.length})</option>
              {uniqueJobsites.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>

          {/* Tedarikçi */}
          <div className="md:col-span-2">
            <select
              value={selectedSupplier}
              onChange={e => setSelectedSupplier(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-medium focus:outline-hidden focus:bg-white focus:border-indigo-500"
            >
              <option value="all">Tüm Tedarikçiler ({uniqueSuppliers.length})</option>
              {uniqueSuppliers.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Durum */}
          <div className="md:col-span-2">
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-medium focus:outline-hidden focus:bg-white focus:border-indigo-500"
            >
              <option value="all">Tüm Durumlar ({uniqueStatuses.length})</option>
              {uniqueStatuses.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          {/* Tarih Aralığı & Sıfırla */}
          <div className="md:col-span-2 flex items-center space-x-1.5">
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs text-slate-700 font-medium focus:outline-hidden focus:bg-white focus:border-indigo-500"
            >
              <option value="all">Tüm Zamanlar</option>
              <option value="7d">Son 7 Gün</option>
              <option value="30d">Son 30 Gün</option>
              <option value="90d">Son 90 Gün</option>
              <option value="custom">Özel Tarih...</option>
            </select>

            {isAnyFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-bold transition-all border border-rose-200 shrink-0 cursor-pointer"
                title="Tüm Filtreleri Sıfırla"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Optional Custom Date Inputs */}
        {dateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs animate-in fade-in">
            <span className="text-slate-500 font-semibold">Başlangıç:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-hidden focus:border-indigo-500"
            />
            <span className="text-slate-500 font-semibold ml-2">Bitiş:</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-700 focus:outline-hidden focus:border-indigo-500"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-indigo-600 hover:text-indigo-800 text-[11px] font-semibold underline ml-auto cursor-pointer"
              >
                Tarihleri Temizle
              </button>
            )}
          </div>
        )}
      </div>

      {/* Enterprise Table Container */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-7 h-7 animate-spin mx-auto text-indigo-600 mb-2.5" />
            <p className="text-xs font-semibold">Prizma referans faturaları yükleniyor...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Layers className="w-9 h-9 mx-auto text-slate-300 mb-2.5" />
            <p className="text-sm font-bold text-slate-700">Eşleşen Prizma faturası bulunamadı.</p>
            <p className="text-xs text-slate-400 mt-1">Arama kriterlerini değiştirebilir veya yukarıdan <strong>1.500 Fatura Güncelle</strong> butonunu kullanabilirsiniz.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Fatura No & Tarih</th>
                  <th className="py-3 px-4">Prizma Kodu (BTF / STF)</th>
                  <th className="py-3 px-4">Tedarikçi Firma & INN</th>
                  <th className="py-3 px-4">Şantiye</th>
                  <th className="py-3 px-4">Malzeme Kalemleri</th>
                  <th className="py-3 px-4 text-right">Fatura Tutarı</th>
                  <th className="py-3 px-4 text-center">Durum</th>
                  <th className="py-3 px-4 text-center">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedInvoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setSelectedInvoice(inv)}
                    className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                  >
                    {/* Fatura No & Tarih */}
                    <td className="py-2.5 px-4">
                      <div className="font-bold text-slate-900 text-xs group-hover:text-indigo-600 transition-colors truncate max-w-[150px]">
                        {inv.invoiceNumber}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center space-x-1 mt-0.5 font-mono">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        <span>{inv.date}</span>
                      </div>
                    </td>

                    {/* Prizma Kodları */}
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col space-y-0.5">
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md font-mono text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80 w-fit">
                          <span className="font-black text-indigo-600">П</span>
                          <span>{inv.prizmaRequestCode}</span>
                        </span>
                        {inv.prizmaOrderCode && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            STF: <strong className="text-slate-700">{inv.prizmaOrderCode}</strong>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tedarikçi & INN */}
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-800 truncate max-w-[210px]" title={inv.supplier}>
                        {inv.supplier}
                      </div>
                      {inv.supplierInn && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          INN: {inv.supplierInn}
                        </div>
                      )}
                    </td>

                    {/* Şantiye */}
                    <td className="py-2.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80">
                        {inv.jobsiteName}
                      </span>
                    </td>

                    {/* Malzeme Kalemleri */}
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col space-y-0.5">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded border border-violet-200 text-[10px] shrink-0">
                            {inv.items.length} Kalem
                          </span>
                          {inv.items[0] && (
                            <span className="text-xs font-medium text-slate-800 truncate max-w-[220px]" title={inv.items[0].materialName}>
                              {inv.items[0].materialName}
                            </span>
                          )}
                        </div>
                        {inv.items[0] && (
                          <div className="text-[10px] font-mono text-slate-500 truncate max-w-[250px]">
                            🇷🇺 {ensureRussianOriginalName(inv.items[0].materialName, inv.items[0].originalName)}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Fatura Tutarı */}
                    <td className="py-2.5 px-4 text-right">
                      <div className="font-black text-slate-900 font-mono text-xs sm:text-sm">
                        {formatRuble(inv.totalAmount)}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {inv.currency}
                      </div>
                    </td>

                    {/* Durum */}
                    <td className="py-2.5 px-4 text-center">
                      <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        inv.prizmaStatus === 'Tamamlandı'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {inv.prizmaStatus === 'Tamamlandı' ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Clock className="w-3 h-3 text-amber-600" />
                        )}
                        <span>{inv.prizmaStatus || 'İşlemde'}</span>
                      </span>
                    </td>

                    {/* İşlem */}
                    <td className="py-2.5 px-4 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center space-x-1">
                        <button
                          onClick={() => setSelectedInvoice(inv)}
                          className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1 cursor-pointer"
                          title="Fatura Detayı ve Kalem Birim Fiyatlarını İncele"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Detay</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setCompareInvoice(inv)}
                          className="px-2 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1 cursor-pointer"
                          title="Bu faturadaki malzemeleri Piyasa Kıyaslama Kartında Aç"
                        >
                          <TrendingDown className="w-3 h-3" />
                          <span>Kıyasla</span>
                        </button>

                        <a
                          href={`/api/prizma/invoice-file/${inv.prizmaDemandId}?type=schet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1"
                          title="Prizma'ya Yüklenmiş Orijinal Fatura Belgesini (Счет на оплату) Doğrudan Aç"
                        >
                          <FileText className="w-3 h-3 text-amber-600" />
                          <span>Счет</span>
                        </a>

                        <a
                          href={getPrizmaBtfUrl(inv.prizmaDemandId, inv.prizmaBtfUrl || inv.prizmaUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold transition-all flex items-center space-x-1"
                          title="Prizma Sisteminde Bu BTF Talebini Doğrudan Aç"
                        >
                          <span>BTF</span>
                          <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {!loading && filteredInvoices.length > 0 && (
          <div className="p-3.5 bg-slate-50/70 border-t border-slate-200">
            <PaginationControls
              currentPage={safeCurrentPage}
              totalPages={totalPages}
              totalItems={filteredInvoices.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[25, 50, 100, 200]}
              itemLabel="Prizma faturası"
              dark={false}
            />
          </div>
        )}
      </div>

      {/* Invoice Detail & Material Rows Modal (Clean Enterprise Light Modal) */}
      {selectedInvoice && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setSelectedInvoice(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-xs">П</span>
                  <h2 className="text-base sm:text-lg font-black text-white">
                    Fatura Detayı: {selectedInvoice.invoiceNumber}
                  </h2>
                  <span className="text-[11px] font-mono font-bold bg-indigo-500/20 text-indigo-200 px-2 py-0.5 rounded-md border border-indigo-400/30">
                    {selectedInvoice.prizmaRequestCode}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Tedarikçi: <strong className="text-white">{selectedInvoice.supplier}</strong> (INN: {selectedInvoice.supplierInn || '-'}) • Şantiye: <strong className="text-white">{selectedInvoice.jobsiteName}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=schet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-xs"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Счет на оплату (PDF)</span>
                </a>

                <a
                  href={getPrizmaBtfUrl(selectedInvoice.prizmaDemandId, selectedInvoice.prizmaBtfUrl || selectedInvoice.prizmaUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-xs"
                >
                  <span>BTF Aç</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                {(selectedInvoice.prizmaStfUrl || selectedInvoice.prizmaOrderDemandId) && (
                  <a
                    href={getPrizmaStfUrl(selectedInvoice.prizmaOrderDemandId, selectedInvoice.prizmaStfUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700 flex items-center space-x-1"
                  >
                    <span>STF Aç</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Summary Strip */}
            <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between text-xs gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
                <span>Belge Tarihi: <strong className="text-slate-900">{selectedInvoice.date}</strong></span>
                <span>•</span>
                <span>Sipariş (STF): <strong className="text-slate-900">{selectedInvoice.prizmaOrderCode || '-'}</strong></span>
                <span>•</span>
                <span>Oluşturan: <strong className="text-slate-900">{selectedInvoice.prizmaCreatedBy || '-'}</strong></span>
              </div>
              <div className="text-emerald-700 font-black font-mono text-sm">
                Toplam: {formatRuble(selectedInvoice.totalAmount)} {selectedInvoice.currency}
              </div>
            </div>

            {/* Prizma Ekli Belgeler Seçim Çubuğu */}
            <div className="mx-6 mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2 text-xs">
                <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-bold text-slate-700">Ekli Prizma Belgeleri:</span>
                {loadingFiles && (
                  <span className="text-[11px] text-slate-400 italic">(Taranıyor...)</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {attachedFiles.length > 0 ? (
                  attachedFiles.map((file: any) => (
                    <a
                      key={file.id}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 border ${
                        file.isSchet
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                          : file.isUpd
                          ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                          : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                      title={`${file.docTypeNameRU || file.docTypeNameTR} - ${file.fileName}`}
                    >
                      <FileText className="w-3 h-3" />
                      <span>{file.docTypeNameRU || file.docTypeNameTR}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                    </a>
                  ))
                ) : (
                  <>
                    <a
                      href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=schet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1"
                    >
                      <FileText className="w-3 h-3 text-emerald-600" />
                      <span>Счет на оплату (Fatura)</span>
                    </a>
                    <a
                      href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=upd`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1"
                    >
                      <FileText className="w-3 h-3 text-amber-600" />
                      <span>УПД (İrsaliye)</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Material Items Table */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                  <Package className="w-4 h-4 text-indigo-600" />
                  <span>Sipariş Kalemleri & Birim Fiyatlar ({selectedInvoice.items.length} Kalem)</span>
                </h3>
                <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                  Fiyat Kıyaslama Referansına Dahil
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-[11px]">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Malzeme Adı & Kodu</th>
                      <th className="py-2.5 px-3">Aktivite / İş Grubu</th>
                      <th className="py-2.5 px-3 text-right">Miktar</th>
                      <th className="py-2.5 px-3">Birim</th>
                      <th className="py-2.5 px-3 text-right">Birim Fiyat</th>
                      <th className="py-2.5 px-3 text-right">Toplam Tutar</th>
                      <th className="py-2.5 px-3 text-center">Kıyasla</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedInvoice.items.map((it, idx) => (
                      <tr key={it.id || idx} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                            <span>{it.materialName}</span>
                            {it.category && (
                              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                {it.category}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            🇷🇺 {ensureRussianOriginalName(it.materialName, it.originalName)}
                          </div>
                          {it.materialCode && (
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Kod: {it.materialCode}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {it.activityName || selectedInvoice.description || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                          {it.quantity}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-violet-700">
                          {it.unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                          {formatRuble(it.unitPrice)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700">
                          {formatRuble(it.totalPrice)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setCompareInvoice(selectedInvoice)}
                            className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-bold transition-all cursor-pointer inline-flex items-center space-x-1"
                          >
                            <TrendingDown className="w-3 h-3" />
                            <span>Kıyasla</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCompareInvoice(selectedInvoice)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <TrendingDown className="w-3.5 h-3.5" />
                <span>Bu Faturayı Piyasa ile Kıyasla</span>
              </button>

              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Integration Success & Deduplication Report Modal */}
      {integrationModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIntegrationModal(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Referans Veritabanı Eşleştirmesi Tamamlandı</h3>
                  <p className="text-xs text-slate-500">Çift Kayıt Korumalı Birim Fiyat Senkronizasyonu</p>
                </div>
              </div>
              <button
                onClick={() => setIntegrationModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Yeni Referans Kaydı</span>
                <span className="text-2xl font-black text-emerald-600 font-mono">+{integrationModal.addedCount}</span>
                <span className="text-[10px] text-slate-400 block">Kıyaslama motoruna eklendi</span>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mükerrer Engellenen</span>
                <span className="text-2xl font-black text-indigo-600 font-mono">{integrationModal.enrichedCount}</span>
                <span className="text-[10px] text-slate-400 block">Zenginleştirildi, çiftlenmedi</span>
              </div>
            </div>

            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 text-xs text-slate-700 space-y-1.5">
              <div className="flex items-center space-x-1.5 font-bold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Eşleştirme Özeti:</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {integrationModal.message}
              </p>
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => setIntegrationModal(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prizma Quick Market Comparison Modal */}
      {compareInvoice && (
        <PrizmaQuickCompareModal
          invoice={compareInvoice}
          onClose={() => setCompareInvoice(null)}
          onNavigateToCompare={onNavigateToCompare}
        />
      )}
    </div>
  );
};
