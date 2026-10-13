/**
 * Akıllı Satınalma Malzeme ve Semantik Eşleştirme Motoru
 * (Smart Construction Material Semantic Matcher)
 * 
 * Bu modül inşaat, şantiye ve satınalma terminolojisine göre:
 * 1. Malzemenin asıl cinsini (Head Noun / Core Domain) tespit eder.
 * 2. Aksesuar, alet, yan parça ve ambalajı asıl malzeme ile karıştırmaz
 *    (Örn: Seramik ararken yapıştırıcı veya kesme diskini ELEME;
 *          Kablo ararken tava veya kanalı ELEME;
 *          Mazot ararken filtre, tank veya jeneratörü ELEME;
 *          Baret ararken siperlik veya lambayı ELEME).
 * 3. Unicode-aware kelime sınırları ile alt-kelime zehirlenmesini önler
 *    (Örn: "makaron" içindeki "karo", "ahşap" içindeki "şap" elenir).
 * 4. Yalnızca GERÇEKTEN aynı malzeme ailesine ait kayıtları kıyaslamaya dahil eder.
 */

// Unicode-aware word boundary pattern generator for Turkish, Russian & English text
export function wb(pattern: string): RegExp {
  return new RegExp('(?:^|[^a-z0-9а-яğüşıöç])(?:' + pattern + ')(?:$|[^a-z0-9а-яğüşıöç])', 'i');
}

export interface MaterialDomainDef {
  id: string;
  nameTr: string;
  positive: RegExp;
  negative: RegExp;
}

