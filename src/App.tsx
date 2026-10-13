import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
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

// Resilient dynamic chunk loader with auto-retry and cache busting
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T } | { [key: string]: T }>,
  key?: string
) {
  return lazy(async () => {
    try {
      const module = await factory();
      if ('default' in module && module.default) {
        return { default: module.default as T };
      }
      return { default: Object.values(module)[0] as T };
    } catch (err: any) {
      console.warn('[LAZY LOAD RETRY] Dynamic chunk import failed, retrying once...', err);
      try {
        const retryModule = await factory();
        if ('default' in retryModule && retryModule.default) {
          return { default: retryModule.default as T };
        }
        return { default: Object.values(retryModule)[0] as T };
      } catch (retryErr) {
        const reloadKey = 'chunk_reload_' + (key || 'lazy');
        const hasReloaded = window.sessionStorage.getItem(reloadKey);
        if (!hasReloaded) {
          window.sessionStorage.setItem(reloadKey, 'true');
          window.location.reload();
        }
        throw retryErr;
      }
    }
  });
}

// Lazy loaded auxiliary components
const InvoiceScannerAI = lazyWithRetry(() => import('./components/InvoiceScannerAI').then(m => ({ default: m.InvoiceScannerAI })), 'InvoiceScannerAI');
const InvoiceDriveVault = lazyWithRetry(() => import('./components/InvoiceDriveVault').then(m => ({ default: m.InvoiceDriveVault })), 'InvoiceDriveVault');
const TrashCanModal = lazyWithRetry(() => import('./components/TrashCanModal').then(m => ({ default: m.TrashCanModal })), 'TrashCanModal');
const DataBackupCenterModal = lazyWithRetry(() => import('./components/DataBackupCenterModal').then(m => ({ default: m.DataBackupCenterModal })), 'DataBackupCenterModal');
const ComparativeOffersView = lazyWithRetry(() => import('./components/ComparativeOffersView').then(m => ({ default: m.ComparativeOffersView })), 'ComparativeOffersView');

import { Coins } from 'lucide-react';
import { evaluateDiscountAudit } from './utils/auditRiskEngine';

import {
  PurchasingSupervisor,
  Personnel,
  Jobsite,
  DiscountRecord,
  InvoiceRecord,
  MaterialComparison,
  SupervisorPerformance
} from './types';

