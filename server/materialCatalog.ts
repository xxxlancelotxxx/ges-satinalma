/**
 * MALZEME KATALOĞU / KALICI EŞLEŞTİRME (ALIAS) DEPOSU
 *
 * Kullanıcının "Malzeme Birleştir" ile verdiği kararları kalıcı hale getirir. Her karar, kaynak satırların
 * ayırt edici anahtarlarını (Prizma stok kodu, orijinal fatura satırı parmak izi, malzeme adı parmak izi,
 * kural motorunun ürettiği grup adı parmak izi) hedef katalog kaydına bağlayan alias kayıtları olarak
 * Firestore `material_aliases` koleksiyonunda (+ disk yedeği) saklanır.
 *
 * /api/materials/compare gruplamasında alias'lar, ~2400 satırlık kural motorundan ÖNCE uygulanır;
 * böylece elle yapılan birleştirmeler kural değişiklikleriyle geri alınamaz ve aynı satır tekrar
 * geldiğinde (yeni OCR faturası veya Prizma senkronu) otomatik olarak doğru katalog kaydına düşer.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { materialFingerprint, isDistinctiveFingerprint } from '../src/utils/materialFingerprint';

export type MaterialAliasKind = 'code' | 'orig' | 'name' | 'canon';

export interface MaterialAlias {
  id: string;
  kind: MaterialAliasKind;
  /** Eşleştirme anahtarı: Prizma stok kodu veya parmak izi */
  key: string;
  /** Hedef katalog anahtarı (compare grup anahtarı) */
  targetKey: string;
  /** Hedef katalog kaydının görünen adı */
  targetName: string;
  targetCategory?: string;
  sourceName?: string;
  sample?: string;
  createdBy?: string;
  createdAt: string;
  isDeleted: false;
}

export interface AliasLookupInput {
  materialCode?: string | null;
  originalName?: string | null;
  /** originalName gerçek bir fatura satırı mı (sentetik şablon / kısa not değil mi)? */
  originalIsGenuine?: boolean;
  materialName?: string | null;
  canonName?: string | null;
}

const LOOKUP_ORDER: MaterialAliasKind[] = ['code', 'orig', 'name', 'canon'];

export function catalogKeyForName(name: string): string {
  const fp = materialFingerprint(name);
  return fp ? `fp:${fp}` : `raw:${String(name || '').toLowerCase().trim()}`;
}

export function aliasDocId(kind: MaterialAliasKind, key: string): string {
  return `${kind}_${crypto.createHash('sha1').update(`${kind}|${key}`).digest('hex').slice(0, 32)}`;
}

function normalizeCode(code?: string | null): string {
  return String(code || '').trim().toUpperCase();
}

/** Bir kalem için alias anahtarlarını üretir (yalnızca yeterince ayırt edici olanlar). */
export function aliasKeysForItem(input: AliasLookupInput): Array<{ kind: MaterialAliasKind; key: string }> {
  const keys: Array<{ kind: MaterialAliasKind; key: string }> = [];
  const code = normalizeCode(input.materialCode);
  if (code) keys.push({ kind: 'code', key: code });
  if (input.originalIsGenuine) {
    const fp = materialFingerprint(input.originalName);
    if (isDistinctiveFingerprint(fp)) keys.push({ kind: 'orig', key: fp });
  }
  const nameFp = materialFingerprint(input.materialName);
  if (isDistinctiveFingerprint(nameFp)) keys.push({ kind: 'name', key: nameFp });
  const canonFp = materialFingerprint(input.canonName);
  if (isDistinctiveFingerprint(canonFp)) keys.push({ kind: 'canon', key: canonFp });
  return keys;
}

export class MaterialAliasIndex {
  private byId = new Map<string, MaterialAlias>();
  /** Önbellek damgası: alias kümesi her değiştiğinde artar (compare önbelleği bununla geçersizlenir). */
  version = 0;

  constructor(list: MaterialAlias[] = []) {
    this.replaceAll(list);
  }

