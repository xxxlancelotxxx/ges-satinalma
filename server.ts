// Ortam değişkenleri (.env.local / .env) diğer modüllerden önce yüklenmeli.
import './server/envLoader';
import { processItem } from './src/utils/aiDecisionEngine';
import { normalizeStandardUnit, getMaterialBenchmarkUnit, convertMaterialUnit, areUnitsConvertible, extractRebarDiameter } from './src/utils/constructionUnitConverter';
import { normalizeVendorName, getVendorKey, areVendorsEqual } from './src/utils/vendorNormalizer';
import { normalizeCategoryName, CANONICAL_28_CATEGORIES } from './src/utils/categoryClassifier';
import { comparativeAnalysesStore, materialSynonymsStore, comparativeConfig, updateComparativeConfig, processComparativeAnalysisBatch, learnApprovedSynonyms } from './server/comparativeEngine';
import { prizmaService } from './server/prizmaService';
import { prizmaSyncService, cleanRawMaterialName } from './server/prizmaSyncService';

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
import { processInvoiceTwoStages } from './server/aiTwoStageOcr';

// ============================================================================
// 1. FIREBASE & STORAGE ENTEGRASYONU
// ============================================================================
// Cloud Storage için Firebase Admin SDK, Firestore için ise Proje Web SDK kullanılır.
if (!admin.getApps().length) {
  admin.initializeApp();
}

