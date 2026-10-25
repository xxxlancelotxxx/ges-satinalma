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
  standard?: string;
  qualitySort?: string;
  moisture?: string;
  treatment?: string;
  woodSpecies?: string;
  panelGrade?: string;
  steelGrade?: string;
  steelForm?: string;
  steelRolling?: string;
  coating?: string;
  couplerSeries?: string;
  toolBody?: string;
  filmGrade?: string;
  packVolM3?: string;
  rollAreaM2?: string;
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
  'standard',
  'qualitySort',
  'moisture',
  'treatment',
  'woodSpecies',
  'panelGrade',
  'steelGrade',
  'steelForm',
  'steelRolling',
  'coating',
  'couplerSeries',
  'toolBody',
  'filmGrade',
  'packVolM3',
  'rollAreaM2',
  'dims',
  'micron',
  'litre',
  'pack',
  'thread',
  'grade',
  'strength',
  'bagKg'
];

export interface TechnicalVariantProfile {
  /** Standart tipi: GOST (Devlet standardı) vs TU (Teknik şartname / esnek tolerans) */
  standardType: 'GOST' | 'TU' | null;
  /** Açık standart numarası varsa (örn. GOST-8486, DIN-933, ISO-4017) */
  standardCode: string | null;
  /** Kalite sınıfı (Сорт 1 / 1-2 / 2 / 3 / Экстра / АВ / ВС / 1/1 / 1/2 / 2/2 / 2/4 / 3/4 / 4/4) */
  qualityGrade: 'SORT_EXTRA' | 'SORT_1' | 'SORT_1_2' | 'SORT_2' | 'SORT_3' | 'SORT_AB' | 'SORT_BC' | 'SORT_1_1' | 'SORT_1_2_PLY' | 'SORT_2_2' | 'SORT_2_4' | 'SORT_3_4' | 'SORT_4_4' | null;
  /** Nem durumu: Камерной сушки / Сухой (DRY) vs Естественной влажности / ЕВ (NATURAL) */
  moistureState: 'DRY' | 'NATURAL' | null;
  /** Yüzey ve koruma işlemi: Строганный (PLANED), Необрезной (UNEDGED), Антисептированный (ANTISEPTIC) */
  surfaceTreatment: 'PLANED' | 'UNEDGED' | 'ANTISEPTIC' | null;
  /** Ağaç türü: Çam/Ladin/İğne yapraklı (PINE_SPRUCE), Kavak (ASPEN), Melez/Karaçam (LARCH), Huş (BIRCH) */
  woodSpecies: 'PINE_SPRUCE' | 'ASPEN' | 'LARCH' | 'BIRCH' | null;
  /** Kontrplak / OSB / Levha tipi: ФСФ, ФК, Ламинированная (LAMINATED), OSB-3, OSB-2 */
  panelGrade: 'FSF' | 'FK' | 'LAMINATED' | 'OSB_3' | 'OSB_2' | null;
  /** Çelik / Metal kalite sınıfı: Ст3 (ST3), 09Г2С (09G2S), А500С (A500C), А400 (A400), А240 (A240), Вр-1 (VR1) */
  steelGrade?: 'ST3' | '09G2S' | 'A500C' | 'A400' | 'A240' | 'VR1' | null;
  /** Çelik ürün formu: Filmaşin / Катанка (WIRE_ROD_KATANKA) vs Çubuk Demir / Арматура (REBAR_BAR) */
  steelProductForm?: 'WIRE_ROD_KATANKA' | 'REBAR_BAR' | null;
  /** Haddeleme / üretim tipi: Sıcak çekme г/к (HOT_ROLLED) vs Soğuk çekme х/к (COLD_ROLLED) */
  steelRollingType?: 'HOT_ROLLED' | 'COLD_ROLLED' | null;
  /** Yüzey kaplama tipi: Galvanizli (GALVANIZED) vs Siyah/Oksit/Fosfat (BLACK_OXIDE) vs Paslanmaz A2/A4 */
  coatingType?: 'GALVANIZED' | 'BLACK_OXIDE' | 'STAINLESS_A2' | 'STAINLESS_A4' | null;
  /** Bağlantı elemanı mukavemet sınıfı (к.п. 4.8 / 5.8 / 8.8 / 10.9 / 12.9) */
  fastenerStrength?: string | null;
  /** Donatı manşonu serisi (P14 / P13 / D14 / A12) */
  couplerSeries?: string | null;
  /** El aleti / tabanca gövde ve mekanizma tipi */
  toolBodyAndMechanism?: 'METAL_REGULATED' | 'METAL_BODY' | 'PLASTIC_BODY' | 'RUBBERIZED_BODY' | 'TEFLON_PRO' | null;
  /** Polietilen film hammadde / yapı sınıfı */
  filmGrade?: 'PRIMARY' | 'TECHNICAL' | 'REINFORCED_ECO' | 'REINFORCED_STD' | null;
  /** Paket / Rulo m³ hacmi (örn. 1.22 vs 0.585) */
  packageVolumeM3?: string | null;
  /** Rulo / Plaka m² alanı (örn. 300 vs 150 vs 10) */
  rollAreaM2?: string | null;
  /** Birbirini dışlayan ürün tipi ailesi (örn. cherenok vs lopata, gidroizolyatsiya-membrana vs plenka-pe) */
  productType?: string | null;
  /** Ürün serisi / yoğunluk / alt model kodu (örn. MAT_40_RN_PROF vs MAT_34_RN_PROF, ULTRANAP_OR_TEHNOELAST) */
  productSeries?: string | null;
  /** Normalize edilmiş kesit/ölçü (örn. 50x100x6000) */
  crossSectionDims: string | null;
  /** Malzemenin kereste/ahşap grubunda olup olmadığı */
  isTimber: boolean;
  /** Kullanıcı arayüzünde ve grup anahtarında gösterilecek okunabilir etiketler (örn. ['GOST', 'Sort-1']) */
  badges: string[];
  /** Grup anahtarı için kanonik varyant anahtarı */
  variantKey: string;
}

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
  { type: 'cherenok', label: 'Alet / Kürek / Fırça Sapı (Черенок)', pattern: /(?:^|[^а-яё])черенок/ },
  { type: 'lopata', label: 'Kürek (Лопата)', pattern: /(?:^|[^а-яё])лопат[аыуеой]/ },
  { type: 'gidroizolyatsiya-membrana', label: 'Su Yalıtım Membranı (Гидроизоляция)', pattern: /наплавляем[а-я]*\s+гидроизоляц|рулонн[а-я]*\s+гидроизоляц|гидроизоляц[а-я]*\s+(?:техноэласт|унифлекс|виллафлекс|биполь|линокром|бикрост)|техноэласт|виллафлекс|унифлекс/ },
  { type: 'plenka-pe', label: 'Polietilen İnşaat Naylonu (Пленка)', pattern: /(?:^|[^а-яё])пл[её]нка\s+(?:укрывн|техническ|полиэтилен|п\/э|армирован)/ },
  { type: 'katanka', label: 'Filmaşin Tel Çubuk (Катанка)', pattern: /(?:^|[^а-яё])катанка/ },
  { type: 'armatura-prutok', label: 'İnşaat Demiri Çubuk (Арматура / Пруток)', pattern: /арм\.\s*пруток|сталь\s+углеродистая\s+для\s+армирования|(?:^|[^а-яё])арматур[аыуеой](?!\s*перемыч)/ },
  { type: 'polubotinki', label: 'Yarım Bot İş Ayakkabısı (Полуботинки)', pattern: /полуботинк/ },
  { type: 'botinki', label: 'İş Güvenliği Botu (Ботинки)', pattern: /(?:^|[^а-яё])ботинк/ },
  { type: 'klapan-obratny', label: 'Gaz Çek Valfi (Клапан обратный КО)', pattern: /клапан\s+обратн/ },
  { type: 'klapan-ognepregrad', label: 'Alev Emniyet Valfi (Клапан огнепреградительный КОК)', pattern: /клапан\s+огнепреградительн/ },
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
  // Taşyünü, Cam Yünü, Membran & XPS Yalıtım Yoğunluk, Seri ve Alt Model Sınıfları
  { seriesKey: 'MAT_40_RN_PROF', seriesLabel: '40 RN Стандарт ПРОФ', pattern: /40\s*rn\b/i },
  { seriesKey: 'MAT_34_RN_PROF', seriesLabel: '34 RN Стены и крыши ПРОФ', pattern: /34\s*rn\b/i },
  { seriesKey: 'ULTRANAP_OR_TEHNOELAST', seriesLabel: 'Ультранап / Техноэласт (Karma)', pattern: /ультранап\s*\/\s*техноэласт|техноэласт\s*\/\s*ультранап/i },
  { seriesKey: 'FUNDAMENT_ADGEZIV', seriesLabel: 'Фундамент Адгезив', pattern: /фундамент\s*адгезив/i },
  { seriesKey: 'FUNDAMENT_FIKS', seriesLabel: 'Фундамент Фикс', pattern: /фундамент\s*фикс/i },
  { seriesKey: 'TEHNOVENT_OPTIMA', seriesLabel: 'Техновент Оптима', pattern: /техновент\s*оптима|tehnovent\s*optima/i },
  { seriesKey: 'TEHNOVENT_STANDART', seriesLabel: 'Техновент Стандарт', pattern: /техновент\s*стандарт|tehnovent\s*standart/i },
  { seriesKey: 'TEHNOVENT_N', seriesLabel: 'Техновент Н', pattern: /техновент\s*н(?![а-яa-z])|tehnovent\s*n(?![a-z])/i },
  { seriesKey: 'FASAD_120', seriesLabel: 'Фасад 120 (120 кг/м³)', pattern: /фасад\s*120|fasad\s*120/i },
  { seriesKey: 'ROKLAYT', seriesLabel: 'Роклайт', pattern: /роклайт|roklayt/i },
  { seriesKey: 'TEHNOFAS_OPTIMA', seriesLabel: 'Технофас Оптима', pattern: /технофас\s*оптима|tehnofas\s*optima/i },
  { seriesKey: 'TEHNOFAS_DEKOR', seriesLabel: 'Технофас Декор', pattern: /технофас\s*декор|tehnofas\s*dekor/i },
  { seriesKey: 'TEHNOFAS', seriesLabel: 'Технофас', pattern: /технофас|tehnofas/i },
  { seriesKey: 'TEHNOBLOK_STANDART', seriesLabel: 'Техноблок Стандарт', pattern: /техноблок\s*стандарт|tehnoblok\s*standart/i },
  { seriesKey: 'TEHNOBLOK', seriesLabel: 'Техноблок', pattern: /техноблок|tehnoblok/i },
  { seriesKey: 'CARBON_PROF', seriesLabel: 'Carbon Prof', pattern: /carbon\s*prof|carbonproof|карбон\s*проф/i },
  { seriesKey: 'GEO_S', seriesLabel: 'Гео С', pattern: /гео\s*с(?![а-яa-z])|geo\s*c(?![a-z])/i },
  { seriesKey: 'KOMFORT_XPS', seriesLabel: 'Комфорт', pattern: /пеноплэкс\s*комфорт|пеноплекс\s*комфорт/i },
  { seriesKey: 'FUNDAMENT', seriesLabel: 'Фундамент ЭПП', pattern: /техноэласт\s*фундамент|техноеласт\s*фундамент/i },
  { seriesKey: 'EPP_3.5', seriesLabel: 'ЭПП 3.5 мм', pattern: /эпп\s*3[.,]5\b/i },
  { seriesKey: 'EPP_3.0', seriesLabel: 'ЭПП 3.0 мм', pattern: /эпп\s*3(?:[.,]0)?(?![.,]\d)\s*(?:мм|mm|15м)?/i },
  { seriesKey: 'EPP_4.0', seriesLabel: 'ЭПП 4.0 мм', pattern: /эпп\s*4(?:[.,]0)?(?![.,]\d)\s*(?:мм|mm|10м)?/i },

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

  // Eldiven & İSG Yalıtım / Kapama / Seri Tipi
  { seriesKey: 'VILEDA_KONTRAKT', seriesLabel: 'Контракт (Желтые)', pattern: /vileda.*контракт/i },
  { seriesKey: 'VILEDA_PRO_BLUE', seriesLabel: 'Professional (Синие)', pattern: /vileda\s*profes.*син/i },
  { seriesKey: 'DELTA_BASEBALL_DIAMOND', seriesLabel: 'Baseball Diamond V UP', pattern: /baseball\s+diamond/i },
  { seriesKey: 'DELTA_DIAMOND_STD', seriesLabel: 'Diamond V UP', pattern: /(?<!baseball\s)diamond\s+v\s+up/i },
  { seriesKey: 'KRAGI_INSULATED', seriesLabel: 'Утепленные мехом', pattern: /краги.*утеплен|утепленные\s+искусственным\s+мехом/i },
  { seriesKey: 'KRAGI_UNINSULATED', seriesLabel: 'Без утепления', pattern: /краги.*без\s*утеплен/i },
  { seriesKey: 'PLASH_BUTTONS', seriesLabel: 'На кнопках', pattern: /на\s*кнопках/i },
  { seriesKey: 'PLASH_VELCRO', seriesLabel: 'На липучках', pattern: /на\s*липучках/i },
  { seriesKey: 'ZHILET_TIP1T', seriesLabel: 'Тип 1Т', pattern: /жилет.*тип\s*1\s*т/i },
  { seriesKey: 'ZHILET_TIP2T', seriesLabel: 'Тип 2Т', pattern: /жилет.*тип\s*2\s*т/i },
  { seriesKey: 'ZHILET_TIP8T', seriesLabel: 'Тип 8Т', pattern: /жилет.*тип\s*8\s*т/i },

  // Sapan, Lazer, Buat, Dolap, Paspayı & Kimyasal Seri Kodları
  { seriesKey: 'GIGANT_PRO_GP', seriesLabel: 'Professional GP-STP', pattern: /gp-stp-\d+|gigant\s+professional\s+строп/i },
  { seriesKey: 'GIGANT_STD_G03', seriesLabel: 'Standart G03', pattern: /\bg03-\d+\b/i },
  { seriesKey: 'LASER_4D_360', seriesLabel: '4D-360 Green', pattern: /\b4d[\s-]*360\b/i },
  { seriesKey: 'LASER_3D_A12', seriesLabel: '3D-A12 + T1000', pattern: /\b3d[\s-]*[aа]12\b/i },
  { seriesKey: 'TDM_SQ1401_0821', seriesLabel: 'SQ1401-0821', pattern: /\bsq1401-0821\b/i },
  { seriesKey: 'TDM_SQ1401_0811', seriesLabel: 'SQ1401-0811', pattern: /\bsq1401-0811\b/i },
  { seriesKey: 'SHKAF_ML_21_50', seriesLabel: 'ML-21-50', pattern: /\bml[\s-]*21[\s-]*50\b/i },
  { seriesKey: 'SPOT_ELECTRODE_3624', seriesLabel: 'Модель 3624', pattern: /\b3624\s+электрод/i },
  { seriesKey: 'SPOT_ELECTRODE_3621', seriesLabel: 'Модель 3621', pattern: /\b3621\s+электрод/i },
  { seriesKey: 'EMULSOL_MINUS_15', seriesLabel: 'До -15°C', pattern: /(?:эмульсол|смазка).*(?:до\s*)?-15\s*°?\s*[cс]|-15\s*°?\s*[cс]/i },
  { seriesKey: 'EMULSOL_MINUS_25', seriesLabel: 'До -25°C', pattern: /(?:эмульсол|смазка).*(?:до\s*)?-25\s*°?\s*[cс]|-25\s*°?\s*[cс]/i },
  { seriesKey: 'FIKSATOR_STOYKA_USIL', seriesLabel: 'Усиленный Стойка 30(Т)', pattern: /фиксатор\s+усиленный\s+стойка/i },
  { seriesKey: 'FIKSATOR_NAPOLNY', seriesLabel: 'Напольный (Норм)', pattern: /фиксатор\s+напольный/i },
  { seriesKey: 'UROVEN_USM_MAGNIT', seriesLabel: 'Фрезерованный Магнитный УСМ', pattern: /усм-0[.,]5|фрезерованн.*магнитн/i },
  { seriesKey: 'UROVEN_USIL_STD', seriesLabel: 'Усиленный Стандарт', pattern: /уровень\s+усиленный\s+алюминиевый/i },
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
  { seriesKey: 'TIMBER_SORT_1_2', seriesLabel: 'Сорт 1-2', pattern: /сорт[\s:=-]*1\s*[-/]\s*2(?![0-9])|1\s*[-/]\s*2[\s-]*сорт|(?:sınıf|sinif)[\s:=-]*1\s*[-/]\s*2|1\s*[-/]\s*2\.?\s*(?:sınıf|sinif)/i },
  { seriesKey: 'TIMBER_SORT_1', seriesLabel: 'Сорт-1', pattern: /сорт[\s:=-]*1(?![0-9/\\-])|(?<!1\s*[-/\\]\s*)1(?:-?й)?[\s-]*сорт|(?:sınıf|sinif)[\s:=-]*1(?![0-9/\\-])|(?<!1\s*[-/\\]\s*)1\.\s*(?:sınıf|sinif)/i },
  { seriesKey: 'TIMBER_SORT_2', seriesLabel: 'Сорт-2', pattern: /сорт[\s:=-]*2(?![0-9/\\-])|(?<![12]\s*[-/\\]\s*)2(?:-?й)?[\s-]*сорт|(?:sınıf|sinif)[\s:=-]*2(?![0-9/\\-])|(?<![12]\s*[-/\\]\s*)2\.\s*(?:sınıf|sinif)/i },
  { seriesKey: 'TIMBER_SORT_3', seriesLabel: 'Сорт-3', pattern: /сорт[\s:=-]*3(?![0-9/\\-])|(?<![123]\s*[-/\\]\s*)3(?:-?й)?[\s-]*сорт|(?:sınıf|sinif)[\s:=-]*3(?![0-9/\\-])|(?<![123]\s*[-/\\]\s*)3\.\s*(?:sınıf|sinif)/i },
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

