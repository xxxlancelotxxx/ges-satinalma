/**
 * İndirim detayındaki "İlk Teklif Birim" sütununu hesaplar.
 *
 * Referans fiyat yalnızca kaydın KENDİ belgelerinden gelir (aynı tedarikçinin/teklif setinin ilk teklifi).
 * Eşleşme kesin değilse referans gösterilmez; toplam orandan uydurulmuş satır fiyatı üretilmez.
 * Anlaşılan birim her zaman faturadaki gerçek (KDV dahil) birim fiyattır.
 */
import { lineSimilarity, LINE_MATCH_THRESHOLD, matchLines, MatchableLine } from './invoiceLineMatcher';

export interface DiscountLineItem extends MatchableLine {
  id?: string;
  quantity?: number;
  unitPrice?: number;
  totalPrice?: number;
}

export interface CanonicalReference extends MatchableLine {
  id?: string;
  commonName?: string;
  canonicalName?: string;
  sourceLineIndex?: number;
  referenceFound?: boolean;
  /** 2 = bire bir ad/artikel eşleştirmesiyle üretildi (invoiceLineMatcher). Yoksa eski kayıt. */
  lineMatchVersion?: number;
  purchasedUnitPrice?: number;
  purchasedSupplier?: string;
  marketReferenceUnitPrice?: number;
  marketReferenceSupplier?: string;
  lowestInitialOffer?: { normalizedUnitPrice?: number; vendorName?: string };
}

export interface DiscountLineComparison {
  hasReference: boolean;
  refPrice: number;
  refSupplier: string;
  finalPrice: number;
  finalSupplier: string;
  unitSavings: number;
  totalSavings: number;
  savingsRate: number;
  note?: string;
}

export const CURRENT_LINE_MATCH_VERSION = 2;

/**
 * Eski eşleştirici "Genel Malzeme" kalemlerinin hepsini ilk teklifin aynı satırına bağlıyordu: birbirinden çok
 * farklı fiyatlı kalemlere aynı referans fiyat yazılmıştı. Böyle eski kanonik kayıtlar güvenilmez sayılır.
 */
export function findUnreliableLegacyCanonicals(canonicals: CanonicalReference[]): Set<number> {
  const bad = new Set<number>();
  const byRef = new Map<number, number[]>();
  canonicals.forEach((c, i) => {
    if ((c.lineMatchVersion || 0) >= CURRENT_LINE_MATCH_VERSION) return;
    const ref = Number(c.marketReferenceUnitPrice || 0);
    if (!(ref > 0)) return;
    const key = Math.round(ref * 100);
    byRef.set(key, [...(byRef.get(key) || []), i]);
  });
  for (const idxs of byRef.values()) {
    if (idxs.length < 2) continue;
    const prices = idxs.map(i => Number(canonicals[i].purchasedUnitPrice || 0)).filter(p => p > 0);
    if (prices.length < 2) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min > 0 && max / min > 1.05) idxs.forEach(i => bad.add(i));
  }
  return bad;
}

function canonicalAsLine(c: CanonicalReference): MatchableLine {
  return {
    originalName: c.originalName || c.commonName || c.canonicalName,
    materialName: c.materialName || c.commonName || c.canonicalName,
    article: c.article,
    productCode: c.productCode
  };
}

/**
 * Kayıttaki her kalem için ilk teklif referansını bulur.
 * external: yalnızca bu kayda ait bir karşılaştırmalı analiz verilirse kullanılır (id/kod eşleşmeli).
 */
export function buildDiscountLineComparisons(
  discount: {
    id?: string;
    vendorName?: string;
    items?: DiscountLineItem[];
    canonicalMaterials?: CanonicalReference[];
    comparativeAnalysisId?: string;
    analysisCode?: string;
  },
  external?: { id?: string; analysisCode?: string; canonicalMaterials?: CanonicalReference[] } | null
): DiscountLineComparison[] {
  const items = discount.items || [];
  const externalBelongs = Boolean(
    external &&
    Array.isArray(external.canonicalMaterials) &&
    ((discount.comparativeAnalysisId && external.id === discount.comparativeAnalysisId) ||
     (discount.analysisCode && external.analysisCode === discount.analysisCode))
  );
  const canonicals: CanonicalReference[] = (discount.canonicalMaterials && discount.canonicalMaterials.length > 0)
    ? discount.canonicalMaterials
    : (externalBelongs ? external!.canonicalMaterials! : []);

  const unreliable = findUnreliableLegacyCanonicals(canonicals);

  // 1) Satır sırası kaydedilmişse ve adlar uyuşuyorsa onu kullan; 2) yoksa ad/artikel ile bire bir eşleştir.
  const assigned = new Array<number>(items.length).fill(-1);
  const used = new Set<number>();
  items.forEach((it, idx) => {
    const cIdx = canonicals.findIndex(c => c.sourceLineIndex === idx);
    if (cIdx >= 0 && !used.has(cIdx)) {
      const c = canonicals[cIdx];
      if (lineSimilarity(it, canonicalAsLine(c)) >= LINE_MATCH_THRESHOLD) {
        assigned[idx] = cIdx;
        used.add(cIdx);
      }
    }
  });
  const pendingItemIdx = items.map((_, i) => i).filter(i => assigned[i] === -1);
  const freeCanonIdx = canonicals.map((_, i) => i).filter(i => !used.has(i));
  const nameMatch = matchLines(
    pendingItemIdx.map(i => items[i]),
    freeCanonIdx.map(i => canonicalAsLine(canonicals[i]))
  );
  pendingItemIdx.forEach((itemIdx, k) => {
    if (nameMatch[k] >= 0) assigned[itemIdx] = freeCanonIdx[nameMatch[k]];
  });

  return items.map((it, idx) => {
    const finalPrice = Number(it.unitPrice) || 0;
    const qty = Number(it.quantity) || 1;
    const finalSupplier = discount.vendorName || '';
    const c = assigned[idx] >= 0 ? canonicals[assigned[idx]] : null;
    if (c && unreliable.has(assigned[idx])) {
      return {
        hasReference: false,
        refPrice: 0,
        refSupplier: '',
        finalPrice,
        finalSupplier,
        unitSavings: 0,
        totalSavings: 0,
        savingsRate: 0,
        note: 'Eski kayıt: kalem referansı doğrulanamadı'
      };
    }
    const refPrice = c && c.referenceFound !== false
      ? Number(c.marketReferenceUnitPrice || c.lowestInitialOffer?.normalizedUnitPrice || 0)
      : 0;

    if (!c || !(refPrice > 0) || !(finalPrice > 0)) {
      return {
        hasReference: false,
        refPrice: 0,
        refSupplier: '',
        finalPrice,
        finalSupplier,
        unitSavings: 0,
        totalSavings: 0,
        savingsRate: 0,
        note: canonicals.length === 0 ? 'Kalem bazlı ilk teklif yok' : 'İlk teklifte bu kalem yok'
      };
    }

    const unitSavings = Number((refPrice - finalPrice).toFixed(2));
    return {
      hasReference: true,
      refPrice,
      refSupplier: c.marketReferenceSupplier || c.lowestInitialOffer?.vendorName || 'İlk teklif',
      finalPrice,
      finalSupplier: c.purchasedSupplier || finalSupplier,
      unitSavings,
      totalSavings: Number((unitSavings * qty).toFixed(2)),
      savingsRate: Number(((unitSavings / refPrice) * 100).toFixed(2))
    };
  });
}
