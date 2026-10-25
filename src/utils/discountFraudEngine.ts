/**
 * AKILLI İNDİRİM HİLE DENETİMİ (Fiyat Kıyaslaması & İndirim Doğrulama Denetimi)
 *
 * İndirim kayıtlarında sistemi aldatma kalıplarını yakalar. Her bulgu yalnızca kayıtlı gerçek verilere dayanır:
 * - Fiyat kıyasları ortak "aynı malzeme" eşleştiricisiyle yapılır (sameMaterialMatcher / findSameMaterialHistory):
 *   aynı marka, model ve teknik özellik; %22 KDV dahil gerçek fatura fiyatı; tahmini birim dönüşümü yok;
 *   kayıttan sonraki alımlar ve aynı alımın kopyaları referans olmaz.
 * - İlk teklifin satır fiyatı yalnızca belgeden biliniyorsa (ilk teklif PDF satır eşleşmesi veya tek kalemli kayıt)
 *   kullanılır; toplam orandan satır fiyatı uydurulmaz.
 * - Her bulgu kanıtını (belge no, tarih, tedarikçi, fiyat) taşır; yönetici kararı vermeden hiçbir kayıt değiştirilmez.
 */
import { DiscountRecord, InvoiceRecord } from '../types';
import {
  findSameMaterialHistory,
  comparisonGrossUnitPrice,
  isLineArithmeticConsistent,
  discountLinesArePaidPrices,
  isTrustedPriceSourceInvoice
} from './preApprovalAuditEngine';
import {
  cleanDocumentNumber,
  vendorKeyForMatching,
  parsePurchaseDate,
  amountsReconcile,
  isFreightOrServiceLineText,
  isSameMaterialLine,
  convertUnitPriceStrict,
  isPlausibleSameMaterialPriceRatio
} from './sameMaterialMatcher';
import { isExemptFromBenchmarkAudit } from './auditRiskEngine';
import { isCommodityVolatileMaterial } from './aiForensicAuditor';
import { buildDiscountLineComparisons } from './discountLineReference';

export type FraudSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';

export type FraudPatternCode =
  | 'INFLATED_FIRST_OFFER'
  | 'PHANTOM_SAVINGS'
  | 'REPEAT_DISCOUNT_SAME_PRICE'
  | 'DUPLICATE_INVOICE'
  | 'STAGE_AMOUNT_MISMATCH'
  | 'INVOICE_TOTAL_MISMATCH'
  | 'QUANTITY_CUT_AS_DISCOUNT'
  | 'EXCESSIVE_DISCOUNT';

export const FRAUD_PATTERN_LABELS: Record<FraudPatternCode, string> = {
  INFLATED_FIRST_OFFER: 'Şişirilmiş ilk teklif',
  PHANTOM_SAVINGS: 'Hayali indirim (fiyat eski normale döndü)',
  REPEAT_DISCOUNT_SAME_PRICE: 'Aynı fiyata tekrar indirim',
  DUPLICATE_INVOICE: 'Aynı fatura iki kez indirim',
  STAGE_AMOUNT_MISMATCH: 'Beyan tutarı belgeyi tutmuyor',
  INVOICE_TOTAL_MISMATCH: 'Faturada ödenen fiyat beyandan yüksek',
  QUANTITY_CUT_AS_DISCOUNT: 'Miktar azaltma indirim gibi gösterilmiş',
  EXCESSIVE_DISCOUNT: 'Olağandışı yüksek indirim oranı'
};

export const SEVERITY_WEIGHT: Record<FraudSeverity, number> = { CRITICAL: 60, HIGH: 35, MEDIUM: 15, INFO: 0 };

/** Bunun altındaki ruble etkisi gürültüdür, bulgu üretilmez. */
export const MIN_FRAUD_IMPACT_RUB = 5000;
/** İlk teklif aynı malzemenin yakın geçmiş fiyatından en az bu kadar yüksekse şişirilmiş sayılır. */
export const INFLATED_FIRST_OFFER_MIN_PCT = 15;
/** Geçmiş fiyat penceresi: emtia (demir, beton, kablo, yakıt) fiyatı hızlı değiştiği için daha kısa. */
export const HISTORY_WINDOW_DAYS = 120;
export const VOLATILE_HISTORY_WINDOW_DAYS = 45;
export const EXCESSIVE_DISCOUNT_PCT = 35;
/** Aynı tedarikçinin önceki fiyatı ancak bu kadar gün önceki bir alımsa referans olur. */
export const SAME_VENDOR_MIN_GAP_DAYS = 7;

export interface FraudEvidence {
  label: string;
  value: string;
  docNo?: string;
  date?: string;
  supplier?: string;
  source?: 'GES_ARCHIVE' | 'PRIZMA_ERP' | 'DISCOUNT' | 'DOCUMENT';
  discountId?: string;
  invoiceId?: string;
  fileUrl?: string;
}

export interface FraudFinding {
  code: FraudPatternCode;
  severity: FraudSeverity;
  title: string;
  summary: string;
  /** Şüpheli ruble etkisi (hayali indirim kısmı, fazla ödeme vb.) */
  impactRub: number;
  evidence: FraudEvidence[];
  relatedDiscountIds?: string[];
  materialName?: string;
}

export interface DiscountFraudReport {
  discountId: string;
  riskLevel: FraudSeverity | 'CLEAN';
  riskScore: number;
  findings: FraudFinding[];
  claimedDiscount: number;
  /** Geçmiş gerçek fiyata göre doğrulanabilen gerçek tasarruf (hesaplanamıyorsa null) */
  verifiedRealSaving: number | null;
  /** Geçmişi bulunan kalemlerin anlaşılan tutardaki payı (0-1) */
  historyCoverage: number;
  suspiciousAmount: number;
  executiveReviewed: boolean;
}

export interface PersonFraudSummary {
  personKey: string;
  personName: string;
  role: 'Şef' | 'Personel';
  recordCount: number;
  flaggedCount: number;
  criticalCount: number;
  claimedDiscount: number;
  suspiciousAmount: number;
  topVendor?: string;
  topVendorShare?: number;
  patternCounts: Partial<Record<FraudPatternCode, number>>;
}