function stripSyntheticTemplates(s: string): string {
  return String(s || '')
    .replace(/Пиломатериал обрезной\s*\(брус\s*\/\s*доска\)\s*ГОСТ\s*8486/gi, 'Пиломатериал обрезной (брус / доска)')
    .replace(/Бетон товарный БСГ\s*ГОСТ\s*7473/gi, 'Бетон товарный БСГ')
    .replace(/Жилет сигнальный светоотражающий\s*ГОСТ/gi, 'Жилет сигнальный светоотражающий')
    .replace(/Плита ориентированно-стружечная\s*ОСП-3\s*\(OSB-3\)/gi, 'Плита ориентированно-стружечная')
    .replace(/Сетка сварная арматурная\s*Вр-1\s*ГОСТ\s*23279/gi, 'Сетка сварная арматурная')
    .replace(/Уголок стальной равнополочный\s*ГОСТ\s*8509/gi, 'Уголок стальной равнополочный')
    .replace(/Труба стальная профильная\s*ГОСТ\s*8639/gi, 'Труба стальная профильная')
    .replace(/Труба стальная электросварная\s*ГОСТ\s*10704/gi, 'Труба стальная электросварная')
    .replace(/Гвозди строительные\s*ГОСТ\s*4028/gi, 'Гвозди строительные')
    .replace(/\(\s*(?:Вр-1\s+)?GOST\s*(?:8509|8639(?:\/8645)?|10704|8240(?:-97)?|19903|57837|23279|34028|9356)\s*\)/gi, ' ')
    .replace(/\(\s*Лист\s+г\/к\s+GOST\s+19903\s*\)/gi, ' ');
}

