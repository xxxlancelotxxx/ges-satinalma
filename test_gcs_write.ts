import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const bucketGoodName = "ai-studio-bucket-88134939798-europe-west2";
  const bucketGood = getStorage().bucket(bucketGoodName);

  try {
     await bucketGood.file('test').save('test content');
     console.log("GCS WRITE SUCCESS");
  } catch(e: any) {
     console.log("GCS WRITE FAILED:", e.message);
  }
}
run();
