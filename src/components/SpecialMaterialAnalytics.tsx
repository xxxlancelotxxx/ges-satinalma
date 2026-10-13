import React, { useState, useMemo } from 'react';
import { InvoiceRecord, Jobsite } from '../types';
import { formatRuble, formatRubleWithDecimals } from '../utils/format';
import {
  Building2,
  Calendar,
  Search,
  TrendingUp,
  Boxes,
  BarChart3,
  FileText,
  ArrowUpDown,
  Flame,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  TrendingDown,
  Layers,
  Sparkles,
  RefreshCcw,
  X,
  ExternalLink,
  Wrench,
  PackageCheck,
  Compass,
  ChevronDown,
  Check,
  Filter,
  DollarSign,
  Tag,
  ArrowRight
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter } from '../utils/filterHelpers';
import { normalizeVendorName, areVendorsEqual, extractCanonicalVendors } from '../utils/vendorNormalizer';
import {
  getNormalizedProcurementItems,
  SPECIAL_CATEGORY_MAP,
  SpecialCategoryKey
} from '../utils/procurementAnalyticsCore';

export type MainCategoryKey = 'DEMIR' | 'CELIK' | 'GAZBLOK' | 'IZOLASYON';

export interface ExtractedMaterialItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  jobsiteId: string;
  jobsiteName: string;
  supplier: string;
  supervisorName: string;
  categoryKey: MainCategoryKey;
  categoryLabel: string;
  subType: string;
  materialName: string;
  originalName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  fileUrl?: string;
  rawInvoice: InvoiceRecord;
}

interface Props {
  invoices: InvoiceRecord[];
  jobsites: Jobsite[];
  onNavigateToInvoiceDrive?: () => void;
  onOpenInvoiceDetail?: (invoice: InvoiceRecord) => void;
}

// 4 KURUMSAL VE DÜZENLİ ANA KATEGORİ TANIMI
const CATEGORIES: {
  key: MainCategoryKey;
  title: string;
  shortCode: string;
  subtitle: string;
  description: string;
  icon: any;
  accentColor: string;
  bgGradient: string;
  chipActive: string;
}[] = [
  {
    key: 'DEMIR',
    title: 'İnşaat Demiri',
    shortCode: 'A500C',
    subtitle: 'Nervürlü Donatı Çapları',
    description: 'Yalnızca standart nervürlü inşaat demirleri (A500C Ø8 - Ø40 mm çapları)',
    icon: Flame,
    accentColor: '#f59e0b', // amber
    bgGradient: 'from-amber-500/10 via-amber-500/5 to-transparent',
    chipActive: 'bg-amber-500 text-slate-950 font-black ring-2 ring-amber-400 shadow-md'
  },
  {
    key: 'CELIK',
    title: 'Çelik Malzemeler',
    shortCode: 'ÇELİK',
    subtitle: 'Köşebent, Kutu Profil, Çelik Boru & Sac',
    description: 'Köşebent demir, kutu profil borular, dikişli/kaynaklı çelik borular, şveller, çelik sac ve hasır ürünleri',
    icon: Wrench,
    accentColor: '#8b5cf6', // purple
    bgGradient: 'from-purple-500/10 via-purple-500/5 to-transparent',
    chipActive: 'bg-purple-600 text-white font-black ring-2 ring-purple-400 shadow-md'
  },
  {
    key: 'GAZBLOK',
    title: 'Gazbeton & Duvar Bloğu',
    shortCode: 'BLOK',
    subtitle: 'Bonolit, ISTKULT, Poritep & KBB',
    description: 'Hücreli gazbeton bloklar, lento elemanları, KBB beton blokları ve özel yapıştırıcı harçlar',
    icon: Boxes,
    accentColor: '#10b981', // emerald
    bgGradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
    chipActive: 'bg-emerald-600 text-white font-black ring-2 ring-emerald-400 shadow-md'
  },
  {
    key: 'IZOLASYON',
    title: 'İzolasyon & Yalıtım',
    subtitle: 'Penoplex XPS, Membran & Likit',
    shortCode: 'YALITIM',
    description: 'Temel & teras su yalıtım membranları (Icopal, Technoelast), XPS levhalar ve geotekstiller',
    icon: ShieldCheck,
    accentColor: '#0ea5e9', // sky
    bgGradient: 'from-sky-500/10 via-sky-500/5 to-transparent',
    chipActive: 'bg-sky-600 text-white font-black ring-2 ring-sky-400 shadow-md'
  }
];

