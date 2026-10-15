export type MaterialComparisonMode = 'COMMODITY_STANDARD' | 'BRAND_SEGMENTED';
export type MaterialQualitySegment = 'COMMODITY' | 'PREMIUM' | 'STANDARD' | 'ECONOMY';

export interface MaterialSegmentAnalysis {
  comparisonMode: MaterialComparisonMode;
  comparisonModeLabel: string;
  qualitySegment: MaterialQualitySegment;
  qualitySegmentLabel: string;
  brand: string;
  productLine: string;
  segmentReason: string;
}

const COMMODITY_CATEGORIES = new Set([
  'inşaat demiri',
  'çelik borular',
  'çelik malzemeler',
  'hazır beton, çimento & agrega',
  'ahşap & kereste',
  'tuğla, gazbeton & duvar blokları'
]);

const BRAND_DICTIONARY: Array<{
  pattern: RegExp;
  brand: string;
  defaultTier: MaterialQualitySegment;
}> = [
  // Premium / Industrial Tier ("Mercedes")
  { pattern: /\bhilti\b|хилти/i, brand: 'Hilti', defaultTier: 'PREMIUM' },
  { pattern: /\bleica\b|лейка/i, brand: 'Leica', defaultTier: 'PREMIUM' },
  { pattern: /\bsika\b|bsika|sikaplan|waterbar|сика/i, brand: 'Sika', defaultTier: 'PREMIUM' },
  { pattern: /\bbosch\b|бош\b/i, brand: 'Bosch', defaultTier: 'PREMIUM' },
  { pattern: /\bmakita\b|макита/i, brand: 'Makita', defaultTier: 'PREMIUM' },
  { pattern: /\bdewalt\b|деволт/i, brand: 'DeWalt', defaultTier: 'PREMIUM' },
  { pattern: /\bmetabo\b|метабо/i, brand: 'Metabo', defaultTier: 'PREMIUM' },
  { pattern: /\bfisco\b|фиско/i, brand: 'Fisco', defaultTier: 'PREMIUM' },
  { pattern: /\bgross\b|гросс/i, brand: 'Gross', defaultTier: 'PREMIUM' },
  { pattern: /\bknauf\b|кнауф/i, brand: 'Knauf', defaultTier: 'PREMIUM' },
  { pattern: /техноэласт|technoelast/i, brand: 'ТехноНИКОЛЬ Техноэласт', defaultTier: 'PREMIUM' },
  { pattern: /carbon\s*prof|карбон\s*проф/i, brand: 'ТехноНИКОЛЬ Carbon Prof', defaultTier: 'PREMIUM' },
  { pattern: /logicpir|логикпир|logicbase/i, brand: 'ТехноНИКОЛЬ Logic', defaultTier: 'PREMIUM' },
  { pattern: /пеноплэкс|пеноплекс|penoplex/i, brand: 'Пеноплэкс', defaultTier: 'PREMIUM' },
  { pattern: /икопал|icopal/i, brand: 'Icopal', defaultTier: 'PREMIUM' },
  { pattern: /скорпион\s*(?:проф|трекбот)/i, brand: 'Скорпион Проф', defaultTier: 'PREMIUM' },
  { pattern: /перфект\s*протекшен|премиум\s*эдишен/i, brand: 'Перфект Протекшен Премиум', defaultTier: 'PREMIUM' },
  { pattern: /равелин/i, brand: 'Равелин', defaultTier: 'PREMIUM' },
  { pattern: /росомз|сомз[\s-]*55|favorit\s*trek/i, brand: 'РОСОМЗ FavoriT', defaultTier: 'PREMIUM' },
  { pattern: /русоко\s*альфа/i, brand: 'Русоко Альфа', defaultTier: 'PREMIUM' },
  { pattern: /\bintegral\b|интеграл/i, brand: 'Integral', defaultTier: 'PREMIUM' },
  { pattern: /gigant\s*professional/i, brand: 'Gigant Professional', defaultTier: 'PREMIUM' },
  { pattern: /karbosan|карбосан/i, brand: 'Karbosan', defaultTier: 'PREMIUM' },
  { pattern: /\besab\b|эсаб/i, brand: 'ESAB', defaultTier: 'PREMIUM' },
  { pattern: /askaynak|аскайнак/i, brand: 'Askaynak', defaultTier: 'PREMIUM' },
  { pattern: /litokol|литокол|литобанд/i, brand: 'Litokol', defaultTier: 'PREMIUM' },
  { pattern: /ceresit|церезит/i, brand: 'Ceresit', defaultTier: 'PREMIUM' },
  { pattern: /mapei|мапей/i, brand: 'Mapei', defaultTier: 'PREMIUM' },
  { pattern: /tikkurila|тиккурила/i, brand: 'Tikkurila', defaultTier: 'PREMIUM' },
  { pattern: /penosil|пеносил/i, brand: 'Penosil', defaultTier: 'PREMIUM' },
  { pattern: /tytan|титан\s*проф/i, brand: 'Tytan Professional', defaultTier: 'PREMIUM' },
  { pattern: /soudal|соудал/i, brand: 'Soudal', defaultTier: 'PREMIUM' },
  { pattern: /\babb\b/i, brand: 'ABB', defaultTier: 'PREMIUM' },
  { pattern: /schneider|шнайдер/i, brand: 'Schneider Electric', defaultTier: 'PREMIUM' },
  { pattern: /legrand|легран/i, brand: 'Legrand', defaultTier: 'PREMIUM' },
  { pattern: /дкс|\bdkc\b/i, brand: 'DKC (ДКС)', defaultTier: 'PREMIUM' },
  { pattern: /kyocera/i, brand: 'Kyocera', defaultTier: 'PREMIUM' },
  { pattern: /\bcanon\b/i, brand: 'Canon', defaultTier: 'PREMIUM' },
  { pattern: /logitech/i, brand: 'Logitech', defaultTier: 'PREMIUM' },
  { pattern: /tp-link/i, brand: 'TP-Link', defaultTier: 'PREMIUM' },
  { pattern: /redius|редиус/i, brand: 'Redius', defaultTier: 'PREMIUM' },
  { pattern: /ahmad\s*tea/i, brand: 'Ahmad Tea', defaultTier: 'PREMIUM' },
  { pattern: /luscan|лускан/i, brand: 'Luscan', defaultTier: 'STANDARD' },
  { pattern: /grass\b|milana/i, brand: 'Grass / Milana', defaultTier: 'PREMIUM' },
  { pattern: /клевер/i, brand: 'Клевер', defaultTier: 'STANDARD' },

  // Standard / Mid Tier
  { pattern: /гипрок|gyproc/i, brand: 'Gyproc (Гипрок)', defaultTier: 'STANDARD' },
  { pattern: /технониколь|technonicol|технофас|техноблок|плантер|planter/i, brand: 'ТехноНИКОЛЬ', defaultTier: 'STANDARD' },
  { pattern: /изопласт|izoplast/i, brand: 'Изопласт', defaultTier: 'STANDARD' },
  { pattern: /виллатекс|villateks/i, brand: 'Виллатекс', defaultTier: 'STANDARD' },
  { pattern: /унифлекс|uniflex/i, brand: 'Унифлекс', defaultTier: 'STANDARD' },
  { pattern: /баутекс|крепикс/i, brand: 'БауТекс Крепикс', defaultTier: 'STANDARD' },
  { pattern: /зубр|\bzubr\b/i, brand: 'Зубр', defaultTier: 'STANDARD' },
  { pattern: /kraftool|крафтул/i, brand: 'Kraftool', defaultTier: 'STANDARD' },
  { pattern: /stayer|стайер/i, brand: 'Stayer', defaultTier: 'STANDARD' },
  { pattern: /креост/i, brand: 'Креост', defaultTier: 'STANDARD' },
  { pattern: /\bgigant\b/i, brand: 'Gigant', defaultTier: 'STANDARD' },
  { pattern: /inforce|инфорс/i, brand: 'Inforce', defaultTier: 'STANDARD' },
  { pattern: /луга|luga/i, brand: 'ЛугаАбразив', defaultTier: 'STANDARD' },
  { pattern: /армата/i, brand: 'Армата', defaultTier: 'STANDARD' },
  { pattern: /\btsr\b/i, brand: 'TSR Standard', defaultTier: 'STANDARD' },
  { pattern: /monolit|монолит/i, brand: 'Monolit', defaultTier: 'STANDARD' },
  { pattern: /мистраль/i, brand: 'Мистраль', defaultTier: 'STANDARD' },
  { pattern: /основит/i, brand: 'Основит', defaultTier: 'STANDARD' },
  { pattern: /волма|volma/i, brand: 'Волма', defaultTier: 'STANDARD' },
  { pattern: /старатели/i, brand: 'Старатели', defaultTier: 'STANDARD' },
  { pattern: /kudo|кудо/i, brand: 'Kudo', defaultTier: 'STANDARD' },
  { pattern: /\biek\b|иэк/i, brand: 'IEK (ИЭК)', defaultTier: 'STANDARD' },
  { pattern: /\bekf\b|экф/i, brand: 'EKF', defaultTier: 'STANDARD' },
  { pattern: /\btdm\b|тдм/i, brand: 'TDM Electric', defaultTier: 'STANDARD' },
  { pattern: /svetocopy|светокопи/i, brand: 'SvetoCopy', defaultTier: 'STANDARD' },
  { pattern: /илим/i, brand: 'Илим', defaultTier: 'STANDARD' },
  { pattern: /майский|mayskiy/i, brand: 'Майский', defaultTier: 'STANDARD' },

  // Economy / Site Consumable Tier ("Lada")
  { pattern: /биполь|bipol/i, brand: 'Биполь (Эконом)', defaultTier: 'ECONOMY' },
  { pattern: /бикрост|линокром/i, brand: 'Бикрост / Линокром (Эконом)', defaultTier: 'ECONOMY' },
  { pattern: /profiplex|профиплекс/i, brand: 'Profiplex', defaultTier: 'ECONOMY' },
  { pattern: /ботинки?\s+лайн|\bлайн\s+мп/i, brand: 'Лайн (Эконом)', defaultTier: 'ECONOMY' },
  { pattern: /ботинок\s+"?рабочий"?|saha\s*genel\s*kullanim/i, brand: 'Рабочий (Saha Standart)', defaultTier: 'ECONOMY' },
  { pattern: /samgrupp|очк201/i, brand: 'SAMGRUPP / Эконом', defaultTier: 'ECONOMY' },
  { pattern: /тонер-картридж\s+комус|картридж\s+комус/i, brand: 'Комус (Muadil)', defaultTier: 'ECONOMY' },
  { pattern: /комус\s*документ|деловой\s*стандарт/i, brand: 'Комус / Деловой стандарт', defaultTier: 'STANDARD' },
  { pattern: /iqup|эко\s*дом|azur.*мини/i, brand: 'Эконом (IQUP / Эко Дом / AZUR)', defaultTier: 'ECONOMY' },
  { pattern: /sparta|спарта|matrix|матрикс|сибртех|ермак/i, brand: 'Sparta / Matrix (Эконом)', defaultTier: 'ECONOMY' }
];

