import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const bucketGoodName = "ai-studio-bucket-88134939798-europe-west2";
  const bucketGood = getStorage().bucket(bucketGoodName);

  try {
     const [jsonFiles] = await bucketGood.getFiles({ prefix: 'sistem-yedekleri/daily/' });
     const justJsons = jsonFiles.filter(f => f.name.endsWith('.json'));
     console.log("JSON BACKUP FILES IN GCS:", justJsons.length);
     
     if (justJsons.length > 0) {
        const sorted = justJsons.sort((a,b) => b.name.localeCompare(a.name));
        const latest = sorted[0];
        console.log("LATEST BACKUP GCS PATH:", latest.name);
        const [meta] = await latest.getMetadata();
        console.log("LATEST BACKUP CREATED AT:", meta.timeCreated);
        console.log("LATEST BACKUP SIZE:", meta.size, "bytes");
        
        // Count pdfs for this backup
        const pdfPrefix = latest.name.replace('.json', '/pdfs/');
        const [pdfFiles] = await bucketGood.getFiles({ prefix: pdfPrefix });
        console.log("LATEST BACKUP PDF COUNT:", pdfFiles.length);
     }
  } catch(e: any) {
     console.log("GCS ERROR:", e.message);
  }
}
run();
