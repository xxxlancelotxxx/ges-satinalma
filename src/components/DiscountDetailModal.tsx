import React, { useState } from 'react';
import { DiscountRecord, InvoiceItem } from '../types';
import { formatRuble, formatUploadDate, openOriginalFileViewer, getSafeFileUrl } from '../utils/format';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { buildDiscountLineComparisons, DiscountLineComparison } from '../utils/discountLineReference';
import {
  X,
  ArrowLeft,
  Coins,
  Award,
  Target,
  Layers,
  Search,
  HardDrive,
  FileCheck2,
  FileText,
  Clock,
  ExternalLink,
  Download,
  Eye,
  Edit3,
  Trash2,
  ShieldAlert,
  Building2,
  UserCheck,
  Calendar,
  CheckCircle2,
  Info,
  TrendingDown,
  Sparkles,
  DollarSign
} from 'lucide-react';

interface DiscountDetailModalProps {
  discount: DiscountRecord;
  onClose: () => void;
  onEditDiscount?: (discount: DiscountRecord) => void;
  onDeleteDiscount?: (id: string) => Promise<void> | void;
  comparativeAnalysisData?: any;
}

export const DiscountDetailModal: React.FC<DiscountDetailModalProps> = ({
  discount,
  onClose,
  onEditDiscount,
  onDeleteDiscount,
  comparativeAnalysisData
}) => {
  useModalBackHandler(true, onClose);

  const [detailModalTab, setDetailModalTab] = useState<'items' | 'documents' | 'rounds'>('items');
  const [detailItemSearch, setDetailItemSearch] = useState<string>('');
  const [detailItemsPage, setDetailItemsPage] = useState<number>(1);
  const [detailItemsPageSize, setDetailItemsPageSize] = useState<number>(20);
  const [detailToast, setDetailToast] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [currentRecord, setCurrentRecord] = useState<DiscountRecord>(discount);

  const allItems: InvoiceItem[] = (Array.isArray(discount.items) && discount.items.length > 0)
    ? discount.items
    : (Number(discount.agreedPrice) > 0
        ? [{
            id: `fallback_${discount.id}`,
            materialName: discount.category || 'Fatura Genel Kalemi',
            originalName: discount.notes || discount.vendorName || '',
            category: discount.category || 'Genel',
            unit: 'Set',
            quantity: 1,
            unitPrice: Number(discount.agreedPrice) || 0,
            totalPrice: Number(discount.agreedPrice) || 0
          }]
        : []);
  const filteredItems = detailItemSearch.trim()
    ? allItems.filter(item =>
        (item.materialName || '').toLowerCase().includes(detailItemSearch.toLowerCase()) ||
        (item.originalName || '').toLowerCase().includes(detailItemSearch.toLowerCase()) ||
        (item.category || '').toLowerCase().includes(detailItemSearch.toLowerCase())
      )
    : allItems;

  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / detailItemsPageSize));
  const safeCurrentPage = Math.min(detailItemsPage, totalPages);
  const paginatedItems = filteredItems.slice(
    (safeCurrentPage - 1) * detailItemsPageSize,
    safeCurrentPage * detailItemsPageSize
  );

  // Effective discount calculations
  const eff = (() => {
    const rawOffer = Number(discount.offerPrice) || 0;
    const rawAgreed = Number(discount.agreedPrice) || 0;
    const scopeDed = Number(discount.scopeDeductionAmount) || 0;
    const baseline = Math.max(0, rawOffer - scopeDed);
    const calculatedDiscount = Math.max(0, baseline - rawAgreed);
    const discountAmount = discount.discountAmount !== undefined ? Number(discount.discountAmount) : calculatedDiscount;
    const discountPercentage = baseline > 0
      ? Number(((discountAmount / baseline) * 100).toFixed(2))
      : (discount.discountPercentage || 0);

    return {
      baseline,
      effectiveAgreed: rawAgreed,
      discountAmount,
      discountPercentage
    };
  })();

  const rFinalPrice = eff.effectiveAgreed;
  const modalBaseline = eff.baseline;
  const finalDisc = eff.discountAmount;
  const finalPct = eff.discountPercentage;

  // Stages calculation - Dynamically includes Initial Offer, All Intermediate Rounds, and Final Invoice
  const detailStages = (() => {
    const stages: Array<{
      stageNumber: number;
      stageType: 'first' | 'round' | 'final' | 'comparison';
      title: string;
      roleBadge: string;
      roleColor: string;
      desc: string;
      stageKey: 'INITIAL_OFFER' | 'ROUND_OFFER' | 'FINAL_INVOICE' | 'COMPARISON_SHEET';
      amount: number;
      previousAmount?: number;
      discountThisStage?: number;
      discountPctThisStage?: number;
      cumulativeDiscount?: number;
      cumulativeDiscountPct?: number;
      docUrl?: string;
      docName?: string;
      docSize?: string;
      date?: string;
      notes?: string;
      vendorName?: string;
    }> = [];

    const baseOffer = Number(discount.adjustedOfferPrice || discount.offerPrice || 0);
    const agreed = Number(discount.agreedPrice || 0);

    // 1. First Stage: Initial Offer (Bargaining Baseline)
    stages.push({
      stageNumber: 1,
      stageType: 'first',
      title: '1. Aşama: İlk Gelen Teklif / Fatura',
      roleBadge: '1. İLK TEKLİF',
      roleColor: 'bg-amber-100 text-amber-900 border-amber-300',
      desc: 'Tedarikçiden alınan ilk resmi fiyat teklifi veya proforma fatura (indirimsiz baz).',
      stageKey: 'INITIAL_OFFER',
      amount: baseOffer,
      previousAmount: undefined,
      discountThisStage: 0,
      discountPctThisStage: 0,
      cumulativeDiscount: 0,
      cumulativeDiscountPct: 0,
      docUrl: discount.firstOfferFileUrl || discount.fileUrl,
      docName: discount.firstOfferFileName || discount.rawFileName || (discount.offerPrice ? `Ilk_Teklif_${discount.invoiceNo || 'Doc'}.pdf` : undefined),
      docSize: discount.firstOfferFileSize || discount.fileSize,
      date: discount.firstOfferDate || discount.orderDate,
      notes: discount.notes || 'Başlangıç teklifi',
      vendorName: discount.vendorName
    });

    // 2. Intermediate Stages: Look at discount.stageDocuments or discount.negotiationRounds
    const rawRounds = Array.isArray(discount.negotiationRounds) ? discount.negotiationRounds : [];
    const rawStages = Array.isArray(discount.stageDocuments) ? discount.stageDocuments : [];

    // Filter intermediate stageDocuments (stages > 1 and not final)
    const intermediateStages = rawStages.filter((s: any) => {
      const isFirst = s.stageNumber === 1 || String(s.title || '').includes('1. İlk');
      const isFinal = s.isFinal || String(s.title || '').includes('Nihai') || String(s.title || '').includes('Son Tur Sonrası');
      return !isFirst && !isFinal;
    });

    let prevAmount = baseOffer;

    if (intermediateStages.length > 0) {
      intermediateStages.forEach((stg: any, idx: number) => {
        const stageNum = idx + 2;
        const curAmount = Number(stg.amount || 0);
        const roundMatch = rawRounds[idx] || rawRounds.find((r: any) => r.roundNumber === idx + 1);
        const thisDiscount = prevAmount > 0 && curAmount > 0 ? Math.max(0, prevAmount - curAmount) : (roundMatch?.discountThisRound || 0);
        const thisPct = prevAmount > 0 ? Number(((thisDiscount / prevAmount) * 100).toFixed(2)) : 0;
        const cumDisc = baseOffer > 0 && curAmount > 0 ? Math.max(0, baseOffer - curAmount) : 0;
        const cumPct = baseOffer > 0 ? Number(((cumDisc / baseOffer) * 100).toFixed(2)) : 0;

        stages.push({
          stageNumber: stageNum,
          stageType: 'round',
          title: `${stageNum}. Aşama: ${idx + 1}. Tur Ara Pazarlık Teklifi`,
          roleBadge: `${idx + 1}. TUR ARA PAZARLIK`,
          roleColor: 'bg-indigo-100 text-indigo-950 border-indigo-300',
          desc: `Pazarlık görüşmesi sonrası tedarikçiden temin edilen ${idx + 1}. tur revize indirimli teklif / ara fatura.`,
          stageKey: 'ROUND_OFFER',
          amount: curAmount,
          previousAmount: prevAmount,
          discountThisStage: thisDiscount,
          discountPctThisStage: thisPct,
          cumulativeDiscount: cumDisc,
          cumulativeDiscountPct: cumPct,
          docUrl: stg.fileUrl || roundMatch?.documentUrl,
          docName: stg.fileName || roundMatch?.documentName || `Ara_Pazarlık_Turu_${idx + 1}.pdf`,
          date: roundMatch?.date || discount.orderDate,
          notes: roundMatch?.notes || roundMatch?.note || stg.title,
          vendorName: roundMatch?.vendorName || discount.vendorName
        });

        if (curAmount > 0) prevAmount = curAmount;
      });
    } else if (rawRounds.length > 0) {
      // Reconstruct intermediate stages from negotiationRounds
      rawRounds.forEach((rnd: any, idx: number) => {
        const stageNum = idx + 2;
        const curAmount = Number(rnd.quotedPrice || rnd.price || rnd.offeredPrice || 0);
        const thisDiscount = Number(rnd.discountThisRound) || (prevAmount > 0 && curAmount > 0 ? Math.max(0, prevAmount - curAmount) : 0);
        const thisPct = prevAmount > 0 ? Number(((thisDiscount / prevAmount) * 100).toFixed(2)) : 0;
        const cumDisc = baseOffer > 0 && curAmount > 0 ? Math.max(0, baseOffer - curAmount) : 0;
        const cumPct = baseOffer > 0 ? Number(((cumDisc / baseOffer) * 100).toFixed(2)) : 0;

        stages.push({
          stageNumber: stageNum,
          stageType: 'round',
          title: `${stageNum}. Aşama: ${idx + 1}. Tur Ara Pazarlık Teklifi`,
          roleBadge: `${idx + 1}. TUR ARA PAZARLIK`,
          roleColor: 'bg-indigo-100 text-indigo-950 border-indigo-300',
          desc: `Pazarlık görüşmesi sonrası tedarikçiden temin edilen ${idx + 1}. tur revize indirimli teklif / ara fatura.`,
          stageKey: 'ROUND_OFFER',
          amount: curAmount,
          previousAmount: prevAmount,
          discountThisStage: thisDiscount,
          discountPctThisStage: thisPct,
          cumulativeDiscount: cumDisc,
          cumulativeDiscountPct: cumPct,
          docUrl: rnd.documentUrl,
          docName: rnd.documentName || `Ara_Pazarlık_Turu_${idx + 1}.pdf`,
          date: rnd.date || discount.orderDate,
          notes: rnd.notes || rnd.note,
          vendorName: rnd.vendorName || discount.vendorName
        });

        if (curAmount > 0) prevAmount = curAmount;
      });
    }

    // 3. Final Stage: Son Anlaşılan Nihai Fatura
    const finalStageNum = stages.length + 1;
    const finalThisDiscount = prevAmount > 0 && agreed > 0 ? Math.max(0, prevAmount - agreed) : 0;
    const finalThisPct = prevAmount > 0 ? Number(((finalThisDiscount / prevAmount) * 100).toFixed(2)) : 0;
    const totalNetDisc = baseOffer > 0 && agreed > 0 ? Math.max(0, baseOffer - agreed) : 0;
    const totalNetPct = baseOffer > 0 ? Number(((totalNetDisc / baseOffer) * 100).toFixed(2)) : 0;

    stages.push({
      stageNumber: finalStageNum,
      stageType: 'final',
      title: `${finalStageNum}. Aşama: Nihai Anlaşılan Satınalma Faturası`,
      roleBadge: 'NİHAİ FATURA',
      roleColor: 'bg-emerald-100 text-emerald-950 border-emerald-400',
      desc: 'Tüm pazarlık turları sonucu varılan son mutabakat ve muhasebeye işlenen nihai sevk faturası.',
      stageKey: 'FINAL_INVOICE',
      amount: agreed,
      previousAmount: prevAmount,
      discountThisStage: finalThisDiscount,
      discountPctThisStage: finalThisPct,
      cumulativeDiscount: totalNetDisc,
      cumulativeDiscountPct: totalNetPct,
      docUrl: discount.finalInvoiceFileUrl || discount.finalOfferFileUrl || discount.fileUrl || (discount.invoiceNo ? `/api/files/Fatura_${discount.invoiceNo}.pdf` : undefined),
      docName: discount.finalOfferFileName || discount.finalInvoiceFileName || discount.rawFileName || (discount.invoiceNo ? `Fatura_${discount.invoiceNo}.pdf` : undefined),
      docSize: discount.finalInvoiceFileSize || discount.finalOfferFileSize || discount.fileSize,
      date: discount.finalNegotiationDate || discount.orderDate,
      notes: 'Pazarlık sonucu nihai onaylı mutabakat',
      vendorName: discount.vendorName
    });

    // 4. Comparison Sheet (if present)
    if (discount.comparisonSheetFileUrl || discount.comparativeAnalysisId) {
      const cmpId = discount.comparativeAnalysisId;
      stages.push({
        stageNumber: stages.length + 1,
        stageType: 'comparison',
        title: 'Ek Aşama: Karşılaştırmalı Teklif & Piyasa Analiz Çizelgesi',
        roleBadge: 'KIYAS MATRİSİ',
        roleColor: 'bg-purple-100 text-purple-950 border-purple-300',
        desc: 'Birden fazla firmanın tekliflerinin kıyaslandığı onaylı seçim tablosu.',
        stageKey: 'COMPARISON_SHEET',
        amount: Number(discount.marketReferencePrice || 0),
        docUrl: discount.comparisonSheetFileUrl || (cmpId ? `/api/comparative-analyses/${cmpId}/excel` : (discount.invoiceNo ? `/api/files/Piyasa_Teklif_Kiyas_Tablosu_${discount.invoiceNo}.xlsx` : undefined)),
        docName: discount.comparisonSheetFileName || (discount.invoiceNo ? `Piyasa_Teklif_Kiyas_Tablosu_${discount.invoiceNo}.xlsx` : 'Piyasa_Teklif_Kiyas_Tablosu.xlsx'),
        docSize: discount.comparisonSheetFileSize,
        date: discount.comparisonSheetDate || discount.orderDate
      });
    }

    return stages;
  })();

  const rounds = (() => {
    const rawRounds = Array.isArray(discount.negotiationRounds) ? discount.negotiationRounds : [];
    if (rawRounds.length > 0) {
      const valid = rawRounds.filter(r => {
        if (!r || typeof r !== 'object') return false;
        const hasDoc = Boolean(r.documentName || r.documentUrl || (r as any).documentFileName || (r as any).fileName || (r as any).fileUrl);
        return hasDoc || Boolean(r.notes || r.note);
      });
      if (valid.length > 0) return valid;
    }
    // Fallback to intermediate stages from stageDocuments if rounds array is empty
    const stages = Array.isArray(discount.stageDocuments) ? discount.stageDocuments : [];
    if (stages.length > 2) {
      const intermediate = stages.filter((s: any) => {
        const isFirst = s.stageNumber === 1 || String(s.title || '').includes('1. İlk');
        const isFinal = s.isFinal || String(s.title || '').includes('Nihai') || String(s.title || '').includes('Son Tur Sonrası');
        return !isFirst && !isFinal;
      });
      return intermediate.map((stg: any, idx: number) => ({
        roundNumber: idx + 1,
        date: discount.orderDate,
        vendorName: discount.vendorName,
        quotedPrice: stg.amount || 0,
        documentName: stg.fileName,
        documentUrl: stg.fileUrl,
        notes: stg.title || `${idx + 1}. Ara Pazarlık Turu`
      }));
    }
    return [];
  })();

  // Kalem bazlı ilk teklif referansı: önce ilk teklif PDF'inden, yoksa toplam indirim oranından (bkz. discountLineReference).
  const lineComparisons = buildDiscountLineComparisons({ ...discount, items: allItems } as any, comparativeAnalysisData);
  const getComparativeInfoForItem = (item: InvoiceItem): DiscountLineComparison => {
    const pos = allItems.indexOf(item);
    return lineComparisons[pos >= 0 ? pos : 0] || {
      hasReference: false, refPrice: 0, refSupplier: '', finalPrice: Number(item.unitPrice) || 0,
      finalSupplier: discount.vendorName || '', unitSavings: 0, totalSavings: 0, savingsRate: 0
    };
  };

  const handleOpenDriveDoc = (docUrl?: string, docName?: string) => {
    const targetUrl = docUrl || discount.finalOfferFileUrl || discount.fileUrl || (discount.invoiceNo ? `/api/files/Fatura_${discount.invoiceNo}.pdf` : undefined);
    const targetName = docName || discount.finalOfferFileName || discount.rawFileName || `Fatura_${discount.invoiceNo || 'Belge'}.pdf`;

    openOriginalFileViewer(targetUrl, targetName, {
      supplier: discount.vendorName,
      amount: discount.agreedPrice,
      date: discount.orderDate,
      jobsiteName: discount.jobsiteName,
      invoiceNumber: discount.invoiceNo,
      invoiceNo: discount.invoiceNo,
      items: discount.items,
      supervisorName: discount.supervisorName,
      documentType: 'İndirim & Şef Pazarlık Belgesi'
    });
  };

  const handleDelete = async () => {
    if (!onDeleteDiscount) return;
    try {
      setIsDeleting(true);
      await onDeleteDiscount(discount.id);
      onClose();
    } catch (err) {
      console.error('Error deleting discount:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-hidden animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-slate-900/50 border border-slate-700/80 rounded-2xl sm:rounded-3xl max-w-6xl xl:max-w-7xl w-full h-[92vh] sm:h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 text-left animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header: Dark Slate & Gold Contrast (Polished Executive Header) */}
        <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 z-10 shadow-md text-white">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0 shadow-inner">
              <Coins className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h3 className="text-base sm:text-lg font-black text-white tracking-wide truncate">
                  İndirim & Şef Pazarlık Detayı
                </h3>
                <span className="text-[10px] font-extrabold text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/50 shrink-0">
                  {discount.status || 'Onaylandı'}
                </span>
                {discount.recordOrigin === 'asist' || discount.performedByPersonnelName ? (
                  <span className="text-[10px] font-bold text-indigo-300 bg-indigo-950/80 px-2.5 py-0.5 rounded-full border border-indigo-500/50 shrink-0 flex items-center space-x-1">
                    <Award className="w-3 h-3 text-indigo-400" />
                    <span>ASİST ({discount.performedByPersonnelName || 'Personel'})</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-300 bg-amber-950/80 px-2.5 py-0.5 rounded-full border border-amber-500/50 shrink-0 flex items-center space-x-1">
                    <Target className="w-3 h-3 text-amber-400" />
                    <span>GOL (Şef Kendisi)</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 flex flex-wrap items-center gap-1.5 truncate mt-1">
                <span>Fatura / Teklif: <strong className="text-amber-300 font-mono bg-slate-800 px-1.5 py-0.2 rounded border border-slate-700">{discount.invoiceNo || 'N/A'}</strong></span>
                <span className="text-slate-600">•</span>
                <span className="truncate font-semibold text-slate-200">{discount.vendorName}</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-300">{discount.jobsiteName}</span>
                {discount.orderDate && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-400 font-mono">{discount.orderDate}</span>
                  </>
                )}
                {currentRecord.prizmaRequestCode && (
                  <>
                    <span className="text-slate-600">•</span>
                    <a
                      href="https://pm.gescons.ru/process"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/40 hover:bg-blue-500/30 transition-colors"
                      title="Prizma (pm.gescons.ru) Platformunda İncele"
                    >
                      <span className="font-black text-blue-300">П</span>
                      <span>Prizma: {currentRecord.prizmaRequestCode} {currentRecord.prizmaOrderCode ? `(${currentRecord.prizmaOrderCode})` : ''} - {currentRecord.prizmaStatus || 'Bağlandı'}</span>
                      <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-70" />
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Close & Back Actions */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all border border-slate-700 cursor-pointer shadow-sm active:scale-95"
              title="Önceki ekrana dön (Geri / ESC)"
            >
              <ArrowLeft className="w-4 h-4 text-slate-400" />
              <span>Geri Dön</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              title="Pencereyi Kapat (ESC)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Delete Confirmation Banner */}
        {showDeleteConfirm && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-900 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-150 shrink-0">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
              <span className="text-xs sm:text-sm font-semibold">
                "{discount.invoiceNo || discount.vendorName}" indirim kaydını sistemden kalıcı olarak silmek istediğinize emin misiniz?
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-2 rounded-lg transition-colors flex items-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Siliniyor...' : 'Evet, Sil'}</span>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {/* Comparative Analysis Matrix (If applicable) */}
        {(discount.calculationMethod === 'MARKET_BASELINE_TO_FINAL' || discount.comparativeAnalysisId) && (
          <div className="shrink-0 bg-slate-800/90 px-4 sm:px-6 py-3 border-b border-slate-700 text-white">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center space-x-2">
                <div className="p-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-black text-indigo-200 uppercase tracking-wider">
                  Karşılaştırmalı Teklif & Piyasa Bazlı Tasarruf Matrisi
                </span>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                discount.kpiEligible === true
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                  : 'bg-slate-700 text-slate-300 border-slate-600'
              }`}>
                {discount.kpiEligible === true ? '✓ KPI Hesabına Dahil' : 'Bilgi Amaçlı Kayıt'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Piyasa Referansı */}
              <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-700 flex flex-col justify-between shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                  <span>PİYASA REFERANSI</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">İlk En Düşük</span>
                </div>
                <div className="text-sm font-mono font-black text-slate-200 tracking-tight">
                  {formatRuble(Number(discount.marketReferencePrice) || Number(discount.offerPrice) || 0)}
                </div>
                <span className="text-[9px] text-slate-400 font-sans mt-0.5">Tüm Tekliflerin En İyisi</span>
              </div>

              {/* Nihai Anlaşılan Satınalma */}
              <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-700 flex flex-col justify-between shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                  <span>NİHAİ FATURA</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-600">Satınalma</span>
                </div>
                <div className="text-sm font-mono font-black text-white tracking-tight">
                  {formatRuble(Number(discount.agreedPrice) || 0)}
                </div>
                <span className="text-[9px] text-slate-400 font-sans mt-0.5 truncate" title={discount.vendorName}>
                  {discount.vendorName}
                </span>
              </div>

              {/* Piyasa Bazlı Gerçek Tasarruf */}
              <div className="bg-emerald-950/60 p-2.5 rounded-xl border border-emerald-500/40 flex flex-col justify-between shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-emerald-300 font-bold mb-1">
                  <span>GERÇEK TASARRUF</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-900/80 text-emerald-200 border border-emerald-600">Net KPI</span>
                </div>
                <div className="text-sm font-mono font-black text-emerald-300 tracking-tight">
                  +{formatRuble(Number(discount.realMarketSavings) || Number(discount.discountAmount) || 0)}
                </div>
                <span className="text-[10px] text-emerald-300 font-sans font-semibold mt-0.5">
                  %{discount.realSavingsPercentage || discount.discountPercentage || 0} Tasarruf
                </span>
              </div>

              {/* Aynı Tedarikçi İç İndirimi */}
              <div className="bg-cyan-950/60 p-2.5 rounded-xl border border-cyan-500/40 flex flex-col justify-between shadow-inner">
                <div className="flex items-center justify-between text-[10px] text-cyan-300 font-bold mb-1">
                  <span>FİRMA İÇİ İNDİRİM</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-900/80 text-cyan-200 border border-cyan-600">Şef Pazarlığı</span>
                </div>
                <div className="text-sm font-mono font-black text-cyan-300 tracking-tight">
                  {formatRuble(Number(discount.internalVendorDiscount) || 0)}
                </div>
                <span className="text-[9px] text-cyan-300 font-sans mt-0.5">Firma İlk Teklifi Kıyası</span>
              </div>
            </div>
          </div>
        )}

        {/* 2. Distinct Metric Cards with Clear Borders & Separators */}
        <div className="shrink-0 bg-slate-100 px-4 sm:px-6 py-3 border-b border-slate-300 shadow-2xs">
          {(discount.scopeDeductionAmount && discount.scopeDeductionAmount > 0) ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              {/* 1. İlk Teklif */}
              <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                  <span>1. İlk Teklif Brüt</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">Liste</span>
                </div>
                <span className="text-sm sm:text-base font-mono font-bold text-slate-500 line-through tracking-tight">
                  {formatRuble(discount.offerPrice)}
                </span>
                <span className="text-[10px] text-slate-400 font-sans mt-0.5">Tedarikçi Girişi</span>
              </div>

              {/* 2. Kapsam Düşümü */}
              <div className="bg-amber-50/80 px-3 py-2 rounded-xl border-2 border-amber-300 flex flex-col justify-between shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-amber-900 font-bold uppercase border-b border-amber-200/60 pb-1 mb-1">
                  <span>2. Kapsam Düşümü</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-amber-200/80 text-amber-900 rounded font-bold">Revizyon</span>
                </div>
                <span className="text-sm sm:text-base font-mono font-black text-amber-800 tracking-tight">
                  -{formatRuble(discount.scopeDeductionAmount)}
                </span>
                <span className="text-[10px] text-amber-700 font-sans mt-0.5">Çıkarılan Kalemler</span>
              </div>

              {/* 3. Düzeltilmiş Teklif */}
              <div className="bg-indigo-50/80 px-3 py-2 rounded-xl border-2 border-indigo-300 flex flex-col justify-between shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-indigo-900 font-bold uppercase border-b border-indigo-200/60 pb-1 mb-1">
                  <span>3. Düzeltilmiş Baz</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-indigo-200/80 text-indigo-900 rounded font-bold">Net Baz</span>
                </div>
                <span className="text-sm sm:text-base font-mono font-black text-indigo-950 tracking-tight">
                  {formatRuble(modalBaseline)}
                </span>
                <span className="text-[10px] text-indigo-700 font-sans mt-0.5">Gerçek Pazarlık Bazı</span>
              </div>

              {/* 4. Net İndirim */}
              <div className="bg-emerald-50 px-3 py-2 rounded-xl border-2 border-emerald-400 flex flex-col justify-between shadow-sm ring-1 ring-emerald-400/30">
                <div className="flex items-center justify-between text-[10px] text-emerald-900 font-bold uppercase border-b border-emerald-200 pb-1 mb-1">
                  <span>4. Net Şef İndirimi</span>
                  <span className="text-[9px] px-2 py-0.2 bg-emerald-600 text-white rounded-full font-extrabold">
                    %{finalPct}
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-black text-emerald-700 tracking-tight">
                  +{formatRuble(finalDisc)}
                </span>
                <span className="text-[10px] text-emerald-800 font-sans font-bold mt-0.5">
                  Tasarruf Sağlandı
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              {/* 1. İlk Teklif */}
              <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                  <span>1. İlk Teklif</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">Liste</span>
                </div>
                <span className="text-sm sm:text-base font-mono font-bold text-slate-500 line-through tracking-tight">
                  {formatRuble(discount.offerPrice)}
                </span>
                <span className="text-[10px] text-slate-400 font-sans mt-0.5">Tedarikçi İlk Fiyatı</span>
              </div>

              {/* 2. Son Anlaşılan */}
              <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-700 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                  <span>2. Son Anlaşılan</span>
                  <span className="text-[9px] px-1.5 py-0.2 bg-indigo-100 text-indigo-800 rounded font-bold">Fatura</span>
                </div>
                <span className="text-sm sm:text-base font-mono font-black text-slate-900 tracking-tight">
                  {formatRuble(rFinalPrice)}
                </span>
                <span className="text-[10px] text-slate-500 font-sans mt-0.5 truncate" title={discount.vendorName}>
                  {discount.vendorName}
                </span>
              </div>

              {/* 3. Net İndirim */}
              <div className="bg-emerald-50 px-3 py-2 rounded-xl border-2 border-emerald-400 flex flex-col justify-between shadow-sm ring-1 ring-emerald-400/30">
                <div className="flex items-center justify-between text-[10px] text-emerald-900 font-bold uppercase border-b border-emerald-200 pb-1 mb-1">
                  <span>3. Net Şef İndirimi</span>
                  <span className="text-[9px] px-2 py-0.2 bg-emerald-600 text-white rounded-full font-extrabold">
                    %{finalPct}
                  </span>
                </div>
                <span className="text-base sm:text-lg font-mono font-black text-emerald-700 tracking-tight">
                  +{formatRuble(finalDisc)}
                </span>
                <span className="text-[10px] text-emerald-800 font-sans font-bold mt-0.5">
                  Tasarruf Sağlandı
                </span>
              </div>

              {/* 4. Yetkili Şef & Kategori */}
              <div className="bg-white px-3 py-2 rounded-xl border-2 border-slate-300 flex flex-col justify-between text-left shadow-xs">
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                  <span>Sorumlu Şef</span>
                  <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                </div>
                <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {discount.supervisorName}
                </div>
                <div className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 mt-1 truncate">
                  {discount.category}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2.5 Interactive Visual Negotiation & Offer Stages Pipeline */}
        <div className="shrink-0 bg-slate-50 border-b border-slate-300 px-4 sm:px-6 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                <Target className="w-3.5 h-3.5 text-indigo-600" />
                <span>Pazarlık & Teklif Aşamaları Akışı ({detailStages.filter(s => s.stageType !== 'comparison').length} Aşama)</span>
              </span>
              {detailStages.some(s => s.stageType === 'round') ? (
                <span className="text-[10px] font-black bg-emerald-100 text-emerald-950 border border-emerald-400 px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <span>🎯</span>
                  <span>{detailStages.filter(s => s.stageType === 'round').length} Ara Pazarlık Turu Eklendi</span>
                </span>
              ) : (
                <span className="text-[10px] font-medium bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  ⚡ Doğrudan Anlaşma (Ara Tur Yok)
                </span>
              )}
            </div>
            <div className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-0.5 rounded-lg flex items-center space-x-1 shadow-2xs">
              <span>Toplam Net Tasarruf:</span>
              <span className="font-mono font-black text-emerald-700">+{formatRuble(finalDisc)} (%{finalPct})</span>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1">
            {detailStages.filter(s => s.stageType !== 'comparison').map((stg, idx, arr) => {
              const isFirst = stg.stageType === 'first';
              const isRound = stg.stageType === 'round';
              const isFinal = stg.stageType === 'final';
              return (
                <React.Fragment key={stg.stageNumber}>
                  <div
                    onClick={() => setDetailModalTab('documents')}
                    className={`p-2 sm:p-2.5 rounded-xl border shrink-0 transition-all cursor-pointer shadow-2xs hover:shadow-sm ${
                      isFirst
                        ? 'bg-amber-50/90 border-amber-300 hover:border-amber-400'
                        : isRound
                        ? 'bg-indigo-50/90 border-indigo-300 hover:border-indigo-400'
                        : 'bg-emerald-50/90 border-emerald-400 hover:border-emerald-500'
                    }`}
                    title="Aşama belgelerini görüntülemek için tıklayın"
                  >
                    <div className="flex items-center space-x-1.5 mb-1">
                      <span className={`text-[9px] font-black px-1.5 py-0.2 rounded border ${stg.roleColor}`}>
                        {stg.roleBadge}
                      </span>
                      {stg.date && (
                        <span className="text-[9px] font-mono text-slate-500">{stg.date}</span>
                      )}
                    </div>
                    <div className="font-mono font-black text-xs sm:text-sm text-slate-900">
                      {formatRuble(stg.amount)}
                    </div>
                    {stg.docName && (
                      <div className="flex items-center space-x-1 text-[10px] text-slate-600 mt-1 max-w-[150px] truncate" title={stg.docName}>
                        <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{stg.docName}</span>
                      </div>
                    )}
                  </div>

                  {idx < arr.length - 1 && (
                    <div className="flex flex-col items-center shrink-0 px-0.5">
                      <span className="text-slate-400 font-bold text-xs">➔</span>
                      {arr[idx + 1].discountThisStage && arr[idx + 1].discountThisStage! > 0 ? (
                        <span className="text-[9px] font-extrabold text-emerald-800 bg-emerald-100 border border-emerald-300 px-1 rounded-sm mt-0.5 whitespace-nowrap">
                          -{formatRuble(arr[idx + 1].discountThisStage)}
                        </span>
                      ) : null}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* 3. Segregated Navigation Tabs Bar */}
        <div className="shrink-0 bg-slate-200/90 px-4 sm:px-6 py-2 border-b border-slate-300 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => setDetailModalTab('items')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                detailModalTab === 'items'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Fatura Kalemleri ({allItems.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setDetailModalTab('documents')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                detailModalTab === 'documents'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Teklif & Fatura Aşamaları ({detailStages.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setDetailModalTab('rounds')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer shadow-2xs ${
                detailModalTab === 'rounds'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-400/40'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300'
              }`}
            >
              <Target className="w-3.5 h-3.5" />
              <span>Pazarlık Turları ({rounds.length})</span>
            </button>
          </div>

          {detailToast && (
            <div className="px-2.5 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-lg text-xs font-semibold animate-pulse shrink-0">
              {detailToast}
            </div>
          )}
        </div>

        {/* Tab 1: Fatura Kalemleri Table */}
        {detailModalTab === 'items' && (
          <div className="flex-1 min-h-0 flex flex-col p-3 sm:p-5 bg-slate-100/70">
            {/* Search & Count Bar */}
            <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-700">Kalem Listesi:</span>
                <span className="font-mono text-xs font-extrabold text-indigo-900 bg-indigo-100 px-2.5 py-0.5 rounded-md border border-indigo-300">
                  {filteredItems.length} Kalem
                </span>
                {detailItemSearch && (
                  <span className="text-[11px] text-slate-500 font-medium">
                    (Toplam {allItems.length} arasından filtrelendi)
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={detailItemSearch}
                    onChange={(e) => {
                      setDetailItemSearch(e.target.value);
                      setDetailItemsPage(1);
                    }}
                    placeholder="Malzeme adı veya kategoride ara..."
                    className="w-full bg-white border border-slate-300 focus:border-indigo-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                  />
                </div>

                <div className="flex items-center space-x-1 shrink-0 text-xs text-slate-600 font-medium">
                  <span className="hidden sm:inline">Sayfa:</span>
                  <select
                    value={detailItemsPageSize}
                    onChange={(e) => {
                      setDetailItemsPageSize(Number(e.target.value));
                      setDetailItemsPage(1);
                    }}
                    className="bg-white border border-slate-300 text-slate-800 font-bold rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={1000}>Tümü</option>
                  </select>
                </div>
              </div>
            </div>

            {/* High-Contrast Table Container with Distinct Column Borders */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto rounded-xl border-2 border-slate-300 bg-white shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-800 border-b-2 border-slate-700 text-slate-200 font-bold shadow-xs">
                  <tr>
                    <th className="py-2.5 px-2 w-9 text-center text-slate-400 border-r border-slate-700">#</th>
                    <th className="py-2.5 px-3 text-left border-r border-slate-700">Malzeme Tanımı & Teknik Özellik</th>
                    <th className="py-2.5 px-2 w-28 text-center border-r border-slate-700">Kategori</th>
                    <th className="py-2.5 px-2 w-24 text-right border-r border-slate-700">Miktar & Birim</th>
                    <th className="py-2.5 px-2 w-28 text-right border-r border-slate-700">
                      <div className="flex flex-col items-end">
                        <span className="text-slate-100">İlk Teklif Birim</span>
                        <span className="text-[10px] text-amber-300 font-normal">Bu kaydın belgeleri</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-2 w-28 text-right border-r border-slate-700">
                      <div className="flex flex-col items-end">
                        <span className="text-indigo-200">Anlaşılan Birim</span>
                        <span className="text-[10px] text-indigo-300 font-normal">Son Satınalma</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-2 w-32 text-right border-r border-slate-700">
                      <div className="flex flex-col items-end">
                        <span className="text-emerald-300">Gerçek Tasarruf</span>
                        <span className="text-[10px] text-emerald-200 font-normal">Birim / Toplam</span>
                      </div>
                    </th>
                    <th className="py-2.5 px-3 w-28 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-slate-100">Toplam Tutar</span>
                        <span className="text-[10px] text-slate-400 font-normal">Nihai Fatura</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="text-slate-800 font-mono text-xs">
                  {paginatedItems.length > 0 ? (
                    paginatedItems.map((item, idx) => {
                      const globalIdx = (safeCurrentPage - 1) * detailItemsPageSize + idx + 1;
                      const compInfo = getComparativeInfoForItem(item);
                      return (
                        <tr
                          key={`${item.id || 'disc_item'}_${globalIdx}`}
                          className="even:bg-slate-50/80 odd:bg-white hover:bg-indigo-50/60 transition-colors"
                        >
                          <td className="py-2 px-2 text-slate-500 font-bold text-center bg-slate-100/60 border-r border-b border-slate-300">
                            {globalIdx}
                          </td>
                          <td className="py-2 px-3 font-sans font-bold text-slate-900 border-r border-b border-slate-300">
                            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                              <span className="text-slate-900">{item.materialName}</span>
                              {item.diameter && (
                                <span className="bg-indigo-100 text-indigo-900 border border-indigo-300 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold">
                                  {item.diameter}
                                </span>
                              )}
                              {item.quality && (
                                <span className="bg-slate-200 text-slate-800 border border-slate-300 px-1.5 py-0.2 rounded text-[10px] font-mono font-bold">
                                  {item.quality}
                                </span>
                              )}
                            </div>
                            {item.originalName && item.originalName !== item.materialName && (
                              <div className="text-[10px] text-slate-500 font-mono italic mt-0.5 line-clamp-2" title={item.originalName}>
                                {item.originalName}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2 font-sans text-emerald-900 text-[11px] text-center border-r border-b border-slate-300">
                            <span className="px-2 py-0.5 bg-emerald-100/80 border border-emerald-300 rounded text-[10px] font-bold whitespace-nowrap inline-block">
                              {item.category || discount.category}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-slate-950 font-bold whitespace-nowrap font-mono border-r border-b border-slate-300">
                            {Number(item.quantity || 1).toLocaleString('tr-TR')} {item.unit || 'Adet'}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap bg-amber-50/20 border-r border-b border-slate-300">
                            {compInfo.hasReference ? (
                              <>
                                <div className="font-mono font-bold text-slate-800">
                                  {formatRuble(compInfo.refPrice)}
                                </div>
                                <div className="text-[10px] text-slate-500 truncate max-w-[130px] ml-auto font-sans font-medium" title={compInfo.refSupplier}>
                                  {compInfo.refSupplier}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="font-mono font-bold text-slate-400">—</div>
                                <div className="text-[10px] text-slate-500 max-w-[130px] ml-auto font-sans font-medium whitespace-normal">
                                  {compInfo.note || 'Referans yok'}
                                </div>
                              </>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap bg-indigo-50/30 border-r border-b border-slate-300">
                            <div className="font-mono font-black text-indigo-900">
                              {formatRuble(compInfo.finalPrice)}
                            </div>
                            <div className="text-[10px] text-indigo-700 truncate max-w-[130px] ml-auto font-sans font-semibold" title={compInfo.finalSupplier}>
                              {compInfo.finalSupplier}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right whitespace-nowrap bg-emerald-50/40 border-r border-b border-slate-300">
                            {!compInfo.hasReference ? (
                              <div className="text-slate-400 font-mono text-xs">—</div>
                            ) : compInfo.refPrice > compInfo.finalPrice ? (
                              <>
                                <div className="font-mono font-black text-emerald-800">
                                  +{formatRuble(compInfo.totalSavings)}
                                </div>
                                <div className="text-[10px] text-emerald-800 font-sans font-extrabold flex items-center justify-end space-x-1 mt-0.5">
                                  <span className="bg-emerald-200/80 px-1 rounded border border-emerald-300">%{compInfo.savingsRate}</span>
                                  <span className="text-slate-600 font-normal">({formatRuble(compInfo.unitSavings)}/br)</span>
                                </div>
                              </>
                            ) : compInfo.refPrice < compInfo.finalPrice ? (
                              <>
                                <div className="font-mono font-bold text-rose-700">
                                  -{formatRuble(Math.abs(compInfo.totalSavings))}
                                </div>
                                <div className="text-[10px] text-rose-700 font-sans font-semibold">
                                  -%{Math.abs(compInfo.savingsRate)}
                                </div>
                              </>
                            ) : (
                              <div className="text-slate-400 font-mono text-xs">0 ₽ (%0)</div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right whitespace-nowrap font-mono font-black text-slate-900 border-b border-slate-300">
                            {formatRuble(Number(item.totalPrice) || (Number(item.quantity || 1) * Number(item.unitPrice || 0)))}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 font-sans text-xs">
                        Aramanıza uygun kalem bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="shrink-0 pt-3 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Toplam <strong>{totalItems}</strong> kayıttan <strong>{(safeCurrentPage - 1) * detailItemsPageSize + 1}</strong> - <strong>{Math.min(safeCurrentPage * detailItemsPageSize, totalItems)}</strong> arası gösteriliyor
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setDetailItemsPage(p => Math.max(1, p - 1))}
                    disabled={safeCurrentPage === 1}
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
                  >
                    Önceki
                  </button>
                  <span className="px-2 font-mono font-bold text-slate-800">
                    {safeCurrentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setDetailItemsPage(p => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 cursor-pointer shadow-2xs"
                  >
                    Sonraki
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Aşamalı Belgeler Tab */}
        {detailModalTab === 'documents' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-slate-100/70 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {detailStages.map((stg, sIdx) => {
                const hasDoc = Boolean(stg.docUrl || stg.docName);
                return (
                  <div
                    key={sIdx}
                    className="bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm hover:border-indigo-400 transition-all"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${stg.roleColor}`}>
                          {stg.roleBadge}
                        </span>
                        {stg.date && (
                          <span className="text-[10px] font-mono text-slate-500 flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            <span>{stg.date}</span>
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-black text-slate-900 mb-1">
                        {stg.title}
                      </h4>
                      <p className="text-xs text-slate-600 mb-3">
                        {stg.desc}
                      </p>

                      {/* Tutar & İndirim Özeti Kutusu */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-3 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-bold uppercase text-[10px]">Aşama Teklif / Fatura Tutarı:</span>
                          <span className="font-mono font-black text-sm text-slate-900">{formatRuble(stg.amount)}</span>
                        </div>
                        {stg.discountThisStage && stg.discountThisStage > 0 ? (
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                            <span className="text-emerald-800 font-bold text-[10px]">Bu Aşamada Alınan İndirim:</span>
                            <span className="font-mono font-extrabold text-xs text-emerald-700">
                              -{formatRuble(stg.discountThisStage)} (%{stg.discountPctThisStage})
                            </span>
                          </div>
                        ) : null}
                        {stg.cumulativeDiscount && stg.cumulativeDiscount > 0 ? (
                          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                            <span className="text-indigo-900 font-bold text-[10px]">İlk Teklife Göre Net İndirim:</span>
                            <span className="font-mono font-black text-xs text-indigo-700">
                              +{formatRuble(stg.cumulativeDiscount)} (%{stg.cumulativeDiscountPct})
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {/* Varsa Pazarlık Notu / Yetkili */}
                      {stg.notes && (
                        <div className="p-2.5 bg-indigo-50/60 rounded-xl border border-indigo-100 mb-3 text-xs text-indigo-950 flex items-start space-x-2">
                          <span className="text-indigo-600 font-bold text-xs mt-0.5">💬</span>
                          <div>
                            <span className="font-bold text-[10px] text-indigo-900 uppercase block">Görüşme Notu / Detay:</span>
                            <span className="font-medium text-slate-800">{stg.notes}</span>
                          </div>
                        </div>
                      )}

                      {hasDoc ? (
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-3 flex items-center space-x-3">
                          <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200 shrink-0">
                            <FileCheck2 className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-800 truncate" title={stg.docName}>
                              {stg.docName || 'Ekli Belge'}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center space-x-2">
                              <span>Sistem Arşivi Onaylı</span>
                              {stg.docSize && <span>• {stg.docSize}</span>}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-50 p-3 rounded-xl border border-dashed border-slate-300 mb-3 text-center text-xs text-slate-500">
                          Bu aşamaya ait dijital dosya doğrudan yüklenmemiş (Manuel giriş).
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-2 border-t border-slate-100">
                      {hasDoc && (
                        <button
                          type="button"
                          onClick={() => handleOpenDriveDoc(stg.docUrl, stg.docName)}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 px-3 rounded-xl flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Belgeyi Aç</span>
                        </button>
                      )}
                      {stg.docUrl && (
                        <a
                          href={getSafeFileUrl(stg.docUrl)}
                          download={stg.docName || 'belge.pdf'}
                          className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl border border-slate-200 transition-colors"
                          title="Dosyayı İndir"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Pazarlık Süreci & Notlar */}
        {detailModalTab === 'rounds' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-slate-100/70 space-y-4">
            {/* Rounds List */}
            <div className="bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 shadow-sm">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-3 flex items-center space-x-2">
                <Target className="w-4 h-4 text-indigo-600" />
                <span>Pazarlık Turları & Adım Adım Fiyat Değişimi ({rounds.length})</span>
              </h4>

              {rounds.length > 0 ? (
                <div className="space-y-3">
                  {rounds.map((rnd, rIdx) => (
                    <div
                      key={rIdx}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                          {rnd.roundNumber || rIdx + 1}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900">
                            {rnd.offeredBy || 'Taraf'}: {rnd.notes || `${rIdx + 1}. Pazarlık Turu`}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                            {rnd.date || discount.orderDate || 'Tarih belirtilmedi'}
                          </div>
                          {(rnd.documentName || rnd.documentUrl) && (
                            <div className="flex items-center space-x-1.5 mt-1">
                              <FileText className="w-3 h-3 text-indigo-600 shrink-0" />
                              {rnd.documentUrl ? (
                                <a
                                  href={rnd.documentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline truncate max-w-[200px]"
                                  title="Ara Tur Belgesini İncele"
                                >
                                  {rnd.documentName || 'Tur Belgesi'}
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-600 font-medium truncate max-w-[200px]">
                                  {rnd.documentName}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-3 font-mono">
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500">Teklif Edilen</div>
                          <div className="text-xs font-bold text-slate-800">
                            {formatRuble(rnd.quotedPrice || rnd.price || rnd.offeredPrice || 0)}
                          </div>
                        </div>
                        {(rnd.discountAchieved || rnd.discountThisRound) && (
                          <div className="text-right pl-3 border-l border-slate-200">
                            <div className="text-[10px] text-emerald-700 font-bold">Kazanım</div>
                            <div className="text-xs font-black text-emerald-700">
                              +{formatRuble(rnd.discountAchieved || rnd.discountThisRound)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-center text-xs text-slate-500">
                  Bu kayıt için ayrıntılı tur verisi girilmemiş; ilk teklif ve nihai fatura mutabakatı üzerinden tek aşamada kaydedilmiştir.
                </div>
              )}
            </div>

            {/* Notes & Description Box */}
            <div className="bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 shadow-sm">
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider mb-2 flex items-center space-x-2">
                <Info className="w-4 h-4 text-slate-500" />
                <span>Pazarlık Açıklaması & Şef Notu</span>
              </h4>
              <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed font-sans">
                {discount.description || discount.notes || 'Bu kayıt için özel bir açıklama metni girilmemiştir.'}
              </p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="shrink-0 bg-white px-4 sm:px-6 py-3 border-t border-slate-300 flex items-center justify-between gap-3 shadow-md">
          <div className="flex items-center space-x-2">
            {onDeleteDiscount && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer shadow-2xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Kaydı Sil</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {onEditDiscount && (
              <button
                type="button"
                onClick={() => {
                  onEditDiscount(discount);
                  onClose();
                }}
                className="px-4 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1.5 cursor-pointer shadow-2xs"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Düzenle</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
            >
              Tamam / Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
