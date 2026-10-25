# Anomali Teşhisi, Piyasa Analizi ve Fatura İçi Fiyat Birebir Eşitleme Planı

Anomali Teşhisi, Piyasa Analizi ve Fatura Geçmişi tablolarında görünen birim fiyatlar ile **"Fatura Gör"** butonuna tıklandığında açılan fatura detay ekranındaki birim fiyatların tüm sistem genelinde (%100 doğrulukla) birebir eşleşmesini sağlar ve Prizma ERP faturalarının gerçek içerik ve PDF belgeleriyle açılmasını kalıcı olarak çözer.

## Kullanıcı Onayı ve Kritik Kararlar

> [!IMPORTANT]
> Sistem genelinde yapılan canlı veri denetiminde (467 GES Arşivi faturası, 634 Prizma ERP faturası ve 3.416 malzeme geçmişi satırı) XPS Carbon Prof 100 mm örneğindeki gibi tablo fiyatı (`7.487,04 ₽` / `7.000,00 ₽`) ile fatura detay ekranı (`7.553,25 ₽`) arasındaki farkın nedenleri tespit edilmiş ve aşağıdaki kararlar doğrultusunda kalıcı çözüm kurgulanmıştır:

- **Onaylanan Karar 1 (Fiyat Bazı)**: Anomali ve fiyat geçmişi tablolarında yapay `%20 -> %22` KDV yeniden ölçeklemesi yapılmayacak; faturadaki **gerçek KDV dahil ödenen birim fiyat** birebir gösterilecektir.
- **Onaylanan Karar 2 (Üst Özet Kartları)**: Anomali detay penceresinin üst özet alanında **En Düşük Birim Fiyat (Baz Fatura)**, **En Yüksek Birim Fiyat (Tepe Fatura)** ve **Son Fatura Birim Fiyatı (Güncel Alım)** ayrı kartlar halinde net olarak gösterilecektir.

---

## 1. Genel Bakış ve Kök Neden Çözümü

- **Ne Yapar**:
  1. **Prizma ERP Faturalarının Tam Bağlantısı (1.586 Satır)**: XPS Carbon Prof 100 mm örneğindeki `1964` (`7.487,04 ₽`), `1978` (`7.000,00 ₽`), `1887` (`7.553,25 ₽`), `1647` (`7.553,25 ₽`), `1066` (`7.553,25 ₽`) ve `465` (`6.250,00 ₽`) gibi Prizma ERP kaynaklı faturalara tıklandığında uyarı kartının tepe fiyatını (`7.553,25 ₽`) koyan hatalı yedek (fallback) mekanizma kaldırılır; doğrudan ilgili Prizma faturasının gerçek kalemleri, gerçek birim fiyatı ve orijinal `Счет на оплату` PDF belgesi açılır.
  2. **Gerçek KDV Dahil Fiyatın Korunması (59 Satır)**: Faturada gerçek KDV dahil fiyatı (`grossUnitPrice`) belli olan kalemlerin `%20` KDV'den `%22`'ye yapay olarak çarpılması ve zaten KDV'si ayrıştırılmış kalemlerin çapraz KDV kontrolünde ikinci kez bölünüp çarpılması engellenir.
  3. **En Düşük, En Yüksek ve Son Fatura Ayrımı**: Şantiyeler arası fiyat farkı (`JOBSITE_PRICE_GAP`) uyarılarında geçmişteki en yüksek fiyatlı faturanın (`7.553,25 ₽`, Haziran) yanlışlıkla "Son Fatura Birim Fiyatı" olarak yazılması düzeltilir; en son tarihli fatura (`7.487,04 ₽`, Ekim) ile en yüksek ve en düşük faturalar ayrı ayrı gösterilir.
- **Hedef Kullanıcılar**: Satınalma yöneticileri, şantiye şefleri ve maliyet kontrol ekibi.
- **Temel Kazanım**: Tabloda hangi rakam yazıyorsa faturanın içine girildiğinde de kuruşu kuruşuna aynı rakam ve gerçek fatura belgesi görülür.

---

## 2. Kullanıcı Deneyimi ve Görsel Tasarım

- **Kullanıcı Akışı**:
  1. Kullanıcı **Anomali Teşhisi** veya **Birim Fiyat Kıyaslama** ekranında bir malzemenin detay penceresini açar.
  2. Üst bölümde **4 net özet kart** yer alır:
     - **En Düşük Birim Fiyat (Baz)**: Ör. `6.250,00 ₽ / m³` (`Fatura 465 • 2026-04-09 • Nuri Buga`)
     - **En Yüksek Birim Fiyat (Tepe)**: Ör. `7.553,25 ₽ / m³` (`Fatura 1066 • 2026-06-26 • Nuri Buga`)
     - **Son Fatura Birim Fiyatı (Güncel)**: Ör. `7.487,04 ₽ / m³` (`Fatura 1964 • 2026-10-13 • Nuri Buga`)
     - **Fiyat Farkı & Mali Etki**: En düşük baz ile tepe/son alım arasındaki yüzdesel sapma ve toplam ruble etkisi.
  3. Alt kısımdaki **Tüm Zamanların Fatura Geçmişi** tablosunda her satırın yanında duruma göre **En Düşük Baz**, **En Yüksek Fiyat** ve **Son Alım** rozetleri gösterilir.
  4. Kullanıcı tablodaki herhangi bir satırda (`1964`, `1978` vb.) **"Fatura Gör"** butonuna tıkladığında, o faturanın gerçek Prizma veya GES Arşivi kaydı (`7.487,04 ₽`, `7.000,00 ₽` vb.) ve orijinal PDF faturası açılır.
