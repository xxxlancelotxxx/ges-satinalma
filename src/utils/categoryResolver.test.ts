/**
 * KATEGORİ ÇÖZÜMLEYİCİ REGRESYON TESTLERİ
 * Kullanıcının bildirdiği ve denetimde bulunan yanlış kategori örnekleri. Biri kuralları bozarsa `npm test` hata verir.
 */
import assert from 'assert';
import { resolveItemCategory, classifyMaterialStrict, normalizeCategoryName } from './categoryClassifier';

const cases: Array<[string, string, string?]> = [
  // [orijinal fatura satırı, beklenen kategori, (opsiyonel) Türkçe ad]
  ['PEIKKO Арматура от продавливания PSB - СПИСОК', 'Donatı Malzemeleri', 'PEIKKO İnşaat Demiri от продавливания PSB - СПИСОК'],
  ['160 PEIKKO - КАРКАС 160мм', 'Donatı Malzemeleri'],
  ['Муфта A12 d=32 мм', 'Donatı Malzemeleri'],
  ['Основание под фиксаторы с круглым ограничителем(500шт;0,06куб/м;6,5кг)', 'Donatı Malzemeleri'],
  ['Арм. Пруток МД 12х11700 А500С ГОСТ 34028-2016', 'İnşaat Demiri'],
  ['Арматура А240 ф 8 ст3сп/пс 6000 (ГОСТ 34028-2016)', 'İnşaat Demiri'],
  ['Gigant Хомут-стяжка ленточная 3,6*150 черный,100 шт G/1/3', 'Elektrik & Otomasyon', 'Plastik Kablo Bağı (Cırt Kelepçe) 3.6x150 mm'],
  ['Правило алюминиевое 32х75 мм х 3 м (Турция)', 'El Aletleri & Hırdavat', 'Alüminyum Mastar 32x75 mm x 3 m'],
  ['Миксер для красок и штукатурных смесей, 100 х 600 мм, SDS Plus Denzel', 'El Aletleri & Hırdavat', 'Boya ve Harç Karıştırıcı Mikser Ucu'],
  ['КЕЛЬМА КАМЕНЩИКА 26СМ DEKOR', 'El Aletleri & Hırdavat', 'MALA SIVA 26 CM'],
  ['851829 Эпоксидный клей и ремонтный состав Sikadur-31+ RU (А) Ведро 4 кг', 'Kimyasallar & Boya', 'Epoksi Yapıştırıcı ve Tamir Harcı Sikadur-31+'],
  ['Кофемашина электрическая Beko TKM 2341', 'Gıda & Mutfak Malzemeleri', 'Elektrikli Kahve Makinesi Beko TKM 2341'],
  ['Стеклосетка фасадная щелочестойкая ТЕХНОНИКОЛЬ 2000', 'Yalıtım & Alçıpan'],
  ['Геотекстиль ТЕХНОНИКОЛЬ ГЕО 500, 2*50 м', 'Yalıtım & Alçıpan', 'Dornit Geotekstil Keçe 500 g/m² (Rulo)'],
  ['Сетка кладочная базальтовая 25х25 мм 50/50 кН/м 0,37х50 м рулон', 'Tuğla, Gazbeton & Duvar Blokları'],
  ['Блок для унитаза Бреф Сила-Актив микс 4х50г', 'Temizlik & Hijyen Malzemeleri'],
  ['Пружина концевая для отбойного молотка МО, МОП', 'El Aletleri & Hırdavat'],
  ['Клетка для 9 пропановых баллонов 50л', 'Şantiye Tesis & Konteyner'],
  ['Металлическое ограждение лестницы для двухъярусной кровати', 'Şantiye Mobilya & Yaşam Donanımı'],
  ['Подставка для обуви TI_Комус Онега-2/50', 'Şantiye Mobilya & Yaşam Donanımı'],
  ['Конверт белый E65 стрип 110х220 80г КОМУС 100шт/уп', 'Ofis & Kırtasiye', 'Komus Beyaz Zarf E65 Silikonlu'],
  ['Тачка строительная с колесом (90л.) Турция', 'El Aletleri & Hırdavat', 'İnşaat El Arabası Tekerlekli (90 Lt)'],
  ['Бита крестовая PH №2 50 мм. (10шт.)', 'El Aletleri & Hırdavat', 'Yıldız Vidalama Bits Ucu PH №2 50 mm'],
  // Ürün tipi sözlüğü (head-noun) — eskiden fatura başlığının kategorisini miras alanlar
  ['012 5-02 Выкл. авт. ВА88-32 3Р 125А 25кА MASTER IEK', 'Elektrik & Otomasyon'],
  ['Чистящее средство для плит Bagi ШУМАНИТ жидкость д/удаления жиров 3л', 'Temizlik & Hijyen Malzemeleri'],
  ['Куртка муж у23 чер 96-100/182-188', 'İş Güvenliği & KKD'],
  ['Лоток водоотводный BetoMax Drive ЛВ-30.36.26-Б бетонный 47471', 'Mekanik & Tesisat'],
  ['Труба ПЭ100 для х/в Дн110х10,0 Ру16 SDR11 40C L=12м ГОСТ 18599-2001', 'Mekanik & Tesisat'],
  ['Профхим антисептик кожный д/дезинфекции рук Grass/DESO C9, 5л', 'Temizlik & Hijyen Malzemeleri'],
  ['Антисептик Neomid 450 огнебиозащитный I группа красный 10 кг', 'Kimyasallar & Boya'],
  ['Емкость для воды пластиковая "ЕвроКуб" (1000 л.)', 'Şantiye Tesis & Konteyner'],
  ['Пистолет для монтажной пены пластик с метал.носом, без регулятора', 'El Aletleri & Hırdavat'],
  ['Замок врезной 2014 для межкомнатной двери под фиксатор хром 1 ключ', 'Sarf Malzeme & Hırdavat'],
  ['Vetonit Мультикомфорт гипсовая плита 2500x1200x12.5 УК ( 1 пал. / 48 шт./ 144 м2)', 'Yalıtım & Alçıpan', 'Darbe/Yangın/Suya Dayanıklı Alçıpan Levha DFH3IR (Sapfir) 12.5 mm (1.2x2.5 m) [Marka: Vetonit (Ветонит) • Seri: Мультикомфорт • 144 m²/Rulo • Ölçü 12.5x1200x2500]'],
  ['Vetonit Аква Оптима гипсовая плита 2500x1200x12.5 (1 пал. 50 шт./ 150 м2)', 'Yalıtım & Alçıpan', 'Suya Dayanıklı Alçıpan Levha Gyproc Optima [Standart] GKLV 12.5 mm (1.2x2.5 m)'],
  ['Бетон товарный БСГ (14x400, 14*400)', 'El Aletleri & Hırdavat', 'SDS Beton Matkap Ucu SDS-max (14x400 mm) (Adet)'],
  ['Носимая р/с Hytera BP515 U(1) (SC00973) 400-470 МГц, Стакан ЗУ 1А (CH10A07)', 'Ölçüm, Harita & Saha Ekipmanları', 'Hytera BP515 U(1) El Telsizi'],
  ['Доска магнитно-маркерная 120х240 см КОМУС в алюм. проф., лак', 'Ofis & Kırtasiye', 'Manyetik Yazı Tahtası 120x240 cm Komus Alüminyum Çerçeveli, Lake'],
  ['Подушка для смачивания пальцев гелевая ATTACHE 25г Россия', 'Ofis & Kırtasiye', 'Parmak Islatma Jeli / Süngeri Jel ATTACHE 25 gr'],
  ['Yarım Gövde Mastik Tabancası', 'El Aletleri & Hırdavat'],
  ['KVT NIO-06 «Profi» İzoleli Tornavida Seti', 'El Aletleri & Hırdavat'],
  ['İç Cephe Sıva Filesi (Стеклосетка 5x5 mm, 75 g/m², 50 m² Rulo) [Markasız / Standart Spesifikasyon]', 'Yalıtım & Alçıpan'],
  ['Сталь углеродистая для армирования железобетонных конструкций периодического профиля в d 20 мм А 500С', 'İnşaat Demiri'],
  ['City9 Box XS Sıva Üstü Dağıtım Kutusu 2 Modül, Şeffaf Kapaklı', 'Elektrik & Otomasyon'],
  ['57-300-050-09 Наконечник алюм. опресс. ТА 50-10-9 (100шт/уп)(КВТ) 41500 1-2 дня', 'Elektrik & Otomasyon'],
  ['Cablexpert Стяжки пластиковые 100 mm х 2.5 mm Beyaz (100 Adet), NYT-100x2.5', 'Sarf Malzeme & Hırdavat'],
  ['Vetonit Марко Про армирующая бумажная лента для стыков 50м', 'Yalıtım & Alçıpan', 'Kendinden Yapışkanlı Derz Filesi Bandı 50mm x 45m [Marka: Vetonit (Ветонит)]'],
  ['0307 Kaynakçı Maskesi "Хамелеон" Ф1 Monolit (20 Adet)', 'Kaynak Malzemeleri'],
  ['VPK E-tron 50/220/6/10 Yüksek Frekanslı Entegre Konvertörlü Beton Vibratörü (Adet)', 'El Aletleri & Hırdavat'],
];