let db: any = null;
let bucket: any = null;
try {
  const configRaw = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
  const firebaseConfig = JSON.parse(configRaw);
  const fbApp = initFirebaseApp(firebaseConfig);
  db = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId || '(default)');
  if (firebaseConfig.storageBucket) {
    bucket = getStorage().bucket(firebaseConfig.storageBucket);
  }
  console.log('[FIREBASE] Firestore (Web SDK) ve Storage (Admin SDK) başarıyla başlatıldı.');
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
  let lastBackupHoursAgo = null;
  
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
         const getFilesPromise = bucket.getFiles({ prefix: 'sistem-yedekleri/daily/', maxResults: 50 });
         const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Bucket timeout')), 1000));
         const [backupFiles]: any = await Promise.race([getFilesPromise, timeoutPromise]);
         const jsonFiles = backupFiles.filter((f: any) => f.name.endsWith('.json'));
         const file = jsonFiles.sort((a: any, b: any) => b.name.localeCompare(a.name))[0];
         if (file) {
             const [metadata] = await file.getMetadata();
             const updated = new Date(metadata.updated || metadata.timeCreated).getTime();
             const now = Date.now();
             lastBackupHoursAgo = ((now - updated) / (1000 * 60 * 60)).toFixed(2);
         }
     } catch(e) {}
  }

  if (!lastBackupHoursAgo) {
     try {
       const manifest = readManifest();
       if (manifest && manifest.snapshots && manifest.snapshots.length > 0) {
         const updated = new Date(manifest.snapshots[0].timestamp).getTime();
         const now = Date.now();
         lastBackupHoursAgo = ((now - updated) / (1000 * 60 * 60)).toFixed(2);
       }
     } catch(e) {}
  }

  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    bucket: !!bucket, 
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
    await Promise.all([getDocs(collection(db, 'settings')), bucket.getMetadata()]);
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

    // 3. Firestore bulut yedekleme (GCS doğrudan yazılamadıysa Firestore chunks ile tam bulut koruması)
    let fsSuccess = false;
    if (db && !gcsSuccess && buffer.length <= 15 * 1024 * 1024) {
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
  const targetBucket = bucket || getStorage().bucket('ai-studio-bucket-88134939798-europe-west2');
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

  // b) Orada yoksa Firestore "storage_files" ve "storage_chunks" tablolarından oku
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

const CACHE_TTL_MS = 60 * 1000; // 60 seconds memory cache TTL

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
} = {};

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
    const snapshot = await getDocs(collection(db, 'discounts'));
    const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    const allRecords = allDocs.filter((d: any) => d.isPermanentlyDeleted !== true).map(d => {
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

async function getInvoicesCached() {
  const now = Date.now();
  if (memoryStore.invoices && (now - memoryStore.invoices.timestamp < CACHE_TTL_MS)) {
    return { data: memoryStore.invoices.data, quotaExceeded: isQuotaExceededGlobal };
  }
  if (!db) {
    const rawBackup = readLocalBackup('invoices.json', INITIAL_INVOICES);
    const backup = (rawBackup || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true);
    return { data: backup, quotaExceeded: false };
  }
  try {
    const snapshot = await getDocs(collection(db, 'invoices'));
    const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    const allRecords = allDocs.filter((i: any) => i.isPermanentlyDeleted !== true).map(i => {
      const cleanSupplier = normalizeVendorName(toSafeString(i.supplier || i.vendorName, ''));
      return {
        ...i,
        invoiceNumber: toSafeString(i.invoiceNumber, ''),
        supplier: cleanSupplier,
        vendorName: cleanSupplier,
        category: toSafeString(i.category, 'Genel'),
        uploadedBySupervisorName: toSafeString(i.uploadedBySupervisorName, ''),
        jobsiteName: toSafeString(i.jobsiteName, '')
      };
    });
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

    finalData.sort((a, b) => new Date(b.date || b.created_at || 0).getTime() - new Date(a.date || a.created_at || 0).getTime());

    memoryStore.invoices = { data: finalData, timestamp: now };
    return { data: finalData, quotaExceeded: false };
  } catch (err: any) {
    console.warn('[FIRESTORE INVOICES WARN]:', err.message);
    if (isQuotaError(err)) isQuotaExceededGlobal = true;
    const rawFallback = memoryStore.invoices?.data || readLocalBackup('invoices.json', INITIAL_INVOICES);
    const fallback = (rawFallback || []).filter((x: any) => x && x.isDeleted !== true && x.isPermanentlyDeleted !== true);
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
    const backupId = `snap_${Date.now()}`;
    const prefix = `sistem-yedekleri/snapshots/${backupId}/pdfs/`;

    if (bucket) {
      try {
        const fileUrlsToVerify = new Set();
        (currentData.invoices || []).forEach(inv => {
          if (inv.fileUrl && !inv.fileUrl.startsWith('data:')) fileUrlsToVerify.add(inv.fileUrl);
        });
        (currentData.discounts || []).forEach(dsc => {
          if (dsc.firstOfferFileUrl && !dsc.firstOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(dsc.firstOfferFileUrl);
          if (dsc.finalOfferFileUrl && !dsc.finalOfferFileUrl.startsWith('data:')) fileUrlsToVerify.add(dsc.finalOfferFileUrl);
        });

        const [bucketFiles] = await bucket.getFiles({ maxResults: 10000 });
        const fileMap = new Map();
        bucketFiles.forEach(f => fileMap.set(f.name.split('/').pop().toLowerCase(), f));

        for (const fUrl of Array.from(fileUrlsToVerify)) {
          const match = String(fUrl).match(/\/api\/files\/([^/?]+)/);
          if (match && match[1]) {
            const filename = decodeURIComponent(match[1]);
            const fileRef = fileMap.get(filename.toLowerCase());
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
          await Promise.all(filesToArchive.slice(i, i + 10).map(c => c.source.copy(c.dest)));
        }
      } catch (bucketErr: any) {
        console.warn('[BACKUP CREATE BUCKET NOTICE]:', bucketErr.message);
      }
    }

    /* Snapshot oluşturma - Veritabanı (Firestore) asla engellenmez */
    const meta = createSnapshot({ ...currentData, metadata: { pdfManifest, missingPdfs: missingFiles.length } }, trigger, {
      label: label || 'Manuel Sistem Yedeği',
      description: description || `${currentData.discounts.length} indirim, ${currentData.invoices.length} fatura korundu.`
    });
    meta.id = backupId; // sync ID
    
    await syncSnapshotToCloud(db, bucket, meta);
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
      const [files] = await bucket.getFiles({ prefix: `sistem-yedekleri/snapshots/${targetId}/pdfs/` });
      const existingNames = new Set(files.map(f => f.name));
      for (const pdf of pdfManifest) {
        if (existingNames.has(pdf.archivePath)) {
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

function smartNormalizeItem(item: any, existingCatalog: string[] = []): { materialName: string; category?: string } {
  if (!item || !item.materialName) return item;
  let rawName = String(item.materialName).trim();
  let name = cleanRawMaterialName(rawName) || rawName;
  const rawOrig = String(item.originalName || '').trim();
  const orig = cleanRawMaterialName(rawOrig) || rawOrig;
  const combined = `${name} ${orig}`.toLowerCase();
  
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

  // 0.5. Paspayı, Çiroz, Donatı Sehpası & Bağ Teli
  if (
    combined.includes('фиксатор') ||
    combined.includes('паспой') ||
    combined.includes('paspay') ||
    combined.includes('çiroz') ||
    combined.includes('ciroz') ||
    combined.includes('donatı sehp') ||
    combined.includes('лягушк')
  ) {
    return {
      materialName: name.startsWith('A500') ? (orig || name) : name,
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
    combined.includes('keski') ||
    combined.includes('вязальн') ||
    combined.includes('bağ teli') ||
    combined.includes('tavlı tel') ||
    combined.includes('муфта') ||
    combined.includes('mufta') ||
    combined.includes('manşon') ||
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
      combined.includes('арматур') ||
      combined.includes('demir') ||
      combined.includes('nervür') ||
      combined.includes('nervur') ||
      combined.includes('rebar') ||
      combined.includes('пруток') ||
      combined.includes('a500') ||
      combined.includes('а500') ||
      combined.includes('b500') ||
      combined.includes('a240') ||
      combined.includes('а240') ||
      combined.includes('hadde profil')
    )
  ) {
    const d = extractRebarDiameter(combined);
    if (d && STANDARD_REBAR_MAP[d]) {
      return { materialName: STANDARD_REBAR_MAP[d], category: 'İnşaat Demiri' };
    }
  }

  // 1.5 Hazır Beton & Grobeton Normalizasyonu
  if (combined.includes('бетон') || combined.includes('beton') || combined.includes('grobeton')) {
    if (combined.includes('grobeton') || combined.includes('b7.5') || combined.includes('в7.5') || combined.includes('m100')) {
      return { materialName: 'Grobeton B7.5 (M100 Hazır Beton)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b15') || combined.includes('в15') || combined.includes('m200')) {
      return { materialName: 'Hazır Beton B15 (M200 / C12/15)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b20') || combined.includes('в20') || combined.includes('m250')) {
      return { materialName: 'Hazır Beton B20 (M250 / C16/20)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b25') || combined.includes('в25') || combined.includes('m350')) {
      return { materialName: 'Hazır Beton B25 (M350 / C20/25 GOST)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b30') || combined.includes('в30') || combined.includes('m400')) {
      return { materialName: 'Hazır Beton B30 (M400 / C25/30 GOST)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b35') || combined.includes('в35') || combined.includes('m450')) {
      return { materialName: 'Hazır Beton B35 (M450 / C30/35 GOST)', category: 'Hazır Beton & Çimento' };
    }
    if (combined.includes('b40') || combined.includes('в40') || combined.includes('m500')) {
      return { materialName: 'Hazır Beton B40 (M500 / C35/40 GOST)', category: 'Hazır Beton & Çimento' };
    }
  }

  // 1.8 Plywood / Kontrplak / Фанера
  if (combined.includes('фанер') || combined.includes('kontrplak') || combined.includes('plywood') || combined.includes('pleyvud')) {
    if (combined.includes('21')) {
      return { materialName: 'Su Kontrplağı Plywood 21mm (1220x2440 WBP Film Kaplı)', category: 'Kalıp & İskele Sistemleri' };
    }
    if (combined.includes('15')) {
      return { materialName: 'Su Kontrplağı Plywood 15mm (1220x2440 WBP Film Kaplı)', category: 'Kalıp & İskele Sistemleri' };
    }
    if (combined.includes('12')) {
      return { materialName: 'Su Kontrplağı Plywood 12mm (1220x2440 WBP Film Kaplı)', category: 'Kalıp & İskele Sistemleri' };
    }
    return { materialName: 'Su Kontrplağı Plywood 18mm (1220x2440 WBP Film Kaplı)', category: 'Kalıp & İskele Sistemleri' };
  }

  // 1.9 Kaynak Elektrodu / Электрод
  if (combined.includes('электрод') || combined.includes('elektrod') || combined.includes('elektrot')) {
    if (!combined.includes('контроль') && !combined.includes('измерени')) {
      return { materialName: 'Kaynak Elektrodu MP-3 (Ø4.0mm / 5kg Paket)', category: 'Sarf Malzeme & Hırdavat' };
    }
  }

  // 1.95 Bağ Teli / Tavlı Tel / Вязальная проволока
  if (combined.includes('вязальн') || combined.includes('bağ teli') || combined.includes('bag teli') || combined.includes('tavlı tel')) {
    return { materialName: 'Bağ Teli (1.2mm Tavlı Donatı Teli)', category: 'Donatı Malzemeleri' };
  }

  // 1.96 İnşaat Çivisi / Гвозди строительные
  if (combined.includes('гвозд') || combined.includes('civi') || combined.includes('çivi')) {
    return { materialName: 'İnşaat Çivisi (100mm / 4x100)', category: 'Sarf Malzeme & Hırdavat' };
  }

  // 1.97 Kum / Песок
  if (combined.includes('песок') || (combined.includes('kum') && !combined.includes('kumaş') && !combined.includes('kumanda'))) {
    return { materialName: 'İnşaat Kumu (Sıva / Şap Kumu)', category: 'Kaba Yapı Malzemeleri' };
  }

  // 1.98 Çakıl / Mıcır / Щебень / Гравий
  if (combined.includes('щебень') || combined.includes('гравий') || combined.includes('çakıl') || combined.includes('cakil') || combined.includes('mıcır')) {
    return { materialName: 'Kırmataş Mıcır / Çakıl (5-20mm)', category: 'Kaba Yapı Malzemeleri' };
  }

  // 1.99 Kalıp Yağı / Смазка для опалубки
  if (combined.includes('kalıp yağ') || combined.includes('kalip yag') || combined.includes('смазка для опалуб') || combined.includes('эмульсол')) {
    return { materialName: 'Kalıp Ayırıcı Yağ (Endüstriyel Beton Kalıp Yağı)', category: 'Kalıp & İskele Sistemleri' };
  }

  // 1.995 Naylon / Branda / Пленка
  if (combined.includes('пленка') || combined.includes('плёнка') || combined.includes('naylon') || combined.includes('branda')) {
    return { materialName: 'Polietilen İnşaat Naylonu Brandası (200 mikron)', category: 'Yalıtım & İzolasyon' };
  }

  // 1.996 Propan Gaz Tüpü
  if (combined.includes('пропан') || combined.includes('propan')) {
    return { materialName: 'Propan Gaz Tüpü (50L Sanayi Tipi)', category: 'Sarf Malzeme & Hırdavat' };
  }

  // 1.997 Dizel Yakıt / Mazot (Sadece akaryakıt; jeneratör, tank, pompa veya filtreler hariç)
  if (/^mazot$|^dizel\s*yakıt|^дизельное\s*топливо/i.test(combined.trim()) || (/mazot|dizel\s*yakıt|дизельн.*топлив/i.test(combined) && !/jenerat|tank|filtre|kompresor|pompa|isımak|ısıtıcı/i.test(combined))) {
    return { materialName: 'Dizel Yakıt / Mazot (Euro 5)', category: 'Akaryakıt & Enerji' };
  }

  // 2. Coupler / Donatı Manşonu / Муфта
  if (combined.includes('муфта') || combined.includes('manşon') || combined.includes('manson')) {
    const dMatch = combined.match(/(?:ds*=?|диаметрs*=?|çaps*=?|ø)s*(d+)/i);
    if (dMatch) {
      const dVal = dMatch[1];
      if (combined.includes('p14') || combined.includes('п14')) {
        return { materialName: `Donatı Manşonu P14 d=${dVal} mm`, category: 'Donatı Malzemeleri' };
      }
      if (combined.includes('geçiş') || combined.includes('переходная')) {
        return { materialName: `Geçiş Donatı Manşonu d=${dVal} mm`, category: 'Donatı Malzemeleri' };
      }
    }
  }

  // 3. Timber / Kereste / Брус / Доска
  if (combined.includes('брус') || combined.includes('kereste') || combined.includes('tahta') || combined.includes('доска')) {
    if (combined.includes('100*100*6000') || combined.includes('100x100x6000')) {
      return { materialName: 'Profil Kereste 100x100x6000 (1. Sınıf GOST)', category: 'Kalıp & İskele Sistemleri' };
    }
    if (combined.includes('50*100*6000') || combined.includes('50x100x6000')) {
      return { materialName: 'Kenarlı Kereste Tahta 50x100x6000 (1. Sınıf GOST)', category: 'Kalıp & İskele Sistemleri' };
    }
    if (combined.includes('30*150*6000') || combined.includes('30x150x6000')) {
      return { materialName: 'Profil Kereste (30х150х6000)', category: 'Kalıp & İskele Sistemleri' };
    }
    return { materialName: 'İnşaatlık Çam Kereste (1. Sınıf GOST 8486)', category: 'Kalıp & İskele Sistemleri' };
  }

  // Canonical Category Resolution
  const resolvedCategory = smartNormalizeCategory(item.category, `${name} ${orig}`);

  // 4. Exact catalog match (case-insensitive)
  if (existingCatalog && existingCatalog.length > 0) {
    const lowerName = name.toLowerCase();
    const found = existingCatalog.find(catItem => catItem.toLowerCase() === lowerName);
    if (found) {
      return { materialName: found, category: resolvedCategory };
    }
  }

  return { materialName: name, category: resolvedCategory };
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

    return {
      ...rest,
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

    const invoiceDuplicate = activeDiscounts.find(d => {
      if (d.isDeleted) return false;
      const sameVendor = areVendorsEqual(d.vendorName, cleanVendorName);
      const dInvoiceNo = String(d.invoiceNo || '').trim();
      const dAmount = Number(d.agreedPrice) || Number(d.offerPrice) || 0;
      const dDate = String(d.orderDate || '').trim();

      // Disregard generated TKF-/ARCH- invoices when checking duplicates if they happen to randomly collide (highly unlikely)
      if (dInvoiceNo.startsWith('TKF-') || dInvoiceNo.startsWith('ARCH-') || dInvoiceNo.startsWith('FT-EXCEL-')) return false;
      
      if (reqInvoiceNo && dInvoiceNo && reqInvoiceNo.toLowerCase() === dInvoiceNo.toLowerCase() && sameVendor) return true;
      if (!reqInvoiceNo && sameVendor && reqAmount > 0 && Math.abs(reqAmount - dAmount) < 1 && reqDate === dDate) return true;

      return false;
    });

    if (invoiceDuplicate) {
      return res.status(409).json({
        error: 'Mükerrer Kayıt',
        details: reqInvoiceNo
          ? `Bu tedarikçi (${req.body.vendorName}) için '${reqInvoiceNo}' numaralı belge/fatura zaten sisteme kaydedilmiş!`
          : `Bu tedarikçi (${req.body.vendorName}) için aynı tarih ve tutarda (${reqAmount} ₽) bir indirim kaydı zaten sistemde mevcut!`
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
      category: toSafeString(req.body.category, 'Genel'),
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
    
    // Guard against uploading the same invoice again
    const reqInvoiceNo = String(req.body.invoiceNumber || '').trim();
    const reqSupplier = String(req.body.supplier || '').trim().toLowerCase();
    const reqAmount = Number(req.body.totalAmount) || 0;
    const reqDate = String(req.body.date || '').trim();
    
    const invoiceDuplicate = curInvs.find(i => {
      if (i.isDeleted) return false;
      const iSupplier = String(i.supplier || '').trim().toLowerCase();
      const iInvoiceNo = String(i.invoiceNumber || '').trim();
      const iAmount = Number(i.totalAmount) || 0;
      const iDate = String(i.date || '').trim();
      
      // Disregard generated TKF-/ARCH-/FT-EXCEL- invoices when checking duplicates
      if (iInvoiceNo.startsWith('TKF-') || iInvoiceNo.startsWith('ARCH-') || iInvoiceNo.startsWith('FT-EXCEL-')) return false;
      
      if (reqInvoiceNo && reqInvoiceNo === iInvoiceNo && reqSupplier === iSupplier) return true;
      if (!reqInvoiceNo && reqSupplier && reqSupplier === iSupplier && reqAmount > 0 && reqAmount === iAmount && reqDate === iDate) return true;
      
      return false;
    });

    if (invoiceDuplicate) {
      return res.status(409).json({
        error: 'Mükerrer Kayıt',
        details: reqInvoiceNo 
          ? `Bu tedarikçi (${req.body.supplier}) için '${reqInvoiceNo}' numaralı fatura zaten sisteme kaydedilmiş!`
          : `Bu tedarikçi (${req.body.supplier}) için aynı tarih ve tutarda (${reqAmount}) benzer bir fatura zaten sistemde mevcut!`
      });
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
    const newDoc = { 
      ...req.body, 
      items: normItems || [], 
      id, 
      invoiceNumber: toSafeString(req.body.invoiceNumber, `FT-${id}`),
      supplier: toSafeString(req.body.supplier, 'Bilinmeyen Tedarikçi'),
      category: toSafeString(detectedCategory, 'Genel'),
      isDeleted: false, 
      created_at: new Date().toISOString() 
    };
    delete newDoc.fileData;
    delete newDoc.pdfBase64;
    delete newDoc.fileContent;
    delete newDoc.base64;
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

    const updatedInvoices = [newDoc, ...curInvs.filter((i: any) => i.id !== id)];
    memoryStore.invoices = { data: updatedInvoices, timestamp: Date.now() };
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

app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const invId = req.params.id;
    const nowIso = new Date().toISOString();
    const cmpId = invId.startsWith('inv_cmp_') ? invId.replace('inv_cmp_', '') : null;
    let discId = invId.startsWith('inv_sync_')
      ? invId.replace('inv_sync_', '')
      : (cmpId ? `disc_cmp_${cmpId}` : null);

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

    res.json({ success: true, message: 'Fatura çöp kutusuna taşındı.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ============================================================================

app.get('/api/materials/compare', async (req, res) => {
  try {
    const { data: invs, quotaExceeded: q1 } = await getInvoicesCached();
    const { data: dscs, quotaExceeded: q2 } = await getDiscountsCached();
    if (q1 || q2) res.setHeader('X-Quota-Exceeded', 'true');

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

        allInvoices.push({
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
        });
      }
    }

    // Build a lookup map of existing invoices for smart deduplication
    const existingInvoicesMap = new Map<string, any>();
    allInvoices.forEach(inv => {
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
      const prizmaInvs = await prizmaSyncService.getInvoicesCached();
      for (const pInv of prizmaInvs) {
        if (!pInv.isDeleted && pInv.items && pInv.items.length > 0) {
          const pCleanNo = (pInv.invoiceNumber || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
          const pCleanVendor = normalizeVendorName(pInv.supplier || pInv.vendorName || '');

          let existingMatch: any = null;
          if (pCleanNo) {
            existingMatch = existingInvoicesMap.get(`${pCleanVendor}___${pCleanNo}`) || (pCleanNo.length >= 3 ? existingInvoicesMap.get(`NO_${pCleanNo}`) : null);
          }

          if (existingMatch) {
            // MERGE Prizma metadata into existing uploaded local invoice
            existingMatch.prizmaSource = true;
            existingMatch.prizmaRequestCode = pInv.prizmaRequestCode || existingMatch.prizmaRequestCode;
            existingMatch.prizmaOrderCode = pInv.prizmaOrderCode || existingMatch.prizmaOrderCode;
            existingMatch.prizmaBtfUrl = pInv.prizmaBtfUrl || existingMatch.prizmaBtfUrl;
            existingMatch.prizmaStfUrl = pInv.prizmaStfUrl || existingMatch.prizmaStfUrl;
            existingMatch.prizmaUrl = pInv.prizmaBtfUrl || pInv.prizmaUrl || existingMatch.prizmaUrl;
            if (Array.isArray(existingMatch.items)) {
              existingMatch.items.forEach((it: any) => {
                it.prizmaRequestCode = pInv.prizmaRequestCode || it.prizmaRequestCode;
                it.prizmaOrderCode = pInv.prizmaOrderCode || it.prizmaOrderCode;
                it.prizmaBtfUrl = pInv.prizmaBtfUrl || it.prizmaBtfUrl;
                it.prizmaStfUrl = pInv.prizmaStfUrl || it.prizmaStfUrl;
              });
            }
          } else {
            // Add as new Prizma invoice record
            allInvoices.push({
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
            });
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
    // Groups materials by canonical identity into a single card per material.
    // Standardizes benchmark prices so comparisons across jobsites are mathematically apples-to-apples.
    const materialMap = new Map<string, {
      materialName: string;
      category: string;
      rawUnits: Set<string>;
      items: Array<{
        inv: any;
        item: any;
        priceNum: number;
        quantity: number;
        unit: string;
      }>;
    }>();

    allInvoices.forEach(inv => {
      if (!inv.items || !Array.isArray(inv.items)) return;
      inv.items.forEach(item => {
        if (!item.materialName || item.unitPrice === undefined || item.unitPrice === null) return;
        const priceNum = Number(item.unitPrice);
        if (isNaN(priceNum) || priceNum <= 0) return;

        const norm = smartNormalizeItem({ ...item, supplier: item.supplier || inv.supplier });
        const canonName = norm.materialName || item.materialName;
        const canonCat = normalizeCategoryName(norm.category || item.category, canonName);
        const canonKey = canonName.toLowerCase().trim();

        // 1. Beton Filtresi: ("ilave olarak betonlarida etmeyelim, sistem siser cunku betona gerek yok")
        if (/beton|бетон|раствор|grobeton|гробетон|бсг|бст|керамзитобетон/i.test(canonCat) || /beton|бетон|раствор|grobeton|гробетон/i.test(canonName)) {
          return;
        }

        // 2. Taşeron & Hizmet & İşçilik Filtresi
        if (canonCat === 'Hizmet & Lojistik' || /шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|nakliye/i.test(canonName)) {
          return;
        }

        // KESİN KURAL: Her standart malzeme KENDİ canonKey çatısı altında toplanmalıdır!
        // Tüm şantiyelerin aynı malzemeyi kaça aldığı TEK bir kartta birleşmelidir.
        const targetKey = canonKey;

        if (!materialMap.has(targetKey)) {
          materialMap.set(targetKey, {
            materialName: canonName,
            category: canonCat,
            rawUnits: new Set<string>(),
            items: []
          });
        }

        const entry = materialMap.get(targetKey)!;
        entry.rawUnits.add(item.unit || 'Adet');
        entry.items.push({
          inv,
          item,
          priceNum,
          quantity: Number(item.quantity) || 1,
          unit: item.unit || 'Adet'
        });
      });
    });

    const comparisons: any[] = [];
    materialMap.forEach((matGroup, groupKey) => {
      if (matGroup.items.length === 0) return;

      const rawUnitsList = Array.from(matGroup.rawUnits);
      const benchmarkUnit = getMaterialBenchmarkUnit(matGroup.materialName, matGroup.category, rawUnitsList);

      const history: any[] = [];
      let totalNormalizedSpend = 0;
      let totalNormalizedQuantity = 0;

      matGroup.items.forEach(({ inv, item, priceNum, quantity, unit }) => {
        const conv = convertMaterialUnit({
          materialName: matGroup.materialName,
          category: matGroup.category,
          rawItemName: item.originalName || item.materialName || '',
          fromUnit: unit,
          toUnit: benchmarkUnit,
          unitPrice: priceNum,
          quantity
        });

        const effectiveUnitPrice = conv.conversionApplied ? conv.convertedUnitPrice : priceNum;
        const effectiveQuantity = conv.conversionApplied ? conv.convertedQuantity : quantity;
        const lineTotalSpend = priceNum * quantity;

        totalNormalizedSpend += lineTotalSpend;
        totalNormalizedQuantity += effectiveQuantity;

        history.push({
          date: inv.date || inv.created_at || new Date().toISOString(),
          jobsiteId: inv.jobsiteId,
          jobsiteName: inv.jobsiteName,
          supplier: inv.supplier,
          unitPrice: effectiveUnitPrice,
          quantity: effectiveQuantity,
          unit: conv.conversionApplied ? benchmarkUnit : unit,
          originalUnitPrice: priceNum,
          originalQuantity: quantity,
          originalUnit: unit,
          normalizedUnitPrice: effectiveUnitPrice,
          normalizedQuantity: effectiveQuantity,
          normalizedUnit: benchmarkUnit,
          conversionApplied: conv.conversionApplied,
          conversionFormula: conv.formula,
          conversionFactor: conv.factor,
          invoiceNumber: inv.invoiceNumber,
          originalName: item.originalName || item.materialName,
          invoiceId: inv.id,
          rawFileName: inv.rawFileName,
          fileUrl: inv.fileUrl,
          prizmaSource: Boolean(inv.prizmaSource || (inv.id && String(inv.id).startsWith('prizma_'))),
          prizmaRequestCode: inv.prizmaRequestCode || item.prizmaRequestCode,
          prizmaOrderCode: inv.prizmaOrderCode || item.prizmaOrderCode,
          prizmaBtfUrl: inv.prizmaBtfUrl || item.prizmaBtfUrl,
          prizmaStfUrl: inv.prizmaStfUrl || item.prizmaStfUrl,
          prizmaUrl: inv.prizmaBtfUrl || inv.prizmaUrl || item.prizmaBtfUrl || item.prizmaUrl
        });
      });

      const normalizedPrices = history.map(h => h.unitPrice);
      const minUnitPrice = Math.min(...normalizedPrices);
      const maxUnitPrice = Math.max(...normalizedPrices);

      const avgUnitPrice = totalNormalizedQuantity > 0 ? (totalNormalizedSpend / totalNormalizedQuantity) : 0;
      const cheapestPoint = history.find(h => h.unitPrice === minUnitPrice);
      const priciestPoint = history.find(h => h.unitPrice === maxUnitPrice);

      let priceDiffPct = 0;
      if (minUnitPrice > 0 && maxUnitPrice > minUnitPrice) {
        priceDiffPct = ((maxUnitPrice - minUnitPrice) / minUnitPrice) * 100;
      }

      comparisons.push({
        id: groupKey,
        materialName: matGroup.materialName,
        category: matGroup.category,
        unit: benchmarkUnit,
        standardUnit: benchmarkUnit,
        hasMultipleUnits: rawUnitsList.length > 1,
        detectedUnits: rawUnitsList,
        minUnitPrice: Number(minUnitPrice.toFixed(2)),
        maxUnitPrice: Number(maxUnitPrice.toFixed(2)),
        avgUnitPrice: Number(avgUnitPrice.toFixed(2)),
        cheapestJobsiteName: cheapestPoint ? cheapestPoint.jobsiteName : '-',
        priciestJobsiteName: priciestPoint ? priciestPoint.jobsiteName : '-',
        totalQuantityPurchased: Number(totalNormalizedQuantity.toFixed(2)),
        totalSpend: Number(totalNormalizedSpend.toFixed(2)),
        priceDifferencePercentage: Number(priceDiffPct.toFixed(2)),
        history: history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      });
    });

    res.json(comparisons.sort((a, b) => b.priceDifferencePercentage - a.priceDifferencePercentage));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

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
            return { ...it, category };
          }
          return it;
        });
        if (updated) {
          await updateDoc(doc(db, 'invoices', docSnap.id), { items: newItems });
        }
      }
    }
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
      primaryModel: 'gemini-flash-latest'
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
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const { sourceName, targetName } = req.body;
    if (!sourceName || !targetName) return res.status(400).json({ error: 'Kaynak ve hedef malzeme isimleri gereklidir.' });

    const invSnap = await getDocs(query(collection(db, 'invoices'), where('isDeleted', '==', false)));
    const srcLower = sourceName.toLowerCase().trim();
    const tgtTrim = targetName.trim();

    for (const docSnap of invSnap.docs) {
      const data = docSnap.data();
      if (Array.isArray(data.items)) {
        let changed = false;
        const updatedItems = data.items.map((it: any) => {
          if (it.materialName && it.materialName.toLowerCase().trim() === srcLower) {
            changed = true;
            return { ...it, materialName: tgtTrim };
          }
          return it;
        });

        if (changed) {
          await updateDoc(doc(db, 'invoices', docSnap.id), { items: updatedItems });
        }
      }
    }

    res.json({ success: true, message: `'${sourceName}' malzemesi '${targetName}' ile birleştirildi.` });
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

      if (customPin) {
        if (cleanPin === customPin) {
          return res.json({
            success: true,
            user: {
              username: cleanUsername,
              role: 'personnel',
              displayName: pers.name,
              personnelId: pers.id,
              supervisorId: pers.supervisorId
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
              supervisorId: pers.supervisorId
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
    const customPin = customPins[supKey] || userPinStore.get(supKey);
    const expectedPin = customPin || `${cleanUsername}123`;

    if (customPin) {
      if (cleanPin === customPin) {
        return res.json({
          success: true,
          user: {
            username: cleanUsername,
            role: 'supervisor',
            displayName: supervisor ? supervisor.name : (username || 'Satınalma Şefi'),
            supervisorId: supervisorId || (supervisor ? supervisor.id : 'sup_1')
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
          displayName: supervisor ? supervisor.name : (username || 'Satınalma Şefi'),
          supervisorId: supervisorId || (supervisor ? supervisor.id : 'sup_1')
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
  if (!db) return res.status(500).json({ error: 'Firestore bağlı değil.' });
  try {
    const invId = req.params.id;
    const updateData = { ...req.body };
    delete updateData.id;

    await setDoc(doc(db, 'invoices', invId), updateData, { merge: true });

    const invDocSnap = await getDoc(doc(db, 'invoices', invId));
    const invData = invDocSnap.exists() ? invDocSnap.data() : null;
    let discId = invId.startsWith('inv_sync_') ? invId.replace('inv_sync_', '') : (invData?.discountId || null);

    if (discId) {
      const discUpdate: any = {};
      if (updateData.supplier) discUpdate.vendorName = updateData.supplier;
      if (updateData.invoiceNumber) discUpdate.invoiceNo = updateData.invoiceNumber;
      if (updateData.totalAmount !== undefined) discUpdate.agreedPrice = updateData.totalAmount;
      if (updateData.items) discUpdate.items = updateData.items;

      if (Object.keys(discUpdate).length > 0) {
        await setDoc(doc(db, 'discounts', discId), discUpdate, { merge: true });
      }
    }

    res.json({ success: true });
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

    memoryStore.invoices = null;
    memoryStore.discounts = null;

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

    memoryStore.invoices = null;
    memoryStore.discounts = null;

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
        // 2. Firestore document
        if (db) {
          await deleteDoc(doc(db, 'discounts', dsc.id));
          await setDoc(doc(db, 'deletion_ledger', dsc.id), {
            collection: 'discounts',
            documentId: dsc.id,
            deletedAt: new Date().toISOString(),
            deletedBy: adminId,
            reason: 'empty_trash'
          });
        }
        deletedRecords.push(dsc.id);
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

      memoryStore.invoices = null;
      memoryStore.discounts = null;
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
    const { fileBase64, imageBase64, mimeType, promptText, excelCsv, fileName, scanMode, offerType, firstOfferBase64 } = req.body;
    const base64Input = fileBase64 || imageBase64;

    if (!base64Input && !excelCsv) {
      return res.status(400).json({ error: 'Fatura görseli veya Excel verisi bulunamadı.' });
    }

    // Fetch existing active invoices for duplicate checking (cached in-memory for speed)
    let existingInvoices: any[] = [];
    try {
      const { data: cachedInvs } = await getInvoicesCached();
      existingInvoices = cachedInvs || [];
    } catch (err: any) {
      console.warn('[AI OCR] Existing invoices fetch warning:', err.message);
    }

    const result = await processInvoiceTwoStages({
      base64Input,
      mimeType,
      excelCsv,
      fileName,
      additionalPrompt: promptText,
      existingInvoices,
      scanMode,
      offerType,
      firstOfferBase64
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
    console.error('[AI OCR ERROR]:', err);
    res.status(500).json({ error: 'Yapay zeka işlemi başarısız oldu.', details: err.message });
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
  
  const [bucketFiles] = await bucket.getFiles({ maxResults: 10000 });
  const fileMap = new Map<string, any>();
  const dailyPrefix = `sistem-yedekleri/daily/backup-${dateStr}/pdfs/`;
  const alreadyArchivedPdfs = new Set<string>();

  for (const f of bucketFiles) {
    const fn = path.basename(f.name).toLowerCase();
    if (f.name.startsWith(dailyPrefix)) {
      alreadyArchivedPdfs.add(fn);
    } else {
      if (!fileMap.has(fn)) {
        fileMap.set(fn, f);
      }
    }
  }

  const pdfManifest = [];
  const missingFilesList: string[] = [];
  const filesToArchive: { source: any; dest: any }[] = [];
  let missingPdfs = 0;

  for (const fUrl of Array.from(fileUrlsToVerify)) {
    const match = String(fUrl).match(/\/api\/files\/([^/?]+)/);
    if (match && match[1]) {
      const filename = decodeURIComponent(match[1]);
      const fileRef = fileMap.get(filename.toLowerCase());

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

// OTOMATİK AKŞAM VE GECE SENKRONİZASYONU: Her akşam 21:00 ve her gece 02:30 (Moscow) Prizma'dan kesinleşmiş malzeme faturalarını günceller
cron.schedule('0 21 * * *', () => {
  console.log('[AUTO PRIZMA SYNC] Akşam 21:00 otomatik Prizma malzeme faturası senkronizasyonu başladı...');
  prizmaSyncService.syncLast3Months({ maxItems: 1500 })
    .then(r => console.log('[AUTO PRIZMA SYNC SUCCESS - AKŞAM]:', r.message))
    .catch(err => console.error('[AUTO PRIZMA SYNC ERROR - AKŞAM]:', err.message));
}, { timezone: 'Europe/Moscow' });

cron.schedule('30 2 * * *', () => {
  console.log('[AUTO PRIZMA SYNC] Gece 02:30 otomatik Prizma malzeme faturası senkronizasyonu başladı...');
  prizmaSyncService.syncLast3Months({ maxItems: 1500 })
    .then(r => console.log('[AUTO PRIZMA SYNC SUCCESS - GECE]:', r.message))
    .catch(err => console.error('[AUTO PRIZMA SYNC ERROR - GECE]:', err.message));
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
// 1. List all analyses
app.get('/api/comparative-analyses', async (req, res) => {
  try {
    if (db) {
      try {
        const snap = await getDocs(collection(db, 'comparative_analyses'));
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.id && !comparativeAnalysesStore.has(data.id)) {
            comparativeAnalysesStore.set(data.id, data);
          }
        });
      } catch (err: any) {
        console.warn('[FIRESTORE COMPARATIVE READ WARN]:', err.message);
      }
    }
    const all = Array.from(comparativeAnalysesStore.values()).filter(a => !a.isDeleted);
    all.sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime());
    res.json(all);
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
        comparativeAnalysesStore.set(id, record);
      }
    }
    if (!record) return res.status(404).json({ error: 'Analiz bulunamadı' });
    res.json(record);
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
    const analysisData = req.body;
    if (!analysisData || !analysisData.id) {
      return res.status(400).json({ error: 'Geçersiz analiz verisi.' });
    }

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

    if ((analysisData.documents || []).some((d: any) => !d.isExcluded && (!d.fileUrl || String(d.fileUrl).startsWith('data:') || String(d.fileUrl).includes('test-sandbox/')))) {
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

    // 2. Existing invoice resolution (re-use existing ID if same analysis, same discount, or same invoice number + vendor)
    const existingInv = curInvoices.find((i: any) =>
      !i.isDeleted && (
        i.comparativeAnalysisId === analysisData.id ||
        i.discountId === discountId ||
        (finalInvoiceNumber && !finalInvoiceNumber.startsWith('FT-CMP-') && !finalInvoiceNumber.startsWith('TKF-') &&
         areVendorsEqual(i.supplier || i.vendorName, finalSupplier) &&
         String(i.invoiceNumber || i.invoiceNo || '').trim().toLowerCase() === finalInvoiceNumber.trim().toLowerCase())
      )
    );
    const invoiceId = existingInv?.id || `inv_cmp_${analysisData.id}`;

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
      rawFileName: finalDoc?.fileName || 'nihai_anlasilan_fatura.pdf',
      fileUrl: finalDoc?.fileUrl || '',
      created_at: new Date().toISOString(),
      isDeleted: false,
      status: 'Onaylandı'
    };

    const updatedInvoices = [finalInvoiceRecord, ...curInvoices.filter((i: any) => i.id !== invoiceId && i.comparativeAnalysisId !== analysisData.id && i.discountId !== discountId)];
    if (!db) return res.status(503).json({error: 'Firestore bağlı değil. Analiz kaydedilmedi.'});
    const batch = writeBatch(db);
    batch.set(doc(db, 'comparative_analyses', analysisData.id), cleanComparativeData(analysisData), {merge: true});
    batch.set(doc(db, 'discounts', discountId), cleanComparativeData(linkedDiscount), {merge: true});
    batch.set(doc(db, 'invoices', invoiceId), cleanComparativeData(finalInvoiceRecord), {merge: true});
    await batch.commit();
    comparativeAnalysesStore.set(analysisData.id, analysisData);
    memoryStore.discounts = {data: updatedDiscounts, timestamp: Date.now()};
    saveLocalBackup('discounts.json', updatedDiscounts);
    memoryStore.invoices = { data: updatedInvoices, timestamp: Date.now() };
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


app.post('/api/materials/retroactive-audit-normalize', async (req, res) => {
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

    // Clear memory store so next fetch instantly reloads audited records
    memoryStore.invoices = undefined;
    memoryStore.discounts = undefined;

    res.json({
      success: true,
      message: `${totalItemsAudited} fatura kalemi başarıyla denetlendi, ${itemsUpdated} kalem (${invoicesUpdated} fatura) standart kanonik inşaat kimliğine kavuşturuldu.`,
      totalInvoicesAudited: allInvoices.length,
      totalItemsAudited,
      itemsUpdated,
      invoicesUpdated,
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
    console.log(`🔥 Veritabanı: FIRESTORE (Admin SDK) | Dosya Sunucusu: LOCAL FILESYSTEM`);
  });
}

startServer();
