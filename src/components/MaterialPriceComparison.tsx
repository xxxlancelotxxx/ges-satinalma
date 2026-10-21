import { useAuth } from '../context/AuthContext';
import { normalizeCategoryName, CANONICAL_CATEGORIES, sortCategoriesByPriority, ensureRussianOriginalName } from '../utils/categoryClassifier';
import { analyzeMaterialSegment } from '../utils/materialSegmentIntelligence';
import {
  DualComparisonLens,
  CrossBrandEquivalentFamily,
  buildMode1AppleToAppleComparisons,
  getSynchronizedAppleToAppleComparisons,
  buildMode2CrossBrandFamilies,
  findCheaperEquivalentBrandSuggestion,
  isPrizmaHistoryRecord,
  isGesArchiveHistoryRecord,
  recalculateMaterialComparisonForSource
} from '../utils/dualMaterialComparisonEngine';
export { isPrizmaHistoryRecord, isGesArchiveHistoryRecord, recalculateMaterialComparisonForSource };
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { materialFingerprint } from '../utils/materialFingerprint';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter } from '../utils/filterHelpers';
import { normalizeVendorName, areVendorsEqual, extractCanonicalVendors } from '../utils/vendorNormalizer';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MaterialComparison, Jobsite, InvoiceRecord, PurchasingSupervisor } from '../types';
import { formatRuble, openOriginalFileViewer, formatUploadDate } from '../utils/format';
import { getPrizmaBtfUrl } from '../utils/prizmaUrlHelper';
import { useLanguage } from '../context/LanguageContext';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import {
  BarChart3,
  Search,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Tag,
  Sparkles,
  Link2,
  X,
  Loader2,
  Info,
  Check,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  SlidersHorizontal,
  Table,
  Layers,
  ArrowUpDown,
  Building2,
  FileText,
  Eye,
  ExternalLink,
  Store,
  Download,
  Folder,
  FolderOpen,
  Grid,
  Package,
  Filter,
  Calculator,
  Scale,
  RefreshCw,
  Coffee,
  Compass,
  Crosshair,
  Monitor,
  Hammer,
  Home,
  Boxes,
  Trees,
  Wrench,
  ShieldAlert,
  Truck
} from 'lucide-react';
import { UnitConversionLabModal } from './UnitConversionLabModal';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts';

interface Props {
  comparisons: MaterialComparison[];
  invoices?: InvoiceRecord[];
  jobsites: Jobsite[];
  supervisors?: PurchasingSupervisor[];
  initialMaterialName?: string;
  initialMaterialId?: string;
  initialCategory?: string;
  initialSourceFilter?: 'all' | 'prizma_only' | 'local_only';
  /** Changes on every external navigation so the same target can be opened again. */
  navRequestSeq?: number;
  onRefreshData?: () => Promise<void>;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => void | Promise<void>;
  onDeleteInvoice?: (id: string) => void | Promise<void>;
}

const ROWS_PER_GROUP = 25;

