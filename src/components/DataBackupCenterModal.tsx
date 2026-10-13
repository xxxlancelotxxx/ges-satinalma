import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Download,
  Upload,
  RefreshCw,
  Clock,
  Database,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  HardDrive,
  History,
  X,
  Lock,
  ArrowDownToLine,
  RotateCcw,
  Sparkles,
  AlertTriangle,
  Eye
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

export interface SnapshotItem {
  id: string;
  timestamp: string;
  dateFormatted: string;
  trigger: 'scheduled' | 'manual' | 'pre-restore' | 'auto-mutation' | 'import';
  recordCounts: {
    supervisors: number;
    jobsites: number;
    discounts: number;
    invoices: number;
  };
  totalRecords: number;
  sizeBytes: number;
  checksum: string;
  status: 'healthy' | 'verified';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored?: () => void;
}

export const DataBackupCenterModal: React.FC<Props> = ({ isOpen, onClose, onDataRestored }) => {
  useModalBackHandler(isOpen, onClose);

  const { t, language } = useLanguage();
  const { user } = useAuth();

  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [currentCounts, setCurrentCounts] = useState<{ supervisors: number; jobsites: number; discounts: number; invoices: number } | null>(null);
  const [lastBackupTime, setLastBackupTime] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Restore confirmation dialog
  const [snapshotToRestore, setSnapshotToRestore] = useState<SnapshotItem | null>(null);
  const [preserveNewRecords, setPreserveNewRecords] = useState<boolean>(true);
  const [simulationResult, setSimulationResult] = useState<any | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  const fetchBackupList = async () => {
    if (user?.role !== 'admin') return;
    const authHeaders: Record<string, string> = {
      'x-session-token': user?.token || 'admin_authorized',
      'x-user-name': user?.username || 'admin',
      'x-user-role': user?.role || 'admin'
    };

    try {
      setIsLoading(true);
      const res = await fetch('/api/backup/list', {
        headers: authHeaders
      });
      const data = await res.json();
      if (data.success) {
        setSnapshots(data.manifest?.snapshots || []);
        setCurrentCounts(data.currentCounts || null);
        setLastBackupTime(data.lastBackupTime || null);
      } else {
        showToast('error', data.error || 'Yedek listesi alınamadı.');
      }
    } catch (err: any) {
      console.error('Backup list fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && user?.role === 'admin') {
      fetchBackupList();
    }
  }, [isOpen, user?.role]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleCreateBackup = async () => {
    if (user?.role !== 'admin') return;
    try {
      setIsActionLoading(true);
      const res = await fetch('/api/backup/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user.token || 'admin_authorized',
          'x-user-name': user.username || 'admin',
          'x-user-role': user.role || 'admin'
        },
        body: JSON.stringify({ label: 'Kullanıcı Manuel Yedeği', description: 'Kullanıcı arayüzünden oluşturulan anlık snapshot' })
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Yeni güvenli anlık yedek başarıyla oluşturuldu ve buluta eşitlendi.');
        await fetchBackupList();
      } else {
        showToast('error', data.error || 'Yedek oluşturulamadı.');
      }
    } catch (err: any) {
      showToast('error', 'Yedekleme hatası: ' + err.message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDownloadBackup = (id: string) => {
    if (user?.role !== 'admin') return;
    const token = user.token || 'admin_authorized';
    window.location.href = `/api/backup/download/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
  };

  const handleExportLiveBackup = () => {
    if (user?.role !== 'admin') return;
    const token = user.token || 'admin_authorized';
    window.location.href = `/api/backup/export-current?token=${encodeURIComponent(token)}`;
  };

  const handleRunSimulation = async () => {
    if (!snapshotToRestore || user?.role !== 'admin') return;
    try {
      setIsSimulating(true);
      const res = await fetch(`/api/backup/restore/${encodeURIComponent(snapshotToRestore.id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user.token || 'admin_authorized',
          'x-user-name': user.username || 'admin',
          'x-user-role': user.role || 'admin'
        },
        body: JSON.stringify({ preserveNewRecords, dryRun: true })
      });
      const data = await res.json();
      if (data.success) {
        setSimulationResult(data);
        showToast('success', 'Dry-Run simülasyonu başarıyla tamamlandı. Aşağıdan sonuçları inceleyebilirsiniz.');
      } else {
        showToast('error', data.error || 'Simülasyon başarısız oldu.');
      }
    } catch (err: any) {
      showToast('error', 'Simülasyon hatası: ' + err.message);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!snapshotToRestore || user?.role !== 'admin') return;
    try {
      setIsActionLoading(true);
      const res = await fetch(`/api/backup/restore/${encodeURIComponent(snapshotToRestore.id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user.token || 'admin_authorized',
          'x-user-name': user.username || 'admin',
          'x-user-role': user.role || 'admin'
        },
        body: JSON.stringify({ preserveNewRecords, confirm: true, dryRun: false })
      });
      const data = await res.json();
      if (data.success) {
        const statsMsg = data.stats 
          ? ` (${data.stats.newRecordsPreserved} yeni eklenen fatura/indirim korundu)`
          : '';
        showToast('success', `Yedek (${snapshotToRestore.dateFormatted}) başarıyla geri yüklendi.${statsMsg}`);
        setSnapshotToRestore(null);
        setSimulationResult(null);
        await fetchBackupList();
        if (onDataRestored) onDataRestored();
      } else {
        showToast('error', data.error || 'Geri yükleme başarısız oldu.');
      }
    } catch (err: any) {
      showToast('error', 'Geri yükleme hatası: ' + err.message);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleQuickRestoreLatest = () => {
    const candidate = snapshots.find(s => s.trigger !== 'pre-restore') || snapshots[0];
    if (candidate) {
      setSnapshotToRestore(candidate);
      setSimulationResult(null);
    } else {
      showToast('error', 'Geri yüklenebilecek geçerli bir yedek bulunamadı.');
    }
  };

  const handleFileUploadAndImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (user?.role !== 'admin') return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsActionLoading(true);
      const text = await file.text();
      const json = JSON.parse(text);

      const res = await fetch('/api/backup/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user.token || 'admin_authorized',
          'x-user-name': user.username || 'admin',
          'x-user-role': user.role || 'admin'
        },
        body: JSON.stringify(json)
      });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Yedek dosyası başarıyla içeri aktarıldı ve sisteme kaydedildi.');
        await fetchBackupList();
        if (onDataRestored) onDataRestored();
      } else {
        showToast('error', data.error || 'İçe aktarma başarısız.');
      }
    } catch (err: any) {
      showToast('error', 'Geçersiz JSON yedek dosyası veya aktarım hatası: ' + err.message);
    } finally {
      setIsActionLoading(false);
      e.target.value = '';
    }
  };

  const getTriggerLabel = (trigger: SnapshotItem['trigger']) => {
    switch (trigger) {
      case 'scheduled':
        return { label: 'Otomatik Planlı', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
      case 'manual':
        return { label: 'Manuel Alınan', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'pre-restore':
        return { label: 'Geri Yükleme Koruması', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'import':
        return { label: 'İçe Aktarma', bg: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' };
      default:
        return { label: 'Sistem', bg: 'bg-slate-700 text-slate-300 border-slate-600' };
    }
  };

  if (!isOpen) return null;

  // Strict Security Access Guard: Only Admin can view or interact with Backup Center
  if (user?.role !== 'admin') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
        <div className="bg-slate-900 border border-rose-500/40 rounded-2xl w-full max-w-md shadow-2xl p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4 border border-rose-500/30 shadow-inner">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Erişim Yetkisi Yok</h3>
          <p className="text-slate-300 text-xs leading-relaxed mb-6">
            Veri Güvenliği ve Yedekleme Merkezi yalnızca <strong className="text-amber-400">Sistem Yöneticisi (Admin)</strong> yetkisine sahip kullanıcıların erişimine açıktır. Diğer kullanıcı rolleri için bu pencere kısıtlanmıştır.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
          >
            Pencereyi Kapat
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                Veri Güvenliği ve Otomatik Yedekleme Merkezi
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Aktif Koruma
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Firestore veri kaybı önleme altyapısı, döngüsel anlık görüntüler ve tek tıkla geri yükleme
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notification Toast */}
        {toastMessage && (
          <div
            className={`p-3.5 mx-5 mt-4 rounded-xl flex items-center space-x-3 border ${
              toastMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            )}
            <span className="text-xs font-semibold">{toastMessage.text}</span>
          </div>
        )}

        <div className="p-5 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
          {/* Status & Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Kayıtlı Faturalar</span>
                <FileCheck className="w-4 h-4 text-indigo-400" />
              </div>
              <p className="text-xl font-bold text-slate-100">{currentCounts?.invoices ?? '...'}</p>
              <p className="text-[10px] text-emerald-400 mt-1">✓ Canlı veritabanında güvende</p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>İndirim Kayıtları</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </div>
              <p className="text-xl font-bold text-slate-100">{currentCounts?.discounts ?? '...'}</p>
              <p className="text-[10px] text-emerald-400 mt-1">✓ Read-after-write korumalı</p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Toplam Anlık Görüntü</span>
                <History className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-xl font-bold text-slate-100">{snapshots.length}</p>
              <p className="text-[10px] text-slate-400 mt-1">Döngüsel saklama (En az 7 snapshot)</p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-xl">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Son Yedekleme Zamanı</span>
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-xs font-bold text-slate-200 truncate mt-1">
                {lastBackupTime ? new Date(lastBackupTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Henüz yok'}
              </p>
              <p className="text-[10px] text-blue-400 mt-1">Her 12 saatte bir otomatik tetiklenir</p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-950/60 border border-slate-800 rounded-xl">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCreateBackup}
                disabled={isActionLoading}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center space-x-2 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Şimdi Anlık Tam Yedek Al</span>
              </button>

              <button
                onClick={handleQuickRestoreLatest}
                disabled={isActionLoading || snapshots.length === 0}
                className="px-3.5 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center space-x-1.5 cursor-pointer"
                title="Sorun yaşanmadan önceki en son sağlıklı yedeğe akıllı dönüş yap"
              >
                <RotateCcw className="w-4 h-4 text-amber-400" />
                <span>Sorun Öncesi Yedeğe Dön</span>
              </button>

              <button
                onClick={handleExportLiveBackup}
                disabled={isActionLoading}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700 flex items-center space-x-1.5 cursor-pointer"
                title="Tüm veritabanını tek JSON dosyası olarak indir"
              >
                <Download className="w-4 h-4 text-blue-400" />
                <span>Canlı Veriyi İndir (JSON)</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <label className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700 flex items-center space-x-1.5 cursor-pointer">
                <Upload className="w-4 h-4 text-amber-400" />
                <span>Yedek Dosyası Yükle (İçe Aktar)</span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUploadAndImport}
                  disabled={isActionLoading}
                />
              </label>

              <button
                onClick={fetchBackupList}
                disabled={isLoading}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer"
                title="Listeyi Yenile"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Snapshots Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                Kayıtlı Yedek Noktaları (Snapshots)
              </h3>
              <span className="text-xs text-slate-400">
                Geri yükleme yapıldığında otomatik olarak mevcut anlık durum yedeklenir.
              </span>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="p-3">Tarih / Saat</th>
                      <th className="p-3">Tür</th>
                      <th className="p-3 text-center">Fatura</th>
                      <th className="p-3 text-center">İndirim</th>
                      <th className="p-3 text-center">Şantiye/Şef</th>
                      <th className="p-3">Boyut</th>
                      <th className="p-3 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {snapshots.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500">
                          {isLoading ? 'Yedek listesi yükleniyor...' : 'Henüz kaydedilmiş snapshot bulunmuyor.'}
                        </td>
                      </tr>
                    ) : (
                      snapshots.map((snap) => {
                        const trig = getTriggerLabel(snap.trigger);
                        return (
                          <tr key={snap.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 font-medium text-slate-200">
                              <div>{snap.dateFormatted || snap.timestamp}</div>
                              <div className="text-[10px] font-mono text-slate-500">{snap.id}</div>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${trig.bg}`}>
                                {trig.label}
                              </span>
                            </td>
                            <td className="p-3 text-center font-semibold text-indigo-300">
                              {snap.recordCounts.invoices}
                            </td>
                            <td className="p-3 text-center font-semibold text-amber-300">
                              {snap.recordCounts.discounts}
                            </td>
                            <td className="p-3 text-center text-slate-400">
                              {snap.recordCounts.jobsites} / {snap.recordCounts.supervisors}
                            </td>
                            <td className="p-3 text-slate-400 font-mono">
                              {(snap.sizeBytes / 1024).toFixed(1)} KB
                            </td>
                            <td className="p-3 text-right space-x-2 whitespace-nowrap">
                              <button
                                onClick={() => handleDownloadBackup(snap.id)}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1 cursor-pointer"
                                title="Bu yedeği indir"
                              >
                                <Download className="w-3 h-3" />
                                <span>İndir</span>
                              </button>

                              <button
                                onClick={() => setSnapshotToRestore(snap)}
                                className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-semibold transition-all inline-flex items-center space-x-1 cursor-pointer"
                                title="Bu noktaya geri yükle"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Geri Yükle</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tüm veriler atomik snapshots ve SHA-256 doğrulama ile korunmaktadır.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {snapshotToRestore && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-start space-x-3">
              <div className="p-3 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-xl shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Yedekten Geri Yükleme Onayı</h3>
                <p className="text-xs text-slate-300 mt-1">
                  Sistemi <strong className="text-amber-400">{snapshotToRestore.dateFormatted}</strong> tarihindeki duruma geri yüklemek üzeresiniz.
                </p>
              </div>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-xs space-y-1.5 text-slate-300">
              <div className="flex justify-between">
                <span>Geri Yüklenecek Faturalar:</span>
                <strong className="text-indigo-400">{snapshotToRestore.recordCounts.invoices} adet</strong>
              </div>
              <div className="flex justify-between">
                <span>Geri Yüklenecek İndirimler:</span>
                <strong className="text-amber-400">{snapshotToRestore.recordCounts.discounts} adet</strong>
              </div>
              <div className="flex justify-between">
                <span>Geri Yüklenecek Şantiye/Şefler:</span>
                <strong className="text-slate-200">{snapshotToRestore.recordCounts.jobsites} / {snapshotToRestore.recordCounts.supervisors}</strong>
              </div>
            </div>

            {/* Smart Preservation Option */}
            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveNewRecords}
                  onChange={(e) => setPreserveNewRecords(e.target.checked)}
                  className="mt-0.5 rounded border-emerald-500/50 text-emerald-600 focus:ring-emerald-500 bg-slate-900"
                />
                <div className="text-xs">
                  <span className="font-bold text-emerald-300">Akıllı Veri Koruma Kalkanı (Önerilen)</span>
                  <p className="text-slate-300 text-[11px] mt-0.5">
                    Bu yedeğin alındığı tarihten SONRA sisteme eklenmiş yeni faturalar ve indirimler silinmez, güvenle korunur ve geri yüklenen durumla birleştirilir.
                  </p>
                </div>
              </label>
            </div>

            {/* Simulation Results Display (if run) */}
            {simulationResult && (
              <div className="p-3.5 bg-blue-950/40 border border-blue-500/40 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-blue-300 font-bold border-b border-blue-500/20 pb-1.5">
                  <span className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Dry-Run Simülasyon Sonucu (Değişiklik Yapılmadı)</span>
                  </span>
                  <span className="text-[10px] bg-blue-500/20 px-2 py-0.5 rounded text-blue-200">Simülasyon Aktif</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-300 pt-1">
                  <div>
                    <span className="text-slate-400">Yedekten Dönecek:</span>
                    <p className="font-semibold text-indigo-300">{simulationResult.stats?.restoredFromSnapshotInvoices || 0} Fatura, {simulationResult.stats?.restoredFromSnapshotDiscounts || 0} İndirim</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Korunacak Yeni Kayıt:</span>
                    <p className="font-semibold text-emerald-300">{simulationResult.stats?.newRecordsPreserved || 0} Adet</p>
                  </div>
                  <div>
                    <span className="text-slate-400">PDF Doğrulaması:</span>
                    <p className="font-semibold text-amber-300">{simulationResult.pdfAudit?.availableInStorage || 0} / {simulationResult.pdfAudit?.totalReferencedPdfs || 0} Depoda Hazır</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Tahmini Toplam Fatura:</span>
                    <p className="font-semibold text-slate-100">{simulationResult.predictedCounts?.invoices || 0} Adet</p>
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-xs text-indigo-300">
              <strong>Güvenlik Garantisi:</strong> İşlem başlamadan önce sistemin mevcut canlı hali otomatik olarak "Geri Yükleme Koruması" olarak buluta ve diske yedeklenecektir.
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleRunSimulation}
                disabled={isActionLoading || isSimulating}
                className="px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1.5 cursor-pointer"
              >
                {isSimulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{simulationResult ? 'Simülasyonu Yenile' : 'Önizleme Yap (Dry-Run)'}</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { setSnapshotToRestore(null); setSimulationResult(null); }}
                  disabled={isActionLoading || isSimulating}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  İptal
                </button>
                <button
                  onClick={handleConfirmRestore}
                  disabled={isActionLoading || isSimulating}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-colors shadow-md flex items-center space-x-1.5 cursor-pointer"
                >
                  {isActionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  <span>{simulationResult ? 'Onayla ve Geri Yükle' : 'Geri Yüklemeyi Başlat'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
