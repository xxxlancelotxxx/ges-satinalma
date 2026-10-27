import React, { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { checkRecordPermission } from '../utils/permissions';
import {
  SupervisorPerformance,
  DiscountRecord,
  PurchasingSupervisor,
  Jobsite,
  Personnel,
  MaterialComparison,
  InvoiceRecord,
  DiscountHistoricalAnomalyRecord,
  CheaperHistoricalBenchmark
} from '../types';
import { formatRuble, formatUploadDate, openOriginalFileViewer } from '../utils/format';
import { calculateNegotiationEffortScore, NEGOTIATION_THRESHOLD } from '../utils/procedureConfig';
import { calculateSmartFinancialScore } from '../utils/leaderboardGamification';
import { getGenuineNegotiationRoundCount } from '../utils/negotiationStages';
import { generateExecutiveHtmlReport } from '../utils/reportHtmlGenerator';
import {
  scanDiscountRecordsForHistoricalAnomalies,
  scanDirectInvoicesForHistoricalAnomalies
} from '../utils/preApprovalAuditEngine';
import {
  renderAnomalyReportHtml,
  downloadAnomalyReportExcel,
  downloadAnomalyReportHtml,
  downloadAnomalyReportPdf
} from '../utils/anomalyReportExporter';
import { GesLogo } from './GesLogo';
import {
  TrendingUp,
  Award,
  Building2,
  Percent,
  Coins,
  Search,
  Download,
  Sparkles,
  CheckCircle2,
  Briefcase,
  AlertCircle,
  Edit3,
  Users,
  Target,
  ShieldAlert,
  Flame,
  BarChart3,
  Layers,
  FileSpreadsheet,
  Lock,
  Unlock,
  KeyRound,
  FileCode,
  Printer,
  Eye,
  EyeOff,
  RefreshCw,
  X,
  FileText,
  Scale,
  Snowflake,
  ExternalLink,
  Hash,
  Filter
} from 'lucide-react';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter, getDateFilterDisplayLabel } from '../utils/filterHelpers';
import { normalizeVendorName, areVendorsEqual, extractCanonicalVendors } from '../utils/vendorNormalizer';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  CartesianGrid
} from 'recharts';
import { EditDiscountModal } from './EditDiscountModal';
import { ExecutiveVendorDiversityReport } from './ExecutiveVendorDiversityReport';
import { ExecutivePriceAndDiscountAudit } from './ExecutivePriceAndDiscountAudit';
import { MonthlyExecutiveReportModal } from './MonthlyExecutiveReportModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { UndiscountedInvoicesAuditReport } from './UndiscountedInvoicesAuditReport';
import { extractUndiscountedInvoicesData } from '../utils/undiscountedInvoiceExporter';

interface Props {
  performances: SupervisorPerformance[];
  discounts: DiscountRecord[];
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  personnel?: Personnel[];
  comparisons?: MaterialComparison[];
  invoices?: InvoiceRecord[];
  prizmaInvoices?: InvoiceRecord[];
  onOpenNewDiscountModal: () => void;
  onUpdateDiscount?: (id: string, record: Partial<DiscountRecord>) => Promise<void> | void;
  onDeleteDiscount?: (id: string) => Promise<void> | void;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => Promise<void> | void;
}

const REPORT_PIN = '3255';
const SESSION_STORAGE_KEY = 'report_pin_unlocked_3255';

