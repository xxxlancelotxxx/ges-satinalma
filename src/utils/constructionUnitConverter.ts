/**
 * GES İNŞAAT - AKILLI ŞANTİYE BİRİM ÇEVRİM VE EŞDEĞERLİK MOTORU
 * (SMART CONSTRUCTION UNIT CONVERSION & EQUIVALENCE ENGINE)
 * 
 * Bu motor, inşaat satınalma faturalarında aynı malzemenin farklı birimlerde
 * (Ton, kg, metre tül, boy, m², rulo, m³, torba, plaka, kova) alınmasından
 * kaynaklanan fiyat kıyaslama ve yapay zeka denetim hatalarını ("elma ile armut")
 * inşaat mühendisliği standartlarına göre deterministik olarak çözer.
 * 
 * Standartlar: GOST 5781-82 / GOST 34028-2016, TS 708, EN 10080, ISO 6935
 */

export type PhysicalDimension = 
  | 'WEIGHT'       // ton, kg, g
  | 'LENGTH'       // m, mt, metre tül, boy
  | 'AREA'         // m², m2, plaka, rulo (yalıtım)
  | 'VOLUME'       // m³, m3, lt
  | 'PIECE_PACK'   // adet, rulo, torba, plaka, kova, kutu
  | 'UNKNOWN';

export interface UnitConversionResult {
  convertedUnitPrice: number;
  convertedQuantity: number;
  fromUnit: string;
  toUnit: string;
  factor: number; // 1 fromUnit = factor * toUnit
  formula: string;
  confidence: 'EXACT' | 'HIGH' | 'ESTIMATED';
  conversionApplied: boolean;
  notes?: string;
}

export interface MaterialUnitProfile {
  canonicalMaterial: string;
  category: string;
  standardBenchmarkUnit: string; // Karşılaştırmanın normalize edileceği hedef ortak birim
  detectedDiameterMm?: number;
  rollAreaM2?: number;
  boardAreaM2?: number;
  densityKgPerM3?: number;
  unitWeightKg?: number;
  linearMassKgPerM?: number;
}

// ----------------------------------------------------------------------------
// 1. İNŞAAT DEMİRİ STANDART METRE-AĞIRLIK TABLOSU (GOST 5781 / TS 708)
// ----------------------------------------------------------------------------
const REBAR_LINEAR_MASS: Record<number, number> = {
  6: 0.222,
  8: 0.395,
  10: 0.617,
  12: 0.888,
  14: 1.208,
  16: 1.578,
  18: 1.998,
  20: 2.466,
  22: 2.984,
  25: 3.853,
  28: 4.834,
  32: 6.313,
  36: 7.990,
  40: 9.865
};

// ----------------------------------------------------------------------------
// 2. METİN İÇİNDEN BOYUT & ÖZELLİK AYRIŞTIRICILARI (SPEC EXTRACTORS)
// ----------------------------------------------------------------------------

/**
 * Ürün başlığından demir çapını (Ø) çıkarır (Örn: "Арматура ф12мм", "Ø16 Demir", "d=10")
 */
export function extractRebarDiameter(text: string): number | null {
  if (!text) return null;
  const t = text.replace(/,/g, '.');

  // 1. Explicit diameter symbols: Q8, Q-8, Ø12, d12, D-18, ф12, фи12, fi12, çap: 16
  const symMatch = t.match(/(?:[qQøØdDдДфФ]|fi|фи|диаметр|çap)\s*[-:=№#]?\s*(\d+(?:\.\d+)?)\s*(?:мм|mm)?(?:$|[^0-9a-zA-Zа-яА-Я])/i);
  if (symMatch && symMatch[1]) {
    const val = parseFloat(symMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
    if (val >= 6 && val <= 50) return val;
  }

  // 2. Direct millimeter: 8mm, 8 mm, 14мм, 14 мм, 18 мм
  const mmMatch = t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+(?:\.\d+)?)\s*(?:мм|mm)(?:$|[^0-9a-zA-Zа-яА-Я])/i);
  if (mmMatch && mmMatch[1]) {
    const val = parseFloat(mmMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
    if (val >= 6 && val <= 50) return val;
  }

  // 3. Grade + Diameter: A500C 8, А500 36, А500С-12, B500C 16, A240 10, 25G2S 12, 35GS 14
  const gradeMatch = t.match(/(?:a500c|а500с|a500|а500|b500c|b500|a240|а240|a400|а400|25г2с|35гс)\s*[-/:=№#]?\s*(\d+(?:\.\d+)?)(?:$|[^0-9a-zA-Zа-яА-Я])/i);
  if (gradeMatch && gradeMatch[1]) {
    const val = parseFloat(gradeMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
    if (val >= 6 && val <= 50) return val;
  }

  // 4. Turkish colloquial: 8'lik, 8 lik, 12'lik, 16 lık demir
  const colMatch = t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+)\s*(?:'lik|'luk|lik|luk|lük|-lik|-luk|-lük)\b/i);
  if (colMatch && colMatch[1]) {
    const val = parseInt(colMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
  }

  // 5. Length dimension pattern: 12 x 11700, 16*11700
  const lenMatch = t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+)\s*[*xх]\s*(?:11700|12000|6000)\b/i);
  if (lenMatch && lenMatch[1]) {
    const val = parseInt(lenMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
  }

  // 6. Generic rebar term followed by diameter (e.g. "Арматура 8", "Арматура №8", "İnşaat Demiri 12", "Пруток 10")
  const genMatch = t.match(/(?:арматур[а-я]*|сталь\s+арматурн[а-я]*|пруток|inşaat\s+demir[a-zğüşıöç]*|insaat\s+demir[a-zğüşıöç]*)\D{0,15}?(?:№\s*|n[°o.]\s*)?(\d+(?:\.\d+)?)(?:$|[^0-9a-zA-Zа-яА-Я])/i);
  if (genMatch && genMatch[1]) {
    const val = parseFloat(genMatch[1]);
    if ([6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40].includes(val)) return val;
  }

  return null;
}

/**
 * Demir çapına göre metre tül ağırlığını hesaplar (kg/m)
 * Formül: w = 0.006165 * d^2
 */
export function getRebarWeightPerMeter(diameterMm: number): number {
  if (REBAR_LINEAR_MASS[diameterMm]) {
    return REBAR_LINEAR_MASS[diameterMm];
  }
  // Teorik formül: pi * (d/20)^2 * 7.85 g/cm3 = 0.006165 * d^2
  return Number((0.006165 * diameterMm * diameterMm).toFixed(4));
}

// ----------------------------------------------------------------------------
// STANDART KÖŞEBENT (L-DEMİR) METRE-AĞIRLIK TABLOSU (GOST 8509-93)
// ----------------------------------------------------------------------------
const ANGLE_STANDARD_MASS: Record<string, number> = {
  '25x25x3': 1.12,
  '25x25x4': 1.46,
  '30x30x3': 1.36,
  '32x32x3': 1.46,
  '32x32x4': 1.91,
  '35x35x3': 1.60,
  '35x35x4': 2.10,
  '40x40x3': 1.85,
  '40x40x4': 2.42,
  '40x40x5': 2.97,
  '45x45x4': 2.74,
  '45x45x5': 3.37,
  '50x50x3': 2.33,
  '50x50x4': 3.05,
  '50x50x5': 3.77,
  '63x63x5': 4.81,
  '63x63x6': 5.72,
  '70x70x5': 5.38,
  '70x70x6': 6.39,
  '70x70x7': 7.38,
  '75x75x5': 5.80,
  '75x75x6': 6.89,
  '75x75x7': 7.96,
  '80x80x6': 7.36,
  '80x80x7': 8.51,
  '80x80x8': 9.65,
  '90x90x7': 9.64,
  '90x90x8': 10.93,
  '100x100x7': 10.79,
  '100x100x8': 12.25,
  '100x100x10': 15.10,
  '125x125x8': 15.46,
  '125x125x10': 19.10,
  '125x125x12': 22.68
};

/**
 * Köşebent boyutlarını (Örn: 32x32x3, 50x50x5) ve metre tül ağırlığını çıkarır
 */
export function extractAngleDimensions(text: string): { leg1: number; leg2: number; thickness: number; weightPerM: number } | null {
  if (!text) return null;
  const t = text.replace(/,/g, '.');

  const match = t.match(/(?:угол[ока]*|köşebent|kosebent|l\s*profil|l\s*demir)?\s*(\d{2,3})\s*[*xх]\s*(\d{2,3})\s*[*xх]\s*(\d+(?:\.\d+)?)/i);
  if (match) {
    const leg1 = parseInt(match[1]);
    const leg2 = parseInt(match[2]);
    const thickness = parseFloat(match[3]);
    if (leg1 >= 20 && leg1 <= 250 && thickness >= 2 && thickness <= 35) {
      const key = `${leg1}x${leg2}x${thickness}`;
      let weightPerM = ANGLE_STANDARD_MASS[key];
      if (!weightPerM) {
        weightPerM = Number((0.00785 * (leg1 + leg2 - thickness) * thickness).toFixed(3));
      }
      return { leg1, leg2, thickness, weightPerM };
    }
  }
  return null;
}

/**
 * Çelik hasır özelliklerini çıkarır (Göz aralığı, tel çapı, m2 ağırlığı, kart/rulo alanı)
 */
export function extractMeshSpecs(text: string): { pitchX: number; pitchY: number; wireDiam: number; weightPerM2: number; cardAreaM2?: number; rollAreaM2?: number } | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, '.');

  const match = t.match(/(\d{2,3})\s*[*xх]\s*(\d{2,3})\s*[*xх]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    const pitchX = parseInt(match[1]);
    const pitchY = parseInt(match[2]);
    const wireDiam = parseFloat(match[3]);

    if (pitchX >= 20 && pitchX <= 300 && wireDiam >= 1 && wireDiam <= 16) {
      const weightPerM2 = Number((12.33 * (wireDiam * wireDiam) / pitchX).toFixed(2));

      let cardAreaM2: number | undefined;
      // Search for card dimensions such as 2x6m, 2x3m, карта 2х3м, (2х6м)
      const cardMatch = 
        t.match(/(?:карта|kart|tabaka|panel|\()\s*(\d+(?:\.\d+)?)\s*[*xх]\s*(\d+(?:\.\d+)?)\s*(?:м|m)?\)?/i) ||
        t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])([1-3](?:\.\d+)?)\s*[*xх]\s*([1-9](?:\.\d+)?)\s*(?:м|m)(?:$|[^0-9a-zA-Zа-яА-Я])/i);
      
      if (cardMatch) {
        const w = parseFloat(cardMatch[1]);
        const l = parseFloat(cardMatch[2]);
        if (w >= 0.5 && w <= 3.5 && l >= 1 && l <= 12) {
          cardAreaM2 = Number((w * l).toFixed(2));
        }
      }
      if (!cardAreaM2) {
        cardAreaM2 = (t.includes('2x6') || t.includes('2х6')) ? 12.0 : 6.0;
      }

      let rollAreaM2: number | undefined;
      const rollMatch = t.match(/(?:рулон|rulo).*?(\d+(?:\.\d+)?)\s*(?:м2|m2)/) || t.match(/(\d+(?:\.\d+)?)\s*[*xх]\s*(\d+(?:\.\d+)?)\s*(?:м|m)?\s*(?:рулон|rulo)/);
      if (rollMatch) {
        if (rollMatch[2]) {
          rollAreaM2 = Number((parseFloat(rollMatch[1]) * parseFloat(rollMatch[2])).toFixed(2));
        } else {
          rollAreaM2 = parseFloat(rollMatch[1]);
        }
      }

      return { pitchX, pitchY, wireDiam, weightPerM2, cardAreaM2, rollAreaM2 };
    }
  }
  return null;
}

/**
 * Profil Boru / Kutu Profil (Örn: 40х20х2, 100х100х5) ve Yuvarlak Çelik Boru (Örn: Ø219x4, Ø108x3.5) özelliklerini çıkarır
 */
