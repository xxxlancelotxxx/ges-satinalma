import fs from "fs";
let code = fs.readFileSync("server.ts", "utf8");
code = code.replace("items: normItems,", "items: normItems || [],");
fs.writeFileSync("server.ts", code);
