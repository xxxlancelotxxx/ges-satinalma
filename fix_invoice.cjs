const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  `    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;
    if (db) {
      try {
        await setDoc(doc(db, 'invoices', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'invoices', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Invoice doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE INVOICE WRITE ERROR]:', e.message);
        firestoreStatus = 'failed';
      }
    }`,
  `    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;
    if (db) {
      try {
        await setDoc(doc(db, 'invoices', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'invoices', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Invoice doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE INVOICE WRITE ERROR]:', e.message);
        throw new Error('Kritik Hata: Fatura veritabanına kaydedilemedi.');
      }
    } else {
      throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }`
);
fs.writeFileSync('server.ts', content, 'utf8');
