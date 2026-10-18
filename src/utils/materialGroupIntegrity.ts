/**
 * Material Group Integrity Guard (3-Layer Original Invoice Text Engine)
 * ------------------------------------------------------------------
 * Son güvenlik katmanı: Normalizasyon motoru iki faturadaki kalemi aynı
 * malzeme grubuna koymuş olsa bile, ORİJİNAL Rusça fatura satırlarında:
 *   1) Marka / Alt-Marka (ТехноНИКОЛЬ, Baswool, Knauf, Volma, Rennbohr, АРМАТА veya sözlük dışı dinamik marka)
 *   2) Ürün Serisi / Yoğunluk / Teknik Alt-Sınıf (Техновент Н, Техновент Оптима, Фасад 120, Гео С, Комфорт, Quadro 4-грани vb.)
 *   3) Fiziksel Spesifikasyon (ürün tipi, ölçü, mikron, litre, paket adedi, M diş, harç markası, mukavemet sınıfı, kova/torba kg)
 * çelişiyorsa bu kalemler Mod 1 (Elma-Elma) kapsamında ASLA aynı fiyat kıyaslamasına girmez; grup otomatik bölünür.
 */

export interface SpecSignature {
  type?: string;
  brand?: string;
  series?: string;
  dims?: string;
  micron?: string;
  litre?: string;
  pack?: string;
  thread?: string;
  grade?: string;
  strength?: string;
  bagKg?: string;
}

const SPEC_KEYS: Array<keyof SpecSignature> = [
  'type',
  'brand',
  'series',
  'dims',
  'micron',
  'litre',
  'pack',
  'thread',
  'grade',
  'strength',
  'bagKg'
];

export interface OriginalBrandAndSeriesInfo {
  isCommodity: boolean;
  brandKey?: string;
  brandLabel?: string;
  seriesKey?: string;
  seriesLabel?: string;
  tier: 'COMMODITY' | 'PREMIUM' | 'STANDARD' | 'ECONOMY';
}

// Birbirini dışlayan ürün tipi aileleri (sıra önemlidir: daha spesifik olan önce).
const PRODUCT_TYPE_FAMILIES: Array<{ type: string; label: string; pattern: RegExp }> = [
  { type: 'dyubel-gvozd', label: 'Dübel-Çivi (Дюбель-гвоздь)', pattern: /дюбель[\s-]*гвозд|дюбель\s+с\s+гвозд/ },
  { type: 'anker-klin', label: 'Kama Ankraj (Анкер-клин)', pattern: /анкер[\s-]*клин/ },
  { type: 'anker', label: 'Ankraj (Анкер)', pattern: /(?:^|[^а-яё])анкер(?![\s-]*клин)/ },
  { type: 'dyubel', label: 'Dübel (Дюбель)', pattern: /(?:^|[^а-яё])дюбел(?![ья]?[\s-]*гвозд)/ },
  { type: 'gvozd', label: 'Çivi (Гвоздь)', pattern: /(?:^|[^а-яё])гвозд/ },
  { type: 'samorez', label: 'Vida (Саморез)', pattern: /саморез/ },
  { type: 'perchatki-rezin', label: 'Kauçuk/Lateks/Nitril Eldiven', pattern: /перчатки\s+(?:[а-яёa-z]+\s+)?(?:резинов|латекс|нитрил|виниловы)/ },
  { type: 'perchatki-rab', label: 'İş Eldiveni (Перчатки рабочие)', pattern: /перчатки\s+(?:[а-яёa-z]+\s+)?(?:рабоч|х\/б|хб|трикотаж|защитн|с\s+пвх|спилк|утепл)/ },
  { type: 'mylo', label: 'Sabun (Мыло)', pattern: /мыло/ },
  { type: 'gips', label: 'Alçı (Гипс)', pattern: /(?:^|[^а-яё])гипс(?!окартон|оволок|ов[а-я]*\s+плит|ов[а-я]*\s+лист)/ },
  { type: 'nozh', label: 'Bıçak (Нож)', pattern: /(?:^|[^а-яё])нож(?!ниц|овк)/ },
  { type: 'lezvie', label: 'Bıçak Yedeği (Лезвие)', pattern: /лезви/ },
  { type: 'shayba-grover', label: 'Yaylı Pul (Гровер)', pattern: /гровер|пружинн/ },
  { type: 'blok', label: 'Duvar Bloğu (Блок)', pattern: /керамзитобетон|keramzitobeton|газобетон|(?:^|[^а-яa-z])(?:блок|blok)(?![а-яa-z]*\s*(?:питан|управл|розет|контейнер))/ },
  { type: 'keramzit-agrega', label: 'Keramzit Agregası (Гравий/Песок)', pattern: /керамзит(?!обетон)|keramzit(?!obeton)/ },
  { type: 'praimer-sbs', label: 'SBS Modifiye Astar (Праймер СБС)', pattern: /праймер\s+сбс|сбс[\s-]*праймер/ },
  { type: 'praimer-bitum', label: 'Bitüm Astarı (Праймер битумный)', pattern: /праймер\s+битумн|битумн[а-я]*\s+праймер/ },
  { type: 'geodezi', label: 'Ölçüm Cihazı (Тахеометр / Нивелир)', pattern: /тахеометр|нивелир|leica|теодолит|трегер/ },
  { type: 'gipsokarton', label: 'Alçıpan Levha (Гипсокартон)', pattern: /гипсокартон|гипрок|gyproc|сапфир\s+гсп|гипсовая\s+плита|(?:^|[^а-яa-z0-9])гкл[во]?(?![а-яa-z0-9])/ },
  // Ambalaj/kap kelimesi en sonda: "kovada astar" astardır, kova değildir
  { type: 'vedro', label: 'Kova / Bidon (Ведро / Емкость)', pattern: /(?:^|[^а-яё])(?:ведро|емкость|ёмкость)/ },
];

