import React, { useState, useMemo } from 'react';
import { DiscountRecord, MaterialComparison, InvoiceRecord } from '../types';
import { formatRuble, openOriginalFileViewer, resolveDocumentFileUrl } from '../utils/format';
import { evaluateDiscountAudit, EXCESSIVE_DISCOUNT_THRESHOLD } from '../utils/auditRiskEngine';
import {
  runForensicAudit,
  fetchLiveAIForensicAnalysis,
  generatePortfolioForensicSummary,
  AIForensicVerdict
} from '../utils/aiForensicAuditor';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Search,
  Check,
  Snowflake,
  ExternalLink,
  HelpCircle,
  Clock,
  TrendingDown,
  Scale,
  Receipt,
  Eye,
  ArrowRight,
  User,
  Building2,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  Layers,
  ChevronRight,
  X,
  Bot,
  Sparkles,
  BrainCircuit,
  ShieldCheck,
  RefreshCw,
  AlertOctagon,
  Lightbulb,
  FileSearch,
  ArrowUpRight
} from 'lucide-react';

interface Props {
  discounts: DiscountRecord[];
  comparisons: MaterialComparison[];
  invoices?: InvoiceRecord[];
  onUpdateDiscount?: (id: string, record: Partial<DiscountRecord>) => Promise<void> | void;
}

