# Kusursuz Fatura Okuma (OCR), Matematiksel Sağlama ve Çok Katmanlı Yedekleme Mimarisi

Fatura yüklendiğinde genel toplamın (`97.081,00 ₽`) doğru okunmasına rağmen kalem birim fiyatlarının yapay zeka tarafından yanlışlıkla `%20 KDV` düşülerek (`13.921 ₽` yerine `11.600,83 ₽`) değiştirilmesi sorununu kalıcı olarak ortadan kaldıran; **Birebir Fatura Fiyatı Standardı**, **Deterministik PDF Tablo & Matematiksel Sağlama Motoru** ve **Kesintisiz Çoklu Model + Dijital Tablo Yedekleme Zinciri** mimarisidir.

---

## Kullanıcı Onaylı Kritik Kararlar

> [!IMPORTANT]
> Aşağıdaki 3 temel mimari karar tercihleriniz doğrultusunda kesinleştirilmiştir:

- **Onaylanan Karar 1 — Birebir KDV Dahil Fatura Fiyatı Standardı:** Onay ekranında ve tüm sistem kayıtlarında kalem birim fiyatları (`Цена`) ve satır toplamları (`Сумма`), faturada yazılı olan **gerçek KDV dahil (В том числе НДС) rakamlarla** (`13.921,00 ₽`, `19.959,00 ₽`, `308,00 ₽` ve satır toplamları `41.763,00 ₽ + 39.918,00 ₽ + 15.400,00 ₽ = 97.081,00 ₽`) birebir aynı olacak şekilde baz alınacaktır. Yapay zekanın faturadaki fiyatı kendi başına `1,20` veya `1,22`'ye bölmesi kesin olarak yasaklanacaktır.
- **Onaylanan Karar 2 — Otomatik Matematiksel Sağlama ve PDF Tablosundan Birebir Eşitleme:** Her fatura okunduğunda `Miktar × Birim Fiyat = Satır Toplamı` ve `Σ(Satır Toplamları) = Fatura Genel Toplamı (97.081,00 ₽)` sağlaması otomatik yapılacak; olası bir AI sapmasında PDF'in dijital metin katmanındaki tablo verileriyle otomatik düzeltilecek, eğer belgede gerçek bir uyuşmazlık varsa kullanıcıya net uyarı gösterilecektir.
- **Onaylanan Karar 3 — Çoklu Gemini Model Zinciri + Deterministik PDF Dijital Tablo Okuyucu:** Kota bitmesi, yoğunluk veya model hatası durumlarında çoklu Gemini model zinciri ve kural tabanlı PDF dijital tablo ayrıştırıcısı birlikte çalışarak sıfır kesinti ve sıfır veri kaybı sağlayacaktır.

---

## 1. Genel Bakış ve Temel Kavram

- **Ne Yapar:** Sisteme yüklenen Rusça (`Счет на оплату`, `УПД`) ve Türkçe fatura/teklif belgelerindeki her bir malzeme kaleminin miktarını, birim fiyatını ve satır toplamını belgedeki **gerçek KDV dahil ödenecek tutarlarla** birebir çıkarır; PDF'in gömülü dijital tablosuyla çapraz doğrulama yapar ve kuruşu kuruşuna genel toplamla eşleşmesini garanti altına alır.
- **Hedef Kullanıcı:** Satınalma şefleri, satınalma uzmanları ve şirket yönetimi.
- **Temel Değer:** Yanlış birim fiyat okunmasından kaynaklanan hatalı fiyat kıyaslamalarını, yanlış indirim hesaplamalarını ve mükerrer/eksik tutar risklerini tamamen sıfırlar.

---

## 2. Kullanıcı Deneyimi ve Görsel Tasarım

- **Adım Adım Kullanıcı Akışı:**
  1. **Belge Yükleme:** Kullanıcı PDF, görsel veya Excel formatındaki faturayı yükler.
  2. **Çift Kanallı Analiz (AI + Dijital Tablo Çapraz Kontrol):** Sunucu aynı anda hem görsel/metinsel AI analizini hem de deterministik PDF tablo ayrıştırıcısını çalıştırır.
  3. **Matematiksel Sağlama ve Otomatik Onarım:** Kalemlerin toplamı (`41.763 + 39.918 + 15.400 = 97.081 ₽`) fatura genel toplamıyla (`97.081 ₽`) karşılaştırılır. AI yanlışlıkla KDV düşmüşse veya bir satırı yanlış okumuşsa, PDF tablo ayrıştırıcısındaki kesin rakamlarla anında düzeltilir.
  4. **Onay Ekranı Gösterimi:** Onay penceresinde her kalemin **Birim Fiyatı (`13.921,00 ₽`, `19.959,00 ₽`, `308,00 ₽`)** ve **Satır Toplamı (`41.763,00 ₽`, `39.918,00 ₽`, `15.400,00 ₽`)** faturadakiyle birebir aynı görünür; tablonun hemen altında **"Matematiksel Sağlama Doğrulandı: 3 Kalem Toplamı = 97.081,00 ₽"** durumu açıkça gösterilir.
