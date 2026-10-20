/**
 * İki belge (ör. ilk teklif ↔ nihai fatura) arasında kalemleri birebir eşleştirir.
 *
 * Neden ayrı bir modül: eski eşleştirmeler (a) adları /[^a-z0-9]/ ile temizliyordu — Kiril harfleri
 * silinince boş metin her kalemle "eşleşiyordu", (b) "Genel Malzeme" türündeki her aday aynı skoru
 * aldığı için tüm kalemler ilk teklifin ilk satırına bağlanıyordu, (c) eşleşme bulunamayınca satır
 * sırasına (index) körü körüne düşüyordu. Sonuç: başka bir malzemenin fiyatı "Piyasa Baz Birim"
 * olarak gösteriliyordu.
 *
 * Kurallar:
 * - Ad karşılaştırması Unicode'dur (Kiril/Latin/Türkçe harfler ve rakamlar korunur).
 * - Artikel kodu iki tarafta da varsa eşit olmalıdır.
 * - Addaki sayılar (ölçü, hacim, adet/paket) iki tarafta da varsa aynı olmalıdır.
 * - Her kalem en fazla bir kalemle eşleşir (bire bir); emin olunamayan satır eşleşmesiz kalır.
 */

export interface MatchableLine {
  materialName?: string;
  originalName?: string;
  article?: string;
  productCode?: string;
  unit?: string;
}

const STOP_WORDS = new Set([
  'для', 'под', 'над', 'при', 'без', 'шт', 'уп', 'упак', 'мм', 'см', 'м', 'кг', 'гр', 'л', 'мл', 'ml', 'mm',
  'the', 'and', 've', 'ile', 'için', 'adet', 'paket', 'на', 'из', 'по', 'с', 'в', 'и'
]);

/** Kiril/Latin/Türkçe harf ve rakamları koruyan sade biçim. */
export function normalizeLineText(raw: string | undefined | null): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)[,](\d)/g, '$1.$2')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineNames(l: MatchableLine): string[] {
  const out: string[] = [];
  for (const n of [l.originalName, l.materialName]) {
    const t = String(n || '').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function wordStems(norm: string): string[] {
  return norm
    .split(' ')
    .filter(w => w && !/^\d/.test(w) && w.length >= 3 && !STOP_WORDS.has(w))
    // Rusça çekim eklerini tolere etmek için kök: ilk 5 harf
    .map(w => (w.length > 5 ? w.slice(0, 5) : w));
}

function numberSet(norm: string): Set<string> {
  const out = new Set<string>();
  for (const m of norm.match(/\d+(?:\.\d+)?/g) || []) {
    out.add(String(Number(m)));
  }
  return out;
}

function articleOf(l: MatchableLine): string {
  return normalizeLineText(l.article || l.productCode || '').replace(/\s+/g, '');
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function nameSimilarity(rawA: string, rawB: string): number {
  const na = normalizeLineText(rawA);
  const nb = normalizeLineText(rawB);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const numsA = numberSet(na);
  const numsB = numberSet(nb);
  if (numsA.size > 0 && numsB.size > 0 && !setsEqual(numsA, numsB)) return 0;

  const wa = new Set(wordStems(na));
  const wb = new Set(wordStems(nb));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return Number(((2 * common) / (wa.size + wb.size)).toFixed(3));
}

/** 0..1 benzerlik; 0 = kesinlikle farklı kalem. Belgedeki (Rusça) ad ve sistem adı ayrı ayrı denenir. */
export function lineSimilarity(a: MatchableLine, b: MatchableLine): number {
  const artA = articleOf(a);
  const artB = articleOf(b);
  if (artA && artB) return artA === artB ? 1 : 0;

  let best = 0;
  for (const x of lineNames(a)) {
    for (const y of lineNames(b)) {
      best = Math.max(best, nameSimilarity(x, y));
      if (best === 1) return 1;
    }
  }
  return best;
}

export const LINE_MATCH_THRESHOLD = 0.6;

/**
 * targets[i] için sources içindeki eşini döndürür (yoksa -1). Bire bir, en yüksek benzerlik önce.
 */
export function matchLines(targets: MatchableLine[], sources: MatchableLine[], threshold = LINE_MATCH_THRESHOLD): number[] {
  const pairs: Array<{ t: number; s: number; score: number }> = [];
  targets.forEach((t, ti) => {
    sources.forEach((s, si) => {
      const score = lineSimilarity(t, s);
      if (score >= threshold) pairs.push({ t: ti, s: si, score: score + (ti === si ? 0.001 : 0) });
    });
  });
  pairs.sort((x, y) => y.score - x.score);
  const result = new Array<number>(targets.length).fill(-1);
  const usedSources = new Set<number>();
  for (const p of pairs) {
    if (result[p.t] !== -1 || usedSources.has(p.s)) continue;
    result[p.t] = p.s;
    usedSources.add(p.s);
  }
  return result;
}