  replaceAll(list: MaterialAlias[]) {
    this.byId.clear();
    for (const a of list) {
      if (a && a.kind && a.key && a.targetKey && a.targetName) this.byId.set(aliasDocId(a.kind, a.key), { ...a, id: aliasDocId(a.kind, a.key) });
    }
    this.version++;
  }

  upsert(list: MaterialAlias[]) {
    for (const a of list) this.byId.set(a.id, a);
    this.version++;
  }

  remove(id: string): MaterialAlias | undefined {
    const existing = this.byId.get(id);
    if (existing) {
      this.byId.delete(id);
      this.version++;
    }
    return existing;
  }

  get size() {
    return this.byId.size;
  }

  list(): MaterialAlias[] {
    return Array.from(this.byId.values());
  }

  /** Öncelik: Prizma stok kodu → orijinal satır → malzeme adı → kural motoru grup adı */
  lookup(input: AliasLookupInput): MaterialAlias | undefined {
    if (this.byId.size === 0) return undefined;
    const keys = aliasKeysForItem(input);
    for (const kind of LOOKUP_ORDER) {
      const k = keys.find(x => x.kind === kind);
      if (!k) continue;
      const hit = this.byId.get(aliasDocId(k.kind, k.key));
      if (hit) return hit;
    }
    return undefined;
  }
}

export interface MergeEntryInput {
  materialCode?: string | null;
  originalName?: string | null;
  originalIsGenuine?: boolean;
  materialName?: string | null;
}

/**
 * Birleştirme kararından alias kayıtlarını üretir. Kaynak VE hedef grubun tüm satırları hedefe bağlanır;
 * böylece hedef daha sonra başka bir kayda birleştirilirse zincir oluşmadan tüm üyeler yeniden bağlanır.
 */
export function buildMergeAliases(params: {
  sourceGroupNames: string[];
  targetName: string;
  targetCategory?: string;
  entries: MergeEntryInput[];
  createdBy?: string;
  now?: string;
}): MaterialAlias[] {
  const targetKey = catalogKeyForName(params.targetName);
  const createdAt = params.now || new Date().toISOString();
  const out = new Map<string, MaterialAlias>();
  const add = (kind: MaterialAliasKind, key: string, sample: string) => {
    const id = aliasDocId(kind, key);
    if (out.has(id)) return;
    out.set(id, {
      id,
      kind,
      key,
      targetKey,
      targetName: params.targetName,
      ...(params.targetCategory ? { targetCategory: params.targetCategory } : {}),
      sourceName: params.sourceGroupNames.join(' | ').slice(0, 500),
      sample: String(sample || '').slice(0, 300),
      createdBy: params.createdBy || 'Kullanıcı',
      createdAt,
      isDeleted: false
    });
  };

  for (const e of params.entries) {
    for (const k of aliasKeysForItem({ ...e, canonName: undefined })) {
      add(k.kind, k.key, e.originalName || e.materialName || '');
    }
  }
  for (const n of params.sourceGroupNames) {
    const fp = materialFingerprint(n);
    if (isDistinctiveFingerprint(fp)) add('canon', fp, n);
  }
  return Array.from(out.values());
}

/**
 * Yanlış gruplanmış tek bir fatura satırını kendi katalog kaydına ayırır. Yalnızca orijinal satırın
 * parmak izi kullanılır (aynı metne sahip satırlar aynı üründür); Prizma kodu / ad anahtarları grup
 * kardeşleriyle paylaşılabileceği için kullanılmaz.
 */
export function buildSplitAlias(params: {
  originalName: string;
  targetName: string;
  targetCategory?: string;
  sourceGroupName: string;
  createdBy?: string;
  now?: string;
}): MaterialAlias | null {
  const key = materialFingerprint(params.originalName);
  if (!isDistinctiveFingerprint(key)) return null;
  const id = aliasDocId('orig', key);
  return {
    id,
    kind: 'orig',
    key,
    targetKey: catalogKeyForName(params.targetName),
    targetName: params.targetName,
    ...(params.targetCategory ? { targetCategory: params.targetCategory } : {}),
    sourceName: `AYRILDI: ${params.sourceGroupName}`.slice(0, 500),
    sample: String(params.originalName).slice(0, 300),
    createdBy: params.createdBy || 'Kullanıcı',
    createdAt: params.now || new Date().toISOString(),
    isDeleted: false
  };
}