export function extractProfilePipeSpecs(text: string): { width: number; height: number; thickness: number; weightPerM: number } | null {
  if (!text) return null;
  const t = text.replace(/,/g, '.');

  const match = t.match(/(\d{2,3})\s*[*xх×]\s*(\d{2,3})\s*[*xх×]\s*(\d+(?:\.\d+)?)/);
  if (match) {
    const width = parseInt(match[1]);
    const height = parseInt(match[2]);
    const thickness = parseFloat(match[3]);
    if (width >= 15 && width <= 300 && thickness >= 1 && thickness <= 20) {
      const weightPerM = Number((0.0157 * thickness * (width + height - 2.86 * thickness)).toFixed(2));
      return { width, height, thickness, weightPerM };
    }
  }

  // Yuvarlak Dikişli Çelik Boru (GOST 10704 / 3262): ØDxT mm -> 0.02466 * T * (D - T) kg/m
  const roundMatch = t.match(/(?:[øØdдф]\s*|(?:труба|boru)[^0-9]{0,25})(\d{2,3})\s*[*xх×]\s*(\d{1,2}(?:\.\d+)?)(?=\s*(?:мм|mm|\(|gost|гост|$))/i);
  if (roundMatch) {
    const diam = parseInt(roundMatch[1]);
    const thickness = parseFloat(roundMatch[2]);
    if (diam >= 15 && diam <= 630 && thickness >= 1.2 && thickness <= 25 && thickness < diam / 2) {
      const weightPerM = Number((0.02466 * thickness * (diam - thickness)).toFixed(2));
      return { width: diam, height: diam, thickness, weightPerM };
    }
  }
  return null;
}

/**
 * Şveller (U-Profil) özelliklerini çıkarır (Örn: 20P, 16P, 10P, Şveller 10, Şveller 18)
 */
export function extractChannelSpecs(text: string): { channelNumber: string; weightPerM: number } | null {
  if (!text) return null;
  const CHANNEL_MASS: Record<string, number> = {
    '6.5': 5.90, '8': 7.05, '10': 8.59, '12': 10.40, '14': 12.30,
    '16': 14.20, '18': 16.30, '20': 18.40, '22': 21.00, '24': 24.00,
    '27': 27.70, '30': 31.80
  };

  const match = text.match(/(?:швеллер|şveller|u[\s-]*profil)\s*(?:№\s*)?(\d{1,2}(?:\.\d+)?)\s*([ппууpP])?/i) ||
                text.match(/(\d{1,2})\s*([ппууpP])\b/i);
  if (match) {
    const num = match[1];
    if (CHANNEL_MASS[num] || (parseFloat(num) >= 6 && parseFloat(num) <= 40)) {
      const weightPerM = CHANNEL_MASS[num] || Number((parseFloat(num) * 0.92).toFixed(2));
      return { channelNumber: `${num}P`, weightPerM };
    }
  }
  return null;
}

/**
 * Profil, demir veya köşebent boy uzunluğunu metre olarak çıkarır (Örn: "дл 6м", "3 m", "12m", "11.7m")
 */
export function extractLengthMeters(text: string): number {
  if (!text) return 6.0;
  const t = text.replace(/,/g, '.');

  // 1. Explicit length keywords (дл, длина, L=, boy=)
  const explicit = t.match(/(?:дл\.?|длина|дл|l\s*[:=]|boy\s*[:=]?)\s*(\d+(?:\.\d+)?)\s*(?:мм|mm|м|m)?/i);
  if (explicit && explicit[1]) {
    const val = parseFloat(explicit[1]);
    if (val >= 1000 && val <= 24000) return Number((val / 1000).toFixed(2));
    if (val >= 1 && val <= 24) return val;
  }

  // 2. Standalone length in meters or mm (e.g. "L=3000 ММ", "3 m", "3 м", "6m", "6м", "12m", "11.7m")
  const mmLen = t.match(/\b(3000|6000|11700|12000)\s*(?:мм|mm)\b/i);
  if (mmLen && mmLen[1]) {
    return Number((parseFloat(mmLen[1]) / 1000).toFixed(2));
  }
  const iso = 
    t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+(?:\.\d+)?)\s*(?:м|m)(?:\s*(?:ст|st|гост|gost|ту|tu|\(|$)|$)/i) ||
    t.match(/(?:^|[^0-9a-zA-Zа-яА-Я])(\d+(?:\.\d+)?)\s*(?:м|m)(?:$|[^0-9a-zA-Zа-яА-Я])/i);

  if (iso && iso[1]) {
    const val = parseFloat(iso[1]);
    if (val >= 1 && val <= 24) return val;
  }

  // 3. Fallback to standard 6.0m
  return 6.0;
}

/**
 * Yalıtım membranı veya jeotekstil rulo alanını çıkarır (Örn: "10м2", "15 м2", "2х50м", "100 м2")
 */
export function extractRollAreaM2(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/,/g, '.');

  // 1. Doğrudan m2 belirtimi: (10м2), (15 м2), (300м2), (1 RULO 300 M2), 100 кв.м
  const areaMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:м2|m2|м²|m²|кв\.м|квм|sqm)/i);
  if (areaMatch && areaMatch[1]) {
    const val = parseFloat(areaMatch[1]);
    if (val >= 5 && val <= 1000) return val;
  }

  // 2. Boyut çarpımı: 3х100м, 3*100 MT, 2х50м, 1х10м, 1х15м, 2x50
  const dimMatch = lower.match(/(?:^|[^0-9xх*×])(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)\s*(?:м\b|m\b|mt\b|метр|$|\)|\s)/i);
  if (dimMatch && dimMatch[1] && dimMatch[2]) {
    const w = parseFloat(dimMatch[1]);
    const l = parseFloat(dimMatch[2]);
    // Genişlik 0.5m..6m ve uzunluk 5m..200m ise (örn: 3x100 = 300 m², 2x50 = 100 m²)
    if (w >= 0.5 && w <= 6 && l >= 5 && l <= 300) {
      const area = Number((w * l).toFixed(2));
      if (area >= 5 && area <= 1000) return area;
    }
  }

  return null;
}

/**
 * Plaka, levha, branda, tente veya ızgara malzemelerinin alanını (m²) çıkarır
 */
export function extractBoardAreaM2(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/,/g, '.');

  // 0. Doğrudan parantez içi alan: örn "(24 м2)"
  const explicitM2 = lower.match(/\(\s*(\d+(?:\.\d+)?)\s*(?:м2|m2|м²|m²)\s*\)/i);
  if (explicitM2 && explicitM2[1]) {
    const val = parseFloat(explicitM2[1]);
    if (val >= 0.2 && val <= 300) return val;
  }

  // 1. 3 boyutlu levha (kalınlık x en x boy veya en x boy x kalınlık): örn 18х1220х2440, 1220x2440x18, 2500*1200*12.5
  const match3d = lower.match(/(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)/i);
  if (match3d) {
    const nums = [parseFloat(match3d[1]), parseFloat(match3d[2]), parseFloat(match3d[3])].sort((a, b) => a - b);
    // En büyük iki boyut en ve boydur (mm cinsinden: 500..4000)
    const w = nums[1];
    const l = nums[2];
    if (w >= 400 && w <= 4000 && l >= 400 && l <= 6000) {
      return Number(((w / 1000) * (l / 1000)).toFixed(4));
    }
  }

  // 2. 2 boyutlu büyük mm boyutları: örn 1220х2440, 2440х1220, 1200x2500, 1250x2500
  const mmMatch = lower.match(/(\d{3,4})\s*[xх*×]\s*(\d{3,4})/i);
  if (mmMatch) {
    const d1 = parseFloat(mmMatch[1]) / 1000;
    const d2 = parseFloat(mmMatch[2]) / 1000;
    const area = d1 * d2;
    if (area >= 0.2 && area <= 50) return Number(area.toFixed(4));
  }

  // 3. Açık metre veya cm boyut çarpımı: Örn: 4х6 м, размер 4х6м, 80*80
  const dimMatch = lower.match(/(?:размер\s*)?(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)\s*(?:м\b|м2|m\b|m2|см|cm|мм|mm)?/i);
  if (dimMatch && dimMatch[1] && dimMatch[2]) {
    let dim1 = parseFloat(dimMatch[1]);
    let dim2 = parseFloat(dimMatch[2]);
    if (dim1 >= 100 && dim2 >= 100) {
      dim1 = dim1 / 1000;
      dim2 = dim2 / 1000;
    } else if (dim1 >= 30 && dim1 <= 99 && dim2 >= 30 && dim2 <= 99) {
      // cm cinsinden (örn: 80*80 cm ızgara -> 0.8m x 0.8m = 0.64 m²)
      dim1 = dim1 / 100;
      dim2 = dim2 / 100;
    }
    const area = dim1 * dim2;
    if (area >= 0.2 && area <= 300) return Number(area.toFixed(4));
  }

  return null;
}

/**
 * Kontrplak (Plywood), OSB veya plaka malzemelerinin tek plaka hacmini (m³) çıkarır
 * Örn: 18х1220х2440 -> 0.018 * 1.22 * 2.44 = 0.0535824 m³
 */
export function extractBoardVolumeM3(text: string): { thicknessMm: number; areaM2: number; volumeM3: number } | null {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/,/g, '.');

  let thicknessMm: number | null = null;
  const match3d = lower.match(/(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)\s*[xх*×]\s*(\d+(?:\.\d+)?)/i);
  if (match3d) {
    const nums = [parseFloat(match3d[1]), parseFloat(match3d[2]), parseFloat(match3d[3])].sort((a, b) => a - b);
    if (nums[0] >= 3 && nums[0] <= 50 && nums[1] >= 400 && nums[2] >= 400) {
      thicknessMm = nums[0];
      const areaM2 = Number(((nums[1] / 1000) * (nums[2] / 1000)).toFixed(4));
      const volumeM3 = Number((areaM2 * (thicknessMm / 1000)).toFixed(6));
      return { thicknessMm, areaM2, volumeM3 };
    }
  }

  const thickMatch = lower.match(/(?:^|[^0-9xх*])(6|8|9|10|12|12\.5|15|18|20|21|24|27|30|35|40|50|60|80|100|120|150|200)\s*(?:мм|mm)\b/i);
  if (thickMatch) {
    thicknessMm = parseFloat(thickMatch[1]);
  } else if (lower.includes('фанер') || lower.includes('kontrplak') || lower.includes('plywood')) {
    thicknessMm = 18;
  }

  if (thicknessMm) {
    const isXps = /пеноплэкс|пеноплекс|penoplex|\bxps\b/i.test(lower);
    const defaultArea = isXps ? 0.6932 : ((lower.includes('1250') || lower.includes('осб') || lower.includes('osb')) ? 3.125 : 2.9768);
    const areaM2 = extractBoardAreaM2(lower) || defaultArea;
    const volumeM3 = Number((areaM2 * (thicknessMm / 1000)).toFixed(6));
    return { thicknessMm, areaM2, volumeM3 };
  }

  return null;
}

/**
 * Ambalaj paket ağırlığını veya hacmini çıkarır (Örn: "25 кг", "50 kg", "15 л", "20 kg", "3,2 кг")
 */
export function extractPackageVolumeOrWeight(text: string): { value: number; unit: 'kg' | 'l' } | null {
  if (!text) return null;
  const lower = text.toLowerCase().replace(/,/g, '.');

  const weightMatch = lower.match(/(?:1\s*\/\s*)?(\d+(?:\.\d+)?)\s*(?:кг|kg|kilo)(?=$|[^a-zA-Zа-яА-ЯёЁ0-9])/i);
  if (weightMatch && weightMatch[1]) {
    const val = parseFloat(weightMatch[1]);
    if (val > 0 && val <= 1000) return { value: val, unit: 'kg' };
  }

  const volMatch = lower.match(/(?:1\s*\/\s*)?(\d+(?:\.\d+)?)\s*(?:л|l|lt|litre)(?=$|[^a-zA-Zа-яА-ЯёЁ0-9])/i);
  if (volMatch && volMatch[1]) {
    const val = parseFloat(volMatch[1]);
    if (val > 0 && val <= 1000) return { value: val, unit: 'l' };
  }

  return null;
}

/**
 * Gazbeton, duvar bloğu veya kereste boyutlarını çıkarıp tek adet hacmini (m³) hesaplar
 * Örn: "200х250х600 мм" -> 0.2 * 0.25 * 0.6 = 0.03 m³
 *      "40x200x6000 мм" -> 0.04 * 0.20 * 6.0 = 0.048 m³
 */
