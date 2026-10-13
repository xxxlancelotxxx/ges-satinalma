import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import fs from "fs";

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  try {
     await setDoc(doc(db, "system_backups", "test_write"), { success: true });
     console.log("WRITE SUCCESS");
  } catch(e: any) {
     console.log("WRITE FAILED:", e.message);
  }
}
run();
