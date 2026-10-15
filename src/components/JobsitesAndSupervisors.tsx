import { INITIAL_SUPERVISORS, INITIAL_JOBSITES, INITIAL_PERSONNEL } from '../data/initialData';
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Jobsite, PurchasingSupervisor, Personnel } from '../types';
import {
  Building2,
  Users,
  PlusCircle,
  MapPin,
  Mail,
  Phone,
  Briefcase,
  Edit3,
  X,
  Save,
  Trash2,
  KeyRound,
  AlertTriangle,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  XCircle,
  Filter,
  Search
} from 'lucide-react';
import { formatRuble } from '../utils/format';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  personnel?: Personnel[];
  onAddJobsite: (jobsite: Omit<Jobsite, 'id'>) => void;
  onAddSupervisor: (supervisor: Omit<PurchasingSupervisor, 'id'> & { username?: string; pin?: string }) => void;
  onAddPersonnel?: (personnel: Omit<Personnel, 'id' | 'created_at'> & { username?: string; pin?: string }) => void;
  onUpdateJobsite?: (id: string, jobsite: Partial<Jobsite>) => void;
  onUpdateSupervisor?: (id: string, supervisor: Partial<PurchasingSupervisor> & { pin?: string }) => void;
  onUpdatePersonnel?: (id: string, personnel: Partial<Personnel> & { pin?: string }) => void;
  onDeleteJobsite?: (id: string) => void;
  onDeleteSupervisor?: (id: string) => void;
  onDeletePersonnel?: (id: string) => void;
  onOpenBackupCenter?: () => void;
}

