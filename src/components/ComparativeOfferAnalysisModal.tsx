import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  UploadCloud,
  FileText,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Info,
  TrendingDown,
  Layers,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Sparkles,
  Building2,
  UserCheck,
  Check,
  Edit3,
  ExternalLink
} from 'lucide-react';
import {
  ComparativeAnalysisRecord,
  CanonicalMaterial,
  DocumentRole,
  Jobsite,
  Supervisor,
  Personnel
} from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  jobsites: Jobsite[];
  supervisors: Supervisor[];
  personnelList: Personnel[];
  onAnalysisSaved: (savedAnalysis: ComparativeAnalysisRecord) => void;
  inline?: boolean;
  initialAnalysis?: ComparativeAnalysisRecord | null;
  onApplyToForm?: (data: {
    vendorName: string;
    offerPrice: number;
    agreedPrice: number;
    discountAmount: number;
    discountPercentage: number;
    invoiceNo?: string;
    invoiceDate?: string;
    supervisorId?: string;
    supervisorName?: string;
    jobsiteId?: string;
    jobsiteName?: string;
    performedByPersonnelId?: string | null;
    performedByPersonnelName?: string | null;
    category?: string;
    firstOfferFileName?: string;
    firstOfferFileUrl?: string;
    finalOfferFileName?: string;
    finalOfferFileUrl?: string;
    items?: any[];
    notes?: string;
    analysisRecord: ComparativeAnalysisRecord;
  }) => void;
}

interface UploadedFileItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  base64: string;
  documentRole: DocumentRole;
  supplierName: string;
  totalAmount?: number | string;
  documentNumber?: string;
  date?: string;
}

