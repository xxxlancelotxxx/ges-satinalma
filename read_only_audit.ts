import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, getDocs, doc, getDoc, count } from "firebase/firestore";
import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";
import fs from "fs";

admin.initializeApp();

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  const bucketGoodName = "ai-studio-bucket-88134939798-europe-west2";
  const bucketBadName = "fatura-botu-505106.firebasestorage.app";
  const bucketGood = getStorage().bucket(bucketGoodName);
  const bucketBad = getStorage().bucket(bucketBadName);

  const report: any = {};

  // Point 2: system_backups
  try {
    const backupSnap = await getDocs(query(collection(db, "system_backups"), orderBy("createdAt", "desc"), limit(1)));
    if (!backupSnap.empty) {
      const b = backupSnap.docs[0];
      const data = b.data();
      report.lastBackup = {
        id: b.id,
        createdAt: data.createdAt,
        status: data.status,
        stats: data.stats,
        gcsPath: data.gcsPath || data.objectName
      };
    }
  } catch (e: any) { report.lastBackup = { error: e.message }; }

  // Point 3: GCS Backup Check
  if (report.lastBackup && report.lastBackup.gcsPath) {
    try {
      const [exists] = await bucketGood.file(report.lastBackup.gcsPath).exists();
      report.gcsBackup = { exists, path: report.lastBackup.gcsPath };
      // Check pdfs folder
      const prefix = report.lastBackup.gcsPath.replace('.json', '/pdfs/');
      const [files] = await bucketGood.getFiles({ prefix });
      report.gcsBackup.pdfCount = files.length;
    } catch (e: any) { report.gcsBackup = { error: e.message }; }
  }

  // Point 4: storage_files & storage_chunks
  try {
    const filesSnap = await getDocs(collection(db, "storage_files"));
    const chunksSnap = await getDocs(collection(db, "storage_chunks"));
    report.storageDocs = {
      filesCount: filesSnap.size,
      chunksCount: chunksSnap.size
    };
    if (chunksSnap.size > 0) {
        const sampleChunk = chunksSnap.docs[0].data();
        report.storageDocs.sampleChunkHasData = !!sampleChunk.data;
        report.storageDocs.sampleChunkSizeApprox = sampleChunk.data ? sampleChunk.data.length : 0;
    }
  } catch (e: any) { report.storageDocs = { error: e.message }; }

  // Point 6 & 7: Recent records and totals
  try {
    const invSnap = await getDocs(query(collection(db, "invoices"), orderBy("created_at", "desc"), limit(15)));
    const discSnap = await getDocs(query(collection(db, "discounts"), orderBy("created_at", "desc"), limit(5)));
    
    // Manual Count logic (due to SDK count limitations in some environments)
    const allInvsSnap = await getDocs(collection(db, "invoices"));
    const allDiscsSnap = await getDocs(collection(db, "discounts"));
    
    report.records = {
      totalInvoices: allInvsSnap.size,
      totalDiscounts: allDiscsSnap.size,
      recentInvoices: [],
      recentDiscounts: []
    };

    for (const d of invSnap.docs) {
       const data = d.data();
       const fileUrl = data.fileUrl || "";
       const fileName = fileUrl.split('/').pop() || "";
       let goodExists = false;
       let badExists = false;
       if (fileName) {
           try { goodExists = (await bucketGood.file("faturalar/" + fileName).exists())[0]; } catch(e){}
           try { badExists = (await bucketBad.file("faturalar/" + fileName).exists())[0]; } catch(e){}
       }
       report.records.recentInvoices.push({
           id: d.id,
           created_at: data.created_at,
           fileUrl,
           goodExists,
           badExists
       });
    }

    for (const d of discSnap.docs) {
        const data = d.data();
        report.records.recentDiscounts.push({
           id: d.id,
           created_at: data.created_at,
           firstOfferFileUrl: data.firstOfferFileUrl,
           finalOfferFileUrl: data.finalOfferFileUrl
        });
    }
  } catch (e: any) { report.records = { error: e.message }; }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run();
