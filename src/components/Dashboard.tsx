import React, { useState, useEffect, useMemo } from 'react';
import {
  InvoiceRecord,
  DiscountRecord,
  MaterialComparison,
  Jobsite,
  PurchasingSupervisor,
  Personnel
} from '../types';
import { GamifiedSupervisorLeaderboard } from './GamifiedSupervisorLeaderboard';
import { SpecialMaterialAnalytics } from './SpecialMaterialAnalytics';
import { SmartDashboardInsights } from './SmartDashboardInsights';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { DiscountDetailModal } from './DiscountDetailModal';
import { normalizeVendorName } from '../utils/vendorNormalizer';
import { formatRuble, formatRubleWithDecimals, formatUploadDate } from '../utils/format';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import {
  DashboardFilterState,
  DateRangePreset,
  dedupeSyncedInvoices,
  isPrizmaAutoSyncedInvoice,
  getDateRangeBounds,
  getPreviousPeriodBounds,
  filterInvoices,
  filterDiscounts,
  extractDistinctCategories,
  calculateKPIStats,
  getMonthlySpendingTrend,
  getJobsiteSpendingDistribution,
  getCategorySpendingDistribution,
  getSupervisorPerformanceData,
  getTopPriceDifferenceMaterials,
  getRecentCombinedTransactions,
  getTopDiscountRecords,
  getDashboardAnomalies,
  exportDashboardToExcel,
  exportDashboardToHtml
} from '../utils/dashboardStats';
import { verifyProcurementDataIntegrity } from '../utils/procurementAnalyticsCore';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Percent,
  Building2,
  Users,
  ShieldAlert,
  Clock,
  FileText,
  CreditCard,
  Download,
  RefreshCw,
  PlusCircle,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  HardDrive,
  Database,
  Calendar,
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Tag,
  Eye,
  CheckCircle2,
  Sparkles,
  Layers,
  X,
  FileSpreadsheet,
  Paperclip,
  Info,
  SlidersHorizontal,
  ArrowRight,
  ArrowLeft,
  Boxes,
  BarChart3,
  ChevronDown,
  Table,
  FilterX,
  Check
} from 'lucide-react';

interface DashboardProps {
  invoices: InvoiceRecord[];
  discounts: DiscountRecord[];
  materialComparisons: MaterialComparison[];
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  personnel?: Personnel[];
  onOpenNewDiscountModal: () => void;
  onOpenBackupModal?: () => void;
  onNavigateToTab: (tabId: string) => void;
  onRefreshData?: () => Promise<void>;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => void | Promise<void>;
  onDeleteInvoice?: (id: string) => void | Promise<void>;
}

// Modern harmonious color palette for charts (Avoids clashing saturated slop)
const CHART_COLORS = [
  '#4f46e5', // Indigo
  '#0d9488', // Teal
  '#d97706', // Amber
  '#e11d48', // Rose
  '#0284c7', // Sky Blue
  '#7c3aed', // Violet
  '#16a34a', // Emerald
  '#ea580c', // Orange
  '#64748b'  // Slate
];

const getCategoryIcon = (category: string) => {
  if (category === 'İnşaat Demiri') return '🏗️';
  if (category === 'Çelik Borular') return '⚙️';
  if (category === 'Çelik Malzemeler') return '🔩';
  if (category === 'Donatı Malzemeleri') return '🪢';
  if (category === 'Ankraj Sistemleri') return '⚓';
  if (category.includes('Beton') || category.includes('Çimento') || category.includes('Agrega')) return '🧱';
  if (category.includes('Tuğla') || category.includes('Gazbeton') || category.includes('Duvar')) return '🧱';
  if (category.includes('Kalıp') || category.includes('İskele')) return '🪵';
  if (category.includes('Ahşap') || category.includes('Kereste')) return '🌲';
  if (category.includes('Yalıtım') || category.includes('Alçıpan')) return '🛡️';
  if (category.includes('Kimyasal') || category.includes('Boya')) return '🧪';
  if (category.includes('Mekanik') || category.includes('Tesisat')) return '🔧';
  if (category.includes('Elektrik') || category.includes('Otomasyon')) return '⚡';
  if (category.includes('İş Güvenliği') || category.includes('KKD')) return '🦺';
  if (category === 'El Aletleri & Hırdavat') return '🔨';
  if (category === 'Sarf Malzeme & Hırdavat') return '🛠️';
  if (category.includes('Kaynak')) return '🧑‍🏭';
  if (category.includes('Seramik') || category.includes('Vitrifiye')) return '🪨';
  if (category.includes('İç Mekan') || category.includes('Zemin') || category.includes('Kapı') || category.includes('Doğrama')) return '🚪';
  if (category.includes('Tabela') || category.includes('Yönlendirme') || category.includes('Reklam')) return '🪧';
  if (category.includes('Ölçüm') || category.includes('Harita') || category.includes('Saha Ekipman')) return '📐';
  if (category.includes('Mobilya') || category.includes('Yaşam Donanımı')) return '🛏️';
  if (category.includes('Tesis') || category.includes('Konteyner')) return '🏠';
  if (category.includes('Temizlik') || category.includes('Hijyen')) return '🧹';
  if (category.includes('Gıda') || category.includes('Mutfak')) return '☕';
  if (category.includes('Ofis') || category.includes('Kırtasiye')) return '📎';
  if (category.includes('Bilgi İşlem') || category.includes('IT')) return '💻';
  if (category.includes('Araç') || category.includes('İş Makinesi')) return '🚜';
  return '📦';
};

const getCategoryColorTheme = (index: number) => {
  const themes = [
    {
      bgActive: 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-300 shadow-xs',
      bgNormal: 'bg-gradient-to-br from-amber-50/40 to-orange-50/20 border-amber-200/80 hover:border-amber-400 hover:shadow-xs',
      badge: 'bg-amber-200/70 text-amber-900',
      textTitle: 'text-amber-900',
      textSpend: 'text-amber-950',
      textSub: 'text-amber-800/80',
      textAction: 'text-amber-700'
    },
    {
      bgActive: 'bg-indigo-50/90 border-indigo-400 ring-2 ring-indigo-300 shadow-xs',
      bgNormal: 'bg-gradient-to-br from-indigo-50/40 to-blue-50/20 border-indigo-200/80 hover:border-indigo-400 hover:shadow-xs',
      badge: 'bg-indigo-200/70 text-indigo-900',
      textTitle: 'text-indigo-900',
      textSpend: 'text-indigo-950',
      textSub: 'text-indigo-800/80',
      textAction: 'text-indigo-700'
    },
    {
      bgActive: 'bg-emerald-50/90 border-emerald-400 ring-2 ring-emerald-300 shadow-xs',
      bgNormal: 'bg-gradient-to-br from-emerald-50/40 to-teal-50/20 border-emerald-200/80 hover:border-emerald-400 hover:shadow-xs',
      badge: 'bg-emerald-200/70 text-emerald-900',
      textTitle: 'text-emerald-900',
      textSpend: 'text-emerald-950',
      textSub: 'text-emerald-800/80',
      textAction: 'text-emerald-700'
    },
    {
      bgActive: 'bg-purple-50/90 border-purple-400 ring-2 ring-purple-300 shadow-xs',
      bgNormal: 'bg-gradient-to-br from-purple-50/40 to-pink-50/20 border-purple-200/80 hover:border-purple-400 hover:shadow-xs',
      badge: 'bg-purple-200/70 text-purple-900',
      textTitle: 'text-purple-900',
      textSpend: 'text-purple-950',
      textSub: 'text-purple-800/80',
      textAction: 'text-purple-700'
    }
  ];
  return themes[index % themes.length];
};