/**
 * Determines whether a material is a pure Commodity (GOST/DIN standard where brand doesn't matter, e.g., Rebar, Steel, Concrete, Timber)
 * or a Brand/Quality Segmented material ("Mercedes vs. Lada", where brand/tier determines price & quality).
 */
export function analyzeMaterialSegment(
  materialName: string,
  originalName?: string,
  category?: string,
  unitPrice?: number
): MaterialSegmentAnalysis {
  const matLower = (materialName || '').toLowerCase();
  const origLower = (originalName || '').toLowerCase();
  const catLower = (category || '').toLowerCase();
  const combined = `${origLower} ${matLower}`.trim();

  // 1. Check if it is a strict GOST / DIN / Structural Commodity ("Demir Demirdir")
  const isStructuralCommodity =
    (/арматур|inşaat\s*demir|insaat\s*demir|nervürlü|a500c|а500с|çelik\s*hasır|сетка\s*сварн|уголок|köşebent|швеллер|şveller|двутавр|i-kiriş|труба\s*(?:профильн|э\/с|электросварн|вгп)|kutu\s*profil|dikişli\s*çelik\s*boru|лист\s*(?:стальн|г\/к|х\/к|рифлен|оцинк)|çelik\s*sac|полоса\s*стальн|çelik\s*lama|катанка|filmaşin|проволока\s*вязальн|tavlı.*bağ\s*teli|доска\s*обрезн|брус\s*обрезн|inşaatlık.*kereste|kenarlı\s*kereste|фанера\s*(?:фсф|фоф|ламинир)|kalıplık.*kontrplak|бетон\b|hazır\s*beton|цемент\b|portland\s*çimento|песок\b|щебень\b|керамзит|keramzit|пескобетон|цпс\b|kuru\s*harç|газобетон|газоблок|gazbeton\s*blok|кирпич|harman\s*tuğla|пнсв|ввгнг|кгтп|пугв|пвс\b|din\s*(?:934|975|125|127|9021|580)|гост\s*(?:34028|8509|8639|8645|10704|8240|57837|23279|8486|3282|22042)|пропан\s*техническ|кислород\s*техническ|дизельное\s*топливо|motorin|mazot|вода.*19\s*л|damacana\s*içme\s*suyu/i.test(combined)) &&
    !/колпачок|грибок|рубанок|rende|ножовка|testere|герметик|пена|краска|эмаль|грунтовка|клей\s*плиточн|sika|sikaplan|waterbar|техноэласт|икопал|биполь|ботинк|полуботинк|сапог|каска|очки|перчатк|костюм|куртка|жилет|картридж|тонер|строп|горелка/i.test(combined);

  if (isStructuralCommodity) {
    return {
      comparisonMode: 'COMMODITY_STANDARD',
      comparisonModeLabel: '🏗️ Standart Emtia (GOST/DIN — Marka Bağımsız)',
      qualitySegment: 'COMMODITY',
      qualitySegmentLabel: 'Standart Emtia (GOST / DIN)',
      brand: 'GOST / DIN Standart',
      productLine: 'Standart Emtia',
      segmentReason: 'Bu malzeme ulusal/uluslararası mühendislik standardına (GOST/DIN) tabidir; marka fark etmeksizin doğrudan teknik ölçü bazında kıyaslanır.'
    };
  }

  // 2. Brand & Quality Tier Detection for Brand-Segmented Materials ("Mercedes vs. Lada")
  for (const entry of BRAND_DICTIONARY) {
    if (entry.pattern.test(combined)) {
      let tier = entry.defaultTier;
      // Special refinements
      if (entry.brand === 'Luscan' && /50\s*мкм|10\s*мкм.*30\s*шт|подставк/i.test(combined)) {
        tier = 'PREMIUM';
      }
      const segLabel =
        tier === 'PREMIUM'
          ? '👑 Premium / Profesyonel Segment'
          : tier === 'ECONOMY'
          ? '📦 Ekonomik / Saha Segmenti'
          : '⚖️ Standart / Orta Segment';
      return {
        comparisonMode: 'BRAND_SEGMENTED',
        comparisonModeLabel: '🏷️ Marka & Kalite Segmentli Malzeme',
        qualitySegment: tier,
        qualitySegmentLabel: segLabel,
        brand: entry.brand,
        productLine: entry.brand,
        segmentReason: `"${entry.brand}" markası / ürün serisi ${segLabel} kapsamında değerlendirilir; yalnızca aynı kalite sınıfındaki muadilleriyle kıyaslanır.`
      };
    }
  }

  // 3. Heuristic Quality Segment Detection when explicit brand name is not in dictionary
  const price = Number(unitPrice) || 0;
  let heuristicTier: MaterialQualitySegment = 'STANDARD';
  if (/премиум|premium|проф\b|professional|кевлар|натуральн.*мех|кпп\b|усиленн|кобальт|cobalt/i.test(combined)) {
    heuristicTier = 'PREMIUM';
  } else if (/эконом|искусственн.*мех|"s"|saha\s*genel|б\/у\b|вторичн|6\s*мкм/i.test(combined)) {
    heuristicTier = 'ECONOMY';
  } else if (COMMODITY_CATEGORIES.has(catLower)) {
    return {
      comparisonMode: 'COMMODITY_STANDARD',
      comparisonModeLabel: '🏗️ Standart Emtia (GOST/DIN — Marka Bağımsız)',
      qualitySegment: 'COMMODITY',
      qualitySegmentLabel: 'Standart Emtia (GOST / DIN)',
      brand: 'Standart',
      productLine: 'Standart',
      segmentReason: 'Yapısal inşaat emtiası; teknik ölçü bazında kıyaslanır.'
    };
  }

  const segLabel =
    heuristicTier === 'PREMIUM'
      ? '👑 Premium / Profesyonel Segment'
      : heuristicTier === 'ECONOMY'
      ? '📦 Ekonomik / Saha Segmenti'
      : '⚖️ Standart / Orta Segment';

  return {
    comparisonMode: 'BRAND_SEGMENTED',
    comparisonModeLabel: '🏷️ Marka & Kalite Segmentli Malzeme',
    qualitySegment: heuristicTier,
    qualitySegmentLabel: segLabel,
    brand: heuristicTier === 'ECONOMY' ? 'Ekonomik / Standart' : 'Standart Seri',
    productLine: segLabel,
    segmentReason: 'Marka ve kalite segmentine duyarlı malzeme grubu.'
  };
}