export const MATERIAL_DOMAINS: MaterialDomainDef[] = [
  // 1. Seramik, Fayans ve Porselen Karo
  {
    id: 'SERAMIK_KARO',
    nameTr: 'Seramik & Porselen Karo',
    positive: wb('seramik[a-zğüşıöç]*|fayans[a-zğüşıöç]*|плитк[а-я]*|керамогранит[а-я]*|karo[a-zğüşıöç]*'),
    negative: wb('diski?|kesme|yap[ıi]şt[ıi]r[ıi]c[ıi][a-zğüşıöç]*|yap[ıi]st[ıi]r[ıi]c[ıi][a-zğüşıöç]*|клей|derz|затирк[а-я]*|temizleyic[a-zğüşıöç]*|makaron|fırça|süpürge|artısı')
  },

  // 2. İnşaat Demiri / Yapısal Donatı Çeliği
  {
    id: 'INSAAT_DEMIRI',
    nameTr: 'İnşaat Demiri & Donatı',
    positive: wb('inşaat\\s+demir[a-zğüşıöç]*|insaat\\s+demir[a-zğüşıöç]*|nervür[a-zğüşıöç]*|rebar|арматур[а-я]*|a500[sc]?|а500[сс]?|пруток'),
    negative: wb('mantar[a-zğüşıöç]*|başlık|baslik|колпачок|грибок|paspay[a-zğüşıöç]*|паспой|фиксатор|bağ\\s+tel[a-zğüşıöç]*|tavlı\\s+tel[a-zğüşıöç]*|çiroz|ciroz|kesme\\s+taşı|bükme|kesme\\s+makinesi')
  },

  // 3. Kutu Profil & Hadde Profil
  {
    id: 'CELIK_PROFIL',
    nameTr: 'Kutu Profil & Çelik Profil',
    positive: wb('kutu\\s+profil[a-zğüşıöç]*|profil\\s+boru[a-zğüşıöç]*|профильн[а-я]*\\s+труб[а-я]*|köşebent[a-zğüşıöç]*|kosebent[a-zğüşıöç]*|уголок|швеллер|upn|ipe|hea|heb'),
    negative: wb('alçıpan\\s+profil|alcipan\\s+profil|профиль\\s+для\\s+гкл|lamba|kapı\\s+kolu|çit\\s+paneli|kilit')
  },

  // 4. Tesisat ve Altyapı Boruları
  {
    id: 'BORU_TESISAT',
    nameTr: 'Tesisat ve Altyapı Boruları',
    positive: wb('boru[a-zğüşıöç]*|труб[а-я]|ppr|pvc\\s+boru[a-zğüşıöç]*|koruge|гофрированн[а-я]*\\s+труб[а-я]*'),
    negative: wb('kelepçe[a-zğüşıöç]*|makas[a-zğüşıöç]*|kutu\\s+profil|profil\\s+boru|профильная\\s+труба|anahtar|kaynak\\s+makinesi')
  },

  // 5. Elektrik Kabloları
  {
    id: 'KABLO_ELEKTRIK',
    nameTr: 'Elektrik Kablosu & İletkenler',
    positive: wb('kablo[a-zğüşıöç]*|кабел[а-я]*|провод[а-я]*|nym|vvg|ввг|frls|нг-ls'),
    negative: wb('kanal[a-zğüşıöç]*|tava[a-zğüşıöç]*|bağı|koruyucu\\s+makaron|pabuç|pabucu|makas|bağlantı\\s+kutusu')
  },

  // 6. Boya, Astar ve Yüzey Kaplama
  {
    id: 'BOYA_KAPLAMA',
    nameTr: 'Boya, Astar ve Emaye',
    positive: wb('boya[a-zğüşıöç]*|краск[а-я]*|эмал[а-я]*|astar[a-zğüşıöç]*|грунтовк[а-я]*|ral\\s*\\d{4}'),
    negative: wb('rulo[a-zğüşıöç]*|fırça[a-zğüşıöç]*|firca[a-zğüşıöç]*|tava|tencere|tabanca|maskeleme\\s+bandı')
  },

  // 7. Yalıtım (Taşyünü, XPS, Membran)
  {
    id: 'YALITIM',
    nameTr: 'Isı ve Su Yalıtım Malzemeleri',
    positive: wb('taşyünü[a-zğüşıöç]*|tasyunu[a-zğüşıöç]*|cam\\s*yünü|минват[а-я]*|пеноплэкс|penoplex|xps|eps|strafor|membran[a-zğüşıöç]*|мембран[а-я]*|технониколь'),
    negative: wb('bıçak|tespit\\s+dübeli|dübel|bant|tabanca')
  },

  // 8. Alçıpan & Alçı Levha
  {
    id: 'ALCIPAN',
    nameTr: 'Alçıpan & Alçı Levha',
    positive: wb('alçıpan[a-zğüşıöç]*|alcipan[a-zğüşıöç]*|гипсокартон|гкл|гклв|гвл'),
    negative: wb('vidası|profil|file|bant|mastik')
  },

  // 9. Gazbeton & Tuğla Duvar Blokları
  {
    id: 'GAZBETON_TUGLA',
    nameTr: 'Gazbeton & Tuğla Duvar Elemanları',
    positive: wb('gazbeton[a-zğüşıöç]*|ytong|газобетон|газоблок|tuğla[a-zğüşıöç]*|tugla[a-zğüşıöç]*|кирпич'),
    negative: wb('tutkal|harç|harc|testere')
  },

  // 10. Kuru Karışım, Şap, Harç ve Çimento
  {
    id: 'KURU_HARC',
    nameTr: 'Kuru Karışım, Şap ve Çimento',
    positive: wb('kuru\\s+karış[a-zğüşıöç]*|kuru\\s+karis[a-zğüşıöç]*|пескобетон|сухая\\s+смесь|m-?150|m-?200|m-?300|m-?500|çimento[a-zğüşıöç]*|cimento[a-zğüşıöç]*|цемент|şap'),
    negative: wb('ahşap|ahsap|дерев[а-я]*|fırça|firca|tripod|kilit|vida|mikser')
  },

  // 11. Dübel & Çelik Ankraj
  {
    id: 'DUBEL_ANKRAJ',
    nameTr: 'Çelik Dübel ve Kimyasal Ankraj',
    positive: wb('dübel[a-zğüşıöç]*|dubel[a-zğüşıöç]*|дюбель[а-я]*|anker[a-zğüşıöç]*|ankraj[a-zğüşıöç]*|hilti\\s+hit|химическ[а-я]*\\s+анкер'),
    negative: wb('tabanca[a-zğüşıöç]*|pistolet|пистолет|ucu|kartuş\\s+tabancası')
  },

  // 12. Cıvata, Somun, Vida & Pul
  {
    id: 'CIVATA_SOMUN_VIDA',
    nameTr: 'Cıvata, Somun, Vida ve Bağlantı Elemanları',
    positive: wb('cıvata[a-zğüşıöç]*|civata[a-zğüşıöç]*|болт[а-я]*|somun[a-zğüşıöç]*|гайка[а-я]*|vida[a-zğüşıöç]*|саморез[а-я]*|pul[a-zğüşıöç]*|шайба[а-я]*|gijon|шпилька'),
    negative: wb('matkap|tornavida|anahtar|kutu\\s+profil')
  },

  // 13. İş Güvenliği: Baret
  {
    id: 'BARET',
    nameTr: 'İş Güvenlik Bareti',
    positive: wb('baret[a-zğüşıöç]*|каск[а-я]*'),
    negative: wb('siperlik|щиток|lamba|çene\\s+bağı')
  },

  // 14. İş Güvenliği: Eldiven
  {
    id: 'ELDIVEN',
    nameTr: 'İş ve Temizlik Eldiveni',
    positive: wb('eldiven[a-zğüşıöç]*|перчатк[а-я]*'),
    negative: wb('askı|dispenser|kutu')
  },

  // 15. Yakıt & Akaryakıt
  {
    id: 'AKARYAKIT',
    nameTr: 'Mazot, Motorin ve Akaryakıt',
    positive: wb('mazot[a-zğüşıöç]*|dizel[a-zğüşıöç]*|дизельн[а-я]*\\s+топливо|дизтопливо|benzin[a-zğüşıöç]*|akaryakıt[a-zğüşıöç]*'),
    negative: wb('jeneratör[a-zğüşıöç]*|генератор[а-я]*|tank[a-zğüşıöç]*|tankı|filtre[a-zğüşıöç]*|filtresi|pompa[a-zğüşıöç]*|hortum[a-zğüşıöç]*')
  },

  // 16. Temizlik & Sarf (Çöp Poşeti, Deterjan)
  {
    id: 'COP_POSETI',
    nameTr: 'Çöp Torbası ve Poşeti',
    positive: wb('çöp\\s+poşet[a-zğüşıöç]*|cop\\s+poset[a-zğüşıöç]*|пакет[а-я]*\\s+для\\s+мусора|мешок\\s+для\\s+мусора'),
    negative: wb('kova|konteyner')
  },
  {
    id: 'DETERJAN_TEMIZLIK',
    nameTr: 'Temizlik Kimyasalı & Deterjan',
    positive: wb('deterjan[a-zğüşıöç]*|моющее|sabun[a-zğüşıöç]*|мыло|çamaşır\\s+suyu|белизна|proper'),
    negative: wb('kovası|mop|dispenser')
  },

  // 17. Kırtasiye & Ofis (Kalem, Kağıt)
  {
    id: 'KIRTASIYE_KALEM',
    nameTr: 'Tükenmez Kalem & Kırtasiye',
    positive: wb('tükenmez\\s+kalem[a-zğüşıöç]*|tukenmez\\s+kalem[a-zğüşıöç]*|jel\\s+kalem[a-zğüşıöç]*|ручка\\s+шариковая|ручка\\s+гелевая'),
    negative: wb('kalemtıraş|açacak|lazer')
  },

  // 18. Kalıp Malzemeleri & Kontrplak (Plywood, H20)
  {
    id: 'KALIP_PLYWOOD',
    nameTr: 'Kontrplak (Plywood) ve Kalıp Elemanları',
    positive: wb('plywood[a-zğüşıöç]*|kontrplak[a-zğüşıöç]*|фанер[а-я]*|h-?20|балка\\s+бдк'),
    negative: wb('temizleme|yağı|yagi|sm\\s*30')
  },

  // 19. Vana, Armatür ve Çekvalf
  {
    id: 'VANA_ARMATUR',
    nameTr: 'Vana, Valf ve Çekvalf',
    positive: wb('vana[a-zğüşıöç]*|valf[a-zğüşıöç]*|кран\\s+шаров[а-я]*|вентиль|клапан|çekvalf[a-zğüşıöç]*'),
    negative: wb('anahtarı|kolu|motoru')
  },

  // 20. Kompresör ve Basınç Ekipmanları
  {
    id: 'KOMPRESOR',
    nameTr: 'Kompresör ve Basınç Ekipmanları',
    positive: wb('kompresör[a-zğüşıöç]*|kompressor[a-zğüşıöç]*|компрессор[а-я]*'),
    negative: wb('yağı|filtresi|hortumu|tabancası|kırıcı\\s+uç|uç')
  }
];

