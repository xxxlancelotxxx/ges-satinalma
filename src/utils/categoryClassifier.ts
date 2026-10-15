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
      'уголок', 'швеллер', 'балка двутавр', 'лист г/к', 'лист х/к', 'лист сталь', 'лист оцинк', 'лист рифлен',
      'профнастил', 'профлист', 'köşebent', 'kosebent', 'hasır çelik', 'çelik hasır', 'celik hasir',
      'kaynaklı çelik hasır', 'çelik kiriş', 'ipe ', 'heb ', 'hea ', 'upn ', 'sac levha', 'çelik sac', 'celik sac',
      'silmeli lama', 'çelik lama', 'demir lama', 'полоса сталь', 'çelik profil', 'filmaşin', 'kangal demir',
      'çelik şerit', 'металлопрокат', 'металлоконструкц'
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
      'муфта арматур', 'donatı manşon', 'donati manson', 'manşon a12', 'manson a12', 'mufta a12', 'mufta p13', 'mufta d14',
      'каркас арматур', 'donatı kafes', 'donati kafes', 'donatı karkas', 'karkas metal kp', 'paspay', 'паспой',
      'фиксатор арматур', 'фиксатор защитн', 'фиксатор звездочк', 'фиксатор стульчик', 'фиксатор стойк', 'фиксатор конус',
      'çiroz', 'ciroz', 'donatı sehp', 'лягушк', 'bağ teli', 'bag teli', 'tavlı tel', 'tavli tel', 'проволока вязальная',
      'donatı iskelet'
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
      'бетон в', 'бсг ', 'бст ', 'керамзит', 'keramzit', 'песок строительн', 'песок карьерн', 'песок мыт',
      'щебень', 'гравий', 'çimento', 'cimento', 'цемент', 'portland', 'mıcır', 'micir', 'agrega', 'kalker',
      'dolgu malzemesi', 'kumlu toprak', 'сухая смесь', 'сухие смеси', 'пескобетон', 'стяжк', 'штукатурк',
      'ротбанд', 'наливной пол', 'tamir harcı', 'tamir harci', 'sıva harcı', 'siva harci', 'şap harcı',
      'şap kumu', 'tesviye şapı', 'hazır şap', 'kuru karışım', 'kalekim', 'yapıştırıcı harç', 'цпс ', 'grout'
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
      'кирпич', 'стеновой блок', 'перемычка', 'кбб ', 'керамзитобетон', 'duvar örgü filesi', 'сетка базальтовая'
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
      'опалубк', 'фанер', 'балка бдк', 'стойка телескоп', 'стойка опалубк', 'унивилк',
      'тренога для стойк', 'замок клинов', 'щит опалубк', 'щит линейн', 'щит универсальн',
      'леса рамн', 'леса клинов', 'леса строительн', 'хомут для лесов', 'kalıp', 'kalip',
      'iskele', 'plywood', 'kontrplak', 'doka ', 'peri ', 'teleskopik direk', 'payanda',
      'tie-rod', 'tayrot', 'iskele kelepçe', 'baumak', 'горизонтальный элемент',
      'вставка соединительная', 'cuplock', 'каплок', 'başlangıç ayağı', 'baslangic ayagi'
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
      'доска обрезная', 'доска строительн', 'пиломатериал', 'kereste', 'kalas', 'inşaat tahtası', 'insaat tahtasi', 'ahşap lata', 'брус ', 'брусок', 'ahşap kiriş', 'ahşap takoz'
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
      'гипсокартон', 'гкл ', 'гклв', 'гвл ', 'мембран', 'пароизоляци', 'гидроизоляци',
      'битум', 'рубероид', 'taşyünü', 'tasyunu', 'cam yünü', 'cam yunu', 'alçıpan', 'alcipan',
      'eps ', 'xps ', 'strafor', 'su yalıtım', 'ısı yalıtım', 'membran', 'şilteli', 'dpc ',
      'naylon örtü', 'тарпаулин', 'тент пвх', 'гидрошпонка'
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
      'краск', 'грунтовк', 'эмаль', 'лак ', 'герметик', 'пена монтажн', 'клей пва', 'клей обойн',
      'пластификатор', 'противоморозн', 'растворител', 'уайт-спирит', 'шпатлевк',
      'boya', 'astar', 'betonokontakt', 'бетоноконтакт', 'epoksi', 'tiner', 'mastik', 'silikon',
      'poliüretan köpük', 'montaj köpüğü', 'harç katkısı', 'antifriz', 'kür malzemesi', 'пленкообразующ'
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
      'Sıhhi Tesisat & Isıtma',
      'Mekanik',
      'Tesisat',
      'Сантехника'
    ],
    keywords: [
      'труба полипропилен', 'труба ппр', 'труба пнд', 'труба канализац', 'сшитый полиэтилен', 'радиатор отоплен',
      'котел', 'вентиляци', 'воздуховод', 'кран шаров', 'задвижк', 'фитинг',
      'насос', 'канализаци', 'отоплени', 'ppr boru', 'pvc boru', 'vana', 'küresel vana', 'radyatör',
      'fittings', 'pompa', 'havalandırma', 'klima', 'pis su', 'temiz su', 'водонагревател', 'boyler',
      'yangın hortumu', 'yangin hortumu', 'пожарный рукав', 'пожарный ствол', 'yangın vanası', 'yangın dolabı'
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
      'Elektrik & Aydınlatma',
      'Elektrik',
      'Электрика'
    ],
    keywords: [
      'кабель силов', 'провод пугв', 'провод пвс', 'ввг', 'ввгнг', 'пугв', 'аввг', 'кгтп', 'сип-',
      'автоматический выключател', 'дифавтомат', 'узо ', 'выключател', 'розетк', 'щит электрическ',
      'щит распределительн', 'щит освещен', 'счетчик электроэнерг', 'светильник', 'прожектор', 'гофра пнд',
      'лоток кабельный', 'трансформатор', 'kablo', 'sigorta', 'şalter', 'priz', 'elektrik pano',
      'aydınlatma', 'led projektör', 'led armatür', 'kontaktör', 'buat', 'kablo kanalı', 'kablo tavası',
      'изолента', 'термоусаживаем', 'термоусадочн', 'makaron'
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
      'каска защитн', 'каска строительн', 'жилет светоотражающ', 'жилет сигнальн', 'ботинки рабоч', 'сапоги рабоч',
      'спецодежд', 'спецобув', 'перчатки защитн', 'перчатки рабоч', 'перчатки х/б', 'перчатки нитрил',
      'очки защитн', 'респиратор', 'страховочн', 'привязь', ' строп страховочн', 'ограждени', 'лента сигнальн',
      'baret', 'reflektörlü yelek', 'ikaz yeleği', 'iş ayakkabısı', 'is ayakkabisi', 'iş botu', 'is botu',
      'iş elbisesi', 'is elbisesi', 'koruyucu gözlük', 'iş eldiveni', 'is eldiveni', 'toz maskesi',
      'emniyet kemeri', 'yaşam hattı', 'güvenlik ağı', 'манекен', 'огнетушител', 'yangın tüpü', 'yangin tupu',
      'аптечк', 'ilk yardım', 'носилки', 'sedye'
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
      'Hırdavat & El Aletleri',
      'Инструмент'
    ],
    keywords: [
      'сверло', 'бур ', 'бур по', 'бур sds', 'бита ', 'франкфурт', 'молоток', 'кувалд', 'черенок для молотка',
      'черенок для лопат', 'лопата', 'диск пильный', 'диск алмазн', 'чашка алмазн', 'коронка биметалл',
      'matkap', 'kırıcı delici', 'taşlama makinesi', 'avuç taşlama', 'matkap ucu', 'kırıcı uç', 'keski',
      'çekiç', 'balyoz', 'kürek', 'kazma', 'testere', 'daire testere', 'dekupaj', 'panç', 'pense',
      'kerpeten', 'tornavida', 'anahtar kombine', 'boru anahtarı', 'lokma', 'allen', 'maket bıçağı',
      'falçata', 'havya', 'паяльник', 'el arabası', 'japon arabası', 'zımba tabancası', 'perçin tabancası',
      'köpük tabancası', 'silikon tabancası', 'пистолет для пены', 'пистолет для герметик', 'миксер для красок',
      'строп текстильн', 'строп канатн', 'строп цепн', 'чалки', 'bez sapan', 'çelik sapan'
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
      'саморез', 'дюбель', 'болт', 'гайк', 'шайб', 'шпильк', 'диск отрезной', 'круг отрезной', 'круг зачистн',
      'круг лепестков', 'диск зачистн', 'vida', 'samorez', 'cıvata', 'civata', 'somun', 'rondela',
      'dübel', 'dubel', 'çivi', 'civi', 'гвозд', 'asma kilit', 'замок навесной', 'kablo bağı', 'хомут кабельн',
      'стяжка кабельн', 'kesici taş', 'kesme taşı', 'taşlama taşı', 'zımpara', 'наждачн', 'ведро строительн',
      'емкость строительн', 'стрейч', 'streç film', 'tel fırça', 'çanak fırça', 'щетка металлическ', 'корщетк'
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
      'электрод', 'электроды', 'askaynak', 'kaynak elektrod', 'kaynak makinesi', 'kaynak teli', 'kaynak pense',
      'сварочн', 'сварка', 'пропан', 'propan', 'кислород', 'oksijen tüpü', 'oksijen saati', 'редуктор пропан',
      'редуктор кислород', 'горелка газ', 'резак пропан', 'pürmüz', 'şaloma'
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
      'керамогранит', 'плитка керамическ', 'плитка напольн', 'плитка настенн', 'унитаз', 'раковин', 'смесител',
      'ванна ', 'душевой поддон', 'душевая кабин', 'инсталляци', 'seramik karo', 'yer seramiği', 'duvar seramiği',
      'granit seramik', 'fayans karo', 'vitrifiye', 'lavabo', 'klozet', 'pisuvar taşı', 'batarya musluk', 'estima'
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
      'межкомнатная', 'дверь', 'дверная', 'дверной блок', 'наличник', 'добор', 'jaluzi', 'жалюзи', 'oda kapısı',
      'çelik kapı', 'yangın kapısı', 'pervaz', 'paspas ızgarası', 'parke taşı', 'granit parke', 'bordür taşı',
      'бордюр', 'брусчатк', 'тротуарная плитка', 'линолеум', 'ламинат', 'плинтус', 'süpürgelik', 'asma tavan',
      'армстронг', 'грильято', 'люк ревизионн', 'люк под покраску', 'müdahale kapağı', 'mudahale kapagi'
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
      'dream riva', 'asansör üzeri', 'merdiven levha', 'posta kutu', 'tabela', 'uyarı levha',
      'ikaz levha', 'güvenlik levha', 'iş güvenliği levha', 'piktogram', 'ikonu', 'harfleri seti',
      'yön okları', 'otopark yönlendirme', 'blok/bina ismi', 'sadece personel', 'stuff only',
      'bina isimli', 'kat panelinde', 'знак безопасности', 'табличка информац', 'стенд информац'
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
      'taheometre', 'tacheometer', 'total station', 'тахеометр', 'leica', 'nivo', 'нивелир', 'teodolit', 'теодолит',
      'statif', 'sehpa / statif', 'штатив геодез', 'штатив для нивелир', 'jalon', 'веха геодез', 'рейка нивелирн',
      'reflektör prizma', 'yansıtıcı marka', 'отражатель геодез', 'su terazisi', 'уровень строительн', 'весы ',
      'lazer metre', 'дальномер лазерн', 'geb364', 'gmp111', 'nedo', 'kumpas', 'штангенциркуль', 'пирометр',
      'термогигрометр', 'анемометр', 'склерометр', 'толщиномер', 'трассоискатель', 'kablo bulucu',
      'рация', 'радиостанц', 'telsiz', 'turbosky', 'retekess', 'baofeng'
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
      'ranza', 'кровать двухъярусн', 'кровать металлическ', 'yatak', 'матрас', 'yastık', 'подушк',
      'yorgan', 'одеял', 'nevresim', 'постельн', 'soyunma dolabı', 'elbise dolabı', 'шкаф для одежд',
      'шкаф гардеробн', 'ayakkabılık', 'обувниц', 'askılık', 'вешалк', 'raf ünitesi', 'raf çerçevesi',
      'raf kirişi', 'raf tablası', 'стеллаж', 'erzak dolabı', 'ofis masası', 'çalışma masası', 'стол письменн',
      'стол офисн', 'ofis koltuğu', 'ofis sandalyesi', 'кресло офисн', 'стул офисн', 'стул iso'
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
      'konteyner', 'контейнер морск', 'бытовк', 'блок-контейнер', 'tuvalet kabini', 'туалетная кабин',
      'blok konteyner', 'yaşam konteyneri', 'şantiye konteyneri', 'mobil akaryakıt', 'turnike', 'турникет',
      'шлагбаум', 'bariyer kolu', 'mobil çit', 'panel çit'
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
      'cam ve ayna', 'help sprey', 'kağıt havlu', 'kagit havlu', 'полотенца бумажн', 'veiro',
      'tuvalet kağıdı', 'tuvalet kagidi', 'туалетная бумага', 'ıslak mendil', 'ıslak havlu', 'салфетк',
      'klozet bloğu', 'klozet blogu', 'bref', 'çamaşır suyu', 'camasir suyu', 'domestos', 'белизна',
      'klor tozu', 'хлорная известь', 'paspas', 'швабр', 'моп ', 'vileda', 'çamaşır kurutma', 'сушилка для белья',
      'süpürge', 'метла', 'щетка для уборки', 'щетка для пола', 'черенок для щетки', 'yer fırçası', 'yer fircasi',
      'tuvalet fırçası', 'tuvalet fircasi', 'ершик для унитаза', 'sabun', 'мыло', 'çöp kovası', 'çöp poşeti',
      'çöp torbası', 'мешки для мусора', 'çöp konteyner', 'мусорный бак', 'sünger', 'губка для посуды'
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
      'çay ', 'чай ', 'kahve', 'кофе', 'nescafe', 'şeker', 'seker', 'сахар',
      'tuz ', 'соль ', 'bisküvi', 'biskuvi', 'печенье', 'pekarro', 'çikolata', 'cikolata',
      'шоколад', 'bounty', 'mars minis', 'su ısıtıcı', 'su isitici', 'kettle', 'электрочайник', 'чайник',
      'scarlett', 'karton bardak', 'plastik bardak', 'cam bardak', 'стакан одноразов', 'стакан бумажн', 'кружк',
      'fincan', 'tabak', 'тарелк', 'çatal', 'yemek bıçağı', 'mutfak bıçağı', 'kaşık', 'tahta kaşık',
      'вилка столов', 'нож столов', 'нож кухонн', 'ложка столов', 'ложка чайн', 'şekerlik', 'tepsi',
      'saklama kabı', 'органайзер для кухни', 'gıda streç', 'buzdolabı', 'холодильник', 'mikrodalga', 'микроволнов',
      'su sebili', 'кулер для воды', 'içme suyu', 'вода питьевая'
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
      'бумага офисн', 'бумага а4', 'бумага а3', 'ручка шариков', 'ручка гелев', 'папка-регистратор', 'папка с арочн',
      'папка-скоросшивател', 'степлер канцеляр', 'скобы для степлер', 'файлы-вкладыш', 'блокнот', 'маркер перманент',
      'маркер для доск', 'комус', 'attache', 'fotokopi kağıdı', 'a4 kağıt', 'a3 kağıt', 'klasör', 'poşet dosya',
      'tükenmez kalem', 'fosforlu kalem', 'tahta kalemi', 'yazı tahtası', 'beyaz tahta', 'доска магнитно-маркерн',
      'zımba teli', 'delgeç', 'дырокол', 'ataş', 'скрепк', 'not kağıdı', 'post-it', 'hesap makinesi', 'калькулятор',
      'laminasyon filmi', 'пленка для ламинирован', 'kaşe', 'ıstampa', 'zarf'
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
      'картридж лазерн', 'картридж для принтер', 'картридж струйн', 'тонер-картридж', 'принтер', 'мфу ',
      'мышь компьютерн', 'мышь беспроводн', 'клавиатур', 'монитор жк', 'монитор ips', 'ноутбук', 'системный блок',
      'коммутатор', 'маршрутизатор', 'роутер', 'источник бесперебойного питания', 'ибп ', 'патч-корд',
      'yazıcı', 'yazici', 'plotter', 'toner', 'bilgisayar', 'laptop', 'notebook', 'klavye', 'kablosuz mouse',
      'network switch', 'poe switch', 'tp-link', 'd-link', 'keenetic', 'mikrotik', 'ubiquiti', 'canon lbp',
      'canon pfi', 'kyocera', 'pantum', 'ram bellek', 'ssd ', 'kingston', 'apacer', 'crucial', 'logitech',
      'digma', 'rj45', 'rj-45', 'hdmi', 'displayport', 'kesintisiz güç kaynağı'
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
      'oto lastik', 'oto lastiği', 'автошина', 'шина зимн', 'шина летн', 'continental', 'yokohama',
      'фильтр топливный', 'фильтр масляный', 'фильтр воздушный', 'hengst', 'yakıt filtresi', 'yağ filtresi',
      'dizel yakıt', 'дизельное топливо', 'mazot', 'моторное масло', 'гидравлическое масло', 'hidrolik yağ',
      'motor yağı', 'antifrizli cam suyu', 'стеклоомывающ', 'araç aküsü', 'аккумулятор автомобил',
      'kompresör', 'kompresor', 'компрессор', 'jeneratör', 'jenerator', 'генератор бензин', 'генератор дизельн',
      'isımak', 'isimak', 'тепловая пушка', 'master isimak',
      'доставк', 'перевозк', 'транспортн', 'аренда техник', 'автокран', 'кран-манипулятор', 'экскаватор',
      'nakliye', 'lojistik', 'vinç kiralama', 'hafriyat', 'moloz', 'sevkiyat'
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

const PHRASE_TRANSLATIONS: Array<[RegExp, string]> = [
  [/^канцелярские\s+и\s+офисные\s+товары\s*\((.+)\)$/gi, '$1'],
  [/^строительно-монтажный\s+материал\s*\/\s*тмц\s*\((.+)\)$/gi, '$1'],
  [/угловая\s+шлифмашина|ушм/gi, 'Avuç Taşlama Makinesi (Spiral)'],
  [/пила\s+циркулярная\s+сетевая|пила\s+дисковая|дисковая\s+пила/gi, 'Daire Testere Makinesi'],
  [/диск\s+пильный\s+по\s+дереву/gi, 'Ahşap Kesici Daire Testere Bıçağı'],
  [/диск\s+отрезной\s+по\s+металлу/gi, 'Metal Kesici Taş Disk'],
  [/диск\s+алмазный/gi, 'Elmas Kesici Disk'],
  [/алмазная\s+шлифовальная\s+чашка/gi, 'Elmas Beton Taşlama Çanağı'],
  [/затирочный\s+диск/gi, 'Helikopter Perdah Makinesi Tepsi Diski'],
  [/перфоратор/gi, 'Kırıcı-Delici Matkap (Perforatör)'],
  [/шуруповерт|дрель-шуруповерт/gi, 'Akülü Vidalama / Matkap'],
  [/нож\s+для\s+разделки\s+кабеля/gi, 'Kablo Soyma Bıçağı'],
  [/нож\s+строительный\s+со\s+сменным\s+лезвием|нож\s+строительный\s+сегментный/gi, 'Değişebilir Bıçaklı Maket Bıçağı'],
  [/лезвие\s+для\s+ножа|лезвия\s+для\s+ножа/gi, 'Maket Bıçağı Yedeği / Ucu'],
  [/перчатка\s+термоусаживаемая/gi, 'Isıyla Daralan Kablo Başlığı (Termo Makaron Eldiven)'],
  [/трубка\s+термоусадочная|термоусаживаемая\s+трубка/gi, 'Isıyla Daralan Makaron (Termo Boru)'],
  [/труба\s+гофрированная\s+пвх/gi, 'Spiral Koruge PVC Kablo Borusu'],
  [/труба\s+гибкая\s+гофрированная\s+пнд/gi, 'Esnek Koruge Kablo Borusu (PND)'],
  [/труба\s+питьевая\s+напорная\s+пнд/gi, 'PE100 Kangal İçme Suyu Borusu (PND)'],
  [/клемма\s+универсальная/gi, 'Üniversal Buat Klemensi'],
  [/клемма\s+заземления/gi, 'Topraklama Pensesi / Klemensi'],
  [/изолента\s+пвх/gi, 'PVC Elektrik İzole Bant'],
  [/прожектор/gi, 'LED Projektör Aydınlatma'],
  [/кабель\s+аввг-пнг\(а\)-ls/gi, 'Yassı Alüminyum Güç Kablosu AVVG-Png(A)-LS'],
  [/кабель\s+ввгнг\(а\)-ls/gi, 'Yanmaz Bakır Güç Kablosu VVGng(A)-LS'],
  [/кабель\s+кг|провод\s+кгввнг/gi, 'Kauçuk Esnek Kaynak/Güç Kablosu KG'],
  [/провод\s+пугвнг\(а\)-ls|пугв\s+нг\s*а\s*[-–]\s*ls/gi, 'Esnek Tesisat Kablosu PuGVng(A)-LS'],
  [/саморегулирующийся\s+кабель/gi, 'Kendinden Regüleli Isıtıcı Kablo'],
  [/кабель-канал/gi, 'PVC Kablo Kanalı'],
  [/коробка\s+ответвительная/gi, 'Buat / Kablo Ek Kutusu'],
  [/автоматический\s+выключатель\s+дифференциального\s+тока\s*\(авдт\)|дифавтомат/gi, 'Kaçak Akım Korumalı Otomatik Sigorta (RCBO / AVDT)'],
  [/выключатель\s+автоматический\s+трехполюсный/gi, '3 Kutuplu Otomatik Sigorta'],
  [/выключатель\s+автоматический/gi, 'Otomatik Sigorta'],
  [/вилка\s+каучуковая\s+с\s+заземл\.?/gi, 'Topraklı Kauçuk Erkek Fiş'],
  [/фотореле/gi, 'Fotoselli Aydınlatma Rölesi'],
  [/бирка\s+кабельная/gi, 'Kablo Etiketi'],
  [/протяжка\s+для\s+кабеля/gi, 'Kablo Çekme Sustası (Kılavuz)'],
  [/насадка\s+для\s+скрутки\s+проводов/gi, 'Kablo Burgu ve Soyma Aparatı'],
  [/ножницы\s+секторные/gi, 'Sektörel Zırhlı Kablo Kesme Makası'],
  [/набор\s+индикаторных\s+отверток/gi, 'Kontrol Kalemi Seti'],
  [/отвертка\s+двухсторонняя/gi, 'Çift Taraflı Tornavida'],
  [/бита\s+с\s+торцевой\s+головкой/gi, 'Manyetik Lokma Vidalama Ucu'],
  [/бита\s+крестовая/gi, 'Yıldız Vidalama Bits Ucu'],
  [/изолятор\s+sm/gi, 'Pano Bara İzolatörü SM'],
  [/люк\s+под\s+покраску/gi, 'Boyanabilir Gizli Müdahale Kapağı'],
  [/гидрошпонка/gi, 'Su Tutucu Bant (Waterstop)'],
  [/штуцер\s+инъекционный\s+угловой/gi, 'Köşe Tip Enjeksiyon Pakeri / Nipeli'],
  [/трубка\s+инъекционная/gi, 'Su Yalıtım Enjeksiyon Hortumu'],
  [/полиуретановый\s+герметик/gi, 'Poliüretan Mastik / Sosis'],
  [/гибридный\s+клей-герметик/gi, 'Hibrit Mastik Yapıştırıcı'],
  [/пена\s+монтажная/gi, 'Poliüretan Montaj Köpüğü'],
  [/очистити?ель\s+(?:пу\s+|монтажной\s+)?пены/gi, 'Poliüretan Köpük Temizleyici'],
  [/клей\s+для\s+плитки/gi, 'Seramik / Fayans Yapıştırıcısı'],
  [/клей\s+для\s+газобетона/gi, 'Gazbeton Yapıştırıcı Harcı'],
  [/клей\s+для\s+виниловых\s+и\s+ковровых\s+покрытий/gi, 'Vinil ve Halı Kaplama Yapıştırıcısı'],
  [/нагревательный\s+элемент\s+для\s+бойлера,?\s*тэн|тэн\s+для\s+водонагревателя|тэн\s+с\s+терморегулятором/gi, 'Boyler / Su Isıtıcı Rezistansı (TEN)'],
  [/удлинитель\s+1\/2/gi, 'Tesisat Uzatma Nipeli 1/2"'],
  [/хомут\s+сантехнический\s+для\s+труб/gi, 'Lastikli Somunlu Boru Kelepçesi'],
  [/смеситель\s+для\s+кухни/gi, 'Mutfak Evye Bataryası'],
  [/пожарный\s+ствол/gi, 'Yangın Hortumu Lansı'],
  [/рукав\s+пожарный/gi, 'Yangın Hortumu'],
  [/рукав\s+газовый\s+ацетилен\/пропан|рукав\s+для\s+газ\.\s*сварки\s+и\s+резки/gi, 'Oksijen/Propan Gaz Kaynak Hortumu'],
  [/клетка\s+для\s+(\d+)\s+пропановых\s+баллонов/gi, '$1\'lu Propan Tüpü Taşıma Sepeti / Kafesi'],
  [/редуктор\s+кислородный/gi, 'Oksijen Regülatörü / Saati'],
  [/редуктор\s+пропановый/gi, 'Propan Regülatörü / Saati'],
  [/горелка\s+газовоздушная/gi, 'Gaz-Hava Pürmüz / Şaloma Başlığı'],
  [/сварочный\s+инверторный\s+аппарат|сварочный\s+аппарат\s+инверторный/gi, 'İnvertör Kaynak Makinesi'],
  [/электрододержатель/gi, 'Kaynak Elektrot Pensesi'],
  [/маска\s+сварщика/gi, 'Kaynakçı Maskesi'],
  [/вилка\s+для\s+сварочного\s+аппарата/gi, 'Kaynak Makinesi Kablo Fişi (Erkek Soket)'],
  [/гнездо\s+для\s+сварочного\s+аппарата/gi, 'Kaynak Makinesi Kablo Prizi (Dişi Soket)'],
  [/паяльная\s+паста/gi, 'Lehim Pastası'],
  [/сверло\s+(?:спиральное\s+)?по\s+металлу/gi, 'HSS Metal Matkap Ucu'],
  [/бур\s+по\s+бетону/gi, 'SDS Beton Matkap Ucu'],
  [/зубило\s+плоское/gi, 'Yassı Kırıcı Keski Ucu'],
  [/зубило/gi, 'Kırıcı Keski Ucu'],
  [/пика\s+для\s+отбойного\s+молотка|пика\s+sds|тор\s+пика/gi, 'Kırıcı Sivri Murç / Delici Uç'],
  [/пружина\s+концевая\s+для\s+(?:отбойного\s+молотка|молотка\s+отбойного)/gi, 'Kırıcı Tabanca (Отбойный молоток) Uç Yayı'],
  [/молоток\s+универсальный/gi, 'Üniversal Çekiç'],
  [/черенок\s+для\s+универсального\s+молотка/gi, 'Üniversal Çekiç Sapı'],
  [/лом\s+гвоздодер/gi, 'Oluklu Sökü Demiri / Levye'],
  [/миксер\s+для\s+красок\s+и\s+штукатурных\s+смесей/gi, 'Boya ve Harç Karıştırıcı Mikser Ucu'],
  [/правило\s+алюминиевое/gi, 'Alüminyum Mastar'],
  [/уровень\s+алюминиевый\s+магнитный/gi, 'Mıknatıslı Alüminyum Su Terazisi'],
  [/рулетка/gi, 'Şerit Metre'],
  [/шнур\s+разметочный/gi, 'Çırpı İpi / İnşaat İpi'],
  [/лестница\s+алюминиевая/gi, 'Alüminyum Merdiven'],
  [/строп\s+текстильный\s*(?:петлевой\s*)?стп/gi, 'Bez Sapan (Текстильный строп СТП)'],
  [/строп\s+канатный\s+петлевой/gi, 'Çelik Halat Sapan'],
  [/двойной\s+веревочный\s+строп|строп\s+веревочный\s+двойной/gi, 'Çift Kollu Emniyet Halatı (Lanyard)'],
  [/страховочная\s+привязь/gi, 'Paraşüt Tipi Emniyet Kemeri'],
  [/веревка\s+полиамидная/gi, 'Poliamid Güvenlik Halatı'],
  [/наколенники\s+строительные/gi, 'İnşaat Dizliği'],
  [/защитная\s+каска|каска\s+строительная/gi, 'İş Güvenliği Bareti'],
  [/полуботинки/gi, 'İş Güvenliği Ayakkabısı'],
  [/жилет\s+светоотражающий/gi, 'Reflektörlü İkaz Yeleği'],
  [/комбинезон\s+одноразовый\s+каспер\s+спанбонд/gi, 'Kasper Spunbond Tek Kullanımlık Koruyucu Tulum'],
  [/плащ-дождевик\s+полиэтиленовый|дождевик\s+полиэтиленовый/gi, 'Polietilen Yağmurluk'],
  [/утеплитель\s+нтп/gi, 'Termal Çizme İçliği (НТП)'],
  [/огнетушитель\s+порошковый/gi, 'Kuru Kimyevi Tozlu Yangın Söndürücü'],
  [/лента\s+сигнальная/gi, 'İkaz / Güvenlik Şeridi'],
  [/ручной\s+досмотровый\s+металлодетектор/gi, 'El Tipi Güvenlik Üst Arama Metal Dedektörü'],
  [/прямой\s+пинцет|пинцет\s+анатомический/gi, 'Teknik Cımbız'],
  [/маркер\s+перманентный\s+двухсторонний/gi, 'Çift Uçlu Permanent Markör Kalem'],
  [/маркер\s+перманентный/gi, 'Permanent Markör Kalem'],
  [/кисть\s+малярная\s+плоская\s+с\s+деревянной\s+ручкой/gi, 'Ahşap Saplı Düz Boya Fırçası'],
  [/кисть\s+малярная\s+радиаторная/gi, 'Radyatör Boya Fırçası'],
  [/кисть\s+малярная/gi, 'Boya Fırçası'],
  [/валик\s+малярный\s+с\s+пластик\.?\s*ручкой/gi, 'Plastik Saplı Boya Rulosu'],
  [/мини-валик/gi, 'Parmak Boya Rulosu'],
  [/ершик\s+для\s+унитаза|ерш\s+для\s+очистки\s+туалета/gi, 'WC Klozet / Tuvalet Fırçası'],
  [/щетка\s+по\s+металлу\s+для\s+ушм/gi, 'Avuç Taşlama İçin Çelik Tel Fırça'],
  [/щетка\s+ручная\s+(?:с\s+деревянной\s+ручкой\s+)?по\s+металлу/gi, 'El Tipi Metal Tel Fırça'],
  [/щетка\s+строительная\s+универсальная/gi, 'Üniversal İnşaat / Saha Temizlik Fırçası'],
  [/щетка\s+для\s+уборки/gi, 'Genel Temizlik Fırçası'],
  [/щетка\s+для\s+пола/gi, 'Yer / Zemin Temizlik Fırçası'],
  [/щетка\s+для\s+мытья\s+авто/gi, 'Araç Yıkama Fırçası'],
  [/комплект\s+угольных\s+щеток|щетки\s+графитовые|щетка\s+графитовая/gi, 'Elektrikli El Aleti Kömür / Grafit Fırçası'],
  [/набор\s+для\s+уборки/gi, 'Temizlik Seti (Faraş + Yer Fırçası)'],
  [/насадка\s+моп/gi, 'Paspas (Mop) Yedeği'],
  [/черенок\s+для\s+щетки/gi, 'Fırça / Süpürge Sapı'],
  [/черенок\s+для\s+лопаты/gi, 'Kürek Sapı'],
  [/пленка\s+армированная/gi, 'Telli Takviyeli Sera / İnşaat Naylonu'],
  [/пленка\s+укрывная\s+техническая|пленка\s+техническая/gi, 'Teknik Koruma Naylonu (Polietilen Örtü)'],
  [/пленка\s+пароизоляционная/gi, 'Buhar Kesici Yalıtım Örtüsü'],
  [/пленка\s+для\s+ламинирования/gi, 'Laminasyon Filmi'],
  [/стрейч-пленка|пленка\s+стрейч/gi, 'Ambalaj Streç Filmi'],
  [/скотч\s+малярный/gi, 'Kağıt Maskeleme Bandı'],
  [/бумага\s+шлифовальная/gi, 'Zımpara Kağıdı'],
  [/тент\s+пвх\s+на\s+основе\s+плотной\s+ткани\s+оксфорд/gi, 'Oxford Dokuma Takviyeli PVC Koruma Brandası'],
  [/тент\s+пвх|тент\s+тарпаулин|полог\s+тарпаулин/gi, 'PVC / Tarpaulin Koruma Brandası'],
  [/перчатки\s+нейлоновые\s+с\s+нитрильно-латексным\s+покрыт\.?/gi, 'Nitril-Lateks Kaplamalı Naylon İş Eldiveni'],
  [/перчатки\s+х\/б\s+с\s+пвх/gi, 'PVC Noktalı Pamuklu İş Eldiveni'],
  [/перчатки\s+(?:хлопчатобумажные\s+)?с\s+двойным\s+латексным\s+(?:обливом|покрытием)/gi, 'Çift Kat Lateks Kaplamalı İş Eldiveni'],
  [/клещи\s+вязальные/gi, 'Demirci Bağlama Kerpeteni'],
  [/проволока\s+(?:о\/к\s+)?вязальная|проволока\s+о\/к.*отожженная/gi, 'Tavlı İnşaat Bağ Teli'],
  [/гвозди\s+строительные|гвоздь\s+строительный/gi, 'İnşaat Çivisi'],
  [/фанера\s+ламинированная|фанера\s+ламин\.|фанера\s+береза.*лбфф/gi, 'Film Kaplı Su Kontrplağı (Plywood)'],
  [/фанера\s+фсф|фанера\s+фк/gi, 'Huş Kontrplak Plaka'],
  [/щит\s+(\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+)\s+линейный/gi, 'Perde Kalıp Paneli (Doğrusal) $1 m'],
  [/щит\s+(\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+)\s+универсальный/gi, 'Üniversal Perde Kalıp Paneli $1 m'],
  [/угол\s+внутренний\s+(\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+)\s+правый/gi, 'Pano Kalıp Sağ İç Köşe Paneli $1 m'],
  [/угол\s+внутренний\s+(\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+\s*[xх*×]\s*\d+[.,]\d+)\s+левый/gi, 'Pano Kalıp Sol İç Köşe Paneli $1 m'],
  [/подкос\s+двухуровневый/gi, 'Çift Kademeli Kalıp Payandası'],
  [/подкос\s+одноуровневый/gi, 'Tek Kademeli Kalıp Payandası'],
  [/вышка[\s-]*тура|тура\s+gigant/gi, 'Tekerlekli İskele Kulesi (Вышка-Тура)'],
  [/внешний\s+вибратор/gi, 'Kalıp Dış Vibratörü'],
  [/вч\s+глубинный\s+вибратор\s+со\s+встроенным\s+преобразователем/gi, 'Konvertörlü Yüksek Frekanslı Beton İç Vibratörü'],
  [/держатель\s+перил\s+торцевой/gi, 'Kenar Koruma Korkuluk Dikmesi / Tutucu'],
  [/фиксатор\s+напольный/gi, 'Döşeme Donatı Paspayı'],
  [/анкер\s+клиновой,?\s*желтый\s+цинк/gi, 'Kama Tipi Çelik Ankraj (Sarı Galvaniz)'],
  [/анкер\s+клиновой/gi, 'Kama Tipi Çelik Ankraj'],
  [/анкерный\s+болт\s+с\s+кольцом/gi, 'Halkalı Çelik Ankraj Cıvatası'],
  [/анкерный\s+болт\s+с\s+крюком/gi, 'Kancalı Çelik Ankraj Cıvatası'],
  [/болт\s+анкерный|анкер\s+болт\s+болтом|анкер\s+болт/gi, 'Çelik Ankraj Cıvatası'],
  [/анкерная\s+подвеска\s+для\s+опалубки/gi, 'Kalıp Ankraj Askısı'],
  [/пистолет\s+для\s+элемента\s+химический\s+клеевой|пистолет\s+для\s+elementa/gi, 'Kimyasal Ankraj Sıkma Tabancası'],
  [/саморез\s+потай(?:ной)?,?\s*(?:цинк\s*)?(?:сверло)?/gi, 'Matkap Uçlu Havşa Başlı Vida'],
  [/винт\s+нержавеющий/gi, 'Paslanmaz Vida'],
  [/гайка\s+низкая/gi, 'İnce Somun'],
  [/гайка\s+шестигранная/gi, 'Altıköşe Somun'],
  [/шайба\s+.*кузовная/gi, 'Geniş (Şase) Pul / Rondela'],
  [/зажим\s+троса/gi, 'Çelik Halat Klemensi'],
  [/замок\s+навесной/gi, 'Asma Kilit'],
  [/петля\s+дверная\s+без\s+врезки/gi, 'Geçmeli Kapı Menteşesi'],
  [/пружина\s+дверная/gi, 'Kapı Yayı'],
  [/ручка\s+дверная\s+для\s+замка/gi, 'Kapı Kolu'],
  [/дверь\s+межкомнатная\s+дпг/gi, 'İç Oda Kapısı DPG'],
  [/коробка\s+дверная\s+дпг/gi, 'Kapı Kasası DPG'],
  [/наличник/gi, 'Kapı Pervazı'],
  [/финишпленка\s+белая\s+глухая\s+с\s+замком/gi, 'Beyaz Kaplama Kilitli'],
  [/финишпленка\s+белая\s+с\s+петлями/gi, 'Beyaz Kaplama Menteşeli'],
  [/финишпленка\s+белый\s+прямой/gi, 'Beyaz Düz Kaplama'],
  [/балка\s+двутавровая/gi, 'Çelik IPE/HEB Kiriş (Двутавр)'],
  [/электросварные\s+стальные\s+трубы/gi, 'Dikişli Çelik Boru'],
  [/труба\s+вгп/gi, 'Çelik Su/Gaz Borusu (VGP)'],
  [/профиль\s+строительный\s+пс\s+knauf/gi, 'Knauf Alçıpan Dikme C-Profili (ПС)'],
  [/профиль\s+п-образный/gi, 'U-Tipi Montaj Profili'],
  [/лента\s+уплотнительная\s+поризованная|лента\s+уплотнительная/gi, 'Ses Yalıtım Sızdırmazlık Bandı'],
  [/пеноплэкс\s+основа/gi, 'Penoplex Osnova XPS Isı Yalıtım Levhası'],
  [/стол\s+производственный|стол\s+разделочный\s+без\s+борта/gi, 'Endüstriyel Paslanmaz Mutfak Tezgahı'],
  [/чайник\s+электрический/gi, 'Elektrikli Su Isıtıcı (Kettle)'],
  [/кофеварка/gi, 'Elektrikli Kahve Makinesi'],
  [/кофе\s+в\s+зернах/gi, 'Çekirdek Kahve'],
  [/сахарница/gi, 'Şekerlik'],
  [/органайзер\s+для\s+кухни\s+настенный/gi, 'Duvar Tipi Mutfak Düzenleyici Raf'],
  [/стакан\s+одноразовый\s+пластиковый|стакан\s+одноразовый\s+бюджет/gi, 'Tek Kullanımlık Plastik Bardak'],
  [/тарелка\s+одноразовая\s+пластиковая/gi, 'Tek Kullanımlık Plastik Tabak'],
  [/бокс\s+одноразовый/gi, 'Tek Kullanımlık Kapaklı Gıda Kabı'],
  [/порошок\s+стиральный\s+автомат/gi, 'Otomatik Çamaşır Makinesi Toz Deterjanı'],
  [/отбеливатель\s+белизна/gi, 'Belizna Çamaşır Suyu / Ağartıcı'],
  [/средство\s+для\s+сантехники/gi, 'Banyo ve Sıhhi Tesisat Temizleyici'],
  [/универсальное\s+чистящее\s+средство/gi, 'Çok Amaçlı Yüzey Temizleyici'],
  [/полотенца\s+бумажные\s+д\/дисп/gi, 'Dispenser Kağıt Havlu'],
  [/салфетки\s+хозяйственные/gi, 'Mikrofiber Temizlik Bezi'],
  [/мешки\s+для\s+мусора/gi, 'Çöp Poşeti / Torbası'],
  [/контейнер-бак\s+мусорный|бак\s+мусорный/gi, 'Tekerlekli/Pedallı Çöp Konteyneri'],
  [/хлорные\s+таблетки/gi, 'Dezenfektan Klor Tableti'],
  [/папка-планшет\s+д\/бумаг|шет\s+д\/бумаг/gi, 'Kapaklı Sekreterlik Dosyası'],
  [/папка-регистратор|регистратор\s+комус/gi, 'Klasör Dosya'],
  [/короб\s+архивный/gi, 'Arşiv Kutusu'],
  [/скрепки/gi, 'Ataş'],
  [/стикеры\s+с\s+клеев\.?\s*краем/gi, 'Yapışkanlı Not Kağıdı (Post-it)'],
  [/стержень\s+микрографический/gi, 'Versatil Kalem Ucu'],
  [/доска\s+магнитно-маркерная/gi, 'Manyetik Beyaz Yazı Tahtası'],
  [/самокопирующиеся\s+бланки/gi, 'Otokopili Form Koçanı'],
  [/ручка\s+гелевая\s+неавтоматическая/gi, 'Kapaklı Jel Kalem'],
  [/ручка\s+шариковая\s+автоматическая/gi, 'Basmalı Tükenmez Kalem'],
  [/ручка\s+шариковая\s+неавтоматическая/gi, 'Kapaklı Tükenmez Kalem'],
  [/подставка\s+для\s+ног/gi, 'Ofis Ayak Desteği'],
  [/стол\s+журнальный/gi, 'Orta Sehpa'],
  [/стул\s+офисный/gi, 'Ofis Sandalyesi'],
  [/шланг\s+поливочный\s+усиленный/gi, 'Takviyeli Bahçe/Saha Sulama Hortumu'],
  [/тара\s+металлическая\s+производственная/gi, 'Endüstriyel Metal Harç/Malzeme Kasası'],
  [/тестер\s+тоновой\s+прозвонки\s+сети/gi, 'Ağ ve Kablo Test Cihazı'],
  [/комплект\s+роликов/gi, 'Yazıcı Kağıt Çekme Pateni / Rulo Seti'],
  [/комплект\s+фрез\s+по\s+гкл/gi, 'Alçıpan Kanal Açma Freze Ucu Seti'],
  [/направляющая\s+шина/gi, 'Kılavuz Ray'],
  [/ноутбук/gi, 'Dizüstü Bilgisayar (Laptop)'],
  [/коннектор/gi, 'Konnektör Soket'],
  [/дизельные\s+компрессоры|дизельный\s+компрессор/gi, 'Dizel Hava Kompresörü'],
  [/компрессор/gi, 'Hava Kompresörü'],
  [/металлоконструкций\s+платформы|металлоконструкции\s+платформы/gi, 'Çelik Platform Konstrüksiyon İmalatı']
];

const WORD_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bбелый\b|\bбелая\b|\bбелые\b|\bбел\b/gi, 'Beyaz'],
  [/\bчерный\b|\bчёрный\b|\bчерная\b|\bчерные\b|\bчерн\.?\b/gi, 'Siyah'],
  [/\bсерый\b|\bсертая\b|\bсерая\b|\bсер\b/gi, 'Gri'],
  [/\bкрасный\b|\bкрасная\b|\bкрасн\.?\b/gi, 'Kırmızı'],
  [/\bсиний\b|\bсиняя\b|\bсиние\b|\bсин\.?\b/gi, 'Mavi'],
  [/\bжелтый\b|\bжелтая\b|\bжелт\.?\b/gi, 'Sarı'],
  [/\bзеленый\b|\bзеленая\b|\bзеленые\b|\bзел\.?\b/gi, 'Yeşil'],
  [/\bж\/з\b/gi, 'Sarı/Yeşil'],
  [/\bалюминиевый\b|\bалюминиевая\b/gi, 'Alüminyum'],
  [/\bоцинкованный\b|\bоцинк\.?\b|\bцинк\b/gi, 'Galvanizli'],
  [/\bнерж\.?\s*сталь\b|\bнерж\.?\b/gi, 'Paslanmaz Çelik'],
  [/\bрифленый\b/gi, 'Tırtıklı'],
  [/\bс\s+зондом\b|\bс\s+протяжкой\b/gi, 'Kılavuzlu'],
  [/\bс\s+резьбой\b/gi, 'Vidalı'],
  [/\bс\s+натур\.\s*щетиной\b/gi, 'Doğal Kıllı'],
  [/\bэвкалипт\b/gi, 'Okaliptüs'],
  [/\bв\s+упаковке\b|\bупаковка\b|\bупак\.?\b/gi, 'Paket'],
  [/\bкоробка\b|\bкор\.?\b/gi, 'Kutu'],
  [/\bрулон\b|\bрул\.?\b/gi, 'Rulo'],
  [/\bпетли\s+по\s+стороне\b/gi, 'Menteşe Kenarı'],
  [/\bплавный\s+пуск\b/gi, 'Yumuşak Başlatmalı'],
  [/\bантирестарт\b/gi, 'Yeniden Başlama Korumalı'],
  [/\bрезьбовой\s+фланец\b/gi, 'Dişli Flanş'],
  [/\bс\s+терморегулятором\b|\bтермостат\b/gi, 'Termostatlı'],
  [/\bканал\b/gi, 'Kablo Kanalı'],
  [/\bсиловой\b/gi, 'Güç Tipi'],
  [/\bхром\b/gi, 'Krom'],
  [/\bвн\.\b/gi, 'İç Dişli'],
  [/(\d+(?:[.,]\d+)?)\s*мм²/gi, '$1 mm²'],
  [/(\d+(?:[.,]\d+)?)\s*мм\b/gi, '$1 mm'],
  [/(\d+(?:[.,]\d+)?)\s*см\b/gi, '$1 cm'],
  [/(\d+(?:[.,]\d+)?)\s*м\b/gi, '$1 m'],
  [/(\d+(?:[.,]\d+)?)\s*м2\b|\bкв\.?\s*м\b/gi, '$1 m²'],
  [/(\d+(?:[.,]\d+)?)\s*м3\b/gi, '$1 m³'],
  [/(\d+(?:[.,]\d+)?)\s*кг\b/gi, '$1 kg'],
  [/(\d+(?:[.,]\d+)?)\s*гр?\b/gi, '$1 g'],
  [/(\d+(?:[.,]\d+)?)\s*л\b/gi, '$1 L'],
  [/(\d+(?:[.,]\d+)?)\s*мл\b/gi, '$1 ml'],
  [/(\d+(?:[.,]\d+)?)\s*гб\b/gi, '$1 GB'],
  [/(\d+(?:[.,]\d+)?)\s*тб\b/gi, '$1 TB'],
  [/(\d+(?:[.,]\d+)?)\s*квт\b/gi, '$1 kW'],
  [/(\d+(?:[.,]\d+)?)\s*вт\b/gi, '$1 W'],
  [/(\d+(?:[.,]\d+)?)\s*лм\b/gi, '$1 Lm'],
  [/(\d+(?:[.,]\d+)?)\s*бар\b/gi, '$1 Bar'],
  [/(\d+(?:[.,]\d+)?)\s*атм\b/gi, '$1 Atm'],
  [/(\d+(?:[.,]\d+)?)\s*мкр\b|\bмкм\b/gi, '$1 Mikron'],
  [/(\d+(?:[.,]\d+)?)\s*шт\.?\b|\bштук\b/gi, '$1 Adet'],
  [/(\d+)\s*[хХ]\s*(\d+)/g, '$1x$2'],
  [/\bвиллатекс\b/gi, 'Villateks'],
  [/\bикопал\b/gi, 'Icopal'],
  [/\bультранап\b/gi, 'Ultranap'],
  [/\bтехноэласт\b/gi, 'Technoelast'],
  [/\bунифлекс\b/gi, 'Unifleks'],
  [/\bлинокром\b/gi, 'Linokrom'],
  [/\bбиполь\b/gi, 'Bipol'],
  [/\bизопласт\b/gi, 'İzoplast'],
  [/\bн\s+эпп\b/gi, 'H EPP'],
  [/\bв\s+экп\b/gi, 'V EKP'],
  [/\bэпп\b/gi, 'EPP'],
  [/\bэкп\b/gi, 'EKP'],
  [/\bткп\b/gi, 'TKP'],
  [/\bхпп\b/gi, 'HPP'],
  [/\bклеевая\s+смесь\b/gi, 'Yapıştırıcı Harç'],
  [/\bпраймер\s+битумный\b/gi, 'Bitüm Astarı'],
  [/\bпиканте\s+стоп\b/gi, 'Picante Stop'],
  [/\bлюк\s+под\s+покраску\b/gi, 'Boyanabilir Müdahale Kapağı'],
  [/\bсветильник\s+маляра\b/gi, 'Boyacı Aydınlatması'],
  [/\bпроявочный\s+свет\b/gi, 'Yüzey Kontrol Aydınlatması']
];

