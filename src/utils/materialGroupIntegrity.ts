/**
 * Material Group Integrity Guard
 * ------------------------------------------------------------------
 * Son güvenlik katmanı: Normalizasyon motoru iki faturadaki kalemi aynı
 * malzeme grubuna koymuş olsa bile, ORİJİNAL fatura satırlarında açıkça
 * çelişen bir teknik özellik varsa (ürün tipi, ölçü, mikron, litre,
 * paket adedi, diş (M), beton/harç markası, mukavemet sınıfı, torba kg)
 * bu kalemler ASLA aynı fiyat kıyaslamasına girmez; grup otomatik bölünür.
 *
 * Kural: Bir özellik iki tarafta da yazılıysa ve farklıysa → çelişki.
 * Bir tarafta yazılı değilse → bilinmiyor, çelişki sayılmaz.
 */

export interface SpecSignature {
  type?: string;
  dims?: string;
  micron?: string;
  litre?: string;
  pack?: string;
  thread?: string;
  grade?: string;
  strength?: string;
  bagKg?: string;
}

const SPEC_KEYS: Array<keyof SpecSignature> = ['type', 'dims', 'micron', 'litre', 'pack', 'thread', 'grade', 'strength', 'bagKg'];

// Birbirini dışlayan ürün tipi aileleri (sıra önemlidir: daha spesifik olan önce).
const PRODUCT_TYPE_FAMILIES: Array<{ type: string; label: string; pattern: RegExp }> = [
  { type: 'dyubel-gvozd', label: 'Dübel-Çivi (Дюбель-гвоздь)', pattern: /дюбель[\s-]*гвозд|дюбель\s+с\s+гвозд/ },
  { type: 'anker-klin', label: 'Kama Ankraj (Анкер-клин)', pattern: /анкер[\s-]*клин/ },
  { type: 'anker', label: 'Ankraj (Анкер)', pattern: /(?:^|[^а-яё])анкер(?![\s-]*клин)/ },
  { type: 'dyubel', label: 'Dübel (Дюбель)', pattern: /(?:^|[^а-яё])дюбел(?![ья]?[\s-]*гвозд)/ },
  { type: 'gvozd', label: 'Çivi (Гвоздь)', pattern: /(?:^|[^а-яё])гвозд/ },
  { type: 'samorez', label: 'Vida (Саморез)', pattern: /саморез/ },
  { type: 'perchatki-rezin', label: 'Kauçuk/Lateks/Nitril Eldiven', pattern: /перчатки\s+(?:[а-яё]+\s+)?(?:резинов|латекс|нитрил|виниловы)/ },
  { type: 'perchatki-rab', label: 'İş Eldiveni (Перчатки рабочие)', pattern: /перчатки\s+(?:[а-яё]+\s+)?(?:рабоч|х\/б|хб|трикотаж|защитн|с\s+пвх|спилк|утепл)/ },
  { type: 'mylo', label: 'Sabun (Мыло)', pattern: /мыло/ },
  { type: 'gips', label: 'Alçı (Гипс)', pattern: /(?:^|[^а-яё])гипс(?!окартон|оволок|ов[а-я]*\s+плит|ов[а-я]*\s+лист)/ },
  { type: 'nozh', label: 'Bıçak (Нож)', pattern: /(?:^|[^а-яё])нож(?!ниц|овк)/ },
  { type: 'lezvie', label: 'Bıçak Yedeği (Лезвие)', pattern: /лезви/ },
  { type: 'shayba-grover', label: 'Yaylı Pul (Гровер)', pattern: /гровер|пружинн/ },
  { type: 'blok', label: 'Duvar Bloğu (Блок)', pattern: /керамзитобетон|keramzitobeton|газобетон|(?:^|[^а-яa-z])(?:блок|blok)(?![а-яa-z]*\s*(?:питан|управл|розет))/ },
  { type: 'keramzit-agrega', label: 'Keramzit Agregası (Гравий/Песок)', pattern: /керамзит(?!обетон)|keramzit(?!obeton)/ },
  { type: 'praimer-sbs', label: 'SBS Modifiye Astar (Праймер СБС)', pattern: /праймер\s+сбс|сбс[\s-]*праймер/ },
  { type: 'praimer-bitum', label: 'Bitüm Astarı (Праймер битумный)', pattern: /праймер\s+битумн|битумн[а-я]*\s+праймер/ },
  { type: 'geodezi', label: 'Ölçüm Cihazı (Тахеометр / Нивелир)', pattern: /тахеометр|нивелир|leica|теодолит|трегер/ },
  { type: 'gipsokarton', label: 'Alçıpan Levha (Гипсокартон)', pattern: /гипсокартон|гипрок|gyproc|(?:^|[^а-яa-z0-9])гкл[во]?(?![а-яa-z0-9])/ },
  // Ambalaj/kap kelimesi en sonda: "kovada astar" astardır, kova değildir
  { type: 'vedro', label: 'Kova / Bidon (Ведро / Емкость)', pattern: /(?:^|[^а-яё])(?:ведро|емкость|ёмкость)/ },
];

