import React, { useState, useEffect } from 'react';
import { InvoiceRecord, Jobsite, PurchasingSupervisor, InvoiceItem } from '../types';
import { formatRuble, formatRubleWithDecimals, openOriginalFileViewer, formatUploadDate, getSafeFileUrl } from '../utils/format';
import { getPrizmaBtfUrl, getPrizmaStfUrl } from '../utils/prizmaUrlHelper';
import { useAuth } from '../context/AuthContext';
import { checkRecordPermission, canonicalizeJobsiteId } from '../utils/permissions';
import { ensureRussianOriginalName } from '../utils/categoryClassifier';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import {
  X,
  Printer,
  Download,
  ExternalLink,
  Building2,
  UserCheck,
  Calendar,
  FileCheck2,
  Coins,
  QrCode,
  HardDrive,
  CheckCircle2,
  Edit3,
  Save,
  Trash2,
  Check,
  AlertCircle,
  Lock,
  ArrowLeft,
  Layers,
  Search,
  FileText,
  Info
} from 'lucide-react';

interface Props {
  invoice: InvoiceRecord;
  jobsites?: Jobsite[];
  supervisors?: PurchasingSupervisor[];
  initialIsEditing?: boolean;
  onClose: () => void;
  onNavigateToCompare?: (materialName: string) => void;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => void | Promise<void>;
  onDeleteInvoice?: (id: string) => void | Promise<void>;
}

