/**
 * Düşük Öncelikli / Çok Değişken Sarf Malzemesi Filtresi
 * ------------------------------------------------------------------
 * Ofis & kırtasiye, toner/kartuş, temizlik & hijyen (deterjan, sabun, çöp poşeti)
 * ve mutfak/ikram (çay, kahve, şeker, su, bardak) kalemleri fiyatı çok oynak,
 * tutarı küçük ve markası/paketi sürekli değişen ürünlerdir. Tedarikçi Fiyat Artış
 * & Sapma Paneli'nde gerçek yapısal malzemelerin (demir, beton, çelik, yalıtım...)
 * önüne geçip dikkati dağıtmamaları için varsayılan olarak gizlenirler.
 */

const LOW_PRIORITY_CATEGORY_RE = /ofis|kırtasiye|kirtasiye|temizlik|hijyen|gıda|gida|mutfak|ikram/i;

// Bilgi İşlem kategorisinde sadece sarf/aksesuar kısmı (bilgisayar/yazıcı gibi demirbaşlar değil)
const IT_CONSUMABLE_RE = /toner|kartuş|kartus|картридж|тонер|drum|fotokopi|kağıd|kağıt|kagit|бумаг|mouse|fare\b|klavye|клавиатур|мышь|etiket\s*yazıcı\s*kartuş|\bpil\b|батарейк|flash\s*bellek|usb\s*bellek|термопленк|fırın\s*filmi|коммутатор|\bswitch\b|ağ\s*anahtar|патч[\s-]*корд|patch\s*cord|роутер|маршрутизатор|удлинител|фильтр\s*сетев|akım\s*korumal/i;

// Kategori ne olursa olsun isimden yakalanan tipik ofis/temizlik/ikram kalemleri
const LOW_PRIORITY_NAME_RE = new RegExp([
  'deterjan', 'моющ[а-я]*\\s+средств', 'чистящ[а-я]*\\s+средств', 'средств[ао]\\s+(?:для\\s+)?(?:мыть|уборк|чист)', 'хозяйственные\\s+товары',
  'sıvı\\s*(?:el\\s*)?sabun', 'мыло', 'çamaşır\\s*suyu', 'белизн', 'klor\\s*tozu', 'хлорн',
  'çöp\\s*poşet', 'cop\\s*poset', 'мешк[иа]?\\s+для\\s+мусора', 'пакет[ыа]?\\s+для\\s+мусора',
  'peçete', 'салфетк', 'tuvalet\\s*kağıd', 'туалетн[а-я]*\\s+бумаг', 'kağıt\\s*havlu', 'полотенц[а-я]*\\s+бумажн',
  'klozet\\s*(?:fırça|blo)', 'ершик', 'wc\\s*fırça', 'paspas\\s*(?:kovası|seti)', 'швабр',
  // Toner/kartuş yalnızca yazıcı bağlamında (Hilti/gazlı çivi/batarya kartuşları inşaat malzemesidir)
  'toner', '(?:mürekkep|lazer|yazıcı|plotter)\\s*kartuş', 'картридж\\s+(?:для\\s+(?:принтер|мфу)|лазерн|струйн)',
  'a4\\s*fotokopi', 'a3\\s*fotokopi', 'fotokopi\\s*kağıd', 'бумага\\s+(?:офисн|для\\s+офисн|а4|a4|а3|a3)', 'svetocopy', 'снегурочка',
  'tükenmez\\s*kalem', 'kurşun\\s*kalem', 'keçeli\\s*kalem', 'ручка\\s+шарик', 'маркер(?!н)', 'zımba', 'степлер', 'скоб[ыа]\\s+для\\s+степлер',
  '(?:^|[\\s(])ataş(?=$|[\\s),])', 'скрепк', 'klasör', 'папка', 'bloknot', 'блокнот', 'koli\\s*bandı', 'скотч\\s+прозрачн',
  'poşet\\s*çay', 'чай\\s', 'kahve(?!\\s*makine)', 'кофе(?!варк|машин)', 'küp\\s*şeker', 'сахар', 'içme\\s*suyu', 'damacana', 'вода\\s+питьев',
  'karton\\s*bardak', 'стакан\\s+одноразов', 'tek\\s*kullanımlık\\s*(?:bardak|tabak|çatal)', 'посуда\\s+одноразов'
].join('|'), 'i');

export interface LowPriorityCheck {
  isLowPriority: boolean;
  reason: string;
}

export function checkLowPriorityConsumable(materialName?: string, category?: string, originalName?: string): LowPriorityCheck {
  const cat = String(category || '');
  const text = `${materialName || ''} ${originalName || ''}`;
  if (LOW_PRIORITY_CATEGORY_RE.test(cat)) {
    return { isLowPriority: true, reason: `Kategori: ${cat}` };
  }
  if (/bilgi\s*işlem|bilgi\s*islem|\bit\b/i.test(cat) && IT_CONSUMABLE_RE.test(text)) {
    return { isLowPriority: true, reason: 'Bilgi İşlem sarfı (toner/kartuş/kağıt/aksesuar)' };
  }
  if (LOW_PRIORITY_NAME_RE.test(text)) {
    return { isLowPriority: true, reason: 'Ofis / temizlik / ikram sarfı' };
  }
  return { isLowPriority: false, reason: '' };
}

export function isLowPriorityConsumable(materialName?: string, category?: string, originalName?: string): boolean {
  return checkLowPriorityConsumable(materialName, category, originalName).isLowPriority;
}