export const Dashboard: React.FC<DashboardProps> = ({
  invoices,
  discounts,
  materialComparisons,
  jobsites,
  supervisors,
  personnel = [],
  onOpenNewDiscountModal,
  onOpenBackupModal,
  onNavigateToTab,
  onRefreshData,
  onUpdateInvoice,
  onDeleteInvoice
}) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();

  // Filters State
  const [filter, setFilter] = useState<DashboardFilterState>({
    dateRange: 'ALL_TIME',
    selectedJobsiteId: 'ALL',
    selectedCategory: 'ALL',
    selectedSupervisorId: 'ALL',
    selectedVendor: 'ALL',
    invoiceNo: '',
    searchTerm: ''
  });

  // Table specific filter and pagination states (default to DISCOUNT tab as requested)
  const [txFilterType, setTxFilterType] = useState<'ALL' | 'DISCOUNT' | 'INVOICE'>('DISCOUNT');
  const [activeDashboardView, setActiveDashboardView] = useState<'OVERVIEW' | 'SPECIAL_MATERIALS'>('OVERVIEW');
  const [jobsiteViewMode, setJobsiteViewMode] = useState<'pie' | 'bar'>('pie');
  const [categoryViewMode, setCategoryViewMode] = useState<'hybrid' | 'bars' | 'donut' | 'table'>('hybrid');
  const [showAllCategoryPills, setShowAllCategoryPills] = useState<boolean>(false);
  const [txSearch, setTxSearch] = useState<string>('');
  const [txPage, setTxPage] = useState<number>(1);
  const [txPageSize, setTxPageSize] = useState<number>(10);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);

  useModalBackHandler(!!selectedTx, () => setSelectedTx(null));

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [backupInfo, setBackupInfo] = useState<{
    lastBackupTime: string | null;
    snapshotCount: number;
    totalSizeBytes: number;
  }>({
    lastBackupTime: null,
    snapshotCount: 0,
    totalSizeBytes: 0
  });

  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [backupSuccessMessage, setBackupSuccessMessage] = useState<string | null>(null);

  // Full transparent visibility across all roles (Admin, Supervisor, Personnel) to foster healthy team competition
  // Only include GES platform invoices (Yeni Satınalma İndirim Girişi, 1M+ ₽ TDF, AI Fatura / Çek Okuma); exclude Prizma reference invoices
  const effectiveInvoices = useMemo(() => {
    const validInvoices = invoices.filter(i => 
      !i.isDeleted && 
      !i.isPermanentlyDeleted && 
      !isPrizmaAutoSyncedInvoice(i) &&
      (i.supplier || (i.items && i.items.length > 0) || i.totalAmount > 0)
    );
    return dedupeSyncedInvoices(validInvoices, discounts);
  }, [invoices, discounts]);

  const effectiveDiscounts = useMemo(() => {
    return discounts.filter(d => 
      !d.isDeleted && 
      !d.isPermanentlyDeleted && 
      (d.vendorName || (d.items && d.items.length > 0) || d.offerPrice > 0 || d.agreedPrice > 0)
    );
  }, [discounts]);

  // Fetch Backup Manifest Information (Admin Only)
  const fetchBackupMetadata = async () => {
    if (user?.role !== 'admin') return;
    try {
      const res = await fetch('/api/backup/list', {
        headers: {
          'x-session-token': user.token || '',
          'x-user-name': user.username
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.manifest) {
          const snapshots = data.manifest.snapshots || [];
          const totalBytes = snapshots.reduce((sum: number, s: any) => sum + (s.sizeBytes || 0), 0);
          const latestFormatted = snapshots.length > 0
            ? (snapshots[0].dateFormatted || (snapshots[0].timestamp ? formatUploadDate(snapshots[0].timestamp) : null))
            : (data.lastBackupTime ? formatUploadDate(data.lastBackupTime) : null);

          setBackupInfo({
            lastBackupTime: latestFormatted,
            snapshotCount: snapshots.length,
            totalSizeBytes: totalBytes
          });
        }
      }
    } catch (e) {
      console.warn('Dashboard backup metadata fetch error:', e);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchBackupMetadata();
    }
  }, [user?.role]);

  const handleManualBackup = async () => {
    if (user?.role !== 'admin') return;
    try {
      setIsCreatingBackup(true);
      const res = await fetch('/api/backup/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user.token || '',
          'x-user-name': user.username
        }
      });
      if (res.ok) {
        setBackupSuccessMessage('Yedek başarıyla oluşturuldu');
        await fetchBackupMetadata();
        setTimeout(() => setBackupSuccessMessage(null), 3000);
      }
    } catch (e) {
      console.error('Manual backup error:', e);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRefresh = async () => {
    if (!onRefreshData) return;
    try {
      setIsRefreshing(true);
      await onRefreshData();
      await fetchBackupMetadata();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Extract distinct categories
  const categories = useMemo(() => {
    return extractDistinctCategories(effectiveInvoices, effectiveDiscounts);
  }, [effectiveInvoices, effectiveDiscounts]);

  // Extract canonical vendors for filter dropdown
  const canonicalVendors = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    (effectiveInvoices || []).forEach(inv => {
      if (!inv || !inv.supplier || inv.isDeleted) return;
      const norm = normalizeVendorName(inv.supplier);
      if (!norm) return;
      const existing = map.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(norm, { name: inv.supplier.trim(), count: 1 });
      }
    });
    (effectiveDiscounts || []).forEach(disc => {
      if (!disc || !disc.vendorName || disc.isDeleted) return;
      const norm = normalizeVendorName(disc.vendorName);
      if (!norm) return;
      const existing = map.get(norm);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(norm, { name: disc.vendorName.trim(), count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [effectiveInvoices, effectiveDiscounts]);

  const isAnyFilterActive = useMemo(() => {
    return (
      filter.dateRange !== 'ALL_TIME' ||
      filter.selectedJobsiteId !== 'ALL' ||
      filter.selectedCategory !== 'ALL' ||
      (Boolean(filter.selectedSupervisorId) && filter.selectedSupervisorId !== 'ALL') ||
      (Boolean(filter.selectedVendor) && filter.selectedVendor !== 'ALL') ||
      Boolean(filter.invoiceNo && filter.invoiceNo.trim()) ||
      Boolean(filter.searchTerm && filter.searchTerm.trim())
    );
  }, [filter]);

  const handleResetFilters = () => {
    setFilter({
      dateRange: 'ALL_TIME',
      selectedJobsiteId: 'ALL',
      selectedCategory: 'ALL',
      selectedSupervisorId: 'ALL',
      selectedVendor: 'ALL',
      invoiceNo: '',
      searchTerm: ''
    });
  };

  // Filter Bounds
  const currentBounds = useMemo(() => {
    return getDateRangeBounds(filter.dateRange, filter.customStartDate, filter.customEndDate);
  }, [filter.dateRange, filter.customStartDate, filter.customEndDate]);

  const previousBounds = useMemo(() => {
    return getPreviousPeriodBounds(filter.dateRange, currentBounds.start, currentBounds.end);
  }, [filter.dateRange, currentBounds]);

  // Filtered Datasets
  const currentFilteredInvoices = useMemo(() => {
    return filterInvoices(effectiveInvoices, filter, currentBounds);
  }, [effectiveInvoices, filter, currentBounds]);

  const currentFilteredDiscounts = useMemo(() => {
    return filterDiscounts(effectiveDiscounts, filter, currentBounds);
  }, [effectiveDiscounts, filter, currentBounds]);

  const previousFilteredInvoices = useMemo(() => {
    return filterInvoices(effectiveInvoices, filter, previousBounds);
  }, [effectiveInvoices, filter, previousBounds]);

  const previousFilteredDiscounts = useMemo(() => {
    return filterDiscounts(effectiveDiscounts, filter, previousBounds);
  }, [effectiveDiscounts, filter, previousBounds]);

  // Detected Anomalies
  const anomaliesList = useMemo(() => {
    return getDashboardAnomalies(currentFilteredInvoices, currentFilteredDiscounts, materialComparisons);
  }, [currentFilteredInvoices, currentFilteredDiscounts, materialComparisons]);

  // Super-Intelligent Procurement Brain Insights (4 Hidden Anomaly Engines)
  const superIntelligentInsights = useMemo(() => {
    const items = anomaliesList.filter(a =>
      a.type === 'CROSS_JOBSITE_ARBITRAGE' ||
      a.type === 'SPLIT_INVOICE_SMURFING' ||
      a.type === 'PRICE_CREEP' ||
      a.type === 'BASKET_SHRINKAGE'
    );
    const totalPotentialSavings = items.reduce((sum, a) => sum + (Number(a.impactAmount) || 0), 0);
    const criticalCount = items.filter(a => a.severity === 'CRITICAL').length;
    const arbitrageItems = items.filter(a => a.type === 'CROSS_JOBSITE_ARBITRAGE');
    const smurfingItems = items.filter(a => a.type === 'SPLIT_INVOICE_SMURFING');
    const creepItems = items.filter(a => a.type === 'PRICE_CREEP');
    const shrinkageItems = items.filter(a => a.type === 'BASKET_SHRINKAGE');

    return {
      items,
      totalCount: items.length,
      totalPotentialSavings,
      criticalCount,
      arbitrageCount: arbitrageItems.length,
      arbitrageSavings: arbitrageItems.reduce((s, a) => s + (Number(a.impactAmount) || 0), 0),
      smurfingCount: smurfingItems.length,
      smurfingImpact: smurfingItems.reduce((s, a) => s + (Number(a.impactAmount) || 0), 0),
      creepCount: creepItems.length,
      creepImpact: creepItems.reduce((s, a) => s + (Number(a.impactAmount) || 0), 0),
      shrinkageCount: shrinkageItems.length,
      shrinkageImpact: shrinkageItems.reduce((s, a) => s + (Number(a.impactAmount) || 0), 0),
      topRecommendations: items.slice(0, 3)
    };
  }, [anomaliesList]);

  // Chart Data: Category Spending Distribution (synchronized with 28 Canonical Categories & Material Price Comparison)
  const categorySpendingData = useMemo(() => {
    return getCategorySpendingDistribution(currentFilteredInvoices, 50, materialComparisons, filter);
  }, [currentFilteredInvoices, materialComparisons, filter]);

  // Computed KPI Stats (Total spend matches material category spending kuruşu kuruşuna)
  const kpiStats = useMemo(() => {
    return calculateKPIStats({
      currentInvoices: currentFilteredInvoices,
      currentDiscounts: currentFilteredDiscounts,
      previousInvoices: previousFilteredInvoices,
      previousDiscounts: previousFilteredDiscounts,
      jobsites,
      supervisors,
      anomaliesCount: anomaliesList.length,
      categorySpending: categorySpendingData
    });
  }, [
    currentFilteredInvoices,
    currentFilteredDiscounts,
    previousFilteredInvoices,
    previousFilteredDiscounts,
    jobsites,
    supervisors,
    anomaliesList,
    categorySpendingData
  ]);

  // Chart Data: Monthly Spending & Discount Trend
  const monthlyTrendData = useMemo(() => {
    return getMonthlySpendingTrend(currentFilteredInvoices, currentFilteredDiscounts, 12);
  }, [currentFilteredInvoices, currentFilteredDiscounts]);

  // Chart Data: Jobsite Spending Distribution
  const jobsiteSpendingData = useMemo(() => {
    return getJobsiteSpendingDistribution(currentFilteredInvoices, jobsites, 8);
  }, [currentFilteredInvoices, jobsites]);

  // Key Category Highlights: Dynamic top 4 categories by spending in current view
  const topCategoriesStats = useMemo(() => {
    return categorySpendingData.slice(0, 4);
  }, [categorySpendingData]);

  const rebarCategoryStats = useMemo(() => {
    return categorySpendingData.find(c => c.category === 'İnşaat Demiri') || null;
  }, [categorySpendingData]);

  const donatiCategoryStats = useMemo(() => {
    return categorySpendingData.find(c => c.category === 'Donatı Malzemeleri') || null;
  }, [categorySpendingData]);

  const steelCategoryStats = useMemo(() => {
    return categorySpendingData.find(c => c.category === 'Çelik Malzemeler') || null;
  }, [categorySpendingData]);

  const concreteCategoryStats = useMemo(() => {
    return categorySpendingData.find(c => c.category === 'Hazır Beton, Çimento & Agrega') || null;
  }, [categorySpendingData]);

  // Continuous Single Source of Truth Mathematical Verification
  useEffect(() => {
    if (invoices && invoices.length > 0) {
      const v = verifyProcurementDataIntegrity(invoices);
      const dashDemir = v.rebarSpendDashboard;
      const ozelDemir = v.rebarSpendSpecial;
      console.log(
        `[VERİ DOĞRULAMA] Dashboard Demir: ${dashDemir.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₽ | Özel Analiz Demir: ${ozelDemir.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₽ | Eşit mi?: ${dashDemir === ozelDemir}`
      );
    }
  }, [invoices]);

  // Chart Data: Supervisor Performance Data
  const supervisorPerformanceData = useMemo(() => {
    return getSupervisorPerformanceData(currentFilteredDiscounts, supervisors);
  }, [currentFilteredDiscounts, supervisors]);

  // Top Price Difference Materials
  const topPriceGapMaterials = useMemo(() => {
    return getTopPriceDifferenceMaterials(materialComparisons, 6, filter.selectedCategory, filter.searchTerm);
  }, [materialComparisons, filter.selectedCategory, filter.searchTerm]);

  // All Combined Activity Feed for the filtered period
  const allCombinedTransactions = useMemo(() => {
    return getRecentCombinedTransactions(currentFilteredInvoices, currentFilteredDiscounts, 0);
  }, [currentFilteredInvoices, currentFilteredDiscounts]);

  // Filtered transactions for the table
  const filteredTransactions = useMemo(() => {
    return allCombinedTransactions.filter(t => {
      if (txFilterType === 'DISCOUNT' && t.type !== 'DISCOUNT') return false;
      if (txFilterType === 'INVOICE' && t.type !== 'INVOICE') return false;
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase().trim();
        const match =
          t.title.toLowerCase().includes(q) ||
          t.supplier.toLowerCase().includes(q) ||
          t.jobsiteName.toLowerCase().includes(q) ||
          t.supervisorName.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.materialSummary.toLowerCase().includes(q) ||
          (t.invoiceNumber && t.invoiceNumber.toLowerCase().includes(q)) ||
          (t.performedByPersonnelName && t.performedByPersonnelName.toLowerCase().includes(q)) ||
          (t.notes && t.notes.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [allCombinedTransactions, txFilterType, txSearch]);

  // Counts for table tabs
  const txCounts = useMemo(() => {
    const total = allCombinedTransactions.length;
    const discounts = allCombinedTransactions.filter(t => t.type === 'DISCOUNT').length;
    const invoices = allCombinedTransactions.filter(t => t.type === 'INVOICE').length;
    return { total, discounts, invoices };
  }, [allCombinedTransactions]);

  // Paginated transactions
  const totalTxPages = Math.max(1, Math.ceil(filteredTransactions.length / txPageSize));
  const paginatedTransactions = useMemo(() => {
    const start = (txPage - 1) * txPageSize;
    return filteredTransactions.slice(start, start + txPageSize);
  }, [filteredTransactions, txPage, txPageSize]);

  // Top Discount Percentage Records
  const topDiscountRecords = useMemo(() => {
    return getTopDiscountRecords(currentFilteredDiscounts, 5);
  }, [currentFilteredDiscounts]);

  // Export to Excel Handler
  const handleExportExcel = () => {
    let dateLabel = 'Son 12 Ay';
    if (filter.dateRange === 'THIS_MONTH') dateLabel = 'Bu Ay';
    else if (filter.dateRange === 'LAST_3_MONTHS') dateLabel = 'Son 3 Ay';
    else if (filter.dateRange === 'ALL_TIME') dateLabel = 'Tüm Zamanlar';
    else if (filter.dateRange === 'CUSTOM') {
      dateLabel = `${filter.customStartDate || 'Başlangıç'} - ${filter.customEndDate || 'Bitiş'}`;
    }

    const selectedJobsite = jobsites.find(j => j.id === filter.selectedJobsiteId);
    const jobsiteLabel = selectedJobsite ? selectedJobsite.name : 'Tüm Şantiyeler';
    const categoryLabel = filter.selectedCategory !== 'ALL' ? filter.selectedCategory : 'Tüm Kategoriler';

    exportDashboardToExcel({
      kpis: kpiStats,
      filterInfo: {
        dateRangeLabel: dateLabel,
        jobsiteLabel,
        categoryLabel
      },
      jobsiteSpending: jobsiteSpendingData,
      categorySpending: categorySpendingData,
      supervisorPerformance: supervisorPerformanceData,
      recentTransactions: allCombinedTransactions
    });
  };

  // Export to HTML Report Handler
  const handleExportHtml = () => {
    let dateLabel = 'Son 12 Ay';
    if (filter.dateRange === 'THIS_MONTH') dateLabel = 'Bu Ay';
    else if (filter.dateRange === 'LAST_3_MONTHS') dateLabel = 'Son 3 Ay';
    else if (filter.dateRange === 'ALL_TIME') dateLabel = 'Tüm Zamanlar';
    else if (filter.dateRange === 'CUSTOM') {
      dateLabel = `${filter.customStartDate || 'Başlangıç'} - ${filter.customEndDate || 'Bitiş'}`;
    }

    const selectedJobsite = jobsites.find(j => j.id === filter.selectedJobsiteId);
    const jobsiteLabel = selectedJobsite ? selectedJobsite.name : 'Tüm Şantiyeler';
    const categoryLabel = filter.selectedCategory !== 'ALL' ? filter.selectedCategory : 'Tüm Kategoriler';

    exportDashboardToHtml({
      kpis: kpiStats,
      filterInfo: {
        dateRangeLabel: dateLabel,
        jobsiteLabel,
        categoryLabel
      },
      jobsiteSpending: jobsiteSpendingData,
      categorySpending: categorySpendingData,
      supervisorPerformance: supervisorPerformanceData,
      recentTransactions: allCombinedTransactions
    });
  };

  // Custom Chart Tooltip Formatter
  const renderCustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-xl text-xs text-white">
          <p className="font-bold text-slate-200 mb-1.5">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} className="flex items-center justify-between space-x-3 py-0.5">
              <span className="flex items-center space-x-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-slate-300">{entry.name}:</span>
              </span>
              <span className="font-mono font-bold text-slate-100">
                {typeof entry.value === 'number' ? formatRuble(entry.value) : entry.value}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Header & Quick Actions Bar */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
                <LayoutDashboard className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  Genel Bakış ve Dashboard
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Tüm şantiyelerin satınalma harcamaları, şefler arası tasarruf performansı ve rekabet tablosu
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-2.5">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer border border-slate-200 disabled:opacity-60"
              title="Verileri Yenile"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
              <span>{isRefreshing ? 'Yenileniyor...' : 'Yenile'}</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              title="Dashboard ve Tabloları Excel Dosyası Olarak İndir"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel'e Aktar</span>
            </button>

            <button
              onClick={handleExportHtml}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              title="Dashboard ve Tabloları Yazdırılabilir/Paylaşılabilir HTML Raporu Olarak İndir"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>HTML Rapor İndir</span>
            </button>

            <button
              onClick={onOpenNewDiscountModal}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Yeni İndirim Ekle</span>
            </button>
          </div>
        </div>

        {/* Transparent Performance & Healthy Competition Banner */}
        <div className="mt-4 px-4 py-2.5 bg-gradient-to-r from-indigo-50/90 via-sky-50/70 to-emerald-50/90 border border-indigo-100/90 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-700 shadow-xs">
          <div className="flex items-center space-x-2">
            <span className="flex h-2 w-2 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-bold text-indigo-900">🎯 Şeffaf Performans & Şefler Arası Rekabet:</span>
            <span className="text-slate-600">
              Tüm satınalma şeflerinin tasarruf başarıları herkese açıktır. Rekabeti güçlendirmek ve daha yüksek indirimleri teşvik etmek amacıyla tüm veriler listelenmektedir.
            </span>
          </div>
          {user && (user.role === 'supervisor' || user.role === 'personnel') && (
            <div className="text-[11px] font-semibold text-indigo-700 bg-white px-2.5 py-1 rounded-lg border border-indigo-200/80 shrink-0 shadow-2xs">
              Aktif Oturum: <strong>{user.displayName || user.username}</strong> ({user.role === 'supervisor' ? 'Satınalma Şefi' : 'Satınalma Personeli'})
            </div>
          )}
        </div>

        {/* Filters Row */}
        <div className="mt-5 pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Search Inputs */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tedarikçi, şantiye, şef veya malzeme ara..."
                  value={filter.searchTerm || ''}
                  onChange={(e) => setFilter(prev => ({ ...prev, searchTerm: e.target.value }))}
                  className="w-full pl-8 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                />
                {filter.searchTerm && (
                  <button
                    onClick={() => setFilter(prev => ({ ...prev, searchTerm: '' }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Dedicated Fatura No Filter */}
              <div className="relative w-full sm:w-44">
                <FileText className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Fatura No..."
                  value={filter.invoiceNo || ''}
                  onChange={(e) => setFilter(prev => ({ ...prev, invoiceNo: e.target.value }))}
                  className="w-full pl-8 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-mono font-bold"
                />
                {filter.invoiceNo && (
                  <button
                    onClick={() => setFilter(prev => ({ ...prev, invoiceNo: '' }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Date Range Preset Buttons */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80 overflow-x-auto no-scrollbar shrink-0">
              {(['THIS_MONTH', 'LAST_3_MONTHS', 'LAST_12_MONTHS', 'ALL_TIME', 'CUSTOM'] as DateRangePreset[]).map((preset) => {
                const isActive = filter.dateRange === preset;
                const labels: Record<DateRangePreset, string> = {
                  THIS_MONTH: 'Bu Ay',
                  LAST_3_MONTHS: 'Son 3 Ay',
                  LAST_12_MONTHS: 'Son 12 Ay',
                  ALL_TIME: 'Tümü',
                  CUSTOM: 'Özel'
                };
                return (
                  <button
                    key={preset}
                    onClick={() => setFilter(prev => ({ ...prev, dateRange: preset }))}
                    className={`flex-1 min-w-[55px] px-2 py-1.5 text-xs font-semibold rounded-lg transition-all text-center cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'bg-white text-indigo-700 shadow-xs ring-1 ring-slate-200'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    {labels[preset]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dropdown Filters Row */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            {/* Category Filter */}
            <SearchableFilterDropdown
              label="Kategori"
              selectedKey={filter.selectedCategory === 'ALL' ? 'all' : filter.selectedCategory}
              options={[
                { key: 'all', label: 'Tüm Kategoriler', count: categories.length },
                ...categories.map((cat) => ({
                  key: cat,
                  label: cat
                }))
              ]}
              onSelect={(key) => setFilter(prev => ({ ...prev, selectedCategory: key === 'all' ? 'ALL' : key }))}
              placeholder="Kategori ara..."
            />

            {/* Jobsite Filter */}
            <SearchableFilterDropdown
              label="Şantiye"
              selectedKey={filter.selectedJobsiteId === 'ALL' ? 'all' : filter.selectedJobsiteId}
              options={[
                { key: 'all', label: 'Tüm Şantiyeler', count: jobsites.length },
                ...jobsites.map((j) => ({
                  key: j.id,
                  label: `${j.name} (${j.code})`,
                  subtext: j.location
                }))
              ]}
              onSelect={(key) => setFilter(prev => ({ ...prev, selectedJobsiteId: key === 'all' ? 'ALL' : key }))}
              placeholder="Şantiye ara..."
            />

            {/* Tedarikçi Filter */}
            <SearchableFilterDropdown
              label="Tedarikçi"
              selectedKey={filter.selectedVendor === 'ALL' || !filter.selectedVendor ? 'all' : filter.selectedVendor}
              options={[
                { key: 'all', label: 'Tüm Tedarikçiler', count: canonicalVendors.length },
                ...canonicalVendors.map((v) => ({
                  key: v.name,
                  label: v.name,
                  count: v.count
                }))
              ]}
              onSelect={(key) => setFilter(prev => ({ ...prev, selectedVendor: key === 'all' ? 'ALL' : key }))}
              placeholder="Tedarikçi ara..."
            />

            {/* Supervisor Filter */}
            <SearchableFilterDropdown
              label="Şef"
              selectedKey={filter.selectedSupervisorId === 'ALL' || !filter.selectedSupervisorId ? 'all' : filter.selectedSupervisorId}
              options={[
                { key: 'all', label: 'Tüm Şefler', count: supervisors.length },
                ...supervisors.map((s) => ({
                  key: s.id,
                  label: s.name,
                  subtext: s.email
                }))
              ]}
              onSelect={(key) => setFilter(prev => ({ ...prev, selectedSupervisorId: key === 'all' ? 'ALL' : key }))}
              placeholder="Şef ara..."
            />

            {/* Reset Button */}
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs ml-auto"
                title="Tüm filtreleri sıfırla"
              >
                <X className="w-3.5 h-3.5 text-amber-700" />
                <span>Filtreleri Temizle</span>
              </button>
            )}
          </div>
        </div>

        {/* Custom Date Pickers (Shown only when 'CUSTOM' is selected) */}
        {filter.dateRange === 'CUSTOM' && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center flex-wrap gap-3 text-xs bg-slate-50 p-3 rounded-xl">
            <span className="font-semibold text-slate-700 flex items-center space-x-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>Özel Tarih Aralığı:</span>
            </span>
            <div className="flex items-center space-x-2">
              <input
                type="date"
                value={filter.customStartDate || ''}
                onChange={(e) => setFilter(prev => ({ ...prev, customStartDate: e.target.value }))}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800"
              />
              <span className="text-slate-400">-</span>
              <input
                type="date"
                value={filter.customEndDate || ''}
                onChange={(e) => setFilter(prev => ({ ...prev, customEndDate: e.target.value }))}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800"
              />
            </div>
          </div>
        )}

        {/* Active Filters Summary Strip */}
        {isAnyFilterActive && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-slate-500 font-medium text-[11px] flex items-center gap-1">
                <Filter className="w-3 h-3 text-indigo-500" />
                Aktif Filtreler:
              </span>
              {filter.selectedCategory !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <span>Kategori: {filter.selectedCategory}</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, selectedCategory: 'ALL' }))}
                    className="hover:text-indigo-900 ml-0.5"
                    title="Kategori filtresini kaldır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filter.selectedJobsiteId !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <span>Şantiye: {jobsites.find(j => j.id === filter.selectedJobsiteId)?.name || filter.selectedJobsiteId}</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, selectedJobsiteId: 'ALL' }))}
                    className="hover:text-blue-900 ml-0.5"
                    title="Şantiye filtresini kaldır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filter.selectedVendor && filter.selectedVendor !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span>Tedarikçi: {filter.selectedVendor}</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, selectedVendor: 'ALL' }))}
                    className="hover:text-emerald-900 ml-0.5"
                    title="Tedarikçi filtresini kaldır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filter.selectedSupervisorId && filter.selectedSupervisorId !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <span>Şef: {supervisors.find(s => s.id === filter.selectedSupervisorId)?.name || filter.selectedSupervisorId}</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, selectedSupervisorId: 'ALL' }))}
                    className="hover:text-amber-900 ml-0.5"
                    title="Şef filtresini kaldır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filter.invoiceNo && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200 font-mono">
                  <span>Fatura No: {filter.invoiceNo}</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, invoiceNo: '' }))}
                    className="hover:text-cyan-900 ml-0.5"
                    title="Fatura no filtresini kaldır"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {filter.searchTerm && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                  <span>Arama: &quot;{filter.searchTerm}&quot;</span>
                  <button
                    type="button"
                    onClick={() => setFilter(prev => ({ ...prev, searchTerm: '' }))}
                    className="hover:text-slate-900 ml-0.5"
                    title="Aramayı temizle"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <FilterX className="w-3 h-3" />
              Tüm Filtreleri Temizle
            </button>
          </div>
        )}
      </div>

      {/* Sub-view switcher: Genel Bakış vs Özel Malzeme Analizi */}
      <div className="bg-white rounded-2xl p-2.5 border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveDashboardView('OVERVIEW')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
              activeDashboardView === 'OVERVIEW'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Genel Bakış, Şantiye Bütçeleri & Şef Rekabeti</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveDashboardView('SPECIAL_MATERIALS')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer ${
              activeDashboardView === 'SPECIAL_MATERIALS'
                ? 'bg-amber-500 text-slate-950 shadow-xs ring-2 ring-amber-300'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Boxes className="w-4 h-4 text-amber-600" />
            <span>🧱 Özel Malzeme Analizi (Demir, Gazblok, İzolasyon)</span>
            <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-amber-100 text-amber-900">
              YENİ
            </span>
          </button>
        </div>

        <div className="text-[11px] text-slate-500 px-2">
          {activeDashboardView === 'OVERVIEW' ? (
            <span>Tüm şantiyelerin bütçe kullanımı ve tasarruf metrikleri</span>
          ) : (
            <span className="text-amber-700 font-medium">İnşaat demiri, gazbeton ve yalıtım kalemleri detaylı dökümü</span>
          )}
        </div>
      </div>

      {activeDashboardView === 'SPECIAL_MATERIALS' ? (
        <SpecialMaterialAnalytics
          invoices={effectiveInvoices}
          jobsites={jobsites}
          onNavigateToInvoiceDrive={() => onNavigateToTab('invoice-drive')}
          onOpenInvoiceDetail={(inv) => {
            setSelectedTx({
              id: inv.id,
              type: 'INVOICE',
              raw: inv,
              date: inv.date || inv.created_at || '',
              supplier: inv.supplier || 'Tedarikçi Belirtilmemiş',
              materialName: (inv.items && inv.items[0]?.materialName) || 'Fatura Kalemi',
              supervisorName: inv.uploadedBySupervisorName || 'Yetkili Şef',
              jobsiteName: inv.jobsiteName || jobsites.find(j => j.id === inv.jobsiteId)?.name || 'Şantiye',
              amount: inv.totalAmount || 0,
              discountAmount: 0,
              discountPercentage: 0,
              fileUrl: inv.fileUrl
            });
          }}
        />
      ) : (
        <>
      {/* 🚀 AI Decision Engine & Real-Time Intelligence Control Strip */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-4 sm:p-5 border border-indigo-500/20 shadow-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-gradient-to-l from-indigo-500/10 to-transparent pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          {/* Left: AI Status & Live Pulse */}
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-1.5">
                  <span>Yapay Zeka Karar & Canlı Senkronizasyon Masası</span>
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Canlı Entegre
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  23 Kategori %100 Çözümlendi
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Tüm faturalar, şef pazarlıkları, şantiye harcamaları ve malzeme fiyatları anlık olarak analiz edilip sekmeler arası senkronize edilmektedir.
              </p>
            </div>
          </div>

          {/* Right: Quick Action Hub */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => onNavigateToTab('material-compare')}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-all flex items-center gap-1.5 border border-white/10 cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              <span>Fiyat Farkları ({materialComparisons.length})</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateToTab('anomalies')}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-all flex items-center gap-1.5 border border-white/10 cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>Anomali Radarı ({kpiStats.anomaliesCount})</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateToTab('performance')}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-white" />
              <span>Şef Masası</span>
            </button>

            {onRefreshData && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                title="Tüm Sekmeleri ve Verileri Yeniden Eşitle"
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* 🧠 İnsandan Üstün Yapay Zeka Satınalma Beyni (Canlı Anomali Radarı & Tasarruf Masası) */}
        {superIntelligentInsights.totalCount > 0 && (
          <div className="mt-4 pt-4 border-t border-indigo-500/20 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex h-2 w-2 rounded-full bg-rose-400 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-200">
                  {language === 'RU' ? 'Супер-Интеллект: Радар Скрытых Аномалий и Экономии' : 'Süper Zeka: Gizli Anomali Radarı & Tasarruf Fırsatları'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500/30 text-rose-300 border border-rose-500/40">
                  {superIntelligentInsights.totalCount} {language === 'RU' ? 'Аномалий' : 'Aktif Tespit'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-300">
                  {language === 'RU' ? 'Потенциал экономии / возврата:' : 'Toplam Tasarruf / İade Fırsatı:'}
                </span>
                <span className="font-mono font-black text-emerald-400 bg-emerald-500/20 px-2.5 py-0.5 rounded-lg border border-emerald-500/30 text-sm">
                  {formatRuble(superIntelligentInsights.totalPotentialSavings)}
                </span>
              </div>
            </div>

            {/* 4 Engine Live Summary Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
              {/* Engine 1: Çapraz Şantiye Fiyat Arbitrajı */}
              <div
                onClick={() => onNavigateToTab('anomalies')}
                className="bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-indigo-400/20 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>🔄</span>
                    <span>{language === 'RU' ? 'Кросс-Объектный Арбитраж' : 'Çapraz Şantiye Arbitrajı'}</span>
                  </span>
                  <span className="font-mono font-bold text-xs bg-indigo-500/30 text-indigo-200 px-1.5 py-0.5 rounded">
                    {superIntelligentInsights.arbitrageCount}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 flex justify-between items-center mt-1.5">
                  <span className="text-slate-400">{language === 'RU' ? 'Разница:' : 'Tasarruf:'}</span>
                  <span className="font-mono font-bold text-emerald-400">{formatRuble(superIntelligentInsights.arbitrageSavings)}</span>
                </div>
              </div>

              {/* Engine 2: Eşik Atlatma & Parçalı Alım */}
              <div
                onClick={() => onNavigateToTab('anomalies')}
                className="bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-purple-400/20 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-purple-300 flex items-center gap-1.5">
                    <span>✂️</span>
                    <span>{language === 'RU' ? 'Дробление (Smurfing)' : 'Eşik Atlatma (Smurfing)'}</span>
                  </span>
                  <span className="font-mono font-bold text-xs bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded">
                    {superIntelligentInsights.smurfingCount}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 flex justify-between items-center mt-1.5">
                  <span className="text-slate-400">{language === 'RU' ? 'Объем 72ч:' : '72s Hacim:'}</span>
                  <span className="font-mono font-bold text-amber-300">{formatRuble(superIntelligentInsights.smurfingImpact)}</span>
                </div>
              </div>

              {/* Engine 3: Sinsi Fiyat Artışı */}
              <div
                onClick={() => onNavigateToTab('anomalies')}
                className="bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-amber-400/20 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <span>📈</span>
                    <span>{language === 'RU' ? 'Скрытый Рост Цен' : 'Sinsi Fiyat Artışı (Creep)'}</span>
                  </span>
                  <span className="font-mono font-bold text-xs bg-amber-500/30 text-amber-200 px-1.5 py-0.5 rounded">
                    {superIntelligentInsights.creepCount}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 flex justify-between items-center mt-1.5">
                  <span className="text-slate-400">{language === 'RU' ? 'Риск переплаты:' : 'Fiyat Farkı:'}</span>
                  <span className="font-mono font-bold text-rose-300">{formatRuble(superIntelligentInsights.creepImpact)}</span>
                </div>
              </div>

              {/* Engine 4: Sepet Küçültme & Fiktif İndirim */}
              <div
                onClick={() => onNavigateToTab('anomalies')}
                className="bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-rose-400/20 cursor-pointer transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-rose-300 flex items-center gap-1.5">
                    <span>🧺</span>
                    <span>{language === 'RU' ? 'Мнимые Скидки' : 'Sepet Küçültme (Fiktif)'}</span>
                  </span>
                  <span className="font-mono font-bold text-xs bg-rose-500/30 text-rose-200 px-1.5 py-0.5 rounded">
                    {superIntelligentInsights.shrinkageCount}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 flex justify-between items-center mt-1.5">
                  <span className="text-slate-400">{language === 'RU' ? 'Иллюзия:' : 'Fiktif İndirim:'}</span>
                  <span className="font-mono font-bold text-rose-400">{formatRuble(superIntelligentInsights.shrinkageImpact)}</span>
                </div>
              </div>
            </div>

            {/* Top recommendation preview banner */}
            {superIntelligentInsights.topRecommendations.length > 0 && (
              <div className="bg-indigo-950/70 border border-indigo-400/30 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 bg-rose-500/20 text-rose-300 rounded-lg shrink-0 mt-0.5">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-white flex items-center gap-2">
                      <span>{superIntelligentInsights.topRecommendations[0].title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                        {superIntelligentInsights.topRecommendations[0].severity}
                      </span>
                    </div>
                    <p className="text-slate-300 text-[11px] mt-0.5 line-clamp-1">
                      {superIntelligentInsights.topRecommendations[0].recommendation}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigateToTab('anomalies')}
                  className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 self-start md:self-auto cursor-pointer transition-colors shadow-xs"
                >
                  <span>{language === 'RU' ? 'Все Рекомендации' : 'Tüm Tavsiyeleri İncele'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Top KPI Cards Grid (7 Cards) - Modern Balanced Layout */}
      <div className="space-y-4">
        {/* Row 1: Temel Finansal & İşlem Hacmi (4 Kart) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Toplam Satınalma Harcaması */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-indigo-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-indigo-600 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Toplam Harcama</span>
              <div className="p-2.5 bg-indigo-50/80 text-indigo-600 rounded-xl group-hover:scale-110 transition-transform">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {formatRuble(kpiStats.totalSpend)}
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                {kpiStats.spendChangePercentage >= 0 ? (
                  <span className="flex items-center text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-md text-[11px]">
                    <ArrowUpRight className="w-3 h-3 mr-0.5 text-indigo-600" />
                    +%{kpiStats.spendChangePercentage}
                  </span>
                ) : (
                  <span className="flex items-center text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md text-[11px]">
                    <ArrowDownRight className="w-3 h-3 mr-0.5 text-emerald-600" />
                    %{kpiStats.spendChangePercentage}
                  </span>
                )}
                <span className="text-slate-400 text-[11px]" title="Yalnızca İndirim Girişi, 1M+ ₽ TDF ve AI Fatura Okuma modüllerinden girilen faturalar dahildir (Prizma arşiv referansları hariç)">GES modülleri (Prizma hariç)</span>
              </div>
            </div>
          </div>

          {/* KPI 2: Toplam Kazanılan İndirim */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-emerald-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Kazanılan İndirim</span>
              <div className="p-2.5 bg-emerald-50/80 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-emerald-600 font-mono tracking-tight">
                {formatRuble(kpiStats.totalDiscount)}
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                <span className={`flex items-center font-bold px-2 py-0.5 rounded-md text-[11px] ${
                  kpiStats.discountChangePercentage >= 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-700'
                }`}>
                  {kpiStats.discountChangePercentage >= 0 ? (
                    <ArrowUpRight className="w-3 h-3 mr-0.5" />
                  ) : (
                    <ArrowDownRight className="w-3 h-3 mr-0.5" />
                  )}
                  {kpiStats.discountChangePercentage >= 0 ? '+' : ''}%{kpiStats.discountChangePercentage}
                </span>
                <span className="text-slate-400 text-[11px]">tasarruf artışı</span>
              </div>
            </div>
          </div>

          {/* KPI 3: Ortalama İndirim Oranı */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-amber-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Ort. İskonto Oranı</span>
              <div className="p-2.5 bg-amber-50/80 text-amber-600 rounded-xl group-hover:scale-110 transition-transform">
                <Percent className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-amber-600 font-mono tracking-tight">
                %{kpiStats.avgDiscountRate}
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                <span className={`flex items-center font-bold px-2 py-0.5 rounded-md text-[11px] ${
                  kpiStats.discountRateChangePercentage >= 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-700'
                }`}>
                  {kpiStats.discountRateChangePercentage >= 0 ? '+' : ''}%{kpiStats.discountRateChangePercentage} pt
                </span>
                <span className="text-slate-400 text-[11px]">pazarlık marjı</span>
              </div>
            </div>
          </div>

          {/* KPI 4: Toplam İşlem Sayısı */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-slate-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-slate-600 to-slate-800 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Toplam İşlem</span>
              <div className="p-2.5 bg-slate-100 text-slate-700 rounded-xl group-hover:scale-110 transition-transform">
                <FileText className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {kpiStats.totalTransactionsCount}
              </div>
              <div className="flex items-center space-x-2 mt-2.5 text-xs">
                <span className="text-slate-700 font-mono font-bold text-[11px]">{kpiStats.invoicesCount} Fatura</span>
                <span className="text-slate-300">•</span>
                <span className="text-indigo-600 font-mono font-bold text-[11px]">{kpiStats.discountsCount} İndirim</span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: Saha Operasyonları & Risk İzleme (3 Kart) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* KPI 5: Aktif Şantiyeler */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-sky-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aktif Şantiyeler</span>
              <div className="p-2.5 bg-sky-50/80 text-sky-600 rounded-xl group-hover:scale-110 transition-transform">
                <Building2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {kpiStats.activeJobsitesCount} <span className="text-xs text-slate-400 font-sans font-normal">/ {jobsites.length} Proje</span>
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                <span className="text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md font-bold text-[11px]">
                  {jobsites.length > 0 ? ((kpiStats.activeJobsitesCount / jobsites.length) * 100).toFixed(0) : 0}% aktif
                </span>
                <span className="text-slate-400 text-[11px]">şantiye operasyonu</span>
              </div>
            </div>
          </div>

          {/* KPI 6: Satınalma Şefleri */}
          <div className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-violet-400 transition-all duration-200">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 to-purple-500 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Satınalma Şefleri</span>
              <div className="p-2.5 bg-violet-50/80 text-violet-600 rounded-xl group-hover:scale-110 transition-transform">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 font-mono tracking-tight">
                {kpiStats.supervisorsCount} <span className="text-xs text-slate-400 font-sans font-normal">Yetkili</span>
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                <span className="text-violet-700 bg-violet-50 px-2 py-0.5 rounded-md font-bold text-[11px]">
                  {supervisors.length} aktif kadro
                </span>
                <span className="text-slate-400 text-[11px]">pazarlık sorumlusu</span>
              </div>
            </div>
          </div>

          {/* KPI 7: Tespit Edilen Anomaliler */}
          <div 
            onClick={() => onNavigateToTab('anomalies')}
            className="bg-white rounded-2xl p-4.5 border border-slate-200/90 shadow-xs relative overflow-hidden group hover:shadow-md hover:border-rose-400 transition-all duration-200 cursor-pointer"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 to-red-500 opacity-80" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fiyat / Zam Anomalileri</span>
              <div className={`p-2.5 rounded-xl group-hover:scale-110 transition-transform ${kpiStats.anomaliesCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                <ShieldAlert className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${kpiStats.anomaliesCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                {kpiStats.anomaliesCount} <span className="text-xs text-slate-400 font-sans font-normal">Uyarı</span>
              </div>
              <div className="flex items-center space-x-1.5 mt-2.5 text-xs">
                <span className={`font-bold px-2 py-0.5 rounded-md text-[11px] ${
                  kpiStats.anomaliesCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {kpiStats.anomaliesCount > 0 ? 'Detayları İncele →' : 'Tüm fiyatlar stabil'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Şantiye Genel Harcamaları & Hangi Malzemeye Ne Kadar Harcandı Detay İstihbarat Masası */}
      <SmartDashboardInsights
        invoices={effectiveInvoices}
        jobsites={jobsites}
        selectedJobsiteId={filter.selectedJobsiteId}
        onNavigateToTab={onNavigateToTab}
        onApplyJobsiteFilter={(jobsiteId) => {
          setFilter(prev => ({
            ...prev,
            selectedJobsiteId: prev.selectedJobsiteId === jobsiteId ? 'ALL' : jobsiteId
          }));
        }}
      />

      {/* 3. Main Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chart 1: Monthly Trend (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Aylık Satınalma ve İndirim Trendi</h2>
              <p className="text-xs text-slate-500">Son 12 ayın toplam satınalma hacmi ve elde edilen tasarruf grafiği</p>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-3 rounded-sm bg-indigo-600 inline-block" />
                <span className="text-slate-600">Harcama Tutarı</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
                <span className="text-slate-600">Kazanılan İndirim</span>
              </div>
            </div>
          </div>

          <div className="w-full h-72 sm:h-80">
            {monthlyTrendData.some(d => d.spend > 0 || d.discount > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyTrendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="discountGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <Tooltip content={renderCustomTooltip} />
                  <Area type="monotone" dataKey="spend" name="Harcama" stroke="#4f46e5" strokeWidth={2.5} fillOpacity={1} fill="url(#spendGradient)" />
                  <Area type="monotone" dataKey="discount" name="İndirim" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#discountGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                <FileText className="w-8 h-8 mb-2 text-slate-300" />
                <span>Bu dönem için grafik verisi bulunamadı.</span>
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Jobsite Spending Distribution (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">Şantiye Harcama Dağılımı</h2>
                <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded-md">
                  {jobsiteSpendingData.length} Şantiye
                </span>
              </div>
              <p className="text-xs text-slate-500">Şantiyelere göre harcama hacmi ve yüzdeleri</p>
            </div>

            {/* View Mode Toggle */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setJobsiteViewMode('pie')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  jobsiteViewMode === 'pie'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Pasta Grafik Görünümü"
              >
                Pasta
              </button>
              <button
                type="button"
                onClick={() => setJobsiteViewMode('bar')}
                className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                  jobsiteViewMode === 'bar'
                    ? 'bg-white text-indigo-700 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Liste / Çubuk Görünümü"
              >
                Detay
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-between">
            {jobsiteViewMode === 'pie' ? (
              <>
                <div className="w-full h-48">
                  {jobsiteSpendingData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={jobsiteSpendingData}
                          dataKey="spend"
                          nameKey="jobsiteName"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={3}
                        >
                          {jobsiteSpendingData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) => [formatRuble(Number(val)), 'Harcama']}
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px', color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                      Şantiye harcama verisi yok
                    </div>
                  )}
                </div>

                {/* Compact Legend List with 1-click filter */}
                <div className="space-y-1.5 mt-2 pt-3 border-t border-slate-100 max-h-40 overflow-y-auto pr-1">
                  {jobsiteSpendingData.map((item, idx) => {
                    const isSelected = filter.selectedJobsiteId === item.jobsiteId;
                    return (
                      <button
                        key={item.jobsiteId}
                        type="button"
                        onClick={() => {
                          setFilter(prev => ({
                            ...prev,
                            selectedJobsiteId: isSelected ? 'ALL' : item.jobsiteId
                          }));
                        }}
                        className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors text-left cursor-pointer ${
                          isSelected ? 'bg-indigo-50 text-indigo-900 font-semibold' : 'hover:bg-slate-50'
                        }`}
                        title="Bu şantiyeye göre filtrele"
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                          <span className="text-slate-700 font-medium truncate" title={item.jobsiteName}>{item.jobsiteName}</span>
                          {item.invoiceCount && (
                            <span className="text-[10px] text-slate-400">({item.invoiceCount} fat.)</span>
                          )}
                        </div>
                        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                          <span className="font-mono font-bold text-slate-900">{formatRuble(item.spend)}</span>
                          <span className="text-slate-400 text-[10px]">%{item.percentage}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Bar & Detailed Progress view */
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {jobsiteSpendingData.length > 0 ? (
                  jobsiteSpendingData.map((item, idx) => {
                    const isSelected = filter.selectedJobsiteId === item.jobsiteId;
                    return (
                      <div
                        key={item.jobsiteId}
                        className={`p-2.5 rounded-xl border transition-all ${
                          isSelected
                            ? 'bg-indigo-50/70 border-indigo-200'
                            : 'bg-slate-50/60 border-slate-100 hover:border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <div className="flex items-center space-x-2 truncate">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                            />
                            <span className="font-bold text-slate-800 truncate" title={item.jobsiteName}>
                              {item.jobsiteName}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-slate-900">
                              {formatRuble(item.spend)}
                            </span>
                            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                              %{item.percentage}
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(item.percentage, 100)}%`,
                              backgroundColor: CHART_COLORS[idx % CHART_COLORS.length]
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5">
                          <span>{item.invoiceCount || 0} adet kayıtlı fatura</span>
                          <button
                            type="button"
                            onClick={() => {
                              setFilter(prev => ({
                                ...prev,
                                selectedJobsiteId: isSelected ? 'ALL' : item.jobsiteId
                              }));
                            }}
                            className={`font-semibold cursor-pointer ${
                              isSelected ? 'text-indigo-700 underline' : 'text-slate-600 hover:text-indigo-600'
                            }`}
                          >
                            {isSelected ? '✓ Filtre Aktif' : 'Filtrele →'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    Şantiye harcama verisi bulunamadı.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chart 3: Category Spending Distribution & Dedicated Raw Materials Intelligence (12 cols) */}
        <div className="lg:col-span-12 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          {/* Header with Title and Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">Kategori Bazlı Harcama Dağılımı</h2>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {categorySpendingData.length} Kategori
                </span>
                {filter.selectedCategory !== 'ALL' && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                    Filtre: {filter.selectedCategory}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Ayrıştırılmış inşaat demiri (A500C), donatı aksesuarları, çelik mamulleri ve şantiye sarfiyat analizi
              </p>
            </div>

            {/* View Mode Buttons */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setCategoryViewMode('hybrid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  categoryViewMode === 'hybrid'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Grafik + Sıralama
              </button>
              <button
                type="button"
                onClick={() => setCategoryViewMode('bars')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  categoryViewMode === 'bars'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Çubuk Grafik
              </button>
              <button
                type="button"
                onClick={() => setCategoryViewMode('donut')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  categoryViewMode === 'donut'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pasta Dağılım
              </button>
              <button
                type="button"
                onClick={() => setCategoryViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
                  categoryViewMode === 'table'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Matris</span>
              </button>
            </div>
          </div>

          {/* Key Strategic Categories Telemetry Strip (Dynamic Top 4 Active Categories) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            {topCategoriesStats.map((cat, idx) => {
              const theme = getCategoryColorTheme(idx);
              const isSelected = filter.selectedCategory === cat.category;
              const icon = getCategoryIcon(cat.category);
              return (
                <div
                  key={cat.category}
                  onClick={() => setFilter(prev => ({
                    ...prev,
                    selectedCategory: isSelected ? 'ALL' : cat.category
                  }))}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden group ${
                    isSelected
                      ? theme.bgActive
                      : theme.bgNormal
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold ${theme.textTitle} flex items-center gap-1.5 truncate`}>
                      <span>{icon}</span>
                      <span className="truncate">{cat.category}</span>
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${theme.badge} shrink-0`}>
                      %{cat.percentage}
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className={`text-lg font-black ${theme.textSpend} font-mono tracking-tight`}>
                      {formatRuble(cat.spend)}
                    </div>
                    <div className={`flex items-center justify-between text-[11px] ${theme.textSub} mt-1`}>
                      <span>{cat.itemCount} Kalem Alım</span>
                      <span className={`font-semibold ${theme.textAction} group-hover:underline`}>
                        {isSelected ? '✓ Filtre Aktif' : 'Filtrele →'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pb-2 mb-4 text-xs">
            <button
              type="button"
              onClick={() => setFilter(prev => ({ ...prev, selectedCategory: 'ALL' }))}
              className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filter.selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tüm Kategoriler ({categorySpendingData.length})
            </button>
            {(showAllCategoryPills ? categorySpendingData : categorySpendingData.slice(0, 10)).map((catItem) => {
              const isSelected = filter.selectedCategory === catItem.category;
              const icon = getCategoryIcon(catItem.category);
              return (
                <button
                  key={catItem.category}
                  type="button"
                  onClick={() => setFilter(prev => ({
                    ...prev,
                    selectedCategory: isSelected ? 'ALL' : catItem.category
                  }))}
                  className={`px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all flex items-center space-x-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span className="text-xs">{icon}</span>
                  <span>{catItem.category}</span>
                  <span className={`text-[10px] font-mono px-1 rounded ${
                    isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-200/80 text-slate-600'
                  }`}>
                    %{catItem.percentage}
                  </span>
                </button>
              );
            })}
            {categorySpendingData.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAllCategoryPills(prev => !prev)}
                className="px-2.5 py-1.5 rounded-lg text-indigo-700 hover:bg-indigo-50 font-bold border border-indigo-200/80 transition-all cursor-pointer flex items-center space-x-1"
              >
                <span>{showAllCategoryPills ? 'Daha Az Göster ↑' : `Tümünü Gör (+${categorySpendingData.length - 10}) ↓`}</span>
              </button>
            )}
          </div>

          {/* View Mode: Hybrid (Chart + Leaderboard Cards) */}
          {categoryViewMode === 'hybrid' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              {/* Left: Bar Chart (7 cols) */}
              <div className="lg:col-span-7 h-72">
                {categorySpendingData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={categorySpendingData.slice(0, 10)}
                      margin={{ top: 10, right: 10, left: -10, bottom: 35 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="category"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: '#e2e8f0' }}
                        tickLine={false}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                      />
                      <Tooltip
                        formatter={(val: any) => [formatRuble(Number(val)), 'Toplam Harcama']}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                      />
                      <Bar dataKey="spend" name="Harcama" radius={[6, 6, 0, 0]}>
                        {categorySpendingData.slice(0, 10).map((_, index) => (
                          <Cell key={`cat-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    Kategori harcama verisi yok
                  </div>
                )}
              </div>

              {/* Right: Ranked List with Progress Bars & Quick Filters (5 cols) */}
              <div className="lg:col-span-5 flex flex-col space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {categorySpendingData.slice(0, 8).map((item, idx) => {
                  const isSelected = filter.selectedCategory === item.category;
                  return (
                    <div
                      key={item.category}
                      onClick={() => setFilter(prev => ({
                        ...prev,
                        selectedCategory: isSelected ? 'ALL' : item.category
                      }))}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-indigo-50/80 border-indigo-300 ring-1 ring-indigo-300'
                          : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/80'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <span className="text-xs font-bold text-slate-800 truncate" title={item.category}>
                            {item.category}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          <span className="text-xs font-mono font-bold text-slate-900">
                            {formatRuble(item.spend)}
                          </span>
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
                            %{item.percentage}
                          </span>
                        </div>
                      </div>

                      {/* Mini Bar */}
                      <div className="w-full bg-slate-200/70 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, Math.max(2, item.percentage))}%`,
                            backgroundColor: CHART_COLORS[idx % CHART_COLORS.length]
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* View Mode: Full Width Bars */}
          {categoryViewMode === 'bars' && (
            <div className="w-full h-72">
              {categorySpendingData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categorySpendingData.slice(0, 12)}
                    margin={{ top: 10, right: 10, left: -10, bottom: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis
                      dataKey="category"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tickLine={false}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip
                      formatter={(val: any) => [formatRuble(Number(val)), 'Toplam Harcama']}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#fff'
                      }}
                    />
                    <Bar dataKey="spend" name="Harcama" radius={[6, 6, 0, 0]}>
                      {categorySpendingData.slice(0, 12).map((_, index) => (
                        <Cell key={`cat-bar-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                  Kategori harcama verisi yok
                </div>
              )}
            </div>
          )}

          {/* View Mode: Donut Chart */}
          {categoryViewMode === 'donut' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-6 h-72">
                {categorySpendingData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categorySpendingData.slice(0, 8)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
                        paddingAngle={3}
                        dataKey="spend"
                        nameKey="category"
                      >
                        {categorySpendingData.slice(0, 8).map((_, index) => (
                          <Cell key={`donut-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [formatRuble(Number(val)), 'Harcama']}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    Kategori harcama verisi yok
                  </div>
                )}
              </div>

              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {categorySpendingData.slice(0, 10).map((item, idx) => (
                  <div
                    key={item.category}
                    onClick={() => setFilter(prev => ({
                      ...prev,
                      selectedCategory: prev.selectedCategory === item.category ? 'ALL' : item.category
                    }))}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200/80 hover:bg-slate-100 transition-all cursor-pointer flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                      />
                      <span className="font-semibold text-slate-800 truncate" title={item.category}>
                        {item.category}
                      </span>
                    </div>
                    <span className="font-mono font-bold text-slate-700 ml-2 shrink-0">
                      %{item.percentage}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View Mode: Detailed Matrix Table */}
          {categoryViewMode === 'table' && (
            <div className="w-full overflow-x-auto max-h-80 border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Kategori</th>
                    <th className="py-2.5 px-3 text-right">Toplam Harcama (₽)</th>
                    <th className="py-2.5 px-3 text-center">Harcama Payı</th>
                    <th className="py-2.5 px-3 text-center">Kalem Sayısı</th>
                    <th className="py-2.5 px-3 text-right">Kalem Başına Ort.</th>
                    <th className="py-2.5 px-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categorySpendingData.map((cat, idx) => {
                    const isSelected = filter.selectedCategory === cat.category;
                    const avgPerItem = cat.itemCount > 0 ? cat.spend / cat.itemCount : 0;
                    return (
                      <tr
                        key={cat.category}
                        className={`hover:bg-slate-50 transition-colors ${
                          isSelected ? 'bg-indigo-50/70 font-semibold' : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3 font-semibold text-slate-800 flex items-center space-x-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <span>{cat.category}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {formatRuble(cat.spend)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px]">
                            %{cat.percentage}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-mono text-slate-600">
                          {cat.itemCount}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {formatRuble(avgPerItem)}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setFilter(prev => ({
                              ...prev,
                              selectedCategory: isSelected ? 'ALL' : cat.category
                            }))}
                            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {isSelected ? 'Seçili ✓' : 'Filtrele'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Multi-Dimensional Gamified Supervisor Competition Leaderboard (12 cols) */}
        <div className="lg:col-span-12">
          <GamifiedSupervisorLeaderboard
            discounts={currentFilteredDiscounts}
            supervisors={supervisors}
            personnel={personnel}
            invoices={currentFilteredInvoices}
            onNavigateToTab={onNavigateToTab}
          />
        </div>
      </div>

      {/* 4. Secondary Analytics: Price Difference Materials & Jobsite Budget Utilization */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Price Difference Materials (6 cols) */}
        <div className="lg:col-span-6 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <span>Fiyat Farkı En Yüksek Malzemeler</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold border border-rose-100">
                  Makas Analizi
                </span>
              </h2>
              <p className="text-xs text-slate-500">Şantiyeler arasında en ucuz ve en pahalı alım farkı</p>
            </div>
            <button
              onClick={() => onNavigateToTab('material-compare')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1 cursor-pointer"
            >
              <span>Tümünü Gör</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto">
            {topPriceGapMaterials.length > 0 ? (
              topPriceGapMaterials.map((mat, idx) => (
                <div
                  key={idx}
                  onClick={() => onNavigateToTab('material-compare')}
                  className="p-3 bg-slate-50 hover:bg-indigo-50/40 rounded-xl border border-slate-200/70 transition-colors cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900 truncate" title={mat.materialName}>
                        {mat.materialName}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-medium shrink-0">
                        {mat.category}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3 mt-1.5 text-[11px] text-slate-500">
                      <span className="text-emerald-700 font-mono font-medium">Min: {formatRubleWithDecimals(mat.minPrice)}</span>
                      <span>•</span>
                      <span className="text-rose-700 font-mono font-medium">Max: {formatRubleWithDecimals(mat.maxPrice)}</span>
                      <span className="hidden sm:inline text-slate-400">({mat.cheapestJobsite} vs {mat.priciestJobsite})</span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center px-2 py-1 rounded-lg bg-rose-100 text-rose-800 text-xs font-mono font-bold">
                      %{mat.priceDiffPercentage.toFixed(0)} Fark
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs">
                Şantiyeler arasında belirgin bir fiyat makası tespit edilmedi.
              </div>
            )}
          </div>
        </div>

        {/* Jobsite Budget Utilization (6 cols) */}
        <div className="lg:col-span-6 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Şantiye Bütçe Kullanım Durumu</h2>
              <p className="text-xs text-slate-500">Şantiyelerin toplam bütçelerine göre gerçekleşen harcama oranları</p>
            </div>
            <button
              onClick={() => onNavigateToTab('jobsites-supervisors')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center space-x-1 cursor-pointer"
            >
              <span>Şantiyeleri Yönet</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-4 flex-1 overflow-y-auto">
            {jobsiteSpendingData.length > 0 ? (
              jobsiteSpendingData.map((j) => (
                <div key={j.jobsiteId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">{j.jobsiteName}</span>
                    <span className="font-mono font-bold text-slate-900">
                      {formatRuble(j.spend)} {j.budget > 0 && <span className="text-slate-400 font-normal">/ {formatRuble(j.budget)}</span>}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                    <div
                      className={`h-full rounded-full transition-all ${
                        j.budgetUsagePercentage > 90
                          ? 'bg-rose-500'
                          : j.budgetUsagePercentage > 70
                          ? 'bg-amber-500'
                          : 'bg-indigo-600'
                      }`}
                      style={{ width: `${Math.min(j.budgetUsagePercentage || j.percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>{j.invoiceCount} adet kayıtlı fatura</span>
                    <span className="font-medium">{j.budget > 0 ? `%${j.budgetUsagePercentage} Bütçe Kullanımı` : `%${j.percentage} Harcama Payı`}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs">
                Şantiye bütçe verisi bulunamadı.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. Lists & Data Safety Center Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Transactions List (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-xs flex flex-col">
          {/* Header & Main Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">Son Satınalma ve İndirim İşlemleri</h2>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-bold rounded-full border border-indigo-100">
                  {filteredTransactions.length} Kayıt
                </span>
              </div>
              <p className="text-xs text-slate-500">Sistemdeki tüm onaylı ve beklemedeki fatura ile şef pazarlık hareketleri</p>
            </div>
            
            <div className="flex items-center flex-wrap gap-2">
              <button
                onClick={onOpenNewDiscountModal}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Yeni İndirim Ekle</span>
              </button>
              
              <button
                onClick={() => onNavigateToTab('invoice-ai')}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-colors cursor-pointer"
              >
                <span>Tüm Faturalar</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Quick Filter Bar: Type Tabs & Table Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4 pt-3 border-t border-slate-100">
            {/* Filter Pills */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => { setTxFilterType('ALL'); setTxPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  txFilterType === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tümü ({txCounts.total})
              </button>
              <button
                onClick={() => { setTxFilterType('DISCOUNT'); setTxPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
                  txFilterType === 'DISCOUNT'
                    ? 'bg-white text-emerald-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                <span>İndirim & Pazarlık ({txCounts.discounts})</span>
              </button>
              <button
                onClick={() => { setTxFilterType('INVOICE'); setTxPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center space-x-1 ${
                  txFilterType === 'INVOICE'
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                <span>Faturalar ({txCounts.invoices})</span>
              </button>
            </div>

            {/* Table Search */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Tedarikçi, şantiye, fatura no veya şef ara..."
                value={txSearch}
                onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }}
                className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              {txSearch && (
                <button
                  onClick={() => { setTxSearch(''); setTxPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto no-scrollbar flex-1 border border-slate-100 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Tarih & Tür</th>
                  <th className="py-2.5 px-3">Tedarikçi & Kategori</th>
                  <th className="py-2.5 px-3">Şantiye</th>
                  <th className="py-2.5 px-3">Yetkili</th>
                  <th className="py-2.5 px-3 text-right">İlk Fiyat (₽)</th>
                  <th className="py-2.5 px-3 text-right">Nihai Tutar (₽)</th>
                  <th className="py-2.5 px-3 text-right">Kazanılan İndirim</th>
                  <th className="py-2.5 px-3 text-center">İndirim Oranı</th>
                  <th className="py-2.5 px-3 text-center">Durum</th>
                  <th className="py-2.5 px-3 text-center">İncele</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedTransactions.length > 0 ? (
                  paginatedTransactions.map((tx) => {
                    const hasDiscount = (tx.discountAmount && tx.discountAmount > 0) || (tx.discountPercentage && tx.discountPercentage > 0);
                    return (
                      <tr
                        key={tx.id}
                        onClick={() => setSelectedTx(tx)}
                        className="hover:bg-indigo-50/30 transition-colors cursor-pointer group"
                      >
                        {/* Tarih & Tür */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-800">{tx.date}</div>
                          <div className="flex items-center space-x-1 mt-0.5">
                            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                              tx.type === 'INVOICE'
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            }`}>
                              {tx.type === 'INVOICE' ? 'Fatura' : 'İndirim'}
                            </span>
                            {tx.recordOriginType && (
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                tx.recordOriginType === 'gol'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-teal-50 text-teal-700 border border-teal-200'
                              }`}>
                                {tx.recordOriginType === 'gol' ? '⚽ Gol' : '🎯 Asist'}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Tedarikçi & Kategori */}
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 truncate max-w-[170px]" title={tx.supplier}>
                            {normalizeVendorName(tx.supplier)}
                          </div>
                          <div className="flex items-center space-x-1.5 mt-0.5">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border truncate max-w-[120px] ${
                              tx.category === 'İnşaat Demiri'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : tx.category === 'Donatı Malzemeleri'
                                ? 'bg-purple-50 text-purple-800 border-purple-200'
                                : tx.category === 'Çelik Malzemeler'
                                ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                : tx.category === 'Hazır Beton & Çimento'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                              {tx.category || 'Genel'}
                            </span>
                            {tx.invoiceNumber && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                #{tx.invoiceNumber}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Şantiye */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-medium text-slate-800 truncate max-w-[130px]" title={tx.jobsiteName}>
                            {tx.jobsiteName}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[130px]">
                            {tx.materialSummary}
                          </div>
                        </td>

                        {/* Yetkili Şef / Personel */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="text-slate-800 font-medium">
                            {tx.supervisorName}
                          </div>
                          {tx.performedByPersonnelName && (
                            <div className="text-[10px] text-slate-500">
                              Asist: <span className="font-semibold text-slate-700">{tx.performedByPersonnelName}</span>
                            </div>
                          )}
                        </td>

                        {/* İlk Fiyat / Liste */}
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500 whitespace-nowrap">
                          {tx.initialPrice > 0 ? formatRuble(tx.initialPrice) : '-'}
                        </td>

                        {/* Nihai Tutar */}
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                          {formatRuble(tx.amount)}
                        </td>

                        {/* Kazanılan İndirim */}
                        <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                          {hasDiscount && tx.discountAmount > 0 ? (
                            <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                              -{formatRuble(tx.discountAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        {/* İndirim Oranı (%) */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {hasDiscount && tx.discountPercentage > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              %{Number(tx.discountPercentage).toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Durum */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                            tx.status === 'Onaylandı'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : tx.status === 'Beklemede'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}>
                            {tx.status}
                          </span>
                        </td>

                        {/* İncele Butonu */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTx(tx);
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 transition-colors cursor-pointer"
                            title="İşlem Detaylarını Aç"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 text-xs">
                      {txSearch ? 'Arama kriterlerine uygun işlem bulunamadı.' : 'Seçili filtre aralığında kayıtlı işlem bulunamadı.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {filteredTransactions.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
              <div className="flex items-center space-x-2">
                <span>Sayfa Başına:</span>
                <select
                  value={txPageSize}
                  onChange={(e) => { setTxPageSize(Number(e.target.value)); setTxPage(1); }}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 cursor-pointer"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <span>
                  Toplam {filteredTransactions.length} kayıttan {(txPage - 1) * txPageSize + 1} - {Math.min(txPage * txPageSize, filteredTransactions.length)} arası
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setTxPage(prev => Math.max(1, prev - 1))}
                  disabled={txPage === 1}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Önceki
                </button>
                <span className="font-mono font-bold text-slate-800">
                  {txPage} / {totalTxPages}
                </span>
                <button
                  onClick={() => setTxPage(prev => Math.min(totalTxPages, prev + 1))}
                  disabled={txPage === totalTxPages}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Sonraki
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Data Backup & System Health Widget (4 cols) - Only visible to System Administrator (Admin) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Snapshot Backup Widget (Admin Only) */}
          {user?.role === 'admin' && (
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-5 sm:p-6 shadow-md border border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">Veri Güvenliği & Yedek</h3>
                    <p className="text-[11px] text-slate-400">Otomatik Anlık Snapshot Motoru</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                  Yönetici Özel
                </span>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2.5 text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Son Yedek Zamanı:</span>
                  <span className="font-mono font-medium text-slate-200">
                    {backupInfo.lastBackupTime || 'Sistem Hazır'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Kayıtlı Snapshot Sayısı:</span>
                  <span className="font-mono font-bold text-indigo-300">
                    {backupInfo.snapshotCount} Adet
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Toplam Yedek Boyutu:</span>
                  <span className="font-mono text-slate-200">
                    {(backupInfo.totalSizeBytes / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>

              {backupSuccessMessage && (
                <div className="mt-3 p-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs font-semibold flex items-center space-x-2 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{backupSuccessMessage}</span>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2">
                <button
                  onClick={handleManualBackup}
                  disabled={isCreatingBackup}
                  className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>{isCreatingBackup ? 'Yedekleniyor...' : 'Şimdi Yedek Al'}</span>
                </button>

                {onOpenBackupModal && (
                  <button
                    onClick={onOpenBackupModal}
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                    title="Yedekleme ve Geri Yükleme Merkezini Aç"
                  >
                    Yedekleri Yönet
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Top Discount Percentage Records Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs">
            <h3 className="font-bold text-sm text-slate-900 mb-3 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>En Yüksek İskonto Oranlı Alımlar</span>
            </h3>

            <div className="space-y-2.5">
              {topDiscountRecords.length > 0 ? (
                topDiscountRecords.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => {
                      const matched = allCombinedTransactions.find(t => t.id === d.id);
                      if (matched) setSelectedTx(matched);
                    }}
                    className="p-2.5 bg-slate-50 hover:bg-emerald-50/50 rounded-xl border border-slate-100 flex items-center justify-between text-xs transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-bold text-slate-900 truncate">{d.vendorName}</p>
                      <p className="text-[11px] text-slate-500 truncate">{d.supervisorName} • {d.jobsiteName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono font-black text-emerald-600 text-sm">
                        %{Number(d.discountPercentage).toFixed(1)}
                      </span>
                      <p className="text-[10px] text-slate-400 font-mono">+{formatRuble(Number(d.discountAmount))}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-slate-400 text-xs py-3">Kayıtlı indirim bulunamadı.</p>
              )}
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* 6. Dashboard Detailed Transaction Inspector Modal */}
      {selectedTx && (() => {
        if (selectedTx.type === 'INVOICE') {
          const matchingInvoice: InvoiceRecord = (selectedTx.raw && selectedTx.raw.supplier)
            ? selectedTx.raw
            : invoices.find(inv => inv.id === selectedTx.id || (inv.invoiceNumber && inv.invoiceNumber === selectedTx.invoiceNumber)) || {
                id: selectedTx.id,
                invoiceNumber: selectedTx.invoiceNumber || 'FAT-001',
                supplier: selectedTx.supplier || '',
                jobsiteId: selectedTx.jobsiteId || '',
                jobsiteName: selectedTx.jobsiteName || 'Genel Şantiye',
                uploadedBySupervisorId: selectedTx.supervisorId || '',
                uploadedBySupervisorName: selectedTx.supervisorName || '',
                totalAmount: selectedTx.amount || 0,
                date: selectedTx.date || '',
                category: selectedTx.category || 'Genel',
                items: selectedTx.raw?.items || selectedTx.items || [],
                fileUrl: selectedTx.fileUrl || selectedTx.raw?.fileUrl
              };

          return (
            <InvoiceDetailModal
              invoice={matchingInvoice}
              jobsites={jobsites}
              supervisors={supervisors}
              onClose={() => setSelectedTx(null)}
              onNavigateToCompare={() => {
                setSelectedTx(null);
                onNavigateToTab('compare');
              }}
              onUpdateInvoice={onUpdateInvoice}
              onDeleteInvoice={onDeleteInvoice}
            />
          );
        }

        const matchingDiscount: DiscountRecord = (selectedTx.raw && selectedTx.raw.vendorName)
          ? selectedTx.raw
          : discounts.find(d => d.id === selectedTx.id || (d.invoiceNo && d.invoiceNo === selectedTx.invoiceNumber)) || {
              id: selectedTx.id,
              vendorName: selectedTx.supplier || '',
              jobsiteId: selectedTx.jobsiteId || '',
              jobsiteName: selectedTx.jobsiteName || 'Genel Şantiye',
              supervisorId: selectedTx.supervisorId || '',
              supervisorName: selectedTx.supervisorName || '',
              performedByPersonnelName: selectedTx.performedByPersonnelName,
              recordOrigin: selectedTx.recordOriginType || 'gol',
              category: selectedTx.category || 'Genel',
              invoiceNo: selectedTx.invoiceNumber || '',
              orderDate: selectedTx.date || '',
              offerPrice: selectedTx.initialPrice || selectedTx.amount || 0,
              agreedPrice: selectedTx.amount || 0,
              discountAmount: selectedTx.discountAmount || 0,
              discountPercentage: selectedTx.discountPercentage || 0,
              scopeDeductionAmount: selectedTx.scopeDeductionAmount || 0,
              scopeDeductionReason: selectedTx.scopeDeductionReason,
              status: selectedTx.status || 'Onaylandı',
              notes: selectedTx.notes,
              fileUrl: selectedTx.fileUrl || selectedTx.raw?.fileUrl,
              items: selectedTx.raw?.items || selectedTx.items || [],
              negotiationRounds: selectedTx.negotiationRounds || selectedTx.raw?.negotiationRounds
            };

        return (
          <DiscountDetailModal
            discount={matchingDiscount}
            onClose={() => setSelectedTx(null)}
            onEditDiscount={() => {
              setSelectedTx(null);
              onNavigateToTab('discounts');
            }}
          />
        );
      })()}
    </div>
  );
};
