import {
  CanonicalLineMatch,
  CanonicalMaterial,
  ComparativeDocument,
  ComparativeAnalysisSummary,
  TechnicalSpecs
} from '../types';
import { convertMaterialUnit } from './constructionUnitConverter';
import {
  extractTechnicalStandardAndGrade,
  areTechnicalVariantsCompatible
} from './materialGroupIntegrity';
export { convertMaterialUnit };

/**
 * Standardizes units to a common canonical unit for comparison
 */
export function normalizeUnit(unitStr: string): string {
  if (!unitStr) return 'adet';
  const clean = unitStr.toLowerCase().trim();
  if (['т', 'тн', 'тонн', 'тонна', 'ton', 'tonnes', 'tn'].includes(clean)) return 'ton';
  if (['кг', 'kg', 'килограмм'].includes(clean)) return 'kg';
  if (['м3', 'м³', 'm3', 'куб', 'куб.м', 'куб.м.'].includes(clean)) return 'm³';
  if (['шт', 'шт.', 'adet', 'pcs', 'штук', 'штука'].includes(clean)) return 'adet';
  if (['пар', 'пара', 'пары', 'пар.', 'çift', 'cift'].includes(clean)) return 'çift';
  if (['м', 'м.', 'м.п.', 'm', 'metre', 'метр', 'пог.м'].includes(clean)) return 'm';
  if (['м2', 'м²', 'm2', 'кв.м', 'кв.м.'].includes(clean)) return 'm²';
  if (['л', 'л.', 'litre', 'литр'].includes(clean)) return 'l';
  if (['меш', 'мешок', 'torba', 'bag'].includes(clean)) return 'torba';
  if (['компл', 'комплект', 'set', 'takım'].includes(clean)) return 'takım';
  return clean;
}

/**
 * Normalizes price and quantity across compatible units (e.g. kg <-> ton, metre <-> ton, rulo <-> m2)
 */
export function normalizeQuantityAndPrice(
  qty: number,
  unitPrice: number,
  originalUnit: string,
  targetUnit: string,
  materialName: string = '',
  category: string = ''
): { normalizedQty: number; normalizedUnitPrice: number; conversionApplied: boolean; factor: number; formula?: string } {
  const result = convertMaterialUnit({
    materialName,
    category,
    fromUnit: originalUnit,
    toUnit: targetUnit,
    unitPrice,
    quantity: qty
  });

  return {
    normalizedQty: result.convertedQuantity,
    normalizedUnitPrice: result.convertedUnitPrice,
    conversionApplied: result.conversionApplied,
    factor: result.factor,
    formula: result.formula
  };
}

/**
 * Russian/Turkish construction technical specification extractor
 */
