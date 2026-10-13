import fetch from "node-fetch";

async function run() {
  console.log("Triggering backup...");
  try {
      const res = await fetch('http://localhost:3000/api/admin/backups/create', { method: 'POST' });
      const data = await res.json();
      console.log(data);
  } catch(e: any) {
      console.log("ERROR:", e.message);
  }
}
run();
