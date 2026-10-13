const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  `      } catch (e: any) {
        console.error('[FIRESTORE DISCOUNT WRITE ERROR]:', e.message);
        firestoreStatus = 'failed';
      }
    }`,
  `      } catch (e: any) {
        console.error('[FIRESTORE DISCOUNT WRITE ERROR]:', e.message);
        throw new Error('Kritik Hata: Firestore veritabanına veri yazılamadı. Veri kaybını önlemek için işlem iptal edildi.');
      }
    } else {
      throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }`
);

content = content.replace(
  `    if (db) {
      try { await setDoc(doc(db, 'invoices', invId), newInvoice); } catch (e) { console.warn('[FIRESTORE INVOICE WRITE WARN]:', e); }
    }`,
  `    if (db) {
      try { await setDoc(doc(db, 'invoices', invId), newInvoice); } catch (e: any) { 
        console.error('[FIRESTORE INVOICE WRITE WARN]:', e); 
        throw new Error('Kritik Hata: İndirime bağlı fatura veritabanına kaydedilemedi.');
      }
    } else {
       throw new Error('Kritik Hata: Veritabanı bağlantısı yok.');
    }`
);

fs.writeFileSync('server.ts', content, 'utf8');
