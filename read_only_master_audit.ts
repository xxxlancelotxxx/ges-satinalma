import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";
import fs from "fs";

admin.initializeApp();

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  const goodBucketName = "ai-studio-bucket-88134939798-europe-west2";
  const badBucketName = "fatura-botu-505106.firebasestorage.app";
  const goodBucket = getStorage().bucket(goodBucketName);
  const badBucket = getStorage().bucket(badBucketName);

  const report: any = {
    testWriteResult: null,
    invoices: [],
    discounts: [],
    pdfChecks: []
  };

  // 5. Check test_write document
  try {
    const testDoc = await getDoc(doc(db, "system_backups", "test_write"));
    report.testWriteResult = { exists: testDoc.exists(), data: testDoc.data() };
  } catch(e: any) {
    report.testWriteResult = { error: e.message };
  }

  // 2. Fetch last 30 days records
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffIso = thirtyDaysAgo.toISOString();

  let activeCount = 0;
  let activeRecordsToProcess: any[] = [];

  try {
    const invSnap = await getDocs(query(collection(db, "invoices"), orderBy("created_at", "desc")));
    invSnap.forEach(d => {
      const data = d.data();
      if (data.created_at >= cutoffIso || data.date >= cutoffIso) {
        report.invoices.push({ id: d.id, type: "invoice", created_at: data.created_at, isDeleted: !!data.isDeleted });
        if (!data.isDeleted && activeCount < 20) {
           activeRecordsToProcess.push({ id: d.id, fileUrl: data.fileUrl });
           activeCount++;
        }
      }
    });

    const discSnap = await getDocs(query(collection(db, "discounts"), orderBy("created_at", "desc")));
    discSnap.forEach(d => {
      const data = d.data();
      if (data.created_at >= cutoffIso || data.orderDate >= cutoffIso) {
        report.discounts.push({ id: d.id, type: "discount", created_at: data.created_at, isDeleted: !!data.isDeleted });
        if (!data.isDeleted && activeCount < 20) {
           activeRecordsToProcess.push({ id: d.id, fileUrl: data.finalOfferFileUrl || data.firstOfferFileUrl });
           activeCount++;
        }
      }
    });
  } catch(e: any) {
    report.recordsError = e.message;
  }

  // 3. Check PDFs for 20 active records
  for (const rec of activeRecordsToProcess.slice(0, 20)) {
     if (!rec.fileUrl) {
         report.pdfChecks.push({ id: rec.id, fileUrl: null, status: "No URL in DB" });
         continue;
     }
     const fileName = rec.fileUrl.split('/').pop();
     if (!fileName) {
         report.pdfChecks.push({ id: rec.id, fileUrl: rec.fileUrl, status: "Invalid URL format" });
         continue;
     }
     
     let inGood = false;
     let inBad = false;
     try { inGood = (await goodBucket.file("faturalar/" + fileName).exists())[0]; } catch(e){}
     try { inBad = (await badBucket.file("faturalar/" + fileName).exists())[0]; } catch(e){}

     report.pdfChecks.push({
         id: rec.id,
         fileUrl: rec.fileUrl,
         fileName: fileName,
         inGoodBucket: inGood,
         inBadBucket: inBad,
         accessible: inGood || inBad
     });
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run();