export function extractTechnicalSpecs(text: string): TechnicalSpecs {
  if (!text) return {};
  const specs: TechnicalSpecs = {};
  const normalized = text.replace(/[\t\r\n]+/g, ' ');

  // 1. Diameter: e.g. d 12 мм, d=14, Ø12, ф 16, ф12, 12 мм
  const diameterMatch = normalized.match(/(?:[dдфødDФØ]\s*[:=]?\s*|[фØd])(\d+(?:[.,]\d+)?)\s*(?:мм|mm)?(?:$|[^a-zA-Zа-яА-Я0-9])/i) ||
                        normalized.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+(?:[.,]\d+)?)\s*(?:мм|mm)(?:$|[^a-zA-Zа-яА-Я0-9])/i);
  if (diameterMatch && diameterMatch[1]) {
    const val = diameterMatch[1].replace(',', '.');
    const num = parseFloat(val);
    if (num >= 1 && num <= 3000) {
      specs.diameter = `Ø${val} mm`;
    }
  }

  // 2. Grade/Quality: e.g. A500C, А500С, A400, А240, B25, В25, M300, М300, D500, D600
  const gradeMatch = normalized.match(/(?:^|[^a-zA-Zа-яА-Я0-9])([AА]\s*500\s*[CС]|[AА]\s*500|[AА]\s*400|[AА]\s*240|[BВ]\s*25|[BВ]\s*20|[BВ]\s*30|[MМ]\s*300|[MМ]\s*350|[CD]\s*500|[CD]\s*600|C\s*25\/30)(?:$|[^a-zA-Zа-яА-Я0-9])/i);
  if (gradeMatch && gradeMatch[1]) {
    const cleanGrade = gradeMatch[1].toUpperCase().replace(/\s+/g, '').replace('А', 'A').replace('С', 'C').replace('В', 'B').replace('М', 'M');
    specs.grade = cleanGrade;
  }

  // 3. Standard & Technical Variant: e.g. GOST 34028, ГОСТ, ТУ, Sort 1/2/3
  const techVariant = extractTechnicalStandardAndGrade(normalized);
  const gostMatch = normalized.match(/(?:ГОСТ|GOST)\s*([0-9]+(?:-[0-9]+)?)/i);
  if (gostMatch && gostMatch[1]) {
    specs.standard = `ГОСТ ${gostMatch[1]}`;
  } else if (techVariant.standardCode) {
    specs.standard = techVariant.standardCode;
  } else if (techVariant.standardType) {
    specs.standard = techVariant.standardType;
  }
  if (!specs.grade && techVariant.qualityGrade) {
    specs.grade = techVariant.qualityGrade;
  }

  // 4. Dimensions / Length: e.g. 4x6m, 4х6 м, 11.7m, 11700, 600x300x200
  if (techVariant.crossSectionDims && techVariant.isTimber) {
    specs.dimensions = techVariant.crossSectionDims;
  } else {
    const dimMatch = normalized.match(/(?:размер\s*)?\b(\d{1,4}(?:[.,]\d+)?\s*[xх*×]\s*\d{1,4}(?:[.,]\d+)?(?:\s*[xх*×]\s*\d{1,4}(?:[.,]\d+)?)?)\s*(?:м\b|m\b|мм\b|mm\b)?/i);
    if (dimMatch && dimMatch[1]) {
      specs.dimensions = dimMatch[1].replace(/\s+/g, '').toLowerCase().replace(/[х*×]/g, 'x');
    } else {
      const lengthMatch = normalized.match(/\b(11[.,]7\s*м|11700\s*(?:мм)?|12\s*м|6\s*м)\b/i);
      if (lengthMatch && lengthMatch[1]) {
        specs.dimensions = lengthMatch[1].replace(/\s+/g, '');
      }
    }
  }

  return specs;
}

/**
 * Classifies raw text into a standardized material category
 */
export function detectMaterialType(text: string): string {
  if (!text) return 'Diğer Malzeme';
  const lower = text.toLowerCase();

  if (/тент|полог|оксфорд|тарпаулин|branda|tente|çadır/i.test(lower)) {
    return 'Yalıtımlı PVC Branda & Tente';
  }
  if (/арматур|армирован|сталь.*периодическ|a500c|а500с|строительн.*сталь|nervürlü.*demir|inşaat.*demir/i.test(lower)) {
    return 'İnşaat Demiri';
  }
  if (/бетон|b25|в25|b20|в20|b30|в30|раствор|hazır beton/i.test(lower)) {
    return 'Hazır Beton';
  }
  if (/газобетон|газоблок|d500|d600|блок.*ячеист|gazbeton|gazblok/i.test(lower)) {
    return 'Gazbeton / Gazblok';
  }
  if (/проволок|отожжен|вязан|bağlama.*tel|tavlı.*tel/i.test(lower)) {
    return 'Bağlama Teli';
  }
  if (/сетк|кладочн|сварн|hasır.*çelik/i.test(lower)) {
    return 'Hasır Çelik';
  }
  if (/труб|профил|швеллер|уголок|балк|двутавр|profil|boru/i.test(lower)) {
    return 'Profil & Boru';
  }
  if (/утеплител|утеплен|минераловат|минват|пеноплекс|пенополистирол|taşyünü|izolasyon|yalıtım/i.test(lower)) {
    return 'Yalıtım & İzolasyon';
  }
  if (/кирпич|tuğla/i.test(lower)) {
    return 'Tuğla';
  }

  return 'Genel Malzeme';
}

/**
 * Computes hybrid match score between two material line descriptions
 */