const translateMemoCache = new Map<string, string>();
const normalizeCatMemoCache = new Map<string, string>();
const ensureRuMemoCache = new Map<string, string>();
const kwAsciiCache = new Map<string, { kTr: string; kAscii: string }>();

const toTrLowerFast = (s?: string) =>
  (s || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü')
    .replace(/Ş/g, 'ş')
    .replace(/Ö/g, 'ö')
    .replace(/Ç/g, 'ç')
    .toLowerCase();

const toAsciiLowerFast = (s?: string) =>
  toTrLowerFast(s)
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

export function translateRussianMaterialToTurkish(rawName?: string): string {
  if (!rawName) return '';
  let text = String(rawName).trim();
  if (!/[а-яё]/i.test(text)) return text;

  const cached = translateMemoCache.get(text);
  if (cached !== undefined) return cached;

  for (const [pattern, replacement] of PHRASE_TRANSLATIONS) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of WORD_TRANSLATIONS) {
    text = text.replace(pattern, replacement);
  }

  const res = text.replace(/\s{2,}/g, ' ').trim();
  if (translateMemoCache.size > 15000) translateMemoCache.clear();
  translateMemoCache.set(String(rawName).trim(), res);
  return res;
}

// Helper: Normalize any raw category string into one canonical Turkish name
export function normalizeCategoryName(rawCategory?: string, materialName?: string): string {
  const memoKey = `${rawCategory || ''}|||${materialName || ''}`;
  const memoHit = normalizeCatMemoCache.get(memoKey);
  if (memoHit !== undefined) return memoHit;

  const toTrLower = toTrLowerFast;
  const toAsciiLower = toAsciiLowerFast;

  const cleanRaw = (rawCategory || '').trim();
  const rawTr = toTrLower(cleanRaw);
  const rawAscii = toAsciiLower(cleanRaw);

  const isGenericCatchAll =
    !cleanRaw ||
    rawAscii === 'diger' ||
    rawAscii === 'diger malzeme' ||
    rawAscii === 'diger malzemeler' ||
    rawAscii === 'genel malzeme' ||
    rawAscii === 'genel' ||
    rawAscii === 'malzeme' ||
    rawTr === 'прочие материалы';

  // Strip Prizma administrative parenthetical notes like "(EXCEL DOSYASINE GORE ALINMALI)" and previous generic synthetic prefixes so they never pollute material classification!
  const cleanMatInput = (materialName || '')
    .replace(/\(\s*excel\s*dosyas[ıi]n[ae]\s*g[öo]re[^)]*\)/gi, ' ')
    .replace(/Канцелярские и Офисные Товары\s*\(([^()]+)\)/gi, '$1')
    .replace(/Строительно-монтажный материал\s*\/\s*ТМЦ\s*\(([^()]+)\)/gi, '$1')
    .replace(/Диск отрезной\s*\/\s*круг шлифовальный абразивный\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Хозяйственно-бытовое обеспечение офиса и площадки\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Розетка электрическая\s*\/\s*вилка силовая\s*\/\s*удлинитель\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Щит распределительный\s*\/\s*коробка монтажная\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Труба полипропиленовая\s*\/\s*ПВХ\s*\/\s*ПНД инженерная\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Оборудование стройплощадки,\s*мебель и бытовые модули\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Смесь сухая (?:ремонтная|штукатурная)\s*\/\s*(?:штукатурная|шпаклевка) строительная\s*(?:\([^)]*\))?\s*\[/gi, '[')
    .replace(/Гипсокартонный лист\s*\(ГКЛ\s*\/\s*ГКЛВ\)\s*(?:\([^)]*\))?\s*(?=[a-zа-яё])/gi, ' ')
    .trim();

  const matTr = toTrLower(cleanMatInput);
  const matAscii = toAsciiLower(cleanMatInput);

  const cacheAndReturn = (result: string): string => {
    if (normalizeCatMemoCache.size > 20000) normalizeCatMemoCache.clear();
    normalizeCatMemoCache.set(memoKey, result);
    return result;
  };

  // 1. Direct exact or alias match if NO material name is given
  if (!matTr && !isGenericCatchAll) {
    for (const cat of CANONICAL_CATEGORIES) {
      if (toAsciiLower(cat.nameTr.trim()) === rawAscii || toTrLower(cat.nameRu.trim()) === rawTr) {
        return cacheAndReturn(cat.nameTr);
      }
      for (const alias of cat.aliases) {
        if (toAsciiLower(alias.trim()) === rawAscii) {
          return cacheAndReturn(cat.nameTr);
        }
      }
    }
  }

  // Evaluate material rules strictly on materialName when present so invoice-level wrong rawCategory never pollutes item classification
  const evalTr = ` ${matTr || rawTr} `;
  const evalAscii = ` ${matAscii || rawAscii} `;

  const has = (kw: string): boolean => {
    let pair = kwAsciiCache.get(kw);
    if (!pair) {
      pair = { kTr: toTrLower(kw), kAscii: toAsciiLower(kw) };
      kwAsciiCache.set(kw, pair);
    }
    return evalTr.includes(pair.kTr) || (pair.kAscii !== pair.kTr && evalAscii.includes(pair.kAscii));
  };

  const hasRx = (rx: RegExp): boolean => rx.test(evalTr) || rx.test(evalAscii);

  const resultCategory = ((): string => {
  // 2. High-precision context-aware rule-based categorization

  // 2.1 Bilgi İşlem & IT (Exclude air freshener/gas/anchor/silicone/faucet cartridges, voltage monitoring relays, and wide-format plotter paper rolls!)
  const isNonItCartridge = hasRx(/oda\s*kokusu|air\s*wick|first\s*fresh|gaz\s*kartu|toua|ankraj|химанкер|хим\.\s*анкер|хим\s*анкер|kimyasal\s*dübel|kimyasal\s*dubel|hit-hy|hit-re|hilti|fischer|mungo|silikon|герметик|epoksi|эпоксид|mastik|мастик|filtre|аквафор|гейзер|барьер|pürmüz|горелк|смесител|керам.*картридж|кран|душ|batarya|musluk|респиратор|противогаз/i);
  const isVoltageMonitorRelay = hasRx(/gerilim\s*monit|реле\s*контрол|meandr|меандр|фаз/i);
  const isPlotterPaperRoll = hasRx(/бумага\s*широкоформатн|plotter\s*kağıd/i) || ((has('plotter') || has('плоттер')) && (has('бумага') || has('kağıd') || has('kağıt')) && !has('кассета') && !has('kaset'));
  if (
    !isVoltageMonitorRelay && !isPlotterPaperRoll && (
      has('bilgi işlem') || has('bilgisayar') || has('klavye') || has('клавиатур') ||
      has('yazıcı') || has('принтер') || has('мфу ') || has('plotter') || has('плоттер') || has('kyocera') ||
      has('televizyon') || has('телевизор') || has('ноутбук') || has('notebook') || has('laptop') ||
      has('thinkbook') || has('vivobook') || has('ekran temizleme') || has('digma') || has('logitech') ||
      has('canon lbp') || has('canon pfi') || has('tp-link') || has('d-link') || has('keenetic') ||
      has('mikrotik') || has('ubiquiti') || has('коммутатор') || has('маршрутизатор') || has('роутер') ||
      has('network switch') || has('poe switch') || has('gigabit switch') ||
      has('ram bellek') || has('оперативная память') || has('sistem blok') || has('системный блок') ||
      has('ssd ') || has(' ssd') || has('apacer') || has('kingston') || has('crucial') ||
      has('rj-45') || has('rj45') || has('патч-корд') || has('patch cord') ||
      has('displayport') || has('hdmi') || has('geforce') || has('ryzen') || has('intel core') ||
      has('термопленк') || has('fırın filmi') || has('тестер тоновой прозвонки сети') ||
      has('kesintisiz güç kaynağı') || has('источник бесперебойного питания') || hasRx(/\bибп\b|\bups\b.*(?:\d+\s*va|\d+\s*w|powercom|apc|ippon|cyberpower)/i) ||
      ((has('monitör') || has('монитор')) && !has('gerilim') && !has('реле')) ||
      (!isNonItCartridge && (has('toner') || has('тонер') || hasRx(/картридж|kartuş|pfi-\d+|tk-\d+|cf\d{3}|ce\d{3}/i)))
    )
  ) {
    return 'Bilgi İşlem & IT';
  }

  // 2.2 Temizlik & Hijyen Malzemeleri (Exclude wire brushes, paint brushes, carbon brushes, entrance grates, and torque wrenches!)
  const isTechnicalBrushOrTorque = hasRx(/металл|корщетк|проволоч|крацовк|зачистн|ушм|tel\s*fırça|çanak\s*fırça|saçak\s*fırça|burgu\s*fırça|угольн|графитов|электрощетк|kömür\s*fırça|karbon\s*fırça|малярн|радиаторн|макловиц|kestirme\s*fırça|boya\s*fırça|radyatör\s*fırça|badana\s*fırça|paspas\s*ızgarası|грязезащитн.*решетк|tork\s*anahtar|динамометрич|термопистолет|fon\s*makinas|отбойного\s*молотка|молотка\s*отбойного/i);
  const isSlakedLime = hasRx(/известь\s+гашеная|карбонатно-известков|sönmüş\s*kireç/i);
  if (
    !isTechnicalBrushOrTorque && !isSlakedLime && (
      has('deterjan') || has('порошок стиральн') || has('стиральный порошок') || has('tide ') || has('fairy') || has('bulaşık') || has('средство для мытья') || has('жидкость для мытья стекол') || has('cam temizleyici') ||
      has('oda kokusu') || has('освежитель воздуха') || has('air wick') || has('first fresh') ||
      has('cam ve ayna') || has('help sprey') ||
      has('kağıt havlu') || has('полотенца бумажн') || has('полотенце бумажн') || has('veiro') ||
      has('tuvalet kağıdı') || has('туалетная бумага') || has('бумага туалетная') ||
      has('ıslak mendil') || has('ıslak havlu') || has('влажные салфетк') || has('салфетки бумажн') || has('салфетки хозяйствен') ||
      has('klozet bloğu') || has('bref') || has('çamaşır suyu') || has('белизна') || has('domestos') || has('санокс') || has('средство для сантехники') || has('универсальное чистящее средство') ||
      has('klor tozu') || has('хлорная известь') || has('известь хлорная') || has('хлорные таблетк') || has('гипохлорит') ||
      (has('paspas') && !has('ızgara')) || has('швабр') || has('моп ') || has('насадка моп') || has('vileda') ||
      has('çamaşır kurutma') || has('сушилка для белья') ||
      has('süpürge') || has('метла') || has('совок для мусора') || has('faraş') ||
      has('щетка строительная') || has('черенок для щетки') || has('щетка для уборки') || has('щетка для пола') ||
      has('набор для уборки') || has('ершик') || has('ёршик') || has('ерш для') || has('tuvalet fırça') || has('klozet fırça') ||
      has('temizlik fırça') || has('fırça sert temizlik') || has('yer fırça') || has('saha temizlik fırça') ||
      has('fırça sapı') || has('araç yıkama fırça') || has('щетка для мытья авто') ||
      has('sabun') || has('мыло') || has('антисептик для рук') || has('dezenfektan') ||
      has('çöp kovası') || has('çöp poşeti') || has('çöp torbası') || has('мешки для мусора') || has('пакеты для мусора') ||
      has('çöp konteyner') || has('мусорный бак') || has('бак мусорный') || has('контейнер-бак мусорный') || has('контейнер для мусора') ||
      has('bulaşık süngeri') || has('губка хозяйствен') || has('губка для посуды') || has('губки абразивн') || has('temizlik bezi') || has('полотно техническое вафельное') || has('тряпка для пола')
    )
  ) {
    return 'Temizlik & Hijyen Malzemeleri';
  }

  // 2.3 Gıda & Mutfak Malzemeleri (Strictly exclude construction knives, machine blades, diamond cups, wire cup brushes, spatulas, electrical plugs, and plumbing water heaters!)
  const isConstructionBladeOrBoiler = hasRx(
    /кабел|kablo|maket|falçata|строительн|монтажн|secura|jokari|станок|станка|makina|makine|demir\s*kesme|арматур|рубанк|planya|testere|пильн|шпател|скребок|sıyırıcı|алмазн|шлифовальн|зачистн|корщетк|щетк|fırça|taşlama|elmas|диск|круг|коронк|panç|pürmüz|горелк|kaynak|сварочн|гипсокартон|alçıpan|kırıcı|matkap|водонагревател|termosifon|boyler|ballu|каучук|заземл|ip44|ip54|16а|32а/i
  );
  if (
    !isConstructionBladeOrBoiler && (
      hasRx(/(?:^|[^a-zа-яё])(?:çay|cay|чай)(?![a-zа-яё])/i) ||
      has('kahve') || has('кофе') || has('nescafe') ||
      has('şeker') || has('сахар') ||
      hasRx(/(?:^|[^a-zа-яё])(?:tuz|соль)\s*(?:пищев|поварен|экстра|1\s*кг|sofra)/i) ||
      has('bisküvi') || has('печенье') || has('pekarro') ||
      has('çikolata') || has('шоколад') || has('bounty') || has('mars minis') || has('snickers') || has('twix') ||
      has('su ısıtıcı') || has('kettle') || has('чайник') || has('scarlett') || has('самовар') || has('semaver') ||
      has('karton bardak') || has('kağıt bardak') || has('plastik bardak') || has('cam bardak') || has('kupa bardak') || has('чайная пара') || has('стакан бумажн') || has('стакан одноразов') || has('кружка ') || has('fincan') ||
      has('tabak') || has('тарелк') || has('бокс одноразовый') ||
      has('çatal') || has('kaşık') || has('вилка столов') || has('вилка одноразов') || has('ложка столов') || has('ложка чайн') || has('ложка одноразов') ||
      has('yemek bıçağı') || has('mutfak bıçağı') || has('нож столовый') || has('нож кухонный') ||
      has('şekerlik') || has('tepsi') || has('saklama kabı') || has('органайзер для кухни') || has('контейнер пэт') || has('şeffaf pet kap') || has('ekmek sepeti') ||
      has('doğrama tezgahı') || has('mutfak tezgahı') || has('стол разделочный') || has('стол производственный') || has('luxstahl') || has('assum') || has('kobor') ||
      has('buzdolabı') || has('холодильник') || has('mikrodalga') || has('микроволнов') ||
      has('su sebili') || has('кулер для воды') || has('damacana pompası') || has('помпа механическая') || has('içme suyu') || has('вода питьевая') ||
      has('плитка электрическая') || has('elektrikli ocak')
    )
  ) {
    return 'Gıda & Mutfak Malzemeleri';
  }

  // 2.4 Tabela, Yönlendirme & Reklam (Never match bare 'levha' which is used for rockwool/gypsum/steel sheets!)
  if (
    has('yönlendirme') || has('daire no') || has('daire numara') || has('kat numara') ||
    has('nest-') || has('нэст-') || has('dream riva') || has('asansör üzeri') ||
    has('merdiven levha') || has('posta kutu') || has('tabela') ||
    has('uyarı levha') || has('ikaz levha') || has('güvenlik levha') || has('iş güvenliği levha') ||
    has('знак безопасности') || has('табличка информац') || has('стенд информац') || has('плакат по охране') ||
    has('piktogram') || has('ikonu') || has('harfleri seti') || has('yön okları') || has('otopark yönlendirme') ||
    has('blok/bina ismi') || has('sadece personel') || has('stuff only') ||
    has('bina isimli') || has('kat panelinde') || has('bina ismi') || has('постер план') || has('plan posteri')
  ) {
    return 'Tabela, Yönlendirme & Reklam';
  }

  // 2.5 Ölçüm, Harita & Saha Ekipmanları (Include two-way radios, spirit levels, laser levels, tape measures, concrete cube molds; exclude printer toners and safety vests!)
  const isPrinterOrToner = hasRx(/картридж|принтер|мфу|toner|yazıcı|plotter/i);
  const isVestOrFloodlight = hasRx(/жилет|yelek|спецодежд|elbise|mont|прожектор|projektör|светильник|armatür/i);
  if (
    !isPrinterOrToner && !isVestOrFloodlight && (
      has('taheometre') || has('tacheometer') || has('total station') || has('тахеометр') ||
      has('leica') || has('nivo') || has('нивелир') || has('teodolit') || has('теодолит') ||
      has('statif') || has('sehpa / statif') || has('штатив') || has('jalon') || has('веха') || has('рейка нивелирн') ||
      has('reflektör prizma') || has('prizma reflektör') || has('отражатель геодез') || has('yansıtıcı marka') || has('рефлекторная марка') ||
      has('su terazisi') || has('terazi') || has('уровень строительн') || has('уровень алюминиев') || has('уровень магнитн') || has('уровень пузырьков') || has('лазерный уровень') || has('lazer şakul') || has('lazer ayaklı') || has('bosch gll') || has('весы ') ||
      has('şerit metre') || has('çelik metre') || has('рулетка') || has('lazer metre') || has('дальномер') ||
      has('kumpas') || has('штангенциркуль') || has('микрометр') || has('угломер') || has('gönye') || has('угольник строительн') ||
      has('dedektör') || has('детектор') || has('трассоискатель') || has('kablo bulucu') || has('multimetre') ||
      has('пирометр') || has('термогигрометр') || has('анемометр') || has('склерометр') || has('толщиномер') || has('testo') ||
      has('geb364') || has('gmp111') || has('nedo') || has('rgk ') || has('alco-screen') || has('alkol test') || has('алкотестер') ||
      has('lazer işaretçi') || has('лазерная указка') || has('yeşil lazer') ||
      has('slamp takımı') || has('форма стальная') || has('3 фк') ||
      has('telsiz') || has('рация') || has('радиостанц') || has('turbosky') || has('retekess') || has('baofeng')
    )
  ) {
    return 'Ölçüm, Harita & Saha Ekipmanları';
  }

  // 2.6 Şantiye Mobilya & Yaşam Donanımı (Exclude fire blankets and rockwool blanket insulation!)
  const isRockwoolOrFireBlanket = hasRx(/yangın|пожарн|taşyünü|tasyunu|cam\s*yünü|cam\s*yunu|izolasyon|yalıtım|утеплител|минват|базальт|yorgan\s*tipi/i);
  if (
    !isRockwoolOrFireBlanket && (
      has('ranza') || has('кровать') || has('yatak') || has('матрас') || has('yastık') || has('подушк') ||
      has('yorgan') || has('одеял') || has('nevresim') || has('постельн') || has('battaniye') || has('плед') ||
      has('soyunma dolabı') || has('elbise dolabı') || has('шкаф для одежд') || has('шкаф гардеробн') || has('шкаф металлический') || has('шкаф хозяйствен') ||
      has('ayakkabılık') || has('обувниц') || has('askılık') || has('вешалк') ||
      has('raf ünitesi') || has('raf çerçevesi') || has('raf kirişi') || has('raf tablası') || has('стеллаж') ||
      has('erzak dolabı') || has('ofis masası') || has('çalışma masası') || has('masa ofis') || has('стол офисн') || has('стол письменн') || has('стол riva') || has('стол easy one') || has('стол журнальн') || has('orta sehpa') ||
      has('ofis koltuğu') || has('ofis sandalyesi') || has('çalışma koltuğu') || has('sandalye ofis') || has('кресло офисн') || has('кресло тп') || has('стул офисн') || has('стул iso') || has('стул исо') || has('стул изо') || has('echair') ||
      has('скамья') || has('met bank') || has('şemsiye') || has('зонт ') || has('зонтик') || has('зонт-трость') ||
      has('ширма медицинская') || has('muayene paravanı') || has('revir dolabı') || has('ecza dolabı')
    )
  ) {
    return 'Şantiye Mobilya & Yaşam Donanımı';
  }

  // 2.7 Şantiye Tesis & Konteyner (Exclude screws/bits in plastic containers "в контейнере", PET food containers, medical tourniquets, crane baskets, and waste bins!)
  const isSmallContainerOrBin = hasRx(/в\s+контейнере|контейнер\s+пэт|контейнер-бак|мусор|çöp|120\s*л|240\s*л|1100\s*л|gıda|пищев|винт|саморез|болт|бита|kanama|revir|vitalfarm|ilk\s*yardım|перемещения\s*груза|taşıma\s*sepeti|tasima\s*sepeti/i);
  if (
    !isSmallContainerOrBin && (
      has('konteyner') || has('контейнер') || has('бытовк') ||
      has('tuvalet kabini') || has('туалетная кабин') || has('yaşam konteyneri') || has('blok konteyner') ||
      has('şantiye konteyneri') || has('mobil akaryakıt') || has('propan tüpü taşıma ve depolama kafesi') ||
      has('turnike') || has('турникет') || has('шлагбаум')
    )
  ) {
    return 'Şantiye Tesis & Konteyner';
  }

  // 2.8 Araç & İş Makinesi Ekipmanları
  if (
    has('oto lastik') || has('oto lastiği') || has('lastik tamiri') || has('автошина') || (has('lastik') && (has('r16') || has('r17') || has('r20') || has('r22') || has('continental') || has('yokohama') || has('kama') || has('cordiant'))) ||
    (has('filtre') && (has('hengst') || has('mann') || has('fleetguard') || has('yakıt') || has('yağ') || has('hava') || has('isımak'))) ||
    has('фильтр топливный') || has('фильтр масляный') || has('фильтр воздушный') ||
    has('kompresör') || has('компрессор') ||
    has('jeneratör') || has('генератор') ||
    has('master isımak') || has('isımak') || has('тепловая пушка') || has('воздухонагреватель') ||
    has('dizel yakıt') || has('дизельное топливо') || has('mazot') || has('резервуар ргсн') ||
    has('hidrolik yağ') || has('гидравлическое масло') || has('motor yağı') || has('моторное масло') || has('diesel extra') || has('icepro g-11') ||
    has('cam suyu') || has('стеклоомывающ') || has('незамерзайк')
  ) {
    return 'Araç & İş Makinesi Ekipmanları';
  }

  // 2.9 İç Mekan, Zemin & Kapı / Doğrama
  if (
    has('межкомнатная') || has('дверь') || has('дверная') || has('дверной блок') || has('коробка дверная') || has('наличник') ||
    has('jaluzi') || has('жалюзи') || has('oda kapısı') || has('çelik kapı') || has('yangın kapısı') || has('pervaz') ||
    has('paspas ızgarası') || has('грязезащитн') || has('parke taşı') || has('брусчатк') || has('брксчатк') || has('тротуарная плитка') ||
    has('bordür') || has('бордюр') || has('люк под покраску') || has('люк ревизионн') || has('müdahale kapağı') || has('петли по стороне') ||
    has('asma tavan') || has('армстронг') || has('грильято') || has('süpürgelik') || has('плинтус') || (has('линолеум') && !has('клей')) || (has('linolyum') && !has('yapıştırıcı')) || has('ламинат')
  ) {
    return 'İç Mekan, Zemin & Kapı / Doğrama';
  }

  // 2.10 Ankraj Sistemleri
  if (
    has('ankraj') || has('анкер') || has('химанкер') || has('kimyasal dübel') || has('kimyasal dubel') ||
    has('fischer faz') || has('fischer fis') || has('fis v') || has('fis sb') || has('fis em') ||
    has('hilti hit') || has('hit-hy') || has('hit-re') || has('hilti hst') || has('hilti hda') || has('hilti hsa') ||
    has('kimyasal ankraj') || has('himtex') || has('elementa ear') || has('erx 585') || has('mungo m2')
  ) {
    return 'Ankraj Sistemleri';
  }

  // 2.11 Donatı & El Aleti Aksesuarları -> Sarf Malzeme & Hırdavat / El Aletleri
  if (
    has('колпачок') || has('грибок') ||
    has('güvenlik mantar') || has('koruyucu başlık') ||
    has('güvenlik başlığı') || has('kolpaçok') ||
    has('щетка по металлу') || has('tel fırça') || has('çanak fırça') || has('çanak tipi') || has('корщетк') ||
    has('zımpara') || has('наждачная бумага') || has('бумага шлифовальная') || has('круг лепестков') || has('flap disk')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }
  if (
    has('крючок для вязки') || has('пистолет для вязки') ||
    has('ножницы для арматур') || has('станок для гибки') || has('станок для резки арматур') || has('станок гибочн') || has('станок рубочн') ||
    has('клещи вязальные') || has('kesme makas') || has('bükme aparat') || has('demir kesme makina') || has('demir bükme makine') || has('demir kesme makine') ||
    has('угольных щеток') || has('щетки графитовые') || has('щетка графитовая') ||
    has('grafit fırça') || has('kömür fırça') || has('karbon kömür fırça')
  ) {
    return 'El Aletleri & Hırdavat';
  }

  // 2.12 Donatı Malzemeleri (Paspayı, Rebar Coupler Manşon, Çiroz, Bağ Teli, Rebar Cages, Peikko - run BEFORE KKD so "MUFTA KONIK" never hits 'koni'!)
  const isPlumbingOrElecCoupling = hasRx(/кабел|kablo|ппр|ppr|пнд|pvc|пвх|канализац|сантех|чугун|ду\s*\d|dn\s*\d|1\s*1\/4|isimak|ısımak|компрессор|сварочн|диэлектрич|полипропилен|водопровод/i);
  const isNonRebarFrame = hasRx(/носилк|sedye|стул|sandalye|кресл|стеллаж|raf|потолок|tavan|палатк|çadır|тент|гипсокартон|alçıpan/i);
  if (
    !isPlumbingOrElecCoupling && !isNonRebarFrame && (
      has('donatı manşon') || has('geçiş donatı manşon') || has('geçişli donatı manşon') || has('муфта арматур') || has('муфта резьбов') || has('ванночка') || has('скоба-накладка') ||
      ((has('муфта') || has('manşon') || has('mufta')) && hasRx(/арматур|donatı|nervür|[aа]12\b|[pр]13\b|[pр]14\b|[dд]14\b|konik|коническ|резьб|\bd\s*=\s*(?:12|14|16|18|20|22|25|28|32|36|40)|\bq\s*(?:12|14|16|18|20|22|25|28|32|36|40)/i)) ||
      has('каркас арматур') || has('каркас кр-') || has('каркас кп-') || has('karkas metal kp') || has('donatı kafes') || has('donatı karkas') || has('donatı iskelet') || has('peikko') ||
      has('paspay') || has('паспой') || has('фиксатор арматур') || has('фиксатор защитн') || has('фиксатор звездочк') || has('фиксатор стульчик') || has('фиксатор стойк') || has('фиксатор конус') || has('фиксатор настил') || has('фиксатор напольн') ||
      has('çiroz') || has('yaylı çiroz') || has('зажим пружинный') ||
      has('bağ teli') || has('tavlı tel') || has('tavlı donatı') || has('проволока вязальная') || has('вязальная проволока') ||
      has('donatı sehp') || has('лягушк') || has('скоба крепежная двухлапков')
    )
  ) {
    return 'Donatı Malzemeleri';
  }

  // 2.13 İnşaat Demiri (Exclude plumbing/sanitary valves "запорная/сливная арматура")
  if (
    (has('арматур') || has('inşaat demir') || has('nervürlü demir') || has('demir nervürlü') || has('a500c') || has('а500с') || has('a240') || has('а240') || has('пруток арматур')) &&
    !has('запорн') && !has('сливн') && !has('трубопроводн') && !has('сантех') && !has('шаров') && !has('кран ') && !has('vana') && !has('valf') &&
    !has('фиксатор') && !has('сетка') && !has('file') && !has('hasır') &&
    !has('çelik mapa') && !has('закладн') && !has('муфта') && !has('manşon') && !has('ванночка') && !has('скоба') &&
    !has('колпачок') && !has('грибок') && !has('станок') && !has('ножниц') && !has('крючок') && !has('пистолет') && !has('bıçak') && !has('нож')
  ) {
    return 'İnşaat Demiri';
  }

  // 2.14 İş Güvenliği & KKD (Must run before Naylon/Yalıtım so nylon gloves and boot liners are KKD; exclude heat-shrink cable boots, power tools, and lifting slings!)
  const isHeatShrinkOrPowerTool = has('термоусаживаем') || has('термоусадочн') || has('кабельн') || hasRx(/пила\s+циркулярн|пила\s+дисков|дисковая\s+пила|daire\s+testere|перфоратор|ушм|болгарк|шуруповерт|зажим\s+троса|зажим\s+для\s+стальных\s+канатов/i);
  const isLiftingSling = hasRx(/строп\s*(?:текстильн|канатн|цепн)|чалки|bez\s*sapan|çelik\s*sapan|zincir\s*sapan|sapan\s*çelik|sapan\s*bez|\bстп\b|\b4ск\b|\b2ск\b|\b1ск\b/i);
  if (
    !isHeatShrinkOrPowerTool && !isLiftingSling && (
      has('iş elbisesi') || has('iş kıyafeti') || has('спецодежд') || has('костюм рабоч') || has('куртка утеплен') || has('iş montu') || has('kışlık mont') || has('iş pantolonu') || has('tulum') || has('yağmurluk') || has('дождевик') ||
      has('reflektörlü yelek') || has('ikaz yeleği') || has('жилет сигнальн') || has('жилет светоотражающ') ||
      has('перчатк') || has('iş eldiveni') || has('koruyucu eldiven') || has('eldiven') || has('краги спилков') || has('рукавиц') ||
      has('baret') || has('каска') || has('подшлемник') || has('наколенник') || has('dizlik') ||
      has('iş ayakkabısı') || has('iş botu') || has('iş çizmesi') || has('ботинк') || has('сапог') || has('полуботинк') || has('сабо эва') || has('sabo terlik') || has('утеплитель нтп') || has('утеплитель в сапог') || has('çizme içliği') ||
      has('koruyucu gözlük') || has('очки защитн') || has('siperlik') || has('щиток защитн') || has('toz maskesi') || has('респиратор') || has('kulaklık') || has('наушники противошум') || has('беруши') ||
      has('kkd') || has('isg') || has('сиз ') ||
      has('манекен') || has('emniyet kemeri') || has('привязь') || has('строп страховочн') || has('строп веревочн') || has('двойной веревочный строп') || has('yaşam hattı') || has('güvenlik ağı') || has('сетка защитно-улавливающ') || has('кронштейн зус') || has('zus braket') || has('emniyet karabina') ||
      has('yangın tüpü') || has('огнетушител') || has('yangın battaniyesi') || has('battaniye yangın') || has('кошма противопожарн') || has('пожарный щит') ||
      has('ilk yardım') || has('аптечк') || has('kanama durdurucu') || has('revir') || has('vitalfarm') || has('носилки') || has('sedye') || has('emniyet şeridi') || has('лента сигнальн') || has('trafik konisi') || has('yol konisi') || has('конус дорожн')
    )
  ) {
    return 'İş Güvenliği & KKD';
  }

  // 2.15 Elektrik & Otomasyon (Exclude welding cables/holders, soldering irons, hot-air guns, wireless mice/keyboards, and rust converters!)
  const isWeldingOrToolOrChem = hasRx(/сварочн|kaynak|электрододержател|клемма заземления сварочн|паяльник|havya|строительный фен|термопистолет|преобразователь\s*ржавчин|pas\s*sökücü|ножницы\s*секторн|набор\s*индикаторн.*отверт|насадка\s*для\s*скрутки/i);
  if (
    !isWeldingOrToolOrChem && (
      has('труба для кабел') || has('kablo borusu') || has('гофра') || (has('koruge') && !has('канализац') && !has('дренаж')) ||
      has('изолента') || has('izole bant') || has('термоусаживаем') || has('термоусадочн') || has('makaron') ||
      has('mastermann') || has('montaj dolap') || has('elektrik pano') || has('щит распределительн') || has('щит освещен') || has('щит учетн') || has('щит монтажн') || has('щрн') || has('щрв') || has('щмп') ||
      has('клемма') || has('ваго') || has('wago') || has('klemens') || has('шины нулев') || has('шина заземлен') ||
      has('пугв') || has('пугп') || has('ппгнг') || has('вббшв') || has('вбшв') || has('аввг') || has('ввгнг') || has('пвс ') || has('кгтп') || has('сип-') || has('nyy ') || has('nya kablo') || has('ttr ') ||
      has('изолятор sm') || has('прожектор') || has('projektör') || has('susta kablo') || has('протяжка для кабел') ||
      has('elektrik') || has('otomasyon') || has('электрик') || has('sinyal güçlendirici') || has('усиления сотовой связи') ||
      ((has('kablo') && !has('kablosuz')) || has('кабель') || has('провод')) ||
      has('автоматический выключател') || has('выключатель автоматическ') || has('дифавтомат') || has(' узо ') || has('выключател') || has('розетк') || has('вилка силовая') || has('вилка электрич') || has('вилка каучуков') || has('однофазная вилка') || has('вилка 025') || has('удлинител') || has('seyyar uzatma') ||
      has('светильник') || has('armatür') || has('lamba') || has('ampul') || has('лампа светодиодн') || has('fener') || has('фонарь') ||
      has('sigorta') || has('şalter') || has('priz') || has('kontaktör') || has('пускатель') || has(' реле ') || has('фотореле') || has('gerilim monitörü') ||
      has('buat') || has('коробка распаячн') || has('коробка распределительн') || has('коробка ответвительн') || has('подрозетник') ||
      has('kablo tavası') || has('kablo kanalı') || has('лоток кабельный') || has('кабель-канал') ||
      has('kablo papucu') || has('kablo pabucu') || has('наконечник кабельн') || has('наконечник медн') || has('гильза кабельн') || has('муфта кабельн') || has('бирка кабельн') ||
      has('çivi tabancası boru sabitleme klipsi') || has('lehim teli') || has('припой') || has('паяльная паста')
    )
  ) {
    return 'Elektrik & Otomasyon';
  }

  // 2.16 Yalıtım & Alçıpan (Exclude drywall saw, drywall screws, boot liners, concrete curing compound "Тент", and packaging stretch film!)
  const isDrywallToolOrScrew = hasRx(/ножовка|пила|testere|bıçak|саморез|vida|болт|cıvata|civata|dübel|дюбель|миксер|шпатель|rulo|валик|диск|круг|сверло|коронка|фрез|rende|makas|утеплитель\s+нтп|утеплитель\s+в\s+сапог/i);
  const isCuringCompoundOrRetardant = hasRx(/пленкообразующ|синол|пропитк|огнебиозащит|kür\s*malzeme/i);
  if (
    !isDrywallToolOrScrew && !isCuringCompoundOrRetardant && (
      has('изоляция для труб') || has('boru yalıtımı') || has('энергофлекс') || has('energoflex') ||
      has('минват') || has('базальт') || has('утеплител') || has('техноникол') || has('технофас') || has('техноблок') || has('роклайт') || has('rockwool') || has('isover') || has('ursa') ||
      has('пеноплэкс') || has('penoplex') || has('пенопласт') || has('пенополистирол') ||
      has('гипсокартон') || has('гкл') || has('гклв') || has('гвл') || has('гсп ') || has('сапфир') || has('vetonit multicomfort') || has('ветонит мультикомфорт') || has('gyproc') ||
      has('профиль стоечный') || has('профиль направляющий') || has('профиль потолочный') || has('профиль строительный пс') || has('профиль строительный пн') || has('alçıpan profili') || has('alçıpan tavan') || has('knauf tavan') || has('tavan u profili') || has('tavan c profili') || has('подвес прямой') || has('соединитель краб') || has('для ua профиля') ||
      has('мембран') || has('пароизоляци') || has('гидроизоляци') || has('ветрозащит') || has('изоспан') || has('плантер') || has('planter') || has('sikaplan') || has('sika sealing tape') || has('лента уплотнительная') ||
      has('гидрошпонка') || has('waterstop') || has('su tutucu bant') || has('инъекционн') || has('enjeksiyon hortumu') || has('бентонитов') ||
      has('битум') || has('рубероид') || has('праймер битумн') || has('мастика битумн') || has('линокром') || has('техноэласт') || has('унифлекс') || has('биполь') || has('икопал') || has('icopal') || has('виллатекс') || has('villatex') ||
      has('taşyünü') || has('kaya yünü') || has('cam yünü') || has('alçıpan') ||
      has('eps ') || has('xps') || has('strafor') || has('köpük levha') ||
      has('yalıtım') || has('izolasyon') ||
      has('тент пвх') || has('тент строительн') || has('тент утеплен') || has('тент тарпаулин') || has('полог ') || has('тарпаулин') || has('tarpaulin') || has('branda') ||
      has('pvc fileli köşe profili') || has('pvc fileli damlalık') || has('угол перфорированный') || has('профиль-капельник') || has('sıva filesi') || has('сетка фасадн') || has('сетка штукатурн') || has('стеклосетк') ||
      ((has('naylon') || has('пленка полиэтилен') || has('плёнка полиэтилен') || has('пленка техническ')) &&
        !has('перчатк') && !has('eldiven') && !has('стрейч') && !has('streç') && !has('упаковочн') && !has('ambalaj') && !has('ламинирован'))
    )
  ) {
    return 'Yalıtım & Alçıpan';
  }

  // 2.17 Çelik Borular
  if (
    (has('труб') || has('boru') || has('kutu profil') || has('profil demir')) &&
    (has('сталь') || has('профильн') || has('электросварн') || has('водогазопроводн') || has('вгп') || has('бесшовн') || has('çelik') || has('kutu profil') || has('profil boru') || has('dikişli') || has('demir boru') || has('boru demir')) &&
    !has('ппр') && !has('ppr') && !has('пнд') && !has('канализаци') && !has('pvc') && !has('пвх') && !has('гофр') && !has('koruge') && !has('изоляц')
  ) {
    return 'Çelik Borular';
  }

  // 2.18 Tuğla, Gazbeton & Duvar Blokları (Exclude masonry drill bits, saw blades, and adhesives!)
  const isMasonryToolOrGlue = hasRx(/клей|yapıştırıcı|сверло|бур |диск|круг|пила|ножовка|testere|фреза|коронка|штроборез/i);
  if (
    !isMasonryToolOrGlue && (
      has('газобетон') || has('газоблок') || has('газосиликат') || has('poritep') ||
      has('bonolit') || has('ytong') || has('gazbeton') ||
      has('tuğla') || has('кирпич') ||
      has('керамзитобетон') || has('кбб') || has('перемычка железобетон') || has('перемычка брусков') || has('перемычка пб') ||
      has('keramzit beton blok') || has('keramzit beton bölme') || has('keramzit beton duvar') || has('bims') || has('duvar örgü filesi') ||
      (has('базальтовая') && has('сетка'))
    )
  ) {
    return 'Tuğla, Gazbeton & Duvar Blokları';
  }

  // 2.19 Kalıp & İskele Sistemleri (Run BEFORE Sarf Malzeme & Çelik so formwork tie-rods, wing nuts, props, scaffolding clamps are properly classified!)
  const isElectricalBoardOrShield = hasRx(/распределит|освещен|учетн|монтажн|электро|пожарн|защитн|лицев|сварщ|щрн|щрв|щмп/i);
  const isShelvingOrLightStand = hasRx(/стеллаж|одежд|прожектор|светильник|нивелир|лазер|микрофон|серверн|гипсокартон|alçıpan/i);
  if (
    !isElectricalBoardOrShield && !isShelvingOrLightStand && (
      has('опалубк') || has('леса строительн') || has('леса рамн') || has('леса клинов') || has('лесов') ||
      has('фанер') || has('kontrplak') || has('plywood') || has('pleyvud') ||
      has('балка бдк') || has('балка двутавровая деревянная') || has('kiriş h20') || has('h20 ahşap') ||
      has('унивилк') || has('çatal başlık') || has('тренога для стойк') || has('kalıp direği') ||
      has('стойка телескопическ') || has('стойка объемн') || has('teleskopik direk') ||
      has('щит линейн') || has('щит универсальн') || has('щит углов') || has('щит шарнирн') ||
      has('kalıp') || has('iskele') || has('doka') || has('peri ') ||
      has('tayrot') || has('tie-rod') || has('tie rod') || has('tij ') || has('винт стяжной') || has('гайка стяжная') || has('стяжной болт') ||
      has('baumak') || has('горизонтальный элемент') || has('диагональный элемент') || has('вставка соединительная') ||
      has('каплок') || has('cuplock') || has('başlangıç ayağı') || has('домкрат винтовой') || has('башмак опорный') ||
      has('payanda') || has('подкос') || has('замок клиновой') || has('замок универсальный') || has('краб для опалубки') ||
      has('смазка для опалуб') || has('эмульсол') || has('kalıp ayırıcı')
    )
  ) {
    return 'Kalıp & İskele Sistemleri';
  }

  // 2.20 Çelik Malzemeler (Avoid matching Turkish verbs ending in '-lama' or words with 'sac' like 'saçak'!)
  if (
    !has('щетк') && !has('fırça') && !has('гипсокартон') && !has('alçıpan') && (
      has('уголок сталь') || has('уголок равнополочн') || has('уголок неравнополочн') || has('уголок г/к') || hasRx(/(?:уголок|угол)\s+\d+\s*[xх*×]\s*\d+/i) ||
      has('швеллер') || has('балка двутавров') || has('двутавр') ||
      has('köşebent') || has('silmeli lama') || has('çelik lama') || has('demir lama') || has('полоса сталь') || hasRx(/полоса\s+\d+\s*[xх*×]\s*\d+/i) ||
      has('hadde profil') || has('çelik profil') || has('çelik sac') || has('sac levha') || has('baklavalı sac') || has('galvaniz sac') || has('trapez sac') ||
      has('лист сталь') || has('лист г/к') || has('лист горячекатан') || has('лист х/к') || has('лист оцинк') || has('лист рифлен') || has('лист в пленке ral') || has('профнастил') || has('профлист') ||
      has('металлопрокат') || has('çelik kiriş') || has('ipe ') || has('hea ') || has('heb ') || has('upn ') ||
      has('filmaşin') || has('катанка') || has('kangal demir') || has('çelik şerit') || has('лента стальная') ||
      has('hasır çelik') || has('çelik hasır') || has('kaynaklı çelik hasır') || has('сетка сварная') || has('сетка арматурн') || has('сетка кладочн') || hasRx(/сетка\s+\d+\s*[xх*×]\s*\d+/i) ||
      has('u profil') || has('çelik mapa') || has('закладная деталь') || has('анкерная плита') || has('пластина стальная') || has('металлоконструкц') || has('металлические конструкции') || has('çelik konstrüksiyon') ||
      (has('duvar paneli') && has('çelik')) || (has('панель') && has('сталь'))
    )
  ) {
    return 'Çelik Malzemeler';
  }

  // 2.21 Ahşap & Kereste (Exclude office whiteboards, board markers/erasers, and wire rope clips!)
  const isOfficeBoardOrClip = hasRx(/yazı\s*tahta|beyaz\s*tahta|manyetik\s*tahta|tahta\s*silgi|tahta\s*kalem|маркерн.*доск|магнитн.*доск|доска\s*для\s*запис|гладильн.*доск|зажим.*канат|tahta\s*kalıp\s*kelepçesi|tahta\s*kaşık|саморез|vida\b/i);
  if (
    !isOfficeBoardOrClip && (
      has('доска обрезная') || has('доска необрезная') || has('доска строганная') || has('доска строительн') || has('пиломатериал') ||
      has('kereste') || has('kalas') || has('tahta') || has('lata') ||
      has(' брус ') || has('брусок') || has('osb') || has('осп-') || has('ahşap takoz') || has('ahşap kama')
    )
  ) {
    return 'Ahşap & Kereste';
  }

  // 2.22 Kimyasallar & Boya (Run BEFORE Hazır Beton so epoxy putty "Шпатлевка эпоксидная", primers "Бетоноконтакт / Ceresit CT 19", rust converters, and linoleum glue are properly classified!)
  const isPaintMachineOrTool = hasRx(/компрессор|kompresör|миксер|karıştırıcı\s*uç|краскопульт|boya\s*tabancası|пистолет\s*для\s*пены|köpük\s*tabancası|пистолет\s*для\s*герметик|silikon\s*tabancası|фен\s*строительн|термопистолет/i);
  const isCementitiousGroutOrMortar = hasRx(/grout|граут|akıcı\s*harç|tamir\s*harc|шпаклевк.*цемент|штукатурк.*цемент|стяжк|наливной\s*пол|tesviye\s*şap/i);
  if (
    !isPaintMachineOrTool && !isCementitiousGroutOrMortar && (
      has('boya') || has('краск') || has('эмаль') || has('пф-115') || has('pf-115') || has('лак ') || has('vernik') || has('холодного цинкован') ||
      has('грунтовк') || has('astar') || has('бетоноконтакт') || has('betonokontakt') || has('ceresit ct 17') || has('ceresit ct 19') ||
      has('герметик') || has('silikon') || has('mastik') || has('sikaflex') || has('sika ') ||
      has('пена монтажн') || has('poliüretan köpük') || has('montaj köpüğü') || has('очиститель пены') || has('köpük temizleyici') ||
      has('epoksi') || has('эпоксидн') || has('tiner') || has('растворител') || has('уайт-спирит') || has('white spirit') || has('ацетон') || has('aseton') || has('обезжиривател') ||
      has('преобразователь ржавчин') || has('pas sökücü') ||
      has('пластификатор') || has('противоморозн') || has('antifriz') || has('добавка в бетон') ||
      has('пленкообразующ') || has('kür malzemesi') || has('пропитка огнебиозащит') || has('антисептик для древесин') ||
      has('известь гашеная') || has('sönmüş kireç') || has('клей пва') || has('клей для линолеум') || has('linolyum yapıştırıcı') || has('жидкие гвозди') || has('жидкое стекло') ||
      has('кисть малярн') || has('кисть плоск') || has('кисть радиаторн') || has('макловиц') ||
      has('kestirme fırça') || has('radyatör fırça') || has('badana fırça') ||
      has('boya rulosu') || has('parmak boya rulosu') || has('rulo fırça') || has('rulo parmak') || has('валик малярн') || has('валик велюр') || has('валик полиакрил') || has('валик "искусственный мех"') || has('бюгель') || has('кювета малярн')
    )
  ) {
    return 'Kimyasallar & Boya';
  }

  // 2.23 Hazır Beton, Çimento & Agrega & Kuru Harç / Şap (Never match bare 'sap' or 'alçıpan' or screws/saws!)
  const isConcreteDrillOrScrewOrSaw = hasRx(/бур |сверло|диск|круг|алмазн|коронка|пика|зубило|keski|matkap|пила|testere|саморез|vida\b|болт|шпатель|spatula|бетоноконтакт|betonokontakt|бетоновод|бетоносмесител|harç\s*karma|гипсокартон|alçıpan/i);
  if (
    !isConcreteDrillOrScrewOrSaw && (
      has('бетон в') || has('бетон товарн') || has('grobeton') || has('hazır beton') ||
      has('çimento') || has('цемент') || has('portland') ||
      has('agrega') || has('щебень') || has('гравий') || has('mıcır') || has('çakıl') ||
      has('керамзит') || has('keramzit') || has('kumlu toprak') || has('dolgu malzemesi') ||
      ((has(' kum ') || has('песок')) && !has('kumaş') && !has('kumanda') && !has('kumlama') && !has('пескоструй')) ||
      has('сухая смесь') || has('сухие смеси') || has('сухая кладочная') || has('kuru karışım') || has('пескобетон') || has('стяжк') ||
      has('ротбанд') || has('rotband') || has('штукатурк') || has('шпаклевк') || has('шпатлевк') ||
      has('harç') || has('şap kumu') || has('şap harcı') || has('tesviye şapı') || has('hazır şap') || has('наливной пол') ||
      has('sıva') || has(' alçı ') || has('гипс строительн') || has('алебастр') ||
      has('kalekim') || has('клей плиточн') || has('клей для газобетон') || has('клей для пенополистирол') || has('клей для минват') ||
      has('seramik yapıştırıcı') || has('fayans yapıştırıcı') || has('gazbeton yapıştırıcı') || has('ısı yalıtım yapıştırıcı') ||
      has('затирка') || has('derz dolgu') || has('litochrom') || has('цпс') || has('grout') || has('planitop') || has('glims') || has('ceresit') || has('vetonit') || has('knauf sevener') || has('knauf kleben')
    )
  ) {
    return 'Hazır Beton, Çimento & Agrega';
  }

  // 2.24 Kaynak Malzemeleri
  if (
    has('электрод') || has('elektrod') || has('elektrot') || has('askaynak') || has('esab') || has('lb-52u') || has('уони') ||
    has('kaynak makinesi') || has('kaynak teli') || has('kaynak pensesi') || has('kaynak maskesi') || has('kaynak kablosu') || has('kaynak örtüsü') ||
    has('сварочн') || has('сварка') || has('сварщик') || has('электрододержател') || has('клемма заземления') ||
    has('пропан') || has('propan') || has('кислород') || has('oksijen tüpü') || has('oksijen saati') || has('oksijen regülatör') || has('hamlaç') || has('hamlac') ||
    has('горелка газов') || has('горелка кровельн') || has('резак пропан') || has('pürmüz') || has('şaloma') || has('редуктор бпо') || has('редуктор бко')
  ) {
    return 'Kaynak Malzemeleri';
  }

  // 2.25 Mekanik & Tesisat (Plumbing, heating, ventilation, water/sewage pipes, valves, pumps, fire hoses/hydrants)
  if (
    has('mekanik') || has('tesisat') || has('сантехник') || has('отоплени') ||
    has('труба ппр') || has('труба полипропилен') || has('труба пнд') || has('труба канализац') || has('труба пвх') || has('труба гофрированная дренаж') || has('ppr boru') || has('pvc boru') || has('pnd boru') || has('kangal boru') ||
    has('радиатор биметалл') || has('радиатор алюмин') || has('радиатор стальн') || has('kalorifer') ||
    has('кран шаров') || has('кран полипропилен') || has('кран маевск') || has('задвижк') || has('клапан обратн') || has('вентиль') || has('запорная арматура') || has('трубопроводная арматура') || has('vana') || has('küresel vana') ||
    has('насос циркуляц') || has('насос дренаж') || has('насос фекальн') || has('насос скважин') || has('мотопомп') || has('pompa') || has('dalgıç pompa') || has('hidrofor') ||
    has('фитинг') || has('fittings') || has('муфта ппр') || has('муфта пнд') || has('муфта канализац') || has('муфта чугун') || has('муфта соединительная ст') || has('угольник ппр') || has('тройник ппр') || has('отвод канализац') || has('ревизия канализац') || has('компенсатор сильфон') ||
    has('havalandırma') || has('вентиляци') || has('воздуховод') || has('yuvarlak kanal') || has('вентилятор канальн') || has('анемостат') || has('решетка вентиляц') || has('ızgara metal') || has('klima') || has('кондиционер') ||
    has('valtec') || has('водонагревател') || has('termosifon') || has('boyler') || has('термосмесител') || has(' тэн ') || has('гидроаккумулятор') || has('расширительный бак') ||
    has('счетчик воды') || has('водосчетчик') || has('su sayacı') || has('манометр') || has('термометр биметалл') ||
    has('лен сантехнич') || has('фум-лент') || has('teflon bant') || has('keten') || has('уплотнительная нить') ||
    has('yangın hortumu') || has('пожарный рукав') || has('пожарный ствол') || has('пожарный кран') || has('головка соединительная гм') || has('yangın vanası') || has('yangın dolabı') || has('шкаф пожарный') ||
    has('yerden ısıtma') || has('теплого пола')
  ) {
    return 'Mekanik & Tesisat';
  }

  // 2.26 Seramik & Vitrifiye (Exclude ceramic drill bits, diamond blades, tile cutters, and tile adhesives!)
  const isCeramicToolOrGlue = hasRx(/диск|круг|сверло|коронка|плиткорез|клей|затирка|крестик|свп|клин|matkap|kesme|kesici|panç|yapıştırıcı|derz\s*dolgu|artısı/i);
  if (
    !isCeramicToolOrGlue && (
      has('seramik') || has('vitrifiye') || has('fayans') ||
      has('плитка керамическ') || has('плитка кафельн') || has('керамогранит') ||
      has('lavabo') || has('раковин') || has('умывальник') ||
      has('klozet') || has('унитаз') || has('инсталляци') || has('pisuvar taşı') || has('писсуар') ||
      has('batarya') || has('смесител') || has('duş seti') || has('душевая') || has('сифон для умывальник') || has('сифон для раковин') || has('гофра для унитаза') || has('арматура сливная') || has('estima')
    )
  ) {
    return 'Seramik & Vitrifiye';
  }

  // 2.27 Ofis & Kırtasiye (Exclude sandpaper, masking tape, drywall tape!)
  const isConstructionPaperOrTape = hasRx(/zımpara|наждачн|шлифовальн|kağıt\s*bant|maskeleme\s*bandı|малярн.*лент|серпянк|derz\s*bandı|изолента|izole\s*bant|уплотнительн|гидрошпонка|su\s*tutucu|стрейч|streç|tork|veiro|туалетн|полотенц/i);
  if (
    !isConstructionPaperOrTape && (
      has('kırtasiye') || has('канцтовар') || has('канцеляр') ||
      has('бумага офисн') || has('бумага для принтер') || has('бумага а4') || has('бумага а3') || has('бумага широкоформатн') || has('fotokopi kağıdı') || has('plotter kağıd') || has('a4 kağıt') || has('a3 kağıt') || has('sürekli form') || has('самокопирующ') ||
      has('папка') || has('klasör') || has('poşet dosya') || has('telli dosya') || has('sunum dosyası') || has('файлы-вкладыш') || has('разделители') || has('архивный короб') ||
      has('ручка шариков') || has('ручка гелев') || has('ручка-роллер') || has('tükenmez kalem') || has('jel kalem') || has('kurşun kalem') || has('карандаш чернографит') || has('fosforlu kalem') || has('текстовыделител') ||
      has('маркер перманент') || has('маркер для доск') || has('маркер текстовый') || has('tahta kalemi') || has('permanent kalem') ||
      has('yazı tahtası') || has('beyaz tahta') || has('доска магнитно-маркерн') || has('губка-стиратель') || has('tahta silgisi') ||
      has('степлер канцеляр') || has('скобы для степлера №') || has('delgeç') || has('дырокол') || has('скрепк') || has('ataş') || has('зажимы для бумаг') || has('кнопки силовые') ||
      has('блокнот') || has('тетрадь') || has('defter') || has('not kağıdı') || has('блок для записей') || has('стикеры') || has('post-it') ||
      has('ножницы офисн') || has('ножницы канцеляр') || has('клей-карандаш') || has('штрих-корректор') || has('корректирующ') ||
      has('калькулятор') || has('hesap makinesi') || has('пленка для ламинирован') || has('laminasyon') || has('ламинатор') || has('брошюровщик') || has('переплет') ||
      has('лоток для бумаг') || has('evrak rafı') || has('органайзер настольн') || has('корзина для бумаг') ||
      has('бейдж') || has('yaka kartı') || has('брелок для ключей') || has('ключница') || has('anahtarlık') ||
      has('комус') || has('attache') || has('диспенсер для скотча')
    )
  ) {
    return 'Ofis & Kırtasiye';
  }

  // 2.28 Sarf Malzeme & Hırdavat (Fasteners, self-drilling screws "саморез с буром", cutting/grinding discs, buckets, locks, hinges, rigging hardware, packaging films, tapes)
  if (
    has('саморез') || has('дюбель') || has('болт') || has('винт нержавеющ') || has('винт с потайн') || has('гайк') || has('шайб') || has('шпильк') || has('гвозд') || has('заклепк') ||
    has('vida') || has('samorez') || has('cıvata') || has('somun') || has('pul ') || has('rondela') || has('dübel') || has('çivi') || has('perçin') || has('saplama') ||
    has('диск отрезной') || has('круг отрезной') || has('диск зачистной') || has('круг зачистной') || has('kesici taş') || has('kesme taşı') || has('taşlama diski') || has('taşlama taşı') ||
    has('замок навесной') || has('замок врезной') || has('личинка замка') || has('цилиндровый механизм') || has('петля дверн') || has('петля приварн') || has('засов') || has('шпингалет') || has('доводчик дверн') || has('ручка дверн') ||
    has('kilit') || has('asma kilit') || has('menteşe') || has('kapı hidroliği') || has('kapı kolu') || has('sürgü') ||
    has('ведро строительн') || has('таз строительн') || has('емкость прямоугольн') || has('бадья') || has('тара металлическая') || has('kova') || has('harç kovası') || has('harç teknesi') ||
    has('канат стальной') || has('трос стальной') || has('цепь короткозвен') || has('цепь длиннозвен') || has('талреп') || has('зажим для троса') || has('зажим для стальных канатов') || has('коуш') || has('скоба такелажн') || has('карабин пожарн') || has('рым-болт') || has('рым-гайк') ||
    has('çelik halat') || has('zincir') || has('gerdirme') || has('klemens halat') || has('radansa') || has('kanca') || has('karabina') || has('aybolt') ||
    has('хомут кабельн') || has('стяжка кабельн') || has('kablo bağı') || has('cırt kelepçe') || has('хомут сантехнич') || has('boru kelepçesi') ||
    has('скотч малярн') || has('лента малярн') || has('maskeleme bandı') || has('kağıt bant') || has('лента армирован') || has('серпянк') ||
    has('koli bandı') || has('скотч прозрачн') || has('скотч упаковочн') ||
    has('стрейч') || has('streç film') || has('мешки полипропилен') || has('moloz çuvalı') || has('çuval') ||
    has('колесо для тачки') || has('колесо промышленн') || has('tekerlek')
  ) {
    return 'Sarf Malzeme & Hırdavat';
  }

  // 2.29 El Aletleri & Hırdavat (Power tools, hand tools, drill bits, diamond blades, saws, hammers, shovels, wheelbarrows, lifting slings)
  if (
    has('сверло') || has(' бур ') || has('бур по') || has('бур sds') || has('проломной бур') ||
    has(' бита ') || has(' биты ') || has('набор бит') || has('адаптер для бит') || has('бита крестов') || has('бита с торцев') ||
    has('франкфурт') || has('чашка алмазн') || has('диск алмазн') || has('диск пильный') || has('полотно пильн') || has('полотно для сабельн') || has('пилка для лобзик') ||
    has('коронка биметалл') || has('коронка алмазн') || has('коронка по бетон') || has('коронка по металл') || has('коронка для металл') || has('коронка по стал') || has('коронка универсальн') || has('panç') ||
    has('молоток') || has('кувалд') || has('киянка') || has('çekiç') || has('balyoz') || has('keser') || has('черенок для молотка') || has('черенок для кувалд') || has('черенок для лопат') || has('kürek sapı') || has('balyoz sapı') || has('çekiç sapı') || has('sap kazma') ||
    has('лопата') || has('kürek') || has('kazma') || has('кирка') || has('лом строительн') || has('лом гвоздодер') || has('лом универсальн') || has('гвоздодер') || has('manivela') || has('sökü demiri') ||
    has('matkap') || has('перфоратор') || has('дрель') || has('шуруповерт') || has('винтоверт') || has('гайковерт') ||
    has('ушм') || has('болгарк') || has('шлифмашин') || has('taşlama makinesi') || has('avuç taşlama') || has('taş motoru') ||
    has('отбойный молоток') || has('kırıcı') || has('зубило') || has(' пика ') || has('keski') ||
    has('пила циркулярн') || has('пила торцовочн') || has('пила сабельн') || has('электролобзик') || has('ножовка') || has('testere') || has('daire testere') || has('dekupaj') ||
    has('строительный фен') || has('фен техническ') || has('термопистолет') || has('fon makinası') || has('sıcak hava tabancası') || has('паяльник') || has('havya') || has('аппарат для сварки полипропилен') ||
    has('миксер строительн') || has('миксер для красок') || has('насадка-миксер') || has('венчик для перемешиван') || has('karıştırıcı uç') ||
    has('ключ гаечн') || has('ключ комбинирован') || has('ключ разводн') || has('ключ трубн') || has('ключ имбусов') || has('ключ трещоточн') || has('ключ динамометрич') ||
    has('anahtar kombine') || has('tork anahtar') || has('t anahtar') || has('boru anahtarı') || has('kurbağacık') || has('allen') || has('alyans') || has('lokma') || has('торцевая головка') ||
    has('отвертк') || has('tornavida') || has('пассатижи') || has('плоскогубц') || has('бокорезы') || has('кусачки') || has('клещи') || has('pense') || has('kerpeten') || has('yan keski') || has('пресс гидравлический ручной') ||
    has('нож строительн') || has('нож сегментн') || has('лезвия для ножа') || has('лезвие для ножа') || has('maket bıçağı') || has('maket bıçağına') || has('falçata') || has('ножницы по металлу') || has('sac makası') || has('sac kesme makası') || has('болторез') || has('demir makası') ||
    has('пистолет для пены') || has('пистолет для герметик') || has('köpük tabancası') || has('silikon tabancası') || has('заклепочник') || has('perçin tabancası') || has('степлер строительн') || has('zımba tabancası') ||
    has('шпатель') || has('гладилка') || has('кельма') || has('терка строительн') || has('правило трапециевидн') || has('правило алюмин') || has('spatula') || has('mastar') || hasRx(/(?:^|[^a-zа-яёğüşıöç])mala(?:sı|lar)?(?![a-zа-яёğüşıöç])/i) ||
    has('тачка строительн') || has('тележка') || has('el arabası') || has('japon arabası') ||
    has('лестница') || has('стремянк') || has('merdiven') ||
    has('строп текстильн') || has('строп канатн') || has('строп цепн') || has('чалки') || has('bez sapan') || has('çelik sapan') || has('zincir sapan') || has('лебедк') || has('таль ручн') || has('домкрат гидравлич')
  ) {
    return 'El Aletleri & Hırdavat';
  }

  // 2.30 Hizmet & Lojistik -> Araç & İş Makinesi Ekipmanları
  if (
    has('lojistik') || has('nakliye') ||
    has('доставк') || has('перевозк') || has('услуг') ||
    has('sevkiyat') || has('vinç kiralama') || has('аренда кран') || has('аренда манипулятор')
  ) {
    return 'Araç & İş Makinesi Ekipmanları';
  }

  // 3. Keyword matching based on materialName against CANONICAL_CATEGORIES
  if (matTr) {
    for (const cat of CANONICAL_CATEGORIES) {
      for (const kw of cat.keywords) {
        if (has(kw)) {
          return cat.nameTr;
        }
      }
    }
  }

  // 4. Fallback alias match on rawCategory ONLY if materialName didn't match any material rule
  if (cleanRaw && !isGenericCatchAll) {
    for (const cat of CANONICAL_CATEGORIES) {
      if (toAsciiLower(cat.nameTr.trim()) === rawAscii || toTrLower(cat.nameRu.trim()) === rawTr) {
        return cat.nameTr;
      }
      for (const alias of cat.aliases) {
        if (toAsciiLower(alias.trim()) === rawAscii) {
          return cat.nameTr;
        }
      }
    }
  }

  return 'Sarf Malzeme & Hırdavat';
  })();
  return cacheAndReturn(resultCategory);
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

