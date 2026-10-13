import fs from "fs";

function run() {
  const filePaths = [
    '/tmp/data_backup/manifest.json',
    '/tmp/data_backup/invoices.json',
    '/tmp/data_backup/discounts.json',
    'data_backup/manifest.json',
    'data_backup/invoices.json',
    'data_backup/discounts.json'
  ];
  
  for(const p of filePaths) {
     if (fs.existsSync(p)) {
        const stats = fs.statSync(p);
        console.log("EXISTS:", p, "size:", stats.size, "bytes, mtime:", stats.mtime);
     } else {
        console.log("MISSING:", p);
     }
  }
}
run();
