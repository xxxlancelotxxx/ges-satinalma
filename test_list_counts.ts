import fetch from 'node-fetch';
async function run() {
  const i = await fetch('http://localhost:3000/api/invoices').then(r => r.json());
  const d = await fetch('http://localhost:3000/api/discounts').then(r => r.json());
  console.log("Active Invoices via API:", i.length);
  console.log("Active Discounts via API:", d.length);
}
run();