function stripLegacySyntheticTimberTag(s: string): string {
  return String(s || '')
    .replace(/\(\s*1\.\s*s[ıi]n[ıi]f\s+gost\s*\)/gi, ' ')
    .replace(/\b1\.\s*s[ıi]n[ıi]f\s+gost\b/gi, ' ');
}

function normalize3DTimberDimsToMm(d1Raw: number, d2Raw: number, d3Raw: number, isTimber: boolean): string {
  let nums = [d1Raw, d2Raw, d3Raw].map(n => (isTimber && n > 0 && n < 1 ? Math.round(n * 1000) : n));
  if (isTimber) {
    // 2 boyut mm (15..300) ve 1 boyut metre (1.5..12, örn. 50*200*6,0 veya 0,05*0,15*6,0 м)
    const mmCount = nums.filter(n => n >= 15 && n <= 300).length;
    const mIdx = nums.findIndex(n => n >= 1.5 && n <= 12);
    if (mmCount === 2 && mIdx !== -1) {
      nums[mIdx] = Math.round(nums[mIdx] * 1000);
    } else {
      // 3 boyut cm (örn. 5*10*600 cm veya 5*20*610 cm)
      const sortedCm = [...nums].sort((a, b) => a - b);
      if (sortedCm[0] >= 2 && sortedCm[0] <= 25 && sortedCm[1] >= 4 && sortedCm[1] <= 30 && sortedCm[2] >= 200 && sortedCm[2] <= 650) {
        nums = nums.map(n => Math.round(n * 10));
      }
    }
  }
  const sorted = nums.sort((a, b) => a - b);
  return sorted.join('x');
}

/**
 * Merkezi Evrensel Teknik Varyant & Kalite Motoru (Tüm Kategoriler):
 * 1) Standart (ГОСТ / ТУ / DIN / ISO)
 * 2) Kalite Sınıfı (Kereste Сорт 1/1-2/2/3/АВ/ВС, Kontrplak Сорт 1/1..4/4)
 * 3) Çelik & Metal (Ст3 vs 09Г2С vs А500С vs А240 vs Вр-1; Катанка vs Арматура; г/к vs х/к; Оцинк. vs Черн./Оксид)
 * 4) Bağlantı Elemanı & Donatı Manşonu (к.п. 4.8/5.8/8.8/10.9/12.9; Муфта P14 vs D14 vs A12)
 * 5) El Aleti & Tabanca Gövde/Mekanizma (Метал. с регулятором vs Пластик без регулятора vs Прорезиненный корпус)
 * 6) Polietilen Film Sınıfı (Первичная vs Техническая vs Армированная ЭКО/Стандарт)
 * 7) Rulo & Paket Hacmi / Alanı (1,22 м³/упак vs 0,585 м³/упак; 300 м² vs 150 м² vs 10 м²)
 */
