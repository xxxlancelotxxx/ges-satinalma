# İndirim Alınmayan Faturalar (Doğrudan Fatura Girişleri) Denetim & Baskı Raporu Planı

## 1. Amaç ve Kapsam
Bu geliştirme, **Performans ve İndirim Raporu** ekranına, **AI Otomatik Fatura Okuma -> Sistemde Kayıtlı Faturalar & Malzeme Kalemleri** arşivinde yer alan ancak **Şef İndirim & TDF Teklif Merkezi** üzerinden indirim/pazarlık kaydı girilmemiş olan **İndirimsiz Doğrudan Faturaları** tespit eden, şef ve şantiye bazında karneleyen ve şeflere gönderilmek üzere **Excel (.xlsx)**, **PDF (Yazdırılabilir Kurumsal Rapor)** ve **HTML** formatlarında dışa aktaran yeni bir denetim modülü kazandırır.

Temel hedef; satınalma şeflerine indirim almadan doğrudan sisteme işledikleri faturaları somut liste ve tutarlarla iletmek, kaçırılan potansiyel indirim tutarını göstermek ve her bir fatura için **"Neden İndirim Alınmadı?"** sorusuna yazılı savunma/açıklama talep ederek pazarlık baskısı oluşturmaktır.

---

## 2. Onaylanan Kullanıcı Kararları
1. **Raporlama ve Gruplama Yapısı**: Hem **Şef Bazlı Özet Karne** (şefin toplam fatura adedi, indirimli fatura adedi, indirimsiz fatura adedi/oranı, indirimsiz toplam fatura hacmi ve hedef orana göre kaçırılan potansiyel indirim tutarı) hem de **Detaylı Fatura Listesi** (şef, şantiye, tedarikçi firma, fatura numarası, fatura tarihi, kalem sayısı, toplam tutar, tahmini kayıp tutarı ve şef savunma alanı) bir arada sunulacaktır.
2. **Çıktı Sütunları ve Denetim Alanları**: Ekranda ve indirilen **Excel, PDF, HTML** raporlarında; ayarlanabilir hedef indirim oranına (varsayılan `%5`, kullanıcı tarafından `%3`, `%5`, `%10` vb. değiştirilebilir) göre hesaplanan **Tahmini Kayıp İndirim Tutarı** sütunu ve şeflerin doldurması veya yönetimin not düşmesi için **Neden İndirim Alınmadı? (Şef Savunma / Açıklama)** sütunu yer alacaktır.

---

## 3. Mimari ve Veri Akış Şeması

