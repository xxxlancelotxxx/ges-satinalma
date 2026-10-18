# Prizma Fatura PDF Okuma Motoru, AI Yedek Okuyucu ve Kalınlık Bazlı Ürün Ayrıştırma Planı

Prizma'dan gelen faturaların yanlış okunması, KDV durumunun tespit edilememesi, taranmış PDF'lerin STF'deki bozuk birim/miktar verisine düşmesi ve farklı kalınlıktaki yalıtım levhalarının tek kalemde birleştirilmesi sorunlarını kalıcı olarak çözen mimari plan aşağıdadır.

---

## 1. Tespit Edilen Kök Nedenler ve Kalıcı Çözümler

### A. PDF KDV (НДС) ve Dip Toplam Okuma Hatası (218 Prizma Faturası)
- **Sorun:** `src/utils/invoiceLineParser.ts` içerisindeki `detectVatIncluded` fonksiyonu, Rusça 1C faturalarında çok yaygın olan `В том числе НДС:` (KDV dahil), `Итого НДС`, `Сумма НДС` ve `Всего к оплате` ifadelerini yakalayamıyordu. Bu nedenle 218 faturada `vatIncluded = null` dönüyor ve `server/invoiceDocumentLines.ts` KDV durumu belirsiz olduğu için gerçek PDF kalemlerini (`9.675,00 ₽ / m³`) çöpe atıp Prizma STF'nin bozuk verisine (`806,25 ₽`) geri dönüyordu.
- **Kalıcı Çözüm:**
  - `detectVatIncluded` fonksiyonu tüm Rusça/Türkçe fatura dipnot formatlarını (`в том числе ндс`, `итого ндс`, `сумма ндс`, `без налога (ндс)`, `ндс не облагается`, tablo başlıklarında `цена с ндс` / `цена без ндс` + dip toplam eşleşmesi) kapsayacak şekilde güncellenecek.
  - Satır toplamlarının (`Σ satır tutarı`) faturanın genel toplamına (`Всего к оплате` / `Итого`) matematiksel yakınlığı kontrol edilerek KDV'nin satır fiyatlarına dahil olup olmadığı otomatik doğrulanacak.
  - `extractGrandTotalFromText` fonksiyonunda ağırlık toplamlarını (`Всего наименований 4, на сумму...` veya `Масса брутто`) para toplamı sanan regex hatası giderilecek.

### B. Çok Satırlı ve Farklı Sütun Düzenli PDF Tablolarının Okunamaması (177 Prizma Faturası)
- **Sorun:** Bazı tedarikçi faturalarında (ör. `BTF.032246`, `BTF.032372`, `BTF.032228`) sıra numarası ile ürün adı bitişik yazılmakta (`1Гидроизоляционная...`), birimler noktalı/bileşik gelmekte (`пог. м`, `м.п.`, `уп.`, `компл`, `тыс. шт`) veya miktar ile birim sütunu yer değiştirmektedir (`шт 300`).
- **Kalıcı Çözüm:**
  - `src/utils/invoiceLineParser.ts` satır ayrıştırıcısı; bitişik sıra numaralarını, bileşik Rusça/Türkçe ölçü birimlerini (`м3`, `м2`, `м.п.`, `пог. м`, `кв. м`, `куб. м`, `уп`, `рул`, `компл`, `пач`), 6+ sütunlu (KDV hariç fiyat + KDV dahil fiyat birlikte bulunan) tabloları ve `Birim -> Miktar` ters dizilimini tam doğrulukla okuyacak şekilde genişletilecek.

### C. Taranmış (Resim) PDF'ler İçin Gemini AI Okuma Katmanı ve Doğrulama Kilidi
- **Sorun:** Taranmış (metin katmanı olmayan) PDF'lerde veya PDF metni bozuk olan belgelerde sistem doğrudan Prizma STF satırlarını kullanıyordu. STF'de m³ yerine paket fiyatı veya hatalı miktar girildiğinde tüm piyasa analizi ve anomali motoru yanılıyordu.
- **Kalıcı Çözüm:**
  - `server/invoiceDocumentLines.ts` içerisine **Gemini (`gemini-2.5-flash`) PDF Okuma Yedek Katmanı** eklenecek: Metin tabanlı ayrıştırıcı kalem bulamadığında veya toplam doğrulaması (`status !== 'verified'`) başarısız olduğunda, PDF dosyası doğrudan Gemini'ye (`application/pdf` inlineData olarak) gönderilerek kalemler, birimler (`m³`, `m²`, `paket` vb.), birim fiyatlar ve KDV durumu yapılandırılmış JSON olarak çıkarılacak ve önbelleğe (`prizma_invoice_doc_lines.json` + Firestore) kaydedilecek.
  - **Kesin Doğrulama Kilidi:** Hem metin ayrıştırıcı hem de AI okuyucu sonrasında hala doğrulanamayan (`lineCheck.status !== 'verified'` veya belge eki hiç olmayan) Prizma STF kayıtları `isPdfVerified: false` olarak işaretlenecek ve **Anomali Teşhisi, Piyasa Analizi ve Yapay Zeka Karar Masası fiyat kıyaslamalarından tamamen hariç tutulacak.**

