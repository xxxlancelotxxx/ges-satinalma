import assert from 'node:assert/strict';
import { isLowPriorityConsumable } from './lowPriorityConsumables';

console.log('=== LOW-PRIORITY CONSUMABLE FILTER TESTS ===');

// Gizlenmesi gerekenler
const hide: Array<[string, string]> = [
  ['A4 Fotokopi / Yazıcı Kağıdı (80 g/m², 500 Yaprak Paket)', 'Ofis & Kırtasiye'],
  ['Orijinal Kyocera TK-8115K Siyah Toner Kartuşu [Orijinal OEM]', 'Bilgi İşlem & IT'],
  ['Logitech M185 Kablosuz Optik Mouse', 'Bilgi İşlem & IT'],
  ['DETERJAN GENEL PROPER 1.5 LT', 'Temizlik & Hijyen Malzemeleri'],
  ['Sıvı El Sabunu IQUP Clean Care (5 L Bidon) [Ekonomik]', 'Temizlik & Hijyen Malzemeleri'],
  ['Çöp Poşeti 30 L (6 Mikron, 20 Adet/Rulo) [Ekonomik]', 'Temizlik & Hijyen Malzemeleri'],
  ['Damacana İçme Suyu (19 Litre)', 'Mutfak, Gıda & İkram'],
  ['Şeffaf Koli Bandı 50 mm x 100 m', 'Sarf Malzeme & Hırdavat']
];
hide.forEach(([n, c]) => assert.equal(isLowPriorityConsumable(n, c), true, `should hide: ${n}`));
console.log(`✓ ${hide.length} ofis/kartuş/deterjan/ikram kalemi gizleniyor`);

// Asla gizlenmemesi gerekenler (gerçek malzemeler)
const keep: Array<[string, string]> = [
  ['A500C İnşaat Demiri Ø12 (11.7m GOST 34028)', 'İnşaat Demiri'],
  ['Granit Kırmataş Mıcır (5-20mm)', 'Hazır Beton, Çimento & Agrega'],
  ['Hilti Kimyasal Ankraj Dozajlama Tabancası HDM 500 Kartuşsuz', 'Ankraj Sistemleri'],
  ['Gazlı Çivi Tabancası Tüpü / Kartuşu (TOUA)', 'Sarf Malzeme & Hırdavat'],
  ['Mop Seramikleri icin yapisitirici Yapıştırıcı Harç 1074 SuperFlex (25 kg)', 'Hazır Beton, Çimento & Agrega'],
  ['Mutfak Evye Bataryası СоюзКран керам. картридж 35 mm', 'Seramik & Vitrifiye'],
  ['Краска интерьерная, моющаяся "WENDORA" EXPERT W214 14 kg', 'Kimyasallar & Boya'],
  ['Elektronik Total Station / Taheometre Leica TS07 Seti', 'Ölçüm, Harita & Saha Ekipmanları'],
  ['Bitümlü Su Yalıtım Membranı Техноэласт ЭПП 4.0 mm [Premium SBS]', 'Yalıtım & Alçıpan'],
  ['Masaüstü Bilgisayar Kasası Bigtech i9-13900KF', 'Bilgi İşlem & IT']
];
keep.forEach(([n, c]) => assert.equal(isLowPriorityConsumable(n, c), false, `must keep: ${n}`));
console.log(`✓ ${keep.length} gerçek malzeme (demir, mıcır, ankraj, boya, membran, bilgisayar) panelde kalıyor`);

console.log('>>> ALL LOW-PRIORITY FILTER TESTS PASSED <<<');