function normText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/(\d)\s*[хx*×]\s*(?=\d)/g, '$1x');
}

export function extractSpecSignature(rawText: string): SpecSignature {
  const t = normText(rawText);
  const sig: SpecSignature = {};
  if (!t) return sig;

  for (const fam of PRODUCT_TYPE_FAMILIES) {
    if (fam.pattern.test(t)) { sig.type = fam.type; break; }
  }

  const dims = t.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/);
  if (dims) {
    sig.dims = [dims[1], dims[2], dims[3]].filter(Boolean).map(Number).sort((a, b) => a - b).join('x');
  }
  const mic = t.match(/(\d+(?:\.\d+)?)\s*(?:мкм|мкр|микрон|mkm|mkr|mikron)/);
  if (mic) sig.micron = String(Number(mic[1]));
  const lit = t.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:л|lt|литр)(?![a-zа-я])/);
  if (lit) sig.litre = String(Number(lit[1]));
  const pack =
    t.match(/(\d+)\s*шт\.?\s*(?:\/|в)?\s*(?:уп|рул|пач|кор|меш)/) ||
    t.match(/(?:упак[а-я]*|уп\.?|в\s+рулоне)\s*(?:по\s*)?(\d+)\s*шт/) ||
    t.match(/\((\d+)\s*шт\.?\)/);
  if (pack) sig.pack = pack[1];
  const thread = t.match(/(?:^|[^a-zа-я0-9])[мm]\s?(\d{1,2})(?![\d.])/);
  if (thread && Number(thread[1]) >= 4 && Number(thread[1]) <= 64) sig.thread = thread[1];
  const grade = t.match(/(?:^|[^a-zа-я0-9])[мm][\s-]?(\d{3})(?!\d)/);
  if (grade && Number(grade[1]) >= 50 && Number(grade[1]) <= 600) sig.grade = grade[1];
  const kp = t.match(/(?:к\.?\s?п\.?|класс\s+прочности)\s*(\d+(?:\.\d+)?)/);
  if (kp) sig.strength = String(Number(kp[1]));
  const kg = t.match(/(?:^|[^\d.])(\d{1,2})\s*кг(?![a-zа-я])/);
  if (kg && Number(kg[1]) >= 5 && Number(kg[1]) <= 60) sig.bagKg = kg[1];
  return sig;
}

function nearlyEqual(a: number, b: number, tol = 0.05): boolean {
  if (a === b) return true;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 && Math.abs(a - b) / m <= tol;
}

// Ölçüler: alt küme (50x50 ⊂ 50x50x3000), ±%5 tolerans (48x58 ≈ 50x60) ve cm↔mm ölçek farkı (5x10x600 ≈ 50x100x6000) uyumlu sayılır
function areDimsCompatible(a: string, b: string): boolean {
  const A = a.split('x').map(Number);
  const B = b.split('x').map(Number);
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  for (const scale of [1, 10, 100, 1000]) {
    const pool = big.map(v => v);
    const ok = small.every(v => {
      const idx = pool.findIndex(p => nearlyEqual(v * scale, p) || nearlyEqual(v, p * scale));
      if (idx === -1) return false;
      pool.splice(idx, 1);
      return true;
    });
    if (ok) return true;
  }
  return false;
}

export function getSpecConflicts(a: SpecSignature, b: SpecSignature): Array<keyof SpecSignature> {
  const out: Array<keyof SpecSignature> = [];
  for (const k of SPEC_KEYS) {
    if (!a[k] || !b[k] || a[k] === b[k]) continue;
    if (k === 'dims' && areDimsCompatible(a[k]!, b[k]!)) continue;
    out.push(k);
  }
  return out;
}

// Fiyat ölçü birimiyle (m², m³, ton, kg, metre, litre) ifade ediliyorsa ambalaj/ebat bilgisi birim fiyatı değiştirmez
const MEASURED_UNIT_RE = /^(?:m2|м2|m²|м²|metrekare|кв\.?\s*м|m3|м3|m³|м³|metreküp|куб|ton|тонн?а?|т|tn|kg|кг|m|м|metre|mt|пм|п\.м|l|л|lt|litre|литр)\.?$/i;

export function isMeasuredUnit(unit?: string): boolean {
  return MEASURED_UNIT_RE.test(String(unit || '').trim().toLowerCase());
}

export function extractSpecSignatureForUnit(rawText: string, unit?: string): SpecSignature {
  const sig = extractSpecSignature(rawText);
  if (isMeasuredUnit(unit)) {
    delete sig.dims;
    delete sig.pack;
    delete sig.bagKg;
    delete sig.litre;
  }
  return sig;
}

export function areSpecSignaturesCompatible(textA: string, textB: string): boolean {
  return getSpecConflicts(extractSpecSignature(textA), extractSpecSignature(textB)).length === 0;
}