export const InvoiceDetailModal: React.FC<Props> = ({
  invoice,
  jobsites = [],
  supervisors = [],
  initialIsEditing = false,
  onClose,
  onNavigateToCompare,
  onUpdateInvoice,
  onDeleteInvoice
}) => {
  useModalBackHandler(true, onClose);

  const { user } = useAuth();
  const perm = checkRecordPermission(user, invoice);

  // Tabs state
  const [activeTab, setActiveTab] = useState<'items' | 'document' | 'metadata'>('items');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [itemsPage, setItemsPage] = useState<number>(1);
  const [itemsPageSize, setItemsPageSize] = useState<number>(20);

  // Loaded master lists (with fallback fetch if props are empty)
  const [loadedJobsites, setLoadedJobsites] = useState<Jobsite[]>(jobsites);
  const [loadedSupervisors, setLoadedSupervisors] = useState<PurchasingSupervisor[]>(supervisors);

  // Active displayed jobsite and supervisor names
  const [displayJobsiteName, setDisplayJobsiteName] = useState<string>(invoice.jobsiteName);
  const [displaySupervisorName, setDisplaySupervisorName] = useState<string>(invoice.uploadedBySupervisorName);

  // Edit form state
  const [isEditing, setIsEditing] = useState<boolean>(Boolean(initialIsEditing));
  const [editJobsiteId, setEditJobsiteId] = useState<string>(invoice.jobsiteId || '');
  const [editSupervisorId, setEditSupervisorId] = useState<string>(invoice.uploadedBySupervisorId || '');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState<string>(invoice.invoiceNumber || '');
  const [editSupplier, setEditSupplier] = useState<string>(invoice.supplier || '');
  const [editDate, setEditDate] = useState<string>(invoice.date || '');
  const [editTotalAmount, setEditTotalAmount] = useState<number>(invoice.totalAmount || 0);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Sync state when invoice changes or master lists load
  useEffect(() => {
    let initialJobId = invoice.jobsiteId || '';
    if (loadedJobsites.length > 0 && !loadedJobsites.some(j => j.id === initialJobId)) {
      const matchJob = loadedJobsites.find(j =>
        (invoice.jobsiteName && j.name.toLowerCase() === invoice.jobsiteName.toLowerCase()) ||
        j.id === canonicalizeJobsiteId(invoice.jobsiteId, invoice.jobsiteName)
      );
      if (matchJob) initialJobId = matchJob.id;
    }

    let initialSupId = invoice.uploadedBySupervisorId || '';
    if (loadedSupervisors.length > 0 && !loadedSupervisors.some(s => s.id === initialSupId)) {
      const matchSup = loadedSupervisors.find(s =>
        invoice.uploadedBySupervisorName && s.name.toLowerCase() === invoice.uploadedBySupervisorName.toLowerCase()
      );
      if (matchSup) initialSupId = matchSup.id;
    }

    setEditJobsiteId(initialJobId);
    setEditSupervisorId(initialSupId);
    setEditInvoiceNumber(invoice.invoiceNumber || '');
    setEditSupplier(invoice.supplier || '');
    setEditDate(invoice.date || '');
    setEditTotalAmount(invoice.totalAmount || 0);
    setDisplayJobsiteName(invoice.jobsiteName || '');
    setDisplaySupervisorName(invoice.uploadedBySupervisorName || '');
  }, [invoice, loadedJobsites, loadedSupervisors]);

  // Fetch jobsites if missing
  useEffect(() => {
    if (jobsites && jobsites.length > 0) {
      setLoadedJobsites(jobsites);
    } else {
      fetch('/api/jobsites')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) setLoadedJobsites(data);
        })
        .catch(err => console.error('Error fetching jobsites in modal:', err));
    }
  }, [jobsites]);

  // Fetch supervisors if missing
  useEffect(() => {
    if (supervisors && supervisors.length > 0) {
      setLoadedSupervisors(supervisors);
    } else {
      fetch('/api/supervisors')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) setLoadedSupervisors(data);
        })
        .catch(err => console.error('Error fetching supervisors in modal:', err));
    }
  }, [supervisors]);

  const handleSaveEdit = async () => {
    setIsSaving(true);
    try {
      const selectedJob = loadedJobsites.find(j => j.id === editJobsiteId || j.name.toLowerCase() === editJobsiteId.toLowerCase());
      const selectedSup = loadedSupervisors.find(s => s.id === editSupervisorId || s.name.toLowerCase() === editSupervisorId.toLowerCase());

      const finalJobsiteId = selectedJob ? selectedJob.id : (canonicalizeJobsiteId(editJobsiteId, displayJobsiteName) || editJobsiteId);
      const newJobsiteName = selectedJob ? selectedJob.name : (displayJobsiteName || editJobsiteId);
      const finalSupervisorId = selectedSup ? selectedSup.id : editSupervisorId;
      const newSupervisorName = selectedSup ? selectedSup.name : (displaySupervisorName || editSupervisorId);

      const updateData: Partial<InvoiceRecord> = {
        jobsiteId: finalJobsiteId,
        jobsiteName: newJobsiteName,
        uploadedBySupervisorId: finalSupervisorId,
        uploadedBySupervisorName: newSupervisorName,
        invoiceNumber: editInvoiceNumber,
        supplier: editSupplier,
        date: editDate,
        totalAmount: Number(editTotalAmount) || 0
      };

      if (onUpdateInvoice) {
        await onUpdateInvoice(invoice.id, updateData);
      } else {
        let adminPin = '';
        try {
          if (typeof window !== 'undefined') {
            adminPin = sessionStorage.getItem('admin_pin') || '';
          }
        } catch (_) {}

        const res = await fetch(`/api/invoices/${invoice.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': user?.token || '',
            'x-user-role': encodeURIComponent(user?.role || ''),
            'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
            'x-user-personnel-id': encodeURIComponent(user?.personnelId || ''),
            'x-user-name': encodeURIComponent(user?.displayName || ''),
            'x-user-jobsite-ids': encodeURIComponent(JSON.stringify(user?.jobsiteIds || [])),
            'x-user-default-jobsite-id': encodeURIComponent(user?.defaultJobsiteId || ''),
            ...(adminPin ? { 'x-admin-pin': adminPin } : {})
          },
          body: JSON.stringify(updateData)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Fatura güncellenemedi');
        }
      }

      Object.assign(invoice, updateData);
      setDisplayJobsiteName(newJobsiteName);
      setDisplaySupervisorName(newSupervisorName);
      setSaveSuccessMsg(true);
      setTimeout(() => {
        setSaveSuccessMsg(false);
        setIsEditing(false);
      }, 800);
    } catch (err: any) {
      console.error('Error saving invoice update:', err);
      alert(err.message || 'Fatura güncellenirken bir hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      if (onDeleteInvoice) {
        await onDeleteInvoice(invoice.id);
      } else {
        let adminPin = '';
        try {
          if (typeof window !== 'undefined') {
            adminPin = sessionStorage.getItem('admin_pin') || '';
          }
        } catch (_) {}

        const res = await fetch(`/api/invoices/${invoice.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-session-token': user?.token || '',
            'x-user-role': encodeURIComponent(user?.role || ''),
            'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
            'x-user-personnel-id': encodeURIComponent(user?.personnelId || ''),
            'x-user-name': encodeURIComponent(user?.displayName || ''),
            'x-user-jobsite-ids': encodeURIComponent(JSON.stringify(user?.jobsiteIds || [])),
            'x-user-default-jobsite-id': encodeURIComponent(user?.defaultJobsiteId || ''),
            ...(adminPin ? { 'x-admin-pin': adminPin } : {})
          }
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Fatura çöp kutusuna taşınamadı');
        }
      }
      onClose();
    } catch (err: any) {
      console.error('Error deleting invoice:', err);
      alert(err.message || 'Fatura silinirken bir hata oluştu.');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatTL = (amount: number) => {
    return formatRuble(amount);
  };

  // Financial metrics
  const grandTotal = invoice.totalAmount || 0;
  const allItems: InvoiceItem[] = invoice.items || [];
  // KDV oranı faturanın kendi kalemlerinden gelir (2026: %22). Sabit %20 ile bölmek net tutarı yanlış gösteriyordu.
  const itemVatRates = Array.from(new Set(
    allItems.map(it => Number(it.vatPercentage)).filter(v => Number.isFinite(v) && v >= 0)
  ));
  const defaultVatRate = String(invoice.date || '').startsWith('2025') ? 20 : 22;
  const invoiceVatRate = itemVatRates.length === 1
    ? itemVatRates[0]
    : (Number.isFinite(Number(invoice.vatRate)) && Number(invoice.vatRate) > 0 ? Number(invoice.vatRate) : defaultVatRate);
  const linesFromDocumentRaw = (invoice as any).linesSource === 'invoice_pdf' && (invoice as any).linesReconciled !== false;
  // Belgeden doğrulanmış faturada net matrah satırların toplamıdır (belgedeki "В т.ч. НДС" ile kuruşu kuruşuna aynı)
  const subTotal = linesFromDocumentRaw
    ? allItems.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0) + (Number(invoice.excludedFreightAmount) || 0)
    : grandTotal / (1 + invoiceVatRate / 100);
  const vatAmount = grandTotal - subTotal;
  const itemGrossTotal = (item: InvoiceItem) =>
    Number(item.grossTotalPrice) || (Number(item.grossUnitPrice) || Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
  const itemGrossUnit = (item: InvoiceItem) =>
    Number(item.grossUnitPrice) || itemGrossTotal(item) / (Number(item.quantity) || 1);
  const linesGap = Number((invoice as any).lineTotalGapGross) || 0;
  const linesNotReconciled = (invoice as any).linesReconciled === false;
  const linesFromDocument = (invoice as any).linesSource === 'invoice_pdf' && !linesNotReconciled;
  const filteredItems = itemSearch.trim()
    ? allItems.filter(item =>
        (item.materialName || '').toLowerCase().includes(itemSearch.toLowerCase()) ||
        (item.category || '').toLowerCase().includes(itemSearch.toLowerCase())
      )
    : allItems;

  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPageSize));
  const safeCurrentPage = Math.min(itemsPage, totalPages);
  const paginatedItems = filteredItems.slice(
    (safeCurrentPage - 1) * itemsPageSize,
    safeCurrentPage * itemsPageSize
  );

  const handlePrint = () => {
    window.print();
  };

  const handleOpenDrive = () => {
    const fileName = invoice.rawFileName || `Fatura_${invoice.invoiceNumber}_${invoice.supplier.replace(/\s+/g, '_')}.pdf`;

    openOriginalFileViewer(invoice.fileUrl, fileName, {
      supplier: invoice.supplier,
      amount: invoice.totalAmount,
      date: invoice.date,
      jobsiteName: invoice.jobsiteName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceNo: invoice.invoiceNumber,
      items: invoice.items,
      supervisorName: invoice.uploadedBySupervisorName,
      documentType: 'Şantiye Malzeme Alım Faturası'
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-slate-900/50 border border-slate-700/80 rounded-2xl sm:rounded-3xl max-w-6xl xl:max-w-7xl w-full h-[92vh] sm:h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 text-left animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header: Dark Slate & Executive Contrast */}
        <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 z-10 shadow-md text-white">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-inner">
              <FileCheck2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-base sm:text-lg font-black text-white tracking-wide truncate">
                  {invoice.invoiceNumber ? `Fatura: ${invoice.invoiceNumber}` : 'Fatura Detayı'}
                </h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/50 shrink-0">
                  Drive Depolandı ✓
                </span>
                <span className="text-[10px] font-bold bg-indigo-950/80 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-500/50 shrink-0">
                  {invoice.category || 'Satınalma Faturası'}
                </span>
                {invoice.prizmaRequestCode && (
                  <a
                    href="https://pm.gescons.ru/process"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/40 hover:bg-blue-500/30 transition-colors shrink-0"
                    title="Prizma (pm.gescons.ru) Platformunda İncele"
                  >
                    <span className="font-black text-blue-300">П</span>
                    <span>Prizma: {invoice.prizmaRequestCode} {invoice.prizmaOrderCode ? `(${invoice.prizmaOrderCode})` : ''} - {invoice.prizmaStatus || 'Bağlandı'}</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70" />
                  </a>
                )}
              </div>
              <p className="text-[11px] text-slate-300 flex flex-wrap items-center gap-1.5 truncate mt-1">
                <span className="truncate font-semibold text-slate-200">{invoice.supplier}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-300">{displayJobsiteName || invoice.jobsiteName}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 font-mono">Fatura Tarihi: {invoice.date}</span>
                {invoice.uploadedBySupervisorName && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-indigo-300 font-medium">Şef: {displaySupervisorName}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Header Action Buttons */}
          <div className="flex items-center space-x-2 shrink-0">
            {(invoice as any).prizmaDemandId ? (
              <a
                href={`/api/prizma/invoice-file/${(invoice as any).prizmaDemandId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white border border-amber-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                title="Prizma Orijinal Fatura Belgesini (Счет на оплату) Aç"
              >
                <FileText className="w-3.5 h-3.5 text-amber-300" />
                <span>Faturayı Aç (Счет на оплату)</span>
              </a>
            ) : (invoice as any).invoiceFileId && (
              <a
                href={`/api/prizma/file/${(invoice as any).invoiceFileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600 text-amber-200 hover:text-white border border-amber-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                title="Prizma Orijinal Fatura PDF Dosyasını Aç"
              >
                <FileText className="w-3.5 h-3.5 text-amber-300" />
                <span>Prizma PDF</span>
              </a>
            )}

            {((invoice as any).prizmaBtfUrl || (invoice as any).prizmaUrl || (invoice as any).prizmaDemandId) && (
              <a
                href={getPrizmaBtfUrl((invoice as any).prizmaDemandId, (invoice as any).prizmaBtfUrl || (invoice as any).prizmaUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white border border-blue-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                title="Prizma BTF (Ödeme Talebi) Sayfasını Yeni Sekmede Aç"
              >
                <span className="font-black text-blue-400">П</span>
                <span>Prizma BTF {(invoice as any).prizmaRequestCode ? `(${(invoice as any).prizmaRequestCode})` : ''}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {((invoice as any).prizmaStfUrl || (invoice as any).prizmaOrderDemandId) && (
              <a
                href={getPrizmaStfUrl((invoice as any).prizmaOrderDemandId, (invoice as any).prizmaStfUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                title="Prizma STF (Sipariş Talebi) Sayfasını Yeni Sekmede Aç"
              >
                <span>Prizma STF</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {perm.canEdit && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm ${
                  isEditing
                    ? 'bg-amber-400 text-slate-950 font-black hover:bg-amber-300'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                }`}
                title="Şantiye, Satınalma Şefi ve Fatura Bilgilerini Düzenle"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isEditing ? 'Düzenlemeyi Kapat' : 'Düzenle'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenDrive}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
              title="Drive'da Aç"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Drive</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
              title="Yazdır"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Yazdır</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-slate-700 cursor-pointer shadow-sm active:scale-95"
              title="Önceki ekrana dön (Geri / ESC)"
            >
              <ArrowLeft className="w-4 h-4 text-slate-400" />
              <span>Geri Dön</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              title="Pencereyi Kapat (ESC)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Delete Confirmation Banner */}
        {showDeleteConfirm && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-900 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 shrink-0">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div className="text-xs sm:text-sm">
                <span className="font-bold">"{invoice.invoiceNumber || invoice.supplier}"</span> faturası Çöp Kutusuna taşınacaktır.
                <span className="block text-[11px] text-rose-700 font-normal mt-0.5">Fatura doğrudan kalıcı olarak silinmez, önce Çöp Kutusunda güvenle saklanır. Yalnızca Sistem Yöneticisi Çöp Kutusundan kalıcı olarak silebilir.</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-2 rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Taşınıyor...' : 'Çöp Kutusuna Taşı'}</span>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {/* Inline Edit Form Panel */}
        {isEditing && (
          <div className="bg-amber-50/90 border-b border-amber-300 p-4 sm:p-5 space-y-3 shrink-0 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-lg bg-amber-200 text-amber-900 border border-amber-400 flex items-center justify-center">
                  <Edit3 className="w-4 h-4" />
                </div>
                <h4 className="font-bold text-xs sm:text-sm text-amber-950">Fatura & Şantiye / Şef Bilgilerini Düzelt</h4>
              </div>
              {saveSuccessMsg && (
                <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full flex items-center space-x-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>Güncellendi!</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Teslim Edilen Şantiye</label>
                <select
                  value={editJobsiteId}
                  onChange={(e) => setEditJobsiteId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                >
                  {!loadedJobsites.some(j => j.id === editJobsiteId) && (
                    <option value={editJobsiteId}>{displayJobsiteName || 'Mevcut Şantiye'}</option>
                  )}
                  {loadedJobsites.map(j => (
                    <option key={j.id} value={j.id}>{j.name} {j.code ? `(${j.code})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Onaylayan Satınalma Şefi</label>
                <select
                  value={editSupervisorId}
                  onChange={(e) => setEditSupervisorId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none cursor-pointer"
                >
                  {!loadedSupervisors.some(s => s.id === editSupervisorId) && (
                    <option value={editSupervisorId}>{displaySupervisorName || 'Mevcut Satınalma Şefi'}</option>
                  )}
                  {loadedSupervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.title || 'Satınalma Şefi'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Tedarikçi / Satıcı Firma</label>
                <input
                  type="text"
                  value={editSupplier}
                  onChange={(e) => setEditSupplier(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Fatura / Teklif No</label>
                <input
                  type="text"
                  value={editInvoiceNumber}
                  onChange={(e) => setEditInvoiceNumber(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-indigo-900 font-mono font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Düzenlenme Tarihi</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 font-bold text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Toplam Tutar (₽)</label>
                <input
                  type="number"
                  value={editTotalAmount}
                  onChange={(e) => setEditTotalAmount(Number(e.target.value))}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-emerald-800 font-mono font-bold text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Kaydediliyor...' : 'Kaydet'}</span>
              </button>
            </div>
          </div>
        )}

        {/* 2. Distinct Metric Cards with Clear Borders & Separators */}
        <div className="shrink-0 bg-slate-100 px-4 sm:px-6 py-3 border-b border-slate-300 shadow-2xs">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
            {/* 1. Ara Toplam */}
            <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between shadow-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                <span>1. Ara Toplam</span>
                <span className="text-[9px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">KDV Hariç</span>
              </div>
              <span className="text-sm sm:text-base font-mono font-bold text-slate-700 tracking-tight">
                {formatTL(subTotal)}
              </span>
              <span className="text-[10px] text-slate-400 font-sans mt-0.5">Net Matrah</span>
            </div>

            {/* 2. KDV Tutarı */}
            <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between shadow-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-600 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                <span>2. KDV (%{invoiceVatRate})</span>
                <span className="text-[9px] px-1.5 py-0.2 bg-indigo-50 text-indigo-700 rounded font-bold">Vergi</span>
              </div>
              <span className="text-sm sm:text-base font-mono font-bold text-slate-800 tracking-tight">
                {formatTL(vatAmount)}
              </span>
              <span className="text-[10px] text-slate-400 font-sans mt-0.5">Hesaplanan KDV</span>
            </div>

            {/* 3. Fatura Genel Toplamı */}
            <div className="bg-emerald-50 px-3 py-2 rounded-xl border-2 border-emerald-400 flex flex-col justify-between shadow-sm ring-1 ring-emerald-400/30">
              <div className="flex items-center justify-between text-[10px] text-emerald-900 font-bold uppercase border-b border-emerald-200 pb-1 mb-1">
                <span>3. Fatura Toplamı</span>
                <span className="text-[9px] px-2 py-0.2 bg-emerald-600 text-white rounded-full font-extrabold">
                  Nihai
                </span>
              </div>
              <span className="text-base sm:text-lg font-mono font-black text-emerald-700 tracking-tight">
                {formatTL(grandTotal)}
              </span>
              <span className="text-[10px] text-emerald-800 font-sans font-bold mt-0.5">
                KDV Dahil Tutar
              </span>
            </div>

            {/* 4. Şantiye & Kalem Bilgisi */}
            <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between text-left shadow-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                <span>Teslim Şantiye</span>
                <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                {displayJobsiteName || invoice.jobsiteName}
              </div>
              <div className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 mt-1 truncate">
                {allItems.length} Kalem Malzeme
              </div>
            </div>
          </div>
        </div>

        {/* 3. Segregated Navigation Tabs Bar */}
        <div className="shrink-0 bg-slate-200/90 px-4 sm:px-6 py-2 border-b border-slate-300 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                activeTab === 'items'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Fatura Kalemleri ({allItems.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('document')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                activeTab === 'document'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Orijinal Belge & Drive</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('metadata')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                activeTab === 'metadata'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Şantiye & Şef Bilgileri</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Fatura Kalemleri Table */}
        {activeTab === 'items' && (
          <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-5 bg-slate-100/70">
            {linesFromDocument && (
              <div className="shrink-0 mb-2.5 px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 text-[11px] font-semibold text-emerald-900">
                ✓ Kalemler fatura belgesinden (Счет на оплату) okundu ve fatura toplamıyla kuruşu kuruşuna doğrulandı.
              </div>
            )}
            {linesNotReconciled && (
              <div className="shrink-0 mb-2.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-900">
                ⚠ Kalemlerin KDV dahil toplamı fatura tutarını tutmuyor (fark {formatTL(linesGap)}).{' '}
                {String(invoice.id || '').startsWith('inv_prizma_')
                  ? 'Kalemler Prizma sipariş (STF) satırlarından geliyor ve fatura belgesinden doğrulanamadı; miktar/fiyat faturadakinden farklı olabilir.'
                  : 'Eksik/yanlış okunmuş kalem olabilir; orijinal belgeyle kontrol edin.'}
              </div>
            )}
            {/* Search & Count Bar */}
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-700">Kalem Listesi:</span>
                <span className="font-mono text-xs font-extrabold text-indigo-900 bg-indigo-100 px-2.5 py-0.5 rounded-md border border-indigo-300">
                  {filteredItems.length} Kalem
                </span>
                {itemSearch && (
                  <span className="text-[11px] text-slate-500 font-medium">
                    (Toplam {allItems.length} arasından filtrelendi)
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => {
                      setItemSearch(e.target.value);
                      setItemsPage(1);
                    }}
                    placeholder="Kalemlerde ara..."
                    className="w-full bg-white border border-slate-300 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                  />
                </div>

                <div className="flex items-center space-x-1 shrink-0 text-xs text-slate-600 font-medium">
                  <span className="hidden sm:inline">Sayfa:</span>
                  <select
                    value={itemsPageSize}
                    onChange={(e) => {
                      setItemsPageSize(Number(e.target.value));
                      setItemsPage(1);
                    }}
                    className="bg-white border border-slate-300 text-slate-800 font-bold rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={1000}>Tümü</option>
                  </select>
                </div>
              </div>
            </div>

            {/* High-Contrast Table Container with Distinct Column Borders */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto rounded-xl border-2 border-slate-300 bg-white shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-800 border-b-2 border-slate-700 text-slate-200 font-bold shadow-xs">
                  <tr>
                    <th className="py-2.5 px-2 w-9 text-center text-slate-400 border-r border-slate-700">#</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-700">Malzeme Adı & Tanımı</th>
                    <th className="py-2.5 px-2 w-28 text-center border-r border-slate-700">Kategori</th>
                    <th className="py-2.5 px-2 w-16 text-center border-r border-slate-700">Birim</th>
                    <th className="py-2.5 px-2 w-24 text-right border-r border-slate-700">Miktar</th>
                    <th className="py-2.5 px-2 w-28 text-right border-r border-slate-700">Birim Fiyat (KDV Dahil)</th>
                    <th className="py-2.5 px-2.5 w-28 text-right border-r border-slate-700">Toplam (KDV Dahil)</th>
                    {onNavigateToCompare && <th className="py-2.5 px-2 w-24 text-center">Aksiyon</th>}
                  </tr>
                </thead>
                <tbody className="text-slate-800 font-mono text-xs">
                  {paginatedItems.length > 0 ? (
                    paginatedItems.map((item, idx) => {
                      const globalIdx = (safeCurrentPage - 1) * itemsPageSize + idx + 1;
                      return (
                        <tr
                          key={`${item.id || 'inv_line'}_${globalIdx}`}
                          className="even:bg-slate-50/80 odd:bg-white hover:bg-indigo-50/60 transition-colors"
                        >
                          <td className="py-2 px-2 text-slate-500 font-bold text-center bg-slate-100/60 border-r border-b border-slate-300">{globalIdx}</td>
                          <td className="py-2 px-3 font-sans font-bold text-slate-900 border-r border-b border-slate-300">
                            <span>{item.materialName}</span>
                            <div className="text-[10px] text-indigo-700 font-mono mt-0.5">
                              🇷🇺 {ensureRussianOriginalName(item.materialName, item.originalName)}
                            </div>
                          </td>
                          <td className="py-2 px-2 font-sans text-slate-700 text-center border-r border-b border-slate-300">
                            <span className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-bold inline-block">
                              {item.category || invoice.category || 'Genel'}
                            </span>
                          </td>
                          <td className="py-2 px-2 font-sans text-slate-700 font-medium text-center border-r border-b border-slate-300">{item.unit || 'Adet'}</td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-slate-950 border-r border-b border-slate-300">
                            {Number(item.quantity || 1).toLocaleString('tr-TR')}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-indigo-900 font-black bg-indigo-50/30 border-r border-b border-slate-300">
                            {formatTL(itemGrossUnit(item))}
                            <div className="text-[10px] font-semibold text-slate-500">
                              KDV Hariç: {formatTL(Number(item.unitPriceNet) || Number(item.unitPrice) || 0)}
                            </div>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono font-black text-emerald-800 bg-emerald-50/30 border-r border-b border-slate-300">
                            {formatTL(itemGrossTotal(item))}
                            {item.vatPercentage !== undefined && (
                              <div className="text-[10px] font-semibold text-slate-500">%{item.vatPercentage} НДС</div>
                            )}
                          </td>
                          {onNavigateToCompare && (
                            <td className="py-2 px-2 text-center border-b border-slate-300">
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onNavigateToCompare(item.materialName);
                                }}
                                className="px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-900 border border-indigo-300 rounded-lg text-[11px] font-bold transition-all cursor-pointer shadow-2xs font-sans"
                              >
                                Fiyat Kıyasla
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={onNavigateToCompare ? 8 : 7} className="py-8 text-center text-slate-400 font-sans italic border-b border-slate-300">
                        {itemSearch ? 'Aramanızla eşleşen fatura kalemi bulunamadı.' : 'Bu faturada kalem kaydı bulunamadı.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="shrink-0 flex items-center justify-between pt-3 text-xs text-slate-600">
                <span>
                  Toplam <strong>{totalItems}</strong> kayıttan <strong>{(safeCurrentPage - 1) * itemsPageSize + 1}</strong> - <strong>{Math.min(safeCurrentPage * itemsPageSize, totalItems)}</strong> arası gösteriliyor
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setItemsPage(p => Math.max(1, p - 1))}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 rounded-lg border border-slate-300 font-bold cursor-pointer shadow-2xs"
                  >
                    Önceki
                  </button>
                  <span className="px-2 font-mono font-bold text-slate-800">
                    {safeCurrentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setItemsPage(p => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 disabled:opacity-40 rounded-lg border border-slate-300 font-bold cursor-pointer shadow-2xs"
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Orijinal Belge & Drive */}
        {activeTab === 'document' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-100/70">
            {invoice.fileUrl ? (() => {
              const safeUrl = getSafeFileUrl(invoice.fileUrl);
              const isImg = safeUrl.match(/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i) || safeUrl.startsWith('data:image/');
              return (
                <div className="border-2 border-slate-300 rounded-2xl overflow-hidden bg-white flex flex-col items-center justify-center relative p-4 shadow-sm min-h-[340px]">
                  {isImg ? (
                    <img src={safeUrl || undefined} alt={invoice.invoiceNumber} className="max-h-[500px] object-contain w-full rounded-xl border border-slate-200 shadow-xs" />
                  ) : (
                    <div className="w-full h-96 rounded-xl overflow-hidden border border-slate-700 bg-slate-900 relative flex flex-col items-center justify-center text-center px-4">
                      <div className="text-4xl mb-4">📄</div>
                      <p className="text-white font-bold mb-2">PDF Fatura Belgesi</p>
                      <p className="text-slate-400 text-sm max-w-xs mb-6">Önizleme tarayıcı tarafından kısıtlanmış olabilir. Lütfen ayrı sekmede veya Drive görüntüleyicide açın.</p>
                      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-6 rounded-xl transition-colors shadow-lg flex items-center space-x-2 z-20">
                        <ExternalLink className="w-4 h-4" />
                        <span>Ayrı Sekmede Aç</span>
                      </a>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between w-full pt-3 border-t border-slate-200 gap-2">
                    <div className="text-xs text-slate-600">
                      <span>Dosya Adı: <strong className="text-slate-900 font-mono">{invoice.rawFileName || `${invoice.invoiceNumber}.pdf`}</strong></span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleOpenDrive}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-xs cursor-pointer transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>Tam Ekran Drive Görüntüleyici</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div className="bg-white border-2 border-dashed border-indigo-300 p-6 rounded-2xl flex flex-col sm:flex-row items-center justify-between text-xs text-indigo-900 gap-4 shadow-sm">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-indigo-100 rounded-xl text-indigo-700 border border-indigo-200">
                    <HardDrive className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-900">Sistem Güvenli Bulut Arşivi (Orijinal Taranmış Belge)</p>
                    <p className="text-slate-500 text-xs mt-0.5">Dosya Adı: {invoice.rawFileName || `${invoice.invoiceNumber}.pdf`} ({invoice.fileSize || '1.8 MB'})</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenDrive}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs cursor-pointer flex items-center space-x-1.5 shadow-xs transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Belgeyi Aç</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Şantiye & Şef Bilgileri */}
        {activeTab === 'metadata' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-100/70">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 space-y-3 shadow-sm">
                <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
                  <Building2 className="w-5 h-5 text-indigo-600" />
                  <h4 className="font-bold text-sm text-slate-900">Teslim Edilen Şantiye Bilgileri</h4>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Şantiye Adı:</span>
                    <span className="font-bold text-slate-900">{displayJobsiteName || invoice.jobsiteName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Proje Kodu:</span>
                    <span className="font-mono font-bold text-indigo-700">PRJ-{(editJobsiteId || invoice.jobsiteId || 'GENEL').toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Kayıt Türü:</span>
                    <span className="font-semibold text-slate-700">Doğrudan Şantiye Sevk Faturası</span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 space-y-3 shadow-sm">
                <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
                  <UserCheck className="w-5 h-5 text-amber-600" />
                  <h4 className="font-bold text-sm text-slate-900">Onaylayan Satınalma Şefi</h4>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Yetkili Şef:</span>
                    <span className="font-bold text-slate-900">{displaySupervisorName || invoice.uploadedBySupervisorName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">Yetki Rolü:</span>
                    <span className="font-semibold text-slate-700">Satınalma Departmanı Şefi</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Sistem Durumu:</span>
                    <span className="font-bold text-emerald-700">Doğrulandı ve Onaylandı ✓</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border-2 border-slate-300 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 border-b border-slate-100 pb-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h4 className="font-bold text-sm text-slate-900">Sistem Güvenli Bulut Arşivi & Muhasebe Senkronizasyonu</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bu fatura Sistem Güvenli Bulut Arşivine şantiye ve satınalma şefi bazında arşivlenmiş olup malzeme fiyat kıyaslama havuzuna dahil edilmiştir.
              </p>
              <div className="pt-2 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-300 font-mono font-semibold">
                  Yüklenme: {formatUploadDate(invoice.createdAt, invoice.date)}
                </span>
                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200 font-mono font-semibold">
                  Toplam Kalem: {allItems.length} Adet
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sticky Action Footer */}
        <div className="shrink-0 bg-white px-4 sm:px-6 py-3 border-t border-slate-300 flex flex-col sm:flex-row items-center justify-between gap-3 z-10 shadow-md">
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            {perm.canEdit && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="w-full sm:w-auto px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs"
              >
                <Edit3 className="w-4 h-4" />
                <span>{isEditing ? 'Düzenlemeyi Kapat' : 'Düzenle'}</span>
              </button>
            )}

            {perm.canDelete && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full sm:w-auto px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs"
                title="Faturayı Çöp Kutusuna Taşı"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>Çöp Kutusuna Taşı</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenDrive}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Drive'da Aç</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-sm active:scale-95"
            title="Pencereyi kapat ve bir önceki ekrana dön (ESC)"
          >
            <ArrowLeft className="w-4 h-4 text-slate-300" />
            <span>Geri Dön (Kapat)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