### D. Taşyünü / Yalıtım Levhalarında Kalınlık ve Birim Birleştirme Hatasının Kaldırılması
- **Sorun:** `server.ts` (satır 3615-3625) içindeki sabit kural, tüm `Технофас Оптима` ve `Техноблок Стандарт` ürünlerini kalınlığına bakmaksızın `1200x600x100 mm` altında birleştiriyor ve 1.000 ₽ altındaki fiyatları farklı bir ürüne çeviriyordu. Bu yüzden `Fatura 969` (`180 mm`, `9.675 ₽/m³`) ile `Fatura 923` (`100 mm`, `9.675 ₽/m³`) yanlış şekilde aynı kalemde ve yanlış fiyatla kıyaslanıyordu.
- **Kalıcı Çözüm:**
  - `server.ts` içindeki kalınlık ezen ve fiyata göre ürün adı değiştiren hatalı sabit kural kaldırılacak.
  - Ürün adı standartlaştırma fonksiyonu (`canonicalizeMaterialName` ve `dualMaterialComparisonEngine.ts`), ürün adındaki veya PDF kalemindeki gerçek ölçüleri (`1200x600x100 mm`, `1200x600x180 mm`, `1200x600x50 mm` vb.) ve yoğunluk bilgisini (`110 kg/m³`, `45 kg/m³`) koruyarak **her kalınlığı kendi içinde ayrı bir kalem olarak** gruplayacak.
  - Ayrıca aynı kalınlıktaki ürünlerde `paket (уп)` veya `m²` cinsinden girilmiş fatura satırları varsa, boyut bilgisinden (`1200x600x100 mm`) `m³` karşılığı hesaplanacak ya da farklı birimler birbirine karıştırılmadan kendi birim grubunda kıyaslanacak.

---

## 2. Etkilenecek Dosyalar
1. **`src/utils/invoiceLineParser.ts`**: Rusça/Türkçe KDV tespiti (`detectVatIncluded`), genel toplam ayıklama (`extractGrandTotalFromText`) ve çok sütunlu/bileşik birimli PDF tablo satırı ayrıştırma motorunun güncellenmesi.
2. **`server/invoiceDocumentLines.ts`**: Doğrulanamayan veya taranmış Prizma PDF'leri için Gemini (`gemini-2.5-flash`) tabanlı PDF okuma yedek katmanının eklenmesi; bozuk önbellek kayıtlarının yenilenmesi ve doğrulanmış PDF kalemlerinin (`m³` birim ve gerçek birim fiyat) fatura kalemlerine tam aktarılması.
3. **`server.ts`**:
   - Taşyünü kalınlıklarını (`100 mm`, `180 mm` vb.) ezen hatalı sabit kuralın kaldırılması, her kalınlığın kendi ölçüsüyle ayrı kalem olarak korunması.
   - `/api/materials/compare` ve fiyat geçmişi hesaplamalarında doğrulanmamış Prizma STF satırlarının (`lineCheck.status !== 'verified'`) fiyat anomalisi ve en ucuz/en pahalı kıyaslamalarını bozmasının engellenmesi.
4. **`src/utils/dualMaterialComparisonEngine.ts` & `src/components/ProcurementAnomalyAlerts.tsx`**:
   - Doğrulanmamış Prizma STF kayıtlarının anomali ve fiyat farkı hesaplamalarından hariç tutulması.
   - Kalınlık bilgilerinin (`100 mm` vs `180 mm`) eşleştirme anahtarında (`specKey`) kesin ayrım kriteri olarak korunması.

---

## 3. Doğrulama ve Test Adımları
- Önbellekteki hatalı Prizma PDF analiz kayıtları yeniden işlenerek `BTF.034236` (Fatura 969 - `180 mm`, `9.675 ₽/m³`) ve `BTF.032868` (Fatura 923 - `100 mm`, `9.675 ₽/m³`) dahil tüm Prizma faturalarının doğru birim fiyat ve doğru kalınlıkla ayrıştığı doğrulanacak.
- `tsc --noEmit`, `npm run build` ve `/api/health` (`invoices: 1059, discounts: 253`) kontrolleri eksiksiz teyit edilecek.
