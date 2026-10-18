# Genel Bakış ve Dashboard: Profesyonel Komuta Merkezi & Canlı Sekme Entegrasyonu

Genel Bakış ve Dashboard ekranını tüm sekmelerle canlı konuşan, 28 güncel kategori standardıyla kuruşu kuruşuna aynı veriyi taşıyan, gereksiz kalabalıktan arındırılmış ve üst düzey yönetici ergonomisine sahip bir satınalma komuta merkezine dönüştürüyoruz.

### User Review & Critical Decisions

> [!IMPORTANT]
> Dashboard üzerindeki dört temel yapısal iyileştirme kullanıcı geri bildirimleri doğrultusunda netleştirilmiştir. Onayınızla birlikte doğrudan uygulamaya geçilecektir.

- **Karar 1 — Yapay Zeka Karar & Canlı Senkronizasyon Masasının Yeniden Kurgulanması**: Statik "23 Kategori Çözümlendi" rozeti ve pasif butonlar kaldırılarak; **Canlı Sekme Senkronizasyon Köprüsü** (Malzeme Fiyat Karşılaştırma, Anomali Radarı, Şef Performans Masası, İndirim Kayıtları, AI Fatura Okuma ve TDF 1M+ ₽ Ön Onay sekmelerine canlı sayaçlı ve bağlamsal geçiş) ile **Akıllı Satınalma Aksiyon Kartları** (En Yüksek Fiyat Makası, Çapraz Şantiye Arbitraj Fırsatı, En Başarılı Güncel Pazarlık ve Kritik Tedarikçi Uyarısı) birleştirilecektir.
- **Karar 2 — Kategori Bazlı Harcama Dağılımının 28 Güncel Kategoriyle Tam Senkronizasyonu ve Alt Kırılım**: Kategori hesaplama motoru, Malzeme Fiyat Karşılaştırma ve Prizma eşleştirme motorunun kullandığı merkezi 28 kanonik kategori çözücü (`resolveItemCategory`) ile birebir eşitlenecek; ayrıca herhangi bir kategoriye tıklandığında o kategorideki **en çok harcama yapılan malzemeleri, tedarikçileri, şantiye dağılımını ve Malzeme Fiyat Karşılaştırma sekmesine doğrudan geçişi** gösteren etkileşimli bir **Kategori Alt Kırılım Paneli** açılacaktır.
- **Karar 3 — Mükerrer "Veri Güvenliği & Yedek" Kartının Kaldırılması**: Üst navigasyon çubuğunda zaten yer alan yedekleme kontrolünün Dashboard alt bölümünde tekrar eden büyük kartı kaldırılacak; açılan alan **Son Satınalma ve İndirim İşlemleri** tablosu ile **En Yüksek İskonto & Tedarikçi Performans Özeti** için değerlendirilecektir.

---

### 1. Overview & Core Concept