```text
+-----------------------------------------------------------------------------------+
|                        VERİ KAYNAKLARI (CANLI FIRESTORE)                          |
+-----------------------------------------+-----------------------------------------+
                                          |
                  +-----------------------+-----------------------+
                  v                                               v
  [Sistemde Kayıtlı Faturalar]                    [Şef İndirim & TDF Kayıtları]
  (GES Arşivi Fatura & Kalemleri)                 (Pazarlık / TDF İndirim Kayıtları)
                  |                                               |
                  +-----------------------+-----------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                İNDİRİMSİZ FATURA EŞLEŞTİRME & AYIKLAMA MOTORU                     |
|  1. Silinmiş (Çöp Kutusu) ve Prizma ERP referans kayıtlarını hariç tut            |
|  2. İndirim Merkezinden senkronize edilen (inv_sync_ / discountId) kayıtları ele  |
|  3. Normalize edilmiş Fatura No veya (Tedarikçi + Tarih + Tutar) eşleşmesini ele  |
|  => KALANLAR: İndirim Alınmadan Doğrudan Girilen Faturalar                        |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|            PERFORMANS VE İNDİRİM RAPORU -> İNDİRİMSİZ FATURA DENETİMİ             |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | A. Filtre & Kontrol Barı                                                    |  |
|  | - Şef Seçimi | Şantiye Seçimi | Tedarikçi / Fatura No Arama | Tarih Aralığı |  |
|  | - Hedef İndirim Oranı Seçici (%3, %5, %7, %10)                              |  |
|  | - Tek Tıkla İndir: [Excel (.xlsx)]  [PDF Raporu]  [HTML Dosyası]            |  |
|  +-----------------------------------------------------------------------------+  |
|  | B. Üst KPI & Şef Bazlı İndirimsiz Fatura Karnesi                            |  |
|  | - Toplam İndirimsiz Fatura Adedi & Hacmi (RUB / TRY / USD / EUR)            |  |
|  | - Şef Karnesi Tablosu: Şef | Şantiye | Toplam Fatura | İndirimsiz Adet (%)  |  |
|  |   | İndirimsiz Tutar | Kaçırılan Potansiyel İndirim | "Sadece Bu Şefi İndir"|  |
|  +-----------------------------------------------------------------------------+  |
|  | C. Detaylı İndirimsiz Faturalar & Kalem Denetim Tablosu                     |  |
|  | - Sütunlar: Tarih | Şef & Şantiye | Tedarikçi Firma | Fatura No | Kalemler  |  |
|  |   | Fatura Tutarı | Tahmini Kayıp (%X) | Neden İndirim Alınmadı? (Savunma)  |  |
|  | - Satır genleştiğinde faturadaki malzeme kalemlerini ve birim fiyatları gör |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Kullanıcı Deneyimi (UX) ve Görsel Tasarım

### A. Sekme ve Görünüm Geçişi
- **Performans ve İndirim Raporu** ekranının üst kısmına belirgin bir görünüm seçici eklenecektir:
  1. **Genel Performans & İndirim Analizi** (Mevcut görünüm)
  2. **İndirim Alınmayan Faturalar Denetimi (Baskı & Sorgu Raporu)** (Yeni görünüm — üzerinde tespit edilen indirimsiz fatura sayısı rozeti ile)

### B. Üst Özet Kartları ve Şef Bazlı Özet Karne
- **4 Kritik Denetim Kartı**:
  - **İndirimsiz Fatura Sayısı**: Toplam fatura içindeki payı (`%`) ile birlikte.
  - **İndirimsiz Toplam Fatura Hacmi**: İndirim alınmadan doğrudan onaylanan faturaların toplam tutarı.
  - **Kaçırılan Potansiyel İndirim (Tahmini Kayıp)**: Seçili hedef indirim oranına (örn. `%5`) göre masada bırakılan toplam tutar.
  - **En Çok İndirimsiz Fatura Giren Şef**: Odaklanılması gereken ilk sorumluyu gösteren uyarı kartı.
- **Şef Bazlı İndirimsiz Fatura Karnesi Tablosu**:
  - Her satınalma şefi için: *Şef Adı*, *Şantiyesi*, *Toplam Fatura Sayısı*, *İndirimli Fatura Sayısı*, *İndirimsiz Fatura Sayısı*, *İndirimsiz Giriş Oranı (%)*, *İndirimsiz Fatura Toplamı* ve *Tahmini Kayıp İndirim Tutarı*.
  - Her şef satırının sağında **"Bu Şefin Sorgu Raporunu İndir (Excel / PDF / HTML)"** hızlı aksiyon butonları yer alacak; böylece yöneticiler tek tıkla ilgili şefe sadece kendi indirimsiz faturalarını içeren dosyayı gönderebilecektir.

### C. Detaylı İndirimsiz Fatura Listesi ve Kalem İnceleme
- **Filtreleme**: Satınalma Şefi, Şantiye, Tedarikçi Firma / Fatura No arama kutusu, Başlangıç–Bitiş Fatura Tarihi ve Para Birimi filtresi.
- **Tablo Sütunları**:
  1. **Sıra No**
  2. **Fatura Tarihi & Kayıt Tarihi**
  3. **Satınalma Şefi & Şantiye**
  4. **Tedarikçi Firma**
  5. **Fatura Numarası** (Orijinal PDF/Görsel varsa tek tıkla görüntüleme ikonu ile)
  6. **Kalem Sayısı & Özeti** (Tıklandığında alt satırda faturanın tüm malzeme kalemlerini, miktar ve birim fiyatlarını açar)
  7. **Fatura Toplam Tutarı** (`tabular-nums` hizalı)
  8. **Tahmini Kayıp İndirim (`%Hedef`)** (Kırmızı vurgu ile)
  9. **Neden İndirim Alınmadı? (Şef Savunma / Açıklama)**: Ekrandan da anlık not yazılabilir, çıktılarda ise şefin doldurması için belirgin kutucuklu sütun olarak yer alır.

---

## 5. Kurumsal Dışa Aktarım (Excel, PDF ve HTML) Tasarımı

### 1. Kurumsal Excel (`.xlsx`) Çıktısı
- **1. Sayfa — "Şef Özet Karnesi"**:
  - Kurumsal lacivert/kırmızı başlık bloğu, rapor tarihi, seçili filtre özeti ve hedef indirim oranı bilgisi.
  - Şef bazlı toplam fatura, indirimli fatura, indirimsiz fatura adedi, indirimsiz tutar ve kaçırılan potansiyel indirim tablosu.
- **2. Sayfa — "İndirimsiz Faturalar Sorgu Listesi"**:
  - Sütunlar: `Sıra No`, `Fatura Tarihi`, `Satınalma Şefi`, `Şantiye`, `Tedarikçi Firma`, `Fatura No`, `Kalem Sayısı`, `Ana Kalemler Özeti`, `Fatura Tutarı`, `Para Birimi`, `Hedef İndirim (%)`, `Tahmini Kayıp İndirim Tutarı`, `NEDEN İNDİRİM ALINMADI? (ŞEF SAVUNMA / AÇIKLAMA)`.
  - Savunma sütunu sarı/açık turuncu vurgu rengiyle ve geniş sütun genişliğiyle (`45px`) biçimlendirilir; böylece şef Excel dosyasını açıp doğrudan her faturanın karşısına açıklamasını yazıp geri gönderebilir.

### 2. Kurumsal PDF & HTML Rapor Çıktısı
- Üst kısımda **"İNDİRİM ALINMAYAN FATURALAR DENETİM VE SAVUNMA FORMU"** başlığı ve resmi uyarı notu (*"Aşağıda listelenen faturalar Şef İndirim & TDF Teklif Merkezi üzerinden herhangi bir pazarlık/indirim kaydı olmaksızın doğrudan sisteme işlenmiştir. Her bir fatura için neden indirim alınmadığını ve rekabetçi teklif toplanmama gerekçesini ilgili sütuna işleyerek yönetime iletiniz."*).
- Üstte **Şef Bazlı Özet Karne**, altında **Detaylı Fatura Tablosu** ve en altta **Satınalma Şefi İmza / Teslim Tarihi** ile **Satınalma Müdürü Onay** blokları yer alır.
- **HTML İndir** butonu tek dosya halinde tüm stilleri gömülü `.html` dosyası indirir (WhatsApp, e-posta veya Telegram üzerinden şefe doğrudan gönderilebilir).
- **PDF İndir / Yazdır** butonu yatay (`Landscape A4`) formatta, sayfa taşması olmadan temiz baskı/PDF penceresi açar.