export function calculateMatchScore(
  lineA: { description: string; specs?: TechnicalSpecs; unit?: string },
  lineB: { description: string; specs?: TechnicalSpecs; unit?: string }
): { score: number; reason: string; commonName: string } {
  const specsA = lineA.specs || extractTechnicalSpecs(lineA.description);
  const specsB = lineB.specs || extractTechnicalSpecs(lineB.description);

  const techA = extractTechnicalStandardAndGrade(lineA.description || '');
  const techB = extractTechnicalStandardAndGrade(lineB.description || '');
  const techCompat = areTechnicalVariantsCompatible(techA, techB);
  if (!techCompat.compatible) {
    return {
      score: 0.0,
      reason: techCompat.conflictReason || 'Teknik standart / kalite sınıfı uyuşmazlığı',
      commonName: lineA.description
    };
  }

  const typeA = detectMaterialType(lineA.description);
  const typeB = detectMaterialType(lineB.description);

  if (typeA !== typeB && typeA !== 'Genel Malzeme' && typeB !== 'Genel Malzeme') {
    return {
      score: 0.15,
      reason: `Farklı malzeme türü: ${typeA} vs ${typeB}`,
      commonName: lineA.description
    };
  }

  let score = 0.50;
  const reasons: string[] = [];

  if (typeA === typeB) {
    score += 0.25;
    reasons.push(`Aynı malzeme türü (${typeA})`);
  }

  // Numeric signature check: different numbers (e.g. 92 mm vs 54 mm vs 400 mm vs 10x150/210) must never match
  const extractNums = (s: string) => {
    let cleaned = s.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
    if (typeA === 'İnşaat Demiri' && typeB === 'İnşaat Demiri') {
      cleaned = cleaned
        .replace(/(?:гост|gost)\s*\d+(?:-\d+)?/gi, ' ')
        .replace(/[aа]\s*(?:500\s*[cс]?|400|240)/gi, ' ')
        .replace(/(?:^|[^0-9])11\.7\s*[мm](?![a-zа-яё0-9])/gi, ' ');
    }
    return Array.from(
      new Set(
        (cleaned.match(/\d+(?:\.\d+)?/g) || [])
          .map(n => String(Number(n)))
          .filter(n => n !== 'NaN')
      )
    )
      .sort((a, b) => Number(a) - Number(b))
      .join('|');
  };
  const numsA = extractNums(lineA.description || '');
  const numsB = extractNums(lineB.description || '');
  if ((numsA || numsB) && numsA !== numsB) {
    return {
      score: 0.0,
      reason: `Sayısal/ölçü değerleri farklı: [${numsA}] vs [${numsB}]`,
      commonName: lineA.description
    };
  }

  // Diameter check
  if (specsA.diameter && specsB.diameter) {
    if (specsA.diameter === specsB.diameter) {
      score += 0.20;
      reasons.push(`Çap birebir eşleşiyor (${specsA.diameter})`);
    } else {
      return {
        score: 0.0,
        reason: `Çap uyumsuzluğu: ${specsA.diameter} vs ${specsB.diameter}`,
        commonName: lineA.description
      };
    }
  }

  // Grade check (A500C, etc.)
  if (specsA.grade && specsB.grade) {
    if (specsA.grade === specsB.grade) {
      score += 0.15;
      reasons.push(`Kalite sınıfı aynı (${specsA.grade})`);
    } else {
      return {
        score: 0.0,
        reason: `Kalite sınıfı farklı: ${specsA.grade} vs ${specsB.grade}`,
        commonName: lineA.description
      };
    }
  }

  // Standard check (GOST 34028)
  if (specsA.standard && specsB.standard) {
    if (specsA.standard === specsB.standard) {
      score += 0.10;
      reasons.push(`Standart aynı (${specsA.standard})`);
    } else {
      return {
        score: 0.0,
        reason: `Standart farklı: ${specsA.standard} vs ${specsB.standard}`,
        commonName: lineA.description
      };
    }
  }

  // Dimensions check
  const normDim = (d?: string) => (d || '').toLowerCase().replace(/[х*×]/g, 'x').replace(/[мm]/g, '').trim();
  if (specsA.dimensions && specsB.dimensions) {
    if (normDim(specsA.dimensions) === normDim(specsB.dimensions)) {
      score += 0.18;
      reasons.push(`Ebat/Uzunluk eşleşiyor (${specsA.dimensions})`);
    } else {
      return {
        score: 0.0,
        reason: `Ebat/Uzunluk farklı: ${specsA.dimensions} vs ${specsB.dimensions}`,
        commonName: lineA.description
      };
    }
  }

  const finalScore = Math.min(1.0, Math.max(0.0, score));

  // Build a clean canonical name
  const nameParts = [typeA];
  if (specsA.grade || specsB.grade) nameParts.push(specsA.grade || specsB.grade!);
  if (specsA.diameter || specsB.diameter) nameParts.push(specsA.diameter || specsB.diameter!);
  if (specsA.dimensions || specsB.dimensions) nameParts.push(specsA.dimensions || specsB.dimensions!);
  if (specsA.standard || specsB.standard) nameParts.push(specsA.standard || specsB.standard!);

  return {
    score: Number(finalScore.toFixed(2)),
    reason: reasons.join(', ') || 'Metin ve teknik özellik benzerliği',
    commonName: nameParts.join(' ')
  };
}