export function extractTechnicalStandardAndGrade(rawText: string, fallbackText = ''): TechnicalVariantProfile {
  const cleanRaw = stripLegacySyntheticTimberTag(stripSyntheticTemplates(rawText)).trim();
  const cleanFallback = stripLegacySyntheticTimberTag(stripSyntheticTemplates(fallbackText)).trim();
  const hasGenuineCyrillicRaw = /[а-яё]{4,}/i.test(cleanRaw);
  // Standart ve kalite sınıfı için gerçek Rusça orijinal metin varsa onu baz al (eski otomatik çeviri etiketlerinin yanıltmasını önle)
  const primaryForStdAndSort = hasGenuineCyrillicRaw ? cleanRaw : `${cleanRaw} ${cleanFallback}`.trim();
  const combined = `${cleanRaw} ${cleanFallback}`.trim();
  const lowerPrimary = normText(primaryForStdAndSort);
  const lowerCombined = normText(combined);

  const isTimber =
    /(?:^|[^a-zа-я0-9])(?:доска|брус|брусок|пиломатериал|рейка|kereste|kalas|karkas\s*çıtası|karkas\s*citasi)(?=$|[^a-zа-я0-9])/i.test(lowerCombined) &&
    !/магнитно|маркер|гладильн|разделочн|информацион|стенд|yazı\s*tahtas|kesme\s*tahtas|ütü\s*masas|брусчатк|телескопич|нивелир|оц\.?\s*сталь|стальн|алюмин|прижимн|краевая|\brgk\b|маячк|штукатурн|металл|пвх|pvc|\bral\b/i.test(lowerCombined);

  // 1. Özel Tedarikçi SKU Kuralı: ГК АТМОС "01-09О" / "09О" / "01-090" = Осина (Kavak); "01-14Г" / "01-102Г" = Хвоя (Çam) + ГОСТ
  const isAtmosAspenTuSku = /(?:^|[^a-zа-я0-9])(?:(?:01[\s-]*)?09[оo]|01[\s-]*090(?=\s+(?:доска|брус|пиломатериал)))(?=$|[^a-zа-я0-9])/i.test(lowerCombined);
  const isAtmosPineGostSku = /(?:^|[^a-zа-я0-9])01[\s-]*(?:14|102)[гg](?=$|[^a-zа-я0-9])/i.test(lowerCombined);

  // 2. Standart (GOST vs TU) ve Standart Kodu (Tüm kategorilerde geçerli)
  let standardType: 'GOST' | 'TU' | null = null;
  let standardCode: string | null = null;

  const hasExplicitTuInText =
    /(?:^|[^a-zа-я0-9])(?:по\s+)?ту(?:\s*[\d.-]+)?(?=$|[^a-zа-я0-9])/i.test(lowerPrimary) ||
    /(?:^|[^a-zа-я0-9])(?:по\s+)?ту(?:\s*[\d.-]+)?(?=$|[^a-zа-я0-9])/i.test(lowerCombined) ||
    /\[tu\]|\(\s*(?:[^()]*,\s*)?tu\s*\)|(?:^|[^a-zа-я0-9])tu\s+standart/i.test(lowerCombined);

  const hasExplicitGostInText =
    isAtmosPineGostSku ||
    /(?:^|[^a-zа-я0-9])(?:гост|gost)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary) ||
    /\[gost\]|\(\s*(?:[^()]*,\s*)?gost\s*\)/i.test(lowerCombined);

  if (hasExplicitTuInText && !isAtmosPineGostSku) {
    standardType = 'TU';
    const tuNum = lowerCombined.match(/(?:^|[^a-zа-я0-9])ту[\s\-№:]*(\d{2,6}(?:[.-]\d+)*)/i);
    if (tuNum) standardCode = `TU-${tuNum[1]}`;
  } else if (hasExplicitGostInText) {
    standardType = 'GOST';
    const gostNum = lowerPrimary.match(/(?:^|[^a-zа-я0-9])(?:гост|gost)(?:\s*[рr])?[\s\-№:]*(\d{3,6})/i);
    if (gostNum) standardCode = `GOST-${gostNum[1]}`;
  } else if (isAtmosAspenTuSku) {
    standardType = 'TU';
  }

  // DIN / ISO standart numaraları
  if (!standardCode) {
    const dinIso = lowerCombined.match(/(?:^|[^a-zа-я0-9])(din|iso|en)[\s\-№:]*(\d{2,6})(?=$|[^0-9])/i);
    if (dinIso) {
      standardCode = `${dinIso[1].toUpperCase()}-${dinIso[2]}`;
    }
  }

  // 3. Kalite Sınıfı (Сорт 1 / 1-2 / 2 / 3 / Экстра / АВ / ВС / Kontrplak 1/1..4/4)
  let qualityGrade: TechnicalVariantProfile['qualityGrade'] = null;
  if (/(?:сорт\s*)?1\s*[/\\]\s*1(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak|сорт/i.test(lowerCombined)) {
    qualityGrade = 'SORT_1_1';
  } else if (/(?:сорт\s*)?1\s*[/\\]\s*2(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak/i.test(lowerCombined)) {
    qualityGrade = 'SORT_1_2_PLY';
  } else if (/(?:сорт\s*)?2\s*[/\\]\s*2(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak|сорт/i.test(lowerCombined)) {
    qualityGrade = 'SORT_2_2';
  } else if (/(?:сорт\s*)?2\s*[/\\]\s*4(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak|сорт/i.test(lowerCombined)) {
    qualityGrade = 'SORT_2_4';
  } else if (/(?:сорт\s*)?3\s*[/\\]\s*4(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak|сорт/i.test(lowerCombined)) {
    qualityGrade = 'SORT_3_4';
  } else if (/(?:сорт\s*)?4\s*[/\\]\s*4(?:\s*сорт)?(?=$|[^0-9])/i.test(lowerPrimary) && /фанер|plywood|kontrplak|сорт/i.test(lowerCombined)) {
    qualityGrade = 'SORT_4_4';
  } else if (/сорт[\s:=-]*1\s*[-/]\s*2(?![0-9])|1\s*[-/]\s*2[\s-]*сорт|(?:sınıf|sinif|sort)[\s:=-]*1\s*[-/]\s*2(?![0-9])|1\s*[-/]\s*2\.?\s*(?:sınıf|sinif)/i.test(lowerCombined)) {
    qualityGrade = 'SORT_1_2';
  } else if (/сорт[\s:=-]*экстра|экстра\s*сорт|ekstra\s*(?:sınıf|sinif)|\[ekstra\]/i.test(lowerCombined)) {
    qualityGrade = 'SORT_EXTRA';
  } else if (/(?:^|[^a-zа-я0-9])сорт[\s:=-]*(?:ав|ab)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    qualityGrade = 'SORT_AB';
  } else if (/(?:^|[^a-zа-я0-9])сорт[\s:=-]*(?:вс|bc)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    qualityGrade = 'SORT_BC';
  } else if (/сорт[\s:=-]*1(?![0-9/\\-])|(?<!1\s*[-/\\]\s*)1(?:-?й)?[\s-]*сорт|\[sort-1\]|(?:sınıf|sinif|sort)[\s:=-]*1(?![0-9/\\-])|(?<!1\s*[-/\\]\s*)1\.\s*(?:sınıf|sinif)/i.test(lowerPrimary)) {
    qualityGrade = 'SORT_1';
  } else if (/сорт[\s:=-]*2(?![0-9/\\-])|(?<![12]\s*[-/\\]\s*)2(?:-?й)?[\s-]*сорт|\[sort-2\]|(?:sınıf|sinif|sort)[\s:=-]*2(?![0-9/\\-])|(?<![12]\s*[-/\\]\s*)2\.\s*(?:sınıf|sinif)/i.test(lowerPrimary)) {
    qualityGrade = 'SORT_2';
  } else if (/сорт[\s:=-]*3(?![0-9/\\-])|(?<![123]\s*[-/\\]\s*)3(?:-?й)?[\s-]*сорт|\[sort-3\]|(?:sınıf|sinif|sort)[\s:=-]*3(?![0-9/\\-])|(?<![123]\s*[-/\\]\s*)3\.\s*(?:sınıf|sinif)/i.test(lowerPrimary)) {
    qualityGrade = 'SORT_3';
  }

  // 4. Nem Durumu (Камерной сушки / Сухой vs Естественной влажности / ЕВ)
  let moistureState: TechnicalVariantProfile['moistureState'] = null;
  if (/камерн[а-я]*\s*сушк|(?:^|[^a-zа-я0-9])сух(?:ой|ая|ое|ие)(?=$|[^a-zа-я0-9])|fırın\s*kuru|firin\s*kuru|\[kuru\]/i.test(lowerCombined)) {
    moistureState = 'DRY';
  } else if (/естественн[а-я]*\s*влажн|(?:^|[^a-zа-я0-9])ев(?=$|[^a-zа-я0-9])|doğal\s*nem/i.test(lowerCombined)) {
    moistureState = 'NATURAL';
  }

  // 5. Yüzey ve Koruma İşlemi (Строганный / Необрезной / Антисептированный)
  const textWithoutNegPlaned = lowerCombined
    .replace(/не\s*строган[а-я]*/gi, ' ')
    .replace(/нестроган[а-я]*/gi, ' ')
    .replace(/rendelenmemiş|rendelenmemis|planyasız|planyasiz/gi, ' ');

  let surfaceTreatment: TechnicalVariantProfile['surfaceTreatment'] = null;
  if (/антисепт|импрегн|огнебио|emprenye|\[emprenyeli\]/i.test(lowerCombined)) {
    surfaceTreatment = 'ANTISEPTIC';
  } else if (/не\s*обрезн|необрезн|kenarsız|kenarsiz|\[kenarsız\]/i.test(lowerCombined)) {
    surfaceTreatment = 'UNEDGED';
  } else if (/строган|planyal|silinmiş|silinmis|rendelenmiş|rendelenmis|\[planyalı\]/i.test(textWithoutNegPlaned)) {
    surfaceTreatment = 'PLANED';
  }

  // 6. Ağaç Türü (Осина / Kavak, Лиственница / Melez, Береза / Huş, Хвоя / Сосна / Ель / Çam)
  let woodSpecies: TechnicalVariantProfile['woodSpecies'] = null;
  if (isAtmosAspenTuSku || /осина|осинов|kavak|aspen/i.test(lowerCombined)) {
    woodSpecies = 'ASPEN';
  } else if (/лиственниц|melez|karaçam|karacam|larch/i.test(lowerCombined)) {
    woodSpecies = 'LARCH';
  } else if (/берез|huş\b|hus\b|birch/i.test(lowerCombined)) {
    woodSpecies = 'BIRCH';
  } else if (isAtmosPineGostSku || /хвоя|хвойн|сосна|соснов|ель\b|елов|çam\b|cam\s*kereste|köknar|ladin/i.test(lowerCombined)) {
    woodSpecies = 'PINE_SPRUCE';
  }

  // 7. Kontrplak / OSB Levha Sınıfı (ФСФ / ФК / Ламинированная / OSB-3 / OSB-2)
  let panelGrade: TechnicalVariantProfile['panelGrade'] = null;
  if (/фанер|plywood|kontrplak|осп|осб|osb/i.test(lowerCombined)) {
    if (/ламинирован|лбфф|deck|film\s*kapl|filmli|(?:^|[^a-zа-я0-9])фоф(?=$|[^a-zа-я0-9])|\bfof\b/i.test(lowerPrimary)) {
      panelGrade = 'LAMINATED';
    } else if (/(?:^|[^a-zа-я0-9])фк(?=$|[^a-zа-я0-9])|\bfk\b/i.test(lowerPrimary)) {
      panelGrade = 'FK';
    } else if (/(?:^|[^a-zа-я0-9])фсф(?=$|[^a-zа-я0-9])|\bfsf\b/i.test(lowerPrimary)) {
      panelGrade = 'FSF';
    } else if (/(?:осп|осб|osb)[\s-]*3/i.test(lowerPrimary)) {
      panelGrade = 'OSB_3';
    } else if (/(?:осп|осб|osb)[\s-]*2/i.test(lowerPrimary)) {
      panelGrade = 'OSB_2';
    }
  }

  // 8. Çelik Kalitesi (Ст3 vs 09Г2С vs А500С vs А400 vs А240 vs Вр-1), Ürün Formu (Катанка vs Арматура) & Haddeleme (г/к vs х/к)
  let steelGrade: TechnicalVariantProfile['steelGrade'] = null;
  if (/09\s*[гg]\s*2\s*[сc]|c345|с345/i.test(lowerPrimary)) {
    steelGrade = '09G2S';
  } else if (/[аa]\s*500\s*[сc]?|[вb]\s*500\s*[сc]?/i.test(lowerPrimary)) {
    steelGrade = 'A500C';
  } else if (/[аa]\s*400\s*[сc]?|[аa][\s-]*iii\b/i.test(lowerPrimary)) {
    steelGrade = 'A400';
  } else if (/[аa]\s*240\s*[сc]?|[аa][\s-]*i\b/i.test(lowerPrimary)) {
    steelGrade = 'A240';
  } else if (/(?:^|[^a-zа-я0-9])вр[\s-]*1(?=$|[^0-9])/i.test(lowerPrimary)) {
    steelGrade = 'VR1';
  } else if (/(?:^|[^a-zа-я0-9])ст\.?\s*3(?:сп|пс|кп)?(?=$|[^0-9])|(?:^|[^a-zа-я0-9])c235|с235|c245|с245/i.test(lowerPrimary)) {
    steelGrade = 'ST3';
  }

  let steelProductForm: TechnicalVariantProfile['steelProductForm'] = null;
  if (/(?:^|[^a-zа-я0-9])(?:катанка|filmaşin|filmasin)(?=$|[^a-zа-я0-9])/i.test(lowerCombined)) {
    steelProductForm = 'WIRE_ROD_KATANKA';
  } else if (/арм\.\s*пруток|сталь\s+углеродистая\s+для\s+армирования|(?:^|[^a-zа-я0-9])арматур[аыуеой](?!\s*перемыч)/i.test(lowerPrimary)) {
    steelProductForm = 'REBAR_BAR';
  }

  let steelRollingType: TechnicalVariantProfile['steelRollingType'] = null;
  if (/(?:^|[^a-zа-я0-9])(?:г\/к|горячекатан[а-я]*)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    steelRollingType = 'HOT_ROLLED';
  } else if (/(?:^|[^a-zа-я0-9])(?:х\/к|холоднокатан[а-я]*)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    steelRollingType = 'COLD_ROLLED';
  }

  // 9. Kaplama Tipi (Galvanizli vs Siyah/Oksit/Fosfat vs Paslanmaz A2/A4)
  let coatingType: TechnicalVariantProfile['coatingType'] = null;
  if (/(?:^|[^a-zа-я0-9])(?:a4|а4|aisi\s*316)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    coatingType = 'STAINLESS_A4';
  } else if (/нержав|(?:^|[^a-zа-я0-9])(?:a2|а2|aisi\s*304)(?=$|[^a-zа-я0-9])|paslanmaz/i.test(lowerPrimary)) {
    coatingType = 'STAINLESS_A2';
  } else if (/не\s*оцинк|неоцинк|без\s*покрыт|(?:^|[^a-zа-я0-9])(?:оксид|фосфат[а-я]*)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)) {
    coatingType = 'BLACK_OXIDE';
  } else if (/оцинк|(?:^|[^a-zа-я0-9])оц\.(?=\s|$)|белый\s*цинк|желтый\s*цинк|galvaniz/i.test(lowerPrimary)) {
    coatingType = 'GALVANIZED';
  }

  // 10. Bağlantı Elemanı Mukavemet Sınıfı (к.п. 4.8 / 5.8 / 8.8 / 10.9 / 12.9) & Manşon Serisi (P14 vs D14)
  let fastenerStrength: string | null = null;
  const kpMatch = lowerPrimary.match(/(?:к\.?\s*п\.?|кл\.?\s*пр\.?|класс\s+прочности|kp)\s*(4\.8|5\.8|8\.8|10\.9|12\.9)(?=$|[^0-9])/i);
  if (kpMatch) {
    fastenerStrength = kpMatch[1];
  }

  let couplerSeries: string | null = null;
  if (/муфта|manşon|manson/i.test(lowerCombined)) {
    const cMatch = lowerPrimary.match(/(?:^|[^a-zа-я0-9])([pр]14|[pр]13|[dд]14|[aа]12)(?=$|[^a-zа-я0-9])/i);
    if (cMatch) {
      const rawCode = cMatch[1].toUpperCase().replace('Р', 'P').replace('Д', 'D').replace('А', 'A');
      couplerSeries = rawCode;
    }
  }

  // 11. El Aleti & Tabanca Gövde ve Mekanizma Tipi (Metal/Ayarlı vs Plastik/Ayarsız vs Kauçuk Kaplı vs Teflon)
  let toolBodyAndMechanism: TechnicalVariantProfile['toolBodyAndMechanism'] = null;
  if (/тефлон|teflon/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'TEFLON_PRO';
  } else if (/метал[а-я.]*.*с\s+регулятор|с\s+регулятор.*метал/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'METAL_REGULATED';
  } else if (/пластик.*без\s+регулятор|без\s+регулятор/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'PLASTIC_BODY';
  } else if (/прорезиненн[а-я]*\s+корпус|обрезиненн[а-я]*\s+корпус/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'RUBBERIZED_BODY';
  } else if (/пластиков[а-я]*\s+корпус/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'PLASTIC_BODY';
  } else if (/металлическ[а-я]*\s+корпус/i.test(lowerPrimary)) {
    toolBodyAndMechanism = 'METAL_BODY';
  }

  // 12. Polietilen Film Hammadde & Yapı Sınıfı (Первичная vs Техническая vs Армированная ЭКО/Стандарт)
  let filmGrade: TechnicalVariantProfile['filmGrade'] = null;
  if (/(?:^|[^a-zа-я0-9])пл[её]нка/i.test(lowerPrimary) && !/гидроизоляц|наплавляем|виллафлекс|техноэласт|унифлекс|термопленк|ламинирован/i.test(lowerPrimary)) {
    if (/армирован/i.test(lowerPrimary)) {
      filmGrade = /(?:^|[^a-zа-я0-9])(?:эко|eco)(?=$|[^a-zа-я0-9])/i.test(lowerPrimary)
        ? 'REINFORCED_ECO'
        : 'REINFORCED_STD';
    } else if (/техническ|вторичн/i.test(lowerPrimary)) {
      filmGrade = 'TECHNICAL';
    } else if (/первичн/i.test(lowerPrimary)) {
      filmGrade = 'PRIMARY';
    }
  }

  // 13. Rulo ve Paket Hacmi / Alanı (1,22 м³/упак vs 0,585 м³/упак; 300 м² vs 150 м² vs 10 м²)
  let packageVolumeM3: string | null = null;
  const volM3Match =
    lowerPrimary.match(/(\d+\.\d+)\s*(?:м3|m3|м³|m³|куб\.?\s*м)\s*(?:\/\s*(?:упак|уп|рул|пач))?/i) ||
    (/пеноплэкс|пеноплекс|penoplex|carbon\s*prof|\bxps\b|технониколь\s+маты/i.test(lowerPrimary)
      ? lowerPrimary.match(/\(\s*(0\.\d{3,4}|1\.\d{2,3})\s*(?:м3|m3)?\s*\)/i)
      : null);
  if (volM3Match) {
    const v = Number(volM3Match[1]);
    if (v > 0.02 && v <= 5) {
      packageVolumeM3 = String(v);
    }
  }

  let rollAreaM2: string | null = null;
  const areaM2Match = lowerPrimary.match(/(?:\(\s*|\b)(\d{1,3}(?:\.\d+)?)\s*(?:м2|m2|м²|m²|кв\.?\s*м)(?:\s*\)|\b)/i);
  if (areaM2Match) {
    const a = Number(areaM2Match[1]);
    if (a >= 5 && a <= 600) {
      rollAreaM2 = String(a);
    }
  } else if (/(?:^|[^a-zа-я0-9])(?:пл[её]нка|геотекстиль|дорнит|мембрана|изоспан|ветрозащит|пароизоляц|гидроизоляц)/i.test(lowerPrimary)) {
    const rollDim = lowerPrimary.match(/(?:^|[^\d.])([12346])x(10|15|20|25|30|50|70|100|105|150)\s*(?:м|m)?(?=$|[^\d.])/i);
    if (rollDim) {
      rollAreaM2 = String(Number(rollDim[1]) * Number(rollDim[2]));
    }
  }

  // 13b. Birbirini dışlayan ürün tipi ailesi ve ürün serisi / yoğunluk / alt model kodu
  let productType: string | null = null;
  for (const fam of PRODUCT_TYPE_FAMILIES) {
    if (fam.pattern.test(lowerPrimary) || fam.pattern.test(lowerCombined)) {
      productType = fam.type;
      break;
    }
  }

  let productSeries: string | null = null;
  let productSeriesLabel: string | null = null;
  for (const sRule of PRODUCT_SERIES_RULES) {
    if (sRule.seriesKey.startsWith('TIMBER_SORT_')) continue;
    if (sRule.pattern.test(primaryForStdAndSort) || sRule.pattern.test(combined)) {
      productSeries = sRule.seriesKey;
      productSeriesLabel = sRule.seriesLabel;
      break;
    }
  }

  // 14. Tam Kesit / Ölçü (örn. 50x100x6000 veya tireli yalıtım şiltesi 10000-1220-50)
  let crossSectionDims: string | null = null;
  const dim3 = lowerCombined.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=$|[^\d.])/);
  const hyphenInsulDim3 = !dim3 ? lowerPrimary.match(/\b(\d{3,5})-(\d{3,4})-(\d{2,3})\s*(?:мм|mm)\b/) : null;
  const dim2 = (!dim3 && !hyphenInsulDim3) ? lowerCombined.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=$|[^\d.])/) : null;
  if (dim3) {
    crossSectionDims = normalize3DTimberDimsToMm(Number(dim3[1]), Number(dim3[2]), Number(dim3[3]), isTimber);
  } else if (hyphenInsulDim3) {
    crossSectionDims = [Number(hyphenInsulDim3[1]), Number(hyphenInsulDim3[2]), Number(hyphenInsulDim3[3])].sort((a, b) => a - b).join('x');
  } else if (dim2) {
    crossSectionDims = [Number(dim2[1]), Number(dim2[2])].sort((a, b) => a - b).join('x');
  }

  // 15. Rozetler (Badges) ve Varyant Anahtarı ([GOST], [TU], [Sort-1], [09Г2С], [к.п. 8.8], [Metal / Ayarlı], [1.22 m³/Paket])
  const badges: string[] = [];
  if (standardType === 'GOST') badges.push('GOST');
  else if (standardType === 'TU') badges.push('TU');

  const sortBadgeMap: Record<NonNullable<TechnicalVariantProfile['qualityGrade']>, string> = {
    SORT_EXTRA: 'Ekstra',
    SORT_1: 'Sort-1',
    SORT_1_2: 'Sort-1/2',
    SORT_2: 'Sort-2',
    SORT_3: 'Sort-3',
    SORT_AB: 'Sort-AB',
    SORT_BC: 'Sort-BC',
    SORT_1_1: 'Sort-1/1',
    SORT_1_2_PLY: 'Sort-1/2',
    SORT_2_2: 'Sort-2/2',
    SORT_2_4: 'Sort-2/4',
    SORT_3_4: 'Sort-3/4',
    SORT_4_4: 'Sort-4/4'
  };
  if (qualityGrade) badges.push(sortBadgeMap[qualityGrade]);

  if (moistureState === 'DRY') badges.push('Fırın Kurusu');
  if (surfaceTreatment === 'PLANED') badges.push('Planyalı');
  else if (surfaceTreatment === 'UNEDGED') badges.push('Kenarsız');
  else if (surfaceTreatment === 'ANTISEPTIC') badges.push('Emprenyeli');

  if (isTimber) {
    if (woodSpecies === 'ASPEN') badges.push('Kavak / Осина');
    else if (woodSpecies === 'LARCH') badges.push('Karaçam / Лиственница');
    else if (woodSpecies === 'BIRCH') badges.push('Huş / Береза');
  }
  if (panelGrade === 'FK') badges.push('ФК');
  else if (panelGrade === 'FSF') badges.push('ФСФ');
  else if (panelGrade === 'LAMINATED') badges.push('Filmli ФСФ');

  if (steelGrade === '09G2S') badges.push('09Г2С');
  else if (steelGrade === 'ST3') badges.push('Ст3');
  if (steelProductForm === 'WIRE_ROD_KATANKA') badges.push('Filmaşin / Катанка');
  if (coatingType === 'GALVANIZED') badges.push('Galvanizli');
  else if (coatingType === 'BLACK_OXIDE') badges.push('Oksit / Siyah');
  else if (coatingType === 'STAINLESS_A2') badges.push('Paslanmaz A2');
  else if (coatingType === 'STAINLESS_A4') badges.push('Paslanmaz A4');
  if (fastenerStrength) badges.push(`к.п. ${fastenerStrength}`);
  if (couplerSeries) badges.push(`Seri ${couplerSeries}`);
  if (toolBodyAndMechanism === 'METAL_REGULATED') badges.push('Metal Gövde / Ayarlı');
  else if (toolBodyAndMechanism === 'METAL_BODY') badges.push('Metal Gövde');
  else if (toolBodyAndMechanism === 'PLASTIC_BODY') badges.push('Plastik Gövde / Ayarsız');
  else if (toolBodyAndMechanism === 'RUBBERIZED_BODY') badges.push('Kauçuk Kaplı Gövde');
  else if (toolBodyAndMechanism === 'TEFLON_PRO') badges.push('Teflon Kaplı');
  if (filmGrade === 'REINFORCED_ECO') badges.push('Arme EKO');
  else if (filmGrade === 'TECHNICAL') badges.push('Teknik Film');
  else if (filmGrade === 'PRIMARY') badges.push('Birincil Film');
  if (productSeriesLabel && !badges.includes(productSeriesLabel)) badges.push(productSeriesLabel);
  if (packageVolumeM3) badges.push(`${packageVolumeM3} m³/Paket`);
  if (rollAreaM2) badges.push(`${rollAreaM2} m²/Rulo`);

  const keyParts: string[] = [];
  if (productType) keyParts.push(`TYPE:${productType}`);
  if (productSeries) keyParts.push(`SER:${productSeries}`);
  if (standardType) keyParts.push(`STD:${standardType}`);
  if (standardCode) keyParts.push(`CODE:${standardCode}`);
  if (qualityGrade) keyParts.push(`GRD:${qualityGrade}`);
  if (moistureState === 'DRY') keyParts.push('MST:DRY');
  if (surfaceTreatment) keyParts.push(`TRT:${surfaceTreatment}`);
  if (isTimber && woodSpecies && woodSpecies !== 'PINE_SPRUCE') keyParts.push(`WOOD:${woodSpecies}`);
  if (panelGrade) keyParts.push(`PNL:${panelGrade}`);
  if (steelGrade) keyParts.push(`STL:${steelGrade}`);
  if (steelProductForm) keyParts.push(`SFRM:${steelProductForm}`);
  if (steelRollingType) keyParts.push(`SROL:${steelRollingType}`);
  if (coatingType) keyParts.push(`COAT:${coatingType}`);
  if (fastenerStrength) keyParts.push(`KP:${fastenerStrength}`);
  if (couplerSeries) keyParts.push(`CPL:${couplerSeries}`);
  if (toolBodyAndMechanism) keyParts.push(`BODY:${toolBodyAndMechanism}`);
  if (filmGrade) keyParts.push(`FILM:${filmGrade}`);
  if (packageVolumeM3) keyParts.push(`PVOL:${packageVolumeM3}`);
  if (rollAreaM2) keyParts.push(`RAREA:${rollAreaM2}`);

  return {
    standardType,
    standardCode,
    qualityGrade,
    moistureState,
    surfaceTreatment,
    woodSpecies,
    panelGrade,
    steelGrade,
    steelProductForm,
    steelRollingType,
    coatingType,
    fastenerStrength,
    couplerSeries,
    toolBodyAndMechanism,
    filmGrade,
    packageVolumeM3,
    rollAreaM2,
    productType,
    productSeries,
    crossSectionDims,
    isTimber,
    badges,
    variantKey: keyParts.join('|')
  };
}

