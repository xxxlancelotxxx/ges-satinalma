// Two-stage AI Document Processor: Extraction & Safe Standardization
import { PDFParse } from 'pdf-parse';

import { 
  getGenAI, 
  robustParseJSON, 
  validateInvoiceData, 
  checkDuplicateInvoice, 
  calculateFileHash,
  generateContentWithResilience,
  inspectAndNormalizeDocumentInput
} from './aiOcrEngine';
import { normalizeCategoryName, translateRussianMaterialToTurkish } from '../src/utils/categoryClassifier';

const parseNumberSafe = (val: any): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim();
  
  // Remove all spaces and non-breaking spaces
  str = str.replace(/[\s\u00A0]+/g, '');
  
  // Determine format based on last dot and comma
  const lastDot = str.lastIndexOf('.');
  const lastComma = str.lastIndexOf(',');
  
  if (lastDot > -1 && lastComma > -1) {
    if (lastDot > lastComma) {
      // US format: 1,234.56
      str = str.replace(/,/g, '');
    } else {
      // EU/RU format: 1.234,56
      str = str.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma > -1) {
    // Only comma: 1234,56 or 1,234
    if (str.length - lastComma <= 3) {
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  }
  
  const cleanStr = str.replace(/[^\d.-]/g, '');
  const parsed = Number(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
};

const extractStringSafe = (val: any, fallback: string = ''): string => {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'object') {
    return (val.value !== undefined && val.value !== null) ? String(val.value) : fallback;
  }
  return String(val);
};

// Stage 1: Raw document extraction & standardization prompt (Merged for speed)
export function buildStage1ExtractionPrompt(
  excelCsv?: string,
  additionalPrompt?: string,
  pdfText?: string,
  hasFirstOffer?: boolean,
  firstOfferText?: string
): string {
  return `Sen faturaları, teklifleri, irsaliyeleri ve sipariş belgelerini inceleyip standartlaştıran uzman bir malzeme mühendisi ve veri çıkarma asistanısın.

GÖREV:
Belgeden bilgileri çıkar ve malzeme kalemlerini (items) Türkçeleştirip kategorize ederek standardize et.

${hasFirstOffer ? `
KAPSAM DÜŞÜMÜ (SEPETTEN ÇIKARILAN KALEMLER) KONTROLÜ:
Kullanıcı İlk Teklif belgesini (birinci belge) ve Son İndirimli Fatura belgesini (ikinci belge) BİRLİKTE sağladı.
- DİKKATLİCE KIYASLA: İlk teklifteki (birinci belge) kalemleri oku. Son faturadaki (ikinci belge veya Excel verisi) kalemleri oku.
- İlk teklifte olup da Son faturada OLMAYAN (silinmiş/iptal edilmiş) tüm kalemleri tespit et!
- Öncelikle 'scopeDeductionReasoning' alanına düşünme sürecini yaz: "İlk teklifteki kalemler şunlar: ..., Son faturada kalanlar şunlar: ..., Çıkarılanlar: ...".
- Eğer silinmiş (kapsamdan çıkarılmış) kalemler bulursan, bunların İlk Teklif'teki (birinci belgedeki) KDV DAHİL TOPLAM fiyatlarını toplayıp 'scopeDeductionAmount' alanına sayısal olarak yazmalısın. ÖRNEK: İlk teklifte 4 kalem var ve toplam 13.7M tutuyor, son faturada 1 kalem kaldı ve tutarı 3.9M ise, silinmiş olan o 3 kalemin ilk teklifteki bedelleri olan yaklaşık 9.7M tutarını bulup yazacaksın! (Eksik kalem varsa bu tutar asla 0 olamaz!)
- Hangi kalemlerin çıkarıldığını 'scopeDeductionReason' alanına detaylıca yaz (Örn: "3 kalem (X, Y, Z) İlk Teklifte varken Son Faturada olmadığından iptal edilmiştir.").
` : ''}

ÇIKARILACAK ALANLAR:
1. documentType: 'invoice' (Fatura), 'offer' (Teklif), 'waybill' (İrsaliye) veya 'other' (Diğer)
2. supplier: TEDARİKÇİ / SATICI / DÜZENLEYEN FİRMANIN GERÇEK TAM ADI ve confidence (0-1).
   - ÇOK KRİTİK KURAL: Faturayı kesen / satan firmanın adını MUTLAKA bul.
   - Rusça belgelerde: 'Поставщик', 'Продавец', 'Исполнитель', 'ООО', 'АО', logo başlığı (Örn: 'ООО ТСК Дипломат').
   - Türkçe belgelerde: 'Satıcı', 'Tedarikçi', 'A.Ş.' içeren şirket ünvanı (Örn: 'Kardemir A.Ş.').
   - Alıcı (Покупатель / Müşteri) ile Satıcı (Поставщик / Tedarikçi) ayrımına dikkat et; faturayı kesen SATICI'dır.
3. taxId: Vergi Numarası / VKN / INN / KPP ve confidence (0-1) (varsa)
4. invoiceNumber: Fatura / Teklif Numarası (№, Счет №, Fatura No) ve confidence (0-1)
5. date: Belge Düzenleme Tarihi (YYYY-MM-DD formatında) ve confidence (0-1)
6. currency: Para birimi (RUB, TRY, USD, EUR) ve confidence (0-1)
7. subtotal: Ara toplam tutar (KDV/Vergi hariç) ve confidence (0-1)
8. discount: İskonto / İndirim tutarı ve confidence (0-1)
9. tax: KDV / Vergi tutarı (НДС / KDV) ve confidence (0-1)
10. totalAmount: Belgenin Ödenecek / Genel Toplam Tutarı (ИТОГО / ВСЕГО / Toplam). DİKKAT: Sayısal dön (örn: 1250.50). ve confidence (0-1)
11. items: Belgedeki TÜM Malzeme ve Hizmet Satırları:
    - originalName: Belgede YAZAN HAM İSİM (Birebir Rusça/İngilizce/Türkçe tam metin)
    - materialName: STANDART TÜRKÇE MALZEME ADI (Rusça/Yabancı isimleri birebir Türkçeye çevir, marka/model/çap bilgilerini KORU. Örn: "Арматура А500С Ø12" -> "A500C İnşaat Demiri Ø12")
    - category: Malzemenin Ana Kategorisi (Aşağıdaki listeden BİRİNİ SEÇ)
    - quantity: Miktar (sayısal)
    - unit: Standart birim (Adet, Ton, m³, kg, torba, m, Litre vb.)
    - unitPrice: Birim fiyat (KESİNLİKLE NET / KDV HARİÇ - Цена без НДС olarak hesaplanmış sayısal değer. Tabloda sadece KDV dahil fiyat varsa, KDV oranını [%20 veya %22 НДС] düşerek Net birim fiyatı hesapla!)
    - grossUnitPrice: KDV / НДС Dahil birim fiyat (Цена с НДС)
    - vatPercentage: Kalemin KDV / НДС oranı (örn: 22, 20, 10, 0)
    - totalPrice: Satır Net toplam tutarı (Сумма без НДС)
    - grossTotalPrice: Satır KDV Dahil toplam tutarı (Сумма с НДС)
    - brand: Varsa marka
    - model: Varsa model
    - productCode: Varsa Artikül / Ürün Kodu
    - diameter: Varsa çap (Örn: Ø12, d=14 mm)
    - dimensions: Varsa ebat/ölçü/boy (Örn: 100x200x50 mm)
    - quality: Varsa kalite sınıfı (Örn: A500C, C25/30)
    - color: Varsa renk
    - confidence: Bu satırın okunma güven skoru (0.00 - 1.00)
12. overallConfidence: Belgenin genel okunabilirlik güven skoru (0.00 - 1.00)
13. rawWarnings: Okunmayan, silik veya şüpheli alanlar varsa açıklamaları

KATEGORİLER (SADECE AŞAĞIDAKİ 28 KESİN KANONİK KATEGORİDEN BİRİNİ SEÇ, "DİĞER" VEYA TORBA KATEGORİ KESİNLİKLE YASAKTIR):
1. İnşaat Demiri | 2. Çelik Borular | 3. Çelik Malzemeler | 4. Donatı Malzemeleri | 5. Ankraj Sistemleri | 6. Hazır Beton, Çimento & Agrega | 7. Tuğla, Gazbeton & Duvar Blokları | 8. Kalıp & İskele Sistemleri | 9. Ahşap & Kereste | 10. Yalıtım & Alçıpan | 11. Kimyasallar & Boya | 12. Mekanik & Tesisat | 13. Elektrik & Otomasyon | 14. İş Güvenliği & KKD | 15. El Aletleri & Hırdavat | 16. Sarf Malzeme & Hırdavat | 17. Kaynak Malzemeleri | 18. Seramik & Vitrifiye | 19. İç Mekan, Zemin & Kapı / Doğrama | 20. Tabela, Yönlendirme & Reklam | 21. Ölçüm, Harita & Saha Ekipmanları | 22. Şantiye Mobilya & Yaşam Donanımı | 23. Şantiye Tesis & Konteyner | 24. Temizlik & Hijyen Malzemeleri | 25. Gıda & Mutfak Malzemeleri | 26. Ofis & Kırtasiye | 27. Bilgi İşlem & IT | 28. Araç & İş Makinesi Ekipmanları

KRİTİK KATEGORİ VE AKSESUAR AYRIŞTIRMA KURALLARI ("İÇİN / ДЛЯ"):
- İNŞAAT DEMİRİ KORUYUCU BAŞLIKLARI: "Колпачок для арматуры", "грибок", "güvenlik mantarı", "koruyucu başlık", "güvenlik başlığı" KESİNLİKLE "Sarf Malzeme & Hırdavat" kategorisindedir! Asla "İnşaat Demiri" yapılamaz. Örn: "Колпачок для арматуры 10-18 мм грибок (упаковка 1000 шт)" -> "İnşaat Demiri Güvenlik Başlığı Mantar Tip 10-18 mm (1000 Adetlik Paket)" (Sarf Malzeme & Hırdavat).
- DONATI AKSESUARLARI: "фиксатор", "паспой", "paspayı", "çiroz", "donatı sehpası", "лягушка", "проволока вязальная", "bağ teli" -> "Donatı Malzemeleri" veya "Sarf Malzeme & Hırdavat".
- DEMİR EL ALETLERİ & MAKİNELER: "крючок", "пистолет", "ножницы", "станок", "kesme makası", "bükme aparatı", "зубило", "keski" -> "Sarf Malzeme & Hırdavat".
- KALIP/DONATI YAĞI & KATKILAR: "смазка для форм", "эмульсол", "добавка для бетона", "клей для плитки", "затирка" -> "Yapı Kimyasalları".
- SADECE YAPISAL DONATI (пруток, арматура а500с, nervürlü demir, filmaşin, çelik hasır) "İnşaat Demiri & Çelik" kategorisindedir.
- DİĞER: "труба для кабеля / kablo borusu" -> Elektrik & Otomasyon. "изоляция для труб" -> Yalıtım & Alçıpan. "хомут для труб" -> Sarf Malzeme & Hırdavat. "саморез для гипсокартона" -> Sarf Malzeme & Hırdavat. "профиль для гкл" -> Yalıtım & Alçıpan. "крестики для плитки" -> Sarf Malzeme & Hırdavat. "растворитель / tiner" -> Boya & Dış Cephe. "валик / rulo", "кисть / fırça" -> Sarf Malzeme & Hırdavat.

${firstOfferText ? `\n--- İLK TEKLİF BELGESİ METİN/TABLO VERİSİ ---\n${firstOfferText}\n----------------------------------------------\n` : ''}
${pdfText ? `\n--- DİJİTAL BELGE METİN KATMANI ---\n${pdfText}\n-----------------------------------\n` : ''}
${excelCsv ? `\n--- EXCEL/CSV VERİSİ ---\n${excelCsv}\n------------------------\n` : ''}
${additionalPrompt ? `\nEk Kullanıcı Notu: ${additionalPrompt}\n` : ''}

ÖNEMLİ KURALLAR:
- ASLA uydurma değer üretme. Okunamayan alanları JSON'a ekleme.
- Metin değerlerinin içinde çift tırnak (") kullanma, şirket ünvanlarında tırnak gerekiyorsa « » veya tek tırnak kullan (Örn: ООО «ТСК Дипломат»).
- HIZ VE TOKEN TASARRUFU KURALI: 'items' dizisindeki her bir kalem için SADECE değeri olan alanları üret. Eğer bir alan (örn: brand, model, productCode, diameter, dimensions, quality, color vb.) belgede yoksa veya boşsa, o alanı JSON'a ASLA ekleme!
- NET (KDV HARİÇ) BİRİM FİYAT & NAKLİYE AYRIŞTIRMA KURALI: "items" listesindeki her malzemenin "unitPrice" ve "totalPrice" değerleri KESİNLİKLE NET (KDV / НДС HARİÇ - Цена без НДС) olarak yazılmalı, KDV dahil karşılıkları ise "grossUnitPrice" ve "grossTotalPrice" alanlarına yazılmalıdır. Ayrıca faturadaki Nakliye / Hizmet (Доставка, Транспортные услуги, Автоуслуги, Манипулятор, Погрузка/разгрузка, Резка, Nakliye) satırları malzeme listesine ('items') ASLA eklenmemelidir!
- EXCEL/CSV TOPLAM SATIRI KURALI: Tablolardaki 'ИТОГО', 'ВСЕГО', 'Toplam', 'Genel Toplam', 'KDV', 'НДС', 'İndirim' satırları ÜRÜN KALEMİ DEĞİLDİR! Bunları 'items' listesine ASLA ekleme; sadece üst subtotal/tax/totalAmount alanlarına yaz.

SADECE GEÇERLİ JSON DÖN (Şablon):
{
  "documentType": "invoice",
  "supplier": { "value": "Belgedeki Gerçek Satıcı Şirket Adı", "confidence": 0.98 },
  "taxId": { "value": "7701234567", "confidence": 0.90 },
  "invoiceNumber": { "value": "123456", "confidence": 0.98 },
  "date": { "value": "YYYY-MM-DD", "confidence": 0.95 },
  "currency": { "value": "RUB", "confidence": 0.95 },
  "subtotal": { "value": 100000, "confidence": 0.90 },
  "discount": { "value": 0, "confidence": 0.90 },
  "tax": { "value": 20000, "confidence": 0.90 },
  "totalAmount": { "value": 120000, "confidence": 0.98 },
  "scopeDeductionReasoning": { "value": "Adım 1: İlk teklif kalemleri... Adım 2: Son faturadaki kalemler... Adım 3: Çıkarılanlar... (Eğer yoksa boş bırak)" },
  "scopeDeductionAmount": { "value": 0, "confidence": 0.95 },
  "scopeDeductionReason": { "value": "", "confidence": 0.95 },
  "items": [
    {
      "originalName": "Арматура А500С Ø12 (11.7м ГОСТ 34028)",
      "materialName": "A500C İnşaat Demiri Ø12 (11.7m)",
      "category": "İnşaat Demiri & Çelik",
      "quantity": 10,
      "unit": "Ton",
      "unitPrice": 12000,
      "totalPrice": 120000,
      "diameter": "Ø12 mm",
      "dimensions": "11.7m",
      "quality": "A500C",
      "confidence": 0.95
    }
  ],
  "overallConfidence": 0.95,
  "rawWarnings": []
}`;
}

// Stage 1 LIGHT: Ultra-fast metadata-only extraction for initial offers & negotiation rounds
export function buildStage1SummaryOnlyPrompt(excelCsv?: string, additionalPrompt?: string, pdfText?: string): string {
  return `Sen faturaları ve ilk teklif belgelerini inceleyen süper hızlı bir veri çıkarma asistanısın.

GÖREV (HIZLI ÜST BİLGİ & TOPLAM TUTAR OKUMA):
Belgeden SADECE ve YALNIZCA firma adını, fatura/teklif numarasını, tarihini, para birimini, yaklaşık kalem sayısını (itemCount) ve genel toplam tutarını çıkar.

⚠️ KRİTİK HIZ KURALI:
Tablonun içindeki ürünleri tek tek JSON'a yazma! 'items' dizisini KESİNLİKLE BOŞ BIRAK ([]).
Bu işlem ilk teklif veya pazarlık turu içindir. Amaç sadece belgenin kime ait olduğunu ve En Alt kısımdaki Genel Toplam (KDV/NDS Dahil) tutarını saniyesinde bulmaktır.
Metin değerlerinin içinde çift tırnak (") kullanma, şirket ünvanlarında tırnak gerekiyorsa « » kullan.

ÇIKARILACAK ALANLAR:
1. documentType: 'offer' (Teklif) veya 'invoice' (Fatura)
2. supplier: TEDARİKÇİ / SATICI / TEKLİF VEREN FİRMANIN GERÇEK TAM ADI ve confidence (0-1).
   - Rusça belgelerde: 'Поставщик (исполнитель)', 'Продавец', 'Исполнитель', 'Организация', 'ООО', 'АО', 'ПАО', 'ИП', logo başlığı.
   - Türkçe belgelerde: 'Satıcı', 'Tedarikçi', 'Firma'.
3. invoiceNumber: Fatura / Teklif Numarası (№, Счет №, Teklif No)
4. date: Belge Düzenleme Tarihi (YYYY-MM-DD)
5. currency: Para birimi (RUB, TRY, USD, EUR)
6. totalAmount: Belgenin Genel Toplam / Teklif Tutarı (ИТОГО / ВСЕГО / Всего к оплате / Toplam). Belgenin en altındaki KDV dahil ödenecek rakamı bul. DİKKAT: Rakamları temizle, ondalık kısım için nokta kullan ve sadece sayı olarak döndür (örn: "815 726,39" veya "815.726,39" -> 815726.39). Boşluk bırakma!
7. itemCount: Tablodaki toplam satır/kalem sayısı (varsa sıra numarasının son rakamı).

${pdfText ? `\n--- DİJİTAL BELGE METİN KATMANI ---\n${pdfText}\n-----------------------------------\n` : ''}
${excelCsv ? `\n--- EXCEL/CSV VERİSİ ---\n${excelCsv}\n------------------------\n` : ''}
${additionalPrompt ? `\nEk Not: ${additionalPrompt}\n` : ''}

SADECE GEÇERLİ JSON DÖN:
{
  "documentType": "offer",
  "supplier": { "value": "Belgedeki Tedarikçi Şirket Adı", "confidence": 0.98 },
  "invoiceNumber": { "value": "123456", "confidence": 0.98 },
  "date": { "value": "YYYY-MM-DD", "confidence": 0.95 },
  "currency": { "value": "RUB", "confidence": 0.95 },
  "totalAmount": { "value": 1250000, "confidence": 0.98 },
  "itemCount": 5,
  "items": []
}`;
}

// Stage 2: Standardization prompt
export function buildStage2StandardizationPrompt(rawExtraction: any): string {
  const extractedSupplierVal = extractSupplierName(rawExtraction?.supplier) || 
                               extractSupplierName(rawExtraction?.vendorName) || 
                               extractSupplierName(rawExtraction?.company) || '';

  return `Sen inşaat ve satınalma malzemelerini standartlaştıran kıdemli malzeme mühendisisin.

GÖREV (AŞAMA 2 - STANDARTLAŞTIRMA):
Aşağıda verilen ham fatura/teklif verisini incele ve her kalem için STANDART TÜRKÇE MALZEME ADI (materialName), KATEGORİ (category) ve STANDART BİRİM (unit) üret.

GİRDİ (AŞAMA 1 HAM VERİ):
${JSON.stringify(rawExtraction, null, 2)}

SADECE GEÇERLİ JSON DÖN:
{
  "documentType": "${rawExtraction.documentType || 'invoice'}",
  "supplier": ${JSON.stringify(extractedSupplierVal || rawExtraction.supplier || 'Tedarikçi Firma')},
  "vendorName": ${JSON.stringify(extractedSupplierVal || rawExtraction.supplier || 'Tedarikçi Firma')},
  "items": []
}`;
}

const INVALID_SUPPLIER_NAMES = new Set([
  'bilinmeyen tedarikçi',
  'belgeden tedarikçi',
  'excel tedarikçi firma',
  'tedarikçi / satıcı tam firma ünvanı',
  'tedarikçi / satıcı firma',
  'tedarikçi firma adı',
  'tedarikçi firma',
  'belgedeki gerçek satıcı / tedarikçi şirket adı',
  'belgedeki gerçek satıcı şirket adı',
  'belgedeki tedarikçi şirket adı',
  'undefined',
  'null',
  '-',
  'none',
  'unknown'
]);

export function extractSupplierName(obj: any): string {
  if (!obj) return '';
  if (typeof obj === 'string') {
    let trimmed = obj.trim();
    trimmed = trimmed.replace(/^[:\s"'«»“”]+|[:\s"'«»“”]+$/g, '').trim();
    if (trimmed && !INVALID_SUPPLIER_NAMES.has(trimmed.toLowerCase())) {
      return trimmed;
    }
    return '';
  }
  if (typeof obj === 'object') {
    for (const key of ['value', 'name', 'supplier', 'vendor', 'vendorName', 'company', 'companyName', 'seller']) {
      if (obj[key] !== undefined) {
        const res = extractSupplierName(obj[key]);
        if (res) return res;
      }
    }
  }
  return '';
}

// Regex and heuristic text extraction from raw document text / CSV / filename
export function fallbackExtractSupplierFromText(textContext?: string, fileName?: string): string {
  if (!textContext && !fileName) return '';

  const fullText = (textContext || '') + '\n' + (fileName || '');
  if (!fullText.trim()) return '';

  // 1. Regex for Russian invoice seller labels
  const postMatch = fullText.match(/(?:Поставщик\s*(?:\(исполнитель\))?|Продавец|Исполнитель|Грузоотправитель|Организация)\s*[:：\t,-]\s*([^\r\n;]+)/i);
  if (postMatch && postMatch[1]) {
    const rawSup = postMatch[1].split(/\s+(?:ИНН|КПП|Адрес|р\/с|тел\.?)\b/i)[0].trim();
    const candidate = extractSupplierName(rawSup);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 2. Regex for Turkish seller labels
  const satMatch = fullText.match(/(?:Satıcı|Tedarikçi|Firma Ünvanı|Düzenleyen)\s*[:：\t]\s*([^\r\n,;]+)/i);
  if (satMatch && satMatch[1]) {
    const candidate = extractSupplierName(satMatch[1]);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 3. Regex for common corporate entities with quotes (e.g. ООО "Строй-Комплект", АО «Северсталь», ИП Иванов)
  const corpMatch = fullText.match(/(?:ООО|АО|ПАО|ЗАО|НАО)\s*["«“]([^"»”\r\n]{2,60})["»”]|(?:ООО|АО|ПАО|ЗАО|НАО)\s+([А-Яа-яЁёA-Za-z0-9\-_ ]{3,45})|ИП\s+([А-Яа-яЁёA-Za-z\-_]+(?:\s+[А-Яа-яЁёA-Za-z.\-_]+){1,2})/);
  if (corpMatch) {
    const found = corpMatch[0].split(/\s+(?:ИНН|КПП|Адрес|Покупатель)\b/i)[0].trim();
    const candidate = extractSupplierName(found);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 4. Regex for Turkish A.Ş. / Ltd. Şti.
  const trCorpMatch = fullText.match(/([A-Za-zÇĞİÖŞÜçğıöşü0-9\s.\-&]{3,50}\s+(?:A\.Ş\.|Ltd\.\s*Şti\.|Anonim Şirketi|Limited Şirketi))/i);
  if (trCorpMatch && trCorpMatch[1]) {
    const candidate = extractSupplierName(trCorpMatch[1]);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 5. Filename keyword hints
  if (fileName) {
    const cleanFn = fileName.replace(/\.[^.]+$/, '').replace(/[_.\-+]/g, ' ').trim();
    if (/diplomat|дипломат/i.test(cleanFn)) return 'ООО "ТСК ДИПЛОМАТ"';
    if (/diler|дилер/i.test(cleanFn)) return 'Diler Demir Çelik A.Ş.';
    if (/kardemir/i.test(cleanFn)) return 'Kardemir Demir Çelik A.Ş.';
    if (/cimsa|çimsa|чимса/i.test(cleanFn)) return 'Çimsa Çimento Sanayi A.Ş.';
    if (/akcansa|akçansa/i.test(cleanFn)) return 'Akçansa Çimento Sanayi A.Ş.';
    if (/stroysnab|стройснаб/i.test(cleanFn)) return 'ООО "СтройСнаб"';
    if (/metallservice|металлсервис|металл-сервис/i.test(cleanFn)) return 'ООО "МЕТАЛЛ-СЕРВИС"';
    if (/stroykomplekt|стройкомплект/i.test(cleanFn)) return 'ООО "СтройКомплект"';
    if (cleanFn.length >= 3 && !/^(fatura|teklif|belge|invoice|scan|image|img|doc|document|pdf|\d+)$/i.test(cleanFn)) {
      return cleanFn;
    }
  }

  return '';
}

const RU_MONTHS: Record<string, string> = {
  'январ': '01', 'феврал': '02', 'март': '03', 'апрел': '04',
  'ма': '05', 'июн': '06', 'июл': '07', 'август': '08',
  'сентябр': '09', 'октябр': '10', 'ноябр': '11', 'декабр': '12'
};

/**
 * Checks whether extracted PDF text is readable digital text (not garbled CMap glyphs)
 */
function isReadableDigitalText(text: string): boolean {
  if (!text || text.trim().length < 40) return false;
  const validChars = (text.match(/[A-Za-zА-Яа-яЁёÇĞİÖŞÜçğıöşü0-9]/g) || []).length;
  const ratio = validChars / text.length;
  return ratio > 0.35;
}

/**
 * Local Resilient Parser: Extracts supplier, invoiceNumber, date, currency, totalAmount, and line items
 * from PDF digital text or Excel/CSV content whenever AI models are unavailable or return empty results.
 */
export function fallbackExtractInvoiceFromTextOrCsv(
  textOrCsv?: string,
  fileName?: string,
  isSummaryOnly?: boolean
): any {
  const fullText = (textOrCsv || '').trim();
  const supplier = fallbackExtractSupplierFromText(fullText, fileName) || 'Tedarikçi Firma';

  // 1. Extract Invoice / Offer Number
  let invoiceNumber = '';
  const invMatch =
    fullText.match(/(?:Счет(?:\s+на\s+оплату)?|Счёт(?:\s+на\s+оплату)?|УПД|Fatura\s*No|Teklif\s*No|Belge\s*No|Invoice\s*(?:No|#)?)\s*(?:№|#|:)?\s*([A-Za-zА-Яа-я0-9\-_/]{1,25})/i) ||
    fullText.match(/№\s*([A-Za-zА-Яа-я0-9\-_/]{2,20})\s+от/i);
  if (invMatch && invMatch[1]) {
    invoiceNumber = invMatch[1].trim();
  } else if (fileName) {
    const fnNum = fileName.match(/(?:№|No|FT|TKF|INV)[_\-\s]*([A-Za-z0-9\-]{2,15})/i);
    if (fnNum && fnNum[1]) invoiceNumber = fnNum[1];
  }
  if (!invoiceNumber) {
    invoiceNumber = `BLG-${Date.now().toString().slice(-6)}`;
  }

  // 2. Extract Date (YYYY-MM-DD)
  let date = new Date().toISOString().split('T')[0];
  const isoMatch = fullText.match(/\b(202\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/);
  const dotMatch = fullText.match(/\b(0[1-9]|[12]\d|3[01])[./](0[1-9]|1[0-2])[./](202\d)\b/);
  const ruDateMatch = fullText.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(202\d)\b/i);
  if (isoMatch) {
    date = isoMatch[1];
  } else if (dotMatch) {
    date = `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  } else if (ruDateMatch) {
    const day = ruDateMatch[1].padStart(2, '0');
    const mRaw = ruDateMatch[2].toLowerCase();
    let month = '01';
    for (const [prefix, mCode] of Object.entries(RU_MONTHS)) {
      if (mRaw.startsWith(prefix)) {
        month = mCode;
        break;
      }
    }
    date = `${ruDateMatch[3]}-${month}-${day}`;
  }

  // 3. Detect Currency
  let currency = 'RUB';
  if (/\b(?:TRY|TL|₺|Türk Lirası)\b/i.test(fullText)) currency = 'TRY';
  else if (/\b(?:USD|\$)\b/i.test(fullText)) currency = 'USD';
  else if (/\b(?:EUR|€)\b/i.test(fullText)) currency = 'EUR';

  // 4. Extract Grand Total from Explicit Total Labels (ИТОГО / ВСЕГО К ОПЛАТЕ / Genel Toplam)
  let explicitTotal = 0;
  const totalRegexes = [
    /(?:Всего\s+к\s+оплате|Итого\s+с\s+НДС|Всего\s+наименований[^\r\n]*?на\s+сумму|ИТОГО|ВСЕГО|Genel\s+Toplam|Ödenecek\s+Tutar|Toplam\s+Tutar)\s*[:：;,\t ]*\s*([\d\s\u00A0.,]{3,22})/gi
  ];
  for (const rgx of totalRegexes) {
    let m: RegExpExecArray | null;
    while ((m = rgx.exec(fullText)) !== null) {
      const candidateVal = parseNumberSafe(m[1]);
      if (candidateVal > explicitTotal && candidateVal < 1e11) {
        explicitTotal = candidateVal;
      }
    }
  }

  // 5. Parse CSV / Table Lines for Items & Sum
  const fallbackItems: any[] = [];
  let sumLineTotals = 0;
  const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const summaryKeywordRegex = /^(?:итого|всего|в\s*т\.?\s*ч\.?\s*ндс|ндс|без\s*ндс|toplam|genel\s*toplam|ara\s*toplam|kdv|iskonto|indirim|total|subtotal|сумма)/i;
  const headerKeywordRegex = /(?:наименование|товары\s*\(работы|malzeme\s*adı|ürün\s*adı|birim\s*fiyat|количество|кол-во|ед\.\s*изм|цена)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('---')) continue;
    if (headerKeywordRegex.test(line)) continue;

    const parts = (line.includes(';') ? line.split(';') : line.split(',')).map(p => p.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
    if (parts.length >= 2) {
      const joinedLower = parts.join(' ').toLowerCase();
      if (summaryKeywordRegex.test(parts[0]) || summaryKeywordRegex.test(joinedLower)) {
        // Check if this summary row has the grand total
        if (/(?:итого|всего|genel\s*toplam|toplam)/i.test(joinedLower) && !/(?:ндс|kdv|iskonto)/i.test(parts[0])) {
          const numsInSummary = parts.map(p => parseNumberSafe(p)).filter(n => n > 0 && n < 1e11);
          if (numsInSummary.length > 0) {
            const maxSummaryNum = Math.max(...numsInSummary);
            if (maxSummaryNum > explicitTotal) explicitTotal = maxSummaryNum;
          }
        }
        continue;
      }

      // Find first non-numeric text column as material description
      let nameColIdx = -1;
      for (let c = 0; c < parts.length; c++) {
        const cell = parts[c];
        if (cell.length >= 3 && /[A-Za-zА-Яа-яЁёÇĞİÖŞÜçğıöşü]/.test(cell) && !/^\d+$/.test(cell)) {
          nameColIdx = c;
          break;
        }
      }
      if (nameColIdx === -1) continue;

      const rawOriginalName = parts[nameColIdx];
      if (summaryKeywordRegex.test(rawOriginalName)) continue;

      const afterCols = parts.slice(nameColIdx + 1);
      let unit = 'Adet';
      const numericValues: number[] = [];

      for (const col of afterCols) {
        if (/^(?:шт\.?|т|тн|тонн[аы]?|м3|м³|м2|м²|п\.?\s*м\.?|м|кг|л|упак\.?|компл\.?|рул\.?|меш\.?|adet|ton|kg|m3|m2|m|lt|paket|torba|koli)$/i.test(col)) {
          unit = col;
        } else {
          const num = parseNumberSafe(col);
          if (num > 0 && num < 1e10) {
            numericValues.push(num);
          }
        }
      }

      if (numericValues.length > 0) {
        let qty = 1;
        let unitPrice = numericValues[0];
        let totalPrice = numericValues[numericValues.length - 1];

        if (numericValues.length >= 3) {
          qty = numericValues[0];
          unitPrice = numericValues[1];
          totalPrice = numericValues[numericValues.length - 1];
        } else if (numericValues.length === 2) {
          qty = numericValues[0];
          totalPrice = numericValues[1];
          unitPrice = qty > 0 ? Number((totalPrice / qty).toFixed(2)) : totalPrice;
        }

        if (totalPrice > 0) {
          sumLineTotals += totalPrice;
          const trName = translateRussianMaterialToTurkish(rawOriginalName) || rawOriginalName;
          const cat = normalizeCategoryName('', `${trName} ${rawOriginalName}`);
          fallbackItems.push({
            materialName: trName,
            originalName: rawOriginalName,
            category: cat,
            quantity: qty,
            unit,
            unitPrice,
            totalPrice,
            confidence: 0.85
          });
        }
      }
    }
  }

  const finalTotal = explicitTotal > 0 ? explicitTotal : sumLineTotals;

  return {
    documentType: isSummaryOnly ? 'offer' : 'invoice',
    supplier: { value: supplier, confidence: 0.85 },
    vendorName: { value: supplier, confidence: 0.85 },
    invoiceNumber: { value: invoiceNumber, confidence: 0.85 },
    date: { value: date, confidence: 0.85 },
    currency: { value: currency, confidence: 0.90 },
    totalAmount: { value: finalTotal, confidence: 0.85 },
    subtotal: { value: finalTotal, confidence: 0.85 },
    tax: { value: 0, confidence: 0.80 },
    itemCount: fallbackItems.length || 1,
    items: isSummaryOnly ? [] : fallbackItems,
    overallConfidence: 0.85,
    rawWarnings: []
  };
}

// Full Two-Stage Processing Pipeline with Multi-Model Fallback & Argon Escalation
export async function processInvoiceTwoStages(params: {
  base64Input?: string;
  mimeType?: string;
  excelCsv?: string;
  fileTextContext?: string;
  fileName?: string;
  additionalPrompt?: string;
  existingInvoices?: any[];
  scanMode?: 'full' | 'summary-only';
  offerType?: 'first' | 'final' | 'round';
  firstOfferBase64?: string;
  firstOfferFileName?: string;
}): Promise<{
  success: boolean;
  extracted: any;
  validation: any;
  duplicateInfo: any;
  usedModel: string;
  retryCount: number;
  stagesCompleted: number;
}> {
  const isSummaryOnly = params.scanMode === 'full'
    ? false
    : (params.scanMode === 'summary-only' || params.offerType === 'first' || params.offerType === 'round');
  const ai = getGenAI();
  let usedModel = 'gemini-3.8-flash';
  let retryCount = 0;
  let rawExtracted: any = null;
  let standardized: any = null;

  // 1. Inspect & Normalize Main Document Input (Magic Bytes + Extension + Server-side Excel Parser)
  const normDoc = inspectAndNormalizeDocumentInput(params.base64Input, params.mimeType, params.fileName);
  const cleanBase64 = normDoc.cleanBase64;

  // Combine all Excel / CSV / client text contexts cleanly
  const combinedExcelParts: string[] = [];
  if (params.excelCsv && params.excelCsv.trim()) combinedExcelParts.push(params.excelCsv.trim());
  if (params.fileTextContext && params.fileTextContext.trim() && !combinedExcelParts.includes(params.fileTextContext.trim())) {
    combinedExcelParts.push(params.fileTextContext.trim());
  }
  if (normDoc.extractedExcelCsv && normDoc.extractedExcelCsv.trim() && !combinedExcelParts.includes(normDoc.extractedExcelCsv.trim())) {
    combinedExcelParts.push(normDoc.extractedExcelCsv.trim());
  }
  const effectiveExcelCsv = combinedExcelParts.length > 0 ? combinedExcelParts.join('\n\n') : undefined;

  // 2. Inspect & Normalize First Offer Document (if provided for scope deduction comparison)
  const normFirstOffer = params.firstOfferBase64
    ? inspectAndNormalizeDocumentInput(params.firstOfferBase64, undefined, params.firstOfferFileName)
    : undefined;

  const fileHash = cleanBase64
    ? calculateFileHash(cleanBase64)
    : (effectiveExcelCsv ? calculateFileHash(Buffer.from(effectiveExcelCsv)) : undefined);
  const fileSizeBytes = cleanBase64
    ? Buffer.from(cleanBase64, 'base64').length
    : (effectiveExcelCsv ? Buffer.from(effectiveExcelCsv).length : 0);

  // 3. Hybrid PDF Reading: Extract embedded digital text AND keep visual PDF inlineData
  let extractedPdfText = '';
  if (cleanBase64 && normDoc.isPdf) {
    try {
      const pdfBuf = Buffer.from(cleanBase64, 'base64');
      const parser = new PDFParse({ data: pdfBuf });
      const parsedPdf = await parser.getText();
      const numPages = parsedPdf?.total || 1;
      await parser.destroy().catch(() => {});
      if (parsedPdf && parsedPdf.text && isReadableDigitalText(parsedPdf.text)) {
        extractedPdfText = parsedPdf.text.trim().slice(0, 45000);
        console.log(`[PDF Hybrid Parser] PDF dijital metin katmanı okundu (${extractedPdfText.length} karakter, ${numPages} sayfa) + Görsel OCR aktif`);
      }
    } catch (pdfErr: any) {
      console.warn('[PDF Hybrid Parser] PDF metin katmanı okunamadı, doğrudan görsel OCR uygulanacak:', pdfErr?.message);
    }
  }

  let firstOfferPdfText = '';
  if (normFirstOffer?.cleanBase64 && normFirstOffer.isPdf) {
    try {
      const firstPdfBuf = Buffer.from(normFirstOffer.cleanBase64, 'base64');
      const firstParser = new PDFParse({ data: firstPdfBuf });
      const firstParsed = await firstParser.getText();
      await firstParser.destroy().catch(() => {});
      if (firstParsed && firstParsed.text && isReadableDigitalText(firstParsed.text)) {
        firstOfferPdfText = firstParsed.text.trim().slice(0, 30000);
      }
    } catch (_) {}
  }

  const combinedFirstOfferText = [
    normFirstOffer?.extractedExcelCsv || '',
    firstOfferPdfText
  ].filter(Boolean).join('\n\n') || undefined;

  // Helper to build multimodal contents safely (NEVER sending Excel or octet-stream to inlineData)
  const buildMultimodalContents = (promptText: string): any[] => {
    const contents: any[] = [];
    if (normFirstOffer && normFirstOffer.isSupportedVision && normFirstOffer.cleanBase64) {
      const firstBytes = Buffer.from(normFirstOffer.cleanBase64, 'base64').length;
      if (firstBytes < 18 * 1024 * 1024) {
        contents.push({ text: "İLK TEKLİF BELGESİ (Kapsam kontrolü için):" });
        contents.push({
          inlineData: {
            data: normFirstOffer.cleanBase64,
            mimeType: normFirstOffer.mimeType
          }
        });
        contents.push({ text: "SON ANLAŞILAN FATURA (Asıl çıkarım buradan yapılacak):" });
      }
    }
    if (normDoc.isSupportedVision && cleanBase64 && fileSizeBytes < 18 * 1024 * 1024) {
      contents.push({
        inlineData: {
          data: cleanBase64,
          mimeType: normDoc.mimeType
        }
      });
    }
    contents.push({ text: promptText });
    return contents;
  };

  // ============================================================================
  // BRANCH A: SUMMARY-ONLY (INITIAL OFFER / NEGOTIATION ROUNDS)
  // ============================================================================
  if (isSummaryOnly) {
    const lightPrompt = buildStage1SummaryOnlyPrompt(effectiveExcelCsv, params.additionalPrompt, extractedPdfText);
    const contents = buildMultimodalContents(lightPrompt);

    try {
      // Pass 1: Fast Flash chain starting with gemini-3.8-flash
      const genResult = await generateContentWithResilience(ai, {
        contents,
        config: { responseMimeType: "application/json" },
        primaryModel: 'gemini-3.8-flash',
        validateText: (txt) => {
          const parsed = robustParseJSON(txt);
          return Boolean(parsed && typeof parsed === 'object');
        }
      });
      usedModel = genResult.usedModel;
      rawExtracted = robustParseJSON(genResult.text || '{}');

      const extractedTotal = parseNumberSafe(rawExtracted?.totalAmount?.value ?? rawExtracted?.totalAmount ?? 0);
      // Escalate to gemini-4-argon if Flash couldn't read totalAmount on a complex document
      if (extractedTotal <= 0 && !usedModel.includes('argon')) {
        console.log('[Gemini AI OCR] Zorlu ilk teklif belgesi tespit edildi, gemini-4-argon devreye alınıyor...');
        retryCount++;
        const argonRes = await generateContentWithResilience(ai, {
          contents,
          config: { responseMimeType: "application/json" },
          primaryModel: 'gemini-4-argon'
        });
        const argonParsed = robustParseJSON(argonRes.text || '{}');
        if (argonParsed && parseNumberSafe(argonParsed?.totalAmount?.value ?? argonParsed?.totalAmount ?? 0) > 0) {
          rawExtracted = argonParsed;
          usedModel = argonRes.usedModel;
        }
      }
    } catch (err: any) {
      retryCount++;
      console.warn('[AI Summary OCR] AI modelleri yanıt veremedi, yerel kurtarma ayrıştırıcısı devreye alınıyor:', err?.message);
      rawExtracted = fallbackExtractInvoiceFromTextOrCsv(
        [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
        params.fileName,
        true
      );
      usedModel = 'local-resilient-parser';
    }

    if (!rawExtracted || typeof rawExtracted !== 'object') {
      rawExtracted = fallbackExtractInvoiceFromTextOrCsv(
        [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
        params.fileName,
        true
      );
      usedModel = 'local-resilient-parser';
    }

    // Supplement missing fields from local parser if AI left totalAmount or supplier empty
    const localSupplement = fallbackExtractInvoiceFromTextOrCsv(
      [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
      params.fileName,
      true
    );

    const resolvedSupplier = 
      extractSupplierName(rawExtracted.supplier) ||
      extractSupplierName(rawExtracted.vendorName) ||
      extractSupplierName(rawExtracted.company) ||
      extractSupplierName(rawExtracted.seller) ||
      extractSupplierName(localSupplement.supplier) ||
      'Tedarikçi Firma';

    const resolvedTotal =
      parseNumberSafe(rawExtracted.totalAmount?.value ?? rawExtracted.totalAmount ?? 0) ||
      parseNumberSafe(localSupplement.totalAmount?.value ?? 0);

    const finalSummaryExtracted: any = {
      documentType: rawExtracted.documentType || 'offer',
      supplier: resolvedSupplier,
      vendorName: resolvedSupplier,
      company: resolvedSupplier,
      seller: resolvedSupplier,
      taxId: extractStringSafe(rawExtracted.taxId),
      invoiceNumber: extractStringSafe(rawExtracted.invoiceNumber) || extractStringSafe(localSupplement.invoiceNumber),
      date: extractStringSafe(rawExtracted.date) || extractStringSafe(localSupplement.date, new Date().toISOString().split('T')[0]),
      currency: extractStringSafe(rawExtracted.currency, 'RUB'),
      subtotal: parseNumberSafe(rawExtracted.subtotal?.value ?? rawExtracted.subtotal ?? resolvedTotal),
      discount: 0,
      tax: 0,
      totalAmount: resolvedTotal,
      itemCount: parseNumberSafe(rawExtracted.itemCount?.value ?? rawExtracted.itemCount ?? rawExtracted.itemsCount ?? (Array.isArray(rawExtracted.items) && rawExtracted.items.length > 0 ? rawExtracted.items.length : localSupplement.itemCount)),
      category: rawExtracted.category || 'İnşaat Demiri & Çelik',
      summary: rawExtracted.summary || 'İlk teklif özeti (hızlı okuma)',
      items: [],
      overallConfidence: parseNumberSafe(rawExtracted.overallConfidence ?? 0.95),
      rawConfidenceScores: {
        supplier: rawExtracted.supplier?.confidence ?? 0.95,
        invoiceNumber: rawExtracted.invoiceNumber?.confidence ?? 0.95,
        date: rawExtracted.date?.confidence ?? 0.95,
        totalAmount: rawExtracted.totalAmount?.confidence ?? 0.95
      },
      rawWarnings: []
    };

    const validation = validateInvoiceData(finalSummaryExtracted);
    const duplicateInfo = checkDuplicateInvoice({
      supplier: finalSummaryExtracted.supplier,
      invoiceNumber: finalSummaryExtracted.invoiceNumber,
      date: finalSummaryExtracted.date,
      totalAmount: finalSummaryExtracted.totalAmount,
      fileHash,
      fileSizeBytes
    }, params.existingInvoices || []);

    return {
      success: true,
      extracted: finalSummaryExtracted,
      validation,
      duplicateInfo,
      usedModel,
      retryCount,
      stagesCompleted: 1
    };
  }

  // ============================================================================
  // BRANCH B: FULL ITEM EXTRACTION (FINAL INVOICE / SCANNER / COMPARATIVE / AUDIT)
  // ============================================================================
  const hasFirstOffer = Boolean(params.firstOfferBase64 || combinedFirstOfferText);
  const stage1Prompt = buildStage1ExtractionPrompt(
    effectiveExcelCsv,
    params.additionalPrompt,
    extractedPdfText,
    hasFirstOffer,
    combinedFirstOfferText
  );
  const contents = buildMultimodalContents(stage1Prompt);

  try {
    // Pass 1: Fast & accurate gemini-3.8-flash with multi-model resilience
    const genResult = await generateContentWithResilience(ai, {
      contents,
      config: { responseMimeType: "application/json" },
      primaryModel: 'gemini-3.8-flash',
      validateText: (txt) => {
        const parsed = robustParseJSON(txt);
        return Boolean(parsed && typeof parsed === 'object');
      }
    });
    usedModel = genResult.usedModel;
    rawExtracted = robustParseJSON(genResult.text || '{}');

    const extractedTotal = parseNumberSafe(rawExtracted?.totalAmount?.value ?? rawExtracted?.totalAmount ?? 0);
    const extractedItemsCount = Array.isArray(rawExtracted?.items) ? rawExtracted.items.length : 0;

    // Smart Escalation to gemini-4-argon if Flash struggled (missing items or totalAmount on a full scan)
    if ((extractedItemsCount === 0 || extractedTotal <= 0) && !usedModel.includes('argon')) {
      console.log(`[Gemini AI OCR] Zorlu fatura/tablo tespit edildi (kalem: ${extractedItemsCount}, tutar: ${extractedTotal}), gemini-4-argon devreye alınıyor...`);
      retryCount++;
      try {
        const argonRes = await generateContentWithResilience(ai, {
          contents,
          config: { responseMimeType: "application/json" },
          primaryModel: 'gemini-4-argon'
        });
        const argonParsed = robustParseJSON(argonRes.text || '{}');
        const argonItems = Array.isArray(argonParsed?.items) ? argonParsed.items.length : 0;
        const argonTotal = parseNumberSafe(argonParsed?.totalAmount?.value ?? argonParsed?.totalAmount ?? 0);
        if (argonItems > extractedItemsCount || (extractedTotal <= 0 && argonTotal > 0)) {
          rawExtracted = argonParsed;
          usedModel = argonRes.usedModel;
        }
      } catch (argonErr: any) {
        console.warn('[Gemini AI OCR] Argon ek analizi tamamlanamadı, mevcut veri korunuyor:', argonErr?.message);
      }
    }
  } catch (err: any) {
    retryCount++;
    console.warn('[AI Full OCR] AI servisleri yanıt veremedi, yerel akıllı ayrıştırıcı devreye alınıyor:', err?.message);
    rawExtracted = fallbackExtractInvoiceFromTextOrCsv(
      [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
      params.fileName,
      false
    );
    usedModel = 'local-resilient-parser';
  }

  // Local Resilient Supplement if AI returned empty object or missed items/totals when text/CSV is available
  const localFallback = fallbackExtractInvoiceFromTextOrCsv(
    [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
    params.fileName,
    false
  );

  if (!rawExtracted || typeof rawExtracted !== 'object') {
    rawExtracted = localFallback;
    usedModel = 'local-resilient-parser';
  } else {
    if ((!Array.isArray(rawExtracted.items) || rawExtracted.items.length === 0) && localFallback.items.length > 0) {
      rawExtracted.items = localFallback.items;
    }
    if (parseNumberSafe(rawExtracted.totalAmount?.value ?? rawExtracted.totalAmount ?? 0) <= 0 && localFallback.totalAmount.value > 0) {
      rawExtracted.totalAmount = localFallback.totalAmount;
    }
  }

  standardized = rawExtracted;
  if (!Array.isArray(standardized.items)) {
    standardized.items = [];
  }

  // Robust Supplier resolution with text/csv/filename heuristics fallback
  const resolvedSupplier = 
    extractSupplierName(standardized.supplier) ||
    extractSupplierName(rawExtracted.supplier) ||
    extractSupplierName(standardized.vendorName) ||
    extractSupplierName(rawExtracted.vendorName) ||
    extractSupplierName(standardized.company) ||
    extractSupplierName(rawExtracted.company) ||
    extractSupplierName(standardized.seller) ||
    extractSupplierName(rawExtracted.seller) ||
    extractSupplierName(localFallback.supplier) ||
    'Tedarikçi Firma';

  const resolvedDateStr = extractStringSafe(standardized.date) || extractStringSafe(rawExtracted.date) || extractStringSafe(localFallback.date, new Date().toISOString().split('T')[0]);
  const defaultVatPct = resolvedDateStr.startsWith('2025') ? 20 : 22;
  let excludedFreightNetSum = 0;
  let excludedFreightGrossSum = 0;

  const mappedItems = (standardized.items || [])
    .map((it: any) => {
      let rawName = it.materialName || it.originalName || 'Malzeme Kalemi';
      let origName = it.originalName || it.materialName || '';
      if (/[А-Яа-яЁё]/.test(rawName)) {
        rawName = translateRussianMaterialToTurkish(rawName) || rawName;
      }
      let cat = normalizeCategoryName(it.category, `${rawName} ${origName}`);
      const combined = `${rawName} ${origName}`.toLowerCase();

      // Enforce safety cap / mushroom protection
      if (
        combined.includes('колпачок') ||
        combined.includes('грибок') ||
        combined.includes('güvenlik mantar') ||
        combined.includes('koruyucu başlık') ||
        combined.includes('güvenlik başlığı')
      ) {
        const isPack1000 = combined.includes('1000') || combined.includes('упаковк');
        const packSuffix = isPack1000 ? ' (1000 Adetlik Paket)' : '';
        let diaRange = '10-18 mm';
        const mRange = combined.match(/(\d+[\s-–]+\d+)\s*(?:мм|mm)?/);
        if (mRange) diaRange = `${mRange[1].replace(/\s+/g, '')} mm`;
        rawName = `İnşaat Demiri Güvenlik Başlığı Mantar Tip ${diaRange}${packSuffix}`;
        cat = 'Sarf Malzeme & Hırdavat';
      }

      const qty = parseNumberSafe(it.quantity) || 1;
      const vatPct = it.vatPercentage !== undefined && it.vatPercentage !== null ? parseNumberSafe(it.vatPercentage) : defaultVatPct;
      let uPriceNet = parseNumberSafe(it.unitPriceNet ?? it.unitPrice) || 0;
      let uPriceGross = parseNumberSafe(it.grossUnitPrice) || 0;
      let tPriceNet = parseNumberSafe(it.totalPrice) || Number((qty * uPriceNet).toFixed(2));
      let tPriceGross = parseNumberSafe(it.grossTotalPrice) || 0;

      if (uPriceNet <= 0 && qty > 0 && tPriceNet > 0) {
        uPriceNet = Number((tPriceNet / qty).toFixed(2));
      }
      if (uPriceGross <= 0 && uPriceNet > 0) {
        uPriceGross = vatPct > 0 ? Number((uPriceNet * (1 + vatPct / 100)).toFixed(2)) : uPriceNet;
      }
      if (tPriceGross <= 0) {
        tPriceGross = Number((qty * uPriceGross).toFixed(2));
      }

      return {
        materialName: rawName,
        originalName: origName,
        category: normalizeCategoryName(cat, `${rawName} ${origName}`),
        quantity: qty,
        unit: it.unit || 'Adet',
        unitPrice: uPriceNet,
        unitPriceNet: uPriceNet,
        grossUnitPrice: uPriceGross,
        totalPrice: tPriceNet,
        grossTotalPrice: tPriceGross,
        vatPercentage: vatPct,
        isNetNormalized: true,
        discountAmount: parseNumberSafe(it.discountAmount) || 0,
        brand: it.brand || '',
        model: it.model || '',
        productCode: it.productCode || it.artikul || '',
        diameter: it.diameter || '',
        dimensions: it.dimensions || '',
        quality: it.quality || '',
        color: it.color || '',
        confidence: typeof it.confidence === 'number' ? it.confidence : 0.95
      };
    })
    .filter((it: any) => {
      const m = `${it.materialName || ''} ${it.originalName || ''}`.toLowerCase();
      const isFreightOrService =
        (/доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|\bnakliye\b|teslimat\s*hizmet|kargo/i.test(m) &&
         !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер/i.test(m));
      if (isFreightOrService) {
        excludedFreightNetSum += Number(it.totalPrice) || 0;
        excludedFreightGrossSum += Number(it.grossTotalPrice) || Number(it.totalPrice) || 0;
        return false;
      }
      return true;
    });

  const computedItemsSum = mappedItems.reduce((acc: number, item: any) => acc + (Number(item.grossTotalPrice || item.totalPrice) || 0), 0);
  const rawTotalAmount = parseNumberSafe(standardized.totalAmount?.value ?? standardized.totalAmount ?? rawExtracted.totalAmount?.value ?? 0);
  const finalTotalAmount = rawTotalAmount > 0 ? rawTotalAmount : computedItemsSum;

  const finalExtracted: any = {
    documentType: standardized.documentType || rawExtracted.documentType || 'invoice',
    supplier: resolvedSupplier,
    vendorName: resolvedSupplier,
    company: resolvedSupplier,
    seller: resolvedSupplier,
    taxId: extractStringSafe(standardized.taxId) || extractStringSafe(rawExtracted.taxId),
    invoiceNumber: extractStringSafe(standardized.invoiceNumber) || extractStringSafe(rawExtracted.invoiceNumber) || extractStringSafe(localFallback.invoiceNumber),
    date: resolvedDateStr,
    currency: extractStringSafe(standardized.currency) || extractStringSafe(rawExtracted.currency, 'RUB'),
    subtotal: parseNumberSafe(standardized.subtotal?.value ?? standardized.subtotal ?? rawExtracted.subtotal?.value ?? finalTotalAmount),
    discount: parseNumberSafe(standardized.discount?.value ?? standardized.discount ?? rawExtracted.discount?.value ?? 0),
    tax: parseNumberSafe(standardized.tax?.value ?? standardized.tax ?? rawExtracted.tax?.value ?? 0),
    totalAmount: finalTotalAmount,
    ...(excludedFreightNetSum > 0 ? {
      excludedFreightAmount: Number(excludedFreightNetSum.toFixed(2)),
      excludedFreightGrossAmount: Number(excludedFreightGrossSum.toFixed(2))
    } : {}),
    scopeDeductionAmount: parseNumberSafe(standardized.scopeDeductionAmount?.value ?? standardized.scopeDeductionAmount ?? rawExtracted.scopeDeductionAmount?.value ?? rawExtracted.scopeDeductionAmount ?? 0),
    scopeDeductionReason: standardized.scopeDeductionReason?.value ?? standardized.scopeDeductionReason ?? rawExtracted.scopeDeductionReason?.value ?? rawExtracted.scopeDeductionReason ?? '',
    items: mappedItems,
    overallConfidence: parseNumberSafe(standardized.overallConfidence ?? rawExtracted.overallConfidence ?? 0.95),
    rawConfidenceScores: {
      supplier: standardized.supplier?.confidence ?? 0.95,
      invoiceNumber: standardized.invoiceNumber?.confidence ?? 0.95,
      date: standardized.date?.confidence ?? 0.95,
      totalAmount: standardized.totalAmount?.confidence ?? 0.95
    },
    rawWarnings: Array.isArray(standardized.rawWarnings) ? standardized.rawWarnings : []
  };

  // Perform Mathematical & Semantic Validation
  const validation = validateInvoiceData(finalExtracted);

  // Perform Duplicate Invoice Detection
  const duplicateInfo = checkDuplicateInvoice({
    supplier: finalExtracted.supplier,
    invoiceNumber: finalExtracted.invoiceNumber,
    date: finalExtracted.date,
    totalAmount: finalExtracted.totalAmount,
    fileHash,
    fileSizeBytes
  }, params.existingInvoices || []);

  if (duplicateInfo.isDuplicate) {
    validation.checks.duplicateCheck = 'warning';
    validation.warnings.push(duplicateInfo.message || 'Mükerrer (duplicate) fatura şüphesi tespit edildi!');
  }

  return {
    success: true,
    extracted: finalExtracted,
    validation,
    duplicateInfo,
    usedModel,
    retryCount,
    stagesCompleted: 1
  };
}