export interface FraudPortfolioResult {
  reports: DiscountFraudReport[];
  byId: Map<string, DiscountFraudReport>;
  patternCounts: Record<FraudPatternCode, number>;
  flaggedCount: number;
  criticalCount: number;
  highCount: number;
  totalSuspiciousAmount: number;
  people: PersonFraudSummary[];
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const fmtRub = (v: number) =>
  `${Number(v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₽`;

const fmtPct = (v: number) => `%${Number(v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

function claimedDiscountOf(d: DiscountRecord): number {
  const offer = Number(d.adjustedOfferPrice || d.offerPrice) || 0;
  const agreed = Number(d.agreedPrice) || 0;
  const stored = Number(d.discountAmount) || 0;
  if (stored > 0) return stored;
  return offer > agreed ? offer - agreed : 0;
}

function claimedDiscountPct(d: DiscountRecord): number {
  const offer = Number(d.adjustedOfferPrice || d.offerPrice) || 0;
  if (Number.isFinite(Number(d.discountPercentage)) && Number(d.discountPercentage) > 0) return Number(d.discountPercentage);
  return offer > 0 ? (claimedDiscountOf(d) / offer) * 100 : 0;
}

function recordDate(d: DiscountRecord): number | null {
  return parsePurchaseDate(d.orderDate) ?? parsePurchaseDate(String(d.created_at || '').slice(0, 10));
}

function isActive(d: DiscountRecord): boolean {
  return Boolean(d) && !d.isDeleted && !(d as any).isPermanentlyDeleted && !d.isInvalidTestRecord;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function isAuditableMaterialLine(it: any, category?: string): boolean {
  const name = String(it?.originalName || it?.materialName || '');
  if (!name.trim()) return false;
  if (isFreightOrServiceLineText(name) || isFreightOrServiceLineText(it?.materialName)) return false;
  if (isExemptFromBenchmarkAudit(name, it?.category || category).isExempt) return false;
  if (it?.lineVerified === false) return false;
  return isLineArithmeticConsistent(it);
}

function invoiceTotalExcludingFreight(inv: any): number[] {
  const total = Number(inv?.totalAmount) || 0;
  const freight = Number(inv?.excludedFreightGrossAmount || inv?.excludedFreightAmount) || 0;
  return freight > 0 && freight < total ? [total, total - freight] : [total];
}

function isDiscountCopyInvoice(inv: any): boolean {
  return /^inv_(?:sync|cmp)_/.test(String(inv?.id || '')) || Boolean(inv?.discountId);
}

function isPrizmaRecord(inv: any): boolean {
  return inv?.sourceCollection === 'prizma_invoices' || String(inv?.id || '').startsWith('prizma_') || Boolean(inv?.prizmaProcessId && !inv?.uploadedBySupervisorId);
}

// ---------------------------------------------------------------------------
// Fiyat geçmişi dedektörleri (şişirilmiş ilk teklif, hayali indirim)
// ---------------------------------------------------------------------------

interface LinePriceInsight {
  materialName: string;
  unit: string;
  quantity: number;
  paidUnit: number;
  firstOfferUnit: number | null;
  firstOfferSource: 'PDF_LINE' | 'SINGLE_LINE' | null;
  refUnit: number;
  /** Referans alımların en yükseği: ödenen fiyat bunun da üstündeyse fiyat geçmiş aralığın dışındadır */
  refMax: number;
  refCount: number;
  sameVendorRef: boolean;
  refEvidence: FraudEvidence[];
  /** Aynı tedarikçiden aynı malzemenin en son İNDİRİMLİ alımı (önceki indirim kaydının ödenen fiyatı) */
  prevDiscountBuy: { unitPrice: number; date: string; discountId?: string; invoiceNo?: string; fileUrl?: string } | null;
}

export function analyzeLinePrices(d: DiscountRecord, pool: InvoiceRecord[]): LinePriceInsight[] {
  const items = Array.isArray(d.items) ? d.items : [];
  if (items.length === 0 || pool.length === 0) return [];
  const cur = recordDate(d);
  const vendorKey = vendorKeyForMatching(d.vendorName);

  // İlk teklif satır fiyatı: yalnızca belgeden (PDF satır eşleşmesi) ya da tek malzeme kalemli kayıtta toplamdan
  let lineRefs: ReturnType<typeof buildDiscountLineComparisons> = [];
  try {
    lineRefs = buildDiscountLineComparisons(d as any);
  } catch {
    lineRefs = [];
  }
  const materialIdx = items.map((it, i) => (isAuditableMaterialLine(it, d.category) ? i : -1)).filter(i => i >= 0);
  const singleMaterialRecord = items.length === 1 && materialIdx.length === 1;
  const scopeDeduction = Number(d.scopeDeductionAmount) || 0;

  const out: LinePriceInsight[] = [];
  for (const idx of materialIdx) {
    const it: any = items[idx];
    const paidUnit = comparisonGrossUnitPrice(it);
    const qty = Number(it.quantity) || 0;
    if (!(paidUnit > 0) || !(qty > 0)) continue;

    let firstOfferUnit: number | null = null;
    let firstOfferSource: LinePriceInsight['firstOfferSource'] = null;
    const ref = lineRefs[idx];
    // Oransal (toplam indirim oranından dağıtılmış) ilk teklif tahmindir, belge fiyatı değildir: kullanılmaz
    const isEstimatedRef = ref && /^(Oransal|İlk Teklif \(Değişim Yok\))/.test(String(ref.refSupplier || ''));
    if (ref && ref.hasReference && ref.refPrice > 0 && !isEstimatedRef) {
      firstOfferUnit = ref.refPrice;
      firstOfferSource = 'PDF_LINE';
    } else if (singleMaterialRecord && scopeDeduction === 0) {
      const offer = Number(d.adjustedOfferPrice || d.offerPrice) || 0;
      if (offer > 0 && amountsReconcile(paidUnit * qty, Number(d.agreedPrice) || 0)) {
        firstOfferUnit = Number((offer / qty).toFixed(2));
        firstOfferSource = 'SINGLE_LINE';
      }
    }

    const matches = findSameMaterialHistory(
      it,
      paidUnit,
      {
        supplier: d.vendorName,
        jobsiteId: d.jobsiteId,
        date: d.orderDate,
        invoiceNo: d.invoiceNo || d.invoiceNumber,
        excludeDiscountId: d.id,
        excludeInvoiceId: `inv_sync_${d.id}`
      },
      pool
    );
    const volatile = isCommodityVolatileMaterial(`${it.originalName || ''} ${it.materialName || ''}`, it.category || d.category).isCommodity;
    const windowMs = (volatile ? VOLATILE_HISTORY_WINDOW_DAYS : HISTORY_WINDOW_DAYS) * DAY_MS;
    const recent = matches.filter(m => {
      const t = parsePurchaseDate(m.entry.date);
      if (cur === null || t === null || t > cur || cur - t > windowMs) return false;
      // Aynı tedarikçinin birkaç gün içindeki faturaları aynı pazarlığın parçasıdır (bölünmüş fatura, aynı gün giriş): "önceki normal fiyat" sayılmaz
      if (vendorKey && vendorKeyForMatching(m.entry.supplier) === vendorKey && cur - t < SAME_VENDOR_MIN_GAP_DAYS * DAY_MS) return false;
      return true;
    });
    if (recent.length === 0) continue;
    const sameVendor = recent.filter(m => vendorKey && vendorKeyForMatching(m.entry.supplier) === vendorKey);
    // Tek bir başka firma fiyatı "normal fiyat" kanıtı sayılmaz; en az iki alım ya da tedarikçinin kendi eski fiyatı gerekir
    if (recent.length < 2 && sameVendor.length === 0) continue;

    const newestFirst = [...recent].sort((a, b) => (parsePurchaseDate(b.entry.date) || 0) - (parsePurchaseDate(a.entry.date) || 0));
    const basis = sameVendor.length > 0 ? sameVendor : newestFirst;
    const refUnit = Number(median(basis.slice(0, 5).map(m => m.comparablePrice)).toFixed(2));
    const refMax = Math.max(...basis.slice(0, 5).map(m => m.comparablePrice));
    if (!(refUnit > 0)) continue;

    const prevDisc = [...sameVendor]
      .filter(m => isDiscountCopyInvoice(m.entry.inv))
      .sort((a, b) => (parsePurchaseDate(b.entry.date) || 0) - (parsePurchaseDate(a.entry.date) || 0))[0];

    out.push({
      prevDiscountBuy: prevDisc
        ? {
            unitPrice: prevDisc.comparablePrice,
            date: prevDisc.entry.date,
            discountId: (prevDisc.entry.inv as any).discountId || String(prevDisc.entry.inv.id || '').replace(/^inv_(?:sync|cmp)_/, ''),
            invoiceNo: prevDisc.entry.inv.invoiceNumber,
            fileUrl: prevDisc.entry.inv.fileUrl
          }
        : null,
      materialName: String(it.originalName || it.materialName),
      unit: String(it.unit || 'adet'),
      quantity: qty,
      paidUnit,
      firstOfferUnit,
      firstOfferSource,
      refUnit,
      refMax,
      refCount: basis.length,
      sameVendorRef: sameVendor.length > 0,
      refEvidence: basis.slice(0, 5).map(m => ({
        label: m.entry.sourceType === 'PRIZMA_ERP' ? 'Prizma ERP alımı' : (isDiscountCopyInvoice(m.entry.inv) ? 'Önceki indirimli alım' : 'GES Arşivi alımı'),
        value: `${fmtRub(m.comparablePrice)}/${it.unit || 'adet'}`,
        docNo: m.entry.inv.invoiceNumber || (m.entry.inv as any).invoiceNo,
        date: m.entry.date,
        supplier: m.entry.supplier,
        source: m.entry.sourceType,
        invoiceId: m.entry.inv.id,
        discountId: (m.entry.inv as any).discountId,
        fileUrl: m.entry.inv.fileUrl
      }))
    });
  }
  return out;
}

function detectPriceHistoryFindings(d: DiscountRecord, insights: LinePriceInsight[]): {
  findings: FraudFinding[];
  verifiedRealSaving: number | null;
  coverage: number;
} {
  const findings: FraudFinding[] = [];
  const agreed = Number(d.agreedPrice) || 0;
  const claimed = claimedDiscountOf(d);
  const paidLinesKnown = discountLinesArePaidPrices(d);
  if (insights.length === 0 || !paidLinesKnown) return { findings, verifiedRealSaving: null, coverage: 0 };

  const coveredPaid = insights.reduce((s, l) => s + l.paidUnit * l.quantity, 0);
  const coverage = agreed > 0 ? Math.min(1, coveredPaid / agreed) : 0;
  const realSaving = insights.reduce((s, l) => s + (l.refUnit - l.paidUnit) * l.quantity, 0);

  // 1) Şişirilmiş ilk teklif: belgeden bilinen ilk teklif satır fiyatı, aynı malzemenin yakın geçmiş gerçek fiyatından belirgin yüksek
  const inflated = insights
    .filter(l => l.firstOfferUnit && l.firstOfferUnit > 0)
    .map(l => {
      const first = l.firstOfferUnit as number;
      const pct = ((first - l.refUnit) / l.refUnit) * 100;
      const lineClaimed = Math.max(0, (first - l.paidUnit) * l.quantity);
      const realLine = Math.max(0, (l.refUnit - l.paidUnit) * l.quantity);
      return { l, first, pct, fake: Math.max(0, lineClaimed - realLine), lineClaimed, realLine, backToNormal: l.paidUnit >= l.refUnit * 0.99 };
    })
    .filter(x => x.pct >= INFLATED_FIRST_OFFER_MIN_PCT && x.fake > 0)
    .sort((a, b) => b.fake - a.fake);
  const inflatedFake = inflated.reduce((s, x) => s + x.fake, 0);
  // Küçük tutarlı şişirmeler de "Kontrol et" olarak gösterilir; yüksek/kritik için en az MIN_FRAUD_IMPACT_RUB
  if (inflated.length > 0 && inflatedFake >= MIN_FRAUD_IMPACT_RUB * 0.2) {
    const top = inflated[0];
    const allBack = inflated.every(x => x.backToNormal);
    const strong = inflated.some(x => x.pct >= 25 || x.l.sameVendorRef);
    const severity: FraudSeverity = inflatedFake < MIN_FRAUD_IMPACT_RUB ? 'MEDIUM' : allBack && strong ? 'CRITICAL' : 'HIGH';
    const t = top.l;
    findings.push({
      code: 'INFLATED_FIRST_OFFER',
      severity,
      title: FRAUD_PATTERN_LABELS.INFLATED_FIRST_OFFER,
      materialName: t.materialName,
      summary:
        `"${t.materialName}" ilk teklifte ${fmtRub(top.first)}/${t.unit} istenmiş; ` +
        `${t.sameVendorRef ? 'aynı tedarikçiden bu malzeme daha önce' : 'bu malzeme yakın geçmişte'} ${fmtRub(t.refUnit)}/${t.unit} fiyatla alınmış ` +
        `(ilk teklif ${fmtPct(top.pct)} yüksek). ` +
        (top.backToNormal
          ? `Son fiyat ${fmtRub(t.paidUnit)} ile yalnızca eski normale dönmüş.`
          : `Son fiyat ${fmtRub(t.paidUnit)}; indirimin yalnızca ${fmtRub(top.realLine)} kadarı geçmiş fiyata göre gerçek.`) +
        (inflated.length > 1 ? ` Bu kayıtta ilk teklifi şişirilmiş ${inflated.length} kalem var.` : '') +
        ` Geçmiş fiyata göre karşılığı olmayan indirim: ${fmtRub(inflatedFake)}.`,
      impactRub: Number(inflatedFake.toFixed(2)),
      evidence: inflated.slice(0, 5).flatMap(x => [
        {
          label: `"${x.l.materialName}"`,
          value: `ilk teklif ${fmtRub(x.first)} → son ${fmtRub(x.l.paidUnit)} / geçmiş ${fmtRub(x.l.refUnit)} (${x.l.unit}, ${fmtPct(x.pct)} şişirme)`,
          source: 'DOCUMENT' as const,
          fileUrl: d.firstOfferFileUrl,
          docNo: d.firstOfferFileName
        },
        ...x.l.refEvidence.slice(0, 2)
      ])
    });
  }

  // 2) Aynı fiyata tekrar indirim: aynı tedarikçiden aynı malzeme geçen sefer de "indirimle" bu fiyata alınmış
  const claimedPct = claimedDiscountPct(d);
  if (findings.length === 0 && claimed >= MIN_FRAUD_IMPACT_RUB && claimedPct >= 2) {
    for (const l of insights) {
      const prev = l.prevDiscountBuy;
      if (!prev || l.paidUnit < prev.unitPrice * 0.99) continue;
      const lineShare = (l.paidUnit * l.quantity) / (agreed || 1);
      const lineClaimed = l.firstOfferUnit ? Math.max(0, (l.firstOfferUnit - l.paidUnit) * l.quantity) : (lineShare >= 0.6 ? claimed : 0);
      if (lineClaimed < MIN_FRAUD_IMPACT_RUB) continue;
      findings.push({
        code: 'REPEAT_DISCOUNT_SAME_PRICE',
        severity: 'HIGH',
        title: FRAUD_PATTERN_LABELS.REPEAT_DISCOUNT_SAME_PRICE,
        materialName: l.materialName,
        summary:
          `"${l.materialName}" aynı tedarikçiden ${prev.date} tarihinde de indirim kaydıyla ${fmtRub(prev.unitPrice)}/${l.unit} fiyata alınmış. ` +
          `Bu kayıtta yine ${fmtRub(l.paidUnit)}/${l.unit} ödenmiş ve ${fmtRub(lineClaimed)} indirim beyan edilmiş: fiyat düşmedi, aynı fiyata ikinci kez indirim yazıldı.`,
        impactRub: Number(lineClaimed.toFixed(2)),
        evidence: [
          { label: 'Önceki indirimli alım', value: `${fmtRub(prev.unitPrice)}/${l.unit}`, date: prev.date, docNo: prev.invoiceNo, supplier: d.vendorName, source: 'DISCOUNT', discountId: prev.discountId, fileUrl: prev.fileUrl },
          { label: 'Bu kayıt', value: `${fmtRub(l.paidUnit)}/${l.unit}`, date: d.orderDate, docNo: d.invoiceNo, supplier: d.vendorName, source: 'DISCOUNT', discountId: d.id, fileUrl: d.finalOfferFileUrl }
        ],
        relatedDiscountIds: prev.discountId ? [prev.discountId] : undefined
      });
      break;
    }
  }

  // 3) Hayali indirim: indirim beyan edilmiş ama ödenen fiyat aynı malzemenin yakın geçmiş gerçek fiyatından düşük değil
  const hasInflatedFinding = findings.length > 0;
  if (!hasInflatedFinding && claimed >= MIN_FRAUD_IMPACT_RUB && claimedPct >= 2 && coverage >= 0.6) {
    const claimedOnCovered = claimed * coverage;
    const notBelowNormal = insights.filter(l => l.paidUnit >= l.refUnit * 0.99);
    const share = notBelowNormal.reduce((s, l) => s + l.paidUnit * l.quantity, 0) / coveredPaid;
    if (realSaving <= claimedOnCovered * 0.2 && share >= 0.6) {
      // Yüksek seviye ancak ödenen fiyat geçmiş alımların HEPSİNİN üstündeyse (fiyat dalgalanma aralığında değil)
      const paidAbove = insights.reduce((s, l) => s + Math.max(0, l.paidUnit - l.refMax) * l.quantity, 0);
      const severity: FraudSeverity = realSaving <= 0 && paidAbove >= MIN_FRAUD_IMPACT_RUB ? 'HIGH' : 'MEDIUM';
      const worst = [...notBelowNormal].sort((a, b) => (b.paidUnit - b.refUnit) * b.quantity - (a.paidUnit - a.refUnit) * a.quantity)[0];
      findings.push({
        code: 'PHANTOM_SAVINGS',
        severity,
        title: FRAUD_PATTERN_LABELS.PHANTOM_SAVINGS,
        materialName: worst?.materialName,
        summary:
          `${fmtRub(claimed)} (${fmtPct(claimedPct)}) indirim beyan edilmiş, ancak kalemlerin ${fmtPct(coverage * 100)}'i için ` +
          `aynı malzemenin yakın geçmişteki gerçek fiyatı var ve ödenen fiyat o fiyattan düşük değil. ` +
          `Geçmişe göre gerçek tasarruf: ${fmtRub(Math.max(0, realSaving))}` +
          (paidAbove > 0 ? `; hatta geçmişteki en yüksek fiyatın da ${fmtRub(paidAbove)} üstünde ödenmiş.` : '.'),
        impactRub: Number(Math.max(0, claimedOnCovered - Math.max(0, realSaving)).toFixed(2)),
        evidence: insights.slice(0, 6).flatMap(l => [
          {
            label: `"${l.materialName}"`,
            value: `ödenen ${fmtRub(l.paidUnit)} / geçmiş ${fmtRub(l.refUnit)} (${l.unit}, ${l.refCount} alım${l.sameVendorRef ? ', aynı tedarikçi' : ''})`,
            source: 'DISCOUNT' as const,
            discountId: d.id
          },
          ...l.refEvidence.slice(0, 2)
        ])
      });
    }
  }

  // Kalemlerin çoğunun geçmişi yoksa gerçek tasarruf iddia edilmez
  return { findings, verifiedRealSaving: coverage >= 0.6 ? Number(realSaving.toFixed(2)) : null, coverage };
}

