import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

// Remove duplicated block in discounts
code = code.replace(`
    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }

    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }
`, `
    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }
`);

// Same for invoices if duplicated
code = code.replace(`
    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }

    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }
`, `
    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }
`);

// Make TS happy by casting
code = code.replace(`if (firestoreStatus === 'failed' && !localBackupSuccess)`, `if ((firestoreStatus as string) === 'failed' && !localBackupSuccess)`);
code = code.replace(`if (firestoreStatus === 'failed' && !localBackupSuccess)`, `if ((firestoreStatus as string) === 'failed' && !localBackupSuccess)`);

fs.writeFileSync("server.ts", code);
console.log("Syntax fixed");
