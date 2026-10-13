import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  try {
     const testDoc = await getDoc(doc(db, "system_backups", "test_write"));
     console.log("test_write EXISTS:", testDoc.exists(), "DATA:", testDoc.data());
  } catch(e: any) {
     console.log("ERROR:", e.message);
  }
}
run();
