import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  DollarSign,
  TrendingUp,
  Package,
  Layers,
  ChevronRight,
  ArrowUpRight,
  PieChart as PieIcon,
  BarChart3,
  Filter,
  Search,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Clock,
  Compass,
  FileText
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
  PieChart,
  Pie
} from 'recharts';
import { InvoiceRecord, Jobsite } from '../types';
import { formatRuble } from '../utils/format';
import { NormalizedProcurementItem, resolveSpendJobsite } from '../utils/procurementAnalyticsCore';

interface JobsiteBreakdownProps {
  /** Dashboard'un tek harcama defteri: KPI ve diğer panellerle aynı (KDV dahil fatura toplamına ölçekli) kalemler. */
  spendItems: NormalizedProcurementItem[];
  jobsites: Jobsite[];
  selectedJobsiteId?: string;
  onNavigateToTab: (tabId: string) => void;
  onNavigateToMaterial?: (materialName: string, category?: string) => void;
  onApplyJobsiteFilter?: (jobsiteId: string) => void;
  onApplyCategoryFilter?: (category: string) => void;
}

export interface MaterialStatItem {
  name: string;
  category: string;
  totalSpend: number;
  totalQty: number;
  unit: string;
  count: number;
  avgUnitPrice: number;
  lastDate: string;
  supplier: string;
}

export interface JobsiteDetailStat {
  id: string;
  name: string;
  totalSpend: number;
  invoiceCount: number;
  itemCount: number;
  materials: Record<string, MaterialStatItem>;
  categories: Record<string, number>;
  recentInvoices: InvoiceRecord[];
  percentage?: number;
}

const PALETTE = [
  '#4f46e5', // indigo
  '#059669', // emerald
  '#d97706', // amber
  '#0284c7', // sky
  '#7c3aed', // purple
  '#e11d48', // rose
  '#0d9488', // teal
  '#ea580c', // orange
  '#2563eb', // blue
  '#64748b'  // slate
];

