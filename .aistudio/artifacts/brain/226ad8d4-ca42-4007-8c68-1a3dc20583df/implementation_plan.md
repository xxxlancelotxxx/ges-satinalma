# Akıllı ve Profesyonel TDF (Teklif Değerlendirme Formu) Tasarımı ve Eşleştirme Motoru

Farklı tedarikçilerin aynı inşaat malzemesini (özellikle inşaat demiri / armatür, kontrplak, yalıtım vb.) farklı yazım biçimleriyle teklif etmesi nedeniyle oluşan yanlış "Kritik Teknik Fark" uyarılarını ortadan kaldırır; TDF ekranını ve çıktılarını (HTML, PDF, Excel) ilk bakışta anlaşılır, kurumsal ve yönetici dostu bir yapıya kavuşturur.

## Kullanıcı Onayları ve Kritik Kararlar

> [!IMPORTANT]
> Aşağıdaki iki temel tasarım kararı yanıtlarınıza göre kesinleştirilmiştir:

- **Onaylanan Karar 1 (Standart Ortak Kalem Adı)**: Farklı firmaların farklı şekillerde yazdığı aynı malzemeler için tabloda temiz ve standart bir ortak ad (ör. `Арматура А500С Ø36 · 11,7 м · ГОСТ 34028`) gösterilecek; tedarikçilerin kendi tekliflerindeki orijinal yazımları ise hücre ipucunda ve alt bilgisinde korunacaktır.
- **Onaylanan Karar 2 (Gerçek Teknik Farkların İzole Edilmesi)**: Yazım biçimi farkları (`ГОСТ 34028` ile `ГОСТ 34028-2016`, `36х11700` ile `Ø36 11,7м`, `А240` ile `А240С`, `Катанка 8мм А240` ile `Арматура А240 Ø8`) kesinlikle teknik fark sayılmayacaktır. Gerçek bir teknik fark olduğunda (ör. 3 firma `6 m` teklif ederken 1 firmanın `11,7 m` teklif etmesi), satırın çoğunluk/referans özelliği baz alınarak **yalnızca farklı teklif veren firmanın hücresi** uyarılacak, doğru teklif veren diğer firmaların hücreleri kirletilmeyecektir.

---

## 1. Genel Bakış ve Temel Çözüm

- **Sorunun Kaynağı**:
  1. Mevcut TDF motoru `Арм. Пруток МД 36х11700 А500С ГОСТ 34028-2016` ifadesindeki `36х11700` ölçüsünü "levha ebadı (`size: 11700x36`)" sanıyor, `Ø36` çap ve `11,7 m` boy olarak çözümleyemiyordu.
  2. `ГОСТ 34028-2016` (yıl ekli) ile `ГОСТ 34028` (yıl eksiz) standartlarını veya `А240` ile `А240С` düz demir sınıflarını birbirinden farklı sanarak her satırda **Kritik Teknik Fark** üretiyordu.
  3. Bir satırda tek bir firma farklı özellik verdiğinde, motor her hücreyi diğer tüm hücrelerle çapraz kıyasladığı için satırdaki **bütün firmaları** "Teknik fark: kıyasa katılmadı" olarak işaretleyip karşılaştırmayı bozuyordu.
- **Hedef Kitle**: Satınalma şefleri, satınalma müdürleri ve üst yönetim (onay makamı).
- **Sağlanan Değer**: Sıfır sahte uyarı, %100 doğru çap/boy/sınıf/GOST eşleşmesi, temiz standart kalem isimlendirmesi ve tek bakışta kazanan firmayı, pazarlık indirimini ve gerçek uyarıları gösteren kurumsal TDF tablosu.

---

## 2. Kullanıcı Deneyimi ve Görsel Tasarım

