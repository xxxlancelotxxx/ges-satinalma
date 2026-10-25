import React, { useState, useEffect, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { useModalBackHandler } from './hooks/useModalBackHandler';
import { LoginModal } from './components/LoginModal';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';

import { PrizmaInvoicesView } from './components/PrizmaInvoicesView';
import { MaterialPriceComparison } from './components/MaterialPriceComparison';
import { SpecialMaterialAnalytics } from './components/SpecialMaterialAnalytics';
import { PreApprovalAudit } from './components/PreApprovalAudit';
import { SupervisorPerformanceReport } from './components/SupervisorPerformanceReport';
import { DiscountEntryForm } from './components/DiscountEntryForm';
import { JobsitesAndSupervisors } from './components/JobsitesAndSupervisors';
import { ProcurementAnomalyAlerts } from './components/ProcurementAnomalyAlerts';
import { InvoiceScannerAI } from './components/InvoiceScannerAI';
import { InvoiceDriveVault } from './components/InvoiceDriveVault';
import { TrashCanModal } from './components/TrashCanModal';
import { DataBackupCenterModal } from './components/DataBackupCenterModal';
import { ComparativeOffersView } from './components/ComparativeOffersView';
import { TdfView } from './components/TdfView';

import { Coins } from 'lucide-react';
import { evaluateDiscountAudit } from './utils/auditRiskEngine';
import { ensureComparisonGroupIntegrity } from './utils/materialGroupIntegrity';

import {
  PurchasingSupervisor,
  Personnel,
  Jobsite,
  DiscountRecord,
  InvoiceRecord,
  MaterialComparison,
  SupervisorPerformance
} from './types';

type CompareNavRequest = {
  materialName: string;
  materialId: string;
  category: string;
  sourceFilter?: 'all' | 'prizma_only' | 'local_only';
  seq: number;
};

function AppContent() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isRu = language === 'RU';
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Helper for auth headers
  const getAuthHeaders = () => {
    let adminPin = '';
    try {
      if (typeof window !== 'undefined') {
        adminPin = sessionStorage.getItem('admin_pin') || '';
      }
    } catch (_) {}

    return {
      'Content-Type': 'application/json',
      'x-session-token': user?.token || '',
      'x-user-role': encodeURIComponent(user?.role || ''),
      'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
      'x-user-personnel-id': encodeURIComponent(user?.personnelId || ''),
      'x-user-name': encodeURIComponent(user?.displayName || ''),
      'x-user-jobsite-ids': encodeURIComponent(JSON.stringify(user?.jobsiteIds || [])),
      'x-user-default-jobsite-id': encodeURIComponent(user?.defaultJobsiteId || ''),
      ...(adminPin ? { 'x-admin-pin': adminPin } : {})
    };
  };

  // State
  // The API is authoritative. Browser cache and bundled examples must never
  // repopulate records after a user has deleted or restored them.
  const [supervisors, setSupervisors] = useState<PurchasingSupervisor[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [jobsites, setJobsites] = useState<Jobsite[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [prizmaInvoices, setPrizmaInvoices] = useState<InvoiceRecord[]>([]);
  const [trashInvoices, setTrashInvoices] = useState<InvoiceRecord[]>([]);
  const [trashDiscounts, setTrashDiscounts] = useState<DiscountRecord[]>([]);
  const [materialComparisons, setMaterialComparisons] = useState<MaterialComparison[]>([]);
  const [performances, setPerformances] = useState<SupervisorPerformance[]>([]);
  // Malzeme Karşılaştırma'ya başka sekmeden yapılan tek seferlik yönlendirme.
  // Sekmeye menüden girilince temizlenir; böylece eski bir hedef filtre olarak kalmaz.
  const [compareNav, setCompareNav] = useState<CompareNavRequest | null>(null);
  const openMaterialCompare = (nav: Omit<CompareNavRequest, 'seq'>) => {
    setCompareNav({ ...nav, seq: Date.now() });
    setActiveTab('material-compare');
  };
  const openTab = (tabId: string) => {
    if (tabId === 'material-compare') setCompareNav(null);
    setActiveTab(tabId);
  };

  const totalTrashCount = trashInvoices.length + trashDiscounts.length;

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(false);

  // Modals
  const [showQuickDiscountModal, setShowQuickDiscountModal] = useState<boolean>(false);
  const [showTrashModal, setShowTrashModal] = useState<boolean>(false);
  const [showBackupModal, setShowBackupModal] = useState<boolean>(false);

  // Track visited scanning tabs so they remain mounted (preserving scanned OCR state across tab switches)
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({
    'invoice-ai': true,
    'discount-entry': true,
    'pre-approval-audit': false,
    'comparative-offers': false
  });
  useEffect(() => {
    if (activeTab === 'comparative-offers') {
      setActiveTab('discount-entry');
      return;
    }
    setVisitedTabs(prev => (prev[activeTab] ? prev : { ...prev, [activeTab]: true }));
  }, [activeTab]);

  // Pending scanned invoice/discount notification when user switches to other tabs to inspect prices
  const [pendingInvoiceScan, setPendingInvoiceScan] = useState<{
    supplier: string;
    invoiceNumber: string;
    totalAmount: number;
    openModal: () => void;
  } | null>(null);
  const [pendingDiscountScan, setPendingDiscountScan] = useState<{
    supplier: string;
    invoiceNumber: string;
    totalAmount: number;
    openModal: () => void;
  } | null>(null);

  useModalBackHandler(showQuickDiscountModal, () => setShowQuickDiscountModal(false));

  // Auto-recover if browser cached stale chunk hashes from previous deployment
  useEffect(() => {
    const handleChunkError = (e: ErrorEvent) => {
      const msg = e?.message || '';
      if (
        msg.includes('dynamically imported module') ||
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed')
      ) {
        const hasReloaded = window.sessionStorage.getItem('chunk_err_reload');
        if (!hasReloaded) {
          window.sessionStorage.setItem('chunk_err_reload', 'true');
          window.location.reload();
        }
      }
    };
    window.addEventListener('error', handleChunkError);
    return () => window.removeEventListener('error', handleChunkError);
  }, []);

  const safeFetchJson = async (url: string) => {
    try {
      const fetchUrl = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
      const res = await fetch(fetchUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          ...getAuthHeaders()
        }
      });
      if (res.headers.get('X-Quota-Exceeded') === 'true') {
        setIsQuotaExceeded(true);
      }
      if (!res.ok) return undefined;
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn(`[API] Fetch warning for ${url}:`, err);
      return undefined;
    }
  };

  // Fetch all data from server without full-screen flash on background re-fetches
  const loadData = async (showSpinner = false) => {
    try {
      if (showSpinner) {
        setIsLoading(true);
      }
      const matsPromise = safeFetchJson('/api/materials/compare');
      const trashInvsPromise = safeFetchJson('/api/invoices/trash');
      const trashDscsPromise = safeFetchJson('/api/discounts/trash');
      const prizmaInvsPromise = safeFetchJson('/api/prizma/invoices');

      const [sups, pers, jobs, dscs, invs, perfs] = await Promise.all([
        safeFetchJson('/api/supervisors'),
        safeFetchJson('/api/personnel'),
        safeFetchJson('/api/jobsites'),
        safeFetchJson('/api/discounts'),
        safeFetchJson('/api/invoices'),
        safeFetchJson('/api/reports/supervisor-performance')
      ]);

      if (Array.isArray(sups)) setSupervisors(sups);
      if (Array.isArray(pers)) setPersonnel(pers);
      if (Array.isArray(jobs)) setJobsites(jobs);
      if (Array.isArray(dscs)) setDiscounts(dscs);
      if (Array.isArray(invs)) setInvoices(invs);
      if (Array.isArray(perfs) && perfs.length > 0) setPerformances(perfs);
      setIsLoading(false);

      const [mats, trashInvs, trashDscs, prizmaInvs] = await Promise.all([
        matsPromise,
        trashInvsPromise,
        trashDscsPromise,
        prizmaInvsPromise
      ]);
      if (Array.isArray(mats)) setMaterialComparisons(ensureComparisonGroupIntegrity(mats));
      if (Array.isArray(trashInvs)) setTrashInvoices(trashInvs);
      if (Array.isArray(trashDscs)) setTrashDiscounts(trashDscs);
      if (Array.isArray(prizmaInvs)) setPrizmaInvoices(prizmaInvs);
      else if (prizmaInvs && Array.isArray((prizmaInvs as any).invoices)) setPrizmaInvoices((prizmaInvs as any).invoices);
    } catch (err) {
      console.error('Data loading error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
  }, []);

  useEffect(() => {
    let lastFocusSync = Date.now();
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusSync > 60000) {
        lastFocusSync = now;
        void loadData(false);
      }
    };
    const onDataSync = () => {
      lastFocusSync = Date.now();
      void loadData(false);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('gescons-data-sync', onDataSync);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('gescons-data-sync', onDataSync);
    };
  }, [user?.token]);

  // Handlers
  const handleSaveDiscount = async (record: Omit<DiscountRecord, 'id' | 'supervisorName' | 'jobsiteName' | 'discountAmount' | 'discountPercentage' | 'status'>) => {
    try {
      // In-memory evaluation of Method 1 (Benchmark) and Method 2 (Excessive Discount)
      const auditResult = evaluateDiscountAudit(
        {
          offerPrice: record.offerPrice,
          agreedPrice: record.agreedPrice,
          category: record.category,
          vendorName: record.vendorName,
          items: record.items
        },
        materialComparisons
      );

      const payload = {
        ...record,
        auditStatus: record.auditStatus || auditResult.auditStatus,
        auditFlags: (record.auditFlags && record.auditFlags.length > 0) ? record.auditFlags : auditResult.auditFlags,
        benchmarkComparison: auditResult.benchmarkComparison || record.benchmarkComparison,
        isEffortScoreFrozen: record.isEffortScoreFrozen !== undefined ? record.isEffortScoreFrozen : auditResult.isEffortScoreFrozen
      };

      const res = await fetch('/api/discounts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const newRecord = await res.json();
        if (newRecord && newRecord.id) {
          setDiscounts(prev => {
            const exists = prev.some(d => d.id === newRecord.id);
            if (exists) {
              return prev.map(d => d.id === newRecord.id ? newRecord : d);
            }
            return [newRecord, ...prev];
          });
        }
        await loadData();
        return newRecord;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || 'İndirim kaydı kaydedilemedi.');
      }
    } catch (err) {
      console.error('Error saving discount:', err);
      throw err;
    }
  };

  const handleUpdateDiscount = async (id: string, record: Partial<DiscountRecord>) => {
    try {
      const res = await fetch(`/api/discounts/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(record)
      });
      if (res.ok) {
        const updatedRecord = await res.json();
        if (updatedRecord && updatedRecord.id) {
          setDiscounts(prev => prev.map(d => d.id === id ? { ...d, ...updatedRecord } : d));
        }
        await loadData();
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || 'İndirim kaydı güncellenemedi.');
      }
    } catch (err) {
      console.error('Error updating discount:', err);
      throw err;
    }
  };

  const handleDeleteDiscount = async (id: string) => {
    try {
      const res = await fetch(`/api/discounts/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        setDiscounts(prev => prev.filter(d => d.id !== id));
        await loadData();
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || 'İndirim kaydı silinemedi.');
      }
    } catch (err) {
      console.error('Error deleting discount:', err);
      throw err;
    }
  };

  const handleSaveInvoice = async (invoice: Omit<InvoiceRecord, 'id' | 'createdAt'>) => {
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(invoice)
      });
      if (res.ok) {
        const savedDoc = await res.json();
        await loadData();
        return savedDoc;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || 'Fatura kaydedilemedi.');
      }
    } catch (err) {
      console.error('Error saving invoice:', err);
      throw err;
    }
  };

  const handleUpdateInvoice = async (id: string, invoice: Partial<InvoiceRecord>) => {
    try {
      // Optimistic update so UI reflects the edit immediately
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...invoice } : inv));
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(invoice)
      });
      if (!res.ok) {
        let errJson: any = {};
        try { errJson = await res.json(); } catch (_) {}
        await loadData();
        throw new Error(errJson.error || 'Fatura güncellenemedi');
      }
      await loadData();
    } catch (err) {
      console.error('Error updating invoice:', err);
      await loadData();
      throw err;
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    // Optimistically update active and trash invoices
    const targetInv = invoices.find(i => i.id === id);
    setInvoices(prev => prev.filter(inv => inv.id !== id));
    if (targetInv) {
      setTrashInvoices(prev => [{ ...targetInv, isDeleted: true, deletedAt: new Date().toISOString() }, ...prev]);
    }

    const res = await fetch(`/api/invoices/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      let errJson: any = {};
      try { errJson = await res.json(); } catch (_) {}
      await loadData();
      throw new Error(errJson.error || errJson.details || 'Fatura silinemedi');
    }
    await loadData();
  };

  const handleRestoreInvoice = async (id: string) => {
    const res = await fetch(`/api/invoices/${id}/restore`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      let errJson: any = {};
      try { errJson = await res.json(); } catch (_) {}
      throw new Error(errJson.error || errJson.details || 'Fatura geri yüklenemedi');
    }
    setTrashInvoices(prev => prev.filter(item => item.id !== id));
    await loadData();
  };

  const handlePermanentDeleteInvoice = async (id: string, adminPinParam?: string) => {
    const pin = (adminPinParam || (typeof window !== 'undefined' ? sessionStorage.getItem('admin_pin') : '') || '').trim();
    const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/permanent`, {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
        ...(pin ? { 'x-admin-pin': pin } : {})
      }
    });
    if (!res.ok) {
      let errJson: any = {};
      let rawText = '';
      try {
        rawText = await res.text();
        errJson = JSON.parse(rawText);
      } catch (_) {}
      const errMsg = errJson.error || errJson.message || errJson.details || (rawText && rawText.length < 200 ? rawText : null) || 'Fatura kalıcı olarak silinemedi';
      throw new Error(errMsg);
    }
    setTrashInvoices(prev => prev.filter(item => item.id !== id));
    await loadData();
  };

  const handleRestoreDiscount = async (id: string) => {
    const res = await fetch(`/api/discounts/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      let errJson: any = {};
      let rawText = '';
      try {
        rawText = await res.text();
        errJson = JSON.parse(rawText);
      } catch (_) {}
      throw new Error(errJson.error || errJson.message || 'İndirim geri yüklenemedi');
    }
    setTrashDiscounts(prev => prev.filter(item => item.id !== id));
    await loadData();
  };

  const handlePermanentDeleteDiscount = async (id: string, adminPinParam?: string) => {
    const pin = (adminPinParam || (typeof window !== 'undefined' ? sessionStorage.getItem('admin_pin') : '') || '').trim();
    const res = await fetch(`/api/discounts/${encodeURIComponent(id)}/permanent`, {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
        ...(pin ? { 'x-admin-pin': pin } : {})
      }
    });
    if (!res.ok) {
      let errJson: any = {};
      let rawText = '';
      try {
        rawText = await res.text();
        errJson = JSON.parse(rawText);
      } catch (_) {}
      const errMsg = errJson.error || errJson.message || errJson.details || (rawText && rawText.length < 200 ? rawText : null) || 'İndirim kalıcı olarak silinemedi';
      throw new Error(errMsg);
    }
    setTrashDiscounts(prev => prev.filter(item => item.id !== id));
    await loadData();
  };

  const handleEmptyTrash = async (adminPinParam?: string) => {
    const pin = adminPinParam || (typeof window !== 'undefined' ? sessionStorage.getItem('admin_pin') : '') || '';
    const res = await fetch('/api/invoices/trash/empty', {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
        ...(pin ? { 'x-admin-pin': pin } : {})
      }
    });
    if (!res.ok) {
      let errJson: any = {};
      try { errJson = await res.json(); } catch (_) {}
      throw new Error(errJson.error || errJson.message || 'Çöp kutusu boşaltılamadı');
    }
    setTrashInvoices([]);
    setTrashDiscounts([]);
    await loadData();
  };

  const handleAddJobsite = async (jobsite: Omit<Jobsite, 'id'>) => {
    try {
      const res = await fetch('/api/jobsites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobsite)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error adding jobsite:', err);
    }
  };

  const handleAddSupervisor = async (supervisor: Omit<PurchasingSupervisor, 'id'>) => {
    try {
      const res = await fetch('/api/supervisors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supervisor)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error adding supervisor:', err);
    }
  };

  const handleUpdateSupervisor = async (id: string, supervisor: Partial<PurchasingSupervisor>) => {
    try {
      const res = await fetch(`/api/supervisors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supervisor)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error updating supervisor:', err);
    }
  };

  const handleUpdateJobsite = async (id: string, jobsite: Partial<Jobsite>) => {
    try {
      const res = await fetch(`/api/jobsites/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobsite)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error updating jobsite:', err);
    }
  };

  const handleDeleteSupervisor = async (id: string) => {
    try {
      const res = await fetch(`/api/supervisors/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error deleting supervisor:', err);
    }
  };

  const handleDeleteJobsite = async (id: string) => {
    try {
      const res = await fetch(`/api/jobsites/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error deleting jobsite:', err);
    }
  };

  const handleAddPersonnel = async (pers: Omit<Personnel, 'id' | 'created_at'>) => {
    try {
      const res = await fetch('/api/personnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pers)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error adding personnel:', err);
    }
  };

  const handleUpdatePersonnel = async (id: string, pers: Partial<Personnel>) => {
    try {
      const res = await fetch(`/api/personnel/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pers)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error updating personnel:', err);
    }
  };

  const handleDeletePersonnel = async (id: string) => {
    try {
      const res = await fetch(`/api/personnel/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error deleting personnel:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex flex-col antialiased">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={openTab}
        onOpenNewDiscountModal={() => setShowQuickDiscountModal(true)}
        onOpenTrashModal={() => setShowTrashModal(true)}
        onOpenBackupModal={user?.role === 'admin' ? () => setShowBackupModal(true) : undefined}
        trashCount={totalTrashCount}
      />

      {/* Quota Notice Banner */}
      {isQuotaExceeded && (
        <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-sm border-b border-amber-600">
          <div className="flex items-center space-x-2 max-w-7xl mx-auto w-full">
            <span className="bg-amber-700 text-white font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">
              {isRu ? 'Ожидание доступа к данным' : 'Veri erişimi bekliyor'}
            </span>
            <span>
              {isRu
                ? 'Источник данных временно не отвечает. Устаревшие локальные данные не отображаются; обновите страницу при восстановлении соединения.'
                : 'Canlı veri kaynağı geçici olarak yanıt vermiyor. Eski tarayıcı veya yerel yedek verisi gösterilmez; bağlantı düzeldiğinde sayfayı yenileyin.'}
            </span>
          </div>
        </div>
      )}

      {/* Floating Pending Scan Return Bar (Visible when user switches tabs while an invoice/offer is scanned and waiting to be saved) */}
      {activeTab !== 'invoice-ai' && pendingInvoiceScan && (
        <div className="bg-indigo-950 text-white px-4 py-2.5 shadow-lg border-b-2 border-emerald-400 sticky top-0 z-40">
          <div className="max-w-[1700px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2.5">
              <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-black uppercase text-[10px]">
                {isRu ? 'Счет ожидает сохранения' : 'Kaydedilmeyi Bekleyen Fatura'}
              </span>
              <span className="font-bold text-indigo-100">
                {pendingInvoiceScan.supplier} ({isRu ? 'Счет №' : 'Fatura No'}: {pendingInvoiceScan.invoiceNumber}) — {pendingInvoiceScan.totalAmount.toLocaleString('tr-TR')} ₽
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveTab('invoice-ai');
                pendingInvoiceScan.openModal();
              }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs shadow-sm cursor-pointer shrink-0"
            >
              {isRu ? '📄 Вернуться к подтверждению счета и сохранить' : '📄 Fatura Onay Ekranına Dön ve Kaydet'}
            </button>
          </div>
        </div>
      )}

      {activeTab !== 'discount-entry' && pendingDiscountScan && (
        <div className="bg-slate-900 text-white px-4 py-2.5 shadow-lg border-b-2 border-amber-400 sticky top-0 z-40">
          <div className="max-w-[1700px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2.5">
              <span className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-black uppercase text-[10px]">
                {isRu ? 'Скидка / КП ожидает сохранения' : 'Kaydedilmeyi Bekleyen İndirim / Teklif'}
              </span>
              <span className="font-bold text-slate-100">
                {pendingDiscountScan.supplier} (№: {pendingDiscountScan.invoiceNumber}) — {pendingDiscountScan.totalAmount.toLocaleString('tr-TR')} ₽
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveTab('discount-entry');
                pendingDiscountScan.openModal();
              }}
              className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs shadow-sm cursor-pointer shrink-0"
            >
              {isRu ? '💰 Вернуться к проверке скидки и сохранить' : '💰 İndirim Kontrol Ekranına Dön ve Kaydet'}
            </button>
          </div>
        </div>
      )}

      {/* Main Content View */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-slate-600">
              {isRu ? 'Загрузка данных системы закупок...' : 'Satınalma Sistem Verileri Yükleniyor...'}
            </p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
              <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-slate-600">
                {isRu ? 'Загрузка модуля...' : 'Modül Yükleniyor...'}
              </p>
            </div>
          }>
            {activeTab === 'dashboard' && (
              <Dashboard
                invoices={invoices}
                discounts={discounts}
                materialComparisons={materialComparisons}
                jobsites={jobsites}
                supervisors={supervisors}
                personnel={personnel}
                onOpenNewDiscountModal={() => setShowQuickDiscountModal(true)}
                onOpenBackupModal={user?.role === 'admin' ? () => setShowBackupModal(true) : undefined}
                onNavigateToTab={openTab}
                onNavigateToMaterial={(matName, category, sourceFilter, materialId) => {
                  openMaterialCompare({
                    materialName: matName || '',
                    materialId: materialId || '',
                    category: category || '',
                    sourceFilter
                  });
                }}
                onRefreshData={() => loadData(false)}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
              />
            )}

            {(activeTab === 'pre-approval-audit' || visitedTabs['pre-approval-audit']) && (
              <div className={activeTab === 'pre-approval-audit' ? 'block' : 'hidden'}>
                <PreApprovalAudit
                  jobsites={jobsites}
                  supervisors={supervisors}
                  invoices={invoices}
                  prizmaInvoices={prizmaInvoices}
                  onInvoiceSaved={handleSaveInvoice}
                />
              </div>
            )}

            {activeTab === 'performance' && (
              <SupervisorPerformanceReport
                performances={performances}
                discounts={discounts}
                supervisors={supervisors}
                jobsites={jobsites}
                personnel={personnel}
                comparisons={materialComparisons}
                invoices={invoices}
                prizmaInvoices={prizmaInvoices}
                onOpenNewDiscountModal={() => setShowQuickDiscountModal(true)}
                onUpdateDiscount={handleUpdateDiscount}
                onDeleteDiscount={handleDeleteDiscount}
                onUpdateInvoice={handleUpdateInvoice}
              />
            )}

            {activeTab === 'anomalies' && (
              <ProcurementAnomalyAlerts
                invoices={invoices}
                discounts={discounts}
                comparisons={materialComparisons}
                jobsites={jobsites}
                supervisors={supervisors}
                onNavigateToMaterial={(matName) => {
                  openMaterialCompare({ materialName: matName, materialId: '', category: '' });
                }}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
              />
            )}

            {(activeTab === 'discount-entry' || activeTab === 'comparative-offers' || visitedTabs['discount-entry']) && (
              <div className={(activeTab === 'discount-entry' || activeTab === 'comparative-offers') ? 'block' : 'hidden'}>
                <DiscountEntryForm
                  supervisors={supervisors}
                  jobsites={jobsites}
                  discounts={discounts}
                  invoices={invoices}
                  prizmaInvoices={prizmaInvoices}
                  personnel={personnel}
                  onSaveDiscount={handleSaveDiscount}
                  onUpdateDiscount={handleUpdateDiscount}
                  onDeleteDiscount={handleDeleteDiscount}
                  onPendingDiscountScanChange={setPendingDiscountScan}
                  onSuccess={() => {
                    void loadData(false);
                    setTimeout(() => {
                      document.getElementById('recent-discounts-section')?.scrollIntoView({ behavior: 'smooth' });
                    }, 150);
                  }}
                />
              </div>
            )}

            {(activeTab === 'invoice-ai' || visitedTabs['invoice-ai']) && (
              <div className={activeTab === 'invoice-ai' ? 'block' : 'hidden'}>
                <InvoiceScannerAI
                  jobsites={jobsites}
                  supervisors={supervisors}
                  onInvoiceSaved={handleSaveInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  onOpenTrashModal={() => setShowTrashModal(true)}
                  trashCount={totalTrashCount}
                  recentInvoices={invoices}
                  onPendingScanChange={setPendingInvoiceScan}
                />
              </div>
            )}

            {activeTab === 'invoice-drive' && (
              <InvoiceDriveVault
                invoices={invoices}
                discounts={discounts}
                jobsites={jobsites}
                supervisors={supervisors}
                onInvoiceSaved={handleSaveInvoice}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
                onNavigateToCompare={(matName) => {
                  openMaterialCompare({ materialName: matName, materialId: '', category: '', sourceFilter: 'local_only' });
                }}
                onNavigateToPrizma={() => setActiveTab('prizma-invoices')}
                onOpenTrashModal={() => setShowTrashModal(true)}
                trashCount={totalTrashCount}
              />
            )}

            {activeTab === 'tdf' && (
              <TdfView jobsites={jobsites} />
            )}

            {activeTab === 'prizma-invoices' && (
              <PrizmaInvoicesView
                onNavigateToCompare={(matName) => {
                  openMaterialCompare({ materialName: matName, materialId: '', category: '', sourceFilter: 'all' });
                }}
              />
            )}

            {activeTab === 'material-compare' && (
              <MaterialPriceComparison
                comparisons={materialComparisons}
                invoices={invoices}
                jobsites={jobsites}
                supervisors={supervisors}
                initialMaterialName={compareNav?.materialName}
                initialMaterialId={compareNav?.materialId}
                initialCategory={compareNav?.category}
                initialSourceFilter={compareNav?.sourceFilter}
                navRequestSeq={compareNav?.seq}
                onRefreshData={loadData}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
              />
            )}

            {activeTab === 'special-materials' && (
              <SpecialMaterialAnalytics
                invoices={invoices}
                jobsites={jobsites}
                onNavigateToInvoiceDrive={() => setActiveTab('invoice-drive')}
              />
            )}

            {activeTab === 'jobsites-supervisors' && (
              <JobsitesAndSupervisors
                jobsites={jobsites}
                supervisors={supervisors}
                personnel={personnel}
                onAddJobsite={handleAddJobsite}
                onAddSupervisor={handleAddSupervisor}
                onAddPersonnel={handleAddPersonnel}
                onUpdateJobsite={handleUpdateJobsite}
                onUpdateSupervisor={handleUpdateSupervisor}
                onUpdatePersonnel={handleUpdatePersonnel}
                onDeleteJobsite={handleDeleteJobsite}
                onDeleteSupervisor={handleDeleteSupervisor}
                onDeletePersonnel={handleDeletePersonnel}
                onOpenBackupCenter={user?.role === 'admin' ? () => setShowBackupModal(true) : undefined}
              />
            )}
          </Suspense>
        )}
      </main>

      {/* Quick Discount Entry Modal */}
      {showQuickDiscountModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-hidden">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-300 max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Fixed Header */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">
                    {isRu ? 'Добавить новую скидку и КП шефа' : 'Yeni Şef İndirim & Teklif Kaydı Aktar'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {isRu ? 'Сравнение КП и автоматическая облачная архивация' : 'Teklif karşılaştırma ve otomatik sistem bulut arşivleme'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQuickDiscountModal(false)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 w-8 h-8 rounded-lg text-base font-bold flex items-center justify-center cursor-pointer transition-colors"
                title={isRu ? 'Закрыть (ESC)' : 'Kapat (ESC)'}
              >
                ✕
              </button>
            </div>

            {/* Modal Body Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
              <DiscountEntryForm
                supervisors={supervisors}
                jobsites={jobsites}
                discounts={discounts}
                invoices={invoices}
                prizmaInvoices={prizmaInvoices}
                personnel={personnel}
                onSaveDiscount={handleSaveDiscount}
                onUpdateDiscount={handleUpdateDiscount}
                onDeleteDiscount={handleDeleteDiscount}
                onSuccess={() => {
                  setShowQuickDiscountModal(false);
                  setActiveTab('discount-entry');
                  setTimeout(() => {
                    document.getElementById('recent-discounts-section')?.scrollIntoView({ behavior: 'smooth' });
                  }, 150);
                }}
                isModal={true}
              />
            </div>
          </div>
        </div>
      )}

      {/* Trash Can Modal */}
      {showTrashModal && (
        <TrashCanModal
          trashInvoices={trashInvoices}
          trashDiscounts={trashDiscounts}
          onClose={() => setShowTrashModal(false)}
          onRestoreInvoice={handleRestoreInvoice}
          onRestoreDiscount={handleRestoreDiscount}
          onPermanentDeleteInvoice={handlePermanentDeleteInvoice}
          onPermanentDeleteDiscount={handlePermanentDeleteDiscount}
          onEmptyTrash={handleEmptyTrash}
        />
      )}

      {/* Data Backup & Safety Center Modal - Strictly Admin Only Guard */}
      {showBackupModal && user?.role === 'admin' && (
        <DataBackupCenterModal
          isOpen={showBackupModal}
          onClose={() => setShowBackupModal(false)}
          onDataRestored={() => loadData(true)}
        />
      )}

      {/* Login Authentication Modal */}
      <LoginModal />

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 py-6 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            {isRu
              ? '© 2026 GES Construction — Разработано и управляется Платформой закупок GES.'
              : '© 2026 GES Construction — GES Satınalma Platformu tarafından geliştirilmiş ve işletilmektedir.'}
          </span>
          <span className="text-slate-500">
            {isRu
              ? 'Инфраструктура OCR и анализа документов работает на базе Google Gemini API.'
              : 'OCR ve belge analiz altyapısı Google Gemini API ile desteklenmektedir.'}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
