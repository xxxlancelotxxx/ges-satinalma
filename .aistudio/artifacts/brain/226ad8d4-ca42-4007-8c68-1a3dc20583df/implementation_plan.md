# OCR Fatura Kalem Ayrıştırma Hatası Kalıcı Çözümü ve Mevcut Kayıtların Onarım Planı

Rusça faturalarda (ör. Fatura 3987 ve Fatura 3971) malzeme tablosu yerine firma, vergi numarası (`ИНН`/`КПП`) ve adres satırlarının malzeme kalemi olarak kaydedilmesine yol açan OCR ayrıştırma hatasını kalıcı olarak giderir ve sistemdeki mevcut hatalı faturaları orijinal PDF belgelerinden gerçek tablo satırlarını okuyarak otomatik onarır.

## User Review & Critical Decisions

> [!IMPORTANT]
> Kullanıcımızla yapılan netleştirme doğrultusunda alınan kararlar aşağıda özetlenmiştir:

- **Onaylanan Karar 1 (Mevcut Hatalı Faturaların Onarımı)**: Firma ve adres bilgilerini malzeme kalemi gibi kaydetmiş olan mevcut faturalar (Fatura 3987, 3971 vb.), sistemdeki orijinal PDF belgelerinden gerçek tablo satırları okunarak otomatik olarak onarılacaktır.
- **Onaylanan Karar 2 (Son 1 Saatte Yüklenen Eski Tarihli 6 Fatura)**: Son 1 saatte yüklenen ancak fatura tarihi Ekim 2026 öncesi (Mart, Temmuz, Ağustos 2026) olan ve şef indirimi bağlantısı bulunmayan 6 adet eski tarihli fatura da kalemleri onarıldıktan sonra Çöp Kutusuna taşınacaktır.

---

## 1. Overview & Core Concept

- **Ne Yapar**: Çok sütunlu Rusça 1С faturalarında `% НДС` (`22%`, `20%`, `Без НДС`) ve `Вес` (`0`) sütunlarını deterministik tablo okuyucuya tanıtır; düz PDF metinlerinin adres/ondalık virgüllerinden bölünerek sahte kalem üretmesini engeller ve mevcut hatalı faturaların kalem listelerini orijinal PDF tablolarından birebir onarır.
- **Hedef Kullanıcılar**: Satınalma şefleri, satınalma personeli ve maliyet kontrol ekibi.
- **Temel Kazanım**: Fatura kalem toplamlarının fatura genel toplamıyla (`Σ satır_toplamı = fatura_toplamı`) kuruşu kuruşuna eşleşmesi ve GES Arşivinde sıfır adres/üst bilgi gürültüsü.

---

## 2. User Experience & Visual Design

- **Temel Kullanıcı Akışı**:
  1. Kullanıcı bir Rusça PDF faturayı sisteme yüklediğinde veya mevcut Fatura 3987 detayını açtığında, üst bilgi (`Поставщик`, `Грузоотправитель`, `Покупатель`, `Грузополучатель`, `ИНН`, `КПП`, adres) satırları kesin olarak dışlanır.
  2. Tablo içerisindeki gerçek malzeme kalemleri (ör. Fatura 3987 için `Коврик-травка` `3 Rulo × 6.435 ₽ = 19.305 ₽`, `Канализационный насос Oasis ST-600` `1 Adet × 11.800 ₽ = 11.800 ₽`, `Кофе растворимый Nescafe Gold 900г` `30 Adet × 2.500 ₽ = 75.000 ₽`) KDV dahil birim fiyatlarıyla net olarak listelenir.
  3. Fatura detay ekranındaki kalem toplamı uyuşmazlık uyarısı ortadan kalkar (`3 Kalem Malzeme`, toplam `106.105,00 ₽`, fark `0,00 ₽`).
- **Görsel Kimlik ve Tablo Düzeni**:
  - Kurumsal SaaS veri yoğunluğu standartlarına uygun olarak tüm miktar, birim fiyat ve toplam sütunlarında hizalı rakam (`tabular-nums`) disiplini korunur.

---

