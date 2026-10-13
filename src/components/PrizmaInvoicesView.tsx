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
  ShieldCheck
} from 'lucide-react';
import { formatRuble } from '../utils/format';
import { getPrizmaBtfUrl, getPrizmaStfUrl } from '../utils/prizmaUrlHelper';
import { PrizmaQuickCompareModal } from './PrizmaQuickCompareModal';
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
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-blue-500/40 text-blue-200 px-5 py-3 rounded-2xl shadow-2xl flex items-center space-x-3 text-sm animate-in fade-in slide-in-from-bottom-4">
          <Sparkles className="w-4 h-4 text-blue-400 animate-spin" />
          <span className="font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 rounded-3xl border border-blue-500/30 p-6 sm:p-8 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30">
                Prizma ERP (pm.gescons.ru) Canlı Entegrasyonu
              </span>
              <span className="text-xs text-slate-400">Son 3 Ay (90 Gün)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Prizma Satınalma Faturaları & Malzeme Veritabanı
            </h1>
            <p className="text-sm text-slate-300 max-w-3xl mt-1">
              GES Construction Prizma sistemindeki son 3 aya ait tüm sipariş (STF) ve ödeme talepleri (BTF) faturayla eşleşmiş olarak burada listelenir.
              Bu birim fiyatlar, <strong>Hızlı Ön Onay Denetimi</strong> ve <strong>Malzeme Kıyaslama</strong> motorunun referans tabanını oluşturur.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-purple-950/70 text-purple-300 border border-purple-500/40 font-semibold shadow-xs">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                <span>Otomatik Senkronizasyon: <strong>Her Akşam 21:00 & Gece 02:30</strong> (TSİ / Moskova)</span>
              </span>
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-blue-950/70 text-blue-300 border border-blue-500/30">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Kesinleşmiş Malzeme Faturaları (Taşeron & Hizmet elendi)</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => handleSync(1500)}
              disabled={syncing}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl font-bold text-xs sm:text-sm bg-blue-600 hover:bg-blue-500 text-white border border-blue-400/40 transition-all shadow-lg shadow-blue-950/40 cursor-pointer active:scale-95 disabled:opacity-50"
              title="Son 3 ayın en güncel 1.500 faturasını ve birim fiyatlarını çek"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Çekiliyor...' : '1.500 Fatura Güncelle'}</span>
            </button>

            <button
              onClick={() => handleSync(6000)}
              disabled={syncing}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl font-bold text-xs sm:text-sm bg-indigo-600/80 hover:bg-indigo-600 text-white border border-indigo-400/40 transition-all shadow-lg shadow-indigo-950/40 cursor-pointer active:scale-95 disabled:opacity-50"
              title="Son 3 aya ait tüm ödeme taleplerini (5.000+ fatura) derinlemesine tara ve senkronize et"
            >
              <Sparkles className="w-4 h-4 text-indigo-300" />
              <span>Tümünü Senkronize Et (5.000+ Fatura)</span>
            </button>

            <a
              href="https://pm.gescons.ru/process/payment-demand/2100/21009/list"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-2xl font-bold text-xs sm:text-sm bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all shadow-sm"
              title="Prizma Web Portalı - Ödeme Takip Listesini Aç"
            >
              <span className="font-black text-blue-400">П</span>
              <span>Prizma Ödeme Takip</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </a>
          </div>
        </div>

        {/* Live Sync Progress Bar */}
        {syncing && (
          <div className="mt-5 bg-slate-900/90 border border-blue-500/50 rounded-2xl p-4 shadow-inner animate-in fade-in">
            <div className="flex items-center justify-between text-xs text-blue-300 font-semibold mb-2">
              <span className="flex items-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                <span>{syncStatus?.progressMessage || 'Prizma verileri işleniyor...'}</span>
              </span>
              <span className="font-mono font-bold text-white">%{syncStatus?.progressPercent || 15}</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(10, syncStatus?.progressPercent || 15)}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Sync Status Banner */}
        {syncStatus && (
          <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Son Senkronizasyon: <strong className="text-slate-200">{syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString('tr-TR') : 'Henüz yapılmadı'}</strong></span>
              <span>•</span>
              <span>Kapsam: <strong className="text-blue-300">{syncStatus.dateRange}</strong></span>
              <span>•</span>
              <span>Kayıtlı Fatura: <strong className="text-emerald-300">{syncStatus.totalSynced} Adet</strong></span>
              <span>•</span>
              <span className="flex items-center space-x-1 text-purple-300">
                <Clock className="w-3.5 h-3.5" />
                <span>Plan: <strong>{syncStatus.autoSchedule || 'Her Akşam 21:00 & Gece 02:30'}</strong></span>
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Kullanıcı: <strong>berkant.senturk</strong> | Servis: <strong>pm.gescons.ru API</strong>
            </div>
          </div>
        )}
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Prizma Faturası</span>
            <FileText className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white">{summary.count}</div>
          <div className="text-[11px] text-slate-400 mt-1">Son 3 ay faturalı talep</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Toplam Fatura Hacmi</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 truncate">
            {formatRuble(summary.totalAmt)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">KDV dahil onaylanan tutar</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Malzeme Kalemi</span>
            <Package className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-300">{summary.totalMaterials}</div>
          <div className="text-[11px] text-slate-400 mt-1">Birim fiyatlı satınalma satırı</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>Farklı Tedarikçi</span>
            <Building2 className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300">{summary.uniqueSuppliersCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">Aktif çalışan firma</div>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl space-y-4 shadow-lg">
        {/* Row 1: Search and Reset */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Fatura No, Tedarikçi, INN, BTF/STF Kodu veya Malzeme Adı ile ara..."
              className="w-full pl-10 pr-9 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                title="Aramayı Temizle"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0 w-full md:w-auto justify-between md:justify-end">
            <div className="text-xs text-slate-400">
              <strong className="text-emerald-400 font-mono font-bold text-sm">{filteredInvoices.length}</strong> / {invoices.length} Fatura
            </div>

            {isAnyFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-slate-700 cursor-pointer shadow-xs"
                title="Tüm Filtreleri Sıfırla"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Filtreleri Sıfırla</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Select Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80">
          {/* Şantiye Filtresi */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
              <Building2 className="w-3 h-3 text-blue-400" />
              <span>Şantiye:</span>
            </label>
            <select
              value={selectedJobsite}
              onChange={e => setSelectedJobsite(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">Tüm Şantiyeler ({uniqueJobsites.length})</option>
              {uniqueJobsites.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>

          {/* Tedarikçi Filtresi */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
              <Filter className="w-3 h-3 text-amber-400" />
              <span>Tedarikçi:</span>
            </label>
            <select
              value={selectedSupplier}
              onChange={e => setSelectedSupplier(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">Tüm Tedarikçiler ({uniqueSuppliers.length})</option>
              {uniqueSuppliers.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Durum Filtresi */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>Onay / Durum:</span>
            </label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">Tüm Durumlar ({uniqueStatuses.length})</option>
              {uniqueStatuses.map(st => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          {/* Tarih Filtresi */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
              <Calendar className="w-3 h-3 text-purple-400" />
              <span>Tarih Aralığı:</span>
            </label>
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-hidden focus:border-blue-500"
            >
              <option value="all">Tüm Zamanlar</option>
              <option value="7d">Son 7 Gün</option>
              <option value="30d">Son 30 Gün</option>
              <option value="90d">Son 90 Gün (Önerilen)</option>
              <option value="custom">Özel Tarih Aralığı...</option>
            </select>
          </div>
        </div>

        {/* Optional Custom Date Inputs */}
        {dateFilter === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs animate-in fade-in">
            <span className="text-slate-400 font-semibold">Başlangıç:</span>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-hidden focus:border-blue-500"
            />
            <span className="text-slate-400 font-semibold ml-2">Bitiş:</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-hidden focus:border-blue-500"
            />
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-slate-400 hover:text-slate-200 text-[11px] underline ml-auto cursor-pointer"
              >
                Tarihleri Temizle
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
            <p className="text-sm">Prizma faturaları yükleniyor...</p>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Layers className="w-10 h-10 mx-auto text-slate-600 mb-3" />
            <p className="text-base font-bold text-slate-300">Henüz listelenecek Prizma faturası bulunamadı.</p>
            <p className="text-xs text-slate-500 mt-1">Yukarıdaki <strong>[Son 3 Ayı Prizma'dan Güncelle]</strong> butonuna basarak canlı senkronizasyonu başlatabilirsiniz.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Fatura No & Tarih</th>
                  <th className="py-3 px-4">Prizma Kodları (BTF / STF)</th>
                  <th className="py-3 px-4">Tedarikçi Firma & INN</th>
                  <th className="py-3 px-4">Şantiye</th>
                  <th className="py-3 px-4">Malzeme Kalemleri</th>
                  <th className="py-3 px-4 text-right">Fatura Tutarı</th>
                  <th className="py-3 px-4 text-center">Durum</th>
                  <th className="py-3 px-4 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-850/60 transition-colors">
                    {/* Fatura No & Tarih */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-white text-sm truncate max-w-[150px]">
                        {inv.invoiceNumber}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center space-x-1 mt-0.5">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>{inv.date}</span>
                      </div>
                    </td>

                    {/* Prizma Kodları */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col space-y-1">
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md font-mono text-[11px] font-bold bg-blue-950 text-blue-300 border border-blue-500/30 w-fit">
                          <span className="font-black text-blue-400">П</span>
                          <span>{inv.prizmaRequestCode}</span>
                        </span>
                        {inv.prizmaOrderCode && (
                          <span className="text-[11px] text-slate-400 font-mono">
                            Sipariş: <strong className="text-slate-300">{inv.prizmaOrderCode}</strong>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tedarikçi & INN */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200 truncate max-w-[220px]">
                        {inv.supplier}
                      </div>
                      {inv.supplierInn && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          INN: {inv.supplierInn}
                        </div>
                      )}
                    </td>

                    {/* Şantiye */}
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {inv.jobsiteName}
                      </span>
                    </td>

                    {/* Malzeme Kalemleri */}
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-purple-300 bg-purple-950/80 px-2 py-0.5 rounded-md border border-purple-500/30 text-[11px]">
                          {inv.items.length} Kalem
                        </span>
                        {inv.items[0] && (
                          <span className="text-[11px] text-slate-400 truncate max-w-[180px]" title={inv.items[0].materialName}>
                            {inv.items[0].materialName}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Fatura Tutarı */}
                    <td className="py-3 px-4 text-right">
                      <div className="font-black text-emerald-400 text-sm">
                        {formatRuble(inv.totalAmount)}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {inv.currency}
                      </div>
                    </td>

                    {/* Durum */}
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        inv.prizmaStatus === 'Tamamlandı'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-950 text-amber-300 border border-amber-500/40'
                      }`}>
                        {inv.prizmaStatus === 'Tamamlandı' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Clock className="w-3 h-3" />
                        )}
                        <span>{inv.prizmaStatus || 'İşlemde'}</span>
                      </span>
                    </td>

                    {/* İşlem */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => setSelectedInvoice(inv)}
                          className="px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
                          title="Fatura Detayı ve Kalem Birim Fiyatlarını İncele"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detay</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setCompareInvoice(inv)}
                          className="px-2.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-xs"
                          title="Bu faturadaki malzemeleri Piyasa Kıyaslama Kartında Aç"
                        >
                          <TrendingDown className="w-3.5 h-3.5" />
                          <span>Kıyasla</span>
                        </button>

                        <a
                          href={`/api/prizma/invoice-file/${inv.prizmaDemandId}?type=schet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1.5 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 hover:text-amber-100 border border-amber-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
                          title="Prizma'ya Yüklenmiş Orijinal Fatura Belgesini (Счет на оплату) Doğrudan Aç"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-400" />
                          <span>Счет на оплату</span>
                        </a>

                        <a
                          href={getPrizmaBtfUrl(inv.prizmaDemandId, inv.prizmaBtfUrl || inv.prizmaUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-300 hover:text-blue-100 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
                          title="Prizma Sisteminde Bu BTF Talebini Doğrudan Aç"
                        >
                          <span className="font-black text-blue-400">П</span>
                          <span>BTF</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>

                        {(inv.prizmaStfUrl || inv.prizmaOrderDemandId) && (
                          <a
                            href={getPrizmaStfUrl(inv.prizmaOrderDemandId, inv.prizmaStfUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-purple-100 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1"
                            title="Prizma Sisteminde Bu Sipariş (STF) Talebini Aç"
                          >
                            <span>STF</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
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
          <div className="p-4 bg-slate-950/90 border-t border-slate-800">
            <PaginationControls
              currentPage={safeCurrentPage}
              totalPages={totalPages}
              totalItems={filteredInvoices.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[25, 50, 100, 200]}
              itemLabel="Prizma faturası"
              dark={true}
            />
          </div>
        )}
      </div>

      {/* Invoice Detail & Material Rows Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-black text-blue-400 text-base">П</span>
                  <h2 className="text-lg font-black text-white">
                    Prizma Fatura Detayı: {selectedInvoice.invoiceNumber}
                  </h2>
                  <span className="text-[10px] font-bold bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full border border-blue-500/40">
                    {selectedInvoice.prizmaRequestCode}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Tedarikçi: <strong className="text-slate-200">{selectedInvoice.supplier}</strong> (INN: {selectedInvoice.supplierInn || '-'}) | Şantiye: <strong className="text-slate-200">{selectedInvoice.jobsiteName}</strong>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <a
                  href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=schet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all border border-emerald-400/40 flex items-center space-x-1.5 shadow-md shadow-emerald-950/40"
                  title="Prizma'ya Yüklenmiş Orijinal Fatura Belgesini (Счет на оплату) Doğrudan Aç"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Faturayı Aç (Счет на оплату)</span>
                </a>

                <a
                  href={getPrizmaBtfUrl(selectedInvoice.prizmaDemandId, selectedInvoice.prizmaBtfUrl || selectedInvoice.prizmaUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all border border-blue-400/40 flex items-center space-x-1.5 shadow-md shadow-blue-950/40"
                  title="Prizma Sisteminde Bu BTF Ödeme Talebini Aç"
                >
                  <span className="font-black">П</span>
                  <span>BTF'yi Prizma'da Aç</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {(selectedInvoice.prizmaStfUrl || selectedInvoice.prizmaOrderDemandId) && (
                  <a
                    href={getPrizmaStfUrl(selectedInvoice.prizmaOrderDemandId, selectedInvoice.prizmaStfUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-indigo-500/40 flex items-center space-x-1.5"
                    title="Prizma Sisteminde Bu Siparişi (STF) Aç"
                  >
                    <span>STF Aç</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                <a
                  href={`https://pm.gescons.ru/process/payment-demand/2100/21009/list`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-all border border-slate-700 flex items-center space-x-1"
                  title="Prizma Ödeme Takip Listesini Aç"
                >
                  <span>Prizma Liste</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Summary Info */}
            <div className="px-6 py-3 bg-slate-850 border-b border-slate-800 flex flex-wrap items-center justify-between text-xs gap-3">
              <div className="flex items-center space-x-3 text-slate-300">
                <span>Belge Tarihi: <strong>{selectedInvoice.date}</strong></span>
                <span>•</span>
                <span>Sipariş (STF): <strong>{selectedInvoice.prizmaOrderCode || '-'}</strong></span>
                <span>•</span>
                <span>Oluşturan: <strong>{selectedInvoice.prizmaCreatedBy || '-'}</strong></span>
              </div>
              <div className="text-emerald-400 font-black text-sm">
                Toplam: {formatRuble(selectedInvoice.totalAmount)} {selectedInvoice.currency}
              </div>
            </div>

            {/* Prizma Ekli Belgeler Seçim Çubuğu */}
            <div className="mx-6 mt-4 p-3.5 bg-slate-850/90 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
              <div className="flex items-center space-x-2 text-xs">
                <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-bold text-slate-200">Prizma Ekli Belgeler:</span>
                {loadingFiles && (
                  <span className="text-[11px] text-slate-400 italic">(Belgeler taranıyor...)</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {attachedFiles.length > 0 ? (
                  attachedFiles.map((file: any) => (
                    <a
                      key={file.id}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 border shadow-xs ${
                        file.isSchet
                          ? 'bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border-emerald-500/50'
                          : file.isUpd
                          ? 'bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white border-amber-500/50'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                      }`}
                      title={`${file.docTypeNameRU || file.docTypeNameTR} - ${file.fileName}`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{file.docTypeNameRU || file.docTypeNameTR}</span>
                      <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
                    </a>
                  ))
                ) : (
                  <>
                    <a
                      href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=schet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/50 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5"
                    >
                      <FileText className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Счет на оплату (Fatura)</span>
                    </a>
                    <a
                      href={`/api/prizma/invoice-file/${selectedInvoice.prizmaDemandId}?type=upd`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white border border-amber-500/50 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5"
                    >
                      <FileText className="w-3.5 h-3.5 text-amber-300" />
                      <span>УПД (Teslim / İrsaliye)</span>
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Prizma Bağlantı Bilgilendirme Notu */}
            <div className="mx-6 mt-4 p-3 bg-blue-950/40 border border-blue-800/40 rounded-2xl flex items-start space-x-3 text-xs text-blue-200">
              <div className="mt-0.5 p-1 bg-blue-900/60 rounded-lg text-blue-300 font-bold shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </div>
              <div className="leading-relaxed">
                <strong className="text-white">Prizma Bağlantı Kılavuzu:</strong> Prizma ERP sisteminde faturalar liste ekranı üzerinde <em>modal çekmece (popup)</em> şeklinde açıldığı için adres çubuğunda sabit bir link görünmeyebilir. Yukarıdaki <strong className="text-amber-300">"Faturayı Aç (PDF)"</strong> ile sisteme eklenmiş orijinal faturayı tarayıcıda hemen görüntüleyebilir, <strong className="text-blue-300">"BTF'yi Prizma'da Aç"</strong> ile sistemdeki onay sürecine (2100 - Ödeme Talep) direkt gidebilirsiniz.
              </div>
            </div>

            {/* Material Items Table */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Package className="w-4 h-4 text-purple-400" />
                  <span>Sipariş Kalemleri & Birim Fiyatlar ({selectedInvoice.items.length} Kalem)</span>
                </h3>
                <span className="text-[11px] text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800">
                  Fiyat Denetimi ve Kıyaslama Motoruna Dahil
                </span>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Malzeme Adı & Kodu</th>
                      <th className="py-2.5 px-3">Aktivite / İş Grubu</th>
                      <th className="py-2.5 px-3 text-right">Miktar</th>
                      <th className="py-2.5 px-3">Birim</th>
                      <th className="py-2.5 px-3 text-right">Birim Fiyat</th>
                      <th className="py-2.5 px-3 text-right">Toplam Tutar</th>
                      {onNavigateToCompare && (
                        <th className="py-2.5 px-3 text-center">Kıyasla</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {selectedInvoice.items.map((it, idx) => (
                      <tr key={it.id || idx} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 text-slate-500 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-200">{it.materialName}</div>
                          {it.materialCode && (
                            <div className="text-[10px] text-slate-500 font-mono">{it.materialCode}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-400 text-[11px]">
                          {it.activityName || selectedInvoice.description || '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-300">
                          {it.quantity}
                        </td>
                        <td className="py-2 px-3 font-semibold text-purple-300">
                          {it.unit}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-amber-300">
                          {formatRuble(it.unitPrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-black text-emerald-400">
                          {formatRuble(it.totalPrice)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setCompareInvoice(selectedInvoice);
                            }}
                            className="px-2 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center space-x-1"
                            title="Bu faturayı Piyasa Kıyaslama Kartında Aç"
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
            <div className="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCompareInvoice(selectedInvoice)}
                className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <TrendingDown className="w-3.5 h-3.5" />
                <span>Bu Faturayı Piyasa ile Kıyasla</span>
              </button>

              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Kapat
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