export function formatTechnicalVariantBadges(profile: TechnicalVariantProfile): string {
  if (!profile.badges.length) return '';
  return profile.badges.map(b => `[${b}]`).join(' ');
}

/**
 * İki malzeme kaleminin tüm kategorilerde teknik standart (GOST vs TU), kalite sınıfı,
 * çelik/kaplama/mukavemet sınıfı, el aleti gövde/mekanizma tipi, polietilen film sınıfı,
 * rulo/paket hacmi (m³/m²) ve kesit/ölçü bakımından uyumlu olup olmadığını denetler.
 */
export function areTechnicalVariantsCompatible(
  a: TechnicalVariantProfile,
  b: TechnicalVariantProfile
): { compatible: boolean; conflictReason?: string } {
  // 0. Birbirini dışlayan ürün tipi ailesi (örn. Kürek Sapı Черенок vs Kürek Лопата, Membran vs Polietilen Film, Yarım Bot vs Bot)
  if (a.productType && b.productType && a.productType !== b.productType) {
    return { compatible: false, conflictReason: `Ürün tipi farkı: ${a.productType} ⟷ ${b.productType}` };
  }
  if ((a.productType === 'cherenok') !== (b.productType === 'cherenok')) {
    return { compatible: false, conflictReason: `Alet sapı (Черенок) ile komple alet kıyaslanamaz` };
  }

  // 0b. Ürün serisi / yoğunluk / alt model kodu (örn. 40 RN vs 34 RN, Техновент Оптима vs Стандарт, Ультранап/Техноэласт karma satır)
  if (a.productSeries && b.productSeries && a.productSeries !== b.productSeries) {
    return { compatible: false, conflictReason: `Ürün serisi farkı: ${a.productSeries} ⟷ ${b.productSeries}` };
  }
  if ((a.productSeries === 'ULTRANAP_OR_TEHNOELAST') !== (b.productSeries === 'ULTRANAP_OR_TEHNOELAST')) {
    return { compatible: false, conflictReason: `Çoklu/karma seri (Ультранап / Техноэласт) ile tekil seri kıyaslanamaz` };
  }

  // 1. GOST vs TU kesin ayrımı (biri null ise diğer teknik kriterler uyuştuğu sürece uyumlu)
  if (a.standardType && b.standardType && a.standardType !== b.standardType) {
    return { compatible: false, conflictReason: `Standart farkı: ${a.standardType} ⟷ ${b.standardType}` };
  }
  if (a.standardCode && b.standardCode && a.standardCode !== b.standardCode) {
    return { compatible: false, conflictReason: `Standart numarası farkı: ${a.standardCode} ⟷ ${b.standardCode}` };
  }

  // 2. Kalite sınıfı (Сорт 1 / 1-2 / 2 / 3 / 1/1..4/4) ayrımı
  if (a.qualityGrade && b.qualityGrade && a.qualityGrade !== b.qualityGrade) {
    return { compatible: false, conflictReason: `Kalite sınıfı farkı: ${a.qualityGrade} ⟷ ${b.qualityGrade}` };
  }
  if (a.isTimber || b.isTimber) {
    const aTotallyUngraded = !a.standardType && !a.qualityGrade;
    const bTotallyUngraded = !b.standardType && !b.qualityGrade;
    if ((a.qualityGrade && bTotallyUngraded) || (b.qualityGrade && aTotallyUngraded)) {
      return {
        compatible: false,
        conflictReason: `Sınıflı kereste (${a.qualityGrade || b.qualityGrade}) ile standart/sınıf belirtilmemiş genel kereste kıyaslanamaz`
      };
    }
  }

  // 3. Nem durumu (Fırın kurusu DRY vs Doğal nemli / standart)
  if ((a.moistureState === 'DRY') !== (b.moistureState === 'DRY')) {
    return { compatible: false, conflictReason: `Nem/kurutma farkı: ${a.moistureState || 'Standart'} ⟷ ${b.moistureState || 'Standart'}` };
  }

  // 4. Yüzey / Koruma işlemi (Planyalı / Kenarsız / Emprenyeli vs Standart Biçilmiş)
  if (a.surfaceTreatment !== b.surfaceTreatment) {
    return { compatible: false, conflictReason: `Yüzey/işlem farkı: ${a.surfaceTreatment || 'Standart'} ⟷ ${b.surfaceTreatment || 'Standart'}` };
  }

  // 5. Ağaç türü (Kavak / Karaçam / Huş vs Çam/Ladin)
  const normWoodA = a.isTimber ? (a.woodSpecies || 'PINE_SPRUCE') : a.woodSpecies;
  const normWoodB = b.isTimber ? (b.woodSpecies || 'PINE_SPRUCE') : b.woodSpecies;
  if (normWoodA && normWoodB && normWoodA !== normWoodB) {
    return { compatible: false, conflictReason: `Ağaç türü farkı: ${normWoodA} ⟷ ${normWoodB}` };
  }

  // 6. Kontrplak / OSB levha sınıfı (ФК vs ФСФ vs Ламинированная)
  if (a.panelGrade && b.panelGrade && a.panelGrade !== b.panelGrade) {
    return { compatible: false, conflictReason: `Levha sınıfı farkı: ${a.panelGrade} ⟷ ${b.panelGrade}` };
  }

  // 7. Çelik kalitesi (Ст3 vs 09Г2С vs А500С vs А400 vs А240 vs Вр-1), ürün formu (Катанка vs Арматура) ve haddeleme tipi (г/к vs х/к)
  if (a.steelGrade && b.steelGrade && a.steelGrade !== b.steelGrade) {
    return { compatible: false, conflictReason: `Çelik kalite sınıfı farkı: ${a.steelGrade} ⟷ ${b.steelGrade}` };
  }
  if (a.steelProductForm && b.steelProductForm && a.steelProductForm !== b.steelProductForm) {
    return { compatible: false, conflictReason: `Çelik ürün formu farkı: ${a.steelProductForm} ⟷ ${b.steelProductForm}` };
  }
  if ((a.steelProductForm === 'WIRE_ROD_KATANKA') !== (b.steelProductForm === 'WIRE_ROD_KATANKA')) {
    return { compatible: false, conflictReason: `Filmaşin (Катанка) ile çubuk demir kıyaslanamaz` };
  }
  if (a.steelRollingType && b.steelRollingType && a.steelRollingType !== b.steelRollingType) {
    return { compatible: false, conflictReason: `Haddeleme tipi farkı: ${a.steelRollingType} ⟷ ${b.steelRollingType}` };
  }

  // 8. Yüzey kaplama tipi (Galvanizli vs Siyah/Oksit vs Paslanmaz A2/A4)
  if (a.coatingType && b.coatingType && a.coatingType !== b.coatingType) {
    return { compatible: false, conflictReason: `Kaplama farkı: ${a.coatingType} ⟷ ${b.coatingType}` };
  }
  if (
    ((a.coatingType === 'GALVANIZED' || a.coatingType === 'STAINLESS_A2' || a.coatingType === 'STAINLESS_A4') && !b.coatingType) ||
    ((b.coatingType === 'GALVANIZED' || b.coatingType === 'STAINLESS_A2' || b.coatingType === 'STAINLESS_A4') && !a.coatingType)
  ) {
    return { compatible: false, conflictReason: `Kaplama farkı: ${a.coatingType || 'Kaplamasız/Standart'} ⟷ ${b.coatingType || 'Kaplamasız/Standart'}` };
  }

  // 9. Bağlantı elemanı mukavemet sınıfı (к.п. 5.8 vs 8.8 vs 10.9) ve donatı manşonu serisi (P14 vs D14)
  if (a.fastenerStrength && b.fastenerStrength && a.fastenerStrength !== b.fastenerStrength) {
    return { compatible: false, conflictReason: `Mukavemet sınıfı farkı: к.п. ${a.fastenerStrength} ⟷ к.п. ${b.fastenerStrength}` };
  }
  if (a.couplerSeries && b.couplerSeries && a.couplerSeries !== b.couplerSeries) {
    return { compatible: false, conflictReason: `Manşon serisi farkı: ${a.couplerSeries} ⟷ ${b.couplerSeries}` };
  }

  // 10. El aleti / tabanca gövde ve mekanizma tipi (Metal/Ayarlı vs Plastik/Ayarsız vs Kauçuk Kaplı)
  if (a.toolBodyAndMechanism && b.toolBodyAndMechanism && a.toolBodyAndMechanism !== b.toolBodyAndMechanism) {
    return { compatible: false, conflictReason: `Gövde/mekanizma farkı: ${a.toolBodyAndMechanism} ⟷ ${b.toolBodyAndMechanism}` };
  }

  // 11. Polietilen film hammadde / yapı sınıfı
  if (a.filmGrade && b.filmGrade && a.filmGrade !== b.filmGrade) {
    return { compatible: false, conflictReason: `Film kalite sınıfı farkı: ${a.filmGrade} ⟷ ${b.filmGrade}` };
  }

  // 12. Rulo ve paket hacmi / metrajı (m³ / m²)
  if (a.packageVolumeM3 && b.packageVolumeM3 && !nearlyEqual(Number(a.packageVolumeM3), Number(b.packageVolumeM3), 0.03)) {
    return { compatible: false, conflictReason: `Paket hacmi farkı: ${a.packageVolumeM3} m³ ⟷ ${b.packageVolumeM3} m³` };
  }
  if (a.rollAreaM2 && b.rollAreaM2 && !nearlyEqual(Number(a.rollAreaM2), Number(b.rollAreaM2), 0.03)) {
    return { compatible: false, conflictReason: `Rulo/plaka alanı farkı: ${a.rollAreaM2} m² ⟷ ${b.rollAreaM2} m²` };
  }

  // 13. Tam kesit ve ölçü uyumu
  if (a.crossSectionDims && b.crossSectionDims && !areDimsCompatible(a.crossSectionDims, b.crossSectionDims)) {
    return { compatible: false, conflictReason: `Kesit/ölçü farkı: ${a.crossSectionDims} ⟷ ${b.crossSectionDims}` };
  }

  return { compatible: true };
}