const TR_TO_RU_TECH_DICT: Array<[RegExp, string]> = [
  [/\byazı\s*tahtas|\bbeyaz\s*tahta\b|\btahta\s*silgi/i, 'Доска магнитно-маркерная офисная / аксессуары'],
  [/\bsu\s*terazi|\bterazi\b|\bşerit\s*metre|\bserit\s*metre|\blazer\b|\bnivo\b/i, 'Рулетка измерительная / уровень строительный'],
  [/\bkombine\s*anahtar|\banahtar\s*kombine|\btork\s*anahtar|\bt\s*anahtar|\ballen\s*anahtar|\bboru\s*anahtar|\blokma\b|\bcırcır\b|\bcircir\b/i, 'Ключ гаечный комбинированный / слесарный инструмент'],
  [/\bkereste\b|\bçam\b|\btahta\b|\bkalas\b/i, 'Пиломатериал обрезной (брус / доска) ГОСТ 8486'],
  [/\bosb\b/i, 'Плита ориентированно-стружечная ОСП-3 (OSB-3)'],
  [/\bbeton\b|\bgrobeton\b/i, 'Бетон товарный БСГ ГОСТ 7473'],
  [/\bçimento\b|\bcimento\b/i, 'Цемент портландцемент ЦЕМ I 42,5Н (М500)'],
  [/\bkum\b/i, 'Песок строительный карьерный / мытый'],
  [/\bmıcır\b|\bmicir\b|\bçakıl\b|\bcakil\b/i, 'Щебень гранитный / гравийный фракционный'],
  [/\btuğla\b|\btugla\b/i, 'Кирпич строительный полнотелый / пустотелый'],
  [/\btamir harcı\b|\btamir harci\b|\balçı\b|\balci\b|\bsıva\b|\bsiva\b/i, 'Смесь сухая ремонтная / штукатурная строительная'],
  [/\byapıştırıcı\b|\byapistirici\b|\bfayans\b|\bseramik\b/i, 'Клей плиточный цементный усиленный'],
  [/\bastar\b|\bbetonokontakt\b/i, 'Грунтовка строительная глубокого проникновения / Бетоноконтакт'],
  [/\btiner\b|\bsolvent\b|\bwhite spirit\b/i, 'Растворитель технический (Уайт-спирит / 646)'],
  [/\bboya\b/i, 'Краска строительная водно-дисперсионная / эмаль'],
  [/\brulo\b/i, 'Валик малярный строительный'],
  [/\bspatula\b|\bispula\b/i, 'Шпатель малярный из нержавеющей стали'],
  [/\bmala\b/i, 'Кельма / гладилка штукатурная'],
  [/\bsilikon\b|\bmastik\b|\bakrilik\b/i, 'Герметик силиконовый / акриловый строительный'],
  [/\bköpük\b|\bkopuk\b/i, 'Пена монтажная полиуретановая профессиональная'],
  [/\bmembran\b|\bbitüm\b|\bbitum\b|\bizolasyon\b|\byalıtım\b|\byalitim\b/i, 'Гидроизоляция рулонная наплавляемая / мембрана'],
  [/\byangın\s*hortum|\byangin\s*hortum/i, 'Рукав пожарный напорный с головками'],
  [/\byangın\s*vana|\byangin\s*vana/i, 'Клапан (вентиль) пожарный запорный'],
  [/\bboru\b|\bppr\b|\bpvc\b|\bkoruge\b|\bpnd\b/i, 'Труба полипропиленовая / ПВХ / ПНД инженерная'],
  [/\bvana\b|\bvalf\b|\bmusluk\b|\bbatarya\b/i, 'Кран шаровой латунный / запорная арматура'],
  [/\bdirsek\b|\bmanşon\b|\bmanson\b|\bte\b|\brekor\b|\bnipel\b|\bfitting\b/i, 'Фитинг соединительный (муфта / отвод / тройник)'],
  [/\bkelepçe\b|\bkelepce\b/i, 'Хомут трубный стальной с резиновым уплотнителем'],
  [/\bconta\b/i, 'Прокладка уплотнительная сантехническая'],
  [/\bsigorta\b|\botomat\b|\bşalter\b|\bsalter\b|\bkaçak akım\b|\bkacak akim\b/i, 'Выключатель автоматический модульный / УЗО'],
  [/\bpano\b|\bkutu\b|\bbuat\b/i, 'Щит распределительный / коробка монтажная'],
  [/\bpriz\b|\belektrik\s*anahtar|\bfiş\b|\bfis\b|\buzatma\b/i, 'Розетка электрическая / вилка силовая / удлинитель'],
  [/\blamba\b|\bprojektör\b|\bprojektor\b|\barmatür\b|\barmatur\b|\bled\b|\bampul\b|\bfener\b/i, 'Светильник светодиодный строительный / прожектор LED'],
  [/\bmatkap\b|\bdelici\b|\bkırıcı\b|\bkirici\b|\btaşlama\b|\btaslama\b|\bspiral\b/i, 'Электроинструмент / оснастка (бур SDS-Plus / сверло / УШМ)'],
  [/\bdisk\b|\bkesici\s*taş|\bkesici\s*tas|\bkesme\s*taş|\bkesme\s*tas|\bzımpara\b|\bzimpara\b/i, 'Диск отрезной / круг шлифовальный абразивный'],
  [/\btestere\b|\bbıçak\b|\bbicak\b|\bmisina\b/i, 'Полотно пильное / диск пильный / нож строительный'],
  [/\bçekiç\b|\bcekic\b|\bkeser\b|\balyans\b|\btornavida\b|\bpense\b|\bkerpeten\b|\banahtar\b/i, 'Инструмент слесарно-монтажный ручной'],
  [/\bkürek\b|\bkurek\b|\bkazma\b|\bbalyoz\b|\bmanivela\b|\bel arabası\b|\bel arabasi\b/i, 'Инвентарь строительный (лопата / кувалда / тачка строительная)'],
  [/\bkova\b|\bvaril\b|\bbidon\b|\bleğen\b|\blegen\b/i, 'Емкость / ведро строительное ударопрочное'],
  [/\bmetre\b|\bşerit\b|\bserit\b/i, 'Рулетка измерительная / уровень строительный'],
  [/\bdübel\b|\bdubel\b/i, 'Дюбель строительный распорный / фасадный'],
  [/\bvida\b|\bsamorez\b/i, 'Саморезы строительные оцинкованные'],
  [/\bçivi\b|\bcivi\b/i, 'Гвозди строительные / монтажные'],
  [/\bkilit\b|\bmenteşe\b|\bmentese\b|\bkapı\b|\bkapi\b|\bpencere\b|\bkol\b/i, 'Фурнитура дверная / замок навесной / петли стальные'],
  [/\bhalat\b|\bsapan\b|\bzincir\b|\bkanca\b|\bmapa\b|\bgerdirme\b/i, 'Строп грузоподъемный / канат стальной / такелаж'],
  [/\biskele\b|\bkalıp\b|\bkalip\b|\btij\b|\bpayanda\b|\bkriko\b|\bkamalı\b|\bbaşlangıç\s*ayağ|\bbaslangic\s*ayag/i, 'Комплектующие опалубки и строительных лесов'],
  [/\byelek\b|\breflektör\b|\breflektor\b/i, 'Жилет сигнальный светоотражающий ГОСТ'],
  [/\bayakkabı\b|\bayakkabi\b|\bbot\b|\bçizme\b|\bcizme\b/i, 'Спецобувь защитная рабочая с металлоподноском / сапоги'],
  [/\bmont\b|\bparka\b|\btulum\b|\bpantolon\b|\byağmurluk\b|\byagmurluk\b|\bkıyafet\b|\bkiyafet\b/i, 'Спецодежда рабочая защитная (костюм / куртка утепленная)'],
  [/\bgözlük\b|\bgozluk\b|\bmaske\b|\bsiperlik\b|\bkulaklık\b|\bkulaklik\b|\bemniyet kemeri\b/i, 'Средства индивидуальной защиты (СИЗ: очки / респиратор / привязь)'],
  [/\byangın\b|\byangin\b|\btüp\b|\btup\b/i, 'Огнетушитель порошковый (ОП) / противопожарный инвентарь'],
  [/\bklavye\b|\bmouse\b|\bfare\b|\bwebcam\b|\bmonitör\b|\bmonitor\b|\blogitech\b/i, 'Компьютерная периферия и оргтехника (клавиатура / мышь)'],
  [/\btoner\b|\bkartuş\b|\bkartus\b|\byazıcı\b|\byazici\b/i, 'Картридж лазерный / тонер для оргтехники'],
  [/\bkağıt\b|\bkagit\b|\ba4\b|\ba3\b|\bklasör\b|\bklasor\b|\bkalem\b|\bzımba\b|\bzimba\b|\bnot\b|\bpoşet\b|\bposet\b|\bzarf\b|\bdosya\b/i, 'Канцелярские товары и бумага офисная'],
  [/\btemizlik\b|\bdeterjan\b|\bsabun\b|\bçamaşır\b|\bcamasir\b|\bpeçete\b|\bpecete\b|\bhavlu\b|\bçöp\b|\bcop\b|\btorba\b|\bsüpürge\b|\bsupurge\b|\bpaspas\b|\bbez\b/i, 'Хозяйственные товары и средства профессиональной уборки'],
  [/\biçme\s*suyu|\bçay\b|\bcay\b|\bkahve\b|\bşeker\b|\bseker\b|\bbardak\b|\bgıda\b|\bgida\b/i, 'Хозяйственно-бытовое обеспечение офиса и площадки'],
  [/\bmazot\b|\bdizel\b|\byakıt\b|\byakit\b|\byağ\b|\byag\b|\bhidrolik\b|\bfilltre\b|\bfiltre\b|\bakü\b|\baku\b|\blastik\b|\bcam\s*suyu\b/i, 'ГСМ, дизельное топливо и расходные материалы для спецтехники'],
  [/\bkonteyner\b|\bkabin\b|\bturnike\b|\bçit\b|\bcit\b|\bbariyer\b|\btabela\b|\bızgara\b|\bizgara\b|\bdolap\b|\bmasa\b|\bşemsiye\b|\bsemsiye\b/i, 'Оборудование стройплощадки, мебель и бытовые модули']
];

