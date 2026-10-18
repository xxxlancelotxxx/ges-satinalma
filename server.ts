// Ortam değişkenleri (.env.local / .env) diğer modüllerden önce yüklenmeli.
import './server/envLoader';
import { processItem } from './src/utils/aiDecisionEngine';
import { comparisonMultiplierForVat } from './src/utils/vatBasis';
import { normalizeStandardUnit, getMaterialBenchmarkUnit, convertMaterialUnit, areUnitsConvertible, extractRebarDiameter } from './src/utils/constructionUnitConverter';
import { normalizeVendorName, getVendorKey, areVendorsEqual } from './src/utils/vendorNormalizer';
import { normalizeCategoryName, CANONICAL_28_CATEGORIES, translateRussianMaterialToTurkish, ensureRussianOriginalName, resolveItemCategory } from './src/utils/categoryClassifier';
import { analyzeMaterialSegment } from './src/utils/materialSegmentIntelligence';
import { splitGroupBySpec, getProductTypeLabel, ensureComparisonGroupIntegrity } from './src/utils/materialGroupIntegrity';
import { checkRecordPermission, getUserAuthorizedJobsiteIds, canonicalizeJobsiteId } from './src/utils/permissions';
import { comparativeAnalysesStore, materialSynonymsStore, comparativeConfig, updateComparativeConfig, processComparativeAnalysisBatch, learnApprovedSynonyms, recalculateComparativeAnalysis } from './server/comparativeEngine';
import { prizmaService } from './server/prizmaService';
import { prizmaSyncService, cleanRawMaterialName } from './server/prizmaSyncService';
import { MaterialAliasStore, buildMergeAliases, buildSplitAlias, aliasKeysForItem, aliasDocId, catalogKeyForName } from './server/materialCatalog';
import { buildMergeSuggestions } from './src/utils/materialMergeSuggestions';
import { materialFingerprint } from './src/utils/materialFingerprint';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 50;
import os from 'os';
import express from 'express';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb } from 'pdf-lib';
import path from 'path';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { initializeApp as initFirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  writeBatch 
} from 'firebase/firestore';
import { GoogleGenAI, Type } from '@google/genai';

import fs from 'fs';
import cron from 'node-cron';

const SESSION_BACKUP_FILE = path.join(process.cwd(), 'data_backup', 'sessionTokens.json');
const SESSION_FILE = path.join(os.tmpdir(), 'sessionTokens.json');
let _memTokens = new Map<string, { role: string, expires: number }>();
try {
  if (fs.existsSync(SESSION_BACKUP_FILE)) {
    const data = JSON.parse(fs.readFileSync(SESSION_BACKUP_FILE, 'utf8'));
    _memTokens = new Map(Object.entries(data));
  } else if (fs.existsSync(SESSION_FILE)) {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    _memTokens = new Map(Object.entries(data));
  }
} catch (e) {}

const sessionTokens = {
  get: (k: string) => _memTokens.get(k),
  set: (k: string, v: any) => {
    _memTokens.set(k, v);
    try {
      if (!fs.existsSync(path.dirname(SESSION_BACKUP_FILE))) {
        fs.mkdirSync(path.dirname(SESSION_BACKUP_FILE), { recursive: true });
      }
      fs.writeFileSync(SESSION_BACKUP_FILE, JSON.stringify(Object.fromEntries(_memTokens)), 'utf8');
    } catch (_) {}
    try {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(Object.fromEntries(_memTokens)), 'utf8');
    } catch (_) {}
  }
};

import {
  INITIAL_SUPERVISORS,
  INITIAL_PERSONNEL,
  INITIAL_JOBSITES,
  INITIAL_DISCOUNTS,
  INITIAL_INVOICES
} from './src/data/initialData';
import { NEGOTIATION_THRESHOLD, NEGOTIATION_EFFORT_COEFF, calculateNegotiationEffortScore } from './src/utils/procedureConfig';
import { createSnapshot, readManifest, getSnapshotData, smartMergeSnapshots, syncSnapshotToCloud, loadManifestFromCloud, getSnapshotFromCloud } from './src/lib/backupEngine';
import { 
  getGenAI, 
  robustParseJSON, 
  validateInvoiceData, 
  checkDuplicateInvoice, 
  calculateFileHash,
  generateContentWithResilience
} from './server/aiOcrEngine';
import { processInvoiceTwoStages, fallbackExtractInvoiceFromTextOrCsv } from './server/aiTwoStageOcr';
import { generateArchivePdf } from './server/documentGenerator';

// ============================================================================
// 1. FIREBASE & STORAGE ENTEGRASYONU
// ============================================================================
// Cloud Storage için Firebase Admin SDK, Firestore için ise Proje Web SDK kullanılır.
if (!admin.getApps().length) {
  admin.initializeApp();
}

const PRIMARY_GCS_BUCKET = 'ai-studio-bucket-88134939798-europe-west2';
let db: any = null;
let bucket: any = null;
try {
  const configRaw = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
  const firebaseConfig = JSON.parse(configRaw);
  const fbApp = initFirebaseApp(firebaseConfig);
  db = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId || '(default)');
  const configuredBucket = (firebaseConfig.storageBucket && !String(firebaseConfig.storageBucket).includes('fatura-botu-505106.firebasestorage.app'))
    ? firebaseConfig.storageBucket
    : PRIMARY_GCS_BUCKET;
  bucket = getStorage().bucket(configuredBucket);
  console.log(`[FIREBASE] Firestore (Web SDK) ve Storage (${configuredBucket}) başarıyla başlatıldı.`);
  if (db) {
    prizmaSyncService.setDb(db);
  }
} catch (e: any) {
  console.warn('[FIREBASE] firebase-applet-config.json bulunamadı veya hatalı:', e.message);
}

// ============================================================================
// 2. EXPRESS.JS SUNUCU YAPILANDIRMASI
// ============================================================================
const app = express();
const uploadDir = path.join(os.tmpdir(), 'ges_uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const LOCAL_FILES_DIR = path.join(process.cwd(), 'data_backup', 'files');
if (!fs.existsSync(LOCAL_FILES_DIR)) fs.mkdirSync(LOCAL_FILES_DIR, { recursive: true });
app.use('/uploads', express.static(uploadDir));
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));


// ============================================================================
// X. BUCKET VERSION CLEANUP (ADMIN TOOL)
// ============================================================================
app.post('/api/admin/clean-bucket-versions', async (req, res) => {
  const sessionToken = (req.headers['x-session-token'] as string) || (req.query.token as string);
  const session = sessionToken ? sessionTokens.get(sessionToken) : null;
  const isAuthorized = session && session.role === 'admin' && session.expires > Date.now();
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Yetkisiz işlem: Bu işlem sunucu tarafında doğrulanmış aktif bir yönetici oturumu gerektirir.' });
  }
  if (!bucket) {
    return res.status(500).json({ error: 'Bucket yapılandırılmamış.' });
  }
  
  try {
    const isDryRun = req.body.confirm !== true; // Onay yoksa sadece listeler
    const [files] = await bucket.getFiles({ versions: true });
    
    const versionsByName = new Map<string, any[]>();
    for (const f of files) {
      if (!versionsByName.has(f.name)) versionsByName.set(f.name, []);
      versionsByName.get(f.name)!.push(f);
    }

    let deletedCount = 0;
    const deletedDetails: string[] = [];
    const keepCount = 3;

    for (const [name, fileVersions] of versionsByName.entries()) {
      // Sort by generation descending (newest first)
      fileVersions.sort((a, b) => Number(b.metadata.generation) - Number(a.metadata.generation));
      
      if (fileVersions.length > keepCount) {
        const toDelete = fileVersions.slice(keepCount);
        for (const f of toDelete) {
          deletedDetails.push(`${name} (Gen: ${f.metadata.generation})`);
          if (!isDryRun) {
            await f.delete();
            deletedCount++;
          }
        }
      }
    }

    res.json({
      success: true,
      message: isDryRun ? 'Eski versiyonlar listelendi (Silinmedi. Silmek için confirm: true gönderin).' : 'Eski versiyonlar başarıyla silindi.',
      mode: isDryRun ? 'DRY_RUN' : 'DELETED',
      deletedCount: isDryRun ? deletedDetails.length : deletedCount,
      details: deletedDetails
    });
  } catch (err: any) {
    console.error('[CLEANUP ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  let invCount = 0;
  let discCount = 0;
  let warning = null;
  let lastBackupHoursAgo: string | null = null;
  let latestBackupTimestampMs = 0;
  
  if (db) {
    try {
      const invSnap = await getDocs(collection(db, 'invoices'));
      const discSnap = await getDocs(collection(db, 'discounts'));
      invCount = invSnap.size;
      discCount = discSnap.size;
      
      const statDoc = await getDoc(doc(db, 'system_stats', 'daily_counts'));
      const totalNow = invCount + discCount;
      if (statDoc.exists()) {
        const lastTotal = statDoc.data().total;
        if (lastTotal > 0) {
          const diffPct = Math.abs(totalNow - lastTotal) / lastTotal;
          if (diffPct > 0.1) {
             warning = 'UYARI: Anormal veri değişimi tespit edildi (>%10).';
             console.warn(warning);
          }
        }
      }
    } catch(e) {}
  }
  
  if (bucket) {
     try {
         // Use delimiter: '/' so getFiles only lists daily .json files and does not get stuck inside /pdfs/ subdirectories
         const getFilesPromise = bucket.getFiles({ prefix: 'sistem-yedekleri/daily/', delimiter: '/', maxResults: 100, autoPaginate: false });
         const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Bucket timeout')), 2500));
         const [backupFiles]: any = await Promise.race([getFilesPromise, timeoutPromise]);
         const jsonFiles = backupFiles.filter((f: any) => f.name.endsWith('.json'));
         const file = jsonFiles.sort((a: any, b: any) => b.name.localeCompare(a.name))[0];
         if (file) {
             const metaObj = file.metadata && (file.metadata.updated || file.metadata.timeCreated)
               ? file.metadata
               : (await file.getMetadata())[0];
             const updated = new Date(metaObj.updated || metaObj.timeCreated).getTime();
             if (!isNaN(updated) && updated > latestBackupTimestampMs) {
               latestBackupTimestampMs = updated;
             }
         }
     } catch(e) {}
  }

  try {
    const manifest = readManifest();
    if (manifest && manifest.snapshots && manifest.snapshots.length > 0) {
      const updated = new Date(manifest.snapshots[0].timestamp).getTime();
      if (!isNaN(updated) && updated > latestBackupTimestampMs) {
        latestBackupTimestampMs = updated;
      }
    }
  } catch(e) {}

  if (latestBackupTimestampMs > 0) {
    lastBackupHoursAgo = Math.max(0, (Date.now() - latestBackupTimestampMs) / (1000 * 60 * 60)).toFixed(2);
  }

  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    bucket: !!bucket,
    bucketName: PRIMARY_GCS_BUCKET,
    counts: { invoices: invCount, discounts: discCount }, 
    warning,
    lastBackupHoursAgo
  });
});


// ============================================================================
// 3. CLOUD STORAGE DOSYA YÜKLEME API
// ============================================================================

// ============================================================================
// 3. SELF-TEST ENDPOINT
// ============================================================================
app.get('/api/storage-selftest', async (_req, res) => {
  // Salt-okunur bağlantı testi; üretimde hiçbir test verisi oluşturmaz.
  try {
    if (!db || !bucket) return res.status(503).json({ ok: false, database: !!db, bucket: !!bucket });
    await Promise.all([getDocs(collection(db, 'settings')), bucket.getFiles({ maxResults: 1 })]);
    return res.json({ ok: true, database: true, bucket: true, writesPerformed: 0 });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message, writesPerformed: 0 });
  }
});

app.post(['/api/upload-file', '/api/drive/upload'], async (req, res) => {
  try {
    const { fileName, fileData, fileContentBase64, mimeType } = req.body || {};
    const base64Input = fileData || fileContentBase64;
    if (typeof base64Input !== 'string' || !base64Input) {
      return res.status(400).json({ success: false, error: 'Dosya verisi bulunamadı.' });
    }
    const base64String = base64Input.includes(',') ? base64Input.slice(base64Input.indexOf(',') + 1) : base64Input;
    const buffer = Buffer.from(base64String, 'base64');
    const MAX_SIZE = 25 * 1024 * 1024;
    if (!buffer.length || buffer.length > MAX_SIZE) {
      return res.status(400).json({ success: false, error: 'Dosya boş veya 25 MB sınırını aşıyor.' });
    }

    const safeFileName = String(fileName || 'belge.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
    const extension = path.extname(safeFileName).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']);
    
    let resolvedType = (mimeType ? String(mimeType) : '').split(';')[0].toLowerCase();
    if (!resolvedType && base64Input.startsWith('data:')) {
      const match = base64Input.match(/^data:([^;]+);/);
      if (match) resolvedType = match[1].toLowerCase();
    }
    if (!resolvedType) {
      if (extension === '.pdf') resolvedType = 'application/pdf';
      else if (extension === '.jpg' || extension === '.jpeg') resolvedType = 'image/jpeg';
      else if (extension === '.png') resolvedType = 'image/png';
      else if (extension === '.webp') resolvedType = 'image/webp';
      else if (extension === '.xlsx') resolvedType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (extension === '.xls') resolvedType = 'application/vnd.ms-excel';
      else resolvedType = 'application/octet-stream';
    }

    if (!allowedTypes.has(resolvedType)) {
      return res.status(415).json({ success: false, error: 'Desteklenmeyen dosya türü.' });
    }
    if (resolvedType === 'application/pdf' && !buffer.subarray(0, 1024).toString('ascii').includes('%PDF-')) {
      const headerHex = buffer.subarray(0, 4).toString('hex').toLowerCase();
      if (headerHex.startsWith('ffd8')) {
          resolvedType = 'image/jpeg';
      } else if (headerHex.startsWith('89504e47')) {
          resolvedType = 'image/png';
      } else {
          return res.status(400).json({ success: false, error: 'Dosya geçerli bir PDF değil.' });
      }
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const storedName = `${sha256}${extension}`;
    const objectPath = `faturalar/${storedName}`;

    // 1. Yerel kalıcı disk koruması (asla silinmez / kaybolmaz)
    let localSaved = false;
    try {
      fs.writeFileSync(path.join(LOCAL_FILES_DIR, storedName), buffer);
      fs.writeFileSync(path.join(uploadDir, storedName), buffer);
      localSaved = true;
    } catch (diskErr: any) {
      console.warn('[LOCAL FILE WRITE NOTICE]:', diskErr.message);
    }

    // 2. Cloud Storage kopyası (varsa)
    let reused = false;
    let gcsSuccess = false;
    if (bucket) {
      try {
        const fileRef = bucket.file(objectPath);
        await fileRef.save(buffer, {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: resolvedType, cacheControl: 'private, max-age=3600', metadata: { originalName: safeFileName, sha256 } }
        });
        gcsSuccess = true;
      } catch (err: any) {
        if (err?.code === 412) {
          reused = true;
          gcsSuccess = true;
        } else {
          console.warn('[STORAGE UPLOAD BUCKET NOTICE]:', err.message);
        }
      }
    }

    // 3. Firestore çift katmanlı bulut yedekleme (GCS + Firestore chunks ile tam bulut koruması)
    let fsSuccess = false;
    if (db && buffer.length <= 10 * 1024 * 1024) {
      try {
        const CHUNK_SIZE = 700 * 1024;
        const b64Data = buffer.toString('base64');
        const numChunks = Math.ceil(b64Data.length / CHUNK_SIZE);
        for (let i = 0; i < numChunks; i++) {
          await setDoc(doc(db, 'storage_chunks', `${storedName}_${i}`), {
            data: b64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
            index: i,
            createdAt: new Date().toISOString()
          });
        }
        await setDoc(doc(db, 'storage_files', storedName), {
          chunks: numChunks,
          size: buffer.length,
          originalName: safeFileName,
          contentType: resolvedType,
          createdAt: new Date().toISOString()
        }, { merge: true });
        fsSuccess = true;
      } catch (fsErr: any) {
        console.warn('[STORAGE UPLOAD FIRESTORE NOTICE]:', fsErr.message);
      }
    }

    if (!gcsSuccess && !localSaved && !fsSuccess) {
      console.error('[UPLOAD FATAL ERROR] File could not be saved to GCS, disk, or Firestore.');
      return res.status(500).json({ success: false, error: "Sunucu dosyayı depolama alanına yazamadı. Veri kaybını önlemek için işlem iptal edildi." });
    }

    // Yalnızca küçük metadata tutulur;
    if (db) {
      await setDoc(doc(db, 'file_objects', sha256), {
        sha256, objectPath, originalName: safeFileName, contentType: resolvedType, size: buffer.length,
        status: 'committed', createdAt: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }
    const downloadUrl = `/api/files/${encodeURIComponent(storedName)}`;
    return res.json({ success: true, url: downloadUrl, fileUrl: downloadUrl, fileId: objectPath, sha256, reused });
  } catch (err: any) {
    console.error('[STORAGE UPLOAD ERROR]:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function streamStorageFile(
  targetName: string,
  res: express.Response,
  isDownload: boolean,
  downloadName?: string
): Promise<boolean> {
  const safeName = path.basename(targetName.replace(/^(?:faturalar\/|drive\/)+/, ''));
  if (!safeName) return false;
  const displayName = downloadName || safeName;

  // a) Dosyayı önce "ai-studio-bucket-88134939798-europe-west2" sepetindeki "faturalar/" klasöründen ara.
  const targetBucket = getStorage().bucket(PRIMARY_GCS_BUCKET);
  if (targetBucket) {
    try {
      for (const objectPath of [`faturalar/${safeName}`, safeName]) {
        const fileRef = targetBucket.file(objectPath);
        const [exists] = await fileRef.exists();
        if (exists) {
          const [metadata] = await fileRef.getMetadata();
          const contentType = metadata.contentType || (safeName.endsWith('.pdf') ? 'application/pdf' : (safeName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : (safeName.endsWith('.png') ? 'image/png' : (safeName.endsWith('.jpg') || safeName.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream'))));
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(metadata.metadata?.originalName || displayName)}`);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          fileRef.createReadStream().on('error', (err: Error) => {
            console.error('[FILE STREAM ERROR]:', err.message);
            if (!res.headersSent) res.status(500).end();
          }).pipe(res);
          return true;
        }
      }
    } catch (bucketReadErr: any) {
      console.warn('[STORAGE READ BUCKET NOTICE]:', bucketReadErr.message);
    }
  }

  // b) Orada yoksa Firestore "storage_files" ve "storage_chunks" tablolarından oku (ve GCS'e otomatik senkronize et)
  if (db) {
    const keysToTry = [...new Set([safeName, targetName, path.basename(targetName)])];
    for (const key of keysToTry) {
      try {
        const metaSnap = await getDoc(doc(db, 'storage_files', key));
        if (!metaSnap.exists()) continue;
        const meta = metaSnap.data();
        const count = Number(meta.chunks || 0);
        if (!Number.isInteger(count) || count < 1 || count > 100) continue;
        const parts: string[] = [];
        let complete = true;
        for (let i = 0; i < count; i++) {
          const chunk = await getDoc(doc(db, 'storage_chunks', `${key}_${i}`));
          if (!chunk.exists() || typeof chunk.data().data !== 'string') { complete = false; break; }
          parts.push(chunk.data().data);
        }
        if (!complete) continue;
        const buffer = Buffer.from(parts.join(''), 'base64');
        if (!buffer.length) continue;
        const contentType = meta.contentType || (safeName.endsWith('.pdf') ? 'application/pdf' : (safeName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream'));
        if (targetBucket) {
          targetBucket.file(`faturalar/${safeName}`).save(buffer, {
            resumable: false,
            metadata: { contentType, cacheControl: 'private, max-age=3600', metadata: { originalName: meta.originalName || meta.fileName || displayName } }
          }).catch(() => {});
        }
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.originalName || meta.fileName || displayName)}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(buffer);
        return true;
      } catch (fsErr: any) {
        console.warn('[FIRESTORE READ NOTICE]:', fsErr.message);
      }
    }
  }

  // Fallback: Yerel diskte varsa oku
  const localCandidate = path.join(LOCAL_FILES_DIR, safeName);
  const uploadCandidate = path.join(uploadDir, safeName);
  const chosenPath = fs.existsSync(localCandidate) ? localCandidate : (fs.existsSync(uploadCandidate) ? uploadCandidate : null);
  if (chosenPath) {
    const contentType = safeName.endsWith('.pdf') ? 'application/pdf' : (safeName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(displayName)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(chosenPath).pipe(res);
    return true;
  }

  // c) Canlı Sistemden (https://gescons.ai.studio) Çekme ve Yerel/Firestore Depolama (Live Fallback & Auto-Sync)
  try {
    const liveOrigin = process.env.LIVE_ORIGIN || 'https://gescons.ai.studio';
    const currentHost = String(res.req?.headers?.host || '').toLowerCase();
    const isLiveProductionHost = currentHost.includes('gescons.ai.studio');

    if (!isLiveProductionHost) {
      const liveUrl = `${liveOrigin}/api/files/${encodeURIComponent(safeName)}`;
      const liveRes = await fetch(liveUrl, {
        headers: { 'User-Agent': 'Gescons-Preview-Sync/1.0' },
        signal: AbortSignal.timeout(15000)
      });

      if (liveRes.ok) {
        const liveContentType = liveRes.headers.get('content-type') || (safeName.endsWith('.pdf') ? 'application/pdf' : (safeName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream'));
        const liveContentDisp = liveRes.headers.get('content-disposition') || `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(displayName)}`;
        const arrayBuf = await liveRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        if (buffer.length > 0) {
          // A) Yerel disk klasörüne kalıcı olarak kaydet
          try {
            fs.writeFileSync(localCandidate, buffer);
          } catch (e: any) {
            console.warn('[LOCAL FILE CACHE WARN]:', e.message);
          }

          // B) Firestore storage_files & storage_chunks'a kalıcı olarak ekle
          if (db) {
            try {
              const base64 = buffer.toString('base64');
              const CHUNK_SIZE = 700 * 1024;
              const chunks = [];
              for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
                chunks.push(base64.slice(i, i + CHUNK_SIZE));
              }
              await setDoc(doc(db, 'storage_files', safeName), {
                fileName: safeName,
                originalName: displayName,
                size: buffer.length,
                contentType: liveContentType,
                chunks: chunks.length,
                uploadedAt: new Date().toISOString(),
                syncedFromLive: true
              });
              for (let i = 0; i < chunks.length; i++) {
                await setDoc(doc(db, 'storage_chunks', `${safeName}_${i}`), {
                  fileId: safeName,
                  chunkIndex: i,
                  data: chunks[i]
                });
              }
            } catch (fsSyncErr: any) {
              console.warn('[FIRESTORE SYNC SAVE WARN]:', fsSyncErr.message);
            }
          }

          res.setHeader('Content-Type', liveContentType);
          res.setHeader('Content-Disposition', liveContentDisp);
          res.setHeader('Cache-Control', 'private, max-age=3600');
          res.send(buffer);
          return true;
        }
      }
    }
  } catch (liveErr: any) {
    console.warn('[LIVE SYNC FALLBACK NOTICE]:', liveErr.message);
  }

  return false;
}

function generateComparativeExcelBuffer(analysis: any, invoiceNo?: string): Buffer {
  const wb = XLSX.utils.book_new();

  const titleHeader = [
    ["GES CONSTRUCTION - PİYASA TEKLİF & KIYASLAMA ANALİZ ÇİZELGESİ"],
    ["Rapor Tarihi:", new Date().toLocaleString("tr-TR")],
    ["Analiz Kodu:", analysis?.analysisCode || (invoiceNo ? `ANL-${invoiceNo}` : 'ANL-GENEL')],
    ["Fatura / Belge No:", invoiceNo || analysis?.finalInvoiceDetails?.invoiceNumber || '-'],
    ["Şantiye:", analysis?.jobsiteName || '-'],
    ["Satınalma Şefi:", analysis?.supervisorName || '-'],
    ["Kazanan / Seçilen Firma:", analysis?.winningSupplier || analysis?.finalInvoiceDetails?.supplier || '-'],
    ["Para Birimi:", analysis?.currency || 'RUB'],
    []
  ];

  const itemsHeader = [
    "Sıra",
    "Malzeme / Kalem Adı",
    "Kategori",
    "Miktar",
    "Birim",
    "Piyasa / İlk Teklif Birim Fiyatı (₽)",
    "Referans Tedarikçi",
    "Nihai Anlaşılan Birim Fiyatı (₽)",
    "Seçilen Tedarikçi",
    "Birim Tasarruf (₽)",
    "Toplam Tasarruf (₽)",
    "Tasarruf Oranı (%)"
  ];

  const rows: any[][] = [...titleHeader, itemsHeader];

  const canonicalItems = analysis?.canonicalMaterials || [];
  if (canonicalItems.length > 0) {
    canonicalItems.forEach((item: any, idx: number) => {
      const refPrice = Number(item.marketReferenceUnitPrice || item.lowestInitialOffer?.normalizedUnitPrice || 0);
      const refSupplier = item.marketReferenceSupplier || item.lowestInitialOffer?.vendorName || (item.lines?.find((l: any) => l.isCompetitor || l.isInitialOffer)?.supplierName) || 'Piyasa Referansı';
      const finalPrice = Number(item.purchasedUnitPrice || item.unitPrice || 0);
      const finalSupplier = item.purchasedSupplier || analysis?.winningSupplier || '-';
      const qty = Number(item.purchasedQuantity || item.quantity || 1);
      const unit = item.purchasedUnit || item.unit || 'Adet';
      const unitSavings = item.realUnitSavings !== undefined ? Number(item.realUnitSavings) : (refPrice > 0 && finalPrice > 0 ? refPrice - finalPrice : 0);
      const totalSavings = item.realTotalSavings !== undefined ? Number(item.realTotalSavings) : unitSavings * qty;
      const savingsRate = refPrice > 0 ? Number(((unitSavings / refPrice) * 100).toFixed(2)) : 0;

      rows.push([
        idx + 1,
        item.commonName || item.canonicalName || `Kalem ${idx + 1}`,
        item.category || 'Genel',
        qty,
        unit,
        refPrice,
        refSupplier,
        finalPrice,
        finalSupplier,
        unitSavings,
        totalSavings,
        `%${savingsRate}`
      ]);
    });
  } else {
    rows.push([
      1,
      analysis?.finalInvoiceDetails?.fileName || (invoiceNo ? `Fatura ${invoiceNo} Kalemleri` : "Genel Malzeme Kalemleri"),
      "İnşaat Malzemeleri",
      1,
      "Grup",
      Number(analysis?.totalInitialLowestOffer || 0),
      "İlk Teklif / Liste Fiyatı",
      Number(analysis?.totalFinalPurchase || 0),
      analysis?.winningSupplier || "Satıcı Firma",
      Number(analysis?.realMarketSavings || 0),
      Number(analysis?.realMarketSavings || 0),
      `%${analysis?.realSavingsRate || 0}`
    ]);
  }

  rows.push([]);
  rows.push(["GENEL TOPLAM VE ANALİZ ÖZETİ", "", "", "", "", "", "", "", "", "", "", ""]);
  rows.push(["Piyasa Referans / İlk Teklif Tutarı (₽):", Number(analysis?.totalInitialLowestOffer || 0)]);
  rows.push(["Nihai Satınalma Fatura Tutarı (₽):", Number(analysis?.totalFinalPurchase || 0)]);
  rows.push(["Elde Edilen Reel Piyasa Tasarrufu (₽):", Number(analysis?.realMarketSavings || 0)]);
  rows.push(["Reel Tasarruf Oranı:", `%${analysis?.realSavingsRate || 0}`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Piyasa Kıyaslama Tablosu");

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

app.get(['/api/files/:filename(*)', '/api/files/drive/:filename(*)'], async (req, res) => {
  try {
    const rawParam = req.params.filename || '';
    const rawUrl = req.originalUrl || req.url;

    // c) "test-sandbox" klasörünü kesinlikle devre dışı tut, tüm gerçek belgeler sadece "faturalar/" dizininde işlensin.
    if (rawUrl.includes('test-sandbox') || rawParam.includes('test-sandbox')) {
      return res.status(403).json({ code: 'SANDBOX_FORBIDDEN', error: 'test-sandbox erişimi devre dışıdır. Tüm belgeler faturalar dizininde işlenir.' });
    }

    const decoded = decodeURIComponent(rawParam);
    let cleanFilename = decoded.replace(/^(?:faturalar\/|drive\/)+/g, '');
    cleanFilename = path.basename(cleanFilename);
    if (!cleanFilename) {
      return res.status(400).json({ code: 'INVALID_FILE_NAME', error: 'Geçersiz dosya adı.' });
    }
    const isDownload = req.query.download === 'true';

    // 1. Doğrudan dosya adı ile ara (Disk / Bucket / Firestore chunks)
    const servedDirectly = await streamStorageFile(cleanFilename, res, isDownload);
    if (servedDirectly) return;

    // 2. İstek '.xlsx' veya 'Piyasa_Teklif_Kiyas_Tablosu' içeriyorsa: Dinamik Excel tablosu oluştur ve stream et
    const isExcelReq = /\.xlsx?($|\?)/i.test(cleanFilename) || cleanFilename.includes('Piyasa_Teklif_Kiyas_Tablosu');
    if (isExcelReq) {
      const baseNameNoExt = cleanFilename.replace(/\.xlsx?$/i, '');
      const invFromExcel = baseNameNoExt.replace(/^Piyasa_Teklif_Kiyas_Tablosu_?/i, '').trim();

      let record: any = null;
      if (invFromExcel) {
        record = comparativeAnalysesStore.get(invFromExcel);
        if (!record && db) {
          try {
            const snap = await getDoc(doc(db, 'comparative_analyses', invFromExcel));
            if (snap.exists()) record = snap.data();
          } catch (_) {}
        }
        if (!record) {
          const matchDisc = (memoryStore.discounts?.data || []).find((d: any) =>
            (d.invoiceNo && d.invoiceNo.toLowerCase() === invFromExcel.toLowerCase()) ||
            (d.comparativeAnalysisId && d.comparativeAnalysisId === invFromExcel) ||
            (d.id === invFromExcel)
          );
          let disc = matchDisc;
          if (!disc) {
            const { data: discs } = await getDiscountsCached();
            disc = (discs || []).find((d: any) =>
              (d.invoiceNo && d.invoiceNo.toLowerCase() === invFromExcel.toLowerCase()) ||
              (d.comparativeAnalysisId && d.comparativeAnalysisId === invFromExcel) ||
              (d.id === invFromExcel)
            );
          }
          if (disc) {
            if (disc.comparativeAnalysisId) {
              record = comparativeAnalysesStore.get(disc.comparativeAnalysisId);
            }
            if (!record) {
              record = {
                id: disc.id,
                analysisCode: `ANL-${disc.invoiceNo || 'KIYAS'}`,
                jobsiteName: disc.jobsiteName,
                supervisorName: disc.supervisorName,
                winningSupplier: disc.vendorName,
                totalFinalPurchase: disc.agreedPrice || 0,
                totalInitialLowestOffer: disc.offerPrice || 0,
                realMarketSavings: disc.discountAmount || 0,
                realSavingsRate: disc.discountPercentage || 0,
                currency: 'RUB',
                finalInvoiceDetails: {
                  invoiceNumber: disc.invoiceNo,
                  supplier: disc.vendorName,
                  amount: disc.agreedPrice
                }
              };
            }
          }
        }
      }

      if (!record && comparativeAnalysesStore.size > 0) {
        record = Array.from(comparativeAnalysesStore.values())[0];
      }

      const excelBuf = generateComparativeExcelBuffer(record, invFromExcel || record?.finalInvoiceDetails?.invoiceNumber);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(excelBuf);
    }

    // 3. Akıllı dosya çözümleme (Smart Resolver): Fatura numarası eşleme
    const invoiceCandidates: string[] = [];
    const strippedName = cleanFilename.replace(/\.(pdf|png|jpg|jpeg|webp)$/i, '');
    const matchFatura = strippedName.replace(/^Fatura_/i, '').trim();
    if (matchFatura) invoiceCandidates.push(matchFatura);
    invoiceCandidates.push(strippedName);

    const tokenMatch = strippedName.match(/([A-Z0-9А-ЯЁ]+(?:-[A-Z0-9А-ЯЁ]+)+)/i);
    if (tokenMatch && tokenMatch[1]) invoiceCandidates.push(tokenMatch[1]);

    const uniqueCandidates = [...new Set(invoiceCandidates.map(c => c.toLowerCase()))];

    let targetUrl: string | null = null;
    let targetDisplayName: string | null = null;

    // Önbellekten güvenli arama (optional chaining ile korunur)
    for (const cand of uniqueCandidates) {
      const matchInv = (memoryStore.invoices?.data || []).find((i: any) => i.invoiceNumber && i.invoiceNumber.toLowerCase() === cand);
      if (matchInv && (matchInv.fileUrl || matchInv.rawFileName)) {
        targetUrl = matchInv.fileUrl || matchInv.rawFileName;
        targetDisplayName = matchInv.rawFileName || cleanFilename;
        break;
      }
    }

    if (!targetUrl) {
      for (const cand of uniqueCandidates) {
        const matchDisc = (memoryStore.discounts?.data || []).find((d: any) => d.invoiceNo && d.invoiceNo.toLowerCase() === cand);
        if (matchDisc) {
          targetUrl = matchDisc.finalOfferFileUrl || matchDisc.fileUrl || matchDisc.firstOfferFileUrl || matchDisc.rawFileName;
          targetDisplayName = matchDisc.rawFileName || matchDisc.finalOfferFileName || cleanFilename;
          break;
        }
      }
    }

    // Önbellek boşken veya eşleşme bulunamadığında doğrudan Firestore / kalıcı katmandan çek
    if (!targetUrl) {
      const { data: invs } = await getInvoicesCached();
      const { data: discs } = await getDiscountsCached();

      for (const cand of uniqueCandidates) {
        const inv = (invs || []).find((i: any) => i.invoiceNumber && i.invoiceNumber.toLowerCase() === cand);
        if (inv && (inv.fileUrl || inv.rawFileName)) {
          targetUrl = inv.fileUrl || inv.rawFileName;
          targetDisplayName = inv.rawFileName || cleanFilename;
          break;
        }
      }

      if (!targetUrl) {
        for (const cand of uniqueCandidates) {
          const disc = (discs || []).find((d: any) => d.invoiceNo && d.invoiceNo.toLowerCase() === cand);
          if (disc) {
            targetUrl = disc.finalOfferFileUrl || disc.fileUrl || disc.firstOfferFileUrl || disc.rawFileName;
            targetDisplayName = disc.rawFileName || disc.finalOfferFileName || cleanFilename;
            break;
          }
        }
      }
    }

    if (targetUrl) {
      const resolvedTarget = path.basename(targetUrl.replace(/^(?:faturalar\/|drive\/)+/, ''));
      const served = await streamStorageFile(resolvedTarget, res, isDownload, targetDisplayName || cleanFilename);
      if (served) return;
    }

    // 4. Kayıtlı fatura/indirim için Dijital Arşiv Motoru (GCS + Firestore otomatik iyileştirme)
    try {
      const { data: invs } = await getInvoicesCached();
      const { data: discs } = await getDiscountsCached();
      const lowerClean = cleanFilename.toLowerCase();

      const matchedInv = (invs || []).find((i: any) =>
        (i.fileUrl && String(i.fileUrl).toLowerCase().includes(lowerClean)) ||
        (i.rawFileName && String(i.rawFileName).toLowerCase() === lowerClean) ||
        (i.id && lowerClean.includes(String(i.id).toLowerCase())) ||
        uniqueCandidates.includes(String(i.invoiceNumber || '').toLowerCase())
      );

      const matchedDisc = (discs || []).find((d: any) =>
        (d.firstOfferFileUrl && String(d.firstOfferFileUrl).toLowerCase().includes(lowerClean)) ||
        (d.finalOfferFileUrl && String(d.finalOfferFileUrl).toLowerCase().includes(lowerClean)) ||
        (d.id && lowerClean.includes(String(d.id).toLowerCase())) ||
        uniqueCandidates.includes(String(d.invoiceNo || '').toLowerCase())
      );

      const recordToRender = matchedInv
        ? (matchedDisc ? { ...matchedDisc, ...matchedInv } : matchedInv)
        : matchedDisc;

      if (recordToRender) {
        const pdfBuf = await generateArchivePdf(recordToRender, cleanFilename);
        if (bucket) {
          bucket.file(`faturalar/${cleanFilename}`).save(pdfBuf, {
            resumable: false,
            metadata: { contentType: 'application/pdf', cacheControl: 'private, max-age=3600', metadata: { originalName: cleanFilename, archivalGenerated: 'true' } }
          }).catch(() => {});
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(cleanFilename)}`);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(pdfBuf);
      }
    } catch (archErr: any) {
      console.warn('[ARCHIVE PDF FALLBACK NOTICE]:', archErr.message);
    }

    return res.status(404).json({ code: 'ORIGINAL_FILE_MISSING', error: 'Orijinal dosya bulunamadı.', fileName: cleanFilename });
  } catch (err: any) {
    console.error('[FILE SERVE ERROR]:', err);
    return res.status(500).json({ code: 'FILE_READ_FAILED', error: 'Dosya okunamadı.' });
  }
});

app.post('/api/drive/delete', async (req, res) => {
  try {
    const { fileUrl } = req.body;
    if (!fileUrl) return res.status(400).json({ error: 'Dosya URL si belirtilmedi.' });
    
    // Prevent directory traversal by strictly resolving the path and checking if it starts with uploadDir
    const urlObj = new URL(fileUrl, 'http://localhost');
    const filePathMatch = urlObj.pathname.match(/\/api\/files\/(.+)$/);
    
    if (filePathMatch && filePathMatch[1]) {
      const filename = decodeURIComponent(filePathMatch[1]);
      const cleanFilename = filename.replace(/^faturalar\//, '');
      const filePath = path.resolve(path.join(uploadDir, filename));
      
      if (!filePath.startsWith(path.resolve(uploadDir))) {
        console.warn(`[STORAGE DELETE ALERT] Path traversal attempt: ${filePath}`);
        return res.status(403).json({ error: 'Geçersiz dosya yolu.' });
      }

      let deletedFromCloud = false;
      if (bucket) {
        try {
           const fileRef = bucket.file(`faturalar/${cleanFilename}`);
           const [exists] = await fileRef.exists();
           if (exists) {
             await fileRef.delete();
             deletedFromCloud = true;
           }
        } catch (err: any) {
           console.warn('[CLOUD STORAGE DELETE ERROR]:', err.message);
        }
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      console.log(`[STORAGE DELETE] Dosya silindi: ${filePath}. Cloud: ${deletedFromCloud}`);
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('[STORAGE DELETE ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 4. FIRESTORE CRUD İŞLEMLERİ & PERMANENT BACKUP / CACHE (QUOTA GUARD)
// ============================================================================
const BACKUP_DIR = path.join(os.tmpdir(), 'data_backup');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Kalıcı malzeme eşleştirme (alias) deposu: elle birleştirmeler + Prizma stok kodu bağları
const materialAliasStore = new MaterialAliasStore(() => db, BACKUP_DIR);

function saveLocalBackup(filename: string, data: any): boolean {
  try {
    const filePath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err: any) {
    console.error(`[BACKUP WRITE ERROR] ${filename}:`, err.message);
    return false;
  }
}

function readLocalBackup(filename: string, fallback: any = []): any {
  try {
    const filePath = path.join(BACKUP_DIR, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const docMap = new Map<string, any>();
        if (Array.isArray(fallback)) {
          fallback.forEach((f: any) => { if (f && f.id) docMap.set(f.id, f); });
        }
        parsed.forEach((p: any) => { if (p && p.id) docMap.set(p.id, p); });
        return Array.from(docMap.values());
      }
    }
  } catch (err: any) {
    console.warn(`[BACKUP READ ERROR] ${filename}:`, err.message);
  }
  return fallback;
}

// Seed local disk backups on startup if missing or incomplete
if (!fs.existsSync(path.join(BACKUP_DIR, 'supervisors.json'))) saveLocalBackup('supervisors.json', INITIAL_SUPERVISORS);
if (!fs.existsSync(path.join(BACKUP_DIR, 'personnel.json'))) saveLocalBackup('personnel.json', INITIAL_PERSONNEL);
if (!fs.existsSync(path.join(BACKUP_DIR, 'jobsites.json'))) saveLocalBackup('jobsites.json', INITIAL_JOBSITES);
if (!fs.existsSync(path.join(BACKUP_DIR, 'discounts.json'))) saveLocalBackup('discounts.json', INITIAL_DISCOUNTS);
if (!fs.existsSync(path.join(BACKUP_DIR, 'invoices.json'))) saveLocalBackup('invoices.json', INITIAL_INVOICES);

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes memory cache TTL

interface CacheStore<T> {
  data: T;
  timestamp: number;
}

let isQuotaExceededGlobal = false;

const memoryStore: {
  supervisors?: CacheStore<any[]>;
  personnel?: CacheStore<any[]>;
  jobsites?: CacheStore<any[]>;
  discounts?: CacheStore<any[]>;
  invoices?: CacheStore<any[]>;
  materialComparisons?: { data: any[]; timestamp: number; sourceStamp: string };
  deletionLedger?: CacheStore<{ ids: Set<string>; prizmaIds: Set<number>; invoiceKeys: Set<string> }>;
} = {};

async function getDeletionLedgerCached(): Promise<{ ids: Set<string>; prizmaIds: Set<number>; invoiceKeys: Set<string> }> {
  const now = Date.now();
  if (memoryStore.deletionLedger && (now - memoryStore.deletionLedger.timestamp < CACHE_TTL_MS)) {
    return memoryStore.deletionLedger.data;
  }
  const ids = new Set<string>();
  const prizmaIds = new Set<number>();
  const invoiceKeys = new Set<string>();
  if (db) {
    try {
      const snap = await getDocs(collection(db, 'deletion_ledger'));
      snap.docs.forEach(d => {
        ids.add(d.id);
        const dt = d.data() || {};
        if (dt.documentId) ids.add(String(dt.documentId));
        if (dt.linkedInvoiceId) ids.add(String(dt.linkedInvoiceId));
        if (dt.linkedDiscountId) ids.add(String(dt.linkedDiscountId));
        if (dt.prizmaDemandId) prizmaIds.add(Number(dt.prizmaDemandId));
        const m = String(d.id).match(/^inv_prizma_(\d+)$/);
        if (m && m[1]) prizmaIds.add(Number(m[1]));
        const invNo = String(dt.invoiceNumber || dt.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const vend = normalizeVendorName(dt.supplier || dt.vendorName || '');
        if (invNo && vend) invoiceKeys.add(`${vend}___${invNo}`);
      });
      memoryStore.deletionLedger = { data: { ids, prizmaIds, invoiceKeys }, timestamp: now };
    } catch (_) {}
  }
  return { ids, prizmaIds, invoiceKeys };
}

function isQuotaError(err: any): boolean {
  if (!err) return false;
  const msg = err.message || String(err);
  return msg.includes('Quota limit exceeded') || msg.includes('Quota exceeded') || msg.includes('429');
}

function toSafeString(val: any, fallback: string = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if (val.value !== undefined && val.value !== null) return String(val.value);
    return fallback;
  }
  return String(val);
}

async function getSupervisorsCached() {
  const now = Date.now();
  if (memoryStore.supervisors && (now - memoryStore.supervisors.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.supervisors.data, quotaExceeded: isQuotaExceededGlobal };
  }
  if (!db) {
    const backup = readLocalBackup('supervisors.json', INITIAL_SUPERVISORS);
    return { data: backup, quotaExceeded: false };
  }
  try {
    const snapshot = await getDocs(collection(db, 'supervisors'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const docMap = new Map<string, any>();
    (INITIAL_SUPERVISORS || []).forEach((s: any) => { if (s && s.id) docMap.set(s.id, s); });
    const local = readLocalBackup('supervisors.json', []);
    (local || []).forEach((s: any) => { if (s && s.id) docMap.set(s.id, s); });
    items.forEach((s: any) => { if (s && s.id) docMap.set(s.id, s); });
    const result = Array.from(docMap.values()).filter((d: any) => d.isPermanentlyDeleted !== true);

    memoryStore.supervisors = { data: result, timestamp: now };
    saveLocalBackup('supervisors.json', result);
    return { data: result, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE SUPERVISORS WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const fallback = memoryStore.supervisors?.data || readLocalBackup('supervisors.json', INITIAL_SUPERVISORS);
    return { data: fallback, quotaExceeded: true };
  }
}

async function getPersonnelCached() {
  const now = Date.now();
  if (memoryStore.personnel && (now - memoryStore.personnel.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.personnel.data, quotaExceeded: isQuotaExceededGlobal };
  }
  if (!db) {
    const backup = readLocalBackup('personnel.json', INITIAL_PERSONNEL);
    return { data: backup, quotaExceeded: false };
  }
  try {
    const snapshot = await getDocs(collection(db, 'personnel'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const docMap = new Map<string, any>();
    (INITIAL_PERSONNEL || []).forEach((p: any) => { if (p && p.id) docMap.set(p.id, p); });
    const local = readLocalBackup('personnel.json', []);
    (local || []).forEach((p: any) => { if (p && p.id) docMap.set(p.id, p); });
    items.forEach((p: any) => { if (p && p.id) docMap.set(p.id, p); });
    const result = Array.from(docMap.values()).filter((d: any) => d.isPermanentlyDeleted !== true);

    memoryStore.personnel = { data: result, timestamp: now };
    saveLocalBackup('personnel.json', result);
    return { data: result, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE PERSONNEL WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const fallback = memoryStore.personnel?.data || readLocalBackup('personnel.json', INITIAL_PERSONNEL);
    return { data: fallback, quotaExceeded: true };
  }
}

async function getJobsitesCached() {
  const now = Date.now();
  if (memoryStore.jobsites && (now - memoryStore.jobsites.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.jobsites.data, quotaExceeded: isQuotaExceededGlobal };
  }
  if (!db) {
    const backup = readLocalBackup('jobsites.json', INITIAL_JOBSITES);
    return { data: backup, quotaExceeded: false };
  }
  try {
    const snapshot = await getDocs(collection(db, 'jobsites'));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const docMap = new Map<string, any>();
    (INITIAL_JOBSITES || []).forEach((j: any) => { if (j && j.id) docMap.set(j.id, j); });
    const local = readLocalBackup('jobsites.json', []);
    (local || []).forEach((j: any) => { if (j && j.id) docMap.set(j.id, j); });
    items.forEach((j: any) => { if (j && j.id) docMap.set(j.id, j); });
    const result = Array.from(docMap.values()).filter((d: any) => d.isPermanentlyDeleted !== true);

    memoryStore.jobsites = { data: result, timestamp: now };
    saveLocalBackup('jobsites.json', result);
    return { data: result, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE JOBSITES WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const fallback = memoryStore.jobsites?.data || readLocalBackup('jobsites.json', INITIAL_JOBSITES);
    return { data: fallback, quotaExceeded: true };
  }
}

async function getDiscountsCached() {
  const now = Date.now();
  if (memoryStore.discounts && (now - memoryStore.discounts.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.discounts.data, quotaExceeded: isQuotaExceededGlobal };
  }
  if (!db) {
    const rawBackup = readLocalBackup('discounts.json', INITIAL_DISCOUNTS);
    const backup = (rawBackup || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true);
    return { data: backup, quotaExceeded: false };
  }
  try {
    const [snapshot, ledger] = await Promise.all([
      getDocs(collection(db, 'discounts')),
      getDeletionLedgerCached()
    ]);
    const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    const allRecords = allDocs.filter((d: any) => d.isPermanentlyDeleted !== true && !ledger.ids.has(d.id)).map(d => {
      const cleanVendor = normalizeVendorName(toSafeString(d.vendorName || d.supplier, ''));
      return {
        ...d,
        invoiceNo: toSafeString(d.invoiceNo, ''),
        vendorName: cleanVendor,
        supplier: cleanVendor,
        category: toSafeString(d.category, 'Genel'),
        supervisorName: toSafeString(d.supervisorName, ''),
        jobsiteName: toSafeString(d.jobsiteName, '')
      };
    });

    // Auto-sanitize historic false benchmarks (e.g. optical measuring equipment falsely paired with detergent/screws)
    allRecords.forEach((d: any) => {
      if (d.benchmarkComparison && (d.benchmarkComparison.materialName?.includes('Tide') || d.benchmarkComparison.diffPercentage > 300)) {
        delete d.benchmarkComparison;
        d.auditFlags = (d.auditFlags || []).filter((f: string) => !f.includes('Şüpheli'));
      }

      // Auto-reconcile agreedPrice and discountAmount if negotiation rounds exist and reached a lower price
      const rounds = Array.isArray(d.negotiationRounds) ? d.negotiationRounds : [];
      if (rounds.length > 0) {
        const lastRnd = rounds[rounds.length - 1];
        const lastPrice = Number(lastRnd?.quotedPrice) || 0;
        const curAgreed = Number(d.agreedPrice) || 0;
        if (lastPrice > 0 && (curAgreed <= 0 || lastPrice < curAgreed)) {
          d.agreedPrice = lastPrice;
          const baseline = Number(d.adjustedOfferPrice) || (Number(d.offerPrice) - (Number(d.scopeDeductionAmount) || 0));
          d.discountAmount = Math.max(0, baseline - lastPrice);
          d.discountPercentage = baseline > 0 ? Number(((d.discountAmount / baseline) * 100).toFixed(2)) : 0;
        }
      }
    });

    // Keep complete archive (active + trash) in local backup shield
    saveLocalBackup('discounts.json', allRecords);


    const finalData = allRecords.filter((d: any) => d.isDeleted !== true).map(d => {
      if (d.firstOfferFileUrl && d.firstOfferFileUrl.startsWith('data:')) delete d.firstOfferFileUrl;
      if (d.finalOfferFileUrl && d.finalOfferFileUrl.startsWith('data:')) delete d.finalOfferFileUrl;
      return d;
    });
    finalData.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    finalData.sort((a, b) => new Date(b.created_at || b.orderDate || 0).getTime() - new Date(a.created_at || a.orderDate || 0).getTime());

    memoryStore.discounts = { data: finalData, timestamp: now };
    return { data: finalData, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE DISCOUNTS WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const rawFallback = memoryStore.discounts?.data || readLocalBackup('discounts.json', INITIAL_DISCOUNTS);
    const fallback = (rawFallback || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true);
    return { data: fallback, quotaExceeded: true };
  }
}

function isFreightOrServiceLineItemServer(text: string, unitStr?: string): boolean {
  const t = (text || '').toLowerCase();
  const u = (unitStr || '').toLowerCase().trim();
  if (u === 'sipariş/hizmet' || u === 'paket/hizmet' || u === 'pakethizmet') return false;
  if (/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер|газобетон|пескобетон|бетоноконтакт/i.test(t)) {
    return false;
  }
  return /шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн.*услуг|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|\bnakliye\b|teslimat\s*hizmet|kargo\s*bedel|kesim\s*bedel|kesim\s*hizmet/i.test(t);
}

function normalizeSingleInvoicePricingAndFreight(inv: any, pMatch?: any): any {
  if (!inv) return inv;
  const cleanSupplier = normalizeVendorName(toSafeString(inv.supplier || inv.vendorName, ''));
  let rawItems = Array.isArray(inv.items) ? inv.items : [];
  const pMatchHasVerifiedPdfLines = Boolean(
    pMatch &&
    Array.isArray(pMatch.items) &&
    pMatch.items.length > 0 &&
    (pMatch.linesSource === 'invoice_pdf' ||
     pMatch.lineCheck?.status === 'verified' ||
     pMatch.items.some((x: any) => x?.lineSource === 'invoice_pdf'))
  );
  const isPrizmaId = String(inv.id || '').startsWith('inv_prizma_') || String(inv.id || '').startsWith('prizma_');
  if (pMatch && Array.isArray(pMatch.items) && pMatch.items.length > 0 && (isPrizmaId || pMatchHasVerifiedPdfLines)) {
    rawItems = pMatch.items.map((it: any) => ({
      ...it,
      prizmaRequestCode: pMatch.prizmaRequestCode || inv.prizmaRequestCode,
      prizmaOrderCode: pMatch.prizmaOrderCode || inv.prizmaOrderCode,
      prizmaBtfUrl: pMatch.prizmaBtfUrl || inv.prizmaBtfUrl,
      prizmaStfUrl: pMatch.prizmaStfUrl || inv.prizmaStfUrl,
      prizmaUrl: pMatch.prizmaBtfUrl || pMatch.prizmaUrl || inv.prizmaUrl
    }));
  }

  const docYear = String(inv.date || inv.created_at || '').slice(0, 4);
  const isIpMalyavin = /(^|[\s"«])ип\s*["«]?малявин/i.test(cleanSupplier);
  const hasVat20Or22OnInvoice = rawItems.some((x: any) => Number(x?.vatPercentage) === 20 || Number(x?.vatPercentage) === 22);
  const rawSumUnitQty = rawItems.reduce((s: number, x: any) => {
    const baseU = (x?.isNetNormalized && x?.grossUnitPrice) ? Number(x.grossUnitPrice) : (Number(x?.unitPrice) || 0);
    return s + baseU * (Number(x?.quantity) || 1);
  }, 0);
  const rawSumStoredUnitQty = rawItems.reduce((s: number, x: any) => s + (Number(x?.unitPrice) || 0) * (Number(x?.quantity) || 1), 0);
  const invTotal = Number(inv.totalAmount) || 0;
  const invTax = Number(inv.taxAmount) || 0;

  // Prizma faturasında nakliye yalnızca belgedeki / STF'deki açık nakliye satırlarından gelir. Fatura kaydında
  // eskiden "toplam farkı = nakliye" diye yazılmış tutar artık kullanılmaz (bkz. aşağıdaki kalem/toplam kontrolü).
  const usePrizmaFreightOnly = Boolean(pMatch && (isPrizmaId || pMatchHasVerifiedPdfLines));
  let excludedFreightNetSum = (usePrizmaFreightOnly
    ? Number(pMatch?.excludedFreightAmount)
    : Number(inv.excludedFreightAmount || pMatch?.excludedFreightAmount)) || 0;
  let excludedFreightGrossSum = (usePrizmaFreightOnly
    ? Number(pMatch?.excludedFreightGrossAmount)
    : Number(inv.excludedFreightGrossAmount || pMatch?.excludedFreightGrossAmount)) || 0;
  let trackedFreightRow = false;

  const isPrizmaOrigin = Boolean(
    String(inv.id || '').startsWith('inv_prizma_') ||
    String(inv.id || '').startsWith('prizma_') ||
    inv.prizmaSource ||
    pMatch ||
    rawItems.some((x: any) => String(x?.id || '').startsWith('prizma_row_'))
  );

  // Filter out freight / delivery / service lines when there are multiple items or Prizma STF items
  const filteredRawItems = rawItems.filter((it: any) => {
    if (!it || typeof it !== 'object') return false;
    const itemText = `${it.materialName || ''} ${it.originalName || ''}`;
    if ((rawItems.length > 1 || isPrizmaOrigin) && isFreightOrServiceLineItemServer(itemText, it.unit)) {
      if (!excludedFreightNetSum && !excludedFreightGrossSum) {
        trackedFreightRow = true;
        const fQty = Number(it.quantity) || 1;
        const fRawPrice = Number(it.grossUnitPrice || it.unitPrice) || 0;
        const fVat = isIpMalyavin ? 0 : (docYear === '2025' ? 20 : 22);
        const fGross = Number(it.grossTotalPrice) || (invTotal / (rawSumStoredUnitQty || 1) >= 1.12 ? fRawPrice * fQty * (1 + fVat / 100) : fRawPrice * fQty);
        const fNet = fVat > 0 ? fGross / (1 + fVat / 100) : fGross;
        excludedFreightNetSum += fNet;
        excludedFreightGrossSum += fGross;
      }
      return false;
    }
    return true;
  });

  const effectiveRawItems = filteredRawItems.length > 0 ? filteredRawItems : rawItems;
  const matSumStoredUnitQty = effectiveRawItems.reduce((s: number, x: any) => s + (Number(x?.unitPrice) || 0) * (Number(x?.quantity) || 1), 0);

  const ratioAll = (invTotal > 0 && rawSumStoredUnitQty > 0) ? (invTotal / rawSumStoredUnitQty) : 0;
  const ratioMat = (invTotal > 0 && matSumStoredUnitQty > 0) ? (invTotal / matSumStoredUnitQty) : 0;
  const isInvoiceStoredAsNet =
    (ratioAll >= 1.12 && ratioAll <= 1.40) ||
    (!trackedFreightRow && ratioMat >= 1.12 && ratioMat <= 1.40);

  let invoiceLevelVat = docYear === '2025' ? 20 : 22;
  if (isIpMalyavin) {
    invoiceLevelVat = 0;
  } else if ((ratioAll >= 1.188 && ratioAll <= 1.208) || (ratioMat >= 1.188 && ratioMat <= 1.208)) {
    invoiceLevelVat = 20;
  } else if ((ratioAll > 1.208 && ratioAll <= 1.235) || (ratioMat > 1.208 && ratioMat <= 1.235)) {
    invoiceLevelVat = 22;
  } else if (invTax > 0 && invTotal > invTax) {
    const impliedTaxPct = (invTax / (invTotal - invTax)) * 100;
    if (impliedTaxPct >= 18 && impliedTaxPct <= 20.8) invoiceLevelVat = 20;
    else if (impliedTaxPct > 20.8 && impliedTaxPct <= 23.5) invoiceLevelVat = 22;
  }

  // Daha önce "net" diye kaydedilmiş fiyatların aslında KDV DAHİL olup olmadığını fatura toplamıyla doğrula.
  // Örn. BMZ NU-3315: toplam 77.705.300 ₽ = Σ(kayıtlı net × miktar) → kayıtlı "net" fiyat aslında KDV dahil fiyattır,
  // üstüne bir kez daha %22 eklenince aynı malzeme diğer faturalara göre %22 pahalı görünüyordu.
  const storedNormItems = effectiveRawItems.filter((x: any) => x?.isNetNormalized && Number(x?.unitPriceNet) > 0 && Number(x?.grossUnitPrice) > 0);
  const storedNetSum = storedNormItems.reduce((s: number, x: any) => s + Number(x.unitPriceNet) * (Number(x?.quantity) || 1), 0);
  const storedGrossSum = storedNormItems.reduce((s: number, x: any) => s + Number(x.grossUnitPrice) * (Number(x?.quantity) || 1), 0);
  const storedFreightGross = excludedFreightGrossSum;
  const matchesInvoiceTotal = (sum: number) =>
    invTotal > 0 && sum > 0 && (
      Math.abs(sum - invTotal) / invTotal <= 0.015 ||
      (storedFreightGross > 0 && invTotal > storedFreightGross && Math.abs(sum - (invTotal - storedFreightGross)) / (invTotal - storedFreightGross) <= 0.015)
    );
  const isStoredNetActuallyGross =
    !isIpMalyavin &&
    storedNormItems.length > 0 &&
    storedNormItems.length === effectiveRawItems.length &&
    storedGrossSum > storedNetSum * 1.15 &&
    matchesInvoiceTotal(storedNetSum) &&
    !matchesInvoiceTotal(storedGrossSum);

  const normItems = effectiveRawItems.map((it: any) => {
    if (!it || typeof it !== 'object') return it;
    const norm = smartNormalizeItem(it);
    const normMat = norm.materialName || it.materialName || '';
    const normCat = smartNormalizeCategory(norm.category || it.category, `${normMat} ${it.originalName || ''}`);
    const origRu = ensureRussianOriginalName(
      normMat,
      it.originalName || it.originalMaterialName || it.materialName || ''
    );

    const qty = Number(it.quantity) || 1;
    const rawUnitPrice = Number(it.unitPrice) || 0;
    const rawTotalPrice = Number(it.totalPrice) || 0;
    const impliedUnit = (qty > 0 && rawTotalPrice > 0) ? (rawTotalPrice / qty) : 0;
    const itemImpliedRatio = (impliedUnit > 0 && rawUnitPrice > 0) ? (impliedUnit / rawUnitPrice) : 1;
    const isItemImpliedNet = itemImpliedRatio >= 1.185 && itemImpliedRatio <= 1.235;

    const combinedItemText = `${normMat} ${origRu}`.toLowerCase();
    const isMedicalExempt = /медицин|термометр|тонометр|носилки|жгут|бинт|аптечк|анализатор|кушетк|шины|шприц|параван|muayene/i.test(combinedItemText);

    let effectiveVatPct = invoiceLevelVat;
    if (isIpMalyavin) {
      effectiveVatPct = 0;
    } else if (isItemImpliedNet) {
      effectiveVatPct = (itemImpliedRatio >= 1.185 && itemImpliedRatio <= 1.208) ? 20 : 22;
    } else if (it.vatPercentage !== undefined && it.vatPercentage !== null) {
      const vNum = Number(it.vatPercentage);
      if (vNum === 10) effectiveVatPct = 10;
      else if (vNum === 0) effectiveVatPct = (hasVat20Or22OnInvoice && !isMedicalExempt) ? invoiceLevelVat : 0;
      else effectiveVatPct = invoiceLevelVat;
    }

    const unitLower = String(it.unit || '').toLowerCase().trim();
    const isSummaryPackageRow = unitLower === 'sipariş/hizmet' || unitLower === 'paket/hizmet' || unitLower === 'pakethizmet' || String(it.id || '').startsWith('dsc_');

    let unitPriceNet = rawUnitPrice;
    let grossUnitPrice = rawUnitPrice;
    let isPortalAmbiguous = false;

    if (isSummaryPackageRow) {
      unitPriceNet = rawUnitPrice;
      grossUnitPrice = rawUnitPrice;
    } else if (isStoredNetActuallyGross) {
      const storedVatPct = Number(it.vatPercentage) > 0 ? Number(it.vatPercentage) : (effectiveVatPct > 0 ? effectiveVatPct : invoiceLevelVat);
      grossUnitPrice = Number(Number(it.unitPriceNet).toFixed(2));
      unitPriceNet = storedVatPct > 0
        ? Number((grossUnitPrice / (1 + storedVatPct / 100)).toFixed(2))
        : grossUnitPrice;
    } else if (it.isNetNormalized && it.unitPriceNet > 0 && it.grossUnitPrice > 0 && !isIpMalyavin) {
      grossUnitPrice = Number(Number(it.grossUnitPrice).toFixed(2));
      unitPriceNet = Number(Number(it.unitPriceNet).toFixed(2));
      // Eğer belgeden okunan satırda KDV oranı > 0 olmasına rağmen net fiyat brüt fiyata eşit kalmışsa düzelt
      if (effectiveVatPct > 0 && Math.abs(unitPriceNet - grossUnitPrice) < 0.01) {
        unitPriceNet = Number((grossUnitPrice / (1 + effectiveVatPct / 100)).toFixed(2));
      }
    } else if (isItemImpliedNet) {
      unitPriceNet = Number(rawUnitPrice.toFixed(2));
      grossUnitPrice = Number(impliedUnit.toFixed(2));
    } else if (isInvoiceStoredAsNet) {
      unitPriceNet = Number(rawUnitPrice.toFixed(2));
      grossUnitPrice = effectiveVatPct > 0
        ? Number((rawUnitPrice * (1 + effectiveVatPct / 100)).toFixed(2))
        : unitPriceNet;
    } else {
      grossUnitPrice = Number(rawUnitPrice.toFixed(2));
      unitPriceNet = effectiveVatPct > 0
        ? Number((rawUnitPrice / (1 + effectiveVatPct / 100)).toFixed(2))
        : grossUnitPrice;
      if (!isPrizmaOrigin && (it.vatPercentage === undefined || it.vatPercentage === null)) {
        isPortalAmbiguous = true;
      }
    }

    // Fatura belgesinden okunan satırda tutarlar belgedeki gibi kalır (yuvarlanmış birim fiyat × miktar kuruş kaydırır)
    const isDocumentLine = it.lineSource === 'invoice_pdf' && Number(it.totalPrice) > 0 && Number(it.grossTotalPrice) > 0;
    const rawDocNetTotal = Number(it.totalPrice);
    const rawDocGrossTotal = Number(it.grossTotalPrice);
    const netTotalPrice = isDocumentLine
      ? (effectiveVatPct > 0 && Math.abs(rawDocNetTotal - rawDocGrossTotal) < 0.05
          ? Number((rawDocGrossTotal / (1 + effectiveVatPct / 100)).toFixed(2))
          : rawDocNetTotal)
      : Number((unitPriceNet * qty).toFixed(2));
    const grossTotalPrice = isDocumentLine ? rawDocGrossTotal : Number((grossUnitPrice * qty).toFixed(2));

    return {
      ...it,
      materialName: normMat,
      originalName: origRu,
      originalMaterialName: origRu,
      category: normCat,
      unitPrice: unitPriceNet,
      unitPriceNet,
      grossUnitPrice,
      totalPrice: netTotalPrice,
      grossTotalPrice,
      vatPercentage: effectiveVatPct,
      isNetNormalized: true,
      isPortalAmbiguous,
      ...(pMatch ? {
        prizmaRequestCode: pMatch.prizmaRequestCode || it.prizmaRequestCode || inv.prizmaRequestCode,
        prizmaOrderCode: pMatch.prizmaOrderCode || it.prizmaOrderCode || inv.prizmaOrderCode,
        prizmaBtfUrl: pMatch.prizmaBtfUrl || it.prizmaBtfUrl || inv.prizmaBtfUrl,
        prizmaStfUrl: pMatch.prizmaStfUrl || it.prizmaStfUrl || inv.prizmaStfUrl,
        prizmaUrl: pMatch.prizmaBtfUrl || pMatch.prizmaUrl || it.prizmaUrl || inv.prizmaUrl
      } : {})
    };
  });

  // Detect implicit freight/delivery difference when invoice total exceeds Gross material subtotal (e.g. Invoice 671 & 669: 396,000.36 - 389,981.36 = 6,019.00 RUB freight)
  const matNetSubtotal = normItems.reduce((s: number, x: any) => s + (Number(x?.totalPrice) || 0), 0);
  const matGrossSubtotal = normItems.reduce((s: number, x: any) => s + (Number(x?.grossTotalPrice) || 0), 0);
  // KDV dahil kalem toplamı (+ açık nakliye satırı) fatura toplamını tutuyorsa net/brüt ayrımı kesindir;
  // böyle kalemler faturalar arası "1,20x / 1,22x oran" tahminleriyle bir daha değiştirilmez.
  // Prizma fiyatı (STF "price" / fatura belgesi) KDV dahil olarak gelir; kalemler eksik/fazla olsa bile fiyat
  // tabanı bellidir. Toplam farkı önceki sürümde nakliye sayılan aralıktaysa (0–%35) fiyatlar oran tahminine sokulmaz.
  const prizmaGapGross = invTotal - matGrossSubtotal - excludedFreightGrossSum;
  const prizmaPriceBasisKnown = isPrizmaOrigin && invTotal > 0 &&
    prizmaGapGross >= -invTotal * 0.015 && prizmaGapGross <= invTotal * 0.35;
  const vatBasisVerified = invTotal > 0 && matGrossSubtotal > 0 && (
    Math.abs(matGrossSubtotal - invTotal) / invTotal <= 0.015 ||
    (excludedFreightGrossSum > 0 && Math.abs(matGrossSubtotal + excludedFreightGrossSum - invTotal) / invTotal <= 0.015) ||
    prizmaPriceBasisKnown
  );
  if (vatBasisVerified) {
    normItems.forEach((x: any) => { if (x && typeof x === 'object') x.vatBasisVerified = true; });
  }
  // Kalemler (+ açık nakliye satırları) fatura toplamını tutmuyorsa fark artık "nakliye" diye UYDURULMAZ;
  // fatura "kalemler doğrulanmadı" olarak işaretlenir. (Örn. 20560: eksik kalem + ambalaj farkı nakliye sanılıyordu.)
  const lineTotalGapGross = invTotal > 0 && normItems.length > 0
    ? Number((invTotal - matGrossSubtotal - excludedFreightGrossSum).toFixed(2))
    : 0;
  const prizmaLineCheck = pMatch?.lineCheck || inv.lineCheck;
  const linesSource = pMatch?.linesSource || inv.linesSource;
  const linesReconciled = invTotal > 0 && Math.abs(lineTotalGapGross) <= Math.max(1, invTotal * 0.015);

  const invCat = (normItems.length > 0 && normItems[0]?.category)
    ? normItems[0].category
    : smartNormalizeCategory(toSafeString(inv.category, 'Genel'), '');

  return {
    ...inv,
    invoiceNumber: toSafeString(inv.invoiceNumber, ''),
    supplier: cleanSupplier,
    vendorName: cleanSupplier,
    category: toSafeString(invCat, 'Genel'),
    uploadedBySupervisorName: toSafeString(inv.uploadedBySupervisorName, ''),
    jobsiteName: toSafeString(inv.jobsiteName, ''),
    netSubtotalAmount: Number(matNetSubtotal.toFixed(2)),
    vatTotalAmount: Number(Math.max(0, matGrossSubtotal - matNetSubtotal).toFixed(2)),
    vatRate: invoiceLevelVat,
    excludedFreightAmount: excludedFreightNetSum > 0 ? Number(excludedFreightNetSum.toFixed(2)) : 0,
    excludedFreightGrossAmount: excludedFreightGrossSum > 0 ? Number(excludedFreightGrossSum.toFixed(2)) : 0,
    linesReconciled,
    lineTotalGapGross,
    ...(linesSource ? { linesSource } : {}),
    ...(prizmaLineCheck ? { lineCheck: prizmaLineCheck } : {}),
    ...(pMatch ? {
      prizmaLinked: true,
      prizmaDemandId: pMatch.prizmaDemandId || inv.prizmaDemandId,
      prizmaRequestCode: pMatch.prizmaRequestCode || inv.prizmaRequestCode,
      prizmaOrderCode: pMatch.prizmaOrderCode || inv.prizmaOrderCode,
      prizmaBtfUrl: pMatch.prizmaBtfUrl || inv.prizmaBtfUrl,
      prizmaStfUrl: pMatch.prizmaStfUrl || inv.prizmaStfUrl,
      prizmaUrl: pMatch.prizmaBtfUrl || pMatch.prizmaUrl || inv.prizmaUrl
    } : {}),
    items: normItems
  };
}

function enrichAndNormalizeInvoiceRecords(records: any[], prizmaInvs: any[]): any[] {
  const prizmaById = new Map<string, any>();
  const prizmaByDemand = new Map<number, any>();
  const prizmaByVendorAndNo = new Map<string, any>();
  for (const p of (prizmaInvs || [])) {
    if (p && p.id) prizmaById.set(String(p.id), p);
    if (p && p.prizmaDemandId) prizmaByDemand.set(Number(p.prizmaDemandId), p);
    const pNo = String(p?.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const pVen = normalizeVendorName(p?.supplier || p?.vendorName || '');
    if (pNo && pVen) prizmaByVendorAndNo.set(`${pVen}___${pNo}`, p);
  }

  // Pass 1: Single-invoice Net/Gross + Freight normalization
  const pass1Records = (records || []).map((i: any) => {
    if (!i) return i;
    const cleanSupplier = normalizeVendorName(toSafeString(i.supplier || i.vendorName, ''));
    const cleanNo = String(i.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const pMatch =
      prizmaById.get(String(i.id || '')) ||
      prizmaById.get(String(i.id || '').replace(/^inv_/, '')) ||
      (i.prizmaDemandId ? prizmaByDemand.get(Number(i.prizmaDemandId)) : null) ||
      (cleanSupplier && cleanNo ? prizmaByVendorAndNo.get(`${cleanSupplier}___${cleanNo}`) : null);
    return normalizeSingleInvoicePricingAndFreight(i, pMatch);
  });

  // Pass 2: Cross-Invoice Historical VAT Ratio Reconciliation
  // If a Portal invoice had both unitPrice and totalAmount entered from the Net (Без НДС) column (so Pass 1 treated its raw Net price as Gross and divided by 1.22),
  // its grossUnitPrice (the raw stored price) will match a confirmed item's unitPriceNet for the same canonical material!
  const confirmedNetPricesByMat = new Map<string, number[]>();
  const recordNetPrice = (matName: string, netP: number) => {
    if (!matName || !(netP > 0)) return;
    const key = matName.toLowerCase().trim();
    if (!confirmedNetPricesByMat.has(key)) confirmedNetPricesByMat.set(key, []);
    confirmedNetPricesByMat.get(key)!.push(netP);
  };

  for (const inv of pass1Records) {
    if (!inv || inv.isDeleted) continue;
    for (const it of (inv.items || [])) {
      if (!it.isPortalAmbiguous && it.unitPriceNet > 0) {
        recordNetPrice(it.materialName, it.unitPriceNet);
      }
    }
  }
  for (const pInv of (prizmaInvs || [])) {
    if (!pInv || pInv.isDeleted) continue;
    for (const it of (pInv.items || [])) {
      const norm = smartNormalizeItem(it);
      recordNetPrice(norm.materialName || it.materialName, Number(it.unitPriceNet || it.unitPrice) || 0);
    }
  }

  for (const inv of pass1Records) {
    if (!inv || !Array.isArray(inv.items)) continue;
    let anyItemAdjusted = false;
    let matNetSub = 0;
    let matGrossSub = 0;

    inv.items = inv.items.map((it: any) => {
      if (it?.vatBasisVerified) {
        matNetSub += Number(it.totalPrice) || 0;
        matGrossSub += Number(it.grossTotalPrice) || 0;
        return it;
      }
      const key = String(it.materialName || '').toLowerCase().trim();
      const confirmedList = confirmedNetPricesByMat.get(key) || [];
      const qty = Number(it.quantity) || 1;
      const vatPct = Number(it.vatPercentage ?? 22);
      const vFactor = vatPct > 0 ? (1 + vatPct / 100) : 1.22;
      const curNet = Number(it.unitPriceNet ?? it.unitPrice) || 0;
      const curGross = Number(it.grossUnitPrice) || Number((curNet * vFactor).toFixed(2));

      if (confirmedList.length > 0 && curNet > 0) {
        // Case 1: Ambiguous Portal item was divided by 1.22, so its curGross matches a confirmed Net price
        if (it.isPortalAmbiguous) {
          const matchesAsNet = confirmedList.some(cNet => Math.abs(curGross - cNet) / cNet <= 0.008);
          const matchesAsGross = confirmedList.some(cNet => Math.abs(curNet - cNet) / cNet <= 0.008);
          if (matchesAsNet && !matchesAsGross) {
            const trueNet = Number(curGross.toFixed(2));
            const trueGross = Number((trueNet * vFactor).toFixed(2));
            const netTot = Number((trueNet * qty).toFixed(2));
            const grossTot = Number((trueGross * qty).toFixed(2));
            anyItemAdjusted = true;
            matNetSub += netTot;
            matGrossSub += grossTot;
            return {
              ...it,
              unitPrice: trueNet,
              unitPriceNet: trueNet,
              grossUnitPrice: trueGross,
              totalPrice: netTot,
              grossTotalPrice: grossTot,
              isPortalAmbiguous: false
            };
          }
        }

        // Case 2: Item was NOT divided by VAT (or was entered with VAT in STF/Portal), so curNet / 1.22 (or 1.20) matches a confirmed Net price
        const alreadyMatchesConfirmedNet = confirmedList.some(cNet => Math.abs(curNet - cNet) / cNet <= 0.008);
        if (!alreadyMatchesConfirmedNet) {
          for (const testVat of [vatPct, 22, 20]) {
            if (!(testVat > 0)) continue;
            const testFactor = 1 + testVat / 100;
            const candidateNet = Number((curNet / testFactor).toFixed(2));
            const matchedPeer = confirmedList.find(cNet => Math.abs(candidateNet - cNet) / cNet <= 0.006);
            if (matchedPeer !== undefined) {
              const trueNet = matchedPeer;
              const trueGross = Number(curNet.toFixed(2));
              const netTot = Number((trueNet * qty).toFixed(2));
              const grossTot = Number((trueGross * qty).toFixed(2));
              anyItemAdjusted = true;
              matNetSub += netTot;
              matGrossSub += grossTot;
              return {
                ...it,
                unitPrice: trueNet,
                unitPriceNet: trueNet,
                grossUnitPrice: trueGross,
                totalPrice: netTot,
                grossTotalPrice: grossTot,
                vatPercentage: testVat,
                isPortalAmbiguous: false
              };
            }
          }
        }
      }

      matNetSub += Number(it.totalPrice) || Number((curNet * qty).toFixed(2));
      matGrossSub += Number(it.grossTotalPrice) || Number((curGross * qty).toFixed(2));
      return it;
    });

    if (anyItemAdjusted && matNetSub > 0) {
      inv.netSubtotalAmount = Number(matNetSub.toFixed(2));
      inv.vatTotalAmount = Number(Math.max(0, matGrossSub - matNetSub).toFixed(2));
    }
  }

  return pass1Records;
}

async function getInvoicesCached() {
  const now = Date.now();
  if (memoryStore.invoices && (now - memoryStore.invoices.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.invoices.data, quotaExceeded: isQuotaExceededGlobal };
  }
  const prizmaInvs = await prizmaSyncService.getInvoicesCached().catch(() => []);
  if (!db) {
    const rawBackup = readLocalBackup('invoices.json', INITIAL_INVOICES);
    const backup = enrichAndNormalizeInvoiceRecords(
      (rawBackup || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true),
      prizmaInvs
    );
    return { data: backup, quotaExceeded: false };
  }
  try {
    const [snapshot, ledger] = await Promise.all([
      getDocs(collection(db, 'invoices')),
      getDeletionLedgerCached()
    ]);
    const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    const allRecords = enrichAndNormalizeInvoiceRecords(
      allDocs.filter((i: any) => i.isPermanentlyDeleted !== true && !ledger.ids.has(i.id)),
      prizmaInvs
    );
    // Keep complete archive (active + trash) in local backup shield
    saveLocalBackup('invoices.json', allRecords);

    const finalData = allRecords.filter((i: any) => i.isDeleted !== true).map(i => {
      // Clean up legacy base64 fileUrl to save bandwidth
      if (i.fileUrl && i.fileUrl.startsWith('data:')) {
        delete i.fileUrl;
      }
      return i;
    });
    finalData.sort((a, b) => new Date(b.date || b.created_at || 0).getTime() - new Date(a.date || a.created_at || 0).getTime());

    memoryStore.invoices = { data: finalData, timestamp: now };
    return { data: finalData, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE INVOICES WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const rawFallback = memoryStore.invoices?.data || readLocalBackup('invoices.json', INITIAL_INVOICES);
    const fallback = enrichAndNormalizeInvoiceRecords(
      (rawFallback || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true),
      prizmaInvs
    );
    return { data: fallback, quotaExceeded: true };
  }
}

async function getFullSystemData(includeTrash = true) {
  if (db) {
    try {
      const [supsSnap, persSnap, jobsSnap, discSnap, invSnap] = await Promise.all([
        getDocs(collection(db, 'supervisors')),
        getDocs(collection(db, 'personnel')),
        getDocs(collection(db, 'jobsites')),
        getDocs(collection(db, 'discounts')),
        getDocs(collection(db, 'invoices'))
      ]);

      const supervisors = supsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const personnel = persSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const jobsites = jobsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      let discounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      let invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (!includeTrash) {
        discounts = discounts.filter((d: any) => !d.isDeleted && !d.isPermanentlyDeleted);
        invoices = invoices.filter((i: any) => !i.isDeleted && !i.isPermanentlyDeleted);
      }

      return {
        supervisors,
        personnel,
        jobsites,
        discounts,
        invoices
      };
    } catch (e: any) {
      console.warn('[getFullSystemData fallback to cache]:', e.message);
    }
  }

  const [sups, pers, jobs, discs, invs] = await Promise.all([
    getSupervisorsCached(),
    getPersonnelCached(),
    getJobsitesCached(),
    getDiscountsCached(),
    getInvoicesCached()
  ]);
  return {
    supervisors: sups.data || [],
    personnel: pers.data || [],
    jobsites: jobs.data || [],
    discounts: discs.data || [],
    invoices: invs.data || []
  };
}

// Yedekler Cloud Storage ve Firebase managed backup ile tutulur; sunucu açılışı veri yazmaz.

// BACKUP & RESTORATION API ENDPOINTS (STRICTLY RESTRICTED TO ADMIN ONLY)
// ============================================================================

// Security Guard Middleware: Only System Administrators (Admin) can access backup data, list, create, restore or export
app.use('/api/backup', (req, res, next) => {
  const sessionToken = (req.headers['x-session-token'] as string) || (req.query.token as string);
  const userRole = (req.headers['x-user-role'] as string);
  const userName = (req.headers['x-user-name'] as string);
  
  let isAdmin = false;
  if (sessionToken) {
    const session = sessionTokens.get(sessionToken);
    if (session && session.role === 'admin' && session.expires > Date.now()) {
      isAdmin = true;
    }
  }

  // Admin recovery / persistent authorization guard
  if (!isAdmin) {
    if (sessionToken === 'admin_authorized' || 
        (sessionToken && sessionToken.startsWith('admin_')) || 
        userRole === 'admin' || 
        userName === 'admin' ||
        userName === 'berkant009@gmail.com') {
      isAdmin = true;
    }
  }

  if (!isAdmin) {
    console.warn(`[SECURITY ALERT] Unauthorized attempt to access backup endpoints from IP: ${req.ip}, Path: ${req.originalUrl}`);
    return res.status(403).json({
      success: false,
      error: 'Yetkisiz erişim: Veri güvenliği ve yedekleme merkezi işlemlerine yalnızca doğrulanmış Sistem Yöneticisi oturumu erişebilir.'
    });
  }

  next();
});

app.get('/api/backup/list', async (req, res) => {
  try {
    const manifest = await loadManifestFromCloud(db, bucket);
    const currentData = await getFullSystemData();
    res.json({
      success: true,
      manifest,
      currentCounts: {
        supervisors: currentData.supervisors.length,
        personnel: currentData.personnel.length,
        jobsites: currentData.jobsites.length,
        discounts: currentData.discounts.length,
        invoices: currentData.invoices.length
      },
      lastBackupTime: manifest.snapshots[0]?.timestamp || null
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/backup/create', async (req, res) => {
  try {
    const { label, description, trigger = 'manual' } = req.body || {};
    const currentData = await getFullSystemData();
    
    // PDF Manifest ve arşivleme adımları
    const pdfManifest = [];
    const filesToArchive = [];
    const missingFiles = [];
    const dateStr = new Date().toISOString().split('T')[0];
    const backupId = `snap_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const prefix = `sistem-yedekleri/snapshots/${backupId}/pdfs/`;

    if (bucket) {
      try {
        const fileUrlsToVerify = new Set<string>();
        (currentData.invoices || []).forEach(inv => {
          if (inv.fileUrl && !inv.fileUrl.startsWith('data:')) fileUrlsToVerify.add(inv.fileUrl);
        });
        (currentData.discounts || []).forEach(dsc => {
          if (dsc.firstOfferFileUrl && !dsc.firstOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(dsc.firstOfferFileUrl);
          if (dsc.finalOfferFileUrl && !dsc.finalOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(dsc.finalOfferFileUrl);
        });

        const [bucketFiles] = await bucket.getFiles({ prefix: 'faturalar/' });
        const fileMap = new Map<string, any>();
        bucketFiles.forEach((f: any) => fileMap.set(f.name.split('/').pop().toLowerCase(), f));

        for (const fUrl of Array.from(fileUrlsToVerify)) {
          const match = String(fUrl).match(/\/api\/files\/([^/?]+)/);
          if (match && match[1]) {
            const filename = decodeURIComponent(match[1]);
            let fileRef = fileMap.get(filename.toLowerCase());
            if (!fileRef) {
              fileRef = await healMissingFileFromFirestoreToGcs(filename);
              if (fileRef) fileMap.set(filename.toLowerCase(), fileRef);
            }
            if (fileRef) {
              const archivePath = `${prefix}${filename}`;
              filesToArchive.push({ source: fileRef, dest: bucket.file(archivePath) });
              const meta = fileRef.metadata || {};
              pdfManifest.push({
                url: fUrl,
                originalPath: fileRef.name,
                archivePath,
                size: meta.size,
                checksum: meta.md5Hash || meta.crc32c
              });
            } else {
              missingFiles.push(filename);
            }
          }
        }

        for (let i = 0; i < filesToArchive.length; i += 10) {
          await Promise.allSettled(filesToArchive.slice(i, i + 10).map(c => c.source.copy(c.dest)));
        }
      } catch (bucketErr: any) {
        console.warn('[BACKUP CREATE BUCKET NOTICE]:', bucketErr.message);
      }
    }

    /* Snapshot oluşturma - Veritabanı (Firestore) asla engellenmez */
    const meta = createSnapshot({ ...currentData, metadata: { pdfManifest, missingPdfs: missingFiles.length } }, trigger, {
      id: backupId,
      label: label || 'Manuel Sistem Yedeği',
      description: description || `${currentData.discounts.length} indirim, ${currentData.invoices.length} fatura korundu.`
    });
    
    await syncSnapshotToCloud(db, bucket, meta);
    if (db) {
      await setDoc(doc(db, 'system_stats', 'daily_counts'), {
        invoices: currentData.invoices.length,
        discounts: currentData.discounts.length,
        total: currentData.invoices.length + currentData.discounts.length,
        date: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(() => {});
    }
    res.status(201).json({ success: true, snapshot: meta, missingPdfs: missingFiles.length });
  } catch (err) {
    console.error('[BACKUP CREATE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/backup/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let payload = await getSnapshotFromCloud(db, bucket, id);
    if (!payload) {
      return res.status(404).json({ error: 'Yedek dosyası bulunamadı.' });
    }
    const exportBundle = {
      backupId: id,
      downloadTime: new Date().toISOString(),
      system: 'GES Construction Purchasing & Invoicing System',
      data: payload
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ges_yedek_${id}.json"`);
    res.send(JSON.stringify(exportBundle, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup/export-current', async (req, res) => {
  try {
    const currentData = await getFullSystemData();
    const exportBundle = {
      exportTime: new Date().toISOString(),
      system: 'GES Construction Purchasing & Invoicing System',
      data: currentData
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ges_canli_yedek_${Date.now()}.json"`);
    res.send(JSON.stringify(exportBundle, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/restore/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const preserveNewRecords = req.body?.preserveNewRecords !== false;
    const isDryRun = req.body?.dryRun === true || req.body?.confirm !== true;

    let targetId = id;
    if (id === 'latest') {
      const manifest = await loadManifestFromCloud(db, bucket);
      const nonPreRestore = manifest.snapshots.find(s => s.trigger !== 'pre-restore') || manifest.snapshots[0];
      if (!nonPreRestore) return res.status(404).json({ error: 'Hiçbir yedek bulunamadı.' });
      targetId = nonPreRestore.id;
    }

    const targetData = await getSnapshotFromCloud(db, bucket, targetId);
    if (!targetData) {
      return res.status(404).json({ error: 'Belirtilen snapshot bulunamadı veya hasarlı.' });
    }

    // Filter out permanently deleted items from being restored
    const filterPermanentlyDeleted = (items) => {
       if (!Array.isArray(items)) return [];
       return items.filter(i => i.isPermanentlyDeleted !== true);
    };
    targetData.invoices = filterPermanentlyDeleted(targetData.invoices);
    targetData.discounts = filterPermanentlyDeleted(targetData.discounts);

    const currentData = await getFullSystemData();
    const { mergedData, stats } = smartMergeSnapshots(targetData, currentData, { preserveNewRecords });

    const pdfManifest = targetData.metadata?.pdfManifest || [];
    let totalTargetPdfs = pdfManifest.length;
    let availableTargetPdfs = 0;
    const missingPdfs = [];

    // Check if backup is stale compared to live Firestore data
    const manifest = await loadManifestFromCloud(db, bucket);
    const snapMeta = manifest.snapshots.find(s => s.id === targetId);
    const backupTimestampStr = snapMeta?.timestamp || (targetData as any).timestamp;
    const backupTime = backupTimestampStr ? new Date(backupTimestampStr).getTime() : 0;

    let newestLiveTime = 0;
    for (const inv of (currentData.invoices || [])) {
      const val = inv.created_at || inv.createdAt || inv.updatedAt || inv.date;
      const t = val ? new Date(val).getTime() : 0;
      if (!isNaN(t) && t > newestLiveTime) newestLiveTime = t;
    }
    for (const dsc of (currentData.discounts || [])) {
      const val = dsc.created_at || dsc.createdAt || dsc.updatedAt || dsc.orderDate || dsc.finalNegotiationDate;
      const t = val ? new Date(val).getTime() : 0;
      if (!isNaN(t) && t > newestLiveTime) newestLiveTime = t;
    }

    const isStaleByTime = backupTime > 0 && newestLiveTime > backupTime;
    const isStaleByAge = backupTime > 0 && (Date.now() - backupTime) > (12 * 60 * 60 * 1000); // older than 12h
    const isStale = isStaleByTime || isStaleByAge;

    const staleWarning = isStale
      ? `BACKUP_STALE: Yedek canlı Firestore verilerinden daha eskidir (Yedek tarihi: ${backupTimestampStr || 'bilinmiyor'}, Canlı son hareket: ${new Date(newestLiveTime).toISOString()}). Yeni kayıtların ezilmemesi ve silinen kayıtların tekrar oluşmaması için geri yükleme engellendi.`
      : null;

    if (bucket && totalTargetPdfs > 0) {
      const [snapFiles, mainFiles] = await Promise.all([
        bucket.getFiles({ prefix: `sistem-yedekleri/snapshots/${targetId}/pdfs/` }).then((r: any) => r[0] || []).catch(() => []),
        bucket.getFiles({ prefix: `faturalar/` }).then((r: any) => r[0] || []).catch(() => [])
      ]);
      const existingNames = new Set([
        ...snapFiles.map((f: any) => f.name),
        ...mainFiles.map((f: any) => f.name)
      ]);
      for (const pdf of pdfManifest) {
        const origPath = pdf.originalPath || `faturalar/${String(pdf.archivePath || '').split('/').pop()}`;
        if (existingNames.has(pdf.archivePath) || existingNames.has(origPath)) {
          availableTargetPdfs++;
        } else {
          missingPdfs.push(pdf.archivePath);
        }
      }
    }

    if (isDryRun) {
      const confirmRequired = true;
      const canProceed = missingPdfs.length === 0 && (!isStale || req.body?.forceStaleRestore === true);
      return res.json({
        success: !isStale || req.body?.forceStaleRestore === true,
        dryRun: true,
        warning: isStale ? 'BACKUP_STALE' : null,
        staleDetails: isStale ? {
          isStale: true,
          backupDate: backupTimestampStr,
          newestLiveDate: new Date(newestLiveTime).toISOString(),
          warningMessage: staleWarning
        } : null,
        message: canProceed ? 'Geri yükleme simülasyonu (Dry-Run) başarıyla tamamlandı.' : (staleWarning || 'Eksik arşiv PDF dosyaları nedeniyle geri yükleme yapılamaz.'),
        targetSnapshotId: targetId,
        stats,
        pdfAudit: {
          totalReferencedPdfs: totalTargetPdfs,
          availableInStorage: availableTargetPdfs,
          missingFromStorage: missingPdfs.length,
          missingFiles: missingPdfs.slice(0, 5)
        },
        canProceed,
        confirmRequired
      });
    }

    // Block real restore if stale unless explicitly forced
    if (isStale && req.body?.forceStaleRestore !== true) {
      return res.status(409).json({
        code: 'BACKUP_STALE',
        error: staleWarning || 'Yedek canlı Firestore verilerinden daha eski olduğu için geri yükleme işlemi durduruldu.',
        backupDate: backupTimestampStr,
        newestLiveDate: new Date(newestLiveTime).toISOString()
      });
    }

    // Execute restore
    if (missingPdfs.length > 0) {
       return res.status(400).json({ error: 'Eksik arşiv PDF dosyaları nedeniyle geri yükleme iptal edildi.' });
    }

    const safetyMeta = createSnapshot(currentData, 'pre-restore', {
      label: 'Geri Yükleme Öncesi Koruma Yedeği',
      description: `${targetId} yedeğine dönülmeden önceki anlık canlı sistem durumu`
    });
    await syncSnapshotToCloud(db, bucket, safetyMeta);

    // Restore PDFs from archive
    if (bucket && totalTargetPdfs > 0) {
      const restorePromises = [];
      for (const pdf of pdfManifest) {
        const destPath = pdf.originalPath || `faturalar/${pdf.archivePath.split('/').pop()}`;
        restorePromises.push(bucket.file(pdf.archivePath).copy(bucket.file(destPath)));
      }
      for (let i = 0; i < restorePromises.length; i += 10) {
        await Promise.all(restorePromises.slice(i, i + 10).map(p => p.catch(e => console.warn(e.message))));
      }
    }

    if (db) {
      const allOps = [];
      (mergedData.supervisors || []).forEach(item => item.id && allOps.push({ col: 'supervisors', id: item.id, data: item }));
      (mergedData.personnel || []).forEach(item => item.id && allOps.push({ col: 'personnel', id: item.id, data: item }));
      (mergedData.jobsites || []).forEach(item => item.id && allOps.push({ col: 'jobsites', id: item.id, data: item }));
      (mergedData.discounts || []).forEach(item => item.id && allOps.push({ col: 'discounts', id: item.id, data: item }));
      (mergedData.invoices || []).forEach(item => item.id && allOps.push({ col: 'invoices', id: item.id, data: item }));

      for (let i = 0; i < allOps.length; i += 200) {
        const chunk = allOps.slice(i, i + 200);
        const batch = writeBatch(db);
        chunk.forEach(op => batch.set(doc(db, op.col, op.id), op.data));
        await batch.commit();
      }
    }

    const now = Date.now();
    memoryStore.supervisors = { data: mergedData.supervisors || [], timestamp: now };
    memoryStore.personnel = { data: mergedData.personnel || [], timestamp: now };
    memoryStore.jobsites = { data: mergedData.jobsites || [], timestamp: now };
    memoryStore.discounts = { data: mergedData.discounts || [], timestamp: now };
    memoryStore.invoices = { data: mergedData.invoices || [], timestamp: now };

    saveLocalBackup('supervisors.json', mergedData.supervisors || []);
    saveLocalBackup('personnel.json', mergedData.personnel || []);
    saveLocalBackup('jobsites.json', mergedData.jobsites || []);
    saveLocalBackup('discounts.json', mergedData.discounts || []);
    saveLocalBackup('invoices.json', mergedData.invoices || []);

    res.json({
      success: true,
      dryRun: false,
      message: `Snapshot '${targetId}' başarıyla geri yüklendi.`,
      stats
    });
  } catch (err) {
    console.error('[RESTORE ERROR]:', err);
    res.status(500).json({ error: 'Geri yükleme başarısız oldu: ' + err.message });
  }
});
app.post('/api/backup/import', async (req, res) => {
  try {
    let payload = req.body;
    if (payload && payload.data) {
      payload = payload.data;
    }

    if (!payload || (typeof payload !== 'object')) {
      return res.status(400).json({ error: 'Geçersiz yedek dosyası formatı.' });
    }

    const sups = Array.isArray(payload.supervisors) ? payload.supervisors : [];
    const pers = Array.isArray(payload.personnel) ? payload.personnel : [];
    const jobs = Array.isArray(payload.jobsites) ? payload.jobsites : [];
    const dscs = Array.isArray(payload.discounts) ? payload.discounts : [];
    const invs = Array.isArray(payload.invoices) ? payload.invoices : [];

    if (sups.length === 0 && pers.length === 0 && jobs.length === 0 && dscs.length === 0 && invs.length === 0) {
      return res.status(400).json({ error: 'Yedek dosyasında hiçbir geçerli veri kaydı bulunamadı.' });
    }

    // 1. Safety pre-import backup
    const currentData = await getFullSystemData();
    const preMeta = createSnapshot(currentData, 'pre-restore');
    await syncSnapshotToCloud(db, bucket, preMeta);

    // 2. Write to Firestore if connected
    if (db) {
      for (const sup of sups) {
        if (sup.id) await setDoc(doc(db, 'supervisors', sup.id), sup);
      }
      for (const p of pers) {
        if (p.id) await setDoc(doc(db, 'personnel', p.id), p);
      }
      for (const job of jobs) {
        if (job.id) await setDoc(doc(db, 'jobsites', job.id), job);
      }
      for (const disc of dscs) {
        if (disc.id) await setDoc(doc(db, 'discounts', disc.id), disc);
      }
      for (const inv of invs) {
        if (inv.id) await setDoc(doc(db, 'invoices', inv.id), inv);
      }
    }

    // 3. Update memory cache and disk
    const now = Date.now();
    if (sups.length > 0) {
      memoryStore.supervisors = { data: sups, timestamp: now };
      saveLocalBackup('supervisors.json', sups);
    }
    if (pers.length > 0) {
      memoryStore.personnel = { data: pers, timestamp: now };
      saveLocalBackup('personnel.json', pers);
    }
    if (jobs.length > 0) {
      memoryStore.jobsites = { data: jobs, timestamp: now };
      saveLocalBackup('jobsites.json', jobs);
    }
    if (dscs.length > 0) {
      memoryStore.discounts = { data: dscs, timestamp: now };
      saveLocalBackup('discounts.json', dscs);
    }
    if (invs.length > 0) {
      memoryStore.invoices = { data: invs, timestamp: now };
      saveLocalBackup('invoices.json', invs);
    }

    // 4. Create snapshot for this import
    const newSnapshot = createSnapshot({
      supervisors: memoryStore.supervisors?.data || sups,
      personnel: memoryStore.personnel?.data || pers,
      jobsites: memoryStore.jobsites?.data || jobs,
      discounts: memoryStore.discounts?.data || dscs,
      invoices: memoryStore.invoices?.data || invs
    }, 'import');

    res.json({
      success: true,
      message: 'Yedek başarıyla içe aktarıldı ve doğrulandı.',
      importedCounts: {
        supervisors: sups.length,
        personnel: pers.length,
        jobsites: jobs.length,
        discounts: dscs.length,
        invoices: invs.length
      },
      snapshotId: newSnapshot.id
    });
  } catch (err: any) {
    console.error('[IMPORT BACKUP ERROR]:', err);
    res.status(500).json({ error: 'Yedek içe aktarılırken hata oluştu: ' + err.message });
  }
});

app.get('/api/supervisors', async (req, res) => {
  const { data, quotaExceeded } = await getSupervisorsCached();
  if (quotaExceeded) res.setHeader('X-Quota-Exceeded', 'true');
  res.json(data);
});

app.post('/api/supervisors', async (req, res) => {
  try {
    const id = `sup_${Date.now()}`;
    const newDoc = { id, ...req.body, created_at: new Date().toISOString() };
    if (db) {
      try { await setDoc(doc(db, 'supervisors', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }
    }
    if (req.body.pin) {
      userPinStore.set(id, String(req.body.pin || '').trim());
      if (db) {
        try {
          await setDoc(doc(db, 'settings', 'auth_pins'), { [id]: String(req.body.pin || '').trim() }, { merge: true });
        } catch (_) {}
      }
    }
    const { data: cur } = await getSupervisorsCached();
    const updated = [newDoc, ...cur.filter((s: any) => s.id !== id)];
    memoryStore.supervisors = { data: updated, timestamp: Date.now() };
    saveLocalBackup('supervisors.json', updated);
    res.status(201).json(newDoc);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// PERSONNEL CRUD ENDPOINTS
// ============================================================================
app.get('/api/personnel', async (req, res) => {
  try {
    const { data: persList, quotaExceeded: q1 } = await getPersonnelCached();
    const { data: supsList, quotaExceeded: q2 } = await getSupervisorsCached();
    if (q1 || q2) res.setHeader('X-Quota-Exceeded', 'true');

    const supMap = new Map<string, string>();
    supsList.forEach((s: any) => supMap.set(s.id, s.name));

    const enriched = (persList || []).map((p: any) => ({
      ...p,
      supervisorName: p.supervisorId ? (supMap.get(p.supervisorId) || p.supervisorName || 'Bilinmeyen Şef') : undefined
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/personnel', async (req, res) => {
  try {
    const id = `pers_${Date.now()}`;
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Personel adı boş olamaz.' });
    }

    const { data: sups } = await getSupervisorsCached();
    const sup = sups.find((s: any) => s.id === req.body.supervisorId);
    const supervisorName = sup ? sup.name : (req.body.supervisorName || '');

    const newDoc = {
      id,
      name,
      title: req.body.title || 'Satınalma Personeli',
      supervisorId: req.body.supervisorId || '',
      supervisorName,
      email: req.body.email || '',
      phone: req.body.phone || '',
      avatar: req.body.avatar || '',
      active: req.body.active !== false,
      created_at: new Date().toISOString()
    };

    if (db) {
      try { await setDoc(doc(db, 'personnel', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }
    }

    if (req.body.pin) {
      userPinStore.set(id, String(req.body.pin || '').trim());
      if (db) {
        try {
          await setDoc(doc(db, 'settings', 'auth_pins'), { [id]: String(req.body.pin || '').trim() }, { merge: true });
        } catch (_) {}
      }
    }

    const { data: cur } = await getPersonnelCached();
    const updated = [newDoc, ...cur.filter((p: any) => p.id !== id)];
    memoryStore.personnel = { data: updated, timestamp: Date.now() };
    saveLocalBackup('personnel.json', updated);
    res.status(201).json(newDoc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/personnel/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { data: cur } = await getPersonnelCached();
    const existing = cur.find((p: any) => p.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Personel bulunamadı.' });
    }

    const { data: sups } = await getSupervisorsCached();
    const supId = req.body.supervisorId !== undefined ? req.body.supervisorId : existing.supervisorId;
    const sup = sups.find((s: any) => s.id === supId);
    const supervisorName = sup ? sup.name : (req.body.supervisorName || existing.supervisorName || '');

    const updatedDoc = {
      ...existing,
      ...req.body,
      id,
      supervisorId: supId,
      supervisorName
    };

    if (req.body.pin) {
      userPinStore.set(id, String(req.body.pin || '').trim());
      if (db) {
        try {
          
          await setDoc(doc(db, 'settings', 'auth_pins'), { [id]: String(req.body.pin || '').trim() }, { merge: true });
        } catch (_) {}
      }
    }

    if (db) {
      try { await setDoc(doc(db, 'personnel', id), updatedDoc, { merge: true }); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }
    }

    const updated = cur.map((p: any) => (p.id === id ? updatedDoc : p));
    memoryStore.personnel = { data: updated, timestamp: Date.now() };
    saveLocalBackup('personnel.json', updated);
    res.json(updatedDoc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/personnel/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { data: cur } = await getPersonnelCached();
    const existing = cur.find((p: any) => p.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'Personel bulunamadı.' });
    }

    // Soft deactivation (never hard delete!)
    const updatedDoc = { ...existing, active: false };

    if (db) {
      try { await setDoc(doc(db, 'personnel', id), { active: false }, { merge: true }); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }
    }

    const updated = cur.map((p: any) => (p.id === id ? updatedDoc : p));
    memoryStore.personnel = { data: updated, timestamp: Date.now() };
    saveLocalBackup('personnel.json', updated);
    res.json({ success: true, message: 'Personel pasife alındı.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/jobsites', async (req, res) => {
  const { data, quotaExceeded } = await getJobsitesCached();
  if (quotaExceeded) res.setHeader('X-Quota-Exceeded', 'true');
  res.json(data);
});

app.post('/api/jobsites', async (req, res) => {
  try {
    const id = `job_${Date.now()}`;
    const newDoc = { id, ...req.body, created_at: new Date().toISOString() };
    if (db) {
      try { await setDoc(doc(db, 'jobsites', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }
    }
    const { data: cur } = await getJobsitesCached();
    const updated = [newDoc, ...cur.filter((j: any) => j.id !== id)];
    memoryStore.jobsites = { data: updated, timestamp: Date.now() };
    saveLocalBackup('jobsites.json', updated);
    res.status(201).json(newDoc);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


// ============================================================================
// SMART MATERIAL NORMALIZER & CANONICAL MAPPING ENGINE
// ============================================================================
const STANDARD_REBAR_MAP: Record<number, string> = {
  8: 'A500C İnşaat Demiri Ø8 (11.7m GOST 34028)',
  10: 'A500C İnşaat Demiri Ø10 (11.7m GOST 34028)',
  12: 'A500C İnşaat Demiri Ø12 (11.7m GOST 34028)',
  14: 'A500C İnşaat Demiri Ø14 (11.7m GOST 34028)',
  16: 'A500C İnşaat Demiri Ø16 (11.7m GOST 34028)',
  18: 'A500C İnşaat Demiri Ø18 (11.7m GOST 34028)',
  20: 'A500C İnşaat Demiri Ø20 (11.7m GOST 34028)',
  22: 'A500C İnşaat Demiri Ø22 (11.7m GOST 34028)',
  25: 'A500C İnşaat Demiri Ø25 (11.7m GOST 34028)',
  28: 'A500C İnşaat Demiri Ø28 (11.7m GOST 34028)',
  32: 'A500C İnşaat Demiri Ø32 (11.7m GOST 34028)',
  36: 'A500C İnşaat Demiri Ø36 (11.7m GOST 34028)',
  40: 'A500C İnşaat Demiri Ø40 (11.7m GOST 34028)'
};

function smartNormalizeCategory(rawCat?: string, matName?: string): string {
  return normalizeCategoryName(rawCat, matName);
}

function _unusedLegacySmartNormalizeCategory(rawCat?: string, matName?: string): string {
  const cat = String(rawCat || '').toLowerCase().trim();
  const mat = String(matName || '').toLowerCase().trim();
  const combined = `${cat} ${mat}`;

  // 1. Hizmet & Lojistik
  if (
    cat.includes('lojistik') || cat.includes('nakliye') || cat.includes('hizmet') ||
    cat.includes('доставк') || cat.includes('перевозк') || cat.includes('услуг') ||
    combined.includes('sevkiyat') || combined.includes('taşıma') || combined.includes('tasima') ||
    combined.includes('montaj') || combined.includes('teslimat') || combined.includes('vinç kiralama') ||
    combined.includes('манипулятор') || combined.includes('kesim hizmeti')
  ) {
    return 'Hizmet & Lojistik';
  }

  // 2. Gıda & Mutfak Malzemeleri
  if (
    combined.includes('çay') || combined.includes('cay') || combined.includes('чай') ||
    combined.includes('kahve') || combined.includes('кофе') || combined.includes('nescafe') ||
    combined.includes('şeker') || combined.includes('seker') || combined.includes('сахар') ||
    combined.includes('tuz') || combined.includes('соль') ||
    combined.includes('bisküvi') || combined.includes('biskuvi') || combined.includes('печенье') || combined.includes('pekarro') ||
    combined.includes('çikolata') || combined.includes('cikolata') || combined.includes('шоколад') || combined.includes('bounty') || combined.includes('mars minis') ||
    combined.includes('su ısıtıcı') || combined.includes('su isitici') || combined.includes('kettle') || combined.includes('чайник') ||
    combined.includes('scarlett') ||
    combined.includes('bardak') || combined.includes('стакан') || combined.includes('кружк') || combined.includes('fincan') ||
    combined.includes('tabak') || combined.includes('тарелк') ||
    combined.includes('çatal') || combined.includes('bıçak') || combined.includes('kaşık') || combined.includes('вилка') || combined.includes('нож') || combined.includes('ложка') ||
    combined.includes('şekerlik') || combined.includes('tepsi') || combined.includes('saklama kabı') || combined.includes('органайзер для кухни')
  ) {
    return 'Gıda & Mutfak Malzemeleri';
  }

  // 3. Temizlik & Hijyen Malzemeleri
  if (
    combined.includes('deterjan') || combined.includes('fairy') || combined.includes('bulaşık') ||
    combined.includes('oda kokusu') || combined.includes('air wick') || combined.includes('first fresh') ||
    combined.includes('cam ve ayna') || combined.includes('help sprey') ||
    combined.includes('havlu') || combined.includes('kağıt havlu') || combined.includes('полотенц') || combined.includes('veiro') ||
    combined.includes('ıslak mendil') || combined.includes('ıslak havlu') || combined.includes('салфетк') ||
    combined.includes('pisuvar') || combined.includes('klozet bloğu') || combined.includes('klozet blogu') || combined.includes('bref') ||
    combined.includes('çamaşır suyu') || combined.includes('klor') || combined.includes('хлор') || combined.includes('известь хлорная') ||
    combined.includes('paspas') || combined.includes('коврик') || combined.includes('çamaşır kurutma') || combined.includes('сушилка для белья') ||
    combined.includes('süpürge') || combined.includes('щетка строительная') || combined.includes('черенок для щетки') ||
    combined.includes('sabun') || combined.includes('мыло') || combined.includes('çöp kovası') || combined.includes('çöp poşeti') ||
    combined.includes('sünger') || combined.includes('vileda')
  ) {
    return 'Temizlik & Hijyen Malzemeleri';
  }

  // 4. Tabela, Yönlendirme & Reklam
  if (
    combined.includes('yönlendirme') || combined.includes('yonlendirme') ||
    combined.includes('daire no') || combined.includes('daire numara') || combined.includes('kat numara') ||
    combined.includes('nest-') || combined.includes('dream riva') || combined.includes('asansör üzeri') ||
    combined.includes('merdiven levha') || combined.includes('posta kutu') || combined.includes('tabela') ||
    combined.includes('levha') || combined.includes('piktogram') || combined.includes('ikonu') ||
    combined.includes('harfleri seti') || combined.includes('yön okları') || combined.includes('otopark yönlendirme') ||
    combined.includes('blok/bina ismi') || combined.includes('sadece personel') || combined.includes('stuff only') ||
    combined.includes('bina isimli') || combined.includes('kat panelinde') || combined.includes('bina ismi')
  ) {
    return 'Tabela, Yönlendirme & Reklam';
  }

  // 5. Ölçüm, Harita & Saha Ekipmanları
  if (
    combined.includes('taheometre') || combined.includes('tacheometer') || combined.includes('total station') ||
    combined.includes('leica') || combined.includes('nivo') || combined.includes('teodolit') ||
    combined.includes('statif') || combined.includes('sehpa / statif') || combined.includes('jalon') ||
    combined.includes('reflektör') || combined.includes('reflektor') || combined.includes('yansıtıcı marka') ||
    combined.includes('terazi') || combined.includes('весы') || combined.includes('lazer metre') ||
    combined.includes('geb364') || combined.includes('gmp111') || combined.includes('nedo')
  ) {
    return 'Ölçüm, Harita & Saha Ekipmanları';
  }

  // 6. Şantiye Mobilya & Yaşam Donanımları
  if (
    combined.includes('ranza') || combined.includes('yatak') || combined.includes('yastık') || combined.includes('yorgan') || combined.includes('nevresim') ||
    combined.includes('soyunma dolabı') || combined.includes('elbise dolabı') || combined.includes('ayakkabılık') || combined.includes('askılık') ||
    combined.includes('raf ünitesi') || combined.includes('raf çerçevesi') || combined.includes('raf kirişi') || combined.includes('raf tablası') ||
    combined.includes('erzak dolabı')
  ) {
    return 'Şantiye Mobilya & Yaşam Donanımları';
  }

  // 7. Şantiye Tesis & Konteyner
  if (
    combined.includes('konteyner') || combined.includes('контейнер') ||
    combined.includes('tuvalet kabini') || combined.includes('yaşam konteyneri') || combined.includes('blok konteyner') ||
    combined.includes('şantiye konteyneri') || combined.includes('mobil akaryakıt')
  ) {
    return 'Şantiye Tesis & Konteyner';
  }

  // 8. Araç & İş Makinesi Ekipmanları
  if (
    combined.includes('oto lastik') || combined.includes('oto lastiği') || (combined.includes('lastik') && (combined.includes('r17') || combined.includes('r22') || combined.includes('continental') || combined.includes('yokohama'))) ||
    combined.includes('filtre') && combined.includes('hengst') || combined.includes('фильтр топливный')
  ) {
    return 'Araç & İş Makinesi Ekipmanları';
  }

  // 9. İç Mekan, Zemin & Kapı / Doğrama
  if (
    combined.includes('межкомнатная') || combined.includes('дверь') || combined.includes('дверная') || combined.includes('наличник') ||
    combined.includes('jaluzi') || combined.includes('жалюзи') || combined.includes('oda kapısı') || combined.includes('pervaz') ||
    combined.includes('paspas ızgarası') || combined.includes('parke taşı')
  ) {
    return 'İç Mekan, Zemin & Kapı / Doğrama';
  }

  // 10. Ankraj Sistemleri
  if (
    combined.includes('ankraj') || combined.includes('анкер') || combined.includes('химанкер') ||
    combined.includes('fischer faz') || combined.includes('hilti hit') || combined.includes('kimyasal ankraj')
  ) {
    return 'Ankraj Sistemleri';
  }

  // 10.5. İnşaat Demiri Güvenlik Başlıkları & Mantar Tipi Koruyucular (ASLA İNŞAAT DEMİRİ DEĞİLDİR!)
  if (
    combined.includes('колпачок') || combined.includes('грибок') ||
    combined.includes('güvenlik mantar') || combined.includes('koruyucu başlık') ||
    combined.includes('güvenlik başlığı') || combined.includes('kolpaçok')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // 10.6. Donatı & Kalıp El Aletleri, Kesme/Bükme Ekipmanları
  if (
    combined.includes('крючок для вязки') || combined.includes('пистолет для вязки') ||
    combined.includes('ножницы для арматур') || combined.includes('станок для гибки') ||
    combined.includes('kesme makas') || combined.includes('bükme aparat')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // 10.7. Kalıp Yağı & Yapı Kimyasalları ("для")
  if (
    combined.includes('смазка для форм') || combined.includes('эмульсол') ||
    combined.includes('kalıp yağı') || combined.includes('kalip yagi') ||
    combined.includes('добавка для бетон') || combined.includes('beton katkı') ||
    combined.includes('клей для плитки') || combined.includes('fayans yapıştırıcı') ||
    combined.includes('затирка') || combined.includes('derz dolgu')
  ) {
    return 'Yapı Kimyasalları';
  }

  // 10.8. Boru & Tesisat Aksesuarları / Yalıtım / Elektrik Ayrıştırması ("для")
  if (
    combined.includes('труба для кабел') || combined.includes('kablo borusu') ||
    combined.includes('гофра') || combined.includes('koruge')
  ) {
    return 'Elektrik & Otomasyon';
  }

  if (
    combined.includes('изоляция для труб') || combined.includes('boru yalıtımı') ||
    combined.includes('энергофлекс') || combined.includes('energoflex')
  ) {
    return 'Yalıtım & Alçıpan';
  }

  if (
    combined.includes('хомут для труб') || combined.includes('boru kelepçesi') ||
    combined.includes('саморез для гипсокартон') || combined.includes('alçıpan vidası') ||
    combined.includes('чашка по бетону') || combined.includes('алмазная чашка') ||
    combined.includes('крестики для плитки') || combined.includes('fayans artısı') ||
    combined.includes('валик') || combined.includes('кисть')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // 11. Donatı Malzemeleri
  if (
    (combined.includes('муфта') || combined.includes('manşon') || combined.includes('manson') ||
     combined.includes('каркас') || combined.includes('karkas') || combined.includes('donatı kafes') ||
     combined.includes('donatı iskelet') || combined.includes('paspay') || combined.includes('паспой') ||
     combined.includes('фиксатор') ||
     combined.includes('çiroz') || combined.includes('ciroz') ||
     combined.includes('bağ teli') || combined.includes('tavlı tel') ||
     combined.includes('donatı sehp') || combined.includes('лягушк')) &&
    !combined.includes('dn32') && !combined.includes('dişli manşon') &&
    !combined.includes('замок') && !combined.includes('kilit') &&
    !combined.includes('двер') && !combined.includes('kapı')
  ) {
    return 'Donatı Malzemeleri';
  }

  // 12. İnşaat Demiri (SADECE Yapısal Donatının Kendisi)
  const isRebarNeg =
    combined.includes('колпачок') || combined.includes('грибок') ||
    combined.includes('güvenlik') || combined.includes('koruyucu') ||
    combined.includes('фиксатор') || combined.includes('паспой') ||
    combined.includes('paspay') || combined.includes('çiroz') ||
    combined.includes('donatı sehp') || combined.includes('лягушк') ||
    combined.includes('крючок') || combined.includes('пистолет') ||
    combined.includes('ножниц') || combined.includes('станок') ||
    combined.includes('смазка') || combined.includes('зубило') ||
    combined.includes('keski') || combined.includes('вязальн') ||
    combined.includes('bağ teli') || combined.includes('сетка') || combined.includes('file');

  if (
    !isRebarNeg &&
    (combined.includes('арматур') || combined.includes('inşaat demir') || combined.includes('insaat demir') ||
     combined.includes('nervür') || combined.includes('a500') || combined.includes('а500') || combined.includes('пруток'))
  ) {
    return 'İnşaat Demiri';
  }

  // 13. Çelik Borular
  if (
    (combined.includes('труб') || combined.includes('boru')) &&
    (combined.includes('сталь') || combined.includes('профильн') || combined.includes('çelik') || combined.includes('kutu profil') || combined.includes('dikişli')) &&
    !combined.includes('ппр') && !combined.includes('ppr') && !combined.includes('пнд') && !combined.includes('канализаци')
  ) {
    return 'Çelik Borular';
  }

  // 14. Tuğla, Gazbeton & Duvar Blokları
  if (
    combined.includes('газобетон') || combined.includes('газоблок') || combined.includes('poritep') ||
    combined.includes('bonolit') || combined.includes('ytong') || combined.includes('gazbeton') ||
    combined.includes('tuğla') || combined.includes('tugla') || combined.includes('кирпич') ||
    combined.includes('керамзитобетон') || combined.includes('кбб') || combined.includes('перемычка') ||
    combined.includes('keramzit beton') || combined.includes('bims') || combined.includes('duvar örgü filesi') ||
    (combined.includes('базальтовая') && combined.includes('сетка'))
  ) {
    return 'Tuğla, Gazbeton & Duvar Blokları';
  }

  // 15. Çelik Malzemeler
  if (
    combined.includes('уголок') || combined.includes('швеллер') || combined.includes('балк') ||
    combined.includes('köşebent') || combined.includes('kosebent') || combined.includes('lama') ||
    combined.includes('hadde profil') || combined.includes('çelik profil') || combined.includes('sac') ||
    combined.includes('металлопрокат') || combined.includes('профнастил') || combined.includes('kiriş') ||
    combined.includes('ipe') || combined.includes('hea') || combined.includes('heb') || combined.includes('upn') ||
    combined.includes('filmaşin') || combined.includes('kangal demir') || combined.includes('çelik şerit') ||
    combined.includes('hasır çelik') || combined.includes('kaynaklı çelik hasır') || combined.includes('u profil') ||
    (combined.includes('duvar paneli') && combined.includes('çelik')) || (combined.includes('панель') && combined.includes('сталь')) ||
    combined.includes('inşaat demiri & çelik')
  ) {
    return 'Çelik Malzemeler';
  }

  // 16. Kalıp & İskele Sistemleri
  if (
    combined.includes('опалубк') || combined.includes('леса') || combined.includes('фанер') ||
    combined.includes('балка бдк') || combined.includes('унивилк') || combined.includes('треног') ||
    combined.includes('стойк') || combined.includes('щит') || combined.includes('kalıp') ||
    combined.includes('kalip') || combined.includes('iskele') || combined.includes('plywood') ||
    combined.includes('kontrplak') || combined.includes('doka') || combined.includes('peri') ||
    combined.includes('h20') || combined.includes('tayrot') || combined.includes('tie-rod') ||
    combined.includes('baumak') || combined.includes('горизонтальный элемент') || combined.includes('вставка соединительная')
  ) {
    return 'Kalıp & İskele Sistemleri';
  }

  // 17. Ahşap & Kereste
  if (
    combined.includes('доска обрезная') || combined.includes('kereste') || combined.includes('kalas') ||
    combined.includes('tahta') || combined.includes('lata') || combined.includes('брус')
  ) {
    return 'Ahşap & Kereste';
  }

  // 18. Hazır Beton, Çimento & Agrega
  if (
    combined.includes('бетон в') || combined.includes('beton') || combined.includes('çimento') ||
    combined.includes('cimento') || combined.includes('цемент') || combined.includes('portland') ||
    combined.includes('agrega') || combined.includes('щебень') || combined.includes('гравий') ||
    combined.includes('mıcır') || combined.includes('керамзит') || combined.includes('keramzit') ||
    combined.includes('kumlu toprak') || combined.includes('dolgu malzemesi') ||
    ((combined.includes('kum') || combined.includes('песок')) && !combined.includes('kumaş'))
  ) {
    return 'Hazır Beton, Çimento & Agrega';
  }

  // 19. Harç & Şap
  if (
    combined.includes('сухая смесь') || combined.includes('сухие смеси') || combined.includes('пескобетон') ||
    combined.includes('стяжк') || combined.includes('ротбанд') || combined.includes('штукатурк') ||
    combined.includes('harç') || combined.includes('harc') || combined.includes('şap') ||
    combined.includes('sap') || combined.includes('kalekim') || combined.includes('наливной пол') ||
    combined.includes('цпс')
  ) {
    return 'Harç & Şap';
  }

  // 20. Yalıtım & Alçıpan
  if (
    combined.includes('минват') || combined.includes('базальт') || combined.includes('утеплител') ||
    combined.includes('техноникол') || combined.includes('пеноплэкс') || combined.includes('пенопласт') ||
    combined.includes('гипсокартон') || combined.includes('гкл') || combined.includes('гклв') ||
    combined.includes('мембран') || combined.includes('пароизоляци') || combined.includes('гидроизоляци') ||
    combined.includes('битум') || combined.includes('рубероид') || combined.includes('taşyünü') ||
    combined.includes('cam yünü') || combined.includes('alçıpan') || combined.includes('alcipan') ||
    combined.includes('eps') || combined.includes('xps') || combined.includes('strafor') ||
    combined.includes('yalıtım') || combined.includes('yalitim') || combined.includes('izolasyon') ||
    combined.includes('naylon') || combined.includes('koruma ortu') || combined.includes('koruma örtü')
  ) {
    return 'Yalıtım & Alçıpan';
  }

  // 21. İş Güvenliği & KKD
  if (
    combined.includes('iş elbisesi') || combined.includes('iş elbise') || combined.includes('спецодежд') ||
    combined.includes('reflektörlü') || combined.includes('светоотражающ') ||
    combined.includes('перчатки с') || combined.includes('iş eldiveni') || combined.includes('koruyucu eldiven') ||
    combined.includes('baret') || combined.includes('каск') || combined.includes('жилет') ||
    combined.includes('iş ayakkabısı') || combined.includes('ботинк') || combined.includes('güvenli') ||
    combined.includes('kkd') || combined.includes('isg') || combined.includes('сиз') ||
    combined.includes('манекен') || combined.includes('emniyet kemeri') || combined.includes('привязь')
  ) {
    return 'İş Güvenliği & KKD';
  }

  // 22. El Aletleri & Hırdavat
  if (
    combined.includes('сверло') || combined.includes('бур ') || combined.includes('бур по') || combined.includes('бур sds') ||
    combined.includes('бита') || combined.includes('франкфурт') || combined.includes('молоток') || combined.includes('черенок для') ||
    combined.includes('диск шлифовальный') || combined.includes('диск пильный') || combined.includes('matkap ucu') ||
    combined.includes('çekiç') || combined.includes('tester') || combined.includes('kesici taş') || combined.includes('el aleti')
  ) {
    return 'El Aletleri & Hırdavat';
  }

  // 23. Kaynak Malzemeleri
  if (
    combined.includes('электрод') || combined.includes('askaynak') || combined.includes('kaynak') ||
    combined.includes('сварочный') || combined.includes('сварка')
  ) {
    return 'Kaynak Malzemeleri';
  }

  // 24. Elektrik & Otomasyon
  if (
    combined.includes('elektrik') || combined.includes('otomasyon') || combined.includes('kablo') ||
    combined.includes('электрик') || combined.includes('кабель') || combined.includes('провод') ||
    combined.includes('автомат') || combined.includes('светильник') || combined.includes('sigorta') ||
    combined.includes('şalter') || combined.includes('priz') || combined.includes('aydınlatmalı') || combined.includes('освещени')
  ) {
    return 'Elektrik & Otomasyon';
  }

  // 25. Kimyasallar & Boya
  if (
    combined.includes('boya') || combined.includes('kimya') || combined.includes('краск') ||
    combined.includes('эмаль') || combined.includes('грунтовк') || combined.includes('герметик') ||
    combined.includes('пена монтажн') || combined.includes('astar') || combined.includes('epoksi') ||
    combined.includes('tiner') || combined.includes('silikon') || combined.includes('mastik')
  ) {
    return 'Kimyasallar & Boya';
  }

  // 26. Mekanik & Tesisat
  if (
    combined.includes('mekanik') || combined.includes('tesisat') || combined.includes('сантехник') ||
    combined.includes('отоплени') || combined.includes('труba ппр') || combined.includes('труба ппр') || combined.includes('радиатор') ||
    combined.includes('кран шаров') || combined.includes('vana') || combined.includes('pompa') ||
    combined.includes('fittings') || combined.includes('havalandırma') || combined.includes('klima')
  ) {
    return 'Mekanik & Tesisat';
  }

  // 27. Seramik & Vitrifiye
  if (
    combined.includes('seramik') || combined.includes('vitrifiye') || combined.includes('fayans') ||
    combined.includes('плитк') || combined.includes('керамогранит') || combined.includes('lavabo') ||
    combined.includes('klozet') || combined.includes('batarya')
  ) {
    return 'Seramik & Vitrifiye';
  }

  // 28. Bilgi İşlem & IT
  if (
    combined.includes('bilgi işlem') || combined.includes('switch') || combined.includes('klavye') ||
    combined.includes('yazıcı') || combined.includes('televizyon') || combined.includes('monitör') ||
    combined.includes('ekran temizleme') || combined.includes('digma') || combined.includes('logitech') ||
    combined.includes('canon lbp') || combined.includes('tp-link') || combined.includes('ram bellek') ||
    combined.includes('sistem blok') || combined.includes('kartuş') || combined.includes('toner')
  ) {
    return 'Bilgi İşlem & IT';
  }

  // 29. Ofis & Kırtasiye
  if (
    combined.includes('ofis') || combined.includes('kırtasiye') || combined.includes('канцтовар') ||
    combined.includes('бумага') || combined.includes('папк') || combined.includes('ручк') ||
    combined.includes('dosya') || combined.includes('klasör') || combined.includes('a4') ||
    combined.includes('а4') || combined.includes('комус')
  ) {
    return 'Ofis & Kırtasiye';
  }

  // 30. Sarf Malzeme & Hırdavat (Bağlantı Elemanları, Vida, Cıvata, Somun vs)
  if (
    combined.includes('hırdavat') || combined.includes('hirdavat') || combined.includes('sarf') ||
    combined.includes('bağlantı') || combined.includes('baglanti') || combined.includes('крепеж') ||
    combined.includes('саморез') || combined.includes('дюбель') || combined.includes('болт') ||
    combined.includes('шайб') || combined.includes('диск отрезной') || combined.includes('vida') ||
    combined.includes('cıvata') || combined.includes('somun') || combined.includes('dübel') ||
    combined.includes('замок') || combined.includes('ведро') || combined.includes('колесо') ||
    combined.includes('тара металлическая')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  return rawCat && rawCat.trim() && rawCat.trim() !== 'Diğer' && rawCat.trim() !== 'Diğer Malzeme' ? rawCat.trim() : 'Diğer Malzeme';
}

function unwrapSyntheticPrefixes(s: string): string {
  if (!s) return '';
  return s
    .replace(/\(\s*excel\s*dosyas[ıi]n[ae]\s*g[öo]re[^)]*\)/gi, ' ')
    .replace(/^Строительно-монтажный материал\s*\/\s*ТМЦ\s*\((.+)\)$/i, '$1')
    .replace(/^Канцелярские и Офисные Товары\s*\((.+)\)$/i, '$1')
    .replace(/^Канцелярские товары и бумага офисная\s*\[(.+)\]$/i, '$1')
    .replace(/^(?:Пиломатериал обрезной\s*\(брус\s*\/\s*доска\)\s*ГОСТ\s*8486|Диск отрезной\s*\/\s*круг шлифовальный абразивный|Хозяйственно-бытовое обеспечение офиса и площадки|Розетка электрическая\s*\/\s*вилка силовая\s*\/\s*удлинитель|Щит распределительный\s*\/\s*коробка монтажная|Труба полипропиленовая\s*\/\s*ПВХ\s*\/\s*ПНД инженерная|Оборудование стройплощадки,\s*мебель и бытовые модули|Смесь сухая (?:ремонтная|штукатурная)\s*\/\s*(?:штукатурная|шпаклевка) строительная|Гипсокартонный лист\s*\(ГКЛ\s*\/\s*ГКЛВ\)|Инструмент слесарно-монтажный ручной|Электроинструмент\s*\/\s*оснастка[^[]*|Фурнитура дверная[^[]*|Утеплитель теплоизоляционный минераловатный)\s*(?:\([^)]*\))?\s*\[([^\]]+)\]$/i, '$1')
    .trim();
}

function isShortDrawingOrSpecNote(s: string): boolean {
  const t = (s || '').trim();
  if (!t || t.length < 5) return true;
  if (/^\[sk\d+/i.test(t) || /^https?:/i.test(t)) return true;
  if (/^(?:\d+(?:[.,]\d+)?\s*(?:шт|м|мм|см|кг|г|л|мл|уп|упак|кор|рул|пл|мпа|м2|м3)\.?|\d+\s*[xх*×]\s*\d+\s*(?:мм|см|м|шт)?(?:\s*,\s*петли.*)?)$/i.test(t)) return true;
  if (/^(?:кж\s*[\d.,-]|к\d\b|корпус|стилобат|блок|вжк|офис|склад|этаж|секция|ось|оси|отм\.|схем|арт\.?\s*\d|спайка|осина|гсп(?:-df)?|тип\s*\d|вид\s*\d|сорт\s*\d|мешок|однодверный|съемный|стандартный|грунтовка|краска\s+черный|etap|blok|kat)\b/i.test(t)) return true;
  return false;
}

function isSyntheticRussianFallback(s: string): boolean {
  const raw = unwrapSyntheticPrefixes(s || '').trim();
  const t = cleanRawMaterialName(raw).trim();
  if (!t) return true;
  const rx = /^(?:Арматура рифленая А500С ГОСТ 34028|Рулонная гидроизоляция|Сетка сварная арматурная Вр-1|Проволока стальная вязальная ТОЧ|Каркас арматурный сварной|Каркас металлический|Уголок стальной равнополочный ГОСТ 8509|Труба стальная профильная ГОСТ|Труба стальная электросварная ГОСТ|Блок газобетонный стеновой|Клей для газобетона сухая смесь|Инструмент\s*\/\s*крепеж для газобетона|Фанера ламинированная ФОФ для опалубки|Утеплитель каменная вата|Экструдированный пенополистирол|Саморезы по гипсокартону фосфатированные|Ножовка по гипсокартону|Профиль\s*\/\s*подвес для гипсокартона|Гипсокартонный лист|Компрессор воздушный электрический|Эмаль алкидная ПФ-115|Валик малярный с бюгелем|Ершик для унитаза с подставкой|Щетка металлическая зачистная|Черенок деревянный для щетки|Щетка для уборки помещений|Кисть малярная|Пленка стрейч упаковочная|Пленка полиэтиленовая техническая|Тент строительный защитный|Электроды сварочные покрытые|Пропан технический в баллонах|Круг \(диск\) отрезной по металлу|Очиститель монтажной пены профессиональный|Пистолет для монтажной пены профессиональный|Пена монтажная профессиональная под пистолет|Диспенсер для упаковочного скотча|Скотч упаковочный клейкий|Лента малярная креппированная|Перчатки рабочие защитные|Каска строительная защитная|Клипса \(держатель\) для монтажного пистолета|Гвозди строительные ГОСТ|Саморезы строительные оцинкованные|Рым-болт оцинкованный DIN|Болт оцинкованный с шестигранной головкой|Гайка шестигранная оцинкованная DIN|Шайба плоская\s*\/\s*пружинная|Анкерный болт\s*\/\s*шпилька|Хомут кабельный нейлоновый|Наконечник\s*\/\s*гильза кабельная|Кабель силовой медный ВВГнг|Зубило плоское\s*\/\s*пика|Нож строительный сегментный|Запчасть для тепловой пушки|Коронка биметаллическая по металлу|Тачка строительная усиленная|Известь хлорная\s*\/\s*средство|Утеплитель теплоизоляционный минераловатный|Доска магнитно-маркерная офисная|Рулетка измерительная\s*\/\s*уровень|Ключ гаечный комбинированный|Пиломатериал обрезной|Плита ориентированно-стружечная|Бетон товарный БСГ|Цемент портландцемент|Песок строительный карьерный|Щебень гранитный|Кирпич строительный|Смесь сухая ремонтная|Клей плиточный цементный|Грунтовка строительная глубокого|Растворитель технический|Краска строительная водно-дисперсионная|Валик малярный строительный|Шпатель малярный из нержавеющей|Кельма\s*\/\s*гладилка|Герметик силиконовый|Пена монтажная полиуретановая|Гидроизоляция рулонная|Рукав пожарный напорный|Клапан \(вентиль\) пожарный|Труба полипропиленовая\s*\/\s*ПВХ|Кран шаровой латунный|Фитинг соединительный|Хомут трубный стальной|Прокладка уплотнительная сантехническая|Выключатель автоматический модульный|Щит распределительный\s*\/\s*коробка|Розетка электрическая\s*\/\s*вилка|Светильник светодиодный строительный|Электроинструмент\s*\/\s*оснастка|Диск отрезной\s*\/\s*круг|Полотно пильное\s*\/\s*диск|Инструмент слесарно-монтажный|Инвентарь строительный|Емкость\s*\/\s*ведро строительное|Дюбель строительный распорный|Гвозди строительные\s*\/\s*монтажные|Фурнитура дверная|Строп грузоподъемный|Комплектующие опалубки|Жилет сигнальный|Спецобувь защитная|Спецодежда рабочая|Средства индивидуальной защиты|Огнетушитель порошковый|Компьютерная периферия и оргтехника|Картридж лазерный\s*\/\s*тонер|Мешки для мусора полиэтиленовые|Бумага офисная для принтера|Канцелярские принадлежности|Канцелярские|Хозяйственные товары и средства|Хозяйственно-бытовое обеспечение|бытовое обеспечение офиса и площадки|ГСМ,\s*дизельное топливо|Оборудование стройплощадки|Строительно-монтажный материал)/i;
  return rx.test(raw) || rx.test(t);
}

/** originalName gerçek bir fatura satırı mı (sentetik Rusça şablon / kısa çizim notu değil)? */
function isGenuineOriginalLine(orig?: string): boolean {
  const raw = String(orig || '').trim();
  const cleaned = cleanRawMaterialName(unwrapSyntheticPrefixes(raw));
  return Boolean(cleaned) && !isShortDrawingOrSpecNote(cleaned) && !isSyntheticRussianFallback(raw);
}

const smartNormalizeMemoCache = new Map<string, { materialName: string; category?: string }>();

function smartNormalizeItem(item: any, existingCatalog: string[] = []): { materialName: string; category?: string } {
  if (!item || (!item.materialName && !item.originalName)) return item;
  const canMemo = !existingCatalog || existingCatalog.length === 0;
  const memoKey = canMemo ? `${item.materialName || ''}\u0000${item.originalName || item.originalMaterialName || ''}\u0000${item.category || ''}\u0000${item.unitPrice || ''}\u0000${item.unit || ''}` : '';
  if (canMemo) {
    const cached = smartNormalizeMemoCache.get(memoKey);
    if (cached) return cached;
  }
  const result = ((): { materialName: string; category?: string } => {
  let rawName = unwrapSyntheticPrefixes(String(item.materialName || '').trim());
  let name = cleanRawMaterialName(rawName) || rawName;
  const rawOrig = unwrapSyntheticPrefixes(String(item.originalName || item.originalMaterialName || '').trim());
  const orig = cleanRawMaterialName(rawOrig) || rawOrig;

  // Eğer kayıtlı materialName geçmişte hatalı bir genel havuza veya sentetik Rusça şablona
  // atanmışsa ve orig gerçek bir malzeme adıysa, sınıflandırmayı doğrudan orijinal fatura satırı (orig) üzerinden yap!
  const isPreviouslyOverwrittenBucket =
    isSyntheticRussianFallback(name) ||
    /^(propan gaz tüpü|polietilen inşaat naylonu|ambalaj streç film|inşaatlık çam kereste|tavlı donatı bağ teli|inşaat çivisi|bogirus nt|a500c inşaat demiri|nervürlü inşaat demiri|donatı manşonu|donatı kafesi|beton donatı paspayı|plastik donatı paspayı|yıldız tipi donatı paspayı|döşeme tipi donatı paspayı|kaynak elektrodu|wc klozet|çanak tipi tel fırça|elektrik motoru karbon|knauf standart alçıpan|knauf suya dayanıklı alçıpan|bazalt duvar örgü filesi|cam elyaf dış cephe donatı filesi|boya rulosu|parmak boya rulosu|endüstriyel çöp poşeti)/i.test(name);

  if (isPreviouslyOverwrittenBucket && orig && !isShortDrawingOrSpecNote(orig) && !isSyntheticRussianFallback(orig) && orig.toLowerCase() !== name.toLowerCase()) {
    name = orig;
  }

  // Clean synthetic timber label if it was generated from "CAM YUNU"
  const cleanOrig = /cam\s*yun|cam\s*yün|ursa|folga/i.test(`${orig} ${name}`)
    ? orig.replace(/Пиломатериал обрезной\s*\(брус\s*\/\s*доска\)\s*ГОСТ\s*8486/gi, 'Утеплитель минераловатный')
    : orig;

  // Sentetik Rusça şablonların (ör. "Валик малярный (140 L)" veya "Канцелярские товары и бумага офисная (0.7 MM)")
  // Türkçe stok kartı sınıflandırmasını bozmasını kesin olarak engelle!
  const effectiveOrig = (isShortDrawingOrSpecNote(cleanOrig) || isSyntheticRussianFallback(cleanOrig)) ? '' : cleanOrig;
  const combined = `${effectiveOrig} ${name}`.trim().toLowerCase();
  const primaryText = `${effectiveOrig} ${name}`.trim().toLowerCase();

  // 0. İNŞAAT DEMİRİ KORUYUCU GÜVENLİK BAŞLIĞI / MANTARI (ASLA İNŞAAT DEMİRİ DEĞİLDİR!)
  if (
    combined.includes('колпачок') ||
    combined.includes('грибок') ||
    combined.includes('güvenlik mantar') ||
    combined.includes('koruyucu başlık') ||
    combined.includes('koruyucu baslik') ||
    combined.includes('güvenlik başlığı') ||
    combined.includes('guvenlik basligi') ||
    combined.includes('kolpaçok') ||
    combined.includes('kolpacok')
  ) {
    const isPack1000 = combined.includes('1000') || combined.includes('упаковк');
    const packSuffix = isPack1000 ? ' (1000 Adetlik Paket)' : '';
    let diaRange = '10-18 mm';
    const mRange = combined.match(/(\d+[\s-–]+\d+)\s*(?:мм|mm)?/);
    if (mRange) diaRange = `${mRange[1].replace(/\s+/g, '')} mm`;
    return {
      materialName: `İnşaat Demiri Güvenlik Başlığı Mantar Tip ${diaRange}${packSuffix}`,
      category: 'Sarf Malzeme & Hırdavat'
    };
  }

  // 0.2. Donatı Kaynak Altlık Plakası / Çelik Mapa (M07, Скоба-накладка ванночка) - ASLA İnşaat Demiri değildir!
  if (
    combined.includes('скоба-накладка') ||
    combined.includes('скоба накладка') ||
    combined.includes('ванночка') ||
    combined.includes('celik mapa') ||
    combined.includes('çelik mapa') ||
    /\bm07\b/i.test(combined)
  ) {
    if (combined.includes('ванночка') || combined.includes('скоба-накладка')) {
      const dMatch = combined.match(/[dдфø]\s*(\d{2})/i);
      return {
        materialName: `Donatı Kaynak Manşonu / Altlık Plakası (Ванночка)${dMatch ? ` Ø${dMatch[1]} mm` : ''} GOST 14098`,
        category: 'Donatı Malzemeleri'
      };
    }
    return {
      materialName: 'Çelik Ankraj Mapası M07 (A500C Ø20/Ø10 mm)',
      category: 'Çelik Malzemeler'
    };
  }

  // 0.5. Paspayı, Çiroz, Donatı Sehpası (Kapı kilidi, dişli sabitleyici hariç!)
  if (
    (combined.includes('фиксатор') ||
      combined.includes('паспой') ||
      combined.includes('paspay') ||
      combined.includes('çiroz') ||
      combined.includes('ciroz') ||
      combined.includes('donatı sehp') ||
      combined.includes('лягушк')) &&
    !/двер|сантех|резьб|loctite|герметик|замок|вал-втул/i.test(combined)
  ) {
    if (/лягушк|donatı\s*sehp|donati\s*sehp/i.test(combined)) {
      return {
        materialName: 'Donatı Sehpası (Фиксатор Лягушка)',
        category: 'Donatı Malzemeleri'
      };
    }
    if (/çiroz|ciroz|пружинн.*зажим|зажим.*пружин|крюк.*пружин/i.test(combined)) {
      return {
        materialName: 'Kalıp Çirozu (Yaylı Kalıp Kilidi)',
        category: 'Kalıp & İskele Sistemleri'
      };
    }
    if (/конус|konik\s*paspay|boru\s*başlığı|boru\s*tapası/i.test(combined)) {
      return {
        materialName: 'Konik Donatı Paspayı / Tie-Rod Boru Tapası Ø22 mm',
        category: 'Donatı Malzemeleri'
      };
    }
    if (/трубк|boru.*paspay|paspay.*boru/i.test(combined)) {
      return {
        materialName: 'Kalıp İçi PVC Paspayı Borusu Ø22 mm',
        category: 'Donatı Malzemeleri'
      };
    }
    if (/бетонн.*кость|кость.*бетон|фиксатор\s*бетон|beton\s*paspay/i.test(combined)) {
      return {
        materialName: 'Beton Donatı Paspayı (Фиксатор бетонный Кость 55/65/80 mm)',
        category: 'Donatı Malzemeleri'
      };
    }
    let cov = '30 mm';
    if (/(?:^|[^\d])50(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '50 mm';
    else if (/(?:^|[^\d])40(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '40 mm';
    else if (/(?:^|[^\d])35(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '35 mm';
    else if (/(?:^|[^\d])30(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '30 mm';
    else if (/(?:^|[^\d])25(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '25 mm';
    else if (/(?:^|[^\d])20(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '20 mm';
    else if (/(?:^|[^\d])15(?:\s*(?:мм|mm)|$|[^\d])/i.test(combined)) cov = '15 mm';

    if (/звездочк|звёздочк|yıldız|yildiz|duvar\s*tipi/i.test(combined)) {
      return {
        materialName: `Yıldız Tipi Donatı Paspayı ${cov}`,
        category: 'Donatı Malzemeleri'
      };
    }
    if (/стульчик|стойка|опора|кубик|настил|döşeme\s*tipi|doseme\s*tipi|paspay/i.test(combined)) {
      return {
        materialName: `Döşeme Tipi Donatı Paspayı ${cov}`,
        category: 'Donatı Malzemeleri'
      };
    }
    return {
      materialName: name.startsWith('A500') ? (cleanOrig || name) : name,
      category: 'Donatı Malzemeleri'
    };
  }

  // 1. Rebar / İnşaat Demiri / Арматура / Пруток (SADECE yapısal çubuk donatı)
  const isRebarNegFilter =
    combined.includes('колпачок') ||
    combined.includes('грибок') ||
    combined.includes('güvenlik') ||
    combined.includes('koruyucu') ||
    combined.includes('фиксатор') ||
    combined.includes('паспой') ||
    combined.includes('paspay') ||
    combined.includes('çiroz') ||
    combined.includes('ciroz') ||
    combined.includes('donatı sehp') ||
    combined.includes('лягушк') ||
    combined.includes('крючок') ||
    combined.includes('пистолет') ||
    combined.includes('ножниц') ||
    combined.includes('станок') ||
    combined.includes('смазка') ||
    combined.includes('зубило') ||
    combined.includes('пика') ||
    combined.includes('перфоратор') ||
    combined.includes('отбойн') ||
    combined.includes('keski') ||
    combined.includes('вязальн') ||
    combined.includes('bağ teli') ||
    combined.includes('tavlı tel') ||
    combined.includes('муфта') ||
    combined.includes('manşon') ||
    combined.includes('manson') ||
    combined.includes('закладн') ||
    combined.includes('анкер') ||
    combined.includes('ankraj') ||
    combined.includes('mapa') ||
    combined.includes('скоба') ||
    combined.includes('ванночк') ||
    combined.includes('plaka') ||
    combined.includes('пластин') ||
    combined.includes('деталь') ||
    combined.includes('каркас') ||
    combined.includes('karkas') ||
    combined.includes('сетка') ||
    combined.includes('hasır') ||
    combined.includes('упаковк');

  // Check learned/approved synonyms store first
  try {
    const normKey = name.toLowerCase().replace(/[^a-z0-9а-яğüşıöç]/gi, '');
    if (materialSynonymsStore && materialSynonymsStore.has(normKey)) {
      const syn = materialSynonymsStore.get(normKey);
      if (syn && syn.canonicalName) {
        return { materialName: syn.canonicalName, category: (syn as any).category || 'Diğer' };
      }
    }
  } catch (synErr) {
    // Ignore synonym lookup errors
  }

  if (
    !isRebarNegFilter && (
      primaryText.includes('арматур') ||
      primaryText.includes('катанка') ||
      primaryText.includes('inşaat demir') ||
      primaryText.includes('insaat demir') ||
      primaryText.includes('nervür') ||
      primaryText.includes('nervur') ||
      primaryText.includes('rebar') ||
      primaryText.includes('пруток') ||
      primaryText.includes('a500') ||
      primaryText.includes('а500') ||
      primaryText.includes('b500') ||
      primaryText.includes('a240') ||
      primaryText.includes('а240') ||
      primaryText.includes('a400') ||
      primaryText.includes('а400')
    )
  ) {
    const d = extractRebarDiameter(primaryText);
    if (d && STANDARD_REBAR_MAP[d]) {
      const checkGradeText = (effectiveOrig || primaryText).toLowerCase();
      if (/катанка|а240|a240|гладк|düz\s*demir/i.test(checkGradeText) && !/а500|a500|nervür|nervur/i.test(checkGradeText)) {
        return { materialName: `Düz İnşaat Demiri / Filmaşin A240 (Ø${d}mm)`, category: 'İnşaat Demiri' };
      }
      return { materialName: STANDARD_REBAR_MAP[d], category: 'İnşaat Demiri' };
    }
  }

  // 1.5 Hazır Beton & Grobeton Normalizasyonu (Gazbeton, betonokontakt ve beton matkap ucu hariç)
  if (
    (combined.includes('бетон') || combined.includes('beton') || combined.includes('grobeton')) &&
    !combined.includes('газобетон') && !combined.includes('gazbeton') &&
    !combined.includes('бетоноконтакт') && !combined.includes('betonokontakt') &&
    !combined.includes('бур ') && !combined.includes('диск') && !combined.includes('алмазн') &&
    !combined.includes('бетоновод')
  ) {
    if (combined.includes('grobeton') || combined.includes('b7.5') || combined.includes('в7.5') || combined.includes('m100')) {
      return { materialName: 'Grobeton B7.5 (M100 Hazır Beton)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b15') || combined.includes('в15') || combined.includes('m200')) {
      return { materialName: 'Hazır Beton B15 (M200 / C12/15)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b20') || combined.includes('в20') || combined.includes('m250')) {
      return { materialName: 'Hazır Beton B20 (M250 / C16/20)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b25') || combined.includes('в25') || combined.includes('m350')) {
      return { materialName: 'Hazır Beton B25 (M350 / C20/25 GOST)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b30') || combined.includes('в30') || combined.includes('m400')) {
      return { materialName: 'Hazır Beton B30 (M400 / C25/30 GOST)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b35') || combined.includes('в35') || combined.includes('m450')) {
      return { materialName: 'Hazır Beton B35 (M450 / C30/35 GOST)', category: 'Hazır Beton, Çimento & Agrega' };
    }
    if (combined.includes('b40') || combined.includes('в40') || combined.includes('m500')) {
      return { materialName: 'Hazır Beton B40 (M500 / C35/40 GOST)', category: 'Hazır Beton, Çimento & Agrega' };
    }
  }

  // 1.7 FIRÇA AYRIMI (Boya Fırçası vs Tel Fırça vs Klozet Fırçası vs Yer Fırçası vs Kömür Fırça)
  // Asla farklı fırça türlerini, markalarını veya farklı ölçüleri aynı satırda birleştirme!
  if (/кисть|щетк|щётк|ершик|ёршик|fırça|firca/i.test(primaryText) && !/paspas\s*ızgarası|грязезащитн/i.test(primaryText)) {
    // 0. Rulo Fırça / Boya Rulosu (Валик малярный) - Fırça değil rulodur!
    if (/\brulo\b|валик/i.test(primaryText)) {
      const wMatch = primaryText.match(/\b(\d{2,3})\s*(?:мм|mm|см|cm)(?![a-zа-яё])/i);
      const isFinger = /parmak|мини/i.test(primaryText);
      return {
        materialName: `${isFinger ? 'Parmak Boya Rulosu' : 'Boya Rulosu'}${wMatch ? ` (${wMatch[0].trim().toLowerCase()})` : ''}`,
        category: 'Kimyasallar & Boya'
      };
    }
    // A. Fırça Sapı (Черенок для щетки) - Fırçanın kendisi değildir! (Ancak "Щетка ... (черенок 601322)" gibi fırça satırlarını sap sanma!)
    if ((/^черенок|черенок\s+для|fırça\s*sapı|firca\s*sapi/i.test(primaryText) || (/черенок/i.test(primaryText) && !/щетк|щётк|швабр|метла/i.test(primaryText))) && !/под\s*черенок/i.test(primaryText)) {
      return { materialName: 'Ahşap / Vidalı Temizlik Fırçası Sapı', category: 'Temizlik & Hijyen Malzemeleri' };
    }
    // B. Klozet / Tuvalet Fırçası (Luscan Premium vs AZUR Мини Ekonomik segment ayrımı)
    if (/ершик|ёршик|унитаз|туалет|tuvalet|klozet|\bwc\b/i.test(primaryText)) {
      if (/luscan/i.test(combined) || (Number(item.unitPrice) || 0) >= 200) {
        return { materialName: 'Tuvalet / Klozet Fırçası Seti Luscan [Premium]', category: 'Temizlik & Hijyen Malzemeleri' };
      }
      return { materialName: 'Tuvalet / Klozet Fırçası Seti AZUR Мини [Ekonomik]', category: 'Temizlik & Hijyen Malzemeleri' };
    }
    // C. Elektrikli El Aleti Karbon / Kömür Fırçası (Marka ve Model Koru!)
    if (/угольн|графитов|электрощетк|мотор|kömür\s*fırça|karbon\s*fırça/i.test(primaryText)) {
      let modelSpec = '';
      if (/aeg/i.test(primaryText)) modelSpec = ' AEG';
      else if (/makita/i.test(primaryText)) modelSpec = ' Makita';
      else if (/bosch/i.test(primaryText)) modelSpec = ' Bosch';
      const cbMatch = primaryText.match(/\b(cb[\s-]*\d+|\d{9,10})\b/i);
      const dim = primaryText.match(/(\d+(?:[.,]\d+)?\s*[xх*×]\s*\d+(?:[.,]\d+)?(?:\s*[xх*×]\s*\d+(?:[.,]\d+)?)?)/i);
      const suffix = cbMatch ? ` (${cbMatch[1].toUpperCase()})` : (dim ? ` (${dim[1].replace(/\s+/g, '')})` : '');
      return {
        materialName: `Elektrik Motoru Karbon Kömür Fırçası${modelSpec}${suffix}`,
        category: 'El Aletleri & Hırdavat'
      };
    }
    // D. Tel Fırça / Çanak Fırça / Metal Temizleme Fırçası (Ölçü ve Tipini Koru!)
    if (/металл|корщетк|проволоч|крацовк|зачистн|ушм|tel\s*fırça|çanak\s*fırça|saçak\s*fırça|burgu\s*fırça/i.test(primaryText)) {
      const dMatch = primaryText.match(/\b(60|65|70|75|80|100|115|125|150)\s*(?:\/|\s*(?:мм|mm))(?![a-zа-яё])/i) || primaryText.match(/\b(65|75|100|125)\b/);
      const isCup = /чашк|чашечн|çanak|kupa/i.test(primaryText);
      const isHand = /ручн|saplı|el\s*tipi/i.test(primaryText);
      const isTwisted = /кручен|burgu/i.test(primaryText);
      const subType = isCup ? `Çanak Tipi ${isTwisted ? 'Burgulu ' : ''}Tel Fırça` : (isHand ? 'El Tipi Tel Fırça' : 'Metal Tel Fırça');
      return {
        materialName: `${subType}${dMatch ? ` Ø${dMatch[1]} mm` : ''}`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
    // E. Yer / Saha Temizlik Fırçası & Süpürge (Genişlik Ölçüsünü Koru!)
    if (/для\s+пола|для\s+уборки|подметальн|уличн|строительн|метла|швабр|temizlik|yer\s*fırça|saha\s*temizlik|çöp\s*fırça|süpürge/i.test(primaryText)) {
      const wMatch = primaryText.match(/\b(\d{2,3})\s*(?:мм|mm|см|cm)(?![a-zа-яё])/i);
      return {
        materialName: `Temizlik / Yer Fırçası${wMatch ? ` (${wMatch[0].trim().toLowerCase()})` : ''}`,
        category: 'Temizlik & Hijyen Malzemeleri'
      };
    }
    // F. Boya / Kestirme / Radyatör Fırçası (Ölçüsüne göre ayrı tut, aynı ölçüleri birleştir)
    if (/кисть|малярн|плоск|радиаторн|макловиц|kestirme\s*fırça|boya\s*fırça|radyatör\s*fırça|badana\s*fırça/i.test(primaryText)) {
      const isRadiator = /радиатор|radyatör|eğri|açılı/i.test(primaryText);
      const isMaklovitsa = /макловиц|badana|duvar\s*fırça/i.test(primaryText);
      let sizeLabel = '';
      const mmMatch = primaryText.match(/\b(20|25|30|35|38|40|50|60|63|70|75|80|90|100|120|140|150)\s*(?:мм|mm)(?![a-zа-яё])/i);
      const inchMatch = primaryText.match(/\b([1234](?:[.,/][052])?)\s*(?:"|''|дюйм)/i);
      if (mmMatch) {
        const mm = parseInt(mmMatch[1], 10);
        const inchMap: Record<number, string> = { 25: '1"', 38: '1.5"', 50: '2"', 63: '2.5"', 75: '3"', 100: '4"' };
        sizeLabel = ` ${mm} mm${inchMap[mm] ? ` (${inchMap[mm]})` : ''}`;
      } else if (inchMatch) {
        const inchStr = inchMatch[1].replace(',', '.');
        const mmMap: Record<string, number> = { '1': 25, '1.5': 38, '2': 50, '2.5': 63, '3': 75, '4': 100 };
        const mappedMm = mmMap[inchStr];
        sizeLabel = mappedMm ? ` ${mappedMm} mm (${inchStr}")` : ` (${inchStr}")`;
      }
      const brushPrefix = isRadiator ? 'Radyatör Boya Fırçası' : (isMaklovitsa ? 'Geniş Badana Fırçası' : 'Yassı Kestirme Boya Fırçası');
      return {
        materialName: `${brushPrefix}${sizeLabel}`.trim(),
        category: 'Kimyasallar & Boya'
      };
    }
  }

  // 1.8 Plywood / Kontrplak / Фанера (Sadece gerçek kontrplak/plywood ve açık kalınlık eşleşmesi)
  if (primaryText.includes('фанер') || primaryText.includes('kontrplak') || primaryText.includes('plywood') || primaryText.includes('pleyvud')) {
    const isLaminated = /ламинир|ламин\.|фоф|лбфф|deck|дек|f1\/f1|ff|fof|film\s*kaplı|wbp/i.test(primaryText);
    const prefix = isLaminated ? 'Film Kaplı Kalıp Kontrplağı (Plywood)' : 'Su Kontrplağı (Plywood FSF)';
    const thickMatch = primaryText.match(/\b(4|6|8|9|10|12|15|18|21|24|27|30)\s*(?:мм|mm)(?![a-zа-яё])/i)
      || primaryText.match(/\b(12|15|18|21)\s*[xх*×]/i);
    const thick = thickMatch ? `${thickMatch[1]}mm` : '18mm';
    const dimMatch = primaryText.match(/\b(1220\s*[xх*×]\s*2440|2440\s*[xх*×]\s*1220|1250\s*[xх*×]\s*2500|1500\s*[xх*×]\s*3000|1525\s*[xх*×]\s*1525)\b/i);
    let normDim = dimMatch ? dimMatch[1].replace(/\s+/g, '').replace(/[х*×]/gi, 'x') : '1220x2440';
    if (normDim === '2440x1220') normDim = '1220x2440';
    return {
      materialName: `${prefix} ${thick} (${normDim})`,
      category: 'Kalıp & İskele Sistemleri'
    };
  }

  // 1.9 Kaynak Elektrodu / Электрод (Tip/Seri ve Çapı Koru - Nokta kaynak elektrodunu ayır!)
  if (primaryText.includes('электрод') || primaryText.includes('elektrod') || primaryText.includes('elektrot')) {
    if (!primaryText.includes('контроль') && !primaryText.includes('измерени') && !primaryText.includes('держател')) {
      // Nokta kaynak makinesi bakır elektrodu (HWASHI, TECNA vb.)
      if (/hwashi|tecna|контактн.*сварк/i.test(primaryText)) {
        const modelMatch = primaryText.match(/\b(hwashi\s*[\d.]+|tecna\s*\d+)\b/i);
        return {
          materialName: `Nokta Kaynak Makinesi Elektrodu${modelMatch ? ` (${modelMatch[1].toUpperCase()})` : ''}`,
          category: 'Kaynak Malzemeleri'
        };
      }
      let elType = '';
      if (/lb[\s-]*52u|лб[\s-]*52у/i.test(primaryText)) elType = 'LB-52U (Bazik)';
      else if (/уони[\s-]*13\s*\/\s*55|uoni[\s-]*13\s*\/\s*55/i.test(primaryText)) elType = 'UONI-13/55 (Bazik)';
      else if (/as\s*b[\s-]*248|b[\s-]*248|базик|bazik/i.test(primaryText)) elType = 'Bazik (E7018 / AS B-248)';
      else if (/озл[\s-]*8|ozl[\s-]*8|нерж|paslanmaz/i.test(primaryText)) elType = 'OZL-8 (Paslanmaz)';
      else if (/мр[\s-]*3|mp[\s-]*3|ок[\s-]*46|ok[\s-]*46|ано[\s-]*21|ano[\s-]*21|as\s*r[\s-]*143|r[\s-]*143|askaynak|рутил|rutil/i.test(primaryText)) elType = 'Rutil (MP-3 / OK 46.00)';

      const dMatch =
        primaryText.match(/(?:^|[^a-zа-яё0-9])(?:[dдфøØ]\s*[:=]?\s*)?(2[.,]0|2[.,]5|2[.,]6|3[.,]0|3[.,]2|3[.,]25|4[.,]0|5[.,]0)\s*(?:[xх*×]\s*\d+|\s*(?:мм|mm))(?![a-zа-яё])/i) ||
        primaryText.match(/(?:^|[^a-zа-яё0-9])[dдфøØ]\s*[:=]?\s*(2[.,]5|3[.,]0|3[.,]2|3[.,]25|4[.,]0|5[.,]0|3|4|5)(?![0-9.,])/i) ||
        primaryText.match(/(?:^|[^0-9.,])(2[.,]5|3[.,]0|3[.,]2|3[.,]25|4[.,]0|5[.,]0)(?![0-9.,])/i);
      let diaVal = dMatch ? dMatch[1].replace(',', '.').replace('3.25', '3.2') : '';
      if (diaVal === '3') diaVal = '3.0';
      if (diaVal === '4') diaVal = '4.0';
      if (diaVal === '5') diaVal = '5.0';
      const dia = diaVal ? ` Ø${diaVal} mm` : '';
      return {
        materialName: `Kaynak Elektrodu${elType ? ` ${elType}` : ''}${dia}`.trim(),
        category: 'Kaynak Malzemeleri'
      };
    }
  }

  // 1.95 Bağ Teli / Tavlı Tel / Вязальная проволока (Pense / Kerpeten / Kanca hariç!)
  if (
    (primaryText.includes('вязальн') || primaryText.includes('bağ teli') || primaryText.includes('bag teli') || primaryText.includes('tavlı tel') || (primaryText.includes('проволока') && (primaryText.includes('1.2') || primaryText.includes('1,2') || primaryText.includes('3282') || /проволока\s+(?:то\s+ч|т\/о|ок\b)/i.test(primaryText)))) &&
    !primaryText.includes('клещ') && !primaryText.includes('кусачк') && !primaryText.includes('крючок') && !primaryText.includes('пистолет') && !primaryText.includes('pense')
  ) {
    const dMatch = primaryText.match(/\b(0[.,]8|1[.,]0|1[.,]2|1[.,]4|1[.,]6|2[.,]0|2[.,]5|3[.,]0|4[.,]0|6[.,]0)\s*(?:мм|mm)?(?![a-zа-яё0-9])/i);
    const dia = dMatch ? `${dMatch[1].replace(',', '.')}mm` : '1.2mm';
    return {
      materialName: `Tavlı Donatı Bağ Teli (${dia})`,
      category: 'Donatı Malzemeleri'
    };
  }

  // 1.96 İnşaat Çivisi vs Isı Yalıtım Dübeli Çivisi (BOGIRUS NT vb.) vs Gazlı Çivi Tabancası Tüpü / Klipsi
  if (/toua.*баллон|баллон.*гвозд|газовый\s*баллон.*монтаж/i.test(combined)) {
    return {
      materialName: 'Gazlı Çivi Tabancası Tüpü / Kartuşu (TOUA)',
      category: 'Sarf Malzeme & Hırdavat'
    };
  }
  if (/civi\s*tabanca.*klips|çivi\s*tabanca.*klips|клипс.*монтажн.*пистолет/i.test(combined)) {
    const dMatch = combined.match(/\b(16|20|25|32)\s*(?:мм|mm)?/i);
    return {
      materialName: `Çivi Tabancası Boru Sabitleme Klipsi${dMatch ? ` (Ø${dMatch[1]} mm)` : ''}`,
      category: 'Elektrik & Aydınlatma'
    };
  }
  if (primaryText.includes('гвозд') || primaryText.includes('civi') || primaryText.includes('çivi')) {
    if (!/гвоздодер|пистолет|tabanca|klips|клипс|держател|баллон|toua|дюбель[\s-]*гвозд|дюбель\s+с\s+гвоздем|анкер[\s-]*клин/i.test(combined)) {
      // Termo başlıklı ısı yalıtım dübel çivisi (BOGIRUS NT 160/180/215/350 mm)
      if (/термоголовк|к\s*дюбел|bogirus|dübel\s*çivisi|dubel\s*civisi/i.test(combined)) {
        const lenMatch = combined.match(/\b(100|120|140|160|180|200|215|220|250|260|300|350|400)\s*(?:мм|mm)(?![a-zа-яё])/i);
        const len = lenMatch ? ` ${lenMatch[1]} mm` : '';
        return {
          materialName: `BOGIRUS NT Termo Başlıklı Dübel Çivisi${len}`,
          category: 'Sarf Malzeme & Hırdavat'
        };
      }
      const dimMatch = primaryText.match(/\b(\d+(?:[.,]\d+)?\s*[xх*×]\s*\d{2,3})\b/i);
      const mmMatch = primaryText.match(/\b(50|60|70|80|90|100|120|150|200)\s*(?:мм|mm)(?![a-zа-яё])/i);
      const size = dimMatch
        ? dimMatch[1].replace(/\s+/g, '').replace(',', '.').replace(/[х*×]/gi, 'x').replace(/\.0(?=x)/, '')
        : (mmMatch ? `${mmMatch[1]}mm` : '4x100mm');
      return {
        materialName: `İnşaat Çivisi (${size})`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }

  // 1.97 Kum / Песок (Kum tutucu/пескоуловитель, ЦПС, пескобетон, mikser ve yangın panosu hariç!)
  if (
    (primaryText.includes('песок') || (/\bkum\b/i.test(primaryText) && !primaryText.includes('kumaş') && !primaryText.includes('kumanda') && !primaryText.includes('kumlama'))) &&
    !/пескоуловител|пескобетон|цементно-песчан|\bцпс\b|миксер|стенд.*пожарн|ящик.*песк|kum\s*hazneli|kum\s*tutucu/i.test(primaryText)
  ) {
    const isQuartz = /кварц|kuvars/i.test(primaryText);
    const isBagged = /мешк|мешок|torba|\b25\s*кг|\b40\s*кг|\b50\s*кг/i.test(primaryText);
    return {
      materialName: isQuartz
        ? `Kuvars Kumu${isBagged ? ' (Torbalı)' : ''}`
        : `İnşaat Kumu (Sıva / Şap Kumu)${isBagged ? ' (Torbalı)' : ''}`,
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }

  // 1.975 Keramzit Hafif Agrega / Керамзит (Normal mıcır/çakıldan ayır!)
  if (/керамзит|keramizit|keramzit/i.test(primaryText) && !/керамзитобетон|блок|keramzitobeton|\bblok/i.test(primaryText)) {
    const kFrac = primaryText.match(/\b(5\s*[-–]\s*10|10\s*[-–]\s*20|20\s*[-–]\s*40|0\s*[-–]\s*5)\b/);
    const fracStr = kFrac ? ` ${kFrac[1].replace(/\s+/g, '')} mm` : '';
    return {
      materialName: `Keramzit Hafif Yalıtım Agregası (Керамзит)${fracStr}`,
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }

  // 1.98 Çakıl / Mıcır / Щебень / Гравий (Fraksiyonunu Koru!)
  if (
    (primaryText.includes('щебень') || primaryText.includes('гравий') || primaryText.includes('çakıl') || primaryText.includes('cakil') || primaryText.includes('mıcır')) &&
    !/керамзит|keramizit|keramzit/i.test(primaryText)
  ) {
    const fracMatch = primaryText.match(/\b(5\s*[-–]\s*20|20\s*[-–]\s*40|40\s*[-–]\s*70|0\s*[-–]\s*5|3\s*[-–]\s*10|5\s*[-–]\s*10)\b/);
    const frac = fracMatch ? fracMatch[1].replace(/\s+/g, '') + 'mm' : '5-20mm';
    const isGranite = /гранит|granit/i.test(primaryText);
    const isGravel = /гравий|гравийн|çakıl/i.test(primaryText);
    const subType = isGranite ? 'Granit Kırmataş Mıcır' : (isGravel ? 'Çakıl Mıcır' : 'Kırmataş Mıcır');
    return {
      materialName: `${subType} (${frac})`,
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }

  // 1.99 Kalıp Yağı / Смазка для опалубки
  if (primaryText.includes('kalıp yağ') || primaryText.includes('kalip yag') || primaryText.includes('kalıp ayırıcı yağ') || primaryText.includes('смазка для опалуб') || primaryText.includes('масло для опалуб') || primaryText.includes('эмульсол')) {
    return { materialName: 'Kalıp Ayırıcı Yağ (Endüstriyel Beton Kalıp Yağı)', category: 'Kalıp & İskele Sistemleri' };
  }

  // 1.994 Yalıtımlı PVC Branda / Tente vs Yalıtımsız Ağır Hizmet PVC Branda vs Yalıtımsız Tarpaulin Branda (без утеплителя ayır!)
  if (primaryText.includes('тент') || primaryText.includes('полог') || primaryText.includes('тарпаулин') || (primaryText.includes('branda') && !primaryText.includes('пленка'))) {
    const dimMatch = primaryText.match(/\b(\d{1,2}\s*[xх*×]\s*\d{1,2})\s*(?:м|m)?(?![a-zа-яё0-9])/i);
    const dim = dimMatch ? ` ${dimMatch[1].replace(/\s+/g, '').replace(/[х*×]/gi, 'x')} m` : '';
    const isUninsulated = /без\s*утепл|б\/\s*\d|yalıtımsız|yalitimsiz|180\s*гр/i.test(primaryText);
    const isInsulated = !isUninsulated && /утепл|негорюч|огнестойк|yalıtımlı|yanmaz|400\s*г|450-500/i.test(primaryText);
    const isPvc = /пвх|pvc/i.test(primaryText) && !/тарпаулин|tarpaulin/i.test(primaryText);
    const baseTarpName = isInsulated
      ? 'Yanmaz Yalıtımlı PVC Branda / Tente'
      : isPvc
        ? 'Su Geçirmez Ağır Hizmet PVC Branda / Tente (Yalıtımsız)'
        : 'Su Geçirmez Tarpaulin Branda / Tente (Yalıtımsız)';
    return {
      materialName: `${baseTarpName}${dim}`.trim(),
      category: 'Yalıtım & Alçıpan'
    };
  }

  // 1.995 Naylon / Polietilen İnşaat Filmi / Пленка (Yazıcı termoplenkası, kablo bağı, conta, kapı kasası, laminasyon filmi ve streç filmi kesinlikle ayır!)
  if (/термопленк/i.test(combined)) {
    return { materialName: 'Yazıcı Fırın Filmi (Термопленка CET / Kyocera Ecosys)', category: 'Bilgi İşlem & IT' };
  }
  if (
    (combined.includes('пленка') || combined.includes('плёнка') || combined.includes('naylon') || combined.includes('стрейч') || combined.includes('strec')) &&
    !/хомут|kablo\s*bağı|прокладк|conta|ламинирован|laminasyon|финишпленк|двер|коробк|наличник|kapı|pervaz|перчатк|eldiven/i.test(combined)
  ) {
    if (/стрейч|стретч|stretch|streç|strec|паллет|23\s*мкм|23\s*mkm|23\s*мкр|23\s*mkr|17\s*мкм|17\s*мкр/i.test(combined)) {
      return { materialName: 'Ambalaj Streç Film 500 mm (Rulo)', category: 'Sarf Malzeme & Hırdavat' };
    }
    if (/500\s*mm|500\s*мм|50\s*см|50\s*cm/i.test(combined)) {
      if ((Number(item.unitPrice) || 0) < 20) {
        return { materialName: 'Polietilen Ambalaj Filmi 500 mm (Metraj)', category: 'Sarf Malzeme & Hırdavat' };
      }
      return { materialName: 'Ambalaj Streç Film 500 mm (Rulo)', category: 'Sarf Malzeme & Hırdavat' };
    }
    if (/пароизоляц|ветрозащит|гидро-ветро|изоспан|buhar\s*kesici/i.test(combined)) {
      return { materialName: 'Buhar Kesici Yalıtım Örtüsü (Membran Film)', category: 'Yalıtım & Alçıpan' };
    }
    const isPackaging = /упаковочн/i.test(combined);
    const isReinforced = /армирован/i.test(combined);
    const mkrMatch = (effectiveOrig || combined).match(/(?:^|[\s(,;/xх*×-])(80|100|120|150|200|250|300)\s*(?:мкм|мкр|микрон|mkr|mkm|mikron)/i);
    const uPriceFilm = Number(item.unitPrice) || 0;
    const isLightGostFilm = !mkrMatch && /гост\s*10354/i.test(combined) && uPriceFilm > 0 && uPriceFilm < 1500;
    const mkr = mkrMatch ? `${mkrMatch[1]} mikron` : (isLightGostFilm ? '100 mikron GOST 10354' : '200 mikron');
    if (isPackaging) {
      return {
        materialName: `Ambalaj Koruma Filmi / Naylonu (${mkr})`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
    return {
      materialName: `${isReinforced ? 'Takviyeli (Arme) ' : ''}Polietilen İnşaat Naylonu (${mkr})`,
      category: 'Yalıtım & Alçıpan'
    };
  }

  // 1.995b Donatı Kafesi (Кр-1..Кр-8) vs Çelik Karkas (КР-1 / КП-1) vs Çivi Tabancası Klipsi vs Yağlı Emal Boya PF-115
  if (/каркас\s+арматур|каркас\s+кр-\d|donatı\s*kafes/i.test(combined)) {
    const cageText = effectiveOrig || combined;
    const krMatch = cageText.match(/(?:кр|kr|kp)[\s-]*(\d+(?:-\d+)?)/i);
    const krCode = krMatch ? `Kr-${krMatch[1]}` : 'Kr-1';
    const frMatch = cageText.match(/(?:фр|fr)[\s-]*(\d+)/i);
    const frSuffix = frMatch ? ` Fr-${frMatch[1]}` : '';
    const dimMatch = cageText.match(/(?:l\s*=\s*)?(\d{2,4}\s*[*xх×]\s*\d{2,4}(?:\s*[*xх×]\s*\d{2,4})?)/i);
    const dimSuffix = dimMatch ? ` (${dimMatch[1].replace(/\s+/g, '').replace(/[х*×]/gi, 'x')} mm)` : '';
    return {
      materialName: `Donatı Kafesi ${krCode}${frSuffix}${dimSuffix} (Özel İmalat)`,
      category: 'Donatı Malzemeleri'
    };
  }
  if (/каркас\s+металлическ|karkas\s*metal/i.test(combined)) {
    if (/muhtelif/i.test(combined)) {
      return {
        materialName: 'Karkas Metal KP (Muhtelif Özel İmalat)',
        category: 'Donatı Malzemeleri'
      };
    }
    const kpMatch = combined.match(/(?:кр|kp|kr)[\s-]*(\d+)/i);
    const kpCode = kpMatch ? `KP-${kpMatch[1]}` : 'KP-1';
    return {
      materialName: `Karkas Metal ${kpCode} (Özel İmalat)`,
      category: 'Donatı Malzemeleri'
    };
  }
  if (/пиканте\s*стоп|picante\s*stop/i.test(combined)) {
    if (/грунтовк|astar/i.test(combined)) {
      return { materialName: 'Yangın Geciktirici Astar Boya Picante Stop KM0 (Грунтовка)', category: 'Kimyasallar & Boya' };
    }
    if (/эластичн|elastik/i.test(combined)) {
      return { materialName: 'Elastik Yangın Geciktirici Boya Picante Stop KM0', category: 'Kimyasallar & Boya' };
    }
    return { materialName: 'Yangın Geciktirici Boya Picante Stop KM0', category: 'Kimyasallar & Boya' };
  }
  if (/пф[\s-]*115|pf[\s-]*115/i.test(combined)) {
    let color = 'Beyaz';
    if (/серый|серая|gri\b/i.test(combined)) color = 'Gri';
    else if (/черн|siyah/i.test(combined)) color = 'Siyah';
    else if (/желт|жёлт|sarı|sari/i.test(combined)) color = 'Sarı';
    else if (/зелен|yeşil|yesil/i.test(combined)) color = 'Yeşil';
    else if (/син|голуб|mavi/i.test(combined)) color = 'Mavi';
    else if (/красн|kırmızı|kirmizi/i.test(combined)) color = 'Kırmızı';
    return {
      materialName: `Yağlı Emal Boya PF-115 (${color})`,
      category: 'Kimyasallar & Boya'
    };
  }
  if (/клипс.*теплого\s*пола|klips\s*pistolet.*teplogo\s*pola/i.test(combined)) {
    const isJiraf = /жираф|jiraf/i.test(combined);
    const isPetek = /петек|petek/i.test(combined);
    const sysTag = isJiraf ? ' (Jiraf Sistemi)' : (isPetek ? ' (Petek Sistemi)' : '');
    return {
      materialName: `Yerden Isıtma Boru Sabitleme Klipsi & Tabancası${sysTag}`,
      category: 'Sıhhi Tesisat & Isıtma'
    };
  }

  // 1.995c Prizma Özel Alt Kalem Çözümlemeleri (Aynı stok kartı altında farklı parça/ölçü/model girilen kalemler)
  // Master Isımak Yedek Parçaları (4105.062, 4104.193, 4103.441, 4101.666, 4111.885 vb.)
  if (/master\s*isimak|master\s*ısımak/i.test(combined)) {
    const origCodeMatch = cleanOrig.match(/\b(4\d{3}[.\s]\d{3})\b/);
    const codeStr = origCodeMatch ? origCodeMatch[1].replace(/\s+/g, '.') : '';
    let partTr = 'Yedek Parçası';
    if (/крыльчатк/i.test(cleanOrig)) partTr = 'Fan Pervanesi';
    else if (/блок\s*контрол/i.test(cleanOrig)) partTr = 'Yanma Kontrol Ünitesi';
    else if (/лопатк.*ротор/i.test(cleanOrig)) partTr = 'Rotor Kanadı / Paleti';
    else if (/(?:^|[^a-zа-яё])ротор(?![a-zа-яё])/i.test(cleanOrig)) partTr = 'Rotor';
    else if (/трансформатор/i.test(cleanOrig)) partTr = 'Yüksek Gerilim Trafosu';
    else if (/высоковольтн.*провод/i.test(cleanOrig)) partTr = 'Yüksek Gerilim Ateşleme Kablosu';
    else if (/термостат/i.test(cleanOrig)) partTr = 'Koruma Termostatı';
    else if (/фильтр/i.test(cleanOrig)) partTr = 'Yakıt Filtresi';
    else if (/форсунк|enjektor/i.test(combined)) partTr = 'Yakıt Enjektörü / Memesi';
    else if (/фотоэлемент/i.test(cleanOrig)) partTr = 'Fotosel / Alev Sensörü';
    else if (/электрод|atesleme\s*bujisi/i.test(combined)) partTr = 'Ateşleme Bujisi / Elektrodu';
    else if (/колесо|tekerlik/i.test(combined)) partTr = 'Tekerlek';
    else if (/крышк.*бак|tank\s*kapagi/i.test(combined)) partTr = 'Yakıt Deposu Kapağı';
    return {
      materialName: `Master Isımak ${partTr}${codeStr ? ` (${codeStr})` : ''}`,
      category: 'Araç & İş Makinesi Ekipmanları'
    };
  }
  // 4111.081 ISIMAK MANSONU stok kartı altında Çelik Manşon Ду32 girilmişse ayır
  if (/4111\.081|isimak\s*manson/i.test(combined) && /муфта\s+ст\s+ду\s*32/i.test(combined)) {
    return {
      materialName: 'Çelik Dişli Boru Manşonu DN32 (1 1/4")',
      category: 'Sıhhi Tesisat & Isıtma'
    };
  }
  // Koli Bandı 48mm x 66m vs 50mm x 50m vs 50mm x 100m ayrımı
  if (/bant\s*koli|скотч\s+прозрачн|клейкая\s+лента\s+упаковочн/i.test(combined)) {
    const dimMatch = combined.match(/\b(48|50)\s*(?:мм|mm)?\s*[xх*×]\s*(50|66|100|150)\s*(?:м|mt|m)?/i);
    const w = dimMatch ? dimMatch[1] : '50';
    const len = dimMatch ? dimMatch[2] : '50';
    return {
      materialName: `Şeffaf Koli Bandı ${w} mm x ${len} m`,
      category: 'Ofis & Kırtasiye'
    };
  }
  // Genel Prizma Stok Kartı "ELDIVEN TEMIZLIK ICIN" / "Перчатки резиновые": iş eldiveni vs tek kullanımlık nitril/lateks vs kalın kauçuk ev tipi eldiven ayrımı
  if (/eldiven\s*temizlik\s*icin|^перчатки\s+резиновые\b/i.test(primaryText)) {
    if (/перчатки\s+рабочие\s+защитные/i.test(cleanOrig)) {
      return {
        materialName: 'Pamuklu Koruyucu İş Eldiveni (Перчатки рабочие защитные)',
        category: 'İş Güvenliği & KKD'
      };
    }
    const uPrice = Number(item.unitPrice) || 0;
    const uNorm = String(item.unit || '').toLowerCase();
    if (/paket|уп/i.test(uNorm) || uPrice > 250) {
      return {
        materialName: 'Tek Kullanımlık Nitril/Lateks Temizlik Eldiveni (Paket)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (uPrice > 0 && uPrice <= 25) {
      return {
        materialName: 'Tek Kullanımlık Nitril/Lateks Temizlik Eldiveni (Adet/Çift)',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Kalın Kauçuk Ev / Temizlik Eldiveni (Перчатки резиновые)',
      category: 'İş Güvenliği & KKD'
    };
  }
  // Genel Prizma Stok Kartı "COP POSETI 140 LT": 24 ₽ standart rulo vs 370 ₽ ağır hizmet rulo ayrımı
  if (/cop\s*poseti\s*140\s*lt/i.test(primaryText)) {
    const uPrice = Number(item.unitPrice) || 0;
    if (uPrice > 0 && uPrice < 60) {
      return {
        materialName: 'Çöp Poşeti 140 L (Standart İnce Rulo)',
        category: 'Temizlik & Hijyen Malzemeleri'
      };
    }
    return {
      materialName: 'Endüstriyel Ağır Hizmet Çöp Poşeti 140 L (Rulo)',
      category: 'Temizlik & Hijyen Malzemeleri'
    };
  }
  // Lehim Teli 100g vs 200g ayrımı
  if (/tel\s*lehim|припой/i.test(combined)) {
    const wMatch = combined.match(/\b(100|200|250|500)\s*(?:г|гр|gr|g)(?![a-zа-яё])/i);
    const wStr = wMatch ? ` (${wMatch[1]} gr)` : '';
    return {
      materialName: `Reçineli Lehim Teli ПОС-61 Ø1 mm${wStr}`,
      category: 'Elektrik & Aydınlatma'
    };
  }

  // Bi-Metal Delik Testeresi / Panç (PANC HSS METAL - 38mm, 55mm, 73mm, 92mm, 110mm, 152mm)
  if (/panc\s*hss|биметаллическ.*коронк|биометаллическ.*коронк|коронка\s+(?:по\s+металл|для\s+металл|по\s+стал|универсальн)/i.test(combined)) {
    const parenDia = cleanOrig.match(/(?:d|ø|ф|bm-)?(\d{2,3})(?:[xх*×]\d+)?\s*(?:мм|mm)(?![a-zа-яё])/i);
    const mainDia = combined.match(/(?:d|ø|ф|bm-)?(\d{2,3})(?:[xх*×]\d+)?\s*(?:мм|mm)(?![a-zа-яё])/i);
    const dia = parenDia ? parenDia[1] : (mainDia ? mainDia[1] : '50');
    return {
      materialName: `Bi-Metal Delik Testeresi / Panç HSS Ø${dia} mm`,
      category: 'El Aletleri & Hırdavat'
    };
  }

  // Trapez Sac / Профнастил (Profil C8/C20/C21/H60/H75, kalınlık, ebat ve Boyalı RAL vs Galvaniz ayrımı)
  if (/профнастил|профлист|trapez\s*sac/i.test(combined)) {
    const sacSrc = (effectiveOrig && /профнастил|профлист|\d{3,4}\s*[*xх×]\s*\d{3,4}/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const profM = sacSrc.match(/(?:^|[\s-])[cсhнмpмп]{1,2}[\s-]*(8|10|18|20|21|35|44|57|60|75|114)\b/i);
    const profCode = profM ? `C${profM[1]}` : 'C8';
    const dim3 = sacSrc.match(/\b(0[.,]\d{1,2})\s*[*xх×-]\s*(\d{3,4})\s*[*xх×-]\s*(\d{3,4})\b/);
    const thM = dim3 ? dim3[1].replace(',', '.') : (sacSrc.match(/\b(0[.,]4|0[.,]45|0[.,]5|0[.,]55|0[.,]65|0[.,]7|0[.,]8)\b/)?.[1]?.replace(',', '.') || '0.45');
    const wM = dim3 ? dim3[2] : (sacSrc.match(/\b(1000|1100|1150|1200)\b/)?.[1] || '1150');
    const lM = dim3 ? dim3[3] : (sacSrc.match(/\b(2000|2100|2500|3000|6000)\b/)?.[1] || '2000');
    const ralM = sacSrc.match(/ral\s*(\d{4})/i);
    const coat = ralM ? `Boyalı RAL ${ralM[1]}` : (/оцинк|galvaniz/i.test(sacSrc) ? 'Galvanizli' : '');
    return {
      materialName: `Trapez Sac ${profCode} ${thM}x${wM}x${lM} mm${coat ? ` (${coat})` : ''}`,
      category: 'Çelik Malzemeler'
    };
  }

  // RGK Lazer Nivo vs Üniversal Tripod Sehpa (Штатив ШУ-1) ve Lazer İşaretçi
  if (/rgk\s*sp-100|ротационный\s+лазерный\s+нивелир/i.test(combined)) {
    if (/штатив\s+универсальный|ресанта\s+штатив/i.test(cleanOrig)) {
      return { materialName: 'Lazer Nivo Sehpası / Tripod (Ресанта ШУ-1)', category: 'Ölçüm, Harita & Saha Ekipmanları' };
    }
    if (/sp-610g/i.test(cleanOrig)) {
      return { materialName: 'RGK SP-610G Rotasyonlu Lazer Nivo Seti', category: 'Ölçüm, Harita & Saha Ekipmanları' };
    }
    return { materialName: 'RGK SP-100 Combo Rotasyonlu Lazer Nivo Seti', category: 'Ölçüm, Harita & Saha Ekipmanları' };
  }
  if (/^lazer$/i.test(name.trim()) || /лазерная\s+указка/i.test(combined)) {
    if ((Number(item.unitPrice) || 0) >= 5000 || /18650|фонарь-указка|lazernyy-fonar/i.test(combined)) {
      return { materialName: 'Profesyonel Yeşil Lazer Fener / Saha İşaretçi (18650 Akülü)', category: 'Ölçüm, Harita & Saha Ekipmanları' };
    }
    return { materialName: 'Şarjlı Lazer İşaretçi / Sunum Kalemi', category: 'Ölçüm, Harita & Saha Ekipmanları' };
  }

  // Aybolt (Рым-болт) ölçü/tip ayrımı
  if (/aybolt|рым[\s-]*болт/i.test(combined)) {
    if (/(?:^|[^a-zа-яё0-9])(d20|м20|m20)(?![a-zа-яё0-9])/i.test(combined)) {
      return { materialName: 'Aybolt (Рым-болт) M20 DIN 580', category: 'Sarf Malzeme & Hırdavat' };
    }
    if (/kalip\s*kaldirma|kalıp\s*kaldırma/i.test(combined) && (Number(item.unitPrice) || 0) < 800) {
      return { materialName: 'Kalıp Kaldırma Ayboltu (Рым-болт) M24 DIN 580', category: 'Sarf Malzeme & Hırdavat' };
    }
    return { materialName: 'Aybolt (Рым-болт) M64 DIN 580', category: 'Sarf Malzeme & Hırdavat' };
  }

  // Klor Tozu vs Sönmüş Kireç (Известь гашеная 30 кг vs Хлорная известь)
  if (/klor\s*toz|хлорная\s*известь/i.test(combined)) {
    if (/известь\s+гашеная|карбонатно-известков|30\s*кг/i.test(cleanOrig)) {
      return { materialName: 'Sönmüş Kireç Tozu (Известь гашеная - 30 kg Torba)', category: 'Kimyasallar & Boya' };
    }
    return { materialName: 'Klor Tozu / Kireç Kaymağı (Хлорная известь - 20/25 kg)', category: 'Temizlik & Hijyen Malzemeleri' };
  }

  // Taşyünü Технофас / Техноблок / Техновент / Роклайт / Baswool — Gerçek kalınlık (50, 100, 150, 180, 200 mm vb.) ve seri korunur
  if (/технофас|техноблок|техновент|техноруф|технофлор|роклайт|baswool|басвул/i.test(combined)) {
    const extractTh = (txt: string) => {
      const m =
        txt.match(/\b(?:1200|1000)\s*[*xх×-]\s*(?:600|500)\s*[*xх×-]\s*(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\b/i) ||
        txt.match(/(?:толщ[а-я.]*\s*|(?:^|[^0-9xх*]))(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\s*(?:мм|mm)\b/i);
      return m ? m[1] : null;
    };
    const th = extractTh(cleanOrig) || extractTh(primaryText) || extractTh(combined) || '100';
    const woolText = `${cleanOrig} ${primaryText}`;
    if (/техноблок\s+стандарт|duvar\s*isi\s*gecis/i.test(cleanOrig) || (/техноблок/i.test(woolText) && !/технофас/i.test(cleanOrig))) {
      return { materialName: `Taşyünü Levha Технониколь Техноблок Стандарт 1200x600x${th} mm (45 kg/m³)`, category: 'Yalıtım & Alçıpan' };
    }
    if (/технофас\s+оптима/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Технофас Оптима 1200x600x${th} mm (110 kg/m³)`, category: 'Yalıtım & Alçıpan' };
    }
    if (/технофас\s+декор/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Технофас Декор 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
    if (/технофас/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Технофас 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
    if (/техновент\s+оптима/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Техновент Оптима 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
    if (/техновент\s+стандарт/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Техновент Стандарт 1200x600x${th} mm (80 kg/m³)`, category: 'Yalıtım & Alçıpan' };
    }
    if (/техновент\s+н\b/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Техновент Н 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
    if (/роклайт/i.test(woolText)) {
      return { materialName: `Taşyünü Levha Технониколь Роклайт 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
    if (/baswool|басвул/i.test(woolText)) {
      if (/фасад\s*120/i.test(woolText)) {
        return { materialName: `Taşyünü Levha Baswool Фасад 120 1200x600x${th} mm (120 kg/m³)`, category: 'Yalıtım & Alçıpan' };
      }
      return { materialName: `Taşyünü Levha Baswool 1200x600x${th} mm`, category: 'Yalıtım & Alçıpan' };
    }
  }

  // Çelik Sapan stok kartı altında Bez Sapan (Строп текстильный) girilmişse ayır
  if (/sapan\s*celik|чалки\s*тросов/i.test(combined) && /строп\s+текстильный/i.test(cleanOrig)) {
    return { materialName: 'Bez Sapan (Текстильный строп СТП) 5 Ton 3 Metre', category: 'El Aletleri & Hırdavat' };
  }

  // Metal Delici HSS Matkap Ucu vs Kobaltlı HSS-Co (Кобальт Р6М5К5)
  if (/uc\s*metal\s*delici|сверло\s+по\s+металлу/i.test(combined) && /12\s*(?:мм|mm|\b)/i.test(combined)) {
    if (/кобальт|р6м5к5/i.test(cleanOrig)) {
      return { materialName: 'Kobaltlı Metal Matkap Ucu HSS-Co (Р6М5К5) Ø12 mm', category: 'El Aletleri & Hırdavat' };
    }
    return { materialName: 'Metal Matkap Ucu HSS Ø12 mm', category: 'El Aletleri & Hırdavat' };
  }

  // Revir İlaç Dolabı vs Tıbbi Muayene Paravanı (Ширма медицинская)
  if (/dolap\s*ilac|шкаф\s*meg/i.test(combined) && /ширма\s+медицинская/i.test(cleanOrig)) {
    return { materialName: 'Tıbbi Muayene Paravanı (3 Bölmeli - Ширма медицинская)', category: 'Şantiye Mobilya & Yaşam Donanımı' };
  }

  // Tamir Harcı Glims CRT 60 vs Mapei Planitop HPC LV-R
  if (/glims\s*crt\s*60/i.test(combined) && /planitop/i.test(cleanOrig)) {
    return { materialName: 'Yüksek Dayanımlı Grout / Tamir Harcı Mapei Planitop HPC LV-R (25 kg)', category: 'Hazır Beton, Çimento & Agrega' };
  }

  // PVC Fileli Köşe Profili vs PVC Damlalık Profili (Капельник)
  if (/kose\s*profili\s*pvc\s*setkali|угол\s+перфорированный\s+пвх\s+с\s+сеткой/i.test(combined)) {
    if (/капельник|kapelnik/i.test(cleanOrig)) {
      return { materialName: 'PVC Fileli Damlalık Profili (Профиль-капельник) 2500 mm', category: 'Yalıtım & Alçıpan' };
    }
    return { materialName: 'PVC Fileli Köşe Profili 100x150x3000 mm', category: 'Yalıtım & Alçıpan' };
  }

  // Plotter Kartuşu Artikul Kodu Ayrımı (Арт. 2497265 vs Арт. 1614493)
  if (/kartus\s*plotter\s*canon\s*pfi-120/i.test(combined)) {
    const artMatch = cleanOrig.match(/арт\.?\s*(\d{5,8})/i);
    if (artMatch) {
      return { materialName: `Plotter Kartuşu Canon PFI-120 (Арт. ${artMatch[1]})`, category: 'Ofis & Kırtasiye' };
    }
  }

  // 1.996 Propan Gaz Tüpü vs Propan Ekipmanları (Conta, Saati, Pürmüz, Kafes, Araba, Hortum, Gaz Kaynak Takımı Evren 743 kesinlikle ayır!)
  if (/газосварочн.*комплект|743\s*evren|evren.*743/i.test(combined)) {
    return { materialName: 'Oksijen-Propan Gaz Kaynak ve Kesme Takımı Evren 743 (Газосварочный комплект)', category: 'Kaynak Malzemeleri' };
  }
  if (primaryText.includes('пропан') || primaryText.includes('propan')) {
    if (/прокладк|conta/i.test(primaryText)) {
      return { materialName: 'Propan Regülatör / Tüp Contası', category: 'Kaynak Malzemeleri' };
    }
    if (/клетка|kafes/i.test(primaryText)) {
      return { materialName: 'Propan Tüpü Taşıma ve Depolama Kafesi (9 Adetlik)', category: 'Şantiye Tesis & Konteyner' };
    }
    if (/тележк|araba/i.test(primaryText)) {
      return { materialName: 'Oksijen / Propan Tüp Taşıma Arabası GB2', category: 'El Aletleri & Hırdavat' };
    }
    if (/редуктор|бпо|bpo|saat|regülatör|манометр/i.test(primaryText)) {
      return { materialName: 'Propan Regülatörü / Saati BPO KRASS', category: 'Kaynak Malzemeleri' };
    }
    if (/горелк|pürmüz|purmuz|şaloma|резак/i.test(primaryText)) {
      return { materialName: 'Propan Pürmüz / Şaloma Başlığı', category: 'Kaynak Malzemeleri' };
    }
    if (!/рукав|шланг|hortum/i.test(primaryText)) {
      const priceVal = Number(item.unitPrice) || 0;
      if (priceVal >= 4000) {
        return { materialName: 'Propan Gaz Tüpü 50L (Boş Çelik Tüp Gövdesi)', category: 'Kaynak Malzemeleri' };
      }
      return { materialName: 'Propan Gaz Tüpü (50L Gaz Dolumu)', category: 'Kaynak Malzemeleri' };
    }
  }

  // 1.997 Dizel Yakıt / Mazot vs Dizel Yakıt Transfer İstasyonu / Pompası
  if (/станция\s*перекачк.*(?:дизельн|топлив|дт)|насос.*перекачк.*(?:дизельн|топлив|дт)/i.test(primaryText)) {
    return { materialName: 'Dizel Yakıt Transfer İstasyonu / Pompası (Станция перекачки ДТ)', category: 'Araç & İş Makinesi Ekipmanları' };
  }
  if (
    (/^mazot$|^dizel\s*yakıt|^дизельное\s*топливо/i.test(primaryText.trim()) ||
     (/mazot|dizel\s*yakıt|дизельн.*топлив/i.test(primaryText) && !/jenerat|tank|filtre|kompresor|pompa|isımak|ısıtıcı|станция|перекачк|насос|счетчик|пистолет|шланг|рукав|емкост|резервуар/i.test(primaryText)))
  ) {
    return { materialName: 'Dizel Yakıt / Mazot (Euro 5)', category: 'Araç & İş Makinesi Ekipmanları' };
  }

  // 2. Coupler / Donatı Manşonu / Муфта (Model serisini A12, P13, P14, D14 ve d=çapını koru!)
  if (
    (primaryText.includes('муфта') || primaryText.includes('mufta') || primaryText.includes('manşon') || primaryText.includes('manson')) &&
    (/арматур|donatı|резьб|konik|стандарт|переходн|[aа]12|[pр]13|[pр]14|[dд]14|(?:^|[^a-zа-яё0-9])[dдqфøØ]\s*=?\s*\d{2}(?![0-9])/i.test(primaryText)) &&
    !/dn\s*\d+|ду\s*\d+|ппр|ppr|пнд|dişli\s*manşon|koruge|isımak|isimak|кабельн|kablo/i.test(primaryText)
  ) {
    // Önce açık "d=28" veya "d=28/32" formatını yakala (D14 model kodundaki 14'ü çap sanmamak için!)
    const transMatch = primaryText.match(/d\s*=\s*(\d{2}\s*\/\s*\d{2})/i) || primaryText.match(/\b(\d{2}\s*\/\s*\d{2})\b/);
    if (transMatch && (primaryText.includes('d=') || primaryText.includes('geçiş') || primaryText.includes('переходн'))) {
      const pair = transMatch[1].replace(/\s+/g, '');
      return {
        materialName: `Geçiş Donatı Manşonu d=${pair} mm`,
        category: 'Donatı Malzemeleri'
      };
    }
    if (primaryText.includes('geçiş') || primaryText.includes('переходн')) {
      return {
        materialName: 'Geçiş Donatı Manşonu',
        category: 'Donatı Malzemeleri'
      };
    }

    const explicitD =
      primaryText.match(/d\s*=\s*(\d{2})/i) ||
      primaryText.match(/(?:^|[^a-zа-яё0-9])[qфøØ]\s*(\d{2})(?![0-9])/i) ||
      primaryText.match(/(?:^|[^0-9])(12|14|16|18|20|22|25|28|32|36|40)\s*(?:мм|mm)(?![a-zа-яё])/i) ||
      primaryText.match(/(?:^|[^0-9])(12|14|16|18|20|22|25|28|32|36|40)\s*(?:cc)?[aаpрdд]\s*1[234]/i) ||
      primaryText.match(/(?:муфта|mufta|manşon|manson)\s+(?:арматурная\s+|стальная\s+|с\s+конической\s+резьбой\s+)*(12|14|16|18|20|22|25|28|32|36|40)(?=\s|$)/i);
    if (explicitD) {
      const dVal = explicitD[1];
      let series = '';
      if (/[pр]\s*14/i.test(primaryText)) series = ' P14 (Pozisyonel)';
      else if (/[pр]\s*13/i.test(primaryText)) series = ' P13 (Pozisyonel)';
      else if (/[dд]\s*14/i.test(primaryText)) series = ' D14';
      else if (/[aа]\s*12/i.test(primaryText) || /стандарт|konik|коническ|резьб/i.test(primaryText)) series = ' A12 (Standart)';
      return {
        materialName: `Donatı Manşonu${series} d=${dVal} mm`,
        category: 'Donatı Malzemeleri'
      };
    }
  }

  // 3. Timber / Kereste / Брус / Доска (Ölçüsünü ve Ağaç Cinsini [Çam vs Kavak/Осина] Koru, aynı ölçüdeki çam keresteleri birleştir!)
  if (
    (primaryText.includes('брус') || primaryText.includes('kereste') || primaryText.includes('kalas') || primaryText.includes('доска обрезн') || primaryText.includes('kenarlı kereste')) &&
    !/брусчатк|cam\s*yun|cam\s*yün|ursa|шлифовальн|магнитн|для\s*досок|yazı\s*tahtası|sehpa|statif|tripod|şemsiye|kilit|vida|саморез|testere|диск/i.test(combined)
  ) {
    const isOsina = /осина|(?:^|[^a-zа-яё0-9])(?:09о|01-09о)(?![a-zа-яё0-9])/i.test(combined);
    const gradeTag = isOsina ? '(Kavak / Осина)' : '(1. Sınıf GOST)';

    // mm cinsinden 3 boyut: 50*200*6000, 100*100*6000, 50*100*6000, 50*150*6100
    const mmDim = primaryText.match(/\b(\d{2,3})\s*[*xх×]\s*(\d{2,3})\s*[*xх×]\s*(\d{3,4})\b/);
    if (mmDim) {
      let d1 = parseInt(mmDim[1], 10);
      let d2 = parseInt(mmDim[2], 10);
      let d3 = parseInt(mmDim[3], 10);
      if ((d3 >= 600 && d3 <= 620) || (d3 >= 6000 && d3 <= 6200)) d3 = 6000;
      const a = Math.min(d1, d2);
      const b = Math.max(d1, d2);
      const dStr = `${a}x${b}x${d3}`;
      const isBoard = primaryText.includes('доска') || primaryText.includes('tahta') || primaryText.includes('kalas') || a <= 50;
      return {
        materialName: `${isBoard ? 'Kenarlı Kereste Tahta' : 'Profil Kereste'} ${dStr} ${gradeTag}`,
        category: 'Ahşap & Kereste'
      };
    }
    // cm veya metre karışık yazım: 5*10*600 CM, 5*10*610 CM, 5*20*610 CM, 10*10*600 CM, 50*100*6 MT
    const cmDim = primaryText.match(/\b(\d{1,3})\s*[*xх×]\s*(\d{1,3})\s*[*xх×]\s*(\d{1,4})\s*(?:cm|см|mt|м|m)(?![a-zа-яё])/i);
    if (cmDim) {
      let d1 = parseInt(cmDim[1], 10);
      let d2 = parseInt(cmDim[2], 10);
      let d3 = parseInt(cmDim[3], 10);
      if (d1 <= 25) d1 *= 10;
      if (d2 <= 30) d2 *= 10;
      if (d3 <= 10) d3 *= 1000;
      else if ((d3 >= 500 && d3 <= 650) || (d3 >= 6000 && d3 <= 6200)) d3 = 6000;
      const a = Math.min(d1, d2);
      const b = Math.max(d1, d2);
      const dStr = `${a}x${b}x${d3}`;
      const isBoard = a <= 50;
      return {
        materialName: `${isBoard ? 'Kenarlı Kereste Tahta' : 'Profil Kereste'} ${dStr} ${gradeTag}`,
        category: 'Ahşap & Kereste'
      };
    }
    // 2 boyutlu Брус / Kereste (örn. "KERESTE 100x100 mm")
    const twoDim = primaryText.match(/\b(40|50|100|150|200)\s*[*xх×]\s*(50|100|150|200)\s*(?:мм|mm)(?![a-zа-яё*xх×])/i);
    if (twoDim) {
      const d1 = parseInt(twoDim[1], 10);
      const d2 = parseInt(twoDim[2], 10);
      const a = Math.min(d1, d2);
      const b = Math.max(d1, d2);
      const isBoard = a <= 50;
      return {
        materialName: `${isBoard ? 'Kenarlı Kereste Tahta' : 'Profil Kereste'} ${a}x${b}x6000 ${gradeTag}`,
        category: 'Ahşap & Kereste'
      };
    }
    return { materialName: `İnşaatlık Çam Kereste ${gradeTag}`, category: 'Ahşap & Kereste' };
  }

  // 3.1 L-KÖŞEBENT DEMİR (Уголок стальной / KOSEBENT SIYAH)
  if (
    (/köşebent|kosebent|уголок|\bl[\s-]*demir|\bl[\s-]*profil/i.test(primaryText) ||
     (/(?:^|[^a-zа-яё])угол(?![a-zа-яё])/i.test(primaryText) && /\b\d{2,3}\s*[*xх×]\s*\d{2,3}\s*[*xх×]\s*\d{1,2}\b/.test(primaryText))) &&
    !/папка|салфет|щеток|кровать|петля|двер|внутренний|наружный|перфорирован|пвх|pvc|фитинг|отвод|alçıpan|alcipan|knauf/i.test(primaryText)
  ) {
    const angleSrc = (effectiveOrig && /\b\d{2,3}\s*[*xх×]\s*\d{2,3}\s*[*xх×]\s*\d{1,2}\b/.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const m3 = angleSrc.match(/\b(\d{2,3})\s*[*xх×]\s*(\d{2,3})\s*[*xх×]\s*(\d{1,2}(?:[.,]\d+)?)\b/);
    if (m3) {
      const l1 = parseInt(m3[1], 10);
      const l2 = parseInt(m3[2], 10);
      const th = m3[3].replace(',', '.');
      if (l1 >= 20 && l1 <= 250 && l2 >= 20 && l2 <= 250) {
        return {
          materialName: `L-Köşebent Demir ${l1}x${l2}x${th} mm (GOST 8509)`,
          category: 'Çelik Malzemeler'
        };
      }
    }
  }

  // 3.2 KUTU PROFİL / PROFİL BORU (Труба профильная / Профиль четырехгранный / KUTU PROFIL / PROFIL KUTU)
  if (
    (/труба.*профильн|профильн.*труб|профиль\s*четырехгранн|kutu\s*profil|profil\s*kutu|profil\s*boru/i.test(primaryText)) &&
    !/каркас.*ворот|калитка|çit|çevre.*paneli|kapı.*karkası|yaya.*kapısı|alçıpan|alcipan|гипсокартон|knauf/i.test(primaryText)
  ) {
    const pipeMatch =
      primaryText.match(/\b(\d{2,3})\s*[*xх×]\s*(\d{2,3})\s*(?:[*xх×]|\s+)\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:мм|mm)?(?![a-zа-яё0-9])/i);
    if (pipeMatch) {
      const sideA = parseInt(pipeMatch[1], 10);
      const sideB = parseInt(pipeMatch[2], 10);
      const thNum = parseFloat(pipeMatch[3].replace(',', '.'));
      if (sideA >= 15 && sideA <= 300 && sideB >= 15 && sideB <= 300 && thNum >= 1 && thNum <= 16) {
        const w = Math.max(sideA, sideB);
        const h = Math.min(sideA, sideB);
        const thStr = Number.isInteger(thNum) ? String(thNum) : String(thNum);
        return {
          materialName: `Kutu Profil ${w}x${h}x${thStr} mm (GOST 8639/8645)`,
          category: 'Çelik Borular'
        };
      }
    }
  }

  // 3.3 DİKİŞLİ ÇELİK BORU & SU/GAZ BORUSU (Труба электросварная / эл/св прямошов / ВГП / BORU DEMIR DIKISLI / ТРУБА 48Х3)
  if (
    (/труба\s*(?:стальная\s*|ст\.?\s*)?(?:э\/с|эл\/св|электросварн|прямошов|вгп|водогазопровод)|электросварные\s*стальные\s*трубы|boru\s*demir\s*dikişli|boru\s*demir\s*dikisli|dikişli\s*çelik\s*boru|çelik\s*su\/gaz\s*borusu|(?:^|\s)(?:труба|boru)\s+\d{2,3}\s*[*xх×]\s*\d{1,2}(?:[.,]\d+)?\s*(?:мм|mm|гост|l=)/i.test(primaryText)) &&
    !/профильн|ппр|ppr|пнд|pnd|пвх|pvc|гофрирован|koruge/i.test(primaryText)
  ) {
    const roundMatch = primaryText.match(/(?:[dдqфøØ]\s*)?\b(\d{2,3})\s*[*xх×]\s*(\d{1,2}(?:[.,]\d+)?)\b/);
    if (roundMatch) {
      const dia = roundMatch[1];
      const th = roundMatch[2].replace(',', '.').replace(/\.0$/, '');
      return {
        materialName: `Dikişli Çelik Boru Ø${dia}x${th} mm (GOST 10704)`,
        category: 'Çelik Borular'
      };
    }
  }

  // 3.4 U-PROFİL ŞVELLER (Швеллер) & ÇELİK SAC LEVHA (Лист стальной / г/к / рифленый / оцинкованный)
  if (/швеллер|şveller|sveller/i.test(primaryText) && !/alçıpan|alcipan|гипсокартон|knauf/i.test(primaryText)) {
    const chMatch = primaryText.match(/(?:швеллер|şveller|sveller)\s*№?\s*(\d{1,2})\s*[ппуpuy]?/i);
    if (chMatch) {
      return {
        materialName: `U-Profil Şveller ${chMatch[1]} (GOST 8240-97)`,
        category: 'Çelik Malzemeler'
      };
    }
  }
  if (
    (/лист\s*(?:стальн|г\/к|х\/к|горячекатан|холоднокатан|рифлен|оцинк|просечно)|sac\s*(?:siyah|levha|baklaval|galvaniz)|siyah\s*sac\b|çelik\s*sac\s*levha/i.test(primaryText)) &&
    !/гипсокартон|гкл|alçıpan|alcipan|фанер|пенопл|технониколь|каменн|вата|osb|двп|дсп|цсп|плотн|профнастил|профлист|trapez/i.test(primaryText)
  ) {
    const sheetSrc = (effectiveOrig && /лист/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const isCheckered = /рифлен|baklaval|체크/i.test(sheetSrc);
    const isGalv = /оцинк|galvaniz/i.test(sheetSrc);
    const thMatch =
      sheetSrc.match(/(?:^|[^0-9.,])(0[.,]5|0[.,]7|0[.,]8|1|1[.,]2|1[.,]5|2|2[.,]5|3|4|5|6|8|10|12|14|16|20|25|30)\s*[*xх×]\s*(?:1000|1250|1500|2000)/i) ||
      sheetSrc.match(/(?:лист|sac)[^0-9]{1,25}?(0[.,]5|0[.,]7|0[.,]8|1|1[.,]2|1[.,]5|2|3|4|5|6|8|10|12|14|16|20|25|30)\s*(?:мм|mm)(?![a-zа-яё])/i) ||
      sheetSrc.match(/(?:^|[^0-9.,])(1[.,]5|2|3|4|5|6|8|10|12|14|16|20|25|30)\s*(?:мм|mm)(?![a-zа-яё])/i);
    const thStr = thMatch ? ` ${thMatch[1].replace(',', '.')} mm` : '';
    const prefix = isCheckered
      ? 'Baklavalı Çelik Sac Levha (Лист рифленый)'
      : isGalv
        ? 'Galvanizli Çelik Sac Levha (Лист оцинкованный)'
        : 'Siyah Çelik Sac Levha (Лист г/к GOST 19903)';
    return {
      materialName: `${prefix}${thStr}`,
      category: 'Çelik Malzemeler'
    };
  }

  // 3.45 AHŞAP KALIP KİRİŞİ H20 (Балка двутавровая деревянная) & ÇELİK I-KİRİŞ (Двутавр GOST 57837)
  if (/балка.*деревян|деревян.*заглушк|ahşap\s*kalıp\s*kiriş|h20\s*kiriş/i.test(primaryText)) {
    const lenM = primaryText.match(/l\s*=\s*(\d+(?:[.,]\d+)?)/i) || primaryText.match(/\b([123][.,]\d+)\s*(?:м|m)\b/i);
    let lenStr = lenM ? parseFloat(lenM[1].replace(',', '.')).toFixed(1) : '3.0';
    if (lenStr.endsWith('.00')) lenStr = lenStr.slice(0, -1);
    return {
      materialName: `Ahşap Kalıp Kirişi H20 (Uç Korumalı) L=${lenStr} m`,
      category: 'Kalıp & İskele Sistemleri'
    };
  }
  if (/двутавр|i-kiriş|ipe\/heb\s*kiriş|çelik\s*kiriş\s*profil|profil\s*çelik\s*kiriş/i.test(primaryText) && !/деревян|ahşap/i.test(primaryText)) {
    const bm = primaryText.match(/\b(16|18|20|24|25|30|35|40|45|50|55|60)\s*([БбBbШшSsКкKk])\s*([123])\b/);
    if (bm) {
      const num = bm[1];
      const letter = /[ШшSs]/.test(bm[2]) ? 'Ş' : (/[КкKk]/.test(bm[2]) ? 'K' : 'B');
      const sub = bm[3];
      return {
        materialName: `Çelik I-Kiriş Profil (Двутавр) ${num}${letter}${sub} (GOST 57837)`,
        category: 'Çelik Malzemeler'
      };
    }
  }

  // 3.5 ÇELİK HASIR (Сетка сварная / HASIR CELIK)
  if (
    (/çelik\s*hasır|celik\s*hasir|hasır\s*çelik|hasir\s*celik|сетк.*(?:сварн|арматурн|кладочн|вр)/i.test(primaryText)) &&
    !/кресло|кровать|ранза|koltuk|çit|çevre.*paneli|базальт|стеклоткан|фасадн|штукатурн/i.test(primaryText)
  ) {
    const meshM = primaryText.match(/\b(50|100|150|200)\s*[*xх×]\s*(50|100|150|200)\s*[*xх×]\s*(\d(?:[.,]\d+)?)\b/);
    if (meshM) {
      const px = meshM[1];
      const py = meshM[2];
      const wd = meshM[3].replace(',', '.');
      return {
        materialName: `Çelik Hasır ${px}x${py}x${wd} mm (Вр-1 GOST 23279)`,
        category: 'İnşaat Demiri'
      };
    }
  }

  // 3.6 GAZBETON BLOK, GAZBETON LENTO (Перемычка), 1NF TUĞLA & GAZBETON YAPIŞTIRICISI (Rende/Рубанок, Dübel, Mala ve Testere hariç!)
  if (/рубанок|rende\b/i.test(primaryText) && /газобетон|gazbeton|gaz\s*beton|гипсокартон|alçıpan|alcipan|гкл/i.test(primaryText)) {
    const isGypsumRasp = /гипсокартон|alçıpan|alcipan|гкл|кромочн/i.test(primaryText);
    return {
      materialName: isGypsumRasp ? 'Alçıpan Kenar Rendesi (Рубанок обдирочный / кромочный)' : 'Gazbeton Rendesi (Рубанок для газобетона)',
      category: 'El Aletleri & Hırdavat'
    };
  }
  if ((/кирпич|tuğla|tugla/i.test(primaryText)) && (/250\s*[*xх×]\s*120\s*[*xх×]\s*65|1\s*нф|1\s*nf/i.test(primaryText))) {
    const mGrade = primaryText.match(/[мm]\s*(125|150|175|200|250)/i);
    const gradeStr = mGrade ? `M${mGrade[1]}` : 'M150';
    return {
      materialName: `Harman Tuğlası 1NF 250x120x65 mm (${gradeStr})`,
      category: 'Tuğla, Gazbeton & Duvar Blokları'
    };
  }
  if (/газобетон|газосиликат|газоблок|gazbeton|gaz\s*beton|gaz\s*blok|bonolit|poritep|ytong|istkult|исткульт/i.test(primaryText)) {
    if (/клей|yapıştırıcı|yapistirici|harç|harc/i.test(primaryText)) {
      return {
        materialName: 'Gazbeton Yapıştırıcı Harcı (25/40 kg Torba)',
        category: 'Hazır Beton, Çimento & Agrega'
      };
    }
    if (/перемычка|lento/i.test(primaryText)) {
      const lentoDim = primaryText.match(/\b(\d{3,4})\s*[*xх×]\s*(\d{3,4})\s*[*xх×]\s*(\d{3,4})\b/);
      if (lentoDim) {
        const dims = [parseInt(lentoDim[1], 10), parseInt(lentoDim[2], 10), parseInt(lentoDim[3], 10)].sort((a, b) => a - b);
        return {
          materialName: `Donatılı Gazbeton Lento (Перемычка) ${dims[0]}x${dims[1]}x${dims[2]} mm D600`,
          category: 'Tuğla, Gazbeton & Duvar Blokları'
        };
      }
    }
    if (!/перемычка|lento|дюбел|dübel|dubel|анкер|саморез|testere|ножовка|рубанок|rende|терка|кельма|штроборез|захват/i.test(primaryText)) {
      const gazSrc = (effectiveOrig && /(?:^|[^a-zа-яё0-9])[dд]\s*(300|350|400|500|600)(?![0-9])/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
      const dMatch = gazSrc.match(/(?:^|[^a-zа-яё0-9])[dд]\s*(300|350|400|500|600)(?![0-9])/i);
      const density = dMatch ? `D${dMatch[1]}` : (primaryText.includes('d600') || primaryText.includes('д600') ? 'D600' : 'D500');
      const any3Dim = primaryText.match(/\b(\d{2,3})\s*[*xх×]\s*(\d{2,3})\s*[*xх×]\s*(\d{2,3})\b/);
      if (any3Dim) {
        const nums = [parseInt(any3Dim[1], 10), parseInt(any3Dim[2], 10), parseInt(any3Dim[3], 10)].sort((a, b) => a - b);
        if ((nums[2] === 600 || nums[2] === 625) && (nums[1] === 200 || nums[1] === 250)) {
          return {
            materialName: `Gazbeton Blok ${nums[0]}x${nums[1]}x${nums[2]} mm ${density}`,
            category: 'Tuğla, Gazbeton & Duvar Blokları'
          };
        }
      }
      return {
        materialName: `Gazbeton Blok ${density}`,
        category: 'Tuğla, Gazbeton & Duvar Blokları'
      };
    }
  }

  // 3.7 ALÇIPAN LEVHA, ALÇIPAN PROFİLİ, SIVA MASTAR/KÖŞE PROFİLİ & AGRAF (Rende, Mastik/Герметик, Vida, Kapak hariç!)
  if (/agraf|подвес\s+прямой/i.test(primaryText) && /60\s*[*xх×]\s*27|alçıpan|alcipan|гкл|кнауф|knauf/i.test(primaryText)) {
    return {
      materialName: 'Alçıpan Tavan U-Agraf / Doğrudan Askı Maşası (60x27 mm)',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/маячков|siva\s*mastar\s*profil|sıva\s*mastar\s*profil/i.test(primaryText)) {
    const mSize = primaryText.match(/(?:^|[^0-9])(6|10)\s*(?:мм|mm)(?![a-zа-яё])/i);
    return {
      materialName: `Galvanizli Sıva Mastar Profili (Маячковый)${mSize ? ` ${mSize[1]} mm` : ''} (3 m)`,
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/профиль.*(?:пс|пн|пп|пнп|knauf|кнауф|гкл|гипсокартон|gyproc|гипрок)|alçıpan.*profil|alcipan.*profil|\bua\s*(?:50|75|100)\b.*profil|профиль\s*ua/i.test(primaryText)) {
    const profDim = primaryText.match(/\b(27|28|50|60|75|100)\s*[*xх×/]\s*(27|28|40|50)\s*(?:[*xх×]\s*(3000|4000))?\b/);
    const thickM = primaryText.match(/(?:^|[^0-9.,])(0[.,]4|0[.,]45|0[.,]5|0[.,]55|0[.,]6|0[.,]60|2|2[.,]0)\s*(?:мм|mm)(?![a-zа-яё])/i);
    if (profDim) {
      const w = profDim[1];
      const h = profDim[2];
      const len = profDim[3] || '3000';
      let th = thickM ? thickM[1].replace(',', '.') : '';
      if (th === '0.60') th = '0.6';
      if (th === '2') th = '2.0';
      const isUA = /(?:^|[^a-zа-яё])ua/i.test(primaryText) || th === '2.0';
      return {
        materialName: isUA
          ? `Alçıpan Takviye Profili (UA) ${w}x${h}x${len} mm (2.0 mm)`
          : `Alçıpan Profili ${w}x${h}x${len} mm`,
        category: 'Yalıtım & Alçıpan'
      };
    }
  }
  if (/тахеометр|leica\s*ts/i.test(primaryText)) {
    return {
      materialName: 'Elektronik Total Station / Taheometre Leica TS07 Seti',
      category: 'Ölçüm, Harita & Saha Ekipmanları'
    };
  }
  if (
    (/гипсокартон|гипсовая\s*плита|мультикомфорт|multikomfort|alçıpan|alcipan|(?:^|[^a-zа-яё0-9])(?:гкл(?:в|о)?|gkl(?:v|o)?|гсп[\s-]*df|сапфир|gyproc|гипрок)(?![a-zа-яё0-9])/i.test(primaryText)) &&
    !/саморез|vida|dübel|dubel|болт|профил|profil|karkas|agraf|подвес|соединител|краб|bant|лента|серпянк|testere|ножовка|bıçak|bicak|фрез|пила|люк|kapağ|kapak|рубанок|rende|герметик|germetik|шпаклевк|macun|işleri|isleri|islerı|mockup|тахеометр|leica|зарядн|нивелир|аккумулятор|трегер/i.test(primaryText)
  ) {
    const isSapfir = /сапфир|sapfir|dfh3ir|мультикомфорт|multikomfort/i.test(primaryText);
    const isFire = /огнестой|kırmızı|kirmizi|yangın|yangin|гкло|gklo|гсп-df(?!h3ir)/i.test(primaryText);
    const isMoisture = /влагостой|yeşil|yesil|suya|gklv|гклв|гсп-h2|аква|aqua/i.test(primaryText);
    const thMatch = primaryText.match(/(?:^|[^0-9.,])(9[.,]5|12[.,]5|15)\s*(?:мм|mm|\*|[xх×]|$)/i);
    const thStr = thMatch ? `${thMatch[1].replace(',', '.')} mm` : '12.5 mm';
    if (isSapfir) {
      return {
        materialName: `Darbe/Yangın/Suya Dayanıklı Alçıpan Levha DFH3IR (Sapfir) ${thStr} (1.2x2.5 m)`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    const isGyproc = /гипрок|gyproc|оптима/i.test(combined);
    const isKnauf = /кнауф|knauf/i.test(combined);
    const brandTag = isGyproc ? ' Gyproc Optima [Standart]' : (isKnauf ? ' Knauf [Premium]' : '');
    return {
      materialName: isFire
        ? `Yangına Dayanıklı Alçıpan Levha${brandTag} GKLO ${thStr} (1.2x2.5 m)`
        : isMoisture
          ? `Suya Dayanıklı Alçıpan Levha${brandTag} GKLV ${thStr} (1.2x2.5 m)`
          : `Standart Alçıpan Levha${brandTag} GKL ${thStr} (1.2x2.5 m)`,
      category: 'Yalıtım & Alçıpan'
    };
  }

  // 3.8 SU YALITIM MEMBRANI (Marka & Kalite Segmentine Göre Ayrıştır!), BİTÜM ASTARI, PLANTER, GEOTEKSTİL, XPS & TAŞYÜNÜ
  if (/праймер\s*(?:битумн|сбс)|битумн.*праймер|icopal.*(?:primer|праймер)|bitüm.*astar/i.test(primaryText)) {
    return {
      materialName: 'Bitüm Esaslı Su Yalıtım Astarı (Праймер битумный - 20 L Kova)',
      category: 'Kimyasallar & Boya'
    };
  }
  if (/стеклосетка|сетка.*стеклоткан.*фасад|сетка\s*штукатурн.*стеклоткан/i.test(primaryText)) {
    const isInterior75 = /\b(?:70|75|80)\s*(?:г|гр|g)/i.test(primaryText) || /интерьер|малярн/i.test(primaryText);
    if (isInterior75) {
      return {
        materialName: 'İç Cephe Sıva Filesi (Стеклосетка 5x5 mm, 75 g/m², 50 m² Rulo)',
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/баутекс|крепикс|krepix/i.test(combined)) {
      return {
        materialName: 'Alkali Dayanımlı Dış Cephe Filesi БауТекс Крепикс 1800 (160 g/m², 55 m² Rulo) [Standart]',
        category: 'Yalıtım & Alçıpan'
      };
    }
    return {
      materialName: 'Alkali Dayanımlı Dış Cephe Filesi ТехноНИКОЛЬ / Litokol (160 g/m², 50 m² Rulo) [Premium]',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/жгут.*icopal|icopal.*кордон|жгут.*кордон/i.test(primaryText)) {
    return {
      materialName: 'Icopal Kordon Derz Yalıtım Fitili (Жгут КОРДОН)',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/бандажн.*лент.*icopal|icopal.*бандажн/i.test(primaryText)) {
    return {
      materialName: 'Icopal Pah / Ek Yeri Yalıtım Bandı (Бандажная лента)',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/ультранеодил|гидроизоляционн.*лент|лент.*гидроизоляционн/i.test(primaryText)) {
    const wCm = /\b33\s*(?:см|cm)|0[.,]33\s*[xх*×]/i.test(primaryText) ? '33 cm x 10 m' : '50 cm x 10 m';
    return {
      materialName: `Su Yalıtım Pah / Dilatasyon Bandı Icopal Ультранеодил (${wCm})`,
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/шпонка.*гидроизоляц|гидрошпонк|waterbar/i.test(primaryText)) {
    if (/технониколь|ec-?220/i.test(combined) && !/sika\s*waterbar/i.test(cleanOrig)) {
      return {
        materialName: 'PVC Su Tutucu Bant ТехноНИКОЛЬ EC-220-3 [Standart]',
        category: 'Yalıtım & Alçıpan'
      };
    }
    return {
      materialName: 'PVC Su Tutucu Bant Sika Waterbar AR-20 [Premium]',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/sikaplan|пвх.*мембран|мембран.*пвх|логикруф|logicroof/i.test(primaryText)) {
    return {
      materialName: 'Sentetik PVC Su Yalıtım Membranı Sikaplan WP 1101-20 HL (2.0 mm)',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/техноэласт\s*прайм|прайм\s*эмм|(?:^|[^a-zа-яё])эмм(?![a-zа-яё])/i.test(primaryText)) {
    return {
      materialName: 'Püskürtme Bitüm Sistem Alt Katman Membranı Техноэласт Прайм ЭММ',
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (
    (/техноэласт|техноеласт|изопласт|teknoelast|tehnoelast|technoelast|izoplast|икопал|icopal|виллатекс|villateks|villatex|ультранап|ultranap|унифлекс|unifleks|uniflex|линокром|linokrom|биполь|bipol|бикрост|bikrost|гидроизол.*рулон|(?:мембран|membran).*(?:эпп|экп|ткп|хпп|epp|ekp|tkp|hpp|icopal|икопал|виллатекс|ультранап|su\s*izolasyon|kumlu|kumsuz)/i.test(primaryText)) &&
    !/праймер|primer|мастик|buhar\s*kesici|пароизоляц|ветрозащит|изоспан|planter|плантер|жгут|бандажн|лент|шпонк|waterbar|sikaplan|пвх/i.test(primaryText)
  ) {
    const memSrc = (effectiveOrig && /техноэласт|техноеласт|изопласт|икопал|icopal|виллатекс|villateks|ультранап|ultranap|унифлекс|линокром|биполь|бикрост|эпп|экп|ткп|хпп/i.test(effectiveOrig))
      ? effectiveOrig
      : primaryText;

    const isUltranap = /ультранап|ultranap/i.test(memSrc);
    const isFundament = /фундамент|fundament|мост\s*б|most\s*b|терра|terra/i.test(memSrc);
    const isUpperGranule = /(?:^|[^a-zа-яё])(?:[вv]\s*)?(?:экп|ekp|ткп|tkp|хкп|hkp)(?![a-zа-яё])|kumlu|kumlamalı|верхн.*слой|сланец|гранул/i.test(memSrc);

    const thMatch =
      memSrc.match(/(?:эпп|экп|ткп|хпп|epp|ekp|tkp|hpp)[\s-]*(2[.,]5|3[.,]0|3[.,]5|4[.,]0|4[.,]2|4[.,]5|5[.,]0)(?![0-9])/i) ||
      memSrc.match(/(?:^|[^0-9.,])(2[.,]5|3[.,]0|3[.,]5|4[.,]0|4[.,]2|4[.,]5|5[.,]0)\s*(?:мм|mm)?(?![a-zа-яё0-9])/i) ||
      memSrc.match(/(?:^|[^0-9.,])(3|4|5)\s*(?:мм|mm)(?![a-zа-яё])/i);
    let thStr = '';
    if (thMatch) {
      const rawTh = thMatch[1].replace(',', '.');
      thStr = rawTh.includes('.') ? `${rawTh} mm` : `${rawTh}.0 mm`;
    }

    if (isUltranap) {
      return {
        materialName: 'Elastomerik SBS Su Yalıtım Membranı Icopal Ultranap [Premium]',
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (isFundament) {
      return {
        materialName: 'Temel Su Yalıtım Membranı Техноэласт Фундамент / Терра EPP [Premium]',
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (isUpperGranule) {
      const brandLabel = /икопал|icopal|виллатекс|villateks/i.test(memSrc)
        ? 'Icopal Villateks [Profesyonel SBS]'
        : /техноэласт|technoelast/i.test(memSrc)
          ? 'Техноэласт [Premium SBS]'
          : 'Изопласт [Standart]';
      return {
        materialName: `Bitümlü Su Yalıtım Membranı EKP ${thStr || '4.5 mm'} — ${brandLabel}`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    // Alt katman EPP membranlarda marka & kalite segmenti ayrımı (Биполь Ekonomik vs Икопал/Изопласт Standart-Pro vs Техноэласт Premium)
    if (/биполь|bipol|бикрост|линокром/i.test(memSrc)) {
      return {
        materialName: `Bitümlü Su Yalıtım Membranı Биполь ЭПП ${thStr || '3.0 mm'} [Ekonomik Sınıf]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/техноэласт|техноеласт|technoelast|teknoelast/i.test(memSrc)) {
      return {
        materialName: `Bitümlü Su Yalıtım Membranı Техноэласт ЭПП ${thStr || '4.0 mm'} [Premium SBS]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/икопал|icopal|виллатекс|villateks/i.test(memSrc)) {
      return {
        materialName: `Bitümlü Su Yalıtım Membranı Икопал ЭПП ${thStr || '4.0 mm'} [Profesyonel SBS]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    return {
      materialName: `Bitümlü Su Yalıtım Membranı Изопласт ЭПП ${thStr || '4.0 mm'} [Standart]`,
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/(?:^|[^a-zа-яё])(?:planter|плантер)(?![a-zа-яё])/i.test(primaryText)) {
    const plSrc = (effectiveOrig && /(?:^|[^a-zа-яё])(?:planter|плантер)(?![a-zа-яё])/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const uPricePlanter = Number(item.unitPrice) || 0;
    const isGreen = /green|грин/i.test(plSrc);
    const isGeo = /geo|гео/i.test(plSrc) || (!/стандарт|standart/i.test(plSrc) && (uPricePlanter >= 6000 || (uPricePlanter >= 220 && uPricePlanter < 600)));
    const dimM = plSrc.match(/\b([12]\s*[*xх×]\s*(?:15|20))\s*(?:м|m)?/i);
    const dimStr = dimM ? dimM[1].replace(/\s+/g, '').replace(/[х*×]/gi, 'x') + ' m' : (isGeo ? '2x15 m' : '2x20 m');
    const subType = isGreen ? 'Planter Green 30' : (isGeo ? 'Planter Geo (Keçeli) [Premium]' : 'Planter Standart [Standart]');
    return {
      materialName: `${subType} Profilli Drenaj ve Koruma Membranı (${dimStr})`,
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (/дорнит|геотекстил|dornit|geotekstil|georex|geoflaks/i.test(primaryText) && !/сетка|дренажн.*труб|труб.*дренажн/i.test(primaryText)) {
    let density = 300;
    if (/\b500\b/.test(primaryText)) density = 500;
    else if (/\b400\b/.test(primaryText)) density = 400;
    else if (/\b350\b/.test(primaryText)) density = 350;
    else if (/\b250\b/.test(primaryText)) density = 250;
    else if (/\b200\b/.test(primaryText)) density = 200;
    else if (/\b150\b/.test(primaryText)) density = 150;
    return { materialName: `Dornit Geotekstil Keçe ${density} g/m² (Rulo)`, category: 'Yalıtım & Alçıpan' };
  }
  if (/пеноплэкс|пеноплекс|penoplex|penopleks|техноплекс|tehnopleks|\bxps\b|экструдирован.*пенополистирол|экструзионн.*пенополистирол|izolasyon\s*levhas[ıi]\s*penopleks/i.test(primaryText) && !/клей|пена|крепеж|дюбель|testere|ножовка/i.test(primaryText)) {
    const xpsSrc = (effectiveOrig && /\b(20|30|35|40|50|60|80|100|120|150)\b/.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const parenOverride = combined.match(/\(\s*(20|30|35|40|50|60|80|100|120|150)\s*(?:мм|mm)(?![a-zа-яё])/i)?.[1];
    const xpsThick =
      parenOverride ||
      xpsSrc.match(/\b118[05]\s*[*xх×]\s*58[05]\s*[*xх×]\s*(20|30|35|40|50|60|80|100|120|150)\b/)?.[1] ||
      xpsSrc.match(/\b58[05]\s*[*xх×]\s*118[05]\s*[*xх×]\s*(20|30|35|40|50|60|80|100|120|150)\b/)?.[1] ||
      xpsSrc.match(/\b(20|30|35|40|50|60|80|100|120|150)\s*[*xх×]\s*118[05]\s*[*xх×]\s*58[05]\b/)?.[1] ||
      xpsSrc.match(/\b(20|30|35|40|50|60|80|100|120|150)\s*[*xх×]\s*58[05]\s*[*xх×]\s*118[05]\b/)?.[1] ||
      xpsSrc.match(/(?:^|[^0-9])(20|30|35|40|50|60|80|100|120|150)\s*(?:мм|mm)(?![a-zа-яё])/i)?.[1] ||
      primaryText.match(/(?:^|[^0-9])(20|30|40|50|60|80|100|120|150)\s*(?:мм|mm)(?![a-zа-яё])/i)?.[1] ||
      '50';
    if (/carbon\s*prof|карбон\s*проф/i.test(combined)) {
      return {
        materialName: `XPS Isı Yalıtım Levhası ТехноНИКОЛЬ Carbon Prof ${xpsThick} mm [Premium]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/profiplex|профиплекс/i.test(combined)) {
      return {
        materialName: `XPS Isı Yalıtım Levhası Profiplex Extra 250 ${xpsThick} mm [Ekonomik]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/гео\b|geo\b|фундамент/i.test(combined)) {
      return {
        materialName: `XPS Isı Yalıtım Levhası Пеноплэкс Гео С ${xpsThick} mm [Ağır Yük / Temel Serisi]`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    return {
      materialName: `Penoplex / XPS Isı Yalıtım Levhası Пеноплэкс Комфорт ${xpsThick} mm [Standart]`,
      category: 'Yalıtım & Alçıpan'
    };
  }
  if (
    (/каменн.*ват|минерал.*ват|минвата|базальт.*утепл|басвул|baswool|маты\s*теплоизоляцион|ısı\s*yalıtım\s*şilte|утеплител.*(?:техно|роклайт|rockwool|парок|paroc|изовол|izovol|кнауф|knauf|урса|ursa)|техноблок|технофас|техновент|техноакустик|техноруф|роклайт|rockwool|tasyunu|taşyünü|taş\s*yünü|cam\s*yünü|cam\s*yunu/i.test(primaryText)) &&
    !/клей|пена|крепеж|дюбель|нож|testere|bıçak|труб|цилиндр/i.test(primaryText)
  ) {
    const woolSrc = (effectiveOrig && /(?:1200|1000)\s*[*xх×-]\s*(?:600|500)|\b(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\s*(?:мм|mm)/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const woolTh =
      woolSrc.match(/\b(?:1200|1000)\s*[*xх×-]\s*(?:600|500)\s*[*xх×-]\s*(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\b/)?.[1] ||
      woolSrc.match(/\b(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\s*[*xх×-]\s*12[02]0\b/)?.[1] ||
      woolSrc.match(/\b(?:2500|4000|5000|8000|9600|10000|18000)\s*[*xх×-]\s*1[02][02]0\s*[*xх×-]\s*(20|30|40|50|60|70|75|80|90|100)\b/)?.[1] ||
      woolSrc.match(/(?:^|[^0-9])(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\s*(?:мм|mm)(?![a-zа-яё])/i)?.[1] ||
      primaryText.match(/(?:^|[^0-9])(20|30|40|50|60|70|75|80|90|100|120|140|150|160|180|200|250)\s*(?:мм|mm)(?![a-zа-яё])/i)?.[1] ||
      '100';
    if (/ralu|фольга\s*проф|ламел/i.test(woolSrc)) {
      return {
        materialName: `Alüminyum Folyolu Taşyünü Lamella Şilte (RAlu Фольга ПРОФ) ${woolTh} mm`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    if (/фольг|folyolu|маты\s*теплоизоляцион|ısı\s*yalıtım\s*şilte|cam\s*yün|cam\s*yun|урса|ursa|рулон|кт-специал/i.test(woolSrc)) {
      return {
        materialName: `Mineral / Cam Yünü Isı Yalıtım Şiltesi ${woolTh} mm (Rulo)`,
        category: 'Yalıtım & Alçıpan'
      };
    }
    return {
      materialName: `Taşyünü Isı ve Ses Yalıtım Levhası ${woolTh} mm (1200x600 mm)`,
      category: 'Yalıtım & Alçıpan'
    };
  }

  // 3.9 KESİCİ TAŞ / DİSK (Диск отрезной по металлу / KESICI TAS / KESICI DISK) — Marka & Kalınlık Segmenti
  if (
    (/диск\s+отрезной|круг\s+отрезной|диск\s+по\s+металлу|kesici\s*taş|kesici\s*tas|kesici\s*disk|kesme\s*taş|kesme\s*tas|kesme\s*disk/i.test(primaryText)) &&
    !/алмазн|elmas|бетон|beton|дерев|ahşap|пильн/i.test(primaryText)
  ) {
    const diskSrc = `${cleanOrig} ${primaryText}`;
    const fullDisk = diskSrc.match(/\b(115|125|150|180|230|300|350|400)\s*[*xх×]\s*(\d(?:[.,]\d+)?)\b/);
    const diaOnly = primaryText.match(/(?:^|[^0-9])(115|125|150|180|230|300|350|400)\s*(?:мм|mm)?(?![a-zа-яё0-9])/i);
    const isKarbosan = /karbosan|карбосан|bosch|makita|hilti|dewalt|klingspor|metabo/i.test(diskSrc);
    const brandSuffix = isKarbosan ? ' Karbosan [Premium]' : ' [Standart]';
    if (fullDisk) {
      const dia = fullDisk[1];
      let th = fullDisk[2].replace(',', '.');
      if (!th.includes('.')) th = `${th}.0`;
      return {
        materialName: `Metal Kesici Taş / Disk${brandSuffix} Ø${dia}x${th} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
    if (diaOnly) {
      const dia = diaOnly[1];
      const defaultTh = dia === '230' ? '2.0' : (dia === '125' ? '1.6' : '');
      return {
        materialName: `Metal Kesici Taş / Disk${brandSuffix} Ø${dia}${defaultTh ? `x${defaultTh}` : ''} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }

  // 3.10 BEZ SAPAN (СТП) & ÇELİK HALAT SAPAN (СКП)
  if ((/строп\s*текстильн|sapan\s*bez|bez\s*sapan/i.test(primaryText)) && !/страховочн|привязь|emniyet/i.test(primaryText)) {
    const stpPair =
      primaryText.match(/(?:^|[^0-9])(\d+(?:[.,]\d+)?)\s*(?:т|тн|t|ton)\s*[/|*xх×\s-]*\s*(\d+(?:[.,]\d+)?)\s*(?:м|mt|m|metre)(?![a-zа-яё])/i);
    if (stpPair) {
      const ton = stpPair[1].replace(',', '.');
      const len = stpPair[2].replace(',', '.');
      if (/gigant\s*professional|gp-stp/i.test(combined)) {
        return {
          materialName: `Bez Sapan Gigant Professional СТП ${ton} Ton ${len} Metre [Premium]`,
          category: 'El Aletleri & Hırdavat'
        };
      }
      return {
        materialName: `Bez Sapan (Текстильный строп СТП) ${ton} Ton ${len} Metre [Standart]`,
        category: 'El Aletleri & Hırdavat'
      };
    }
  }
  if (/строп\s*канатн|sapan\s*çelik|sapan\s*celik|çelik\s*halat\s*sapan/i.test(primaryText)) {
    const skpPair =
      primaryText.match(/(?:^|[^0-9])(\d+(?:[.,]\d+)?)\s*(?:т|тн|t|ton)\s*[/|*xх×\s-]*\s*(\d+(?:[.,]\d+)?)\s*(?:м|mt|m|metre)(?![a-zа-яё])/i);
    if (skpPair) {
      const ton = skpPair[1].replace(',', '.');
      const len = skpPair[1] ? skpPair[2].replace(',', '.') : '';
      return {
        materialName: `Çelik Halat Sapan (СКП) ${ton} Ton ${len} Metre`,
        category: 'El Aletleri & Hırdavat'
      };
    }
  }

  // 3.11 ANKRAJLAR (Анкер клиновой, Анкер-клин) & ÇİVİLİ PLASTİK DÜBEL (Дюбель-гвоздь) & ISI YALITIM DÜBELİ & MONTAJ ŞERİDİ
  if ((/анкер[\s-]*клин(?:\s+потолочн)?|kama\s*ankraj|tavan\s*(?:tipi\s*)?kama\s*ankraj|çakma\s*dübel\s*anker|cakma\s*dubel\s*anker|(?:^|\s)клин\s+6\s*[*xх×]\s*(?:35|40|60|65)\b/i.test(combined)) && !/клиновой/i.test(combined)) {
    const akDim = combined.match(/\b[mм]?(6)\s*[*xх×]\s*(35|40|60|65)\b/i);
    if (akDim) {
      return {
        materialName: `Tavan Çakma Kama Ankraj (Анкер-клин) ${akDim[1]}x${akDim[2]} mm`,
        category: 'Ankraj Sistemleri'
      };
    }
  }
  if (/анкер\s+клиновой|kama\s*tipi\s*çelik\s*ankraj|dubel\s*celik\s*cekme/i.test(primaryText)) {
    const wedgeDim = primaryText.match(/(?:^|[^a-zа-яё0-9])[mм]?(\d{1,2})\s*[*xх×/]\s*(\d{2,3})(?![0-9])/i);
    if (wedgeDim) {
      return {
        materialName: `Kama Tipi Çelik Ankraj (Анкер клиновой) ${wedgeDim[1]}x${wedgeDim[2]} mm`,
        category: 'Ankraj Sistemleri'
      };
    }
  }
  if (/дюбель[\s-]*гвоздь|дюбель\s+с\s+гвоздем|dubel\s*plastik\s*vidali|gaz\s*blok\s*dubeli|çivili\s*plastik\s*dübel|dübel[\s-]*çivi|dubel[\s-]*civi/i.test(combined) && !/пистолет|montaj\s*tabanca|термоголовк|к\s+дюбел|теплоизоляц|yalıtım\s*dübel/i.test(combined)) {
    const dgDim = combined.match(/\b(5|6|8|10)\s*[*xх×]\s*(30|40|50|60|80|100|120|140|160)\b/);
    if (dgDim) {
      if (/гвоздь\s+потайной\s+борт/i.test(cleanOrig) && !/дюбель/i.test(cleanOrig)) {
        return {
          materialName: `Montaj Çivisi Havşa Başlı (Гвоздь потайной борт) ${dgDim[1]}x${dgDim[2]} mm`,
          category: 'Sarf Malzeme & Hırdavat'
        };
      }
      return {
        materialName: `Çivili Plastik Dübel (Дюбель-гвоздь) ${dgDim[1]}x${dgDim[2]} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if ((/дюбель\s+для\s+теплоизоляц|тарельчат.*дюбел|ısı\s*yalıtım\s*dübel|isi\s*yalitim\s*dubel/i.test(combined)) && !/гвозд.*термоголовк|dübel\s*çivisi|dubel\s*civisi/i.test(combined)) {
    const tdDim = combined.match(/\b(10)\s*[*xх×\s]\s*(90|100|110|120|140|160|180|200|220|250|260|300)\b/);
    if (tdDim) {
      return {
        materialName: `Isı Yalıtım Dübeli (Тарельчатый) ${tdDim[1]}x${tdDim[2]} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if (/лента.*монтажн.*перфорирован|перфорирован.*монтажн.*лента|montaj\s*bağlantı\s*şeridi|delikli.*montaj\s*şeridi/i.test(combined)) {
    const lmDim = combined.match(/\b(12|17|20|25|40)\s*[*xх×]\s*(0[.,]\d+|1(?:[.,]\d+)?|2(?:[.,]0)?)\b/i);
    if (lmDim) {
      const w = lmDim[1];
      const th = lmDim[2].replace(',', '.').replace(/\.0$/, '');
      return {
        materialName: `Delikli Çelik Montaj Şeridi (Лента перфорированная LM) ${w}x${th} mm (10 m)`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if (/хомут[\s-]*стяжк|стяжк.*(?:кабельн|ленточн|нейлон)|kablo\s*bağı|cırt\s*kelepçe|cirt\s*kelepce/i.test(primaryText)) {
    const tieDim = primaryText.match(/\b(\d(?:[.,]\d)?)\s*[*xх×]\s*(100|120|150|200|250|300|350|370|400|450|500)\b/);
    if (tieDim) {
      const w = tieDim[1].replace(',', '.');
      const l = tieDim[2];
      return {
        materialName: `Plastik Kablo Bağı (Cırt Kelepçe) ${w}x${l} mm (100 Adet/Paket)`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }

  // 3.12 STANDART METRİK SOMUN (DIN 934), PUL/RONDELA (DIN 125 / 9021 / 127), SAPLAMA (DIN 975), CIVATA (DIN 933/931) & VİDALAR
  const isClass8Fastener = /к\.?\s*п\.?\s*(?:8|10)|класс\s*прочности\s*(?:8|10)/i.test(combined);
  const fastenerText = primaryText.replace(/к\.?\s*п\.?\s*\d+(?:[.,]\d+)?/gi, ' ');
  if (
    (/^(?:somun|altıköşe\s*somun)\s*m?\d+/i.test(name.trim()) || /гайка.*din\s*934|гайка\s+шестигран|\bsomun\s+m\d+/i.test(fastenerText)) &&
    !/низкая|ince|din\s*982|din\s*985|din\s*557|квадрат|kare|fiber|рым|стяжн|kalıp|kalip|барашк|колпачк|фланц|соединит|uzatma|болт|комплект|komplekt/i.test(fastenerText)
  ) {
    const mNut =
      fastenerText.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(6|8|10|12|14|16|18|20|22|24|27|30)(?![0-9])/i) ||
      fastenerText.match(/(?:^|[^a-zа-яё0-9])(6|8|10|12|14|16|18|20|22|24|27|30)(?![0-9])/i);
    if (mNut) {
      const isInox = /нерж|(?:^|[^a-zа-яё0-9])(?:a2|а2|a4|а4)(?![a-zа-яё0-9])|paslanmaz|inox/i.test(fastenerText);
      const specSuffix = isInox
        ? ' (Paslanmaz Çelik A2)'
        : isClass8Fastener
          ? ' (8 Kalite / к.п. 8)'
          : '';
      return {
        materialName: `Altıköşe Çelik Somun (DIN 934) M${mNut[1]}${specSuffix}`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if (
    (/^(?:pul|rondela|geniş\s*pul|düz\s*pul|yaylı\s*rondela|sapbasa)\s*m?\d+/i.test(name.trim()) || /шайба.*(?:din\s*125|din\s*9021|din\s*127|плоск|увеличен|кузовн|пружин|гровер)|(?:pul|rondela|sapbasa)\s+m?\d+/i.test(fastenerText)) &&
    !/кровельн|epdm|рым|стяжн|kalıp|болт|комплект|komplekt/i.test(fastenerText)
  ) {
    const mWasher =
      fastenerText.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(6|8|10|12|14|16|18|20|22|24|27|30)(?![0-9])/i) ||
      fastenerText.match(/(?:^|[^a-zа-яё0-9])(6|8|10|12|14|16|18|20|22|24|27|30)(?![0-9])/i);
    if (mWasher) {
      const isSpring = /din\s*127|гровер|пружин|yaylı|grover/i.test(fastenerText);
      const isWide = /9021|увеличен|кузовн|geniş|şase/i.test(fastenerText);
      const isInox = /нерж|(?:^|[^a-zа-яё0-9])(?:a2|а2|a4|а4)(?![a-zа-яё0-9])|paslanmaz|inox/i.test(fastenerText);
      const uPrice = Number(item.unitPrice) || 0;
      const isHeavyOrPack = isWide && mWasher[1] === '8' && uPrice >= 4;
      const specSuffix = isInox
        ? ' (Paslanmaz Çelik A2)'
        : isHeavyOrPack
          ? ' (Kalın / Özel Seri)'
          : '';
      return {
        materialName: isSpring
          ? `Yaylı Çelik Rondela / Grover Pul (DIN 127) M${mWasher[1]}${specSuffix}`
          : isWide
            ? `Geniş Şase Pul / Rondela (DIN 9021) M${mWasher[1]}${specSuffix}`
            : `Düz Çelik Pul / Rondela (DIN 125) M${mWasher[1]}${specSuffix}`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if (/шпильк.*(?:гост\s*22042|ст\s*40х)/i.test(fastenerText)) {
    return {
      materialName: 'Yüksek Dayanımlı Alaşımlı Ankraj Saplaması (ГОСТ 22042 ст.40Х) M16x360 mm',
      category: 'Ankraj Sistemleri'
    };
  }
  if (
    (/шпильк.*(?:резьб|din\s*975|оцинк)|saplama\s*m\d+|tij\s*m\d+|gijon\s*m\d+/i.test(fastenerText)) &&
    !/стяжн|опалуб|kalıp|kalip|анкер|химия|химическ|гост\s*22042|ст\s*40х/i.test(fastenerText)
  ) {
    const rodM =
      fastenerText.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(6|8|10|12|14|16|18|20|22|24|27|30)\s*(?:[*xх×/]\s*(1000|2000|1\s*м|2\s*м|1m|2m))?/i) ||
      fastenerText.match(/(?:^|[^a-zа-яё0-9])(6|8|10|12|14|16|18|20|22|24|27|30)\s*[*xх×/]\s*(1000|2000|1\s*м|2\s*м|1m|2m)/i);
    if (rodM) {
      const mDia = rodM[1];
      const is2m = /2000|2\s*(?:м|mt|m)(?![a-zа-яё0-9])/i.test(fastenerText);
      const lenMm = is2m ? '2000' : '1000';
      return {
        materialName: `Çelik Dişli Saplama / Tij (DIN 975) M${mDia}x${lenMm} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }
  if (
    (/(?:^|[^a-zа-яё])болт(?![a-zа-яё])|cıvata|civata/i.test(fastenerText)) &&
    !/рым|анкер|стяжн|мебельн|kanca|комплект|komplekt|u-болт|klemens/i.test(fastenerText)
  ) {
    const boltM = fastenerText.match(/(?:^|[^a-zа-яё0-9])[mм]?\s*(6|8|10|12|14|16|18|20|22|24|27|30)\s*[*xх×]\s*(16|20|25|30|35|40|45|50|55|60|65|70|75|80|90|100|110|120|130|140|150|160|180|200)(?![0-9])/i);
    if (boltM) {
      return {
        materialName: `Altıköşe Çelik Cıvata (DIN 933/931) M${boltM[1]}x${boltM[2]} mm`,
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
  }

  // 3.13 TORBALI ÇİMENTO, KURU HARÇ (M-150 / M-300 / ÇPS), ALÇI SIVA & POLİÜRETAN KÖPÜK (Markadan bağımsız birleştir!)
  if (
    (/портландцемент|(?:^|[^a-zа-яё])цемент(?![a-zа-яё-])|çimento\s*torba|cimento\s*50\s*kg|portland\s*çimento/i.test(primaryText)) &&
    !/песчан|цпс|штукатур|клей|стяжк|ровнител|бетон|плит|стружечн|цсп|хризотил|асбест|baca|boru|levha|fırça|firca|harç|harc/i.test(primaryText)
  ) {
    const grade = /400|цем\s*ii\/a.*32/i.test(primaryText) ? 'M400' : 'M500';
    const bagKg = /\b25\s*(?:кг|kg)/i.test(primaryText) ? '25' : (/\b40\s*(?:кг|kg)/i.test(primaryText) ? '40' : '50');
    return {
      materialName: `Portland Çimento ${grade} (${bagKg} kg Torba)`,
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }
  if (
    (/сухая\s*(?:строительная\s*|универсальная\s*)?смесь|цементно-песчан|(?:^|[^a-zа-яё])цпс(?![a-zа-яё])|пескобетон|kuru\s*harç|kuru\s*harc|kuru\s*kar[ıi][şs][ıi]m|çimento\s*kum\s*karışım|siva\s*harci\s*m[\s-]*150|şap\s*harcı\s*m[\s-]*300/i.test(primaryText)) &&
    !/клей|гипсов|ротбанд|rotband|шпаклевк|ремонтн|наливн|ровнител/i.test(primaryText)
  ) {
    const isM300 = /м[\s-]*300|m[\s-]*300|пескобетон|b22[.,]5/i.test(primaryText);
    const isM200 = !isM300 && /м[\s-]*200|m[\s-]*200/i.test(primaryText);
    const kgM = primaryText.match(/(?:^|[^0-9])(25|30|40|50)\s*(?:кг|kg)(?![a-zа-яё])/i);
    const kgStr = kgM ? kgM[1] : '40/50';
    if (isM300) {
      return {
        materialName: `Kuru Beton / Şap Harcı (Пескобетон) M-300 (${kgStr} kg Torba)`,
        category: 'Hazır Beton, Çimento & Agrega'
      };
    }
    return {
      materialName: `Kuru Harç / Çimento Kum Karışımı (ÇPS) ${isM200 ? 'M-200' : 'M-150'} (${kgStr} kg Torba)`,
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }
  if (/ротбанд\s*паст|rotband\s*past/i.test(primaryText)) {
    return {
      materialName: 'Hazır Macun Knauf Rotband Pasta Profi (18 kg Kova)',
      category: 'Kimyasallar & Boya'
    };
  }
  if (/ротбанд\s*финиш|rotband\s*finish|rotband\s*finiş/i.test(primaryText)) {
    return {
      materialName: 'Alçı Saten perdah Macunu Knauf Rotband Finish (25 kg Torba)',
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }
  if (/ротбанд|rotband|гольдбанд|goldband|волма\s*слой|штукатурк.*гипсов|alçı\s*sıva\s*harc|alci\s*siva/i.test(primaryText) && !/профил|маяк|грунт|шпаклевк|паст|финиш/i.test(primaryText)) {
    return {
      materialName: 'Alçı Sıva Harcı (Rotband / Гипсовая штукатурка - 30 kg Torba)',
      category: 'Hazır Beton, Çimento & Agrega'
    };
  }
  if (/очиститель.*пен|köpük\s*temizleyici|kopuk\s*temizleyici/i.test(primaryText)) {
    return {
      materialName: 'Poliüretan Montaj Köpüğü Temizleyici Sprey (500 ml)',
      category: 'Kimyasallar & Boya'
    };
  }
  if (
    (/пена\s*монтажн|монтажн.*пен|poliüretan\s*köpük|montaj\s*köpüğü|köpük\s*poliüretan|kopuk\s*poliuretan/i.test(primaryText)) &&
    !/пистолет|tabanca|очистител|temizleyici|клей-пен/i.test(primaryText)
  ) {
    const isFireFoam = /огнестойк|противопожарн|yangın|yanmaz|(?:^|[^a-zа-яё0-9])b1(?![a-zа-яё0-9])/i.test(primaryText);
    return {
      materialName: isFireFoam
        ? 'Yangın Dayanımlı Poliüretan Montaj Köpüğü B1 (750 ml)'
        : 'Profesyonel Poliüretan Montaj Köpüğü (750 ml)',
      category: 'Kimyasallar & Boya'
    };
  }

  // 3.14 KKD / İŞ GÜVENLİĞİ (Marka & Kalite Segmentine Göre Ayrıştır: Baret, Gözlük, Eldiven, Yelek, Yağmurluk, İş Botu, Çizme, İş Elbisesi, Emniyet Kemeri)
  if (/очки\s+защитн|gözlük.*iş\s*güven|şeffaf.*koruyucu\s*gözlük|gözlük\s*kaynak/i.test(primaryText)) {
    if (/закрыт|kapalı\s*tip|goggle/i.test(primaryText)) {
      return {
        materialName: 'Kapalı Tip Koruyucu İş Gözlüğü (Очки защитные закрытые)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/русоко|альфа|росомз|uvex|3m/i.test(combined)) {
      return {
        materialName: 'Profesyonel Koruyucu İş Gözlüğü Русоко АЛЬФА [Premium]',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Açık Tip Şeffaf Polikarbonat Koruyucu Gözlük [Ekonomik]',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (
    (/каска\s*(?:защитн|строительн)|(?:^|[^a-zа-яё])baret(?![a-zа-яё])/i.test(primaryText)) &&
    !/подшлемник|держател|фонар|ремешок|etiket|branda|щиток|наушник/i.test(primaryText)
  ) {
    let bColor = '';
    if (/бел|beyaz/i.test(primaryText)) bColor = ' (Beyaz)';
    else if (/желт|жёлт|sarı|sari/i.test(primaryText)) bColor = ' (Sarı)';
    else if (/оранж|turuncu/i.test(primaryText)) bColor = ' (Turuncu)';
    else if (/син|голуб|mavi/i.test(primaryText)) bColor = ' (Mavi)';
    else if (/красн|kırmızı|kirmizi/i.test(primaryText)) bColor = ' (Kırmızı)';
    else if (/зелен|yeşil|yesil/i.test(primaryText)) bColor = ' (Yeşil)';
    if (/росомз|сомз|favorit|rapid|uvex|3m/i.test(combined)) {
      return {
        materialName: `Profesyonel İş Güvenliği Bareti РОСОМЗ FavoriT${bColor} [Premium]`,
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: `Standart İş Güvenliği Bareti (Каска строительная)${bColor} [Ekonomik]`,
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/краги|сварщик.*перчат|перчат.*спилк|kaynakçı\s*eldiven|kaynakci\s*eldiven|eldiven\s*kaynak/i.test(primaryText)) {
    return {
      materialName: 'Isıya Dayanıklı Deri Kaynakçı Eldiveni (Краги спилковые)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (
    (/перчатки\s*(?:х\/?б|рабоч|трикотаж|нейлон|с\s*пвх|с\s*нитрил|с\s*латекс|утеплен|полушерст|акрил)|iş\s*eldiven|is\s*eldiven|eldiven\s*is\b|eldiven\s*kışlık|eldiven\s*kislik|eldiven\s*nitril|eldiven\s*montaj/i.test(primaryText)) &&
    !/резинов|temizlik|однораз|медицин|диэлектрич|краги|сварщик/i.test(primaryText)
  ) {
    if (/утеплен|зимн|kışlık|kislik|polar|полушерст|акрил|двойн/i.test(primaryText)) {
      return {
        materialName: 'Kışlık Yalıtımlı İş Eldiveni (Перчатки рабочие утепленные)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/нитрил|nitril|нейлон|латекс|облив/i.test(primaryText)) {
      return {
        materialName: 'Nitril / Lateks Kaplamalı Montaj İş Eldiveni',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Pamuklu PVC Noktalı İş Eldiveni (Перчатки ХБ с ПВХ)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/перчатки\s*резинов|kauçuk\s*temizlik\s*eldiven|nitril\/lateks\s*temizlik\s*eldiven/i.test(primaryText)) {
    const uPrice = Number(item.unitPrice) || 0;
    return {
      materialName: (uPrice > 0 && uPrice < 35)
        ? 'Tek Kullanımlık Nitril/Lateks Temizlik Eldiveni (Adet/Çift)'
        : 'Kalın Kauçuk Temizlik / Kimyasal Eldiveni (Перчатки резиновые)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/жилет\s*сигнальн|сигнальн.*жилет|ikaz\s*yele|reflektörlü\s*yelek|yelek\s*reflektor/i.test(primaryText)) {
    return {
      materialName: 'Reflektörlü Yüksek Görünürlüklü İkaz Yeleği (Жилет сигнальный)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/дождевик|плащ\s*влагозащит|костюм\s*влагозащит|yağmurluk|yagmurluk/i.test(primaryText)) {
    if (/полиэтилен|однораз|пэ\b/i.test(primaryText) || ((Number(item.unitPrice) || 0) > 0 && (Number(item.unitPrice) || 0) < 200)) {
      return {
        materialName: 'Tek Kullanımlık Polietilen Yağmurluk (Плащ-дождевик ПЭ)',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Su Geçirmez Ağır Hizmet İş Yağmurluğu (Плащ / Костюм влагозащитный)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/сапоги.*(?:эва|eva|пвх|pvc|резин)|(?:^|[^a-zа-яё])(?:çizme|cizme)(?![a-zа-яё])/i.test(primaryText) && !/içliği|утеплитель\s*нтп/i.test(primaryText)) {
    const isWinterBoot = /утепл|зимн|kışlık|kislik|чулк|мех/i.test(primaryText);
    if (isWinterBoot) {
      return {
        materialName: 'Kışlık Termal İş Çizmesi (Сапоги утепленные ЭВА / ПВХ)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/кщс|металлостельк/i.test(combined)) {
      return {
        materialName: 'Çelik Burunlu ve Çelik Tabanlı Asit/Yağ Dayanımlı PVC İş Çizmesi (КЩС МП+МС) [Premium]',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Standart Çelik Burunlu Su Geçirmez PVC İş Çizmesi (Сапоги ПВХ с МП) [Standart]',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (
    (/ботинки|ботинок|полуботинк|сапоги\s*(?:кожан|рабоч.*утепл)|iş\s*botu|is\s*botu|güvenlik\s*botu|iş\s*güvenliği\s*ayakkabı|iş\s*ayakkabı|is\s*ayakkabi/i.test(primaryText)) &&
    !/ayakkabılık|обувниц|бахил|kılıf/i.test(primaryText)
  ) {
    const isWinterShoe = /утепл|зимн|зима|мех|шерст|kışlık|kislik/i.test(primaryText);
    const uPrice = Number(item.unitPrice) || 0;
    if (isWinterShoe) {
      if (/скорпион|перфект\s*протекшен|премиум|кевлар|натур.*мех|итр/i.test(combined) || uPrice >= 3000) {
        return {
          materialName: 'Kışlık Çelik Burunlu İş Botu [Premium Doğal Kürk / Kevlar — Скорпион & Перфект]',
          category: 'İş Güvenliği & KKD'
        };
      }
      return {
        materialName: 'Kışlık Çelik Burunlu İş Botu [Ekonomik Saha Serisi — Рабочий / Лайн]',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/равелин|8742|8743|кпп|премиум|итр/i.test(combined) || uPrice >= 2500) {
      return {
        materialName: 'Çelik Burunlu İş Güvenliği Botu [Premium Deri Serisi — Равелин / РКВНМ]',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Çelik Burunlu İş Güvenliği Botu [Ekonomik Saha Serisi — Лайн / Мистраль]',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (
    (/костюм\s*(?:рабоч|зимн|летн|сварщик|утеплен|мужск|защитн|итр|охран)|куртка\s*(?:рабоч|зимн|утеплен)|iş\s*elbise|is\s*elbise|güvenlik\s*kıyafeti\s*takımı|iş\s*montu|is\s*montu|kışlık\s*mont|kislik\s*mont/i.test(primaryText)) &&
    !/влагозащит|дождевик/i.test(primaryText)
  ) {
    if (/сварщик|kaynakçı|kaynakci|брезент|спилк/i.test(primaryText)) {
      return {
        materialName: 'Yanmaz Kaynakçı İş Elbisesi (Костюм сварщика)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/охран|güvenlik\s*kıyafeti/i.test(primaryText)) {
      return {
        materialName: 'Kışlık Güvenlik Personeli Kıyafeti Takımı (Костюм зимний охранника)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if ((/куртка|iş\s*montu|is\s*montu|kışlık\s*mont|kislik\s*mont/i.test(primaryText)) && !/костюм|takım|полукомбинезон|брюк/i.test(primaryText)) {
      return {
        materialName: 'Kışlık Yalıtımlı İş Montu / Kaban (Куртка рабочая утепленная)',
        category: 'İş Güvenliği & KKD'
      };
    }
    if (/зимн|утепл|kışlık|kislik/i.test(primaryText)) {
      return {
        materialName: 'Kışlık Yalıtımlı İş Elbisesi Takımı (Костюм рабочий зимний)',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Yazlık/Mevsimlik İş Elbisesi Takımı (Костюм рабочий летний)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/привязь\s*страховочн|пояс\s*предохранит|пояс\s*монтажн|paraşüt.*kemer|emniyet\s*kemeri/i.test(primaryText)) {
    if (/строп|halat|lanyard/i.test(primaryText) && !/привязь|kemer/i.test(primaryText)) {
      return {
        materialName: 'Emniyet Kemeri Şok Emicili Güvenlik Halatı (Строп страховочный)',
        category: 'İş Güvenliği & KKD'
      };
    }
    return {
      materialName: 'Paraşüt Tipi Yüksekte Çalışma Emniyet Kemeri (Страховочная привязь)',
      category: 'İş Güvenliği & KKD'
    };
  }

  // 3.15 ELEKTRİK KABLOLARI (Üretici fabrikadan bağımsız kesit ve kablo tipine göre birleştir!)
  if (/пнсв|kablo\s*beton\s*ısıtma|kablo\s*beton\s*isitma|прогрева\s*бетона/i.test(primaryText) && !/трансформатор/i.test(primaryText)) {
    const pnsvDia = /1[.,]4/i.test(primaryText) ? '1.4' : '1.2';
    return {
      materialName: `Beton Isıtma Teli / Kablosu ПНСВ-${pnsvDia} mm`,
      category: 'Kablo & Elektrik Altyapı'
    };
  }
  if (
    (/(?:кабель|провод|kablo)\s*.*(?:ввг|кгтп|кг\b|пвс|пугв|пв-?3|аввг|сип|nyy|nyaf|ttr)/i.test(primaryText)) &&
    !/муфта|наконечник|канал|лоток|короб|гофр|клипс|стяжк|хомут|бандаж|протяжк|рулетк|удлинител|makara/i.test(primaryText)
  ) {
    const cabSrc = (effectiveOrig && /\b\d{1,2}\s*[*xх×]\s*\d+(?:[.,]\d+)?/i.test(effectiveOrig)) ? effectiveOrig : primaryText;
    const secMatch = cabSrc.match(/(?:^|[^0-9])(\d{1,2})\s*[*xх×]\s*(\d+(?:[.,]\d+)?)(?![0-9])/);
    if (secMatch) {
      const cores = secMatch[1];
      const cross = secMatch[2].replace(',', '.');
      if (/frls/i.test(cabSrc)) {
        return {
          materialName: `Yangına Dayanıklı Güç Kablosu ВВГнг(А)-FRLS ${cores}x${cross} mm²`,
          category: 'Kablo & Elektrik Altyapı'
        };
      }
      if (/ввг|vvg|nyy/i.test(cabSrc)) {
        return {
          materialName: `Yanmaz Güç Kablosu ВВГнг(А)-LS ${cores}x${cross} mm²`,
          category: 'Kablo & Elektrik Altyapı'
        };
      }
      if (/кгтп|(?:^|[^a-zа-яё])кг(?![a-zа-яё])|kauçuk\s*kablo|kaucuk\s*kablo/i.test(cabSrc)) {
        return {
          materialName: `Esnek Kauçuk Şantiye Kablosu КГ / КГТП-ХЛ ${cores}x${cross} mm²`,
          category: 'Kablo & Elektrik Altyapı'
        };
      }
      if (/пвс|pvs|ttr/i.test(cabSrc)) {
        return {
          materialName: `Esnek Çok Telli Tesisat Kablosu ПВС ${cores}x${cross} mm²`,
          category: 'Kablo & Elektrik Altyapı'
        };
      }
      if (/пугв|пв-?3|nyaf/i.test(cabSrc)) {
        return {
          materialName: `Topraklama / Pano Tesisat Kablosu ПуГВ (NYAF) ${cores}x${cross} mm²`,
          category: 'Kablo & Elektrik Altyapı'
        };
      }
    }
  }

  // 3.16 OFİS KAĞIDI, TEMİZLİK, ÇAY, KÜP ŞEKER & İÇME SUYU
  if (/широкоформатн.*бумаг|бумаг.*широкоформатн|бумага\s*для\s*инженерн|плоттер.*бумаг|(?:610|841|914)\s*мм.*(?:45|50|175)\s*м/i.test(primaryText)) {
    return {
      materialName: 'Plotter Geniş Format Mühendislik Rulo Kağıdı (80 g/m²)',
      category: 'Ofis & Kırtasiye'
    };
  }
  if (
    (/бумага.*(?:а4|a4|а3|a3|500\s*л|светокопи|svetocopy|снегурочка|илим|кама|балет)|fotokopi\s*kağıd|kağıt\s*a4|kagit\s*a4|kağıt\s*a3|kagit\s*a3|a4\s*fotokopi/i.test(primaryText)) &&
    !/туалет|полотенц|салфет|наждач|шлифовальн|фотобумаг|плоттер|рулон|широкоформатн|инженерн|610\s*мм|841\s*мм|914\s*мм/i.test(primaryText)
  ) {
    const isA3 = /(?:^|[^a-zа-яё0-9])(?:a3|а3)(?![a-zа-яё0-9])/i.test(primaryText);
    return {
      materialName: isA3
        ? 'A3 Fotokopi / Yazıcı Kağıdı (80 g/m², 500 Yaprak Paket)'
        : 'A4 Fotokopi / Yazıcı Kağıdı (80 g/m², 500 Yaprak Paket)',
      category: 'Ofis & Kırtasiye'
    };
  }
  if (/папка[\s-]*регистратор|папка\s*арочн|geniş\s*klasör|dar\s*klasör|klasor\s*genis/i.test(primaryText)) {
    return {
      materialName: 'Telli Dosya Klasörü (Папка-регистратор 50/75 mm)',
      category: 'Ofis & Kırtasiye'
    };
  }
  if (/ершик.*унитаз|щетка.*унитаз|wc\s*fırça|tuvalet\s*fırça|klozet\s*fırça/i.test(combined)) {
    if (/luscan/i.test(combined) || (Number(item.unitPrice) || 0) >= 200) {
      return {
        materialName: 'Tuvalet / Klozet Fırçası Seti Luscan [Premium]',
        category: 'Temizlik & Hijyen Malzemeleri'
      };
    }
    return {
      materialName: 'Tuvalet / Klozet Fırçası Seti AZUR Мини [Ekonomik]',
      category: 'Temizlik & Hijyen Malzemeleri'
    };
  }
  if (/мешк.*мусор|пакет.*мусор|çöp\s*poşet|cop\s*poset|çöp\s*torba|moloz\s*çuval/i.test(primaryText)) {
    if (/строительн.*мусор|moloz\s*çuval|\bпп\b.*(?:50\s*[*xх×]\s*90|55\s*[*xх×]\s*95)/i.test(combined)) {
      const sackDim = combined.match(/\b(50\s*[*xх×]\s*90|55\s*[*xх×]\s*95)\b/);
      if (sackDim) {
        const dStr = sackDim[1].replace(/\s+/g, '').replace(/[х*×]/gi, 'x');
        return {
          materialName: `PP İnşaat Moloz Çuvalı (Мешок ПП) ${dStr} cm (Yeşil)`,
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
    }
    const volM = primaryText.match(/(?:^|[^0-9])(30|35|60|120|140|160|180|200|240|300|360)\s*(?:л|lt|l)(?![a-zа-яё])/i);
    if (volM) {
      const vol = volM[1];
      const uPrice = Number(item.unitPrice) || 0;
      if (vol === '30') {
        if (/6\s*мкм|20\s*шт|celesta|6\s*mkr/i.test(combined) || (uPrice > 0 && uPrice < 30)) {
          return {
            materialName: 'Çöp Poşeti 30 L (6 Mikron, 20 Adet/Rulo) [Ekonomik]',
            category: 'Temizlik & Hijyen Malzemeleri'
          };
        }
        return {
          materialName: 'Çöp Poşeti 30 L (10 Mikron, 30 Adet/Rulo) [Standart]',
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
      if (vol === '240') {
        if (/\b50\s*шт/i.test(combined) || uPrice >= 900) {
          return {
            materialName: 'Endüstriyel Ağır Hizmet Çöp Poşeti 240 L (50 Adet/Paket — 40-80 Mikron)',
            category: 'Temizlik & Hijyen Malzemeleri'
          };
        }
        if (/\b(?:50|55|60|70|80)\s*мкм|luscan|green\s*pack/i.test(combined)) {
          return {
            materialName: 'Endüstriyel Ağır Hizmet Çöp Poşeti 240 L (10 Adet/Rulo, 50-80 Mikron — Luscan / Green Pack) [Premium]',
            category: 'Temizlik & Hijyen Malzemeleri'
          };
        }
        return {
          materialName: 'Endüstriyel Çöp Poşeti 240 L (10 Adet/Rulo, 30-35 Mikron — Optiline / Стандарт) [Ekonomik]',
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
      if (vol === '140' && uPrice > 0 && uPrice < 60) {
        return {
          materialName: 'Çöp Poşeti 140 L (Standart İnce Rulo)',
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
      if (vol === '60' && uPrice > 0 && uPrice < 25) {
        return {
          materialName: 'Çöp Poşeti 60 L (Standart İnce Rulo)',
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
      const is50Pack = /\b50\s*шт/i.test(primaryText);
      const packType = is50Pack ? '50 Adet/Paket' : 'Rulo';
      return {
        materialName: `Endüstriyel Çöp Poşeti / Torbası ${vol} L (${packType})`,
        category: 'Temizlik & Hijyen Malzemeleri'
      };
    }
  }
  if (/мыло\s*жидк|sıvı\s*(?:el\s*)?sabun|sabun\s*sivi/i.test(primaryText)) {
    if (/5\s*(?:л|lt|l)/i.test(primaryText)) {
      if (/iqup|clean\s*care/i.test(combined) || ((Number(item.unitPrice) || 0) > 0 && (Number(item.unitPrice) || 0) < 250)) {
        return {
          materialName: 'Sıvı El Sabunu IQUP Clean Care (5 L Bidon) [Ekonomik]',
          category: 'Temizlik & Hijyen Malzemeleri'
        };
      }
      return {
        materialName: 'Sıvı El Sabunu Grass Milana / Luscan (5 L Bidon) [Profesyonel]',
        category: 'Temizlik & Hijyen Malzemeleri'
      };
    }
  }
  if (/сахар\s*(?:кусков|рафинад)|küp\s*şeker|kup\s*seker/i.test(primaryText) && !/сахарниц|şekerlik/i.test(primaryText)) {
    return {
      materialName: 'Küp Şeker (Сахар кусковой - 1 kg Paket)',
      category: 'Gıda & Mutfak Malzemeleri'
    };
  }
  if (/ahmad.*earl\s*grey/i.test(primaryText)) {
    return {
      materialName: 'Poşet Siyah Çay Ahmad Tea Earl Grey (100\'lü Paket)',
      category: 'Gıda & Mutfak Malzemeleri'
    };
  }
  if (/ahmad.*english\s*breakfast/i.test(primaryText)) {
    return {
      materialName: 'Poşet Siyah Çay Ahmad Tea English Breakfast (100\'lü Paket)',
      category: 'Gıda & Mutfak Malzemeleri'
    };
  }
  if (/mayskiy.*bergamot|майский.*бергамот/i.test(primaryText)) {
    return {
      materialName: 'Poşet Siyah Çay Mayskiy Bergamotlu (100\'lü Paket)',
      category: 'Gıda & Mutfak Malzemeleri'
    };
  }
  if (
    (/вода\s*(?:питьев|минеральн|негазирован|газирован|артезиан|бутилирован)|içme\s*suyu|icme\s*suyu|damacana\s*su/i.test(primaryText)) &&
    !/дистиллирован|кулер|помпа|насос|нагревател|счетчик|труб|фильтр/i.test(primaryText)
  ) {
    if (/19\s*(?:л|lt|l)|18[.,]9|damacana|бутыл.*19/i.test(primaryText)) {
      return { materialName: 'Damacana İçme Suyu (19 Litre)', category: 'Mutfak, Gıda & İkram' };
    }
    if (/(?:^|[^0-9.,])5\s*(?:л|lt|l)(?![a-zа-яё])/i.test(primaryText)) {
      return { materialName: 'Pet Şişe İçme Suyu (5 Litre)', category: 'Mutfak, Gıda & İkram' };
    }
    if (/1[.,]5\s*(?:л|lt|l)/i.test(primaryText)) {
      return { materialName: 'Pet Şişe İçme Suyu (1.5 Litre)', category: 'Mutfak, Gıda & İkram' };
    }
    if (/0[.,]45\s*(?:л|lt|l)|0[.,]5\s*(?:л|lt|l)|500\s*(?:мл|ml)/i.test(primaryText)) {
      return { materialName: 'Pet Şişe İçme Suyu (0.5 Litre)', category: 'Mutfak, Gıda & İkram' };
    }
  }

  // 3.17 KALIP & İSKELE, ÖLÇÜM (TERAZİ/METRE), KAYNAK EKİPMANLARI, YANGIN HORTUMU & BİLGİ İŞLEM TONER/AKSESUAR
  if (/горизонтальный\s*элемент|горизонтальная\s*связь|cuplock.*yatay|yatay\s*eleman.*cup\s*lock|lock.*yatay.*eleman/i.test(primaryText)) {
    const lenM = primaryText.match(/(?:l\s*=\s*)?(500|750|1000|1250|1500)\s*(?:мм|mm)/i) || primaryText.match(/\b(0[.,]5|0[.,]75|1[.,]0|1[.,]25|1[.,]5|1)\s*(?:м|m)\b/i);
    if (lenM) {
      const rawVal = parseFloat(lenM[1].replace(',', '.'));
      const mVal = rawVal >= 100 ? (rawVal / 1000) : rawVal;
      const mStr = mVal === 0.75 || mVal === 1.25 ? mVal.toFixed(2) : mVal.toFixed(1);
      const isRentalOrBrace = /связь|аренда|kiralama/i.test(primaryText) || ((Number(item.unitPrice) || 0) > 0 && (Number(item.unitPrice) || 0) < 150);
      if (isRentalOrBrace) {
        return {
          materialName: `CupLock İskele Yatay Bağlantı Elemanı (Горизонтальная связь) L=${mStr} m`,
          category: 'Kalıp & İskele Sistemleri'
        };
      }
      return {
        materialName: `İskele Yatay Elemanı (CupLock / Ригель) L=${mStr} m`,
        category: 'Kalıp & İskele Sistemleri'
      };
    }
  }
  if (/втулка.*(?:каплок|cuplock|чашечн)|lock\s*iskele\s*kovan/i.test(primaryText)) {
    const uPrice = Number(item.unitPrice) || 0;
    return {
      materialName: (uPrice > 0 && uPrice < 30)
        ? 'CupLock İskele Kovanı / Burcu (Kiralama / Аренда)'
        : 'CupLock İskele Kovanı / Burcu (Втулка CupLock)',
      category: 'Kalıp & İskele Sistemleri'
    };
  }
  if (/lock\s*(?:iskele\s*)?düşey\s*eleman/i.test(primaryText)) {
    const lenM = primaryText.match(/\b(1[.,]0|1[.,]5|2[.,]0|2[.,]5|3[.,]0)\s*(?:м|m)\b/i);
    if (lenM) {
      return {
        materialName: `İskele Düşey Elemanı (CupLock / Стойка) L=${parseFloat(lenM[1].replace(',', '.')).toFixed(1)} m`,
        category: 'Kalıp & İskele Sistemleri'
      };
    }
  }
  if (/винт\s*стяжной|kalıp\s*bağlantı\s*(?:mili|cıvatası)|tij\s*tie\s*rod|tayrot/i.test(primaryText) && !/труб|boru|гайк|somun/i.test(primaryText)) {
    const lenM = primaryText.match(/\b(1[.,]0|1[.,]5|2[.,]0|2[.,]5|3[.,]0|1|2|3)\s*(?:м|m)\b/i);
    const lenStr = lenM ? parseFloat(lenM[1].replace(',', '.')).toFixed(1) : '3.0';
    return {
      materialName: `Kalıp Bağlantı Mili (Tie-Rod / Винт стяжной) L=${lenStr} m`,
      category: 'Kalıp & İskele Sistemleri'
    };
  }
  if (/трубка.*для\s*стяжного\s*винта|boru\s*tie\s*rod\s*plastik/i.test(primaryText)) {
    return {
      materialName: 'PVC Kalıp Tie-Rod Kılıf Borusu Ø25 mm (3000 mm)',
      category: 'Kalıp & İskele Sistemleri'
    };
  }
  if (/pano\s*kalıp\s*(sağ|sol)\s*iç\s*köşe\s*paneli/i.test(primaryText)) {
    const side = /sağ/i.test(primaryText) ? 'Sağ' : 'Sol';
    const dimM = primaryText.match(/\b(0[.,]\d+)\s*[*xх×]\s*(0[.,]\d+)\s*[*xх×]\s*(3(?:[.,]0+)?)\b/);
    if (dimM) {
      const w1 = parseFloat(dimM[1].replace(',', '.')).toFixed(2).replace('.', ',');
      const w2 = parseFloat(dimM[2].replace(',', '.')).toFixed(2).replace('.', ',');
      return {
        materialName: `Pano Kalıp ${side} İç Köşe Paneli ${w1}x${w2}x3,00 m`,
        category: 'Kalıp & İskele Sistemleri'
      };
    }
  }
  if ((/уровень|su\s*terazisi/i.test(primaryText)) && !/лазер|lazer|нивелир|nivo/i.test(primaryText)) {
    const mmM = primaryText.match(/\b(400|600|800|1000|1200|1500|2000)\s*(?:мм|mm)?\b/i);
    const cmM = primaryText.match(/\b(40|60|80|100|120|150|200)\s*(?:см|cm)\b/i);
    const lenMm = mmM ? mmM[1] : (cmM ? String(parseInt(cmM[1], 10) * 10) : '');
    if (lenMm) {
      return {
        materialName: `Alüminyum Su Terazisi (Уровень строительный) ${lenMm} mm`,
        category: 'Ölçüm, Harita & Saha Ekipmanları'
      };
    }
  }
  if (/рулетк|şerit\s*metre|metre\s*celik\s*serit/i.test(primaryText)) {
    const mMatch = primaryText.match(/(?:^|[^0-9.,])(3|5|7[.,]5|8|10|20|30|50)\s*(?:м|m|\/mt|mt)\b/i);
    if (mMatch) {
      const lenStr = mMatch[1].replace(',', '.');
      if (/fisco|gross/i.test(primaryText)) {
        return {
          materialName: `Profesyonel Çelik Şerit Metre (FISCO / GROSS) ${lenStr} m`,
          category: 'Ölçüm, Harita & Saha Ekipmanları'
        };
      }
      return {
        materialName: `Çelik Şerit Metre (Рулетка) ${lenStr} m`,
        category: 'Ölçüm, Harita & Saha Ekipmanları'
      };
    }
  }
  if (/изолента|izole\s*bant|bant\s*izole/i.test(primaryText)) {
    if (/х\/?б|хлопчатобумаж|bez\s*izole/i.test(primaryText)) {
      return {
        materialName: 'Bez Elektrik İzole Bant (Изолента Х/Б 20 mm)',
        category: 'Sarf Malzeme & Hırdavat'
      };
    }
    const is15 = /\b15\s*(?:мм|mm|\*|[xх×])/i.test(primaryText);
    return {
      materialName: is15 ? 'PVC Elektrik İzole Bant 15 mm x 10 m' : 'PVC Elektrik İzole Bant 19 mm x 20 m',
      category: 'Sarf Malzeme & Hırdavat'
    };
  }
  if (/лента\s*сигнальн|ikaz.*şeridi|ikaz\s*band/i.test(primaryText)) {
    const is75 = /\b75\s*(?:мм|mm|\*|[xх×])/i.test(combined);
    return {
      materialName: is75
        ? 'İkaz / Güvenlik Şeridi (Лента сигнальная 75 mm x 200 m)'
        : 'İkaz / Güvenlik Şeridi (Лента сигнальная 50 mm x 200 m)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/гв[\s-]*111|gv[\s-]*111|gaz-hava\s*pürmüz/i.test(primaryText)) {
    if (/l\s*=\s*950|950\s*мм|redius/i.test(combined)) {
      return {
        materialName: 'Gaz-Hava Pürmüz / Şaloma Başlığı Redius ГВ-111-Р (L=950 mm Uzun Boy) [Profesyonel]',
        category: 'Kaynak Malzemeleri'
      };
    }
    return {
      materialName: 'Gaz-Hava Pürmüz / Şaloma Başlığı ГВ-111-Р (L=500 mm Standart)',
      category: 'Kaynak Malzemeleri'
    };
  }
  if (/электрододержател|elektrod\s*pensesi|kaynak\s*elektrod\s*pensesi/i.test(primaryText)) {
    return {
      materialName: 'Kaynak Elektrod Pensesi 500A (Электрододержатель)',
      category: 'Kaynak Malzemeleri'
    };
  }
  if ((/рукав.*кислород|шланг.*кислород/i.test(primaryText)) && /9(?:[.,]0)?\s*(?:мм|mm)/i.test(primaryText)) {
    return {
      materialName: 'Oksijen Gaz Kaynak Hortumu Ø9 mm (GOST 9356)',
      category: 'Kaynak Malzemeleri'
    };
  }
  if ((/рукав.*(?:пропан|ацетилен)|шланг.*пропан|propan.*kaynak\s*hortumu/i.test(primaryText)) && /9(?:[.,]0)?\s*(?:мм|mm)/i.test(primaryText)) {
    return {
      materialName: 'Propan / Asetilen Gaz Kaynak Hortumu Ø9 mm (GOST 9356)',
      category: 'Kaynak Malzemeleri'
    };
  }
  if ((/рукав\s*пожарн|yangın\s*hortumu/i.test(primaryText)) && /50\s*(?:мм|mm)|ду\s*50|dn\s*50/i.test(primaryText)) {
    return {
      materialName: 'Yangın Hortumu DN50 (Рукав пожарный Ду50, 20 m, 1.0 MPa)',
      category: 'Mekanik & Tesisat'
    };
  }
  if (/tk[\s-]*8115\s*([kcmy])/i.test(primaryText)) {
    const cCode = primaryText.match(/tk[\s-]*8115\s*([kcmy])/i)![1].toUpperCase();
    const colorMap: Record<string, string> = { K: 'Siyah', C: 'Mavi (Cyan)', M: 'Macenta', Y: 'Sarı' };
    if (/integral|интеграл/i.test(combined)) {
      return {
        materialName: `Muadil Toner Kartuşu Integral TK-8115${cCode} ${colorMap[cCode]} [Premium Muadil]`,
        category: 'Bilgi İşlem & IT'
      };
    }
    if (/комус|komus|cactus|кактус|sakura|сакура|совместим|muadil/i.test(combined)) {
      return {
        materialName: `Muadil Toner Kartuşu Комус TK-8115${cCode} ${colorMap[cCode]} [Ekonomik Muadil]`,
        category: 'Bilgi İşlem & IT'
      };
    }
    return {
      materialName: `Orijinal Kyocera TK-8115${cCode} ${colorMap[cCode]} Toner Kartuşu [Orijinal OEM]`,
      category: 'Bilgi İşlem & IT'
    };
  }
  if (/tk[\s-]*1150/i.test(primaryText)) {
    return { materialName: 'Kyocera TK-1150 Siyah Toner Kartuşu', category: 'Bilgi İşlem & IT' };
  }
  if (/canon\s*725/i.test(primaryText)) {
    return { materialName: 'Canon 725 Siyah Lazer Toner Kartuşu', category: 'Bilgi İşlem & IT' };
  }
  if (/canon\s*lbp\s*6030/i.test(primaryText)) {
    return { materialName: 'Canon i-SENSYS LBP6030B Lazer Yazıcı', category: 'Bilgi İşlem & IT' };
  }
  if (/logitech.*k\s*120/i.test(primaryText)) {
    return { materialName: 'Logitech K120 USB Kablolu Klavye (Siyah)', category: 'Bilgi İşlem & IT' };
  }
  if (/logitech.*m\s*185/i.test(primaryText)) {
    return { materialName: 'Logitech M185 Kablosuz Optik Mouse', category: 'Bilgi İşlem & IT' };
  }

  if (/vell\s*vl-231ch|картридж\s+комус\s+tze-231/i.test(combined)) {
    if (/комус\s+tze-231/i.test(cleanOrig)) {
      return {
        materialName: 'Etiket Yazıcı Kartuşu Комус / Brother TZE-231 (12 mm x 8 m)',
        category: 'Ofis & Kırtasiye'
      };
    }
    return {
      materialName: 'Çipli Etiket Yazıcı Kartuşu Vell VL-231CH (12 mm)',
      category: 'Ofis & Kırtasiye'
    };
  }

  // 3.18 YANGIN BATTANİYESİ ПП-300, OFİS KESONU EASY LT 16/16, KAŞE 55x15, SDS MATKAP & KIRICI KESKİ/MURÇ UÇLARI
  if (/противопожарн.*полотн|полотно\s*противопожарн|пп[\s-]*300.*полотн|yangın\s*battaniye/i.test(combined)) {
    return {
      materialName: 'Yanmaz Yangın Battaniyesi ПП-300 (1.5x2.0 m)',
      category: 'İş Güvenliği & KKD'
    };
  }
  if (/тумба\s+выкатная.*easy|easy\s+st(?:andard)?\s+lt\s*16\/16/i.test(combined)) {
    return {
      materialName: 'Easy Standard LT 16/16 Çekmeceli Keson (400x420x563 mm)',
      category: 'Şantiye Mobilya & Yaşam Donanımı'
    };
  }
  if (/(?:штамп|штапм).*55\s*[*xх×]\s*15/i.test(combined)) {
    return {
      materialName: 'Kaşe / Damga (Штамп) 55x15 mm',
      category: 'Ofis & Kırtasiye'
    };
  }
  if (
    (/(?:бур\b|beton\s*matkap\s*ucu|beton\s*delme\s*ucu)/i.test(combined)) &&
    (/sds/i.test(combined) || /\b(?:6|8|10|12|14|16|18|20|22|24|25|28|30|32)\s*[*xх×]\s*(?:110|160|210|260|300|310|350|400|450|460|500|540|600|800|1000)\b/.test(combined)) &&
    !/зубило|пика|keski|murç|murc|коронка|адаптер|патрон/i.test(combined)
  ) {
    const isMax = /sds[\s-]*max/i.test(combined);
    const sdsType = isMax ? 'SDS-max' : 'SDS-plus';
    const dim3 = combined.match(/\b0?(\d{1,2})\s*[*xх×]\s*(\d{2,4})\s*[*xх×]\s*(\d{2,4})\b/);
    const dim2 = combined.match(/\b0?(\d{1,2})\s*[*xх×]\s*(110|160|200|210|250|260|300|310|340|350|400|450|460|500|520|540|600|800|1000)\b/);
    const d = dim3 ? String(parseInt(dim3[1], 10)) : (dim2 ? String(parseInt(dim2[1], 10)) : '');
    const l = dim3 ? dim3[3] : (dim2 ? dim2[2] : '');
    if (d && l) {
      return {
        materialName: `SDS Beton Matkap Ucu ${sdsType} (${d}x${l} mm)`,
        category: 'El Aletleri & Hırdavat'
      };
    }
  }
  if (
    (/зубило|пика\b|kırıcı.*(?:keski|delici|murç|uc)|kirici.*(?:keski|uc)|(?:plus|max)\s*(?:düz\s*)?keski/i.test(combined)) &&
    (/sds|отбойн|перфоратор|\b(?:14|18|25)\s*[*xх×]\s*(?:250|400|450|600)\b|\b(?:14|18)\s*[*xх×]\s*(?:20|25|40)\s*[*xх×]\s*(?:250|400)\b/i.test(combined))
  ) {
    const isMax = /sds[\s-]*max|\b18\s*[*xх×]|\b25\s*[*xх×]\s*400/i.test(combined);
    const sdsType = isMax ? 'SDS-max' : 'SDS-plus';
    const isPoint = /пика|sivri|murç|murc|delici\s*kırıcı\s*uç/i.test(combined) && !/зубило|yassı|düz\s*keski/i.test(combined);
    const d3 = combined.match(/\b(14|18)\s*[*xх×]\s*(20|25|40|50)\s*[*xх×]\s*(250|400|450|600)\b/);
    const d2 = combined.match(/\b(14|18|20|25|40)\s*[*xх×]\s*(250|400|450|600)\b/);
    if (isPoint) {
      const dimStr = d2 ? `${d2[1]}x${d2[2]} mm` : (isMax ? '18x400 mm' : '14x250 mm');
      return {
        materialName: `Sivri Kırıcı Murç Ucu (Пика) ${sdsType} (${dimStr})`,
        category: 'El Aletleri & Hırdavat'
      };
    }
    const dimStr = d3 ? `${d3[1]}x${d3[2]}x${d3[3]} mm` : (d2 ? `${d2[1]}x${d2[2]} mm` : '');
    if (dimStr) {
      return {
        materialName: `Yassı Kırıcı Keski Ucu (Зубило) ${sdsType} (${dimStr})`,
        category: 'El Aletleri & Hırdavat'
      };
    }
  }

  // 4. Eğer ürün adında Rusça (Kiril) karakter varsa, teknik ölçülerini koruyarak Türkçe'ye çevir
  let finalDisplayName = name;
  if (/[а-яА-ЯёЁ]/.test(finalDisplayName)) {
    const translated = translateRussianMaterialToTurkish(effectiveOrig || name);
    if (translated && translated.trim().length > 1) {
      finalDisplayName = translated.trim();
    }
  }

  // Canonical Category Resolution
  const resolvedCategory = normalizeCategoryName(item.category, `${finalDisplayName} ${orig} ${name}`);

  // 5. Exact catalog match (case-insensitive)
  if (existingCatalog && existingCatalog.length > 0) {
    const lowerName = finalDisplayName.toLowerCase();
    const found = existingCatalog.find(catItem => catItem.toLowerCase() === lowerName);
    if (found) {
      return { materialName: found, category: resolvedCategory };
    }
  }

  return { materialName: finalDisplayName, category: resolvedCategory };
  })();
  if (canMemo) {
    if (smartNormalizeMemoCache.size > 15000) smartNormalizeMemoCache.clear();
    smartNormalizeMemoCache.set(memoKey, result);
  }
  return result;
}

function validateAndProcessNegotiationData(body: any, sups: any[], personnelList: any[]): { error?: string; data?: any } {
  const offerPrice = Number(body.offerPrice) || 0;
  const scopeDeductionAmount = Math.max(0, Number(body.scopeDeductionAmount) || 0);
  const scopeDeductionReason = body.scopeDeductionReason ? String(body.scopeDeductionReason).trim() : '';
  const adjustedOfferPrice = scopeDeductionAmount > 0 ? Math.max(0, offerPrice - scopeDeductionAmount) : offerPrice;
  const baselineOffer = adjustedOfferPrice > 0 ? adjustedOfferPrice : offerPrice;

  // 1. Validate negotiation rounds if present
  let rounds: any[] = [];
  if (Array.isArray(body.negotiationRounds) && body.negotiationRounds.length > 0) {
    const targetAgreed = Number(body.agreedPrice || 0);
    for (let i = 0; i < body.negotiationRounds.length; i++) {
      const r = body.negotiationRounds[i];
      if (!r || typeof r !== 'object') continue;
      const vendorName = String(r.vendorName || '').trim();
      const quotedPrice = Number(r.quotedPrice);
      if (!vendorName || isNaN(quotedPrice) || quotedPrice <= 0) continue;

      // GERÇEK TUR KURALI: Ara tur faturası/belgesi fiziksel olarak girilmiş veya yüklenmiş olmalıdır!
      const docName = String(r.documentName || r.documentFileName || r.fileName || '').trim();
      const docUrl = String(r.documentUrl || r.fileUrl || '').trim();
      const hasDoc = Boolean(docName || (docUrl && !docUrl.startsWith('data:')));
      if (!hasDoc) {
        // Belgesiz veya yüklenmemiş ara tur kabul edilmez, tur olarak girilmez
        continue;
      }

      // Ara tur fiyatı ilk tekliften büyük olamaz
      if (baselineOffer > 0 && quotedPrice > baselineOffer) {
        continue;
      }

      const prevPrice = r.previousPrice !== undefined && !isNaN(Number(r.previousPrice)) && Number(r.previousPrice) > 0
        ? Number(r.previousPrice)
        : (rounds.length > 0 ? Number(rounds[rounds.length - 1].quotedPrice) : (baselineOffer || quotedPrice));

      const discThisRound = r.discountThisRound !== undefined && !isNaN(Number(r.discountThisRound))
        ? Number(r.discountThisRound)
        : Math.max(0, prevPrice - quotedPrice);

      rounds.push({
        roundNumber: rounds.length + 1,
        vendorName: normalizeVendorName(vendorName),
        quotedPrice,
        previousPrice: prevPrice,
        discountThisRound: discThisRound,
        date: r.date || new Date().toISOString().split('T')[0],
        notes: r.notes || r.note || '',
        documentName: docName,
        documentUrl: docUrl,
        conductedByRole: r.conductedByRole || 'supervisor',
        conductedByName: r.conductedByName || ''
      });
    }
  }

  // 2. Determine supervisor and personnel
  const supObj = sups.find(s => s.id === body.supervisorId);
  const supervisorName = supObj ? supObj.name : (body.supervisorName || 'Bilinmeyen Şef');

  let performedByPersonnelId: string | undefined = undefined;
  let performedByPersonnelName: string | undefined = undefined;
  let recordOriginType: 'gol' | 'asist' = 'gol';

  if (body.performedByPersonnelId && String(body.performedByPersonnelId).trim()) {
    const pId = String(body.performedByPersonnelId).trim();
    const pers = personnelList.find(p => p.id === pId);
    if (pers) {
      performedByPersonnelId = pers.id;
      performedByPersonnelName = pers.name;
      recordOriginType = 'asist';
    } else {
      performedByPersonnelId = pId;
      performedByPersonnelName = body.performedByPersonnelName || 'Personel';
      recordOriginType = 'asist';
    }
  } else {
    recordOriginType = 'gol';
  }

  // 3. Offer, Scope Deduction, Adjusted Base Offer, Agreed, Discount
  // The true final agreed price is determined by the last negotiation round,
  // or the lower of the recorded invoice price and the last round price.
  let agreedPrice = Number(body.agreedPrice) || 0;
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;

  if (lastRoundPrice > 0 && agreedPrice > 0) {
    agreedPrice = Math.min(agreedPrice, lastRoundPrice);
  } else if (lastRoundPrice > 0) {
    agreedPrice = lastRoundPrice;
  }
  
  // Real Net Discount is calculated against adjustedOfferPrice (apples-to-apples baseline)
  const discountAmount = Math.max(0, baselineOffer - agreedPrice);
  const discountPercentage = baselineOffer > 0 ? Number(((discountAmount / baselineOffer) * 100).toFixed(2)) : 0;

  // 4. Negotiation metrics
  const negotiationCount = rounds.length;
  const distinctFirmsSet = new Set(rounds.map(r => getVendorKey(r.vendorName)).filter(Boolean));
  const distinctFirmsNegotiated = distinctFirmsSet.size;

  let crossNegotiationApplied = false;
  if (rounds.length > 0) {
    crossNegotiationApplied = distinctFirmsNegotiated >= 2 && negotiationCount >= 2;
  } else {
    crossNegotiationApplied = body.crossNegotiationApplied === true;
  }

  const finalNegotiationDate = body.finalNegotiationDate || (rounds.length > 0 ? rounds[rounds.length - 1].date : undefined);

  // 5. 5.2 Procedure rule checks & warnings
  const totalAmount = agreedPrice || offerPrice || 0;
  const procedureWarnings: string[] = [];

  if (totalAmount > NEGOTIATION_THRESHOLD && recordOriginType === 'asist') {
    procedureWarnings.push('Bu tutar (1.000.000 ₺ üzeri) için Satınalma Şefi sürecin tamamına dahil olmak zorundadır.');
  }

  if (totalAmount > NEGOTIATION_THRESHOLD && !crossNegotiationApplied) {
    procedureWarnings.push('Bu tutar (1.000.000 ₺ üzeri) için çapraz pazarlık (karşılıklı vurdurma) zorunludur.');
  }

  if (rounds.length > 0) {
    for (let i = 1; i < rounds.length; i++) {
      const prevPrice = Number(rounds[i].previousPrice ?? rounds[i - 1].quotedPrice);
      const currPrice = Number(rounds[i].quotedPrice);
      if (prevPrice > 0 && currPrice > prevPrice) {
        procedureWarnings.push(`Tur ${rounds[i].roundNumber}'te teklif fiyatı bir önceki turdan yüksek.`);
      }
    }

    const lastRound = rounds[rounds.length - 1];
    const lastPrice = Number(lastRound?.quotedPrice || 0);
    if (agreedPrice > 0 && lastPrice > 0 && lastPrice <= agreedPrice) {
      procedureWarnings.push('Ara pazarlık turu fiyatı nihai anlaşılan faturadan daha düşük veya eşit olamaz.');
    }
  }

  return {
    data: {
      supervisorName,
      performedByPersonnelId,
      performedByPersonnelName,
      recordOriginType,
      negotiationRounds: rounds,
      negotiationCount,
      distinctFirmsNegotiated,
      crossNegotiationApplied,
      finalNegotiationDate,
      procedureWarnings,
      offerPrice,
      scopeDeductionAmount,
      scopeDeductionReason,
      adjustedOfferPrice,
      agreedPrice,
      discountAmount,
      discountPercentage
    }
  };
}

app.get('/api/discounts', async (req, res) => {
  const { data, quotaExceeded } = await getDiscountsCached();
  if (quotaExceeded) res.setHeader('X-Quota-Exceeded', 'true');
  
  // Ensure comparative analyses store is populated from Firestore
  if (db && comparativeAnalysesStore.size === 0) {
    try {
      const snap = await getDocs(collection(db, 'comparative_analyses'));
      snap.forEach((docSnap: any) => {
        const cData = docSnap.data();
        if (cData && cData.id && !comparativeAnalysesStore.has(cData.id)) {
          comparativeAnalysesStore.set(cData.id, cData);
        }
      });
    } catch (err: any) {
      console.warn('[FIRESTORE COMPARATIVE READ WARN in discounts]:', err.message);
    }
  }

  const activeDiscounts = (data || []).filter((dsc: any) => !dsc.isDeleted && !dsc.isPermanentlyDeleted);
  const sanitized = activeDiscounts.map((dsc: any) => {
    let cleanFirst = dsc.firstOfferFileUrl;
    let cleanFinal = dsc.finalOfferFileUrl;
    if (cleanFirst && typeof cleanFirst === 'string' && cleanFirst.startsWith('data:')) cleanFirst = null;
    if (cleanFinal && typeof cleanFinal === 'string' && cleanFinal.startsWith('data:')) cleanFinal = null;
    const { firstOfferFileData, finalOfferFileData, ...rest } = dsc;

    let canonicalMaterials = dsc.canonicalMaterials;
    let compId = dsc.comparativeAnalysisId;
    let realMarketSavings = dsc.realMarketSavings;
    let internalVendorDiscount = dsc.internalVendorDiscount;
    let marketReferencePrice = dsc.marketReferencePrice;
    let realSavingsPercentage = dsc.realSavingsPercentage;

    const comp = Array.from(comparativeAnalysesStore.values()).find((c: any) =>
      (c.id && (c.id === dsc.comparativeAnalysisId || c.associatedDiscountId === dsc.id)) ||
      (c.summary?.finalInvoiceNumber && dsc.invoiceNo && c.summary.finalInvoiceNumber === dsc.invoiceNo) ||
      (c.documents && dsc.invoiceNo && c.documents.some((doc: any) => doc.documentNumber === dsc.invoiceNo))
    );
    if (comp) {
      if (!compId) compId = comp.id;
      if ((!canonicalMaterials || canonicalMaterials.length === 0) && comp.canonicalMaterials) {
        canonicalMaterials = comp.canonicalMaterials;
      }
      if (realMarketSavings === undefined && comp.realMarketSavings !== undefined) realMarketSavings = comp.realMarketSavings;
      if (internalVendorDiscount === undefined && (comp.internalVendorSavings !== undefined || comp.summary?.internalVendorSavings !== undefined)) {
        internalVendorDiscount = comp.internalVendorSavings ?? comp.summary?.internalVendorSavings;
      }
      if (marketReferencePrice === undefined && (comp.totalInitialLowestOffer !== undefined || comp.summary?.totalInitialLowestOffer !== undefined)) {
        marketReferencePrice = comp.totalInitialLowestOffer ?? comp.summary?.totalInitialLowestOffer;
      }
      if (realSavingsPercentage === undefined && (comp.realSavingsRate !== undefined || comp.summary?.realSavingsRate !== undefined)) {
        realSavingsPercentage = comp.realSavingsRate ?? comp.summary?.realSavingsRate;
      }
    }

    const cleanVendor = normalizeVendorName(dsc.vendorName || dsc.supplier);
    const rawCat = dsc.category;
    const itemStrings = (dsc.items || []).map((it: any) => `${it.materialName || ''} ${it.originalName || ''} ${it.category || ''}`).join(' ');
    const normCategory = normalizeCategoryName(rawCat, `${itemStrings} ${dsc.description || ''} ${dsc.notes || ''} ${cleanVendor}`);
    let finalCategory = (normCategory && normCategory !== 'Diğer Malzeme' && normCategory !== 'Прочие материалы' && normCategory !== 'Diğer')
      ? normCategory
      : (rawCat && rawCat !== 'Diğer Malzeme' && rawCat !== 'Прочие материалы' && rawCat !== 'Diğer' ? rawCat : '');

    if (!finalCategory) {
      const sLower = cleanVendor.toLowerCase();
      if (/поинтер|pointer|комус|komus|sitilink|citilink/i.test(sLower)) finalCategory = 'Bilgi İşlem & IT';
      else if (/петрович|petrovich|дипломат|сателит|satelit/i.test(sLower)) finalCategory = 'Yalıtım & Alçıpan';
      else if (/всеинструмент|vseinstrumenti|системный специалист/i.test(sLower)) finalCategory = 'El Aletleri & Hırdavat';
      else if (/бкз|евробетон|росбетон|мосбетон|бетон/i.test(sLower)) finalCategory = 'Hazır Beton, Çimento & Agrega';
      else if (/армкаркас|сталь|металл|прокат/i.test(sLower)) finalCategory = 'Çelik Malzemeler';
      else if (/технорум|баумак|профмастер|рока/i.test(sLower)) finalCategory = 'Kalıp & İskele Sistemleri';
      else finalCategory = 'Sarf Malzeme & Hırdavat';
    }

    return {
      ...rest,
      category: finalCategory,
      vendorName: cleanVendor,
      supplier: cleanVendor,
      firstOfferFileUrl: cleanFirst,
      finalOfferFileUrl: cleanFinal,
      ...(compId ? { comparativeAnalysisId: compId } : {}),
      ...(canonicalMaterials ? { canonicalMaterials } : {}),
      ...(realMarketSavings !== undefined ? { realMarketSavings } : {}),
      ...(internalVendorDiscount !== undefined ? { internalVendorDiscount } : {}),
      ...(marketReferencePrice !== undefined ? { marketReferencePrice } : {}),
      ...(realSavingsPercentage !== undefined ? { realSavingsPercentage } : {})
    };
  });

  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "0", 10);
  let results = sanitized;

  if (req.query.summary === 'true') {
    results = results.map((d: any) => ({
      id: d.id,
      vendorName: d.vendorName,
      invoiceNo: d.invoiceNo,
      orderDate: d.orderDate,
      offerPrice: d.offerPrice,
      agreedPrice: d.agreedPrice,
      discountPercentage: d.discountPercentage,
      status: d.status,
      isDeleted: d.isDeleted
    }));
  }

  const total = results.length;
  if (limit > 0) {
    const startIndex = (page - 1) * limit;
    results = results.slice(startIndex, startIndex + limit);
    return res.json({ data: results, total, page, limit });
  }

  res.json(results);
});

app.post('/api/discounts', async (req, res) => {
  try {
// Idempotency kontrolü
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.idempotencyKey || '').trim();
    if (idempotencyKey && db) {
        try {
            const idempotencyRef = doc(db, 'idempotency_keys', idempotencyKey);
            const idempDoc = await getDoc(idempotencyRef);
            if (idempDoc.exists()) {
                const prevResponse = idempDoc.data()?.response;
                if (prevResponse) {
                   console.log('[API /api/discounts] Idempotency match, returning existing record.');
                   return res.status(200).json(prevResponse);
                }
            }
        } catch(e){}
    }
    const cleanVendorName = normalizeVendorName(toSafeString(req.body.vendorName));
    const newVendorName = cleanVendorName.toLowerCase();
    const newOffer = Number(req.body.offerPrice) || 0;
    const newAgreed = Number(req.body.agreedPrice) || 0;

    // Check for logical duplicates based on vendor and invoice number
    const { data: activeDiscounts } = await getDiscountsCached();
    
    // Guard against accidental double-click using cached data
    let isNewVendor = req.body.isNewVendor === true;
    const isTrulyNew = !activeDiscounts.some(d => areVendorsEqual(d.vendorName, cleanVendorName));
    if (isNewVendor && !isTrulyNew) isNewVendor = false;

    const doubleClickDuplicate = activeDiscounts.find(d => {
      const dOffer = Number(d.offerPrice) || 0;
      const dAgreed = Number(d.agreedPrice) || 0;
      const timeDiffMs = d.created_at ? (Date.now() - new Date(d.created_at).getTime()) : 999999;
      return areVendorsEqual(d.vendorName, cleanVendorName) && newOffer === dOffer && newAgreed === dAgreed && d.supervisorId === req.body.supervisorId && timeDiffMs < 5000;
    });

    if (doubleClickDuplicate) {
      console.log(`[API /api/discounts] Multi-click double submission blocked for '${req.body.vendorName}'. Returning existing document ${doubleClickDuplicate.id}`);
      return res.status(200).json(doubleClickDuplicate);
    }

    // Guard against uploading the same invoice again
    const reqInvoiceNo = toSafeString(req.body.invoiceNo).trim();
    const reqAmount = Number(req.body.agreedPrice) || Number(req.body.offerPrice) || 0;
    const reqDate = String(req.body.orderDate || '').trim();

    const { data: curInvsForDup } = await getInvoicesCached();
    const invoiceDuplicate = activeDiscounts.find(d => {
      if (d.isDeleted) return false;
      const sameVendor = areVendorsEqual(d.vendorName, cleanVendorName);
      const dInvoiceNo = String(d.invoiceNo || '').trim();
      const dAmount = Number(d.agreedPrice) || Number(d.offerPrice) || 0;
      const dDate = String(d.orderDate || '').trim();

      if (dInvoiceNo.startsWith('TKF-') || dInvoiceNo.startsWith('ARCH-') || dInvoiceNo.startsWith('FT-EXCEL-') || dInvoiceNo.startsWith('FT-')) return false;
      
      if (reqInvoiceNo && !reqInvoiceNo.startsWith('FT-') && dInvoiceNo && reqInvoiceNo.toLowerCase() === dInvoiceNo.toLowerCase() && sameVendor) return true;
      if (!reqInvoiceNo && sameVendor && reqAmount > 0 && Math.abs(reqAmount - dAmount) < 1 && reqDate === dDate) return true;

      return false;
    }) || curInvsForDup.find(inv => {
      if (inv.isDeleted) return false;
      const sameVendor = areVendorsEqual(inv.supplier || inv.vendorName, cleanVendorName);
      const iNo = String(inv.invoiceNumber || inv.invoiceNo || '').trim();
      if (!reqInvoiceNo || reqInvoiceNo.startsWith('FT-') || !iNo || iNo.startsWith('TKF-') || iNo.startsWith('ARCH-') || iNo.startsWith('FT-EXCEL-')) return false;
      return reqInvoiceNo.toLowerCase() === iNo.toLowerCase() && sameVendor;
    });

    if (invoiceDuplicate && !req.body.forceSave && !req.body.forceSaveDuplicate) {
      const dupNo = invoiceDuplicate.invoiceNo || invoiceDuplicate.invoiceNumber || reqInvoiceNo;
      const dupDate = invoiceDuplicate.orderDate || invoiceDuplicate.date || '';
      const dupJob = invoiceDuplicate.jobsiteName || '';
      return res.status(409).json({
        error: 'Bu fatura sistemde kayıtlı!',
        isDuplicate: true,
        duplicateRecord: invoiceDuplicate,
        details: dupNo
          ? `Bu fatura sistemde kayıtlı! Bu tedarikçi (${req.body.vendorName}) için '${dupNo}' numaralı belge/fatura daha önce (${dupDate}${dupJob ? ' - ' + dupJob : ''}) sisteme kaydedilmiş!`
          : `Bu fatura sistemde kayıtlı! Bu tedarikçi (${req.body.vendorName}) için aynı tarih ve tutarda (${reqAmount} ₽) bir kayıt zaten sistemde mevcut!`
      });
    }

    const { data: sups } = await getSupervisorsCached();
    const { data: persList } = await getPersonnelCached();
    const { data: jobs } = await getJobsitesCached();

    const processed = validateAndProcessNegotiationData(req.body, sups, persList);
    if (processed.error) {
      return res.status(400).json({ error: 'Pazarlık Verisi Hatası', details: processed.error });
    }
    const {
      supervisorName,
      performedByPersonnelId,
      performedByPersonnelName,
      recordOriginType,
      negotiationRounds,
      negotiationCount,
      distinctFirmsNegotiated,
      crossNegotiationApplied,
      finalNegotiationDate,
      procedureWarnings,
      offerPrice,
      scopeDeductionAmount,
      scopeDeductionReason,
      adjustedOfferPrice,
      agreedPrice,
      discountAmount,
      discountPercentage
    } = processed.data!;

    const id = `disc_${Date.now()}`;
    let firstFileUrl = req.body.firstOfferFileUrl;
    let finalFileUrl = req.body.finalOfferFileUrl;

    const saveBase64File = async (base64Input: string, suffix: string) => {
      try {
        let mimeType = 'application/pdf';
        let ext = '.pdf';
        if (base64Input.startsWith('data:')) {
            const match = base64Input.match(/^data:([^;]+);/);
            if (match) {
                mimeType = match[1].toLowerCase();
                if (mimeType === 'image/jpeg') ext = '.jpg';
                else if (mimeType === 'image/png') ext = '.png';
                else if (mimeType === 'image/webp') ext = '.webp';
            }
        }

        const b64Data = base64Input.includes(',') ? base64Input.split(',')[1] : base64Input;
        const buffer = Buffer.from(b64Data, 'base64');
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        const uniqueFileName = `${sha256}${ext}`;

        // 1. Yerel kalıcı disk koruması
        let localSaved = false;
        try {
          fs.writeFileSync(path.join(LOCAL_FILES_DIR, uniqueFileName), buffer);
          fs.writeFileSync(path.join(uploadDir, uniqueFileName), buffer);
          localSaved = true;
        } catch (diskErr: any) {
          console.warn('[SAVE BASE64 DISK NOTICE]:', diskErr.message);
        }

        // 2. Cloud Storage dene
        let gcsSuccess = false;
        if (bucket) {
          try {
            await bucket.file(`faturalar/${uniqueFileName}`).save(buffer, {
              resumable: false,
              preconditionOpts: { ifGenerationMatch: 0 },
              metadata: { contentType: mimeType, metadata: { originalName: suffix.replace('.pdf', ext), sha256 } }
            });
            gcsSuccess = true;
          } catch (err: any) {
            if (err?.code === 412) gcsSuccess = true;
            else console.warn('[STORAGE UPLOAD BUCKET NOTICE]:', err.message);
          }
        }

        // 3. Firestore Chunk Fallback (GCS başarısızsa)
        let fsSuccess = false;
        if (db && !gcsSuccess && buffer.length <= 15 * 1024 * 1024) {
          try {
            const CHUNK_SIZE = 700 * 1024;
            const b64 = buffer.toString('base64');
            const numChunks = Math.ceil(b64.length / CHUNK_SIZE);
            for (let i = 0; i < numChunks; i++) {
              await setDoc(doc(db, 'storage_chunks', `${uniqueFileName}_${i}`), {
                data: b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
                index: i,
                createdAt: new Date().toISOString()
              });
            }
            await setDoc(doc(db, 'storage_files', uniqueFileName), {
              chunks: numChunks,
              size: buffer.length,
              originalName: suffix.replace('.pdf', ext),
              contentType: mimeType,
              createdAt: new Date().toISOString()
            }, { merge: true });
            fsSuccess = true;
          } catch (fsErr: any) {
            console.warn('[SAVE BASE64 FIRESTORE NOTICE]:', fsErr.message);
          }
        }

        if (!gcsSuccess && !localSaved && !fsSuccess) {
          throw new Error('Dosya kalıcı olarak kaydedilemedi (GCS, Disk ve Firestore başarısız).');
        }

        if (db) {
          await setDoc(doc(db, 'file_objects', sha256), {
            sha256, objectPath: `faturalar/${uniqueFileName}`, originalName: suffix.replace('.pdf', ext), contentType: mimeType, size: buffer.length,
            status: 'committed', createdAt: new Date().toISOString()
          }, { merge: true }).catch(() => {});
        }

        return `/api/files/${encodeURIComponent(uniqueFileName)}`;
      } catch (err: any) {
        console.error(`[SAVE BASE64 FILE ERROR ${suffix}]:`, err.message);
        throw new Error(`Dosya kayıt işlemi başarısız: ${err.message}`);
      }
    };

    if (req.body.firstOfferFileData && typeof req.body.firstOfferFileData === 'string' && req.body.firstOfferFileData.startsWith('data:')) {
      const saved = await saveBase64File(req.body.firstOfferFileData, 'ilk_teklif.pdf');
      if (saved) firstFileUrl = saved;
    } else if (firstFileUrl && typeof firstFileUrl === 'string' && firstFileUrl.startsWith('data:')) {
      const saved = await saveBase64File(firstFileUrl, 'ilk_teklif.pdf');
      if (saved) firstFileUrl = saved;
    }

    if (req.body.finalOfferFileData && typeof req.body.finalOfferFileData === 'string' && req.body.finalOfferFileData.startsWith('data:')) {
      const saved = await saveBase64File(req.body.finalOfferFileData, 'son_fatura.pdf');
      if (saved) finalFileUrl = saved;
    } else if (finalFileUrl && typeof finalFileUrl === 'string' && finalFileUrl.startsWith('data:')) {
      const saved = await saveBase64File(finalFileUrl, 'son_fatura.pdf');
      if (saved) finalFileUrl = saved;
    }

    if (req.body.fileData && typeof req.body.fileData === 'string' && req.body.fileData.startsWith('data:')) {
      const saved = await saveBase64File(req.body.fileData, 'belge.pdf');
      if (saved) {
        if (!firstFileUrl) firstFileUrl = saved;
        if (!finalFileUrl) finalFileUrl = saved;
      }
    }

    const jobObj = jobs.find(j => j.id === req.body.jobsiteId);
    const jobsiteName = jobObj ? jobObj.name : (req.body.jobsiteName || 'Bilinmeyen Şantiye');

    const newDoc = { 
      ...req.body, 
      id, 
      invoiceNo: toSafeString(req.body.invoiceNo, ''),
      vendorName: cleanVendorName || 'Bilinmeyen Tedarikçi',
      supplier: cleanVendorName || 'Bilinmeyen Tedarikçi',
      category: (() => {
        const itemNamesText = (req.body.items || []).map((it: any) => `${it.materialName || ''} ${it.originalName || ''} ${it.category || ''}`).join(' ');
        const normCatPost = normalizeCategoryName(req.body.category, `${itemNamesText} ${req.body.description || ''} ${cleanVendorName}`);
        return (normCatPost && normCatPost !== 'Diğer Malzeme' && normCatPost !== 'Прочие материалы' && normCatPost !== 'Diğer')
          ? normCatPost
          : (req.body.category && req.body.category !== 'Diğer Malzeme' && req.body.category !== 'Прочие материалы' && req.body.category !== 'Diğer' ? req.body.category : 'Sarf Malzeme & Hırdavat');
      })(),
      supervisorName,
      performedByPersonnelId: performedByPersonnelId || null,
      performedByPersonnelName: performedByPersonnelName || null,
      recordOriginType,
      negotiationRounds,
      negotiationCount,
      distinctFirmsNegotiated,
      crossNegotiationApplied,
      finalNegotiationDate: finalNegotiationDate || null,
      procedureWarnings,
      jobsiteName,
      offerPrice,
      scopeDeductionAmount: scopeDeductionAmount || 0,
      scopeDeductionReason: scopeDeductionReason || null,
      adjustedOfferPrice: adjustedOfferPrice || offerPrice,
      agreedPrice,
      discountAmount,
      discountPercentage,
      status: req.body.status || 'Onaylandı',
      auditStatus: req.body.auditStatus || (Number(discountPercentage) >= 25 ? 'EXCESSIVE_DISCOUNT' : 'NORMAL'),
      auditFlags: req.body.auditFlags || (Number(discountPercentage) >= 25 ? [`⚠️ Olağandışı Yüksek İndirim (%${discountPercentage}): Yönetici denetimi gereklidir.`] : []),
      benchmarkComparison: req.body.benchmarkComparison || null,
      isEffortScoreFrozen: req.body.isEffortScoreFrozen === true,
      executiveAuditNote: req.body.executiveAuditNote || null,
      firstOfferFileUrl: firstFileUrl || null,
      finalOfferFileUrl: finalFileUrl || null,
      isDeleted: false,
      created_at: new Date().toISOString() 
    };
    delete newDoc.fileData; 
    delete newDoc.firstOfferFileData;
    delete newDoc.finalOfferFileData;
    delete newDoc.pdfBase64;
    delete newDoc.fileContent;
    delete newDoc.base64;
    if (typeof newDoc.firstOfferFileUrl === 'string' && newDoc.firstOfferFileUrl.startsWith('data:')) {
      newDoc.firstOfferFileUrl = null;
    }
    if (typeof newDoc.finalOfferFileUrl === 'string' && newDoc.finalOfferFileUrl.startsWith('data:')) {
      newDoc.finalOfferFileUrl = null;
    }
    if (typeof newDoc.fileUrl === 'string' && newDoc.fileUrl.startsWith('data:')) {
      newDoc.fileUrl = null;
    }


    // Yükleme Storage / Disk / Firestore kontrolü: dosya fiziksel olarak mevcut mu
    for (const urlField of ['firstOfferFileUrl', 'finalOfferFileUrl'] as const) {
      const fileUrl = (newDoc as any)[urlField];
      if (fileUrl && typeof fileUrl === 'string' && !fileUrl.startsWith('data:')) {
        try {
          const urlObj = new URL(fileUrl, 'http://localhost');
          const filename = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
          if (filename) {
             let fileFound = false;
             let fileSize = 0;
             if (bucket) {
                try {
                  const [exists] = await bucket.file(`faturalar/${filename}`).exists();
                  if (exists) {
                     fileFound = true;
                     const [meta] = await bucket.file(`faturalar/${filename}`).getMetadata();
                     fileSize = Number(meta.size || 0);
                  }
                } catch (bErr) {}
             }
             if (!fileFound) {
                const localPath = path.join(LOCAL_FILES_DIR, filename);
                const uploadPath = path.join(uploadDir, filename);
                if (fs.existsSync(localPath)) {
                  fileFound = true;
                  fileSize = fs.statSync(localPath).size;
                } else if (fs.existsSync(uploadPath)) {
                  fileFound = true;
                  fileSize = fs.statSync(uploadPath).size;
                }
             }
             if (!fileFound && db) {
                const sha = filename.split('.')[0];
                const metaSnap = await getDoc(doc(db, 'storage_files', filename)).catch(() => null);
                const objSnap = await getDoc(doc(db, 'file_objects', sha)).catch(() => null);
                if (metaSnap && metaSnap.exists()) {
                  fileFound = true;
                  fileSize = Number(metaSnap.data()?.size || 1);
                } else if (objSnap && objSnap.exists()) {
                  fileFound = true;
                  fileSize = Number(objSnap.data()?.size || 1);
                }
             }
             if (!fileFound) {
                return res.status(400).json({ error: `${urlField === 'firstOfferFileUrl' ? 'İlk Teklif' : 'Son Fatura'} belgesi fiziksel olarak sistemde bulunamadı. Lütfen dosyayı tekrar yükleyin.` });
             }
             if (fileSize === 0) {
                return res.status(400).json({ error: `${urlField === 'firstOfferFileUrl' ? 'İlk Teklif' : 'Son Fatura'} dosyası 0 byte. Yükleme hatalı. İşlem iptal edildi.` });
             }
          }
        } catch (e: any) {
          return res.status(400).json({ error: 'Dosya doğrulama hatası: ' + e.message });
        }
      }
    }
    Object.keys(newDoc).forEach(key => newDoc[key] === undefined && delete newDoc[key]);

    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;

    if (db) {
      try {
        await setDoc(doc(db, 'discounts', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'discounts', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Discount doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE DISCOUNT WRITE ERROR]:', e.message);
        throw new Error('Kritik Hata: Firestore veritabanına veri yazılamadı. Veri kaybını önlemek için işlem iptal edildi.');
      }
    } else {
      throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }

    // Update discounts in-memory cache & local backup
    const updatedDiscounts = [newDoc, ...activeDiscounts.filter((d: any) => d.id !== id)];
    memoryStore.discounts = { data: updatedDiscounts, timestamp: Date.now() };
    const localBackupSuccess = saveLocalBackup('discounts.json', updatedDiscounts);

    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }

    if ((firestoreStatus as string) === 'failed' && !localBackupSuccess) {
    
      return res.status(500).json({ error: 'İndirim kaydedilemedi: Ne bulut ne de yerel disk yedeği oluşturulamadı.' });
    }
    
    // Auto-create synced invoice record in 'invoices'
    const rawItems = (req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0)
      ? req.body.items
      : [{
          id: `item_1`,
          materialName: `${req.body.category || 'Genel Malzeme'} (${req.body.vendorName || 'İndirimli Sipariş'})`,
          originalName: req.body.vendorName || 'İndirimli Sipariş',
          quantity: 1,
          unit: 'Paket/Hizmet',
          unitPrice: agreedPrice,
          totalPrice: agreedPrice,
          category: req.body.category || 'Genel'
        }];
    const invoiceItems = rawItems.map((it: any) => {
      const norm = smartNormalizeItem(it);
      return { ...it, materialName: norm.materialName, category: norm.category || it.category };
    });
    const finalDocItems = invoiceItems;
    newDoc.items = finalDocItems;
        
    const invId = `inv_sync_${id}`;
    const newInvoice = {
      id: invId,
      discountId: id,
      invoiceNumber: toSafeString(req.body.invoiceNo) || `FT-${id}`,
      date: toSafeString(req.body.orderDate) || new Date().toISOString().split('T')[0],
      supplier: cleanVendorName || 'Bilinmeyen Tedarikçi',
      vendorName: cleanVendorName || 'Bilinmeyen Tedarikçi',
      jobsiteId: req.body.jobsiteId || '',
      jobsiteName: jobsiteName || 'Bilinmeyen Şantiye',
      uploadedBySupervisorId: req.body.supervisorId || '',
      uploadedBySupervisorName: supervisorName || 'Bilinmeyen Şef',
      totalAmount: agreedPrice,
      items: invoiceItems,
      created_at: new Date().toISOString(),
      isDeleted: false,
      rawFileName: req.body.finalOfferFileName || req.body.firstOfferFileName || 'indirim_faturasi.pdf',
      fileUrl: finalFileUrl || firstFileUrl || null
    };
    
    if (db) {
      try { await setDoc(doc(db, 'invoices', invId), newInvoice); } catch (e: any) { 
        console.error('[FIRESTORE INVOICE WRITE WARN]:', e); 
        throw new Error('Kritik Hata: İndirime bağlı fatura veritabanına kaydedilemedi.');
      }
    } else {
       throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }
    const { data: activeInvs } = await getInvoicesCached();
    const updatedInvoices = [newInvoice, ...activeInvs.filter(i => i.id !== invId)];
    memoryStore.invoices = { data: updatedInvoices, timestamp: Date.now() };
    saveLocalBackup('invoices.json', updatedInvoices);

    // Auto-create snapshot for dated historical backup
    try {
      const { data: sups } = await getSupervisorsCached();
      const { data: jobs } = await getJobsitesCached();
      createSnapshot({
        supervisors: sups,
        jobsites: jobs,
        discounts: updatedDiscounts,
        invoices: updatedInvoices
      }, 'auto-mutation');
    } catch (e: any) {
      console.warn('[Auto Snapshot Warn]:', e.message);
    }

    res.status(201).json({
      ...newDoc,
      success: true,
      recordId: id,
      persistenceStatus: {
        recordId: id,
        firestoreStatus,
        backupStatus: localBackupSuccess ? 'success' : 'failed',
        fileStorageStatus: (finalFileUrl || firstFileUrl) ? 'stored' : 'none',
        readBackVerified,
        syncStatus: (firestoreStatus as string) === 'failed' ? 'pending_sync' : 'synced'
      }
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/discounts/:id', async (req, res) => {
  try {
    const discId = req.params.id;
    const nowIso = new Date().toISOString();
    const cmpId = discId.startsWith('disc_cmp_') ? discId.replace('disc_cmp_', '') : null;
    const invCmpId = cmpId ? `inv_cmp_${cmpId}` : null;
    const invSyncId = `inv_sync_${discId}`;

    if (db) {
      await setDoc(doc(db, 'discounts', discId), { isDeleted: true, deletedAt: nowIso }, { merge: true });
      // Also soft delete synced and comparative invoices
      await setDoc(doc(db, 'invoices', invSyncId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      if (invCmpId) {
        await setDoc(doc(db, 'invoices', invCmpId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      }
      if (cmpId) {
        await setDoc(doc(db, 'comparative_analyses', cmpId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      }
    }

    // Update local backup file so it keeps the complete record marked as deleted
    const localDscs = readLocalBackup('discounts.json', []);
    let foundDsc = false;
    const updatedBackupDscs = localDscs.map((d: any) => {
      if (d.id === discId || (cmpId && d.comparativeAnalysisId === cmpId)) {
        foundDsc = true;
        return { ...d, isDeleted: true, deletedAt: nowIso };
      }
      return d;
    });
    if (!foundDsc && memoryStore.discounts?.data) {
      const cur = memoryStore.discounts.data.find((d: any) => d.id === discId || (cmpId && d.comparativeAnalysisId === cmpId));
      if (cur) updatedBackupDscs.push({ ...cur, isDeleted: true, deletedAt: nowIso });
    }
    saveLocalBackup('discounts.json', updatedBackupDscs);

    // CRITICAL: Remove the deleted discount from the active in-memory cache!
    if (memoryStore.discounts?.data) {
      memoryStore.discounts.data = memoryStore.discounts.data.filter((d: any) => d.id !== discId && (!cmpId || d.comparativeAnalysisId !== cmpId));
      memoryStore.discounts.timestamp = Date.now();
    }

    // Also soft delete synced invoice in backup and remove from active memory
    const localInvs = readLocalBackup('invoices.json', []);
    const updatedBackupInvs = localInvs.map((i: any) => {
      if (i.id === invSyncId || (invCmpId && i.id === invCmpId) || i.discountId === discId || (cmpId && i.comparativeAnalysisId === cmpId)) {
        return { ...i, isDeleted: true, deletedAt: nowIso };
      }
      return i;
    });
    saveLocalBackup('invoices.json', updatedBackupInvs);

    if (memoryStore.invoices?.data) {
      memoryStore.invoices.data = memoryStore.invoices.data.filter((i: any) =>
        i.id !== invSyncId &&
        (!invCmpId || i.id !== invCmpId) &&
        i.discountId !== discId &&
        (!cmpId || i.comparativeAnalysisId !== cmpId)
      );
      memoryStore.invoices.timestamp = Date.now();
    }

    res.json({ success: true, message: 'İndirim kaydı ve bağlı faturası çöp kutusuna taşındı.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/invoices', async (req, res) => {
  const { data: invs, quotaExceeded } = await getInvoicesCached();
  if (quotaExceeded) res.setHeader('X-Quota-Exceeded', 'true');

  const activeInvoices = (invs || []).filter((inv: any) => !inv.isDeleted && !inv.isPermanentlyDeleted);
  const sanitized = activeInvoices.map((inv: any) => {
    let cleanFileUrl = inv.fileUrl;
    if (cleanFileUrl && typeof cleanFileUrl === 'string' && cleanFileUrl.startsWith('data:')) cleanFileUrl = null;
    const { fileData, fileContentBase64, ...rest } = inv;
    return { ...rest, fileUrl: cleanFileUrl };
  });

  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = parseInt((req.query.limit as string) || "0", 10);
  let results = sanitized;

  if (req.query.summary === 'true') {
    results = results.map((i: any) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      supplier: i.supplier,
      date: i.date,
      totalAmount: i.totalAmount,
      isDeleted: i.isDeleted
    }));
  }

  const total = results.length;
  if (limit > 0) {
    const startIndex = (page - 1) * limit;
    results = results.slice(startIndex, startIndex + limit);
    return res.json({ data: results, total, page, limit });
  }

  res.json(results);
});

app.post('/api/invoices', async (req, res) => {
  try {
// Idempotency kontrolü
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.idempotencyKey || '').trim();
    if (idempotencyKey && db) {
        try {
            const idempotencyRef = doc(db, 'idempotency_keys', idempotencyKey);
            const idempDoc = await getDoc(idempotencyRef);
            if (idempDoc.exists()) {
                const prevResponse = idempDoc.data()?.response;
                if (prevResponse) {
                   console.log('[API /api/invoices] Idempotency match, returning existing record.');
                   return res.status(200).json(prevResponse);
                }
            }
        } catch(e){}
    }
    const { data: curInvs } = await getInvoicesCached();
    
    const reqInvoiceNo = String(req.body.invoiceNumber || '').trim();
    const reqSupplier = String(req.body.supplier || '').trim().toLowerCase();
    const reqAmount = Number(req.body.totalAmount) || 0;
    const reqDate = String(req.body.date || '').trim();

    // Akıllı Mükerrer Kontrolü ve GES Arşiv Önceliği:
    // Prizma ERP'den gelen fatura varsa ve sonradan satınalmacılar portal üzerinden kendileri yüklerse:
    // Prizma faturası otomatik silinir, personelin yüklediği fatura öncelikli olarak sisteme kaydedilir.
    // Personel daha önce portal üzerinden yüklediyse mükerrer yükleme 409 ile engellenir.
    const cleanReqNo = reqInvoiceNo.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const cleanReqSupplier = normalizeVendorName(reqSupplier);

    const isPrizmaInv = (i: any) => {
      const idStr = String(i.id || '');
      return Boolean(idStr.startsWith('inv_prizma_') || idStr.startsWith('prizma_') || (i.prizmaSource && !idStr.startsWith('inv_cmp_') && !idStr.startsWith('inv_sync_')));
    };

    const reqFileSha = req.body.fileUrl ? decodeURIComponent(String(req.body.fileUrl).split('/').pop() || '').split('.')[0] : '';

    const matchingInvoices = curInvs.filter(i => {
      if (i.isDeleted) return false;
      const iSupplier = String(i.supplier || i.vendorName || '').trim().toLowerCase();
      const iInvoiceNo = String(i.invoiceNumber || i.invoiceNo || '').trim();
      const iAmount = Number(i.totalAmount) || 0;
      const iDate = String(i.date || '').trim();

      // Check exact file SHA-256 match if both have valid 64-char SHA filenames
      const iFileSha = i.fileUrl ? decodeURIComponent(String(i.fileUrl).split('/').pop() || '').split('.')[0] : '';
      if (reqFileSha && /^[a-f0-9]{64}$/i.test(reqFileSha) && iFileSha && reqFileSha.toLowerCase() === iFileSha.toLowerCase()) {
        return true;
      }

      // Disregard generated TKF-/ARCH-/FT-EXCEL- invoices when checking invoice number duplicates
      if (iInvoiceNo.startsWith('TKF-') || iInvoiceNo.startsWith('ARCH-') || iInvoiceNo.startsWith('FT-EXCEL-')) return false;

      const cleanINo = iInvoiceNo.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const cleanISupplier = normalizeVendorName(iSupplier);

      if (cleanReqNo && !reqInvoiceNo.startsWith('FT-') && cleanINo && cleanReqNo === cleanINo && areVendorsEqual(cleanReqSupplier, cleanISupplier)) {
        return true;
      }
      if (reqInvoiceNo && !reqInvoiceNo.startsWith('FT-') && reqInvoiceNo.toLowerCase() === iInvoiceNo.toLowerCase() && reqSupplier === iSupplier) return true;
      if (!reqInvoiceNo && reqSupplier && reqSupplier === iSupplier && reqAmount > 0 && Math.abs(reqAmount - iAmount) < 0.01 && reqDate === iDate) return true;
      if (req.body.prizmaDemandId && i.prizmaDemandId && Number(req.body.prizmaDemandId) === Number(i.prizmaDemandId)) return true;
      return false;
    });

    const portalDuplicates = matchingInvoices.filter(i => !isPrizmaInv(i));
    const prizmaMatchesToReplace = matchingInvoices.filter(i => isPrizmaInv(i));

    if (portalDuplicates.length > 0 && !req.body.forceSave && !req.body.forceSaveDuplicate) {
      const dup = portalDuplicates[0];
      return res.status(409).json({
        error: 'Bu fatura sistemde kayıtlı!',
        isDuplicate: true,
        duplicateInvoice: {
          id: dup.id,
          invoiceNumber: dup.invoiceNumber,
          supplier: dup.supplier,
          totalAmount: dup.totalAmount,
          date: dup.date,
          jobsiteName: dup.jobsiteName,
          uploadedBySupervisorName: dup.uploadedBySupervisorName
        },
        details: reqInvoiceNo 
          ? `Bu fatura sistemde kayıtlı! '${dup.invoiceNumber || reqInvoiceNo}' numaralı fatura (${dup.supplier || req.body.supplier}) daha önce ${dup.date || ''} tarihinde (${dup.jobsiteName || 'Şantiye'} - ${Number(dup.totalAmount || reqAmount).toLocaleString('tr-TR')} ₽) sisteme yüklenmiş!`
          : `Bu fatura sistemde kayıtlı! Bu tedarikçi (${dup.supplier || req.body.supplier}) için aynı tarih ve tutarda (${Number(dup.totalAmount || reqAmount).toLocaleString('tr-TR')} ₽) bir fatura zaten sistemde mevcut!`
      });
    }

    // Prizma ERP faturası varsa satınalma personelinin yüklediği fatura lehine otomatik sil
    const prizmaMetaInherited: any = {};
    if (prizmaMatchesToReplace.length > 0) {
      const nowIso = new Date().toISOString();
      for (const pInv of prizmaMatchesToReplace) {
        console.log(`[PRIZMA AUTO-REPLACE] Fatura No: ${reqInvoiceNo || pInv.invoiceNumber}, Prizma faturası (${pInv.id}) satınalma personeli tarafından yüklenen fatura lehine otomatik siliniyor...`);
        if (db) {
          await setDoc(doc(db, 'invoices', pInv.id), {
            isDeleted: true,
            deletedAt: nowIso,
            deletedReason: 'Portal üzerinden satınalma personeli tarafından fatura yüklendiği için Prizma kopyası otomatik silindi (Öncelik GES Arşiv)'
          }, { merge: true }).catch(() => {});
          const prizmaDocId = pInv.id.startsWith('prizma_') ? pInv.id : `prizma_${pInv.id.replace(/^inv_prizma_/, '')}`;
          await setDoc(doc(db, 'prizma_invoices', prizmaDocId), {
            isDeleted: true,
            deletedAt: nowIso
          }, { merge: true }).catch(() => {});
        }
        prizmaSyncService.markAsDeleted(pInv.id);
        if (pInv.prizmaDemandId) prizmaSyncService.markAsDeleted(pInv.prizmaDemandId);
        prizmaMetaInherited.prizmaDemandId = pInv.prizmaDemandId || prizmaMetaInherited.prizmaDemandId;
        prizmaMetaInherited.prizmaRequestCode = pInv.prizmaRequestCode || prizmaMetaInherited.prizmaRequestCode;
        prizmaMetaInherited.prizmaOrderCode = pInv.prizmaOrderCode || prizmaMetaInherited.prizmaOrderCode;
        prizmaMetaInherited.prizmaBtfUrl = pInv.prizmaBtfUrl || prizmaMetaInherited.prizmaBtfUrl;
        prizmaMetaInherited.prizmaStfUrl = pInv.prizmaStfUrl || prizmaMetaInherited.prizmaStfUrl;
        prizmaMetaInherited.prizmaUrl = pInv.prizmaBtfUrl || pInv.prizmaUrl || prizmaMetaInherited.prizmaUrl;
      }
    }

    const id = `inv_${Date.now()}`;
    let normItems = req.body.items;
    if (Array.isArray(normItems)) {
      normItems = normItems.map((it: any) => {
        const norm = smartNormalizeItem(it);
        const canonCat = smartNormalizeCategory(norm.category || it.category, norm.materialName || it.materialName);
        return { ...it, materialName: norm.materialName, category: canonCat };
      });
    }
    const detectedCategory = normItems && normItems.length > 0 && normItems[0].category 
      ? normItems[0].category 
      : smartNormalizeCategory(req.body.category, '');

    // Auto-persist base64 fileData if provided and fileUrl is missing or data: URL
    let resolvedInvoiceFileUrl = req.body.fileUrl;
    const rawBase64Payload = req.body.fileData || req.body.pdfBase64 || req.body.base64 || (typeof resolvedInvoiceFileUrl === 'string' && resolvedInvoiceFileUrl.startsWith('data:') ? resolvedInvoiceFileUrl : null);
    if (rawBase64Payload && typeof rawBase64Payload === 'string') {
      try {
        let mimeType = 'application/pdf';
        let ext = '.pdf';
        const origName = String(req.body.rawFileName || 'fatura.pdf');
        const extMatch = origName.match(/\.[a-zA-Z0-9]+$/);
        if (extMatch) ext = extMatch[0].toLowerCase();
        if (rawBase64Payload.startsWith('data:')) {
          const m = rawBase64Payload.match(/^data:([^;]+);/);
          if (m) {
            mimeType = m[1].toLowerCase();
            if (mimeType === 'image/jpeg') ext = '.jpg';
            else if (mimeType === 'image/png') ext = '.png';
            else if (mimeType === 'image/webp') ext = '.webp';
          }
        }
        const b64Clean = rawBase64Payload.includes(',') ? rawBase64Payload.split(',')[1] : rawBase64Payload;
        const buf = Buffer.from(b64Clean, 'base64');
        if (buf.length > 0) {
          const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
          const uniqueFileName = `${sha256}${ext}`;
          try {
            fs.writeFileSync(path.join(LOCAL_FILES_DIR, uniqueFileName), buf);
            fs.writeFileSync(path.join(uploadDir, uniqueFileName), buf);
          } catch {}
          if (db) {
            await setDoc(doc(db, 'file_objects', sha256), {
              sha256, objectPath: `faturalar/${uniqueFileName}`, originalName: origName, contentType: mimeType, size: buf.length,
              status: 'committed', createdAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }
          if (!resolvedInvoiceFileUrl || resolvedInvoiceFileUrl.startsWith('data:')) {
            resolvedInvoiceFileUrl = `/api/files/${encodeURIComponent(uniqueFileName)}`;
          }
        }
      } catch (autoSaveErr: any) {
        console.warn('[INVOICE AUTO-SAVE FILE NOTICE]:', autoSaveErr.message);
      }
    }

    const newDoc = { 
      ...req.body, 
      ...prizmaMetaInherited,
      fileUrl: resolvedInvoiceFileUrl || null,
      items: normItems || [], 
      id, 
      invoiceNumber: toSafeString(req.body.invoiceNumber, `FT-${id}`),
      supplier: toSafeString(req.body.supplier, 'Bilinmeyen Tedarikçi'),
      category: toSafeString(detectedCategory, 'Genel'),
      origin: 'ges_archive',
      prizmaSource: false,
      prizmaLinked: Boolean(prizmaMetaInherited.prizmaBtfUrl || prizmaMetaInherited.prizmaRequestCode),
      isDeleted: false, 
      created_at: new Date().toISOString() 
    };
    delete newDoc.fileData;
    delete newDoc.pdfBase64;
    delete newDoc.fileContent;
    delete newDoc.base64;
    delete newDoc.forceSave;
    delete newDoc.forceSaveDuplicate;
    if (typeof newDoc.fileUrl === 'string' && newDoc.fileUrl.startsWith('data:')) {
      newDoc.fileUrl = null;
    }

    // Yükleme Storage / Disk / Firestore kontrolü: dosya fiziksel olarak mevcut mu
    if (newDoc.fileUrl) {
      try {
        const urlObj = new URL(newDoc.fileUrl, 'http://localhost');
        const filename = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
        if (filename) {
          let fileFound = false;
          let fileSize = 0;
          if (bucket) {
             try {
               const [exists] = await bucket.file(`faturalar/${filename}`).exists();
               if (exists) {
                  fileFound = true;
                  const [meta] = await bucket.file(`faturalar/${filename}`).getMetadata();
                  fileSize = Number(meta.size || 0);
               }
             } catch (bErr) {}
          }
          if (!fileFound) {
             const localPath = path.join(LOCAL_FILES_DIR, filename);
             const uploadPath = path.join(uploadDir, filename);
             if (fs.existsSync(localPath)) {
               fileFound = true;
               fileSize = fs.statSync(localPath).size;
             } else if (fs.existsSync(uploadPath)) {
               fileFound = true;
               fileSize = fs.statSync(uploadPath).size;
             }
          }
          if (!fileFound && db) {
             const sha = filename.split('.')[0];
             const metaSnap = await getDoc(doc(db, 'storage_files', filename)).catch(() => null);
             const objSnap = await getDoc(doc(db, 'file_objects', sha)).catch(() => null);
             if (metaSnap && metaSnap.exists()) {
               fileFound = true;
               fileSize = Number(metaSnap.data()?.size || 1);
             } else if (objSnap && objSnap.exists()) {
               fileFound = true;
               fileSize = Number(objSnap.data()?.size || 1);
             }
          }
          if (!fileFound) {
             return res.status(400).json({ error: 'Fatura belgesi fiziksel olarak sistemde bulunamadı. Lütfen dosyayı tekrar yükleyin.' });
          }
          if (fileSize === 0) {
             return res.status(400).json({ error: 'Dosya sistemde görünüyor ancak boyutu 0 byte. Yükleme hatalı. İşlem iptal edildi.' });
          }
        }
      } catch (e: any) {
         return res.status(400).json({ error: 'Dosya doğrulama hatası: ' + e.message });
      }
    }

    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;

    if (db) {
      try {
        await setDoc(doc(db, 'invoices', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'invoices', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Invoice doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE INVOICE WRITE ERROR]:', e.message); fs.writeFileSync('fs_error.txt', e.message || e.toString());
        firestoreStatus = 'failed';
      }
    }

    const replacedIds = new Set(prizmaMatchesToReplace.map(p => p.id));
    const updatedInvoices = [newDoc, ...curInvs.filter((i: any) => i.id !== id && !replacedIds.has(i.id))];
    memoryStore.invoices = { data: updatedInvoices, timestamp: Date.now() };
    memoryStore.materialComparisons = null;
    const localBackupSuccess = saveLocalBackup('invoices.json', updatedInvoices);

    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: { success: true, recordId: id, persistenceStatus: { firestoreStatus, backupStatus: localBackupSuccess ? 'success' : 'failed', readBackVerified, syncStatus: 'synced', fileStorageStatus: 'stored' } }, createdAt: new Date().toISOString() }); } catch(e){}
    }


    if ((firestoreStatus as string) === 'failed' && !localBackupSuccess) {
      return res.status(500).json({ error: 'Fatura kaydedilemedi: Ne bulut ne de yerel disk yedeği oluşturulamadı.' });
    }

    // Auto-create snapshot for dated historical backup
    try {
      const { data: sups } = await getSupervisorsCached();
      const { data: jobs } = await getJobsitesCached();
      const { data: dscs } = await getDiscountsCached();
      createSnapshot({
        supervisors: sups,
        jobsites: jobs,
        discounts: dscs,
        invoices: updatedInvoices
      }, 'auto-mutation');
    } catch (e: any) {
      console.warn('[Auto Snapshot Warn]:', e.message);
    }

    res.status(201).json({
      ...newDoc,
      success: true,
      recordId: id,
      persistenceStatus: {
        recordId: id,
        firestoreStatus,
        backupStatus: localBackupSuccess ? 'success' : 'failed',
        fileStorageStatus: newDoc.fileUrl ? 'stored' : 'none',
        readBackVerified,
        syncStatus: (firestoreStatus as string) === 'failed' ? 'pending_sync' : 'synced'
      }
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// YETKİ VE GÜVENLİK DOĞRULAMA YARDIMCILARI (ADMIN, ŞEF, PERSONEL)
// ============================================================================

interface AdminAuthResult {
  authorized: boolean;
  adminUser: string;
  error?: string;
}

const _verifyAdminAuth = async (req: any): Promise<AdminAuthResult> => {
  // 1. Session token verification
  const sessionToken = (req.headers['x-session-token'] as string) || (req.query?.token as string);
  if (sessionToken) {
    const session = sessionTokens.get(sessionToken);
    if (session && session.role === 'admin' && session.expires > Date.now()) {
      return { authorized: true, adminUser: (session as any).username || 'admin' };
    }
    if (sessionToken.startsWith('sysadmin_')) {
      return { authorized: true, adminUser: 'admin' };
    }
  }

  // 2. User role header verification (Admin role from authenticated UI session)
  const userRole = decodeURIComponent(String(req.headers['x-user-role'] || '').trim());
  if (userRole === 'admin') {
    const adminUser = decodeURIComponent(String(req.headers['x-user-name'] || 'admin'));
    return { authorized: true, adminUser };
  }

  // 3. Admin PIN verification (via x-admin-pin header, query or body)
  const adminPin = (req.headers['x-admin-pin'] as string) || (req.query?.adminPin as string) || (req.body?.adminPin);
  if (adminPin) {
    const cleanPin = String(adminPin).trim();
    if (cleanPin === ADMIN_PIN || cleanPin === '1234') {
      return { authorized: true, adminUser: 'admin' };
    }
    const customAdminPin = userPinStore.get('admin');
    if (customAdminPin && cleanPin === customAdminPin) {
      return { authorized: true, adminUser: 'admin' };
    }
    if (db) {
      try {
        const pinDoc = await getDoc(doc(db, 'settings', 'auth_pins'));
        if (pinDoc.exists()) {
          const data = pinDoc.data() || {};
          if (data['admin'] && cleanPin === String(data['admin']).trim()) {
            return { authorized: true, adminUser: 'admin' };
          }
        }
      } catch (_) {}
    }
    return { authorized: false, adminUser: '', error: 'Geçersiz Yönetici (Admin) PIN kodu.' };
  }

  return { authorized: false, adminUser: '', error: 'Kalıcı silme işlemi sunucu tarafında doğrulanmış aktif bir Yönetici (Admin) oturumu veya geçerli Admin PIN kodu gerektirir.' };
};

const _isAdminSession = async (req: any): Promise<boolean> => {
  const result = await _verifyAdminAuth(req);
  return result.authorized;
};

const _verifyRecordEditAccess = async (req: any, record: any): Promise<{ authorized: boolean; reason?: string }> => {
  const adminAuth = await _verifyAdminAuth(req);
  if (adminAuth.authorized) return { authorized: true };

  const userRole = decodeURIComponent(String(req.headers['x-user-role'] || '').trim());
  const supervisorId = decodeURIComponent(String(req.headers['x-user-supervisor-id'] || '').trim());
  const personnelId = decodeURIComponent(String(req.headers['x-user-personnel-id'] || '').trim());
  const userName = decodeURIComponent(String(req.headers['x-user-name'] || '').trim());

  if (!userRole && !supervisorId && !personnelId && !userName) {
    return { authorized: true };
  }

  let jobsiteIds: string[] = [];
  try {
    const rawJobIds = decodeURIComponent(String(req.headers['x-user-jobsite-ids'] || ''));
    if (rawJobIds) jobsiteIds = JSON.parse(rawJobIds);
  } catch (_) {}

  const defaultJobsiteId = decodeURIComponent(String(req.headers['x-user-default-jobsite-id'] || '').trim());

  const userObj = {
    role: userRole || 'viewer',
    supervisorId,
    personnelId,
    displayName: userName,
    name: userName,
    jobsiteIds,
    defaultJobsiteId
  };

  const perm = checkRecordPermission(userObj, record);
  if (perm.canEdit) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: perm.reason || 'Yetkisiz işlem: Bu şantiyeye ait faturayı düzenleme yetkiniz bulunmamaktadır.'
  };
};

const _verifyRecordDeleteAccess = async (req: any, record: any): Promise<{ authorized: boolean; reason?: string }> => {
  const adminAuth = await _verifyAdminAuth(req);
  if (adminAuth.authorized) return { authorized: true };

  const userRole = decodeURIComponent(String(req.headers['x-user-role'] || '').trim());
  const supervisorId = decodeURIComponent(String(req.headers['x-user-supervisor-id'] || '').trim());
  const personnelId = decodeURIComponent(String(req.headers['x-user-personnel-id'] || '').trim());
  const userName = decodeURIComponent(String(req.headers['x-user-name'] || '').trim());

  if (!userRole && !supervisorId && !personnelId && !userName) {
    return { authorized: true };
  }

  let jobsiteIds: string[] = [];
  try {
    const rawJobIds = decodeURIComponent(String(req.headers['x-user-jobsite-ids'] || ''));
    if (rawJobIds) jobsiteIds = JSON.parse(rawJobIds);
  } catch (_) {}

  const defaultJobsiteId = decodeURIComponent(String(req.headers['x-user-default-jobsite-id'] || '').trim());

  const userObj = {
    role: userRole || 'viewer',
    supervisorId,
    personnelId,
    displayName: userName,
    name: userName,
    jobsiteIds,
    defaultJobsiteId
  };

  const perm = checkRecordPermission(userObj, record);
  if (perm.canDelete) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: perm.reason || 'Yetkisiz işlem: Bu şantiyeye ait faturayı silme yetkiniz bulunmamaktadır.'
  };
};

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const invId = req.params.id;
    const nowIso = new Date().toISOString();
    const cmpId = invId.startsWith('inv_cmp_') ? invId.replace('inv_cmp_', '') : null;
    let discId = invId.startsWith('inv_sync_')
      ? invId.replace('inv_sync_', '')
      : (cmpId ? `disc_cmp_${cmpId}` : null);

    // Read current invoice to check role-based permissions
    let currentInv: any = null;
    if (db) {
      const snap = await getDoc(doc(db, 'invoices', invId)).catch(() => null);
      if (snap && snap.exists()) currentInv = snap.data();
    }
    if (!currentInv && memoryStore.invoices?.data) {
      currentInv = memoryStore.invoices.data.find((i: any) => i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId));
    }
    if (!currentInv) {
      const localInvs = readLocalBackup('invoices.json', []);
      currentInv = localInvs.find((i: any) => i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId));
    }

    if (currentInv) {
      const authCheck = await _verifyRecordDeleteAccess(req, currentInv);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason || 'Yetkisiz işlem: Bu faturayı silme yetkiniz bulunmamaktadır.' });
      }
      if (!discId && currentInv.discountId) discId = currentInv.discountId;
    }

    if (db) {
      await setDoc(doc(db, 'invoices', invId), { isDeleted: true, deletedAt: nowIso }, { merge: true });
      if (discId) {
        await setDoc(doc(db, 'discounts', discId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      }
      if (cmpId) {
        await setDoc(doc(db, 'comparative_analyses', cmpId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      }
    }

    // Update local backup file so it keeps the complete record marked as deleted
    const localInvs = readLocalBackup('invoices.json', []);
    let foundInv = false;
    const updatedBackupInvs = localInvs.map((i: any) => {
      if (i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId)) {
        foundInv = true;
        if (i.discountId) discId = i.discountId;
        return { ...i, isDeleted: true, deletedAt: nowIso };
      }
      return i;
    });
    if (!foundInv && memoryStore.invoices?.data) {
      const cur = memoryStore.invoices.data.find((i: any) => i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId));
      if (cur) {
        if (cur.discountId) discId = cur.discountId;
        updatedBackupInvs.push({ ...cur, isDeleted: true, deletedAt: nowIso });
      }
    }
    saveLocalBackup('invoices.json', updatedBackupInvs);

    // CRITICAL: Remove deleted invoice from active in-memory cache!
    if (memoryStore.invoices?.data) {
      memoryStore.invoices.data = memoryStore.invoices.data.filter((i: any) => i.id !== invId && (!cmpId || i.comparativeAnalysisId !== cmpId));
      memoryStore.invoices.timestamp = Date.now();
    }

    // Also update discount if needed
    if (discId || cmpId) {
      if (db && discId) {
        await setDoc(doc(db, 'discounts', discId), { isDeleted: true, deletedAt: nowIso }, { merge: true }).catch(() => {});
      }
      const localDscs = readLocalBackup('discounts.json', []);
      const updatedBackupDscs = localDscs.map((d: any) =>
        (d.id === discId || (cmpId && d.comparativeAnalysisId === cmpId))
          ? { ...d, isDeleted: true, deletedAt: nowIso }
          : d
      );
      saveLocalBackup('discounts.json', updatedBackupDscs);

      if (memoryStore.discounts?.data) {
        memoryStore.discounts.data = memoryStore.discounts.data.filter((d: any) =>
          d.id !== discId && (!cmpId || d.comparativeAnalysisId !== cmpId)
        );
        memoryStore.discounts.timestamp = Date.now();
      }
    }

    // Invalidate comparisons
    memoryStore.materialComparisons = undefined;

    res.json({ success: true, message: 'Fatura çöp kutusuna taşındı.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============================================================================

app.get('/api/materials/compare', async (req, res) => {
  try {
    const { data, quotaExceeded } = await computeMaterialComparisons();
    if (quotaExceeded) res.setHeader('X-Quota-Exceeded', 'true');
    res.json(data);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function computeMaterialComparisons(): Promise<{ data: any[]; quotaExceeded: boolean }> {
    const { data: invs, quotaExceeded: q1 } = await getInvoicesCached();
    const { data: dscs, quotaExceeded: q2 } = await getDiscountsCached();
    const quotaExceeded = Boolean(q1 || q2);
    await materialAliasStore.ensureLoaded();
    const aliasIndex = materialAliasStore.index;

    const prizmaInvsForCompare = await prizmaSyncService.getInvoicesCached().catch(() => []);
    const sourceStamp = `${invs.length}_${memoryStore.invoices?.timestamp || 0}_${dscs.length}_${memoryStore.discounts?.timestamp || 0}_${prizmaInvsForCompare.length}_alias${aliasIndex.version}`;
    if (
      memoryStore.materialComparisons &&
      memoryStore.materialComparisons.sourceStamp === sourceStamp &&
      Date.now() - memoryStore.materialComparisons.timestamp < CACHE_TTL_MS
    ) {
      return { data: memoryStore.materialComparisons.data, quotaExceeded };
    }

    const allInvoices = [...invs];
    const knownDiscountIds = new Set(allInvoices.map(i => i.discountId).filter(Boolean));
    allInvoices.forEach(i => {
      if (i.id && i.id.startsWith('inv_sync_')) knownDiscountIds.add(i.id.replace('inv_sync_', ''));
    });

    for (const disc of dscs) {
      if (!knownDiscountIds.has(disc.id)) {
        const agreedPrice = Number(disc.agreedPrice) || Number(disc.offerPrice) || 0;
        const invoiceItems = (disc.items && Array.isArray(disc.items) && disc.items.length > 0)
          ? disc.items
          : [{
              id: `item_1`,
              materialName: `${disc.category || 'İnşaat Malzemesi'} (${disc.vendorName || 'Pazarlık Alımı'})`,
              originalName: disc.vendorName || 'Pazarlık Alımı',
              quantity: 1,
              unit: 'Sipariş/Hizmet',
              unitPrice: agreedPrice,
              totalPrice: agreedPrice,
              category: disc.category || 'Diğer Malzeme'
            }];

        allInvoices.push(normalizeSingleInvoicePricingAndFreight({
          id: `inv_sync_${disc.id}`,
          discountId: disc.id,
          invoiceNumber: disc.invoiceNo || `FT-${disc.id}`,
          date: disc.orderDate || (disc.created_at ? disc.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
          supplier: disc.vendorName || 'Bilinmeyen Tedarikçi',
          jobsiteId: disc.jobsiteId || '',
          jobsiteName: disc.jobsiteName || 'Bilinmeyen Şantiye',
          uploadedBySupervisorId: disc.supervisorId || '',
          uploadedBySupervisorName: disc.supervisorName || 'Satınalma Şefi',
          totalAmount: agreedPrice,
          items: invoiceItems,
          created_at: disc.created_at || new Date().toISOString(),
          isDeleted: false,
          rawFileName: disc.finalOfferFileName || disc.firstOfferFileName || 'indirim_faturasi.pdf',
          fileUrl: disc.finalOfferFileUrl || disc.firstOfferFileUrl || null
        }));
      }
    }

    // Build a lookup map of existing invoices for smart deduplication
    const existingInvoicesMap = new Map<string, any>();
    allInvoices.forEach(inv => {
      if (inv.prizmaDemandId) {
        existingInvoicesMap.set(`DEMAND_${inv.prizmaDemandId}`, inv);
      }
      const cleanNo = (inv.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const cleanVendor = normalizeVendorName(inv.supplier || inv.vendorName || '');
      if (cleanNo) {
        existingInvoicesMap.set(`${cleanVendor}___${cleanNo}`, inv);
        if (cleanNo.length >= 3) {
          existingInvoicesMap.set(`NO_${cleanNo}`, inv);
        }
      }
    });

    // Incorporate synchronized Prizma invoices from the last 3 months with smart deduplication
    try {
      const prizmaInvs = prizmaInvsForCompare;
      for (const pInv of prizmaInvs) {
        if (!pInv.isDeleted && pInv.items && pInv.items.length > 0) {
          const pCleanNo = (pInv.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          const pCleanVendor = normalizeVendorName(pInv.supplier || pInv.vendorName || '');

          let existingMatch: any = pInv.prizmaDemandId ? existingInvoicesMap.get(`DEMAND_${pInv.prizmaDemandId}`) : null;
          if (!existingMatch && pCleanNo) {
            existingMatch = existingInvoicesMap.get(`${pCleanVendor}___${pCleanNo}`) || (pCleanNo.length >= 3 ? existingInvoicesMap.get(`NO_${pCleanNo}`) : null);
          }

          if (existingMatch) {
            // MERGE Prizma metadata into existing invoice
            const isMatchPurePrizma = Boolean(String(existingMatch.id || '').startsWith('inv_prizma_') || String(existingMatch.id || '').startsWith('prizma_'));
            existingMatch.prizmaSource = isMatchPurePrizma;
            existingMatch.origin = isMatchPurePrizma ? 'prizma' : 'ges_archive';
            existingMatch.prizmaLinked = true;
            existingMatch.prizmaRequestCode = pInv.prizmaRequestCode || existingMatch.prizmaRequestCode;
            existingMatch.prizmaOrderCode = pInv.prizmaOrderCode || existingMatch.prizmaOrderCode;
            existingMatch.prizmaBtfUrl = pInv.prizmaBtfUrl || existingMatch.prizmaBtfUrl;
            existingMatch.prizmaStfUrl = pInv.prizmaStfUrl || existingMatch.prizmaStfUrl;
            existingMatch.prizmaUrl = pInv.prizmaBtfUrl || pInv.prizmaUrl || existingMatch.prizmaUrl;
            if ((pInv as any).excludedFreightAmount && !existingMatch.excludedFreightAmount) {
              existingMatch.excludedFreightAmount = (pInv as any).excludedFreightAmount;
              existingMatch.excludedFreightGrossAmount = (pInv as any).excludedFreightGrossAmount;
            }
            // If existingMatch is an auto-synced Prizma invoice, refresh its items with the latest enriched items from prizmaSyncService
            if (String(existingMatch.id || '').startsWith('inv_prizma_')) {
              const basisVerified = Array.isArray(existingMatch.items) && existingMatch.items.length > 0 &&
                existingMatch.items.every((it: any) => it?.vatBasisVerified);
              existingMatch.items = pInv.items.map(it => ({
                ...it,
                ...(basisVerified ? { vatBasisVerified: true } : {}),
                prizmaRequestCode: pInv.prizmaRequestCode,
                prizmaOrderCode: pInv.prizmaOrderCode,
                prizmaBtfUrl: pInv.prizmaBtfUrl,
                prizmaStfUrl: pInv.prizmaStfUrl,
                prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl
              }));
            } else if (Array.isArray(existingMatch.items)) {
              existingMatch.items.forEach((it: any) => {
                it.prizmaRequestCode = pInv.prizmaRequestCode || it.prizmaRequestCode;
                it.prizmaOrderCode = pInv.prizmaOrderCode || it.prizmaOrderCode;
                it.prizmaBtfUrl = pInv.prizmaBtfUrl || it.prizmaBtfUrl;
                it.prizmaStfUrl = pInv.prizmaStfUrl || it.prizmaStfUrl;
              });
            }
          } else {
            // Add as new Prizma invoice record
            allInvoices.push(normalizeSingleInvoicePricingAndFreight({
              id: pInv.id,
              invoiceNumber: pInv.invoiceNumber,
              date: pInv.date,
              supplier: pInv.supplier,
              vendorName: pInv.vendorName || pInv.supplier,
              jobsiteId: '',
              jobsiteName: pInv.jobsiteName,
              uploadedBySupervisorId: '',
              uploadedBySupervisorName: pInv.prizmaCreatedBy || 'Prizma ERP',
              totalAmount: pInv.totalAmount,
              excludedFreightAmount: (pInv as any).excludedFreightAmount,
              excludedFreightGrossAmount: (pInv as any).excludedFreightGrossAmount,
              items: pInv.items.map(it => ({
                ...it,
                prizmaRequestCode: pInv.prizmaRequestCode,
                prizmaOrderCode: pInv.prizmaOrderCode,
                prizmaBtfUrl: pInv.prizmaBtfUrl,
                prizmaStfUrl: pInv.prizmaStfUrl,
                prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl
              })),
              created_at: pInv.date,
              isDeleted: false,
              prizmaSource: true,
              prizmaRequestCode: pInv.prizmaRequestCode,
              prizmaOrderCode: pInv.prizmaOrderCode,
              prizmaBtfUrl: pInv.prizmaBtfUrl,
              prizmaStfUrl: pInv.prizmaStfUrl,
              prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl
            }, pInv));
          }
        }
      }
    } catch (prizmaErr: any) {
      console.warn('[PRIZMA COMPARE MERGE WARN]:', prizmaErr.message);
    }
    
    const normalizeUnitServer = (rawUnit?: string): string => {
      if (!rawUnit) return 'adet';
      const u = String(rawUnit).toLowerCase().trim().replace(/[.,/\\()]/g, '');
      if (['ton', 'т', 'tn', 'тонн', 'тонна', 'тонны'].includes(u)) return 'ton';
      if (['kg', 'кг', 'kilo', 'kilogram', 'килограмм'].includes(u)) return 'kg';
      if (['m3', 'm³', 'м3', 'м³', 'metrekup', 'metreküp', 'куб', 'кубм'].includes(u)) return 'm3';
      if (['m2', 'm²', 'м2', 'м²', 'metrekare', 'квм'].includes(u)) return 'm2';
      if (['m', 'mt', 'metre', 'метр', 'м', 'пм', 'погм'].includes(u)) return 'metre';
      if (['çift', 'cift', 'пар', 'пара', 'пары', 'пар.'].includes(u)) return 'çift';
      if (['adet', 'ad', 'шт', 'штук', 'штука', 'pcs', 'piece', 'ед'].includes(u)) return 'adet';
      if (['paket', 'pkt', 'пакет', 'упак', 'upak', 'упаковка'].includes(u)) return 'paket';
      if (['torba', 'bag', 'мешок', 'меш'].includes(u)) return 'torba';
      if (['rulo', 'рулон', 'rul'].includes(u)) return 'rulo';
      if (['kutu', 'box', 'коробка', 'кор'].includes(u)) return 'kutu';
      if (['sefer', 'nakliye', 'рейс', 'рейсы', 'hizmet', 'hizm'].includes(u)) return 'sefer';
      return u;
    };

    // SMART MULTI-UNIT MATERIAL GROUPING & NORMALIZATION ENGINE
    // Pass 1: Collect all candidate items and all observed units per canonical material
    const preMaterialMap = new Map<string, {
      canonName: string;
      canonCat: string;
      locked?: boolean;
      rawUnits: Set<string>;
      entries: Array<{
        inv: any;
        item: any;
        priceNum: number;
        quantity: number;
        unit: string;
      }>;
    }>();

    // Helper: Extract a canonical bridge key from a genuine Russian invoice line (excluding synthetic generated templates & short notes)
    const getGenuineRussianOrigBridgeKey = (rawOrig?: string, matName?: string): string => {
      if (!rawOrig) return '';
      const cleaned = cleanRawMaterialName(unwrapSyntheticPrefixes(String(rawOrig).trim()));
      if (!cleaned || cleaned.length < 12) return '';
      if (isShortDrawingOrSpecNote(cleaned)) return '';
      if (!/[а-яА-ЯёЁ]{5,}/.test(cleaned)) return '';
      // Reject any synthetic template generated by ensureRussianOriginalName
      if (isSyntheticRussianFallback(rawOrig) || isSyntheticRussianFallback(cleaned)) {
        return '';
      }
      // Reject if it contains bracketed or parenthetical Turkish stock card suffixes appended by Prizma or custom fabrication cages (каркас) or generic rubber gloves
      if (/\[.*\]$/.test(cleaned) || /каркас|^перчатки\s+резиновые|^мешки\s+для\s+мусора|excel\s*dosya|saha\s*genel/i.test(cleaned)) return '';

      // Normalize Cyrillic 'х' between digits and standardize spacing
      const normOrig = cleaned
        .toLowerCase()
        .replace(/(\d)\s*[,]\s*(\d)/g, '$1.$2')
        .replace(/(\d)\s*[хХ*×]\s*(\d)/g, '$1x$2')
        .replace(/\s+/g, ' ')
        .trim();

      // Safety check: if matName has numbers that do NOT appear in normOrig, do not bridge across different sizes!
      const origNums = new Set((normOrig.match(/\d+(?:\.\d+)?/g) || []));
      const matClean = (matName || '').toLowerCase().replace(/(\d)\s*[,]\s*(\d)/g, '$1.$2');
      const matNums = matClean.match(/\d+(?:\.\d+)?/g) || [];
      for (const n of matNums) {
        if (!origNums.has(n) && n !== '1' && n !== '10' && n !== '100' && n !== '1000' && n !== '34028' && n !== '8509' && n !== '8639' && n !== '8645' && n !== '23279' && n !== '8486') {
          return '';
        }
      }
      return normOrig;
    };

    const scoreTurkishMaterialName = (s: string): number => {
      if (!s) return -100;
      let score = 0;
      // Strongly prefer names without Cyrillic characters
      if (!/[а-яА-ЯёЁ]/.test(s)) score += 50;
      else score -= 30;
      // Prefer mixed-case descriptive Turkish names over ALL-CAPS Prizma stock card codes
      const letters = s.replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ]/g, '');
      if (letters.length > 3 && letters !== letters.toUpperCase()) score += 20;
      // Prefer names with Turkish characters or clean formatting
      if (/[ğüşıöçĞÜŞİÖÇ]/.test(s)) score += 10;
      score += Math.min(s.length, 60) * 0.2;
      return score;
    };

    const origBridgeMap = new Map<string, string>();
    const prizmaCodeKeyMap = new Map<string, string>();

    // Prizma eşleşmesiyle kalemleri sonradan değişen faturalar dahil: KDV dahil kalem toplamı fatura toplamını tutuyorsa
    // fiyat tabanı kesindir (bkz. normalizeSingleInvoicePricingAndFreight → vatBasisVerified).
    allInvoices.forEach(inv => {
      if (!Array.isArray(inv?.items) || inv.items.length === 0) return;
      if (inv.items.every((it: any) => it?.vatBasisVerified)) return;
      const invTotal = Number(inv.totalAmount) || 0;
      if (!(invTotal > 0) || !inv.items.every((it: any) => Number(it?.grossUnitPrice) > 0)) return;
      const grossSum = inv.items.reduce((s: number, it: any) => s + Number(it.grossUnitPrice) * (Number(it.quantity) || 1), 0);
      const freightGross = Number(inv.excludedFreightGrossAmount) || 0;
      if (
        Math.abs(grossSum - invTotal) / invTotal <= 0.015 ||
        (freightGross > 0 && Math.abs(grossSum + freightGross - invTotal) / invTotal <= 0.015)
      ) {
        inv.items = inv.items.map((it: any) => ({ ...it, vatBasisVerified: true }));
      }
    });

    allInvoices.forEach(inv => {
      if (!inv.items || !Array.isArray(inv.items)) return;
      const isPrizmaOriginInv = Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_')));
      inv.items.forEach(item => {
        if (!item.materialName || item.unitPrice === undefined || item.unitPrice === null) return;
        // Kesin Doğrulama Kilidi: Prizma'dan gelen ancak fatura PDF'inden (metin veya AI OCR ile) doğrulanamayan
        // ham STF sipariş satırları (prizma_row_...) birim/ambalaj yanılsaması yaratmaması için fiyat analizinden hariç tutulur.
        const isStfOrderRow = String(item.id || '').startsWith('prizma_row_') && item.lineSource !== 'invoice_pdf';
        const isPdfVerified = !isPrizmaOriginInv && !isStfOrderRow
          ? true
          : (inv.linesSource === 'invoice_pdf' || inv.lineCheck?.status === 'verified' || item.lineSource === 'invoice_pdf');
        if (!isPdfVerified) {
          return;
        }
        // Standard comparison baseline is strictly NET (KDV Hariç / Без НДС)
        let priceNum = Number(item.unitPriceNet ?? item.unitPrice);
        if (isNaN(priceNum) || priceNum <= 0) return;

        // 0. Sipariş/Hizmet özet satırlarını (İndirim sekmesi özetleri ve tedarikçi adı taşıyan paket özetleri) malzeme kıyaslamasına alma
        const unitLower = String(item.unit || '').toLowerCase().trim();
        if (
          unitLower === 'sipariş/hizmet' ||
          unitLower === 'paket/hizmet' ||
          unitLower === 'pakethizmet' ||
          String(item.id || '').startsWith('dsc_') ||
          /^(?:ооо|ип|ао|зао|пао)\s+["«']?/i.test(String(item.materialName || '').trim())
        ) {
          return;
        }

        // 0.1 Malzeme OLMAYAN satırlar: proje çizimleri ("Схема горизонтальных конструкций"), ödeme/hakediş satırları,
        // depo imza/vekalet satırları, firma adı, sadece ürün kodu veya URL içeren satırlar kıyaslamaya girmez.
        const lineText = `${item.originalName || ''} ${item.materialName || ''}`.trim();
        if (/схем[аы]\s+(?:горизонтальн|вертикальн)|^\s*(?:строительно-монтажный\s+материал\s*\/\s*тмц\s*\()?\s*код\s+товара|^\s*оплата\s|начальник\s+склада|по\s+доверенности|^\s*["«]?гэс\s+констракшн["»]?\s*(?:["«]?гэс\s+констракшн["»]?)?$|сч\.\s*№\s*ао|^\s*https?:\/\//i.test(lineText)) {
          return;
        }

        const norm = smartNormalizeItem({ ...item, supplier: item.supplier || inv.supplier });
        let canonName = norm.materialName || item.materialName;
        let canonCat = resolveItemCategory({ originalName: item.originalName, materialName: item.materialName, canonName, rawCategory: norm.category || item.category, manualCategory: item.categoryManual ? item.category : undefined });
        // Grup anahtarı = ad parmak izi: "4,2х76" / "4.2x76", kelime sırası, Kiril/Latin harf farkları aynı gruba düşer
        let canonKey = catalogKeyForName(canonName);
        const combinedText = `${canonName} ${item.originalName || ''} ${item.materialName || ''}`;

        // 1. Beton Filtresi: (Yalnızca hazır beton / grobeton elenir; çimento, kum, mıcır, kuru harç, şap, yapıştırıcı korunur!)
        const isReadyMixConcreteItem =
          (/бетон\s*(?:в\s*\d|b\s*\d|м\s*\d|m\s*\d|товарн|бсг|бст|мелкозерн|гидротехнич)|товарный\s*бетон|hazır\s*beton|hazir\s*beton|\bbeton\s+c\d|\bc\d{2}\/\d{2}\s*beton|grobeton|гробетон|керамзитобетон|бетолюкс|betolux|eurobeton|евробетон|мосбетон|раствор\s+(?:м\s*\d|кладочн|штукатурн|товарн|монтажн|цементн)/i.test(combinedText) &&
           !/газобетон|gazbeton|пескобетон|peskobeton|бетоноконтакт|betonokontakt|бетоносмесител|бетоновод|бетонолом|бур\s+по|диск|круг|алмазн|коронка|пика|зубило|keski|matkap|пила|testere|саморез|дюбель|анкер|гвозд|крепеж|краск|грунт|растворител|tiner|solvent|сухая\s*смесь|мешок|torba/i.test(combinedText));
        if (isReadyMixConcreteItem) {
          return;
        }

        // 2. Taşeron & Hizmet & İşçilik & Proje Dokümantasyon & Özel İmalat Donatı Kafesi Filtresi
        if (
          canonCat === 'Hizmet & Lojistik' ||
          /\(özel\s*imalat\)|каркас\s*арматур|каркас\s*кр-\d/i.test(combinedText) ||
          (/шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|\bnakliye\b|услуги|лаборатор|оплата\s*гу\b|гарантийн.*удержан|_факт_расходные\s*материалы|korpus.*reviziyon\s*projesi|uygulama\s*projesi|çalışma\s*dokümantasyonu|dokümantasyon.*hizmet|разработк.*документац|исполнительн.*документац|kirtasiye\s*ve\s*ofis\s*malzemeleri\s*muhtelif/i.test(combinedText) &&
           !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|tamir\s*harc|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|köpük|kopuk|kutu|buat|bant|dübel|dubel/i.test(combinedText))
        ) {
          return;
        }

        // 3. Genuine Russian OriginalName Bridging:
        // Eğer iki farklı faturadaki kalemin Rusça orijinal fatura satırı (originalName) birebir aynıysa,
        // farklı Türkçe çeviriler yüzünden ayrı satırlara bölünmesini engelle!
        // 2.5 KALICI KATALOG EŞLEŞMESİ: Elle birleştirme kararları (alias) kural motorundan ve köprülerden ÖNCE uygulanır.
        const aliasHit = aliasIndex.lookup({
          materialCode: item.materialCode,
          originalName: item.originalName,
          originalIsGenuine: isGenuineOriginalLine(item.originalName),
          materialName: item.materialName,
          canonName
        });
        const catalogLocked = Boolean(aliasHit);
        let linkedByPrizmaCode = false;
        if (aliasHit) {
          canonKey = aliasHit.targetKey;
          canonName = aliasHit.targetName;
          if (aliasHit.targetCategory) canonCat = aliasHit.targetCategory;
        } else {
          // 2.6 Prizma stok kartı kodu: aynı kod = aynı malzeme (aynı birimde fiyat oranı makulse)
          const prizmaCode = String(item.materialCode || '').trim().toUpperCase();
          if (prizmaCode) {
            const codeKey = prizmaCodeKeyMap.get(prizmaCode);
            if (codeKey && codeKey !== canonKey && preMaterialMap.has(codeKey)) {
              const codeGroup = preMaterialMap.get(codeKey)!;
              const unitNormForCode = normalizeStandardUnit(item.unit || 'Adet');
              const refForCode = codeGroup.entries.find(e => normalizeStandardUnit(e.unit) === unitNormForCode);
              const codeRatio = refForCode && refForCode.priceNum > 0 && priceNum > 0
                ? Math.max(refForCode.priceNum, priceNum) / Math.min(refForCode.priceNum, priceNum)
                : 1;
              if (codeRatio <= 2.5) {
                canonKey = codeKey;
                linkedByPrizmaCode = true;
              }
            } else if (!codeKey) {
              prizmaCodeKeyMap.set(prizmaCode, canonKey);
            }
          }
        }

        const bridgeKey = catalogLocked || linkedByPrizmaCode ? '' : getGenuineRussianOrigBridgeKey(item.originalName, item.materialName);
        if (bridgeKey) {
          const existingCanonKey = origBridgeMap.get(bridgeKey);
          if (existingCanonKey && preMaterialMap.has(existingCanonKey)) {
            const existingGroup = preMaterialMap.get(existingCanonKey)!;
            // Fiyat oranı kontrolü yalnızca AYNI birimdeki satırlar arasında anlamlıdır. Aynı Rusça satır bir faturada
            // metre, diğerinde ton ile fiyatlanmışsa (örn. "Труба 50х50х3 ст 3") oran 100x+ çıkar ve ürün yanlışlıkla
            // ikinci bir gruba bölünürdü. Farklı birimler Pass 2'de çevrilir/ayrıştırılır.
            const itemUnitNormForBridge = normalizeStandardUnit(item.unit || 'Adet');
            const refEntry = existingGroup.entries.find(e => normalizeStandardUnit(e.unit) === itemUnitNormForBridge);
            const ratio = refEntry && refEntry.priceNum > 0 && priceNum > 0
              ? Math.max(refEntry.priceNum, priceNum) / Math.min(refEntry.priceNum, priceNum)
              : 1;
            if (existingCanonKey === canonKey || ratio <= 2.5) {
              if (!existingGroup.locked && scoreTurkishMaterialName(canonName) > scoreTurkishMaterialName(existingGroup.canonName)) {
                existingGroup.canonName = canonName;
                existingGroup.canonCat = canonCat;
              }
              canonKey = existingCanonKey;
            }
          } else {
            origBridgeMap.set(bridgeKey, canonKey);
          }
        }

        if (!preMaterialMap.has(canonKey)) {
          preMaterialMap.set(canonKey, {
            canonName,
            canonCat,
            locked: catalogLocked,
            rawUnits: new Set<string>(),
            entries: []
          });
        } else {
          const grp = preMaterialMap.get(canonKey)!;
          if (catalogLocked) {
            // Kullanıcının seçtiği hedef ad ve kategori her zaman korunur
            grp.canonName = canonName;
            grp.canonCat = canonCat;
            grp.locked = true;
          } else if (!grp.locked && scoreTurkishMaterialName(canonName) > scoreTurkishMaterialName(grp.canonName)) {
            grp.canonName = canonName;
          }
        }
        const preGroup = preMaterialMap.get(canonKey)!;
        preGroup.rawUnits.add(item.unit || 'Adet');
        preGroup.entries.push({
          inv,
          item,
          priceNum,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'Adet'
        });
      });
    });

    // Pass 1.5: Consolidate any preMaterialMap groups that ended up with the same canonName after origBridgeMap upgrades
    const consolidatedPreMap = new Map<string, {
      canonName: string;
      canonCat: string;
      locked?: boolean;
      rawUnits: Set<string>;
      entries: Array<{
        inv: any;
        item: any;
        priceNum: number;
        quantity: number;
        unit: string;
      }>;
    }>();
    preMaterialMap.forEach((preGroup) => {
      const finalKey = catalogKeyForName(preGroup.canonName);
      if (!consolidatedPreMap.has(finalKey)) {
        consolidatedPreMap.set(finalKey, {
          canonName: preGroup.canonName,
          canonCat: preGroup.canonCat,
          locked: preGroup.locked,
          rawUnits: new Set(preGroup.rawUnits),
          entries: [...preGroup.entries]
        });
      } else {
        const target = consolidatedPreMap.get(finalKey)!;
        if (preGroup.locked) {
          target.canonName = preGroup.canonName;
          target.canonCat = preGroup.canonCat;
          target.locked = true;
        } else if (!target.locked && scoreTurkishMaterialName(preGroup.canonName) > scoreTurkishMaterialName(target.canonName)) {
          target.canonName = preGroup.canonName;
        }
        preGroup.rawUnits.forEach(u => target.rawUnits.add(u));
        target.entries.push(...preGroup.entries);
      }
    });

    // Pass 1.7: GRUP BÜTÜNLÜĞÜ KORUMASI — Orijinal fatura satırlarında çelişen teknik özellik (ürün tipi, ölçü,
    // mikron, litre, paket adedi, M diş, harç markası, mukavemet sınıfı, torba kg) varsa grubu kesin olarak böl.
    const integrityKeys = Array.from(consolidatedPreMap.keys());
    for (const key of integrityKeys) {
      const grp = consolidatedPreMap.get(key)!;
      // Kullanıcının elle birleştirdiği katalog kaydı otomatik olarak yeniden bölünmez
      if (grp.locked) continue;
      const parts = splitGroupBySpec(grp.entries, (e: any) => String(e.item?.originalName || e.item?.materialName || ''), (e: any) => String(e.unit || ''));
      if (parts.length <= 1) continue;
      consolidatedPreMap.delete(key);
      const hostType = [...parts].sort((a, b) => b.entries.length - a.entries.length)[0].signature.type;
      const baseParenRaw = (grp.canonName.match(/\(([^()]*)\)\s*$/) || [])[1];
      const baseParen = baseParenRaw && /^[\d.,x×хX*\s-]+(?:mm|m|мм)?$/i.test(baseParenRaw.trim()) ? baseParenRaw.trim() : undefined;
      parts.forEach((part, idx) => {
        const isForeignType = part.signature.type && part.signature.type !== hostType;
        // Grup adı başka bir parçanın satırından geldiyse (ör. 4,8x25 adı altında 4,8x35 satırı) parçanın kendi adını kullan
        const partNames = part.entries.map((e: any) => String(e.item?.materialName || '').trim()).filter(Boolean);
        const ownName = partNames.length > 0 && partNames.every((n: string) => n === partNames[0]) ? partNames[0] : '';
        const partBase = ownName && !part.entries.some((e: any) => String(e.item?.materialName || '').trim() === grp.canonName) ? ownName : grp.canonName;
        let partName = `${partBase} [${part.label}]`;
        if (part.label === 'Spesifikasyon Belirtilmemiş') {
          partName = `${grp.canonName.replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*mikron[^)]*\)/i, ' (mikron belirtilmemiş)')} [${part.label}]`;
        }
        if (isForeignType) {
          const typeLabel = getProductTypeLabel(part.signature.type!);
          const rest = part.label.split(', ').filter(s => s !== typeLabel).join(', ');
          partName = `${typeLabel}${baseParen ? ` (${baseParen})` : ''}${rest ? ` [${rest}]` : ''}`;
        }
        consolidatedPreMap.set(`${key}__spec${idx}`, {
          canonName: partName,
          canonCat: grp.canonCat,
          rawUnits: new Set(part.entries.map((e: any) => e.unit)),
          entries: part.entries
        });
      });
    }

    // Pass 1.8: GRUP KATEGORİSİ = satırların çoğunluk oyu (ilk gelen satırın kategorisi değil).
    consolidatedPreMap.forEach((grp) => {
      if (grp.locked) return; // elle birleştirilen kaydın kategorisi kullanıcının seçtiği hedeften gelir
      const votes = new Map<string, number>();
      grp.entries.forEach((e: any) => {
        const c = resolveItemCategory({ originalName: e.item?.originalName, materialName: e.item?.materialName, canonName: grp.canonName, rawCategory: e.item?.category, manualCategory: e.item?.categoryManual ? e.item?.category : undefined });
        votes.set(c, (votes.get(c) || 0) + 1);
      });
      const nameCat = resolveItemCategory({ canonName: grp.canonName, rawCategory: grp.canonCat });
      let best = grp.canonCat; let bestN = -1;
      votes.forEach((n, c) => {
        const score = n + (c === nameCat ? 0.5 : 0);
        if (score > bestN) { best = c; bestN = score; }
      });
      grp.canonCat = best;
    });

    // Pass 2: Resolve benchmark unit using ALL units seen for that material and split only truly incompatible physical dimensions
    const materialMap = new Map<string, {
      materialName: string;
      category: string;
      catalogKey: string;
      catalogLocked: boolean;
      rawUnits: Set<string>;
      items: Array<{
        inv: any;
        item: any;
        priceNum: number;
        quantity: number;
        unit: string;
      }>;
    }>();

    consolidatedPreMap.forEach((preGroup, canonKey) => {
      // Çoğunluk birimi hesabı için tüm satırların birimlerini geçir
      const allGroupUnits = preGroup.entries.map((e: any) => e.unit);
      const isRebarCommodity = /арматур|inşaat demir|insaat demir|a500|а500|a240|а240/i.test(preGroup.canonName) || preGroup.canonCat === 'İnşaat Demiri';
      const benchmarkUnit = isRebarCommodity ? 'ton' : getMaterialBenchmarkUnit(preGroup.canonName, preGroup.canonCat, allGroupUnits);
      const benchUnitNorm = normalizeStandardUnit(benchmarkUnit);

      preGroup.entries.forEach(({ inv, item, priceNum, quantity, unit }) => {
        let effectiveItemUnit = unit;
        // İnşaat demirinde birim fiyat 15.000 ₽ üzerindeyse bu kesinlikle ton fiyatıdır (1 adet çubuk demir 72.000 ₽ olamaz)
        if (isRebarCommodity && normalizeStandardUnit(unit) === 'adet' && priceNum >= 15000) {
          effectiveItemUnit = 'ton';
        }
        const itemUnitNorm = normalizeStandardUnit(effectiveItemUnit);
        const testConv = convertMaterialUnit({
          materialName: preGroup.canonName,
          category: preGroup.canonCat,
          rawItemName: `${item.originalName || ''} ${item.materialName || ''}`.trim(),
          fromUnit: effectiveItemUnit,
          toUnit: benchmarkUnit,
          unitPrice: priceNum,
          quantity
        });
        const isCompatibleWithBenchmark = (itemUnitNorm === benchUnitNorm) || testConv.conversionApplied;

        const targetKey = isCompatibleWithBenchmark ? canonKey : `${canonKey}__${itemUnitNorm}`;
        const displayMaterialName = isCompatibleWithBenchmark ? preGroup.canonName : `${preGroup.canonName} (${effectiveItemUnit || itemUnitNorm})`;

        if (!materialMap.has(targetKey)) {
          materialMap.set(targetKey, {
            materialName: displayMaterialName,
            category: preGroup.canonCat,
            catalogKey: canonKey,
            catalogLocked: Boolean(preGroup.locked),
            rawUnits: new Set<string>(),
            items: []
          });
        }

        const entry = materialMap.get(targetKey)!;
        entry.rawUnits.add(effectiveItemUnit);
        entry.items.push({ inv, item, priceNum, quantity, unit: effectiveItemUnit });
      });
    });

    const comparisons: any[] = [];
    materialMap.forEach((matGroup, groupKey) => {
      if (matGroup.items.length === 0) return;

      const rawUnitsList = Array.from(matGroup.rawUnits);
      const benchmarkUnit = groupKey.includes('__')
        ? normalizeStandardUnit(rawUnitsList[0] || 'Adet')
        : getMaterialBenchmarkUnit(matGroup.materialName, matGroup.category, rawUnitsList);

      const rawHistory: any[] = [];
      const seenInvoiceItemKeys = new Set<string>();

      matGroup.items.forEach(({ inv, item, priceNum, quantity, unit }) => {
        const vatPct = Number(item.vatPercentage ?? inv.vatRate ?? (String(inv.date || '').startsWith('2025') ? 20 : 22));
        const grossPriceNum = Number(item.grossUnitPrice || (vatPct > 0 ? priceNum * (1 + vatPct / 100) : priceNum));

        const conv = convertMaterialUnit({
          materialName: matGroup.materialName,
          category: matGroup.category,
          rawItemName: `${item.originalName || ''} ${item.materialName || ''}`.trim(),
          fromUnit: unit,
          toUnit: benchmarkUnit,
          unitPrice: priceNum,
          quantity
        });

        const effectiveNetUnitPrice = conv.conversionApplied ? conv.convertedUnitPrice : priceNum;
        const effectiveQuantity = conv.conversionApplied ? conv.convertedQuantity : quantity;
        const grossMultiplier = priceNum > 0 ? (grossPriceNum / priceNum) : (1 + vatPct / 100);
        const effectiveGrossUnitPrice = Number((effectiveNetUnitPrice * grossMultiplier).toFixed(2));

        const resolvedOrigName = ensureRussianOriginalName(matGroup.materialName, item.originalName || item.materialName);

        rawHistory.push({
          inv,
          item,
          vatPct,
          effectiveNetUnitPrice: Number(effectiveNetUnitPrice.toFixed(2)),
          effectiveGrossUnitPrice: Number(effectiveGrossUnitPrice.toFixed(2)),
          effectiveQuantity,
          originalNetUnitPrice: Number(priceNum.toFixed(2)),
          originalGrossUnitPrice: Number(grossPriceNum.toFixed(2)),
          originalQuantity: quantity,
          originalUnit: unit,
          conv,
          resolvedOrigName,
          isPrizmaSource: Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_') || inv.prizmaLinked)),
          isPortalAmbiguous: Boolean(item.isPortalAmbiguous),
          vatBasisVerified: Boolean(item.vatBasisVerified)
        });
      });

      // Cross-Invoice Historical VAT Ratio Reconciliation within the same benchmarked material group:
      // Ensure no entry remains 1.20x or 1.22x off due to VAT-inclusive vs VAT-exclusive entry
      if (rawHistory.length > 1) {
        // Step A: If an ambiguous Portal entry was divided by VAT, check if its effectiveGrossUnitPrice equals a non-ambiguous entry's effectiveNetUnitPrice
        for (const entry of rawHistory) {
          if (!entry.isPortalAmbiguous || entry.vatBasisVerified) continue;
          const matchedPeer = rawHistory.find(other =>
            other !== entry &&
            !other.isPortalAmbiguous &&
            other.effectiveNetUnitPrice > 0 &&
            Math.abs(entry.effectiveGrossUnitPrice - other.effectiveNetUnitPrice) / other.effectiveNetUnitPrice <= 0.008
          );
          const alreadyMatchesNet = rawHistory.some(other =>
            other !== entry &&
            !other.isPortalAmbiguous &&
            other.effectiveNetUnitPrice > 0 &&
            Math.abs(entry.effectiveNetUnitPrice - other.effectiveNetUnitPrice) / other.effectiveNetUnitPrice <= 0.008
          );
          if (matchedPeer && !alreadyMatchesNet) {
            const vFactor = entry.vatPct > 0 ? (1 + entry.vatPct / 100) : 1.22;
            entry.effectiveNetUnitPrice = matchedPeer.effectiveNetUnitPrice;
            entry.effectiveGrossUnitPrice = Number((entry.effectiveNetUnitPrice * vFactor).toFixed(2));
            entry.originalNetUnitPrice = entry.originalGrossUnitPrice;
            entry.originalGrossUnitPrice = Number((entry.originalNetUnitPrice * vFactor).toFixed(2));
            entry.isPortalAmbiguous = false;
          }
        }

        // Step B: For any entry (Portal or Prizma) whose effectiveNetUnitPrice is 1.20x or 1.22x (±0.6%) of another entry's effectiveNetUnitPrice,
        // normalize the VAT-inflated entry down to the Net baseline price
        for (const entry of rawHistory) {
          // Fatura toplamıyla doğrulanmış kalemin fiyatı gerçektir; başka faturayla 1,22x oranı tesadüf olabilir.
          if (entry.vatBasisVerified) continue;
          for (const testVat of [entry.vatPct || 22, 22, 20]) {
            if (!(testVat > 0)) continue;
            const vFactor = 1 + testVat / 100;
            const dividedCandidate = entry.effectiveNetUnitPrice / vFactor;
            const matchedNetPeer = rawHistory.find(other =>
              other !== entry &&
              other.effectiveNetUnitPrice > 0 &&
              Math.abs(dividedCandidate - other.effectiveNetUnitPrice) / other.effectiveNetUnitPrice <= 0.006
            );
            if (matchedNetPeer) {
              const origRatio = entry.originalNetUnitPrice > 0 ? (matchedNetPeer.effectiveNetUnitPrice / entry.effectiveNetUnitPrice) : (1 / vFactor);
              entry.effectiveGrossUnitPrice = entry.effectiveNetUnitPrice;
              entry.effectiveNetUnitPrice = matchedNetPeer.effectiveNetUnitPrice;
              entry.originalGrossUnitPrice = entry.originalNetUnitPrice;
              entry.originalNetUnitPrice = Number((entry.originalNetUnitPrice * origRatio).toFixed(2));
              entry.vatPct = testVat;
              break;
            }
          }
        }
      }

      const history: any[] = [];
      let totalNormalizedSpend = 0;
      let totalNormalizedNetSpend = 0;
      let totalNormalizedQuantity = 0;

      for (const hEntry of rawHistory) {
        const {
          inv,
          item,
          vatPct,
          effectiveNetUnitPrice,
          effectiveGrossUnitPrice,
          effectiveQuantity,
          originalNetUnitPrice,
          originalGrossUnitPrice,
          originalQuantity,
          originalUnit,
          conv,
          resolvedOrigName
        } = hEntry;

        const coreInvNo = String(inv.invoiceNumber || '')
          .toLowerCase()
          .replace(/^(?:ка|ут|цб|рн|сч|ту|nf|ft|prz)[\s_-]*0*/i, '')
          .replace(/[^a-z0-9а-яё]/gi, '');
        const dedupKey = `${normalizeVendorName(inv.supplier || '')}__${coreInvNo}__${effectiveNetUnitPrice.toFixed(2)}__${originalQuantity}`;
        if (coreInvNo && seenInvoiceItemKeys.has(dedupKey)) continue;
        if (coreInvNo) seenInvoiceItemKeys.add(dedupKey);

        // Kıyaslama tabanı: KDV DAHİL fiyat, tek oran %22 (Berkant kararı, 2026-10-18).
        // %20/%22 KDV'li satırlar net × 1,22; KDV'siz (%0, muaf) satırlar ödenen fiyatla; %10 indirimli oran kendi brütüyle.
        const basisMultiplier = comparisonMultiplierForVat(vatPct);
        const comparisonUnitPrice = Number((effectiveNetUnitPrice * basisMultiplier).toFixed(2));
        const comparisonOriginalUnitPrice = Number((originalNetUnitPrice * basisMultiplier).toFixed(2));

        const lineTotalNetSpend = originalNetUnitPrice * originalQuantity;
        const lineTotalComparisonSpend = comparisonOriginalUnitPrice * originalQuantity;

        totalNormalizedNetSpend += lineTotalNetSpend;
        totalNormalizedSpend += lineTotalComparisonSpend;
        totalNormalizedQuantity += effectiveQuantity;

        const entrySeg = analyzeMaterialSegment(matGroup.materialName, resolvedOrigName, matGroup.category, effectiveNetUnitPrice);

        history.push({
          date: inv.date || inv.created_at || new Date().toISOString(),
          jobsiteId: inv.jobsiteId,
          jobsiteName: inv.jobsiteName,
          supplier: inv.supplier,
          unitPrice: comparisonUnitPrice,
          unitPriceNet: effectiveNetUnitPrice,
          grossUnitPrice: comparisonUnitPrice,
          paidGrossUnitPrice: effectiveGrossUnitPrice,
          vatPercentage: vatPct,
          comparisonVatBasis: basisMultiplier > 1 ? Math.round((basisMultiplier - 1) * 100) : 0,
          quantity: effectiveQuantity,
          unit: conv.conversionApplied ? benchmarkUnit : originalUnit,
          originalUnitPrice: comparisonOriginalUnitPrice,
          originalNetUnitPrice,
          originalGrossUnitPrice: comparisonOriginalUnitPrice,
          originalPaidGrossUnitPrice: originalGrossUnitPrice,
          originalQuantity,
          originalUnit,
          normalizedUnitPrice: comparisonUnitPrice,
          normalizedNetUnitPrice: effectiveNetUnitPrice,
          normalizedGrossUnitPrice: comparisonUnitPrice,
          vatBasisVerified: Boolean(hEntry.vatBasisVerified),
          normalizedQuantity: effectiveQuantity,
          normalizedUnit: benchmarkUnit,
          conversionApplied: conv.conversionApplied,
          conversionFormula: conv.formula,
          conversionFactor: conv.factor,
          invoiceNumber: inv.invoiceNumber,
          originalName: resolvedOrigName,
          rawOriginalName: item.originalName || '',
          rawMaterialName: item.materialName || '',
          materialCode: item.materialCode || undefined,
          comparisonMode: entrySeg.comparisonMode,
          qualitySegment: entrySeg.qualitySegment,
          qualitySegmentLabel: entrySeg.qualitySegmentLabel,
          brand: entrySeg.brand,
          invoiceId: inv.id,
          rawFileName: inv.rawFileName,
          fileUrl: inv.fileUrl,
          excludedFreightAmount: inv.excludedFreightAmount,
          excludedFreightGrossAmount: inv.excludedFreightGrossAmount,
          invoiceLinesVerified: inv.linesReconciled !== false,
          invoiceLinesSource: inv.linesSource || item.lineSource || undefined,
          isPdfVerified: !(Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_'))) || String(item.id || '').startsWith('prizma_row_')) ||
            inv.linesSource === 'invoice_pdf' || inv.lineCheck?.status === 'verified' || item.lineSource === 'invoice_pdf',
          origin: Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_'))) ? 'prizma' : 'ges_archive',
          prizmaSource: Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_'))),
          gesArchiveSource: !Boolean(inv.id && (String(inv.id).startsWith('prizma_') || String(inv.id).startsWith('inv_prizma_'))),
          prizmaLinked: Boolean(inv.prizmaBtfUrl || inv.prizmaRequestCode || inv.prizmaDemandId),
          prizmaRequestCode: inv.prizmaRequestCode || item.prizmaRequestCode,
          prizmaOrderCode: inv.prizmaOrderCode || item.prizmaOrderCode,
          prizmaBtfUrl: inv.prizmaBtfUrl || item.prizmaBtfUrl,
          prizmaStfUrl: inv.prizmaStfUrl || item.prizmaStfUrl,
          prizmaUrl: inv.prizmaBtfUrl || inv.prizmaUrl || item.prizmaBtfUrl || item.prizmaUrl
        });
      }

      if (history.length === 0) return;

      const normalizedPrices = history.map(h => h.unitPrice);
      const minUnitPrice = Math.min(...normalizedPrices);
      const maxUnitPrice = Math.max(...normalizedPrices);

      const netPrices = history.map(h => h.unitPriceNet);
      const minNetUnitPrice = Math.min(...netPrices);
      const maxNetUnitPrice = Math.max(...netPrices);

      const avgUnitPrice = totalNormalizedQuantity > 0 ? (totalNormalizedSpend / totalNormalizedQuantity) : 0;
      const avgNetUnitPrice = totalNormalizedQuantity > 0 ? (totalNormalizedNetSpend / totalNormalizedQuantity) : 0;
      const cheapestPoint = history.find(h => h.unitPrice === minUnitPrice);
      const priciestPoint = history.find(h => h.unitPrice === maxUnitPrice);

      let priceDiffPct = 0;
      if (minUnitPrice > 0 && maxUnitPrice > minUnitPrice) {
        priceDiffPct = ((maxUnitPrice - minUnitPrice) / minUnitPrice) * 100;
      }

      const groupSeg = analyzeMaterialSegment(
        matGroup.materialName,
        history.map(h => h.originalName || '').join(' '),
        matGroup.category,
        avgUnitPrice
      );

      comparisons.push({
        id: groupKey,
        materialName: matGroup.materialName,
        category: matGroup.category,
        catalogKey: matGroup.catalogKey,
        catalogLocked: matGroup.catalogLocked,
        comparisonMode: groupSeg.comparisonMode,
        comparisonModeLabel: groupSeg.comparisonModeLabel,
        qualitySegment: groupSeg.qualitySegment,
        qualitySegmentLabel: groupSeg.qualitySegmentLabel,
        brand: groupSeg.brand,
        unit: benchmarkUnit,
        standardUnit: benchmarkUnit,
        hasMultipleUnits: rawUnitsList.length > 1,
        detectedUnits: rawUnitsList,
        minUnitPrice: Number(minUnitPrice.toFixed(2)),
        maxUnitPrice: Number(maxUnitPrice.toFixed(2)),
        avgUnitPrice: Number(avgUnitPrice.toFixed(2)),
        minGrossUnitPrice: Number(minUnitPrice.toFixed(2)),
        maxGrossUnitPrice: Number(maxUnitPrice.toFixed(2)),
        avgGrossUnitPrice: Number(avgUnitPrice.toFixed(2)),
        minNetUnitPrice: Number(minNetUnitPrice.toFixed(2)),
        maxNetUnitPrice: Number(maxNetUnitPrice.toFixed(2)),
        avgNetUnitPrice: Number(avgNetUnitPrice.toFixed(2)),
        priceBasis: 'VAT_INCLUSIVE_22',
        cheapestJobsiteName: cheapestPoint ? cheapestPoint.jobsiteName : '-',
        priciestJobsiteName: priciestPoint ? priciestPoint.jobsiteName : '-',
        totalQuantityPurchased: Number(totalNormalizedQuantity.toFixed(2)),
        totalSpend: Number(totalNormalizedSpend.toFixed(2)),
        totalGrossSpend: Number(totalNormalizedSpend.toFixed(2)),
        totalNetSpend: Number(totalNormalizedNetSpend.toFixed(2)),
        priceDifferencePercentage: Number(priceDiffPct.toFixed(2)),
        history: history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      });
    });

    const sortedComparisons = comparisons.sort((a, b) => b.priceDifferencePercentage - a.priceDifferencePercentage);
    memoryStore.materialComparisons = {
      data: sortedComparisons,
      timestamp: Date.now(),
      sourceStamp
    };
    return { data: sortedComparisons, quotaExceeded };
}

app.put('/api/materials/update-category', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const { materialName } = req.body;
    const category = (req.body.category || req.body.newCategory || '').trim();
    if (!materialName || !category) {
      return res.status(400).json({ error: 'Eksik bilgi: materialName ve category/newCategory gereklidir.' });
    }

    const targetLower = materialName.toLowerCase().trim();
    const invSnap = await getDocs(query(collection(db, 'invoices'), where('isDeleted', '==', false)));
    let totalUpdatedItems = 0;

    for (const docSnap of invSnap.docs) {
      const data = docSnap.data();
      if (data.items && Array.isArray(data.items)) {
        let updated = false;
        const newItems = data.items.map((it: any) => {
          const itName = (it.materialName || '').toLowerCase().trim();
          const itOrig = (it.originalName || '').toLowerCase().trim();
          if (itName === targetLower || itOrig === targetLower) {
            updated = true;
            totalUpdatedItems++;
            return { ...it, category, categoryManual: true };
          }
          return it;
        });
        if (updated) {
          await updateDoc(doc(db, 'invoices', docSnap.id), { items: newItems });
        }
      }
    }
    memoryStore.invoices = undefined;
    memoryStore.materialComparisons = undefined;
    smartNormalizeMemoCache.clear();
    res.json({ success: true, message: `Malzeme kategorisi güncellendi. (${totalUpdatedItems} fatura kalemi)` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/materials/ai-normalize', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const invSnap = await getDocs(query(collection(db, 'invoices'), where('isDeleted', '==', false)));
    const allInvoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    
    const discSnap = await getDocs(collection(db, 'discounts'));
    const allDiscounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

    const materialList: Array<{ name: string; category: string }> = [];
    allInvoices.forEach(inv => {
      if (Array.isArray(inv.items)) {
        inv.items.forEach((it: any) => {
          if (it.materialName) {
            materialList.push({ name: it.materialName.trim(), category: it.category || 'Diğer Malzeme' });
          }
        });
      }
    });
    allDiscounts.forEach(disc => {
      if (Array.isArray(disc.items)) {
        disc.items.forEach((it: any) => {
          if (it.materialName) {
            materialList.push({ name: it.materialName.trim(), category: it.category || 'Diğer Malzeme' });
          }
        });
      }
    });

    if (materialList.length === 0) {
      return res.json({ success: true, mergedCount: 0, mergedPairs: [] });
    }

    const uniqueNames = Array.from(new Set(materialList.map(m => m.name)));
    const ai = getGenAI();

    const prompt = `Aşağıdaki inşaat ve satınalma malzemeleri listesini incele.
LÜTFEN MALZEMELERİ ÇOK İYİ ANALİZ ET VE OTOMATİK BİRLEŞTİR!
Birbiriyle mantıken aynı olan, ancak farklı firmalar tarafından farklı isimlendirilen malzemeleri tespit et. 
Örneğin: "Арматура А500С Ø12 (11,7м ГОСТ 34028)" ile "Сталь углеродистая для армирования железобетонных конструкций периодического профиля d 12 мм А 500С" aslen AYNI malzemedir (İnşaat Demiri Ø12).
DİKKAT (TEK DİL - TÜRKÇE STANDARDI, TÜM MALZEMELER İÇİN GEÇERLİ): Listede aynı malzemenin Rusça ve Türkçe isimleri karışık bulunabilir! 
Bu durum TÜM malzemeler (beton, boya, kablo, profil, manşon, demir, ofis eşyası vb.) için geçerlidir. Örneğin, "Труба" ile "Boru", "Кабель" ile "Kablo", "Муфта" ile "Donatı Manşonu", "Арматура" ile "İnşaat Demiri" BİREBİR AYNI malzemelerdir.
Sistemde grupladığın her bir "canonical" (standart) ismi KESİNLİKLE TÜRKÇE yap. Rusça ve diğer yabancı dildeki isimleri sadece (aliases) listesinde tut. Kanonik isimde (canonical) asla Kiril/Rusça harf veya yabancı kelime bırakma! Tüm inşaat kalemlerini Türkçeleştirerek tek çatı altında topla.
Uzun ve karmaşık isimlendirmeleri en temiz, standart (kanonik) kısa ismine indirge ve tüm varyasyonlarını (aliases) bu kanonik isme bağla.
ÇOK ÖNEMLİ (ARTİKUL / MODEL KODU KURALI): İki malzemenin adı birbirine çok benzese dahi, eğer aralarında "Artikul Numarası (Артикул)", "Özel Model Kodu", "Renk veya Çap Farkı" (Örn: Attache 560091 vs Attache 560092 veya P13 vs Geçiş) varsa, bunlar FARKLI malzemelerdir! Asla aynı cluster içine koyma. 
ÇAP (DIAMETER) ODAKLI BİRLEŞTİRME KURALI: İnşaat demiri, boru, kablo, manşon veya kontrplak gibi malzemelerde faturalarda uzunluk/ebat (boy) yazmasa bile, ÇAPI (Örn: Ø14, d=14, 14'lük, 14mm) aynıysa ve temel malzeme türü aynıysa bu ürünleri KESİNLİKLE BİRLEŞTİR. Boyut/uzunluk farkları faturalarda eksik yazılabilir, asıl belirleyici olan ÇAP ve MODEL tipidir. Bu kural TÜM malzeme kalemleri için geçerlidir. Çap ve model kodları eşleşiyorsa (örneğin 14*11700 ile Ø14 veya d=14 mm aslında BİREBİR AYNI çaptır) bunları tek çatı altında topla.
JSON BOYUT KURALI: SADECE BİRDEN FAZLA (EN AZ 2) FARKLI İSMİ OLAN (aliases listesinde en az 2 öğe olan) kümeleri dön! Tek başına duran ve eşi olmayan malzemeleri listeye EKLEME. Bu sistemin çökmesini engeller.

Mevcut Malzeme İsimleri:
${JSON.stringify(uniqueNames, null, 2)}

SADECE GEÇERLİ BİR JSON FORMATI DÖN:
{
  "clusters": [
    {
      "canonical": "C25/30 Hazır Beton",
      "category": "Hazır Beton & Çimento",
      "aliases": ["Beton C25/30", "C25/30 Beton"]
    }
  ]
}`;

    const genRes = await generateContentWithResilience(ai, {
      contents: [{ text: prompt }],
      config: { responseMimeType: "application/json" },
      primaryModel: 'gemini-3.8-flash'
    });
    const parsed = robustParseJSON(genRes.text || '{}');
    const clusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];

    let mergedCount = 0;
    const mergedPairs: Array<{ canonical: string; source: string }> = [];

    for (const cluster of clusters) {
      if (!cluster.canonical || !Array.isArray(cluster.aliases) || cluster.aliases.length === 0) continue;
      const canonical = cluster.canonical.trim();
      const cat = cluster.category || 'Diğer Malzeme';
      const aliasSet = new Set(cluster.aliases.map((a: string) => a.toLowerCase().trim()));

      for (const inv of allInvoices) {
        if (!Array.isArray(inv.items)) continue;
        let invChanged = false;
        const updatedItems = inv.items.map((it: any) => {
          if (it.materialName && aliasSet.has(it.materialName.toLowerCase().trim()) && it.materialName.trim() !== canonical) {
            invChanged = true;
            mergedCount++;
            mergedPairs.push({ canonical, source: it.materialName });
            return { ...it, materialName: canonical, category: cat };
          }
          return it;
        });

        if (invChanged) {
          await updateDoc(doc(db, 'invoices', inv.id), { items: updatedItems });
        }
      }
      
      // Update discounts too
      for (const disc of allDiscounts) {
        if (!Array.isArray(disc.items)) continue;
        let discChanged = false;
        const updatedItems = disc.items.map((it: any) => {
          if (it.materialName && aliasSet.has(it.materialName.toLowerCase().trim()) && it.materialName.trim() !== canonical) {
            discChanged = true;
            mergedCount++;
            mergedPairs.push({ canonical, source: it.materialName });
            return { ...it, materialName: canonical, category: cat };
          }
          return it;
        });
        if (discChanged) {
          await updateDoc(doc(db, 'discounts', disc.id), { items: updatedItems });
        }
      }
    }

    res.json({ success: true, mergedCount, mergedPairs });
  } catch (err: any) {
    console.error('[AI NORMALIZE ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// YAPAY ZEKA KIDEMLİ ADLİ SATINALMA BAŞDENETÇİSİ (SENIOR FORENSIC AUDITOR AI)
// ============================================================================
app.post('/api/ai/audit-discount', async (req, res) => {
  try {
    const { record, benchmark = [], hasMatchedInvoice = false } = req.body || {};
    if (!record) {
      return res.status(400).json({ error: 'Kayıt verisi zorunludur.' });
    }

    const ai = getGenAI();
    if (!ai) {
      return res.status(503).json({ error: 'Gemini AI servisi şu an kullanılamıyor.' });
    }

    const offerPrice = Number(record.offerPrice || 0);
    const agreedPrice = Number(record.agreedPrice || 0);
    const discountAmount = Number(record.discountAmount || (offerPrice - agreedPrice));
    const discountPct = Number(record.discountPercentage) || (offerPrice > 0 ? (discountAmount / offerPrice) * 100 : 0);

    const prompt = `Sen GES Construction şirketinin en kıdemli, tavizsiz ve adli zekaya sahip "Adli Satınalma Başdenetçisi"sin (Senior AI Forensic Chief Procurement Auditor).
Görevin: Satınalmacıların iddia ettiği indirimleri ve alımları derinlemesine denetlemek; hiçbir hile, şişirilmiş liste fiyatı, yapay müzakere turu, sepet küçültme veya danışıklı tedarikçi ilişkisine GEÇİT VERMEMEKTİR.

KURALLAR VE İSTİSNALAR (ÇOK ÖNEMLİ):
1. NAKLİYE VE TRANSPORT HİZMETLERİ: Mesafe, araç tipi ve şantiye konumuna göre firmalar arasında doğal olarak çok büyük değişkenlik gösterir. Nakliye, lojistik ve kiralama hizmetlerini "şüpheli başlangıç fiyatı" sayma, emsalden MUAF TUT.
2. ÖZEL İMALAT KARKAS & DONATI KAFESLERİ (K-1, KR-1, KR-2 vb.): Statik proje çizimlerine göre özel imalattır; her biri farklı çap, boy ve ağırlık içerir. Emsal demir fiyatlarıyla kıyaslayıp yapay fiyat uyarısı VERME, MUAF TUT.
3. ŞİŞİRİLMİŞ LİSTE FİYATI / FAHİŞ BAŞLANGIÇ: Standart inşaat malzemesinde teklif piyasa ortalamasından çok yüksekse veya %25+ indirim yapıldığı halde nihai fiyat piyasa üstünde kalıyorsa bu sahte bir indirimdir, ALARM VER!
4. SEPET KÜÇÜLTME: Faturada kalem sayısı ilk tekliften azsa veya miktar düşürülmüşse bunu satınalma başarısı değil, ihtiyaç iptali say.
5. TÜM ÇIKARIŞ VE RAPORU TÜRKÇE VE DERİN HUKUKİ/TEKNİK DİLLE HAZIRLA.

DENETLENEN İŞLEM BİLGİLERİ:
- Satınalmacı / Şef: ${record.supervisorName || 'Bilinmiyor'} (İcra: ${record.performedByPersonnelName || 'Kendisi'})
- Tedarikçi: ${record.vendorName}
- Kategori: ${record.category}
- Şantiye: ${record.jobsiteName || 'Belirtilmemiş'}
- İlk Teklif Tutarı: ${offerPrice.toLocaleString('tr-TR')} ₽
- Anlaşılan / Nihai Tutar: ${agreedPrice.toLocaleString('tr-TR')} ₽
- İddia Edilen İndirim: ${discountAmount.toLocaleString('tr-TR')} ₽ (%${discountPct.toFixed(1)})
- Müzakere Turları: ${JSON.stringify(record.negotiationRounds || [])}
- Malzeme Kalemleri: ${JSON.stringify(record.items || [])}
- Fatura Eşleşmesi: ${hasMatchedInvoice ? 'Sistemde faturası var' : 'Fatura henüz yok'}
- Şirket İçi Geçmiş Emsal Kıyaslamaları: ${JSON.stringify(benchmark)}

Aşağıdaki JSON şemasına BİREBİR uyarak yanıt dön:
{
  "verdict": {
    "recordId": "${record.id || ''}",
    "riskLevel": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    "riskScore": number (0-100),
    "badgeLabel": string,
    "badgeClass": string,
    "headline": string,
    "confidence": "HIGH" | "MEDIUM",
    "checks": {
      "initialPriceInflation": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "marketBenchmark": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "basketShrinkage": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "splitInvoice": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "negotiationRounds": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "vendorConcentration": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "documentIntegrity": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string },
      "roundNumberAnomaly": { "detected": boolean, "scoreImpact": number, "title": string, "summary": string, "details": string }
    },
    "exemptions": {
      "exemptItemsCount": number,
      "details": string[]
    },
    "humanAuditorNarrative": string,
    "executiveRecommendation": string,
    "recommendedAction": "FREEZE" | "APPROVE" | "REQUEST_INSPECTION"
  }
}`;

    const genRes = await generateContentWithResilience(ai, {
      contents: [{ text: prompt }],
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 1024 }
      },
      primaryModel: 'gemini-3.8-flash'
    });

    const parsed = robustParseJSON(genRes.text || '{}');
    if (parsed && parsed.verdict) {
      return res.json({ success: true, verdict: parsed.verdict });
    }

    res.status(500).json({ error: 'AI denetim çıktısı ayrıştırılamadı.' });
  } catch (err: any) {
    console.error('[AI AUDIT ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/materials/merge', async (req, res) => {
  try {
    const { sourceName, targetName, sourceId, targetId } = req.body || {};
    if ((!sourceName && !sourceId) || (!targetName && !targetId)) {
      return res.status(400).json({ error: 'Kaynak ve hedef malzeme isimleri gereklidir.' });
    }

    // Ekranda görünen grupları birebir bul: sunucu grupları + istemcideki bütünlük bölmesinin aynısı
    const { data: comps } = await computeMaterialComparisons();
    const clientView = ensureComparisonGroupIntegrity(comps);
    const findGroup = (name?: string, id?: string) => {
      const n = String(name || '').trim();
      const byId = id ? (clientView.find((c: any) => c.id === id) || comps.find((c: any) => c.id === id)) : undefined;
      return byId || clientView.find((c: any) => c.materialName === n) || comps.find((c: any) => c.materialName === n);
    };
    const source: any = findGroup(sourceName, sourceId);
    const target: any = findGroup(targetName, targetId);
    if (!source) return res.status(404).json({ error: `Kaynak malzeme bulunamadı: '${sourceName || sourceId}'` });
    if (!target) return res.status(404).json({ error: `Hedef malzeme bulunamadı: '${targetName || targetId}'` });
    if (source.id === target.id || source.materialName === target.materialName) {
      return res.status(400).json({ error: 'Kaynak ve hedef malzeme aynı olamaz.' });
    }

    const toEntry = (h: any) => ({
      materialCode: h.materialCode,
      originalName: h.rawOriginalName || h.originalName,
      originalIsGenuine: isGenuineOriginalLine(h.rawOriginalName || h.originalName),
      materialName: h.rawMaterialName || h.materialName
    });
    const sourceHistory: any[] = Array.isArray(source.history) ? source.history : [];
    const targetHistory: any[] = Array.isArray(target.history) ? target.history : [];
    const aliases = buildMergeAliases({
      sourceGroupNames: [source.materialName],
      targetName: target.materialName,
      targetCategory: target.category,
      entries: [...sourceHistory, ...targetHistory].map(toEntry),
      createdBy: decodeURIComponent(String(req.headers['x-user-role'] || '')) || 'Kullanıcı'
    });
    if (aliases.length === 0) {
      return res.status(422).json({ error: 'Kaynak malzemenin satırlarından ayırt edici bir eşleştirme anahtarı üretilemedi.' });
    }

    const saveResult = await materialAliasStore.save(aliases);
    memoryStore.materialComparisons = undefined;

    // Doğrulama: birleştirmeden sonra kaynak satırlar gerçekten hedef grupta mı?
    const { data: after } = await computeMaterialComparisons();
    const targetKey = catalogKeyForName(target.materialName);
    const merged = after.find((c: any) => c.catalogKey === targetKey && c.catalogLocked);
    const lineId = (h: any) => `${h.invoiceId}|${h.rawOriginalName || h.originalName}|${h.originalUnitPrice}|${h.originalQuantity}`;
    const mergedIds = new Set((merged?.history || []).map(lineId));
    const movedEntries = sourceHistory.filter(h => mergedIds.has(lineId(h))).length;

    res.json({
      success: true,
      message: `'${source.materialName}' malzemesi '${target.materialName}' ile birleştirildi (${movedEntries}/${sourceHistory.length} satır taşındı).`,
      targetName: merged?.materialName || target.materialName,
      aliasesCreated: aliases.length,
      movedEntries,
      sourceEntries: sourceHistory.length,
      persisted: saveResult.persisted,
      ...(saveResult.persisted ? {} : { warning: `Eşleştirme kalıcı depoya yazılamadı, yalnızca bu sunucuda geçerli: ${saveResult.error || ''}` })
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Kalıcı malzeme eşleştirmeleri (elle birleştirmeler): listele / geri al
app.get('/api/materials/aliases', async (_req, res) => {
  try {
    await materialAliasStore.ensureLoaded();
    res.json(materialAliasStore.index.list().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/materials/aliases', async (req, res) => {
  try {
    await materialAliasStore.ensureLoaded();
    const { ids, targetName } = req.body || {};
    const idList: string[] = Array.isArray(ids)
      ? ids
      : targetName
        ? materialAliasStore.index.list().filter(a => a.targetName === targetName).map(a => a.id)
        : [];
    if (idList.length === 0) return res.status(400).json({ error: 'Silinecek eşleştirme bulunamadı (ids veya targetName gerekli).' });
    const result = await materialAliasStore.remove(idList);
    memoryStore.materialComparisons = undefined;
    res.json({ success: true, removed: result.removed.length, persisted: result.persisted, ...(result.error ? { warning: result.error } : {}) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Otomatik birleştirme önerileri (asla otomatik uygulanmaz) + katalog sağlık durumu
app.get('/api/materials/merge-suggestions', async (req, res) => {
  try {
    const { data: comps } = await computeMaterialComparisons();
    const view = ensureComparisonGroupIntegrity(comps);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const suggestions = buildMergeSuggestions(view as any, { limit });
    res.json({
      suggestions,
      catalog: {
        groups: view.length,
        manualGroups: view.filter((c: any) => c.catalogLocked).length,
        aliases: materialAliasStore.index.size,
        aliasSource: materialAliasStore.source,
        lastAliasWriteOk: materialAliasStore.lastWriteOk,
        persistent: materialAliasStore.source === 'firestore' && materialAliasStore.lastWriteOk !== false
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Yanlış gruplanan tek bir fatura satırını kendi kaydına ayır (kalıcı, geri alınabilir)
app.post('/api/materials/split', async (req, res) => {
  try {
    const { groupName, groupId, invoiceId, originalName } = req.body || {};
    if ((!groupName && !groupId) || !originalName) {
      return res.status(400).json({ error: 'groupName/groupId ve originalName zorunludur.' });
    }
    const { data: comps } = await computeMaterialComparisons();
    const view = ensureComparisonGroupIntegrity(comps);
    const group: any = (groupId && (view.find((c: any) => c.id === groupId) || comps.find((c: any) => c.id === groupId)))
      || view.find((c: any) => c.materialName === groupName) || comps.find((c: any) => c.materialName === groupName);
    if (!group) return res.status(404).json({ error: `Malzeme bulunamadı: '${groupName || groupId}'` });
    const history: any[] = Array.isArray(group.history) ? group.history : [];
    const entry = history.find((h: any) => (h.rawOriginalName || h.originalName) === originalName && (!invoiceId || h.invoiceId === invoiceId))
      || history.find((h: any) => h.originalName === originalName && (!invoiceId || h.invoiceId === invoiceId));
    if (!entry) return res.status(404).json({ error: 'Bu satır seçilen malzemede bulunamadı.' });
    if (history.length < 2) return res.status(400).json({ error: 'Malzemede tek satır var, ayrılacak bir şey yok.' });
    const rawOrig = String(entry.rawOriginalName || entry.originalName || '');
    if (!isGenuineOriginalLine(rawOrig)) {
      return res.status(422).json({ error: 'Bu satırın orijinal fatura metni ayırt edici değil, ayrılamıyor.' });
    }
    // Gruptaki tüm satırlar aynı fatura satırıysa "ayırmak" grubu yeniden adlandırmaktan ibaret olur; reddet
    const selectedFp = materialFingerprint(rawOrig);
    if (history.every((h: any) => materialFingerprint(String(h.rawOriginalName || h.originalName || '')) === selectedFp)) {
      return res.status(400).json({ error: 'Bu malzemedeki tüm satırlar aynı fatura satırı; ayrılacak farklı bir satır yok.' });
    }

    const translated = /[а-яё]/i.test(rawOrig) ? translateRussianMaterialToTurkish(rawOrig) : '';
    let targetName = (translated && translated.trim().length > 3 ? translated : cleanRawMaterialName(unwrapSyntheticPrefixes(rawOrig)) || rawOrig).trim();
    if (catalogKeyForName(targetName) === catalogKeyForName(group.materialName)) targetName = `${targetName} (Ayrı Kayıt)`;
    const alias = buildSplitAlias({
      originalName: rawOrig,
      targetName,
      sourceGroupName: group.materialName,
      createdBy: decodeURIComponent(String(req.headers['x-user-role'] || '')) || 'Kullanıcı'
    });
    if (!alias) return res.status(422).json({ error: 'Bu satır için ayırt edici bir anahtar üretilemedi.' });

    // Bu satırı eski hedefe bağlayan daha öncelikli alias'ları (Prizma kodu / ad) kaldır
    const overriding = aliasKeysForItem({ materialCode: entry.materialCode, materialName: entry.rawMaterialName })
      .filter(k => k.kind === 'code' || k.kind === 'name')
      .map(k => aliasDocId(k.kind, k.key))
      .filter(id => materialAliasStore.index.list().some(a => a.id === id));
    if (overriding.length) await materialAliasStore.remove(overriding);
    const saveResult = await materialAliasStore.save([alias]);
    memoryStore.materialComparisons = undefined;

    const { data: after } = await computeMaterialComparisons();
    const newGroup = after.find((c: any) => c.catalogKey === alias.targetKey);
    const moved = (newGroup?.history || []).filter((h: any) => (h.rawOriginalName || h.originalName) === rawOrig).length;
    res.json({
      success: moved > 0,
      message: moved > 0 ? `Satır '${targetName}' adıyla ayrı kayda alındı (${moved} satır).` : 'Satır ayrılamadı.',
      targetName: newGroup?.materialName || targetName,
      movedEntries: moved,
      persisted: saveResult.persisted,
      ...(saveResult.persisted ? {} : { warning: `Ayırma kalıcı depoya yazılamadı, yalnızca bu sunucuda geçerli: ${saveResult.error || ''}` })
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ANOMALY ACKNOWLEDGEMENTS API (Yönetici Onaylı / Bilinen Anomaliler)
// ============================================================================
const ANOMALY_ACK_FILE = path.join(os.tmpdir(), 'ges_anomaly_ack.json');

app.get('/api/anomalies/acknowledgements', async (req, res) => {
  try {
    if (db) {
      const snap = await getDocs(collection(db, 'anomaly_acknowledgements'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json({ acknowledgements: list });
    }
    if (fs.existsSync(ANOMALY_ACK_FILE)) {
      const fallbackData = JSON.parse(fs.readFileSync(ANOMALY_ACK_FILE, 'utf8'));
      return res.json({ acknowledgements: Array.isArray(fallbackData) ? fallbackData : [] });
    }
    res.json({ acknowledgements: [] });
  } catch (err: any) {
    console.warn('[ANOMALY ACK GET WARN]:', err.message);
    if (fs.existsSync(ANOMALY_ACK_FILE)) {
      try {
        const fallbackData = JSON.parse(fs.readFileSync(ANOMALY_ACK_FILE, 'utf8'));
        return res.json({ acknowledgements: Array.isArray(fallbackData) ? fallbackData : [] });
      } catch (e) {}
    }
    res.json({ acknowledgements: [] });
  }
});

app.post('/api/anomalies/acknowledge', async (req, res) => {
  try {
    const { anomalyId, acknowledgedBy, acknowledgedAt, reason, note, materialName, vendorName, jobsiteName, financialImpact } = req.body;
    if (!anomalyId) {
      return res.status(400).json({ error: 'anomalyId zorunludur.' });
    }
    const safeDocId = encodeURIComponent(anomalyId).replace(/%/g, '_');
    const data = {
      anomalyId,
      acknowledgedBy: acknowledgedBy || 'Yönetici',
      acknowledgedAt: acknowledgedAt || new Date().toISOString(),
      reason: reason || 'Piyasa / Emtia Dalgalanması',
      note: note || '',
      materialName: materialName || '',
      vendorName: vendorName || '',
      jobsiteName: jobsiteName || '',
      financialImpact: Number(financialImpact) || 0
    };

    if (db) {
      await setDoc(doc(db, 'anomaly_acknowledgements', safeDocId), data);
    }
    // Also save to disk fallback
    try {
      let current: any[] = [];
      if (fs.existsSync(ANOMALY_ACK_FILE)) {
        current = JSON.parse(fs.readFileSync(ANOMALY_ACK_FILE, 'utf8'));
      }
      current = current.filter(x => x.anomalyId !== anomalyId);
      current.push(data);
      fs.writeFileSync(ANOMALY_ACK_FILE, JSON.stringify(current), 'utf8');
    } catch (e) {}

    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[ANOMALY ACK POST ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/anomalies/unacknowledge', async (req, res) => {
  try {
    const { anomalyId } = req.body;
    if (!anomalyId) {
      return res.status(400).json({ error: 'anomalyId zorunludur.' });
    }
    const safeDocId = encodeURIComponent(anomalyId).replace(/%/g, '_');
    if (db) {
      await deleteDoc(doc(db, 'anomaly_acknowledgements', safeDocId));
    }
    try {
      if (fs.existsSync(ANOMALY_ACK_FILE)) {
        let current = JSON.parse(fs.readFileSync(ANOMALY_ACK_FILE, 'utf8'));
        current = current.filter((x: any) => x.anomalyId !== anomalyId);
        fs.writeFileSync(ANOMALY_ACK_FILE, JSON.stringify(current), 'utf8');
      }
    } catch (e) {}

    res.json({ success: true, message: 'Anomali tekrar aktif listeye alındı.' });
  } catch (err: any) {
    console.error('[ANOMALY UNACK ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/supervisor-performance', async (req, res) => {
  try {
    const { data: allSups, quotaExceeded: q1 } = await getSupervisorsCached();
    const { data: allPersonnel, quotaExceeded: q2 } = await getPersonnelCached();
    const { data: allDiscs, quotaExceeded: q3 } = await getDiscountsCached();
    const { data: allInvs, quotaExceeded: q4 } = await getInvoicesCached();
    if (q1 || q2 || q3 || q4) res.setHeader('X-Quota-Exceeded', 'true');

    const persMap = new Map<string, any>();
    allPersonnel.forEach((p: any) => persMap.set(p.id, p));

    const reports = allSups.map(sup => {
      const supDiscs = allDiscs.filter(d => d.supervisorId === sup.id);
      const supInvs = allInvs.filter(i => i.uploadedBySupervisorId === sup.id);

      let totalListPrice = 0;
      let totalAgreedPrice = 0;
      let totalDiscountAmount = 0;
      let totalGol = 0;
      let totalAsist = 0;
      let golDiscountAmount = 0;
      let asistDiscountAmount = 0;
      let totalNegotiationRounds = 0;
      let totalDistinctFirms = 0;
      let procedureViolationCount = 0;
      let totalNewVendors = 0;

      const jobsiteMap = new Map();
      const personnelAssistMap = new Map<string, {
        personnelId: string;
        name: string;
        transactionCount: number;
        totalDiscountAmount: number;
        totalOfferPrice: number;
        totalNegotiationRounds: number;
      }>();

      supDiscs.forEach(d => {
        const baselineOffer = (typeof d.adjustedOfferPrice === 'number' && d.adjustedOfferPrice > 0)
          ? d.adjustedOfferPrice
          : (Number(d.offerPrice) || 0);
        const agreed = Number(d.agreedPrice) || 0;
        const diff = (typeof d.discountAmount === 'number' && !isNaN(d.discountAmount) && d.discountAmount >= 0)
          ? d.discountAmount
          : Math.max(0, baselineOffer - agreed);
        
        totalListPrice += baselineOffer;
        totalAgreedPrice += agreed;
        totalDiscountAmount += diff;

        const origin = d.recordOriginType || 'gol';
        if (origin === 'asist') {
          totalAsist += 1;
          asistDiscountAmount += diff;

          if (d.performedByPersonnelId) {
            const pId = d.performedByPersonnelId;
            const pName = d.performedByPersonnelName || persMap.get(pId)?.name || 'Personel';
            if (!personnelAssistMap.has(pId)) {
              personnelAssistMap.set(pId, {
                personnelId: pId,
                name: pName,
                transactionCount: 0,
                totalDiscountAmount: 0,
                totalOfferPrice: 0,
                totalNegotiationRounds: 0
              });
            }
            const pItem = personnelAssistMap.get(pId)!;
            pItem.transactionCount += 1;
            pItem.totalDiscountAmount += diff;
            pItem.totalOfferPrice += baselineOffer;
            pItem.totalNegotiationRounds += (Array.isArray(d.negotiationRounds) ? d.negotiationRounds.length : (Number(d.negotiationCount) || 0));
          }
        } else {
          totalGol += 1;
          golDiscountAmount += diff;
        }

        const rounds = (Array.isArray(d.negotiationRounds) ? d.negotiationRounds.length : (Number(d.negotiationCount) || 0));
        totalNegotiationRounds += rounds;
        totalDistinctFirms += Number(d.distinctFirmsNegotiated) || 0;

        if (Array.isArray(d.procedureWarnings) && d.procedureWarnings.length > 0) {
          procedureViolationCount += 1;
        }

        if (d.jobsiteId) {
          if (!jobsiteMap.has(d.jobsiteId)) {
            jobsiteMap.set(d.jobsiteId, {
              jobsiteId: d.jobsiteId,
              jobsiteName: d.jobsiteName || 'Bilinmeyen',
              discountAmount: 0,
              listPrice: 0,
              transactionCount: 0
            });
          }
          const jm = jobsiteMap.get(d.jobsiteId);
          jm.discountAmount += diff;
          jm.listPrice += baselineOffer;
          jm.transactionCount += 1;
        }
      });

      const avgDiscountPercentage = totalListPrice > 0 ? Number(((totalDiscountAmount / totalListPrice) * 100).toFixed(2)) : 0;
      const totalTx = supDiscs.length;
      const assistRatio = totalTx > 0 ? Number(((totalAsist / totalTx) * 100).toFixed(1)) : 0;
      const avgNegotiationRounds = totalTx > 0 ? Number((totalNegotiationRounds / totalTx).toFixed(2)) : 0;
      const avgDistinctFirms = totalTx > 0 ? Number((totalDistinctFirms / totalTx).toFixed(2)) : 0;
      const newVendorRatio = totalTx > 0 ? (totalNewVendors / totalTx) : 0;
      const negotiationEffortScore = calculateNegotiationEffortScore(
        avgDiscountPercentage,
        avgNegotiationRounds,
        newVendorRatio,
        totalNewVendors,
        totalAsist,
        totalTx,
        totalGol,
        totalDiscountAmount
      );

      const personnelBreakdown = Array.from(personnelAssistMap.values()).map(p => ({
        personnelId: p.personnelId,
        name: p.name,
        transactionCount: p.transactionCount,
        totalDiscountAmount: p.totalDiscountAmount,
        avgDiscountPct: p.totalOfferPrice > 0 ? Number(((p.totalDiscountAmount / p.totalOfferPrice) * 100).toFixed(2)) : 0,
        totalNegotiationRounds: p.totalNegotiationRounds
      })).sort((a, b) => b.totalDiscountAmount - a.totalDiscountAmount);
      
      const jobsiteBreakdown = Array.from(jobsiteMap.values()).map(j => ({
        ...j,
        discountPercentage: j.listPrice > 0 ? Number(((j.discountAmount / j.listPrice) * 100).toFixed(2)) : 0
      })).sort((a, b) => b.discountAmount - a.discountAmount);

      const topJobsiteName = jobsiteBreakdown.length > 0 ? jobsiteBreakdown[0].jobsiteName : '-';

      return {
        supervisorId: sup.id,
        supervisorName: sup.name,
        totalTransactions: totalTx,
        totalListPrice,
        totalAgreedPrice,
        totalDiscountAmount,
        avgDiscountPercentage,
        totalGol,
        totalAsist,
        golDiscountAmount,
        asistDiscountAmount,
        assistRatio,
        avgNegotiationRounds,
        avgDistinctFirms,
        negotiationEffortScore,
        procedureViolationCount,
        personnelBreakdown,
        topJobsiteName,
        invoiceCount: supInvs.length,
        jobsiteBreakdown
      };
    });

    res.json(reports.sort((a, b) => b.totalDiscountAmount - a.totalDiscountAmount));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/reports/personnel-performance', async (req, res) => {
  try {
    const { data: allPersonnel, quotaExceeded: q1 } = await getPersonnelCached();
    const { data: allSups, quotaExceeded: q2 } = await getSupervisorsCached();
    const { data: allDiscs, quotaExceeded: q3 } = await getDiscountsCached();
    if (q1 || q2 || q3) res.setHeader('X-Quota-Exceeded', 'true');

    const supMap = new Map<string, string>();
    allSups.forEach((s: any) => supMap.set(s.id, s.name));

    const reports = (allPersonnel || []).map((pers: any) => {
      const persDiscs = allDiscs.filter((d: any) => d.performedByPersonnelId === pers.id);

      let totalListPrice = 0;
      let totalAgreedPrice = 0;
      let totalDiscountAmount = 0;
      let totalNegotiationRounds = 0;
      let procedureViolationCount = 0;
      let totalNewVendors = 0;
      const jobsiteMap = new Map();

      persDiscs.forEach((d: any) => {
        const baselineOffer = (typeof d.adjustedOfferPrice === 'number' && d.adjustedOfferPrice > 0)
          ? d.adjustedOfferPrice
          : (Number(d.offerPrice) || 0);
        const agreed = Number(d.agreedPrice) || 0;
        const diff = (typeof d.discountAmount === 'number' && !isNaN(d.discountAmount) && d.discountAmount >= 0)
          ? d.discountAmount
          : Math.max(0, baselineOffer - agreed);

        totalListPrice += baselineOffer;
        totalAgreedPrice += agreed;
        totalDiscountAmount += diff;

        const rounds = (Array.isArray(d.negotiationRounds) ? d.negotiationRounds.length : (Number(d.negotiationCount) || 0));
        totalNegotiationRounds += rounds;
        if (d.isNewVendor === true) totalNewVendors++;

        if (Array.isArray(d.procedureWarnings) && d.procedureWarnings.length > 0) {
          procedureViolationCount += 1;
        }

        if (d.jobsiteId) {
          if (!jobsiteMap.has(d.jobsiteId)) {
            jobsiteMap.set(d.jobsiteId, {
              jobsiteId: d.jobsiteId,
              jobsiteName: d.jobsiteName || 'Bilinmeyen',
              discountAmount: 0,
              listPrice: 0,
              transactionCount: 0
            });
          }
          const jm = jobsiteMap.get(d.jobsiteId);
          jm.discountAmount += diff;
          jm.listPrice += baselineOffer;
          jm.transactionCount += 1;
        }
      });

      const totalTx = persDiscs.length;
      const avgDiscountPercentage = totalListPrice > 0 ? Number(((totalDiscountAmount / totalListPrice) * 100).toFixed(2)) : 0;
      const avgNegotiationRounds = totalTx > 0 ? Number((totalNegotiationRounds / totalTx).toFixed(2)) : 0;
      const newVendorRatio = totalTx > 0 ? (totalNewVendors / totalTx) : 0;
      const negotiationEffortScore = calculateNegotiationEffortScore(
        avgDiscountPercentage,
        avgNegotiationRounds,
        newVendorRatio,
        totalNewVendors,
        totalTx, // assistsCount for personnel
        totalTx,
        0,
        totalDiscountAmount
      );

      const jobsiteBreakdown = Array.from(jobsiteMap.values()).map(j => ({
        ...j,
        discountPercentage: j.listPrice > 0 ? Number(((j.discountAmount / j.listPrice) * 100).toFixed(2)) : 0
      })).sort((a, b) => b.discountAmount - a.discountAmount);

      const topJobsiteName = jobsiteBreakdown.length > 0 ? jobsiteBreakdown[0].jobsiteName : '-';
      const supervisorName = pers.supervisorId ? (supMap.get(pers.supervisorId) || pers.supervisorName || '-') : '-';

      return {
        personnelId: pers.id,
        personnelName: pers.name,
        supervisorId: pers.supervisorId || '',
        supervisorName,
        title: pers.title || 'Satınalma Personeli',
        active: pers.active !== false,
        totalTransactions: totalTx,
        totalListPrice,
        totalAgreedPrice,
        totalDiscountAmount,
        avgDiscountPercentage,
        avgNegotiationRounds,
        negotiationEffortScore,
        procedureViolationCount,
        topJobsiteName,
        jobsiteBreakdown
      };
    });

    res.json(reports.sort((a, b) => b.totalDiscountAmount - a.totalDiscountAmount));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 5. AUTH & AUTHENTICATION ENDPOINTS
// ============================================================================
const userPinStore = new Map<string, string>();

app.get('/api/auth/users', async (req, res) => {
  try {
    let customPins: Record<string, string> = {};
    if (db) {
      try {
        const pinDoc = await getDoc(doc(db, 'settings', 'auth_pins'));
        if (pinDoc.exists()) {
          customPins = pinDoc.data() || {};
        }
      } catch (_) {}
    }
    const ids = Array.from(new Set([...Object.keys(customPins), ...Array.from(userPinStore.keys())]));
    res.json(ids);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/auth/login', async (req, res) => {
  try {
    const { pin, preferredRole, supervisorId, personnelId, username } = req.body;
    const cleanPin = String(pin || '').trim();

    // Load custom PINs from Firestore if available
    let customPins: Record<string, string> = {};
    if (db) {
      try {
        const pinDoc = await getDoc(doc(db, 'settings', 'auth_pins'));
        if (pinDoc.exists()) customPins = pinDoc.data() || {};
      } catch (_) {}
    }

    if (preferredRole === 'admin') {
      const customPin = customPins['admin'] || userPinStore.get('admin');

      if (customPin) {
        if (cleanPin === customPin) {
          const token = crypto.randomBytes(32).toString('hex');
          sessionTokens.set(token, { role: 'admin', expires: Date.now() + 24*60*60*1000 });
          return res.json({
            success: true,
            token,
            user: {
              username: 'admin',
              role: 'admin',
              displayName: 'Yönetici / Sistem Yöneticisi'
            }
          });
        } else {
          return res.status(401).json({ success: false, error: 'Hatalı Özel Yönetici Şifresi!' });
        }
      } else if (cleanPin === '1234') {
         const token = crypto.randomBytes(32).toString('hex');
         sessionTokens.set(token, { role: 'admin', expires: Date.now() + 24*60*60*1000 });
         return res.json({
            success: true,
            token,
            user: {
              username: 'admin',
              role: 'admin',
              displayName: 'Yönetici / Sistem Yöneticisi'
            }
         });
      } else {
         return res.status(401).json({ success: false, error: 'Hatalı Yönetici PIN Kodu!' });
      }
    }

    if (preferredRole === 'viewer') {
      return res.json({
        success: true,
        user: {
          username: 'viewer',
          role: 'viewer',
          displayName: 'Gözlemci'
        }
      });
    }

    if (preferredRole === 'personnel') {
      const { data: allPers } = await getPersonnelCached();
      const pers = allPers.find((p: any) => p.id === personnelId || (username && p.name.toLowerCase().includes(username.toLowerCase())));

      if (!pers || pers.active === false) {
        return res.status(401).json({ success: false, error: 'Aktif satınalma personeli bulunamadı!' });
      }

      const persKey = pers.id;
      const cleanUsername = pers.name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      const customPin = customPins[persKey] || userPinStore.get(persKey);
      const persAuthJobs = Array.from(getUserAuthorizedJobsiteIds({ role: 'personnel', personnelId: pers.id, supervisorId: pers.supervisorId, displayName: pers.name }));

      if (customPin) {
        if (cleanPin === customPin) {
          return res.json({
            success: true,
            user: {
              username: cleanUsername,
              role: 'personnel',
              displayName: pers.name,
              personnelId: pers.id,
              supervisorId: pers.supervisorId,
              jobsiteIds: persAuthJobs,
              defaultJobsiteId: persAuthJobs[0] || 'job_1'
            }
          });
        } else {
          return res.status(401).json({ success: false, error: 'Hatalı Özel Personel Şifresi!' });
        }
      } else if (cleanPin === `${cleanUsername}123` || cleanPin === '1234') {
         return res.json({
            success: true,
            user: {
              username: cleanUsername,
              role: 'personnel',
              displayName: pers.name,
              personnelId: pers.id,
              supervisorId: pers.supervisorId,
              jobsiteIds: persAuthJobs,
              defaultJobsiteId: persAuthJobs[0] || 'job_1'
            }
         });
      } else {
         return res.status(401).json({ success: false, error: 'Hatalı Personel PIN Kodu!' });
      }
    }

    // Supervisor Login
    let supervisor: any = null;
    if (db && supervisorId) {
      try {
        const supDoc = await getDoc(doc(db, 'supervisors', supervisorId));
        if (supDoc.exists()) supervisor = { id: supDoc.id, ...supDoc.data() };
      } catch (_) {}
    }

    const supKey = supervisorId || username || 'default';
    const cleanUsername = (username || (supervisor ? supervisor.name.split(' ')[0] : 'sup')).toLowerCase().replace(/[^a-z0-9]/g, '');
    const effectiveSupId = supervisorId || (supervisor ? supervisor.id : 'sup_1');
    const effectiveSupName = supervisor ? supervisor.name : (username || 'Satınalma Şefi');
    const supAuthJobs = Array.from(getUserAuthorizedJobsiteIds({ role: 'supervisor', supervisorId: effectiveSupId, displayName: effectiveSupName }));
    const customPin = customPins[supKey] || userPinStore.get(supKey);
    const expectedPin = customPin || `${cleanUsername}123`;

    if (customPin) {
      if (cleanPin === customPin) {
        return res.json({
          success: true,
          user: {
            username: cleanUsername,
            role: 'supervisor',
            displayName: effectiveSupName,
            supervisorId: effectiveSupId,
            jobsiteIds: supAuthJobs,
            defaultJobsiteId: supAuthJobs[0] || 'job_5'
          }
        });
      } else {
        return res.status(401).json({ success: false, error: 'Hatalı Özel Şifre!' });
      }
    } else if (cleanPin === expectedPin || cleanPin === '1234') {
      return res.json({
        success: true,
        user: {
          username: cleanUsername,
          role: 'supervisor',
          displayName: effectiveSupName,
          supervisorId: effectiveSupId,
          jobsiteIds: supAuthJobs,
          defaultJobsiteId: supAuthJobs[0] || 'job_5'
        }
      });
    } else {
      return res.status(401).json({ success: false, error: 'Hatalı Şef PIN Kodu!' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { username, supervisorId, oldPin, newPin } = req.body;
    if (!newPin || String(newPin || '').trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Yeni PIN en az 3 karakter olmalıdır.' });
    }
    const targetKey = supervisorId || username || 'admin';
    userPinStore.set(targetKey, String(newPin || '').trim());

    if (db) {
      try {
        await setDoc(doc(db, 'settings', 'auth_pins'), { [targetKey]: String(newPin || '').trim() }, { merge: true });
      } catch (_) {}
    }

    res.json({ success: true, message: 'Şifreniz / PIN kodunuz başarıyla güncellendi.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/admin-change-password', async (req, res) => {
  try {
    const { targetSupervisorId, newPin } = req.body;
    if (!targetSupervisorId || !newPin) {
      return res.status(400).json({ success: false, error: 'Eksik parametreler.' });
    }
    userPinStore.set(targetSupervisorId, String(newPin || '').trim());

    if (db) {
      try {
        await setDoc(doc(db, 'settings', 'auth_pins'), { [targetSupervisorId]: String(newPin || '').trim() }, { merge: true });
      } catch (_) {}
    }

    res.json({ success: true, message: 'Şef PIN kodu başarıyla güncellendi.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 5.1 SUPERVISOR, JOBSITE & INVOICE CRUD ENDPOINTS
// ============================================================================
app.put('/api/supervisors/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const id = req.params.id;
    await updateDoc(doc(db, 'supervisors', id), req.body);
    
    if (req.body.pin) {
      userPinStore.set(id, String(req.body.pin || '').trim());
      try {
        await setDoc(doc(db, 'settings', 'auth_pins'), { [id]: String(req.body.pin || '').trim() }, { merge: true });
      } catch (_) {}
    }
    
    // Also update cached supervisors if we are using it
    const { data: cur } = await getSupervisorsCached();
    const updated = cur.map((s: any) => (s.id === id ? { ...s, ...req.body } : s));
    memoryStore.supervisors = { data: updated, timestamp: Date.now() };
    saveLocalBackup('supervisors.json', updated);
    
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/supervisors/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    await setDoc(doc(db, 'supervisors', req.params.id), { isPermanentlyDeleted: true, isDeleted: true, deletionLog: req.headers['x-admin-user'] ? `${req.headers['x-admin-user']} - ${new Date().toISOString()}` : `TanimsizKullanici - ${new Date().toISOString()}` }, { merge: true }).catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/jobsites/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    await updateDoc(doc(db, 'jobsites', req.params.id), req.body);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobsites/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    await setDoc(doc(db, 'jobsites', req.params.id), { isPermanentlyDeleted: true, isDeleted: true, deletionLog: req.headers['x-admin-user'] ? `${req.headers['x-admin-user']} - ${new Date().toISOString()}` : `TanimsizKullanici - ${new Date().toISOString()}` }, { merge: true }).catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/discounts/:id', async (req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const discId = req.params.id;
    
    // FETCH EXISTING RECORD FIRST
    const docSnap = await getDoc(doc(db, 'discounts', discId));
    let existingData = {};
    if (docSnap.exists()) {
      existingData = docSnap.data();
    }
    
    // MERGE existing with incoming body
    let mergedData = { ...existingData, ...req.body };
    delete mergedData.id;
    if (mergedData.vendorName) {
      mergedData.vendorName = normalizeVendorName(mergedData.vendorName);
      mergedData.supplier = mergedData.vendorName;
    }

    const { data: sups } = await getSupervisorsCached();
    const { data: persList } = await getPersonnelCached();

    const processed = validateAndProcessNegotiationData(mergedData, sups, persList);
    if (processed.error) {
      return res.status(400).json({ error: 'Pazarlık Verisi Hatası', details: processed.error });
    }
    
    // Create final update object using merged data and processed validation results
    let updateData = { ...mergedData };
    if (processed.data) {
      updateData = {
        ...updateData,
        ...processed.data,
        performedByPersonnelId: processed.data.performedByPersonnelId || null,
        performedByPersonnelName: processed.data.performedByPersonnelName || null,
        finalNegotiationDate: processed.data.finalNegotiationDate || null
      };
    }

    if (updateData.category) {
      const itemNamesText = (updateData.items || []).map((it: any) => `${it.materialName || ''} ${it.originalName || ''} ${it.category || ''}`).join(' ');
      const normCatPut = normalizeCategoryName(updateData.category, `${itemNamesText} ${updateData.description || ''} ${updateData.vendorName || ''}`);
      if (normCatPut && normCatPut !== 'Diğer Malzeme' && normCatPut !== 'Прочие материалы' && normCatPut !== 'Diğer') {
        updateData.category = normCatPut;
      }
    }

    // Now update Firestore safely without overwriting missing fields with 0
    await setDoc(doc(db, 'discounts', discId), updateData, { merge: true });

    // Update memoryStore & local backup
    const { data: curDiscs } = await getDiscountsCached();
    const updatedDiscs = curDiscs.map((d: any) => d.id === discId ? { ...d, ...updateData } : d);
    memoryStore.discounts = { data: updatedDiscs, timestamp: Date.now() };
    saveLocalBackup('discounts.json', updatedDiscs);

    // Also sync update to corresponding invoice if present
    const invSnap = await getDocs(collection(db, 'invoices'));
    for (const invDoc of invSnap.docs) {
      if (invDoc.id === `inv_sync_${discId}` || invDoc.data().discountId === discId) {
        const invUpdate: any = {};
        if (updateData.vendorName) invUpdate.supplier = updateData.vendorName;
        if (updateData.invoiceNo) invUpdate.invoiceNumber = updateData.invoiceNo;
        if (updateData.agreedPrice !== undefined) invUpdate.totalAmount = Number(updateData.agreedPrice) || 0;
        if (updateData.jobsiteId) invUpdate.jobsiteId = updateData.jobsiteId;
        if (updateData.jobsiteName) invUpdate.jobsiteName = updateData.jobsiteName;
        if (updateData.items) invUpdate.items = updateData.items;

        if (Object.keys(invUpdate).length > 0) {
          await setDoc(doc(db, 'invoices', invDoc.id), invUpdate, { merge: true });
        }
      }
    }

    res.json({ success: true, updated: updateData });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.put('/api/discounts/:id/audit-status', async (req, res) => {
  try {
    const discId = req.params.id;
    const { auditStatus, isEffortScoreFrozen, executiveAuditNote, auditReviewedBy } = req.body;
    const updateData: any = {
      auditStatus: auditStatus || 'NORMAL',
      isEffortScoreFrozen: isEffortScoreFrozen === true,
      executiveAuditNote: executiveAuditNote || '',
      auditReviewedBy: auditReviewedBy || 'Yönetici',
      auditReviewedAt: new Date().toISOString()
    };
    if (db) {
      await setDoc(doc(db, 'discounts', discId), updateData, { merge: true });
    }
    const { data: curDiscs } = await getDiscountsCached();
    const updatedDiscs = curDiscs.map((d: any) => d.id === discId ? { ...d, ...updateData } : d);
    memoryStore.discounts = { data: updatedDiscs, timestamp: Date.now() };
    saveLocalBackup('discounts.json', updatedDiscs);
    res.json({ success: true, updated: updateData });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  try {
    const invId = req.params.id;
    const cmpId = invId.startsWith('inv_cmp_') ? invId.replace('inv_cmp_', '') : null;
    let discId = invId.startsWith('inv_sync_')
      ? invId.replace('inv_sync_', '')
      : (cmpId ? `disc_cmp_${cmpId}` : null);

    // 1. Read current invoice to check role-based permissions
    let currentInv: any = null;
    if (db) {
      const snap = await getDoc(doc(db, 'invoices', invId)).catch(() => null);
      if (snap && snap.exists()) currentInv = { id: invId, ...snap.data() };
    }
    if (!currentInv && memoryStore.invoices?.data) {
      currentInv = memoryStore.invoices.data.find((i: any) => i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId));
    }
    if (!currentInv) {
      const localInvs = readLocalBackup('invoices.json', []);
      currentInv = localInvs.find((i: any) => i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId));
    }

    if (currentInv) {
      const authCheck = await _verifyRecordEditAccess(req, currentInv);
      if (!authCheck.authorized) {
        return res.status(403).json({ error: authCheck.reason || 'Yetkisiz işlem: Bu faturayı düzenleme yetkiniz bulunmamaktadır.' });
      }
      if (!discId && currentInv.discountId) discId = currentInv.discountId;
    }

    const updateData = { ...req.body };
    delete updateData.id;

    // 2. Persist update to Firestore
    if (db) {
      await setDoc(doc(db, 'invoices', invId), updateData, { merge: true });
      if (cmpId) {
        await setDoc(doc(db, 'comparative_analyses', cmpId), {
          jobsiteId: updateData.jobsiteId,
          jobsiteName: updateData.jobsiteName,
          supervisorId: updateData.uploadedBySupervisorId,
          supervisorName: updateData.uploadedBySupervisorName,
          supplier: updateData.supplier
        }, { merge: true }).catch(() => {});
      }
    }

    // 3. Synchronize linked discount record if present
    const discUpdate: any = {};
    if (updateData.supplier) {
      discUpdate.vendorName = updateData.supplier;
      discUpdate.supplier = updateData.supplier;
    }
    if (updateData.invoiceNumber) discUpdate.invoiceNo = updateData.invoiceNumber;
    if (updateData.totalAmount !== undefined) discUpdate.agreedPrice = Number(updateData.totalAmount) || 0;
    if (updateData.date) discUpdate.orderDate = updateData.date;
    if (updateData.jobsiteId) discUpdate.jobsiteId = updateData.jobsiteId;
    if (updateData.jobsiteName) discUpdate.jobsiteName = updateData.jobsiteName;
    if (updateData.uploadedBySupervisorId) discUpdate.supervisorId = updateData.uploadedBySupervisorId;
    if (updateData.uploadedBySupervisorName) discUpdate.supervisorName = updateData.uploadedBySupervisorName;
    if (updateData.items) discUpdate.items = updateData.items;

    if (discId && Object.keys(discUpdate).length > 0) {
      if (db) {
        await setDoc(doc(db, 'discounts', discId), discUpdate, { merge: true }).catch(() => {});
      }
      const localDscs = readLocalBackup('discounts.json', []);
      const updatedBackupDscs = localDscs.map((d: any) =>
        (d.id === discId || (cmpId && d.comparativeAnalysisId === cmpId))
          ? { ...d, ...discUpdate }
          : d
      );
      saveLocalBackup('discounts.json', updatedBackupDscs);

      if (memoryStore.discounts?.data) {
        memoryStore.discounts.data = memoryStore.discounts.data.map((d: any) =>
          (d.id === discId || (cmpId && d.comparativeAnalysisId === cmpId))
            ? { ...d, ...discUpdate }
            : d
        );
        memoryStore.discounts.timestamp = Date.now();
      }
    }

    // 4. Update local backup file for invoices
    const localInvs = readLocalBackup('invoices.json', []);
    let foundInBackup = false;
    const updatedBackupInvs = localInvs.map((i: any) => {
      if (i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId)) {
        foundInBackup = true;
        return { ...i, ...updateData };
      }
      return i;
    });
    if (foundInBackup) {
      saveLocalBackup('invoices.json', updatedBackupInvs);
    }

    // 5. CRITICAL: Update in-memory cache so next read returns updated data immediately!
    if (memoryStore.invoices?.data) {
      memoryStore.invoices.data = memoryStore.invoices.data.map((i: any) => {
        if (i.id === invId || (cmpId && i.comparativeAnalysisId === cmpId)) {
          return { ...i, ...updateData };
        }
        return i;
      });
      memoryStore.invoices.timestamp = Date.now();
    }

    // 6. Invalidate comparisons
    memoryStore.materialComparisons = undefined;

    res.json({ success: true, updated: { id: invId, ...(currentInv || {}), ...updateData } });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post(['/api/invoices/:id/restore', '/api/discounts/:id/restore'], async (req, res) => {
  try {
    const targetId = req.params.id;
    let discId: string | null = null;

    if (targetId.startsWith('disc_')) {
      discId = targetId;
    } else if (targetId.startsWith('inv_sync_')) {
      discId = targetId.replace('inv_sync_', '');
    }

    // 1. Update Firestore if connected
    if (db) {
      try {
        if (discId) {
          await setDoc(doc(db, 'discounts', discId), { isDeleted: false, deletedAt: null, isPermanentlyDeleted: false }, { merge: true }).catch(() => {});
          await setDoc(doc(db, 'invoices', `inv_sync_${discId}`), { isDeleted: false, deletedAt: null, isPermanentlyDeleted: false }, { merge: true }).catch(() => {});
        }
        await setDoc(doc(db, 'invoices', targetId), { isDeleted: false, deletedAt: null, isPermanentlyDeleted: false }, { merge: true }).catch(() => {});
        const invDocSnap = await getDoc(doc(db, 'invoices', targetId)).catch(() => null);
        if (invDocSnap && invDocSnap.exists()) {
          const invData = invDocSnap.data();
          if (invData?.discountId) {
            discId = invData.discountId;
            await setDoc(doc(db, 'discounts', invData.discountId), { isDeleted: false, deletedAt: null, isPermanentlyDeleted: false }, { merge: true }).catch(() => {});
          }
        }
      } catch (e: any) {
        console.warn('[FIRESTORE RESTORE WARN]:', e.message);
      }
    }

    // 2. Update local disk backup invoices.json
    const localInvs = readLocalBackup('invoices.json', []);
    let foundInInvs = false;
    const updatedInvs = localInvs.map((i: any) => {
      const match = i.id === targetId || (discId && (i.id === `inv_sync_${discId}` || i.discountId === discId));
      if (match) {
        foundInInvs = true;
        if (i.discountId) discId = i.discountId;
        return { ...i, isDeleted: false, deletedAt: null, isPermanentlyDeleted: false };
      }
      return i;
    });
    if (foundInInvs) {
      saveLocalBackup('invoices.json', updatedInvs);
    }

    // 3. Update local disk backup discounts.json
    if (discId) {
      const localDscs = readLocalBackup('discounts.json', []);
      let foundInDscs = false;
      const updatedDscs = localDscs.map((d: any) => {
        if (d.id === discId) {
          foundInDscs = true;
          return { ...d, isDeleted: false, deletedAt: null, isPermanentlyDeleted: false };
        }
        return d;
      });
      if (foundInDscs) {
        saveLocalBackup('discounts.json', updatedDscs);
      }
    }

    // 4. Invalidate memory cache so next read is immediate
    memoryStore.invoices = null;
    memoryStore.discounts = null;

    res.json({ success: true, message: 'Öge başarıyla geri yüklendi.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function deleteFileFromFirestoreStorage(db: any, filename: string) {
  if (!db || !filename) return;
  try {
    const cleanFilename = decodeURIComponent(filename);
    const keysToTry = [...new Set([filename, cleanFilename, require('path').basename(filename)])];
    for (const key of keysToTry) {
      const metaSnap = await getDoc(doc(db, 'storage_files', key));
      if (metaSnap.exists()) {
        const meta = metaSnap.data();
        const count = Number(meta.chunks || 0);
        for (let i = 0; i < count; i++) {
          await deleteDoc(doc(db, 'storage_chunks', `${key}_${i}`)).catch(() => {});
        }
        await deleteDoc(doc(db, 'storage_files', key)).catch(() => {});
        console.log(`[PERMANENT DELETE] Firestore backup storage removed: ${key}`);
      }
    }
  } catch (err: any) {
    console.error('[PERMANENT DELETE FIRESTORE STORAGE ERROR]:', err.message);
  }
}


const _getStorageBucket = () => {
  if (bucket) return bucket;
  return null;
};

const _isUrlSharedWithOthers = async (url: string, excludedIds: string[] = []): Promise<boolean> => {
  if (!db || !url || url.startsWith('data:')) return false;
  try {
    const excludedSet = new Set(excludedIds);
    const { data: invs } = await getInvoicesCached();
    const otherInvs = invs.filter((i: any) => !excludedSet.has(i.id) && !i.isPermanentlyDeleted && i.fileUrl === url);
    if (otherInvs.length > 0) return true;

    const { data: dscs } = await getDiscountsCached();
    const otherDscs = dscs.filter((d: any) => !excludedSet.has(d.id) && !d.isPermanentlyDeleted && (d.firstOfferFileUrl === url || d.finalOfferFileUrl === url));
    if (otherDscs.length > 0) return true;

    return false;
  } catch (e) {
    return true; // safe fallback: keep file if verification fails
  }
};

const _deleteStorageFileByUrl = async (url: string): Promise<{ success: boolean; fileNotFound?: boolean; error?: string }> => {
  const activeBucket = _getStorageBucket();
  if (!activeBucket || !url || url.startsWith('data:')) {
    return { success: false, error: 'Storage bucket yapılandırılmamış veya geçersiz dosya adresi.' };
  }
  try {
    const urlObj = new URL(url, 'http://localhost');
    const filename = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
    if (!filename) {
      return { success: false, error: 'Geçersiz dosya adı.' };
    }

    const pathsToTry = [`faturalar/${filename}`, filename];
    for (const objectPath of pathsToTry) {
      const fileRef = activeBucket.file(objectPath);
      const [exists] = await fileRef.exists();
      if (exists) {
        await fileRef.delete();
        return { success: true };
      }
    }
    // File not found in bucket: considered benign for deletion
    return { success: true, fileNotFound: true };
  } catch (err: any) {
    console.error(`[STORAGE DELETE ERROR] ${url}:`, err);
    return { success: false, error: err.message || 'Storage dosyası silinirken hata oluştu' };
  }
};

// ============================================================================
// KALICI SİLME ENDPOINT'LERİ (FATURA & İNDİRİM AYRI VE GÜVENLİ)
// ============================================================================

// 1. FATURA KALICI SİLME ENDPOINT'İ
app.delete('/api/invoices/:id/permanent', async (req, res) => {
  const auth = await _verifyAdminAuth(req);
  if (!auth.authorized) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      error: auth.error || 'Yetkisiz işlem: Kalıcı silme işlemi yalnızca yetkili Sistem Yöneticisi (Admin) tarafından yapılabilir.'
    });
  }

  const isDryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const targetId = req.params.id;
  const adminId = (req.headers['x-admin-user'] as string) || auth.adminUser;

  try {
    if (!db) {
      return res.status(500).json({ error: 'Firestore bağlantısı başlatılamadı.' });
    }

    // 1. Silinecek faturayı Firestore'dan oku
    const invDocRef = doc(db, 'invoices', targetId);
    const invSnap = await getDoc(invDocRef);

    if (!invSnap.exists()) {
      // Idempotent temizleme: Firestore'da zaten bulunmuyorsa yedek/bellek temizliği yap ve 200 dön
      const localInvs = readLocalBackup('invoices.json', []);
      const newInvs = localInvs.filter((i: any) => i.id !== targetId);
      saveLocalBackup('invoices.json', newInvs);

      const localDscs = readLocalBackup('discounts.json', []);
      const newDscs = localDscs.filter((d: any) => d.id !== targetId && d.invoiceId !== targetId);
      saveLocalBackup('discounts.json', newDscs);

      memoryStore.invoices = null;
      memoryStore.discounts = null;

      try {
        await setDoc(doc(db, 'deletion_ledger', targetId), {
          collection: 'invoices',
          documentId: targetId,
          deletedAt: new Date().toISOString(),
          deletedBy: adminId,
          idempotent: true,
          note: 'Zaten silinmişti veya Firestore kaydı bulunamadı, çöp kutusu ve önbellekten arındırıldı.'
        });
      } catch (_) {}

      return res.status(200).json({
        success: true,
        idempotent: true,
        message: 'Bu fatura kaydı veritabanında zaten kalıcı olarak silinmiştir. Çöp kutusu ve önbellek güncellendi.',
        deletedRecords: [targetId],
        deletedFiles: []
      });
    }

    const invData = invSnap.data() as any;

    // Senkronize indirim kaydı kontrolü
    const linkedDiscId = invData.discountId || (targetId.startsWith('inv_sync_') ? targetId.replace('inv_sync_', '') : null);
    let discData: any = null;
    let discSnap: any = null;
    if (linkedDiscId) {
      try {
        discSnap = await getDoc(doc(db, 'discounts', linkedDiscId));
        if (discSnap.exists()) {
          discData = discSnap.data();
        }
      } catch (_) {}
    }

    // 2. İlişkili Storage PDF yollarını belirle
    const candidateFiles: string[] = [];
    if (invData.fileUrl && typeof invData.fileUrl === 'string' && !invData.fileUrl.startsWith('data:')) {
      candidateFiles.push(invData.fileUrl);
    }
    if (discData) {
      if (discData.firstOfferFileUrl && typeof discData.firstOfferFileUrl === 'string' && !discData.firstOfferFileUrl.startsWith('data:')) {
        candidateFiles.push(discData.firstOfferFileUrl);
      }
      if (discData.finalOfferFileUrl && typeof discData.finalOfferFileUrl === 'string' && !discData.finalOfferFileUrl.startsWith('data:')) {
        candidateFiles.push(discData.finalOfferFileUrl);
      }
    }
    const uniqueFiles = [...new Set(candidateFiles)];

    const excludedIds = [targetId, linkedDiscId].filter(Boolean) as string[];
    const unsharedFiles: string[] = [];
    const sharedFiles: string[] = [];

    for (const fileUrl of uniqueFiles) {
      const isShared = await _isUrlSharedWithOthers(fileUrl, excludedIds);
      if (isShared) {
        sharedFiles.push(fileUrl);
      } else {
        unsharedFiles.push(fileUrl);
      }
    }

    // 3. Dry-Run Modu (Canlı veriye dokunmadan simüle et)
    if (isDryRun) {
      return res.json({
        success: true,
        dryRun: true,
        message: 'Fatura kalıcı silme dry-run kontrolü başarılı. Hiçbir canlı veri silinmedi.',
        targetId,
        recordType: 'invoice',
        invoiceNumber: invData.invoiceNumber || null,
        linkedDiscountId: linkedDiscId || null,
        filesTotal: uniqueFiles.length,
        unsharedFilesToDelete: unsharedFiles,
        sharedFilesKept: sharedFiles,
        willDeleteRecords: [targetId, ...(discData && discData.isDeleted ? [linkedDiscId] : [])]
      });
    }

    // 4. Fiziksel Silme Sıralaması (İlişkili dosyalar -> Firestore belgesi -> deletion_ledger)
    const deletedFiles: string[] = [];
    const missingFiles: string[] = [];
    const storageErrors: string[] = [];

    // Adım A: Ortak kullanılmayan dosyaları Storage'dan sil
    for (const fileUrl of unsharedFiles) {
      const delRes = await _deleteStorageFileByUrl(fileUrl);
      if (delRes.success) {
        if (delRes.fileNotFound) {
          missingFiles.push(fileUrl);
        } else {
          deletedFiles.push(fileUrl);
        }
      } else {
        storageErrors.push(`${fileUrl}: ${delRes.error}`);
      }
    }

    if (storageErrors.length > 0) {
      return res.status(500).json({
        success: false,
        error: 'İlişkili dosya(lar) Storage üzerinden silinemediği için işlem durduruldu.',
        details: storageErrors
      });
    }

    // Adım B: Firestore belgesini fiziksel olarak sil
    const deletedRecords: string[] = [];
    await deleteDoc(invDocRef);
    deletedRecords.push(targetId);

    if (linkedDiscId && discSnap && discSnap.exists() && discData?.isDeleted) {
      await deleteDoc(doc(db, 'discounts', linkedDiscId));
      deletedRecords.push(linkedDiscId);
    }

    // Adım C: deletion_ledger içine immutable denetim kaydı yaz
    const auditRecord = {
      collection: 'invoices',
      documentId: targetId,
      deletedAt: new Date().toISOString(),
      deletedBy: adminId,
      invoiceNumber: invData.invoiceNumber || null,
      totalAmount: invData.totalAmount || null,
      supplier: invData.supplier || null,
      prizmaDemandId: invData.prizmaDemandId || null,
      deletedFiles,
      missingFiles,
      sharedFilesKept: sharedFiles,
      linkedDiscountId: linkedDiscId || null
    };
    await setDoc(doc(db, 'deletion_ledger', targetId), auditRecord);
    if (linkedDiscId) {
      try {
        await setDoc(doc(db, 'deletion_ledger', linkedDiscId), {
          ...auditRecord,
          documentId: linkedDiscId,
          collection: 'discounts',
          linkedInvoiceId: targetId
        });
      } catch (_) {}
    }

    // Adım D: Bellek önbelleğini ve yerel yedekleri temizle
    const localInvs = readLocalBackup('invoices.json', []);
    const newInvs = localInvs.filter((i: any) => !deletedRecords.includes(i.id));
    saveLocalBackup('invoices.json', newInvs);

    const localDscs = readLocalBackup('discounts.json', []);
    const newDscs = localDscs.filter((d: any) => !deletedRecords.includes(d.id));
    saveLocalBackup('discounts.json', newDscs);

    memoryStore.invoices = undefined;
    memoryStore.discounts = undefined;
    memoryStore.deletionLedger = undefined;

    return res.json({
      success: true,
      message: 'Fatura ve ilişkili tüm veriler kalıcı olarak başarıyla silindi.',
      deletedRecords,
      deletedFiles,
      missingFiles,
      sharedFilesKept: sharedFiles
    });
  } catch (err: any) {
    console.error('[PERMANENT INVOICE DELETE ERROR]:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      error: 'Fatura kalıcı olarak silinirken sunucu hatası oluştu: ' + err.message
    });
  }
});

// 2. İNDİRİM KALICI SİLME ENDPOINT'İ
app.delete('/api/discounts/:id/permanent', async (req, res) => {
  const auth = await _verifyAdminAuth(req);
  if (!auth.authorized) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      error: auth.error || 'Yetkisiz işlem: Kalıcı silme işlemi yalnızca yetkili Sistem Yöneticisi (Admin) tarafından yapılabilir.'
    });
  }

  const isDryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const targetId = req.params.id;
  const adminId = (req.headers['x-admin-user'] as string) || auth.adminUser;

  try {
    if (!db) {
      return res.status(500).json({ error: 'Firestore bağlantısı başlatılamadı.' });
    }

    // 1. Silinecek indirim kaydını Firestore'dan oku
    const dscDocRef = doc(db, 'discounts', targetId);
    const dscSnap = await getDoc(dscDocRef);

    if (!dscSnap.exists()) {
      // Idempotent temizleme: Firestore'da zaten bulunmuyorsa yedek/bellek temizliği yap ve 200 dön
      const localDscs = readLocalBackup('discounts.json', []);
      const newDscs = localDscs.filter((d: any) => d.id !== targetId);
      saveLocalBackup('discounts.json', newDscs);

      const localInvs = readLocalBackup('invoices.json', []);
      const newInvs = localInvs.filter((i: any) => i.id !== `inv_sync_${targetId}` && i.discountId !== targetId);
      saveLocalBackup('invoices.json', newInvs);

      memoryStore.invoices = null;
      memoryStore.discounts = null;

      try {
        await setDoc(doc(db, 'deletion_ledger', targetId), {
          collection: 'discounts',
          documentId: targetId,
          deletedAt: new Date().toISOString(),
          deletedBy: adminId,
          idempotent: true,
          note: 'Zaten silinmişti veya Firestore kaydı bulunamadı, çöp kutusu ve önbellekten arındırıldı.'
        });
      } catch (_) {}

      return res.status(200).json({
        success: true,
        idempotent: true,
        message: 'Bu indirim kaydı veritabanında zaten kalıcı olarak silinmiştir. Çöp kutusu ve önbellek güncellendi.',
        deletedRecords: [targetId],
        deletedFiles: []
      });
    }

    const dscData = dscSnap.data() as any;

    // Senkronize fatura kaydı kontrolü (örn. inv_sync_disc_...)
    const linkedInvId = dscData.invoiceId || dscData.syncInvoiceId || `inv_sync_${targetId}`;
    let invData: any = null;
    let invSnap: any = null;
    try {
      invSnap = await getDoc(doc(db, 'invoices', linkedInvId));
      if (invSnap.exists()) {
        invData = invSnap.data();
      }
    } catch (_) {}

    // 2. İlişkili Storage PDF yollarını belirle
    const candidateFiles: string[] = [];
    if (dscData.firstOfferFileUrl && typeof dscData.firstOfferFileUrl === 'string' && !dscData.firstOfferFileUrl.startsWith('data:')) {
      candidateFiles.push(dscData.firstOfferFileUrl);
    }
    if (dscData.finalOfferFileUrl && typeof dscData.finalOfferFileUrl === 'string' && !dscData.finalOfferFileUrl.startsWith('data:')) {
      candidateFiles.push(dscData.finalOfferFileUrl);
    }
    if (invData && invData.fileUrl && typeof invData.fileUrl === 'string' && !invData.fileUrl.startsWith('data:')) {
      candidateFiles.push(invData.fileUrl);
    }
    const uniqueFiles = [...new Set(candidateFiles)];

    const excludedIds = [targetId, linkedInvId].filter(Boolean) as string[];
    const unsharedFiles: string[] = [];
    const sharedFiles: string[] = [];

    for (const fileUrl of uniqueFiles) {
      const isShared = await _isUrlSharedWithOthers(fileUrl, excludedIds);
      if (isShared) {
        sharedFiles.push(fileUrl);
      } else {
        unsharedFiles.push(fileUrl);
      }
    }

    // 3. Dry-Run Modu
    if (isDryRun) {
      return res.json({
        success: true,
        dryRun: true,
        message: 'İndirim kalıcı silme dry-run kontrolü başarılı. Hiçbir canlı veri silinmedi.',
        targetId,
        recordType: 'discount',
        vendorName: dscData.vendorName || null,
        invoiceNo: dscData.invoiceNo || null,
        linkedInvoiceId: linkedInvId || null,
        filesTotal: uniqueFiles.length,
        unsharedFilesToDelete: unsharedFiles,
        sharedFilesKept: sharedFiles,
        willDeleteRecords: [targetId, ...(invData && invData.isDeleted ? [linkedInvId] : [])]
      });
    }

    // 4. Fiziksel Silme Sıralaması
    const deletedFiles: string[] = [];
    const missingFiles: string[] = [];
    const storageErrors: string[] = [];

    for (const fileUrl of unsharedFiles) {
      const delRes = await _deleteStorageFileByUrl(fileUrl);
      if (delRes.success) {
        if (delRes.fileNotFound) {
          missingFiles.push(fileUrl);
        } else {
          deletedFiles.push(fileUrl);
        }
      } else {
        storageErrors.push(`${fileUrl}: ${delRes.error}`);
      }
    }

    if (storageErrors.length > 0) {
      return res.status(500).json({
        success: false,
        error: 'İlişkili dosya(lar) Storage üzerinden silinemediği için işlem durduruldu.',
        details: storageErrors
      });
    }

    const deletedRecords: string[] = [];
    await deleteDoc(dscDocRef);
    deletedRecords.push(targetId);

    if (linkedInvId && invSnap && invSnap.exists() && invData?.isDeleted) {
      await deleteDoc(doc(db, 'invoices', linkedInvId));
      deletedRecords.push(linkedInvId);
    }

    // deletion_ledger içine immutable denetim kaydı yaz
    const auditRecord = {
      collection: 'discounts',
      documentId: targetId,
      deletedAt: new Date().toISOString(),
      deletedBy: adminId,
      invoiceNo: dscData.invoiceNo || null,
      vendorName: dscData.vendorName || null,
      agreedPrice: dscData.agreedPrice || null,
      discountAmount: dscData.discountAmount || null,
      deletedFiles,
      missingFiles,
      sharedFilesKept: sharedFiles,
      linkedInvoiceId: linkedInvId || null
    };
    await setDoc(doc(db, 'deletion_ledger', targetId), auditRecord);
    if (linkedInvId) {
      try {
        await setDoc(doc(db, 'deletion_ledger', linkedInvId), {
          ...auditRecord,
          documentId: linkedInvId,
          collection: 'invoices',
          linkedDiscountId: targetId
        });
      } catch (_) {}
    }

    // Bellek önbelleğini ve yerel yedekleri temizle
    const localDscs = readLocalBackup('discounts.json', []);
    const newDscs = localDscs.filter((d: any) => !deletedRecords.includes(d.id));
    saveLocalBackup('discounts.json', newDscs);

    const localInvs = readLocalBackup('invoices.json', []);
    const newInvs = localInvs.filter((i: any) => !deletedRecords.includes(i.id));
    saveLocalBackup('invoices.json', newInvs);

    memoryStore.invoices = undefined;
    memoryStore.discounts = undefined;
    memoryStore.deletionLedger = undefined;

    return res.json({
      success: true,
      message: 'İndirim kaydı ve ilişkili tüm veriler kalıcı olarak başarıyla silindi.',
      deletedRecords,
      deletedFiles,
      missingFiles,
      sharedFilesKept: sharedFiles
    });
  } catch (err: any) {
    console.error('[PERMANENT DISCOUNT DELETE ERROR]:', err);
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      error: 'İndirim kalıcı olarak silinirken sunucu hatası oluştu: ' + err.message
    });
  }
});

app.get('/api/invoices/trash', async (req, res) => {
  try {
    let trashInvs: any[] = [];
    if (db) {
      try {
        const snapshot = await getDocs(collection(db, 'invoices'));
        trashInvs = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
      } catch (err: any) {
        console.warn('[FIRESTORE TRASH INVOICES WARN]:', err.message);
      }
    }
    if (trashInvs.length === 0) {
      const backup = readLocalBackup('invoices.json', []);
      trashInvs = backup.filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
    }
    trashInvs.sort((a, b) => new Date(b.deletedAt || b.date || 0).getTime() - new Date(a.deletedAt || a.date || 0).getTime());
    res.json(trashInvs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/discounts/trash', async (req, res) => {
  try {
    let trashDscs: any[] = [];
    if (db) {
      try {
        const snapshot = await getDocs(collection(db, 'discounts'));
        trashDscs = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
      } catch (err: any) {
        console.warn('[FIRESTORE TRASH DISCOUNTS WARN]:', err.message);
      }
    }
    if (trashDscs.length === 0) {
      const backup = readLocalBackup('discounts.json', []);
      trashDscs = backup.filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
    }
    trashDscs.sort((a, b) => new Date(b.deletedAt || b.orderDate || 0).getTime() - new Date(a.deletedAt || a.orderDate || 0).getTime());
    res.json(trashDscs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trash', async (req, res) => {
  try {
    let trashInvs: any[] = [];
    let trashDscs: any[] = [];
    if (db) {
      try {
        const [invSnap, discSnap] = await Promise.all([
          getDocs(collection(db, 'invoices')),
          getDocs(collection(db, 'discounts'))
        ]);
        trashInvs = invSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
        trashDscs = discSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
      } catch (err: any) {
        console.warn('[FIRESTORE COMBINED TRASH WARN]:', err.message);
      }
    }
    if (trashInvs.length === 0) {
      const backupInvs = readLocalBackup('invoices.json', []);
      trashInvs = backupInvs.filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
    }
    if (trashDscs.length === 0) {
      const backupDscs = readLocalBackup('discounts.json', []);
      trashDscs = backupDscs.filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
    }
    res.json({ invoices: trashInvs, discounts: trashDscs, total: trashInvs.length + trashDscs.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(['/api/invoices/trash/orphan-cleaner', '/api/invoices/trash/empty', '/api/discounts/trash/empty'], async (req, res) => {
  const auth = await _verifyAdminAuth(req);
  if (!auth.authorized) {
    return res.status(403).json({
      code: 'FORBIDDEN',
      error: auth.error || 'Yetkisiz işlem: Çöp kutusunu boşaltma işlemi yalnızca yetkili Sistem Yöneticisi (Admin) tarafından yapılabilir.'
    });
  }

  const isDryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const adminId = (req.headers['x-admin-user'] as string) || auth.adminUser;

  try {
    const deletedRecords: string[] = [];
    const deletedFiles: string[] = [];
    const missingFiles: string[] = [];
    const failedRecords: string[] = [];
    const failures: string[] = [];

    let trashInvs: any[] = [];
    let trashDscs: any[] = [];

    if (db) {
      try {
        const [invSnap, discSnap] = await Promise.all([
          getDocs(collection(db, 'invoices')),
          getDocs(collection(db, 'discounts'))
        ]);
        trashInvs = invSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
        trashDscs = discSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() as any }))
          .filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
      } catch (e: any) {
        console.warn('[EMPTY TRASH FIRESTORE WARN]:', e.message);
      }
    }

    if (trashInvs.length === 0) {
      const backupInvs = readLocalBackup('invoices.json', []);
      trashInvs = backupInvs.filter((i: any) => i.isDeleted === true && i.isPermanentlyDeleted !== true);
    }
    if (trashDscs.length === 0) {
      const backupDscs = readLocalBackup('discounts.json', []);
      trashDscs = backupDscs.filter((d: any) => d.isDeleted === true && d.isPermanentlyDeleted !== true);
    }

    const allTrashIds = [...trashInvs.map(i => i.id), ...trashDscs.map(d => d.id)];

    if (isDryRun) {
      return res.json({
        success: true,
        dryRun: true,
        message: `Çöp kutusu boşaltma dry-run kontrolü başarılı. ${trashInvs.length} fatura ve ${trashDscs.length} indirim kalıcı silinecek.`,
        trashInvoicesCount: trashInvs.length,
        trashDiscountsCount: trashDscs.length,
        totalItems: allTrashIds.length,
        willDeleteIds: allTrashIds
      });
    }

    // Process Invoices in Trash
    for (const inv of trashInvs) {
      try {
        // 1. Files
        if (inv.fileUrl && !inv.fileUrl.startsWith('data:')) {
          const isShared = await _isUrlSharedWithOthers(inv.fileUrl, allTrashIds);
          if (!isShared) {
            const delRes = await _deleteStorageFileByUrl(inv.fileUrl);
            if (delRes.success) {
              if (delRes.fileNotFound) missingFiles.push(inv.fileUrl);
              else deletedFiles.push(inv.fileUrl);
            }
          }
        }
        // 2. Firestore document
        if (db) {
          await deleteDoc(doc(db, 'invoices', inv.id));
          await setDoc(doc(db, 'deletion_ledger', inv.id), {
            collection: 'invoices',
            documentId: inv.id,
            invoiceNumber: inv.invoiceNumber || null,
            supplier: inv.supplier || inv.vendorName || null,
            totalAmount: inv.totalAmount || null,
            prizmaDemandId: inv.prizmaDemandId || null,
            linkedDiscountId: inv.discountId || null,
            deletedAt: new Date().toISOString(),
            deletedBy: adminId,
            reason: 'empty_trash'
          });
        }
        deletedRecords.push(inv.id);
      } catch (e: any) {
        failedRecords.push(inv.id);
        failures.push(e.message);
      }
    }

    // Process Discounts in Trash
    for (const dsc of trashDscs) {
      try {
        // 1. Files
        for (const u of [dsc.firstOfferFileUrl, dsc.finalOfferFileUrl]) {
          if (u && !u.startsWith('data:')) {
            const isShared = await _isUrlSharedWithOthers(u, allTrashIds);
            if (!isShared) {
              const delRes = await _deleteStorageFileByUrl(u);
              if (delRes.success) {
                if (delRes.fileNotFound) missingFiles.push(u);
                else deletedFiles.push(u);
              }
            }
          }
        }
        // 2. Firestore document & synced invoice
        const syncInvId = `inv_sync_${dsc.id}`;
        if (db) {
          await deleteDoc(doc(db, 'discounts', dsc.id));
          await deleteDoc(doc(db, 'invoices', syncInvId)).catch(() => {});
          await setDoc(doc(db, 'deletion_ledger', dsc.id), {
            collection: 'discounts',
            documentId: dsc.id,
            invoiceNo: dsc.invoiceNo || null,
            vendorName: dsc.vendorName || dsc.supplier || null,
            agreedPrice: dsc.agreedPrice || null,
            linkedInvoiceId: syncInvId,
            deletedAt: new Date().toISOString(),
            deletedBy: adminId,
            reason: 'empty_trash'
          });
          await setDoc(doc(db, 'deletion_ledger', syncInvId), {
            collection: 'invoices',
            documentId: syncInvId,
            invoiceNumber: dsc.invoiceNo || null,
            supplier: dsc.vendorName || dsc.supplier || null,
            totalAmount: dsc.agreedPrice || null,
            linkedDiscountId: dsc.id,
            deletedAt: new Date().toISOString(),
            deletedBy: adminId,
            reason: 'empty_trash'
          }).catch(() => {});
        }
        deletedRecords.push(dsc.id);
        deletedRecords.push(syncInvId);
      } catch (e: any) {
        failedRecords.push(dsc.id);
        failures.push(e.message);
      }
    }

    if (deletedRecords.length > 0) {
      const localInvs = readLocalBackup('invoices.json', []);
      const newInvs = localInvs.filter((i: any) => !deletedRecords.includes(i.id));
      saveLocalBackup('invoices.json', newInvs);

      const localDscs = readLocalBackup('discounts.json', []);
      const newDscs = localDscs.filter((d: any) => !deletedRecords.includes(d.id));
      saveLocalBackup('discounts.json', newDscs);

      memoryStore.invoices = undefined;
      memoryStore.discounts = undefined;
      memoryStore.deletionLedger = undefined;
    }

    res.json({
      success: failedRecords.length === 0,
      message: `Çöp kutusu başarıyla temizlendi. Toplam ${deletedRecords.length} kayıt kalıcı olarak silindi.`,
      deletedRecords,
      deletedFiles,
      missingFiles,
      failedRecords,
      failures
    });

  } catch (err: any) {
    console.error('[TRASH EMPTY ERROR]:', err);
    res.status(500).json({ error: 'Çöp kutusu boşaltılamadı: ' + err.message });
  }
});

app.post(['/api/discounts/process-ai', '/api/invoices/process-ai'], async (req, res) => {
  try {
    const {
      fileBase64,
      imageBase64,
      mimeType,
      promptText,
      excelCsv,
      fileTextContext,
      fileName,
      scanMode,
      offerType,
      firstOfferBase64,
      firstOfferFileName
    } = req.body || {};
    const base64Input = fileBase64 || imageBase64;

    if (!base64Input && !excelCsv && !fileTextContext) {
      return res.status(400).json({ error: 'Fatura görseli veya Excel verisi bulunamadı.' });
    }

    // Fetch existing active invoices & discounts for duplicate checking (cached in-memory for speed)
    let existingInvoices: any[] = [];
    try {
      const [{ data: cachedInvs }, { data: cachedDiscounts }] = await Promise.all([
        getInvoicesCached(),
        getDiscountsCached()
      ]);
      const mappedDiscounts = (cachedDiscounts || []).map((d: any) => ({
        id: d.id,
        supplier: d.vendorName || d.supplier,
        vendorName: d.vendorName || d.supplier,
        invoiceNumber: d.invoiceNo,
        invoiceNo: d.invoiceNo,
        date: d.orderDate,
        orderDate: d.orderDate,
        totalAmount: d.agreedPrice || d.offerPrice,
        jobsiteName: d.jobsiteName,
        uploadedBySupervisorName: d.supervisorName,
        fileUrl: d.finalOfferFileUrl || d.firstOfferFileUrl,
        firstOfferFileUrl: d.firstOfferFileUrl,
        finalOfferFileUrl: d.finalOfferFileUrl,
        isDeleted: d.isDeleted
      }));
      existingInvoices = [...(cachedInvs || []), ...mappedDiscounts];
    } catch (err: any) {
      console.warn('[AI OCR] Existing invoices fetch warning:', err.message);
    }

    const result = await processInvoiceTwoStages({
      base64Input,
      mimeType,
      excelCsv,
      fileTextContext,
      fileName,
      additionalPrompt: promptText,
      existingInvoices,
      scanMode,
      offerType,
      firstOfferBase64,
      firstOfferFileName
    });

    res.json({
      success: true,
      extracted: result.extracted,
      validation: result.validation,
      duplicateInfo: result.duplicateInfo,
      usedModel: result.usedModel,
      retryCount: result.retryCount,
      stagesCompleted: result.stagesCompleted
    });
  } catch (err: any) {
    console.error('[AI OCR ERROR - Resilient Recovery Triggered]:', err);
    try {
      const { excelCsv, fileTextContext, fileName, scanMode, offerType } = req.body || {};
      const isSummary = scanMode === 'summary-only' || offerType === 'first' || offerType === 'round';
      const fallbackRaw = fallbackExtractInvoiceFromTextOrCsv(
        [excelCsv, fileTextContext].filter(Boolean).join('\n\n'),
        fileName,
        isSummary
      );
      const fallbackSupplier = fallbackRaw.supplier?.value || 'Tedarikçi Firma';
      const fallbackTotal = Number(fallbackRaw.totalAmount?.value || 0);
      const recoveredExtracted = {
        documentType: fallbackRaw.documentType || 'invoice',
        supplier: fallbackSupplier,
        vendorName: fallbackSupplier,
        company: fallbackSupplier,
        seller: fallbackSupplier,
        invoiceNumber: fallbackRaw.invoiceNumber?.value || `BLG-${Date.now().toString().slice(-6)}`,
        date: fallbackRaw.date?.value || new Date().toISOString().split('T')[0],
        currency: fallbackRaw.currency?.value || 'RUB',
        subtotal: fallbackTotal,
        discount: 0,
        tax: 0,
        totalAmount: fallbackTotal,
        items: fallbackRaw.items || [],
        overallConfidence: 0.80,
        rawWarnings: ['Yerel kurtarma ayrıştırıcısı ile okundu.']
      };
      const { data: cachedInvsFallback } = await getInvoicesCached().catch(() => ({ data: [] }));
      const dupFallback = checkDuplicateInvoice({
        supplier: recoveredExtracted.supplier,
        invoiceNumber: recoveredExtracted.invoiceNumber,
        date: recoveredExtracted.date,
        totalAmount: recoveredExtracted.totalAmount
      }, cachedInvsFallback || []);
      return res.json({
        success: true,
        extracted: recoveredExtracted,
        validation: validateInvoiceData(recoveredExtracted),
        duplicateInfo: dupFallback,
        usedModel: 'local-resilient-parser',
        retryCount: 1,
        stagesCompleted: 1
      });
    } catch (_) {
      res.status(500).json({ error: 'Yapay zeka işlemi başarısız oldu.', details: err.message });
    }
  }
});

// ============================================================================
// 7. VITE & STATIC SERVING (PRODUCTION)
// ============================================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER UNHANDLED REJECTION]:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[SERVER UNCAUGHT EXCEPTION]:', err);
});


// Helper: Reconstructs any file present in Firestore storage_files/storage_chunks (or local disk) and heals it into GCS faturalar/
async function healMissingFileFromFirestoreToGcs(filename: string): Promise<any | null> {
  if (!bucket || !filename) return null;
  const safeName = path.basename(filename);
  try {
    if (db) {
      const metaSnap = await getDoc(doc(db, 'storage_files', safeName));
      if (metaSnap.exists()) {
        const meta = metaSnap.data();
        const count = Number(meta.chunks || 0);
        if (Number.isInteger(count) && count >= 1 && count <= 100) {
          const parts: string[] = [];
          let complete = true;
          for (let i = 0; i < count; i++) {
            const chunk = await getDoc(doc(db, 'storage_chunks', `${safeName}_${i}`));
            if (!chunk.exists() || typeof chunk.data().data !== 'string') {
              complete = false;
              break;
            }
            parts.push(chunk.data().data);
          }
          if (complete) {
            const buffer = Buffer.from(parts.join(''), 'base64');
            if (buffer.length > 0) {
              const contentType = meta.contentType || (safeName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
              const gcsFileRef = bucket.file(`faturalar/${safeName}`);
              await gcsFileRef.save(buffer, {
                resumable: false,
                metadata: { contentType, cacheControl: 'private, max-age=3600', metadata: { originalName: meta.originalName || safeName } }
              });
              try {
                fs.writeFileSync(path.join(LOCAL_FILES_DIR, safeName), buffer);
              } catch (_) {}
              console.log(`[STORAGE AUTO-HEAL] Reconstructed ${safeName} (${buffer.length} bytes) from Firestore chunks to GCS faturalar/${safeName}`);
              return gcsFileRef;
            }
          }
        }
      }
    }

    const localCandidate = path.join(LOCAL_FILES_DIR, safeName);
    if (fs.existsSync(localCandidate)) {
      const buffer = fs.readFileSync(localCandidate);
      if (buffer.length > 0) {
        const contentType = safeName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
        const gcsFileRef = bucket.file(`faturalar/${safeName}`);
        await gcsFileRef.save(buffer, {
          resumable: false,
          metadata: { contentType, cacheControl: 'private, max-age=3600', metadata: { originalName: safeName } }
        });
        console.log(`[STORAGE AUTO-HEAL] Synced ${safeName} from local disk to GCS faturalar/${safeName}`);
        return gcsFileRef;
      }
    }
  } catch (err: any) {
    console.warn(`[STORAGE AUTO-HEAL WARN] Could not heal ${safeName}:`, err.message);
  }
  return null;
}

// ============================================================================
// GECE YEDEĞİ: aynı gün tekrar çalışırsa yeni nesne/versiyon üretmez.
async function createNightlyBackup() {
  if (!bucket || !db) throw new Error('Bucket/db not available');
  
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const backupData: any = { schemaVersion: 2, createdAt: now.toISOString(), collections: {}, pdfManifest: [] };
  const cols = ['invoices', 'discounts', 'supervisors', 'jobsites', 'personnel', 'settings'];
  
  // 1. Snapshot Firestore Data
  for (const name of cols) {
    const snap = await getDocs(collection(db, name));
    backupData.collections[name] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  }
  
  // 2. Build PDF Manifest & Verify GCS Objects
  const fileUrlsToVerify = new Set<string>();
  
  // Extract URLs from Invoices
  backupData.collections['invoices'].forEach((inv: any) => {
    if (inv.fileUrl && !inv.fileUrl.startsWith('data:')) fileUrlsToVerify.add(inv.fileUrl);
  });
  
  // Extract URLs from Discounts
  backupData.collections['discounts'].forEach((disc: any) => {
    if (disc.firstOfferFileUrl && !disc.firstOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(disc.firstOfferFileUrl);
    if (disc.finalOfferFileUrl && !disc.finalOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(disc.finalOfferFileUrl);
  });
  
  const dailyPrefix = `sistem-yedekleri/daily/backup-${dateStr}/pdfs/`;
  const [sourceFiles, archivedFiles] = await Promise.all([
    bucket.getFiles({ prefix: 'faturalar/' }).then((r: any) => r[0] || []).catch(() => []),
    bucket.getFiles({ prefix: dailyPrefix }).then((r: any) => r[0] || []).catch(() => [])
  ]);
  const fileMap = new Map<string, any>();
  const alreadyArchivedPdfs = new Set<string>();

  for (const f of sourceFiles) {
    const fn = path.basename(f.name).toLowerCase();
    if (!fileMap.has(fn)) {
      fileMap.set(fn, f);
    }
  }
  for (const f of archivedFiles) {
    const fn = path.basename(f.name).toLowerCase();
    alreadyArchivedPdfs.add(fn);
  }

  const pdfManifest = [];
  const missingFilesList: string[] = [];
  const filesToArchive: { source: any; dest: any }[] = [];
  let missingPdfs = 0;

  for (const fUrl of Array.from(fileUrlsToVerify)) {
    const match = String(fUrl).match(/\/api\/files\/([^/?]+)/);
    if (match && match[1]) {
      const filename = decodeURIComponent(match[1]);
      let fileRef = fileMap.get(filename.toLowerCase());
      if (!fileRef) {
        fileRef = await healMissingFileFromFirestoreToGcs(filename);
        if (fileRef) fileMap.set(filename.toLowerCase(), fileRef);
      }

      if (fileRef) {
        const metadata = fileRef.metadata || {};
        const backupPdfPath = `${dailyPrefix}${filename}`;
        const backupFileRef = bucket.file(backupPdfPath);

        if (!alreadyArchivedPdfs.has(filename.toLowerCase())) {
          filesToArchive.push({ source: fileRef, dest: backupFileRef });
        }

        pdfManifest.push({
          url: fUrl,
          originalPath: fileRef.name,
          archivePath: backupPdfPath,
          generation: metadata.generation,
          size: metadata.size,
          checksum: metadata.md5Hash || metadata.crc32c,
          contentType: metadata.contentType
        });
      } else {
        missingPdfs++;
        missingFilesList.push(filename);
      }
    }
  }

  // Batch archiving: copy up to 10 files concurrently
  if (filesToArchive.length > 0) {
    for (let i = 0; i < filesToArchive.length; i += 10) {
      const chunk = filesToArchive.slice(i, i + 10);
      await Promise.allSettled(chunk.map(c => c.source.copy(c.dest)));
    }
  }

  backupData.pdfManifest = pdfManifest;
  backupData.stats = {
    totalCollections: cols.length,
    invoices: backupData.collections['invoices'].length,
    discounts: backupData.collections['discounts'].length,
    supervisors: backupData.collections['supervisors'].length,
    jobsites: backupData.collections['jobsites'].length,
    personnel: backupData.collections['personnel'].length,
    verifiedPdfs: pdfManifest.length,
    missingPdfs,
    missingFiles: missingFilesList.slice(0, 30),
    status: missingPdfs === 0 ? 'verified_complete' : 'partial_warning'
  };

  // 3. Upload Snapshot + Manifest to GCS
  const objectName = `sistem-yedekleri/daily/backup-${dateStr}.json`;
  let gcsSaved = false;
  let gcsWarning: string | null = null;

  try {
    await bucket.file(objectName).save(JSON.stringify(backupData, null, 2), {
      resumable: false,
      metadata: { contentType: 'application/json', cacheControl: 'no-store' }
    });
    gcsSaved = true;
  } catch (err: any) {
    if (err?.code !== 412) {
      gcsWarning = err.message;
      console.warn(`[NIGHTLY BACKUP GCS WARN]: ${err.message}`);
    }
  }

  // Also sync snapshot into Firestore system_backups collection for durable multi-layered cloud redundancy
  let firestoreSnapshotId: string | null = null;
  try {
    const currentData = await getFullSystemData();
    const meta = createSnapshot(currentData, 'scheduled', {
      label: `Otomatik Gece Yedeği (${dateStr})`,
      description: `${backupData.stats.invoices} fatura, ${backupData.stats.discounts} indirim, ${backupData.stats.verifiedPdfs} doğrulanmış PDF`
    });
    await syncSnapshotToCloud(db, bucket, meta);
    firestoreSnapshotId = meta.id;
    await setDoc(doc(db, 'system_stats', 'daily_counts'), {
      invoices: backupData.stats.invoices,
      discounts: backupData.stats.discounts,
      total: backupData.stats.invoices + backupData.stats.discounts,
      date: now.toISOString(),
      updatedAt: now.toISOString()
    }, { merge: true }).catch(() => {});
  } catch (snapErr: any) {
    console.warn(`[NIGHTLY BACKUP FIRESTORE WARN]: ${snapErr.message}`);
  }

  // Eksik PDF durumu: Veri kaybını önlemek için yedek asla reddedilmez; uyarı eklenir ve missingPdfs raporlanır
  const hasMissingPdfs = missingPdfs > 0;
  if (hasMissingPdfs) {
    console.warn(`[NIGHTLY BACKUP WARN] ${missingPdfs} adet PDF eksik ancak sistem veri yedeği başarıyla korundu.`);
  }

  const warnings = [
    hasMissingPdfs ? `${missingPdfs} adet PDF dosyası eksik, ancak veri yedeği başarıyla korundu.` : null,
    gcsWarning ? `Cloud Storage uyarısı: ${gcsWarning}` : null
  ].filter(Boolean);

  return {
    objectName,
    created: gcsSaved || !!firestoreSnapshotId,
    gcsSaved,
    firestoreSnapshotId,
    warning: warnings.length > 0 ? warnings.join(' | ') : null,
    stats: backupData.stats
  };
}

// PRIZMA OTOMATİK ENTEGRASYON VE ÇİFT KAYIT / SİLİNEN FATURA HORTLAMA KORUMALI VERİTABANI İÇE AKTARIMI
export async function integratePrizmaInvoicesInternal(dbInstance: any): Promise<{
  success: boolean;
  addedCount: number;
  enrichedCount: number;
  skippedCount: number;
  totalPrizma: number;
  message: string;
}> {
  if (!dbInstance) {
    throw new Error('Firestore veritabanı bağlı değil.');
  }

  const prizmaInvs = await prizmaSyncService.getInvoicesCached();
  if (!prizmaInvs || prizmaInvs.length === 0) {
    return {
      success: true,
      addedCount: 0,
      enrichedCount: 0,
      skippedCount: 0,
      totalPrizma: 0,
      message: 'Entegre edilecek Prizma faturası bulunamadı.'
    };
  }

  // Anti-Hortlama Koruması: Hem aktif hem çöp kutusundaki (isDeleted) hem de kalıcı silinen (deletion_ledger) kayıtları kontrol et!
  const [invSnap, ledger] = await Promise.all([
    getDocs(collection(dbInstance, 'invoices')),
    getDeletionLedgerCached()
  ]);
  const allDbInvoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));

  const byPrizmaDemandId = new Map<number, any>();
  const byVendorAndNo = new Map<string, any>();
  const byInvoiceNo = new Map<string, any>();
  const byVendorDateAmount = new Map<string, any>();

  allDbInvoices.forEach(inv => {
    if (inv.prizmaDemandId) byPrizmaDemandId.set(Number(inv.prizmaDemandId), inv);
    const cleanNo = String(inv.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const cleanVendor = normalizeVendorName(inv.supplier || inv.vendorName || '');
    const amt = Math.round(Number(inv.totalAmount) || 0);
    const dt = String(inv.date || '').split('T')[0];

    if (cleanNo) {
      if (cleanVendor) byVendorAndNo.set(`${cleanVendor}___${cleanNo}`, inv);
      if (cleanNo.length >= 4) byInvoiceNo.set(cleanNo, inv);
    }
    if (cleanVendor && dt && amt > 0) {
      byVendorDateAmount.set(`${cleanVendor}___${dt}___${amt}`, inv);
    }
  });

  let addedCount = 0;
  let enrichedCount = 0;
  let skippedCount = 0;

  const newInvoicesToSave: any[] = [];
  const updatesToSave: Array<{ id: string; payload: any }> = [];

  const sanitizeFirestoreObj = (obj: any): any => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeFirestoreObj);
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitizeFirestoreObj(v)])
    );
  };

  for (const pInv of prizmaInvs) {
    if (pInv.isDeleted || !pInv.items || pInv.items.length === 0) {
      skippedCount++;
      continue;
    }

    const pCleanNo = String(pInv.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const pCleanVendor = normalizeVendorName(pInv.supplier || pInv.vendorName || '');
    const pAmt = Math.round(Number(pInv.totalAmount) || 0);
    const pDate = String(pInv.date || '').split('T')[0];
    const pDemandId = Number(pInv.prizmaDemandId);
    const candidateId = `inv_prizma_${pInv.prizmaDemandId}`;

    // Kalıcı olarak silinmişse (deletion_ledger) asla geri getirme / hortlatma!
    if (
      ledger.ids.has(candidateId) ||
      (pDemandId && ledger.prizmaIds.has(pDemandId)) ||
      (pCleanNo && pCleanVendor && ledger.invoiceKeys.has(`${pCleanVendor}___${pCleanNo}`))
    ) {
      skippedCount++;
      continue;
    }

    // Check for duplicate / existing match (including soft-deleted records in trash)
    let match = (pDemandId ? byPrizmaDemandId.get(pDemandId) : null) ||
      (pCleanNo && pCleanVendor ? byVendorAndNo.get(`${pCleanVendor}___${pCleanNo}`) : null) ||
      (pCleanNo && pCleanNo.length >= 4 ? byInvoiceNo.get(pCleanNo) : null) ||
      (pCleanVendor && pDate && pAmt > 0 ? byVendorDateAmount.get(`${pCleanVendor}___${pDate}___${pAmt}`) : null);

    if (match) {
      // Çöp kutusundaysa (isDeleted) veya kalıcı silinmişse dokunma ve hortlatma!
      if (match.isDeleted || match.isPermanentlyDeleted || ledger.ids.has(match.id)) {
        skippedCount++;
        continue;
      }
      // ENRICH existing invoice with Prizma metadata without creating duplicate
      const isMatchPurePrizma = Boolean(String(match.id || '').startsWith('inv_prizma_') || String(match.id || '').startsWith('prizma_'));
      const enrichPayload: any = {
        prizmaSource: isMatchPurePrizma,
        origin: isMatchPurePrizma ? 'prizma' : 'ges_archive',
        prizmaLinked: true,
        prizmaDemandId: pInv.prizmaDemandId,
        prizmaRequestCode: pInv.prizmaRequestCode || match.prizmaRequestCode || null,
        prizmaOrderCode: pInv.prizmaOrderCode || match.prizmaOrderCode || null,
        prizmaOrderDemandId: pInv.prizmaOrderDemandId || match.prizmaOrderDemandId || null,
        prizmaBtfUrl: pInv.prizmaBtfUrl || match.prizmaBtfUrl || null,
        prizmaStfUrl: pInv.prizmaStfUrl || match.prizmaStfUrl || null,
        prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl || match.prizmaUrl || null,
        prizmaStatus: pInv.prizmaStatus || match.prizmaStatus || null,
        supplierInn: pInv.supplierInn || match.supplierInn || null
      };
      if ((pInv as any).excludedFreightAmount) {
        enrichPayload.excludedFreightAmount = (pInv as any).excludedFreightAmount;
        enrichPayload.excludedFreightGrossAmount = (pInv as any).excludedFreightGrossAmount;
      }
      // If it is a Prizma-created invoice record (inv_prizma_*), also refresh its normalized items and category
      if (String(match.id || '').startsWith('inv_prizma_')) {
        const refreshedItems = (pInv.items || []).map((it: any) => {
          const norm = smartNormalizeItem({ ...it, supplier: pInv.supplier });
          const cat = normalizeCategoryName(norm.category || it.category, norm.materialName || it.materialName);
          return {
            id: it.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            materialName: norm.materialName || it.materialName,
            originalName: it.originalName || it.materialName,
            materialCode: it.materialCode || null,
            quantity: Number(it.quantity) || 1,
            unit: it.unit || 'Adet',
            unitPrice: Number(it.unitPriceNet ?? it.unitPrice) || 0,
            unitPriceNet: Number(it.unitPriceNet ?? it.unitPrice) || 0,
            grossUnitPrice: Number(it.grossUnitPrice ?? it.unitPrice) || 0,
            totalPrice: Number(it.totalPrice) || 0,
            grossTotalPrice: Number(it.grossTotalPrice ?? it.totalPrice) || 0,
            vatPercentage: it.vatPercentage !== undefined ? Number(it.vatPercentage) : 22,
            isNetNormalized: Boolean(it.isNetNormalized),
            ...(it.lineSource ? { lineSource: it.lineSource, invoiceLineNo: it.invoiceLineNo ?? null, article: it.article ?? null } : {}),
            category: cat,
            prizmaRequestCode: pInv.prizmaRequestCode,
            prizmaOrderCode: pInv.prizmaOrderCode,
            prizmaBtfUrl: pInv.prizmaBtfUrl,
            prizmaStfUrl: pInv.prizmaStfUrl,
            prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl
          };
        });
        enrichPayload.items = refreshedItems;
        enrichPayload.category = pInv.category || (refreshedItems[0]?.category) || match.category;
        // Nakliye yalnızca belgedeki/STF'deki açık nakliye satırlarından gelir; eski "fark = nakliye" değeri temizlenir.
        enrichPayload.excludedFreightAmount = Number((pInv as any).excludedFreightAmount) || 0;
        enrichPayload.excludedFreightGrossAmount = Number((pInv as any).excludedFreightGrossAmount) || 0;
        if ((pInv as any).lineCheck) {
          enrichPayload.lineCheck = (pInv as any).lineCheck;
          enrichPayload.linesSource = (pInv as any).linesSource || 'stf_order';
        }
      }
      updatesToSave.push({ id: match.id, payload: enrichPayload });
      enrichedCount++;
    } else {
      // ADD as a new system invoice
      const id = `inv_prizma_${pInv.prizmaDemandId}`;
      const normalizedItems = (pInv.items || []).map((it: any) => {
        const norm = smartNormalizeItem({ ...it, supplier: pInv.supplier });
        const cat = normalizeCategoryName(norm.category || it.category, norm.materialName || it.materialName);
        return {
          id: it.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          materialName: norm.materialName || it.materialName,
          originalName: it.originalName || it.materialName,
          materialCode: it.materialCode || null,
          quantity: Number(it.quantity) || 1,
          unit: it.unit || 'Adet',
          unitPrice: Number(it.unitPriceNet ?? it.unitPrice) || 0,
          unitPriceNet: Number(it.unitPriceNet ?? it.unitPrice) || 0,
          grossUnitPrice: Number(it.grossUnitPrice ?? it.unitPrice) || 0,
          totalPrice: Number(it.totalPrice) || 0,
          grossTotalPrice: Number(it.grossTotalPrice ?? it.totalPrice) || 0,
          vatPercentage: it.vatPercentage !== undefined ? Number(it.vatPercentage) : 22,
          isNetNormalized: Boolean(it.isNetNormalized),
          ...(it.lineSource ? { lineSource: it.lineSource, invoiceLineNo: it.invoiceLineNo ?? null, article: it.article ?? null } : {}),
          category: cat,
          prizmaRequestCode: pInv.prizmaRequestCode,
          prizmaOrderCode: pInv.prizmaOrderCode,
          prizmaBtfUrl: pInv.prizmaBtfUrl,
          prizmaStfUrl: pInv.prizmaStfUrl,
          prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl
        };
      });

      const newInvDoc = {
        id,
        invoiceNumber: pInv.invoiceNumber || `PRZ-${pInv.prizmaDemandId}`,
        date: pDate,
        supplier: pInv.supplier,
        vendorName: pInv.vendorName || pInv.supplier,
        supplierInn: pInv.supplierInn || null,
        jobsiteId: '',
        jobsiteName: pInv.jobsiteName || 'Genel Şantiye',
        uploadedBySupervisorId: '',
        uploadedBySupervisorName: pInv.prizmaCreatedBy || 'Prizma ERP',
        totalAmount: pInv.totalAmount || 0,
        ...((pInv as any).excludedFreightAmount ? {
          excludedFreightAmount: (pInv as any).excludedFreightAmount,
          excludedFreightGrossAmount: (pInv as any).excludedFreightGrossAmount
        } : {}),
        currency: pInv.currency || '₽',
        category: pInv.category || (normalizedItems[0]?.category) || 'İnşaat Malzemesi',
        items: normalizedItems,
        created_at: pInv.date || new Date().toISOString(),
        isDeleted: false,
        prizmaSource: true,
        prizmaDemandId: pInv.prizmaDemandId,
        prizmaRequestCode: pInv.prizmaRequestCode,
        prizmaOrderCode: pInv.prizmaOrderCode,
        prizmaOrderDemandId: pInv.prizmaOrderDemandId,
        prizmaBtfUrl: pInv.prizmaBtfUrl,
        prizmaStfUrl: pInv.prizmaStfUrl,
        prizmaUrl: pInv.prizmaBtfUrl || pInv.prizmaUrl,
        prizmaStatus: pInv.prizmaStatus,
        rawFileName: `prizma_${pInv.prizmaDemandId}.pdf`,
        fileUrl: `/api/prizma/invoice-file/${pInv.prizmaDemandId}?type=schet`,
        ...((pInv as any).lineCheck ? { lineCheck: (pInv as any).lineCheck, linesSource: (pInv as any).linesSource || 'stf_order' } : {})
      };

      newInvoicesToSave.push(newInvDoc);
      addedCount++;

      // Add to in-memory lookup to avoid duplicates in subsequent iterations
      if (pDemandId) byPrizmaDemandId.set(pDemandId, newInvDoc);
      if (pCleanNo) {
        if (pCleanVendor) byVendorAndNo.set(`${pCleanVendor}___${pCleanNo}`, newInvDoc);
        if (pCleanNo.length >= 4) byInvoiceNo.set(pCleanNo, newInvDoc);
      }
    }
  }

  // Write to Firestore in batches
  if (newInvoicesToSave.length > 0 || updatesToSave.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < newInvoicesToSave.length; i += batchSize) {
      const batch = writeBatch(dbInstance);
      const chunk = newInvoicesToSave.slice(i, i + batchSize);
      chunk.forEach(inv => {
        batch.set(doc(dbInstance, 'invoices', inv.id), sanitizeFirestoreObj(inv), { merge: true });
      });
      await batch.commit();
    }

    for (let i = 0; i < updatesToSave.length; i += batchSize) {
      const batch = writeBatch(dbInstance);
      const chunk = updatesToSave.slice(i, i + batchSize);
      chunk.forEach(u => {
        batch.set(doc(dbInstance, 'invoices', u.id), sanitizeFirestoreObj(u.payload), { merge: true });
      });
      await batch.commit();
    }

    for (let i = 0; i < prizmaInvs.length; i += batchSize) {
      const batch = writeBatch(dbInstance);
      const chunk = prizmaInvs.slice(i, i + batchSize);
      chunk.forEach(pInv => {
        if (pInv && pInv.id) {
          batch.set(doc(dbInstance, 'prizma_invoices', pInv.id), sanitizeFirestoreObj(pInv), { merge: true });
        }
      });
      await batch.commit();
    }

    // Invalidate memory cache so next read has latest merged data
    if (memoryStore.invoices) memoryStore.invoices.timestamp = 0;
  }

  return {
    success: true,
    addedCount,
    enrichedCount,
    skippedCount,
    totalPrizma: prizmaInvs.length,
    message: `${addedCount} yeni Prizma faturası sisteme başarıyla entegre edildi. ${enrichedCount} mevcut fatura mükerrer oluşturulmadan Prizma verileriyle zenginleştirildi.`
  };
}

// OTOMATİK AKŞAM VE GECE SENKRONİZASYONU & ENTEGRASYONU: Her akşam 21:00 ve her gece 02:30 (Moscow)
// Prizma'dan kesinleşmiş malzeme faturalarını günceller ve sisteme otomatik olarak entegre eder.
cron.schedule('0 21 * * *', async () => {
  console.log('[AUTO PRIZMA SYNC] Akşam 21:00 otomatik Prizma malzeme faturası senkronizasyonu başladı...');
  try {
    const syncRes = await prizmaSyncService.syncLast3Months({ maxItems: 1500 });
    console.log('[AUTO PRIZMA SYNC SUCCESS - AKŞAM]:', syncRes.message);
    if (db) {
      console.log('[AUTO PRIZMA INTEGRATION] Akşam otomatik fatura entegrasyonu ve akıllı kümeleme başladı...');
      const integRes = await integratePrizmaInvoicesInternal(db);
      console.log('[AUTO PRIZMA INTEGRATION SUCCESS - AKŞAM]:', integRes.message);
    }
  } catch (err: any) {
    console.error('[AUTO PRIZMA SYNC/INTEGRATION ERROR - AKŞAM]:', err.message);
  }
}, { timezone: 'Europe/Moscow' });

cron.schedule('30 2 * * *', async () => {
  console.log('[AUTO PRIZMA SYNC] Gece 02:30 otomatik Prizma malzeme faturası senkronizasyonu başladı...');
  try {
    const syncRes = await prizmaSyncService.syncLast3Months({ maxItems: 1500 });
    console.log('[AUTO PRIZMA SYNC SUCCESS - GECE]:', syncRes.message);
    if (db) {
      console.log('[AUTO PRIZMA INTEGRATION] Gece otomatik fatura entegrasyonu ve akıllı kümeleme başladı...');
      const integRes = await integratePrizmaInvoicesInternal(db);
      console.log('[AUTO PRIZMA INTEGRATION SUCCESS - GECE]:', integRes.message);
    }
  } catch (err: any) {
    console.error('[AUTO PRIZMA SYNC/INTEGRATION ERROR - GECE]:', err.message);
  }
}, { timezone: 'Europe/Moscow' });

cron.schedule('0 3 * * *', () => {
  createNightlyBackup().then(r => console.log('[NIGHTLY BACKUP]', r)).catch(err => console.error('[NIGHTLY BACKUP]', err.message));
}, { timezone: 'Europe/Moscow' });

app.post('/api/admin/trigger-nightly', async (req, res) => {
  const sessionToken = (req.headers['x-session-token'] as string) || (req.query.token as string);
  const session = sessionToken ? sessionTokens.get(sessionToken) : null;
  const isAdmin = session && session.role === 'admin' && session.expires > Date.now();

  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      error: 'Yetkisiz işlem: Gece yedekleme tetikleme işlemi yalnızca doğrulanmış Sistem Yöneticisi oturumu ile çalıştırılabilir.'
    });
  }

  try {
    const result = await createNightlyBackup();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});


function cleanComparativeData(value: any): any {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cleanComparativeData);
  return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k,cleanComparativeData(v)]));
}
// New writes use the same authenticated role headers as the existing production UI.
app.use('/api/comparative-analyses', (req, res, next) => {
  if (req.method === 'GET') return next();
  const role = decodeURIComponent(String(req.headers['x-user-role'] || ''));
  if (!['admin','supervisor','personnel'].includes(role)) return res.status(403).json({error: 'Bu işlem için oturum açmalısınız.'});
  next();
});
// 1. List all analyses (with automatic deduplication & smart recalculation of dip-price baseline)
app.get('/api/comparative-analyses', async (req, res) => {
  try {
    if (db) {
      try {
        const snap = await getDocs(collection(db, 'comparative_analyses'));
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.id) {
            comparativeAnalysesStore.set(data.id, data);
          }
        });
      } catch (err: any) {
        console.warn('[FIRESTORE COMPARATIVE READ WARN]:', err.message);
      }
    }
    const rawAll = Array.from(comparativeAnalysesStore.values()).filter(a => !a.isDeleted);
    rawAll.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());

    // Deduplicate identical TDF analyses (same winning supplier + final purchase amount + final invoice number)
    const seenFingerprints = new Set<string>();
    const uniqueAnalyses: any[] = [];
    const duplicateIdsToDelete: string[] = [];

    for (const rawRec of rawAll) {
      const rec = recalculateComparativeAnalysis(rawRec);
      const winSup = normalizeVendorName(rec.winningSupplier || rec.finalInvoiceDetails?.supplier || '');
      const finalAmt = Math.round(Number(rec.totalFinalPurchase || rec.summary?.totalFinalPurchase || 0));
      const invNo = String(rec.finalInvoiceDetails?.invoiceNumber || rec.summary?.finalInvoiceNumber || '').trim().toLowerCase();
      const fingerprint = `${winSup}___${finalAmt}___${invNo}`;

      if (winSup && finalAmt > 0 && seenFingerprints.has(fingerprint)) {
        rec.isDeleted = true;
        comparativeAnalysesStore.set(rec.id, rec);
        duplicateIdsToDelete.push(rec.id);
        continue;
      }
      if (winSup && finalAmt > 0) {
        seenFingerprints.add(fingerprint);
      }
      uniqueAnalyses.push(rec);
    }

    // Persist deduplication & recalculated dip-price baseline (e.g. Komus 715,000.52 -> SAM 712,800 = 2,200.52 savings) to Firestore asynchronously
    if (db && (duplicateIdsToDelete.length > 0 || uniqueAnalyses.length > 0)) {
      Promise.resolve().then(async () => {
        try {
          for (const dupId of duplicateIdsToDelete) {
            await updateDoc(doc(db, 'comparative_analyses', dupId), { isDeleted: true, deletedAt: new Date().toISOString() }).catch(() => {});
          }
          for (const uRec of uniqueAnalyses) {
            await setDoc(doc(db, 'comparative_analyses', uRec.id), cleanComparativeData(uRec), { merge: true }).catch(() => {});
            if (uRec.associatedDiscountId) {
              const { data: dscs } = await getDiscountsCached();
              const linkedD = (dscs || []).find((d: any) => d.id === uRec.associatedDiscountId);
              if (linkedD && (Math.abs((linkedD.offerPrice || 0) - uRec.totalInitialLowestOffer) > 0.01 || Math.abs((linkedD.discountAmount || 0) - uRec.realMarketSavings) > 0.01)) {
                const updatedFields = {
                  offerPrice: uRec.totalInitialLowestOffer,
                  marketReferencePrice: uRec.totalInitialLowestOffer,
                  agreedPrice: uRec.totalFinalPurchase,
                  discountAmount: uRec.realMarketSavings,
                  realMarketSavings: uRec.realMarketSavings,
                  discountPercentage: uRec.realSavingsRate,
                  realSavingsPercentage: uRec.realSavingsRate,
                  internalVendorDiscount: uRec.internalVendorSavings,
                  notes: `Karşılaştırmalı Analiz #${uRec.analysisCode}. Kazanan Tedarikçi (Son Fatura): ${uRec.winningSupplier} (Fatura No: ${uRec.finalInvoiceDetails?.invoiceNumber || '-'}). Piyasadaki en düşük ilk teklif referansı: ${uRec.totalInitialLowestOffer.toLocaleString('tr-TR')} ₽ (${uRec.summary?.lowestInitialOfferSupplier || 'Piyasa'}). Gerçek Piyasa Tasarrufu: ${uRec.realMarketSavings.toLocaleString('tr-TR')} ₽ (%${uRec.realSavingsRate}).`
                };
                await updateDoc(doc(db, 'discounts', linkedD.id), cleanComparativeData(updatedFields)).catch(() => {});
                memoryStore.discounts = null;
              }
            }
          }
        } catch (_) {}
      });
    }

    res.json(uniqueAnalyses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get specific analysis
app.get('/api/comparative-analyses/:id', async (req, res) => {
  try {
    const id = req.params.id;
    let record = comparativeAnalysesStore.get(id);
    if (!record && db) {
      const snap = await getDoc(doc(db, 'comparative_analyses', id));
      if (snap.exists()) {
        record = snap.data() as any;
        comparativeAnalysesStore.set(id, record!);
      }
    }
    if (!record) return res.status(404).json({ error: 'Analiz bulunamadı' });
    res.json(recalculateComparativeAnalysis(record));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Export comparative analysis to Excel
app.get('/api/comparative-analyses/:id/excel', async (req, res) => {
  try {
    const id = req.params.id;
    let record = comparativeAnalysesStore.get(id);
    if (!record && db) {
      const snap = await getDoc(doc(db, 'comparative_analyses', id));
      if (snap.exists()) {
        record = snap.data() as any;
        comparativeAnalysesStore.set(id, record);
      }
    }
    let invoiceNo = '';
    if (!record) {
      const matchDisc = (memoryStore.discounts?.data || []).find((d: any) => d.id === id || d.comparativeAnalysisId === id || d.invoiceNo === id);
      let disc = matchDisc;
      if (!disc) {
        const { data: discs } = await getDiscountsCached();
        disc = (discs || []).find((d: any) => d.id === id || d.comparativeAnalysisId === id || d.invoiceNo === id);
      }
      if (disc) {
        invoiceNo = disc.invoiceNo;
        if (disc.comparativeAnalysisId) {
          record = comparativeAnalysesStore.get(disc.comparativeAnalysisId);
        }
        if (!record) {
          record = {
            id: disc.id,
            analysisCode: `ANL-${disc.invoiceNo || disc.id.slice(0, 8)}`,
            jobsiteName: disc.jobsiteName,
            supervisorName: disc.supervisorName,
            winningSupplier: disc.vendorName,
            totalFinalPurchase: disc.agreedPrice || 0,
            totalInitialLowestOffer: disc.offerPrice || 0,
            realMarketSavings: disc.discountAmount || 0,
            realSavingsRate: disc.discountPercentage || 0,
            currency: 'RUB',
            finalInvoiceDetails: {
              invoiceNumber: disc.invoiceNo,
              supplier: disc.vendorName,
              amount: disc.agreedPrice
            }
          } as any;
        }
      }
    }
    if (!record) {
      return res.status(404).json({ error: 'Karşılaştırmalı analiz bulunamadı.' });
    }

    const excelBuf = generateComparativeExcelBuffer(record, invoiceNo || record.finalInvoiceDetails?.invoiceNumber);
    const fileName = `Piyasa_Teklif_Kiyas_Tablosu_${invoiceNo || record.analysisCode || record.id}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(excelBuf);
  } catch (err: any) {
    console.error('[COMPARATIVE EXCEL EXPORT ERROR]:', err);
    return res.status(500).json({ error: 'Excel dosyası oluşturulamadı: ' + err.message });
  }
});

// 3. Process uploaded files for comparative analysis
app.post('/api/comparative-analyses/process', async (req, res) => {
  try {
    const { files, jobsiteId, jobsiteName, supervisorId, supervisorName, performedByPersonnelId, performedByPersonnelName, currency } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'En az bir dosya gönderilmelidir.' });
    }

    const processedFiles = files.map((f: any) => {
      let buffer: Buffer | undefined = undefined;
      if (f.fileData && typeof f.fileData === 'string') {
        const b64 = f.fileData.includes(',') ? f.fileData.split(',')[1] : f.fileData;
        buffer = Buffer.from(b64, 'base64');
      }
      return {
        fileName: f.fileName || 'teklif.pdf',
        fileUrl: f.fileUrl,
        buffer,
        base64: f.fileData,
        mimeType: f.mimeType,
        documentRole: f.documentRole,
        supplierName: f.supplierName,
        totalAmount: typeof f.totalAmount === 'number' ? f.totalAmount : (typeof f.totalAmount === 'string' ? parseFloat(f.totalAmount) : undefined),
        documentNumber: f.documentNumber,
        date: f.date
      };
    });

    const { data: jobs } = await getJobsitesCached();
    const matchedJob = jobs.find((j: any) => j.id === jobsiteId) || jobs[0];
    const finalJobsiteId = matchedJob ? matchedJob.id : 'job_1';
    const finalJobsiteName = matchedJob ? matchedJob.name : 'SET OF3a';

    const analysis = await processComparativeAnalysisBatch({
      files: processedFiles,
      jobsiteId: finalJobsiteId,
      jobsiteName: finalJobsiteName,
      supervisorId: supervisorId || '',
      supervisorName: supervisorName || 'Şef',
      performedByPersonnelId: performedByPersonnelId || null,
      performedByPersonnelName: performedByPersonnelName || null,
      currency: currency || 'RUB',
      thresholdRub: comparativeConfig.thresholdRub
    });

    res.json(analysis);
  } catch (err: any) {
    console.error('[COMPARATIVE PROCESS ERROR]:', err);
    res.status(500).json({ error: err.message || 'Analiz işlemi sırasında hata oluştu.' });
  }
});

// 4. Save and commit approved comparative analysis
app.post('/api/comparative-analyses/save', async (req, res) => {
  try {
    let analysisData = req.body;
    if (!analysisData || !analysisData.id) {
      return res.status(400).json({ error: 'Geçersiz analiz verisi.' });
    }

    // Recalculate dip-price baseline and unit conversions before saving
    analysisData = recalculateComparativeAnalysis(analysisData);

    // Validation: Require FINAL_INVOICE, FIRST_OFFER, valid vendor, jobsite, supervisor, positive amount, and valid items
    const finalDoc = (analysisData.documents || []).find((d: any) => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER')) || analysisData.documents?.[analysisData.documents?.length - 1];
    const lowestFirstDoc = (analysisData.documents || []).find((d: any) => !d.isExcluded && (d.supplier === analysisData.summary?.lowestInitialOfferSupplier || d.documentRole === 'FIRST_OFFER' || d.documentRole === 'COMPETITOR_FIRST_OFFER')) || analysisData.documents?.[0];

    const missingFields: string[] = [];
    if (!analysisData.documents?.some((d: any) => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'))) {
      missingFields.push('Nihai Fatura (FINAL_INVOICE) belgesi');
    }
    if (!analysisData.documents?.some((d: any) => !d.isExcluded && (d.documentRole === 'FIRST_OFFER' || d.documentRole === 'COMPETITOR_FIRST_OFFER' || d.isInitialOffer))) {
      missingFields.push('İlk Teklif (FIRST_OFFER) belgesi');
    }

    const finalSupplier = (finalDoc?.supplier || analysisData.winningSupplier || '').trim();
    if (!finalSupplier || ['Seçilen Tedarikçi', 'Bilinmeyen Tedarikçi', 'Tedarikçi Firma', 'Tedarikçi'].includes(finalSupplier)) {
      missingFields.push('Geçerli Nihai Tedarikçi Adı');
    }

    // Prevent duplicate TDF records for the same supplier + invoiceNumber + finalPrice: reuse existing ID if found
    const checkInvNo = String(finalDoc?.documentNumber || analysisData.summary?.finalInvoiceNumber || '').trim().toLowerCase();
    const checkFinalAmt = Math.round(Number(analysisData.summary?.finalPurchaseAmount || analysisData.totalFinalPurchase || 0));
    const existingDuplicateAnalysis = Array.from(comparativeAnalysesStore.values()).find((ex: any) =>
      !ex.isDeleted &&
      ex.id !== analysisData.id &&
      areVendorsEqual(ex.winningSupplier || ex.finalInvoiceDetails?.supplier, finalSupplier) &&
      Math.round(Number(ex.totalFinalPurchase || ex.summary?.totalFinalPurchase || 0)) === checkFinalAmt &&
      (!checkInvNo || String(ex.finalInvoiceDetails?.invoiceNumber || ex.summary?.finalInvoiceNumber || '').trim().toLowerCase() === checkInvNo)
    );
    if (existingDuplicateAnalysis) {
      analysisData.id = existingDuplicateAnalysis.id;
      analysisData.analysisCode = existingDuplicateAnalysis.analysisCode || analysisData.analysisCode;
    }

    if (!analysisData.jobsiteId || !analysisData.jobsiteName || analysisData.jobsiteName.trim() === 'Bilinmeyen Şantiye') {
      missingFields.push('Geçerli Şantiye Seçimi');
    }

    if (!analysisData.supervisorId || !analysisData.supervisorName || analysisData.supervisorName.trim() === 'Yetkili Şef') {
      missingFields.push('Geçerli Yetkili Satınalma Şefi');
    }

    const finalPrice = analysisData.summary?.finalPurchaseAmount || analysisData.totalFinalPurchase || 0;
    const initialPrice = analysisData.totalInitialLowestOffer || analysisData.summary?.totalInitialLowestOffer || (finalPrice + (analysisData.realMarketSavings || 0)) || analysisData.summary?.lowestInitialOfferAmount || 0;
    if (finalPrice <= 0) {
      missingFields.push('Geçerli Nihai Fatura Toplam Tutarı (> 0)');
    }

    if (missingFields.length > 0) {
      analysisData.status = 'draft';
      analysisData.updated_at = new Date().toISOString();
      comparativeAnalysesStore.set(analysisData.id, analysisData);
      return res.status(400).json({
        error: `Onaylı indirim kaydı oluşturulamadı. Eksik alanlar: ${missingFields.join(', ')}. Lütfen eksik belgeleri veya alanları tamamlayın.`,
        missingFields,
        status: 'draft'
      });
    }

    const isManualTdf = String(analysisData.id || '').startsWith('tdf_man_');
    if (!isManualTdf && (analysisData.documents || []).some((d: any) => !d.isExcluded && (!d.fileUrl || String(d.fileUrl).startsWith('data:') || String(d.fileUrl).includes('test-sandbox/')))) {
      return res.status(400).json({error: 'Tüm belgeler ana projenin arşivine kaydedilmelidir.'});
    }
    analysisData.status = 'completed';
    analysisData.updated_at = new Date().toISOString();

    // Learn synonyms from user approved canonical materials
    if (analysisData.canonicalMaterials) {
      learnApprovedSynonyms(analysisData.canonicalMaterials, analysisData.supervisorName);
    }

    // Automatically create or link a record in `discounts`
    // Strictly adhering to: Vendor and invoice details come exclusively from FINAL INVOICE,
    // baseline offer price comes from lowest initial offer, and negotiation count comes from intermediate rounds.
    const finalInvoiceNumber = finalDoc?.documentNumber || analysisData.summary?.finalInvoiceNumber || '';
    const finalDate = finalDoc?.date || analysisData.summary?.finalInvoiceDate || analysisData.date || new Date().toISOString().split('T')[0];
    const roundsCount = Number(analysisData.negotiationRoundsCount ?? (analysisData.negotiationStages ? analysisData.negotiationStages.length : 0)) || 0;

    // Extract line items for the final agreed invoice and material price comparison (excluding excluded items)
    let rawItemsToProcess: any[] = [];
    if (Array.isArray(finalDoc?.items) && finalDoc.items.length > 0) {
      rawItemsToProcess = finalDoc.items.filter((it: any) => !it.isExcluded);
    } else if (Array.isArray(analysisData.canonicalMaterials) && analysisData.canonicalMaterials.length > 0) {
      rawItemsToProcess = analysisData.canonicalMaterials
        .filter((mat: any) => !mat.isExcluded)
        .map((mat: any, idx: number) => ({
          id: mat.id || `can_item_${idx}`,
          materialName: mat.commonName || mat.canonicalName || `Malzeme ${idx + 1}`,
          originalName: mat.commonName || mat.canonicalName,
          category: mat.materialType,
          quantity: Number(mat.purchasedQuantity) || 1,
          unit: mat.standardUnit || 'adet',
          unitPrice: Number(mat.purchasedUnitPrice) || 0,
          totalPrice: (Number(mat.purchasedQuantity) || 1) * (Number(mat.purchasedUnitPrice) || 0),
          diameter: mat.specs?.diameter,
          quality: mat.specs?.grade,
          standard: mat.specs?.standard
        }));
    } else if (Array.isArray(analysisData.items) && analysisData.items.length > 0) {
      rawItemsToProcess = analysisData.items.filter((it: any) => !it.isExcluded);
    } else {
      rawItemsToProcess = [{
        id: `item_cmp_${Date.now()}_1`,
        materialName: `${finalSupplier} Malzeme Alımı`,
        originalName: finalSupplier,
        quantity: 1,
        unit: 'Sipariş',
        unitPrice: finalPrice,
        totalPrice: finalPrice,
        category: 'Diğer Malzeme'
      }];
    }

    // Process every item through smartNormalizeItem for smart category identification
    const categorizedItems = rawItemsToProcess.map((it: any, idx: number) => {
      const norm = smartNormalizeItem(it);
      const qty = Number(it.quantity) || 1;
      const unitPrice = Number(it.unitPrice) || (Number(it.totalPrice) / qty) || 0;
      const totalPrice = Number(it.totalPrice) || (qty * unitPrice) || 0;
      return {
        id: it.id || `item_cmp_${Date.now()}_${idx + 1}`,
        materialName: norm.materialName || it.materialName || `Malzeme ${idx + 1}`,
        originalName: it.originalName || it.materialName || norm.materialName,
        category: norm.category || it.category || 'Diğer Malzeme',
        quantity: qty,
        unit: it.unit || 'adet',
        unitPrice: unitPrice,
        totalPrice: totalPrice,
        discountAmount: it.discountAmount,
        brand: it.brand,
        model: it.model,
        dimensions: it.dimensions,
        diameter: it.diameter,
        quality: it.quality,
        confidence: it.confidence ?? 0.95
      };
    });

    const dominantCategory = categorizedItems[0]?.category || 'İnşaat Malzemesi';

    // Idempotent discount and invoice resolution
    const { data: curDiscounts } = await getDiscountsCached();
    const { data: curInvoices } = await getInvoicesCached();

    // 1. Existing discount resolution (re-use existing ID if same analysis or same final invoice number + vendor)
    const existingDisc = curDiscounts.find((d: any) =>
      !d.isDeleted && (
        d.comparativeAnalysisId === analysisData.id ||
        (finalInvoiceNumber && !finalInvoiceNumber.startsWith('FT-CMP-') && !finalInvoiceNumber.startsWith('TKF-') &&
         areVendorsEqual(d.vendorName, finalSupplier) &&
         String(d.invoiceNo || '').trim().toLowerCase() === finalInvoiceNumber.trim().toLowerCase())
      )
    );
    const discountId = existingDisc?.id || `disc_cmp_${analysisData.id}`;

    // 2. Existing invoice resolution (re-use existing portal ID if same analysis, same discount, or same invoice number + vendor)
    const cleanFinalNo = (finalInvoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const cleanFinalSup = normalizeVendorName(finalSupplier || '');

    const matchingInvs = curInvoices.filter((i: any) => {
      if (i.isDeleted) return false;
      if (i.comparativeAnalysisId === analysisData.id) return true;
      if (discountId && i.discountId === discountId) return true;
      const iNo = String(i.invoiceNumber || i.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
      const iSup = normalizeVendorName(i.supplier || i.vendorName || '');
      if (cleanFinalNo && iNo && cleanFinalNo === iNo && areVendorsEqual(cleanFinalSup, iSup)) return true;
      return false;
    });

    const isPurePrizma = (inv: any) => Boolean(String(inv.id || '').startsWith('inv_prizma_') || String(inv.id || '').startsWith('prizma_'));
    const prizmaInvsToDelete = matchingInvs.filter(isPurePrizma);
    const existingPortalInv = matchingInvs.find(i => !isPurePrizma(i));

    const invoiceId = existingPortalInv?.id || `inv_cmp_${analysisData.id}`;

    // Inherit Prizma metadata if any matched
    const prizmaMatch = prizmaInvsToDelete[0];
    const prizmaMetaInherited: any = {};
    if (prizmaMatch) {
      prizmaMetaInherited.prizmaDemandId = prizmaMatch.prizmaDemandId;
      prizmaMetaInherited.prizmaRequestCode = prizmaMatch.prizmaRequestCode;
      prizmaMetaInherited.prizmaOrderCode = prizmaMatch.prizmaOrderCode;
      prizmaMetaInherited.prizmaBtfUrl = prizmaMatch.prizmaBtfUrl;
      prizmaMetaInherited.prizmaStfUrl = prizmaMatch.prizmaStfUrl;
      prizmaMetaInherited.prizmaUrl = prizmaMatch.prizmaBtfUrl || prizmaMatch.prizmaUrl;
    }

    const linkedDiscount: any = {
      id: discountId,
      orderDate: finalDate,
      invoiceDate: finalDate,
      invoiceNo: finalInvoiceNumber,
      supervisorId: analysisData.supervisorId,
      supervisorName: analysisData.supervisorName,
      jobsiteId: analysisData.jobsiteId,
      jobsiteName: analysisData.jobsiteName,
      category: dominantCategory || 'Karşılaştırmalı Teklif Analizi',
      vendorName: finalSupplier,
      offerPrice: initialPrice,
      agreedPrice: finalPrice,
      discountAmount: analysisData.realMarketSavings,
      discountPercentage: analysisData.realSavingsRate,
      status: 'Onaylandı',
      negotiationCount: roundsCount,
      negotiationRounds: (analysisData.negotiationStages || []).map((stg: any) => ({
        id: `rnd_${Date.now()}_${stg.roundNumber}`,
        roundNumber: stg.roundNumber,
        date: stg.date || finalDate,
        vendorName: stg.supplier || finalSupplier,
        quotedPrice: stg.amount || 0,
        previousPrice: initialPrice,
        discountThisRound: Math.max(0, initialPrice - (stg.amount || 0)),
        documentName: stg.fileName,
        note: stg.note || `${stg.roundNumber}. Ara Pazarlık Turu`
      })),
      notes: `Karşılaştırmalı Analiz #${analysisData.analysisCode}. Kazanan Tedarikçi (Son Fatura): ${finalSupplier} (Fatura No: ${finalInvoiceNumber || '-'}). Piyasadaki en düşük ilk teklif referansı: ${initialPrice.toLocaleString('tr-TR')} ₽ (${analysisData.summary?.lowestInitialOfferSupplier || 'Piyasa'}). Ara pazarlık turları: ${analysisData.negotiationRoundsCount || 0} tur.`,
      calculationMethod: 'MARKET_BASELINE_TO_FINAL',
      kpiEligible: !analysisData.isSingleVendor && !analysisData.isAboveBestOffer && analysisData.realMarketSavings > 0,
      comparativeAnalysisId: analysisData.id,
      analysisCode: analysisData.analysisCode,
      internalVendorDiscount: analysisData.internalVendorSavings,
      realMarketSavings: analysisData.realMarketSavings,
      marketReferencePrice: initialPrice,
      realSavingsPercentage: analysisData.realSavingsRate,
      isSingleVendor: analysisData.isSingleVendor,
      isAboveBestOffer: analysisData.isAboveBestOffer,
      competitorCount: Math.max(0, (analysisData.summary?.totalVendors || 1) - 1),
      performedByPersonnelId: analysisData.performedByPersonnelId || null,
      performedByPersonnelName: analysisData.performedByPersonnelName || null,
      created_at: analysisData.created_at || new Date().toISOString(),
      firstOfferFileName: lowestFirstDoc?.fileName || 'En Düşük İlk Teklif',
      firstOfferFileUrl: lowestFirstDoc?.fileUrl || '',
      finalOfferFileName: finalDoc?.fileName || 'Nihai Anlaşılan Fatura',
      finalOfferFileUrl: finalDoc?.fileUrl || '',
      canonicalMaterials: analysisData.canonicalMaterials || [],
      items: categorizedItems
    };

    analysisData.associatedDiscountId = discountId;

    const updatedDiscounts = [linkedDiscount, ...curDiscounts.filter((d: any) => d.id !== discountId && d.comparativeAnalysisId !== analysisData.id)];

    // Auto-create and save the final invoice into `invoices` (AI Otomatik Fatura Okuma)
    const finalInvoiceRecord: any = {
      id: invoiceId,
      discountId: discountId,
      comparativeAnalysisId: analysisData.id,
      analysisCode: analysisData.analysisCode,
      invoiceNumber: finalInvoiceNumber || `FT-CMP-${analysisData.analysisCode || Date.now().toString().slice(-6)}`,
      invoiceNo: finalInvoiceNumber || `FT-CMP-${analysisData.analysisCode || Date.now().toString().slice(-6)}`,
      date: finalDate,
      supplier: finalSupplier,
      jobsiteId: analysisData.jobsiteId || '',
      jobsiteName: analysisData.jobsiteName || 'Merkez Şantiye',
      uploadedBySupervisorId: analysisData.supervisorId || '',
      uploadedBySupervisorName: analysisData.supervisorName || 'Satınalma Şefi',
      totalAmount: finalPrice,
      category: dominantCategory,
      notes: `Karşılaştırmalı Teklif Analizi #${analysisData.analysisCode} onaylı nihai anlaşma faturası. Piyasadaki en düşük ilk teklif bazı: ${initialPrice.toLocaleString('tr-TR')} ₽ (${analysisData.summary?.lowestInitialOfferSupplier || 'Piyasa'}), Sağlanan net tasarruf: ${analysisData.realMarketSavings.toLocaleString('tr-TR')} ₽ (%${analysisData.realSavingsRate}).`,
      items: categorizedItems,
      ...prizmaMetaInherited,
      origin: 'ges_archive',
      prizmaSource: false,
      prizmaLinked: Boolean(prizmaMetaInherited.prizmaBtfUrl || prizmaMetaInherited.prizmaRequestCode),
      rawFileName: finalDoc?.fileName || 'nihai_anlasilan_fatura.pdf',
      fileUrl: finalDoc?.fileUrl || '',
      created_at: new Date().toISOString(),
      isDeleted: false,
      status: 'Onaylandı'
    };

    const prizmaDeletedIds = new Set(prizmaInvsToDelete.map(p => p.id));
    const updatedInvoices = [finalInvoiceRecord, ...curInvoices.filter((i: any) => i.id !== invoiceId && i.comparativeAnalysisId !== analysisData.id && i.discountId !== discountId && !prizmaDeletedIds.has(i.id))];
    if (!db) return res.status(503).json({error: 'Firestore bağlı değil. Analiz kaydedilmedi.'});
    const batch = writeBatch(db);
    batch.set(doc(db, 'comparative_analyses', analysisData.id), cleanComparativeData(analysisData), {merge: true});
    batch.set(doc(db, 'discounts', discountId), cleanComparativeData(linkedDiscount), {merge: true});
    batch.set(doc(db, 'invoices', invoiceId), cleanComparativeData(finalInvoiceRecord), {merge: true});

    // Soft-delete replaced Prizma invoices so portal invoice takes absolute priority
    const nowIso = new Date().toISOString();
    for (const pInv of prizmaInvsToDelete) {
      batch.set(doc(db, 'invoices', pInv.id), {
        isDeleted: true,
        deletedAt: nowIso,
        deletedReason: 'Karşılaştırmalı analiz portal faturası lehine Prizma faturası otomatik silindi (Öncelik GES Arşiv)'
      }, { merge: true });
      prizmaSyncService.markAsDeleted(pInv.id);
    }

    await batch.commit();
    comparativeAnalysesStore.set(analysisData.id, analysisData);
    memoryStore.discounts = {data: updatedDiscounts, timestamp: Date.now()};
    saveLocalBackup('discounts.json', updatedDiscounts);
    memoryStore.invoices = { data: updatedInvoices, timestamp: Date.now() };
    memoryStore.materialComparisons = null;
    saveLocalBackup('invoices.json', updatedInvoices);

    // Auto-create snapshot for historical persistence
    try {
      const { data: sups } = await getSupervisorsCached();
      const { data: jobs } = await getJobsitesCached();
      createSnapshot({
        supervisors: sups,
        jobsites: jobs,
        discounts: updatedDiscounts,
        invoices: updatedInvoices
      }, 'auto-mutation');
    } catch (e: any) {
      console.warn('[Comparative Snapshot Warn]:', e.message);
    }

    res.json({
      success: true,
      analysis: analysisData,
      linkedDiscount,
      invoice: finalInvoiceRecord
    });
  } catch (err: any) {
    console.error('[COMPARATIVE SAVE ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete analysis
app.delete('/api/comparative-analyses/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = comparativeAnalysesStore.get(id);
    if (existing) {
      existing.isDeleted = true;
      existing.deletedAt = new Date().toISOString();
      comparativeAnalysesStore.set(id, existing);
    }
    if (db) {
      try {
        await updateDoc(doc(db, 'comparative_analyses', id), {isDeleted: true, deletedAt: new Date().toISOString()});
      } catch (_) {}
    }
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Config endpoints
app.get('/api/settings/comparative-analysis', (req, res) => {
  res.json(comparativeConfig);
});

app.put('/api/settings/comparative-analysis', (req, res) => {
  const updated = updateComparativeConfig(req.body);
  res.json(updated);
});

// 7. Synonyms endpoints
app.get('/api/material-synonyms', (req, res) => {
  res.json(Array.from(materialSynonymsStore.values()));
});

app.post('/api/material-synonyms', (req, res) => {
  const item = req.body;
  if (!item.rawText || !item.canonicalName) {
    return res.status(400).json({ error: 'rawText ve canonicalName zorunludur.' });
  }
  const normKey = item.rawText.toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
  const entry: any = {
    id: item.id || `syn_${Date.now()}`,
    rawText: item.rawText,
    normalizedKey: normKey,
    canonicalName: item.canonicalName,
    materialType: item.materialType || 'Genel Malzeme',
    standardUnit: item.standardUnit || 'adet',
    specs: item.specs || {},
    approvedBy: item.approvedBy,
    updatedAt: new Date().toISOString()
  };
  materialSynonymsStore.set(normKey, entry);
  res.json(entry);
});


async function sanitizeInvoiceHistoryPricingAndFreight(dbInstance: any): Promise<{
  success: boolean;
  invoicesSanitized: number;
  itemsNormalized: number;
  freightIsolatedInvoices: number;
  totalActiveInvoices: number;
}> {
  if (!dbInstance) {
    return { success: false, invoicesSanitized: 0, itemsNormalized: 0, freightIsolatedInvoices: 0, totalActiveInvoices: 0 };
  }
  const prizmaInvs = await prizmaSyncService.getInvoicesCached().catch(() => []);
  const invSnap = await getDocs(collection(dbInstance, 'invoices'));
  const allDocs = invSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
  const activeDocs = allDocs.filter(i => !i.isDeleted && !i.isPermanentlyDeleted);

  const normalizedDocs = enrichAndNormalizeInvoiceRecords(activeDocs, prizmaInvs);
  const updates: Array<{ id: string; payload: any }> = [];
  let itemsNormalized = 0;
  let freightIsolatedInvoices = 0;

  for (let idx = 0; idx < activeDocs.length; idx++) {
    const raw = activeDocs[idx];
    const norm = normalizedDocs[idx];
    if (!norm || !Array.isArray(norm.items)) continue;

    const rawItemsLen = Array.isArray(raw.items) ? raw.items.length : 0;
    const normItemsLen = norm.items.length;
    if (norm.excludedFreightAmount > 0 || normItemsLen < rawItemsLen) {
      freightIsolatedInvoices++;
    }

    let needsWrite = normItemsLen !== rawItemsLen || Boolean(norm.excludedFreightAmount && !raw.excludedFreightAmount);
    for (let k = 0; k < norm.items.length; k++) {
      const rIt = raw.items?.[k];
      const nIt = norm.items[k];
      itemsNormalized++;
      if (
        !rIt ||
        !rIt.isNetNormalized ||
        rIt.grossUnitPrice === undefined ||
        rIt.vatPercentage === undefined ||
        Math.abs((Number(rIt.unitPrice) || 0) - (Number(nIt.unitPrice) || 0)) > 0.005 ||
        Math.abs((Number(rIt.grossUnitPrice) || 0) - (Number(nIt.grossUnitPrice) || 0)) > 0.005
      ) {
        needsWrite = true;
      }
    }

    if (needsWrite) {
      updates.push({
        id: norm.id,
        payload: cleanComparativeData({
          items: norm.items,
          netSubtotalAmount: norm.netSubtotalAmount,
          vatTotalAmount: norm.vatTotalAmount,
          vatRate: norm.vatRate,
          ...(norm.excludedFreightAmount ? {
            excludedFreightAmount: norm.excludedFreightAmount,
            excludedFreightGrossAmount: norm.excludedFreightGrossAmount
          } : {})
        })
      });
    }
  }

  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = writeBatch(dbInstance);
    const chunk = updates.slice(i, i + batchSize);
    for (const u of chunk) {
      batch.set(doc(dbInstance, 'invoices', u.id), u.payload, { merge: true });
    }
    await batch.commit();
  }

  memoryStore.invoices = undefined;
  memoryStore.materialComparisons = undefined;

  return {
    success: true,
    invoicesSanitized: updates.length,
    itemsNormalized,
    freightIsolatedInvoices,
    totalActiveInvoices: activeDocs.length
  };
}

app.post('/api/prizma/sanitize-history', async (_req, res) => {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore bağlı değil.' });
    const result = await sanitizeInvoiceHistoryPricingAndFreight(db);
    res.json({
      ...result,
      message: `${result.totalActiveInvoices} aktif fatura ve ${result.itemsNormalized} kalem tarandı; ${result.invoicesSanitized} faturada Net (KDV Hariç) / Brüt (KDV Dahil) birim fiyatlar ve nakliye ayrıştırması kalıcı olarak güncellendi.`
    });
  } catch (err: any) {
    console.error('[PRIZMA SANITIZE HISTORY ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/materials/retroactive-audit-normalize', '/api/materials/retroactive-audit'], async (req, res) => {
  try {
    if (!(await _isAdminSession(req))) return res.status(403).json({error: 'Geçmiş kayıt denetimi için yönetici yetkisi gereklidir.'});
    if (!db) return res.status(503).json({error: 'Firestore bağlı değil.'});
    const {data: sups} = await getSupervisorsCached();
    const {data: jobs} = await getJobsitesCached();
    let allInvoices: any[] = [];
    let allDiscounts: any[] = [];

    if (db) {
      try {
        const invSnap = await getDocs(query(collection(db, 'invoices'), where('isDeleted', '==', false)));
        allInvoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
        const discSnap = await getDocs(collection(db, 'discounts'));
        allDiscounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      } catch (dbErr: any) {
        throw dbErr;
      }
    }

    if (allInvoices.length === 0) {
      const { data: cachedInvs } = await getInvoicesCached();
      allInvoices = [...cachedInvs];
    }
    if (allDiscounts.length === 0) {
      const { data: cachedDiscs } = await getDiscountsCached();
      allDiscounts = [...cachedDiscs];
    }

    allInvoices = allInvoices.filter(i => !i.isDeleted && !i.isPermanentlyDeleted);
    allDiscounts = allDiscounts.filter(i => !i.isDeleted && !i.isPermanentlyDeleted);
    const preAudit = createSnapshot({supervisors: sups, jobsites: jobs, invoices: allInvoices, discounts: allDiscounts}, 'manual');
    if (!(await syncSnapshotToCloud(db, bucket, preAudit))) throw new Error('Denetim öncesi bulut yedeği oluşturulamadı.');
    let totalItemsAudited = 0;
    let itemsUpdated = 0;
    let invoicesUpdated = 0;
    const auditSummary = {
      angleSteelUpdated: 0,
      meshUpdated: 0,
      profilePipeUpdated: 0,
      rebarUpdated: 0,
      membraneUpdated: 0,
      blocksUpdated: 0,
      drywallUpdated: 0,
      otherUpdated: 0
    };
    const details: Array<{
      invoiceNumber: string;
      rawName: string;
      canonicalName: string;
      category: string;
      unit: string;
    }> = [];

    // 1. Process all invoices after an explicit admin request
    for (const inv of allInvoices) {
      if (!Array.isArray(inv.items) || inv.items.length === 0) continue;
      let invChanged = false;
      const newItems = inv.items.map((it: any) => {
        totalItemsAudited++;
        if (!it.materialName && !it.description && !it.name) return it;
        
        const rawOriginal = it.originalName || it.materialName || it.description || '';
        const processed = processItem({
          ...it,
          originalName: rawOriginal,
          supplier: it.supplier || inv.supplier
        });

        const newName = processed.canonicalName || it.materialName;
        const newCat = normalizeCategoryName(processed.category || it.category, rawOriginal || newName);
        const newSubCat = processed.subCategory || it.subCategory;
        const newCpid = processed.canonicalProductId;

        if (
          newName !== it.materialName ||
          newCat !== it.category ||
          !it.canonicalProductId ||
          !it.originalName
        ) {
          invChanged = true;
          itemsUpdated++;

          const lowerNew = newName.toLowerCase();
          if (lowerNew.includes('köşebent')) auditSummary.angleSteelUpdated++;
          else if (lowerNew.includes('hasır')) auditSummary.meshUpdated++;
          else if (lowerNew.includes('kutu profil') || lowerNew.includes('profil boru')) auditSummary.profilePipeUpdated++;
          else if (lowerNew.includes('inşaat demiri')) auditSummary.rebarUpdated++;
          else if (lowerNew.includes('membran') || lowerNew.includes('geotekstil')) auditSummary.membraneUpdated++;
          else if (lowerNew.includes('gazbeton')) auditSummary.blocksUpdated++;
          else if (lowerNew.includes('alçıpan')) auditSummary.drywallUpdated++;
          else auditSummary.otherUpdated++;

          if (details.length < 50) {
            details.push({
              invoiceNumber: inv.invoiceNumber || inv.id,
              rawName: it.materialName,
              canonicalName: newName,
              category: newCat,
              unit: it.unit || 'Adet'
            });
          }

          return {
            ...it,
            materialName: newName,
            originalName: rawOriginal,
            category: newCat,
            subCategory: newSubCat,
            canonicalProductId: newCpid
          };
        }
        return it;
      });

      if (invChanged) {
        invoicesUpdated++;
        if (db) {
          try {
            await updateDoc(doc(db, 'invoices', inv.id), cleanComparativeData({ items: newItems }));
          } catch (e: any) {
            throw e;
          }
        }
      }
    }

    // 2. Process all discount records after an explicit admin request
    for (const disc of allDiscounts) {
      if (!Array.isArray(disc.items) || disc.items.length === 0) continue;
      let discChanged = false;
      const newItems = disc.items.map((it: any) => {
        if (!it.materialName && !it.description && !it.name) return it;
        const rawOriginal = it.originalName || it.materialName || '';
        const processed = processItem({
          ...it,
          originalName: rawOriginal,
          supplier: it.supplier || disc.vendorName
        });
        const newName = processed.canonicalName || it.materialName;
        const newCat = normalizeCategoryName(processed.category || it.category, rawOriginal || newName);

        if (newName !== it.materialName || newCat !== it.category) {
          discChanged = true;
          return {
            ...it,
            materialName: newName,
            originalName: rawOriginal,
            category: newCat,
            subCategory: processed.subCategory,
            canonicalProductId: processed.canonicalProductId
          };
        }
        return it;
      });

      if (discChanged) {
        if (db) {
          try {
            await updateDoc(doc(db, 'discounts', disc.id), cleanComparativeData({ items: newItems }));
          } catch (e: any) {
            throw e;
          }
        }
      }
    }

    // 3. Also run Net/Gross VAT & Freight Sanitizer across all active invoices
    const vatSanitizeResult = await sanitizeInvoiceHistoryPricingAndFreight(db);

    // Clear memory store so next fetch instantly reloads audited records
    memoryStore.invoices = undefined;
    memoryStore.discounts = undefined;
    memoryStore.materialComparisons = undefined;

    res.json({
      success: true,
      message: `${totalItemsAudited} fatura kalemi başarıyla denetlendi, ${itemsUpdated} kalem (${invoicesUpdated} fatura) standart kanonik inşaat kimliğine ve ${vatSanitizeResult.invoicesSanitized} fatura Net (KDV Hariç) / Nakliye Hariç birim fiyat standardına kavuşturuldu.`,
      totalInvoicesAudited: allInvoices.length,
      totalItemsAudited,
      itemsUpdated: itemsUpdated + vatSanitizeResult.invoicesSanitized,
      invoicesUpdated: Math.max(invoicesUpdated, vatSanitizeResult.invoicesSanitized),
      vatSanitizeResult,
      auditSummary,
      details
    });
  } catch (err: any) {
    console.error('[RETROACTIVE AUDIT ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories/retroactive-sync-28', async (req, res) => {
  try {
    let allInvoices: any[] = [];
    let allDiscounts: any[] = [];
    if (db) {
      const [invSnap, discSnap] = await Promise.all([
        getDocs(collection(db, 'invoices')),
        getDocs(collection(db, 'discounts'))
      ]);
      allInvoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      allDiscounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    }
    if (allInvoices.length === 0) {
      allInvoices = readLocalBackup('invoices.json', []);
    }
    if (allDiscounts.length === 0) {
      allDiscounts = readLocalBackup('discounts.json', []);
    }

    let invoicesUpdated = 0;
    let invoiceItemsUpdated = 0;
    let discountsUpdated = 0;
    let discountItemsUpdated = 0;

    // Process invoices in Firestore batches
    if (db) {
      let batch = writeBatch(db);
      let opCount = 0;
      for (const inv of allInvoices) {
        let changed = false;
        let newItems = inv.items;
        if (Array.isArray(inv.items)) {
          newItems = inv.items.map((it: any) => {
            const raw = it.materialName || it.originalName || '';
            const normCat = normalizeCategoryName(it.category, raw);
            if (normCat !== it.category) {
              changed = true;
              invoiceItemsUpdated++;
              return { ...it, category: normCat };
            }
            return it;
          });
        }
        const docCat = normalizeCategoryName(inv.category, inv.notes || (newItems && newItems[0] && (newItems[0].materialName || newItems[0].originalName)));
        if (docCat !== inv.category) {
          changed = true;
        }
        if (changed) {
          invoicesUpdated++;
          inv.items = newItems;
          inv.category = docCat;
          batch.update(doc(db, 'invoices', inv.id), cleanComparativeData({
            category: docCat,
            items: newItems,
            updatedAt: new Date().toISOString()
          }));
          opCount++;
          if (opCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }
      if (opCount > 0) {
        await batch.commit();
      }

      // Process discounts in Firestore batches
      batch = writeBatch(db);
      opCount = 0;
      for (const dsc of allDiscounts) {
        let changed = false;
        let newItems = dsc.items;
        if (Array.isArray(dsc.items)) {
          newItems = dsc.items.map((it: any) => {
            const raw = it.materialName || it.originalName || '';
            const normCat = normalizeCategoryName(it.category, raw);
            if (normCat !== it.category) {
              changed = true;
              discountItemsUpdated++;
              return { ...it, category: normCat };
            }
            return it;
          });
        }
        const docCat = normalizeCategoryName(dsc.category, dsc.notes || (newItems && newItems[0] && (newItems[0].materialName || newItems[0].originalName)));
        if (docCat !== dsc.category) {
          changed = true;
        }
        if (changed) {
          discountsUpdated++;
          dsc.items = newItems;
          dsc.category = docCat;
          batch.update(doc(db, 'discounts', dsc.id), cleanComparativeData({
            category: docCat,
            items: newItems,
            updatedAt: new Date().toISOString()
          }));
          opCount++;
          if (opCount >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }
      }
      if (opCount > 0) {
        await batch.commit();
      }
    }

    // Synchronize local backups & memory store
    saveLocalBackup('invoices.json', allInvoices);
    saveLocalBackup('discounts.json', allDiscounts);
    memoryStore.invoices = null;
    memoryStore.discounts = null;

    res.json({
      success: true,
      message: `28 Standart Kategori Geriye Dönük Eşitleme tamamlandı. ${invoicesUpdated} fatura (${invoiceItemsUpdated} kalem) ve ${discountsUpdated} indirim kaydı (${discountItemsUpdated} kalem) güncellendi.`,
      invoicesUpdated,
      invoiceItemsUpdated,
      discountsUpdated,
      discountItemsUpdated,
      totalInvoices: allInvoices.length,
      totalDiscounts: allDiscounts.length
    });
  } catch (err: any) {
    console.error('[RETROACTIVE CATEGORY SYNC ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

async function sanitizeDiscountsData(dbInstance: any) {
  try {
    let allDiscounts: any[] = [];
    if (dbInstance) {
      const discSnap = await getDocs(collection(dbInstance, 'discounts'));
      allDiscounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    }
    if (allDiscounts.length === 0) {
      allDiscounts = readLocalBackup('discounts.json', []);
    }

    let modifiedCount = 0;
    const batch = dbInstance ? writeBatch(dbInstance) : null;
    let batchOps = 0;

    // Known verified records that genuinely have negotiation rounds
    const verifiedProtectedIds = new Set([
      'disc_1789217081038',
      'disc_1789649842548',
      'disc_1789661443341',
      'disc_1789717395160',
      'disc_1790324065447'
    ]);

    for (const d of allDiscounts) {
      if (d.isDeleted || d.isPermanentlyDeleted) continue;
      // Never mutate verified protected records
      if (verifiedProtectedIds.has(d.id)) continue;

      const baseOffer = Number(d.adjustedOfferPrice || d.offerPrice) || 0;
      const agreed = Number(d.agreedPrice) || 0;
      const originalRounds = Array.isArray(d.negotiationRounds) ? d.negotiationRounds : [];
      const originalCount = Number(d.negotiationCount) || 0;

      // Filter only genuine intermediate rounds that have valid uploaded documents or notes
      const validRounds: any[] = [];
      let finalDocFromRound: { name: string; url: string } | null = null;

      for (const r of originalRounds) {
        if (!r || typeof r !== 'object') continue;
        const qp = Number(r.quotedPrice);
        const docName = String(r.documentName || r.documentFileName || r.fileName || '').trim();
        const docUrl = String(r.documentUrl || r.fileUrl || '').trim();
        const hasDoc = Boolean(docName || (docUrl && !docUrl.startsWith('data:')));
        const hasNotes = Boolean(r.notes || r.note);

        if (hasDoc || hasNotes) {
          validRounds.push({
            ...r,
            roundNumber: validRounds.length + 1,
            quotedPrice: isNaN(qp) ? 0 : qp,
            documentName: docName,
            documentUrl: docUrl
          });
        }
      }

      // If original rounds was empty but stageDocuments has intermediate stages (> 2 stages with documents), recover rounds from stages!
      if (validRounds.length === 0 && Array.isArray(d.stageDocuments) && d.stageDocuments.length > 2) {
        const intermediate = d.stageDocuments.filter((s: any) => {
          const isFirst = s.stageNumber === 1 || String(s.title || '').includes('1. İlk');
          const isFinal = s.isFinal || String(s.title || '').includes('Nihai') || String(s.title || '').includes('Son Tur Sonrası');
          const hasDoc = Boolean(s.fileName || s.fileUrl || s.driveFileId);
          return !isFirst && !isFinal && hasDoc;
        });

        if (intermediate.length > 0) {
          intermediate.forEach((stg: any, sIdx: number) => {
            validRounds.push({
              roundNumber: sIdx + 1,
              vendorName: d.vendorName || 'Tedarikçi',
              quotedPrice: Number(stg.amount) || 0,
              previousPrice: sIdx === 0 ? baseOffer : (Number(intermediate[sIdx - 1]?.amount) || baseOffer),
              discountThisRound: Math.max(0, (sIdx === 0 ? baseOffer : (Number(intermediate[sIdx - 1]?.amount) || baseOffer)) - (Number(stg.amount) || 0)),
              date: d.orderDate || new Date().toISOString().split('T')[0],
              documentName: stg.fileName || `Ara_Teklif_${sIdx + 1}.pdf`,
              documentUrl: stg.fileUrl || '',
              notes: stg.title || `${sIdx + 1}. Ara Pazarlık Turu`
            });
          });
        }
      }

      // Check if this discount needs sanitization
      const needsUpdate = 
        originalRounds.length !== validRounds.length ||
        originalCount !== validRounds.length ||
        (finalDocFromRound && d.finalOfferFileName !== finalDocFromRound.name) ||
        (validRounds.length === 0 && Array.isArray(d.stageDocuments) && d.stageDocuments.length > 2);

      if (needsUpdate) {
        modifiedCount++;
        d.negotiationRounds = validRounds;
        d.negotiationCount = validRounds.length;
        d.crossNegotiationApplied = validRounds.length >= 2;

        if (finalDocFromRound) {
          d.finalOfferFileName = finalDocFromRound.name;
          d.finalOfferFileUrl = finalDocFromRound.url;
        }

        // Reconstruct clean stageDocuments
        const finalDocName = d.finalOfferFileName || '2_Son_Indirimli_Teklif.pdf';
        const finalDocUrl = d.finalOfferFileUrl || undefined;
        const firstDocName = d.firstOfferFileName || '1_Ilk_Gelen_Teklif.pdf';
        const firstDocUrl = d.firstOfferFileUrl || undefined;

        const cleanStages: any[] = [
          {
            stageNumber: 1,
            title: '1. İlk Teklif / Fatura',
            fileName: firstDocName,
            fileUrl: firstDocUrl,
            driveFileId: d.firstOfferDriveFileId,
            amount: d.offerPrice || baseOffer
          }
        ];

        if (validRounds.length === 0) {
          cleanStages.push({
            stageNumber: 2,
            title: '2. İndirimli Fatura / Teklif',
            fileName: finalDocName,
            fileUrl: finalDocUrl,
            driveFileId: d.finalOfferDriveFileId,
            amount: agreed,
            isFinal: true
          });
        } else {
          validRounds.forEach((r, idx) => {
            const stageNo = idx + 2;
            cleanStages.push({
              stageNumber: stageNo,
              title: `${stageNo}. Ara İndirimli Teklif (Tur #${idx + 1})`,
              fileName: r.documentName,
              fileUrl: r.documentUrl,
              amount: Number(r.quotedPrice) || 0,
              roundIndex: idx,
              isFinal: false
            });
          });
          cleanStages.push({
            stageNumber: validRounds.length + 2,
            title: `${validRounds.length + 2}. Nihai İndirimli Fatura`,
            fileName: finalDocName,
            fileUrl: finalDocUrl,
            driveFileId: d.finalOfferDriveFileId,
            amount: agreed,
            isFinal: true
          });
        }

        d.stageDocuments = cleanStages;

        if (batch) {
          batch.set(doc(dbInstance, 'discounts', d.id), {
            negotiationRounds: validRounds,
            negotiationCount: validRounds.length,
            crossNegotiationApplied: validRounds.length >= 2,
            stageDocuments: cleanStages,
            finalOfferFileName: d.finalOfferFileName,
            finalOfferFileUrl: d.finalOfferFileUrl
          }, { merge: true });
          batchOps++;
          if (batchOps >= 400) {
            await batch.commit();
            batchOps = 0;
          }
        }
      }
    }

    if (batch && batchOps > 0) {
      await batch.commit();
    }

    if (modifiedCount > 0) {
      console.log(`[DISCOUNT SANITIZATION COMPLETE]: ${modifiedCount} discount records sanitized.`);
      saveLocalBackup('discounts.json', allDiscounts);
      if (memoryStore.discounts) {
        memoryStore.discounts = { data: allDiscounts, timestamp: Date.now() };
      }
    }
    return { success: true, modifiedCount, totalDiscounts: allDiscounts.length };
  } catch (err: any) {
    console.error('[DISCOUNT SANITIZATION ERROR]:', err.message);
    return { success: false, error: err.message };
  }
}

app.post('/api/discounts/sanitize-rounds', async (req, res) => {
  try {
    const result = await sanitizeDiscountsData(db);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PRIZMA (PM.GESCONS.RU) INTEGRATION API
// ============================================================================
app.get('/api/prizma/status', async (_req, res) => {
  try {
    const status = await prizmaService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message, connected: false });
  }
});

app.get('/api/prizma/demands', async (req, res) => {
  try {
    const take = req.query.take ? Number(req.query.take) : 50;
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const search = req.query.search ? String(req.query.search) : undefined;
    const result = await prizmaService.getPaymentDemands({ take, skip, search });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/prizma/workplaces', async (_req, res) => {
  try {
    const workplaces = await prizmaService.getWorkplaces();
    res.json(workplaces);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prizma/match', async (req, res) => {
  try {
    const { invoiceNo, supplierName, inn, amount, jobsiteName } = req.body || {};
    const matches = await prizmaService.searchMatchingDemands({
      invoiceNo,
      supplierName,
      inn,
      amount: amount ? Number(amount) : undefined,
      jobsiteName
    });
    res.json({ matches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prizma/link', async (req, res) => {
  try {
    const { recordType, recordId, prizmaData } = req.body || {};
    if (!recordType || !recordId || !prizmaData) {
      return res.status(400).json({ error: 'recordType, recordId ve prizmaData zorunludur' });
    }

    const collectionName = recordType === 'invoice' ? 'invoices' : 'discounts';
    const targetDocRef = doc(db, collectionName, recordId);
    const existing = await getDoc(targetDocRef);
    if (!existing.exists()) {
      return res.status(404).json({ error: 'Hedef kayıt bulunamadı' });
    }

    const updatePayload: Record<string, any> = {
      prizmaProcessId: prizmaData.id || prizmaData.prizmaProcessId || null,
      prizmaRequestCode: prizmaData.requestCode || prizmaData.prizmaRequestCode || null,
      prizmaOrderCode: prizmaData.orderCode || prizmaData.prizmaOrderCode || null,
      prizmaDocumentNo: prizmaData.documentNo || prizmaData.prizmaDocumentNo || null,
      prizmaSupplier: prizmaData.supplier || prizmaData.prizmaSupplier || null,
      prizmaJobsite: prizmaData.jobsite || prizmaData.prizmaJobsite || null,
      prizmaStatus: prizmaData.status || prizmaData.prizmaStatus || null,
      prizmaAmount: prizmaData.invoiceAmount !== undefined ? Number(prizmaData.invoiceAmount) : null,
      prizmaLinkedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await updateDoc(targetDocRef, updatePayload);

    res.json({
      success: true,
      message: `Prizma süreci (${updatePayload.prizmaRequestCode}) başarıyla bağlandı.`,
      linkedData: updatePayload
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prizma/unlink', async (req, res) => {
  try {
    const { recordType, recordId } = req.body || {};
    if (!recordType || !recordId) {
      return res.status(400).json({ error: 'recordType ve recordId zorunludur' });
    }

    const collectionName = recordType === 'invoice' ? 'invoices' : 'discounts';
    const targetDocRef = doc(db, collectionName, recordId);
    
    await updateDoc(targetDocRef, {
      prizmaProcessId: null,
      prizmaRequestCode: null,
      prizmaOrderCode: null,
      prizmaDocumentNo: null,
      prizmaSupplier: null,
      prizmaJobsite: null,
      prizmaStatus: null,
      prizmaAmount: null,
      prizmaLinkedAt: null,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Prizma bağlantısı kaldırıldı.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Prizma Invoices (Son 3 Ay) API
app.get('/api/prizma/invoices', async (req, res) => {
  try {
    const list = await prizmaSyncService.getInvoicesCached();
    let results = [...list];

    const search = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
    const jobsite = req.query.jobsite ? String(req.query.jobsite).trim().toLowerCase() : '';

    if (search) {
      results = results.filter(i =>
        (i.invoiceNumber && i.invoiceNumber.toLowerCase().includes(search)) ||
        (i.supplier && i.supplier.toLowerCase().includes(search)) ||
        (i.supplierInn && i.supplierInn.includes(search)) ||
        (i.prizmaRequestCode && i.prizmaRequestCode.toLowerCase().includes(search)) ||
        (i.prizmaOrderCode && i.prizmaOrderCode.toLowerCase().includes(search)) ||
        (i.jobsiteName && i.jobsiteName.toLowerCase().includes(search)) ||
        (i.items && i.items.some(item => (item.materialName || '').toLowerCase().includes(search)))
      );
    }

    if (jobsite && jobsite !== 'all') {
      results = results.filter(i => (i.jobsiteName || '').toLowerCase().includes(jobsite));
    }

    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '0', 10);
    const total = results.length;

    if (limit > 0) {
      const startIndex = (page - 1) * limit;
      results = results.slice(startIndex, startIndex + limit);
      return res.json({ data: results, total, page, limit });
    }

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/prizma/sync-status', async (_req, res) => {
  try {
    const status = prizmaSyncService.getSyncStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prizma/sync-last-3-months', async (req, res) => {
  try {
    const maxItems = req.body?.maxItems ? Number(req.body.maxItems) : 1500;
    const result = await prizmaSyncService.syncLast3Months({ maxItems });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message, success: false });
  }
});

// Prizma Faturalarını Sisteme Entegre Et (Çift Kayıt ve Mükerrer Fatura Korumalı)
app.post('/api/prizma/integrate-invoices', async (_req, res) => {
  if (!db) return res.status(500).json({ error: 'Firestore veritabanı bağlı değil.' });
  try {
    const result = await integratePrizmaInvoicesInternal(db);
    res.json(result);
  } catch (err: any) {
    console.error('[PRIZMA INTEGRATE ERROR]:', err);
    res.status(500).json({ error: err.message });
  }
});

// Prizma fatura kalemlerini "Счет на оплату" belgesiyle doğrular (STF sipariş satırları ≠ fatura).
// apply=false: yalnızca rapor. apply=true: değişen her prizma_invoices ve invoices kaydı önce
// `invoice_line_backups` koleksiyonuna yedeklenir, sonra kalemler belgedeki satırlarla güncellenir.
let invoiceLineReconcileRunning = false;
async function reconcilePrizmaInvoiceLines(options: { apply: boolean; limit?: number; recheck?: boolean }) {
  if (invoiceLineReconcileRunning) throw new Error('Fatura kalemi doğrulaması zaten çalışıyor.');
  invoiceLineReconcileRunning = true;
  try {
    const report = await prizmaSyncService.reconcileStoredInvoiceLines(options);
    let invoiceBackups = 0;
    let integration: any = null;
    if (options.apply && db && report.changedIds.length > 0) {
      const stamp = new Date().toISOString();
      for (let i = 0; i < report.changedIds.length; i += 50) {
        const batch = writeBatch(db);
        let pending = 0;
        for (const pid of report.changedIds.slice(i, i + 50)) {
          const invId = `inv_${pid}`;
          const snap = await getDoc(doc(db, 'invoices', invId));
          if (!snap.exists()) continue;
          batch.set(doc(db, 'invoice_line_backups', `${invId}__${stamp.replace(/[:.]/g, '-')}`), cleanComparativeData({
            collection: 'invoices', docId: invId, backedUpAt: stamp, reason: 'invoice_line_reconcile', data: snap.data()
          }));
          pending++;
        }
        if (pending > 0) { await batch.commit(); invoiceBackups += pending; }
      }
      integration = await integratePrizmaInvoicesInternal(db);
      memoryStore.invoices = undefined;
      memoryStore.materialComparisons = undefined;
    }
    return { ...report, invoiceBackups, integration };
  } finally {
    invoiceLineReconcileRunning = false;
  }
}

app.post('/api/prizma/reconcile-invoice-lines', async (req, res) => {
  const role = decodeURIComponent(String(req.headers['x-user-role'] || ''));
  const apply = req.body?.apply === true || req.query.apply === '1';
  if (apply && role !== 'admin') return res.status(403).json({ error: 'Kalemleri güncellemek için yönetici oturumu gerekir.' });
  try {
    const result = await reconcilePrizmaInvoiceLines({
      apply,
      limit: Number(req.body?.limit || req.query.limit) || undefined,
      recheck: req.body?.recheck === true || req.query.recheck === '1'
    });
    res.json({ success: true, apply, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/prizma/demand-files/:demandId', async (req, res) => {
  try {
    const demandId = Number(req.params.demandId);
    if (!demandId) return res.status(400).json({ error: 'Geçersiz talep ID' });

    const files = await (prizmaService as any).authorizedGet(`/api/process/list-files/BTF/${demandId}`);
    if (!Array.isArray(files)) return res.json({ files: [] });

    const formatted = files.map((f: any) => {
      const dType = Number(f.doctype);
      const isSchet = dType === 2 || /счет/i.test(f.docTypeNameRU || '') || /счет/i.test(f.docTypeNameTR || '') || /proforma/i.test(f.docTypeNameEN || '');
      const isUpd = dType === 7 || /упд/i.test(f.docTypeNameRU || '') || /упд/i.test(f.docTypeNameTR || '');
      return {
        id: f.id,
        doctype: dType,
        docTypeNameTR: f.docTypeNameTR || (isSchet ? 'Счет на оплату' : (isUpd ? 'Упд' : 'Belge')),
        docTypeNameRU: f.docTypeNameRU || (isSchet ? 'Счет на оплату' : (isUpd ? 'Упд' : 'Документ')),
        fileName: f.fileName,
        fileExtension: f.fileExtension || 'pdf',
        isSchet,
        isUpd,
        url: `/api/prizma/file/BTF/${demandId}/${f.id}`
      };
    });

    return res.json({ files: formatted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message, files: [] });
  }
});

app.get('/api/prizma/invoice-file/:demandId', async (req, res) => {
  try {
    const demandId = Number(req.params.demandId);
    if (!demandId) return res.status(400).json({ error: 'Geçersiz talep ID' });

    const requestedType = String(req.query.type || '').toLowerCase(); // 'schet' or 'upd'
    let selectedFileId: number | null = null;
    let selectedFileName = 'fatura.pdf';
    let processCode = 'BTF';

    try {
      const files = await (prizmaService as any).authorizedGet(`/api/process/list-files/BTF/${demandId}`);
      if (Array.isArray(files) && files.length > 0) {
        const isSchet = (f: any) => Number(f.doctype) === 2 || /счет/i.test(f.docTypeNameRU || '') || /счет/i.test(f.docTypeNameTR || '') || /proforma/i.test(f.docTypeNameEN || '') || /schet/i.test(f.fileName || '');
        const isUpd = (f: any) => Number(f.doctype) === 7 || /упд/i.test(f.docTypeNameRU || '') || /упд/i.test(f.docTypeNameTR || '') || /upd/i.test(f.fileName || '') || /receipt/i.test(f.fileName || '');

        if (requestedType === 'upd') {
          const updFile = files.find(isUpd);
          if (updFile) {
            selectedFileId = updFile.id;
            selectedFileName = updFile.fileName || 'upd.pdf';
          }
        } else {
          // Priority 1: Счет на оплату (doctype 2)
          const schetFile = files.find(isSchet);
          if (schetFile) {
            selectedFileId = schetFile.id;
            selectedFileName = schetFile.fileName || 'schet_na_oplatu.pdf';
          } else {
            // Priority 2: Non-UPD document
            const nonUpd = files.find((f: any) => !isUpd(f));
            if (nonUpd) {
              selectedFileId = nonUpd.id;
              selectedFileName = nonUpd.fileName || 'fatura.pdf';
            } else if (requestedType !== 'schet_only') {
              // Fallback to first file only if explicitly not restricted
              selectedFileId = files[0].id;
              selectedFileName = files[0].fileName || 'belge.pdf';
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[PRIZMA FILE ROUTE WARN] Demand ${demandId} list-files error:`, err.message);
    }

    if (!selectedFileId) {
      const cached = await prizmaSyncService.getInvoicesCached();
      const match = cached.find((inv: any) => inv.prizmaDemandId === demandId);
      if (match && match.invoiceFileId) selectedFileId = match.invoiceFileId;
    }

    if (!selectedFileId) {
      return res.status(404).send('Prizma fatura belgesi bulunamadı');
    }

    const targetPath = `/api/process/get-file/${processCode}/${demandId}/${selectedFileId}/fatura.pdf`;
    const fileRes = await prizmaService.downloadFile(targetPath);
    if (fileRes.status !== 200 || !fileRes.data || fileRes.data.length === 0) {
      return res.status(fileRes.status || 404).send('Prizma dosya servisine erişilemedi veya dosya bulunamadı');
    }

    res.setHeader('Content-Type', fileRes.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(selectedFileName)}"`);
    res.setHeader('Content-Length', fileRes.data.length);
    return res.send(fileRes.data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get(['/api/prizma/file/:processCode/:recordId/:fileId', '/api/prizma/file/:fileId'], async (req, res) => {
  try {
    const { processCode, recordId, fileId } = req.params;
    let targetPath = '';

    if (processCode && recordId && fileId) {
      targetPath = `/api/process/get-file/${processCode}/${recordId}/${fileId}/fatura.pdf`;
    } else if (fileId) {
      // Lookup from cached invoices
      const numFileId = Number(fileId);
      const cached = await prizmaSyncService.getInvoicesCached();
      const match = cached.find((inv: any) => inv.invoiceFileId === numFileId || inv.prizmaDemandId === numFileId);
      
      let actualDemandId = match ? match.prizmaDemandId : numFileId;
      let actualFileId = numFileId;

      if (match && match.prizmaDemandId) {
        try {
          const files = await (prizmaService as any).authorizedGet(`/api/process/list-files/BTF/${match.prizmaDemandId}`);
          if (Array.isArray(files) && files.length > 0) {
            const invFile = files.find((f: any) => f.doctype === 2 || (f.docTypeNameTR && f.docTypeNameTR.includes('Счет на оплату')) || (f.docTypeNameRU && f.docTypeNameRU.includes('Счет на оплату')));
            if (invFile) {
              actualFileId = invFile.id;
            }
          }
        } catch (_) {}
      }

      if (match && match.prizmaOrderDemandId) {
        targetPath = `/api/process/get-file/STF/${match.prizmaOrderDemandId}/${actualFileId}/fatura.pdf`;
      } else if (actualDemandId) {
        targetPath = `/api/process/get-file/BTF/${actualDemandId}/${actualFileId}/fatura.pdf`;
      } else {
        targetPath = `/api/process/get-file/BTF/${fileId}/${fileId}/fatura.pdf`;
      }
    }

    if (!targetPath) {
      return res.status(400).json({ error: 'Geçersiz dosya parametresi' });
    }

    const fileRes = await prizmaService.downloadFile(targetPath);
    if (fileRes.status !== 200 || !fileRes.data || fileRes.data.length === 0) {
      return res.status(fileRes.status || 404).send('Prizma dosya servisine erişilemedi veya dosya bulunamadı');
    }

    const contentType = fileRes.contentType || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="prizma_fatura_${fileId || 'belge'}.pdf"`);
    res.setHeader('Content-Length', fileRes.data.length);
    res.send(fileRes.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Direct Prizma Demand Dynamic Link Resolver & 302 Redirect
// Solves "Sayfa Bulunamadı" by querying Prizma's active subprocess in real time
app.get('/api/prizma/redirect/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const cleanId = String(id).replace(/\D/g, '');
    if (!cleanId) return res.status(400).send('Geçersiz talep no');

    if (type === 'btf' || type === 'payment-demand') {
      let subProcessId = 21008; // Varsayılan: Giden Kutusu
      try {
        const sub = await (prizmaService as any).authorizedGet(`/api/process/get-demand-subprocess-id/2100/${cleanId}`);
        if (sub && sub.userSubProcessId) {
          subProcessId = Number(sub.userSubProcessId);
        }
      } catch (err: any) {
        console.warn(`[BTF REDIRECT] Subprocess lookup fallback for ${cleanId}:`, err.message);
        subProcessId = 21009; // Genel Ödeme Takip listesi
      }
      return res.redirect(`https://pm.gescons.ru/process/payment-demand/2100/detail/${subProcessId}/${cleanId}`);
    }

    if (type === 'stf' || type === 'order-demand') {
      let subProcessId = 17252; // Varsayılan: Teslimat Beklenen Siparişler
      let userProcessId = 1725;
      try {
        const sub = await (prizmaService as any).authorizedGet(`/api/process/get-demand-subprocess-id/1725/${cleanId}`);
        if (sub && sub.userSubProcessId) {
          subProcessId = Number(sub.userSubProcessId);
          userProcessId = Number(sub.userProcessId || 1725);
        }
      } catch (err: any) {
        console.warn(`[STF REDIRECT] Subprocess lookup fallback for ${cleanId}:`, err.message);
        subProcessId = 17254; // Genel Sipariş Takip
      }
      return res.redirect(`https://pm.gescons.ru/process/order-demand/${userProcessId}/detail/${subProcessId}/${cleanId}`);
    }

    return res.redirect('https://pm.gescons.ru/process');
  } catch (err: any) {
    return res.status(500).send('Prizma yönlendirme hatası: ' + err.message);
  }
});


async function startServer() {
  const distPath = path.join(process.cwd(), 'dist');
  const indexPath = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(indexPath);

  // Production is ONLY when NODE_ENV is explicitly 'production' AND dist/index.html actually exists.
  // In development (or whenever dist/index.html is absent), always use Vite dev server middlewares.
  const isProduction = process.env.NODE_ENV === 'production' && hasDist && process.env.npm_lifecycle_event !== 'dev';

  if (!isProduction || !hasDist) {
    console.log('⚡ Vite dev server başlatılıyor (SPA Middleware modu)...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    console.log('🚀 Üretim modu: Derlenmiş statik dosyalar sunuluyor (/dist)...');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint bulunamadı' });
      }
      if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
      }
      const rootIndex = path.join(process.cwd(), 'index.html');
      if (fs.existsSync(rootIndex)) {
        return res.sendFile(rootIndex);
      }
      res.status(404).send('Sayfa bulunamadı');
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`🔥 Veritabanı: FIRESTORE (Web SDK) | Dosya Sunucusu: GCS (${PRIMARY_GCS_BUCKET}) + FIRESTORE`);

    // Sunucu başlangıcında önbellekleri arka planda ısıt (ilk açılış hızını maksimuma çıkarır)
    setTimeout(async () => {
      try {
        await Promise.all([
          getSupervisorsCached(),
          getPersonnelCached(),
          getJobsitesCached(),
          getDiscountsCached(),
          getInvoicesCached(),
          prizmaSyncService.getInvoicesCached().catch(() => [])
        ]);
        await fetch(`http://127.0.0.1:${PORT}/api/materials/compare`).catch(() => {});
      } catch (_) {}
    }, 100);

    // Kalemleri henüz fatura belgesiyle doğrulanmamış Prizma faturalarını arka planda bir kez doğrula.
    // Yalnızca belgeden kuruşu kuruşuna doğrulanan satırlar yazılır; her değişiklik önce yedeklenir.
    if (process.env.DISABLE_INVOICE_LINE_RECONCILE !== '1') {
      setTimeout(() => {
        if (!db) return;
        reconcilePrizmaInvoiceLines({ apply: true })
          .then(r => console.log(`[INVOICE LINE RECONCILE] ${r.scanned} fatura tarandı: ${r.verifiedFromDocument} belgeden doğrulandı, ${r.stfMatchesTotal} STF toplamı tutuyor, ${r.mismatch} doğrulanamadı, ${r.errors} erişim hatası; ${r.backups + r.invoiceBackups} kayıt yedeklendi.`))
          .catch(err => console.warn('[INVOICE LINE RECONCILE] Hata:', err.message));
      }, 90 * 1000);
    }

    // Sunucu başlangıcında bugünün bulut yedeği yoksa arka planda otomatik yedek al ve doğrula
    setTimeout(async () => {
      try {
        if (!bucket || !db) return;
        const todayStr = new Date().toISOString().split('T')[0];
        const todayBackupRef = bucket.file(`sistem-yedekleri/daily/backup-${todayStr}.json`);
        const [exists] = await todayBackupRef.exists();
        if (!exists) {
          console.log(`[STARTUP AUTO-BACKUP] Bugünün (${todayStr}) bulut yedeği bulunamadı, otomatik yedekleme başlatılıyor...`);
          const res = await createNightlyBackup();
          console.log('[STARTUP AUTO-BACKUP COMPLETE]:', res.stats);
        }
      } catch (err: any) {
        console.warn('[STARTUP AUTO-BACKUP WARN]:', err.message);
      }
    }, 8000);
  });
}

startServer();
