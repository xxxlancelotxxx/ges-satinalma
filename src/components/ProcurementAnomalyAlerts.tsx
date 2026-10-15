import React, { useState, useMemo, useEffect } from 'react';
import { InvoiceRecord, DiscountRecord, MaterialComparison, Jobsite, PurchasingSupervisor } from '../types';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useModalBackHandler } from '../hooks/useModalBackHandler';
import { detectSuperIntelligentProcurementAnomalies } from '../utils/aiForensicAuditor';
import { isExemptFromBenchmarkAudit } from '../utils/auditRiskEngine';
import { ensureRussianOriginalName } from '../utils/categoryClassifier';
import { analyzeMaterialSegment, areMaterialSegmentsCompatible } from '../utils/materialSegmentIntelligence';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Building2,
  Bell,
  Sparkles,
  Search,
  Filter,
  ArrowUpRight,
  ShieldAlert,
  CheckCircle2,
  Info,
  DollarSign,
  FileText,
  Users,
  ChevronRight,
  ExternalLink,
  Zap,
  Tag,
  Check,
  X,
  RotateCcw,
  Clock,
  Layers,
  HelpCircle,
  Archive,
  ShieldCheck,
  Eye,
  Compass,
  FileCheck2,
  Calendar
} from 'lucide-react';

interface Props {
  invoices: InvoiceRecord[];
  discounts: DiscountRecord[];
  comparisons: MaterialComparison[];
  jobsites: Jobsite[];
  supervisors: PurchasingSupervisor[];
  onNavigateToMaterial?: (materialName: string) => void;
}

export interface AnomalyAlert {
  id: string;
  type:
    | 'SAME_VENDOR_INFLATION'
    | 'JOBSITE_PRICE_GAP'
    | 'ZERO_DISCOUNT_HIGH_VALUE'
    | 'CROSS_JOBSITE_ARBITRAGE'
    | 'SPLIT_INVOICE_SMURFING'
    | 'PRICE_CREEP'
    | 'BASKET_SHRINKAGE';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  materialName: string;
  category: string;
  vendorName: string;
  jobsiteName?: string;
  previousPrice?: number;
  currentPrice?: number;
  percentageChange: number;
  financialImpact: number;
  dateStr: string;
  description: string;
  recommendation: string;
  invoiceNo?: string;
  quantity?: number;
  unit?: string;
  russianSubtitle?: string;
  minUnitPrice?: number;
  maxUnitPrice?: number;
  avgUnitPrice?: number;
  historyRows?: Array<{
    date: string;
    invoiceNo: string;
    supplier: string;
    jobsiteName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    originalName?: string;
    conversionFormula?: string;
  }>;
  marketCluster?: 'STEEL_REBAR' | 'CONCRETE_CEMENT' | 'COPPER_CABLE' | 'LOGISTICS_GAP' | 'GENERAL';
}

export interface AnomalyAcknowledgement {
  anomalyId: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
  reason: string;
  note?: string;
  materialName?: string;
  vendorName?: string;
  jobsiteName?: string;
  financialImpact?: number;
}

const LOCAL_STORAGE_ACK_KEY = 'gescons_anomaly_acknowledgements';

