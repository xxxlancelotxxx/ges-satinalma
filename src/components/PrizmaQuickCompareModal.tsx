import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  TrendingDown,
  TrendingUp,
  FileText,
  ExternalLink,
  Download,
  Building2,
  Package,
  Calendar,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Info,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  Sparkles,
  Filter,
  CheckCircle2,
  ArrowUpRight
} from 'lucide-react';
import { formatRuble } from '../utils/format';
import { getPrizmaBtfUrl, getPrizmaStfUrl } from '../utils/prizmaUrlHelper';
import { PrizmaInvoice } from './PrizmaInvoicesView';
import { extractRebarDiameter } from '../utils/constructionUnitConverter';

interface Props {
  invoice: PrizmaInvoice;
  onClose: () => void;
  onNavigateToCompare?: (materialName: string) => void;
}

export interface HistoryRecord {
  date: string;
  jobsiteId?: string;
  jobsiteName: string;
  supplier: string;
  unitPrice: number;
  quantity: number;
  unit: string;
  originalUnitPrice?: number;
  originalQuantity?: number;
  originalUnit?: string;
  normalizedUnitPrice?: number;
  normalizedQuantity?: number;
  normalizedUnit?: string;
  conversionApplied?: boolean;
  conversionFormula?: string;
  conversionFactor?: number;
  invoiceNumber: string;
  originalName?: string;
  invoiceId?: string;
  rawFileName?: string;
  fileUrl?: string;
  prizmaSource?: boolean;
  prizmaRequestCode?: string;
  prizmaOrderCode?: string;
  prizmaBtfUrl?: string;
  prizmaStfUrl?: string;
  prizmaUrl?: string;
}

export interface BenchmarkItem {
  id: string;
  materialName: string;
  category: string;
  unit: string;
  standardUnit: string;
  hasMultipleUnits?: boolean;
  detectedUnits?: string[];
  minUnitPrice: number;
  maxUnitPrice: number;
  avgUnitPrice: number;
  cheapestJobsiteName?: string;
  priciestJobsiteName?: string;
  totalQuantityPurchased?: number;
  totalSpend?: number;
  priceDifferencePercentage?: number;
  history: HistoryRecord[];
}

// Rebar diameter extractor (supports Ø12, ф12, d12, q12, 12mm, Арматура 8, etc.)
function extractRebarDia(str: string): number | null {
  return extractRebarDiameter(str);
}

