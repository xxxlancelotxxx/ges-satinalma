import fs from "fs";

let code = fs.readFileSync("server.ts", "utf8");

// 1. Remove fallback from /api/upload-file
code = code.replace(
  /\/\/ 3\. Fallback: GCS başarısız olursa[\s\S]*?if \(!gcsSuccess && !fsSuccess\) \{[\s\S]*?return res\.status\(500\)\.json\(\{ success: false, error: "Sunucu dosyayı hiçbir yedekleme birimine yazamadı\. Veri kaybını önlemek için işlem iptal edildi\." \}\);\s*\}/,
  `if (!gcsSuccess) {
      console.error('[UPLOAD FATAL ERROR] File could not be saved to GCS.');
      return res.status(500).json({ success: false, error: "Sunucu dosyayı bulut depolama alanına yazamadı. Veri kaybını önlemek için işlem iptal edildi." });
    }`
);

// 2. Remove fallback from saveBase64File in discounts
code = code.replace(
  /let fsSuccess = false;\s*if \(db && !gcsSuccess\) \{[\s\S]*?fsSuccess = true;\s*\}\s*if \(!gcsSuccess && !fsSuccess\) \{/,
  `if (!gcsSuccess) {`
);
code = code.replace(
  /throw new Error\('Dosya kalıcı olarak kaydedilemedi \(GCS ve Firestore başarısız\)\.'\);/,
  `throw new Error('Dosya kalıcı olarak kaydedilemedi (Bulut Storage erişilemedi).');`
);

// 3. Update Invoices pre-save validation
const invoicesValidOld = `
          let foundInFs = false;
          if (db && !foundInGcs) {
             const verifyChunk = await getDoc(doc(db, 'storage_files', filename));
             if (verifyChunk.exists()) {
                foundInFs = true;
                fileSize = Number(verifyChunk.data()?.size || 0);
             }
          }
          if (!foundInGcs && !foundInFs) {
             return res.status(400).json({ error: 'Fatura belgesi fiziksel olarak sistemde (Storage/Chunk) bulunamadı. Lütfen dosyayı tekrar yükleyin.' });
          }
`.trim();
const invoicesValidNew = `
          if (!foundInGcs) {
             return res.status(400).json({ error: 'Fatura belgesi fiziksel olarak sistemde (Cloud Storage) bulunamadı. Lütfen dosyayı tekrar yükleyin.' });
          }
`.trim();
code = code.replace(invoicesValidOld, invoicesValidNew);

// 4. Update Discounts pre-save validation
const discValidOld = `
             let foundInFs = false;
             if (db && !foundInGcs) {
                const verifyChunk = await getDoc(doc(db, 'storage_files', filename));
                if (verifyChunk.exists()) {
                   foundInFs = true;
                   fileSize = Number(verifyChunk.data()?.size || 0);
                }
             }
             if (!foundInGcs && !foundInFs) {
                return res.status(400).json({ error: \`\${urlField === 'firstOfferFileUrl' ? 'İlk Teklif' : 'Son Fatura'} belgesi sistemde (Storage/Chunk) bulunamadı. Lütfen dosyayı tekrar yükleyin.\` });
             }
`.trim();
const discValidNew = `
             if (!foundInGcs) {
                return res.status(400).json({ error: \`\${urlField === 'firstOfferFileUrl' ? 'İlk Teklif' : 'Son Fatura'} belgesi fiziksel olarak sistemde (Cloud Storage) bulunamadı. Lütfen dosyayı tekrar yükleyin.\` });
             }
`.trim();
code = code.replace(discValidOld, discValidNew);

fs.writeFileSync("server.ts", code);
console.log("Patched server.ts successfully");
