// Two-stage AI Document Processor: Extraction & Safe Standardization
import { GoogleGenAI } from '@google/genai';
import { PDFParse } from 'pdf-parse';

import { 
  getGenAI, 
  robustParseJSON, 
  validateInvoiceData, 
  checkDuplicateInvoice, 
  calculateFileHash,
  generateContentWithResilience
} from './aiOcrEngine';
import { normalizeCategoryName } from '../src/utils/categoryClassifier';

const parseNumberSafe = (val: any): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  let str = String(val).trim();
  
  // Remove all spaces
  str = str.replace(/\s+/g, '');
  
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
    // Check if comma is used as decimal (e.g. followed by 1-2 digits)
    if (str.length - lastComma <= 3) {
      str = str.replace(',', '.');
    } else {
      // comma used as thousand separator: 1,234,567
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
export function buildStage1ExtractionPrompt(excelCsv?: string, additionalPrompt?: string, pdfText?: string, hasFirstOffer?: boolean): string {
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
    - unitPrice: Birim fiyat (KESİNLİKLE KDV/NDS DAHİL hesaplanmış sayısal değer. Tabloda KDV hariçse, KDV oranını ekleyerek hesapla!)
    - totalPrice: Satır toplam tutarı (KESİNLİKLE KDV/NDS DAHİL hesaplanmış sayısal değer!)
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

${pdfText ? `\n--- DİJİTAL BELGE METİN KATMANI ---\n${pdfText}\n-----------------------------------\n` : ''}
${excelCsv ? `\n--- EXCEL/CSV VERİSİ ---\n${excelCsv}\n------------------------\n` : ''}
${additionalPrompt ? `\nEk Kullanıcı Notu: ${additionalPrompt}\n` : ''}

ÖNEMLİ KURALLAR:
- ASLA uydurma değer üretme. Okunamayan alanları JSON'a ekleme.
- HIZ VE TOKEN TASARRUFU KURALI: 'items' dizisindeki her bir kalem için SADECE değeri olan alanları üret. Eğer bir alan (örn: brand, model, productCode, diameter, dimensions, quality, color vb.) belgede yoksa veya boşsa, o alanı JSON'a ASLA ekleme!
- KDV/NDS DAHİL FİYAT KURALI: "items" listesindeki her ürünün "unitPrice" ve "totalPrice" değerleri KESİNLİKLE KDV (NDS) DAHİL olarak yazılmalıdır. Eğer tabloda KDV hariç ise (Без НДС), genel toplama bakarak veya KDV oranını uygulayarak KDV dahil rakamı hesapla!
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
Belgeden SADECE ve YALNIZCA firma adını, fatura/teklif numarasını, tarihini, para birimini ve genel toplam tutarını çıkar.

⚠️ KRİTİK HIZ KURALI:
Tablonun içindeki ürünleri ASLA okuma! Satırları veya kalem sayısını (itemCount) ASLA SAYMA!
'items' dizisini KESİNLİKLE BOŞ BIRAK ([]). 
Bu işlem ilk teklif turu içindir. Amaç tablonun içini okumadan, sadece belgenin kime ait olduğunu ve En Alt kısımdaki Genel Toplam tutarını saniyesinde bulmaktır.

ÇIKARILACAK ALANLAR:
1. documentType: 'offer' (Teklif) veya 'invoice' (Fatura)
2. supplier: TEDARİKÇİ / SATICI / TEKLİF VEREN FİRMANIN GERÇEK TAM ADI ve confidence (0-1).
   - Rusça belgelerde: 'Поставщик (исполнитель)', 'Продавец', 'Исполнитель', 'Организация', 'ООО', 'АО', 'ПАО', 'ИП', logo başlığı.
   - Türkçe belgelerde: 'Satıcı', 'Tedarikçi', 'Firma'.
3. invoiceNumber: Fatura / Teklif Numarası (№, Счет №, Teklif No)
4. date: Belge Düzenleme Tarihi (YYYY-MM-DD)
5. currency: Para birimi (RUB, TRY, USD, EUR)
6. totalAmount: Belgenin Genel Toplam / Teklif Tutarı (ИТОГО / ВСЕГО / Toplam). Belgenin en altındaki rakamı bul. DİKKAT: Rakamları temizle, ondalık kısım için nokta kullan ve sadece sayı olarak döndür (örn: "815 726,39" veya "815.726,39" -> 815726.39). Boşluk bırakma!

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

KATEGORİLER (SADECE AŞAĞIDAKİ 28 KESİN KANONİK KATEGORİDEN BİRİNİ SEÇ, "DİĞER" VEYA TORBA KATEGORİ KESİNLİKLE YASAKTIR):
1. İnşaat Demiri
2. Çelik Borular
3. Çelik Malzemeler
4. Donatı Malzemeleri
5. Ankraj Sistemleri
6. Hazır Beton, Çimento & Agrega
7. Tuğla, Gazbeton & Duvar Blokları
8. Kalıp & İskele Sistemleri
9. Ahşap & Kereste
10. Yalıtım & Alçıpan
11. Kimyasallar & Boya
12. Mekanik & Tesisat
13. Elektrik & Otomasyon
14. İş Güvenliği & KKD
15. El Aletleri & Hırdavat
16. Sarf Malzeme & Hırdavat
17. Kaynak Malzemeleri
18. Seramik & Vitrifiye
19. İç Mekan, Zemin & Kapı / Doğrama
20. Tabela, Yönlendirme & Reklam
21. Ölçüm, Harita & Saha Ekipmanları
22. Şantiye Mobilya & Yaşam Donanımı
23. Şantiye Tesis & Konteyner
24. Temizlik & Hijyen Malzemeleri
25. Gıda & Mutfak Malzemeleri
26. Ofis & Kırtasiye
27. Bilgi İşlem & IT
28. Araç & İş Makinesi Ekipmanları

STANDARTLAŞTIRMA VE KORUMA KURALLARI:
1. TEK DİL KURALI (SADECE TÜRKÇE): "materialName" alanı KESİNLİKLE TÜRKÇE olmalıdır. Rusça veya yabancı isimleri birebir Türkçeye çevir (Örn: "Фанера" -> "Plywood / Kontrplak", "Краска" -> "Boya", "Труба" -> "Boru", "Муфта" -> "Manşon", "Арматура" -> "İnşaat Demiri"). ASLA Kiril harfi bırakma!
2. DETAYLARI KESİNLİKLE SİLME: Marka, model, artikül numarası, ürün kodu, çap, kalınlık, boy, ölçü, renk, kalite sınıfı (Örn: A500C, C25/30, M150) bilgilerini "materialName" içinde mutlaka koru.
   - Örn: "Муфта P13 d=28/32 мм" -> "P13 Geçiş Manşonu d=28/32 mm" (Asla sadece "Manşon" yapma!)
3. ÇAP VE EBAT STANDARDI: Çap bilgilerini net formatta (Ø12 mm, d=14 mm) materialName'e ekle.
4. BİRİM STANDARDI: Adet, Ton, m³, m², Metre, Torba, kg, Koli, Litre, Paket vb. standart birimler kullan.
5. İNŞAAT DEMİRİ KORUYUCU BAŞLIK / AKSESUAR KURALI: "Колпачок для арматуры 10-18 мм грибок" KESİNLİKLE "İnşaat Demiri Güvenlik Başlığı Mantar Tip 10-18 mm (1000 Adetlik Paket)" olarak çevrilmeli ve kategorisi "Sarf Malzeme & Hırdavat" olmalıdır. ASLA "İnşaat Demiri" veya ton birimli donatı yapılmamalıdır!
6. TEDARİKÇİ KORUMA KURALI: Aşama 1'de tespit edilen tedarikçi adını (${extractedSupplierVal ? `"${extractedSupplierVal}"` : 'Ham verideki supplier'}) KESİNLİKLE AYNEN KORU, silme veya değiştirme.

GİRDİ (AŞAMA 1 HAM VERİ):
${JSON.stringify(rawExtraction, null, 2)}

SADECE GEÇERLİ JSON DÖN:
{
  "documentType": "${rawExtraction.documentType || 'invoice'}",
  "supplier": ${JSON.stringify(extractedSupplierVal || rawExtraction.supplier || 'Tedarikçi Firma')},
  "vendorName": ${JSON.stringify(extractedSupplierVal || rawExtraction.supplier || 'Tedarikçi Firma')},
  "taxId": ${JSON.stringify(rawExtraction.taxId?.value || rawExtraction.taxId || '')},
  "invoiceNumber": ${JSON.stringify(rawExtraction.invoiceNumber?.value || rawExtraction.invoiceNumber || '')},
  "date": ${JSON.stringify(rawExtraction.date?.value || rawExtraction.date || '')},
  "currency": ${JSON.stringify(rawExtraction.currency?.value || rawExtraction.currency || 'RUB')},
  "subtotal": ${JSON.stringify(rawExtraction.subtotal?.value ?? rawExtraction.subtotal ?? 0)},
  "discount": ${JSON.stringify(rawExtraction.discount?.value ?? rawExtraction.discount ?? 0)},
  "tax": ${JSON.stringify(rawExtraction.tax?.value ?? rawExtraction.tax ?? 0)},
  "totalAmount": ${JSON.stringify(rawExtraction.totalAmount?.value ?? rawExtraction.totalAmount ?? 0)},
  "scopeDeductionReasoning": ${JSON.stringify(rawExtraction.scopeDeductionReasoning?.value ?? rawExtraction.scopeDeductionReasoning ?? "")},
  "scopeDeductionAmount": ${JSON.stringify(rawExtraction.scopeDeductionAmount?.value ?? rawExtraction.scopeDeductionAmount ?? 0)},
  "scopeDeductionReason": ${JSON.stringify(rawExtraction.scopeDeductionReason?.value ?? rawExtraction.scopeDeductionReason ?? "")},
  "items": [
    {
      "materialName": "Standart Türkçe Malzeme Adı (Detaylar Korunmuş)",
      "originalName": "Belgedeki Orijinal İsim",
      "category": "Seçilen Standart Kategori",
      "quantity": 10,
      "unit": "Ton",
      "unitPrice": 12000,
      "totalPrice": 120000,
      "brand": "",
      "model": "",
      "productCode": "",
      "diameter": "Ø12 mm",
      "dimensions": "",
      "quality": "A500C",
      "color": "",
      "confidence": 0.95
    }
  ],
  "overallConfidence": ${rawExtraction.overallConfidence || 0.95},
  "rawWarnings": ${JSON.stringify(rawExtraction.rawWarnings || [])}
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
    // Clean leading/trailing quotes or colon
    trimmed = trimmed.replace(/^[:\s"'«»“”]+|[:\s"'«»“”]+$/g, '').trim();
    if (trimmed && !INVALID_SUPPLIER_NAMES.has(trimmed.toLowerCase())) {
      return trimmed;
    }
    return '';
  }
  if (typeof obj === 'object') {
    if (obj.value !== undefined) {
      const res = extractSupplierName(obj.value);
      if (res) return res;
    }
    if (obj.name !== undefined) {
      const res = extractSupplierName(obj.name);
      if (res) return res;
    }
    if (obj.supplier !== undefined) {
      const res = extractSupplierName(obj.supplier);
      if (res) return res;
    }
    if (obj.vendor !== undefined) {
      const res = extractSupplierName(obj.vendor);
      if (res) return res;
    }
    if (obj.vendorName !== undefined) {
      const res = extractSupplierName(obj.vendorName);
      if (res) return res;
    }
    if (obj.company !== undefined) {
      const res = extractSupplierName(obj.company);
      if (res) return res;
    }
    if (obj.companyName !== undefined) {
      const res = extractSupplierName(obj.companyName);
      if (res) return res;
    }
    if (obj.seller !== undefined) {
      const res = extractSupplierName(obj.seller);
      if (res) return res;
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
  // "Поставщик (исполнитель): ООО "ТСК ДИПЛОМАТ"" or "Поставщик: ООО «СтройСнаб»"
  const postMatch = fullText.match(/(?:Поставщик\s*(?:\(исполнитель\))?|Продавец|Исполнитель|Организация)\s*[:：\t]\s*([^\r\n,;]+)/i);
  if (postMatch && postMatch[1]) {
    const candidate = extractSupplierName(postMatch[1]);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 2. Regex for Turkish seller labels
  // "Satıcı: ABC İnşaat San. ve Tic. Ltd. Şti." or "Tedarikçi: Kardemir A.Ş."
  const satMatch = fullText.match(/(?:Satıcı|Tedarikçi|Firma Ünvanı|Düzenleyen)\s*[:：\t]\s*([^\r\n,;]+)/i);
  if (satMatch && satMatch[1]) {
    const candidate = extractSupplierName(satMatch[1]);
    if (candidate && candidate.length > 2) return candidate;
  }

  // 3. Regex for common corporate entities with quotes (e.g. ООО "Строй-Комплект", АО «Северсталь», ИП Иванов)
  const corpMatch = fullText.match(/(?:ООО|АО|ПАО|ЗАО|НАО)\s*["«“]([^"»”\r\n]{2,60})["»”]|(?:ООО|АО|ПАО|ЗАО|НАО)\s+([А-Яа-яA-Za-z0-9\-_]{3,40})|ИП\s+([А-Яа-яA-Za-z0-9\-_]+(?:\s+[А-Яа-яA-Za-z0-9\-_]+)?)/);
  if (corpMatch) {
    const found = corpMatch[0].trim();
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
    const cleanFn = fileName.replace(/\.[^.]+$/, '').replace(/[_.\-+]/g, ' ');
    if (/diplomat|дипломат/i.test(cleanFn)) return 'ООО "ТСК ДИПЛОМАТ"';
    if (/diler|дилер/i.test(cleanFn)) return 'Diler Demir Çelik A.Ş.';
    if (/kardemir/i.test(cleanFn)) return 'Kardemir Demir Çelik A.Ş.';
    if (/cimsa|çimsa|чимса/i.test(cleanFn)) return 'Çimsa Çimento Sanayi A.Ş.';
    if (/akcansa|akçansa/i.test(cleanFn)) return 'Akçansa Çimento Sanayi A.Ş.';
    if (/stroysnab|стройснаб/i.test(cleanFn)) return 'ООО "СтройСнаб"';
    if (/metallservice|металлсервис|металл-сервис/i.test(cleanFn)) return 'ООО "МЕТАЛЛ-СЕРВИС"';
    if (/stroykomplekt|стройкомплект/i.test(cleanFn)) return 'ООО "СтройКомплект"';
  }

  return '';
}

// Full Two-Stage Processing Pipeline with Retry Logic (Max 2 Attempts)
export async function processInvoiceTwoStages(params: {
  base64Input?: string;
  mimeType?: string;
  excelCsv?: string;
  fileName?: string;
  additionalPrompt?: string;
  existingInvoices?: any[];
  scanMode?: 'full' | 'summary-only';
  offerType?: 'first' | 'final' | 'round';
  firstOfferBase64?: string;
}): Promise<{
  success: boolean;
  extracted: any;
  validation: any;
  duplicateInfo: any;
  usedModel: string;
  retryCount: number;
  stagesCompleted: number;
}> {
  const isSummaryOnly = params.scanMode === 'summary-only' || params.offerType === 'first' || params.offerType === 'round';
  const ai = getGenAI();
  let usedModel = 'gemini-3.7-flash';
  let retryCount = 0;
  let rawExtracted: any = null;
  let standardized: any = null;

  const cleanBase64 = params.base64Input
    ? (params.base64Input.includes(',') ? params.base64Input.split(',')[1] : params.base64Input)
    : undefined;

  const fileHash = cleanBase64 ? calculateFileHash(cleanBase64) : (params.excelCsv ? calculateFileHash(Buffer.from(params.excelCsv)) : undefined);
  const fileSizeBytes = cleanBase64 ? Buffer.from(cleanBase64, 'base64').length : (params.excelCsv ? Buffer.from(params.excelCsv).length : 0);

  // Extract embedded digital text from PDF if available for ultra-fast instant OCR (<300ms)
  let extractedPdfText = '';
  if (cleanBase64 && (params.mimeType === 'application/pdf' || params.fileName?.toLowerCase().endsWith('.pdf'))) {
    try {
      const pdfBuf = Buffer.from(cleanBase64, 'base64');
      const parser = new PDFParse({ data: pdfBuf });
      const parsedPdf = await parser.getText();
      const numPages = parsedPdf?.total || 1;
      await parser.destroy().catch(() => {});
      if (parsedPdf && parsedPdf.text && parsedPdf.text.trim().length > 20) {
        extractedPdfText = parsedPdf.text.trim();
        console.log(`[PDF Fast Parser] PDF dijital metin katmanı başarıyla okundu (${extractedPdfText.length} karakter, ${numPages} sayfa)`);
      }
    } catch (pdfErr: any) {
      console.warn('[PDF Fast Parser Warning] PDF metin katmanı okunamadı, doğrudan görsel OCR uygulanacak:', pdfErr?.message);
    }
  }

  // IF SUMMARY ONLY (INITIAL OFFER / INTERMEDIATE ROUNDS): Fast single pass with light prompt
  if (isSummaryOnly) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const lightPrompt = buildStage1SummaryOnlyPrompt(params.excelCsv, params.additionalPrompt, extractedPdfText);
        const contents: any[] = [];
      if (params.firstOfferBase64) {
        const cleanFirst = params.firstOfferBase64.includes(",") ? params.firstOfferBase64.split(",")[1] : params.firstOfferBase64;
        contents.push({ text: "İLK TEKLİF BELGESİ (Kapsam kontrolü için):" });
        contents.push({
          inlineData: {
            data: cleanFirst,
            mimeType: "application/pdf"
          }
        });
        contents.push({ text: "SON ANLAŞILAN FATURA (Asıl çıkarım buradan yapılacak):" });
      }
        if (cleanBase64 && (!extractedPdfText || extractedPdfText.length < 150)) {
          contents.push({
            inlineData: {
              data: cleanBase64,
              mimeType: params.mimeType || 'application/pdf'
            }
          });
        }
        contents.push({ text: lightPrompt });

        const genResult = await generateContentWithResilience(ai, {
          contents,
          config: { responseMimeType: "application/json" },
          primaryModel: 'gemini-flash-latest'
        });
        usedModel = genResult.usedModel;

        rawExtracted = robustParseJSON(genResult.text || '{}');
        if (rawExtracted && (rawExtracted.totalAmount?.value || rawExtracted.totalAmount)) {
          break;
        }
        retryCount++;
      } catch (err: any) {
        retryCount++;
        if (attempt === 2) {
          if (params.excelCsv) {
            const localExtractedSupplier = fallbackExtractSupplierFromText(params.excelCsv, params.fileName) || 'Tedarikçi Firma';
            const lines = params.excelCsv.split('\n').map(l => l.trim()).filter(Boolean);
            let sumTotal = 0;
            lines.slice(1).forEach(line => {
              const parts = line.split(',').map(p => p.trim());
              if (parts.length >= 2) {
                const qty = parseFloat(parts[1]) || 1;
                const price = parseFloat(parts[3]) || 0;
                const lineTotal = parseFloat(parts[4]) || (qty * price);
                sumTotal += lineTotal;
              }
            });

            rawExtracted = {
              documentType: 'offer',
              supplier: { value: localExtractedSupplier, confidence: 0.8 },
              invoiceNumber: { value: `TKF-${Date.now().toString().slice(-6)}`, confidence: 0.7 },
              date: { value: new Date().toISOString().split('T')[0], confidence: 0.8 },
              currency: { value: 'RUB', confidence: 0.8 },
              totalAmount: { value: sumTotal, confidence: 0.8 },
              category: 'İnşaat Malzemesi',
              summary: 'İlk teklif listesi toplam tutarı.',
              items: []
            };
            usedModel = 'local-resilient-parser';
            break;
          }
          throw new Error('İlk teklif üst bilgileri okunurken yapay zeka servisine ulaşılamadı.');
        }
      }
    }

    if (!rawExtracted) {
      throw new Error('İlk teklif özeti çıkarılamadı. Lütfen tekrar deneyin.');
    }

    const resolvedSupplier = 
      extractSupplierName(rawExtracted.supplier) ||
      extractSupplierName(rawExtracted.vendorName) ||
      extractSupplierName(rawExtracted.company) ||
      extractSupplierName(rawExtracted.seller) ||
      fallbackExtractSupplierFromText(params.excelCsv, params.fileName) ||
      'Tedarikçi Firma';

    const finalSummaryExtracted: any = {
      documentType: rawExtracted.documentType || 'offer',
      supplier: resolvedSupplier,
      vendorName: resolvedSupplier,
      company: resolvedSupplier,
      seller: resolvedSupplier,
      taxId: extractStringSafe(rawExtracted.taxId),
      invoiceNumber: extractStringSafe(rawExtracted.invoiceNumber),
      date: extractStringSafe(rawExtracted.date, new Date().toISOString().split('T')[0]),
      currency: extractStringSafe(rawExtracted.currency, 'RUB'),
      subtotal: parseNumberSafe(rawExtracted.subtotal?.value ?? rawExtracted.subtotal ?? rawExtracted.totalAmount?.value ?? rawExtracted.totalAmount ?? 0),
      discount: 0,
      tax: 0,
      totalAmount: parseNumberSafe(rawExtracted.totalAmount?.value ?? rawExtracted.totalAmount ?? 0),
      itemCount: parseNumberSafe(rawExtracted.itemCount?.value ?? rawExtracted.itemCount ?? rawExtracted.itemsCount ?? (Array.isArray(rawExtracted.items) ? rawExtracted.items.length : 0)),
      category: rawExtracted.category || 'İnşaat Demiri & Çelik',
      summary: rawExtracted.summary || 'İlk teklif özeti (hızlı okuma)',
      items: [], // INTENTIONALLY EMPTY: Saves memory, speed, token and CPU!
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

  // AŞAMA 1: HAM VERİ ÇIKARMA (Resilient generator with fallback and backoff for FULL ITEM EXTRACTION)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const stage1Prompt = buildStage1ExtractionPrompt(params.excelCsv, params.additionalPrompt, extractedPdfText, !!params.firstOfferBase64);
      const contents: any[] = [];
      if (params.firstOfferBase64) {
        const cleanFirst = params.firstOfferBase64.includes(",") ? params.firstOfferBase64.split(",")[1] : params.firstOfferBase64;
        contents.push({ text: "İLK TEKLİF BELGESİ (Kapsam kontrolü için):" });
        contents.push({
          inlineData: {
            data: cleanFirst,
            mimeType: "application/pdf"
          }
        });
        contents.push({ text: "SON ANLAŞILAN FATURA (Asıl çıkarım buradan yapılacak):" });
      }
      if (cleanBase64 && (!extractedPdfText || extractedPdfText.length < 150)) {
        contents.push({
          inlineData: {
            data: cleanBase64,
            mimeType: params.mimeType || 'application/pdf'
          }
        });
      }
      contents.push({ text: stage1Prompt });

      const genResult = await generateContentWithResilience(ai, {
        contents,
        config: { responseMimeType: "application/json" },
        primaryModel: 'gemini-flash-latest'
      });
      usedModel = genResult.usedModel;

      rawExtracted = robustParseJSON(genResult.text || '{}');
      if (rawExtracted && (rawExtracted.totalAmount?.value || rawExtracted.items?.length)) {
        break; // Successfully extracted
      }
      retryCount++;
    } catch (err: any) {
      retryCount++;
      if (attempt === 2) {
        // If Excel CSV is available, provide local rule-based structured extraction as resilient fallback
        if (params.excelCsv) {
          console.log('[AI OCR Fallback] AI geçici olarak yanıt vermedi, yerel CSV ayrıştırıcı devreye alındı.');
          const lines = params.excelCsv.split('\n').map(l => l.trim()).filter(Boolean);
          const fallbackItems: any[] = [];
          let sumTotal = 0;

          lines.slice(1).forEach((line, idx) => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length >= 2) {
              const name = parts[0] || `Kalem ${idx + 1}`;
              const qty = parseFloat(parts[1]) || 1;
              const unit = parts[2] || 'Adet';
              const price = parseFloat(parts[3]) || 0;
              const lineTotal = parseFloat(parts[4]) || (qty * price);
              sumTotal += lineTotal;
              fallbackItems.push({
                materialName: name,
                originalName: name,
                category: 'Diğer Malzeme',
                quantity: qty,
                unit: unit,
                unitPrice: price,
                totalPrice: lineTotal,
                confidence: 0.8
              });
            }
          });

          const localExtractedSupplier = fallbackExtractSupplierFromText(params.excelCsv, params.fileName) || 'Tedarikçi Firma';

          rawExtracted = {
            documentType: 'invoice',
            supplier: { value: localExtractedSupplier, confidence: 0.8 },
            vendorName: { value: localExtractedSupplier, confidence: 0.8 },
            invoiceNumber: { value: `EXC-${Date.now().toString().slice(-6)}`, confidence: 0.7 },
            date: { value: new Date().toISOString().split('T')[0], confidence: 0.8 },
            currency: { value: 'TL', confidence: 0.8 },
            totalAmount: { value: sumTotal, confidence: 0.8 },
            subtotal: { value: sumTotal, confidence: 0.8 },
            tax: { value: 0, confidence: 0.8 },
            items: fallbackItems,
            overallConfidence: 0.8
          };
          usedModel = 'local-resilient-parser';
          break;
        }

        throw new Error('Yapay zeka servisleri şu anda yoğun talep altında. Lütfen birkaç saniye sonra tekrar deneyin veya Excel formatında yükleyin.');
      }
    }
  }

  if (!rawExtracted) {
    throw new Error('Ham Veri Çıkarma ve Standartlaştırma tamamlanamadı. Lütfen tekrar deneyin.');
  }

  // AŞAMA 2 (İptal Edildi - Tek adımda gemini-3.7-flash ile çözüldü)
  // Hızlandırma amacıyla Stage 1'de hem çıkarma hem çeviri birleştirildi
  standardized = rawExtracted;
  if (!standardized.items) {
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
    fallbackExtractSupplierFromText(params.excelCsv, params.fileName) ||
    'Tedarikçi Firma';

  const finalExtracted: any = {
    documentType: standardized.documentType || rawExtracted.documentType || 'invoice',
    supplier: resolvedSupplier,
    vendorName: resolvedSupplier,
    company: resolvedSupplier,
    seller: resolvedSupplier,
    taxId: extractStringSafe(standardized.taxId) || extractStringSafe(rawExtracted.taxId),
    invoiceNumber: extractStringSafe(standardized.invoiceNumber) || extractStringSafe(rawExtracted.invoiceNumber),
    date: extractStringSafe(standardized.date) || extractStringSafe(rawExtracted.date, new Date().toISOString().split('T')[0]),
    currency: extractStringSafe(standardized.currency) || extractStringSafe(rawExtracted.currency, 'RUB'),
    subtotal: parseNumberSafe(standardized.subtotal?.value ?? standardized.subtotal ?? rawExtracted.subtotal?.value ?? 0),
    discount: parseNumberSafe(standardized.discount?.value ?? standardized.discount ?? rawExtracted.discount?.value ?? 0),
    tax: parseNumberSafe(standardized.tax?.value ?? standardized.tax ?? rawExtracted.tax?.value ?? 0),
    totalAmount: parseNumberSafe(standardized.totalAmount?.value ?? standardized.totalAmount ?? rawExtracted.totalAmount?.value ?? 0),
    scopeDeductionAmount: parseNumberSafe(standardized.scopeDeductionAmount?.value ?? standardized.scopeDeductionAmount ?? rawExtracted.scopeDeductionAmount?.value ?? rawExtracted.scopeDeductionAmount ?? 0),
    scopeDeductionReason: standardized.scopeDeductionReason?.value ?? standardized.scopeDeductionReason ?? rawExtracted.scopeDeductionReason?.value ?? rawExtracted.scopeDeductionReason ?? '',
    items: (standardized.items || rawExtracted.items || []).map((it: any) => {
      let rawName = it.materialName || it.originalName || 'Malzeme Kalemi';
      let origName = it.originalName || it.materialName || '';
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

      return {
        materialName: rawName,
        originalName: origName,
        category: normalizeCategoryName(cat, `${rawName} ${origName}`),
        quantity: parseNumberSafe(it.quantity) || 1,
        unit: it.unit || 'Adet',
        unitPrice: parseNumberSafe(it.unitPrice) || 0,
        totalPrice: parseNumberSafe(it.totalPrice) || (parseNumberSafe(it.quantity || 1) * parseNumberSafe(it.unitPrice || 0)),
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
    }),
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
