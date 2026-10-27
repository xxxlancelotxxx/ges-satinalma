import { normalizeStandardUnit } from './constructionUnitConverter';
import {
  extractTechnicalStandardAndGrade,
  areTechnicalVariantsCompatible,
  formatTechnicalVariantBadges
} from './materialGroupIntegrity';
import { isSameMaterialLine, isExactUnitConversion, convertUnitPriceStrict, parsePurchaseDate } from './sameMaterialMatcher';

export const EXCESSIVE_DISCOUNT_THRESHOLD = 35;

export interface BenchmarkExemptionResult {
  isExempt: boolean;
  reason: 'LOGISTICS_SERVICE' | 'CUSTOM_FABRICATION_CAGE' | 'NONE';
  label: string;
  explanation: string;
}

/**
 * Lojistik/Nakliye hizmetleri ile özel imalat karkas/donatı kafeslerini
 * piyasa emsal kıyaslamasından muaf tutan adli denetçi filtresi.
 * 
 * 1. Nakliye & Transport: Mesafe, araç tipi, tonaj ve şantiye konumuna göre firmalar arasında
 *    büyük değişkenlik gösterdiği için haksız yere "şüpheli başlangıç fiyatı" sayılmamalıdır.
 * 2. Karkas & Donatı Kafesleri: Çizime ve projeye göre (KR-1 vb.) özel imalattır; her KR-1 farklı
 *    çap, boy ve ağırlık içerdiğinden genel emsal fiyatlarla kıyaslanamaz.
 */
export function isExemptFromBenchmarkAudit(
  materialNameOrDescription?: string,
  category?: string
): BenchmarkExemptionResult {
  const text = `${materialNameOrDescription || ''} ${category || ''}`.toLowerCase().trim();
  if (!text) {
    return {
      isExempt: false,
      reason: 'NONE',
      label: 'Standart Malzeme',
      explanation: 'Genel emsal denetimine tabidir.'
    };
  }

  // Fiziksel ürünleri koruma filtresi: 'taşıma arabası', 'taşıma çantası' vb. fiziksel araç ve gereçler hizmet DEĞİLDİR
  const isPhysicalEquipment =
    text.includes('taşıma arabas') ||
    text.includes('tasima arabas') ||
    text.includes('taşıma çantas') ||
    text.includes('tasima cantas') ||
    text.includes('taşıma sepet') ||
    text.includes('tasima sepet') ||
    text.includes('тележк') ||
    text.includes('тележка');

  // 1. Lojistik, Nakliye, Sevk ve Transport Hizmetleri
  // Nakliye ve transport hizmet giderleri firmalara ve ürüne/mesafeye göre çok değişkenlik gösterdiği için emsal kıyaslamasından muaftır.
  const isLogistics = !isPhysicalEquipment && (
    text.includes('nakliye') ||
    text.includes('nakliyat') ||
    text.includes('transport') ||
    text.includes('lojistik') ||
    text.includes('logistics') ||
    text.includes('доставка') ||
    text.includes('доставк') ||
    text.includes('перевозка') ||
    text.includes('перевозк') ||
    text.includes('транспорт') ||
    text.includes('teslimat') ||
    text.includes('sevkiyat') ||
    text.includes('sefer') ||
    text.includes('рейс') ||
    text.includes('kargo') ||
    text.includes('navlun') ||
    text.includes('freight') ||
    text.includes('taşıma') ||
    text.includes('tasima') ||
    text.includes('yük teslimat') ||
    text.includes('ürün nakliyesi') ||
    text.includes('araç ile nakliye') ||
    text.includes('vinç kiralama') ||
    text.includes('манипулятор') ||
    (category && (
      category.toLowerCase().includes('lojistik') ||
      category.toLowerCase().includes('nakliye') ||
      category.toLowerCase().includes('hizmet')
    ) && (text.includes('hizmet') || text.includes('bedel') || text.includes('ücret') || text.includes('ucret')))
  );

  if (isLogistics) {
    return {
      isExempt: true,
      reason: 'LOGISTICS_SERVICE',
      label: 'Lojistik / Nakliye Hizmeti (Muaf)',
      explanation: 'Mesafe, tonaj, araç cinsi ve şantiye konumuna göre serbest piyasada değişkenlik gösterir; emsal kıyaslamasından muaftır.'
    };
  }

  // 2. Özel İmalat Karkas & Donatı Kafesleri (KR-1, KR-2, K-1 vb.)
  // Karkas ve donatılar projeye ve çizime göre (k1, kr-1 vb.) özel üretim olup her biri farklı tip ve boyutta olduğundan fiyat farkları olağandır.
  const isCustomCage =
    text.includes('karkas') ||
    text.includes('каркас') ||
    text.includes('donatı kafes') ||
    text.includes('donati kafes') ||
    text.includes('donatı karkas') ||
    text.includes('donati karkas') ||
    text.includes('armatür karkas') ||
    text.includes('armatur karkas') ||
    text.includes('donatı sehpa') ||
    text.includes('donati sehpa') ||
    text.includes('donatı') && (text.includes('özel') || text.includes('ozel') || text.includes('imalat')) ||
    text.includes('лягушк') ||
    // Proje spesifik karkas kodları (KR-1, KR-2, KR1, K-1, КР-1, K1 vb.)
    /\b(kr|кр|karkas|каркас)[-\s]?[0-9]+/i.test(text) ||
    (/\b(k|к)[-\s]?[0-9]+\b/i.test(text) && (
      text.includes('donatı') ||
      text.includes('donati') ||
      text.includes('kafes') ||
      text.includes('çelik') ||
      text.includes('celik') ||
      text.includes('demir') ||
      text.includes('karkas') ||
      text.includes('арматур') ||
      text.includes('kot') ||
      text.includes('fr-') ||
      text.includes('ф-')
    ));

  if (isCustomCage) {
    return {
      isExempt: true,
      reason: 'CUSTOM_FABRICATION_CAGE',
      label: 'Özel İmalat Donatı Karkası/Kafesi (Muaf)',
      explanation: 'Statik proje çizimlerine göre özel imalattır (farklı çap, boy, ağırlık içerir); standart emsal fiyat kıyaslamasından muaftır.'
    };
  }

  return {
    isExempt: false,
    reason: 'NONE',
    label: 'Standart Malzeme',
    explanation: 'Genel piyasa emsal denetimine tabidir.'
  };
}