export function extractSpecSignature(rawText: string): SpecSignature {
  const cleanedInput = stripLegacySyntheticTimberTag(stripSyntheticTemplates(rawText));
  const t = normText(cleanedInput);
  const sig: SpecSignature = {};
  if (!t) return sig;

  for (const fam of PRODUCT_TYPE_FAMILIES) {
    if (fam.pattern.test(t)) { sig.type = fam.type; break; }
  }

  // Marka ve Ürün Serisi / Yoğunluk Sınıfı Çıkarımı
  const brandAndSeries = extractOriginalBrandAndSeries(cleanedInput);
  if (!brandAndSeries.isCommodity && brandAndSeries.brandKey) {
    sig.brand = brandAndSeries.brandKey;
  }
  if (brandAndSeries.seriesKey) {
    sig.series = brandAndSeries.seriesKey;
  }

  // Evrensel Teknik Varyant Profili (Standart, Kalite, Çelik, Kaplama, Gövde, Film, Rulo/Paket Hacmi)
  const techVariant = extractTechnicalStandardAndGrade(cleanedInput);
  if (techVariant.standardType) {
    sig.standard = techVariant.standardCode || techVariant.standardType;
  } else if (techVariant.standardCode) {
    sig.standard = techVariant.standardCode;
  }
  if (techVariant.qualityGrade) {
    sig.qualitySort = techVariant.qualityGrade;
    if (sig.series && sig.series.startsWith('TIMBER_SORT_')) {
      delete sig.series;
    }
  }
  if (techVariant.isTimber) {
    sig.moisture = techVariant.moistureState === 'DRY' ? 'DRY' : 'NATURAL';
    sig.treatment = techVariant.surfaceTreatment || 'EDGED_RAW';
    sig.woodSpecies = techVariant.woodSpecies || 'PINE_SPRUCE';
  } else {
    if (techVariant.moistureState === 'DRY') sig.moisture = 'DRY';
    if (techVariant.surfaceTreatment) sig.treatment = techVariant.surfaceTreatment;
    if (techVariant.woodSpecies) sig.woodSpecies = techVariant.woodSpecies;
  }
  if (techVariant.panelGrade) sig.panelGrade = techVariant.panelGrade;
  if (techVariant.steelGrade) sig.steelGrade = techVariant.steelGrade;
  if (techVariant.steelProductForm) sig.steelForm = techVariant.steelProductForm;
  if (techVariant.steelRollingType) sig.steelRolling = techVariant.steelRollingType;
  if (techVariant.coatingType) sig.coating = techVariant.coatingType;
  if (techVariant.couplerSeries) sig.couplerSeries = techVariant.couplerSeries;
  if (techVariant.toolBodyAndMechanism) sig.toolBody = techVariant.toolBodyAndMechanism;
  if (techVariant.filmGrade) sig.filmGrade = techVariant.filmGrade;
  if (techVariant.packageVolumeM3) sig.packVolM3 = techVariant.packageVolumeM3;
  if (techVariant.rollAreaM2) sig.rollAreaM2 = techVariant.rollAreaM2;

  if (techVariant.crossSectionDims) {
    sig.dims = techVariant.crossSectionDims;
  } else {
    const dims = t.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/);
    if (dims) {
      sig.dims = [dims[1], dims[2], dims[3]].filter(Boolean).map(Number).sort((a, b) => a - b).join('x');
    } else if (/технофас|техноблок|техновент|техноруф|технофлор|роклайт|минвата|минераловат|каменн|базальт|утеплител|теплоизоляц|taşyünü|taş\s*yünü|tasyunu|пеноплэкс|пеноплекс|penoplex|carbon\s*prof|\bxps\b|эппс|baswool|басвул|rockwool|роквул/i.test(t)) {
      const thMatch = t.match(/(?:^|[^\d.])(20|30|40|50|60|70|80|90|100|120|140|150|160|180|200|250)\s*(?:мм|mm)\b/);
      if (thMatch) {
        sig.dims = thMatch[1];
      }
    }
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
  const kp = t.match(/(?:к\.?\s?п\.?|кл\.?\s?пр\.?|класс\s+прочности)\s*(\d+(?:\.\d+)?)/);
  if (kp) sig.strength = String(Number(kp[1]));
  // Polietilen rulo ağırlığı (örn. "200мкр (3х100) 21 кг" veya "100 мкр, 5 кг") torba/kova kg'ı değildir; rulo filmlerde bagKg atama!
  if (sig.type !== 'plenka-pe' && !/(?:^|[^a-zа-я0-9])пл[её]нка/i.test(t)) {
    const kg = t.match(/(?:^|[^\d.])(\d{1,2})\s*кг(?![a-zа-я])/);
    if (kg && Number(kg[1]) >= 5 && Number(kg[1]) <= 60) sig.bagKg = kg[1];
  }
  return sig;
}

