import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { KeyRound, ShieldCheck, UserCheck, AlertCircle, CheckCircle2, Lock, X, Eye, EyeOff } from 'lucide-react';

interface PasswordChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SupervisorItem {
  supervisorId: string;
  name: string;
  jobsites: string;
}

const DEFAULT_SUPERVISORS_LIST: SupervisorItem[] = [
  { supervisorId: 'sup_1', name: 'Nuri Buga', jobsites: 'Jk Dream Riva / Otel Dream Riva / Mnevniki' },
  { supervisorId: 'sup_4', name: 'Muhammed Hancı', jobsites: 'SET OF3a / Veer Ub10' },
  { supervisorId: 'sup_3', name: 'Serkan Demirbaş', jobsites: 'Jk Jois / Bs Jois' },
  { supervisorId: 'sup_2', name: 'Osman Yılmaz', jobsites: 'Citybay6' },
  { supervisorId: 'sup_5', name: 'Halil İbrahim Zengin', jobsites: 'PRB2' }
];

export const PasswordChangeModal: React.FC<PasswordChangeModalProps> = ({ isOpen, onClose }) => {
  const { user, changePassword, adminChangePassword } = useAuth();
  const [activeTab, setActiveTab] = useState<'my' | 'admin'>('my');

  const [supervisorsList, setSupervisorsList] = useState<SupervisorItem[]>(DEFAULT_SUPERVISORS_LIST);

  // Personal Password State
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPins, setShowPins] = useState(false);

  // Admin Supervisor Password State
  const [selectedTargetSupId, setSelectedTargetSupId] = useState<string>(DEFAULT_SUPERVISORS_LIST[0].supervisorId);
  const [adminNewPin, setAdminNewPin] = useState('');

  // General Status
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const fetchSupervisors = async () => {
      try {
        const res = await fetch('/api/supervisors');
        if (res.ok) {
          const sups = await res.json();
          if (Array.isArray(sups) && sups.length > 0) {
            const mapped: SupervisorItem[] = sups.map((s: any) => ({
              supervisorId: s.id,
              name: s.name,
              jobsites: s.department || 'Satınalma'
            }));
            if (isMounted) {
              setSupervisorsList(mapped);
              if (!mapped.some(m => m.supervisorId === selectedTargetSupId)) {
                setSelectedTargetSupId(mapped[0].supervisorId);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch supervisors for PasswordChangeModal', err);
      }
    };
    fetchSupervisors();
    return () => { isMounted = false; };
  }, [isOpen]);

  if (!isOpen || !user) return null;

  const handleMyPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!oldPin.trim()) {
      setMessage({ type: 'error', text: 'Lütfen mevcut şifrenizi giriniz.' });
      return;
    }
    if (!newPin.trim() || newPin.trim().length < 3) {
      setMessage({ type: 'error', text: 'Yeni şifre en az 3 karakter olmalıdır.' });
      return;
    }
    if (newPin !== confirmPin) {
      setMessage({ type: 'error', text: 'Yeni şifreler eşleşmiyor!' });
      return;
    }

    setIsLoading(true);
    const res = await changePassword(oldPin.trim(), newPin.trim());
    setIsLoading(false);

    if (res.success) {
      setMessage({ type: 'success', text: res.message || 'Şifreniz başarıyla değiştirildi!' });
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
    } else {
      setMessage({ type: 'error', text: res.message || 'Şifre değiştirme başarısız.' });
    }
  };

  const handleAdminSupervisorPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!adminNewPin.trim() || adminNewPin.trim().length < 3) {
      setMessage({ type: 'error', text: 'Yeni şifre en az 3 karakter olmalıdır.' });
      return;
    }

    setIsLoading(true);
    const res = await adminChangePassword(selectedTargetSupId, adminNewPin.trim());
    setIsLoading(false);

    if (res.success) {
      const targetSup = supervisorsList.find(s => s.supervisorId === selectedTargetSupId);
      setMessage({
        type: 'success',
        text: res.message || `${targetSup?.name || 'Şef'} şifresi başarıyla yenilendi!`
      });
      setAdminNewPin('');
    } else {
      setMessage({ type: 'error', text: res.message || 'Şef şifresi güncellenemedi.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl p-6 text-white relative overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Title */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-100">Şifre Yönetim Paneli</h3>
            <p className="text-xs text-slate-400">Aktif Kullanıcı: <strong className="text-amber-300">{user.displayName}</strong></p>
          </div>
        </div>

        {/* Tab Headers (if Admin) */}
        {user.role === 'admin' && (
          <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 mb-5">
            <button
              onClick={() => { setActiveTab('my'); setMessage(null); }}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'my'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Kendi Şifremi Değiştir
            </button>
            <button
              onClick={() => { setActiveTab('admin'); setMessage(null); }}
              className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center space-x-1 ${
                activeTab === 'admin'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Şef Şifresi Değiştir</span>
            </button>
          </div>
        )}

        {/* Feedback Message */}
        {message && (
          <div className={`p-3 rounded-2xl border mb-4 text-xs flex items-center space-x-2 ${
            message.type === 'success'
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/20 border-rose-500/30 text-rose-300'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        {/* TAB 1: Own Password Change */}
        {activeTab === 'my' && (
          <form onSubmit={handleMyPasswordSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Mevcut Şifre</label>
              <div className="relative">
                <input
                  type={showPins ? 'text' : 'password'}
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value)}
                  placeholder="Mevcut şifrenizi giriniz..."
                  className="w-full py-2.5 pl-9 pr-9 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500"
                />
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPins(!showPins)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPins ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Yeni Şifre</label>
              <input
                type={showPins ? 'text' : 'password'}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="Yeni şifreniz (En az 3 karakter)..."
                className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Yeni Şifre (Tekrar)</label>
              <input
                type={showPins ? 'text' : 'password'}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="Yeni şifrenizi doğrulayınız..."
                className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50 mt-2"
            >
              {isLoading ? 'Kaydediliyor...' : 'Şifremi Güncelle'}
            </button>
          </form>
        )}

        {/* TAB 2: Admin Changing Supervisor Password */}
        {activeTab === 'admin' && user.role === 'admin' && (
          <form onSubmit={handleAdminSupervisorPasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Şifresi Değiştirilecek Satınalma Şefi:
              </label>
              <select
                value={selectedTargetSupId}
                onChange={(e) => setSelectedTargetSupId(e.target.value)}
                className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-bold text-xs focus:outline-none focus:border-indigo-500"
              >
                {supervisorsList.map((sup) => (
                  <option key={sup.supervisorId} value={sup.supervisorId}>
                    {sup.name} ({sup.jobsites})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Atanacak Yeni Şifre / PIN Kodu:
              </label>
              <input
                type="text"
                value={adminNewPin}
                onChange={(e) => setAdminNewPin(e.target.value)}
                placeholder="Örn: nuri1234, 5555, vb..."
                className="w-full py-2.5 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
            >
              {isLoading ? 'Güncelleniyor...' : 'Şefin Şifresini Güncelle'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
