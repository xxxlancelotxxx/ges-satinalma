import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import fs from "fs";

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  try {
     const id = `inv_${Date.now()}`;
     await setDoc(doc(db, "invoices", id), { test: true });
     console.log("Firestore write OK:", id);
  } catch(e: any) {
     console.log("Firestore ERROR:", e.message);
  }
}
run();
