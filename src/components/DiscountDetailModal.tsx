import React, { useState, useEffect } from 'react';
import { DiscountRecord, InvoiceItem, InitialOfferDetail, StageDocument } from '../types';
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
  DollarSign,
  Plus,
  UploadCloud,
  Loader2,
  Trophy,
  Scale
} from 'lucide-react';

interface DiscountDetailModalProps {
  discount: DiscountRecord;
  onClose: () => void;
  onEditDiscount?: (discount: DiscountRecord) => void;
  onDeleteDiscount?: (id: string) => Promise<void> | void;
  onUpdateDiscount?: (id: string, record: Partial<DiscountRecord>) => Promise<void> | void;
  comparativeAnalysisData?: any;
}

export const DiscountDetailModal: React.FC<DiscountDetailModalProps> = ({
  discount,
  onClose,
  onEditDiscount,
  onDeleteDiscount,
  onUpdateDiscount,
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

  // State for adding a competing initial offer to an existing record
  const [showAddCompetitorForm, setShowAddCompetitorForm] = useState<boolean>(false);
  const [isUploadingCompetitorDoc, setIsUploadingCompetitorDoc] = useState<boolean>(false);
  const [isSavingCompetitor, setIsSavingCompetitor] = useState<boolean>(false);
  const [competitorSupplier, setCompetitorSupplier] = useState<string>('');
  const [competitorAmount, setCompetitorAmount] = useState<string>('');
  const [competitorDocNo, setCompetitorDocNo] = useState<string>('');
  const [competitorDate, setCompetitorDate] = useState<string>(discount.firstOfferDate || discount.orderDate || '');
  const [competitorFileName, setCompetitorFileName] = useState<string>('');
  const [competitorFileUrl, setCompetitorFileUrl] = useState<string>('');
  const [competitorIsVatIncluded, setCompetitorIsVatIncluded] = useState<boolean>(true);
  const [competitorNotes, setCompetitorNotes] = useState<string>('');

  useEffect(() => {
    setCurrentRecord(discount);
  }, [discount]);

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

  // Competing Initial Offers Calculation (from initialOffersComparison, comparativeAnalysisData, or stageDocuments)
  const initialOffers: InitialOfferDetail[] = (() => {
    const rawList: InitialOfferDetail[] = [];

    // 1. Check currentRecord.initialOffersComparison
    if (Array.isArray(currentRecord.initialOffersComparison) && currentRecord.initialOffersComparison.length > 0) {
      currentRecord.initialOffersComparison.forEach((o: any) => {
        if (o && Number(o.amount) > 0) {
          rawList.push({
            supplier: o.supplier || currentRecord.vendorName || 'Belirtilmeyen Tedarikçi',
            amount: Number(o.amount) || 0,
            date: o.date || currentRecord.firstOfferDate || currentRecord.orderDate || '',
            documentNumber: o.documentNumber || '',
            fileName: o.fileName || '',
            fileUrl: o.fileUrl || '',
            driveFileId: o.driveFileId || '',
            isLowest: Boolean(o.isLowest),
            isVatIncluded: o.isVatIncluded !== undefined ? Boolean(o.isVatIncluded) : true,
            itemsCount: o.itemsCount,
            notes: o.notes || ''
          });
        }
      });
    }

    // 2. Check comparativeAnalysisData if rawList has <= 1 items
    if (rawList.length <= 1 && comparativeAnalysisData) {
      const compOffers = Array.isArray(comparativeAnalysisData.initialOffersComparison)
        ? comparativeAnalysisData.initialOffersComparison
        : Array.isArray(comparativeAnalysisData.summary?.initialOffersList)
          ? comparativeAnalysisData.summary.initialOffersList
          : [];
      compOffers.forEach((o: any) => {
        const amt = Number(o.amount) || 0;
        if (amt <= 0) return;
        const exists = rawList.some(r =>
          (o.fileUrl && r.fileUrl === o.fileUrl) ||
          (Math.abs(r.amount - amt) < 1 && (r.supplier || '').toLowerCase() === (o.supplier || '').toLowerCase())
        );
        if (!exists) {
          rawList.push({
            supplier: o.supplier || 'Rakip Tedarikçi',
            amount: amt,
            date: o.date || currentRecord.firstOfferDate || currentRecord.orderDate || '',
            documentNumber: o.documentNumber || '',
            fileName: o.fileName || '',
            fileUrl: o.fileUrl || '',
            isLowest: Boolean(o.isLowest),
            isVatIncluded: o.isVatIncluded !== undefined ? Boolean(o.isVatIncluded) : true,
            notes: o.notes || ''
          });
        }
      });
    }

    // 3. Also inspect stageDocuments with stageNumber === 1
    const stage1Docs = (Array.isArray(currentRecord.stageDocuments) ? currentRecord.stageDocuments : []).filter(
      (s: any) => s && (s.stageNumber === 1 || String(s.title || '').includes('1. İlk') || String(s.title || '').includes('Alternatif İlk'))
    );
    stage1Docs.forEach((s: any) => {
      const amt = Number(s.amount) || 0;
      if (amt <= 0) return;
      const exists = rawList.some(r =>
        (s.fileUrl && r.fileUrl === s.fileUrl) ||
        (s.fileName && r.fileName === s.fileName && Math.abs(r.amount - amt) < 1) ||
        (Math.abs(r.amount - amt) < 1 && (!s.supplier || r.supplier === s.supplier))
      );
      if (!exists) {
        const isBaseOffer = Math.abs(amt - (Number(currentRecord.offerPrice) || 0)) < 1;
        rawList.push({
          supplier: s.supplier || (isBaseOffer ? currentRecord.vendorName : 'Alternatif Rakip Tedarikçi'),
          amount: amt,
          date: s.date || currentRecord.firstOfferDate || currentRecord.orderDate || '',
          documentNumber: s.documentNumber || '',
          fileName: s.fileName || '',
          fileUrl: s.fileUrl || '',
          driveFileId: s.driveFileId || '',
          isLowest: Boolean(s.isLowestInitial || isBaseOffer),
          isVatIncluded: s.isVatIncluded !== undefined ? Boolean(s.isVatIncluded) : true,
          notes: s.title || ''
        });
      }
    });

    // 4. Fallback to baseline first offer if empty
    if (rawList.length === 0 && Number(currentRecord.offerPrice) > 0) {
      rawList.push({
        supplier: currentRecord.vendorName || 'Ana Tedarikçi',
        amount: Number(currentRecord.offerPrice) || 0,
        date: currentRecord.firstOfferDate || currentRecord.orderDate || '',
        documentNumber: '',
        fileName: currentRecord.firstOfferFileName || currentRecord.rawFileName || '',
        fileUrl: currentRecord.firstOfferFileUrl || currentRecord.fileUrl || '',
        isLowest: true,
        isVatIncluded: true
      });
    }

    // Sort ascending by amount and compute priceDiffFromLowest & priceDiffPercentage
    rawList.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
    const minAmt = rawList.length > 0 ? Number(rawList[0].amount) || 0 : 0;
    return rawList.map((item, idx) => {
      const amt = Number(item.amount) || 0;
      const diff = minAmt > 0 ? Math.max(0, Number((amt - minAmt).toFixed(2))) : 0;
      const diffPct = minAmt > 0 ? Number(((diff / minAmt) * 100).toFixed(2)) : 0;
      return {
        ...item,
        isLowest: idx === 0,
        priceDiffFromLowest: diff,
        priceDiffPercentage: diffPct
      };
    });
  })();

  const lowestInitialOffer = initialOffers[0];
  const highestInitialOffer = initialOffers.length > 1 ? initialOffers[initialOffers.length - 1] : null;
  const secondLowestInitialOffer = initialOffers.length > 1 ? initialOffers[1] : null;

  const initialSelectionRationale = (() => {
    if (initialOffers.length <= 1 || !lowestInitialOffer) return null;
    const offersSummaryText = initialOffers
      .map((o, idx) => `${idx + 1}) ${o.supplier}: ${formatRuble(o.amount)}${o.documentNumber ? ` (Belge No: ${o.documentNumber})` : ''}`)
      .join(' • ');
    const diffVsSecond = secondLowestInitialOffer
      ? Math.max(0, (Number(secondLowestInitialOffer.amount) || 0) - (Number(lowestInitialOffer.amount) || 0))
      : 0;
    const diffPctVsSecond = secondLowestInitialOffer?.priceDiffPercentage || 0;

    return {
      offersSummaryText,
      diffVsSecond,
      diffPctVsSecond,
      explanation: `İlk aşamada toplam ${initialOffers.length} farklı tedarikçiden resmi teklif alınmıştır (${offersSummaryText}). Gelen ilk teklifler kıyaslandığında en uygun (en düşük) başlangıç fiyatını ${formatRuble(lowestInitialOffer.amount)} ile "${lowestInitialOffer.supplier}" firması verdiği için (en yakın rakip "${secondLowestInitialOffer?.supplier}" teklifinden ${formatRuble(diffVsSecond)} / %${diffPctVsSecond} daha avantajlı), pazarlık sürecinde baz (referans) ilk teklif olarak bu firma seçilmiş; ara pazarlık ve nihai fatura indirimi (+${formatRuble(finalDisc)} / %${finalPct}) bu en uygun ilk teklif üzerinden kazanılmıştır.`
    };
  })();

  // Upload & AI OCR handler for adding a competing initial offer
  const handleCompetitorFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingCompetitorDoc(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
      });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        setCompetitorFileName(uploadData.fileName || file.name);
        setCompetitorFileUrl(uploadData.fileUrl || '');
      } else {
        setCompetitorFileName(file.name);
      }

      // Extract supplier, amount, documentNumber, date via AI OCR
      const ocrForm = new FormData();
      ocrForm.append('file', file);
      const ocrRes = await fetch('/api/extract-discount-doc', {
        method: 'POST',
        body: ocrForm
      });
      if (ocrRes.ok) {
        const ocrData = await ocrRes.json();
        if (ocrData.vendorName || ocrData.supplier) {
          setCompetitorSupplier(ocrData.vendorName || ocrData.supplier);
        }
        if (Number(ocrData.totalAmount || ocrData.amount) > 0) {
          setCompetitorAmount(String(ocrData.totalAmount || ocrData.amount));
        }
        if (ocrData.invoiceNo || ocrData.documentNumber) {
          setCompetitorDocNo(ocrData.invoiceNo || ocrData.documentNumber);
        }
        if (ocrData.date || ocrData.orderDate) {
          setCompetitorDate(ocrData.date || ocrData.orderDate);
        }
        setDetailToast('Belge AI ile okundu, firma ve tutar alanları dolduruldu.');
        setTimeout(() => setDetailToast(null), 4000);
      }
    } catch (err) {
      console.error('Error uploading competitor initial offer:', err);
    } finally {
      setIsUploadingCompetitorDoc(false);
    }
  };

  const handleSaveCompetitorOffer = async () => {
    const parsedAmt = Number(String(competitorAmount).replace(/\s/g, '').replace(',', '.'));
    if (!competitorSupplier.trim() || !(parsedAmt > 0)) {
      setDetailToast('Lütfen rakip firma adını ve geçerli ilk teklif tutarını giriniz.');
      setTimeout(() => setDetailToast(null), 3500);
      return;
    }

    setIsSavingCompetitor(true);
    try {
      const newOffer: InitialOfferDetail = {
        supplier: competitorSupplier.trim(),
        amount: parsedAmt,
        date: competitorDate || currentRecord.firstOfferDate || currentRecord.orderDate || '',
        documentNumber: competitorDocNo.trim(),
        fileName: competitorFileName || `Rakip_Ilk_Teklif_${competitorSupplier.trim()}.pdf`,
        fileUrl: competitorFileUrl || '',
        isLowest: false,
        isVatIncluded: competitorIsVatIncluded,
        notes: competitorNotes.trim() || 'Sonradan eklenen rakip ilk teklif'
      };

      const combinedOffers = [...initialOffers, newOffer].sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
      const minAmt = Number(combinedOffers[0]?.amount) || Number(currentRecord.offerPrice) || 0;
      const normalizedOffers: InitialOfferDetail[] = combinedOffers.map((item, idx) => {
        const amt = Number(item.amount) || 0;
        const diff = minAmt > 0 ? Math.max(0, Number((amt - minAmt).toFixed(2))) : 0;
        const diffPct = minAmt > 0 ? Number(((diff / minAmt) * 100).toFixed(2)) : 0;
        return {
          ...item,
          isLowest: idx === 0,
          priceDiffFromLowest: diff,
          priceDiffPercentage: diffPct
        };
      });

      const existingOtherStageDocs = (Array.isArray(currentRecord.stageDocuments) ? currentRecord.stageDocuments : []).filter(
        (s: any) => s && s.stageNumber !== 1
      );
      const updatedStage1Docs: StageDocument[] = normalizedOffers.map((o, idx) => ({
        stageNumber: 1,
        title: normalizedOffers.length > 1
          ? (idx === 0
              ? `1. İlk Gelen Teklif (En Düşük Baz — ${o.supplier})`
              : `1. İlk Gelen Teklif (Alternatif ${idx} — ${o.supplier})`)
          : '1. İlk Gelen Teklif',
        fileName: o.fileName || `Ilk_Teklif_${idx + 1}.pdf`,
        fileUrl: o.fileUrl || '',
        driveFileId: o.driveFileId || '',
        amount: o.amount,
        supplier: o.supplier,
        documentNumber: o.documentNumber || '',
        date: o.date || currentRecord.firstOfferDate || currentRecord.orderDate || '',
        isLowestInitial: idx === 0,
        isVatIncluded: o.isVatIncluded !== undefined ? o.isVatIncluded : true,
        isFinal: false
      }));

      const updatedStageDocuments = [...updatedStage1Docs, ...existingOtherStageDocs];
      const payload: Partial<DiscountRecord> = {
        initialOffersComparison: normalizedOffers,
        stageDocuments: updatedStageDocuments,
        calculationMethod: 'MARKET_BASELINE_TO_FINAL',
        marketReferencePrice: minAmt
      };

      if (onUpdateDiscount) {
        await onUpdateDiscount(currentRecord.id, payload);
      } else {
        await fetch(`/api/discounts/${currentRecord.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...currentRecord, ...payload })
        });
      }

      setCurrentRecord(prev => ({
        ...prev,
        ...payload
      }));

      // Reset form
      setCompetitorSupplier('');
      setCompetitorAmount('');
      setCompetitorDocNo('');
      setCompetitorFileName('');
      setCompetitorFileUrl('');
      setCompetitorNotes('');
      setShowAddCompetitorForm(false);
      setDetailToast('Rakip ilk teklif başarıyla eklendi ve karşılaştırma tablosu güncellendi.');
      setTimeout(() => setDetailToast(null), 4000);
    } catch (err) {
      console.error('Error saving competitor offer:', err);
      setDetailToast('Rakip teklif kaydedilirken bir hata oluştu.');
      setTimeout(() => setDetailToast(null), 4000);
    } finally {
      setIsSavingCompetitor(false);
    }
  };

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

    const baseOffer = Number(currentRecord.adjustedOfferPrice || currentRecord.offerPrice || 0);
    const agreed = Number(currentRecord.agreedPrice || 0);

    // 1. First Stage: Initial Offer (Bargaining Baseline)
    stages.push({
      stageNumber: 1,
      stageType: 'first',
      title: initialOffers.length > 1
        ? `1. Aşama: İlk Gelen Teklifler & En Uygun Baz Seçimi (${initialOffers.length} Firma Teklifi)`
        : '1. Aşama: İlk Gelen Teklif / Fatura',
      roleBadge: initialOffers.length > 1 ? `1. İLK TEKLİFLER (${initialOffers.length} FİRMA)` : '1. İLK TEKLİF',
      roleColor: 'bg-amber-100 text-amber-900 border-amber-300',
      desc: initialOffers.length > 1
        ? `İhale başlangıcında ${initialOffers.length} farklı firmadan alınan ilk resmi teklifler ve en uygun baz teklifin (${lowestInitialOffer?.supplier}) seçim tablosu.`
        : 'Tedarikçiden alınan ilk resmi fiyat teklifi veya proforma fatura (indirimsiz baz).',
      stageKey: 'INITIAL_OFFER',
      amount: baseOffer,
      previousAmount: undefined,
      discountThisStage: 0,
      discountPctThisStage: 0,
      cumulativeDiscount: 0,
      cumulativeDiscountPct: 0,
      docUrl: lowestInitialOffer?.fileUrl || currentRecord.firstOfferFileUrl || currentRecord.fileUrl,
      docName: lowestInitialOffer?.fileName || currentRecord.firstOfferFileName || currentRecord.rawFileName || (currentRecord.offerPrice ? `Ilk_Teklif_${currentRecord.invoiceNo || 'Doc'}.pdf` : undefined),
      docSize: currentRecord.firstOfferFileSize || currentRecord.fileSize,
      date: lowestInitialOffer?.date || currentRecord.firstOfferDate || currentRecord.orderDate,
      notes: currentRecord.notes || 'Başlangıç teklifi',
      vendorName: lowestInitialOffer?.supplier || currentRecord.vendorName
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
        className="bg-slate-100 border border-slate-700/80 rounded-2xl max-w-6xl xl:max-w-7xl w-full h-[94vh] sm:h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-800 text-left animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header: Dark Slate & Gold Contrast (Polished Executive Header) */}
        <div className="shrink-0 bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 z-30 shadow-md text-white">
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
                <span>Fatura / Teklif: <strong className="text-amber-300 font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">{discount.invoiceNo || 'N/A'}</strong></span>
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
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center space-x-1 text-indigo-300 font-semibold">
                  <UserCheck className="w-3 h-3 text-indigo-400" />
                  <span>Şef: {discount.supervisorName}</span>
                </span>
                {discount.category && (
                  <>
                    <span className="text-slate-600">•</span>
                    <span className="text-emerald-300 font-semibold">{discount.category}</span>
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

        {/* UNIFIED SCROLLABLE MODAL BODY: Everything scrolls smoothly together */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth">
          {/* Comparative Analysis Matrix (If applicable) */}
          {(currentRecord.calculationMethod === 'MARKET_BASELINE_TO_FINAL' || currentRecord.comparativeAnalysisId || initialOffers.length > 1) ? (
            <div className="bg-slate-800 px-4 sm:px-6 py-3 border-b border-slate-700 text-white">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center space-x-2">
                  <div className="p-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    <Scale className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-black text-indigo-200 uppercase tracking-wider">
                    Karşılaştırmalı Teklif & Piyasa Bazlı Tasarruf Matrisi
                  </span>
                  {initialOffers.length > 1 && (
                    <span className="text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-400/40 px-2.5 py-0.5 rounded-full">
                      {initialOffers.length} Rakip İlk Teklif Kıyaslandı
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailModalTab('documents');
                      setShowAddCompetitorForm(true);
                    }}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/50 transition-colors flex items-center space-x-1 cursor-pointer shadow-2xs"
                    title="Bu kayda yeni veya arşivden rakip ilk teklif ekle"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Rakip İlk Teklif Ekle</span>
                  </button>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
                    currentRecord.kpiEligible === true
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-500/50'
                      : 'bg-slate-700 text-slate-300 border-slate-600'
                  }`}>
                    {currentRecord.kpiEligible === true ? '✓ KPI Hesabına Dahil' : 'Bilgi Amaçlı Kayıt'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {/* 1. Piyasa Referansı (İlk En Uygun Baz) */}
                <div className="bg-slate-900/95 p-3 rounded-xl border border-slate-700 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                    <span>1. İLK EN UYGUN BAZ</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/80 leading-none">
                      Piyasa Referansı
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-mono font-black text-slate-100 tracking-tight tabular-nums">
                    {formatRuble(Number(currentRecord.marketReferencePrice) || Number(currentRecord.offerPrice) || 0)}
                  </div>
                  <span className="text-[10px] text-amber-300/90 font-sans mt-1 truncate" title={lowestInitialOffer?.supplier || currentRecord.vendorName}>
                    🏆 {lowestInitialOffer?.supplier || currentRecord.vendorName} ({initialOffers.length} Teklifin En İyisi)
                  </span>
                </div>

                {/* 2. Nihai Anlaşılan Satınalma */}
                <div className="bg-slate-900/95 p-3 rounded-xl border border-slate-700 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                    <span>2. NİHAİ FATURA</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-700/80 leading-none">
                      Son Anlaşılan
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-mono font-black text-white tracking-tight tabular-nums">
                    {formatRuble(Number(currentRecord.agreedPrice) || 0)}
                  </div>
                  <span className="text-[10px] text-slate-400 font-sans mt-1 truncate" title={currentRecord.vendorName}>
                    {currentRecord.vendorName}
                  </span>
                </div>

                {/* 3. Piyasa Bazlı Gerçek Tasarruf */}
                <div className="bg-emerald-950/70 p-3 rounded-xl border border-emerald-500/50 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-emerald-300 font-bold mb-1">
                    <span>3. NET ŞEF İNDİRİMİ</span>
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-black leading-none">
                      %{currentRecord.realSavingsPercentage || currentRecord.discountPercentage || finalPct}
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-mono font-black text-emerald-300 tracking-tight tabular-nums">
                    +{formatRuble(Number(currentRecord.realMarketSavings) || Number(currentRecord.discountAmount) || finalDisc || 0)}
                  </div>
                  <span className="text-[10px] text-emerald-200 font-sans font-semibold mt-1">
                    Gerçek Tasarruf Sağlandı
                  </span>
                </div>

                {/* 4. Rakip İlk Tekliflere Göre Avantaj & Sorumlu Şef */}
                <div className="bg-cyan-950/60 p-3 rounded-xl border border-cyan-500/40 flex flex-col justify-between shadow-inner">
                  <div className="flex items-center justify-between text-[10px] text-cyan-300 font-bold mb-1">
                    <span>{initialOffers.length > 1 ? '4. RAKİP İLK TEKLİF FARKI' : '4. SORUMLU ŞEF'}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900/80 text-cyan-200 border border-cyan-600 leading-none">
                      {initialOffers.length > 1 ? `${initialOffers.length} Firma Kıyası` : discount.category}
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-mono font-black text-cyan-200 tracking-tight tabular-nums truncate">
                    {initialOffers.length > 1 && secondLowestInitialOffer
                      ? `+${formatRuble(secondLowestInitialOffer.priceDiffFromLowest || 0)}`
                      : discount.supervisorName}
                  </div>
                  <span className="text-[10px] text-cyan-300/90 font-sans mt-1 truncate" title={secondLowestInitialOffer ? `En Yakın Rakip: ${secondLowestInitialOffer.supplier} (+%${secondLowestInitialOffer.priceDiffPercentage})` : `Şef: ${discount.supervisorName}`}>
                    {initialOffers.length > 1 && secondLowestInitialOffer
                      ? `En Yakın Rakip: ${secondLowestInitialOffer.supplier} (+%${secondLowestInitialOffer.priceDiffPercentage})`
                      : `Kategori: ${discount.category}`}
                  </span>
                </div>
              </div>

              {/* Üst Özet Şemasında İlk Gelen Rakip Teklifler & En Uygun Seçim Gerekçesi Şeridi */}
              {initialOffers.length > 1 && initialSelectionRationale && (
                <div className="mt-2.5 bg-slate-900/95 border border-amber-500/40 rounded-xl p-3 shadow-inner">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center space-x-2">
                      <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-[11px] font-black text-amber-300 uppercase tracking-wide">
                        1. Aşama İlk Gelen Teklifler Kıyas Tablosu & En Uygun Firma Seçim Kanıtı ({initialOffers.length} Teklif)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailModalTab('documents')}
                      className="text-[10px] font-bold text-indigo-200 hover:text-white bg-indigo-950 hover:bg-indigo-800 px-3 py-1 rounded-lg border border-indigo-500/50 transition-colors self-start sm:self-auto cursor-pointer shrink-0"
                    >
                      1. Aşama Detaylı Kıyas Tablosunu & Belgeleri Gör →
                    </button>
                  </div>

                  {/* Rakip Teklif Kartları (Yan Yana Simetrik Kıyas) */}
                  <div className={`grid gap-2.5 mb-2.5 ${initialOffers.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
                    {initialOffers.map((offer, oIdx) => {
                      const isWinner = oIdx === 0;
                      return (
                        <div
                          key={oIdx}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                            isWinner
                              ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-100'
                              : 'bg-slate-800/95 border-slate-700 text-slate-200'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center flex-wrap gap-1.5 mb-1">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded leading-none ${
                                isWinner
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'bg-slate-700 text-slate-200'
                              }`}>
                                {isWinner ? '🏆 1. EN UYGUN (BAZ)' : `${oIdx + 1}. RAKİP TEKLİF`}
                              </span>
                              {offer.documentNumber && (
                                <span className="text-[10px] font-mono text-slate-300 bg-slate-900/70 px-1.5 py-0.5 rounded border border-slate-700 leading-none">
                                  No: {offer.documentNumber}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-bold text-white truncate" title={offer.supplier}>
                              {offer.supplier}
                            </div>
                            <div className="flex items-center flex-wrap gap-2 mt-1">
                              <span className={`text-sm font-mono font-black tabular-nums ${isWinner ? 'text-emerald-300' : 'text-amber-300'}`}>
                                {formatRuble(offer.amount)}
                              </span>
                              {!isWinner && (offer.priceDiffFromLowest || 0) > 0 && (
                                <span className="inline-flex items-center text-[10px] font-mono font-bold text-rose-200 bg-rose-950/90 px-2 py-0.5 rounded-md border border-rose-500/50 leading-none tabular-nums">
                                  +{formatRuble(offer.priceDiffFromLowest)} (+%{offer.priceDiffPercentage} daha yüksek)
                                </span>
                              )}
                            </div>
                          </div>

                          {(offer.fileUrl || offer.fileName) && (
                            <button
                              type="button"
                              onClick={() => handleOpenDriveDoc(offer.fileUrl, offer.fileName)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-600 transition-colors shrink-0 cursor-pointer flex items-center space-x-1 text-[10px] font-bold"
                              title={`${offer.supplier} İlk Teklif Belgesini Aç (${offer.fileName || 'Belge'})`}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Belge</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Seçim Gerekçesi Metni */}
                  <div className="text-[11px] text-slate-200 bg-slate-950/90 border border-slate-800 rounded-lg px-3 py-2 leading-relaxed">
                    <strong className="text-amber-300 font-bold">📌 En Uygun İlk Teklif Seçim Gerekçesi: </strong>
                    {initialSelectionRationale.explanation}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Standard 4-Card Metric Summary when Comparative Matrix is not active */
            <div className="bg-slate-100 px-4 sm:px-6 py-3 border-b border-slate-300 shadow-2xs">
              {(discount.scopeDeductionAmount && discount.scopeDeductionAmount > 0) ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                  <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-300 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                      <span>1. İlk Teklif Brüt</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded leading-none">Liste</span>
                    </div>
                    <span className="text-sm sm:text-base font-mono font-bold text-slate-600 tracking-tight tabular-nums">
                      {formatRuble(discount.offerPrice)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-sans mt-0.5">Tedarikçi Girişi</span>
                  </div>

                  <div className="bg-amber-50/80 px-3 py-2.5 rounded-xl border border-amber-300 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-amber-900 font-bold uppercase border-b border-amber-200/60 pb-1 mb-1">
                      <span>2. Kapsam Düşümü</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-200/80 text-amber-900 rounded font-bold leading-none">Revizyon</span>
                    </div>
                    <span className="text-sm sm:text-base font-mono font-black text-amber-800 tracking-tight tabular-nums">
                      -{formatRuble(discount.scopeDeductionAmount)}
                    </span>
                    <span className="text-[10px] text-amber-700 font-sans mt-0.5">Çıkarılan Kalemler</span>
                  </div>

                  <div className="bg-indigo-50/80 px-3 py-2.5 rounded-xl border border-indigo-300 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-indigo-900 font-bold uppercase border-b border-indigo-200/60 pb-1 mb-1">
                      <span>3. Düzeltilmiş Baz</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-indigo-200/80 text-indigo-900 rounded font-bold leading-none">Net Baz</span>
                    </div>
                    <span className="text-sm sm:text-base font-mono font-black text-indigo-950 tracking-tight tabular-nums">
                      {formatRuble(modalBaseline)}
                    </span>
                    <span className="text-[10px] text-indigo-700 font-sans mt-0.5">Gerçek Pazarlık Bazı</span>
                  </div>

                  <div className="bg-emerald-50 px-3 py-2.5 rounded-xl border border-emerald-400 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-emerald-900 font-bold uppercase border-b border-emerald-200 pb-1 mb-1">
                      <span>4. Net Şef İndirimi</span>
                      <span className="text-[9px] px-2 py-0.5 bg-emerald-600 text-white rounded-full font-extrabold leading-none">
                        %{finalPct}
                      </span>
                    </div>
                    <span className="text-base sm:text-lg font-mono font-black text-emerald-700 tracking-tight tabular-nums">
                      +{formatRuble(finalDisc)}
                    </span>
                    <span className="text-[10px] text-emerald-800 font-sans font-bold mt-0.5">
                      Tasarruf Sağlandı
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                  <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-300 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                      <span>1. İlk Teklif</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded leading-none">Liste</span>
                    </div>
                    <span className="text-sm sm:text-base font-mono font-bold text-slate-700 tracking-tight tabular-nums">
                      {formatRuble(discount.offerPrice)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-sans mt-0.5">Tedarikçi İlk Fiyatı</span>
                  </div>

                  <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-300 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-slate-700 font-bold uppercase border-b border-slate-100 pb-1 mb-1">
                      <span>2. Son Anlaşılan</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold leading-none">Fatura</span>
                    </div>
                    <span className="text-sm sm:text-base font-mono font-black text-slate-900 tracking-tight tabular-nums">
                      {formatRuble(rFinalPrice)}
                    </span>
                    <span className="text-[10px] text-slate-500 font-sans mt-0.5 truncate" title={discount.vendorName}>
                      {discount.vendorName}
                    </span>
                  </div>

                  <div className="bg-emerald-50 px-3 py-2.5 rounded-xl border border-emerald-400 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[10px] text-emerald-900 font-bold uppercase border-b border-emerald-200 pb-1 mb-1">
                      <span>3. Net Şef İndirimi</span>
                      <span className="text-[9px] px-2 py-0.5 bg-emerald-600 text-white rounded-full font-extrabold leading-none">
                        %{finalPct}
                      </span>
                    </div>
                    <span className="text-base sm:text-lg font-mono font-black text-emerald-700 tracking-tight tabular-nums">
                      +{formatRuble(finalDisc)}
                    </span>
                    <span className="text-[10px] text-emerald-800 font-sans font-bold mt-0.5">
                      Tasarruf Sağlandı
                    </span>
                  </div>

                  <div className="bg-white px-3 py-2.5 rounded-xl border border-slate-300 flex flex-col justify-between text-left shadow-2xs">
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
          )}

          {/* 2.5 Interactive Visual Negotiation & Offer Stages Pipeline (Symmetrical Equal-Height Cards) */}
          <div className="bg-white border-b border-slate-300 px-4 sm:px-6 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <span className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <Target className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Pazarlık & Teklif Aşamaları Akışı ({detailStages.filter(s => s.stageType !== 'comparison').length} Aşama)</span>
                </span>
                {detailStages.some(s => s.stageType === 'round') ? (
                  <span className="text-[10px] font-black bg-emerald-100 text-emerald-950 border border-emerald-400 px-2.5 py-0.5 rounded-full flex items-center space-x-1">
                    <span>🎯</span>
                    <span>{detailStages.filter(s => s.stageType === 'round').length} Ara Pazarlık Turu Eklendi</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-medium bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full">
                    ⚡ Doğrudan Anlaşma (Ara Tur Yok)
                  </span>
                )}
              </div>
              <div className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1 rounded-lg flex items-center space-x-1.5 shadow-2xs">
                <span>Toplam Net Tasarruf:</span>
                <span className="font-mono font-black text-emerald-700 tabular-nums">+{formatRuble(finalDisc)} (%{finalPct})</span>
              </div>
            </div>

            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {detailStages.filter(s => s.stageType !== 'comparison').map((stg, idx, arr) => {
                const isFirst = stg.stageType === 'first';
                const isRound = stg.stageType === 'round';
                return (
                  <React.Fragment key={stg.stageNumber}>
                    <div
                      onClick={() => setDetailModalTab('documents')}
                      className={`flex-1 min-w-[210px] max-w-[320px] p-3 rounded-xl border flex flex-col justify-between transition-all cursor-pointer shadow-2xs hover:shadow-sm ${
                        isFirst
                          ? 'bg-amber-50/90 border-amber-300 hover:border-amber-400'
                          : isRound
                          ? 'bg-indigo-50/90 border-indigo-300 hover:border-indigo-400'
                          : 'bg-emerald-50/90 border-emerald-400 hover:border-emerald-500'
                      }`}
                      title="Aşama belgelerini görüntülemek için tıklayın"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1.5 mb-1.5">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border leading-none ${stg.roleColor}`}>
                            {stg.roleBadge}
                          </span>
                          {stg.date && (
                            <span className="text-[10px] font-mono text-slate-500">{stg.date}</span>
                          )}
                        </div>
                        <div className="font-mono font-black text-sm sm:text-base text-slate-900 tabular-nums">
                          {formatRuble(stg.amount)}
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-slate-200/70 flex items-center justify-between gap-2">
                        {stg.docName ? (
                          <div className="flex items-center space-x-1 text-[10px] text-slate-600 truncate" title={stg.docName}>
                            <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate font-medium">{stg.docName}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">Belge Özeti</span>
                        )}
                        {isFirst && initialOffers.length > 1 && (
                          <span className="text-[9px] font-bold text-amber-900 bg-amber-200/80 border border-amber-400/80 px-1.5 py-0.5 rounded shrink-0 leading-none">
                            🏆 En Uygun Baz
                          </span>
                        )}
                      </div>
                    </div>

                    {idx < arr.length - 1 && (
                      <div className="flex flex-col items-center justify-center shrink-0 px-1">
                        <span className="text-slate-400 font-bold text-sm">➔</span>
                        {arr[idx + 1].discountThisStage && arr[idx + 1].discountThisStage! > 0 ? (
                          <span className="text-[10px] font-mono font-extrabold text-emerald-800 bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 rounded-md mt-1 whitespace-nowrap leading-none tabular-nums">
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

          {/* 3. Sticky Segregated Navigation Tabs Bar */}
          <div className="sticky top-0 z-20 bg-slate-200/95 backdrop-blur-xs px-4 sm:px-6 py-2.5 border-b border-slate-300 flex items-center justify-between gap-2 overflow-x-auto shadow-2xs">
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
            <div className="p-4 sm:p-6 bg-slate-100/70">
              {/* Search & Count Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3">
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

              {/* High-Contrast Table Container with Full Natural Height */}
              <div className="overflow-x-auto rounded-xl border-2 border-slate-300 bg-white shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-800 border-b-2 border-slate-700 text-slate-200 font-bold shadow-xs">
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
                            <td className="py-2.5 px-2 text-slate-500 font-bold text-center bg-slate-100/60 border-r border-b border-slate-300">
                              {globalIdx}
                            </td>
                            <td className="py-2.5 px-3 font-sans font-bold text-slate-900 border-r border-b border-slate-300">
                              <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                <span className="text-slate-900">{item.materialName}</span>
                                {item.diameter && (
                                  <span className="bg-indigo-100 text-indigo-900 border border-indigo-300 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none">
                                    {item.diameter}
                                  </span>
                                )}
                                {item.quality && (
                                  <span className="bg-slate-200 text-slate-800 border border-slate-300 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none">
                                    {item.quality}
                                  </span>
                                )}
                              </div>
                              {item.originalName && item.originalName !== item.materialName && (
                                <div className="text-[10px] text-slate-500 font-mono italic mt-0.5" title={item.originalName}>
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
          <div className="p-4 sm:p-6 bg-slate-100/70 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {detailStages.map((stg, sIdx) => {
                const hasDoc = Boolean(stg.docUrl || stg.docName);
                const isFirstStage = stg.stageType === 'first';
                return (
                  <div
                    key={sIdx}
                    className={`bg-white border-2 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm transition-all ${
                      isFirstStage && (initialOffers.length > 1 || showAddCompetitorForm)
                        ? 'md:col-span-2 border-amber-400 ring-1 ring-amber-300/50'
                        : 'border-slate-300 hover:border-indigo-400'
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center space-x-2">
                          <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${stg.roleColor}`}>
                            {stg.roleBadge}
                          </span>
                          {isFirstStage && initialOffers.length > 1 && (
                            <span className="text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-400 px-2.5 py-0.5 rounded-full flex items-center space-x-1">
                              <Trophy className="w-3 h-3 text-emerald-700" />
                              <span>{initialOffers.length} Firma Teklifi Kıyaslandı</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          {isFirstStage && (
                            <button
                              type="button"
                              onClick={() => setShowAddCompetitorForm(prev => !prev)}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 transition-colors flex items-center space-x-1 cursor-pointer shadow-2xs"
                            >
                              <Plus className="w-3.5 h-3.5 text-amber-800" />
                              <span>{showAddCompetitorForm ? 'Formu Kapat' : '+ Rakip İlk Teklif Ekle'}</span>
                            </button>
                          )}
                          {stg.date && (
                            <span className="text-[10px] font-mono text-slate-500 flex items-center space-x-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              <span>{stg.date}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <h4 className="text-sm font-black text-slate-900 mb-1">
                        {stg.title}
                      </h4>
                      <p className="text-xs text-slate-600 mb-3">
                        {stg.desc}
                      </p>

                      {/* 1. AŞAMA İÇİN DETAYLI İLK GELEN RAKİP TEKLİFLER KARŞILAŞTIRMA TABLOSU & SEÇİM GEREKÇESİ */}
                      {isFirstStage && (
                        <div className="mb-4 space-y-3">
                          <div className="bg-amber-50/70 border-2 border-amber-300 rounded-xl overflow-hidden shadow-2xs">
                            <div className="bg-amber-100/90 px-3.5 py-2 border-b border-amber-300 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <Scale className="w-4 h-4 text-amber-900" />
                                <span className="text-xs font-black text-amber-950 uppercase tracking-wide">
                                  İlk Gelen Teklifler Kıyas Tablosu ({initialOffers.length} Firma)
                                </span>
                              </div>
                              <span className="text-[10px] font-bold text-amber-900 bg-white/80 px-2 py-0.5 rounded border border-amber-300">
                                En Düşük İlk Teklif Pazarlık Bazı Olarak Seçilmiştir
                              </span>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 text-[10px] font-black uppercase">
                                    <th className="py-2 px-3 border-r border-slate-200">Sıra / Rol</th>
                                    <th className="py-2 px-3 border-r border-slate-200">Teklif Veren Tedarikçi Firma</th>
                                    <th className="py-2 px-3 border-r border-slate-200">Teklif / Fatura No & Tarih</th>
                                    <th className="py-2 px-3 text-right border-r border-slate-200">İlk Teklif Tutarı</th>
                                    <th className="py-2 px-3 text-right border-r border-slate-200">En Uyguna Göre Fark</th>
                                    <th className="py-2 px-3 text-center">Resmi Teklif Belgesi</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {initialOffers.map((offer, oIdx) => {
                                    const isLowest = oIdx === 0;
                                    const hasOfferDoc = Boolean(offer.fileUrl || offer.fileName);
                                    return (
                                      <tr
                                        key={oIdx}
                                        className={isLowest ? 'bg-emerald-50/90 font-semibold' : 'bg-white hover:bg-slate-50'}
                                      >
                                        <td className="py-2.5 px-3 border-r border-slate-200 whitespace-nowrap">
                                          {isLowest ? (
                                            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white shadow-2xs">
                                              <Trophy className="w-3 h-3" />
                                              <span>1. EN UYGUN (BAZ)</span>
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                                              {oIdx + 1}. Rakip İlk Teklif
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 border-r border-slate-200 font-bold text-slate-900">
                                          <div>{offer.supplier}</div>
                                          {isLowest && (
                                            <div className="text-[10px] text-emerald-800 font-semibold mt-0.5">
                                              ✓ En düşük ilk teklif olduğu için pazarlığa bu firma ile devam edildi
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 border-r border-slate-200 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                                          <div>No: <strong>{offer.documentNumber || 'Belirtilmedi'}</strong></div>
                                          {offer.date && <div className="text-[10px] text-slate-500">Tarih: {offer.date}</div>}
                                        </td>
                                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono whitespace-nowrap">
                                          <div className={`text-xs sm:text-sm font-black ${isLowest ? 'text-emerald-800' : 'text-slate-900'}`}>
                                            {formatRuble(offer.amount)}
                                          </div>
                                          <div className="text-[9px] text-slate-500">
                                            {offer.isVatIncluded !== false ? 'KDV Dahil' : 'KDV Hariç'}
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-3 border-r border-slate-200 text-right font-mono whitespace-nowrap">
                                          {isLowest ? (
                                            <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-black">
                                              BAZ REFERANS (0,00 ₽)
                                            </span>
                                          ) : (
                                            <div>
                                              <div className="text-xs font-black text-rose-700">
                                                +{formatRuble(offer.priceDiffFromLowest || 0)}
                                              </div>
                                              <div className="text-[10px] font-bold text-rose-600">
                                                +%{offer.priceDiffPercentage || 0} daha yüksek
                                              </div>
                                            </div>
                                          )}
                                        </td>
                                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                          {hasOfferDoc ? (
                                            <div className="inline-flex items-center space-x-1.5">
                                              <button
                                                type="button"
                                                onClick={() => handleOpenDriveDoc(offer.fileUrl, offer.fileName)}
                                                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold inline-flex items-center space-x-1 transition-colors cursor-pointer shadow-2xs"
                                                title={offer.fileName || 'Teklif Belgesini Aç'}
                                              >
                                                <Eye className="w-3 h-3" />
                                                <span>Belgeyi Aç</span>
                                              </button>
                                              {offer.fileUrl && (
                                                <a
                                                  href={getSafeFileUrl(offer.fileUrl)}
                                                  download={offer.fileName || 'teklif.pdf'}
                                                  className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition-colors"
                                                  title="İndir"
                                                >
                                                  <Download className="w-3.5 h-3.5" />
                                                </a>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-[10px] text-slate-400 italic">Belge Yok</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* Seçim Gerekçesi ve Kanıt Kutusu */}
                            {initialSelectionRationale ? (
                              <div className="bg-emerald-950 text-emerald-50 p-3.5 border-t border-emerald-700">
                                <div className="flex items-start space-x-2.5">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="text-xs leading-relaxed">
                                    <div className="font-black text-emerald-300 uppercase tracking-wide text-[11px] mb-1">
                                      📌 İhale & İlk Teklif Seçim Gerekçesi (Neden {lowestInitialOffer?.supplier} Seçildi?)
                                    </div>
                                    <p className="text-emerald-100 font-medium">
                                      {initialSelectionRationale.explanation}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-amber-100/70 text-amber-950 px-3.5 py-2.5 border-t border-amber-200 flex items-center justify-between gap-2 text-xs">
                                <span>
                                  💡 Bu kayıtta şu an tek bir ilk teklif görünmektedir. İhale sürecinde başka firmalardan da ilk teklif alındıysa <strong>"+ Rakip İlk Teklif Ekle"</strong> butonuyla belge yükleyerek veya manuel girerek kıyas tablosuna ekleyebilirsiniz.
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Rakip İlk Teklif Ekleme Formu (Mevcut Kayıtlar İçin) */}
                          {showAddCompetitorForm && (
                            <div className="bg-indigo-50/90 border-2 border-indigo-300 rounded-xl p-4 space-y-3 animate-in fade-in duration-150">
                              <div className="flex items-center justify-between">
                                <h5 className="text-xs font-black text-indigo-950 uppercase tracking-wide flex items-center space-x-1.5">
                                  <UploadCloud className="w-4 h-4 text-indigo-600" />
                                  <span>Mevcut Kayda Rakip İlk Teklif Belgesi Ekle (AI Otomatik Okuma veya Manuel)</span>
                                </h5>
                                <button
                                  type="button"
                                  onClick={() => setShowAddCompetitorForm(false)}
                                  className="text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                                >
                                  ✕ Kapat
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="sm:col-span-2 lg:col-span-4">
                                  <label className="block text-[10px] font-bold text-indigo-900 uppercase mb-1">
                                    1. Rakip Teklif Dosyası Yükle (PDF / Görsel — AI Firma ve Tutarı Otomatik Okur)
                                  </label>
                                  <div className="flex items-center space-x-2">
                                    <label className="px-3 py-2 bg-white hover:bg-indigo-50 text-indigo-800 border border-indigo-300 rounded-lg text-xs font-bold cursor-pointer inline-flex items-center space-x-1.5 shadow-2xs">
                                      {isUploadingCompetitorDoc ? (
                                        <>
                                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                                          <span>AI Belgeyi Okuyor...</span>
                                        </>
                                      ) : (
                                        <>
                                          <UploadCloud className="w-3.5 h-3.5 text-indigo-600" />
                                          <span>{competitorFileName ? `Yüklendi: ${competitorFileName}` : 'Rakip Teklif PDF / Görsel Seç'}</span>
                                        </>
                                      )}
                                      <input
                                        type="file"
                                        accept=".pdf,image/*"
                                        onChange={handleCompetitorFileUpload}
                                        className="hidden"
                                        disabled={isUploadingCompetitorDoc}
                                      />
                                    </label>
                                    {competitorFileName && (
                                      <span className="text-[11px] text-emerald-700 font-bold">
                                        ✓ {competitorFileName}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                    Rakip Firma Adı *
                                  </label>
                                  <input
                                    type="text"
                                    value={competitorSupplier}
                                    onChange={(e) => setCompetitorSupplier(e.target.value)}
                                    placeholder='Örn: ООО "ТД БМЗ"'
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                    İlk Teklif Tutarı (₽) *
                                  </label>
                                  <input
                                    type="text"
                                    value={competitorAmount}
                                    onChange={(e) => setCompetitorAmount(e.target.value)}
                                    placeholder="Örn: 35663200"
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                    Teklif / Fatura No
                                  </label>
                                  <input
                                    type="text"
                                    value={competitorDocNo}
                                    onChange={(e) => setCompetitorDocNo(e.target.value)}
                                    placeholder="Örn: NU-3364"
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                    Teklif Tarihi
                                  </label>
                                  <input
                                    type="date"
                                    value={competitorDate}
                                    onChange={(e) => setCompetitorDate(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-900"
                                  />
                                </div>
                              </div>

                              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-indigo-200">
                                <button
                                  type="button"
                                  onClick={() => setShowAddCompetitorForm(false)}
                                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold cursor-pointer"
                                >
                                  İptal
                                </button>
                                <button
                                  type="button"
                                  onClick={handleSaveCompetitorOffer}
                                  disabled={isSavingCompetitor || isUploadingCompetitorDoc}
                                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                                >
                                  {isSavingCompetitor ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Kaydediliyor...</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>Rakip İlk Teklifi Kaydet ve Tabloya Ekle</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tutar & İndirim Özeti Kutusu */}
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-3 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-bold uppercase text-[10px]">
                            {isFirstStage && initialOffers.length > 1 ? 'En Uygun İlk Teklif (Seçilen Baz Tutar):' : 'Aşama Teklif / Fatura Tutarı:'}
                          </span>
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
                          <span>{isFirstStage && initialOffers.length > 1 ? 'En Uygun (Baz) İlk Teklif Belgesini Aç' : 'Belgeyi Aç'}</span>
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
          <div className="p-4 sm:p-6 bg-slate-100/70 space-y-4">
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
        </div>

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
