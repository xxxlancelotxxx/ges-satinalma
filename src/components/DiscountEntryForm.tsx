import { INITIAL_SUPERVISORS, INITIAL_JOBSITES, INITIAL_PERSONNEL } from '../data/initialData';
import React, { useState, useEffect, useMemo } from 'react';
import { PurchasingSupervisor, Jobsite, DiscountRecord, InvoiceItem, InvoiceRecord, Personnel, NegotiationRound, StageDocument } from '../types';
import { formatRuble, formatUploadDate, openOriginalFileViewer } from '../utils/format';
import { getDiscountDocumentStages, StageDocumentItem, getEffectiveAgreedPrice, getEffectiveDiscount, getGenuineNegotiationRoundCount } from '../utils/negotiationStages';
import { checkRecordPermission } from '../utils/permissions';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { NEGOTIATION_THRESHOLD, validateProcedure52 } from '../utils/procedureConfig';
import { CANONICAL_CATEGORIES } from '../utils/categoryClassifier';

import { GesLogo } from './GesLogo';
import {
  Coins,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Building2,
  UserCheck,
  Calendar,
  FileText,
  Upload,
  ArrowRight,
  ArrowLeft,
  HardDrive,
  FileCheck,
  Calculator,
  Layers,
  Zap,
  Edit3,
  CheckCircle,
  Eye,
  X,
  Info,
  Search,
  Trash2,
  Lock,
  ArrowUpDown,
  Clock,
  Loader2,
  Users,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Target,
  Award,
  HelpCircle,
  AlertTriangle,
  TrendingDown,
  Wand2,
  RotateCcw
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { EditDiscountModal } from './EditDiscountModal';
import { DiscountDetailModal } from './DiscountDetailModal';
import { PaginationControls } from './PaginationControls';
import { ComparativeOfferAnalysisModal } from './ComparativeOfferAnalysisModal';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter } from '../utils/filterHelpers';
import { normalizeVendorName, getVendorKey, areVendorsEqual, extractCanonicalVendors } from '../utils/vendorNormalizer';

interface Props {
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  personnel?: Personnel[];
  discounts?: DiscountRecord[];
  invoices?: InvoiceRecord[];
  onSaveDiscount: (record: Omit<DiscountRecord, 'id' | 'supervisorName' | 'jobsiteName' | 'discountAmount' | 'discountPercentage' | 'status'>) => void | Promise<void>;
  onUpdateDiscount?: (id: string, record: Partial<DiscountRecord>) => Promise<void> | void;
  onDeleteDiscount?: (id: string) => Promise<void> | void;
  onSuccess: () => void;
  isModal?: boolean;
}