// Kapsamlı Marka ve Alt-Marka (Üreticiyi Temsil Eden Ürün Ailesi) Sözlüğü
const BRAND_AND_SUBBRAND_RULES: Array<{
  brandKey: string;
  brandLabel: string;
  tier: 'PREMIUM' | 'STANDARD' | 'ECONOMY';
  pattern: RegExp;
}> = [
  // Yalıtım, Membran & Alçıpan Markaları ve Alt Serileri
  {
    brandKey: 'TECHNONICOL',
    brandLabel: 'ТехноНИКОЛЬ',
    tier: 'STANDARD',
    pattern: /технониколь|technonicol|tekhnonikol|техновент|tehnovent|технофас|tehnofas|техноблок|tehnoblok|техноруф|tehnoruf|технофлор|tehnoflor|техноакустик|роклайт|roklayt|техноэласт|техноеласт|technoelast|унифлекс|uniflex|биполь|bipol|бикрост|bikrost|линокром|linokrom|ультранап|ultranap|carbon\s*prof|carbonproof|карбон\s*проф|logicpir|логикпир|logicbase|лоджикбейз|planter|плантер/i
  },
  {
    brandKey: 'BASWOOL',
    brandLabel: 'Baswool',
    tier: 'STANDARD',
    pattern: /baswool|басвул/i
  },
  {
    brandKey: 'PENOPLEX',
    brandLabel: 'Пеноплэкс',
    tier: 'PREMIUM',
    pattern: /пеноплэкс|пеноплекс|penoplex/i
  },
  {
    brandKey: 'ICOPAL',
    brandLabel: 'Икопал (ВиллаТекс)',
    tier: 'PREMIUM',
    pattern: /икопал|icopal|ikopal|виллатекс|villatex|villateks/i
  },
  {
    brandKey: 'SIKA',
    brandLabel: 'Sika',
    tier: 'PREMIUM',
    pattern: /\bsika\b|sikaplan|waterbar|сика\b|зика\b/i
  },
  {
    brandKey: 'KNAUF',
    brandLabel: 'Knauf (Кнауф)',
    tier: 'PREMIUM',
    pattern: /knauf|кнауф|ротбанд|rotband|фюген|fügen|сапфир\s+гсп|гсп[\s-]*dfh3ir/i
  },
  {
    brandKey: 'VETONIT',
    brandLabel: 'Vetonit (Ветонит)',
    tier: 'PREMIUM',
    pattern: /vetonit|ветонит|weber|вебер|мультикомфорт/i
  },
  {
    brandKey: 'VOLMA',
    brandLabel: 'Волма (Volma)',
    tier: 'STANDARD',
    pattern: /volma|волма/i
  },
  {
    brandKey: 'GYPROC',
    brandLabel: 'Gyproc (Гипрок)',
    tier: 'STANDARD',
    pattern: /gyproc|гипрок/i
  },
  {
    brandKey: 'MAGMA',
    brandLabel: 'Магма (Magma)',
    tier: 'ECONOMY',
    pattern: /magma|магма/i
  },
  {
    brandKey: 'ROCKWOOL',
    brandLabel: 'Rockwool (Роквул)',
    tier: 'PREMIUM',
    pattern: /rockwool|роквул|лайт\s*баттс|фасад\s*баттс/i
  },
  {
    brandKey: 'ISOVER',
    brandLabel: 'Isover (Изовер)',
    tier: 'STANDARD',
    pattern: /isover|изовер/i
  },
  {
    brandKey: 'URSA',
    brandLabel: 'Ursa (Урса)',
    tier: 'STANDARD',
    pattern: /\bursa\b|урса\b/i
  },
  {
    brandKey: 'PAROC',
    brandLabel: 'Paroc (Парок)',
    tier: 'PREMIUM',
    pattern: /paroc|парок/i
  },
  {
    brandKey: 'IZOPLAST',
    brandLabel: 'Изопласт',
    tier: 'STANDARD',
    pattern: /изопласт|izoplast/i
  },
  {
    brandKey: 'DORNIT',
    brandLabel: 'Дорнит',
    tier: 'STANDARD',
    pattern: /дорнит|dornit/i
  },

  // Gazbeton, Blok, Kuru Harç & Yapı Kimyasalları
  {
    brandKey: 'BONOLIT',
    brandLabel: 'Bonolit',
    tier: 'PREMIUM',
    pattern: /bonolit|бонолит/i
  },
  {
    brandKey: 'ISTKULT',
    brandLabel: 'Istkult (Ytong)',
    tier: 'PREMIUM',
    pattern: /istkult|исткульт|ytong|итонг/i
  },
  {
    brandKey: 'LITOKOL',
    brandLabel: 'Litokol',
    tier: 'PREMIUM',
    pattern: /litokol|литокол|литобанд/i
  },
  {
    brandKey: 'CERESIT',
    brandLabel: 'Ceresit',
    tier: 'PREMIUM',
    pattern: /ceresit|церезит/i
  },
  {
    brandKey: 'MAPEI',
    brandLabel: 'Mapei',
    tier: 'PREMIUM',
    pattern: /mapei|мапей/i
  },
  {
    brandKey: 'OSNOVIT',
    brandLabel: 'Основит',
    tier: 'STANDARD',
    pattern: /основит|osnovit|селформ/i
  },
  {
    brandKey: 'DAUER',
    brandLabel: 'Dauer (Дауер)',
    tier: 'STANDARD',
    pattern: /dauer|дауер|quader\s*block/i
  },
  {
    brandKey: 'BAZEL',
    brandLabel: 'Bazel',
    tier: 'STANDARD',
    pattern: /\bbazel\b|базель/i
  },
  {
    brandKey: 'BYSTROY',
    brandLabel: 'Быстрой',
    tier: 'ECONOMY',
    pattern: /быстрой/i
  },
  {
    brandKey: 'STARATELI',
    brandLabel: 'Старатели',
    tier: 'STANDARD',
    pattern: /старатели|starateli/i
  },
  {
    brandKey: 'UNIS',
    brandLabel: 'Unis (Юнис)',
    tier: 'STANDARD',
    pattern: /\bunis\b|юнис/i
  },
  {
    brandKey: 'BERGAUF',
    brandLabel: 'Bergauf',
    tier: 'STANDARD',
    pattern: /bergauf|бергауф/i
  },

  // Delici/Kesici Uçlar, El Aletleri, Hırdavat & Ankraj Markaları
  {
    brandKey: 'RENNBOHR',
    brandLabel: 'Rennbohr',
    tier: 'PREMIUM',
    pattern: /rennbohr|реннбор/i
  },
  {
    brandKey: 'ARMATA',
    brandLabel: 'Армата',
    tier: 'STANDARD',
    pattern: /армата|armata/i
  },
  {
    brandKey: 'MKSS',
    brandLabel: 'MKSS Toolbox',
    tier: 'STANDARD',
    pattern: /\bmkss\b|mkss\s*toolbox/i
  },
  {
    brandKey: 'MESSER',
    brandLabel: 'Messer',
    tier: 'STANDARD',
    pattern: /\bmesser\b|мессер/i
  },
  {
    brandKey: 'PIRANHA',
    brandLabel: 'Piranha',
    tier: 'STANDARD',
    pattern: /piranha|пиранья/i
  },
  {
    brandKey: 'DBOR',
    brandLabel: 'D.BOR',
    tier: 'STANDARD',
    pattern: /d\.?\s*bor\b|д\.?\s*бор\b/i
  },
  {
    brandKey: 'PRAKTIKA',
    brandLabel: 'Практика',
    tier: 'STANDARD',
    pattern: /практика|praktika/i
  },
  {
    brandKey: 'REZOLUX',
    brandLabel: 'Резолюкс',
    tier: 'STANDARD',
    pattern: /резолюкс|rezolux/i
  },
  {
    brandKey: 'SIBRTECH',
    brandLabel: 'Сибртех',
    tier: 'ECONOMY',
    pattern: /сибртех|sibrtech/i
  },
  {
    brandKey: 'KAPRO',
    brandLabel: 'Kapro',
    tier: 'PREMIUM',
    pattern: /kapro|капро/i
  },
  {
    brandKey: 'MATRIX',
    brandLabel: 'Matrix',
    tier: 'ECONOMY',
    pattern: /\bmatrix\b|матрикс/i
  },
  {
    brandKey: 'GROSS',
    brandLabel: 'Gross',
    tier: 'PREMIUM',
    pattern: /\bgross\b|гросс/i
  },
  {
    brandKey: 'FISCO',
    brandLabel: 'Fisco',
    tier: 'PREMIUM',
    pattern: /\bfisco\b|фиско/i
  },
  {
    brandKey: 'KITAN',
    brandLabel: 'Kitan',
    tier: 'STANDARD',
    pattern: /\bkitan\b|китан/i
  },
  {
    brandKey: 'KARBOSAN',
    brandLabel: 'Karbosan',
    tier: 'PREMIUM',
    pattern: /karbosan|карбосан/i
  },
  {
    brandKey: 'LUGA',
    brandLabel: 'ЛугаАбразив',
    tier: 'STANDARD',
    pattern: /луга|luga/i
  },
  {
    brandKey: 'HILTI',
    brandLabel: 'Hilti',
    tier: 'PREMIUM',
    pattern: /\bhilti\b|хилти/i
  },
  {
    brandKey: 'BOSCH',
    brandLabel: 'Bosch',
    tier: 'PREMIUM',
    pattern: /\bbosch\b|бош\b/i
  },
  {
    brandKey: 'MAKITA',
    brandLabel: 'Makita',
    tier: 'PREMIUM',
    pattern: /\bmakita\b|макита/i
  },
  {
    brandKey: 'DEWALT',
    brandLabel: 'DeWalt',
    tier: 'PREMIUM',
    pattern: /\bdewalt\b|деволт/i
  },
  {
    brandKey: 'METABO',
    brandLabel: 'Metabo',
    tier: 'PREMIUM',
    pattern: /\bmetabo\b|метабо/i
  },
  {
    brandKey: 'ZUBR',
    brandLabel: 'Зубр',
    tier: 'STANDARD',
    pattern: /зубр|\bzubr\b/i
  },
  {
    brandKey: 'KRAFTOOL',
    brandLabel: 'Kraftool',
    tier: 'STANDARD',
    pattern: /kraftool|крафтул/i
  },
  {
    brandKey: 'STAYER',
    brandLabel: 'Stayer',
    tier: 'STANDARD',
    pattern: /stayer|стайер/i
  },
  {
    brandKey: 'STALMAX',
    brandLabel: 'Stalmax',
    tier: 'STANDARD',
    pattern: /stalmax|сталмакс/i
  },
  {
    brandKey: 'KREP_KOMP',
    brandLabel: 'КРЕП-КОМП',
    tier: 'STANDARD',
    pattern: /креп[\s-]*комп|(?:^|\s)комп\s+(?:анкер|перфорирован)/i
  },
  {
    brandKey: 'GIGANT',
    brandLabel: 'Gigant',
    tier: 'STANDARD',
    pattern: /\bgigant\b|гигант/i
  },
  {
    brandKey: 'KRANZ',
    brandLabel: 'Kranz',
    tier: 'STANDARD',
    pattern: /\bkranz\b|кранц/i
  },
  {
    brandKey: 'DAXMER',
    brandLabel: 'Daxmer',
    tier: 'STANDARD',
    pattern: /daxmer|дахмер/i
  },
  {
    brandKey: 'BOGIRUS',
    brandLabel: 'Bogirus',
    tier: 'STANDARD',
    pattern: /bogirus|богирус/i
  },
  {
    brandKey: 'CONCON',
    brandLabel: 'Concon',
    tier: 'STANDARD',
    pattern: /concon|конкон/i
  },
  {
    brandKey: 'BAUMAK',
    brandLabel: 'Logo Baumak',
    tier: 'STANDARD',
    pattern: /baumak|баумак/i
  },
  {
    brandKey: 'CUPLOCK',
    brandLabel: 'CupLock',
    tier: 'STANDARD',
    pattern: /cuplock|каплок/i
  },
  {
    brandKey: 'TEHNOPLAST',
    brandLabel: 'Технопласт',
    tier: 'STANDARD',
    pattern: /технопласт/i
  },

  // Kaynak, Gaz, Elektrik & Kablo Aksesuarları
  {
    brandKey: 'ASKAYNAK',
    brandLabel: 'Askaynak',
    tier: 'PREMIUM',
    pattern: /askaynak|аскайнак|\bas\s*r[\s-]*143\b/i
  },
  {
    brandKey: 'ESAB',
    brandLabel: 'ESAB',
    tier: 'PREMIUM',
    pattern: /\besab\b|эсаб/i
  },
  {
    brandKey: 'MONOLIT',
    brandLabel: 'Monolit',
    tier: 'STANDARD',
    pattern: /monolit|монолит/i
  },
  {
    brandKey: 'KRASS',
    brandLabel: 'Krass',
    tier: 'STANDARD',
    pattern: /\bkrass\b|красс/i
  },
  {
    brandKey: 'ARMA',
    brandLabel: 'Arma',
    tier: 'STANDARD',
    pattern: /\barma\b\s+горелк/i
  },
  {
    brandKey: 'VERTEXTOOLS',
    brandLabel: 'Vertextools',
    tier: 'STANDARD',
    pattern: /vertextools/i
  },
  {
    brandKey: 'SAMWELD',
    brandLabel: 'Samweld',
    tier: 'STANDARD',
    pattern: /samweld/i
  },
  {
    brandKey: 'AMKODOR',
    brandLabel: 'Амкодор',
    tier: 'STANDARD',
    pattern: /амкодор|amkodor/i
  },
  {
    brandKey: 'VRT',
    brandLabel: 'ВРТ',
    tier: 'STANDARD',
    pattern: /(?:^|[^а-яё])врт(?![а-яё])/i
  },
  {
    brandKey: 'HIMPT',
    brandLabel: 'HIMPT',
    tier: 'STANDARD',
    pattern: /\bhimpt\b/i
  },
  {
    brandKey: 'EVREN',
    brandLabel: 'Evren',
    tier: 'STANDARD',
    pattern: /\bevren\b/i
  },
  {
    brandKey: 'REXANT',
    brandLabel: 'Rexant',
    tier: 'STANDARD',
    pattern: /rexant|рексант/i
  },
  {
    brandKey: 'TDM',
    brandLabel: 'TDM Electric',
    tier: 'STANDARD',
    pattern: /\btdm\b|тдм|sq\d{4}/i
  },
  {
    brandKey: 'FORTISFLEX',
    brandLabel: 'Fortisflex',
    tier: 'STANDARD',
    pattern: /fortisflex|фортисфлекс/i
  },
  {
    brandKey: 'PROFLEEC',
    brandLabel: 'PRO Profleec',
    tier: 'PREMIUM',
    pattern: /profleec/i
  },
  {
    brandKey: 'IEK',
    brandLabel: 'IEK (ИЭК)',
    tier: 'STANDARD',
    pattern: /\biek\b|иэк/i
  },
  {
    brandKey: 'EKF',
    brandLabel: 'EKF',
    tier: 'STANDARD',
    pattern: /\bekf\b|экф/i
  },
  {
    brandKey: 'DKC',
    brandLabel: 'DKC (ДКС)',
    tier: 'PREMIUM',
    pattern: /\bdkc\b|дкс/i
  },
  {
    brandKey: 'SCHNEIDER',
    brandLabel: 'Schneider Electric',
    tier: 'PREMIUM',
    pattern: /schneider|шнайдер/i
  },
  {
    brandKey: 'ABB',
    brandLabel: 'ABB',
    tier: 'PREMIUM',
    pattern: /\babb\b/i
  },
  {
    brandKey: 'LEGRAND',
    brandLabel: 'Legrand',
    tier: 'PREMIUM',
    pattern: /legrand|легран/i
  },

  // Boya, Köpük & Kimyasallar
  {
    brandKey: 'PICANTE',
    brandLabel: 'Picante',
    tier: 'PREMIUM',
    pattern: /picante|пиканте/i
  },
  {
    brandKey: 'KRASIVO',
    brandLabel: 'Красиво',
    tier: 'STANDARD',
    pattern: /красиво\s+эмаль/i
  },
  {
    brandKey: 'MOSKVICHKA',
    brandLabel: 'Москвичка',
    tier: 'STANDARD',
    pattern: /москвичка/i
  },
  {
    brandKey: 'TIKKURILA',
    brandLabel: 'Tikkurila',
    tier: 'PREMIUM',
    pattern: /tikkurila|тиккурила/i
  },
  {
    brandKey: 'CAPAROL',
    brandLabel: 'Caparol',
    tier: 'PREMIUM',
    pattern: /caparol|капарол/i
  },
  {
    brandKey: 'DULUX',
    brandLabel: 'Dulux',
    tier: 'PREMIUM',
    pattern: /dulux|дулюкс/i
  },
  {
    brandKey: 'MARSHALL',
    brandLabel: 'Marshall',
    tier: 'STANDARD',
    pattern: /marshall|маршал/i
  },
  {
    brandKey: 'KUDO',
    brandLabel: 'Kudo',
    tier: 'STANDARD',
    pattern: /\bkudo\b|кудо/i
  },
  {
    brandKey: 'PENOSIL',
    brandLabel: 'Penosil',
    tier: 'PREMIUM',
    pattern: /penosil|пеносил/i
  },
  {
    brandKey: 'SOUDAL',
    brandLabel: 'Soudal',
    tier: 'PREMIUM',
    pattern: /soudal|соудал/i
  },
  {
    brandKey: 'MAKROFLEX',
    brandLabel: 'Makroflex',
    tier: 'STANDARD',
    pattern: /makroflex|макрофлекс/i
  },
  {
    brandKey: 'TYTAN',
    brandLabel: 'Tytan',
    tier: 'PREMIUM',
    pattern: /tytan|титан\s*проф/i
  },
  {
    brandKey: 'EMULSOL',
    brandLabel: 'Эмульсол',
    tier: 'STANDARD',
    pattern: /эмульсол/i
  },
  {
    brandKey: 'MASTER_ROAD',
    brandLabel: 'Мастер Роуд',
    tier: 'STANDARD',
    pattern: /мастер\s*роуд/i
  },

  // İSG (СИЗ), Ofis, Temizlik & Gıda Markaları
  {
    brandKey: 'OKAPROM',
    brandLabel: 'ОкаПром',
    tier: 'STANDARD',
    pattern: /окапром/i
  },
  {
    brandKey: 'SANTAL',
    brandLabel: 'Santal',
    tier: 'PREMIUM',
    pattern: /\bsantal\b|сантал/i
  },
  {
    brandKey: 'SIRIUS',
    brandLabel: 'Сириус',
    tier: 'STANDARD',
    pattern: /сириус/i
  },
  {
    brandKey: 'MISTRAL',
    brandLabel: 'Мистраль',
    tier: 'STANDARD',
    pattern: /мистраль/i
  },
  {
    brandKey: 'PERFECT_PROTECTION',
    brandLabel: 'Перфект Протекшен',
    tier: 'PREMIUM',
    pattern: /перфект\s*протекшен/i
  },
  {
    brandKey: 'STAFF',
    brandLabel: 'Staff',
    tier: 'STANDARD',
    pattern: /\bstaff\b/i
  },
  {
    brandKey: 'SAMGRUPP',
    brandLabel: 'Samgrupp',
    tier: 'ECONOMY',
    pattern: /samgrupp/i
  },
  {
    brandKey: 'VILEDA',
    brandLabel: 'Vileda',
    tier: 'PREMIUM',
    pattern: /vileda|виледа/i
  },
  {
    brandKey: 'LUSCAN',
    brandLabel: 'Luscan',
    tier: 'STANDARD',
    pattern: /luscan|лускан/i
  },
  {
    brandKey: 'EKO_DOM',
    brandLabel: 'Эко Дом',
    tier: 'ECONOMY',
    pattern: /эко\s*дом/i
  },
  {
    brandKey: 'KLEVER',
    brandLabel: 'Клевер',
    tier: 'STANDARD',
    pattern: /клевер/i
  },
  {
    brandKey: 'ZODIAK',
    brandLabel: 'Зодиак',
    tier: 'ECONOMY',
    pattern: /зодиак/i
  },
  {
    brandKey: 'PROPER',
    brandLabel: 'Proper',
    tier: 'PREMIUM',
    pattern: /\bproper\b|мистер\s*пропер/i
  },
  {
    brandKey: 'ILIM',
    brandLabel: 'Илим Стандарт',
    tier: 'STANDARD',
    pattern: /\bилим\b/i
  },
  {
    brandKey: 'KOMUS',
    brandLabel: 'Комус',
    tier: 'STANDARD',
    pattern: /комус/i
  },
  {
    brandKey: 'SVETOCOPY',
    brandLabel: 'SvetoCopy',
    tier: 'STANDARD',
    pattern: /svetocopy|светокопи/i
  },
  {
    brandKey: 'PROMEGA',
    brandLabel: 'ProMega',
    tier: 'STANDARD',
    pattern: /promega|mega\s*engineer/i
  },
  {
    brandKey: 'LOGITECH',
    brandLabel: 'Logitech',
    tier: 'PREMIUM',
    pattern: /logitech/i
  },
  {
    brandKey: 'KYOCERA',
    brandLabel: 'Kyocera',
    tier: 'PREMIUM',
    pattern: /kyocera/i
  },
  {
    brandKey: 'CANON',
    brandLabel: 'Canon',
    tier: 'PREMIUM',
    pattern: /\bcanon\b/i
  },
  {
    brandKey: 'AHMAD_TEA',
    brandLabel: 'Ahmad Tea',
    tier: 'PREMIUM',
    pattern: /ahmad/i
  },
  {
    brandKey: 'MAYSKIY',
    brandLabel: 'Майский',
    tier: 'STANDARD',
    pattern: /майский/i
  },
  {
    brandKey: 'TASSAY',
    brandLabel: 'Tassay',
    tier: 'PREMIUM',
    pattern: /tassay/i
  },
  {
    brandKey: 'DELOVOY_STANDART',
    brandLabel: 'Деловой стандарт',
    tier: 'STANDARD',
    pattern: /деловой\s*стандарт/i
  },
  {
    brandKey: 'RUSSKIY_SAHAR',
    brandLabel: 'Русский',
    tier: 'STANDARD',
    pattern: /сахар.*русский/i
  }
];

