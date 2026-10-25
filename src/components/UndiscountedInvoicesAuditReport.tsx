import React, { useState, useMemo, useEffect } from 'react';
import {
  DiscountRecord,
  InvoiceRecord,
  Jobsite,
  PurchasingSupervisor
} from '../types';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import {
  extractUndiscountedInvoicesData,
  UndiscountedInvoiceRow,
  SupervisorUndiscountedScorecard,
  renderUndiscountedInvoicesHtml,
  downloadUndiscountedInvoicesExcel,
  downloadUndiscountedInvoicesHtml,
  downloadUndiscountedInvoicesPdf,
  fmtDateDisplay
} from '../utils/undiscountedInvoiceExporter';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter, getDateFilterDisplayLabel } from '../utils/filterHelpers';
import { areVendorsEqual } from '../utils/vendorNormalizer';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import {
  FileSpreadsheet,
  FileCode,
  Download,
  Eye,
  Search,
  X,
  AlertTriangle,
  ShieldAlert,
  Building2,
  Users,
  Hash,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Check,
  Percent,
  Coins,
  Filter
} from 'lucide-react';

interface Props {
  invoices: InvoiceRecord[];
  discounts: DiscountRecord[];
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  generatedBy?: string;
  onUpdateInvoice?: (id: string, invoice: Partial<InvoiceRecord>) => Promise<void> | void;
}

const DEFENSE_NOTES_STORAGE_KEY = 'ges_undiscounted_invoice_defense_notes_v1';

