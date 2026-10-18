/**
 * OTOMATİK BİRLEŞTİRME ÖNERİLERİ
 *
 * Aynı malzeme olması muhtemel ama ayrı gruplarda kalan kayıtları (ör. OCR'dan gelen Rusça satır ile
 * Prizma'dan gelen Türkçe stok kartı) bulur ve kullanıcıya tek tıkla birleştirme önerisi olarak sunar.
 * Öneriler ASLA otomatik uygulanmaz; yanlış birleşme riski yalnızca kullanıcı onayıyla oluşur.
 *
 * Bir çiftin önerilmesi için:
 *  1. Sayısal spesifikasyonlar (ölçü, çap, hacim, ağırlık...) BİREBİR aynı olmalı.
 *  2. Orijinal fatura satırlarının (Rusça) metin benzerliği eşiği geçmeli.
 *  3. Aynı ölçü birimindeyse ortalama fiyatlar makul aralıkta olmalı (2 kattan fazla fark yok).
 */
import { materialFingerprint } from './materialFingerprint';

export interface SuggestionGroupInput {
  id: string;
  materialName: string;
  category?: string;
  unit?: string;
  avgUnitPrice?: number;
  catalogLocked?: boolean;
  history?: Array<{ originalName?: string; rawOriginalName?: string; rawMaterialName?: string; materialCode?: string }>;
}

export interface MergeSuggestion {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  score: number;
  reason: string;
  sharedSpecs: string[];
}

const NUMERIC_TOKEN = /\d/;

/**
 * Varyant kelimeleri: iki satır arasında yalnızca bunlardan biri farklıysa ürünler FARKLIDIR
 * (renk, beden, sağ/sol, saplı/sapsız ...). Parmak izi uzayında karşılaştırılır.
 */
const VARIANT_WORDS = [
  // renkler (RU / TR / EN)
  'синий', 'синяя', 'голубой', 'желтый', 'жёлтый', 'черный', 'чёрный', 'красный', 'зеленый', 'зелёный', 'белый', 'серый', 'оранжевый', 'фиолетовый', 'коричневый', 'прозрачный',
  'mavi', 'sarı', 'siyah', 'kırmızı', 'yeşil', 'beyaz', 'gri', 'turuncu', 'mor', 'kahverengi', 'şeffaf', 'macenta', 'magenta', 'cyan',
  'blue', 'yellow', 'black', 'red', 'green', 'white', 'grey', 'gray', 'orange',
  // yön / taraf
  'правый', 'левый', 'sağ', 'sol', 'right', 'left', 'внутренний', 'наружный', 'iç', 'dış',
  // var / yok
  'без', 'sapsız', 'saplı', 'черенком', 'черенка',
  // beden
  'xs', 'xl', 'xxl', 'xxxl'
];
const VARIANT_FP = new Set(VARIANT_WORDS.map(w => materialFingerprint(w)).filter(Boolean));

function tokensOf(text: string): Set<string> {
  return new Set(materialFingerprint(text).split(' ').filter(Boolean));
}

/** Metin Rusça bir satır mı? (en az bir 3+ harfli Kiril kelime). Marka adı Latin harfli olsa bile Rusça sayılır. */
function isCyrillicLine(text: string): boolean {
  return /[а-яё]{3,}/i.test(text);
}

/** İki satırı ayıran kelimeler bir varyantı (renk, beden, marka, model harfi...) gösteriyor mu? */
export function differsByVariant(a: string, b: string): boolean {
  // Marka segmentli grup adları ("[Marka: Комус]" ≠ "[Marka: SvetoCopy]") bilinçli olarak ayrıdır
  const brandA = (a.match(/\[\s*marka\s*:\s*([^\]]+)\]/i) || [])[1];
  const brandB = (b.match(/\[\s*marka\s*:\s*([^\]]+)\]/i) || [])[1];
  if (brandA && brandB && materialFingerprint(brandA) !== materialFingerprint(brandB)) return true;
  const A = tokensOf(a);
  const B = tokensOf(b);
  const diff = [...Array.from(A).filter(t => !B.has(t)), ...Array.from(B).filter(t => !A.has(t))];
  const bothCyrillic = isCyrillicLine(a) && isCyrillicLine(b);
  return diff.some(t =>
    VARIANT_FP.has(t) ||
    /^[a-z]$/.test(t) ||
    // Rusça satırlarda Latin harfli kelime genelde marka/model adıdır (Комус ≠ SvetoCopy, Mars ≠ Snickers)
    (bothCyrillic && /^[a-z]{3,}$/.test(t) && !/^(?:mm|cm|kg|ml|ls|pvc|pp)$/.test(t))
  );
}

function groupTexts(g: SuggestionGroupInput): string[] {
  const lines = new Set<string>();
  for (const h of g.history || []) {
    const o = String(h.rawOriginalName || h.originalName || '').trim();
    if (o) lines.add(o);
  }
  if (lines.size === 0) lines.add(g.materialName);
  return Array.from(lines);
}

/** Grubun sayısal spesifikasyon imzası: satırlarda geçen tüm sayısal parçalar (birebir aynı olmalı) */
export function numericSignature(texts: string[]): string[] {
  const all = new Set<string>();
  for (const t of texts) {
    materialFingerprint(t).split(' ').filter(tok => NUMERIC_TOKEN.test(tok)).forEach(n => all.add(n));
  }
  return Array.from(all).sort();
}

