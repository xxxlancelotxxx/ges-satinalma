# Prizma Fatura Senkronizasyonu & Malzeme Birim Fiyat Kıyaslama Standartlaştırma Planı

> [!WARNING]
> **Karar değişti (2026-10-18, Berkant):** Malzeme fiyat kıyaslamasının tabanı artık **Net değil, %22 KDV DAHİL birim fiyattır** (`src/utils/vatBasis.ts`, `/api/materials/compare` → `priceBasis: 'VAT_INCLUSIVE_22'`). %20/%22 KDV'li satırlar net × 1,22; KDV'siz/muaf satırlar ödenen fiyatla. Net fiyat ekranlarda yalnızca ikinci satırda bilgi olarak gösterilir. Aşağıdaki "Net bazlı kıyaslama" kararları bu notla geçersizdir.
> Ayrıca kalemin net/brüt ayrımı fatura toplamıyla doğrulanır (`vatBasisVerified`); doğrulanmış satırlar faturalar arası "1,20x / 1,22x oran" tahminiyle değiştirilmez.


Bu plan, Prizma ERP'den senkronize edilen faturalar ile satınalma şeflerinin portala girdiği faturalar arasındaki **KDV (НДС %20/%22) ve Nakliye/Hizmet (Доставка / Услуги) kaynaklı birim fiyat uyuşmazlıklarını** kalıcı olarak ortadan kaldırmak, **Malzeme Fiyat Karşılaştırma** ve **Tedarikçi Fiyat Artış & Sapma Paneli** ekranlarında yanıltıcı fiyat artış uyarılarını engellemek ve geçmiş tüm kayıtları geriye dönük otomatik temizlemek için hazırlanmıştır.

---

## Kullanıcı Onayları ve Kritik Kararlar

