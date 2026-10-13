import { optimizeFileBeforeUpload, OptimizationBadge } from '../utils/fileOptimizer';
import React, { useState } from 'react';
import { PurchasingSupervisor, Jobsite, DiscountRecord, Personnel, NegotiationRound, StageDocument } from '../types';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import { normalizeVendorName } from '../utils/vendorNormalizer';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { checkRecordPermission } from '../utils/permissions';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { NEGOTIATION_THRESHOLD, validateProcedure52 } from '../utils/procedureConfig';
import {
  Edit3,
  CheckCircle2,
  Building2,
  UserCheck,
  Calendar,
  FileText,
  Trash2,
  X,
  AlertTriangle,
  Coins,
  Lock,
  Users,
  Plus,
  ShieldAlert,
  HelpCircle,
  Zap,
  Upload,
  ArrowDown,
  ArrowRight,
  Eye,
  TrendingDown,
  Wand2,
  RotateCcw,
  Award,
  CheckCircle,
  FileCheck,
  HardDrive,
  Sparkles
} from 'lucide-react';

interface Props {
  record: DiscountRecord;
  supervisors: PurchasingSupervisor[];
  jobsites: Jobsite[];
  personnel?: Personnel[];
  onSave: (id: string, updatedFields: Partial<DiscountRecord>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  onClose: () => void;
}

export const EditDiscountModal: React.FC<Props> = ({
  record,
  supervisors,
  jobsites,
  personnel = [],
  onSave,
  onDelete,
  onClose
}) => {
  useModalBackHandler(true, onClose);

  const { t, language } = useLanguage();
  const { user } = useAuth();
  const perm = checkRecordPermission(user, record.supervisorId, record.supervisorName);

  const [supervisorId, setSupervisorId] = useState<string>(record.supervisorId);
  const [performedByPersonnelId, setPerformedByPersonnelId] = useState<string>(record.performedByPersonnelId || '');
  const [jobsiteId, setJobsiteId] = useState<string>(record.jobsiteId);
  const [vendorName, setVendorName] = useState<string>(record.vendorName);
  const [category, setCategory] = useState<string>(record.category || 'Hazır Beton & Çimento');
  const [offerPrice, setOfferPrice] = useState<string>(record.offerPrice.toString());
  const [scopeDeductionAmount, setScopeDeductionAmount] = useState<string>(
    record.scopeDeductionAmount ? record.scopeDeductionAmount.toString() : ''
  );
  const [scopeDeductionReason, setScopeDeductionReason] = useState<string>(
    record.scopeDeductionReason || ''
  );
  const [agreedPrice, setAgreedPrice] = useState<string>(record.agreedPrice.toString());
  const [orderDate, setOrderDate] = useState<string>(record.orderDate || new Date().toISOString().split('T')[0]);
  const [invoiceNo, setInvoiceNo] = useState<string>(record.invoiceNo || '');
  const [notes, setNotes] = useState<string>(record.notes || '');

  // Negotiation & Procedure state
  const [negotiationRounds, setNegotiationRounds] = useState<NegotiationRound[]>(() => {
    if (Array.isArray(record.negotiationRounds) && record.negotiationRounds.length > 0) {
      return record.negotiationRounds;
    }
    const stages = Array.isArray(record.stageDocuments) ? record.stageDocuments : [];
    if (stages.length > 2) {
      const intermediate = stages.filter((s: any) => {
        const isFirst = s.stageNumber === 1 || String(s.title || '').includes('1. İlk');
        const isFinal = s.isFinal || String(s.title || '').includes('Nihai') || String(s.title || '').includes('Son Tur Sonrası');
        return !isFirst && !isFinal;
      });
      return intermediate.map((stg: any, idx: number) => ({
        id: `rnd_ext_${record.id}_${idx + 1}`,
        roundNumber: idx + 1,
        date: record.orderDate || new Date().toISOString().split('T')[0],
        vendorName: record.vendorName || 'Tedarikçi Firma',
        quotedPrice: Number(stg.amount) || 0,
        previousPrice: Number(record.offerPrice) || 0,
        discountThisRound: Math.max(0, (Number(record.offerPrice) || 0) - (Number(stg.amount) || 0)),
        documentName: stg.fileName,
        documentUrl: stg.fileUrl,
        note: stg.title || `${idx + 1}. Ara Pazarlık Turu`
      }));
    }
    return [];
  });
  const [crossNegotiationApplied, setCrossNegotiationApplied] = useState<boolean>(
    record.crossNegotiationApplied || false
  );
  const [finalNegotiationDate, setFinalNegotiationDate] = useState<string>(
    record.finalNegotiationDate || record.orderDate || new Date().toISOString().split('T')[0]
  );

  // Document states
  const [firstOfferFileName, setFirstOfferFileName] = useState<string>(record.firstOfferFileName || '');
  const [firstOfferFileUrl, setFirstOfferFileUrl] = useState<string>(record.firstOfferFileUrl || '');
  const [finalOfferFileName, setFinalOfferFileName] = useState<string>(record.finalOfferFileName || '');
  const [finalOfferFileUrl, setFinalOfferFileUrl] = useState<string>(record.finalOfferFileUrl || '');
  const [stageDocuments, setStageDocuments] = useState<StageDocument[]>(record.stageDocuments || []);
  const [isUploadingDoc, setIsUploadingDoc] = useState<boolean>(false);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto Calculations with Scope Deduction Support
  const numOffer = Number(offerPrice) || 0;
  const numScopeDeduction = Number(scopeDeductionAmount) || 0;
  const numAdjustedOffer = Math.max(0, numOffer - numScopeDeduction);
  const effectiveBaseline = numScopeDeduction > 0 ? numAdjustedOffer : numOffer;
  const numAgreed = Number(agreedPrice) || 0;
  const discountAmount = Math.max(0, effectiveBaseline - numAgreed);
  const discountPercentage = effectiveBaseline > 0 ? Number(((discountAmount / effectiveBaseline) * 100).toFixed(2)) : 0;

  // Filter personnel attached to selected supervisor
  const availablePersonnel = personnel.filter(p => p.supervisorId === supervisorId && p.active !== false);

  // 5.2 Procedure Validation check
  const isHighValue = numOffer >= NEGOTIATION_THRESHOLD || numAgreed >= NEGOTIATION_THRESHOLD;
  const validationResult = isHighValue
    ? validateProcedure52({
        offerPrice: numOffer,
        agreedPrice: numAgreed,
        negotiationRounds,
        crossNegotiationApplied,
        vendorName
      })
    : { isValid: true, warnings: [] };

  const handleUploadStageDocument = async (stageType: 'first' | 'round' | 'final', roundIndex?: number, file?: File) => {
    if (!file) return;
    try {
      setIsUploadingDoc(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        try {
          const response = await fetch('/api/upload-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, fileData: base64Data })
          });
          const data = await response.json();
          if (!data.success || (!data.fileUrl && !data.url)) {
            throw new Error(data.error || 'Sunucu dosya yükleme yanıtı başarısız.');
          }
          const url = data.fileUrl || data.url;

          if (stageType === 'first') {
            setFirstOfferFileName(file.name);
            setFirstOfferFileUrl(url);
          } else if (stageType === 'round' && roundIndex !== undefined) {
            setNegotiationRounds(prev => {
              const next = [...prev];
              if (next[roundIndex]) {
                next[roundIndex] = {
                  ...next[roundIndex],
                  documentName: file.name,
                  documentUrl: url
                };
              }
              return next;
            });
          } else if (stageType === 'final') {
            setFinalOfferFileName(file.name);
            setFinalOfferFileUrl(url);
          }
        } catch (uploadErr: any) {
          console.error('Upload failed:', uploadErr);
          alert(`KRİTİK HATA: Belge sunucuya yüklenemedi: ${uploadErr.message || 'Bilinmeyen hata'}. Belge kayda eklenmedi. Taban veritabanına base64 yazımı kesinlikle engellendi.`);
        } finally {
          setIsUploadingDoc(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('File read error:', err);
      setIsUploadingDoc(false);
    }
  };

  const handleAutoDistributeRounds = (count: 2 | 3) => {
    if (effectiveBaseline <= 0 || numAgreed <= 0 || effectiveBaseline <= numAgreed) return;
    const totalDiff = effectiveBaseline - numAgreed;

    if (count === 2) {
      const disc1 = Math.round(totalDiff * 0.55);
      const quote1 = Math.max(0, effectiveBaseline - disc1);
      const disc2 = Math.max(0, quote1 - numAgreed);

      const r1: NegotiationRound = {
        id: `rnd_edit_1_${Date.now()}`,
        roundNumber: 1,
        date: orderDate || new Date().toISOString().split('T')[0],
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: effectiveBaseline,
        quotedPrice: quote1,
        discountThisRound: disc1,
        note: '1. Tur pazarlık revizyonu'
      };
      const r2: NegotiationRound = {
        id: `rnd_edit_2_${Date.now()}`,
        roundNumber: 2,
        date: orderDate || new Date().toISOString().split('T')[0],
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: quote1,
        quotedPrice: numAgreed,
        discountThisRound: disc2,
        note: '2. Tur nihai mutabakat'
      };
      setNegotiationRounds([r1, r2]);
    } else if (count === 3) {
      const disc1 = Math.round(totalDiff * 0.40);
      const quote1 = Math.max(0, effectiveBaseline - disc1);
      const disc2 = Math.round(totalDiff * 0.35);
      const quote2 = Math.max(0, quote1 - disc2);
      const disc3 = Math.max(0, quote2 - numAgreed);

      const r1: NegotiationRound = {
        id: `rnd_edit_1_${Date.now()}`,
        roundNumber: 1,
        date: orderDate || new Date().toISOString().split('T')[0],
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: effectiveBaseline,
        quotedPrice: quote1,
        discountThisRound: disc1,
        note: '1. Tur teklif revizyonu'
      };
      const r2: NegotiationRound = {
        id: `rnd_edit_2_${Date.now()}`,
        roundNumber: 2,
        date: orderDate || new Date().toISOString().split('T')[0],
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: quote1,
        quotedPrice: quote2,
        discountThisRound: disc2,
        note: '2. Tur alternatif tedarikçi kıyaslaması'
      };
      const r3: NegotiationRound = {
        id: `rnd_edit_3_${Date.now()}`,
        roundNumber: 3,
        date: orderDate || new Date().toISOString().split('T')[0],
        vendorName: vendorName || 'Tedarikçi Firma',
        previousPrice: quote2,
        quotedPrice: numAgreed,
        discountThisRound: disc3,
        note: '3. Tur nihai peşin ödeme mutabakatı'
      };
      setNegotiationRounds([r1, r2, r3]);
    }
  };

  const handleAddRound = () => {
    const roundNumber = negotiationRounds.length + 1;
    let prevPrice = numOffer;
    if (roundNumber === 1) {
      prevPrice = numAgreed > 0 ? numAgreed : (effectiveBaseline > 0 ? effectiveBaseline : numOffer);
    } else {
      const prevRound = negotiationRounds[negotiationRounds.length - 1];
      prevPrice = (prevRound?.quotedPrice && prevRound.quotedPrice > 0) ? prevRound.quotedPrice : numOffer;
    }

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
      note: `${roundNumber}. Tur pazarlık görüşmesi`
    };

    const nextRounds = [...negotiationRounds, newRound];
    setNegotiationRounds(nextRounds);
  };

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

    for (let i = index + 1; i < updated.length; i++) {
      const prevRnd = updated[i - 1];
      const cur = { ...updated[i] };
      cur.previousPrice = prevRnd.quotedPrice;
      const curQ = Number(cur.quotedPrice) || 0;
      cur.discountThisRound = Math.max(0, cur.previousPrice - curQ);
      updated[i] = cur;
    }

    setNegotiationRounds(updated);

    const lastRnd = updated[updated.length - 1];
    if (lastRnd && lastRnd.quotedPrice > 0) {
      setAgreedPrice(String(lastRnd.quotedPrice));
    }
  };

  const handleRemoveRound = (index: number) => {
    const updated = negotiationRounds.filter((_, i) => i !== index).map((r, i) => ({
      ...r,
      roundNumber: i + 1
    }));
    setNegotiationRounds(updated);
    if (updated.length > 0) {
      const lastRnd = updated[updated.length - 1];
      if (lastRnd.quotedPrice > 0) {
        setAgreedPrice(String(lastRnd.quotedPrice));
      }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!perm.canEdit) {
      setErrorMsg('Salt Okunur: Bu kaydı düzenleme yetkiniz yok.');
      return;
    }
    if (!supervisorId) {
      setErrorMsg(language === 'RU' ? 'Выберите шефа по закупкам.' : 'Lütfen Satınalma Şefini seçin.');
      return;
    }
    if (!jobsiteId) {
      setErrorMsg(language === 'RU' ? 'Выберите объект.' : 'Lütfen Şantiyeyi seçin.');
      return;
    }
    if (!vendorName.trim()) {
      setErrorMsg(language === 'RU' ? 'Введите название поставщика.' : 'Lütfen Tedarikçi adını girin.');
      return;
    }
    if (numOffer <= 0 || numAgreed <= 0) {
      setErrorMsg(language === 'RU' ? 'Введите корректные суммы.' : 'Geçerli fiyatlar giriniz.');
      return;
    }
    if (numAgreed > effectiveBaseline) {
      setErrorMsg(language === 'RU' ? 'Согласованная цена не может превышать скорректированную сумму предложения.' : 'Anlaşılan fiyat, kapsam düşümü sonrası düzeltilmiş teklif fiyatından büyük olamaz.');
      return;
    }

    try {
      setIsSaving(true);
      const selectedSup = supervisors.find(s => s.id === supervisorId);
      const selectedJob = jobsites.find(j => j.id === jobsiteId);
      const matchedPers = personnel.find(p => p.id === performedByPersonnelId);

      const lastRnd = negotiationRounds.length > 0 ? negotiationRounds[negotiationRounds.length - 1] : null;
      const lastRndPrice = lastRnd && Number(lastRnd.quotedPrice) > 0 ? Number(lastRnd.quotedPrice) : 0;
      let finalAgreed = numAgreed;
      const discAmt = Math.max(0, effectiveBaseline - finalAgreed);
      const discPct = effectiveBaseline > 0 ? Number(((discAmt / effectiveBaseline) * 100).toFixed(2)) : 0;

      const basePrice = numAdjustedOffer > 0 ? numAdjustedOffer : numOffer;
      const validRounds = negotiationRounds.filter(r => {
        const qp = Number(r.quotedPrice) || 0;
        const hasDoc = Boolean(r.documentName || r.documentUrl || (r as any).documentFileName || (r as any).fileName);
        return hasDoc && (qp > 0 ? qp <= basePrice : true);
      });

      await onSave(record.id, {
        supervisorId,
        supervisorName: selectedSup ? selectedSup.name : record.supervisorName,
        performedByPersonnelId: performedByPersonnelId || undefined,
        performedByPersonnelName: matchedPers?.name || undefined,
        jobsiteId,
        jobsiteName: selectedJob ? selectedJob.name : record.jobsiteName,
        vendorName: normalizeVendorName(vendorName.trim()),
        category,
        offerPrice: numOffer,
        scopeDeductionAmount: numScopeDeduction > 0 ? numScopeDeduction : 0,
        scopeDeductionReason: numScopeDeduction > 0 ? scopeDeductionReason.trim() : undefined,
        adjustedOfferPrice: numScopeDeduction > 0 ? numAdjustedOffer : numOffer,
        agreedPrice: finalAgreed,
        discountAmount: discAmt,
        discountPercentage: discPct,
        negotiationCount: validRounds.length,
        orderDate,
        invoiceNo: invoiceNo.trim(),
        notes: notes.trim(),
        negotiationRounds: validRounds.length > 0 ? validRounds : undefined,
        firstOfferFileName: firstOfferFileName || record.firstOfferFileName,
        firstOfferFileUrl: firstOfferFileUrl || record.firstOfferFileUrl,
        firstOfferDriveFileId: record.firstOfferDriveFileId,
        finalOfferFileName: finalOfferFileName || record.finalOfferFileName,
        finalOfferFileUrl: finalOfferFileUrl || record.finalOfferFileUrl,
        finalOfferDriveFileId: record.finalOfferDriveFileId,
        stageDocuments: (() => {
          const docs: StageDocument[] = [];
          docs.push({
            stageNumber: 1,
            title: '1. İlk Teklif / Fatura',
            fileName: firstOfferFileName || record.firstOfferFileName,
            fileUrl: firstOfferFileUrl || record.firstOfferFileUrl,
            driveFileId: record.firstOfferDriveFileId,
            amount: numOffer
          });

          if (validRounds.length === 0) {
            docs.push({
              stageNumber: 2,
              title: '2. İndirimli Fatura / Teklif',
              fileName: finalOfferFileName || record.finalOfferFileName,
              fileUrl: finalOfferFileUrl || record.finalOfferFileUrl,
              driveFileId: record.finalOfferDriveFileId,
              amount: finalAgreed,
              isFinal: true
            });
          } else {
            validRounds.forEach((r, idx) => {
              const stageNo = idx + 2;
              docs.push({
                stageNumber: stageNo,
                title: `${stageNo}. Ara İndirimli Teklif (Tur #${idx + 1})`,
                fileName: r.documentName,
                fileUrl: r.documentUrl,
                amount: Number(r.quotedPrice) || 0,
                roundIndex: idx,
                isFinal: false
              });
            });

            docs.push({
              stageNumber: validRounds.length + 2,
              title: `${validRounds.length + 2}. Nihai İndirimli Fatura`,
              fileName: finalOfferFileName || record.finalOfferFileName,
              fileUrl: finalOfferFileUrl || record.finalOfferFileUrl,
              driveFileId: record.finalOfferDriveFileId,
              amount: finalAgreed,
              isFinal: true
            });
          }
          return docs;
        })(),
        crossNegotiationApplied: isHighValue ? (validRounds.length >= 2) : false,
        finalNegotiationDate: finalNegotiationDate || orderDate
      });

      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Hata oluştu');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    try {
      setIsDeleting(true);
      await onDelete(record.id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Silme hatası');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-6">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-100">{t('editRecordTitle')}</h3>
              <p className="text-xs text-slate-400">{t('editRecordSub')}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-left text-slate-800 max-h-[80vh] overflow-y-auto">
          {!perm.canEdit && (
            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs font-semibold flex items-center space-x-2">
              <Lock className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Salt Okunur: Bu kayıt başka bir şefe aittir. Bilgileri görüntüleyebilirsiniz ancak değişiklik yapamazsınız.</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Supervisor & Personnel (GOL/ASİST) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <span>{t('selectSupervisor')} *</span>
              </label>
              <select
                value={supervisorId}
                onChange={(e) => {
                  setSupervisorId(e.target.value);
                  setPerformedByPersonnelId('');
                }}
                className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-slate-900 font-bold text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.title})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span className="flex items-center space-x-1.5">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span>İşlemi Yapan Personel</span>
                </span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  performedByPersonnelId ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                }`}>
                  {performedByPersonnelId ? '🤝 ASİST' : '🎯 GOL'}
                </span>
              </label>
              <select
                value={performedByPersonnelId}
                onChange={(e) => setPerformedByPersonnelId(e.target.value)}
                className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-slate-900 font-bold text-xs sm:text-sm focus:ring-2 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="">🎯 Şefin Kendisi Yaptı (GOL)</option>
                {availablePersonnel.map(p => (
                  <option key={p.id} value={p.id}>🤝 {p.name} ({p.title || 'Personel'}) — ASİST</option>
                ))}
              </select>
            </div>
          </div>

          {/* Jobsite, Vendor & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center space-x-1.5">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span>{t('selectJobsite')} *</span>
              </label>
              <select
                value={jobsiteId}
                onChange={(e) => setJobsiteId(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-bold text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {jobsites.map(j => (
                  <option key={j.id} value={j.id}>{j.name}{j.location ? ` (${j.location})` : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                {t('supplier')} *
              </label>
              <input
                type="text"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                onBlur={() => {
                  if (vendorName.trim()) setVendorName(normalizeVendorName(vendorName));
                }}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-semibold text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                {t('selectCategory')}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white cursor-pointer"
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Offer & Agreed Price */}
          <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('listPrice')} (İlk Gelen Teklif Brüt) *
                </label>
                <input
                  type="number"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-slate-900 font-bold text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('agreedPrice')} (Son İndirimli Fatura Tutarı) *
                </label>
                <input
                  type="number"
                  value={agreedPrice}
                  onChange={(e) => setAgreedPrice(e.target.value)}
                  className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-emerald-700 font-extrabold text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Scope Deduction / Like-for-Like Box */}
            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-amber-900 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span>Kapsam Düşümü / Sepetten Çıkarılan Kalemler (Gerçek Net İndirim Koruması)</span>
                </div>
                {numScopeDeduction > 0 && (
                  <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
                    Düzeltilmiş Teklif: {formatRuble(numAdjustedOffer)}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-800 leading-relaxed">
                İlk teklifte yer alıp son faturada alımdan vazgeçilen (iptal edilen) malzeme varsa tutarını buraya girin. Böylece sepetten çıkan ürünler sahte indirim gibi görünmez.
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
                    placeholder="Örn: Çay/şeker kalemi son faturada sepetten çıkarıldı..."
                    value={scopeDeductionReason}
                    onChange={(e) => setScopeDeductionReason(e.target.value)}
                    className="w-full py-1.5 px-2.5 bg-white border border-amber-300 rounded-lg text-slate-800 text-xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Dynamic Calculated Savings Badge */}
          <div className="bg-gradient-to-r from-emerald-900 to-slate-900 text-white p-3.5 rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Coins className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-slate-200 block">{t('earnedDiscount')}</span>
                {numScopeDeduction > 0 && (
                  <span className="text-[10px] text-amber-300 font-medium">
                    (Baz: {formatRuble(numAdjustedOffer)} - Son: {formatRuble(numAgreed)})
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-lg font-black text-emerald-400 font-mono">
                +{formatRuble(discountAmount)}
              </span>
              <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                %{discountPercentage}
              </span>
            </div>
          </div>

          {/* Sequential Negotiation & Document Pipeline (Aşamalı Pazarlık & Belge Hattı) */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-700">
                  <Coins className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <span>Aşamalı Pazarlık & Belge Akışı</span>
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                      {negotiationRounds.length > 0 ? `${negotiationRounds.length} Ara Tur` : 'Doğrudan Anlaşma (0 Tur)'}
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Her ara tur için geçerli ara teklif/fatura belgesi yüklenmelidir; nihai fatura her zaman son aşamadır.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleAddRound}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center space-x-1 cursor-pointer shadow-2xs transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Ara Tur Ekle</span>
                </button>

                {negotiationRounds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNegotiationRounds([])}
                    className="px-2 py-1 bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-700 text-xs font-bold rounded-lg flex items-center space-x-1 cursor-pointer transition-all"
                    title="Tüm turları sıfırla"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Sıfırla</span>
                  </button>
                )}
              </div>
            </div>

            {/* Visual Flow Summary Bar */}
            <div className="bg-white p-3 rounded-xl border border-indigo-100 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center space-x-1">
                  <TrendingDown className="w-3.5 h-3.5 text-indigo-600" />
                  <span>İndirim Basamakları Sıralaması</span>
                </span>
                <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-mono">
                  Net Tasarruf: +{formatRuble(discountAmount)} (%{discountPercentage})
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* 1. Aşama: İlk İndirimsiz Hali */}
                <div className="p-2 bg-slate-100 rounded-lg border border-slate-200 shrink-0">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">1. İlk İndirimsiz Hali</div>
                  <div className="font-mono font-black text-slate-900">{formatRuble(effectiveBaseline)}</div>
                </div>

                {/* Aradaki Pazarlık Turları */}
                {negotiationRounds.map((rnd, idx) => (
                  <React.Fragment key={rnd.id || idx}>
                    <div className="text-slate-400 font-bold">➔</div>
                    <div className="p-2 bg-indigo-50/80 border border-indigo-200 rounded-lg shrink-0">
                      <div className="flex items-center justify-between text-[10px] text-indigo-900 font-bold">
                        <span>{idx + 2}. {idx + 1}. İndirimli Hali</span>
                        <span className="text-emerald-700 font-mono ml-1.5">-{formatRuble(rnd.discountThisRound || 0)}</span>
                      </div>
                      <div className="font-mono font-extrabold text-indigo-950">{formatRuble(rnd.quotedPrice || 0)}</div>
                    </div>
                  </React.Fragment>
                ))}

                {/* Son Aşama: Son Tur Sonrası Fatura */}
                <div className="text-slate-400 font-bold">➔</div>
                <div className="p-2 bg-emerald-50 border border-emerald-300 rounded-lg shrink-0">
                  <div className="text-[10px] text-emerald-800 font-extrabold uppercase flex items-center space-x-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>{negotiationRounds.length + 2}. Son Tur Sonrası Fatura</span>
                  </div>
                  <div className="font-mono font-black text-emerald-700">{formatRuble(numAgreed)}</div>
                </div>
              </div>
            </div>

            {/* Stepper Cards */}
            <div className="space-y-3">
              {/* STAGE 1: 1. İlk İndirimsiz Hali */}
              <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-white text-xs font-black flex items-center justify-center">
                      1
                    </span>
                    <span className="font-extrabold text-xs text-slate-800">
                      1. İlk İndirimsiz Hali (Gelen İlk Teklif)
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-500 font-medium">Başlangıç Tutarı:</span>
                    <span className="font-mono font-black text-slate-900 text-sm">
                      {formatRuble(effectiveBaseline)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-xs">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-600 font-medium">İlk Teklif Belgesi:</span>
                    {firstOfferFileName ? (
                      <span className="font-bold text-slate-800 truncate max-w-[200px]">
                        {firstOfferFileName}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Belge yüklenmedi</span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    {firstOfferFileName && (
                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(firstOfferFileUrl, firstOfferFileName)}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Görüntüle</span>
                      </button>
                    )}
                    <label className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-colors">
                      <Upload className="w-3 h-3" />
                      <span>{firstOfferFileName ? 'Değiştir' : 'Belge Yükle'}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf,.xlsx,.xls,.csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadStageDocument('first', undefined, f);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Downward Connector */}
              <div className="flex justify-center -my-1">
                <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 text-xs font-black shadow-2xs">
                  ↓
                </div>
              </div>

              {/* STAGES 2..N+1: Pazarlık Turları */}
              {negotiationRounds.map((rnd, idx) => {
                const roundPct = rnd.previousPrice && rnd.previousPrice > 0
                  ? Number((((rnd.discountThisRound || 0) / rnd.previousPrice) * 100).toFixed(1))
                  : 0;

                return (
                  <React.Fragment key={rnd.id || idx}>
                    <div className="p-3.5 bg-white rounded-xl border border-indigo-200 shadow-2xs space-y-2.5 relative">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center">
                            {idx + 2}
                          </span>
                          <span className="font-extrabold text-xs text-indigo-950">
                            {idx + 2}. {idx + 1}. İndirimli Hali (Tur #{rnd.roundNumber})
                          </span>
                          <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Kazanç: +{formatRuble(rnd.discountThisRound || 0)} (%{roundPct})
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          {/* Quick Presets */}
                          <div className="flex items-center space-x-1">
                            {[3, 5, 8, 10, 15].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => {
                                  const base = rnd.previousPrice || numOffer || 0;
                                  if (base <= 0) return;
                                  const disc = Math.round(base * (pct / 100));
                                  const newQuoted = Math.max(0, base - disc);
                                  handleUpdateRound(idx, 'quotedPrice', newQuoted);
                                }}
                                className="px-1.5 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-[10px] font-bold text-slate-700 rounded border border-slate-200 transition-colors"
                              >
                                -%{pct}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveRound(idx)}
                            className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer transition-colors"
                            title="Turu Sil"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tarih</label>
                          <input
                            type="date"
                            value={rnd.date}
                            onChange={(e) => handleUpdateRound(idx, 'date', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tur Öncesi (₺)</label>
                          <input
                            type="number"
                            value={rnd.previousPrice || ''}
                            onChange={(e) => handleUpdateRound(idx, 'previousPrice', Number(e.target.value))}
                            className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold text-slate-700"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-emerald-800 mb-0.5">Tur Sonrası Fiyat (₺)</label>
                          <input
                            type="number"
                            value={rnd.quotedPrice || ''}
                            onChange={(e) => handleUpdateRound(idx, 'quotedPrice', Number(e.target.value))}
                            className="w-full p-1.5 bg-emerald-50/60 border border-emerald-300 rounded text-xs font-mono font-black text-emerald-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Bu Tur İndirimi (₺)</label>
                          <input
                            type="number"
                            value={rnd.discountThisRound || ''}
                            onChange={(e) => handleUpdateRound(idx, 'discountThisRound', Number(e.target.value))}
                            className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold text-emerald-700"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Görüşülen Yetkili / Not</label>
                          <input
                            type="text"
                            placeholder="Not / Görüşme Detayı"
                            value={rnd.note || ''}
                            onChange={(e) => handleUpdateRound(idx, 'note', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Tur Belgesi</label>
                          <div className="flex items-center space-x-1">
                            {rnd.documentName && (
                              <button
                                type="button"
                                onClick={() => openOriginalFileViewer(rnd.documentUrl || '', rnd.documentName || '')}
                                className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold flex items-center space-x-0.5 shrink-0"
                                title="Görüntüle"
                              >
                                <Eye className="w-3 h-3" />
                              </button>
                            )}
                            <label className="w-full py-1 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded text-[10px] font-bold flex items-center justify-center space-x-1 cursor-pointer transition-colors truncate">
                              <Upload className="w-3 h-3 shrink-0" />
                              <span className="truncate">{rnd.documentName ? rnd.documentName : 'Belge Yükle'}</span>
                              <input
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUploadStageDocument('round', idx, f);
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Downward Connector */}
                    <div className="flex justify-center -my-1">
                      <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 text-xs font-black shadow-2xs">
                        ↓
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}

              {/* TERMINAL STAGE: Son Tur Sonrası Fatura */}
              <div className="p-3.5 bg-emerald-50/80 rounded-xl border-2 border-emerald-300 shadow-2xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-700 text-white text-xs font-black flex items-center justify-center">
                      {negotiationRounds.length + 2}
                    </span>
                    <div>
                      <span className="font-black text-xs text-emerald-950 flex items-center space-x-1">
                        <span>{negotiationRounds.length + 2}. Son Tur Sonrası Fatura</span>
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded border border-emerald-200">
                          {negotiationRounds.length + 1}. İndirimli Hali (Nihai Belge)
                        </span>
                      </span>
                      <p className="text-[10px] text-emerald-700">
                        Nihai anlaşılan tutar ve onaylı son fatura/sipariş belgesi
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-emerald-800 font-bold">Nihai Fiyat:</span>
                    <span className="font-mono font-black text-emerald-900 text-base">
                      {formatRuble(numAgreed)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-emerald-200/80 text-xs">
                  <div className="flex items-center space-x-2">
                    <FileCheck className="w-4 h-4 text-emerald-700" />
                    <span className="text-emerald-900 font-medium">Son İndirimli Fatura:</span>
                    {finalOfferFileName ? (
                      <span className="font-bold text-emerald-950 truncate max-w-[200px]">
                        {finalOfferFileName}
                      </span>
                    ) : (
                      <span className="text-amber-800 italic bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                        Son fatura belgesi henüz seçilmedi
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    {finalOfferFileName && (
                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(finalOfferFileUrl, finalOfferFileName)}
                        className="px-2 py-1 bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Görüntüle</span>
                      </button>
                    )}
                    <label className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-colors shadow-2xs">
                      <Upload className="w-3 h-3" />
                      <span>{finalOfferFileName ? 'Faturayı Değiştir' : '+ Son Faturayı Yükle'}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf,.xlsx,.xls,.csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadStageDocument('final', undefined, f);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Çapraz Pazarlık Section (for >= 1.000.000) */}
          {isHighValue && (
            <div className="p-4 rounded-2xl border space-y-3 bg-indigo-50/70 border-indigo-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Çapraz Pazarlık & İkinci Görüşme (1.000.000 ₺+ İşlem)
                  </h4>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <label className="flex items-center space-x-2 text-xs font-bold text-slate-800 cursor-pointer bg-white p-2.5 rounded-xl border border-slate-200">
                  <input
                    type="checkbox"
                    checked={crossNegotiationApplied}
                    onChange={(e) => setCrossNegotiationApplied(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span>Çapraz Pazarlık Uygulandı</span>
                </label>

                <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                  <label className="block text-[10px] font-bold text-slate-600 mb-1">
                    Son Pazarlık Görüşmesi Tarihi
                  </label>
                  <input
                    type="date"
                    value={finalNegotiationDate}
                    onChange={(e) => setFinalNegotiationDate(e.target.value)}
                    className="w-full text-xs font-semibold p-1 bg-slate-50 border border-slate-200 rounded"
                  />
                </div>
              </div>

              {validationResult.warnings.length > 0 && (
                <div className="space-y-1 pt-1">
                  {validationResult.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-800 font-semibold flex items-center space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Date & Invoice No */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>{t('orderDateLabel')}</span>
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center space-x-1">
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>{t('invoiceNumber')}</span>
              </label>
              <input
                type="text"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              {t('optionalNotesLabel')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full py-2 px-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 text-xs sm:text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 gap-3">
            {onDelete && perm.canDelete && (
              <div>
                {showDeleteConfirm ? (
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-all"
                    >
                      {isDeleting ? 'Siliniyor...' : 'Evet, Sil'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      Vazgeç
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer transition-all border border-rose-200"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{t('deleteDiscountBtn')}</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center space-x-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                {t('cancelBtn')}
              </button>

              {perm.canEdit ? (
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSaving ? 'Kaydediliyor...' : t('updateDiscountBtn')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="px-5 py-2.5 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs sm:text-sm flex items-center space-x-1.5 cursor-not-allowed border border-slate-200"
                >
                  <Lock className="w-4 h-4 text-slate-400" />
                  <span>Salt Okunur</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