export const ProcurementAnomalyAlerts: React.FC<Props> = ({
  invoices,
  discounts,
  comparisons,
  jobsites,
  supervisors,
  onNavigateToMaterial
}) => {
  const { t, language } = useLanguage();
  const { user } = useAuth();

  // Active view tab: 'ACTIVE' (unacknowledged) vs 'ARCHIVED' (acknowledged by manager)
  const [activeViewTab, setActiveViewTab] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedJobsite, setSelectedJobsite] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortBy, setSortBy] = useState<'IMPACT' | 'PERCENTAGE' | 'DATE'>('PERCENTAGE');

  // Manager acknowledgements map: { [anomalyId]: AnomalyAcknowledgement }
  const [acknowledgedMap, setAcknowledgedMap] = useState<Record<string, AnomalyAcknowledgement>>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_ACK_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const map: Record<string, AnomalyAcknowledgement> = {};
          parsed.forEach((item: AnomalyAcknowledgement) => {
            if (item && item.anomalyId) map[item.anomalyId] = item;
          });
          return map;
        } else if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[ANOMALY] Error reading local acknowledgements:', e);
    }
    return {};
  });

  // Selected alert for in-place detail modal
  const [selectedAlertForDetail, setSelectedAlertForDetail] = useState<AnomalyAlert | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [managerNote, setManagerNote] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedInvoiceForModal, setSelectedInvoiceForModal] = useState<InvoiceRecord | null>(null);

  // Hook for back button behavior on modals
  useModalBackHandler(!!selectedInvoiceForModal, () => {
    setSelectedInvoiceForModal(null);
  });
  useModalBackHandler(!!selectedAlertForDetail && !selectedInvoiceForModal, () => {
    setSelectedAlertForDetail(null);
  });

  // Open full invoice detail / price basis modal
  const handleOpenInvoiceDetail = (invoiceNo: string, rawInvoice?: InvoiceRecord) => {
    if (rawInvoice) {
      setSelectedInvoiceForModal(rawInvoice);
      return;
    }
    const cleanNo = (invoiceNo || '').toLowerCase().trim();
    
    // 1. Direct search in invoices
    let found = invoices.find(inv => {
      const invNum = (inv.invoiceNumber || inv.invoiceNo || '').toLowerCase().trim();
      return invNum === cleanNo || (inv.id && inv.id.toLowerCase().trim() === cleanNo);
    });

    // 2. Search in discounts if not found in direct invoices
    if (!found) {
      const discMatch = discounts.find(d => {
        const dNum = (d.invoiceNo || '').toLowerCase().trim();
        return dNum === cleanNo || (d.id && d.id.toLowerCase().trim() === cleanNo);
      });

      if (discMatch) {
        const agreed = Number(discMatch.agreedPrice) || Number(discMatch.offerPrice) || 0;
        found = {
          id: `disc_inv_${discMatch.id}`,
          invoiceNumber: discMatch.invoiceNo || invoiceNo || 'Pazarlık Faturası',
          date: discMatch.orderDate || discMatch.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
          supplier: discMatch.vendorName || 'Tedarikçi Firma',
          jobsiteId: discMatch.jobsiteId || '',
          jobsiteName: discMatch.jobsiteName || 'Genel Şantiye',
          uploadedBySupervisorId: discMatch.supervisorId || '',
          uploadedBySupervisorName: discMatch.supervisorName || 'Satınalma Şefi',
          totalAmount: agreed,
          currency: 'RUB',
          fileUrl: discMatch.fileUrl || null,
          items: Array.isArray(discMatch.items) && discMatch.items.length > 0
            ? discMatch.items
            : [
                {
                  id: 'item_1',
                  materialName: discMatch.materialName || selectedAlertForDetail?.materialName || 'Malzeme',
                  category: discMatch.category || selectedAlertForDetail?.category || 'Genel',
                  quantity: 1,
                  unit: 'Adet',
                  unitPrice: agreed,
                  totalPrice: agreed
                }
              ]
        };
      }
    }

    if (found) {
      setSelectedInvoiceForModal(found);
    } else if (selectedAlertForDetail) {
      // Create a full-fidelity fallback invoice object showing the exact basis
      const currPrice = selectedAlertForDetail.currentPrice || 0;
      const qty = selectedAlertForDetail.quantity || 1;
      const total = currPrice * qty;
      const syntheticInvoice: InvoiceRecord = {
        id: `basis_${Date.now()}`,
        invoiceNumber: invoiceNo || selectedAlertForDetail.invoiceNo || 'Fatura Altlığı',
        date: selectedAlertForDetail.dateStr || new Date().toISOString().split('T')[0],
        supplier: selectedAlertForDetail.vendorName || 'Tedarikçi Firma',
        jobsiteName: selectedAlertForDetail.jobsiteName || 'Genel Şantiye',
        totalAmount: total > 0 ? total : currPrice,
        subtotal: (total > 0 ? total : currPrice) * 0.833,
        tax: (total > 0 ? total : currPrice) * 0.167,
        currency: 'RUB',
        uploadedBySupervisorId: 'sup_1',
        createdAt: new Date().toISOString(),
        items: [
          {
            id: 'basis_item_1',
            materialName: selectedAlertForDetail.materialName,
            category: selectedAlertForDetail.category,
            quantity: qty,
            unit: selectedAlertForDetail.unit || 'Adet',
            unitPrice: currPrice,
            totalPrice: total > 0 ? total : currPrice,
            discountAmount: 0
          }
        ]
      };
      setSelectedInvoiceForModal(syntheticInvoice);
    }
  };

  // Load acknowledgements from server on mount
  useEffect(() => {
    let isMounted = true;
    const loadAcknowledgements = async () => {
      try {
        const res = await fetch('/api/anomalies/acknowledgements');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.acknowledgements) && isMounted) {
            setAcknowledgedMap(prev => {
              const merged = { ...prev };
              data.acknowledgements.forEach((item: any) => {
                if (item && item.anomalyId) {
                  merged[item.anomalyId] = {
                    anomalyId: item.anomalyId,
                    acknowledgedBy: item.acknowledgedBy || 'Yönetici',
                    acknowledgedAt: item.acknowledgedAt || new Date().toISOString(),
                    reason: item.reason || 'Piyasa / Emtia Dalgalanması',
                    note: item.note || '',
                    materialName: item.materialName || '',
                    vendorName: item.vendorName || '',
                    jobsiteName: item.jobsiteName || '',
                    financialImpact: item.financialImpact || 0
                  };
                }
              });
              try {
                localStorage.setItem(LOCAL_STORAGE_ACK_KEY, JSON.stringify(merged));
              } catch (e) {}
              return merged;
            });
          }
        }
      } catch (err) {
        console.warn('[ANOMALY] Server acknowledgements sync warn:', err);
      }
    };
    loadAcknowledgements();
    return () => {
      isMounted = false;
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Helper for detecting market cluster intelligence
  const getMarketIntelligence = (materialName: string, category: string) => {
    const text = `${materialName} ${category}`.toLowerCase();
    
    // 1. Demir, Donatı Çeliği, Profil, Sac, Metal (Steel / Rebar)
    if (
      text.includes('demir') || text.includes('çelik') || text.includes('celik') ||
      text.includes('donatı') || text.includes('donati') || text.includes('profil') ||
      text.includes('sac') || text.includes('boru') || text.includes('арматур') ||
      text.includes('сталь') || text.includes('металл') || text.includes('прокат') ||
      text.includes('уголок') || text.includes('швеллер') || text.includes('балк') || text.includes('труб')
    ) {
      return {
        cluster: 'STEEL_REBAR' as const,
        badge: language === 'RU' ? '🏗️ Волатильность цен на арматуру / металл' : '🏗️ İnşaat Demiri & Metal Volatilitesi',
        explanation: language === 'RU'
          ? 'На российском рынке строительной арматуры (Арматура А500С и др.) и сортового металлопроката наблюдаются регулярные циклические ценовые колебания (например, котировки за тонну могут подниматься с 70.000 ₽ до 75.000–80.000 ₽ и затем корректироваться обратно до 65.000–70.000 ₽ в зависимости от спроса и биржевых цен на лом). Данный рост может носить временный характер рыночной конъюнктуры.'
          : 'Rusya inşaat demiri (арматура) ve metal piyasasında hammadde & hurda endeksine bağlı olarak belirgin döngüsel dalgalanmalar yaşanmaktadır (örneğin ton fiyatı 70.000 ₽ seviyesinden 75.000 ₽ - 80.000 ₽ bandına tırmanıp, piyasa talebi ve fabrika kotalarına göre tekrar 65.000 ₽ - 70.000 ₽ seviyelerine gevşeyebilmektedir). Bu artış dönemsel piyasa dalgalanmasından kaynaklanıyor olabilir.',
        defaultReason: language === 'RU' ? 'Рыночные колебания цен на металл/арматуру' : 'Piyasa / Emtia Dalgalanması (Demir, Çelik vb.)'
      };
    }
    
    // 2. Beton, Çimento, Kum, Mıcır (Concrete & Cement)
    if (
      text.includes('beton') || text.includes('çimento') || text.includes('cimento') ||
      text.includes('kum') || text.includes('çakıl') || text.includes('cakil') ||
      text.includes('щебень') || text.includes('песок') || text.includes('цемент') || text.includes('раствор')
    ) {
      return {
        cluster: 'CONCRETE_CEMENT' as const,
        badge: language === 'RU' ? '🧱 Сезонность и логистика бетона / цемента' : '🧱 Beton & Çimento Sezonluk Oynaklık',
        explanation: language === 'RU'
          ? 'Цены на товарный бетон и цемент подвержены влиянию сезонных добавок (противоморозные компоненты), загрузки РБУ и расстояния доставки миксерами до конкретного объекта.'
          : 'Hazır beton ve çimento fiyatları santrallerin kış/yaz katkı maddeleri, klinker maliyetleri ve şantiye döküm mesafesine bağlı mikser lojistiği nedeniyle değişkenlik gösterebilir.',
        defaultReason: language === 'RU' ? 'Сезонные и логистические факторы бетона/цемента' : 'Sezonluk / Lojistik Maliyet (Beton & Agrega)'
      };
    }

    // 3. Kablo, Tel, Bakır (Cables & Electrical)
    if (
      text.includes('kablo') || text.includes('tel') || text.includes('bakır') || text.includes('bakir') ||
      text.includes('кабель') || text.includes('провод') || text.includes('медь')
    ) {
      return {
        cluster: 'COPPER_CABLE' as const,
        badge: language === 'RU' ? '⚡ Индекс меди и электротехники' : '⚡ Bakır Borsası & Elektrik Endeksi',
        explanation: language === 'RU'
          ? 'Кабельная продукция напрямую привязана к мировым биржевым котировкам меди (LME) и полимерной изоляции, что вызывает скачки в прайс-листах поставщиков.'
          : 'Kablo ve iletken ürünleri Londra Metal Borsası (LME) bakır endeksine ve polimer hammadde maliyetine bağlı olarak periyodik fiyat güncellemeleri yaşamaktadır.',
        defaultReason: language === 'RU' ? 'Колебания биржевых цен на медь и сырье' : 'Bakır & Hammadde Borsa Endeksi'
      };
    }

    return {
      cluster: 'GENERAL' as const,
      badge: language === 'RU' ? '📊 Рыночные факторы / Инфляция' : '📊 Piyasa Faktörleri & Tedarikçi Fiyatı',
      explanation: language === 'RU'
        ? 'Повышение может быть связано с индексацией прайс-листа поставщика, изменением объема партии или срочностью поставки.'
        : 'Fiyat artışı tedarikçi genel fiyat listesi güncellemesi, parti büyüklüğü veya acil tedarik koşullarından kaynaklanıyor olabilir.',
      defaultReason: language === 'RU' ? 'Плановое обновление прайса поставщика' : 'Piyasa Koşulları / Tedarikçi Fiyat Güncellemesi'
    };
  };

  // Generate Anomalies dynamically from invoices, discounts, and comparison records
  const allAlerts: AnomalyAlert[] = useMemo(() => {
    const list: AnomalyAlert[] = [];

    // Filter out services/transport
    const isServiceItem = (name: string, category: string) => {
      const n = (name || '').toLowerCase();
      const c = (category || '').toLowerCase();
      return (
        c.includes('hizmet') || c.includes('lojistik') || c.includes('nakliye') || c.includes('taşıma') || c.includes('tasima') ||
        n.includes('доставк') || n.includes('транспорт') || n.includes('услуг') ||
        n.includes('погрузк') || n.includes('разгрузк') || n.includes('перевозк') ||
        n.includes('nakliye') || n.includes('taşıma') || n.includes('tasima') || n.includes('kargo')
      );
    };

    // Helper: Verify that two history rows represent strictly the same "elma-elma" material in the original Russian invoice text AND belong to the same Brand/Quality Segment (unless it's a GOST/DIN Commodity)
    const areHistoryEntriesStrictlyEquivalent = (a: any, b: any, matName: string, category?: string): boolean => {
      if (!a || !b) return false;
      const pA = Number(a.normalizedUnitPrice || a.unitPrice || 0);
      const pB = Number(b.normalizedUnitPrice || b.unitPrice || 0);
      if (pA <= 0 || pB <= 0) return false;

      // 0. Smart Commodity vs. Brand/Quality Segment Gate ("Demir demirdir, ama Mercedes ile Lada kıyaslanmaz")
      if (!areMaterialSegmentsCompatible(a, b, matName, category)) {
        return false;
      }

      const origA = String(a.originalName || '').toLowerCase().replace(/,/g, '.');
      const origB = String(b.originalName || '').toLowerCase().replace(/,/g, '.');
      const combA = `${origA} ${matName.toLowerCase()}`;
      const combB = `${origB} ${matName.toLowerCase()}`;

      // 1. Conflicting product sub-types in original Russian text must never be compared
      const incompatiblePairs: Array<[RegExp, RegExp]> = [
        [/тахеометр|leica|зарядн|трегер/i, /гипсокартон|гипрок|gyproc|гкл\b/i],
        [/лента|ультранеодил|бандажн/i, /рулон|эпп|экп|техноэласт|изопласт|виллатекс/i],
        [/шпонка|гидрошпонк|waterbar/i, /мембран|эпп|экп|техноэласт|изопласт|виллатекс/i],
        [/sikaplan|пвх.*мембран|мембран.*пвх/i, /эпп|экп|техноэласт|изопласт|виллатекс|битум/i],
        [/паста|финиш/i, /штукатурк.*30\s*кг|ротбанд\s*30/i],
        [/куртка/i, /костюм/i],
        [/охран/i, /рабоч|итр/i],
        [/бетонн|кость/i, /звездочк|стульчик|пластик/i],
        [/связь|аренда/i, /элемент.*ригель|ригель/i],
        [/широкоформатн|плоттер|914\s*мм|610\s*мм/i, /а4|a4|а3|a3|500\s*л|светокопи|svetocopy/i],
        [/станция|перекачк|насос/i, /^дизельное\s*топливо|^mazot$/i],
      ];
      for (const [rx1, rx2] of incompatiblePairs) {
        if ((rx1.test(combA) && rx2.test(combB)) || (rx2.test(combA) && rx1.test(combB))) {
          return false;
        }
      }

      // 2. If both rows have genuine Russian descriptions, check metric / thickness / diameter consistency
      const cleanDescA = origA.replace(/к\.?\s*п\.?\s*\d+(?:\.\d+)?/gi, ' ');
      const cleanDescB = origB.replace(/к\.?\s*п\.?\s*\d+(?:\.\d+)?/gi, ' ');
      const metricA = cleanDescA.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(\d{1,2})(?![0-9])/i)?.[1];
      const metricB = cleanDescB.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(\d{1,2})(?![0-9])/i)?.[1];
      if (metricA && metricB && metricA !== metricB) return false;

      // 3. Guard against residual pack-vs-piece or unit conversion artifacts (> 250% spread) unless Russian headwords match
      const ratio = Math.max(pA, pB) / Math.min(pA, pB);
      if (ratio > 3.5) {
        const cyrWordsA = (cleanDescA.match(/[а-яё]{4,}/gi) || []).map(w => w.slice(0, 5));
        const cyrWordsB = new Set((cleanDescB.match(/[а-яё]{4,}/gi) || []).map(w => w.slice(0, 5)));
        const sharedRoots = cyrWordsA.filter(w => cyrWordsB.has(w));
        if (sharedRoots.length === 0) return false;
      }

      return true;
    };

    // 1. Same Supplier Price Hike Detection (Canonical Elma-Elma Normalized Comparisons)
    comparisons.forEach((comp) => {
      if (!comp || !comp.materialName || !Array.isArray(comp.history) || comp.history.length < 2) return;
      if (isServiceItem(comp.materialName, comp.category)) return;
      if (isExemptFromBenchmarkAudit(comp.materialName, comp.category).isExempt) return;

      const byVendor: Record<string, any[]> = {};
      comp.history.forEach((h: any) => {
        const sup = (h.supplier || '').trim();
        if (!sup || !h.unitPrice || h.unitPrice <= 0) return;
        const vKey = sup.toLowerCase();
        if (!byVendor[vKey]) byVendor[vKey] = [];
        byVendor[vKey].push(h);
      });

      const mappedHistoryRows = comp.history.map((h: any) => ({
        date: (h.date || '').split('T')[0],
        invoiceNo: h.invoiceNumber || 'Fatura',
        supplier: h.supplier || 'Tedarikçi',
        jobsiteName: h.jobsiteName || 'Genel Şantiye',
        quantity: Number(h.normalizedQuantity || h.quantity || 1),
        unit: comp.standardUnit || comp.unit || h.unit || 'Adet',
        unitPrice: Number(h.normalizedUnitPrice || h.unitPrice || 0),
        originalName: ensureRussianOriginalName(comp.materialName, h.originalName),
        conversionFormula: h.conversionFormula
      }));

      Object.values(byVendor).forEach((vHist) => {
        if (vHist.length < 2) return;
        const sorted = [...vHist].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const first = sorted[0];
        const latest = sorted[sorted.length - 1];
        if (!areHistoryEntriesStrictlyEquivalent(first, latest, comp.materialName, comp.category)) return;
        const prevPrice = Number(first.normalizedUnitPrice || first.unitPrice || 0);
        const currPrice = Number(latest.normalizedUnitPrice || latest.unitPrice || 0);
        const currQty = Number(latest.normalizedQuantity || latest.quantity || 1);

        if (prevPrice > 0 && currPrice > prevPrice) {
          const priceDiff = currPrice - prevPrice;
          const pctIncrease = Number(((priceDiff / prevPrice) * 100).toFixed(1));
          const totalImpact = Math.round(priceDiff * currQty);

          if (pctIncrease >= 5 && totalImpact >= 500) {
            const marketInfo = getMarketIntelligence(comp.materialName, comp.category);
            const stdUnit = comp.standardUnit || comp.unit || latest.unit || 'Adet';
            list.push({
              id: `same_vendor_hike_${latest.invoiceNumber || 'inv'}_${comp.id || comp.materialName.replace(/\s+/g, '_')}`,
              type: 'SAME_VENDOR_INFLATION',
              severity: pctIncrease >= 15 ? 'CRITICAL' : 'WARNING',
              title: language === 'RU'
                ? `Повышение цены у того же поставщика: ${latest.supplier} (+%${pctIncrease})`
                : `Aynı Firmadan Fiyat Artışı: ${latest.supplier} (+%${pctIncrease} Zam)`,
              materialName: comp.materialName,
              russianSubtitle: ensureRussianOriginalName(comp.materialName, latest.originalName || first.originalName),
              category: comp.category,
              vendorName: latest.supplier,
              jobsiteName: latest.jobsiteName,
              previousPrice: prevPrice,
              currentPrice: currPrice,
              minUnitPrice: comp.minUnitPrice,
              maxUnitPrice: comp.maxUnitPrice,
              avgUnitPrice: comp.avgUnitPrice,
              percentageChange: pctIncrease,
              financialImpact: totalImpact,
              dateStr: (latest.date || '').split('T')[0],
              invoiceNo: latest.invoiceNumber,
              quantity: currQty,
              unit: stdUnit,
              historyRows: mappedHistoryRows,
              marketCluster: marketInfo.cluster,
              description: language === 'RU'
                ? `Цена за единицу (${stdUnit}) материала "${comp.materialName}" у поставщика "${latest.supplier}" выросла с ${formatRuble(prevPrice)} (${(first.date || '').split('T')[0]}) до ${formatRuble(currPrice)} (${(latest.date || '').split('T')[0]}) (+${pctIncrease}%).`
                : `"${latest.supplier}" firmasından alınan "${comp.materialName}" malzemesinin standart birim fiyatı (${stdUnit}) ${(first.date || '').split('T')[0]} tarihli alımda ${formatRuble(prevPrice)}/${stdUnit} iken, ${(latest.date || '').split('T')[0]} tarihli faturada ${formatRuble(currPrice)}/${stdUnit} seviyesine yükselmiştir (+%${pctIncrease} artış).`,
              recommendation: language === 'RU'
                ? `Проверьте рыночные котировки и потребуйте у поставщика возврата к прежней цене ${formatRuble(prevPrice)}/${stdUnit}.`
                : `Tedarikçi ile önceki anlaşma fiyatı olan ${formatRuble(prevPrice)}/${stdUnit} baz alınarak revize iskonto talep edilmelidir.`
            });
          }
        }
      });
    });

    // 2. Elma-Elma Malzeme Fiyat Farkı & Şantiyeler / Tedarikçiler Arası Sapma Tespiti
    comparisons.forEach((comp, idx) => {
      if (!comp || !comp.materialName || !Array.isArray(comp.history) || comp.history.length < 2) return;
      if (isServiceItem(comp.materialName, comp.category)) return;
      if (isExemptFromBenchmarkAudit(comp.materialName, comp.category).isExempt) return;

      if (comp.priceDifferencePercentage >= 5 && comp.minUnitPrice > 0) {
        const stdUnit = comp.standardUnit || comp.unit || 'Adet';
        const sortedByPrice = [...comp.history].sort((a, b) => Number(a.unitPrice) - Number(b.unitPrice));
        const cheapestRec = sortedByPrice[0];
        const priciestRec = sortedByPrice[sortedByPrice.length - 1];
        if (!areHistoryEntriesStrictlyEquivalent(cheapestRec, priciestRec, comp.materialName, comp.category)) return;

        // Calculate actual financial overpayment of purchases above minUnitPrice
        const actualOverpayment = comp.history.reduce((sum: number, h: any) => {
          const uPrice = Number(h.normalizedUnitPrice || h.unitPrice || 0);
          const uQty = Number(h.normalizedQuantity || h.quantity || 1);
          if (uPrice > comp.minUnitPrice) {
            return sum + (uPrice - comp.minUnitPrice) * uQty;
          }
          return sum;
        }, 0);

        const totalImpact = Math.max(Math.round(actualOverpayment), Math.round((comp.maxUnitPrice - comp.minUnitPrice) * (priciestRec?.quantity || 1)));
        if (totalImpact < 300) return;

        const cleanMatName = comp.materialName.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇа-яА-Я]/g, '_');
        const alertId = comp.id
          ? `jobsite_gap_${comp.id}_${idx}`
          : `jobsite_gap_${cleanMatName}_${stdUnit.replace(/\s+/g, '_')}_${idx}`;

        const mappedHistoryRows = comp.history.map((h: any) => ({
          date: (h.date || '').split('T')[0],
          invoiceNo: h.invoiceNumber || 'Fatura',
          supplier: h.supplier || 'Tedarikçi',
          jobsiteName: h.jobsiteName || 'Genel Şantiye',
          quantity: Number(h.normalizedQuantity || h.quantity || 1),
          unit: stdUnit,
          unitPrice: Number(h.normalizedUnitPrice || h.unitPrice || 0),
          originalName: ensureRussianOriginalName(comp.materialName, h.originalName),
          conversionFormula: h.conversionFormula
        }));

        list.push({
          id: alertId,
          type: 'JOBSITE_PRICE_GAP',
          severity: comp.priceDifferencePercentage >= 20 ? 'CRITICAL' : 'WARNING',
          title: language === 'RU'
            ? `Разница цен на один и тот же материал: +%${comp.priceDifferencePercentage}`
            : `Elma-Elma Malzeme Fiyat Farkı: +%${comp.priceDifferencePercentage} Sapma (${comp.history.length} Alım)`,
          materialName: comp.materialName,
          russianSubtitle: ensureRussianOriginalName(comp.materialName, priciestRec?.originalName || cheapestRec?.originalName),
          category: comp.category,
          vendorName: `${cheapestRec?.supplier || comp.cheapestJobsiteName} (${formatRuble(comp.minUnitPrice)}) ⟷ ${priciestRec?.supplier || comp.priciestJobsiteName} (${formatRuble(comp.maxUnitPrice)})`,
          jobsiteName: priciestRec?.jobsiteName || comp.priciestJobsiteName,
          previousPrice: comp.minUnitPrice,
          currentPrice: comp.maxUnitPrice,
          minUnitPrice: comp.minUnitPrice,
          maxUnitPrice: comp.maxUnitPrice,
          avgUnitPrice: comp.avgUnitPrice,
          percentageChange: comp.priceDifferencePercentage,
          financialImpact: totalImpact,
          dateStr: (priciestRec?.date || new Date().toISOString()).split('T')[0],
          invoiceNo: priciestRec?.invoiceNumber,
          unit: stdUnit,
          historyRows: mappedHistoryRows,
          marketCluster: 'LOGISTICS_GAP',
          description: language === 'RU'
            ? `Материал "${comp.materialName}" (${stdUnit}) закупался на объекте "${cheapestRec?.jobsiteName || comp.cheapestJobsiteName}" у "${cheapestRec?.supplier || '-'}" по цене ${formatRuble(comp.minUnitPrice)}/${stdUnit}, а на объекте "${priciestRec?.jobsiteName || comp.priciestJobsiteName}" у "${priciestRec?.supplier || '-'}" по цене ${formatRuble(comp.maxUnitPrice)}/${stdUnit} (+%${comp.priceDifferencePercentage}).`
            : `Birebir aynı teknik özellikteki "${comp.materialName}" malzemesi (${stdUnit} bazında normalize edilmiş elma-elma kıyas) en uygun "${cheapestRec?.jobsiteName || comp.cheapestJobsiteName}" şantiyesinde "${cheapestRec?.supplier || '-'}" firmasından ${formatRuble(comp.minUnitPrice)}/${stdUnit} fiyata alınmışken, "${priciestRec?.jobsiteName || comp.priciestJobsiteName}" şantiyesinde "${priciestRec?.supplier || '-'}" firmasından ${formatRuble(comp.maxUnitPrice)}/${stdUnit} fiyata alınmıştır (+%${comp.priceDifferencePercentage} fiyat farkı).`,
          recommendation: language === 'RU'
            ? `Рекомендуется закупать данный материал через поставщика "${cheapestRec?.supplier || comp.cheapestJobsiteName}" по базовой цене ${formatRuble(comp.minUnitPrice)}/${stdUnit}.`
            : `Sonraki siparişlerde en düşük birim fiyatı veren "${cheapestRec?.supplier || comp.cheapestJobsiteName}" (${formatRuble(comp.minUnitPrice)}/${stdUnit}) referans alınarak alım yapılmalıdır.`
        });
      }
    });

    // 3. High-Value Purchases with 0% Discount
    discounts.forEach(dsc => {
      if (isServiceItem(dsc.category || '', dsc.category || '')) return;
      if (dsc.discountPercentage === 0 && dsc.offerPrice >= 500000) {
        list.push({
          id: `zero_discount_${dsc.id}`,
          type: 'ZERO_DISCOUNT_HIGH_VALUE',
          severity: 'WARNING',
          title: language === 'RU'
            ? 'Крупный заказ без скидки (0% скидка)'
            : 'Sıfır Pazarlık / İndirimsiz Büyük Sipariş Uyarısı',
          materialName: language === 'RU' ? `Закупка: ${dsc.category}` : `${dsc.category} Tedarik Siparişi`,
          category: dsc.category,
          vendorName: dsc.vendorName,
          jobsiteName: dsc.jobsiteName,
          previousPrice: dsc.offerPrice,
          currentPrice: dsc.offerPrice,
          percentageChange: 0,
          financialImpact: Math.round(dsc.offerPrice * 0.08), // potential 8% discount
          dateStr: dsc.orderDate,
          marketCluster: 'GENERAL',
          description: language === 'RU'
            ? `Для объекта "${dsc.jobsiteName}" оформлен крупный заказ у компании "${dsc.vendorName}" на сумму ${formatRuble(dsc.offerPrice)}, но скидка от прайса составила 0%.`
            : `"${dsc.jobsiteName}" şantiyesi için "${dsc.vendorName}" firmasından ${formatRuble(dsc.offerPrice)} tutarında yüksek bütçeli alım yapıldı ancak liste fiyatı üzerinden hiç indirim (%0) alınmadı.`,
          recommendation: language === 'RU'
            ? `Для заказов такого объема ожидается скидка от 5% до 12%. Рекомендуется запросить пересмотр у ответственного шефа.`
            : `Bu ölçekteki siparişlerde standart en az %5 - %12 pazarlık indirimi beklenmektedir. Satınalma şefinden geriye dönük proforma revizyonu istenebilir.`
        });
      }
    });

    // 5. İnsandan Üstün Yapay Zeka Satınalma Beyni (4 Gizli Anomali Motoru)
    const superAnomalies = detectSuperIntelligentProcurementAnomalies(invoices, discounts, comparisons);
    superAnomalies.forEach(sa => {
      if (!list.some(item => item.id === sa.id)) {
        list.push({
          id: sa.id,
          type: sa.type as AnomalyAlert['type'],
          severity: sa.severity,
          title: sa.title,
          materialName: sa.materialName || sa.category || 'Malzeme',
          category: sa.category || 'Genel',
          vendorName: sa.supplier || sa.vendorName || 'Tedarikçi Firma',
          jobsiteName: sa.jobsiteName,
          percentageChange: sa.percentageChange || 0,
          financialImpact: sa.impactAmount,
          dateStr: sa.date,
          marketCluster: 'GENERAL',
          description: sa.evidence && sa.evidence.length > 0 ? sa.evidence.join(' • ') : sa.title,
          recommendation: sa.recommendation
        });
      }
    });

    // Sort by severity (CRITICAL first), then financial impact
    return list.sort((a, b) => {
      const sevOrder = { CRITICAL: 1, WARNING: 2, INFO: 3 };
      if (sevOrder[a.severity] !== sevOrder[b.severity]) {
        return sevOrder[a.severity] - sevOrder[b.severity];
      }
      return b.financialImpact - a.financialImpact;
    });
  }, [invoices, discounts, comparisons, language]);

  // Handle Manager Acknowledge (Dismiss from active view)
  const handleAcknowledgeAlert = async (alert: AnomalyAlert, reasonParam?: string, noteParam?: string) => {
    const market = getMarketIntelligence(alert.materialName, alert.category);
    const finalReason = reasonParam || selectedReason || market.defaultReason;
    const finalNote = noteParam !== undefined ? noteParam : managerNote;
    const ackData: AnomalyAcknowledgement = {
      anomalyId: alert.id,
      acknowledgedBy: user?.name || (language === 'RU' ? 'Руководитель' : 'Yönetici'),
      acknowledgedAt: new Date().toISOString(),
      reason: finalReason,
      note: finalNote,
      materialName: alert.materialName,
      vendorName: alert.vendorName,
      jobsiteName: alert.jobsiteName,
      financialImpact: alert.financialImpact
    };

    // 1. Update state immediately
    setAcknowledgedMap(prev => {
      const updated = { ...prev, [alert.id]: ackData };
      try {
        localStorage.setItem(LOCAL_STORAGE_ACK_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    // 2. Close modal if open
    if (selectedAlertForDetail?.id === alert.id) {
      setSelectedAlertForDetail(null);
    }
    setSelectedReason('');
    setManagerNote('');

    showToast(
      language === 'RU'
        ? `Аномалия "${alert.materialName}" подтверждена руководителем и перенесена в архив.`
        : `"${alert.materialName}" anomalisi yönetici tarafından onaylandı ve arşive kaldırıldı.`
    );

    // 3. Persist to server in background
    try {
      await fetch('/api/anomalies/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ackData)
      });
    } catch (err) {
      console.warn('[ANOMALY] Error saving acknowledgement to server:', err);
    }
  };

  // Handle Unacknowledge (Restore back to active view)
  const handleUnacknowledgeAlert = async (anomalyId: string) => {
    setAcknowledgedMap(prev => {
      const updated = { ...prev };
      delete updated[anomalyId];
      try {
        localStorage.setItem(LOCAL_STORAGE_ACK_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    if (selectedAlertForDetail?.id === anomalyId) {
      setSelectedAlertForDetail(null);
    }

    showToast(
      language === 'RU'
        ? 'Предупреждение возвращено в список активных аномалий.'
        : 'Anomali kaydı tekrar aktif inceleme listesine taşındı.'
    );

    try {
      await fetch('/api/anomalies/unacknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anomalyId })
      });
    } catch (err) {
      console.warn('[ANOMALY] Error unacknowledging on server:', err);
    }
  };

  // Separate active vs acknowledged
  const activeAlerts = useMemo(() => {
    return allAlerts.filter(a => !acknowledgedMap[a.id]);
  }, [allAlerts, acknowledgedMap]);

  const archivedAlerts = useMemo(() => {
    return allAlerts.filter(a => !!acknowledgedMap[a.id]);
  }, [allAlerts, acknowledgedMap]);

  // Current list based on active view tab
  const currentList = activeViewTab === 'ACTIVE' ? activeAlerts : archivedAlerts;

  // Filtered alerts
  const filteredAlerts = useMemo(() => {
    return currentList
      .filter(a => {
        const matchesType = selectedType === 'ALL' || a.type === selectedType;
        const matchesSev = selectedSeverity === 'ALL' || a.severity === selectedSeverity;
        const matchesJobsite =
          selectedJobsite === 'ALL' ||
          (a.jobsiteName && a.jobsiteName.toLowerCase() === selectedJobsite.toLowerCase());
        const term = searchTerm.toLowerCase().trim();
        const matchesSearch =
          term === '' ||
          a.materialName.toLowerCase().includes(term) ||
          a.vendorName.toLowerCase().includes(term) ||
          (a.jobsiteName && a.jobsiteName.toLowerCase().includes(term)) ||
          a.description.toLowerCase().includes(term);

        return matchesType && matchesSev && matchesJobsite && matchesSearch;
      })
      .sort((a, b) => {
        if (sortBy === 'IMPACT') return b.financialImpact - a.financialImpact;
        if (sortBy === 'PERCENTAGE') return b.percentageChange - a.percentageChange;
        if (sortBy === 'DATE') return new Date(b.dateStr).getTime() - new Date(a.dateStr).getTime();
        return 0;
      });
  }, [currentList, selectedType, selectedSeverity, selectedJobsite, searchTerm, sortBy]);

  // KPI Calculations (based on active anomalies only)
  const activeCriticalCount = activeAlerts.filter(a => a.severity === 'CRITICAL').length;
  const activeWarningCount = activeAlerts.filter(a => a.severity === 'WARNING').length;
  const activeTotalRisk = activeAlerts.reduce((acc, a) => acc + a.financialImpact, 0);
  const archivedCount = archivedAlerts.length;

  // Get historical purchase records for selected material in the detail modal
  const materialPurchaseHistory = useMemo(() => {
    if (!selectedAlertForDetail) return [];

    // 1. Prefer canonical normalized history rows from comparisons
    if (selectedAlertForDetail.historyRows && selectedAlertForDetail.historyRows.length > 0) {
      return selectedAlertForDetail.historyRows.map(r => {
        const matchedInv = invoices.find(
          inv => (inv.invoiceNumber || (inv as any).invoiceNo || '').trim().toLowerCase() === (r.invoiceNo || '').trim().toLowerCase()
        );
        const isTrigger =
          selectedAlertForDetail.invoiceNo === r.invoiceNo &&
          Math.abs(r.unitPrice - (selectedAlertForDetail.currentPrice || 0)) < 0.5;
        return {
          date: r.date,
          invoiceNo: r.invoiceNo,
          supplier: r.supplier,
          jobsiteName: r.jobsiteName,
          quantity: r.quantity,
          unit: r.unit,
          unitPrice: r.unitPrice,
          totalPrice: r.quantity * r.unitPrice,
          isCurrentTrigger: isTrigger,
          invoice: matchedInv
        };
      }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const targetName = selectedAlertForDetail.materialName.toLowerCase().trim();
    const matchedComp = comparisons.find(c => c.materialName.toLowerCase().trim() === targetName);
    if (matchedComp && Array.isArray(matchedComp.history) && matchedComp.history.length > 0) {
      return matchedComp.history.map((h: any) => {
        const invNo = h.invoiceNumber || 'Fatura';
        const matchedInv = invoices.find(
          inv => (inv.invoiceNumber || (inv as any).invoiceNo || '').trim().toLowerCase() === invNo.trim().toLowerCase()
        );
        const uPrice = Number(h.normalizedUnitPrice || h.unitPrice || 0);
        const uQty = Number(h.normalizedQuantity || h.quantity || 1);
        return {
          date: (h.date || '').split('T')[0],
          invoiceNo: invNo,
          supplier: h.supplier || 'Tedarikçi',
          jobsiteName: h.jobsiteName || 'Genel',
          quantity: uQty,
          unit: matchedComp.standardUnit || matchedComp.unit || h.unit || 'Adet',
          unitPrice: uPrice,
          totalPrice: uPrice * uQty,
          isCurrentTrigger: selectedAlertForDetail.invoiceNo === invNo,
          invoice: matchedInv
        };
      }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    const historyRows: {
      date: string;
      invoiceNo: string;
      supplier: string;
      jobsiteName: string;
      quantity: number;
      unit: string;
      unitPrice: number;
      totalPrice: number;
      isCurrentTrigger: boolean;
      invoice?: InvoiceRecord;
    }[] = [];

    invoices.forEach(inv => {
      if (!inv || !Array.isArray(inv.items)) return;
      const supplierName = (inv.supplier || (inv as any).vendorName || 'Tedarikçi').trim();
      const invNo = inv.invoiceNumber || (inv as any).invoiceNo || 'Fatura';

      inv.items.forEach(item => {
        if (!item || !item.materialName) return;
        const itmName = item.materialName.toLowerCase().trim();
        if (itmName === targetName) {
          const isTrigger =
            selectedAlertForDetail.invoiceNo === invNo &&
            Math.abs((Number(item.unitPrice) || 0) - (selectedAlertForDetail.currentPrice || 0)) < 0.1;

          historyRows.push({
            date: inv.date || '',
            invoiceNo: invNo,
            supplier: supplierName,
            jobsiteName: inv.jobsiteName || 'Genel',
            quantity: Number(item.quantity) || 1,
            unit: item.unit || 'Adet',
            unitPrice: Number(item.unitPrice) || 0,
            totalPrice: Number(item.totalPrice) || ((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0)),
            isCurrentTrigger: isTrigger,
            invoice: inv
          });
        }
      });
    });

    // Sort chronologically descending (newest first)
    return historyRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [selectedAlertForDetail, invoices, comparisons]);

  // List of unique jobsites for filtering
  const availableJobsites = useMemo(() => {
    const set = new Set<string>();
    jobsites.forEach(j => {
      if (j.name) set.add(j.name);
    });
    allAlerts.forEach(a => {
      if (a.jobsiteName) set.add(a.jobsiteName);
    });
    return Array.from(set);
  }, [jobsites, allAlerts]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-emerald-500/40 flex items-center space-x-3 text-sm font-semibold animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & High-Level Executive Banner */}
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950 rounded-3xl p-6 sm:p-8 text-white shadow-xl border border-rose-900/40 relative overflow-hidden">
        <div className="absolute -right-16 -bottom-16 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-1/4 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-rose-400 text-xs font-black uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4" />
              <span>
                {language === 'RU'
                  ? 'Радар аномалий цен и система контроля рисков закупок'
                  : 'Kurumsal Anomali & Fiyat Sapması Radar Sistemi'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center space-x-3">
              <span>{t('anomalyTitle')}</span>
              <span className="text-xs font-bold px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                <span>{language === 'RU' ? 'Онлайн мониторинг' : 'Canlı Radar'}</span>
              </span>
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed font-medium">
              {language === 'RU'
                ? 'Система автоматически выявляет рост цен от одних и тех же поставщиков, ценовые разрывы между объектами и закупки без скидок. Руководитель может подтвердить и закрыть обоснованные отклонения.'
                : 'Aynı tedarikçiden yapılan zamlar, şantiyeler arası fiyat uçurumları ve pazarlıksız alımlar anında radarınıza girer. Yönetici olarak gerekçesini inceleyebilir veya bilinen piyasa dalgalanmalarını onaylayıp arşivleyebilirsiniz.'}
            </p>
          </div>

          {/* KPI Mini Dashboards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-3 sm:p-3.5 rounded-2xl text-center">
              <p className="text-[10px] text-slate-400 font-semibold uppercase">
                {language === 'RU' ? 'Активные аномалии' : 'Aktif Sapmalar'}
              </p>
              <p className="text-xl sm:text-2xl font-black text-rose-400 font-mono mt-0.5">
                {activeAlerts.length}
              </p>
            </div>

            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-3 sm:p-3.5 rounded-2xl text-center">
              <p className="text-[10px] text-slate-400 font-semibold uppercase">
                {language === 'RU' ? 'Критический рост (≥12%)' : 'Kritik Zamlar'}
              </p>
              <p className="text-xl sm:text-2xl font-black text-amber-400 font-mono mt-0.5">
                {activeCriticalCount}
              </p>
            </div>

            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-3 sm:p-3.5 rounded-2xl text-center">
              <p className="text-[10px] text-slate-400 font-semibold uppercase">
                {language === 'RU' ? 'Финансовый риск' : 'Bütçe Riski'}
              </p>
              <p className="text-base sm:text-lg font-black text-amber-300 font-mono mt-1">
                {formatRuble(activeTotalRisk)}
              </p>
            </div>

            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 p-3 sm:p-3.5 rounded-2xl text-center">
              <p className="text-[10px] text-slate-400 font-semibold uppercase">
                {language === 'RU' ? 'Одобрено / В архиве' : 'Yönetici Onaylı'}
              </p>
              <p className="text-xl sm:text-2xl font-black text-emerald-400 font-mono mt-0.5">
                {archivedCount}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Mode Toggle: Active Radar vs Manager Approved Archive */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveViewTab('ACTIVE')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center space-x-2 cursor-pointer ${
              activeViewTab === 'ACTIVE'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-200'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>{language === 'RU' ? 'Активные аномалии' : '🚨 İncelenecek Aktif Anomaliler'}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                activeViewTab === 'ACTIVE' ? 'bg-rose-800 text-rose-100' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {activeAlerts.length}
            </span>
          </button>

          <button
            onClick={() => setActiveViewTab('ARCHIVED')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center space-x-2 cursor-pointer ${
              activeViewTab === 'ARCHIVED'
                ? 'bg-emerald-700 text-white shadow-md shadow-emerald-200'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Archive className="w-4 h-4" />
            <span>{language === 'RU' ? 'Одобренные руководителем (Архив)' : '✅ Yönetici Onaylı / Bilinenler (Arşiv)'}</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                activeViewTab === 'ARCHIVED' ? 'bg-emerald-900 text-emerald-100' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {archivedCount}
            </span>
          </button>
        </div>

        {activeViewTab === 'ACTIVE' && activeAlerts.length > 0 && (
          <p className="text-xs text-slate-500 font-medium">
            💡 {language === 'RU'
              ? 'Нажмите "Подтвердить", чтобы закрыть обоснованные отклонения.'
              : 'Yönetici olarak bilinen emtia/demir artışlarını tek tıkla onaylayıp listeden kaldırabilirsiniz.'}
          </p>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={
              language === 'RU'
                ? 'Поиск по материалу, поставщику, объекту или описанию...'
                : 'Malzeme, Tedarikçi, Şantiye adı veya gerekçe ara...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 font-medium text-slate-900 placeholder:text-slate-400"
          />
        </div>

        {/* Filters and Sort */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Anomaly Type */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="ALL">{t('allAnomalyTypes')}</option>
              <option value="CROSS_JOBSITE_ARBITRAGE">{language === 'RU' ? '🔄 Арбитраж цен между объектами' : '🔄 Çapraz Şantiye Fiyat Arbitrajı'}</option>
              <option value="SPLIT_INVOICE_SMURFING">{language === 'RU' ? '✂️ Дробление заказов (Smurfing)' : '✂️ Eşik Atlatma & Parçalı Alım'}</option>
              <option value="PRICE_CREEP">{language === 'RU' ? '📈 Ползучий рост цен (Price Creep)' : '📈 Sinsi Fiyat Artışı (Price Creep)'}</option>
              <option value="BASKET_SHRINKAGE">{language === 'RU' ? '🧺 Сокращение корзины / Мнимые скидки' : '🧺 Sepet Küçültme & Fiktif İndirim'}</option>
              <option value="SAME_VENDOR_INFLATION">{t('sameVendorHike')}</option>
              <option value="JOBSITE_PRICE_GAP">{t('jobsiteGap')}</option>
              <option value="ZERO_DISCOUNT_HIGH_VALUE">{t('zeroDiscountBigOrder')}</option>
            </select>
          </div>

          {/* Severity */}
          <div className="flex items-center space-x-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="ALL">{t('allRiskLevels')}</option>
              <option value="CRITICAL">{t('criticalHikesOnly')}</option>
              <option value="WARNING">{t('mediumWarning')}</option>
            </select>
          </div>

          {/* Jobsite Filter */}
          <div className="flex items-center space-x-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedJobsite}
              onChange={(e) => setSelectedJobsite(e.target.value)}
              className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="ALL">{language === 'RU' ? 'Все объекты' : 'Tüm Şantiyeler'}</option>
              {availableJobsites.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center space-x-1.5 border-l border-slate-200 pl-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500 cursor-pointer"
            >
              <option value="IMPACT">{language === 'RU' ? 'По сумме риска (₽)' : 'Bütçe Riskine Göre'}</option>
              <option value="PERCENTAGE">{language === 'RU' ? 'По % повышения' : 'Zam Oranına Göre'}</option>
              <option value="DATE">{language === 'RU' ? 'По дате' : 'Tarihe Göre'}</option>
            </select>
          </div>
        </div>
      </div>

      {/* ALERT CARDS LIST */}
      <div className="space-y-4">
        {filteredAlerts.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm space-y-4">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-100">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                {activeViewTab === 'ACTIVE'
                  ? (language === 'RU'
                      ? 'Внимание! Активных нерассмотренных аномалий не найдено'
                      : 'Mükemmel! Bekleyen Aktif Fiyat Sapması Bulunmuyor')
                  : (language === 'RU'
                      ? 'В архиве пока нет подтвержденных аномалий'
                      : 'Arşivde henüz yönetici tarafından onaylanmış kayıt bulunmuyor')}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto">
                {activeViewTab === 'ACTIVE'
                  ? (language === 'RU'
                      ? 'Все цены соответствуют нормам или обоснованные аномалии уже подтверждены руководителем.'
                      : 'Tüm satınalma birim fiyatları olağan sınırlar dahilindedir veya bilinen sapmalar yönetici tarafından onaylanıp arşivlenmiştir.')
                  : (language === 'RU'
                      ? 'Активные аномалии после нажатия "Подтвердить" будут перемещены в этот раздел.'
                      : 'Aktif listeden inceleyip onayladığınız fiyat artışları bu bölümde saklanacaktır.')}
              </p>
            </div>
          </div>
        ) : (
          filteredAlerts.map((alert, alertIdx) => {
            const isCritical = alert.severity === 'CRITICAL';
            const ack = acknowledgedMap[alert.id];
            const isAcknowledged = !!ack;
            const market = getMarketIntelligence(alert.materialName, alert.category);

            return (
              <div
                key={`${alert.id}_${alertIdx}`}
                className={`bg-white rounded-2xl border p-5 sm:p-6 shadow-sm transition-all hover:shadow-md relative overflow-hidden ${
                  isAcknowledged
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : isCritical
                    ? 'border-rose-300 bg-rose-50/10 hover:border-rose-400'
                    : 'border-amber-200 bg-amber-50/10 hover:border-amber-300'
                }`}
              >
                {/* Left Severity Indicator Strip */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-2.5 ${
                    isAcknowledged ? 'bg-emerald-600' : isCritical ? 'bg-rose-600' : 'bg-amber-500'
                  }`}
                />

                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5 pl-2">
                  {/* Left Main Content */}
                  <div className="space-y-3 flex-1">
                    {/* Tags row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border flex items-center space-x-1.5 ${
                          isAcknowledged
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : isCritical
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}
                      >
                        {isAcknowledged ? (
                          <>
                            <ShieldCheck className="w-3 h-3 text-emerald-700" />
                            <span>{language === 'RU' ? 'ОДОБРЕНО РУКОВОДИТЕЛЕМ' : 'YÖNETİCİ ONAYLADI / BİLİNİYOR'}</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-3 h-3" />
                            <span>
                              {isCritical
                                ? (language === 'RU' ? 'КРИТИЧЕСКИЙ РОСТ ЦЕНЫ' : 'KRİTİK FİYAT ZAMMI')
                                : (language === 'RU' ? 'ПРЕДУПРЕЖДЕНИЕ ОБ АНОМАЛИИ' : 'FİYAT SAPMA UYARISI')}
                            </span>
                          </>
                        )}
                      </span>

                      {alert.type === 'CROSS_JOBSITE_ARBITRAGE' && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center space-x-1">
                          <span>🔄 {language === 'RU' ? 'КРОСС-ОБЪЕКТНЫЙ АРБИТРАЖ' : 'ÇAPRAZ ŞANTİYE ARBİTRAJI'}</span>
                        </span>
                      )}
                      {alert.type === 'SPLIT_INVOICE_SMURFING' && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-200 flex items-center space-x-1">
                          <span>✂️ {language === 'RU' ? 'ДРОБЛЕНИЕ ЗАКАЗА (SMURFING)' : 'EŞİK ATLATMA (PARÇALI ALIM)'}</span>
                        </span>
                      )}
                      {alert.type === 'PRICE_CREEP' && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1">
                          <span>📈 {language === 'RU' ? 'СКРЫТЫЙ РОСТ ЦЕН (CREEP)' : 'SİNSİ FİYAT ARTIŞI'}</span>
                        </span>
                      )}
                      {alert.type === 'BASKET_SHRINKAGE' && (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center space-x-1">
                          <span>🧺 {language === 'RU' ? 'СОКРАЩЕНИЕ КОРЗИНЫ' : 'SEPET KÜÇÜLTME (FİKTİF İNDİRİM)'}</span>
                        </span>
                      )}

                      <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                        {alert.category}
                      </span>

                      {(() => {
                        const segInfo = analyzeMaterialSegment(
                          alert.materialName,
                          alert.russianSubtitle || alert.materialName,
                          alert.category,
                          alert.currentPrice
                        );
                        const isCommodity = segInfo.comparisonMode === 'COMMODITY_STANDARD';
                        const badgeColors = isCommodity
                          ? 'bg-sky-50 text-sky-900 border-sky-200'
                          : segInfo.qualitySegment === 'PREMIUM'
                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                          : segInfo.qualitySegment === 'ECONOMY'
                          ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : 'bg-emerald-50 text-emerald-900 border-emerald-200';
                        return (
                          <span
                            className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border flex items-center space-x-1 ${badgeColors}`}
                            title={segInfo.segmentReason}
                          >
                            <span>{segInfo.qualitySegmentLabel}</span>
                          </span>
                        );
                      })()}

                      {alert.jobsiteName && (
                        <span className="text-[11px] font-bold text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 flex items-center space-x-1">
                          <Building2 className="w-3 h-3" />
                          <span>{alert.jobsiteName}</span>
                        </span>
                      )}

                      <span className="text-[11px] font-bold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 flex items-center space-x-1">
                        <Tag className="w-3 h-3 text-slate-400" />
                        <span>{alert.vendorName}</span>
                      </span>

                      {alert.invoiceNo && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInvoiceDetail(alert.invoiceNo);
                          }}
                          className="text-[11px] font-bold text-indigo-700 hover:text-indigo-950 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 flex items-center space-x-1.5 cursor-pointer transition-colors shadow-2xs"
                          title={language === 'RU' ? 'Посмотреть оригинальный счет и обоснование' : 'Faturayı ve Fiyat Altlığını Aç'}
                        >
                          <FileText className="w-3 h-3 text-indigo-600" />
                          <span className="font-mono">{alert.invoiceNo}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-indigo-400" />
                        </button>
                      )}

                      <span className="text-xs font-mono text-slate-400 ml-auto flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{alert.dateStr}</span>
                      </span>
                    </div>

                    {/* Title & Material Name + Authentic Russian Original Subtitle */}
                    <div>
                      <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight flex items-center space-x-2">
                        <span>{alert.materialName}</span>
                      </h3>
                      {alert.russianSubtitle && (
                        <p className="text-xs font-mono font-semibold text-indigo-700 bg-indigo-50/70 inline-block px-2 py-0.5 rounded border border-indigo-100 mt-1">
                          🇷🇺 {alert.russianSubtitle}
                        </p>
                      )}
                      <p className="text-xs font-semibold text-slate-500 mt-1">
                        {alert.title}
                      </p>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                      {alert.description}
                    </p>

                    {/* Price comparison highlight box */}
                    {alert.previousPrice && alert.currentPrice && (
                      <div className="bg-slate-900 text-white p-3 sm:p-4 rounded-xl flex flex-wrap items-center justify-between gap-3 border border-slate-800 font-mono text-xs my-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-slate-400">
                            {language === 'RU' ? 'Мин. / Прежняя цена:' : 'En Düşük / Önceki Birim Fiyat:'}
                          </span>
                          <span className="text-emerald-400 font-bold">
                            {formatRuble(alert.previousPrice)}{alert.unit ? ` / ${alert.unit}` : ''}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2 text-rose-400 font-bold">
                          <ArrowUpRight className="w-4 h-4" />
                          <span>
                            {language === 'RU' ? 'Макс. / Последняя цена:' : 'Yüksek / Son Birim Fiyat:'}{' '}
                            <strong className="text-white font-black">{formatRuble(alert.currentPrice)}{alert.unit ? ` / ${alert.unit}` : ''}</strong>
                          </span>
                          <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded text-[11px] font-black">
                            (+%{alert.percentageChange} Fark)
                          </span>
                        </div>

                        {alert.financialImpact > 0 && (
                          <div className="text-amber-300 font-bold flex items-center space-x-1">
                            <span>{language === 'RU' ? 'Сумма переплаты:' : 'Toplam Fiyat Farkı Etkisi:'}</span>
                            <span className="text-amber-400 font-black">{formatRuble(alert.financialImpact)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Inline Elma-Elma Historical Purchase Comparison Table */}
                    {alert.historyRows && alert.historyRows.length >= 2 && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden my-2">
                        <div className="bg-slate-100/90 px-3 py-2 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-700">
                          <span>📊 Bu Malzemenin Şantiye & Tedarikçi Alım Geçmişi (Elma-Elma Birim: {alert.unit || 'Adet'})</span>
                          <span className="text-slate-500 font-mono">{alert.historyRows.length} Fatura Kaydı</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500 bg-white">
                                <th className="py-1.5 px-3 font-bold">Tarih</th>
                                <th className="py-1.5 px-3 font-bold">Şantiye</th>
                                <th className="py-1.5 px-3 font-bold">Tedarikçi Firma</th>
                                <th className="py-1.5 px-3 font-bold">Fatura No</th>
                                <th className="py-1.5 px-3 font-bold text-right">Miktar</th>
                                <th className="py-1.5 px-3 font-bold text-right">Normalize Birim Fiyat</th>
                                <th className="py-1.5 px-3 font-bold text-right">En Düşüğe Göre Fark</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70">
                              {alert.historyRows.slice(0, 5).map((hRow, hIdx) => {
                                const minP = alert.minUnitPrice || alert.previousPrice || hRow.unitPrice;
                                const diffPct = minP > 0 ? ((hRow.unitPrice - minP) / minP) * 100 : 0;
                                const isCheapest = diffPct < 0.5;
                                return (
                                  <tr key={hIdx} className={isCheapest ? 'bg-emerald-50/40' : diffPct >= 15 ? 'bg-rose-50/40' : 'bg-white'}>
                                    <td className="py-1.5 px-3 font-mono text-slate-600">{hRow.date}</td>
                                    <td className="py-1.5 px-3 font-semibold text-indigo-900">{hRow.jobsiteName}</td>
                                    <td className="py-1.5 px-3 font-medium text-slate-800">{hRow.supplier}</td>
                                    <td className="py-1.5 px-3 font-mono">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenInvoiceDetail(hRow.invoiceNo);
                                        }}
                                        className="text-indigo-600 hover:underline font-bold cursor-pointer"
                                      >
                                        {hRow.invoiceNo}
                                      </button>
                                    </td>
                                    <td className="py-1.5 px-3 font-mono text-right text-slate-600">
                                      {hRow.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} {hRow.unit}
                                    </td>
                                    <td className="py-1.5 px-3 font-mono font-bold text-right text-slate-900">
                                      {formatRuble(hRow.unitPrice)} / {hRow.unit}
                                    </td>
                                    <td className="py-1.5 px-3 font-mono font-bold text-right">
                                      {isCheapest ? (
                                        <span className="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded text-[10px]">EN UYGUN BAZ</span>
                                      ) : (
                                        <span className="text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded text-[10px]">+%{diffPct.toFixed(1)}</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Smart Market Reason Badge & Quick Insight */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-slate-600 bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-lg flex items-center space-x-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>{market.badge}</span>
                      </span>

                      {/* If acknowledged, show approval info */}
                      {isAcknowledged && ack && (
                        <span className="font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center space-x-1.5">
                          <FileCheck2 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>
                            {language === 'RU'
                              ? `Одобрено (${ack.reason}) - ${ack.acknowledgedBy}`
                              : `Onay: ${ack.reason} (${ack.acknowledgedBy})`}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Actions Column */}
                  <div className="flex sm:flex-row lg:flex-col items-stretch lg:items-end justify-end gap-2.5 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 pt-3 lg:pt-0 lg:pl-5 min-w-[200px]">
                    {/* 1. In-place Detail & Market Analysis Modal (DOES NOT SWITCH TABS!) */}
                    <button
                      onClick={() => {
                        setSelectedAlertForDetail(alert);
                        setSelectedReason(market.defaultReason);
                        setManagerNote(ack?.note || '');
                      }}
                      className="flex-1 lg:w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <Search className="w-3.5 h-3.5 text-amber-400" />
                      <span>{language === 'RU' ? 'Изучить и анализ' : '🔍 İncele & Piyasa Analizi'}</span>
                    </button>

                    {/* 2. Manager Acknowledge / Restore Action */}
                    {!isAcknowledged ? (
                      <button
                        onClick={() => handleAcknowledgeAlert(alert)}
                        className="flex-1 lg:w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center space-x-2 cursor-pointer"
                        title={
                          language === 'RU'
                            ? 'Подтвердить аномалию и скрыть из активного списка'
                            : 'Yönetici onayladı; bilinen problem olarak listeden kaldır'
                        }
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{language === 'RU' ? 'Подтвердить' : '✅ Yönetici Onayladı (Kaldır)'}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUnacknowledgeAlert(alert.id)}
                        className="flex-1 lg:w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                        title={language === 'RU' ? 'Вернуть в активные' : 'Aktif listeye geri al'}
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                        <span>{language === 'RU' ? 'Вернуть' : '↺ Geri Al (Aktif Et)'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* IN-PLACE DETAILED ANOMALY & MARKET ANALYSIS MODAL */}
      {/* ========================================================================= */}
      {selectedAlertForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-sm overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-5 sm:p-6 flex items-start justify-between gap-4 border-b border-slate-800 shrink-0">
              <div className="space-y-1.5">
                <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                  <span>
                    {language === 'RU'
                      ? 'Анализ аномалии и обоснование руководителя'
                      : 'Anomali Teşhisi, Piyasa Analizi & Fatura Geçmişi'}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {selectedAlertForDetail.materialName}
                </h2>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-lg border border-slate-700 font-semibold">
                    {selectedAlertForDetail.category}
                  </span>
                  {selectedAlertForDetail.jobsiteName && (
                    <span className="bg-indigo-950 text-indigo-300 px-2.5 py-0.5 rounded-lg border border-indigo-800 font-semibold flex items-center space-x-1">
                      <Building2 className="w-3 h-3" />
                      <span>{selectedAlertForDetail.jobsiteName}</span>
                    </span>
                  )}
                  <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-lg border border-slate-700 font-semibold">
                    {selectedAlertForDetail.vendorName}
                  </span>
                  {selectedAlertForDetail.invoiceNo && (
                    <button
                      type="button"
                      onClick={() => handleOpenInvoiceDetail(selectedAlertForDetail.invoiceNo!)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded-lg font-bold flex items-center space-x-1.5 cursor-pointer shadow-sm transition-all border border-indigo-400"
                      title="Faturayı ve resmi fiyat altlığını aç"
                    >
                      <FileText className="w-3.5 h-3.5 text-amber-300" />
                      <span>Fatura: {selectedAlertForDetail.invoiceNo}</span>
                      <ExternalLink className="w-3 h-3 text-indigo-200" />
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedAlertForDetail(null)}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-800 text-sm">
              {/* 1. Price Metrics Hero Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                  <p className="text-[11px] text-slate-500 font-bold uppercase font-sans">
                    {language === 'RU' ? 'Прежняя цена' : 'Önceki Birim Fiyat'}
                  </p>
                  <p className="text-lg font-black text-slate-700 mt-1">
                    {selectedAlertForDetail.previousPrice ? formatRuble(selectedAlertForDetail.previousPrice) : '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                    {language === 'RU' ? 'Базовый тариф' : 'Önceki Sipariş Fiyatı'}
                  </p>
                </div>

                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-center">
                  <p className="text-[11px] text-rose-800 font-bold uppercase font-sans">
                    {language === 'RU' ? 'Текущая цена (Последний счет)' : 'Son Fatura Birim Fiyatı'}
                  </p>
                  <p className="text-xl font-black text-rose-600 mt-1">
                    {selectedAlertForDetail.currentPrice ? formatRuble(selectedAlertForDetail.currentPrice) : '-'}
                  </p>
                  <p className="text-[11px] font-black text-rose-700 font-sans mt-0.5">
                    +{selectedAlertForDetail.percentageChange}% {language === 'RU' ? 'рост' : 'artış'}
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                  <p className="text-[11px] text-amber-800 font-bold uppercase font-sans">
                    {language === 'RU' ? 'Финансовое влияние (Риск)' : 'Yansıyan Bütçe Riski'}
                  </p>
                  <p className="text-xl font-black text-amber-600 mt-1">
                    {formatRuble(selectedAlertForDetail.financialImpact)}
                  </p>
                  <p className="text-[10px] text-amber-700 font-sans mt-0.5">
                    {language === 'RU' ? 'Расчетная переплата' : 'Fazla Maliyet Tutarı'}
                  </p>
                </div>
              </div>

              {/* Fatura Numarası & Fiyat Altlığı Doğrudan İnceleme Barı */}
              <div className="bg-indigo-50/70 border border-indigo-200/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <FileText className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">
                      {language === 'RU' ? 'Номер счета и ценовое обоснование' : 'Fatura No ve Resmi Fiyat Altlığı'}
                    </div>
                    <div className="text-sm font-black text-slate-900 font-mono flex items-center space-x-2">
                      <span>{selectedAlertForDetail.invoiceNo || 'Mevcut Alım Kaydı'}</span>
                      {selectedAlertForDetail.dateStr && (
                        <span className="text-xs font-normal text-slate-500 font-sans">
                          • {selectedAlertForDetail.dateStr}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenInvoiceDetail(selectedAlertForDetail.invoiceNo || 'Fatura Altlığı')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  <span>{language === 'RU' ? 'Открыть счет и обоснование' : 'Faturayı ve Fiyat Altlığını Aç'}</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                </button>
              </div>

              {/* 2. Intelligent Market Analysis Box (The Core Reason & Context requested by user) */}
              {(() => {
                const market = getMarketIntelligence(
                  selectedAlertForDetail.materialName,
                  selectedAlertForDetail.category
                );
                return (
                  <div className="bg-gradient-to-r from-amber-50/70 via-orange-50/50 to-amber-50/70 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-2 relative">
                    <div className="flex items-center space-x-2 text-amber-900 font-black text-xs uppercase tracking-wider">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span>{market.badge}</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-medium">
                      {market.explanation}
                    </p>
                    <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between text-xs text-amber-950 font-semibold">
                      <span>
                        💡 {language === 'RU'
                          ? 'Совет: Колебания цен на сырье (арматура, металл) цикличны. При подтверждении руководителем аномалия архивируется.'
                          : 'Piyasa Notu: Rusya pazarında inşaat demiri ve metaller haftalık bazda dalgalanır. Yönetici olarak bu durumu biliyorsanız aşağıdan onaylayıp kapatabilirsiniz.'}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* 3. Chronological Purchase History Table */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>
                      {language === 'RU'
                        ? 'История закупок этого материала по всем счетам'
                        : 'Bu Malzemenin Sistemdeki Tüm Fatura ve Alım Geçmişi'}
                    </span>
                  </h4>
                  <span className="text-[11px] font-bold text-slate-500">
                    {materialPurchaseHistory.length} {language === 'RU' ? 'записей' : 'fatura kaydı bulundu'}
                  </span>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">{language === 'RU' ? 'Дата' : 'Tarih'}</th>
                        <th className="py-2.5 px-3">{language === 'RU' ? 'Счет №' : 'Fatura No'}</th>
                        <th className="py-2.5 px-3">{language === 'RU' ? 'Объект' : 'Şantiye'}</th>
                        <th className="py-2.5 px-3">{language === 'RU' ? 'Поставщик' : 'Tedarikçi'}</th>
                        <th className="py-2.5 px-3 text-right">{language === 'RU' ? 'Кол-во' : 'Miktar'}</th>
                        <th className="py-2.5 px-3 text-right">{language === 'RU' ? 'Цена за ед.' : 'Birim Fiyat'}</th>
                        <th className="py-2.5 px-3 text-right">{language === 'RU' ? 'Итого' : 'Toplam'}</th>
                        <th className="py-2.5 px-3 text-center">{language === 'RU' ? 'Обоснование / Счет' : 'Altlık / Belge'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {materialPurchaseHistory.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-4 text-center text-slate-400 font-medium">
                            {language === 'RU' ? 'Нет других счетов' : 'Başka fatura kaydı bulunamadı'}
                          </td>
                        </tr>
                      ) : (
                        materialPurchaseHistory.map((row, idx) => (
                          <tr
                            key={idx}
                            className={`transition-colors font-medium ${
                              row.isCurrentTrigger ? 'bg-rose-50/70 font-bold text-rose-950' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                              {row.date}
                              {row.isCurrentTrigger && (
                                <span className="ml-1.5 text-[9px] bg-rose-600 text-white px-1.5 py-0.5 rounded font-sans">
                                  {language === 'RU' ? 'Текущий' : 'Bu Fatura'}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono">
                              <button
                                type="button"
                                onClick={() => handleOpenInvoiceDetail(row.invoiceNo, row.invoice)}
                                className="font-mono text-indigo-600 hover:text-indigo-950 underline font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                                title={language === 'RU' ? 'Посмотреть оригинальный счет и обоснование' : 'Faturayı ve Fiyat Altlığını Aç'}
                              >
                                <FileText className="w-3 h-3 text-indigo-500 shrink-0" />
                                <span>{row.invoiceNo}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                              </button>
                            </td>
                            <td className="py-2.5 px-3">{row.jobsiteName}</td>
                            <td className="py-2.5 px-3 text-slate-600">{row.supplier}</td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {row.quantity} {row.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold">
                              {formatRuble(row.unitPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-900 font-bold">
                              {formatRuble(row.totalPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleOpenInvoiceDetail(row.invoiceNo, row.invoice)}
                                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-950 border border-indigo-200 rounded-lg text-[10px] font-bold inline-flex items-center space-x-1 cursor-pointer transition-colors shadow-2xs"
                                title={language === 'RU' ? 'Открыть оригинальный счет' : 'Faturayı ve Fiyat Altlığını Görüntüle'}
                              >
                                <Eye className="w-3 h-3 text-indigo-600" />
                                <span>{language === 'RU' ? 'Счет' : 'Fatura Gör'}</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 4. Manager Resolution & Approval Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center space-x-2 text-slate-900 font-black text-xs uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>
                    {language === 'RU' ? 'Решение и обоснование руководителя' : 'Yönetici Kararı & Gerekçelendirme'}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <label className="font-bold text-slate-700 block">
                    {language === 'RU' ? 'Выберите причину / основание:' : 'Fiyat Sapması Gerekçesini Seçin:'}
                  </label>
                  <select
                    value={selectedReason}
                    onChange={(e) => setSelectedReason(e.target.value)}
                    className="w-full py-2.5 px-3 bg-white border border-slate-300 rounded-xl text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer text-xs"
                  >
                    <option value="Piyasa / Emtia Dalgalanması (Demir, Çelik vb.)">
                      {language === 'RU'
                        ? 'Рыночные колебания сырья (арматура, металл, цемент и др.)'
                        : 'Piyasa / Emtia Dalgalanması (Demir, Çelik, Çimento vb.)'}
                    </option>
                    <option value="Lojistik / Nakliye & Mesafe Farkı">
                      {language === 'RU'
                        ? 'Логистика / плечо доставки и удаленность объекта'
                        : 'Lojistik / Nakliye & Şantiye Mesafe Farkı'}
                    </option>
                    <option value="Küçük Parti / Acil Şantiye İhtiyacı">
                      {language === 'RU'
                        ? 'Малый объем партии / срочная внеплановая поставка'
                        : 'Küçük Parti / Acil Şantiye İhtiyacı'}
                    </option>
                    <option value="Teknik Şartname / Marka / Kalite Farkı">
                      {language === 'RU'
                        ? 'Особые технические требования / марка / сертификация'
                        : 'Teknik Şartname / Marka / Kalite Farkı'}
                    </option>
                    <option value="Tedarikçi ile Teyit Edildi / Fiyat Doğrulandı">
                      {language === 'RU'
                        ? 'Согласовано с поставщиком / цена проверена'
                        : 'Tedarikçi ile Teyit Edildi / Fiyat Doğrulandı'}
                    </option>
                    <option value="Yönetici Özel İncelemesiyle Onaylandı">
                      {language === 'RU'
                        ? 'Проверено и утверждено руководителем'
                        : 'Yönetici Özel İncelemesiyle Onaylandı'}
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5 text-xs">
                  <label className="font-bold text-slate-700 block">
                    {language === 'RU' ? 'Примечание руководителя (необязательно):' : 'Yönetici Notu (İsteğe bağlı):'}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      language === 'RU'
                        ? 'Например: Цены на арматуру растут сезонно, ожидаем отката в следующем месяце...'
                        : 'Örn: Demir fiyatları Rusya piyasasında bu ay yüksek, sonraki ay düşüş bekleniyor...'
                    }
                    value={managerNote}
                    onChange={(e) => setManagerNote(e.target.value)}
                    className="w-full py-2 px-3 bg-white border border-slate-300 rounded-xl text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer Actions */}
            <div className="bg-slate-100 p-4 sm:p-5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <button
                onClick={() => setSelectedAlertForDetail(null)}
                className="w-full sm:w-auto px-5 py-2.5 bg-white hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition-all cursor-pointer"
              >
                {language === 'RU' ? 'Закрыть' : 'Pencereyi Kapat'}
              </button>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                {acknowledgedMap[selectedAlertForDetail.id] ? (
                  <button
                    onClick={() => handleUnacknowledgeAlert(selectedAlertForDetail.id)}
                    className="w-full sm:w-auto px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 text-amber-400" />
                    <span>{language === 'RU' ? 'Вернуть в активные' : '↺ Tekrar Aktif Listeye Taşı'}</span>
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      handleAcknowledgeAlert(selectedAlertForDetail, selectedReason, managerNote)
                    }
                    className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {language === 'RU'
                        ? '✅ Подтвердить и скрыть (Окей)'
                        : '✅ Yönetici Onayladı / Listeden Kaldır'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Invoice Detail / Price Basis Modal */}
      {selectedInvoiceForModal && (
        <InvoiceDetailModal
          invoice={selectedInvoiceForModal}
          supervisors={supervisors}
          jobsites={jobsites}
          onClose={() => setSelectedInvoiceForModal(null)}
          onInvoiceUpdated={() => {}}
        />
      )}
    </div>
  );
};