function nearlyEqual(a: number, b: number, tol = 0.05): boolean {
  if (a === b) return true;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m > 0 && Math.abs(a - b) / m <= tol;
}

// Ölçüler: alt küme (50x50 ⊂ 50x50x3000), ±%5 tolerans (48x58 ≈ 50x60) ve cm↔mm ölçek farkı (5x10x600 ≈ 50x100x6000) uyumlu sayılır
export function areDimsCompatible(a: string, b: string): boolean {
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
    if (k === 'packVolM3' && nearlyEqual(Number(a.packVolM3), Number(b.packVolM3), 0.03)) continue;
    if (k === 'rollAreaM2' && nearlyEqual(Number(a.rollAreaM2), Number(b.rollAreaM2), 0.03)) continue;
    if (k === 'standard') {
      // GOST-8486 ile GOST uyumludur; ancak GOST ile TU kesin çelişir
      const isGostA = a.standard!.startsWith('GOST');
      const isGostB = b.standard!.startsWith('GOST');
      const isTuA = a.standard!.startsWith('TU');
      const isTuB = b.standard!.startsWith('TU');
      if (isGostA && isGostB && (a.standard === 'GOST' || b.standard === 'GOST' || a.standard === b.standard)) continue;
      if (isTuA && isTuB && (a.standard === 'TU' || b.standard === 'TU' || a.standard === b.standard)) continue;
    }
    out.push(k);
  }
  return out;
}