export function isLowPriorityConsumable(materialNameOrDescription?: string, category?: string): boolean {
  const text = `${materialNameOrDescription || ''} ${category || ''}`.toLowerCase();
  return /fairy|deterjan|bulaşık|bulasik|sabun|мыло|моющее\s*средство|туалетн.*бумаг|tuvalet\s*kağıd|kağıt\s*havlu|салфетк|peçete|çay\b|чай\b|kahve|кофе|şeker|сахар|içme\s*suyu|вода\s*питьев|bardak|стакан\s*однораз|çöp\s*poşet|мешк.*мусор|kırtasiye|ofis\s*&\s*kırtasiye|temizlik\s*&\s*hijyen/i.test(text);
}

export interface AuditEvaluationInput {
  offerPrice?: number;
  agreedPrice?: number;
  discountPercentage?: number;
  category?: string;
  vendorName?: string;
  orderDate?: string;
  invoiceNo?: string;
  items?: any[];
  existingAuditStatus?: string;
  existingIsFrozen?: boolean;
}

export interface BenchmarkComparisonInfo {
  materialName: string;
  unit?: string;
  offeredUnitPrice: number;
  currentUnitPrice: number;
  benchmarkAvgPrice: number;
  benchmarkMinPrice?: number;
  benchmarkMaxPrice?: number;
  diffPercentage: number;
  confidence?: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
  isExempt?: boolean;
  exemptionReason?: string;
}

export interface AuditEvaluationResult {
  auditStatus: 'NORMAL' | 'EXCESSIVE_DISCOUNT' | 'SUSPICIOUS_PRICE' | 'FLAGGED_BOTH' | 'EXECUTIVE_APPROVED';
  auditFlags: string[];
  isEffortScoreFrozen: boolean;
  benchmarkComparison?: BenchmarkComparisonInfo;
  exemptItemsCount?: number;
  exemptionNotes?: string[];
}

