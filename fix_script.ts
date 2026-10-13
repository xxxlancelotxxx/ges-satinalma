import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

const invoicesCheckCode = `
    // PDF Varoluş Kontrolü
    if (newDoc.fileUrl) {
      try {
        const urlObj = new URL(newDoc.fileUrl, 'http://localhost');
        const filename = decodeURIComponent(urlObj.pathname.split('/').pop() || '');
        if (filename) {
          let foundInGcs = false;
          let fileSize = 0;
          if (bucket) {
             const [exists] = await bucket.file(\`faturalar/\${filename}\`).exists();
             if (exists) {
                foundInGcs = true;
                const [meta] = await bucket.file(\`faturalar/\${filename}\`).getMetadata();
                fileSize = Number(meta.size || 0);
             }
          }
          let foundInFs = false;
          if (db && !foundInGcs) {
             const verifyChunk = await db.collection('storage_files').doc(filename).get();
             if (verifyChunk.exists) {
                foundInFs = true;
                fileSize = Number(verifyChunk.data()?.size || 0);
             }
          }
          if (!foundInGcs && !foundInFs) {
             return res.status(400).json({ error: 'Fatura belgesi fiziksel olarak sistemde bulunamadı (Yükleme başarısız olmuş). Kayıt işlemi iptal edildi. Lütfen dosyayı tekrar yükleyin.' });
          }
          if (fileSize === 0) {
             return res.status(400).json({ error: 'Dosya sistemde görünüyor ancak boyutu 0 byte. Yükleme hatalı. Kayıt iptal edildi.' });
          }
        }
      } catch (e: any) {
        return res.status(400).json({ error: 'Fatura dosyası doğrulanamadı: ' + e.message });
      }
    }
`;

// Also idempotency for invoices
const invoicesIdempotency = `
    const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body.idempotencyKey || '').trim();
    if (idempotencyKey && db) {
        try {
            const idempotencyRef = db.collection('idempotency_keys').doc(idempotencyKey);
            const idempDoc = await idempotencyRef.get();
            if (idempDoc.exists) {
                const prevResponse = idempDoc.data()?.response;
                if (prevResponse) return res.status(200).json(prevResponse);
            }
        } catch(e){}
    }
`;

// Save idempotency at the end of invoice
const invoiceIdempotencySave = `
    if (idempotencyKey && db && firestoreStatus === 'success') {
       try { await setDoc(doc(db, 'idempotency_keys', idempotencyKey), { response: newDoc, createdAt: new Date().toISOString() }); } catch(e){}
    }
`;

// Repeat for discounts... we will do this properly with a script.