// ----------------------------------------------------------------------------
// Kalıcılık (Firestore + disk yedeği). Firestore Web SDK çevrimdışıyken yazma vaatleri hiç çözülmeyebilir;
// bu yüzden her çağrı zaman aşımıyla sarılır ve disk yedeği her zaman güncellenir.
// ----------------------------------------------------------------------------
const COLLECTION = 'material_aliases';
const FIRESTORE_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} zaman aşımı (${ms} ms)`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export class MaterialAliasStore {
  readonly index = new MaterialAliasIndex();
  /** Son yüklemenin kaynağı: 'firestore' kalıcıdır, 'disk' yalnızca bu sunucu örneğinde geçerlidir */
  source: 'firestore' | 'disk' | 'none' = 'none';
  /** Son Firestore yazma denemesi başarılı mı? (null = henüz yazılmadı) */
  lastWriteOk: boolean | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor(private getDb: () => any, private backupDir: string) {}

  private get diskFile() {
    return path.join(this.backupDir, 'material_aliases.json');
  }

  private readDisk(): MaterialAlias[] {
    try {
      if (fs.existsSync(this.diskFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.diskFile, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err: any) {
      console.warn('[MATERIAL ALIAS] Disk okuma uyarısı:', err.message);
    }
    return [];
  }

  private writeDisk() {
    try {
      if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
      fs.writeFileSync(this.diskFile, JSON.stringify(this.index.list(), null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[MATERIAL ALIAS] Disk yazma uyarısı:', err.message);
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = (async () => {
        let list: MaterialAlias[] | null = null;
        const db = this.getDb();
        if (db) {
          try {
            const snap: any = await withTimeout(getDocs(query(collection(db, COLLECTION), where('isDeleted', '==', false))), FIRESTORE_TIMEOUT_MS, 'material_aliases okuma');
            list = snap.docs.map((d: any) => ({ ...d.data(), id: d.id }) as MaterialAlias);
          } catch (err: any) {
            console.warn('[MATERIAL ALIAS] Firestore okunamadı, disk yedeği kullanılıyor:', err.message);
          }
        }
        this.source = list === null ? 'disk' : 'firestore';
        if (list === null) list = this.readDisk();
        this.index.replaceAll(list);
        if (list.length) this.writeDisk();
        this.loaded = true;
      })().finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  /** Alias'ları kaydeder. Dönen `persisted` false ise kayıt yalnızca bellekte ve disk yedeğindedir. */
  async save(aliases: MaterialAlias[]): Promise<{ persisted: boolean; error?: string }> {
    await this.ensureLoaded();
    this.index.upsert(aliases);
    this.writeDisk();
    const db = this.getDb();
    if (!db) {
      this.lastWriteOk = false;
      return { persisted: false, error: 'Firestore bağlı değil' };
    }
    try {
      await withTimeout(
        Promise.all(aliases.map(a => setDoc(doc(db, COLLECTION, a.id), a))),
        FIRESTORE_TIMEOUT_MS * 2,
        'material_aliases yazma'
      );
      this.lastWriteOk = true;
      return { persisted: true };
    } catch (err: any) {
      console.warn('[MATERIAL ALIAS] Firestore yazma uyarısı:', err.message);
      this.lastWriteOk = false;
      return { persisted: false, error: err.message };
    }
  }

  async remove(ids: string[]): Promise<{ removed: MaterialAlias[]; persisted: boolean; error?: string }> {
    await this.ensureLoaded();
    const removed = ids.map(id => this.index.remove(id)).filter(Boolean) as MaterialAlias[];
    this.writeDisk();
    const db = this.getDb();
    if (!db || removed.length === 0) return { removed, persisted: !db ? false : true };
    try {
      await withTimeout(
        Promise.all(removed.map(a => deleteDoc(doc(db, COLLECTION, a.id)))),
        FIRESTORE_TIMEOUT_MS * 2,
        'material_aliases silme'
      );
      return { removed, persisted: true };
    } catch (err: any) {
      return { removed, persisted: false, error: err.message };
    }
  }
}