export const UndiscountedInvoicesAuditReport: React.FC<Props> = ({
  invoices = [],
  discounts = [],
  supervisors = [],
  jobsites = [],
  generatedBy = 'Satınalma Yönetimi',
  onUpdateInvoice
}) => {
  // Target discount rate for calculating estimated missed savings (%3, %5, %7, %10)
  const [targetDiscountPct, setTargetDiscountPct] = useState<number>(5);

  // Filters
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('ALL');
  const [selectedJobsiteName, setSelectedJobsiteName] = useState<string>('ALL');
  const [selectedSupplier, setSelectedSupplier] = useState<string>('ALL');
  const [invoiceNoFilter, setInvoiceNoFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<DateFilterState>({ preset: 'all' });
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [minAmountFilter, setMinAmountFilter] = useState<number>(0);

  // Expanded invoice rows (to inspect line items inline)
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Record<string, boolean>>({});
  const [viewingInvoiceModal, setViewingInvoiceModal] = useState<InvoiceRecord | null>(null);
  const [showReportPreviewModal, setShowReportPreviewModal] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportingSupervisorId, setExportingSupervisorId] = useState<string | null>(null);

  // Defense / Justification Notes per invoice (persisted in localStorage + optional Firestore update)
  const [customDefenseNotes, setCustomDefenseNotes] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(DEFENSE_NOTES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [savedToastId, setSavedToastId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DEFENSE_NOTES_STORAGE_KEY, JSON.stringify(customDefenseNotes));
    } catch {
      // ignore storage errors
    }
  }, [customDefenseNotes]);

  const handleSaveDefenseNote = async (row: UndiscountedInvoiceRow, noteText: string) => {
    const clean = noteText.trim();
    setCustomDefenseNotes(prev => ({
      ...prev,
      [row.invoiceId]: clean
    }));
    if (onUpdateInvoice) {
      try {
        await onUpdateInvoice(row.invoiceId, {
          notes: clean,
          undiscountedDefenseNote: clean
        } as any);
      } catch {
        // local state already updated
      }
    }
    setSavedToastId(row.invoiceId);
    setTimeout(() => {
      setSavedToastId(prev => (prev === row.invoiceId ? null : prev));
    }, 2000);
  };

  // Extract all undiscounted invoices and supervisor scorecards
  const { allUndiscountedRows, supervisorScorecards } = useMemo(() => {
    return extractUndiscountedInvoicesData({
      invoices,
      discounts,
      supervisors,
      jobsites,
      targetDiscountPct,
      customDefenseNotes
    });
  }, [invoices, discounts, supervisors, jobsites, targetDiscountPct, customDefenseNotes]);

  // Unique dropdown options from allUndiscountedRows
  const uniqueSupervisors = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const r of allUndiscountedRows) {
      const key = r.supervisorId || r.supervisorName;
      const cur = map.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        map.set(key, { id: key, name: r.supervisorName, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [allUndiscountedRows]);

  const uniqueJobsites = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allUndiscountedRows) {
      const name = r.jobsiteName || 'Şantiye Belirtilmemiş';
      map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [allUndiscountedRows]);

  const uniqueSuppliers = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allUndiscountedRows) {
      const s = r.supplier || 'Bilinmeyen Tedarikçi';
      map.set(s, (map.get(s) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [allUndiscountedRows]);

  const isAnyFilterActive = useMemo(() => {
    return (
      selectedSupervisorId !== 'ALL' ||
      selectedJobsiteName !== 'ALL' ||
      selectedSupplier !== 'ALL' ||
      Boolean(invoiceNoFilter.trim()) ||
      Boolean(dateFilter.preset && dateFilter.preset !== 'all') ||
      Boolean(searchTerm.trim()) ||
      minAmountFilter > 0
    );
  }, [
    selectedSupervisorId,
    selectedJobsiteName,
    selectedSupplier,
    invoiceNoFilter,
    dateFilter,
    searchTerm,
    minAmountFilter
  ]);

  const handleResetFilters = () => {
    setSelectedSupervisorId('ALL');
    setSelectedJobsiteName('ALL');
    setSelectedSupplier('ALL');
    setInvoiceNoFilter('');
    setDateFilter({ preset: 'all' });
    setSearchTerm('');
    setMinAmountFilter(0);
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allUndiscountedRows
      .filter(r => {
        if (selectedSupervisorId !== 'ALL') {
          if (r.supervisorId !== selectedSupervisorId && r.supervisorName !== selectedSupervisorId) {
            return false;
          }
        }
        if (selectedJobsiteName !== 'ALL') {
          if (r.jobsiteName !== selectedJobsiteName) return false;
        }
        if (selectedSupplier !== 'ALL') {
          if (!areVendorsEqual(r.supplier, selectedSupplier) && r.supplier !== selectedSupplier) {
            return false;
          }
        }
        if (invoiceNoFilter.trim()) {
          const qNo = invoiceNoFilter.toLowerCase().trim();
          if (!r.invoiceNo.toLowerCase().includes(qNo)) return false;
        }
        if (dateFilter.preset && dateFilter.preset !== 'all') {
          if (!matchesDateFilter(r.invoiceDate || r.createdAt, dateFilter)) return false;
        }
        if (minAmountFilter > 0) {
          if (r.totalAmount < minAmountFilter) return false;
        }
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase().trim();
          const matchHeader =
            r.supplier.toLowerCase().includes(q) ||
            r.supervisorName.toLowerCase().includes(q) ||
            r.jobsiteName.toLowerCase().includes(q) ||
            r.invoiceNo.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q) ||
            r.itemsSummary.toLowerCase().includes(q) ||
            r.defenseNote.toLowerCase().includes(q);
          const matchLine = r.items.some(
            it =>
              String(it.materialName || '').toLowerCase().includes(q) ||
              String(it.originalName || '').toLowerCase().includes(q)
          );
          if (!matchHeader && !matchLine) return false;
        }
        return true;
      })
      .map((r, idx) => ({
        ...r,
        rowNo: idx + 1
      }));
  }, [
    allUndiscountedRows,
    selectedSupervisorId,
    selectedJobsiteName,
    selectedSupplier,
    invoiceNoFilter,
    dateFilter,
    minAmountFilter,
    searchTerm
  ]);

  // Filtered scorecards matching current supervisor filter
  const filteredScorecards = useMemo(() => {
    if (selectedSupervisorId === 'ALL') return supervisorScorecards;
    return supervisorScorecards.filter(
      sc => sc.supervisorId === selectedSupervisorId || sc.supervisorName === selectedSupervisorId
    );
  }, [supervisorScorecards, selectedSupervisorId]);

  const activeFilterSummaryLabel = useMemo(() => {
    const parts: string[] = [];
    if (selectedSupervisorId !== 'ALL') {
      const sup = uniqueSupervisors.find(s => s.id === selectedSupervisorId);
      parts.push(`Şef: ${sup?.name || selectedSupervisorId}`);
    }
    if (selectedJobsiteName !== 'ALL') parts.push(`Şantiye: ${selectedJobsiteName}`);
    if (selectedSupplier !== 'ALL') parts.push(`Tedarikçi: ${selectedSupplier}`);
    if (invoiceNoFilter.trim()) parts.push(`Fatura No: #${invoiceNoFilter.trim()}`);
    if (dateFilter.preset && dateFilter.preset !== 'all') {
      parts.push(`Tarih: ${getDateFilterDisplayLabel(dateFilter)}`);
    }
    if (minAmountFilter > 0) parts.push(`Min Tutar: ≥ ${minAmountFilter.toLocaleString('tr-TR')} ₽`);
    if (searchTerm.trim()) parts.push(`Arama: "${searchTerm.trim()}"`);
    return parts.length > 0 ? parts.join(' · ') : 'Tüm Satınalma Şefleri ve Şantiyeler';
  }, [
    selectedSupervisorId,
    uniqueSupervisors,
    selectedJobsiteName,
    selectedSupplier,
    invoiceNoFilter,
    dateFilter,
    minAmountFilter,
    searchTerm
  ]);

  // KPI Totals for current filtered view
  const totalFilteredCount = filteredRows.length;
  const totalFilteredAmount = useMemo(
    () => filteredRows.reduce((s, r) => s + r.totalAmount, 0),
    [filteredRows]
  );
  const totalFilteredLostDiscount = useMemo(
    () => filteredRows.reduce((s, r) => s + r.estimatedLostDiscount, 0),
    [filteredRows]
  );
  const totalFilteredItems = useMemo(
    () => filteredRows.reduce((s, r) => s + r.itemCount, 0),
    [filteredRows]
  );

  const topUndiscountedSupervisor = useMemo(() => {
    const withUndiscounted = supervisorScorecards.filter(s => s.undiscountedInvoiceCount > 0);
    return withUndiscounted.length > 0 ? withUndiscounted[0] : null;
  }, [supervisorScorecards]);

  // Export handlers for single supervisor ("Sadece Bu Şefi İndir")
  const handleExportSingleSupervisor = async (
    sc: SupervisorUndiscountedScorecard,
    format: 'excel' | 'pdf' | 'html'
  ) => {
    setExportingSupervisorId(`${sc.supervisorId}_${format}`);
    try {
      const supRows = allUndiscountedRows
        .filter(r => r.supervisorId === sc.supervisorId || r.supervisorName === sc.supervisorName)
        .map((r, i) => ({ ...r, rowNo: i + 1 }));
      const opts = {
        filterLabel: `Satınalma Şefi: ${sc.supervisorName} (${sc.jobsiteNames.join(', ') || sc.primaryJobsiteName})`,
        targetDiscountPct,
        generatedBy,
        focusedSupervisorName: sc.supervisorName
      };
      if (format === 'excel') {
        await downloadUndiscountedInvoicesExcel(supRows, [sc], opts);
      } else if (format === 'pdf') {
        await downloadUndiscountedInvoicesPdf(supRows, [sc], opts);
      } else {
        downloadUndiscountedInvoicesHtml(supRows, [sc], opts);
      }
    } finally {
      setExportingSupervisorId(null);
    }
  };

  const toggleExpandRow = (invoiceId: string) => {
    setExpandedInvoiceIds(prev => ({
      ...prev,
      [invoiceId]: !prev[invoiceId]
    }));
  };

  return (
    <div className="space-y-6">
      {/* Top Executive Directive & Action Header */}
      <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-950 via-rose-950 to-slate-900 text-white border border-rose-500/40 shadow-lg space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md bg-rose-500/25 border border-rose-400/50 text-rose-200 text-[10px] font-black uppercase tracking-wider">
                🎯 İNDİRİM BASKI & DENETİM RAPORU
              </span>
              <span className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/40 text-amber-300 text-[10px] font-black uppercase tracking-wider">
                AI OTOMATİK FATURA OKUMA HARİCİ DOĞRUDAN GİRİŞLER
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
              <span>İndirim Alınmayan Faturalar (Şef İndirim & TDF Merkezi Harici) Sorgu Raporu</span>
            </h3>
            <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
              <strong>AI Otomatik Fatura Okuma &rarr; Sistemde Kayıtlı Faturalar & Malzeme Kalemleri</strong> arşivinde bulunan, ancak <strong>Şef İndirim & TDF Teklif Merkezi</strong> üzerinden herhangi bir pazarlık/indirim kaydı girilmemiş olan faturaları listeler. Tek tıkla <strong>Excel, PDF veya HTML</strong> olarak indirip ilgili satınalma şefine göndererek <em>"Bu faturalar için neden indirim alınmadı?"</em> savunması talep edebilirsiniz.
            </p>
          </div>

          {/* Export & Preview Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await downloadUndiscountedInvoicesExcel(filteredRows, filteredScorecards, {
                    filterLabel: activeFilterSummaryLabel,
                    targetDiscountPct,
                    generatedBy
                  });
                } finally {
                  setIsExporting(false);
                }
              }}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
              title="Şef Özet Karnesi ve Savunma Sütunlu Detaylı Excel (.xlsx) İndir"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Excel İndir (.xlsx)</span>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await downloadUndiscountedInvoicesPdf(filteredRows, filteredScorecards, {
                    filterLabel: activeFilterSummaryLabel,
                    targetDiscountPct,
                    generatedBy
                  });
                } finally {
                  setIsExporting(false);
                }
              }}
              className="px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
              title="Kurumsal PDF Savunma Formu Olarak İndir (.pdf)"
            >
              <Download className="w-4 h-4" />
              <span>PDF İndir (.pdf)</span>
            </button>

            <button
              type="button"
              onClick={() =>
                downloadUndiscountedInvoicesHtml(filteredRows, filteredScorecards, {
                  filterLabel: activeFilterSummaryLabel,
                  targetDiscountPct,
                  generatedBy
                })
              }
              className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
              title="Şefe Gönderilebilir Tek Dosya HTML Raporu İndir (.html)"
            >
              <FileCode className="w-4 h-4" />
              <span>HTML İndir (.html)</span>
            </button>

            <button
              type="button"
              onClick={() => setShowReportPreviewModal(true)}
              className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
              title="Raporu Tam Ekran Önizle ve Yazdır"
            >
              <Eye className="w-4 h-4 text-amber-300" />
              <span>Raporu Önizle</span>
            </button>
          </div>
        </div>

        {/* 4 KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-white/10">
          <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-400/30">
            <div className="flex items-center justify-between text-[11px] font-bold text-rose-200 uppercase">
              <span>İndirimsiz Doğrudan Fatura</span>
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-xl sm:text-2xl font-mono font-black text-white mt-1 tabular-nums">
              {totalFilteredCount} Fatura
            </div>
            <div className="text-[11px] text-rose-200/80 mt-0.5">
              Toplam {totalFilteredItems} malzeme kalemi (Pazarlık kaydı yok)
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 uppercase">
              <span>İndirimsiz Fatura Hacmi</span>
              <Coins className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl sm:text-2xl font-mono font-black text-amber-300 mt-1 tabular-nums">
              {formatRuble(totalFilteredAmount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Teklif Merkezine girmeden doğrudan onaylanan tutar
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-400/30">
            <div className="flex items-center justify-between text-[11px] font-bold text-amber-200 uppercase">
              <span>Kaçırılan Potansiyel İndirim (%{targetDiscountPct})</span>
              <Percent className="w-4 h-4 text-amber-300" />
            </div>
            <div className="text-xl sm:text-2xl font-mono font-black text-rose-300 mt-1 tabular-nums">
              +{formatRuble(totalFilteredLostDiscount)}
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-[10px] text-amber-200/90 font-semibold mr-1">Hedef Oran:</span>
              {[3, 5, 7, 10].map(pct => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setTargetDiscountPct(pct)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-black cursor-pointer transition-colors ${
                    targetDiscountPct === pct
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-white/10 text-slate-300 hover:bg-white/20'
                  }`}
                >
                  %{pct}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 uppercase">
              <span>En Yüksek İndirimsiz Hacim</span>
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-base sm:text-lg font-black text-white mt-1 truncate">
              {topUndiscountedSupervisor ? topUndiscountedSupervisor.supervisorName : '-'}
            </div>
            <div className="text-[11px] text-rose-300 font-mono font-bold mt-0.5 truncate">
              {topUndiscountedSupervisor
                ? `${topUndiscountedSupervisor.undiscountedInvoiceCount} Fatura · ${formatRuble(topUndiscountedSupervisor.undiscountedTotalAmount)}`
                : 'Kayıt yok'}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: ŞEF BAZLI İNDİRİMSİZ FATURA ÖZET KARNESİ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-black uppercase tracking-wide flex items-center gap-2 text-amber-300">
              <Users className="w-4 h-4" />
              <span>1. Şef Bazlı İndirimsiz Fatura Özet Karnesi (Teklif Merkezi vs Doğrudan Fatura)</span>
            </h4>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Her satınalma şefinin indirim alarak girdiği fatura sayısı ile indirim almadan doğrudan yüklediği faturaların karşılaştırması. Sağdaki butonlarla ilgili şefe özel sorgu raporu indirebilirsiniz.
            </p>
          </div>
          {selectedSupervisorId !== 'ALL' && (
            <button
              type="button"
              onClick={() => setSelectedSupervisorId('ALL')}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-xs font-bold cursor-pointer self-start sm:self-auto"
            >
              Tüm Şefleri Göster
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-3 px-3.5">Satınalma Şefi</th>
                <th className="py-3 px-3.5">Sorumlu Olduğu Şantiyeler</th>
                <th className="py-3 px-3 text-center text-emerald-700">İndirimli Fatura (Teklif Mrk.)</th>
                <th className="py-3 px-3 text-center text-rose-700">İndirimsiz Fatura (Doğrudan)</th>
                <th className="py-3 px-3 text-center">İndirimsiz Oran (%)</th>
                <th className="py-3 px-3.5 text-right text-emerald-700">Kazanılan Mevcut İndirim</th>
                <th className="py-3 px-3.5 text-right text-slate-900">İndirimsiz Fatura Toplamı</th>
                <th className="py-3 px-3.5 text-right text-rose-700">Tahmini Kayıp (%{targetDiscountPct})</th>
                <th className="py-3 px-3.5 text-center">Bu Şefe Özel Sorgu Raporu İndir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {supervisorScorecards.map((sc) => {
                const isSelected =
                  selectedSupervisorId === sc.supervisorId || selectedSupervisorId === sc.supervisorName;
                const isHighRisk = sc.undiscountedRatioPct >= 50;
                const isMedRisk = sc.undiscountedRatioPct >= 25 && sc.undiscountedRatioPct < 50;

                return (
                  <tr
                    key={sc.supervisorId}
                    onClick={() =>
                      setSelectedSupervisorId(isSelected ? 'ALL' : sc.supervisorId)
                    }
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-rose-50/90 ring-1 ring-inset ring-rose-300'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-900 text-xs sm:text-sm">
                          {sc.supervisorName}
                        </span>
                        {isSelected && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">
                            Seçili
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-slate-600 font-semibold max-w-[220px] truncate" title={sc.jobsiteNames.join(', ')}>
                      {sc.jobsiteNames.join(', ') || sc.primaryJobsiteName}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-black">
                        {sc.discountedInvoiceCount} Adet
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-lg font-mono font-black border ${
                          sc.undiscountedInvoiceCount > 0
                            ? 'bg-rose-100 text-rose-900 border-rose-300'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {sc.undiscountedInvoiceCount} Adet
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-md font-mono font-black text-[11px] border ${
                            isHighRisk
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : isMedRisk
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          %{sc.undiscountedRatioPct} ({sc.undiscountedInvoiceCount}/{sc.totalInvoiceCount})
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      +{formatRuble(sc.discountedTotalSavings)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-black text-slate-900 tabular-nums bg-slate-50/70">
                      {formatRuble(sc.undiscountedTotalAmount)}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-black text-rose-700 tabular-nums bg-rose-50/40">
                      +{formatRuble(sc.estimatedLostDiscountTotal)}
                    </td>
                    <td className="py-3 px-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                      {sc.undiscountedInvoiceCount > 0 ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={exportingSupervisorId === `${sc.supervisorId}_excel`}
                            onClick={() => handleExportSingleSupervisor(sc, 'excel')}
                            className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer transition-colors"
                            title={`${sc.supervisorName} için İndirimsiz Faturalar Excel (.xlsx) Sorgu Dosyası İndir`}
                          >
                            Excel
                          </button>
                          <button
                            type="button"
                            disabled={exportingSupervisorId === `${sc.supervisorId}_pdf`}
                            onClick={() => handleExportSingleSupervisor(sc, 'pdf')}
                            className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] cursor-pointer transition-colors"
                            title={`${sc.supervisorName} için İndirimsiz Faturalar PDF Sorgu Formu İndir`}
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportSingleSupervisor(sc, 'html')}
                            className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] cursor-pointer transition-colors"
                            title={`${sc.supervisorName} için İndirimsiz Faturalar HTML Dosyası İndir`}
                          >
                            HTML
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-emerald-600 font-bold">Tam Uyumlu ✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: FİLTRELER VE DETAYLI İNDİRİMSİZ FATURA SORGU LİSTESİ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Filter className="w-4 h-4 text-rose-600" />
              <span>2. İndirim Alınmayan Faturalar Detaylı Sorgu & Şef Savunma Tablosu ({filteredRows.length} Fatura)</span>
            </h4>
            <p className="text-xs text-slate-500">
              Satıra tıklayarak faturadaki malzeme kalemlerini açabilir, en sağdaki savunma sütununa şefin açıklamasını veya yönetici notunu girebilirsiniz.
            </p>
          </div>

          {/* Min Amount Quick Chips */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200 text-xs">
            <span className="text-[10px] font-bold text-slate-500 px-2 uppercase">Fatura Tutarı:</span>
            {[
              { label: 'Tümü', val: 0 },
              { label: '≥ 50.000 ₽', val: 50000 },
              { label: '≥ 250.000 ₽', val: 250000 },
              { label: '≥ 1.000.000 ₽', val: 1000000 }
            ].map(chip => (
              <button
                key={chip.val}
                type="button"
                onClick={() => setMinAmountFilter(chip.val)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  minAmountFilter === chip.val
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'bg-white text-slate-700 hover:bg-slate-200/70 border border-slate-200'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* Multi-Filter Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Satınalma Şefi */}
          <SearchableFilterDropdown
            label="Satınalma Şefi"
            selectedKey={selectedSupervisorId === 'ALL' ? 'all' : selectedSupervisorId}
            options={[
              { key: 'all', label: 'Tüm Şefler', count: allUndiscountedRows.length },
              ...uniqueSupervisors.map(s => ({
                key: s.id,
                label: s.name,
                count: s.count
              }))
            ]}
            onSelect={(key) => setSelectedSupervisorId(key === 'all' ? 'ALL' : key)}
            placeholder="Şef ara..."
          />

          {/* Şantiye */}
          <SearchableFilterDropdown
            label="Şantiye"
            selectedKey={selectedJobsiteName === 'ALL' ? 'all' : selectedJobsiteName}
            options={[
              { key: 'all', label: 'Tüm Şantiyeler', count: uniqueJobsites.length },
              ...uniqueJobsites.map(j => ({
                key: j.name,
                label: j.name,
                count: j.count
              }))
            ]}
            onSelect={(key) => setSelectedJobsiteName(key === 'all' ? 'ALL' : key)}
            placeholder="Şantiye ara..."
          />

          {/* Tedarikçi Firma */}
          <SearchableFilterDropdown
            label="Tedarikçi Firma"
            selectedKey={selectedSupplier === 'ALL' ? 'all' : selectedSupplier}
            options={[
              { key: 'all', label: 'Tüm Tedarikçiler', count: uniqueSuppliers.length },
              ...uniqueSuppliers.map(v => ({
                key: v.name,
                label: v.name,
                count: v.count
              }))
            ]}
            onSelect={(key) => setSelectedSupplier(key === 'all' ? 'ALL' : key)}
            placeholder="Tedarikçi firma ara..."
          />

          {/* Fatura Tarihi */}
          <DateRangeFilterDropdown
            value={dateFilter}
            onChange={setDateFilter}
          />

          {/* Fatura No Input */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1 flex items-center gap-1">
              <Hash className="w-3 h-3 text-slate-400" />
              <span>Fatura Numarası</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={invoiceNoFilter}
                onChange={(e) => setInvoiceNoFilter(e.target.value)}
                placeholder="Fatura no ara..."
                className="w-full pl-3 pr-7 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
              {invoiceNoFilter && (
                <button
                  type="button"
                  onClick={() => setInvoiceNoFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Search & Reset Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Malzeme adı, tedarikçi firma, şef, şantiye veya savunma notu ara..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5 text-rose-600" />
                <span>Filtreleri Temizle</span>
              </button>
            )}
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
              Listelenen: <strong className="text-rose-700 font-mono">{filteredRows.length}</strong> / {allUndiscountedRows.length} Fatura
            </span>
          </div>
        </div>

        {/* Detailed Undiscounted Invoices Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900 text-white font-bold border-b border-slate-800">
                <th className="py-3 px-2.5 text-center w-10">#</th>
                <th className="py-3 px-3">Fatura & Kayıt Tarihi</th>
                <th className="py-3 px-3">Satınalma Şefi / Şantiye</th>
                <th className="py-3 px-3">Tedarikçi Firma</th>
                <th className="py-3 px-3 text-center">Fatura No</th>
                <th className="py-3 px-3">Kalemler & Malzeme Özeti</th>
                <th className="py-3 px-3 text-right">Fatura Tutarı (₽)</th>
                <th className="py-3 px-3 text-right text-rose-300">Tahmini Kayıp (%{targetDiscountPct})</th>
                <th className="py-3 px-3 bg-amber-900/60 text-amber-200 min-w-[260px]">
                  Neden İndirim Alınmadı? (Şef Savunma / Açıklama)
                </th>
                <th className="py-3 px-2.5 text-center">Belge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500 font-medium">
                    Seçili filtre kriterlerine uygun indirimsiz doğrudan fatura bulunmadı.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const isExpanded = Boolean(expandedInvoiceIds[r.invoiceId]);
                  return (
                    <React.Fragment key={r.invoiceId}>
                      <tr className="hover:bg-rose-50/40 transition-colors">
                        <td className="py-3 px-2.5 text-center font-mono font-bold text-slate-500">
                          {r.rowNo}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="font-mono font-black text-slate-900">
                            {fmtDateDisplay(r.invoiceDate)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Kayıt: {fmtDateDisplay(r.createdAt)}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-black text-slate-900">{r.supervisorName}</div>
                          <div className="text-[11px] font-semibold text-indigo-700 flex items-center gap-1">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span>{r.jobsiteName}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{r.supplier}</div>
                          <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                            {r.category}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setViewingInvoiceModal(r.rawInvoice)}
                            className="font-mono font-black text-indigo-700 hover:text-rose-700 bg-indigo-50 hover:bg-rose-50 px-2 py-1 rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                            title="Fatura detay penceresini aç"
                          >
                            #{r.invoiceNo}
                          </button>
                        </td>
                        <td className="py-3 px-3 max-w-xs">
                          <button
                            type="button"
                            onClick={() => toggleExpandRow(r.invoiceId)}
                            className="text-left group cursor-pointer flex items-start gap-1.5"
                            title="Fatura kalemlerini görmek için tıklayın"
                          >
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-slate-100 group-hover:bg-indigo-100 text-slate-800 group-hover:text-indigo-900 font-black text-[11px] shrink-0 border border-slate-300">
                              <span>{r.itemCount} Kalem</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </span>
                            <span className="text-[11px] text-slate-600 line-clamp-2">
                              {r.itemsSummary}
                            </span>
                          </button>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-slate-900 tabular-nums whitespace-nowrap bg-slate-50/70">
                          {formatRuble(r.totalAmount)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-rose-700 tabular-nums whitespace-nowrap bg-rose-50/50">
                          +{formatRuble(r.estimatedLostDiscount)}
                        </td>
                        <td className="py-2.5 px-3 bg-amber-50/50">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={
                                customDefenseNotes[r.invoiceId] !== undefined
                                  ? customDefenseNotes[r.invoiceId]
                                  : r.defenseNote
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setCustomDefenseNotes(prev => ({
                                  ...prev,
                                  [r.invoiceId]: val
                                }));
                              }}
                              onBlur={(e) => handleSaveDefenseNote(r, e.target.value)}
                              placeholder="Neden indirim alınmadı? Açıklama girin..."
                              className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-slate-900 placeholder:text-amber-700/60 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
                            />
                            {savedToastId === r.invoiceId && (
                              <span
                                className="p-1 rounded-md bg-emerald-100 text-emerald-700 shrink-0"
                                title="Kaydedildi"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => setViewingInvoiceModal(r.rawInvoice)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-700 hover:text-indigo-800 transition-colors cursor-pointer"
                              title="Fatura Kalemlerini & Detayını Gör"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            {r.fileUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  openOriginalFileViewer(r.fileUrl!, `Fatura_${r.invoiceNo}.pdf`, {
                                    supplier: r.supplier,
                                    date: r.invoiceDate,
                                    jobsiteName: r.jobsiteName,
                                    invoiceNumber: r.invoiceNo,
                                    invoiceNo: r.invoiceNo
                                  })
                                }
                                className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors cursor-pointer"
                                title="Orijinal Fatura PDF / Görselini Aç"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Line Items Drawer */}
                      {isExpanded && (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={10} className="p-3 sm:p-4">
                            <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-800 border-b border-slate-100 pb-2">
                                <span>
                                  📦 Fatura #{r.invoiceNo} — Malzeme Kalemleri ({r.items.length} Kalem)
                                </span>
                                <span className="font-mono text-rose-700">
                                  Hedef %{targetDiscountPct} İndirim Alınsaydı Tasarruf: +{formatRuble(r.estimatedLostDiscount)}
                                </span>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-[11px] border-collapse">
                                  <thead>
                                    <tr className="bg-slate-100 text-slate-600 font-bold">
                                      <th className="py-1.5 px-2.5">#</th>
                                      <th className="py-1.5 px-2.5">Malzeme Adı (TR / Orijinal Rusça)</th>
                                      <th className="py-1.5 px-2.5">Kategori</th>
                                      <th className="py-1.5 px-2.5 text-right">Miktar</th>
                                      <th className="py-1.5 px-2.5 text-right">Birim Fiyat (₽)</th>
                                      <th className="py-1.5 px-2.5 text-right">Toplam Tutar (₽)</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {r.items.map((item, idx) => (
                                      <tr key={item.id || idx} className="hover:bg-slate-50">
                                        <td className="py-1.5 px-2.5 font-mono text-slate-400">
                                          {idx + 1}
                                        </td>
                                        <td className="py-1.5 px-2.5">
                                          <div className="font-bold text-slate-900">
                                            {item.materialName}
                                          </div>
                                          {item.originalName && item.originalName !== item.materialName && (
                                            <div className="font-mono text-[10px] text-slate-500">
                                              🇷🇺 {item.originalName}
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-600">
                                          {item.category || '-'}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-700 tabular-nums">
                                          {item.quantity} {item.unit}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-800 tabular-nums">
                                          {formatRuble(item.unitPrice)}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-right font-mono font-black text-slate-900 tabular-nums">
                                          {formatRuble(item.totalPrice)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-900 text-white font-black text-xs">
                  <td colSpan={6} className="py-3 px-4 text-right uppercase">
                    Genel Toplam ({filteredRows.length} İndirimsiz Fatura / {totalFilteredItems} Kalem):
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-300 tabular-nums">
                    {formatRuble(totalFilteredAmount)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-300 tabular-nums">
                    +{formatRuble(totalFilteredLostDiscount)}
                  </td>
                  <td colSpan={2} className="py-3 px-3 text-[11px] text-slate-300 font-semibold">
                    Hedef %{targetDiscountPct} pazarlık bazında kaçırılan tutar
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {viewingInvoiceModal && (
        <InvoiceDetailModal
          invoice={viewingInvoiceModal}
          jobsites={jobsites}
          supervisors={supervisors}
          onClose={() => setViewingInvoiceModal(null)}
        />
      )}

      {/* Full-Screen HTML/PDF Report Preview Modal */}
      {showReportPreviewModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
          onClick={() => setShowReportPreviewModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-3xl max-w-[1600px] w-full h-[92vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-white">
              <div>
                <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                  <span>İndirim Alınmayan Faturalar Denetim, Sorgu ve Şef Savunma Raporu Önizlemesi</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Kapsam: {activeFilterSummaryLabel} ({filteredRows.length} İndirimsiz Fatura · Hedef İndirim: %{targetDiscountPct})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={async () => {
                    setIsExporting(true);
                    try {
                      await downloadUndiscountedInvoicesExcel(filteredRows, filteredScorecards, {
                        filterLabel: activeFilterSummaryLabel,
                        targetDiscountPct,
                        generatedBy
                      });
                    } finally {
                      setIsExporting(false);
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Excel İndir (.xlsx)</span>
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={async () => {
                    setIsExporting(true);
                    try {
                      await downloadUndiscountedInvoicesPdf(filteredRows, filteredScorecards, {
                        filterLabel: activeFilterSummaryLabel,
                        targetDiscountPct,
                        generatedBy
                      });
                    } finally {
                      setIsExporting(false);
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
                    downloadUndiscountedInvoicesHtml(filteredRows, filteredScorecards, {
                      filterLabel: activeFilterSummaryLabel,
                      targetDiscountPct,
                      generatedBy
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                >
                  <FileCode className="w-4 h-4" />
                  <span>HTML İndir (.html)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowReportPreviewModal(false)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-200 p-2 sm:p-4 overflow-hidden">
              <iframe
                title="İndirim Alınmayan Faturalar Denetim Raporu Önizleme"
                srcDoc={renderUndiscountedInvoicesHtml(filteredRows, filteredScorecards, {
                  filterLabel: activeFilterSummaryLabel,
                  targetDiscountPct,
                  generatedBy
                })}
                className="w-full h-full bg-white rounded-2xl border border-slate-300 shadow-inner"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
