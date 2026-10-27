import React, { useState, useMemo } from 'react';
import html2pdf from 'html2pdf.js';
import { useLanguage } from '../context/LanguageContext';
import { DiscountRecord, InvoiceRecord, Jobsite, PurchasingSupervisor, Personnel, MaterialComparison } from '../types';
import { formatRuble } from '../utils/format';
import { getGenuineNegotiationRoundCount } from '../utils/negotiationStages';
import { dedupeSyncedInvoices, isPrizmaAutoSyncedInvoice } from '../utils/dashboardStats';
import { normalizeCategoryName } from '../utils/categoryClassifier';
import { getSynchronizedAppleToAppleComparisons } from '../utils/dualMaterialComparisonEngine';
import * as XLSX from 'xlsx';
import {
  Building2,
  TrendingUp,
  Coins,
  Printer,
  X,
  Sparkles,
  Award,
  Scale,
  FileSpreadsheet,
  ChevronDown,
  Search,
  Filter,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowUpRight,
  TrendingDown,
  FileText,
  Briefcase,
  Users,
  Trophy,
  PieChart,
  BarChart3,
  Percent,
  Download,
  Flame,
  Zap,
  Target,
  ChevronRight,
  ShieldAlert,
  SlidersHorizontal,
  Info
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  discounts: DiscountRecord[];
  invoices: InvoiceRecord[];
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  personnel?: Personnel[];
  comparisons?: MaterialComparison[];
}

interface CategorySpendRow {
  category: string;
  totalAgreed: number;
  totalDiscount: number;
  totalOffer: number;
  savingsPercentage: number;
  shareOfSpend: number;
  transactionCount: number;
  topMaterial: string;
}

interface SupervisorPerformanceRow {
  supervisorId: string;
  supervisorName: string;
  totalAgreed: number;
  totalDiscount: number;
  totalOffer: number;
  savingsPercentage: number;
  shareOfTotalDiscount: number;
  transactionCount: number;
  golCount: number;
  asistCount: number;
  totalNegotiationRounds: number;
  newVendorsCount: number;
  rank: number;
  assistants: Array<{
    name: string;
    asistCount: number;
    discountAmount: number;
  }>;
}

interface JobsiteBudgetRow {
  jobsiteId: string;
  jobsiteName: string;
  code: string;
  definedBudget: number;
  monthlyInvoiceSpend: number;
  monthlyDiscountedSpend: number;
  totalDiscount: number;
  savingsPercentage: number;
  budgetUsageRatio: number; // spend vs defined budget, or share of company spend
  shareOfSpend: number;
  transactionCount: number;
  invoiceCount: number;
  topSupervisor: string;
  topCategory: string;
}

interface TopDiscountDeal {
  id: string;
  materialName: string;
  jobsiteName: string;
  vendorName: string;
  supervisorName: string;
  offerPrice: number;
  agreedPrice: number;
  discountAmount: number;
  discountPercentage: number;
  date: string;
  isHighVolume: boolean;
}

interface StrategicHeavyMaterial {
  materialName: string;
  category: string;
  unit: string;
  quantity: number;
  avgOfferPrice: number;
  avgAgreedPrice: number;
  totalSpend: number;
  totalDiscount: number;
  discountPercentage: number;
  jobsiteName: string;
  vendorName: string;
}

interface CriticalMaterialBenchmark {
  key: string;
  materialName: string;
  category: string;
  unit: string;
  totalQuantity: number;
  avgOfferUnitPrice: number;
  avgAgreedUnitPrice: number;
  unitSavings: number;
  totalSavings: number;
  totalAgreedSpend: number;
  savingsPercentage: number;
  sourceTransactionCount: number;
  representativeVendors: string[];
  group: 'DEMIR' | 'GAZBLOK' | 'IZOLASYON' | 'BETON' | 'KALIP' | 'DIGER';
  groupLabel: string;
  isStrategic: boolean;
}