/**
 * Normalizes price for VAT differences.
 * If base comparison is VAT-included (standard in Russia), and an offer is without VAT (без НДС),
 * add the standard 20% VAT to compare fairly on the same footing.
 */
export function normalizeVatPrice(
  rawUnitPrice: number,
  isVatIncluded: boolean,
  targetVatIncluded = true,
  vatRate = 0.20
): { normalizedPrice: number; vatAdjusted: boolean; note?: string } {
  if (isVatIncluded === targetVatIncluded) {
    return { normalizedPrice: rawUnitPrice, vatAdjusted: false };
  }

  if (!isVatIncluded && targetVatIncluded) {
    const adjusted = rawUnitPrice * (1 + vatRate);
    return {
      normalizedPrice: Number(adjusted.toFixed(2)),
      vatAdjusted: true,
      note: `KDV hariç fiyata %${vatRate * 100} KDV eklenerek normalize edildi`
    };
  }

  if (isVatIncluded && !targetVatIncluded) {
    const adjusted = rawUnitPrice / (1 + vatRate);
    return {
      normalizedPrice: Number(adjusted.toFixed(2)),
      vatAdjusted: true,
      note: `KDV dahil fiyattan %${vatRate * 100} KDV düşülerek normalize edildi`
    };
  }

  return { normalizedPrice: rawUnitPrice, vatAdjusted: false };
}

export interface ComparativeCalculationInput {
  canonicalMaterials: CanonicalMaterial[];
  documents: ComparativeDocument[];
  winningSupplier?: string;
  thresholdRub?: number;
}

export interface ComparativeCalculationOutput {
  canonicalMaterials: CanonicalMaterial[];
  summary: ComparativeAnalysisSummary;
  winningSupplier: string;
  isSingleVendor: boolean;
  thresholdApplied: {
    thresholdRub: number;
    isOverThreshold: boolean;
    isMandatory: boolean;
  };
  auditLogEntries: string[];
}

/**
 * Core mathematical engine for Comparative Offer & Real Savings Analysis
 * Implements:
 * 1. referans_birim_fiyat = MIN(geçerli ve normalize edilmiş ilk teklif birim fiyatları)
 * 2. son_birim_fiyat = satın alınan firmanın normalize edilmiş son birim fiyatı
 * 3. gerçek_birim_kazanım = referans_birim_fiyat - son_birim_fiyat
 * 4. gerçek_toplam_kazanım = gerçek_birim_kazanım * satın_alınan_miktar
 * 5. gerçek_indirim_oranı = (gerçek_birim_kazanım / referans_birim_fiyat) * 100
 * 6. firma_içi_birim_indirim = satın_alınan_firmanın_ilk_teklifi - son_birim_fiyat (Bilgi amaçlı)
 * 7. Negative results: preserve exact value, do not zero out, flag as warning
 * 8. Single vendor: no market savings generated, label as single vendor
 */