- **Görsel Kimlik ve Tema**:
  - *Estetik Yönelim*: Finansal denetim netliği sağlayan kurumsal veri arayüzü.
  - *Renk Paleti*: En düşük baz fiyat için zümrüt yeşili (`emerald`), en yüksek tepe fiyat için kırmızı/kehribar (`rose`/`amber`), güncel son fatura için çivit/mavi (`indigo`) vurgu tonları.
  - *Tipografi*: Tüm birim fiyatlar ve toplam tutarlar `tabular-nums` (hizalı rakam) formatında, KDV durumu (`KDV Dahil Ödenen`) açıkça belirtilerek sunulur.

---

## 3. Temel Mimari Kararlar ve Gerekçeleri

- **Karar 1: Birleşik Fatura Çözümleme Havuzu (GES Arşivi + Prizma ERP)**
  - *Seçilen Yaklaşım*: Firestore'daki `invoices` (467 kayıt) ve `prizma_invoices` (634 kayıt) veritabanında izole kalmaya devam ederken, arayüzde fatura detay çözümleme haritası her iki kaynağı da (`invoiceId` -> `invoiceNumber + supplier` -> `invoiceNumber` öncelik sırasıyla) tarar.
  - *Neden*: GES Arşivi sayımlarını (`invoices: 467, discounts: 261`) bozmadan 1.586 Prizma fatura satırının tamamının gerçek fatura verisi ve PDF'i ile açılmasını sağlar.
- **Karar 2: Fatura İçi KDV Dahil Gerçek Fiyatın (`paidGrossUnitPrice`) Esas Alınması**
  - *Seçilen Yaklaşım*: Fatura kaleminde doğrulanmış KDV dahil birim fiyat mevcut olduğunda karşılaştırma motoru bu fiyatı doğrudan korur; yalnızca fiziksel birim dönüşümü (ör. paket -> m³, ton -> kg) varsa standart birime çevirir ve faturadaki orijinal birim fiyatını da yanında tutar.
  - *Neden*: `%20` KDV'li eski faturaların `%22` ile çarpılarak faturada yazmayan sanal rakamlar üretmesini ve kullanıcıda "fatura içi ile tablo uyuşmuyor" algısı oluşmasını tamamen ortadan kaldırır.

---

## 4. Teknik Mimari ve Veri Akışı

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   VERİ KAYNAKLARI (Firestore İzole)                     │
│   ┌────────────────────────────┐     ┌──────────────────────────────┐   │
│   │ GES Arşivi (467 Fatura)    │     │ Prizma ERP (634 Fatura)      │   │
│   └─────────────┬──────────────┘     └──────────────┬───────────────┘   │
└─────────────────┼───────────────────────────────────┼───────────────────┘
                  │                                   │
                  ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          KARŞILAŞTIRMA & ANOMALİ MOTORU (Gerçek KDV Dahil Fiyat)        │
│  • Doğrulanmış grossUnitPrice / netUnitPrice kalemlerde çapraz KDV      │
│    bölme/çarpma (Step A/B) devre dışı bırakılır                         │
│  • Tablo birim fiyatı = Faturadaki gerçek KDV dahil birim fiyat         │
│  • Her geçmiş satırına invoiceId, prizmaDemandId, invoiceFileId eklenir │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│            ANOMALİ TEŞHİSİ & PİYASA ANALİZİ DETAY PENCERESİ             │
│  ┌──────────────────────┬──────────────────────┬─────────────────────┐  │
│  │ En Düşük Birim Fiyat │ En Yüksek Birim Fiyat│ Son Fatura Fiyatı   │  │
│  │ (Baz Fatura & Tarih) │ (Tepe Fatura & Tarih)│ (Güncel Alım & No)  │  │
│  └──────────────────────┴──────────────────────┴─────────────────────┘  │
│                                 │                                       │
│                    "Fatura Gör" │ (invoiceId / prizmaDemandId)          │
│                                 ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ FATURA DETAY PENCERESİ (Gerçek Kalemler + Prizma/GES PDF Önizleme)│  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Durum ve Etkileşim Eşleştirmesi
- **Fatura Detay Açılışı**: Satırdaki `invoiceId` veya `invoiceNumber + supplier` üzerinden gerçek fatura nesnesi bulunur. İstisnai olarak kayıt bulunamazsa dahi uyarı kartının tepe fiyatı (`currentPrice`) **asla** kullanılmaz; tıklanan satırın kendi `unitPrice`, `netUnitPrice`, `grossUnitPrice`, `quantity`, `supplier` ve `date` bilgileriyle birebir gösterim yapılır.
- **Prizma PDF Görüntüleme**: Prizma kaynaklı faturalarda `prizmaDemandId` / `invoiceFileId` üzerinden orijinal PDF (`Счет на оплату`) doğrudan fatura detay penceresinde yüklenir.