export function evaluateDiscountAudit(
  input: AuditEvaluationInput,
  comparisons: any[] = []
): AuditEvaluationResult {
  const auditFlags: string[] = [];
  const exemptionNotes: string[] = [];
  let isExcessive = false;
  let isSuspiciousPrice = false;
  let exemptCount = 0;

  const offerPrice = Number(input.offerPrice || 0);
  const agreedPrice = Number(input.agreedPrice || 0);
  const discountPercentage =
    input.discountPercentage !== undefined
      ? input.discountPercentage
      : offerPrice > 0
      ? ((offerPrice - agreedPrice) / offerPrice) * 100
      : 0;

  if (discountPercentage >= EXCESSIVE_DISCOUNT_THRESHOLD) {
    isExcessive = true;
    auditFlags.push(`%${discountPercentage.toFixed(1)} olağandışı yüksek iskonto oranı tespit edildi.`);
  }

  let benchmarkComparison: BenchmarkComparisonInfo | undefined;
  if (Array.isArray(input.items) && input.items.length > 0 && Array.isArray(comparisons) && comparisons.length > 0) {
    for (const item of input.items) {
      if (!item) continue;
      const desc = (item.description || item.materialName || '').toLowerCase().trim();
      if (!desc) continue;

      // 1. Nakliye / Lojistik ve Özel İmalat Karkas Muafiyet Kontrolü
      const exemption = isExemptFromBenchmarkAudit(desc, item.category || input.category);
      if (exemption.isExempt) {
        exemptCount++;
        exemptionNotes.push(`🛡️ '${item.description || item.materialName}': ${exemption.explanation}`);
        continue; // Emsal fiyat kıyaslamasından kesinlikle muaf tut, sahte şüpheli fiyat uyarısı üretme!
      }

      const itemPrice = Number(item.unitPrice || 0);
      const itemQty = Number(item.quantity || 1);
      const itemTotal = Number(item.totalPrice || (itemPrice * itemQty));
      const invAgreedTotal = Number(input.agreedPrice || input.offerPrice || 0);

      // Materiality guard: ignore minor ancillary items (< 5,000 ₽ or < 3% of invoice total) so tiny items never falsely taint a major invoice
      if (itemTotal < 5000 || (invAgreedTotal > 50000 && itemTotal < invAgreedTotal * 0.03)) {
        continue;
      }

      const itemVariant = extractTechnicalStandardAndGrade(
        item.originalName || item.originalMaterialName || '',
        item.description || item.materialName || ''
      );

      // Exact canonical material match only (never substring match!) + Technical Variant Lock (GOST/TU, Sort 1/2/3, Moisture, Species, Cross-Section)
      const comp = comparisons.find((v: any) => {
        if (!v?.materialName) return false;
        const vName = v.materialName.toLowerCase().trim();
        const vBase = vName.replace(/\s*\([^)]+\)\s*$/, '').replace(/\s*\[[^\]]+\]/g, '').trim();
        const dBase = desc.replace(/\s*\([^)]+\)\s*$/, '').replace(/\s*\[[^\]]+\]/g, '').trim();
        const baseMatch = vName === desc || (vBase.length >= 6 && vBase === dBase && !/\b\d+/.test(vName.replace(vBase, '')) && !/\b\d+/.test(desc.replace(dBase, '')));
        if (!baseMatch) return false;
        const vSampleOrig = Array.isArray(v.history) && v.history[0]?.originalName ? v.history[0].originalName : '';
        const vVariant = extractTechnicalStandardAndGrade(vSampleOrig, v.materialName);
        return areTechnicalVariantsCompatible(itemVariant, vVariant).compatible;
      });
      if (!comp) continue;
      const hasHistory = Array.isArray(comp.history) && comp.history.length >= 2;
      const hasSummaryAvg = !Array.isArray(comp.history) && Number(comp.avgUnitPrice || 0) > 0;
      if (!hasHistory && !hasSummaryAvg) continue;

      const itemUnit = item.unit || 'adet';
      const benchmarkUnit = comp.standardUnit || comp.unit || 'adet';

      // Fiyat uydurulmaz: yalnızca aynı birim veya kesin metrik ölçek (kg ⟷ ton) ile kıyaslanır
      const strictPrice = convertUnitPriceStrict(itemPrice, itemUnit, benchmarkUnit);
      const conv = {
        conversionApplied: strictPrice !== null && normalizeStandardUnit(itemUnit) !== normalizeStandardUnit(benchmarkUnit),
        convertedUnitPrice: strictPrice ?? 0,
        convertedQuantity: strictPrice ? (itemPrice * itemQty) / strictPrice : itemQty,
        formula: `${itemUnit} → ${benchmarkUnit}`
      };

      if (strictPrice !== null) {
        const effectivePrice = strictPrice;
        const curDateMs = parsePurchaseDate(input.orderDate) ?? 0;
        const itemLine = {
          originalName: item.originalName || item.originalMaterialName || item.description || item.materialName,
          materialName: item.description || item.materialName,
          category: item.category || input.category
        };

        let benchmarkAvg = 0;
        let benchmarkMin = 0;
        let benchmarkMax = 0;

        if (hasHistory) {
          // Sadece kendisi dışındaki, bu faturadan ÖNCE veya aynı dönemde alınmış ve teknik varyantı (GOST/TU, Sort 1/2/3, Nem, Kesit) uyumlu emsal faturaları baz al
          const otherHistory = comp.history.filter((h: any) => {
            const hPrice = Number(h.normalizedUnitPrice || h.unitPrice || 0);
            if (hPrice <= 0) return false;
            if (input.invoiceNo && h.invoiceNumber && String(h.invoiceNumber).trim() === String(input.invoiceNo).trim()) return false;
            if (curDateMs > 0 && h.date) {
              const hMs = parsePurchaseDate(h.date);
              // Kendisinden sonra alınmış faturalar geçmiş baz fiyatı olamaz
              if (hMs !== null && hMs > curDateMs) return false;
            }
            // Yalnızca gerçek kayıtlı fiyat: tahmini birim dönüşümü ve belgeyle doğrulanamamış satır baz olamaz
            if (h.invoiceLinesVerified === false || !isExactUnitConversion(h)) return false;
            // Ortak kural: aynı marka, model ve teknik özellikteki malzeme
            if (!isSameMaterialLine(itemLine, {
              originalName: h.rawOriginalName || h.originalName,
              materialName: h.rawMaterialName || comp.materialName,
              category: comp.category
            }).same) return false;
            const hVariant = extractTechnicalStandardAndGrade(
              h.rawOriginalName || h.originalName || '',
              h.rawMaterialName || comp.materialName || ''
            );
            if (!areTechnicalVariantsCompatible(itemVariant, hVariant).compatible) return false;
            return true;
          });

          if (otherHistory.length === 0) continue;

          const otherPrices = otherHistory.map((h: any) => Number(h.normalizedUnitPrice || h.unitPrice));
          benchmarkAvg = otherPrices.reduce((s: number, p: number) => s + p, 0) / otherPrices.length;
          benchmarkMin = Math.min(...otherPrices);
          benchmarkMax = Math.max(...otherPrices);
        } else {
          // Satır bazında doğrulanmış geçmiş yoksa grup ortalaması (farklı marka/özellik karışık olabilir) baz alınmaz
          continue;
        }

        if (benchmarkAvg > 0) {
          const diff = ((effectivePrice - benchmarkAvg) / benchmarkAvg) * 100;
          if (diff > 35 && (effectivePrice - benchmarkAvg) * (conv.conversionApplied ? conv.convertedQuantity : itemQty) >= 5000) {
            isSuspiciousPrice = true;
            const convNote = conv.conversionApplied ? ` (${itemPrice} ₽/${itemUnit} -> normalize: ${effectivePrice} ₽/${benchmarkUnit} [${conv.formula}])` : '';
            const badgeStr = formatTechnicalVariantBadges(itemVariant);
            const rawDisplayMat = item.description || item.materialName || comp.materialName;
            const displayMat = badgeStr && !rawDisplayMat.includes(badgeStr) ? `${rawDisplayMat} ${badgeStr}` : rawDisplayMat;
            auditFlags.push(
              `'${displayMat}' birim fiyatı (${effectivePrice.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₽/${benchmarkUnit}${convNote}) emsal piyasa ortalamasından (${benchmarkAvg.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₽/${benchmarkUnit}) %${diff.toFixed(1)} daha yüksek.`
            );
            benchmarkComparison = {
              materialName: displayMat,
              unit: benchmarkUnit,
              offeredUnitPrice: effectivePrice,
              currentUnitPrice: effectivePrice,
              benchmarkAvgPrice: benchmarkAvg,
              benchmarkMinPrice: benchmarkMin,
              benchmarkMaxPrice: benchmarkMax,
              diffPercentage: diff,
              confidence: 'HIGH'
            };
            break;
          }
        }
      }
    }
  }

  let auditStatus: 'NORMAL' | 'EXCESSIVE_DISCOUNT' | 'SUSPICIOUS_PRICE' | 'FLAGGED_BOTH' = 'NORMAL';
  if (isExcessive && isSuspiciousPrice) {
    auditStatus = 'FLAGGED_BOTH';
  } else if (isExcessive) {
    auditStatus = 'EXCESSIVE_DISCOUNT';
  } else if (isSuspiciousPrice) {
    auditStatus = 'SUSPICIOUS_PRICE';
  }

  return {
    auditStatus,
    auditFlags,
    isEffortScoreFrozen: auditStatus !== 'NORMAL',
    benchmarkComparison,
    exemptItemsCount: exemptCount,
    exemptionNotes
  };
}