export const ExecutivePriceAndDiscountAudit: React.FC<Props> = ({
  discounts,
  comparisons,
  invoices = [],
  onUpdateDiscount
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<
    'ALL' | 'CRITICAL_RISK' | 'SUSPICIOUS_PRICE' | 'EXCESSIVE_DISCOUNT' | 'FLAGGED_BOTH' | 'FROZEN' | 'APPROVED' | 'INSPECTION_REQUIRED'
  >('ALL');
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<DiscountRecord | null>(null);
  const [auditNoteInput, setAuditNoteInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [aiVerdictsOverrides, setAiVerdictsOverrides] = useState<Record<string, AIForensicVerdict>>({});
  const [isScanningAll, setIsScanningAll] = useState<boolean>(false);
  const [isAuditingLive, setIsAuditingLive] = useState<boolean>(false);
  const [showAiBriefing, setShowAiBriefing] = useState<boolean>(true);

  // Helper to find associated invoice from invoices array strictly and safely
  const findAssociatedInvoice = (record: DiscountRecord): InvoiceRecord | null => {
    if (!record || !invoices || invoices.length === 0) return null;
    const invNo = (record.invoiceNo || '').trim().toLowerCase();
    if (!invNo) return null;

    // Clean alphanumeric characters for comparison
    const cleanInvNo = invNo.replace(/[^a-z0-9а-яё]/gi, '');
    if (!cleanInvNo) return null;

    const vendorClean = (record.vendorName || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

    // 1. Try exact invoice number match + vendor match
    const exactWithVendor = invoices.find(inv => {
      const invNum = (inv.invoiceNumber || '').trim().toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const supName = (inv.supplier || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const isNumMatch = invNum === cleanInvNo;
      const isVendorMatch = !vendorClean || !supName || supName.includes(vendorClean) || vendorClean.includes(supName);
      return isNumMatch && isVendorMatch;
    });
    if (exactWithVendor) return exactWithVendor;

    // 2. Try exact invoice number match only (if vendor name is not conflicting)
    const exactNumOnly = invoices.find(inv => {
      const invNum = (inv.invoiceNumber || '').trim().toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      return invNum === cleanInvNo;
    });

    if (exactNumOnly) {
      // Validate that it does NOT clearly belong to a completely different vendor
      const supName = (exactNumOnly.supplier || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      if (supName && vendorClean && !supName.includes(vendorClean) && !vendorClean.includes(supName)) {
        // Conflicting vendor, reject!
        return null;
      }
      return exactNumOnly;
    }

    return null;
  };

  // Evaluate all discounts with in-memory benchmarking (takes < 2ms for all records)
  const auditedList = useMemo(() => {
    return discounts.map(d => {
      const evaluation = evaluateDiscountAudit(
        {
          offerPrice: d.offerPrice,
          agreedPrice: d.agreedPrice,
          discountPercentage: d.discountPercentage,
          category: d.category,
          vendorName: d.vendorName,
          items: d.items,
          existingAuditStatus: d.auditStatus,
          existingIsFrozen: d.isEffortScoreFrozen
        },
        comparisons
      );

      // Determine effective status
      let effectiveStatus = d.auditStatus || evaluation.auditStatus;

      // Migration / Sandbox test records
      if (d.isInvalidTestRecord || d.status === 'İnceleme Gerekli') {
        effectiveStatus = 'INSPECTION_REQUIRED';
      } else if (!d.auditReviewedBy) {
        // Auto-correct old false alarms: If record was marked SUSPICIOUS_PRICE or FLAGGED_BOTH without executive sign-off,
        // but the smart, verified audit proves it is NORMAL or only EXCESSIVE_DISCOUNT, normalize it.
        if (d.auditStatus === 'SUSPICIOUS_PRICE' && evaluation.auditStatus === 'NORMAL') {
          effectiveStatus = 'NORMAL';
        } else if (d.auditStatus === 'FLAGGED_BOTH' && evaluation.auditStatus === 'EXCESSIVE_DISCOUNT') {
          effectiveStatus = 'EXCESSIVE_DISCOUNT';
        } else if (d.auditStatus === 'FLAGGED_BOTH' && evaluation.auditStatus === 'NORMAL') {
          effectiveStatus = 'NORMAL';
        } else {
          effectiveStatus = evaluation.auditStatus;
        }
      }

      const isFrozen = d.isEffortScoreFrozen !== undefined && d.auditReviewedBy
        ? d.isEffortScoreFrozen
        : (effectiveStatus === 'SUSPICIOUS_PRICE' || effectiveStatus === 'FLAGGED_BOTH');

      const matchedInvoice = findAssociatedInvoice(d);

      // Protect against stale false benchmark data:
      // Only display benchmark if smart evaluation returned one, or if existing record has a verified high-confidence benchmark
      const validBenchmark = evaluation.benchmarkComparison
        ? evaluation.benchmarkComparison
        : (d.benchmarkComparison && (d.benchmarkComparison.confidence === 'EXACT' || d.benchmarkComparison.confidence === 'HIGH')
            ? d.benchmarkComparison
            : undefined);

      const effectiveFlags = d.auditReviewedBy
        ? (d.auditFlags && d.auditFlags.length > 0 ? d.auditFlags : ['✓ Yönetici Tarafından Bağımsız Olarak İncelendi ve Doğrulandı.'])
        : evaluation.auditFlags;

      const forensicVerdict = aiVerdictsOverrides[d.id] || runForensicAudit(d, comparisons, matchedInvoice);

      return {
        record: d,
        evaluation,
        effectiveStatus,
        isFrozen,
        flags: effectiveFlags,
        benchmark: validBenchmark,
        matchedInvoice,
        forensicVerdict
      };
    });
  }, [discounts, comparisons, invoices, aiVerdictsOverrides]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    let suspiciousPriceCount = 0;
    let excessiveDiscountCount = 0;
    let doubleRiskCount = 0;
    let frozenCount = 0;
    let approvedCount = 0;
    let inspectionRequiredCount = 0;

    auditedList.forEach(item => {
      if (item.effectiveStatus === 'INSPECTION_REQUIRED' || item.record.isInvalidTestRecord || item.record.status === 'İnceleme Gerekli') {
        inspectionRequiredCount++;
      } else if (item.effectiveStatus === 'EXECUTIVE_APPROVED') {
        approvedCount++;
      } else {
        if (item.effectiveStatus === 'FLAGGED_BOTH') {
          doubleRiskCount++;
          suspiciousPriceCount++;
          excessiveDiscountCount++;
        } else if (item.effectiveStatus === 'SUSPICIOUS_PRICE') {
          suspiciousPriceCount++;
        } else if (item.effectiveStatus === 'EXCESSIVE_DISCOUNT') {
          excessiveDiscountCount++;
        }
      }

      if (item.isFrozen) {
        frozenCount++;
      }
    });

    return {
      total: auditedList.length,
      suspiciousPriceCount,
      excessiveDiscountCount,
      doubleRiskCount,
      frozenCount,
      approvedCount,
      inspectionRequiredCount
    };
  }, [auditedList]);

  // Global AI Forensic Audit Summary
  const forensicSummary = useMemo(() => {
    return generatePortfolioForensicSummary(
      auditedList.map(a => ({ record: a.record, verdict: a.forensicVerdict }))
    );
  }, [auditedList]);

  // Bulk scan all with AI
  const handleScanAllWithAI = async () => {
    setIsScanningAll(true);
    try {
      const updatedMap: Record<string, AIForensicVerdict> = { ...aiVerdictsOverrides };
      for (const item of auditedList) {
        updatedMap[item.record.id] = runForensicAudit(item.record, comparisons, item.matchedInvoice);
      }
      setAiVerdictsOverrides(updatedMap);
      setSuccessToast('Yapay Zeka Başdenetçisi tüm portföyü taradı ve adli analizleri güncelledi.');
      setTimeout(() => setSuccessToast(null), 4000);
    } finally {
      setIsScanningAll(false);
    }
  };

  // Live Deep AI audit on a single record
  const handleLiveAuditSingle = async (record: DiscountRecord) => {
    setIsAuditingLive(true);
    try {
      const matchedInv = findAssociatedInvoice(record);
      const liveVerdict = await fetchLiveAIForensicAnalysis(record, comparisons, matchedInv);
      setAiVerdictsOverrides(prev => ({
        ...prev,
        [record.id]: liveVerdict
      }));
      setSuccessToast(`"${record.vendorName}" işlemi yapay zeka tarafından derinlemesine denetlendi.`);
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err: any) {
      alert('AI denetimi sırasında hata: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setIsAuditingLive(false);
    }
  };

  // Filtered list
  const filteredList = useMemo(() => {
    return auditedList.filter(item => {
      const rec = item.record;
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          (rec.vendorName || '').toLowerCase().includes(q) ||
          (rec.supervisorName || '').toLowerCase().includes(q) ||
          (rec.performedByPersonnelName || '').toLowerCase().includes(q) ||
          (rec.jobsiteName || '').toLowerCase().includes(q) ||
          (rec.category || '').toLowerCase().includes(q) ||
          (rec.invoiceNo || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      // Filter tabs
      if (selectedFilter === 'CRITICAL_RISK') {
        return item.forensicVerdict.riskLevel === 'CRITICAL' || item.forensicVerdict.riskLevel === 'HIGH';
      }
      if (selectedFilter === 'SUSPICIOUS_PRICE') {
        return item.effectiveStatus === 'SUSPICIOUS_PRICE' || item.effectiveStatus === 'FLAGGED_BOTH';
      }
      if (selectedFilter === 'EXCESSIVE_DISCOUNT') {
        return item.effectiveStatus === 'EXCESSIVE_DISCOUNT' || item.effectiveStatus === 'FLAGGED_BOTH';
      }
      if (selectedFilter === 'FLAGGED_BOTH') {
        return item.effectiveStatus === 'FLAGGED_BOTH';
      }
      if (selectedFilter === 'FROZEN') {
        return item.isFrozen === true;
      }
      if (selectedFilter === 'APPROVED') {
        return item.effectiveStatus === 'EXECUTIVE_APPROVED';
      }
      if (selectedFilter === 'INSPECTION_REQUIRED') {
        return item.effectiveStatus === 'INSPECTION_REQUIRED' || item.record.isInvalidTestRecord || item.record.status === 'İnceleme Gerekli';
      }

      return true;
    });
  }, [auditedList, searchQuery, selectedFilter]);

  // Action handlers
  const handleApprove = async (record: DiscountRecord) => {
    if (!onUpdateDiscount) return;
    setIsSubmitting(true);
    try {
      await onUpdateDiscount(record.id, {
        auditStatus: 'EXECUTIVE_APPROVED',
        isEffortScoreFrozen: false,
        auditFlags: ['✓ Yönetici Tarafından İncelendi ve Doğrulandı'],
        executiveAuditNote: auditNoteInput || 'Yönetici tarafından 1. teklif belgesi ve son fatura incelenerek doğrulandı.',
        auditReviewedBy: 'Yönetici',
        auditReviewedAt: new Date().toISOString()
      });
      setSuccessToast(`"${record.vendorName}" işlemi başarıyla onaylandı ve efor puanı serbest bırakıldı.`);
      setSelectedRecordForDetail(null);
      setAuditNoteInput('');
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err: any) {
      alert('İşlem güncellenirken hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFreeze = async (record: DiscountRecord) => {
    if (!onUpdateDiscount) return;
    setIsSubmitting(true);
    try {
      await onUpdateDiscount(record.id, {
        auditStatus: 'SUSPICIOUS_PRICE',
        isEffortScoreFrozen: true,
        executiveAuditNote: auditNoteInput || 'Şüpheli yüksek fiyat / şişirilmiş teklif şüphesiyle donduruldu.',
        auditReviewedBy: 'Yönetici',
        auditReviewedAt: new Date().toISOString()
      });
      setSuccessToast(`"${record.vendorName}" işleminin efor puanı donduruldu.`);
      setSelectedRecordForDetail(null);
      setAuditNoteInput('');
      setTimeout(() => setSuccessToast(null), 4000);
    } catch (err: any) {
      alert('İşlem güncellenirken hata oluştu: ' + (err.message || 'Bilinmeyen hata'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Detailed Record context for modal
  const selectedAuditItem = useMemo(() => {
    if (!selectedRecordForDetail) return null;
    return auditedList.find(a => a.record.id === selectedRecordForDetail.id) || null;
  }, [selectedRecordForDetail, auditedList]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-900 text-emerald-100 border border-emerald-600 px-5 py-3.5 rounded-xl shadow-2xl flex items-center space-x-3 text-sm font-semibold animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 🤖 YAPAY ZEKA BAŞDENETÇİSİ (AI SENIOR FORENSIC AUDITOR) KOMUTA MERKEZİ */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 border-2 border-indigo-500/40 rounded-2xl p-5 sm:p-6 text-white shadow-2xl relative overflow-hidden space-y-5">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        {/* Top Control Bar */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/25 text-indigo-300 text-xs font-black uppercase tracking-wider border border-indigo-400/30">
              <Bot className="w-4 h-4 text-indigo-400" />
              <span>Yapay Zeka Kıdemli Adli Satınalma Başdenetçisi</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span>🛡️ Fiyat Kıyaslaması & İndirim Doğrulama Denetimi</span>
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm max-w-3xl leading-relaxed">
              Yapay zeka başdenetçimiz gerçek bir tecrübeli insan denetçi gibi kılı kırk yarar; şişirilmiş 1. teklifleri,
              sepet küçültme illüzyonlarını ve piyasa üstü birim fiyatları anında tespit ederek satınalmacı efor puanını dondurur.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0 relative z-10">
            <button
              onClick={handleScanAllWithAI}
              disabled={isScanningAll}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-black text-xs transition-all shadow-lg hover:shadow-indigo-500/25 flex items-center space-x-2 cursor-pointer disabled:opacity-50 border border-indigo-400/30"
              title="Tüm indirim beyanlarını adli analiz motoruyla tara"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanningAll ? 'animate-spin text-indigo-200' : ''}`} />
              <span>{isScanningAll ? 'Tüm Portföy Taranıyor...' : '⚡ Tümünü Yapay Zeka ile Tara'}</span>
            </button>

            <button
              onClick={() => setShowAiBriefing(prev => !prev)}
              className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all border border-white/15 flex items-center space-x-1.5 cursor-pointer"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
              <span>{showAiBriefing ? 'Brifingi Gizle' : 'Adli Brifingi Gör'}</span>
            </button>
          </div>
        </div>

        {/* AI Quick Risk Meter Chips */}
        <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {/* Card 1: Kritik Riskler */}
          <div
            onClick={() => setSelectedFilter('CRITICAL_RISK')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedFilter === 'CRITICAL_RISK'
                ? 'bg-rose-500/30 border-rose-400 ring-2 ring-rose-400'
                : 'bg-rose-500/10 border-rose-500/25 hover:bg-rose-500/20'
            }`}
          >
            <div className="flex items-center justify-between text-rose-300 text-xs font-bold">
              <span>🚨 Kritik Adli Risk</span>
              <AlertOctagon className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-2xl font-black text-white mt-1">
              {forensicSummary.criticalCount} <span className="text-xs font-normal text-rose-300">İşlem</span>
            </div>
            <span className="text-[11px] text-rose-200/80 block mt-0.5">Acil müdahale / Dondurma</span>
          </div>

          {/* Card 2: Yüksek Şüphe */}
          <div
            onClick={() => setSelectedFilter('SUSPICIOUS_PRICE')}
            className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between text-amber-300 text-xs font-bold">
              <span>⚠️ Şişirme / Yüksek Fiyat</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-white mt-1">
              {forensicSummary.highRiskCount} <span className="text-xs font-normal text-amber-300">Kayıt</span>
            </div>
            <span className="text-[11px] text-amber-200/80 block mt-0.5">Piyasa üstü 1. teklifler</span>
          </div>

          {/* Card 3: Temiz / Doğrulanmış */}
          <div
            onClick={() => setSelectedFilter('APPROVED')}
            className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-all cursor-pointer"
          >
            <div className="flex items-center justify-between text-emerald-300 text-xs font-bold">
              <span>✓ Doğrulanmış İndirim</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white mt-1">
              {forensicSummary.normalCount} <span className="text-xs font-normal text-emerald-300">Kayıt</span>
            </div>
            <span className="text-[11px] text-emerald-200/80 block mt-0.5">Şeffaf piyasa başarısı</span>
          </div>

          {/* Card 4: Portföy Güvenilirlik Skoru */}
          <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25">
            <div className="flex items-center justify-between text-indigo-300 text-xs font-bold">
              <span>🛡️ Portföy Doğruluk Oranı</span>
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white mt-1">
              %{forensicSummary.cleanRatePct}
            </div>
            <span className="text-[11px] text-indigo-200/80 block mt-0.5">
              İncelenen: {formatRuble(forensicSummary.totalScrutinizedSpend)}
            </span>
          </div>
        </div>

        {/* Expandable Executive Forensic Briefing */}
        {showAiBriefing && (
          <div className="relative z-10 bg-white/5 border border-white/10 rounded-xl p-4 sm:p-5 space-y-3 animate-in fade-in">
            <div className="flex items-center space-x-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
              <BrainCircuit className="w-4 h-4 text-indigo-400" />
              <span>Yapay Zeka Başdenetçi Portföy Brifingi & Tespit Edilen Sistemsel Riskler</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-slate-900/60 p-3 rounded-lg border border-white/10 space-y-1">
                <span className="font-bold text-red-300 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Şişirilmiş 1. Teklif Uyarısı</span>
                </span>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  Tedarikçilerin %{forensicSummary.criticalCount > 0 ? Math.round((forensicSummary.criticalCount / auditedList.length) * 100) : 0}'i ilk teklif formunda şirket ortalamasının %25 üzerinde fiyat çekmiş, ardından yapılan indirimle fiyat piyasa normuna çekilmiştir. Bu işlemler dondurulmalıdır.
                </p>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-lg border border-white/10 space-y-1">
                <span className="font-bold text-amber-300 flex items-center gap-1.5">
                  <FileSearch className="w-3.5 h-3.5" />
                  <span>Sepet Küçültme Tespiti</span>
                </span>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  Teklif mektubundaki kalem sayısı ile son faturadaki kalem sayısı uyuşmayan kayıtlar tespit edilmiştir. Malzeme eksiltilerek tutar düşürülmesi gerçek bir indirim değildir.
                </p>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-lg border border-white/10 space-y-1">
                <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>En Yüksek Riskli Tedarikçiler</span>
                </span>
                <div className="text-slate-300 text-[11px] space-y-0.5">
                  {forensicSummary.riskyVendors.length > 0 ? (
                    forensicSummary.riskyVendors.slice(0, 3).map((v, i) => (
                      <div key={i} className="flex justify-between font-mono">
                        <span className="truncate max-w-[140px] font-sans">{v.name}:</span>
                        <span className="text-amber-300">{v.highRiskCount} Riskli</span>
                      </div>
                    ))
                  ) : (
                    <span>Portföy genelinde kronik riskli firma tespit edilmedi.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div
          onClick={() => setSelectedFilter('SUSPICIOUS_PRICE')}
          className={`p-4 rounded-xl border transition-all cursor-pointer ${
            selectedFilter === 'SUSPICIOUS_PRICE'
              ? 'bg-red-50 border-red-400 ring-2 ring-red-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-red-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Şüpheli Başlangıç Fiyatı</span>
            <span className="p-1.5 rounded-lg bg-red-100 text-red-700">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-red-600">{metrics.suspiciousPriceCount}</span>
            <span className="text-xs text-slate-500">İşlem</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Yöntem 1: Şirket ortalamasından %25+ yüksek 1. teklifler</p>
        </div>

        {/* Metric 2 */}
        <div
          onClick={() => setSelectedFilter('EXCESSIVE_DISCOUNT')}
          className={`p-4 rounded-xl border transition-all cursor-pointer ${
            selectedFilter === 'EXCESSIVE_DISCOUNT'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aşırı İndirim Oranı</span>
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-amber-600">{metrics.excessiveDiscountCount}</span>
            <span className="text-xs text-slate-500">İşlem</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Yöntem 2: %25+ indirimli olağandışı marjlar</p>
        </div>

        {/* Metric 3 */}
        <div
          onClick={() => setSelectedFilter('FROZEN')}
          className={`p-4 rounded-xl border transition-all cursor-pointer ${
            selectedFilter === 'FROZEN'
              ? 'bg-sky-50 border-sky-400 ring-2 ring-sky-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-sky-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dondurulan Efor Puanı</span>
            <span className="p-1.5 rounded-lg bg-sky-100 text-sky-700">
              <Snowflake className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-sky-600">{metrics.frozenCount}</span>
            <span className="text-xs text-slate-500">Kayıt Askıda</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Doğrulama yapılana kadar puanlar engellendi</p>
        </div>

        {/* Metric 4 */}
        <div
          onClick={() => setSelectedFilter('APPROVED')}
          className={`p-4 rounded-xl border transition-all cursor-pointer ${
            selectedFilter === 'APPROVED'
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400 shadow-md'
              : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Yönetici Onaylı</span>
            <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline space-x-2">
            <span className="text-2xl font-black text-emerald-600">{metrics.approvedCount}</span>
            <span className="text-xs text-slate-500">Doğrulandı</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Belgesi incelenip puanı onaylanan işlemler</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Firma, personel, şantiye veya malzeme ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs md:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            >
              Temizle
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
          <button
            onClick={() => setSelectedFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              selectedFilter === 'ALL'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Tümü ({auditedList.length})
          </button>
          <button
            onClick={() => setSelectedFilter('CRITICAL_RISK')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
              selectedFilter === 'CRITICAL_RISK'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-300'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-rose-600" />
            <span>🤖 Kritik Adli Risk</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-800/40 text-[10px]">{forensicSummary.criticalCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('FLAGGED_BOTH')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'FLAGGED_BOTH'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
            }`}
          >
            <span>🚨 Çift Risk</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-800/40 text-[10px]">{metrics.doubleRiskCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('SUSPICIOUS_PRICE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'SUSPICIOUS_PRICE'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            <span>Yöntem 1 (Yüksek Fiyat)</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-800/40 text-[10px]">{metrics.suspiciousPriceCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('EXCESSIVE_DISCOUNT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'EXCESSIVE_DISCOUNT'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            <span>Yöntem 2 (%25+ İndirim)</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-800/40 text-[10px]">{metrics.excessiveDiscountCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('FROZEN')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'FROZEN'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200'
            }`}
          >
            <Snowflake className="w-3 h-3" />
            <span>Dondurulanlar</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-sky-800/40 text-[10px]">{metrics.frozenCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('APPROVED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'APPROVED'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <Check className="w-3 h-3" />
            <span>Onaylılar</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-800/40 text-[10px]">{metrics.approvedCount}</span>
          </button>
          <button
            onClick={() => setSelectedFilter('INSPECTION_REQUIRED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              selectedFilter === 'INSPECTION_REQUIRED'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            <span>🛠️ İnceleme Gerekli / Test</span>
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-800/40 text-[10px]">{metrics.inspectionRequiredCount}</span>
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold">
                <th className="py-3 px-4">Tarih & Belge No</th>
                <th className="py-3 px-4">Satınalma & Şantiye</th>
                <th className="py-3 px-4">Tedarikçi</th>
                <th className="py-3 px-4">🤖 AI Denetçi Teşhisi</th>
                <th className="py-3 px-4">Yöntem 1: Piyasa Kıyaslaması</th>
                <th className="py-3 px-4">Yöntem 2: İndirim Oranı</th>
                <th className="py-3 px-4 text-center">Durum & Puan</th>
                <th className="py-3 px-4 text-center">Belgeler (Teklif & Fatura)</th>
                <th className="py-3 px-4 text-right">Yönetici Denetimi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <CheckCircle2 className="w-10 h-10 text-slate-300" />
                      <p className="text-sm font-semibold text-slate-600">Bu filtreye uygun denetim kaydı bulunamadı.</p>
                      <p className="text-xs text-slate-400">Arama kriterini değiştirebilir veya diğer sekmeleri inceleyebilirsiniz.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredList.map(({ record, effectiveStatus, isFrozen, benchmark, matchedInvoice, forensicVerdict }) => {
                  const hasSuspiciousPrice = effectiveStatus === 'SUSPICIOUS_PRICE' || effectiveStatus === 'FLAGGED_BOTH';
                  const hasExcessiveDiscount = effectiveStatus === 'EXCESSIVE_DISCOUNT' || effectiveStatus === 'FLAGGED_BOTH';
                  const isApproved = effectiveStatus === 'EXECUTIVE_APPROVED';
                  const discountPct = Number(record.discountPercentage) || 0;

                  // First offer url & filename
                  const firstDocUrl = resolveDocumentFileUrl(record.firstOfferFileUrl, record.firstOfferDriveFileId);
                  const firstDocName = record.firstOfferFileName || (record.invoiceNo ? `1_Teklif_${record.invoiceNo}.pdf` : '1_Teklif_Belgesi.pdf');
                  
                  // Final invoice url & filename: Direct priority to discount record's own uploaded final document!
                  const discountFinalUrl = resolveDocumentFileUrl(record.finalOfferFileUrl, record.finalOfferDriveFileId);
                  const matchedInvUrl = resolveDocumentFileUrl(matchedInvoice?.fileUrl, matchedInvoice?.driveFileId);

                  const finalDocUrl = discountFinalUrl || matchedInvUrl;
                  const finalDocName = record.finalOfferFileName || matchedInvoice?.rawFileName || (record.invoiceNo ? `Fatura_${record.invoiceNo}.pdf` : 'Son_Fatura.pdf');

                  const personnelOrSupervisor = record.performedByPersonnelName 
                    ? `${record.performedByPersonnelName} (Asist)` 
                    : `${record.supervisorName} (Şef)`;

                  return (
                    <tr
                      key={record.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isFrozen ? 'bg-red-50/20' : isApproved ? 'bg-emerald-50/20' : ''
                      }`}
                    >
                      {/* Tarih & Belge */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{record.orderDate || '-'}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {record.invoiceNo ? `Belge: ${record.invoiceNo}` : `ID: ${record.id.slice(-6)}`}
                        </div>
                      </td>

                      {/* Satınalmacı & Şantiye */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800">
                          {record.performedByPersonnelName ? (
                            <span className="inline-flex items-center space-x-1">
                              <span>{record.performedByPersonnelName}</span>
                              <span className="px-1.5 py-0.2 text-[10px] bg-slate-100 text-slate-600 rounded font-normal">
                                Asist
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center space-x-1">
                              <span>{record.supervisorName}</span>
                              <span className="px-1.5 py-0.2 text-[10px] bg-indigo-50 text-indigo-700 rounded font-semibold">
                                Şef
                              </span>
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{record.jobsiteName}</div>
                      </td>

                      {/* Tedarikçi & Kategori */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 line-clamp-1 max-w-[200px]" title={record.vendorName}>
                          {record.vendorName}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <span>{record.category || 'Genel'}</span>
                          {record.isNewVendor && (
                            <span className="px-1 py-0.2 bg-amber-100 text-amber-800 rounded text-[9px] font-bold">
                              Yeni
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 🤖 AI Denetçi Teşhisi */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRecordForDetail(record);
                              setAuditNoteInput(record.executiveAuditNote || forensicVerdict.executiveRecommendation || '');
                            }}
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-black border shadow-xs cursor-pointer hover:opacity-90 transition-transform active:scale-95 ${forensicVerdict.badgeClass}`}
                            title={forensicVerdict.headline}
                          >
                            <Bot className="w-3.5 h-3.5 shrink-0" />
                            <span>{forensicVerdict.badgeLabel}</span>
                            <span className="text-[10px] opacity-75 font-mono font-normal">
                              {forensicVerdict.riskScore}/100
                            </span>
                          </button>
                          <div className="text-[10px] text-slate-500 font-medium line-clamp-1 max-w-[170px]" title={forensicVerdict.headline}>
                            {forensicVerdict.headline}
                          </div>
                        </div>
                      </td>

                      {/* Yöntem 1: Geçmiş Birim Fiyat Kıyaslaması */}
                      <td className="py-3 px-4">
                        {benchmark ? (
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              {hasSuspiciousPrice ? (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-red-100 text-red-800 border border-red-200">
                                  <ShieldAlert className="w-3 h-3 text-red-600" />
                                  <span>🚨 +%{benchmark.diffPercentage} Yüksek</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                  <Check className="w-3 h-3" />
                                  <span>Piyasaya Uygun</span>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 space-y-0.5">
                              <div className="font-semibold text-slate-800 truncate max-w-[190px]" title={benchmark.materialName}>
                                {benchmark.materialName} ({benchmark.unit || 'Birim'})
                              </div>
                              <div>
                                Teklif: <strong className="text-slate-900">{formatRuble(benchmark.offeredUnitPrice)}</strong>
                              </div>
                              <div className="text-slate-500 text-[10px]">
                                GES Ort: {formatRuble(benchmark.benchmarkAvgPrice)} ({benchmark.referenceCount || 1} Fatura)
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-slate-400 text-xs">
                            <span>Arşivde emsal alım yok</span>
                          </div>
                        )}
                      </td>

                      {/* Yöntem 2: İndirim Oranı */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            {hasExcessiveDiscount ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                <AlertTriangle className="w-3 h-3 text-amber-600" />
                                <span>⚠️ %{discountPct} (Aşırı)</span>
                              </span>
                            ) : (
                              <span className="font-bold text-slate-800">%{discountPct}</span>
                            )}
                          </div>
                          <div className="text-[11px] font-semibold text-emerald-600">
                            {formatRuble(record.discountAmount)}
                          </div>
                        </div>
                      </td>

                      {/* Durum & Puan */}
                      <td className="py-3 px-4 text-center">
                        {record.isInvalidTestRecord || effectiveStatus === 'INSPECTION_REQUIRED' ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300" title="Migration / Test Kaydı (KPI Dışı Bırakıldı)">
                            <span>🛠️ İnceleme Gerekli</span>
                          </span>
                        ) : isApproved ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <Check className="w-3.5 h-3.5" />
                            <span>✓ Puan Aktif</span>
                          </span>
                        ) : isFrozen ? (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-black bg-sky-100 text-sky-800 border border-sky-300">
                            <Snowflake className="w-3.5 h-3.5 text-sky-600" />
                            <span>❄️ Puan Donduruldu</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            <span>Normal</span>
                          </span>
                        )}
                      </td>

                      {/* Belgeler (1. Teklif ve Son Fatura) */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center gap-1.5">
                          {/* 1. Teklif Belgesi */}
                          {firstDocUrl ? (
                            <button
                              onClick={() => {
                                openOriginalFileViewer(firstDocUrl, firstDocName, {
                                  supplier: record.vendorName,
                                  jobsiteName: record.jobsiteName,
                                  date: record.orderDate,
                                  amount: record.offerPrice,
                                  documentType: '1. Ham Teklif Belgesi (Pazarlık Öncesi Başlangıç)',
                                  supervisorName: personnelOrSupervisor,
                                  items: record.items || []
                                });
                              }}
                              className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-semibold text-[11px] border border-indigo-200 cursor-pointer w-28 justify-center shadow-xs"
                              title={firstDocName}
                            >
                              <FileText className="w-3 h-3 text-indigo-600 shrink-0" />
                              <span className="truncate">1. Teklifi Aç</span>
                            </button>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">1. Teklif Yok</span>
                          )}

                          {/* Son Fatura Belgesi */}
                          {finalDocUrl ? (
                            <button
                              onClick={() => {
                                openOriginalFileViewer(finalDocUrl, finalDocName, {
                                  supplier: record.vendorName,
                                  jobsiteName: record.jobsiteName,
                                  date: record.orderDate,
                                  amount: record.agreedPrice,
                                  documentType: '2. Belge / Kesilen Son Fatura (İndirimli Sonuç)',
                                  supervisorName: personnelOrSupervisor,
                                  items: record.items || []
                                });
                              }}
                              className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold text-[11px] border border-emerald-200 cursor-pointer w-28 justify-center shadow-xs"
                              title={finalDocName}
                            >
                              <Receipt className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span className="truncate">Son Faturayı Aç</span>
                            </button>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">Fatura Yok</span>
                          )}
                        </div>
                      </td>

                      {/* Yönetici Aksiyonu */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => {
                              setSelectedRecordForDetail(record);
                              setAuditNoteInput(record.executiveAuditNote || '');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-colors shadow-sm cursor-pointer flex items-center space-x-1"
                            title="Salağa Anlatır Gibi Detaylı Teşhis ve İki Belge Karşılaştırması"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>İncele</span>
                          </button>

                          {isFrozen ? (
                            <button
                              onClick={() => handleApprove(record)}
                              disabled={isSubmitting}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                              title="1. Teklifi Doğrula ve Puanı Çöz"
                            >
                              ✓ Onayla
                            </button>
                          ) : !isApproved && (hasSuspiciousPrice || hasExcessiveDiscount) ? (
                            <button
                              onClick={() => handleFreeze(record)}
                              disabled={isSubmitting}
                              className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-black text-xs transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                              title="Puanı Dondur"
                            >
                              ❄️ Dondur
                            </button>
                          ) : null}
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

      {/* ========================================================================= */}
      {/* DETAYLI VE "SALAĞA ANLATIR GİBİ" YÖNETİCİ TEŞHİS & BELGE KARŞILAŞTIRMA MODALI */}
      {/* ========================================================================= */}
      {selectedRecordForDetail && selectedAuditItem && (() => {
        const record = selectedRecordForDetail;
        const audit = selectedAuditItem;
        const benchmark = audit.benchmark;
        const matchedInv = audit.matchedInvoice;
        const hasSuspiciousPrice = audit.effectiveStatus === 'SUSPICIOUS_PRICE' || audit.effectiveStatus === 'FLAGGED_BOTH';
        const hasExcessiveDiscount = audit.effectiveStatus === 'EXCESSIVE_DISCOUNT' || audit.effectiveStatus === 'FLAGGED_BOTH';
        const discountPct = Number(record.discountPercentage) || 0;

        // Document links & filenames
        const firstDocUrl = resolveDocumentFileUrl(record.firstOfferFileUrl, record.firstOfferDriveFileId);
        const firstDocName = record.firstOfferFileName || (record.invoiceNo ? `1_Teklif_${record.invoiceNo}.pdf` : '1_Teklif_Belgesi.pdf');

        // Direct priority to discount record's own uploaded final document
        const discountFinalUrl = resolveDocumentFileUrl(record.finalOfferFileUrl, record.finalOfferDriveFileId);
        const matchedInvUrl = resolveDocumentFileUrl(matchedInv?.fileUrl, matchedInv?.driveFileId);

        const finalDocUrl = discountFinalUrl || matchedInvUrl;
        const finalDocName = record.finalOfferFileName || matchedInv?.rawFileName || (record.invoiceNo ? `Fatura_${record.invoiceNo}.pdf` : 'Son_Fatura.pdf');

        const personnelOrSupervisor = record.performedByPersonnelName 
          ? `${record.performedByPersonnelName} (Asist - Personel)` 
          : `${record.supervisorName} (Satınalma Şefi)`;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-4xl my-auto overflow-hidden flex flex-col max-h-[92vh]">
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                    <Scale className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-base sm:text-lg font-black text-white">Yönetici Teşhis ve Doğrulama Raporu</h3>
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 text-[11px] font-bold border border-indigo-400/30">
                        {record.invoiceNo ? `Belge: ${record.invoiceNo}` : 'İndirim Kaydı'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      {record.vendorName} • {record.jobsiteName} • {record.orderDate}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRecordForDetail(null)}
                  className="text-slate-400 hover:text-white p-2 rounded-xl text-lg hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-4 sm:p-6 space-y-6 overflow-y-auto flex-1 bg-slate-50/60">

                {/* ========================================================= */}
                {/* 0. 🤖 YAPAY ZEKA KIDEMLİ BAŞDENETÇİ ADLİ İNCELEME MASASI */}
                {/* ========================================================= */}
                <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 rounded-2xl p-5 sm:p-6 border-2 border-indigo-500/40 text-white shadow-xl space-y-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-white/10 relative z-10">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                        <Bot className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="font-black text-sm sm:text-base text-white">
                            Yapay Zeka Kıdemli Başdenetçi Mütalaası
                          </h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${audit.forensicVerdict.badgeClass}`}>
                            {audit.forensicVerdict.badgeLabel} ({audit.forensicVerdict.riskScore}/100 Risk)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Gerçek bir adli bilişim müfettişi gibi satır satır denetlendi
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleLiveAuditSingle(record)}
                      disabled={isAuditingLive}
                      className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50 border border-indigo-400/40 shadow-sm shrink-0"
                      title="Gemini AI ile Canlı Olarak Derinlemesine Denetle"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isAuditingLive ? 'animate-spin text-indigo-200' : ''}`} />
                      <span>{isAuditingLive ? 'Canlı Denetleniyor...' : '🤖 AI ile Canlı Yeniden İncele'}</span>
                    </button>
                  </div>

                  {/* 4-Step Forensic Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs relative z-10">
                    {/* 1. Başlangıç Fiyatı Şişirme */}
                    <div className={`p-3.5 rounded-xl border ${audit.forensicVerdict.checks.initialPriceInflation.detected ? 'bg-red-500/15 border-red-500/40 text-red-200' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                      <span className="font-bold block text-xs mb-1 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                        <span>1. Başlangıç Fiyatı & Şişirme İncelemesi:</span>
                      </span>
                      <p className="text-[11.5px] leading-relaxed">
                        {audit.forensicVerdict.checks.initialPriceInflation.details}
                      </p>
                    </div>

                    {/* 2. Sepet & Miktar Teyidi */}
                    <div className={`p-3.5 rounded-xl border ${audit.forensicVerdict.checks.basketShrinkage.detected ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                      <span className="font-bold block text-xs mb-1 flex items-center gap-1.5">
                        <FileSearch className="w-3.5 h-3.5 text-amber-400" />
                        <span>2. Sepet & Miktar Teyidi (Kalem Eksiltme):</span>
                      </span>
                      <p className="text-[11.5px] leading-relaxed">
                        {audit.forensicVerdict.checks.basketShrinkage.details}
                      </p>
                    </div>

                    {/* 3. Emsal Kıyaslama */}
                    <div className={`p-3.5 rounded-xl border ${audit.forensicVerdict.checks.marketBenchmark.detected ? 'bg-rose-500/15 border-rose-500/40 text-rose-200' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                      <span className="font-bold block text-xs mb-1 flex items-center gap-1.5">
                        <Receipt className="w-3.5 h-3.5 text-rose-400" />
                        <span>3. GES Arşiv Emsal Kıyaslaması:</span>
                      </span>
                      <p className="text-[11.5px] leading-relaxed">
                        {audit.forensicVerdict.checks.marketBenchmark.details}
                      </p>
                    </div>

                    {/* 4. Evrak Bütünlüğü */}
                    <div className={`p-3.5 rounded-xl border ${audit.forensicVerdict.checks.documentIntegrity.detected ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                      <span className="font-bold block text-xs mb-1 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-amber-400" />
                        <span>4. Evrak & Belge Bütünlüğü:</span>
                      </span>
                      <p className="text-[11.5px] leading-relaxed">
                        {audit.forensicVerdict.checks.documentIntegrity.details}
                      </p>
                    </div>
                  </div>

                  {/* Human Auditor Narrative */}
                  <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-2 relative z-10">
                    <div className="flex items-center space-x-2 text-indigo-300 font-bold text-xs">
                      <BrainCircuit className="w-4 h-4 text-indigo-400" />
                      <span>Kıdemli Adli Denetçi Gerekçeli Karar Metni:</span>
                    </div>
                    <div className="text-slate-200 text-xs sm:text-[12.5px] leading-relaxed whitespace-pre-line font-sans">
                      {audit.forensicVerdict.humanAuditorNarrative}
                    </div>
                  </div>

                  {/* Recommendation & Instant Action */}
                  <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-900/80 to-purple-900/80 border border-indigo-400/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs relative z-10">
                    <div className="flex items-center space-x-2.5">
                      <ShieldCheck className="w-5 h-5 text-indigo-300 shrink-0" />
                      <div>
                        <span className="font-bold text-indigo-200 block text-[10px] uppercase tracking-wider">
                          Denetçi Hükmü ve Yöneticiye Tavsiye:
                        </span>
                        <span className="text-white font-bold text-xs sm:text-sm">
                          {audit.forensicVerdict.executiveRecommendation}
                        </span>
                      </div>
                    </div>

                    {audit.forensicVerdict.recommendedAction === 'FREEZE' && !audit.isFrozen && (
                      <button
                        type="button"
                        onClick={() => {
                          setAuditNoteInput(audit.forensicVerdict.executiveRecommendation);
                          handleFreeze(record);
                        }}
                        className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs whitespace-nowrap cursor-pointer shadow-md shrink-0"
                      >
                        ❄️ Tavsiyeyi Uygula: Puanı Dondur
                      </button>
                    )}
                  </div>
                </div>

                {/* ========================================================= */}
                {/* 1. "SALAĞA ANLATIR GİBİ" AÇIK VE NET TEŞHİS BÖLÜMÜ */}
                {/* ========================================================= */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
                  <div className="flex items-center space-x-2 pb-3 border-b border-slate-100">
                    <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg font-black text-xs">
                      🔍 TEŞHİS
                    </div>
                    <h4 className="font-black text-sm text-slate-900">
                      Bu İşlemde Ne Oldu ve Sistem Neden Alarm Verdi? (Net Açıklama)
                    </h4>
                  </div>

                  {/* Olayın Özeti */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-800 space-y-2">
                    <div className="font-bold text-slate-900 flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
                      <span>1. Olayın Özeti:</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed pl-4">
                      Satınalma görevlisi <strong>{personnelOrSupervisor}</strong>, <strong>{record.jobsiteName}</strong> şantiyesi için{' '}
                      <strong>{record.vendorName}</strong> firmasından alım yaptı. Satınalmacı sisteme:{' '}
                      <em>"Tedarikçi bana ilk başta <strong>{formatRuble(record.offerPrice)}</strong> teklif verdi, ben sıkı pazarlık yaparak bunu{' '}
                      <strong>{formatRuble(record.agreedPrice)}</strong> seviyesine indirdim ve şirkete{' '}
                      <strong className="text-emerald-700">{formatRuble(record.discountAmount)} (%{discountPct})</strong> tasarruf sağladım"</em>{' '}
                      beyanında bulundu.
                    </p>
                  </div>

                  {/* Neden Şüphelenildi? */}
                  <div className="space-y-3">
                    <div className="font-bold text-xs sm:text-sm text-slate-900 flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
                      <span>2. Sistem Neden Şüphelendi? (Risklerin Sebebi):</span>
                    </div>

                    {/* Yöntem 1 Şüphesi & Doğrulanmış Emsal Fatura Kanıtları */}
                    {hasSuspiciousPrice && benchmark && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs space-y-3">
                        <div className="flex items-center space-x-2 font-black text-red-900 text-sm">
                          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                          <span>🚨 YÖNTEM 1 RİSKİ: ŞİŞİRİLMİŞ BAŞLANGIÇ FİYATI ŞÜPHESİ (+%{benchmark.diffPercentage} Sapma)</span>
                        </div>

                        <div className="bg-white/80 p-2.5 rounded-lg border border-red-200 text-xs text-slate-800 space-y-1">
                          <div className="font-bold text-slate-900 flex items-center justify-between">
                            <span>Analiz Edilen Malzeme: <span className="text-red-700">{benchmark.materialName}</span></span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono font-bold">
                              Birim: {benchmark.unit || 'Adet'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {benchmark.matchExplanation || 'GES Construction arşivindeki geçmiş resmi faturalara dayalı piyasa ortalaması'}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs my-1 bg-white p-3 rounded-lg border border-red-200">
                          <div>
                            <span className="text-slate-500 block text-[10px] font-sans">Tedarikçinin 1. Teklif Birim Fiyatı:</span>
                            <span className="font-bold text-red-700 text-sm">{formatRuble(benchmark.offeredUnitPrice)} / {benchmark.unit || 'Adet'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[10px] font-sans">Faturadaki Son Birim Fiyat:</span>
                            <span className="font-bold text-emerald-700 text-sm">{benchmark.currentUnitPrice ? `${formatRuble(benchmark.currentUnitPrice)} / ${benchmark.unit || 'Adet'}` : '-'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[10px] font-sans">GES Şirket Geçmiş Ortalaması:</span>
                            <span className="font-bold text-slate-900 text-sm">{formatRuble(benchmark.benchmarkAvgPrice)} / {benchmark.unit || 'Adet'}</span>
                            <span className="block text-[10px] text-slate-400 font-sans mt-0.5">
                              Geçmiş Aralık: {formatRuble(benchmark.benchmarkMinPrice || benchmark.benchmarkAvgPrice)} - {formatRuble(benchmark.benchmarkMaxPrice || benchmark.benchmarkAvgPrice)}
                            </span>
                          </div>
                        </div>

                        {/* Şirket Arşivindeki Gerçek Emsal Faturalar Tablosu (Kanıtlar) */}
                        {benchmark.referenceInvoices && benchmark.referenceInvoices.length > 0 && (
                          <div className="bg-white rounded-lg border border-red-200 overflow-hidden shadow-xs">
                            <div className="bg-red-100/60 px-3 py-2 text-[11px] font-bold text-red-950 flex items-center justify-between border-b border-red-200">
                              <span className="flex items-center space-x-1.5">
                                <Receipt className="w-3.5 h-3.5 text-red-700 shrink-0" />
                                <span>Şirket Arşivindeki Gerçek Emsal Faturalar ({benchmark.referenceInvoices.length} Adet Kanıt):</span>
                              </span>
                              <span className="text-[10px] text-red-800 font-normal">Bu piyasa ortalaması aşağıdaki faturalardan hesaplanmıştır</span>
                            </div>
                            <div className="divide-y divide-slate-100 text-[11px]">
                              {benchmark.referenceInvoices.map((ref, idx) => (
                                <div key={idx} className="p-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50">
                                  <div className="space-y-0.5 min-w-[200px]">
                                    <div className="font-bold text-slate-900 flex items-center space-x-1.5">
                                      <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                                      <span>Fatura No: {ref.invoiceNumber}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Tedarikçi: {ref.supplier} {ref.jobsiteName ? `• ${ref.jobsiteName}` : ''}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div className="font-mono font-bold text-slate-900">
                                      {formatRuble(ref.unitPrice)} / {ref.unit || benchmark.unit || 'Adet'}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      Fatura Tarihi: {ref.date} {ref.quantity ? `(${ref.quantity} ${ref.unit || ''})` : ''}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-red-950 leading-relaxed">
                          <strong>👉 Bu Ne Anlama Geliyor? (Tehlike Nedir?):</strong> Tedarikçi firma, başlangıç liste fiyatını gerçek piyasanın çok üzerinde ({formatRuble(benchmark.offeredUnitPrice)}) yazmış görünüyor. Şirketimiz aynı malzemeyi geçmişte arşivdeki faturalardan görüleceği üzere ortalama {formatRuble(benchmark.benchmarkAvgPrice)} seviyesinden temin etmiştir.
                        </p>
                        <p className="text-red-900 font-semibold bg-red-100/60 p-2 rounded border border-red-200/60">
                          ⚠️ Sonuç: Eğer başlangıç fiyatı baştan havadan şişirildiyse şirket gerçekte indirim kazanmamış; yalnızca şişirilmiş fiyat gerçeğe çekilmiştir. Lütfen 1. teklif belgesini ve faturaları karşılaştırıp kararınızı verin.
                        </p>
                      </div>
                    )}

                    {/* Yöntem 1 Doğrulaması (Piyasaya Uygunsa) */}
                    {benchmark && !hasSuspiciousPrice && (
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-2">
                        <div className="flex items-center space-x-2 font-bold text-emerald-900">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>✓ Yöntem 1 (Birim Fiyat Denetimi): Fiyat Şirket Geçmişiyle Tam Uyumlu</span>
                        </div>
                        <div className="text-emerald-950 text-[11px] leading-relaxed">
                          Bu malzemenin (<strong>{benchmark.materialName}</strong>) teklif birim fiyatı (<strong>{formatRuble(benchmark.offeredUnitPrice)} / {benchmark.unit || 'Birim'}</strong>), GES Construction arşivindeki {benchmark.referenceCount || 1} adet geçmiş fatura ortalamasıyla (<strong>{formatRuble(benchmark.benchmarkAvgPrice)} / {benchmark.unit || 'Birim'}</strong>) uyumludur (Sapma: %{benchmark.diffPercentage}). Şişirilmiş fiyat bulgusu yoktur.
                        </div>
                        {benchmark.referenceInvoices && benchmark.referenceInvoices.length > 0 && (
                          <div className="text-[10px] text-emerald-800 bg-white/70 p-2 rounded border border-emerald-200">
                            Referans Fatura: No: {benchmark.referenceInvoices[0].invoiceNumber} | Tedarikçi: {benchmark.referenceInvoices[0].supplier} | Tarih: {benchmark.referenceInvoices[0].date} ({formatRuble(benchmark.referenceInvoices[0].unitPrice)} / {benchmark.referenceInvoices[0].unit})
                          </div>
                        )}
                      </div>
                    )}

                    {/* Emsal Yoksa */}
                    {!benchmark && (
                      <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block text-slate-800">ℹ️ Yöntem 1 (Birim Fiyat Kıyaslaması): Emsal Arşiv Kaydı Yok</span>
                          <span className="text-[11px] text-slate-600">
                            GES Construction şirket arşivinde bu malzeme ve birim için geçmiş fatura kaydı bulunmamaktadır. Sistem farazi/uydurma kıyaslama yapmaz. Yöntem 1 riski uygulanmamıştır.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Yöntem 2 Şüphesi */}
                    {hasExcessiveDiscount && (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-2">
                        <div className="flex items-center space-x-2 font-black text-amber-900 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>⚠️ YÖNTEM 2 RİSKİ: AŞIRI İNDİRİM ORANI (%{discountPct})</span>
                        </div>
                        <p className="text-amber-950 leading-relaxed">
                          İnşaat toptancılığı ve malzeme tedariğinde firmaların net kâr marjları genelde <strong>%5 ile %15</strong> arasındadır. Bir tedarikçinin tek seferde <strong>%{discountPct}</strong> gibi olağandışı bir indirim vermesi ticari teamüllere aykırıdır.
                        </p>
                        <p className="text-amber-900 font-semibold bg-amber-100/60 p-2 rounded border border-amber-200/60">
                          👉 Olası İki Neden Vardır:
                          <br />1) Liste fiyatı kasıtlı olarak havadan şişirilmiştir.
                          <br />2) İlk teklifteki bazı malzemeler son faturadan çıkarılmış (sepet küçültülmüş) ve tutar düştüğü için aradaki fark sistemde 'pazarlık indirimi' zannedilmiştir.
                        </p>
                      </div>
                    )}

                    {/* Dondurma Sebebi */}
                    {audit.isFrozen && (
                      <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-950 flex items-start space-x-2.5">
                        <Snowflake className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block text-sky-900">❄️ Efor Puanı Neden Donduruldu?</span>
                          <span>
                            Sistem, bu iki şüphe aydınlanana kadar satınalmacının performans hanesine bu indirimden puan eklenmesini durdurmuştur. Siz (Yönetici) iki resmi belgeyi gözünüzle karşılaştırıp onaylayana kadar bu puan dondurulmuş kalır.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ========================================================= */}
                {/* 2. İKİ BELGE YAN YANA KARŞILAŞTIRMA VİTRİNİ */}
                {/* ========================================================= */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-sm text-slate-900 flex items-center space-x-2">
                      <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                      <span>Karşılaştırılacak İki Belge (1. Teklif Belgesi vs Son Fatura)</span>
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      Lütfen her iki belgeyi de açıp kalemleri ve tutarları kontrol edin
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* SOL KUTU: 1. TEKLİF BELGESİ */}
                    <div className="bg-white p-5 rounded-2xl border-2 border-indigo-200 shadow-sm space-y-4 relative overflow-hidden">
                      <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-bl-xl">
                        1. Belge: Başlangıç
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="p-3 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">
                            Gelen İlk Teklif Belgesi
                          </span>
                          <h5 className="font-black text-slate-900 text-base truncate" title={firstDocName}>
                            {firstDocName}
                          </h5>
                          <span className="text-xs text-slate-500 block mt-0.5">
                            Tedarikçinin sunduğu ilk liste fiyatı
                          </span>
                        </div>
                      </div>

                      <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-semibold text-slate-600">Teklif Fiyatı:</span>
                          <span className="text-base font-black text-slate-900">{formatRuble(record.offerPrice)}</span>
                        </div>
                        {record.adjustedOfferPrice && record.adjustedOfferPrice !== record.offerPrice && (
                          <div className="flex items-baseline justify-between text-xs text-slate-500">
                            <span>Düzeltilmiş Teklif:</span>
                            <span className="font-semibold text-slate-700">{formatRuble(record.adjustedOfferPrice)}</span>
                          </div>
                        )}
                      </div>

                      {/* Aç / Önizle Butonu */}
                      {firstDocUrl ? (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => openOriginalFileViewer(firstDocUrl, firstDocName, {
                              supplier: record.vendorName,
                              jobsiteName: record.jobsiteName,
                              date: record.orderDate,
                              amount: record.offerPrice,
                              documentType: '1. Ham Teklif Belgesi (Pazarlık Öncesi)',
                              supervisorName: personnelOrSupervisor,
                              items: record.items || []
                            })}
                            className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-sm"
                          >
                            <FileText className="w-4 h-4" />
                            <span>1. Teklif Belgesini Aç / Görüntüle</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                          </button>
                          <a
                            href={firstDocUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
                            title="Yeni Sekmede Aç"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium text-center">
                          ⚠️ Satınalmacı 1. teklif dosyasını sisteme yüklememiş!
                        </div>
                      )}
                    </div>

                    {/* SAĞ KUTU: SON FATURA */}
                    <div className="bg-white p-5 rounded-2xl border-2 border-emerald-200 shadow-sm space-y-4 relative overflow-hidden">
                      <div className="absolute top-0 right-0 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-bl-xl">
                        2. Belge: Sonuç
                      </div>
                      <div className="flex items-start space-x-3">
                        <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
                          <Receipt className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">
                            Son Resmi Fatura / Proforma
                          </span>
                          <h5 className="font-black text-slate-900 text-base truncate" title={finalDocName}>
                            {finalDocName}
                          </h5>
                          <span className="text-xs text-slate-500 block mt-0.5">
                            {record.invoiceNo ? `Fatura No: ${record.invoiceNo}` : 'Fiili Satın Alma Faturası'}
                          </span>
                        </div>
                      </div>

                      <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-semibold text-slate-600">Ödenen / Anlaşılan:</span>
                          <span className="text-base font-black text-emerald-700">{formatRuble(record.agreedPrice)}</span>
                        </div>
                        <div className="flex items-baseline justify-between text-xs text-slate-500">
                          <span>İşlem Tarihi:</span>
                          <span className="font-semibold text-slate-700">{record.orderDate || '-'}</span>
                        </div>
                      </div>

                      {/* Aç / Önizle Butonu */}
                      {finalDocUrl ? (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => openOriginalFileViewer(finalDocUrl, finalDocName, {
                              supplier: record.vendorName,
                              jobsiteName: record.jobsiteName,
                              date: record.orderDate,
                              amount: record.agreedPrice,
                              documentType: '2. Belge / Kesilen Son Fatura (İndirimli)',
                              supervisorName: personnelOrSupervisor,
                              items: record.items || []
                            })}
                            className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-sm"
                          >
                            <Receipt className="w-4 h-4" />
                            <span>Son Faturayı Aç / Görüntüle</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                          </button>
                          <a
                            href={finalDocUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors"
                            title="Yeni Sekmede Aç"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-medium text-center">
                          Fatura dosyası bulunamadı
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Aradaki Fark Özeti Banner */}
                  <div className="bg-gradient-to-r from-indigo-50 via-white to-emerald-50 p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                    <div className="flex items-center space-x-2">
                      <div className="p-2 rounded-lg bg-indigo-600 text-white font-black text-xs">
                        NET FARK
                      </div>
                      <div>
                        <span className="text-xs text-slate-500 block">Beyan Edilen İndirim:</span>
                        <span className="text-base font-black text-emerald-700">
                          {formatRuble(record.discountAmount)} (%{discountPct})
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">
                      İlk Teklif: <strong>{formatRuble(record.offerPrice)}</strong> ➔ Son Fatura:{' '}
                      <strong>{formatRuble(record.agreedPrice)}</strong>
                    </div>
                  </div>
                </div>

                {/* ========================================================= */}
                {/* 3. YÖNETİCİNİN YAPMASI GEREKEN 3 ADIMLI KONTROL REHBERİ */}
                {/* ========================================================= */}
                <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
                  <div className="flex items-center space-x-2 text-indigo-300">
                    <HelpCircle className="w-4 h-4" />
                    <span className="font-bold text-xs uppercase tracking-wider">
                      Yönetici Olarak Ne Yapmalısınız? (Karar Verme Rehberi)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-1">
                      <span className="font-bold text-indigo-300 block">1. Adım: 1. Teklifi Açın</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Sol taraftaki 1. teklif belgesini açın. Gerçekten tedarikçinin resmi e-postası veya kaşeli antetli teklif formu mu?
                      </p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-1">
                      <span className="font-bold text-emerald-300 block">2. Adım: Son Faturayı Açın</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Sağdaki son faturayı açın. 1. teklifteki malzeme miktarı ve cinsi ile faturadakiler aynı mı? (Kalem eksiltilerek mi tutar düşürüldü?)
                      </p>
                    </div>
                    <div className="bg-white/5 p-3 rounded-xl border border-white/10 space-y-1">
                      <span className="font-bold text-amber-300 block">3. Adım: Kararınızı Verin</span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Pazarlık sahiciyse <strong>[Doğrula & Puanı Çöz]</strong>'e basın. Şişirme fiyat varsa <strong>[Puanı Dondur]</strong>'a basın.
                      </p>
                    </div>
                  </div>
                </div>

                {/* ========================================================= */}
                {/* 4. KALEM VE MALZEME BAZINDA DETAYLAR (VARSA) */}
                {/* ========================================================= */}
                {(record.items && record.items.length > 0) || (matchedInv?.items && matchedInv.items.length > 0) ? (
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                    <span className="font-bold text-xs text-slate-800 uppercase tracking-wider block">
                      📋 Tespit Edilen Malzeme Kalemleri:
                    </span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 font-bold">
                            <th className="pb-2">Malzeme Adı</th>
                            <th className="pb-2">Miktar</th>
                            <th className="pb-2">Birim Fiyat</th>
                            <th className="pb-2">Toplam Tutar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(record.items || matchedInv?.items || []).map((item, i) => (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="py-2 font-semibold text-slate-800">{item.materialName || 'Malzeme'}</td>
                              <td className="py-2 text-slate-600">{item.quantity} {item.unit || 'Adet'}</td>
                              <td className="py-2 text-slate-700 font-mono">{formatRuble(item.unitPrice)}</td>
                              <td className="py-2 font-bold text-slate-900 font-mono">{formatRuble(item.totalPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* ========================================================= */}
                {/* 5. YÖNETİCİ DENETİM NOTU VE KARAR ALANI */}
                {/* ========================================================= */}
                <div className="space-y-1.5 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                    Yönetici Denetim Notu (Gerekçenizi Yazın):
                  </label>
                  <textarea
                    rows={2}
                    value={auditNoteInput}
                    onChange={(e) => setAuditNoteInput(e.target.value)}
                    placeholder="Örn: 1. Teklif belgesi ve son fatura karşılaştırıldı. Malzeme adetleri uyumlu ve indirim teyit edildi."
                    className="w-full p-3 text-xs md:text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {record.executiveAuditNote && (
                    <div className="text-[11px] text-slate-500 italic mt-1">
                      Önceki Denetim Notu: "{record.executiveAuditNote}" ({record.auditReviewedBy || 'Yönetici'} - {record.auditReviewedAt?.slice(0, 10) || ''})
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer / Action Buttons */}
              <div className="bg-slate-100 p-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                <button
                  onClick={() => setSelectedRecordForDetail(null)}
                  className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200 font-bold text-xs transition-colors cursor-pointer w-full sm:w-auto"
                >
                  Kapat
                </button>

                <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => handleFreeze(record)}
                    disabled={isSubmitting}
                    className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs transition-colors flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                    title="Şüpheli İşlem: Puanı Dondur"
                  >
                    <Snowflake className="w-4 h-4" />
                    <span>❄️ Şüpheli / Puanı Dondur</span>
                  </button>

                  <button
                    onClick={() => handleApprove(record)}
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-colors flex items-center justify-center space-x-1.5 cursor-pointer shadow-md disabled:opacity-50"
                    title="Belgeleri Teyit Ettim: Doğrula ve Puanı Çöz"
                  >
                    <Check className="w-4 h-4" />
                    <span>✓ Doğrula & Puanı Çöz</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