- **Görsel Kimlik ve Tema:**
  - *Estetik Yönelim:* Kurumsal finansal denetim ve satınalma kontrol paneli disiplini; yüksek okunabilirlik, tek katmanlı kart yapısı ve net hiyerarşi.
  - *Renk Paleti ve Atmosfer:* Koyu arduvaz (`#0F172A` / `#1E293B`) zemin üzerinde yüksek kontrastlı metinler; doğrulanan matematiksel eşleşmeler için zümrüt yeşili (`#16A34A`), otomatik düzeltilen satırlar için kehribar (`#D97706`) ve tutarsızlık uyarıları için kızıl (`#DC2626`) durum göstergeleri.
  - *Tipografi ve Sayısal Disiplin:* Tüm miktar, birim fiyat, KDV ve toplam sütunlarında hizalı rakamlar (`font-mono tabular-nums`) kullanılarak kuruş ve binlik basamakların dikey hizası korunur.
- **Etkileşimli Geri Bildirim:** Kullanıcı onay ekranında herhangi bir kalemin miktarını veya birim fiyatını değiştirdiğinde satır toplamı ve genel toplam fark kontrolü anlık (`<100ms`) güncellenir.

---

## 3. Temel Ürün Kararları ve Gerekçeleri

- **Karar 1: AI Komutunda (Prompt) KDV Düşme Talimatının Kaldırılması ve Birebir Fatura Fiyatı Zorunluluğu**
  - *Seçilen Yaklaşım:* AI modeline faturadaki `Цена` (Birim Fiyat) ve `Сумма` (Satır Toplamı) sütunlarını **belgede yazdığı gibi (KDV dahil genel toplama eşitlenecek şekilde)** okuması, eğer tabloda hem KDV hariç hem KDV dahil sütun varsa (ör. `УПД` belgeleri) `Всего с НДС` (KDV dahil toplam) sütunundan birim fiyatı (`grossTotalPrice / quantity`) baz alması talimatı verilir.
  - *Neden:* Rusça `Счет на оплату` belgelerinde (ör. `ВсеИнструменты.ру`) tablodaki `Цена` sütunu zaten KDV dahildir (`В том числе НДС`). AI'ya "KDV düş" dendiğinde zaten KDV dahil olan rakamı bir de yanlış oranla (`%22` yerine `%20`) bölerek tamamen hatalı bir birim fiyat üretmektedir.
- **Karar 2: Deterministik Matematiksel Sağlama ve PDF Tablo Eşitleme Motoru**
  - *Seçilen Yaklaşım:* AI yanıtı geldikten hemen sonra çalışan 4 aşamalı deterministik doğrulama katmanı:
    1. **PDF Dijital Tablo Eşleştirme:** PDF'in metin katmanındaki tablo satırları (`№ | Код | Товары | Кол-во | Ед. | Цена | Сумма`) regex ve sütun ayrıştırıcı ile okunur; miktar ve toplamları `97.081,00 ₽` genel toplamını tam veriyorsa, AI'nın çevirdiği malzeme adları ve kategorileri korunarak **fiyat ve miktarlar doğrudan dijital tablodaki kesin rakamlarla kilitlenir**.
    2. **KDV Bölünmesi Tespiti ve Geri Döndürme:** Eğer AI kalem toplamları, fatura genel toplamının `1/1.20` veya `1/1.22`'si kadar (`80.900,83 ₽` vs `97.081,00 ₽`) çıkmışsa, sistem AI'nın yanlışlıkla KDV düştüğünü matematiksel olarak tespit eder ve kalemleri gerçek KDV dahil fatura değerlerine geri döndürür.
    3. **Satır İçi Çarpım Kontrolü:** Her satırda `quantity × unitPrice === totalPrice` eşitliği kontrol edilir; kuruş yuvarlama farkı yoksa birim fiyat `totalPrice / quantity` ile kesinleştirilir.
    4. **Sunucu Kayıt Koruması:** Fatura kaydedilirken kalemlerin toplamı fatura genel toplamına eşitse (`Σ Satır Toplamı === Fatura Toplamı`), fiyatların KDV dahil olduğu kesin kabul edilir ve bir daha sunucu tarafında `1,20` veya `1,22`'ye bölünerek bozulması engellenir.