/**
 * Checks whether two history entries belong to compatible quality/brand segments
 * so that a "Mercedes" (Premium) item is never falsely flagged against a "Lada" (Economy) item.
 */
export function areMaterialSegmentsCompatible(
  entryA: { originalName?: string; unitPrice?: number; normalizedUnitPrice?: number },
  entryB: { originalName?: string; unitPrice?: number; normalizedUnitPrice?: number },
  materialName: string,
  category?: string
): boolean {
  const priceA = Number(entryA.normalizedUnitPrice || entryA.unitPrice || 0);
  const priceB = Number(entryB.normalizedUnitPrice || entryB.unitPrice || 0);
  const segA = analyzeMaterialSegment(materialName, entryA.originalName, category, priceA);
  const segB = analyzeMaterialSegment(materialName, entryB.originalName, category, priceB);

  // If it's a pure GOST/DIN commodity (rebar, steel, timber, concrete), all suppliers/mills are directly comparable!
  if (segA.comparisonMode === 'COMMODITY_STANDARD' && segB.comparisonMode === 'COMMODITY_STANDARD') {
    return true;
  }

  // If both have different quality tiers (e.g. PREMIUM vs ECONOMY, or PREMIUM vs STANDARD with conflicting brands), do not compare!
  if (segA.qualitySegment !== segB.qualitySegment) {
    return false;
  }

  return true;
}