function wordPart(text: string): string {
  return materialFingerprint(text)
    .split(' ')
    .filter(tok => !NUMERIC_TOKEN.test(tok) && tok.length >= 2)
    .join(' ');
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Sørensen–Dice karakter üçlü benzerliği (0..1) */
export function textSimilarity(a: string, b: string): number {
  const A = trigrams(wordPart(a));
  const B = trigrams(wordPart(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach(x => { if (B.has(x)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

function sameUnit(a?: string, b?: string): boolean {
  return String(a || '').toLowerCase().trim() === String(b || '').toLowerCase().trim();
}

/** Aynı birimdeki ortalama fiyat oranı (birim farklı veya fiyat yoksa 1) */
function priceRatio(a: SuggestionGroupInput, b: SuggestionGroupInput): number {
  if (!sameUnit(a.unit, b.unit)) return 1;
  const pa = a.avgUnitPrice || 0;
  const pb = b.avgUnitPrice || 0;
  if (pa <= 0 || pb <= 0) return 1;
  return Math.max(pa, pb) / Math.min(pa, pb);
}

export function buildMergeSuggestions(groups: SuggestionGroupInput[], opts: { limit?: number; minScore?: number } = {}): MergeSuggestion[] {
  const minScore = opts.minScore ?? 0.5;
  const prepared = groups
    .filter(g => g && g.id && g.materialName)
    .map(g => {
      const texts = groupTexts(g);
      const codes = new Set((g.history || []).map(h => String(h.materialCode || '').trim().toUpperCase()).filter(Boolean));
      return { g, texts, nums: numericSignature(texts), codes, size: (g.history || []).length };
    });

  // Yalnızca aynı sayısal imzaya sahip gruplar karşılaştırılır (hem hız hem güvenlik)
  const buckets = new Map<string, typeof prepared>();
  for (const p of prepared) {
    const key = p.nums.length ? p.nums.join('|') : `__nonum__${p.g.category || ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p);
  }

  const out: MergeSuggestion[] = [];
  const seenPairs = new Set<string>();
  const pairKey = (x: string, y: string) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);
  const pushSuggestion = (a: (typeof prepared)[number], b: (typeof prepared)[number], score: number, reason: string, sharedSpecs: string[]) => {
    const pk = pairKey(a.g.id, b.g.id);
    if (seenPairs.has(pk)) return;
    seenPairs.add(pk);
    // Hedef: kilitli kayıt, yoksa daha çok satırı olan kayıt
    const targetIsA = a.g.catalogLocked || (!b.g.catalogLocked && a.size >= b.size);
    const target = targetIsA ? a : b;
    const source = targetIsA ? b : a;
    out.push({
      sourceId: source.g.id,
      sourceName: source.g.materialName,
      targetId: target.g.id,
      targetName: target.g.materialName,
      score: Number(score.toFixed(3)),
      reason,
      sharedSpecs
    });
  };

  // Aynı Prizma stok kodunu taşıyan gruplar, yazımları/ölçü yazımları farklı olsa bile önerilir (en güçlü sinyal)
  const byCode = new Map<string, typeof prepared>();
  for (const p of prepared) p.codes.forEach(c => {
    if (!byCode.has(c)) byCode.set(c, []);
    byCode.get(c)!.push(p);
  });
  byCode.forEach((list, code) => {
    if (list.length < 2 || list.length > 20) return;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.g.catalogLocked && b.g.catalogLocked) continue;
      // Gruplama aşaması kodu fiyat oranı 2.5'i aşınca bilinçli olarak bağlamaz; öneri de aynı kuralı izler
      if (priceRatio(a.g, b.g) > 2.5) continue;
      pushSuggestion(a, b, 0.97, `Aynı Prizma stok kodu (${code})`, a.nums.filter(n => b.nums.includes(n)));
    }
  });

  buckets.forEach((list, key) => {
    if (list.length < 2 || list.length > 400) return;
    const hasNums = !key.startsWith('__nonum__');
    const threshold = hasNums ? minScore : Math.max(minScore, 0.75);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.g.catalogLocked && b.g.catalogLocked) continue;

        const sharedCode = Array.from(a.codes).find(c => b.codes.has(c));
        let best = 0;
        let bestPair: [string, string] = [a.g.materialName, b.g.materialName];
        for (const ta of a.texts) for (const tb of b.texts) {
          const sim = textSimilarity(ta, tb);
          if (sim > best) { best = sim; bestPair = [ta, tb]; }
        }
        const nameSim = textSimilarity(a.g.materialName, b.g.materialName);
        if (nameSim > best) { best = nameSim; bestPair = [a.g.materialName, b.g.materialName]; }
        const score = sharedCode ? Math.max(best, 0.95) : best;
        if (score < threshold) continue;
        if (!sharedCode && (differsByVariant(bestPair[0], bestPair[1]) || differsByVariant(a.g.materialName, b.g.materialName))) continue;

        if (priceRatio(a.g, b.g) > 2) continue;

        pushSuggestion(a, b, score, sharedCode
          ? `Aynı Prizma stok kodu (${sharedCode})`
          : hasNums
            ? `Aynı ölçüler (${a.nums.join(', ')}) ve %${Math.round(score * 100)} benzer fatura satırı`
            : `%${Math.round(score * 100)} benzer fatura satırı`, a.nums);
      }
    }
  });

  out.sort((x, y) => y.score - x.score);
  return out.slice(0, opts.limit ?? 200);
}
