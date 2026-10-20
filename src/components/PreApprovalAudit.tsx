import React, { useState, useRef } from 'react';
import { Jobsite, PurchasingSupervisor, InvoiceRecord } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import {
  auditEntireInvoice,
  InvoiceAuditSummary,
  LineAuditResult,
  HistoricalPricePoint
} from '../utils/preApprovalAuditEngine';
import {
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  RefreshCw,
  FileCheck,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  AlertCircle,
  Eye,
  ExternalLink,
  X,
  FileSpreadsheet,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
  Send
} from 'lucide-react';
import { formatRuble } from '../utils/format';

interface Props {
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  invoices: InvoiceRecord[];
  prizmaInvoices?: InvoiceRecord[];
  onInvoiceSaved: (invoice: Omit<InvoiceRecord, 'id' | 'createdAt'>) => Promise<any> | void;
}

export const PreApprovalAudit: React.FC<Props> = ({
  jobsites,
  supervisors,
  invoices,
  prizmaInvoices = [],
  onInvoiceSaved
}) => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const combinedHistoricalInvoices = React.useMemo(() => {
    const taggedPrizma = (prizmaInvoices || []).map(p => ({
      ...p,
      sourceCollection: 'prizma_invoices'
    }));
    return [...(invoices || []), ...taggedPrizma];
  }, [invoices, prizmaInvoices]);

  // Transient / In-Memory State
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    base64?: string;
    type?: string;
    isExcel?: boolean;
    excelCsv?: string;
  } | null>(null);

  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rawOcrData, setRawOcrData] = useState<any | null>(null);
  const [auditSummary, setAuditSummary] = useState<InvoiceAuditSummary | null>(null);

  // Expandable table rows
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  // Invoice Detailed View Modal
  const [viewingInvoiceModal, setViewingInvoiceModal] = useState<{
    invoice?: InvoiceRecord;
    historicalPoint?: HistoricalPricePoint;
  } | null>(null);

  // Transfer to permanent record modal
  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);
  const [transferJobsiteId, setTransferJobsiteId] = useState<string>(jobsites[0]?.id || '');
  const [transferSupervisorId, setTransferSupervisorId] = useState<string>(supervisors[0]?.id || '');

  // Action Modals & Flags
  const [showJustificationModal, setShowJustificationModal] = useState<boolean>(false);
  const [justificationText, setJustificationText] = useState<string>('');
  const [showNegotiationModal, setShowNegotiationModal] = useState<boolean>(false);
  const [showManagerModal, setShowManagerModal] = useState<boolean>(false);
  const [managerNote, setManagerNote] = useState<string>('');

  // Permanent Transfer State & Protection
  const [isTransferred, setIsTransferred] = useState<boolean>(false);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferSuccessMsg, setTransferSuccessMsg] = useState<string | null>(null);
  const [forceSaveDuplicate, setForceSaveDuplicate] = useState<boolean>(false);

  // Local Audit Trail for recent actions
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([]);

  // Demo Presets for 1-Click Fast Verification
  const PRESET_DEMO_INVOICES = [
    {
      id: 'russian_rebar',
      title: language === 'RU' ? 'Пример: Арматура А500С и Сухая смесь' : 'Örnek: Rusça Fatura (A500C Demir & M150 Harç)',
      desc: language === 'RU' ? 'Сравнение арматуры и раствора с прошлыми ценами' : 'Rusça kalemlerin geçmiş onaylı alımlarla otomatik eşleşmesi',
      data: {
        invoiceNumber: `FT-PRE-${Math.floor(100000 + Math.random() * 900000)}`,
        supplier: 'OOO Severstal Metiz',
        date: new Date().toISOString().split('T')[0],
        totalAmount: 1445600,
        currency: 'RUB',
        items: [
          {
            materialName: 'Арматура А500С 12мм (11.7м ГОСТ 34028)',
            originalName: 'Арматура А500С 12мм',
            category: 'İnşaat Demiri',
            unit: 'ton',
            quantity: 50,
            unitPrice: 24200,
            totalPrice: 1210000,
            currency: 'RUB',
            diameter: 'Ø12 mm',
            grade: 'A500C'
          },
          {
            materialName: 'Сухая смесь М150 (Цементно-песчаная 25кг)',
            originalName: 'Сухая смесь М150',
            category: 'Harç & Şap',
            unit: 'torba',
            quantity: 1200,
            unitPrice: 196,
            totalPrice: 235200,
            currency: 'RUB',
            grade: 'M150'
          }
        ]
      }
    },
    {
      id: 'high_priced_urgent',
      title: language === 'RU' ? 'Пример: Критическое завышение цены' : 'Örnek: Kritik Fiyat Artışı (%22 Yüksek)',
      desc: language === 'RU' ? 'Предупреждение о требовании скидки и согласовании' : 'Yönetici incelemesi ve indirim talep uyarısı tetikler',
      data: {
        invoiceNumber: `FT-RISK-${Math.floor(100000 + Math.random() * 900000)}`,
        supplier: 'OOO RusTrubSnab',
        date: new Date().toISOString().split('T')[0],
        totalAmount: 2850000,
        currency: 'RUB',
        items: [
          {
            materialName: 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)',
            originalName: 'Арматура А500С 16мм',
            category: 'İnşaat Demiri',
            unit: 'ton',
            quantity: 100,
            unitPrice: 28500,
            totalPrice: 2850000,
            currency: 'RUB',
            diameter: 'Ø16 mm',
            grade: 'A500C'
          }
        ]
      }
    }
  ];

  // Drag and Drop & File Picker Handler
  const handleFileSelected = (file: File) => {
    setErrorMsg(null);
    setTransferSuccessMsg(null);
    setIsTransferred(false);
    const lower = file.name.toLowerCase();
    const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv');

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setUploadedFile({
        name: file.name,
        base64,
        type: file.type || (isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'),
        isExcel
      });
      // Automatically trigger analysis
      triggerAnalysis({
        name: file.name,
        base64,
        type: file.type,
        isExcel
      });
    };
    reader.readAsDataURL(file);
  };

  // Perform Temporary OCR & AI Audit
  const triggerAnalysis = async (fileObj: typeof uploadedFile, presetDraft?: any) => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setTransferSuccessMsg(null);
    setIsTransferred(false);

    try {
      let draftToAudit: any = null;

      if (presetDraft) {
        draftToAudit = presetDraft;
        setRawOcrData(presetDraft);
      } else if (fileObj) {
        // Call read-only server-side AI OCR extraction
        const res = await fetch('/api/invoices/process-ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: fileObj.base64,
            mimeType: fileObj.type,
            fileName: fileObj.name
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Geçici OCR analizi başarısız oldu.');
        }

        const ext = data.extracted || {};
        draftToAudit = {
          invoiceNumber: ext.invoiceNumber || `FT-PRE-${Date.now().toString().slice(-6)}`,
          supplier: ext.supplier || ext.vendorName || 'Tedarikçi Firma',
          date: ext.date || new Date().toISOString().split('T')[0],
          totalAmount: Number(ext.totalAmount) || 0,
          currency: ext.currency || 'RUB',
          items: Array.isArray(ext.items) ? ext.items.map((it: any) => ({
            materialName: it.materialName || 'İnşaat Malzemesi',
            originalName: it.originalName || it.materialName || '',
            category: it.category || 'Genel Malzeme',
            unit: it.unit || 'adet',
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice) || 0,
            totalPrice: Number(it.totalPrice) || (Number(it.quantity) * Number(it.unitPrice)),
            unitPriceNet: Number(it.unitPriceNet) || undefined,
            vatPercentage: it.vatPercentage !== undefined ? Number(it.vatPercentage) : undefined,
            lineVerified: typeof it.lineVerified === 'boolean' ? it.lineVerified : undefined,
            currency: it.currency || ext.currency || 'RUB',
            diameter: it.diameter || '',
            grade: it.grade || '',
            dimensions: it.dimensions || ''
          })) : []
        };
        setRawOcrData(ext);
      }

      if (draftToAudit) {
        // Run deep audit against combined historical invoices (GES Archive + Prizma ERP)
        const summary = auditEntireInvoice(draftToAudit, combinedHistoricalInvoices);
        setAuditSummary(summary);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Denetim analizi sırasında hata oluştu.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Clear Audit State (Clean all transient memory)
  const handleClearAudit = async () => {
    if (auditSummary) {
      logAuditAction('PRE_AUDIT_CLEARED', {
        invoiceNumber: auditSummary.invoiceNumber,
        clearedBy: user?.displayName || 'Kullanıcı',
        reason: 'Kullanıcı denetimi temizledi'
      });
    }
    setUploadedFile(null);
    setAuditSummary(null);
    setRawOcrData(null);
    setErrorMsg(null);
    setTransferSuccessMsg(null);
    setIsTransferred(false);
    setJustificationText('');
    setManagerNote('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Log action to server /api/audit-logs
  const logAuditAction = async (action: string, payload: any) => {
    const entry = {
      action,
      performedBy: user?.displayName || 'Bilinmeyen Kullanıcı',
      userRole: user?.role || 'buyer',
      timestamp: new Date().toISOString(),
      ...payload
    };
    try {
      await fetch('/api/audit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      setRecentAuditLogs(prev => [entry, ...prev.slice(0, 9)]);
    } catch (e) {
      console.warn('[Audit Log Send Error]:', e);
    }
  };

  // Open the Invoice detail modal when clicking a historical match
  const handleOpenHistoricalInvoice = (match: HistoricalPricePoint) => {
    // Attempt to find full invoice in system invoices or Prizma ERP invoices
    const found = combinedHistoricalInvoices.find(inv => 
      (inv.id && inv.id === match.invoiceId) ||
      (inv.invoiceNumber && inv.invoiceNumber.toLowerCase() === match.invoiceNumber.toLowerCase()) ||
      (inv.invoiceNo && inv.invoiceNo.toLowerCase() === match.invoiceNumber.toLowerCase())
    );

    setViewingInvoiceModal({
      invoice: found,
      historicalPoint: match
    });
  };

  // Execute Transfer to Normal Permanent Invoice Record
  const handleConfirmTransfer = async () => {
    if (!auditSummary) return;
    if (isTransferred) {
      setErrorMsg('Bu denetim faturası zaten sisteme aktarılmış! Mükerrer aktarım engellendi.');
      return;
    }

    const allowedRoles = ['admin', 'supervisor', 'buyer'];
    if (user?.role && !allowedRoles.includes(user.role)) {
      setErrorMsg('Yetki Sınırı: Kalıcı fatura aktarımı yalnızca Satınalma Şefi veya Yönetici rolüyle yapılabilir.');
      return;
    }

    setIsTransferring(true);
    setErrorMsg(null);

    try {
      const jobsiteObj = jobsites.find(j => j.id === transferJobsiteId);
      const supervisorObj = supervisors.find(s => s.id === transferSupervisorId);

      let uploadedUrl: string | undefined = undefined;
      if (uploadedFile?.base64) {
        try {
          const upRes = await fetch('/api/upload-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: uploadedFile.name,
              fileData: uploadedFile.base64
            })
          });
          const upData = await upRes.json();
          if (upData.success && (upData.fileUrl || upData.url)) {
            uploadedUrl = upData.fileUrl || upData.url;
          }
        } catch (upErr) {
          console.warn('PreApprovalAudit file upload fallback to inline fileData:', upErr);
        }
      }

      const invoicePayload: any = {
        invoiceNumber: auditSummary.invoiceNumber || `FT-PRE-${Date.now().toString().slice(-6)}`,
        supplier: auditSummary.supplier || 'Tedarikçi Firma',
        date: auditSummary.date || new Date().toISOString().split('T')[0],
        totalAmount: auditSummary.totalAmount,
        currency: auditSummary.currency,
        jobsiteId: transferJobsiteId,
        jobsiteName: jobsiteObj?.name || 'Şantiye',
        uploadedBySupervisorId: transferSupervisorId,
        uploadedBySupervisorName: supervisorObj?.name || user?.displayName || 'Satınalma Şefi',
        supervisorId: transferSupervisorId,
        supervisorName: supervisorObj?.name || user?.displayName || 'Satınalma Şefi',
        fileUrl: uploadedUrl,
        fileData: !uploadedUrl && uploadedFile?.base64 ? uploadedFile.base64 : undefined,
        rawFileName: uploadedFile?.name,
        forceSave: forceSaveDuplicate,
        forceSaveDuplicate: forceSaveDuplicate,
        items: auditSummary.lineResults.map(l => ({
          materialName: l.draftItem.materialName,
          originalName: l.draftItem.originalName,
          category: l.processed.category,
          unit: l.draftItem.unit,
          quantity: l.draftItem.quantity,
          unitPrice: l.draftItem.unitPrice,
          totalPrice: l.draftItem.totalPrice,
          discountAmount: 0
        })),
        notes: justificationText
          ? `[Ön Onay Denetim Gerekçesi]: ${justificationText}`
          : `[Ön Onay Denetimi]: ${auditSummary.overallStatus} (${user?.displayName || 'Kullanıcı'})`
      };

      await onInvoiceSaved(invoicePayload);

      await logAuditAction('PRE_AUDIT_TRANSFERRED_TO_INVOICE', {
        invoiceNumber: invoicePayload.invoiceNumber,
        supplier: invoicePayload.supplier,
        totalAmount: invoicePayload.totalAmount,
        fileName: uploadedFile?.name || 'Manuel Denetim',
        decisionStatus: auditSummary.overallStatus,
        potentialSavings: auditSummary.totalPotentialSavings,
        lineCount: auditSummary.totalItemsCount,
        flaggedCount: auditSummary.flaggedItemsCount,
        justification: justificationText || undefined
      });

      setIsTransferred(true);
      setShowTransferModal(false);
      setForceSaveDuplicate(false);
      setTransferSuccessMsg(`✅ Fatura (${invoicePayload.invoiceNumber}) kalıcı fatura kayıtlarına başarıyla aktarıldı ve audit günlüğüne işlendi.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Fatura kalıcı kayda aktarılırken hata oluştu.');
    } finally {
      setIsTransferring(false);
    }
  };

  // Submit for Manager Review
  const handleSubmitToManager = async () => {
    if (!auditSummary) return;
    await logAuditAction('PRE_AUDIT_MANAGER_SUBMIT', {
      invoiceNumber: auditSummary.invoiceNumber,
      supplier: auditSummary.supplier,
      totalAmount: auditSummary.totalAmount,
      decisionStatus: auditSummary.overallStatus,
      potentialSavings: auditSummary.totalPotentialSavings,
      managerNote
    });
    setShowManagerModal(false);
    setTransferSuccessMsg(`📩 Denetim özeti ve ${auditSummary.totalPotentialSavings.toLocaleString('tr-TR')} RUB tutarındaki risk raporu incelenmek üzere Yöneticiye iletildi.`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-3">
              <span className="p-2.5 bg-indigo-600/90 rounded-xl text-white shadow-inner flex items-center justify-center">
                <ShieldAlert className="w-6 h-6" />
              </span>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-100 flex items-center gap-2.5">
                  Hızlı Onay Öncesi Fiyat Denetimi
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                    Geçici Bellek & Sıfır Risk
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
                  Satınalma faturasını veya sipariş taslağını onaylamadan önce yükleyin. Sistem faturayı geçici hafızada okur, geçmiş alımlarla karşılaştırır, en iyi alımı ve tüm geçmiş alım tarihçesini sunar.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {auditSummary && (
              <button
                type="button"
                onClick={handleClearAudit}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                Denetimi Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Preset Fast-Test Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span>Hızlı Test Örnekleri (Tek Tıkla Dene):</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_DEMO_INVOICES.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setUploadedFile({ name: `${preset.id}.pdf` });
                triggerAnalysis(null, preset.data);
              }}
              className="px-3.5 py-1.5 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-slate-700 hover:text-indigo-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              {preset.title}
            </button>
          ))}
        </div>
      </div>

      {/* Full-Width Clean Upload Zone */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelected(file);
          }}
          className="border-2 border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50/75 hover:bg-indigo-50/40 rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center group"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
            }}
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
            className="hidden"
          />
          <div className="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-xs">
            <Upload className="w-7 h-7" />
          </div>
          <h3 className="font-bold text-slate-800 text-base mb-1">
            {uploadedFile ? uploadedFile.name : 'Fatura veya Teklif Belgesi Sürükleyin veya Seçin'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mb-3">
            PDF, JPG, PNG fatura görselleri veya Excel/CSV malzeme listeleri desteklenir. Yüklenen belge yalnızca geçici bellekte denetlenir, hiçbir orijinal kayıt bozulmaz.
          </p>
          <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 shadow-2xs group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors">
            <FileText className="w-4 h-4 text-indigo-600 group-hover:text-white" />
            Dosya Seç veya Buraya Bırak
          </span>
        </div>

        {isAnalyzing && (
          <div className="mt-4 p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin" />
            <div>
              <p className="text-xs font-bold text-indigo-900">Geçici OCR ve Fiyat Denetimi Yapılıyor...</p>
              <p className="text-[11px] text-indigo-700">Kanonik malzeme normalizasyonu, teknik özellik eşleşmesi ve tüm geçmiş alım tarihçesi taranıyor.</p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {transferSuccessMsg && (
          <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-xs text-emerald-800 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{transferSuccessMsg}</span>
          </div>
        )}
      </div>

      {/* Audit Results Dashboard */}
      {auditSummary && (
        <div className="space-y-5">
          {/* Executive Verdict Banner */}
          <div
            className={`rounded-2xl p-6 border shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
              auditSummary.overallStatusColor === 'rose'
                ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                : auditSummary.overallStatusColor === 'amber'
                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                : auditSummary.overallStatusColor === 'orange'
                ? 'bg-orange-50/80 border-orange-200 text-orange-950'
                : auditSummary.overallStatusColor === 'green'
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
          >
            <div className="space-y-1.5 max-w-3xl">
              <div className="flex items-center gap-2.5">
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider ${
                    auditSummary.overallStatusColor === 'rose'
                      ? 'bg-rose-600 text-white'
                      : auditSummary.overallStatusColor === 'amber'
                      ? 'bg-amber-500 text-white'
                      : auditSummary.overallStatusColor === 'orange'
                      ? 'bg-orange-500 text-white'
                      : auditSummary.overallStatusColor === 'green'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-white'
                  }`}
                >
                  {auditSummary.overallStatus}
                </span>
                <span className="text-xs font-bold text-slate-600">
                  Güven Skoru: %{Math.round(auditSummary.overallConfidenceScore * 100)}
                </span>
                {auditSummary.totalPotentialSavings > 0 && (
                  <span className="bg-rose-100 text-rose-800 border border-rose-200 text-xs font-extrabold px-2.5 py-0.5 rounded-full">
                    {formatRuble(auditSummary.totalPotentialSavings)} Potansiyel Tasarruf
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm font-medium leading-relaxed">
                {auditSummary.overallReasoning}
              </p>
              {rawOcrData?.lineCheck === 'mismatch' && (
                <p className="mt-2 text-xs font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-1.5">
                  Okuma uyarısı: {rawOcrData.lineCheckReason || 'Kalemler fatura toplamıyla doğrulanamadı'}. Doğrulanamayan satırlar için fiyat farkı iddia edilmez; rakamları faturadan kontrol edin.
                </p>
              )}
            </div>

            <div className="text-left md:text-right shrink-0">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Fatura Tutarı</span>
              <span className="text-2xl font-black text-slate-900">
                {formatRuble(auditSummary.totalAmount)}
              </span>
            </div>
          </div>

          {/* Quick Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              {auditSummary.overallStatus === 'YÖNETİCİ İNCELEMESİ GEREKLİ' && (
                <button
                  type="button"
                  onClick={() => setShowManagerModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Yöneticiye Gönder
                </button>
              )}

              {auditSummary.totalPotentialSavings > 0 && (
                <button
                  type="button"
                  onClick={() => setShowNegotiationModal(true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  İndirim Talep Brifingi
                </button>
              )}

              {auditSummary.requiresMandatoryJustification && (
                <button
                  type="button"
                  onClick={() => setShowJustificationModal(true)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Onaylamaya Devam Et (Gerekçe Zorunlu)
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTransferModal(true)}
                disabled={isTransferred || isTransferring}
                className={`px-4 py-2 text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-all cursor-pointer ${
                  isTransferred
                    ? 'bg-slate-200 text-slate-500 border border-slate-300 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                <FileCheck className="w-4 h-4" />
                {isTransferred ? 'Normal Kayda Aktarıldı ✔' : 'Normal Fatura Kaydına Aktar'}
              </button>
            </div>
          </div>

          {/* Detailed Line Items Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Fatura Kalemleri ve Geçmiş Fiyat Karşılaştırması</h3>
                <p className="text-xs text-slate-500">
                  Her kalemin geçmişteki tüm alım kayıtlarını incelemek ve faturasını görüntülemek için satırı genişletin veya "İncele" butonuna tıklayın.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-slate-200/80 rounded-lg text-slate-700">
                {auditSummary.lineResults.length} Kalem
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-100/75 text-slate-600 uppercase font-bold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">#</th>
                    <th className="p-3.5">Fatura Kalemi & Eşleşme</th>
                    <th className="p-3.5">Mevcut Teklif</th>
                    <th className="p-3.5">Geçmiş En İyi Alım</th>
                    <th className="p-3.5">Fark / Risk</th>
                    <th className="p-3.5">Eşleşme Güveni</th>
                    <th className="p-3.5">Karar Durumu</th>
                    <th className="p-3.5 text-center">Tüm Geçmiş & Fatura</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {auditSummary.lineResults.map((line) => {
                    const isExpanded = !!expandedRows[line.lineIndex];
                    const pastCount = line.allHistoricalMatches?.length || 0;

                    return (
                      <React.Fragment key={line.lineIndex}>
                        <tr className={`hover:bg-slate-50/80 transition-colors ${line.statusColor === 'rose' ? 'bg-rose-50/30' : ''}`}>
                          <td className="p-3.5 font-bold text-slate-400">{line.lineIndex + 1}</td>
                          <td className="p-3.5 max-w-xs">
                            <p className="font-bold text-slate-900 line-clamp-1">
                              {line.draftItem.originalName || line.processed.canonicalName}
                            </p>
                            <p className="text-[11px] text-slate-500 line-clamp-1 italic">{line.draftItem.materialName}</p>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              <span className="inline-block text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                {line.processed.category}
                              </span>
                              {line.smartSignature && (
                                <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                  line.smartSignature.isCommodity
                                    ? 'bg-slate-800 text-slate-100 border-slate-700'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                }`}>
                                  {line.smartSignature.isCommodity ? 'Emtia (GOST)' : line.smartSignature.canonicalBrandDisplay}
                                </span>
                              )}
                              {line.crossBrandEconomySuggestion?.hasCheaperEquivalent && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-300">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  Mod 2 Muadil: -{line.crossBrandEconomySuggestion.savingsPercentage}% ({line.crossBrandEconomySuggestion.suggestedBrandDisplay})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <p className="font-black text-slate-900">{formatRuble(line.draftItem.unitPrice)} / {line.draftItem.unit}</p>
                            <p className="text-[11px] text-slate-500">{line.draftItem.quantity} {line.draftItem.unit} = {formatRuble(line.draftItem.totalPrice)}</p>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            {line.hasHistoricalMatch && line.bestHistoricalMatch ? (
                              <div>
                                <p className="font-bold text-emerald-700">{formatRuble(line.minHistoricalPrice)} / {line.draftItem.unit}</p>
                                <p className="text-[11px] text-slate-500">{line.bestHistoricalMatch.date} • {line.bestHistoricalMatch.supplier}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenHistoricalInvoice(line.bestHistoricalMatch!)}
                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded transition-colors cursor-pointer"
                                    title="Geçmiş faturanın kalemlerini ve detaylarını görüntüle"
                                  >
                                    <Eye className="w-3 h-3" />
                                    Fatura #{line.bestHistoricalMatch.invoiceNumber}
                                  </button>
                                  {line.bestHistoricalMatch.fileUrl && (
                                    <a
                                      href={line.bestHistoricalMatch.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded transition-colors"
                                      title="Orijinal PDF/belgeyi yeni sekmede aç"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      PDF
                                    </a>
                                  )}
                                  {pastCount > 1 && (
                                    <span className="text-[10px] font-medium text-slate-500">
                                      (+{pastCount - 1} diğer alım)
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Geçmiş Kayıt Yok</span>
                            )}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            {line.hasHistoricalMatch ? (
                              <div>
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded font-black text-xs ${
                                    line.percentagePriceDiff > 0
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {line.percentagePriceDiff > 0 ? `+${line.percentagePriceDiff}%` : `${line.percentagePriceDiff}%`}
                                </span>
                                {line.potentialSavings > 0 && (
                                  <p className="text-[10px] font-bold text-rose-600 mt-0.5">
                                    +{formatRuble(line.potentialSavings)}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <p className="font-bold text-slate-700">% {Math.round(line.matchConfidence * 100)} Güven</p>
                            <span className="text-[10px] text-slate-500 font-medium">
                              {line.comparisonLevel === 'LEVEL_1_SAME_VARIANT' && 'Düzey 1: Tam Varyant'}
                              {line.comparisonLevel === 'LEVEL_2_SAME_SUPPLIER' && 'Düzey 2: Aynı Tedarikçi'}
                              {line.comparisonLevel === 'LEVEL_3_OTHER_SUPPLIERS' && 'Düzey 3: Diğer Tedarikçi'}
                              {line.comparisonLevel === 'LEVEL_4_OTHER_JOBSITES' && 'Düzey 4: Diğer Şantiye'}
                              {line.comparisonLevel === 'NONE' && 'Kayıt Yok'}
                            </span>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <span
                              className={`px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider border ${
                                line.statusColor === 'rose'
                                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                                  : line.statusColor === 'amber'
                                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                                  : line.statusColor === 'orange'
                                  ? 'bg-orange-100 text-orange-800 border-orange-300'
                                  : line.statusColor === 'green'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : 'bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                            >
                              {line.status}
                            </span>
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => setExpandedRows(prev => ({ ...prev, [line.lineIndex]: !prev[line.lineIndex] }))}
                              className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1 mx-auto transition-colors cursor-pointer ${
                                isExpanded
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-slate-50 hover:bg-indigo-50 border-slate-200 text-slate-700 hover:text-indigo-700'
                              }`}
                              title="Tüm geçmiş alımları ve faturaları gör"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isExpanded ? 'Kapat' : `Detay (${pastCount})`}</span>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Sub-Row with Full Historical Purchases Table */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90 border-b border-slate-200">
                            <td colSpan={8} className="p-5">
                              <div className="space-y-4 text-xs">
                                {/* Top Reason and Briefing Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                                    <h4 className="font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                                      <AlertTriangle className="w-4 h-4 text-indigo-600" />
                                      Karar Gerekçesi & Özet (Mod 1: Elma-Elma Birebir Kıyaslama)
                                    </h4>
                                    <p className="text-slate-600 leading-relaxed">{line.decisionReasoning}</p>
                                    {line.bestHistoricalMatch && (
                                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                                        <div>
                                          <span><strong>En İyi Alım Referansı:</strong> {line.bestHistoricalMatch.supplier} ({line.bestHistoricalMatch.date})</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenHistoricalInvoice(line.bestHistoricalMatch!)}
                                          className="text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                          En İyi Faturayı Görüntüle
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {line.suggestedAction && (
                                    <div className="bg-amber-50/90 p-4 rounded-xl border border-amber-200 shadow-2xs">
                                      <h4 className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
                                        <MessageSquare className="w-4 h-4 text-amber-600" />
                                        Tedarikçi Pazarlık Brifingi
                                      </h4>
                                      <p className="text-amber-800 leading-relaxed italic">
                                        "{line.suggestedAction.negotiationScript}"
                                      </p>
                                      <p className="mt-2 text-[11px] font-bold text-amber-900">
                                        Hedef Birim Fiyat: {formatRuble(line.suggestedAction.recommendedTargetPrice)} (Tasarruf: {formatRuble(line.suggestedAction.potentialDiscountAmount)})
                                      </p>
                                    </div>
                                  )}
                                </div>

                                {/* Mode 2: Cross-Brand Equivalent Economy Suggestion Banner */}
                                {line.crossBrandEconomySuggestion?.hasCheaperEquivalent && (
                                  <div className="bg-emerald-50/90 p-4 rounded-xl border border-emerald-300 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 font-black text-emerald-900 text-xs">
                                        <Sparkles className="w-4 h-4 text-emerald-600" />
                                        <span>💡 Muadil Marka Ekonomi Önerisi (Mod 2 — Alternatif Marka Analizi)</span>
                                        <span className="px-2 py-0.5 rounded bg-emerald-200/80 text-emerald-900 text-[10px] font-mono">
                                          {line.crossBrandEconomySuggestion.specLabel}
                                        </span>
                                      </div>
                                      <p className="text-emerald-800 leading-relaxed">
                                        Faturadaki orijinal <strong>{line.crossBrandEconomySuggestion.currentBrandDisplay}</strong> markası yerine aynı teknik ölçü ve kullanım sınıfındaki (<em>{line.crossBrandEconomySuggestion.familyTitleRu}</em>) <strong>{line.crossBrandEconomySuggestion.suggestedBrandDisplay}</strong> muadili tercih edilirse birim fiyatta <strong>%{line.crossBrandEconomySuggestion.savingsPercentage} ({formatRuble(line.crossBrandEconomySuggestion.unitSavingsRub)})</strong>, bu kalemde toplam <strong>{formatRuble(line.crossBrandEconomySuggestion.totalSavingsRub)}</strong> ekonomi sağlanabilir.
                                      </p>
                                    </div>
                                    <div className="bg-white px-3.5 py-2.5 rounded-xl border border-emerald-200 text-right shrink-0">
                                      <span className="block text-[10px] font-bold text-slate-500 uppercase">Muadil Birim Fiyat</span>
                                      <span className="font-mono font-black text-emerald-700 text-sm">
                                        {formatRuble(line.crossBrandEconomySuggestion.suggestedUnitPrice)} / {line.draftItem.unit}
                                      </span>
                                      <span className="block text-[10px] font-black text-emerald-600 mt-0.5">
                                        Toplam Ekonomi: +{formatRuble(line.crossBrandEconomySuggestion.totalSavingsRub)}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Historical Purchases Detail Table */}
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                  <div className="p-3 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Layers className="w-4 h-4 text-slate-600" />
                                      <span className="font-bold text-slate-800 text-xs">
                                        Bu Malzemeye Ait Tüm Geçmiş Alımlar ({line.allHistoricalMatches?.length || 0} Kayıt)
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                      Herhangi bir satırdaki "Faturayı Görüntüle"ye basarak orijinal faturayı inceleyebilirsiniz.
                                    </span>
                                  </div>

                                  {line.allHistoricalMatches && line.allHistoricalMatches.length > 0 ? (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200">
                                          <tr>
                                            <th className="p-2.5">Tarih</th>
                                            <th className="p-2.5">Fatura No</th>
                                            <th className="p-2.5">Tedarikçi</th>
                                            <th className="p-2.5">Şantiye</th>
                                            <th className="p-2.5">Geçmiş Kalem Adı</th>
                                            <th className="p-2.5">Miktar</th>
                                            <th className="p-2.5">Birim Fiyat</th>
                                            <th className="p-2.5">Eşleşme</th>
                                            <th className="p-2.5 text-center">Fatura İşlemi</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {line.allHistoricalMatches.map((past, pIdx) => {
                                            const isBest = past.normalizedUnitPrice === line.minHistoricalPrice;
                                            return (
                                              <tr key={pIdx} className={`hover:bg-slate-50 transition-colors ${isBest ? 'bg-emerald-50/40' : ''}`}>
                                                <td className="p-2.5 whitespace-nowrap font-medium text-slate-600">
                                                  {past.date}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap font-bold text-slate-800">
                                                  {past.invoiceNumber}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap text-slate-800 font-medium">
                                                  {past.supplier}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap text-slate-600">
                                                  {past.jobsiteName}
                                                </td>
                                                <td className="p-2.5 max-w-xs text-slate-600 truncate" title={past.rawMaterialName}>
                                                  {past.rawMaterialName}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap text-slate-600">
                                                  {past.quantity} {past.unit}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap">
                                                  <div className="flex items-center gap-1.5">
                                                    <span className={`font-bold ${isBest ? 'text-emerald-700' : 'text-slate-800'}`}>
                                                      {formatRuble(past.normalizedUnitPrice)} / {past.unit}
                                                    </span>
                                                    {isBest && (
                                                      <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded text-[9px] font-black uppercase">
                                                        En İyi
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap text-[11px] text-slate-500">
                                                  %{Math.round(past.matchScore * 100)}
                                                </td>
                                                <td className="p-2.5 whitespace-nowrap text-center">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleOpenHistoricalInvoice(past)}
                                                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold flex items-center gap-1 mx-auto transition-colors cursor-pointer"
                                                  >
                                                    <Eye className="w-3.5 h-3.5" />
                                                    Faturayı Görüntüle
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="p-4 text-center text-slate-500 italic">
                                      Bu kalem için sistemde henüz geçmiş alım kaydı bulunmamaktadır.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detailed Preview Modal */}
      {viewingInvoiceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600 rounded-xl text-white">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    Fatura Detayı: {viewingInvoiceModal.invoice?.invoiceNumber || viewingInvoiceModal.invoice?.invoiceNo || viewingInvoiceModal.historicalPoint?.invoiceNumber || 'Geçmiş Fatura'}
                    <span className="text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/30">
                      Geçmiş Referans Belgesi
                    </span>
                  </h3>
                  <p className="text-xs text-slate-300">
                    Tedarikçi: {viewingInvoiceModal.invoice?.supplier || viewingInvoiceModal.historicalPoint?.supplier || 'Tedarikçi Firma'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingInvoiceModal(null)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5">
              {/* Invoice Meta Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Tarih</span>
                  <span className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {viewingInvoiceModal.invoice?.date || viewingInvoiceModal.historicalPoint?.date || '—'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Şantiye / Proje</span>
                  <span className="font-bold text-slate-800 flex items-center gap-1 mt-0.5 truncate" title={viewingInvoiceModal.invoice?.jobsiteName || viewingInvoiceModal.historicalPoint?.jobsiteName}>
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {viewingInvoiceModal.invoice?.jobsiteName || viewingInvoiceModal.historicalPoint?.jobsiteName || 'Şantiye'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Satınalma Şefi</span>
                  <span className="font-bold text-slate-800 mt-0.5 block truncate">
                    {viewingInvoiceModal.invoice?.supervisorName || viewingInvoiceModal.invoice?.uploadedBySupervisorName || 'Sistem Kaydı'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[11px]">Toplam Tutar</span>
                  <span className="font-black text-indigo-700 text-sm mt-0.5 block">
                    {viewingInvoiceModal.invoice?.totalAmount ? formatRuble(viewingInvoiceModal.invoice.totalAmount) : formatRuble(viewingInvoiceModal.historicalPoint?.rawUnitPrice || 0)}
                  </span>
                </div>
              </div>

              {/* Document File Attachment Preview (if available) */}
              {(viewingInvoiceModal.invoice?.fileUrl || (viewingInvoiceModal.invoice as any)?.imageUrl) ? (
                <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-indigo-600" />
                      <span className="font-bold text-indigo-950 text-xs">Fatura Orijinal Belgesi (PDF / Resim)</span>
                    </div>
                    <a
                      href={viewingInvoiceModal.invoice?.fileUrl || (viewingInvoiceModal.invoice as any)?.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Belgeyi Yeni Sekmede Aç
                    </a>
                  </div>
                  {/* Embedded Iframe/Image if image */}
                  {(viewingInvoiceModal.invoice?.fileUrl?.match(/\.(jpeg|jpg|png|webp)/i) || (viewingInvoiceModal.invoice as any)?.imageUrl) && (
                    <div className="max-h-64 overflow-hidden rounded-lg border border-indigo-200 bg-white flex items-center justify-center p-2">
                      <img
                        src={viewingInvoiceModal.invoice?.fileUrl || (viewingInvoiceModal.invoice as any)?.imageUrl}
                        alt="Fatura Belgesi"
                        className="max-h-60 object-contain rounded"
                      />
                    </div>
                  )}
                </div>
              ) : null}

              {/* Items List Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                <div className="p-3 bg-slate-100 border-b border-slate-200 font-bold text-slate-800 text-xs">
                  Faturadaki Tüm Kalemler
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Malzeme Adı</th>
                        <th className="p-2.5">Kategori</th>
                        <th className="p-2.5">Miktar</th>
                        <th className="p-2.5">Birim Fiyat</th>
                        <th className="p-2.5">Toplam Tutar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingInvoiceModal.invoice?.items && viewingInvoiceModal.invoice.items.length > 0 ? (
                        viewingInvoiceModal.invoice.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2.5 font-bold text-slate-400">{idx + 1}</td>
                            <td className="p-2.5 font-semibold text-slate-800">
                              {it.materialName}
                              {it.originalName && it.originalName !== it.materialName && (
                                <span className="block text-[11px] text-slate-500 font-normal italic">{it.originalName}</span>
                              )}
                            </td>
                            <td className="p-2.5 text-slate-600">{it.category || '—'}</td>
                            <td className="p-2.5 text-slate-800 font-medium">{it.quantity} {it.unit}</td>
                            <td className="p-2.5 font-bold text-slate-900">{formatRuble(it.unitPrice)}</td>
                            <td className="p-2.5 font-black text-indigo-700">{formatRuble(it.totalPrice || (it.quantity * it.unitPrice))}</td>
                          </tr>
                        ))
                      ) : viewingInvoiceModal.historicalPoint ? (
                        <tr className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-slate-400">1</td>
                          <td className="p-2.5 font-semibold text-slate-800">
                            {viewingInvoiceModal.historicalPoint.rawMaterialName}
                            <span className="block text-[11px] text-slate-500 font-normal italic">{viewingInvoiceModal.historicalPoint.canonicalName}</span>
                          </td>
                          <td className="p-2.5 text-slate-600">—</td>
                          <td className="p-2.5 text-slate-800 font-medium">{viewingInvoiceModal.historicalPoint.quantity} {viewingInvoiceModal.historicalPoint.unit}</td>
                          <td className="p-2.5 font-bold text-slate-900">{formatRuble(viewingInvoiceModal.historicalPoint.rawUnitPrice)}</td>
                          <td className="p-2.5 font-black text-indigo-700">
                            {formatRuble(viewingInvoiceModal.historicalPoint.rawUnitPrice * viewingInvoiceModal.historicalPoint.quantity)}
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-400 italic">
                            Kalem bilgisi bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Notes */}
              {viewingInvoiceModal.invoice?.notes && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <span className="font-bold text-slate-700 block mb-0.5">Fatura Notları & Açıklamalar:</span>
                  <p className="text-slate-600">{viewingInvoiceModal.invoice.notes}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingInvoiceModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer to Permanent Invoice Modal */}
      {showTransferModal && auditSummary && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <FileCheck className="w-5 h-5" />
              <h3 className="font-bold text-base text-slate-900">Normal Fatura Kaydına Aktar</h3>
            </div>
            <p className="text-xs text-slate-600">
              Bu faturayı resmi fatura kayıtlarına aktarmak üzeresiniz. Faturanın atanacağı Şantiye ve Satınalma Şefini teyit ediniz:
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Şantiye / Proje</label>
                <select
                  value={transferJobsiteId}
                  onChange={(e) => setTransferJobsiteId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500"
                >
                  {jobsites.map(j => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Satınalma Şefi</label>
                <select
                  value={transferSupervisorId}
                  onChange={(e) => setTransferSupervisorId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-emerald-500"
                >
                  {supervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs font-bold space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
                {(errorMsg.toLowerCase().includes('kayıtlı') || errorMsg.toLowerCase().includes('mükerrer')) && (
                  <label className="flex items-center space-x-2 pt-2 border-t border-rose-200 text-rose-950 font-extrabold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceSaveDuplicate}
                      onChange={(e) => {
                        setForceSaveDuplicate(e.target.checked);
                        if (e.target.checked) setErrorMsg(null);
                      }}
                      className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                    />
                    <span>Bu faturanın sistemde kayıtlı olduğunu biliyorum, yine de yeni kayıt oluştur</span>
                  </label>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleConfirmTransfer}
                disabled={isTransferring}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {isTransferring ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Aktarılıyor...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aktarımı Tamamla
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mandatory Justification Modal */}
      {showJustificationModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-bold text-base text-slate-900">Yüksek Fiyat Onay Gerekçesi (Zorunlu)</h3>
            </div>
            <p className="text-xs text-slate-600">
              Bu faturada geçmiş alımlardan daha yüksek fiyata sahip kalemler bulunmaktadır. Onay sürecine devam edebilmek için gerekçenizi giriniz.
            </p>
            <textarea
              rows={4}
              value={justificationText}
              onChange={(e) => setJustificationText(e.target.value)}
              placeholder="Örnek: Şantiyede beton dökümü durmaması için acil teslimat şartıyla mevcut fiyattan devam edilmiştir."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowJustificationModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!justificationText.trim()) {
                    alert('Lütfen devam etmeden önce geçerli bir gerekçe yazınız.');
                    return;
                  }
                  await logAuditAction('PRE_AUDIT_OVERRIDE_JUSTIFIED', {
                    invoiceNumber: auditSummary?.invoiceNumber,
                    justification: justificationText,
                    decisionStatus: auditSummary?.overallStatus
                  });
                  setShowJustificationModal(false);
                  setTransferSuccessMsg('✅ Yönetici gerekçesi kaydedildi. Faturayı kalıcı kayda aktarabilirsiniz.');
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Gerekçeyi Kaydet ve Onayla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Negotiation Script Modal */}
      {showNegotiationModal && auditSummary && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <MessageSquare className="w-5 h-5" />
              <h3 className="font-bold text-base text-slate-900">Satınalmacı İndirim Talep Brifingi</h3>
            </div>
            <p className="text-xs text-slate-600">
              Aşağıdaki kalemlerde geçmiş alımlara kıyasla yüksek fiyat tespit edildi. Satınalmacının tedarikçiyle iletişime geçerek indirim talep etmesi önerilir:
            </p>
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {auditSummary.lineResults.filter(l => l.suggestedAction).map((line, idx) => (
                <div key={idx} className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between font-bold text-amber-950">
                    <span>{line.draftItem.materialName}</span>
                    <span className="text-rose-700">+{line.percentagePriceDiff}% Yüksek</span>
                  </div>
                  <p className="text-slate-700 italic">
                    "{line.suggestedAction?.negotiationScript}"
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-amber-900 font-medium pt-1 border-t border-amber-200/60">
                    <span>Teklif: {formatRuble(line.draftItem.unitPrice)}</span>
                    <span className="font-bold text-emerald-800">Hedef: {formatRuble(line.suggestedAction?.recommendedTargetPrice || 0)}</span>
                    <span className="font-bold text-rose-700">Tasarruf: {formatRuble(line.suggestedAction?.potentialDiscountAmount || 0)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowNegotiationModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={async () => {
                  await logAuditAction('PRE_AUDIT_DISCOUNT_RETURN', {
                    invoiceNumber: auditSummary?.invoiceNumber,
                    potentialSavings: auditSummary?.totalPotentialSavings
                  });
                  setShowNegotiationModal(false);
                  setTransferSuccessMsg(`💡 İndirim talep brifingi satınalmacıya iletildi. Toplam ${formatRuble(auditSummary.totalPotentialSavings)} indirim hedefleniyor.`);
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Brifingi Satınalmacıya İlet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager Submission Modal */}
      {showManagerModal && auditSummary && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-indigo-600">
              <Send className="w-5 h-5" />
              <h3 className="font-bold text-base text-slate-900">Yönetici Onayına Sevk Et</h3>
            </div>
            <p className="text-xs text-slate-600">
              Bu faturada geçmiş alımlara göre yüksek tutarlı fiyat artışı tespit edildiği için yönetici incelemesi gerekmektedir. Yöneticinize iletilmek üzere not ekleyebilirsiniz:
            </p>
            <textarea
              rows={3}
              value={managerNote}
              onChange={(e) => setManagerNote(e.target.value)}
              placeholder="Örnek: Fiyat artışı piyasa demir endeksiyle uyumlu görünmüyor, lütfen ek iskonto teyit edilmeden onaylanmasın."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowManagerModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSubmitToManager}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Yöneticiye Sevk Et
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