export function calculateComparativeSavings(
  input: ComparativeCalculationInput | ComparativeDocument[],
  maybeMaterials?: CanonicalMaterial[]
): ComparativeCalculationOutput {
  let docs: ComparativeDocument[] = [];
  let materials: CanonicalMaterial[] = [];
  let thresholdRub = 1000000;
  let winningSupplierInput = '';

  if (Array.isArray(input)) {
    docs = input;
    materials = maybeMaterials || [];
  } else {
    thresholdRub = input.thresholdRub ?? 1000000;
    docs = input.documents || [];
    materials = input.canonicalMaterials || [];
    winningSupplierInput = input.winningSupplier || '';
  }

  const formatVendorDisplay = (v?: string): string => {
    if (!v) return '';
    let s = String(v).trim();
    const quoteCount = (s.match(/"/g) || []).length;
    if (quoteCount % 2 === 1 && !s.endsWith('"')) {
      s = `${s}"`;
    }
    return s;
  };

  // Determine distinct vendors from active non-excluded documents
  const activeDocs = docs.filter(d => !d.isExcluded).map(d => ({
    ...d,
    supplier: formatVendorDisplay(d.supplier)
  }));
  const distinctVendors = Array.from(new Set(activeDocs.map(d => d.supplier).filter(Boolean)));
  const isSingleVendor = distinctVendors.length <= 1;

  // Determine winning/purchased supplier
  // Priority: 1. Vendor with FINAL_INVOICE or FINAL_OFFER, 2. Input winningSupplier, 3. First vendor
  const finalDocCandidate = activeDocs.find(d => d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER');
  let winningSupplier = formatVendorDisplay(finalDocCandidate?.supplier || winningSupplierInput || distinctVendors[0] || '');

  let totalFinalPurchase = 0;
  let totalInitialLowestOffer = 0;
  let realMarketSavings = 0;
  let internalVendorSavings = 0;
  let isAboveBestOfferCount = 0;
  let pendingApprovalsCount = 0;
  const auditLogEntries: string[] = [];

  const updatedMaterials: CanonicalMaterial[] = materials.map((mat, idx) => {
    const lines = mat.lines || [];
    const validLines = lines.filter(l => {
      const doc = docs.find(d => d.id === l.documentId);
      return doc ? !doc.isExcluded : true;
    });

    // 1. Determine purchased final line
    // Looking for winning supplier's final offer or latest round
    let finalLine = validLines.find(
      l => l.supplierName === winningSupplier &&
           (l.documentRole === 'FINAL_INVOICE' || l.documentRole === 'FINAL_OFFER')
    );

    // Fallback: latest line from winning supplier
    if (!finalLine) {
      const winningLines = validLines.filter(l => l.supplierName === winningSupplier);
      if (winningLines.length > 0) {
        finalLine = winningLines[winningLines.length - 1];
      }
    }

    // Determine purchased quantity & unit price strictly prioritizing agreed offer / final purchase
    const purchasedQuantity = finalLine
      ? (finalLine.normalizedQuantity || finalLine.quantity)
      : (mat.purchasedQuantity && mat.purchasedQuantity > 0
          ? mat.purchasedQuantity
          : (mat.quantity || (validLines[0] ? (validLines[0].normalizedQuantity || validLines[0].quantity) : 0)));

    const purchasedUnitPrice = finalLine
      ? (finalLine.normalizedUnitPrice || finalLine.rawUnitPrice)
      : (mat.purchasedUnitPrice && mat.purchasedUnitPrice > 0
          ? mat.purchasedUnitPrice
          : (validLines[0] ? (validLines[0].normalizedUnitPrice || validLines[0].rawUnitPrice) : 0));

    const purchasedLineTotal = purchasedQuantity * purchasedUnitPrice;

    // 2. Determine initial offers across all valid suppliers
    // Lines that represent initial offers: role === 'FIRST_OFFER' or 'COMPETITOR_FIRST_OFFER' or marked isInitialOffer
    const initialOfferLines = validLines.filter(
      l => l.isInitialOffer ||
           l.documentRole === 'FIRST_OFFER' ||
           l.documentRole === 'COMPETITOR_FIRST_OFFER'
    );

    // 3. Find MIN(valid initial offers) as market reference price
    let marketReferenceUnitPrice = 0;
    let marketReferenceSupplier = '';

    if (initialOfferLines.length > 0) {
      // Group by supplier to take each supplier's initial offer
      const supplierOffers = new Map<string, { price: number; line: CanonicalLineMatch }>();
      initialOfferLines.forEach(l => {
        const p = l.normalizedUnitPrice || l.rawUnitPrice;
        if (p > 0) {
          if (!supplierOffers.has(l.supplierName) || p < supplierOffers.get(l.supplierName)!.price) {
            supplierOffers.set(l.supplierName, { price: p, line: l });
          }
        }
      });

      if (supplierOffers.size > 0) {
        // Find absolute MIN among all suppliers' initial offers
        let minPrice = Infinity;
        let minSup = '';
        supplierOffers.forEach((val, sup) => {
          if (val.price < minPrice) {
            minPrice = val.price;
            minSup = sup;
          }
        });

        if (minPrice !== Infinity) {
          marketReferenceUnitPrice = minPrice;
          marketReferenceSupplier = minSup;
        }
      }
    }

    // 4. Find winning supplier's own initial offer for internal discount calculation
    const winningFirstLine = validLines.find(
      l => l.supplierName === winningSupplier &&
           (l.documentRole === 'FIRST_OFFER' || l.isInitialOffer)
    );
    const winningFirstUnitPrice = winningFirstLine
      ? (winningFirstLine.normalizedUnitPrice || winningFirstLine.rawUnitPrice)
      : (marketReferenceUnitPrice || purchasedUnitPrice);

    // 5. Calculations
    let realUnitSavings = 0;
    let realTotalSavings = 0;
    let realSavingsPercentage = 0;
    let isAboveBestOffer = false;
    let warningMessage = '';

    if (!isSingleVendor && marketReferenceUnitPrice > 0) {
      // Real market savings = Reference Price - Final Purchased Price
      realUnitSavings = marketReferenceUnitPrice - purchasedUnitPrice;
      realTotalSavings = realUnitSavings * purchasedQuantity;
      realSavingsPercentage = Number(((realUnitSavings / marketReferenceUnitPrice) * 100).toFixed(2));

      // If purchased price is higher than reference: negative result!
      if (purchasedUnitPrice > marketReferenceUnitPrice) {
        isAboveBestOffer = true;
        isAboveBestOfferCount += 1;
        warningMessage = `En iyi ilk teklif üzerinde kapanış (+${(purchasedUnitPrice - marketReferenceUnitPrice).toLocaleString('tr-TR')} ₽/birim)`;
      }
    } else if (isSingleVendor) {
      // Single vendor: no market savings generated
      realUnitSavings = 0;
      realTotalSavings = 0;
      realSavingsPercentage = 0;
      warningMessage = 'Tek tedarikçi: Rakip teklif bulunmadığı için piyasa bazlı kazanım hesaplanamadı';
    }

    // Internal vendor discount (for information only)
    const internalVendorUnitDiscount = Math.max(0, winningFirstUnitPrice - purchasedUnitPrice);
    const internalVendorTotalDiscount = internalVendorUnitDiscount * purchasedQuantity;

    // Check approval status
    if (mat.status === 'needs_confirmation') {
      pendingApprovalsCount += 1;
    }

    // Accumulate totals
    totalFinalPurchase += purchasedLineTotal;
    totalInitialLowestOffer += (marketReferenceUnitPrice > 0 ? marketReferenceUnitPrice : winningFirstUnitPrice) * purchasedQuantity;
    realMarketSavings += realTotalSavings;
    internalVendorSavings += internalVendorTotalDiscount;

    auditLogEntries.push(
      `[Kalem ${idx + 1}] ${mat.commonName}: Referans ${marketReferenceUnitPrice} ₽ (${marketReferenceSupplier || 'Yok'}), Son ${purchasedUnitPrice} ₽ -> Gerçek Kazanım: ${realTotalSavings} ₽`
    );

    return {
      ...mat,
      canonicalName: mat.commonName,
      quantity: purchasedQuantity,
      purchasedQuantity,
      purchasedUnitPrice,
      purchasedSupplier: winningSupplier,
      marketReferenceUnitPrice,
      marketReferenceSupplier,
      winningFirstUnitPrice,
      realUnitSavings,
      realTotalSavings,
      realSavingsAmount: realTotalSavings,
      realSavingsPercentage,
      realSavingsRate: realSavingsPercentage,
      internalVendorUnitDiscount,
      internalVendorTotalDiscount,
      isAboveBestOffer,
      aboveBestOfferDiff: isAboveBestOffer ? (purchasedUnitPrice - marketReferenceUnitPrice) : 0,
      warningMessage,
      lowestInitialOffer: {
        vendorName: marketReferenceSupplier || 'En Düşük İlk Teklif',
        normalizedUnitPrice: marketReferenceUnitPrice,
        totalPrice: marketReferenceUnitPrice * purchasedQuantity
      },
      finalPurchased: {
        vendorName: winningSupplier,
        normalizedUnitPrice: purchasedUnitPrice,
        totalPrice: purchasedLineTotal
      }
    };
  });

  // 1. Identify final invoice / final offer document (winning supplier)
  const finalDoc = activeDocs.find(d => d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER') || activeDocs[activeDocs.length - 1];
  if (!winningSupplier && finalDoc) {
    winningSupplier = finalDoc.supplier || (distinctVendors[0] || 'Seçilen Tedarikçi');
  }

  // 2. Identify all initial offer documents
  const initialDocs = activeDocs.filter(d =>
    d.id !== finalDoc?.id &&
    (d.documentRole === 'FIRST_OFFER' ||
     d.documentRole === 'COMPETITOR_FIRST_OFFER' ||
     d.documentRole === 'INITIAL_OFFER' ||
     (d as any).isInitialOffer ||
     (!d.documentRole?.startsWith('DISCOUNT_ROUND_') && d.documentRole !== 'INTERMEDIATE_ROUND'))
  );

  // 3. Identify all intermediate negotiation round documents
  const intermediateDocs = activeDocs.filter(d =>
    d.id !== finalDoc?.id &&
    (d.documentRole === 'INTERMEDIATE_ROUND' ||
     d.documentRole?.startsWith('DISCOUNT_ROUND_'))
  );

  // Build intermediate rounds list with sequential numbering
  const intermediateRoundsList: any[] = intermediateDocs.map((doc, idx) => ({
    roundNumber: idx + 1,
    documentId: doc.id,
    documentRole: `DISCOUNT_ROUND_${idx + 1}`,
    supplier: doc.supplier || winningSupplier,
    amount: doc.totalAmount || 0,
    documentNumber: doc.documentNumber,
    date: doc.date,
    fileName: doc.fileName,
    note: `${idx + 1}. Ara Pazarlık Turu: ${doc.supplier || winningSupplier}`
  }));

  const negotiationRoundsCount = intermediateDocs.length;

  // Find lowest initial offer document
  let lowestInitialAmount = 0;
  let lowestInitialSupplier = '';
  let lowestInitialDoc: ComparativeDocument | undefined = undefined;

  if (initialDocs.length > 0) {
    // Pick the document with lowest positive totalAmount
    const docsWithAmount = initialDocs.filter(d => d.totalAmount > 0);
    if (docsWithAmount.length > 0) {
      lowestInitialDoc = docsWithAmount.reduce((min, cur) => cur.totalAmount < min.totalAmount ? cur : min, docsWithAmount[0]);
      lowestInitialAmount = lowestInitialDoc.totalAmount;
      lowestInitialSupplier = lowestInitialDoc.supplier;
    } else {
      lowestInitialDoc = initialDocs[0];
      lowestInitialAmount = lowestInitialDoc.totalAmount || 0;
      lowestInitialSupplier = lowestInitialDoc.supplier;
    }
  }

  // Build initial offers list for visual comparison
  const initialOffersList: any[] = initialDocs.map(doc => ({
    documentId: doc.id,
    supplier: doc.supplier,
    amount: doc.totalAmount || 0,
    isLowest: doc.id === lowestInitialDoc?.id || (lowestInitialAmount > 0 && doc.totalAmount === lowestInitialAmount),
    documentNumber: doc.documentNumber,
    date: doc.date,
    fileName: doc.fileName
  }));

  // SMART FALLBACK & DOCUMENT-LEVEL PRECISION:
  // If line-item extraction produced 0 totals or no valid items,
  // OR if document-level totals are provided, align totals with lowest initial offer vs final invoice
  const finalAmount = finalDoc?.totalAmount || 0;
  let finalMaterials = updatedMaterials;

  if ((totalFinalPurchase === 0 || totalInitialLowestOffer === 0 || updatedMaterials.length === 0) && finalAmount > 0) {
    const baselineAmount = lowestInitialAmount > 0 ? lowestInitialAmount : finalAmount;
    const baselineSupplier = lowestInitialSupplier || winningSupplier;

    totalFinalPurchase = finalAmount;
    totalInitialLowestOffer = baselineAmount;
    realMarketSavings = Math.max(0, baselineAmount - finalAmount);
    internalVendorSavings = realMarketSavings;

    const rate = baselineAmount > 0 ? Number(((realMarketSavings / baselineAmount) * 100).toFixed(2)) : 0;

    finalMaterials = [{
      id: `can_mat_fallback_${Date.now()}`,
      commonName: `${winningSupplier} Fatura / Teklif Kapsamı (Genel Malzeme Alımı)`,
      canonicalName: `${winningSupplier} Fatura / Teklif Kapsamı (Genel Malzeme Alımı)`,
      materialType: 'Fatura Kapsamı',
      standardUnit: 'paket',
      specs: {},
      purchasedQuantity: 1,
      quantity: 1,
      purchasedUnitPrice: finalAmount,
      purchasedSupplier: winningSupplier,
      marketReferenceUnitPrice: baselineAmount,
      marketReferenceSupplier: baselineSupplier,
      winningFirstUnitPrice: baselineAmount,
      realUnitSavings: realMarketSavings,
      realTotalSavings: realMarketSavings,
      realSavingsAmount: realMarketSavings,
      realSavingsPercentage: rate,
      realSavingsRate: rate,
      internalVendorUnitDiscount: realMarketSavings,
      internalVendorTotalDiscount: realMarketSavings,
      isAboveBestOffer: finalAmount > baselineAmount,
      aboveBestOfferDiff: finalAmount > baselineAmount ? (finalAmount - baselineAmount) : 0,
      status: 'confirmed',
      matchConfidence: 1.0,
      matchReason: 'Belge genel toplamları üzerinden en düşük ilk teklif kıyaslaması',
      lowestInitialOffer: {
        vendorName: baselineSupplier,
        normalizedUnitPrice: baselineAmount,
        totalPrice: baselineAmount
      },
      finalPurchased: {
        vendorName: winningSupplier,
        normalizedUnitPrice: finalAmount,
        totalPrice: finalAmount
      },
      lines: []
    }];

    auditLogEntries.push(
      `[En Uygun İlk Teklif Bazlı Kıyaslama] En Düşük İlk Teklif: ${baselineAmount} ₽ (${baselineSupplier}), Son Fatura: ${finalAmount} ₽ (${winningSupplier}) -> Net İndirim: ${realMarketSavings} ₽ (%${rate}), Ara Pazarlık Turu: ${negotiationRoundsCount}`
    );
  } else if (lowestInitialAmount > 0 && finalAmount > 0) {
    // If line items were not present or produced zero totals, use document totals
    if (updatedMaterials.length === 0 || totalFinalPurchase === 0 || totalInitialLowestOffer === 0) {
      totalFinalPurchase = finalAmount;
      totalInitialLowestOffer = lowestInitialAmount;
      realMarketSavings = Math.max(0, Number((lowestInitialAmount - finalAmount).toFixed(2)));
      internalVendorSavings = realMarketSavings;
    } else {
      // Line items exist and represent the agreed purchase scope.
      if (Math.abs(totalFinalPurchase - finalAmount) > 0.01 && Math.abs(totalFinalPurchase - finalAmount) < 10) {
        totalFinalPurchase = finalAmount;
      }
      // If there is a valid lowest initial offer document covering the same item scope whose total is lower than the line-item sum
      // (e.g. due to unit rounding or an unmatched/differently-packaged single-item competitor offer), enforce the true lowest initial offer (Dip Fiyat)!
      if (lowestInitialDoc && lowestInitialAmount < totalInitialLowestOffer && (updatedMaterials.length === 1 || (lowestInitialDoc.items?.length || 0) >= updatedMaterials.length)) {
        totalInitialLowestOffer = lowestInitialAmount;
        realMarketSavings = Math.max(0, Number((totalInitialLowestOffer - totalFinalPurchase).toFixed(2)));
        if (updatedMaterials.length === 1) {
          updatedMaterials[0].realSavingsAmount = realMarketSavings;
          (updatedMaterials[0] as any).realMarketSavings = realMarketSavings;
          updatedMaterials[0].realSavingsPercentage = totalInitialLowestOffer > 0
            ? Number(((realMarketSavings / totalInitialLowestOffer) * 100).toFixed(2))
            : 0;
        }
      }
    }
  }

  const realSavingsRate = totalInitialLowestOffer > 0
    ? Number(((realMarketSavings / totalInitialLowestOffer) * 100).toFixed(2))
    : 0;

  const isOverThreshold = totalFinalPurchase >= thresholdRub;

  const summary: ComparativeAnalysisSummary = {
    totalInitialLowestOffer: Number(totalInitialLowestOffer.toFixed(2)),
    totalFinalPurchase: Number(totalFinalPurchase.toFixed(2)),
    realMarketSavings: Number(realMarketSavings.toFixed(2)),
    realSavingsRate,
    internalVendorSavings: Number(internalVendorSavings.toFixed(2)),
    isAboveBestOfferCount,
    isSingleVendor,
    excludedOffersCount: docs.filter(d => d.isExcluded).length,
    pendingApprovalsCount,
    totalVendors: distinctVendors.length,
    totalDocuments: docs.length,
    totalMaterials: finalMaterials.length,
    overallConfidence: finalMaterials.length > 0
      ? Number((finalMaterials.reduce((acc, m) => acc + (typeof m.matchConfidence === 'number' ? m.matchConfidence : 0.9), 0) / finalMaterials.length).toFixed(2))
      : 1.0,
    lowestInitialOfferAmount: Number(totalInitialLowestOffer.toFixed(2)) || lowestInitialAmount || Number(totalFinalPurchase.toFixed(2)),
    lowestInitialOfferSupplier: lowestInitialSupplier || winningSupplier,
    finalPurchaseAmount: finalAmount || Number(totalFinalPurchase.toFixed(2)),
    finalPurchaseSupplier: winningSupplier,
    finalInvoiceNumber: finalDoc?.documentNumber || '',
    finalInvoiceDate: finalDoc?.date || '',
    negotiationRoundsCount,
    initialOffersList,
    intermediateRoundsList
  };

  return {
    canonicalMaterials: finalMaterials,
    summary,
    winningSupplier,
    isSingleVendor,
    thresholdApplied: {
      thresholdRub,
      isOverThreshold,
      isMandatory: false
    },
    auditLogEntries
  };
}

/**
 * Generates an internal sequential analysis code (e.g. ANL-2026-000184)
 */
export function generateAnalysisCode(existingCount = 0): string {
  const year = new Date().getFullYear();
  const seq = String(existingCount + 1).padStart(6, '0');
  return `ANL-${year}-${seq}`;
}