- **Ne Yapar**: Şantiye satınalma harcamalarını, şef pazarlık/indirim başarılarını, malzeme birim fiyat makaslarını ve tespit edilen gizli anomalileri tek bir doğruluk kaynağından (Firestore + merkezi kategori ve birim fiyat motoru) beslenerek canlı olarak sunar ve her karttan ilgili sekmeye tek tıkla derin geçiş sağlar.
- **Hedef Kullanıcı**: Üst Yönetim, Satınalma Şefleri ve Satınalma Personeli.
- **Temel Değer**:
  - Sekmeler arası kopuklukların giderilmesi (Dashboard'da görülen bir malzeme farkı, anomali veya kategori harcamasına tıklandığında doğrudan ilgili sekmede veya alt kırılımda açılması).
  - Tüm ekranlarda 28 standart kategorinin kuruşu kuruşuna aynı harcama ve kalem sayısını göstermesi.
  - Mükerrer bileşenlerin temizlenerek veri yoğunluğu yüksek, taranabilir ve profesyonel bir kurumsal arayüz elde edilmesi.

---

### 2. User Experience & Visual Design

- **Temel Kullanıcı Akışları**:
  1. **Üst Komuta & Filtre Deneyimi**: Kullanıcı tarih aralığı, şantiye, kategori, tedarikçi veya şef seçtiğinde; KPI kartları, Yapay Zeka Komuta Masası, Şantiye Dağılımı, Kategori Dağılımı ve Son İşlemler tablosu eşzamanlı olarak filtrelenir.
  2. **Yenilenen Yapay Zeka Karar & Canlı Senkronizasyon Masası**:
     - **Üst Bant (Canlı Sekme Köprüleri)**: Sistemdeki 28 kanonik kategori kapsamını, aktif fatura/indirim senkronizasyonunu ve 6 ana sekmeye (Malzeme Fiyat Karşılaştırma, Anomali Radarı, Şef Performans Masası, İndirim & Pazarlıklar, Fatura Drive, Şantiye Yönetimi) canlı metriklerle tek tıkla geçişi sunar.
     - **Alt Bant (4 Akıllı Karar & Aksiyon Kartı)**:
       1. *Çapraz Şantiye & Fiyat Makası Fırsatı*: En yüksek birim fiyat farkına sahip malzemeyi ve potansiyel tasarruf tutarını gösterir; tıklandığında Malzeme Fiyat Karşılaştırma sekmesine yönlendirir.
       2. *Anomali & Risk Radarı*: Çapraz şantiye arbitrajı, parçalı alım (smurfing), sinsi fiyat artışı (creep) ve sepet küçültme tespitlerinin toplam finansal etkisini sunar; tıklandığında Anomali Radarı sekmesini açar.
       3. *Günün / Dönemin Lider Pazarlığı*: Seçili dönemde en yüksek iskonto sağlayan şef ve tedarikçi işlemini öne çıkarır; tıklandığında işlem detay modalını veya Şef Masasını açar.
       4. *Kategori & Bütçe Yoğunlaşma Analizi*: Harcamanın en çok yoğunlaştığı lider kategoriyi ve şantiyeyi gösterir; tıklandığında Dashboard filtresini anında o kategoriye/şantiyeye odaklar.
  3. **Kategori Bazlı Harcama Dağılımı & Tıklanabilir Alt Kırılım (Drill-Down)**:
     - 28 kanonik kategoriyle %100 senkronize çalışır.
     - Kullanıcı bir kategori kartına, grafik sütununa veya matris satırına tıkladığında, hemen altında **Seçili Kategori İstihbarat Çekmecesi** açılır: o kategorideki toplam harcama, kalem sayısı, en çok alınan ilk 6 malzeme (birim fiyat ve miktarlarıyla), en büyük 4 tedarikçi, şantiye dağılımı ve *"Bu Kategoriyi Malzeme Fiyat Karşılaştırmada İncele →"* aksiyon butonu yer alır.
  4. **Alt Bölüm (Mükerrer Yedek Kartı Kaldırılmış Yeni Düzen)**:
     - Üst barda zaten bulunan *Veri Güvenliği & Yedek* kutusu Dashboard gövdesinden tamamen kaldırılır.
     - Sol 8 sütunda zenginleştirilmiş **Son Satınalma ve İndirim İşlemleri** tablosu, sağ 4 sütunda ise **En Yüksek İskonto Oranlı Alımlar** ve **En Yüksek Hacimli Tedarikçiler (Top 5 Tedarikçi & İndirim Özeti)** kartları yer alır.

- **Görsel Kimlik & Tema**:
  - *Estetik Yönelim*: Kurumsal, yüksek yoğunluklu finansal ve mühendislik analitiği (Clean Enterprise SaaS).
  - *Renk Paleti*: Açık ve ferah `#F8FAFC` / `#FFFFFF` zemin (`60%`), ince `#E2E8F0` sınır çizgileri (`30%`), yalnızca aksiyon ve durum vurgularında kullanılan İndigo (`#4F46E5`), Zümrüt (`#059669`), Kehribar (`#D97706`) ve Kırmızı (`#E11D48`) (`10%`).
  - *Tipografi & Tabular-Nums Disiplini*: Tüm parasal değerler (`₽`), yüzdeler, miktarlar ve tarihler dikey hizalamayı koruyan `font-mono tabular-nums` ile gösterilir.

---

### 3. Key Product Decisions & Trade-Offs

- **Karar 1 — Kategori Sınıflandırmasında Tek Doğruluk Kaynağı (`resolveItemCategory`)**:
  - *Seçilen Yaklaşım*: Hem Dashboard hem Şantiye Bazlı Malzeme Özeti hem de Malzeme Fiyat Karşılaştırma ekranlarının tamamında `resolveItemCategory` kullanılarak manuel kategori atamaları, Rusça orijinal fatura satırları ve tedarikçi bağlamı birebir aynı öncelikle çözümlenir.
  - *Neden*: Farklı sekmelerde veya alt bileşenlerde bir kalemin farklı kategoriye düşmesini kesin olarak önler.
- **Karar 2 — Yapay Zeka Masasının "Slogan" Yerine "Veriye Dayalı Karar Kartları" Sunması**:
  - *Seçilen Yaklaşım*: Sabit metinler ve eski "23 Kategori" ibaresi yerine, gerçek zamanlı hesaplanan 4 somut satınalma içgörüsü (Fiyat Makası, Anomali Etkisi, Lider İskonto, Harcama Yoğunlaşması) ve doğrudan sekme kısayolları gösterilir.
  - *Neden*: Yöneticinin ekrana baktığı ilk 5 saniyede nerede fiyat farkı veya tasarruf fırsatı olduğunu görüp tek tıkla aksiyon almasını sağlar.
- **Karar 3 — Veri Güvenliği & Yedek Kartının Kaldırılması**:
  - *Seçilen Yaklaşım*: Üst navigasyon barında zaten mevcut olan yedekleme butonu korunurken, Dashboard içindeki tekrar eden yönetici yedekleme kutusu kaldırılır; yerine karar verici için çok daha değerli olan **En Yüksek Hacimli Tedarikçiler & Pazarlık Özeti** eklenir.
  - *Neden*: Ekran israfını önler ve satınalma odaklı bilgi yoğunluğunu artırır.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   FIRESTORE & MERKEZİ VERİ KATMANI                         │
│     Invoices (GES Platform)  │  Discounts (Pazarlıklar)  │  Comparisons    │
└──────────────┬─────────────────────────────┬──────────────────────┬────────┘
               │                             │                      │
               ▼                             ▼                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│         TEK DOĞRULUK KAYNAĞI ANALİTİK MOTORU (28 Kanonik Kategori)         │
│  • resolveItemCategory() ile %100 kategori uyumu                           │
│  • Ortak Filtre Motoru (Tarih, Şantiye, Kategori, Tedarikçi, Şef, Fatura)  │
└──────────────┬─────────────────────────────┬──────────────────────┬────────┘
               │                             │                      │
               ▼                             ▼                      ▼
┌──────────────────────────┐  ┌──────────────────────────┐  ┌────────────────┐
│  YAPAY ZEKA KARAR &      │  │  KATEGORİ HARCAMA &      │  │ SON İŞLEMLER,  │
│  CANLI SEKME MASASI      │  │  ALT KIRILIM PANELİ      │  │ İSKONTOLAR &   │
│  • 6 Sekme Canlı Köprü   │  │  • 28 Standart Kategori  │  │ TEDARİKÇİ      │
│  • 4 Akıllı Aksiyon Kartı│  │  • Tıklanabilir Malzeme  │  │ PERFORMANS     │
│  • Tek Tık Filtre / Geçiş│  │    ve Tedarikçi Çekmecesi│  │ ÖZETİ (Yedek   │
│                          │  │  • Fiyat Kıyas Köprüsü   │  │ Kartı Kalktı)  │
└──────────────────────────┘  └──────────────────────────┘  └────────────────┘
```

- **Etkileşimli Bileşen ve Durum Eşlemesi**:
  - **Canlı Sekme Köprüleri**: Her sekme butonu (`material-compare`, `anomalies`, `performance`, `discounts`, `invoice-ai`, `jobsites-supervisors`) o sekmedeki güncel kayıt/uyarı sayısını gösterir ve tıklandığında ilgili sekmeye geçiş yapar.
  - **Kategori Alt Kırılım Çekmecesi (`selectedCategory` aktifken veya kategori satırına tıklandığında)**: Seçilen kategorideki tüm normalize kalemleri gruplayarak en yüksek harcamalı malzemeleri, tedarikçileri ve şantiyeleri anında listeler; herhangi bir malzemeye tıklandığında detayını veya fiyat karşılaştırmasını açar.
  - **Tedarikçi & İskonto Özeti**: Mükerrer yedekleme kartının yerine gelen kartta, seçili filtre dönemindeki en büyük 5 tedarikçi (toplam harcama, fatura sayısı ve o tedarikçiden alınan toplam indirim) gösterilir; bir tedarikçiye tıklandığında tüm Dashboard o tedarikçiye göre filtrelenir.