/**
 * Malzemenin tedarik alanını ve belirleyici teknik özelliklerini (çap, ebat, sınıf) tespit eder.
 */
export function identifyMaterialDomain(name: string): { domain: MaterialDomainDef | null; specTokens: string[] } {
  if (!name) return { domain: null, specTokens: [] };
  const lower = name.toLowerCase().trim();

  for (const dom of MATERIAL_DOMAINS) {
    const isPositive = dom.positive.test(lower);
    const isNegative = dom.negative.test(lower);
    if (isPositive && !isNegative) {
      const specs = extractTechnicalSpecs(lower);
      return { domain: dom, specTokens: specs };
    }
  }

  return { domain: null, specTokens: extractTechnicalSpecs(lower) };
}

/**
 * Boyut, çap, hacim, amper, sınıf gibi teknik belirteçleri ayıklar.
 */
function extractTechnicalSpecs(s: string): string[] {
  const specs: string[] = [];
  
  // Ebat: 600x600, 60x120, 40x40x2
  const dimMatch = s.match(/\b\d+[\s*xх×]\d+(?:[\s*xх×]\d+)?(?:\s*mm|\s*см|\s*cm)?\b/gi);
  if (dimMatch) {
    dimMatch.forEach(d => specs.push(d.replace(/\s+/g, '').toLowerCase()));
  }

  // Metrik / Çap: M16, Q10, DN50, Ø12
  const metMatch = s.match(/\b[mqødn]\s*\d+\b/gi);
  if (metMatch) {
    metMatch.forEach(m => specs.push(m.replace(/\s+/g, '').toLowerCase()));
  }

  // Hacim / Ağırlık: 160 LT, 25 KG, 50 KG, 15 L
  const volMatch = s.match(/\b\d+(?:[.,]\d+)?\s*(?:lt|l|kg|кг|ton|тонн)\b/gi);
  if (volMatch) {
    volMatch.forEach(v => specs.push(v.replace(/\s+/g, '').toLowerCase()));
  }

  // Elektrik: 3x2.5, 3x1.5, 25A, 32A
  const elMatch = s.match(/\b\d+x\d+(?:[.,]\d+)?|\b\d+\s*a\b/gi);
  if (elMatch) {
    elMatch.forEach(e => specs.push(e.replace(/\s+/g, '').toLowerCase()));
  }

  // Sınıf: M150, M200, M300, M500, A500C
  const classMatch = s.match(/\bm-?\d{3,4}\b|\ba-?500c\b/gi);
  if (classMatch) {
    classMatch.forEach(c => specs.push(c.replace(/[-]/g, '').toLowerCase()));
  }

  return Array.from(new Set(specs));
}

