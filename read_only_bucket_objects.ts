import { getStorage } from "firebase-admin/storage";
import admin from "firebase-admin";

admin.initializeApp();

async function run() {
  const goodName = "ai-studio-bucket-88134939798-europe-west2";
  const storage = getStorage();
  const bucket = storage.bucket(goodName);

  try {
      const [files] = await bucket.getFiles({ prefix: 'sistem-yedekleri/daily/' });
      console.log(`FOUND ${files.length} objects in sistem-yedekleri/daily/`);
      files.forEach(f => console.log(f.name, f.metadata.size, f.metadata.timeCreated));
  } catch(e:any) { 
      console.log("LIST ERROR:", e.message); 
  }
}
run();
