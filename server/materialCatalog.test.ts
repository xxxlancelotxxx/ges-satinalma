import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MaterialAliasIndex, MaterialAliasStore, buildMergeAliases, buildSplitAlias, catalogKeyForName, aliasKeysForItem } from './materialCatalog';

console.log('=== MATERIAL CATALOG (ALIAS) TESTS ===');

const TARGET = 'Kağıt Maskeleme Bandı 48 mm x 50 m';
const aliases = buildMergeAliases({
  sourceGroupNames: ['Лента малярная 48 mm х 50 m'],
  targetName: TARGET,
  targetCategory: 'Sarf Malzeme & Hırdavat',
  entries: [
    { originalName: 'Лента малярная 48мм х 50м', originalIsGenuine: true, materialName: 'Лента малярная 48мм х 50м' },
    { originalName: 'Скотч малярный 48 мм*50 м', originalIsGenuine: true, materialName: 'MASKELEME BANDI 48X50', materialCode: 'st-000123' }
  ],
  now: '2026-10-18T00:00:00.000Z'
});
const index = new MaterialAliasIndex(aliases);

// 1. Hedef anahtarı ad parmak izidir (compare grup anahtarıyla aynı uzay)
assert.ok(aliases.every(a => a.targetKey === catalogKeyForName(TARGET)));
console.log('✓ Alias hedef anahtarı = katalog anahtarı');

// 2. Aynı Rusça satır farklı yazımla yeniden gelirse hedefe düşer (yeni OCR faturası)
assert.equal(index.lookup({ originalName: 'Лента малярная 48 мм * 50 м', originalIsGenuine: true, materialName: 'Başka çeviri' })?.targetName, TARGET);
console.log('✓ Yeni faturadaki aynı satır (farklı yazım) birleştirilmiş kayda düşüyor');

// 3. Prizma stok kodu en yüksek öncelik, büyük/küçük harf duyarsız
assert.equal(index.lookup({ materialCode: 'ST-000123', materialName: 'Tamamen farklı isim 1' })?.kind, 'code');
console.log('✓ Prizma stok kodu ile eşleşme');

// 4. Kural motorunun ürettiği eski grup adı da hedefe yönlenir
assert.equal(index.lookup({ canonName: 'Лента малярная 48 mm х 50 m' })?.targetName, TARGET);
console.log('✓ Kaynak grup adı hedefe yönleniyor');

// 5. Farklı ölçü eşleşmez (yanlış birleşme yok)
assert.equal(index.lookup({ originalName: 'Лента малярная 48мм х 25м', originalIsGenuine: true, materialName: 'Лента малярная 48мм х 25м', canonName: 'Лента малярная 48 mm х 25 m' }), undefined);
console.log('✓ Farklı ölçü (48x25) eşleşmiyor');

// 6. Sentetik/genel satırlar alias anahtarı üretmez
assert.deepEqual(aliasKeysForItem({ originalName: 'Строительно-монтажный материал', originalIsGenuine: false, materialName: 'Malzeme' }), []);
console.log('✓ Sentetik / ayırt edici olmayan satırlar alias üretmiyor');

// 7. Disk yedeği ile kalıcılık (Firestore yokken) ve geri alma
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-test-'));
(async () => {
  const store = new MaterialAliasStore(() => null, dir);
  const r = await store.save(aliases);
  assert.equal(r.persisted, false);
  const reloaded = new MaterialAliasStore(() => null, dir);
  await reloaded.ensureLoaded();
  assert.equal(reloaded.index.size, aliases.length);
  assert.equal(reloaded.index.lookup({ materialCode: 'ST-000123' })?.targetName, TARGET);
  console.log('✓ Alias kayıtları yeniden başlatmadan sonra disk yedeğinden yükleniyor');

  const v = reloaded.index.version;
  const removed = await reloaded.remove(aliases.map(a => a.id));
  assert.equal(removed.removed.length, aliases.length);
  assert.ok(reloaded.index.version > v);
  assert.equal(reloaded.index.lookup({ materialCode: 'ST-000123' }), undefined);
  console.log('✓ Geri alma (alias silme) çalışıyor ve önbellek damgası artıyor');

  // Satır ayırma: yanlış gruba düşen satır kendi kaydına taşınır ve aynı satır yeniden gelirse orada kalır
  const split = buildSplitAlias({ originalName: 'Скотч малярный 48 мм*50 м', targetName: 'Скотч малярный 48x50 (Ayrı Kayıt)', sourceGroupName: TARGET, now: '2026-10-18T00:00:00.000Z' });
  assert.ok(split);
  assert.equal(split!.kind, 'orig');
  assert.equal(split!.targetKey, catalogKeyForName('Скотч малярный 48x50 (Ayrı Kayıt)'));
  const splitIndex = new MaterialAliasIndex([split!]);
  assert.equal(splitIndex.lookup({ originalName: 'Скотч малярный 48мм х 50м', originalIsGenuine: true, materialName: 'x' })?.targetName, 'Скотч малярный 48x50 (Ayrı Kayıt)');
  assert.equal(buildSplitAlias({ originalName: '12', targetName: 'a', sourceGroupName: 'b' }), null);
  console.log('✓ Satır ayırma alias\'ı doğru; ayırt edici olmayan satırda alias üretilmiyor');

  // Kalıcılık durumu raporlanıyor (db yokken: disk kaynağı, Firestore yazımı başarısız)
  assert.equal(reloaded.source, 'disk');
  await reloaded.save([split!]);
  assert.equal(reloaded.lastWriteOk, false);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('✓ Kalıcılık durumu (kaynak / son yazım) raporlanıyor');
  console.log('✅ Tüm katalog testleri geçti');
})().catch(e => { console.error(e); process.exit(1); });