// Ürün Serisi, Yoğunluk Sınıfı ve Teknik Alt-Tip Kuralları (Aynı marka içinde dahi farklı serileri ayırır)
const PRODUCT_SERIES_RULES: Array<{
  seriesKey: string;
  seriesLabel: string;
  pattern: RegExp;
}> = [
  // Taşyünü & XPS Yalıtım Yoğunluk ve Seri Sınıfları
  { seriesKey: 'TEHNOVENT_OPTIMA', seriesLabel: 'Техновент Оптима', pattern: /техновент\s*оптима|tehnovent\s*optima/i },
  { seriesKey: 'TEHNOVENT_STANDART', seriesLabel: 'Техновент Стандарт', pattern: /техновент\s*стандарт|tehnovent\s*standart/i },
  { seriesKey: 'TEHNOVENT_N', seriesLabel: 'Техновент Н', pattern: /техновент\s*н(?![а-яa-z])|tehnovent\s*n(?![a-z])/i },
  { seriesKey: 'FASAD_120', seriesLabel: 'Фасад 120 (120 кг/м³)', pattern: /фасад\s*120|fasad\s*120/i },
  { seriesKey: 'ROKLAYT', seriesLabel: 'Роклайт', pattern: /роклайт|roklayt/i },
  { seriesKey: 'TEHNOFAS', seriesLabel: 'Технофас', pattern: /технофас|tehnofas/i },
  { seriesKey: 'TEHNOBLOK', seriesLabel: 'Техноблок', pattern: /техноблок|tehnoblok/i },
  { seriesKey: 'CARBON_PROF', seriesLabel: 'Carbon Prof', pattern: /carbon\s*prof|carbonproof|карбон\s*проф/i },
  { seriesKey: 'GEO_S', seriesLabel: 'Гео С', pattern: /гео\s*с(?![а-яa-z])|geo\s*c(?![a-z])/i },
  { seriesKey: 'KOMFORT_XPS', seriesLabel: 'Комфорт', pattern: /пеноплэкс\s*комфорт|пеноплекс\s*комфорт/i },
  { seriesKey: 'FUNDAMENT', seriesLabel: 'Фундамент', pattern: /техноэласт\s*фундамент|техноеласт\s*фундамент/i },
  { seriesKey: 'EPP_3.0', seriesLabel: 'ЭПП 3.0 мм', pattern: /эпп\s*3(?:[.,]0)?\s*(?:мм|mm|15м)?/i },
  { seriesKey: 'EPP_4.0', seriesLabel: 'ЭПП 4.0 мм', pattern: /эпп\s*4(?:[.,]0)?\s*(?:мм|mm|10м)?/i },

  // Alçıpan Özel Serileri
  { seriesKey: 'SAPFIR_DFH3IR', seriesLabel: 'Сапфир DFH3IR', pattern: /сапфир|dfh3ir/i },
  { seriesKey: 'MULTIKOMFORT', seriesLabel: 'Мультикомфорт', pattern: /мультикомфорт/i },

  // Delici/Kırıcı Uç Kesici Kafa & Dübel Yaka Geometrisi
  { seriesKey: 'QUADRO_4', seriesLabel: 'Quadro (4 Kesicili)', pattern: /\bquadro\b|4\s*грани/i },
  { seriesKey: 'POTAYNAYA', seriesLabel: 'Потайная манжета', pattern: /потайн[а-я]*\s*(?:манжет|борт)/i },
  { seriesKey: 'GRIBOVIDNY', seriesLabel: 'Грибовидный бортик', pattern: /грибовидн[а-я]*\s*борт/i },

  // Bant Malzeme Türü (Флис vs Х/Б vs ПВХ)
  { seriesKey: 'TAPE_FLEECE', seriesLabel: 'Флис (Keçe Bant)', pattern: /изолента.*флис|profleec/i },
  { seriesKey: 'TAPE_COTTON', seriesLabel: 'Х/Б (Bez Bant)', pattern: /изолента\s*(?:х\/б|хб)/i },
  { seriesKey: 'TAPE_PVC', seriesLabel: 'ПВХ', pattern: /изолента\s*пвх/i },

  // Eldiven & İSG Yalıtım / Kapama Tipi
  { seriesKey: 'KRAGI_INSULATED', seriesLabel: 'Утепленные мехом', pattern: /краги.*утеплен|утепленные\s+искусственным\s+мехом/i },
  { seriesKey: 'KRAGI_UNINSULATED', seriesLabel: 'Без утепления', pattern: /краги.*без\s*утеплен/i },
  { seriesKey: 'PLASH_BUTTONS', seriesLabel: 'На кнопках', pattern: /на\s*кнопках/i },
  { seriesKey: 'PLASH_VELCRO', seriesLabel: 'На липучках', pattern: /на\s*липучках/i },
  { seriesKey: 'ZHILET_TIP1T', seriesLabel: 'Тип 1Т', pattern: /жилет.*тип\s*1\s*т/i },
  { seriesKey: 'ZHILET_TIP2T', seriesLabel: 'Тип 2Т', pattern: /жилет.*тип\s*2\s*т/i },
  { seriesKey: 'ZHILET_TIP8T', seriesLabel: 'Тип 8Т', pattern: /жилет.*тип\s*8\s*т/i },

  // Yangın Örtüsü, Hortum, Askı & Kimyasal Seri Kodları
  { seriesKey: 'FIRE_CLOTH_PP300', seriesLabel: 'ПП-300', pattern: /пп[\s-]*300/i },
  { seriesKey: 'FIRE_CLOTH_PP600', seriesLabel: 'ПП-600', pattern: /пп[\s-]*600/i },
  { seriesKey: 'ULTRANEODIL_500', seriesLabel: 'Марка 500', pattern: /ультранеодил\s*500/i },
  { seriesKey: 'ULTRANEODIL_300', seriesLabel: 'Марка 300', pattern: /ультранеодил\s*300/i },
  { seriesKey: 'HOSE_WITH_GR', seriesLabel: 'В сборе с ГР', pattern: /в\s*сборе\s*с\s*гр/i },
  { seriesKey: 'COIL_40M', seriesLabel: 'Бухта 40 м', pattern: /бухта\s*40\s*м/i },
  { seriesKey: 'COIL_50M', seriesLabel: 'Бухта 50 м', pattern: /бухта\s*50\s*м|шланг.*\(50\s*м\)/i },
  { seriesKey: 'PODVES_2X_EVRO', seriesLabel: '2-х Евро', pattern: /подвес\s*2[\s-]*х\s*евро/i },
  { seriesKey: 'PODVES_UNIVERSAL', seriesLabel: 'Универсальный', pattern: /подвес\s*универсальн/i },
  { seriesKey: 'PICANTE_BLACK_10KG', seriesLabel: 'Эластичная / Черная 10 кг', pattern: /picante.*черн[а-я]*\s*10\s*кг|эластичн[а-я]*\s*km0/i },
  { seriesKey: 'PICANTE_NCS_13KG', seriesLabel: 'NCS/RAL 13 кг', pattern: /picante.*13\s*кг/i },

  // Kereste Kalite Sınıfı & Çelik Hasır Plaka Ebadı
  { seriesKey: 'TIMBER_SORT_1', seriesLabel: 'Сорт-1', pattern: /сорт[\s-]*1(?![0-9])|1[\s-]*сорт/i },
  { seriesKey: 'TIMBER_SORT_2', seriesLabel: 'Сорт-2', pattern: /сорт[\s-]*2(?![0-9])|2[\s-]*сорт/i },
  { seriesKey: 'MESH_SHEET_2X3', seriesLabel: 'Карта 2х3 м', pattern: /(?:сетка|карта).*(?:2[хx*×]3\s*м|2000[хx*×]3000)/i },
  { seriesKey: 'MESH_SHEET_2X6', seriesLabel: 'Карта 2х6 м', pattern: /(?:сетка|карта).*(?:2[хx*×]6\s*м?|2000[хx*×]6000)/i },

  // Mobilya Renk/Kaplama
  { seriesKey: 'FURN_WALNUT', seriesLabel: 'Орех', pattern: /тумба.*\bорех\b/i },
  { seriesKey: 'FURN_SONOMA', seriesLabel: 'Дуб Сонома', pattern: /тумба.*дуб\s*сонома/i }
];

