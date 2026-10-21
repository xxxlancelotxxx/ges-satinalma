import assert from 'node:assert/strict';
import { splitGroupBySpec, areSpecSignaturesCompatible } from './materialGroupIntegrity';
import { analyzeMaterialSegment } from './materialSegmentIntelligence';

type E = { o: string; u: string };
const split = (rows: E[]) => splitGroupBySpec(rows, r => r.o, r => r.u);
const groupsOf = (rows: E[]) => split(rows).map(p => p.entries.map(e => e.o).sort());

console.log('=== MATERIAL GROUP INTEGRITY GUARD TESTS ===');

// 1. Çivi / Dübel-çivi / Kama ankraj asla aynı grupta olmaz
{
  const g = groupsOf([
    { o: 'Дюбель-гвоздь 6*40,потай,нейлон, 200 шт.в уп.', u: 'Adet' },
    { o: 'Анкер-клин М6x40 (100шт.)', u: 'Paket' },
    { o: 'гвоздь потайной борт 6х40', u: 'ADET' },
    { o: 'гвоздь потайной борт 6х40', u: 'ADET' }
  ]);
  assert.equal(g.length, 3, 'nail/dowel/anchor must split into 3');
  console.log('✓ Çivi / Dübel-çivi / Kama ankraj ayrıldı');
}

// 2. İş eldiveni vs kauçuk eldiven
assert.equal(areSpecSignaturesCompatible('Перчатки рабочие защитные', 'Перчатки резиновые'), false);
console.log('✓ İş eldiveni ≠ kauçuk eldiven');

// 3. Sabun vs kova
assert.equal(areSpecSignaturesCompatible('Мыло жидкое КЛЕВЕР 5л канистра', 'Емкость / ведро строительное (5 L)'), false);
console.log('✓ Sıvı sabun ≠ kova');

// 4. Mikron belirtmeyen film 200 mikronla kıyaslanmaz
{
  const g = groupsOf([
    { o: 'Пленка полиэтиленовая 200 мкм', u: 'rulo' },
    { o: 'Пленка укрывная техническая 3х100м (300м2) 200 мкр, рулон', u: 'Rulo' },
    { o: 'Пленка полиэтиленовая техническая ГОСТ 10354', u: 'Rulo' }
  ]);
  assert.equal(g.length, 2, 'unspecified-micron film must be separated');
  console.log('✓ Mikron belirtilmeyen film ayrıldı');
}

// 5. Çöp poşeti: 10 adet rulo vs 50 adet paket, 30 vs 80 mikron
assert.equal(areSpecSignaturesCompatible('Мешки для мусора ПВД 240л 50мкм 10шт/рул', 'Мешки для мусора ПВД 240л 50шт/уп 80мкм'), false);
console.log('✓ 10 adet/rulo ≠ 50 adet/paket');

// 6. Harç markası M-150 vs M-100, mukavemet sınıfı 5.8 vs 6.8
assert.equal(areSpecSignaturesCompatible('Сухая смесь М-150 (50кг)', 'Смесь цементно-песчаная (ЦПС) М-100 50кг'), false);
assert.equal(areSpecSignaturesCompatible('Шпилька DIN 975 М10 к.п. 5.8', 'Шпилька DIN 975 М10 к.п. 6.8'), false);
console.log('✓ M-150 ≠ M-100, sınıf 5.8 ≠ 6.8');

// 7. Keramzit beton bloğu ≠ keramzit agrega; SBS astar ≠ bitüm astar
assert.equal(areSpecSignaturesCompatible('KERAMZITOBETONNIY BLOK ПСКЦ, D1300, 390x90x188 мм', 'Керамзит фр. 10-20 биг бэги'), false);
assert.equal(areSpecSignaturesCompatible('Праймер битумный Икопал, 21,5 л', '40000130 Праймер СБС ИКОПАЛ 21,5л'), false);
console.log('✓ Blok ≠ agrega, SBS astar ≠ bitüm astar');