function mergeSig(into: SpecSignature, from: SpecSignature): void {
  for (const k of SPEC_KEYS) {
    if (!into[k] && from[k]) into[k] = from[k];
  }
}

export function getProductTypeLabel(type: string): string {
  return PRODUCT_TYPE_FAMILIES.find(f => f.type === type)?.label || type;
}

function describeValue(k: keyof SpecSignature, v?: string): string {
  if (!v) return '';
  switch (k) {
    case 'type': return PRODUCT_TYPE_FAMILIES.find(f => f.type === v)?.label || v;
    case 'dims': return `Ölçü ${v}`;
    case 'micron': return `${v} mikron`;
    case 'litre': return `${v} L`;
    case 'pack': return `${v} Adet/Paket`;
    case 'thread': return `M${v}`;
    case 'grade': return `M-${v}`;
    case 'strength': return `Kalite Sınıfı ${v}`;
    case 'bagKg': return `${v} kg`;
  }
  return v;
}

/**
 * Bir malzeme grubunu orijinal satırlardaki çelişen özelliklere göre alt gruplara böler.
 * Çelişki yoksa tek grup döner (label boş).
 */
export function splitGroupBySpec<T>(entries: T[], getText: (e: T) => string, getUnit?: (e: T) => string): Array<{ entries: T[]; label: string; signature: SpecSignature }> {
  if (entries.length < 2) return [{ entries, label: '', signature: entries[0] ? extractSpecSignature(getText(entries[0])) : {} }];

  const withSig = entries.map(e => ({ e, sig: extractSpecSignatureForUnit(getText(e), getUnit ? getUnit(e) : undefined) }));
  const richness = (s: SpecSignature) => SPEC_KEYS.filter(k => s[k]).length;
  const order = [...withSig].sort((x, y) => richness(y.sig) - richness(x.sig));

  const clusters: Array<{ sig: SpecSignature; members: T[]; memberSigs: SpecSignature[]; unspecified?: boolean }> = [];
  for (const { e, sig } of order) {
    const candidates = clusters
      .filter(c => getSpecConflicts(c.sig, sig).length === 0)
      .sort((a, b) => b.members.length - a.members.length);
    if (candidates.length > 0) {
      candidates[0].members.push(e);
      candidates[0].memberSigs.push(sig);
      mergeSig(candidates[0].sig, sig);
    } else {
      clusters.push({ sig: { ...sig }, members: [e], memberSigs: [sig] });
    }
  }

  // Kaliteyi belirleyen özellik (mikron, mukavemet sınıfı, marka/M-sınıfı) bir kümede yazılıysa,
  // bu özelliği HİÇ belirtmeyen satır o kümeyle kıyaslanamaz → "Spesifikasyon Belirtilmemiş" kümesine ayrılır.
  const CRITICAL: Array<keyof SpecSignature> = ['micron', 'strength', 'grade'];
  const unspecMembers: T[] = [];
  const unspecSigs: SpecSignature[] = [];
  for (const c of clusters) {
    const crit = CRITICAL.filter(k => c.sig[k]);
    if (!crit.length) continue;
    const keepM: T[] = []; const keepS: SpecSignature[] = [];
    c.members.forEach((m, i) => {
      const s = c.memberSigs[i];
      if (crit.some(k => !s[k])) { unspecMembers.push(m); unspecSigs.push(s); }
      else { keepM.push(m); keepS.push(s); }
    });
    if (keepM.length === 0) continue; // tamamen belirsiz küme ise dokunma
    c.members = keepM; c.memberSigs = keepS;
    const rebuilt: SpecSignature = {};
    keepS.forEach(s => mergeSig(rebuilt, s));
    c.sig = rebuilt;
  }
  if (unspecMembers.length) {
    const s: SpecSignature = {};
    unspecSigs.forEach(x => mergeSig(s, x));
    CRITICAL.forEach(k => { delete s[k]; });
    clusters.push({ sig: s, members: unspecMembers, memberSigs: unspecSigs, unspecified: true });
  }

  if (clusters.length === 1) return [{ entries: clusters[0].members, label: '', signature: clusters[0].sig }];

  // Etiketi yalnızca kümeler arasında farklılaşan özelliklerden üret
  const differing = SPEC_KEYS.filter(k => new Set(clusters.filter(c => !c.unspecified).map(c => c.sig[k] || '')).size > 1 || clusters.some(c => c.unspecified && CRITICAL.includes(k) && clusters.some(o => o.sig[k])));
  return clusters.map(c => {
    if (c.unspecified) {
      return { entries: c.members, label: 'Spesifikasyon Belirtilmemiş', signature: c.sig };
    }
    const parts = differing.map(k => describeValue(k, c.sig[k])).filter(Boolean);
    return { entries: c.members, label: parts.length ? parts.join(', ') : 'Spesifikasyon Belirtilmemiş', signature: c.sig };
  });
}