export const SmartDashboardInsights: React.FC<JobsiteBreakdownProps> = ({
  spendItems = [],
  jobsites = [],
  selectedJobsiteId: propJobsiteId,
  onNavigateToTab,
  onNavigateToMaterial,
  onApplyJobsiteFilter,
  onApplyCategoryFilter
}) => {
  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>(propJobsiteId || 'ALL');
  const [materialSearchQuery, setMaterialSearchQuery] = useState<string>('');

  // Dışarıdan gelen filtre değiştiğinde iç durumla reaktif senkronize et
  useEffect(() => {
    if (propJobsiteId !== undefined) {
      setSelectedJobsiteId(propJobsiteId || 'ALL');
    }
  }, [propJobsiteId]);

  // 1. Şantiye bazlı genel harcama ve kalem hesaplamaları
  const jobsiteStats = useMemo(() => {
    const siteMap: Record<string, JobsiteDetailStat> = {};

    // Şantiyeleri hazırla
    jobsites.forEach(j => {
      siteMap[j.id] = {
        id: j.id,
        name: j.name,
        totalSpend: 0,
        invoiceCount: 0,
        itemCount: 0,
        materials: {},
        categories: {},
        recentInvoices: []
      };
    });

    // Paylaşılan harcama defterini tara (fatura sayısı = farklı fatura kimliği)
    const siteInvoiceIds: Record<string, Set<string>> = {};
    spendItems.forEach(it => {
      const { id: siteId, name: siteName } = resolveSpendJobsite(it, jobsites);

      if (!siteMap[siteId]) {
        siteMap[siteId] = {
          id: siteId,
          name: siteName,
          totalSpend: 0,
          invoiceCount: 0,
          itemCount: 0,
          materials: {},
          categories: {},
          recentInvoices: []
        };
      }

      const site = siteMap[siteId];
      const ids = siteInvoiceIds[siteId] || (siteInvoiceIds[siteId] = new Set<string>());
      if (!ids.has(it.invoiceId)) {
        ids.add(it.invoiceId);
        site.invoiceCount += 1;
        site.recentInvoices.push(it.rawInvoice);
      }

      const matName = (it.materialName || it.originalName || 'Diğer Malzeme').trim();
      const category = it.canonicalCategory;
      const total = it.totalPrice;
      const itemDate = it.rawInvoice?.date || it.date || '';

      site.totalSpend += total;
      site.itemCount += 1;
      site.categories[category] = (site.categories[category] || 0) + total;

      if (!site.materials[matName]) {
        site.materials[matName] = {
          name: matName,
          category,
          totalSpend: 0,
          totalQty: 0,
          unit: it.unit || 'adet',
          count: 0,
          avgUnitPrice: 0,
          lastDate: itemDate,
          supplier: it.supplier || ''
        };
      }

      const m = site.materials[matName];
      m.totalSpend += total;
      m.totalQty += it.quantity;
      m.count += 1;
      if (itemDate && (!m.lastDate || itemDate > m.lastDate)) {
        m.lastDate = itemDate;
      }
    });

    const list = Object.values(siteMap).filter(s => s.totalSpend > 0 || s.invoiceCount > 0);
    const overallTotalSpend = list.reduce((acc, curr) => acc + curr.totalSpend, 0);

    const sortedSites = list.sort((a, b) => b.totalSpend - a.totalSpend).map(s => ({
      ...s,
      percentage: overallTotalSpend > 0 ? Number(((s.totalSpend / overallTotalSpend) * 100).toFixed(1)) : 0
    }));

    return {
      sites: sortedSites,
      overallTotalSpend
    };
  }, [spendItems, jobsites]);

  // Seçili şantiye bilgisi (ALL ise tüm şantiyelerin toplamı)
  const currentSite = useMemo<JobsiteDetailStat>(() => {
    if (selectedJobsiteId === 'ALL') {
      const aggregatedMaterials: Record<string, MaterialStatItem> = {};
      const aggregatedCategories: Record<string, number> = {};

      jobsiteStats.sites.forEach(site => {
        Object.values(site.materials).forEach((m: MaterialStatItem) => {
          if (!aggregatedMaterials[m.name]) {
            aggregatedMaterials[m.name] = { ...m };
          } else {
            aggregatedMaterials[m.name].totalSpend += m.totalSpend;
            aggregatedMaterials[m.name].totalQty += m.totalQty;
            aggregatedMaterials[m.name].count += m.count;
          }
        });

        Object.entries(site.categories).forEach(([cat, amount]) => {
          aggregatedCategories[cat] = (aggregatedCategories[cat] || 0) + (amount as number);
        });
      });

      return {
        id: 'ALL',
        name: 'Tüm Şantiyeler (Genel Konsolide)',
        totalSpend: jobsiteStats.overallTotalSpend,
        invoiceCount: jobsiteStats.sites.reduce((a, b) => a + b.invoiceCount, 0),
        itemCount: jobsiteStats.sites.reduce((a, b) => a + b.itemCount, 0),
        materials: aggregatedMaterials,
        categories: aggregatedCategories,
        recentInvoices: [],
        percentage: 100
      };
    }

    const found = jobsiteStats.sites.find(s => s.id === selectedJobsiteId);
    if (found) {
      return found;
    }

    return {
      id: selectedJobsiteId,
      name: 'Seçili Şantiye',
      totalSpend: 0,
      invoiceCount: 0,
      itemCount: 0,
      materials: {},
      categories: {},
      recentInvoices: [],
      percentage: 0
    };
  }, [selectedJobsiteId, jobsiteStats]);

  // Seçili şantiyedeki malzemelerin listesi
  const materialList = useMemo(() => {
    let list = Object.values(currentSite.materials).map((m: MaterialStatItem) => ({
      ...m,
      avgUnitPrice: m.totalQty > 0 ? m.totalSpend / m.totalQty : 0,
      shareInSite: currentSite.totalSpend > 0 ? Number(((m.totalSpend / currentSite.totalSpend) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.totalSpend - a.totalSpend);

    if (materialSearchQuery.trim()) {
      const q = materialSearchQuery.toLowerCase().trim();
      list = list.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.supplier.toLowerCase().includes(q)
      );
    }

    return list;
  }, [currentSite, materialSearchQuery]);

  // Kategori grafik verisi (Pasta Grafiği)
  const categoryChartData = useMemo(() => {
    const list = Object.entries(currentSite.categories).map(([name, spend]) => {
      const numericSpend = Number(spend) || 0;
      return {
        name,
        spend: numericSpend,
        percentage: currentSite.totalSpend > 0 ? Number(((numericSpend / currentSite.totalSpend) * 100).toFixed(1)) : 0
      };
    }).sort((a, b) => b.spend - a.spend);

    return list.slice(0, 7); // İlk 7 kategori
  }, [currentSite]);

  // En yüksek harcanan ilk 8 malzeme bar grafiği
  const topMaterialsBarData = useMemo(() => {
    return materialList.slice(0, 8).map(m => ({
      name: m.name.length > 20 ? m.name.substring(0, 18) + '...' : m.name,
      fullName: m.name,
      totalSpend: m.totalSpend,
      qtyStr: `${m.totalQty.toLocaleString('tr-TR')} ${m.unit}`,
      share: m.shareInSite
    }));
  }, [materialList]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden space-y-6 p-6">
      {/* 1. ÜST BAŞLIK & HUB ÇERÇEVESİ */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="inline-flex items-center space-x-2 bg-indigo-50 text-indigo-700 border border-indigo-200/60 px-3 py-1 rounded-full text-xs font-bold mb-1.5">
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            <span>Şantiye Harcama & Malzeme Dağılım İstihbaratı</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Şantiye Bazlı Genel Harcamalar & Malzeme İcmali
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-3xl">
            Her şantiyenin ne kadarlık toplam bütçe tükettiğini, hangi malzemelere ne kadar para harcandığını ve birim maliyetlerini detaylı grafiklerle inceleyin.
          </p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={() => onNavigateToTab('special-materials')}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-2xl text-xs font-black shadow-xs transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Sparkles className="w-4 h-4" />
            <span>Kritik Malzeme Analizi (Demir/Gazblok)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. ŞANTİYE SEÇİCİ KARTLARI */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
            <Compass className="w-4 h-4 text-indigo-600" />
            <span>İncelenecek Şantiyeyi Seçin ({jobsiteStats.sites.length} Aktif Şantiye)</span>
          </span>
          {selectedJobsiteId !== 'ALL' && (
            <button
              type="button"
              onClick={() => {
                setSelectedJobsiteId('ALL');
                if (onApplyJobsiteFilter) onApplyJobsiteFilter('ALL');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
            >
              Tüm Şantiyelerin Konsolide Görünümüne Dön
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* TÜMÜ KARTI */}
          <button
            type="button"
            onClick={() => {
              setSelectedJobsiteId('ALL');
              if (onApplyJobsiteFilter) onApplyJobsiteFilter('ALL');
            }}
            className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
              selectedJobsiteId === 'ALL'
                ? 'bg-slate-950 text-white border-slate-950 shadow-md ring-2 ring-slate-400 scale-[1.02]'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                  selectedJobsiteId === 'ALL' ? 'bg-slate-800 text-amber-400' : 'bg-slate-200 text-slate-700'
                }`}>
                  TÜMÜ
                </span>
                <span className="text-[11px] font-mono font-bold">%100</span>
              </div>
              <h4 className="font-black text-xs sm:text-sm tracking-tight line-clamp-1">
                Genel Konsolide
              </h4>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/40">
              <span className={`font-mono font-black text-xs block ${
                selectedJobsiteId === 'ALL' ? 'text-amber-400' : 'text-slate-900'
              }`}>
                {formatRuble(jobsiteStats.overallTotalSpend)}
              </span>
            </div>
          </button>

          {/* ŞANTİYE KARTLARI */}
          {jobsiteStats.sites.map((site, idx) => {
            const isSelected = selectedJobsiteId === site.id;

            return (
              <button
                key={site.id}
                type="button"
                onClick={() => {
                  setSelectedJobsiteId(site.id);
                  if (onApplyJobsiteFilter) onApplyJobsiteFilter(site.id);
                }}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg ring-2 ring-indigo-300 scale-[1.02]'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-2xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: isSelected ? '#fbbf24' : PALETTE[idx % PALETTE.length] }}
                    />
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                      isSelected ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-100 text-slate-600'
                    }`}>
                      %{site.percentage}
                    </span>
                  </div>
                  <h4 className={`font-bold text-xs tracking-tight line-clamp-1 ${isSelected ? 'text-white font-black' : 'text-slate-900'}`}>
                    {site.name}
                  </h4>
                  <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {site.invoiceCount} fatura • {site.itemCount} kalem
                  </p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-100/30">
                  <span className={`font-mono font-black text-xs block ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                    {formatRuble(site.totalSpend)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. SEÇİLİ ŞANTİYENİN GRAFİKLERİ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Grafik A: Bu Şantiyede En Çok Harcanan Malzemeler (BarChart) */}
        <div className="lg:col-span-7 bg-slate-50/70 rounded-3xl p-5 border border-slate-200/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-200/60 pb-2.5">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                  <span>{currentSite.name} — En Yüksek Bütçeli Malzemeler</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Bu projede en fazla harcama yapılan ilk 8 malzeme kalemi
                </p>
              </div>
              <span className="text-xs font-mono font-bold bg-white text-indigo-700 px-2.5 py-1 rounded-xl border border-slate-200 shadow-2xs">
                {materialList.length} Toplam Kalem
              </span>
            </div>

            <div className="w-full h-64">
              {topMaterialsBarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topMaterialsBarData}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={v => `${(v / 1000).toFixed(0)}k ₽`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 11, fill: '#1e293b', fontWeight: 600 }}
                    />
                    <Tooltip
                      formatter={(val: any, name: any, props: any) => [
                        `${formatRuble(Number(val))} (%${props.payload.share} pay, ${props.payload.qtyStr})`,
                        'Toplam Harcama'
                      ]}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#fff'
                      }}
                    />
                    <Bar dataKey="totalSpend" fill="#4f46e5" radius={[0, 8, 8, 0]}>
                      {topMaterialsBarData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                  Bu şantiyede malzeme kaydı bulunamadı
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
            <span>Şantiye Toplam Harcaması: <strong className="text-slate-900 font-mono">{formatRuble(currentSite.totalSpend)}</strong></span>
            <span>İşlem Gören Fatura: <strong className="text-slate-900 font-mono">{currentSite.invoiceCount} adet</strong></span>
          </div>
        </div>

        {/* Grafik B: Kategori Harcama Kırılımı (Pasta Grafiği) */}
        <div className="lg:col-span-5 bg-slate-50/70 rounded-3xl p-5 border border-slate-200/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 border-b border-slate-200/60 pb-2.5">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center space-x-2">
                  <PieIcon className="w-4 h-4 text-emerald-600" />
                  <span>Kategori Bütçe Dağılımı</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Harcamaların malzeme kategorilerine göre dağılımı
                </p>
              </div>
            </div>

            <div className="w-full h-44 flex items-center justify-center">
              {categoryChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryChartData}
                      dataKey="spend"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={65}
                      innerRadius={35}
                      paddingAngle={3}
                    >
                      {categoryChartData.map((_, idx) => (
                        <Cell key={`cat-${idx}`} fill={PALETTE[idx % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, name: any, props: any) => [
                        `${formatRuble(Number(val))} (%${props.payload.percentage})`,
                        name
                      ]}
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
                <div className="text-slate-400 text-xs">Kategori verisi yok</div>
              )}
            </div>
          </div>

          {/* Kategori Etiketleri Listesi */}
          <div className="mt-2 space-y-1 max-h-28 overflow-y-auto pr-1">
            {categoryChartData.map((cat, idx) => (
              <div
                key={`${cat.name}-${idx}`}
                onClick={() => onApplyCategoryFilter && onApplyCategoryFilter(cat.name)}
                className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-slate-200/60 border-b border-slate-200/40 last:border-0 cursor-pointer transition-colors"
                title="Bu kategoriye göre filtrele"
              >
                <div className="flex items-center space-x-2 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                  />
                  <span className="font-semibold text-slate-800 truncate">{cat.name}</span>
                </div>
                <div className="flex items-center space-x-2 font-mono shrink-0">
                  <span className="font-bold text-slate-900">{formatRuble(cat.spend)}</span>
                  <span className="text-[10px] text-slate-500 font-semibold">(%{cat.percentage})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4. SEÇİLİ ŞANTİYENİN TÜM MALZEME ALIM DETAY TABLOSU */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center space-x-2">
            <Package className="w-4 h-4 text-indigo-600" />
            <h4 className="text-sm font-black text-slate-900">
              {currentSite.name} — Malzeme Harcama Listesi ({materialList.length} Çeşit Malzeme)
            </h4>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Bu şantiyedeki malzemeyi ara..."
              value={materialSearchQuery}
              onChange={e => setMaterialSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-xs border-b border-slate-200 z-10">
              <tr className="text-slate-600 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-2.5 px-3 w-8 text-center">#</th>
                <th className="py-2.5 px-3">Malzeme Adı</th>
                <th className="py-2.5 px-3">Kategori</th>
                <th className="py-2.5 px-3 text-right">Toplam Alım Miktarı</th>
                <th className="py-2.5 px-3 text-right">Ortalama Birim Fiyat</th>
                <th className="py-2.5 px-3 text-right">Toplam Harcama (₽)</th>
                <th className="py-2.5 px-3 text-right">Şantiye İçi Payı</th>
                <th className="py-2.5 px-3 text-center">Alım / Kıyas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {materialList.length > 0 ? (
                materialList.map((m, idx) => (
                  <tr
                    key={`${m.name}-${m.category}-${idx}`}
                    onClick={() => onNavigateToMaterial ? onNavigateToMaterial(m.name, m.category) : onNavigateToTab('material-compare')}
                    className="hover:bg-indigo-50/50 transition-colors cursor-pointer group"
                    title="Malzeme Fiyat Karşılaştırma ekranında incelemek için tıklayın"
                  >
                    <td className="py-2.5 px-3 text-center font-mono text-slate-400 font-bold">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900 group-hover:text-indigo-700 transition-colors line-clamp-1" title={m.name}>
                        {m.name}
                      </div>
                      {m.supplier && (
                        <div className="text-[10px] text-slate-400 italic line-clamp-1">{m.supplier}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onApplyCategoryFilter) onApplyCategoryFilter(m.category);
                        }}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 border border-slate-200/60 transition-colors cursor-pointer"
                        title="Bu kategoriye göre filtrele"
                      >
                        {m.category}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                      {m.totalQty.toLocaleString('tr-TR')} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                      {formatRuble(m.avgUnitPrice)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                      {formatRuble(m.totalSpend)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700">
                      %{m.shareInSite}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className="inline-flex items-center space-x-1 font-mono text-[11px] text-slate-600 group-hover:text-indigo-700 font-bold">
                        <span>{m.count} fatura</span>
                        <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-600" />
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                    Aranan kritere uygun malzeme kaydı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
