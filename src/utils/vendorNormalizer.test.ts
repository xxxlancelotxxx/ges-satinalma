import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getVendorKey,
  areVendorsEqual,
  normalizeVendorName,
  extractCanonicalVendors
} from './vendorNormalizer';

describe('Smart Vendor Normalizer Engine', () => {
  it('should unify quotes variations (OOO "УВМ-СТАЛЬ vs OOO "УВМ-СТАЛЬ")', () => {
    const v1 = 'ООО "УВМ-СТАЛЬ';
    const v2 = 'ООО "УВМ-СТАЛЬ"';
    const v3 = 'ООО «УВМ-СТАЛЬ»';

    assert.strictEqual(areVendorsEqual(v1, v2), true);
    assert.strictEqual(areVendorsEqual(v2, v3), true);
    assert.strictEqual(normalizeVendorName(v1), 'ООО "УВМ-СТАЛЬ"');
    assert.strictEqual(normalizeVendorName(v2), 'ООО "УВМ-СТАЛЬ"');
    assert.strictEqual(normalizeVendorName(v3), 'ООО "УВМ-СТАЛЬ"');
  });

  it('should unify full Russian legal entity with acronym (Общество с ограниченной ответственностью vs ООО)', () => {
    const full = 'Общество с ограниченной ответственностью "Системные Решения"';
    const short = 'ООО "Системные Решения';
    const shortQuoted = 'ООО "Системные Решения"';

    assert.strictEqual(areVendorsEqual(full, short), true);
    assert.strictEqual(areVendorsEqual(short, shortQuoted), true);
    assert.strictEqual(normalizeVendorName(full), 'ООО "Системные Решения"');
    assert.strictEqual(normalizeVendorName(short), 'ООО "Системные Решения"');
  });

  it('should unify Latin OOO lookalikes with Cyrillic ООО', () => {
    const latin = 'OOO "БИМ ПРИБОРЫ"';
    const cyrillic = 'ООО "БИМ ПРИБОРЫ';

    assert.strictEqual(areVendorsEqual(latin, cyrillic), true);
    assert.strictEqual(normalizeVendorName(latin), 'ООО "БИМ ПРИБОРЫ"');
  });

  it('should unify AO variations with guillemets or missing quotes', () => {
    const ao1 = 'АО "ПРОМСТРОЙКОНТРАКТ';
    const ao2 = 'АО «ПРОМСТРОЙКОНТРАКТ';
    const ao3 = 'АО "ПРОМСТРОЙКОНТРАКТ"';

    assert.strictEqual(areVendorsEqual(ao1, ao2), true);
    assert.strictEqual(areVendorsEqual(ao2, ao3), true);
    assert.strictEqual(normalizeVendorName(ao1), 'АО "ПРОМСТРОЙКОНТРАКТ"');
  });

  it('should aggregate and deduplicate vendor lists with extractCanonicalVendors', () => {
    const rawList = [
      { vendorName: 'ООО "УВМ-СТАЛЬ' },
      { vendorName: 'ООО "УВМ-СТАЛЬ"' },
      { vendorName: 'ООО «УВМ-СТАЛЬ»' },
      { vendorName: 'АО "ПРОМСТРОЙКОНТРАКТ' },
      { vendorName: 'АО "ПРОМСТРОЙКОНТРАКТ"' },
      { vendorName: 'ООО "САМ' }
    ];

    const canonical = extractCanonicalVendors(rawList);
    assert.strictEqual(canonical.length, 3);

    const uvm = canonical.find(c => c.name === 'ООО "УВМ-СТАЛЬ"');
    assert.ok(uvm);
    assert.strictEqual(uvm.count, 3);

    const psk = canonical.find(c => c.name === 'АО "ПРОМСТРОЙКОНТРАКТ"');
    assert.ok(psk);
    assert.strictEqual(psk.count, 2);
  });
});