export const SupervisorPerformanceReport: React.FC<Props> = ({
  performances = [],
  discounts = [],
  supervisors = [],
  jobsites = [],
  personnel = [],
  comparisons = [],
  invoices = [],
  prizmaInvoices = [],
  onOpenNewDiscountModal,
  onUpdateDiscount,
  onDeleteDiscount,
  onUpdateInvoice
}) => {
  const { t } = useLanguage();
  const { user } = useAuth();

  // PIN Protection State (PIN: 3255 or Admin PIN)
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Effective unlock: Admins, supervisors, and personnel have direct access to foster healthy team competition
  const isEffectiveUnlocked = user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'personnel' || isUnlocked;
  const isAdminOnlyUnlocked = user?.role === 'admin' || isUnlocked;

  const [enteredPin, setEnteredPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showPinMask, setShowPinMask] = useState<boolean>(false);
  const [isShaking, setIsShaking] = useState<boolean>(false);

  // Tab & Filter States
  const [editingRecord, setEditingRecord] = useState<DiscountRecord | null>(null);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('ALL');
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>('ALL');
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  const [invoiceNoFilter, setInvoiceNoFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeViewMode, setActiveViewMode] = useState<'matrix' | 'cards' | 'personnel' | 'chart' | 'logs' | 'diversity' | 'audit' | 'historical_anomalies' | 'undiscounted_invoices'>('matrix');
  const [selectedHistoricalAnomaly, setSelectedHistoricalAnomaly] = useState<DiscountHistoricalAnomalyRecord | null>(null);
  const [viewingHistoricalInvoice, setViewingHistoricalInvoice] = useState<InvoiceRecord | null>(null);
  const [historicalAnomalySearch, setHistoricalAnomalySearch] = useState<string>('');
  const [anomalySourceFilter, setAnomalySourceFilter] = useState<'ALL' | 'DISCOUNT_CENTER' | 'DIRECT_INVOICE'>('ALL');
  const [showAnomalyReportModal, setShowAnomalyReportModal] = useState<boolean>(false);
  const [isExportingAnomalyReport, setIsExportingAnomalyReport] = useState<boolean>(false);

  // Admin Price Anomaly Filters
  const [anomalyInvoiceNoFilter, setAnomalyInvoiceNoFilter] = useState<string>('');
  const [anomalyDateFilter, setAnomalyDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [anomalyVendorFilter, setAnomalyVendorFilter] = useState<string>('ALL');
  const [anomalyJobsiteFilter, setAnomalyJobsiteFilter] = useState<string>('ALL');
  const [anomalySupervisorFilter, setAnomalySupervisorFilter] = useState<string>('ALL');
  const [anomalyMinDiffFilter, setAnomalyMinDiffFilter] = useState<number>(0);

  const canonicalVendors = useMemo(() => {
    return extractCanonicalVendors((discounts || []).map(d => ({ vendorName: d.vendorName })));
  }, [discounts]);

  const isAnyFilterActive = useMemo(() => {
    return (
      selectedSupervisorId !== 'ALL' ||
      selectedJobsiteId !== 'ALL' ||
      selectedVendor !== 'ALL' ||
      Boolean(invoiceNoFilter.trim()) ||
      (dateFilter.preset && dateFilter.preset !== 'all') ||
      Boolean(searchTerm.trim())
    );
  }, [selectedSupervisorId, selectedJobsiteId, selectedVendor, invoiceNoFilter, dateFilter, searchTerm]);

  const handleResetFilters = () => {
    setSelectedSupervisorId('ALL');
    setSelectedJobsiteId('ALL');
    setSelectedVendor('ALL');
    setInvoiceNoFilter('');
    setDateFilter({ preset: 'all' });
    setSearchTerm('');
  };

  // Preview Modal for HTML/PDF Report
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
  const [showMonthlyExecutiveModal, setShowMonthlyExecutiveModal] = useState<boolean>(false);

  // Format Currency (Ruble)
  const formatCurrency = (amount: number) => {
    return formatRuble(amount || 0);
  };
  const formatTL = formatCurrency;

  // PIN Unlock Handler
  const handleVerifyPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPin = enteredPin.trim();
    if (!cleanPin) return;

    if (cleanPin === REPORT_PIN) {
      setIsUnlocked(true);
      setPinError('');
      setEnteredPin('');
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
      } catch (err) {
        console.error('Session storage write error:', err);
      }
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin, preferredRole: 'admin' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsUnlocked(true);
        setPinError('');
        setEnteredPin('');
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
        } catch (err) {}
        return;
      }
    } catch (_) {}

    setPinError('Hatalı Yönetici Şifresi! Lütfen tekrar deneyiniz.');
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  // Lock Report Handler
  const handleLockReport = () => {
    setIsUnlocked(false);
    setEnteredPin('');
    setPinError('');
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
      console.error('Session storage clear error:', err);
    }
  };

  // Safe fallback calculation for performances if backend data is loading or empty
  const computedPerformances: SupervisorPerformance[] = useMemo(() => {
    if (Array.isArray(performances) && performances.length > 0) {
      return performances;
    }

    // Compute live from supervisors & discounts
    return supervisors.map(sup => {
      const supDiscounts = (discounts || []).filter(d => d.supervisorId === sup.id);
      let totalList = 0;
      let totalAgreed = 0;
      let totalDiscount = 0;
      let golCount = 0;
      let asistCount = 0;
      let totalRounds = 0;
      let totalNewVendors = 0;
      let procedureViolations = 0;
      let newVendors = 0;

      const jobsiteMap = new Map<string, { jobsiteId: string; jobsiteName: string; discountAmount: number; listPrice: number; transactionCount: number }>();
      let supervisorMarketSavings = 0;
      let supervisorMarketCount = 0;
      let supervisorLegacySavings = 0;
      let supervisorLegacyCount = 0;

      supDiscounts.forEach(d => {
        const offer = Number(d.offerPrice) || 0;
        const agreed = Number(d.agreedPrice) || 0;
        const diff = Math.max(0, offer - agreed);
        totalList += offer;
        totalAgreed += agreed;
        totalDiscount += diff;

        // Strict KPI check: Only MARKET_BASELINE_TO_FINAL and kpiEligible === true
        if (d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true) {
          supervisorMarketSavings += Number(d.realMarketSavings) || 0;
          supervisorMarketCount++;
        } else {
          supervisorLegacySavings += diff;
          supervisorLegacyCount++;
        }

        if (d.recordOriginType === 'asist' || (d as any).recordOrigin === 'asist' || d.performedByPersonnelId || d.performedByPersonnelName) {
          asistCount++;
        } else {
          golCount++;
        }

        const r = getGenuineNegotiationRoundCount(d);
        totalRounds += r;

        if (Array.isArray(d.procedureWarnings) && d.procedureWarnings.length > 0) {
          procedureViolations++;
        }

        if (d.jobsiteId) {
          const resolvedSiteName = d.jobsiteName || jobsites.find(j => j.id === d.jobsiteId)?.name || 'Şantiye';
          if (!jobsiteMap.has(d.jobsiteId)) {
            jobsiteMap.set(d.jobsiteId, {
              jobsiteId: d.jobsiteId,
              jobsiteName: resolvedSiteName,
              discountAmount: 0,
              listPrice: 0,
              transactionCount: 0
            });
          }
          const jm = jobsiteMap.get(d.jobsiteId)!;
          jm.discountAmount += diff;
          jm.listPrice += offer;
          jm.transactionCount += 1;
        }
      });

      const avgPct = totalList > 0 ? Number(((totalDiscount / totalList) * 100).toFixed(2)) : 0;
      const totalTx = supDiscounts.length;
      const newVendorRatio = totalTx > 0 ? (totalNewVendors / totalTx) : 0;
      const effortScore = calculateNegotiationEffortScore(avgPct, totalRounds, newVendorRatio, newVendors, asistCount, totalTx, golCount, totalDiscount);

      const jobsiteBreakdown = Array.from(jobsiteMap.values()).map(j => ({
        ...j,
        discountPercentage: j.listPrice > 0 ? Number(((j.discountAmount / j.listPrice) * 100).toFixed(2)) : 0
      })).sort((a, b) => b.discountAmount - a.discountAmount);

      return {
        supervisorId: sup.id,
        supervisorName: sup.name,
        totalTransactions: totalTx,
        totalListPrice: totalList,
        totalAgreedPrice: totalAgreed,
        totalDiscountAmount: totalDiscount,
        totalRealMarketSavings: supervisorMarketSavings,
        marketSavingsCount: supervisorMarketCount,
        comparativeCount: supervisorMarketCount,
        totalLegacySavings: supervisorLegacySavings,
        legacyCount: supervisorLegacyCount,
        avgDiscountPercentage: avgPct,
        totalGol: golCount,
        totalAsist: asistCount,
        golDiscountAmount: 0,
        asistDiscountAmount: 0,
        assistRatio: totalTx > 0 ? Number(((asistCount / totalTx) * 100).toFixed(1)) : 0,
        avgNegotiationRounds: totalRounds, // repurposed to send total rounds directly
        totalNegotiationRounds: totalRounds,
        avgDistinctFirms: 1,
        negotiationEffortScore: effortScore,
        procedureViolationCount: procedureViolations,
        personnelBreakdown: [],
        topJobsiteName: jobsiteBreakdown.length > 0 ? jobsiteBreakdown[0].jobsiteName : '-',
        jobsiteBreakdown
      };
    });
  }, [performances, supervisors, discounts]);

  // Aggregated KPIs
  const totalDiscount = useMemo(() => {
    return computedPerformances.reduce((acc, p) => acc + (p?.totalDiscountAmount || 0), 0);
  }, [computedPerformances]);

  // STRICT MARKET BASELINE KPI: ONLY calculationMethod === 'MARKET_BASELINE_TO_FINAL' && kpiEligible === true
  const totalRealMarketSavings = useMemo(() => {
    return (discounts || []).reduce((acc, d) => {
      if (d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true) {
        return acc + (Number(d.realMarketSavings) || 0);
      }
      return acc;
    }, 0);
  }, [discounts]);

  const totalComparativeCount = useMemo(() => {
    return (discounts || []).filter(
      d => d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true
    ).length;
  }, [discounts]);

  // Legacy records: do NOT delete; calculate and display separately
  const totalLegacySavings = useMemo(() => {
    return (discounts || []).reduce((acc, d) => {
      const isStrictMarketEligible = d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true;
      if (!isStrictMarketEligible) {
        return acc + Math.max(0, (Number(d.offerPrice) || 0) - (Number(d.agreedPrice) || 0));
      }
      return acc;
    }, 0);
  }, [discounts]);

  const totalLegacyCount = useMemo(() => {
    return (discounts || []).filter(
      d => !(d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible === true)
    ).length;
  }, [discounts]);

  const totalDisqualifiedMarketCount = useMemo(() => {
    return (discounts || []).filter(
      d => d.calculationMethod === 'MARKET_BASELINE_TO_FINAL' && d.kpiEligible !== true
    ).length;
  }, [discounts]);

  const totalInternalVendorDiscount = useMemo(() => {
    return (discounts || []).reduce((acc, d) => {
      if (d.calculationMethod === 'MARKET_BASELINE_TO_FINAL') {
        return acc + (Number(d.internalVendorDiscount) || 0);
      }
      return acc + Math.max(0, (Number(d.offerPrice) || 0) - (Number(d.agreedPrice) || 0));
    }, 0);
  }, [discounts]);

  const totalListPrice = useMemo(() => {
    return computedPerformances.reduce((acc, p) => acc + (p?.totalListPrice || 0), 0);
  }, [computedPerformances]);

  const totalAgreedPrice = useMemo(() => {
    return computedPerformances.reduce((acc, p) => acc + (p?.totalAgreedPrice || 0), 0);
  }, [computedPerformances]);

  const overallAvgDiscountPct = useMemo(() => {
    return totalListPrice > 0 ? Number(((totalDiscount / totalListPrice) * 100).toFixed(1)) : 0;
  }, [totalDiscount, totalListPrice]);

  // Top performing supervisor based on fair, smart multi-factor evaluation:
  // Reel Tasarruf Hacmi (%30), Bireysel Goller (%20), Ekip Asistleri (%15), İşlem Israrı & Hacmi (%15), İskonto Oranı (%20)
  const sortedPerformances = useMemo(() => {
    const maxSavings = Math.max(...computedPerformances.map(p => p.totalDiscountAmount || 0), 1);
    const maxGoals = Math.max(...computedPerformances.map(p => p.totalGol || 0), 1);
    const maxAssists = Math.max(...computedPerformances.map(p => p.totalAsist || 0), 1);
    const maxTx = Math.max(...computedPerformances.map(p => p.totalTransactions || 0), 1);
    const maxRate = Math.max(...computedPerformances.map(p => p.avgDiscountPercentage || 0), 10);

    const calcBalancedScore = (p: any) => {
      const volScore = ((p.totalDiscountAmount || 0) / maxSavings) * 100;
      const goalsScore = ((p.totalGol || 0) / maxGoals) * 100;
      const assistsScore = ((p.totalAsist || 0) / maxAssists) * 100;
      const txScore = ((p.totalTransactions || 0) / maxTx) * 100;
      const rateScore = Math.min(100, ((p.avgDiscountPercentage || 0) / maxRate) * 100);

      return (
        volScore * 0.30 +
        goalsScore * 0.20 +
        assistsScore * 0.15 +
        txScore * 0.15 +
        rateScore * 0.20
      );
    };

    return [...computedPerformances].sort((a, b) => {
      const scoreA = calcBalancedScore(a);
      const scoreB = calcBalancedScore(b);
      if (Math.abs(scoreB - scoreA) > 0.05) {
        return scoreB - scoreA;
      }
      return (b?.totalDiscountAmount || 0) - (a?.totalDiscountAmount || 0);
    });
  }, [computedPerformances]);

  const topSupervisor = sortedPerformances[0];

  // Helper map for supervisor stats (GOL / ASIST / Effort)
  const supervisorStatsMap = useMemo(() => {
    const map = new Map<string, {
      golCount: number;
      asistCount: number;
      totalRounds: number;
      avgRounds: number;
      newVendors: number;
      effortScore: number;
      procedureViolations: number;
    }>();

    computedPerformances.forEach(p => {
      if (!p) return;
      const supDiscounts = (discounts || []).filter(d => d.supervisorId === p.supervisorId);
      let golCount = 0;
      let asistCount = 0;
      let totalRounds = 0;
      let procedureViolations = 0;
      let newVendors = 0;
      supDiscounts.forEach(d => {
        if (d.recordOriginType === 'asist' || (d as any).recordOrigin === 'asist' || d.performedByPersonnelId || d.performedByPersonnelName) {
          asistCount++;
        } else {
          golCount++;
        }
        const rounds = getGenuineNegotiationRoundCount(d);
        totalRounds += rounds;
        if (d.isNewVendor === true) newVendors++;
        if (Array.isArray(d.procedureWarnings) && d.procedureWarnings.length > 0) {
          procedureViolations++;
        }
      });

      const avgRounds = totalRounds; // Using total rounds directly for better representation
      const newVendorRatio = supDiscounts.length > 0 ? (newVendors / supDiscounts.length) : 0;
      const effortScore = calculateNegotiationEffortScore(p.avgDiscountPercentage || 0, totalRounds, newVendorRatio, newVendors, asistCount, supDiscounts.length, golCount, p.totalDiscountAmount || 0);

      map.set(p.supervisorId, {
        golCount,
        asistCount,
        totalRounds,
        avgRounds,
        newVendors,
        effortScore,
        procedureViolations
      });
    });

    return map;
  }, [computedPerformances, discounts]);

  // Assistant Personnel Performance Stats
  const personnelPerformanceList = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      title: string;
      supervisorName: string;
      totalAssists: number;
      totalDiscountAmount: number;
      totalListPrice: number;
      avgDiscountPercentage: number;
      avgRounds: number;
      totalNewVendors: number;
      effortScore: number;
    }> = [];

    const persMap = new Map<string, {
      id: string;
      name: string;
      title: string;
      supervisorName: string;
      totalAssists: number;
      totalDiscountAmount: number;
      totalListPrice: number;
      totalRounds: number;
      totalNewVendors: number;
    }>();

    (personnel || []).forEach(p => {
      if (!p) return;
      persMap.set(p.id, {
        id: p.id,
        name: p.name,
        title: p.title || 'Satınalma Personeli',
        supervisorName: p.supervisorName || supervisors.find(s => s.id === p.supervisorId)?.name || 'Şef Atanmamış',
        totalAssists: 0,
        totalDiscountAmount: 0,
        totalListPrice: 0,
        totalRounds: 0,
        totalNewVendors: 0
      });
    });

    (discounts || []).forEach(d => {
      if (!d) return;
      const persId = d.performedByPersonnelId;
      const persName = d.performedByPersonnelName;
      const discountVal = Number(d.discountAmount) || 0;
      const offerVal = Number(d.offerPrice) || 0;
      const rounds = getGenuineNegotiationRoundCount(d);

      if (persId && persMap.has(persId)) {
        const item = persMap.get(persId)!;
        item.totalAssists++;
        item.totalDiscountAmount += discountVal;
        item.totalListPrice += offerVal;
        item.totalRounds += rounds;
        if (d.isNewVendor === true) item.totalNewVendors++;
      } else if (persName) {
        let found = Array.from(persMap.values()).find(x => x.name.toLowerCase() === persName.toLowerCase());
        if (!found) {
          found = {
            id: `pers_gen_${persName}`,
            name: persName,
            title: 'Satınalma Personeli',
            supervisorName: d.supervisorName || 'Şef Atanmamış',
            totalAssists: 0,
            totalDiscountAmount: 0,
            totalListPrice: 0,
            totalRounds: 0,
            totalNewVendors: 0
          };
          persMap.set(found.id, found);
        }
        found.totalAssists++;
        found.totalDiscountAmount += discountVal;
        found.totalListPrice += offerVal;
        found.totalRounds += rounds;
        if (d.isNewVendor === true) found.totalNewVendors++;
      }
    });

    persMap.forEach(item => {
      const avgDiscountPercentage = item.totalListPrice > 0
        ? Number(((item.totalDiscountAmount / item.totalListPrice) * 100).toFixed(1))
        : 0;
      const avgRounds = item.totalAssists > 0
        ? Number((item.totalRounds / item.totalAssists).toFixed(1))
        : 0;
      const newVendorRatio = item.totalAssists > 0 ? (item.totalNewVendors / item.totalAssists) : 0;
      const effortScore = calculateNegotiationEffortScore(avgDiscountPercentage, avgRounds, newVendorRatio, item.totalNewVendors, 0);

      list.push({
        id: item.id,
        name: item.name,
        title: item.title,
        supervisorName: item.supervisorName,
        totalAssists: item.totalAssists,
        totalDiscountAmount: item.totalDiscountAmount,
        totalListPrice: item.totalListPrice,
        avgDiscountPercentage,
        avgRounds,
        totalNewVendors: item.totalNewVendors,
        effortScore
      });
    });

    return list.sort((a, b) => b.totalDiscountAmount - a.totalDiscountAmount);
  }, [personnel, discounts, supervisors]);

  // Filtered discount logs
  const filteredDiscounts = useMemo(() => {
    return (discounts || []).filter(d => {
      if (!d) return false;
      const matchesSup = selectedSupervisorId === 'ALL' || d.supervisorId === selectedSupervisorId;
      const matchesJob = selectedJobsiteId === 'ALL' || d.jobsiteId === selectedJobsiteId;
      const matchesVen = selectedVendor === 'ALL' || areVendorsEqual(d.vendorName, selectedVendor);
      const matchesInvNo = !invoiceNoFilter.trim() || String(d.invoiceNo || '').toLowerCase().includes(invoiceNoFilter.toLowerCase().trim());
      const matchesDate = !dateFilter.preset || dateFilter.preset === 'all' || matchesDateFilter(d.orderDate || d.createdAt, dateFilter);
      const matchesSearch =
        searchTerm === '' ||
        (d.vendorName && d.vendorName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (d.supervisorName && d.supervisorName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (d.performedByPersonnelName && d.performedByPersonnelName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (d.jobsiteName && d.jobsiteName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (d.invoiceNo && d.invoiceNo.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (d.category && d.category.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchesSup && matchesJob && matchesVen && matchesInvNo && matchesDate && matchesSearch;
    });
  }, [discounts, selectedSupervisorId, selectedJobsiteId, selectedVendor, invoiceNoFilter, dateFilter, searchTerm]);

  // Cached combined invoice pool (GES Archive + Prizma ERP) so WeakMap index is never invalidated on re-render
  const combinedInvoicePool = useMemo(() => {
    const gesList = invoices || [];
    const prizmaList = (prizmaInvoices || []).map(p =>
      (p as any).sourceCollection === 'prizma_invoices' ? p : { ...p, sourceCollection: 'prizma_invoices' }
    );
    return [...gesList, ...prizmaList];
  }, [invoices, prizmaInvoices]);

  const openHistoricalReferenceInvoice = (line: CheaperHistoricalBenchmark) => {
    const cleanTargetNo = String(line.historicalInvoiceNo || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const found = combinedInvoicePool.find(inv => {
      if (line.historicalInvoiceId && inv.id === line.historicalInvoiceId) return true;
      const invNo = String(inv.invoiceNumber || inv.invoiceNo || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      return Boolean(cleanTargetNo && invNo === cleanTargetNo);
    });
    if (found) {
      setViewingHistoricalInvoice({
        ...found,
        fileUrl: found.fileUrl || line.historicalFileUrl,
        uploadedBySupervisorName: found.uploadedBySupervisorName || ((found as any).sourceCollection === 'prizma_invoices' ? 'Prizma ERP Kaydı' : 'GES Arşivi')
      });
    } else if (line.historicalFileUrl) {
      openOriginalFileViewer(line.historicalFileUrl, `Gecmis_Fatura_${line.historicalInvoiceNo}.pdf`);
    }
  };

  // Filtered direct invoices (uploaded via AI Otomatik Fatura Okuma)
  const filteredDirectInvoices = useMemo(() => {
    return (invoices || []).filter(inv => {
      if (!inv || inv.isDeleted) return false;
      const matchesSup = selectedSupervisorId === 'ALL' || inv.uploadedBySupervisorId === selectedSupervisorId;
      const matchesJob = selectedJobsiteId === 'ALL' || inv.jobsiteId === selectedJobsiteId;
      const matchesVen = selectedVendor === 'ALL' || areVendorsEqual(inv.supplier || (inv as any).vendorName || '', selectedVendor);
      const invNo = String(inv.invoiceNumber || inv.invoiceNo || '');
      const matchesInvNo = !invoiceNoFilter.trim() || invNo.toLowerCase().includes(invoiceNoFilter.toLowerCase().trim());
      const matchesDate = !dateFilter.preset || dateFilter.preset === 'all' || matchesDateFilter(inv.date || (inv as any).createdAt, dateFilter);
      const matchesSearch =
        searchTerm === '' ||
        (inv.supplier && inv.supplier.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.uploadedBySupervisorName && inv.uploadedBySupervisorName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (inv.jobsiteName && inv.jobsiteName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (invNo && invNo.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchesSup && matchesJob && matchesVen && matchesInvNo && matchesDate && matchesSearch;
    });
  }, [invoices, selectedSupervisorId, selectedJobsiteId, selectedVendor, invoiceNoFilter, dateFilter, searchTerm]);

  // Count of Undiscounted Direct Invoices (from AI Otomatik Fatura Okuma excluding Şef İndirim & TDF Teklif Merkezi)
  const undiscountedInvoicesCount = useMemo(() => {
    const res = extractUndiscountedInvoicesData({
      invoices: invoices || [],
      discounts: discounts || [],
      supervisors: supervisors || [],
      jobsites: jobsites || [],
      targetDiscountPct: 5
    });
    return res.allUndiscountedRows.length;
  }, [invoices, discounts, supervisors, jobsites]);

  // Cached Admin Price Anomaly lists by source (scanned across all records so it's always complete and up-to-date)
  const discountCenterAnomalies = useMemo(() => {
    if (!isAdminOnlyUnlocked) return [];
    return scanDiscountRecordsForHistoricalAnomalies(discounts || [], combinedInvoicePool);
  }, [isAdminOnlyUnlocked, discounts, combinedInvoicePool]);

  const directInvoiceAnomalies = useMemo(() => {
    if (!isAdminOnlyUnlocked) return [];
    return scanDirectInvoicesForHistoricalAnomalies(invoices || [], discounts || [], combinedInvoicePool);
  }, [isAdminOnlyUnlocked, invoices, discounts, combinedInvoicePool]);

  const allHistoricalAnomalies = useMemo(() => {
    return [...discountCenterAnomalies, ...directInvoiceAnomalies].sort(
      (a, b) => b.totalPotentialExtraSavings - a.totalPotentialExtraSavings
    );
  }, [discountCenterAnomalies, directInvoiceAnomalies]);

  const sourceFilteredAnomalies = useMemo(() => {
    if (anomalySourceFilter === 'DISCOUNT_CENTER') return discountCenterAnomalies;
    if (anomalySourceFilter === 'DIRECT_INVOICE') return directInvoiceAnomalies;
    return allHistoricalAnomalies;
  }, [anomalySourceFilter, discountCenterAnomalies, directInvoiceAnomalies, allHistoricalAnomalies]);

  // Unique filter option lists extracted directly from all detected anomalies
  const anomalyUniqueVendors = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of allHistoricalAnomalies) {
      const v = a.vendorName || 'Bilinmeyen Tedarikçi';
      map.set(v, (map.get(v) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [allHistoricalAnomalies]);

  const anomalyUniqueJobsites = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of allHistoricalAnomalies) {
      const j = a.jobsiteName || 'Belirtilmemiş Şantiye';
      map.set(j, (map.get(j) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [allHistoricalAnomalies]);

  const anomalyUniqueSupervisors = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const a of allHistoricalAnomalies) {
      const id = a.supervisorId || a.supervisorName || 'unknown';
      const name = a.supervisorName || 'Atanmamış';
      const cur = map.get(id);
      if (cur) {
        cur.count++;
      } else {
        map.set(id, { id, name, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [allHistoricalAnomalies]);

  const isAnyAnomalyFilterActive = useMemo(() => {
    return (
      Boolean(anomalyInvoiceNoFilter.trim()) ||
      Boolean(anomalyDateFilter.preset && anomalyDateFilter.preset !== 'all') ||
      anomalyVendorFilter !== 'ALL' ||
      anomalyJobsiteFilter !== 'ALL' ||
      anomalySupervisorFilter !== 'ALL' ||
      anomalyMinDiffFilter > 0 ||
      Boolean(historicalAnomalySearch.trim())
    );
  }, [
    anomalyInvoiceNoFilter,
    anomalyDateFilter,
    anomalyVendorFilter,
    anomalyJobsiteFilter,
    anomalySupervisorFilter,
    anomalyMinDiffFilter,
    historicalAnomalySearch
  ]);

  const handleResetAnomalyFilters = () => {
    setAnomalyInvoiceNoFilter('');
    setAnomalyDateFilter({ preset: 'all' });
    setAnomalyVendorFilter('ALL');
    setAnomalyJobsiteFilter('ALL');
    setAnomalySupervisorFilter('ALL');
    setAnomalyMinDiffFilter(0);
    setHistoricalAnomalySearch('');
  };

  const filteredHistoricalAnomalies = useMemo(() => {
    return sourceFilteredAnomalies.filter(a => {
      // 1. Invoice No Filter
      if (anomalyInvoiceNoFilter.trim()) {
        const targetNo = anomalyInvoiceNoFilter.toLowerCase().trim();
        const curNo = String(a.invoiceNo || '').toLowerCase();
        if (!curNo.includes(targetNo)) return false;
      }

      // 2. Date Filter
      if (anomalyDateFilter.preset && anomalyDateFilter.preset !== 'all') {
        if (!matchesDateFilter(a.orderDate || a.notifiedAt, anomalyDateFilter)) return false;
      }

      // 3. Vendor Filter
      if (anomalyVendorFilter !== 'ALL') {
        if (!areVendorsEqual(a.vendorName, anomalyVendorFilter)) return false;
      }

      // 4. Jobsite Filter
      if (anomalyJobsiteFilter !== 'ALL') {
        if (a.jobsiteName !== anomalyJobsiteFilter) return false;
      }

      // 5. Supervisor Filter
      if (anomalySupervisorFilter !== 'ALL') {
        if (a.supervisorId !== anomalySupervisorFilter && a.supervisorName !== anomalySupervisorFilter) return false;
      }

      // 6. Min Potential Extra Savings / Diff Filter
      if (anomalyMinDiffFilter > 0) {
        if (a.totalPotentialExtraSavings < anomalyMinDiffFilter) return false;
      }

      // 7. Free text Search
      const q = historicalAnomalySearch.toLowerCase().trim();
      if (q) {
        const matchesMain =
          a.invoiceNo.toLowerCase().includes(q) ||
          a.vendorName.toLowerCase().includes(q) ||
          a.supervisorName.toLowerCase().includes(q) ||
          a.jobsiteName.toLowerCase().includes(q);
        const matchesLine = a.affectedLines.some(l =>
          l.materialName.toLowerCase().includes(q) ||
          (l.originalName || '').toLowerCase().includes(q) ||
          (l.historicalOriginalName || '').toLowerCase().includes(q) ||
          l.historicalSupplier.toLowerCase().includes(q)
        );
        if (!matchesMain && !matchesLine) return false;
      }

      return true;
    });
  }, [
    sourceFilteredAnomalies,
    anomalyInvoiceNoFilter,
    anomalyDateFilter,
    anomalyVendorFilter,
    anomalyJobsiteFilter,
    anomalySupervisorFilter,
    anomalyMinDiffFilter,
    historicalAnomalySearch
  ]);

  // Chart Data: Supervisor comparison
  const supervisorChartData = useMemo(() => {
    return computedPerformances.map(p => ({
      name: p.supervisorName || 'Şef',
      'Liste Fiyatı': p.totalListPrice || 0,
      'Anlaşılan Fiyat': p.totalAgreedPrice || 0,
      'Kazanılan İndirim': p.totalDiscountAmount || 0,
      'İndirim %': p.avgDiscountPercentage || 0
    }));
  }, [computedPerformances]);

  // Chart Data: Jobsite breakdown
  const jobsitePieData = useMemo(() => {
    const map: { [key: string]: number } = {};
    (discounts || []).forEach(d => {
      if (!d || d.isDeleted || d.test) return;
      const key = d.jobsiteName || jobsites.find(j => j.id === d.jobsiteId)?.name || 'Şantiye';
      map[key] = (map[key] || 0) + (Number(d.discountAmount) || 0);
    });

    const data = Object.keys(map).map(name => ({
      name,
      value: map[name]
    })).filter(x => x.value > 0);

    return data.length > 0 ? data : [{ name: 'Veri Yok', value: 1 }];
  }, [discounts]);

  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#3b82f6'];

  // Generated Raw HTML Report String
  const generatedHtmlReport = useMemo(() => {
    return generateExecutiveHtmlReport({
      performances: computedPerformances,
      discounts,
      supervisors,
      jobsites,
      personnel,
      totalDiscount,
      totalListPrice,
      totalAgreedPrice,
      overallAvgDiscountPct,
      topSupervisor,
      generatedBy: user?.displayName || 'Satınalma Yönetimi'
    });
  }, [
    computedPerformances,
    discounts,
    supervisors,
    jobsites,
    personnel,
    totalDiscount,
    totalListPrice,
    totalAgreedPrice,
    overallAvgDiscountPct,
    topSupervisor,
    user
  ]);

  // Download HTML Report
  const handleDownloadHtmlReport = () => {
    const blob = new Blob([generatedHtmlReport], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `GES_Satinalma_Performans_ve_Indirim_Raporu_${new Date().toISOString().split('T')[0]}.html`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Direct PDF Print
  const handlePrintPdfReport = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(generatedHtmlReport);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 400);
    } else {
      // If popup blocked, download HTML file
      handleDownloadHtmlReport();
    }
  };

  // Export CSV function
  const handleExportCSV = () => {
    const headers = [
      'Tarih',
      'Satınalma Şefi',
      'Pazarlık İcrası (GOL/ASIST)',
      'Personel',
      'Şantiye',
      'Tedarikçi',
      'Kategori',
      'Liste Fiyatı (RUB)',
      'Anlaşılan Fiyat (RUB)',
      'İndirim Tutarı (RUB)',
      'İndirim Oranı (%)',
      'Tur Sayısı',
      'Sipariş No'
    ];
    const rows = filteredDiscounts.map(d => [
      d.orderDate || '',
      `"${d.supervisorName || ''}"`,
      d.recordOriginType === 'asist' || (d as any).recordOrigin === 'asist' || d.performedByPersonnelId ? 'ASIST' : 'GOL',
      `"${d.performedByPersonnelName || '-'}"`,
      `"${d.jobsiteName || ''}"`,
      `"${d.vendorName || ''}"`,
      `"${d.category || ''}"`,
      d.offerPrice || 0,
      d.agreedPrice || 0,
      d.discountAmount || 0,
      d.discountPercentage || 0,
      getGenuineNegotiationRoundCount(d),
      d.invoiceNo || '-'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Satinalma_Performans_ve_Indirim_Raporu_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // -------------------------------------------------------------
  // PIN LOGIN SECURITY SCREEN (PIN: 3255 or Admin PIN)
  // -------------------------------------------------------------
  if (!isEffectiveUnlocked) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 sm:p-10 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-white text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-center mb-5">
          <div className="bg-white px-4 py-2 rounded-2xl shadow-md border border-slate-200">
            <GesLogo size="sm" showTagline={true} variant="blue" />
          </div>
        </div>

        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center mb-4 shadow-inner">
          <Lock className="w-8 h-8 text-amber-400" />
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
          Performans ve İndirim Raporu
        </h2>
        <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
          Bu alan yönetim ve satınalma şefleri performans karnesi, tasarruf puanları ve gizli analizleri içerdiğinden <strong className="text-amber-300">PIN korumalıdır</strong>.
        </p>

        {/* PIN Entry Form */}
        <form onSubmit={handleVerifyPin} className="mt-6 space-y-4 max-w-xs mx-auto">
          <div className="relative">
            <input
              type={showPinMask ? 'text' : 'password'}
              maxLength={8}
              autoFocus
              value={enteredPin}
              onChange={(e) => {
                setEnteredPin(e.target.value);
                setPinError('');
              }}
              placeholder="PIN Kodunu Girin..."
              className={`w-full text-center text-xl font-mono tracking-widest px-4 py-3.5 bg-slate-950 border ${
                pinError ? 'border-rose-500' : 'border-slate-700 focus:border-amber-500'
              } rounded-2xl text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-all ${
                isShaking ? 'animate-shake' : ''
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPinMask(!showPinMask)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
            >
              {showPinMask ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {pinError && (
            <div className="flex items-center justify-center space-x-1.5 text-xs text-rose-400 font-bold bg-rose-500/10 py-2 px-3 rounded-xl border border-rose-500/30">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{pinError}</span>
            </div>
          )}

          {/* Quick Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => {
                  setEnteredPin(prev => prev + digit);
                  setPinError('');
                }}
                className="py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-mono font-bold text-sm rounded-xl border border-slate-700 transition-colors cursor-pointer"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setEnteredPin('')}
              className="py-2.5 bg-slate-800/40 hover:bg-rose-900/30 text-rose-400 font-bold text-xs rounded-xl border border-slate-800 transition-colors cursor-pointer"
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={() => {
                setEnteredPin(prev => prev + '0');
                setPinError('');
              }}
              className="py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-mono font-bold text-sm rounded-xl border border-slate-700 transition-colors cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setEnteredPin(prev => prev.slice(0, -1))}
              className="py-2.5 bg-slate-800/40 hover:bg-amber-900/30 text-amber-400 font-bold text-xs rounded-xl border border-slate-800 transition-colors cursor-pointer"
            >
              ← Sil
            </button>
          </div>

          <button
            type="submit"
            className="w-full mt-3 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm rounded-2xl shadow-lg transition-transform active:scale-98 flex items-center justify-center space-x-2 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>Raporu Aç & Giriş Yap</span>
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800 text-[11px] text-slate-500">
          Güvenlik Protokolü • GES Construction Satınalma ve Raporlama Altyapısı
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // UNLOCKED REPORT VIEW
  // -------------------------------------------------------------
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner / Hero Summary */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl border border-indigo-900/40 relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 text-xs font-black uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Satınalma Şefleri & Personel Performans Analizi</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">
              Kazanılan İndirim & Pazarlık Raporları
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              Şeflerin ve personellerin pazarlık yeteneğiyle sağlanan net tasarruflar ve şantiye bazlı indirim performans analizleri.
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* İndirim Alınmayan Faturalar (Doğrudan Fatura Girişleri) Sorgu & Baskı Raporu */}
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('undiscounted_invoices')}
                className={`font-bold px-3.5 py-2.5 rounded-xl transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer shadow-md ${
                  activeViewMode === 'undiscounted_invoices'
                    ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white ring-2 ring-amber-300 font-black'
                    : 'bg-rose-500/25 text-amber-200 border border-rose-400/50 hover:bg-rose-500/35'
                }`}
                title="AI Otomatik Fatura Okuma'da kayıtlı olup Şef İndirim & TDF Teklif Merkezi'nden indirim alınmayan faturaları listele ve Excel/PDF/HTML indir"
              >
                <ShieldAlert className="w-4 h-4 text-amber-300" />
                <span>İndirim Alınmayan Faturalar 🎯</span>
                {undiscountedInvoicesCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-black rounded-md bg-rose-950/70 text-amber-300 border border-amber-400/30">
                    {undiscountedInvoicesCount}
                  </span>
                )}
              </button>
            )}

            {/* Executive Only: Fiyat Kıyaslaması & İndirim Doğrulama (Yöntem 1 & Yöntem 2 Mix) */}
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('audit')}
                className={`font-bold px-3.5 py-2.5 rounded-xl transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer shadow-md ${
                  activeViewMode === 'audit'
                    ? 'bg-rose-600 text-white ring-2 ring-rose-400 font-black'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                }`}
                title="Yönetici Özel: Yöntem 1 (Fiyat Kıyaslaması) & Yöntem 2 (Aşırı İndirim Denetimi)"
              >
                <Scale className="w-4 h-4 text-rose-400" />
                <span>Fiyat & İndirim Denetimi ⚖️</span>
              </button>
            )}

            {/* Executive Only: Tedarikçi Çeşitliliği & Tekelleşme Denetimi */}
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('diversity')}
                className={`font-bold px-3.5 py-2.5 rounded-xl transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer shadow-md ${
                  activeViewMode === 'diversity'
                    ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300 font-black'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                }`}
                title="Yönetici Özel: Tedarikçi Çeşitliliği ve Tekelleşme Risk Denetimi"
              >
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Çeşitlilik & Risk Denetimi 🔒</span>
              </button>
            )}

            {/* Download Styled HTML Report */}
            <button
              onClick={handleDownloadHtmlReport}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3.5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer"
              title="Kurumsal tasarımlı tek dosya HTML rapor indir"
            >
              <FileCode className="w-4 h-4 text-indigo-200" />
              <span>HTML Rapor</span>
            </button>

            {/* TEK TUŞLA AYLIK YÖNETİCİ RAPORU */}
            <button
              onClick={() => setShowMonthlyExecutiveModal(true)}
              className="bg-gradient-to-r from-amber-500 via-amber-600 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-slate-950 hover:text-white font-black px-4 py-2.5 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer border border-amber-400/40 transform hover:-translate-y-0.5"
              title="Aylık Yönetici Satınalma, Tasarruf ve Malzeme Kıyas Raporunu Tek Tuşla Al"
            >
              <Sparkles className="w-4 h-4 text-slate-950 hover:text-white" />
              <span>Aylık Yönetici Raporu (Tek Tuş)</span>
              <span className="bg-slate-950 text-amber-300 text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase">YENİ</span>
            </button>

            {/* Print / Save as PDF */}
            <button
              onClick={handlePrintPdfReport}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer"
              title="Yazdır veya PDF olarak kaydet"
            >
              <Printer className="w-4 h-4 text-emerald-200" />
              <span>PDF / Yazdır</span>
            </button>

            {/* Preview HTML/PDF Report Modal */}
            <button
              onClick={() => setShowPreviewModal(true)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3.5 py-2.5 rounded-xl transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer"
              title="Yönetici Raporunu Önizle"
            >
              <Eye className="w-4 h-4" />
              <span>Önizle</span>
            </button>

            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3.5 py-2.5 rounded-xl transition-all flex items-center space-x-2 text-xs sm:text-sm cursor-pointer"
              title="Ham Excel / CSV Olarak İndir"
            >
              <Download className="w-4 h-4" />
              <span>CSV</span>
            </button>

            {/* Re-Lock Report */}
            <button
              onClick={handleLockReport}
              className="bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60 font-bold px-3 py-2.5 rounded-xl transition-all flex items-center space-x-1.5 text-xs cursor-pointer"
              title="Raporu Koru & PIN Kilidini Yeniden Aktif Et"
            >
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span>Kilitle</span>
            </button>
          </div>
        </div>

        {/* Aggregate KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Toplam Kazanılan İndirim</span>
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">
              {formatTL(totalDiscount)}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 space-y-1">
              <div className="text-[11px] font-bold flex items-center justify-between">
                <span className="text-emerald-300 flex items-center space-x-1">
                  <span>⭐ Piyasa Bazlı (KPI):</span>
                </span>
                <span className="font-mono text-emerald-300">
                  {formatTL(totalRealMarketSavings)}
                  <span className="text-slate-400 font-normal ml-1">({totalComparativeCount} dosya)</span>
                </span>
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between">
                <span>📜 Klasik / Legacy Bilgi:</span>
                <span className="font-mono text-slate-300">
                  {formatTL(totalLegacySavings)}
                  <span className="text-slate-400 font-normal ml-1">({totalLegacyCount} dosya)</span>
                </span>
              </div>
              {totalDisqualifiedMarketCount > 0 && (
                <div className="text-[10px] text-amber-400/90 flex items-center justify-between">
                  <span>⚠️ Şart Bekleyen Piyasa:</span>
                  <span className="font-mono">{totalDisqualifiedMarketCount} dosya</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Ortalama İndirim Oranı</span>
              <Percent className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono">
              %{overallAvgDiscountPct}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Tüm şantiyeler genel pazarlık başarısı
            </div>
          </div>

          <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Toplam Anlaşılan Tutarlar</span>
              <Briefcase className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-slate-100 font-mono">
              {formatTL(totalAgreedPrice)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate">
              Liste Tutar: {formatTL(totalListPrice)}
            </div>
          </div>

          <div className="bg-slate-900/90 backdrop-blur border border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Lider Satınalma Şefi</span>
              <Award className="w-4 h-4 text-amber-300" />
            </div>
            <div className="text-base sm:text-lg font-black text-amber-300 truncate">
              {topSupervisor ? topSupervisor.supervisorName : 'Kayıt Yok'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate">
              {topSupervisor ? `${formatTL(topSupervisor.totalDiscountAmount)} (%${topSupervisor.avgDiscountPercentage})` : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Container with View Navigation */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
        {/* Navigation Tabs Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center space-x-2">
              <Award className="w-6 h-6 text-amber-500" />
              <span>Satınalma Performans ve İndirim Karnesi</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Şeflerin ve kadrolarındaki personellerin sağladığı tasarruflar, pazarlık emeği puanları ve detaylı indirim kayıtları.
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="flex flex-wrap items-center bg-slate-100 p-1.5 rounded-2xl text-xs font-bold text-slate-600">
            <button
              onClick={() => setActiveViewMode('matrix')}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                activeViewMode === 'matrix' ? 'bg-white text-indigo-600 font-black shadow-sm' : 'hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Şefler Matrisi</span>
            </button>
            <button
              onClick={() => setActiveViewMode('personnel')}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                activeViewMode === 'personnel' ? 'bg-white text-indigo-600 font-black shadow-sm' : 'hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Personel Karnesi</span>
            </button>
            <button
              onClick={() => setActiveViewMode('cards')}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                activeViewMode === 'cards' ? 'bg-white text-indigo-600 font-black shadow-sm' : 'hover:text-slate-900'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>Şef Kartları</span>
            </button>
            <button
              onClick={() => setActiveViewMode('chart')}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                activeViewMode === 'chart' ? 'bg-white text-indigo-600 font-black shadow-sm' : 'hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Grafikler</span>
            </button>
            <button
              onClick={() => setActiveViewMode('logs')}
              className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                activeViewMode === 'logs' ? 'bg-white text-indigo-600 font-black shadow-sm' : 'hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>İndirim Günlüğü ({filteredDiscounts.length})</span>
            </button>
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('undiscounted_invoices')}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                  activeViewMode === 'undiscounted_invoices'
                    ? 'bg-gradient-to-r from-rose-600 to-amber-600 text-white font-black shadow-md'
                    : 'text-rose-900 bg-rose-50 hover:bg-rose-100 border border-rose-300/60'
                }`}
              >
                <FileText className="w-4 h-4 text-rose-600" />
                <span>İndirim Alınmayan Faturalar (Sorgu & Baskı) 🎯</span>
                {undiscountedInvoicesCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-black rounded-md bg-rose-900 text-white">
                    {undiscountedInvoicesCount}
                  </span>
                )}
              </button>
            )}
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('audit')}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                  activeViewMode === 'audit'
                    ? 'bg-gradient-to-r from-rose-600 to-indigo-600 text-white font-black shadow-md'
                    : 'text-rose-800 bg-rose-50/70 hover:bg-rose-100 border border-rose-300/40'
                }`}
              >
                <Scale className="w-4 h-4 text-rose-600" />
                <span>Fiyat & İndirim Denetimi ⚖️</span>
              </button>
            )}
            {isEffectiveUnlocked && (
              <button
                onClick={() => setActiveViewMode('diversity')}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                  activeViewMode === 'diversity'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-md'
                    : 'text-amber-800 bg-amber-50/60 hover:bg-amber-100/80 border border-amber-300/40'
                }`}
              >
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>Tedarikçi Çeşitliliği & Tekelleşme 🔒</span>
              </button>
            )}
            {isAdminOnlyUnlocked && (
              <button
                onClick={() => setActiveViewMode('historical_anomalies')}
                className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                  activeViewMode === 'historical_anomalies'
                    ? 'bg-gradient-to-r from-rose-700 to-red-900 text-white font-black shadow-md'
                    : 'text-rose-900 bg-rose-100/80 hover:bg-rose-200/80 border border-rose-400/50'
                }`}
              >
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <span>İndirimli Kayıtta Farklı Faturalar (Admin) 🔒</span>
                {allHistoricalAnomalies.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-black rounded-md bg-rose-950/30 text-white">
                    {allHistoricalAnomalies.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* View Mode 1: Şantiyeler & Şefler Çapraz İndirim Matrisi (Table View) */}
        {activeViewMode === 'matrix' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-2">
                <Target className="w-4 h-4 text-emerald-600" />
                <span>Şef Bazında Gol / Asist ve Pazarlık Efor Matrisi</span>
              </h3>
              <span className="text-xs text-slate-500 font-medium">Toplam {computedPerformances.length} Satınalma Şefi</span>
            </div>

            {/* Rule summary banner */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-900/60 rounded-2xl p-4 text-xs text-slate-300 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-2 border-b border-indigo-800/40">
                <span className="font-extrabold text-amber-300 flex items-center space-x-2 text-sm">
                  <span>⚡</span>
                  <span>Adil Pazarlık Efor & Performans Endeksi (Dengeli Skor):</span>
                </span>
                <span className="text-[11px] text-slate-400 font-medium">
                  Yalnızca yüzdeye değil; kasaya giren reel nakit tasarrufuna ve masadaki bireysel mücadeleye dayalı adil puanlama
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-[11px]">
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-emerald-500/20">
                  <span className="font-black text-emerald-400 block mb-0.5">1️⃣ Bireysel GOL (%30)</span>
                  <p className="text-slate-300">Şefin bizzat masaya oturup indirim koparma azmi. 45 gol = 100 tam puan.</p>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-indigo-500/20">
                  <span className="font-black text-indigo-400 block mb-0.5">2️⃣ Reel Tasarruf (%20)</span>
                  <p className="text-slate-300">Kasaya kazandırılan net nakit hacmi (13.2M ve 6.9M reel tasarruf ödüllendirilir).</p>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-amber-500/20">
                  <span className="font-black text-amber-400 block mb-0.5">3️⃣ İşlem Kapsamı (%20)</span>
                  <p className="text-slate-300">Her alımda indirim talep etme kararlılığı (61 işlem vs 7 işlem ayrımı).</p>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-cyan-500/20">
                  <span className="font-black text-cyan-400 block mb-0.5">4️⃣ Ekip Asisti (%15)</span>
                  <p className="text-slate-300">Altındaki personellerin işlemlerine liderlik ve organizasyonel başarı.</p>
                </div>
                <div className="bg-slate-800/80 rounded-xl p-2.5 border border-pink-500/20">
                  <span className="font-black text-pink-400 block mb-0.5">5️⃣ Oran & Tur (%15)</span>
                  <p className="text-slate-300">İskonto oranı verimliliği (%10) ve müzakere tur derinliği (%5).</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-200 font-bold border-b border-slate-800">
                    <th className="py-3.5 px-4">Satınalma Şefi</th>
                    <th className="py-3.5 px-4">Pazarlık İcrası (GOL / ASİST)</th>
                    <th className="py-3.5 px-4">Toplam İşlem</th>
                    <th className="py-3.5 px-4 text-emerald-400">Kazanılan İndirim (₽)</th>
                    <th className="py-3.5 px-4 text-amber-300">Ort. İndirim (%)</th>
                    <th className="py-3.5 px-4 text-indigo-300">Ort. Tur</th>
                    <th className="py-3.5 px-4 text-pink-300">Pazarlık Emeği</th>
                    <th className="py-3.5 px-4">Şantiye Katkıları (₽ / %)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {computedPerformances.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 italic">
                        Henüz kayıtlı performans verisi bulunmamaktadır.
                      </td>
                    </tr>
                  ) : (
                    sortedPerformances.map((perf) => {
                      const stats = supervisorStatsMap.get(perf.supervisorId) || {
                        golCount: perf.totalGol || 0,
                        asistCount: perf.totalAsist || 0,
                        totalRounds: 0,
                        avgRounds: perf.avgNegotiationRounds || 0,
                        effortScore: perf.negotiationEffortScore || 0,
                        procedureViolations: perf.procedureViolationCount || 0
                      };
                      const sup = supervisors.find(s => s.id === perf.supervisorId);
                      const breakdowns = Array.isArray(perf.jobsiteBreakdown) ? perf.jobsiteBreakdown : [];

                      return (
                        <tr key={perf.supervisorId} className="hover:bg-slate-50/90 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-black text-slate-900">{perf.supervisorName}</span>
                              {stats.newVendors > 0 && (
                                <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black" title={`${stats.newVendors} adet yeni tedarikçi kazandırıldı (+Bonus Efor Puanı)`}>
                                  <span>🌟 +{stats.newVendors} Yeni Firma</span>
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 font-medium">
                              {sup?.department || 'Satınalma Birimi'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center space-x-1.5 whitespace-nowrap">
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-black">
                                <Target className="w-3 h-3 text-emerald-600" />
                                <span>{stats.golCount} GOL</span>
                              </span>
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-black">
                                <Users className="w-3 h-3 text-indigo-600" />
                                <span>{stats.asistCount} ASİST</span>
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-700">{perf.totalTransactions} Sipariş</td>
                          <td className="py-3.5 px-4">
                            <div>
                              <span className="font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 font-mono inline-block">
                                {formatTL(perf.totalDiscountAmount)}
                              </span>
                              {(perf.totalRealMarketSavings || 0) > 0 && (
                                <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                                  ⭐ Piyasa: {formatTL(perf.totalRealMarketSavings || 0)} ({perf.marketSavingsCount || 0})
                                </div>
                              )}
                              {(perf.totalLegacySavings || 0) > 0 && (perf.totalRealMarketSavings || 0) > 0 && (
                                <div className="text-[10px] text-slate-500 font-medium">
                                  📜 Klasik: {formatTL(perf.totalLegacySavings || 0)}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-black text-amber-700 bg-amber-50 px-2 py-1 rounded-xl border border-amber-200 font-mono">
                              %{perf.avgDiscountPercentage}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-black text-indigo-700">
                            {stats.avgRounds} Tur
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-pink-50 text-pink-700 border border-pink-200 font-black font-mono">
                              <Flame className="w-3.5 h-3.5 text-pink-500" />
                              <span>{stats.effortScore}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1 max-w-sm">
                              {breakdowns.length === 0 ? (
                                <span className="text-slate-400 text-xs">-</span>
                              ) : (
                                breakdowns.map(jb => (
                                  <span
                                    key={jb.jobsiteId}
                                    className="inline-flex items-center space-x-1 text-[11px] px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-800"
                                  >
                                    <span className="font-bold text-slate-900 truncate max-w-[110px]">{jb.jobsiteName}:</span>
                                    <span className="font-extrabold text-emerald-700">{formatTL(jb.discountAmount)}</span>
                                    <span className="text-[10px] text-amber-600 font-bold">(%{jb.discountPercentage})</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View Mode 2: Assistant Personnel Performance Scorecard */}
        {activeViewMode === 'personnel' && (
          <div className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-indigo-600 text-xs font-black uppercase tracking-wider mb-1">
                <Users className="w-4 h-4" />
                <span>Satınalma Personeli (Asist) Performans Karnesi</span>
              </div>
              <h3 className="text-lg font-black text-slate-900">
                Personel Bazlı Pazarlık Başarısı & Efor Puanı
              </h3>
              <p className="text-xs text-slate-500">
                Şeflerine destek veren yardımcı personellerin yürüttüğü pazarlıklar, sağlanan indirim hacimleri ve pazarlık emeği katsayıları
              </p>
            </div>

            {/* Rule summary banner */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              <span className="font-bold text-slate-900 flex items-center space-x-1">
                <span>⚡</span>
                <span>Puanlama Formülü:</span>
              </span>
              <span>1️⃣ Pazarlık tur sayısı arttıkça katsayı çarpanı artar</span>
              <span>2️⃣ Tedarikçi ağına eklenen her YENİ FİRMA için +Bonus Efor Puanı (🌟 Kaşif Rozeti)</span>
              <span>3️⃣ Alınan her indirim bağlı şefe ASİST olarak yansır</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-900 text-slate-200 font-bold border-b border-slate-800">
                    <th className="py-3.5 px-4">Personel Adı</th>
                    <th className="py-3.5 px-4">Bağlı Olduğu Şef</th>
                    <th className="py-3.5 px-4 text-center">Asist Sayısı</th>
                    <th className="py-3.5 px-4 text-emerald-400">Kazanılan İndirim (₽)</th>
                    <th className="py-3.5 px-4 text-amber-300">Ort. İndirim (%)</th>
                    <th className="py-3.5 px-4 text-indigo-300">Ort. Pazarlık Turu</th>
                    <th className="py-3.5 px-4 text-pink-300">Pazarlık Emeği Puanı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {personnelPerformanceList.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                        Henüz yardımcı personel tarafından yürütülen pazarlık kaydı bulunmamaktadır.
                      </td>
                    </tr>
                  ) : (
                    personnelPerformanceList.map((pers) => (
                      <tr key={pers.id} className="hover:bg-slate-50/90 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-black text-slate-900">{pers.name}</span>
                            {pers.totalNewVendors > 0 && (
                              <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black" title={`${pers.totalNewVendors} adet yeni firma kazandırdı (+Bonus Efor Puanı)`}>
                                <span>🌟 +{pers.totalNewVendors} Yeni Firma</span>
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 font-medium">{pers.title}</div>
                        </td>
                        <td className="py-3.5 px-4 font-semibold text-slate-700">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-bold">
                            {pers.supervisorName}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-black text-xs">
                            <Users className="w-3 h-3 text-indigo-600" />
                            <span>{pers.totalAssists} Asist</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 font-mono">
                            {formatTL(pers.totalDiscountAmount)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-black text-amber-700">
                          %{pers.avgDiscountPercentage}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-black text-indigo-700">
                          {pers.avgRounds} Tur
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-pink-50 text-pink-700 border border-pink-200 font-black font-mono text-sm">
                            <Flame className="w-3.5 h-3.5 text-pink-500" />
                            <span>{pers.effortScore}</span>
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View Mode 3: Supervisor Cards Grid */}
        {activeViewMode === 'cards' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {computedPerformances.map((perf, index) => {
              const supInfo = supervisors.find(s => s.id === perf.supervisorId);
              const breakdowns = Array.isArray(perf.jobsiteBreakdown) ? perf.jobsiteBreakdown : [];
              return (
                <div
                  key={perf.supervisorId}
                  className="bg-slate-50/80 border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 shadow-xs transition-all space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3.5">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-black flex items-center justify-center text-lg shadow-md border-2 border-indigo-200">
                        {perf.supervisorName.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-black text-slate-900 text-base">{perf.supervisorName}</h3>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                            #{index + 1} Derece
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-semibold">{supInfo?.title || 'Satınalma Şefi'}</p>
                        <p className="text-[11px] text-slate-400">{supInfo?.department || 'Satınalma Birimi'}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="inline-block text-xs font-black px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        %{perf.avgDiscountPercentage} İndirim
                      </span>
                    </div>
                  </div>

                  {/* Financial Stats Bar */}
                  <div className="grid grid-cols-3 gap-2 bg-white rounded-2xl p-3.5 border border-slate-200/80 text-center shadow-xs">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-black">Kazanılan İndirim</p>
                      <p className="text-sm font-black text-emerald-600 font-mono">{formatTL(perf.totalDiscountAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-black">Anlaşılan Fiyat</p>
                      <p className="text-sm font-bold text-slate-800 font-mono">{formatTL(perf.totalAgreedPrice)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-black">İşlem Sayısı</p>
                      <p className="text-sm font-black text-indigo-600">{perf.totalTransactions} Sipariş</p>
                    </div>
                  </div>

                  {/* Şantiye Bazlı İndirim Dağılımı Detayı */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Şantiye Bazlı İndirim Katkısı:</span>
                      <span className="text-[11px] text-slate-400">En Yüksek: {perf.topJobsiteName}</span>
                    </p>

                    <div className="space-y-1.5">
                      {breakdowns.length === 0 ? (
                        <div className="text-xs text-slate-400 italic bg-white p-2.5 rounded-xl border border-slate-100">
                          Henüz şantiye kaydı bulunmuyor.
                        </div>
                      ) : (
                        breakdowns.map((jb) => (
                          <div key={jb.jobsiteId} className="flex items-center justify-between text-xs bg-white px-3 py-2 rounded-xl border border-slate-100 shadow-xs">
                            <span className="text-slate-700 font-bold truncate max-w-[180px]">{jb.jobsiteName}</span>
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-black text-slate-900">{formatTL(jb.discountAmount)}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold border border-amber-200">
                                %{jb.discountPercentage} Katkı
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View Mode 4: Charts */}
        {activeViewMode === 'chart' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Bar Chart: Supervisor comparison */}
            <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 shadow-xs">
              <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                <span>Şef Bazında Liste vs Anlaşılan & İndirim Tutar Karşılaştırması</span>
              </h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={supervisorChartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k₽`} />
                    <Tooltip formatter={(value: any) => formatTL(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="Liste Fiyatı" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Anlaşılan Fiyat" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Kazanılan İndirim" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pie Chart: Jobsite discount share */}
            <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 shadow-xs">
              <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-amber-500" />
                <span>Şantiyelere Göre Kazanılan Toplam İndirim Dağılımı</span>
              </h3>
              <div className="h-72 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={jobsitePieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} (%${((percent || 0) * 100).toFixed(0)})`}
                      outerRadius={85}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {jobsitePieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => formatTL(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* View Mode 5: Detailed Discount Log Table with Search & Filter */}
        {activeViewMode === 'logs' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-black text-slate-900">Münferit İndirim Kayıtları Detay Listesi</h3>
                <p className="text-xs text-slate-500">Sisteme aktarılan, şef veya yardımcı personel tarafından elde edilen tüm indirimler</p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Input */}
                <div className="relative min-w-[180px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Şef, Personel, Şantiye ara..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Dedicated Fatura No Filter */}
                <div className="relative w-36">
                  <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Fatura No..."
                    value={invoiceNoFilter}
                    onChange={(e) => setInvoiceNoFilter(e.target.value)}
                    className="w-full pl-8 pr-6 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-slate-800"
                  />
                  {invoiceNoFilter && (
                    <button
                      type="button"
                      onClick={() => setInvoiceNoFilter('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Filter Supervisor */}
                <SearchableFilterDropdown
                  label="Şef"
                  selectedKey={selectedSupervisorId === 'ALL' ? 'all' : selectedSupervisorId}
                  options={[
                    { key: 'all', label: 'Tüm Şefler', count: supervisors.length },
                    ...supervisors.map(s => ({
                      key: s.id,
                      label: s.name,
                      subtext: s.email
                    }))
                  ]}
                  onSelect={(key) => setSelectedSupervisorId(key === 'all' ? 'ALL' : key)}
                  placeholder="Şef ara..."
                />

                {/* Filter Jobsite */}
                <SearchableFilterDropdown
                  label="Şantiye"
                  selectedKey={selectedJobsiteId === 'ALL' ? 'all' : selectedJobsiteId}
                  options={[
                    { key: 'all', label: 'Tüm Şantiyeler', count: jobsites.length },
                    ...jobsites.map(j => ({
                      key: j.id,
                      label: j.name,
                      subtext: j.code
                    }))
                  ]}
                  onSelect={(key) => setSelectedJobsiteId(key === 'all' ? 'ALL' : key)}
                  placeholder="Şantiye ara..."
                />

                {/* Filter Vendor */}
                <SearchableFilterDropdown
                  label="Tedarikçi"
                  selectedKey={selectedVendor === 'ALL' ? 'all' : selectedVendor}
                  options={[
                    { key: 'all', label: 'Tüm Tedarikçiler', count: canonicalVendors.length },
                    ...canonicalVendors.map(v => ({
                      key: v.name,
                      label: v.name,
                      count: v.count
                    }))
                  ]}
                  onSelect={(key) => setSelectedVendor(key === 'all' ? 'ALL' : key)}
                  placeholder="Tedarikçi ara..."
                />

                {/* Date Range Filter */}
                <DateRangeFilterDropdown
                  value={dateFilter}
                  onChange={setDateFilter}
                />

                {/* Reset Filters */}
                {isAnyFilterActive && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="px-2.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs"
                    title="Tüm filtreleri sıfırla"
                  >
                    <X className="w-3.5 h-3.5 text-amber-700" />
                    <span>Filtreleri Temizle</span>
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th className="py-3 px-3">Tarih</th>
                    <th className="py-3 px-3">Satınalma Şefi</th>
                    <th className="py-3 px-3">Pazarlık İcrası</th>
                    <th className="py-3 px-3">Ait Olduğu Şantiye</th>
                    <th className="py-3 px-3">Tedarikçi Firma</th>
                    <th className="py-3 px-3">Kategori</th>
                    <th className="py-3 px-3">Liste Fiyatı</th>
                    <th className="py-3 px-3">Anlaşılan Fiyat</th>
                    <th className="py-3 px-3 text-emerald-700">Net İndirim (₽)</th>
                    <th className="py-3 px-3 text-amber-700">İndirim %</th>
                    <th className="py-3 px-3 text-center">Tur</th>
                    <th className="py-3 px-3">Not / Açıklama</th>
                    <th className="py-3 px-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {filteredDiscounts.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-8 text-center text-slate-400 italic">
                        Arama ve filtrenize uygun indirim kaydı bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredDiscounts.map((d) => {
                      const perm = checkRecordPermission(user, d.supervisorId, d.supervisorName);
                      const isAsist = d.recordOriginType === 'asist' || (d as any).recordOrigin === 'asist' || d.performedByPersonnelId || d.performedByPersonnelName;
                      const roundCount = getGenuineNegotiationRoundCount(d);
                      const hasWarning = Array.isArray(d.procedureWarnings) && d.procedureWarnings.length > 0;
                      const isHighValue = (d.offerPrice || 0) >= NEGOTIATION_THRESHOLD || (d.agreedPrice || 0) >= NEGOTIATION_THRESHOLD;

                      return (
                        <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3 text-slate-500 whitespace-nowrap text-xs">
                            {d.orderDate ? formatUploadDate(d.orderDate) : '-'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-900">{d.supervisorName}</span>
                          </td>
                          <td className="py-3 px-3">
                            {isAsist ? (
                              <div>
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-black">
                                  <Users className="w-3 h-3 text-indigo-500" />
                                  <span>ASİST</span>
                                </span>
                                <div className="text-[10px] text-slate-500 font-semibold truncate max-w-[110px]">
                                  {d.performedByPersonnelName || 'Personel'}
                                </div>
                              </div>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-black">
                                <Target className="w-3 h-3 text-emerald-600" />
                                <span>GOL</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-700">
                            {d.jobsiteName}
                          </td>
                          <td className="py-3 px-3 font-black text-slate-900">
                            {d.vendorName}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-500">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-bold">
                              {d.category || 'Genel'}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-700">
                            {formatTL(d.offerPrice || 0)}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-slate-900">
                            {formatTL(d.agreedPrice || 0)}
                          </td>
                          <td className="py-3 px-3 font-mono font-black text-emerald-600">
                            {formatTL(d.discountAmount || 0)}
                          </td>
                          <td className="py-3 px-3 font-mono font-black text-amber-700">
                            %{d.discountPercentage}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {roundCount > 0 ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-indigo-100 text-indigo-950 border border-indigo-400 shadow-2xs">
                                <span className="text-indigo-600 font-black">🎯</span>
                                <span>{roundCount} Tur</span>
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs font-mono">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-600 max-w-xs truncate" title={d.notes || d.description}>
                            <span>{d.notes || d.description || '-'}</span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {perm.canEdit ? (
                              <button
                                onClick={() => setEditingRecord(d)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                title="İndirim Kaydını Düzenle"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span className="text-slate-300 text-xs italic">Kilitli</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View Mode 6: Yönetici Özel - Tedarikçi Çeşitliliği & Tekelleşme Denetimi */}
        {activeViewMode === 'diversity' && isEffectiveUnlocked && (
          <ExecutiveVendorDiversityReport
            discounts={discounts}
            supervisors={supervisors}
            personnel={personnel}
            jobsites={jobsites}
            performances={computedPerformances}
          />
        )}

        {/* View Mode 7: Yönetici Özel - Fiyat Kıyaslaması & İndirim Doğrulama Denetimi (Yöntem 1 & Yöntem 2 Mix) */}
        {activeViewMode === 'audit' && isEffectiveUnlocked && (
          <ExecutivePriceAndDiscountAudit
            discounts={discounts}
            comparisons={comparisons}
            invoices={invoices}
            historicalInvoices={combinedInvoicePool}
            onUpdateDiscount={onUpdateDiscount}
          />
        )}

        {/* View Mode 7B: İndirim Alınmayan Faturalar (Şef İndirim & TDF Merkezi Harici Doğrudan Faturalar) Sorgu ve Savunma Raporu */}
        {activeViewMode === 'undiscounted_invoices' && isEffectiveUnlocked && (
          <UndiscountedInvoicesAuditReport
            invoices={invoices}
            discounts={discounts}
            supervisors={supervisors}
            jobsites={jobsites}
            generatedBy={user?.displayName || 'Satınalma Yönetimi'}
            onUpdateInvoice={onUpdateInvoice}
          />
        )}

        {/* View Mode 8: Admin Özel - İndirimli Kayıtta & Doğrudan Yüklenenlerde Farklı Faturalar */}
        {activeViewMode === 'historical_anomalies' && isAdminOnlyUnlocked && (() => {
          const filteredAnomalies = filteredHistoricalAnomalies;
          const totalOverpaymentSum = filteredAnomalies.reduce((s, a) => s + a.totalPotentialExtraSavings, 0);
          const totalAffectedLinesCount = filteredAnomalies.reduce((s, a) => s + a.affectedLines.length, 0);
          const activeFilterLabel = (() => {
            const base =
              anomalySourceFilter === 'DISCOUNT_CENTER'
                ? 'Şef İndirim & Teklif Merkezi'
                : anomalySourceFilter === 'DIRECT_INVOICE'
                ? 'AI Otomatik Fatura Okuma (Doğrudan Yüklenenler)'
                : 'Tümü (Şef İndirim Merkezi + AI Otomatik Fatura Okuma)';
            const extras: string[] = [];
            if (anomalyInvoiceNoFilter.trim()) extras.push(`Fatura: #${anomalyInvoiceNoFilter.trim()}`);
            if (anomalyVendorFilter !== 'ALL') extras.push(`Tedarikçi: ${anomalyVendorFilter}`);
            if (anomalyJobsiteFilter !== 'ALL') extras.push(`Şantiye: ${anomalyJobsiteFilter}`);
            if (anomalySupervisorFilter !== 'ALL') {
              const sup = anomalyUniqueSupervisors.find(x => x.id === anomalySupervisorFilter);
              extras.push(`Şef: ${sup?.name || anomalySupervisorFilter}`);
            }
            if (anomalyDateFilter.preset && anomalyDateFilter.preset !== 'all') {
              extras.push(`Tarih: ${getDateFilterDisplayLabel(anomalyDateFilter)}`);
            }
            if (anomalyMinDiffFilter > 0) {
              extras.push(`Min Fark: ≥ ${anomalyMinDiffFilter.toLocaleString('tr-TR')} ₽`);
            }
            if (historicalAnomalySearch.trim()) {
              extras.push(`Arama: "${historicalAnomalySearch.trim()}"`);
            }
            return extras.length > 0 ? `${base} · ${extras.join(' · ')}` : base;
          })();

          return (
            <div className="p-6 space-y-6">
              {/* Top Executive Banner */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-950 via-rose-950 to-slate-900 text-white border border-rose-500/40 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-400/40 text-rose-300 text-[10px] font-black uppercase tracking-wider">
                      🔒 SADECE ADMİN / YÖNETİCİ GÖRÜNÜMÜ
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
                      ORİJİNAL RUSÇA METİN & %100 BİREBİR ÖZELLİK DENETİMİ
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
                    <span>Admin Fiyat Anomali Denetimi (Orijinal Dilde %100 Aynı Malzemenin Daha Uyguna Alındığı Faturalar)</span>
                  </h3>
                  <p className="text-xs text-slate-300 max-w-3xl">
                    Türkçe çeviri hatalarından etkilenmemek için doğrudan faturadaki <strong>orijinal Rusça malzeme tanımı</strong> üzerinden markası, modeli, kalınlığı, ölçüleri, yoğunluğu ve standardı <strong>%100 birebir aynı</strong> olup sistemde en az %1 daha düşük birim fiyata alınmış kalemleri içeren faturalar (Şef İndirim Merkezi ve AI Otomatik Fatura Okuma) listelenir.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Tespit Edilen Fatura</div>
                    <div className="text-lg font-mono font-black text-white">{filteredAnomalies.length} Adet</div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Etkilenen Malzeme</div>
                    <div className="text-lg font-mono font-black text-amber-300">{totalAffectedLinesCount} Kalem</div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-rose-500/20 border border-rose-400/40 text-center">
                    <div className="text-[10px] font-bold text-rose-200 uppercase">Geçmiş En İyi Fiyata Göre Fark</div>
                    <div className="text-lg font-mono font-black text-rose-300">+{formatRuble(totalOverpaymentSum)}</div>
                  </div>
                </div>
              </div>

              {/* 3-Way Source Filter Selector & Report Export Action Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAnomalySourceFilter('ALL')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      anomalySourceFilter === 'ALL'
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                    }`}
                  >
                    <span>Tümü</span>
                    <span className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] ${
                      anomalySourceFilter === 'ALL' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {allHistoricalAnomalies.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnomalySourceFilter('DISCOUNT_CENTER')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      anomalySourceFilter === 'DISCOUNT_CENTER'
                        ? 'bg-indigo-700 text-white shadow-sm'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                    }`}
                  >
                    <span>Şef İndirim & Teklif Merkezi</span>
                    <span className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] ${
                      anomalySourceFilter === 'DISCOUNT_CENTER' ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-800'
                    }`}>
                      {discountCenterAnomalies.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnomalySourceFilter('DIRECT_INVOICE')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      anomalySourceFilter === 'DIRECT_INVOICE'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                    }`}
                  >
                    <span>AI Otomatik Fatura Okuma (Doğrudan Yüklenenler)</span>
                    <span className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] ${
                      anomalySourceFilter === 'DIRECT_INVOICE' ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-900'
                    }`}>
                      {directInvoiceAnomalies.length}
                    </span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAnomalyReportModal(true)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-700 to-slate-900 hover:from-indigo-600 hover:to-slate-800 text-white font-black text-xs shadow-sm transition-all cursor-pointer flex items-center gap-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                    <span>📊 Raporla & İndir (TDF Stilinde Excel / PDF / HTML)</span>
                  </button>
                </div>
              </div>

              {/* Dedicated Admin Anomaly Multi-Filter Toolbar (Fatura No, Tedarikçi, Tarih, Şantiye, Şef, Min Fark) */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Fatura No Filtresi */}
                  <div className="relative">
                    <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
                      <Hash className="w-3 h-3 text-slate-400" />
                      <span>Fatura Numarası</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={anomalyInvoiceNoFilter}
                        onChange={(e) => setAnomalyInvoiceNoFilter(e.target.value)}
                        placeholder="Fatura no ara (örn. 041598)..."
                        className="w-full pl-3 pr-7 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                      />
                      {anomalyInvoiceNoFilter && (
                        <button
                          type="button"
                          onClick={() => setAnomalyInvoiceNoFilter('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tedarikçi Filtresi */}
                  <SearchableFilterDropdown
                    label="Alınan Tedarikçi"
                    selectedKey={anomalyVendorFilter === 'ALL' ? 'all' : anomalyVendorFilter}
                    options={[
                      { key: 'all', label: 'Tüm Tedarikçiler', count: anomalyUniqueVendors.length },
                      ...anomalyUniqueVendors.map(v => ({
                        key: v.name,
                        label: v.name,
                        count: v.count
                      }))
                    ]}
                    onSelect={(key) => setAnomalyVendorFilter(key === 'all' ? 'ALL' : key)}
                    placeholder="Tedarikçi ara..."
                  />

                  {/* Tarih Aralığı Filtresi */}
                  <DateRangeFilterDropdown
                    value={anomalyDateFilter}
                    onChange={setAnomalyDateFilter}
                  />

                  {/* Şantiye Filtresi */}
                  <SearchableFilterDropdown
                    label="Şantiye"
                    selectedKey={anomalyJobsiteFilter === 'ALL' ? 'all' : anomalyJobsiteFilter}
                    options={[
                      { key: 'all', label: 'Tüm Şantiyeler', count: anomalyUniqueJobsites.length },
                      ...anomalyUniqueJobsites.map(j => ({
                        key: j.name,
                        label: j.name,
                        count: j.count
                      }))
                    ]}
                    onSelect={(key) => setAnomalyJobsiteFilter(key === 'all' ? 'ALL' : key)}
                    placeholder="Şantiye ara..."
                  />
                </div>

                {/* Sub-row: Satınalma Şefi, Min Fark Tutarı Quick Chips, Free Search & Reset */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Satınalma Şefi Dropdown */}
                    <div className="w-56">
                      <SearchableFilterDropdown
                        label="Satınalma Şefi"
                        selectedKey={anomalySupervisorFilter === 'ALL' ? 'all' : anomalySupervisorFilter}
                        options={[
                          { key: 'all', label: 'Tüm Şefler', count: anomalyUniqueSupervisors.length },
                          ...anomalyUniqueSupervisors.map(s => ({
                            key: s.id,
                            label: s.name,
                            count: s.count
                          }))
                        ]}
                        onSelect={(key) => setAnomalySupervisorFilter(key === 'all' ? 'ALL' : key)}
                        placeholder="Şef ara..."
                      />
                    </div>

                    {/* Min Fark Tutarı Hızlı Butonları */}
                    <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
                      <span className="text-[10px] font-bold text-slate-500 px-2 uppercase">Fark:</span>
                      {[
                        { label: 'Tümü', val: 0 },
                        { label: '≥ 5.000 ₽', val: 5000 },
                        { label: '≥ 25.000 ₽', val: 25000 },
                        { label: '≥ 100.000 ₽', val: 100000 }
                      ].map(chip => (
                        <button
                          key={chip.val}
                          type="button"
                          onClick={() => setAnomalyMinDiffFilter(chip.val)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            anomalyMinDiffFilter === chip.val
                              ? 'bg-rose-600 text-white shadow-2xs'
                              : 'bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Free Text Search & Clear Button */}
                  <div className="flex items-center gap-2 flex-1 lg:max-w-md">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={historicalAnomalySearch}
                        onChange={(e) => setHistoricalAnomalySearch(e.target.value)}
                        placeholder="Malzeme adı, referans firma veya detay ara..."
                        className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                      />
                      {historicalAnomalySearch && (
                        <button
                          type="button"
                          onClick={() => setHistoricalAnomalySearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {isAnyAnomalyFilterActive && (
                      <button
                        type="button"
                        onClick={handleResetAnomalyFilters}
                        className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs"
                        title="Tüm filtreleri temizle"
                      >
                        <X className="w-3.5 h-3.5 text-rose-600" />
                        <span>Temizle</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Active Filters Summary Pill row */}
                {isAnyAnomalyFilterActive && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 text-xs">
                    <span className="text-[11px] font-bold text-slate-500">Aktif Filtreler:</span>
                    {anomalyInvoiceNoFilter.trim() && (
                      <span className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 font-mono text-[11px] font-bold flex items-center gap-1">
                        Fatura #{anomalyInvoiceNoFilter.trim()}
                        <X className="w-3 h-3 cursor-pointer text-indigo-500 hover:text-indigo-800" onClick={() => setAnomalyInvoiceNoFilter('')} />
                      </span>
                    )}
                    {anomalyVendorFilter !== 'ALL' && (
                      <span className="px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold flex items-center gap-1">
                        Tedarikçi: {anomalyVendorFilter}
                        <X className="w-3 h-3 cursor-pointer text-amber-500 hover:text-amber-800" onClick={() => setAnomalyVendorFilter('ALL')} />
                      </span>
                    )}
                    {anomalyDateFilter.preset && anomalyDateFilter.preset !== 'all' && (
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-bold flex items-center gap-1">
                        Tarih: {getDateFilterDisplayLabel(anomalyDateFilter)}
                        <X className="w-3 h-3 cursor-pointer text-emerald-500 hover:text-emerald-800" onClick={() => setAnomalyDateFilter({ preset: 'all' })} />
                      </span>
                    )}
                    {anomalyJobsiteFilter !== 'ALL' && (
                      <span className="px-2 py-0.5 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-900 text-[11px] font-bold flex items-center gap-1">
                        Şantiye: {anomalyJobsiteFilter}
                        <X className="w-3 h-3 cursor-pointer text-cyan-500 hover:text-cyan-800" onClick={() => setAnomalyJobsiteFilter('ALL')} />
                      </span>
                    )}
                    {anomalySupervisorFilter !== 'ALL' && (
                      <span className="px-2 py-0.5 rounded-lg bg-purple-50 border border-purple-200 text-purple-900 text-[11px] font-bold flex items-center gap-1">
                        Şef: {anomalyUniqueSupervisors.find(s => s.id === anomalySupervisorFilter)?.name || anomalySupervisorFilter}
                        <X className="w-3 h-3 cursor-pointer text-purple-500 hover:text-purple-800" onClick={() => setAnomalySupervisorFilter('ALL')} />
                      </span>
                    )}
                    {anomalyMinDiffFilter > 0 && (
                      <span className="px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 font-mono text-[11px] font-bold flex items-center gap-1">
                        Fark ≥ {anomalyMinDiffFilter.toLocaleString('tr-TR')} ₽
                        <X className="w-3 h-3 cursor-pointer text-rose-500 hover:text-rose-800" onClick={() => setAnomalyMinDiffFilter(0)} />
                      </span>
                    )}
                    {historicalAnomalySearch.trim() && (
                      <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-800 text-[11px] font-bold flex items-center gap-1">
                        Arama: "{historicalAnomalySearch.trim()}"
                        <X className="w-3 h-3 cursor-pointer text-slate-500 hover:text-slate-800" onClick={() => setHistoricalAnomalySearch('')} />
                      </span>
                    )}
                    <span className="text-[11px] text-slate-500 font-medium ml-auto">
                      {filteredAnomalies.length} fatura listelendi
                    </span>
                  </div>
                )}
              </div>

              {/* Invoice-Level Anomaly Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-white font-bold border-b border-slate-800">
                      <th className="py-3 px-3">Fatura & Tarih</th>
                      <th className="py-3 px-3">Kaynak Modül</th>
                      <th className="py-3 px-3">Satınalma Şefi / Şantiye</th>
                      <th className="py-3 px-3">Alınan Tedarikçi</th>
                      <th className="py-3 px-3 text-right">Fatura Tutarı</th>
                      <th className="py-3 px-3 text-right text-emerald-400">Beyan Edilen İndirim</th>
                      <th className="py-3 px-3 text-center text-amber-300">Pahalı Kalem</th>
                      <th className="py-3 px-3 text-right text-rose-300">Geçmiş En Uygun Fiyata Göre Fark</th>
                      <th className="py-3 px-3 text-center">İncele</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800 bg-white">
                    {filteredAnomalies.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-10 text-center text-slate-500 font-medium">
                          Seçili kriterlerde geçmiş alımlardan daha yüksek birim fiyatlı kalem içeren fatura bulunmadı.
                        </td>
                      </tr>
                    ) : (
                      filteredAnomalies.map((anom) => {
                        const isDirect = anom.recordSource === 'DIRECT_INVOICE';
                        return (
                          <tr
                            key={anom.discountId}
                            onClick={() => setSelectedHistoricalAnomaly(anom)}
                            className="hover:bg-rose-50/60 transition-colors cursor-pointer group"
                          >
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="font-mono font-black text-slate-900 group-hover:text-rose-700">
                                #{anom.invoiceNo}
                              </div>
                              <div className="text-[11px] text-slate-500">{anom.orderDate}</div>
                            </td>
                            <td className="py-3 px-3">
                              {isDirect ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                                  AI Otomatik Fatura Okuma
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-300 text-[10px] font-black">
                                  Şef İndirim Merkezi
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-bold text-slate-900">{anom.supervisorName}</div>
                              <div className="text-[11px] font-semibold text-indigo-700">{anom.jobsiteName}</div>
                            </td>
                            <td className="py-3 px-3 font-bold text-slate-900">
                              {anom.vendorName}
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              {!isDirect && anom.offerPrice > anom.agreedPrice && (
                                <div className="text-[11px] text-slate-400 line-through">{formatRuble(anom.offerPrice)}</div>
                              )}
                              <div className="font-bold text-slate-900">{formatRuble(anom.agreedPrice)}</div>
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                              {isDirect ? (
                                <span className="text-slate-400 text-xs font-normal">Doğrudan Fatura</span>
                              ) : (
                                `+${formatRuble(anom.claimedDiscountAmount)}`
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 font-black text-xs border border-amber-300">
                                {anom.affectedLines.length} Kalem
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-black text-rose-700 bg-rose-50/40">
                              +{formatRuble(anom.totalPotentialExtraSavings)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedHistoricalAnomaly(anom);
                                }}
                                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-700 text-white font-bold text-xs transition-colors cursor-pointer"
                              >
                                Detay Aç
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Invoice Anomaly Drilldown Modal */}
              {selectedHistoricalAnomaly && (
                <div
                  className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
                  onClick={() => setSelectedHistoricalAnomaly(null)}
                >
                  <div
                    className="bg-white border border-slate-200 rounded-3xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Modal Header */}
                    <div className="px-6 py-4 bg-gradient-to-r from-slate-950 via-rose-950 to-slate-900 text-white flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-rose-500/30 border border-rose-400/40 text-rose-200 text-[10px] font-black uppercase">
                            ADMİN FİYAT ANOMALİ DENETİMİ
                          </span>
                          <span className="text-xs font-mono text-slate-300">
                            Fatura No: #{selectedHistoricalAnomaly.invoiceNo} • Tarih: {selectedHistoricalAnomaly.orderDate}
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-black text-white">
                          {selectedHistoricalAnomaly.vendorName} — {selectedHistoricalAnomaly.jobsiteName} ({selectedHistoricalAnomaly.supervisorName})
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedHistoricalAnomaly(null)}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Modal Body */}
                    <div className="p-6 overflow-y-auto space-y-5">
                      {/* Buyer Notification Status Banner */}
                      <div className="p-4 rounded-2xl bg-indigo-50 border-2 border-indigo-300 text-indigo-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <ShieldAlert className="w-6 h-6 text-indigo-700 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="text-xs sm:text-sm font-black uppercase text-indigo-950">
                              📌 Satınalmacı Ön İzleme & Bildirim Durumu: KAYDETMEDEN ÖNCE SATINALMACIYA BİLDİRİLDİ
                            </h4>
                            <p className="text-xs text-indigo-800 mt-0.5">
                              Bu fatura kaydedilirken sistem aşağıdaki malzemelerin daha önce daha uygun fiyata alındığını satınalmacıya ön izleme ekranında açıkça göstermiştir. Buna rağmen fatura bu rakamlarla kaydedilmiştir.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {selectedHistoricalAnomaly.firstOfferFileUrl && (
                            <button
                              type="button"
                              onClick={() => openOriginalFileViewer(selectedHistoricalAnomaly.firstOfferFileUrl!, `Ilk_Teklif_${selectedHistoricalAnomaly.invoiceNo}.pdf`)}
                              className="px-3 py-1.5 rounded-xl bg-white hover:bg-indigo-100 text-indigo-900 border border-indigo-300 text-xs font-bold cursor-pointer"
                            >
                              📄 İlk Teklifi Gör
                            </button>
                          )}
                          {selectedHistoricalAnomaly.finalOfferFileUrl && (
                            <button
                              type="button"
                              onClick={() => openOriginalFileViewer(selectedHistoricalAnomaly.finalOfferFileUrl!, `Nihai_Fatura_${selectedHistoricalAnomaly.invoiceNo}.pdf`)}
                              className="px-3 py-1.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold cursor-pointer"
                            >
                              📄 Nihai Faturayı Gör
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Financial Summary Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">İlk Teklif Tutarı</div>
                          <div className="text-base font-mono font-bold text-slate-800 mt-0.5">
                            {formatRuble(selectedHistoricalAnomaly.offerPrice)}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">Anlaşılan Nihai Tutar</div>
                          <div className="text-base font-mono font-black text-slate-900 mt-0.5">
                            {formatRuble(selectedHistoricalAnomaly.agreedPrice)}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                          <div className="text-[10px] font-bold text-emerald-700 uppercase">Kaydedilen İndirim</div>
                          <div className="text-base font-mono font-black text-emerald-700 mt-0.5">
                            +{formatRuble(selectedHistoricalAnomaly.claimedDiscountAmount)}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300">
                          <div className="text-[10px] font-bold text-rose-800 uppercase">Geçmiş En Uygun Fiyata Göre Fark</div>
                          <div className="text-base font-mono font-black text-rose-700 mt-0.5">
                            +{formatRuble(selectedHistoricalAnomaly.totalPotentialExtraSavings)}
                          </div>
                        </div>
                      </div>

                      {/* Line Items Comparison Table */}
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-200">
                              <th className="py-2.5 px-3">Malzeme & Marka (Aynı Ürün)</th>
                              <th className="py-2.5 px-3 text-right">Miktar</th>
                              <th className="py-2.5 px-3 text-right">Bu Faturada Alınan Birim</th>
                              <th className="py-2.5 px-3 text-right text-emerald-800">Daha Önce Alınan En Uygun Birim</th>
                              <th className="py-2.5 px-3">Daha Önce Alınan Firma, Şantiye & Tarih</th>
                              <th className="py-2.5 px-3 text-right text-rose-700">Birim / Toplam Fazla Ödeme</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {selectedHistoricalAnomaly.affectedLines.map((line, idx) => (
                              <tr key={idx} className="hover:bg-rose-50/30">
                                <td className="py-2.5 px-3 font-bold text-slate-900">
                                  <div className="font-mono text-xs text-slate-950 font-black">
                                    🇷🇺 {line.originalName || line.materialName}
                                  </div>
                                  {line.historicalOriginalName && line.historicalOriginalName !== (line.originalName || line.materialName) && (
                                    <div className="text-[10px] font-mono text-emerald-800 mt-0.5">
                                      ↳ Eşleşen Kayıt: {line.historicalOriginalName}
                                    </div>
                                  )}
                                  {line.materialName && line.materialName !== line.originalName && (
                                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                                      TR: {line.materialName}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                  {line.quantity} {line.unit}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                                  {formatRuble(line.currentUnitPrice)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-700 bg-emerald-50/50">
                                  {formatRuble(line.historicalBestUnitPrice)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                    <span>{line.historicalSupplier}</span>
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-300">
                                      {line.historicalSource === 'PRIZMA_ERP' ? 'Prizma ERP' : 'GES Arşivi'}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-indigo-700 font-medium mt-0.5 flex flex-wrap items-center gap-1">
                                    <span>📍 {line.historicalJobsiteName} • 📅 {line.historicalDate} •</span>
                                    <button
                                      type="button"
                                      onClick={() => openHistoricalReferenceInvoice(line)}
                                      className="font-mono font-black text-indigo-700 hover:text-rose-700 underline underline-offset-2 cursor-pointer"
                                      title="Tıklayarak bu geçmiş faturanın kalemlerini ve detaylarını açın"
                                    >
                                      Fatura: #{line.historicalInvoiceNo}
                                    </button>
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openHistoricalReferenceInvoice(line)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] shadow-2xs transition-colors cursor-pointer"
                                      title="Geçmiş faturanın tüm kalemlerini ve detaylarını incele"
                                    >
                                      <FileText className="w-3 h-3" />
                                      <span>Fatura Detayı & Kalemler</span>
                                    </button>
                                    {line.historicalFileUrl && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openOriginalFileViewer(
                                            line.historicalFileUrl!,
                                            `Gecmis_Fatura_${line.historicalInvoiceNo}.pdf`,
                                            {
                                              supplier: line.historicalSupplier,
                                              date: line.historicalDate,
                                              jobsiteName: line.historicalJobsiteName,
                                              invoiceNumber: line.historicalInvoiceNo,
                                              invoiceNo: line.historicalInvoiceNo
                                            }
                                          )
                                        }
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-[10px] transition-colors cursor-pointer"
                                        title="Geçmiş faturanın orijinal PDF belgesini doğrudan aç"
                                      >
                                        <ExternalLink className="w-3 h-3 text-emerald-700" />
                                        <span>Orijinal PDF Aç</span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-black text-rose-700">
                                  <div>+{formatRuble(line.unitOverpayment)} / {line.unit} (+%{line.overpaymentPercentage})</div>
                                  <div className="text-[11px] text-rose-600">Toplam Fark: +{formatRuble(line.totalLineOverpayment)}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Historical Reference Invoice Detail Modal (renders above the anomaly modal) */}
              {viewingHistoricalInvoice && (
                <InvoiceDetailModal
                  invoice={viewingHistoricalInvoice}
                  jobsites={jobsites}
                  supervisors={supervisors}
                  onClose={() => setViewingHistoricalInvoice(null)}
                />
              )}

              {/* Full-Screen Line-by-Line Anomaly Report Preview & Export Modal (TDF Style) */}
              {showAnomalyReportModal && (
                <div
                  className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
                  onClick={() => setShowAnomalyReportModal(false)}
                >
                  <div
                    className="bg-slate-900 border border-slate-700 rounded-3xl max-w-[1600px] w-full h-[92vh] flex flex-col shadow-2xl overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header & Export Buttons */}
                    <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-white">
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                          <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                          <span>Kalem Bazlı Fiyat Anomali ve Orijinal Rusça Malzeme Doğrulama Raporu</span>
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Kapsam: {activeFilterLabel} ({filteredAnomalies.length} Fatura / {totalAffectedLinesCount} Malzeme Kalemi)
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isExportingAnomalyReport}
                          onClick={async () => {
                            setIsExportingAnomalyReport(true);
                            try {
                              await downloadAnomalyReportExcel(filteredAnomalies, {
                                filterLabel: activeFilterLabel,
                                generatedBy: user?.displayName || 'Admin'
                              });
                            } finally {
                              setIsExportingAnomalyReport(false);
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          <span>Excel İndir (.xlsx - TDF Formatı)</span>
                        </button>

                        <button
                          type="button"
                          disabled={isExportingAnomalyReport}
                          onClick={async () => {
                            setIsExportingAnomalyReport(true);
                            try {
                              await downloadAnomalyReportPdf(filteredAnomalies, {
                                filterLabel: activeFilterLabel,
                                generatedBy: user?.displayName || 'Admin'
                              });
                            } finally {
                              setIsExportingAnomalyReport(false);
                            }
                          }}
                          className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          <span>PDF İndir (.pdf)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            downloadAnomalyReportHtml(filteredAnomalies, {
                              filterLabel: activeFilterLabel,
                              generatedBy: user?.displayName || 'Admin'
                            })
                          }
                          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                        >
                          <FileCode className="w-4 h-4" />
                          <span>HTML İndir (.html)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowAnomalyReportModal(false)}
                          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Embedded HTML Report Preview */}
                    <div className="flex-1 bg-slate-200 p-2 sm:p-4 overflow-hidden">
                      <iframe
                        title="Admin Fiyat Anomali Denetim Raporu Önizleme"
                        srcDoc={renderAnomalyReportHtml(filteredAnomalies, {
                          filterLabel: activeFilterLabel,
                          generatedBy: user?.displayName || 'Admin'
                        })}
                        className="w-full h-full bg-white rounded-2xl border border-slate-300 shadow-inner"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Edit Discount Modal */}
      {editingRecord && (
        <EditDiscountModal
          record={editingRecord}
          jobsites={jobsites}
          supervisors={supervisors}
          personnel={personnel}
          onClose={() => setEditingRecord(null)}
          onSave={async (updatedData) => {
            if (onUpdateDiscount) {
              await onUpdateDiscount(editingRecord.id, updatedData);
            }
            setEditingRecord(null);
          }}
          onDelete={async (id) => {
            if (onDeleteDiscount) {
              await onDeleteDiscount(id);
            }
            setEditingRecord(null);
          }}
        />
      )}

      {/* Executive Report Preview & Print Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950 text-white">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-100">
                    Yönetici Raporu Canlı Önizleme & Yazdırma
                  </h3>
                  <p className="text-xs text-slate-400">
                    Yüksek çözünürlüklü, kurumsal formatlı PDF ve HTML döküm önizlemesi
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDownloadHtmlReport}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer shadow-sm transition-colors"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>HTML İndir</span>
                </button>
                <button
                  onClick={handlePrintPdfReport}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 cursor-pointer shadow-sm transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>PDF / Yazdır</span>
                </button>
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body - Iframe Preview */}
            <div className="flex-1 bg-slate-100 p-2 sm:p-4 overflow-hidden">
              <iframe
                title="Executive Report Preview"
                srcDoc={generatedHtmlReport}
                className="w-full h-full rounded-2xl border border-slate-300 shadow-md bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* ONE-CLICK MONTHLY EXECUTIVE REPORT MODAL */}
      <MonthlyExecutiveReportModal
        isOpen={showMonthlyExecutiveModal}
        onClose={() => setShowMonthlyExecutiveModal(false)}
        discounts={discounts}
        invoices={invoices}
        jobsites={jobsites}
        supervisors={supervisors}
        personnel={personnel}
        comparisons={comparisons}
      />
    </div>
  );
};
