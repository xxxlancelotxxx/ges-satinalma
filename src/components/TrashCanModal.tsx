import React, { useState } from 'react';
import { InvoiceRecord, DiscountRecord } from '../types';
import { formatRuble, formatUploadDate } from '../utils/format';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { useAuth } from '../context/AuthContext';
import {
  Trash2,
  RotateCcw,
  X,
  AlertTriangle,
  Clock,
  FileText,
  Building2,
  Store,
  CheckCircle2,
  Tag,
  ArrowRight,
  ShieldCheck,
  Lock,
  Key
} from 'lucide-react';

interface TrashCanModalProps {
  trashInvoices: InvoiceRecord[];
  trashDiscounts?: DiscountRecord[];
  onClose: () => void;
  onRestoreInvoice: (id: string) => Promise<void>;
  onRestoreDiscount: (id: string) => Promise<void>;
  onPermanentDeleteInvoice: (id: string, adminPin?: string) => Promise<void>;
  onPermanentDeleteDiscount: (id: string, adminPin?: string) => Promise<void>;
  onEmptyTrash: (adminPin?: string) => Promise<void>;
  onRestore?: (id: string) => Promise<void>;
  onPermanentDelete?: (id: string, adminPin?: string) => Promise<void>;
}

export const TrashCanModal: React.FC<TrashCanModalProps> = ({
  trashInvoices = [],
  trashDiscounts = [],
  onClose,
  onRestoreInvoice,
  onRestoreDiscount,
  onPermanentDeleteInvoice,
  onPermanentDeleteDiscount,
  onEmptyTrash,
  onRestore,
  onPermanentDelete
}) => {
  useModalBackHandler(true, onClose);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const initialTab = (trashDiscounts.length > 0 && trashInvoices.length === 0)
    ? 'discounts'
    : 'discounts';
  const [activeTab, setActiveTab] = useState<'discounts' | 'invoices'>(initialTab);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isProcessingEmpty, setIsProcessingEmpty] = useState<boolean>(false);
  const [showConfirmEmpty, setShowConfirmEmpty] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<{
    type: 'invoice' | 'discount';
    id: string;
    title: string;
    vendor: string;
    amount: number;
  } | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);
  const [adminPinInput, setAdminPinInput] = useState<string>(() => {
    try {
      return (typeof window !== 'undefined' ? sessionStorage.getItem('admin_pin') : '') || '';
    } catch (_) {
      return '';
    }
  });
  const [pinError, setPinError] = useState<string>('');

  const totalCount = trashInvoices.length + trashDiscounts.length;

  const openDeleteItemModal = (item: {
    type: 'invoice' | 'discount';
    id: string;
    title: string;
    vendor: string;
    amount: number;
  }) => {
    setActionErrorMsg(null);
    setPinError('');
    if (!adminPinInput) {
      try {
        const stored = sessionStorage.getItem('admin_pin');
        if (stored) setAdminPinInput(stored);
      } catch (_) {}
    }
    setItemToDelete(item);
  };

  const openConfirmEmptyModal = () => {
    setActionErrorMsg(null);
    setPinError('');
    setShowConfirmEmpty(true);
  };

  const handleRestoreInv = async (id: string) => {
    try {
      setLoadingId(id);
      setActionErrorMsg(null);
      if (onRestoreInvoice) {
        await onRestoreInvoice(id);
      } else if (onRestore) {
        await onRestore(id);
      }
      setActionSuccessMsg('Fatura başarıyla aktif listeye geri yüklendi.');
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Error restoring invoice:', err);
      setActionSuccessMsg(null);
      setActionErrorMsg(err?.message || 'Fatura geri yüklenirken bir hata oluştu.');
      setTimeout(() => setActionErrorMsg(null), 5000);
    } finally {
      setLoadingId(null);
    }
  };

  const handleRestoreDsc = async (id: string) => {
    try {
      setLoadingId(id);
      setActionErrorMsg(null);
      await onRestoreDiscount(id);
      setActionSuccessMsg('İndirim kaydı başarıyla aktif listeye geri yüklendi.');
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Error restoring discount:', err);
      setActionSuccessMsg(null);
      setActionErrorMsg(err?.message || 'İndirim geri yüklenirken bir hata oluştu.');
      setTimeout(() => setActionErrorMsg(null), 5000);
    } finally {
      setLoadingId(null);
    }
  };

  const handleExecutePermanentDelete = async () => {
    if (!itemToDelete) return;
    const { type, id } = itemToDelete;
    
    // Authorization check: Must either be logged in as Admin or provide Admin PIN
    const effectivePin = adminPinInput.trim() || (typeof window !== 'undefined' ? (sessionStorage.getItem('admin_pin') || '') : '');
    if (!isAdmin && !effectivePin) {
      setPinError('Kalıcı silme işlemi için lütfen Sistem Yöneticisi (Admin) PIN kodunu giriniz.');
      return;
    }

    try {
      setLoadingId(id);
      setActionErrorMsg(null);
      setPinError('');

      if (effectivePin) {
        try {
          sessionStorage.setItem('admin_pin', effectivePin);
        } catch (_) {}
      }

      if (type === 'invoice') {
        if (onPermanentDeleteInvoice) {
          await onPermanentDeleteInvoice(id, effectivePin);
        } else if (onPermanentDelete) {
          await onPermanentDelete(id, effectivePin);
        }
        setActionSuccessMsg('Fatura kalıcı olarak silindi.');
      } else {
        await onPermanentDeleteDiscount(id, effectivePin);
        setActionSuccessMsg('İndirim kaydı kalıcı olarak silindi.');
      }
      setItemToDelete(null);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Error permanently deleting item:', err);
      setActionSuccessMsg(null);
      const errMsg = err?.message || 'Kayıt kalıcı silinirken bir hata oluştu.';
      setActionErrorMsg(errMsg);
      if (errMsg.toLowerCase().includes('yetki') || errMsg.toLowerCase().includes('admin')) {
        setPinError(errMsg);
      }
      setTimeout(() => setActionErrorMsg(null), 5000);
    } finally {
      setLoadingId(null);
    }
  };

  const handleConfirmEmptyTrash = async () => {
    // Authorization check
    let effectivePin = adminPinInput.trim();
    if (!effectivePin) {
      try {
        effectivePin = sessionStorage.getItem('admin_pin') || '';
      } catch (_) {}
    }
    if (!isAdmin && !effectivePin) {
      setPinError('Çöp kutusunu boşaltmak için lütfen Sistem Yöneticisi (Admin) PIN kodunu giriniz.');
      return;
    }

    try {
      setIsProcessingEmpty(true);
      setActionErrorMsg(null);
      setPinError('');

      if (effectivePin) {
        try {
          sessionStorage.setItem('admin_pin', effectivePin);
        } catch (_) {}
      }

      await onEmptyTrash(effectivePin);
      setShowConfirmEmpty(false);
      setActionSuccessMsg('Çöp kutusu tamamen boşaltıldı.');
      setTimeout(() => setActionSuccessMsg(null), 3000);
    } catch (err: any) {
      console.error('Error emptying trash:', err);
      setActionSuccessMsg(null);
      const errMsg = err?.message || 'Çöp kutusu boşaltılırken bir hata oluştu.';
      setActionErrorMsg(errMsg);
      if (errMsg.toLowerCase().includes('yetki') || errMsg.toLowerCase().includes('admin') || errMsg.toLowerCase().includes('pin')) {
        setPinError(errMsg);
      }
      setTimeout(() => setActionErrorMsg(null), 5000);
    } finally {
      setIsProcessingEmpty(false);
    }
  };

  return (
    <div id="trash-can-modal-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div id="trash-can-modal-container" className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-xl border border-rose-500/30">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">Çöp Kutusu</h3>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-500/30 text-rose-300 border border-rose-500/40">
                  {totalCount} Öge ({trashDiscounts.length} İndirim, {trashInvoices.length} Fatura)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Silinen kayıtlar çöp kutusunda güvenle saklanır. &apos;Kalıcı Olarak Sil&apos; demediğiniz sürece asla silinmez veya kaybolmaz.
              </p>
            </div>
          </div>

          <button
            id="trash-modal-close-btn"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="bg-slate-800/95 px-6 pt-2 pb-0 flex items-center space-x-2 border-b border-slate-700">
          <button
            id="trash-tab-discounts-btn"
            type="button"
            onClick={() => setActiveTab('discounts')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
              activeTab === 'discounts'
                ? 'bg-white text-slate-900 border-slate-200 shadow-xs'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50 border-transparent'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>İndirimler</span>
            <span className={`px-2 py-0.2 rounded-full text-[11px] ${
              activeTab === 'discounts' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-700 text-slate-300'
            }`}>
              {trashDiscounts.length}
            </span>
          </button>

          <button
            id="trash-tab-invoices-btn"
            type="button"
            onClick={() => setActiveTab('invoices')}
            className={`px-4 py-2 text-xs font-bold rounded-t-xl transition-all flex items-center space-x-2 cursor-pointer border-t border-x ${
              activeTab === 'invoices'
                ? 'bg-white text-slate-900 border-slate-200 shadow-xs'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50 border-transparent'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Faturalar</span>
            <span className={`px-2 py-0.2 rounded-full text-[11px] ${
              activeTab === 'invoices' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-700 text-slate-300'
            }`}>
              {trashInvoices.length}
            </span>
          </button>
        </div>

        {/* Action Status Banner */}
        {actionSuccessMsg && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 px-6 py-2.5 text-xs font-bold flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {/* Action Error Banner */}
        {actionErrorMsg && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-800 px-6 py-2.5 text-xs font-bold flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionErrorMsg}</span>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-600 font-medium">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              Silinen ögeleri <strong>Geri Yükle</strong> butonuyla anında eski yerine alabilir, gerektiğinde <strong>Kalıcı Sil</strong> ile tamamen kaldırabilirsiniz.
            </span>
          </div>

          {totalCount > 0 && (
            <button
              id="trash-empty-all-btn"
              onClick={openConfirmEmptyModal}
              className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Çöp Kutusunu Boşalt</span>
            </button>
          )}
        </div>

        {/* Body / Table */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'discounts' && (
            trashDiscounts.length === 0 ? (
              <div className="py-16 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
                  <Tag className="w-8 h-8" />
                </div>
                <h4 className="text-base font-bold text-slate-800">Silinmiş İndirim Yok</h4>
                <p className="text-xs text-slate-500 max-w-md mt-1">
                  Silinen indirim kayıtları burada listelenir. Şu anda çöp kutusunda herhangi bir indirim bulunmamaktadır.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <th className="py-2.5 px-3">Tarih</th>
                      <th className="py-2.5 px-3">Fatura No & Malzeme</th>
                      <th className="py-2.5 px-3">Şantiye</th>
                      <th className="py-2.5 px-3">Tedarikçi</th>
                      <th className="py-2.5 px-3">İlk Teklif &rarr; Anlaşılan</th>
                      <th className="py-2.5 px-3">Silinme Tarihi</th>
                      <th className="py-2.5 px-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {trashDiscounts.map((dsc) => {
                      const saving = (dsc.discountAmount !== undefined && dsc.discountAmount !== null)
                        ? dsc.discountAmount
                        : (Number(dsc.offerPrice || 0) - Number(dsc.agreedPrice || 0));
                      return (
                        <tr key={dsc.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-3 font-mono text-slate-700 whitespace-nowrap">
                            {formatUploadDate(dsc.created_at, dsc.orderDate)}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-indigo-900 font-mono">
                              {dsc.invoiceNo || dsc.invoiceNumber || 'No Yok'}
                            </div>
                            <div className="text-[11px] text-slate-500 line-clamp-1">
                              {dsc.category || dsc.notes || 'İndirim Kaydı'}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center space-x-1 text-slate-700 font-medium">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{dsc.jobsiteName || '-'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center space-x-1 text-slate-900 font-semibold">
                              <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{dsc.vendorName || '-'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap font-mono">
                            <div className="flex items-center space-x-1 text-xs text-slate-500">
                              <span className="line-through">{formatRuble(dsc.offerPrice)}</span>
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              <span className="font-bold text-slate-800">{formatRuble(dsc.agreedPrice)}</span>
                            </div>
                            <div className="text-[11px] text-emerald-700 font-bold mt-0.5">
                              Kazanç: {formatRuble(saving)}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <div className="text-[11px] text-rose-700 font-mono">
                              {formatUploadDate(dsc.deletedAt)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center space-x-2">
                              <button
                                type="button"
                                disabled={loadingId === dsc.id}
                                onClick={() => handleRestoreDsc(dsc.id)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-xs disabled:opacity-50"
                                title="Aktif Listeye Geri Yükle"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Geri Yükle</span>
                              </button>
                              <button
                                type="button"
                                disabled={loadingId === dsc.id}
                                onClick={() => openDeleteItemModal({
                                  type: 'discount',
                                  id: dsc.id,
                                  title: dsc.invoiceNo || 'İndirim Kaydı',
                                  vendor: dsc.vendorName || 'Bilinmiyor',
                                  amount: dsc.agreedPrice
                                })}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                                title="Kalıcı Olarak Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Kalıcı Sil</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activeTab === 'invoices' && (
            trashInvoices.length === 0 ? (
              <div className="py-16 text-center flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8" />
                </div>
                <h4 className="text-base font-bold text-slate-800">Silinmiş Fatura Yok</h4>
                <p className="text-xs text-slate-500 max-w-md mt-1">
                  Silinen faturalarınız burada listelenir. Şu anda çöp kutusunda herhangi bir fatura bulunmamaktadır.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <th className="py-2.5 px-3">Yükleme Tarihi</th>
                      <th className="py-2.5 px-3">Fatura No & Tarih</th>
                      <th className="py-2.5 px-3">Şantiye</th>
                      <th className="py-2.5 px-3">Tedarikçi</th>
                      <th className="py-2.5 px-3">Toplam Tutar</th>
                      <th className="py-2.5 px-3">Silinme Tarihi</th>
                      <th className="py-2.5 px-3 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {trashInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-3 font-mono text-emerald-800 font-bold bg-emerald-50/40 whitespace-nowrap">
                          {formatUploadDate(inv.created_at, inv.date)}
                        </td>
                        <td className="py-3 px-3 font-mono">
                          <div className="flex items-center space-x-1.5 font-bold text-indigo-900">
                            <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                            <span>{inv.invoiceNumber}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-normal">Fatura: {inv.date}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-1 text-slate-700 font-medium">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{inv.jobsiteName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-1 text-slate-900 font-semibold">
                            <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{inv.supplier}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-extrabold text-emerald-700 whitespace-nowrap">
                          {formatRuble(inv.totalAmount)}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="text-[11px] text-rose-700 font-mono">
                            {formatUploadDate(inv.deletedAt)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center space-x-2">
                            <button
                              type="button"
                              disabled={loadingId === inv.id}
                              onClick={() => handleRestoreInv(inv.id)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-xs disabled:opacity-50"
                              title="Aktif Faturalara Geri Yükle"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Geri Yükle</span>
                            </button>
                            <button
                              type="button"
                              disabled={loadingId === inv.id}
                              onClick={() => openDeleteItemModal({
                                type: 'invoice',
                                id: inv.id,
                                title: inv.invoiceNumber || 'Fatura',
                                vendor: inv.supplier || 'Bilinmiyor',
                                amount: inv.totalAmount
                              })}
                              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                              title="Kalıcı Olarak Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Kalıcı Sil</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 px-6 py-3.5 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Çöp kutusundaki ögeler sadece siz onayladığınızda kalıcı olarak silinir.
          </span>
          <button
            id="trash-modal-bottom-close-btn"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>

      {/* Individual Permanent Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-full">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-slate-900">
                {itemToDelete.type === 'invoice' ? 'Faturayı Kalıcı Olarak Sil' : 'İndirimi Kalıcı Olarak Sil'}
              </h4>
            </div>
            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              <p>
                Bu kayıt sistemden ve veritabanından <strong>tamamen ve kalıcı olarak</strong> silinecektir. Bu işlem geri alınamaz.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1 font-medium text-xs">
                <div><span className="text-slate-500">Kayıt / Belge:</span> <strong className="text-slate-800">{itemToDelete.title}</strong></div>
                <div><span className="text-slate-500">Tedarikçi Firma:</span> <strong className="text-slate-800">{itemToDelete.vendor}</strong></div>
                <div><span className="text-slate-500">Tutar:</span> <strong className="text-emerald-700">{formatRuble(itemToDelete.amount)}</strong></div>
              </div>

              {/* Admin Authorization Box */}
              <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Yönetici (Admin) Yetkisi</span>
                  </div>
                  {isAdmin && (
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Admin Girişi Yapılmış
                    </span>
                  )}
                </div>

                {!isAdmin && (
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Admin dışındaki kullanıcıların silme yetkisi yoktur. Devam etmek için Yönetici PIN kodunu girmelisiniz.
                  </p>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {isAdmin ? 'Yönetici PIN Kodu (Opsiyonel / Ek Doğrulama):' : 'Yönetici (Admin) PIN Kodu:'}
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={adminPinInput}
                      onChange={(e) => {
                        setAdminPinInput(e.target.value);
                        setPinError('');
                      }}
                      placeholder="Admin PIN kodunu giriniz..."
                      className={`w-full px-3 py-2 pr-8 text-xs border rounded-lg bg-white focus:outline-none focus:ring-2 ${
                        pinError ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-300 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                    />
                    <Key className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5" />
                  </div>
                  {pinError && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">{pinError}</p>
                  )}
                </div>
              </div>

              {actionErrorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-extrabold text-rose-900">İşlem Gerçekleştirilemedi:</p>
                    <p className="font-normal text-rose-800 mt-0.5">{actionErrorMsg}</p>
                  </div>
                </div>
              )}

              <p className="text-rose-600 font-semibold text-center">
                Silmek istediğinizden emin misiniz?
              </p>
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                id="permanent-delete-cancel-btn"
                type="button"
                onClick={() => {
                  setItemToDelete(null);
                  setActionErrorMsg(null);
                  setPinError('');
                }}
                className="px-4 py-2 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 text-xs cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                id="permanent-delete-confirm-btn"
                type="button"
                disabled={loadingId === itemToDelete.id}
                onClick={handleExecutePermanentDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{loadingId === itemToDelete.id ? 'Siliniyor...' : 'Evet, Kalıcı Olarak Sil'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty Trash Confirmation Modal */}
      {showConfirmEmpty && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="p-3 bg-rose-100 rounded-full">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h4 className="text-base font-bold text-slate-900">Çöp Kutusunu Boşalt</h4>
            </div>
            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              <p>
                Çöp kutusundaki <strong>{totalCount} kaydın tamamı (tüm silinmiş fatura ve indirimler) kalıcı olarak silinecektir</strong>. Bu işlem geri alınamaz!
              </p>

              {/* Admin Authorization Box */}
              <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Yönetici (Admin) Yetkisi</span>
                  </div>
                  {isAdmin && (
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Admin Girişi Yapılmış
                    </span>
                  )}
                </div>

                {!isAdmin && (
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Admin dışındaki kullanıcıların silme yetkisi yoktur. Devam etmek için Yönetici PIN kodunu girmelisiniz.
                  </p>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {isAdmin ? 'Yönetici PIN Kodu (Opsiyonel / Ek Doğrulama):' : 'Yönetici (Admin) PIN Kodu:'}
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={adminPinInput}
                      onChange={(e) => {
                        setAdminPinInput(e.target.value);
                        setPinError('');
                      }}
                      placeholder="Admin PIN kodunu giriniz..."
                      className={`w-full px-3 py-2 pr-8 text-xs border rounded-lg bg-white focus:outline-none focus:ring-2 ${
                        pinError ? 'border-rose-500 focus:ring-rose-500/20' : 'border-slate-300 focus:ring-indigo-500/20 focus:border-indigo-500'
                      }`}
                    />
                    <Key className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5" />
                  </div>
                  {pinError && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">{pinError}</p>
                  )}
                </div>
              </div>

              {actionErrorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-extrabold text-rose-900">İşlem Gerçekleştirilemedi:</p>
                    <p className="font-normal text-rose-800 mt-0.5">{actionErrorMsg}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                id="empty-trash-cancel-btn"
                type="button"
                onClick={() => {
                  setShowConfirmEmpty(false);
                  setActionErrorMsg(null);
                  setPinError('');
                }}
                className="px-4 py-2 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 text-xs cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                id="empty-trash-confirm-btn"
                type="button"
                disabled={isProcessingEmpty}
                onClick={handleConfirmEmptyTrash}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isProcessingEmpty ? 'Siliniyor...' : 'Evet, Tümünü Kalıcı Sil'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
