import fs from "fs";
const code = fs.readFileSync("server.ts", "utf8");
console.log("storage_chunks occurrences:", (code.match(/storage_chunks/g) || []).length);