export const JobsitesAndSupervisors: React.FC<Props> = ({
  jobsites,
  supervisors,
  personnel,
  onAddJobsite,
  onAddSupervisor,
  onAddPersonnel,
  onUpdateJobsite,
  onUpdateSupervisor,
  onUpdatePersonnel,
  onDeleteJobsite,
  onDeleteSupervisor,
  onDeletePersonnel,
  onOpenBackupCenter
}) => {
  const { user } = useAuth();
  
  const canEditJobsite = user?.role === 'admin';
  const canEditSupervisor = (_supId: string) => user?.role === 'admin';
  const canEditPersonnel = (_persId: string, _persSupId: string) => user?.role === 'admin';

  const canAddJobsite = user?.role === 'admin';
  const canAddSupervisor = user?.role === 'admin';
  const canAddPersonnel = user?.role === 'admin';

  const activeSupervisors = (supervisors && supervisors.length > 0) ? supervisors : INITIAL_SUPERVISORS;
  const activeJobsites = (jobsites && jobsites.length > 0) ? jobsites : INITIAL_JOBSITES;
  const activePersonnel = (personnel && personnel.length > 0) ? personnel : INITIAL_PERSONNEL;

  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<'jobsites' | 'supervisors' | 'personnel'>('jobsites');

  // Add Modals state
  const [showJobsiteModal, setShowJobsiteModal] = useState(false);
  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  const [showPersonnelModal, setShowPersonnelModal] = useState(false);

  // Edit Modals state
  const [editingJobsite, setEditingJobsite] = useState<Jobsite | null>(null);
  const [editingSupervisor, setEditingSupervisor] = useState<(PurchasingSupervisor & { pin?: string }) | null>(null);
  const [editingPersonnel, setEditingPersonnel] = useState<(Personnel & { pin?: string }) | null>(null);

  // Delete Confirmation state
  const [deletingJobsite, setDeletingJobsite] = useState<Jobsite | null>(null);
  const [deletingSupervisor, setDeletingSupervisor] = useState<PurchasingSupervisor | null>(null);
  const [deletingPersonnel, setDeletingPersonnel] = useState<Personnel | null>(null);

  // Personnel filter state
  const [personnelSupervisorFilter, setPersonnelSupervisorFilter] = useState<string>('ALL');
  const [personnelStatusFilter, setPersonnelStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [personnelSearch, setPersonnelSearch] = useState('');

  // New Jobsite Form
  const [newJobName, setNewJobName] = useState('');
  const [newJobLocation, setNewJobLocation] = useState('');
  const [newJobManager, setNewJobManager] = useState('');
  const [newJobBudget, setNewJobBudget] = useState('250000000');

  // New Supervisor Form
  const [newSupName, setNewSupName] = useState('');
  const [newSupTitle, setNewSupTitle] = useState('');
  const [newSupDept, setNewSupDept] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupEmail, setNewSupEmail] = useState('');
  const [newSupUsername, setNewSupUsername] = useState('');
  const [newSupPin, setNewSupPin] = useState('');

  // New Personnel Form
  const [newPersName, setNewPersName] = useState('');
  const [newPersTitle, setNewPersTitle] = useState('Satınalma Personeli');
  const [newPersSupId, setNewPersSupId] = useState(activeSupervisors[0]?.id || 'sup_1');
  const [newPersEmail, setNewPersEmail] = useState('');
  const [newPersPhone, setNewPersPhone] = useState('');
  const [newPersAvatar, setNewPersAvatar] = useState('https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80');
  const [newPersUsername, setNewPersUsername] = useState('');
  const [newPersPin, setNewPersPin] = useState('');

  const handleCreateJobsite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobName.trim()) return;

    onAddJobsite({
      name: newJobName.trim(),
      code: `PRJ-${Math.floor(100 + Math.random() * 900)}`,
      location: newJobLocation.trim(),
      projectManager: newJobManager.trim() || 'Proje Müdürü',
      status: 'Aktif',
      budget: Number(newJobBudget) || 100000000
    });

    setNewJobName('');
    setNewJobLocation('');
    setNewJobManager('');
    setShowJobsiteModal(false);
  };

  const handleCreateSupervisor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupName.trim() || !newSupTitle.trim()) return;

    onAddSupervisor({
      name: newSupName.trim(),
      title: newSupTitle.trim() || 'Satınalma Şefi',
      department: newSupDept.trim() || 'Satınalma',
      email: newSupEmail.trim() || `${newSupName.toLowerCase().replace(/\s+/g, '.')}@insaat.com`,
      phone: newSupPhone.trim() || '+7 900 000 00 00',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      username: newSupUsername.trim() || undefined,
      pin: newSupPin.trim() || undefined
    });

    setNewSupName('');
    setNewSupTitle('');
    setNewSupDept('');
    setNewSupPhone('');
    setNewSupEmail('');
    setNewSupUsername('');
    setNewSupPin('');
    setShowSupervisorModal(false);
  };

  const handleCreatePersonnel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPersName.trim() || !onAddPersonnel) return;

    const matchedSup = activeSupervisors.find(s => s.id === newPersSupId);
    onAddPersonnel({
      name: newPersName.trim(),
      title: newPersTitle.trim() || 'Satınalma Personeli',
      supervisorId: newPersSupId,
      supervisorName: matchedSup?.name || 'Şef',
      email: newPersEmail.trim() || `${newPersName.toLowerCase().replace(/\s+/g, '.')}@insaat.com`,
      phone: newPersPhone.trim() || '+7 900 000 00 00',
      avatar: newPersAvatar,
      active: true,
      username: newPersUsername.trim() || undefined,
      pin: newPersPin.trim() || undefined
    });

    setNewPersName('');
    setNewPersTitle('Satınalma Personeli');
    setNewPersEmail('');
    setNewPersPhone('');
    setNewPersAvatar('https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80');
    setNewPersUsername('');
    setNewPersPin('');
    setShowPersonnelModal(false);
  };

  const handleSaveEditSupervisor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupervisor || !onUpdateSupervisor) return;

    onUpdateSupervisor(editingSupervisor.id, {
      name: editingSupervisor.name,
      title: editingSupervisor.title,
      department: editingSupervisor.department,
      phone: editingSupervisor.phone,
      email: editingSupervisor.email,
      avatar: editingSupervisor.avatar,
      pin: editingSupervisor.pin ? editingSupervisor.pin.trim() : undefined
    });

    setEditingSupervisor(null);
  };

  const handleSaveEditPersonnel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPersonnel || !onUpdatePersonnel) return;

    const matchedSup = activeSupervisors.find(s => s.id === editingPersonnel.supervisorId);
    onUpdatePersonnel(editingPersonnel.id, {
      name: editingPersonnel.name,
      title: editingPersonnel.title,
      supervisorId: editingPersonnel.supervisorId,
      supervisorName: matchedSup?.name || editingPersonnel.supervisorName,
      email: editingPersonnel.email,
      phone: editingPersonnel.phone,
      active: editingPersonnel.active,
      pin: editingPersonnel.pin ? editingPersonnel.pin.trim() : undefined
    });

    setEditingPersonnel(null);
  };

  const handleSaveEditJobsite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJobsite || !onUpdateJobsite) return;

    onUpdateJobsite(editingJobsite.id, {
      name: editingJobsite.name,
      code: editingJobsite.code,
      location: editingJobsite.location,
      projectManager: editingJobsite.projectManager,
      budget: Number(editingJobsite.budget) || 0,
      status: editingJobsite.status
    });

    setEditingJobsite(null);
  };

  // Filtered personnel list
  const filteredPersonnel = activePersonnel.filter(p => {
    if (personnelSupervisorFilter !== 'ALL' && p.supervisorId !== personnelSupervisorFilter) {
      return false;
    }
    if (personnelStatusFilter === 'ACTIVE' && p.active === false) return false;
    if (personnelStatusFilter === 'INACTIVE' && p.active !== false) return false;
    if (personnelSearch.trim()) {
      const q = personnelSearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.supervisorName && p.supervisorName.toLowerCase().includes(q)) ||
        (p.email && p.email.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
            <Building2 className="w-4 h-4" />
            <span>Satınalma Organizasyonu & Tanımlar</span>
          </div>
          <h1 className="text-2xl font-black text-slate-100">Şantiyeler, Şefler ve Personeller</h1>
          <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl">
            Aktif şantiyeleri, satınalma şeflerini ve şeflere bağlı satınalma personellerini yönetin; yetki sınırları ve GOL/ASİST organizasyonunu yapılandırın.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {onOpenBackupCenter && user?.role === 'admin' && (
            <button
              onClick={onOpenBackupCenter}
              className="bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 font-bold px-3.5 py-2 rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
              title="Yedekleme ve Güvenlik Merkezi (Yalnızca Yönetici)"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>Yedekleme & Güvenlik</span>
            </button>
          )}

          {canAddJobsite && (
          <button
            onClick={() => setShowJobsiteModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{t('addJobsiteBtn')}</span>
          </button>
          )}

          {canAddSupervisor && (
          <button
            onClick={() => setShowSupervisorModal(true)}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3.5 py-2 rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{t('addSupBtn')}</span>
          </button>
          )}

          {onAddPersonnel && canAddPersonnel && (
            <button
              onClick={() => setShowPersonnelModal(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2 rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Yeni Personel Ekle</span>
            </button>
          )}
        </div>
      </div>

      {/* Toggle View Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('jobsites')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeTab === 'jobsites'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>{t('jobsitesTab')} ({activeJobsites.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('supervisors')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeTab === 'supervisors'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>{t('supervisorsTab')} ({activeSupervisors.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('personnel')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeTab === 'personnel'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Satınalma Personeli ({activePersonnel.length})</span>
        </button>
      </div>

      {/* Jobsites Grid */}
      {activeTab === 'jobsites' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {activeJobsites.map((job) => (
            <div key={job.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {job.code}
                  </span>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    {job.status === 'Aktif' && language === 'RU' ? 'Активный' : job.status}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-base">{job.name}</h3>
                  <p className="text-xs text-slate-500 flex items-center space-x-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{job.location || t('locationNotSpecified')}</span>
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>{t('projectManager')}:</span>
                    <strong className="text-slate-900">{job.projectManager}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('totalBudget')}:</span>
                    <strong className="text-emerald-700 font-mono">{formatRuble(job.budget)}</strong>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center space-x-2">
                {canEditJobsite && (
                <button
                  onClick={() => setEditingJobsite({ ...job })}
                  className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-indigo-50 text-indigo-700 font-bold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{t('editJobsite')}</span>
                </button>
                )}
                {onDeleteJobsite && canEditJobsite && (
                  <button
                    onClick={() => setDeletingJobsite(job)}
                    title="Şantiyeyi Sil"
                    className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Supervisors Grid */}
      {activeTab === 'supervisors' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeSupervisors.map((sup) => {
            const attachedPersonnel = activePersonnel.filter(p => p.supervisorId === sup.id);
            return (
              <div key={sup.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <img
                      src={sup.avatar || undefined}
                      alt={sup.name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-indigo-200 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-900 text-sm truncate">{sup.name}</h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                          {attachedPersonnel.length} Personel
                        </span>
                      </div>
                      <p className="text-xs text-indigo-600 font-semibold truncate">
                        {language === 'RU' && sup.title.includes('Satınalma Şefi') ? sup.title.replace('Satınalma Şefi', 'Шеф по закупкам') : sup.title}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    <p className="flex items-center space-x-1">
                      <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{language === 'RU' && sup.department === 'Satınalma' ? 'Закупки' : sup.department}</span>
                    </p>
                    <p className="flex items-center space-x-1">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{sup.phone}</span>
                    </p>
                    <p className="flex items-center space-x-1 text-slate-500 truncate">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{sup.email}</span>
                    </p>
                  </div>

                  {/* Attached Personnel Tags */}
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center space-x-1">
                      <Users className="w-3 h-3 text-emerald-600" />
                      <span>Bağlı Yardımcı Ekip:</span>
                    </p>
                    {attachedPersonnel.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {attachedPersonnel.map(p => (
                          <span
                            key={p.id}
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-md border flex items-center space-x-1 ${
                              p.active !== false
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200 line-through'
                            }`}
                          >
                            <span>{p.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">Henüz atanmış personel yok</p>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center space-x-2">
                  {canEditSupervisor(sup.id) && (
                  <button
                    onClick={() => setEditingSupervisor({ ...sup })}
                    className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-amber-50 text-amber-800 font-bold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{t('editSupCard')}</span>
                  </button>
                  )}
                  {onDeleteSupervisor && canEditSupervisor(sup.id) && (
                    <button
                      onClick={() => setDeletingSupervisor(sup)}
                      title="Şefi Sil"
                      className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Personnel Grid & Management */}
      {activeTab === 'personnel' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center flex-wrap gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Personel ara..."
                  value={personnelSearch}
                  onChange={(e) => setPersonnelSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48 sm:w-60 font-medium"
                />
              </div>

              {/* Supervisor Filter Dropdown */}
              <div className="flex items-center space-x-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={personnelSupervisorFilter}
                  onChange={(e) => setPersonnelSupervisorFilter(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-300 rounded-xl py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold text-slate-700"
                >
                  <option value="ALL">Tüm Şefler</option>
                  {activeSupervisors.map(s => (
                    <option key={s.id} value={s.id}>Şef: {s.name}</option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setPersonnelStatusFilter('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    personnelStatusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Tümü
                </button>
                <button
                  type="button"
                  onClick={() => setPersonnelStatusFilter('ACTIVE')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    personnelStatusFilter === 'ACTIVE' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Aktif
                </button>
                <button
                  type="button"
                  onClick={() => setPersonnelStatusFilter('INACTIVE')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    personnelStatusFilter === 'INACTIVE' ? 'bg-slate-700 text-white shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Pasif
                </button>
              </div>
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Toplam <strong className="text-slate-900 font-bold">{filteredPersonnel.length}</strong> personel gösteriliyor
            </div>
          </div>

          {/* Personnel Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPersonnel.map((p) => {
              const sup = activeSupervisors.find(s => s.id === p.supervisorId);
              return (
                <div
                  key={p.id}
                  className={`bg-white rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between ${
                    p.active !== false ? 'border-slate-200' : 'border-slate-200 opacity-60 bg-slate-50/50'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        {p.avatar ? (
                          <img src={p.avatar || undefined} alt={p.name || 'Personel'} className="w-11 h-11 rounded-full object-cover border-2 border-emerald-300 shrink-0" />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-sm border-2 border-emerald-300 shrink-0">
                            {(p.name || 'P').split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm truncate">{p.name}</h3>
                          <p className="text-xs text-emerald-700 font-semibold truncate">{p.title || 'Satınalma Personeli'}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={user?.role === 'personnel'}
                        onClick={() => {
                          if (onUpdatePersonnel) {
                            onUpdatePersonnel(p.id, { active: !p.active });
                          }
                        }}
                        title={p.active !== false ? 'Pasife Al' : 'Aktif Et'}
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center space-x-1 transition-all ${user?.role === 'personnel' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${
                          p.active !== false
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                      >
                        {p.active !== false ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Aktif</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-slate-500" />
                            <span>Pasif</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                      <div className="p-2 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between">
                        <span className="text-[11px] font-bold text-indigo-900 flex items-center space-x-1">
                          <UserCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span>Bağlı Olduğu Şef:</span>
                        </span>
                        <strong className="text-indigo-950 font-bold truncate max-w-[140px]">
                          {sup ? sup.name : p.supervisorName || 'Atanmamış'}
                        </strong>
                      </div>

                      {p.phone && (
                        <p className="flex items-center space-x-1">
                          <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{p.phone}</span>
                        </p>
                      )}
                      {p.email && (
                        <p className="flex items-center space-x-1 text-slate-500 truncate">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{p.email}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center space-x-2">
                    {canEditPersonnel(p.id, p.supervisorId) && (
                    <button
                      onClick={() => setEditingPersonnel({ ...p })}
                      className="flex-1 py-1.5 px-3 bg-slate-100 hover:bg-emerald-50 text-emerald-800 font-bold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Düzenle</span>
                    </button>
                    )}
                    {onDeletePersonnel && (
                      <button
                        onClick={() => setDeletingPersonnel(p)}
                        title="Personeli Sil"
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Supervisor Modal */}
      {editingSupervisor && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-amber-600" />
                <span>Satınalma Şefi Kartını Güncelle</span>
              </h2>
              <button
                onClick={() => setEditingSupervisor(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditSupervisor} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  value={editingSupervisor.name}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Unvan / Görev *</label>
                <input
                  type="text"
                  required
                  value={editingSupervisor.title}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, title: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Sorumluluk Alanı / Departman</label>
                <input
                  type="text"
                  value={editingSupervisor.department}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, department: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Telefon</label>
                <input
                  type="text"
                  value={editingSupervisor.phone}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, phone: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">E-Posta</label>
                <input
                  type="email"
                  value={editingSupervisor.email}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, email: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Profil Fotoğraf URL</label>
                <input
                  type="text"
                  value={editingSupervisor.avatar}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, avatar: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-600"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                <label className="block text-xs font-bold text-amber-900 flex items-center space-x-1">
                  <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                  <span>Giriş Şifresini / PIN Kodu Yenile (Opsiyonel)</span>
                </label>
                <input
                  type="text"
                  placeholder="Yeni PIN giriniz (örn: serkan123)..."
                  value={editingSupervisor.pin || ''}
                  onChange={(e) => setEditingSupervisor({ ...editingSupervisor, pin: e.target.value })}
                  className="w-full text-xs p-2 bg-white border border-amber-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingSupervisor(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md flex items-center space-x-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Değişiklikleri Kaydet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Personnel Modal */}
      {editingPersonnel && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-emerald-600" />
                <span>Satınalma Personeli Güncelle</span>
              </h2>
              <button
                onClick={() => setEditingPersonnel(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditPersonnel} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  value={editingPersonnel.name}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Bağlı Olduğu Şef *</label>
                <select
                  value={editingPersonnel.supervisorId}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, supervisorId: e.target.value })}
                  disabled={user?.role === 'personnel'}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold disabled:opacity-60"
                >
                  {activeSupervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.department})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Unvan *</label>
                <input
                  type="text"
                  required
                  value={editingPersonnel.title}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, title: e.target.value })}
                  disabled={user?.role === 'personnel'}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Telefon</label>
                <input
                  type="text"
                  value={editingPersonnel.phone || ''}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, phone: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">E-Posta</label>
                <input
                  type="email"
                  value={editingPersonnel.email || ''}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, email: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Profil Fotoğraf URL</label>
                <input
                  type="text"
                  value={editingPersonnel.avatar || ''}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, avatar: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-600"
                />
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="edit_pers_active"
                  checked={editingPersonnel.active !== false}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, active: e.target.checked })}
                  disabled={user?.role === 'personnel'}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 disabled:opacity-60"
                />
                <label htmlFor="edit_pers_active" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Personel Aktif (İşlem yapabilir)
                </label>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                <label className="block text-xs font-bold text-emerald-900 flex items-center space-x-1">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Giriş Şifresini / PIN Kodu Yenile (Opsiyonel)</span>
                </label>
                <input
                  type="text"
                  placeholder="Yeni PIN giriniz (örn: mehmet123)..."
                  value={editingPersonnel.pin || ''}
                  onChange={(e) => setEditingPersonnel({ ...editingPersonnel, pin: e.target.value })}
                  className="w-full text-xs p-2 bg-white border border-emerald-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingPersonnel(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md flex items-center space-x-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Değişiklikleri Kaydet</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Jobsite Modal */}
      {editingJobsite && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Edit3 className="w-4 h-4 text-indigo-600" />
                <span>Şantiye Bilgilerini Güncelle</span>
              </h2>
              <button
                onClick={() => setEditingJobsite(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditJobsite} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Şantiye Adı *</label>
                <input
                  type="text"
                  required
                  value={editingJobsite.name}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proje Kodu</label>
                <input
                  type="text"
                  value={editingJobsite.code}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, code: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Lokasyon / Şehir</label>
                <input
                  type="text"
                  value={editingJobsite.location}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, location: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proje Müdürü</label>
                <input
                  type="text"
                  value={editingJobsite.projectManager}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, projectManager: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Bütçe (₽ Ruble)</label>
                <input
                  type="number"
                  value={editingJobsite.budget}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, budget: Number(e.target.value) })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Durum</label>
                <select
                  value={editingJobsite.status}
                  onChange={(e) => setEditingJobsite({ ...editingJobsite, status: e.target.value as any })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none"
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Tamamlandı">Tamamlandı</option>
                  <option value="Planlamada">Planlamada</option>
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingJobsite(null)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md flex items-center space-x-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Şantiyeyi Güncelle</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Jobsite Modal */}
      {showJobsiteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Yeni Şantiye Ekle</h2>
            <form onSubmit={handleCreateJobsite} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Şantiye / Proje Adı *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Blok C Projesi"
                  value={newJobName}
                  onChange={(e) => setNewJobName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Lokasyon / Adres</label>
                <input
                  type="text"
                  placeholder="Adres / Konum (Opsiyonel)"
                  value={newJobLocation}
                  onChange={(e) => setNewJobLocation(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Proje Müdürü</label>
                <input
                  type="text"
                  placeholder="Örn: Serkan Akman"
                  value={newJobManager}
                  onChange={(e) => setNewJobManager(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tahmini Bütçe (₽ Ruble)</label>
                <input
                  type="number"
                  value={newJobBudget}
                  onChange={(e) => setNewJobBudget(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowJobsiteModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md cursor-pointer"
                >
                  Şantiyeyi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Supervisor Modal */}
      {showSupervisorModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Yeni Satınalma Şefi Ekle</h2>
            <form onSubmit={handleCreateSupervisor} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Igor Smirnov"
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Unvan *</label>
                <input
                  type="text"
                  required
                  placeholder="Satınalma Şefi"
                  value={newSupTitle}
                  onChange={(e) => setNewSupTitle(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Sorumluluk Alanı / Departman</label>
                <input
                  type="text"
                  placeholder="Satınalma"
                  value={newSupDept}
                  onChange={(e) => setNewSupDept(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Telefon</label>
                <input
                  type="text"
                  placeholder="+7 900 000 00 00"
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <p className="text-[11px] font-bold text-amber-900 uppercase tracking-wider flex items-center space-x-1">
                  <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                  <span>Sistem Giriş Bilgileri</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Kullanıcı Adı</label>
                    <input
                      type="text"
                      placeholder="Örn: igor"
                      value={newSupUsername}
                      onChange={(e) => setNewSupUsername(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Giriş PIN Kodu</label>
                    <input
                      type="text"
                      placeholder="Örn: igor123"
                      value={newSupPin}
                      onChange={(e) => setNewSupPin(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSupervisorModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md cursor-pointer"
                >
                  Şefi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Personnel Modal */}
      {showPersonnelModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
              <Users className="w-5 h-5 text-emerald-600" />
              <span>Yeni Satınalma Personeli Ekle</span>
            </h2>
            <form onSubmit={handleCreatePersonnel} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ad Soyad *</label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Mehmet Can"
                  value={newPersName}
                  onChange={(e) => setNewPersName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Bağlı Olduğu Şef *</label>
                <select
                  value={newPersSupId}
                  onChange={(e) => setNewPersSupId(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                >
                  {activeSupervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.department})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Unvan *</label>
                <input
                  type="text"
                  required
                  placeholder="Satınalma Personeli / Uzmanı"
                  value={newPersTitle}
                  onChange={(e) => setNewPersTitle(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Telefon</label>
                <input
                  type="text"
                  placeholder="+7 900 000 00 00"
                  value={newPersPhone}
                  onChange={(e) => setNewPersPhone(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Profil Fotoğraf URL</label>
                <input
                  type="text"
                  value={newPersAvatar}
                  onChange={(e) => setNewPersAvatar(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">E-Posta</label>
                <input
                  type="email"
                  placeholder="mehmet.can@insaat.com"
                  value={newPersEmail}
                  onChange={(e) => setNewPersEmail(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider flex items-center space-x-1">
                  <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Personel Giriş Bilgileri</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Kullanıcı Adı</label>
                    <input
                      type="text"
                      placeholder="Örn: mehmet"
                      value={newPersUsername}
                      onChange={(e) => setNewPersUsername(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Giriş PIN Kodu</label>
                    <input
                      type="text"
                      placeholder="Örn: mehmet123"
                      value={newPersPin}
                      onChange={(e) => setNewPersPin(e.target.value)}
                      className="w-full text-xs p-2 bg-white border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPersonnelModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md cursor-pointer"
                >
                  Personeli Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Supervisor Confirmation Modal */}
      {deletingSupervisor && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Şefi Silmek İstediğinize Emin Misiniz?</h3>
                <p className="text-xs text-slate-500">{deletingSupervisor.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Bu satınalma şefini ve ilişkilendirilmiş kullanıcı giriş hesabını kalıcı olarak sistemden kaldırmak üzeresiniz.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingSupervisor(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteSupervisor && deletingSupervisor) {
                    onDeleteSupervisor(deletingSupervisor.id);
                  }
                  setDeletingSupervisor(null);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kalıcı Olarak Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Personnel Confirmation Modal */}
      {deletingPersonnel && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Personeli Silmek İstediğinize Emin Misiniz?</h3>
                <p className="text-xs text-slate-500">{deletingPersonnel.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Bu personeli sistem kayıtlarından kaldırmak üzeresiniz. Geçmiş pazarlık ve teklif kayıtları korunacaktır.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingPersonnel(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeletePersonnel && deletingPersonnel) {
                    onDeletePersonnel(deletingPersonnel.id);
                  }
                  setDeletingPersonnel(null);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Jobsite Confirmation Modal */}
      {deletingJobsite && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Şantiyeyi Silmek İstediğinize Emin Misiniz?</h3>
                <p className="text-xs text-slate-500">{deletingJobsite.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Bu şantiyeyi sistem kayıtlarından kaldırmak üzeresiniz.
            </p>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingJobsite(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteJobsite && deletingJobsite) {
                    onDeleteJobsite(deletingJobsite.id);
                  }
                  setDeletingJobsite(null);
                }}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md cursor-pointer flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kalıcı Olarak Sil</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
