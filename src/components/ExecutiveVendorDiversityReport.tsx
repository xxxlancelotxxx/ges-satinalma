import React, { useState, useMemo } from 'react';
import {
  DiscountRecord,
  PurchasingSupervisor,
  Personnel,
  Jobsite,
  SupervisorPerformance
} from '../types';
import { formatRuble } from '../utils/format';
import { normalizeVendorName, getVendorKey } from '../utils/vendorNormalizer';
import {
  ShieldAlert,
  Sparkles,
  Award,
  AlertTriangle,
  CheckCircle2,
  Users,
  Search,
  ChevronDown,
  ChevronUp,
  Building2,
  PieChart,
  Compass,
  Info,
  TrendingUp,
  Filter,
  ArrowUpRight,
  Store,
  Layers,
  HelpCircle,
  Clock
} from 'lucide-react';

interface Props {
  discounts: DiscountRecord[];
  supervisors: PurchasingSupervisor[];
  personnel?: Personnel[];
  jobsites: Jobsite[];
  performances?: SupervisorPerformance[];
}

export const ExecutiveVendorDiversityReport: React.FC<Props> = ({
  discounts = [],
  supervisors = [],
  personnel = [],
  jobsites = []
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJobsite, setSelectedJobsite] = useState('ALL');
  const [selectedSupervisor, setSelectedSupervisor] = useState('ALL');
  const [filterRiskOnly, setFilterRiskOnly] = useState<'ALL' | 'RISK' | 'DISCOVERERS'>('ALL');
  const [expandedBuyerId, setExpandedBuyerId] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'buyers' | 'discoveries' | 'vendors'>('buyers');

  // -------------------------------------------------------------
  // 1. DATA ANALYSIS & SYNTHESIS ENGINE (Memoized & High Performance)
  // -------------------------------------------------------------
  const {
    buyerStats,
    newVendorDiscoveries,
    vendorConcentrationSummary,
    kpis
  } = useMemo(() => {
    // Sort discounts chronologically
    const sortedDiscounts = [...discounts].sort((a, b) => {
      const dateA = a.orderDate || a.created_at || '';
      const dateB = b.orderDate || b.created_at || '';
      return dateA.localeCompare(dateB);
    });

    // Track first appearance of each vendor in the company history
    const vendorFirstSeenMap = new Map<string, {
      date: string;
      buyerId: string;
      buyerName: string;
      buyerType: 'supervisor' | 'personnel';
      category: string;
      jobsiteName: string;
      firstAgreedPrice: number;
      firstDiscountAmount: number;
      firstDiscountPercentage: number;
    }>();

    // Map buyer statistics
    interface BuyerData {
      id: string;
      name: string;
      type: 'supervisor' | 'personnel';
      title: string;
      supervisorName: string;
      supervisorId: string;
      totalSpend: number;
      totalOfferPrice: number;
      totalDiscountAmount: number;
      txCount: number;
      vendorsMap: Map<string, { spend: number; count: number; discount: number }>;
      newVendorsCount: number;
      newVendorsList: string[];
    }

    const buyersMap = new Map<string, BuyerData>();

    // Initialize buyers from supervisors list
    supervisors.forEach(s => {
      buyersMap.set(s.id, {
        id: s.id,
        name: s.name,
        type: 'supervisor',
        title: s.title || 'Satınalma Şefi',
        supervisorName: s.name,
        supervisorId: s.id,
        totalSpend: 0,
        totalOfferPrice: 0,
        totalDiscountAmount: 0,
        txCount: 0,
        vendorsMap: new Map(),
        newVendorsCount: 0,
        newVendorsList: []
      });
    });

    // Initialize buyers from personnel list
    personnel.forEach(p => {
      const parentSup = supervisors.find(s => s.id === p.supervisorId);
      buyersMap.set(p.id, {
        id: p.id,
        name: p.name,
        type: 'personnel',
        title: p.title || 'Satınalma Personeli',
        supervisorName: p.supervisorName || parentSup?.name || 'Bağlı Şef',
        supervisorId: p.supervisorId,
        totalSpend: 0,
        totalOfferPrice: 0,
        totalDiscountAmount: 0,
        txCount: 0,
        vendorsMap: new Map(),
        newVendorsCount: 0,
        newVendorsList: []
      });
    });

    // Process all transactions
    sortedDiscounts.forEach(d => {
      const vendorName = normalizeVendorName(String(d.vendorName || '').trim());
      if (!vendorName) return;
      const vKey = getVendorKey(vendorName);

      const buyerId = d.performedByPersonnelId || d.supervisorId;
      const buyerName = d.performedByPersonnelName || d.supervisorName || 'Bilinmeyen Alıcı';
      const isPersonnel = Boolean(d.performedByPersonnelId);

      // Check for New Vendor Discovery (Method 1: ONLY when explicitly added as new vendor)
      if (d.isNewVendor === true) {
        if (!vendorFirstSeenMap.has(vKey)) {
          vendorFirstSeenMap.set(vKey, {
            date: d.orderDate || d.created_at || '-',
            buyerId,
            buyerName,
            buyerType: isPersonnel ? 'personnel' : 'supervisor',
            category: d.category || 'Genel',
            jobsiteName: d.jobsiteName || '-',
            firstAgreedPrice: d.agreedPrice || 0,
            firstDiscountAmount: d.discountAmount || 0,
            firstDiscountPercentage: d.discountPercentage || 0
          });
        }
      }

      // Ensure buyer exists in map
      if (!buyersMap.has(buyerId)) {
        buyersMap.set(buyerId, {
          id: buyerId,
          name: buyerName,
          type: isPersonnel ? 'personnel' : 'supervisor',
          title: isPersonnel ? 'Satınalma Personeli' : 'Satınalma Şefi',
          supervisorName: d.supervisorName || 'Bağlı Şef',
          supervisorId: d.supervisorId || '',
          totalSpend: 0,
          totalOfferPrice: 0,
          totalDiscountAmount: 0,
          txCount: 0,
          vendorsMap: new Map(),
          newVendorsCount: 0,
          newVendorsList: []
        });
      }

      const bData = buyersMap.get(buyerId)!;
      bData.totalSpend += (d.agreedPrice || 0);
      bData.totalOfferPrice += (d.offerPrice || d.adjustedOfferPrice || d.agreedPrice || 0);
      bData.totalDiscountAmount += (d.discountAmount || 0);
      bData.txCount += 1;

      // Update vendor spend for this buyer
      const currentVendorSpend = bData.vendorsMap.get(vendorName) || { spend: 0, count: 0, discount: 0 };
      currentVendorSpend.spend += (d.agreedPrice || 0);
      currentVendorSpend.count += 1;
      currentVendorSpend.discount += (d.discountAmount || 0);
      bData.vendorsMap.set(vendorName, currentVendorSpend);
    });

    // Populate new vendor discoveries list for buyers
    vendorFirstSeenMap.forEach((discovery, vNameKey) => {
      const bData = buyersMap.get(discovery.buyerId);
      if (bData) {
        bData.newVendorsCount += 1;
        // Find original casing of vendor
        bData.newVendorsList.push(vNameKey.toUpperCase());
      }
    });

    // Global vendor summary (Overall company vendor concentration)
    const companyVendorMap = new Map<string, { spend: number; count: number; discount: number; buyers: Set<string> }>();
    let companyTotalSpend = 0;

    discounts.forEach(d => {
      const vName = normalizeVendorName(String(d.vendorName || '').trim());
      if (!vName) return;
      const agreed = d.agreedPrice || 0;
      companyTotalSpend += agreed;

      const current = companyVendorMap.get(vName) || { spend: 0, count: 0, discount: 0, buyers: new Set() };
      current.spend += agreed;
      current.count += 1;
      current.discount += (d.discountAmount || 0);
      current.buyers.add(d.performedByPersonnelName || d.supervisorName || 'Bilinmeyen');
      companyVendorMap.set(vName, current);
    });

    const vendorConcentrationList = Array.from(companyVendorMap.entries()).map(([vendorName, stats]) => {
      const share = companyTotalSpend > 0 ? (stats.spend / companyTotalSpend) * 100 : 0;
      return {
        vendorName,
        totalSpend: stats.spend,
        txCount: stats.count,
        totalDiscount: stats.discount,
        marketSharePercentage: Math.round(share * 10) / 10,
        buyersCount: stats.buyers.size,
        buyersList: Array.from(stats.buyers)
      };
    }).sort((a, b) => b.totalSpend - a.totalSpend);

    // Finalize buyer rows with concentration metrics & diversity score
    const processedBuyers = Array.from(buyersMap.values())
      .filter(b => b.txCount > 0) // only include buyers with transaction activity
      .map(b => {
        // Sort vendor spend
        const vendorList = Array.from(b.vendorsMap.entries())
          .map(([vendorName, vStats]) => ({
            vendorName,
            spend: vStats.spend,
            count: vStats.count,
            discount: vStats.discount,
            percentage: b.totalSpend > 0 ? Math.round((vStats.spend / b.totalSpend) * 1000) / 10 : 0
          }))
          .sort((x, y) => y.spend - x.spend);

        const distinctVendorsCount = vendorList.length;
        const topVendor = vendorList[0] || null;
        const topVendorPercentage = topVendor ? topVendor.percentage : 0;

        // Monopoly / Concentration Risk Level (Method 2)
        // High Risk: > 55% spend in 1 vendor and at least 3 transactions
        // Medium Risk: 35% - 55% spend in 1 vendor and at least 2 transactions
        // Healthy: < 35% or wide pool
        let riskLevel: 'CRITICAL' | 'WARNING' | 'HEALTHY' = 'HEALTHY';
        let riskReason = 'Tedarikçi portföyü dengeli dağılmış.';

        if (b.txCount >= 3 && topVendorPercentage >= 55) {
          riskLevel = 'CRITICAL';
          riskReason = `Alımların %${topVendorPercentage}'i tek bir firmada ('${topVendor?.vendorName}') toplanmış. Alternatif teklif mecburiyeti uygulanmalı!`;
        } else if (b.txCount >= 2 && topVendorPercentage >= 38) {
          riskLevel = 'WARNING';
          riskReason = `Alımların %${topVendorPercentage}'i '${topVendor?.vendorName}' firmasından. Firma çeşitliliği artırılmalı.`;
        }

        // Composite Health & Diversity Score (The Mix: 0 to 100 points)
        // Base: 50
        // +15 for each new vendor discovered (max +30)
        // +20 for distinct vendors count >= 4, +10 for >= 2
        // -30 if CRITICAL risk, -15 if WARNING risk
        let diversityScore = 50;
        diversityScore += Math.min(b.newVendorsCount * 15, 30);
        if (distinctVendorsCount >= 4) diversityScore += 20;
        else if (distinctVendorsCount >= 2) diversityScore += 10;

        if (riskLevel === 'CRITICAL') diversityScore -= 30;
        else if (riskLevel === 'WARNING') diversityScore -= 15;

        diversityScore = Math.max(10, Math.min(100, diversityScore));

        return {
          ...b,
          distinctVendorsCount,
          vendorList,
          topVendor,
          topVendorPercentage,
          riskLevel,
          riskReason,
          diversityScore
        };
      })
      .sort((a, b) => {
        // High risk first if risk mode active, else sort by diversity score or spend
        if (filterRiskOnly === 'RISK') {
          return b.topVendorPercentage - a.topVendorPercentage;
        }
        if (filterRiskOnly === 'DISCOVERERS') {
          return b.newVendorsCount - a.newVendorsCount;
        }
        return b.totalSpend - a.totalSpend;
      });

    // New Vendor Discoveries formatted list
    const discoveriesList = Array.from(vendorFirstSeenMap.entries()).map(([vKey, data]) => ({
      vendorKey: vKey,
      vendorName: vKey.toUpperCase(),
      date: data.date,
      buyerName: data.buyerName,
      buyerType: data.buyerType,
      category: data.category,
      jobsiteName: data.jobsiteName,
      firstAgreedPrice: data.firstAgreedPrice,
      firstDiscountAmount: data.firstDiscountAmount,
      firstDiscountPercentage: data.firstDiscountPercentage
    })).sort((a, b) => b.firstDiscountAmount - a.firstDiscountAmount);

    // Global Executive KPIs
    const totalActiveVendors = companyVendorMap.size;
    const totalNewVendors = discoveriesList.length;
    const criticalRiskCount = processedBuyers.filter(b => b.riskLevel === 'CRITICAL').length;
    const warningRiskCount = processedBuyers.filter(b => b.riskLevel === 'WARNING').length;
    const avgDiversityScore = processedBuyers.length > 0
      ? Math.round(processedBuyers.reduce((acc, b) => acc + b.diversityScore, 0) / processedBuyers.length)
      : 0;

    return {
      buyerStats: processedBuyers,
      newVendorDiscoveries: discoveriesList,
      vendorConcentrationSummary: vendorConcentrationList,
      kpis: {
        totalActiveVendors,
        totalNewVendors,
        criticalRiskCount,
        warningRiskCount,
        avgDiversityScore,
        totalSpend: companyTotalSpend
      }
    };
  }, [discounts, supervisors, personnel, filterRiskOnly]);

  // -------------------------------------------------------------
  // 2. FILTERING LOGIC
  // -------------------------------------------------------------
  const filteredBuyers = useMemo(() => {
    return buyerStats.filter(b => {
      // Supervisor filter
      if (selectedSupervisor !== 'ALL' && b.supervisorId !== selectedSupervisor && b.id !== selectedSupervisor) {
        return false;
      }

      // Risk level filter
      if (filterRiskOnly === 'RISK' && b.riskLevel !== 'CRITICAL' && b.riskLevel !== 'WARNING') {
        return false;
      }
      if (filterRiskOnly === 'DISCOVERERS' && b.newVendorsCount === 0) {
        return false;
      }

      // Text search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = b.name.toLowerCase().includes(query);
        const matchesSup = b.supervisorName.toLowerCase().includes(query);
        const matchesTopVendor = b.topVendor?.vendorName.toLowerCase().includes(query);
        if (!matchesName && !matchesSup && !matchesTopVendor) {
          return false;
        }
      }

      return true;
    });
  }, [buyerStats, selectedSupervisor, filterRiskOnly, searchTerm]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Executive Header Banner */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 rounded-3xl p-6 sm:p-8 text-white border border-amber-500/30 shadow-2xl relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 text-xs font-black uppercase tracking-wider mb-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Yönetici Özel Denetim Paneli (Executive Audit) 🔒</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight flex items-center gap-3">
              <span>Tedarikçi Çeşitliliği & Tekelleşme Risk Denetimi</span>
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm mt-1.5 max-w-3xl leading-relaxed">
              Bu panel; personellerin tedarik ağını genişletme başarılarını (<strong className="text-emerald-400">Yeni Firma Keşifleri</strong>) ile tek firmaya aşırı bağımlılık risklerini (<strong className="text-rose-400">Tekelleşme & Yoğunlaşma Uyarısı</strong>) birleştiren yönetici özel analiz ekranıdır.
            </p>
          </div>

          <div className="flex items-center space-x-2 bg-slate-900/90 border border-amber-500/30 px-4 py-3 rounded-2xl shadow-inner text-right">
            <div>
              <div className="text-[11px] text-slate-400 font-bold uppercase">Genel Portföy Sağlık Skoru</div>
              <div className="text-2xl font-black text-amber-400">
                {kpis.avgDiversityScore} / 100
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-black ml-2">
              {kpis.avgDiversityScore >= 70 ? 'A+' : kpis.avgDiversityScore >= 50 ? 'B' : 'C-'}
            </div>
          </div>
        </div>

        {/* 4 Executive KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-slate-800">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span className="font-bold">Aktif Tedarikçi Havuzu</span>
              <Store className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-white">
              {kpis.totalActiveVendors} <span className="text-xs text-slate-400 font-normal">Firma</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              Toplam Harcama: {formatRuble(kpis.totalSpend)}
            </div>
          </div>

          <div className="bg-slate-900/80 border border-emerald-900/40 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-emerald-300 text-xs mb-1">
              <span className="font-bold">Yeni Kazandırılan Firmalar</span>
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400">
              +{kpis.totalNewVendors} <span className="text-xs text-emerald-300 font-normal">Yeni Firma</span>
            </div>
            <div className="text-[10px] text-emerald-300/80 mt-0.5">
              Tedarik Ağı Büyüme Başarısı 🌟
            </div>
          </div>

          <div className="bg-slate-900/80 border border-rose-900/40 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-rose-300 text-xs mb-1">
              <span className="font-bold">Kritik Tekelleşme Uyarısı</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-rose-400">
              {kpis.criticalRiskCount} <span className="text-xs text-rose-300 font-normal">Alıcı</span>
            </div>
            <div className="text-[10px] text-rose-300/80 mt-0.5">
              Harcamasının %55+ kısmı tek firmada
            </div>
          </div>

          <div className="bg-slate-900/80 border border-amber-900/40 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-amber-300 text-xs mb-1">
              <span className="font-bold">Dikkat / Orta Yoğunlaşma</span>
              <Info className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-400">
              {kpis.warningRiskCount} <span className="text-xs text-amber-300 font-normal">Alıcı</span>
            </div>
            <div className="text-[10px] text-amber-300/80 mt-0.5">
              %38 - %55 tek firma yoğunlaşması
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Navigation (Tab Modes) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center space-x-1.5 bg-slate-100 p-1 rounded-2xl text-xs font-bold">
          <button
            onClick={() => setActiveSubTab('buyers')}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
              activeSubTab === 'buyers'
                ? 'bg-white text-indigo-700 shadow-sm font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Alıcı Çeşitlilik & Risk Matrisi ({buyerStats.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('discoveries')}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
              activeSubTab === 'discoveries'
                ? 'bg-white text-emerald-700 shadow-sm font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-4 h-4 text-emerald-500" />
            <span>Ağa Yeni Katılan Tedarikçiler ({newVendorDiscoveries.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('vendors')}
            className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
              activeSubTab === 'vendors'
                ? 'bg-white text-amber-700 shadow-sm font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Store className="w-4 h-4 text-amber-500" />
            <span>Şirket Geneli Tedarikçi Hacimleri</span>
          </button>
        </div>

        {/* Quick Rule Info Note */}
        <div className="flex items-center space-x-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>Kural 5.2 & Çeşitlilik: Tek bir firmaya bağımlılık %55 üzerine çıktığında risk uyarısı üretilir.</span>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUB-VIEW 1: BUYERS CONCENTRATION & DIVERSITY MATRIX           */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'buyers' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Personel, şef veya firma ara..."
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              {/* Supervisor Selector */}
              <select
                value={selectedSupervisor}
                onChange={(e) => setSelectedSupervisor(e.target.value)}
                className="bg-white border border-slate-300 rounded-xl text-xs py-2 px-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="ALL">Tüm Şefler ve Ekipleri</option>
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name} Ekibi</option>
                ))}
              </select>
            </div>

            {/* Quick Filter Buttons */}
            <div className="flex items-center space-x-1.5 text-xs font-bold">
              <button
                onClick={() => setFilterRiskOnly('ALL')}
                className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                  filterRiskOnly === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                }`}
              >
                Tümü ({buyerStats.length})
              </button>
              <button
                onClick={() => setFilterRiskOnly('RISK')}
                className={`px-3 py-1.5 rounded-xl border flex items-center space-x-1 transition-all cursor-pointer ${
                  filterRiskOnly === 'RISK'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                    : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Tekelleşme Riski ({kpis.criticalRiskCount + kpis.warningRiskCount})</span>
              </button>
              <button
                onClick={() => setFilterRiskOnly('DISCOVERERS')}
                className={`px-3 py-1.5 rounded-xl border flex items-center space-x-1 transition-all cursor-pointer ${
                  filterRiskOnly === 'DISCOVERERS'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Yeni Firma Bulanlar</span>
              </button>
            </div>
          </div>

          {/* Buyers Matrix Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold border-b border-slate-800 text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 px-4">Satınalmacı / Personel</th>
                    <th className="py-3.5 px-3 text-center">Farklı Firma</th>
                    <th className="py-3.5 px-3 text-center">Yeni Tedarikçi 🌟</th>
                    <th className="py-3.5 px-4">En Çok Alım Yapılan Tedarikçi</th>
                    <th className="py-3.5 px-3 text-center">Tek Firma Payı</th>
                    <th className="py-3.5 px-4">Tekelleşme Risk Durumu</th>
                    <th className="py-3.5 px-3 text-center">Ağ Skoru</th>
                    <th className="py-3.5 px-3 text-center">Detay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBuyers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500 font-medium">
                        Filtre kriterlerine uygun satınalma personeli bulunamadı.
                      </td>
                    </tr>
                  ) : (
                    filteredBuyers.map(b => {
                      const isExpanded = expandedBuyerId === b.id;
                      return (
                        <React.Fragment key={b.id}>
                          <tr className={`hover:bg-slate-50 transition-colors ${
                            b.riskLevel === 'CRITICAL' ? 'bg-rose-50/20' : ''
                          }`}>
                            {/* Name & Title */}
                            <td className="py-3.5 px-4 font-medium text-slate-900">
                              <div className="flex items-center space-x-2.5">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                                  b.type === 'supervisor'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                }`}>
                                  {b.name.charAt(0)}
                                </div>
                                <div>
                                  <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center space-x-1.5">
                                    <span>{b.name}</span>
                                    {b.type === 'supervisor' && (
                                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                                        Şef
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {b.type === 'personnel' ? `Bağlı Şef: ${b.supervisorName}` : b.title}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Distinct Vendor Count */}
                            <td className="py-3.5 px-3 text-center font-bold font-mono text-slate-800">
                              <span className="inline-block bg-slate-100 px-2 py-1 rounded-lg text-slate-700">
                                {b.distinctVendorsCount} Firma
                              </span>
                            </td>

                            {/* New Vendor Discoveries (Method 1) */}
                            <td className="py-3.5 px-3 text-center">
                              {b.newVendorsCount > 0 ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs">
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>+{b.newVendorsCount} Yeni</span>
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">-</span>
                              )}
                            </td>

                            {/* Top Vendor Name */}
                            <td className="py-3.5 px-4 font-medium text-slate-800 max-w-[220px] truncate">
                              {b.topVendor ? (
                                <div>
                                  <div className="font-bold text-slate-900 truncate" title={b.topVendor.vendorName}>
                                    {b.topVendor.vendorName}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {formatRuble(b.topVendor.spend)} ({b.topVendor.count} Sipariş)
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Kayıt yok</span>
                              )}
                            </td>

                            {/* Top Vendor Percentage */}
                            <td className="py-3.5 px-3 text-center font-mono font-bold">
                              <span className={`px-2.5 py-1 rounded-xl text-xs ${
                                b.topVendorPercentage >= 55
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300 font-black'
                                  : b.topVendorPercentage >= 38
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}>
                                %{b.topVendorPercentage}
                              </span>
                            </td>

                            {/* Risk Status (Method 2) */}
                            <td className="py-3.5 px-4">
                              {b.riskLevel === 'CRITICAL' ? (
                                <div className="flex items-center space-x-1.5 text-rose-700 font-bold">
                                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                  <span className="text-xs">⚠️ Yüksek Tekelleşme Riski</span>
                                </div>
                              ) : b.riskLevel === 'WARNING' ? (
                                <div className="flex items-center space-x-1.5 text-amber-700 font-semibold">
                                  <Info className="w-4 h-4 text-amber-500 shrink-0" />
                                  <span className="text-xs">Dikkat: Firma Yoğunlaşması</span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1.5 text-emerald-700 font-semibold">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                  <span className="text-xs">Dengeli Dağılım</span>
                                </div>
                              )}
                            </td>

                            {/* Health / Diversity Score */}
                            <td className="py-3.5 px-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-md font-mono font-black text-xs ${
                                b.diversityScore >= 70
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : b.diversityScore >= 50
                                  ? 'bg-indigo-100 text-indigo-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}>
                                {b.diversityScore}
                              </span>
                            </td>

                            {/* Expand Row Toggle */}
                            <td className="py-3.5 px-3 text-center">
                              <button
                                onClick={() => setExpandedBuyerId(isExpanded ? null : b.id)}
                                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                                  isExpanded
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                }`}
                                title="Tedarikçi Dağılım Detayı"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Detailed Breakdown for this Buyer */}
                          {isExpanded && (
                            <tr className="bg-slate-50/90 border-b border-slate-200 animate-in fade-in duration-150">
                              <td colSpan={8} className="p-4 sm:p-6">
                                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                                    <div>
                                      <h4 className="font-black text-slate-900 text-sm flex items-center space-x-2">
                                        <span>{b.name} - Tedarikçi Portföyü ve Konsantrasyon Raporu</span>
                                      </h4>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        Toplam {b.txCount} sipariş | Toplam Harcama: {formatRuble(b.totalSpend)} | Kazanılan İndirim: {formatRuble(b.totalDiscountAmount)}
                                      </p>
                                    </div>

                                    {/* Action Alert Banner for Admin */}
                                    <div className={`text-xs px-3 py-2 rounded-xl border flex items-center space-x-2 ${
                                      b.riskLevel === 'CRITICAL'
                                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                                        : b.riskLevel === 'WARNING'
                                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    }`}>
                                      <Info className="w-4 h-4 shrink-0" />
                                      <span className="font-semibold">{b.riskReason}</span>
                                    </div>
                                  </div>

                                  {/* List of Vendors for this Buyer */}
                                  <div>
                                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                                      Çalışılan Tüm Tedarikçiler ve Harcama Payları
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                      {b.vendorList.map((v, idx) => (
                                        <div
                                          key={v.vendorName}
                                          className={`p-3 rounded-xl border transition-all ${
                                            idx === 0 && b.topVendorPercentage >= 50
                                              ? 'bg-rose-50/50 border-rose-200'
                                              : 'bg-slate-50 border-slate-200'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-900 text-xs truncate max-w-[170px]" title={v.vendorName}>
                                              {idx + 1}. {v.vendorName}
                                            </span>
                                            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                                              v.percentage >= 50
                                                ? 'bg-rose-600 text-white'
                                                : v.percentage >= 30
                                                ? 'bg-amber-100 text-amber-800'
                                                : 'bg-slate-200 text-slate-700'
                                            }`}>
                                              %{v.percentage}
                                            </span>
                                          </div>

                                          <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between">
                                            <span>Tutar: {formatRuble(v.spend)}</span>
                                            <span>{v.count} İşlem</span>
                                          </div>

                                          {/* Mini progress bar */}
                                          <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full ${
                                                v.percentage >= 50 ? 'bg-rose-500' : v.percentage >= 30 ? 'bg-amber-500' : 'bg-indigo-600'
                                              }`}
                                              style={{ width: `${Math.min(v.percentage, 100)}%` }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Discovered New Vendors by this buyer */}
                                  {b.newVendorsCount > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                      <div className="text-xs font-bold text-emerald-800 flex items-center space-x-1.5 mb-1.5">
                                        <Sparkles className="w-4 h-4 text-emerald-500" />
                                        <span>Bu Personelin Şirkete Kazandırdığı Yeni Tedarikçiler ({b.newVendorsCount}):</span>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {b.newVendorsList.map((nv, i) => (
                                          <span key={i} className="bg-emerald-100 text-emerald-900 text-[11px] font-bold px-2.5 py-1 rounded-lg border border-emerald-200">
                                            ✓ {nv}
                                          </span>
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
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-VIEW 2: NEW VENDOR DISCOVERIES SHOWCASE (Method 1)        */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'discoveries' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-slate-950 p-5 rounded-2xl text-white border border-emerald-700/40 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4" />
                <span>Pozitif Teşvik ve Ağ Genişletme Vitrini</span>
              </div>
              <h3 className="text-lg font-black text-white mt-1">
                Tedarik Ağına Yeni Kazandırılan Firmalar
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Personellerimizin alternatif arayışlarıyla GES Construction bünyesine ilk kez kattığı firmalar ve sağlanan tasarruflar.
              </p>
            </div>

            <div className="flex items-center space-x-3 bg-emerald-950/80 px-4 py-2.5 rounded-xl border border-emerald-800 text-right">
              <div>
                <div className="text-[10px] text-emerald-300 font-bold uppercase">Toplam Yeni Firma</div>
                <div className="text-xl font-black text-emerald-400">+{newVendorDiscoveries.length} Adet</div>
              </div>
            </div>
          </div>

          {/* New Vendors Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Tedarikçi Firma Adı</th>
                    <th className="py-3 px-3">Kategori</th>
                    <th className="py-3 px-3">Şantiye</th>
                    <th className="py-3 px-3">Ağa Kazandıran Alıcı</th>
                    <th className="py-3 px-3 text-center">İlk Sipariş Tarihi</th>
                    <th className="py-3 px-3 text-right">İlk Sipariş Tutarı</th>
                    <th className="py-3 px-3 text-right">Kazanılan İndirim</th>
                    <th className="py-3 px-3 text-center">İndirim Oranı</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {newVendorDiscoveries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 px-6 text-center">
                        <div className="max-w-md mx-auto space-y-2">
                          <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                            <Building2 className="w-6 h-6" />
                          </div>
                          <div className="font-bold text-slate-800 text-sm">
                            Kayıtlı {kpis.totalActiveVendors} Firmanın Tamamı Mevcut Tedarikçi Portföyüdür
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            Sistemdeki 44 firma GES Construction'ın önceden beri çalıştığı kayıtlı tedarikçilerdir. Satınalmacılar ilk kez çalışılacak yeni bir firma kazandırıp indirim girişinde <span className="font-semibold text-indigo-700">"Tedarikçi Ağına Eklenen YENİ FİRMA"</span> seçeneğini işaretlediğinde, burada kaşif alıcı ile birlikte listelenecek ve +Puan kazanacaktır.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    newVendorDiscoveries.map((disc, idx) => (
                      <tr key={disc.vendorKey} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-900 flex items-center space-x-2">
                          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-black shrink-0">
                            {idx + 1}
                          </span>
                          <span>{disc.vendorName}</span>
                        </td>
                        <td className="py-3 px-3 text-slate-600 font-medium">{disc.category}</td>
                        <td className="py-3 px-3 text-slate-600">{disc.jobsiteName}</td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-slate-800">{disc.buyerName}</span>
                          <span className={`ml-1 text-[10px] px-1.5 py-0.2 rounded font-bold ${
                            disc.buyerType === 'supervisor' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {disc.buyerType === 'supervisor' ? 'Şef' : 'Personel'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-slate-600">{disc.date}</td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-800">
                          {formatRuble(disc.firstAgreedPrice)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">
                          {formatRuble(disc.firstDiscountAmount)}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold">
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                            %{disc.firstDiscountPercentage}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* SUB-VIEW 3: COMPANY-WIDE VENDOR CONCENTRATION (Method 2)      */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'vendors' && (
        <div className="space-y-4">
          <div className="bg-slate-900 p-5 rounded-2xl text-white border border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Store className="w-4 h-4" />
                <span>Şirket Hacim Yoğunlaşması</span>
              </div>
              <h3 className="text-lg font-black text-white mt-1">
                Tedarikçilere Göre Toplam Şirket Harcamaları ve Pazar Payı
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                GES Construction'ın bütçesinin hangi tedarikçilere aktığını ve kaç personelin o firmadan alım yaptığını gösterir.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Tedarikçi Firma</th>
                    <th className="py-3 px-3 text-right">Toplam Harcama (RUB)</th>
                    <th className="py-3 px-3 text-center">Toplam Harcama Payı (%)</th>
                    <th className="py-3 px-3 text-right">Sağlanan Net İndirim</th>
                    <th className="py-3 px-3 text-center">Sipariş Sayısı</th>
                    <th className="py-3 px-4">Alım Yapan Satınalmacılar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vendorConcentrationSummary.slice(0, 25).map((v, i) => (
                    <tr key={v.vendorName} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400 font-bold">{i + 1}</td>
                      <td className="py-3 px-4 font-bold text-slate-900 text-xs sm:text-sm">{v.vendorName}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">{formatRuble(v.totalSpend)}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          v.marketSharePercentage >= 20
                            ? 'bg-rose-100 text-rose-800 font-black'
                            : v.marketSharePercentage >= 10
                            ? 'bg-amber-100 text-amber-800 font-bold'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          %{v.marketSharePercentage}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600">{formatRuble(v.totalDiscount)}</td>
                      <td className="py-3 px-3 text-center font-mono font-bold text-slate-700">{v.txCount}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {v.buyersList.slice(0, 3).map((bName, bi) => (
                            <span key={bi} className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded font-medium truncate max-w-[110px]">
                              {bName}
                            </span>
                          ))}
                          {v.buyersList.length > 3 && (
                            <span className="text-[10px] text-slate-400 font-bold self-center">
                              +{v.buyersList.length - 3} kişi
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
