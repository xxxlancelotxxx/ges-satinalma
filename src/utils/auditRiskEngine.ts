import {
  convertMaterialUnit,
  normalizeStandardUnit
} from './constructionUnitConverter';

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

export interface AuditEvaluationInput {
  offerPrice?: number;
  agreedPrice?: number;
  discountPercentage?: number;
  category?: string;
  vendorName?: string;
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

      const comp = comparisons.find(
        (v: any) =>
          v?.materialName &&
          (v.materialName.toLowerCase().trim() === desc ||
           (desc.length > 3 && v.materialName.toLowerCase().includes(desc)) ||
           (v.materialName.length > 3 && desc.includes(v.materialName.toLowerCase())))
      );
      if (!comp) continue;

      const benchmarkAvg = Number(comp?.avgUnitPrice || comp?.avgPrice || 0);
      if (benchmarkAvg > 0) {
        const itemPrice = Number(item.unitPrice || 0);
        const itemUnit = item.unit || 'adet';
        const benchmarkUnit = comp.standardUnit || comp.unit || 'adet';

        // Akıllı şantiye birim dönüşümü (Örn: Rulo -> m², Metre -> Ton)
        const conv = convertMaterialUnit({
          materialName: item.description || item.materialName || comp.materialName,
          category: input.category || comp.category,
          fromUnit: itemUnit,
          toUnit: benchmarkUnit,
          unitPrice: itemPrice,
          quantity: Number(item.quantity) || 1
        });

        // Yalnızca birimler özdeşse veya başarıyla normalize edilebildiyse kıyasla
        if (conv.conversionApplied || normalizeStandardUnit(itemUnit) === normalizeStandardUnit(benchmarkUnit)) {
          const effectivePrice = conv.conversionApplied ? conv.convertedUnitPrice : itemPrice;
          const diff = ((effectivePrice - benchmarkAvg) / benchmarkAvg) * 100;
          if (diff > 30) {
            isSuspiciousPrice = true;
            const convNote = conv.conversionApplied ? ` (${itemPrice} ₽/${itemUnit} -> normalize: ${effectivePrice} ₽/${benchmarkUnit} [${conv.formula}])` : '';
            auditFlags.push(
              `'${item.description || item.materialName}' birim fiyatı (${effectivePrice} ₽/${benchmarkUnit}${convNote}) piyasa ortalamasından (${benchmarkAvg.toFixed(0)} ₽/${benchmarkUnit}) %${diff.toFixed(0)} daha yüksek.`
            );
            benchmarkComparison = {
              materialName: item.description || item.materialName,
              unit: benchmarkUnit,
              offeredUnitPrice: effectivePrice,
              currentUnitPrice: effectivePrice,
              benchmarkAvgPrice: benchmarkAvg,
              benchmarkMinPrice: comp.minPrice || comp.minUnitPrice,
              benchmarkMaxPrice: comp.maxPrice || comp.maxUnitPrice,
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
