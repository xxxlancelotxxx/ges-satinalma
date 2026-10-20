import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getVendorKey,
  getCoreVendorKey,
  areVendorsEqual,
  normalizeVendorName,
  extractCanonicalVendors,
  isValidInvoiceNumber
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

  it('should strip Russian ИНН, КПП, postal codes, and addresses from supplier names', () => {
    assert.strictEqual(
      normalizeVendorName('ООО "М.С.К, ИНН 9721112370, КПП 773601001, 119331, Москва г, вн.тер.г. муниципальный округ Ломоносовский,"'),
      'ООО "М.С.К"'
    );
    assert.strictEqual(
      normalizeVendorName('ИНН 7751139859, КПП 775101001, ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ГК АТМОС", 108811, г. Москва, вн. тер.'),
      'ООО "ГК АТМОС"'
    );
    assert.strictEqual(
      normalizeVendorName('OОО "ВсеИнструменты.ру", ИНН 7722753969, КПП 997750001, Адрес: 109451, ГОРОД'),
      'ООО "ВсеИнструменты.ру"'
    );
    assert.strictEqual(
      areVendorsEqual('ООО "ТД Поинтер"', 'ИНН 7743772031, КПП 771501001, Общество с ограниченной ответственностью ТД "Поинтер", 127106, Москва'),
      true
    );
    assert.strictEqual(
      areVendorsEqual('ООО "М.С.К"', 'ООО "Системные Решения"'),
      false
    );
    assert.strictEqual(getCoreVendorKey('ООО "ТД Поинтер"'), 'поинтер');
  });

  it('should validate genuine invoice numbers and reject Russian warning words or bank accounts', () => {
    assert.strictEqual(isValidInvoiceNumber('УТ-7287'), true);
    assert.strictEqual(isValidInvoiceNumber('13334'), true);
    assert.strictEqual(isValidInvoiceNumber('208/245730'), true);
    assert.strictEqual(isValidInvoiceNumber('действителен'), false);
    assert.strictEqual(isValidInvoiceNumber('-оферта'), false);
    assert.strictEqual(isValidInvoiceNumber('-договор'), false);
    assert.strictEqual(isValidInvoiceNumber('должен'), false);
    assert.strictEqual(isValidInvoiceNumber('подлежит'), false);
    assert.strictEqual(isValidInvoiceNumber('б/н'), false);
    assert.strictEqual(isValidInvoiceNumber('40702810838000372965'), false);
    assert.strictEqual(isValidInvoiceNumber('30101810400000000225'), false);
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