// Sözlük dışı dinamik Latin marka yakalayıcıda marka SAYILMAYACAK teknik kısaltmalar ve Türkçe saha notu kelimeleri
const IGNORED_LATIN_TOKENS = new Set([
  'sds', 'plus', 'max', 'din', 'iso', 'gost', 'ral', 'ncs', 'pvc', 'usb', 'fhd', 'ips', 'hdmi',
  'opc', 'lcd', 'led', 'pro', 'eco', 'line', 'quadro', 'standard', 'for', 'business', 'black',
  'grey', 'gray', 'white', 'red', 'blue', 'green', 'yellow', 'optical', 'wrl', 'keyboard',
  'cartridge', 'inkjet', 'engineer', 'ext', 'norm', 'new', 'geo', 'stop', 'ult', 'ecosys',
  'toolbox', 'laser', 'green', 'waterbar', ' https', 'http', 'www', 'com', 'ru', 'org', 'net',
  'catalog', 'wall', 'kub', 'mm', 'cm', 'dm', 'km', 'kg', 'gr', 'mg', 'lt', 'ml', 'm2', 'm3',
  'tr', 'xl', 'xxl', 'xxxl', 'xs', 'ii', 'iii', 'iv', 'samc', 'samp', 'sr', 'btg', 'btgd',
  'fxc', 'kit', 'gak', 'emw', 'epw', 'ut', 'nf', 'akt', 'bdgu', 'pnsv', 'avvg', 'vvg', 'kgtp',
  // Türkçe saha notu kelimeleri
  'icin', 'excel', 'dosyasine', 'dosyasina', 'gore', 'satin', 'alinacak', 'alinacaktir',
  'saha', 'genel', 'kullanim', 'villa', 'doseme', 'kalibi', 'plywood', 'mokriy', 'facad',
  'isleri', 'stilobat', 'kilit', 'kiilit', 'tas', 'alt', 'alti', 'dolgu', 'havuz', 'cati',
  'malzemsinde', 'malzemesinde', 'marka', 'adet', 'paket', 'rulo', 'ton', 'metre', 'kutu',
  'profil', 'beton', 'isitma', 'kablosu'
]);

