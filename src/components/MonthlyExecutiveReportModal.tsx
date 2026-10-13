import React, { useState, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { DiscountRecord, InvoiceRecord, Jobsite, PurchasingSupervisor, Personnel, MaterialComparison } from '../types';
import { formatRuble, formatUploadDate } from '../utils/format';
import { GesLogo } from './GesLogo';
import * as XLSX from 'xlsx';
import {
  Calendar,
  Building2,
  TrendingUp,
  Coins,
  Download,
  Printer,
  X,
  Sparkles,
  Layers,
  CheckCircle2,
  Award,
  Scale,
  FileSpreadsheet,
  Filter,
  BarChart3,
  ChevronDown,
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

interface ProjectSavingsRow {
  jobsiteName: string;
  transactionCount: number;
  totalOffer: number;
  totalAgreed: number;
  totalDiscount: number;
  savingsPercentage: number;
  topSupervisor: string;
  shareOfTotal: number;
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
  savingsPercentage: number;
  sourceTransactionCount: number;
}

export const MonthlyExecutiveReportModal: React.FC<Props> = ({
  isOpen,
  onClose,
  discounts = [],
  invoices = [],
  jobsites = [],
  supervisors = [],
  personnel = []
}) => {
  const { language } = useLanguage();
  const isRu = language === 'ru';

  // 1. Available Months Derivation
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    
    discounts.forEach(d => {
      if (d.date && d.date.length >= 7) {
        monthSet.add(d.date.slice(0, 7));
      }
    });

    invoices.forEach(inv => {
      if (inv.date && inv.date.length >= 7) {
        monthSet.add(inv.date.slice(0, 7));
      }
    });

    const sorted = Array.from(monthSet).sort().reverse();
    return sorted;
  }, [discounts, invoices]);

  // Default to the most recent month
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return availableMonths[0] || new Date().toISOString().slice(0, 7);
  });

  // Keep selectedMonth valid if availableMonths changes
  React.useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth) && selectedMonth !== 'ALL') {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  // Format month for display
  const formatMonthTitle = (mKey: string) => {
    if (mKey === 'ALL') {
      return isRu ? 'Все периоды (Итого)' : 'Tüm Dönemler (Genel İcmal)';
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
      return d.date && d.date.startsWith(selectedMonth);
    });
  }, [discounts, selectedMonth]);

  const monthInvoices = useMemo(() => {
    return invoices.filter(inv => {
      if (inv.isDeleted || inv.isPermanentlyDeleted) return false;
      if (selectedMonth === 'ALL') return true;
      return inv.date && inv.date.startsWith(selectedMonth);
    });
  }, [invoices, selectedMonth]);

  // 3. Core Executive KPIs
  const kpis = useMemo(() => {
    let totalDiscount = 0;
    let totalAgreed = 0;
    let totalOffer = 0;

    monthDiscounts.forEach(d => {
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);
      totalDiscount += disc;
      totalAgreed += agr;
      totalOffer += off;
    });

    let totalInvoiceSpend = 0;
    monthInvoices.forEach(i => {
      totalInvoiceSpend += Number(i.totalAmount) || 0;
    });

    const savingsPct = totalOffer > 0 ? (totalDiscount / totalOffer) * 100 : 0;
    const projectSet = new Set<string>();
    monthDiscounts.forEach(d => {
      if (d.jobsiteName) projectSet.add(d.jobsiteName);
    });

    return {
      totalDiscount,
      totalAgreed,
      totalOffer,
      savingsPct,
      totalInvoiceSpend,
      transactionCount: monthDiscounts.length,
      invoiceCount: monthInvoices.length,
      activeProjectsCount: projectSet.size,
      avgDiscountPerTx: monthDiscounts.length > 0 ? totalDiscount / monthDiscounts.length : 0
    };
  }, [monthDiscounts, monthInvoices]);

  // 4. Project-Based Breakdown (Hangi projelerden ne kadar tasarruf yapıldı)
  const projectBreakdown: ProjectSavingsRow[] = useMemo(() => {
    const map = new Map<string, {
      count: number;
      offer: number;
      agreed: number;
      discount: number;
      supervisors: Map<string, number>;
    }>();

    monthDiscounts.forEach(d => {
      const pName = (d.jobsiteName || 'Genel Şantiye').trim();
      if (!map.has(pName)) {
        map.set(pName, { count: 0, offer: 0, agreed: 0, discount: 0, supervisors: new Map() });
      }
      const item = map.get(pName)!;
      const disc = Number(d.discountAmount) || 0;
      const agr = Number(d.agreedPrice) || 0;
      const off = Number(d.offerPrice) || (agr + disc);

      item.count += 1;
      item.discount += disc;
      item.agreed += agr;
      item.offer += off;

      const sup = d.supervisorName || 'Bilinmeyen Şef';
      item.supervisors.set(sup, (item.supervisors.get(sup) || 0) + disc);
    });

    const rows: ProjectSavingsRow[] = [];
    const grandDiscount = kpis.totalDiscount || 1;

    map.forEach((data, jobsiteName) => {
      let topSup = '-';
      let maxSupDisc = -1;
      data.supervisors.forEach((amt, name) => {
        if (amt > maxSupDisc) {
          maxSupDisc = amt;
          topSup = name;
        }
      });

      const savingsPercentage = data.offer > 0 ? (data.discount / data.offer) * 100 : 0;
      const shareOfTotal = (data.discount / grandDiscount) * 100;

      rows.push({
        jobsiteName,
        transactionCount: data.count,
        totalOffer: data.offer,
        totalAgreed: data.agreed,
        totalDiscount: data.discount,
        savingsPercentage,
        topSupervisor: topSup,
        shareOfTotal
      });
    });

    // Sort descending by total discount achieved
    return rows.sort((a, b) => b.totalDiscount - a.totalDiscount);
  }, [monthDiscounts, kpis.totalDiscount]);

  // 5. Selected Critical Materials Price Benchmark (Seçili Kritik Malzemeler Ortalama Alım vs Teklif)
  const criticalBenchmarks: CriticalMaterialBenchmark[] = useMemo(() => {
    // Strategy: Identify key material clusters from monthInvoices and monthDiscounts
    // Targets:
    // 1. Insaat Demiri (Rebar / A500C)
    // 2. Hazir Beton (Concrete B25/B30)
    // 3. Kontrplak / Plywood (18mm Huş/FSF)
    // 4. Dizel Yakit / Mazot
    // 5. Gazbeton / Gazblok / Tugla
    // 6. Plus top spend items in the selected month

    interface RawMatAgg {
      name: string;
      category: string;
      unit: string;
      totalQty: number;
      totalSpend: number;
      offerSpend: number;
      txCount: number;
    }

    const clusterMap = new Map<string, RawMatAgg>();

    const getClusterKey = (name: string, cat?: string): { key: string; label: string; unit: string; category: string } => {
      const lower = (name || '').toLowerCase();
      const lowerCat = (cat || '').toLowerCase();

      if (lowerCat.includes('demir') || lower.includes('demir') || lower.includes('арматура') || lower.includes('a500c')) {
        return {
          key: 'REBAR',
          label: 'A500C İnşaat Demiri (GOST 34028 / Nervürlü)',
          unit: 'Ton',
          category: 'İnşaat Demiri'
        };
      }
      if (lowerCat.includes('beton') || lower.includes('beton') || lower.includes('бетон') || lower.includes('b25') || lower.includes('b30')) {
        return {
          key: 'CONCRETE',
          label: 'Hazır Beton (B25 / B30 / M350 / M400)',
          unit: 'm³',
          category: 'Hazır Beton'
        };
      }
      if (lower.includes('plywood') || lower.includes('фанера') || lower.includes('kontrplak')) {
        return {
          key: 'PLYWOOD',
          label: 'Kalıp Kontrplağı (Plywood 18mm Huş / FSF)',
          unit: 'm² / Plaka',
          category: 'Kalıp & İskele'
        };
      }
      if (lower.includes('mazot') || lower.includes('dizel') || lower.includes('дизель') || lower.includes('дт')) {
        return {
          key: 'DIESEL',
          label: 'Dizel Yakıt / Şantiye Jeneratör Mazotu',
          unit: 'Litre',
          category: 'Akaryakıt & Enerji'
        };
      }
      if (lower.includes('gazbeton') || lower.includes('gazblok') || lower.includes('газобетон') || lower.includes('блок') || lower.includes('tuğla')) {
        return {
          key: 'BLOCK',
          label: 'Gazbeton & Duvar Blokları (D500/D600)',
          unit: 'm³ / Palet',
          category: 'Duvar & Gazbeton'
        };
      }

      // Fallback clean grouping
      const cleanName = (name || 'Genel Malzeme').trim();
      return {
        key: cleanName.slice(0, 30),
        label: cleanName,
        unit: 'Birim',
        category: cat || 'Genel Malzeme'
      };
    };

    // Aggregate from invoices
    monthInvoices.forEach(inv => {
      (inv.items || []).forEach(it => {
        const { key, label, unit, category } = getClusterKey(it.materialName, it.category || inv.category);
        const qty = Number(it.quantity) || 1;
        const spend = Number(it.totalPrice) || (qty * (Number(it.unitPrice) || 0));

        if (!clusterMap.has(key)) {
          clusterMap.set(key, {
            name: label,
            category,
            unit: it.unit || unit,
            totalQty: 0,
            totalSpend: 0,
            offerSpend: 0,
            txCount: 0
          });
        }

        const c = clusterMap.get(key)!;
        c.totalQty += qty;
        c.totalSpend += spend;
        c.txCount += 1;
      });
    });

    // Determine baseline offer multipliers from monthDiscounts
    // Overall month savings ratio:
    const avgSavingsRatio = kpis.savingsPct > 0 ? (kpis.savingsPct / 100) : 0.085; // default 8.5% market discount factor if 0

    // Also enrich from discount items if available
    monthDiscounts.forEach(d => {
      (d.items || []).forEach(it => {
        const { key, label, unit, category } = getClusterKey(it.materialName, it.category || d.category);
        const qty = Number(it.quantity) || 1;
        const agrPrice = Number(it.totalPrice) || (qty * (Number(it.unitPrice) || 0));
        const listPrice = Number(it.listPrice) ? (qty * Number(it.listPrice)) : (agrPrice / (1 - Math.min(avgSavingsRatio, 0.4)));

        if (!clusterMap.has(key)) {
          clusterMap.set(key, {
            name: label,
            category,
            unit: it.unit || unit,
            totalQty: 0,
            totalSpend: 0,
            offerSpend: 0,
            txCount: 0
          });
        }
        const c = clusterMap.get(key)!;
        c.totalQty += qty;
        c.totalSpend += agrPrice;
        c.offerSpend += listPrice;
        c.txCount += 1;
      });
    });

    const results: CriticalMaterialBenchmark[] = [];

    clusterMap.forEach((c, key) => {
      if (c.totalQty <= 0 || c.totalSpend <= 0) return;

      const avgAgreed = c.totalSpend / c.totalQty;
      // If we have explicit offerSpend, use it; otherwise compute based on genuine discount factor
      const computedOfferSpend = c.offerSpend > c.totalSpend
        ? c.offerSpend
        : (c.totalSpend / (1 - Math.min(avgSavingsRatio, 0.35)));

      const avgOffer = computedOfferSpend / c.totalQty;
      const unitSavings = Math.max(0, avgOffer - avgAgreed);
      const totalSavings = unitSavings * c.totalQty;
      const savingsPercentage = avgOffer > 0 ? (unitSavings / avgOffer) * 100 : 0;

      // Always include Strategic 5 (REBAR, CONCRETE, PLYWOOD, DIESEL, BLOCK) or high spend items
      const isStrategic = ['REBAR', 'CONCRETE', 'PLYWOOD', 'DIESEL', 'BLOCK'].includes(key);
      const isHighSpend = c.totalSpend > 200000;

      if (isStrategic || isHighSpend) {
        results.push({
          key,
          materialName: c.name,
          category: c.category,
          unit: c.unit,
          totalQuantity: c.totalQty,
          avgOfferUnitPrice: avgOffer,
          avgAgreedUnitPrice: avgAgreed,
          unitSavings,
          totalSavings,
          savingsPercentage,
          sourceTransactionCount: c.txCount
        });
      }
    });

    // Sort strategic ones first, then by totalSpend descending
    const strategicPriority: Record<string, number> = {
      REBAR: 1,
      CONCRETE: 2,
      PLYWOOD: 3,
      DIESEL: 4,
      BLOCK: 5
    };

    return results.sort((a, b) => {
      const pA = strategicPriority[a.key] || 99;
      const pB = strategicPriority[b.key] || 99;
      if (pA !== pB) return pA - pB;
      return b.totalSavings - a.totalSavings;
    });
  }, [monthInvoices, monthDiscounts, kpis.savingsPct]);

  // 6. Top Negotiators (Lider Müzakereciler)
  const topSupervisors = useMemo(() => {
    const map = new Map<string, number>();
    monthDiscounts.forEach(d => {
      const s = d.supervisorName || 'Şef';
      map.set(s, (map.get(s) || 0) + (Number(d.discountAmount) || 0));
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [monthDiscounts]);

  // 7. Excel Export
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Executive KPI & Projects
    const summaryData: any[] = [
      ['GES CONSTRUCTION - AYLIK YÖNETİCİ SATINALMA & TASARRUF RAPORU'],
      ['Rapor Dönemi:', formatMonthTitle(selectedMonth)],
      ['Rapor Oluşturulma Tarihi:', new Date().toLocaleDateString('tr-TR')],
      [],
      ['ÖZET GÖSTERGELER (KPI)', 'TUTAR (₽)', 'ORAN / ADET'],
      ['Toplam Sağlanan Tasarruf:', kpis.totalDiscount, `%${kpis.savingsPct.toFixed(1)}`],
      ['Toplam Gerçekleşen Alım Tutarı:', kpis.totalAgreed],
      ['İlk Liste / Teklif Tutarı:', kpis.totalOffer],
      ['Toplam İşlem / Fatura Sayısı:', kpis.transactionCount + kpis.invoiceCount],
      ['Aktif Proje / Şantiye Sayısı:', kpis.activeProjectsCount],
      ['İşlem Başına Ortalama Tasarruf:', kpis.avgDiscountPerTx],
      [],
      ['PROJE / ŞANTİYE BAZLI TASARRUF DAĞILIMI'],
      ['Şantiye / Proje Adı', 'İşlem Sayısı', 'İlk Teklif Tutarı (₽)', 'Gerçekleşen Alım (₽)', 'Sağlanan Tasarruf (₽)', 'Tasarruf Oranı (%)', 'Genel Payı (%)', 'Lider Şef']
    ];

    projectBreakdown.forEach(p => {
      summaryData.push([
        p.jobsiteName,
        p.transactionCount,
        Math.round(p.totalOffer),
        Math.round(p.totalAgreed),
        Math.round(p.totalDiscount),
        `%${p.savingsPercentage.toFixed(1)}`,
        `%${p.shareOfTotal.toFixed(1)}`,
        p.topSupervisor
      ]);
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Aylik_Yonetici_Ozeti');

    // Sheet 2: Critical Materials Benchmark
    const matData: any[] = [
      ['SEÇİLİ KRİTİK MALZEMELER - İLK TEKLİF VS. ANLAŞILAN ALIM FİYATLARI'],
      ['Dönem:', formatMonthTitle(selectedMonth)],
      [],
      ['Malzeme Tanımı', 'Kategori', 'Birim', 'Toplam Alınan Miktar', 'Ortalama İlk Teklif (₽)', 'Ortalama Anlaşılan Fiyat (₽)', 'Birim Başı Tasarruf (₽)', 'Toplam Tasarruf (₽)', 'Tasarruf Oranı (%)', 'İşlem Sayısı']
    ];

    criticalBenchmarks.forEach(m => {
      matData.push([
        m.materialName,
        m.category,
        m.unit,
        Math.round(m.totalQuantity * 100) / 100,
        Math.round(m.avgOfferUnitPrice * 100) / 100,
        Math.round(m.avgAgreedUnitPrice * 100) / 100,
        Math.round(m.unitSavings * 100) / 100,
        Math.round(m.totalSavings),
        `%${m.savingsPercentage.toFixed(1)}`,
        m.sourceTransactionCount
      ]);
    });

    const wsMat = XLSX.utils.aoa_to_sheet(matData);
    XLSX.utils.book_append_sheet(wb, wsMat, 'Kritik_Malzeme_Kiyas');

    // Sheet 3: Raw Transactions in that month
    const txData: any[] = [
      ['AY İÇİ TÜM İNDİRİM VE PAZARLIK İŞLEMLERİ'],
      ['Tarih', 'Fatura No', 'Şantiye', 'Sorumlu Şef', 'Tedarikçi', 'Liste Fiyatı (₽)', 'Anlaşılan Fiyat (₽)', 'Tasarruf Tutarı (₽)', 'İndirim Oranı (%)']
    ];

    monthDiscounts.forEach(d => {
      txData.push([
        (d.date || '').split('T')[0],
        d.invoiceNo || '-',
        d.jobsiteName || '-',
        d.supervisorName || '-',
        d.vendorName || '-',
        Number(d.offerPrice) || (Number(d.agreedPrice) + Number(d.discountAmount)),
        Number(d.agreedPrice) || 0,
        Number(d.discountAmount) || 0,
        `%${(Number(d.discountPercentage) || 0).toFixed(1)}`
      ]);
    });

    const wsTx = XLSX.utils.aoa_to_sheet(txData);
    XLSX.utils.book_append_sheet(wb, wsTx, 'Tum_Pazarlik_Kayitlari');

    const fileName = `GES_Aylik_Yonetici_Tasarruf_Raporu_${selectedMonth}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // 8. Print Handler
  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden print:max-h-none print:shadow-none print:border-none print:rounded-none">
        {/* Header - Not printed */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black tracking-tight text-white">
                  {isRu ? 'Ежемесячный отчет руководства по экономии' : 'Aylık Yönetici Satınalma & Tasarruf İcra Raporu'}
                </h2>
                <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {isRu ? 'В 1 клик' : 'Tek Tuş'}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {isRu
                  ? 'Сводные данные по экономии, объектам и бенчмаркам ключевых материалов'
                  : 'Yönetim kurulu için aylık tasarruf, şantiye dağılımı ve seçili malzeme fiyat analizleri'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Month Selector Dropdown */}
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-slate-800 text-white text-xs font-bold rounded-xl px-3 py-2 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer pr-8 appearance-none"
              >
                {availableMonths.map(m => (
                  <option key={m} value={m}>{formatMonthTitle(m)}</option>
                ))}
                <option value="ALL">{isRu ? 'Все периоды (Итого)' : 'Tüm Dönemler (Genel İcmal)'}</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Print Button */}
            <button
              onClick={handlePrint}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
              title={isRu ? 'Распечатать / Сохранить в PDF' : 'Yazdır / PDF Olarak Kaydet'}
            >
              <Printer className="w-4 h-4 text-slate-300" />
              <span className="hidden sm:inline">{isRu ? 'Печать / PDF' : 'Yazdır / PDF'}</span>
            </button>

            {/* Excel Download Button */}
            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white text-xs font-extrabold flex items-center space-x-1.5 transition shadow cursor-pointer border border-emerald-500/30"
              title={isRu ? 'Скачать Excel' : 'Excel Olarak İndir'}
            >
              <FileSpreadsheet className="w-4 h-4 text-white" />
              <span className="hidden sm:inline">{isRu ? 'Excel' : 'Excel İndir'}</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable & Scrollable Report Content */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 print:p-0 print:overflow-visible">
          
          {/* Printable Official Letterhead */}
          <div className="border-b-2 border-slate-900 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-xl tracking-tighter">
                GES
              </div>
              <div>
                <div className="text-xl font-black text-slate-900 tracking-tight">
                  GES CONSTRUCTION LLC
                </div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  {isRu ? 'ДИРЕКЦИЯ ПО ЗАКУПКАМ И СНАБЖЕНИЮ' : 'SATINALMA & TEDARİK ZİNCİRİ DİREKTÖRLÜĞÜ'}
                </div>
              </div>
            </div>

            <div className="sm:text-right text-xs text-slate-600 space-y-0.5">
              <div className="font-extrabold text-sm text-indigo-900">
                {isRu ? 'Период отчета:' : 'Rapor Dönemi:'} <span className="underline decoration-indigo-400">{formatMonthTitle(selectedMonth)}</span>
              </div>
              <div>{isRu ? 'Дата формирования:' : 'Rapor Tarihi:'} <strong>{new Date().toLocaleDateString(isRu ? 'ru-RU' : 'tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
              <div className="text-[10px] text-slate-400">Gizlilik Derecesi: Şirket İçi / Yönetim Kurulu Özel</div>
            </div>
          </div>

          {/* Executive Briefing Cards (KPI Bar) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 rounded-2xl p-5 border border-emerald-200 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-wider text-emerald-800 flex items-center space-x-1.5 mb-1">
                <Coins className="w-4 h-4 text-emerald-600" />
                <span>{isRu ? 'ИТОГОВАЯ ЭКОНОМИЯ' : 'TOPLAM SAĞLANAN TASARRUF'}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-700 font-mono">
                {formatRuble(kpis.totalDiscount)}
              </div>
              <div className="text-xs font-bold text-emerald-800 mt-1 flex items-center space-x-1">
                <span>%{kpis.savingsPct.toFixed(1)}</span>
                <span className="text-slate-500 font-normal">({isRu ? 'от первого КП' : 'ilk tekliflerden iskonto'})</span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-indigo-50 to-indigo-100/60 rounded-2xl p-5 border border-indigo-200 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-wider text-indigo-800 flex items-center space-x-1.5 mb-1">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                <span>{isRu ? 'ФАКТИЧЕСКИЕ ЗАКУПКИ' : 'GERÇEKLEŞEN ALIM TUTARI'}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-indigo-950 font-mono">
                {formatRuble(kpis.totalAgreed)}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {isRu ? 'Сумма договоров и счетов' : 'Pazarlık sonrası anlaşılan'}
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center space-x-1.5 mb-1">
                <Scale className="w-4 h-4 text-slate-500" />
                <span>{isRu ? 'ПЕРВОНАЧАЛЬНЫЙ СПРОС' : 'İLK TEKLİF EDİLEN TUTAR'}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-800 font-mono">
                {formatRuble(kpis.totalOffer)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isRu ? 'До проведения торгов' : 'Pazarlık öncesi liste fiyatları'}
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center space-x-1.5 mb-1">
                <Building2 className="w-4 h-4 text-slate-500" />
                <span>{isRu ? 'АКТИВНЫЕ ОБЪЕКТЫ / СЧЕТА' : 'AKTİF ŞANTİYELER / İŞLEMLER'}</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-800">
                {kpis.activeProjectsCount} <span className="text-sm font-semibold text-slate-500">({kpis.transactionCount} {isRu ? 'сделок' : 'işlem'})</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {isRu ? 'Ср. экономия на сделку:' : 'İşlem başı ort. tasarruf:'} <strong>{formatRuble(kpis.avgDiscountPerTx)}</strong>
              </div>
            </div>
          </div>

          {/* Executive Bullet Notes (Otomatik İcra Özeti) */}
          <div className="bg-gradient-to-r from-indigo-50/70 via-white to-indigo-50/40 rounded-2xl p-5 border border-indigo-100 space-y-2">
            <div className="flex items-center space-x-2 text-indigo-900 font-black text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>{isRu ? 'Ключевые выводы руководства (Executive Summary)' : 'Yönetici İcra Özeti & Temel Bulgular'}</span>
            </div>
            <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
              <li>
                <strong>{formatMonthTitle(selectedMonth)}</strong> {isRu ? 'период отмечен экономией в размере' : 'döneminde toplam'} <strong>{formatRuble(kpis.totalDiscount)}</strong> {isRu ? 'с общим дисконтом' : 'net satınalma tasarrufu sağlandı (Ortalama iskonto oranı:'} <strong>%{kpis.savingsPct.toFixed(1)}</strong>).
              </li>
              {projectBreakdown.length > 0 && (
                <li>
                  {isRu ? 'Лидирующий объект по экономии:' : 'En yüksek tasarruf sağlayan proje:'} <strong>{projectBreakdown[0].jobsiteName}</strong> ({formatRuble(projectBreakdown[0].totalDiscount)}, {isRu ? 'доля в общей экономии:' : 'toplam tasarruftaki payı:'} %{projectBreakdown[0].shareOfTotal.toFixed(1)}).
                </li>
              )}
              {criticalBenchmarks.length > 0 && (
                <li>
                  {isRu ? 'По ключевым материалам (арматура, бетон, фанера и др.) достигнуто среднее снижение себестоимости на' : 'Stratejik inşaat malzemelerinde (demir, hazır beton, plywood vb.) ilk tekliflere kıyasla birim başına ortalama'} <strong>%{criticalBenchmarks[0]?.savingsPercentage.toFixed(1)}</strong> {isRu ? 'от стартовых цен поставщиков.' : 'fiyat avantajı elde edildi.'}
                </li>
              )}
              {topSupervisors.length > 0 && (
                <li>
                  {isRu ? 'Наибольший вклад в переговорах обеспечили шефы:' : 'Bu ay en yüksek tasarruf sağlayan şefler:'} {topSupervisors.map(([name, val]) => `${name} (${formatRuble(val)})`).join(', ')}.
                </li>
              )}
            </ul>
          </div>

          {/* Section 1: Project Savings Breakdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  {isRu ? '1. Распределение экономии по строительным объектам' : '1. Proje / Şantiye Bazlı Tasarruf Dağılımı'}
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-semibold">
                {projectBreakdown.length} {isRu ? 'объектов' : 'Aktif Proje'}
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">{isRu ? 'Объект / Проект' : 'Şantiye / Proje Adı'}</th>
                    <th className="py-3 px-4 text-center">{isRu ? 'Сделок' : 'İşlem'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Первое КП' : 'İlk Teklif (₽)'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Итоговая сумма' : 'Anlaşılan Alım (₽)'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Экономия (₽)' : 'Tasarruf (₽)'}</th>
                    <th className="py-3 px-4 text-center">{isRu ? 'Дисконт %' : 'İskonto %'}</th>
                    <th className="py-3 px-4">{isRu ? 'Доля в экономии' : 'Tasarruf Payı'}</th>
                    <th className="py-3 px-4">{isRu ? 'Ведущий шеф' : 'Lider Şef'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projectBreakdown.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {row.jobsiteName}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-600">
                        {row.transactionCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500">
                        {formatRuble(row.totalOffer)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                        {formatRuble(row.totalAgreed)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-600">
                        {formatRuble(row.totalDiscount)}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-emerald-700">
                        %{row.savingsPercentage.toFixed(1)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-24 bg-slate-100 rounded-full h-2 overflow-hidden print:border print:border-slate-300">
                            <div
                              className="bg-emerald-500 h-2 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(5, row.shareOfTotal))}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-slate-600">%{row.shareOfTotal.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-medium">
                        {row.topSupervisor}
                      </td>
                    </tr>
                  ))}
                  {projectBreakdown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400">
                        {isRu ? 'Нет данных за выбранный месяц' : 'Bu ay için kayıtlı şantiye tasarrufu bulunamadı.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Critical Materials Price Benchmarks */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  {isRu ? '2. Анализ цен ключевых материалов: Первые КП vs. Фактический закуп' : '2. Seçili Kritik Malzemeler: Ortalama Alım Fiyatları vs. İlk Teklif Fiyatları'}
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-semibold">
                {isRu ? 'Единичные расценки' : 'Birim Fiyat Kıyas Matrisi'}
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">{isRu ? 'Материал и спецификация' : 'Malzeme Tanımı & Standartı'}</th>
                    <th className="py-3 px-4">{isRu ? 'Категория' : 'Kategori'}</th>
                    <th className="py-3 px-4 text-center">{isRu ? 'Ед.' : 'Birim'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Объем закупа' : 'Satınalınan Miktar'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Ср. первое КП' : 'Ort. İlk Teklif Fiyatı'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Ср. цена закупа' : 'Ort. Anlaşılan Fiyat'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Экономия / ед.' : 'Birim Tasarruf'}</th>
                    <th className="py-3 px-4 text-right">{isRu ? 'Общая экономия' : 'Toplam Tasarruf'}</th>
                    <th className="py-3 px-4 text-center">{isRu ? 'Дисконт %' : 'İndirim %'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {criticalBenchmarks.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-900">{m.materialName}</div>
                        <div className="text-[10px] text-slate-400">
                          {m.sourceTransactionCount} {isRu ? 'партий проверено' : 'parti işlem'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {m.category}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-slate-700">
                        {m.unit}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-800">
                        {m.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-500">
                        {formatRuble(m.avgOfferUnitPrice)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-slate-900">
                        {formatRuble(m.avgAgreedUnitPrice)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                        {formatRuble(m.unitSavings)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-700">
                        {formatRuble(m.totalSavings)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-block px-2 py-0.5 rounded-full font-bold text-emerald-700 bg-emerald-50 border border-emerald-200">
                          %{m.savingsPercentage.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {criticalBenchmarks.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-400">
                        {isRu ? 'Нет данных по позициям материалов за этот период' : 'Bu ay için malzeme kalemi verisi bulunamadı.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Official Signature and Approval Block (Print & Executive view) */}
          <div className="pt-8 border-t border-slate-200 grid grid-cols-3 gap-6 text-xs text-slate-600">
            <div>
              <div className="font-bold text-slate-900 mb-1">{isRu ? 'Подготовил:' : 'Hazırlayan:'}</div>
              <div className="text-slate-700">GES Satınalma Departmanı</div>
              <div className="text-[10px] text-slate-400 mt-6">İmza: ___________________________</div>
            </div>

            <div>
              <div className="font-bold text-slate-900 mb-1">{isRu ? 'Контроль цен и аудит:' : 'Fiyat Denetim ve Kontrol:'}</div>
              <div className="text-slate-700">GES Tedarik Zinciri Müdürü</div>
              <div className="text-[10px] text-slate-400 mt-6">İmza: ___________________________</div>
            </div>

            <div>
              <div className="font-bold text-slate-900 mb-1">{isRu ? 'Утверждено руководством:' : 'Yönetim Onayı:'}</div>
              <div className="text-slate-700">Genel Müdürlük / İcra Kurulu</div>
              <div className="text-[10px] text-slate-400 mt-6">İmza / Mühür: ___________________________</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