export const MaterialPriceComparison: React.FC<Props> = ({
  comparisons,
  invoices = [],
  jobsites,
  supervisors = [],
  initialMaterialName,
  initialMaterialId,
  initialCategory,
  initialSourceFilter,
  navRequestSeq,
  onRefreshData,
  onUpdateInvoice,
  onDeleteInvoice
}) => {
  const { t } = useLanguage();
  const {user} = useAuth();
  const [selectedMaterialName, setSelectedMaterialName] = useState<string>(
    initialMaterialId || initialMaterialName || comparisons[0]?.materialName || ''
  );
  // Detail modal is opened only by the user or by an explicit navigation target (applied below).
  const [expandedMaterialName, setExpandedMaterialName] = useState<string | null>(null);

  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<InvoiceRecord | null>(null);

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [prizmaSourceFilter, setPrizmaSourceFilter] = useState<'all' | 'prizma_only' | 'local_only'>(
    initialSourceFilter || 'all'
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedJobsite, setSelectedJobsite] = useState<string>('ALL');
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('ALL');
  const [invoiceNoFilter, setInvoiceNoFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [onlyWithPriceGap, setOnlyWithPriceGap] = useState<boolean>(false);
  const [comparisonModeFilter, setComparisonModeFilter] = useState<'ALL' | 'COMMODITY_STANDARD' | 'BRAND_SEGMENTED'>('ALL');
  const [qualitySegmentFilter, setQualitySegmentFilter] = useState<'ALL' | 'PREMIUM' | 'STANDARD' | 'ECONOMY'>('ALL');
  const [sortBy, setSortBy] = useState<'gap' | 'spend' | 'name' | 'qty'>('gap');

  // Dual Comparison Lens State:
  // MODE_1_APPLE_TO_APPLE: Same brand + same spec (or GOST commodity) across jobsites/vendors
  // MODE_2_BRAND_EQUIVALENT: Different brands with identical original technical specs (Knauf vs Volma, Icopal vs TechnoNICOL)
  const [dualComparisonLens, setDualComparisonLens] = useState<DualComparisonLens>('MODE_1_APPLE_TO_APPLE');
  const [simSelectedFamilyId, setSimSelectedFamilyId] = useState<string>('');
  const [simSourceBrandKey, setSimSourceBrandKey] = useState<string>('');
  const [simTargetBrandKey, setSimTargetBrandKey] = useState<string>('');
  const [simCustomQty, setSimCustomQty] = useState<string>('');
  const [mode2SearchTerm, setMode2SearchTerm] = useState<string>('');

  // External navigation is a one-shot request: it is applied once, then the user's own
  // filter changes (or a data refresh) must never bring it back.
  const navRequestKey = `${navRequestSeq || 0}|${initialMaterialId || ''}|${initialMaterialName || ''}|${initialCategory || ''}`;
  const appliedNavKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialSourceFilter) {
      setPrizmaSourceFilter(initialSourceFilter);
    }
  }, [navRequestKey]);

  // AI & Manual Merge States
  const [isAnalyzingAI, setIsAnalyzingAI] = useState<boolean>(false);
  const [mergeResultsModal, setMergeResultsModal] = useState<{
    mergedCount: number;
    mergedPairs: { original?: string; source?: string; canonical: string; reason?: string }[];
  } | null>(null);

  const [showManualMergeModal, setShowManualMergeModal] = useState<boolean>(false);
  const [manualSource, setManualSource] = useState<string>('');
  const [manualTarget, setManualTarget] = useState<string>('');
  const [isMergingManual, setIsMergingManual] = useState<boolean>(false);

  // Otomatik birleştirme önerileri + yanlış gruplanan satırı ayırma
  type MergeSuggestionView = { sourceId: string; sourceName: string; targetId: string; targetName: string; score: number; reason: string };
  const [showSuggestionsModal, setShowSuggestionsModal] = useState<boolean>(false);
  const [mergeSuggestions, setMergeSuggestions] = useState<MergeSuggestionView[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<{ groups: number; manualGroups: number; aliases: number; persistent: boolean; aliasSource: string } | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);
  const [busySuggestionKey, setBusySuggestionKey] = useState<string>('');
  const DISMISSED_SUGGESTIONS_KEY = 'ges_dismissed_merge_suggestions';
  const readDismissedSuggestions = (): string[] => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_SUGGESTIONS_KEY) || '[]'); } catch { return []; }
  };
  const suggestionKey = (s: MergeSuggestionView) => `${s.sourceName}→${s.targetName}`;
  const authHeaders = () => ({ 'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || '') });

  const loadMergeSuggestions = async () => {
    setIsLoadingSuggestions(true);
    try {
      const res = await fetch('/api/materials/merge-suggestions?_t=' + Date.now(), { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Öneriler alınamadı');
      const dismissed = new Set(readDismissedSuggestions());
      setMergeSuggestions((data.suggestions || []).filter((s: MergeSuggestionView) => !dismissed.has(suggestionKey(s))));
      setCatalogStatus(data.catalog || null);
    } catch (err: any) {
      console.error('Merge suggestions error:', err);
      alert('Birleştirme önerileri alınamadı: ' + err.message);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const applyMergeSuggestion = async (s: MergeSuggestionView) => {
    setBusySuggestionKey(suggestionKey(s));
    try {
      const res = await fetch('/api/materials/merge', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sourceName: s.sourceName, targetName: s.targetName, sourceId: s.sourceId, targetId: s.targetId })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Bilinmeyen hata');
      setMergeSuggestions(prev => prev.filter(x => suggestionKey(x) !== suggestionKey(s) && x.sourceName !== s.sourceName));
      if (data.warning) alert(`${data.message}\n\n⚠️ ${data.warning}`);
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      alert('Birleştirme hatası: ' + err.message);
    } finally {
      setBusySuggestionKey('');
    }
  };

  const dismissMergeSuggestion = (s: MergeSuggestionView) => {
    try {
      const list = readDismissedSuggestions();
      list.push(suggestionKey(s));
      localStorage.setItem(DISMISSED_SUGGESTIONS_KEY, JSON.stringify(list.slice(-500)));
    } catch { /* tarayıcı depolaması yoksa yalnızca bu oturumda gizle */ }
    setMergeSuggestions(prev => prev.filter(x => suggestionKey(x) !== suggestionKey(s)));
  };

  const splitHistoryLine = async (mat: MaterialComparison, hist: any) => {
    const orig = hist.rawOriginalName || hist.originalName;
    if (!orig) return;
    if (!window.confirm(`"${orig}" satırı "${mat.materialName}" malzemesinden ayrılıp ayrı bir kayda alınsın mı?\n\nBu karar kalıcıdır; aynı satır yeni faturalarda da ayrı kayda düşer.`)) return;
    try {
      const res = await fetch('/api/materials/split', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ groupName: mat.materialName, groupId: (mat as any).id, invoiceId: hist.invoiceId, originalName: orig })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || data.message || 'Bilinmeyen hata');
      alert(data.warning ? `${data.message}\n\n⚠️ ${data.warning}` : data.message);
      if (onRefreshData) await onRefreshData();
    } catch (err: any) {
      alert('Ayırma hatası: ' + err.message);
    }
  };

  // Category Edit Modal State
  const [categoryEditModal, setCategoryEditModal] = useState<{ materialName: string; currentCategory: string } | null>(null);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false);

  // Smart Construction Unit Normalization & Lab States
  const [priceDisplayMode, setPriceDisplayMode] = useState<'normalized' | 'original'>('normalized');
  const [onlyMultipleUnits, setOnlyMultipleUnits] = useState<boolean>(false);
  const [showUnitLabModal, setShowUnitLabModal] = useState<boolean>(false);
  const [labSelectedMaterial, setLabSelectedMaterial] = useState<string>('Арматура А500С ф12 мм');
  const [labSelectedUnit, setLabSelectedUnit] = useState<string>('metre');

  // Retroactive Global Audit States
  const [isRetroAuditing, setIsRetroAuditing] = useState<boolean>(false);
  const [retroAuditModal, setRetroAuditModal] = useState<{
    success: boolean;
    message: string;
    totalInvoicesAudited: number;
    totalItemsAudited: number;
    itemsUpdated: number;
    invoicesUpdated: number;
    auditSummary?: Record<string, number>;
    details?: Array<{
      invoiceNumber: string;
      rawName: string;
      canonicalName: string;
      category: string;
      unit: string;
    }>;
  } | null>(null);

  useModalBackHandler(!!selectedInvoiceForModal, () => setSelectedInvoiceForModal(null));
  useModalBackHandler(!!mergeResultsModal, () => setMergeResultsModal(null));
  useModalBackHandler(showManualMergeModal, () => setShowManualMergeModal(false));
  useModalBackHandler(!!categoryEditModal, () => setCategoryEditModal(null));
  useModalBackHandler(showUnitLabModal, () => setShowUnitLabModal(false));
  useModalBackHandler(!!retroAuditModal, () => setRetroAuditModal(null));

  const SYSTEM_CATEGORIES = CANONICAL_CATEGORIES.map(c => c.nameTr);

  const handleSaveCategoryChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryEditModal || !newCategoryInput.trim()) return;

    setIsSavingCategory(true);
    try {
      const res = await fetch('/api/materials/update-category', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || '') },
        body: JSON.stringify({
          materialName: categoryEditModal.materialName,
          category: newCategoryInput.trim(),
          newCategory: newCategoryInput.trim()
        })
      });
      if (!res.ok) {
        throw new Error('Kategori güncellenemedi.');
      }
      setCategoryEditModal(null);
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err: any) {
      alert('Kategori değiştirilirken bir hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setIsSavingCategory(false);
    }
  };

  // View Mode & Category Accordion Collapsed States
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  // Rendering every row of ~2,000 groups at once froze the tab; show the top rows per group first.
  const [visibleRowsByCategory, setVisibleRowsByCategory] = useState<Record<string, number>>({});

  const toggleCategoryCollapse = (catName: string) => {
    setCollapsedCategories(prev => {
      const isCurrentlyCollapsed = prev[catName] !== false;
      return {
        ...prev,
        [catName]: !isCurrentlyCollapsed
      };
    });
  };

  const collapseAllCategories = () => {
    const newMap: Record<string, boolean> = {};
    categories.forEach(c => { newMap[c] = true; });
    setCollapsedCategories(newMap);
  };

  const expandAllCategories = () => {
    const newMap: Record<string, boolean> = {};
    categories.forEach(c => { newMap[c] = false; });
    setCollapsedCategories(newMap);
  };

  // Valid non-service materials
  const baseComparisons = useMemo(() => {
    return comparisons.filter(c => {
      const lowerName = c.materialName.toLowerCase();
      const lowerCat = c.category.toLowerCase();
      const isService =
        lowerCat.includes('hizmet') ||
        lowerCat.includes('lojistik') ||
        lowerCat.includes('nakliye') ||
        lowerName.includes('доставк') ||
        lowerName.includes('транспорт') ||
        lowerName.includes('услуг') ||
        lowerName.includes('погрузк') ||
        lowerName.includes('разгрузк') ||
        lowerName.includes('перевозк') ||
        lowerName.includes('экспедировани') ||
        lowerName.includes('аренд') ||
        lowerName.includes('рейс') ||
        lowerName.includes('nakliye') ||
        lowerName.includes('kargo') ||
        lowerName.includes('shipp') ||
        lowerName.includes('deliver') ||
        lowerName.includes('freight') ||
        lowerName.includes('taşıma') ||
        lowerName.includes('tasima') ||
        lowerName.includes('sevkiyat');
      return !isService;
    }).map(c => ({...c, category: normalizeCategoryName(c.category, c.materialName)}));
  }, [comparisons]);

  // Counts for each source toggle. They count the same apple-to-apple groups the list shows
  // (and the dashboard's "Fiyat Kıyas (N)" button), not raw catalog rows. The two inactive
  // sources are computed after first paint so opening the tab is not delayed.
  const rawSourceCounts = useMemo(() => {
    let all = baseComparisons.length;
    let prizma = 0;
    let ges = 0;
    baseComparisons.forEach(c => {
      if (c.history && c.history.some(isPrizmaHistoryRecord)) prizma++;
      if (c.history && c.history.some(isGesArchiveHistoryRecord)) ges++;
    });
    return { all, prizma, ges };
  }, [baseComparisons]);
  const [groupSourceCounts, setGroupSourceCounts] = useState<{ all: number; prizma: number; ges: number } | null>(null);
  useEffect(() => {
    setGroupSourceCounts(null);
    const timer = window.setTimeout(() => {
      setGroupSourceCounts({
        all: getSynchronizedAppleToAppleComparisons(comparisons, 'all').length,
        prizma: getSynchronizedAppleToAppleComparisons(comparisons, 'prizma_only').length,
        ges: getSynchronizedAppleToAppleComparisons(comparisons, 'local_only').length
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [comparisons]);

  // Source-filtered raw comparisons (also normalizes pack-vs-piece unit outliers)
  const sourceFilteredRawComparisons = useMemo(() => {
    const res: MaterialComparison[] = [];
    baseComparisons.forEach(c => {
      const recalculated = recalculateMaterialComparisonForSource(c, prizmaSourceFilter);
      if (recalculated) {
        res.push(recalculated);
      }
    });
    return res;
  }, [baseComparisons, prizmaSourceFilter]);

  // Mode 1 (Apple-to-Apple): Strictly separates different brands for brand-sensitive materials based on originalName,
  // while merging different vendor phrasings of the same brand & spec, and keeping GOST commodities unified.
  const validComparisons = useMemo(() => {
    return buildMode1AppleToAppleComparisons(sourceFilteredRawComparisons);
  }, [sourceFilteredRawComparisons]);

  const sourceCounts = {
    all: prizmaSourceFilter === 'all' ? validComparisons.length : (groupSourceCounts?.all ?? rawSourceCounts.all),
    prizma: prizmaSourceFilter === 'prizma_only' ? validComparisons.length : (groupSourceCounts?.prizma ?? rawSourceCounts.prizma),
    ges: prizmaSourceFilter === 'local_only' ? validComparisons.length : (groupSourceCounts?.ges ?? rawSourceCounts.ges)
  };

  // Mode 2 (Cross-Brand Equivalent Economy): Groups identical original technical specs across different brands
  const mode2CrossBrandFamilies = useMemo<CrossBrandEquivalentFamily[]>(() => {
    return buildMode2CrossBrandFamilies(sourceFilteredRawComparisons);
  }, [sourceFilteredRawComparisons]);

  // Initialize Mode 2 Simulator selection when families load
  useEffect(() => {
    if (mode2CrossBrandFamilies.length > 0) {
      const currentFam = mode2CrossBrandFamilies.find(f => f.familyId === simSelectedFamilyId) || mode2CrossBrandFamilies[0];
      if (!simSelectedFamilyId || !mode2CrossBrandFamilies.some(f => f.familyId === simSelectedFamilyId)) {
        setSimSelectedFamilyId(currentFam.familyId);
      }
      if (currentFam && currentFam.brands.length >= 2) {
        const priciest = currentFam.priciestBrand;
        const cheapest = currentFam.cheapestBrand;
        if (!simSourceBrandKey || !currentFam.brands.some(b => b.brandKey === simSourceBrandKey)) {
          setSimSourceBrandKey(priciest.brandKey);
          setSimCustomQty(String(priciest.totalQuantity || 100));
        }
        if (!simTargetBrandKey || !currentFam.brands.some(b => b.brandKey === simTargetBrandKey)) {
          setSimTargetBrandKey(cheapest.brandKey);
        }
      }
    }
  }, [mode2CrossBrandFamilies, simSelectedFamilyId]);

  // Handle external navigation (from Dashboard, Prizma Invoices, Drive, Anomalies, etc.)
  // Matches directly against `validComparisons` (Apple-to-Apple Mode 1) so the selected row & modal match 100%!
  useEffect(() => {
    if (appliedNavKeyRef.current !== navRequestKey && validComparisons.length > 0) {
      appliedNavKeyRef.current = navRequestKey;
      const q = (initialMaterialName || '').trim();
      const targetId = (initialMaterialId || '').trim();
      const cat = (initialCategory || '').trim();

      if (q || targetId) {
        const lower = q.toLowerCase();
        let match = targetId ? validComparisons.find(c => c.id === targetId) : undefined;

        if (!match && lower) {
          match = validComparisons.find(c => c.materialName.toLowerCase() === lower);
        }

        if (!match && lower) {
          const candidates = validComparisons.filter(
            c =>
              c.materialName.toLowerCase().includes(lower) ||
              lower.includes(c.materialName.toLowerCase()) ||
              c.history.some(
                h =>
                  (h.originalName && h.originalName.toLowerCase().includes(lower)) ||
                  ((h as any).materialName && String((h as any).materialName).toLowerCase().includes(lower))
              )
          );
          if (candidates.length > 0) {
            // Prefer candidates that actually have a price gap and highest totalSpend
            candidates.sort((a, b) => {
              if ((b.priceDifferencePercentage > 0 ? 1 : 0) !== (a.priceDifferencePercentage > 0 ? 1 : 0)) {
                return (b.priceDifferencePercentage > 0 ? 1 : 0) - (a.priceDifferencePercentage > 0 ? 1 : 0);
              }
              return (b.totalSpend || 0) - (a.totalSpend || 0);
            });
            match = candidates[0];
          }
        }

        setSelectedCategory('ALL');
        if (match) {
          // Open the target's detail directly; the list itself stays unfiltered.
          const key = match.id || `${match.materialName}___${match.unit}`;
          setSearchTerm('');
          setSelectedMaterialName(key);
          setExpandedMaterialName(key);
          setCollapsedCategories(prev => ({
            ...prev,
            [match!.category]: false
          }));
          setVisibleRowsByCategory(prev => ({ ...prev, [match!.category]: Number.MAX_SAFE_INTEGER }));
          return;
        }
        // No exact group: show the closest results through the (visible, clearable) search box.
        setSearchTerm(q);
      } else if (cat && cat !== 'ALL') {
        setSelectedCategory(normalizeCategoryName(cat));
        setSearchTerm('');
      }
    }

    // Keep a valid row selected after data/source changes, without opening the detail modal.
    if (validComparisons.length > 0) {
      const exists = validComparisons.some(
        c =>
          (c.id && c.id === selectedMaterialName) ||
          `${c.materialName}___${c.unit}` === selectedMaterialName ||
          c.materialName === selectedMaterialName
      );
      if (!exists || !selectedMaterialName) {
        const firstWithGap = validComparisons.find(c => c.priceDifferencePercentage > 0) || validComparisons[0];
        setSelectedMaterialName(firstWithGap.id || `${firstWithGap.materialName}___${firstWithGap.unit}`);
      }
    }
  }, [navRequestKey, validComparisons]);

  const categories = useMemo<string[]>(() => {
    const uniqueCats = Array.from(new Set(validComparisons.map(c => c.category))) as string[];
    return sortCategoriesByPriority(uniqueCats);
  }, [validComparisons]);

  const categoryStats = useMemo(() => {
    const map: Record<string, { count: number; totalSpend: number; maxGap: number; gapCount: number }> = {};
    validComparisons.forEach(c => {
      if (!map[c.category]) {
        map[c.category] = { count: 0, totalSpend: 0, maxGap: 0, gapCount: 0 };
      }
      map[c.category].count += 1;
      map[c.category].totalSpend += c.totalSpend;
      if (c.priceDifferencePercentage > map[c.category].maxGap) {
        map[c.category].maxGap = c.priceDifferencePercentage;
      }
      if (c.priceDifferencePercentage > 0) {
        map[c.category].gapCount += 1;
      }
    });
    return map;
  }, [validComparisons]);

  const getCategoryIcon = (categoryName: string) => {
    const lower = (categoryName || '').toLowerCase();
    if (lower.includes('ankraj') || lower.includes('анкер')) {
      return <Zap className="w-4 h-4 text-rose-500" />;
    }
    if (lower.includes('donatı') || lower.includes('donati') || lower.includes('karkas') || lower.includes('manşon') || lower.includes('manson')) {
      return <Package className="w-4 h-4 text-orange-500" />;
    }
    if (lower.includes('inşaat demiri') || lower.includes('insaat demiri') || lower.includes('арматур')) {
      return <Layers className="w-4 h-4 text-amber-500" />;
    }
    if (lower.includes('boru') || lower.includes('труб')) {
      return <SlidersHorizontal className="w-4 h-4 text-cyan-500" />;
    }
    if (lower.includes('çelik') || lower.includes('celik') || lower.includes('profil') || lower.includes('köşebent') || lower.includes('kosebent') || lower.includes('сталь')) {
      return <Building2 className="w-4 h-4 text-slate-700" />;
    }
    if (lower.includes('gazbeton') || lower.includes('duvar') || lower.includes('бло') || lower.includes('tuğla')) {
      return <Building2 className="w-4 h-4 text-stone-600" />;
    }
    if (lower.includes('beton') || lower.includes('çimento') || lower.includes('agrega')) {
      return <Layers className="w-4 h-4 text-blue-500" />;
    }
    if (lower.includes('ahşap') || lower.includes('kereste') || lower.includes('ahsap')) {
      return <Trees className="w-4 h-4 text-amber-700" />;
    }
    if (lower.includes('harç') || lower.includes('şap') || lower.includes('harc') || lower.includes('sap') || lower.includes('смесь')) {
      return <Layers className="w-4 h-4 text-orange-600" />;
    }
    if (lower.includes('kalıp') || lower.includes('iskele') || lower.includes('опалуб')) {
      return <Grid className="w-4 h-4 text-amber-600" />;
    }
    if (lower.includes('yalıtım') || lower.includes('alçıpan') || lower.includes('membran')) {
      return <Layers className="w-4 h-4 text-purple-600" />;
    }
    if (lower.includes('elektrik') || lower.includes('kablo')) {
      return <Zap className="w-4 h-4 text-yellow-500" />;
    }
    if (lower.includes('tesisat') || lower.includes('mekanik')) {
      return <SlidersHorizontal className="w-4 h-4 text-cyan-600" />;
    }
    if (lower.includes('kimyasal') || lower.includes('boya')) {
      return <Sparkles className="w-4 h-4 text-rose-500" />;
    }
    if (lower.includes('güvenli') || lower.includes('kkd') || lower.includes('isg')) {
      return <ShieldAlert className="w-4 h-4 text-rose-600" />;
    }
    if (lower.includes('el alet') || lower.includes('alet')) {
      return <Wrench className="w-4 h-4 text-orange-600" />;
    }
    if (lower.includes('kaynak')) {
      return <Hammer className="w-4 h-4 text-rose-500" />;
    }
    if (lower.includes('seramik') || lower.includes('vitrifiye')) {
      return <Package className="w-4 h-4 text-emerald-500" />;
    }
    if (lower.includes('kapı') || lower.includes('iç mekan') || lower.includes('doğrama') || lower.includes('kapi')) {
      return <Building2 className="w-4 h-4 text-teal-600" />;
    }
    if (lower.includes('tabela') || lower.includes('yönlendirme') || lower.includes('yonlendirme') || lower.includes('reklam')) {
      return <Compass className="w-4 h-4 text-sky-500" />;
    }
    if (lower.includes('ölçüm') || lower.includes('harita') || lower.includes('olcum')) {
      return <Crosshair className="w-4 h-4 text-emerald-600" />;
    }
    if (lower.includes('mobilya') || lower.includes('yaşam') || lower.includes('yasam')) {
      return <Home className="w-4 h-4 text-purple-600" />;
    }
    if (lower.includes('konteyner') || lower.includes('tesis')) {
      return <Building2 className="w-4 h-4 text-amber-700" />;
    }
    if (lower.includes('temizlik') || lower.includes('hijyen')) {
      return <Sparkles className="w-4 h-4 text-cyan-500" />;
    }
    if (lower.includes('gıda') || lower.includes('mutfak') || lower.includes('gida') || lower.includes('ikram')) {
      return <Coffee className="w-4 h-4 text-amber-600" />;
    }
    if (lower.includes('bilgi işlem') || lower.includes('it &') || lower.includes('bilişim')) {
      return <Monitor className="w-4 h-4 text-blue-600" />;
    }
    if (lower.includes('ofis') || lower.includes('kırtasiye')) {
      return <FileText className="w-4 h-4 text-indigo-500" />;
    }
    if (lower.includes('araç') || lower.includes('arac') || lower.includes('makine')) {
      return <Truck className="w-4 h-4 text-slate-700" />;
    }
    if (lower.includes('hizmet') || lower.includes('lojistik') || lower.includes('nakliye')) {
      return <Truck className="w-4 h-4 text-teal-600" />;
    }
    if (lower.includes('sarf') || lower.includes('hırdavat') || lower.includes('hirdavat')) {
      return <Boxes className="w-4 h-4 text-slate-600" />;
    }
    return <Tag className="w-4 h-4 text-slate-500" />;
  };

  // Unique filter options derived from comparisons and history
  const canonicalVendors = useMemo(() => {
    const list: { vendorName: string }[] = [];
    validComparisons.forEach(c => {
      c.history.forEach(h => {
        if (h.supplier) list.push({ vendorName: h.supplier });
      });
    });
    return extractCanonicalVendors(list);
  }, [validComparisons]);

  const uniqueJobsites = useMemo(() => {
    const set = new Set<string>();
    validComparisons.forEach(c => {
      c.history.forEach(h => {
        if (h.jobsiteName) set.add(h.jobsiteName);
      });
    });
    return Array.from(set).sort();
  }, [validComparisons]);

  const uniqueSupervisors = useMemo(() => {
    const set = new Set<string>();
    validComparisons.forEach(c => {
      c.history.forEach(h => {
        if (h.uploadedBySupervisorName) set.add(h.uploadedBySupervisorName);
      });
    });
    return Array.from(set).sort();
  }, [validComparisons]);

  // Segment analysis is pure per comparison object; cache it so filtering, counts and
  // row rendering don't re-run the text analysis for every row on every keystroke.
  const segmentInfoCache = useMemo(() => new WeakMap<MaterialComparison, ReturnType<typeof computeMaterialSegmentInfo>>(), [validComparisons]);
  const getMaterialSegmentInfo = (c: MaterialComparison) => {
    let info = segmentInfoCache.get(c);
    if (!info) {
      info = computeMaterialSegmentInfo(c);
      segmentInfoCache.set(c, info);
    }
    return info;
  };
  function computeMaterialSegmentInfo(c: MaterialComparison) {
    const firstOrig = c.history?.[0]?.originalName || c.materialName;
    const computed = analyzeMaterialSegment(c.materialName, firstOrig, c.category, c.avgUnitPrice);
    return {
      comparisonMode: c.comparisonMode || computed.comparisonMode,
      comparisonModeLabel: c.comparisonModeLabel || computed.comparisonModeLabel,
      qualitySegment: c.qualitySegment || computed.qualitySegment,
      qualitySegmentLabel: c.qualitySegmentLabel || computed.qualitySegmentLabel,
      brand: c.brand || computed.brand,
      comparisonRuleSummary: computed.segmentReason
    };
  }

  const segmentModeCounts = useMemo(() => {
    let commodityCount = 0;
    let brandSegmentedCount = 0;
    let premiumCount = 0;
    let standardCount = 0;
    let economyCount = 0;
    validComparisons.forEach(c => {
      const info = getMaterialSegmentInfo(c);
      if (info.comparisonMode === 'COMMODITY_STANDARD') {
        commodityCount++;
      } else {
        brandSegmentedCount++;
        if (info.qualitySegment === 'PREMIUM') premiumCount++;
        else if (info.qualitySegment === 'ECONOMY') economyCount++;
        else standardCount++;
      }
    });
    return { commodityCount, brandSegmentedCount, premiumCount, standardCount, economyCount };
  }, [validComparisons]);

  const isAnyFilterActive = useMemo(() => {
    return (
      selectedCategory !== 'ALL' ||
      selectedJobsite !== 'ALL' ||
      selectedVendor !== 'ALL' ||
      selectedSupervisor !== 'ALL' ||
      prizmaSourceFilter !== 'all' ||
      Boolean(invoiceNoFilter.trim()) ||
      (dateFilter.preset && dateFilter.preset !== 'all') ||
      onlyWithPriceGap ||
      onlyMultipleUnits ||
      comparisonModeFilter !== 'ALL' ||
      qualitySegmentFilter !== 'ALL' ||
      Boolean(searchTerm.trim())
    );
  }, [selectedCategory, selectedJobsite, selectedVendor, selectedSupervisor, prizmaSourceFilter, invoiceNoFilter, dateFilter, onlyWithPriceGap, onlyMultipleUnits, comparisonModeFilter, qualitySegmentFilter, searchTerm]);

  const handleResetFilters = () => {
    setSelectedCategory('ALL');
    setSelectedJobsite('ALL');
    setSelectedVendor('ALL');
    setSelectedSupervisor('ALL');
    setPrizmaSourceFilter('all');
    setInvoiceNoFilter('');
    setDateFilter({ preset: 'all' });
    setOnlyWithPriceGap(false);
    setOnlyMultipleUnits(false);
    setComparisonModeFilter('ALL');
    setQualitySegmentFilter('ALL');
    setSearchTerm('');
  };

  // Filtered & Sorted materials for table
  const materialMatchesSearch = (c: MaterialComparison, rawQuery: string) => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return true;
    const segInfo = getMaterialSegmentInfo(c);
    return (
        c.materialName.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        (segInfo.brand && segInfo.brand.toLowerCase().includes(q)) ||
        segInfo.qualitySegmentLabel.toLowerCase().includes(q) ||
        c.history.some(
          h =>
            h.jobsiteName.toLowerCase().includes(q) ||
            h.supplier.toLowerCase().includes(q) ||
            (h.uploadedBySupervisorName && h.uploadedBySupervisorName.toLowerCase().includes(q)) ||
            (h.invoiceNumber && h.invoiceNumber.toLowerCase().includes(q)) ||
            (h.originalName && h.originalName.toLowerCase().includes(q)) ||
            (h.prizmaRequestCode && h.prizmaRequestCode.toLowerCase().includes(q)) ||
            (h.prizmaOrderCode && h.prizmaOrderCode.toLowerCase().includes(q))
        )
    );
  };

  const filteredMaterials = useMemo(() => validComparisons
    .filter(c => {
      const segInfo = getMaterialSegmentInfo(c);
      const matchesSearch = materialMatchesSearch(c, searchTerm);

      const matchesCat = selectedCategory === 'ALL' || c.category === selectedCategory;
      const matchesJob = selectedJobsite === 'ALL' || c.history.some(h => h.jobsiteName === selectedJobsite || h.jobsiteId === selectedJobsite);
      const matchesVen = selectedVendor === 'ALL' || c.history.some(h => areVendorsEqual(h.supplier, selectedVendor));
      const matchesSup = selectedSupervisor === 'ALL' || c.history.some(h => (h.uploadedBySupervisorName || '') === selectedSupervisor);
      const matchesPrizma = prizmaSourceFilter === 'all' ||
        (prizmaSourceFilter === 'prizma_only' && c.history.some(isPrizmaHistoryRecord)) ||
        (prizmaSourceFilter === 'local_only' && c.history.some(isGesArchiveHistoryRecord));
      const matchesInvNo = !invoiceNoFilter.trim() || c.history.some(h => String(h.invoiceNumber || '').toLowerCase().includes(invoiceNoFilter.toLowerCase().trim()));
      const matchesDate = !dateFilter.preset || dateFilter.preset === 'all' || c.history.some(h => matchesDateFilter(h.date, dateFilter));
      const matchesGap = !onlyWithPriceGap || c.priceDifferencePercentage > 0;
      const matchesMultiUnit = !onlyMultipleUnits || (c.hasMultipleUnits || (c.detectedUnits && c.detectedUnits.length > 1));
      const matchesMode = comparisonModeFilter === 'ALL' || segInfo.comparisonMode === comparisonModeFilter;
      const matchesQuality = qualitySegmentFilter === 'ALL' || segInfo.qualitySegment === qualitySegmentFilter;

      return matchesSearch && matchesCat && matchesJob && matchesVen && matchesSup && matchesPrizma && matchesInvNo && matchesDate && matchesGap && matchesMultiUnit && matchesMode && matchesQuality;
    })
    .sort((a, b) => {
      if (sortBy === 'gap') {
        return b.priceDifferencePercentage - a.priceDifferencePercentage;
      }
      if (sortBy === 'spend') {
        return b.totalSpend - a.totalSpend;
      }
      if (sortBy === 'qty') {
        return b.totalQuantityPurchased - a.totalQuantityPurchased;
      }
      return a.materialName.localeCompare(b.materialName, 'tr');
    }), [validComparisons, searchTerm, selectedCategory, selectedJobsite, selectedVendor, selectedSupervisor, prizmaSourceFilter, invoiceNoFilter, dateFilter, onlyWithPriceGap, onlyMultipleUnits, comparisonModeFilter, qualitySegmentFilter, sortBy, segmentInfoCache]);

  const quickPillCounts = useMemo(() => {
    const terms = ['İnşaat Demiri', 'Ankraj', 'Donatı', 'Kutu Profil', 'Köşebent', 'Çelik Hasır', 'Membran', 'Gazbeton'];
    const counts: Record<string, number> = {};
    terms.forEach(term => {
      counts[term] = validComparisons.filter(c => materialMatchesSearch(c, term)).length;
    });
    return counts;
  }, [validComparisons, segmentInfoCache]);

  const groupedFilteredMaterials = useMemo(() => {
    const groups: Record<string, MaterialComparison[]> = {};
    filteredMaterials.forEach(m => {
      if (!groups[m.category]) {
        groups[m.category] = [];
      }
      groups[m.category].push(m);
    });
    return groups;
  }, [filteredMaterials]);

  const activeComparison =
    validComparisons.find(c => (c.id && c.id === selectedMaterialName) || `${c.materialName}___${c.unit}` === selectedMaterialName || c.materialName === selectedMaterialName) || validComparisons[0] || comparisons[0];

  // AI Normalize Handler
  const handleNormalizeAI = async () => {
    try {
      setIsAnalyzingAI(true);
      const res = await fetch('/api/materials/ai-normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || '') }
      });
      const data = await res.json();

      if (data.success) {
        if (onRefreshData) {
          await onRefreshData();
        }
        setMergeResultsModal({
          mergedCount: data.mergedCount || 0,
          mergedPairs: data.mergedPairs || []
        });

        if (data.mergedPairs && data.mergedPairs.length > 0) {
          setSelectedMaterialName(data.mergedPairs[0].canonical);
          setExpandedMaterialName(data.mergedPairs[0].canonical);
        }
      } else {
        alert('AI Malzeme birleştirme hatası: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (err: any) {
      console.error('AI Normalization error:', err);
      alert('Sistem hatası: ' + err.message);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // Retroactive Global Audit Handler
  const handleRetroactiveAudit = async () => {
    try {
      setIsRetroAuditing(true);
      const res = await fetch('/api/materials/retroactive-audit-normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || '') }
      });
      const data = await res.json();
      if (data.success) {
        if (onRefreshData) {
          await onRefreshData();
        }
        setRetroAuditModal(data);
      } else {
        alert('Geçmiş denetim hatası: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (err: any) {
      console.error('Retroactive audit error:', err);
      alert('Sistem bağlantı hatası: ' + err.message);
    } finally {
      setIsRetroAuditing(false);
    }
  };

  // Manual Merge Handler
  const handleManualMergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSource || !manualTarget) {
      alert('Lütfen birleştirilecek iki malzemeyi de seçin.');
      return;
    }
    if (manualSource === manualTarget) {
      alert('Kaynak ve hedef malzeme aynı olamaz.');
      return;
    }

    try {
      setIsMergingManual(true);
      const res = await fetch('/api/materials/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || '') },
        body: JSON.stringify({ sourceName: manualSource, targetName: manualTarget })
      });
      const data = await res.json();

      if (data.success) {
        if (onRefreshData) {
          await onRefreshData();
        }
        const mergedName = data.targetName || manualTarget;
        setSelectedMaterialName(mergedName);
        setExpandedMaterialName(mergedName);
        alert(data.warning ? `${data.message}\n\n⚠️ ${data.warning}` : data.message);
        setShowManualMergeModal(false);
        setManualSource('');
        setManualTarget('');
      } else {
        alert('Birleştirme hatası: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (err: any) {
      console.error('Manual merge error:', err);
      alert('Hata: ' + err.message);
    } finally {
      setIsMergingManual(false);
    }
  };

  // Helper to build jobsite price map for a material
  const getJobsitePricesMap = (mat: MaterialComparison) => {
    const map: {
      [jobsiteName: string]: {
        latestPrice: number;
        date: string;
        supplier: string;
        invoiceNumber: string;
        totalQty: number;
        originalName?: string;
      };
    } = {};

    mat.history.forEach(h => {
      map[h.jobsiteName] = {
        latestPrice: h.unitPrice,
        date: h.date,
        supplier: h.supplier,
        invoiceNumber: h.invoiceNumber,
        originalName: h.originalName,
        totalQty: (map[h.jobsiteName]?.totalQty || 0) + h.quantity
      };
    });

    return map;
  };

  // Prepare price history chart data
  const chartHistoryData = activeComparison
    ? activeComparison.history.map(point => ({
        date: point.date,
        'Birim Fiyat (₽)': point.unitPrice,
        Şantiye: point.jobsiteName,
        Tedarikçi: point.supplier
      }))
    : [];

  const materialsWithGapCount = validComparisons.filter(c => c.priceDifferencePercentage > 0).length;
  const multipleUnitsCount = validComparisons.filter(c => c.hasMultipleUnits || (c.detectedUnits && c.detectedUnits.length > 1)).length;

  const exportToExcel = () => {
    const dataToExport = filteredMaterials.flatMap((mat) =>
      mat.history.map((hist) => ({
        'Malzeme Grubu': mat.materialName,
        'Kategori': mat.category,
        'Fatura No': hist.invoiceNumber,
        'Fatura Tarihi': hist.date,
        'Şantiye Adı': hist.jobsiteName,
        'Tedarikçi Firma': hist.supplier,
        'Faturadaki Orijinal Ürün Yazımı': hist.originalName || mat.materialName,
        'Orijinal Fatura Birimi': hist.originalUnit || mat.unit,
        'Orijinal Birim Fiyat (₽)': hist.originalUnitPrice || hist.unitPrice,
        'Orijinal Miktar': hist.originalQuantity || hist.quantity,
        'Kıyaslama Standart Birimi': mat.unit,
        'Normalize Edilmiş Birim Fiyat (₽)': hist.unitPrice,
        'Normalize Miktar': hist.quantity,
        'Birim Çevrim Formülü': hist.conversionFormula || 'Standart Birim (Çevrim Gerekmedi)',
        'Ortalama Birim Fiyat (₽)': mat.avgUnitPrice,
        'Toplam Tutar (₽)': hist.originalUnitPrice ? (hist.originalUnitPrice * (hist.originalQuantity || 1)) : (hist.quantity * hist.unitPrice)
      }))
    );

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Malzeme Kıyaslama Raporu');
    XLSX.writeFile(workbook, `Malzeme_Fiyat_Kiyaslama_Raporu_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const renderMaterialRow = (mat: MaterialComparison, index: number) => {
    const matKey = mat.id || `${mat.materialName}___${mat.unit || ''}___${index}`;
    const matSelectKey = mat.id || `${mat.materialName}___${mat.unit || ''}`;
    const isExpanded = expandedMaterialName === matSelectKey || expandedMaterialName === mat.materialName;
    const isSelected = selectedMaterialName === matSelectKey || selectedMaterialName === mat.materialName;
    const hasMergedItems = mat.history.some(
      h => h.originalName && h.originalName !== mat.materialName
    );

    let gapBadgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
    if (mat.priceDifferencePercentage > 20) {
      gapBadgeClass = 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold';
    } else if (mat.priceDifferencePercentage > 10) {
      gapBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
    } else if (mat.priceDifferencePercentage > 0) {
      gapBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
    }

    return (
      <React.Fragment key={matKey}>
        {/* Main Material Row */}
        <tr
          onClick={() => {
            setSelectedMaterialName(matSelectKey);
            setExpandedMaterialName(isExpanded ? null : matSelectKey);
          }}
          className={`transition-colors cursor-pointer ${
            isSelected
              ? 'bg-indigo-50/70 hover:bg-indigo-50'
              : isExpanded
              ? 'bg-slate-50/90'
              : 'hover:bg-slate-50'
          }`}
        >
          <td className="py-3.5 px-4 text-center text-slate-400 font-mono font-bold">
            {index + 1}
          </td>

          <td className="py-3.5 px-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-extrabold text-slate-900 text-sm">
                {mat.materialName}
              </span>
              <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 shrink-0">
                {mat.unit}
              </span>
              {mat.catalogLocked && (
                <span
                  className="text-[9px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0"
                  title="Bu malzeme elle birleştirildi. Aynı satırlar yeni faturalarda (OCR veya Prizma) gelince otomatik olarak bu kayda eklenir."
                >
                  Elle Birleştirildi
                </span>
              )}
              {(mat.hasMultipleUnits || (mat.detectedUnits && mat.detectedUnits.length > 1)) && (
                <span
                  className="text-[9px] font-extrabold text-purple-800 bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 flex items-center space-x-1 shrink-0"
                  title={`Faturalarda bu ürün ${mat.detectedUnits?.join(', ')} birimleriyle alınmış ve ortak ${mat.unit} bazında normalize edilmiştir.`}
                >
                  <Scale className="w-2.5 h-2.5 text-purple-600" />
                  <span>Çoklu Birim ({mat.detectedUnits?.join(', ')})</span>
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              🇷🇺 {ensureRussianOriginalName(mat.materialName, mat.history?.[0]?.originalName)}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                {mat.category}
              </span>
              {(() => {
                const seg = getMaterialSegmentInfo(mat);
                const isCommodity = seg.comparisonMode === 'COMMODITY_STANDARD';
                const badgeClass = isCommodity
                  ? 'bg-sky-50 text-sky-900 border-sky-200'
                  : seg.qualitySegment === 'PREMIUM'
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : seg.qualitySegment === 'ECONOMY'
                  ? 'bg-slate-100 text-slate-700 border-slate-300'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-200';
                return (
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded border flex items-center space-x-1 ${badgeClass}`}
                    title={seg.comparisonRuleSummary}
                  >
                    <span>{seg.qualitySegmentLabel}</span>
                    {!isCommodity && seg.brand && seg.brand !== 'Standart Seri' && (
                      <span className="ml-1 font-mono underline decoration-dotted">• Marka: {seg.brand}</span>
                    )}
                  </span>
                );
              })()}
              {((mat as any).mergedOriginalWritings && (mat as any).mergedOriginalWritings.length > 1) && (
                <span
                  className="text-[10px] font-extrabold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 flex items-center space-x-1"
                  title={`Farklı firmaların faturalarında farklı yazılmış olsa da aynı orijinal teknik ürün & marka olduğu anlaşılıp eşitlenen yazımlar:\n• ${(mat as any).mergedOriginalWritings.slice(0, 5).join('\n• ')}`}
                >
                  <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
                  <span>{(mat as any).mergedOriginalWritings.length} Farklı Firma Yazımı Eşitlendi</span>
                </span>
              )}
              {(() => {
                const eqSug = findCheaperEquivalentBrandSuggestion({
                  originalName: mat.history?.[0]?.originalName,
                  materialName: mat.materialName,
                  category: mat.category,
                  unit: mat.unit,
                  currentUnitPrice: mat.avgUnitPrice,
                  quantity: mat.totalQuantityPurchased,
                  families: mode2CrossBrandFamilies
                });
                if (!eqSug) return null;
                return (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      const targetFam = mode2CrossBrandFamilies.find(
                        f => f.canonicalFamilyTitleRu === eqSug.familyTitleRu
                      );
                      if (targetFam) {
                        setSimSelectedFamilyId(targetFam.familyId);
                        setSimSourceBrandKey(targetFam.priciestBrand.brandKey);
                        setSimTargetBrandKey(targetFam.cheapestBrand.brandKey);
                        setSimCustomQty(String(mat.totalQuantityPurchased || 100));
                      }
                      setDualComparisonLens('MODE_2_BRAND_EQUIVALENT');
                    }}
                    className="text-[10px] font-extrabold text-amber-900 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded border border-amber-300 flex items-center space-x-1 transition-colors cursor-pointer"
                    title={`Muadil Marka Ekonomi Fırsatı: ${eqSug.suggestedBrandDisplay} tercih edilseydi birim başına ${formatRuble(eqSug.unitSavingsRub)} (%${eqSug.savingsPercentage}) tasarruf sağlanabilirdi. Tıklayarak 2. Seçenekte simüle edin.`}
                  >
                    <Zap className="w-2.5 h-2.5 text-amber-700" />
                    <span>💡 Muadil Marka: {eqSug.suggestedBrandDisplay} (-%{eqSug.savingsPercentage})</span>
                  </button>
                );
              })()}
              {hasMergedItems && (
                <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-200 flex items-center space-x-1">
                  <Sparkles className="w-2.5 h-2.5 text-amber-600" />
                  <span>AI Birleştirilmiş</span>
                </span>
              )}
            </div>
          </td>

          <td className="py-3.5 px-4 text-right font-mono tabular-nums">
            <div className="font-black text-indigo-950 text-sm">
              {formatRuble(mat.avgUnitPrice)}{' '}
              <span className="text-[10px] text-slate-400 font-normal">
                /{mat.unit}
              </span>
            </div>
            <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
              KDV Hariç: {formatRuble(mat.avgNetUnitPrice || Number((mat.avgUnitPrice / 1.22).toFixed(2)))}
            </div>
          </td>

          {/* Cheapest Jobsite */}
          <td className="py-3.5 px-4">
            <div className="bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg inline-block">
              <div className="font-bold text-emerald-900 text-xs">
                {mat.cheapestJobsiteName}
              </div>
              <div className="font-black text-emerald-700 font-mono tabular-nums text-xs">
                {formatRuble(mat.minUnitPrice)}{' '}
                <span className="text-[10px] font-normal text-slate-500">
                  /{mat.unit} (KDV Dahil)
                </span>
              </div>
              <div className="text-[10px] font-mono tabular-nums text-emerald-800/80">
                Net: {formatRuble(mat.minNetUnitPrice || Number((mat.minUnitPrice / 1.22).toFixed(2)))}
              </div>
            </div>
          </td>

          {/* Priciest Jobsite */}
          <td className="py-3.5 px-4">
            {mat.minUnitPrice === mat.maxUnitPrice ? (
              <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold font-mono tabular-nums">
                <span>✓ Sabit Fiyat</span>
              </span>
            ) : (
              <div className="bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg inline-block">
                <div className="font-bold text-rose-900 text-xs">
                  {mat.priciestJobsiteName}
                </div>
                <div className="font-black text-rose-700 font-mono tabular-nums text-xs">
                  {formatRuble(mat.maxUnitPrice)}{' '}
                  <span className="text-[10px] font-normal text-slate-500">
                    /{mat.unit} (KDV Dahil)
                  </span>
                </div>
                <div className="text-[10px] font-mono tabular-nums text-rose-800/80">
                  Net: {formatRuble(mat.maxNetUnitPrice || Number((mat.maxUnitPrice / 1.22).toFixed(2)))}
                </div>
              </div>
            )}
          </td>

          {/* Price Gap % */}
          <td className="py-3.5 px-4 text-center">
            <span
              className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full border text-xs ${gapBadgeClass}`}
            >
              <Zap className="w-3 h-3" />
              <span>%{mat.priceDifferencePercentage} Fark</span>
            </span>
          </td>

          {/* Total Purchased & Spend */}
          <td className="py-3.5 px-4 text-right">
            <div className="font-extrabold text-slate-900 font-mono">
              {mat.totalQuantityPurchased} {mat.unit}
            </div>
            <div className="text-slate-500 text-[11px] font-mono">
              {formatRuble(mat.totalSpend)}
            </div>
          </td>

          {/* Open Detail Modal Button */}
          <td className="py-3.5 px-4 text-center">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                setSelectedMaterialName(matSelectKey);
                setExpandedMaterialName(matSelectKey);
              }}
              className="px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer inline-flex items-center space-x-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-2xs"
              title="Malzeme Fiyat Geçmişi ve Fatura Detaylarını Ayrı Ekranda Aç"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Detay</span>
            </button>
          </td>
        </tr>

        {/* Inline accordion disabled; details open in dedicated top-level modal */}
        {false && isExpanded && (
          <tr>
            <td colSpan={8} className="p-0 bg-slate-900 text-white border-b-2 border-indigo-500">
              <div className="p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryEditModal({
                            materialName: mat.materialName,
                            currentCategory: mat.category
                          });
                          setNewCategoryInput(mat.category);
                        }}
                        className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 border border-amber-400/20 hover:bg-amber-400/20 px-2.5 py-1 rounded-lg flex items-center space-x-1 cursor-pointer transition-all"
                        title="Tıklayarak Kategoriyi Değiştirin veya Düzeltin"
                      >
                        <span>{mat.category}</span>
                        <SlidersHorizontal className="w-3 h-3 ml-1 opacity-80" />
                      </button>
                      <span className="text-[10px] text-slate-400 font-medium">
                        Tüm Satınalma ve Fatura Kayıtları Dökümü ({mat.history.length} Fatura Bulundu)
                      </span>
                    </div>
                    <h3 className="text-lg font-black text-white mt-1 flex items-center space-x-2">
                      <span>{mat.materialName}</span>
                      <span className="text-xs font-mono font-normal text-slate-400">
                        ({mat.unit})
                      </span>
                    </h3>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-lg font-mono font-bold">
                      Ort. Birim Fiyat: {formatRuble(mat.avgUnitPrice)} / {mat.unit}
                    </span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setManualSource(mat.materialName);
                        setShowManualMergeModal(true);
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 font-bold text-xs rounded-lg border border-slate-700 flex items-center space-x-1 cursor-pointer transition-colors"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>Başka Malzemeyle Birleştir</span>
                    </button>
                  </div>
                </div>

                {/* Multi-Unit Construction Equivalence Banner */}
                {(mat.hasMultipleUnits || (mat.detectedUnits && mat.detectedUnits.length > 1)) && (
                  <div className="bg-purple-950/40 border border-purple-500/30 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-purple-200">
                    <div className="flex items-start space-x-3">
                      <Scale className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="font-bold text-purple-300 flex items-center space-x-2">
                          <span>🔄 Çoklu Birim Eşdeğerlik Denetimi Devrede</span>
                          <span className="bg-purple-500/20 text-purple-300 text-[10px] font-mono px-2 py-0.5 rounded-full border border-purple-500/30">
                            Ortak Referans: {mat.unit}
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          Faturalarda bu ürün <strong>{mat.detectedUnits?.join(', ')}</strong> birimleriyle alınmıştır. Sistem elma ile armut kıyaslama hatasını önlemek için tüm kayıtları GOST/TS standartlarına göre <strong>{mat.unit}</strong> bazına çevirmiş ve gerçek fiyat farkını hesaplamıştır.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLabSelectedMaterial(mat.materialName);
                        setLabSelectedUnit(mat.unit);
                        setShowUnitLabModal(true);
                      }}
                      className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center space-x-1 self-start sm:self-center"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      <span>Formülü İncele</span>
                    </button>
                  </div>
                )}

                {/* DETAILED PURCHASES LIST TABLE */}
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-800">
                        <th className="py-2.5 px-3 text-center w-8">#</th>
                        <th className="py-2.5 px-4 text-emerald-400">Yükleme Tarihi</th>
                        <th className="py-2.5 px-4">Fatura No & Tarih</th>
                        <th className="py-2.5 px-4">Şantiye Adı</th>
                        <th className="py-2.5 px-4">Tedarikçi Firma</th>
                        <th className="py-2.5 px-4">Faturadaki Orijinal Ürün Yazımı</th>
                        <th className="py-2.5 px-4 text-right">Birim Fiyat</th>
                        <th className="py-2.5 px-4 text-center">Ortalamaya Sapma</th>
                        <th className="py-2.5 px-4 text-right">Miktar & Tutar</th>
                        <th className="py-2.5 px-3 text-center">Fatura Belgesi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {mat.history.map((hist, hIdx) => {
                        const diffVsAvg = Number(
                          (
                            ((hist.unitPrice - mat.avgUnitPrice) / mat.avgUnitPrice) *
                            100
                          ).toFixed(1)
                        );
                        const isCheapest = hist.unitPrice === mat.minUnitPrice;
                        const isPriciest =
                          hist.unitPrice === mat.maxUnitPrice &&
                          mat.minUnitPrice !== mat.maxUnitPrice;

                        const targetInvoice = invoices.find(
                          inv => inv.invoiceNumber === hist.invoiceNumber || inv.id === hist.invoiceId
                        );

                        return (
                          <tr
                            key={`${hist.invoiceNumber}-${hIdx}`}
                            onClick={() => {
                              if (targetInvoice) {
                                setSelectedInvoiceForModal(targetInvoice);
                              } else {
                                const constructedInvoice: InvoiceRecord = {
                                  id: hist.invoiceId || `inv_hist_${hist.invoiceNumber || hIdx}`,
                                  invoiceNumber: hist.invoiceNumber || 'BELİRSİZ',
                                  date: hist.date || new Date().toISOString().split('T')[0],
                                  supplier: hist.supplier || 'Tedarikçi',
                                  jobsiteId: hist.jobsiteId || (jobsites[0]?.id || 'job_1'),
                                  jobsiteName: hist.jobsiteName || (jobsites[0]?.name || 'SET OF3a'),
                                  uploadedBySupervisorId: (supervisors[0]?.id || 'sup_1'),
                                  uploadedBySupervisorName: (supervisors[0]?.name || 'Nuri Buga'),
                                  totalAmount: hist.unitPrice * (hist.quantity || 1),
                                  items: [
                                    {
                                      id: `item_hist_${hIdx}`,
                                      materialName: mat.materialName,
                                      category: mat.category,
                                      unit: mat.unit || 'Adet',
                                      quantity: hist.quantity || 1,
                                      unitPrice: hist.unitPrice,
                                      totalPrice: hist.unitPrice * (hist.quantity || 1)
                                    }
                                  ],
                                  created_at: hist.date || new Date().toISOString(),
                                  fileUrl: hist.fileUrl,
                                  rawFileName: hist.rawFileName,
                                  prizmaSource: hist.prizmaSource,
                                  prizmaRequestCode: hist.prizmaRequestCode,
                                  prizmaOrderCode: hist.prizmaOrderCode,
                                  prizmaBtfUrl: hist.prizmaBtfUrl || hist.prizmaUrl,
                                  prizmaStfUrl: hist.prizmaStfUrl
                                } as any;
                                setSelectedInvoiceForModal(constructedInvoice);
                              }
                            }}
                            className="hover:bg-indigo-950/70 transition-colors cursor-pointer group"
                            title="Fatura ve belge detaylarını açmak için tıklayın"
                          >
                            <td className="py-3 px-3 text-center text-slate-500 font-mono font-bold">
                              {hIdx + 1}
                            </td>

                            <td className="py-3 px-4 font-mono text-[11px] font-bold text-emerald-400 bg-emerald-950/40 whitespace-nowrap">
                              {formatUploadDate(targetInvoice?.created_at, hist.date)}
                            </td>

                            <td className="py-3 px-4 font-mono text-[11px]">
                              <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                <div className="flex items-center space-x-1 text-slate-200 font-bold">
                                  <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                  <span>{hist.invoiceNumber}</span>
                                </div>
                                {isPrizmaHistoryRecord(hist) ? (
                                  <span className="px-1.5 py-0.2 bg-blue-900/60 text-blue-300 border border-blue-500/40 rounded text-[9px] font-bold">
                                    Prizma ERP
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 rounded text-[9px] font-bold">
                                    GES Arşiv
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {hist.date}
                              </div>
                              {hist.prizmaRequestCode && (
                                <a
                                  href={getPrizmaBtfUrl((hist as any).prizmaDemandId, hist.prizmaBtfUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1 inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-950 text-blue-300 border border-blue-500/40 rounded text-[9px] font-bold hover:bg-blue-900 transition-colors"
                                  title="Prizma BTF Talebini Doğrudan Aç"
                                >
                                  <span className="font-black text-blue-400">П</span>
                                  <span>{hist.prizmaRequestCode}</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                </a>
                              )}
                            </td>

                            <td className="py-3 px-4 font-bold text-slate-200">
                              <div className="flex items-center space-x-1.5">
                                <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                <span>{hist.jobsiteName}</span>
                              </div>
                              {isCheapest && (
                                <span className="mt-1 inline-block text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  ✓ En Uygun Fiyat
                                </span>
                              )}
                              {isPriciest && (
                                <span className="mt-1 inline-block text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                  ⚠️ En Pahalı Fiyat
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-slate-200 font-bold">
                              <div className="flex items-center space-x-1.5">
                                <Store className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>{hist.supplier}</span>
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              {hist.originalName ? (
                                <div className="flex items-start gap-1.5">
                                  <div className="bg-slate-900 text-amber-300 border border-slate-800 p-2 rounded text-[11px] font-mono leading-snug max-w-xs sm:max-w-md">
                                    "{hist.originalName}"
                                  </div>
                                  {mat.history.some((h: any) => materialFingerprint(h.rawOriginalName || h.originalName) !== materialFingerprint((hist as any).rawOriginalName || hist.originalName)) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        splitHistoryLine(mat, hist);
                                      }}
                                      className="shrink-0 text-[10px] font-bold text-rose-300 bg-rose-950/50 border border-rose-800/60 hover:bg-rose-900/60 px-1.5 py-1 rounded"
                                      title="Bu satır yanlış malzemeye gruplandıysa ayrı kayda al"
                                    >
                                      Ayır
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-500 italic">
                                  {mat.materialName}
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-right font-black font-mono text-emerald-400 text-sm">
                              {priceDisplayMode === 'normalized' ? (
                                <div>
                                  <div>
                                    {formatRuble(hist.unitPrice)}{' '}
                                    <span className="text-[10px] font-normal text-slate-400">
                                      /{hist.normalizedUnit || mat.unit}
                                    </span>
                                  </div>
                                  {hist.conversionApplied && (
                                    <div
                                      className="text-[10px] font-normal text-amber-300/90 mt-0.5 flex items-center justify-end space-x-1"
                                      title={hist.conversionFormula}
                                    >
                                      <span className="line-through text-slate-500 text-[9px]">
                                        {formatRuble(hist.originalUnitPrice)}/{hist.originalUnit}
                                      </span>
                                      <span className="bg-amber-400/15 border border-amber-400/30 px-1 py-0.2 rounded text-[9px] text-amber-300 font-semibold">
                                        {hist.conversionFormula ? hist.conversionFormula.split(':')[0] : 'Çevrim'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  {formatRuble(hist.originalUnitPrice || hist.unitPrice)}{' '}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /{hist.originalUnit || mat.unit}
                                  </span>
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-4 text-center">
                              <span
                                className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                                  diffVsAvg > 0
                                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                    : diffVsAvg < 0
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {diffVsAvg > 0
                                  ? `+${diffVsAvg}% Ort. Üzeri`
                                  : `${diffVsAvg}% Ort. Altı`}
                              </span>
                            </td>

                            <td className="py-3 px-4 text-right font-mono">
                              <div className="font-bold text-slate-200">
                                {priceDisplayMode === 'normalized' ? (
                                  <>
                                    {hist.quantity} {hist.normalizedUnit || mat.unit}
                                    {hist.conversionApplied && (
                                      <span className="block text-[10px] text-slate-400 font-normal">
                                        ({hist.originalQuantity} {hist.originalUnit})
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {hist.originalQuantity || hist.quantity} {hist.originalUnit || mat.unit}
                                  </>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold">
                                {formatRuble(
                                  hist.originalUnitPrice
                                    ? hist.originalUnitPrice * (hist.originalQuantity || 1)
                                    : hist.quantity * hist.unitPrice
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-center">
                              <div className="flex flex-col items-center space-y-1.5">
                                {targetInvoice ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedInvoiceForModal(targetInvoice)}
                                    className="px-2.5 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg text-[10px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer mx-auto shadow-sm"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Faturayı İncele</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (hist.fileUrl || hist.rawFileName) {
                                        openOriginalFileViewer(hist.fileUrl, hist.rawFileName);
                                      } else {
                                        alert(`Fatura No: ${hist.invoiceNumber}\nTarih: ${hist.date}\nTedarikçi: ${hist.supplier}\nBirim Fiyat: ${hist.unitPrice} ₽\nMiktar: ${hist.quantity}`);
                                      }
                                    }}
                                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold transition-all flex items-center justify-center space-x-1 cursor-pointer mx-auto border border-slate-700"
                                  >
                                    <ExternalLink className="w-3 h-3 text-indigo-400" />
                                    <span>Belge Aç</span>
                                  </button>
                                )}

                                {hist.prizmaBtfUrl && (
                                  <a
                                    href={hist.prizmaBtfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="px-2.5 py-1 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-lg text-[10px] font-bold transition-all flex items-center justify-center space-x-1 border border-blue-500/40 shadow-xs"
                                    title="Prizma Sisteminde Bu BTF Ödeme Talebini Aç"
                                  >
                                    <span className="font-black text-blue-400">П</span>
                                    <span>BTF Aç</span>
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const modalMaterial = useMemo(() => {
    if (!expandedMaterialName) return null;
    return (
      filteredMaterials.find(
        c =>
          (c.id && c.id === expandedMaterialName) ||
          `${c.materialName}___${c.unit || ''}` === expandedMaterialName ||
          c.materialName === expandedMaterialName
      ) ||
      comparisons.find(
        c =>
          (c.id && c.id === expandedMaterialName) ||
          `${c.materialName}___${c.unit || ''}` === expandedMaterialName ||
          c.materialName === expandedMaterialName
      ) ||
      null
    );
  }, [expandedMaterialName, filteredMaterials, comparisons]);

  const renderMaterialDetailModal = () => {
    if (!modalMaterial) return null;
    const mat = modalMaterial;

    return (
      <div
        className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
        onClick={() => setExpandedMaterialName(null)}
      >
        <div
          className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden my-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCategoryEditModal({
                      materialName: mat.materialName,
                      currentCategory: mat.category
                    });
                    setNewCategoryInput(mat.category);
                  }}
                  className="text-[11px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-400/30 hover:bg-amber-500/25 px-2.5 py-0.5 rounded-lg flex items-center space-x-1 cursor-pointer transition-all"
                  title="Tıklayarak Kategoriyi Değiştirin veya Düzeltin"
                >
                  <span>{mat.category}</span>
                  <SlidersHorizontal className="w-3 h-3 ml-1 opacity-80" />
                </button>
                <span className="text-xs text-indigo-200 bg-indigo-500/20 border border-indigo-400/30 px-2.5 py-0.5 rounded-lg font-mono font-bold">
                  {mat.history.length} Satınalma Faturası
                </span>
                {(() => {
                  const seg = getMaterialSegmentInfo(mat);
                  const isCommodity = seg.comparisonMode === 'COMMODITY_STANDARD';
                  return (
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-lg font-bold border ${
                        isCommodity
                          ? 'bg-sky-500/20 text-sky-200 border-sky-400/30'
                          : seg.qualitySegment === 'PREMIUM'
                          ? 'bg-amber-500/25 text-amber-200 border-amber-400/40'
                          : 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30'
                      }`}
                      title={seg.comparisonRuleSummary}
                    >
                      {seg.qualitySegmentLabel}
                    </span>
                  );
                })()}
              </div>
              <h2 className="text-lg sm:text-xl font-black text-white mt-1 flex flex-wrap items-center gap-2">
                <span>{mat.materialName}</span>
                <span className="text-xs font-mono font-bold text-indigo-300 bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700">
                  Birim: {mat.unit}
                </span>
              </h2>
              <div className="text-xs font-mono text-slate-300 mt-0.5">
                🇷🇺 {ensureRussianOriginalName(mat.materialName, mat.history?.[0]?.originalName)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950/90 border border-slate-700 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPriceDisplayMode('normalized')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center space-x-1 ${
                    priceDisplayMode === 'normalized'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Scale className="w-3 h-3" />
                  <span>Normalize ({mat.unit})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPriceDisplayMode('original')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center space-x-1 ${
                    priceDisplayMode === 'original'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>Orijinal Birim</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setManualSource(mat.materialName);
                  setShowManualMergeModal(true);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-200 font-bold text-xs rounded-xl border border-slate-700 flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Başka Malzemeyle Birleştir</span>
              </button>

              <button
                type="button"
                onClick={() => setExpandedMaterialName(null)}
                className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
                title="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-6 space-y-5 overflow-y-auto flex-1 bg-slate-50/60">
            {/* 4 KPI Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ort. Birim Fiyat (%22 KDV Dahil)</div>
                <div className="text-xl font-black text-indigo-950 font-mono tabular-nums mt-1">
                  {formatRuble(mat.avgUnitPrice)} <span className="text-xs font-normal text-slate-400">/{mat.unit}</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums font-semibold text-slate-500 mt-1">
                  KDV Hariç (Net): {formatRuble(mat.avgNetUnitPrice || Number((mat.avgUnitPrice / 1.22).toFixed(2)))}
                </div>
              </div>

              <div className="bg-emerald-50/70 rounded-2xl p-4 border border-emerald-200 shadow-xs">
                <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">En Uygun Birim Fiyat (KDV Dahil)</div>
                <div className="text-xl font-black text-emerald-700 font-mono tabular-nums mt-1">
                  {formatRuble(mat.minUnitPrice)} <span className="text-xs font-normal text-emerald-600">/{mat.unit}</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums font-semibold text-emerald-800 mt-0.5">
                  KDV Hariç: {formatRuble(mat.minNetUnitPrice || Number((mat.minUnitPrice / 1.22).toFixed(2)))}
                </div>
                <div className="text-[11px] font-bold text-emerald-900 mt-0.5 truncate" title={mat.cheapestJobsiteName}>
                  Şantiye: {mat.cheapestJobsiteName}
                </div>
              </div>

              <div className="bg-rose-50/70 rounded-2xl p-4 border border-rose-200 shadow-xs">
                <div className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">En Yüksek Birim Fiyat (KDV Dahil)</div>
                <div className="text-xl font-black text-rose-700 font-mono tabular-nums mt-1">
                  {formatRuble(mat.maxUnitPrice)} <span className="text-xs font-normal text-rose-600">/{mat.unit}</span>
                </div>
                <div className="text-[11px] font-mono tabular-nums font-semibold text-rose-800 mt-0.5">
                  KDV Hariç: {formatRuble(mat.maxNetUnitPrice || Number((mat.maxUnitPrice / 1.22).toFixed(2)))}
                </div>
                <div className="text-[11px] font-bold text-rose-900 mt-0.5 truncate" title={mat.priciestJobsiteName}>
                  Şantiye: {mat.priciestJobsiteName}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fiyat Makası & Toplam Hacim</div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className={`text-xl font-black font-mono tabular-nums ${mat.priceDifferencePercentage > 15 ? 'text-rose-600' : mat.priceDifferencePercentage > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    %{mat.priceDifferencePercentage} Fark
                  </span>
                  <span className="text-xs font-mono tabular-nums font-bold text-slate-700">
                    {mat.totalQuantityPurchased} {mat.unit}
                  </span>
                </div>
                <div className="text-[11px] font-mono tabular-nums font-bold text-slate-600 mt-1">
                  Toplam (KDV Dahil): {formatRuble(mat.totalSpend)}
                </div>
              </div>
            </div>

            {/* Net Pricing & Zero-Freight Isolation Notice Banner */}
            {(() => {
              const freightEntries = mat.history.filter(h => {
                const inv = invoices.find(i => i.invoiceNumber === h.invoiceNumber || i.id === h.invoiceId);
                return (Number((h as any).excludedFreightAmount) || Number(inv?.excludedFreightAmount) || 0) > 0;
              });
              const totalExcludedFreight = freightEntries.reduce((sum, h) => {
                const inv = invoices.find(i => i.invoiceNumber === h.invoiceNumber || i.id === h.invoiceId);
                return sum + (Number((h as any).excludedFreightAmount) || Number(inv?.excludedFreightAmount) || 0);
              }, 0);

              return (
                <div className="bg-emerald-50/90 border border-emerald-200 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-950">
                  <div className="flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-extrabold text-emerald-900">
                        Standart Elma-Elma Kıyaslama: %22 KDV Dahil & Nakliye Hariç Birim Fiyat
                      </div>
                      <p className="text-[11px] text-emerald-800 mt-0.5">
                        Prizma ERP ve Satınalma Şefi faturaları arasındaki KDV (НДС) ve nakliye farklarından kaynaklanan sahte sapmaları önlemek için tüm kıyaslamalar <strong>%22 KDV Dahil Birim Fiyat</strong> üzerinden yapılmaktadır (KDV'siz / muaf satırlar ödenen fiyatıyla alınır).
                        {totalExcludedFreight > 0 && (
                          <span className="ml-1 font-bold underline">
                            Nakliye / Hizmet Bedeli ({formatRuble(totalExcludedFreight)}) malzeme birim fiyat kıyaslamasından hariç tutulmuştur.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Multi-Unit Construction Equivalence Banner */}
            {(mat.hasMultipleUnits || (mat.detectedUnits && mat.detectedUnits.length > 1)) && (
              <div className="bg-purple-50 border border-purple-200 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-purple-900">
                <div className="flex items-start space-x-3">
                  <Scale className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-bold text-purple-950 flex items-center space-x-2">
                      <span>🔄 Çoklu Birim Eşdeğerlik Denetimi Devrede</span>
                      <span className="bg-purple-100 text-purple-800 text-[10px] font-mono px-2 py-0.5 rounded-full border border-purple-300">
                        Ortak Referans: {mat.unit}
                      </span>
                    </div>
                    <p className="text-purple-800 text-[11px] leading-relaxed">
                      Faturalarda bu ürün <strong>{mat.detectedUnits?.join(', ')}</strong> birimleriyle alınmıştır. Sistem elma ile armut kıyaslama hatasını önlemek için tüm kayıtları GOST/TS standartlarına göre <strong>{mat.unit}</strong> bazına çevirmiş ve gerçek fiyat farkını hesaplamıştır.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLabSelectedMaterial(mat.materialName);
                    setLabSelectedUnit(mat.unit);
                    setShowUnitLabModal(true);
                  }}
                  className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center space-x-1.5 self-start sm:self-center shadow-xs"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  <span>Formülü İncele</span>
                </button>
              </div>
            )}

            {/* DETAILED PURCHASES LIST TABLE */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>Tüm Satınalma ve Fatura Kayıtları Dökümü ({mat.history.length} Fatura)</span>
                </h3>
                <span className="text-[11px] text-slate-500">
                  Fatura detayını açmak için satıra veya <strong>Faturayı İncele</strong> butonuna tıklayın
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100/80 text-slate-600 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200">
                      <th className="py-2.5 px-3 text-center w-8">#</th>
                      <th className="py-2.5 px-4">Yükleme Tarihi</th>
                      <th className="py-2.5 px-4">Fatura No & Tarih</th>
                      <th className="py-2.5 px-4">Şantiye Adı</th>
                      <th className="py-2.5 px-4">Tedarikçi Firma</th>
                      <th className="py-2.5 px-4">Faturadaki Orijinal Ürün Yazımı</th>
                      <th className="py-2.5 px-4 text-right">Birim Fiyat</th>
                      <th className="py-2.5 px-4 text-center">Ortalamaya Sapma</th>
                      <th className="py-2.5 px-4 text-right">Miktar & Tutar</th>
                      <th className="py-2.5 px-3 text-center">İşlem / Belge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mat.history.map((hist, hIdx) => {
                      const diffVsAvg = Number(
                        (
                          ((hist.unitPrice - mat.avgUnitPrice) / mat.avgUnitPrice) *
                          100
                        ).toFixed(1)
                      );
                      const isCheapest = hist.unitPrice === mat.minUnitPrice;
                      const isPriciest =
                        hist.unitPrice === mat.maxUnitPrice &&
                        mat.minUnitPrice !== mat.maxUnitPrice;

                      const targetInvoice = invoices.find(
                        inv => inv.invoiceNumber === hist.invoiceNumber || inv.id === hist.invoiceId
                      );

                      const handleOpenInvoice = () => {
                        if (targetInvoice) {
                          setSelectedInvoiceForModal(targetInvoice);
                        } else {
                          const constructedInvoice: InvoiceRecord = {
                            id: hist.invoiceId || `inv_hist_${hist.invoiceNumber || hIdx}`,
                            invoiceNumber: hist.invoiceNumber || 'BELİRSİZ',
                            date: hist.date || new Date().toISOString().split('T')[0],
                            supplier: hist.supplier || 'Tedarikçi',
                            jobsiteId: hist.jobsiteId || (jobsites[0]?.id || 'job_1'),
                            jobsiteName: hist.jobsiteName || (jobsites[0]?.name || 'SET OF3a'),
                            uploadedBySupervisorId: (supervisors[0]?.id || 'sup_1'),
                            uploadedBySupervisorName: (supervisors[0]?.name || 'Nuri Buga'),
                            totalAmount: hist.unitPrice * (hist.quantity || 1),
                            items: [
                              {
                                id: `item_hist_${hIdx}`,
                                materialName: mat.materialName,
                                category: mat.category,
                                unit: mat.unit || 'Adet',
                                quantity: hist.quantity || 1,
                                unitPrice: hist.unitPrice,
                                totalPrice: hist.unitPrice * (hist.quantity || 1)
                              }
                            ],
                            created_at: hist.date || new Date().toISOString(),
                            fileUrl: hist.fileUrl,
                            rawFileName: hist.rawFileName,
                            prizmaSource: hist.prizmaSource,
                            prizmaRequestCode: hist.prizmaRequestCode,
                            prizmaOrderCode: hist.prizmaOrderCode,
                            prizmaBtfUrl: hist.prizmaBtfUrl || hist.prizmaUrl,
                            prizmaStfUrl: hist.prizmaStfUrl
                          } as any;
                          setSelectedInvoiceForModal(constructedInvoice);
                        }
                      };

                      return (
                        <tr
                          key={`${hist.invoiceNumber}-${hIdx}`}
                          onClick={handleOpenInvoice}
                          className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                          title="Fatura ve belge detaylarını açmak için tıklayın"
                        >
                          <td className="py-3 px-3 text-center text-slate-400 font-mono font-bold">
                            {hIdx + 1}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] font-bold text-emerald-700 bg-emerald-50/40 whitespace-nowrap">
                            {formatUploadDate(targetInvoice?.created_at, hist.date)}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px]">
                            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                              <div className="flex items-center space-x-1 text-slate-900 font-bold group-hover:text-indigo-600">
                                <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <span>{hist.invoiceNumber}</span>
                              </div>
                              {isPrizmaHistoryRecord(hist) ? (
                                <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 border border-blue-200 rounded text-[9px] font-bold">
                                  Prizma ERP
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-[9px] font-bold">
                                  GES Arşiv
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {hist.date}
                            </div>
                            {hist.prizmaRequestCode && (
                              <a
                                href={getPrizmaBtfUrl((hist as any).prizmaDemandId, hist.prizmaBtfUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1 inline-flex items-center space-x-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[9px] font-bold hover:bg-indigo-100 transition-colors"
                                title="Prizma BTF Talebini Doğrudan Aç"
                              >
                                <span className="font-black text-indigo-600">П</span>
                                <span>{hist.prizmaRequestCode}</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                              </a>
                            )}
                          </td>

                          <td className="py-3 px-4 font-bold text-slate-800">
                            <div className="flex items-center space-x-1.5">
                              <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span>{hist.jobsiteName}</span>
                            </div>
                            {isCheapest && (
                              <span className="mt-1 inline-block text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ✓ En Uygun Fiyat
                              </span>
                            )}
                            {isPriciest && (
                              <span className="mt-1 inline-block text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                                ⚠️ En Pahalı Fiyat
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-slate-800 font-bold">
                            <div className="flex items-center space-x-1.5">
                              <Store className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>{hist.supplier}</span>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            {hist.originalName ? (
                              <div className="bg-slate-50 text-slate-700 border border-slate-200 p-2 rounded-lg text-[11px] font-mono leading-snug max-w-xs sm:max-w-md">
                                "{hist.originalName}"
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">
                                {mat.materialName}
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 text-sm">
                            {priceDisplayMode === 'normalized' ? (
                              <div>
                                <div className="text-emerald-700 font-black">
                                  {formatRuble(hist.unitPrice)}{' '}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /{hist.normalizedUnit || mat.unit} (KDV Dahil)
                                  </span>
                                </div>
                                <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
                                  KDV Hariç{hist.vatPercentage === 0 ? ' (KDV yok)' : hist.vatPercentage && hist.vatPercentage !== 22 ? ` (faturada %${hist.vatPercentage} НДС)` : ''}:{' '}
                                  {formatRuble(Number(hist.unitPriceNet) || Number((hist.unitPrice / 1.22).toFixed(2)))}
                                </div>
                                {((Number((hist as any).excludedFreightAmount) || Number(targetInvoice?.excludedFreightAmount) || 0) > 0) && (
                                  <div className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded inline-block mt-0.5">
                                    🚚 Nakliye Hariç ({formatRuble(Number((hist as any).excludedFreightAmount) || Number(targetInvoice?.excludedFreightAmount) || 0)})
                                  </div>
                                )}
                                {(hist as any).invoiceLinesVerified === false && (
                                  <div
                                    className="text-[9px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-1.5 py-0.5 rounded inline-block mt-0.5"
                                    title="Bu faturanın kalemleri fatura belgesinden doğrulanamadı; kalem toplamı fatura tutarını tutmuyor. Fiyat siparişten (STF) geliyor olabilir."
                                  >
                                    ⚠ Faturayla doğrulanmadı
                                  </div>
                                )}
                                {hist.conversionApplied && (
                                  <div
                                    className="text-[10px] font-normal text-amber-700 mt-0.5 flex items-center justify-end space-x-1"
                                    title={hist.conversionFormula}
                                  >
                                    <span className="line-through text-slate-400 text-[9px]">
                                      {formatRuble(hist.originalUnitPrice)}/{hist.originalUnit}
                                    </span>
                                    <span className="bg-amber-50 border border-amber-200 px-1 py-0.2 rounded text-[9px] text-amber-800 font-semibold">
                                      {hist.conversionFormula ? hist.conversionFormula.split(':')[0] : 'Çevrim'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <div className="font-black">
                                  {formatRuble(hist.originalUnitPrice || hist.unitPrice)}{' '}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /{hist.originalUnit || mat.unit} (KDV Dahil)
                                  </span>
                                </div>
                                <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
                                  KDV Hariç:{' '}
                                  {formatRuble(Number(hist.originalNetUnitPrice) || Number(((hist.originalUnitPrice || hist.unitPrice) / 1.22).toFixed(2)))}
                                </div>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4 text-center">
                            <span
                              className={`font-mono font-bold text-xs px-2 py-0.5 rounded-full border ${
                                diffVsAvg > 0
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : diffVsAvg < 0
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {diffVsAvg > 0
                                ? `+${diffVsAvg}% Ort. Üzeri`
                                : `${diffVsAvg}% Ort. Altı`}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right font-mono">
                            <div className="font-bold text-slate-800">
                              {priceDisplayMode === 'normalized' ? (
                                <>
                                  {hist.quantity} {hist.normalizedUnit || mat.unit}
                                  {hist.conversionApplied && (
                                    <span className="block text-[10px] text-slate-400 font-normal">
                                      ({hist.originalQuantity} {hist.originalUnit})
                                    </span>
                                  )}
                                </>
                              ) : (
                                <>
                                  {hist.originalQuantity || hist.quantity} {hist.originalUnit || mat.unit}
                                </>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-semibold">
                              {formatRuble(
                                hist.originalUnitPrice
                                  ? hist.originalUnitPrice * (hist.originalQuantity || 1)
                                  : hist.quantity * hist.unitPrice
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-center" onClick={e => e.stopPropagation()}>
                            <div className="flex flex-col items-center space-y-1">
                              <button
                                type="button"
                                onClick={handleOpenInvoice}
                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer shadow-2xs"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Faturayı İncele</span>
                              </button>

                              {hist.prizmaBtfUrl && (
                                <a
                                  href={hist.prizmaBtfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-indigo-700 rounded-md text-[10px] font-bold transition-all flex items-center justify-center space-x-1 border border-slate-200"
                                  title="Prizma Sisteminde Bu BTF Ödeme Talebini Aç"
                                >
                                  <span className="font-black text-indigo-600">П</span>
                                  <span>BTF Aç</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
            <div className="text-xs text-slate-500">
              Toplam <strong>{mat.history.length}</strong> fatura kaydı • Ortalama: <strong className="font-mono text-slate-800">{formatRuble(mat.avgUnitPrice)}/{mat.unit}</strong>
            </div>
            <button
              type="button"
              onClick={() => setExpandedMaterialName(null)}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {renderMaterialDetailModal()}
      {/* Top Banner */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-1">
            <BarChart3 className="w-4 h-4" />
            <span>{t('navMaterialCompare')}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-slate-100">
            {t('matCompareTitle')}
          </h1>
          <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl">
            {t('matCompareDesc')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Retroactive Material Audit & Synchronization Button */}
          <button
            onClick={handleRetroactiveAudit}
            disabled={isRetroAuditing}
            className="px-4 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white font-black text-xs rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
            title="Eski ve yeni tüm faturalardaki malzemeleri genel denetler; Köşebent (Adet/Metre/Ton), Çelik Hasır (m²/Kart/Rulo/Ton), Kutu Profil vb. tüm kalemleri tek kanonik standarda eşitler."
          >
            {isRetroAuditing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Geçmiş Denetleniyor...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 text-white" />
                <span>🔄 Geçmişi Denetle & Eşitle</span>
              </>
            )}
          </button>

          {/* AI Normalize Trigger Button */}
          <button
            onClick={handleNormalizeAI}
            disabled={isAnalyzingAI}
            className="px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
          >
            {isAnalyzingAI ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>AI Analiz Ediyor...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 fill-slate-950" />
                <span>✨ {t('mergeMaterials')}</span>
              </>
            )}
          </button>

          {/* Excel Export Button */}
          <button
            onClick={exportToExcel}
            className="px-3.5 py-3 bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl border border-emerald-600 transition-all flex items-center justify-center space-x-1.5 cursor-pointer shadow-md"
            title={t('exportExcel')}
          >
            <Download className="w-4 h-4" />
            <span>{t('exportExcel')}</span>
          </button>

          {/* Manual Merge Trigger Button */}
          <button
            onClick={() => {
              setManualSource(activeComparison?.materialName || '');
              setShowManualMergeModal(true);
            }}
            className="px-3 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
          >
            <Link2 className="w-4 h-4 text-indigo-400" />
            <span>Manuel Birleştir</span>
          </button>

          {/* Otomatik birleştirme önerileri */}
          <button
            onClick={() => {
              setShowSuggestionsModal(true);
              loadMergeSuggestions();
            }}
            className="px-3 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center space-x-1.5 cursor-pointer"
            title="Aynı ölçülere ve benzer fatura satırına sahip, ayrı görünen malzemeleri bulur"
          >
            <Link2 className="w-4 h-4 text-emerald-400" />
            <span>Birleştirme Önerileri</span>
          </button>

          <div className="bg-slate-800/90 border border-slate-700/80 px-4 py-2.5 rounded-xl text-center min-w-28">
            <p className="text-[10px] text-slate-400 font-medium uppercase">Kıyaslanan Kalem</p>
            <p className="text-lg font-black text-amber-400 font-mono mt-0.5">
              {validComparisons.length} Malzeme
            </p>
          </div>

          <div className="bg-slate-800/90 border border-slate-700/80 px-4 py-2.5 rounded-xl text-center min-w-28">
            <p className="text-[10px] text-slate-400 font-medium uppercase">Fiyat Makası Olan</p>
            <p className="text-lg font-black text-rose-400 font-mono mt-0.5">
              {materialsWithGapCount} Kalem
            </p>
          </div>
        </div>
      </div>

      {/* DUAL COMPARISON LENS SWITCHER (1. SEÇENEK: ELMA-ELMA vs 2. SEÇENEK: MUADİL MARKA EKONOMİSİ) */}
      <div className="bg-white rounded-2xl border-2 border-indigo-200/80 p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="text-xs font-extrabold text-indigo-700 uppercase tracking-wider flex items-center space-x-1.5">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Akıllı Çift Modlu Malzeme Kıyaslama Motoru (Faturadaki Orijinal Yazım Bazlı)</span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Türkçe çeviri hatalarını önlemek için <strong>faturadaki orijinal Rusça metni</strong> baz alır; farklı firmaların farklı fatura yazımlarını mantık yürüterek eşitler.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setDualComparisonLens('MODE_1_APPLE_TO_APPLE')}
              className={`px-4 py-3 rounded-xl border text-left transition-all cursor-pointer flex items-start space-x-3 ${
                dualComparisonLens === 'MODE_1_APPLE_TO_APPLE'
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-md ring-2 ring-indigo-300'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
              }`}
            >
              <CheckCircle2 className={`w-5 h-5 shrink-0 mt-0.5 ${dualComparisonLens === 'MODE_1_APPLE_TO_APPLE' ? 'text-amber-300' : 'text-indigo-600'}`} />
              <div>
                <div className="text-xs font-black whitespace-nowrap">
                  1. Seçenek: Elma-Elma Birebir Kıyaslama
                </div>
                <div className={`text-[11px] mt-0.5 ${dualComparisonLens === 'MODE_1_APPLE_TO_APPLE' ? 'text-indigo-100' : 'text-slate-500'}`}>
                  Aynı Marka & Ölçü (Şantiye/Firma Denetimi) • Emtiada Marka Bağımsız ({validComparisons.length} Grup)
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDualComparisonLens('MODE_2_BRAND_EQUIVALENT')}
              className={`px-4 py-3 rounded-xl border text-left transition-all cursor-pointer flex items-start space-x-3 ${
                dualComparisonLens === 'MODE_2_BRAND_EQUIVALENT'
                  ? 'bg-amber-600 text-white border-amber-700 shadow-md ring-2 ring-amber-300'
                  : 'bg-amber-50/70 hover:bg-amber-100/80 text-amber-950 border-amber-200'
              }`}
            >
              <Scale className={`w-5 h-5 shrink-0 mt-0.5 ${dualComparisonLens === 'MODE_2_BRAND_EQUIVALENT' ? 'text-white' : 'text-amber-600'}`} />
              <div>
                <div className="text-xs font-black whitespace-nowrap">
                  2. Seçenek: Muadil Marka & Ekonomi Analizi
                </div>
                <div className={`text-[11px] mt-0.5 ${dualComparisonLens === 'MODE_2_BRAND_EQUIVALENT' ? 'text-amber-100' : 'text-amber-800'}`}>
                  Aynı Teknik Özellik, Farklı Marka (Knauf vs Volma / Icopal vs TechnoNICOL) ({mode2CrossBrandFamilies.length} Aile)
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* MODE 2 WORKSPACE: CROSS-BRAND EQUIVALENT ECONOMY & INTERACTIVE SIMULATOR */}
      {dualComparisonLens === 'MODE_2_BRAND_EQUIVALENT' && (() => {
        const totalMode2EconomyRub = mode2CrossBrandFamilies.reduce((sum, f) => sum + f.totalPotentialEconomyRub, 0);
        const topEconomyFamily = mode2CrossBrandFamilies[0];
        const activeSimFamily = mode2CrossBrandFamilies.find(f => f.familyId === simSelectedFamilyId) || mode2CrossBrandFamilies[0];
        const sourceBrandObj = activeSimFamily?.brands.find(b => b.brandKey === simSourceBrandKey) || activeSimFamily?.priciestBrand;
        const targetBrandObj = activeSimFamily?.brands.find(b => b.brandKey === simTargetBrandKey) || activeSimFamily?.cheapestBrand;
        const simQtyNum = Math.max(1, Number(simCustomQty) || sourceBrandObj?.totalQuantity || 100);
        const unitDiffRub = sourceBrandObj && targetBrandObj ? Number((sourceBrandObj.avgUnitPrice - targetBrandObj.avgUnitPrice).toFixed(2)) : 0;
        const totalSimSavingsRub = Math.round(unitDiffRub * simQtyNum);
        const simSavingsPct = sourceBrandObj && sourceBrandObj.avgUnitPrice > 0
          ? Number(((unitDiffRub / sourceBrandObj.avgUnitPrice) * 100).toFixed(1))
          : 0;

        const filteredMode2Families = mode2CrossBrandFamilies.filter(fam => {
          const q = mode2SearchTerm.trim().toLowerCase();
          if (!q) return true;
          return (
            fam.canonicalFamilyTitleRu.toLowerCase().includes(q) ||
            fam.canonicalFamilyTitleTr.toLowerCase().includes(q) ||
            fam.canonicalSpecLabel.toLowerCase().includes(q) ||
            fam.brands.some(b =>
              b.brandDisplay.toLowerCase().includes(q) ||
              b.originalWritings.some(w => w.toLowerCase().includes(q))
            )
          );
        });

        return (
          <div className="space-y-6">
            {/* Mode 2 KPI Summary Strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Otomatik En Ucuz Muadil Tasarruf Potansiyeli
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-emerald-400 mt-1">
                  {formatRuble(totalMode2EconomyRub)}
                </div>
                <p className="text-[11px] text-slate-300 mt-1">
                  Aynı teknik özellikteki pahalı markalar yerine en uygun muadil marka tercih edilseydi kazanılacak toplam ekonomi
                </p>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  En Yüksek Marka Farkı Fırsatı
                </div>
                <div className="text-base font-black text-slate-900 mt-1 truncate">
                  {topEconomyFamily ? topEconomyFamily.canonicalFamilyTitleTr : 'Muadil Aile Yok'}
                </div>
                {topEconomyFamily && (
                  <div className="text-xs font-mono tabular-nums text-amber-700 font-bold mt-1">
                    {topEconomyFamily.priciestBrand.brandDisplay} → {topEconomyFamily.cheapestBrand.brandDisplay} (%{topEconomyFamily.maxBrandPriceGapPct} Fark • {formatRuble(topEconomyFamily.totalPotentialEconomyRub)})
                  </div>
                )}
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  İncelenen Teknik Muadil Ailesi
                </div>
                <div className="text-2xl font-black font-mono tabular-nums text-indigo-950 mt-1">
                  {mode2CrossBrandFamilies.length} Teknik Grup
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Standart emtialar (demir, çelik, beton) hariç; alçıpan, membran, izolasyon, sıva ve sarf grupları
                </p>
              </div>
            </div>

            {/* INTERACTIVE BRAND A vs BRAND B ECONOMY SIMULATOR */}
            {activeSimFamily && sourceBrandObj && targetBrandObj && (
              <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-2">
                      <Calculator className="w-4 h-4" />
                      <span>Muadil Marka & Alternatif Ekonomi Simülatörü (Knauf vs Volma / Icopal vs TechnoNICOL)</span>
                    </div>
                    <h2 className="text-lg font-extrabold text-white mt-1">
                      "Aynı Teknik Özellikte A Markası Yerine B Markasını Alsaydık Ne Kadar Ekonomi Yapardık?"
                    </h2>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {mode2CrossBrandFamilies.slice(0, 4).map(fam => {
                      const isSelected = fam.familyId === activeSimFamily.familyId;
                      return (
                        <button
                          key={fam.familyId}
                          type="button"
                          onClick={() => {
                            setSimSelectedFamilyId(fam.familyId);
                            setSimSourceBrandKey(fam.priciestBrand.brandKey);
                            setSimTargetBrandKey(fam.cheapestBrand.brandKey);
                            setSimCustomQty(String(fam.priciestBrand.totalQuantity || 100));
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border whitespace-nowrap ${
                            isSelected
                              ? 'bg-amber-500 text-slate-950 border-amber-400'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                          }`}
                        >
                          {fam.priciestBrand.brandDisplay.split(' ')[0]} vs {fam.cheapestBrand.brandDisplay.split(' ')[0]} ({fam.canonicalSpecLabel.split('•')[0].trim()})
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Controls Grid */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                      1. Orijinal Teknik Malzeme Ailesi Seçin
                    </label>
                    <select
                      value={activeSimFamily.familyId}
                      onChange={e => {
                        const nextFam = mode2CrossBrandFamilies.find(f => f.familyId === e.target.value);
                        if (nextFam) {
                          setSimSelectedFamilyId(nextFam.familyId);
                          setSimSourceBrandKey(nextFam.priciestBrand.brandKey);
                          setSimTargetBrandKey(nextFam.cheapestBrand.brandKey);
                          setSimCustomQty(String(nextFam.priciestBrand.totalQuantity || 100));
                        }
                      }}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      {mode2CrossBrandFamilies.map(fam => (
                        <option key={fam.familyId} value={fam.familyId}>
                          {fam.canonicalFamilyTitleTr} [{fam.canonicalSpecLabel}] ({fam.brands.length} Marka)
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] font-mono text-amber-300/90 mt-1 truncate">
                      🇷🇺 {activeSimFamily.canonicalFamilyTitleRu}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-rose-300 mb-1.5">
                      2. Alınan / Pahalı Marka (A Markası)
                    </label>
                    <select
                      value={sourceBrandObj.brandKey}
                      onChange={e => {
                        setSimSourceBrandKey(e.target.value);
                        const b = activeSimFamily.brands.find(x => x.brandKey === e.target.value);
                        if (b) setSimCustomQty(String(b.totalQuantity || 100));
                      }}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-rose-500/40 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      {activeSimFamily.brands.map(b => (
                        <option key={b.brandKey} value={b.brandKey}>
                          {b.brandDisplay} — Ort: {formatRuble(b.avgUnitPrice)}/{activeSimFamily.unit}
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] font-mono text-slate-400 mt-1 truncate" title={sourceBrandObj.originalWritings[0]}>
                      Fatura: "{sourceBrandObj.originalWritings[0] || activeSimFamily.canonicalFamilyTitleRu}"
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-emerald-300 mb-1.5">
                      3. Alternatif Muadil Marka (B Markası)
                    </label>
                    <select
                      value={targetBrandObj.brandKey}
                      onChange={e => setSimTargetBrandKey(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-emerald-500/40 rounded-xl text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {activeSimFamily.brands.map(b => (
                        <option key={b.brandKey} value={b.brandKey}>
                          {b.brandDisplay} — Ort: {formatRuble(b.avgUnitPrice)}/{activeSimFamily.unit}
                          {b.brandKey === activeSimFamily.cheapestBrand.brandKey ? ' (★ En Ekonomik Muadil)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="text-[10px] font-mono text-slate-400 mt-1 truncate" title={targetBrandObj.originalWritings[0]}>
                      Fatura: "{targetBrandObj.originalWritings[0] || activeSimFamily.canonicalFamilyTitleRu}"
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1.5">
                      4. Kıyaslanacak Alım Miktarı ({activeSimFamily.unit})
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={simCustomQty}
                      onChange={e => setSimCustomQty(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-mono font-bold text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500 tabular-nums"
                    />
                    <div className="text-[10px] text-slate-400 mt-1">
                      {sourceBrandObj.brandDisplay} toplam alım: <strong className="font-mono">{sourceBrandObj.totalQuantity} {activeSimFamily.unit}</strong>
                    </div>
                  </div>
                </div>

                {/* Simulation Result Banner */}
                <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400">Seçilen Marka Dönüşümü</div>
                    <div className="text-sm font-black text-white flex items-center space-x-2">
                      <span className="text-rose-300">{sourceBrandObj.brandDisplay}</span>
                      <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-emerald-300">{targetBrandObj.brandDisplay}</span>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-300">
                      {formatRuble(sourceBrandObj.avgUnitPrice)}/{activeSimFamily.unit} → {formatRuble(targetBrandObj.avgUnitPrice)}/{activeSimFamily.unit}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400">Birim Başına Fiyat Farkı & Oran</div>
                    <div className={`text-lg font-black font-mono tabular-nums ${unitDiffRub > 0 ? 'text-amber-400' : 'text-slate-300'}`}>
                      {unitDiffRub > 0 ? `-${formatRuble(unitDiffRub)} / ${activeSimFamily.unit}` : formatRuble(Math.abs(unitDiffRub))}
                    </div>
                    <div className="text-xs text-slate-300">
                      {unitDiffRub > 0
                        ? `Birim maliyette %${simSavingsPct} net ekonomi`
                        : unitDiffRub < 0
                        ? 'Seçilen alternatif marka daha pahalı'
                        : 'Aynı marka seçildi'}
                    </div>
                  </div>

                  <div className="bg-emerald-950/50 border border-emerald-500/30 p-3.5 rounded-xl text-right">
                    <div className="text-[11px] font-bold text-emerald-300 uppercase">
                      {simQtyNum} {activeSimFamily.unit} Alımda Net Ekonomi
                    </div>
                    <div className="text-2xl font-black font-mono tabular-nums text-emerald-400 mt-0.5">
                      {totalSimSavingsRub > 0 ? formatRuble(totalSimSavingsRub) : '0 ₽'}
                    </div>
                    <div className="text-[10px] text-slate-300 mt-0.5">
                      {formatRuble(Math.round(sourceBrandObj.avgUnitPrice * simQtyNum))} yerine {formatRuble(Math.round(targetBrandObj.avgUnitPrice * simQtyNum))} ödeme
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MODE 2 FAMILIES TABLE */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Teknik Muadil Aileleri & Markalar Arası Fiyat Kıyaslama Matrisi ({filteredMode2Families.length} Aile)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Faturadaki orijinal yazıma göre teknik özellikleri ve kalınlıkları aynı olup markaları farklı olan malzemeler
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Knauf, Volma, Icopal, ГКЛ, ЭПП ara..."
                    value={mode2SearchTerm}
                    onChange={e => setMode2SearchTerm(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                  />
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {filteredMode2Families.map((fam, idx) => (
                  <div key={fam.familyId} className="p-5 hover:bg-slate-50/70 transition-colors space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-400">#{idx + 1}</span>
                          <span className="text-base font-black text-slate-900">
                            {fam.canonicalFamilyTitleTr}
                          </span>
                          <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                            {fam.canonicalSpecLabel} • Birim: {fam.unit}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-600">
                          🇷🇺 Orijinal Teknik İmza: <strong>{fam.originalSpecSummary}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-[10px] font-bold text-slate-500 uppercase">
                            En Ucuz Muadile Geçiş Tasarrufu
                          </div>
                          <div className="text-base font-black font-mono tabular-nums text-emerald-700">
                            {formatRuble(fam.totalPotentialEconomyRub)} (-%{fam.maxBrandPriceGapPct})
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSimSelectedFamilyId(fam.familyId);
                            setSimSourceBrandKey(fam.priciestBrand.brandKey);
                            setSimTargetBrandKey(fam.cheapestBrand.brandKey);
                            setSimCustomQty(String(fam.priciestBrand.totalQuantity || 100));
                            window.scrollTo({ top: 180, behavior: 'smooth' });
                          }}
                          className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1.5"
                        >
                          <Calculator className="w-3.5 h-3.5" />
                          <span>Simülatörde Kıyasla</span>
                        </button>
                      </div>
                    </div>

                    {/* Side-by-Side Brand Cards within this Technical Family */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {fam.brands.map(b => {
                        const isCheapest = b.brandKey === fam.cheapestBrand.brandKey;
                        return (
                          <div
                            key={b.brandKey}
                            className={`p-3.5 rounded-xl border ${
                              isCheapest
                                ? 'bg-emerald-50/60 border-emerald-300'
                                : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-black text-slate-900">
                                {b.brandDisplay}
                              </span>
                              {isCheapest ? (
                                <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                                  ★ En Ekonomik Muadil
                                </span>
                              ) : (
                                <span className="text-[10px] font-extrabold text-rose-800 bg-rose-100 px-2 py-0.5 rounded border border-rose-200 font-mono tabular-nums">
                                  +%{b.diffVsCheapestPct} Daha Pahalı (+{formatRuble(b.diffVsCheapestRub)}/{fam.unit})
                                </span>
                              )}
                            </div>

                            <div className="mt-2 flex items-baseline justify-between">
                              <div>
                                <span className="text-[11px] text-slate-500">Ort. Birim Fiyat: </span>
                                <span className="text-base font-black font-mono tabular-nums text-slate-900">
                                  {formatRuble(b.avgUnitPrice)}/{fam.unit}
                                </span>
                              </div>
                              <div className="text-xs font-mono tabular-nums text-slate-600">
                                {b.totalQuantity} {fam.unit}
                              </div>
                            </div>

                            <div className="mt-2 text-[11px] font-mono text-slate-600 bg-slate-100/80 p-2 rounded border border-slate-200/80 truncate" title={b.originalWritings.join(' | ')}>
                              🇷🇺 "{b.originalWritings[0] || fam.canonicalFamilyTitleRu}"
                            </div>

                            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                              <span className="truncate max-w-[60%]" title={b.jobsites.join(', ')}>
                                Şantiye: {b.jobsites.join(', ') || 'Tüm Şantiyeler'}
                              </span>
                              {!isCheapest && b.potentialSavingsIfSwitchedToCheapest > 0 && (
                                <span className="font-mono font-bold text-emerald-700 shrink-0">
                                  Kazanç: {formatRuble(b.potentialSavingsIfSwitchedToCheapest)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}


      {/* Smart Construction Unit Normalization & AI Intelligence Callout */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/70 to-slate-900 border border-indigo-500/30 p-4 sm:p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs text-slate-200 shadow-md">
        <div className="flex items-start space-x-3.5">
          <div className="p-2.5 bg-indigo-600/30 border border-indigo-500/40 rounded-xl text-indigo-300 shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="font-extrabold text-white text-sm flex flex-wrap items-center gap-2">
              <span>📐 Akıllı Şantiye Birim Çevrim ve Eşdeğerlik Motoru</span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-500/30">
                GOST / TS / EN Uyumlu
              </span>
              {multipleUnitsCount > 0 && (
                <span className="bg-purple-500/20 text-purple-300 text-[10px] font-mono px-2 py-0.5 rounded-full border border-purple-500/30">
                  {multipleUnitsCount} Malzemede Çoklu Birim Düzeltildi
                </span>
              )}
            </div>
            <p className="text-slate-300 leading-relaxed text-[11px] max-w-3xl">
              Farklı faturalarda aynı malzeme bazen <strong>Ton</strong>, bazen <strong>Metre Tül</strong>, bazen <strong>Rulo</strong> veya <strong>m²</strong> olarak alınmış olabilir. Sistem elma ile armut kıyaslama hatasını önlemek için tüm fiyatları inşaat standartlarına göre ortak eşdeğer birime dönüştürür.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Display Mode Toggle */}
          <div className="flex items-center bg-slate-950/90 border border-slate-700/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setPriceDisplayMode('normalized')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                priceDisplayMode === 'normalized'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Farklı birimleri ortak standart birime çevirerek adil kıyaslar"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Normalize (Elma-Elma)</span>
            </button>
            <button
              type="button"
              onClick={() => setPriceDisplayMode('original')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                priceDisplayMode === 'original'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Faturalarda yazan ham birim ve fiyatları gösterir"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Orijinal Faturalar</span>
            </button>
          </div>

          {/* Unit Converter Lab Trigger */}
          <button
            type="button"
            onClick={() => {
              setLabSelectedMaterial(activeComparison?.materialName || 'Арматура А500С ф12 мм');
              setLabSelectedUnit(activeComparison?.unit || 'metre');
              setShowUnitLabModal(true);
            }}
            className="px-3.5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <Calculator className="w-3.5 h-3.5 text-purple-200" />
            <span>Birim Laboratuvarı</span>
          </button>
        </div>
      </div>

      {/* COMMODITY vs BRAND/QUALITY SEGMENT FILTER BAR */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider mr-1 flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            <span>Kıyaslama Rejimi:</span>
          </span>

          <button
            type="button"
            onClick={() => {
              setComparisonModeFilter('ALL');
              setQualitySegmentFilter('ALL');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              comparisonModeFilter === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            Tümü ({validComparisons.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setComparisonModeFilter(comparisonModeFilter === 'COMMODITY_STANDARD' ? 'ALL' : 'COMMODITY_STANDARD');
              setQualitySegmentFilter('ALL');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center space-x-1.5 ${
              comparisonModeFilter === 'COMMODITY_STANDARD'
                ? 'bg-sky-700 text-white border-sky-800 ring-2 ring-sky-200 shadow-xs'
                : 'bg-sky-50/70 hover:bg-sky-100/80 text-sky-900 border-sky-200'
            }`}
            title="Demir, hazır beton, çelik profil, kereste, kum, çakıl ve GOST kablolar marka fark etmeksizin tüm tedarikçiler arasında doğrudan kıyaslanır."
          >
            <span>🏗️ Standart Emtia ("Demir Demirdir" — Marka Bağımsız)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
              comparisonModeFilter === 'COMMODITY_STANDARD' ? 'bg-sky-900 text-sky-100' : 'bg-sky-100 text-sky-800'
            }`}>
              {segmentModeCounts.commodityCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setComparisonModeFilter(comparisonModeFilter === 'BRAND_SEGMENTED' ? 'ALL' : 'BRAND_SEGMENTED');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border flex items-center space-x-1.5 ${
              comparisonModeFilter === 'BRAND_SEGMENTED'
                ? 'bg-amber-600 text-white border-amber-700 ring-2 ring-amber-200 shadow-xs'
                : 'bg-amber-50/70 hover:bg-amber-100/80 text-amber-900 border-amber-200'
            }`}
            title="Yalıtım membranı, XPS, alçıpan, İSG ekipmanı, el aletleri ve sarf malzemeleri kendi marka/kalite segmenti içinde (Premium vs Premium, Ekonomik vs Ekonomik) adil kıyaslanır."
          >
            <span>🏷️ Marka & Kalite Segmentli ("Mercedes / Lada" Ayrımı)</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
              comparisonModeFilter === 'BRAND_SEGMENTED' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-900'
            }`}>
              {segmentModeCounts.brandSegmentedCount}
            </span>
          </button>
        </div>

        {/* Quality Tier Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t lg:border-t-0 pt-2 lg:pt-0 border-slate-100">
          <span className="text-[10px] font-bold text-slate-500 uppercase mr-1">Kalite Segmenti:</span>
          {[
            { id: 'PREMIUM' as const, label: '👑 Premium / Profesyonel', count: segmentModeCounts.premiumCount, activeClass: 'bg-amber-600 text-white border-amber-700', idleClass: 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100' },
            { id: 'STANDARD' as const, label: '⚖️ Standart Seri', count: segmentModeCounts.standardCount, activeClass: 'bg-emerald-600 text-white border-emerald-700', idleClass: 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100' },
            { id: 'ECONOMY' as const, label: '📦 Ekonomik Seri', count: segmentModeCounts.economyCount, activeClass: 'bg-slate-700 text-white border-slate-800', idleClass: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200' }
          ].map(tier => {
            const isActive = qualitySegmentFilter === tier.id;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => {
                  if (isActive) {
                    setQualitySegmentFilter('ALL');
                  } else {
                    setComparisonModeFilter('BRAND_SEGMENTED');
                    setQualitySegmentFilter(tier.id);
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer border flex items-center space-x-1 ${
                  isActive ? tier.activeClass : tier.idleClass
                }`}
              >
                <span>{tier.label}</span>
                <span className="text-[10px] font-mono opacity-85">({tier.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* QUICK MATERIAL FOCUS PILLS */}
      <div className="bg-slate-100/80 p-3 rounded-2xl border border-slate-200/80 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider mr-1 flex items-center space-x-1">
          <Filter className="w-3.5 h-3.5 text-indigo-600" />
          <span>Hızlı Kıyaslama:</span>
        </span>
        {[
          { label: '🏗️ İnşaat Demiri', term: 'İnşaat Demiri' },
          { label: '🔩 Ankraj Sistemleri', term: 'Ankraj' },
          { label: '⛓️ Donatı Malzemeleri', term: 'Donatı' },
          { label: '📦 Kutu Profil & Boru', term: 'Kutu Profil' },
          { label: '📐 Köşebent (L-Demir)', term: 'Köşebent' },
          { label: '🕸️ Çelik Hasır', term: 'Çelik Hasır' },
          { label: '🛡️ Yalıtım & Membran', term: 'Membran' },
          { label: '🧱 Gazbeton Blok', term: 'Gazbeton' }
        ].map(p => ({ ...p, count: quickPillCounts[p.term] || 0 })).map(pill => {
          const isActive = searchTerm === pill.term;
          return (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                if (isActive) {
                  setSearchTerm('');
                } else {
                  setSearchTerm(pill.term);
                  setSelectedCategory('ALL');
                }
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border shadow-2xs ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-300'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <span>{pill.label}</span>
              {pill.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                  isActive ? 'bg-indigo-800 text-indigo-100' : 'bg-slate-100 text-slate-600'
                }`}>
                  {pill.count}
                </span>
              )}
            </button>
          );
        })}
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline ml-2 cursor-pointer"
          >
            Filtreyi Temizle
          </button>
        )}
      </div>

      {/* CATEGORY OVERVIEW CARDS GRID */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-800">
            <FolderOpen className="w-4 h-4 text-indigo-600" />
            <span>Malzeme Kategorileri ({categories.length} Kategori)</span>
          </div>
          {selectedCategory !== 'ALL' && (
            <button
              onClick={() => setSelectedCategory('ALL')}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
            >
              Tüm Kategorileri Göster
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {/* All Categories Card */}
          <div
            onClick={() => setSelectedCategory('ALL')}
            className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
              selectedCategory === 'ALL'
                ? 'bg-slate-900 text-white border-slate-800 shadow-lg ring-2 ring-indigo-500/50'
                : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-2xs'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-black truncate">Tüm Kategoriler</span>
              <FolderOpen className={`w-4 h-4 ${selectedCategory === 'ALL' ? 'text-amber-400' : 'text-slate-400'}`} />
            </div>
            <div className="mt-3 space-y-0.5">
              <div className={`text-lg font-black font-mono ${selectedCategory === 'ALL' ? 'text-amber-400' : 'text-indigo-950'}`}>
                {validComparisons.length} <span className="text-[10px] font-normal text-slate-400">Kalem</span>
              </div>
              <div className={`text-[10px] font-mono font-bold ${selectedCategory === 'ALL' ? 'text-slate-300' : 'text-slate-500'}`}>
                {formatRuble(validComparisons.reduce((acc, curr) => acc + curr.totalSpend, 0))}
              </div>
            </div>
          </div>

          {/* Individual Category Cards */}
          {categories.map(cat => {
            const stats = categoryStats[cat] || { count: 0, totalSpend: 0, maxGap: 0, gapCount: 0 };
            const isSelected = selectedCategory === cat;

            return (
              <div
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  // Ensure this category is expanded in grouped mode
                  if (collapsedCategories[cat] !== false) {
                    toggleCategoryCollapse(cat);
                  }
                }}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-800 shadow-lg ring-2 ring-indigo-500/50'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-2xs'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center space-x-1.5 truncate">
                    {getCategoryIcon(cat)}
                    <span className="text-xs font-black truncate">{cat}</span>
                  </div>
                  {stats.gapCount > 0 && (
                    <span className={`text-[9px] font-black px-1.5 py-0.2 rounded-full shrink-0 ${
                      isSelected ? 'bg-amber-400 text-slate-950' : 'bg-rose-100 text-rose-700 border border-rose-200'
                    }`}>
                      %{stats.maxGap}
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-0.5">
                  <div className={`text-lg font-black font-mono ${isSelected ? 'text-amber-400' : 'text-slate-900'}`}>
                    {stats.count} <span className="text-[10px] font-normal text-slate-400">Kalem</span>
                  </div>
                  <div className={`text-[10px] font-mono font-bold ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {formatRuble(stats.totalSpend)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter, Search & Sorting Control Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Inputs */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Malzeme adı, Rusça tanım veya kod ara..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Dedicated Fatura No Filter */}
            <div className="relative w-full sm:w-44">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Fatura No Filtrele..."
                value={invoiceNoFilter}
                onChange={e => setInvoiceNoFilter(e.target.value)}
                className="w-full pl-9 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs font-bold"
              />
              {invoiceNoFilter && (
                <button
                  type="button"
                  onClick={() => setInvoiceNoFilter('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Right Action Switchers */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Sort By Dropdown */}
            <div className="flex items-center space-x-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="py-1.5 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-medium text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="gap">Sırala: En Yüksek Fiyat Farkı (% Fark)</option>
                <option value="spend">Sırala: En Çok Harcama Yapılan (₽)</option>
                <option value="qty">Sırala: En Çok Miktar Alınan</option>
                <option value="name">Sırala: Malzeme Adı (A-Z)</option>
              </select>
            </div>

            {/* View Mode Toggle: Grouped vs Flat */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 space-x-1">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  viewMode === 'grouped'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Kategori bazlı açılır akordiyon gruplar"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Kategorili</span>
              </button>
              <button
                onClick={() => setViewMode('flat')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer ${
                  viewMode === 'flat'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Sıralı tüm malzeme listesi"
              >
                <Table className="w-3.5 h-3.5" />
                <span>Düz Liste</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filter Dropdowns Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          {/* Category Selector Dropdown */}
          <SearchableFilterDropdown
            label="Kategori"
            selectedKey={selectedCategory === 'ALL' ? 'all' : selectedCategory}
            options={[
              { key: 'all', label: 'Tüm Kategoriler', count: validComparisons.length },
              ...categories.map(c => ({
                key: c,
                label: c,
                count: categoryStats[c]?.count || 0
              }))
            ]}
            onSelect={key => setSelectedCategory(key === 'all' ? 'ALL' : key)}
            placeholder="Kategori ara..."
            icon={Tag}
          />

          {/* Şantiye Dropdown */}
          <SearchableFilterDropdown
            label="Şantiye"
            selectedKey={selectedJobsite === 'ALL' ? 'all' : selectedJobsite}
            options={[
              { key: 'all', label: 'Tüm Şantiyeler', count: uniqueJobsites.length },
              ...uniqueJobsites.map(j => ({
                key: j,
                label: j,
                count: validComparisons.filter(c => c.history.some(h => h.jobsiteName === j)).length
              }))
            ]}
            onSelect={key => setSelectedJobsite(key === 'all' ? 'ALL' : key)}
            placeholder="Şantiye ara..."
          />

          {/* Tedarikçi Dropdown */}
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
            onSelect={key => setSelectedVendor(key === 'all' ? 'ALL' : key)}
            placeholder="Tedarikçi ara..."
          />

          {/* Şef Dropdown */}
          <SearchableFilterDropdown
            label="Şef"
            selectedKey={selectedSupervisor === 'ALL' ? 'all' : selectedSupervisor}
            options={[
              { key: 'all', label: 'Tüm Şefler', count: uniqueSupervisors.length },
              ...uniqueSupervisors.map(s => ({
                key: s,
                label: s,
                count: validComparisons.filter(c => c.history.some(h => (h.uploadedBySupervisorName || '') === s)).length
              }))
            ]}
            onSelect={key => setSelectedSupervisor(key === 'all' ? 'ALL' : key)}
            placeholder="Şef ara..."
          />

          {/* Date Range Filter */}
          <DateRangeFilterDropdown
            value={dateFilter}
            onChange={setDateFilter}
          />

          {/* Only Price Gap Toggle */}
          <label className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-xl cursor-pointer hover:bg-slate-100 select-none">
            <input
              type="checkbox"
              checked={onlyWithPriceGap}
              onChange={e => setOnlyWithPriceGap(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span className="font-bold text-slate-700">Fiyat Farkı Olanlar</span>
          </label>

          {/* Only Multiple Units Toggle */}
          <label className="flex items-center space-x-1.5 bg-purple-50/80 border border-purple-200 px-2.5 py-1.5 rounded-xl cursor-pointer hover:bg-purple-100 select-none">
            <input
              type="checkbox"
              checked={onlyMultipleUnits}
              onChange={e => setOnlyMultipleUnits(e.target.checked)}
              className="rounded text-purple-600 focus:ring-purple-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span className="font-bold text-purple-900 flex items-center space-x-1">
              <Scale className="w-3.5 h-3.5 text-purple-600" />
              <span>Çoklu Birim ({multipleUnitsCount})</span>
            </span>
          </label>

          {/* Prizma ERP & GES Arşiv Source Filter Toggle */}
          <div className="inline-flex rounded-xl p-0.5 bg-slate-200/80 border border-slate-300 text-xs">
            <button
              type="button"
              onClick={() => setPrizmaSourceFilter('all')}
              className={`px-2.5 py-1 font-bold rounded-lg transition-all ${
                prizmaSourceFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tüm Kaynaklar ({sourceCounts.all})
            </button>
            <button
              type="button"
              onClick={() => setPrizmaSourceFilter('prizma_only')}
              className={`px-2.5 py-1 font-bold rounded-lg transition-all flex items-center space-x-1 ${
                prizmaSourceFilter === 'prizma_only'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-blue-700 hover:text-blue-900'
              }`}
              title="Sadece Prizma ERP'den gelen faturaları ve miktarları göster"
            >
              <span className="font-black text-[11px]">П</span>
              <span>Prizma ERP ({sourceCounts.prizma})</span>
            </button>
            <button
              type="button"
              onClick={() => setPrizmaSourceFilter('local_only')}
              className={`px-2.5 py-1 font-bold rounded-lg transition-all flex items-center space-x-1 ${
                prizmaSourceFilter === 'local_only'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-emerald-700 hover:text-emerald-900'
              }`}
              title="Sadece GES arşivine satınalma personeli ve şefleri tarafından yüklenen faturaları ve miktarları göster"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>GES Arşiv ({sourceCounts.ges})</span>
            </button>
          </div>

          {/* Reset Filters Button */}
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

          <span className="text-xs font-mono font-bold text-slate-500 ml-auto sm:ml-0">
            {filteredMaterials.length} / {validComparisons.length} Malzeme
          </span>
        </div>
      </div>

      {/* MASTER COMPARISON DISPLAY */}
      {viewMode === 'grouped' ? (
        <div className="space-y-4">
          {/* Global Group Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-100 px-4 py-2.5 rounded-2xl border border-slate-200 text-xs">
            <div className="flex items-center space-x-2 text-slate-800 font-extrabold">
              <FolderOpen className="w-4 h-4 text-indigo-600" />
              <span>Kategori Grupları ({Object.keys(groupedFilteredMaterials).length} Aktif Kategori / {filteredMaterials.length} Malzeme)</span>
            </div>
            <div className="flex items-center space-x-2 self-end sm:self-auto">
              <button
                onClick={expandAllCategories}
                className="text-[11px] font-extrabold text-indigo-700 hover:text-indigo-900 px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-2xs cursor-pointer transition-colors"
              >
                Tüm Grupları Aç
              </button>
              <button
                onClick={collapseAllCategories}
                className="text-[11px] font-extrabold text-slate-700 hover:text-slate-900 px-2.5 py-1 bg-white rounded-lg border border-slate-200 shadow-2xs cursor-pointer transition-colors"
              >
                Tüm Grupları Daralt
              </button>
            </div>
          </div>

          {Object.keys(groupedFilteredMaterials).length === 0 ? (
            <div className="p-12 text-center space-y-3 bg-white rounded-2xl border border-slate-200">
              <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <Info className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Eşleşen Malzeme Bulunamadı</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Arama veya filtre kriterlerinizi değiştirebilirsiniz.
              </p>
            </div>
          ) : (
            Object.entries(groupedFilteredMaterials).map(([catName, rawList]) => {
              const matList = rawList as MaterialComparison[];
              const isCatCollapsed = collapsedCategories[catName] !== false;
              const catTotalSpend = matList.reduce((acc, curr) => acc + curr.totalSpend, 0);
              const catMaxGap = Math.max(...matList.map(m => m.priceDifferencePercentage));

              return (
                <div key={catName} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                  {/* CATEGORY ACCORDION HEADER */}
                  <div
                    onClick={() => toggleCategoryCollapse(catName)}
                    className="p-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-850 transition-all select-none border-b border-slate-800"
                  >
                    <div className="flex items-center space-x-3">
                      <button
                        type="button"
                        className="p-1.5 bg-slate-800 text-amber-400 rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        {isCatCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <div className="flex items-center space-x-2.5">
                        <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30 shrink-0">
                          {getCategoryIcon(catName)}
                        </div>
                        <div>
                          <h3 className="text-base font-black text-white flex items-center space-x-2">
                            <span>{catName}</span>
                            <span className="text-xs font-mono font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                              {matList.length} Malzeme Kalemi
                            </span>
                          </h3>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Gruptaki Toplam Harcama: <strong className="text-slate-200 font-mono">{formatRuble(catTotalSpend)}</strong>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0 self-end sm:self-auto">
                      {catMaxGap > 0 && (
                        <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center space-x-1">
                          <Zap className="w-3.5 h-3.5 text-rose-400" />
                          <span>%{catMaxGap} Maks. Fiyat Farkı</span>
                        </span>
                      )}
                      <span className="text-xs font-mono font-extrabold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20">
                        {formatRuble(catTotalSpend)}
                      </span>
                    </div>
                  </div>

                  {/* CATEGORY ACCORDION BODY TABLE */}
                  {!isCatCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-100/80 text-slate-700 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                            <th className="py-3 px-4 w-10 text-center">#</th>
                            <th className="py-3 px-4">Malzeme İsmi</th>
                            <th className="py-3 px-4 text-right">Ort. Birim Fiyat</th>
                            <th className="py-3 px-4">En Uygun Şantiye</th>
                            <th className="py-3 px-4">En Pahalı Şantiye</th>
                            <th className="py-3 px-4 text-center">Fiyat Makası (% Fark)</th>
                            <th className="py-3 px-4 text-right">Toplam Alım & Harcama</th>
                            <th className="py-3 px-4 text-center w-24">Ayrıntı</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {matList.slice(0, visibleRowsByCategory[catName] || ROWS_PER_GROUP).map((mat, index) => renderMaterialRow(mat, index))}
                        </tbody>
                      </table>
                      {matList.length > (visibleRowsByCategory[catName] || ROWS_PER_GROUP) && (
                        <button
                          type="button"
                          onClick={() => setVisibleRowsByCategory(prev => ({ ...prev, [catName]: matList.length }))}
                          className="w-full py-2.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-slate-50 hover:bg-slate-100 border-t border-slate-200 cursor-pointer"
                        >
                          Tümünü göster ({matList.length - (visibleRowsByCategory[catName] || ROWS_PER_GROUP)} kalem daha)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* FLAT MASTER COMPARISON TABLE MODE */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Table className="w-4 h-4 text-indigo-600" />
              <h2 className="font-extrabold text-slate-900 text-sm">
                Malzeme Fiyat Karşılaştırma Düz Listesi ({filteredMaterials.length} Kalem)
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              Satıra tıklayarak şantiye bazlı ayrıntılı dökümü alt alta görüntüleyebilirsiniz.
            </span>
          </div>

          {filteredMaterials.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <Info className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Eşleşen Malzeme Bulunamadı</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Arama kriterlerinizi değiştirebilir veya yeni faturalar ekleyebilirsiniz.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-700 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="py-3 px-4 w-10 text-center">#</th>
                    <th className="py-3 px-4">Malzeme & Kategori</th>
                    <th className="py-3 px-4 text-right">Ort. Birim Fiyat</th>
                    <th className="py-3 px-4">En Uygun Şantiye</th>
                    <th className="py-3 px-4">En Pahalı Şantiye</th>
                    <th className="py-3 px-4 text-center">Fiyat Makası (% Fark)</th>
                    <th className="py-3 px-4 text-right">Toplam Alım & Harcama</th>
                    <th className="py-3 px-4 text-center w-24">Ayrıntı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredMaterials.slice(0, visibleRowsByCategory['__flat__'] || ROWS_PER_GROUP * 4).map((mat, index) => renderMaterialRow(mat, index))}
                </tbody>
              </table>
              {filteredMaterials.length > (visibleRowsByCategory['__flat__'] || ROWS_PER_GROUP * 4) && (
                <button
                  type="button"
                  onClick={() => setVisibleRowsByCategory(prev => ({ ...prev, __flat__: filteredMaterials.length }))}
                  className="w-full py-2.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-slate-50 hover:bg-slate-100 border-t border-slate-200 cursor-pointer"
                >
                  Tümünü göster ({filteredMaterials.length - (visibleRowsByCategory['__flat__'] || ROWS_PER_GROUP * 4)} kalem daha)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* PRICE TREND CHART FOR SELECTED MATERIAL */}
      {activeComparison && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-5 h-5 text-indigo-600" />
                <span>
                  Zaman İçi Birim Fiyat Değişim Grafiği: {activeComparison.materialName} (₽ /{' '}
                  {activeComparison.unit})
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Seçili malzemenin faturalara yansıyan zaman serisi birim fiyat değişimleri
              </p>
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <span className="text-slate-500">Ort. Fiyat:</span>
              <span className="font-black text-indigo-700 font-mono text-sm">
                {formatRuble(activeComparison.avgUnitPrice)}
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartHistoryData}
                margin={{ top: 10, right: 20, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={['auto', 'auto']}
                  tickFormatter={v => `${v}₽`}
                />
                <Tooltip
                  formatter={(value: any, name: any, props: any) => [
                    `${formatRuble(Number(value))} (${props.payload.Şantiye})`,
                    'Birim Fiyat'
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="Birim Fiyat (₽)"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ r: 6, fill: '#f59e0b', strokeWidth: 2 }}
                  activeDot={{ r: 8 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* AI Analyzing Spinner Modal */}
      {isAnalyzingAI && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-slate-900">
              Gemini AI Malzemeleri Analiz Ediyor...
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Rusça GOST standartları (ГОСТ 34028), demir ölçüleri (Ø14 / 14х11700), harç sınıfları
              (М150 / Пескобетон) ve tedarikçi terimleri karşılaştırılıyor. Aynı malzemeler tek başlıkta
              otomatik birleştirilecek.
            </p>
            <div className="flex justify-center pt-2">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            </div>
          </div>
        </div>
      )}

      {/* AI Merge Results Modal */}
      {mergeResultsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-emerald-700 font-black text-base">
                <Check className="w-5 h-5 bg-emerald-100 rounded-full p-0.5" />
                <span>AI Akıllı Birleştirme Tamamlandı!</span>
              </div>
              <button
                onClick={() => setMergeResultsModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {mergeResultsModal.mergedPairs.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 font-medium">
                  Gemini AI fatura havuzunu taradı ve tespit ettiği eşdeğer yazımları tek standart başlıkta birleştirdi:
                </p>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {mergeResultsModal.mergedPairs.map((pair, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between text-slate-500 font-semibold">
                        <span>Faturadaki Orijinal Metin:</span>
                        <span className="text-[10px] bg-rose-100 text-rose-800 font-mono px-1.5 py-0.5 rounded">
                          Farklı Yazım
                        </span>
                      </div>
                      <div className="font-bold text-slate-800 font-mono bg-white p-1.5 rounded border border-slate-200">
                        "{pair.original || pair.source}"
                      </div>

                      <div className="flex items-center justify-center text-amber-600 font-black my-1">
                        <ArrowRight className="w-4 h-4" />
                        <span className="text-[10px] ml-1">Birleştirilen Standart İsim</span>
                      </div>

                      <div className="font-black text-indigo-950 font-mono bg-indigo-50 p-2 rounded border border-indigo-200 text-sm">
                        "{pair.canonical}"
                      </div>

                      {pair.reason && (
                        <p className="text-[10px] text-slate-600 italic mt-1">
                          💡 AI Açıklaması: {pair.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-600 space-y-1">
                <Info className="w-6 h-6 text-indigo-500 mx-auto mb-1" />
                <p className="font-bold text-slate-800">Tüm Malzeme İsimleri Zaten Güncel ve Standart!</p>
                <p>Şu anda havuzda birleştirilecek ek farklı yazım bulunamadı.</p>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setMergeResultsModal(null)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-colors cursor-pointer"
              >
                Kıyaslamayı İncele
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Merge Modal */}
      {showSuggestionsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Link2 className="w-4 h-4 text-emerald-600" />
                <span>Birleştirme Önerileri</span>
              </h2>
              <button onClick={() => setShowSuggestionsModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Aynı ölçülere ve benzer fatura satırına sahip olduğu halde ayrı görünen malzemeler. Öneriler otomatik uygulanmaz;
              "Birleştir" dediğiniz eşleşme kalıcı olur ve yeni OCR / Prizma faturalarında da geçerli olur.
            </p>

            {catalogStatus && !catalogStatus.persistent && (
              <div className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                ⚠️ Birleştirmeler şu an kalıcı depoya (Firestore) yazılamıyor; sunucu yeniden başlarsa kaybolur. Firestore kuralında
                <span className="font-mono"> material_aliases </span> izni eklenmeli.
              </div>
            )}

            <div className="overflow-y-auto flex-1 space-y-2">
              {isLoadingSuggestions && <p className="text-xs text-slate-500">Öneriler hesaplanıyor...</p>}
              {!isLoadingSuggestions && mergeSuggestions.length === 0 && (
                <p className="text-xs text-slate-500">Şu an birleştirilmesi önerilen malzeme yok.</p>
              )}
              {mergeSuggestions.map(s => {
                const key = suggestionKey(s);
                return (
                  <div key={key} className="border border-slate-200 rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-slate-800 break-words">{s.sourceName}</div>
                      <div className="text-slate-400">↓ birleşecek kayıt</div>
                      <div className="font-bold text-emerald-700 break-words">{s.targetName}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{s.reason}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={busySuggestionKey === key}
                        onClick={() => applyMergeSuggestion(s)}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg"
                      >
                        {busySuggestionKey === key ? 'Birleştiriliyor...' : 'Birleştir'}
                      </button>
                      <button
                        onClick={() => dismissMergeSuggestion(s)}
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg"
                      >
                        Farklı Ürün
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {catalogStatus && (
              <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-2">
                {catalogStatus.groups} malzeme • {catalogStatus.manualGroups} elle birleştirilmiş kayıt • {catalogStatus.aliases} kalıcı eşleşme
              </p>
            )}
          </div>
        </div>
      )}

      {showManualMergeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                <Link2 className="w-4 h-4 text-indigo-600" />
                <span>Manuel Malzeme Birleştirme</span>
              </h2>
              <button
                onClick={() => setShowManualMergeModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleManualMergeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  1. Değiştirilecek / Birleştirilecek Kaynak Malzeme (Silinecek başlık):
                </label>
                <select
                  value={manualSource}
                  onChange={e => setManualSource(e.target.value)}
                  required
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Malzeme seçiniz...</option>
                  {comparisons.map((c, cIdx) => (
                    <option key={`${c.id || c.materialName}_${c.unit}_${cIdx}`} value={c.materialName}>
                      {c.materialName} ({c.unit}) — {c.history.length} fatura kaydı
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  2. Hedef Ana Malzeme (Tüm kayıtlar bu isim altında toplanacak):
                </label>
                <select
                  value={manualTarget}
                  onChange={e => setManualTarget(e.target.value)}
                  required
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                >
                  <option value="">Hedef malzeme seçiniz...</option>
                  {comparisons
                    .filter(c => c.materialName !== manualSource)
                    .map((c, cIdx) => (
                      <option key={`${c.id || c.materialName}_${c.unit}_${cIdx}`} value={c.materialName}>
                        {c.materialName} ({c.unit})
                      </option>
                    ))}
                </select>
              </div>

              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-[11px] text-amber-900 flex items-start space-x-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  <strong>Not:</strong> Birleştirme sonrasında "
                  {manualSource || 'Kaynak Malzeme'}" adı geçen tüm faturalar "
                  {manualTarget || 'Hedef Malzeme'}" adı altında güncellenecek ve fiyat kıyaslama
                  grafikleri birleşecektir. Orijinal metinler korunur.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualMergeModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isMergingManual}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                >
                  {isMergingManual ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  <span>Birleştir ve Güncelle</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Edit Modal */}
      {categoryEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2 text-slate-900">
                <Tag className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-base">Malzeme Kategorisi Düzenle / Değiştir</h3>
              </div>
              <button
                type="button"
                onClick={() => setCategoryEditModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategoryChange} className="space-y-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">
                  Seçili Malzeme Adı
                </label>
                <p className="font-extrabold text-slate-900 text-sm">
                  {categoryEditModal.materialName}
                </p>
                <span className="text-xs text-slate-500 block mt-1">
                  Mevcut Kategori: <strong className="text-amber-700">{categoryEditModal.currentCategory}</strong>
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Hazır Kategorilerden Seçin:
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3 max-h-48 overflow-y-auto p-1 border border-slate-200 rounded-xl bg-slate-50">
                  {SYSTEM_CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setNewCategoryInput(cat)}
                      className={`text-left text-xs p-2 rounded-lg font-semibold transition-all border cursor-pointer ${
                        newCategoryInput === cat
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Veya Özel Kategori Yazın:
                </label>
                <input
                  type="text"
                  value={newCategoryInput}
                  onChange={e => setNewCategoryInput(e.target.value)}
                  placeholder="Örn: Kimyasallar & Boya"
                  className="w-full text-xs font-bold text-slate-900 bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-[11px] text-indigo-900 flex items-start space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <p>
                  <strong>Otomatik Eşleme:</strong> Bu kategori değişikliği, "
                  <strong>{categoryEditModal.materialName}</strong>" adındaki tüm geçmiş ve gelecek fatura kalemleri için otomatik uygulanacaktır.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCategoryEditModal(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSavingCategory || !newCategoryInput.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSavingCategory ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>Kategoriyi Kaydet ve Güncelle</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invoice Detail View Modal */}
      {selectedInvoiceForModal && (
        <InvoiceDetailModal
          invoice={selectedInvoiceForModal}
          jobsites={jobsites}
          supervisors={supervisors}
          onClose={() => setSelectedInvoiceForModal(null)}
          onUpdateInvoice={async (id, updateData) => {
            if (onUpdateInvoice) {
              await onUpdateInvoice(id, updateData);
            }
            setSelectedInvoiceForModal(prev => prev ? { ...prev, ...updateData } : null);
            if (onRefreshData) {
              await onRefreshData();
            }
          }}
          onDeleteInvoice={async (id) => {
            if (onDeleteInvoice) {
              await onDeleteInvoice(id);
            }
            setSelectedInvoiceForModal(null);
            if (onRefreshData) {
              await onRefreshData();
            }
          }}
        />
      )}

      {/* Construction Unit Conversion & Equivalence Lab Modal */}
      <UnitConversionLabModal
        isOpen={showUnitLabModal}
        onClose={() => setShowUnitLabModal(false)}
        initialMaterialName={labSelectedMaterial}
        initialUnit={labSelectedUnit}
      />

      {/* Retroactive Audit & Canonical Synchronization Modal */}
      {retroAuditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 my-8">
            <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white p-6 relative">
              <button
                type="button"
                onClick={() => setRetroAuditModal(null)}
                className="absolute top-5 right-5 text-slate-300 hover:text-white p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-white/15 rounded-2xl border border-white/20">
                  <CheckCircle2 className="w-6 h-6 text-emerald-300" />
                </div>
                <div>
                  <h3 className="text-xl font-black">
                    Geçmiş Faturalar Denetlendi & Birimler Eşitlendi
                  </h3>
                  <p className="text-xs text-blue-200 mt-0.5">
                    Köşebent Demir, Çelik Hasır, Kutu Profil ve tüm yapı malzemeleri kanonik standart kimliğe bağlandı.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">İncelenen Fatura</p>
                  <p className="text-xl font-black text-slate-900 font-mono mt-0.5">
                    {retroAuditModal.totalInvoicesAudited}
                  </p>
                </div>
                <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">İncelenen Kalem</p>
                  <p className="text-xl font-black text-slate-900 font-mono mt-0.5">
                    {retroAuditModal.totalItemsAudited}
                  </p>
                </div>
                <div className="bg-blue-50 p-3.5 rounded-2xl border border-blue-200 text-center">
                  <p className="text-[10px] font-bold text-blue-700 uppercase">Eşitlenen Kalem</p>
                  <p className="text-xl font-black text-blue-800 font-mono mt-0.5">
                    {retroAuditModal.itemsUpdated}
                  </p>
                </div>
                <div className="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-200 text-center">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase">Güncellenen Fatura</p>
                  <p className="text-xl font-black text-emerald-800 font-mono mt-0.5">
                    {retroAuditModal.invoicesUpdated}
                  </p>
                </div>
              </div>

              {/* VAT & Freight Sanitization Summary */}
              {retroAuditModal.vatAndFreightSanitization && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2">
                  <div className="text-xs font-black text-emerald-950 uppercase tracking-wider flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>KDV (НДС %20/%22) & Nakliye (Доставка) Ayrıştırma Sonucu</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                      <p className="text-[10px] font-bold text-slate-500">Onarılan Fatura</p>
                      <p className="text-base font-black font-mono tabular-nums text-emerald-800">
                        {retroAuditModal.vatAndFreightSanitization.invoicesSanitized || 0}
                      </p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                      <p className="text-[10px] font-bold text-slate-500">Net'e Çevrilen Kalem</p>
                      <p className="text-base font-black font-mono tabular-nums text-emerald-800">
                        {retroAuditModal.vatAndFreightSanitization.vatCorrectedItems || 0}
                      </p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                      <p className="text-[10px] font-bold text-slate-500">Nakliye Ayrıştırılan</p>
                      <p className="text-base font-black font-mono tabular-nums text-indigo-800">
                        {retroAuditModal.vatAndFreightSanitization.freightIsolatedInvoices || 0}
                      </p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-emerald-200">
                      <p className="text-[10px] font-bold text-slate-500">Normalize Kalem</p>
                      <p className="text-base font-black font-mono tabular-nums text-slate-800">
                        {retroAuditModal.vatAndFreightSanitization.itemsNormalized || 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Trade Breakdown */}
              {retroAuditModal.auditSummary && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <Scale className="w-4 h-4 text-indigo-600" />
                    <span>Malzeme & Çoklu Birim Düzeltme Dökümü</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-amber-950">📐 Köşebent L-Demir</p>
                        <p className="text-[10px] text-amber-700 font-medium">Metre / Adet / Ton</p>
                      </div>
                      <span className="text-sm font-black font-mono text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.angleSteelUpdated || 0}
                      </span>
                    </div>

                    <div className="p-3 bg-indigo-50/80 border border-indigo-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-indigo-950">🕸️ Çelik Hasır & File</p>
                        <p className="text-[10px] text-indigo-700 font-medium">m² / Kart / Rulo / Ton</p>
                      </div>
                      <span className="text-sm font-black font-mono text-indigo-900 bg-indigo-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.meshUpdated || 0}
                      </span>
                    </div>

                    <div className="p-3 bg-cyan-50/80 border border-cyan-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-cyan-950">📦 Kutu Profil & Boru</p>
                        <p className="text-[10px] text-cyan-700 font-medium">Metre / Ton / Boy</p>
                      </div>
                      <span className="text-sm font-black font-mono text-cyan-900 bg-cyan-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.profilePipeUpdated || 0}
                      </span>
                    </div>

                    <div className="p-3 bg-purple-50/80 border border-purple-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-purple-950">🏗️ İnşaat Demiri</p>
                        <p className="text-[10px] text-purple-700 font-medium">Ton / Metre / Kg</p>
                      </div>
                      <span className="text-sm font-black font-mono text-purple-900 bg-purple-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.rebarUpdated || 0}
                      </span>
                    </div>

                    <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-emerald-950">🛡️ Yalıtım & Membran</p>
                        <p className="text-[10px] text-emerald-700 font-medium">Rulo / m²</p>
                      </div>
                      <span className="text-sm font-black font-mono text-emerald-900 bg-emerald-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.membraneUpdated || 0}
                      </span>
                    </div>

                    <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold text-rose-950">🧱 Gazbeton & Duvar</p>
                        <p className="text-[10px] text-rose-700 font-medium">m³ / Adet Blok</p>
                      </div>
                      <span className="text-sm font-black font-mono text-rose-900 bg-rose-200/70 px-2 py-0.5 rounded-lg">
                        {retroAuditModal.auditSummary.blocksUpdated || 0}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sample Updated Items */}
              {retroAuditModal.details && retroAuditModal.details.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <span>Standartlaştırılan Örnek Kalemler</span>
                  </h4>
                  <div className="border border-slate-200 rounded-2xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-100 text-slate-600 text-[10px] font-black uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Fatura</th>
                          <th className="py-2.5 px-3">Eski Ham İsim</th>
                          <th className="py-2.5 px-3">Standart Kanonik İsim</th>
                          <th className="py-2.5 px-3">Birim</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {retroAuditModal.details.map((d: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 text-slate-400 font-mono text-[10px]">
                              {d.invoiceNumber}
                            </td>
                            <td className="py-2 px-3 text-slate-500 line-through text-[11px]">
                              {d.rawName}
                            </td>
                            <td className="py-2 px-3 text-indigo-950 font-bold text-[11px]">
                              {d.canonicalName}
                            </td>
                            <td className="py-2 px-3 text-slate-600 font-mono text-[10px]">
                              {d.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setRetroAuditModal(null)}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                Anladım & Kıyaslama Tablosuna Dön
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
