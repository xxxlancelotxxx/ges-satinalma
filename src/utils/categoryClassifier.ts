/**
 * Akıllı Kategori Normalizasyon ve Sınıflandırma Motoru
 * (Smart Construction Material & Category Classifier)
 * 
 * Bu modül:
 * 1. Tekrar eden veya farklı yazılmış kategorileri (örn. "Ofis & Kırtasiye", "Ofis Malzemeleri & Sarf", "Ofis Malzemeleri ve Kırtasiye")
 *    tek bir standart (kanonik) çatı altında birleştirir.
 * 2. Yeni bir fatura veya malzeme kaydedilirken, malzeme adı / açıklamasını analiz ederek
 *    en doğru ana kategoriyi otomatik belirler.
 * 3. Şantiye tedarik önceliklerine göre akıllı ve mantıklı sıralama sunar.
 */

export interface CanonicalCategoryDef {
  id: string;
  nameTr: string;
  nameRu: string;
  aliases: string[];
  keywords: string[];
  color: string;
  iconName: string;
}

export const CANONICAL_CATEGORIES: CanonicalCategoryDef[] = [
  {
    id: 'INSAAT_DEMIRI',
    nameTr: 'İnşaat Demiri',
    nameRu: 'Арматура',
    aliases: [
      'İnşaat Demiri',
      'Nervürlü Demir',
      'Арматура',
      'Donatı Çeliği',
      'A500C',
      'А500С',
      'İnşaat Demiri & Donatı'
    ],
    keywords: [
      'арматур', 'а500с', 'а240', 'а400', 'inşaat demir', 'insaat demir', 'nervür', 'rebar', 'пруток'
    ],
    color: 'amber',
    iconName: 'Layers'
  },
  {
    id: 'CELIK_BORULAR',
    nameTr: 'Çelik Borular',
    nameRu: 'Стальные и Профильные Трубы',
    aliases: [
      'Çelik Borular',
      'Profil Boru',
      'Kutu Profil',
      'Трубы стальные',
      'Профильная труба',
      'Çelik Boru'
    ],
    keywords: [
      'труба профильн', 'труба кругл', 'профильная труба', 'kutu profil', 'profil boru', 'çelik boru', 'dikişli boru'
    ],
    color: 'cyan',
    iconName: 'SlidersHorizontal'
  },
  {
    id: 'CELIK_MALZEMELER',
    nameTr: 'Çelik Malzemeler',
    nameRu: 'Металлопрокат и Сталь',
    aliases: [
      'Çelik Malzemeler',
      'Profil',
      'Hadde Profil',
      'Köşebent',
      'Металлопрокат',
      'Сталь',
      'İnşaat Demiri & Çelik',
      'İnşaat Demiri & Metal',
      'Demir & Çelik'
    ],
    keywords: [
      'уголок', 'швеллер', 'балк', 'лист г/к', 'лист х/к', 'профнастил', 'köşebent', 'kosebent',
      'hasır çelik', 'kaynaklı çelik hasır', 'kiriş', 'ipe', 'heb', 'hea', 'upn', 'sac', 'lama',
      'çelik profil', 'сталь', 'filmaşin', 'kangal demir', 'çelik şerit', 'u profil'
    ],
    color: 'slate',
    iconName: 'Building2'
  },
  {
    id: 'DONATI_MALZEMELERI',
    nameTr: 'Donatı Malzemeleri',
    nameRu: 'Арматурные элементы и Фиксаторы',
    aliases: [
      'Donatı Malzemeleri',
      'Donatı Aksesuarları',
      'Paspayı',
      'Manşon',
      'Фиксаторы'
    ],
    keywords: [
      'муфта', 'manşon', 'manson', 'каркас', 'karkas', 'paspay', 'паспой', 'фиксатор арматур',
      'фиксатор защитн', 'çiroz', 'ciroz', 'donatı sehp', 'лягушк', 'bağ teli', 'tavlı tel',
      'donatı iskelet', 'donatı kafes'
    ],
    color: 'orange',
    iconName: 'Package'
  },
  {
    id: 'ANKRAJ_SISTEMLERI',
    nameTr: 'Ankraj Sistemleri',
    nameRu: 'Анкерные системы',
    aliases: [
      'Ankraj Sistemleri',
      'Kimyasal Ankraj',
      'Mekanik Ankraj',
      'Анкеры'
    ],
    keywords: [
      'ankraj', 'анкер', 'химанкер', 'hilti hit', 'fischer faz', 'kimyasal ankraj', 'ankraj saplama', 'saplama m16', 'saplama m20', 'saplama m24'
    ],
    color: 'rose',
    iconName: 'Zap'
  },
  {
    id: 'BETON_AGREGA',
    nameTr: 'Hazır Beton, Çimento & Agrega',
    nameRu: 'Бетон, Цемент и Нерудные',
    aliases: [
      'Hazır Beton & Çimento',
      'Hazır Beton, Çimento & Agrega',
      'Beton',
      'Çimento',
      'Бетон',
      'Цемент',
      'Kum & Çakıl',
      'Agrega',
      'Harç & Şap',
      'Сухие смеси',
      'Kuru Harç',
      'Şap'
    ],
    keywords: [
      'бетон в', 'в25', 'в30', 'в20', 'в15', 'в35', 'в40', 'п4', 'w6', 'w8', 'f150', 'f200',
      'раствор', 'песок', 'щебень', 'гравий', 'керамзит', 'keramzit', 'beton', 'çimento', 'cimento',
      'c25', 'c30', 'c35', 'c20', 'portland', 'kum', 'mıcır', 'agrega', 'kalker', 'dolgu malzemesi', 'kumlu toprak',
      'сухая смесь', 'сухие смеси', 'м150', 'м200', 'м300', 'пескобетон', 'стяжк', 'штукатурк',
      'ротбанд', 'наливной пол', 'harç', 'harc', 'şap', 'sap', 'sıva', 'kuru karışım', 'kalekim',
      'yapıştırıcı harç', 'цпс'
    ],
    color: 'blue',
    iconName: 'Layers'
  },
  {
    id: 'DUVAR_GAZBETON',
    nameTr: 'Tuğla, Gazbeton & Duvar Blokları',
    nameRu: 'Газобетон, Кирпич и Блоки',
    aliases: [
      'Duvar Elemanları & Gazbeton',
      'Tuğla, Gazbeton & Duvar Blokları',
      'Gazbeton',
      'Tuğla',
      'Газобетон',
      'Газоблок'
    ],
    keywords: [
      'газобетон', 'газоблок', 'gazbeton', 'ytong', 'poritep', 'bonolit', 'bims', 'tuğla', 'tugla',
      'кирпич', 'стеновой блок', 'перемычка', 'кбб', 'керамзитобетон', 'duvar örgü filesi', 'сетка базальтовая'
    ],
    color: 'amber',
    iconName: 'Building2'
  },
  {
    id: 'KALIP_ISKELE',
    nameTr: 'Kalıp & İskele Sistemleri',
    nameRu: 'Опалубка и Леса',
    aliases: [
      'Kalıp & İskele Sistemleri',
      'İskele & Kalıp',
      'Kalıp & İskele Aksesuarları',
      'Betonarme & Kalıp',
      'Опалубка',
      'Леса'
    ],
    keywords: [
      'опалубк', 'фанер', 'ламинированн', 'балка бдк', 'стойк', 'унивилк',
      'треног', 'замок клинов', 'стяжн', 'щит', 'леса рамн', 'леса клинов',
      'хомут', 'kalıp', 'kalip', 'iskele', 'plywood', 'kontrplak', 'doka', 'peri',
      'h20', 'teleskopik direk', 'payanda', 'tie-rod', 'tayrot', 'iskele kelepçesi',
      'baumak', 'горизонтальный элемент', 'вставка соединительная'
    ],
    color: 'amber',
    iconName: 'Grid'
  },
  {
    id: 'AHSAP_KERESTE',
    nameTr: 'Ahşap & Kereste',
    nameRu: 'Пиломатериалы и Лес',
    aliases: [
      'Ahşap & Kereste',
      'Kereste & Ahşap Malzemeler',
      'Kereste',
      'Ahşap',
      'Пиломатериалы'
    ],
    keywords: [
      'доска обрезная', 'kereste', 'kalas', 'tahta', 'lata', 'брус', 'брусок', 'ahşap kiriş'
    ],
    color: 'amber',
    iconName: 'Trees'
  },
  {
    id: 'YALITIM_ALCIPAN',
    nameTr: 'Yalıtım & Alçıpan',
    nameRu: 'Изоляция и Гипсокартон',
    aliases: [
      'Yalıtım & Alçıpan',
      'Yalıtım ve Koruma Malzemeleri',
      'Yalıtım',
      'Alçıpan',
      'İzolasyon'
    ],
    keywords: [
      'минват', 'базальт', 'утеплител', 'техноникол', 'пеноплэкс', 'пенопласт',
      'гипсокартон', 'гкл', 'гклв', 'гвл', 'мембран', 'пароизоляци', 'гидроизоляци',
      'битум', 'рубероид', 'taşyünü', 'cam yünü', 'alçıpan', 'alcipan', 'eps', 'xps',
      'strafor', 'su yalıtım', 'ısı yalıtım', 'membran', 'şilteli', 'dpc', 'naylon örtü'
    ],
    color: 'purple',
    iconName: 'Layers'
  },
  {
    id: 'KIMYA_BOYA',
    nameTr: 'Kimyasallar & Boya',
    nameRu: 'Химия, Краски и Герметики',
    aliases: [
      'Kimyasallar & Boya',
      'Boya & Dış Cephe',
      'Boya & Kimyasallar',
      'Yapı Kimyasalları',
      'Boya',
      'Kimyasallar'
    ],
    keywords: [
      'краск', 'грунтовк', 'эмаль', 'лак', 'герметик', 'пена монтажн', 'клей',
      'пластификатор', 'добавк', 'противоморозн', 'растворител', 'шпатлевк',
      'boya', 'astar', 'epoksi', 'tiner', 'mastik', 'silikon', 'poliüretan köpük',
      'donatıcı', 'harç katkısı', 'antifriz', 'kür malzemesi'
    ],
    color: 'rose',
    iconName: 'Sparkles'
  },
  {
    id: 'MEKANIK_TESISAT',
    nameTr: 'Mekanik & Tesisat',
    nameRu: 'Сантехника, Отопление и Вентиляция',
    aliases: [
      'Mekanik & Tesisat',
      'Mekanik',
      'Tesisat',
      'Сантехника'
    ],
    keywords: [
      'труба полипропилен', 'ппр', 'пнд', 'сшитый полиэтилен', 'радиатор',
      'котел', 'вентиляци', 'воздуховод', 'кран шаров', 'задвижк', 'фитинг',
      'насос', 'канализаци', 'отоплени', 'boru', 'ppr', 'vana', 'radyatör',
      'fittings', 'pompa', 'havalandırma', 'klima', 'pis su', 'temiz su'
    ],
    color: 'cyan',
    iconName: 'SlidersHorizontal'
  },
  {
    id: 'ELEKTRIK_OTOMASYON',
    nameTr: 'Elektrik & Otomasyon',
    nameRu: 'Электрика и Автоматика',
    aliases: [
      'Elektrik & Otomasyon',
      'Elektrik',
      'Электрика'
    ],
    keywords: [
      'кабель', 'провод', 'ввг', 'ввгнг', 'пугв', 'автомат', 'выключател',
      'розетк', 'щит электрическ', 'счетчик', 'светильник', 'диод', 'гофр',
      'лоток кабельный', 'трансформатор', 'kablo', 'sigorta', 'şalter',
      'priz', 'anahtar', 'pano', 'aydınlatma', 'led', 'kontaktör', 'buat',
      'tava', 'kablo kanalı'
    ],
    color: 'yellow',
    iconName: 'Zap'
  },
  {
    id: 'IS_GUVENLIGI_KKD',
    nameTr: 'İş Güvenliği & KKD',
    nameRu: 'Охрана труда и СИЗ',
    aliases: [
      'İş Güvenliği & KKD',
      'İş Güvenliği ve KKD',
      'İş Güvenliği & Kişisel Koruyucu Donanım',
      'İSG',
      'KKD',
      'СИЗ'
    ],
    keywords: [
      'каск', 'жилет светоотражающ', 'ботинк', 'спецодежд', 'перчатки защитн',
      'перчатки с', 'очки защитн', 'респиратор', 'страховочн', 'пояс', 'привязь', 'ограждени',
      'baret', 'yelek', 'iş ayakkabısı', 'iş elbisesi', 'koruyucu gözlük',
      'iş eldiveni', 'maske', 'emniyet kemeri', 'yaşam hattı', 'güvenlik ağı', 'манекен'
    ],
    color: 'red',
    iconName: 'ShieldAlert'
  },
  {
    id: 'EL_ALETLERI',
    nameTr: 'El Aletleri & Hırdavat',
    nameRu: 'Ручной и Электроинструмент, Оснастка',
    aliases: [
      'El Aletleri & Hırdavat',
      'El Aletleri ve Aksesuarlar',
      'El Aletleri ve Hırdavat',
      'Инструмент'
    ],
    keywords: [
      'сверло', 'бур ', 'бур по', 'бур sds', 'бита', 'франкфурт', 'молоток', 'черенок для молотка',
      'диск шлифовальный', 'диск пильный', 'matkap ucu', 'çekiç', 'tester', 'kesici taş', 'pense',
      'tornavida', 'şerit metre', 'рулетка', 'уровень'
    ],
    color: 'orange',
    iconName: 'Wrench'
  },
  {
    id: 'SARF_HIRDAVAT',
    nameTr: 'Sarf Malzeme & Hırdavat',
    nameRu: 'Расходные материалы и Крепеж',
    aliases: [
      'Sarf Malzeme & Hırdavat',
      'Bağlantı Elemanları',
      'Hırdavat',
      'Sarf Malzeme',
      'Крепеж'
    ],
    keywords: [
      'саморез', 'дюбель', 'болт', 'гайк', 'шайб', 'шпильк', 'диск отрезной', 'круг зачистн',
      'vida', 'cıvata', 'somun', 'pul', 'dübel', 'asma kilit', 'замок навесной', 'koli bandı',
      'ведро', 'колесо', 'тара металлическая'
    ],
    color: 'slate',
    iconName: 'Boxes'
  },
  {
    id: 'KAYNAK_MALZEMELERI',
    nameTr: 'Kaynak Malzemeleri',
    nameRu: 'Сварочные материалы и Оборудование',
    aliases: [
      'Kaynak Malzemeleri',
      'Kaynak Malzemeleri & Sarf',
      'Сварочные материалы'
    ],
    keywords: [
      'электрод', 'электроды', 'askaynak', 'kaynak', 'kaynak makinesi', 'сварочный', 'сварка'
    ],
    color: 'rose',
    iconName: 'Hammer'
  },
  {
    id: 'SERAMIK_VITRIFIYE',
    nameTr: 'Seramik & Vitrifiye',
    nameRu: 'Керамика, Плитка и Санфаянс',
    aliases: [
      'Seramik & Vitrifiye',
      'Seramik',
      'Vitrifiye',
      'Керамогранит',
      'Плитка'
    ],
    keywords: [
      'керамогранит', 'плитк', 'унитаз', 'раковин', 'смесител', 'ванн',
      'душев', 'затирк', 'seramik', 'fayans', 'vitrifiye', 'lavabo',
      'klozet', 'batarya', 'derz dolgu'
    ],
    color: 'emerald',
    iconName: 'Package'
  },
  {
    id: 'IC_MEKAN_KAPI',
    nameTr: 'İç Mekan, Zemin & Kapı / Doğrama',
    nameRu: 'Двери, Напольные покрытия и Отделка',
    aliases: [
      'İç Mekan, Zemin & Kapı / Doğrama',
      'Kapı, Pencere & Doğrama',
      'İnce Yapı & Kapı'
    ],
    keywords: [
      'межкомнатная', 'дверь', 'дверная', 'наличник', 'jaluzi', 'жалюзи', 'oda kapısı',
      'pervaz', 'paspas ızgarası', 'parke taşı', 'granit parke'
    ],
    color: 'teal',
    iconName: 'Building2'
  },
  {
    id: 'TABELA_YONLENDIRME',
    nameTr: 'Tabela, Yönlendirme & Reklam',
    nameRu: 'Навигация, Таблички и Указатели',
    aliases: [
      'Tabela, Yönlendirme & Reklam',
      'Tabela & Yönlendirme',
      'Yönlendirme Sistemleri'
    ],
    keywords: [
      'yönlendirme', 'yonlendirme', 'daire no', 'daire numara', 'kat numara', 'nest-',
      'dream riva', 'asansör üzeri', 'merdiven levha', 'posta kutu', 'tabela', 'levha',
      'piktogram', 'ikonu', 'harfleri seti', 'yön okları', 'otopark yönlendirme',
      'blok/bina ismi', 'sadece personel', 'stuff only', 'bina isimli', 'kat panelinde'
    ],
    color: 'sky',
    iconName: 'Compass'
  },
  {
    id: 'OLCUM_HARITA',
    nameTr: 'Ölçüm, Harita & Saha Ekipmanları',
    nameRu: 'Геодезия, Измерительные приборы',
    aliases: [
      'Ölçüm, Harita & Saha Ekipmanları',
      'Ölçüm & Harita Ekipmanları',
      'Harita ve Ölçüm'
    ],
    keywords: [
      'taheometre', 'tacheometer', 'total station', 'leica', 'nivo', 'teodolit',
      'statif', 'sehpa / statif', 'jalon', 'reflektör', 'reflektor', 'yansıtıcı marka',
      'terazi', 'весы', 'lazer metre', 'geb364', 'gmp111', 'nedo'
    ],
    color: 'emerald',
    iconName: 'Crosshair'
  },
  {
    id: 'SANTIYE_MOBILYA',
    nameTr: 'Şantiye Mobilya & Yaşam Donanımı',
    nameRu: 'Мебель для городка, Кровати, Текстиль',
    aliases: [
      'Şantiye Mobilya & Yaşam Donanımı',
      'Şantiye Mobilya & Yaşam Donanımları',
      'Şantiye Mobilya & Yaşam',
      'Saha Yaşam & Donanım'
    ],
    keywords: [
      'ranza', 'yatak', 'yastık', 'yorgan', 'nevresim', 'soyunma dolabı', 'elbise dolabı',
      'ayakkabılık', 'askılık', 'raf ünitesi', 'raf çerçevesi', 'raf kirişi', 'raf tablası', 'erzak dolabı'
    ],
    color: 'purple',
    iconName: 'Home'
  },
  {
    id: 'SANTIYE_TESIS',
    nameTr: 'Şantiye Tesis & Konteyner',
    nameRu: 'Бытовки, Модульные контейнеры',
    aliases: [
      'Şantiye Tesis & Konteyner',
      'Konteyner & Mobilizasyon',
      'Şantiye Konteyneri'
    ],
    keywords: [
      'konteyner', 'контейнер', 'tuvalet kabini', 'blok konteyner', 'yaşam konteyneri',
      'şantiye konteyneri', 'mobil akaryakıt'
    ],
    color: 'amber',
    iconName: 'Building2'
  },
  {
    id: 'TEMIZLIK_HIJYEN',
    nameTr: 'Temizlik & Hijyen Malzemeleri',
    nameRu: 'Клининг, Бытовая химия, Гигиена',
    aliases: [
      'Temizlik & Hijyen Malzemeleri',
      'Temizlik Malzemeleri',
      'Temizlik & Hijyen'
    ],
    keywords: [
      'deterjan', 'fairy', 'bulaşık', 'oda kokusu', 'air wick', 'first fresh',
      'cam ve ayna', 'help sprey', 'havlu', 'kağıt havlu', 'полотенц', 'veiro',
      'ıslak mendil', 'ıslak havlu', 'салфетк', 'pisuvar', 'klozet bloğu', 'klozet blogu',
      'bref', 'çamaşır suyu', 'klor', 'хлор', 'известь хлорная', 'paspas', 'коврик',
      'çamaşır kurutma', 'сушилка для белья', 'süpürge', 'щетка строительная', 'черенок для щетки',
      'sabun', 'мыло', 'çöp kovası', 'çöp poşeti', 'sünger', 'vileda'
    ],
    color: 'cyan',
    iconName: 'Sparkles'
  },
  {
    id: 'GIDA_MUTFAK',
    nameTr: 'Gıda & Mutfak Malzemeleri',
    nameRu: 'Продукты питания, Чай/Кофе, Посуда',
    aliases: [
      'Gıda & Mutfak Malzemeleri',
      'Mutfak & Gıda Malzemeleri',
      'Gıda, Mutfak & İkram'
    ],
    keywords: [
      'çay', 'cay', 'чай', 'kahve', 'кофе', 'nescafe', 'şeker', 'seker', 'сахар',
      'tuz', 'соль', 'bisküvi', 'biskuvi', 'печенье', 'pekarro', 'çikolata', 'cikolata',
      'шоколад', 'bounty', 'mars minis', 'su ısıtıcı', 'su isitici', 'kettle', 'чайник',
      'scarlett', 'bardak', 'стакан', 'кружк', 'fincan', 'tabak', 'тарелк',
      'çatal', 'bıçak', 'kaşık', 'вилка', 'нож', 'ложка', 'şekerlik', 'tepsi',
      'saklama kabı', 'органайзер для кухни'
    ],
    color: 'amber',
    iconName: 'Coffee'
  },
  {
    id: 'OFIS_KIRTASIYE',
    nameTr: 'Ofis & Kırtasiye',
    nameRu: 'Канцтовары и Офисные принадлежности',
    aliases: [
      'Ofis & Kırtasiye',
      'Ofis Malzemeleri',
      'Ofis Malzemesi',
      'Ofis Malzemeleri & Sarf',
      'Ofis Malzemeleri ve Kırtasiye',
      'Ofis ve Kırtasiye',
      'Ofis Kırtasiye',
      'Kırtasiye',
      'Канцтовары',
      'Канцелярия',
      'Офис'
    ],
    keywords: [
      'бумага', 'а4', 'а3', 'ручк', 'папк', 'степлер', 'скоб', 'файлы',
      'блокнот', 'маркер', 'комус', 'kağıt', 'dosya', 'klasör', 'kalem',
      'zımba', 'delgeç', 'kırtasiye', 'defter'
    ],
    color: 'indigo',
    iconName: 'FileText'
  },
  {
    id: 'BILGI_ISLEM_IT',
    nameTr: 'Bilgi İşlem & IT',
    nameRu: 'IT оборудование, Оргтехника, Сети',
    aliases: [
      'Bilgi İşlem & IT',
      'Bilgi İşlem',
      'IT & Bilişim',
      'Ofis Malzemeleri & Bilişim'
    ],
    keywords: [
      'картридж', 'тонер', 'принтер', 'мышь', 'клавиатур', 'монитор',
      'kartuş', 'toner', 'yazıcı', 'bilgisayar', 'fare', 'klavye', 'switch',
      'televizyon', 'ekran temizleme', 'digma', 'logitech', 'canon lbp', 'tp-link',
      'ram bellek', 'sistem blok', 'internet güçlendirme'
    ],
    color: 'blue',
    iconName: 'Monitor'
  },
  {
    id: 'ARAC_IS_MAKINESI',
    nameTr: 'Araç & İş Makinesi Ekipmanları',
    nameRu: 'Шины, Фильтры, Автотовары',
    aliases: [
      'Araç & İş Makinesi Ekipmanları',
      'Otomotiv & Makine Yedek Parça',
      'Araç Ekipmanları',
      'İş Makinesi & Kiralama',
      'Hizmet & Lojistik',
      'Lojistik ve Hizmetler',
      'Lojistik & Nakliye',
      'Nakliye',
      'Lojistik',
      'Hizmet'
    ],
    keywords: [
      'oto lastik', 'oto lastiği', 'lastik', 'continental', 'yokohama',
      'фильтр топливный', 'hengst', 'filtre', 'iş makinesi',
      'доставк', 'перевозк', 'транспорт', 'услуг', 'аренда техник', 'кран',
      'манипулятор', 'экскаватор', 'погрузк', 'вывоз мусор', 'nakliye',
      'lojistik', 'taşıma', 'vinç', 'kiralama', 'hafriyat', 'moloz', 'hizmet',
      'montaj', 'teslimat', 'sevkiyat', 'kesim hizmeti'
    ],
    color: 'slate',
    iconName: 'Truck'
  }
];

