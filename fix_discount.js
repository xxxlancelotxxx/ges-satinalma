const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const target = `    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;
    if (db) {
      try {
        await setDoc(doc(db, 'discounts', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'discounts', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Discount doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE DISCOUNT WRITE ERROR]:', e.message);
        firestoreStatus = 'failed';
      }
    }`;

const replacement = `    let firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback' = 'local_fallback';
    let readBackVerified = false;
    if (db) {
      try {
        await setDoc(doc(db, 'discounts', id), newDoc);
        const verifyDoc = await getDoc(doc(db, 'discounts', id));
        if (verifyDoc.exists()) {
          readBackVerified = true;
          firestoreStatus = 'success';
        } else {
          console.warn('[Firestore Validation] Discount doc written but read-back check failed');
          firestoreStatus = 'warning';
        }
      } catch (e: any) {
        console.error('[FIRESTORE DISCOUNT WRITE ERROR]:', e.message);
        throw new Error('Kritik Hata: Firestore veritabanına veri yazılamadı. Veri kaybını önlemek için işlem iptal edildi.');
      }
    } else {
      throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }`;

const newContent = content.replace(target, replacement);
fs.writeFileSync('server.ts', newContent, 'utf8');
console.log(content.includes(target));