function stripNotesAndUrls(rawText: string): string {
  return String(rawText || '')
    .replace(/https?:\/\/[^\s)]+/gi, ' ')
    .replace(/\([^)]*(?:mokr[ıi]y|facad|excel\s*dosya|saha\s*genel|stilobat|villa\s*doseme|havuz\s*alt|alt\s*dolgu|satin\s*alin)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/malzem[e]?sinde\s+cati\s+icin\s+alinacaktir\.?/gi, ' ')
    .trim();
}

/**
 * Orijinal Rusça fatura metninden (veya malzeme adından) malzemenin:
 * - Standart GOST/DIN emtiası olup olmadığını (isCommodity),
 * - Kanonik Markasını (brandKey & brandLabel — sözlük + dinamik sözlük dışı yakalayıcı),
 * - Ürün Serisini / Yoğunluk Sınıfını (seriesKey & seriesLabel)
 * çıkarır.
 */
export function extractOriginalBrandAndSeries(rawText: string): OriginalBrandAndSeriesInfo {
  const cleaned = stripNotesAndUrls(rawText);
  const lower = cleaned.toLowerCase().replace(/ё/g, 'е');

  // 1. Önce ürün serisi / yoğunluk / teknik alt-tip kontrolü (Bazı emtialarda da Сорт-1/Сорт-2 veya Карта 2х3/2х6 vardır)
  let seriesKey: string | undefined;
  let seriesLabel: string | undefined;
  for (const sRule of PRODUCT_SERIES_RULES) {
    if (sRule.pattern.test(cleaned)) {
      seriesKey = sRule.seriesKey;
      seriesLabel = sRule.seriesLabel;
      break;
    }
  }

  // 2. Yapısal GOST / DIN Emtia Kontrolü (Demir, Çelik, Kereste, Agrega, Standart DIN Somun/Pul/Saplama, Standart Kablo)
  const isStructuralCommodity =
    (/арматур|сталь\s+углеродистая\s+для\s+армирования|арм\.\s*пруток|катанка|каркас\s*арматур|труба\s*(?:профильн|э\/с|электросварн|вгп|проф\b|\d+\s*[хx*×]\s*\d+)|профиль\s+четырехгранный|уголок\s*(?:г\/к|горячекатан|стальн|\d)|угол\s+\d+\s*[хx*×]\s*\d+|швеллер|двутавр|балка\s+\d+[бшк]|лист\s*(?:стальн|г\/к|горячекатан|х\/к|рифлен|оцинк)|полоса\s*стальн|сетка\s*сварн|сетка\s+\d+\s*[хx*×]\s*\d+\s*[хx*×]\s*\d+\s*вр|проволока\s*(?:вязальн|то\s*ч|\d+[.,]\d+-п-о-ч)|доска\s*обрезн|брус\s*(?:не\s*строган|обрезн)|пиломатериал\s*обрезн|фанера\s*(?:фсф|фоф|ламин)|балка\s+двутавровая\s+деревянная|щебень\s*гранитн|песок\s*строительн|керамзит\s*фр|пнсв|аввг|ввгнг|пугв|пвс\b|сип-\d|газ\s*пропан|пропановый\s*газ|кислород\s*техническ|винт\s*стяжной|болт\s*стяжной|гайка\s*стяжная|трубка\s*мягкая\s*пвх.*стяжного|подкос\s*двухуровнев|угол\s*внутренний\s*0[.,]\d|шайба\s*(?:плоская|увеличенная|din\s*\d+|гровер)|гайка\s*(?:шестигранная\s*)?din\s*934|гайка\s*м?\d{1,2}\b|шпилька\s*din\s*975|гвозди?\s*строительн/i.test(lower)) &&
    !/кнауф|knauf|гипсокартон|технониколь|техновент|baswool|пеноплэкс|икопал|виллатекс|sikaplan|sika|litokol|ceresit|rennbohr|армата|piranha|messer|d\.bor|практика|сибртех|kapro|luscan|эко\s*дом|комус|svetocopy|илим|picante|askaynak|rexant/i.test(lower);

  if (isStructuralCommodity) {
    return {
      isCommodity: true,
      seriesKey,
      seriesLabel,
      tier: 'COMMODITY'
    };
  }

  // 3. Sözlük Tabanlı Marka & Alt-Marka Tespiti
  for (const bRule of BRAND_AND_SUBBRAND_RULES) {
    if (bRule.pattern.test(cleaned)) {
      return {
        isCommodity: false,
        brandKey: bRule.brandKey,
        brandLabel: bRule.brandLabel,
        seriesKey,
        seriesLabel,
        tier: bRule.tier
      };
    }
  }

  // 4. Sözlük Dışı Dinamik Marka / Model Yakalayıcı (Orijinal Fatura Metninden)
  // 4a. Tırnak içi üretici / marka / model isimleri: örn. "Karbosan", «Охранник», "Green Laser 303" ("S", "П" gibi tek harfli depo kodları hariç)
  const quoteMatches = cleaned.matchAll(/["«]([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z0-9.\s-]{2,24})["»]/g);
  for (const m of quoteMatches) {
    const inner = m[1].trim();
    const innerLower = inner.toLowerCase();
    if (
      inner.length >= 3 &&
      !/^(?:ооо|зао|пао|ао|ип|тд|стд|ск|тк|кб|гэс)\b/i.test(innerLower) &&
      !IGNORED_LATIN_TOKENS.has(innerLower)
    ) {
      const dynKey = 'DYN_' + inner.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]+/g, '_').replace(/^_|_$/g, '');
      return {
        isCommodity: false,
        brandKey: dynKey,
        brandLabel: inner,
        seriesKey,
        seriesLabel,
        tier: 'STANDARD'
      };
    }
  }

  // 4b. Rusça fatura satırı içindeki Latin harfli özel marka kelimeleri (SKU/Artikul kodları ve standart birimler hariç)
  if (/[а-яА-ЯёЁ]{3,}/.test(cleaned)) {
    const latinWords = cleaned.match(/\b[A-Za-z][A-Za-z0-9.]{2,16}\b/g) || [];
    for (const w of latinWords) {
      const wLower = w.toLowerCase();
      if (IGNORORED_OR_SKU(w, wLower)) continue;
      const dynKey = 'DYN_' + w.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      return {
        isCommodity: false,
        brandKey: dynKey,
        brandLabel: w,
        seriesKey,
        seriesLabel,
        tier: 'STANDARD'
      };
    }
  }

  return {
    isCommodity: false,
    seriesKey,
    seriesLabel,
    tier: 'STANDARD'
  };
}