export const CANONICAL_28_CATEGORIES = [
  'İnşaat Demiri',
  'Çelik Borular',
  'Çelik Malzemeler',
  'Donatı Malzemeleri',
  'Ankraj Sistemleri',
  'Hazır Beton, Çimento & Agrega',
  'Tuğla, Gazbeton & Duvar Blokları',
  'Kalıp & İskele Sistemleri',
  'Ahşap & Kereste',
  'Yalıtım & Alçıpan',
  'Kimyasallar & Boya',
  'Mekanik & Tesisat',
  'Elektrik & Otomasyon',
  'İş Güvenliği & KKD',
  'El Aletleri & Hırdavat',
  'Sarf Malzeme & Hırdavat',
  'Kaynak Malzemeleri',
  'Seramik & Vitrifiye',
  'İç Mekan, Zemin & Kapı / Doğrama',
  'Tabela, Yönlendirme & Reklam',
  'Ölçüm, Harita & Saha Ekipmanları',
  'Şantiye Mobilya & Yaşam Donanımı',
  'Şantiye Tesis & Konteyner',
  'Temizlik & Hijyen Malzemeleri',
  'Gıda & Mutfak Malzemeleri',
  'Ofis & Kırtasiye',
  'Bilgi İşlem & IT',
  'Araç & İş Makinesi Ekipmanları'
] as const;

