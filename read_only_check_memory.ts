import fs from "fs";
import os from "os";

function run() {
  const BACKUP_DIR = '/tmp/data_backup';
  console.log("BACKUP DIR EXISTS:", fs.existsSync(BACKUP_DIR));
  if (fs.existsSync(BACKUP_DIR)) {
     const files = fs.readdirSync(BACKUP_DIR);
     console.log("FILES IN BACKUP DIR:", files);
     for(const f of files) {
        const p = BACKUP_DIR + "/" + f;
        const stats = fs.statSync(p);
        console.log(f, "size:", stats.size, "bytes, mtime:", stats.mtime);
     }
  }
}
run();
