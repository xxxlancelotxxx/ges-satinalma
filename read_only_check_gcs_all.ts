import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const bucketGoodName = "ai-studio-bucket-88134939798-europe-west2";
  const bucketGood = getStorage().bucket(bucketGoodName);

  try {
     const [allFiles] = await bucketGood.getFiles({ maxResults: 100 });
     console.log("SOME FILES IN GCS:");
     allFiles.forEach(f => console.log(f.name, f.metadata.timeCreated));
  } catch(e: any) {
     console.log("GCS ERROR:", e.message);
  }
}
run();
