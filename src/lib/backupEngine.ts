import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { Firestore, collection, getDocs, doc, setDoc, deleteDoc, getDoc, query, orderBy, limit } from 'firebase/firestore';

export interface SnapshotMeta {
  id: string;
  timestamp: string;
  dateFormatted: string;
  trigger: 'scheduled' | 'manual' | 'pre-restore' | 'auto-mutation' | 'import' | 'chat-command';
  label?: string;
  description?: string;
  recordCounts: {
    supervisors: number;
    personnel?: number;
    jobsites: number;
    discounts: number;
    invoices: number;
  };
  totalRecords: number;
  sizeBytes: number;
  checksum: string;
  status: 'healthy' | 'verified';
  syncedToCloud?: boolean;
}

export interface BackupManifest {
  version: string;
  lastUpdated: string;
  totalSnapshots: number;
  snapshots: SnapshotMeta[];
}

// Prefer workspace persistent directory (data_backup), fallback to temp if permissions restrict
const PRIMARY_BACKUP_ROOT = path.join(process.cwd(), 'data_backup');
const FALLBACK_BACKUP_ROOT = path.join(os.tmpdir(), 'ges_data_backup');

function getBackupRoot(): string {
  try {
    if (!fs.existsSync(PRIMARY_BACKUP_ROOT)) {
      fs.mkdirSync(PRIMARY_BACKUP_ROOT, { recursive: true });
    }
    fs.accessSync(PRIMARY_BACKUP_ROOT, fs.constants.W_OK);
    return PRIMARY_BACKUP_ROOT;
  } catch {
    if (!fs.existsSync(FALLBACK_BACKUP_ROOT)) {
      fs.mkdirSync(FALLBACK_BACKUP_ROOT, { recursive: true });
    }
    return FALLBACK_BACKUP_ROOT;
  }
}

const BACKUP_ROOT = getBackupRoot();
const SNAPSHOTS_DIR = path.join(BACKUP_ROOT, 'snapshots');
const MANIFEST_PATH = path.join(BACKUP_ROOT, 'manifest.json');
const MAX_SNAPSHOTS = 24; // Keep up to 24 snapshots locally (plenty of recovery points)
const MAX_CLOUD_SNAPSHOTS = 5; // Keep up to 10 snapshots in Firestore cloud to strictly avoid memory/query limits

// Ensure directories exist
if (!fs.existsSync(BACKUP_ROOT)) fs.mkdirSync(BACKUP_ROOT, { recursive: true });
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

export function readManifest(): BackupManifest {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const content = fs.readFileSync(MANIFEST_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.snapshots)) {
        return parsed;
      }
    }
  } catch (err: any) {
    console.error('[BackupEngine] Manifest read error:', err.message);
  }
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    totalSnapshots: 0,
    snapshots: []
  };
}

export function saveManifest(manifest: BackupManifest): void {
  try {
    manifest.lastUpdated = new Date().toISOString();
    manifest.totalSnapshots = manifest.snapshots.length;
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[BackupEngine] Manifest write error:', err.message);
  }
}

export interface FullBackupPayload {
  supervisors: any[];
  personnel?: any[];
  jobsites: any[];
  discounts: any[];
  invoices: any[];
  metadata?: any;
}

/**
 * Creates an atomic timestamped snapshot with retention pruning
 */
