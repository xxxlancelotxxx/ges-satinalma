import React, { useState, useEffect } from 'react';
import { 
  X, 
  ExternalLink, 
  CheckCircle, 
  Search, 
  Link2, 
  Unlink, 
  Loader2, 
  Building2, 
  FileText, 
  Tag, 
  AlertCircle,
  RefreshCw,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { InvoiceRecord, DiscountRecord, PrizmaDemandSummary } from '../types';
import { formatRuble } from '../utils/format';

interface PrizmaLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: InvoiceRecord | DiscountRecord | null;
  recordType: 'invoice' | 'discount';
  onLinked?: (updatedRecord: any) => void;
}

export const PrizmaLinkModal: React.FC<PrizmaLinkModalProps> = ({
  isOpen,
  onClose,
  record,
  recordType,
  onLinked
}) => {
  const [status, setStatus] = useState<{ connected: boolean; userName?: string; error?: string } | null>(null);
  const [matches, setMatches] = useState<PrizmaDemandSummary[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PrizmaDemandSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Extract fields from invoice or discount
  const invoiceNo = record
    ? ((record as any).invoiceNo || (record as any).invoiceNumber || '')
    : '';
  const supplierName = record
    ? ((record as any).vendorName || (record as any).supplier || '')
    : '';
  const amount = record
    ? Number((record as any).agreedPrice || (record as any).totalAmount || (record as any).offerPrice || 0)
    : 0;
  const jobsiteName = record
    ? ((record as any).jobsiteName || '')
    : '';

  const isAlreadyLinked = Boolean(record?.prizmaRequestCode || record?.prizmaOrderCode);

  useEffect(() => {
    if (!isOpen) return;

    // Check Prizma API status
    fetch('/api/prizma/status')
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(err => setStatus({ connected: false, error: err.message }));

    // Run auto-match if record has info
    if (invoiceNo || supplierName || amount > 0) {
      setIsLoadingMatches(true);
      fetch('/api/prizma/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceNo,
          supplierName,
          amount,
          jobsiteName
        })
      })
        .then(r => r.json())
        .then(data => {
          setMatches(data.matches || []);
        })
        .catch(err => console.error('Match error:', err))
        .finally(() => setIsLoadingMatches(false));
    }
  }, [isOpen, record?.id]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const res = await fetch(`/api/prizma/demands?take=50&search=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      setSearchResults(data.items || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async (prizmaItem: PrizmaDemandSummary) => {
    if (!record) return;
    setActionLoadingId(prizmaItem.id);

    try {
      const res = await fetch('/api/prizma/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordType,
          recordId: record.id,
          prizmaData: prizmaItem
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Bağlantı kurulamadı');

      const updated = {
        ...record,
        ...data.linkedData
      };

      setToastMessage(`Prizma süreci (${prizmaItem.requestCode}) başarıyla bağlandı!`);
      if (onLinked) onLinked(updated);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      alert(`Hata: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleUnlink = async () => {
    if (!record) return;
    if (!window.confirm('Bu faturanın Prizma sürecine olan bağlantısını kaldırmak istediğinize emin misiniz?')) {
      return;
    }

    setIsUnlinking(true);
    try {
      const res = await fetch('/api/prizma/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordType,
          recordId: record.id
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Kaldırılamadı');

      const updated = {
        ...record,
        prizmaProcessId: null,
        prizmaRequestCode: null,
        prizmaOrderCode: null,
        prizmaDocumentNo: null,
        prizmaSupplier: null,
        prizmaJobsite: null,
        prizmaStatus: null,
        prizmaAmount: null,
        prizmaLinkedAt: null
      };

      setToastMessage('Prizma bağlantısı kaldırıldı.');
      if (onLinked) onLinked(updated);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      alert(`Hata: ${err.message}`);
    } finally {
      setIsUnlinking(false);
    }
  };

  if (!isOpen || !record) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md font-bold text-lg text-white">
              П
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white">Prizma (PM) Entegrasyonu & Süreç Eşleştirme</h3>
                {status?.connected ? (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Bağlantı Aktif ({status.userName})</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    <AlertCircle className="w-3 h-3 text-amber-400" />
                    <span>Bağlanıyor...</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                pm.gescons.ru üzerindeki Talep (BTF), Sipariş (STF) ve Ödeme Formlarıyla otomatik eşleştirme
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast */}
        {toastMessage && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2.5 flex items-center justify-between text-xs font-bold text-emerald-800 animate-in slide-in-from-top-2">
            <span className="flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>{toastMessage}</span>
            </span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
          
          {/* Current Gescons Record Summary Card */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Mevcut Gescons Fatura / Teklif Bilgileri</span>
              <span className="font-mono text-indigo-600">ID: {record.id}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-500 block">Fatura / Teklif No:</span>
                <span className="font-bold font-mono text-slate-900">{invoiceNo || 'Belirtilmedi'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Tedarikçi:</span>
                <span className="font-bold text-slate-900 truncate block" title={supplierName}>{supplierName || 'Belirtilmedi'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Tutar:</span>
                <span className="font-extrabold font-mono text-emerald-700">{formatRuble(amount)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Şantiye:</span>
                <span className="font-bold text-slate-900">{jobsiteName || 'Belirtilmedi'}</span>
              </div>
            </div>
          </div>

          {/* Currently Linked Status (If any) */}
          {isAlreadyLinked && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-black text-blue-950 uppercase tracking-wide">
                      Bu Fatura Bir Prizma Sürecine Bağlandı
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-200 text-blue-900 font-mono">
                      {record.prizmaStatus || 'Aktif'}
                    </span>
                  </div>
                  <div className="text-xs text-blue-900 font-semibold mt-1 space-x-3">
                    {record.prizmaRequestCode && <span>Talep Kodu: <b>{record.prizmaRequestCode}</b></span>}
                    {record.prizmaOrderCode && <span>Sipariş Kodu: <b>{record.prizmaOrderCode}</b></span>}
                    {record.prizmaAmount && <span>Tutar: <b>{formatRuble(record.prizmaAmount)}</b></span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <a
                  href="https://pm.gescons.ru/process"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 shadow-2xs"
                >
                  <span>Prizma'da Aç</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={isUnlinking}
                  className="px-3 py-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  {isUnlinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                  <span>Bağlantıyı Kaldır</span>
                </button>
              </div>
            </div>
          )}

          {/* Automatic AI Matching Suggestions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  Otomatik Bulunan Prizma Eşleşmeleri ({matches.length})
                </h4>
              </div>
              {isLoadingMatches && (
                <span className="flex items-center space-x-1.5 text-xs text-slate-500 font-semibold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  <span>Prizma taranıyor...</span>
                </span>
              )}
            </div>

            {isLoadingMatches ? (
              <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-500 text-xs">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
                <span>Prizma veritabanından fatura numarası ve tutar eşleşmeleri getiriliyor...</span>
              </div>
            ) : matches.length > 0 ? (
              <div className="space-y-2.5">
                {matches.map((item, mIdx) => (
                  <div
                    key={`${item.id || 'match'}_${mIdx}`}
                    className="p-3.5 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">
                          {item.requestCode}
                        </span>
                        {item.orderCode && (
                          <span className="font-mono font-bold text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                            {item.orderCode}
                          </span>
                        )}
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {item.status || 'Tamamlandı'}
                        </span>
                        {item.matchScore && item.matchScore >= 50 && (
                          <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300">
                            % {item.matchScore} Uyum
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-800 font-semibold flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>Fatura No: <b className="font-mono">{item.documentNo || '-'}</b></span>
                        <span>Tedarikçi: <b>{item.supplier || '-'}</b></span>
                        <span>Şantiye: <b>{item.jobsite || '-'}</b></span>
                        <span>Tutar: <b className="font-mono text-emerald-700">{formatRuble(item.invoiceAmount || 0)}</b></span>
                      </div>

                      {item.matchReasons && item.matchReasons.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {item.matchReasons.map((r, rIdx) => (
                            <span key={rIdx} className="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.2 rounded font-medium border border-indigo-100">
                              ✓ {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => handleLink(item)}
                        disabled={actionLoadingId === item.id}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer shadow-xs"
                      >
                        {actionLoadingId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        <span>Bu Süreçle Bağla</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-white rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
                Fatura no veya tutara göre doğrudan eşleşen bir Prizma talebi bulunamadı. Aşağıdaki arama kutusunu kullanarak manuel arama yapabilirsiniz.
              </div>
            )}
          </div>

          {/* Manual Search Section */}
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-2xs space-y-3">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <span>Prizma'da Manuel Arama Yap</span>
            </h4>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="STF / BTF Kodu, Fatura No, Tedarikçi veya Şantiye Adı..."
                className="flex-1 px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Ara</span>
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 max-h-60 overflow-y-auto">
                {searchResults.map((item, sIdx) => (
                  <div
                    key={`${item.id || 'search'}_${sIdx}`}
                    className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center space-x-2 font-mono font-bold text-slate-900">
                        <span>{item.requestCode}</span>
                        {item.orderCode && <span className="text-blue-600">({item.orderCode})</span>}
                        <span className="text-slate-500 font-sans font-normal text-[11px]">{item.supplier}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        <span>Fatura No: <b>{item.documentNo || '-'}</b> | Tutar: <b>{formatRuble(item.invoiceAmount || 0)}</b> | Şantiye: <b>{item.jobsite || '-'}</b></span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleLink(item)}
                      disabled={actionLoadingId === item.id}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold cursor-pointer shrink-0"
                    >
                      {actionLoadingId === item.id ? 'Bağlanıyor...' : 'Bağla'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center space-x-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Prizma Platformu: <a href="https://pm.gescons.ru/process" target="_blank" rel="noopener noreferrer" className="text-indigo-600 font-bold hover:underline">pm.gescons.ru/process</a></span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-lg text-xs transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>

      </div>
    </div>
  );
};
