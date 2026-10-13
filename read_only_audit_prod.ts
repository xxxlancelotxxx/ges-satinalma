import { getStorage } from "firebase-admin/storage";
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import admin from "firebase-admin";
import fs from "fs";

async function run() {
  const cfgPath = "firebase-applet-config.json";
  if (!fs.existsSync(cfgPath)) {
      console.log("No config found"); return;
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  
  // Initialize Web SDK for Firestore
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  
  // Initialize Admin SDK for Storage
  if (!admin.apps.length) {
      admin.initializeApp({ projectId: cfg.projectId });
  }
  const storage = getStorage();
  
  console.log("=== AŞAMA 1: CANLI DENETİM ===");
  console.log("Firebase Project ID:", cfg.projectId);
  console.log("Storage Bucket in config:", cfg.storageBucket);
  
  const bucketName = cfg.storageBucket;
  const bucket = storage.bucket(bucketName);
  
  // 1. GCS'deki yedekleri (system_backups) kontrol et
  console.log("\\n[GCS Yedekleri - system_backups prefix]");
  try {
     const [files] = await bucket.getFiles({ prefix: "system_backups/" });
     if (files.length === 0) {
         console.log("Bulutta fiziksel (GCS) system_backups bulunamadı.");
     } else {
         for (const f of files) {
             const [meta] = await f.getMetadata();
             console.log(`- Yol: ${f.name} | Boyut: ${meta.size} bytes | Oluşturulma: ${meta.timeCreated}`);
         }
     }
  } catch(e: any) {
     console.log("GCS Yedek Kontrolü Hatası:", e.message);
  }
  
  // 2. Bugünkü eksik 14 PDF'nin durumu
  console.log("\\n[Bugünkü Kayıtlar ve Eksik PDF Kontrolü (17 Eylül)]");
  try {
     // Checking invoices
     const invSnap = await getDocs(collection(db, "invoices"));
     let checked = 0;
     let missing = 0;
     for (const d of invSnap.docs) {
         const data = d.data();
         if (data.created_at && data.created_at.includes("2026-09-17")) {
             checked++;
             if (data.fileUrl && data.fileUrl.includes("/api/files/")) {
                 const fileName = data.fileUrl.split("/api/files/")[1];
                 const gcsPath = "faturalar/" + fileName;
                 const [exists] = await bucket.file(gcsPath).exists();
                 if (!exists) {
                     missing++;
                     console.log(`- EKSİK PDF (Fatura): ID: ${d.id}, URL: ${data.fileUrl}`);
                 }
             }
         }
     }
     
     // Checking discounts
     const discSnap = await getDocs(collection(db, "discounts"));
     for (const d of discSnap.docs) {
         const data = d.data();
         if (data.created_at && data.created_at.includes("2026-09-17")) {
             checked++;
             for (const field of ['firstOfferFileUrl', 'finalOfferFileUrl']) {
                 if (data[field] && data[field].includes("/api/files/")) {
                     const fileName = data[field].split("/api/files/")[1];
                     const gcsPath = "faturalar/" + fileName;
                     const [exists] = await bucket.file(gcsPath).exists();
                     if (!exists) {
                         missing++;
                         console.log(`- EKSİK PDF (İndirim): ID: ${d.id}, Field: ${field}, URL: ${data[field]}`);
                     }
                 }
             }
         }
     }
     console.log(`Toplam Kontrol Edilen Bugünkü Kayıt: ${checked}`);
     console.log(`Bulutta (GCS) Fiziksel Olarak Olmayan Toplam Kayıp PDF: ${missing}`);
  } catch(e: any) {
     console.log("Kayıt Kontrolü Hatası:", e.message);
  }
  
  // 3. Firestore Yedek Koleksiyonlarının İçeriği
  console.log("\\n[Firestore 'system_backups', 'storage_files', 'storage_chunks' Analizi]");
  try {
     const sbSnap = await getDocs(collection(db, "system_backups"));
     console.log(`system_backups belge sayısı: ${sbSnap.size}`);
     for (const docSnap of sbSnap.docs) {
         const d = docSnap.data();
         let hasMetadata = Object.keys(d).some(k => k === "timestamp" || k === "invoices" || k === "success");
         let hasBytes = Object.keys(d).some(k => typeof d[k] === "string" && d[k].length > 100000);
         console.log(`- ${docSnap.id}: Metadata İçeriyor Mu: ${hasMetadata}, Ham PDF Byte'ı (Büyük String) İçeriyor Mu: ${hasBytes}`);
     }
     
     const sfSnap = await getDocs(collection(db, "storage_files"));
     console.log(`storage_files belge sayısı: ${sfSnap.size}`);
     let sfHasBytes = false;
     for (const docSnap of sfSnap.docs) {
         const d = docSnap.data();
         if (Object.keys(d).some(k => typeof d[k] === "string" && d[k].length > 10000)) sfHasBytes = true;
     }
     console.log(`- storage_files belgeleri ham byte içeriyor mu: ${sfHasBytes} (Yalnızca metadata beklenir)`);
     
     const scSnap = await getDocs(collection(db, "storage_chunks"));
     console.log(`storage_chunks belge sayısı: ${scSnap.size}`);
     let scHasBytes = false;
     if (scSnap.size > 0) {
         const d = scSnap.docs[0].data();
         if (Object.keys(d).some(k => typeof d[k] === "string" && d[k].length > 10000)) scHasBytes = true;
     }
     console.log(`- storage_chunks belgeleri ham byte içeriyor mu: ${scHasBytes} (Evet ise, PDF'ler DB'ye gömülmüş demektir)`);
     
  } catch(e: any) {
     console.log("Firestore Analiz Hatası:", e.message);
  }
}
run();