const PALETTE = [
  '#d97706', '#059669', '#0284c7', '#7c3aed', '#e11d48',
  '#0d9488', '#ea580c', '#4f46e5', '#16a34a', '#2563eb'
];

export const SpecialMaterialAnalytics: React.FC<Props> = ({
  invoices = [],
  jobsites = [],
  onNavigateToInvoiceDrive,
  onOpenInvoiceDetail
}) => {
  // Seçili Ana Kategori (Varsayılan İnşaat Demiri)
  const [activeCategory, setActiveCategory] = useState<MainCategoryKey>('DEMIR');
  // Seçili Alt Kalem (Varsayılan 'ALL' - Tümü)
  const [activeSubType, setActiveSubType] = useState<string>('ALL');
  // Şantiye Filtresi
  const [selectedJobsite, setSelectedJobsite] = useState<string>('ALL');
  // Tedarikçi Filtresi
  const [selectedVendor, setSelectedVendor] = useState<string>('ALL');
  // Fatura No Filtresi
  const [invoiceNoFilter, setInvoiceNoFilter] = useState<string>('');
  // Tarih Filtresi
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  // Arama Terimi
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Sıralama
  const [sortBy, setSortBy] = useState<'date' | 'total' | 'price' | 'jobsite'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  // Grafik Metriği (Birim Fiyat veya Toplam Harcama)
  const [chartMetric, setChartMetric] = useState<'price' | 'spend'>('price');
  // Fatura Önizleme Modalı
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceRecord | null>(null);

  // 1. FATURALARDAN GERÇEK KALEMLERİN MERKEZİ SINGLE SOURCE OF TRUTH (SSOT) İLE ELDE EDİLMESİ
  const allExtractedItems = useMemo<ExtractedMaterialItem[]>(() => {
    const normItems = getNormalizedProcurementItems(invoices);
    return normItems
      .filter(it => Boolean(it.specialCategoryKey))
      .map(it => {
        const specKey = it.specialCategoryKey as MainCategoryKey;
        const categoryLabel = SPECIAL_CATEGORY_MAP[specKey as SpecialCategoryKey]?.label || it.canonicalCategory;
        const subType = it.subType || 'Genel Kalem';
        const jobsiteName = it.jobsiteName || jobsites.find(j => j.id === it.jobsiteId)?.name || 'Merkez';

        return {
          id: it.id,
          invoiceId: it.invoiceId,
          invoiceNumber: it.invoiceNumber,
          date: it.date,
          jobsiteId: it.jobsiteId,
          jobsiteName,
          supplier: it.supplier,
          supervisorName: it.supervisorName,
          categoryKey: specKey,
          categoryLabel,
          subType,
          materialName: it.materialName,
          originalName: it.originalName,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          totalPrice: it.totalPrice,
          fileUrl: it.fileUrl,
          rawInvoice: it.rawInvoice
        };
      });
  }, [invoices, jobsites]);

  // 2. KATEGORİ BAZLI TOPLAM ÖZETLERİ (Kartların üzerindeki metrikler)
  const categorySummaries = useMemo(() => {
    const summary: Record<MainCategoryKey, { count: number; spend: number; uniqueJobsites: number }> = {
      DEMIR: { count: 0, spend: 0, uniqueJobsites: 0 },
      CELIK: { count: 0, spend: 0, uniqueJobsites: 0 },
      GAZBLOK: { count: 0, spend: 0, uniqueJobsites: 0 },
      IZOLASYON: { count: 0, spend: 0, uniqueJobsites: 0 }
    };

    const siteSets: Record<MainCategoryKey, Set<string>> = {
      DEMIR: new Set(),
      CELIK: new Set(),
      GAZBLOK: new Set(),
      IZOLASYON: new Set()
    };

    allExtractedItems.forEach(item => {
      if (summary[item.categoryKey]) {
        summary[item.categoryKey].count += 1;
        summary[item.categoryKey].spend += item.totalPrice;
        siteSets[item.categoryKey].add(item.jobsiteName);
      }
    });

    Object.keys(siteSets).forEach(key => {
      summary[key as MainCategoryKey].uniqueJobsites = siteSets[key as MainCategoryKey].size;
    });

    return summary;
  }, [allExtractedItems]);

  // 3. SADECE SEÇİLİ KATEGORİYE AİT DÜZENLİ ALT MALZEME LİSTESİ
  const currentCategorySubTypes = useMemo(() => {
    const categoryItems = allExtractedItems.filter(i => i.categoryKey === activeCategory);

    const map: Record<string, { count: number; spend: number; minPrice: number; maxPrice: number; avgPrice: number; prices: number[] }> = {};
    categoryItems.forEach(item => {
      if (!map[item.subType]) {
        map[item.subType] = { count: 0, spend: 0, minPrice: Infinity, maxPrice: 0, avgPrice: 0, prices: [] };
      }
      map[item.subType].count += 1;
      map[item.subType].spend += item.totalPrice;
      if (item.unitPrice > 0) {
        map[item.subType].prices.push(item.unitPrice);
        map[item.subType].minPrice = Math.min(map[item.subType].minPrice, item.unitPrice);
        map[item.subType].maxPrice = Math.max(map[item.subType].maxPrice, item.unitPrice);
      }
    });

    // Ortalama fiyatları hesapla
    Object.values(map).forEach(m => {
      if (m.prices.length > 0) {
        m.avgPrice = m.prices.reduce((a, b) => a + b, 0) / m.prices.length;
      } else {
        m.minPrice = 0;
      }
    });

    // İnşaat demiri için çaplara göre doğal sıralama (Ø8, Ø10, Ø12...)
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => {
        if (activeCategory === 'DEMIR') {
          const numA = parseInt(a.name.replace(/\D/g, ''), 10) || 999;
          const numB = parseInt(b.name.replace(/\D/g, ''), 10) || 999;
          return numA - numB;
        }
        return b.spend - a.spend;
      });
  }, [allExtractedItems, activeCategory]);

  // Tedarikçi listesi
  const canonicalVendors = useMemo(() => {
    return extractCanonicalVendors(allExtractedItems.map(i => ({ vendorName: i.supplier })));
  }, [allExtractedItems]);

  const isAnyFilterActive = useMemo(() => {
    return (
      activeSubType !== 'ALL' ||
      selectedJobsite !== 'ALL' ||
      selectedVendor !== 'ALL' ||
      Boolean(invoiceNoFilter.trim()) ||
      (dateFilter.preset && dateFilter.preset !== 'all') ||
      Boolean(searchTerm.trim())
    );
  }, [activeSubType, selectedJobsite, selectedVendor, invoiceNoFilter, dateFilter, searchTerm]);

  const handleResetFilters = () => {
    setActiveSubType('ALL');
    setSelectedJobsite('ALL');
    setSelectedVendor('ALL');
    setInvoiceNoFilter('');
    setDateFilter({ preset: 'all' });
    setSearchTerm('');
  };

  // 4. FİLTRELENMİŞ MALZEME KALEMLERİ
  const filteredItems = useMemo(() => {
    return allExtractedItems
      .filter(item => {
        // 1. Kategori Kontrolü (Kesin filtre)
        if (item.categoryKey !== activeCategory) {
          return false;
        }

        // 2. Alt Malzeme Kontrolü (Örn: Sadece Ø12 Demir veya Tümü)
        if (activeSubType !== 'ALL' && item.subType !== activeSubType) {
          return false;
        }

        // 3. Şantiye Filtresi
        if (selectedJobsite !== 'ALL' && item.jobsiteId !== selectedJobsite && item.jobsiteName !== selectedJobsite) {
          return false;
        }

        // 4. Tedarikçi Filtresi
        if (selectedVendor !== 'ALL' && !areVendorsEqual(item.supplier, selectedVendor)) {
          return false;
        }

        // 5. Fatura No Filtresi
        if (invoiceNoFilter.trim() && !String(item.invoiceNumber || '').toLowerCase().includes(invoiceNoFilter.toLowerCase().trim())) {
          return false;
        }

        // 6. Tarih Filtresi
        if (!dateFilter.preset || dateFilter.preset === 'all' || !matchesDateFilter(item.date, dateFilter)) {
          if (dateFilter.preset && dateFilter.preset !== 'all') return false;
        }

        // 7. Arama Çubuğu
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim();
          const match =
            item.materialName.toLowerCase().includes(q) ||
            item.subType.toLowerCase().includes(q) ||
            (item.originalName && item.originalName.toLowerCase().includes(q)) ||
            item.jobsiteName.toLowerCase().includes(q) ||
            item.supplier.toLowerCase().includes(q) ||
            item.supervisorName.toLowerCase().includes(q) ||
            item.invoiceNumber.toLowerCase().includes(q);
          if (!match) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'date') {
          diff = new Date(b.date).getTime() - new Date(a.date).getTime();
        } else if (sortBy === 'total') {
          diff = b.totalPrice - a.totalPrice;
        } else if (sortBy === 'price') {
          diff = b.unitPrice - a.unitPrice;
        } else if (sortBy === 'jobsite') {
          diff = a.jobsiteName.localeCompare(b.jobsiteName, 'tr');
        }
        return sortOrder === 'asc' ? -diff : diff;
      });
  }, [allExtractedItems, activeCategory, activeSubType, selectedJobsite, selectedVendor, invoiceNoFilter, dateFilter, searchTerm, sortBy, sortOrder]);

  // 5. İSTATİSTİKLER & ÖZET METRİKLER
  const kpis = useMemo(() => {
    const totalSpend = filteredItems.reduce((acc, curr) => acc + curr.totalPrice, 0);
    const totalCount = filteredItems.length;
    const uniqueSuppliers = new Set(filteredItems.map(i => i.supplier)).size;
    const uniqueJobsites = new Set(filteredItems.map(i => i.jobsiteName)).size;

    const prices = filteredItems.map(i => i.unitPrice).filter(p => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

    return {
      totalSpend,
      totalCount,
      uniqueSuppliers,
      uniqueJobsites,
      minPrice,
      maxPrice,
      avgPrice
    };
  }, [filteredItems]);

  // 6. ŞANTİYE DAĞILIM GRAFİK VERİSİ
  const jobsiteChartData = useMemo(() => {
    const map: Record<string, { jobsiteName: string; totalSpend: number; count: number }> = {};
    filteredItems.forEach(item => {
      const key = item.jobsiteName;
      if (!map[key]) {
        map[key] = { jobsiteName: key, totalSpend: 0, count: 0 };
      }
      map[key].totalSpend += item.totalPrice;
      map[key].count += 1;
    });

    const list = Object.values(map).sort((a, b) => b.totalSpend - a.totalSpend);
    const total = list.reduce((a, b) => a + b.totalSpend, 0);

    return list.map(item => ({
      ...item,
      percentage: total > 0 ? Number(((item.totalSpend / total) * 100).toFixed(1)) : 0
    }));
  }, [filteredItems]);

  // 7. ZAMAN BAZLI FİYAT & HARCAMA GRAFİĞİ
  const chronologicalData = useMemo(() => {
    const sorted = [...filteredItems].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return sorted.map((item, idx) => ({
      index: idx + 1,
      date: item.date,
      unitPrice: item.unitPrice,
      totalSpend: item.totalPrice,
      material: item.materialName,
      subType: item.subType,
      jobsite: item.jobsiteName,
      supplier: item.supplier,
      amountStr: `${item.quantity} ${item.unit}`
    }));
  }, [filteredItems]);

  const toggleSort = (field: 'date' | 'total' | 'price' | 'jobsite') => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const currentCategoryConfig = CATEGORIES.find(c => c.key === activeCategory)!;

  return (
    <div className="space-y-6">
      {/* 1. ÜST BAŞLIK & HUB ÇERÇEVESİ */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 rounded-3xl p-6 sm:p-7 text-white border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <div className="inline-flex items-center space-x-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3.5 py-1 rounded-full text-xs font-black uppercase tracking-wider mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Satınalma & Maliyet Kontrol Konsolu</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center space-x-2">
              <span>Özel Malzeme & Hammadde Merkezi</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl font-medium leading-relaxed">
              İnşaat demirinden yalıtıma, çelik profillerden gazbetona kadar 4 ana grupta tüm malzeme alımlarını, şantiye dağılımlarını ve fiyat dalgalanmalarını izleyin.
            </p>
          </div>

          {onNavigateToInvoiceDrive && (
            <button
              type="button"
              onClick={onNavigateToInvoiceDrive}
              className="self-start md:self-auto px-4 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-white rounded-2xl text-xs font-bold border border-slate-700 flex items-center space-x-2 transition-all cursor-pointer shrink-0 shadow-lg hover:border-slate-600"
            >
              <FileText className="w-4 h-4 text-amber-400" />
              <span>Orijinal Fatura Deposu</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. ANA KATEGORİ SEÇİM KARTLARI (4 BÜYÜK KURUMSAL BLOK) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CATEGORIES.map(cat => {
          const isSelected = activeCategory === cat.key;
          const Icon = cat.icon;
          const data = categorySummaries[cat.key];

          return (
            <div
              key={cat.key}
              onClick={() => {
                setActiveCategory(cat.key);
                setActiveSubType('ALL'); // Kategori değişiminde alt kalem sıfırlanır
              }}
              className={`group relative rounded-3xl p-5 cursor-pointer transition-all duration-200 border text-left flex flex-col justify-between overflow-hidden select-none ${
                isSelected
                  ? 'bg-white text-slate-950 border-amber-400 shadow-xl ring-4 ring-amber-400/30 scale-[1.02]'
                  : 'bg-slate-900/90 hover:bg-slate-850 text-slate-200 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Arka plan vurgusu */}
              {isSelected && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-400/20 via-amber-400/5 to-transparent rounded-bl-full pointer-events-none" />
              )}

              <div>
                {/* Üst Sıra: İkon + Rozet */}
                <div className="flex items-center justify-between mb-3.5">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-slate-950 text-amber-400 shadow-md'
                        : 'bg-slate-800 text-slate-300 group-hover:text-amber-400 border border-slate-700'
                    }`}
                  >
                    <Icon className="w-6 h-6" style={{ color: isSelected ? '#f59e0b' : undefined }} />
                  </div>

                  <div className="flex flex-col items-end">
                    <span
                      className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                        isSelected
                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {cat.shortCode}
                    </span>
                    <span className={`text-[11px] font-bold mt-1 ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                      {data.count} Kalem Alım
                    </span>
                  </div>
                </div>

                {/* Başlık ve Açıklama */}
                <h3 className={`text-lg font-black tracking-tight ${isSelected ? 'text-slate-950' : 'text-white'}`}>
                  {cat.title}
                </h3>
                <p className={`text-xs mt-0.5 line-clamp-1 ${isSelected ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
                  {cat.subtitle}
                </p>
              </div>

              {/* Alt Bilgi: Harcama Tutarı */}
              <div className="mt-5 pt-3.5 border-t border-slate-200/60 flex items-center justify-between">
                <div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider block ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                    Toplam Harcama
                  </span>
                  <span className={`text-lg font-black font-mono tracking-tight block ${isSelected ? 'text-indigo-950' : 'text-amber-400'}`}>
                    {formatRuble(data.spend)}
                  </span>
                </div>

                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${
                    isSelected ? 'bg-amber-400 text-slate-950 shadow-sm' : 'bg-slate-800 text-slate-400 group-hover:text-white'
                  }`}
                >
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. YENİLİKÇİ VE DÜZENLİ ALT MALZEME SEÇİM KONSOLU (Kullanıcının İstediği Kusursuz Yapı) */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
        {/* Konsol Üst Başlığı */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-sm shrink-0"
              style={{ backgroundColor: currentCategoryConfig.accentColor }}
            >
              <currentCategoryConfig.icon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-slate-900 tracking-tight">
                  {currentCategoryConfig.title} Malzeme Kataloğu
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-200">
                  {currentCategorySubTypes.length} Farklı Çeşit
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Aşağıdaki kutulardan spesifik bir malzemeye tıklayarak tüm şantiye dağılımlarını ve birim fiyat hareketlerini filtreleyebilirsiniz.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {activeSubType !== 'ALL' && (
              <button
                type="button"
                onClick={() => setActiveSubType('ALL')}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <RefreshCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Tümüne Dön</span>
              </button>
            )}
            <div className="text-xs px-3 py-1.5 rounded-xl bg-amber-50 text-amber-900 border border-amber-200 font-bold">
              Seçili: <span className="font-black text-amber-950">{activeSubType === 'ALL' ? 'Tümü (Genel Görünüm)' : activeSubType}</span>
            </div>
          </div>
        </div>

        {/* MODERN KART-GRID SEÇENEKLER (YENİLİKÇİ VE GÖZE HOŞ GELEN YAPI) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* 1. TÜMÜ KUTUCUĞU */}
          <button
            type="button"
            onClick={() => setActiveSubType('ALL')}
            className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden select-none ${
              activeSubType === 'ALL'
                ? 'bg-slate-950 text-white border-slate-950 shadow-lg ring-2 ring-slate-400 scale-[1.02]'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                  activeSubType === 'ALL' ? 'bg-slate-800 text-amber-400' : 'bg-slate-200 text-slate-700'
                }`}>
                  GENEL
                </span>
                {activeSubType === 'ALL' && <Check className="w-4 h-4 text-amber-400" />}
              </div>
              <h4 className="font-black text-sm tracking-tight leading-snug">
                Tüm {currentCategoryConfig.title}
              </h4>
              <p className={`text-[11px] mt-1 ${activeSubType === 'ALL' ? 'text-slate-400' : 'text-slate-500'}`}>
                {currentCategorySubTypes.reduce((a, b) => a + b.count, 0)} Alım Kaydı
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200/30">
              <span className={`text-xs font-mono font-black ${activeSubType === 'ALL' ? 'text-amber-400' : 'text-slate-900'}`}>
                {formatRuble(currentCategorySubTypes.reduce((a, b) => a + b.spend, 0))}
              </span>
            </div>
          </button>

          {/* 2. SADECE BU KATEGORİYE AİT ALT MALZEME KUTUCUKLARI */}
          {currentCategorySubTypes.map(sub => {
            const isSubSelected = activeSubType === sub.name;

            return (
              <button
                key={sub.name}
                type="button"
                onClick={() => setActiveSubType(isSubSelected ? 'ALL' : sub.name)}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden select-none ${
                  isSubSelected
                    ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-lg ring-2 ring-amber-300 scale-[1.02]'
                    : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                        isSubSelected ? 'bg-slate-950 text-amber-300' : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      {sub.count} Fatura
                    </span>
                    {isSubSelected && <Check className="w-4 h-4 text-slate-950 stroke-[3]" />}
                  </div>

                  <h4 className={`font-bold text-xs tracking-tight leading-snug line-clamp-2 ${isSubSelected ? 'font-black text-slate-950' : 'text-slate-900'}`}>
                    {sub.name}
                  </h4>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className={isSubSelected ? 'text-amber-950 font-bold' : 'text-slate-400 font-medium'}>Harcama:</span>
                    <span className={`font-mono font-black ${isSubSelected ? 'text-slate-950 text-xs' : 'text-slate-800'}`}>
                      {formatRuble(sub.spend)}
                    </span>
                  </div>
                  {sub.avgPrice > 0 && (
                    <div className="flex items-center justify-between text-[10px] mt-0.5">
                      <span className={isSubSelected ? 'text-amber-950 font-bold' : 'text-slate-400 font-medium'}>Ort. Fiyat:</span>
                      <span className={`font-mono font-bold ${isSubSelected ? 'text-slate-900' : 'text-amber-800'}`}>
                        {formatRuble(sub.avgPrice)}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. ARAMA VE DETAYLI FİLTRELEME ÇUBUĞU */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Inputs */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Malzeme adı, Rusça orijinal tanım veya tedarikçi..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-800 placeholder-slate-400"
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
            <div className="relative w-full sm:w-40">
              <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Fatura No..."
                value={invoiceNoFilter}
                onChange={e => setInvoiceNoFilter(e.target.value)}
                className="w-full pl-8 pr-6 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-slate-800"
              />
              {invoiceNoFilter && (
                <button
                  type="button"
                  onClick={() => setInvoiceNoFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dropdowns Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          {/* Şantiye Filter */}
          <SearchableFilterDropdown
            label="Şantiye"
            selectedKey={selectedJobsite === 'ALL' ? 'all' : selectedJobsite}
            options={[
              { key: 'all', label: 'Tüm Şantiyeler', count: jobsites.length },
              ...jobsites.map(j => ({
                key: j.id,
                label: j.name,
                subtext: j.code
              }))
            ]}
            onSelect={(key) => setSelectedJobsite(key === 'all' ? 'ALL' : key)}
            placeholder="Şantiye ara..."
          />

          {/* Tedarikçi Filter */}
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
              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs ml-auto"
              title="Tüm filtreleri sıfırla"
            >
              <RefreshCcw className="w-3 h-3 text-amber-700" />
              <span>Filtreleri Temizle</span>
            </button>
          )}

          <span className="text-xs font-mono font-bold text-slate-500 ml-auto sm:ml-0">
            {filteredItems.length} Kalem
          </span>
        </div>
      </div>

      {/* 5. GRAFİKLER: ŞANTİYE DAĞILIMI & KRONOLOJİK FİYAT HAREKETİ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Grafik 1: Şantiyelere Göre Alım & Bütçe Dağılımı */}
        <div className="lg:col-span-6 bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <span>Şantiye Bazlı Harcama & Alım Hacmi</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Seçili malzemenin hangi şantiyelerde ne kadarlık bütçe tükettiği
                </p>
              </div>
              <span className="text-xs font-mono font-bold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg">
                {jobsiteChartData.length} Şantiye
              </span>
            </div>

            <div className="w-full h-72">
              {jobsiteChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={jobsiteChartData}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 15, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={v => `${(v / 1000).toFixed(0)}k ₽`}
                    />
                    <YAxis
                      type="category"
                      dataKey="jobsiteName"
                      width={110}
                      tick={{ fontSize: 11, fill: '#1e293b', fontWeight: 600 }}
                    />
                    <Tooltip
                      formatter={(val: any, name: any, props: any) => [
                        `${formatRuble(Number(val))} (%${props.payload.percentage})`,
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
                      {jobsiteChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                  Bu filtreye uygun şantiye verisi bulunamadı
                </div>
              )}
            </div>
          </div>

          {/* Şantiye Listesi (Tıklanabilir) */}
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {jobsiteChartData.map((item, idx) => (
              <div
                key={item.jobsiteName}
                onClick={() => setSelectedJobsite(selectedJobsite === item.jobsiteName ? 'ALL' : item.jobsiteName)}
                className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                  />
                  <span className="font-bold text-slate-800 truncate">{item.jobsiteName}</span>
                  <span className="text-[10px] text-slate-400">({item.count} alım)</span>
                </div>
                <div className="flex items-center space-x-2 font-mono shrink-0">
                  <span className="font-bold text-slate-900">{formatRuble(item.totalSpend)}</span>
                  <span className="text-slate-500 font-semibold text-[10px]">%{item.percentage}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Grafik 2: Zaman İçindeki Fiyat Trendi & Harcama */}
        <div className="lg:col-span-6 bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <TrendingUp className="w-4 h-4 text-amber-500" />
                  <span>Fiyat Değişimi & Alım Zaman Çizelgesi</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tarihe göre gerçekleşen birim fiyat hareketleri ve alım tutarları
                </p>
              </div>

              {/* Metrik Seçici */}
              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setChartMetric('price')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    chartMetric === 'price' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Birim Fiyat (₽)
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric('spend')}
                  className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                    chartMetric === 'spend' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Toplam Tutar (₽)
                </button>
              </div>
            </div>

            <div className="w-full h-72">
              {chronologicalData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chronologicalData} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorAreaDynamic" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartMetric === 'price' ? '#d97706' : '#4f46e5'} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={chartMetric === 'price' ? '#d97706' : '#4f46e5'} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={v => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                    />
                    <Tooltip
                      formatter={(val: any, name: any, props: any) => [
                        `${formatRuble(Number(val))} | ${props.payload.material} (${props.payload.jobsite})`,
                        chartMetric === 'price' ? 'Birim Fiyat' : 'Toplam Tutar'
                      ]}
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#fff'
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey={chartMetric === 'price' ? 'unitPrice' : 'totalSpend'}
                      name={chartMetric === 'price' ? 'Birim Fiyat (₽)' : 'Toplam Tutar (₽)'}
                      stroke={chartMetric === 'price' ? '#d97706' : '#4f46e5'}
                      strokeWidth={3}
                      fillOpacity={1}
                      fill="url(#colorAreaDynamic)"
                      dot={{ r: 4, fill: '#f59e0b', strokeWidth: 1.5 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                  Zaman serisi verisi yok
                </div>
              )}
            </div>
          </div>

          {/* Fiyat İstatistik Kartları */}
          <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2.5 bg-emerald-50/80 rounded-2xl border border-emerald-100">
              <span className="text-[10px] text-emerald-800 block font-bold">En Uygun Birim Fiyat</span>
              <span className="font-mono font-black text-emerald-900 text-sm mt-0.5 block">
                {formatRuble(kpis.minPrice)}
              </span>
            </div>
            <div className="p-2.5 bg-indigo-50/80 rounded-2xl border border-indigo-100">
              <span className="text-[10px] text-indigo-800 block font-bold">Ortalama Fiyat</span>
              <span className="font-mono font-black text-indigo-900 text-sm mt-0.5 block">
                {formatRuble(kpis.avgPrice)}
              </span>
            </div>
            <div className="p-2.5 bg-rose-50/80 rounded-2xl border border-rose-100">
              <span className="text-[10px] text-rose-800 block font-bold">En Yüksek Fiyat</span>
              <span className="font-mono font-black text-rose-900 text-sm mt-0.5 block">
                {formatRuble(kpis.maxPrice)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. TERTEMİZ VE PROFESYONEL MALZEME ALIM TABLOSU */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <Boxes className="w-5 h-5 text-indigo-600" />
              <span>
                {currentCategoryConfig.title} Alım Geçmişi ({filteredItems.length} Kalem Listeleniyor)
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Fatura detayını ve orijinal belgesini görmek için istediğiniz satıra tıklayabilirsiniz.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500 font-medium">Sırala:</span>
            <button
              onClick={() => toggleSort('date')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer transition-colors ${
                sortBy === 'date' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>Tarih</span>
              <ArrowUpDown className="w-3 h-3 ml-0.5" />
            </button>
            <button
              onClick={() => toggleSort('total')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer transition-colors ${
                sortBy === 'total' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>Tutar</span>
              <ArrowUpDown className="w-3 h-3 ml-0.5" />
            </button>
            <button
              onClick={() => toggleSort('price')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer transition-colors ${
                sortBy === 'price' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>Birim Fiyat</span>
              <ArrowUpDown className="w-3 h-3 ml-0.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                <th className="py-3.5 px-4 w-10 text-center">#</th>
                <th className="py-3.5 px-4">Tarih</th>
                <th className="py-3.5 px-4">Malzeme / Alt Tür</th>
                <th className="py-3.5 px-4">Şantiye</th>
                <th className="py-3.5 px-4">Tedarikçi Firma</th>
                <th className="py-3.5 px-4 text-right">Miktar</th>
                <th className="py-3.5 px-4 text-right">Birim Fiyat</th>
                <th className="py-3.5 px-4 text-right">Toplam Harcama</th>
                <th className="py-3.5 px-4">Satınalma / Şef</th>
                <th className="py-3.5 px-4 text-center">Fatura No</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length > 0 ? (
                filteredItems.map((item, idx) => (
                  <tr
                    key={item.id}
                    onClick={() => {
                      if (onOpenInvoiceDetail) {
                        onOpenInvoiceDetail(item.rawInvoice);
                      } else {
                        setPreviewInvoice(item.rawInvoice);
                      }
                    }}
                    className="hover:bg-indigo-50/60 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 text-center text-slate-400 font-mono font-bold">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">
                      {item.date}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 flex items-center space-x-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        <span>{item.subType}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5" title={item.materialName}>
                        {item.materialName}
                      </div>
                      {item.originalName && item.originalName !== item.materialName && (
                        <div className="text-[10px] text-slate-400 italic truncate max-w-xs">
                          {item.originalName}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-slate-800 block">{item.jobsiteName}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-slate-700 block truncate max-w-[150px]" title={item.supplier}>
                        {item.supplier}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-700 whitespace-nowrap">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-amber-800 whitespace-nowrap">
                      {formatRuble(item.unitPrice)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                      {formatRuble(item.totalPrice)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-medium">
                      {item.supervisorName}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                        {item.invoiceNumber}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Boxes className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-sm text-slate-600">Bu kritere uygun malzeme kaydı bulunamadı</p>
                    <p className="text-xs text-slate-400 mt-0.5">Lütfen arama terimini veya şantiye filtresini değiştirin.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 7. FATURA DETAY MODALI */}
      {previewInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-hidden">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-5 sm:p-6 flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-black text-lg text-white">
                      Fatura: {previewInvoice.invoiceNumber || 'No Belirtilmedi'}
                    </h3>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono font-bold">
                      {previewInvoice.date || 'Tarih Yok'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {previewInvoice.jobsiteName} — {previewInvoice.supplier}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewInvoice(null)}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-800">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Şantiye</span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">{previewInvoice.jobsiteName}</span>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Tedarikçi</span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block truncate" title={previewInvoice.supplier}>
                    {previewInvoice.supplier}
                  </span>
                </div>
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Satınalma / Şef</span>
                  <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                    {previewInvoice.uploadedBySupervisorName || 'Yetkili Şef'}
                  </span>
                </div>
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200/80">
                  <span className="text-[10px] text-amber-800 font-bold uppercase block">Fatura Toplamı</span>
                  <span className="font-mono font-black text-amber-900 text-base mt-0.5 block">
                    {formatRuble(previewInvoice.totalAmount)}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-2 flex items-center justify-between">
                  <span>Fatura Kalemleri ({previewInvoice.items?.length || 0})</span>
                  {previewInvoice.fileUrl && (
                    <a
                      href={previewInvoice.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center space-x-1"
                    >
                      <span>Orijinal Belgeyi Aç</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Malzeme Tanımı</th>
                        <th className="py-2.5 px-3 text-right">Miktar</th>
                        <th className="py-2.5 px-3 text-right">Birim Fiyat</th>
                        <th className="py-2.5 px-3 text-right">Tutar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(previewInvoice.items || []).map((it, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900">{it.materialName}</div>
                            {it.originalName && it.originalName !== it.materialName && (
                              <div className="text-[10px] text-slate-400 italic">{it.originalName}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                            {it.quantity} {it.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-800">
                            {formatRuble(it.unitPrice)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                            {formatRuble(it.totalPrice)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-xs text-slate-500">
                Kayıt Tarihi: {previewInvoice.created_at ? new Date(previewInvoice.created_at).toLocaleString('tr-TR') : 'Belirtilmedi'}
              </span>
              <button
                type="button"
                onClick={() => setPreviewInvoice(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
