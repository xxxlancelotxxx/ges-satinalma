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
import {
  normalizeVendorName,
  isBuyerOrganization,
  isValidInvoiceNumber,
  extractVendorInn,
  isInvoiceHeaderOrAddressGarbage
} from '../src/utils/vendorNormalizer';
import { parseInvoiceText, verifyParsedInvoice, extractDocumentHeaderDate, mapDocumentUnit } from '../src/utils/invoiceLineParser';

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
    - unitPrice: Birim fiyat (KESİNLİKLE BELGEDE / TABLODA YAZAN BİREBİR KDV / НДС DAHİL GERÇEK BİRİM FİYAT - Цена / Цена с НДС. Tablodaki 'Цена' sütununda yazan rakamı BİREBİR yaz, ASLA kendi başına 1,20 veya 1,22'ye bölerek KDV düşme! Eğer tabloda hem KDV hariç hem KDV dahil sütun varsa, KDV dahil satır toplamının miktara bölünmesiyle bulunan KDV dahil birim fiyatı [grossTotalPrice / quantity] yaz!)
    - unitPriceNet: Varsa KDV / НДС Hariç net birim fiyat (Цена без НДС)
    - grossUnitPrice: KDV / НДС Dahil birim fiyat (Цена с НДС - unitPrice ile birebir aynı olmalıdır)
    - vatPercentage: Kalemin gerçek KDV / НДС oranı (örn: 22, 20, 10, 0). Eğer faturada oran açıkça yazmıyor ama en altta 'В том числе НДС: 17 506,41' ve 'Итого: 97 081,00' yazıyorsa, tax / (totalAmount - tax) oranından gerçek oranı (örn: %22) hesapla.
    - totalPrice: Satır KDV / НДС Dahil toplam tutarı (Сумма / Итоговая сумма / Сумма с НДС - quantity × unitPrice değerine eşit olmalı ve tüm satırların totalPrice toplamı faturanın en altındaki totalAmount ile birebir örtüşmelidir!)
    - grossTotalPrice: Satır KDV Dahil toplam tutarı (Сумма с НДС - totalPrice ile birebir aynı olmalıdır)
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
- DEMİR EL ALETLERİ & MAKİNELER: "крючок", "пистолет", "ножницы", "станок", "kesme makası", "bükme aparatı", "зубило", "keski", "углошлифовальная", "отбойный молоток" -> "El Aletleri & Hırdavat".
- KALIP/DONATI YAĞI & KATKILAR: "смазка для форм", "эмульсол", "добавка для бетона", "клей для плитки", "затирка" -> "Kimyasallar & Boya".
- SADECE YAPISAL DONATI (пруток, арматура а500с, nervürlü demir, filmaşin, çelik hasır) "İnşaat Demiri" kategorisindedir.
- DİĞER: "труба для кабеля / kablo borusu" -> Elektrik & Otomasyon. "изоляция для труб" -> Yalıtım & Alçıpan. "хомут для труб" -> Sarf Malzeme & Hırdavat. "саморез для гипсокартона" -> Sarf Malzeme & Hırdavat. "профиль для гкл" -> Yalıtım & Alçıpan. "крестики для плитки" -> Sarf Malzeme & Hırdavat. "растворитель / tiner" -> Kimyasallar & Boya. "валик / rulo", "кисть / fırça" -> Sarf Malzeme & Hırdavat.

${firstOfferText ? `\n--- İLK TEKLİF BELGESİ METİN/TABLO VERİSİ ---\n${firstOfferText}\n----------------------------------------------\n` : ''}
${pdfText ? `\n--- DİJİTAL BELGE METİN KATMANI ---\n${pdfText}\n-----------------------------------\n` : ''}
${excelCsv ? `\n--- EXCEL/CSV VERİSİ ---\n${excelCsv}\n------------------------\n` : ''}
${additionalPrompt ? `\nEk Kullanıcı Notu: ${additionalPrompt}\n` : ''}

ÖNEMLİ KURALLAR:
- ASLA uydurma değer üretme. Okunamayan alanları JSON'a ekleme.
- Metin değerlerinin içinde çift tırnak (") kullanma, şirket ünvanlarında tırnak gerekiyorsa « » veya tek tırnak kullan (Örn: ООО «ТСК Дипломат»).
- HIZ VE TOKEN TASARRUFU KURALI: 'items' dizisindeki her bir kalem için SADECE değeri olan alanları üret. Eğer bir alan (örn: brand, model, productCode, diameter, dimensions, quality, color vb.) belgede yoksa veya boşsa, o alanı JSON'a ASLA ekleme!
- BİREBİR FATURA FİYATI (KDV DAHİL) & MATEMATİKSEL SAĞLAMA KURALI: "items" listesindeki her malzemenin "unitPrice" ve "totalPrice" değerleri KESİNLİKLE faturada ödenecek KDV / НДС DAHİL gerçek tablo fiyatları olmalıdır (quantity × unitPrice = totalPrice ve Σ totalPrice = totalAmount). Örneğin tabloda Цена = 13 921,00 ve Сумма = 41 763,00 yazıyorsa unitPrice: 13921 ve totalPrice: 41763 yazılmalıdır; fiyatları ASLA 1,20 veya 1,22'ye bölerek KDV düşme! Ayrıca faturadaki Nakliye / Hizmet (Доставка, Транспортные услуги, Автоуслуги, Манипулятор, Погрузка/разгрузка, Резка, Nakliye) satırları malzeme listesine ('items') ASLA eklenmemelidir!
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
      "category": "İnşaat Demiri",
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
    if (!trimmed || INVALID_SUPPLIER_NAMES.has(trimmed.toLowerCase())) {
      return '';
    }
    if (isBuyerOrganization(trimmed)) {
      return '';
    }
    const normalized = normalizeVendorName(trimmed);
    if (normalized && !INVALID_SUPPLIER_NAMES.has(normalized.toLowerCase()) && !isBuyerOrganization(normalized)) {
      return normalized;
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

const BANK_NAME_PATTERN = /(?:сбербанк|тбанк|т-банк|тинькофф|альфа-банк|втб|газпромбанк|райффайзен|совкомбанк|россельхозбанк|открытие|промсвязьбанк|зираат\s*банк|банк\s*["«]?санкт-петербург|уралсиб|ак\s*барс|мкб)/i;

// Regex and heuristic text extraction from raw document text / CSV / filename
export function fallbackExtractSupplierFromText(textContext?: string, fileName?: string): string {
  if (!textContext && !fileName) return '';

  const fullText = (textContext || '') + '\n' + (fileName || '');
  if (!fullText.trim()) return '';

  // 1. Regex for Russian invoice seller labels (Check all occurrences in case one is buyer due to PDF layout order)
  const postRegex = /(?:Поставщик\s*(?:\(исполнитель\))?|Продавец\s*(?:\(исполнитель\))?|Грузоотправитель|Организация)\s*[:：\t,-]\s*([^\r\n;]+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = postRegex.exec(fullText)) !== null) {
    const seg = pm[1].trim();
    if (isBuyerOrganization(seg) || BANK_NAME_PATTERN.test(seg)) continue;
    const candidate = extractSupplierName(seg);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 2. Regex for Turkish seller labels
  const satMatch = fullText.match(/(?:Satıcı|Tedarikçi|Firma Ünvanı|Düzenleyen)\s*[:：\t]\s*([^\r\n,;]+)/i);
  if (satMatch && satMatch[1]) {
    const candidate = extractSupplierName(satMatch[1]);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 3. Scan all corporate entities with quotes or full legal forms in document, skipping Buyer (ГЭС КОНСТРАКШН) and Banks
  const corpRegex = /(?:Общество\s+с\s+ограниченной\s+ответственностью|Акционерное\s+общество|Закрытое\s+акционерное\s+общество|Публичное\s+акционерное\s+общество|ООО|OОО|АО|AO|ПАО|ЗАО|НАО)\s*(?:ТД\s+|ТК\s+|ГК\s+)?["«“]([^"»”\r\n]{2,70})["»”]|(?:ООО|OОО|АО|ПАО|ЗАО|НАО)\s+([А-Яа-яЁёA-Za-z0-9.\-_ ]{3,45})|ИП\s+([А-Яа-яЁёA-Za-z\-_]+(?:\s+[А-Яа-яЁёA-Za-z.\-_]+){1,2})/gi;
  let cm: RegExpExecArray | null;
  while ((cm = corpRegex.exec(fullText)) !== null) {
    const rawMatch = cm[0];
    if (isBuyerOrganization(rawMatch) || BANK_NAME_PATTERN.test(rawMatch)) continue;
    const candidate = extractSupplierName(rawMatch);
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
    if (/vseinstrumenti|всеинструменты/i.test(cleanFn)) return 'ООО "ВсеИнструменты.ру"';
    if (/diplomat|дипломат/i.test(cleanFn)) return 'ООО "ТСК ДИПЛОМАТ"';
    if (/diler|дилер/i.test(cleanFn)) return 'Diler Demir Çelik A.Ş.';
    if (/kardemir/i.test(cleanFn)) return 'Kardemir Demir Çelik A.Ş.';
    if (/cimsa|çimsa|чимса/i.test(cleanFn)) return 'Çimsa Çimento Sanayi A.Ş.';
    if (/akcansa|akçansa/i.test(cleanFn)) return 'Akçansa Çimento Sanayi A.Ş.';
    if (/stroysnab|стройснаб/i.test(cleanFn)) return 'ООО "СтройСнаб"';
    if (/metallservice|металлсервис|металл-сервис/i.test(cleanFn)) return 'ООО "МЕТАЛЛ-СЕРВИС"';
    if (/stroykomplekt|стройкомплект/i.test(cleanFn)) return 'ООО "СтройКомплект"';
    if (cleanFn.length >= 3 && !/^(fatura|teklif|belge|invoice|scan|image|img|doc|document|pdf|[\d\s]+)$/i.test(cleanFn)) {
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

export function normalizeExtractedUnit(rawUnit?: string): string {
  const u = (rawUnit || '').trim().toLowerCase().replace(/\.$/, '');
  if (!u || u === 'шт' || u === 'штук' || u === 'штука' || u === 'ед' || u === 'ед.изм' || u === 'ед. изм' || u === 'adet' || u === 'ad' || u === 'pcs') return 'Adet';
  if (u === 'компл' || u === 'комплект' || u === 'set' || u === 'takım') return 'Set';
  if (u === 'упак' || u === 'уп' || u === 'пачк' || u === 'пачка' || u === 'paket' || u === 'pk') return 'Paket';
  if (u === 'т' || u === 'тн' || u.startsWith('тонн') || u === 'ton') return 'Ton';
  if (u === 'кг' || u === 'kg') return 'kg';
  if (u === 'м3' || u === 'м³' || u.includes('куб') || u === 'm3' || u === 'm³') return 'm³';
  if (u === 'м2' || u === 'м²' || u.includes('кв') || u === 'm2' || u === 'm²') return 'm²';
  if (u === 'м' || u === 'п.м' || u === 'п. м' || u === 'пог. м' || u === 'пог.м' || u === 'm' || u === 'mt' || u === 'mtül') return 'm';
  if (u === 'л' || u.startsWith('литр') || u === 'lt' || u === 'litre') return 'Litre';
  if (u === 'рул' || u === 'рулон' || u === 'rulo') return 'Rulo';
  if (u === 'меш' || u === 'мешок' || u === 'torba') return 'Torba';
  if (u === 'пар' || u === 'пара' || u === 'пары' || u === 'çift') return 'Çift';
  if (u === 'маш' || u === 'машина' || u.startsWith('рейс')) return 'Sefer';
  return rawUnit || 'Adet';
}

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
 * Deterministically parses Russian & Turkish PDF digital invoice table rows (Счет на оплату, ВсеИнструменты.ру, 1С, УПД, КОМУС, Строительный двор, ПСК).
 * Extracts exact quantities, units, VAT-inclusive unit prices, and row totals.
 */
export function extractDeterministicPdfTableRows(fullText: string, explicitTotal: number = 0): any[] {
  if (!fullText || !fullText.trim()) return [];

  const UNIT_PAT = `(?:шт\\.?|штук[аи]?|компл\\.?|комплект|упак\\.?|уп\\.?|п\\.?\\s*м\\.?|пог\\.?\\s*м\\.?|м2|м²|кв\\.?\\s*м\\.?|м3|м³|куб\\.?\\s*м\\.?|м\\.?|тн|тонн[аы]?|т\\.?|кг\\.?|гр\\.?|л\\.?|литр[а-я]*|рул\\.?|рулон|меш\\.?|лист[а-я]*|пачк[а-я]*|пар[аы]?|бухт[а-я]*|бочк[а-я]*|канистр[а-я]*|ед\\.?|маш\\.?|рейс[а-я]*|adet|ad\\.?|ton|kg|m3|m2|mtül|mt|m|lt|paket|pk|torba|koli|rulo|takım|set|çift)`;
  const QTY_PAT = `(?:\\d+(?:[\\s\\u00A0]\\d{3})*(?:[.,]\\d+)?)`;
  const PRICES_BLOCK_PAT = `((?:(?:\\d{1,3}(?:[\\s\\u00A0.]\\d{3})*[.,]\\d{2}|\\d+[.,]\\d{2}|\\d{1,2}\\s*%|Без\\s*НДС|без\\s*ндс|-)[\\s\\t]*){2,8})`;

  // Order A/B: <prefix> <qty> <unit> [optional integer weight like 0] <prices + optional % НДС>
  const rowTailQtyFirstRx = new RegExp(
    `^(.*?)[\\s\\t]+(${QTY_PAT})[\\s\\t]+(${UNIT_PAT})(?:[\\s\\t]+\\d{1,5})?[\\s\\t]+${PRICES_BLOCK_PAT}$`,
    'i'
  );
  // Order C (КОМУС, ПРОМСТРОЙКОНТРАКТ): <prefix> <unit> <qty> <prices + optional % НДС>
  const rowTailUnitFirstRx = new RegExp(
    `^(.*?)[\\s\\t]+(${UNIT_PAT})[\\s\\t]+(${QTY_PAT})[\\s\\t]+${PRICES_BLOCK_PAT}$`,
    'i'
  );
  // Standalone price-tail line (e.g. "3 рул 5 274,59 6 435,00...", "1 шт. 76 998,00 76 998,00", "2 пар 4 615,00 9 230,00")
  const standalonePriceTailRx = new RegExp(
    `^(?:${QTY_PAT}[\\s\\t]+${UNIT_PAT}|${UNIT_PAT}[\\s\\t]+${QTY_PAT})(?:[\\s\\t]+\\d{1,5})?[\\s\\t]+${PRICES_BLOCK_PAT}$`,
    'i'
  );

  const matchRowTail = (str: string): { prefix: string; qty: number; rawUnit: string; pricesBlock: string } | null => {
    const m1 = str.match(rowTailQtyFirstRx);
    if (m1) {
      const q = parseNumberSafe(m1[2]);
      if (q > 0 && q < 1000000) {
        return { prefix: m1[1].trim(), qty: q, rawUnit: m1[3].trim(), pricesBlock: m1[4].trim() };
      }
    }
    const m2 = str.match(rowTailUnitFirstRx);
    if (m2) {
      const q = parseNumberSafe(m2[3]);
      if (q > 0 && q < 1000000) {
        return { prefix: m2[1].trim(), qty: q, rawUnit: m2[2].trim(), pricesBlock: m2[4].trim() };
      }
    }
    return null;
  };

  const parseRegion = (regionText: string): any[] => {
    const rawLines = regionText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const headerSkipRx = /^(?:№|Код|Артикул|Товары\s*\((?:работы|услуги)|Предмет\s+счета|Наименование|Кол-во|Количество|Ед\.|Цена|Сумма|Итоговая|Ставка\s*НДС|Страна\s+происхождения|поставки|Sıra\s*No|Malzeme\s*Adı|Доставка\s+до\s*:|--\s*\d+\s+of\s+\d+\s*--|Страница\s+\d+\s+из\s+\d+)(?:\s|$)/i;
    const summarySkipRx = /^(?:итого|всего|в\s*т\.?\s*ч\.?\s*ндс|в\s+том\s+числе\s+ндс|сумма\s+ндс|ндс|без\s*ндс|общий\s+вес|счет\s+содержит|к\s+оплате|toplam|genel\s*toplam|ara\s*toplam|kdv)/i;
    const legalClauseRx = /^\d{1,2}\.\s*(?:Настоящий|Данный|Оплата|Условия|Срок|Датой|Цены|В\s+случае|Для\s+получения|Факт|Поставщик|Покупатель|Товар|Передача|К\s+отношениям|При\s+безналичной|При\s+получении)/i;

    const logicalRows: string[] = [];
    let currentBuffer = '';
    let hasStartedTableRows = false;

    for (const line of rawLines) {
      if (line.startsWith('---') || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;
      if (headerSkipRx.test(line) && !matchRowTail(line)) continue;
      if (legalClauseRx.test(line)) continue;
      if (summarySkipRx.test(line)) {
        if (currentBuffer && matchRowTail(currentBuffer)) {
          logicalRows.push(currentBuffer);
          currentBuffer = '';
        }
        continue;
      }

      const isPriceTailOnly = standalonePriceTailRx.test(line);
      const isRowStartLine =
        !isPriceTailOnly &&
        !legalClauseRx.test(line) &&
        (/^\d{1,3}(?:[\s\t.]+\d{4,16})?$/.test(line) ||
         /^\d{1,3}(?:[\s\t.]+[A-Za-zА-Яа-я0-9\-_/]{4,20})?[\s\t]*[A-Za-zА-Яа-яЁёÇĞİÖŞÜçğıöşü]/.test(line) ||
         /^\d{4,10}[\s\t]+[A-Za-zА-Яа-яЁё]/.test(line));

      // Reset buffer only before the first row has started, or if pre-table garbage accumulated (>250 chars) before a row start
      if (isRowStartLine && (!hasStartedTableRows || currentBuffer.length > 250)) {
        hasStartedTableRows = true;
        currentBuffer = line;
      } else {
        if (isRowStartLine) hasStartedTableRows = true;
        currentBuffer = currentBuffer ? `${currentBuffer} ${line}` : line;
      }

      if (matchRowTail(currentBuffer)) {
        logicalRows.push(currentBuffer);
        currentBuffer = '';
      }
    }
    if (currentBuffer && matchRowTail(currentBuffer)) {
      logicalRows.push(currentBuffer);
    }

    const parsedItems: any[] = [];
    for (const rowStr of logicalRows) {
      const m = matchRowTail(rowStr);
      if (!m) continue;

      let prefix = m.prefix;
      const qty = m.qty;
      const rawUnit = m.rawUnit;
      const pricesBlock = m.pricesBlock;

      if (qty <= 0) continue;

      // Extract leading row index and optional product code / article / barcode
      let rowNo: number | undefined = undefined;
      let productCode = '';
      const idxMatch = prefix.match(/^(\d{1,3})(?:[.\s\t]+|(?=[А-Яа-яЁёA-Za-z]))(.*)$/);
      if (idxMatch) {
        rowNo = Number(idxMatch[1]);
        prefix = idxMatch[2].trim();
      }
      const codeMatch = prefix.match(/^([A-Za-z0-9\-_.]{4,18})[\s\t]+(.*)$/);
      if (codeMatch && /\d/.test(codeMatch[1]) && /[A-Za-zА-Яа-яЁёÇĞİÖŞÜçğıöşü]/.test(codeMatch[2])) {
        productCode = codeMatch[1].trim();
        prefix = codeMatch[2].trim();
      }

      // Clean ВсеИнструменты.ру availability/delivery-time columns from the end of item name
      prefix = prefix
        .replace(/[\s\t]*(?:в\s+наличии|под\s+заказ)(?:[\s\t]+(?:от\s+\d+\s+до\s+\d+|\d+)[\s\t]*раб\.?\s*дн\.?)?$/i, '')
        .trim();

      if (!prefix || prefix.length < 2 || summarySkipRx.test(prefix)) continue;

      // Remove percentage tokens (e.g. "22%", "20%") before extracting currency amounts
      const cleanPricesBlock = pricesBlock.replace(/\b\d{1,2}\s*%/g, ' ');
      const priceTokens = cleanPricesBlock.match(/\d{1,3}(?:[\s\u00A0]\d{3})*[.,]\d{2}|\d+[.,]\d{2}/g) || [];
      const prices = priceTokens.map(p => parseNumberSafe(p)).filter(n => n > 0 && n < 1e11);
      if (prices.length === 0) continue;

      // The last currency column on Russian/Turkish invoices is always the row's final payable total with VAT (Сумма / Сумма с НДС)
      const totalPrice = prices[prices.length - 1];
      let unitPrice = prices[0];
      let unitPriceNet: number | undefined = undefined;
      let discountAmount = 0;

      // Priority 1: Find any unit price column (such as Цена с НДС in Поинтер) where qty * col === totalPrice
      const priorCols = prices.slice(0, -1);
      const exactGrossUnitCol = priorCols.find(p => Math.abs(qty * p - totalPrice) <= Math.max(0.5, qty * 0.02));
      if (exactGrossUnitCol !== undefined) {
        unitPrice = exactGrossUnitCol;
        if (prices[0] < unitPrice && Math.abs(unitPrice / prices[0] - 1.22) <= 0.03) {
          unitPriceNet = prices[0];
        } else if (prices[0] < unitPrice && Math.abs(unitPrice / prices[0] - 1.20) <= 0.03) {
          unitPriceNet = prices[0];
        }
      } else if (prices.length >= 3 && Math.abs(qty * prices[0] - prices[1]) <= 1.5) {
        if (prices[1] > totalPrice) {
          // Discount table: Цена (gross) | Сумма без скидки | Скидка | Итоговая сумма
          unitPrice = prices[0];
          discountAmount = Number((prices[1] - totalPrice).toFixed(2));
        } else {
          // Net + VAT table (e.g. КОМУС): Цена без НДС | Сумма без НДС | Сумма НДС | Сумма с НДС
          unitPriceNet = prices[0];
          unitPrice = Number((totalPrice / qty).toFixed(2));
        }
      } else {
        unitPrice = Number((totalPrice / qty).toFixed(2));
      }

      if (isInvoiceHeaderOrAddressGarbage(prefix, qty, unitPrice, totalPrice)) {
        continue;
      }

      const unit = normalizeExtractedUnit(rawUnit);
      const trName = translateRussianMaterialToTurkish(prefix) || prefix;
      const cat = normalizeCategoryName('', `${trName} ${prefix}`);

      parsedItems.push({
        invoiceLineNo: rowNo,
        productCode,
        materialName: trName,
        originalName: prefix,
        category: cat,
        quantity: qty,
        unit,
        unitPrice,
        ...(unitPriceNet !== undefined ? { unitPriceNet } : {}),
        grossUnitPrice: unitPrice,
        discountAmount,
        totalPrice,
        grossTotalPrice: totalPrice,
        lineSource: 'invoice_pdf',
        confidence: 0.99
      });
    }

    // If PDF text layer was extracted bottom-to-top (e.g. ТруботоргРус where row 6 appears before row 1), sort ascending by invoiceLineNo
    if (
      parsedItems.length >= 2 &&
      parsedItems.every(it => typeof it.invoiceLineNo === 'number') &&
      parsedItems[0].invoiceLineNo > parsedItems[parsedItems.length - 1].invoiceLineNo
    ) {
      parsedItems.sort((a, b) => (a.invoiceLineNo || 0) - (b.invoiceLineNo || 0));
    }

    // If the PDF table lists net prices without VAT and VAT (20% or 22%) is added in the summary footer (e.g. ГК АТМОС),
    // scale unitPrice and totalPrice to VAT-inclusive gross while preserving unitPriceNet.
    if (parsedItems.length > 0 && explicitTotal > 0) {
      const rawSum = parsedItems.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0);
      if (rawSum > 0) {
        const ratio = explicitTotal / rawSum;
        if (Math.abs(ratio - 1.22) <= 0.015 || Math.abs(ratio - 1.20) <= 0.015) {
          for (const it of parsedItems) {
            it.unitPriceNet = it.unitPrice;
            it.netTotalPrice = it.totalPrice;
            it.totalPrice = Number((it.totalPrice * ratio).toFixed(2));
            it.grossTotalPrice = it.totalPrice;
            it.unitPrice = Number((it.totalPrice / (it.quantity || 1)).toFixed(2));
            it.grossUnitPrice = it.unitPrice;
          }
        }
      }
    }

    return parsedItems;
  };

  // First try narrowed table region between table header and footer
  let tableRegion = fullText;
  const headerMatch = tableRegion.match(/(?:Товары\s*\((?:работы,\s*услуги|услуги,\s*работы)\)|Предмет\s+счета|Наименование\s+товара|№\s+Товар\s+Кол|Сумма\s+без\s+скидки|Итоговая\s+сумма|Malzeme\s+Adı)/i);
  if (headerMatch && headerMatch.index !== undefined) {
    tableRegion = tableRegion.slice(headerMatch.index);
  }
  const footerMatch = tableRegion.match(/\n\s*(?:Итого\s*:|Всего\s+наименований|Всего\s+к\s+оплате|Счет\s+содержит\s*:|Руководитель\s+организации|Уполномоченный\s+по\s+доверенности)/i);
  if (footerMatch && footerMatch.index !== undefined && footerMatch.index > 20) {
    tableRegion = tableRegion.slice(0, footerMatch.index);
  }

  const regionItems = parseRegion(tableRegion);
  if (regionItems.length > 0) {
    return regionItems;
  }

  // Fallback for bottom-to-top PDF layouts (e.g. ТруботоргРус) where table header is printed below the rows
  return parseRegion(fullText);
}

/**
 * Local Resilient Parser: Extracts supplier, invoiceNumber, date, currency, totalAmount, tax, and line items
 * from PDF digital text or Excel/CSV content whenever AI models are unavailable or for deterministic table cross-checking.
 */
export function fallbackExtractInvoiceFromTextOrCsv(
  textOrCsv?: string,
  fileName?: string,
  isSummaryOnly?: boolean
): any {
  const fullText = (textOrCsv || '').trim();
  const supplier = fallbackExtractSupplierFromText(fullText, fileName) || 'Tedarikçi Firma';

  // 1. Extract Invoice / Offer Number (Strictly validated: must contain a digit and not be a bank account or header word)
  let invoiceNumber = '';
  const invPatterns = [
    /(?:^|[^А-Яа-яЁёA-Za-z])(?:Счет(?:\s+на\s+оплату|\s*-\s*договор|\s*-\s*оферта)?|Счёт(?:\s+на\s+оплату|\s*-\s*договор|\s*-\s*оферта)?|счету|сч\.|УПД|Спецификация|Соглашение(?:\s+на\s+поставку[^\r\n№N#]{0,40})?)\s*(?:№|N|#)\s*([A-Za-zА-Яа-яЁё0-9.\-_/]+(?:\s*-\s*[A-Za-zА-Яа-яЁё0-9.\-_/]+)?)\s+от(?=[\s\d«"]|$)/gi,
    /(?:^|[^А-Яа-яЁёA-Za-z])(?:Счет(?:\s+на\s+оплату|\s*-\s*договор|\s*-\s*оферта)?|Счёт(?:\s+на\s+оплату|\s*-\s*договор|\s*-\s*оферта)?|УПД|Fatura\s*No|Teklif\s*No|Belge\s*No|Invoice\s*(?:No|#)?)\s*(?:№|N|#|:)\s*([A-Za-zА-Яа-яЁё0-9.\-_/]{1,30})/gi,
    /(?:заказу\s+клиента|по\s+сч\.|по\s+счету)\s*(?:№|N|#)?\s*([A-Za-zА-Яа-яЁё0-9.\-_/]{2,25})/gi,
    /(?:№|N)\s*([A-Za-zА-Яа-яЁё0-9.\-_/]{1,25})\s+от\s+[\d«"]/gi
  ];

  for (const pat of invPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(fullText)) !== null) {
      const candidate = (m[1] || '').replace(/\s+/g, '').trim();
      if (isValidInvoiceNumber(candidate)) {
        invoiceNumber = candidate;
        break;
      }
    }
    if (invoiceNumber) break;
  }

  if (!invoiceNumber && fileName) {
    const fnMatches = [
      fileName.match(/(\d{4}-\d{5,8}-\d{4,8})/),
      fileName.match(/(?:Счет|Счёт|№|No|FT|TKF|INV)[_\-\s]*([A-Za-zА-Яа-я0-9\-]{2,20})/i),
      fileName.match(/^(STF\.\d{4,8}(?:-\d+)?)/i)
    ];
    for (const fm of fnMatches) {
      const cand = (fm?.[1] || '').trim();
      if (cand && isValidInvoiceNumber(cand)) {
        invoiceNumber = cand;
        break;
      }
    }
  }
  if (!invoiceNumber) {
    invoiceNumber = `BLG-${Date.now().toString().slice(-6)}`;
  }

  // 2. Extract Date (YYYY-MM-DD) — önce belgenin kendi başlık tarihi ("Счет на оплату № .. от .."),
  // sözleşme tarihi (Договор ... от 02.02.2023) asla belge tarihi sayılmaz.
  let date = new Date().toISOString().split('T')[0];
  const headerDate = extractDocumentHeaderDate(fullText);
  const isoMatch = fullText.match(/\b(202\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/);
  const dotMatch = fullText.match(/\b(0[1-9]|[12]\d|3[01])[./](0[1-9]|1[0-2])[./](202\d)\b/);
  const ruDateMatch = fullText.match(/[«"]?(\d{1,2})[»"]?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(202\d)\b/i);
  if (headerDate) {
    date = headerDate;
  } else if (isoMatch) {
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

  // 4. Extract Grand Total & Explicit VAT (НДС / KDV) from Labels
  let explicitTotal = 0;
  const totalRegexes = [
    /(?:Всего\s+к\s+оплате|Итого\s+с\s+НДС|Всего\s+наименований[^\r\n]*?на\s+сумму|Итого(?!\s+НДС)|ВСЕГО(?!\s+НДС)|Genel\s+Toplam|Ödenecek\s+Tutar|Toplam\s+Tutar)\s*[:：;,\t ]*\s*(\d{1,3}(?:[\s\u00A0.]\d{3})*[.,]\d{2}|\d+(?:[.,]\d{2})?)/gi,
    /Всего\s+НДС\s+\d{1,3}(?:[\s\u00A0.]\d{3})*[.,]\d{2}\s+(\d{1,3}(?:[\s\u00A0.]\d{3})*[.,]\d{2}|\d+[.,]\d{2})/gi
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

  let explicitTax = 0;
  const taxRegexes = [
    /(?:В\s+том\s+числе\s+НДС|В\s+т\.?\s*ч\.?\s*НДС|Сумма\s+НДС|Итого\s+НДС|Всего\s+НДС|KDV\s*Tutarı|Toplam\s*KDV)(?:\s*\(?[0-9]{1,2}%?\)?)?\s*[:：;,\t ]*\s*(\d{1,3}(?:[\s\u00A0.]\d{3})*[.,]\d{2}|\d+(?:[.,]\d{2})?)/gi
  ];
  for (const rgx of taxRegexes) {
    let m: RegExpExecArray | null;
    while ((m = rgx.exec(fullText)) !== null) {
      const candidateTax = parseNumberSafe(m[1]);
      if (candidateTax > explicitTax && candidateTax < (explicitTotal || 1e11)) {
        explicitTax = candidateTax;
      }
    }
  }

  // 5. Try Deterministic PDF Table Parser first
  let fallbackItems: any[] = [];
  if (!isSummaryOnly) {
    const pdfRows = extractDeterministicPdfTableRows(fullText, explicitTotal);
    if (pdfRows.length > 0) {
      fallbackItems = pdfRows;
    }
  }

  // 6. If no PDF table rows matched (e.g. semicolon CSV from Excel), parse semicolon-delimited CSV rows safely (NEVER split plain PDF text by commas or layout tabs!)
  let sumLineTotals = fallbackItems.reduce((acc, it) => acc + (Number(it.totalPrice) || 0), 0);

  if (!isSummaryOnly && fallbackItems.length === 0) {
    const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const summaryKeywordRegex = /^(?:итого|всего|в\s*т\.?\s*ч\.?\s*ндс|ндс|без\s*ндс|toplam|genel\s*toplam|ara\s*toplam|kdv|iskonto|indirim|total|subtotal|сумма)/i;
    const headerKeywordRegex = /(?:наименование|товары\s*\(работы|malzeme\s*adı|ürün\s*adı|birim\s*fiyat|количество|кол-во|ед\.\s*изм|цена)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('---')) continue;
      if (headerKeywordRegex.test(line)) continue;

      // Strictly require semicolon-separated Excel/CSV rows; never split PDF sentences by commas or tabs
      if (!line.includes(';')) continue;

      const parts = line.split(';').map(p => p.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
      if (parts.length >= 2) {
        const joinedLower = parts.join(' ').toLowerCase();
        if (summaryKeywordRegex.test(parts[0]) || summaryKeywordRegex.test(joinedLower)) {
          if (/(?:итого|всего|genel\s*toplam|toplam)/i.test(joinedLower) && !/(?:ндс|kdv|iskonto)/i.test(parts[0])) {
            const numsInSummary = parts.map(p => parseNumberSafe(p)).filter(n => n > 0 && n < 1e11);
            if (numsInSummary.length > 0) {
              const maxSummaryNum = Math.max(...numsInSummary);
              if (maxSummaryNum > explicitTotal) explicitTotal = maxSummaryNum;
            }
          }
          continue;
        }

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
          if (/^(?:шт\.?|т|тн|тонн[аы]?|м3|м³|м2|м²|п\.?\s*м\.?|м|кг|л|упак\.?|компл\.?|рул\.?|меш\.?|пар[аы]?|ед\.?|adet|ton|kg|m3|m2|m|lt|paket|torba|koli)$/i.test(col)) {
            unit = normalizeExtractedUnit(col);
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
            if (Math.abs(qty * unitPrice - totalPrice) > 1.0) {
              unitPrice = qty > 0 ? Number((totalPrice / qty).toFixed(2)) : totalPrice;
            }
          } else if (numericValues.length === 2) {
            qty = numericValues[0];
            totalPrice = numericValues[1];
            unitPrice = qty > 0 ? Number((totalPrice / qty).toFixed(2)) : totalPrice;
          }

          if (totalPrice > 0 && !isInvoiceHeaderOrAddressGarbage(rawOriginalName, qty, unitPrice, totalPrice)) {
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
              grossUnitPrice: unitPrice,
              totalPrice,
              grossTotalPrice: totalPrice,
              confidence: 0.90
            });
          }
        }
      }
    }
  }

  const finalTotal = explicitTotal > 0 ? explicitTotal : sumLineTotals;
  const finalSubtotal = explicitTax > 0 && finalTotal > explicitTax
    ? Number((finalTotal - explicitTax).toFixed(2))
    : finalTotal;

  return {
    documentType: isSummaryOnly ? 'offer' : 'invoice',
    supplier: { value: supplier, confidence: 0.90 },
    vendorName: { value: supplier, confidence: 0.90 },
    invoiceNumber: { value: invoiceNumber, confidence: 0.90 },
    date: { value: date, confidence: 0.90 },
    currency: { value: currency, confidence: 0.95 },
    totalAmount: { value: finalTotal, confidence: 0.95 },
    subtotal: { value: finalSubtotal, confidence: 0.90 },
    tax: { value: explicitTax, confidence: 0.90 },
    itemCount: fallbackItems.length || 1,
    items: isSummaryOnly ? [] : fallbackItems,
    overallConfidence: 0.92,
    rawWarnings: []
  };
}

// Full Two-Stage Processing Pipeline with Multi-Model Fallback, Argon Escalation & Deterministic PDF Table Reconciliation
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
  // Anahtar yoksa ya da AI kullanılamıyorsa belge YİNE DE metin katmanından okunur (aşağıdaki yerel ayrıştırıcı).
  // Eskiden burada fırlayan hata, PDF metnini hiç kullanmayan boş bir "kurtarma" kaydına düşüyordu.
  let ai: any = null;
  let aiInitError: Error | null = null;
  try {
    ai = getGenAI();
  } catch (initErr: any) {
    aiInitError = initErr;
    console.warn('[AI OCR] Yapay zekâ kullanılamıyor, belge yerel ayrıştırıcıyla okunacak:', initErr?.message);
  }
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
      if (!ai) throw aiInitError || new Error('AI kullanılamıyor');
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

    const rawSummaryInvNo = extractStringSafe(rawExtracted.invoiceNumber);
    const resolvedSummaryInvNo = isValidInvoiceNumber(rawSummaryInvNo)
      ? rawSummaryInvNo
      : (extractStringSafe(localSupplement.invoiceNumber) || rawSummaryInvNo);

    const finalSummaryExtracted: any = {
      documentType: rawExtracted.documentType || 'offer',
      supplier: resolvedSupplier,
      vendorName: resolvedSupplier,
      company: resolvedSupplier,
      seller: resolvedSupplier,
      taxId: extractStringSafe(rawExtracted.taxId) || extractVendorInn(extractedPdfText),
      invoiceNumber: resolvedSummaryInvNo,
      date: extractDocumentHeaderDate(extractedPdfText) || extractStringSafe(rawExtracted.date) || extractStringSafe(localSupplement.date, new Date().toISOString().split('T')[0]),
      currency: extractStringSafe(rawExtracted.currency, 'RUB'),
      subtotal: parseNumberSafe(rawExtracted.subtotal?.value ?? rawExtracted.subtotal ?? resolvedTotal),
      discount: 0,
      tax: 0,
      totalAmount: resolvedTotal,
      itemCount: parseNumberSafe(rawExtracted.itemCount?.value ?? rawExtracted.itemCount ?? rawExtracted.itemsCount ?? (Array.isArray(rawExtracted.items) && rawExtracted.items.length > 0 ? rawExtracted.items.length : localSupplement.itemCount)),
      category: rawExtracted.category || 'İnşaat Demiri',
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

  // Run Deterministic Local PDF/CSV Parser in parallel (Channel 1)
  const localFallback = fallbackExtractInvoiceFromTextOrCsv(
    [effectiveExcelCsv, extractedPdfText].filter(Boolean).join('\n\n'),
    params.fileName,
    false
  );

  try {
    if (!ai) throw aiInitError || new Error('AI kullanılamıyor');
    // Channel 2: Multi-model Gemini chain starting with gemini-3.8-flash
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
    const extractedItems = Array.isArray(rawExtracted?.items) ? rawExtracted.items : [];
    const extractedItemsCount = extractedItems.length;
    const rawItemsSum = extractedItems.reduce((acc: number, it: any) => {
      const q = parseNumberSafe(it?.quantity) || 1;
      const gTot = parseNumberSafe(it?.grossTotalPrice);
      const tTot = parseNumberSafe(it?.totalPrice);
      const uP = parseNumberSafe(it?.grossUnitPrice || it?.unitPrice);
      return acc + (gTot > 0 ? gTot : (tTot > 0 ? tTot : q * uP));
    }, 0);

    // Smart Escalation to gemini-4-argon if Flash missed items/total OR if item sum deviates from invoice total when no deterministic PDF table is available
    const hasDeterministicPdfMatch =
      localFallback.items.length > 0 &&
      localFallback.totalAmount.value > 0 &&
      Math.abs(localFallback.items.reduce((s: number, x: any) => s + (Number(x.totalPrice) || 0), 0) - localFallback.totalAmount.value) <= 2.0;

    const hasUnexplainedMathMismatch =
      !hasDeterministicPdfMatch &&
      extractedTotal > 0 &&
      rawItemsSum > 0 &&
      Math.abs(rawItemsSum - extractedTotal) > 2.0 &&
      Math.abs((extractedTotal / rawItemsSum) - 1.20) > 0.015 &&
      Math.abs((extractedTotal / rawItemsSum) - 1.22) > 0.015;

    if ((extractedItemsCount === 0 || extractedTotal <= 0 || hasUnexplainedMathMismatch) && !usedModel.includes('argon')) {
      console.log(`[Gemini AI OCR] Zorlu fatura veya tutar uyuşmazlığı tespit edildi (kalem: ${extractedItemsCount}, kalemToplam: ${rawItemsSum}, genelToplam: ${extractedTotal}), gemini-4-argon devreye alınıyor...`);
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
        if (argonItems > 0 && argonTotal > 0) {
          rawExtracted = argonParsed;
          usedModel = argonRes.usedModel;
        }
      } catch (argonErr: any) {
        console.warn('[Gemini AI OCR] Argon ek analizi tamamlanamadı, mevcut veri ve dijital tablo doğrulaması kullanılacak:', argonErr?.message);
      }
    }
  } catch (err: any) {
    retryCount++;
    console.warn('[AI Full OCR] AI servisleri yanıt veremedi, deterministik dijital tablo ayrıştırıcısı devreye alınıyor:', err?.message);
    rawExtracted = localFallback;
    usedModel = 'local-resilient-parser';
  }

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
    if (parseNumberSafe(rawExtracted.tax?.value ?? rawExtracted.tax ?? 0) <= 0 && localFallback.tax?.value > 0) {
      rawExtracted.tax = localFallback.tax;
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

  // Belge başlığındaki tarih (metin katmanından) yapay zekânın okuduğu tarihten önce gelir: AI zaman zaman
  // "Основание: Договор ... от 02.02.2023" satırındaki sözleşme tarihini fatura tarihi sanıyordu.
  const resolvedDateStr = extractDocumentHeaderDate(extractedPdfText) || extractStringSafe(standardized.date) || extractStringSafe(rawExtracted.date) || extractStringSafe(localFallback.date, new Date().toISOString().split('T')[0]);
  const resolvedCurrency = extractStringSafe(standardized.currency) || extractStringSafe(rawExtracted.currency, localFallback.currency?.value || 'RUB');

  // Resolve authoritative Invoice Grand Total and Tax Amount
  const aiTotalAmount = parseNumberSafe(standardized.totalAmount?.value ?? standardized.totalAmount ?? rawExtracted.totalAmount?.value ?? 0);
  const pdfExplicitTotal = parseNumberSafe(localFallback.totalAmount?.value ?? 0);
  const rawTotalAmount = pdfExplicitTotal > 0 && (aiTotalAmount <= 0 || Math.abs(aiTotalAmount - pdfExplicitTotal) > 1.0)
    ? pdfExplicitTotal
    : (aiTotalAmount > 0 ? aiTotalAmount : pdfExplicitTotal);

  const aiTaxAmount = parseNumberSafe(standardized.tax?.value ?? standardized.tax ?? rawExtracted.tax?.value ?? 0);
  const pdfExplicitTax = parseNumberSafe(localFallback.tax?.value ?? 0);
  const resolvedTaxAmount = pdfExplicitTax > 0 ? pdfExplicitTax : aiTaxAmount;

  // Determine exact invoice-level VAT percentage from tax / (total - tax)
  let defaultVatPct = resolvedDateStr.startsWith('2025') ? 20 : 22;
  if (rawTotalAmount > 0 && resolvedTaxAmount > 0 && rawTotalAmount > resolvedTaxAmount) {
    const impliedVat = (resolvedTaxAmount / (rawTotalAmount - resolvedTaxAmount)) * 100;
    if (Math.abs(impliedVat - 22) <= 1.2) defaultVatPct = 22;
    else if (Math.abs(impliedVat - 20) <= 1.2) defaultVatPct = 20;
    else if (Math.abs(impliedVat - 18) <= 1.2) defaultVatPct = 18;
    else if (Math.abs(impliedVat - 10) <= 1.2) defaultVatPct = 10;
    else if (Math.abs(impliedVat - 5) <= 0.8) defaultVatPct = 5;
  }

  let excludedFreightNetSum = 0;
  let excludedFreightGrossSum = 0;
  const reconciliationNotes: string[] = [];

  // Helper to check if an item is a freight/delivery service line
  const isFreightItem = (nameStr: string) => {
    const m = nameStr.toLowerCase();
    return (
      /доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|\bnakliye\b|teslimat\s*hizmet|kargo/i.test(m) &&
      !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер/i.test(m)
    );
  };

  // Pre-check whether AI put VAT-inclusive prices in grossUnitPrice/grossTotalPrice or unitPrice/totalPrice
  const nonFreightRawItems = (standardized.items || []).filter((it: any) => !isFreightItem(`${it?.materialName || ''} ${it?.originalName || ''}`));
  const sumAiUnitPriceCol = nonFreightRawItems.reduce((s: number, it: any) => {
    const q = parseNumberSafe(it?.quantity) || 1;
    const t = parseNumberSafe(it?.totalPrice) || Number((q * parseNumberSafe(it?.unitPrice)).toFixed(2));
    return s + t;
  }, 0);
  const sumAiGrossPriceCol = nonFreightRawItems.reduce((s: number, it: any) => {
    const q = parseNumberSafe(it?.quantity) || 1;
    const t = parseNumberSafe(it?.grossTotalPrice) || Number((q * parseNumberSafe(it?.grossUnitPrice)).toFixed(2));
    return s + t;
  }, 0);

  const preferAiGrossCol =
    rawTotalAmount > 0 &&
    sumAiGrossPriceCol > 0 &&
    Math.abs(sumAiGrossPriceCol - rawTotalAmount) <= 2.5 &&
    Math.abs(sumAiUnitPriceCol - rawTotalAmount) > 2.5;

  let mappedItems = (standardized.items || [])
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
      const vatPct = defaultVatPct;

      // Resolve exact VAT-inclusive (KDV Dahil) unitPrice and totalPrice
      let uPriceGross = preferAiGrossCol
        ? (parseNumberSafe(it.grossUnitPrice) || parseNumberSafe(it.unitPrice) || 0)
        : (parseNumberSafe(it.unitPrice) || parseNumberSafe(it.grossUnitPrice) || 0);
      let tPriceGross = preferAiGrossCol
        ? (parseNumberSafe(it.grossTotalPrice) || parseNumberSafe(it.totalPrice) || 0)
        : (parseNumberSafe(it.totalPrice) || parseNumberSafe(it.grossTotalPrice) || 0);

      if (uPriceGross <= 0 && qty > 0 && tPriceGross > 0) {
        uPriceGross = Number((tPriceGross / qty).toFixed(2));
      }
      if (tPriceGross <= 0 && uPriceGross > 0) {
        tPriceGross = Number((qty * uPriceGross).toFixed(2));
      }

      const uPriceNet = vatPct > 0
        ? Number((uPriceGross / (1 + vatPct / 100)).toFixed(2))
        : uPriceGross;
      const tPriceNet = vatPct > 0
        ? Number((tPriceGross / (1 + vatPct / 100)).toFixed(2))
        : tPriceGross;

      return {
        materialName: rawName,
        originalName: origName,
        category: normalizeCategoryName(cat, `${rawName} ${origName}`),
        quantity: qty,
        unit: normalizeExtractedUnit(it.unit || 'Adet'),
        unitPrice: uPriceGross,
        unitPriceNet: uPriceNet,
        grossUnitPrice: uPriceGross,
        totalPrice: tPriceGross,
        netTotalPrice: tPriceNet,
        grossTotalPrice: tPriceGross,
        vatPercentage: vatPct,
        isNetNormalized: true,
        isGrossInvoicePrice: true,
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
      const fullItemName = `${it.materialName || ''} ${it.originalName || ''}`;
      if (isInvoiceHeaderOrAddressGarbage(fullItemName, it.quantity, it.unitPrice, it.totalPrice)) {
        return false;
      }
      if (isFreightItem(fullItemName)) {
        excludedFreightNetSum += Number(it.netTotalPrice || it.unitPriceNet * it.quantity) || 0;
        excludedFreightGrossSum += Number(it.grossTotalPrice || it.totalPrice) || 0;
        return false;
      }
      return true;
    });

  // ============================================================================
  // MATHEMATICAL RECONCILIATION & AUTO-REPAIR LAYER (4 STAGES)
  // ============================================================================
  let pdfFreightGrossSum = 0;
  let pdfFreightNetSum = 0;
  const pdfTableItems = (localFallback.items || []).filter((it: any) => {
    const fullItemName = `${it.materialName || ''} ${it.originalName || ''}`;
    if (isInvoiceHeaderOrAddressGarbage(fullItemName, it.quantity, it.unitPrice, it.totalPrice)) {
      return false;
    }
    if (isFreightItem(fullItemName)) {
      const fGross = Number(it.grossTotalPrice || it.totalPrice) || 0;
      const fNet = defaultVatPct > 0 ? Number((fGross / (1 + defaultVatPct / 100)).toFixed(2)) : fGross;
      pdfFreightGrossSum += fGross;
      pdfFreightNetSum += fNet;
      return false;
    }
    return true;
  });
  if (excludedFreightGrossSum === 0 && pdfFreightGrossSum > 0) {
    excludedFreightGrossSum = pdfFreightGrossSum;
    excludedFreightNetSum = pdfFreightNetSum;
  }
  const pdfTableSum = pdfTableItems.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
  const targetGoodsTotal = rawTotalAmount > excludedFreightGrossSum
    ? Number((rawTotalAmount - excludedFreightGrossSum).toFixed(2))
    : rawTotalAmount;

  // STAGE 1: Deterministic PDF Digital Table Cross-Check & Lock
  if (pdfTableItems.length > 0 && targetGoodsTotal > 0 && Math.abs(pdfTableSum - targetGoodsTotal) <= 2.5) {
    if (mappedItems.length === pdfTableItems.length) {
      mappedItems = mappedItems.map((aiItem: any, idx: number) => {
        const pdfRow = pdfTableItems[idx];
        const priceDiff = Math.abs((Number(aiItem.unitPrice) || 0) - (Number(pdfRow.unitPrice) || 0));
        const totalDiff = Math.abs((Number(aiItem.totalPrice) || 0) - (Number(pdfRow.totalPrice) || 0));
        const qtyDiff = Math.abs((Number(aiItem.quantity) || 0) - (Number(pdfRow.quantity) || 0));

        if (priceDiff > 0.01 || totalDiff > 0.01 || qtyDiff > 0.001) {
          reconciliationNotes.push(
            `Kalem #${idx + 1} (${aiItem.materialName}): Birim fiyat ve toplam PDF dijital tablosundan birebir eşitlendi (${pdfRow.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${resolvedCurrency}).`
          );
        }

        const lockedUnitGross = Number(pdfRow.unitPrice);
        const lockedTotalGross = Number(pdfRow.totalPrice);
        const lockedDiscount = Number(pdfRow.discountAmount || aiItem.discountAmount || 0);
        const lockedQty = Number(pdfRow.quantity);
        const vatPct = Number(aiItem.vatPercentage || defaultVatPct);
        const lockedUnitNet = vatPct > 0 ? Number((lockedUnitGross / (1 + vatPct / 100)).toFixed(2)) : lockedUnitGross;
        const lockedTotalNet = vatPct > 0 ? Number((lockedTotalGross / (1 + vatPct / 100)).toFixed(2)) : lockedTotalGross;

        return {
          ...aiItem,
          originalName: pdfRow.originalName || aiItem.originalName,
          productCode: aiItem.productCode || pdfRow.productCode || '',
          quantity: lockedQty,
          unit: pdfRow.unit || aiItem.unit,
          unitPrice: lockedUnitGross,
          grossUnitPrice: lockedUnitGross,
          unitPriceNet: lockedUnitNet,
          discountAmount: lockedDiscount,
          totalPrice: lockedTotalGross,
          grossTotalPrice: lockedTotalGross,
          netTotalPrice: lockedTotalNet,
          lineSource: 'invoice_pdf',
          isGrossInvoicePrice: true
        };
      });
    } else {
      const currentAiSum = mappedItems.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
      if (Math.abs(currentAiSum - targetGoodsTotal) > 2.0) {
        reconciliationNotes.push(
          `AI kalem listesi (${mappedItems.length} satır) yerine genel toplamla birebir örtüşen PDF dijital tablosu (${pdfTableItems.length} satır = ${pdfTableSum.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${resolvedCurrency}) baz alındı.`
        );
        mappedItems = pdfTableItems.map((pdfRow: any, idx: number) => {
          const vatPct = defaultVatPct;
          const lockedUnitGross = Number(pdfRow.unitPrice);
          const lockedTotalGross = Number(pdfRow.totalPrice);
          const lockedDiscount = Number(pdfRow.discountAmount || 0);
          const lockedUnitNet = vatPct > 0 ? Number((lockedUnitGross / (1 + vatPct / 100)).toFixed(2)) : lockedUnitGross;
          const lockedTotalNet = vatPct > 0 ? Number((lockedTotalGross / (1 + vatPct / 100)).toFixed(2)) : lockedTotalGross;
          const matchedAi = mappedItems.find((a: any) =>
            (pdfRow.productCode && a.productCode === pdfRow.productCode) ||
            Math.abs((Number(a.totalPrice) || 0) - lockedTotalGross) < 1.0
          ) || mappedItems[idx];

          return {
            materialName: matchedAi?.materialName || pdfRow.materialName,
            originalName: pdfRow.originalName,
            category: matchedAi?.category || pdfRow.category,
            quantity: Number(pdfRow.quantity),
            unit: pdfRow.unit,
            unitPrice: lockedUnitGross,
            grossUnitPrice: lockedUnitGross,
            unitPriceNet: lockedUnitNet,
            discountAmount: lockedDiscount,
            totalPrice: lockedTotalGross,
            grossTotalPrice: lockedTotalGross,
            netTotalPrice: lockedTotalNet,
            vatPercentage: vatPct,
            isNetNormalized: true,
            isGrossInvoicePrice: true,
            lineSource: 'invoice_pdf',
            productCode: pdfRow.productCode || matchedAi?.productCode || '',
            brand: matchedAi?.brand || '',
            model: matchedAi?.model || '',
            diameter: matchedAi?.diameter || '',
            dimensions: matchedAi?.dimensions || '',
            quality: matchedAi?.quality || '',
            color: matchedAi?.color || '',
            confidence: 0.99
          };
        });
      }
    }
  }

  // STAGE 1b: Katı belge ayrıştırıcısı (invoiceLineParser). Satırlar kendi içinde (miktar × fiyat = tutar)
  // ve belge toplamıyla kuruşu kuruşuna tutuyorsa fiyatlar yapay zekâdan değil BELGEDEN alınır.
  const allLockedFromPdf = mappedItems.length > 0 && mappedItems.every((it: any) => it.lineSource === 'invoice_pdf');
  if (!allLockedFromPdf && extractedPdfText) {
    try {
      const strictDoc = parseInvoiceText(extractedPdfText);
      const strictTotal = Number(strictDoc.totalWithVat || 0);
      const strictCheck = strictTotal > 0 ? verifyParsedInvoice(strictDoc, strictTotal) : null;
      if (strictCheck?.verified) {
        const goodsLines = strictDoc.lines.filter(l => !isFreightItem(l.name));
        if (goodsLines.length > 0) {
          const aiPool = [...mappedItems];
          mappedItems = goodsLines.map((l, idx) => {
            const grossTotal = Number(l.grossAmount.toFixed(2));
            const grossUnit = strictDoc.pricesIncludeVat ? l.price : Number((grossTotal / (l.quantity || 1)).toFixed(2));
            const vatPct = l.vatPct ?? defaultVatPct;
            const aiIdx = aiPool.findIndex((a: any) => a && Math.abs((Number(a.totalPrice) || 0) - grossTotal) < 1.0);
            const ai = aiIdx >= 0 ? aiPool.splice(aiIdx, 1)[0] : (mappedItems.length === goodsLines.length ? mappedItems[idx] : null);
            const trName = /[А-Яа-яЁё]/.test(l.name) ? (translateRussianMaterialToTurkish(l.name) || l.name) : l.name;
            return {
              ...(ai || {}),
              materialName: ai?.materialName || trName,
              originalName: l.name,
              category: normalizeCategoryName(ai?.category, `${trName} ${l.name}`),
              quantity: l.quantity,
              unit: normalizeExtractedUnit(ai?.unit || mapDocumentUnit(l.unitRaw)),
              unitPrice: grossUnit,
              grossUnitPrice: grossUnit,
              unitPriceNet: vatPct > 0 ? Number((grossUnit / (1 + vatPct / 100)).toFixed(2)) : grossUnit,
              discountAmount: 0,
              totalPrice: grossTotal,
              grossTotalPrice: grossTotal,
              netTotalPrice: Number(l.netAmount.toFixed(2)),
              vatPercentage: vatPct,
              isNetNormalized: true,
              isGrossInvoicePrice: true,
              lineSource: 'invoice_pdf',
              productCode: l.article || ai?.productCode || '',
              confidence: 0.99
            };
          });
          reconciliationNotes.push(`Kalemler belgenin metin katmanından okundu ve doğrulandı (${goodsLines.length} satır, miktar × fiyat = tutar, toplam ${strictTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${resolvedCurrency}).`);
        }
      }
    } catch (strictErr: any) {
      console.warn('[PDF Strict Parser] Satır ayrıştırma atlandı:', strictErr?.message);
    }
  }

  // STAGE 2: Reverse Accidental AI VAT Division on Image/Scanned Invoices (1.20x / 1.22x / 1.18x / 1.10x)
  const sumBeforeVatCheck = mappedItems.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
  if (targetGoodsTotal > 0 && sumBeforeVatCheck > 0 && Math.abs(targetGoodsTotal - sumBeforeVatCheck) > 2.0) {
    const ratio = targetGoodsTotal / sumBeforeVatCheck;
    const candidateMultipliers = [1.22, 1.20, 1.18, 1.10, 1 + defaultVatPct / 100];
    const matchedMultiplier = candidateMultipliers.find(m => Math.abs(ratio - m) <= 0.015);

    if (matchedMultiplier !== undefined) {
      reconciliationNotes.push(
        `Kalem birim fiyatlarında yanlışlıkla düşülen KDV oranı (×${matchedMultiplier.toFixed(2)}) tespit edilerek faturadaki gerçek KDV dahil fiyatlara (${targetGoodsTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${resolvedCurrency}) eşitlendi.`
      );
      mappedItems = mappedItems.map((it: any) => {
        const qty = Number(it.quantity) || 1;
        // Prefer exact VAT multiplier (e.g. 1.22 or 1.20) when it snaps unitPrice to a clean integer (e.g. 11410.66 * 1.22 = 13921.0052 -> 13921)
        const multUnit = Number(it.unitPrice) * matchedMultiplier;
        const nearIntMultUnit = Math.round(multUnit);
        let restoredUnit = Math.abs(multUnit - nearIntMultUnit) <= 0.025
          ? nearIntMultUnit
          : Number((Number(it.unitPrice) * ratio).toFixed(2));

        let restoredTotal = Number((Number(it.totalPrice) * ratio).toFixed(2));
        const exactLineTotal = Number((qty * restoredUnit - (Number(it.discountAmount) || 0)).toFixed(2));
        if (Math.abs(exactLineTotal - restoredTotal) <= Math.max(0.5, qty * 0.02)) {
          restoredTotal = exactLineTotal;
        }

        const vatPct = Number(it.vatPercentage || defaultVatPct);
        const netUnit = vatPct > 0 ? Number((restoredUnit / (1 + vatPct / 100)).toFixed(2)) : restoredUnit;
        const netTotal = vatPct > 0 ? Number((restoredTotal / (1 + vatPct / 100)).toFixed(2)) : restoredTotal;

        return {
          ...it,
          unitPrice: restoredUnit,
          grossUnitPrice: restoredUnit,
          unitPriceNet: netUnit,
          totalPrice: restoredTotal,
          grossTotalPrice: restoredTotal,
          netTotalPrice: netTotal,
          isGrossInvoicePrice: true
        };
      });
    }
  }

  // STAGE 3: Row-level Multiplication & Discount Consistency (quantity × unitPrice - discountAmount === totalPrice)
  const sumAfterVatCheck = mappedItems.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
  const rowTotalsMatchGrandTotal = targetGoodsTotal > 0 && Math.abs(sumAfterVatCheck - targetGoodsTotal) <= 1.5;

  mappedItems = mappedItems.map((it: any, idx: number) => {
    const qty = Number(it.quantity) || 1;
    let uPrice = Number(it.unitPrice) || 0;
    let tPrice = Number(it.totalPrice) || 0;
    let discAmt = Number(it.discountAmount) || 0;

    if (qty > 0 && tPrice > 0 && uPrice > 0) {
      const expectedAfterDisc = Number((qty * uPrice - discAmt).toFixed(2));
      if (Math.abs(expectedAfterDisc - tPrice) > 0.5) {
        if (rowTotalsMatchGrandTotal) {
          // Check if uPrice was accidentally divided by VAT (e.g. 11410.66 = 13921 / 1.22) while tPrice is already gross (55669)
          const vatCandidates = [1.22, 1.20, 1.18, 1.10, 1 + defaultVatPct / 100];
          let restoredFromVat = false;
          for (const vm of vatCandidates) {
            const candidateGrossUnit = uPrice * vm;
            const snappedUnit = Math.abs(candidateGrossUnit - Math.round(candidateGrossUnit)) <= 0.025
              ? Math.round(candidateGrossUnit)
              : Number(candidateGrossUnit.toFixed(2));
            const grossBeforeDisc = Number((qty * snappedUnit).toFixed(2));
            if (grossBeforeDisc >= tPrice && (grossBeforeDisc - tPrice) <= Math.max(100, tPrice * 0.02)) {
              reconciliationNotes.push(
                `Kalem #${idx + 1} (${it.materialName}): Birim fiyatta düşülen KDV (×${vm.toFixed(2)}) geri eklenerek faturadaki birebir birim fiyata (${uPrice} → ${snappedUnit}) düzeltildi.`
              );
              uPrice = snappedUnit;
              discAmt = Number((grossBeforeDisc - tPrice).toFixed(2));
              restoredFromVat = true;
              break;
            }
          }

          if (!restoredFromVat) {
            const correctedUnit = Number((tPrice / qty).toFixed(2));
            reconciliationNotes.push(
              `Kalem #${idx + 1} (${it.materialName}): Birim fiyat satır toplamı / miktar (${tPrice} / ${qty} = ${correctedUnit}) ile doğrulandı.`
            );
            uPrice = correctedUnit;
          }
        } else {
          tPrice = expectedAfterDisc;
        }
      }
    }

    const vatPct = Number(it.vatPercentage || defaultVatPct);
    const uPriceNet = vatPct > 0 ? Number((uPrice / (1 + vatPct / 100)).toFixed(2)) : uPrice;
    const tPriceNet = vatPct > 0 ? Number((tPrice / (1 + vatPct / 100)).toFixed(2)) : tPrice;

    return {
      ...it,
      unitPrice: uPrice,
      grossUnitPrice: uPrice,
      unitPriceNet: uPriceNet,
      discountAmount: discAmt,
      totalPrice: tPrice,
      grossTotalPrice: tPrice,
      netTotalPrice: tPriceNet,
      isGrossInvoicePrice: true
    };
  });

  // SATIR DOĞRULAMA: her satırda miktar × birim fiyat = tutar ve satır toplamı = fatura (mal) toplamı mı?
  // Doğrulanamayan okumalar işaretlenir; fiyat denetimi ve tasarruf hesapları bu satırlara güvenmez.
  const sumForCheck = mappedItems.reduce((acc: number, item: any) => acc + (Number(item.totalPrice) || 0), 0);
  const totalAgrees = targetGoodsTotal > 0 && Math.abs(sumForCheck - targetGoodsTotal) <= Math.max(1.5, targetGoodsTotal * 0.0015);
  mappedItems = mappedItems.map((it: any) => {
    const qty = Number(it.quantity) || 0;
    const expected = qty * (Number(it.unitPrice) || 0) - (Number(it.discountAmount) || 0);
    const total = Number(it.totalPrice) || 0;
    const rowOk = qty > 0 && total > 0 && Math.abs(expected - total) <= Math.max(0.5, total * 0.002);
    return { ...it, lineVerified: rowOk && totalAgrees };
  });
  const lineCheck: 'verified' | 'mismatch' = mappedItems.length > 0 && mappedItems.every((it: any) => it.lineVerified) ? 'verified' : 'mismatch';
  const lineCheckReason = lineCheck === 'verified'
    ? undefined
    : (!totalAgrees
        ? `Kalem toplamı (${sumForCheck.toFixed(2)}) fatura toplamı (${targetGoodsTotal.toFixed(2)}) ile tutmuyor`
        : 'Bazı satırlarda miktar × birim fiyat satır tutarını vermiyor');

  const computedItemsSum = Number(
    mappedItems.reduce((acc: number, item: any) => acc + (Number(item.totalPrice) || 0), 0).toFixed(2)
  );
  const finalTotalAmount = rawTotalAmount > 0 ? rawTotalAmount : computedItemsSum;
  const finalSubtotalAmount = resolvedTaxAmount > 0 && finalTotalAmount > resolvedTaxAmount
    ? Number((finalTotalAmount - resolvedTaxAmount).toFixed(2))
    : parseNumberSafe(standardized.subtotal?.value ?? standardized.subtotal ?? rawExtracted.subtotal?.value ?? finalTotalAmount);

  const candidateInvNos = [
    extractStringSafe(standardized.invoiceNumber),
    extractStringSafe(rawExtracted.invoiceNumber),
    extractStringSafe(localFallback.invoiceNumber)
  ];
  const resolvedInvoiceNumber =
    candidateInvNos.find(n => isValidInvoiceNumber(n)) ||
    candidateInvNos.find(Boolean) ||
    `BLG-${Date.now().toString().slice(-6)}`;

  const finalExtracted: any = {
    documentType: standardized.documentType || rawExtracted.documentType || 'invoice',
    supplier: resolvedSupplier,
    vendorName: resolvedSupplier,
    company: resolvedSupplier,
    seller: resolvedSupplier,
    taxId: extractStringSafe(standardized.taxId) || extractStringSafe(rawExtracted.taxId) || extractVendorInn(extractedPdfText),
    invoiceNumber: resolvedInvoiceNumber,
    date: resolvedDateStr,
    currency: resolvedCurrency,
    subtotal: finalSubtotalAmount,
    discount: parseNumberSafe(standardized.discount?.value ?? standardized.discount ?? rawExtracted.discount?.value ?? 0),
    tax: resolvedTaxAmount,
    vatRate: defaultVatPct,
    totalAmount: finalTotalAmount,
    calculatedItemsSum: computedItemsSum,
    reconciliationNotes,
    lineCheck,
    ...(lineCheckReason ? { lineCheckReason } : {}),
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
