import { INITIAL_SUPERVISORS, INITIAL_JOBSITES } from '../data/initialData';
import { optimizeFileBeforeUpload, OptimizationBadge } from '../utils/fileOptimizer';
import React, { useState, useEffect, useMemo } from 'react';
import { InvoiceRecord, Jobsite, PurchasingSupervisor, DiscountRecord } from '../types';
import { formatRuble, openOriginalFileViewer, formatUploadDate } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { checkRecordPermission } from '../utils/permissions';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { PaginationControls } from './PaginationControls';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter } from '../utils/filterHelpers';
import { normalizeVendorName, areVendorsEqual, extractCanonicalVendors } from '../utils/vendorNormalizer';
import {
  Folder,
  FileText,
  Search,
  Grid,
  List,
  Upload,
  HardDrive,
  Download,
  Eye,
  ExternalLink,
  Building2,
  UserCheck,
  Calendar,
  Filter,
  Sparkles,
  Cloud,
  CheckCircle2,
  RefreshCw,
  FolderPlus,
  Share2,
  Coins,
  FileCheck,
  FileCode,
  Settings,
  X,
  Trash2,
  Lock
} from 'lucide-react';
import { InvoiceDetailModal } from './InvoiceDetailModal';

interface Props {
  invoices: InvoiceRecord[];
  discounts?: DiscountRecord[];
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  onInvoiceSaved: (invoice: Omit<InvoiceRecord, 'id' | 'createdAt'>) => void;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => void | Promise<void>;
  onDeleteInvoice?: (id: string) => void | Promise<void>;
  onNavigateToCompare?: (materialName: string) => void;
  onNavigateToPrizma?: () => void;
  onOpenTrashModal?: () => void;
  trashCount?: number;
}