function IGNORORED_OR_SKU(rawWord: string, lowerWord: string): boolean {
  if (IGNORED_LATIN_TOKENS.has(lowerWord)) return true;
  // Rakam içeren SKU / Model kodları (örn. A12, P14, M10, C25, D600, B5, F100, TK8115, G03, K120, M185, QS1231) marka değildir
  if (/\d/.test(rawWord)) return true;
  if (rawWord.length < 4) return true;
  return false;
}

function normText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/(\d)\s*[хx*×]\s*(?=\d)/g, '$1x');
}

export function extractSpecSignature(rawText: string): SpecSignature {
  const t = normText(rawText);
  const sig: SpecSignature = {};
  if (!t) return sig;

  for (const fam of PRODUCT_TYPE_FAMILIES) {
    if (fam.pattern.test(t)) { sig.type = fam.type; break; }
  }

  // Marka ve Ürün Serisi / Yoğunluk Sınıfı Çıkarımı
  const brandAndSeries = extractOriginalBrandAndSeries(rawText);
  if (!brandAndSeries.isCommodity && brandAndSeries.brandKey) {
    sig.brand = brandAndSeries.brandKey;
  }
  if (brandAndSeries.seriesKey) {
    sig.series = brandAndSeries.seriesKey;
  }

  const dims = t.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/);
  if (dims) {
    sig.dims = [dims[1], dims[2], dims[3]].filter(Boolean).map(Number).sort((a, b) => a - b).join('x');
  }
  const mic = t.match(/(\d+(?:\.\d+)?)\s*(?:мкм|мкр|микрон|mkm|mkr|mikron)/);
  if (mic) sig.micron = String(Number(mic[1]));
  const lit = t.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:л|lt|литр)(?![a-zа-я])/);
  if (lit) sig.litre = String(Number(lit[1]));
  const pack =
    t.match(/(\d+)\s*шт\.?\s*(?:\/|в)?\s*(?:уп|рул|пач|кор|меш)/) ||
    t.match(/(?:упак[а-я]*|уп\.?|в\s+рулоне)\s*(?:по\s*)?(\d+)\s*шт/) ||
    t.match(/\((\d+)\s*шт\.?\)/);
  if (pack) sig.pack = pack[1];
  const thread = t.match(/(?:^|[^a-zа-я0-9])[мm]\s?(\d{1,2})(?![\d.])/);
  if (thread && Number(thread[1]) >= 4 && Number(thread[1]) <= 64) sig.thread = thread[1];
  const grade = t.match(/(?:^|[^a-zа-я0-9])[мm][\s-]?(\d{3})(?!\d)/);
  if (grade && Number(grade[1]) >= 50 && Number(grade[1]) <= 600) sig.grade = grade[1];
  const kp = t.match(/(?:к\.?\s?п\.?|класс\s+прочности)\s*(\d+(?:\.\d+)?)/);
  if (kp) sig.strength = String(Number(kp[1]));
  const kg = t.match(/(?:^|[^\d.])(\d{1,2})\s*кг(?![a-zа-я])/);
  if (kg && Number(kg[1]) >= 5 && Number(kg[1]) <= 60) sig.bagKg = kg[1];
  return sig;
}