export const MonthlyExecutiveReportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  discounts = [],
  invoices = [],
  jobsites = [],
  supervisors = [],
  personnel = [],
  comparisons = []
}) => {
  const { language } = useLanguage();
  const isRu = language === 'ru';

  // Active view tab inside Executive Report
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'CATEGORIES' | 'SUPERVISORS' | 'JOBSITES' | 'RECORD_DEALS' | 'MATERIALS'>('OVERVIEW');

  const parseToYearMonth = (rawVal?: string): string => {
    if (!rawVal || typeof rawVal !== 'string') return '';
    const s = rawVal.trim();
    const isoMatch = s.match(/^(\d{4})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
    const dotMatch = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
    if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}`;
    return s.length >= 7 ? s.slice(0, 7) : '';
  };

  // Helper: Extract valid Year-Month from any date representation
  const getRecordMonth = (d: { date?: string; invoiceDate?: string; orderDate?: string; finalNegotiationDate?: string; created_at?: string; createdAt?: string; uploadDate?: string }): string => {
    return (
      parseToYearMonth(d.date) ||
      parseToYearMonth(d.invoiceDate) ||
      parseToYearMonth(d.orderDate) ||
      parseToYearMonth(d.finalNegotiationDate) ||
      parseToYearMonth(d.uploadDate) ||
      parseToYearMonth(d.created_at) ||
      parseToYearMonth(d.createdAt) ||
      ''
    );
  };

  // Sadece GES platformu modüllerinden (Yeni Satınalma İndirim Girişi, TDF, AI Fatura) girilen faturalar (Prizma referans faturaları hariç)
  const platformInvoices = useMemo(() => {
    const deduped = dedupeSyncedInvoices(invoices, discounts);
    return deduped.filter(inv => !inv.isDeleted && !inv.isPermanentlyDeleted && !isPrizmaAutoSyncedInvoice(inv));
  }, [invoices, discounts]);

  // 1. Available Months Derivation & Active Default Month Selection
  const { availableMonths, bestDefaultMonth } = useMemo(() => {
    const monthCounts = new Map<string, number>();

    discounts.forEach(d => {
      if (d.isDeleted || d.isPermanentlyDeleted) return;
      const ym = getRecordMonth(d);
      if (ym) monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);
    });

    platformInvoices.forEach(inv => {
      const ym = getRecordMonth(inv);
      if (ym) monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);
    });

    const sortedMonths = Array.from(monthCounts.keys()).sort().reverse();
    const currentCalMonth = new Date().toISOString().slice(0, 7);

    // Güncel takvim ayında kayıt varsa doğrudan güncel ayı seç; yoksa bugüne en yakın aktif ayı seç (gelecek tarihli tekil hatalı kayıtları atla)
    let chosen = sortedMonths[0] || currentCalMonth;
    if (monthCounts.has(currentCalMonth) && (monthCounts.get(currentCalMonth) || 0) >= 1) {
      chosen = currentCalMonth;
    } else {
      const latestActive = sortedMonths.find(m => m <= currentCalMonth && (monthCounts.get(m) || 0) >= 3);
      if (latestActive) {
        chosen = latestActive;
      }
    }

    return { availableMonths: sortedMonths, bestDefaultMonth: chosen };
  }, [discounts, platformInvoices]);

  // Default to the current/most recent active month dynamically
  const [selectedMonth, setSelectedMonth] = useState<string>(() => bestDefaultMonth);

  // Material filters
  const [materialFilterCategory, setMaterialFilterCategory] = useState<string>('ALL');
  const [materialSearchQuery, setMaterialSearchQuery] = useState<string>('');
  const [materialViewMode, setMaterialViewMode] = useState<'STRATEGIC_TOP' | 'DEMIR' | 'GAZBLOK' | 'IZOLASYON' | 'BETON' | 'TOP_SAVINGS' | 'ALL'>('STRATEGIC_TOP');
  const [expandedSupervisorId, setExpandedSupervisorId] = useState<string | null>(null);

  // Keep selectedMonth valid and synced when data loads
  React.useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth) && selectedMonth !== 'ALL') {
      setSelectedMonth(bestDefaultMonth);
    }
  }, [availableMonths, bestDefaultMonth, selectedMonth]);

  // Format month for executive presentation
  const formatMonthTitle = (mKey: string) => {
    if (mKey === 'ALL') {
      return isRu ? 'Все периоды (Итого)' : 'Tüm Dönemler (Kümülatif İcmal)';
    }
    const [year, month] = mKey.split('-');
    if (!year || !month) return mKey;
    const dateObj = new Date(Number(year), Number(month) - 1, 1);
    return dateObj.toLocaleDateString(isRu ? 'ru-RU' : 'tr-TR', {
      month: 'long',
      year: 'numeric'
    });
  };

  // 2. Filtered discounts and invoices for the selected month
  const monthDiscounts = useMemo(() => {
    return discounts.filter(d => {
      if (d.isDeleted || d.isPermanentlyDeleted) return false;
      if (selectedMonth === 'ALL') return true;
      const ym = getRecordMonth(d);
      return ym === selectedMonth;
    });
  }, [discounts, selectedMonth]);

  const monthInvoices = useMemo(() => {
    return platformInvoices.filter(inv => {
      if (selectedMonth === 'ALL') return true;
      const ym = getRecordMonth(inv);
      return ym === selectedMonth;
    });
  }, [platformInvoices, selectedMonth]);

  // 3. Core Executive KPIs (Ayrıştırılmış: Pazarlıklı Alım vs Toplam Fatura Hacmi)
  const kpis = useMemo(() => {
    let totalDiscount = 0;
    let totalAgreed = 0; // Pazarlığa konu alım tutarı
    let totalOffer = 0;

    monthDiscounts.forEach(d => {
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);
      totalDiscount += disc;
      totalAgreed += agr;
      totalOffer += off;
    });

    let totalInvoiceSpend = 0; // Şirket toplam fatura hacmi
    monthInvoices.forEach(i => {
      totalInvoiceSpend += Number(i.totalAmount) || 0;
    });

    // Pazarlık kapsama oranı: Pazarlık yapılan faturaların genel harcamaya oranı
    const effectiveTotalSpend = Math.max(totalInvoiceSpend, totalAgreed);
    const negotiationCoveragePct = effectiveTotalSpend > 0 ? (totalAgreed / effectiveTotalSpend) * 100 : 0;
    const savingsPct = totalOffer > 0 ? (totalDiscount / totalOffer) * 100 : 0;

    const projectSet = new Set<string>();
    const vendorSet = new Set<string>();
    monthDiscounts.forEach(d => {
      if (d.jobsiteName) projectSet.add(d.jobsiteName);
      if (d.vendorName) vendorSet.add(d.vendorName);
    });

    return {
      totalDiscount,
      totalAgreed, // Pazarlığa konu alım tutarı
      totalOffer,  // İlk teklif tutarı
      totalInvoiceSpend: effectiveTotalSpend, // Toplam fatura hacmi
      negotiationCoveragePct,
      savingsPct,
      transactionCount: monthDiscounts.length,
      invoiceCount: monthInvoices.length,
      activeProjectsCount: projectSet.size,
      activeVendorsCount: vendorSet.size,
      avgDiscountPerTx: monthDiscounts.length > 0 ? totalDiscount / monthDiscounts.length : 0
    };
  }, [monthDiscounts, monthInvoices]);

  // 3.5. Gelişmiş ve Temiz Kategori Çözümleme Motoru (Diğer Malzeme kalıntısını tamamen ortadan kaldırır)
  const getCleanDiscountCategory = (d: DiscountRecord, fallbackItemName?: string): string => {
    const rawCat = d.category || '';
    const itemNames = (d.items || []).map(i => `${i.materialName || ''} ${i.originalName || ''} ${i.category || ''}`).join(' ');
    const norm = normalizeCategoryName(rawCat, `${fallbackItemName || ''} ${itemNames} ${d.description || ''} ${d.notes || ''} ${d.vendorName || ''}`);
    if (norm && norm !== 'Diğer Malzeme' && norm !== 'Прочие материалы' && norm !== 'Diğer') {
      return norm;
    }
    // Tedarikçi ve işlem içerik sezgiselleri (Heuristic Fallback)
    const sLower = (d.vendorName || '').toLowerCase();
    if (/поинтер|pointer|комус|komus|sitilink|citilink/i.test(sLower)) return 'Bilgi İşlem & IT';
    if (/петрович|petrovich|дипломат|сателит|satelit/i.test(sLower)) return 'Yalıtım & Alçıpan';
    if (/всеинструмент|vseinstrumenti|системный специалист/i.test(sLower)) return 'El Aletleri & Hırdavat';
    if (/бкз|евробетон|росбетон|мосбетон|бетон/i.test(sLower)) return 'Hazır Beton, Çimento & Agrega';
    if (/армкаркас|сталь|металл|прокат/i.test(sLower)) return 'Çelik Malzemeler';
    if (/технорум|баумак|профмастер|рока/i.test(sLower)) return 'Kalıp & İskele Sistemleri';
    return 'Sarf Malzeme & Hırdavat';
  };

  // 4. Kategori Bazlı Harcama ve Tasarruf Dağılımı (Kalem Düzeyinde Çoklu Kategori Ayrıştırmalı)
  const categoryBreakdown: CategorySpendRow[] = useMemo(() => {
    const map = new Map<string, {
      agreed: number;
      discount: number;
      offer: number;
      count: number;
      materials: Map<string, number>;
    }>();

    monthDiscounts.forEach(d => {
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const items = d.items || [];
      const itemPrices = items.map(it => Number(it.totalPrice) || (Number(it.quantity) * Number(it.unitPrice)) || 0);
      const itemAgreedSum = itemPrices.reduce((a, b) => a + b, 0);

      // Çok kalemli faturalarda harcama ve indirimi gerçek alt kategori kalemlerine dağıt
      if (items.length > 1 && itemAgreedSum > 0 && agr > 0) {
        const discRatio = disc / agr;
        const scaleToAgr = agr / itemAgreedSum;

        items.forEach((it, idx) => {
          const rawItemAmt = itemPrices[idx];
          if (rawItemAmt <= 0) return;
          const itemAgr = rawItemAmt * scaleToAgr;
          const itemDisc = itemAgr * discRatio;
          const itemOff = itemAgr + itemDisc;
          const itName = (it.materialName || it.originalName || '').trim();
          let itCat = normalizeCategoryName(it.category, `${itName} ${d.vendorName || ''}`);
          if (!itCat || itCat === 'Diğer Malzeme' || itCat === 'Прочие материалы' || itCat === 'Diğer') {
            itCat = getCleanDiscountCategory(d, itName);
          }

          if (!map.has(itCat)) {
            map.set(itCat, { agreed: 0, discount: 0, offer: 0, count: 0, materials: new Map() });
          }
          const entry = map.get(itCat)!;
          entry.agreed += itemAgr;
          entry.discount += itemDisc;
          entry.offer += itemOff;
          entry.count += 1;
          if (itName) {
            entry.materials.set(itName, (entry.materials.get(itName) || 0) + itemAgr);
          }
        });
      } else {
        // Tek kalemli veya özet faturalarda ana kategori çözümlemesi
        const defaultCat = getCleanDiscountCategory(d);
        const off = Number(d.offerPrice) || (agr + disc);

        if (!map.has(defaultCat)) {
          map.set(defaultCat, { agreed: 0, discount: 0, offer: 0, count: 0, materials: new Map() });
        }
        const entry = map.get(defaultCat)!;
        entry.agreed += agr;
        entry.discount += disc;
        entry.offer += off;
        entry.count += 1;

        items.forEach(it => {
          const mName = (it.materialName || it.originalName || '').trim();
          if (mName) {
            entry.materials.set(mName, (entry.materials.get(mName) || 0) + (Number(it.totalPrice) || agr));
          }
        });
      }
    });

    const totalAgreedAll = kpis.totalAgreed || 1;
    const rows: CategorySpendRow[] = [];

    map.forEach((data, category) => {
      let topMat = '-';
      let maxMatSpend = -1;
      data.materials.forEach((amt, name) => {
        if (amt > maxMatSpend) {
          maxMatSpend = amt;
          topMat = name;
        }
      });

      const savingsPercentage = data.offer > 0 ? (data.discount / data.offer) * 100 : 0;
      const shareOfSpend = (data.agreed / totalAgreedAll) * 100;

      rows.push({
        category,
        totalAgreed: data.agreed,
        totalDiscount: data.discount,
        totalOffer: data.offer,
        savingsPercentage,
        shareOfSpend,
        transactionCount: data.count,
        topMaterial: topMat
      });
    });

    return rows.sort((a, b) => b.totalAgreed - a.totalAgreed);
  }, [monthDiscounts, kpis.totalAgreed]);

  // 5. Şefler Arası Tasarruf & Rekabet Sıralaması (Liderlik Tablosu & Şef İcra Karnesi)
  const supervisorLeaderboard: SupervisorPerformanceRow[] = useMemo(() => {
    const map = new Map<string, {
      supervisorName: string;
      agreed: number;
      discount: number;
      offer: number;
      count: number;
      golCount: number;
      asistCount: number;
      rounds: number;
      newVendors: Set<string>;
      assistantsMap: Map<string, { asistCount: number; discountAmount: number }>;
    }>();

    monthDiscounts.forEach(d => {
      const supName = (d.supervisorName || 'Genel Satınalma').trim();
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);

      if (!map.has(supName)) {
        map.set(supName, {
          supervisorName: supName,
          agreed: 0,
          discount: 0,
          offer: 0,
          count: 0,
          golCount: 0,
          asistCount: 0,
          rounds: 0,
          newVendors: new Set(),
          assistantsMap: new Map()
        });
      }

      const item = map.get(supName)!;
      item.agreed += agr;
      item.discount += disc;
      item.offer += off;
      item.count += 1;

      // Asist vs Gol kontrolü
      const isAsist = d.recordOriginType === 'asist' ||
        (d as any).recordOrigin === 'asist' ||
        Boolean(d.performedByPersonnelId || d.performedByPersonnelName);

      if (isAsist) {
        item.asistCount += 1;
        const assistName = (d.performedByPersonnelName || 'Satınalma Uzmanı').trim();
        if (!item.assistantsMap.has(assistName)) {
          item.assistantsMap.set(assistName, { asistCount: 0, discountAmount: 0 });
        }
        const aEntry = item.assistantsMap.get(assistName)!;
        aEntry.asistCount += 1;
        aEntry.discountAmount += disc;
      } else {
        item.golCount += 1;
      }

      // Negotiation round count
      const r = getGenuineNegotiationRoundCount(d);
      item.rounds += r;

      if (d.vendorName && (d.isNewVendor || d.is_new_vendor)) {
        item.newVendors.add(d.vendorName);
      }
    });

    // Ensure all official supervisors are represented (so no chief disappears even in slower months)
    supervisors.forEach(sup => {
      const sName = sup.name.trim();
      if (!map.has(sName)) {
        map.set(sName, {
          supervisorName: sName,
          agreed: 0,
          discount: 0,
          offer: 0,
          count: 0,
          golCount: 0,
          asistCount: 0,
          rounds: 0,
          newVendors: new Set(),
          assistantsMap: new Map()
        });
      }
    });

    const totalGrandDiscount = kpis.totalDiscount || 1;
    const rows: SupervisorPerformanceRow[] = [];

    map.forEach((val, name) => {
      const savingsPercentage = val.offer > 0 ? (val.discount / val.offer) * 100 : 0;
      const shareOfTotalDiscount = totalGrandDiscount > 0 && val.discount > 0 ? (val.discount / totalGrandDiscount) * 100 : 0;

      const assistants = Array.from(val.assistantsMap.entries()).map(([aName, aStats]) => ({
        name: aName,
        asistCount: aStats.asistCount,
        discountAmount: aStats.discountAmount
      })).sort((a, b) => b.discountAmount - a.discountAmount);

      const supObj = supervisors.find(s => s.name.trim().toLowerCase() === name.toLowerCase());

      rows.push({
        supervisorId: supObj?.id || name,
        supervisorName: name,
        totalAgreed: val.agreed,
        totalDiscount: val.discount,
        totalOffer: val.offer,
        savingsPercentage,
        shareOfTotalDiscount,
        transactionCount: val.count,
        golCount: val.golCount,
        asistCount: val.asistCount,
        totalNegotiationRounds: val.rounds,
        newVendorsCount: val.newVendors.size,
        rank: 0,
        assistants
      });
    });

    // Tasarruf tutarına göre sırala (0 olanlar en sonda) ve sıralama derecesini ver
    rows.sort((a, b) => {
      if (b.totalDiscount !== a.totalDiscount) return b.totalDiscount - a.totalDiscount;
      if (b.totalAgreed !== a.totalAgreed) return b.totalAgreed - a.totalAgreed;
      return a.supervisorName.localeCompare(b.supervisorName);
    });
    rows.forEach((r, idx) => {
      r.rank = idx + 1;
    });

    return rows;
  }, [monthDiscounts, supervisors, kpis.totalDiscount]);

  // 6. Şantiye Bütçe Kullanım Durumu (Daha Ayrıntılı Şantiye İcmali)
  const jobsiteBudgetBreakdown: JobsiteBudgetRow[] = useMemo(() => {
    const map = new Map<string, {
      jobsiteName: string;
      code: string;
      definedBudget: number;
      invoiceSpend: number;
      discountedSpend: number;
      discountAmount: number;
      offerAmount: number;
      txCount: number;
      invCount: number;
      supervisors: Map<string, number>;
      categories: Map<string, number>;
    }>();

    // Map initial jobsites
    jobsites.forEach(j => {
      map.set(j.name.trim(), {
        jobsiteName: j.name.trim(),
        code: j.code || '',
        definedBudget: Number(j.budget) || 0,
        invoiceSpend: 0,
        discountedSpend: 0,
        discountAmount: 0,
        offerAmount: 0,
        txCount: 0,
        invCount: 0,
        supervisors: new Map(),
        categories: new Map()
      });
    });

    // Invoices contribution
    monthInvoices.forEach(inv => {
      const siteName = (inv.jobsiteName || 'Genel Şantiye').trim();
      if (!map.has(siteName)) {
        const found = jobsites.find(j => j.id === inv.jobsiteId);
        map.set(siteName, {
          jobsiteName: siteName,
          code: found?.code || '',
          definedBudget: Number(found?.budget) || 0,
          invoiceSpend: 0,
          discountedSpend: 0,
          discountAmount: 0,
          offerAmount: 0,
          txCount: 0,
          invCount: 0,
          supervisors: new Map(),
          categories: new Map()
        });
      }
      const entry = map.get(siteName)!;
      entry.invoiceSpend += Number(inv.totalAmount) || 0;
      entry.invCount += 1;
    });

    // Discounts contribution
    monthDiscounts.forEach(d => {
      const siteName = (d.jobsiteName || 'Genel Şantiye').trim();
      if (!map.has(siteName)) {
        const found = jobsites.find(j => j.id === d.jobsiteId);
        map.set(siteName, {
          jobsiteName: siteName,
          code: found?.code || '',
          definedBudget: Number(found?.budget) || 0,
          invoiceSpend: 0,
          discountedSpend: 0,
          discountAmount: 0,
          offerAmount: 0,
          txCount: 0,
          invCount: 0,
          supervisors: new Map(),
          categories: new Map()
        });
      }
      const entry = map.get(siteName)!;
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);

      entry.discountedSpend += agr;
      entry.discountAmount += disc;
      entry.offerAmount += off;
      entry.txCount += 1;

      const sName = d.supervisorName || 'Şef';
      entry.supervisors.set(sName, (entry.supervisors.get(sName) || 0) + disc);

      const catName = getCleanDiscountCategory(d);
      entry.categories.set(catName, (entry.categories.get(catName) || 0) + agr);
    });

    const companyTotalSpend = kpis.totalInvoiceSpend || 1;
    const rows: JobsiteBudgetRow[] = [];

    map.forEach((data, jName) => {
      const isOfficialSite = jobsites.some(j => j.name.trim().toLowerCase() === jName.toLowerCase());
      // Include all official registered sites regardless of 0 spend, or any custom site that had activity
      if (!isOfficialSite && data.invoiceSpend <= 0 && data.discountedSpend <= 0 && data.txCount <= 0) return;

      const effectiveSpend = Math.max(data.invoiceSpend, data.discountedSpend);
      const savingsPercentage = data.offerAmount > 0 ? (data.discountAmount / data.offerAmount) * 100 : 0;
      const shareOfSpend = companyTotalSpend > 0 && effectiveSpend > 0 ? (effectiveSpend / companyTotalSpend) * 100 : 0;
      const budgetUsageRatio = data.definedBudget > 0 ? (effectiveSpend / data.definedBudget) * 100 : shareOfSpend;

      let topSup = '-';
      let maxSupDisc = -1;
      data.supervisors.forEach((amt, name) => {
        if (amt > maxSupDisc) {
          maxSupDisc = amt;
          topSup = name;
        }
      });

      let topCat = '-';
      let maxCatSpend = -1;
      data.categories.forEach((amt, name) => {
        if (amt > maxCatSpend) {
          maxCatSpend = amt;
          topCat = name;
        }
      });

      const matchedJobsite = jobsites.find(j => j.name.trim().toLowerCase() === jName.toLowerCase());

      rows.push({
        jobsiteId: matchedJobsite?.id || jName,
        jobsiteName: jName,
        code: data.code || matchedJobsite?.code || '-',
        definedBudget: data.definedBudget,
        monthlyInvoiceSpend: effectiveSpend,
        monthlyDiscountedSpend: data.discountedSpend,
        totalDiscount: data.discountAmount,
        savingsPercentage,
        budgetUsageRatio,
        shareOfSpend,
        transactionCount: data.txCount,
        invoiceCount: data.invCount,
        topSupervisor: topSup,
        topCategory: topCat
      });
    });

    return rows.sort((a, b) => {
      if (b.totalDiscount !== a.totalDiscount) return b.totalDiscount - a.totalDiscount;
      if (b.monthlyInvoiceSpend !== a.monthlyInvoiceSpend) return b.monthlyInvoiceSpend - a.monthlyInvoiceSpend;
      return a.jobsiteName.localeCompare(b.jobsiteName);
    });
  }, [jobsites, monthInvoices, monthDiscounts, kpis.totalInvoiceSpend]);

  // 7. En Yüksek İskonto Oranlı Alımlar (Rekor Pazarlıklar) & Yüksek Miktarlı Alımlar (Demir vb.)
  const recordDeals = useMemo(() => {
    const list: TopDiscountDeal[] = [];

    monthDiscounts.forEach(d => {
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);
      const pct = off > 0 ? (disc / off) * 100 : 0;

      if (disc <= 0) return;

      let topMatName = '';
      if (d.items && d.items.length > 0) {
        topMatName = d.items[0].materialName || d.items[0].originalName || '';
        if (d.items.length > 1) {
          topMatName += ` (+${d.items.length - 1} kalem)`;
        }
      }
      if (!topMatName) {
        topMatName = d.description || d.invoiceNo || 'Satınalma Kalemi';
      }

      const isHighVol = agr > 2000000 || disc > 500000 ||
        topMatName.toLowerCase().includes('demir') ||
        topMatName.toLowerCase().includes('beton') ||
        topMatName.toLowerCase().includes('a500c');

      list.push({
        id: d.id,
        materialName: topMatName,
        jobsiteName: d.jobsiteName || 'Şantiye',
        vendorName: d.vendorName || 'Tedarikçi',
        supervisorName: d.supervisorName || 'Şef',
        offerPrice: off,
        agreedPrice: agr,
        discountAmount: disc,
        discountPercentage: pct,
        date: (d.date || d.created_at || '').split('T')[0],
        isHighVolume: isHighVol
      });
    });

    // En yüksek iskonto oranına göre sırala
    const topByPercentage = [...list]
      .filter(x => x.discountPercentage >= 15 || x.discountAmount >= 200000)
      .sort((a, b) => b.discountPercentage - a.discountPercentage)
      .slice(0, 10);

    // En yüksek tutarlı / demir gibi büyük hacimli alımlara göre sırala
    const topByVolume = [...list]
      .sort((a, b) => b.agreedPrice - a.agreedPrice)
      .slice(0, 10);

    return {
      topByPercentage,
      topByVolume
    };
  }, [monthDiscounts]);

  // 8. Stratejik Ağır Malzemeler ve Benchmarklar (Demir, Beton, Kalıp vb.)
  const criticalBenchmarks: CriticalMaterialBenchmark[] = useMemo(() => {
    interface MatAgg {
      name: string;
      category: string;
      unit: string;
      totalQty: number;
      totalAgreedSpend: number;
      totalOfferSpend: number;
      totalSavings: number;
      txCount: number;
      vendors: Set<string>;
    }

    const map = new Map<string, MatAgg>();

    // Her indirim kaydı için varsa doğrulanmış canonicalMaterials, yoksa kalemler (items) kullanılır (Çift sayımı kesin olarak önler)
    monthDiscounts.forEach(d => {
      const canons = d.canonicalMaterials || [];
      if (canons.length > 0) {
        canons.forEach(c => {
          const name = (c.commonName || c.canonicalName || '').trim();
          if (!name) return;
          const qty = Number(c.quantity) || 1;
          const pPrice = Number(c.purchasedUnitPrice) || 0;
          const fPrice = Number(c.winningFirstUnitPrice) ||
                         Number(c.lowestInitialOffer?.normalizedUnitPrice) ||
                         Number(c.marketReferenceUnitPrice) ||
                         pPrice;
          const savings = Number(c.realTotalSavings) || (Math.max(0, fPrice - pPrice) * qty);
          const agreedSpend = pPrice * qty;
          const offerSpend = agreedSpend + savings;

          if (!map.has(name)) {
            const canonCat = normalizeCategoryName(c.materialType || d.category, name);
            map.set(name, {
              name,
              category: canonCat !== 'Diğer Malzeme' && canonCat !== 'Прочие материалы' && canonCat !== 'Diğer' ? canonCat : 'Çelik Malzemeler',
              unit: c.standardUnit || 'Birim',
              totalQty: 0,
              totalAgreedSpend: 0,
              totalOfferSpend: 0,
              totalSavings: 0,
              txCount: 0,
              vendors: new Set()
            });
          }
          const item = map.get(name)!;
          item.totalQty += qty;
          item.totalAgreedSpend += agreedSpend;
          item.totalOfferSpend += offerSpend;
          item.totalSavings += savings;
          item.txCount += 1;
          if (d.vendorName) item.vendors.add(d.vendorName);
        });
        return;
      }

      const discAmt = Number(d.discountAmount) || 0;
      const agrAmt = Number(d.agreedPrice) || 1;
      const offAmt = Number(d.offerPrice) || (agrAmt + discAmt);
      const ratio = offAmt > 0 ? (discAmt / offAmt) : 0;

      (d.items || []).forEach(it => {
        const rawName = (it.materialName || it.originalName || '').trim();
        if (!rawName) return;

        const qty = Number(it.quantity) || 1;
        const unitPrice = Number(it.unitPrice) || 0;
        const agrTotal = Number(it.totalPrice) || (qty * unitPrice);
        if (agrTotal <= 0) return;

        const offTotal = ratio > 0 && ratio < 0.95 ? agrTotal / (1 - ratio) : agrTotal;
        const savingsTotal = Math.max(0, offTotal - agrTotal);

        if (!map.has(rawName)) {
          let lineCat = normalizeCategoryName(it.category, `${rawName} ${d.vendorName || ''}`);
          if (!lineCat || lineCat === 'Diğer Malzeme' || lineCat === 'Прочие материалы' || lineCat === 'Diğer') {
            lineCat = getCleanDiscountCategory(d, rawName);
          }
          map.set(rawName, {
            name: rawName,
            category: lineCat,
            unit: it.unit || 'Adet',
            totalQty: 0,
            totalAgreedSpend: 0,
            totalOfferSpend: 0,
            totalSavings: 0,
            txCount: 0,
            vendors: new Set()
          });
        }
        const item = map.get(rawName)!;
        item.totalQty += qty;
        item.totalAgreedSpend += agrTotal;
        item.totalOfferSpend += offTotal;
        item.totalSavings += savingsTotal;
        item.txCount += 1;
        if (d.vendorName) item.vendors.add(d.vendorName);
      });
    });

    const list: CriticalMaterialBenchmark[] = [];

    map.forEach((item, key) => {
      if (item.totalQty <= 0) return;
      const avgAgreed = item.totalAgreedSpend / item.totalQty;
      const avgOffer = item.totalOfferSpend / item.totalQty;
      const unitSavings = Math.max(0, avgOffer - avgAgreed);
      const savingsPct = avgOffer > 0 ? (unitSavings / avgOffer) * 100 : 0;

      const lower = item.name.toLowerCase();
      const lowerCat = item.category.toLowerCase();
      const combined = `${lower} ${lowerCat}`;

      // Detaylı Stratejik Grup Sınıflandırması
      let group: 'DEMIR' | 'GAZBLOK' | 'IZOLASYON' | 'BETON' | 'KALIP' | 'DIGER' = 'DIGER';
      let groupLabel = 'Genel Malzeme';

      if (
        combined.includes('demir') || combined.includes('a500c') || combined.includes('арматура') ||
        combined.includes('çelik') || combined.includes('hasır') || combined.includes('sac') ||
        combined.includes('kiriş') || combined.includes('profil') || combined.includes('korkuluk') ||
        combined.includes('metal')
      ) {
        group = 'DEMIR';
        groupLabel = 'İnşaat Demiri & Çelik';
      } else if (
        combined.includes('gazbeton') || combined.includes('gazablok') || combined.includes('gazblok') ||
        combined.includes('газобетон') || combined.includes('газоблок') || combined.includes('ytong') ||
        combined.includes('porit') || combined.includes('blok')
      ) {
        group = 'GAZBLOK';
        groupLabel = 'Gazbeton & Blok';
      } else if (
        combined.includes('izolasyon') || combined.includes('yalıtım') || combined.includes('taşyünü') ||
        combined.includes('xps') || combined.includes('eps') || combined.includes('membran') ||
        combined.includes('icopal') || combined.includes('villatex') || combined.includes('tente') ||
        combined.includes('branda') || combined.includes('geotekstil') || combined.includes('keçe') ||
        combined.includes('penolon') || combined.includes('penoplex') || combined.includes('akustik') ||
        combined.includes('утеплитель') || combined.includes('изоляция')
      ) {
        group = 'IZOLASYON';
        groupLabel = 'İzolasyon & Yalıtım';
      } else if (
        combined.includes('beton') || combined.includes('çimento') || combined.includes('agrega') ||
        combined.includes('drenaj') || combined.includes('harç') || combined.includes('бетон') ||
        combined.includes('цемент')
      ) {
        group = 'BETON';
        groupLabel = 'Beton & Agrega';
      } else if (
        combined.includes('kalıp') || combined.includes('kontrplak') || combined.includes('plywood') ||
        combined.includes('iskele') || combined.includes('h20') || combined.includes('фанера')
      ) {
        group = 'KALIP';
        groupLabel = 'Kalıp & Kontrplak';
      }

      // Önemsiz sarf / büro / kantin malzemelerini ele
      const isTrivial =
        combined.includes('bardak') || combined.includes('su 0.') || combined.includes('maden suyu') ||
        combined.includes('deterjan') || combined.includes('sabun') || combined.includes('tuvalet') ||
        combined.includes('bloknot') || combined.includes('mop') || combined.includes('kaşık') ||
        combined.includes('terlik') || combined.includes('kartuş') || combined.includes('toner');

      const isHighVolume = item.totalAgreedSpend >= 250000 || item.totalSavings >= 40000;
      const isStrategic = !isTrivial && (group !== 'DIGER' || isHighVolume);

      list.push({
        key,
        materialName: item.name,
        category: item.category,
        unit: item.unit,
        totalQuantity: item.totalQty,
        avgOfferUnitPrice: avgOffer,
        avgAgreedUnitPrice: avgAgreed,
        unitSavings,
        totalSavings: item.totalSavings,
        totalAgreedSpend: item.totalAgreedSpend,
        savingsPercentage: savingsPct,
        sourceTransactionCount: item.txCount,
        representativeVendors: Array.from(item.vendors).slice(0, 3),
        group,
        groupLabel: group !== 'DIGER' ? groupLabel : 'Ağır Satınalma',
        isStrategic
      });
    });

    // Stratejik olanlar öncelikli, sonra toplam büyüklük (harcama + tasarruf)
    return list.sort((a, b) => {
      if (a.isStrategic !== b.isStrategic) return a.isStrategic ? -1 : 1;
      return (b.totalAgreedSpend + b.totalSavings) - (a.totalAgreedSpend + a.totalSavings);
    });
  }, [monthDiscounts]);

  // En kritik 12-14 stratejik malzeme (Raporun şişkinliğini önleyen ve yöneticiye sunulan seçkin liste)
  const topStrategicBenchmarks = useMemo(() => {
    return criticalBenchmarks
      .filter(m => m.isStrategic)
      .slice(0, 14);
  }, [criticalBenchmarks]);

  // Filtrelenmiş kritik malzemeler (Kullanıcının etkileşimli filtrelerine göre)
  const filteredBenchmarks = useMemo(() => {
    return criticalBenchmarks.filter(m => {
      if (materialViewMode === 'STRATEGIC_TOP') {
        const topKeys = new Set(topStrategicBenchmarks.map(x => x.key));
        if (!topKeys.has(m.key)) return false;
      } else if (materialViewMode === 'DEMIR') {
        if (m.group !== 'DEMIR') return false;
      } else if (materialViewMode === 'GAZBLOK') {
        if (m.group !== 'GAZBLOK') return false;
      } else if (materialViewMode === 'IZOLASYON') {
        if (m.group !== 'IZOLASYON') return false;
      } else if (materialViewMode === 'BETON') {
        if (m.group !== 'BETON' && m.group !== 'KALIP') return false;
      } else if (materialViewMode === 'TOP_SAVINGS') {
        if (m.totalSavings < 30000) return false;
      }

      if (materialFilterCategory !== 'ALL' && m.category !== materialFilterCategory) {
        return false;
      }

      if (materialSearchQuery.trim()) {
        const q = materialSearchQuery.toLowerCase();
        const matchName = m.materialName.toLowerCase().includes(q);
        const matchCat = m.category.toLowerCase().includes(q);
        const matchVendor = m.representativeVendors.some(v => v.toLowerCase().includes(q));
        if (!matchName && !matchCat && !matchVendor) return false;
      }

      return true;
    });
  }, [criticalBenchmarks, materialViewMode, materialFilterCategory, materialSearchQuery, topStrategicBenchmarks]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    criticalBenchmarks.forEach(m => {
      if (m.category) set.add(m.category);
    });
    return Array.from(set).sort();
  }, [criticalBenchmarks]);

  // 8.25. Aynı Marka & Aynı Teknik Özellik Fiyat Farkı Uyarıları (Elma-Elma Birim Fiyat Sapma Denetimi)
  const sameBrandPriceAlerts = useMemo(() => {
    if (!Array.isArray(comparisons) || comparisons.length === 0) return [];
    const appleToApple = getSynchronizedAppleToAppleComparisons(comparisons, 'local_only');
    const alerts: Array<{
      id: string;
      materialName: string;
      brand: string;
      category: string;
      unit: string;
      minPrice: number;
      maxPrice: number;
      diffPct: number;
      excessSpend: number;
      cheapestSite: string;
      cheapestVendor: string;
      priciestSite: string;
      priciestVendor: string;
      purchaseCount: number;
    }> = [];

    appleToApple.forEach(comp => {
      const monthHist = (comp.history || []).filter(h => {
        if (selectedMonth === 'ALL') return true;
        return parseToYearMonth(h.date) === selectedMonth;
      });
      const activeHist = monthHist.length >= 2 ? monthHist : (selectedMonth === 'ALL' ? (comp.history || []) : []);
      if (activeHist.length < 2) return;

      const validEntries = activeHist
        .map(h => ({
          h,
          price: Number(h.normalizedUnitPrice ?? h.unitPrice) || 0,
          qty: Number(h.normalizedQuantity ?? h.quantity) || 0
        }))
        .filter(x => x.price > 0 && x.qty > 0);

      if (validEntries.length < 2) return;
      const minEntry = validEntries.reduce((a, b) => (b.price < a.price ? b : a), validEntries[0]);
      const maxEntry = validEntries.reduce((a, b) => (b.price > a.price ? b : a), validEntries[0]);
      if (minEntry.price <= 0 || maxEntry.price <= minEntry.price) return;

      const diffPct = ((maxEntry.price - minEntry.price) / minEntry.price) * 100;
      if (diffPct < 5) return;

      const excessSpend = validEntries.reduce((sum, x) => sum + Math.max(0, (x.price - minEntry.price) * x.qty), 0);
      alerts.push({
        id: comp.id || comp.materialName,
        materialName: comp.materialName,
        brand: comp.brand || 'Standart / Aynı Seri',
        category: comp.category || 'Genel',
        unit: comp.unit || 'Adet',
        minPrice: minEntry.price,
        maxPrice: maxEntry.price,
        diffPct,
        excessSpend,
        cheapestSite: minEntry.h.jobsiteName || '-',
        cheapestVendor: minEntry.h.supplier || '-',
        priciestSite: maxEntry.h.jobsiteName || '-',
        priciestVendor: maxEntry.h.supplier || '-',
        purchaseCount: validEntries.length
      });
    });

    return alerts.sort((a, b) => b.excessSpend - a.excessSpend || b.diffPct - a.diffPct).slice(0, 15);
  }, [comparisons, selectedMonth]);

  // 8.5. Akıllı ve Veri Odaklı Yönetici İcra Bulguları (Hem Ekran Hem HTML/PDF Raporu İçin Ortak Motor)
  const executiveInsights = useMemo(() => {
    const topSite = jobsiteBudgetBreakdown[0];
    const secondSite = jobsiteBudgetBreakdown[1];
    const topSiteShare = kpis.totalDiscount > 0 && topSite ? (topSite.totalDiscount / kpis.totalDiscount) * 100 : 0;

    const topSup = supervisorLeaderboard[0];
    const secondSup = supervisorLeaderboard[1];
    const totalGol = supervisorLeaderboard.reduce((acc, s) => acc + s.golCount, 0);
    const totalAsist = supervisorLeaderboard.reduce((acc, s) => acc + s.asistCount, 0);
    const totalRounds = supervisorLeaderboard.reduce((acc, s) => acc + s.totalNegotiationRounds, 0);

    const topCatBySpend = categoryBreakdown[0];
    const topCatBySavings = [...categoryBreakdown].sort((a, b) => b.totalDiscount - a.totalDiscount)[0];

    const bestDealByPct = recordDeals.topByPercentage[0];
    const biggestDealByVol = recordDeals.topByVolume[0];
    const unnegotiatedSpend = Math.max(0, kpis.totalInvoiceSpend - kpis.totalAgreed);
    const potentialAdditionalSavings = unnegotiatedSpend * (kpis.savingsPct > 0 ? Math.min(0.12, kpis.savingsPct / 100) : 0.08);

    return [
      {
        id: 'savings',
        badge: '1. Doğrudan Nakit Tasarrufu & Maliyet Düşüşü',
        color: 'emerald',
        summaryHtml: `Tedarikçilerin sunduğu toplam <strong>${formatRuble(kpis.totalOffer)}</strong> tutarındaki ilk teklifler, yürütülen çok turlu müzakereler sonucunda <strong>${formatRuble(kpis.totalAgreed)}</strong> seviyesine indirilmiş ve şirket kasasında doğrudan <strong style="color:#059669;">+${formatRuble(kpis.totalDiscount)}</strong> net nakit tasarruf tutulmuştur.`,
        footerHtml: `Ortalama İndirim Marjı: <strong>%${kpis.savingsPct.toFixed(1)}</strong> | İşlem Başına Kazanç: <strong>${formatRuble(kpis.avgDiscountPerTx)}</strong>`
      },
      {
        id: 'coverage',
        badge: '2. Satınalma Kapsama & Denetim Disiplini',
        color: 'blue',
        summaryHtml: `GES platformu üzerinden muhasebeleşen <strong>${formatRuble(kpis.totalInvoiceSpend)}</strong> hacmindeki toplam alımın <strong>%${kpis.negotiationCoveragePct.toFixed(1)}</strong>'lik bölümü aktif fiyat pazarlığı ve karşılaştırmalı teklif (TDF) denetiminden geçirilerek onaylanmıştır.`,
        footerHtml: `Denetlenen İşlem: <strong>${kpis.transactionCount} Kayıt</strong> | Aktif Tedarikçi: <strong>${kpis.activeVendorsCount} Firma</strong>`
      },
      {
        id: 'jobsites',
        badge: '3. Şantiye Bazlı Harcama & Tasarruf Yoğunluğu',
        color: 'indigo',
        summaryHtml: topSite
          ? `En yüksek finansal tasarruf <strong>${topSite.jobsiteName}</strong> projesinde (<strong>+${formatRuble(topSite.totalDiscount)}</strong>, genel tasarrufun <strong>%${topSiteShare.toFixed(1)}</strong>'i) sağlanmıştır.${secondSite && secondSite.totalDiscount > 0 ? ` İkinci sırada <strong>${secondSite.jobsiteName}</strong> (<strong>+${formatRuble(secondSite.totalDiscount)}</strong>) yer almaktadır.` : ''}`
          : `Dönem içerisinde aktif şantiyelerde satınalma ve maliyet kontrol süreçleri standart prosedürlerle yürütülmüştür.`,
        footerHtml: `Lider Şantiye Harcaması: <strong>${formatRuble(topSite?.monthlyInvoiceSpend || 0)}</strong> | Sorumlu Şef: <strong>${topSite?.topSupervisor || '-'}</strong>`
      },
      {
        id: 'supervisors',
        badge: '4. Satınalma Şefleri & Uzman Ekip Performansı',
        color: 'amber',
        summaryHtml: topSup && topSup.totalDiscount > 0
          ? `Dönemin tasarruf liderliğini <strong>${formatRuble(topSup.totalAgreed)}</strong> alım hacmi üzerinden <strong style="color:#059669;">+${formatRuble(topSup.totalDiscount)}</strong> (<strong>%${topSup.savingsPercentage.toFixed(1)}</strong>) indirim sağlayan <strong>${topSup.supervisorName}</strong> üstlenmiştir.${secondSup && secondSup.totalDiscount > 0 ? ` Onu <strong>+${formatRuble(secondSup.totalDiscount)}</strong> ile <strong>${secondSup.supervisorName}</strong> takip etmektedir.` : ''}`
          : `Satınalma şefleri ve uzman kadrosu dönem içi siparişleri bütçe limitleri dahilinde tamamlamıştır.`,
        footerHtml: `Kapanış Dağılımı: <strong>${totalGol} Doğrudan Şef / ${totalAsist} Uzman Katkısı</strong> | Toplam: <strong>${totalRounds} Müzakere Turu</strong>`
      },
      {
        id: 'categories',
        badge: '5. Ağırlıklı Maliyet Kategorileri & Birim Analizi',
        color: 'purple',
        summaryHtml: topCatBySpend
          ? `En yüksek bütçe kullanımı <strong>%${topCatBySpend.shareOfSpend.toFixed(1)}</strong> pay ve <strong>${formatRuble(topCatBySpend.totalAgreed)}</strong> hacim ile <strong>${topCatBySpend.category}</strong> grubunda gerçekleşmiştir.${topCatBySavings && topCatBySavings.category !== topCatBySpend.category ? ` En yüksek nakit tasarruf ise <strong>+${formatRuble(topCatBySavings.totalDiscount)}</strong> ile <strong>${topCatBySavings.category}</strong> kaleminde elde edilmiştir.` : ` Bu kategoride toplam <strong>+${formatRuble(topCatBySpend.totalDiscount)}</strong> tasarruf sağlanmıştır.`}`
          : `Ana inşaat girdilerinde kategori bazlı birim fiyat kontrolü uygulanmıştır.`,
        footerHtml: `İzlenen Kategori: <strong>${categoryBreakdown.length} Grup</strong> | Stratejik Benchmark: <strong>${topStrategicBenchmarks.length} Ana Kalem</strong>`
      },
      {
        id: 'records',
        badge: '6. Rekor Müzakereler & Stratejik Yönetim Odağı',
        color: 'rose',
        summaryHtml: bestDealByPct
          ? `En yüksek oranlı tekil indirim <strong>%${bestDealByPct.discountPercentage.toFixed(1)}</strong> (<strong>+${formatRuble(bestDealByPct.discountAmount)}</strong>) ile <strong>${bestDealByPct.materialName}</strong> alımında kaydedilmiştir.${biggestDealByVol ? ` Dönemin en büyük hacimli sözleşmesi <strong>${formatRuble(biggestDealByVol.agreedPrice)}</strong> ile <strong>${biggestDealByVol.materialName}</strong> kaleminde bağlanmıştır.` : ''}`
          : unnegotiatedSpend > 0
            ? `Pazarlık kapsamı dışındaki <strong>${formatRuble(unnegotiatedSpend)}</strong>'lik alım hacminin çoklu teklife açılmasıyla ilave <strong>+${formatRuble(potentialAdditionalSavings)}</strong> tasarruf potansiyeli bulunmaktadır.`
            : `Tüm yüksek tutarlı alımlarda çoklu teklif (TDF) ve hedef birim fiyat disiplini korunmaktadır.`,
        footerHtml: biggestDealByVol
          ? `En Büyük Sözleşme: <strong>${formatRuble(biggestDealByVol.agreedPrice)}</strong> (${biggestDealByVol.jobsiteName})`
          : `Hedef Aksiyon: <strong>1M+ ₽ Alımlarda TDF Zorunluluğu</strong>`
      }
    ];
  }, [kpis, jobsiteBudgetBreakdown, supervisorLeaderboard, categoryBreakdown, recordDeals, topStrategicBenchmarks]);

  // 9. HTML Rapor Şablonu Oluşturucu (Ekran ve PDF A4 Baskısına Tam Uyumlu)
  const generateExecutiveHtml = (autoPrint = false): string => {
    const monthTitle = formatMonthTitle(selectedMonth);
    const currentDate = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    const totalGolAll = supervisorLeaderboard.reduce((acc, s) => acc + s.golCount, 0);
    const totalAsistAll = supervisorLeaderboard.reduce((acc, s) => acc + s.asistCount, 0);
    const totalRoundsAll = supervisorLeaderboard.reduce((acc, s) => acc + s.totalNegotiationRounds, 0);
    const totalNewVendorsAll = supervisorLeaderboard.reduce((acc, s) => acc + s.newVendorsCount, 0);
    const top5Sites = jobsiteBudgetBreakdown.filter(j => j.monthlyInvoiceSpend > 0 || j.totalDiscount > 0).slice(0, 5);
    const top5Sups = supervisorLeaderboard.filter(s => s.totalDiscount > 0 || s.totalAgreed > 0).slice(0, 5);
    const maxSiteDiscount = Math.max(1, ...top5Sites.map(s => s.totalDiscount));
    const maxSupDiscount = Math.max(1, ...top5Sups.map(s => s.totalDiscount));

    return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GES Construction — Aylık Yönetici Satınalma & Tasarruf İcra Raporu (${monthTitle})</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

    :root {
      --primary: #0f172a;
      --secondary: #1e293b;
      --accent: #2563eb;
      --emerald: #059669;
      --amber: #d97706;
      --rose: #e11d48;
      --purple: #7c3aed;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border: #cbd5e1;
      --border-light: #e2e8f0;
      --bg-light: #f1f5f9;
      --card-bg: #ffffff;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: var(--text-main);
      background-color: var(--bg-light);
      line-height: 1.5;
      padding: 24px 16px 48px;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      width: 100%;
      max-width: 1220px;
      margin: 0 auto;
      transition: max-width 0.25s ease;
    }

    .container.compact-mode {
      max-width: 900px;
    }

    /* Floating Action Toolbar for Screen */
    .action-bar {
      position: sticky;
      top: 12px;
      z-index: 100;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 14px;
      padding: 12px 20px;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #ffffff;
      box-shadow: 0 12px 30px -5px rgba(15, 23, 42, 0.35);
      flex-wrap: wrap;
      gap: 12px;
    }
    .action-info {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .action-badge {
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      color: #fff;
      font-weight: 800;
      font-size: 10.5px;
      padding: 4px 10px;
      border-radius: 6px;
      letter-spacing: 0.06em;
    }
    .action-nav {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .nav-pill {
      color: #cbd5e1;
      text-decoration: none;
      font-size: 11.5px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.15s;
    }
    .nav-pill:hover {
      background: rgba(37, 99, 235, 0.35);
      color: #ffffff;
      border-color: rgba(96, 165, 250, 0.4);
    }
    .action-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-print {
      background: linear-gradient(135deg, #059669, #047857);
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(5, 150, 105, 0.3);
    }
    .btn-print:hover { background: #047857; }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #475569;
      padding: 8px 14px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-secondary:hover { background: #334155; }

    /* Executive Header Banner */
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 65%, #0f172a 100%);
      color: white;
      padding: 28px 32px;
      border-radius: 16px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.18);
      border-bottom: 4px solid #2563eb;
      gap: 20px;
    }
    .header-left h1 {
      font-size: 21px;
      font-weight: 900;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
      color: #ffffff;
    }
    .header-left p {
      color: #cbd5e1;
      font-size: 12.5px;
    }
    .header-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .meta-chip {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #e2e8f0;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .header .badge {
      background: rgba(37, 99, 235, 0.22);
      border: 1px solid rgba(147, 197, 253, 0.4);
      color: #bfdbfe;
      padding: 12px 18px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 800;
      text-align: right;
      line-height: 1.45;
      flex-shrink: 0;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 22px;
    }
    .kpi-card {
      background: var(--card-bg);
      padding: 18px 20px;
      border-radius: 14px;
      border: 1px solid var(--border-light);
      box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: #cbd5e1;
    }
    .kpi-card.highlight::before { background: var(--emerald); }
    .kpi-card.blue::before { background: var(--accent); }
    .kpi-card.amber::before { background: var(--amber); }
    .kpi-card.indigo::before { background: #6366f1; }

    .kpi-label {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .kpi-value {
      font-size: 22px;
      font-weight: 900;
      color: var(--primary);
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
    }
    .kpi-value.emerald { color: var(--emerald); }
    .kpi-subtext {
      font-size: 11.5px;
      color: var(--text-muted);
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #f1f5f9;
      padding-top: 6px;
    }

    /* Section Cards */
    .section {
      background: var(--card-bg);
      border-radius: 14px;
      border: 1px solid var(--border-light);
      padding: 22px 24px;
      margin-bottom: 22px;
      box-shadow: 0 3px 12px rgba(15, 23, 42, 0.03);
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 16px;
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 12px;
      gap: 12px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 800;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.01em;
    }
    .section-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 3px;
    }

    /* Executive 6-Card Deck */
    .deck-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    @media (max-width: 960px) {
      .deck-grid { grid-template-columns: repeat(2, 1fr); }
      .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .deck-item {
      background: #f8fafc;
      border-left: 4px solid var(--accent);
      padding: 15px 16px;
      border-radius: 0 10px 10px 0;
      border-top: 1px solid var(--border-light);
      border-right: 1px solid var(--border-light);
      border-bottom: 1px solid var(--border-light);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .deck-item.emerald { border-left-color: var(--emerald); }
    .deck-item.blue { border-left-color: var(--accent); }
    .deck-item.indigo { border-left-color: #6366f1; }
    .deck-item.amber { border-left-color: var(--amber); }
    .deck-item.purple { border-left-color: var(--purple); }
    .deck-item.rose { border-left-color: var(--rose); }
    .deck-item h4 {
      font-size: 12.5px;
      font-weight: 800;
      margin-bottom: 6px;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .deck-item p {
      font-size: 12px;
      color: #334155;
      line-height: 1.55;
    }
    .deck-footer {
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #cbd5e1;
      font-size: 11px;
      color: #475569;
    }

    /* Visual Comparison Grid */
    .visual-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 18px;
      margin-bottom: 22px;
    }
    .bar-row {
      margin-bottom: 11px;
    }
    .bar-row:last-child { margin-bottom: 0; }
    .bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .bar-track {
      width: 100%;
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
    }
    .bar-fill.emerald { background: linear-gradient(90deg, #10b981, #059669); }
    .bar-fill.blue { background: linear-gradient(90deg, #3b82f6, #2563eb); }

    /* Table Styling */
    .table-container {
      width: 100%;
      overflow-x: auto;
      border-radius: 10px;
      border: 1px solid var(--border-light);
    }
    table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 800;
      padding: 10px 12px;
      border-bottom: 2px solid var(--border);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-light);
      color: #334155;
      vertical-align: middle;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    tbody tr:nth-child(even) td { background-color: #f8fafc; }
    tbody tr:hover td { background-color: #eff6ff; }
    tfoot td {
      background: #0f172a !important;
      color: #ffffff !important;
      font-weight: 800;
      padding: 11px 12px;
      border-top: 2px solid #0f172a;
      font-size: 12px;
    }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

    .mini-bar-wrap {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }
    .mini-bar {
      width: 44px;
      height: 5px;
      background: #e2e8f0;
      border-radius: 99px;
      overflow: hidden;
      display: inline-block;
    }
    .mini-bar-inner {
      height: 100%;
      background: #2563eb;
      border-radius: 99px;
    }

    .tag {
      display: inline-block;
      padding: 2.5px 8px;
      border-radius: 5px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .tag-emerald { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .tag-blue { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
    .tag-amber { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .tag-purple { background: #ede9fe; color: #5b21b6; border: 1px solid #ddd6fe; }
    .tag-slate { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }

    /* Signatures Block */
    .signatures {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 2px dashed var(--border);
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .sig-box {
      text-align: center;
    }
    .sig-line {
      height: 44px;
      border-bottom: 1.5px solid #64748b;
      margin-bottom: 8px;
    }
    .sig-role {
      font-size: 12.5px;
      font-weight: 800;
      color: var(--primary);
    }
    .sig-name {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Print / PDF Media Rules */
    @page {
      size: A4 portrait;
      margin: 8mm 6mm;
    }
    @media print {
      body {
        padding: 0 !important;
        background: white !important;
        color: #0f172a !important;
        font-size: 8.5pt !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .no-print {
        display: none !important;
      }
      .container {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .header {
        border-radius: 6px !important;
        padding: 14px 18px !important;
        margin-bottom: 10px !important;
        background: #0f172a !important;
      }
      .header-left h1 {
        font-size: 14pt !important;
      }
      .kpi-grid {
        grid-template-columns: repeat(4, 1fr) !important;
        gap: 6px !important;
        margin-bottom: 10px !important;
      }
      .kpi-card {
        padding: 8px 10px !important;
        border: 1px solid #cbd5e1 !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .kpi-value {
        font-size: 14pt !important;
      }
      .section {
        padding: 12px 14px !important;
        margin-bottom: 10px !important;
        border: 1px solid #cbd5e1 !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .section-title {
        font-size: 10.5pt !important;
      }
      .deck-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 6px !important;
      }
      .deck-item {
        padding: 8px 10px !important;
      }
      .visual-grid {
        grid-template-columns: repeat(2, 1fr) !important;
        gap: 8px !important;
        margin-bottom: 10px !important;
      }
      .table-container {
        overflow: visible !important;
        border: 1px solid #cbd5e1 !important;
      }
      table {
        width: 100% !important;
        table-layout: fixed !important;
        font-size: 7.5pt !important;
      }
      th {
        padding: 4px 5px !important;
        font-size: 7pt !important;
        background: #f1f5f9 !important;
      }
      td, tfoot td {
        padding: 4px 5px !important;
        font-size: 7.5pt !important;
        word-wrap: break-word !important;
      }
      tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .signatures {
        margin-top: 14px !important;
        padding-top: 12px !important;
      }
    }
  </style>
</head>
<body>
  <div class="container" id="reportContainer">

    <!-- FLOATING EXECUTIVE TOOLBAR (Hidden in Print / PDF) -->
    <div class="no-print action-bar">
      <div class="action-info">
        <span class="action-badge">GES EXECUTIVE REPORT</span>
        <span>Yönetici Satınalma & Tasarruf İcra Raporu (<strong>${monthTitle}</strong>)</span>
      </div>
      <div class="action-nav">
        <a href="#sec-summary" class="nav-pill">📌 İcra Özeti</a>
        <a href="#sec-categories" class="nav-pill">📊 Kategoriler</a>
        <a href="#sec-supervisors" class="nav-pill">🏆 Şef Karnesi</a>
        <a href="#sec-jobsites" class="nav-pill">🏗️ Şantiyeler</a>
        <a href="#sec-records" class="nav-pill">⚡ Rekor İskontolar</a>
        <a href="#sec-materials" class="nav-pill">📐 Kritik Malzemeler</a>
      </div>
      <div class="action-buttons">
        <button onclick="window.print()" class="btn-print">
          🖨️ PDF Olarak Kaydet / Yazdır (A4)
        </button>
        <button onclick="toggleFitMode()" class="btn-secondary" id="fitToggleBtn">
          🔍 A4 Kompakt Görünüm
        </button>
      </div>
    </div>

    <!-- 0. Header -->
    <div class="header">
      <div class="header-left">
        <h1>GES CONSTRUCTION — YÖNETİCİ SATINALMA & TASARRUF İCRA RAPORU</h1>
        <p>Kurumsal Mali Denetim, İndirim Müzakereleri ve Birim Fiyat Kıyaslama İcmali</p>
        <div class="header-meta">
          <span class="meta-chip">📅 Dönem: ${monthTitle}</span>
          <span class="meta-chip">🏢 Aktif Şantiye: ${kpis.activeProjectsCount} Proje</span>
          <span class="meta-chip">🤝 Aktif Tedarikçi: ${kpis.activeVendorsCount} Firma</span>
          <span class="meta-chip">🕒 Rapor Tarihi: ${currentDate}</span>
        </div>
      </div>
      <div class="badge">
        YÖNETİM KURULU İCRA SUNUMU<br>
        <span style="font-size: 11px; opacity: 0.9; font-weight: 600;">GES Platformu Onaylı Satınalma Verileri</span>
      </div>
    </div>

    <!-- 1. KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card highlight">
        <div class="kpi-label">Sağlanan Toplam Nakit Tasarruf</div>
        <div class="kpi-value emerald">+${formatRuble(kpis.totalDiscount)}</div>
        <div class="kpi-subtext">
          <span>İlk Teklif Üzerinden Oran:</span>
          <strong style="color: var(--emerald);">%${kpis.savingsPct.toFixed(1)}</strong>
        </div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">Pazarlığa Konu Alım Tutarı</div>
        <div class="kpi-value">${formatRuble(kpis.totalAgreed)}</div>
        <div class="kpi-subtext">
          <span>İlk Teklif Toplamı:</span>
          <strong>${formatRuble(kpis.totalOffer)}</strong>
        </div>
      </div>
      <div class="kpi-card indigo">
        <div class="kpi-label">Toplam Satınalma Hacmi (GES)</div>
        <div class="kpi-value">${formatRuble(kpis.totalInvoiceSpend)}</div>
        <div class="kpi-subtext">
          <span>Pazarlık Kapsama Oranı:</span>
          <strong style="color: #4f46e5;">%${kpis.negotiationCoveragePct.toFixed(1)}</strong>
        </div>
      </div>
      <div class="kpi-card amber">
        <div class="kpi-label">İcra & Müzakere Yoğunluğu</div>
        <div class="kpi-value">${kpis.transactionCount} İşlem</div>
        <div class="kpi-subtext">
          <span>İşlem Başına Tasarruf:</span>
          <strong style="color: var(--amber);">${formatRuble(kpis.avgDiscountPerTx)}</strong>
        </div>
      </div>
    </div>

    <!-- 2. Yönetici İcra Özeti & Stratejik Bulgular (6 Dinamik Analitik Kart) -->
    <div class="section" id="sec-summary">
      <div class="section-header">
        <div>
          <div class="section-title">📌 Yönetici İcra Özeti & Temel Denetim Bulguları</div>
          <div class="section-desc">${monthTitle} dönemi satınalma müzakereleri, şantiye harcama dağılımı ve birim maliyet analizinden üretilen karar destek bulguları</div>
        </div>
        <span class="tag tag-blue">Canlı Veri Analizi</span>
      </div>
      <div class="deck-grid">
        ${executiveInsights.map(card => `
          <div class="deck-item ${card.color}">
            <div>
              <h4>${card.badge}</h4>
              <p>${card.summaryHtml}</p>
            </div>
            <div class="deck-footer">${card.footerHtml}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 2.5 Görsel Performans Özeti (Top Şantiyeler & Lider Şefler Karşılaştırma Grafiği) -->
    <div class="visual-grid">
      <div class="section" style="margin-bottom: 0;">
        <div class="section-header" style="margin-bottom: 12px; padding-bottom: 8px;">
          <div>
            <div class="section-title" style="font-size: 14px;">🏗️ Şantiye Tasarruf Performansı (İlk 5 Proje)</div>
            <div class="section-desc">Projelerin toplam nakit tasarrufuna katkısı ve alım hacmi</div>
          </div>
        </div>
        ${top5Sites.map(j => {
          const widthPct = Math.max(6, Math.min(100, (j.totalDiscount / maxSiteDiscount) * 100));
          return `
            <div class="bar-row">
              <div class="bar-labels">
                <span><strong>${j.jobsiteName}</strong> <span style="color:#64748b; font-size:11px;">(Harcama: ${formatRuble(j.monthlyInvoiceSpend)})</span></span>
                <strong style="color: var(--emerald);">+${formatRuble(j.totalDiscount)} (%${j.savingsPercentage.toFixed(1)})</strong>
              </div>
              <div class="bar-track">
                <div class="bar-fill emerald" style="width: ${widthPct}%;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="section" style="margin-bottom: 0;">
        <div class="section-header" style="margin-bottom: 12px; padding-bottom: 8px;">
          <div>
            <div class="section-title" style="font-size: 14px;">🏆 Satınalma Şefleri Tasarruf Katkısı</div>
            <div class="section-desc">Şeflerin yönettiği alım hacmi ve kazandırdıkları net indirim</div>
          </div>
        </div>
        ${top5Sups.map(s => {
          const widthPct = Math.max(6, Math.min(100, (s.totalDiscount / maxSupDiscount) * 100));
          return `
            <div class="bar-row">
              <div class="bar-labels">
                <span><strong>#${s.rank} ${s.supervisorName}</strong> <span style="color:#64748b; font-size:11px;">(${s.transactionCount} işlem | ⚽${s.golCount}/👟${s.asistCount})</span></span>
                <strong style="color: var(--accent);">+${formatRuble(s.totalDiscount)} (%${s.savingsPercentage.toFixed(1)})</strong>
              </div>
              <div class="bar-track">
                <div class="bar-fill blue" style="width: ${widthPct}%;"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- 3. Kategori Bazlı Harcama Dağılımı -->
    <div class="section" id="sec-categories">
      <div class="section-header">
        <div>
          <div class="section-title">📊 Kategori Bazlı Harcama ve Tasarruf Dağılımı</div>
          <div class="section-desc">Satınalma işlemlerinin malzeme/hizmet gruplarına göre alım tutarı, sağlanan indirim ve bütçe payı</div>
        </div>
        <span class="tag tag-blue">${categoryBreakdown.length} Kategori</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 24%;">Kategori Adı</th>
              <th class="num" style="width: 16%;">İlk Teklif (₽)</th>
              <th class="num" style="width: 16%;">Anlaşılan Alım (₽)</th>
              <th class="num" style="width: 15%;">Sağlanan Tasarruf (₽)</th>
              <th class="num" style="width: 10%;">Tasarruf %</th>
              <th class="num" style="width: 11%;">Harcama Payı</th>
              <th class="num" style="width: 8%;">İşlem</th>
            </tr>
          </thead>
          <tbody>
            ${categoryBreakdown.map(c => `
              <tr>
                <td>
                  <strong>${c.category}</strong>
                  ${c.topMaterial && c.topMaterial !== '-' ? `<div style="font-size: 10.5px; color: #64748b; margin-top: 2px;">Öne Çıkan: ${c.topMaterial}</div>` : ''}
                </td>
                <td class="num" style="color: #64748b;">${formatRuble(c.totalOffer)}</td>
                <td class="num"><strong>${formatRuble(c.totalAgreed)}</strong></td>
                <td class="num" style="color: var(--emerald); font-weight: 800;">+${formatRuble(c.totalDiscount)}</td>
                <td class="num"><span class="tag tag-emerald">%${c.savingsPercentage.toFixed(1)}</span></td>
                <td class="num">
                  <div class="mini-bar-wrap">
                    <span>%${c.shareOfSpend.toFixed(1)}</span>
                    <span class="mini-bar"><span class="mini-bar-inner" style="width: ${Math.min(100, Math.max(4, c.shareOfSpend))}%;"></span></span>
                  </div>
                </td>
                <td class="num">${c.transactionCount}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>GENEL TOPLAM (${categoryBreakdown.length} Kategori)</td>
              <td class="num">${formatRuble(kpis.totalOffer)}</td>
              <td class="num">${formatRuble(kpis.totalAgreed)}</td>
              <td class="num" style="color: #6ee7b7 !important;">+${formatRuble(kpis.totalDiscount)}</td>
              <td class="num">%${kpis.savingsPct.toFixed(1)}</td>
              <td class="num">%100.0</td>
              <td class="num">${kpis.transactionCount}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 4. Şefler Arası Rekabet Sıralaması -->
    <div class="section" id="sec-supervisors">
      <div class="section-header">
        <div>
          <div class="section-title">🏆 Satınalma Şefleri Tasarruf & Rekabet Sıralaması (İcra Karnesi)</div>
          <div class="section-desc">Satınalma şeflerinin yönettiği sözleşme hacmi, elde ettikleri nakit tasarruf, müzakere tur derinliği ve uzman ekip asist katkıları</div>
        </div>
        <span class="tag tag-amber">${supervisorLeaderboard.length} Satınalma Şefi</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 22%;">Sıra & Satınalma Şefi</th>
              <th class="num" style="width: 15%;">Yönetilen Alım (₽)</th>
              <th class="num" style="width: 15%;">Sağlanan Tasarruf (₽)</th>
              <th class="num" style="width: 10%;">İndirim Oranı</th>
              <th class="num" style="width: 10%;">Doğrudan / Uzman</th>
              <th class="num" style="width: 9%;">Müzakere Turu</th>
              <th class="num" style="width: 7%;">Yeni Firma</th>
              <th style="width: 12%;">Uzman Ekip Katkısı</th>
            </tr>
          </thead>
          <tbody>
            ${supervisorLeaderboard.map((s, idx) => `
              <tr>
                <td>
                  <span class="tag ${idx === 0 ? 'tag-amber' : idx === 1 ? 'tag-blue' : s.totalDiscount > 0 ? 'tag-emerald' : 'tag-slate'}">#${s.rank}</span>
                  <strong>${s.supervisorName}</strong>
                  <span style="font-size: 10.5px; color: #64748b; margin-left: 4px;">(${s.transactionCount} işlem)</span>
                </td>
                <td class="num">${formatRuble(s.totalAgreed)}</td>
                <td class="num" style="color: ${s.totalDiscount > 0 ? 'var(--emerald)' : '#64748b'}; font-weight: 800;">
                  ${s.totalDiscount > 0 ? '+' : ''}${formatRuble(s.totalDiscount)}
                </td>
                <td class="num"><span class="tag ${s.savingsPercentage > 0 ? 'tag-emerald' : 'tag-slate'}">%${s.savingsPercentage.toFixed(1)}</span></td>
                <td class="num">${s.golCount} Şef / ${s.asistCount} Uzman</td>
                <td class="num">${s.totalNegotiationRounds} tur</td>
                <td class="num">${s.newVendorsCount > 0 ? `+${s.newVendorsCount}` : '-'}</td>
                <td>
                  ${s.assistants.length > 0
                    ? s.assistants.map(a => `<span style="font-size: 11px;"><strong>${a.name}</strong> (${formatRuble(a.discountAmount)})</span>`).join(', ')
                    : (s.transactionCount > 0 ? '<span style="color: #64748b; font-size: 11px;">Doğrudan İcra</span>' : '<span style="color: #94a3b8; font-size: 11px;">Dönem İçi İşlem Yok</span>')
                  }
                </td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>TOPLAM İCRA KARNESİ</td>
              <td class="num">${formatRuble(kpis.totalAgreed)}</td>
              <td class="num" style="color: #6ee7b7 !important;">+${formatRuble(kpis.totalDiscount)}</td>
              <td class="num">%${kpis.savingsPct.toFixed(1)}</td>
              <td class="num">${totalGolAll} Şef / ${totalAsistAll} Uzman</td>
              <td class="num">${totalRoundsAll} tur</td>
              <td class="num">+${totalNewVendorsAll}</td>
              <td>Tüm Ekip Toplamı</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 5. Şantiye Bütçe Kullanım Durumu -->
    <div class="section" id="sec-jobsites">
      <div class="section-header">
        <div>
          <div class="section-title">🏗️ Şantiye Bütçe Kullanım ve Harcama Durumu (Proje İcmali)</div>
          <div class="section-desc">Aktif projelerin dönem içi satınalma hacimleri, pazarlıklı sözleşme tutarları, elde edilen tasarruf ve ağırlıklı kategorileri</div>
        </div>
        <span class="tag tag-purple">${jobsiteBudgetBreakdown.length} Şantiye</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 20%;">Şantiye Adı / Kodu</th>
              <th class="num" style="width: 14%;">Dönem Alım Hacmi (₽)</th>
              <th class="num" style="width: 14%;">Pazarlıklı Alım (₽)</th>
              <th class="num" style="width: 14%;">Sağlanan Tasarruf (₽)</th>
              <th class="num" style="width: 10%;">Tasarruf Oranı</th>
              <th class="num" style="width: 8%;">Harcama Payı</th>
              <th style="width: 10%;">Lider Şef</th>
              <th style="width: 10%;">Ağırlıklı Kategori</th>
            </tr>
          </thead>
          <tbody>
            ${jobsiteBudgetBreakdown.map(j => `
              <tr>
                <td>
                  <strong>${j.jobsiteName}</strong>
                  ${j.code && j.code !== '-' ? `<span style="font-size: 11px; color: #64748b; margin-left: 4px;">(${j.code})</span>` : ''}
                </td>
                <td class="num">${formatRuble(j.monthlyInvoiceSpend)}</td>
                <td class="num">${formatRuble(j.monthlyDiscountedSpend)}</td>
                <td class="num" style="color: ${j.totalDiscount > 0 ? 'var(--emerald)' : '#64748b'}; font-weight: 800;">
                  ${j.totalDiscount > 0 ? '+' : ''}${formatRuble(j.totalDiscount)}
                </td>
                <td class="num"><span class="tag ${j.savingsPercentage > 0 ? 'tag-emerald' : 'tag-slate'}">%${j.savingsPercentage.toFixed(1)}</span></td>
                <td class="num">%${j.shareOfSpend.toFixed(1)}</td>
                <td><strong>${j.topSupervisor}</strong></td>
                <td><span style="font-size: 11px; color: #64748b;">${j.topCategory}</span></td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>ŞİRKET GENEL TOPLAMI</td>
              <td class="num">${formatRuble(kpis.totalInvoiceSpend)}</td>
              <td class="num">${formatRuble(kpis.totalAgreed)}</td>
              <td class="num" style="color: #6ee7b7 !important;">+${formatRuble(kpis.totalDiscount)}</td>
              <td class="num">%${kpis.savingsPct.toFixed(1)}</td>
              <td class="num">%100.0</td>
              <td colspan="2">Tüm Projeler Konsolide</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- 6. En Yüksek İskonto Oranlı Alımlar -->
    <div class="section" id="sec-records">
      <div class="section-header">
        <div>
          <div class="section-title">⚡ En Yüksek İskonto Oranlı Alımlar (Rekor Müzakereler)</div>
          <div class="section-desc">Tedarikçi ilk teklifine kıyasla masada en yüksek yüzdeyle indirim sağlanan stratejik satınalmalar</div>
        </div>
        <span class="tag tag-amber">Top ${recordDeals.topByPercentage.length} Rekor Müzakere</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 26%;">Malzeme / Alım Açıklaması</th>
              <th style="width: 13%;">Şantiye</th>
              <th style="width: 14%;">Tedarikçi Firma</th>
              <th style="width: 11%;">Sorumlu Şef</th>
              <th class="num" style="width: 10%;">İlk Teklif (₽)</th>
              <th class="num" style="width: 10%;">Anlaşılan (₽)</th>
              <th class="num" style="width: 10%;">Tasarruf Tutarı (₽)</th>
              <th class="num" style="width: 6%;">İndirim %</th>
            </tr>
          </thead>
          <tbody>
            ${recordDeals.topByPercentage.map(d => `
              <tr>
                <td><strong>${d.materialName}</strong></td>
                <td>${d.jobsiteName}</td>
                <td>${d.vendorName}</td>
                <td><strong style="color: var(--accent);">${d.supervisorName}</strong></td>
                <td class="num">${formatRuble(d.offerPrice)}</td>
                <td class="num">${formatRuble(d.agreedPrice)}</td>
                <td class="num" style="color: var(--emerald); font-weight: 800;">+${formatRuble(d.discountAmount)}</td>
                <td class="num"><span class="tag tag-emerald">%${d.discountPercentage.toFixed(1)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- 7. Büyük Hacimli & Stratejik Alımlar (Demir, Beton, Sac vb.) -->
    <div class="section">
      <div class="section-header">
        <div>
          <div class="section-title">🏗️ Büyük Hacimli & Stratejik Alımlar (Ağır Bütçe Kalemleri)</div>
          <div class="section-desc">Sözleşme büyüklüğüyle şirket bütçesinde en yüksek paya sahip mega satınalmalar</div>
        </div>
        <span class="tag tag-blue">Top ${recordDeals.topByVolume.length} Büyük Sözleşme</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 28%;">Malzeme / Sipariş Kalemi</th>
              <th style="width: 14%;">Şantiye</th>
              <th style="width: 14%;">Tedarikçi Firma</th>
              <th style="width: 12%;">Sorumlu Şef</th>
              <th class="num" style="width: 12%;">Anlaşılan Tutar (₽)</th>
              <th class="num" style="width: 11%;">Tasarruf Tutarı (₽)</th>
              <th class="num" style="width: 9%;">Tarih</th>
            </tr>
          </thead>
          <tbody>
            ${recordDeals.topByVolume.map(d => `
              <tr>
                <td><strong>${d.materialName}</strong></td>
                <td>${d.jobsiteName}</td>
                <td>${d.vendorName}</td>
                <td><strong style="color: var(--accent);">${d.supervisorName}</strong></td>
                <td class="num" style="font-weight: 800;">${formatRuble(d.agreedPrice)}</td>
                <td class="num" style="color: var(--emerald); font-weight: 800;">+${formatRuble(d.discountAmount)}</td>
                <td class="num">${d.date}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- 8. Seçili Kritik Malzemeler -->
    <div class="section" id="sec-materials">
      <div class="section-header">
        <div>
          <div class="section-title">📐 Seçili Kritik Malzemeler: Ortalama Alım vs. İlk Teklif Birim Fiyatları</div>
          <div class="section-desc">İnşaat demiri, gazbeton blok, yalıtım, beton ve şirket bütçesinde en yüksek yer tutan stratejik ana inşaat girdilerinde birim maliyet kıyaslaması</div>
        </div>
        <span class="tag tag-emerald">${topStrategicBenchmarks.length} Stratejik Ağır Kalem</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 25%;">Malzeme Tanımı</th>
              <th style="width: 14%;">Stratejik Grup</th>
              <th style="width: 6%;">Birim</th>
              <th class="num" style="width: 8%;">Toplam Miktar</th>
              <th class="num" style="width: 10%;">Ort. İlk Teklif (₽)</th>
              <th class="num" style="width: 10%;">Anlaşılan Birim (₽)</th>
              <th class="num" style="width: 9%;">Birim Tasarruf (₽)</th>
              <th class="num" style="width: 10%;">Toplam Tasarruf (₽)</th>
              <th class="num" style="width: 8%;">Tasarruf %</th>
            </tr>
          </thead>
          <tbody>
            ${topStrategicBenchmarks.map(m => `
              <tr>
                <td><strong>${m.materialName}</strong></td>
                <td>
                  <span class="tag ${
                    m.group === 'DEMIR' ? 'tag-blue' :
                    m.group === 'GAZBLOK' ? 'tag-purple' :
                    m.group === 'IZOLASYON' ? 'tag-amber' :
                    m.group === 'BETON' ? 'tag-emerald' : 'tag-slate'
                  }">
                    ${m.groupLabel}
                  </span>
                </td>
                <td>${m.unit}</td>
                <td class="num">${m.totalQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</td>
                <td class="num">${formatRuble(m.avgOfferUnitPrice)}</td>
                <td class="num" style="font-weight: 800;">${formatRuble(m.avgAgreedUnitPrice)}</td>
                <td class="num" style="color: var(--emerald);">${formatRuble(m.unitSavings)}</td>
                <td class="num" style="color: var(--emerald); font-weight: 800;">+${formatRuble(m.totalSavings)}</td>
                <td class="num"><span class="tag tag-emerald">%${m.savingsPercentage.toFixed(1)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${sameBrandPriceAlerts.length > 0 ? `
    <!-- 8.5. Aynı Marka & Özellik Fiyat Farkı Uyarıları -->
    <div class="section" id="sec-price-alerts">
      <div class="section-header">
        <div>
          <div class="section-title">⚠️ Aynı Marka & Teknik Özellik Fiyat Farkı Uyarıları (Birebir Elma-Elma Kıyaslama)</div>
          <div class="section-desc">Aynı malzeme, aynı teknik ebat ve aynı marka/seri olmasına rağmen farklı birim fiyatlarla alınan kalemler ve oluşan fiyat farkı</div>
        </div>
        <span class="tag tag-amber">${sameBrandPriceAlerts.length} Fiyat Sapması Uyarısı</span>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 28%;">Malzeme & Marka / Seri</th>
              <th style="width: 7%;">Birim</th>
              <th class="num" style="width: 11%;">En Düşük Birim (₽)</th>
              <th style="width: 15%;">En Uygun Şantiye / Firma</th>
              <th class="num" style="width: 11%;">En Yüksek Birim (₽)</th>
              <th style="width: 15%;">En Pahalı Şantiye / Firma</th>
              <th class="num" style="width: 6%;">Fark %</th>
              <th class="num" style="width: 7%;">Fark Etkisi (₽)</th>
            </tr>
          </thead>
          <tbody>
            ${sameBrandPriceAlerts.map(a => `
              <tr>
                <td><strong>${a.materialName}</strong></td>
                <td>${a.unit}</td>
                <td class="num" style="color: var(--emerald); font-weight: 700;">${formatRuble(a.minPrice)}</td>
                <td><span style="font-size: 10.5px;"><strong>${a.cheapestSite}</strong> (${a.cheapestVendor})</span></td>
                <td class="num" style="color: var(--rose); font-weight: 800;">${formatRuble(a.maxPrice)}</td>
                <td><span style="font-size: 10.5px;"><strong>${a.priciestSite}</strong> (${a.priciestVendor})</span></td>
                <td class="num"><span class="tag tag-amber">+%${a.diffPct.toFixed(1)}</span></td>
                <td class="num" style="color: var(--rose); font-weight: 700;">${formatRuble(a.excessSpend)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    <!-- 9. İmza ve Onay Bölümü -->
    <div class="signatures">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">Satınalma Direktörü</div>
        <div class="sig-name">GES Construction Procurement Head</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">Mali İşler Direktörü (CFO)</div>
        <div class="sig-name">Financial Audit & Internal Control</div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-role">Genel Müdür (CEO / Yönetim Kurulu)</div>
        <div class="sig-name">Executive Board Approval</div>
      </div>
    </div>

  </div>

  <script>
    function toggleFitMode() {
      var c = document.getElementById('reportContainer');
      var b = document.getElementById('fitToggleBtn');
      if (c.classList.contains('compact-mode')) {
        c.classList.remove('compact-mode');
        b.innerText = '🔍 A4 Kompakt Görünüme Geç';
      } else {
        c.classList.add('compact-mode');
        b.innerText = '🔍 Geniş Ekrana Sığdır';
      }
    }

    ${autoPrint ? 'window.addEventListener("load", function() { setTimeout(function() { window.print(); }, 400); });' : ''}
  </script>
</body>
</html>`;
  };

  // HTML İndirme İşlemi
  const handleExportHtml = () => {
    const htmlContent = generateExecutiveHtml(false);
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GES_Aylik_Yonetici_Raporu_${selectedMonth}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // PDF Olarak İndirme (html2pdf.js ile doğrudan PDF dosya indirme + A4 Baskı desteği)
  const handleExportPdf = async () => {
    try {
      const htmlFull = generateExecutiveHtml(false);
      
      // Temporary container element for PDF rendering
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '800px';
      container.style.backgroundColor = '#ffffff';
      container.style.color = '#0f172a';
      container.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      
      const bodyMatch = htmlFull.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch && bodyMatch[1]) {
        container.innerHTML = bodyMatch[1];
      } else {
        container.innerHTML = htmlFull;
      }

      // Hide no-print elements in the generated PDF
      const noPrintElements = container.querySelectorAll('.no-print');
      noPrintElements.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });

      document.body.appendChild(container);

      const opt = {
        margin: [8, 6, 8, 6],
        filename: `GES_Aylik_Yonetici_Raporu_${selectedMonth}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (typeof (window as any).html2pdf === 'function' || html2pdf) {
        const worker = (html2pdf as any)().set(opt).from(container);
        await worker.save();
      } else {
        window.print();
      }

      document.body.removeChild(container);
    } catch (err) {
      console.error('PDF indirme hatası:', err);
      // Fallback to print
      try {
        window.print();
      } catch (_) {
        handleExportHtml();
      }
    }
  };

  // 10. Çok Sayfalı Excel İndirme
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Genel Yönetici KPI
    const summaryData: any[] = [
      ['GES CONSTRUCTION - AYLIK YÖNETİCİ SATINALMA & TASARRUF İCRA RAPORU'],
      ['Rapor Dönemi:', formatMonthTitle(selectedMonth)],
      ['Rapor Tarihi:', new Date().toLocaleDateString('tr-TR')],
      [],
      ['ÖZET GÖSTERGELER (KPI)', 'TUTAR (₽)', 'ORAN / DETAY'],
      ['Toplam Sağlanan Tasarruf:', Math.round(kpis.totalDiscount), `%${kpis.savingsPct.toFixed(1)}`],
      ['Pazarlığa Konu Alım Tutarı:', Math.round(kpis.totalAgreed), 'İndirimli Faturalar Hacmi'],
      ['Şirket Toplam Fatura Hacmi:', Math.round(kpis.totalInvoiceSpend), 'Tüm Faturalar Toplamı'],
      ['Pazarlık Kapsama Oranı:', `${kpis.negotiationCoveragePct.toFixed(1)}%`, 'Pazarlıklı / Toplam Fatura'],
      ['İlk Liste / Teklif Tutarı:', Math.round(kpis.totalOffer), 'İlk Verilen Fiyatlar'],
      ['Müzakere İşlem Sayısı:', kpis.transactionCount, 'Adet'],
      ['Toplam Fatura Sayısı:', kpis.invoiceCount, 'Adet'],
      ['Aktif Proje / Şantiye Sayısı:', kpis.activeProjectsCount, 'Adet'],
      ['İşlem Başına Ortalama Tasarruf:', Math.round(kpis.avgDiscountPerTx), '₽/İşlem']
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Yonetici_KPI');

    // Sheet 2: Kategori Harcama Dağılımı
    const catData: any[] = [
      ['KATEGORİ BAZLI HARCAMA VE TASARRUF DAĞILIMI'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Kategori Adı', 'Gerçekleşen Alım (₽)', 'İlk Teklif (₽)', 'Sağlanan Tasarruf (₽)', 'Tasarruf Oranı (%)', 'Harcama Payı (%)', 'İşlem Sayısı', 'En Çok Harcanan Malzeme']
    ];
    categoryBreakdown.forEach(c => {
      catData.push([
        c.category,
        Math.round(c.totalAgreed),
        Math.round(c.totalOffer),
        Math.round(c.totalDiscount),
        `%${c.savingsPercentage.toFixed(1)}`,
        `%${c.shareOfSpend.toFixed(1)}`,
        c.transactionCount,
        c.topMaterial
      ]);
    });
    const wsCat = XLSX.utils.aoa_to_sheet(catData);
    XLSX.utils.book_append_sheet(wb, wsCat, 'Kategori_Dagilimi');

    // Sheet 3: Şefler Sıralaması
    const supData: any[] = [
      ['SATINALMA ŞEFLERİ TASARRUF & REKABET SIRALAMASI'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Sıra', 'Şef Adı', 'Yönetilen Alım (₽)', 'Sağlanan Tasarruf (₽)', 'Tasarruf Oranı (%)', 'Tasarruf Payı (%)', 'İşlem Sayısı', 'Gol (Doğrudan)', 'Asist (Ekip)', 'Müzakere Turu', 'Yeni Firma Sayısı', 'Yardımcı Ekip Desteği']
    ];
    supervisorLeaderboard.forEach(s => {
      const assistStr = s.assistants.map(a => `${a.name}: ${Math.round(a.discountAmount)} ₽ (${a.asistCount} asist)`).join(' | ');
      supData.push([
        s.rank,
        s.supervisorName,
        Math.round(s.totalAgreed),
        Math.round(s.totalDiscount),
        `%${s.savingsPercentage.toFixed(1)}`,
        `%${s.shareOfTotalDiscount.toFixed(1)}`,
        s.transactionCount,
        s.golCount,
        s.asistCount,
        s.totalNegotiationRounds,
        s.newVendorsCount,
        assistStr || 'Doğrudan Kapanış'
      ]);
    });
    const wsSup = XLSX.utils.aoa_to_sheet(supData);
    XLSX.utils.book_append_sheet(wb, wsSup, 'Sefler_Siralama');

    // Sheet 4: Şantiye Bütçe Kullanımı
    const siteData: any[] = [
      ['ŞANTİYE BÜTÇE VE HARCAMA DURUMU'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Şantiye Adı', 'Şantiye Kodu', 'Tanımlı Bütçe (₽)', 'Dönem Fatura Hacmi (₽)', 'Pazarlıklı Alım (₽)', 'Tasarruf Tutarı (₽)', 'Tasarruf Oranı (%)', 'Şirket Payı (%)', 'İşlem Adedi', 'Lider Şef', 'Ağırlıklı Kategori']
    ];
    jobsiteBudgetBreakdown.forEach(j => {
      siteData.push([
        j.jobsiteName,
        j.code,
        j.definedBudget > 0 ? Math.round(j.definedBudget) : '-',
        Math.round(j.monthlyInvoiceSpend),
        Math.round(j.monthlyDiscountedSpend),
        Math.round(j.totalDiscount),
        `%${j.savingsPercentage.toFixed(1)}`,
        `%${j.shareOfSpend.toFixed(1)}`,
        j.transactionCount,
        j.topSupervisor,
        j.topCategory
      ]);
    });
    const wsSite = XLSX.utils.aoa_to_sheet(siteData);
    XLSX.utils.book_append_sheet(wb, wsSite, 'Santiye_Butce');

    // Sheet 5: Rekor Pazarlıklar ve Büyük Alımlar
    const dealData: any[] = [
      ['EN YÜKSEK İSKONTO ORANLI ALIMLAR VE BÜYÜK HACİMLİ KALEMLER'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Tür', 'Malzeme / Kalem', 'Şantiye', 'Tedarikçi', 'Sorumlu Şef', 'İlk Teklif (₽)', 'Anlaşılan (₽)', 'Tasarruf (₽)', 'İndirim Oranı (%)', 'Tarih']
    ];
    recordDeals.topByPercentage.forEach(d => {
      dealData.push([
        'Yüksek İskonto',
        d.materialName,
        d.jobsiteName,
        d.vendorName,
        d.supervisorName,
        Math.round(d.offerPrice),
        Math.round(d.agreedPrice),
        Math.round(d.discountAmount),
        `%${d.discountPercentage.toFixed(1)}`,
        d.date
      ]);
    });
    recordDeals.topByVolume.forEach(d => {
      dealData.push([
        'Büyük Hacim',
        d.materialName,
        d.jobsiteName,
        d.vendorName,
        d.supervisorName,
        Math.round(d.offerPrice),
        Math.round(d.agreedPrice),
        Math.round(d.discountAmount),
        `%${d.discountPercentage.toFixed(1)}`,
        d.date
      ]);
    });
    const wsDeal = XLSX.utils.aoa_to_sheet(dealData);
    XLSX.utils.book_append_sheet(wb, wsDeal, 'Rekor_Alimlar');

    // Sheet 6: Seçili Kritik Malzemeler
    const matData: any[] = [
      ['SEÇİLİ KRİTİK MALZEMELER - ORTALAMA ALIM VS İLK TEKLİF'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Malzeme Adı', 'Kategori', 'Birim', 'Miktar', 'İlk Teklif Birim Fiyatı (₽)', 'Anlaşılan Birim Fiyat (₽)', 'Birim Başı Tasarruf (₽)', 'Toplam Tasarruf (₽)', 'Tasarruf Oranı (%)', 'İşlem Sayısı', 'Tedarikçiler']
    ];
    criticalBenchmarks.forEach(m => {
      matData.push([
        m.materialName,
        m.category,
        m.unit,
        Math.round(m.totalQuantity * 10) / 10,
        Math.round(m.avgOfferUnitPrice),
        Math.round(m.avgAgreedUnitPrice),
        Math.round(m.unitSavings),
        Math.round(m.totalSavings),
        `%${m.savingsPercentage.toFixed(1)}`,
        m.sourceTransactionCount,
        m.representativeVendors.join(', ') || '-'
      ]);
    });
    const wsMat = XLSX.utils.aoa_to_sheet(matData);
    XLSX.utils.book_append_sheet(wb, wsMat, 'Kritik_Malzemeler');

    XLSX.writeFile(wb, `GES_Yonetici_Raporu_${selectedMonth}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-1.5 sm:p-3 md:p-4 overflow-hidden animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800/80 w-full max-w-[99vw] xl:max-w-[1560px] h-[95vh] max-h-[96vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* MODAL HEADER */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 ring-1 ring-blue-400/30">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
                  {isRu ? 'Ежемесячный отчет руководства по закупкам' : 'Aylık Yönetici Satınalma & Tasarruf İcra Raporu'}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {isRu ? 'Официальный аудит' : 'Mali İcra Denetimi'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {isRu
                  ? 'Консолидированные KPI, категории, рейтинг руководителей и бенчмарк материалов'
                  : 'Konsolide KPI, Kategori Harcamaları, Şefler Rekabeti, Şantiye Bütçeleri ve Kritik Malzemeler'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Month Selector */}
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="appearance-none bg-slate-800/90 text-white font-medium text-xs rounded-xl pl-8 pr-8 py-2.5 border border-slate-700 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-inner transition-colors"
              >
                {availableMonths.map(m => (
                  <option key={m} value={m} className="bg-slate-900 text-white">
                    {formatMonthTitle(m)}
                  </option>
                ))}
                <option value="ALL" className="bg-slate-900 text-white">
                  {isRu ? 'Все периоды (Итого)' : 'Tüm Dönemler (Kümülatif)'}
                </option>
              </select>
              <Calendar className="w-3.5 h-3.5 text-blue-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Export HTML Button */}
            <button
              onClick={handleExportHtml}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
              title={isRu ? 'Скачать отчет HTML (печать/веб)' : 'Yönetici Raporunu İndir (HTML Web / Baskı)'}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isRu ? 'HTML' : 'HTML İndir'}</span>
            </button>

            {/* Export PDF Button */}
            <button
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white text-xs font-semibold shadow-md shadow-red-500/20 transition-all hover:scale-105 active:scale-95"
              title={isRu ? 'Скачать отчет PDF / Печать A4' : 'Yönetici Raporunu PDF Olarak İndir / Yazdır'}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isRu ? 'PDF İndir' : 'PDF İndir'}</span>
            </button>

            {/* Export Excel Button */}
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
              title={isRu ? 'Экспорт в Excel' : 'Excel İndir'}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Excel</span>
            </button>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="px-5 sm:px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0">
          <button
            onClick={() => setActiveTab('OVERVIEW')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'OVERVIEW'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isRu ? 'Общий обзор и KPI' : 'Genel İcra & KPI'}</span>
          </button>

          <button
            onClick={() => setActiveTab('CATEGORIES')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'CATEGORIES'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <PieChart className="w-3.5 h-3.5" />
            <span>{isRu ? 'По категориям' : 'Kategori Bazlı Harcama'}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
              {categoryBreakdown.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('SUPERVISORS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'SUPERVISORS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>{isRu ? 'Рейтинг руководителей' : 'Şefler Rekabet Sıralaması'}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
              {supervisorLeaderboard.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('JOBSITES')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'JOBSITES'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{isRu ? 'Бюджеты площадок' : 'Şantiye Bütçe Durumu'}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
              {jobsiteBudgetBreakdown.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('RECORD_DEALS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'RECORD_DEALS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span>{isRu ? 'Рекордные скидки' : 'Rekor İskontolar & Büyük Alımlar'}</span>
          </button>

          <button
            onClick={() => setActiveTab('MATERIALS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'MATERIALS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>{isRu ? 'Критические материалы' : 'Kritik Malzemeler (Birim Fiyat)'}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
              {criticalBenchmarks.length}
            </span>
          </button>
        </div>

        {/* BODY CONTENT */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* DUAL SPEND & EXECUTIVE KPI SUMMARY STRIP (Always visible for executive clarity) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            {/* KPI 1: Toplam Tasarruf */}
            <div className="bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-500/30 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all"></div>
              <div className="flex items-center justify-between text-xs font-medium text-emerald-400 mb-1.5">
                <span>{isRu ? 'Чистая экономия' : 'Sağlanan Toplam Tasarruf'}</span>
                <span className="p-1 rounded-md bg-emerald-500/20 text-emerald-300">
                  <TrendingUp className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight text-white">
                {formatRuble(kpis.totalDiscount)}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>İlk Teklif Üzerinden:</span>
                <span className="font-bold text-emerald-400">%{kpis.savingsPct.toFixed(1)}</span>
              </div>
            </div>

            {/* KPI 2: Pazarlığa Konu Alım Tutarı (376M netliği) */}
            <div className="bg-gradient-to-br from-blue-950/40 via-slate-900 to-slate-900 border border-blue-500/30 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
              <div className="flex items-center justify-between text-xs font-medium text-blue-400 mb-1.5">
                <span>{isRu ? 'Объем с переговорами' : 'Pazarlığa Konu Alım Tutarı'}</span>
                <span className="p-1 rounded-md bg-blue-500/20 text-blue-300">
                  <Coins className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight text-white">
                {formatRuble(kpis.totalAgreed)}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>İlk Teklif Toplamı:</span>
                <span className="font-medium text-slate-300">{formatRuble(kpis.totalOffer)}</span>
              </div>
            </div>

            {/* KPI 3: Şirket Toplam Fatura Hacmi (452M) & Kapsama */}
            <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/30 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all"></div>
              <div className="flex items-center justify-between text-xs font-medium text-indigo-400 mb-1.5">
                <span>{isRu ? 'Всего по счетам компании' : 'Şirket Toplam Fatura Hacmi'}</span>
                <span className="p-1 rounded-md bg-indigo-500/20 text-indigo-300">
                  <Building2 className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight text-white">
                {formatRuble(kpis.totalInvoiceSpend)}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>Pazarlık Kapsama Oranı:</span>
                <span className="font-bold text-indigo-300">%{kpis.negotiationCoveragePct.toFixed(1)}</span>
              </div>
            </div>

            {/* KPI 4: Müzakere & Şantiye Yoğunluğu */}
            <div className="bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-4 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all"></div>
              <div className="flex items-center justify-between text-xs font-medium text-amber-400 mb-1.5">
                <span>{isRu ? 'Интенсивность переговоров' : 'Müzakere Yoğunluğu'}</span>
                <span className="p-1 rounded-md bg-amber-500/20 text-amber-300">
                  <Award className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="text-2xl font-black tracking-tight text-white">
                {kpis.transactionCount} <span className="text-sm font-normal text-slate-400">İşlem</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
                <span>İşlem Başına Tasarruf:</span>
                <span className="font-bold text-amber-300">{formatRuble(kpis.avgDiscountPerTx)}</span>
              </div>
            </div>

          </div>

          {/* TAB 1: OVERVIEW & EXECUTIVE ACTION DECK */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              
              {/* EXECUTIVE INSIGHT DECK */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-bold tracking-wide uppercase text-slate-200">
                      {isRu ? 'Ключевые выводы для руководства' : 'Yönetici İcra Özeti & Temel Denetim Bulguları'}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatMonthTitle(selectedMonth)} Dönemi Canlı Analizi
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {executiveInsights.map((card) => {
                    const borderClass =
                      card.color === 'emerald' ? 'border-emerald-500/30' :
                      card.color === 'blue' ? 'border-blue-500/30' :
                      card.color === 'indigo' ? 'border-indigo-500/30' :
                      card.color === 'amber' ? 'border-amber-500/30' :
                      card.color === 'purple' ? 'border-purple-500/30' :
                      'border-rose-500/30';
                    const titleColorClass =
                      card.color === 'emerald' ? 'text-emerald-400' :
                      card.color === 'blue' ? 'text-blue-400' :
                      card.color === 'indigo' ? 'text-indigo-400' :
                      card.color === 'amber' ? 'text-amber-400' :
                      card.color === 'purple' ? 'text-purple-400' :
                      'text-rose-400';

                    return (
                      <div key={card.id} className={`bg-slate-900/90 border ${borderClass} rounded-xl p-4 flex flex-col justify-between`}>
                        <div>
                          <div className={`flex items-center gap-2 text-xs font-bold ${titleColorClass} mb-2`}>
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>{card.badge}</span>
                          </div>
                          <p
                            className="text-xs text-slate-300 leading-relaxed [&_strong]:text-white [&_strong]:font-semibold"
                            dangerouslySetInnerHTML={{ __html: card.summaryHtml }}
                          />
                        </div>
                        <div
                          className="mt-3 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 [&_strong]:text-slate-200"
                          dangerouslySetInnerHTML={{ __html: card.footerHtml }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* QUICK SNAPSHOT TABLES (Kategori & Şefler Özet) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Snapshot: Kategoriler */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <PieChart className="w-4 h-4 text-blue-400" />
                      <span>Kategori Harcama & Tasarruf Özeti</span>
                    </h4>
                    <button
                      onClick={() => setActiveTab('CATEGORIES')}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                    >
                      <span>Tümünü Gör</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {categoryBreakdown.slice(0, 4).map(c => (
                      <div key={c.category} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800/80">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-white">{c.category}</span>
                          <span className="text-emerald-400 font-bold">+{formatRuble(c.totalDiscount)} (%{c.savingsPercentage.toFixed(1)})</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-1">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(5, c.shareOfSpend))}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>Alım Hacmi: {formatRuble(c.totalAgreed)}</span>
                          <span>Harcama Payı: %{c.shareOfSpend.toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Snapshot: Şefler Liderliği */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-amber-400" />
                      <span>Lider Şefler & Tasarruf Karnesi</span>
                    </h4>
                    <button
                      onClick={() => setActiveTab('SUPERVISORS')}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                    >
                      <span>Tümünü Gör</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {supervisorLeaderboard.slice(0, 4).map((s, idx) => (
                      <div key={s.supervisorId} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            idx === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                            idx === 1 ? 'bg-slate-700 text-slate-200' :
                            'bg-slate-800 text-slate-400'
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <div className="font-semibold text-xs text-white">{s.supervisorName}</div>
                            <div className="text-[11px] text-slate-400">
                              {s.transactionCount} işlem | ⚽ {s.golCount} / 👟 {s.asistCount}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold text-emerald-400">+{formatRuble(s.totalDiscount)}</div>
                          <div className="text-[11px] text-slate-400">%{s.savingsPercentage.toFixed(1)} İndirim</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: KATEGORİ BAZLI HARCAMA VE TASARRUF DAĞILIMI */}
          {activeTab === 'CATEGORIES' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-blue-400" />
                    <span>Kategori Bazlı Harcama Dağılımı & Tasarruf Analizi</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Tüm satınalmaların ana malzeme gruplarına göre harcama hacmi, sağlanan indirim ve tasarruf verimliliği
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  Toplam {categoryBreakdown.length} Kategori
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-3.5 px-4">Kategori Adı</th>
                      <th className="py-3.5 px-4 text-right">Gerçekleşen Alım (₽)</th>
                      <th className="py-3.5 px-4 text-right">Sağlanan Tasarruf (₽)</th>
                      <th className="py-3.5 px-4 text-right">Tasarruf Oranı</th>
                      <th className="py-3.5 px-4 text-right">Harcama Payı</th>
                      <th className="py-3.5 px-4 text-center">İşlem Adedi</th>
                      <th className="py-3.5 px-4">Ağırlıklı Malzeme</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {categoryBreakdown.map((c) => (
                      <tr key={c.category} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          <span>{c.category}</span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                          {formatRuble(c.totalAgreed)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-emerald-400">
                          +{formatRuble(c.totalDiscount)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            %{c.savingsPercentage.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-medium text-slate-300">%{c.shareOfSpend.toFixed(1)}</span>
                            <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500"
                                style={{ width: `${Math.min(100, c.shareOfSpend)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center text-slate-300 font-medium">
                          {c.transactionCount}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 truncate max-w-xs" title={c.topMaterial}>
                          {c.topMaterial || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: ŞEFLER ARASI TASARRUF & REKABET SIRALAMASI */}
          {activeTab === 'SUPERVISORS' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-400" />
                    <span>Satınalma Şefleri Arası Tasarruf & Rekabet Sıralaması (İcra Karnesi)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Hangi şef ne kadar para yönetti, ne kadar indirim aldı; gol/asist sayıları ve yardımcı kadrosu performansı
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  {supervisorLeaderboard.length} Aktif Şef
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-3.5 px-4">Sıra & Şef</th>
                      <th className="py-3.5 px-4 text-right">Yönetilen Alım (₽)</th>
                      <th className="py-3.5 px-4 text-right">Sağlanan Tasarruf (₽)</th>
                      <th className="py-3.5 px-4 text-right">İndirim Oranı</th>
                      <th className="py-3.5 px-4 text-center">Gol / Asist</th>
                      <th className="py-3.5 px-4 text-center">Pazarlık Turu</th>
                      <th className="py-3.5 px-4 text-center">Yeni Firma</th>
                      <th className="py-3.5 px-4">Yardımcı Kadro Katkısı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {supervisorLeaderboard.map((s, idx) => (
                      <React.Fragment key={s.supervisorId}>
                        <tr className="hover:bg-slate-900/60 transition-colors">
                          <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2.5">
                            <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs ${
                              idx === 0 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                              idx === 1 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' :
                              idx === 2 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                              'bg-slate-800 text-slate-400'
                            }`}>
                              {s.rank}
                            </span>
                            <div>
                              <div className="font-bold text-white">{s.supervisorName}</div>
                              <div className="text-[10px] text-slate-400">{s.transactionCount} işlem</div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                            {formatRuble(s.totalAgreed)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold text-emerald-400">
                            +{formatRuble(s.totalDiscount)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              %{s.savingsPercentage.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                              <span title="Şef Doğrudan Kapanış">⚽ {s.golCount}</span>
                              <span className="text-slate-600">/</span>
                              <span title="Yardımcı Asisti">👟 {s.asistCount}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center text-slate-300 font-medium">
                            {s.totalNegotiationRounds} tur
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {s.newVendorsCount > 0 ? (
                              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold text-[11px]">
                                +{s.newVendorsCount}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {s.assistants.length > 0 ? (
                              <button
                                onClick={() => setExpandedSupervisorId(expandedSupervisorId === s.supervisorId ? null : s.supervisorId)}
                                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
                              >
                                <span>{s.assistants.length} Yardımcı ({formatRuble(s.assistants.reduce((acc, x) => acc + x.discountAmount, 0))})</span>
                                <ChevronDown className={`w-3 h-3 transition-transform ${expandedSupervisorId === s.supervisorId ? 'rotate-180' : ''}`} />
                              </button>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Doğrudan İcra</span>
                            )}
                          </td>
                        </tr>

                        {/* EXPANDED ASSISTANTS ROW */}
                        {expandedSupervisorId === s.supervisorId && s.assistants.length > 0 && (
                          <tr className="bg-slate-900/90 border-b border-slate-800">
                            <td colSpan={8} className="p-4 pl-12">
                              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                                <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                  <Users className="w-3.5 h-3.5 text-blue-400" />
                                  <span>{s.supervisorName} — Yardımcı Ekip & Asist Detayı</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                  {s.assistants.map(a => (
                                    <div key={a.name} className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                                      <div>
                                        <div className="font-semibold text-xs text-white">{a.name}</div>
                                        <div className="text-[11px] text-slate-400">👟 {a.asistCount} Asist İndirimi</div>
                                      </div>
                                      <div className="text-right">
                                        <div className="font-bold text-xs text-emerald-400">+{formatRuble(a.discountAmount)}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: ŞANTİYE BÜTÇE KULLANIM DURUMU */}
          {activeTab === 'JOBSITES' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-indigo-400" />
                    <span>Şantiye Bütçe Kullanım ve Harcama Durumu (Ayrıntılı İcmal)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Şantiyelerin ay içindeki toplam fatura hacmi, pazarlıklı alımları, elde edilen tasarruf ve en aktif şefleri
                  </p>
                </div>
                <div className="text-xs text-slate-400">
                  {jobsiteBudgetBreakdown.length} Aktif Şantiye
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-3.5 px-4">Şantiye Adı / Kod</th>
                      <th className="py-3.5 px-4 text-right">Dönem Fatura Hacmi (₽)</th>
                      <th className="py-3.5 px-4 text-right">Pazarlıklı Alım (₽)</th>
                      <th className="py-3.5 px-4 text-right">Sağlanan Tasarruf (₽)</th>
                      <th className="py-3.5 px-4 text-right">Tasarruf Oranı</th>
                      <th className="py-3.5 px-4 text-right">Şirket Harcama Payı</th>
                      <th className="py-3.5 px-4">Lider Şef</th>
                      <th className="py-3.5 px-4">Ağırlıklı Kategori</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {jobsiteBudgetBreakdown.map((j) => (
                      <tr key={j.jobsiteId} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-white">
                          <div className="font-bold text-white">{j.jobsiteName}</div>
                          {j.code && <div className="text-[10px] text-slate-400">{j.code}</div>}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-200">
                          {formatRuble(j.monthlyInvoiceSpend)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-slate-300">
                          {formatRuble(j.monthlyDiscountedSpend)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-emerald-400">
                          +{formatRuble(j.totalDiscount)}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            %{j.savingsPercentage.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-slate-300">
                          %{j.shareOfSpend.toFixed(1)}
                        </td>
                        <td className="py-3.5 px-4 font-medium text-blue-400">
                          {j.topSupervisor}
                        </td>
                        <td className="py-3.5 px-4 text-slate-400">
                          {j.topCategory}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: REKOR İSKONTOLAR & BÜYÜK HACİMLİ ALIMLAR (DEMİR VB.) */}
          {activeTab === 'RECORD_DEALS' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              
              {/* Record Discounts Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Flame className="w-5 h-5 text-orange-400" />
                      <span>En Yüksek İskonto Oranlı Alımlar (Rekor Müzakereler)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Satınalma masasında %15 ve üzerinde rekor indirim koparılan stratejik alımlar
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-semibold">
                    Top 10 Rekor İskonto
                  </span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                        <th className="py-3 px-4">Malzeme / İşlem Açıklaması</th>
                        <th className="py-3 px-4">Şantiye</th>
                        <th className="py-3 px-4">Tedarikçi</th>
                        <th className="py-3 px-4">Sorumlu Şef</th>
                        <th className="py-3 px-4 text-right">İlk Teklif (₽)</th>
                        <th className="py-3 px-4 text-right">Anlaşılan (₽)</th>
                        <th className="py-3 px-4 text-right">Tasarruf (₽)</th>
                        <th className="py-3 px-4 text-right">İndirim Oranı</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-xs">
                      {recordDeals.topByPercentage.map(d => (
                        <tr key={d.id} className="hover:bg-slate-900/60 transition-colors">
                          <td className="py-3 px-4 font-semibold text-white max-w-xs truncate" title={d.materialName}>
                            {d.materialName}
                          </td>
                          <td className="py-3 px-4 text-slate-300">{d.jobsiteName}</td>
                          <td className="py-3 px-4 text-slate-400">{d.vendorName}</td>
                          <td className="py-3 px-4 text-blue-400">{d.supervisorName}</td>
                          <td className="py-3 px-4 text-right text-slate-400">{formatRuble(d.offerPrice)}</td>
                          <td className="py-3 px-4 text-right font-medium text-slate-200">{formatRuble(d.agreedPrice)}</td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-400">+{formatRuble(d.discountAmount)}</td>
                          <td className="py-3 px-4 text-right">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/30">
                              %{d.discountPercentage.toFixed(1)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* High Volume & Strategic Materials (Demir gibi) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Zap className="w-5 h-5 text-yellow-400" />
                      <span>Büyük Hacimli & Stratejik Alımlar (Demir, Beton vb. Ağır Kalemler)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Sözleşme tutarı en yüksek olan ve şirket bütçesinde kritik yer tutan mega satınalmalar
                    </p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-semibold">
                    Top 10 Hacimli Kalem
                  </span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                        <th className="py-3 px-4">Malzeme / Alım Kalemi</th>
                        <th className="py-3 px-4">Şantiye</th>
                        <th className="py-3 px-4">Tedarikçi</th>
                        <th className="py-3 px-4">Sorumlu Şef</th>
                        <th className="py-3 px-4 text-right">Anlaşılan Tutar (₽)</th>
                        <th className="py-3 px-4 text-right">Tasarruf Tutarı (₽)</th>
                        <th className="py-3 px-4 text-right">Tasarruf %</th>
                        <th className="py-3 px-4 text-center">Tarih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-xs">
                      {recordDeals.topByVolume.map(d => (
                        <tr key={d.id} className="hover:bg-slate-900/60 transition-colors">
                          <td className="py-3 px-4 font-bold text-white max-w-xs truncate" title={d.materialName}>
                            {d.materialName}
                          </td>
                          <td className="py-3 px-4 text-slate-300">{d.jobsiteName}</td>
                          <td className="py-3 px-4 text-slate-400">{d.vendorName}</td>
                          <td className="py-3 px-4 text-blue-400">{d.supervisorName}</td>
                          <td className="py-3 px-4 text-right font-black text-white">{formatRuble(d.agreedPrice)}</td>
                          <td className="py-3 px-4 text-right font-bold text-emerald-400">+{formatRuble(d.discountAmount)}</td>
                          <td className="py-3 px-4 text-right">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              %{d.discountPercentage.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center text-slate-400 text-[11px]">{d.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* TAB 6: KRİTİK MALZEMELER (STRATEJİK BİRİM FİYAT BENCHMARK) */}
          {activeTab === 'MATERIALS' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Scale className="w-5 h-5 text-blue-400" />
                    <span>Seçili Kritik Malzemeler: Ortalama Alım Fiyatları vs. İlk Teklif Fiyatları</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    İnşaat demiri, gazbeton, su/ısı yalıtımı, beton ve yüksek bütçeli ana girdilerde birim maliyet analizi
                  </p>
                </div>

                {/* FILTERS */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Category Dropdown */}
                  <select
                    value={materialFilterCategory}
                    onChange={(e) => setMaterialFilterCategory(e.target.value)}
                    className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    <option value="ALL">Tüm Kategoriler</option>
                    {availableCategories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Malzeme veya tedarikçi ara..."
                      value={materialSearchQuery}
                      onChange={(e) => setMaterialSearchQuery(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-xl pl-8 pr-3 py-2 w-48 sm:w-56 focus:ring-1 focus:ring-blue-500 outline-none placeholder:text-slate-500"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              </div>

              {/* STRATEGIC GROUP FILTER CHIPS */}
              <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs">
                <button
                  onClick={() => setMaterialViewMode('STRATEGIC_TOP')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                    materialViewMode === 'STRATEGIC_TOP'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-amber-300" />
                  <span>Stratejik Ağır Kalemler ({topStrategicBenchmarks.length})</span>
                </button>
                <button
                  onClick={() => setMaterialViewMode('DEMIR')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'DEMIR'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  🏗️ İnşaat Demiri & Çelik
                </button>
                <button
                  onClick={() => setMaterialViewMode('GAZBLOK')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'GAZBLOK'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  🧱 Gazbeton & Blok
                </button>
                <button
                  onClick={() => setMaterialViewMode('IZOLASYON')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'IZOLASYON'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  🛡️ İzolasyon & Yalıtım
                </button>
                <button
                  onClick={() => setMaterialViewMode('BETON')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'BETON'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  🚜 Beton, Harç & Kalıp
                </button>
                <button
                  onClick={() => setMaterialViewMode('TOP_SAVINGS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'TOP_SAVINGS'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  💰 Yüksek Tasarruflu
                </button>
                <button
                  onClick={() => setMaterialViewMode('ALL')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    materialViewMode === 'ALL'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                >
                  Tümü ({criticalBenchmarks.length})
                </button>
              </div>

              {/* ACTIVE FILTER SUMMARY STRIP */}
              <div className="px-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-300 gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="font-semibold text-white">
                    {materialViewMode === 'STRATEGIC_TOP' ? 'Seçkin Yönetici İcra Özeti (Ağır İnşaat Kalemleri)' :
                     materialViewMode === 'DEMIR' ? 'İnşaat Demiri ve Yapısal Çelik Grubu' :
                     materialViewMode === 'GAZBLOK' ? 'Gazbeton, Ytong ve Duvar Blokları Grubu' :
                     materialViewMode === 'IZOLASYON' ? 'Su, Isı ve Ses Yalıtımı Membran ve Levhaları' :
                     materialViewMode === 'BETON' ? 'Hazır Beton, Agrega ve Kalıp Sistemleri' :
                     materialViewMode === 'TOP_SAVINGS' ? 'En Yüksek Net Tasarruf Sağlanan Alımlar' : 'Tüm Analiz Edilen Kalemler'}
                  </span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-400">{filteredBenchmarks.length} Kalem Listelendi</span>
                </div>
                <div className="flex items-center gap-4 text-xs font-medium">
                  <div>
                    Toplam Hacim: <strong className="text-white">{formatRuble(filteredBenchmarks.reduce((a, b) => a + b.totalAgreedSpend, 0))}</strong>
                  </div>
                  <div>
                    Toplam Tasarruf: <strong className="text-emerald-400">+{formatRuble(filteredBenchmarks.reduce((a, b) => a + b.totalSavings, 0))}</strong>
                  </div>
                </div>
              </div>

              {/* TABLE */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                      <th className="py-3 px-4">Malzeme Tanımı</th>
                      <th className="py-3 px-4">Stratejik Grup</th>
                      <th className="py-3 px-4">Birim</th>
                      <th className="py-3 px-4 text-right">Alınan Miktar</th>
                      <th className="py-3 px-4 text-right">Ortalama İlk Teklif</th>
                      <th className="py-3 px-4 text-right">Anlaşılan Birim Fiyat</th>
                      <th className="py-3 px-4 text-right">Birim Tasarruf</th>
                      <th className="py-3 px-4 text-right">Toplam Tasarruf (₽)</th>
                      <th className="py-3 px-4 text-right">Tasarruf %</th>
                      <th className="py-3 px-4">Örnek Tedarikçi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {filteredBenchmarks.slice(0, 30).map((m) => (
                      <tr key={m.key} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-3 px-4 font-bold text-white max-w-xs truncate" title={m.materialName}>
                          {m.materialName}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            m.group === 'DEMIR' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            m.group === 'GAZBLOK' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                            m.group === 'IZOLASYON' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            m.group === 'BETON' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {m.groupLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400">{m.unit}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-200">
                          {m.totalQuantity.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400">
                          {formatRuble(m.avgOfferUnitPrice)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-white">
                          {formatRuble(m.avgAgreedUnitPrice)}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-emerald-400">
                          {formatRuble(m.unitSavings)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-400">
                          +{formatRuble(m.totalSavings)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            %{m.savingsPercentage.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-400 truncate max-w-[150px]" title={m.representativeVendors.join(', ')}>
                          {m.representativeVendors.join(', ') || '-'}
                        </td>
                      </tr>
                    ))}
                      {filteredBenchmarks.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-slate-500 text-xs">
                            Filtreye uygun malzeme bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* AYNI MARKA & TEKNİK ÖZELLİK FİYAT FARKI UYARILARI (ELMA-ELMA DENETİMİ) */}
                {sameBrandPriceAlerts.length > 0 && (
                  <div className="bg-slate-950/70 border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3 mt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-amber-400" />
                          <span>Aynı Marka & Teknik Özellik Fiyat Farkı Uyarıları (Birebir Elma-Elma Kıyaslama)</span>
                        </h4>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Aynı malzeme, aynı teknik özellik ve aynı marka/seri olmasına rağmen farklı birim fiyatlardan alınan kalemler
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {sameBrandPriceAlerts.length} Fiyat Farkı Uyarısı
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/90 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                            <th className="py-2.5 px-3">Malzeme & Marka / Seri</th>
                            <th className="py-2.5 px-3">Birim</th>
                            <th className="py-2.5 px-3 text-right">En Düşük Birim</th>
                            <th className="py-2.5 px-3">En Uygun Şantiye / Firma</th>
                            <th className="py-2.5 px-3 text-right">En Yüksek Birim</th>
                            <th className="py-2.5 px-3">En Pahalı Şantiye / Firma</th>
                            <th className="py-2.5 px-3 text-right">Fiyat Farkı %</th>
                            <th className="py-2.5 px-3 text-right">Birim Fark Etkisi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {sameBrandPriceAlerts.map(a => (
                            <tr key={a.id} className="hover:bg-slate-900/60 transition-colors">
                              <td className="py-2.5 px-3 font-semibold text-white max-w-xs truncate" title={a.materialName}>
                                {a.materialName}
                              </td>
                              <td className="py-2.5 px-3 text-slate-400">{a.unit}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-400">{formatRuble(a.minPrice)}</td>
                              <td className="py-2.5 px-3 text-slate-300 truncate max-w-[180px]" title={`${a.cheapestSite} — ${a.cheapestVendor}`}>
                                <span className="font-medium text-white">{a.cheapestSite}</span>
                                <span className="text-slate-500"> · {a.cheapestVendor}</span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-rose-400">{formatRuble(a.maxPrice)}</td>
                              <td className="py-2.5 px-3 text-slate-300 truncate max-w-[180px]" title={`${a.priciestSite} — ${a.priciestVendor}`}>
                                <span className="font-medium text-white">{a.priciestSite}</span>
                                <span className="text-slate-500"> · {a.priciestVendor}</span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                  +%{a.diffPct.toFixed(1)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-rose-400">
                                {formatRuble(a.excessSpend)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

        </div>

        {/* FOOTER ACTION BAR */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0">
          <div className="flex items-center gap-2 text-slate-400">
            <Info className="w-4 h-4 text-blue-400" />
            <span>
              Rapor verileri GES platformu satınalma modüllerinden (İndirim Girişi, 1M+ ₽ TDF, AI Fatura) gerçek zamanlı hesaplanmıştır; Prizma referans faturaları harcama toplamına dahil edilmez.
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-md shadow-rose-500/20 transition-all hover:scale-105 active:scale-95"
            >
              <Printer className="w-4 h-4" />
              <span>PDF İndir / Yazdır</span>
            </button>
            <button
              onClick={handleExportHtml}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>HTML İndir</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-colors"
            >
              Kapat
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