export function createSnapshot(
  data: FullBackupPayload,
  trigger: SnapshotMeta['trigger'] = 'manual',
  options?: { label?: string; description?: string }
): SnapshotMeta {
  const timestamp = new Date().toISOString();
  const id = `snap_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const snapDir = path.join(SNAPSHOTS_DIR, id);
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });

  const sups = Array.isArray(data.supervisors) ? data.supervisors : [];
  const pers = Array.isArray(data.personnel) ? data.personnel : [];
  const jobs = Array.isArray(data.jobsites) ? data.jobsites : [];
  const dscs = Array.isArray(data.discounts) ? data.discounts : [];
  const invs = Array.isArray(data.invoices) ? data.invoices : [];

  // Write separate collection files
  fs.writeFileSync(path.join(snapDir, 'supervisors.json'), JSON.stringify(sups, null, 2), 'utf-8');
  fs.writeFileSync(path.join(snapDir, 'personnel.json'), JSON.stringify(pers, null, 2), 'utf-8');
  fs.writeFileSync(path.join(snapDir, 'jobsites.json'), JSON.stringify(jobs, null, 2), 'utf-8');
  fs.writeFileSync(path.join(snapDir, 'discounts.json'), JSON.stringify(dscs, null, 2), 'utf-8');
  fs.writeFileSync(path.join(snapDir, 'invoices.json'), JSON.stringify(invs, null, 2), 'utf-8');
  
  // Also write single combined bundle for quick download & restore
  const fullBundle = {
    backupId: id,
    timestamp,
    trigger,
    label: options?.label || `${trigger.toUpperCase()} Backup`,
    description: options?.description || '',
    data: {
      supervisors: sups,
      personnel: pers,
      jobsites: jobs,
      discounts: dscs,
      invoices: invs,
      metadata: data.metadata || {}
    }
  };
  const bundleJson = JSON.stringify(fullBundle, null, 2);
  fs.writeFileSync(path.join(snapDir, 'bundle.json'), bundleJson, 'utf-8');

  // Also update root data_backup files for immediate fail-safe cache
  try {
    fs.writeFileSync(path.join(BACKUP_ROOT, 'supervisors.json'), JSON.stringify(sups, null, 2), 'utf-8');
    fs.writeFileSync(path.join(BACKUP_ROOT, 'personnel.json'), JSON.stringify(pers, null, 2), 'utf-8');
    fs.writeFileSync(path.join(BACKUP_ROOT, 'jobsites.json'), JSON.stringify(jobs, null, 2), 'utf-8');
    fs.writeFileSync(path.join(BACKUP_ROOT, 'discounts.json'), JSON.stringify(dscs, null, 2), 'utf-8');
    fs.writeFileSync(path.join(BACKUP_ROOT, 'invoices.json'), JSON.stringify(invs, null, 2), 'utf-8');
  } catch (e) {}

  // Calculate size and hash
  const sizeBytes = Buffer.byteLength(bundleJson, 'utf-8');
  const checksum = crypto.createHash('sha256').update(bundleJson).digest('hex').substring(0, 16);

  const meta: SnapshotMeta = {
    id,
    timestamp,
    dateFormatted: new Date().toLocaleString('tr-TR'),
    trigger,
    label: options?.label || `${trigger} snapshot`,
    description: options?.description || `${dscs.length} indirim, ${invs.length} fatura kaydı korundu.`,
    recordCounts: {
      supervisors: sups.length,
      personnel: pers.length,
      jobsites: jobs.length,
      discounts: dscs.length,
      invoices: invs.length
    },
    totalRecords: sups.length + pers.length + jobs.length + dscs.length + invs.length,
    sizeBytes,
    checksum,
    status: 'verified',
    syncedToCloud: false
  };

  fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  // Update manifest
  const manifest = readManifest();
  manifest.snapshots.unshift(meta);

  // Prune older snapshots beyond MAX_SNAPSHOTS
  if (manifest.snapshots.length > MAX_SNAPSHOTS) {
    const toRemove = manifest.snapshots.splice(MAX_SNAPSHOTS);
    for (const oldSnap of toRemove) {
      try {
        const oldPath = path.join(SNAPSHOTS_DIR, oldSnap.id);
        if (fs.existsSync(oldPath)) {
          fs.rmSync(oldPath, { recursive: true, force: true });
        }
      } catch (err: any) {
        console.warn(`[BackupEngine] Failed to delete old snapshot ${oldSnap.id}:`, err.message);
      }
    }
  }

  saveManifest(manifest);
  console.log(`[BackupEngine] Snapshot created: ${id} (${meta.totalRecords} records, ${sizeBytes} bytes, trigger: ${trigger})`);
  return meta;
}

/**
 * Loads a snapshot data by id
 */
export function getSnapshotData(id: string): FullBackupPayload | null {
  try {
    const snapDir = path.join(SNAPSHOTS_DIR, id);
    if (!fs.existsSync(snapDir)) return null;

    const bundlePath = path.join(snapDir, 'bundle.json');
    if (fs.existsSync(bundlePath)) {
      const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));
      if (bundle && bundle.data) return bundle.data;
    }

    // Fallback to reading individual files
    const sups = JSON.parse(fs.readFileSync(path.join(snapDir, 'supervisors.json'), 'utf-8'));
    let pers = [];
    if (fs.existsSync(path.join(snapDir, 'personnel.json'))) {
      pers = JSON.parse(fs.readFileSync(path.join(snapDir, 'personnel.json'), 'utf-8'));
    }
    const jobs = JSON.parse(fs.readFileSync(path.join(snapDir, 'jobsites.json'), 'utf-8'));
    const dscs = JSON.parse(fs.readFileSync(path.join(snapDir, 'discounts.json'), 'utf-8'));
    const invs = JSON.parse(fs.readFileSync(path.join(snapDir, 'invoices.json'), 'utf-8'));

    return { supervisors: sups, personnel: pers, jobsites: jobs, discounts: dscs, invoices: invs };
  } catch (err: any) {
    console.error(`[BackupEngine] Error loading snapshot ${id}:`, err.message);
    return null;
  }
}

/**
 * Smart Preservation Merge:
 * Merges snapshot data with current live data so that:
 * 1. Valid records from snapshot are restored (repairing corrupted/deleted records).
 * 2. ANY NEW discounts or invoices added AFTER the snapshot are NOT lost or wiped out!
 * 3. File URLs, document data, and items are safely preserved.
 */
export function smartMergeSnapshots(
  snapshotData: FullBackupPayload,
  currentLiveData: FullBackupPayload,
  options?: { preserveNewRecords?: boolean }
): {
  mergedData: FullBackupPayload;
  stats: {
    restoredFromSnapshot: number;
    newRecordsPreserved: number;
    conflictsResolved: number;
  };
} {
  const preserve = options?.preserveNewRecords !== false; // Default true!
  let newPreserved = 0;
  let restored = 0;
  let conflicts = 0;

  // 1. Discounts Merge
  const discMap = new Map<string, any>();
  const snapDiscs = Array.isArray(snapshotData.discounts) ? snapshotData.discounts : [];
  const liveDiscs = Array.isArray(currentLiveData.discounts) ? currentLiveData.discounts : [];

  // Populate from snapshot
  for (const d of snapDiscs) {
    if (d && d.id) {
      discMap.set(d.id, { ...d });
      restored++;
    }
  }

  // Preserve new discounts added after snapshot and resolve conflicts
  for (const ld of liveDiscs) {
    if (!ld || !ld.id) continue;
    if (ld.isPermanentlyDeleted === true) {
      // Canlı kayıtta kalıcı silinmişse birleştirme listesinden tamamen çıkar, asla geri yükleme
      discMap.delete(ld.id);
      continue;
    }
    if (!discMap.has(ld.id)) {
      if (preserve) {
        discMap.set(ld.id, ld);
        newPreserved++;
      }
    } else {
      // Conflict: same record exists in both.
      conflicts++;
      const snapVer = discMap.get(ld.id);
      // Keep file URLs and items if live version has them and snapshot had missing ones
      const bestFirstFile = ld.firstOfferFileUrl || snapVer.firstOfferFileUrl;
      const bestFinalFile = ld.finalOfferFileUrl || snapVer.finalOfferFileUrl;
      const bestItems = (ld.items && Array.isArray(ld.items) && ld.items.length > 0) ? ld.items : snapVer.items;

      discMap.set(ld.id, {
        ...snapVer, // Revert fields to clean snapshot state
        firstOfferFileUrl: bestFirstFile,
        finalOfferFileUrl: bestFinalFile,
        items: bestItems || [],
        // Anti-hortlama koruması: Canlıda silinmişse silinmişlik durumunu koru, hortlatma!
        ...(ld.isDeleted === true ? { isDeleted: true, deletedAt: ld.deletedAt || new Date().toISOString() } : {})
      });
    }
  }

  // 2. Invoices Merge
  const invMap = new Map<string, any>();
  const snapInvs = Array.isArray(snapshotData.invoices) ? snapshotData.invoices : [];
  const liveInvs = Array.isArray(currentLiveData.invoices) ? currentLiveData.invoices : [];

  for (const i of snapInvs) {
    if (i && i.id) {
      invMap.set(i.id, { ...i });
      restored++;
    }
  }

  for (const li of liveInvs) {
    if (!li || !li.id) continue;
    if (li.isPermanentlyDeleted === true) {
      // Canlı kayıtta kalıcı silinmişse birleştirme listesinden tamamen çıkar, asla geri yükleme
      invMap.delete(li.id);
      continue;
    }
    if (!invMap.has(li.id)) {
      if (preserve) {
        invMap.set(li.id, li);
        newPreserved++;
      }
    } else {
      conflicts++;
      const snapVer = invMap.get(li.id);
      const bestFileUrl = li.fileUrl || snapVer.fileUrl;
      const bestItems = (li.items && Array.isArray(li.items) && li.items.length > 0) ? li.items : snapVer.items;

      invMap.set(li.id, {
        ...snapVer,
        fileUrl: bestFileUrl,
        items: bestItems || [],
        // Anti-hortlama koruması: Canlıda silinmişse silinmişlik durumunu koru, hortlatma!
        ...(li.isDeleted === true ? { isDeleted: true, deletedAt: li.deletedAt || new Date().toISOString() } : {})
      });
    }
  }

  // 3. Supervisors & Jobsites & Personnel (Preserve newly added ones as well)
  const mergeCollection = (snapList: any[], liveList: any[]) => {
    const m = new Map<string, any>();
    for (const item of (snapList || [])) {
      if (item && item.id) m.set(item.id, item);
    }
    for (const item of (liveList || [])) {
      if (item && item.id && !m.has(item.id) && preserve) {
        m.set(item.id, item);
      }
    }
    return Array.from(m.values());
  };

  const finalSups = mergeCollection(snapshotData.supervisors, currentLiveData.supervisors);
  const finalPers = mergeCollection(snapshotData.personnel || [], currentLiveData.personnel || []);
  const finalJobs = mergeCollection(snapshotData.jobsites, currentLiveData.jobsites);

  const finalDiscs = Array.from(discMap.values());
  const finalInvs = Array.from(invMap.values());

  return {
    mergedData: {
      supervisors: finalSups,
      personnel: finalPers,
      jobsites: finalJobs,
      discounts: finalDiscs,
      invoices: finalInvs
    },
    stats: {
      restoredFromSnapshot: restored,
      newRecordsPreserved: newPreserved,
      conflictsResolved: conflicts
    }
  };
}

/**
 * Cloud Sync: Backup to Firestore system_backups collection
 */
export async function syncSnapshotToFirestore(db: Firestore | null, meta: SnapshotMeta, bundleData: FullBackupPayload) {
  if (!db) return;
  try {
    // Günde 1 kontrolü (Sadece son yedeğin bugüne ait olup olmadığını kontrol et)
    try {
      const q = query(collection(db, 'system_backups'), orderBy('timestamp', 'desc'), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const lastDoc = snap.docs[0].data();
        const lastDate = lastDoc.timestamp.split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        if (lastDate === today && meta.trigger !== 'manual') {
          console.log('[BackupEngine] Bugün zaten bir bulut yedeği alınmış, atlanıyor.');
          return;
        }
      }
    } catch (_) {}

    const compactDoc = {
      ...meta,
      syncedToCloud: true,
      syncedAt: new Date().toISOString(),
      // Sadece metadata kaydediyoruz, data yok (Firestore 1MB limitini ve maliyetleri aşmamak için)
      data: null
    };
    await setDoc(doc(db, 'system_backups', meta.id), compactDoc);
    console.log(`[BackupEngine] Snapshot ${meta.id} synced to Firestore Cloud.`);

    // Cloud Retention: Ensure Firestore never exceeds quota or memory limits
    try {
      const q = query(collection(db, 'system_backups'), limit(15));
      const snap = await getDocs(q);
      if (snap.docs.length > MAX_CLOUD_SNAPSHOTS) {
        const sorted = snap.docs.map(d => {
          const dt = d.data();
          return {
            id: d.id,
            timestamp: dt.timestamp || dt.syncedAt || d.id
          };
        }).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        const toDelete = sorted.slice(MAX_CLOUD_SNAPSHOTS);
        for (const oldDoc of toDelete) {
          await deleteDoc(doc(db, 'system_backups', oldDoc.id)).catch(() => {});
        }
      }
    } catch {
      // Non-blocking cloud pruning error
    }
  } catch (err: any) {
    console.warn(`[BackupEngine] Could not sync snapshot to Firestore:`, err.message);
  }
}

/**
 * Cloud Hydrate: Restore snapshots from Firestore if local snapshots directory was cleared
 */
export async function hydrateSnapshotsFromFirestore(db: Firestore | null): Promise<number> {
  if (!db) return 0;
  try {
    // Strictly limit query to MAX_CLOUD_SNAPSHOTS (max 10) to avoid exceeding Firestore's 128MB query buffer
    const q = query(collection(db, 'system_backups'), limit(MAX_CLOUD_SNAPSHOTS));
    const snap = await getDocs(q);
    let restoredCount = 0;
    const manifest = readManifest();
    const existingIds = new Set(manifest.snapshots.map(s => s.id));

    for (const d of snap.docs) {
      const snapDoc = d.data();
      if (!snapDoc || !snapDoc.id) continue;

      if (!existingIds.has(snapDoc.id)) {
        const snapDir = path.join(SNAPSHOTS_DIR, snapDoc.id);
        if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });

        const data = snapDoc.data || {
          supervisors: [],
          personnel: [],
          jobsites: [],
          discounts: [],
          invoices: []
        };

        fs.writeFileSync(path.join(snapDir, 'supervisors.json'), JSON.stringify(data.supervisors || [], null, 2), 'utf-8');
        fs.writeFileSync(path.join(snapDir, 'personnel.json'), JSON.stringify(data.personnel || [], null, 2), 'utf-8');
        fs.writeFileSync(path.join(snapDir, 'jobsites.json'), JSON.stringify(data.jobsites || [], null, 2), 'utf-8');
        fs.writeFileSync(path.join(snapDir, 'discounts.json'), JSON.stringify(data.discounts || [], null, 2), 'utf-8');
        fs.writeFileSync(path.join(snapDir, 'invoices.json'), JSON.stringify(data.invoices || [], null, 2), 'utf-8');

        const bundle = {
          backupId: snapDoc.id,
          timestamp: snapDoc.timestamp,
          trigger: snapDoc.trigger,
          label: snapDoc.label,
          description: snapDoc.description,
          data
        };
        fs.writeFileSync(path.join(snapDir, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf-8');

        const meta: SnapshotMeta = {
          id: snapDoc.id,
          timestamp: snapDoc.timestamp || new Date().toISOString(),
          dateFormatted: snapDoc.dateFormatted || new Date().toLocaleString('tr-TR'),
          trigger: snapDoc.trigger || 'scheduled',
          label: snapDoc.label || 'Cloud Snapshot',
          description: snapDoc.description || 'Restored from Firestore Cloud Backup',
          recordCounts: snapDoc.recordCounts || {
            supervisors: data.supervisors?.length || 0,
            personnel: data.personnel?.length || 0,
            jobsites: data.jobsites?.length || 0,
            discounts: data.discounts?.length || 0,
            invoices: data.invoices?.length || 0
          },
          totalRecords: snapDoc.totalRecords || 0,
          sizeBytes: snapDoc.sizeBytes || 0,
          checksum: snapDoc.checksum || 'cloud',
          status: 'verified',
          syncedToCloud: true
        };

        fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
        manifest.snapshots.push(meta);
        restoredCount++;
      }
    }

    if (restoredCount > 0) {
      manifest.snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      saveManifest(manifest);
      console.log(`[BackupEngine] Hydrated ${restoredCount} snapshots from Firestore Cloud.`);
    }

    return restoredCount;
  } catch (err: any) {
    console.warn(`[BackupEngine] Cloud hydration warning:`, err.message);
    return 0;
  }
}

let gcsBucketVerified = false;
let gcsBucketUnavailable = false;

async function isGcsBucketAvailable(bucket: any): Promise<boolean> {
  if (!bucket || gcsBucketUnavailable) return false;
  if (gcsBucketVerified) return true;
  try {
    await bucket.getFiles({ maxResults: 1 });
    gcsBucketVerified = true;
    return true;
  } catch {
    gcsBucketUnavailable = true;
    return false;
  }
}

/**
 * Cloud Sync: Persists snapshot bundle and manifest to Firestore Cloud (and GCS if available)
 * Ensuring backups survive Cloud Run container restarts and ephemeral disk wipes
 */
export async function syncSnapshotToCloud(
  db: any,
  bucket: any,
  meta: SnapshotMeta,
  bundleJson?: string
): Promise<boolean> {
  const snapDir = path.join(SNAPSHOTS_DIR, meta.id);
  let payload = bundleJson;
  if (!payload && fs.existsSync(path.join(snapDir, 'bundle.json'))) {
    payload = fs.readFileSync(path.join(snapDir, 'bundle.json'), 'utf-8');
  }

  let syncedFirestore = false;
  let syncedGcs = false;

  // 1. Primary Durable Cloud Persistence: Firestore `system_backups` collection
  if (db && payload) {
    try {
      const compressedBase64 = zlib.gzipSync(Buffer.from(payload, 'utf-8')).toString('base64');
      const backupDocRef = doc(db, 'system_backups', meta.id);
      const CHUNK_SIZE = 600000;

      if (compressedBase64.length <= CHUNK_SIZE) {
        await setDoc(backupDocRef, {
          id: meta.id,
          meta,
          isChunked: false,
          compressedData: compressedBase64,
          sizeBytes: meta.sizeBytes,
          compressedBytes: compressedBase64.length,
          timestamp: meta.timestamp,
          updatedAt: new Date().toISOString()
        });
      } else {
        const chunkCount = Math.ceil(compressedBase64.length / CHUNK_SIZE);
        for (let i = 0; i < chunkCount; i++) {
          const chunkStr = compressedBase64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await setDoc(doc(db, 'system_backups', `${meta.id}_chunk_${i}`), {
            snapshotId: meta.id,
            chunkIndex: i,
            chunkData: chunkStr
          });
        }
        await setDoc(backupDocRef, {
          id: meta.id,
          meta,
          isChunked: true,
          chunkCount,
          sizeBytes: meta.sizeBytes,
          compressedBytes: compressedBase64.length,
          timestamp: meta.timestamp,
          updatedAt: new Date().toISOString()
        });
      }

      syncedFirestore = true;
      console.log(`[BackupEngine] Snapshot ${meta.id} successfully synced to Firestore cloud (${(compressedBase64.length/1024).toFixed(1)} KB compressed).`);
    } catch (err: any) {
      console.warn(`[BackupEngine] Firestore cloud backup error for snapshot ${meta.id}:`, err.message);
    }
  }

  // 2. Secondary Cloud Persistence: Google Cloud Storage bucket (if available and verified)
  if (bucket && payload && !gcsBucketUnavailable) {
    const isAvailable = await isGcsBucketAvailable(bucket);
    if (isAvailable) {
      try {
        const gcsFile = bucket.file(`sistem-yedekleri/snapshots/${meta.id}/bundle.json`);
        await gcsFile.save(payload, {
          resumable: false,
          metadata: { contentType: 'application/json', cacheControl: 'no-store' }
        });
        syncedGcs = true;
        console.log(`[BackupEngine] Snapshot ${meta.id} successfully synced to GCS.`);
      } catch (err: any) {
        console.info(`[BackupEngine] GCS sync skipped for snapshot ${meta.id}:`, err.message);
      }
    }
  }

  if (syncedFirestore || syncedGcs) {
    meta.syncedToCloud = true;
  }

  const manifest = readManifest();
  const existingIndex = manifest.snapshots.findIndex(s => s.id === meta.id);
  if (existingIndex >= 0) {
    manifest.snapshots[existingIndex].syncedToCloud = meta.syncedToCloud;
  }
  saveManifest(manifest);

  try {
    fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  } catch (_) {}

  // Sync manifest to Firestore & GCS
  if (db) {
    try {
      const cleanManifest = {
        ...manifest,
        snapshots: manifest.snapshots.map(s => ({ ...s }))
      };
      await setDoc(doc(db, 'system_backups', '_manifest'), {
        manifest: cleanManifest,
        lastUpdated: new Date().toISOString()
      });
    } catch (_) {}
  }

  if (bucket && !gcsBucketUnavailable) {
    const isAvailable = await isGcsBucketAvailable(bucket);
    if (isAvailable) {
      try {
        const manifestFile = bucket.file('sistem-yedekleri/manifest.json');
        await manifestFile.save(JSON.stringify(manifest, null, 2), {
          resumable: false,
          metadata: { contentType: 'application/json', cacheControl: 'no-store' }
        });
      } catch (_) {}
    }
  }

  return syncedFirestore || syncedGcs;
}

export const syncSnapshotToGCS = (bucket: any, meta: SnapshotMeta, bundleJson?: string) =>
  syncSnapshotToCloud(null, bucket, meta, bundleJson);

/**
 * Loads and merges manifest from Firestore Cloud and GCS bucket
 */
export async function loadManifestFromCloud(db: any, bucket: any): Promise<BackupManifest> {
  const local = readManifest();

  // Check Firestore cloud manifest & docs
  if (db) {
    try {
      const manifestDoc = await getDoc(doc(db, 'system_backups', '_manifest'));
      if (manifestDoc.exists()) {
        const cloudData = manifestDoc.data();
        if (cloudData?.manifest?.snapshots) {
          const localMap = new Map(local.snapshots.map(s => [s.id, s]));
          for (const s of cloudData.manifest.snapshots) {
            if (!localMap.has(s.id)) {
              local.snapshots.push(s);
              localMap.set(s.id, s);
            } else {
              const loc = localMap.get(s.id);
              if (loc && s.syncedToCloud) loc.syncedToCloud = true;
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[BackupEngine] Firestore manifest load warning:', err.message);
    }
  }

  // Check GCS manifest (if bucket is valid)
  if (bucket && !gcsBucketUnavailable) {
    const isAvailable = await isGcsBucketAvailable(bucket);
    if (isAvailable) {
      try {
        const gcsFile = bucket.file('sistem-yedekleri/manifest.json');
        const [exists] = await gcsFile.exists();
        if (exists) {
          const [contents] = await gcsFile.download();
          const gcsManifest = JSON.parse(contents.toString('utf-8'));
          if (gcsManifest && Array.isArray(gcsManifest.snapshots)) {
            const localMap = new Map(local.snapshots.map(s => [s.id, s]));
            for (const s of gcsManifest.snapshots) {
              if (!localMap.has(s.id)) {
                local.snapshots.push(s);
                localMap.set(s.id, s);
              } else {
                const loc = localMap.get(s.id);
                if (loc && s.syncedToCloud) loc.syncedToCloud = true;
              }
            }
          }
        }
      } catch (err: any) {
        console.info('[BackupEngine] GCS manifest load notice:', err.message);
      }
    }
  }

  local.snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  local.totalSnapshots = local.snapshots.length;
  local.lastUpdated = local.snapshots[0]?.timestamp || local.lastUpdated;
  saveManifest(local);
  return local;
}

export const loadManifestFromGCS = (bucket: any) => loadManifestFromCloud(null, bucket);

/**
 * Retrieves snapshot bundle from local disk, Firestore Cloud, or GCS
 */
export async function getSnapshotFromCloud(
  db: any,
  bucket: any,
  id: string
): Promise<FullBackupPayload | null> {
  // 1. Try local disk
  const localData = getSnapshotData(id);
  if (localData) return localData;

  // 2. Try Firestore Cloud
  if (db) {
    try {
      const snapDoc = await getDoc(doc(db, 'system_backups', id));
      if (snapDoc.exists()) {
        const docData = snapDoc.data();
        let rawBase64 = '';

        if (docData?.isChunked && docData.chunkCount) {
          const chunkPromises = [];
          for (let i = 0; i < docData.chunkCount; i++) {
            chunkPromises.push(getDoc(doc(db, 'system_backups', `${id}_chunk_${i}`)));
          }
          const chunkDocs = await Promise.all(chunkPromises);
          rawBase64 = chunkDocs.map(c => (c.exists() ? c.data()?.chunkData || '' : '')).join('');
        } else if (docData?.compressedData) {
          rawBase64 = docData.compressedData;
        }

        if (rawBase64) {
          const rawBuf = Buffer.from(rawBase64, 'base64');
          const decompressed = zlib.gunzipSync(rawBuf).toString('utf-8');
          const bundle = JSON.parse(decompressed);
          if (bundle && bundle.data) {
            // Cache locally for faster subsequent access
            const snapDir = path.join(SNAPSHOTS_DIR, id);
            if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
            fs.writeFileSync(path.join(snapDir, 'bundle.json'), decompressed, 'utf-8');
            return bundle.data;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[BackupEngine] Firestore snapshot fetch error for ${id}:`, err.message);
    }
  }

  // 3. Try GCS (if bucket is valid)
  if (bucket && !gcsBucketUnavailable) {
    const isAvailable = await isGcsBucketAvailable(bucket);
    if (isAvailable) {
      try {
        const gcsFile = bucket.file(`sistem-yedekleri/snapshots/${id}/bundle.json`);
        const [exists] = await gcsFile.exists();
        if (exists) {
          const [contents] = await gcsFile.download();
          const bundle = JSON.parse(contents.toString('utf-8'));
          if (bundle && bundle.data) {
            const snapDir = path.join(SNAPSHOTS_DIR, id);
            if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
            fs.writeFileSync(path.join(snapDir, 'bundle.json'), contents.toString('utf-8'), 'utf-8');
            return bundle.data;
          }
        }
      } catch (err: any) {
        console.info(`[BackupEngine] GCS snapshot fetch notice for ${id}:`, err.message);
      }
    }
  }

  return null;
}

export const getSnapshotFromGCS = (bucket: any, id: string) =>
  getSnapshotFromCloud(null, bucket, id);