- **Karar 3: Kota Bitmesi ve Hatalara Karşı Hibrit Çoklu Model + Yerel Dijital Okuyucu**
  - *Seçilen Yaklaşım:* Birincil hızlı modelden (`gemini-3.8-flash`) başlayarak sırasıyla yedek modellere ve karmaşık/uyuşmazlık durumlarında üst seviye `gemini-4-argon` modeline otomatik geçiş yapılır. Tüm API kotaları dolsa veya internet/servis kesintisi yaşansa bile geliştirilmiş **Rusça/Türkçe PDF Dijital Tablo Ayrıştırıcısı** devreye girerek PDF metin katmanından tüm satırları (`MAKITA GA5040C -> 3 шт. × 13 921,00 = 41 763,00` vb.) yerel sözlükle Türkçeleştirip %100 doğru fiyatlarla çıkarır.

---

## 4. Teknik Mimari ve Veri Akışı

### Mimari ve Doğrulama Akış Diyagramı

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BELGE YÜKLEME (PDF / GÖRSEL / EXCEL)                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                   ┌───────────────────┴───────────────────┐
                   ▼                                       ▼
┌─────────────────────────────────────┐ ┌─────────────────────────────────────┐
│   KANAL 1: DİJİTAL TABLO MOTORU     │ │   KANAL 2: ÇOKLU GEMINI AI ZİNCİRİ  │
│ • PDF Metin Katmanı & Excel Okuma   │ │ • 1. Hızlı Model (Flash)            │
│ • Rusça/Türkçe Tablo Satır Analizi  │ │ • 2. Yedek Flash Modelleri          │
│ • Kesin Miktar, Birim Fiyat, Toplam │ │ • 3. Üst Model (Argon - Uyuşmazlık) │
└──────────────────┬──────────────────┘ └──────────────────┬──────────────────┘
                   │                                       │
                   └───────────────────┬───────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             MATEMATİKSEL SAĞLAMA & OTOMATİK ONARIM KATMANI                  │
│ 1. Dijital Tablo Tutar Kontrolü: Σ(PDF Satır Toplamı) == Genel Toplam mı?   │
│    → Evet ise: AI'nın Türkçe isim/kategorisini al, fiyatları PDF'den kilitle│
│ 2. Yanlış KDV Bölme Tespiti: Genel Toplam / Σ(Kalem) ≈ 1.20 veya 1.22 mi?   │
│    → Evet ise: Kalem fiyatlarını KDV dahil gerçek fatura fiyatına geri çevir│
│ 3. Satır Sağlaması: Miktar × Birim Fiyat == Satır Toplamı kontrolü          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ONAY EKRANI & VERİTABANI KAYIT KORUMASI                     │
│ • Onay tablosunda birebir fatura fiyatları (13.921 ₽, 19.959 ₽, 308 ₽)      │
│ • Sağlama Rozeti: "Kalemler Toplamı (97.081 ₽) = Fatura Toplamı (97.081 ₽)" │
│ • Fark varsa açık uyarı ve tek tıkla "Fatura Toplamına Eşitle" aksiyonu     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Veri Modeli ve Etkileşim Eşleştirmesi

- **Kalem Veri Yapısı:** Her fatura kaleminde `unitPrice` ve `totalPrice` alanları doğrudan faturadaki ödenecek KDV dahil birim fiyatı (`13.921,00 ₽`) ve satır toplamını (`41.763,00 ₽`) taşır. Ayrıca arka planda vergi analizi için `vatPercentage` (`22%` — faturadaki `17.506,41 ₽` НДС tutarından otomatik hesaplanan gerçek oran) ve `unitPriceNet` bilgisi saklanır.
- **Onay Pencereleri (İndirim Formu, Fatura Tarayıcı ve Drive Arşivi):** Üç yükleme noktasındaki onay pencerelerinin tamamı aynı doğrulama motoruna bağlanır; kullanıcıya gösterilen birim fiyat ile kaydedilen birim fiyat arasında hiçbir fark oluşmaz ve kalem toplamlarının genel toplama eşitliği canlı olarak denetlenir.