/**
 * Fatura ve Prizma kalemlerinde Türkçe malzeme adının altında her zaman
 * orijinal Rusça karşılığının gösterilmesini sağlayan akıllı yardımcı fonksiyon.
 * Eğer kayıtta zaten Kiril (Rusça) orijinal ad varsa onu korur;
 * yalnızca Türkçe stok kartı adı geldiyse teknik Rusça karşılığını üretir.
 */
export function ensureRussianOriginalName(materialName?: string, rawOriginalName?: string): string {
  const memoKey = `${materialName || ''}\u0000${rawOriginalName || ''}`;
  const cachedRu = ensureRuMemoCache.get(memoKey);
  if (cachedRu !== undefined) return cachedRu;

  const res = ((): string => {
    let orig = (rawOriginalName || '').trim();
    // Unwrap previous generic ТМЦ fallback so it can be properly resolved to specific Russian technical name
    const tmcMatch = orig.match(/^Строительно-монтажный материал\s*\/\s*ТМЦ\s*\((.+)\)$/i);
    if (tmcMatch && tmcMatch[1]) {
      orig = tmcMatch[1].trim();
    }
    const isShortNoteOrDrawingCode = /^(?:\d+\s*(?:шт|м|кг|л|уп|кор|рул|пл|мпа)|кж\s*\d|к\d\s*схем|корпус|стилобат|арт\.?\s*\d|спайка|осина\b)/i.test(orig);
    const isStaleCableOnWireless = /^Кабель силовой медный/i.test(orig) && /kablosuz|klavye|mouse|fare/i.test(materialName || '');
    if (orig && /[а-яА-ЯёЁ]{4,}/.test(orig) && !isShortNoteOrDrawingCode && !isStaleCableOnWireless) {
      return orig;
    }
    const src = (materialName || orig || '').trim();
    if (!src) return '';
    if (/[а-яА-ЯёЁ]{4,}/.test(src) && !/^(?:кж\s*\d|корпус|стилобат)/i.test(src)) return src;

    const lower = src
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase();

    // Ölçü ve teknik değerleri koru
    const dims = src.match(/(?:Ø\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:x|х|\*|×)\s*\d+(?:[.,]\d+)?(?:\s*(?:x|х|\*|×)\s*\d+(?:[.,]\d+)?)?|\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|lt|l|m2|m²|m3|m³|ton|adet|w|kw|v|a)\b)/gi);
    const dimSuffix = dims && dims.length > 0 ? ` (${Array.from(new Set(dims.map(d => d.trim()))).join(', ')})` : '';

    if (lower.includes('inşaat demiri') || lower.includes('insaat demiri') || lower.includes('nervürlü demir') || lower.includes('demir nervürlü') || lower.includes('demir nervurlu')) {
      return `Арматура рифленая А500С ГОСТ 34028${dimSuffix}`;
    }
    if (lower.includes('çelik hasır') || lower.includes('celik hasir') || lower.includes('hasır çelik')) {
      return `Сетка сварная арматурная Вр-1${dimSuffix}`;
    }
    if ((lower.includes('tavlı') && lower.includes('tel')) || lower.includes('bağ teli') || lower.includes('bag teli')) {
      return `Проволока стальная вязальная ТОЧ${dimSuffix}`;
    }
    if (lower.includes('donatı kafesi') || lower.includes('donati kafesi') || lower.includes('armatür karkas')) {
      return `Каркас арматурный сварной (${src})`;
    }
    if (lower.includes('karkas metal') || lower.includes('metal karkas')) {
      return `Каркас металлический (${src})`;
    }
    if (lower.includes('köşebent') || lower.includes('kosebent')) {
      return `Уголок стальной равнополочный ГОСТ 8509${dimSuffix}`;
    }
    if (lower.includes('kutu profil') || lower.includes('profil kutu') || lower.includes('profil boru') || lower.includes('profil demir')) {
      return `Труба стальная профильная ГОСТ 8639/8645${dimSuffix}`;
    }
    if ((lower.includes('dikişli') && lower.includes('boru')) || (lower.includes('dikisli') && lower.includes('boru')) || lower.includes('boru demir')) {
      return `Труба стальная электросварная ГОСТ 10704${dimSuffix}`;
    }
    if (lower.includes('gazbeton') || lower.includes('ytong') || lower.includes('bonolit')) {
      if (lower.includes('yapıştırıcı') || lower.includes('yapistirici') || lower.includes('harç') || lower.includes('harc') || lower.includes('клей')) {
        return `Клей для газобетона (${src})`;
      }
      if (lower.includes('rende') || lower.includes('рубанок') || lower.includes('testere') || lower.includes('mala') || lower.includes('dübel') || lower.includes('dubel')) {
        return `Инструмент / крепеж для газобетона (${src})`;
      }
      const dMatch = src.match(/\b[dд]\s*(300|350|400|500|600)\b/i);
      const dGrade = dMatch ? `D${dMatch[1]}` : 'D500';
      return `Блок газобетонный стеновой ${dGrade}${dimSuffix}`;
    }
    if (lower.includes('kontrplak') || lower.includes('plywood') || lower.includes('pleyvud')) {
      return `Фанера ламинированная ФОФ для опалубки${dimSuffix}`;
    }
    if (lower.includes('taşyünü') || lower.includes('tasyunu') || lower.includes('kaya yünü')) {
      return `Утеплитель каменная вата (базальтовая)${dimSuffix}`;
    }
    if (lower.includes('xps') || lower.includes('penoplex') || lower.includes('köpük levha')) {
      return `Экструдированный пенополистирол (ЭППС / Пеноплэкс)${dimSuffix}`;
    }
    if (lower.includes('alçıpan') || lower.includes('alcipan')) {
      if (lower.includes('vida')) return `Саморезы по гипсокартону фосфатированные${dimSuffix}`;
      if (lower.includes('testere') || lower.includes('bıçak') || lower.includes('bicak')) return `Ножовка по гипсокартону (${src})`;
      if (lower.includes('agraf') || lower.includes('profil')) return `Профиль / подвес для гипсокартона (${src})`;
      return `Гипсокартонный лист (ГКЛ / ГКЛВ)${dimSuffix}`;
    }
    if (lower.includes('kompresör') || lower.includes('kompresor')) {
      return `Компрессор воздушный электрический (${src})`;
    }
    if (lower.includes('boya') && (lower.includes('pf-115') || lower.includes('emal') || lower.includes('yağlı') || lower.includes('yagli'))) {
      const colorRu = lower.includes('beyaz') ? 'белая' : lower.includes('sarı') || lower.includes('sari') ? 'желтая' : lower.includes('gri') ? 'серая' : lower.includes('siyah') ? 'черная' : lower.includes('yeşil') || lower.includes('yesil') ? 'зеленая' : lower.includes('kırmızı') || lower.includes('kirmizi') ? 'красная' : lower.includes('mavi') ? 'синяя' : '';
      return `Эмаль алкидная ПФ-115 ${colorRu}${dimSuffix}`.replace(/\s+/g, ' ').trim();
    }
    if (lower.includes('rulo') && (lower.includes('boya') || lower.includes('parmak') || lower.includes('kadife'))) {
      return `Валик малярный с бюгелем${dimSuffix}`;
    }
    if (lower.includes('fırça') || lower.includes('firca') || lower.includes('fırca') || lower.includes('fircasi') || lower.includes('fırçası')) {
      if (lower.includes('tuvalet') || lower.includes('klozet') || lower.includes('wc')) {
        return `Ершик для унитаза с подставкой`;
      }
      if (lower.includes('tel')) {
        return `Щетка металлическая зачистная (корщетка)${dimSuffix}`;
      }
      if (lower.includes('sapı') || lower.includes('sapi')) {
        return `Черенок деревянный для щетки с резьбой${dimSuffix}`;
      }
      if (lower.includes('temizlik') || lower.includes('yer') || lower.includes('süpürge') || lower.includes('supurge')) {
        return `Щетка для уборки помещений / подметальная${dimSuffix}`;
      }
      if (lower.includes('radyatör') || lower.includes('radyator')) {
        return `Кисть малярная радиаторная${dimSuffix}`;
      }
      return `Кисть малярная плоская${dimSuffix}`;
    }
    if (lower.includes('streç') || lower.includes('strec') || lower.includes('stretch')) {
      return `Пленка стрейч упаковочная 500 мм${dimSuffix}`;
    }
    if (lower.includes('naylon') || lower.includes('polietilen')) {
      if (lower.includes('500 mm') && lower.includes('23')) {
        return `Пленка стрейч упаковочная 500 мм 23 мкм`;
      }
      return `Пленка полиэтиленовая техническая ГОСТ 10354${dimSuffix}`;
    }
    if (lower.includes('branda') || lower.includes('tarpaulin') || lower.includes('tente')) {
      return `Тент строительный защитный (Тарпаулин / ПВХ)${dimSuffix}`;
    }
    if (lower.includes('elektrod') || lower.includes('elektrot')) {
      return `Электроды сварочные покрытые${dimSuffix}`;
    }
    if (lower.includes('propan') && (lower.includes('tüp') || lower.includes('tup'))) {
      return `Пропан технический в баллонах 50 л`;
    }
    if (lower.includes('kesici taş') || lower.includes('kesici tas') || lower.includes('kesme tasi') || lower.includes('kesme taşı') || lower.includes('kesme diski')) {
      return `Круг (диск) отрезной по металлу${dimSuffix}`;
    }
    if (lower.includes('köpük') || lower.includes('kopuk')) {
      if (lower.includes('temizleyici')) {
        return `Очиститель монтажной пены профессиональный (${src})`;
      }
      if (lower.includes('tabanca') && !lower.includes('poliüretan')) {
        return `Пистолет для монтажной пены профессиональный (${src})`;
      }
      if (lower.includes('poliüretan') || lower.includes('montaj')) {
        return `Пена монтажная профессиональная под пистолет${dimSuffix}`;
      }
    }
    if (lower.includes('koli bandı') || lower.includes('bant koli')) {
      if (lower.includes('dispensa') || lower.includes('aparat') || lower.includes('makine')) {
        return `Диспенсер для упаковочного скотча (${src})`;
      }
      return `Скотч упаковочный клейкий${dimSuffix}`;
    }
    if (lower.includes('maskeleme bandı') || lower.includes('kağıt bant')) {
      return `Лента малярная креппированная (бумажная)${dimSuffix}`;
    }
    if (lower.includes('eldiven')) {
      return `Перчатки рабочие защитные${dimSuffix}`;
    }
    if (lower.includes('baret')) {
      return `Каска строительная защитная`;
    }
    if (lower.includes('çivi') || lower.includes('civi') || lower.includes('cıvı')) {
      if (lower.includes('kroşe') || lower.includes('krose') || lower.includes('tabanca')) {
        return `Клипса (держатель) для монтажного пистолета${dimSuffix}`;
      }
      return `Гвозди строительные ГОСТ 4028${dimSuffix}`;
    }
    if (lower.includes('vida') || lower.includes('samorez')) {
      return `Саморезы строительные оцинкованные / фосфатированные${dimSuffix}`;
    }
    if (lower.includes('cıvata') || lower.includes('civata') || lower.includes('bolt') || lower.includes('aybolt')) {
      if (lower.includes('aybolt')) return `Рым-болт оцинкованный DIN 580 (${src})`;
      return `Болт оцинкованный с шестигранной головкой DIN 933${dimSuffix}`;
    }
    if (lower.includes('somun')) {
      return `Гайка шестигранная оцинкованная DIN 934${dimSuffix}`;
    }
    if (lower.includes('pul') || lower.includes('rondela')) {
      return `Шайба плоская / пружинная оцинкованная DIN 125/127 (${src})`;
    }
    if (lower.includes('ankraj') || lower.includes('saplama') || lower.includes('tij')) {
      return `Анкерный болт / шпилька резьбовая DIN 975${dimSuffix}`;
    }
    if (lower.includes('kablo bağı') || lower.includes('kablo bagi') || lower.includes('klips')) {
      return `Хомут кабельный нейлоновый (стяжка)${dimSuffix}`;
    }
    if (lower.includes('kablo papucu') || lower.includes('kablo ek borusu')) {
      return `Наконечник / гильза кабельная соединительная (${src})`;
    }
    if (lower.includes('kablo') && !lower.includes('kablosuz')) {
      return `Кабель силовой медный ВВГнг(А)-LS${dimSuffix}`;
    }
    if (lower.includes('kırıcı') || lower.includes('kirici') || lower.includes('kırıcı uç') || lower.includes('uc kirici') || lower.includes('kırıcı uc') || lower.includes('keski')) {
      return `Зубило плоское / пика по бетону SDS-Plus / SDS-Max (${src})`;
    }
    if (lower.includes('maket bıçağı') || lower.includes('maket bicagi') || lower.includes('falçata') || lower.includes('falcata')) {
      return `Нож строительный сегментный 18 мм / лезвия (${src})`;
    }
    if (lower.includes('master isimak') || lower.includes('master ısımak')) {
      return `Запчасть для тепловой пушки Master (${src})`;
    }
    if (lower.includes('panc') || lower.includes('panç')) {
      return `Коронка биметаллическая по металлу HSS (${src})`;
    }
    if (lower.includes('japon arabasi') || lower.includes('japon arabası') || lower.includes('el arabasi') || lower.includes('el arabası')) {
      return `Тачка строительная усиленная / бадья (${src})`;
    }
    if (lower.includes('klor')) {
      return `Известь хлорная / средство дезинфицирующее (${src})`;
    }
    if (lower.includes('cam yünü') || lower.includes('cam yunu') || lower.includes('ursa') || lower.includes('taşyünü') || lower.includes('tasyunu') || lower.includes('taş yünü') || lower.includes('tas yunu')) {
      return `Утеплитель теплоизоляционный минераловатный${dimSuffix} [${src}]`;
    }

    for (const [regex, ruDesc] of TR_TO_RU_TECH_DICT) {
      if (regex.test(lower)) {
        return `${ruDesc}${dimSuffix} [${src}]`;
      }
    }

    return `Строительно-монтажный материал / ТМЦ (${src})`;
  })();

  if (ensureRuMemoCache.size > 12000) ensureRuMemoCache.clear();
  ensureRuMemoCache.set(memoKey, res);
  return res;
}