export const DiscountEntryForm: React.FC<Props> = ({
  supervisors,
  jobsites,
  personnel = [],
  discounts = [],
  invoices = [],
  onSaveDiscount,
  onUpdateDiscount,
  onDeleteDiscount,
  onSuccess,
  isModal = false
}) => {
  const activeSupervisors = (supervisors && supervisors.length > 0) ? supervisors : INITIAL_SUPERVISORS;
  const activeJobsites = (jobsites && jobsites.length > 0) ? jobsites : INITIAL_JOBSITES;
  const activePersonnel = (personnel && personnel.length > 0) ? personnel : INITIAL_PERSONNEL;
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const [entryMode, setEntryMode] = useState<'auto-offers' | 'manual'>('auto-offers');
  const [isComparativeModalOpen, setIsComparativeModalOpen] = useState<boolean>(false);

  const [supervisorId, setSupervisorId] = useState<string>(activeSupervisors[0]?.id || '');
  const [performedByPersonnelId, setPerformedByPersonnelId] = useState<string>(
    user?.role === 'personnel' && user.personnelId ? user.personnelId : ''
  );
  const [jobsiteId, setJobsiteId] = useState<string>(activeJobsites[0]?.id || '');

  // Negotiation rounds state
  const [negotiationRounds, setNegotiationRounds] = useState<NegotiationRound[]>([]);
  const [crossNegotiationApplied, setCrossNegotiationApplied] = useState<boolean>(false);
  const [finalNegotiationDate, setFinalNegotiationDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Auto-set supervisor & jobsite when authenticated user changes or props load
  useEffect(() => {
    if (supervisors.length > 0 && (!supervisorId || !activeSupervisors.some(s => s.id === supervisorId))) {
      const matchSup = user?.supervisorId ? activeSupervisors.find(s => s.id === user.supervisorId) : null;
      setSupervisorId(matchSup ? matchSup.id : activeSupervisors[0].id);
    }
    if (jobsites.length > 0 && (!jobsiteId || !activeJobsites.some(j => j.id === jobsiteId))) {
      const matchJob = user?.defaultJobsiteId ? activeJobsites.find(j => j.id === user.defaultJobsiteId) : null;
      setJobsiteId(matchJob ? matchJob.id : activeJobsites[0].id);
    }

    if (user?.role === 'personnel' && user.personnelId) {
      setPerformedByPersonnelId(user.personnelId);
      if (user.supervisorId) {
        setSupervisorId(user.supervisorId);
      }
    } else if (user?.supervisorId) {
      const matchSup = activeSupervisors.find(s => s.id === user.supervisorId);
      if (matchSup) {
        setSupervisorId(matchSup.id);
      }
    }
    if (user?.defaultJobsiteId) {
      const matchJob = activeJobsites.find(j => j.id === user.defaultJobsiteId);
      if (matchJob) {
        setJobsiteId(matchJob.id);
      }
    } else if (user?.jobsiteIds && user.jobsiteIds.length > 0) {
      const matchJob = activeJobsites.find(j => user.jobsiteIds?.includes(j.id));
      if (matchJob) {
        setJobsiteId(matchJob.id);
      }
    }
  }, [user, supervisors, jobsites, supervisorId, jobsiteId]);
  const [vendorName, setVendorName] = useState<string>('');
  const [isNewVendor, setIsNewVendor] = useState<boolean>(false);

  // Existing registered vendors in GES Construction network (normalized keys & raw names)
  const registeredVendorKeys = useMemo(() => {
    const set = new Set<string>();
    (discounts || []).forEach(d => {
      const k = getVendorKey(d?.vendorName);
      if (k) set.add(k);
    });
    (invoices || []).forEach(inv => {
      const k = getVendorKey(inv?.vendorName || inv?.supplier);
      if (k) set.add(k);
    });
    return set;
  }, [discounts, invoices]);

  const registeredVendorNames = useMemo(() => {
    const set = new Set<string>();
    (discounts || []).forEach(d => {
      const v = String(d?.vendorName || '').trim().toLowerCase();
      if (v) set.add(v);
    });
    (invoices || []).forEach(inv => {
      const v = String(inv?.vendorName || inv?.supplier || '').trim().toLowerCase();
      if (v) set.add(v);
    });
    return set;
  }, [discounts, invoices]);

  // All unique canonical vendor names across system for autocomplete & suggestions
  const canonicalVendorsList = useMemo(() => {
    const combined = [
      ...(discounts || []).map(d => ({ vendorName: d.vendorName })),
      ...(invoices || []).map(i => ({ vendorName: i.supplier || i.vendorName }))
    ];
    return extractCanonicalVendors(combined);
  }, [discounts, invoices]);
  const [category, setCategory] = useState<string>('Hazır Beton & Çimento');
  const [offerPrice, setOfferPrice] = useState<string>('');
  const [scopeDeductionAmount, setScopeDeductionAmount] = useState<string>('');
  const [scopeDeductionReason, setScopeDeductionReason] = useState<string>('');
  const [agreedPrice, setAgreedPrice] = useState<string>('');
  const [orderDate, setOrderDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');
  const [invoiceNo, setInvoiceNo] = useState<string>('');

  // First & Final offer file states
  const [firstOfferFile, setFirstOfferFile] = useState<{ name: string; url: string; base64?: string } | null>(null);
  const [finalOfferFile, setFinalOfferFile] = useState<{ name: string; url: string; base64?: string } | null>(null);
  const [firstOfferItemCount, setFirstOfferItemCount] = useState<number>(0);

  // Extracted Material Items state (preserves OCR line items for granular comparison)
  const [extractedItems, setExtractedItems] = useState<Array<{
    materialName: string;
    originalName?: string;
    category?: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    discountAmount?: number;
  }>>([]);

  const [isProcessingAI, setIsProcessingAI] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // AI OCR Extracted Data Review & Approval Modal State (Pops up right after AI completes file scanning)
  const [aiReviewModal, setAiReviewModal] = useState<{
    offerType: 'first' | 'final';
    fileName: string;
    usedModel?: string;
    supervisorId: string;
    jobsiteId: string;
    vendorName: string;
    isNewVendor?: boolean;
    category: string;
    offerPrice: number;
    scopeDeductionAmount?: number;
    scopeDeductionReason?: string;
    adjustedOfferPrice?: number;
    agreedPrice: number;
    orderDate: string;
    invoiceNo: string;
    notes: string;
    items: Array<{
      materialName: string;
      originalName?: string;
      category?: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      discountAmount?: number;
    }>;
    rounds?: NegotiationRound[];
  } | null>(null);

  // States for handling drag/upload inside the AI Review Modal
  const [modalRoundLoadingIndex, setModalRoundLoadingIndex] = useState<number | null>(null);
  const [isModalRoundDragOver, setIsModalRoundDragOver] = useState<boolean>(false);

  // Review / Control Modal State (Pops up BEFORE saving)
  const [pendingReviewRecord, setPendingReviewRecord] = useState<{
    supervisorId: string;
    jobsiteId: string;
    vendorName: string;
    isNewVendor?: boolean;
    category: string;
    offerPrice: number;
    scopeDeductionAmount?: number;
    scopeDeductionReason?: string;
    adjustedOfferPrice?: number;
    agreedPrice: number;
    orderDate: string;
    notes: string;
    invoiceNo: string;
    firstOfferFileName: string;
    finalOfferFileName: string;
    items?: InvoiceItem[];
  } | null>(null);

  // Detail Inspection Modal State (Full Invoice & Items View)
  const [selectedDetailDiscount, setSelectedDetailDiscount] = useState<DiscountRecord | null>(null);
  const [detailDocUploading, setDetailDocUploading] = useState<boolean>(false);
  const [detailToast, setDetailToast] = useState<string | null>(null);

  // Edit Existing Discount Modal State
  const [editingDiscountRecord, setEditingDiscountRecord] = useState<DiscountRecord | null>(null);

  // Search, Sorting & Delete Confirmation States
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [dateSortOrder, setDateSortOrder] = useState<'desc' | 'asc'>('desc');
  const [tableFilters, setTableFilters] = useState({
    supervisor: 'all',
    jobsite: 'all',
    vendor: 'all',
    invoiceNo: '',
    date: { preset: 'all' } as DateFilterState
  });
  const [discountToDelete, setDiscountToDelete] = useState<DiscountRecord | null>(null);

  const isAnyTableFilterActive = useMemo(() => {
    return (
      tableFilters.supervisor !== 'all' ||
      tableFilters.jobsite !== 'all' ||
      tableFilters.vendor !== 'all' ||
      Boolean(tableFilters.invoiceNo.trim()) ||
      (tableFilters.date.preset && tableFilters.date.preset !== 'all') ||
      Boolean(searchTerm.trim())
    );
  }, [tableFilters, searchTerm]);

  const handleResetTableFilters = () => {
    setTableFilters({
      supervisor: 'all',
      jobsite: 'all',
      vendor: 'all',
      invoiceNo: '',
      date: { preset: 'all' }
    });
    setSearchTerm('');
  };

  // Submitted Record Confirmation Modal State
  const [submittedRecordSummary, setSubmittedRecordSummary] = useState<{
    supervisorName: string;
    jobsiteName: string;
    vendorName: string;
    category: string;
    offerPrice: number;
    scopeDeductionAmount?: number;
    scopeDeductionReason?: string;
    adjustedOfferPrice?: number;
    agreedPrice: number;
    discountAmount: number;
    discountPercentage: number;
    orderDate: string;
    invoiceNo: string;
    firstOfferFileName: string;
    finalOfferFileName: string;
  } | null>(null);

  useModalBackHandler(!!aiReviewModal, () => setAiReviewModal(null));
  useModalBackHandler(!!editingDiscountRecord, () => setEditingDiscountRecord(null));
  useModalBackHandler(!!submittedRecordSummary, () => setSubmittedRecordSummary(null));
  useModalBackHandler(!!discountToDelete, () => setDiscountToDelete(null));
  useModalBackHandler(!!selectedDetailDiscount, () => {
    setSelectedDetailDiscount(null);
    setDetailItemSearch('');
    setDetailItemsPage(1);
  });

  const [detailItemSearch, setDetailItemSearch] = useState<string>('');
  const [detailModalTab, setDetailModalTab] = useState<'items' | 'documents' | 'rounds'>('items');
  const [detailItemsPage, setDetailItemsPage] = useState<number>(1);
  const [detailItemsPageSize, setDetailItemsPageSize] = useState<number>(20);

  // Initialize modal tab and reset pagination whenever a discount is opened for inspection
  useEffect(() => {
    if (selectedDetailDiscount) {
      setDetailItemsPage(1);
      setDetailItemSearch('');
      if (selectedDetailDiscount.items && selectedDetailDiscount.items.length > 0) {
        setDetailModalTab('items');
      } else {
        setDetailModalTab('documents');
      }
    }
  }, [selectedDetailDiscount]);

  const [comparativeAnalysisData, setComparativeAnalysisData] = useState<any | null>(null);

  // Fetch or attach comparative analysis data for the detail inspection modal
  useEffect(() => {
    if (selectedDetailDiscount?.comparativeAnalysisId) {
      if (selectedDetailDiscount.canonicalMaterials && selectedDetailDiscount.canonicalMaterials.length > 0) {
        setComparativeAnalysisData({
          canonicalMaterials: selectedDetailDiscount.canonicalMaterials,
          winningSupplier: selectedDetailDiscount.vendorName,
          analysisCode: selectedDetailDiscount.analysisCode
        });
        return;
      }
      fetch(`/api/comparative-analyses/${encodeURIComponent(selectedDetailDiscount.comparativeAnalysisId)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.canonicalMaterials) {
            setComparativeAnalysisData(data);
          }
        })
        .catch(err => console.warn('[DETAIL COMPARATIVE FETCH]:', err));
    } else {
      setComparativeAnalysisData(null);
    }
  }, [selectedDetailDiscount?.id, selectedDetailDiscount?.comparativeAnalysisId, selectedDetailDiscount?.canonicalMaterials]);

  // Auto Calculations for Current Form & System Wide Total (with Scope Deduction & Cascading Rounds)
  const numOffer = Number(offerPrice) || 0;
  const numScopeDeduction = Number(scopeDeductionAmount) || 0;
  const numAdjustedOffer = Math.max(0, numOffer - numScopeDeduction);
  const currentBaseline = numScopeDeduction > 0 ? numAdjustedOffer : numOffer;
  const numAgreed = Number(agreedPrice) || 0;

  // Effective agreed price dynamically uses numAgreed if provided, or falls back to last round
  const effectiveAgreedPrice = numAgreed > 0
    ? numAgreed
    : (negotiationRounds.length > 0 && negotiationRounds[negotiationRounds.length - 1].quotedPrice > 0)
      ? Number(negotiationRounds[negotiationRounds.length - 1].quotedPrice)
      : 0;

  const currentFormDiscount = (currentBaseline > 0 && effectiveAgreedPrice > 0 && currentBaseline >= effectiveAgreedPrice) ? (currentBaseline - effectiveAgreedPrice) : 0;
  const currentFormPercentage = currentBaseline > 0 ? Number(((currentFormDiscount / currentBaseline) * 100).toFixed(2)) : 0;

  // Set agreed price without overwriting intermediate negotiation rounds
  const handleAgreedPriceChange = (val: string) => {
    setAgreedPrice(val);
  };

  // Negotiation round helpers
  const handleAddRound = () => {
    const roundCount = negotiationRounds.length;
    const roundNumber = roundCount + 1;
    // Stage numbering: Stage 1 is Initial Offer/Invoice, Stage 2 is Box 2 (2. İndirimli Fatura / Teklif).
    // Adding 1 round produces Stage 3 ('3. İndirimli Fatura / Teklif'), 2 rounds produces Stage 4 ('4. İndirimli Fatura / Teklif').
    const stageNumber = roundNumber + 2;

    const lastRound = roundCount > 0 ? negotiationRounds[roundCount - 1] : null;
    let prevPrice = (lastRound && lastRound.quotedPrice > 0)
      ? lastRound.quotedPrice
      : (numAgreed > 0 ? numAgreed : (currentBaseline > 0 ? currentBaseline : numOffer));

    const defaultQuoted = prevPrice > 0 ? Math.round(prevPrice * 0.95) : 0;
    const defaultDisc = prevPrice > 0 ? Math.max(0, prevPrice - defaultQuoted) : 0;

    const newRound: NegotiationRound = {
      id: `rnd_${Date.now()}_${roundNumber}`,
      roundNumber,
      date: new Date().toISOString().split('T')[0],
      vendorName: vendorName || 'Tedarikçi Firma',
      quotedPrice: defaultQuoted,
      previousPrice: prevPrice,
      discountThisRound: defaultDisc,
      note: `${stageNumber}. İndirimli Fatura / Teklif Revizyonu`
    };

    setNegotiationRounds(prev => [...prev, newRound]);
  };

  // Helper to add or process a round document inside aiReviewModal
  const handleModalRoundDocUpload = async (file: File, targetIndex?: number) => {
    if (!aiReviewModal) return;

    const existingRounds = aiReviewModal.rounds ? [...aiReviewModal.rounds] : [];
    const isNew = targetIndex === undefined || targetIndex >= existingRounds.length;
    const roundIdx = isNew ? existingRounds.length : targetIndex;

    const offerNum = Number(aiReviewModal.offerPrice) || 0;
    const deductionNum = Number(aiReviewModal.scopeDeductionAmount) || 0;
    const baseOffer = deductionNum > 0 ? Math.max(0, offerNum - deductionNum) : offerNum;

    // Determine previousPrice
    let prevPrice = baseOffer;
    if (roundIdx > 0 && existingRounds[roundIdx - 1]?.quotedPrice) {
      prevPrice = existingRounds[roundIdx - 1].quotedPrice;
    } else if (roundIdx === 0 && Number(aiReviewModal.agreedPrice) > 0) {
      prevPrice = Number(aiReviewModal.agreedPrice);
    }

    // Create or update round
    let currentRound: NegotiationRound;
    if (isNew) {
      currentRound = {
        id: `rnd_modal_${Date.now()}_${roundIdx + 1}`,
        roundNumber: roundIdx + 1,
        date: new Date().toISOString().split('T')[0],
        vendorName: aiReviewModal.vendorName || vendorName || 'Tedarikçi Firma',
        quotedPrice: 0,
        previousPrice: prevPrice,
        discountThisRound: 0,
        documentName: file.name,
        note: `${roundIdx + 1}. Tur: İndirimli teklif / ara fatura`
      };
      existingRounds.push(currentRound);
    } else {
      currentRound = {
        ...existingRounds[roundIdx],
        documentName: file.name,
        previousPrice: prevPrice
      };
      existingRounds[roundIdx] = currentRound;
    }

    setAiReviewModal({ ...aiReviewModal, rounds: existingRounds });
    setModalRoundLoadingIndex(roundIdx);

    try {
      // 1. Read base64
      const base64Data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 2. Upload to server vault
      const vaultRes = await uploadToServerVault(file.name, base64Data);

      // 3. Fast lightweight OCR
      let readAmount = 0;
      try {
        const ocrRes = await fetch('/api/discounts/process-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64: base64Data,
            mimeType: file.type || 'application/octet-stream',
            fileName: file.name,
            offerType: 'round',
            scanMode: 'summary-only'
          })
        });
        const ocrData = await ocrRes.json();
        if (ocrRes.ok && ocrData.success && ocrData.extracted?.totalAmount) {
          readAmount = Number(ocrData.extracted.totalAmount) || 0;
        }
      } catch (ocrErr) {
        console.warn('Modal round quick OCR skipped or failed:', ocrErr);
      }

      // 4. Update round with URL and amount
      setAiReviewModal(prev => {
        if (!prev) return prev;
        const baseOffer = Number(prev.offerPrice) || 0;
        const currentAgreed = Number(prev.agreedPrice) || 0;

        // If the uploaded document has price <= currentAgreed: it is a cheaper final invoice, not an intermediate round!
        if (readAmount > 0 && currentAgreed > 0 && readAmount <= currentAgreed + 0.01) {
          setNotification({
            type: 'success',
            message: `⚡ Yüklenen belgedeki tutar (${formatRuble(readAmount)}) nihai anlaşılan tutar ve son fatura olarak güncellendi.`
          });
          return {
            ...prev,
            agreedPrice: readAmount,
            fileName: file.name
          };
        }

        // If readAmount is >= baseOffer, it cannot be a discount round!
        if (readAmount > 0 && baseOffer > 0 && readAmount >= baseOffer - 0.01) {
          setNotification({
            type: 'error',
            message: `⚠️ Yüklenen belgedeki teklif tutarı (${formatRuble(readAmount)}) ilk tekliften (${formatRuble(baseOffer)}) daha düşük olmalıdır!`
          });
          return prev;
        }

        const existingRounds = prev.rounds ? [...prev.rounds] : [];
        const roundIdx = existingRounds.length;
        const effectivePrice = readAmount > 0 ? readAmount : (prevPrice > currentAgreed && currentAgreed > 0 ? Math.round(prevPrice - (prevPrice - currentAgreed) * 0.5) : Math.round(prevPrice * 0.95));

        const newRound: NegotiationRound = {
          id: `rnd_modal_${Date.now()}_${roundIdx + 1}`,
          roundNumber: roundIdx + 1,
          date: new Date().toISOString().split('T')[0],
          vendorName: prev.vendorName || vendorName || 'Tedarikçi Firma',
          quotedPrice: effectivePrice,
          previousPrice: prevPrice,
          discountThisRound: Math.max(0, prevPrice - effectivePrice),
          documentName: file.name,
          documentUrl: vaultRes.url,
          note: `${roundIdx + 1}. Tur: Belgeden ${formatRuble(effectivePrice)} teklif okundu`
        };

        return { ...prev, rounds: [...existingRounds, newRound] };
      });
    } catch (err: any) {
      console.error('Error uploading modal round document:', err);
      setNotification({type: 'error', message: 'Ara tur belgesi yüklenirken hata oluştu: ' + (err.message || 'Bilinmeyen hata')});
    } finally {
      setModalRoundLoadingIndex(null);
    }
  };

  const handleRemoveModalRound = (removeIdx: number) => {
    if (!aiReviewModal || !aiReviewModal.rounds) return;
    const filtered = aiReviewModal.rounds
      .filter((_, idx) => idx !== removeIdx)
      .map((r, idx) => ({
        ...r,
        roundNumber: idx + 1
      }));
    const lastRnd = filtered.length > 0 ? filtered[filtered.length - 1] : null;
    const lastQp = Number(lastRnd?.quotedPrice) || 0;
    let nextAgreed = Number(aiReviewModal.agreedPrice) || 0;
    if (lastQp > 0) {
      nextAgreed = lastQp;
    }
    setAiReviewModal({ ...aiReviewModal, rounds: filtered, agreedPrice: nextAgreed });
  };

  const handleUpdateModalRound = (roundIdx: number, field: keyof NegotiationRound, value: any) => {
    if (!aiReviewModal || !aiReviewModal.rounds) return;
    const updated = [...aiReviewModal.rounds];
    const r = { ...updated[roundIdx], [field]: value };
    if (field === 'quotedPrice') {
      const qp = Number(value) || 0;
      r.quotedPrice = qp;
      const prevP = (roundIdx === 0 ? (Number(aiReviewModal.agreedPrice) || 0) : Number(updated[roundIdx - 1]?.quotedPrice)) || r.previousPrice || 0;
      r.discountThisRound = Math.max(0, prevP - qp);
    }
    updated[roundIdx] = r;

    // Recalculate subsequent rounds' previousPrice and discounts
    for (let j = roundIdx + 1; j < updated.length; j++) {
      const prevQp = Number(updated[j - 1].quotedPrice) || 0;
      if (prevQp > 0) {
        updated[j].previousPrice = prevQp;
        updated[j].discountThisRound = Math.max(0, prevQp - (Number(updated[j].quotedPrice) || 0));
      }
    }

    // Determine the latest agreed price from the last round or lowest price
    const lastRnd = updated[updated.length - 1];
    const lastQp = Number(lastRnd?.quotedPrice) || 0;
    let nextAgreed = Number(aiReviewModal.agreedPrice) || 0;
    if (lastQp > 0 && (nextAgreed <= 0 || lastQp < nextAgreed || roundIdx === updated.length - 1)) {
      nextAgreed = lastQp;
    }

    setAiReviewModal({ ...aiReviewModal, rounds: updated, agreedPrice: nextAgreed });
  };

  // Smart Auto-Distribute Wizard (1-Click Generation of 2 or 3 Balanced Negotiation Rounds)
  const handleAutoDistributeRounds = (roundCount: 2 | 3) => {
    const base = currentBaseline > 0 ? currentBaseline : numOffer;
    const finalPrice = numAgreed > 0 && numAgreed < base ? numAgreed : Math.round(base * 0.90);
    const totalSaving = Math.max(0, base - finalPrice);
    if (base <= 0 || totalSaving <= 0) return;

    const today = new Date().toISOString().split('T')[0];
    const newRounds: NegotiationRound[] = [];

    if (roundCount === 2) {
      const r1Saving = Math.round(totalSaving * 0.55);
      const r1Price = base - r1Saving;
      newRounds.push({
        id: `rnd_${Date.now()}_1`,
        roundNumber: 1,
        date: today,
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: base,
        quotedPrice: r1Price,
        discountThisRound: r1Saving,
        note: '1. Tur: İlk teklif üzerinden revizyon ve liste fiyatı indirimi istendi.'
      });
      const r2Saving = totalSaving - r1Saving;
      newRounds.push({
        id: `rnd_${Date.now()}_2`,
        roundNumber: 2,
        date: today,
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: r1Price,
        quotedPrice: finalPrice,
        discountThisRound: r2Saving,
        note: '2. Tur: Peşin ödeme / hacim taahhüdü ile nihai fiyatta mutabık kalındı.'
      });
    } else {
      const r1Saving = Math.round(totalSaving * 0.40);
      const r1Price = base - r1Saving;
      newRounds.push({
        id: `rnd_${Date.now()}_1`,
        roundNumber: 1,
        date: today,
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: base,
        quotedPrice: r1Price,
        discountThisRound: r1Saving,
        note: '1. Tur: Liste fiyatı üzerinden ilk revizyon indirimi istendi.'
      });

      const r2Saving = Math.round(totalSaving * 0.35);
      const r2Price = r1Price - r2Saving;
      newRounds.push({
        id: `rnd_${Date.now()}_2`,
        roundNumber: 2,
        date: today,
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: r1Price,
        quotedPrice: r2Price,
        discountThisRound: r2Saving,
        note: '2. Tur: Bölge müdürüyle görüşüldü, rekabetçi karşı teklif sunuldu.'
      });

      const r3Saving = totalSaving - r1Saving - r2Saving;
      newRounds.push({
        id: `rnd_${Date.now()}_3`,
        roundNumber: 3,
        date: today,
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: r2Price,
        quotedPrice: finalPrice,
        discountThisRound: r3Saving,
        note: '3. Tur: Nihai pazarlık; proje onayına istinaden en iyi fiyat bağlandı.'
      });
    }

    setNegotiationRounds(newRounds);
    setAgreedPrice(String(finalPrice));
  };

  // Smart Cascading Update for Negotiation Rounds
  const handleUpdateRound = (index: number, field: keyof NegotiationRound, value: any) => {
    let updated = [...negotiationRounds];
    const item = { ...updated[index], [field]: value };

    if (field === 'quotedPrice') {
      const q = Math.max(0, Number(value) || 0);
      item.quotedPrice = q;
      const prev = Number(item.previousPrice) || 0;
      item.discountThisRound = Math.max(0, prev - q);
    } else if (field === 'discountThisRound') {
      const d = Math.max(0, Number(value) || 0);
      item.discountThisRound = d;
      const prev = Number(item.previousPrice) || 0;
      item.quotedPrice = Math.max(0, prev - d);
    } else if (field === 'previousPrice') {
      const prev = Math.max(0, Number(value) || 0);
      item.previousPrice = prev;
      const q = Number(item.quotedPrice) || 0;
      item.discountThisRound = Math.max(0, prev - q);
    }

    updated[index] = item;

    // Cascade to subsequent rounds so next round's previousPrice matches current round's quotedPrice
    for (let i = index + 1; i < updated.length; i++) {
      const prevRnd = updated[i - 1];
      const currentRnd = { ...updated[i] };
      currentRnd.previousPrice = prevRnd.quotedPrice;
      const curQ = Number(currentRnd.quotedPrice) || 0;
      currentRnd.discountThisRound = Math.max(0, currentRnd.previousPrice - curQ);
      updated[i] = currentRnd;
    }

    setNegotiationRounds(updated);

    // Sync agreedPrice with last round's quotedPrice
    const lastRnd = updated[updated.length - 1];
    if (lastRnd && lastRnd.quotedPrice > 0) {
      setAgreedPrice(String(lastRnd.quotedPrice));
    }
  };

  const handleRemoveRound = (index: number) => {
    let updated = negotiationRounds.filter((_, i) => i !== index);
    const base = currentBaseline > 0 ? currentBaseline : numOffer;
    updated = updated.map((r, i) => {
      const prevP = i === 0 ? (base > 0 ? base : (r.previousPrice || 0)) : updated[i - 1].quotedPrice;
      const qP = Number(r.quotedPrice) || 0;
      return {
        ...r,
        roundNumber: i + 1,
        previousPrice: prevP,
        discountThisRound: Math.max(0, prevP - qP)
      };
    });

    setNegotiationRounds(updated);
    if (updated.length > 0) {
      const lastRnd = updated[updated.length - 1];
      if (lastRnd.quotedPrice > 0) {
        setAgreedPrice(String(lastRnd.quotedPrice));
      }
    }
  };

  const handleClearRounds = () => {
    setNegotiationRounds([]);
  };

  const isHighValue = numOffer >= NEGOTIATION_THRESHOLD || effectiveAgreedPrice >= NEGOTIATION_THRESHOLD;
  const validationResult = isHighValue
    ? validateProcedure52({
        offerPrice: numOffer,
        agreedPrice: effectiveAgreedPrice,
        negotiationRounds,
        crossNegotiationApplied,
        vendorName
      })
    : { isValid: true, warnings: [] };

  const availablePersonnel = activePersonnel.filter(
    p => p.supervisorId === supervisorId && p.active !== false
  );

  // System-wide accumulated discount totals
  const totalSystemDiscount = (discounts || []).reduce((acc, d) => {
    const amt = typeof d.discountAmount === 'number' && !isNaN(d.discountAmount) && d.discountAmount >= 0
      ? d.discountAmount
      : Math.max(0, (d.offerPrice || 0) - (d.agreedPrice || 0));
    return acc + amt;
  }, 0);

  const totalSystemOffer = (discounts || []).reduce((acc, d) => acc + (d.offerPrice || 0), 0);
  const totalSystemPercentage = totalSystemOffer > 0 ? Number(((totalSystemDiscount / totalSystemOffer) * 100).toFixed(2)) : 0;

  // Ultra-fast client-side image compression: Scales 10MB phone camera / scanner images down to ~300KB in 30ms
  const readFileOrCompressImage = async (file: File): Promise<string> => {
    if (file.type.startsWith('image/')) {
      return new Promise((resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const MAX_DIM = 1600;
          let width = img.width;
          let height = img.height;

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve(compressedDataUrl);
            return;
          }

          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        };
        img.src = objectUrl;
      });
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Helper to upload files to Sistem Arşivi
  const uploadToServerVault = async (fileName: string, base64Data: string) => {
    try {
      const response = await fetch('/api/upload-file', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileName,
          fileData: base64Data
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Sunucu hatası');
      return { url: data.fileUrl || data.url, fileId: data.fileId };
    } catch (err: any) {
      console.error('Upload failed:', err);
      console.error(`Dosya yüklemesi başarısız oldu: ${err.message}.`);
      throw err;
    }
  };

  // Helper to upload or replace stage document directly from Detail Modal
  const handleUploadStageDocumentInDetail = async (stage: StageDocumentItem, file: File) => {
    if (!selectedDetailDiscount) return;
    try {
      setDetailDocUploading(true);
      const base64Data = await readFileOrCompressImage(file);
      const vaultRes = await uploadToServerVault(file.name, base64Data);
      const fileUrl = vaultRes.url;
      const fileId = vaultRes.fileId;

      const updated = { ...selectedDetailDiscount };

      if (stage.stageType === 'first') {
        updated.firstOfferFileName = file.name;
        updated.firstOfferFileUrl = fileUrl;
        updated.firstOfferDriveFileId = fileId;
      } else if (stage.stageType === 'round' && stage.roundIndex !== undefined) {
        const rounds = Array.isArray(updated.negotiationRounds) ? [...updated.negotiationRounds] : [];
        if (rounds[stage.roundIndex]) {
          rounds[stage.roundIndex] = {
            ...rounds[stage.roundIndex],
            documentName: file.name,
            documentUrl: fileUrl
          };
          updated.negotiationRounds = rounds;
        }
      } else if (stage.isFinal || stage.stageType === 'final') {
        updated.finalOfferFileName = file.name;
        updated.finalOfferFileUrl = fileUrl;
        updated.finalOfferDriveFileId = fileId;
      }

      // Keep stageDocuments array in sync
      const curStages: StageDocument[] = Array.isArray(updated.stageDocuments) ? [...updated.stageDocuments] : [];
      const existingIdx = curStages.findIndex(s => s.stageNumber === stage.stageNumber);
      const newEntry: StageDocument = {
        stageNumber: stage.stageNumber,
        title: stage.stageLabel,
        fileName: file.name,
        fileUrl,
        driveFileId: fileId,
        amount: stage.amount,
        date: new Date().toISOString().split('T')[0],
        roundIndex: stage.roundIndex,
        isFinal: stage.isFinal
      };
      if (existingIdx >= 0) {
        curStages[existingIdx] = newEntry;
      } else {
        curStages.push(newEntry);
      }
      updated.stageDocuments = curStages;

      // Update state in place
      setSelectedDetailDiscount(updated);

      // Persist to server / Firestore
      if (onUpdateDiscount) {
        await onUpdateDiscount(updated.id, {
          firstOfferFileName: updated.firstOfferFileName,
          firstOfferFileUrl: updated.firstOfferFileUrl,
          firstOfferDriveFileId: updated.firstOfferDriveFileId,
          finalOfferFileName: updated.finalOfferFileName,
          finalOfferFileUrl: updated.finalOfferFileUrl,
          finalOfferDriveFileId: updated.finalOfferDriveFileId,
          negotiationRounds: updated.negotiationRounds,
          stageDocuments: updated.stageDocuments
        });
      }

      setDetailToast(`✅ ${stage.stageLabel} belgesi ("${file.name}") başarıyla kaydedildi ve arşivlendi.`);
      setTimeout(() => setDetailToast(null), 4000);
    } catch (err: any) {
      console.error('Detail stage upload error:', err);
      alert(`Belge yüklenirken hata oluştu: ${err?.message || 'Bilinmeyen hata'}`);
    } finally {
      setDetailDocUploading(false);
    }
  };

  // Helper to process offer file using Gemini AI & Smart Excel Parser
  const processOfferDocument = async (file: File, offerType: 'first' | 'final', preloadedBase64?: string) => {
    setIsProcessingAI(true);
    setNotification(null);

    try {
      let fileTextContext = '';
      let calculatedExcelTotal = 0;
      let clientVendor = '';
      let clientCategory = '';

      // If Excel or CSV file
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        fileTextContext = XLSX.utils.sheet_to_csv(sheet);
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        // Smart Excel total detection: search for total keywords in rows
        let totalRowFound = false;
        for (let r = rows.length - 1; r >= 0; r--) {
          const row = rows[r];
          if (!row || !Array.isArray(row)) continue;
          const rowStr = row.join(' ').toLowerCase();

          if (
            rowStr.includes('итого') ||
            rowStr.includes('всего') ||
            rowStr.includes('общая сумма') ||
            rowStr.includes('toplam') ||
            rowStr.includes('total') ||
            rowStr.includes('сумма')
          ) {
            const nums = row
              .map(cell => {
                if (typeof cell === 'number') return cell;
                if (typeof cell === 'string') {
                  const cleaned = cell.replace(/[\s\xa0₽рубTL]/g, '').replace(',', '.');
                  const val = parseFloat(cleaned);
                  return isNaN(val) ? 0 : val;
                }
                return 0;
              })
              .filter(n => n > 100);

            if (nums.length > 0) {
              calculatedExcelTotal = Math.max(...nums);
              totalRowFound = true;
              break;
            }
          }
        }

        // If no explicit total row, sum item line totals
        if (!totalRowFound) {
          let sum = 0;
          rows.forEach(row => {
            if (!row || !Array.isArray(row)) return;
            const nums = row
              .map(cell => {
                if (typeof cell === 'number') return cell;
                if (typeof cell === 'string') {
                  const cleaned = cell.replace(/[\s\xa0₽рубTL]/g, '').replace(',', '.');
                  const val = parseFloat(cleaned);
                  return isNaN(val) ? 0 : val;
                }
                return 0;
              })
              .filter(n => n > 50 && n < 50000000);

            if (nums.length > 0) {
              sum += nums[nums.length - 1];
            }
          });
          if (sum > 0) calculatedExcelTotal = sum;
        }

        // Text keyword fallback detection
        const fullTextLower = fileTextContext.toLowerCase();
        if (fullTextLower.includes('дипломат') || fullTextLower.includes('тск')) clientVendor = 'ООО "ТСК ДИПЛОМАТ"';
        else if (fullTextLower.includes('diler') || fullTextLower.includes('дилер')) clientVendor = 'Diler Demir Çelik A.Ş.';
        else if (fullTextLower.includes('çimsa') || fullTextLower.includes('чимса')) clientVendor = 'Çimsa Çimento Sanayi A.Ş.';
        else if (fullTextLower.includes('стройкомплект')) clientVendor = 'ООО "СтройКомплект"';
        else if (fullTextLower.includes('стройснаб')) clientVendor = 'ООО "СтройСнаб"';
        else if (fullTextLower.includes('металл-сервис') || fullTextLower.includes('металлсервис')) clientVendor = 'ООО "МЕТАЛЛ-СЕРВИС"';

        if (
          fullTextLower.includes('арматура') ||
          fullTextLower.includes('сталь') ||
          fullTextLower.includes('пруток') ||
          fullTextLower.includes('а500') ||
          fullTextLower.includes('demir') ||
          fullTextLower.includes('çelik')
        ) {
          clientCategory = 'İnşaat Demiri & Çelik';
        } else if (
          fullTextLower.includes('бетон') ||
          fullTextLower.includes('цемент') ||
          fullTextLower.includes('раствор') ||
          fullTextLower.includes('пескобетон') ||
          fullTextLower.includes('çimento')
        ) {
          clientCategory = 'Hazır Beton & Çimento';
        } else if (
          fullTextLower.includes('кабель') ||
          fullTextLower.includes('провод') ||
          fullTextLower.includes('автомат') ||
          fullTextLower.includes('щит') ||
          fullTextLower.includes('elektrik')
        ) {
          clientCategory = 'Elektrik & Otomasyon';
        } else if (
          fullTextLower.includes('труба') ||
          fullTextLower.includes('вентиляция') ||
          fullTextLower.includes('насос') ||
          fullTextLower.includes('tesisat')
        ) {
          clientCategory = 'Mekanik & Tesisat';
        } else if (
          fullTextLower.includes('xps') ||
          fullTextLower.includes('утеплитель') ||
          fullTextLower.includes('вата') ||
          fullTextLower.includes('гипсокартон') ||
          fullTextLower.includes('yalıtım')
        ) {
          clientCategory = 'Yalıtım & Alçıpan';
        } else if (
          fullTextLower.includes('электрод') ||
          fullTextLower.includes('бита') ||
          fullTextLower.includes('краги') ||
          fullTextLower.includes('гвоздь') ||
          fullTextLower.includes('диск') ||
          fullTextLower.includes('скотч') ||
          fullTextLower.includes('сапоги') ||
          fullTextLower.includes('плащ') ||
          fullTextLower.includes('перчатки') ||
          fullTextLower.includes('дюбель') ||
          fullTextLower.includes('саморез') ||
          fullTextLower.includes('чулок') ||
          fullTextLower.includes('sarf') ||
          fullTextLower.includes('hırdavat') ||
          fullTextLower.includes('eldiven') ||
          fullTextLower.includes('çivi') ||
          fullTextLower.includes('matkap')
        ) {
          clientCategory = 'Sarf Malzeme & Hırdavat';
        }
      }

      // Read file with high-speed compression for images (reuse if already loaded)
      const base64Data: string = preloadedBase64 || (await readFileOrCompressImage(file));

      // Prepare first offer context if scanning 2nd final offer for speed & token optimization
      const firstOfferContext = offerType === 'final' ? {
        vendorName: vendorName || '',
        category: category || '',
        offerPrice: Number(offerPrice) || 0,
        items: extractedItems || []
      } : null;

      // Call Gemini AI server API
      let firstOfferBase64 = undefined;
      if (offerType === 'final' && firstOfferFile) {
        firstOfferBase64 = firstOfferFile.base64 || (firstOfferFile.url?.startsWith('data:') ? firstOfferFile.url : undefined);
      }
      let extractedData: any = null;
      let usedModelName = 'Gemini AI OCR';
      try {
        const res = await fetch('/api/discounts/process-ai', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileBase64: base64Data,
            mimeType: file.type || 'application/octet-stream',
            fileName: file.name,
            fileTextContext,
            offerType,
            scanMode: offerType === 'first' ? 'summary-only' : 'full',
            firstOfferContext, firstOfferBase64
          })
        });
        const resText = await res.text();
        let data: any = {};
        try {
          data = JSON.parse(resText);
        } catch {
          throw new Error(`Sunucu yanıtı geçersiz (${res.status}): ${resText.slice(0, 100)}`);
        }
        if (res.ok && data.success && data.extracted) {
          extractedData = data.extracted;
          if (data.usedModel) {
            usedModelName = data.usedModel;
          }
        } else {
          throw new Error(data.error + (data.details ? ' (' + data.details + ')' : '') || 'AI OCR başarısız');
        }
      } catch (err: any) {
        console.warn('AI offer processing network fallback:', err);
        setNotification({
          type: 'error',
          message: err.message || 'Teklif belgesi yapay zeka ile okunamadı.'
        });
        setIsProcessingAI(false);
        return;
      }

      // Determine extracted fields
      const finalTotal =
        extractedData?.totalAmount && extractedData.totalAmount > 0
          ? extractedData.totalAmount
          : calculatedExcelTotal > 0
          ? calculatedExcelTotal
          : offerType === 'first'
          ? 2450000
          : 1960000;

      const finalVendor =
        (extractedData?.vendorName && String(extractedData.vendorName).trim() !== '' && !String(extractedData.vendorName).toLowerCase().includes('bilinmeyen'))
          ? String(extractedData.vendorName)
          : (extractedData?.supplier && String(extractedData.supplier).trim() !== '' && !String(extractedData.supplier).toLowerCase().includes('bilinmeyen'))
          ? String(extractedData.supplier)
          : (extractedData?.company && String(extractedData.company).trim() !== '')
          ? String(extractedData.company)
          : (extractedData?.seller && String(extractedData.seller).trim() !== '')
          ? String(extractedData.seller)
          : clientVendor || '';

      let mappedCategory = '';
      const aiCategory = extractedData?.category || '';
      const rawCat = (aiCategory || clientCategory || '').toLowerCase().trim();

      if (rawCat.includes('bilgi') || rawCat.includes('it') || rawCat.includes('bilgisayar') || rawCat.includes('teknoloji') || rawCat.includes('donanım')) {
        mappedCategory = 'Bilgi İşlem & IT';
      } else if (rawCat.includes('beton') || rawCat.includes('çimento')) {
        mappedCategory = 'Hazır Beton & Çimento';
      } else if (rawCat.includes('demir') || rawCat.includes('çelik') || rawCat.includes('rebar')) {
        mappedCategory = 'İnşaat Demiri & Çelik';
      } else if (rawCat.includes('elektrik') || rawCat.includes('kablo') || rawCat.includes('pano')) {
        mappedCategory = 'Elektrik & Otomasyon';
      } else if (rawCat.includes('mekanik') || rawCat.includes('tesisat') || rawCat.includes('boru')) {
        mappedCategory = 'Mekanik & Tesisat';
      } else if (rawCat.includes('yalıtım') || rawCat.includes('alçıpan')) {
        mappedCategory = 'Yalıtım & Alçıpan';
      } else if (rawCat.includes('seramik') || rawCat.includes('fayans') || rawCat.includes('vitrifiye')) {
        mappedCategory = 'Seramik & Vitrifiye';
      } else if (rawCat.includes('boya') || rawCat.includes('cephe')) {
        mappedCategory = 'Boya & Dış Cephe';
      } else if (rawCat.includes('kimyasal') || rawCat.includes('harç')) {
        mappedCategory = 'Yapı Kimyasalları';
      } else if (rawCat.includes('iskele') || rawCat.includes('kalıp')) {
        mappedCategory = 'İskele & Kalıp';
      } else if (rawCat.includes('hırdavat') || rawCat.includes('sarf')) {
        mappedCategory = 'Sarf Malzeme & Hırdavat';
      } else if (rawCat.includes('makine') || rawCat.includes('kiralama')) {
        mappedCategory = 'İş Makinesi & Kiralama';
      } else if (rawCat.includes('ofis') || rawCat.includes('kırtasiye')) {
        mappedCategory = 'Ofis & Kırtasiye';
      } else if (aiCategory) {
        mappedCategory = aiCategory;
      }

      const finalCategory = mappedCategory || 'Diğer Malzeme';

      const rawItems = Array.isArray(extractedData?.items) ? extractedData.items : [];
      const formattedItems = rawItems.map((it: any) => ({
        materialName: it.materialName || 'İnşaat Malzemesi',
        originalName: it.originalName || it.materialName || '',
        category: it.category || finalCategory,
        unit: it.unit || 'Adet',
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        totalPrice: Number(it.totalPrice) || (Number(it.quantity) * Number(it.unitPrice)),
        discountAmount: Number(it.discountAmount) || 0
      }));

      // Calculate Agreed Price (Son Anlaşılan Net Fiyat)
      const prevOfferNum = Number(offerPrice) || 0;
      const prevAgreedNum = Number(agreedPrice) || 0;

      let extOfferPrice = prevOfferNum;
      if (offerType === 'first') {
        extOfferPrice = extractedData?.totalAmount || calculatedExcelTotal || 0;
      }

      let extAgreedPrice = prevAgreedNum;
      if (offerType === 'final') {
        extAgreedPrice = extractedData?.totalAmount || calculatedExcelTotal || 0;
      }

      const targetSupId =
        supervisorId ||
        user?.supervisorId ||
        activeSupervisors.find(s => s.name.toLowerCase().includes(user?.displayName?.toLowerCase() || ''))?.id ||
        activeSupervisors[0]?.id ||
        '';

      const targetJobId =
        jobsiteId ||
        user?.defaultJobsiteId ||
        activeJobsites[0]?.id ||
        '';

      if (targetSupId && !supervisorId) setSupervisorId(targetSupId);
      if (targetJobId && !jobsiteId) setJobsiteId(targetJobId);

      // BRANCH 1: FIRST OFFER DOCUMENT (LIGHTNING-FAST SUMMARY OCR)
      if (offerType === 'first') {
        if (extOfferPrice > 0) setOfferPrice(extOfferPrice.toString());
        if (finalVendor) setVendorName(finalVendor);
        if (finalCategory) setCategory(finalCategory);
        if (extractedData?.date) setOrderDate(extractedData.date);
        if (extractedData?.invoiceNumber) setInvoiceNo(extractedData.invoiceNumber);
        if (extractedData?.summary) setNotes(extractedData.summary);

        const detectedCount = Number(extractedData?.itemCount || extractedData?.itemsCount || 0);
        if (detectedCount > 0) {
          setFirstOfferItemCount(detectedCount);
        }

        setNotification({
          type: 'success',
          message: `⚡ [Hızlı İlk Teklif OCR] ${finalVendor || 'Tedarikçi'} | ${formatRuble(extOfferPrice)} | Toplam Kalem: ${detectedCount > 0 ? `${detectedCount} Kalem` : 'Tespit Edildi'} (Jet Hızında: Kalemler tek tek taranmadı, sistem yorulmadan üst bilgiler alındı!)`
        });
        return;
      }

      // BRANCH 2: FINAL DISCOUNTED INVOICE (FULL DEEP OCR WITH ALL LINE ITEMS & PRICE COMPARISON)
      if (offerType === 'final') {
        if (extAgreedPrice > 0) setAgreedPrice(extAgreedPrice.toString());
        if (finalVendor && !vendorName) setVendorName(finalVendor);
        if (finalCategory && !category) setCategory(finalCategory);
        if (extractedData?.summary && !notes) setNotes(extractedData.summary);
        if (formattedItems.length > 0) setExtractedItems(formattedItems);

        // Open AI Extracted Data Review & Approval Modal for the final invoice items
        setAiReviewModal({
          offerType,
          fileName: file.name,
          usedModel: usedModelName,
          supervisorId: targetSupId,
          jobsiteId: targetJobId,
          vendorName: finalVendor || vendorName,
          category: finalCategory || category,
          offerPrice: Number(offerPrice) || extOfferPrice,
          agreedPrice: extAgreedPrice,
          orderDate: extractedData?.date || orderDate || new Date().toISOString().split('T')[0],
          invoiceNo: extractedData?.invoiceNumber || invoiceNo || `FT-${Math.floor(100000 + Math.random() * 900000)}`,
          notes: extractedData?.summary || notes || 'Son indirimli fatura kalemleri yapay zeka ile taranıp sisteme bağlandı.',
          scopeDeductionAmount: Number(extractedData?.scopeDeductionAmount?.value || extractedData?.scopeDeductionAmount) || undefined,
          scopeDeductionReason: extractedData?.scopeDeductionReason?.value || extractedData?.scopeDeductionReason || undefined,
          items: formattedItems,
          rounds: negotiationRounds.length > 0 ? [...negotiationRounds] : []
        });

        // Item Count Discrepancy Check (Kalem Sayısı Kontrolü)
        const finalCount = formattedItems.length;
        if (firstOfferItemCount > 0 && finalCount > 0 && firstOfferItemCount !== finalCount) {
          const diff = Math.abs(firstOfferItemCount - finalCount);
          const isFewer = finalCount < firstOfferItemCount;
          setNotification({
            type: 'success',
            message: `✨ [Detaylı AI Fatura Okuma] ${finalCount} malzeme kalemi tarandı. ⚠️ DİKKAT: İlk teklifte ${firstOfferItemCount} kalem varken son faturada ${finalCount} kalem yer alıyor (${diff} kalem ${isFewer ? 'eksik / sepetten çıkarılmış olabilir' : 'ilave edilmiş'}). Gerçek birim fiyat indirimini kontrol ediniz.`
          });
        } else {
          setNotification({
            type: 'success',
            message: `✨ [Detaylı AI Fatura Okuma] ${formattedItems.length} malzeme kalemi ve birim fiyatları başarıyla analiz edildi! Malzeme Kıyaslama entegrasyonu için kontrol edin.`
          });
        }
      }
    } catch (error: any) {
      console.error('File processing error:', error);
      setNotification({
        type: 'error',
        message: 'Belge okunurken bir hata oluştu: ' + (error.message || 'Bilinmeyen hata')
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Helper to process document uploaded specifically to a negotiation round
  const processRoundDocument = async (file: File, roundIndex: number) => {
    setIsProcessingAI(true);
    setNotification(null);
    try {
      const base64Data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Save to server storage / vault
      const vaultRes = await uploadToServerVault(file.name, base64Data);

      // Lightweight OCR call for this round
      const res = await fetch('/api/discounts/process-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64: base64Data,
          mimeType: file.type || 'application/octet-stream',
          fileName: file.name,
          offerType: 'round',
          scanMode: 'summary-only'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Pazarlık turu belgesi okunamadı.');
      }

      const extracted = data.extracted;
      const readAmount = extracted?.totalAmount || 0;
      const readSupplier = extracted?.supplier || extracted?.vendorName || '';

      const updated = [...negotiationRounds];
      const targetRound = { ...updated[roundIndex] };
      targetRound.documentName = file.name;
      targetRound.documentUrl = vaultRes.url;
      if (readAmount > 0) {
        targetRound.quotedPrice = readAmount;
        if (targetRound.previousPrice && targetRound.previousPrice > readAmount) {
          targetRound.discountThisRound = targetRound.previousPrice - readAmount;
        }
      }
      if (readSupplier && (!vendorName || String(vendorName).trim() === '')) {
        setVendorName(readSupplier);
      }
      targetRound.note = targetRound.note
        ? `${targetRound.note} (${file.name} belgesinden ${formatRuble(readAmount)} okundu)`
        : `${file.name} belgesinden ${formatRuble(readAmount)} teklif tutarı okundu.`;

      updated[roundIndex] = targetRound;
      setNegotiationRounds(updated);

      setNotification({
        type: 'success',
        message: `⚡ [${targetRound.roundNumber}. Tur Belgesi Okundu] ${readSupplier || 'Tedarikçi'} | ${formatRuble(readAmount)} (Hafif OCR modu: Kalemler okunmadı, sistem yorulmadan kaydedildi)`
      });
    } catch (err: any) {
      console.error('Round document error:', err);
      setNotification({
        type: 'error',
        message: 'Tur belgesi okunurken hata oluştu: ' + (err.message || 'Bilinmeyen hata')
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Helper to resolve Sistem Arşivi URL or server URL for uploaded files
  const resolveFileUrl = async (fileObj: { name: string; url: string; base64?: string; fileId?: string } | null, fallbackName?: string) => {
    if (!fileObj) return { url: '', fileId: undefined };
    // If ALREADY uploaded to server vault (/api/files/...) or http, return instantly!
    if (fileObj.url && (fileObj.url.startsWith('/api/') || fileObj.url.startsWith('http'))) {
      return { url: fileObj.url, fileId: fileObj.fileId };
    }
    const b64 = fileObj.base64 || (fileObj.url && fileObj.url.startsWith('data:') ? fileObj.url : null);
    if (b64) {
      try {
        const res = await uploadToServerVault(fileObj.name || fallbackName || 'Belge.pdf', b64);
        if (res && res.url) {
          return { url: res.url, fileId: res.fileId };
        }
        throw new Error('Sunucu dosya bağlantısı oluşturulamadı.');
      } catch (uploadErr: any) {
        console.error('Direct upload in resolveFileUrl failed:', uploadErr);
        throw new Error(`Dosya sunucuya yüklenemedi: ${uploadErr.message || 'Bilinmeyen hata'}. Kayıt durduruldu. Veritabanına base64 gömülmesi engellendi.`);
      }
    }
    if (fileObj.url && fileObj.url.startsWith('data:')) {
      throw new Error('Yükleme başarısız olduğu için base64 kayda gömülemez. Lütfen dosyayı tekrar yükleyin.');
    }
    return { url: fileObj.url || '', fileId: fileObj.fileId };
  };

  // Handle First Offer File Upload
  const handleFirstOfferUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let base64Data: string | undefined = undefined;
    try {
      base64Data = await readFileOrCompressImage(file);
      setFirstOfferFileName(file.name);

      const res = await uploadToServerVault(file.name, base64Data);
      if (res && res.url) {
        setFirstOfferFile({ name: file.name, url: res.url, fileId: res.fileId });
      } else {
        throw new Error('Dosya sunucu adresi alınamadı');
      }
    } catch (err: any) {
      console.error('handleFirstOfferUpload failed:', err);
      setFirstOfferFile(null);
      setFirstOfferFileName('');
      alert(`KRİTİK HATA: İlk teklif belgesi yüklenemedi: ${err.message || 'Sunucu hatası'}. Dosya kayda eklenmedi.`);
      return;
    }

    await processOfferDocument(file, 'first', base64Data);
  };

  // Handle Final Offer / Invoice File Upload
  const handleFinalOfferUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let base64Data: string | undefined = undefined;
    try {
      base64Data = await readFileOrCompressImage(file);
      setFinalOfferFileName(file.name);

      const res = await uploadToServerVault(file.name, base64Data);
      if (res && res.url) {
        setFinalOfferFile({ name: file.name, url: res.url, fileId: res.fileId });
      } else {
        throw new Error('Dosya sunucu adresi alınamadı');
      }
    } catch (err: any) {
      console.error('handleFinalOfferUpload failed:', err);
      setFinalOfferFile(null);
      setFinalOfferFileName('');
      alert(`KRİTİK HATA: Son teklif/fatura belgesi yüklenemedi: ${err.message || 'Sunucu hatası'}. Dosya kayda eklenmedi.`);
      return;
    }

    await processOfferDocument(file, 'final', base64Data);
  };

  // Load 1-Click Demo Double Offer Preset
  const handleLoadDemoPreset = () => {
    setVendorName('Diler Demir Çelik A.Ş.');
    setCategory('İnşaat Demiri & Çelik');
    setOfferPrice('2450000');
    setAgreedPrice('1960000');
    setNotes('Peşin ödeme protokolü ve 100 Ton üzeri toplu sipariş taahhüdü ile %20 pazarlık indirimi elde edildi.');
    setFirstOfferFileName('1_Teklif_Diler_Celik_Gelen_Liste.pdf');
    setFinalOfferFileName('2_Son_Indirimli_Proforma_Fatura.xlsx');
    setFirstOfferFile({ name: '1_Teklif_Diler_Celik_Gelen_Liste.pdf', url: '1_Teklif_Diler_Celik_Gelen_Liste.pdf' });
    setFinalOfferFile({ name: '2_Son_Indirimli_Proforma_Fatura.xlsx', url: '2_Son_Indirimli_Proforma_Fatura.xlsx' });
    setInvoiceNo('FT-PAZARLIK-9920');
  };

  const [firstOfferFileName, setFirstOfferFileName] = useState<string>('');
  const [finalOfferFileName, setFinalOfferFileName] = useState<string>('');

  const executeSaveDiscount = async (bypass52Check = false) => {
    if (!supervisorId) {
      setNotification({ type: 'error', message: 'Lütfen işlemi gerçekleştiren Satınalma Şefini seçin.' });
      return;
    }
    if (!jobsiteId) {
      setNotification({ type: 'error', message: 'Lütfen indirimin sağlandığı Şantiyeyi seçin.' });
      return;
    }
    if (!String(vendorName).trim()) {
      setNotification({ type: 'error', message: 'Lütfen Tedarikçi Firma Adını girin.' });
      return;
    }
    if (numOffer <= 0 || numAgreed <= 0) {
      setNotification({ type: 'error', message: 'Lütfen geçerli İlk Teklif Fiyatı ve Son İndirimli Fiyatı yükleyin veya girin.' });
      return;
    }
    if (numAgreed > numOffer) {
      setNotification({ type: 'error', message: 'Anlaşılan Son Fiyat, İlk Teklif Fiyatından büyük olamaz.' });
      return;
    }

    const calcOffer = numOffer;
    const calcDeduction = numScopeDeduction;
    const calcAdjustedOffer = numAdjustedOffer;
    const calcBaseline = currentBaseline;
    let calcAgreed = numAgreed;
    const calcAmt = Math.max(0, calcBaseline - calcAgreed);
    const calcPct = calcBaseline > 0 ? Number(((calcAmt / calcBaseline) * 100).toFixed(2)) : 0;

    // GERÇEK TUR KONTROLÜ: Ara tur faturası/belgesi yüklenmiş veya notu girilmiş olan turlar geçerlidir
    const validRounds = (negotiationRounds || []).filter(r => {
      const qp = Number(r.quotedPrice) || 0;
      const hasDoc = Boolean(r.documentName || r.documentUrl || (r as any).documentFileName || (r as any).fileName);
      const hasNotes = Boolean(r.note || r.notes || r.date);
      return (hasDoc || hasNotes) && (qp > 0 ? qp <= calcBaseline : true);
    });

    const hasRounds = validRounds.length > 0;
    const finalCrossNegotiation = crossNegotiationApplied || (validRounds.length >= 2);

    const generatedInvoiceNo = String(invoiceNo).trim() || `FT-${Math.floor(100000 + Math.random() * 900000)}`;
    const firstDocName = firstOfferFile?.name || firstOfferFileName || '1_Ilk_Gelen_Teklif.pdf';
    const finalDocName = finalOfferFile?.name || finalOfferFileName || '2_Son_Indirimli_Teklif.xlsx';

    const selectedSup = activeSupervisors.find(s => s.id === supervisorId);
    const selectedJob = activeJobsites.find(j => j.id === jobsiteId);

    setIsProcessingAI(true);
    try {
      const firstUrl = await resolveFileUrl(firstOfferFile, firstDocName);
      const finalUrl = await resolveFileUrl(finalOfferFile, finalDocName);

      const generatedStageDocs: StageDocument[] = [];
      generatedStageDocs.push({
        stageNumber: 1,
        title: '1. İlk Teklif / Fatura',
        fileName: firstDocName,
        fileUrl: firstUrl.url,
        driveFileId: firstUrl.fileId,
        amount: calcOffer
      });

      if (validRounds.length === 0) {
        generatedStageDocs.push({
          stageNumber: 2,
          title: '2. İndirimli Fatura / Teklif',
          fileName: finalDocName,
          fileUrl: finalUrl.url,
          driveFileId: finalUrl.fileId,
          amount: calcAgreed,
          isFinal: true
        });
      } else {
        validRounds.forEach((r, idx) => {
          const stageNo = idx + 2;
          generatedStageDocs.push({
            stageNumber: stageNo,
            title: `${stageNo}. Ara İndirimli Teklif (Tur #${idx + 1})`,
            fileName: r.documentName || `${stageNo}_Ara_Teklif.pdf`,
            fileUrl: r.documentUrl,
            amount: Number(r.quotedPrice) || 0,
            roundIndex: idx,
            isFinal: false
          });
        });

        generatedStageDocs.push({
          stageNumber: validRounds.length + 2,
          title: `${validRounds.length + 2}. Nihai İndirimli Fatura`,
          fileName: finalDocName,
          fileUrl: finalUrl.url,
          driveFileId: finalUrl.fileId,
          amount: calcAgreed,
          isFinal: true
        });
      }

      await onSaveDiscount({
        supervisorId,
        performedByPersonnelId: performedByPersonnelId || undefined,
        jobsiteId,
        vendorName: String(vendorName).trim(),
        isNewVendor,
        category,
        offerPrice: calcOffer,
        scopeDeductionAmount: calcDeduction > 0 ? calcDeduction : undefined,
        scopeDeductionReason: calcDeduction > 0 ? String(scopeDeductionReason).trim() : undefined,
        adjustedOfferPrice: calcDeduction > 0 ? calcAdjustedOffer : calcOffer,
        agreedPrice: calcAgreed,
        orderDate,
        notes: notes.trim() || (calcDeduction > 0 ? `İlk tekliften ${formatRuble(calcDeduction)} düşülerek net indirim hesaplandı.` : 'Teklif belgeleri karşılaştırılarak otomatik kaydedildi.'),
        invoiceNo: generatedInvoiceNo,
        firstOfferFileName: firstDocName,
        firstOfferFileUrl: firstUrl.url,
        firstOfferDriveFileId: firstUrl.fileId,
        finalOfferFileName: finalDocName,
        finalOfferFileUrl: finalUrl.url,
        finalOfferDriveFileId: finalUrl.fileId,
        items: extractedItems.length > 0 ? extractedItems as any : undefined,
        negotiationRounds: validRounds.length > 0 ? validRounds : undefined,
        stageDocuments: generatedStageDocs,
        crossNegotiationApplied: isHighValue ? finalCrossNegotiation : false,
        finalNegotiationDate: finalNegotiationDate || orderDate
      });

      setSubmittedRecordSummary({
        supervisorName: selectedSup ? selectedSup.name : 'Satınalma Şefi',
        jobsiteName: selectedJob ? selectedJob.name : 'Şantiye',
        vendorName: String(vendorName).trim(),
        category,
        offerPrice: calcOffer,
        agreedPrice: calcAgreed,
        discountAmount: calcAmt,
        discountPercentage: calcPct,
        orderDate,
        invoiceNo: generatedInvoiceNo,
        firstOfferFileName: firstDocName,
        finalOfferFileName: finalDocName
      });

      setNotification({
        type: 'success',
        message: `${t('discountSuccessToast')} (+${formatRuble(calcAmt)} / %${calcPct})`
      });

      // Reset form fields
      setVendorName('');
      setOfferPrice('');
      setScopeDeductionAmount('');
      setScopeDeductionReason('');
      setAgreedPrice('');
      setNotes('');
      setInvoiceNo('');
      setFirstOfferFile(null);
      setFinalOfferFile(null);
      setFirstOfferFileName('');
      setFinalOfferFileName('');
      setExtractedItems([]);
      setPerformedByPersonnelId(user?.role === 'personnel' && user.personnelId ? user.personnelId : '');
      setNegotiationRounds([]);
      setCrossNegotiationApplied(false);
      setFinalNegotiationDate(new Date().toISOString().split('T')[0]);

      onSuccess();
    } catch (err: any) {
      console.error('Save discount error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Kayıt sırasında bir hata oluştu.'
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessingAI) return;
    await executeSaveDiscount(false);
  };

  const handleConfirmAndSavePendingRecord = async () => {
    if (!pendingReviewRecord || isProcessingAI) return;

    const selectedSup = activeSupervisors.find(s => s.id === pendingReviewRecord.supervisorId);
    const selectedJob = activeJobsites.find(j => j.id === pendingReviewRecord.jobsiteId);

    const calcOffer = Number(pendingReviewRecord.offerPrice) || 0;
    let calcAgreed = Number(pendingReviewRecord.agreedPrice) || 0;
    if (calcAgreed <= 0 && negotiationRounds.length > 0) {
      const lastRnd = negotiationRounds[negotiationRounds.length - 1];
      if (lastRnd.quotedPrice && lastRnd.quotedPrice > 0) {
        calcAgreed = Number(lastRnd.quotedPrice);
      }
    }
    const calcAmt = Math.max(0, calcOffer - calcAgreed);
    const calcPct = calcOffer > 0 ? Number(((calcAmt / calcOffer) * 100).toFixed(2)) : 0;

    setIsProcessingAI(true);
    try {
      const firstUrl = await resolveFileUrl(firstOfferFile, pendingReviewRecord.firstOfferFileName);
      const finalUrl = await resolveFileUrl(finalOfferFile, pendingReviewRecord.finalOfferFileName);

      await onSaveDiscount({
        supervisorId: pendingReviewRecord.supervisorId,
        performedByPersonnelId: performedByPersonnelId || undefined,
        jobsiteId: pendingReviewRecord.jobsiteId,
        vendorName: pendingReviewRecord.vendorName,
        isNewVendor: pendingReviewRecord.isNewVendor,
        category: pendingReviewRecord.category,
        offerPrice: calcOffer,
        agreedPrice: calcAgreed,
        orderDate: pendingReviewRecord.orderDate,
        notes: pendingReviewRecord.notes,
        invoiceNo: pendingReviewRecord.invoiceNo,
        firstOfferFileName: pendingReviewRecord.firstOfferFileName,
        firstOfferFileUrl: firstUrl.url,
        firstOfferDriveFileId: firstUrl.fileId,
        finalOfferFileName: pendingReviewRecord.finalOfferFileName,
        finalOfferFileUrl: finalUrl.url,
        finalOfferDriveFileId: finalUrl.fileId,
        items: pendingReviewRecord.items,
        negotiationRounds: negotiationRounds.length > 0 ? negotiationRounds : undefined,
        crossNegotiationApplied: isHighValue ? crossNegotiationApplied : false,
        finalNegotiationDate: finalNegotiationDate || pendingReviewRecord.orderDate
      });

      setSubmittedRecordSummary({
        supervisorName: selectedSup ? selectedSup.name : 'Satınalma Şefi',
        jobsiteName: selectedJob ? selectedJob.name : 'Şantiye',
        vendorName: pendingReviewRecord.vendorName,
        category: pendingReviewRecord.category,
        offerPrice: calcOffer,
        agreedPrice: calcAgreed,
        discountAmount: calcAmt,
        discountPercentage: calcPct,
        orderDate: pendingReviewRecord.orderDate,
        invoiceNo: pendingReviewRecord.invoiceNo,
        firstOfferFileName: pendingReviewRecord.firstOfferFileName,
        finalOfferFileName: pendingReviewRecord.finalOfferFileName
      });

      setNotification({
        type: 'success',
        message: `${t('discountSuccessToast')} (+${formatRuble(calcAmt)} / %${calcPct})`
      });

      // Reset form fields
      setVendorName('');
      setOfferPrice('');
      setAgreedPrice('');
      setNotes('');
      setInvoiceNo('');
      setFirstOfferFile(null);
      setFinalOfferFile(null);
      setFirstOfferFileName('');
      setFinalOfferFileName('');
      setExtractedItems([]);
      setPerformedByPersonnelId(user?.role === 'personnel' && user.personnelId ? user.personnelId : '');
      setNegotiationRounds([]);
      setCrossNegotiationApplied(false);
      setFinalNegotiationDate(new Date().toISOString().split('T')[0]);

      setPendingReviewRecord(null);
      onSuccess();
    } catch (err: any) {
      console.error('Save discount error:', err);
      setNotification({
        type: 'error',
        message: err.message || 'Kayıt sırasında bir hata oluştu.'
      });
    } finally {
      setIsProcessingAI(false);
    }
  };

  const categories = language === 'RU' ? [
    'Бетон и цемент',
    'Арматура и сталь',
    'Электрика и автоматика',
    'Сантехника и ОВК',
    'Изоляция и гипсокартон',
    'Плитка и санфаянс',
    'Краска и фасады',
    'Строительная химия',
    'Леса и опалубка',
    'Расходные материалы и инструменты',
    'Спецтехника и аренда',
    'Прочие материалы'
  ] : [
    'Hazır Beton & Çimento',
    'İnşaat Demiri & Çelik',
    'Elektrik & Otomasyon',
    'Mekanik & Tesisat',
    'Yalıtım & Alçıpan',
    'Seramik & Vitrifiye',
    'Boya & Dış Cephe',
    'Yapı Kimyasalları',
    'İskele & Kalıp',
    'Sarf Malzeme & Hırdavat',
    'İş Makinesi & Kiralama',
    'Diğer Malzeme'
  ];


  const uniqueSupervisors = useMemo(() => Array.from(new Set(discounts.map(d => d.supervisorName))).filter(Boolean).sort(), [discounts]);
  const uniqueJobsites = useMemo(() => Array.from(new Set(discounts.map(d => d.jobsiteName))).filter(Boolean).sort(), [discounts]);
  const canonicalDiscountVendors = useMemo(() => extractCanonicalVendors(discounts), [discounts]);
  const uniqueVendors = useMemo(() => canonicalDiscountVendors.map(c => c.name), [canonicalDiscountVendors]);
  return (
    <div className="w-full max-w-[1700px] mx-auto space-y-6 px-2 sm:px-4">
      {/* Success Notification Alert Card */}
      {notification && (
        <div
          className={`p-5 rounded-2xl flex items-start space-x-4 shadow-lg animate-in slide-in-from-top-4 duration-200 border ${
            notification.type === 'success'
              ? 'bg-gradient-to-r from-emerald-900 via-emerald-800 to-slate-900 text-white border-emerald-500/50'
              : 'bg-rose-900 text-white border-rose-500/50'
          }`}
        >
          {notification.type === 'success' ? (
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0">
              <AlertCircle className="w-6 h-6" />
            </div>
          )}
          <div className="flex-1">
            <h4 className="font-bold text-base text-white">{t('discountSuccessToast')}</h4>
            <p className="text-xs text-slate-300 mt-1">{notification.message}</p>
            <p className="text-[11px] text-emerald-300 font-mono mt-1 font-semibold">{t('discountSuccessSub')}</p>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-white p-1 rounded-lg text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Banner (Only shown in full page tab) */}
      {!isModal && (
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-lg flex items-center justify-center shrink-0">
              <GesLogo size="md" showTagline={true} variant="blue" />
            </div>
            <div>
              <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                <Coins className="w-4 h-4 text-amber-400" />
                <span>GES CONSTRUCTION — {t('formTitle')}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-100">{t('formTitle')}</h1>
              <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xl">
                {t('formDesc')}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="bg-slate-800/90 border border-slate-700/80 p-3.5 rounded-xl text-center min-w-48 shadow-inner">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">{t('earnedDiscount')}</p>
              <p className="text-2xl font-black text-emerald-400 font-mono mt-0.5">
                +{formatRuble(totalSystemDiscount)}
              </p>
              <div className="flex items-center justify-center space-x-2 mt-1">
                <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  %{totalSystemPercentage} {t('discountRatio')}
                </span>
              </div>
            </div>

            {currentFormDiscount > 0 && (
              <div className="bg-indigo-950/90 border border-indigo-500/40 p-3.5 rounded-xl text-center min-w-44 shadow-inner animate-in fade-in duration-200">
                <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-wide">
                  {language === 'RU' ? 'Скидка по текущей форме' : 'Bu Formdaki İndirim'}
                </p>
                <p className="text-xl font-black text-amber-300 font-mono mt-0.5">
                  +{formatRuble(currentFormDiscount)}
                </p>
                <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 mt-1 border border-emerald-500/30">
                  %{currentFormPercentage} İskonto
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode Switcher */}
      <div className="flex items-center space-x-2 bg-slate-200/80 p-1 rounded-xl w-fit">
        <button
          onClick={() => setEntryMode('auto-offers')}
          className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer ${
            entryMode === 'auto-offers'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>{t('autoUploadModeBtn')}</span>
        </button>

        <button
          onClick={() => setEntryMode('manual')}
          className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer ${
            entryMode === 'manual'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calculator className="w-4 h-4 text-indigo-600" />
          <span>{t('manualModeBtn')}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsComparativeModalOpen(true)}
          className="px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer bg-gradient-to-r from-indigo-600 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900 text-white shadow-sm border border-indigo-500/30"
          title={language === 'ru' ? 'Для закупок от 1 000 000 ₽: расчет реальной экономии на основе единичных расценок нескольких КП' : '1.000.000 ₽ ve üzeri alımlar için: En az 2 tedarikçinin ilk teklif birim fiyatlarına göre gerçek piyasa tasarrufu hesapla'}
        >
          <Layers className="w-4 h-4 text-indigo-200" />
          <span>{language === 'ru' ? '1M+ ₽ Сравнительный анализ (TDF)' : '1M+ ₽ Karşılaştırmalı Teklif (TDF)'}</span>
          <span className="bg-amber-400 text-slate-900 text-[10px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tight">Yeni Standart</span>
        </button>
      </div>

      {/* Main Form Box */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm space-y-6">
        {/* Step 1: Supervisor, Personnel (GOL/ASIST) and Jobsite Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pb-6 border-b border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
              <UserCheck className="w-4 h-4 text-indigo-600" />
              <span>{t('supervisorLabel')} (Sorumlu Şef)</span>
            </label>
            <select
              value={supervisorId}
              onChange={(e) => {
                setSupervisorId(e.target.value);
                // If selected personnel does not belong to new supervisor, reset personnel
                const pers = activePersonnel.find(p => p.id === performedByPersonnelId);
                if (pers && pers.supervisorId !== e.target.value) {
                  setPerformedByPersonnelId('');
                }
              }}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer"
            >
              {activeSupervisors.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.title})</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Pazarlığı Yapan Personel</span>
              </label>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                !performedByPersonnelId 
                  ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                  : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
              }`}>
                {!performedByPersonnelId ? '🎯 GOL (Şef Kendisi)' : '🤝 ASİST (Personel)'}
              </span>
            </div>
            <select
              value={performedByPersonnelId}
              onChange={(e) => setPerformedByPersonnelId(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm font-semibold focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer"
            >
              <option value="">🎯 Şef Kendisi Yaptı (GOL - İndirim Şefin Hesabına)</option>
              {availablePersonnel.map(p => (
                <option key={p.id} value={p.id}>
                  🤝 {p.name} ({p.title || 'Satınalma Personeli'}) — ASİST
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              {!performedByPersonnelId 
                ? 'Pazarlığı şef kendisi yürüttü. Doğrudan şef performans hanesine GOL yazılır.'
                : 'Pazarlık personeli tarafından yapıldı. Şefe ASİST, personele efor & başarı puanı yazılır.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-amber-600" />
              <span>{t('jobsiteLabel')}</span>
            </label>
            <select
              value={jobsiteId}
              onChange={(e) => setJobsiteId(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer"
            >
              {activeJobsites.map(j => (
                <option key={j.id} value={j.id}>{j.name}{j.location ? ` (${j.location})` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                {t('vendorLabel')}
              </label>
              <span className="text-[10px] text-slate-400 font-semibold">
                Akıllı Otomatik Tamamlama & Yazım Düzeltme
              </span>
            </div>
            <input
              type="text"
              list="canonical-vendors-datalist"
              placeholder={t('vendorPlaceholder')}
              value={vendorName}
              onChange={(e) => {
                const val = e.target.value;
                setVendorName(val);
                const k = getVendorKey(val);
                if (k && (registeredVendorKeys.has(k) || registeredVendorNames.has(val.trim().toLowerCase()))) {
                  setIsNewVendor(false);
                }
              }}
              onBlur={() => {
                if (vendorName.trim()) {
                  const norm = normalizeVendorName(vendorName);
                  setVendorName(norm);
                  const k = getVendorKey(norm);
                  if (k && (registeredVendorKeys.has(k) || registeredVendorNames.has(norm.toLowerCase()))) {
                    setIsNewVendor(false);
                  }
                }
              }}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none font-semibold"
            />
            <datalist id="canonical-vendors-datalist">
              {canonicalVendorsList.map((v) => (
                <option key={v.key} value={v.name}>
                  {v.name} ({v.count} kayıt)
                </option>
              ))}
            </datalist>

            {(() => {
              const k = getVendorKey(vendorName);
              const isKnown = Boolean(
                vendorName.trim().length > 1 &&
                (registeredVendorKeys.has(k) || registeredVendorNames.has(vendorName.trim().toLowerCase()))
              );

              return isKnown ? (
                <div className="mt-2 text-[11px] font-semibold text-slate-600 bg-slate-100 p-2.5 rounded-lg border border-slate-200 flex items-center space-x-1.5">
                  <span className="text-slate-400 text-sm">🏢</span>
                  <span className="leading-tight">
                    Kayıtlı Tedarikçi: <strong className="text-slate-900">{normalizeVendorName(vendorName)}</strong> GES portföyünde mevcut (Eski Firma). Yeni firma ekstra puanı uygulanamaz.
                  </span>
                </div>
              ) : (
                <div className="mt-2.5 flex items-center space-x-2.5 bg-indigo-50/70 p-2.5 rounded-lg border border-indigo-200">
                  <input
                    type="checkbox"
                    id="isNewVendor"
                    checked={isNewVendor}
                    onChange={(e) => setIsNewVendor(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="isNewVendor" className="text-[11px] font-bold text-indigo-900 cursor-pointer leading-tight flex-1">
                    🚀 Tedarikçi Ağına Eklenen YENİ FİRMA <span className="font-medium text-indigo-700 ml-1 block sm:inline">(Portföyde yoksa +Ekstra Efor Puanı)</span>
                  </label>
                </div>
              );
            })()}
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              {t('categoryLabel')}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none cursor-pointer"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        </div>

        {/* MODE 1: AUTOMATIC DUAL OFFER UPLOAD */}
        {entryMode === 'auto-offers' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-indigo-50/70 p-4 rounded-xl border border-indigo-100">
              <div>
                <h3 className="font-extrabold text-indigo-900 text-sm flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>{t('dualUploadTitle')}</span>
                </h3>
                <p className="text-xs text-indigo-700 mt-0.5">
                  {t('dualUploadSub')}
                </p>
              </div>

              <button
                type="button"
                onClick={handleLoadDemoPreset}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>{t('loadDemoPresetBtn')}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Box 1: First Offer Document */}
              <div className="bg-slate-50 p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 transition-all space-y-3 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span>{t('firstOfferDocTitle')}</span>
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                    PDF, Excel, Photo
                  </span>
                </div>

                <div className="border border-slate-200 bg-white rounded-xl p-4 text-center cursor-pointer hover:bg-slate-50 transition-colors relative">
                  <input
                    type="file"
                    accept="image/*,.pdf,.xlsx,.xls,.csv"
                    onChange={handleFirstOfferUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {firstOfferFile ? (
                    <div className="flex items-center justify-between text-xs text-slate-800 font-bold">
                      <div className="flex items-center space-x-2 truncate">
                        <FileCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="truncate">{firstOfferFile.name}</span>
                      </div>
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {t('uploadedBadge')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">{t('dragFirstOffer')}</p>
                      <p className="text-[10px] text-slate-400">{t('firstOfferSub')}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      {t('firstOfferAmountLabel')}
                    </label>
                    {firstOfferItemCount > 0 && (
                      <span className="text-[10px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
                        📋 {firstOfferItemCount} Kalem Tespit Edildi
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    placeholder="1850000"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl font-mono font-bold text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Box 2: Final Agreed Offer Document */}
              <div className="bg-emerald-50/50 p-5 rounded-2xl border-2 border-dashed border-emerald-300 hover:border-emerald-400 transition-all space-y-3 relative">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-emerald-900 tracking-wider flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                    <span>{t('finalOfferDocTitle')}</span>
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {t('postBargainBadge')}
                  </span>
                </div>

                <div className="border border-emerald-200 bg-white rounded-xl p-4 text-center cursor-pointer hover:bg-emerald-50/30 transition-colors relative">
                  <input
                    type="file"
                    accept="image/*,.pdf,.xlsx,.xls,.csv"
                    onChange={handleFinalOfferUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  {finalOfferFile ? (
                    <div className="flex items-center justify-between text-xs text-slate-800 font-bold">
                      <div className="flex items-center space-x-2 truncate">
                        <FileCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="truncate">{finalOfferFile.name}</span>
                      </div>
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {t('uploadedBadge')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-6 h-6 text-emerald-500 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">{t('dragFinalOffer')}</p>
                      <p className="text-[10px] text-emerald-600 font-medium">{t('finalOfferSub')}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      {t('finalOfferAmountLabel')}
                    </label>
                    {extractedItems.length > 0 && (
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                        ✨ {extractedItems.length} Kalem Tarandı
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    placeholder="1480000"
                    value={agreedPrice}
                    onChange={(e) => handleAgreedPriceChange(e.target.value)}
                    className="w-full py-2 px-3 bg-white border border-emerald-300 rounded-xl font-mono font-extrabold text-emerald-700 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Smart Item Count Comparison Indicator */}
            {firstOfferItemCount > 0 && extractedItems.length > 0 && (
              <div className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
                firstOfferItemCount === extractedItems.length
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}>
                <div className="flex items-center space-x-2">
                  {firstOfferItemCount === extractedItems.length ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>
                    {firstOfferItemCount === extractedItems.length ? (
                      `Kalem Sayısı Tam Eşleşti: İlk teklif (${firstOfferItemCount} kalem) ve son fatura (${extractedItems.length} kalem) birebir uyumlu.`
                    ) : (
                      `Kalem Sayısı Farkı: İlk teklifte ${firstOfferItemCount} kalem varken son faturada ${extractedItems.length} kalem tespit edildi (${Math.abs(firstOfferItemCount - extractedItems.length)} kalem ${extractedItems.length < firstOfferItemCount ? 'eksik / sepetten çıkarılmış olabilir' : 'ilave edilmiş'}).`
                    )}
                  </span>
                </div>
                {firstOfferItemCount !== extractedItems.length && (
                  <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded shrink-0 ml-2">
                    Kapsamı Kontrol Edin
                  </span>
                )}
              </div>
            )}

              {/* Scope Deduction Panel (Sepetten Çıkarılan / İptal Edilen Kalemler) */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-900">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Kapsam Düşümü / Sepetten Çıkarılan Kalemler (Opsiyonel)</span>
                  </div>
                  {numScopeDeduction > 0 && (
                    <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
                      Düzeltilmiş Teklif: {formatRuble(numAdjustedOffer)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-amber-800 leading-snug">
                  İlk teklifte yer alan ancak son faturada alımdan vazgeçilip sepetten çıkarılan ürün varsa tutarını girin. Gerçek net indiriminiz doğru hesaplansın.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold text-amber-900 mb-0.5">Çıkarılan Kalem Tutarı (₽)</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={scopeDeductionAmount}
                      onChange={(e) => setScopeDeductionAmount(e.target.value)}
                      className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-amber-950 font-bold text-xs focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-amber-900 mb-0.5">Çıkarılma Nedeni / Malzeme Adı</label>
                    <input
                      type="text"
                      placeholder="Örn: 17.939,86 ₽ değerindeki çay kalemi son faturada sepetten çıkarıldı"
                      value={scopeDeductionReason}
                      onChange={(e) => setScopeDeductionReason(e.target.value)}
                      className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              </div>

            {/* Live Comparison Result Card */}
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-5 rounded-2xl border border-slate-800 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase text-amber-400 tracking-wider flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Firestore Veritabanı Otomatik Arşivleme Aktif</span>
                </span>
                <p className="text-sm font-extrabold text-slate-100">
                  {vendorName ? `${vendorName}` : t('formTitle')}
                </p>
                <p className="text-xs text-slate-300">
                  {numScopeDeduction > 0
                    ? `Kapsam Düşümü Aktif: ${formatRuble(numOffer)} - ${formatRuble(numScopeDeduction)} = ${formatRuble(numAdjustedOffer)} düzeltilmiş teklif üzerinden net indirim hesaplandı.`
                    : 'Tüm teklifler ve fatura belgeleri Firestore veritabanına ve sunucuya yüksek güvenlikli olarak kaydedilir.'}
                </p>
              </div>

              <div className="flex items-center space-x-4 bg-slate-800/80 p-3 rounded-xl border border-slate-700 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-medium">{t('netSavedDiscount')}</span>
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    +{formatRuble(currentFormDiscount)}
                  </span>
                </div>
                <div className="pl-3 border-l border-slate-700 text-center">
                  <span className="text-[10px] text-slate-400 block font-medium">{t('discountRatio')}</span>
                  <span className="text-base font-black text-amber-300 font-mono">
                    %{currentFormPercentage}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MODE 2: MANUAL ENTRY */}
        {entryMode === 'manual' && (
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
            <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
              <Coins className="w-4 h-4 text-emerald-600" />
              <span>{t('manualSectionTitle')}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t('firstOfferListPriceLabel')}
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-white border border-slate-300 rounded-xl text-slate-900 font-bold text-base focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t('agreedPrice')} *
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={agreedPrice}
                  onChange={(e) => handleAgreedPriceChange(e.target.value)}
                  className="w-full py-2.5 px-3.5 bg-white border border-slate-300 rounded-xl text-emerald-700 font-extrabold text-base focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Common Fields: Date, InvoiceNo, Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              <span>{t('orderDateLabel')} *</span>
            </label>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center space-x-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <span>{t('invoiceNumber')}</span>
            </label>
            <input
              type="text"
              placeholder="FT-PAZARLIK-9920"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              {t('optionalNotesLabel')}
            </label>
            <textarea
              rows={2}
              placeholder={t('notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full py-2.5 px-3.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* SECTION 4: PAZARLIK TURLARI & EFOR TAKİBİ */}
        <div className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-700">
                  <Target className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
                    <span>Pazarlık Turları & Efor Katsayısı Takibi</span>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                      {negotiationRounds.length > 0 ? `${negotiationRounds.length} Ara Tur` : 'Doğrudan Teklif (0 Ara Tur)'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tedarikçiyle yürütülen resmi ara indirim turlarını (her biri için ara teklif/fatura belgesi yükleyerek) kaydedin. Çoklu turlar şef puanını tur başına <strong>+%25</strong> artırır.
                  </p>
                </div>
              </div>
            </div>

            {/* Top Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleAddRound}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-2xs transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Ara Tur Ekle</span>
              </button>

              {negotiationRounds.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearRounds}
                  className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  title="Tüm turları silip doğrudan tek turlu anlaşmaya döner"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Sıfırla</span>
                </button>
              )}
            </div>
          </div>

          {/* Visual Negotiation Funnel / Step Flow */}
          {negotiationRounds.length > 0 && (
            <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                  <TrendingDown className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Pazarlık Süreci & İndirim Basamakları</span>
                </span>
                <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Toplam Net İndirim: +{formatRuble(currentFormDiscount)} (%{currentFormPercentage})
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Stage 1: Initial Baseline */}
                <div className="p-2 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">1. İlk Teklif / Fatura</div>
                  <div className="font-mono font-bold text-slate-900">{formatRuble(currentBaseline)}</div>
                </div>

                {/* Additional Stages: 2. Ara İndirimli Fatura, 3. Ara İndirimli Fatura, etc. */}
                {negotiationRounds.map((rnd, idx) => {
                  const stageNo = idx + 2;
                  return (
                    <React.Fragment key={rnd.id || idx}>
                      <div className="text-slate-400 font-bold">➔</div>
                      <div className="p-2 rounded-lg shrink-0 border bg-indigo-50/70 border-indigo-200">
                        <div className="flex items-center justify-between text-[10px] font-bold">
                          <span className="text-indigo-900">
                            {stageNo}. Ara Teklif (Tur #{idx + 1})
                          </span>
                          <span className="text-emerald-700 font-mono ml-1.5">-{formatRuble(rnd.discountThisRound || 0)}</span>
                        </div>
                        <div className="font-mono font-extrabold text-indigo-950">
                          {formatRuble(rnd.quotedPrice || 0)}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}

                {/* Terminal Stage: Nihai Fatura */}
                <div className="text-slate-400 font-bold">➔</div>
                <div className="p-2 bg-emerald-50 border border-emerald-300 rounded-lg shrink-0">
                  <div className="text-[10px] text-emerald-900 font-bold uppercase">{negotiationRounds.length + 2}. Nihai İndirimli Fatura</div>
                  <div className="font-mono font-bold text-emerald-700">{formatRuble(effectiveAgreedPrice)}</div>
                </div>
              </div>
            </div>
          )}

          {negotiationRounds.length === 0 ? (
            <div className="p-5 bg-white rounded-xl border border-dashed border-slate-300 flex flex-col sm:flex-row items-center gap-4 text-left">
              <div className="p-3 bg-amber-50 rounded-xl text-amber-600 shrink-0">
                <Award className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-slate-800">
                  Doğrudan Teklifte Anlaşma (0 Ara Tur - Standart Efor)
                </h4>
                <p className="text-xs text-slate-500">
                  Tedarikçiyle ilk teklif ve nihai fatura arasında resmi ara pazarlık belgeleri (revize teklifler) bulunmuyorsa doğrudan anlaşma geçerlidir. Ara turlar yalnızca fiziksel fatura/teklif belgesi yüklendiğinde sisteme tur olarak işlenir.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              {negotiationRounds.map((round, idx) => {
                const roundPct = round.previousPrice && round.previousPrice > 0
                  ? Number((((round.discountThisRound || 0) / round.previousPrice) * 100).toFixed(1))
                  : 0;

                return (
                  <div key={round.id || idx} className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-black text-indigo-900 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200 flex items-center space-x-1.5">
                          <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">
                            {idx + 3}
                          </span>
                          <Target className="w-3.5 h-3.5 text-indigo-600" />
                          <span>{idx + 3}. İndirimli Fatura / Teklif (Aşama #{idx + 3})</span>
                        </span>
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          Bu Tur Kazanç: +{formatRuble(round.discountThisRound || 0)} (%{roundPct})
                        </span>
                        {round.documentName && (
                          <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 flex items-center space-x-1">
                            <FileText className="w-3 h-3 text-slate-500" />
                            <span className="truncate max-w-[130px]">{round.documentName}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-3">
                        {/* Fast 1-Click Discount Presets */}
                        <div className="flex items-center space-x-1">
                          <span className="text-[10px] font-bold text-slate-400 hidden sm:inline">Hızlı:</span>
                          {[3, 5, 8, 10, 15].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => {
                                const base = round.previousPrice || Number(offerPrice) || 0;
                                if (base <= 0) return;
                                const disc = Math.round(base * (pct / 100));
                                const newQuoted = Math.max(0, base - disc);
                                handleUpdateRound(idx, 'quotedPrice', newQuoted);
                              }}
                              className="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300 text-slate-700 border border-slate-200 rounded-md text-[11px] font-bold transition-colors cursor-pointer"
                            >
                              -%{pct}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveRound(idx)}
                          className="text-slate-400 hover:text-rose-600 text-xs font-bold transition-colors cursor-pointer flex items-center space-x-1 pl-1"
                          title="Turu Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Sil</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Pazarlık Tarihi</label>
                        <input
                          type="date"
                          value={round.date}
                          onChange={(e) => handleUpdateRound(idx, 'date', e.target.value)}
                          className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Tur Öncesi Tutar (₺)</label>
                        <input
                          type="number"
                          value={round.previousPrice || ''}
                          onChange={(e) => handleUpdateRound(idx, 'previousPrice', Number(e.target.value))}
                          className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-800 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-emerald-800 mb-1">Tur Sonrası Fiyat (₺)</label>
                        <input
                          type="number"
                          value={round.quotedPrice || ''}
                          onChange={(e) => handleUpdateRound(idx, 'quotedPrice', Number(e.target.value))}
                          className="w-full py-1.5 px-2.5 bg-emerald-50/50 border border-emerald-300 rounded-lg text-xs font-mono font-black text-emerald-800 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Bu Tur İndirimi (₺)</label>
                        <input
                          type="number"
                          value={round.discountThisRound || ''}
                          onChange={(e) => handleUpdateRound(idx, 'discountThisRound', Number(e.target.value))}
                          className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-emerald-700 focus:bg-white focus:outline-none"
                          placeholder="0"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Pazarlık Notu / Görüşülen Yetkili</label>
                        <input
                          type="text"
                          placeholder="Örn: Satış direktörüyle görüşüldü, peşin ödeme teklifiyle ek %5 indirim alındı."
                          value={round.note || ''}
                          onChange={(e) => handleUpdateRound(idx, 'note', e.target.value)}
                          className="w-full py-1.5 px-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">Tur Belgesi (⚡ Hafif OCR)</label>
                        <label className="flex items-center justify-center space-x-1.5 py-1.5 px-2.5 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-800 cursor-pointer transition-colors">
                          <Upload className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="truncate">{round.documentName ? 'Belgeyi Değiştir' : 'Belge Yükle'}</span>
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) processRoundDocument(f, idx);
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Downward Connector to Final Invoice */}
              <div className="flex justify-center -my-1">
                <div className="w-6 h-6 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-700 text-xs font-black shadow-2xs">
                  ↓
                </div>
              </div>

              {/* TERMINAL STAGE: Son Tur Sonrası Fatura */}
              <div className="p-4 bg-emerald-50/80 rounded-xl border-2 border-emerald-300 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-700 text-white text-xs font-black flex items-center justify-center shrink-0">
                      {negotiationRounds.length + 2}
                    </span>
                    <div>
                      <span className="font-black text-xs text-emerald-950 flex items-center space-x-1.5">
                        <span>{negotiationRounds.length + 2}. Son Tur Sonrası Fatura</span>
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200">
                          {negotiationRounds.length + 1}. İndirimli Hali (Nihai Belge)
                        </span>
                      </span>
                      <p className="text-[11px] text-emerald-700">
                        Tüm pazarlık turları sonrası varılan son mutabakat ve nihai onaylı fatura/sipariş belgesi
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-emerald-800 font-bold">Nihai Fiyat:</span>
                    <span className="font-mono font-black text-emerald-900 text-base">
                      {formatRuble(effectiveAgreedPrice)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-200/80 text-xs">
                  <div className="flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-emerald-900 font-medium">Son İndirimli Fatura Belgesi:</span>
                    {finalOfferFile ? (
                      <span className="font-bold text-emerald-950 truncate max-w-[220px]">
                        {finalOfferFile.name}
                      </span>
                    ) : (
                      <span className="text-amber-800 italic bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        Son fatura belgesi henüz yüklenmedi
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    {finalOfferFile?.url && (
                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(finalOfferFile.url, finalOfferFile.name)}
                        className="px-2.5 py-1.5 bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg text-xs font-bold flex items-center space-x-1 cursor-pointer transition-colors shadow-2xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Görüntüle</span>
                      </button>
                    )}
                    <label className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer transition-colors shadow-2xs">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{finalOfferFile ? 'Son Faturayı Değiştir' : '+ Son Faturayı Yükle'}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf,.xlsx,.xls,.csv"
                        onChange={handleFinalOfferUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Live Negotiation Rounds Summary Banner */}
              <div className="p-3.5 bg-gradient-to-r from-indigo-50 via-slate-50 to-indigo-50 border border-indigo-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-bold text-indigo-900 flex items-center space-x-1">
                    <Target className="w-4 h-4 text-indigo-600" />
                    <span>Pazarlık Özeti:</span>
                  </span>
                  <span className="text-slate-600">Nihai Anlaşılan Fiyat:</span>
                  <span className="font-mono font-black text-emerald-700 text-sm">
                    {formatRuble(effectiveAgreedPrice)}
                  </span>
                  <span className="text-slate-500 font-sans">
                    (Kazanılan Toplam Net Tasarruf: <strong className="text-emerald-800 font-mono font-black">+{formatRuble(currentFormDiscount)}</strong> / <strong className="text-emerald-800">%{currentFormPercentage}</strong>)
                  </span>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-950 font-bold font-mono text-[11px] border border-indigo-300 flex items-center space-x-1">
                    <Award className="w-3.5 h-3.5 text-indigo-700" />
                    <span>{negotiationRounds.length} Tur Kayıtlı • {(1 + 0.25 * negotiationRounds.length).toFixed(2)}x Efor Katsayısı (+%{25 * negotiationRounds.length} Puan)</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 5: ÇAPRAZ PAZARLIK VE İKİNCİ GÖRÜŞME */}
        {isHighValue && (
          <div className="p-5 bg-gradient-to-br from-indigo-500/10 via-indigo-500/5 to-slate-900/5 rounded-2xl border border-indigo-300 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-800 flex items-center justify-center shrink-0 border border-indigo-300">
                  <ShieldCheck className="w-6 h-6 text-indigo-700" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                      Çapraz Pazarlık ve İkinci Görüşme Bilgisi
                    </h3>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-200 text-indigo-900 border border-indigo-300">
                      ≥ 1.000.000 ₺ Yüksek Tutar
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Yüksek bütçeli alımlarda birden fazla yetkili veya bağımsız pazarlık turu yürütüldüyse işaretleyiniz.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-indigo-200">
              <label className="flex items-start space-x-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={crossNegotiationApplied}
                  onChange={(e) => setCrossNegotiationApplied(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900 block">Çapraz Pazarlık Uygulandı</span>
                  <span className="text-[11px] text-slate-500">
                    Farklı bir satınalmacı veya yetkili tarafından ikinci bir bağımsız pazarlık görüşmesi yapıldı.
                  </span>
                </div>
              </label>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">Son Pazarlık / Karar Tarihi</label>
                <input
                  type="date"
                  value={finalNegotiationDate}
                  onChange={(e) => setFinalNegotiationDate(e.target.value)}
                  className="w-full py-1.5 px-3 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <HardDrive className="w-4 h-4 text-emerald-600" />
            <span>{t('autoArchiveNote')}</span>
          </div>

          <button
            type="submit"
            disabled={isProcessingAI}
            className="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-extrabold px-6 py-3 rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isProcessingAI ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-emerald-300" />
                <span>Sisteme Kaydediliyor...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>{t('saveDiscountBtn')}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Recent Discount Records List with Edit Option */}
      {discounts && (
        <div id="recent-discounts-section" className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center space-x-2">
                <Coins className="w-5 h-5 text-amber-500" />
                <span>Kayıtlı İndirimler & Şef Pazarlıkları ({discounts.length})</span>
              </h2>
              <p className="text-xs text-slate-500">Yanlış girilen şantiye, şef veya tutarları "Düzenle" butonuna basarak düzeltebilir, silinen kayıtları çöp kutusuna taşıyabilirsiniz.</p>
            </div>
            
            {/* Search Input Bar & Fatura No Filter */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Şef, Şantiye, Tedarikçi Ara..."
                  className="w-full pl-9 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="relative w-36">
                <FileText className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tableFilters.invoiceNo}
                  onChange={(e) => setTableFilters(prev => ({ ...prev, invoiceNo: e.target.value }))}
                  placeholder="Fatura No..."
                  className="w-full pl-8 pr-6 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                {tableFilters.invoiceNo && (
                  <button
                    onClick={() => setTableFilters(prev => ({ ...prev, invoiceNo: '' }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {isAnyTableFilterActive && (
                <button
                  type="button"
                  onClick={handleResetTableFilters}
                  className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shrink-0 shadow-2xs"
                  title="Filtreleri Temizle"
                >
                  <X className="w-3.5 h-3.5 text-amber-700" />
                  <span>Filtreleri Temizle</span>
                </button>
              )}
            </div>
          </div>

          {discounts.length === 0 ? (
            <div className="text-center py-8 px-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
              <Coins className="w-8 h-8 text-amber-400 mx-auto opacity-60" />
              <p className="text-sm font-bold text-slate-700">Henüz kaydedilmiş bir indirim bulunmuyor.</p>
              <p className="text-xs text-slate-500">Yukarıdaki formu kullanarak 1. gelen teklif ve 2. son anlaşılan fatura tutarlarını girip kaydedebilirsiniz.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-xs sm:text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10 select-none">
                    <th className="py-2.5 px-3">
                      <div className="flex flex-col space-y-1">
                        <div 
                          onClick={() => setDateSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                          className="flex items-center space-x-1.5 cursor-pointer hover:text-indigo-600 transition-colors whitespace-nowrap"
                          title="Sıralamak için tıklayın (Yeniden Eskiye / Eskiden Yeniye)"
                        >
                          <span>Yükleme Tarihi</span>
                          <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${dateSortOrder === 'asc' ? 'text-indigo-600 rotate-180' : 'text-slate-500'}`} />
                        </div>
                        <DateRangeFilterDropdown
                          value={tableFilters.date}
                          onChange={d => setTableFilters(prev => ({ ...prev, date: d }))}
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3">
                      <div className="flex flex-col space-y-1">
                        <span className="text-[11px] font-bold text-slate-700">Satınalma Şefi</span>
                        <SearchableFilterDropdown
                          label="Şef"
                          selectedKey={tableFilters.supervisor}
                          options={[
                            { key: 'all', label: 'Tüm Şefler', count: discounts.length },
                            ...uniqueSupervisors.map(sup => ({
                              key: sup,
                              label: sup,
                              count: discounts.filter(d => d.supervisorName === sup).length
                            }))
                          ]}
                          onSelect={key => setTableFilters(prev => ({ ...prev, supervisor: key }))}
                          placeholder="Şef ara..."
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3">
                      <div className="flex flex-col space-y-1">
                        <span className="text-[11px] font-bold text-slate-700">Şantiye</span>
                        <SearchableFilterDropdown
                          label="Şantiye"
                          selectedKey={tableFilters.jobsite}
                          options={[
                            { key: 'all', label: 'Tüm Şantiyeler', count: discounts.length },
                            ...uniqueJobsites.map(j => ({
                              key: j,
                              label: j,
                              count: discounts.filter(d => d.jobsiteName === j).length
                            }))
                          ]}
                          onSelect={key => setTableFilters(prev => ({ ...prev, jobsite: key }))}
                          placeholder="Şantiye ara..."
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3">
                      <div className="flex flex-col space-y-1">
                        <span className="text-[11px] font-bold text-slate-700">Tedarikçi</span>
                        <SearchableFilterDropdown
                          label="Tedarikçi"
                          selectedKey={tableFilters.vendor}
                          options={[
                            { key: 'all', label: 'Tüm Tedarikçiler', count: discounts.length },
                            ...canonicalDiscountVendors.map(v => ({
                              key: v.name,
                              label: v.name,
                              count: v.count
                            }))
                          ]}
                          onSelect={key => setTableFilters(prev => ({ ...prev, vendor: key }))}
                          placeholder="Tedarikçi ara..."
                        />
                      </div>
                    </th>
                    <th className="py-2.5 px-3">Tutar (₽)</th>
                    <th className="py-2.5 px-3 text-emerald-700">Net İndirim</th>
                    <th className="py-2.5 px-3 text-center">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {discounts
                    .filter((d) => {
                      if (tableFilters.supervisor !== 'all' && d.supervisorName !== tableFilters.supervisor) return false;
                      if (tableFilters.jobsite !== 'all' && d.jobsiteName !== tableFilters.jobsite) return false;
                      if (tableFilters.vendor !== 'all' && !areVendorsEqual(d.vendorName, tableFilters.vendor)) return false;
                      if (tableFilters.invoiceNo.trim() && !String(d.invoiceNo || '').toLowerCase().includes(tableFilters.invoiceNo.toLowerCase().trim())) return false;
                      if (!matchesDateFilter(d.orderDate || d.createdAt, tableFilters.date)) return false;
                      if (!searchTerm.trim()) return true;
                      const q = searchTerm.toLowerCase().trim();
                      return (
                        (d.supervisorName || '').toLowerCase().includes(q) ||
                        (d.jobsiteName || '').toLowerCase().includes(q) ||
                        (d.vendorName || '').toLowerCase().includes(q) ||
                        (d.invoiceNo || '').toLowerCase().includes(q) ||
                        (d.category || '').toLowerCase().includes(q)
                      );
                    })
                    .sort((a, b) => {
                      const timeA = new Date(a.created_at || a.orderDate || 0).getTime();
                      const timeB = new Date(b.created_at || b.orderDate || 0).getTime();
                      return dateSortOrder === 'desc' ? timeB - timeA : timeA - timeB;
                    })
                    .map((d) => {
                      const perm = checkRecordPermission(user, d.supervisorId, d.supervisorName);
                      const eff = getEffectiveDiscount(d);
                      return (
                        <tr key={d.id} id={`discount-row-${d.id}`} className="hover:bg-amber-50/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-slate-700 font-medium whitespace-nowrap">
                            <div className="flex flex-col text-xs">
                              <span className="font-bold text-slate-900 flex items-center space-x-1" title="Sisteme Yüklenme / Kayıt Zamanı">
                                <Clock className="w-3 h-3 text-emerald-600 shrink-0" />
                                <span>{formatUploadDate(d.created_at || d.orderDate, d.orderDate)}</span>
                              </span>
                              {d.orderDate && (
                                <span className="text-[10px] text-slate-400" title="Belge / Fatura Tarihi">
                                  Fatura T: {d.orderDate}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-900">
                            <div>{d.supervisorName}</div>
                            {d.recordOrigin === 'asist' || d.performedByPersonnelName ? (
                              <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded mt-0.5" title="Personel tarafından yürütüldü (Şefe Asist)">
                                <span>🤝 ASİST:</span>
                                <span className="font-semibold">{d.performedByPersonnelName || 'Personel'}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded mt-0.5" title="Şef kendisi doğrudan pazarlık yaptı">
                                <span>🎯 GOL (Şef)</span>
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-indigo-700">{d.jobsiteName}</td>
                          <td className="py-2.5 px-3 text-slate-800 font-semibold">{normalizeVendorName(d.vendorName)}</td>
                          <td className="py-2.5 px-3 font-mono font-bold">{formatRuble(eff.effectiveAgreed)}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                            <div>
                              +{formatRuble(eff.discountAmount)} (%{eff.discountPercentage})
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-0.5">
                              {(() => {
                                const rCount = getGenuineNegotiationRoundCount(d);
                                if (rCount > 0) {
                                  return (
                                    <span
                                      className="inline-flex items-center space-x-1 text-[10px] font-sans px-2 py-0.5 rounded font-black border bg-emerald-100 text-emerald-950 border-emerald-400 shadow-xs"
                                      title={`${rCount} ara pazarlık turu faturası/belgesi eklendi (+%${25 * rCount} efor bonusu)`}
                                    >
                                      <span className="text-emerald-700 font-black">🎯</span>
                                      <span className="font-extrabold">{rCount} Tur Pazarlık Eklendi</span>
                                    </span>
                                  );
                                }
                                return (
                                  <span
                                    className="inline-flex items-center space-x-1 text-[9px] font-sans px-1.5 py-0.2 rounded text-slate-500 bg-slate-100 border border-slate-200"
                                    title="Ara pazarlık turu faturası girilmedi (Doğrudan İlk Teklif ➔ Nihai Fatura)"
                                  >
                                    <span className="text-slate-400 text-[10px]">⚡</span>
                                    <span className="font-medium">Doğrudan Anlaşma</span>
                                  </span>
                                );
                              })()}
                              {d.scopeDeductionAmount && d.scopeDeductionAmount > 0 && (
                                <span className="text-[10px] font-sans bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded font-bold" title={`Kapsam Düşümü: -${formatRuble(d.scopeDeductionAmount)} (${d.scopeDeductionReason || 'Sepetten çıkan kalem'})`}>
                                  ⚖️ Düzeltmeli
                                </span>
                              )}
                              {d.prizmaRequestCode && (
                                <span
                                  className="inline-flex items-center space-x-1 text-[9px] font-sans px-1.5 py-0.2 rounded font-bold bg-blue-100 text-blue-900 border border-blue-300 shadow-2xs"
                                  title={`Prizma (PM) Süreci: ${d.prizmaRequestCode} ${d.prizmaOrderCode ? `(${d.prizmaOrderCode})` : ''} - ${d.prizmaStatus || 'Bağlandı'}`}
                                >
                                  <span className="font-black text-blue-700">П</span>
                                  <span>{d.prizmaRequestCode}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedDetailDiscount(d)}
                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer shadow-2xs"
                                title="Fatura ve Malzeme Kalem Detaylarını İncele"
                              >
                                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Ayrıntı</span>
                              </button>

                              {perm.canEdit ? (
                                <button
                                  type="button"
                                  onClick={() => setEditingDiscountRecord(d)}
                                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
                                  title="Bilgileri Düzenle"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Düzenle</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => alert(`Salt Okunur: Bu kayıt "${d.supervisorName}" şefine aittir. Yalnızca kendi eklediğiniz veya yöneticisi olduğunuz kayıtları düzenleyebilirsiniz.`)}
                                  className="px-2.5 py-1 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer opacity-80"
                                  title="Salt Okunur: Başka bir şefe ait kayıt"
                                >
                                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                                  <span className="text-amber-800 font-extrabold">Salt Okunur</span>
                                </button>
                              )}

                              {onDeleteDiscount && perm.canDelete && (
                                <button
                                  type="button"
                                  onClick={() => setDiscountToDelete(d)}
                                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
                                  title="Sil (Çöp Kutusuna Taşı)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Sil</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Detailed Discount & Invoice Inspection Modal */}
      {selectedDetailDiscount && (
        <DiscountDetailModal
          discount={selectedDetailDiscount}
          onClose={() => {
            setSelectedDetailDiscount(null);
            setDetailItemSearch('');
          }}
          onEditDiscount={(rec) => {
            setSelectedDetailDiscount(null);
            setDetailItemSearch('');
            setEditingDiscountRecord(rec);
          }}
          onDeleteDiscount={onDeleteDiscount ? async (id) => {
            if (onDeleteDiscount) {
              await onDeleteDiscount(id);
            }
            setSelectedDetailDiscount(null);
            setDetailItemSearch('');
          } : undefined}
          comparativeAnalysisData={comparativeAnalysisData}
        />
      )}

      {/* AI Processing Loading Overlay */}
      {isProcessingAI && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl max-w-md w-full text-center space-y-4">
            <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-amber-500/20 border-t-amber-400 animate-spin"></div>
              <Sparkles className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Gemini AI OCR Engine</h3>
              <p className="text-xs text-amber-300 font-medium mt-1">
                Teklif belgesi / fatura yapay zeka ile taranıyor ve kalemler çıkarılıyor...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* AI Extracted Data Review & Approval Modal (Exact match to InvoiceScannerAI flow) */}
      {aiReviewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl space-y-6 text-white text-left my-8">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shrink-0">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-xl font-black text-slate-100">
                      AI Teklif Okundu & Kontrol Paneli
                    </h3>
                    <span className="text-[10px] font-extrabold text-amber-300 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/30 flex items-center space-x-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      <span>{aiReviewModal.usedModel || 'Gemini AI OCR'}</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Yapay zeka faturadaki tüm bilgileri çıkardı. Lütfen kontrol edip onaylayın.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiReviewModal(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Document Meta Banner */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Analiz Edilen Belge</span>
                <p className="font-mono font-bold text-amber-400 text-sm truncate">{aiReviewModal.fileName}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Taramayı Yapan AI Motoru</span>
                <p className="font-bold text-indigo-300 text-xs flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                  <span>{aiReviewModal.usedModel || 'Gemini AI OCR'}</span>
                </p>
              </div>
              <div className="space-y-1 sm:text-right">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Tespit Edilen Tür</span>
                <p className="font-bold text-emerald-400 text-xs">
                  {aiReviewModal.offerType === 'first' ? '📄 İlk Gelen Teklif (Liste Fiyatı)' : '✅ Son Anlaşılan İndirimli Fatura/Teklif'}
                </p>
              </div>
            </div>

            {/* Editable Form Grid */}
            <div className="space-y-4 text-xs">
              {/* Supervisor & Jobsite */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Satınalma Şefi *</span>
                  </label>
                  <select
                    value={aiReviewModal.supervisorId}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, supervisorId: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-bold text-xs focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {activeSupervisors.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.title})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>İşlemin Ait Olduğu Şantiye *</span>
                  </label>
                  <select
                    value={aiReviewModal.jobsiteId}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, jobsiteId: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-bold text-xs focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {activeJobsites.map(j => (
                      <option key={j.id} value={j.id}>{j.name}{j.location ? ` (${j.location})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Vendor & Category & InvoiceNo & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Tedarikçi Firma Adı *
                  </label>
                  <input
                    type="text"
                    value={aiReviewModal.vendorName}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, vendorName: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-semibold text-xs focus:ring-2 focus:ring-amber-500"
                  />
                  {String(aiReviewModal.vendorName || '').trim().length > 1 && registeredVendorNames.has(String(aiReviewModal.vendorName || '').trim().toLowerCase()) ? (
                    <div className="mt-2 text-[10px] font-semibold text-slate-400 bg-slate-900/70 p-2 rounded-lg border border-slate-800 flex items-center space-x-1.5">
                      <span className="text-slate-500">🏢</span>
                      <span className="leading-tight">Kayıtlı Tedarikçi: <strong className="text-slate-200">{aiReviewModal.vendorName}</strong> GES portföyünde mevcut (Eski Firma).</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center space-x-2 bg-indigo-900/40 p-2 rounded-lg border border-indigo-500/30">
                      <input
                        type="checkbox"
                        id="aiIsNewVendor"
                        checked={!!aiReviewModal.isNewVendor}
                        onChange={(e) => setAiReviewModal({ ...aiReviewModal, isNewVendor: e.target.checked })}
                        className="w-3.5 h-3.5 text-indigo-500 border-indigo-700 rounded focus:ring-indigo-500 cursor-pointer bg-slate-900"
                      />
                      <label htmlFor="aiIsNewVendor" className="text-[10px] font-bold text-indigo-300 cursor-pointer">
                        🚀 YENİ FİRMA (Tedarik Ağına İlk Kez Ekleniyor +Puan)
                      </label>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Malzeme Kategorisi *
                  </label>
                  <select
                    value={aiReviewModal.category}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, category: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs cursor-pointer"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Fatura / Teklif No
                  </label>
                  <input
                    type="text"
                    value={aiReviewModal.invoiceNo}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, invoiceNo: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-indigo-300 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Belge Tarihi
                  </label>
                  <input
                    type="date"
                    value={aiReviewModal.orderDate}
                    onChange={(e) => setAiReviewModal({ ...aiReviewModal, orderDate: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Editable Offer & Agreed Prices & Scope Deduction */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      İlk Teklif Fiyatı (Liste / Gelen) *
                    </label>
                    <input
                      type="number"
                      value={aiReviewModal.offerPrice}
                      onChange={(e) => setAiReviewModal({ ...aiReviewModal, offerPrice: Number(e.target.value) || 0 })}
                      className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-mono font-bold text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">
                      {aiReviewModal.rounds && aiReviewModal.rounds.length > 0 ? "2. İndirimli Fatura / Teklif Fiyatı *" : "Son Anlaşılan Fiyat (2. İndirimli Fatura) *"}
                    </label>
                    <input
                      type="number"
                      value={aiReviewModal.agreedPrice}
                      onChange={(e) => setAiReviewModal({ ...aiReviewModal, agreedPrice: Number(e.target.value) || 0 })}
                      className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 font-mono font-extrabold text-sm"
                    />
                  </div>
                </div>

                {/* Scope Deduction within AI Review */}
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-amber-300">
                      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Kapsam Düşümü / Sepetten Çıkarılan Kalemler</span>
                    </div>
                    {(aiReviewModal.scopeDeductionAmount || 0) > 0 && (
                      <span className="text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">
                        Düzeltilmiş Teklif: {formatRuble(Math.max(0, aiReviewModal.offerPrice - (aiReviewModal.scopeDeductionAmount || 0)))}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-amber-300/80 mb-0.5">Çıkarılan Tutar (₽)</label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={aiReviewModal.scopeDeductionAmount || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setAiReviewModal({
                            ...aiReviewModal,
                            scopeDeductionAmount: val,
                            adjustedOfferPrice: Math.max(0, aiReviewModal.offerPrice - val)
                          });
                        }}
                        className="w-full py-1.5 px-2 bg-slate-900 border border-amber-500/40 rounded-lg text-amber-300 font-mono font-bold text-xs"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-amber-300/80 mb-0.5">Çıkarılma Nedeni / Kalem Adı</label>
                      <input
                        type="text"
                        placeholder="Örn: 17.939,86 ₽ değerindeki çay kalemi iptal edildi"
                        value={aiReviewModal.scopeDeductionReason || ''}
                        onChange={(e) => setAiReviewModal({ ...aiReviewModal, scopeDeductionReason: e.target.value })}
                        className="w-full py-1.5 px-2 bg-slate-900 border border-amber-500/40 rounded-lg text-slate-200 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Savings Highlight */}
                            {(() => {
                const deduction = aiReviewModal.scopeDeductionAmount || 0;
                const baseline = deduction > 0 ? Math.max(0, aiReviewModal.offerPrice - deduction) : aiReviewModal.offerPrice;
                const rounds = aiReviewModal.rounds || [];
                const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
                const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;
                const modalAgreed = Number(aiReviewModal.agreedPrice) || 0;

                let effectiveAgreed = 0;
                if (lastRoundPrice > 0 && modalAgreed > 0) {
                  effectiveAgreed = modalAgreed;
                } else if (lastRoundPrice > 0) {
                  effectiveAgreed = lastRoundPrice;
                } else {
                  effectiveAgreed = modalAgreed;
                }

                const amt = Math.max(0, baseline - effectiveAgreed);
                const pct = baseline > 0 ? ((amt / baseline) * 100).toFixed(2) : '0';

                if (amt <= 0) return null;

                return (
                  <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-500 mb-1 uppercase tracking-wider">HESAPLANAN NET İNDİRİM KAZANIMI</h4>
                      <div className="flex items-baseline space-x-2">
                        <span className="text-2xl font-black text-emerald-400">+{formatRuble(amt)}</span>
                        {lastRoundPrice > 0 && (
                          <span className="text-[10px] font-bold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                            {rounds.length}. Son Tur ({formatRuble(effectiveAgreed)}) Baz Alındı
                          </span>
                        )}
                        {deduction > 0 && (
                          <p className="text-[10px] text-amber-300">
                            (Düzeltilmiş Teklif {formatRuble(baseline)} baz alındı)
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black px-3.5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        %{pct} İndirim Oranı
                      </span>
                    </div>
                  </div>
                );
              })()}

              {aiReviewModal.offerPrice === aiReviewModal.agreedPrice && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-[11px] text-amber-300 flex items-start space-x-2">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>İndirim Oranı Bilgilendirmesi:</strong> Belgedeki tutar ile liste fiyatı eşit algılandı. Eğer bu faturadan önce alınan indirimsiz bir liste teklifiniz varsa, yukarıdaki <strong>"İlk Teklif Fiyatı (Liste)"</strong> kutusundan tutarı güncelleyerek kazanılan indirim tutarını ve oranını anında hesaplatabilirsiniz.
                  </span>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PAZARLIK TURLARI & ARA İNDİRİM BELGELERİ (STAGE MANAGEMENT)   */}
              {/* ------------------------------------------------------------- */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Pazarlık Turları & Ara Belgeler (Aşamalandırma)
                      </h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        (aiReviewModal.rounds?.length || 0) > 0
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {(aiReviewModal.rounds?.length || 0) > 0 
                          ? `${aiReviewModal.rounds?.length} Ek İndirim Turu Eklendi` 
                          : 'Standart Süreç (İlk Teklif ➔ 2. İndirimli Fatura)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      2. indirimli faturadan sonra ek bir indirim daha yapıldıysa (3. veya 4. indirimli teklif) belgelerini buradan sürükleyip veya seçerek hiyerarşik olarak ekleyebilirsiniz.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold text-xs flex items-center space-x-1.5 transition-all">
                      <Plus className="w-3.5 h-3.5 text-indigo-400" />
                      <span>+ 3. İndirimli Teklif Ekle</span>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleModalRoundDocUpload(file);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>

                {/* Drop Zone / Empty State */}
                {(!aiReviewModal.rounds || aiReviewModal.rounds.length === 0) ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsModalRoundDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsModalRoundDragOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsModalRoundDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleModalRoundDocUpload(file);
                    }}
                    className={`border-2 border-dashed rounded-xl p-4 text-center transition-all ${
                      isModalRoundDragOver
                        ? 'border-indigo-400 bg-indigo-950/30 scale-[1.01]'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
                    }`}
                  >
                    <label className="cursor-pointer block space-y-1.5">
                      <Upload className="w-6 h-6 mx-auto text-slate-500" />
                      <p className="text-xs font-bold text-slate-300">
                        <span className="text-emerald-400">3. İndirimli Teklif / Faturayı</span> Buraya Sürükleyin veya <span className="text-indigo-400 underline">Dosya Seçin</span>
                      </p>
                      <p className="text-[10px] text-slate-400">
                        PDF, Excel veya Görsel yüklediğinizde yapay zeka tutarı otomatik algılayıp aşama olarak ekler.
                      </p>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleModalRoundDocUpload(file);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  /* Render list of added rounds */
                  <div className="space-y-3">
                    {aiReviewModal.rounds.map((round, idx) => {
                      const isThisLoading = modalRoundLoadingIndex === idx;
                      const prevP = (idx === 0 ? Number(aiReviewModal.agreedPrice) || Number(aiReviewModal.offerPrice) || 0 : aiReviewModal.rounds![idx - 1]?.quotedPrice || 0);
                      const roundDisc = Math.max(0, prevP - (round.quotedPrice || 0));
                      const roundDiscPct = prevP > 0 ? ((roundDisc / prevP) * 100).toFixed(1) : '0';

                      return (
                        <div
                          key={round.id || idx}
                          className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-3 space-y-2.5 relative"
                        >
                          {/* Header: Round title & Delete button */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-black text-[10px] flex items-center justify-center">
                                {idx + 3}
                              </span>
                              <span className="font-extrabold text-xs text-indigo-300">
                                {idx + 3}. İndirimli Fatura / Teklif
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveModalRound(idx)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
                              title="Bu turu sil"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Document upload / preview */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs">
                            <div className="flex items-center space-x-2 min-w-0">
                              <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                              {round.documentName ? (
                                <div className="truncate">
                                  <span className="font-semibold text-slate-200 truncate block">{round.documentName}</span>
                                  <span className="text-[10px] text-emerald-400">✓ Aşama belgesi yüklendi</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Belge yüklenmedi (Manuel tur)</span>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 shrink-0">
                              {isThisLoading ? (
                                <div className="flex items-center space-x-1.5 text-[10px] text-amber-300 font-bold">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                  <span>AI Okunuyor...</span>
                                </div>
                              ) : (
                                <label className="cursor-pointer px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 flex items-center space-x-1">
                                  <Upload className="w-3 h-3 text-slate-400" />
                                  <span>{round.documentName ? 'Belgeyi Değiştir' : 'Belge Yükle'}</span>
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        handleModalRoundDocUpload(file, idx);
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>

                          {/* Price & Discount input */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                                Bu Turdaki Teklif Fiyatı (₽) *
                              </label>
                              <input
                                type="number"
                                value={round.quotedPrice || ''}
                                placeholder="0.00"
                                onChange={(e) => handleUpdateModalRound(idx, 'quotedPrice', Number(e.target.value) || 0)}
                                className="w-full py-1.5 px-2.5 bg-slate-950 border border-slate-700 rounded-lg text-indigo-300 font-mono font-bold text-xs focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                                Bu Turda Kazanılan Ara İndirim
                              </label>
                              <div className="py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                                <span className="font-mono font-bold text-emerald-400">
                                  -{formatRuble(roundDisc)}
                                </span>
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  %{roundDiscPct}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Optional note */}
                          <div>
                            <input
                              type="text"
                              placeholder="Örn: 1. Tur: Tedarikçi liste fiyatından indirim yaptı"
                              value={round.note || ''}
                              onChange={(e) => handleUpdateModalRound(idx, 'note', e.target.value)}
                              className="w-full py-1 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-[11px] placeholder:text-slate-600"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Add another round button */}
                    <div className="flex justify-end pt-1">
                      <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center space-x-1.5 transition-all">
                        <Plus className="w-3.5 h-3.5 text-indigo-400" />
                        <span>+ {aiReviewModal.rounds.length + 3}. İndirimli Teklif Ekle</span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleModalRoundDocUpload(file);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Visual Stage Progression Ladder (Pazarlık Merdiveni) */}
                {aiReviewModal.rounds && aiReviewModal.rounds.length > 0 && (
                  <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Kayıt Edilecek Aşamalı Belge Sıralaması:</span>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 font-semibold flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        <span>1. İlk Teklif / Fatura ({formatRuble(aiReviewModal.offerPrice)})</span>
                      </span>

                      <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="px-2.5 py-1 rounded-lg bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 font-semibold flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        <span>2. İndirimli Fatura / Teklif ({formatRuble(aiReviewModal.agreedPrice)})</span>
                      </span>

                      {aiReviewModal.rounds.map((r, i) => {
                        const stageNum = i + 3;
                        const isLast = i === aiReviewModal.rounds!.length - 1;
                        return (
                          <React.Fragment key={r.id || i}>
                            <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center space-x-1 ${
                              isLast
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 font-black'
                                : 'bg-indigo-950/80 text-indigo-200 border-indigo-500/40'
                            }`}>
                              <span className={`w-2 h-2 rounded-full ${isLast ? 'bg-emerald-400' : 'bg-indigo-400'}`}></span>
                              <span>{stageNum}. İndirimli Fatura / Teklif {isLast ? '(Nihai)' : ''} ({formatRuble(r.quotedPrice)})</span>
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            {/* Validation Logic and Save Button Area */}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={isProcessingAI}
                onClick={() => {
                  setAiReviewModal(null);
                  setExtractedItems([]);
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-all text-xs disabled:opacity-60"
              >
                Vazgeç / Kapat
              </button>
              
              <button
                  type="button"
                  disabled={isProcessingAI}
                  onClick={async () => {
                    if (isProcessingAI) return;
                    const calcOffer = Number(aiReviewModal.offerPrice) || 0;
                    const calcDeduction = Number(aiReviewModal.scopeDeductionAmount) || 0;
                    const calcAdjusted = calcDeduction > 0 ? Math.max(0, calcOffer - calcDeduction) : calcOffer;
                    const calcBaseline = calcDeduction > 0 ? calcAdjusted : calcOffer;
                    const currentRounds = aiReviewModal.rounds || [];
                    const lastRound = currentRounds.length > 0 ? currentRounds[currentRounds.length - 1] : null;
                    const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;
                    const modalAgreed = Number(aiReviewModal.agreedPrice) || 0;
                    
                    let calcAgreed = modalAgreed > 0 ? modalAgreed : (lastRoundPrice > 0 ? lastRoundPrice : 0);

                    // STRICT VALIDATION FOR DECREASING PRICES
                    if (aiReviewModal.offerType !== 'first') {
                      let isValidSequence = true;
                      let prevStep = calcBaseline;

                      for (let i = 0; i < currentRounds.length; i++) {
                        const rP = Number(currentRounds[i].quotedPrice) || 0;
                        if (rP <= 0 || rP >= prevStep) {
                          isValidSequence = false;
                          break;
                        }
                        prevStep = rP;
                      }

                      if (calcAgreed <= 0 || calcAgreed >= prevStep) {
                        isValidSequence = false;
                      }

                      if (!isValidSequence) {
                        setNotification({type: 'error', message: 'Fiyat Sıralaması Geçersiz! Her yeni indirim turundaki teklif/fatura fiyatı bir öncekinden kesinlikle daha DÜŞÜK olmalıdır. Lütfen fiyatları (ilk teklif > ara indirimli teklifler > nihai son fatura) şeklinde güncelleyin. Aynı tutar girilemez.'});
                        return;
                      }
                       
                       if (calcAgreed <= 0) {
                         setNotification({type: 'error', message: 'Lütfen anlaşılan son indirimli tutarı girin.'});
                         return;
                       }
                    }

                    // ALWAYS handle 1st offer step cleanly: transfer data to form and ask for 2nd document

                    if (aiReviewModal.offerType === 'first') {
                      setSupervisorId(aiReviewModal.supervisorId);
                      setJobsiteId(aiReviewModal.jobsiteId);
                      setVendorName(aiReviewModal.vendorName);
                      setCategory(aiReviewModal.category);
                      setOfferPrice(calcOffer > 0 ? calcOffer.toString() : offerPrice);
                      if (calcDeduction > 0) setScopeDeductionAmount(calcDeduction.toString());
                      if (aiReviewModal.scopeDeductionReason) setScopeDeductionReason(aiReviewModal.scopeDeductionReason);
                      if (calcAgreed > 0 && calcAgreed < calcOffer) {
                        setAgreedPrice(calcAgreed.toString());
                      }
                      setInvoiceNo(aiReviewModal.invoiceNo);
                      setOrderDate(aiReviewModal.orderDate);
                      setNotes(aiReviewModal.notes);
                      if (aiReviewModal.items && aiReviewModal.items.length > 0) {
                        setExtractedItems(aiReviewModal.items);
                      }

                      setNotification({
                        type: 'success',
                        message: `✨ 1. Gelen Teklif (Liste Fiyatı: ${formatRuble(calcOffer)}) onaylandı! Şimdi "2. Son İndirimli Faturayı" yükleyebilir veya anlaşılan tutarı girebilirsiniz.`
                      });
                      setAiReviewModal(null);
                      return;
                    }

                    const selectedSup = activeSupervisors.find(s => s.id === aiReviewModal.supervisorId);
                    const selectedJob = activeJobsites.find(j => j.id === aiReviewModal.jobsiteId);
                    const calcAmt = Math.max(0, calcBaseline - calcAgreed);
                    const calcPct = calcBaseline > 0 ? Number(((calcAmt / calcBaseline) * 100).toFixed(2)) : 0;

                    const firstDocName = firstOfferFile?.name || '1_Teklif_Gelen_Liste.pdf';
                    const finalDocName = finalOfferFile?.name || aiReviewModal.fileName || '2_Son_Indirimli_Proforma.xlsx';

                    try {
                      setIsProcessingAI(true);
                      const firstUrl = await resolveFileUrl(firstOfferFile, firstDocName);
                      const finalUrl = await resolveFileUrl(finalOfferFile, finalDocName);

                      // Build stageDocuments array
                      const generatedStageDocs: StageDocument[] = [];
                      generatedStageDocs.push({
                        stageNumber: 1,
                        title: '1. İlk Teklif / Fatura',
                        fileName: firstDocName,
                        fileUrl: firstUrl.url,
                        driveFileId: firstUrl.fileId,
                        amount: calcOffer
                      });

                      const validRounds: NegotiationRound[] = [];
                      for (let i = 0; i < currentRounds.length; i++) {
                        const r = { ...currentRounds[i] };
                        let rUrl = r.documentUrl || '';
                        let rId: string | undefined = undefined;
                        if (r.documentName && (!rUrl || rUrl.startsWith('data:'))) {
                          const up = await resolveFileUrl({ name: r.documentName, url: rUrl }, r.documentName);
                          rUrl = up.url;
                          rId = up.fileId;
                        }
                        r.documentUrl = rUrl;
                        const qp = Number(r.quotedPrice) || 0;
                        // SADECE ara tur belgesi olanlar geçerli ara turdur
                        const hasDoc = Boolean(r.documentName || rUrl || (r as any).fileName);
                        if (hasDoc && (qp > 0 ? qp <= calcBaseline : true)) {
                          validRounds.push(r);
                        }
                      }

                      if (validRounds.length === 0) {
                        generatedStageDocs.push({
                          stageNumber: 2,
                          title: '2. İndirimli Fatura / Teklif',
                          fileName: finalDocName,
                          fileUrl: finalUrl.url,
                          driveFileId: finalUrl.fileId,
                          amount: calcAgreed,
                          isFinal: true
                        });
                      } else {
                        validRounds.forEach((r, i) => {
                          const stageNo = i + 2;
                          generatedStageDocs.push({
                            stageNumber: stageNo,
                            title: `${stageNo}. Ara İndirimli Teklif (Tur #${i + 1})`,
                            fileName: r.documentName || `${stageNo}_Ara_Teklif.pdf`,
                            fileUrl: r.documentUrl,
                            driveFileId: r.documentUrl?.includes('drive.google.com') ? r.documentUrl : undefined,
                            amount: Number(r.quotedPrice) || 0,
                            roundIndex: i,
                            isFinal: false
                          });
                        });

                        generatedStageDocs.push({
                          stageNumber: validRounds.length + 2,
                          title: `${validRounds.length + 2}. Nihai İndirimli Fatura`,
                          fileName: finalDocName,
                          fileUrl: finalUrl.url,
                          driveFileId: finalUrl.fileId,
                          amount: calcAgreed,
                          isFinal: true
                        });
                      }

                      await onSaveDiscount({
                        supervisorId: aiReviewModal.supervisorId,
                        performedByPersonnelId: performedByPersonnelId || undefined,
                        jobsiteId: aiReviewModal.jobsiteId,
                        vendorName: aiReviewModal.vendorName,
                        isNewVendor: aiReviewModal.isNewVendor,
                        category: aiReviewModal.category,
                        offerPrice: calcOffer,
                        scopeDeductionAmount: calcDeduction > 0 ? calcDeduction : undefined,
                        scopeDeductionReason: calcDeduction > 0 ? (aiReviewModal.scopeDeductionReason ? String(aiReviewModal.scopeDeductionReason).trim() : undefined) : undefined,
                        adjustedOfferPrice: calcDeduction > 0 ? calcAdjusted : calcOffer,
                        agreedPrice: calcAgreed,
                        orderDate: aiReviewModal.orderDate,
                        notes: aiReviewModal.notes || (calcDeduction > 0 ? `İlk tekliften ${formatRuble(calcDeduction)} düşülerek net indirim hesaplandı.` : 'Teklif belgeleri karşılaştırılarak otomatik kaydedildi.'),
                        invoiceNo: aiReviewModal.invoiceNo,
                        firstOfferFileName: firstDocName,
                        firstOfferFileUrl: firstUrl.url,
                        firstOfferDriveFileId: firstUrl.fileId,
                        finalOfferFileName: finalDocName,
                        finalOfferFileUrl: finalUrl.url,
                        finalOfferDriveFileId: finalUrl.fileId,
                        items: aiReviewModal.items,
                        negotiationRounds: validRounds.length > 0 ? validRounds : undefined,
                        stageDocuments: generatedStageDocs,
                        crossNegotiationApplied: validRounds.length >= 2
                      });

                      setSubmittedRecordSummary({
                        supervisorName: selectedSup ? selectedSup.name : 'Satınalma Şefi',
                        jobsiteName: selectedJob ? selectedJob.name : 'Şantiye',
                        vendorName: aiReviewModal.vendorName,
                        category: aiReviewModal.category,
                        offerPrice: calcOffer,
                        scopeDeductionAmount: calcDeduction > 0 ? calcDeduction : undefined,
                        scopeDeductionReason: calcDeduction > 0 ? (aiReviewModal.scopeDeductionReason ? String(aiReviewModal.scopeDeductionReason).trim() : undefined) : undefined,
                        adjustedOfferPrice: calcDeduction > 0 ? calcAdjusted : calcOffer,
                        agreedPrice: calcAgreed,
                        discountAmount: calcAmt,
                        discountPercentage: calcPct,
                        orderDate: aiReviewModal.orderDate,
                        invoiceNo: aiReviewModal.invoiceNo,
                        firstOfferFileName: firstDocName,
                        finalOfferFileName: finalDocName
                      });

                      setNotification({
                        type: 'success',
                        message: `🎉 İndirim Kaydı ve Fatura Başarıyla Sisteme Eklendi! (+${formatRuble(calcAmt)} / %${calcPct})`
                      });

                      // Reset form fields
                      setVendorName('');
                      setOfferPrice('');
                      setAgreedPrice('');
                      setNotes('');
                      setInvoiceNo('');
                      setFirstOfferFile(null);
                      setFinalOfferFile(null);
                      setExtractedItems([]);
                      setNegotiationRounds([]);

                      setAiReviewModal(null);
                      onSuccess();
                    } catch (err: any) {
                      console.error('Error saving discount:', err);
                      setNotification({
                        type: 'error',
                        message: err.message || 'Kayıt sırasında bir hata oluştu.'
                      });
                    } finally {
                      setIsProcessingAI(false);
                    }
                  }}
                  className={`w-full sm:w-auto px-6 py-3 font-extrabold rounded-xl shadow-lg transition-all text-xs flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    aiReviewModal.offerType === 'first'
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/40'
                      : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white shadow-emerald-900/40'
                  }`}
                >
                  {isProcessingAI ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-emerald-300" />
                      <span>Sisteme Kaydediliyor...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                      <span>
                        {aiReviewModal.offerType === 'first'
                          ? '1. Teklifi Onayla & 2. Faturayı Yüklemeye Geç'
                          : '✅ İndirim Kaydını Onayla ve Kaydet'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 1. Review & Verification Modal (Pops up BEFORE saving) */}
      {pendingReviewRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6 text-white text-left">
            <div className="flex items-center space-x-4 border-b border-slate-800 pb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shrink-0">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-black text-slate-100">
                  {t('reviewModalTitle')}
                </h3>
                <p className="text-xs text-amber-300 font-medium mt-0.5">
                  {t('reviewModalSub')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingReviewRecord(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Editable Form in Review Panel */}
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t('selectSupervisor')} *</span>
                  </label>
                  <select
                    value={pendingReviewRecord.supervisorId}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, supervisorId: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-bold text-xs focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {activeSupervisors.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.title})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center space-x-1.5">
                    <Building2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t('selectJobsite')} *</span>
                  </label>
                  <select
                    value={pendingReviewRecord.jobsiteId}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, jobsiteId: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-bold text-xs focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {activeJobsites.map(j => (
                      <option key={j.id} value={j.id}>{j.name}{j.location ? ` (${j.location})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {t('supplier')} *
                  </label>
                  <input
                    type="text"
                    value={pendingReviewRecord.vendorName}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, vendorName: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-semibold text-xs focus:ring-2 focus:ring-amber-500"
                  />
                  {String(pendingReviewRecord.vendorName || '').trim().length > 1 && registeredVendorNames.has(String(pendingReviewRecord.vendorName || '').trim().toLowerCase()) ? (
                    <div className="mt-2 text-[10px] font-semibold text-slate-400 bg-slate-900/70 p-2 rounded-lg border border-slate-800 flex items-center space-x-1.5">
                      <span className="text-slate-500">🏢</span>
                      <span className="leading-tight">Kayıtlı Tedarikçi: <strong className="text-slate-200">{pendingReviewRecord.vendorName}</strong> GES portföyünde mevcut (Eski Firma).</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center space-x-2 bg-indigo-900/40 p-2 rounded-lg border border-indigo-500/30">
                      <input
                        type="checkbox"
                        id="pendingIsNewVendor"
                        checked={!!pendingReviewRecord.isNewVendor}
                        onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, isNewVendor: e.target.checked })}
                        className="w-3.5 h-3.5 text-indigo-500 border-indigo-700 rounded focus:ring-indigo-500 cursor-pointer bg-slate-900"
                      />
                      <label htmlFor="pendingIsNewVendor" className="text-[10px] font-bold text-indigo-300 cursor-pointer">
                        🚀 YENİ FİRMA (Tedarik Ağına İlk Kez Ekleniyor +Puan)
                      </label>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {t('selectCategory')}
                  </label>
                  <select
                    value={pendingReviewRecord.category}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, category: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs cursor-pointer"
                  >
                    {categories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    {t('listPrice')} (₽) *
                  </label>
                  <input
                    type="number"
                    value={pendingReviewRecord.offerPrice}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, offerPrice: Number(e.target.value) || 0 })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 font-bold text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">
                    {t('agreedPrice')} (₽) *
                  </label>
                  <input
                    type="number"
                    value={pendingReviewRecord.agreedPrice}
                    onChange={(e) => setPendingReviewRecord({ ...pendingReviewRecord, agreedPrice: Number(e.target.value) || 0 })}
                    className="w-full py-2 px-3 bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 font-extrabold text-xs"
                  />
                </div>
              </div>

              {/* Extracted Material Line Items Preview */}
              {pendingReviewRecord.items && pendingReviewRecord.items.length > 0 && (
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs text-indigo-300 flex items-center space-x-1.5">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <span>Aktarılacak Malzeme Kalemleri ({pendingReviewRecord.items.length} Kalem)</span>
                    </h4>
                    <span className="text-[10px] text-slate-400 font-medium">Malzeme Kıyaslama Sekmesine Ayrı Ayrı Aktarılacaktır</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-800">
                    <table className="w-full text-[11px] text-slate-200 text-left">
                      <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0 border-b border-slate-800">
                        <tr>
                          <th className="py-1.5 px-3">Malzeme Adı</th>
                          <th className="py-1.5 px-3">Kategori</th>
                          <th className="py-1.5 px-3 text-right">Miktar</th>
                          <th className="py-1.5 px-3 text-right">Birim Fiyat</th>
                          <th className="py-1.5 px-3 text-right">Toplam</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {pendingReviewRecord.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50">
                            <td className="py-1.5 px-3 font-medium text-slate-100">{it.materialName}</td>
                            <td className="py-1.5 px-3 text-slate-400">{it.category || 'Genel'}</td>
                            <td className="py-1.5 px-3 text-right font-mono">{it.quantity} {it.unit}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-emerald-400">{formatRuble(it.unitPrice)}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-bold text-white">{formatRuble(it.totalPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Dynamic Savings Highlight */}
              <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-950 border border-emerald-500/40 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-400">{t('earnedDiscount')}</p>
                  <p className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                    +{formatRuble(Math.max(0, pendingReviewRecord.offerPrice - pendingReviewRecord.agreedPrice))}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-black px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    %{pendingReviewRecord.offerPrice > 0 ? ((Math.max(0, pendingReviewRecord.offerPrice - pendingReviewRecord.agreedPrice) / pendingReviewRecord.offerPrice) * 100).toFixed(2) : 0} {t('discountRatio')}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-3 border-t border-slate-800 gap-3">
              <button
                type="button"
                onClick={() => setPendingReviewRecord(null)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800 text-xs transition-all cursor-pointer"
              >
                {t('editReviewBtn')}
              </button>

              <button
                type="button"
                disabled={isProcessingAI}
                onClick={handleConfirmAndSavePendingRecord}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-extrabold rounded-xl shadow-lg transition-all text-sm flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isProcessingAI ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-300" />
                    <span>Sisteme Kaydediliyor...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300" />
                    <span>{t('confirmReviewBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Edit Existing Saved Record Modal */}
      {editingDiscountRecord && (
        <EditDiscountModal
          record={editingDiscountRecord}
          supervisors={supervisors}
          jobsites={jobsites}
          personnel={activePersonnel}
          onSave={async (id, updatedFields) => {
            if (onUpdateDiscount) {
              await onUpdateDiscount(id, updatedFields);
            }
          }}
          onDelete={onDeleteDiscount ? async (id) => {
            await onDeleteDiscount(id);
          } : undefined}
          onClose={() => setEditingDiscountRecord(null)}
        />
      )}

      {/* Submitted Record Review / Confirmation Modal */}
      {submittedRecordSummary && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6 text-white text-left">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-100">
                  {t('submittedModalTitle')}
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  {t('submittedModalDesc')}
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">{t('selectSupervisor')}</p>
                  <p className="font-bold text-slate-200 text-sm mt-0.5">{submittedRecordSummary.supervisorName}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">{t('selectJobsite')}</p>
                  <p className="font-bold text-slate-200 text-sm mt-0.5">{submittedRecordSummary.jobsiteName}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">{t('supplier')}</p>
                  <p className="font-bold text-slate-200 text-sm mt-0.5">{submittedRecordSummary.vendorName}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">{t('selectCategory')}</p>
                  <p className="font-bold text-slate-200 text-sm mt-0.5">{submittedRecordSummary.category}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">{t('invoiceNumber')}</p>
                  <p className="font-mono font-bold text-indigo-400 text-sm mt-0.5">{submittedRecordSummary.invoiceNo}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-medium uppercase text-[10px]">Giriş / Kayıt Zamanı</p>
                  <p className="font-bold text-slate-200 text-sm mt-0.5 font-mono">{formatUploadDate(submittedRecordSummary.created_at || submittedRecordSummary.orderDate, submittedRecordSummary.orderDate)}</p>
                </div>
              </div>

              {/* Price & Savings Highlight */}
              <div className="bg-gradient-to-r from-emerald-950 to-slate-900 border border-emerald-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-3 text-xs">
                    <span className="text-slate-400">{t('listPrice')}:</span>
                    <span className="font-mono text-slate-300 line-through">{formatRuble(submittedRecordSummary.offerPrice)}</span>
                  </div>
                  {submittedRecordSummary.scopeDeductionAmount && submittedRecordSummary.scopeDeductionAmount > 0 && (
                    <div className="flex items-center space-x-3 text-xs text-amber-300">
                      <span>Kapsam Düşümü:</span>
                      <span className="font-mono font-bold">-{formatRuble(submittedRecordSummary.scopeDeductionAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-3 text-xs">
                    <span className="text-slate-400">{t('agreedPrice')}:</span>
                    <span className="font-mono font-bold text-white text-sm">{formatRuble(submittedRecordSummary.agreedPrice)}</span>
                  </div>
                </div>

                <div className="text-right sm:text-right w-full sm:w-auto bg-emerald-500/10 border border-emerald-500/30 px-4 py-2 rounded-xl">
                  <p className="text-[10px] uppercase text-emerald-300 font-bold">{t('earnedDiscount')}</p>
                  <p className="text-xl font-black text-emerald-400 font-mono mt-0.5">
                    +{formatRuble(submittedRecordSummary.discountAmount)} <span className="text-xs font-sans text-emerald-300">(%{submittedRecordSummary.discountPercentage})</span>
                  </p>
                </div>
              </div>

              {/* Sistem Güvenli Bulut Arşiv Belgeleri note */}
              <div className="space-y-1.5 text-xs text-slate-400">
                <p className="font-bold text-slate-300 flex items-center space-x-1.5">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <span>Sistem Güvenli Bulut Arşiv Belgeleri:</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex items-center space-x-2 text-indigo-300">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{submittedRecordSummary.firstOfferFileName}</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 flex items-center space-x-2 text-emerald-300">
                    <FileCheck className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate">{submittedRecordSummary.finalOfferFileName}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => {
                  setSubmittedRecordSummary(null);
                  onSuccess();
                  setTimeout(() => {
                    document.getElementById('recent-discounts-section')?.scrollIntoView({ behavior: 'smooth' });
                  }, 150);
                }}
                className="w-full sm:w-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl shadow-lg transition-all text-sm cursor-pointer flex items-center justify-center space-x-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t('confirmAndCloseModal')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Discount Confirmation Modal */}
      {discountToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 text-white text-left">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">İndirim Kaydını Sil?</h3>
                <p className="text-xs text-slate-400">Kayıt çöp kutusuna taşınacak ve 7 gün boyunca saklanacaktır.</p>
              </div>
            </div>

            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 text-xs space-y-1.5">
              <p><strong className="text-slate-300">Tarih / Kayıt Zamanı:</strong> <span className="font-mono text-slate-200">{formatUploadDate(discountToDelete.created_at || discountToDelete.orderDate, discountToDelete.orderDate)}</span></p>
              <p><strong className="text-slate-300">Tedarikçi:</strong> {discountToDelete.vendorName}</p>
              <p><strong className="text-slate-300">Fatura / Teklif No:</strong> {discountToDelete.invoiceNo || 'N/A'}</p>
              <p><strong className="text-slate-300">Satınalma Şefi:</strong> {discountToDelete.supervisorName}</p>
              <p><strong className="text-slate-300">Net İndirim:</strong> <span className="text-emerald-400 font-bold">+{formatRuble(discountToDelete.discountAmount)}</span></p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setDiscountToDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onDeleteDiscount && discountToDelete) {
                    await onDeleteDiscount(discountToDelete.id);
                  }
                  setDiscountToDelete(null);
                  if (selectedDetailDiscount?.id === discountToDelete?.id) {
                    setSelectedDetailDiscount(null);
                  }
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-extrabold cursor-pointer flex items-center space-x-1.5 shadow-lg"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Çöp Kutusuna Taşı</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals end */}

      {/* Comparative Offer Analysis Modal */}
      <ComparativeOfferAnalysisModal
        isOpen={isComparativeModalOpen}
        onClose={() => setIsComparativeModalOpen(false)}
        jobsites={activeJobsites}
        supervisors={activeSupervisors}
        personnelList={activePersonnel}
        onAnalysisSaved={() => {
          setIsComparativeModalOpen(false);
          onSuccess();
          setNotification({
            type: 'success',
            message: language === 'ru'
              ? 'Сравнительный анализ успешно сохранен с данными окончательного счета!'
              : 'Karşılaştırmalı analiz son anlaşılan fatura bilgileriyle başarıyla sisteme kaydedildi!'
          });
        }}
        onApplyToForm={(data) => {
          setIsComparativeModalOpen(false);
          setVendorName(data.vendorName || '');
          setOfferPrice(String(data.offerPrice || ''));
          setAgreedPrice(String(data.agreedPrice || ''));
          if (data.invoiceNo) setInvoiceNo(data.invoiceNo);
          if (data.invoiceDate) setOrderDate(data.invoiceDate);
          if (data.notes) setNotes(data.notes);
          if (data.category) setCategory(data.category);
          if (data.supervisorId) setSupervisorId(data.supervisorId);
          if (data.jobsiteId) setJobsiteId(data.jobsiteId);
          if (data.performedByPersonnelId) setPerformedByPersonnelId(data.performedByPersonnelId);
          if (data.items && data.items.length > 0) {
            setExtractedItems(data.items);
          }
          if (data.firstOfferFileName) {
            setFirstOfferFile({
              name: data.firstOfferFileName,
              url: data.firstOfferFileUrl || ''
            });
          }
          if (data.finalOfferFileName) {
            setFinalOfferFile({
              name: data.finalOfferFileName,
              url: data.finalOfferFileUrl || ''
            });
          }

          // Populate intermediate negotiation rounds if present
          if (data.analysisRecord?.negotiationStages && data.analysisRecord.negotiationStages.length > 0) {
            const mappedRounds: NegotiationRound[] = data.analysisRecord.negotiationStages.map((stg, idx) => {
              const prevAmt = idx === 0
                ? Number(data.offerPrice) || 0
                : Number(data.analysisRecord.negotiationStages![idx - 1].amount) || Number(data.offerPrice) || 0;
              const curAmt = Number(stg.amount) || 0;
              return {
                id: `rnd_cmp_${Date.now()}_${idx + 1}`,
                roundNumber: stg.roundNumber || (idx + 1),
                date: stg.date || data.invoiceDate || new Date().toISOString().split('T')[0],
                vendorName: stg.supplier || data.vendorName || 'Tedarikçi',
                quotedPrice: curAmt,
                previousPrice: prevAmt,
                discountThisRound: Math.max(0, prevAmt - curAmt),
                documentName: stg.fileName,
                note: stg.note || `${stg.roundNumber || (idx + 1)}. Ara Pazarlık Turu (${stg.supplier})`
              };
            });
            setNegotiationRounds(mappedRounds);
          } else {
            setNegotiationRounds([]);
          }

          const roundsCount = data.analysisRecord?.negotiationRoundsCount || (data.analysisRecord?.negotiationStages ? data.analysisRecord.negotiationStages.length : 0);

          setNotification({
            type: 'success',
            message: language === 'ru'
              ? `Данные окончательного счета (${data.vendorName}) и ${roundsCount} раунда(ов) переговоров успешно перенесены в форму!`
              : `Son anlaşılan fatura bilgileri (${data.vendorName}), ${roundsCount} ara pazarlık turu ve en uygun ilk teklif bazı forma başarıyla aktarıldı!`
          });
        }}
      />
    </div>
  );
};

export default DiscountEntryForm;