## 3. Key Product Decisions & Trade-Offs

- **Karar 1: Çok Sütunlu (`% НДС` ve `Вес`) Deterministik PDF Tablo Ayrıştırma**
  - *Seçilen Yaklaşım*: Tablo satırı sonu desenine fiyat sütunları arasında yer alabilen KDV oranı (`22%`, `20%`, `Без НДС`) ve birimden sonra gelebilen tam sayı ağırlık (`Вес`) sütunları ile `ед`, `рул`, `пар`, `упак` birimleri eklenecektir. Ayrıca aynı satırda hem KDV hariç (`Цена без НДС`) hem KDV dahil (`Цена с НДС`) birim fiyat bulunduğunda `miktar × birim_fiyat ≈ satır_toplamı` eşitliğini sağlayan KDV dahil birim fiyat seçilecektir.
  - *Neden*: ТД Поинтер, Системные Решения, М.С.К ve Строительный двор gibi tedarikçilerin 1С faturalarında KDV oranı sütunu fiyat sütunlarının ortasında yer aldığı için önceki desen bu satırları atlamaktaydı.
- **Karar 2: Düz PDF Metninde Virgül (CSV) Bölmesinin Kapatılması ve Üst Bilgi Kara Listesi**
  - *Seçilen Yaklaşım*: Yedek CSV ayrıştırıcı yalnızca gerçek tablo ayırıcıları (`;` veya sekme) içeren verilerde çalışacak; PDF metnindeki adres ve ondalık virgüller sütun ayırıcı olarak kullanılmayacaktır. Ek olarak `Поставщик`, `Грузоотправитель`, `Покупатель`, `Грузополучатель`, `ИНН`, `КПП`, `БИК`, `Сч. №`, sokak/adres ifadeleri ve vergi numarası kaynaklı gerçek dışı miktarları (`miktar >= 1.000.000` ve `birim_fiyat = 0`) reddeden koruma katmanı eklenecektir.
  - *Neden*: Deterministik okuyucu satır bulamadığında düz PDF metninin virgüllerden bölünmesi, posta kodlarını fiyata ve vergi numaralarını miktara dönüştürmekteydi.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        PDF Fatura Metin Katmanı                          │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│            1. Deterministik PDF Tablo Okuyucu (Çok Sütunlu)              │
│  • Çok satırlı sıra no + ürün kodu ("1 100968") satır birleştirme        │
│  • "% НДС" (22%, 20%, Без НДС) ve "Вес" (0) ara sütun desteği            │
│  • KDV dahil birim fiyat doğrulaması (Miktar × Fiyat ≈ Satır Toplamı)    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│         2. Üst Bilgi / Adres / Vergi No Gürültü Kalkanı (Filtre)         │
│  • Поставщик / Грузоотправитель / Покупатель / ИНН / КПП / Адрес engeli  │
│  • Düz PDF metninde virgülle (,) sahte CSV bölme yasağı                  │
│  • Vergi no kaynaklı sahte miktar (≥ 1.000.000, fiyat = 0) engeli        │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│        3. Firestore Mevcut Fatura Onarımı & Eski Fatura Temizliği        │
│  • Orijinal PDF'lerden (Fatura 3987, 3971 vb.) gerçek kalemlerin onarımı │
│  • Son 1 saatte yüklenen 6 eski tarihli faturanın Çöp Kutusuna taşınması │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Veri Modeli ve Kalem Onarım Akışı**:
  - Firestore'daki aktif ve ilişkili faturalar taranarak kalemlerinde adres/üst bilgi gürültüsü veya toplam uyuşmazlığı bulunan kayıtların orijinal PDF dosyaları okunacak, gerçek tablo kalemleri çıkarılarak `items`, `totalAmount`, `vatAmount` ve `amountWithoutVat` alanları güncellenecektir.
  - Son 1 saatte yüklenen Ekim 2026 öncesi 6 adet fatura (`Mart`, `Temmuz`, `Ağustos 2026`) kalemleri onarıldıktan sonra `isDeleted: true` olarak Çöp Kutusuna taşınacaktır.