function nearlyEqual(a: number, b: number, tol = 0.05): boolean {
  if (a === b) return true;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 && Math.abs(a - b) / m <= tol;
}

// Ölçüler: alt küme (50x50 ⊂ 50x50x3000), ±%5 tolerans (48x58 ≈ 50x60) ve cm↔mm ölçek farkı (5x10x600 ≈ 50x100x6000) uyumlu sayılır
function areDimsCompatible(a: string, b: string): boolean {
  const A = a.split('x').map(Number);
  const B = b.split('x').map(Number);
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  for (const scale of [1, 10, 100, 1000]) {
    const pool = big.map(v => v);
    const ok = small.every(v => {
      const idx = pool.findIndex(p => nearlyEqual(v * scale, p) || nearlyEqual(v, p * scale));
      if (idx === -1) return false;
      pool.splice(idx, 1);
      return true;
    });
    if (ok) return true;
  }
  return false;
}

export function getSpecConflicts(a: SpecSignature, b: SpecSignature): Array<keyof SpecSignature> {
  const out: Array<keyof SpecSignature> = [];
  for (const k of SPEC_KEYS) {
    if (!a[k] || !b[k] || a[k] === b[k]) continue;
    if (k === 'dims' && areDimsCompatible(a[k]!, b[k]!)) continue;
    out.push(k);
  }
  return out;
}

// Fiyat ölçü birimiyle (m², m³, ton, kg, metre, litre) ifade ediliyorsa ambalaj/ebat bilgisi birim fiyatı değiştirmez;
// ANCAK marka (brand) ve ürün serisi/yoğunluk sınıfı (series) her durumda korunur!
const MEASURED_UNIT_RE = /^(?:m2|м2|m²|м²|metrekare|кв\.?\s*м|m3|м3|m³|м³|metreküp|куб|ton|тонн?а?|т|tn|kg|кг|m|м|metre|mt|пм|п\.м|l|л|lt|litre|литр)\.?$/i;

export function isMeasuredUnit(unit?: string): boolean {
  return MEASURED_UNIT_RE.test(String(unit || '').trim().toLowerCase());
}

export function extractSpecSignatureForUnit(rawText: string, unit?: string): SpecSignature {
  const sig = extractSpecSignature(rawText);
  if (isMeasuredUnit(unit)) {
    delete sig.dims;
    delete sig.pack;
    delete sig.bagKg;
    delete sig.litre;
  }
  return sig;
}

export function areSpecSignaturesCompatible(textA: string, textB: string): boolean {
  return getSpecConflicts(extractSpecSignature(textA), extractSpecSignature(textB)).length === 0;
}

function mergeSig(into: SpecSignature, from: SpecSignature): void {
  for (const k of SPEC_KEYS) {
    if (!into[k] && from[k]) into[k] = from[k];
  }
}

export function getProductTypeLabel(type: string): string {
  return PRODUCT_TYPE_FAMILIES.find(f => f.type === type)?.label || type;
}

export function getBrandDisplayLabel(brandKey?: string): string {
  if (!brandKey) return '';
  const hit = BRAND_AND_SUBBRAND_RULES.find(r => r.brandKey === brandKey);
  if (hit) return hit.brandLabel;
  if (brandKey.startsWith('DYN_')) return brandKey.slice(4).replace(/_/g, ' ');
  return brandKey;
}

export function getSeriesDisplayLabel(seriesKey?: string): string {
  if (!seriesKey) return '';
  const hit = PRODUCT_SERIES_RULES.find(r => r.seriesKey === seriesKey);
  return hit ? hit.seriesLabel : seriesKey;
}

function describeValue(k: keyof SpecSignature, v?: string): string {
  if (!v) return '';
  switch (k) {
    case 'type': return PRODUCT_TYPE_FAMILIES.find(f => f.type === v)?.label || v;
    case 'brand': return `Marka: ${getBrandDisplayLabel(v)}`;
    case 'series': return `Seri: ${getSeriesDisplayLabel(v)}`;
    case 'dims': return `Ölçü ${v}`;
    case 'micron': return `${v} mikron`;
    case 'litre': return `${v} L`;
    case 'pack': return `${v} Adet/Paket`;
    case 'thread': return `M${v}`;
    case 'grade': return `M-${v}`;
    case 'strength': return `Kalite Sınıfı ${v}`;
    case 'bagKg': return `${v} kg`;
  }
  return v;
}

/**
 * Bir malzeme grubunu orijinal satırlardaki çelişen özelliklere (Marka, Seri/Yoğunluk, Tip, Ölçü, Mikron vb.) göre alt gruplara böler.
 * Çelişki yoksa tek grup döner (label boş).
 */
