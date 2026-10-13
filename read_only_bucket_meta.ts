import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";
import fs from "fs";

admin.initializeApp();

async function run() {
  const goodName = "ai-studio-bucket-88134939798-europe-west2";
  const badName = "fatura-botu-505106.firebasestorage.app";
  const storage = getStorage();

  const report: any = {};
  
  try {
      const [goodMeta] = await storage.bucket(goodName).getMetadata();
      report[goodName] = { 
          exists: true, 
          projectNumber: goodMeta.projectNumber, 
          id: goodMeta.id, 
          location: goodMeta.location,
          storageClass: goodMeta.storageClass
      };
  } catch(e:any) { report[goodName] = { exists: false, error: e.message, code: e.code }; }

  try {
      const [badMeta] = await storage.bucket(badName).getMetadata();
      report[badName] = { 
          exists: true, 
          projectNumber: badMeta.projectNumber, 
          id: badMeta.id, 
          location: badMeta.location,
          storageClass: badMeta.storageClass
      };
  } catch(e:any) { report[badName] = { exists: false, error: e.message, code: e.code }; }

  console.log("METADATA_REPORT:", JSON.stringify(report, null, 2));
}
run();