// ---------------------------------------------------------------------------
// Belge / mükerrer kayıt dedektörleri
// ---------------------------------------------------------------------------

function detectDocumentFindings(d: DiscountRecord, claimed: number): FraudFinding[] {
  const findings: FraudFinding[] = [];
  if (claimed < MIN_FRAUD_IMPACT_RUB) return findings;

  // Beyan edilen ilk teklif / son tutar, aşama belgelerine girilen tutarlarla tutmuyor mu? (yalnızca indirimi büyüten yönde)
  const stages = Array.isArray(d.stageDocuments) ? d.stageDocuments : [];
  if (stages.length >= 2) {
    const firstStage = [...stages].sort((a: any, b: any) => (Number(a.stageNumber) || 0) - (Number(b.stageNumber) || 0))[0] as any;
    const finalStage = (stages.find((s: any) => s.isFinal) || stages[stages.length - 1]) as any;
    const offer = Number(d.offerPrice) || 0;
    const agreed = Number(d.agreedPrice) || 0;
    const docFirst = Number(firstStage?.amount) || 0;
    const docFinal = Number(finalStage?.amount) || 0;
    const offerGap = docFirst > 0 ? offer - docFirst : 0;
    const finalGap = docFinal > 0 ? docFinal - agreed : 0;
    const inflated = Math.max(0, offerGap) + Math.max(0, finalGap);
    if (inflated >= MIN_FRAUD_IMPACT_RUB && ((offerGap > 0 && !amountsReconcile(offer, docFirst)) || (finalGap > 0 && !amountsReconcile(agreed, docFinal)))) {
      findings.push({
        code: 'STAGE_AMOUNT_MISMATCH',
        // İki değer de aynı kaydın içinden (biri okuma hatası olabilir): belge açılıp kontrol edilmeli
        severity: 'MEDIUM',
        title: FRAUD_PATTERN_LABELS.STAGE_AMOUNT_MISMATCH,
        summary:
          `Kayıtta ilk teklif ${fmtRub(offer)}, son tutar ${fmtRub(agreed)} beyan edilmiş; aşama belgelerinde ise ilk teklif ${fmtRub(docFirst)}, ` +
          `son tutar ${fmtRub(docFinal)}. Fark indirimi ${fmtRub(inflated)} büyütüyor; ilk teklif belgesini açıp doğru tutarı kontrol edin.`,
        impactRub: Number(inflated.toFixed(2)),
        evidence: [
          { label: 'Beyan: ilk teklif / son', value: `${fmtRub(offer)} / ${fmtRub(agreed)}`, source: 'DISCOUNT', discountId: d.id },
          { label: `Belge: ${firstStage?.title || 'ilk aşama'}`, value: fmtRub(docFirst), source: 'DOCUMENT', fileUrl: firstStage?.fileUrl, docNo: firstStage?.fileName },
          { label: `Belge: ${finalStage?.title || 'son aşama'}`, value: fmtRub(docFinal), source: 'DOCUMENT', fileUrl: finalStage?.fileUrl, docNo: finalStage?.fileName }
        ]
      });
    }
  }

  const pct = claimedDiscountPct(d);
  if (pct >= EXCESSIVE_DISCOUNT_PCT) {
    findings.push({
      code: 'EXCESSIVE_DISCOUNT',
      severity: 'MEDIUM',
      title: FRAUD_PATTERN_LABELS.EXCESSIVE_DISCOUNT,
      summary: `${fmtPct(pct)} indirim beyan edilmiş. Bu oranda indirim genellikle ilk teklifin şişirildiğini gösterir; ilk teklif belgesi kontrol edilmeli.`,
      impactRub: 0,
      evidence: [{ label: 'İlk teklif / son', value: `${fmtRub(Number(d.offerPrice) || 0)} / ${fmtRub(Number(d.agreedPrice) || 0)}`, source: 'DISCOUNT', discountId: d.id }]
    });
  }
  return findings;
}