export const CATEGORY_SORT_ORDER: string[] = [...CANONICAL_28_CATEGORIES];

export function sortCategoriesByPriority(categoryList: string[]): string[] {
  const orderMap = new Map<string, number>();
  CATEGORY_SORT_ORDER.forEach((cat, idx) => orderMap.set(cat.toLowerCase().trim(), idx));

  return [...categoryList].sort((a, b) => {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();

    const idxA = orderMap.has(aLower) ? orderMap.get(aLower)! : 900;
    const idxB = orderMap.has(bLower) ? orderMap.get(bLower)! : 900;

    if (idxA !== idxB) {
      return idxA - idxB;
    }
    return a.localeCompare(b, 'tr');
  });
}

// Helper: Normalize any raw category string into one canonical Turkish name
export function normalizeCategoryName(rawCategory?: string, materialName?: string): string {
  const safeLower = (s?: string) =>
    (s || '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const cleanRaw = (rawCategory || '').trim();
  const cleanMat = safeLower(materialName);
  const rawLower = safeLower(rawCategory);
  const isGenericCatchAll = !cleanRaw || rawLower === 'diğer' || rawLower === 'diger' || rawLower === 'diğer malzeme' || rawLower === 'diger malzeme' || rawLower === 'genel malzeme' || rawLower === 'прочие материалы' || rawLower === 'genel';

  // 1. Direct exact or alias match if NO material name is given
  if (!cleanMat && !isGenericCatchAll) {
    for (const cat of CANONICAL_CATEGORIES) {
      if (cat.id === 'DIGER_MALZEME') continue;
      if (safeLower(cat.nameTr) === rawLower || safeLower(cat.nameRu) === rawLower) {
        return cat.nameTr;
      }
      for (const alias of cat.aliases) {
        if (safeLower(alias) === rawLower) {
          return cat.nameTr;
        }
      }
    }
  }

  const combined = `${cleanMat} ${rawLower}`.trim();

  // 2. High-precision rule-based categorization
  // Gıda & Mutfak Malzemeleri
  if (
    combined.includes('çay') || combined.includes('cay') || combined.includes('чай') ||
    combined.includes('kahve') || combined.includes('кофе') || combined.includes('nescafe') ||
    combined.includes('şeker') || combined.includes('seker') || combined.includes('сахар') ||
    combined.includes('tuz') || combined.includes('соль') ||
    combined.includes('bisküvi') || combined.includes('biskuvi') || combined.includes('печенье') || combined.includes('pekarro') ||
    combined.includes('çikolata') || combined.includes('cikolata') || combined.includes('шоколад') || combined.includes('bounty') || combined.includes('mars minis') ||
    combined.includes('su ısıtıcı') || combined.includes('su isitici') || combined.includes('kettle') || combined.includes('чайник') ||
    combined.includes('scarlett') ||
    combined.includes('bardak') || combined.includes('стакан') || combined.includes('кружк') || combined.includes('fincan') ||
    combined.includes('tabak') || combined.includes('тарелк') ||
    combined.includes('çatal') || combined.includes('bıçak') || combined.includes('kaşık') || combined.includes('вилка') || combined.includes('нож') || combined.includes('ложка') ||
    combined.includes('şekerlik') || combined.includes('tepsi') || combined.includes('saklama kabı') || combined.includes('органайзер для кухни')
  ) {
    return 'Gıda & Mutfak Malzemeleri';
  }

  // Temizlik & Hijyen Malzemeleri
  if (
    combined.includes('deterjan') || combined.includes('fairy') || combined.includes('bulaşık') ||
    combined.includes('oda kokusu') || combined.includes('air wick') || combined.includes('first fresh') ||
    combined.includes('cam ve ayna') || combined.includes('help sprey') ||
    combined.includes('havlu') || combined.includes('kağıt havlu') || combined.includes('полотенц') || combined.includes('veiro') ||
    combined.includes('ıslak mendil') || combined.includes('ıslak havlu') || combined.includes('салфетк') ||
    combined.includes('pisuvar') || combined.includes('klozet bloğu') || combined.includes('klozet blogu') || combined.includes('bref') ||
    combined.includes('çamaşır suyu') || combined.includes('klor') || combined.includes('хлор') || combined.includes('известь хлорная') ||
    combined.includes('paspas') || combined.includes('коврик') || combined.includes('çamaşır kurutma') || combined.includes('сушилка для белья') ||
    combined.includes('süpürge') || combined.includes('щетка строительная') || combined.includes('черенок для щетки') ||
    combined.includes('sabun') || combined.includes('мыло') || combined.includes('çöp kovası') || combined.includes('çöp poşeti') ||
    combined.includes('sünger') || combined.includes('vileda')
  ) {
    return 'Temizlik & Hijyen Malzemeleri';
  }

  // Tabela, Yönlendirme & Reklam
  if (
    combined.includes('yönlendirme') || combined.includes('yonlendirme') ||
    combined.includes('daire no') || combined.includes('daire numara') || combined.includes('kat numara') ||
    combined.includes('nest-') || combined.includes('dream riva') || combined.includes('asansör üzeri') ||
    combined.includes('merdiven levha') || combined.includes('posta kutu') || combined.includes('tabela') ||
    combined.includes('levha') || combined.includes('piktogram') || combined.includes('ikonu') ||
    combined.includes('harfleri seti') || combined.includes('yön okları') || combined.includes('otopark yönlendirme') ||
    combined.includes('blok/bina ismi') || combined.includes('sadece personel') || combined.includes('stuff only') ||
    combined.includes('bina isimli') || combined.includes('kat panelinde') || combined.includes('bina ismi')
  ) {
    return 'Tabela, Yönlendirme & Reklam';
  }

  // Ölçüm, Harita & Saha Ekipmanları
  if (
    combined.includes('taheometre') || combined.includes('tacheometer') || combined.includes('total station') ||
    combined.includes('leica') || combined.includes('nivo') || combined.includes('teodolit') ||
    combined.includes('statif') || combined.includes('sehpa / statif') || combined.includes('jalon') ||
    combined.includes('reflektör') || combined.includes('reflektor') || combined.includes('yansıtıcı marka') ||
    combined.includes('terazi') || combined.includes('весы') || combined.includes('lazer metre') ||
    combined.includes('geb364') || combined.includes('gmp111') || combined.includes('nedo')
  ) {
    return 'Ölçüm, Harita & Saha Ekipmanları';
  }

  // Şantiye Mobilya & Yaşam Donanımı
  if (
    combined.includes('ranza') || combined.includes('yatak') || combined.includes('yastık') || combined.includes('yorgan') || combined.includes('nevresim') ||
    combined.includes('soyunma dolabı') || combined.includes('elbise dolabı') || combined.includes('ayakkabılık') || combined.includes('askılık') ||
    combined.includes('raf ünitesi') || combined.includes('raf çerçevesi') || combined.includes('raf kirişi') || combined.includes('raf tablası') ||
    combined.includes('erzak dolabı')
  ) {
    return 'Şantiye Mobilya & Yaşam Donanımı';
  }

  // Şantiye Tesis & Konteyner
  if (
    combined.includes('konteyner') || combined.includes('контейнер') ||
    combined.includes('tuvalet kabini') || combined.includes('yaşam konteyneri') || combined.includes('blok konteyner') ||
    combined.includes('şantiye konteyneri') || combined.includes('mobil akaryakıt')
  ) {
    return 'Şantiye Tesis & Konteyner';
  }

  // Araç & İş Makinesi Ekipmanları
  if (
    combined.includes('oto lastik') || combined.includes('oto lastiği') || (combined.includes('lastik') && (combined.includes('r17') || combined.includes('r22') || combined.includes('continental') || combined.includes('yokohama'))) ||
    combined.includes('filtre') && combined.includes('hengst') || combined.includes('фильтр топливный')
  ) {
    return 'Araç & İş Makinesi Ekipmanları';
  }

  // İç Mekan, Zemin & Kapı / Doğrama
  if (
    combined.includes('межкомнатная') || combined.includes('дверь') || combined.includes('дверная') || combined.includes('наличник') ||
    combined.includes('jaluzi') || combined.includes('жалюзи') || combined.includes('oda kapısı') || combined.includes('pervaz') ||
    combined.includes('paspas ızgarası') || combined.includes('parke taşı')
  ) {
    return 'İç Mekan, Zemin & Kapı / Doğrama';
  }

  // Ankraj Sistemleri
  if (
    combined.includes('ankraj') || combined.includes('анкер') || combined.includes('химанкер') ||
    combined.includes('fischer faz') || combined.includes('hilti hit') || combined.includes('kimyasal ankraj')
  ) {
    return 'Ankraj Sistemleri';
  }

  // Donatı Malzemeleri (Paspayı, Manşon, Çiroz, Bağ Teli)
  if (
    (combined.includes('муфта') || combined.includes('manşon') || combined.includes('manson') ||
     combined.includes('каркас') || combined.includes('karkas') || combined.includes('donatı kafes') ||
     combined.includes('donatı iskelet') || combined.includes('paspay') || combined.includes('паспой') ||
     combined.includes('фиксатор арматур') || combined.includes('фиксатор защитн') ||
     combined.includes('çiroz') || combined.includes('ciroz') ||
     combined.includes('bağ teli') || combined.includes('tavlı tel') ||
     combined.includes('donatı sehp') || combined.includes('лягушк')) &&
    !combined.includes('dn32') && !combined.includes('dişli manşon') &&
    !combined.includes('замок') && !combined.includes('kilit') &&
    !combined.includes('двер') && !combined.includes('kapı')
  ) {
    return 'Donatı Malzemeleri';
  }

  // İnşaat Demiri
  if (
    (combined.includes('арматур') || combined.includes('inşaat demir') || combined.includes('insaat demir') ||
     combined.includes('nervür') || combined.includes('a500') || combined.includes('а500') || combined.includes('пруток')) &&
    !combined.includes('фиксатор') && !combined.includes('сетка') && !combined.includes('file')
  ) {
    return 'İnşaat Demiri';
  }

  // Çelik Borular
  if (
    (combined.includes('труб') || combined.includes('boru')) &&
    (combined.includes('сталь') || combined.includes('профильн') || combined.includes('çelik') || combined.includes('kutu profil') || combined.includes('dikişli')) &&
    !combined.includes('ппр') && !combined.includes('ppr') && !combined.includes('пнд') && !combined.includes('канализаци')
  ) {
    return 'Çelik Borular';
  }

  // Tuğla, Gazbeton & Duvar Blokları
  if (
    combined.includes('газобетон') || combined.includes('газоблок') || combined.includes('poritep') ||
    combined.includes('bonolit') || combined.includes('ytong') || combined.includes('gazbeton') ||
    combined.includes('tuğla') || combined.includes('tugla') || combined.includes('кирпич') ||
    combined.includes('керамзитобетон') || combined.includes('кбб') || combined.includes('перемычка') ||
    combined.includes('keramzit beton') || combined.includes('bims') || combined.includes('duvar örgü filesi') ||
    (combined.includes('базальтовая') && combined.includes('сетка'))
  ) {
    return 'Tuğla, Gazbeton & Duvar Blokları';
  }

  // Sarf Malzeme & Hırdavat (Bağlantı Elemanları, Vida, Cıvata, Somun, Kesici Taş vs)
  if (
    combined.includes('hırdavat') || combined.includes('hirdavat') || combined.includes('sarf') ||
    combined.includes('bağlantı') || combined.includes('baglanti') || combined.includes('крепеж') ||
    combined.includes('саморез') || combined.includes('дюбель') || combined.includes('болт') ||
    combined.includes('шайб') || combined.includes('диск отрезной') || combined.includes('диск зачистной') ||
    combined.includes('kesici taş') || combined.includes('kesici tas') || combined.includes('taşlama diski') ||
    combined.includes('vida') || combined.includes('cıvata') || combined.includes('civata') ||
    combined.includes('somun') || combined.includes('dübel') || combined.includes('dubel') ||
    combined.includes('замок') || combined.includes('ведро') || combined.includes('колесо') ||
    combined.includes('тара металлическая')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // Çelik Malzemeler
  if (
    combined.includes('уголок') || combined.includes('швеллер') || combined.includes('балк') ||
    combined.includes('köşebent') || combined.includes('kosebent') || combined.includes('lama') ||
    combined.includes('hadde profil') || combined.includes('çelik profil') || combined.includes('çelik sac') ||
    combined.includes('sac levha') || combined.includes('лист сталь') || combined.includes('лист г/к') ||
    combined.includes('металлопрокат') || combined.includes('профнастил') || combined.includes('kiriş') ||
    combined.includes('ipe') || combined.includes('hea') || combined.includes('heb') || combined.includes('upn') ||
    combined.includes('filmaşin') || combined.includes('kangal demir') || combined.includes('çelik şerit') ||
    combined.includes('hasır çelik') || combined.includes('kaynaklı çelik hasır') || combined.includes('u profil') ||
    (combined.includes('duvar paneli') && combined.includes('çelik')) || (combined.includes('панель') && combined.includes('сталь')) ||
    combined.includes('inşaat demiri & çelik')
  ) {
    return 'Çelik Malzemeler';
  }

  // Kalıp & İskele Sistemleri
  if (
    combined.includes('опалубк') || combined.includes('леса') || combined.includes('фанер') ||
    combined.includes('балка бдк') || combined.includes('унивилк') || combined.includes('треног') ||
    combined.includes('стойк') || combined.includes('щит') || combined.includes('kalıp') ||
    combined.includes('kalip') || combined.includes('iskele') || combined.includes('plywood') ||
    combined.includes('kontrplak') || combined.includes('doka') || combined.includes('peri') ||
    combined.includes('h20') || combined.includes('tayrot') || combined.includes('tie-rod') ||
    combined.includes('baumak') || combined.includes('горизонтальный элемент') || combined.includes('вставка соединительная')
  ) {
    return 'Kalıp & İskele Sistemleri';
  }

  // Ahşap & Kereste
  if (
    combined.includes('доска обрезная') || combined.includes('kereste') || combined.includes('kalas') ||
    combined.includes('tahta') || combined.includes('lata') || combined.includes('брус')
  ) {
    return 'Ahşap & Kereste';
  }

  // Hazır Beton, Çimento & Agrega
  if (
    combined.includes('бетон в') || combined.includes('beton') || combined.includes('çimento') ||
    combined.includes('cimento') || combined.includes('цемент') || combined.includes('portland') ||
    combined.includes('agrega') || combined.includes('щебень') || combined.includes('гравий') ||
    combined.includes('mıcır') || combined.includes('керамзит') || combined.includes('keramzit') ||
    combined.includes('kumlu toprak') || combined.includes('dolgu malzemesi') ||
    ((combined.includes('kum') || combined.includes('песок')) && !combined.includes('kumaş'))
  ) {
    return 'Hazır Beton, Çimento & Agrega';
  }

  // Harç & Şap (Kuru harçlar ve şaplar Hazır Beton, Çimento & Agrega çatısı altındadır)
  if (
    combined.includes('сухая смесь') || combined.includes('сухие смеси') || combined.includes('пескобетон') ||
    combined.includes('стяжк') || combined.includes('ротбанд') || combined.includes('штукатурк') ||
    combined.includes('harç') || combined.includes('harc') || combined.includes('şap') ||
    combined.includes('sap') || combined.includes('kalekim') || combined.includes('наливной пол') ||
    combined.includes('цпс')
  ) {
    return 'Hazır Beton, Çimento & Agrega';
  }

  // Yalıtım & Alçıpan
  if (
    combined.includes('минват') || combined.includes('базальт') || combined.includes('утеплител') ||
    combined.includes('техноникол') || combined.includes('пеноплэкс') || combined.includes('пенопласт') ||
    combined.includes('гипсокартон') || combined.includes('гкл') || combined.includes('гклв') ||
    combined.includes('мембран') || combined.includes('пароизоляци') || combined.includes('гидроизоляци') ||
    combined.includes('битум') || combined.includes('рубероид') || combined.includes('taşyünü') ||
    combined.includes('cam yünü') || combined.includes('alçıpan') || combined.includes('alcipan') ||
    combined.includes('eps') || combined.includes('xps') || combined.includes('strafor') ||
    combined.includes('yalıtım') || combined.includes('yalitim') || combined.includes('izolasyon') ||
    combined.includes('naylon') || combined.includes('koruma ortu') || combined.includes('koruma örtü')
  ) {
    return 'Yalıtım & Alçıpan';
  }

  // İş Güvenliği & KKD
  if (
    combined.includes('iş elbisesi') || combined.includes('iş elbise') || combined.includes('спецодежд') ||
    combined.includes('reflektörlü') || combined.includes('светоотражающ') ||
    combined.includes('перчатки с') || combined.includes('iş eldiveni') || combined.includes('koruyucu eldiven') ||
    combined.includes('baret') || combined.includes('каск') || combined.includes('жилет') ||
    combined.includes('iş ayakkabısı') || combined.includes('ботинк') || combined.includes('güvenli') ||
    combined.includes('kkd') || combined.includes('isg') || combined.includes('сиз') ||
    combined.includes('манекен') || combined.includes('emniyet kemeri') || combined.includes('привязь')
  ) {
    return 'İş Güvenliği & KKD';
  }

  // El Aletleri & Hırdavat
  if (
    combined.includes('сверло') || combined.includes('бур ') || combined.includes('бур по') || combined.includes('бур sds') ||
    combined.includes('бита') || combined.includes('франкфурт') || combined.includes('молоток') || combined.includes('черенок для') ||
    combined.includes('диск шлифовальный') || combined.includes('диск пильный') || combined.includes('matkap ucu') ||
    combined.includes('çekiç') || combined.includes('tester') || combined.includes('kesici taş') || combined.includes('el aleti')
  ) {
    return 'El Aletleri & Hırdavat';
  }

  // Kaynak Malzemeleri
  if (
    combined.includes('электрод') || combined.includes('askaynak') || combined.includes('kaynak') ||
    combined.includes('сварочный') || combined.includes('сварка')
  ) {
    return 'Kaynak Malzemeleri';
  }

  // Elektrik & Otomasyon
  if (
    combined.includes('elektrik') || combined.includes('otomasyon') || combined.includes('kablo') ||
    combined.includes('электрик') || combined.includes('кабель') || combined.includes('провод') ||
    combined.includes('автомат') || combined.includes('светильник') || combined.includes('sigorta') ||
    combined.includes('şalter') || combined.includes('priz') || combined.includes('aydınlatmalı') || combined.includes('освещени')
  ) {
    return 'Elektrik & Otomasyon';
  }

  // Kimyasallar & Boya
  if (
    combined.includes('boya') || combined.includes('kimya') || combined.includes('краск') ||
    combined.includes('эмаль') || combined.includes('грунтовк') || combined.includes('герметик') ||
    combined.includes('пена монтажн') || combined.includes('astar') || combined.includes('epoksi') ||
    combined.includes('tiner') || combined.includes('silikon') || combined.includes('mastik')
  ) {
    return 'Kimyasallar & Boya';
  }

  // Mekanik & Tesisat
  if (
    combined.includes('mekanik') || combined.includes('tesisat') || combined.includes('сантехник') ||
    combined.includes('отоплени') || combined.includes('труba ппр') || combined.includes('труба ппр') || combined.includes('радиатор') ||
    combined.includes('кран шаров') || combined.includes('vana') || combined.includes('pompa') ||
    combined.includes('fittings') || combined.includes('havalandırma') || combined.includes('klima')
  ) {
    return 'Mekanik & Tesisat';
  }

  // Seramik & Vitrifiye
  if (
    combined.includes('seramik') || combined.includes('vitrifiye') || combined.includes('fayans') ||
    combined.includes('плитк') || combined.includes('керамогранит') || combined.includes('lavabo') ||
    combined.includes('klozet') || combined.includes('batarya')
  ) {
    return 'Seramik & Vitrifiye';
  }

  // Bilgi İşlem & IT
  if (
    combined.includes('bilgi işlem') || combined.includes('switch') || combined.includes('klavye') ||
    combined.includes('yazıcı') || combined.includes('televizyon') || combined.includes('monitör') ||
    combined.includes('ekran temizleme') || combined.includes('digma') || combined.includes('logitech') ||
    combined.includes('canon lbp') || combined.includes('tp-link') || combined.includes('ram bellek') ||
    combined.includes('sistem blok') || combined.includes('kartuş') || combined.includes('toner')
  ) {
    return 'Bilgi İşlem & IT';
  }

  // Ofis & Kırtasiye
  if (
    combined.includes('ofis') || combined.includes('kırtasiye') || combined.includes('канцтовар') ||
    combined.includes('бумага') || combined.includes('папк') || combined.includes('ручк') ||
    combined.includes('dosya') || combined.includes('klasör') || combined.includes('a4') ||
    combined.includes('а4') || combined.includes('комус')
  ) {
    return 'Ofis & Kırtasiye';
  }

  // Hizmet & Lojistik (Nakliye, hafriyat, kiralama -> Araç & İş Makinesi Ekipmanları)
  if (
    combined.includes('lojistik') || combined.includes('nakliye') || combined.includes('hizmet') ||
    combined.includes('доставк') || combined.includes('перевозк') || combined.includes('услуг') ||
    combined.includes('sevkiyat') || combined.includes('taşıma') || combined.includes('tasima') ||
    combined.includes('montaj') || combined.includes('teslimat') || combined.includes('vinç kiralama')
  ) {
    return 'Araç & İş Makinesi Ekipmanları';
  }

  // Sarf Malzeme & Hırdavat (Bağlantı Elemanları, Vida, Cıvata, Somun vs)
  if (
    combined.includes('hırdavat') || combined.includes('hirdavat') || combined.includes('sarf') ||
    combined.includes('bağlantı') || combined.includes('baglanti') || combined.includes('крепеж') ||
    combined.includes('саморез') || combined.includes('дюбель') || combined.includes('болт') ||
    combined.includes('шайб') || combined.includes('диск отрезной') || combined.includes('vida') ||
    combined.includes('cıvata') || combined.includes('somun') || combined.includes('dübel') ||
    combined.includes('замок') || combined.includes('ведро') || combined.includes('колесо') ||
    combined.includes('тара металлическая')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // 3. Fallback alias match
  if (cleanRaw && !isGenericCatchAll) {
    for (const cat of CANONICAL_CATEGORIES) {
      if (cat.nameTr.toLowerCase() === rawLower || cat.nameRu.toLowerCase() === rawLower) {
        return cat.nameTr;
      }
      for (const alias of cat.aliases) {
        if (alias.toLowerCase() === rawLower) {
          return cat.nameTr;
        }
      }
    }
  }

  // 4. Keyword matching based on cleanMat if category is generic or empty
  if (cleanMat) {
    for (const cat of CANONICAL_CATEGORIES) {
      for (const kw of cat.keywords) {
        if (cleanMat.includes(kw)) {
          return cat.nameTr;
        }
      }
    }
  }

  // Fallback to closest canonical category if cleanRaw is already one of the 28
  if (cleanRaw && !isGenericCatchAll) {
    const matched = CANONICAL_CATEGORIES.find(c => c.nameTr.toLowerCase() === rawLower);
    if (matched) return matched.nameTr;
  }

  return 'Sarf Malzeme & Hırdavat';
}

// Get display name based on language
export function getCategoryDisplayName(canonicalName: string, language: 'TR' | 'RU' = 'TR'): string {
  const norm = normalizeCategoryName(canonicalName);
  const found = CANONICAL_CATEGORIES.find(c => c.nameTr.toLowerCase() === norm.toLowerCase());
  if (found) {
    return language === 'RU' ? found.nameRu : found.nameTr;
  }
  return norm;
}

// Get color badge class for category
export function getCategoryColor(canonicalName: string): string {
  const norm = normalizeCategoryName(canonicalName);
  const found = CANONICAL_CATEGORIES.find(c => c.nameTr.toLowerCase() === norm.toLowerCase());
  const color = found?.color || 'slate';
  switch (color) {
    case 'emerald': return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'blue': return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'amber': return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'purple': return 'bg-purple-50 text-purple-800 border-purple-200';
    case 'rose': return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'orange': return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'yellow': return 'bg-yellow-50 text-yellow-800 border-yellow-200';
    case 'cyan': return 'bg-cyan-50 text-cyan-800 border-cyan-200';
    case 'indigo': return 'bg-indigo-50 text-indigo-800 border-indigo-200';
    case 'red': return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'teal': return 'bg-teal-50 text-teal-800 border-teal-200';
    case 'sky': return 'bg-sky-50 text-sky-800 border-sky-200';
    default: return 'bg-slate-50 text-slate-800 border-slate-200';
  }
}
