import fs from "fs";
let code = fs.readFileSync("server.ts", "utf8");
code = code.replace(/if \(firestoreStatus === 'failed'/g, "if ((firestoreStatus as string) === 'failed'");
fs.writeFileSync("server.ts", code);
