import React from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Database, 
  HardDrive, 
  ShieldCheck, 
  FileText, 
  Sparkles, 
  Check, 
  X,
  ExternalLink
} from 'lucide-react';
import { PersistenceStatus } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  status: PersistenceStatus;
  recordTitle?: string;
  itemsCount?: number;
  totalAmountFormatted?: string;
  onViewDetails?: () => void;
}

export const RegistrationStatusModal: React.FC<Props> = ({
  isOpen,
  onClose,
  status,
  recordTitle,
  itemsCount,
  totalAmountFormatted,
  onViewDetails
}) => {
  if (!isOpen) return null;

  const isCompleteSuccess = 
    (status.firestoreStatus === 'success' || status.firestoreStatus === 'local_fallback') && 
    status.backupStatus === 'success' && 
    status.mathCheckStatus !== 'failed';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col transform transition-all animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className={`p-5 flex items-center justify-between text-white ${
          isCompleteSuccess ? 'bg-gradient-to-r from-emerald-600 to-teal-700' : 'bg-gradient-to-r from-amber-600 to-rose-700'
        }`}>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-md">
              {isCompleteSuccess ? (
                <CheckCircle2 className="w-6 h-6 text-white" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">
                {isCompleteSuccess ? 'Kayıt Başarıyla Oluşturuldu' : 'Kayıt Doğrulama Uyarısı'}
              </h3>
              <p className="text-xs text-white/80 mt-0.5">
                Kayıt ID: <span className="font-mono font-semibold">{status.recordId}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Summary Record Details */}
          {recordTitle && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium">İşlenen Kayıt</p>
                <h4 className="text-sm font-bold text-slate-800">{recordTitle}</h4>
                {itemsCount !== undefined && (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {itemsCount} Malzeme Kalemi • Malzeme Fiyat Havuzuna Eklendi
                  </p>
                )}
              </div>
              {totalAmountFormatted && (
                <div className="text-right">
                  <p className="text-[11px] text-slate-500 font-medium">Toplam Tutar</p>
                  <p className="text-base font-black text-slate-900">{totalAmountFormatted}</p>
                </div>
              )}
            </div>
          )}

          {/* Verification Status Matrix */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Sistem Güvenilirlik & Doğrulama Durumu
            </h4>

            <div className="grid grid-cols-1 gap-2">
              {/* Firestore Status */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <div className="flex items-center space-x-3">
                  <Database className="w-4 h-4 text-indigo-600" />
                  <div>
                    <span className="text-xs font-semibold text-slate-800">Firestore Veritabanı</span>
                    <p className="text-[11px] text-slate-500">
                      {status.readBackVerified ? 'Kalıcı yazıldı ve okuma doğrulandı' : 'Veri tabanı katmanı'}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  status.firestoreStatus === 'success' ? 'bg-emerald-100 text-emerald-800' :
                  status.firestoreStatus === 'warning' ? 'bg-amber-100 text-amber-800' :
                  status.firestoreStatus === 'failed' ? 'bg-rose-100 text-rose-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {status.firestoreStatus === 'success' ? 'Başarılı' :
                   status.firestoreStatus === 'warning' ? 'Uyarı / Doğrulandı' :
                   status.firestoreStatus === 'failed' ? 'Yazma Hatası' : 'Yerel Hafıza'}
                </span>
              </div>

              {/* Backup & Snapshot Status */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <div className="flex items-center space-x-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <div>
                    <span className="text-xs font-semibold text-slate-800">Yedekleme & Snapshot</span>
                    <p className="text-[11px] text-slate-500">Tarihli yerel/atomik kopya</p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  status.backupStatus === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {status.backupStatus === 'success' ? 'Başarılı' : 'Başarısız'}
                </span>
              </div>

              {/* File Storage Status */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <div className="flex items-center space-x-3">
                  <HardDrive className="w-4 h-4 text-sky-600" />
                  <div>
                    <span className="text-xs font-semibold text-slate-800">Dosya Saklama Durumu</span>
                    <p className="text-[11px] text-slate-500">Orijinal fatura/belge kasası</p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  status.fileStorageStatus === 'stored' ? 'bg-emerald-100 text-emerald-800' :
                  status.fileStorageStatus === 'failed' ? 'bg-rose-100 text-rose-800' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {status.fileStorageStatus === 'stored' ? 'Başarılı' :
                   status.fileStorageStatus === 'failed' ? 'Saklanamadı' : 'Dosyasız Kayıt'}
                </span>
              </div>

              {/* Mathematical Consistency */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <div className="flex items-center space-x-3">
                  <Check className="w-4 h-4 text-teal-600" />
                  <div>
                    <span className="text-xs font-semibold text-slate-800">Matematiksel Kontrol</span>
                    <p className="text-[11px] text-slate-500">Miktar × Birim Fiyat ve Toplam Tutarlılığı</p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  status.mathCheckStatus === 'valid' ? 'bg-emerald-100 text-emerald-800' :
                  status.mathCheckStatus === 'warning' ? 'bg-amber-100 text-amber-800' :
                  'bg-rose-100 text-rose-800'
                }`}>
                  {status.mathCheckStatus === 'valid' ? 'Başarılı' :
                   status.mathCheckStatus === 'warning' ? 'Küçük Yuvarlama Farkı' : 'Hatalı Toplam'}
                </span>
              </div>

              {/* AI Confidence */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <div className="flex items-center space-x-3">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <div>
                    <span className="text-xs font-semibold text-slate-800">AI Güven Seviyesi</span>
                    <p className="text-[11px] text-slate-500">Gemini OCR ve standartlaştırma kesinliği</p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                  status.aiConfidenceLevel === 'high' ? 'bg-purple-100 text-purple-800' :
                  status.aiConfidenceLevel === 'medium' ? 'bg-blue-100 text-blue-800' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {status.aiConfidenceLevel === 'high' ? 'Yüksek (%95+)' :
                   status.aiConfidenceLevel === 'medium' ? 'Orta (%80-%95)' : 'Düşük'}
                </span>
              </div>
            </div>
          </div>

          {/* Warnings List if any */}
          {status.warnings && status.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-800 space-y-1">
              <p className="font-bold flex items-center space-x-1.5 text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Kayıt İle İlgili Uyarılar:</span>
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700 pl-1">
                {status.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end space-x-3">
          {onViewDetails && (
            <button
              onClick={() => {
                onClose();
                onViewDetails();
              }}
              className="px-4 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors flex items-center space-x-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Kaydı Görüntüle</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-sm transition-colors"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
