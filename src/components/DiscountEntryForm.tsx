import { INITIAL_SUPERVISORS, INITIAL_JOBSITES, INITIAL_PERSONNEL } from '../data/initialData';
import React, { useState, useEffect, useMemo } from 'react';
import { PurchasingSupervisor, Jobsite, DiscountRecord, InvoiceItem, InvoiceRecord, Personnel, NegotiationRound, StageDocument, ComparativeAnalysisRecord, CanonicalMaterial } from '../types';
import { formatRuble, formatUploadDate, openOriginalFileViewer } from '../utils/format';
import { getDiscountDocumentStages, StageDocumentItem, getEffectiveAgreedPrice, getEffectiveDiscount, getGenuineNegotiationRoundCount } from '../utils/negotiationStages';
import { checkRecordPermission } from '../utils/permissions';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { NEGOTIATION_THRESHOLD, validateProcedure52 } from '../utils/procedureConfig';
import { CANONICAL_CATEGORIES } from '../utils/categoryClassifier';
import {
  convertMaterialUnit,
  extractTechnicalSpecs,
  detectMaterialType,
  normalizeVatPrice,
  generateAnalysisCode
} from '../utils/comparativeCalculation';

import { matchLines } from '../utils/invoiceLineMatcher';
import { findCheaperHistoricalBenchmarksForItems } from '../utils/preApprovalAuditEngine';
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
  RotateCcw,
  Scale,
  FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { EditDiscountModal } from './EditDiscountModal';
import { DiscountDetailModal } from './DiscountDetailModal';
import { PaginationControls } from './PaginationControls';
import { ComparativeOfferAnalysisModal } from './ComparativeOfferAnalysisModal';
import { ComparativeAnalysisDetailModal } from './ComparativeAnalysisDetailModal';
import { SearchableFilterDropdown } from './SearchableFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';
import { DateFilterState, matchesDateFilter } from '../utils/filterHelpers';
import { normalizeVendorName, getVendorKey, areVendorsEqual, extractCanonicalVendors, isValidInvoiceNumber } from '../utils/vendorNormalizer';

interface Props {
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  personnel?: Personnel[];
  discounts?: DiscountRecord[];
  invoices?: InvoiceRecord[];
  prizmaInvoices?: InvoiceRecord[];
  onSaveDiscount: (record: Omit<DiscountRecord, 'id' | 'supervisorName' | 'jobsiteName' | 'discountAmount' | 'discountPercentage' | 'status'> & { forceSave?: boolean; forceSaveDuplicate?: boolean; firstOfferFileData?: string; finalOfferFileData?: string }) => void | Promise<void>;
  onUpdateDiscount?: (id: string, record: Partial<DiscountRecord>) => Promise<void> | void;
  onDeleteDiscount?: (id: string) => Promise<void> | void;
  onSuccess: () => void;
  isModal?: boolean;
  onPendingDiscountScanChange?: (pending: { supplier: string; invoiceNumber: string; totalAmount: number; openModal: () => void } | null) => void;
}

