import React, { createContext, useContext, useState } from 'react';

export type Language = 'TR' | 'RU';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export const translations: Record<Language, Record<string, string>> = {
  TR: {
    // Header & Brand
    appTitle: 'SATINALMA PRO',
    appSubTitle: 'Performans & AI Otomasyon',
    appDesc: 'Şantiye Takip & Malzeme Fiyat Analizi',
    addDiscountBtn: 'İndirim Kaydı Ekle',
    
    // Navbar Items & Groups
    navGroupDashboard: 'Genel Bakış',
    navGroupProcurement: 'Satınalma & Faturalar',
    navGroupAnalytics: 'Malzeme & Fiyat Analizi',
    navGroupManagement: 'Şantiye & Yönetim',
    navDashboard: 'Genel Bakış ve Dashboard',
    navPreApprovalAudit: 'Hızlı Ön Onay Fiyat Denetimi',
    navDiscountEntry: 'Şef İndirim & Tasarruf Girişi',
    navComparativeOffers: '1M+ ₽ Karşılaştırmalı Teklif (TDF)',
    navInvoiceAI: 'AI Otomatik Fatura Okuma',
    navAnomalies: 'Anomali & Fiyat Artış Paneli',
    navMaterialCompare: 'Malzeme Fiyat Kıyaslama',
    navJobsites: 'Şantiyeler & Şefler',
    navSpecialMaterials: 'Özel Malzeme Analizi (Demir, Gazblok)',
    navDrive: 'Şantiye Fatura & Belge Deposu',
    navPerformance: 'Performans & İndirim Raporu',

    // Sub-item descriptions TR
    subDescDiscountEntry: 'Tedarikçi pazarlıkları, teklif kıyaslama ve tasarruf kayıtları',
    subDescComparativeOffers: '1.000.000 ₽ üzeri TDF & çoklu teklif analizi ile indirim girişi',
    subDescPreAudit: 'Satınalma onayı öncesi piyasa ve bütçe fiyat denetimi',
    subDescInvoiceAI: 'Fatura, irsaliye ve çeklerden otomatik AI veri okuma',
    subDescDrive: 'Şantiyelere ait tüm orijinal fatura ve belgelerin bulut arşivi',
    subDescMaterialCompare: 'Tüm şantiyeler ve tedarikçiler arası birim fiyat matrisi',
    subDescSpecialMaterials: 'Demir, gazbeton, izolasyon metraj ve fiyat analizleri',
    subDescAnomalies: 'Birim fiyat sapmaları ve aşırı artış risk tespitleri',
    subDescJobsites: 'Şantiye projeleri, şef atamaları ve personel yönetimi',
    subDescPerformance: 'Satınalma şefleri tasarruf karnesi ve başarı puanları',
    activeModuleBadge: 'Aktif',

    // Badges
    badgeOverview: 'Özet & KPI',
    badgePreAudit: 'Ön Denetim & Koruma',
    badgeEntry: 'Giriş',
    badgeComparativeOffers: '1M+ ₽ TDF',
    badgeAutomation: 'Otomasyon',
    badgeWarning: 'Uyarı',
    badgeAnalysis: 'Analiz',
    badgeSpecial: 'Kritik Kalemler',
    badgeManagement: 'Yönetim',
    badgeCloud: 'Bulut Arşiv',
    badgeAdmin: '🔒 Yönetici Özel',

    // Discount Entry Form & Toast
    discountSuccessToast: '✅ İndirim kaydı başarıyla sisteme eklendi ve toplam tasarruf güncellendi!',
    discountSuccessSub: 'Şef performans puanları ve şantiye bütçesi otomatik olarak yenilendi.',
    reviewModalTitle: '🔍 İndirim Kaydı Kontrol & Ön İzleme Paneli',
    reviewModalSub: 'Lütfen kaydetmeden önce seçilen Satınalma Şefini ve Şantiyeyi kontrol ediniz. Yanlış seçim varsa buradan değiştirebilirsiniz.',
    confirmReviewBtn: '✔ Kontrol Edildi, Sisteme Kaydet',
    editReviewBtn: 'Forma Dön & Düzenle',
    editRecordTitle: '✏️ İndirim Kaydını Düzenle / Düzelt',
    editRecordSub: 'Yanlış girilen Satınalma Şefi, Şantiye, Tedarikçi veya Tutar bilgilerini güncelleyin.',
    updateDiscountBtn: 'Kayıt Bilgilerini Güncelle',
    deleteDiscountBtn: 'Kaydı Sil',
    confirmDeleteDiscount: 'Bu indirim kaydını silmek istediğinizden emin misiniz?',
    editDiscountSuccess: 'İndirim kaydı başarıyla güncellendi!',
    formTitle: 'Yeni Satınalma İndirim Girişi',
    formDesc: 'Satınalma şeflerinin tedarikçilerden sağladığı pazarlık ve özel indirim tutarlarını girin.',
    selectSupervisor: 'Satınalma Şefi Seçin',
    selectJobsite: 'Şantiye / Proje Seçin',
    selectCategory: 'Malzeme Kategorisi',
    materialName: 'Malzeme Adı / Açıklama',
    supplier: 'Tedarikçi Firma',
    listPrice: 'Liste / Teklif Birim Fiyatı (₽)',
    agreedPrice: 'Anlaşılan / İndirimli Birim Fiyat (₽)',
    quantity: 'Satınalma Miktarı',
    unit: 'Birim (Örn: т, шт, м³)',
    invoiceNumber: 'Fatura / İrsaliye Numarası',
    saveDiscountBtn: 'İndirim Kaydını Kaydet',
    earnedDiscount: 'Elde Edilen Toplam İndirim (Tasarruf)',

    // Material Comparison
    matCompareTitle: 'Ayrıntılı Malzeme Fiyat Karşılaştırma Matrisi',
    matCompareDesc: 'Tüm şantiyelerde satın alınan malzemeleri, birim fiyat farklarını, tedarikçileri ve Sistem Güvenli Bulut Arşivindeki orijinal fatura belgelerini alt alta ayrıntılı tablo halinde karşılaştırın.',
    searchPlaceholder: 'Malzeme adı, kodu veya kategori ara...',
    exportExcel: 'Excel İndir',
    mergeMaterials: 'Malzeme Birleştir',
    minUnitPrice: 'En Düşük Birim Fiyat',
    maxUnitPrice: 'En Yüksek Birim Fiyat',
    avgUnitPrice: 'Ortalama Birim Fiyat',
    priceGap: 'En Yüksek-En Düşük Farkı',
    examineInvoice: 'Faturayı İncele',
    openDocument: 'Belgeyi Aç',
    allInvoicesBreakdown: 'Tüm Satınalma ve Fatura Kayıtları Dökümü',

    // Invoice Scanner
    scanTitle: 'AI Otomatik Fatura / Çek Okuma & Muhasebeleştirme',
    registeredInvoices: 'Sistemde Kayıtlı Faturalar & Malzeme Kalemleri',
    invoiceTableDesc: 'Satıra tıklayarak faturadaki tüm malzemeleri, fiyatları ve Sistem Güvenli Bulut Arşivindeki orijinal belgesini inceleyebilirsiniz.',
    totalRegistered: 'Toplam Kayıtlı Fatura',
    inspectAndDrive: 'Detay & Belgeyi Aç',
    invoiceJobsiteLabel: '1. FATURANIN AİT OLDUĞU ŞANTİYE *',
    invoiceUploadUserLabel: 'FATURAYI YÜKLEYEN SATINALMA PERSONELİ *',
    invoiceDropLabel: '2. FATURA, TEKLİF VEYA EXCEL DOSYASINI SÜRÜKLEYİP BIRAKIN',
    invoiceDragBoxTitle: 'Fatura, PDF veya Excel Dosyası Sürükleyin',
    invoiceSupportedFormats: 'PNG, JPG, PDF, XLSX, XLS veya CSV formatları desteklenir',
    scanInvoiceAiBtn: 'Faturayı AI ile Tara ve Kalemleri Çıkar',
    aiScanningBtn: 'Yapay Zeka Faturayı Okuyor...',
    supportedTech: 'Desteklenen Teknolojiler',
    fileFormatsSupport: 'PDF & Fotoğraf & Görsel Desteği',
    excelUploadedSuccess: 'Excel tablosu başarıyla yüklendi ✓',
    fileUploadedSuccess: 'Dosya başarıyla yüklendi ✓',
    confirmAiResultTitle: 'Yapay Zeka Fatura Okuma Sonucu',
    confirmAiResultSub: 'Lütfen okunan faturayı kontrol edin ve doğrula butonuna basarak malzeme fiyat kıyaslama veri tabanına kaydedin.',
    aiExtractedBadge: 'AI Başarıyla Çıkardı',
    confirmSaveBtn: 'Onayla & Sisteme Kaydet',
    cancelBtn: 'İptal Et',
    extractedItemsCount: 'Okunan Malzeme Kalemleri',
    addedToComparison: 'Tüm şantiyelerin malzeme fiyat kıyaslamasına eklenecektir',
    matNameHead: 'Malzeme Adı',
    categoryHead: 'Kategori',
    unitHead: 'Birim',
    qtyHead: 'Miktar',
    unitPriceHead: 'Birim Fiyat (₽)',
    totalPriceHead: 'Toplam Tutar (₽)',
    itemsCountBadge: 'Kalem Malzeme',
    tableDateHead: 'Tarih',
    tableInvNoHead: 'Fatura No',
    tableJobsiteHead: 'Ait Olduğu Şantiye',
    tableSupplierHead: 'Tedarikçi',
    tableSupervisorHead: 'Yükleyen Şef',
    tableItemsHead: 'Okunan Kalemler',
    tableTotalHead: 'Toplam Tutar',
    tableActionHead: 'İşlem / Belge',

    // Submitted Modal
    submittedModalTitle: '✅ İndirim Kaydı Başarıyla Oluşturuldu!',
    submittedModalDesc: 'Pazarlık tutarı ve yüklenen belgeler Sistem Güvenli Bulut Arşivine ve veritabanına işlendi. Lütfen kaydı kontrol edin.',
    confirmAndCloseModal: 'Anlaşıldı, Tamamla',

    // Secure Admin Password Modal
    secureReportTitle: 'Güvenli Yönetici Erişimi',
    secureReportSub: 'Performans & İndirim Raporu',
    secureReportDesc: 'Bu rapor şeflerin özel pazarlık ve prim verilerini içerir. Görüntülemek için yönetici şifrenizi girin.',
    adminPassLabel: 'Yönetici Giriş Şifresi:',
    openReportBtn: 'Yönetici Raporunu Aç',
    secureReportNote: '🔒 Güvenli Veri Erişimi - Şifre yetkisi için sistem yöneticisine danışınız.',

    // Detailed Form Labels & Inputs
    supervisorLabel: 'Pazarlığı Yapan Satınalma Şefi *',
    jobsiteLabel: 'İlgili Şantiye / Proje *',
    vendorLabel: 'Tedarikçi / Firma Unvanı *',
    vendorPlaceholder: 'Örn: Diler Demir Çelik A.Ş. veya Çimsa Çimento',
    categoryLabel: 'Malzeme Kategorisi *',
    autoUploadModeBtn: 'Akıllı Çift Teklif Yükleme & Sistem Arşivi',
    manualModeBtn: 'Hızlı Manuel İndirim Formu',
    dualUploadTitle: 'Otomatik 2-Aşamalı Teklif Karşılaştırma Yükleyicisi',
    dualUploadSub: '1. Teklifi ve 2. İndirimli teklifi (PDF, Excel, Görsel) yükleyin. Sistem tutarları otomatik okuyup farkı hesaplayacaktır.',
    loadDemoPresetBtn: '⚡ Örnek Çift Teklif Yükle (1-Tık Demo)',
    firstOfferDocTitle: '1. İlk Gelen Teklif Belgesi',
    finalOfferDocTitle: '2. Son İndirimli Teklif / Fatura',
    postBargainBadge: 'Pazarlık Sonrası',
    uploadedBadge: 'Yüklendi',
    dragFirstOffer: '1. Teklifi Buraya Sürükleyin',
    firstOfferSub: 'Liste/İlk Fiyat Belgesi',
    firstOfferAmountLabel: 'Okunan / Girilen İlk Teklif Tutarı (₽):',
    dragFinalOffer: '2. İndirimli Teklifi Sürükleyin',
    finalOfferSub: 'Net Anlaşılan Fiyat Belgesi',
    finalOfferAmountLabel: 'Okunan / Girilen Pazarlık Sonrası Net Fiyat (₽):',
    driveArchiveActive: 'Sistem Güvenli Bulut Arşivleme Aktif',
    autoArchiveNote: 'Her iki teklif belgesi de şantiyenin sistem güvenli bulut klasörüne otomatik kaydedilecek.',
    netSavedDiscount: 'Net Kazanılan İndirim',
    discountRatio: 'Oran',
    manualSectionTitle: 'Manuel Fiyat & Pazarlık Tutarları (₽ Ruble)',
    firstOfferListPriceLabel: 'İlk Liste / Teklif Fiyatı (₽) *',
    orderDateLabel: 'Sipariş / Fatura Tarihi',
    optionalNotesLabel: 'Ek Notlar / Pazarlık Detayı',
    notesPlaceholder: 'Örn: Satınalma müdürü ile görüşülüp nakliye bedeli fiyata dahil ettirildi...',

    // Jobsites & Supervisors Component
    sysDefsTitle: 'Sistem Tanımları ve Yönetimi',
    jobsitesAndSups: 'Şantiyeler ve Satınalma Şefleri',
    jobsitesAndSupsDesc: 'Aktif projeleri, şantiye lokasyonlarını ve satınalma birimi yetkililerini yönetin, kart bilgilerini ve görevlerini güncelleyin.',
    addJobsiteBtn: 'Yeni Şantiye Ekle',
    addSupBtn: 'Yeni Şef Ekle',
    jobsitesTab: 'Şantiyeler',
    supervisorsTab: 'Satınalma Şefleri',
    editJobsite: 'Şantiyeyi Düzenle',
    editSupCard: 'Şef Kartını Düzenle / Görev Güncelle',
    projectManager: 'Proje Müdürü',
    totalBudget: 'Toplam Bütçe',
    locationNotSpecified: 'Adres Belirtilmedi',
    statusActive: 'Aktif',

    // Anomalies Component
    anomalyTitle: 'Tedarikçi Fiyat Artış & Sapma Paneli',
    anomalyDesc: 'Aynı firmadan alınan ürünlerdeki zamlar, şantiyeler arasındaki fahiş fiyat makasları ve pazarlıksız yüksek alımlar yapay zeka ve algoritmalarla anında tespit edilmektedir.',
    liveAlerts: 'Canlı Uyarılar',
    criticalHike: 'Kritik Fiyat Zammı',
    avoidableCost: 'Önlenebilecek Ekstra Maliyet',
    allAnomalyTypes: 'Tüm Anomali Türleri',
    sameVendorHike: 'Aynı Firmadan Fiyat Artışı',
    jobsiteGap: 'Şantiyeler Arası Fiyat Makası',
    zeroDiscountBigOrder: 'Pazarlıksız Büyük Sipariş',
    allRiskLevels: 'Tüm Risk Seviyeleri',
    criticalHikesOnly: '🔴 Yalnızca Kritik Artışlar',
    mediumWarning: '🟡 Orta Derece Uyarısı',
    actionRecommendation: '💡 Yönetici Aksiyon Önerisi',
    inspectCompare: 'Kıyaslamayı İncele',
    activeAnomaliesTab: 'İncelenecek Aktif Anomaliler',
    archivedAnomaliesTab: 'Yönetici Onaylı / Bilinenler (Arşiv)',
    approveAndArchive: 'Onayla & Arşivle',
    restoreToActive: 'Aktif Listeye Geri Al',
    approvedByManagerBadge: 'Yönetici Onaylı / Bilinen Fark',
    reasonMarketInflation: 'Piyasa Geneli Fiyat Artışı / Enflasyon',
    reasonSpecialSpec: 'Özel Şartname / Kalite / Standart Farkı',
    reasonUrgentJobsite: 'Acil Şantiye İhtiyacı / Tek Seferlik Sipariş',
    reasonLogisticsIncluded: 'Lojistik / Nakliye / Paketleme Maliyeti Dahil',
    reasonSupervisorAccepted: 'Şef Açıklaması İncelendi & Kabul Edildi',
    reasonLowValueConsumable: 'Düşük Tutarlı Sarf Malzeme / Önemsiz Fark',
    reasonOther: 'Diğer / Özel Yönetici Onayı',

    // Drive Vault Component
    driveVaultTitle: 'Şantiye Fatura Deposu & İndirim Arşivi',
    driveVaultDesc: 'Tüm şantiyelerin faturaları ve satınalma şeflerinin pazarlık sonrası elde ettiği 1. Teklif ve 2. Son İndirimli Teklif belgeleri sistem güvenli bulut arşivi klasör düzeninde depolanır.',
    uploadToDrive: 'Sistem Arşivine Belge Yükle',
    jobsiteFolders: 'Şantiye Bulut Klasörleri',
    discountArchive: 'Teklif & İndirim Arşivi',
    siteInvoices: 'Şantiye Faturaları',
    inspectInvoice: 'Faturayı Aç & İncele'
  },
  RU: {
    // Header & Brand
    appTitle: 'ЗАКУПКИ ПРО',
    appSubTitle: 'Эффективность и ИИ Автоматизация',
    appDesc: 'Управление объектами и анализ цен',
    addDiscountBtn: 'Добавить скидку',
    
    // Navbar Items & Groups
    navGroupDashboard: 'Обзор',
    navGroupProcurement: 'Закупки и Счета',
    navGroupAnalytics: 'Анализ цен и материалов',
    navGroupManagement: 'Объекты и Руководство',
    navDashboard: 'Обзор и Дашборд',
    navPreApprovalAudit: 'Быстрая предварительная проверка цен',
    navDiscountEntry: 'Ввод скидок и экономии',
    navComparativeOffers: 'Сравнительный анализ (1M+ ₽ TDF)',
    navInvoiceAI: 'ИИ Считывание счетов',
    navAnomalies: 'Аномалии и рост цен',
    navMaterialCompare: 'Сравнение цен на материалы',
    navJobsites: 'Объекты и Шефы',
    navSpecialMaterials: 'Спец. Анализ (Арматура, Газоблок)',
    navDrive: 'Хранилище счетов и документов',
    navPerformance: 'Отчет по эффективности',

    // Sub-item descriptions RU
    subDescDiscountEntry: 'Учет скидок от поставщиков и фиксация экономии',
    subDescComparativeOffers: 'Сравнительный анализ коммерческих предложений свыше 1 000 000 ₽',
    subDescPreAudit: 'Контроль рыночных цен до согласования счета',
    subDescInvoiceAI: 'Автоматическое ИИ распознавание счетов и накладных',
    subDescDrive: 'Облачное хранилище оригиналов счетов по объектам',
    subDescMaterialCompare: 'Матрица цен между объектами и поставщиками',
    subDescSpecialMaterials: 'Анализ ключевых материалов (арматура, блоки, изоляция)',
    subDescAnomalies: 'Контроль завышения цен и ценовых рисков',
    subDescJobsites: 'Управление строительными объектами и шефами',
    subDescPerformance: 'Рейтинг эффективности шефов и показатели экономии',
    activeModuleBadge: 'Активно',

    // Badges
    badgeOverview: 'KPI и Обзор',
    badgePreAudit: 'Предконтроль',
    badgeEntry: 'Ввод',
    badgeComparativeOffers: '1M+ ₽ TDF',
    badgeAutomation: 'Автоматизация',
    badgeWarning: 'Предупреждение',
    badgeAnalysis: 'Анализ',
    badgeSpecial: 'Ключевые материалы',
    badgeManagement: 'Управление',
    badgeCloud: 'Облако',
    badgeAdmin: '🔒 Для Руководства',

    // Discount Entry Form & Toast
    discountSuccessToast: '✅ Запись о скидке успешно добавлена и экономия рассчитана!',
    discountSuccessSub: 'Баллы шефа и бюджет объекта обновлены автоматически.',
    reviewModalTitle: '🔍 Панель проверки и предпросмотра скидки',
    reviewModalSub: 'Пожалуйста, проверьте выбранного шефа по закупкам и объект перед сохранением. Если произошла ошибка, вы можете изменить их прямо здесь.',
    confirmReviewBtn: '✔ Проверено, сохранить в систему',
    editReviewBtn: 'Вернуться к форме',
    editRecordTitle: '✏️ Редактировать / исправить запись о скидке',
    editRecordSub: 'Обновите ошибочно введенные данные о шефе по закупкам, объекте, поставщике или сумме.',
    updateDiscountBtn: 'Обновить данные записи',
    deleteDiscountBtn: 'Удалить запись',
    confirmDeleteDiscount: 'Вы уверены, что хотите удалить эту запись о скидке?',
    editDiscountSuccess: 'Запись о скидке успешно обновлена!',
    formTitle: 'Ввод новой скидки на закупку',
    formDesc: 'Введите суммы скидок и договоренностей с поставщиками.',
    selectSupervisor: 'Выберите шефа по закупкам',
    selectJobsite: 'Выберите объект / проект',
    selectCategory: 'Категория материала',
    materialName: 'Наименование материала / описание',
    supplier: 'Фирма-поставщик',
    listPrice: 'Прайсовая / Начальная цена за ед. (₽)',
    agreedPrice: 'Согласованная цена за ед. (₽)',
    quantity: 'Объем закупки',
    unit: 'Единица (Напр: т, шт, м³)',
    invoiceNumber: 'Номер счета / накладной',
    saveDiscountBtn: 'Сохранить скидку',
    earnedDiscount: 'Полученная скидка (Экономия)',

    // Material Comparison
    matCompareTitle: 'Детальная матрица сравнения цен на материалы',
    matCompareDesc: 'Сравнивайте материалы, разницу в ценах, поставщиков и оригиналы счетов в безопасном облачном архиве по всем объектам.',
    searchPlaceholder: 'Поиск по названию, коду или категории...',
    exportExcel: 'Скачать Excel',
    mergeMaterials: 'Объединить материалы',
    minUnitPrice: 'Мин. цена за ед.',
    maxUnitPrice: 'Макс. цена за ед.',
    avgUnitPrice: 'Средняя цена за ед.',
    priceGap: 'Разница макс-мин',
    examineInvoice: 'Просмотреть счет',
    openDocument: 'Открыть документ',
    allInvoicesBreakdown: 'Полный реестр закупок и счетов',

    // Invoice Scanner
    scanTitle: 'ИИ Автоматическое считывание счетов и обработка',
    registeredInvoices: 'Сохраненные счета и позиции материалов',
    invoiceTableDesc: 'Нажмите на строку, чтобы просмотреть все материалы в счете, цены и оригинал в безопасном архиве системы.',
    totalRegistered: 'Всего сохраненных счетов',
    inspectAndDrive: 'Детали и Открыть документ',
    invoiceJobsiteLabel: '1. ОБЪЕКТ, К КОТОРОМУ ОТНОСИТСЯ СЧЕТ *',
    invoiceUploadUserLabel: 'ШЕФ ПО ЗАКУПКАМ, ЗАГРУЗИВШИЙ СЧЕТ *',
    invoiceDropLabel: '2. ПЕРЕТАЩИТЕ СЧЕТ, КП ИЛИ EXCEL ФАЙЛ',
    invoiceDragBoxTitle: 'Перетащите счет, PDF или Excel файл',
    invoiceSupportedFormats: 'Поддерживаются форматы PNG, JPG, PDF, XLSX, XLS или CSV',
    scanInvoiceAiBtn: 'Считать счет с помощью ИИ и распознать позиции',
    aiScanningBtn: 'ИИ считывает счет...',
    supportedTech: 'Поддерживаемые технологии',
    fileFormatsSupport: 'Поддержка PDF, снимков и изображений',
    excelUploadedSuccess: 'Таблица Excel успешно загружена ✓',
    fileUploadedSuccess: 'Файл успешно загружен ✓',
    confirmAiResultTitle: 'Результат распознавания счета ИИ',
    confirmAiResultSub: 'Проверьте распознанный счет и нажмите «Подтвердить», чтобы сохранить в базу данных сравнения цен.',
    aiExtractedBadge: 'ИИ успешно извлек данные',
    confirmSaveBtn: 'Подтвердить и сохранить в систему',
    cancelBtn: 'Отмена',
    extractedItemsCount: 'Распознанные позиции материалов',
    addedToComparison: 'Будет добавлено в реестр сравнения цен по всем объектам',
    matNameHead: 'Наименование материала',
    categoryHead: 'Категория',
    unitHead: 'Единица',
    qtyHead: 'Количество',
    unitPriceHead: 'Цена за ед. (₽)',
    totalPriceHead: 'Итоговая сумма (₽)',
    itemsCountBadge: 'позиций',
    tableDateHead: 'Дата',
    tableInvNoHead: 'Номер счета',
    tableJobsiteHead: 'Объект',
    tableSupplierHead: 'Поставщик',
    tableSupervisorHead: 'Шеф по закупкам',
    tableItemsHead: 'Позиции',
    tableTotalHead: 'Сумма',
    tableActionHead: 'Действие / Файл',

    // Submitted Modal
    submittedModalTitle: '✅ Запись о скидке успешно создана!',
    submittedModalDesc: 'Сумма скидки и файлы внесены в архив системы и базу данных. Проверьте сохраненные данные.',
    confirmAndCloseModal: 'Понятно, завершить',

    // Secure Admin Password Modal
    secureReportTitle: 'Безопасный доступ руководителя',
    secureReportSub: 'Отчет по эффективности и скидкам',
    secureReportDesc: 'Этот отчет содержит конфиденциальные данные шефов. Введите пароль руководителя для просмотра.',
    adminPassLabel: 'Пароль руководителя:',
    openReportBtn: 'Открыть отчет руководителя',
    secureReportNote: '🔒 Защищенный доступ - Для получения пароля обратитесь к администратору.',

    // Detailed Form Labels & Inputs
    supervisorLabel: 'Шеф по закупкам (провел переговоры) *',
    jobsiteLabel: 'Объект строительства / Проект *',
    vendorLabel: 'Поставщик / Название компании *',
    vendorPlaceholder: 'Напр: ООО Северсталь или ЦЕМРОС',
    categoryLabel: 'Категория материала *',
    autoUploadModeBtn: 'Загрузка 2-х КП и архив системы',
    manualModeBtn: 'Быстрая ручная форма скидки',
    dualUploadTitle: 'Автоматическая загрузка двух коммерческих предложений',
    dualUploadSub: 'Загрузите первое КП и итоговое КП со скидкой (PDF, Excel, фото). Система сравнит цены и рассчитает скидку.',
    loadDemoPresetBtn: '⚡ Загрузить демо 2-х КП (в 1 клик)',
    firstOfferDocTitle: '1. Первичное КП / Прайс',
    finalOfferDocTitle: '2. Итоговое КП со скидкой / Счет',
    postBargainBadge: 'После скидки',
    uploadedBadge: 'Загружено',
    dragFirstOffer: '1. Перетащите первое КП сюда',
    firstOfferSub: 'Первичный прайс-лист',
    firstOfferAmountLabel: 'Сумма первичного КП (₽):',
    dragFinalOffer: '2. Перетащите итоговое КП со скидкой',
    finalOfferSub: 'Итоговая согласованная цена',
    finalOfferAmountLabel: 'Согласованная итоговая сумма (₽):',
    driveArchiveActive: 'Авто-архивация в безопасное хранилище активна',
    autoArchiveNote: 'Оба документа КП будут автоматически сохранены в защищенную папку объекта.',
    netSavedDiscount: 'Итоговая экономия',
    discountRatio: 'Процент скидки',
    manualSectionTitle: 'Ручной ввод цен и сумм скидок (₽ Рубли)',
    firstOfferListPriceLabel: 'Первоначальная цена КП (₽) *',
    orderDateLabel: 'Дата заказа / счета',
    optionalNotesLabel: 'Примечания / Детали переговоров',
    notesPlaceholder: 'Напр: Согласована скидка с учетом бесплатной доставки...',

    // Jobsites & Supervisors Component
    sysDefsTitle: 'Системные настройки и управление',
    jobsitesAndSups: 'Объекты и Шефы по закупкам',
    jobsitesAndSupsDesc: 'Управляйте активными объектами, локациями и шефами по закупкам, обновляйте карточки и должности.',
    addJobsiteBtn: 'Добавить объект',
    addSupBtn: 'Добавить шефа',
    jobsitesTab: 'Объекты строительства',
    supervisorsTab: 'Шефы по закупкам',
    editJobsite: 'Редактировать объект',
    editSupCard: 'Редактировать карточку шефа',
    projectManager: 'Руководитель проекта',
    totalBudget: 'Общий бюджет',
    locationNotSpecified: 'Адрес не указан',
    statusActive: 'Активный',

    // Anomalies Component
    anomalyTitle: 'Панель аномалий и повышения цен поставщиков',
    anomalyDesc: 'Повышения цен от одного поставщика, разница цен между объектами и закупки без скидок мгновенно выявляются ИИ.',
    liveAlerts: 'Живые уведомления',
    criticalHike: 'Критическое повышение цены',
    avoidableCost: 'Предотвратимые доп. расходы',
    allAnomalyTypes: 'Все типы аномалий',
    sameVendorHike: 'Повышение цены от поставщика',
    jobsiteGap: 'Разрыв цен между объектами',
    zeroDiscountBigOrder: 'Крупный заказ без скидки',
    allRiskLevels: 'Все уровни риска',
    criticalHikesOnly: '🔴 Только критические росты',
    mediumWarning: '🟡 Средний уровень риска',
    actionRecommendation: '💡 Рекомендация руководителю',
    inspectCompare: 'Изучить сравнение',
    activeAnomaliesTab: 'Активные аномалии на проверку',
    archivedAnomaliesTab: 'Подтверждено руководством / Архив',
    approveAndArchive: 'Подтвердить и архивировать',
    restoreToActive: 'Вернуть в активные',
    approvedByManagerBadge: 'Подтверждено руководством',
    reasonMarketInflation: 'Общерыночный рост цен / инфляция',
    reasonSpecialSpec: 'Специальная спецификация / качество',
    reasonUrgentJobsite: 'Срочная потребность объекта',
    reasonLogisticsIncluded: 'Включая логистику и доставку',
    reasonSupervisorAccepted: 'Объяснение шефа принято',
    reasonLowValueConsumable: 'Малоценный расходный материал',
    reasonOther: 'Другое / решение руководителя',

    // Drive Vault Component
    driveVaultTitle: 'Хранилище счетов и архив скидок системы',
    driveVaultDesc: 'Счета всех объектов и полученные коммерческие предложения шефов сохраняются в структурированном виде в защищенном облачном архиве.',
    uploadToDrive: 'Загрузить в архив системы',
    jobsiteFolders: 'Облачные папки объектов',
    discountArchive: 'Архив КП и скидок',
    siteInvoices: 'Счета объектов',
    inspectInvoice: 'Открыть и изучить счет'
  }
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'TR',
  setLanguage: () => {},
  t: (key: string) => translations['TR']?.[key] || key,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ges_app_lang') : null;
      if (saved === 'TR' || saved === 'RU') return saved;
    } catch (_) {}
    return 'TR';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('ges_app_lang', lang);
      }
    } catch (_) {}
  };

  const t = (key: string): string => {
    return translations[language]?.[key] || translations['TR']?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);