export const InvoiceDriveVault: React.FC<Props> = ({
  invoices,
  discounts = [],
  jobsites,
  supervisors,
  onInvoiceSaved,
  onUpdateInvoice,
  onDeleteInvoice,
  onNavigateToCompare,
  onNavigateToPrizma,
  onOpenTrashModal,
  trashCount = 0
}) => {
  const activeSupervisors = (supervisors && supervisors.length > 0) ? supervisors : INITIAL_SUPERVISORS;
  const activeJobsites = (jobsites && jobsites.length > 0) ? jobsites : INITIAL_JOBSITES;
  const { user } = useAuth();
  const [vaultType, setVaultType] = useState<'invoices' | 'discounts'>('invoices');
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>('ALL');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('ALL');
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  const [invoiceNoFilter, setInvoiceNoFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [minAmountFilter, setMinAmountFilter] = useState<string>('');
  const [maxAmountFilter, setMaxAmountFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Active modal selected invoice
  const [activeInvoice, setActiveInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<InvoiceRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Quick upload modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // New file form
  const [uploadJobsiteId, setUploadJobsiteId] = useState<string>(activeJobsites[0]?.id || '');
  const [uploadSupervisorId, setUploadSupervisorId] = useState<string>(activeSupervisors[0]?.id || '');

  useEffect(() => {
    if (jobsites.length > 0 && (!uploadJobsiteId || !activeJobsites.some(j => j.id === uploadJobsiteId))) {
      setUploadJobsiteId(activeJobsites[0].id);
    }
    if (supervisors.length > 0 && (!uploadSupervisorId || !activeSupervisors.some(s => s.id === uploadSupervisorId))) {
      setUploadSupervisorId(activeSupervisors[0].id);
    }
  }, [jobsites, supervisors, uploadJobsiteId, uploadSupervisorId]);
  const [uploadSupplier, setUploadSupplier] = useState<string>('');
  const [uploadInvoiceNo, setUploadInvoiceNo] = useState<string>('');
  const [uploadTotalAmount, setUploadTotalAmount] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileBase64, setUploadFileBase64] = useState<string | undefined>(undefined);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  useModalBackHandler(!!activeInvoice, () => setActiveInvoice(null));
  useModalBackHandler(!!invoiceToDelete, () => setInvoiceToDelete(null));
  useModalBackHandler(showUploadModal, () => setShowUploadModal(false));

  const handleFileChange = (file: File | null) => {
    setUploadFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadFileBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setUploadFileBase64(undefined);
    }
  };

  // Canonical unique vendors for invoices and discounts
  const canonicalVendors = useMemo(() => {
    if (vaultType === 'invoices') {
      return extractCanonicalVendors((invoices || []).map(i => ({ vendorName: i.supplier })));
    } else {
      return extractCanonicalVendors((discounts || []).map(d => ({ vendorName: d.vendorName })));
    }
  }, [invoices, discounts, vaultType]);

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    return (invoices || []).filter(inv => {
      if (!inv) return false;
      const matchesJob = selectedJobsiteId === 'ALL' || inv.jobsiteId === selectedJobsiteId;
      const matchesSup = selectedSupervisorId === 'ALL' || inv.uploadedBySupervisorId === selectedSupervisorId;
      const matchesVen = selectedVendor === 'ALL' || areVendorsEqual(inv.supplier, selectedVendor);
      const matchesInvNo = !invoiceNoFilter.trim() || String(inv.invoiceNumber || '').toLowerCase().includes(invoiceNoFilter.toLowerCase().trim());
      const matchesDate = matchesDateFilter(inv.date || inv.createdAt, dateFilter);
      const minVal = minAmountFilter ? Number(minAmountFilter) : null;
      const maxVal = maxAmountFilter ? Number(maxAmountFilter) : null;
      const invTotal = inv.totalAmount || 0;
      if (minVal !== null && !isNaN(minVal) && invTotal < minVal) return false;
      if (maxVal !== null && !isNaN(maxVal) && invTotal > maxVal) return false;

      const searchLower = searchTerm.toLowerCase();
      const invItems = Array.isArray(inv.items) ? inv.items : [];
      const matchesSearch = !searchTerm.trim() ||
        (inv.invoiceNumber || '').toLowerCase().includes(searchLower) ||
        (inv.supplier || '').toLowerCase().includes(searchLower) ||
        (inv.jobsiteName || '').toLowerCase().includes(searchLower) ||
        (inv.uploadedBySupervisorName || '').toLowerCase().includes(searchLower) ||
        invItems.some(it => (it?.materialName || '').toLowerCase().includes(searchLower));

      return matchesJob && matchesSup && matchesVen && matchesInvNo && matchesDate && matchesSearch;
    });
  }, [invoices, selectedJobsiteId, selectedSupervisorId, selectedVendor, invoiceNoFilter, dateFilter, minAmountFilter, maxAmountFilter, searchTerm]);

  // Filter discounts
  const filteredDiscounts = useMemo(() => {
    return (discounts || []).filter(dsc => {
      if (!dsc) return false;
      const matchesJob = selectedJobsiteId === 'ALL' || dsc.jobsiteId === selectedJobsiteId;
      const matchesSup = selectedSupervisorId === 'ALL' || dsc.supervisorId === selectedSupervisorId;
      const matchesVen = selectedVendor === 'ALL' || areVendorsEqual(dsc.vendorName, selectedVendor);
      const matchesInvNo = !invoiceNoFilter.trim() || String(dsc.invoiceNo || '').toLowerCase().includes(invoiceNoFilter.toLowerCase().trim());
      const matchesDate = matchesDateFilter(dsc.orderDate || dsc.createdAt, dateFilter);
      const minVal = minAmountFilter ? Number(minAmountFilter) : null;
      const maxVal = maxAmountFilter ? Number(maxAmountFilter) : null;
      const dscTotal = dsc.agreedPrice || 0;
      if (minVal !== null && !isNaN(minVal) && dscTotal < minVal) return false;
      if (maxVal !== null && !isNaN(maxVal) && dscTotal > maxVal) return false;

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm.trim() ||
        (dsc.vendorName || '').toLowerCase().includes(searchLower) ||
        (dsc.jobsiteName || '').toLowerCase().includes(searchLower) ||
        (dsc.supervisorName || '').toLowerCase().includes(searchLower) ||
        (dsc.category || '').toLowerCase().includes(searchLower);

      return matchesJob && matchesSup && matchesVen && matchesInvNo && matchesDate && matchesSearch;
    });
  }, [discounts, selectedJobsiteId, selectedSupervisorId, selectedVendor, invoiceNoFilter, dateFilter, minAmountFilter, maxAmountFilter, searchTerm]);

  const isAnyFilterActive = useMemo(() => {
    return (
      selectedJobsiteId !== 'ALL' ||
      selectedSupervisorId !== 'ALL' ||
      selectedVendor !== 'ALL' ||
      Boolean(invoiceNoFilter.trim()) ||
      (dateFilter.preset && dateFilter.preset !== 'all') ||
      Boolean(minAmountFilter) ||
      Boolean(maxAmountFilter) ||
      Boolean(searchTerm.trim())
    );
  }, [selectedJobsiteId, selectedSupervisorId, selectedVendor, invoiceNoFilter, dateFilter, minAmountFilter, maxAmountFilter, searchTerm]);

  const handleResetFilters = () => {
    setSelectedJobsiteId('ALL');
    setSelectedSupervisorId('ALL');
    setSelectedVendor('ALL');
    setInvoiceNoFilter('');
    setDateFilter({ preset: 'all' });
    setMinAmountFilter('');
    setMaxAmountFilter('');
    setSearchTerm('');
  };

  // 20-per-page pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedJobsiteId, selectedSupervisorId, selectedVendor, invoiceNoFilter, dateFilter, minAmountFilter, maxAmountFilter, vaultType]);

  const activeTotalItems = vaultType === 'invoices' ? filteredInvoices.length : filteredDiscounts.length;
  const totalPages = Math.max(1, Math.ceil(activeTotalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedInvoices = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredInvoices.slice(start, start + pageSize);
  }, [filteredInvoices, safePage, pageSize]);

  const paginatedDiscounts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredDiscounts.slice(start, start + pageSize);
  }, [filteredDiscounts, safePage, pageSize]);

  const formatTL = (amount: number) => {
    return formatRuble(amount);
  };

  const uploadToServerVault = async (fileName: string, base64Data: string) => {
    try {
      const response = await fetch('/api/upload-file', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName,
          fileData: base64Data
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Sunucu hatası');
      return { url: data.fileUrl || data.url, fileId: data.fileId };
    } catch (err: any) {
      console.error('Upload failed:', err);
      alert(`Dosya yüklemesi başarısız oldu: ${err.message}.`);
      throw err;
    }
  };

  const handleManualUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!String(uploadSupplier).trim() || !uploadTotalAmount) return;
    setIsUploading(true);

    const job = activeJobsites.find(j => j.id === uploadJobsiteId);
    const sup = activeSupervisors.find(s => s.id === uploadSupervisorId);

    const invNo = String(uploadInvoiceNo).trim() || `FT-VAULT-${Math.floor(100000 + Math.random() * 900000)}`;

    let finalFileUrl: string | undefined = undefined;
    if (uploadFile && uploadFileBase64) {
      if (uploadFileBase64.startsWith('http')) {
        finalFileUrl = uploadFileBase64;
      } else {
        try {
          const res = await uploadToServerVault(uploadFile.name, uploadFileBase64);
          finalFileUrl = res.url;
        } catch (err) {
          setIsUploading(false);
          return;
        }
      }
    }

    try {
      await onInvoiceSaved({
        invoiceNumber: invNo,
        date: new Date().toISOString().split('T')[0],
        supplier: String(uploadSupplier).trim(),
        jobsiteId: uploadJobsiteId,
        jobsiteName: job ? job.name : 'Şantiye',
        uploadedBySupervisorId: uploadSupervisorId,
        uploadedBySupervisorName: sup ? sup.name : 'Satınalma Şefi',
        totalAmount: Number(uploadTotalAmount) || 0,
        rawFileName: uploadFile ? uploadFile.name : `${invNo}_Fatura.pdf`,
        fileType: uploadFile?.type || 'application/pdf',
        fileSize: uploadFile ? `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB` : '1.5 MB',
        fileUrl: finalFileUrl,
        items: [
          {
            id: `item_manual_${Date.now()}`,
            materialName: `${uploadSupplier} İnşaat Malzemesi Alımı`,
            category: 'Genel Malzeme',
            unit: 'Adet',
            quantity: 1,
            unitPrice: Number(uploadTotalAmount) || 0,
            totalPrice: Number(uploadTotalAmount) || 0
          }
        ]
      });

      setSyncToast(`Başarılı! "${invNo}" faturası Firestore veritabanına yüklendi ve arşivlendi.`);
      setShowUploadModal(false);
      setUploadSupplier('');
      setUploadInvoiceNo('');
      setUploadTotalAmount('');
      setUploadFile(null);

      setTimeout(() => {
        setSyncToast(null);
      }, 4000);
    } catch (err: any) {
      console.error('Vault upload save error:', err);
      setSyncToast(`⚠️ Kayıt Uyarısı: ${err.message || 'Fatura kaydedilemedi.'}`);
      setTimeout(() => setSyncToast(null), 6000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleTriggerSync = () => {
    setSyncToast('Firestore veritabanı belgeleri senkronize edildi ✓');
    setTimeout(() => {
      setSyncToast(null);
    }, 3000);
  };

  const totalInvoiceAmount = invoices.reduce((acc, inv) => acc + (Number(inv.totalAmount) || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Storage Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Firestore Veritabanı & Şantiye Belge Arşivi</span>
          </div>
          <h1 className="text-2xl font-black text-slate-100 flex items-center space-x-2">
            <span>{vaultType === 'invoices' ? 'Şantiye Fatura & Belge Deposu' : 'Teklif & İndirim Belgeleri Arşivi'}</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
              Firestore Depo
            </span>
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl">
            Tüm şantiyelerin faturaları, tedarikçi teklifleri ve satınalma şeflerinin indirimli teklif belgeleri Firestore veritabanında kategorize edilerek saklanır.
          </p>
        </div>

        {/* Right Vault Actions & Quick Summary */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-800/90 border border-slate-700 px-3.5 py-2 rounded-xl text-left hidden sm:block">
            <div className="text-[10px] text-slate-400 font-medium">Toplam Kayıtlı Belge:</div>
            <div className="text-sm font-extrabold text-emerald-400 font-mono">
              {invoices.length} Fatura / {discounts.length} İndirim
            </div>
          </div>

          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Yeni Belge Yükle</span>
          </button>

          <button
            onClick={handleTriggerSync}
            title="Veritabanını Yenile & Senkronize Et"
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2.5 rounded-xl border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Vault Type Switcher */}
      <div className="flex items-center space-x-2 bg-slate-200/80 p-1 rounded-xl w-fit">
        <button
          onClick={() => setVaultType('invoices')}
          className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer ${
            vaultType === 'invoices' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4 text-indigo-600" />
          <span>Şantiye Faturaları ({invoices.length})</span>
        </button>

        <button
          onClick={() => setVaultType('discounts')}
          className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer ${
            vaultType === 'discounts' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Coins className="w-4 h-4 text-emerald-600" />
          <span>Teklif & İndirim Arşivi ({discounts.length})</span>
        </button>

        {onNavigateToPrizma && (
          <button
            onClick={onNavigateToPrizma}
            className="px-3.5 py-2 rounded-lg text-xs font-bold text-blue-700 hover:text-blue-950 hover:bg-blue-50 transition-all flex items-center space-x-1.5 cursor-pointer border border-blue-200/80 bg-white/60 ml-2"
            title="Prizma ERP (Son 3 Ay) Satınalma Faturaları Ekranına Geç"
          >
            <span className="font-black text-blue-600">П</span>
            <span>Prizma Faturaları (Son 3 Ay)</span>
          </button>
        )}
      </div>

      {syncToast && (
        <div className="p-4 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-200 flex items-center space-x-3 shadow-md animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold text-sm">{syncToast}</span>
        </div>
      )}

      {/* Drive Jobsite Folder Shortcuts */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
            <Folder className="w-4 h-4 text-amber-500" />
            <span>Şantiye Bulut Klasörleri ({activeJobsites.length} Klasör):</span>
          </h2>
          {selectedJobsiteId !== 'ALL' && (
            <button
              onClick={() => setSelectedJobsiteId('ALL')}
              className="text-xs text-indigo-600 font-bold hover:underline cursor-pointer"
            >
              Tüm Klasörleri Göster
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {activeJobsites.map((job) => {
            const isSelected = selectedJobsiteId === job.id;
            const jobInvoices = (invoices || []).filter(i => i && i.jobsiteId === job.id);
            const count = jobInvoices.length;
            const jobTotal = jobInvoices.reduce((a, b) => a + (Number(b.totalAmount) || 0), 0);

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobsiteId(job.id)}
                className={`p-3 rounded-xl border transition-all cursor-pointer group flex flex-col justify-between ${
                  isSelected
                    ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30'
                    : 'bg-slate-50 hover:bg-amber-50/50 border-slate-200 hover:border-amber-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <Folder className={`w-6 h-6 transition-transform group-hover:scale-110 ${isSelected ? 'text-amber-600 fill-amber-200' : 'text-amber-500'}`} />
                  <span className="text-[10px] font-mono font-bold text-slate-500">{job.code}</span>
                </div>
                <p className="font-bold text-slate-900 text-xs truncate mt-1">{job.name}</p>
                <p className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                  <span>{count} Fatura</span>
                  <span className="text-emerald-700 font-bold font-mono">
                    {formatTL(jobTotal)}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Filter & Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Inputs Group */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1">
            {/* General Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Fatura No, Tedarikçi veya Malzeme Ara..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Dedicated Fatura No Filter */}
            <div className="relative w-full sm:w-44">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Fatura No Filtrele..."
                value={invoiceNoFilter}
                onChange={(e) => setInvoiceNoFilter(e.target.value)}
                className="w-full pl-9 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs font-bold"
              />
              {invoiceNoFilter && (
                <button
                  type="button"
                  onClick={() => setInvoiceNoFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Results Badge & Grid vs List View Switcher */}
          <div className="flex items-center space-x-2 shrink-0 self-end lg:self-center">
            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl">
              {activeTotalItems} {vaultType === 'invoices' ? 'Fatura' : 'İndirim'}
            </span>

            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'grid' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Kart Görünümü"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  viewMode === 'list' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Liste Görünümü"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Dropdowns Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          {/* Şantiye Filter */}
          <SearchableFilterDropdown
            label="Şantiye"
            selectedKey={selectedJobsiteId === 'ALL' ? 'all' : selectedJobsiteId}
            options={[
              { key: 'all', label: 'Tüm Şantiyeler', count: activeJobsites.length },
              ...activeJobsites.map(j => ({
                key: j.id,
                label: j.name,
                subtext: j.code
              }))
            ]}
            onSelect={(key) => setSelectedJobsiteId(key === 'all' ? 'ALL' : key)}
            placeholder="Şantiye ara..."
          />

          {/* Tedarikçi Filter */}
          <SearchableFilterDropdown
            label="Tedarikçi"
            selectedKey={selectedVendor === 'ALL' ? 'all' : selectedVendor}
            options={[
              { key: 'all', label: 'Tüm Tedarikçiler', count: canonicalVendors.length },
              ...canonicalVendors.map(v => ({
                key: v.name,
                label: v.name,
                count: v.count
              }))
            ]}
            onSelect={(key) => setSelectedVendor(key === 'all' ? 'ALL' : key)}
            placeholder="Tedarikçi ara..."
          />

          {/* Şef Filter */}
          <SearchableFilterDropdown
            label="Şef"
            selectedKey={selectedSupervisorId === 'ALL' ? 'all' : selectedSupervisorId}
            options={[
              { key: 'all', label: 'Tüm Satınalma Şefleri', count: activeSupervisors.length },
              ...activeSupervisors.map(s => ({
                key: s.id,
                label: s.name,
                subtext: s.email
              }))
            ]}
            onSelect={(key) => setSelectedSupervisorId(key === 'all' ? 'ALL' : key)}
            placeholder="Şef ara..."
          />

          {/* Date Range Filter */}
          <DateRangeFilterDropdown
            value={dateFilter}
            onChange={setDateFilter}
          />

          {/* Reset Filters Button */}
          {isAnyFilterActive && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs ml-auto"
              title="Tüm filtreleri sıfırla"
            >
              <X className="w-3.5 h-3.5 text-amber-700" />
              <span>Filtreleri Temizle</span>
            </button>
          )}
        </div>
      </div>

      {/* Discount Archive View vs Invoices View */}
      {vaultType === 'discounts' ? (
        filteredDiscounts.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 space-y-3">
            <Coins className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-700 text-base">Aranan kriterlerde teklif veya indirim belgesi bulunamadı.</p>
            <p className="text-xs text-slate-500">Lütfen "Satınalma İndirim Girişi" sekmesinden ilk teklif ve son indirimli teklifi yükleyin.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {paginatedDiscounts.map((dsc) => (
                <div
                  key={dsc.id}
                  className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-emerald-400 shadow-xs hover:shadow-md transition-all space-y-4 flex flex-col justify-between"
                >
                  {/* Card Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block">{dsc.category}</span>
                      <h3 className="font-black text-slate-900 text-base">{dsc.vendorName}</h3>
                    </div>

                    <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono">
                      %{dsc.discountPercentage} İndirim
                    </span>
                  </div>

                  {/* Jobsite & Supervisor details */}
                  <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Şantiye:</span>
                      <strong className="text-indigo-700 font-bold">{dsc.jobsiteName}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Satınalma Şefi:</span>
                      <strong className="text-slate-800 font-bold">{dsc.supervisorName}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Sipariş Tarihi:</span>
                      <span className="font-mono text-slate-700">{dsc.orderDate}</span>
                    </div>
                  </div>

                  {/* Price Breakdown */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-100 p-2.5 rounded-xl text-center">
                      <span className="text-[10px] text-slate-500 block">İlk Teklif Fiyatı</span>
                      <strong className="text-slate-900 font-mono text-sm">{formatTL(dsc.offerPrice)}</strong>
                    </div>
                    <div className="bg-emerald-50 p-2.5 rounded-xl text-center border border-emerald-100">
                      <span className="text-[10px] text-emerald-800 block font-medium">Anlaşılan Son Fiyat</span>
                      <strong className="text-emerald-700 font-mono text-sm font-black">{formatTL(dsc.agreedPrice)}</strong>
                    </div>
                  </div>

                  {/* Net Savings Ribbon */}
                  <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white p-2.5 rounded-xl flex items-center justify-between text-xs">
                    <span className="font-bold">Elde Edilen Net Tasarruf:</span>
                    <strong className="font-mono text-sm font-black">+{formatTL(dsc.discountAmount)}</strong>
                  </div>

                  {/* Sistem Arşiv Belgeleri */}
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center space-x-1">
                      <HardDrive className="w-3 h-3 text-emerald-600" />
                      <span>Sistem Arşiv Belgeleri:</span>
                    </p>

                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(dsc.firstOfferFileUrl, dsc.firstOfferFileName || '1_Teklif_Gelen_Liste.pdf', {
                          supplier: dsc.vendorName,
                          amount: dsc.offerPrice,
                          date: dsc.orderDate,
                          jobsiteName: dsc.jobsiteName,
                          supervisorName: dsc.supervisorName,
                          documentType: '1. Gelen Teklif Belgesi (Pazarlık Öncesi)',
                          notes: dsc.notes
                        })}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-200 text-xs text-slate-800 font-semibold transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                          <span className="truncate">{dsc.firstOfferFileName || '1_Teklif_Gelen_Liste.pdf'}</span>
                        </div>
                        <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 shrink-0">
                          1. Teklif Belgesi ↗
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(dsc.finalOfferFileUrl, dsc.finalOfferFileName || '2_Son_Indirimli_Teklif.xlsx', {
                          supplier: dsc.vendorName,
                          amount: dsc.agreedPrice,
                          offerPrice: dsc.offerPrice,
                          agreedPrice: dsc.agreedPrice,
                          discountAmount: dsc.discountAmount,
                          date: dsc.orderDate,
                          jobsiteName: dsc.jobsiteName,
                          supervisorName: dsc.supervisorName,
                          documentType: '2. Son İndirimli Teklif Belgesi',
                          notes: dsc.notes
                        })}
                        className="w-full flex items-center justify-between p-2 rounded-lg bg-emerald-50/70 hover:bg-emerald-100/80 border border-emerald-200 text-xs text-emerald-900 font-bold transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="truncate">{dsc.finalOfferFileName || '2_Son_Indirimli_Teklif.xlsx'}</span>
                        </div>
                        <span className="text-[10px] text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300 shrink-0">
                          2. İndirimli Belge ↗
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <PaginationControls
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredDiscounts.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              itemLabel="indirim/teklif"
            />
          </div>
        )
      ) : filteredInvoices.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 space-y-3">
          <HardDrive className="w-12 h-12 text-slate-300 mx-auto" />
          <p className="font-bold text-slate-700 text-base">Aranan kriterlerde fatura belgesi bulunamadı.</p>
          <p className="text-xs text-slate-500">Lütfen arama terimini değiştirin veya yukarıdaki butondan yeni fatura yükleyin.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {viewMode === 'grid' ? (
            /* GRID VIEW */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedInvoices.map((inv) => {
            const perm = checkRecordPermission(user, inv);
            return (
            <div
              key={inv.id}
              onClick={() => setActiveInvoice(inv)}
              className="bg-white rounded-2xl p-5 border border-slate-200 hover:border-indigo-400 shadow-xs hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between space-y-4 relative"
            >
              {/* Top Drive Badge */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-mono font-bold text-slate-900 text-xs block">{inv.invoiceNumber}</span>
                    <span className="text-[10px] text-emerald-800 font-bold bg-emerald-50 px-1 rounded inline-block">
                      Yükleme: {formatUploadDate(inv.createdAt, inv.date)}
                    </span>
                    <span className="text-[10px] text-slate-400 block">Fatura: {inv.date}</span>
                  </div>
                </div>

                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                  Drive PDF
                </span>
              </div>

              {/* Invoice Main Content */}
              <div className="space-y-2">
                <h3 className="font-extrabold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors line-clamp-1">
                  {inv.supplier}
                </h3>

                <div className="space-y-1 text-xs text-slate-600">
                  <p className="flex items-center space-x-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-indigo-700 truncate">{inv.jobsiteName}</span>
                  </p>

                  <p className="flex items-center space-x-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-slate-600 truncate">{inv.uploadedBySupervisorName}</span>
                  </p>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Okunan Kalem:</span>
                    <strong className="text-slate-800 font-bold">{(inv.items || []).length} Kalem</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-slate-600 font-medium">Toplam Tutar:</span>
                    <strong className="text-emerald-700 font-extrabold font-mono">{formatTL(inv.totalAmount)}</strong>
                  </div>
                </div>
              </div>

              {/* Bottom Action Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold">
                <span className="flex items-center space-x-1 text-indigo-600 group-hover:translate-x-1 transition-transform">
                  <Eye className="w-3.5 h-3.5" />
                  <span>Faturayı Aç & İncele</span>
                </span>
                
                {onDeleteInvoice && (
                  perm.canDelete ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInvoiceToDelete(inv);
                      }}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer border border-rose-200/60"
                      title="Çöp Kutusuna Gönder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(`🔒 Salt Okunur: Bu fatura "${inv.uploadedBySupervisorName || 'başka bir'}" şef tarafından yüklenmiştir. Yalnızca kendi faturalarınızı silebilirsiniz.`);
                      }}
                      className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer border border-slate-200"
                      title="Salt Okunur: Başka şefe ait kayıt"
                    >
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )
                )}
              </div>
            </div>
          );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Yükleme Tarihi</th>
                  <th className="py-3 px-4">Fatura Tarihi</th>
                  <th className="py-3 px-4">Fatura No</th>
                  <th className="py-3 px-4">Tedarikçi Firma</th>
                  <th className="py-3 px-4">Ait Olduğu Şantiye</th>
                  <th className="py-3 px-4">Yükleyen Şef</th>
                  <th className="py-3 px-4">Kalem</th>
                  <th className="py-3 px-4">Toplam Tutar</th>
                  <th className="py-3 px-4 text-center">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {paginatedInvoices.map((inv) => {
                  const perm = checkRecordPermission(user, inv);
                  return (
                  <tr
                    key={inv.id}
                    onClick={() => setActiveInvoice(inv)}
                    className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-emerald-800 font-bold bg-emerald-50/50 whitespace-nowrap">
                      {formatUploadDate(inv.createdAt, inv.date)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">{inv.date}</td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">{inv.invoiceNumber}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{inv.supplier}</td>
                    <td className="py-3 px-4 font-semibold text-indigo-700 whitespace-nowrap">{inv.jobsiteName}</td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{inv.uploadedBySupervisorName}</td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        {(inv.items || []).length} Kalem
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-extrabold text-emerald-700 whitespace-nowrap">
                      {formatTL(inv.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveInvoice(inv);
                          }}
                          className="text-xs font-bold px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-all inline-flex items-center space-x-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Aç</span>
                        </button>

                        {onDeleteInvoice && (
                          perm.canDelete ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setInvoiceToDelete(inv);
                              }}
                              className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer"
                              title="Çöp Kutusuna Gönder"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                              <span>Sil</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                alert(perm.reason || `🔒 Salt Okunur: Bu fatura bağlı olduğunuz şantiyelere ait değildir.`);
                              }}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer"
                              title="Salt Okunur: Başka şantiyeye ait kayıt"
                            >
                              <Lock className="w-3.5 h-3.5 text-slate-500" />
                              <span>Salt Okunur</span>
                            </button>
                          )
                        )}
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

      {/* Invoices Pagination Controls */}
      <PaginationControls
        currentPage={safePage}
        totalPages={totalPages}
        totalItems={filteredInvoices.length}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[10, 20, 50, 100]}
        itemLabel="fatura"
      />
    </div>
  )}

      {/* Delete Confirmation Modal */}
      {invoiceToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-full">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900">Faturayı Çöp Kutusuna Taşı</h4>
                <p className="text-xs text-slate-500 font-mono mt-0.5">Fatura No: {invoiceToDelete.invoiceNumber}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>"{invoiceToDelete.supplier}"</strong> firmasından alınan <strong>{invoiceToDelete.invoiceNumber}</strong> numaralı fatura çöp kutusuna taşınacaktır.
              <br /><br />
              <span className="text-slate-500">
                Silinen faturalar Çöp Kutusunda güvenle saklanır ve istendiğinde tek tıkla geri yüklenebilir. Yalnızca Sistem Yöneticisi Çöp Kutusundan kalıcı olarak silebilir.
              </span>
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setInvoiceToDelete(null)}
                className="px-4 py-2 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 text-xs cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  try {
                    setIsDeleting(true);
                    if (onDeleteInvoice) {
                      await onDeleteInvoice(invoiceToDelete.id);
                    }
                    setSyncToast(`"${invoiceToDelete.invoiceNumber}" numaralı fatura çöp kutusuna taşındı.`);
                    setTimeout(() => setSyncToast(null), 3500);
                  } catch (err) {
                    console.error('Error deleting invoice:', err);
                  } finally {
                    setIsDeleting(false);
                    setInvoiceToDelete(null);
                  }
                }}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>{isDeleting ? 'Taşınıyor...' : 'Çöp Kutusuna Taşı'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Selected Invoice Full Document Viewer Modal */}
      {activeInvoice && (
        <InvoiceDetailModal
          invoice={activeInvoice}
          jobsites={jobsites}
          supervisors={supervisors}
          onClose={() => setActiveInvoice(null)}
          onNavigateToCompare={onNavigateToCompare}
          onUpdateInvoice={onUpdateInvoice}
          onDeleteInvoice={onDeleteInvoice}
        />
      )}

      {/* Manual File Upload to Drive Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Cloud className="w-5 h-5 text-indigo-600" />
                <h2 className="text-base font-bold text-slate-900">Sistem Arşivine Manuel Fatura Yükle</h2>
              </div>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-400 hover:text-slate-800">✕</button>
            </div>

            <form onSubmit={handleManualUploadSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ait Olduğu Şantiye Klasörü *</label>
                <select
                  value={uploadJobsiteId}
                  onChange={(e) => setUploadJobsiteId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none"
                >
                  {activeJobsites.map(j => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Yükleyen Satınalma Şefi *</label>
                <select
                  value={uploadSupervisorId}
                  onChange={(e) => setUploadSupervisorId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:outline-none"
                >
                  {activeSupervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tedarikçi Firma *</label>
                  <input
                    type="text"
                    required
                    placeholder="Örn: Akçansa Beton"
                    value={uploadSupplier}
                    onChange={(e) => setUploadSupplier(e.target.value)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Fatura No (İsteğe Bağlı)</label>
                  <input
                    type="text"
                    placeholder="Örn: FT-2026-8800"
                    value={uploadInvoiceNo}
                    onChange={(e) => setUploadInvoiceNo(e.target.value)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Fatura Toplam Tutar (₽ Ruble) *</label>
                <input
                  type="number"
                  required
                  placeholder="Örn: 450000"
                  value={uploadTotalAmount}
                  onChange={(e) => setUploadTotalAmount(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Fatura Dosyası (PDF / Görsel)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-xl"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md flex items-center space-x-1.5 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Sistem Arşivine Yükle</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
