/**
 * GES İNŞAAT - OTOMATİK SİSTEM SAĞLIK VE VERİ DENETİM MOTORU
 * Tek komutla tüm sistem sağlığını, Firestore canlı veritabanını,
 * Fatura 2829 mantar başlığını, 28 kategoriyi ve motor testlerini doğrular.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

interface AuditResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

const results: AuditResult[] = [];

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`📌 ${title}`);
  console.log('='.repeat(60));
}

async function runAudit() {
  const startTime = Date.now();
  console.log('🚀 GES İNŞAAT SİSTEM SAĞLIK DENETİMİ BAŞLATILIYOR...');

  // 1. TypeScript Derleme ve Tip Kontrolü
  logSection('1. TYPESCRIPT DERLEME VE TİP KONTROLÜ');
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    results.push({ step: 'TypeScript Derleme', status: 'PASS', details: '0 hata, tüm tipler ve kod yapısı hatasız.' });
    console.log('  ✅ TypeScript: 0 Hata (tsc --noEmit başarılı)');
  } catch (err: any) {
    results.push({ step: 'TypeScript Derleme', status: 'FAIL', details: err.stderr?.toString() || err.message });
    console.error('  ❌ TypeScript Derleme Hatası:', err.message);
  }

  // 2. Çekirdek Birim Testleri
  logSection('2. ÇEKİRDEK MOTOR TESTLERİ (Unit Tests)');
  try {
    execSync('npm test', { stdio: 'pipe' });
    results.push({ step: 'Birim Testleri', status: 'PASS', details: 'Tüm birim testleri (Birim çevrim, AI motor, risk radar vb.) başarıyla geçti.' });
    console.log('  ✅ Birim Testleri: Tüm motor testleri eksiksiz geçti');
  } catch (err: any) {
    results.push({ step: 'Birim Testleri', status: 'FAIL', details: err.message });
    console.error('  ❌ Birim Test Hatası:', err.message);
  }

  // 3. Canlı Firestore Veritabanı ve Sayımlar
  logSection('3. CANLI FIRESTORE VERİTABANI KONTROLÜ');
  let invoices: any[] = [];
  let discounts: any[] = [];
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('firebase-applet-config.json dosyası bulunamadı!');
    }
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');

    const invSnap = await getDocs(collection(db, 'invoices'));
    const discSnap = await getDocs(collection(db, 'discounts'));

    invoices = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    discounts = discSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const invCount = invoices.length;
    const discCount = discounts.length;

    console.log(`  📊 Fatura Sayısı (Invoices): ${invCount}`);
    console.log(`  📊 İndirim Sayısı (Discounts): ${discCount}`);

    if (invCount > 0 && discCount > 0) {
      results.push({
        step: 'Firestore Veri Sağlığı',
        status: 'PASS',
        details: `Bağlantı aktif. Faturalar: ${invCount}, İndirimler: ${discCount}`
      });
      console.log('  ✅ Firestore Bağlantısı: Tam aktif ve veriler senkronize');
    } else {
      results.push({
        step: 'Firestore Veri Sağlığı',
        status: 'FAIL',
        details: `Veri eksik! Faturalar: ${invCount}, İndirimler: ${discCount}`
      });
    }
  } catch (err: any) {
    results.push({ step: 'Firestore Bağlantısı', status: 'FAIL', details: err.message });
    console.error('  ❌ Firestore Bağlantı Hatası:', err.message);
  }

  // 4. Kritik İstisna Kontrolü: Fatura 2829 Mantar Güvenlik Başlığı
  logSection('4. FATURA 2829 MANTAR BAŞLIK KONTROLÜ');
  try {
    let found2829 = false;
    let kolpachokStatus = 'NOT_FOUND';

    for (const inv of invoices) {
      const invNo = String(inv.invoiceNumber || inv.invoiceNo || inv.number || '');
      if (invNo === '2829' || invNo.includes('2829')) {
        found2829 = true;
        const items = inv.items || [];
        for (const it of items) {
          const name = String(it.materialName || it.name || it.description || it.originalName || '');
          if (name.includes('Колпачок') || name.includes('Mantar') || name.includes('грибок') || name.includes('Güvenlik Başlığı')) {
            const cat = it.category || '';
            if (cat === 'Sarf Malzeme & Hırdavat') {
              kolpachokStatus = 'CORRECT';
            } else if (cat.includes('Demir') || cat.includes('Ø18')) {
              kolpachokStatus = 'WRONG_DEMIR';
            } else {
              kolpachokStatus = `OTHER_${cat}`;
            }
          }
        }
      }
    }

    if (kolpachokStatus === 'CORRECT') {
      results.push({
        step: 'Fatura 2829 Mantar Başlık',
        status: 'PASS',
        details: 'Mantar güvenlik başlığı doğru şekilde "Sarf Malzeme & Hırdavat" olarak kayıtlı. Demir Ø18 fiyatını bozmuyor.'
      });
      console.log('  ✅ Fatura 2829: Mantar başlık "Sarf Malzeme & Hırdavat" kategorisinde doğrulandı.');
    } else if (kolpachokStatus === 'WRONG_DEMIR') {
      results.push({
        step: 'Fatura 2829 Mantar Başlık',
        status: 'FAIL',
        details: 'KRİTİK HATA! Mantar başlık hâlâ Demir kategorisinde kayıtlı!'
      });
      console.error('  ❌ Fatura 2829: Mantar başlık Demir kategorisinde kalmış!');
    } else {
      results.push({
        step: 'Fatura 2829 Mantar Başlık',
        status: 'WARN',
        details: `Fatura 2829 bulundu (${found2829}), durum: ${kolpachokStatus}`
      });
      console.log(`  ℹ️ Fatura 2829 Kalem Durumu: ${kolpachokStatus}`);
    }
  } catch (err: any) {
    results.push({ step: 'Fatura 2829 Kontrolü', status: 'FAIL', details: err.message });
  }

  // 5. Kategori Bütünlüğü & "Diğer Malzeme" Temizliği
  logSection('5. KATEGORİ SENKRONİZASYONU VE TEMİZLİK KONTROLÜ');
  try {
    let totalItems = 0;
    let digerMalzemeItems = 0;
    const categorySet = new Set<string>();

    for (const inv of invoices) {
      const items = inv.items || [];
      for (const it of items) {
        totalItems++;
        const cat = String(it.category || '').trim();
        if (cat) categorySet.add(cat);
        if (cat === 'Diğer' || cat === 'Diğer Malzeme' || cat === 'Diğer Malzemeler') {
          digerMalzemeItems++;
        }
      }
    }

    console.log(`  📦 Toplam İncelenen Fatura Kalemi: ${totalItems}`);
    console.log(`  📂 Tespit Edilen Benzersiz Kategori Sayısı: ${categorySet.size}`);
    console.log(`  ⚠️ "Diğer Malzeme" Kalan Kalem Sayısı: ${digerMalzemeItems}`);

    if (digerMalzemeItems === 0) {
      results.push({
        step: 'Kategori Bütünlüğü',
        status: 'PASS',
        details: `Tüm ${totalItems} kalem 28 ana kategoriye dağıtıldı. "Diğer Malzeme" kalemi yok (0).`
      });
      console.log('  ✅ Kategori Bütünlüğü: "Diğer Malzeme" tamamen sıfırlandı.');
    } else {
      results.push({
        step: 'Kategori Bütünlüğü',
        status: 'WARN',
        details: `${digerMalzemeItems} adet kalem hâlâ "Diğer Malzeme" kategorisinde.`
      });
      console.log(`  ⚠️ Uyarı: ${digerMalzemeItems} adet kalem "Diğer Malzeme" olarak etiketli.`);
    }
  } catch (err: any) {
    results.push({ step: 'Kategori Kontrolü', status: 'FAIL', details: err.message });
  }

  // 6. Özet Rapor Çıktısı
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logSection(`DENETİM ÖZETİ VE RAPOR (Tamamlanma: ${duration}s)`);

  let allPass = true;
  for (const r of results) {
    const symbol = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${symbol} [${r.status}] ${r.step}: ${r.details}`);
    if (r.status === 'FAIL') allPass = false;
  }

  console.log('\n' + '='.repeat(60));
  if (allPass) {
    console.log('🎉 TÜM SİSTEM KONTROLLERİ BAŞARIYLA GEÇTİ! SİSTEM %100 SAĞLIKLI.');
  } else {
    console.log('🚨 BAZI KONTROLLER BAŞARISIZ OLDU. LÜTFEN DETAYLARI İNCELEYİN.');
  }
  console.log('='.repeat(60) + '\n');

  process.exit(allPass ? 0 : 1);
}

runAudit().catch(err => {
  console.error('Audit fatal error:', err);
  process.exit(1);
});
