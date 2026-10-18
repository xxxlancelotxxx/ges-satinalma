import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { GesLogo } from './GesLogo';
import { PasswordChangeModal } from './PasswordChangeModal';
import { AdminPinModal } from './AdminPinModal';
import {
  LayoutDashboard,
  TrendingUp,
  ScanLine,
  BarChart3,
  Building2,
  PlusCircle,
  ShieldAlert,
  Trash2,
  LogOut,
  KeyRound,
  FileText,
  ShieldCheck,
  Boxes,
  FileCheck,
  ChevronDown,
  Lock,
  Receipt,
  Layers,
  Scale
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNewDiscountModal: () => void;
  onOpenTrashModal?: () => void;
  onOpenBackupModal?: () => void;
  trashCount?: number;
}

interface NavSubItem {
  id: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  iconBg: string;
  iconColor: string;
  isPinProtected?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavSubItem[];
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenNewDiscountModal,
  onOpenTrashModal,
  onOpenBackupModal,
  trashCount = 0
}) => {
  const { language, setLanguage, t } = useLanguage();
  const { user, logout } = useAuth();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const navRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = (groupId: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenDropdown(groupId);
  };

  const handleMouseLeave = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setOpenDropdown(null);
    }, 180);
  };

  const toggleDropdown = (groupId: string) => {
    setOpenDropdown(prev => prev === groupId ? null : groupId);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const navGroups: NavGroup[] = [
    {
      id: 'procurement',
      label: t('navGroupProcurement'),
      icon: Receipt,
      items: [
        {
          id: 'discount-entry',
          label: t('navDiscountEntry'),
          desc: t('subDescDiscountEntry'),
          icon: PlusCircle,
          badge: 'İndirim & TDF',
          iconBg: 'bg-amber-500/15 border border-amber-500/30',
          iconColor: 'text-amber-400'
        },
        {
          id: 'pre-approval-audit',
          label: t('navPreApprovalAudit'),
          desc: t('subDescPreAudit'),
          icon: FileCheck,
          badge: t('badgePreAudit'),
          iconBg: 'bg-emerald-500/15 border border-emerald-500/30',
          iconColor: 'text-emerald-400'
        },
        {
          id: 'invoice-ai',
          label: t('navInvoiceAI'),
          desc: t('subDescInvoiceAI'),
          icon: ScanLine,
          badge: t('badgeAutomation'),
          iconBg: 'bg-cyan-500/15 border border-cyan-500/30',
          iconColor: 'text-cyan-400'
        },
        {
          id: 'invoice-drive',
          label: t('navDrive'),
          desc: t('subDescDrive'),
          icon: FileText,
          badge: t('badgeCloud'),
          iconBg: 'bg-blue-500/15 border border-blue-500/30',
          iconColor: 'text-blue-400'
        },
        {
          id: 'prizma-invoices',
          label: 'Prizma Faturaları (Son 3 Ay)',
          desc: 'PM.gescons.ru STF/BTF fatura ve malzeme kalemleri',
          icon: Layers,
          badge: 'ERP 3 Ay',
          iconBg: 'bg-blue-600/20 border border-blue-500/40',
          iconColor: 'text-blue-400'
        }
      ]
    },
    {
      id: 'analytics',
      label: t('navGroupAnalytics'),
      icon: BarChart3,
      items: [
        {
          id: 'material-compare',
          label: t('navMaterialCompare'),
          desc: t('subDescMaterialCompare'),
          icon: BarChart3,
          badge: t('badgeAnalysis'),
          iconBg: 'bg-indigo-500/15 border border-indigo-500/30',
          iconColor: 'text-indigo-400'
        },
        {
          id: 'special-materials',
          label: t('navSpecialMaterials'),
          desc: t('subDescSpecialMaterials'),
          icon: Boxes,
          badge: t('badgeSpecial'),
          iconBg: 'bg-purple-500/15 border border-purple-500/30',
          iconColor: 'text-purple-400'
        },
        {
          id: 'anomalies',
          label: t('navAnomalies'),
          desc: t('subDescAnomalies'),
          icon: ShieldAlert,
          badge: t('badgeWarning'),
          iconBg: 'bg-rose-500/15 border border-rose-500/30',
          iconColor: 'text-rose-400'
        }
      ]
    },
    {
      id: 'management',
      label: t('navGroupManagement'),
      icon: Building2,
      items: [
        {
          id: 'jobsites-supervisors',
          label: t('navJobsites'),
          desc: t('subDescJobsites'),
          icon: Building2,
          badge: t('badgeManagement'),
          iconBg: 'bg-teal-500/15 border border-teal-500/30',
          iconColor: 'text-teal-400'
        },
        {
          id: 'performance',
          label: t('navPerformance'),
          desc: t('subDescPerformance'),
          icon: TrendingUp,
          badge: t('badgeAdmin'),
          iconBg: 'bg-amber-500/15 border border-amber-500/30',
          iconColor: 'text-amber-400',
          isPinProtected: true
        }
      ]
    }
  ];

  const handleTabClick = (tabId: string) => {
    setOpenDropdown(null);
    if (tabId === 'performance') {
      // If user is admin, allow immediate direct access
      if (user?.role === 'admin') {
        setActiveTab(tabId);
        return;
      }
      // Check if already unlocked in this session
      try {
        if (sessionStorage.getItem('report_pin_unlocked_3255') === 'true') {
          setActiveTab(tabId);
          return;
        }
      } catch (_) {}

      // Open in-app PIN modal for supervisors, personnel, etc.
      setShowAdminPinModal(true);
      return;
    }
    setActiveTab(tabId);
  };

  // Find active child in a group if any
  const getActiveChildInGroup = (group: NavGroup) => {
    return group.items.find(item => item.id === activeTab);
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-lg">
      <div className="max-w-[1700px] w-full mx-auto px-2 sm:px-4 lg:px-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between py-3 md:h-16 gap-3">
          {/* Logo & System Title with GES CONSTRUCTION */}
          <div className="flex items-center space-x-3.5 cursor-pointer" onClick={() => handleTabClick('dashboard')}>
            <div className="bg-white px-3 py-1.5 rounded-xl shadow-md border border-slate-200 flex items-center justify-center hover:scale-[1.02] transition-transform">
              <GesLogo size="sm" showTagline={true} variant="blue" />
            </div>
            <div className="h-9 w-px bg-slate-800 hidden sm:block" />
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-base sm:text-lg tracking-tight text-slate-100">{t('appTitle')}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30 hidden md:inline-block">
                  GES CONSTRUCTION
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono hidden sm:block">{t('appDesc')}</p>
            </div>
          </div>

          {/* Action Buttons & Language Switcher */}
          <div className="flex items-center flex-wrap gap-2 md:space-x-3 justify-end">
            {/* User Profile Badge & Logout */}
            {user && (
              <div className="flex items-center space-x-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center space-x-1.5">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${
                    user.role === 'admin' ? 'bg-amber-400' : user.role === 'supervisor' ? 'bg-indigo-400' : 'bg-slate-400'
                  }`} />
                  <span className="font-bold text-slate-200 hidden lg:inline">{user.displayName}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                    user.role === 'admin'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : user.role === 'supervisor'
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-slate-800 text-slate-300'
                  }`}>
                    {user.role}
                  </span>
                </div>
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="p-1 hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 rounded-lg transition-colors cursor-pointer"
                  title="Şifre Değiştir"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={logout}
                  className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                  title="Güvenli Çıkış Yap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Data Backup & Security Center - Strictly Admin Only */}
            {onOpenBackupModal && user?.role === 'admin' && (
              <button
                onClick={onOpenBackupModal}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-indigo-200 border border-indigo-800/80 text-xs font-bold transition-all cursor-pointer shadow-sm"
                title="Veri Güvenliği ve Otomatik Yedekleme Merkezi (Yalnızca Yönetici)"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden lg:inline">Yedekleme & Güvenlik</span>
              </button>
            )}

            {/* Trash Can Quick Access */}
            {onOpenTrashModal && (
              <button
                onClick={onOpenTrashModal}
                className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-rose-400 hover:text-rose-300 border border-slate-800 text-xs font-bold transition-all cursor-pointer relative"
                title="Silinen Faturalar & Çöp Kutusu"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span className="hidden md:inline">Çöp Kutusu</span>
                {trashCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-rose-600 text-white rounded-full text-[10px] font-mono">
                    {trashCount}
                  </span>
                )}
              </button>
            )}

            {/* Prizma PM Live Status & Navigation */}
            <button
              onClick={() => handleTabClick('prizma-invoices')}
              className={`hidden md:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all shadow-2xs cursor-pointer ${
                activeTab === 'prizma-invoices'
                  ? 'bg-blue-600 text-white border-blue-400 ring-1 ring-blue-300'
                  : 'bg-slate-950 text-blue-300 border-blue-500/30 hover:border-blue-400/60 hover:bg-slate-900'
              }`}
              title="Prizma (Son 3 Ay) Faturaları ve Malzeme Ekranına Git"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="font-black text-white">П</span>
              <span>Prizma (Son 3 Ay)</span>
            </button>

            {/* TR / RU Flag Language Selector */}
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 space-x-1">
              <button
                onClick={() => setLanguage('TR')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  language === 'TR'
                    ? 'bg-red-600 text-white shadow-sm ring-1 ring-red-400'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                title="Türkçe Dil Seçeneği"
              >
                <span className="text-sm">🇹🇷</span>
                <span className="text-[11px]">TR</span>
              </button>
              <button
                onClick={() => setLanguage('RU')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  language === 'RU'
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
                title="Русский Язык (Rusça)"
              >
                <span className="text-sm">🇷🇺</span>
                <span className="text-[11px]">RU</span>
              </button>
            </div>

            <button
              onClick={onOpenNewDiscountModal}
              className="flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 px-3.5 py-2 rounded-lg font-semibold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span className="hidden sm:inline">{t('addDiscountBtn')}</span>
              <span className="sm:hidden">+ İndirim</span>
            </button>
          </div>
        </div>

        {/* Executive Tab Navigation Menu with Clean Dropdowns */}
        <div ref={navRef} className="flex items-center space-x-2 py-2 border-t border-slate-800/80 overflow-visible relative">
          {/* 1. Dashboard (Direct Action Button) */}
          <button
            onClick={() => handleTabClick('dashboard')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40 ring-1 ring-indigo-400/50'
                : 'text-slate-300 hover:bg-slate-800/90 hover:text-white'
            }`}
          >
            <LayoutDashboard className={`w-4 h-4 ${activeTab === 'dashboard' ? 'text-amber-300' : 'text-slate-400'}`} />
            <span>{t('navGroupDashboard')}</span>
            {activeTab === 'dashboard' && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-950/80 text-amber-300 font-mono border border-indigo-400/30">
                {t('badgeOverview')}
              </span>
            )}
          </button>

          {/* 1.5 Malzeme Karşılaştırma (Direct Top-Level Action Button) */}
          <button
            onClick={() => handleTabClick('material-compare')}
            className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'material-compare'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40 ring-1 ring-indigo-400/50'
                : 'text-slate-300 hover:bg-slate-800/90 hover:text-white'
            }`}
          >
            <BarChart3 className={`w-4 h-4 ${activeTab === 'material-compare' ? 'text-amber-300' : 'text-indigo-400'}`} />
            <span>{t('navMaterialCompare')}</span>
            {activeTab === 'material-compare' && (
              <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-950/80 text-amber-300 font-mono border border-indigo-400/30">
                {t('badgeAnalysis')}
              </span>
            )}
          </button>

          {/* 2, 3, 4: Grouped Dropdowns */}
          {navGroups.map((group) => {
            const GroupIcon = group.icon;
            const activeChild = getActiveChildInGroup(group);
            const isGroupActive = !!activeChild;
            const isOpen = openDropdown === group.id;

            return (
              <div
                key={group.id}
                className="relative"
                onMouseEnter={() => handleMouseEnter(group.id)}
                onMouseLeave={handleMouseLeave}
              >
                {/* Dropdown Trigger Button */}
                <button
                  type="button"
                  onClick={() => toggleDropdown(group.id)}
                  aria-expanded={isOpen}
                  className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer select-none ${
                    isGroupActive
                      ? 'bg-slate-800/90 text-white border border-indigo-500/50 shadow-md ring-1 ring-indigo-500/30'
                      : isOpen
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent'
                  }`}
                >
                  <GroupIcon className={`w-4 h-4 ${isGroupActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <span>{group.label}</span>

                  {/* Active Sub-item Indicator */}
                  {activeChild && (
                    <span className="hidden xl:inline-flex items-center space-x-1 ml-1 text-[11px] font-normal px-2 py-0.5 rounded-md bg-indigo-950/70 text-indigo-300 border border-indigo-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="max-w-[130px] truncate">{activeChild.label}</span>
                    </span>
                  )}

                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-white' : ''}`} />
                </button>

                {/* Dropdown Panel Menu */}
                {isOpen && (
                  <div
                    className="absolute top-full left-0 mt-1.5 w-[330px] sm:w-[380px] bg-slate-900/98 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 z-50 p-2 animate-in fade-in-0 zoom-in-95 duration-150"
                  >
                    {/* Category Header Label */}
                    <div className="px-3 py-1.5 border-b border-slate-800/80 mb-1 flex items-center justify-between text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                      <span>{group.label}</span>
                      <span className="text-[10px] text-slate-500 font-normal">{group.items.length} Modül</span>
                    </div>

                    {/* Sub-items List */}
                    <div className="space-y-1">
                      {group.items.map((subItem) => {
                        const SubIcon = subItem.icon;
                        const isSubActive = activeTab === subItem.id;

                        return (
                          <button
                            key={subItem.id}
                            type="button"
                            onClick={() => handleTabClick(subItem.id)}
                            className={`w-full flex items-start space-x-3 p-2.5 rounded-xl transition-all text-left cursor-pointer group ${
                              isSubActive
                                ? 'bg-indigo-950/70 border border-indigo-500/50 shadow-sm'
                                : 'hover:bg-slate-800/90 border border-transparent'
                            }`}
                          >
                            {/* Icon Box */}
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-transform group-hover:scale-105 ${subItem.iconBg}`}>
                              <SubIcon className={`w-4 h-4 ${subItem.iconColor}`} />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className={`text-xs sm:text-sm font-semibold truncate ${
                                  isSubActive ? 'text-white' : 'text-slate-200 group-hover:text-white'
                                }`}>
                                  {subItem.label}
                                </span>

                                {subItem.isPinProtected && (
                                  <span className="shrink-0 flex items-center space-x-1 text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono">
                                    <Lock className="w-2.5 h-2.5" />
                                    <span>PIN</span>
                                  </span>
                                )}

                                {isSubActive && !subItem.isPinProtected && (
                                  <span className="shrink-0 text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                                    {t('activeModuleBadge')}
                                  </span>
                                )}
                              </div>

                              <p className="text-[11px] text-slate-400 group-hover:text-slate-300 line-clamp-1 mt-0.5 font-normal leading-relaxed">
                                {subItem.desc}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Password Change Modal */}
      <PasswordChangeModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />

      {/* Admin Performance Report PIN Modal */}
      <AdminPinModal
        isOpen={showAdminPinModal}
        onClose={() => setShowAdminPinModal(false)}
        onSuccess={() => setActiveTab('performance')}
      />
    </header>
  );
};

