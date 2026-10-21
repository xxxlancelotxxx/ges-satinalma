import { buildStrictOriginalMaterialSignature } from './preApprovalAuditEngine';
import { extractTechnicalStandardAndGrade, areTechnicalVariantsCompatible } from './materialGroupIntegrity';

export interface MatchableInvoiceLine {
  materialName?: string;
  originalName?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  brand?: string;
  article?: string;
  productCode?: string;
}

export type MatchableLine = MatchableInvoiceLine;
export const LINE_MATCH_THRESHOLD = 0.65;

const STOP_TOKENS = new Set([
  've', 'ile', 'için', 'mm', 'cm', 'm', 'mt', 'kg', 'gr', 'lt', 'adet', 'paket', 'rulo', 'boy', 'set', 'takım', 'çift',
  'шт', 'мм', 'см', 'м', 'мп', 'м2', 'м3', 'кг', 'г', 'л', 'уп', 'упак', 'рул', 'компл', 'пар', 'для', 'из', 'по', 'в', 'с', 'на',
  'standart', 'standard', 'eco', 'line', 'plus', 'max', 'pro', 'genel', 'malzeme', 'inşaat', 'malzemesi'
]);

function extractArticleCode(text: string, explicitArt?: string): string | null {
  if (explicitArt && String(explicitArt).trim().length >= 2) {
    return String(explicitArt).trim().toLowerCase();
  }
  const m = text.match(/(?:арт\.?|артикул|art\.?|код)\s*[:#№]?\s*([a-zа-яё0-9][\w.-]{2,})/i);
  return m ? m[1].toLowerCase() : null;
}

function getPreferredOriginalText(line: MatchableInvoiceLine): string {
  const orig = String(line.originalName || '').trim();
  const mat = String(line.materialName || '').trim();
  const hasCyrOrig = /[а-яА-ЯёЁ]/.test(orig);
  const hasCyrMat = /[а-яА-ЯёЁ]/.test(mat);
  return hasCyrOrig ? orig : (hasCyrMat ? mat : (orig || mat));
}

function extractNumericSignature(text: string): string {
  const withoutArt = text
    .toLowerCase()
    .replace(/\(?\s*(?:арт\.?|артикул|art\.?|код)\s*[:#№]?\s*[a-zа-яё0-9][\w.-]{2,}\s*\)?/gi, ' ')
    .replace(/^(?:[а-яa-z]{1,3}\d?[-/])?\d{5,12}\s+(?=[а-яa-z])/i, '')
    .replace(/(\d),(\d)/g, '$1.$2');

  const nums = (withoutArt.match(/\d+(?:\.\d+)?/g) || [])
    .map(n => String(Number(n)))
    .filter(n => n !== 'NaN');
  const uniqueSorted = Array.from(new Set(nums)).sort((a, b) => Number(a) - Number(b));
  return uniqueSorted.join('|');
}

function extractDimensions(text: string): string[] {
  const matches = text.toLowerCase().replace(/,/g, '.').match(/\d+(?:\.\d+)?(?:\s*[xх*×/]\s*\d+(?:\.\d+)?)+/g) || [];
  return matches.map(s => s.replace(/\s+/g, '').replace(/[х*×]/g, 'x'));
}

function extractWordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\(?\s*(?:арт\.?|артикул|art\.?|код)\s*[:#№]?\s*[a-zа-яё0-9][\w.-]{2,}\s*\)?/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?/g, ' ')
    .replace(/[^a-zа-яğüşıöç]+/gi, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_TOKENS.has(t));
}

/**
 * İki fatura/teklif satırının aynı malzeme olup olmadığını [0..1] aralığında puanlar.
 * - Orijinal Rusça imza (`buildStrictOriginalMaterialSignature`) birebir aynıysa -> 1.0
 * - Artikel / ürün kodu varsa ve farklıysa -> 0 (kesin ret)
 * - Ölçü/ebat veya sayısal değerler (örn. 10x150/210 vs 20x250 vs 92 mm vs 400 mm) farklıysa -> 0 (kesin ret)
 */
export function lineMatchScore(a: MatchableInvoiceLine, b: MatchableInvoiceLine): number {
  const rawA = getPreferredOriginalText(a);
  const rawB = getPreferredOriginalText(b);
  const fullA = `${a.originalName || ''} ${a.materialName || ''}`.trim();
  const fullB = `${b.originalName || ''} ${b.materialName || ''}`.trim();
  if (!rawA || !rawB) return 0;

  // 1. Kesin artikel / ürün kodu kontrolü
  const artA = extractArticleCode(fullA, a.article || a.productCode);
  const artB = extractArticleCode(fullB, b.article || b.productCode);
  if (artA && artB) {
    return artA === artB ? 1.0 : 0.0;
  }

  // 1.5 Teknik standart (GOST vs TU), kalite sınıfı (Sort 1/2/3), nem/işlem, ağaç türü ve tam kesit kontrolü
  const techA = extractTechnicalStandardAndGrade(a.originalName || '', a.materialName || '');
  const techB = extractTechnicalStandardAndGrade(b.originalName || '', b.materialName || '');
  if (!areTechnicalVariantsCompatible(techA, techB).compatible) {
    return 0.0;
  }

  // 2. Orijinal dil (Rusça) tam imza kontrolü
  const strictA = buildStrictOriginalMaterialSignature({
    originalName: a.originalName,
    materialName: a.materialName,
    brand: a.brand
  });
  const strictB = buildStrictOriginalMaterialSignature({
    originalName: b.originalName,
    materialName: b.materialName,
    brand: b.brand
  });
  if (strictA && strictB) {
    if (!areTechnicalVariantsCompatible(strictA.techVariant, strictB.techVariant).compatible) {
      return 0.0;
    }
    if (strictA.exactKey === strictB.exactKey) {
      if (strictA.gostKey && strictB.gostKey && strictA.gostKey !== strictB.gostKey) return 0.0;
      return 1.0;
    }
    if (strictA.brand && strictB.brand && strictA.brand !== strictB.brand) {
      return 0.0;
    }
  }

  // 3. Tüm sayısal değerlerin (çap, ebat, kalınlık, model no: 92 mm, 400 mm, 10x150/210 vb.) birebir uyumu
  const numSigA = extractNumericSignature(rawA);
  const numSigB = extractNumericSignature(rawB);
  if (numSigA || numSigB) {
    if (numSigA !== numSigB) {
      return 0.0;
    }
  }

  // 4. AxB ölçü / ebat kontrolü
  const dimsA = extractDimensions(rawA);
  const dimsB = extractDimensions(rawB);
  if (dimsA.length > 0 || dimsB.length > 0) {
    if (dimsA.length === 0 || dimsB.length === 0) return 0.0;
    const overlap = dimsA.some(d => dimsB.includes(d));
    if (!overlap) return 0.0;
  }

  // 5. Kelime kesişimi (tercihen orijinal metin üzerinden)
  const tokensA = extractWordTokens(rawA);
  const tokensB = extractWordTokens(rawB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  let common = 0;
  for (const t of tokensA) {
    if (setB.has(t)) {
      common++;
    } else if (t.length >= 4) {
      const prefix = t.slice(0, 4);
      if (tokensB.some(tb => tb.length >= 4 && tb.slice(0, 4) === prefix)) {
        common += 0.8;
      }
    }
  }

  if (common === 0) return 0;

  const denom = Math.max(tokensA.length, tokensB.length);
  const tokenRatio = common / denom;

  if (artA || artB) {
    return tokenRatio >= 0.6 ? Math.min(0.95, tokenRatio + 0.15) : 0;
  }

  if (numSigA && numSigA === numSigB) {
    return tokenRatio >= 0.5 ? Math.min(0.95, tokenRatio + 0.25) : 0;
  }

  return tokenRatio >= LINE_MATCH_THRESHOLD ? tokenRatio : 0;
}

export const lineSimilarity = lineMatchScore;

/**
 * `finalLines` içindeki her satır için `candidateLines` içinde Birebir (1-e-1) en yüksek puanlı
 * ve eşik değeri (>= 0.65) geçen satırın indeksini döndürür.
 * Aynı aday satır birden fazla nihai satıra ASLA atanmaz; eşleşmeyenler için `-1` döner.
 */
export function matchLines(
  finalLines: MatchableInvoiceLine[],
  candidateLines: MatchableInvoiceLine[]
): number[] {
  const result = new Array<number>(finalLines.length).fill(-1);
  if (!Array.isArray(finalLines) || !Array.isArray(candidateLines) || finalLines.length === 0 || candidateLines.length === 0) {
    return result;
  }

  const pairs: Array<{ finalIdx: number; candIdx: number; score: number }> = [];
  for (let i = 0; i < finalLines.length; i++) {
    for (let j = 0; j < candidateLines.length; j++) {
      const s = lineMatchScore(finalLines[i], candidateLines[j]);
      if (s >= 0.65) {
        pairs.push({ finalIdx: i, candIdx: j, score: s });
      }
    }
  }

  pairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aSameRow = a.finalIdx === a.candIdx ? 1 : 0;
    const bSameRow = b.finalIdx === b.candIdx ? 1 : 0;
    return bSameRow - aSameRow;
  });

  const usedFinal = new Set<number>();
  const usedCand = new Set<number>();

  for (const p of pairs) {
    if (usedFinal.has(p.finalIdx) || usedCand.has(p.candIdx)) continue;
    result[p.finalIdx] = p.candIdx;
    usedFinal.add(p.finalIdx);
    usedCand.add(p.candIdx);
  }

  return result;
}
