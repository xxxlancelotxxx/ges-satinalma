import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import fs from "fs";

async function run() {
  const cfg = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);
  const snap = await getDoc(doc(db, "system_backups", "snap_1789484117785_a66044"));
  if (snap.exists()) {
     console.log("SNAP:", JSON.stringify(snap.data(), null, 2));
  }
}
run();