// 8. Aynı ürün farklı yazımlar BÖLÜNMEMELİ (yanlış alarm olmamalı)
{
  const rebar = groupsOf([
    { o: 'Арм. Пруток МД 32х11700 А500С ГОСТ 34028-2016', u: 'Ton' },
    { o: 'Арматура ребристая Q32 mm (A500C)', u: 'TON' },
    { o: 'Сталь углеродистая для армирования ... d 32 мм А 500С', u: 'Ton' }
  ]);
  assert.equal(rebar.length, 1, 'rebar spellings must stay together');
  const drywall = groupsOf([
    { o: 'Гипсокартон Knauf 2500x1200х12,5 mm Gri', u: 'ADET' },
    { o: 'Гипсокартон Knauf 2500х1200х12,5 мм Серый', u: 'ADET' }
  ]);
  assert.equal(drywall.length, 1, 'same drywall must stay together');
  const bags = groupsOf([
    { o: 'Мешки для мусора ПНД 30л 6мкм 20шт/рул черные 48х58см Luscan', u: 'rulo' },
    { o: 'Пакеты для мусора 30л Эконом, 20шт, рулон, ПНД, 50*60см, 6мкм', u: 'Paket' }
  ]);
  assert.equal(bags.length, 1, '48x58 ≈ 50x60 must stay together');
  const timber = groupsOf([
    { o: 'Доска обрезная 50х100х6000 (120 шт в пачке)', u: 'M3' },
    { o: 'Доска обрезная 5х10х600 см', u: 'M3' }
  ]);
  assert.equal(timber.length, 1, 'mm/cm timber spellings priced per m3 must stay together');
  console.log('✓ Aynı ürünün farklı yazımları birlikte kaldı (demir, alçıpan, poşet, kereste)');
}

// 9. Leica total station asla alçıpan segmentine girmez
{
  const seg = analyzeMaterialSegment('Standart Alçıpan Levha Knauf [Premium] GKL 12.5 mm (1.2x2.5 m)', 'Гипсокартон Knauf', 'Yalıtım & Alçıpan', 450);
  assert.equal(seg.qualitySegment, 'PREMIUM');
  assert.equal(areSpecSignaturesCompatible('Тахеометр LEICA TS07 R1000 (5") Зарядное устройство GKL311', 'Гипсокартон Knauf 2500x1200х12,5'), false);
  console.log('✓ Segment etiketi isimden okunuyor; Leica ≠ alçıpan');
}

// 10. Kereste GOST vs TU, Sort 1 vs Sort 1-2 vs Sort 2 ve Kavak (Осина) vs Çam ayrımı
{
  assert.equal(
    areSpecSignaturesCompatible(
      '01-14Г Доска обрезная ЕВ 50*200*6000 (сорт-1, ГОСТ) 16шт. в 1м.куб, 60шт/пач. профилир.',
      '01-09О Доска обрезная ЕВ 50*200*6000 (сорт-1, ТУ) 16шт. в 1м.куб, Осина профилир.'
    ),
    false,
    'GOST Pine must never be compatible with TU Aspen'
  );
  assert.equal(
    areSpecSignaturesCompatible(
      '01-14Г Доска обрезная ЕВ 50*200*6000 (сорт-1, ГОСТ)',
      '01-102Г Доска обрезная ЕВ 50*200*6000, ГОСТ (сорт 1-2)'
    ),
    false,
    'Sort-1 must never be compatible with Sort 1-2'
  );
  const splitTimber = split([
    { o: '01-14Г Доска обрезная ЕВ 50*200*6000 (сорт-1, ГОСТ) 16шт. в 1м.куб', u: 'M3' },
    { o: '01-09О Доска обрезная ЕВ 50*200*6000 (сорт-1, ТУ) Осина', u: 'M3' },
    { o: '01-102Г Доска обрезная ЕВ 50*200*6000, ГОСТ (сорт 1-2)', u: 'M3' }
  ]);
  assert.equal(splitTimber.length, 3, 'GOST Sort-1, TU Sort-1 Aspen, and GOST Sort 1-2 must split into 3 groups');
  console.log('✓ Kereste GOST / TU / Sort-1 / Sort 1-2 / Kavak(Осина) kesin olarak ayrıldı');
}

console.log('>>> ALL GROUP INTEGRITY TESTS PASSED <<<');