- **Adım Adım Kullanıcı Akışı**:
  1. **Özet ve Karar Kartları**: Ekranın ve çıktının en üstünde 4 net KPI kartı (Önerilen Plan & Kazanan Firma, Tek Firma En Ucuz Tam Teklif, En Yüksek Teklif İle Fark, Pazarlıkla Kazanılan İndirim) ve hemen altında yeşil vurguyla **Sistemin Satınalma Önerisi** yer alır.
  2. **Temiz ve Standart Fiyat Karşılaştırma Matrisi**:
     - Her satırda malzemenin otomatik üretilmiş temiz standart adı (ör. `Арматура А500С Ø36 · 11,7 м`) ve altında düzenli teknik özellik rozetleri (`A500C · Ø36 mm · 11,7 m · ГОСТ 34028`) yer alır.
     - Kalemler inşaat demiri gibi gruplarda çapa göre düzenli sıralanır (`Ø40 → Ø36 → Ø32 → ... → Ø8 A500C → Ø8 A240`).
     - Her firma sütununda birim fiyat ve toplam tutar `tabular-nums` (rakamlar alt alta hizalı) olarak gösterilir; en ucuz fiyatlar zümrüt yeşili (`#0B7A4B`), en pahalılar soluk mercan, gerçek teknik fark olan tekil hücre ise kehribar (`#D97706`) bilgi etiketiyle vurgulanır.
  3. **Gruplanmış ve Özlü Uyarı Paneli**:
     - Aynı sebepten kaynaklanan uyarılar 30 ayrı satır halinde alt alta dizilmez; firma bazında gruplanmış, temiz ve aksiyon odaklı tekil bildirimler halinde sunulur.
- **Görsel Kimlik ve Tema**:
  - *Estetik Yönelim*: Kurumsal mühendislik ve finansal tablo disiplini (yüksek okunabilirlik, tek katmanlı kart derinliği, gereksiz rozet kalabalığından arındırılmış hiyerarşi).
  - *Renk Paleti*:
    - Arka plan ve yüzeyler: Temiz beyaz (`#FFFFFF`) ve açık arduvaz (`#F8FAFC`), tablo başlıklarında kurumsal lacivert (`#102C54`).
    - Vurgu ve durum renkleri: En iyi fiyat ve öneri için zümrüt yeşili (`#16A34A` / `#E2F5EC`), en iyi fiyat özet bloğu için sıcak altın sarısı (`#FFEB9C`), dikkat/fark hücreleri için kehribar (`#D97706` / `#FFF3D6`), gerçek kritik çelişkiler için koyu kırmızı (`#DC2626` / `#FDE8E6`).
  - *Tipografi ve Tablo Disiplini*: Tüm fiyat, miktar ve yüzdelerde `tabular-nums` kullanılarak basamakların kusursuz dikey hizalanması sağlanır.

---

## 3. Temel Ürün Kararları ve Teknik Yaklaşım

- **Karar 1: İnşaat Demiri (Armatür) ve Teknik Özellik Normalizasyonu**
  - *Seçilen Yaklaşım*:
    - `Арм. Пруток МД 36х11700`, `Сталь углеродистая для армирования... в d 32 мм`, `Катанка 8мм А240 (6м)`, `Арматура А500С ф 8 11700`, `Арматура А500С Ø36 (11,7м)` ifadelerinin tamamı aynı ortak teknik modele (`kategori: арматура`, `sınıf: A500C / A240`, `çap: 36 mm`, `boy: 11.7 m`, `ГОСТ: 34028`) dönüştürülecek.
    - Milimetre cinsinden yazılan boylar (`11700`, `6000`, `12000`) otomatik olarak metreye (`11.7`, `6`, `12`) çevrilecek; `36х11700` ifadesinin levha ebadı değil `Ø36 mm × 11,7 m` boyunda demir çubuk olduğu tanınacak.
    - GOST numaralarındaki yıl uzantıları (`34028-2016` → `34028`) ve eşdeğer düz demir sınıfları (`А240С` → `А240`) normalize edilerek sahte fark üretmesi engellenecek.
  - *Neden*: Tedarikçiler kendi ERP sistemlerindeki stok adlarını kullanır; satınalma uzmanının bunları tek tek elle düzeltmesine gerek kalmadan sistem aynı malzeme olduğunu ilk anda anlamalıdır.