> [!IMPORTANT]
> **Onaylanan Temel Prensipler (Faz 1 Kararları):**
> - **Confirmed Decision 1 (Standart Fiyat Bazı):** Tüm malzeme birim fiyat kıyaslamalarında, geçmiş alım karşılaştırmalarında ve anomali uyarılarında **Net (KDV Hariç) birim fiyat** esas alınacaktır. Kullanıcı arayüzünde şeffaflık için hem **Net (KDV Hariç)** hem de **Brüt (KDV Dahil)** birim fiyatlar birlikte gösterilecektir.
> - **Confirmed Decision 2 (Nakliye ve Hizmet Ayrıştırması):** Prizma siparişlerinden (STF) gelen veya faturada yer alan nakliye (доставка, транспортные услуги, автоуслуги, манипулятор), kesim (резка), yükleme/boşaltma (погрузка/разгрузка) ve kiralama bedelleri malzeme birim fiyatına **kesinlikle dahil edilmeyecek**, ayrıştırılarak kıyaslama dışına çıkarılacaktır.
> - **Confirmed Decision 3 (Geriye Dönük Otomatik Veri Temizliği):** Mevcut veritabanındaki geçmiş Prizma ve sistem faturaları (ör. Fatura 671'de `2.513,34 ₽` Net yerine KDV+Nakliye eklenerek `3.066,27 ₽` görünen kalemler dahil) taranarak otomatik olarak temizlenecek ve gerçek Net birim fiyatlarına kavuşturulacaktır.

---

## 1. Genel Bakış ve Kök Neden Analizi

### Tespit Edilen Kök Nedenler (Örn: Fatura 671 — `2.513,34 ₽` vs `3.066,27 ₽`)
1. **KDV Dahil / KDV Hariç Karışıklığı:** Fatura üzerinde `Сэндвич-панель ПВХ 10мм` kaleminin KDV hariç net birim fiyatı **`2.513,34 ₽`** (30 adet = `75.400,20 ₽` Net) iken, %22 KDV eklendiğinde kalem toplamı `91.988,24 ₽`, birim fiyatı ise **`3.066,27 ₽`** (`2.513,34 × 1,22 = 3.066,2748 ₽`) olmaktadır. Satınalma şefinin girdiği kayıtta Net birim fiyat (`2.513,34 ₽`) baz alınırken, Prizma/fatura eşleştirmesinde KDV dahil birim fiyat veya nakliye (`6.000 ₽`) eklenmiş toplam tutar birim fiyata bölündüğü için sistem aynı malzemeyi **%22 zamlı alınmış gibi** algılamaktadır.
2. **Prizma STF ve BTF Toplam Tutar Dağıtımı:** Prizma senkronizasyonunda veya fatura satır eşleştirmesinde, faturanın genel toplamı (`invoiceAmount` - KDV ve nakliye dahil) kalem miktarlarına bölündüğünde veya STF satırındaki `price` alanı KDV dahil girildiğinde birim fiyat şişmektedir.
3. **Nakliye / Hizmet Satırlarının Kalem Maliyetine Yansıması:** Bazı tedarikçi faturalarında ayrı satır olan `Доставка` (Nakliye - örn. `6.000 ₽`) tutarı malzeme kalemleriyle birleştirildiğinde veya malzeme sepetine dağıtıldığında sahte fiyat sapması oluşmaktadır.

### Çözümün Sağlayacağı Değer
- **%100 Elma-Elma Net Fiyat Kıyaslaması:** Aynı malzemenin Prizma'dan veya manuel girişten gelmesi fark etmeksizin her zaman **Net (KDV Hariç, Nakliye Hariç)** birim fiyatı üzerinden kıyaslanması sağlanır.
- **Sıfır Yanlış Alarm:** Tedarikçi Fiyat Artış & Sapma Paneli ve Malzeme Fiyat Kıyaslama tablolarında KDV veya nakliye farkından kaynaklanan yanıltıcı kırmızı uyarılar tamamen ortadan kalkar.
- **Çift Katmanlı Fiyat Şeffaflığı:** Tablolarda ve detay pencerelerinde hem **Net Birim Fiyat** hem de **KDV Dahil Birim Fiyat (%20 / %22 НДС)** açıkça gösterilir.

---

## 2. Kullanıcı Deneyimi ve Görsel Tasarım (UX & UI)

### A. Malzeme Fiyat Karşılaştırma & Tedarikçi Sapma Paneli Gösterimi
- **Net Bazlı Birim Fiyat Sütunu:** Kıyaslama tablolarında ana birim fiyat olarak **Net Birim Fiyat (`2.513,34 ₽`)** vurgulanır; hemen altında ikincil bilgi olarak **KDV Dahil (`3.066,27 ₽ • %22 KDV`)** değeri tabular-nums (`font-mono tabular-nums`) disipliniyle gösterilir.
- **Nakliye Hariç Tutuldu Rozeti / Bilgisi:** Faturada ayrıştırılan nakliye veya hizmet kalemi varsa, fatura detayında *"Nakliye / Hizmet Bedeli (6.000,00 ₽) malzeme birim fiyat kıyaslamasından hariç tutulmuştur"* şeklinde net bilgi satırı yer alır.
- **Geçmiş Veri Doğrulama & Otomatik Onarım Butonu:** Veri yönetimi ve Prizma senkronizasyon barında tüm geçmiş faturaları tek tıkla (veya sayfa açılışında otomatik) denetleyip düzelten bir doğrulama göstergesi bulunur.

### B. Görsel Kimlik ve Tablo Düzeni
- **Tipografi ve Sayısal Hizalama:** Tüm birim fiyatlar, miktarlar, KDV oranları ve sapma yüzdeleri `tabular-nums` ile dikeyde kusursuz hizalanır.
- **Renk ve Durum Kodlaması:**
  - Gerçek fiyat düşüşleri ve sabit fiyatlar (`%0,0 Fark`): Zümrüt yeşili (`#16A34A`) ve nötr arduvaz (`#475569`).
  - Gerçek net fiyat artışları: Kehribar (`#D97706`) ve Koyu Kırmızı (`#DC2626`).

---

## 3. Temel Mimari Kararlar ve Algoritmik Kurallar

### Karar 1: Deterministik Net Birim Fiyat Normalizasyon Motoru (`normalizeItemNetPrice`)
- **Yaklaşım:** Her fatura kalemi için `unitPriceNet` (KDV Hariç) ve `unitPriceGross` (KDV Dahil) alanları hesaplanır:
  1. Eğer kalemde veya faturada `vatPercentage` (`20` veya `22`) tanımlıysa ve birim fiyat KDV dahil (`priceIncludesVat` veya Rus faturasında `Сумма с НДС / Количество`) olarak gelmişse, Net fiyat `unitPrice / (1 + vatRate / 100)` formülüyle ayrıştırılır.
  2. **Çapraz Tarihsel Doğrulama (Smart VAT Ratio Detector):** Aynı tedarikçi veya aynı malzeme ailesinde önceki Net alım fiyatı $P_{\text{prev}}$ ile yeni alım fiyatı $P_{\text{new}}$ arasındaki oran tam olarak **1,20 ($\pm\%0,5$)** veya **1,22 ($\pm\%0,5$)** ise (örneğin `3.066,27 / 2.513,34 = 1,22000`), sistem bu satırın KDV dahil kaydedildiğini matematiksel olarak tespit eder ve Net fiyatı otomatik olarak `2.513,34 ₽` seviyesine normalize eder.
- **Neden:** Rusya'da 2025/2026 vergi geçişleriyle %20 ve %22 НДС oranları faturalarda bazen birim fiyata dahil, bazen hariç yazılmaktadır. Matematiksel oran + KDV kolonu kontrolü %100 kesinlik sağlar.

### Karar 2: Nakliye, Kesim ve Hizmet Kalemlerinin Sıfır Toleransla Ayrıştırılması
- **Yaklaşım:**
  1. Hem Prizma STF satırlarında hem de OCR/PDF fatura okumalarında `доставка`, `транспортн`, `автоуслуг`, `перевозк`, `манипулятор`, `логистик`, `погруз`, `разгруз`, `резка`, `рубка`, `услуг`, `аренда`, `nakliye`, `teslimat`, `kargo` içeren satırlar **Malzeme Kıyaslama Havuzundan** tamamen çıkarılır.
  2. Fatura genel toplamı (`totalAmount`), malzeme satırlarının birim fiyatını yeniden hesaplamak için **asla** malzeme miktarına bölünmez; böylece faturadaki `6.000 ₽` nakliye bedelinin malzeme birim fiyatını şişirmesi imkansız hale gelir.

### Karar 3: Geçmiş Veritabanı Kayıtlarının Otomatik Taranması ve Düzeltilmesi (Retroactive Sanitizer)
- **Yaklaşım:** Sunucu başlatıldığında ve `/api/prizma/sanitize-history` (veya senkronizasyon) tetiklendiğinde:
  - Firestore'daki `invoices` (255 aktif fatura referans sayısını koruyarak) ve `prizma_invoices` koleksiyonlarındaki tüm kalemler taranır.
  - İçinde nakliye/hizmet satırı barındıran veya KDV dahil birim fiyatı Net fiyatmış gibi kaydedilen kalemler (Fatura 671 dahil) otomatik düzeltilir ve önbellek (`memoryCache` + `cleanListCache`) yenilenir.
  - `AGENTS.md` kuralı gereği aktif fatura sayısı (**invoices: 255, discounts: 88**) asla değiştirilmez; yalnızca fatura içindeki hatalı kalem birim fiyatları ve Prizma eşleşmeleri onarılır.

---

## 4. Teknik Mimari ve Veri Akış Diyagramı

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   VERİ GİRİŞ KAYNAKLARI (PRIZMA & PORTAL)                  │
│  1. Prizma ERP STF/BTF Senkronizasyonu   2. AI OCR & Satınalma Şefi Girişi │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│         1. NAKLİYE & HİZMET FİLTRESİ (Zero-Freight Isolation Layer)        │
│  • "Доставка / Транспорт / Резка / Погрузка / Nakliye" satırlarını ayır    │
│  • Fatura genel toplamındaki (totalAmount) nakliye payını malzemeye katma  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│       2. NET / KDV DAHİL BİRİM FİYAT NORMALİZASYON MOTORU (VAT Engine)     │
│  • Kalem KDV Oranı (%20 / %22 НДС) ve Net/Brüt Tutar Kontrolü              │
│  • Çapraz Tarihsel Oran Tespiti (1.20x / 1.22x KDV Dahil Sapma Yakalayıcı) │
│  • Çıktı: unitPrice (Net: 2.513,34 ₽) + grossUnitPrice (Brüt: 3.066,27 ₽)  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│          3. GERİYE DÖNÜK VERİTABANI ONARIMI (Retroactive Sanitizer)        │
│  • Firestore `prizma_invoices` ve `invoices` kalemlerini tarar ve onarır   │
│  • Sistem sağlık sayılarını korur (invoices: 255, discounts: 88)           │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                4. KULLANICI EKRANLARI (SSOT Kıyaslama Motoru)              │
│  • Malzeme Fiyat Karşılaştırma: Net bazda kıyaslama + Brüt fiyat gösterimi │
│  • Tedarikçi Fiyat Artış & Sapma Paneli: Sıfır sahte alarm (%0,0 Fark)     │
└────────────────────────────────────────────────────────────────────────────┘
```

### Etkileşimli Bileşen ve Durum Eşleşmesi
1. **Sunucu Kıyaslama ve Senkronizasyon Motoru:**
   - Prizma STF satırlarını çekerken `price`, `amount`, `totalWithVat` ve `vatPercentage` alanlarını kontrol ederek her zaman **KDV Hariç Net Birim Fiyatı** (`unitPrice`) ve **KDV Dahil Brüt Birim Fiyatı** (`grossUnitPrice`) ayrı ayrı kaydeder.
   - Geriye dönük onarım fonksiyonu, mevcut tüm faturalarda KDV dahil yazılmış birim fiyatları ve nakliye satırlarını temizler.
2. **AI OCR Fatura Okuma Motoru:**
   - Rusça faturalarda (`Счет на оплату` / `УПД`) tablodaki `Цена без НДС` (KDV Hariç Birim Fiyat) sütununu birincil `unitPrice` olarak alır; fatura sadece KDV dahil birim fiyat içeriyorsa alt toplamdan KDV oranını (%20 veya %22) düşerek Net birim fiyatı hesaplar ve nakliye (`Доставка`) satırlarını malzeme listesinden hariç tutar.
3. **Malzeme Kıyaslama ve Sapma Panelleri:**
   - Kıyaslama hesaplamalarını (`minUnitPrice`, `maxUnitPrice`, `avgUnitPrice`, `priceDifferencePercentage`) **%100 Net Birim Fiyat** üzerinden yapar.
   - Tablo hücrelerinde Net fiyatın yanında KDV dahil fiyatı da bilgilendirme olarak sunar.