function AppContent() {
  const { user } = useAuth();
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
      'x-user-name': encodeURIComponent(user?.displayName || ''),
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
  const [trashInvoices, setTrashInvoices] = useState<InvoiceRecord[]>([]);
  const [trashDiscounts, setTrashDiscounts] = useState<DiscountRecord[]>([]);
  const [materialComparisons, setMaterialComparisons] = useState<MaterialComparison[]>([]);
  const [performances, setPerformances] = useState<SupervisorPerformance[]>([]);
  const [targetCompareMaterial, setTargetCompareMaterial] = useState<string>('');

  const totalTrashCount = trashInvoices.length + trashDiscounts.length;

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(false);

  // Modals
  const [showQuickDiscountModal, setShowQuickDiscountModal] = useState<boolean>(false);
  const [showTrashModal, setShowTrashModal] = useState<boolean>(false);
  const [showBackupModal, setShowBackupModal] = useState<boolean>(false);

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
      const [sups, pers, jobs, dscs, invs, trashInvs, trashDscs, mats, perfs] = await Promise.all([
        safeFetchJson('/api/supervisors'),
        safeFetchJson('/api/personnel'),
        safeFetchJson('/api/jobsites'),
        safeFetchJson('/api/discounts'),
        safeFetchJson('/api/invoices'),
        safeFetchJson('/api/invoices/trash'),
        safeFetchJson('/api/discounts/trash'),
        safeFetchJson('/api/materials/compare'),
        safeFetchJson('/api/reports/supervisor-performance')
      ]);

      if (Array.isArray(sups)) setSupervisors(sups);
      if (Array.isArray(pers)) setPersonnel(pers);
      if (Array.isArray(jobs)) setJobsites(jobs);
      if (Array.isArray(dscs)) setDiscounts(dscs);
      if (Array.isArray(invs)) setInvoices(invs);
      if (Array.isArray(trashInvs)) setTrashInvoices(trashInvs);
      if (Array.isArray(trashDscs)) setTrashDiscounts(trashDscs);
      if (Array.isArray(mats)) setMaterialComparisons(mats);
      if (Array.isArray(perfs) && perfs.length > 0) setPerformances(perfs);
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
    const sync = () => { void loadData(false); };
    window.addEventListener('focus', sync);
    window.addEventListener('gescons-data-sync', sync);
    return () => { window.removeEventListener('focus', sync); window.removeEventListener('gescons-data-sync', sync); };
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
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(invoice)
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Error updating invoice:', err);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    const res = await fetch(`/api/invoices/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      let errJson: any = {};
      try { errJson = await res.json(); } catch (_) {}
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
        setActiveTab={setActiveTab}
        onOpenNewDiscountModal={() => setShowQuickDiscountModal(true)}
        onOpenTrashModal={() => setShowTrashModal(true)}
        onOpenBackupModal={user?.role === 'admin' ? () => setShowBackupModal(true) : undefined}
        trashCount={totalTrashCount}
      />

      {/* Quota Notice Banner */}
      {isQuotaExceeded && (
        <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-sm border-b border-amber-600">
          <div className="flex items-center space-x-2 max-w-7xl mx-auto w-full">
            <span className="bg-amber-700 text-white font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">Veri erişimi bekliyor</span>
            <span>Canlı veri kaynağı geçici olarak yanıt vermiyor. Eski tarayıcı veya yerel yedek verisi gösterilmez; bağlantı düzeldiğinde sayfayı yenileyin.</span>
          </div>
        </div>
      )}

      {/* Main Content View */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-slate-600">Satınalma Sistem Verileri Yükleniyor...</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
              <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-slate-600">Modül Yükleniyor...</p>
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
                onNavigateToTab={(tabId) => setActiveTab(tabId)}
                onRefreshData={() => loadData(false)}
              />
            )}

            {activeTab === 'pre-approval-audit' && (
              <PreApprovalAudit
                jobsites={jobsites}
                supervisors={supervisors}
                invoices={invoices}
                onInvoiceSaved={handleSaveInvoice}
              />
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
                onOpenNewDiscountModal={() => setShowQuickDiscountModal(true)}
                onUpdateDiscount={handleUpdateDiscount}
                onDeleteDiscount={handleDeleteDiscount}
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
                  setTargetCompareMaterial(matName);
                  setActiveTab('material-compare');
                }}
              />
            )}

            {activeTab === 'discount-entry' && (
              <DiscountEntryForm
                supervisors={supervisors}
                jobsites={jobsites}
                discounts={discounts}
                invoices={invoices}
                personnel={personnel}
                onSaveDiscount={handleSaveDiscount}
                onUpdateDiscount={handleUpdateDiscount}
                onDeleteDiscount={handleDeleteDiscount}
                onSuccess={() => {
                  setTimeout(() => {
                    document.getElementById('recent-discounts-section')?.scrollIntoView({ behavior: 'smooth' });
                  }, 150);
                }}
              />
            )}

            {activeTab === 'comparative-offers' && (
              <ComparativeOffersView
                jobsites={jobsites}
                supervisors={supervisors}
                personnel={personnel}
                onNavigateToTab={(tabId) => setActiveTab(tabId)}
                onRefreshData={() => loadData(false)}
              />
            )}

            {activeTab === 'invoice-ai' && (
              <InvoiceScannerAI
                jobsites={jobsites}
                supervisors={supervisors}
                onInvoiceSaved={handleSaveInvoice}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
                onOpenTrashModal={() => setShowTrashModal(true)}
                trashCount={totalTrashCount}
                recentInvoices={invoices}
              />
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
                  setTargetCompareMaterial(matName);
                  setActiveTab('material-compare');
                }}
                onNavigateToPrizma={() => setActiveTab('prizma-invoices')}
                onOpenTrashModal={() => setShowTrashModal(true)}
                trashCount={totalTrashCount}
              />
            )}

            {activeTab === 'prizma-invoices' && (
              <PrizmaInvoicesView
                onNavigateToCompare={(matName) => {
                  setTargetCompareMaterial(matName);
                  setActiveTab('material-compare');
                }}
              />
            )}

            {activeTab === 'material-compare' && (
              <MaterialPriceComparison
                comparisons={materialComparisons}
                invoices={invoices}
                jobsites={jobsites}
                supervisors={supervisors}
                initialMaterialName={targetCompareMaterial}
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
                  <h3 className="font-bold text-sm text-slate-100">Yeni Şef İndirim & Teklif Kaydı Aktar</h3>
                  <p className="text-[11px] text-slate-400">Teklif karşılaştırma ve otomatik sistem bulut arşivleme</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQuickDiscountModal(false)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 w-8 h-8 rounded-lg text-base font-bold flex items-center justify-center cursor-pointer transition-colors"
                title="Kapat (ESC)"
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
          <span>© 2026 GES Construction — GES Satınalma Platformu tarafından geliştirilmiş ve işletilmektedir.</span>
          <span className="text-slate-500">OCR ve belge analiz altyapısı Google Gemini API ile desteklenmektedir.</span>
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