export interface SimilarityResult {
  score: number;
  matchType: 'exact' | 'spec_match' | 'same_family' | 'none';
  reason: string;
}

/**
 * İki malzemenin gerçek satınalma eşleşme derecesini hesaplar.
 * Farklı cins veya alakasız malzemeler KESİNLİKLE 0 puan alır.
 */
export function calculateSemanticSimilarity(
  targetName: string,
  candidateName: string,
  targetUnit?: string,
  candidateUnit?: string
): SimilarityResult {
  if (!targetName || !candidateName) {
    return { score: 0, matchType: 'none', reason: 'Boş malzeme adı' };
  }

  const tClean = targetName.toLowerCase().trim();
  const cClean = candidateName.toLowerCase().trim();

  // 1. Doğrudan Birebir Eşleşme
  if (tClean === cClean) {
    return { score: 100, matchType: 'exact', reason: 'Birebir ürün adı eşleşmesi' };
  }

  const targetDom = identifyMaterialDomain(tClean);
  const candDom = identifyMaterialDomain(cClean);

  // EĞER HEDEF MALZEME TANIMLI BİR GRUPTAYSA:
  if (targetDom.domain) {
    // 1. Aday malzeme, hedef malzemenin negatif filtresine takılıyorsa -> KESİNLİKLE REDDET!
    if (targetDom.domain.negative.test(cClean)) {
      return { score: 0, matchType: 'none', reason: 'Aksesuar / alet negatif filtresine takıldı' };
    }

    // 2. Aday malzeme, hedef malzemenin pozitif filtresine uymuyorsa -> KESİNLİKLE REDDET!
    if (!targetDom.domain.positive.test(cClean)) {
      return { score: 0, matchType: 'none', reason: `Aday malzeme ${targetDom.domain.nameTr} grubuna ait değil` };
    }

    // 3. Aday başka bilinen bir grubun üyesiyse ve gruplar farklıysa -> KESİNLİKLE REDDET!
    if (candDom.domain && candDom.domain.id !== targetDom.domain.id) {
      return { score: 0, matchType: 'none', reason: `Farklı malzeme alanları (${targetDom.domain.nameTr} vs ${candDom.domain.nameTr})` };
    }

    // 4. Doğrudan alt dizi kapsama kontrolü (Örn: "ARGENTA ATENEA IVORY 60X120 Seramik Karo" vs "Seramik Karo")
    if (tClean.includes(cClean) || cClean.includes(tClean)) {
      return { score: 92, matchType: 'exact', reason: `${targetDom.domain.nameTr} grubunda tam model/seri kapsama eşleşmesi` };
    }

    // 5. İkisi de aynı ana alanda! Teknik özellik / ebat uyumuna bak:
    const targetSpecs = targetDom.specTokens;
    const candSpecs = candDom.specTokens;
    const commonSpecs = targetSpecs.filter(s => candSpecs.includes(s));

    if (commonSpecs.length > 0) {
      return {
        score: 85,
        matchType: 'spec_match',
        reason: `${targetDom.domain.nameTr} grubunda ortak teknik özellik eşleşmesi (${commonSpecs.join(', ')})`
      };
    }

    return {
      score: 72,
      matchType: 'same_family',
      reason: `${targetDom.domain.nameTr} grubunda aynı malzeme ailesi alımı`
    };
  }

  // Hedef malzeme tanımlı 20 ana grupta değilse:
  // Aday bilinen bir gruptaysa ve hedef o grupta değilse -> REDDET
  if (candDom.domain && !candDom.domain.positive.test(tClean)) {
    return { score: 0, matchType: 'none', reason: `Aday bilinen bir gruba ait (${candDom.domain.nameTr}) fakat hedef o grupta değil` };
  }

  // Çok sıkı kelime ve kök eşleşmesi uygula:
  const tWords = tClean.split(/[\s,./\\-_+()№*#:]+/).filter(w => w.length >= 4 && !/^\d+$/.test(w));
  const cWords = cClean.split(/[\s,./\\-_+()№*#:]+/).filter(w => w.length >= 4 && !/^\d+$/.test(w));

  const commonWords = tWords.filter(w => cWords.includes(w));
  const jaccard = commonWords.length / Math.max(1, (new Set([...tWords, ...cWords])).size);

  if (jaccard >= 0.5 && commonWords.length >= 2) {
    return {
      score: 80,
      matchType: 'spec_match',
      reason: `Çoklu anahtar kelime eşleşmesi (${commonWords.join(', ')})`
    };
  }

  if (commonWords.length >= 2 && jaccard >= 0.3) {
    return {
      score: 65,
      matchType: 'same_family',
      reason: `Ortak anahtar kelimeler (${commonWords.join(', ')})`
    };
  }

  return { score: 0, matchType: 'none', reason: 'İlişkisiz malzeme' };
}