export function splitGroupBySpec<T>(entries: T[], getText: (e: T) => string, getUnit?: (e: T) => string): Array<{ entries: T[]; label: string; signature: SpecSignature }> {
  if (entries.length < 2) return [{ entries, label: '', signature: entries[0] ? extractSpecSignature(getText(entries[0])) : {} }];

  const withSig = entries.map(e => ({ e, sig: extractSpecSignatureForUnit(getText(e), getUnit ? getUnit(e) : undefined) }));
  const richness = (s: SpecSignature) => SPEC_KEYS.filter(k => s[k]).length;
  const order = [...withSig].sort((x, y) => richness(y.sig) - richness(x.sig));

  const clusters: Array<{ sig: SpecSignature; members: T[]; memberSigs: SpecSignature[]; unspecified?: boolean }> = [];
  for (const { e, sig } of order) {
    const candidates = clusters
      .filter(c => getSpecConflicts(c.sig, sig).length === 0)
      .sort((a, b) => b.members.length - a.members.length);
    if (candidates.length > 0) {
      candidates[0].members.push(e);
      candidates[0].memberSigs.push(sig);
      mergeSig(candidates[0].sig, sig);
    } else {
      clusters.push({ sig: { ...sig }, members: [e], memberSigs: [sig] });
    }
  }

  // Kaliteyi ve fiyatı doğrudan belirleyen özellik (marka, ürün serisi/yoğunluk, mikron, mukavemet sınıfı, harç M-sınıfı)
  // bir kümede yazılıysa, bu özelliği HİÇ belirtmeyen satır o kümeyle kıyaslanamaz → ayrı kümeye ayrılır.
  const CRITICAL: Array<keyof SpecSignature> = ['brand', 'series', 'micron', 'strength', 'grade'];
  const unspecMembers: T[] = [];
  const unspecSigs: SpecSignature[] = [];
  for (const c of clusters) {
    const crit = CRITICAL.filter(k => c.sig[k]);
    if (!crit.length) continue;
    const keepM: T[] = []; const keepS: SpecSignature[] = [];
    c.members.forEach((m, i) => {
      const s = c.memberSigs[i];
      if (crit.some(k => !s[k])) { unspecMembers.push(m); unspecSigs.push(s); }
      else { keepM.push(m); keepS.push(s); }
    });
    if (keepM.length === 0) continue; // tamamen belirsiz küme ise dokunma
    c.members = keepM; c.memberSigs = keepS;
    const rebuilt: SpecSignature = {};
    keepS.forEach(s => mergeSig(rebuilt, s));
    c.sig = rebuilt;
  }
  if (unspecMembers.length) {
    const s: SpecSignature = {};
    unspecSigs.forEach(x => mergeSig(s, x));
    CRITICAL.forEach(k => { delete s[k]; });
    clusters.push({ sig: s, members: unspecMembers, memberSigs: unspecSigs, unspecified: true });
  }

  if (clusters.length === 1) return [{ entries: clusters[0].members, label: '', signature: clusters[0].sig }];

  // Etiketi yalnızca kümeler arasında farklılaşan özelliklerden üret
  const differing = SPEC_KEYS.filter(
    k =>
      new Set(clusters.filter(c => !c.unspecified).map(c => c.sig[k] || '')).size > 1 ||
      clusters.some(c => c.unspecified && CRITICAL.includes(k) && clusters.some(o => o.sig[k]))
  );
  return clusters.map(c => {
    if (c.unspecified) {
      return { entries: c.members, label: 'Markasız / Standart Spesifikasyon', signature: c.sig };
    }
    const parts = differing.map(k => describeValue(k, c.sig[k])).filter(Boolean);
    return { entries: c.members, label: parts.length ? parts.join(' • ') : 'Markasız / Standart Spesifikasyon', signature: c.sig };
  });
}

/**
 * İstemci (Frontend) tarafı emniyet kemeri: Sunucu önbelleği veya yeniden başlatılmamış
 * bir konteyner eski /api/materials/compare çıktısını döndürse bile, çelişen grupları
 * tarayıcıda anında böler ve min/max/ortalama fiyatları yeniden hesaplar.
 */
export function ensureComparisonGroupIntegrity<T extends { materialName: string; unit?: string; history?: any[] }>(comparisons: T[]): T[] {
  if (!Array.isArray(comparisons) || comparisons.length === 0) return comparisons;
  const out: T[] = [];
  for (const comp of comparisons) {
    const history = Array.isArray(comp.history) ? comp.history : [];
    if (history.length < 2) {
      out.push(comp);
      continue;
    }
    const parts = splitGroupBySpec(
      history,
      (h: any) => String(h?.originalName || h?.materialName || comp.materialName || ''),
      (h: any) => String(h?.unit || comp.unit || '')
    );
    if (parts.length <= 1) {
      out.push(comp);
      continue;
    }
    const hostType = [...parts].sort((a, b) => b.entries.length - a.entries.length)[0].signature.type;
    const baseParenRaw = (comp.materialName.match(/\(([^()]*)\)\s*$/) || [])[1];
    const baseParen = baseParenRaw && /^[\d.,x×хX*\s-]+(?:mm|m|мм)?$/i.test(baseParenRaw.trim()) ? baseParenRaw.trim() : undefined;
    parts.forEach((part, idx) => {
      const isForeignType = part.signature.type && part.signature.type !== hostType;
      let partName = `${comp.materialName} [${part.label}]`;
      if (part.label === 'Markasız / Standart Spesifikasyon') {
        partName = `${comp.materialName.replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*mikron[^)]*\)/i, ' (mikron belirtilmemiş)')} [${part.label}]`;
      }
      if (isForeignType) {
        const typeLabel = getProductTypeLabel(part.signature.type!);
        const rest = part.label.split(' • ').filter(s => s !== typeLabel).join(' • ');
        partName = `${typeLabel}${baseParen ? ` (${baseParen})` : ''}${rest ? ` [${rest}]` : ''}`;
      }
      const prices = part.entries
        .map((h: any) => Number(h?.normalizedUnitPrice ?? h?.unitPrice ?? h?.price) || 0)
        .filter((p: number) => p > 0);
      const minPrice = prices.length ? Math.min(...prices) : 0;
      const maxPrice = prices.length ? Math.max(...prices) : 0;
      const totalQuantity = part.entries.reduce((s: number, h: any) => s + (Number(h?.normalizedQuantity ?? h?.quantity) || 0), 0);
      const totalSpend = part.entries.reduce((s: number, h: any) => {
        const p = Number(h?.originalUnitPrice ?? h?.unitPrice ?? h?.price) || 0;
        const q = Number(h?.originalQuantity ?? h?.quantity) || 0;
        return s + p * q;
      }, 0);
      const averagePrice = totalQuantity > 0
        ? totalSpend / totalQuantity
        : (prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : 0);
      const priceDiffPct = minPrice > 0 && maxPrice > minPrice
        ? Number((((maxPrice - minPrice) / minPrice) * 100).toFixed(2))
        : 0;
      const minEntry = part.entries.find((h: any) => (Number(h?.normalizedUnitPrice ?? h?.unitPrice ?? h?.price) || 0) === minPrice) || part.entries[0];
      const maxEntry = part.entries.find((h: any) => (Number(h?.normalizedUnitPrice ?? h?.unitPrice ?? h?.price) || 0) === maxPrice) || part.entries[0];
      const detectedBrand = getBrandDisplayLabel(part.signature.brand);
      const detectedSeries = getSeriesDisplayLabel(part.signature.series);
      out.push({
        ...comp,
        id: `${(comp as any).id || comp.materialName}__spec${idx}`,
        materialName: partName,
        brand: detectedBrand ? (detectedSeries ? `${detectedBrand} (${detectedSeries})` : detectedBrand) : (comp as any).brand,
        history: part.entries,
        minPrice,
        maxPrice,
        averagePrice,
        minUnitPrice: Number(minPrice.toFixed(2)),
        maxUnitPrice: Number(maxPrice.toFixed(2)),
        avgUnitPrice: Number(averagePrice.toFixed(2)),
        averageUnitPrice: Number(averagePrice.toFixed(2)),
        totalQuantity: Number(totalQuantity.toFixed(2)),
        totalQuantityPurchased: Number(totalQuantity.toFixed(2)),
        totalSpend: Number(totalSpend.toFixed(2)),
        priceDifferencePercentage: priceDiffPct,
        cheapestJobsiteName: minEntry?.jobsiteName || (comp as any).cheapestJobsiteName,
        priciestJobsiteName: maxEntry?.jobsiteName || (comp as any).priciestJobsiteName,
        minSupplier: minEntry?.supplier || (comp as any).minSupplier,
        maxSupplier: maxEntry?.supplier || (comp as any).maxSupplier,
        minJobsiteId: minEntry?.jobsiteId || (comp as any).minJobsiteId,
        maxJobsiteId: maxEntry?.jobsiteId || (comp as any).maxJobsiteId,
      });
    });
  }
  return out;
}