// Fiyat ölçü birimiyle (m², m³, ton, kg, metre, litre) ifade ediliyorsa ambalaj/ebat bilgisi birim fiyatı değiştirmez;
// ANCAK marka (brand), ürün serisi/yoğunluk sınıfı (series), standart (GOST/TU), kalite sınıfı (sort), çelik kalitesi, kaplama ve kereste/profil/boru/yalıtım kesit ölçüleri her durumda korunur!
const MEASURED_UNIT_RE = /^(?:m2|м2|m²|м²|metrekare|кв\.?\s*м|m3|м3|m³|m³|metreküp|куб|ton|тонн?а?|т|tn|kg|кг|m|м|metre|mt|пм|п\.м|l|л|lt|litre|литр)\.?$/i;

export function isMeasuredUnit(unit?: string): boolean {
  return MEASURED_UNIT_RE.test(String(unit || '').trim().toLowerCase());
}

export function extractSpecSignatureForUnit(rawText: string, unit?: string): SpecSignature {
  const sig = extractSpecSignature(rawText);
  if (isMeasuredUnit(unit)) {
    const keepDims = /технофас|техноблок|техновент|техноруф|технофлор|роклайт|минвата|минераловат|каменн|базальт|утеплител|теплоизоляц|маты|taşyünü|taş\s*yünü|tasyunu|пеноплэкс|пеноплекс|penoplex|carbon\s*prof|\bxps\b|эппс|baswool|басвул|rockwool|роквул|доска|брус|брусок|пиломатериал|рейка|kereste|kalas|фанер|plywood|осп|осб|osb|труба|профиль|швеллер|уголок|арматур|катанка|кабель|провод|ввг/i.test(rawText);
    if (!keepDims) {
      delete sig.dims;
    }
    delete sig.pack;
    // Boya / emal (ПФ-115 vb.) satırlarında bazı faturalar teneke/varil fiyatını sehven "KG" birimiyle yazabildiği için boya kovası/varili kg bilgisini koru
    if (!/эмаль|краска|грунт|праймер|мастика/i.test(rawText)) {
      delete sig.bagKg;
    }
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
    case 'standard': return v;
    case 'qualitySort': {
      const map: Record<string, string> = {
        SORT_EXTRA: 'Ekstra',
        SORT_1: 'Sort-1',
        SORT_1_2: 'Sort-1/2',
        SORT_2: 'Sort-2',
        SORT_3: 'Sort-3',
        SORT_AB: 'Sort-AB',
        SORT_BC: 'Sort-BC',
        SORT_1_1: 'Sort-1/1',
        SORT_1_2_PLY: 'Sort-1/2',
        SORT_2_2: 'Sort-2/2',
        SORT_2_4: 'Sort-2/4',
        SORT_3_4: 'Sort-3/4',
        SORT_4_4: 'Sort-4/4'
      };
      return map[v] || v;
    }
    case 'moisture': return v === 'DRY' ? 'Fırın Kurusu' : 'Doğal Nemli (ЕВ)';
    case 'treatment': return v === 'PLANED' ? 'Planyalı' : v === 'UNEDGED' ? 'Kenarsız' : v === 'ANTISEPTIC' ? 'Emprenyeli' : '';
    case 'woodSpecies': return v === 'ASPEN' ? 'Kavak (Осина)' : v === 'LARCH' ? 'Karaçam (Лиственница)' : v === 'BIRCH' ? 'Huş (Береза)' : 'Çam/Ladin';
    case 'panelGrade': return v === 'FK' ? 'ФК' : v === 'FSF' ? 'ФСФ' : v === 'LAMINATED' ? 'Filmli ФСФ' : v;
    case 'steelGrade': return v === '09G2S' ? '09Г2С' : v === 'ST3' ? 'Ст3' : v === 'VR1' ? 'Вр-1' : v;
    case 'steelForm': return v === 'WIRE_ROD_KATANKA' ? 'Filmaşin (Катанка)' : 'Çubuk Demir';
    case 'steelRolling': return v === 'HOT_ROLLED' ? 'Sıcak Çekme (г/к)' : 'Soğuk Çekme (х/к)';
    case 'coating': return v === 'GALVANIZED' ? 'Galvanizli' : v === 'BLACK_OXIDE' ? 'Oksit / Siyah' : v === 'STAINLESS_A2' ? 'Paslanmaz A2' : v === 'STAINLESS_A4' ? 'Paslanmaz A4' : v;
    case 'couplerSeries': return `Seri ${v}`;
    case 'toolBody': return v === 'METAL_REGULATED' ? 'Metal Gövde / Ayarlı' : v === 'METAL_BODY' ? 'Metal Gövde' : v === 'PLASTIC_BODY' ? 'Plastik Gövde / Ayarsız' : v === 'RUBBERIZED_BODY' ? 'Kauçuk Kaplı Gövde' : v === 'TEFLON_PRO' ? 'Teflon Kaplı' : v;
    case 'filmGrade': return v === 'REINFORCED_ECO' ? 'Arme EKO' : v === 'REINFORCED_STD' ? 'Arme Standart' : v === 'TECHNICAL' ? 'Teknik Film' : v === 'PRIMARY' ? 'Birincil Film' : v;
    case 'packVolM3': return `${v} m³/Paket`;
    case 'rollAreaM2': return `${v} m²/Rulo`;
    case 'dims': return `Ölçü ${v}`;
    case 'micron': return `${v} mikron`;
    case 'litre': return `${v} L`;
    case 'pack': return `${v} Adet/Paket`;
    case 'thread': return `M${v}`;
    case 'grade': return `M-${v}`;
    case 'strength': return `к.п. ${v}`;
    case 'bagKg': return `${v} kg`;
  }
  return v;
}

/**
 * Bir malzeme grubunu orijinal satırlardaki çelişen özelliklere (Marka, Seri/Yoğunluk, Tip, Standart, Kalite, Gövde, Ölçü, Mikron, Paket Hacmi vb.) göre alt gruplara böler.
 * Çelişki yoksa tek grup döner (label boş).
 */
export function splitGroupBySpec<T>(entries: T[], getText: (e: T) => string, getUnit?: (e: T) => string): Array<{ entries: T[]; label: string; signature: SpecSignature }> {
  if (entries.length < 2) return [{ entries, label: '', signature: entries[0] ? extractSpecSignature(getText(entries[0])) : {} }];

  const withSig = entries.map(e => ({ e, sig: extractSpecSignatureForUnit(getText(e), getUnit ? getUnit(e) : undefined) }));
  const richness = (s: SpecSignature) => SPEC_KEYS.filter(k => s[k]).length;
  const order = [...withSig].sort((x, y) => richness(y.sig) - richness(x.sig));

  // Kaliteyi ve birim fiyatı doğrudan değiştiren kritik teknik nitelikler:
  const CRITICAL: Array<keyof SpecSignature> = [
    'series',
    'micron',
    'strength',
    'grade',
    'toolBody',
    'filmGrade',
    'packVolM3',
    'rollAreaM2',
    'panelGrade',
    'coating',
    'couplerSeries',
    'bagKg'
  ];

  const clusters: Array<{ sig: SpecSignature; members: T[]; memberSigs: SpecSignature[]; unspecified?: boolean }> = [];
  for (const { e, sig } of order) {
    const candidates = clusters
      .filter(c => {
        if (getSpecConflicts(c.sig, sig).length > 0) return false;
        // Bir kümede TU standardı açıkça varsa, standart belirtilmemiş genel satırlarla (örn. Сетка 100х100х4 ТУ vs Сетка сварная 100х100х4) aynı kümeye koyma
        const isClusterTu = c.sig.standard?.startsWith('TU');
        const isItemTu = sig.standard?.startsWith('TU');
        if (Boolean(isClusterTu) !== Boolean(isItemTu)) return false;
        // İki satır farklı kritik nitelikler taşıyorsa (örn. birinde series var micron yok, diğerinde micron var series yok) birleştirme
        const clusterOnlyCrit = CRITICAL.some(k => c.sig[k] && !sig[k]);
        const itemOnlyCrit = CRITICAL.some(k => sig[k] && !c.sig[k]);
        if (clusterOnlyCrit && itemOnlyCrit) return false;
        return true;
      })
      .sort((a, b) => b.members.length - a.members.length);
    if (candidates.length > 0) {
      candidates[0].members.push(e);
      candidates[0].memberSigs.push(sig);
      mergeSig(candidates[0].sig, sig);
    } else {
      clusters.push({ sig: { ...sig }, members: [e], memberSigs: [sig] });
    }
  }

  const unspecMembers: T[] = [];
  const unspecSigs: SpecSignature[] = [];
  for (const c of clusters) {
    const crit = CRITICAL.filter(k => c.sig[k]);
    if (!crit.length) continue;
    const keepM: T[] = [];
    const keepS: SpecSignature[] = [];
    const tempUnspecM: T[] = [];
    const tempUnspecS: SpecSignature[] = [];
    c.members.forEach((m, i) => {
      const s = c.memberSigs[i];
      if (crit.some(k => !s[k])) {
        tempUnspecM.push(m);
        tempUnspecS.push(s);
      } else {
        keepM.push(m);
        keepS.push(s);
      }
    });
    if (keepM.length === 0) continue; // tamamen belirsiz/karma küme ise dokunma ve unspecMembers'a kopya ekleme!
    unspecMembers.push(...tempUnspecM);
    unspecSigs.push(...tempUnspecS);
    c.members = keepM;
    c.memberSigs = keepS;
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
    // Kullanıcının elle birleştirdiği katalog kaydı (sunucuda kalıcı alias) tarayıcıda yeniden bölünmez
    if (history.length < 2 || (comp as any).catalogLocked) {
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