export const DiscountEntryForm: React.FC<Props> = ({
  supervisors,
  jobsites,
  personnel = [],
  discounts = [],
  invoices = [],
  prizmaInvoices = [],
  onSaveDiscount,
  onUpdateDiscount,
  onDeleteDiscount,
  onSuccess,
  isModal = false,
  onPendingDiscountScanChange
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
      grossUnitPrice?: number;
      totalPrice: number;
      grossTotalPrice?: number;
      unitPriceNet?: number;
      vatPercentage?: number;
      isGrossInvoicePrice?: boolean;
      lineSource?: string;
      discountAmount?: number;
    }>;
    reconciliationStatus?: 'EXACT_MATCH' | 'CORRECTED_FROM_PDF' | 'MISMATCH_WARNING';
    reconciliationNotes?: string[];
    rounds?: NegotiationRound[];
  } | null>(null);

  // States for handling drag/upload inside the AI Review Modal
  const [modalRoundLoadingIndex, setModalRoundLoadingIndex] = useState<number | null>(null);
  const [isModalRoundDragOver, setIsModalRoundDragOver] = useState<boolean>(false);
  const [isAiModalMinimized, setIsAiModalMinimized] = useState<boolean>(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ isDuplicate: boolean; message: string; existingRecord?: any } | null>(null);
  const [forceSaveDuplicate, setForceSaveDuplicate] = useState<boolean>(false);

  // TDF-Style Unified Multi-Document Upload & Smart Negotiation Stage State
  const [stagedOfferDocs, setStagedOfferDocs] = useState<Array<{
    id: string;
    file?: File;
    fileName: string;
    base64?: string;
    fileUrl?: string;
    fileId?: string;
    role: 'initial_offer' | 'negotiation_round' | 'final_invoice';
    roundNumber: 1 | 2 | 3 | 4 | 5;
    status: 'pending' | 'scanning' | 'analyzed' | 'error';
    errorMsg?: string;
    supplier?: string;
    invoiceNumber?: string;
    date?: string;
    category?: string;
    totalAmount: number;
    isVatIncluded?: boolean;
    itemsCount?: number;
    items?: Array<{
      materialName: string;
      originalName?: string;
      category?: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      discountAmount?: number;
    }>;
    usedModel?: string;
  }>>([]);
  const [autoSortByPrice, setAutoSortByPrice] = useState<boolean>(true);
  const [isMultiScanning, setIsMultiScanning] = useState<boolean>(false);
  const [isMultiDragOver, setIsMultiDragOver] = useState<boolean>(false);
  const [archiveViewMode, setArchiveViewMode] = useState<'discounts' | 'tdf'>('discounts');
  const [savedTdfAnalyses, setSavedTdfAnalyses] = useState<ComparativeAnalysisRecord[]>([]);
  const [loadingTdfArchive, setLoadingTdfArchive] = useState<boolean>(false);
  const [selectedTdfDetail, setSelectedTdfDetail] = useState<ComparativeAnalysisRecord | null>(null);

  const loadSavedTdfAnalyses = async () => {
    try {
      setLoadingTdfArchive(true);
      const res = await fetch(`/api/comparative-analyses?_t=${Date.now()}`, {
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': user?.token || '',
          'x-user-role': encodeURIComponent(user?.role || ''),
          'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''),
          'x-user-name': encodeURIComponent(user?.displayName || '')
        }
      });
      if (res.ok) {
        const data = await res.json();
        setSavedTdfAnalyses(Array.isArray(data) ? data.filter((a: any) => !a.isDeleted) : []);
      }
    } catch (e) {
      console.warn('[LOAD TDF ARCHIVE WARN]:', e);
    } finally {
      setLoadingTdfArchive(false);
    }
  };

  useEffect(() => {
    void loadSavedTdfAnalyses();
  }, [discounts?.length]);

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

      // 4. Smartly insert and sort all stages (offerPrice -> rounds -> agreedPrice) so lowest is always agreedPrice!
      setAiReviewModal(prev => {
        if (!prev) return prev;
        const baseOffer = Number(prev.offerPrice) || 0;
        const currentAgreed = Number(prev.agreedPrice) || 0;
        const effectiveNewPrice = readAmount > 0
          ? readAmount
          : (prevPrice > currentAgreed && currentAgreed > 0 ? Math.round(prevPrice - (prevPrice - currentAgreed) * 0.5) : Math.round(prevPrice * 0.95));

        if (effectiveNewPrice > 0 && baseOffer > 0 && effectiveNewPrice >= baseOffer) {
          setNotification({
            type: 'error',
            message: `⚠️ Yüklenen belgedeki teklif tutarı (${formatRuble(effectiveNewPrice)}) ilk tekliften (${formatRuble(baseOffer)}) daha düşük olmalıdır!`
          });
          return prev;
        }

        // Gather all existing intermediate rounds + currentAgreed + new document, then sort descending!
        const candidateDocs: Array<{ price: number; docName: string; docUrl?: string; note?: string }> = [];
        if (currentAgreed > 0) {
          candidateDocs.push({
            price: currentAgreed,
            docName: prev.fileName || finalOfferFile?.name || '2_Indirimli_Teklif.pdf',
            docUrl: finalOfferFile?.url
          });
        }
        for (const r of (prev.rounds || [])) {
          if (Number(r.quotedPrice) > 0) {
            candidateDocs.push({
              price: Number(r.quotedPrice),
              docName: r.documentName || 'Ara_Teklif.pdf',
              docUrl: r.documentUrl,
              note: r.note
            });
          }
        }
        candidateDocs.push({
          price: effectiveNewPrice,
          docName: file.name,
          docUrl: vaultRes.url
        });

        // Sort descending (highest price first = 1. Tur, ..., lowest price last = Nihai Anlaşılan Fatura)
        candidateDocs.sort((a, b) => b.price - a.price);

        const finalCandidate = candidateDocs[candidateDocs.length - 1];
        const roundCandidates = candidateDocs.slice(0, candidateDocs.length - 1);

        let stepPrev = baseOffer;
        const rebuiltRounds: NegotiationRound[] = roundCandidates.map((rc, i) => {
          const disc = Math.max(0, stepPrev - rc.price);
          const rnd: NegotiationRound = {
            id: `rnd_modal_${Date.now()}_${i + 1}`,
            roundNumber: i + 1,
            date: new Date().toISOString().split('T')[0],
            vendorName: prev.vendorName || vendorName || 'Tedarikçi Firma',
            previousPrice: stepPrev,
            quotedPrice: rc.price,
            discountThisRound: disc,
            documentName: rc.docName,
            documentUrl: rc.docUrl,
            note: rc.note || `${i + 1}. Tur: ${formatRuble(stepPrev)} → ${formatRuble(rc.price)} (-${formatRuble(disc)})`
          };
          stepPrev = rc.price;
          return rnd;
        });

        setNotification({
          type: 'success',
          message: `✨ Pazarlık aşamaları tutara göre otomatik sıralandı: ${rebuiltRounds.length} Ara Tur ve Nihai Fatura (${formatRuble(finalCandidate.price)}) güncellendi.`
        });

        return {
          ...prev,
          agreedPrice: finalCandidate.price,
          fileName: finalCandidate.docName,
          rounds: rebuiltRounds
        };
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
      let firstOfferFn = undefined;
      if (offerType === 'final' && firstOfferFile) {
        firstOfferBase64 = firstOfferFile.base64 || (firstOfferFile.url?.startsWith('data:') ? firstOfferFile.url : undefined);
        firstOfferFn = firstOfferFile.name || firstOfferFileName || undefined;
      }
      let extractedData: any = null;
      let usedModelName = 'gemini-3.8-flash';
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
            excelCsv: fileTextContext || undefined,
            offerType,
            scanMode: offerType === 'first' ? 'summary-only' : 'full',
            firstOfferContext,
            firstOfferBase64,
            firstOfferFileName: firstOfferFn
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
          extractedData = {
            ...data.extracted,
            _reconciliationStatus: data.validation?.reconciliationStatus,
            _reconciliationNotes: data.validation?.reconciliationNotes
          };
          if (data.usedModel) {
            usedModelName = data.usedModel;
          }
          if (data.duplicateInfo?.isDuplicate) {
            setDuplicateWarning({
              isDuplicate: true,
              message: data.duplicateInfo.message?.startsWith('Bu fatura sistemde kayıtlı')
                ? data.duplicateInfo.message
                : `Bu fatura sistemde kayıtlı! ${data.duplicateInfo.message || 'Daha önce sisteme yüklenmiş bir fatura ile eşleşti.'}`,
              existingRecord: data.duplicateInfo.existingInvoice
            });
            setForceSaveDuplicate(false);
          } else {
            setDuplicateWarning(null);
            setForceSaveDuplicate(false);
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
      const formattedItems = rawItems.map((it: any) => {
        const qty = Number(it.quantity) || 1;
        const uPrice = Number(it.unitPrice) || 0;
        const tPrice = Number(it.totalPrice) || Number((qty * uPrice).toFixed(2));
        return {
          materialName: it.materialName || 'İnşaat Malzemesi',
          originalName: it.originalName || it.materialName || '',
          category: it.category || finalCategory,
          unit: it.unit || 'Adet',
          quantity: qty,
          unitPrice: uPrice,
          grossUnitPrice: Number(it.grossUnitPrice ?? uPrice) || 0,
          totalPrice: tPrice,
          grossTotalPrice: Number(it.grossTotalPrice ?? tPrice) || 0,
          unitPriceNet: Number(it.unitPriceNet) || 0,
          vatPercentage: Number(it.vatPercentage ?? extractedData?.vatPercentage ?? 20),
          isGrossInvoicePrice: true,
          lineSource: it.lineSource || 'AI',
          discountAmount: Number(it.discountAmount) || 0
        };
      });

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
        setIsAiModalMinimized(false);
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
          reconciliationStatus: extractedData?._reconciliationStatus,
          reconciliationNotes: extractedData?._reconciliationNotes,
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

      try {
        const res = await uploadToServerVault(file.name, base64Data);
        if (res && res.url) {
          setFirstOfferFile({ name: file.name, url: res.url, base64: base64Data, fileId: res.fileId });
        } else {
          setFirstOfferFile({ name: file.name, url: '', base64: base64Data });
        }
      } catch (uploadErr: any) {
        console.warn('handleFirstOfferUpload direct upload warning, keeping base64 fallback:', uploadErr);
        setFirstOfferFile({ name: file.name, url: '', base64: base64Data });
      }
    } catch (err: any) {
      console.error('handleFirstOfferUpload failed:', err);
      setFirstOfferFile(null);
      setFirstOfferFileName('');
      setNotification({ type: 'error', message: `İlk teklif belgesi okunamadı: ${err.message || 'Sunucu hatası'}.` });
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

      try {
        const res = await uploadToServerVault(file.name, base64Data);
        if (res && res.url) {
          setFinalOfferFile({ name: file.name, url: res.url, base64: base64Data, fileId: res.fileId });
        } else {
          setFinalOfferFile({ name: file.name, url: '', base64: base64Data });
        }
      } catch (uploadErr: any) {
        console.warn('handleFinalOfferUpload direct upload warning, keeping base64 fallback:', uploadErr);
        setFinalOfferFile({ name: file.name, url: '', base64: base64Data });
      }
    } catch (err: any) {
      console.error('handleFinalOfferUpload failed:', err);
      setFinalOfferFile(null);
      setFinalOfferFileName('');
      setNotification({ type: 'error', message: `Son teklif/fatura belgesi okunamadı: ${err.message || 'Sunucu hatası'}.` });
      return;
    }

    await processOfferDocument(file, 'final', base64Data);
  };

  // Load 1-Click Demo Multi-Stage Negotiation Preset
  const handleLoadDemoPreset = () => {
    setVendorName('ООО "РУС-ГАРАНТ"');
    setCategory('Seramik & Vitrifiye');
    setOfferPrice('675547.14');
    setAgreedPrice('672190.50');
    setNotes('İlk teklif (675.547,14 ₽) üzerinden 1. Tur ara pazarlık (674.688,00 ₽) ve nihai anlaşma (672.190,50 ₽) ile birim fiyat 512,86 ₽ seviyesinden 509,50 ₽ seviyesine indirildi.');
    setFirstOfferFileName('1_Ilk_Teklif_Rus_Garant_3257.pdf');
    setFinalOfferFileName('3_Nihai_Anlasilan_Fatura_Rus_Garant_3257.pdf');
    setFirstOfferFile({ name: '1_Ilk_Teklif_Rus_Garant_3257.pdf', url: '' });
    setFinalOfferFile({ name: '3_Nihai_Anlasilan_Fatura_Rus_Garant_3257.pdf', url: '' });
    setInvoiceNo('3257');
    setOrderDate('2026-10-16');

    const demoStaged = [
      {
        id: `demo_doc_1_${Date.now()}`,
        fileName: '1_Ilk_Teklif_Rus_Garant_3257.pdf',
        fileUrl: '',
        role: 'initial_offer' as const,
        roundNumber: 1 as const,
        status: 'analyzed' as const,
        supplier: 'ООО "РУС-ГАРАНТ"',
        invoiceNumber: '3257',
        date: '2026-10-16',
        category: 'Seramik & Vitrifiye',
        totalAmount: 675547.14,
        itemsCount: 2,
        usedModel: 'gemini-3.8-flash',
        items: [
          { materialName: 'Напольное покрытие MASTER PROXI 2 3 м', unit: 'м2', quantity: 999, unitPrice: 512.86, totalPrice: 512347.14 },
          { materialName: 'Клей для напольных покрытий Soudal 26A 15 кг', unit: 'шт', quantity: 40, unitPrice: 4080.00, totalPrice: 163200.00 }
        ]
      },
      {
        id: `demo_doc_2_${Date.now()}`,
        fileName: '2_Ara_Pazarlik_1_Tur_Rus_Garant_3257.pdf',
        fileUrl: '',
        role: 'negotiation_round' as const,
        roundNumber: 1 as const,
        status: 'analyzed' as const,
        supplier: 'ООО "РУС-ГАРАНТ"',
        invoiceNumber: '3257',
        date: '2026-10-16',
        category: 'Seramik & Vitrifiye',
        totalAmount: 674688.00,
        itemsCount: 2,
        usedModel: 'gemini-3.8-flash',
        items: [
          { materialName: 'Напольное покрытие MASTER PROXI 2 3 м', unit: 'м2', quantity: 999, unitPrice: 512.00, totalPrice: 511488.00 },
          { materialName: 'Клей для напольных покрытий Soudal 26A 15 кг', unit: 'шт', quantity: 40, unitPrice: 4080.00, totalPrice: 163200.00 }
        ]
      },
      {
        id: `demo_doc_3_${Date.now()}`,
        fileName: '3_Nihai_Anlasilan_Fatura_Rus_Garant_3257.pdf',
        fileUrl: '',
        role: 'final_invoice' as const,
        roundNumber: 1 as const,
        status: 'analyzed' as const,
        supplier: 'ООО "РУС-ГАРАНТ"',
        invoiceNumber: '3257',
        date: '2026-10-16',
        category: 'Seramik & Vitrifiye',
        totalAmount: 672190.50,
        itemsCount: 2,
        usedModel: 'gemini-3.8-flash',
        items: [
          { materialName: 'Напольное покрытие MASTER PROXI 2 3 м', unit: 'м2', quantity: 999, unitPrice: 509.50, totalPrice: 508990.50 },
          { materialName: 'Клей для напольных покрытий Soudal 26A 15 кг', unit: 'шт', quantity: 40, unitPrice: 4080.00, totalPrice: 163200.00 }
        ]
      }
    ];
    setStagedOfferDocs(demoStaged);
    setExtractedItems(demoStaged[2].items);
    setNegotiationRounds([
      {
        id: `rnd_demo_${Date.now()}`,
        roundNumber: 1,
        date: '2026-10-16',
        vendorName: 'ООО "РУС-ГАРАНТ"',
        previousPrice: 675547.14,
        quotedPrice: 674688.00,
        discountThisRound: 859.14,
        documentName: '2_Ara_Pazarlik_1_Tur_Rus_Garant_3257.pdf',
        documentUrl: '',
        note: '1. Tur Ara Pazarlık: Birim fiyat 512,86 ₽ → 512,00 ₽ seviyesine çekildi.'
      }
    ]);
  };

  // Smart Role & Round Sorter based on document amounts
  const applySmartPriceSortToDocs = (docs: typeof stagedOfferDocs, forceAllByPrice = false) => {
    if (docs.length < 2) return docs;
    const validWithPrice = docs.filter(d => d.totalAmount > 0);
    if (validWithPrice.length < 2) return docs;

    // Check if user explicitly selected multiple initial_offer documents
    const explicitInitials = docs.filter(d => d.role === 'initial_offer' && d.totalAmount > 0);
    const minOverallPrice = Math.min(...validWithPrice.map(d => d.totalAmount));

    // If user marked 2+ initial offers and they are all > minOverallPrice, preserve those initial offers!
    if (!forceAllByPrice && explicitInitials.length >= 2 && explicitInitials.every(d => d.totalAmount > minOverallPrice)) {
      const initialIds = new Set(explicitInitials.map(d => d.id));
      const nonInitials = docs
        .filter(d => !initialIds.has(d.id) && d.totalAmount > 0)
        .sort((a, b) => b.totalAmount - a.totalAmount);

      if (nonInitials.length === 0) return docs;
      const finalDocId = nonInitials[nonInitials.length - 1].id;
      const roundDocsList = nonInitials.slice(0, nonInitials.length - 1);
      const roundMap = new Map<string, 1 | 2 | 3 | 4 | 5>();
      roundDocsList.forEach((rd, idx) => {
        roundMap.set(rd.id, Math.min(5, idx + 1) as 1 | 2 | 3 | 4 | 5);
      });

      return docs.map(d => {
        if (initialIds.has(d.id)) return { ...d, role: 'initial_offer' as const };
        if (d.id === finalDocId) return { ...d, role: 'final_invoice' as const };
        if (roundMap.has(d.id)) return { ...d, role: 'negotiation_round' as const, roundNumber: roundMap.get(d.id)! };
        return d;
      });
    }

    // Standard Smart Sort: Sort all priced documents descending (Highest = İlk Teklif, Middle = 1..5. Tur, Lowest = Nihai Fatura)
    const sortedByPriceDesc = [...validWithPrice].sort((a, b) => b.totalAmount - a.totalAmount);
    const highestId = sortedByPriceDesc[0].id;
    const lowestId = sortedByPriceDesc[sortedByPriceDesc.length - 1].id;
    const middleDocs = sortedByPriceDesc.slice(1, sortedByPriceDesc.length - 1);
    const middleRoundMap = new Map<string, 1 | 2 | 3 | 4 | 5>();
    middleDocs.forEach((md, idx) => {
      middleRoundMap.set(md.id, Math.min(5, idx + 1) as 1 | 2 | 3 | 4 | 5);
    });

    // Also reorder the array itself from highest price to lowest price so visual list matches the ladder
    const unpricedDocs = docs.filter(d => !(d.totalAmount > 0));
    const reordered = [
      ...sortedByPriceDesc.map(d => {
        if (d.id === highestId) return { ...d, role: 'initial_offer' as const, roundNumber: 1 as const };
        if (d.id === lowestId) return { ...d, role: 'final_invoice' as const, roundNumber: 1 as const };
        return {
          ...d,
          role: 'negotiation_round' as const,
          roundNumber: middleRoundMap.get(d.id) || (1 as const)
        };
      }),
      ...unpricedDocs
    ];
    return reordered;
  };

  // Sync stagedOfferDocs into main form fields whenever analyzed docs or roles change
  const syncStagedDocsToForm = (docs: typeof stagedOfferDocs) => {
    const priced = docs.filter(d => d.totalAmount > 0);
    if (priced.length === 0) return;

    const initials = priced.filter(d => d.role === 'initial_offer');
    const finals = priced.filter(d => d.role === 'final_invoice');
    const rounds = priced
      .filter(d => d.role === 'negotiation_round')
      .sort((a, b) => (a.roundNumber !== b.roundNumber ? a.roundNumber - b.roundNumber : b.totalAmount - a.totalAmount));

    const minOverallDoc = [...priced].sort((a, b) => a.totalAmount - b.totalAmount)[0];
    const maxOverallDoc = [...priced].sort((a, b) => b.totalAmount - a.totalAmount)[0];
    const validInitialsAboveMin = initials.filter(d => d.totalAmount > (minOverallDoc?.totalAmount || 0));

    // TDF Rule: Base initial offer is the LOWEST among initial offers that are > final price (or highest priced doc if inverted)
    const baselineDoc = validInitialsAboveMin.length > 0
      ? [...validInitialsAboveMin].sort((a, b) => a.totalAmount - b.totalAmount)[0]
      : maxOverallDoc;

    const validFinalsBelowBase = finals.filter(d => d.id !== baselineDoc?.id && d.totalAmount <= (baselineDoc?.totalAmount || Infinity));
    const finalDoc = validFinalsBelowBase.length > 0
      ? [...validFinalsBelowBase].sort((a, b) => a.totalAmount - b.totalAmount)[0]
      : minOverallDoc;

    if (baselineDoc && baselineDoc.totalAmount > 0) {
      setOfferPrice(String(baselineDoc.totalAmount));
      setFirstOfferFileName(baselineDoc.fileName);
      setFirstOfferFile({
        name: baselineDoc.fileName,
        url: baselineDoc.fileUrl || '',
        base64: baselineDoc.base64,
        fileId: baselineDoc.fileId
      });
      if (baselineDoc.itemsCount && baselineDoc.itemsCount > 0) {
        setFirstOfferItemCount(baselineDoc.itemsCount);
      }
    }

    if (finalDoc && finalDoc.totalAmount > 0 && finalDoc.id !== baselineDoc?.id) {
      setAgreedPrice(String(finalDoc.totalAmount));
      setFinalOfferFileName(finalDoc.fileName);
      setFinalOfferFile({
        name: finalDoc.fileName,
        url: finalDoc.fileUrl || '',
        base64: finalDoc.base64,
        fileId: finalDoc.fileId
      });
      if (finalDoc.items && finalDoc.items.length > 0) {
        setExtractedItems(finalDoc.items);
      }
    }

    const bestSupplier = finalDoc?.supplier || baselineDoc?.supplier || priced.find(d => d.supplier)?.supplier;
    if (bestSupplier) setVendorName(bestSupplier);

    const bestCat = finalDoc?.category || baselineDoc?.category || priced.find(d => d.category)?.category;
    if (bestCat) setCategory(bestCat);

    const bestInvNo = finalDoc?.invoiceNumber || baselineDoc?.invoiceNumber || priced.find(d => d.invoiceNumber)?.invoiceNumber;
    if (bestInvNo) setInvoiceNo(bestInvNo);

    const bestDate = finalDoc?.date || baselineDoc?.date || priced.find(d => d.date)?.date;
    if (bestDate) setOrderDate(bestDate);

    // Build negotiationRounds from intermediate round documents
    let prevStepPrice = baselineDoc ? baselineDoc.totalAmount : 0;
    const builtRounds: NegotiationRound[] = rounds.map((rd, idx) => {
      const disc = Math.max(0, prevStepPrice - rd.totalAmount);
      const nr: NegotiationRound = {
        id: `rnd_staged_${rd.id}`,
        roundNumber: rd.roundNumber || (idx + 1),
        date: rd.date || orderDate || new Date().toISOString().split('T')[0],
        vendorName: rd.supplier || bestSupplier || vendorName || 'Tedarikçi Firma',
        previousPrice: prevStepPrice,
        quotedPrice: rd.totalAmount,
        discountThisRound: disc,
        documentName: rd.fileName,
        documentUrl: rd.fileUrl,
        note: `${rd.roundNumber || (idx + 1)}. Tur Ara Pazarlık: ${formatRuble(prevStepPrice)} → ${formatRuble(rd.totalAmount)} (-${formatRuble(disc)})`
      };
      prevStepPrice = rd.totalAmount;
      return nr;
    });
    setNegotiationRounds(builtRounds);
  };

  // Add multiple or single files to the unified TDF-style staging table
  const handleAddStagedFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const currentLen = stagedOfferDocs.length;
    const totalLen = currentLen + filesArray.length;

    const newEntries = filesArray.map((file, idx) => {
      const globalIdx = currentLen + idx;
      let defaultRole: 'initial_offer' | 'negotiation_round' | 'final_invoice' = 'initial_offer';
      let defaultRound: 1 | 2 | 3 | 4 | 5 = 1;

      if (totalLen === 1) {
        defaultRole = 'initial_offer';
      } else if (globalIdx === 0 && !stagedOfferDocs.some(d => d.role === 'initial_offer')) {
        defaultRole = 'initial_offer';
      } else if (globalIdx === totalLen - 1) {
        defaultRole = 'final_invoice';
      } else {
        defaultRole = 'negotiation_round';
        defaultRound = Math.min(5, Math.max(1, globalIdx)) as 1 | 2 | 3 | 4 | 5;
      }

      return {
        id: `staged_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        fileName: file.name,
        role: defaultRole,
        roundNumber: defaultRound,
        status: 'pending' as const,
        totalAmount: 0
      };
    });

    // If adding new files when an existing doc was final_invoice, shift previous final_invoice to negotiation_round if needed
    const updatedExisting = stagedOfferDocs.map((d, i) => {
      if (filesArray.length > 0 && d.role === 'final_invoice' && i < totalLen - 1) {
        return {
          ...d,
          role: 'negotiation_round' as const,
          roundNumber: Math.min(5, Math.max(1, i)) as 1 | 2 | 3 | 4 | 5
        };
      }
      return d;
    });

    const combined = [...updatedExisting, ...newEntries];
    setStagedOfferDocs(combined);
  };

  // Analyze all staged documents with AI OCR + Hybrid Excel/PDF reader
  const handleStartMultiDocAnalysis = async () => {
    if (stagedOfferDocs.length === 0 || isMultiScanning) return;
    setIsMultiScanning(true);
    setNotification(null);

    try {
      const updatedDocs = [...stagedOfferDocs];

      // Mark all pending/error docs as scanning
      setStagedOfferDocs(prev =>
        prev.map(d => (d.status === 'analyzed' && d.totalAmount > 0 ? d : { ...d, status: 'scanning', errorMsg: undefined }))
      );

      await Promise.all(
        updatedDocs.map(async (docItem, idx) => {
          if (docItem.status === 'analyzed' && docItem.totalAmount > 0 && !docItem.file) {
            return;
          }
          const file = docItem.file;
          if (!file && !docItem.base64) return;

          try {
            const base64Data = docItem.base64 || (file ? await readFileOrCompressImage(file) : '');
            let uploadedUrl = docItem.fileUrl || '';
            let uploadedFileId = docItem.fileId;

            if (!uploadedUrl && base64Data) {
              try {
                const upRes = await uploadToServerVault(docItem.fileName, base64Data);
                if (upRes?.url) {
                  uploadedUrl = upRes.url;
                  uploadedFileId = upRes.fileId;
                }
              } catch (upErr) {
                console.warn('Staged file vault upload fallback to base64:', upErr);
              }
            }

            // Optional local Excel parsing if spreadsheet
            let fileTextContext = '';
            let calculatedExcelTotal = 0;
            if (file && (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv'))) {
              try {
                const arrayBuffer = await file.arrayBuffer();
                const wb = XLSX.read(arrayBuffer, { type: 'array' });
                const firstSheet = wb.Sheets[wb.SheetNames[0]];
                fileTextContext = XLSX.utils.sheet_to_csv(firstSheet);
              } catch (exErr) {
                console.warn('Excel parse warning:', exErr);
              }
            }

            const res = await fetch('/api/discounts/process-ai', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fileBase64: base64Data,
                mimeType: file?.type || 'application/pdf',
                fileName: docItem.fileName,
                fileTextContext: fileTextContext || undefined,
                excelCsv: fileTextContext || undefined,
                offerType: docItem.role === 'initial_offer' ? 'first' : 'final',
                scanMode: 'full'
              })
            });

            const data = await res.json();
            if (!res.ok || !data.success || !data.extracted) {
              throw new Error(data.error || 'Belge okunamadı');
            }

            if (data.duplicateInfo?.isDuplicate) {
              setDuplicateWarning({
                isDuplicate: true,
                message: data.duplicateInfo.message?.startsWith('Bu fatura sistemde kayıtlı')
                  ? data.duplicateInfo.message
                  : `Bu fatura sistemde kayıtlı! ${data.duplicateInfo.message || 'Daha önce sisteme yüklenmiş bir fatura ile eşleşti.'}`,
                existingRecord: data.duplicateInfo.existingInvoice
              });
              setForceSaveDuplicate(false);
            }

            const ext = data.extracted;
            const rawItems = Array.isArray(ext.items) ? ext.items : [];
            const formattedItems = rawItems.map((it: any) => ({
              materialName: it.materialName || 'İnşaat Malzemesi',
              originalName: it.originalName || it.materialName || '',
              category: it.category || ext.category || 'Diğer Malzeme',
              unit: it.unit || 'Adet',
              quantity: Number(it.quantity) || 1,
              unitPrice: Number(it.unitPrice) || 0,
              totalPrice: Number(it.totalPrice) || (Number(it.quantity) * Number(it.unitPrice)),
              discountAmount: Number(it.discountAmount) || 0
            }));

            const itemsSum = formattedItems.reduce((s: number, i: any) => s + (Number(i.totalPrice) || 0), 0);
            const detectedTotal = Number(ext.totalAmount) || itemsSum || calculatedExcelTotal || 0;
            const detectedVendor = String(ext.vendorName || ext.supplier || ext.company || '').trim();

            updatedDocs[idx] = {
              ...docItem,
              base64: base64Data,
              fileUrl: uploadedUrl,
              fileId: uploadedFileId,
              status: 'analyzed',
              errorMsg: undefined,
              supplier: detectedVendor || docItem.supplier,
              invoiceNumber: String(ext.invoiceNumber || docItem.invoiceNumber || '').trim(),
              date: String(ext.date || docItem.date || new Date().toISOString().split('T')[0]).trim(),
              category: ext.category || docItem.category,
              totalAmount: detectedTotal,
              itemsCount: formattedItems.length || Number(ext.itemCount || ext.itemsCount || 0),
              items: formattedItems,
              usedModel: data.usedModel || 'gemini-3.8-flash'
            };
          } catch (err: any) {
            console.error(`Error scanning ${docItem.fileName}:`, err);
            updatedDocs[idx] = {
              ...docItem,
              status: 'error',
              errorMsg: err.message || 'Okuma hatası'
            };
          }
        })
      );

      // Apply smart sorting if enabled or if prices are inverted (e.g. final_invoice > initial_offer)
      let finalDocsState = updatedDocs;
      const analyzedCount = updatedDocs.filter(d => d.totalAmount > 0).length;
      if (analyzedCount >= 2) {
        const initPrices = updatedDocs.filter(d => d.role === 'initial_offer' && d.totalAmount > 0).map(d => d.totalAmount);
        const finPrices = updatedDocs.filter(d => d.role === 'final_invoice' && d.totalAmount > 0).map(d => d.totalAmount);
        const minInit = initPrices.length > 0 ? Math.min(...initPrices) : 0;
        const maxFin = finPrices.length > 0 ? Math.max(...finPrices) : 0;
        const isInverted = (minInit > 0 && maxFin > minInit) || initPrices.length === 0 || finPrices.length === 0;

        if (autoSortByPrice || isInverted) {
          finalDocsState = applySmartPriceSortToDocs(updatedDocs);
        }
      }

      setStagedOfferDocs(finalDocsState);
      syncStagedDocsToForm(finalDocsState);

      if (analyzedCount > 0) {
        setNotification({
          type: 'success',
          message: `✨ ${analyzedCount} adet teklif/fatura belgesi başarıyla analiz edildi, en düşük ilk teklif baz alınarak pazarlık turları ve şematik indirim tablosu oluşturuldu!`
        });
      }
    } finally {
      setIsMultiScanning(false);
    }
  };

  // Real-time Schematic Negotiation & TDF Canonical Analysis computed from stagedOfferDocs
  const schematicAnalysis = useMemo(() => {
    const getEffectiveDocTotal = (d: typeof stagedOfferDocs[0]) => {
      const raw = Number(d.totalAmount) || 0;
      return d.isVatIncluded === false ? Number((raw * 1.2).toFixed(2)) : raw;
    };

    const pricedDocs = stagedOfferDocs
      .filter(d => d.totalAmount > 0)
      .map(d => ({
        ...d,
        rawTotalAmount: d.totalAmount,
        totalAmount: getEffectiveDocTotal(d)
      }));
    if (pricedDocs.length === 0) return null;

    const initialDocs = pricedDocs
      .filter(d => d.role === 'initial_offer')
      .sort((a, b) => a.totalAmount - b.totalAmount); // sorted lowest first so [0] is lowest initial offer!

    const roundDocs = pricedDocs
      .filter(d => d.role === 'negotiation_round')
      .sort((a, b) => (a.roundNumber !== b.roundNumber ? a.roundNumber - b.roundNumber : b.totalAmount - a.totalAmount));

    const finalDocs = pricedDocs
      .filter(d => d.role === 'final_invoice')
      .sort((a, b) => a.totalAmount - b.totalAmount);

    const minOverallDoc = [...pricedDocs].sort((a, b) => a.totalAmount - b.totalAmount)[0];
    const maxOverallDoc = [...pricedDocs].sort((a, b) => b.totalAmount - a.totalAmount)[0];
    const validInitialsAboveMin = initialDocs.filter(d => d.totalAmount > (minOverallDoc?.totalAmount || 0));

    // TDF Rule: Take the lowest initial offer (above final price) as the reference baseline
    const baselineDoc = validInitialsAboveMin.length > 0
      ? validInitialsAboveMin[0]
      : maxOverallDoc;

    const validFinalsBelowBase = finalDocs.filter(d => d.id !== baselineDoc?.id && d.totalAmount <= (baselineDoc?.totalAmount || Infinity));
    const finalDoc = validFinalsBelowBase.length > 0
      ? validFinalsBelowBase[0]
      : minOverallDoc;

    const rawBaselineAmount = baselineDoc?.totalAmount || 0;
    const deduction = Number(scopeDeductionAmount) || 0;
    const effectiveBaseline = deduction > 0 ? Math.max(0, rawBaselineAmount - deduction) : rawBaselineAmount;
    const finalAmount = finalDoc?.totalAmount || 0;

    // Distinct suppliers & TDF Analysis Code
    const distinctSuppliers = Array.from(
      new Set(
        pricedDocs
          .map(d => normalizeVendorName(d.supplier || vendorName || 'Tedarikçi Firma'))
          .filter(Boolean)
      )
    );
    const uniqueVendorsCount = Math.max(1, distinctSuppliers.length);
    const analysisCode = generateAnalysisCode((discounts?.length || 0) + (savedTdfAnalyses?.length || 0));

    // Build step-by-step schematic nodes
    const steps: Array<{
      id: string;
      stageType: 'initial' | 'round' | 'final';
      badgeLabel: string;
      title: string;
      fileName: string;
      supplier?: string;
      invoiceNumber?: string;
      date?: string;
      previousAmount: number;
      amount: number;
      stepDropAmount: number;
      stepDropPct: number;
      cumulativeDropAmount: number;
      roundNumber?: number;
      vatAdjusted?: boolean;
    }> = [];

    if (baselineDoc) {
      steps.push({
        id: baselineDoc.id,
        stageType: 'initial',
        badgeLabel: initialDocs.length > 1 ? '1. İlk Teklif (En Düşük Dip Fiyat)' : '1. İlk Teklif (Başlangıç)',
        title: baselineDoc.supplier || vendorName || 'Tedarikçi Firma',
        fileName: baselineDoc.fileName,
        supplier: baselineDoc.supplier,
        invoiceNumber: baselineDoc.invoiceNumber,
        date: baselineDoc.date,
        previousAmount: effectiveBaseline,
        amount: effectiveBaseline,
        stepDropAmount: 0,
        stepDropPct: 0,
        cumulativeDropAmount: 0,
        vatAdjusted: baselineDoc.isVatIncluded === false
      });
    }

    let runningPrev = effectiveBaseline;
    roundDocs.forEach((rd, idx) => {
      if (rd.id === baselineDoc?.id || rd.id === finalDoc?.id) return;
      const stepDrop = Math.max(0, runningPrev - rd.totalAmount);
      const stepPct = runningPrev > 0 ? Number(((stepDrop / runningPrev) * 100).toFixed(2)) : 0;
      const cumDrop = Math.max(0, effectiveBaseline - rd.totalAmount);
      steps.push({
        id: rd.id,
        stageType: 'round',
        badgeLabel: `Ara Pazarlık — ${rd.roundNumber || idx + 1}. Tur`,
        title: `${rd.roundNumber || idx + 1}. Tur İndirimli Fatura / Teklif`,
        fileName: rd.fileName,
        supplier: rd.supplier,
        invoiceNumber: rd.invoiceNumber,
        date: rd.date,
        previousAmount: runningPrev,
        amount: rd.totalAmount,
        stepDropAmount: stepDrop,
        stepDropPct: stepPct,
        cumulativeDropAmount: cumDrop,
        roundNumber: rd.roundNumber || idx + 1,
        vatAdjusted: rd.isVatIncluded === false
      });
      runningPrev = rd.totalAmount;
    });

    if (finalDoc && finalDoc.id !== baselineDoc?.id) {
      const stepDrop = Math.max(0, runningPrev - finalDoc.totalAmount);
      const stepPct = runningPrev > 0 ? Number(((stepDrop / runningPrev) * 100).toFixed(2)) : 0;
      const cumDrop = Math.max(0, effectiveBaseline - finalDoc.totalAmount);
      steps.push({
        id: finalDoc.id,
        stageType: 'final',
        badgeLabel: 'Nihai Anlaşılan Fatura',
        title: 'Son Anlaşılan Nihai Fatura',
        fileName: finalDoc.fileName,
        supplier: finalDoc.supplier,
        invoiceNumber: finalDoc.invoiceNumber,
        date: finalDoc.date,
        previousAmount: runningPrev,
        amount: finalDoc.totalAmount,
        stepDropAmount: stepDrop,
        stepDropPct: stepPct,
        cumulativeDropAmount: cumDrop,
        vatAdjusted: finalDoc.isVatIncluded === false
      });
    }

    const totalNetDiscount = Math.max(0, effectiveBaseline - finalAmount);
    const totalNetDiscountPct = effectiveBaseline > 0 ? Number(((totalNetDiscount / effectiveBaseline) * 100).toFixed(2)) : 0;

    // TDF Canonical Item Matching + VAT Normalization + Unit Conversion (Ton ↔ Metre ↔ Adet)
    const baseItems = baselineDoc?.items || [];
    const finalItems = finalDoc?.items || [];
    const purchasedItems = finalItems.length > 0 ? finalItems : baseItems;
    const maxItemsLen = purchasedItems.length;
    const activeRounds = roundDocs.filter(rd => rd.id !== baselineDoc?.id && rd.id !== finalDoc?.id);

    let isAboveBestOfferCount = 0;
    let unitConversionsCount = 0;
    const vatNormalizedDocsCount = pricedDocs.filter(d => d.isVatIncluded === false).length;

    const itemEvolution: Array<{
      materialName: string;
      canonicalName: string;
      specsSummary?: string;
      unit: string;
      quantity: number;
      initialUnitPrice: number;
      marketReferenceSupplier: string;
      roundUnitPrices: Array<{ roundNumber: number; unitPrice: number; conversionNote?: string }>;
      finalUnitPrice: number;
      totalItemSaving: number;
      conversionFormula?: string;
      vatAdjusted?: boolean;
      isAboveBestOffer?: boolean;
      aboveBestOfferDiff?: number;
    }> = [];

    const canonicalMaterials: CanonicalMaterial[] = [];

    // Kalemler belgeler arasında ad/artikel/orijinal Rusça imza ile BİRE BİR eşleştirilir (bkz. invoiceLineMatcher).
    // Eşleşmeyen satıra başka bir malzemenin ilk teklif fiyatı yazılmaz; satır sırasına körü körüne düşülmez.
    const linesForMatch = purchasedItems.filter(Boolean);
    const candidateInitialDocs = initialDocs.length > 0 ? initialDocs : (baselineDoc ? [baselineDoc] : []);
    const initialMatchMaps = new Map<string, number[]>();
    candidateInitialDocs.forEach(d => initialMatchMaps.set(d.id, matchLines(linesForMatch, d.items || [])));
    const roundMatchMaps = new Map<string, number[]>();
    activeRounds.forEach(rd => roundMatchMaps.set(rd.id, matchLines(linesForMatch, rd.items || [])));

    for (let i = 0; i < linesForMatch.length; i++) {
      const fIt = linesForMatch[i];
      if (!fIt) continue;

      const rawMatName = fIt.materialName || fIt.originalName || `Kalem #${i + 1}`;
      const combinedSpecText = `${fIt.originalName || ''} ${rawMatName}`.trim();
      const specs = extractTechnicalSpecs(combinedSpecText);
      const matType = detectMaterialType(combinedSpecText);
      const specBadges = [specs.grade, specs.diameter, specs.dimensions, specs.standard].filter(Boolean);
      const specsSummary = specBadges.length > 0 ? specBadges.join(' • ') : undefined;

      const targetUnit = fIt.unit || 'Adet';
      const qty = Number(fIt.quantity) || 1;

      // Final item VAT normalization
      const rawFinalUp = Number(fIt.unitPrice) || 0;
      const finalVatRes = normalizeVatPrice(rawFinalUp, finalDoc?.isVatIncluded !== false, true, 0.20);
      const finUp = finalVatRes.normalizedPrice;

      // Search across all initialDocs for the lowest normalized unit price (Dip Fiyat) for this material
      let bestInitUp = 0;
      let bestInitSupplier = baselineDoc?.supplier || vendorName || 'İlk Teklif';
      let appliedConversionFormula: string | undefined = undefined;
      let anyVatAdjusted = finalVatRes.vatAdjusted;

      candidateInitialDocs.forEach((initD) => {
        const initItems = initD.items || [];
        const mIdx = initialMatchMaps.get(initD.id)?.[i] ?? -1;
        const matchedItem = mIdx >= 0 ? initItems[mIdx] : undefined;

        if (matchedItem) {
          const rawCandidateUp = Number(matchedItem.unitPrice) || 0;
          if (rawCandidateUp > 0) {
            const vatRes = normalizeVatPrice(rawCandidateUp, initD.isVatIncluded !== false, true, 0.20);
            if (vatRes.vatAdjusted) anyVatAdjusted = true;
            let normUp = vatRes.normalizedPrice;

            // Automatic unit conversion (Ton ↔ Metre ↔ Adet)
            if (matchedItem.unit && targetUnit && matchedItem.unit.toLowerCase().trim() !== targetUnit.toLowerCase().trim()) {
              const conv = convertMaterialUnit({
                materialName: matchedItem.materialName || rawMatName,
                category: matType,
                fromUnit: matchedItem.unit,
                toUnit: targetUnit,
                unitPrice: normUp,
                quantity: Number(matchedItem.quantity) || 1
              });
              if (conv.conversionApplied && conv.convertedUnitPrice > 0) {
                normUp = conv.convertedUnitPrice;
                appliedConversionFormula = conv.formula;
              } else {
                // Birimler farklı ve güvenilir dönüşüm yok: farklı birimlerin fiyatı kıyaslanmaz.
                return;
              }
            }

            if (bestInitUp === 0 || normUp < bestInitUp) {
              bestInitUp = normUp;
              bestInitSupplier = initD.supplier || vendorName || 'İlk Teklif';
            }
          }
        }
      });

      const referenceFound = bestInitUp > 0;
      if (bestInitUp <= 0) {
        bestInitUp = finUp;
      }
      if (appliedConversionFormula) {
        unitConversionsCount += 1;
      }

      // Round unit prices with VAT & unit normalization
      const roundUps = activeRounds.map((rd, rIdx) => {
        const rLineIdx = roundMatchMaps.get(rd.id)?.[i] ?? -1;
        const rItem = rLineIdx >= 0 ? rd.items?.[rLineIdx] : undefined;
        let rUp = Number(rItem?.unitPrice) || 0;
        let rConvNote: string | undefined = undefined;
        if (rUp > 0) {
          const rVat = normalizeVatPrice(rUp, rd.isVatIncluded !== false, true, 0.20);
          rUp = rVat.normalizedPrice;
          if (rItem?.unit && targetUnit && rItem.unit.toLowerCase().trim() !== targetUnit.toLowerCase().trim()) {
            const conv = convertMaterialUnit({
              materialName: rItem.materialName || rawMatName,
              category: matType,
              fromUnit: rItem.unit,
              toUnit: targetUnit,
              unitPrice: rUp,
              quantity: Number(rItem.quantity) || 1
            });
            if (conv.conversionApplied && conv.convertedUnitPrice > 0) {
              rUp = conv.convertedUnitPrice;
              rConvNote = conv.formula;
            }
          }
        }
        return {
          roundNumber: rd.roundNumber || rIdx + 1,
          unitPrice: rUp,
          conversionNote: rConvNote
        };
      });

      const initTot = bestInitUp * qty;
      const finTot = finUp * qty;
      const isItemAboveBest = finUp > bestInitUp + 0.01;
      const itemAboveDiff = isItemAboveBest ? Number((finUp - bestInitUp).toFixed(2)) : 0;
      if (isItemAboveBest) {
        isAboveBestOfferCount += 1;
      }

      const itemSaving = Math.max(0, initTot - finTot);
      const itemSavingPct = initTot > 0 ? Number(((itemSaving / initTot) * 100).toFixed(2)) : 0;

      itemEvolution.push({
        materialName: rawMatName,
        canonicalName: specsSummary ? `${matType} (${specsSummary})` : rawMatName,
        specsSummary,
        unit: targetUnit,
        quantity: qty,
        initialUnitPrice: bestInitUp,
        marketReferenceSupplier: bestInitSupplier,
        roundUnitPrices: roundUps,
        finalUnitPrice: finUp,
        totalItemSaving: itemSaving,
        conversionFormula: appliedConversionFormula,
        vatAdjusted: anyVatAdjusted,
        isAboveBestOffer: isItemAboveBest,
        aboveBestOfferDiff: itemAboveDiff
      });

      canonicalMaterials.push({
        id: `can_mat_${i + 1}_${Date.now()}`,
        commonName: rawMatName,
        originalName: fIt.originalName || rawMatName,
        sourceLineIndex: i,
        referenceFound,
        lineMatchVersion: 2,
        canonicalName: specsSummary ? `${matType} (${specsSummary})` : rawMatName,
        materialType: matType,
        standardUnit: targetUnit,
        specs,
        purchasedQuantity: qty,
        quantity: qty,
        purchasedUnitPrice: finUp,
        purchasedSupplier: finalDoc?.supplier || vendorName || 'Nihai Tedarikçi',
        marketReferenceUnitPrice: bestInitUp,
        marketReferenceSupplier: bestInitSupplier,
        winningFirstUnitPrice: bestInitUp,
        realUnitSavings: Number((bestInitUp - finUp).toFixed(2)),
        realTotalSavings: Number((initTot - finTot).toFixed(2)),
        realSavingsAmount: itemSaving,
        realSavingsPercentage: itemSavingPct,
        realSavingsRate: itemSavingPct,
        internalVendorUnitDiscount: Math.max(0, bestInitUp - finUp),
        internalVendorTotalDiscount: itemSaving,
        isAboveBestOffer: isItemAboveBest,
        aboveBestOfferDiff: itemAboveDiff,
        status: 'confirmed',
        matchConfidence: 0.96,
        matchReason: appliedConversionFormula || 'TDF Kanonik Kalem & Birim Eşleştirmesi',
        lines: []
      });
    }

    return {
      analysisCode,
      uniqueVendorsCount,
      distinctSuppliers,
      isAboveBestOfferCount,
      unitConversionsCount,
      vatNormalizedDocsCount,
      initialDocs,
      baselineDoc,
      roundDocs: activeRounds,
      finalDoc,
      rawBaselineAmount,
      effectiveBaseline,
      finalAmount,
      totalNetDiscount,
      totalNetDiscountPct,
      steps,
      itemEvolution,
      canonicalMaterials
    };
  }, [stagedOfferDocs, scopeDeductionAmount, vendorName, discounts?.length, savedTdfAnalyses?.length]);

  const [firstOfferFileName, setFirstOfferFileName] = useState<string>('');
  const [finalOfferFileName, setFinalOfferFileName] = useState<string>('');

  // Real-time duplicate check across both existing discounts and invoices (Strictly isolated per Supplier)
  const effectiveDuplicateWarning = useMemo(() => {
    const activeNoRaw = String(aiReviewModal?.invoiceNo || invoiceNo || '').trim();
    const activeVendorRaw = String(aiReviewModal?.vendorName || vendorName || '').trim();
    const activeAgreed = Number(aiReviewModal?.agreedPrice || agreedPrice || 0);
    const activeDate = String(aiReviewModal?.orderDate || orderDate || '').trim();

    const cleanNo = activeNoRaw.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const isActiveNoValid = isValidInvoiceNumber(activeNoRaw);
    const cleanSup = normalizeVendorName(activeVendorRaw);

    if (cleanNo || cleanSup) {
      for (const d of (discounts || [])) {
        if ((d as any).isDeleted) continue;
        const dNoRaw = String(d.invoiceNo || '').trim();
        const dNo = dNoRaw.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const isDNoValid = isValidInvoiceNumber(dNoRaw);
        const dSupClean = normalizeVendorName(d.vendorName || '') || d.vendorName || '';
        const sameSup = areVendorsEqual(activeVendorRaw, d.vendorName || '');
        if (!sameSup) continue;

        if (isActiveNoValid && isDNoValid && cleanNo && dNo && cleanNo === dNo) {
          return {
            isDuplicate: true,
            message: `Bu fatura sistemde kayıtlı! "${dNoRaw}" numaralı ve "${dSupClean}" tedarikçili fatura daha önce (${d.orderDate || '-'} / ${d.jobsiteName || 'Şantiye'} - ${formatRuble(d.agreedPrice)}) İndirim Kayıtlarına yüklenmiş.`,
            existingRecord: d
          };
        }
      }
      for (const inv of (invoices || [])) {
        if ((inv as any).isDeleted) continue;
        const iNoRaw = String(inv.invoiceNumber || '').trim();
        const iNo = iNoRaw.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const isINoValid = isValidInvoiceNumber(iNoRaw);
        const iSupClean = normalizeVendorName(inv.supplier || '') || inv.supplier || '';
        const sameSup = areVendorsEqual(activeVendorRaw, inv.supplier || '');
        if (!sameSup) continue;

        if (isActiveNoValid && isINoValid && cleanNo && iNo && cleanNo === iNo) {
          return {
            isDuplicate: true,
            message: `Bu fatura sistemde kayıtlı! "${iNoRaw}" numaralı ve "${iSupClean}" tedarikçili fatura daha önce (${inv.date || '-'} / ${inv.jobsiteName || 'Şantiye'} - ${formatRuble(inv.totalAmount)}) sisteme yüklenmiş.`,
            existingRecord: inv
          };
        }
        const hasDistinctValidNumbers = isActiveNoValid && isINoValid && cleanNo !== iNo;
        if (!hasDistinctValidNumbers && activeAgreed > 0 && Math.abs(activeAgreed - (Number(inv.totalAmount) || 0)) < 1 && activeDate && inv.date === activeDate) {
          return {
            isDuplicate: true,
            message: `Bu fatura sistemde kayıtlı! "${iSupClean}" tedarikçisine ait aynı tarih (${inv.date}) ve aynı tutarda (${formatRuble(inv.totalAmount)}) bir fatura zaten sistemde mevcut.`,
            existingRecord: inv
          };
        }
      }
    }
    return duplicateWarning;
  }, [aiReviewModal, invoiceNo, vendorName, agreedPrice, orderDate, discounts, invoices, duplicateWarning]);

  // Notify parent App when a scanned discount/invoice is waiting for confirmation so user can switch tabs and return
  useEffect(() => {
    if (!onPendingDiscountScanChange) return;
    if (aiReviewModal) {
      onPendingDiscountScanChange({
        supplier: aiReviewModal.vendorName || 'Tedarikçi',
        invoiceNumber: aiReviewModal.invoiceNo || '-',
        totalAmount: Number(aiReviewModal.agreedPrice || aiReviewModal.offerPrice) || 0,
        openModal: () => setIsAiModalMinimized(false)
      });
    } else if (finalOfferFile || firstOfferFile || Number(agreedPrice) > 0) {
      onPendingDiscountScanChange({
        supplier: vendorName || 'Tedarikçi',
        invoiceNumber: invoiceNo || '-',
        totalAmount: Number(agreedPrice || offerPrice) || 0,
        openModal: () => {
          const el = document.getElementById('discount-entry-main-form');
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
      });
    } else {
      onPendingDiscountScanChange(null);
    }
  }, [aiReviewModal, finalOfferFile, firstOfferFile, vendorName, invoiceNo, agreedPrice, offerPrice]);

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

    const activeHistoricalPool = [
      ...(invoices || []),
      ...(prizmaInvoices || []).map(p => ({ ...p, sourceCollection: 'prizma_invoices' }))
    ];
    const cheaperPreviewMatches = extractedItems.length > 0
      ? findCheaperHistoricalBenchmarksForItems(
          extractedItems,
          {
            supplier: vendorName,
            jobsiteId,
            invoiceNo,
            orderDate
          },
          activeHistoricalPool
        )
      : [];

    // Smart Auto-Correction if Offer and Agreed prices or Rounds are inverted
    let calcOffer = numOffer;
    let calcAgreed = numAgreed;
    if (schematicAnalysis && schematicAnalysis.rawBaselineAmount > 0 && schematicAnalysis.finalAmount > 0) {
      calcOffer = schematicAnalysis.rawBaselineAmount;
      calcAgreed = schematicAnalysis.finalAmount;
    } else {
      const candidateAmounts = [
        numOffer,
        numAgreed,
        ...(negotiationRounds || []).map(r => Number(r.quotedPrice) || 0),
        ...(negotiationRounds || []).map(r => Number(r.previousPrice) || 0)
      ].filter(v => v > 0);
      if (candidateAmounts.length >= 2) {
        calcOffer = Math.max(...candidateAmounts);
        calcAgreed = Math.min(...candidateAmounts);
      }
    }
    if (calcAgreed > calcOffer) {
      const tmp = calcOffer;
      calcOffer = calcAgreed;
      calcAgreed = tmp;
    }
    if (effectiveDuplicateWarning?.isDuplicate && !forceSaveDuplicate) {
      setNotification({
        type: 'error',
        message: '⚠️ BU FATURA SİSTEMDE KAYITLI! Mükerrer kaydı onaylamak için lütfen aşağıdaki "Bu faturanın sistemde kayıtlı olduğunu biliyorum, yine de yeni kayıt oluştur" kutucuğunu işaretleyip tekrar Kaydet butonuna basın.'
      });
      return;
    }

    const maxAllowedDeduction = Math.max(0, calcOffer - calcAgreed);
    const calcDeduction = numScopeDeduction > 0 && numScopeDeduction <= maxAllowedDeduction ? numScopeDeduction : 0;
    const calcAdjustedOffer = calcDeduction > 0 ? Math.max(calcAgreed, calcOffer - calcDeduction) : calcOffer;
    const calcBaseline = calcDeduction > 0 ? calcAdjustedOffer : calcOffer;
    const calcAmt = Math.max(0, calcBaseline - calcAgreed);
    const calcPct = calcBaseline > 0 ? Number(((calcAmt / calcBaseline) * 100).toFixed(2)) : 0;

    // GERÇEK TUR KONTROLÜ: Ara tur faturası/belgesi yüklenmiş veya notu girilmiş olan turlar geçerlidir
    const validRounds = (negotiationRounds || [])
      .filter(r => {
        const qp = Number(r.quotedPrice) || 0;
        const hasDoc = Boolean(r.documentName || r.documentUrl || (r as any).documentFileName || (r as any).fileName);
        const hasNotes = Boolean(r.note || r.notes || r.date);
        return (hasDoc || hasNotes) && (qp > 0 ? qp <= calcBaseline && qp > calcAgreed : true);
      })
      .sort((a, b) => (Number(b.quotedPrice) || 0) - (Number(a.quotedPrice) || 0));

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

      // If multiple initial offers were staged, record all of them in stageDocuments!
      if (schematicAnalysis && schematicAnalysis.initialDocs.length > 1) {
        schematicAnalysis.initialDocs.forEach((initDoc, idx) => {
          const isLowestBase = initDoc.id === schematicAnalysis.baselineDoc?.id;
          generatedStageDocs.push({
            stageNumber: 1,
            title: isLowestBase ? `1. İlk Teklif (Baz Alınan En Düşük Teklif)` : `1. İlk Teklif (Alternatif #${idx + 1})`,
            fileName: initDoc.fileName,
            fileUrl: initDoc.fileUrl || firstUrl.url,
            driveFileId: initDoc.fileId || firstUrl.fileId,
            amount: initDoc.totalAmount,
            date: initDoc.date
          });
        });
      } else {
        generatedStageDocs.push({
          stageNumber: 1,
          title: '1. İlk Teklif / Fatura',
          fileName: firstDocName,
          fileUrl: firstUrl.url,
          driveFileId: firstUrl.fileId,
          amount: calcOffer
        });
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
        validRounds.forEach((r, idx) => {
          const stageNo = idx + 2;
          generatedStageDocs.push({
            stageNumber: stageNo,
            title: `${stageNo}. Ara İndirimli Teklif (${r.roundNumber || idx + 1}. Tur)`,
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
        notes: notes.trim() || (schematicAnalysis ? `Birleşik TDF & Pazarlık Analizi #${schematicAnalysis.analysisCode}. En düşük ilk teklif (${formatRuble(calcOffer)}) baz alınarak ${validRounds.length} ara pazarlık turu ile nihai fatura (${formatRuble(calcAgreed)}) kaydedildi.` : (calcDeduction > 0 ? `İlk tekliften ${formatRuble(calcDeduction)} düşülerek net indirim hesaplandı.` : 'Teklif belgeleri karşılaştırılarak otomatik kaydedildi.')),
        invoiceNo: generatedInvoiceNo,
        firstOfferFileName: firstDocName,
        firstOfferFileUrl: firstUrl.url,
        firstOfferFileData: !firstUrl.url && firstOfferFile?.base64 ? firstOfferFile.base64 : undefined,
        firstOfferDriveFileId: firstUrl.fileId,
        finalOfferFileName: finalDocName,
        finalOfferFileUrl: finalUrl.url,
        finalOfferFileData: !finalUrl.url && finalOfferFile?.base64 ? finalOfferFile.base64 : undefined,
        finalOfferDriveFileId: finalUrl.fileId,
        forceSave: forceSaveDuplicate,
        forceSaveDuplicate: forceSaveDuplicate,
        items: extractedItems.length > 0 ? extractedItems as any : undefined,
        negotiationRounds: validRounds.length > 0 ? validRounds : undefined,
        stageDocuments: generatedStageDocs,
        crossNegotiationApplied: isHighValue ? finalCrossNegotiation : false,
        finalNegotiationDate: finalNegotiationDate || orderDate,
        ...(schematicAnalysis ? {
          analysisCode: schematicAnalysis.analysisCode,
          calculationMethod: 'MARKET_BASELINE_TO_FINAL' as const,
          realMarketSavings: calcAmt,
          marketReferencePrice: calcBaseline,
          realSavingsPercentage: calcPct,
          isSingleVendor: schematicAnalysis.uniqueVendorsCount <= 1,
          isAboveBestOffer: schematicAnalysis.isAboveBestOfferCount > 0,
          competitorCount: Math.max(0, schematicAnalysis.uniqueVendorsCount - 1),
          canonicalMaterials: schematicAnalysis.canonicalMaterials
        } : {}),
        ...(cheaperPreviewMatches.length > 0 ? {
          historicalBenchmarkAlert: {
            buyerNotifiedBeforeSave: true,
            notifiedAt: new Date().toISOString(),
            totalPotentialExtraSavings: Number(
              cheaperPreviewMatches.reduce((s, m) => s + (Number(m.totalLineOverpayment) || 0), 0).toFixed(2)
            ),
            affectedLines: cheaperPreviewMatches
          }
        } : {})
      } as any);

      void loadSavedTdfAnalyses();

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
      setStagedOfferDocs([]);
      setDuplicateWarning(null);
      setForceSaveDuplicate(false);
      setPerformedByPersonnelId(user?.role === 'personnel' && user.personnelId ? user.personnelId : '');
      setNegotiationRounds([]);
      setCrossNegotiationApplied(false);
      setFinalNegotiationDate(new Date().toISOString().split('T')[0]);

      onSuccess();
    } catch (err: any) {
      console.error('Save discount error:', err);
      const msg = err.message || 'Kayıt sırasında bir hata oluştu.';
      if (msg.toLowerCase().includes('kayıtlı') || msg.toLowerCase().includes('mükerrer')) {
        setDuplicateWarning({
          isDuplicate: true,
          message: msg
        });
      }
      setNotification({
        type: 'error',
        message: msg
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
            <h4 className="font-bold text-base text-white">
              {notification.type === 'success' ? t('discountSuccessToast') : '⚠️ Kayıt / Doğrulama Uyarısı'}
            </h4>
            <p className="text-xs text-slate-200 mt-1 font-medium">{notification.message}</p>
            {notification.type === 'success' && (
              <p className="text-[11px] text-emerald-300 font-mono mt-1 font-semibold">{t('discountSuccessSub')}</p>
            )}
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
      <div className="flex flex-wrap items-center gap-2 bg-slate-200/80 p-1.5 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setEntryMode('auto-offers')}
          className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-2 cursor-pointer ${
            entryMode === 'auto-offers'
              ? 'bg-white text-indigo-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>🚀 Birleşik Çoklu Belge & TDF Pazarlık Analizi (AI)</span>
          <span className="bg-indigo-100 text-indigo-800 text-[10px] font-black px-1.5 py-0.5 rounded-full">Ana Ekran</span>
        </button>

        <button
          type="button"
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
          onClick={() => {
            document.getElementById('recent-discounts-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="px-3.5 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1.5 cursor-pointer bg-slate-900 hover:bg-slate-800 text-white shadow-2xs"
        >
          <Scale className="w-3.5 h-3.5 text-amber-400" />
          <span>Kayıtlı İndirimler & TDF Arşivi ({(discounts?.length || 0) + (savedTdfAnalyses?.length || 0)})</span>
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

        {/* MODE 1: TDF-STYLE UNIFIED MULTI-DOCUMENT UPLOAD, ROLE/ROUND SELECTION & SCHEMATIC NEGOTIATION ANALYSIS */}
        {entryMode === 'auto-offers' && (
          <div className="space-y-6">
            {/* Top Instruction & Demo Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 text-white p-5 rounded-2xl border border-indigo-500/30 shadow-md">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider">
                    TDF Mantığı • Çoklu Belge & Akıllı Tur Sistemi
                  </span>
                  <span className="text-xs font-bold text-indigo-300">
                    İlk Teklif • 1..5. Tur Ara Pazarlık • Nihai Anlaşılan Fatura
                  </span>
                </div>
                <h3 className="font-black text-base sm:text-lg text-white flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>Tüm Teklif ve Pazarlık Faturalarını Tek Yerden Yükleyin</span>
                </h3>
                <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                  Faturaların tamamını tek seferde veya peş peşe yükleyin. Yanındaki kutucuklardan <strong>İlk Teklif</strong>, varsa <strong>Ara Pazarlık (1. Tur, 2. Tur, 3. Tur, 4. Tur, 5. Tur)</strong> ve <strong>Nihai Anlaşılan Fatura</strong> olarak seçin veya <strong>Otomatik Akıllı Sıralama</strong> ile tek tıkla analiz edin. Birden fazla İlk Teklif varsa en düşük ilk teklif baz alınarak net indirim hesaplanır.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleLoadDemoPreset}
                  className="bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-400/40 font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span>Örnek 3 Aşamalı Pazarlık Yükle</span>
                </button>
              </div>
            </div>

            {/* Unified Multi-File Drag & Drop Upload Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsMultiDragOver(true);
              }}
              onDragLeave={() => setIsMultiDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsMultiDragOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleAddStagedFiles(e.dataTransfer.files);
                }
              }}
              className={`relative rounded-2xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
                isMultiDragOver
                  ? 'border-indigo-500 bg-indigo-50/70 scale-[1.005]'
                  : 'border-indigo-300 bg-slate-50/90 hover:bg-indigo-50/40 hover:border-indigo-400'
              }`}
            >
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.xlsx,.xls,.csv"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleAddStagedFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
              />
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-600 flex items-center justify-center shadow-2xs">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">
                    Tüm Fatura ve Teklif Belgelerini Buraya Sürükleyin veya Seçmek İçin Tıklayın
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    İlk Teklif, 1..5. Tur Ara Pazarlık ve Nihai Anlaşılan Fatura belgelerini (PDF, Excel, Görsel) aynı anda çoklu seçebilirsiniz
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[11px] font-bold">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-200/80 text-slate-700">1. İlk Teklif (En Düşük Baz Alınır)</span>
                  <span className="text-slate-400">➔</span>
                  <span className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800">Ara Pazarlık (1. Tur - 5. Tur)</span>
                  <span className="text-slate-400">➔</span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800">Nihai Anlaşılan Fatura</span>
                </div>
              </div>
            </div>

            {/* Staged Documents Table & Role / Round Selector */}
            {stagedOfferDocs.length > 0 && (
              <div className="bg-white rounded-2xl border-2 border-indigo-100 shadow-sm overflow-hidden space-y-4 p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <span className="w-7 h-7 rounded-xl bg-indigo-600 text-white font-black text-xs flex items-center justify-center">
                      {stagedOfferDocs.length}
                    </span>
                    <div>
                      <h4 className="text-sm font-black text-slate-900">
                        Yüklenen Fatura & Teklif Belgeleri — Rol ve Tur Seçimi
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Her belgenin yanından rolünü (İlk Teklif, Ara Pazarlık 1-5. Tur, Nihai Fatura) seçin ve <strong>Analizi Başlat</strong> butonuna basın.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <label className="flex items-center space-x-2 text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoSortByPrice}
                        onChange={(e) => setAutoSortByPrice(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>Tutarlara Göre Otomatik Akıllı Sırala</span>
                    </label>

                    {stagedOfferDocs.filter(d => d.totalAmount > 0).length >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const sorted = applySmartPriceSortToDocs(stagedOfferDocs, true);
                          setStagedOfferDocs(sorted);
                          syncStagedDocsToForm(sorted);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-extrabold flex items-center space-x-1.5 cursor-pointer transition-colors"
                      >
                        <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Şimdi Tutarlara Göre Sırala</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setStagedOfferDocs([]);
                        setFirstOfferFile(null);
                        setFinalOfferFile(null);
                        setNegotiationRounds([]);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer"
                    >
                      Tümünü Temizle
                    </button>
                  </div>
                </div>

                {/* Document Rows */}
                <div className="space-y-2.5">
                  {stagedOfferDocs.map((docItem, idx) => {
                    const isLowestInitial =
                      docItem.role === 'initial_offer' &&
                      docItem.totalAmount > 0 &&
                      schematicAnalysis?.baselineDoc?.id === docItem.id &&
                      (schematicAnalysis?.initialDocs.length || 0) > 1;

                    return (
                      <div
                        key={`${docItem.id || 'doc'}_${idx}`}
                        className={`p-3.5 rounded-xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                          docItem.role === 'initial_offer'
                            ? 'bg-slate-50 border-slate-300'
                            : docItem.role === 'negotiation_round'
                            ? 'bg-indigo-50/50 border-indigo-200'
                            : 'bg-emerald-50/60 border-emerald-300'
                        }`}
                      >
                        {/* Left: Index, File Name, OCR Status & Supplier */}
                        <div className="flex items-start sm:items-center space-x-3 min-w-0 flex-1">
                          <span
                            className={`w-7 h-7 rounded-lg font-black text-xs flex items-center justify-center shrink-0 ${
                              docItem.role === 'initial_offer'
                                ? 'bg-slate-800 text-white'
                                : docItem.role === 'negotiation_round'
                                ? 'bg-indigo-600 text-white'
                                : 'bg-emerald-600 text-white'
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-xs sm:text-sm text-slate-900 truncate max-w-[260px] sm:max-w-[360px]">
                                {docItem.fileName}
                              </span>
                              {docItem.status === 'scanning' && (
                                <span className="inline-flex items-center space-x-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span>AI Okuyor...</span>
                                </span>
                              )}
                              {docItem.status === 'analyzed' && (
                                <span className="inline-flex items-center space-x-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Okundu ({docItem.itemsCount || docItem.items?.length || 0} Kalem)</span>
                                </span>
                              )}
                              {docItem.status === 'error' && (
                                <span className="inline-flex items-center space-x-1 text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full border border-rose-300">
                                  <AlertCircle className="w-3 h-3 text-rose-600" />
                                  <span>{docItem.errorMsg || 'Hata'}</span>
                                </span>
                              )}
                              {isLowestInitial && (
                                <span className="text-[10px] font-black bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full">
                                  ★ Baz Alınan En Düşük İlk Teklif
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-0.5">
                              {docItem.supplier && (
                                <span>
                                  Tedarikçi: <strong className="text-slate-800">{docItem.supplier}</strong>
                                </span>
                              )}
                              {docItem.invoiceNumber && (
                                <span>
                                  Fatura No: <strong className="font-mono text-slate-800">{docItem.invoiceNumber}</strong>
                                </span>
                              )}
                              {docItem.date && <span>Tarih: {docItem.date}</span>}
                            </div>
                          </div>
                        </div>

                        {/* Right: Supplier Input, Role Dropdown, Round Dropdown (1..5. Tur), VAT Toggle, Editable Amount & Remove */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {/* Inline Supplier Input for Multi-Supplier TDF Comparison */}
                          <input
                            type="text"
                            list="canonical-vendors-datalist"
                            placeholder="Tedarikçi Firma..."
                            value={docItem.supplier || ''}
                            onChange={(e) => {
                              const supVal = e.target.value;
                              const nextDocs = stagedOfferDocs.map(d =>
                                d.id === docItem.id ? { ...d, supplier: supVal } : d
                              );
                              setStagedOfferDocs(nextDocs);
                              if (docItem.role === 'final_invoice' && supVal.trim()) {
                                setVendorName(supVal);
                              }
                            }}
                            className="w-36 sm:w-44 py-1.5 px-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            title="Bu teklif/fatura belgesine ait tedarikçi firma adı (Çoklu tedarikçi TDF karşılaştırması için)"
                          />

                          {/* Role Selection Box */}
                          <select
                            value={docItem.role}
                            onChange={(e) => {
                              const newRole = e.target.value as 'initial_offer' | 'negotiation_round' | 'final_invoice';
                              const nextDocs = stagedOfferDocs.map(d =>
                                d.id === docItem.id ? { ...d, role: newRole } : d
                              );
                              setStagedOfferDocs(nextDocs);
                              syncStagedDocsToForm(nextDocs);
                            }}
                            className={`py-2 px-3 rounded-xl text-xs font-extrabold border cursor-pointer focus:outline-none focus:ring-2 ${
                              docItem.role === 'initial_offer'
                                ? 'bg-white border-slate-300 text-slate-900 focus:ring-slate-500'
                                : docItem.role === 'negotiation_round'
                                ? 'bg-indigo-600 text-white border-indigo-700 focus:ring-indigo-500'
                                : 'bg-emerald-600 text-white border-emerald-700 focus:ring-emerald-500'
                            }`}
                          >
                            <option value="initial_offer" className="bg-white text-slate-900">
                              📄 İlk Teklif Faturası
                            </option>
                            <option value="negotiation_round" className="bg-white text-slate-900">
                              🔄 Ara Pazarlık Faturası
                            </option>
                            <option value="final_invoice" className="bg-white text-slate-900">
                              ✅ Nihai Anlaşılan Fatura
                            </option>
                          </select>

                          {/* Round Number Selector (1. Tur .. 5. Tur) shown when Ara Pazarlık is selected */}
                          {docItem.role === 'negotiation_round' && (
                            <select
                              value={docItem.roundNumber}
                              onChange={(e) => {
                                const newRound = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                                const nextDocs = stagedOfferDocs.map(d =>
                                  d.id === docItem.id ? { ...d, roundNumber: newRound } : d
                                );
                                setStagedOfferDocs(nextDocs);
                                syncStagedDocsToForm(nextDocs);
                              }}
                              className="py-2 px-3 rounded-xl text-xs font-black bg-amber-50 border-2 border-amber-400 text-amber-950 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value={1}>1. Tur Faturası</option>
                              <option value={2}>2. Tur Faturası</option>
                              <option value={3}>3. Tur Faturası</option>
                              <option value={4}>4. Tur Faturası</option>
                              <option value={5}>5. Tur Faturası</option>
                            </select>
                          )}

                          {/* KDV (NDS) Normalization Toggle Button */}
                          <button
                            type="button"
                            onClick={() => {
                              const nextVat = docItem.isVatIncluded === false ? true : false;
                              const nextDocs = stagedOfferDocs.map(d =>
                                d.id === docItem.id ? { ...d, isVatIncluded: nextVat } : d
                              );
                              setStagedOfferDocs(nextDocs);
                              syncStagedDocsToForm(nextDocs);
                            }}
                            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold border transition-colors cursor-pointer ${
                              docItem.isVatIncluded === false
                                ? 'bg-amber-100 text-amber-950 border-amber-400'
                                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                            }`}
                            title="TDF KDV (NDS) Normalizasyonu: Teklif KDV Hariç (Без НДС) ise tıklayın, sistem +%20 KDV ekleyerek eşit bazda kıyaslar"
                          >
                            {docItem.isVatIncluded === false ? '⚡ KDV Hariç (+%20 НДС Eklendi)' : '✓ KDV Dahil (С НДС)'}
                          </button>

                          {/* Amount Input (auto-filled by AI or manually editable) */}
                          <div className="relative w-36 sm:w-40">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Tutar (₽)"
                              value={docItem.totalAmount || ''}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                const nextDocs = stagedOfferDocs.map(d =>
                                  d.id === docItem.id ? { ...d, totalAmount: val, status: val > 0 ? 'analyzed' as const : d.status } : d
                                );
                                setStagedOfferDocs(nextDocs);
                                syncStagedDocsToForm(nextDocs);
                              }}
                              className="w-full py-1.5 pl-3 pr-7 bg-white border border-slate-300 rounded-xl font-mono font-extrabold text-xs text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                              ₽
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const nextDocs = stagedOfferDocs.filter(d => d.id !== docItem.id);
                              setStagedOfferDocs(nextDocs);
                              syncStagedDocsToForm(nextDocs);
                            }}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Belgeyi Kaldır"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Big Action Button: ANALİZİ BAŞLAT */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    <strong>İpucu:</strong> Belgeleri yükledikten sonra <strong>Analizi Başlat</strong> butonuna basın; yapay zeka tüm faturaları okuyup KDV/birim dönüşümüyle pazarlık şemasını çıkarır.
                  </p>
                  <button
                    type="button"
                    onClick={handleStartMultiDocAnalysis}
                    disabled={isMultiScanning || stagedOfferDocs.length === 0}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-700 hover:to-purple-800 text-white font-black text-xs sm:text-sm shadow-lg shadow-indigo-600/20 flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60"
                  >
                    {isMultiScanning ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin text-amber-300" />
                        <span>Faturalar Taranıyor ve TDF Pazarlık Akışı Hesaplanıyor...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5 text-amber-300" />
                        <span>🚀 Analizi Başlat ve TDF Pazarlık Şemasını Çıkar ({stagedOfferDocs.length} Belge)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* SCHEMATIC NEGOTIATION & TDF CANONICAL MATRIX DIAGRAM */}
            {schematicAnalysis && schematicAnalysis.steps.length >= 1 && (
              <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 border border-slate-800 shadow-xl space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase">
                        Canlı Şematik Pazarlık & TDF Özeti
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[10px] font-mono font-black">
                        TDF Kodu: {schematicAnalysis.analysisCode}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">
                        {schematicAnalysis.uniqueVendorsCount} Tedarikçi • {schematicAnalysis.steps.length} Aşama
                      </span>
                      {schematicAnalysis.initialDocs.length > 1 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black">
                          ★ {schematicAnalysis.initialDocs.length} İlk Tekliften En Düşüğü (Dip Fiyat) Baz Alındı
                        </span>
                      )}
                      {schematicAnalysis.unitConversionsCount > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 text-[10px] font-bold">
                          🔄 {schematicAnalysis.unitConversionsCount} Kalemde Birim Dönüşümü (Ton/Metre/Adet)
                        </span>
                      )}
                      {schematicAnalysis.vatNormalizedDocsCount > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold">
                          ⚡ {schematicAnalysis.vatNormalizedDocsCount} Belgede +%20 KDV (NDS) Eklendi
                        </span>
                      )}
                    </div>
                    <h4 className="text-base sm:text-lg font-black text-white mt-1.5">
                      İlk Tekliften Nihai Faturaya Adım Adım Pazarlık Merdiveni ve TDF Kalem Kıyaslaması
                    </h4>
                  </div>

                  <div className="bg-emerald-950/90 border-2 border-emerald-500/50 px-4 py-2.5 rounded-2xl flex items-center space-x-4 shrink-0">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-emerald-300 block">
                        Toplam Kazanılan Net İndirim
                      </span>
                      <span className="text-xl font-black font-mono text-emerald-400">
                        +{formatRuble(schematicAnalysis.totalNetDiscount)}
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 font-mono font-black text-xs">
                      %{schematicAnalysis.totalNetDiscountPct}
                    </span>
                  </div>
                </div>

                {/* Above Best Offer Warning Banner (En İyi Teklif Üstü Alım Uyarısı) */}
                {schematicAnalysis.isAboveBestOfferCount > 0 && (
                  <div className="p-3.5 rounded-2xl bg-rose-950/90 border border-rose-500/60 text-rose-100 flex items-start space-x-3 text-xs">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-rose-300 uppercase block">
                        ⚠️ TDF Denetim Uyarısı: {schematicAnalysis.isAboveBestOfferCount} Kalemde En İyi İlk Teklif Üstü Alım Tespit Edildi!
                      </span>
                      <span className="text-rose-200/90">
                        Aşağıdaki kanonik kalem tablosunda bazı kalemlerin nihai birim fiyatı, ilk teklif havuzundaki en düşük birim fiyatın üzerindedir. Lütfen birim/kalite farkını kontrol edin.
                      </span>
                    </div>
                  </div>
                )}

                {/* If multiple initial offers exist, show comparison pills */}
                {schematicAnalysis.initialDocs.length > 1 && (
                  <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Yüklenen İlk Teklifler Havuzu (TDF Kuralı: En Düşük İlk Teklif Baz Alındı):
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {schematicAnalysis.initialDocs.map((initDoc, iIdx) => {
                        const isLowest = initDoc.id === schematicAnalysis.baselineDoc?.id;
                        return (
                          <div
                            key={initDoc.id}
                            className={`px-3 py-2 rounded-xl border text-xs flex items-center space-x-2 ${
                              isLowest
                                ? 'bg-amber-500/15 border-amber-400 text-amber-200 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-400'
                            }`}
                          >
                            <span>{initDoc.supplier || `İlk Teklif #${iIdx + 1}`} ({initDoc.fileName}):</span>
                            <span className="font-mono font-black text-white">{formatRuble(initDoc.totalAmount)}</span>
                            {initDoc.isVatIncluded === false && (
                              <span className="text-[10px] text-amber-300">(+%20 НДС Dahil)</span>
                            )}
                            {isLowest && (
                              <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded">
                                DIP FİYAT BAZ ALINDI
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Visual Schematic Cards (İlk Teklif -> 1. Tur -> 2. Tur -> Nihai Fatura) */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
                  {schematicAnalysis.steps.map((step, sIdx) => (
                    <div
                      key={step.id}
                      className={`p-4 rounded-2xl border relative flex flex-col justify-between space-y-3 ${
                        step.stageType === 'initial'
                          ? 'bg-slate-950 border-slate-700'
                          : step.stageType === 'round'
                          ? 'bg-indigo-950/60 border-indigo-500/40'
                          : 'bg-emerald-950/70 border-2 border-emerald-500/60'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                              step.stageType === 'initial'
                                ? 'bg-slate-800 text-slate-200 border border-slate-600'
                                : step.stageType === 'round'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30'
                                : 'bg-emerald-500 text-slate-950'
                            }`}
                          >
                            {step.badgeLabel}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">#{sIdx + 1}</span>
                        </div>
                        <p className="text-xs font-bold text-slate-200 truncate" title={step.fileName}>
                          {step.fileName}
                        </p>
                        {step.supplier && (
                          <p className="text-[11px] text-indigo-300 font-semibold truncate">
                            🏢 {step.supplier}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1 pt-2 border-t border-slate-800/80">
                        {step.stageType !== 'initial' && (
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>Önceki Tutar:</span>
                            <span className="font-mono line-through">{formatRuble(step.previousAmount)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-300 font-semibold">
                            {step.stageType === 'initial' ? 'Baz Teklif Tutarı:' : 'Yeni Tutar:'}
                          </span>
                          <span
                            className={`text-base font-mono font-black ${
                              step.stageType === 'initial'
                                ? 'text-white'
                                : step.stageType === 'round'
                                ? 'text-indigo-300'
                                : 'text-emerald-400'
                            }`}
                          >
                            {formatRuble(step.amount)}
                          </span>
                        </div>

                        {step.stageType !== 'initial' && (
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[10px] text-emerald-300 font-bold">
                              Bu Adımda Düşüş:
                            </span>
                            <span className="text-xs font-mono font-black text-emerald-400">
                              -{formatRuble(step.stepDropAmount)} (%{step.stepDropPct})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* TDF Canonical Item, Unit Conversion & Multi-Supplier Unit Price Evolution Table */}
                {schematicAnalysis.itemEvolution.length > 0 && (
                  <div className="bg-slate-950/90 rounded-2xl border border-slate-800 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-200 flex items-center space-x-2">
                        <span>📋 TDF Kanonik Kalem, Birim Dönüşümü & Birim Fiyat Matrisi ({schematicAnalysis.itemEvolution.length} Kalem)</span>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        En Düşük İlk Teklif (Dip Fiyat) → 1..5. Tur → Nihai Fatura (KDV & Birim Normalize)
                      </span>
                    </div>
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase">
                            <th className="py-2 px-3">Kanonik Malzeme & Teknik Özellik</th>
                            <th className="py-2 px-3 text-right">Miktar & Birim</th>
                            <th className="py-2 px-3 text-right">En Düşük İlk Teklif (Dip Baz)</th>
                            {schematicAnalysis.roundDocs.map((rd, rIdx) => (
                              <th key={rd.id} className="py-2 px-3 text-right text-indigo-300">
                                {rd.roundNumber || rIdx + 1}. Tur Birim Fiyat
                              </th>
                            ))}
                            <th className="py-2 px-3 text-right text-emerald-400">Nihai Birim Fiyat</th>
                            <th className="py-2 px-3 text-right text-amber-300">Kalem Net Tasarruf / Durum</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {schematicAnalysis.itemEvolution.map((row, rIdx) => (
                            <tr key={rIdx} className={`hover:bg-slate-900/50 ${row.isAboveBestOffer ? 'bg-rose-950/30' : ''}`}>
                              <td className="py-2 px-3 font-medium text-slate-200">
                                <div>{row.materialName}</div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {row.specsSummary && (
                                    <span className="text-[10px] font-mono bg-slate-800 text-indigo-300 px-1.5 py-0.2 rounded border border-slate-700">
                                      {row.specsSummary}
                                    </span>
                                  )}
                                  {row.conversionFormula && (
                                    <span className="text-[10px] font-bold bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/30" title={row.conversionFormula}>
                                      🔄 {row.conversionFormula}
                                    </span>
                                  )}
                                  {row.vatAdjusted && (
                                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded border border-amber-500/30">
                                      +%20 KDV Normalize
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {row.quantity} {row.unit}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                <div>{formatRuble(row.initialUnitPrice)}</div>
                                {row.marketReferenceSupplier && (
                                  <div className="text-[10px] text-slate-400 font-sans truncate max-w-[140px] ml-auto">
                                    {row.marketReferenceSupplier}
                                  </div>
                                )}
                              </td>
                              {schematicAnalysis.roundDocs.map((rd, idx2) => {
                                const matchUp = row.roundUnitPrices[idx2]?.unitPrice;
                                return (
                                  <td key={rd.id} className="py-2 px-3 text-right font-mono font-bold text-indigo-300">
                                    {matchUp ? formatRuble(matchUp) : '-'}
                                  </td>
                                );
                              })}
                              <td className="py-2 px-3 text-right font-mono font-extrabold text-emerald-400">
                                {formatRuble(row.finalUnitPrice)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold">
                                {row.isAboveBestOffer ? (
                                  <span className="text-rose-400 font-black">
                                    ⚠️ +{formatRuble(row.aboveBestOfferDiff || 0)}/br (En İyi Teklif Üstü)
                                  </span>
                                ) : row.totalItemSaving > 0 ? (
                                  <span className="text-amber-300">+{formatRuble(row.totalItemSaving)}</span>
                                ) : (
                                  <span className="text-slate-400">0,00 ₽</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Direct 1-Click Save Action inside Schematic Negotiation Summary */}
                <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-300">
                    <span>TDF Kodu: <strong className="font-mono text-indigo-300">{schematicAnalysis.analysisCode}</strong></span>
                    <span className="mx-2 text-slate-500">•</span>
                    <span>Baz İlk Teklif: <strong className="font-mono text-white">{formatRuble(schematicAnalysis.effectiveBaseline)}</strong></span>
                    <span className="mx-2 text-slate-500">➔</span>
                    <span>Nihai Anlaşılan: <strong className="font-mono text-emerald-400">{formatRuble(schematicAnalysis.finalAmount)}</strong></span>
                    <span className="mx-2 text-slate-500">•</span>
                    <span>Net Kazanç: <strong className="font-mono text-amber-300">+{formatRuble(schematicAnalysis.totalNetDiscount)} (%{schematicAnalysis.totalNetDiscountPct})</strong></span>
                  </div>
                  <button
                    type="button"
                    disabled={isProcessingAI}
                    onClick={() => executeSaveDiscount(false)}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>✅ Pazarlık Şemasını ve TDF İndirimini Kaydet</span>
                  </button>
                </div>
              </div>
            )}

            {/* Quick Summary Inputs (Offer Price & Final Agreed Price - auto-filled or manually adjustable) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Baz Alınan İlk Teklif Fiyatı (₽) *
                  </label>
                  {firstOfferFile && (
                    <span className="text-[10px] font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 truncate max-w-[180px]">
                      📄 {firstOfferFile.name}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="675547.14"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl font-mono font-bold text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-emerald-800">
                    Nihai Anlaşılan Fatura Tutarı (₽) *
                  </label>
                  {finalOfferFile && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 truncate max-w-[180px]">
                      ✅ {finalOfferFile.name}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.01"
                  placeholder="672190.50"
                  value={agreedPrice}
                  onChange={(e) => handleAgreedPriceChange(e.target.value)}
                  className="w-full py-2.5 px-3 bg-white border border-emerald-300 rounded-xl font-mono font-extrabold text-emerald-700 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

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
                    placeholder="Örn: İptal edilen kalem tutarı"
                    value={scopeDeductionReason}
                    onChange={(e) => setScopeDeductionReason(e.target.value)}
                    className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-amber-500"
                  />
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

        {/* Minimized AI Review Modal Return Banner */}
        {aiReviewModal && isAiModalMinimized && (
          <div className="p-4 rounded-2xl bg-indigo-950 text-white border-2 border-indigo-400 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <Sparkles className="w-6 h-6 text-amber-400 animate-pulse shrink-0" />
              <div>
                <h4 className="text-sm font-black text-white">
                  Taranan Fatura / Teklif Onay Bekliyor: {aiReviewModal.vendorName || 'Tedarikçi'} ({aiReviewModal.invoiceNo || '-'})
                </h4>
                <p className="text-xs text-indigo-200">
                  Kontrollerinizi tamamladıysanız onay ekranını tekrar açıp kaydı tamamlayabilirsiniz.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsAiModalMinimized(false)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-xs shadow-md cursor-pointer shrink-0"
            >
              🔍 Kontrol Paneline Dön & Kaydet
            </button>
          </div>
        )}

        {/* Duplicate Warning Banner right above Save Button */}
        {effectiveDuplicateWarning?.isDuplicate && (
          <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-400 text-rose-950 shadow-sm space-y-3">
            <div className="flex items-start space-x-3">
              <ShieldAlert className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <h4 className="text-sm font-black text-rose-900 uppercase">
                  ⚠️ UYARI: BU FATURA SİSTEMDE KAYITLI! (MÜKERRER KAYIT TESPİTİ)
                </h4>
                <p className="text-xs font-bold text-rose-800">{effectiveDuplicateWarning.message}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-rose-200 flex items-center justify-end">
              <label className="flex items-center space-x-2 text-xs font-extrabold text-rose-950 cursor-pointer bg-white px-3.5 py-2 rounded-xl border-2 border-rose-400 shadow-2xs hover:bg-rose-100 transition-colors">
                <input
                  type="checkbox"
                  checked={forceSaveDuplicate}
                  onChange={(e) => {
                    setForceSaveDuplicate(e.target.checked);
                    if (e.target.checked && notification?.type === 'error') setNotification(null);
                  }}
                  className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                />
                <span>Bu faturanın sistemde kayıtlı olduğunu biliyorum, yine de yeni kayıt oluştur</span>
              </label>
            </div>
          </div>
        )}

        {/* Pre-Save Historical Cheaper Purchase Preview Banner (Preview Only - Not Saved Inside Buyer's Visible Invoice Text) */}
        {(() => {
          if (extractedItems.length === 0) return null;
          const combinedPool = [
            ...(invoices || []),
            ...(prizmaInvoices || []).map(p => ({ ...p, sourceCollection: 'prizma_invoices' }))
          ];
          const previewBenchmarks = findCheaperHistoricalBenchmarksForItems(
            extractedItems,
            {
              supplier: vendorName,
              jobsiteId,
              invoiceNo,
              orderDate
            },
            combinedPool
          );
          if (previewBenchmarks.length === 0) return null;
          const totalExtraDiff = previewBenchmarks.reduce((s, b) => s + (b.totalLineOverpayment || 0), 0);

          return (
            <div className="p-4 rounded-2xl bg-amber-50/90 border-2 border-amber-400 text-amber-950 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200 pb-2.5">
                <div className="flex items-start space-x-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-black text-amber-950 uppercase">
                        🔍 GEÇMİŞ ALIM FİYAT ÖN İZLEMESİ ({previewBenchmarks.length} Kalemde Daha Uygun Geçmiş Alım Mevcut)
                      </h4>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-950 border border-amber-400">
                        Sadece Ön İzleme • Kayda Eklenmez
                      </span>
                    </div>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Bu faturadaki aynı malzeme ve markalar daha önce sistemde daha düşük birim fiyata alınmıştır. Kaydetmeden önce tedarikçiyle ek pazarlık için inceleyebilirsiniz:
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 bg-white px-3 py-1.5 rounded-xl border border-amber-300">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">Geçmiş En İyi Fiyata Göre Fark</div>
                  <div className="text-sm font-mono font-black text-rose-700">+{formatRuble(totalExtraDiff)}</div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-amber-300 bg-white">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-amber-100/70 text-amber-950 font-bold border-b border-amber-200">
                      <th className="py-2 px-3">Malzeme & Marka</th>
                      <th className="py-2 px-3 text-right">Bu Fatura Birim</th>
                      <th className="py-2 px-3 text-right text-emerald-800">Geçmiş En Uygun Birim</th>
                      <th className="py-2 px-3">Daha Önce Alınan Firma & Şantiye</th>
                      <th className="py-2 px-3 text-right text-rose-700">Birim / Toplam Fark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {previewBenchmarks.map((bm, bIdx) => (
                      <tr key={bIdx} className="hover:bg-amber-50/40">
                        <td className="py-2 px-3 font-semibold text-slate-900">
                          <div>{bm.materialName}</div>
                          {bm.originalName && bm.originalName !== bm.materialName && (
                            <div className="text-[10px] text-slate-500 font-normal truncate max-w-[240px]">{bm.originalName}</div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {formatRuble(bm.currentUnitPrice)} <span className="text-[10px] text-slate-500">/{bm.unit}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-black text-emerald-700 bg-emerald-50/40">
                          {formatRuble(bm.historicalBestUnitPrice)} <span className="text-[10px] text-emerald-600">/{bm.unit}</span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{bm.historicalSupplier}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {bm.historicalSource === 'PRIZMA_ERP' ? 'Prizma ERP' : 'GES Arşivi'}
                            </span>
                          </div>
                          <div className="text-[10px] text-indigo-700 font-medium">
                            📍 {bm.historicalJobsiteName} • 📅 {bm.historicalDate} • #{bm.historicalInvoiceNo}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-rose-700">
                          <div>+{formatRuble(bm.unitOverpayment)}/br (+%{bm.overpaymentPercentage})</div>
                          <div className="text-[10px] text-rose-600">Toplam: +{formatRuble(bm.totalLineOverpayment)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Inline Error / Success Notification right above Save Button */}
        {notification && (
          <div
            className={`p-4 rounded-xl flex items-start space-x-3 border-2 shadow-sm ${
              notification.type === 'error'
                ? 'bg-rose-50 text-rose-900 border-rose-300'
                : 'bg-emerald-50 text-emerald-900 border-emerald-300'
            }`}
          >
            {notification.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-xs font-bold">{notification.message}</div>
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
      {aiReviewModal && !isAiModalMinimized && (
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
                    Yapay zeka faturadaki tüm bilgileri çıkardı. Diğer sekmeleri kontrol etmek için pencereyi küçültebilir veya doğrudan kaydedebilirsiniz.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAiModalMinimized(true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 text-xs font-bold cursor-pointer"
                  title="Diğer sekmeleri kontrol etmek için küçült (Veriler kaybolmaz)"
                >
                  🗕 Küçült
                </button>
                <button
                  type="button"
                  onClick={() => setAiReviewModal(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Prominent Duplicate Invoice Warning inside AI Review Modal */}
            {effectiveDuplicateWarning?.isDuplicate && (
              <div className="p-4 rounded-2xl bg-rose-950/90 border-2 border-rose-500 text-rose-100 shadow-lg space-y-3">
                <div className="flex items-start space-x-3">
                  <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <h4 className="text-sm font-black text-rose-300 uppercase">
                      ⚠️ BU FATURA SİSTEMDE KAYITLI! (MÜKERRER FATURA UYARISI)
                    </h4>
                    <p className="text-xs font-bold text-rose-100">{effectiveDuplicateWarning.message}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-rose-800/80 flex items-center justify-end">
                  <label className="flex items-center space-x-2 text-xs font-extrabold text-amber-200 cursor-pointer bg-slate-900 px-3.5 py-2 rounded-xl border border-amber-500/50 hover:bg-slate-800 transition-colors">
                    <input
                      type="checkbox"
                      checked={forceSaveDuplicate}
                      onChange={(e) => {
                        setForceSaveDuplicate(e.target.checked);
                        if (e.target.checked && notification?.type === 'error') setNotification(null);
                      }}
                      className="rounded text-amber-500 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                    />
                    <span>Bu faturanın sistemde kayıtlı olduğunu biliyorum, yine de yeni kayıt oluştur</span>
                  </label>
                </div>
              </div>
            )}

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

                {/* Extracted Line Items & Live Mathematical Reconciliation */}
                {aiReviewModal.items && aiReviewModal.items.length > 0 && (() => {
                  const targetDocTotal = aiReviewModal.offerType === 'first'
                    ? (Number(aiReviewModal.offerPrice) || 0)
                    : (Number(aiReviewModal.agreedPrice) || Number(aiReviewModal.offerPrice) || 0);
                  const liveItemsSum = Number(
                    aiReviewModal.items.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0).toFixed(2)
                  );
                  const liveDiff = Number(Math.abs(targetDocTotal - liveItemsSum).toFixed(2));
                  const isExactMatch = liveDiff <= 1.50;
                  const reconNotes = aiReviewModal.reconciliationNotes || [];

                  return (
                    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Okunan Fatura Kalemleri ({aiReviewModal.items.length} Kalem — KDV Dahil Birebir)</span>
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          isExactMatch
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                            : 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                        }`}>
                          {isExactMatch
                            ? `✓ Matematiksel Sağlama Tam (${formatRuble(liveItemsSum)})`
                            : `⚠️ Kalem Toplamı: ${formatRuble(liveItemsSum)} (Fark: ${formatRuble(liveDiff)})`}
                        </span>
                      </div>

                      {reconNotes.length > 0 && (
                        <div className="text-[10px] text-emerald-300/90 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-2.5 py-1.5 space-y-0.5">
                          {reconNotes.map((note, nIdx) => (
                            <div key={nIdx}>• {note}</div>
                          ))}
                        </div>
                      )}

                      <div className="overflow-x-auto max-h-48 overflow-y-auto border border-slate-800 rounded-lg">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-slate-900 text-slate-400 border-b border-slate-800">
                              <th className="py-1.5 px-2 font-semibold">#</th>
                              <th className="py-1.5 px-2 font-semibold">Malzeme (TR / Orijinal)</th>
                              <th className="py-1.5 px-2 font-semibold text-right">Miktar</th>
                              <th className="py-1.5 px-2 font-semibold text-right">Birim Fiyat (KDV Dahil)</th>
                              <th className="py-1.5 px-2 font-semibold text-right">Satır Toplamı</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {aiReviewModal.items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-900/50">
                                <td className="py-1.5 px-2 text-slate-500 font-mono">{idx + 1}</td>
                                <td className="py-1.5 px-2">
                                  <div className="font-semibold text-slate-200">{item.materialName}</div>
                                  {item.originalName && item.originalName !== item.materialName && (
                                    <div className="text-[10px] text-slate-400 truncate max-w-xs">{item.originalName}</div>
                                  )}
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                                  {item.quantity} {item.unit}
                                </td>
                                <td className="py-1.5 px-2 text-right">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={item.unitPrice}
                                    onChange={(e) => {
                                      const newUp = Number(e.target.value) || 0;
                                      const newTp = Number(((Number(item.quantity) || 1) * newUp).toFixed(2));
                                      const nextItems = [...aiReviewModal.items];
                                      nextItems[idx] = {
                                        ...nextItems[idx],
                                        unitPrice: newUp,
                                        grossUnitPrice: newUp,
                                        totalPrice: newTp,
                                        grossTotalPrice: newTp,
                                        isGrossInvoicePrice: true
                                      };
                                      setAiReviewModal({ ...aiReviewModal, items: nextItems });
                                    }}
                                    className="w-24 text-right bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 font-mono font-bold text-slate-100 text-[11px]"
                                  />
                                </td>
                                <td className="py-1.5 px-2 text-right font-mono font-bold text-amber-300">
                                  {formatRuble(item.totalPrice)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            {/* Inline Error & Duplicate Confirmation right above the Save button inside Modal */}
            {notification?.type === 'error' && (
              <div className="p-4 rounded-xl bg-rose-950/90 text-rose-200 border-2 border-rose-500 flex items-start space-x-3 shadow-md">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs font-bold">{notification.message}</div>
              </div>
            )}

            {/* Validation Logic and Save Button Area */}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isProcessingAI}
                  onClick={() => setIsAiModalMinimized(true)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-bold transition-all text-xs cursor-pointer"
                >
                  🗕 Küçült & Sekmeleri Kontrol Et
                </button>
                <button
                  type="button"
                  disabled={isProcessingAI}
                  onClick={() => {
                    // Transfer extracted fields to main form without losing them
                    setSupervisorId(aiReviewModal.supervisorId);
                    setJobsiteId(aiReviewModal.jobsiteId);
                    setVendorName(aiReviewModal.vendorName);
                    setCategory(aiReviewModal.category);
                    if (Number(aiReviewModal.offerPrice) > 0) setOfferPrice(String(aiReviewModal.offerPrice));
                    if (Number(aiReviewModal.agreedPrice) > 0) setAgreedPrice(String(aiReviewModal.agreedPrice));
                    setInvoiceNo(aiReviewModal.invoiceNo);
                    setOrderDate(aiReviewModal.orderDate);
                    setNotes(aiReviewModal.notes);
                    if (aiReviewModal.items && aiReviewModal.items.length > 0) {
                      setExtractedItems(aiReviewModal.items);
                    }
                    setAiReviewModal(null);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-all text-xs cursor-pointer"
                >
                  Forma Aktar / Kapat
                </button>
              </div>
              
              <button
                  type="button"
                  disabled={isProcessingAI}
                  onClick={async () => {
                    if (isProcessingAI) return;
                    setNotification(null);
                    const calcOffer = Number(aiReviewModal.offerPrice) || 0;
                    const calcDeduction = Number(aiReviewModal.scopeDeductionAmount) || 0;
                    const calcAdjusted = calcDeduction > 0 ? Math.max(0, calcOffer - calcDeduction) : calcOffer;
                    const calcBaseline = calcDeduction > 0 ? calcAdjusted : calcOffer;
                    const currentRounds = aiReviewModal.rounds || [];
                    const lastRound = currentRounds.length > 0 ? currentRounds[currentRounds.length - 1] : null;
                    const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;
                    const modalAgreed = Number(aiReviewModal.agreedPrice) || 0;
                    
                    let calcAgreed = modalAgreed > 0 ? modalAgreed : (lastRoundPrice > 0 ? lastRoundPrice : 0);

                    if (effectiveDuplicateWarning?.isDuplicate && !forceSaveDuplicate) {
                      setNotification({
                        type: 'error',
                        message: '⚠️ BU FATURA SİSTEMDE KAYITLI! Mükerrer kaydı onaylamak için lütfen yukarıdaki "Bu faturanın sistemde kayıtlı olduğunu biliyorum, yine de yeni kayıt oluştur" kutucuğunu işaretleyip tekrar Kaydet butonuna basın.'
                      });
                      return;
                    }

                    // SMART AUTO-SORTING FOR DECREASING PRICES (Prevents false "Fiyat Sıralaması Geçersiz" when 3rd round is lower than agreedPrice)
                    let sortedModalRounds = [...currentRounds];
                    let effectiveCalcOffer = calcOffer;
                    if (aiReviewModal.offerType !== 'first') {
                      const allCandidatePrices: number[] = [];
                      if (calcOffer > 0) allCandidatePrices.push(calcOffer);
                      if (modalAgreed > 0) allCandidatePrices.push(modalAgreed);
                      for (const r of currentRounds) {
                        const rp = Number(r.quotedPrice) || 0;
                        if (rp > 0) allCandidatePrices.push(rp);
                        const pp = Number(r.previousPrice) || 0;
                        if (pp > 0) allCandidatePrices.push(pp);
                      }

                      if (allCandidatePrices.length === 0) {
                        setNotification({type: 'error', message: 'Lütfen anlaşılan son indirimli tutarı girin.'});
                        return;
                      }

                      effectiveCalcOffer = Math.max(...allCandidatePrices);
                      calcAgreed = Math.min(...allCandidatePrices);

                      // Collect all intermediate candidate documents strictly between effectiveCalcOffer and calcAgreed
                      const midCandidates: NegotiationRound[] = [];
                      if (modalAgreed > calcAgreed && modalAgreed < effectiveCalcOffer) {
                        midCandidates.push({
                          id: `rnd_auto_mid_${Date.now()}`,
                          roundNumber: 1,
                          date: aiReviewModal.orderDate || new Date().toISOString().split('T')[0],
                          vendorName: aiReviewModal.vendorName || 'Tedarikçi Firma',
                          previousPrice: effectiveCalcOffer,
                          quotedPrice: modalAgreed,
                          discountThisRound: Math.max(0, effectiveCalcOffer - modalAgreed),
                          documentName: aiReviewModal.fileName || '2_Ara_Pazarlik_Faturasi.pdf',
                          note: `Ara Pazarlık Turu: ${formatRuble(effectiveCalcOffer)} → ${formatRuble(modalAgreed)}`
                        });
                      }
                      for (const r of currentRounds) {
                        const rp = Number(r.quotedPrice) || 0;
                        if (rp > calcAgreed && rp < effectiveCalcOffer && !midCandidates.some(m => Math.abs((Number(m.quotedPrice) || 0) - rp) < 0.01)) {
                          midCandidates.push(r);
                        }
                      }
                      sortedModalRounds = midCandidates
                        .sort((a, b) => (Number(b.quotedPrice) || 0) - (Number(a.quotedPrice) || 0))
                        .map((r, idx) => ({ ...r, roundNumber: idx + 1 }));
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
                    const maxDed = Math.max(0, effectiveCalcOffer - calcAgreed);
                    const safeDeduction = calcDeduction > 0 && calcDeduction <= maxDed ? calcDeduction : 0;
                    const safeAdjusted = safeDeduction > 0 ? Math.max(calcAgreed, effectiveCalcOffer - safeDeduction) : effectiveCalcOffer;
                    const safeBaseline = safeDeduction > 0 ? safeAdjusted : effectiveCalcOffer;
                    const calcAmt = Math.max(0, safeBaseline - calcAgreed);
                    const calcPct = safeBaseline > 0 ? Number(((calcAmt / safeBaseline) * 100).toFixed(2)) : 0;

                    const firstDocName = firstOfferFile?.name || '1_Teklif_Gelen_Liste.pdf';
                    const finalDocName = finalOfferFile?.name || aiReviewModal.fileName || '2_Son_Indirimli_Proforma.xlsx';

                    try {
                      setIsProcessingAI(true);
                      let firstUrl = { url: '', fileId: undefined as string | undefined };
                      let finalUrl = { url: '', fileId: undefined as string | undefined };
                      try {
                        firstUrl = await resolveFileUrl(firstOfferFile, firstDocName);
                      } catch (e) {
                        console.warn('firstUrl resolve fallback to inline base64:', e);
                      }
                      try {
                        finalUrl = await resolveFileUrl(finalOfferFile, finalDocName);
                      } catch (e) {
                        console.warn('finalUrl resolve fallback to inline base64:', e);
                      }

                      // Build stageDocuments array
                      const generatedStageDocs: StageDocument[] = [];
                      generatedStageDocs.push({
                        stageNumber: 1,
                        title: '1. İlk Teklif / Fatura',
                        fileName: firstDocName,
                        fileUrl: firstUrl.url,
                        driveFileId: firstUrl.fileId,
                        amount: effectiveCalcOffer
                      });

                      const validRounds: NegotiationRound[] = [];
                      for (let i = 0; i < sortedModalRounds.length; i++) {
                        const r = { ...sortedModalRounds[i] };
                        let rUrl = r.documentUrl || '';
                        if (r.documentName && (!rUrl || rUrl.startsWith('data:'))) {
                          const up = await resolveFileUrl({ name: r.documentName, url: rUrl }, r.documentName);
                          rUrl = up.url;
                        }
                        r.documentUrl = rUrl;
                        const qp = Number(r.quotedPrice) || 0;
                        const hasDoc = Boolean(r.documentName || rUrl || (r as any).fileName || r.note);
                        if (hasDoc && qp > calcAgreed && qp <= safeBaseline) {
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
                        offerPrice: effectiveCalcOffer,
                        scopeDeductionAmount: safeDeduction > 0 ? safeDeduction : undefined,
                        scopeDeductionReason: safeDeduction > 0 ? (aiReviewModal.scopeDeductionReason ? String(aiReviewModal.scopeDeductionReason).trim() : undefined) : undefined,
                        adjustedOfferPrice: safeDeduction > 0 ? safeAdjusted : effectiveCalcOffer,
                        agreedPrice: calcAgreed,
                        orderDate: aiReviewModal.orderDate,
                        notes: aiReviewModal.notes || (calcDeduction > 0 ? `İlk tekliften ${formatRuble(calcDeduction)} düşülerek net indirim hesaplandı.` : 'Teklif belgeleri karşılaştırılarak otomatik kaydedildi.'),
                        invoiceNo: aiReviewModal.invoiceNo,
                        firstOfferFileName: firstDocName,
                        firstOfferFileUrl: firstUrl.url,
                        firstOfferFileData: !firstUrl.url && firstOfferFile?.base64 ? firstOfferFile.base64 : undefined,
                        firstOfferDriveFileId: firstUrl.fileId,
                        finalOfferFileName: finalDocName,
                        finalOfferFileUrl: finalUrl.url,
                        finalOfferFileData: !finalUrl.url && finalOfferFile?.base64 ? finalOfferFile.base64 : undefined,
                        finalOfferDriveFileId: finalUrl.fileId,
                        forceSave: forceSaveDuplicate,
                        forceSaveDuplicate: forceSaveDuplicate,
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
                      setDuplicateWarning(null);
                      setForceSaveDuplicate(false);

                      setAiReviewModal(null);
                      onSuccess();
                    } catch (err: any) {
                      console.error('Error saving discount:', err);
                      const msg = err.message || 'Kayıt sırasında bir hata oluştu.';
                      if (msg.toLowerCase().includes('kayıtlı') || msg.toLowerCase().includes('mükerrer')) {
                        setDuplicateWarning({
                          isDuplicate: true,
                          message: msg
                        });
                      }
                      setNotification({
                        type: 'error',
                        message: msg
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
