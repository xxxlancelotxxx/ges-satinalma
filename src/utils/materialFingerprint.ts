/**
 * MALZEME PARMAK İZİ (Material Fingerprint)
 *
 * Aynı malzemenin farklı kaynaklarda (OCR taraması, Prizma STF/BTF, manuel giriş) farklı yazılmasından
 * doğan grup bölünmelerini ortadan kaldırmak için deterministik bir eşleştirme anahtarı üretir.
 *
 * Eşitlenen farklar:
 *  - Büyük/küçük harf, Türkçe karakterler (Ç/ç → c, İ/ı → i ...), Rusça ё → е
 *  - Kiril/Latin görünüşü aynı harfler (А500С ≡ A500C, МР-3 ≡ MP-3)
 *  - Ondalık virgül/nokta (4,2 ≡ 4.2), gereksiz sıfırlar (3,0 ≡ 3)
 *  - Ölçü ayırıcıları (4,2х76 ≡ 4.2x76 ≡ 4,2*76 ≡ 4.2 × 76)
 *  - Birim yazımları ve bitişik yazım (750мл ≡ 750 мл ≡ 750 ml, 50кг ≡ 50 kg)
 *  - Çap işaretleri (ф12 ≡ Ø12 ≡ d12)
 *  - Kelime sırası ve noktalama ("Саморез по металлу 4,2х76" ≡ "Саморез 4.2x76 по металлу")
 *
 * Sayılar asla atılmaz; farklı ölçüler her zaman farklı parmak izi üretir.
 */

const CYRILLIC_LATIN_HOMOGLYPHS: Record<string, string> = {
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h',
  'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x'
};

const STOPWORDS = new Set([
  'по', 'для', 'и', 'в', 'на', 'из', 'под', 'от', 'до',
  // homoglif dönüşümünden sonraki halleri ('с' → 'c', 'в' → 'b', 'на' → 'ha', 'от' → 'ot')
  'c', 'b', 'ha', 'ot',
  've', 'ile', 'icin', 'veya',
  'sht', 'шт', 'ad', 'adet', 'ed'
]);

function stripDiacritics(s: string): string {
  // 'й' ve 'ё' NFKD ile ayrışır; Kiril harfi korunur, yalnızca birleşik işaret düşer.
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

export function materialFingerprint(raw?: string | null): string {
  if (!raw) return '';
  let s = stripDiacritics(String(raw).toLowerCase());

  s = s.replace(/[авекмнорстух]/g, ch => CYRILLIC_LATIN_HOMOGLYPHS[ch] || ch);

  // Ondalık virgül → nokta
  s = s.replace(/(\d)\s*,\s*(\d)/g, '$1.$2');
  // Ölçü ayırıcıları (x, *, ×) → x
  for (let i = 0; i < 3; i++) s = s.replace(/(\d)\s*[x*×]\s*(\d)/g, '$1x$2');
  // 3.0 → 3, 2.50 → 2.5
  s = s.replace(/(\d+)\.0+(?!\d)/g, '$1').replace(/(\d+\.\d*?[1-9])0+(?!\d)/g, '$1');

  // Çap işaretleri → d
  s = s.replace(/(^|[^a-zа-я0-9])(?:ф|ø|⌀|d|диам\.?|диаметр)\s*(\d)/g, '$1d$2');

  // Birimler (homoglif sonrası: мм → mm, м → m, мл → mл, кг → kг, л → л)
  s = s
    .replace(/(\d)\s*mл(?![a-zа-я])/g, '$1 ml')
    .replace(/(\d)\s*л(?![a-zа-я])/g, '$1 l')
    .replace(/(\d)\s*kг(?![a-zа-я])/g, '$1 kg')
    .replace(/(\d)\s*г(?![a-zа-я])/g, '$1 g')
    .replace(/\blt\b/g, 'l')
    .replace(/(\d)\s*(?:mt|metre)\b/g, '$1 m');

  // Birim araya girmiş ölçüler: 48мм х 50м → 48x50 m
  for (let i = 0; i < 2; i++) s = s.replace(/(\d)\s*(?:mm|cm|m)\s*[x*×]\s*(\d)/g, '$1x$2');

  // Sayıyla başlayan kelimede rakamı birimden ayır (750ml → 750 ml); A500C, M12 gibi kodlar bütün kalır
  s = s.replace(/(^|[^a-zа-я0-9.])(\d+(?:\.\d+)?(?:x\d+(?:\.\d+)?)*)(?=[a-wyzа-я]|x(?!\d))/g, '$1$2 ');

  // Ondalık nokta dışındaki tüm noktalama → boşluk
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ').replace(/[^a-zа-я0-9.]+/g, ' ');

  const tokens = s
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t && !STOPWORDS.has(t));

  return Array.from(new Set(tokens)).sort().join(' ');
}

/** Parmak izinin bir alias anahtarı olarak kullanılabilecek kadar ayırt edici olup olmadığı. */
export function isDistinctiveFingerprint(fp: string): boolean {
  if (!fp) return false;
  const tokens = fp.split(' ');
  const wordTokens = tokens.filter(t => /[a-zа-я]{3,}/.test(t));
  if (wordTokens.length === 0) return false;
  return tokens.length >= 2;
}