- **Karar 2: Satır Bazlı Referans (Çoğunluk) Özelliğe Göre Fark Tespiti**
  - *Seçilen Yaklaşım*: Bir satırdaki hücreler birbirleriyle rastgele kıyaslanmak yerine, satırın **referans (çoğunluk / talep) teknik özelliği** belirlenir. Yalnızca bu referanstan sapan firmanın hücresine (ör. 3 firma `6 m` verirken `11,7 m` veren 1 firmaya) uyarı eklenir; diğer 3 firmanın fiyatı normal şekilde en iyi fiyat yarışına girer.
  - *Neden*: Tek bir firmanın farklı boy teklif etmesi yüzünden doğru teklif veren diğer tüm firmaların "kıyasa katılmadı" olarak devre dışı kalması tamamen önlenir.
- **Karar 3: Standart Ortak Kalem Adı Üretimi**
  - *Seçilen Yaklaşım*: Aynı satırda birleşen kalemler için malzemenin cinsine ve çıkarılan teknik özelliklerine göre okunaklı standart ad (ör. `Арматура А500С Ø36 · 11,7 м` veya `Арматура А240 Ø8 · 6 м`) otomatik üretilir; kullanıcı isterse üzerine tıklayıp özel ad yazabilir.

---

## 4. Teknik Mimari ve Veri Akışı

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     TDF Teklif Belgeleri (PDF / Excel)                   │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│             1. Akıllı Teknik Özellik & Kalem Normalizasyonu              │
│  • Demir/Armatür kalıpları: "36х11700", "ф36 11700", "в d 36 мм", "Ø36"  │
│    ──► Çap: 36 mm, Boy: 11.7 m (11700 mm → 11.7 m), Sınıf: A500C         │
│  • GOST & Sınıf Eşdeğerliği: "ГОСТ 34028-2016" ≡ "ГОСТ 34028"            │
│    "А240С" ≡ "А240", "Катанка 8мм А240" ≡ "Арматура А240 Ø8"             │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│            2. Otomatik Satır Eşleştirme & Standart Ad Üretici            │
│  • Aynı cins + aynı çap + aynı sınıf kalemleri tek satırda toplar        │
│  • Standart ortak ad üretir: "Арматура А500С Ø36 · 11,7 м (ГОСТ 34028)"  │
│  • Her firmanın kendi belgesindeki orijinal adını alt bilgi olarak tutar │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│          3. Çoğunluk (Referans) Bazlı Fark ve Fiyat Kıyas Motoru         │
│  • Satırın referans özelliğini (çoğunluk çap/sınıf/boy) belirler         │
│  • Yalnızca referanstan sapan firmanın hücresini uyarır                  │
│  • Doğru teklif veren firmalar arasında En İyi Fiyat ve Planı hesaplar   │
└───────────────┬────────────────────┴───────────────────┬─────────────────┘
                ▼                                        ▼
┌───────────────────────────────────┐    ┌─────────────────────────────────┐
│   Etkileşimli TDF Ekranı (UI)     │    │  Kurumsal Çıktılar (HTML/PDF/   │
│  • Yönetici Özet & Öneri Kartları │    │  Excel)                         │
│  • Hizalı Karşılaştırma Matrisi   │    │  • Birebir aynı standart adlar  │
│  • Gruplanmış Net Uyarı Listesi   │    │  • Formüllü Excel & A3 PDF      │
└───────────────────────────────────┘    └─────────────────────────────────┘
```

- **Mevcut Citybay6 Kaydının Otomatik İyileştirilmesi**:
  - Motor güncellendiğinde `Citybay6` (`TDF-2026-0004`) dahil mevcut tüm TDF kayıtları yeni motorla otomatik hesaplanacak; 32 adet sahte kritik uyarı sıfırlanacak, tüm demir çapları (`Ø40`, `Ø36`, `Ø32`, `Ø28`, `Ø25`, `Ø20`, `Ø16`, `Ø14`, `Ø12`, `Ø8 A500C`, `Ø8 A240`) temiz standart adlarıyla ve doğru en iyi fiyat hesaplarıyla görüntülenecektir.