// Clean and normalize text (handles Cyrillic / Latin lookalikes)
function normalizeText(str: string): string {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[aа]/g, 'a')
    .replace(/[cс]/g, 'c')
    .replace(/[eе]/g, 'e')
    .replace(/[oо]/g, 'o')
    .replace(/[pр]/g, 'p')
    .replace(/[xх]/g, 'x')
    .replace(/[^a-z0-9ğüşıöçа-я]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findMatchingBenchmark(item: any, invoice: PrizmaInvoice, benchmarks: BenchmarkItem[]): BenchmarkItem | undefined {
  if (!item || !benchmarks.length) return undefined;
  
  const rawItemName = (item.materialName || '').trim();
  const rawOrigName = (item.originalName || '').trim();
  const itemUnitPrice = Number(item.unitPrice) || 0;
  const itemQuantity = Number(item.quantity) || 0;

  // 1. Direct Invoice History Match (100% Deterministic & Guaranteed):
  // If this invoice and item were processed into a benchmark's history by the server, match it directly!
  const itemDia = extractRebarDiameter(`${rawItemName} ${rawOrigName}`);
  const historyMatch = benchmarks.find(b =>
    b.history?.some(h => {
      const isSameInv = h.invoiceId === invoice.id || (h.invoiceNumber && invoice.invoiceNumber && h.invoiceNumber.trim().toLowerCase() === invoice.invoiceNumber.trim().toLowerCase());
      if (!isSameInv) return false;

      // Exact original name match
      if (h.originalName && (h.originalName.trim().toLowerCase() === rawOrigName.toLowerCase() || h.originalName.trim().toLowerCase() === rawItemName.toLowerCase())) {
        return true;
      }

      // If rebar, diameter MUST strictly match
      if (itemDia) {
        const hDia = extractRebarDiameter(`${h.originalName || ''} ${b.materialName}`);
        if (hDia && hDia !== itemDia) return false;
      }

      // Price match with quantity or spec confirmation
      const isPriceMatch = Math.abs((h.originalUnitPrice || h.unitPrice) - itemUnitPrice) < 0.05;
      const isQtyMatch = (h.quantity === itemQuantity || h.originalQuantity === itemQuantity);
      return isPriceMatch && isQtyMatch;
    })
  );
  if (historyMatch) return historyMatch;

  // 2. Exact name or benchmark ID match
  const cleanName = rawItemName.toLowerCase().trim();
  const exactMatch = benchmarks.find(b => 
    b.materialName.toLowerCase().trim() === cleanName || 
    b.id.toLowerCase().trim() === cleanName
  );
  if (exactMatch) return exactMatch;

  const combined = `${rawItemName} ${rawOrigName}`.toLowerCase();

  // 3. Specification-Aware Intelligent Matching:
  // A. Rebar / İnşaat Demiri: MUST match the exact diameter! (e.g. Ø8 only matches Ø8, Ø12 only matches Ø12)
  if (/арматур|donatı|demir|a500|а500|пруток/i.test(combined)) {
    const dia = extractRebarDiameter(combined);
    if (dia) {
      const rebarMatch = benchmarks.find(b => {
        const isRebarCat = b.category === 'İnşaat Demiri' || /demir|арматур/i.test(b.materialName);
        if (!isRebarCat) return false;
        const bDia = extractRebarDiameter(b.materialName);
        return bDia === dia || b.materialName.includes(`Ø${dia}`) || b.id.includes(`ø${dia}`);
      });
      if (rebarMatch) return rebarMatch;
    }
  }

  // B. Akaryakıt / Mazot / Dizel: MUST only match diesel fuel, never tanks/pumps/generators/filters!
  if (/^mazot$|^dizel\s*yakıt|^дизельное\s*топливо/i.test(combined.trim()) || (/mazot|dizel\s*yakıt|дизельн.*топлив/i.test(combined) && !/jenerat|tank|filtre|kompresor|pompa/i.test(combined))) {
    const fuelMatch = benchmarks.find(b => 
      (b.materialName === 'MAZOT' || b.materialName.includes('Dizel Yakıt') || b.category === 'Akaryakıt & Enerji') &&
      !/jenerat|tank|filtre|kompresor|pompa/i.test(b.materialName)
    );
    if (fuelMatch) return fuelMatch;
  }

  // C. Plywood / Kontrplak: MUST match thickness (e.g. 18mm, 21mm, 15mm)
  if (/фанер|plywood|kontrplak/i.test(combined)) {
    const thickMatch = combined.match(/(?:12|15|18|21)\s*(?:мм|mm)?/);
    if (thickMatch) {
      const th = thickMatch[0].replace(/\D/g, '');
      const plyMatch = benchmarks.find(b => 
        b.category === 'Kalıp & İskele Sistemleri' && 
        /plywood|kontrplak/i.test(b.materialName) && 
        b.materialName.includes(`${th}mm`)
      );
      if (plyMatch) return plyMatch;
    }
  }

  // D. Kereste / Timber: MUST match timber dimension (50x100, 100x100, etc.)
  if (/брус|доска|kereste|tahta/i.test(combined)) {
    const dimMatch = combined.match(/(\d+)\s*[*xх]\s*(\d+)/i);
    if (dimMatch) {
      const [_, d1, d2] = dimMatch;
      const timberMatch = benchmarks.find(b =>
        b.category === 'Kalıp & İskele Sistemleri' &&
        /kereste|tahta/i.test(b.materialName) &&
        (b.materialName.includes(`${d1}x${d2}`) || b.materialName.includes(`${d1}*${d2}`))
      );
      if (timberMatch) return timberMatch;
    }
  }

  // E. Normalized text high-similarity match (requires >= 75% token overlap within same category)
  const normItem = normalizeText(combined);
  const itemTokens = normItem.split(' ').filter(t => t.length >= 3);
  if (itemTokens.length >= 2) {
    let bestCandidate: BenchmarkItem | null = null;
    let highestScore = 0;

    for (const b of benchmarks) {
      if (item.category && b.category && item.category !== 'MALZEME' && item.category !== 'Diğer Malzeme' && b.category !== item.category) {
        continue;
      }
      const bTokens = normalizeText(b.materialName).split(' ').filter(t => t.length >= 3);
      if (bTokens.length < 2) continue;

      const common = itemTokens.filter(t => bTokens.some(bt => bt === t || (bt.length > 4 && t.length > 4 && (bt.includes(t) || t.includes(bt)))));
      const score = (common.length * 2) / (itemTokens.length + bTokens.length);
      if (score > highestScore && score >= 0.75) {
        highestScore = score;
        bestCandidate = b;
      }
    }
    if (bestCandidate) return bestCandidate;
  }

  return undefined;
}

export const PrizmaQuickCompareModal: React.FC<Props> = ({ invoice, onClose, onNavigateToCompare }) => {
  const [benchmarks, setBenchmarks] = useState<BenchmarkItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [onlyWithHistory, setOnlyWithHistory] = useState<boolean>(false);
  const [globalSearchKeyword, setGlobalSearchKeyword] = useState<string>('');

  const loadBenchmarks = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/materials/compare?_t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setBenchmarks(data);
        }
      }
    } catch (err) {
      console.warn('Benchmark fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBenchmarks();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadBenchmarks();
  };

  // Helper to resolve an invoice PDF link
  const getInvoicePdfUrl = (rec: HistoryRecord): string => {
    if (rec.fileUrl && !rec.fileUrl.startsWith('data:')) {
      return rec.fileUrl;
    }
    if (rec.prizmaSource || (rec.invoiceId && rec.invoiceId.startsWith('prizma_'))) {
      const demandId = rec.invoiceId ? rec.invoiceId.replace('prizma_', '') : null;
      if (demandId) {
        return `/api/prizma/invoice-file/${demandId}?type=schet`;
      }
    }
    if (rec.invoiceNumber) {
      return `/api/files/Fatura_${encodeURIComponent(rec.invoiceNumber)}.pdf`;
    }
    return `/api/files/${encodeURIComponent(rec.rawFileName || 'fatura.pdf')}`;
  };

  // Check if a record is from the current invoice
  const isCurrentInvoiceRecord = (h: HistoryRecord): boolean => {
    if (h.invoiceNumber && invoice.invoiceNumber && h.invoiceNumber.trim().toLowerCase() === invoice.invoiceNumber.trim().toLowerCase()) return true;
    if (h.invoiceId && invoice.id && h.invoiceId === invoice.id) return true;
    if (h.prizmaRequestCode && invoice.prizmaRequestCode && h.prizmaRequestCode.toLowerCase() === invoice.prizmaRequestCode.toLowerCase()) return true;
    return false;
  };

  // Compute comparison stats for each item in the invoice
  const comparedItems = useMemo(() => {
    return (invoice.items || []).map((item, index) => {
      const currentPrice = Number(item.unitPrice) || 0;
      const matched = findMatchingBenchmark(item, invoice, benchmarks);

      // Direct authentic history from this matched benchmark (excluding the current invoice)
      const rawDirectHistory = matched?.history || [];
      const directOtherHistory = rawDirectHistory.filter(h => !isCurrentInvoiceRecord(h));

      // Strict discipline: Only show authentic past purchases of this exact material.
      // Unrelated items from the general category are NOT mixed into the price comparison!
      const activeHistory = directOtherHistory;
      const hasOtherRecords = activeHistory.length > 0;
      const otherInvoicesCount = activeHistory.length;
      const uniqueJobsites = Array.from(new Set(activeHistory.map(h => h.jobsiteName).filter(Boolean)));

      let minPrice = currentPrice;
      let avgPrice = currentPrice;
      let maxPrice = currentPrice;
      let cheapestRecord: HistoryRecord | null = null;
      let priciestRecord: HistoryRecord | null = null;
      let comparisonDiffPct = 0;
      let isCheaperThanAvg = false;

      if (hasOtherRecords) {
        const prices = activeHistory.map(h => Number(h.unitPrice) || 0).filter(p => p > 0);
        if (prices.length > 0) {
          minPrice = Math.min(...prices);
          maxPrice = Math.max(...prices);
          avgPrice = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
          
          cheapestRecord = activeHistory.find(h => Number(h.unitPrice) === minPrice) || activeHistory[0];
          priciestRecord = activeHistory.find(h => Number(h.unitPrice) === maxPrice) || activeHistory[0];

          if (avgPrice > 0 && currentPrice > 0) {
            comparisonDiffPct = Math.round(((currentPrice - avgPrice) / avgPrice) * 1000) / 10;
            isCheaperThanAvg = currentPrice <= avgPrice;
          }
        }
      }

      const totalItemSavings = hasOtherRecords && avgPrice > currentPrice
        ? Math.round((avgPrice - currentPrice) * (Number(item.quantity) || 1))
        : 0;

      return {
        ...item,
        uniqueKey: item.id || `item_${index}`,
        currentPrice,
        minPrice,
        avgPrice,
        maxPrice,
        comparisonDiffPct,
        isCheaperThanAvg,
        hasOtherRecords,
        isRelatedFallback: false,
        otherInvoicesCount,
        uniqueJobsites,
        cheapestRecord,
        priciestRecord,
        priceHistory: activeHistory,
        directPriceHistory: directOtherHistory,
        relatedPriceHistory: [],
        matchedBenchmarkName: matched?.materialName,
        totalItemSavings
      };
    });
  }, [invoice, benchmarks]);



  // Auto-expand first item on load so history is immediately visible
  useEffect(() => {
    if (comparedItems.length > 0 && expandedMaterial === null) {
      setExpandedMaterial(comparedItems[0].uniqueKey);
    }
  }, [comparedItems, expandedMaterial]);

  // Filter items by user search or history toggle
  const filteredComparedItems = useMemo(() => {
    return comparedItems.filter(item => {
      if (onlyWithHistory && !item.hasOtherRecords) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase().trim();
      return (
        item.materialName.toLowerCase().includes(q) ||
        (item.materialCode && item.materialCode.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        item.uniqueJobsites.some(j => j.toLowerCase().includes(q))
      );
    });
  }, [comparedItems, searchTerm, onlyWithHistory]);

  // Global search across all benchmark items
  const globalSearchResults = useMemo(() => {
    if (!globalSearchKeyword.trim() || globalSearchKeyword.trim().length < 2) return [];
    const q = globalSearchKeyword.toLowerCase().trim();
    return benchmarks.filter(b =>
      b.materialName.toLowerCase().includes(q) ||
      (b.category && b.category.toLowerCase().includes(q))
    ).slice(0, 15);
  }, [benchmarks, globalSearchKeyword]);

  // Overall invoice analysis metrics
  const overallStats = useMemo(() => {
    let totalPotentialSavings = 0;
    let itemsCheaperCount = 0;
    let itemsExpensiveCount = 0;
    let itemsUniqueCount = 0;
    let totalOtherPurchasesScanned = 0;

    comparedItems.forEach(ci => {
      totalOtherPurchasesScanned += ci.otherInvoicesCount;
      if (!ci.hasOtherRecords) {
        itemsUniqueCount++;
      } else if (ci.currentPrice < ci.avgPrice) {
        itemsCheaperCount++;
        totalPotentialSavings += ci.totalItemSavings;
      } else if (ci.currentPrice > ci.avgPrice) {
        itemsExpensiveCount++;
      }
    });

    return {
      totalPotentialSavings,
      itemsCheaperCount,
      itemsExpensiveCount,
      itemsUniqueCount,
      totalItemsCount: comparedItems.length,
      totalOtherPurchasesScanned
    };
  }, [comparedItems]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl max-w-6xl w-full max-h-[94vh] flex flex-col overflow-hidden text-slate-100">
        
        {/* Modal Header */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-md">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-blue-400 text-sm">П</span>
                <h2 className="text-base sm:text-lg font-black text-white">
                  Prizma Malzeme & Şantiye Bazlı Piyasa Kıyaslama Kartı
                </h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {invoice.invoiceNumber}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-600/40">
                  {invoice.prizmaRequestCode}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Şantiye: <strong className="text-slate-200">{invoice.jobsiteName}</strong> | Tedarikçi: <strong className="text-slate-200">{invoice.supplier}</strong> (Tarih: {invoice.date})
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 transition-all cursor-pointer"
              title="Piyasa Alım Verilerini Yeniden Senkronize Et"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 transition-all cursor-pointer"
              title="Kapat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Invoice Top Summary KPI Bar */}
        <div className="bg-slate-950/60 px-6 py-3 border-b border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fatura Toplamı</span>
            <span className="text-sm sm:text-base font-black text-emerald-400">
              {formatRuble(invoice.totalAmount)}
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Taranan Geçmiş Alım</span>
            <span className="text-xs sm:text-sm font-bold text-indigo-300 block truncate">
              {overallStats.totalOtherPurchasesScanned} Geçmiş Fatura Kaydı
            </span>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Piyasa Analiz Durumu</span>
            <div className="flex items-center space-x-1.5 mt-0.5">
              {overallStats.itemsCheaperCount > 0 && (
                <span className="text-xs font-bold text-emerald-400 flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                  {overallStats.itemsCheaperCount} Kalem Avantajlı
                </span>
              )}
              {overallStats.itemsExpensiveCount > 0 && (
                <span className="text-xs font-bold text-rose-400 flex items-center">
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                  {overallStats.itemsExpensiveCount} Kalem Yüksek
                </span>
              )}
              {overallStats.itemsCheaperCount === 0 && overallStats.itemsExpensiveCount === 0 && (
                <span className="text-xs font-bold text-blue-400">İlk Referans</span>
              )}
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tespit Edilen Tasarruf</span>
            <span className="text-sm sm:text-base font-black text-emerald-400">
              {overallStats.totalPotentialSavings > 0 ? `+${formatRuble(overallStats.totalPotentialSavings)}` : '0,00 ₽'}
            </span>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {/* Search & Filter Header inside modal */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-2xl border border-slate-800">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Faturadaki malzemeler veya şantiye adına göre ara..."
                className="w-full pl-9 pr-4 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              <label className="flex items-center space-x-1.5 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyWithHistory}
                  onChange={e => setOnlyWithHistory(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-500/30"
                />
                <span>Yalnızca Geçmiş Alımı Olanlar</span>
              </label>

              {loading && (
                <div className="flex items-center space-x-1.5 text-xs text-indigo-400 animate-pulse font-medium">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span>Senkronize ediliyor...</span>
                </div>
              )}
            </div>
          </div>

          {/* Comparison Table */}
          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-bold uppercase text-[10px]">
                    <th className="py-3 px-3.5">Malzeme Adı & Kod</th>
                    <th className="py-3 px-3 text-right">Miktar & Birim</th>
                    <th className="py-3 px-3 text-right text-white">Bu Fatura Fiyatı</th>
                    <th className="py-3 px-3 text-right text-emerald-400">Piyasa En Düşük</th>
                    <th className="py-3 px-3 text-right text-blue-400">Piyasa Ortalama</th>
                    <th className="py-3 px-3 text-right text-rose-400">Piyasa En Yüksek</th>
                    <th className="py-3 px-3.5 text-center">Piyasa Durumu & Geçmiş Alımlar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredComparedItems.map((item, index) => {
                    const isExpanded = expandedMaterial === item.uniqueKey;
                    return (
                      <React.Fragment key={item.uniqueKey || index}>
                        <tr 
                          onClick={() => setExpandedMaterial(isExpanded ? null : item.uniqueKey)}
                          className={`hover:bg-slate-850/60 transition-colors cursor-pointer ${isExpanded ? 'bg-indigo-950/20' : ''}`}
                        >
                          {/* Malzeme Adı */}
                          <td className="py-3 px-3.5">
                            <div className="flex items-center space-x-2">
                              <span className="p-1 rounded-md bg-slate-800 text-slate-400">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </span>
                              <div>
                                <div className="font-bold text-slate-100 max-w-xs sm:max-w-md truncate" title={item.materialName}>
                                  {item.materialName}
                                </div>
                                {item.originalName && item.originalName !== item.materialName && (
                                  <div className="text-[11px] text-amber-300/90 font-mono mt-0.5 max-w-xs sm:max-w-md truncate" title={item.originalName}>
                                    <span className="text-[9px] text-slate-500 font-sans font-bold uppercase mr-1">RU:</span>
                                    <span className="italic">{item.originalName}</span>
                                  </div>
                                )}
                                <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                                  {item.materialCode && <span>Kod: {item.materialCode}</span>}
                                  {item.category && <span className="text-slate-500">| {item.category}</span>}
                                  {item.hasOtherRecords ? (
                                    <span className="text-indigo-400 font-semibold">
                                      • {item.otherInvoicesCount} geçmiş alım ({item.uniqueJobsites.length} şantiye)
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">• İlk sistem kaydı (Tekil Alım)</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Miktar */}
                          <td className="py-3 px-3 text-right font-medium text-slate-300">
                            {item.quantity} {item.unit}
                          </td>

                          {/* Bu Faturadaki Birim Fiyat */}
                          <td className="py-3 px-3 text-right font-black text-white text-xs sm:text-sm">
                            {formatRuble(item.currentPrice)}
                          </td>

                          {/* Piyasa En Düşük */}
                          <td className="py-3 px-3 text-right font-bold text-emerald-400">
                            {item.hasOtherRecords ? (
                              <div>
                                <div>{formatRuble(item.minPrice)}</div>
                                {item.cheapestRecord && (
                                  <div className="text-[10px] text-emerald-500/80 truncate max-w-[120px] font-normal" title={item.cheapestRecord.jobsiteName}>
                                    {item.cheapestRecord.jobsiteName}
                                  </div>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* Piyasa Ortalama */}
                          <td className="py-3 px-3 text-right font-bold text-blue-400">
                            {item.hasOtherRecords ? formatRuble(item.avgPrice) : '-'}
                          </td>

                          {/* Piyasa En Yüksek */}
                          <td className="py-3 px-3 text-right font-bold text-rose-400">
                            {item.hasOtherRecords ? (
                              <div>
                                <div>{formatRuble(item.maxPrice)}</div>
                                {item.priciestRecord && (
                                  <div className="text-[10px] text-rose-400/80 truncate max-w-[120px] font-normal" title={item.priciestRecord.jobsiteName}>
                                    {item.priciestRecord.jobsiteName}
                                  </div>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* Fark ve Durum Rozeti */}
                          <td className="py-3 px-3.5 text-center">
                            <div className="flex items-center justify-center space-x-2">
                              {!item.hasOtherRecords ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-900/40 text-blue-300 border border-blue-500/30">
                                  İlk Kayıt / Referans
                                </span>
                              ) : item.currentPrice < item.avgPrice ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-950/70 text-emerald-300 border border-emerald-500/40">
                                  <TrendingDown className="w-3 h-3 mr-1" />
                                  %{Math.abs(item.comparisonDiffPct)} Uygun (Tasarruflu)
                                </span>
                              ) : item.currentPrice > item.avgPrice ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-950/70 text-rose-300 border border-rose-500/40">
                                  <TrendingUp className="w-3 h-3 mr-1" />
                                  %{Math.abs(item.comparisonDiffPct)} Yüksek
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                                  Piyasa Seviyesinde
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedMaterial(isExpanded ? null : item.uniqueKey);
                                }}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-bold transition-all border border-slate-700"
                              >
                                {isExpanded ? 'Gizle' : `Şantiyeleri Gör (${item.otherInvoicesCount})`}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* DETAYLI ŞANTİYE BAZLI GEÇMİŞ ALIM VE FATURA AÇMA ÇEKMECESİ */}
                        {isExpanded && (
                          <tr className="bg-slate-950/90 border-b border-slate-800">
                            <td colSpan={7} className="p-4 sm:p-6 space-y-4">
                              {/* Header & Comparison summary cards for this material */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                                <div>
                                  <div className="text-sm font-black text-white flex items-center space-x-2">
                                    <span className="text-indigo-400">❖</span>
                                    <span>{item.materialName}</span>
                                    <span className="text-xs font-normal text-slate-400">için Şantiye Bazlı Gerçekleşen Alım Fiyatları</span>
                                  </div>
                                  <p className="text-xs text-slate-400 mt-0.5">
                                    {item.hasOtherRecords ? (
                                      'Bu malzemenin diğer şantiyelerdeki geçmiş alımları, tedarikçi ve fatura detaylarıyla aşağıda listelenmiştir. İstediğiniz faturayı doğrudan inceleyebilirsiniz.'
                                    ) : (
                                      'Bu malzeme kalemi için sistemde henüz başka bir şantiye alımı bulunmamaktadır (İlk / Tekil Alım).'
                                    )}
                                  </p>
                                </div>

                                <div className="flex items-center space-x-2">
                                  {onNavigateToCompare && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onClose();
                                        onNavigateToCompare(item.materialName);
                                      }}
                                      className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-indigo-500/40 flex items-center space-x-1"
                                      title="Bu malzemeyi tüm şantiyeler ve indirimlerle genel Piyasa Kıyaslama sekmesinde aç"
                                    >
                                      <span>Piyasa Kıyaslama Sekmesinde Aç</span>
                                      <ArrowUpRight className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <div className="text-xs text-slate-400">
                                    Toplam <strong>{item.otherInvoicesCount}</strong> fatura kaydı
                                  </div>
                                </div>
                              </div>

                              {/* Highlight cards: En Ucuz Şantiye vs En Yüksek Şantiye */}
                              {item.hasOtherRecords && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {/* En Ucuz Alan Şantiye */}
                                  <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-2xl">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                                      <span className="flex items-center space-x-1">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        <span>En Uygun Alan Şantiye</span>
                                      </span>
                                      <span className="font-mono text-emerald-300 font-black">{formatRuble(item.minPrice)}</span>
                                    </div>
                                    <div className="mt-1 text-xs font-bold text-slate-200">
                                      {item.cheapestRecord?.jobsiteName || 'Belirtilmemiş'}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5 flex justify-between">
                                      <span className="truncate max-w-[140px]">{item.cheapestRecord?.supplier || '-'}</span>
                                      <span>{item.cheapestRecord?.date || '-'}</span>
                                    </div>
                                  </div>

                                  {/* Sistem / Piyasa Ortalaması */}
                                  <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-2xl">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-blue-400">
                                      <span className="flex items-center space-x-1">
                                        <Info className="w-3.5 h-3.5" />
                                        <span>Piyasa / Sistem Ortalaması</span>
                                      </span>
                                      <span className="font-mono text-blue-300 font-black">{formatRuble(item.avgPrice)}</span>
                                    </div>
                                    <div className="mt-1 text-xs font-bold text-slate-200">
                                      {item.uniqueJobsites.length} Farklı Şantiye Ortalaması
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                      Bu fatura ortalamaya göre: <strong className={item.currentPrice <= item.avgPrice ? 'text-emerald-400' : 'text-rose-400'}>
                                        {item.comparisonDiffPct > 0 ? `+${item.comparisonDiffPct}% Yüksek` : `${item.comparisonDiffPct}% Uygun`}
                                      </strong>
                                    </div>
                                  </div>

                                  {/* En Yüksek Alan Şantiye */}
                                  <div className="p-3 bg-rose-950/30 border border-rose-500/30 rounded-2xl">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-rose-400">
                                      <span className="flex items-center space-x-1">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        <span>En Yüksek Alan Şantiye</span>
                                      </span>
                                      <span className="font-mono text-rose-300 font-black">{formatRuble(item.maxPrice)}</span>
                                    </div>
                                    <div className="mt-1 text-xs font-bold text-slate-200">
                                      {item.priciestRecord?.jobsiteName || 'Belirtilmemiş'}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5 flex justify-between">
                                      <span className="truncate max-w-[140px]">{item.priciestRecord?.supplier || '-'}</span>
                                      <span>{item.priciestRecord?.date || '-'}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Detailed Table of Historical Purchases */}
                              {item.hasOtherRecords ? (
                                <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 shadow-inner">
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                      <thead>
                                        <tr className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 text-[10px] uppercase">
                                          <th className="py-2.5 px-3">#</th>
                                          <th className="py-2.5 px-3">Şantiye</th>
                                          <th className="py-2.5 px-3">Malzeme / Kalem Adı</th>
                                          <th className="py-2.5 px-3">Tedarikçi</th>
                                          <th className="py-2.5 px-3">Tarih</th>
                                          <th className="py-2.5 px-3 text-right">Miktar & Birim</th>
                                          <th className="py-2.5 px-3 text-right">Birim Fiyat</th>
                                          <th className="py-2.5 px-3 text-center">Bu Faturaya Göre Fark</th>
                                          <th className="py-2.5 px-3">Fatura No</th>
                                          <th className="py-2.5 px-3 text-center">Faturayı Aç</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800/60">
                                        {item.priceHistory.map((hist, hIdx) => {
                                          const histPrice = Number(hist.unitPrice) || 0;
                                          const diffFromInvoice = item.currentPrice > 0 && histPrice > 0
                                            ? Math.round(((histPrice - item.currentPrice) / item.currentPrice) * 1000) / 10
                                            : 0;
                                          const pdfUrl = getInvoicePdfUrl(hist);

                                          return (
                                            <tr key={hIdx} className="hover:bg-slate-800/50 transition-colors">
                                              <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{hIdx + 1}</td>

                                              {/* Şantiye */}
                                              <td className="py-2.5 px-3">
                                                <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700">
                                                  {hist.jobsiteName || 'Genel Şantiye'}
                                                </span>
                                              </td>

                                              {/* Malzeme Adı */}
                                              <td className="py-2.5 px-3">
                                                <div className="font-medium text-slate-200 truncate max-w-[190px]" title={hist.originalName || hist.materialName || '-'}>
                                                  {hist.originalName || hist.materialName || item.materialName}
                                                </div>
                                              </td>

                                              {/* Tedarikçi */}
                                              <td className="py-2.5 px-3">
                                                <div className="font-medium text-slate-300 truncate max-w-[160px]" title={hist.supplier}>
                                                  {hist.supplier}
                                                </div>
                                              </td>

                                              {/* Tarih */}
                                              <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                                                {hist.date ? hist.date.split('T')[0] : '-'}
                                              </td>

                                              {/* Miktar */}
                                              <td className="py-2.5 px-3 text-right font-medium text-slate-300">
                                                {hist.quantity} {hist.unit}
                                              </td>

                                              {/* Birim Fiyat */}
                                              <td className="py-2.5 px-3 text-right font-black text-amber-300 font-mono text-sm">
                                                {formatRuble(histPrice)}
                                              </td>

                                              {/* Bu Faturaya Göre Fark */}
                                              <td className="py-2.5 px-3 text-center">
                                                {histPrice < item.currentPrice ? (
                                                  <span className="inline-flex items-center text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                                                    <TrendingDown className="w-3 h-3 mr-0.5" />
                                                    %{Math.abs(diffFromInvoice)} Daha Ucuz
                                                  </span>
                                                ) : histPrice > item.currentPrice ? (
                                                  <span className="inline-flex items-center text-[10px] font-bold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-500/30">
                                                    <TrendingUp className="w-3 h-3 mr-0.5" />
                                                    +%{Math.abs(diffFromInvoice)} Daha Pahalı
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] text-slate-400">Aynı Fiyat</span>
                                                )}
                                              </td>

                                              {/* Fatura No / Prizma Kodu */}
                                              <td className="py-2.5 px-3">
                                                <div className="font-mono text-slate-200 font-bold truncate max-w-[130px]">
                                                  {hist.invoiceNumber || hist.prizmaRequestCode || '-'}
                                                </div>
                                                {hist.prizmaRequestCode && hist.invoiceNumber !== hist.prizmaRequestCode && (
                                                  <div className="text-[10px] text-blue-400 font-mono">
                                                    {hist.prizmaRequestCode}
                                                  </div>
                                                )}
                                              </td>

                                              {/* Faturayı Aç Butonları */}
                                              <td className="py-2.5 px-3 text-center">
                                                <div className="flex items-center justify-center space-x-1.5">
                                                  <a
                                                    href={pdfUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="px-2.5 py-1.5 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white rounded-xl text-[11px] font-bold transition-all border border-emerald-500/40 flex items-center space-x-1 shadow-xs"
                                                    title="Bu Şantiyedeki Orijinal Faturayı (PDF) Doğrudan Yeni Sekmede Aç"
                                                  >
                                                    <FileText className="w-3.5 h-3.5 text-emerald-300" />
                                                    <span>Faturayı Aç</span>
                                                    <ExternalLink className="w-3 h-3 opacity-70" />
                                                  </a>

                                                  {(hist.prizmaBtfUrl || hist.prizmaUrl || (hist.invoiceId && String(hist.invoiceId).startsWith("prizma_"))) && (
                                                    <a
                                                      href={getPrizmaBtfUrl((hist as any).prizmaDemandId || (hist.invoiceId && String(hist.invoiceId).startsWith("prizma_") ? String(hist.invoiceId).replace("prizma_", "") : null), hist.prizmaBtfUrl || hist.prizmaUrl)}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="px-2 py-1.5 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-xl text-[11px] font-bold transition-all border border-blue-500/40 flex items-center space-x-1"
                                                      title="Prizma Sistemindeki Bu BTF Talebini Doğrudan Aç"
                                                    >
                                                      <span className="font-black text-blue-300 text-xs">П</span>
                                                      <span>BTF</span>
                                                      <ExternalLink className="w-2.5 h-2.5 opacity-70" />
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
                              ) : (
                                <div className="p-6 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 space-y-2">
                                  <Layers className="w-8 h-8 mx-auto text-slate-600" />
                                  <p className="text-sm font-semibold text-slate-300">
                                    Bu malzeme için sistemde daha önce başka şantiye faturası bulunamadı.
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    Bu alım, sistemdeki ilk referans fiyat olarak kaydedilmiştir. Aşağıdaki arama kutusunu kullanarak veritabanındaki diğer malzemelerle manuel kıyaslama yapabilirsiniz.
                                  </p>
                                </div>
                              )}

                              {/* Quick Search on Any Material in Database */}
                              <div className="pt-2 border-t border-slate-800/60">
                                <div className="flex items-center space-x-2">
                                  <span className="text-[11px] font-bold text-slate-400">Veritabanındaki Başka Malzeme ile Kıyasla:</span>
                                  <input
                                    type="text"
                                    value={globalSearchKeyword}
                                    onChange={e => setGlobalSearchKeyword(e.target.value)}
                                    placeholder="Örn: seramik, kablo, profil, boya, vana..."
                                    className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 max-w-xs"
                                  />
                                  {globalSearchKeyword && (
                                    <button
                                      type="button"
                                      onClick={() => setGlobalSearchKeyword('')}
                                      className="text-xs text-slate-400 hover:text-white"
                                    >
                                      Temizle
                                    </button>
                                  )}
                                </div>

                                {globalSearchResults.length > 0 && (
                                  <div className="mt-2 p-3 bg-slate-900/90 border border-slate-800 rounded-2xl space-y-2">
                                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">
                                      Arama Sonuçları ({globalSearchResults.length} Kart Bulundu)
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                      {globalSearchResults.map(b => (
                                        <div key={b.id} className="p-2 bg-slate-950 border border-slate-800 rounded-xl text-xs">
                                          <div className="font-bold text-slate-200 truncate" title={b.materialName}>{b.materialName}</div>
                                          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                                            <span>Ortalama: <strong className="text-emerald-400">{formatRuble(b.avgPrice)}</strong></span>
                                            <span>{b.history.length} Fatura</span>
                                          </div>
                                          {onNavigateToCompare && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                onClose();
                                                onNavigateToCompare(b.materialName);
                                              }}
                                              className="mt-1 text-[10px] text-indigo-400 hover:text-indigo-200 flex items-center space-x-1"
                                            >
                                              <span>Tüm Şantiyeleri İncele</span>
                                              <ArrowUpRight className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-950 px-6 py-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/prizma/invoice-file/${invoice.prizmaDemandId}?type=schet`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all border border-emerald-400/40 flex items-center space-x-1.5 shadow-md shadow-emerald-950/40"
              title="Prizma'ya Yüklenmiş Orijinal Fatura Belgesini (Счет на оплату) Doğrudan Aç"
            >
              <FileText className="w-4 h-4" />
              <span>Bu Faturayı Aç (Счет на оплаtu)</span>
            </a>

            <a
              href={getPrizmaBtfUrl(invoice.prizmaDemandId, invoice.prizmaBtfUrl || invoice.prizmaUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all border border-blue-400/40 flex items-center space-x-1.5 shadow-md shadow-blue-950/40"
              title="Prizma Sisteminde Bu BTF Ödeme Talebini Aç"
            >
              <span className="font-black">П</span>
              <span>BTF'yi Prizma'da Aç</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            {(invoice.prizmaStfUrl || invoice.prizmaOrderDemandId) && (
              <a
                href={getPrizmaStfUrl(invoice.prizmaOrderDemandId, invoice.prizmaStfUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-purple-500/40 flex items-center space-x-1.5"
                title="Prizma Sisteminde Bu Siparişi (STF) Aç"
              >
                <span>STF'yi Prizma'da Aç</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <a
              href={`/api/files/Piyasa_Teklif_Kiyas_Tablosu_${encodeURIComponent(invoice.invoiceNumber)}.xlsx?download=true`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700 flex items-center space-x-1.5"
              title="Bu Faturanın Piyasa Kıyaslama Raporunu Excel Olarak İndir"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span>Excel Kıyas Raporu İndir</span>
            </a>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-700"
          >
            Pencereli Kapat
          </button>
        </div>

      </div>
    </div>
  );
};
