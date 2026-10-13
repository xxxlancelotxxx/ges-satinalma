import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const badName = "fatura-botu-505106.firebasestorage.app";
  const storage = getStorage();
  const bucket = storage.bucket(badName);

  try {
      const [files] = await bucket.getFiles({ maxResults: 10 });
      console.log(`FOUND ${files.length} objects in bad bucket`);
  } catch(e:any) { 
      console.log("LIST ERROR BAD BUCKET:", e.message, e.code); 
  }
}
run();