export function extractGazbetonDimensions(text: string): { width: number; height: number; length: number; volumeM3: number } | null {
  if (!text) return null;
  const t = text.replace(/,/g, '.');
  const match = t.match(/(\d{2,4})\s*[*xх]\s*(\d{2,4})\s*[*xх]\s*(\d{2,4})/i);
  if (match) {
    const w = parseFloat(match[1]);
    const h = parseFloat(match[2]);
    const l = parseFloat(match[3]);
    if (w >= 20 && w <= 1000 && h >= 20 && h <= 1000 && l >= 100 && l <= 6500) {
      const volumeM3 = Number(((w / 1000) * (h / 1000) * (l / 1000)).toFixed(5));
      return { width: w, height: h, length: l, volumeM3 };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// 3. STANDART BİRİM NORMALİZASYONU (CANONICAL UNIT NORMALIZER)
// ----------------------------------------------------------------------------

export function normalizeStandardUnit(rawUnit?: string): string {
  if (!rawUnit) return 'adet';
  const u = String(rawUnit).toLowerCase().trim().replace(/[.,/\\()]/g, '');

  if (['ton', 'т', 'tn', 'тонн', 'тонна', 'тонны', 'tonnes', 'tonne'].includes(u)) return 'ton';
  if (['kg', 'кг', 'kilo', 'kilogram', 'килограмм'].includes(u)) return 'kg';
  if (['m3', 'm³', 'м3', 'м³', 'metrekup', 'metreküp', 'куб', 'кубм', 'cbm'].includes(u)) return 'm³';
  if (['m2', 'm²', 'м2', 'м²', 'metrekare', 'квм', 'квм.', 'sqm'].includes(u)) return 'm²';
  if (['m', 'mt', 'metre', 'метр', 'м', 'пм', 'погм', 'пог.м', 'мп', 'metretül', 'mtul'].includes(u)) return 'metre';
  if (['rulo', 'рулон', 'rul', 'рул', 'roll', 'rolls'].includes(u)) return 'rulo';
  if (['torba', 'bag', 'мешок', 'меш', 'мешков'].includes(u)) return 'torba';
  if (['palet', 'пал', 'паллет', 'паллета', 'поддон'].includes(u)) return 'palet';
  if (['plaka', 'plk', 'лист', 'лист.', 'листов', 'tabaka', 'panel', 'board'].includes(u)) return 'plaka';
  if (['kova', 'teneke', 'ведро', 'вед', 'canister', 'bidon'].includes(u)) return 'kova';
  if (['lt', 'l', 'litre', 'литр', 'л'].includes(u)) return 'lt';
  if (['çift', 'cift', 'пар', 'пара', 'пары'].includes(u)) return 'çift';
  if (['kutu', 'box', 'коробка', 'кор', 'koli'].includes(u)) return 'kutu';
  if (['paket', 'pkt', 'пакет', 'упак', 'upak', 'упаковка'].includes(u)) return 'paket';
  if (['takım', 'takim', 'set', 'компл', 'комплект', 'к-т', 'кт'].includes(u)) return 'takım';
  if (['sefer', 'nakliye', 'рейс', 'рейсы', 'hizmet', 'hizm'].includes(u)) return 'sefer';
  if (['adet', 'ad', 'шт', 'штук', 'штука', 'pcs', 'piece', 'ед', 'boy'].includes(u)) return 'adet';

  return u;
}

// ----------------------------------------------------------------------------
// 4. MALZEME BAZLI STANDART KIYASLAMA BİRİMİ TESPİTİ (BENCHMARK UNIT)
// ----------------------------------------------------------------------------

/**
 * Malzemenin cinsine göre piyasa standardı kıyaslama birimini belirler.
 * DİKKAT: Kategori adı metin aramasına dahil EDİLMEZ (ör. "Seramik & Vitrifiye" kategorisindeki
 * klozet fırçası veya bataryanın "seramik" kelimesinden dolayı m²'ye dönmesini önler).
 */
export function getMaterialBenchmarkUnit(materialName: string, _category?: string, currentUnits: string[] = []): string {
  const text = String(materialName || '').toLowerCase();
  const normalizedUnits = currentUnits.map(normalizeStandardUnit);

  // Yangın hortumu bağlantılı/boyu sabit set olarak (20 m, rakorlu) satılır: kıyas her zaman ADET başına yapılır.
  // Metre başına bölmek (1425 ₽ / 20 m = 71,25 ₽) ile metre sanılan adet fiyatı (1320 ₽) kıyaslanıp sahte %1750 fark çıkıyordu.
  if (/yangın\s*hortumu|yangin\s*hortumu|рукав\s*пожарн/i.test(text)) {
    return 'adet';
  }

  // 0. KESİN ADET KALEMLERİ (Vitrifiye, Fırça, El Aleti, Aydınlatma, Kapak, Manşon, Dübel, Cıvata, Somun, Pul, Saplama, Paspayı, Tüp vb.)
  if (
    /fırça|firca|ершик|кисть|щетк|унитаз|klozet|раковин|lavabo|смесител|batarya|무фта|муфта|manşon|manson|дюбел|dübel|dubel|гвозд|çivi|civi|болт|cıvata|civata|гайк|somun|шайб|pul\b|rondela|шпильк|saplama|tij\b|gijon|саморез|vida\b|фиксатор|paspay|анкер|ankraj|کлетка|клетка|тележк|баллон|tüpü|tupu|saati|редуктор|горелк|pürmüz|purmuz|conta|прокладк|хомут|kelepçe|kablo bağı|mandal|kilit|menteşe|петля|ручка|kalem|klasör|dosya|sandalye|koltuk|masa|dolap|ranza|yatak|baret|yelek|gözlük|очки|botu|ayakkabı|ботинк|светильник|прожектор|лампа|aydınlatma|aydinlatma|люк\b|kapak|kapağı|kapagi|рубанок|rende|терка|кельма|шпатель|spatula|ножовка|testere|штроборез|захват|миксер|пистолет|tabanca|герметик|germetik|лента|скотч|bant|валик|rulo|кювета|ванночка|стенд|pano|panosu|yangın\s*hortumu|рукав\s*пожарн|lazer|указка|тахеометр|taheometre|нивелир|nivo|çöp\s*poşet|cop\s*poset|çöp\s*torba|мешк.*мусор|küp\s*şeker|сахар\s*кусков/i.test(text) &&
    !/paspas ızgarası|membran|мембран|yalıtım|изопласт|izoplast|техноэласт|техноеласт|икопал|icopal|виллатекс|villateks|ультранап|ultranap|биполь|bipol|рулонн|geotekstil|jeotekstil|геотекстил|дорнит|inşaat naylonu|пленка|alçıpan|гипсокартон/i.test(text)
  ) {
    if (normalizedUnits.includes('adet')) return 'adet';
    if (normalizedUnits.includes('çift')) return 'çift';
    if (normalizedUnits.includes('takım')) return 'takım';
    if (normalizedUnits.includes('paket')) return 'paket';
    if (normalizedUnits.includes('rulo')) return 'rulo';
    return normalizedUnits[0] || 'adet';
  }

  // 1. ÇELİK HASIR & DONATI FİLESİ (Piyasa Standardı: m²)
  if (
    /hasır|hasir|çelik.*hasır|hasır.*çelik|сетк.*(сварн|арматурн|кладочн|вр|фасадн|стеклоткан|базальт)|сетка.*100х100|сетка.*150х150|сетка.*50х50/i.test(text) &&
    !/кресло|кровать|ранза|koltuk/i.test(text)
  ) {
    return 'm²';
  }

  // 2. KÖŞEBENT DEMİR (L-PROFİL) (Metre veya Ton)
  if (
    (/köşebent|kosebent|уголок|l\s*demir|l\s*profil/i.test(text) ||
     (text.includes('угол') && /\d{2,3}\s*[*xх]\s*\d{2,3}/.test(text))) &&
    !/папка|салфет|щеток|кровать|петля|двер|внутренний/i.test(text)
  ) {
    if (normalizedUnits.includes('ton')) return 'ton';
    if (normalizedUnits.includes('metre')) return 'metre';
    if (normalizedUnits.includes('adet')) return 'metre';
    return 'metre';
  }

  // 3. KUTU PROFİL / PROFİL BORU & ÇELİK BORU
  if (
    /труба.*профильн|профильн.*труб|kutu.*profil|profil.*boru|kare.*profil|труба.*э\/с|труба.*электросварн|труба.*вгп|труба.*стальн|boru.*demir.*dikişli|boru.*demir.*dikisli|çelik.*boru/i.test(text) &&
    !/каркас.*ворот|калитка|çit|çevre.*paneli|ппр|ppr|пнд|pnd/i.test(text)
  ) {
    if (normalizedUnits.includes('ton')) return 'ton';
    if (normalizedUnits.includes('metre')) return 'metre';
    if (normalizedUnits.includes('adet')) return 'metre';
    return 'metre';
  }

  // 4. GAZBETON & DUVAR BLOKLARI & KERESTE (Piyasa Standardı: m³)
  if (
    /газобетон|gazbeton|bonolit|poritep|ytong|istkult|исткульт|шлакоблок|кбб|kereste|kalas|tahta|доска обрезн|брус обрезн|брус не строган/i.test(text) &&
    !/клей|yapıştırıcı|yapistirici|harç|harc|dübel|dubel|анкер|саморез|testere|ножовка/i.test(text)
  ) {
    return 'm³';
  }

  // 5. KONTRPLAK / PLYWOOD (m³ veya m² — mevcut birimlerde m³ varsa m³, yoksa m²)
  if (/фанер|kontrplak|plywood/i.test(text)) {
    if (normalizedUnits.includes('m³')) return 'm³';
    return 'm²';
  }

  // 6. İnşaat Demiri & Bağ Teli (Standart: Ton)
  if (
    (text.includes('арматур') ||
     text.includes('inşaat demir') ||
     text.includes('insaat demir') ||
     text.includes('nervür') ||
     text.includes('demir nervurlu') ||
     text.includes('a500') ||
     text.includes('а500') ||
     text.includes('bağ teli') ||
     text.includes('bag teli') ||
     text.includes('bağlama teli') ||
     (text.includes('проволока') && text.includes('1.2'))) &&
    !/запорн|трубопроводн|сантехнич|сливн|кран|vana|valf|муфта|manşon|manson|фиксатор|paspay|колпачок|грибок|güvenlik\s*başlığ/i.test(text)
  ) {
    return 'ton';
  }

  // 6.5. Alçıpan Profilleri & Sıva Profilleri (Standart: Adet veya Metre)
  if (/alçıpan.*profil|alcipan.*profil|профиль.*(?:knauf|кнауф|пс|пн|пп|пнп|гкл|гипсокартон|маячков)|alçıpan\s*takviye\s*profil|sıva\s*kılavuz\s*profil/i.test(text)) {
    if (normalizedUnits.includes('adet')) return 'adet';
    if (normalizedUnits.includes('metre')) return 'metre';
    return normalizedUnits[0] || 'adet';
  }

  // 7. Yalıtım, Membran, Jeotekstil, Alçıpan Levha, OSB, Branda/Tente, Polietilen İnşaat Naylonu, Seramik Karo
  const isDrywallSheet =
    (text.includes('гипсокартон') || text.includes('alçıpan') || text.includes('alcipan') || text.includes('гкл')) &&
    !/профил|profil|agraf|подвес|vida|саморез|dübel|dubel|testere|ножовка|bıçak|bicak|фрез|freze|bant|лента|серпянк|люк|kapak|kapağ/i.test(text);
  if (
    text.includes('мембран') ||
    text.includes('membran') ||
    text.includes('изопласт') ||
    text.includes('izoplast') ||
    text.includes('техноэласт') ||
    text.includes('техноеласт') ||
    text.includes('геотекстил') ||
    text.includes('jeotekstil') ||
    text.includes('geotekstil') ||
    text.includes('дорнит') ||
    (text.includes('битум') && !/праймер|astar|мастик|mastik|герметик/i.test(text)) ||
    isDrywallSheet ||
    text.includes('осб') ||
    text.includes('osb') ||
    text.includes('inşaat naylonu') ||
    text.includes('пленка укрывная') ||
    text.includes('пленка техническая') ||
    text.includes('branda') ||
    text.includes('tente') ||
    text.includes('тент') ||
    text.includes('керамогранит') ||
    text.includes('seramik karo') ||
    text.includes('yer karosu')
  ) {
    return 'm²';
  }

  // 7.5. Torbalı Kuru Tamir Harcı, Gazbeton/Seramik Yapıştırıcı, Пескобетон, Sıva & Alçı (Standart: kg veya torba)
  if (
    /tamir\s*harcı|tamir\s*harci|gazbeton\s*yapıştırıcı|клей.*газобетон|пескобетон|peskobeton|сухая.*смесь|kuru.*karışım|ремонтн.*состав|подливочн.*состав|litokol|glims|mapei|planitop|kalekim|плиточн.*клей|seramik.*yapıştırıcı|fayans.*yapıştırıcı|штукатурк|ротбанд|rotband|шпаклевк|шпатлевк/i.test(text)
  ) {
    if (normalizedUnits.includes('kg')) return 'kg';
    if (normalizedUnits.includes('torba')) return 'torba';
    return 'kg';
  }

  // 8. Hazır Beton, Şap, Agrega, Kum, Keramzit
  if (
    text.includes('бетон') ||
    text.includes('beton') ||
    text.includes('раствор') ||
    text.includes('şap') ||
    text.includes('песок') ||
    text.includes('kum') ||
    text.includes('щебень') ||
    text.includes('çakıl') ||
    text.includes('cakil') ||
    text.includes('keramzit') ||
    text.includes('керамзит')
  ) {
    return 'm³';
  }

  // 9. Kablo, Hortum, Çelik Halat, Delikli Şerit
  if (text.includes('кабел') || text.includes('kablo') || text.includes('провод') || text.includes('hortum') || text.includes('halat') || text.includes('perfo lenta')) {
    if (normalizedUnits.includes('metre')) return 'metre';
  }

  // 10. Kalıp Yağı, Boya & Sıvı İzolasyon
  if (/kalıp\s*ayırıcı\s*yağ|kalıp\s*yağ|kalip\s*yag|масло.*опалуб|смазка.*опалуб|эмульсол/i.test(text)) {
    return 'lt';
  }
  if (text.includes('краск') || text.includes('boya') || text.includes('эмаль') || text.includes('emal') || text.includes('пф-115') || text.includes('pf-115') || text.includes('грунтовк') || text.includes('astar') || text.includes('эпоксид') || text.includes('epoksi')) {
    if (normalizedUnits.includes('kg')) return 'kg';
    if (normalizedUnits.includes('lt') && !normalizedUnits.includes('adet') && !normalizedUnits.includes('kova')) return 'lt';
    return 'kg';
  }

  // 11. Mevcut birimler arasında en mantıklı olanı seç
  if (normalizedUnits.includes('ton')) return 'ton';
  if (normalizedUnits.includes('m²')) return 'm²';
  if (normalizedUnits.includes('m³')) return 'm³';
  if (normalizedUnits.includes('metre')) return 'metre';
  if (normalizedUnits.includes('kg')) return 'kg';
  if (normalizedUnits.includes('lt')) return 'lt';

  return normalizedUnits[0] || 'adet';
}

// ----------------------------------------------------------------------------
// 5. MERKEZİ AKILLI BİRİM DÖNÜŞÜM FONKSİYONU (THE CORE CONVERTER)
// ----------------------------------------------------------------------------

export function convertMaterialUnit(params: {
  materialName: string;
  category?: string;
  rawItemName?: string;
  fromUnit: string;
  toUnit: string;
  unitPrice: number;
  quantity: number;
}): UnitConversionResult {
  const { materialName, category, rawItemName, unitPrice, quantity } = params;
  const from = normalizeStandardUnit(params.fromUnit);
  const to = normalizeStandardUnit(params.toUnit);

  // DİKKAT: Kategori adı (ör. "Yalıtım & Alçıpan" veya "Seramik & Vitrifiye") text aramasına dahil EDİLMEZ;
  // aksi halde o kategorideki keramzit veya aksesuarlar "alçıpan"/"seramik" kelimesinden dolayı levha sanılır!
  const text = `${materialName} ${rawItemName || ''}`.toLowerCase();

  // 0. Aynı birim yazılmış olsa dahi açık koli/paket çarpanı varsa (örn: "20 упаковок по 1 кг" = 2500 ₽ veya plastik paspayında "упаковка 1000шт" = 1500 ₽)
  const masterCartonMatch = text.match(/(\d+)\s*упаков(?:ок|ки)\s*по\s*\d+\s*(?:кг|г|л)/i);
  if (masterCartonMatch && unitPrice >= 500 && (to === 'adet' || to === 'paket')) {
    const cartonCount = parseInt(masterCartonMatch[1], 10);
    if (cartonCount >= 2 && cartonCount <= 100) {
      return {
        convertedUnitPrice: Number((unitPrice / cartonCount).toFixed(2)),
        convertedQuantity: Number((quantity * cartonCount).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: cartonCount,
        formula: `1 Koli = ${cartonCount} Paket`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }
  }
  if (/paspay|фиксатор/i.test(text) && !/бетон|кость|лягушк|sehpa/i.test(text) && unitPrice >= 200 && to === 'adet') {
    const spPackMatch =
      text.match(/(\d+)\s*(?:шт|adet)\s*(?:\/|\s*в\s*|\s*-\s*|\s*)(?:уп|пакет|кор|paket)/i) ||
      text.match(/(?:уп|упак|упаковка|пакет|paket)\s*[-:.]?\s*(\d+)\s*(?:шт|adet)/i) ||
      text.match(/\(\s*(\d+)\s*(?:шт|adet)\b/i);
    const spCount = spPackMatch ? parseInt(spPackMatch[1], 10) : 500;
    if (spCount >= 50 && spCount <= 5000) {
      return {
        convertedUnitPrice: Number((unitPrice / spCount).toFixed(2)),
        convertedQuantity: Number((quantity * spCount).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: spCount,
        formula: `1 Paket = ${spCount} Adet`,
        confidence: spPackMatch ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }
  if (/лазерная\s*указка|green\s*laser\s*303/i.test(text) && unitPrice > 50 && unitPrice < 150 && to === 'adet') {
    return {
      convertedUnitPrice: Number((unitPrice * 10).toFixed(2)),
      convertedQuantity: Math.max(1, Number((quantity / 10).toFixed(2))),
      fromUnit: from,
      toUnit: to,
      factor: 0.1,
      formula: '1 Adet Lazer İşaretleyici',
      confidence: 'EXACT',
      conversionApplied: true
    };
  }

  // 1. Aynı birim ise doğrudan dön
  if (from === to) {
    return {
      convertedUnitPrice: unitPrice,
      convertedQuantity: quantity,
      fromUnit: from,
      toUnit: to,
      factor: 1,
      formula: 'Birimler özdeş',
      confidence: 'EXACT',
      conversionApplied: false
    };
  }

  // --------------------------------------------------------------------------
  // A. AĞIRLIK - AĞIRLIK (KG <-> TON)
  // --------------------------------------------------------------------------
  if (from === 'kg' && to === 'ton') {
    // 1 kg = 0.001 ton
    // Fiyat: 65 ₽/kg -> 65,000 ₽/ton
    // Miktar: 5,000 kg -> 5 ton
    return {
      convertedUnitPrice: unitPrice * 1000,
      convertedQuantity: quantity / 1000,
      fromUnit: from,
      toUnit: to,
      factor: 0.001,
      formula: '1 Ton = 1.000 kg',
      confidence: 'EXACT',
      conversionApplied: true
    };
  }

  if (from === 'ton' && to === 'kg') {
    return {
      convertedUnitPrice: unitPrice / 1000,
      convertedQuantity: quantity * 1000,
      fromUnit: from,
      toUnit: to,
      factor: 1000,
      formula: '1 Ton = 1.000 kg',
      confidence: 'EXACT',
      conversionApplied: true
    };
  }

  // --------------------------------------------------------------------------
  // B. İNŞAAT DEMİRİ (METRE / BOY <-> TON / KG)
  // SADECE yapısal donatının kendisi için geçerlidir. Sarf, paket, aksesuar veya
  // başka kategoriye ait ürünler ASLA inşaat demiri ağırlık formülüyle çarpılamaz.
  // --------------------------------------------------------------------------
  const isRebarAccessoryOrConsumable =
    text.includes('колпачок') ||
    text.includes('грибок') ||
    text.includes('güvenlik mantar') ||
    text.includes('koruyucu başlık') ||
    text.includes('koruyucu baslik') ||
    text.includes('güvenlik başlığı') ||
    text.includes('guvenlik basligi') ||
    text.includes('kolpaçok') ||
    text.includes('kolpacok') ||
    text.includes('фиксатор') ||
    text.includes('паспой') ||
    text.includes('paspay') ||
    text.includes('çiroz') ||
    text.includes('ciroz') ||
    text.includes('donatı sehpa') ||
    text.includes('лягушк') ||
    text.includes('крючок') ||
    text.includes('пистолет') ||
    text.includes('ножниц') ||
    text.includes('станок') ||
    text.includes('смазка') ||
    text.includes('зубило') ||
    text.includes('keski') ||
    text.includes('вязальн') ||
    text.includes('bağ teli') ||
    text.includes('bag teli') ||
    text.includes('tavlı tel') ||
    text.includes('sarf') ||
    text.includes('hırdavat') ||
    text.includes('hirdavat') ||
    text.includes('упаковка') ||
    text.includes('paket');

  const cleanCategory = String(category || '').trim().toLowerCase();
  const isExcludedCategory = 
    cleanCategory.includes('sarf') ||
    cleanCategory.includes('hırdavat') ||
    cleanCategory.includes('hirdavat') ||
    cleanCategory.includes('güvenlik') ||
    cleanCategory.includes('isg') ||
    cleanCategory.includes('kimyasal') ||
    cleanCategory.includes('boya') ||
    cleanCategory.includes('elektrik') ||
    cleanCategory.includes('mekanik') ||
    cleanCategory.includes('tesisat') ||
    cleanCategory.includes('donatı malzemeleri');

  const isRebar = 
    !isRebarAccessoryOrConsumable &&
    !isExcludedCategory &&
    (
      text.includes('арматур') ||
      text.includes('inşaat demir') ||
      text.includes('insaat demir') ||
      text.includes('a500') ||
      text.includes('а500') ||
      text.includes('a400') ||
      text.includes('nervür') ||
      text.includes('пруток')
    );

  if (isRebar) {
    const diameter = extractRebarDiameter(materialName) || 12; // Varsayılan Ø12 mm
    const kgPerMeter = getRebarWeightPerMeter(diameter);
    const tonsPerMeter = kgPerMeter / 1000;

    // Metre -> Ton
    if (from === 'metre' && to === 'ton') {
      // 1 metre = tonsPerMeter ton
      // Metre fiyatı 58 ₽/m ise -> 58 / tonsPerMeter ₽/ton
      // Metre miktarı 1,000 m ise -> 1,000 * tonsPerMeter ton
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerMeter).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerMeter,
        formula: `Ø${diameter} Demir: 1 metre = ${kgPerMeter} kg (${tonsPerMeter} ton)`,
        confidence: 'EXACT',
        conversionApplied: true,
        notes: `GOST 5781-82 / TS 708 standardı formülüyle hesaplandı.`
      };
    }

    // Ton -> Metre
    if (from === 'ton' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerMeter,
        formula: `Ø${diameter} Demir: 1 ton = ${(1 / tonsPerMeter).toFixed(1)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Metre -> Kg
    if (from === 'metre' && to === 'kg') {
      return {
        convertedUnitPrice: Number((unitPrice / kgPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * kgPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: kgPerMeter,
        formula: `Ø${diameter} Demir: 1 metre = ${kgPerMeter} kg`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Kg -> Metre
    if (from === 'kg' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * kgPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / kgPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / kgPerMeter,
        formula: `Ø${diameter} Demir: 1 kg = ${(1 / kgPerMeter).toFixed(2)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Adet / Boy -> Ton (Standart inşaat demir boyu 11.7 m)
    if (from === 'adet' && to === 'ton') {
      const barLength = text.includes('12') && text.includes('m') ? 12.0 : 11.7;
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity * weightPerBarTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: weightPerBarTon,
        formula: `1 Boy (${barLength}m Ø${diameter}) = ${(weightPerBarTon * 1000).toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> Adet / Boy
    if (from === 'ton' && to === 'adet') {
      const barLength = text.includes('12') && text.includes('m') ? 12.0 : 11.7;
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice * weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity / weightPerBarTon).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / weightPerBarTon,
        formula: `1 Boy (${barLength}m Ø${diameter}) = ${(weightPerBarTon * 1000).toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // B2. KÖŞEBENT DEMİR (L-PROFİL) (METRE / ADET <-> TON / KG)
  // --------------------------------------------------------------------------
  const isAngleSteel = 
    (/угол[ока]*|köşebent|kosebent|l\s*demir|l\s*profil/i.test(text) &&
    !/петля|щеток|салфетница|кровать|папка|стяжка|угольник.*столярн/i.test(text));

  if (isAngleSteel) {
    const angleSpec = extractAngleDimensions(`${materialName} ${rawItemName || ''}`) || { leg1: 50, leg2: 50, thickness: 4, weightPerM: 3.05 };
    const kgPerMeter = angleSpec.weightPerM;
    const tonsPerMeter = kgPerMeter / 1000;
    const barLength = extractLengthMeters(`${rawItemName || ''} ${materialName}`);

    // Metre -> Ton
    if (from === 'metre' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerMeter).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerMeter,
        formula: `Köşebent ${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness}: 1 metre = ${kgPerMeter} kg (${tonsPerMeter} ton)`,
        confidence: 'EXACT',
        conversionApplied: true,
        notes: 'GOST 8509-93 standardı formülüyle hesaplandı.'
      };
    }

    // Ton -> Metre
    if (from === 'ton' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerMeter,
        formula: `Köşebent ${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness}: 1 ton = ${(1 / tonsPerMeter).toFixed(1)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Metre -> Kg
    if (from === 'metre' && to === 'kg') {
      return {
        convertedUnitPrice: Number((unitPrice / kgPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * kgPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: kgPerMeter,
        formula: `Köşebent ${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness}: 1 metre = ${kgPerMeter} kg`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Kg -> Metre
    if (from === 'kg' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * kgPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / kgPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / kgPerMeter,
        formula: `Köşebent ${angleSpec.leg1}x${angleSpec.leg2}x${angleSpec.thickness}: 1 kg = ${(1 / kgPerMeter).toFixed(2)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Adet -> Metre
    if (from === 'adet' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice / barLength).toFixed(2)),
        convertedQuantity: Number((quantity * barLength).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: barLength,
        formula: `1 Adet Boy = ${barLength} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Metre -> Adet
    if (from === 'metre' && to === 'adet') {
      return {
        convertedUnitPrice: Number((unitPrice * barLength).toFixed(2)),
        convertedQuantity: Number((quantity / barLength).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / barLength,
        formula: `1 Adet Boy = ${barLength} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Ton
    if (from === 'adet' && to === 'ton') {
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity * weightPerBarTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: weightPerBarTon,
        formula: `1 Adet Boy (${barLength}m Köşebent) = ${(weightPerBarTon * 1000).toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> Adet
    if (from === 'ton' && to === 'adet') {
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice * weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity / weightPerBarTon).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / weightPerBarTon,
        formula: `1 Ton = ${(1 / weightPerBarTon).toFixed(1)} Adet Boy (${barLength}m)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // B3. ÇELİK HASIR & DONATI FİLESİ (M² <-> ADET/KART <-> RULO <-> TON / KG)
  // --------------------------------------------------------------------------
  const isWireMesh = 
    (/сетка.*(сварн|кладочн|арматурн|вр|каркас|рабица|базальт|стеклоткан|фасадн)|hasır.*çelik|çelik.*hasır|kaynaklı.*hasır|hasır.*tel/i.test(text) ||
    ((text.includes('сетка') || text.includes('hasır')) && (text.includes('100х100') || text.includes('100x100') || text.includes('150x150') || text.includes('150х150') || text.includes('50x50') || text.includes('50х50'))));

  if (isWireMesh) {
    const meshSpec = extractMeshSpecs(`${materialName} ${rawItemName || ''}`) || { pitchX: 100, pitchY: 100, wireDiam: 4, weightPerM2: 1.97, cardAreaM2: 6.0 };
    const cardArea = meshSpec.cardAreaM2 || (text.includes('2x6') || text.includes('2х6') ? 12.0 : 6.0);
    const rollArea = meshSpec.rollAreaM2 || extractRollAreaM2(`${materialName} ${rawItemName || ''}`) || 50.0;
    const isRollType = /rulo|рулон|фасадн|стеклоткан|базальт|50\s*(?:m2|м2)/i.test(text);
    const effectiveArea = isRollType ? rollArea : cardArea;
    const kgPerM2 = meshSpec.weightPerM2;
    const tonsPerM2 = kgPerM2 / 1000;

    // Adet / Kart -> m²
    if ((from === 'adet' || from === 'plaka') && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice / effectiveArea).toFixed(2)),
        convertedQuantity: Number((quantity * effectiveArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: effectiveArea,
        formula: isRollType ? `1 Adet Rulo (${effectiveArea} m²) = ${effectiveArea} m²` : `1 Kart/Tabaka = ${effectiveArea} m²`,
        confidence: 'HIGH',
        conversionApplied: true,
        notes: `Çelik hasır / file ebadına (${effectiveArea} m²) göre normalize edildi.`
      };
    }

    // m² -> Adet / Kart
    if (from === 'm²' && (to === 'adet' || to === 'plaka')) {
      return {
        convertedUnitPrice: Number((unitPrice * effectiveArea).toFixed(2)),
        convertedQuantity: Number((quantity / effectiveArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / effectiveArea,
        formula: isRollType ? `1 Adet Rulo (${effectiveArea} m²) = ${effectiveArea} m²` : `1 Kart/Tabaka = ${effectiveArea} m²`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Rulo -> m²
    if (from === 'rulo' && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice / rollArea).toFixed(2)),
        convertedQuantity: Number((quantity * rollArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: rollArea,
        formula: `1 Rulo Hasır/File = ${rollArea} m²`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // m² -> Rulo
    if (from === 'm²' && to === 'rulo') {
      return {
        convertedUnitPrice: Number((unitPrice * rollArea).toFixed(2)),
        convertedQuantity: Number((quantity / rollArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / rollArea,
        formula: `1 Rulo Hasır/File = ${rollArea} m²`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> m²
    if (from === 'ton' && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerM2).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerM2).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerM2,
        formula: `Hasır ${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam}: 1 m² = ${kgPerM2} kg (1 ton = ${(1 / tonsPerM2).toFixed(1)} m²)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // m² -> Ton
    if (from === 'm²' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerM2).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerM2).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerM2,
        formula: `Hasır ${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam}: 1 m² = ${kgPerM2} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Ton
    if ((from === 'adet' || from === 'plaka') && to === 'ton') {
      const pieceWeightTon = (effectiveArea * kgPerM2) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / pieceWeightTon).toFixed(2)),
        convertedQuantity: Number((quantity * pieceWeightTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: pieceWeightTon,
        formula: `1 Adet (${effectiveArea} m²) = ${(pieceWeightTon * 1000).toFixed(2)} kg (${pieceWeightTon.toFixed(5)} ton)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> Adet
    if (from === 'ton' && (to === 'adet' || to === 'plaka')) {
      const pieceWeightTon = (effectiveArea * kgPerM2) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice * pieceWeightTon).toFixed(2)),
        convertedQuantity: Number((quantity / pieceWeightTon).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / pieceWeightTon,
        formula: `1 Ton = ${(1 / pieceWeightTon).toFixed(1)} Adet (${effectiveArea} m²)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Rulo -> Ton
    if (from === 'rulo' && to === 'ton') {
      const rollWeightTon = (rollArea * kgPerM2) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / rollWeightTon).toFixed(2)),
        convertedQuantity: Number((quantity * rollWeightTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: rollWeightTon,
        formula: `1 Rulo (${rollArea} m²) = ${(rollWeightTon * 1000).toFixed(2)} kg (${rollWeightTon.toFixed(5)} ton)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> Rulo
    if (from === 'ton' && to === 'rulo') {
      const rollWeightTon = (rollArea * kgPerM2) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice * rollWeightTon).toFixed(2)),
        convertedQuantity: Number((quantity / rollWeightTon).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / rollWeightTon,
        formula: `1 Ton = ${(1 / rollWeightTon).toFixed(1)} Rulo (${rollArea} m²)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Rulo
    if ((from === 'adet' || from === 'plaka') && to === 'rulo') {
      const ratio = effectiveArea / rollArea;
      return {
        convertedUnitPrice: Number((unitPrice / ratio).toFixed(2)),
        convertedQuantity: Number((quantity * ratio).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: ratio,
        formula: `1 Adet (${effectiveArea} m²) = ${ratio.toFixed(2)} Rulo (${rollArea} m²)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Rulo -> Adet
    if (from === 'rulo' && (to === 'adet' || to === 'plaka')) {
      const ratio = rollArea / effectiveArea;
      return {
        convertedUnitPrice: Number((unitPrice * ratio).toFixed(2)),
        convertedQuantity: Number((quantity / ratio).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: ratio,
        formula: `1 Rulo (${rollArea} m²) = ${ratio.toFixed(1)} Adet (${effectiveArea} m²)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Kg -> m²
    if (from === 'kg' && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice * kgPerM2).toFixed(2)),
        convertedQuantity: Number((quantity / kgPerM2).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / kgPerM2,
        formula: `Hasır ${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam}: 1 m² = ${kgPerM2} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // m² -> Kg
    if (from === 'm²' && to === 'kg') {
      return {
        convertedUnitPrice: Number((unitPrice / kgPerM2).toFixed(2)),
        convertedQuantity: Number((quantity * kgPerM2).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: kgPerM2,
        formula: `Hasır ${meshSpec.pitchX}x${meshSpec.pitchY}x${meshSpec.wireDiam}: 1 m² = ${kgPerM2} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Kg
    if ((from === 'adet' || from === 'plaka') && to === 'kg') {
      const cardKg = effectiveArea * kgPerM2;
      return {
        convertedUnitPrice: Number((unitPrice / cardKg).toFixed(2)),
        convertedQuantity: Number((quantity * cardKg).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: cardKg,
        formula: `1 Adet (${effectiveArea} m²) = ${cardKg.toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Kg -> Adet
    if (from === 'kg' && (to === 'adet' || to === 'plaka')) {
      const cardKg = effectiveArea * kgPerM2;
      return {
        convertedUnitPrice: Number((unitPrice * cardKg).toFixed(2)),
        convertedQuantity: Number((quantity / cardKg).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / cardKg,
        formula: `1 Adet (${effectiveArea} m²) = ${cardKg.toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // B4. KUTU PROFİL, PROFİL BORU & ÇELİK BORU (METRE / ADET <-> TON / KG)
  // --------------------------------------------------------------------------
  const isProfilePipe = 
    /труба.*профильн|профильн.*труб|profil.*boru|kutu.*profil|kare.*kutu.*profil|dikdörtgen.*kutu.*profil|труба.*э\/с|труба.*электросварн|труба.*вгп|труба.*стальн|boru.*demir.*dikişli|boru.*demir.*dikisli|çelik.*boru/i.test(text);

  if (isProfilePipe) {
    const pipeSpec = extractProfilePipeSpecs(`${materialName} ${rawItemName || ''}`) || { width: 50, height: 50, thickness: 3, weightPerM: 4.31 };
    const kgPerMeter = pipeSpec.weightPerM;
    const tonsPerMeter = kgPerMeter / 1000;
    const barLength = extractLengthMeters(`${rawItemName || ''} ${materialName}`);

    // Metre -> Ton
    if (from === 'metre' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerMeter).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerMeter,
        formula: `Profil/Boru ${pipeSpec.width}x${pipeSpec.height}x${pipeSpec.thickness}: 1 metre = ${kgPerMeter} kg (${tonsPerMeter} ton)`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Ton -> Metre
    if (from === 'ton' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerMeter,
        formula: `Profil/Boru ${pipeSpec.width}x${pipeSpec.height}x${pipeSpec.thickness}: 1 ton = ${(1 / tonsPerMeter).toFixed(1)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Adet -> Metre
    if (from === 'adet' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice / barLength).toFixed(2)),
        convertedQuantity: Number((quantity * barLength).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: barLength,
        formula: `1 Adet Boy = ${barLength} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Metre -> Adet
    if (from === 'metre' && to === 'adet') {
      return {
        convertedUnitPrice: Number((unitPrice * barLength).toFixed(2)),
        convertedQuantity: Number((quantity / barLength).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / barLength,
        formula: `1 Adet Boy = ${barLength} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Ton
    if (from === 'adet' && to === 'ton') {
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity * weightPerBarTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: weightPerBarTon,
        formula: `1 Adet Boy (${barLength}m Profil) = ${(weightPerBarTon * 1000).toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // B5. ŞVELLER (U-PROFİL) (METRE / ADET <-> TON / KG)
  // --------------------------------------------------------------------------
  const isChannel = /швеллер|şveller|u\s*profil/i.test(text);

  if (isChannel) {
    const channelSpec = extractChannelSpecs(`${materialName} ${rawItemName || ''}`) || { channelNumber: '16P', weightPerM: 14.2 };
    const kgPerMeter = channelSpec.weightPerM;
    const tonsPerMeter = kgPerMeter / 1000;
    const barLength = extractLengthMeters(`${rawItemName || ''} ${materialName}`);

    // Metre -> Ton
    if (from === 'metre' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerMeter).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerMeter,
        formula: `Şveller ${channelSpec.channelNumber}: 1 metre = ${kgPerMeter} kg (${tonsPerMeter} ton)`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Ton -> Metre
    if (from === 'ton' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerMeter).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerMeter).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerMeter,
        formula: `Şveller ${channelSpec.channelNumber}: 1 ton = ${(1 / tonsPerMeter).toFixed(1)} metre`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    // Adet -> Metre
    if (from === 'adet' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice / barLength).toFixed(2)),
        convertedQuantity: Number((quantity * barLength).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: barLength,
        formula: `1 Adet Boy = ${barLength} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> Ton
    if (from === 'adet' && to === 'ton') {
      const weightPerBarTon = (barLength * kgPerMeter) / 1000;
      return {
        convertedUnitPrice: Number((unitPrice / weightPerBarTon).toFixed(2)),
        convertedQuantity: Number((quantity * weightPerBarTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: weightPerBarTon,
        formula: `1 Adet Boy (${barLength}m Şveller) = ${(weightPerBarTon * 1000).toFixed(2)} kg`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  const combinedSpecText = `${materialName} ${rawItemName || ''}`;

  // --------------------------------------------------------------------------
  // B6. ALÇIPAN PROFİLLERİ & SIVA PROFİLLERİ (ADET <-> METRE)
  // --------------------------------------------------------------------------
  const isDrywallOrPlasterProfile =
    /alçıpan.*profil|alcipan.*profil|профиль.*(?:knauf|кнауф|пс|пн|пп|пнп|гкл|гипсокартон|маячков)|alçıpan\s*takviye\s*profil|sıva\s*kılavuz\s*profil|köşe\s*profil/i.test(text);

  if (isDrywallOrPlasterProfile) {
    const profileLen = /3000|3\s*м|3\s*m/i.test(combinedSpecText) ? 3.0 : (extractLengthMeters(combinedSpecText) === 6.0 ? 3.0 : extractLengthMeters(combinedSpecText));
    if (from === 'adet' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice / profileLen).toFixed(2)),
        convertedQuantity: Number((quantity * profileLen).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: profileLen,
        formula: `1 Adet Profil = ${profileLen} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
    if (from === 'metre' && to === 'adet') {
      return {
        convertedUnitPrice: Number((unitPrice * profileLen).toFixed(2)),
        convertedQuantity: Number((quantity / profileLen).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / profileLen,
        formula: `1 Adet Profil = ${profileLen} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // C. YALITIM, MEMBRAN, NAYLON ÖRTÜ & JEOTEKSTİL (RULO / ADET <-> M² / METRE)
  // --------------------------------------------------------------------------
  const isPolyFilm =
    (/пленк|naylon|inşaat naylonu/i.test(text) && !/ламинирован|финишпленк|стрейч|stretch|500\s*mm|500\s*мм/i.test(text));

  const isMembraneOrGeotextile = 
    isPolyFilm ||
    text.includes('мембран') ||
    text.includes('membran') ||
    text.includes('изопласт') ||
    text.includes('izoplast') ||
    text.includes('техноэласт') ||
    text.includes('икопал') ||
    text.includes('icopal') ||
    text.includes('виллатекс') ||
    text.includes('villateks') ||
    text.includes('ультранап') ||
    text.includes('ultranap') ||
    text.includes('биполь') ||
    text.includes('bipol') ||
    text.includes('бикрост') ||
    text.includes('линокром') ||
    text.includes('геотекстил') ||
    text.includes('jeotekstil') ||
    text.includes('geotekstil') ||
    text.includes('дорнит') ||
    text.includes('гидроизоляц');

  if (isMembraneOrGeotextile) {
    let rollArea = extractRollAreaM2(combinedSpecText);
    if (!rollArea) {
      if (isPolyFilm) {
        rollArea = 300; // Teknik polietilen inşaat naylonu standart rulo: 3m x 100m = 300 m²
      } else if (text.includes('геотекстил') || text.includes('jeotekstil') || text.includes('geotekstil') || text.includes('дорнит')) {
        rollArea = 100; // Jeotekstilde 1 rulo genellikle 100 m²'dir (2m x 50m)
      } else {
        rollArea = 10; // Su yalıtım membranında 1 rulo standart 10 m²'dir
      }
    }

    // 1m genişliğindeki su yalıtım membranlarında 1 metre tül = 1 m²
    if (isMembraneOrGeotextile && ((from === 'metre' && to === 'm²') || (from === 'm²' && to === 'metre'))) {
      return {
        convertedUnitPrice: unitPrice,
        convertedQuantity: quantity,
        fromUnit: from,
        toUnit: to,
        factor: 1,
        formula: '1 Metre Rulo (En: 1m) = 1 m²',
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Rulo (veya Polietilen Filmde/Membranda Adet=Rulo) -> m²
    if ((from === 'rulo' || (isPolyFilm && from === 'adet') || (isMembraneOrGeotextile && from === 'adet')) && to === 'm²') {
      // Eğer membranda birim ADET girilmiş ama fiyat zaten 1 m² fiyatıysa (< 800 ₽), 10'a bölme
      const effectiveFactor = (from === 'adet' && !isPolyFilm && unitPrice > 0 && unitPrice < 800) ? 1 : rollArea;
      return {
        convertedUnitPrice: Number((unitPrice / effectiveFactor).toFixed(2)),
        convertedQuantity: Number((quantity * effectiveFactor).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: effectiveFactor,
        formula: effectiveFactor === 1 ? '1 Adet (m² bazlı giriş) = 1 m²' : `1 Rulo = ${effectiveFactor} m²`,
        confidence: extractRollAreaM2(combinedSpecText) ? 'EXACT' : 'HIGH',
        conversionApplied: true,
        notes: `Rulo ebadına (${effectiveFactor} m²) göre normalize edildi.`
      };
    }

    // m² -> Rulo
    if (from === 'm²' && (to === 'rulo' || (isPolyFilm && to === 'adet') || (isMembraneOrGeotextile && to === 'adet'))) {
      return {
        convertedUnitPrice: Number((unitPrice * rollArea).toFixed(2)),
        convertedQuantity: Number((quantity / rollArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / rollArea,
        formula: `1 Rulo = ${rollArea} m²`,
        confidence: extractRollAreaM2(combinedSpecText) ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // D. PLAKA, LEVHA, KONTRPLAK, XPS, TAŞYÜNÜ VE BRANDA (ADET / PLAKA / PAKET <-> M² <-> M³)
  // --------------------------------------------------------------------------
  const isSheetOrBoard =
    (text.includes('гипсокартон') ||
      text.includes('alçıpan') ||
      text.includes('alcipan') ||
      text.includes('гкл') ||
      text.includes('осб') ||
      text.includes('osb') ||
      text.includes('фанер') ||
      text.includes('kontrplak') ||
      text.includes('plywood') ||
      text.includes('аквапанел') ||
      text.includes('пеноплэкс') ||
      text.includes('пеноплекс') ||
      text.includes('penoplex') ||
      /\bxps\b/i.test(text) ||
      text.includes('taşyünü') ||
      text.includes('taş yünü') ||
      text.includes('минвата') ||
      text.includes('технофас') ||
      text.includes('техноблок') ||
      text.includes('baswool') ||
      text.includes('logicpir') ||
      text.includes('тент') ||
      text.includes('тарпаулин') ||
      text.includes('branda') ||
      text.includes('tente')) &&
    !/рубанок|rende|ножовка|testere|дюбел|dübel|dubel|саморез|vida|профиль|подвес|герметик|germetik|люк\b|kapak|kapağı|kapagi|лента|bant|шпатель|spatula/i.test(text);

  const explicitBoardArea = extractBoardAreaM2(combinedSpecText);
  const boardVolSpec = extractBoardVolumeM3(combinedSpecText);

  // D1. Kontrplak / OSB / XPS / Taşyünü Levha: Adet / Plaka / Paket <-> m³ ve m² <-> m³
  if (isSheetOrBoard && boardVolSpec) {
    const { thicknessMm, areaM2, volumeM3 } = boardVolSpec;
    const thicknessM = thicknessMm / 1000;

    if ((from === 'adet' || from === 'plaka') && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice / volumeM3).toFixed(2)),
        convertedQuantity: Number((quantity * volumeM3).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: volumeM3,
        formula: `1 Plaka (${thicknessMm}mm, ${areaM2.toFixed(2)} m²) = ${volumeM3.toFixed(5)} m³`,
        confidence: 'EXACT',
        conversionApplied: true,
        notes: `Plaka hacmine (${volumeM3.toFixed(5)} m³) göre normalize edildi.`
      };
    }

    if (from === 'm³' && (to === 'adet' || to === 'plaka')) {
      return {
        convertedUnitPrice: Number((unitPrice * volumeM3).toFixed(2)),
        convertedQuantity: Number((quantity / volumeM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / volumeM3,
        formula: `1 m³ = ${(1 / volumeM3).toFixed(2)} Plaka (${thicknessMm}mm)`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    if (from === 'paket' && to === 'm³') {
      const packVolM3 = 0.288; // Standart XPS / Taşyünü paket hacmi ≈ 0.288 m³
      return {
        convertedUnitPrice: Number((unitPrice / packVolM3).toFixed(2)),
        convertedQuantity: Number((quantity * packVolM3).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: packVolM3,
        formula: `1 Paket Yalıtım Levhası ≈ ${packVolM3} m³`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    if (from === 'm³' && to === 'paket') {
      const packVolM3 = 0.288;
      return {
        convertedUnitPrice: Number((unitPrice * packVolM3).toFixed(2)),
        convertedQuantity: Number((quantity / packVolM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / packVolM3,
        formula: `1 Paket Yalıtım Levhası ≈ ${packVolM3} m³`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    if (from === 'm²' && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice / thicknessM).toFixed(2)),
        convertedQuantity: Number((quantity * thicknessM).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: thicknessM,
        formula: `Kalınlık ${thicknessMm}mm: 1 m³ = ${(1 / thicknessM).toFixed(2)} m²`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }

    if (from === 'm³' && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice * thicknessM).toFixed(2)),
        convertedQuantity: Number((quantity / thicknessM).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / thicknessM,
        formula: `Kalınlık ${thicknessMm}mm: 1 m³ = ${(1 / thicknessM).toFixed(2)} m²`,
        confidence: 'EXACT',
        conversionApplied: true
      };
    }
  }

  // D2. Adet / Plaka <-> m² (Yalnızca gerçek levha/branda ise VEYA açık ebat varsa)
  if ((isSheetOrBoard || explicitBoardArea !== null) && !/люк\b|kapak|kapağı|kapagi|светильник|прожектор|стенд|pano|болт|cıvata|civata|гайк|somun|шайб|pul\b|rondela|шпильк|saplama|саморез|vida\b|дюбел|dübel|dubel|анкер|ankraj|гвозд|çivi|civi|фиксатор|paspay/i.test(text)) {
    let boardArea = explicitBoardArea;
    if (!boardArea) {
      if (text.includes('тент') || text.includes('тарпаулин') || text.includes('branda') || text.includes('tente')) {
        boardArea = 24.0; // Standart 4x6 m branda = 24 m²
      } else if (text.includes('осб') || text.includes('osb')) {
        boardArea = 3.125; // 1.25m x 2.5m = 3.125 m²
      } else if (text.includes('фанер') || text.includes('kontrplak') || text.includes('plywood')) {
        boardArea = 2.9768; // 1.22m x 2.44m = 2.9768 m²
      } else {
        boardArea = 3.0; // Standart Alçıpan: 1.2m x 2.5m = 3.0 m²
      }
    }

    // Adet / Plaka -> m²
    if ((from === 'adet' || from === 'plaka') && to === 'm²') {
      return {
        convertedUnitPrice: Number((unitPrice / boardArea).toFixed(2)),
        convertedQuantity: Number((quantity * boardArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: boardArea,
        formula: `1 Adet/Plaka = ${boardArea} m²`,
        confidence: explicitBoardArea ? 'EXACT' : 'HIGH',
        conversionApplied: true,
        notes: `Ebadına (${boardArea} m²) göre normalize edildi.`
      };
    }

    // m² -> Adet / Plaka
    if (from === 'm²' && (to === 'adet' || to === 'plaka')) {
      return {
        convertedUnitPrice: Number((unitPrice * boardArea).toFixed(2)),
        convertedQuantity: Number((quantity / boardArea).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / boardArea,
        formula: `1 Adet/Plaka = ${boardArea} m²`,
        confidence: explicitBoardArea ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // E. HAZIR BETON, HARÇ & ŞAP, AGREGA (M³ <-> TON / KG)
  // --------------------------------------------------------------------------
  const isBulkConcreteOrMortar =
    (text.includes('бетон') ||
      text.includes('beton') ||
      text.includes('раствор') ||
      text.includes('harç') ||
      text.includes('harc') ||
      text.includes('şap') ||
      text.includes('sap') ||
      text.includes('песок') ||
      text.includes('kum') ||
      text.includes('щебень') ||
      text.includes('çakıl')) &&
    !/стенд|ящик.*песк|пескоуловител|миксер|рубанок|дюбел|dübel|сверл|бур|диск|круг|анкер/i.test(text);

  if (isBulkConcreteOrMortar) {
    let densityTonPerM3 = 2.4; // Hazır beton: 2.4 ton/m³
    if (text.includes('песок') || text.includes('kum') || text.includes('щебень') || text.includes('çakıl')) {
      densityTonPerM3 = 1.55; // Kum/Çakıl: 1.55 ton/m³
    } else if (text.includes('раствор') || text.includes('harç') || text.includes('şap')) {
      densityTonPerM3 = 1.8; // Harç/Şap: 1.8 ton/m³
    }

    // m³ -> Ton
    if (from === 'm³' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / densityTonPerM3).toFixed(2)),
        convertedQuantity: Number((quantity * densityTonPerM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: densityTonPerM3,
        formula: `Yoğunluk: 1 m³ ≈ ${densityTonPerM3} ton`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> m³
    if (from === 'ton' && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice * densityTonPerM3).toFixed(2)),
        convertedQuantity: Number((quantity / densityTonPerM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / densityTonPerM3,
        formula: `Yoğunluk: 1 m³ ≈ ${densityTonPerM3} ton`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // E1.5. BİG-BAG / ÇUVAL HAFİF AGREGA & KERAMZİT (ADET / TORBA <-> M³)
  // --------------------------------------------------------------------------
  const bigBagMatch = combinedSpecText.match(/биг[\s-]*б[еэ]г[а-яё\s]*(\d+(?:[.,]\d+)?)\s*(?:м3|m3|м³|m³)/i)
    || ((/керамзит|keramzit|keramizit/i.test(text)) ? combinedSpecText.match(/(\d+(?:[.,]\d+)?)\s*(?:м3|m3|м³|m³)/i) : null);
  if (bigBagMatch || (/керамзит|keramzit|keramizit/i.test(text) && (from === 'adet' || from === 'torba' || to === 'adet' || to === 'torba'))) {
    const bagVolM3 = bigBagMatch ? parseFloat(bigBagMatch[1].replace(',', '.')) : (unitPrice >= 2500 ? 3.0 : 1.0);
    if (bagVolM3 > 0 && (from === 'adet' || from === 'torba') && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice / bagVolM3).toFixed(2)),
        convertedQuantity: Number((quantity * bagVolM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: bagVolM3,
        formula: `1 Big-Bag / Torba = ${bagVolM3} m³`,
        confidence: bigBagMatch ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
    if (bagVolM3 > 0 && from === 'm³' && (to === 'adet' || to === 'torba')) {
      return {
        convertedUnitPrice: Number((unitPrice * bagVolM3).toFixed(2)),
        convertedQuantity: Number((quantity / bagVolM3).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / bagVolM3,
        formula: `1 Big-Bag / Torba = ${bagVolM3} m³`,
        confidence: bigBagMatch ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // E2. GAZBETON, DUVAR BLOKLARI VE KERESTE (ADET / PALET <-> M³)
  // --------------------------------------------------------------------------
  const isGazbetonOrTimber =
    /газобетон|gazbeton|bonolit|poritep|ytong|istkult|исткульт|шлакоблок|кбб|kereste|kalas|tahta|доска обрезн|брус обрезн|брус не строган/i.test(text) &&
    !/рубанок|rende|дюбел|dübel|dubel|терка|кельма|шпатель|ножовка|testere|штроборез|захват|клей|yapıştırıcı|yapistirici/i.test(text);

  if (isGazbetonOrTimber) {
    const gazSpec = extractGazbetonDimensions(combinedSpecText);
    const volPerBlock = gazSpec ? gazSpec.volumeM3 : 0.03; // Standart 200x250x600 = 0.03 m³

    // Palet -> m³ (Standart Gazbeton Paleti = 1.875 m³)
    if (from === 'palet' && to === 'm³') {
      const palletVol = 1.875;
      return {
        convertedUnitPrice: Number((unitPrice / palletVol).toFixed(2)),
        convertedQuantity: Number((quantity * palletVol).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: palletVol,
        formula: `1 Palet Gazbeton = ${palletVol} m³`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // m³ -> Palet
    if (from === 'm³' && to === 'palet') {
      const palletVol = 1.875;
      return {
        convertedUnitPrice: Number((unitPrice * palletVol).toFixed(2)),
        convertedQuantity: Number((quantity / palletVol).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / palletVol,
        formula: `1 Palet Gazbeton = ${palletVol} m³`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Adet -> m³
    if (from === 'adet' && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice / volPerBlock).toFixed(2)),
        convertedQuantity: Number((quantity * volPerBlock).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: volPerBlock,
        formula: `1 Adet = ${volPerBlock} m³ (${(1 / volPerBlock).toFixed(1)} adet/m³)`,
        confidence: gazSpec ? 'EXACT' : 'HIGH',
        conversionApplied: true,
        notes: `Boyutlarına (${gazSpec ? `${gazSpec.width}x${gazSpec.height}x${gazSpec.length} mm` : 'Standart 200x250x600'}) göre hesaplandı.`
      };
    }

    // m³ -> Adet
    if (from === 'm³' && to === 'adet') {
      return {
        convertedUnitPrice: Number((unitPrice * volPerBlock).toFixed(2)),
        convertedQuantity: Number((quantity / volPerBlock).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / volPerBlock,
        formula: `1 m³ = ${(1 / volPerBlock).toFixed(1)} Adet`,
        confidence: gazSpec ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // F. ÇİMENTO TORBASI & PAKETLİ AĞIRLIK MALZEMELERİ (TORBA / ADET / PAKET <-> KG / TON)
  // --------------------------------------------------------------------------
  const isBaggedCementOrMortar =
    /çimento|cimento|цемент|yapıştırıcı|yapistirici|клей.*газобетон|плиточн.*клей|пескобетон|peskobeton|сухая.*смесь|kuru.*harç|kuru.*karışım|tamir\s*harcı|tamir\s*harci|ремонтн.*состав|ротбанд|rotband|штукатурк|шпаклевк/i.test(text);

  if (isBaggedCementOrMortar && ((from === 'adet' && to === 'torba') || (from === 'torba' && to === 'adet'))) {
    return {
      convertedUnitPrice: unitPrice,
      convertedQuantity: quantity,
      fromUnit: from,
      toUnit: to,
      factor: 1,
      formula: '1 Torba = 1 Adet',
      confidence: 'EXACT',
      conversionApplied: true
    };
  }

  if (from === 'torba' || to === 'torba' || ((from === 'paket' || from === 'kutu' || to === 'paket' || to === 'kutu') && extractPackageVolumeOrWeight(combinedSpecText)?.unit === 'kg')) {
    const pkg = extractPackageVolumeOrWeight(combinedSpecText);
    const bagKg = pkg && pkg.unit === 'kg' ? pkg.value : (text.includes('25') ? 25 : 50); // Varsayılan 50 kg veya 25 kg
    const bagTon = bagKg / 1000;

    // Torba / Paket -> Kg
    if ((from === 'torba' || from === 'paket' || from === 'kutu') && to === 'kg') {
      return {
        convertedUnitPrice: Number((unitPrice / bagKg).toFixed(2)),
        convertedQuantity: Number((quantity * bagKg).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: bagKg,
        formula: `1 ${from === 'torba' ? 'Torba' : 'Paket'} = ${bagKg} kg`,
        confidence: pkg ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }

    // Kg -> Torba / Paket
    if (from === 'kg' && (to === 'torba' || to === 'paket' || to === 'kutu')) {
      return {
        convertedUnitPrice: Number((unitPrice * bagKg).toFixed(2)),
        convertedQuantity: Number((quantity / bagKg).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / bagKg,
        formula: `1 ${to === 'torba' ? 'Torba' : 'Paket'} = ${bagKg} kg`,
        confidence: pkg ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }

    // Torba -> Ton
    if (from === 'torba' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / bagTon).toFixed(2)),
        convertedQuantity: Number((quantity * bagTon).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: bagTon,
        formula: `1 Torba = ${bagKg} kg (${bagTon} ton)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    // Ton -> Torba
    if (from === 'ton' && to === 'torba') {
      return {
        convertedUnitPrice: Number((unitPrice * bagTon).toFixed(2)),
        convertedQuantity: Number((quantity / bagTon).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / bagTon,
        formula: `1 Ton = ${(1 / bagTon).toFixed(0)} Torba (${bagKg} kg)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G. BOYA, KALIP YAĞI, KOVA, AMBALAJLI PAKET & ELEKTROT (KOVA / ADET / PAKET <-> KG / LT)
  // --------------------------------------------------------------------------
  const pkgSpec = extractPackageVolumeOrWeight(combinedSpecText);
  const isPaintOrPrimer =
    /краск|boya|эмаль|emal|пф-115|pf-115|грунтовк|astar|antipas/i.test(text) &&
    !/светильник|прожектор|лампа|aydınlatma|aydinlatma|люк\b|kapak|kapağı|kapagi|валик|rulo|кисть|fırça|firca|лента|скотч|bant|кювета|ванночка|пистолет|миксер|шпатель/i.test(text);
  const isFormworkOil = /kalıp\s*ayırıcı\s*yağ|kalıp\s*yağ|kalip\s*yag|масло.*опалуб|смазка.*опалуб|эмульсол/i.test(text);
  const isDryBagMortar = /tamir\s*harcı|tamir\s*harci|ремонтн.*состав|litokol|glims|mapei|planitop/i.test(text);

  if (from === 'kova' || to === 'kova' || (pkgSpec && pkgSpec.value > 0) || (isPaintOrPrimer && from === 'adet' && unitPrice >= 1500) || (isFormworkOil && from === 'adet' && unitPrice >= 5000)) {
    const bucketValue = pkgSpec
      ? pkgSpec.value
      : (isFormworkOil ? 216 : (text.includes('25') ? 25 : (text.includes('15') ? 15 : (text.includes('14') ? 14 : 20))));

    // Eğer kuru harç/tamir harcı kaleminde birim sehven ADET girilmiş ama fiyat zaten 1 kg fiyatıysa (örn: 44 ₽/kg vs 1040 ₽/25kg torba), 25'e bölme!
    if (isDryBagMortar && from === 'adet' && to === 'kg' && bucketValue >= 15 && unitPrice > 0 && unitPrice < 150) {
      return {
        convertedUnitPrice: unitPrice,
        convertedQuantity: quantity,
        fromUnit: from,
        toUnit: to,
        factor: 1,
        formula: `Birim fiyat zaten kg bazında (${unitPrice} ₽/kg)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }

    if ((from === 'kova' || from === 'adet' || from === 'paket' || from === 'kutu') && (to === 'kg' || to === 'lt')) {
      return {
        convertedUnitPrice: Number((unitPrice / bucketValue).toFixed(2)),
        convertedQuantity: Number((quantity * bucketValue).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: bucketValue,
        formula: `1 ${from === 'kova' ? 'Kova' : 'Ambalaj/Adet'} = ${bucketValue} ${to}`,
        confidence: pkgSpec ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }

    if ((from === 'kg' || from === 'lt') && (to === 'kova' || (pkgSpec && (to === 'adet' || to === 'paket' || to === 'kutu')))) {
      return {
        convertedUnitPrice: Number((unitPrice * bucketValue).toFixed(2)),
        convertedQuantity: Number((quantity / bucketValue).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / bucketValue,
        formula: `1 ${to === 'kova' ? 'Kova' : 'Ambalaj/Adet'} = ${bucketValue} ${from}`,
        confidence: pkgSpec ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G2. ÇELİK I-KİRİŞ (ДВУТАВР GOST 57837) & SİYAH ÇELİK SAC LEVHA (METRE / ADET / M² <-> TON)
  // --------------------------------------------------------------------------
  if (/двутавр|i-kiriş|ipe\/heb\s*kiriş|çelik\s*kiriş\s*profil|profil\s*çelik\s*kiriş/i.test(text) && !/деревян|ahşap|h20/i.test(text)) {
    const IBEAM_MASS: Record<string, number> = {
      '20b1': 21.3, '25b1': 25.7, '30b1': 32.9, '35b1': 43.3, '40b1': 56.6, '40s1': 88.6, '40ş1': 88.6, '45b1': 66.5, '50b1': 73.0, '55b2': 97.9
    };
    const bm = combinedSpecText.match(/\b(20|25|30|35|40|45|50|55|60)\s*([бbшsşкk])\s*([123])\b/i);
    const profKey = bm ? `${bm[1]}${/[шsş]/i.test(bm[2]) ? 's' : 'b'}${bm[3]}` : '40b1';
    const kgPerM = IBEAM_MASS[profKey] || 56.6;
    const tonsPerM = kgPerM / 1000;
    if (from === 'metre' && to === 'ton') {
      return {
        convertedUnitPrice: Number((unitPrice / tonsPerM).toFixed(2)),
        convertedQuantity: Number((quantity * tonsPerM).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: tonsPerM,
        formula: `Çelik Kiriş: 1 metre = ${kgPerM} kg (${tonsPerM} ton)`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
    if (from === 'ton' && to === 'metre') {
      return {
        convertedUnitPrice: Number((unitPrice * tonsPerM).toFixed(2)),
        convertedQuantity: Number((quantity / tonsPerM).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / tonsPerM,
        formula: `Çelik Kiriş: 1 ton = ${(1 / tonsPerM).toFixed(2)} metre`,
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G3. STANDART 1NF DOLU TUĞLA 250x120x65 MM (ADET <-> M³: 1 Adet = 0.00195 m³)
  // --------------------------------------------------------------------------
  if (/tuğla|tugla|кирпич/i.test(text) && /250\s*[*xх×]\s*120\s*[*xх×]\s*65|1\s*нф|1\s*nf/i.test(combinedSpecText)) {
    const brickVol = 0.00195;
    if (from === 'adet' && to === 'm³') {
      return {
        convertedUnitPrice: Number((unitPrice / brickVol).toFixed(2)),
        convertedQuantity: Number((quantity * brickVol).toFixed(4)),
        fromUnit: from,
        toUnit: to,
        factor: brickVol,
        formula: '1 Adet 1NF Tuğla (250x120x65) = 0.00195 m³ (512.8 adet/m³)',
        confidence: 'EXACT',
        conversionApplied: true
      };
    }
    if (from === 'm³' && to === 'adet') {
      return {
        convertedUnitPrice: Number((unitPrice * brickVol).toFixed(2)),
        convertedQuantity: Number((quantity / brickVol).toFixed(1)),
        fromUnit: from,
        toUnit: to,
        factor: 1 / brickVol,
        formula: '1 m³ = 512.8 Adet 1NF Tuğla (250x120x65)',
        confidence: 'EXACT',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G4. BOYU BELİRTİLEN BORULAR, HORTUMLAR VE KANALLAR (ADET <-> METRE)
  // --------------------------------------------------------------------------
  if (/boru|труб|воздуховод|yangın\s*hortumu|рукав\s*пожарн/i.test(text) && ((from === 'adet' && to === 'metre') || (from === 'metre' && to === 'adet'))) {
    // Yangın hortumunda (20m rulo) faturada birim MT girilmiş ancak fiyat zaten 1 rulo fiyatıysa (>= 500 ₽), 20 ile çarpma!
    if (/yangın\s*hortumu|рукав\s*пожарн/i.test(text) && from === 'metre' && to === 'adet' && unitPrice >= 500) {
      return {
        convertedUnitPrice: unitPrice,
        convertedQuantity: quantity,
        fromUnit: from,
        toUnit: to,
        factor: 1,
        formula: '1 Adet Yangın Hortumu Seti (20m) = 1 Adet',
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
    const lenMatch =
      combinedSpecText.match(/(?:[xх*×]|l\s*=|\()\s*(\d+(?:[.,]\d+)?)\s*(?:м|m)(?![a-zа-яё0-9²³])/i) ||
      combinedSpecText.match(/\b(1000|1250|2000|3000|6000)\s*(?:мм|mm)\b/i) ||
      (/yangın\s*hortumu|рукав\s*пожарн/i.test(text) ? [null, '20'] : null);
    if (lenMatch && lenMatch[1]) {
      const rawVal = parseFloat(lenMatch[1].replace(',', '.'));
      const pipeLenM = rawVal >= 500 ? rawVal / 1000 : rawVal;
      if (pipeLenM >= 0.5 && pipeLenM <= 50) {
        if (from === 'adet' && to === 'metre') {
          return {
            convertedUnitPrice: Number((unitPrice / pipeLenM).toFixed(2)),
            convertedQuantity: Number((quantity * pipeLenM).toFixed(2)),
            fromUnit: from,
            toUnit: to,
            factor: pipeLenM,
            formula: `1 Adet = ${pipeLenM} metre`,
            confidence: 'EXACT',
            conversionApplied: true
          };
        }
        if (from === 'metre' && to === 'adet') {
          return {
            convertedUnitPrice: Number((unitPrice * pipeLenM).toFixed(2)),
            convertedQuantity: Number((quantity / pipeLenM).toFixed(2)),
            fromUnit: from,
            toUnit: to,
            factor: 1 / pipeLenM,
            formula: `1 Adet = ${pipeLenM} metre`,
            confidence: 'EXACT',
            conversionApplied: true
          };
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // G5. A4 / A3 FOTOKOPİ KAĞIDI (500 YAPRAK PAKET: ADET / RULO <-> PAKET 1:1, KUTU <-> PAKET 1:5)
  // --------------------------------------------------------------------------
  if (/fotokopi.*kağıd|yazıcı.*kağıd|бумага.*офисн|svetocopy|светокопи|500\s*yaprak/i.test(text)) {
    if ((from === 'kutu' || (from === 'adet' && unitPrice >= 1100)) && to === 'paket') {
      return {
        convertedUnitPrice: Number((unitPrice / 5).toFixed(2)),
        convertedQuantity: Number((quantity * 5).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 5,
        formula: '1 Koli/Kutu = 5 Paket (500 Yaprak)',
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
    if (from === 'paket' && to === 'kutu') {
      return {
        convertedUnitPrice: Number((unitPrice * 5).toFixed(2)),
        convertedQuantity: Number((quantity / 5).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: 0.2,
        formula: '1 Koli/Kutu = 5 Paket (500 Yaprak)',
        confidence: 'HIGH',
        conversionApplied: true
      };
    }
    if (['adet', 'paket', 'rulo'].includes(from) && ['adet', 'paket', 'rulo'].includes(to)) {
      return {
        convertedUnitPrice: unitPrice,
        convertedQuantity: quantity,
        fromUnit: from,
        toUnit: to,
        factor: 1,
        formula: '1 Paket (500 Yaprak) = 1 Adet',
        confidence: 'EXACT',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G6. PAKETLİ PASPAYI, DÜBEL, VİDA, SOMUN, PUL, KABLO BAĞI & SARF (PAKET / KUTU <-> ADET)
  // (Çöp poşetleri rulo/paket bazında kıyaslandığından adet bölmesine girmez!)
  // --------------------------------------------------------------------------
  const isTrashBagItem = /çöp\s*poşet|cop\s*poset|çöp\s*torba|cop\s*torba|мешк.*мусор|пакет.*мусор/i.test(text);
  const explicitPackMatch =
    combinedSpecText.match(/(\d+)\s*(?:шт|adet|пар|çift|cift|рул|rulo)\s*(?:\/|\s*в\s*|\s*-\s*|\s*)(?:уп|пакет|кор|короб|пач|paket|kutu|koli)/i) ||
    combinedSpecText.match(/(?:уп|упак|упаковка|пакет|кор|коробка|paket|kutu)\s*[-:.]?\s*(\d+)\s*(?:шт|adet|пар|çift|уп)/i) ||
    combinedSpecText.match(/(\d+)\s*упаков(?:ок|ки)\s*по\s*\d+\s*(?:кг|г|л)/i) ||
    combinedSpecText.match(/\(\s*(\d+)\s*(?:шт|adet|пар|çift)\b/i);
  const isSpacerItem = /paspay|фиксатор|конус|звездочк|стульчик/i.test(text);
  const isFastenerOrTie = /дюбел|dübel|dubel|саморез|vida|гайк|somun|шайб|pul\b|анкер|ankraj|хомут|kablo\s*bağ|cırt\s*kelepçe|клемм|wago|скоб|клипс/i.test(text);

  if (!isTrashBagItem && (explicitPackMatch || isSpacerItem || isFastenerOrTie) && ((from === 'paket' || from === 'kutu') && to === 'adet' || (from === 'adet' && (to === 'paket' || to === 'kutu')))) {
    const rawCount = explicitPackMatch ? parseInt(explicitPackMatch[1], 10) : (isSpacerItem ? 500 : 100);
    const packCount = (rawCount >= 2 && rawCount <= 5000) ? rawCount : 100;
    if ((from === 'paket' || from === 'kutu') && to === 'adet') {
      // Eğer birim paket yazılmış ama fiyat zaten tekil adet fiyatıysa (< 15 ₽), bölme!
      const effFactor = unitPrice >= 25 ? packCount : 1;
      return {
        convertedUnitPrice: Number((unitPrice / effFactor).toFixed(2)),
        convertedQuantity: Number((quantity * effFactor).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: effFactor,
        formula: effFactor === 1 ? '1 Adet = 1 Adet' : `1 Paket = ${effFactor} Adet`,
        confidence: explicitPackMatch ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
    if (from === 'adet' && (to === 'paket' || to === 'kutu')) {
      // Eğer birim adet yazılmış ama fiyat zaten paket fiyatıysa (>= 150 ₽), 1:1 kabul et
      const effFactor = unitPrice >= 150 ? 1 : (1 / packCount);
      return {
        convertedUnitPrice: Number((unitPrice / effFactor).toFixed(2)),
        convertedQuantity: Number((quantity * effFactor).toFixed(2)),
        fromUnit: from,
        toUnit: to,
        factor: effFactor,
        formula: effFactor === 1 ? '1 Paket = 1 Adet (Paket bazlı giriş)' : `1 Paket = ${packCount} Adet`,
        confidence: explicitPackMatch ? 'EXACT' : 'HIGH',
        conversionApplied: true
      };
    }
  }

  // --------------------------------------------------------------------------
  // G7. TEKİL SAYILABİLİR ÜRÜNLERDE BİRİM EŞDEĞERLİĞİ (ADET <-> ÇİFT / TAKIM / PAKET / RULO 1:1)
  // İş botu, eldiven, iş elbisesi, fırça, lazer işaretçi vb. kalemlerde faturada "1 Adet" vs "1 Çift" / "1 Takım" yazılması
  // --------------------------------------------------------------------------
  const discreteUnits = ['adet', 'çift', 'takım', 'paket', 'kutu', 'rulo'];
  if (
    discreteUnits.includes(from) &&
    discreteUnits.includes(to) &&
    !/арматур|inşaat\s*demir|газобетон|gazbeton|kereste|доска|брус|фанер|kontrplak|plywood|мембран|membran|геотекстил|geotekstil|пеноплэкс|penoplex|xps|taşyünü|минвата|гипсокартон|alçıpan|бетон|beton|цемент|çimento|песок|щебень|труба|boru|уголок|köşebent|швеллер|şveller|сетка|hasır|кабель|kablo|провод/i.test(text)
  ) {
    return {
      convertedUnitPrice: unitPrice,
      convertedQuantity: quantity,
      fromUnit: from,
      toUnit: to,
      factor: 1,
      formula: `1 ${params.fromUnit} = 1 ${params.toUnit}`,
      confidence: 'HIGH',
      conversionApplied: true
    };
  }

  // --------------------------------------------------------------------------
  // H. EŞLEŞMEYEN / BİLİNMEYEN DÖNÜŞÜMLER
  // --------------------------------------------------------------------------
  return {
    convertedUnitPrice: unitPrice,
    convertedQuantity: quantity,
    fromUnit: from,
    toUnit: to,
    factor: 1,
    formula: `Fiziksel boyut uyuşmazlığı (${from} -> ${to})`,
    confidence: 'ESTIMATED',
    conversionApplied: false,
    notes: 'Birimler farklı fiziksel kategoride olduğundan doğrudan çevrim uygulanamadı.'
  };
}

/**
 * İki birimin birbirine çevrilebilir olup olmadığını test eder
 */
export function areUnitsConvertible(materialName: string, unitA?: string, unitB?: string): boolean {
  if (!unitA || !unitB) return false;
  const a = normalizeStandardUnit(unitA);
  const b = normalizeStandardUnit(unitB);
  if (a === b) return true;

  const resAtoB = convertMaterialUnit({
    materialName,
    fromUnit: a,
    toUnit: b,
    unitPrice: 100,
    quantity: 1
  });
  if (resAtoB.conversionApplied) return true;

  const resBtoA = convertMaterialUnit({
    materialName,
    fromUnit: b,
    toUnit: a,
    unitPrice: 100,
    quantity: 1
  });
  return resBtoA.conversionApplied;
}
