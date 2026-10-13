import React, { useState, useEffect } from 'react';
import { useAuth, UserRole } from '../context/AuthContext';
import { GesLogo } from './GesLogo';
import { ShieldCheck, Lock, UserCheck, Eye, EyeOff, AlertCircle, ArrowRight, KeyRound, Building2, User, Users } from 'lucide-react';
import { INITIAL_PERSONNEL } from '../data/initialData';

interface SupervisorUserOption {
  supervisorId: string;
  username: string;
  name: string;
  defaultPin: string;
  jobsitesText: string;
  avatar: string;
  hasCustomPin?: boolean;
}

interface PersonnelUserOption {
  personnelId: string;
  supervisorId: string;
  username: string;
  name: string;
  title: string;
  defaultPin: string;
  supervisorName: string;
  avatar: string;
  hasCustomPin?: boolean;
}

const DEFAULT_SUPERVISOR_USERS: SupervisorUserOption[] = [
  {
    supervisorId: 'sup_1',
    username: 'nuri',
    name: 'Nuri Buga',
    defaultPin: 'nuri123',
    jobsitesText: 'Jk Dream Riva / Otel Dream Riva / Mnevniki',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'
  },
  {
    supervisorId: 'sup_4',
    username: 'muhammed',
    name: 'Muhammed Hancı',
    defaultPin: 'muhammed123',
    jobsitesText: 'SET OF3a / Veer Ub10',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80'
  },
  {
    supervisorId: 'sup_3',
    username: 'serkan',
    name: 'Serkan Demirbaş',
    defaultPin: 'serkan123',
    jobsitesText: 'Jk Jois / Bs Jois',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80'
  },
  {
    supervisorId: 'sup_2',
    username: 'osman',
    name: 'Osman Yılmaz',
    defaultPin: 'osman123',
    jobsitesText: 'Citybay6',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
  },
  {
    supervisorId: 'sup_5',
    username: 'halil',
    name: 'Halil İbrahim Zengin',
    defaultPin: 'halil123',
    jobsitesText: 'PRB2',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80'
  }
];

const DEFAULT_PERSONNEL_USERS: PersonnelUserOption[] = INITIAL_PERSONNEL.map(p => {
  const username = p.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return {
    personnelId: p.id,
    supervisorId: p.supervisorId,
    username,
    name: p.name,
    title: p.title || 'Satınalma Personeli',
    defaultPin: `${username}123`,
    supervisorName: p.supervisorName || 'Şef',
    avatar: p.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80'
  };
});

