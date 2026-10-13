const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  `      try { await setDoc(doc(db, 'supervisors', id), newDoc); } catch (_) {}`,
  `      try { await setDoc(doc(db, 'supervisors', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }`
);

content = content.replace(
  `      try { await setDoc(doc(db, 'personnel', id), newDoc); } catch (_) {}`,
  `      try { await setDoc(doc(db, 'personnel', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }`
);

content = content.replace(
  `      try { await setDoc(doc(db, 'personnel', id), updatedDoc, { merge: true }); } catch (_) {}`,
  `      try { await setDoc(doc(db, 'personnel', id), updatedDoc, { merge: true }); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }`
);

content = content.replace(
  `      try { await setDoc(doc(db, 'personnel', id), { active: false }, { merge: true }); } catch (_) {}`,
  `      try { await setDoc(doc(db, 'personnel', id), { active: false }, { merge: true }); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }`
);

content = content.replace(
  `      try { await setDoc(doc(db, 'jobsites', id), newDoc); } catch (_) {}`,
  `      try { await setDoc(doc(db, 'jobsites', id), newDoc); } catch (e: any) { throw new Error('Veritabanına yazılamadı'); }`
);

fs.writeFileSync('server.ts', content, 'utf8');
