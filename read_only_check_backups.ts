import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  const snap = await getDocs(collection(db, "system_backups"));
  console.log("system_backups collection size:", snap.size);
  if (!snap.empty) {
     console.log("Docs:", snap.docs.map(d => ({id: d.id, createdAt: d.data().createdAt, status: d.data().status})));
  }
}
run();