let failed = 0;
for (const [orig, expected, name] of cases) {
  const got = resolveItemCategory({ originalName: orig, canonName: name || orig });
  if (got !== expected) {
    failed++;
    console.error(`✗ "${orig}" → ${got} (beklenen: ${expected})`);
  }
}
assert.strictEqual(failed, 0, `${failed} kategori testi başarısız`);
console.log(`✓ ${cases.length} gerçek fatura satırı doğru kategoriye düştü`);

// Büyük harfli Latin marka yazımı (Türkçe I→ı hatası) artık eşleşiyor
assert.strictEqual(classifyMaterialStrict('PEIKKO PSB'), 'Donatı Malzemeleri');
console.log('✓ Büyük harfli Latin marka (PEIKKO) Türkçe küçük harf hatasına takılmıyor');

// Fatura başlığından "İnşaat Demiri" miras alan, kendisi demir olmayan satır donatı aksesuarıdır
assert.strictEqual(normalizeCategoryName('İnşaat Demiri', 'МУФТА Спецификация'), 'Donatı Malzemeleri');
console.log('✓ "МУФТА Спецификация" İnşaat Demiri değil, Donatı Malzemeleri');

// Kullanıcının elle verdiği kategori her zaman kazanır
assert.strictEqual(resolveItemCategory({ originalName: 'Арм. Пруток МД 12х11700 А500С', manualCategory: 'Çelik Malzemeler' }), 'Çelik Malzemeler');
console.log('✓ Elle düzenlenen kategori korunuyor');

// Sentetik (gerçek olmayan) orijinal satır kategori kararında yok sayılır
assert.strictEqual(resolveItemCategory({ originalName: 'Бетон товарный БСГ ГОСТ 7473 (14*400)', canonName: 'D.BOR SDS-max Beton Matkap Ucu 14*400/540' }), 'El Aletleri & Hırdavat');
console.log('✓ Sentetik orijinal satır ("Бетон товарный БСГ…") matkap ucunu betona taşımıyor');

console.log('>>> ALL CATEGORY RESOLVER TESTS PASSED <<<');
