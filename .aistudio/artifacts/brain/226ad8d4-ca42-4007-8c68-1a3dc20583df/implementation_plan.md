# Hızlı Ön Onay Fiyat Denetimi & Şef İndirim/TDF Teklif Merkezi Doğruluk ve Eşleştirme Planı

## 1. Tespit Edilen Kök Nedenler (Canlı Veri Analizi — Fatura No: `3262`)
Sistemde yaptığımız incelemede, belirttiğiniz **"1.477,38 ₽'lik malzemenin sistemde 296 ₽'ye daha ucuz var gibi gösterilmesi"** hatasının iki noktada tetiklendiği tespit edilmiştir:

1. **Hızlı Ön Onay Fiyat Denetimi (`PreApprovalAudit.tsx` & `auditSingleLineItem`):**
   - **Admin Fiyat Anomali Denetimi** sekmesi birebir orijinal Rusça + tüm sayısal değerler/marka (`buildStrictOriginalMaterialSignature`) motorunu kullanırken, **Hızlı Ön Onay Fiyat Denetimi** sekmesindeki `auditSingleLineItem` fonksiyonu eski bulanık (fuzzy) eşleştirme katmanlarını (`Path 0..F`) kullanmaya devam ediyordu.
   - Örneğin Fatura `3262` içindeki **`D-HS-BIM- CO-38-092 Биметаллическая коронка COBALT (M42), 92 мм "D.BOR"` (1.477,38 ₽)** kalemi taratıldığında; eski motor `"M42"` ve `"D.BOR"` kelimelerinden hareketle geçmiş Fatura `3239` içindeki `38 мм` (679,25 ₽), `54 мм` (950,04 ₽), `73 мм` (1.168,44 ₽) pançları ve hatta aynı faturadaki **`210 Бур SDS-plus 10*150/210` (296,00 ₽)** matkap ucunu aynı havuza dahil edip en düşük fiyat olarak **296,00 ₽** gösteriyordu. Oysa aynı `92 мм` malzemenin geçmiş Fatura `3239`'daki gerçek fiyatı **1.538,94 ₽** olup yeni alınan **1.477,38 ₽** fiyat aslında geçmişten **%4 daha uygundur**.

2. **Şef İndirim & TDF Teklif Merkezi (`DiscountEntryForm.tsx` & `invoiceLineMatcher.ts`):**
   - İlk teklif ile son indirimli fatura kalemlerini karşılaştıran `invoiceLineMatcher.ts` ve `schematicAnalysis` modülü, yalnızca `AxB` (`10x150`, `20x250`) formatındaki ölçüleri kontrol ediyor; tekil çap/boyut içeren (`92 мм` veya `400 мм`) kalemlerde ölçü dizisi boş döndüğü için ortak marka/kelime (`"D.BOR"`, `"SDS"`, `"Eco Line"`) üzerinden **1.477,38 ₽**'lik panç ve **679,40 ₽**'lik murç kalemlerini 1. satırdaki **296,00 ₽**'lik matkap ucu ile eşleştirip **"⚠️ TDF Denetim Uyarısı: En İyi İlk Teklif Üstü Alım (296 ₽ yerine 1.477,38 ₽)"** şeklinde yanlış uyarı üretiyordu.

---

## 2. Yapılacak Düzenlemeler

### A. Hızlı Ön Onay Fiyat Denetimi Motorunun Birebir Orijinal Rusça İndeks Motoruna Bağlanması (`src/utils/preApprovalAuditEngine.ts`)
- `auditSingleLineItem` ve `auditEntireInvoice` fonksiyonlarındaki eski bulanık (fuzzy) eşleştirme katmanları (`Path 0..F`, `canonicalMaterialId` genellemesi, Türkçe çeviri üzerinden eşleştirme ve farklı ölçüleri birleştirme) tamamen kaldırılacak.
- Bunun yerine **Admin Fiyat Anomali Denetimi** sekmesinde çalışan `getOrBuildStrictOriginalIndex` ve `buildStrictOriginalMaterialSignature` motoru doğrudan kullanılacak:
  - Malzemenin **orijinal Rusça metni (`originalName`)**, **markası**, **GOST/TU standardı** ve **tüm sayısal değerleri (çap, kalınlık, ebat, yoğunluk, model/boyut numarası — örn. `92` vs `38`/`54`/`210`)** %100 birebir aynı olmadan hiçbir geçmiş fatura (GES Arşivi veya Prizma ERP) eşleştirilmeyecek.
  - O(1) hash-bucket indeksleme sayesinde **Hızlı Ön Onay Fiyat Denetimi** sekmesinde 15.000+ kalemlik GES + Prizma ERP taraması **milisaniyeler içinde** tamamlanacak.
  - Geçmiş referans faturaya tıklandığında hem PDF açma hem de kalem listeli fatura detay penceresine erişim desteklenecek.

### B. Şef İndirim & TDF Teklif Merkezi Kalem Eşleştirme ve Ön İzleme Denetiminin Düzeltilmesi (`src/utils/invoiceLineMatcher.ts`, `src/utils/comparativeCalculation.ts`, `src/components/DiscountEntryForm.tsx`)
- **Birebir Kalem Eşleştirme (`invoiceLineMatcher.ts` & `comparativeCalculation.ts`):**
  - 1. İlk Teklif, Ara Pazarlık Turları ve Nihai İndirimli Fatura kalemleri eşleştirilirken önce `buildStrictOriginalMaterialSignature` ve ürün/artikel kodu (`арт.`) kontrol edilecek.
  - Yalnızca `AxB` değil, kalem içindeki **tüm sayısal ölçüler (`92 мм`, `400 мм`, `10*150/210` vb.)** karşılaştırılacak; sayısal değerleri farklı olan iki kalem asla birbiriyle eşleştirilmeyecek.
  - Birebir (1-e-1) eşleştirme kuralı uygulanarak birden fazla satırın aynı ilk teklif satırına (`296 ₽`) bağlanması ve eşleşmeyen satırlarda farklı bir malzemenin fiyatının referans alınması kesin olarak engellenecek.
- **Kayıtlı Hatalı TDF Matris Verilerinin Temizlenmesi (Firestore):**
  - Fatura `3262` (`disc_1792509109686` ve `disc_1792509799444`) ve `ХМ-1369` kayıtlarında yanlış eşleşme nedeniyle oluşan hatalı `canonicalMaterials` / `isAboveBestOffer` uyarıları, belge sayıları (`invoices: 467, discounts: 261`) korunarak gerçek kalem fiyatlarıyla düzeltilecek ve sunucu yeniden başlatılarak güncel kodun tüm sekmelerde aktif olması sağlanacak.