export const ComparativeOfferAnalysisModal: React.FC<Props> = ({
  isOpen,
  onClose,
  jobsites,
  supervisors,
  personnelList,
  onAnalysisSaved,
  inline = false,
  initialAnalysis = null,
  onApplyToForm
}) => {
  const { language } = useLanguage();
  const {user} = useAuth();
  const authHeaders = () => ({'Content-Type': 'application/json', 'x-session-token': user?.token || '', 'x-user-role': encodeURIComponent(user?.role || ''), 'x-user-supervisor-id': encodeURIComponent(user?.supervisorId || ''), 'x-user-name': encodeURIComponent(user?.displayName || '')});
  const isRu = language === 'ru';

  const [selectedJobsiteId, setSelectedJobsiteId] = useState<string>('');
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('');
  const [selectedPersonnelId, setSelectedPersonnelId] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStage, setProcessingStage] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Draft analysis result from server
  const [analysis, setAnalysis] = useState<ComparativeAnalysisRecord | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const isSavingRef = React.useRef<boolean>(false);

  const [entryMode, setEntryMode] = useState<'AI' | 'MANUAL'>('AI');

  // Manual TDF Entry State
  const [manualVendorName, setManualVendorName] = useState<string>('');
  const [manualRefVendorName, setManualRefVendorName] = useState<string>('');
  const [manualOfferAmount, setManualOfferAmount] = useState<string>('');
  const [manualAgreedAmount, setManualAgreedAmount] = useState<string>('');
  const [manualInvoiceNo, setManualInvoiceNo] = useState<string>('');
  const [manualInvoiceDate, setManualInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [manualRounds, setManualRounds] = useState<string>('2');
  const [manualMaterials, setManualMaterials] = useState<Array<{
    name: string;
    unit: string;
    quantity: string;
    offerUnitPrice: string;
    agreedUnitPrice: string;
  }>>([
    { name: '', unit: 'adet', quantity: '1', offerUnitPrice: '', agreedUnitPrice: '' }
  ]);

  // Reset state whenever modal is opened or initialAnalysis changes
  useEffect(() => {
    if (isOpen) {
      if (initialAnalysis) {
        setAnalysis(initialAnalysis);
        if (initialAnalysis.jobsiteId) setSelectedJobsiteId(initialAnalysis.jobsiteId);
        if (initialAnalysis.supervisorId) setSelectedSupervisorId(initialAnalysis.supervisorId);
        setSelectedPersonnelId(initialAnalysis.performedByPersonnelId || '');
        setErrorMsg(null);
        setIsSaving(false);
        setSaveSuccess(false);
        isSavingRef.current = false;
      } else {
        setAnalysis(null);
        setUploadedFiles([]);
        setIsProcessing(false);
        setProcessingStage('');
        setErrorMsg(null);
        setIsSaving(false);
        setSaveSuccess(false);
        isSavingRef.current = false;
        setEntryMode('AI');
        setManualVendorName('');
        setManualRefVendorName('');
        setManualOfferAmount('');
        setManualAgreedAmount('');
        setManualInvoiceNo('');
        setManualInvoiceDate(new Date().toISOString().slice(0, 10));
        setManualRounds('2');
        setManualMaterials([
          { name: '', unit: 'adet', quantity: '1', offerUnitPrice: '', agreedUnitPrice: '' }
        ]);
      }
    }
  }, [isOpen, initialAnalysis]);

  // Set default jobsite and supervisor on mount
  useEffect(() => {
    if (jobsites.length > 0 && !selectedJobsiteId) {
      setSelectedJobsiteId(jobsites[0].id);
    }
    if (supervisors.length > 0 && !selectedSupervisorId) {
      setSelectedSupervisorId(supervisors[0].id);
    }
  }, [jobsites, supervisors, selectedJobsiteId, selectedSupervisorId]);

  // Validation before saving as approved discount and invoice (Hook MUST run before any early return)
  const validationErrors: string[] = useMemo(() => {
    if (!analysis) return [];
    const errors: string[] = [];
    const finalDoc = (analysis.documents || []).find(d => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'));
    const firstDoc = (analysis.documents || []).find(d => !d.isExcluded && (d.documentRole === 'FIRST_OFFER' || d.documentRole === 'COMPETITOR_FIRST_OFFER' || d.isInitialOffer));
    
    if (!finalDoc) {
      errors.push(isRu ? 'Отсутствует документ окончательного счета (FINAL_INVOICE)' : 'Nihai Fatura (FINAL_INVOICE) belgesi eksik');
    }
    if (!firstDoc) {
      errors.push(isRu ? 'Отсутствует первоначальное коммерческое предложение (FIRST_OFFER)' : 'Piyasa ilk teklif (FIRST_OFFER) belgesi eksik');
    }
    const sup = (analysis.winningSupplier || finalDoc?.supplier || '').trim();
    if (!sup || sup === 'Seçilen Tedarikçi' || sup === 'Bilinmeyen Tedarikçi' || sup === 'Tedarikçi Firma') {
      errors.push(isRu ? 'Не указан фактический поставщик' : 'Geçerli nihai tedarikçi adı belirtilmedi');
    }
    if (!analysis.jobsiteId || !analysis.jobsiteName || analysis.jobsiteName === 'Bilinmeyen Şantiye') {
      errors.push(isRu ? 'Не выбран строительный объект' : 'Geçerli şantiye seçilmedi');
    }
    if (!analysis.supervisorId || !analysis.supervisorName || analysis.supervisorName === 'Yetkili Şef') {
      errors.push(isRu ? 'Не выбран ответственный шеф закупок' : 'Geçerli yetkili şef seçilmedi');
    }
    const finalTotal = Number(analysis.summary?.finalPurchaseAmount ?? analysis.totalFinalPurchase ?? 0);
    if (finalTotal <= 0) {
      errors.push(isRu ? 'Сумма окончательного счета должна быть больше нуля' : 'Nihai fatura toplam tutarı sıfırdan büyük olmalıdır');
    }
    const activeMaterials = (analysis.canonicalMaterials || []).filter(m => !m.isExcluded);
    if (activeMaterials.length === 0) {
      errors.push(isRu ? 'Нет активных позиций материалов для сохранения' : 'Kaydedilecek en az bir geçerli malzeme kalemi bulunmalıdır');
    }
    return errors;
  }, [analysis, isRu]);

  if (!isOpen) return null;

  // File selection handler
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files: File[] = Array.from(e.target.files);
    setErrorMsg(null);

    const newItems: UploadedFileItem[] = [];
    for (const f of files) {
      try {
        const base64 = await fileToBase64(f);
        const lowerName = f.name.toLowerCase();
        let defaultRole: DocumentRole = 'INITIAL_OFFER';
        if (lowerName.includes('fatura') || lowerName.includes('final') || lowerName.includes('son') || lowerName.includes('счет') || lowerName.includes('упд')) {
          defaultRole = 'FINAL_INVOICE';
        } else if (lowerName.includes('tur') || lowerName.includes('ara') || lowerName.includes('раунд')) {
          defaultRole = 'INTERMEDIATE_ROUND';
        }

        // Clean supplier guess from filename
        let guessSupplier = '';
        if (lowerName.includes('diplomat') || lowerName.includes('дипломат')) guessSupplier = 'ООО "ТСК ДИПЛОМАТ"';
        else if (lowerName.includes('stroysnab') || lowerName.includes('стройснаб')) guessSupplier = 'ООО "СтройСнаб"';
        else if (lowerName.includes('metall') || lowerName.includes('металл')) guessSupplier = 'ООО "МЕТАЛЛ-СЕРВИС"';
        else if (lowerName.includes('diler') || lowerName.includes('дилер')) guessSupplier = 'Diler Demir Çelik';

        newItems.push({
          id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          file: f,
          fileName: f.name,
          fileSize: f.size,
          base64,
          documentRole: defaultRole,
          supplierName: guessSupplier,
          totalAmount: '',
          documentNumber: '',
          date: new Date().toISOString().split('T')[0]
        });
      } catch (err: any) {
        console.error('File read error:', err);
      }
    }

    setUploadedFiles(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateFileRole = (id: string, role: DocumentRole) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, documentRole: role } : f));
  };

  const updateFileSupplier = (id: string, name: string) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, supplierName: name } : f));
  };

  const updateFileAmount = (id: string, amount: string) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, totalAmount: amount } : f));
  };

  const updateFileDocNumber = (id: string, docNumber: string) => {
    setUploadedFiles(prev => prev.map(f => f.id === id ? { ...f, documentNumber: docNumber } : f));
  };

  // Run comparative analysis via backend
  const handleRunAnalysis = async () => {
    if (uploadedFiles.length === 0) {
      setErrorMsg(isRu ? 'Пожалуйста, загрузите хотя бы один документ' : 'Lütfen en az bir belge yükleyin.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    setProcessingStage(isRu ? '1/4 Документы сканируются через Gemini OCR...' : '1/4 Belgeler taranıyor ve analiz ediliyor...');

    try {
      const selectedJob = jobsites.find(j => j.id === selectedJobsiteId) || jobsites[0];
      const selectedSup = supervisors.find(s => s.id === selectedSupervisorId) || supervisors[0];
      const selectedPers = personnelList.find(p => p.id === selectedPersonnelId);

      const archivedFiles = [];
      for (const f of uploadedFiles) {
        const response = await fetch('/api/upload-file', {method: 'POST', headers: authHeaders(), body: JSON.stringify({fileName: f.fileName, fileData: f.base64})});
        const result = await response.json();
        if (!response.ok || !result.success || !(result.fileUrl || result.url)) throw new Error(result.error || 'Belge bulut arşivine kaydedilemedi.');
        archivedFiles.push({...f, fileUrl: result.fileUrl || result.url});
      }
      const payload = {
        files: archivedFiles.map(f => ({
          fileName: f.fileName,
          fileData: f.base64,
          fileUrl: f.fileUrl,
          documentRole: f.documentRole,
          supplierName: f.supplierName,
          totalAmount: f.totalAmount ? Number(f.totalAmount) : undefined,
          documentNumber: f.documentNumber,
          date: f.date
        })),
        jobsiteId: selectedJob?.id || 'job_1',
        jobsiteName: selectedJob?.name || 'SET OF3a',
        supervisorId: selectedSup?.id || 'sup_1',
        supervisorName: selectedSup?.name || 'Şef',
        performedByPersonnelId: selectedPers?.id || null,
        performedByPersonnelName: selectedPers?.name || null,
        currency: 'RUB'
      };

      setProcessingStage(isRu ? '2/4 Сравнение предложений и определение раундов переговоров...' : '2/4 İlk teklifler en düşük fiyat bazında kıyaslanıyor ve tur sayısı belirleniyor...');

      const response = await fetch('/api/comparative-analyses/process', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || (isRu ? 'Ошибка при анализе' : 'Analiz işlemi başarısız oldu.'));
      }

      const result: ComparativeAnalysisRecord = await response.json();
      setAnalysis(result);
      setProcessingStage(isRu ? 'Готово!' : 'İşlem tamamlandı!');
    } catch (err: any) {
      console.error('[RUN ANALYSIS ERROR]:', err);
      setErrorMsg(err.message || (isRu ? 'Ошибка при обработке' : 'İşlem sırasında beklenmeyen bir hata oluştu.'));
    } finally {
      setIsProcessing(false);
    }
  };

  // Create manual analysis record
  const handleCreateManualAnalysis = () => {
    setErrorMsg(null);
    const offerAmt = Number(manualOfferAmount) || 0;
    const agreedAmt = Number(manualAgreedAmount) || 0;
    
    if (agreedAmt <= 0) {
      setErrorMsg(isRu ? 'Укажите итоговую сумму счета больше нуля' : 'Lütfen sıfırdan büyük geçerli bir son anlaşılan fatura tutarı girin.');
      return;
    }
    if (!manualVendorName.trim()) {
      setErrorMsg(isRu ? 'Укажите наименование поставщика' : 'Lütfen anlaşılan / seçilen tedarikçi firma adını girin.');
      return;
    }

    const realSav = Math.max(0, offerAmt - agreedAmt);
    const realRate = offerAmt > 0 ? Number(((realSav / offerAmt) * 100).toFixed(2)) : 0;

    const job = jobsites.find(j => j.id === selectedJobsiteId);
    const sup = supervisors.find(s => s.id === selectedSupervisorId);
    const pers = personnelList.find(p => p.id === selectedPersonnelId);

    const validMaterials = manualMaterials.filter(m => m.name.trim().length > 0);

    const created: ComparativeAnalysisRecord = {
      id: `tdf_man_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      analysisCode: `TDF-MAN-${Date.now().toString().slice(-5)}`,
      date: manualInvoiceDate || new Date().toISOString().split('T')[0],
      jobsiteId: selectedJobsiteId || (job ? job.id : 'job_1'),
      jobsiteName: job ? job.name : 'Genel Şantiye',
      supervisorId: selectedSupervisorId || (sup ? sup.id : 'sup_1'),
      supervisorName: sup ? sup.name : 'Yetkili Şef',
      performedByPersonnelId: selectedPersonnelId || null,
      currency: 'RUB',
      status: 'completed',
      calculationMethod: 'MARKET_BASELINE_TO_FINAL',
      thresholdApplied: {
        thresholdRub: 1000000,
        isOverThreshold: agreedAmt >= 1000000,
        isMandatory: true
      },
      auditLog: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      winningSupplier: manualVendorName.trim(),
      totalInitialLowestOffer: offerAmt > 0 ? offerAmt : agreedAmt,
      totalFinalPurchase: agreedAmt,
      totalWinningSupplierInitialOffer: offerAmt > 0 ? offerAmt : agreedAmt,
      realMarketSavings: realSav,
      internalVendorSavings: realSav,
      realSavingsRate: realRate,
      internalVendorRate: realRate,
      uniqueSuppliersCount: 2,
      isSingleVendor: offerAmt <= agreedAmt,
      isAboveBestOffer: false,
      negotiationRoundsCount: Number(manualRounds) || 1,
      documents: [
        {
          id: `doc_init_${Date.now()}`,
          documentRole: 'FIRST_OFFER',
          supplier: manualRefVendorName.trim() || 'Piyasa İlk Teklif',
          fileName: 'Piyasa_Ilk_Teklif.pdf',
          fileUrl: '',
          roleConfidence: 1.0,
          totalAmount: offerAmt > 0 ? offerAmt : agreedAmt,
          currency: 'RUB',
          isVatIncluded: true,
          isShippingIncluded: true,
          isExcluded: false,
          isInitialOffer: true,
          items: []
        },
        {
          id: `doc_final_${Date.now()}`,
          documentRole: 'FINAL_INVOICE',
          supplier: manualVendorName.trim(),
          fileName: `Fatura_${manualInvoiceNo || 'TDF'}.pdf`,
          fileUrl: '',
          roleConfidence: 1.0,
          totalAmount: agreedAmt,
          currency: 'RUB',
          isVatIncluded: true,
          isShippingIncluded: true,
          isExcluded: false,
          documentNumber: manualInvoiceNo,
          date: manualInvoiceDate,
          items: []
        }
      ],
      canonicalMaterials: validMaterials.length > 0
        ? validMaterials.map((m, idx) => {
            const qty = Number(m.quantity) || 1;
            const offerPrice = Number(m.offerUnitPrice) || 0;
            const agreedPrice = Number(m.agreedUnitPrice) || 0;
            return {
              id: `mat_man_${idx}_${Date.now()}`,
              canonicalName: m.name,
              commonName: m.name,
              standardUnit: m.unit || 'adet',
              purchasedQuantity: qty,
              marketReferenceUnitPrice: offerPrice,
              purchasedUnitPrice: agreedPrice,
              marketReferenceSupplier: manualRefVendorName.trim() || 'Piyasa Referans',
              purchasedSupplier: manualVendorName.trim(),
              realTotalSavings: (offerPrice - agreedPrice) * qty,
              matchConfidence: 1.0,
              isExcluded: false,
              lines: []
            };
          })
        : [
            {
              id: `mat_man_def_${Date.now()}`,
              canonicalName: 'Karşılaştırmalı Teklif Malzemesi',
              commonName: 'Karşılaştırmalı Teklif Malzemesi',
              standardUnit: 'kalem',
              purchasedQuantity: 1,
              marketReferenceUnitPrice: offerAmt > 0 ? offerAmt : agreedAmt,
              purchasedUnitPrice: agreedAmt,
              marketReferenceSupplier: manualRefVendorName.trim() || 'Piyasa Referans',
              purchasedSupplier: manualVendorName.trim(),
              realTotalSavings: realSav,
              matchConfidence: 1.0,
              isExcluded: false,
              lines: []
            }
          ],
      summary: {
        totalVendors: 2,
        totalInitialLowestOffer: offerAmt > 0 ? offerAmt : agreedAmt,
        totalFinalPurchase: agreedAmt,
        lowestInitialOfferSupplier: manualRefVendorName.trim() || 'Piyasa Referans',
        lowestInitialOfferAmount: offerAmt > 0 ? offerAmt : agreedAmt,
        finalPurchaseSupplier: manualVendorName.trim(),
        finalPurchaseAmount: agreedAmt,
        realMarketSavings: realSav,
        realSavingsRate: realRate,
        internalVendorSavings: realSav,
        internalVendorRate: realRate,
        isAboveBestOfferCount: 0,
        isSingleVendor: offerAmt <= agreedAmt,
        excludedOffersCount: 0,
        pendingApprovalsCount: 0,
        totalDocuments: 2,
        totalMaterials: validMaterials.length || 1,
        overallConfidence: 1.0
      }
    };

    setAnalysis(created);
  };

  // Toggle exclusion of a canonical material
  const handleToggleExclusion = (materialId: string) => {
    if (!analysis) return;
    const updated = { ...analysis };
    updated.canonicalMaterials = updated.canonicalMaterials.map(m => {
      if (m.id === materialId) {
        const isExcluded = !m.isExcluded;
        return {
          ...m,
          isExcluded,
          exclusionReason: isExcluded ? (m.exclusionReason || (isRu ? 'Исключено пользователем' : 'Kullanıcı tarafından hariç tutuldu')) : undefined
        };
      }
      return m;
    });

    // Recalculate totals excluding marked items
    let totalInitial = 0;
    let totalFinal = 0;
    let winningInitial = 0;

    updated.canonicalMaterials.forEach(m => {
      if (m.isExcluded) return;
      const qty = Number(m.purchasedQuantity) || 1;
      const refPrice = Number(m.marketReferenceUnitPrice) || 0;
      const finalPrice = Number(m.purchasedUnitPrice) || 0;
      
      totalInitial += (refPrice * qty);
      totalFinal += (finalPrice * qty);

      const winningFirstLine = (m.lines || []).find(l => l.supplierName === updated.winningSupplier && (l.documentRole === 'FIRST_OFFER' || l.isInitialOffer));
      const winningFirstPrice = winningFirstLine ? (winningFirstLine.normalizedUnitPrice || winningFirstLine.rawUnitPrice) : (refPrice || finalPrice);
      winningInitial += (winningFirstPrice * qty);
    });

    updated.totalInitialLowestOffer = totalInitial;
    updated.totalFinalPurchase = totalFinal;
    updated.totalWinningSupplierInitialOffer = winningInitial;
    updated.realMarketSavings = Math.max(0, totalInitial - totalFinal);
    updated.internalVendorSavings = Math.max(0, winningInitial - totalFinal);
    updated.realSavingsRate = totalInitial > 0 ? Number(((updated.realMarketSavings / totalInitial) * 100).toFixed(2)) : 0;
    updated.internalVendorRate = winningInitial > 0 ? Number(((updated.internalVendorSavings / winningInitial) * 100).toFixed(2)) : 0;

    if (updated.summary) {
      updated.summary.totalInitialLowestOffer = totalInitial;
      updated.summary.totalFinalPurchase = totalFinal;
      updated.summary.realMarketSavings = updated.realMarketSavings;
      updated.summary.realSavingsRate = updated.realSavingsRate;
      updated.summary.internalVendorSavings = updated.internalVendorSavings;
      updated.summary.excludedOffersCount = updated.canonicalMaterials.filter(m => m.isExcluded).length;
    }

    setAnalysis(updated);
  };

  // Save confirmed analysis to backend
  const handleSaveAnalysis = async () => {
    if (!analysis) return;
    if (validationErrors.length > 0) {
      setErrorMsg(validationErrors.join(' | '));
      return;
    }
    if (isSavingRef.current || isSaving) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMsg(null);

    try {
      const response = await fetch('/api/comparative-analyses/save', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(analysis)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.details || errData.error || (isRu ? 'Ошибка при сохранении' : 'Kaydetme başarısız oldu.'));
      }

      const result = await response.json();
      setSaveSuccess(true);
      if (onAnalysisSaved && result.analysis) {
        onAnalysisSaved(result.analysis);
      }
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('[SAVE ANALYSIS ERROR]:', err);
      setErrorMsg(err.message || (isRu ? 'Ошибка сохранения' : 'Kaydetme sırasında bir hata oluştu.'));
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;
    }
  };

  // Apply final invoice data and lowest offer baseline directly to main discount entry form
  const handleApplyToForm = () => {
    if (!analysis || !onApplyToForm) return;

    const finalDoc = analysis.documents?.find(d => d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER') ||
                     analysis.documents?.[analysis.documents.length - 1];
    const lowestFirstDoc = analysis.documents?.find(d => d.supplier === analysis.summary?.lowestInitialOfferSupplier || d.documentRole === 'FIRST_OFFER' || d.documentRole === 'COMPETITOR_FIRST_OFFER') ||
                          analysis.documents?.[0];

    const finalInvNo = analysis.finalInvoice?.documentNumber || finalDoc?.documentNumber || '';
    const finalInvDate = analysis.finalInvoice?.date || finalDoc?.date || analysis.date;
    const roundsCount = analysis.negotiationRoundsCount || (analysis.negotiationStages ? analysis.negotiationStages.length : 0);

    let docItems: any[] = [];
    if (finalDoc?.items && finalDoc.items.length > 0) {
      docItems = finalDoc.items;
    } else if (analysis.canonicalMaterials && analysis.canonicalMaterials.length > 0) {
      docItems = analysis.canonicalMaterials
        .filter(m => !m.isExcluded)
        .map((m, idx) => ({
          id: m.id || `can_item_${idx}`,
          materialName: m.commonName,
          originalName: m.commonName,
          category: m.materialType || 'İnşaat Malzemesi',
          quantity: Number(m.purchasedQuantity) || 1,
          unit: m.standardUnit || 'adet',
          unitPrice: Number(m.purchasedUnitPrice) || 0,
          totalPrice: (Number(m.purchasedQuantity) || 1) * (Number(m.purchasedUnitPrice) || 0)
        }));
    }

    onApplyToForm({
      vendorName: analysis.winningSupplier || finalDoc?.supplier || 'Seçilen Tedarikçi',
      offerPrice: analysis.totalInitialLowestOffer,
      agreedPrice: analysis.totalFinalPurchase,
      discountAmount: analysis.realMarketSavings,
      discountPercentage: analysis.realSavingsRate,
      invoiceNo: finalInvNo,
      invoiceDate: finalInvDate,
      supervisorId: analysis.supervisorId,
      supervisorName: analysis.supervisorName,
      jobsiteId: analysis.jobsiteId,
      jobsiteName: analysis.jobsiteName,
      performedByPersonnelId: analysis.performedByPersonnelId,
      performedByPersonnelName: analysis.performedByPersonnelName,
      category: docItems[0]?.category || 'Karşılaştırmalı Teklif Analizi',
      firstOfferFileName: lowestFirstDoc?.fileName,
      firstOfferFileUrl: lowestFirstDoc?.fileUrl,
      finalOfferFileName: finalDoc?.fileName,
      finalOfferFileUrl: finalDoc?.fileUrl,
      items: docItems,
      notes: `Karşılaştırmalı Analiz #${analysis.analysisCode}. Kazanan Tedarikçi (Son Fatura): ${analysis.winningSupplier}. İlk teklifler havuzundaki en düşük fiyata (${analysis.totalInitialLowestOffer.toLocaleString('tr-TR')} ₽) göre net indirim uygulanmıştır.${roundsCount > 0 ? ` Ara Pazarlık: ${roundsCount} Tur.` : ''}`,
      analysisRecord: analysis
    });

    onClose();
  };

  const formatCurrency = (val?: number) => {
    if (val === undefined || val === null || isNaN(Number(val))) return '0 ₽';
    const num = Number(val);
    const hasDecimals = Math.abs(num - Math.round(num)) >= 0.005;
    if (hasDecimals) {
      return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
    }
    return Math.round(num).toLocaleString('tr-TR') + ' ₽';
  };

  return (
    <div className={inline ? "w-full" : "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs overflow-y-auto"}>
      <div className={inline ? "bg-white rounded-3xl shadow-md border border-indigo-200/80 w-full overflow-hidden flex flex-col" : "bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl my-8 overflow-hidden flex flex-col max-h-[92vh]"}>
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-500/20 border border-indigo-400/30 rounded-xl">
              <Layers className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-lg font-bold">
                  {isRu ? 'Рабочая панель TDF: Сравнение КП и расчет экономии' : 'TDF Akıllı Teklif Değerlendirme & Karşılaştırma Paneli'}
                </h2>
                <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full font-bold border border-emerald-400/30">
                  {isRu ? 'Анализ от минимального первого КП (Dip Fiyat)' : 'İlk Teklifler En Düşük Dip Fiyat Bazlı'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {isRu 
                  ? 'Загрузите первые КП поставщиков, промежуточные раунды торга и окончательный счет. Система автоматически найдет минимальную начальную цену и рассчитает реальную экономию.' 
                  : 'Toplanan ilk teklifleri, ara pazarlık tekliflerini ve nihai anlaşılan faturayı yükleyin; sistem ilk tekliflerden en düşük dip fiyatı baz alarak gerçek indirimi otomatik hesaplar.'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {analysis && (
              <button
                onClick={() => {
                  setAnalysis(null);
                  setUploadedFiles([]);
                  setSaveSuccess(false);
                  setErrorMsg(null);
                  if (inline) onClose();
                }}
                className="px-3 py-1.5 text-xs font-bold bg-indigo-500/30 hover:bg-indigo-500/50 text-white rounded-xl border border-indigo-400/40 transition cursor-pointer"
              >
                {isRu ? '+ Новый расчет TDF' : '+ Yeni TDF Analizi Başlat / Temizle'}
              </button>
            )}
            {!inline && (
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Body Container */}
        <div className={inline ? "p-6 space-y-6" : "p-6 overflow-y-auto flex-1 space-y-6"}>

          {/* Business Logic Explanation Banner */}
          <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl text-xs text-indigo-950 flex items-start space-x-3">
            <Info className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
            <div className="leading-relaxed">
              <span className="font-semibold">
                {isRu ? 'Принцип расчета реальной экономии:' : 'Doğru Piyasa Referansı (Market Baseline):'}
              </span>{' '}
              {isRu
                ? 'Реальная экономия рассчитывается как разница между самым низким первоначальным предложением на рынке и окончательной ценой сделки. Скидка внутри одной компании носит справочный характер.'
                : 'Piyasa referansı, karşılaştırılabilir ilk teklifler arasındaki en düşük birim fiyattır. Şefin satın aldığı firmanın kendi ilk teklifine göre sağladığı indirim ayrıca bilgi amaçlı gösterilir, fakat ana performans hesabına piyasa bazlı tasarruf esas alınır.'}
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Top Parameters (Jobsite, Supervisor, Personnel) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center space-x-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500" />
                <span>{isRu ? 'Объект / Стройплощадка' : 'Şantiye (Zorunlu)'}</span>
              </label>
              <select
                value={selectedJobsiteId}
                onChange={e => setSelectedJobsiteId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                {jobsites.map(j => (
                  <option key={j.id} value={j.id}>{j.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center space-x-1.5">
                <UserCheck className="w-3.5 h-3.5 text-slate-500" />
                <span>{isRu ? 'Ответственный шеф' : 'Satınalma Şefi'}</span>
              </label>
              <select
                value={selectedSupervisorId}
                onChange={e => setSelectedSupervisorId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isRu ? 'Ассистент / Персонал (Опционально)' : 'Yardımcı Personel (Asist / Opsiyonel)'}
              </label>
              <select
                value={selectedPersonnelId}
                onChange={e => setSelectedPersonnelId(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{isRu ? '-- Нет ассистента (Только шеф) --' : '-- Personel Yok (Tek Başına Şef) --'}</option>
                {personnelList.map(p => (
                  <option key={p.id} value={p.id}>{p.name} - {p.title || 'Personel'}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Entry Mode Switcher Tabs */}
          {!analysis && (
            <div className="flex items-center space-x-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
              <button
                type="button"
                onClick={() => setEntryMode('AI')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-2 transition cursor-pointer ${
                  entryMode === 'AI'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <span>{isRu ? '🤖 AI Загрузка документов' : '🤖 AI Belge / Dosya Yükleyerek Otomatik Analiz'}</span>
              </button>
              <button
                type="button"
                onClick={() => setEntryMode('MANUAL')}
                className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-2 transition cursor-pointer ${
                  entryMode === 'MANUAL'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                <span>{isRu ? '✍️ Ручной ввод TDF' : '✍️ Manuel 1M+ ₽ TDF Analiz Kaydı Ekle'}</span>
              </button>
            </div>
          )}

          {/* Section 1-B: Manual TDF Entry Form */}
          {!analysis && entryMode === 'MANUAL' && (
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <h3 className="text-sm font-extrabold text-slate-800">
                  {isRu ? 'Ручной ввод сравнительного анализа (TDF 1M+ ₽)' : 'Manuel 1.000.000 ₽ Karşılaştırmalı Teklif Kaydı'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isRu
                    ? 'Введите данные первоначального коммерческого предложения и окончательного согласованного счета'
                    : 'Firma teklifleri ve son anlaşılan fatura tutarlarını manuel girerek hızlıca karşılaştırmalı analiz oluşturun.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? 'Выигравший / Согласованный поставщик' : 'Anlaşılan / Seçilen Tedarikçi Firma *'}
                  </label>
                  <input
                    type="text"
                    value={manualVendorName}
                    onChange={e => setManualVendorName(e.target.value)}
                    placeholder={isRu ? 'Например: ООО "ТСК ДИПЛОМАТ"' : 'Örn: Diler Demir Çelik A.Ş.'}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? 'Первоначальный базовый поставщик' : 'Piyasa İlk Teklif Firma Adı'}
                  </label>
                  <input
                    type="text"
                    value={manualRefVendorName}
                    onChange={e => setManualRefVendorName(e.target.value)}
                    placeholder={isRu ? 'Например: ООО "СтройСнаб"' : 'Örn: Piyasa En Ucuz İlk Teklif Veren'}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? 'Первоначальная сумма рынка (₽)' : 'Piyasa En Düşük İlk Teklif Tutarı (₽)'}
                  </label>
                  <input
                    type="number"
                    value={manualOfferAmount}
                    onChange={e => setManualOfferAmount(e.target.value)}
                    placeholder="Örn: 1540000"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? 'Итоговая сумма счета (₽) *' : 'Son Anlaşılan Fatura Tutarı (Net ₽) *'}
                  </label>
                  <input
                    type="number"
                    value={manualAgreedAmount}
                    onChange={e => setManualAgreedAmount(e.target.value)}
                    placeholder="Örn: 1380000"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-indigo-900 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? '№ счета' : 'Fatura / Belge Seri No'}
                  </label>
                  <input
                    type="text"
                    value={manualInvoiceNo}
                    onChange={e => setManualInvoiceNo(e.target.value)}
                    placeholder="Örn: INV-2026-991"
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isRu ? 'Дата счета / сделки' : 'Fatura / Anlaşma Tarihi'}
                  </label>
                  <input
                    type="date"
                    value={manualInvoiceDate}
                    onChange={e => setManualInvoiceDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Material Items List */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    {isRu ? 'Позиции материалов' : 'Malzeme / Hizmet Kalemleri'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setManualMaterials(prev => [...prev, { name: '', unit: 'adet', quantity: '1', offerUnitPrice: '', agreedUnitPrice: '' }])}
                    className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-200 hover:bg-indigo-100 transition cursor-pointer"
                  >
                    + Kalem Ekle
                  </button>
                </div>

                <div className="space-y-2">
                  {manualMaterials.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 bg-white p-2.5 rounded-xl border border-slate-200 items-center text-xs">
                      <div className="col-span-4">
                        <input
                          type="text"
                          value={item.name}
                          onChange={e => {
                            const val = e.target.value;
                            setManualMaterials(prev => prev.map((m, i) => i === idx ? { ...m, name: val } : m));
                          }}
                          placeholder="Malzeme Adı (örn: A500C Ø12 Rebar)"
                          className="w-full border border-slate-300 rounded-lg px-2 py-1.5 font-semibold text-slate-800"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={item.unit}
                          onChange={e => {
                            const val = e.target.value;
                            setManualMaterials(prev => prev.map((m, i) => i === idx ? { ...m, unit: val } : m));
                          }}
                          placeholder="Birim (ton, m3)"
                          className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-center text-slate-700"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => {
                            const val = e.target.value;
                            setManualMaterials(prev => prev.map((m, i) => i === idx ? { ...m, quantity: val } : m));
                          }}
                          placeholder="Miktar"
                          className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          value={item.agreedUnitPrice}
                          onChange={e => {
                            const val = e.target.value;
                            setManualMaterials(prev => prev.map((m, i) => i === idx ? { ...m, agreedUnitPrice: val } : m));
                          }}
                          placeholder="Birim Fiyat ₽"
                          className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-right font-mono font-bold"
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        {manualMaterials.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setManualMaterials(prev => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="button"
                  onClick={handleCreateManualAnalysis}
                  className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white rounded-xl text-xs font-black shadow-md transition cursor-pointer flex items-center space-x-2"
                >
                  <Check className="w-4 h-4" />
                  <span>{isRu ? 'Создать расчет и просмотреть' : 'Analizi Oluştur ve Önizle'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Section 1-A: Multi-Document Upload */}
          {!analysis && entryMode === 'AI' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {isRu ? '1. Загрузка коммерческих предложений и счетов' : '1. Teklif ve Fatura Belgelerinin Yüklenmesi'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isRu
                      ? 'Загрузите предложения всех участвующих фирм (минимум 2-3) и окончательный счет'
                      : 'Kıyaslama yapılacak tüm firma tekliflerini (en az 2-3 adet) ve nihai faturayı yükleyin'}
                  </p>
                </div>
                <label className="inline-flex items-center space-x-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-xs transition-colors">
                  <UploadCloud className="w-4 h-4" />
                  <span>{isRu ? 'Выбрать файлы (PDF / Изображения)' : 'Belge Ekle (PDF / Resim)'}</span>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,image/png,image/jpeg,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Uploaded Files Table */}
              {uploadedFiles.length > 0 ? (
                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50 shadow-xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100/90 text-slate-700 border-b border-slate-200">
                          <th className="py-2.5 px-3 font-bold">{isRu ? 'Файл' : 'Belge'}</th>
                          <th className="py-2.5 px-3 font-bold">{isRu ? 'Поставщик / Фирма' : 'Tedarikçi / Firma Adı'}</th>
                          <th className="py-2.5 px-3 font-bold">{isRu ? 'Роль документа' : 'Belge Rolü (Kutucuk Seçimi)'}</th>
                          <th className="py-2.5 px-3 font-bold">{isRu ? 'Сумма (₽)' : 'Tutar (₽)'}</th>
                          <th className="py-2.5 px-3 font-bold">{isRu ? '№ счета' : 'Fatura / Belge No'}</th>
                          <th className="py-2.5 px-3 font-bold text-center">{isRu ? 'Удалить' : 'Sil'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {uploadedFiles.map(file => {
                          const isInitial = file.documentRole === 'INITIAL_OFFER';
                          const isIntermediate = file.documentRole === 'INTERMEDIATE_ROUND';
                          const isFinal = file.documentRole === 'FINAL_INVOICE' || file.documentRole === 'FINAL_OFFER';

                          return (
                            <tr key={file.id} className={`hover:bg-white transition-colors ${
                              isFinal ? 'bg-emerald-50/30' : isIntermediate ? 'bg-amber-50/20' : 'bg-indigo-50/20'
                            }`}>
                              <td className="py-2 px-3 text-slate-800 font-medium">
                                <div className="flex items-center space-x-2">
                                  <FileText className={`w-4 h-4 shrink-0 ${
                                    isFinal ? 'text-emerald-600' : isIntermediate ? 'text-amber-600' : 'text-indigo-600'
                                  }`} />
                                  <div className="truncate max-w-[170px]" title={file.fileName}>
                                    <span className="block truncate font-semibold text-slate-800">{file.fileName}</span>
                                    <span className="text-[10px] text-slate-400">{(file.fileSize / 1024).toFixed(0)} KB</span>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="text"
                                  value={file.supplierName}
                                  onChange={e => updateFileSupplier(file.id, e.target.value)}
                                  placeholder={isRu ? 'Название поставщика' : 'Tedarikçi Adı'}
                                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 font-medium"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <select
                                  value={file.documentRole}
                                  onChange={e => updateFileRole(file.id, e.target.value as DocumentRole)}
                                  className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-bold focus:outline-hidden focus:ring-2 ${
                                    isFinal
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 focus:ring-emerald-500'
                                      : isIntermediate
                                        ? 'bg-amber-50 text-amber-800 border-amber-300 focus:ring-amber-500'
                                        : 'bg-indigo-50 text-indigo-800 border-indigo-300 focus:ring-indigo-500'
                                  }`}
                                >
                                  <option value="INITIAL_OFFER">
                                    🏷️ {isRu ? 'Первое предложение (Рыночная база)' : 'İlk Teklif (Piyasa Teklifi)'}
                                  </option>
                                  <option value="INTERMEDIATE_ROUND">
                                    🔄 {isRu ? 'Промежуточный раунд переговоров' : 'Ara Pazarlık Turu'}
                                  </option>
                                  <option value="FINAL_INVOICE">
                                    ⭐ {isRu ? 'Окончательный согласованный счет' : 'Nihai Anlaşılan Fatura'}
                                  </option>
                                  <option value="FINAL_OFFER">
                                    📄 {isRu ? 'Окончательное предложение' : 'Nihai Teklif'}
                                  </option>
                                </select>
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="number"
                                  value={file.totalAmount !== undefined ? file.totalAmount : ''}
                                  onChange={e => updateFileAmount(file.id, e.target.value)}
                                  placeholder={isRu ? 'Сумма ₽ (или авто)' : 'Tutar ₽ (veya otomatik)'}
                                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <input
                                  type="text"
                                  value={file.documentNumber || ''}
                                  onChange={e => updateFileDocNumber(file.id, e.target.value)}
                                  placeholder={isRu ? '№ счета' : 'Fatura No'}
                                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                                />
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeFile(file.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                  title={isRu ? 'Удалить' : 'Sil'}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Live Calculation Preview Card */}
                  {(() => {
                    const initFiles = uploadedFiles.filter(f => f.documentRole === 'INITIAL_OFFER');
                    const interFiles = uploadedFiles.filter(f => f.documentRole === 'INTERMEDIATE_ROUND');
                    const finalFiles = uploadedFiles.filter(f => f.documentRole === 'FINAL_INVOICE' || f.documentRole === 'FINAL_OFFER');

                    const initAmounts = initFiles
                      .map(f => ({ name: f.supplierName || f.fileName, amount: Number(f.totalAmount) || 0 }))
                      .filter(f => f.amount > 0);

                    const lowestInit = initAmounts.length > 0
                      ? initAmounts.reduce((min, cur) => cur.amount < min.amount ? cur : min, initAmounts[0])
                      : null;

                    const lastFinal = finalFiles[finalFiles.length - 1];
                    const finalAmt = lastFinal && Number(lastFinal.totalAmount) > 0 ? Number(lastFinal.totalAmount) : 0;
                    const diff = lowestInit && finalAmt > 0 ? Math.max(0, lowestInit.amount - finalAmt) : 0;
                    const pct = lowestInit && lowestInit.amount > 0 && diff > 0 ? Number(((diff / lowestInit.amount) * 100).toFixed(2)) : 0;

                    return (
                      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-xl p-4 text-white shadow-md border border-indigo-900/50 space-y-3">
                        <div className="flex items-center justify-between border-b border-indigo-800/40 pb-2">
                          <div className="flex items-center space-x-2">
                            <Sparkles className="w-4 h-4 text-amber-400" />
                            <span className="text-xs font-bold text-slate-100">
                              {isRu ? 'Предварительный просмотр логики сравнения' : 'Canlı Kıyaslama ve Tur Analizi Özeti'}
                            </span>
                          </div>
                          <span className="text-[11px] bg-indigo-500/30 text-indigo-200 px-2 py-0.5 rounded-md font-medium">
                            {initFiles.length} {isRu ? 'начальных' : 'İlk Teklif'} | {interFiles.length} {isRu ? 'раундов' : 'Ara Tur'} | {finalFiles.length} {isRu ? 'итоговых' : 'Nihai Fatura'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          {/* 1. Lowest Initial Offer */}
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                              {isRu ? '1. База рынка (Мин. из первых)' : '1. Piyasa Bazı (İlk Tekliflerin En Düşüğü)'}
                            </span>
                            <div className="font-bold text-slate-200 mt-1 flex items-center justify-between">
                              <span className="truncate max-w-[130px]">{lowestInit ? lowestInit.name : (initFiles.length > 0 ? `${initFiles.length} teklif yüklendi` : 'Girilmedi')}</span>
                              <span className="font-mono text-emerald-400 font-extrabold">{lowestInit ? formatCurrency(lowestInit.amount) : 'Taranacak'}</span>
                            </div>
                            <span className="text-[10px] text-emerald-400/90 mt-0.5 block">
                              {isRu ? '★ Принимается за точку отсчета' : '★ Referans başlangıç fiyatı olarak alınır'}
                            </span>
                          </div>

                          {/* 2. Negotiation Rounds */}
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                              {isRu ? '2. Раунды переговоров' : '2. Ara Pazarlık Turları'}
                            </span>
                            <div className="font-bold text-slate-200 mt-1 flex items-center justify-between">
                              <span>{interFiles.length > 0 ? `${interFiles.length} Ara Teklif` : 'Doğrudan Anlaşma'}</span>
                              <span className="font-mono text-amber-300 font-extrabold">{interFiles.length} Tur</span>
                            </div>
                            <span className="text-[10px] text-amber-300/90 mt-0.5 block">
                              {isRu ? 'Определяет количество раундов' : 'Pazarlık tur sayısını belirler'}
                            </span>
                          </div>

                          {/* 3. Final Agreed Invoice */}
                          <div className="bg-white/5 border border-white/10 rounded-lg p-2.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold">
                              {isRu ? '3. Итоговый счет (Только эти данные пойдут в форму)' : '3. Son Anlaşılan Fatura (Forma Girecek)'}
                            </span>
                            <div className="font-bold text-slate-200 mt-1 flex items-center justify-between">
                              <span className="truncate max-w-[130px]">{lastFinal ? (lastFinal.supplierName || 'Son Fatura') : 'Seçilmedi'}</span>
                              <span className="font-mono text-indigo-300 font-extrabold">{finalAmt > 0 ? formatCurrency(finalAmt) : 'Taranacak'}</span>
                            </div>
                            <span className="text-[10px] text-indigo-300/90 mt-0.5 block truncate" title={lastFinal?.documentNumber ? `Fatura No: ${lastFinal.documentNumber}` : ''}>
                              {lastFinal?.documentNumber ? `Fatura No: ${lastFinal.documentNumber}` : 'Son anlaşılan firma'}
                            </span>
                          </div>
                        </div>

                        {lowestInit && finalAmt > 0 && (
                          <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-2.5 flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                              <span className="text-emerald-200">
                                <strong>{isRu ? 'Расчетная чистая экономия:' : 'Hesaplanan Gerçek Tasarruf:'}</strong>{' '}
                                {lowestInit.name} ({formatCurrency(lowestInit.amount)}) - Son Fatura ({formatCurrency(finalAmt)})
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-extrabold text-emerald-400 text-sm">+{formatCurrency(diff)}</span>
                              <span className="text-emerald-300 text-[11px] ml-1.5 font-bold">({pct}%)</span>
                            </div>
                          </div>
                        )}

                        <div className="text-[11px] text-slate-300 bg-black/20 p-2 rounded-lg flex items-start space-x-1.5">
                          <Info className="w-4 h-4 text-indigo-300 shrink-0 mt-0.5" />
                          <span>
                            {isRu
                              ? 'Анализ берет за основу номенклатуру и объемы СОГЛАСОВАННОГО счета (итоговой закупки), сопоставляя их с единичными расценками первого предложения для расчета реальной экономии.'
                              : 'Analiz, ANLAŞILAN TEKLİF / FATURADAKİ kalemleri ve miktarları/tonajları birebir baz alır. İlk tekliflerdeki birim fiyatlar anlaşılan bu miktarlarla eşleştirilerek gerçek tasarruf hesaplanır.'}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50">
                  <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    {isRu ? 'Перетащите сюда файлы или нажмите кнопку выше' : 'Kıyaslanacak teklif ve fatura dosyalarını buraya sürükleyin veya yukarıdan seçin'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {isRu 
                      ? 'Поддерживаются форматы PDF, PNG, JPG (несколько файлов одновременно)'
                      : 'PDF, PNG, JPG formatları desteklenir (birden fazla dosya aynı anda seçilebilir)'}
                  </p>
                </div>
              )}

              {/* Run Analysis Trigger */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleRunAnalysis}
                  disabled={isProcessing || uploadedFiles.length === 0}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{processingStage}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-200" />
                      <span>{isRu ? 'Запустить сравнительный анализ AI' : 'AI ile Karşılaştırmalı Analizi Başlat'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Section 2: Analysis Results View */}
          {analysis && (
            <div className="space-y-6">

              {/* Analysis Header & Actions Bar */}
              <div className="flex items-center justify-between bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex items-center space-x-3">
                  <span className="font-mono font-bold text-xs bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-md border border-indigo-200">
                    #{analysis.analysisCode}
                  </span>
                  <div className="text-xs text-slate-700">
                    <span className="font-semibold">{isRu ? 'Победивший поставщик:' : 'Kazanan / Satın Alınan Firma:'}</span>{' '}
                    <span className="text-indigo-900 font-bold">{analysis.winningSupplier || '-'}</span>
                  </div>
                  <span className="text-slate-300">|</span>
                  <div className="text-xs text-slate-600">
                    {isRu ? 'Сравнено предложений:' : 'Kıyaslanan Teklif Sayısı:'}{' '}
                    <span className="font-semibold text-slate-900">{analysis.summary?.totalVendors || 1}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setAnalysis(null)}
                    className="px-3 py-1.5 border border-slate-300 hover:bg-white text-slate-700 rounded-lg text-xs font-medium transition-colors"
                  >
                    {isRu ? '← Изменить файлы' : '← Dosyaları Değiştir'}
                  </button>
                </div>
              </div>

              {/* Procedural Warnings & Alerts */}
              {analysis.isSingleVendor && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex items-start space-x-3">
                  <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-bold">{isRu ? 'Внимание: Единственный поставщик' : 'Uyarı: Tek Tedarikçi Teklifi'}</span>
                    <p className="mt-0.5 text-amber-800">
                      {isRu 
                        ? 'Альтернативные рыночные предложения отсутствуют. Скидка рассчитана только внутри одной компании, реальная рыночная экономия = 0 ₽.'
                        : 'Alternatif firma teklifi sunulmamıştır. Sadece firma içi indirim hesaplanmış olup, gerçek piyasa tasarrufu 0 ₽ kabul edilir.'}
                    </p>
                  </div>
                </div>
              )}

              {analysis.isAboveBestOffer && (
                <div className="p-3.5 bg-rose-50 border border-rose-300 text-rose-900 rounded-xl text-xs flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-bold">{isRu ? 'Осторожно: Закупка выше лучшего рыночного предложения' : 'Dikkat: Piyasa En İyi Teklifinin Üzerinde Satınalma'}</span>
                    <p className="mt-0.5 text-rose-800">
                      {isRu
                        ? 'Окончательная цена сделки превышает минимальное первоначальное предложение конкурентов.'
                        : 'Nihai satınalma tutarı, pazardaki en ucuz ilk teklifin üzerindedir. Neden bu firmanın tercih edildiği gerekçelendirilmelidir.'}
                    </p>
                  </div>
                </div>
              )}

              {/* KPI Summary Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Primary KPI: Real Market Savings */}
                <div className="bg-emerald-50/80 border-2 border-emerald-500/40 rounded-xl p-4 relative overflow-hidden">
                  <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                    {isRu ? 'Истинная экономия (Рынок)' : 'Gerçek Piyasa İndirimi'}
                  </div>
                  <div className="text-2xl font-black text-emerald-700 mt-1">
                    {formatCurrency(analysis.realMarketSavings)}
                  </div>
                  <div className="text-xs text-emerald-800 font-semibold mt-0.5 flex items-center space-x-1">
                    <TrendingDown className="w-3.5 h-3.5" />
                    <span>%{analysis.realSavingsRate} {isRu ? 'от рыночной базы' : 'piyasa tasarruf oranı'}</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 mt-1 block">
                    {isRu ? 'Основной показатель эффективности' : '⭐ Ana Performans Esası'}
                  </span>
                </div>

                {/* 2. Secondary Info: Internal Vendor Discount */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 relative">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {isRu ? 'Скидка внутри компании' : 'Firma İçi İndirim'}
                  </div>
                  <div className="text-xl font-bold text-slate-800 mt-1">
                    {formatCurrency(analysis.internalVendorSavings)}
                  </div>
                  <div className="text-xs text-slate-600 font-medium mt-0.5">
                    %{analysis.internalVendorRate} {isRu ? 'от цены победителя' : 'firma içi iskonto'}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    {isRu ? 'Только для информации' : 'ℹ️ Bilgi Amaçlı'}
                  </span>
                </div>

                {/* 3. Market Baseline */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {isRu ? 'Минимальная база рынка' : 'Piyasa Referans Tutarı'}
                  </div>
                  <div className="text-xl font-bold text-slate-800 mt-1">
                    {formatCurrency(analysis.totalInitialLowestOffer)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {isRu ? 'Сумма лучших первых цен' : 'En Düşük İlk Teklifler'}
                  </div>
                </div>

                {/* 4. Final Purchase Amount */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {isRu ? 'Итоговая сумма закупки' : 'Nihai Satınalma Tutarı'}
                  </div>
                  <div className="text-xl font-bold text-indigo-900 mt-1">
                    {formatCurrency(analysis.totalFinalPurchase)}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {isRu ? 'Окончательный счет' : 'Anlaşılan Fatura Tutarı'}
                  </div>
                </div>
              </div>

              {/* Section: Initial Offers vs Negotiation Rounds Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* 1. Initial Offers Pool (Market Baseline Identification) */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 font-bold text-xs">
                        1
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">
                        {isRu ? 'Пул начальных предложений (База рынка)' : 'İlk Teklifler Havuzu (Piyasa Referansı)'}
                      </h4>
                    </div>
                    <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-semibold">
                      {analysis.initialOffersComparison?.length || 0} {isRu ? 'предл.' : 'Teklif'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {analysis.initialOffersComparison && analysis.initialOffersComparison.length > 0 ? (
                      analysis.initialOffersComparison.map((offer, idx) => (
                        <div
                          key={offer.documentId || `init_${idx}`}
                          className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                            offer.isLowest
                              ? 'bg-emerald-50/70 border-emerald-300 text-emerald-900 shadow-xs ring-1 ring-emerald-400/40'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              offer.isLowest ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {idx + 1}
                            </span>
                            <div className="truncate">
                              <span className="font-semibold block truncate">{offer.supplier}</span>
                              <span className="text-[10px] text-slate-500 truncate block">{offer.fileName}</span>
                            </div>
                          </div>

                          <div className="text-right shrink-0 ml-2">
                            <span className={`font-mono font-bold block ${offer.isLowest ? 'text-emerald-700 font-extrabold' : 'text-slate-800'}`}>
                              {formatCurrency(offer.amount)}
                            </span>
                            {offer.isLowest ? (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                ★ {isRu ? 'Мин. цена (База)' : 'En Düşük (Baz Alındı)'}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">
                                +{formatCurrency(offer.amount - (analysis.lowestInitialOfferAmount || analysis.totalInitialLowestOffer))}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-xs text-slate-400">
                        {isRu ? 'Начальные предложения не найдены' : 'İlk teklif verisi bulunamadı'}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Negotiation Rounds and Final Invoice Flow */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 font-bold text-xs">
                        2
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">
                        {isRu ? 'Раунды переговоров и окончательный счет' : 'Pazarlık Turları ve Son Anlaşılan Fatura'}
                      </h4>
                    </div>
                    <span className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-md font-bold">
                      {analysis.negotiationRoundsCount || 0} {isRu ? 'раундов' : 'Tur Pazarlık'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {/* Intermediate Negotiation Rounds */}
                    {analysis.negotiationStages && analysis.negotiationStages.length > 0 ? (
                      analysis.negotiationStages.map((stg) => (
                        <div
                          key={stg.roundNumber}
                          className="p-2.5 rounded-lg border border-amber-200 bg-amber-50/40 text-xs flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] font-bold">
                              R{stg.roundNumber}
                            </span>
                            <div className="truncate">
                              <span className="font-semibold text-amber-900 block truncate">
                                {stg.roundNumber}. {isRu ? 'Раунд переговоров' : 'Ara Pazarlık Turu'}: {stg.supplier}
                              </span>
                              <span className="text-[10px] text-amber-700 truncate block">{stg.fileName}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <span className="font-mono font-bold text-amber-900 block">
                              {formatCurrency(stg.amount)}
                            </span>
                            <span className="text-[10px] text-amber-700">
                              {stg.date || '-'}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-2 rounded-lg border border-slate-100 bg-slate-50/60 text-xs text-slate-500 text-center">
                        {isRu ? 'Прямой раунд согласования (без промежуточных туров)' : 'Doğrudan Anlaşma (Ara tur belgesi eklenmedi)'}
                      </div>
                    )}

                    {/* Final Invoice Milestone */}
                    <div className="p-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-50/80 text-xs flex items-center justify-between shadow-xs">
                      <div className="flex items-center space-x-2.5 truncate">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div className="truncate">
                          <span className="font-bold text-emerald-950 block truncate">
                            {isRu ? 'Окончательный счет (Только он идет в форму):' : 'Nihai Anlaşılan Fatura (Forma Aktarılacak):'}
                          </span>
                          <span className="text-[11px] text-emerald-800 font-semibold block truncate">
                            {analysis.winningSupplier} {analysis.finalInvoice?.documentNumber ? `• Fatura No: ${analysis.finalInvoice.documentNumber}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="font-mono font-black text-emerald-800 text-sm block">
                          {formatCurrency(analysis.totalFinalPurchase)}
                        </span>
                        <span className="text-[10px] text-emerald-700 font-semibold">
                          {analysis.finalInvoice?.date || analysis.date}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Canonical Material Comparison Table */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      {isRu ? 'Сопоставленные позиции и нормализация единиц' : 'Kanonik Malzeme Eşleştirmesi ve Birim Fiyat Analizi'}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {isRu
                        ? 'Расчет базируется на количестве и номенклатуре согласованного счета (итоговой закупки).'
                        : 'Analiz ve kalem listesi, anlaşılan teklif/faturadaki kalem sayısı ve miktarlar/tonajlar baz alınarak oluşturulmuştur.'}
                    </p>
                  </div>
                  <span className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold self-start sm:self-auto">
                    {analysis.canonicalMaterials?.length || 0} {isRu ? 'согласованных позиций' : 'anlaşılan kalem'}
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
                        <th className="py-2.5 px-3 font-semibold">{isRu ? 'Материал (Спецификация)' : 'Malzeme Tanımı & Teknik Özellik'}</th>
                        <th className="py-2.5 px-3 font-semibold text-center">{isRu ? 'Ед. изм.' : 'Birim'}</th>
                        <th className="py-2.5 px-3 font-semibold text-right">{isRu ? 'Кол-во (Согласовано)' : 'Miktar (Anlaşılan)'}</th>
                        <th className="py-2.5 px-3 font-semibold text-right">{isRu ? 'База рынка (Мин.)' : 'Piyasa Baz Birim Fiyatı'}</th>
                        <th className="py-2.5 px-3 font-semibold text-right">{isRu ? 'Итоговая цена' : 'Anlaşılan Birim Fiyat'}</th>
                        <th className="py-2.5 px-3 font-semibold text-right">{isRu ? 'Реальная экономия' : 'Gerçek Tasarruf'}</th>
                        <th className="py-2.5 px-3 font-semibold text-center">{isRu ? 'Надежность' : 'Eşleşme'}</th>
                        <th className="py-2.5 px-3 font-semibold text-center">{isRu ? 'Исключить' : 'Hariç Tut'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {analysis.canonicalMaterials?.map((mat: any, idx: number) => {
                        const isExcluded = mat.isExcluded;
                        const name = mat.canonicalName || mat.commonName || (isRu ? `Позиция закупки #${idx + 1}` : `Alınan Malzeme / Hizmet Kapsamı #${idx + 1}`);
                        const unit = mat.standardUnit || 'adet';
                        const qty = Number(mat.purchasedQuantity || mat.quantity || 1);
                        const refPrice = Number(mat.marketReferenceUnitPrice || 0);
                        const refSupplier = mat.marketReferenceSupplier || (isRu ? 'Минимальная база' : 'Piyasa En Düşük Teklif');
                        const finalPrice = Number(mat.purchasedUnitPrice || 0);
                        const finalSupplier = mat.purchasedSupplier || analysis.winningSupplier || (isRu ? 'Победитель' : 'Seçilen Tedarikçi');
                        const isSingle = mat.isSingleVendor || (analysis.uniqueSuppliersCount || 0) <= 1;
                        const savings = isSingle ? 0 : Number(mat.realTotalSavings ?? ((refPrice > 0) ? (refPrice - finalPrice) * qty : 0));
                        const rate = (!isSingle && refPrice > 0) ? Number((((refPrice - finalPrice) / refPrice) * 100).toFixed(2)) : 0;
                        const confidence = typeof mat.matchConfidence === 'number'
                          ? `${Math.round(mat.matchConfidence * 100)}%`
                          : (mat.matchConfidence || 'HIGH');

                        return (
                          <tr key={mat.id || `mat_${idx}`} className={`transition-colors ${isExcluded ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-slate-50'}`}>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-800">{name}</div>
                              {mat.technicalSpecs && (
                                <div className="text-[10px] text-slate-500 flex flex-wrap gap-1 mt-0.5">
                                  {mat.technicalSpecs.grade && <span className="bg-slate-200/80 px-1.5 rounded">{mat.technicalSpecs.grade}</span>}
                                  {mat.technicalSpecs.diameterMm && <span className="bg-slate-200/80 px-1.5 rounded">Ø {mat.technicalSpecs.diameterMm}mm</span>}
                                  {mat.technicalSpecs.thicknessMm && <span className="bg-slate-200/80 px-1.5 rounded">t={mat.technicalSpecs.thicknessMm}mm</span>}
                                </div>
                              )}
                              {isExcluded && mat.exclusionReason && (
                                <div className="text-[10px] text-amber-700 italic mt-0.5">
                                  {isRu ? 'Причина:' : 'Gerekçe:'} {mat.exclusionReason}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                              {unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                              {qty > 0 ? qty.toLocaleString('tr-TR') : '1'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="font-mono font-semibold text-slate-800">
                                {formatCurrency(refPrice)}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate max-w-[120px] ml-auto" title={refSupplier}>
                                {refSupplier}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="font-mono font-bold text-indigo-900">
                                {formatCurrency(finalPrice)}
                              </div>
                              <div className="text-[10px] text-indigo-700 truncate max-w-[120px] ml-auto font-medium" title={finalSupplier}>
                                {finalSupplier}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className={`font-mono font-bold ${savings >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                                {formatCurrency(savings)}
                              </div>
                              <div className="text-[10px] text-slate-500 font-semibold">
                                %{rate}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                confidence === 'HIGH' || confidence.startsWith('9') || confidence.startsWith('10')
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {confidence}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                onClick={() => handleToggleExclusion(mat.id)}
                                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                                  isExcluded 
                                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' 
                                    : 'bg-slate-100 text-slate-600 hover:bg-rose-100 hover:text-rose-700'
                                }`}
                              >
                                {isExcluded ? (isRu ? 'Включить' : 'Dahil Et') : (isRu ? 'Исключить' : 'Hariç Tut')}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Validation Warning Alert if conditions not met */}
              {validationErrors.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start space-x-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <span className="font-bold">
                      {isRu ? 'Для сохранения скидки и счета необходимо устранить следующие замечания:' : 'Onaylı indirim ve fatura kaydı için aşağıdaki eksik belgeleri/bilgileri tamamlayın:'}
                    </span>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px] text-amber-800">
                      {validationErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Action Buttons: Save & Confirm */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <div className="text-xs text-slate-500">
                  {saveSuccess ? (
                    <span className="text-emerald-600 font-bold flex items-center space-x-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isRu ? 'Успешно сохранено и связано с системой!' : 'Başarıyla kaydedildi ve performans raporuna işlendi!'}</span>
                    </span>
                  ) : validationErrors.length > 0 ? (
                    <span className="text-amber-700 font-medium">
                      {isRu ? 'Завершение заблокировано: отсутствуют обязательные данные.' : 'Kaydetme devre dışı: Eksik belgeler veya bilgiler mevcut.'}
                    </span>
                  ) : (
                    <span>{isRu ? 'Все вычисления проверены' : 'Tüm hesaplamalar ve birim normalizasyonları onaylanmaya hazır.'}</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-[11px] text-slate-500 font-medium hidden md:inline-flex items-center space-x-1 mr-2 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{isRu ? 'Окончательный счет, скидка и материалы будут сохранены' : 'Son anlaşılan fatura, indirim ve malzemeler senkronize kaydedilir'}</span>
                  </span>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition-colors"
                  >
                    {isRu ? 'Закрыть' : 'İptal'}
                  </button>
                  {onApplyToForm && (
                    <button
                      onClick={handleApplyToForm}
                      className="inline-flex items-center space-x-1.5 px-4 py-2.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                      title="Son anlaşılan fatura bilgilerini, malzemeleri ve ilk teklif referansını ana indirim formuna aktar"
                    >
                      <Layers className="w-3.5 h-3.5 text-indigo-600" />
                      <span>{isRu ? 'Перенести в форму скидок' : 'Verileri İndirim Giriş Formuna Aktar'}</span>
                    </button>
                  )}
                  <button
                    onClick={handleSaveAnalysis}
                    disabled={isSaving || saveSuccess || validationErrors.length > 0}
                    className={`inline-flex items-center space-x-2 px-5 py-2.5 text-white rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer ${
                      validationErrors.length > 0
                        ? 'bg-slate-300 opacity-60 cursor-not-allowed text-slate-600'
                        : 'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50'
                    }`}
                    title={
                      validationErrors.length > 0
                        ? validationErrors.join(' | ')
                        : "Nihai anlaşılan faturayı baz alarak indirimi kaydeder, faturayı AI Fatura Okuma'ya ve malzemeleri akıllı kategorisiyle Malzeme Fiyat Kıyaslama'ya kaydeder."
                    }
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{isRu ? 'Сохранение...' : 'Kaydediliyor...'}</span>
                      </>
                    ) : saveSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-white" />
                        <span>{isRu ? 'Успешно сохранено!' : 'Başarıyla Kaydedildi!'}</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>{isRu ? 'Завершить анализ и сохранить скидку' : 'Analizi Bitir ve İndirimi Kaydet'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};