interface PortfolioIndex {
  active: DiscountRecord[];
  byInvoiceVendor: Map<string, DiscountRecord[]>;
  invoicesByNumber: Map<string, InvoiceRecord[]>;
}

function pushMap<T>(m: Map<string, T[]>, k: string, v: T) {
  if (!k) return;
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

function buildPortfolioIndex(discounts: DiscountRecord[], pool: InvoiceRecord[]): PortfolioIndex {
  const active = discounts.filter(isActive);
  const idx: PortfolioIndex = {
    active,
    byInvoiceVendor: new Map(),
    invoicesByNumber: new Map()
  };
  for (const d of active) {
    const vk = vendorKeyForMatching(d.vendorName);
    const no = cleanDocumentNumber(d.invoiceNo || d.invoiceNumber);
    if (vk && no.length >= 3) pushMap(idx.byInvoiceVendor, `${vk}|${no}`, d);
  }
  for (const inv of pool) {
    if (!inv || inv.isDeleted || isDiscountCopyInvoice(inv)) continue;
    const no = cleanDocumentNumber(inv.invoiceNumber || (inv as any).invoiceNo);
    if (no.length >= 3) pushMap(idx.invoicesByNumber, no, inv);
  }
  return idx;
}

function createdMs(d: DiscountRecord): number {
  const t = Date.parse(String(d.created_at || ''));
  return Number.isFinite(t) ? t : recordDate(d) || 0;
}

function describeOther(o: DiscountRecord): FraudEvidence {
  return {
    label: 'Diğer indirim kaydı',
    value: `${fmtRub(Number(o.offerPrice) || 0)} → ${fmtRub(Number(o.agreedPrice) || 0)} (indirim ${fmtRub(claimedDiscountOf(o))})`,
    docNo: o.invoiceNo,
    date: o.orderDate,
    supplier: o.vendorName,
    source: 'DISCOUNT',
    discountId: o.id,
    fileUrl: o.finalOfferFileUrl
  };
}

function detectDuplicateFindings(d: DiscountRecord, idx: PortfolioIndex, claimed: number): FraudFinding[] {
  const findings: FraudFinding[] = [];
  const vk = vendorKeyForMatching(d.vendorName);
  const no = cleanDocumentNumber(d.invoiceNo || d.invoiceNumber);
  const mine = createdMs(d);
  // Mükerrer bulgu, sonradan girilen kayda yazılır (ilk kayıt asıl kayıttır)
  const isLater = (o: DiscountRecord) => createdMs(o) < mine || (createdMs(o) === mine && o.id < d.id);

  const sameInvoice = (vk && no.length >= 3 ? idx.byInvoiceVendor.get(`${vk}|${no}`) || [] : []).filter(o => o.id !== d.id);
  const earlierSameInvoice = sameInvoice.filter(isLater);
  if (earlierSameInvoice.length > 0 && claimed > 0) {
    findings.push({
      code: 'DUPLICATE_INVOICE',
      severity: 'CRITICAL',
      title: FRAUD_PATTERN_LABELS.DUPLICATE_INVOICE,
      summary: `"${d.invoiceNo}" numaralı ${d.vendorName} faturası için daha önce indirim kaydı girilmiş; aynı indirim ikinci kez beyan edilmiş (${fmtRub(claimed)}).`,
      impactRub: Number(claimed.toFixed(2)),
      evidence: earlierSameInvoice.map(describeOther),
      relatedDiscountIds: earlierSameInvoice.map(o => o.id)
    });
  }

  return findings;
}

function detectInvoiceTotalFindings(d: DiscountRecord, idx: PortfolioIndex): FraudFinding[] {
  const no = cleanDocumentNumber(d.invoiceNo || d.invoiceNumber);
  if (no.length < 3) return [];
  const vk = vendorKeyForMatching(d.vendorName);
  const agreed = Number(d.agreedPrice) || 0;
  const offer = Number(d.adjustedOfferPrice || d.offerPrice) || 0;
  const claimed = claimedDiscountOf(d);
  if (!(agreed > 0) || !(offer > agreed) || claimed < MIN_FRAUD_IMPACT_RUB) return [];
  // Kalem kalem kıyas: yalnızca ödenen kalem fiyatları biliniyorsa
  if (!discountLinesArePaidPrices(d)) return [];
  const recLines = (d.items || []).filter(it => isAuditableMaterialLine(it, d.category));
  const recTotal = recLines.reduce((s, it: any) => s + comparisonGrossUnitPrice(it) * (Number(it.quantity) || 0), 0);
  if (!(recTotal > 0)) return [];

  const candidates = (idx.invoicesByNumber.get(no) || []).filter(inv => {
    const sup = vendorKeyForMatching(inv.supplier || (inv as any).vendorName);
    return Boolean(vk && sup && sup === vk) && isTrustedPriceSourceInvoice(inv);
  });

  for (const inv of candidates) {
    const invLines = (inv.items || []).filter((it: any) => !isFreightOrServiceLineText(it?.originalName || it?.materialName));
    const used = new Set<number>();
    const pairs: Array<{ name: string; unit: string; recQty: number; recUnit: number; invQty: number; invUnit: number }> = [];
    for (const it of recLines as any[]) {
      const recUnit = comparisonGrossUnitPrice(it);
      const recQty = Number(it.quantity) || 0;
      for (let k = 0; k < invLines.length; k++) {
        if (used.has(k)) continue;
        const il: any = invLines[k];
        if (!isSameMaterialLine(it, { originalName: il.originalName, materialName: il.materialName, category: il.category }).same) continue;
        const invUnit = convertUnitPriceStrict(comparisonGrossUnitPrice(il), il.unit, it.unit);
        // Fatura satırı birim fiyatı makul değilse (tüm fatura tek satır okunmuş vb.) aynı kalem sayılmaz
        if (invUnit === null || !isPlausibleSameMaterialPriceRatio(invUnit, recUnit)) continue;
        const invQty = (Number(il.quantity) || 0) * (comparisonGrossUnitPrice(il) / invUnit);
        used.add(k);
        pairs.push({ name: String(it.originalName || it.materialName), unit: String(it.unit || 'adet'), recQty, recUnit, invQty, invUnit });
        break;
      }
    }
    const matchedPaid = pairs.reduce((s, p) => s + p.recUnit * p.recQty, 0);
    // Faturanın içeriği kayıttaki kalemlerle örtüşmüyorsa (farklı sürüm / ikame ürün) kıyas yapılmaz
    if (matchedPaid < recTotal * 0.8 || used.size < invLines.length * 0.8) continue;

    const src = isPrizmaRecord(inv) ? 'PRIZMA_ERP' : 'GES_ARCHIVE';
    const srcLabel = src === 'PRIZMA_ERP' ? 'Prizma ERP' : 'GES Arşivi';
    const invTotals = invoiceTotalExcludingFreight(inv);
    const offerIsInvoice = invTotals.some(t => amountsReconcile(offer, t));
    const lineEvidence: FraudEvidence[] = pairs.slice(0, 6).flatMap(p => [
      { label: `Kayıt: "${p.name}"`, value: `${p.recQty.toLocaleString('tr-TR')} ${p.unit} × ${fmtRub(p.recUnit)}`, source: 'DISCOUNT' as const, discountId: d.id, docNo: d.invoiceNo },
      { label: `${srcLabel} faturası`, value: `${Number(p.invQty.toFixed(3)).toLocaleString('tr-TR')} ${p.unit} × ${fmtRub(p.invUnit)}`, source: src, docNo: inv.invoiceNumber, date: inv.date, invoiceId: inv.id, fileUrl: inv.fileUrl }
    ]);

    // 1) Faturadaki birim fiyat beyan edilen son fiyattan yüksek: indirim faturaya yansımamış
    const priceOver = pairs.reduce((s, p) => s + Math.max(0, p.invUnit - p.recUnit) * p.recQty, 0);
    if (priceOver >= MIN_FRAUD_IMPACT_RUB && pairs.some(p => p.invUnit > p.recUnit * 1.01)) {
      const sameQty = pairs.every(p => Math.abs(p.invQty - p.recQty) <= Math.max(0.001, p.recQty * 0.001));
      return [{
        code: 'INVOICE_TOTAL_MISMATCH',
        severity: offerIsInvoice && sameQty ? 'CRITICAL' : 'HIGH',
        title: FRAUD_PATTERN_LABELS.INVOICE_TOTAL_MISMATCH,
        summary:
          `${srcLabel}'ndeki "${inv.invoiceNumber}" faturasında aynı kalemlerin birim fiyatları, indirim kaydındaki son fiyatlardan yüksek. ` +
          (offerIsInvoice && sameQty
            ? `Fatura tutarı (${fmtRub(Number(inv.totalAmount) || 0)}) ilk teklifin kendisi: beyan edilen ${fmtRub(claimed)} indirim faturaya hiç yansımamış.`
            : `Kayıttaki fiyatlarla ödenmiş olsaydı ${fmtRub(priceOver)} daha az ödenecekti; indirim bu kadar fazla gösterilmiş.`),
        impactRub: Number(Math.min(claimed, priceOver).toFixed(2)),
        evidence: lineEvidence
      }];
    }

    // 2) İndirim fiyattan değil miktardan: ilk teklif = faturadaki büyük miktar, "son fiyat" = daha az miktar, birim fiyat düşmemiş
    const cutPairs = pairs.filter(p => p.invQty > p.recQty * 1.001);
    const notCheaper = pairs.filter(p => p.recUnit >= p.invUnit * 0.99).reduce((s, p) => s + p.recUnit * p.recQty, 0);
    if (offerIsInvoice && cutPairs.length > 0 && notCheaper >= matchedPaid * 0.8) {
      const priceSaving = pairs.reduce((s, p) => s + (p.invUnit - p.recUnit) * p.recQty, 0);
      const c = cutPairs[0];
      return [{
        code: 'QUANTITY_CUT_AS_DISCOUNT',
        severity: 'CRITICAL',
        title: FRAUD_PATTERN_LABELS.QUANTITY_CUT_AS_DISCOUNT,
        materialName: c.name,
        summary:
          `İlk teklif tutarı (${fmtRub(offer)}) ${srcLabel}'ndeki "${inv.invoiceNumber}" faturasıyla aynı: ${Number(c.invQty.toFixed(3)).toLocaleString('tr-TR')} ${c.unit} × ${fmtRub(c.invUnit)}. ` +
          `İndirim kaydında ise ${c.recQty.toLocaleString('tr-TR')} ${c.unit} × ${fmtRub(c.recUnit)} var: birim fiyat düşmemiş` +
          (c.recUnit > c.invUnit * 1.01 ? ` (tersine ${fmtPct(((c.recUnit - c.invUnit) / c.invUnit) * 100)} artmış)` : '') +
          `. Beyan edilen ${fmtRub(claimed)} "indirim" miktar azaltmaktan geliyor; fiyat bazında gerçek tasarruf ${fmtRub(Math.max(0, priceSaving))}.`,
        impactRub: Number(Math.max(0, claimed - Math.max(0, priceSaving)).toFixed(2)),
        evidence: lineEvidence
      }];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Kayıt ve portföy değerlendirmesi
// ---------------------------------------------------------------------------

function finalizeReport(d: DiscountRecord, findings: FraudFinding[], claimed: number, verifiedRealSaving: number | null, coverage: number): DiscountFraudReport {
  // Kaydeden kişi aynı uyarıyı kayıttan önce gördüyse bu da kanıttır
  const precheck = (d as any).fraudPrecheckAlert;
  if (precheck && Array.isArray(precheck.codes)) {
    for (const f of findings) {
      if (!precheck.codes.includes(f.code)) continue;
      f.evidence.push({
        label: 'Kayıttan önce uyarıldı',
        value: 'Kaydeden kişi bu uyarıyı gördü ve yine de kaydetti',
        date: String(precheck.notifiedAt || '').slice(0, 10),
        source: 'DISCOUNT',
        discountId: d.id
      });
    }
  }
  const order: FraudSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'];
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.impactRub - a.impactRub);
  const counted = findings.filter(f => f.severity !== 'INFO');
  let riskLevel: DiscountFraudReport['riskLevel'] = counted.length ? counted[0].severity : 'CLEAN';
  // Birbirinden bağımsız iki yüksek bulgu (farklı kalıp) tek başına kritik kanıttır
  const highCodes = new Set(counted.filter(f => f.severity === 'HIGH').map(f => f.code));
  if (riskLevel === 'HIGH' && highCodes.size >= 2) riskLevel = 'CRITICAL';
  const riskScore = Math.min(100, counted.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0));
  // Aynı ruble iki kez sayılmasın: en büyük etki ile beyan edilen indirim sınırı
  const suspiciousAmount = Number(Math.min(
    Math.max(claimed, ...counted.map(f => f.impactRub), 0),
    counted.reduce((s, f) => s + f.impactRub, 0)
  ).toFixed(2));
  return {
    discountId: d.id,
    riskLevel,
    riskScore,
    findings,
    claimedDiscount: Number(claimed.toFixed(2)),
    verifiedRealSaving,
    historyCoverage: Number(coverage.toFixed(3)),
    suspiciousAmount,
    executiveReviewed: Boolean(d.auditReviewedBy)
  };
}

function evaluateWithIndex(d: DiscountRecord, idx: PortfolioIndex, pool: InvoiceRecord[]): DiscountFraudReport {
  const claimed = claimedDiscountOf(d);
  const insights = analyzeLinePrices(d, pool);
  const price = detectPriceHistoryFindings(d, insights);
  const findings = [
    ...detectDuplicateFindings(d, idx, claimed),
    ...detectInvoiceTotalFindings(d, idx),
    ...detectDocumentFindings(d, claimed),
    ...price.findings
  ];
  return finalizeReport(d, findings, claimed, price.verifiedRealSaving, price.coverage);
}

/**
 * Tüm indirim portföyünü tarar. historicalInvoices: GES Arşivi + Prizma ERP (sourceCollection: 'prizma_invoices').
 */
export function analyzeDiscountFraudPortfolio(
  discounts: DiscountRecord[],
  historicalInvoices: InvoiceRecord[]
): FraudPortfolioResult {
  const pool = Array.isArray(historicalInvoices) ? historicalInvoices : [];
  const idx = buildPortfolioIndex(Array.isArray(discounts) ? discounts : [], pool);
  const reports = idx.active.map(d => evaluateWithIndex(d, idx, pool));
  const byId = new Map(reports.map(r => [r.discountId, r]));

  const patternCounts = Object.keys(FRAUD_PATTERN_LABELS).reduce((acc, k) => {
    acc[k as FraudPatternCode] = 0;
    return acc;
  }, {} as Record<FraudPatternCode, number>);
  for (const r of reports) for (const code of new Set(r.findings.map(f => f.code))) patternCounts[code]++;

  const flagged = reports.filter(r => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH');
  return {
    reports,
    byId,
    patternCounts,
    flaggedCount: flagged.length,
    criticalCount: reports.filter(r => r.riskLevel === 'CRITICAL').length,
    highCount: reports.filter(r => r.riskLevel === 'HIGH').length,
    totalSuspiciousAmount: Number(flagged.reduce((s, r) => s + r.suspiciousAmount, 0).toFixed(2)),
    people: summarizePeople(idx.active, byId)
  };
}

/** Yeni indirim kaydı kaydedilmeden önce aynı kuralları taslağa uygular (girişte uyarı). */
export function analyzeDraftDiscountFraud(
  draft: Partial<DiscountRecord>,
  existingDiscounts: DiscountRecord[],
  historicalInvoices: InvoiceRecord[]
): DiscountFraudReport {
  const record = {
    ...draft,
    id: draft.id || '__draft__',
    created_at: draft.created_at || new Date().toISOString()
  } as DiscountRecord;
  const pool = Array.isArray(historicalInvoices) ? historicalInvoices : [];
  const others = (existingDiscounts || []).filter(o => o && o.id !== record.id);
  const idx = buildPortfolioIndex([...others, record], pool);
  return evaluateWithIndex(record, idx, pool);
}

function summarizePeople(active: DiscountRecord[], byId: Map<string, DiscountFraudReport>): PersonFraudSummary[] {
  const map = new Map<string, PersonFraudSummary & { vendorAmounts: Map<string, number> }>();
  for (const d of active) {
    const r = byId.get(d.id);
    if (!r) continue;
    const name = d.performedByPersonnelName || d.supervisorName;
    if (!name) continue;
    const key = d.performedByPersonnelId || d.supervisorId || name;
    const role: PersonFraudSummary['role'] = d.performedByPersonnelName ? 'Personel' : 'Şef';
    let p = map.get(key);
    if (!p) {
      p = { personKey: key, personName: name, role, recordCount: 0, flaggedCount: 0, criticalCount: 0, claimedDiscount: 0, suspiciousAmount: 0, patternCounts: {}, vendorAmounts: new Map() };
      map.set(key, p);
    }
    p.recordCount++;
    p.claimedDiscount += r.claimedDiscount;
    const flagged = r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH';
    if (flagged) {
      p.flaggedCount++;
      p.suspiciousAmount += r.suspiciousAmount;
      if (r.riskLevel === 'CRITICAL') p.criticalCount++;
      for (const code of new Set(r.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').map(f => f.code))) {
        p.patternCounts[code] = (p.patternCounts[code] || 0) + 1;
      }
      const v = d.vendorName || '-';
      p.vendorAmounts.set(v, (p.vendorAmounts.get(v) || 0) + r.suspiciousAmount);
    }
  }
  return [...map.values()]
    .map(({ vendorAmounts, ...p }) => {
      const top = [...vendorAmounts.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        ...p,
        claimedDiscount: Number(p.claimedDiscount.toFixed(2)),
        suspiciousAmount: Number(p.suspiciousAmount.toFixed(2)),
        topVendor: top?.[0],
        topVendorShare: top && p.suspiciousAmount > 0 ? Number((top[1] / p.suspiciousAmount).toFixed(3)) : undefined
      };
    })
    .sort((a, b) => b.suspiciousAmount - a.suspiciousAmount || b.flaggedCount - a.flaggedCount);
}