export const LoginModal: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const [pin, setPin] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('supervisor');
  const [supervisorList, setSupervisorList] = useState<SupervisorUserOption[]>(DEFAULT_SUPERVISOR_USERS);
  const [selectedSupervisor, setSelectedSupervisor] = useState<SupervisorUserOption>(DEFAULT_SUPERVISOR_USERS[0]);
  const [personnelList, setPersonnelList] = useState<PersonnelUserOption[]>(DEFAULT_PERSONNEL_USERS);
  const [selectedPersonnel, setSelectedPersonnel] = useState<PersonnelUserOption>(DEFAULT_PERSONNEL_USERS[0]);
  const [showPin, setShowPin] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [adminHasCustomPin, setAdminHasCustomPin] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchLiveData = async () => {
      try {
        const [supRes, persRes, userRes] = await Promise.all([
          fetch('/api/supervisors'),
          fetch('/api/personnel'),
          fetch('/api/auth/users')
        ]);
        
        const sups = supRes.ok ? await supRes.json() : [];
        const pers = persRes.ok ? await persRes.json() : [];
        const users = userRes.ok ? await userRes.json() : [];

        if (Array.isArray(users)) {
          const adminCustom = users.includes('admin');
          setAdminHasCustomPin(adminCustom);
          if (selectedRole === 'admin') setPin(adminCustom ? '' : '1234');
        }

        if (Array.isArray(sups) && sups.length > 0 && isMounted) {
          const mappedSups: SupervisorUserOption[] = sups.map(sup => {
            const username = sup.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            const defaultPin = `${username}123`;
            return {
              supervisorId: sup.id,
              username,
              name: sup.name,
              defaultPin,
              jobsitesText: sup.department || 'Satınalma',
              avatar: sup.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
              hasCustomPin: Array.isArray(users) && users.includes(sup.id)
            };
          });
          setSupervisorList(mappedSups);
          setSelectedSupervisor(mappedSups[0]);
          if (selectedRole === 'supervisor') {
            setPin(mappedSups[0].hasCustomPin ? '' : mappedSups[0].defaultPin);
          }
        }

        if (Array.isArray(pers) && pers.length > 0 && isMounted) {
          const mappedPers: PersonnelUserOption[] = pers.filter(p => p.active !== false).map(p => {
            const username = p.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            return {
              personnelId: p.id,
              supervisorId: p.supervisorId,
              username,
              name: p.name,
              title: p.title || 'Satınalma Personeli',
              defaultPin: `${username}123`,
              supervisorName: p.supervisorName || 'Bağlı Şef',
              avatar: p.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
              hasCustomPin: Array.isArray(users) && users.includes(p.id)
            };
          });
          if (mappedPers.length > 0) {
            setPersonnelList(mappedPers);
            setSelectedPersonnel(mappedPers[0]);
            if (selectedRole === 'personnel') {
              setPin(mappedPers[0].hasCustomPin ? '' : mappedPers[0].defaultPin);
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch live users list for login modal, using default.', err);
      }
    };
    fetchLiveData();
    return () => { isMounted = false; };
  }, []);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setErrorMessage('Lütfen güvenlik PIN kodunuzu giriniz.');
      return;
    }
    setIsLoading(true);
    setErrorMessage('');

    const res = await login(
      pin.trim(),
      selectedRole,
      selectedRole === 'supervisor' ? selectedSupervisor.supervisorId : (selectedRole === 'personnel' ? selectedPersonnel.supervisorId : undefined),
      selectedRole === 'supervisor' ? selectedSupervisor.username : (selectedRole === 'personnel' ? selectedPersonnel.username : 'admin'),
      selectedRole === 'personnel' ? selectedPersonnel.personnelId : undefined
    );

    if (!res.success) {
      setErrorMessage(res.message || 'Giriş başarısız!');
    }
    setIsLoading(false);
  };

  const selectSupervisor = (sup: SupervisorUserOption) => {
    setSelectedSupervisor(sup);
    setSelectedRole('supervisor');
    setPin(sup.hasCustomPin ? '' : sup.defaultPin);
    setErrorMessage('');
  };

  const selectPersonnel = (p: PersonnelUserOption) => {
    setSelectedPersonnel(p);
    setSelectedRole('personnel');
    setPin(p.hasCustomPin ? '' : p.defaultPin);
    setErrorMessage('');
  };

  const selectAdmin = () => {
    setSelectedRole('admin');
    setPin(adminHasCustomPin ? '' : '1234');
    setErrorMessage('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl p-6 sm:p-8 text-white relative overflow-hidden my-auto">
        {/* Decorative background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header & Logo */}
        <div className="text-center space-y-2 mb-5">
          <div className="inline-flex bg-white px-4 py-2 rounded-2xl shadow-lg border border-slate-200">
            <GesLogo size="md" showTagline={true} variant="blue" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-100 flex items-center justify-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
              <span>Güvenli Kullanıcı Girişi</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Satınalma Şefleri, Personeller ve Yönetici Paneli Giriş Portalı
            </p>
          </div>
        </div>

        {/* Role Type Tabs */}
        <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 mb-4 gap-1">
          <button
            type="button"
            onClick={() => { setSelectedRole('supervisor'); setPin(selectedSupervisor.hasCustomPin ? '' : selectedSupervisor.defaultPin); }}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              selectedRole === 'supervisor'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Şefler</span>
          </button>

          <button
            type="button"
            onClick={() => { setSelectedRole('personnel'); setPin(selectedPersonnel.hasCustomPin ? '' : selectedPersonnel.defaultPin); }}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              selectedRole === 'personnel'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Personel</span>
          </button>

          <button
            type="button"
            onClick={selectAdmin}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
              selectedRole === 'admin'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Yönetici</span>
          </button>
        </div>

        {/* Supervisor Selector List (if supervisor role active) */}
        {selectedRole === 'supervisor' && (
          <div className="space-y-2 mb-5">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Giriş Yapacak Satınalma Şefini Seçiniz:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
              {supervisorList.map((sup) => {
                const isSelected = selectedSupervisor.supervisorId === sup.supervisorId;
                return (
                  <button
                    key={sup.supervisorId}
                    type="button"
                    onClick={() => selectSupervisor(sup)}
                    className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex items-start space-x-2.5 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500/80 ring-2 ring-indigo-500/30'
                        : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    <img
                      src={sup.avatar || undefined}
                      alt={sup.name}
                      className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-700 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-extrabold truncate ${isSelected ? 'text-indigo-200' : 'text-slate-200'}`}>
                          {sup.name}
                        </span>
                        {isSelected && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
                      </div>
                      <div className="flex items-center text-[10px] text-amber-400/90 font-medium mt-0.5 truncate">
                        <Building2 className="w-3 h-3 mr-1 shrink-0 text-amber-400/70" />
                        <span className="truncate">{sup.jobsitesText}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Personnel Selector List (if personnel role active) */}
        {selectedRole === 'personnel' && (
          <div className="space-y-2 mb-5">
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Giriş Yapacak Satınalma Personelini Seçiniz:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
              {personnelList.map((p) => {
                const isSelected = selectedPersonnel.personnelId === p.personnelId;
                return (
                  <button
                    key={p.personnelId}
                    type="button"
                    onClick={() => selectPersonnel(p)}
                    className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex items-start space-x-2.5 ${
                      isSelected
                        ? 'bg-emerald-950/60 border-emerald-500/80 ring-2 ring-emerald-500/30'
                        : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    <img
                      src={p.avatar || undefined}
                      alt={p.name}
                      className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-700 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-extrabold truncate ${isSelected ? 'text-emerald-200' : 'text-slate-200'}`}>
                          {p.name}
                        </span>
                        {isSelected && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                      </div>
                      <div className="flex items-center text-[10px] text-slate-400 font-medium mt-0.5 truncate">
                        <UserCheck className="w-3 h-3 mr-1 shrink-0 text-emerald-400/80" />
                        <span className="truncate">Şef: {p.supervisorName}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected User Indicator */}
        <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800 mb-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
              selectedRole === 'admin'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : selectedRole === 'personnel'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
            }`}>
              {selectedRole === 'admin' ? <ShieldCheck className="w-5 h-5" /> : selectedRole === 'personnel' ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-100">
                {selectedRole === 'admin' ? 'Sistem Yöneticisi (Admin)' : selectedRole === 'personnel' ? selectedPersonnel.name : selectedSupervisor.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {selectedRole === 'admin' ? 'Tüm yetkilere sahip kullanıcı' : selectedRole === 'personnel' ? `${selectedPersonnel.title} (Şef: ${selectedPersonnel.supervisorName})` : `Sorumlu Olduğu Şantiyeler: ${selectedSupervisor.jobsitesText}`}
              </p>
            </div>
          </div>
        </div>

        {/* PIN Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                Giriş Şifresi / PIN Kodu
              </label>
              <span className="text-[10px] text-slate-500 font-mono">
                {selectedRole === 'admin' 
                  ? (adminHasCustomPin ? 'Özel Şifre Belirlendi' : 'Varsayılan: 1234')
                  : selectedRole === 'personnel' 
                    ? (selectedPersonnel.hasCustomPin ? 'Özel Şifre Belirlendi' : `Varsayılan: ${selectedPersonnel.defaultPin}`)
                    : (selectedSupervisor.hasCustomPin ? 'Özel Şifre Belirlendi' : `Varsayılan: ${selectedSupervisor.defaultPin}`)}
              </span>
            </div>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Şifrenizi giriniz..."
                className="w-full py-3 pl-10 pr-10 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 font-mono text-sm tracking-widest focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                autoFocus
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/30 rounded-2xl text-rose-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm rounded-2xl shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            <span>{isLoading ? 'Doğrulanıyor...' : `${selectedRole === 'admin' ? 'Yönetici' : selectedRole === 'personnel' ? selectedPersonnel.name : selectedSupervisor.name} Olarak Giriş Yap`}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-[11px] text-slate-500 text-center mt-4">
          Giriş yaptıktan sonra şifrenizi üst menüden dilediğiniz zaman değiştirebilirsiniz.
        </p>
      </div>
    </div>
  );
};

