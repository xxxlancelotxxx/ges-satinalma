import { formatRuble } from './format';

export interface DashboardHtmlReportParams {
  kpis: {
    totalSpend: number;
    spendChangePercentage: number;
    totalDiscount: number;
    discountChangePercentage: number;
    avgDiscountRate: number;
    discountRateChangePercentage: number;
    activeJobsitesCount: number;
    supervisorsCount: number;
    anomaliesCount: number;
    pendingTransactionsCount: number;
    totalTransactionsCount: number;
    invoicesCount: number;
    discountsCount: number;
  };
  filterInfo: {
    dateRangeLabel: string;
    jobsiteLabel: string;
    categoryLabel: string;
  };
  jobsiteSpending: Array<{
    jobsiteId: string;
    jobsiteName: string;
    spend: number;
    percentage: number;
    invoiceCount: number;
    budget: number;
    budgetUsagePercentage: number;
  }>;
  categorySpending: Array<{
    category: string;
    spend: number;
    percentage: number;
    itemCount: number;
  }>;
  supervisorPerformance: Array<{
    supervisorId: string;
    supervisorName: string;
    totalDiscount: number;
    totalSpend: number;
    avgDiscountPercentage: number;
    transactionCount: number;
  }>;
  recentTransactions: Array<{
    date: string;
    type: 'INVOICE' | 'DISCOUNT';
    invoiceNumber?: string;
    title?: string;
    supplier: string;
    category?: string;
    materialSummary?: string;
    jobsiteName: string;
    supervisorName: string;
    performedByPersonnelName?: string;
    initialPrice?: number;
    amount: number;
    discountAmount?: number;
    discountPercentage?: number;
    recordOriginType?: string;
    status: string;
  }>;
}

export function generateDashboardHtmlReport(data: DashboardHtmlReportParams): string {
  const {
    kpis,
    filterInfo,
    jobsiteSpending = [],
    categorySpending = [],
    supervisorPerformance = [],
    recentTransactions = []
  } = data;

  const now = new Date();
  const dateStr = now.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // Calculate totals
  const totalCategorySpend = categorySpending.reduce((acc, c) => acc + (c.spend || 0), 0);
  const totalJobsiteSpend = jobsiteSpending.reduce((acc, j) => acc + (j.spend || 0), 0);
  const totalSuperSavings = supervisorPerformance.reduce((acc, s) => acc + (s.totalDiscount || 0), 0);

  // Rows for Categories
  const categoryRows = categorySpending.map((cat, idx) => {
    const pct = Number(cat.percentage || 0).toFixed(1);
    return `
      <tr>
        <td style="padding: 10px 14px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${idx < 4 ? '#4f46e5' : '#94a3b8'}; margin-right: 8px;"></span>
          ${cat.category || 'Diğer'}
        </td>
        <td style="padding: 10px 14px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: #1e293b; border-bottom: 1px solid #f1f5f9;">
          ${formatRuble(cat.spend)}
        </td>
        <td style="padding: 10px 14px; text-align: right; border-bottom: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
            <div style="flex: 1; max-width: 90px; height: 7px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${Math.min(100, Math.max(0, Number(pct)))}%; height: 100%; background: #4f46e5; border-radius: 4px;"></div>
            </div>
            <span style="font-weight: 700; color: #4338ca; min-width: 44px;">%${pct}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; text-align: center; color: #475569; font-weight: 600; border-bottom: 1px solid #f1f5f9;">
          ${cat.itemCount || 0}
        </td>
      </tr>
    `;
  }).join('');

  // Rows for Jobsites
  const jobsiteRows = jobsiteSpending.map((site) => {
    const pct = Number(site.percentage || 0).toFixed(1);
    const hasBudget = site.budget > 0;
    const usagePct = hasBudget ? Number(site.budgetUsagePercentage || 0).toFixed(1) : '-';
    return `
      <tr>
        <td style="padding: 10px 14px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">
          🏗️ ${site.jobsiteName}
        </td>
        <td style="padding: 10px 14px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: #1e293b; border-bottom: 1px solid #f1f5f9;">
          ${formatRuble(site.spend)}
        </td>
        <td style="padding: 10px 14px; text-align: right; border-bottom: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
            <div style="flex: 1; max-width: 90px; height: 7px; background: #f1f5f9; border-radius: 4px; overflow: hidden;">
              <div style="width: ${Math.min(100, Math.max(0, Number(pct)))}%; height: 100%; background: #0284c7; border-radius: 4px;"></div>
            </div>
            <span style="font-weight: 700; color: #0369a1; min-width: 44px;">%${pct}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; text-align: center; color: #475569; font-weight: 600; border-bottom: 1px solid #f1f5f9;">
          ${site.invoiceCount || 0}
        </td>
        <td style="padding: 10px 14px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #64748b; border-bottom: 1px solid #f1f5f9;">
          ${hasBudget ? formatRuble(site.budget) : '—'}
        </td>
        <td style="padding: 10px 14px; text-align: center; font-weight: 700; color: ${hasBudget && Number(usagePct) > 90 ? '#dc2626' : '#059669'}; border-bottom: 1px solid #f1f5f9;">
          ${hasBudget ? `%${usagePct}` : '—'}
        </td>
      </tr>
    `;
  }).join('');

  // Rows for Supervisors
  const supervisorRows = supervisorPerformance.map((sup, idx) => {
    const avgPct = Number(sup.avgDiscountPercentage || 0).toFixed(1);
    const badgeColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#64748b';
    return `
      <tr>
        <td style="padding: 10px 14px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #f1f5f9;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; background-color: ${badgeColor}; color: #ffffff; font-size: 11px; margin-right: 8px;">
            ${idx + 1}
          </span>
          ${sup.supervisorName}
        </td>
        <td style="padding: 10px 14px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 800; color: #059669; border-bottom: 1px solid #f1f5f9;">
          ${formatRuble(sup.totalDiscount)}
        </td>
        <td style="padding: 10px 14px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #475569; border-bottom: 1px solid #f1f5f9;">
          ${formatRuble(sup.totalSpend)}
        </td>
        <td style="padding: 10px 14px; text-align: center; font-weight: 700; color: #2563eb; border-bottom: 1px solid #f1f5f9;">
          %${avgPct}
        </td>
        <td style="padding: 10px 14px; text-align: center; color: #475569; font-weight: 600; border-bottom: 1px solid #f1f5f9;">
          ${sup.transactionCount || 0}
        </td>
      </tr>
    `;
  }).join('');

  // Rows for Recent Transactions (up to 40)
  const txList = recentTransactions.slice(0, 40);
  const transactionRows = txList.map((tx) => {
    const isInvoice = tx.type === 'INVOICE';
    const typeBadge = isInvoice
      ? '<span style="background: #e0f2fe; color: #0369a1; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 700;">Fatura</span>'
      : '<span style="background: #dcfce7; color: #15803d; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 700;">İndirim</span>';
    
    const supervisorLabel = tx.performedByPersonnelName 
      ? `${tx.supervisorName} <span style="color: #64748b; font-size: 11px;">(${tx.performedByPersonnelName})</span>`
      : tx.supervisorName;

    return `
      <tr style="font-size: 12px;">
        <td style="padding: 8px 12px; color: #64748b; white-space: nowrap; border-bottom: 1px solid #f1f5f9;">${tx.date || '-'}</td>
        <td style="padding: 8px 12px; text-align: center; border-bottom: 1px solid #f1f5f9;">${typeBadge}</td>
        <td style="padding: 8px 12px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${tx.supplier || '-'}</td>
        <td style="padding: 8px 12px; color: #475569; border-bottom: 1px solid #f1f5f9;">
          <span style="display: inline-block; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #334155;">
            ${tx.category || 'Genel'}
          </span>
        </td>
        <td style="padding: 8px 12px; color: #0f172a; font-weight: 600; border-bottom: 1px solid #f1f5f9;">${tx.jobsiteName || '-'}</td>
        <td style="padding: 8px 12px; color: #334155; border-bottom: 1px solid #f1f5f9;">${supervisorLabel}</td>
        <td style="padding: 8px 12px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: #0f172a; border-bottom: 1px solid #f1f5f9;">
          ${formatRuble(tx.amount)}
        </td>
        <td style="padding: 8px 12px; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: #059669; border-bottom: 1px solid #f1f5f9;">
          ${tx.discountAmount && tx.discountAmount > 0 ? formatRuble(tx.discountAmount) : '—'}
        </td>
        <td style="padding: 8px 12px; text-align: center; font-weight: 700; color: #2563eb; border-bottom: 1px solid #f1f5f9;">
          ${tx.discountPercentage && tx.discountPercentage > 0 ? `%${Number(tx.discountPercentage).toFixed(1)}` : '—'}
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GES Construction - Genel Bakış ve Satınalma Raporu (${dateStr})</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.5;
      padding: 32px 20px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-card {
      max-width: 1200px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);
      overflow: hidden;
    }
    .header-banner {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #312e81 100%);
      color: #ffffff;
      padding: 36px 40px;
      border-bottom: 3px solid #4f46e5;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 20px;
    }
    .brand-title {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }
    .brand-subtitle {
      color: #94a3b8;
      font-size: 13px;
      margin-top: 6px;
      font-weight: 500;
    }
    .meta-box {
      text-align: right;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 12px 18px;
    }
    .meta-label { font-size: 11px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; }
    .meta-val { font-size: 14px; font-weight: 700; color: #ffffff; margin-top: 2px; }

    .filter-strip {
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      font-size: 12px;
    }
    .filter-item { display: flex; align-items: center; gap: 6px; color: #cbd5e1; }
    .filter-pill {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
      padding: 3px 10px;
      border-radius: 6px;
      font-weight: 700;
    }

    .content-body { padding: 36px 40px; }

    /* KPIs */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px 20px;
      position: relative;
    }
    .kpi-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
    .kpi-amount { font-size: 22px; font-weight: 900; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #0f172a; }
    .kpi-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      margin-top: 6px;
    }
    .kpi-badge-positive { background: #dcfce7; color: #15803d; }
    .kpi-badge-neutral { background: #f1f5f9; color: #475569; }

    /* Section layout */
    .section-title {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .two-col-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(480px, 1fr));
      gap: 28px;
      margin-bottom: 36px;
    }

    /* Table styles */
    .table-container {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    thead th {
      background: #f8fafc;
      color: #475569;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 14px;
      border-bottom: 2px solid #e2e8f0;
    }

    .footer-bar {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
      color: #94a3b8;
    }

    @media print {
      body { background: #ffffff; padding: 0; }
      .report-card { border: none; box-shadow: none; border-radius: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

  <div style="max-width: 1200px; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; gap: 10px;" class="no-print">
    <button onclick="window.print()" style="padding: 8px 16px; background: #0f172a; color: #ffffff; border: none; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer;">
      🖨️ Yazdır / PDF Olarak Kaydet
    </button>
  </div>

  <div class="report-card">
    <!-- Header -->
    <div class="header-banner">
      <div class="header-top">
        <div>
          <div class="brand-title">GES CONSTRUCTION & INVESTMENT</div>
          <div class="brand-subtitle">Satınalma Genel Bakış, Kategori Harcama & Şefler Arası Rekabet İcra Raporu</div>
        </div>
        <div class="meta-box">
          <div class="meta-label">Rapor Tarihi & Saati</div>
          <div class="meta-val">${dateStr} • ${timeStr}</div>
        </div>
      </div>

      <div class="filter-strip">
        <div class="filter-item">
          <span>📅 Dönem:</span>
          <span class="filter-pill">${filterInfo.dateRangeLabel || 'Tüm Zamanlar'}</span>
        </div>
        <div class="filter-item">
          <span>🏗️ Şantiye:</span>
          <span class="filter-pill">${filterInfo.jobsiteLabel || 'Tüm Şantiyeler'}</span>
        </div>
        <div class="filter-item">
          <span>🏷️ Kategori:</span>
          <span class="filter-pill">${filterInfo.categoryLabel || 'Tüm Kategoriler'}</span>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="content-body">
      
      <!-- Top KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card" style="border-top: 3px solid #4f46e5;">
          <div class="kpi-title">Toplam Satınalma Harcaması</div>
          <div class="kpi-amount">${formatRuble(kpis.totalSpend)}</div>
          <span class="kpi-badge ${kpis.spendChangePercentage >= 0 ? 'kpi-badge-positive' : 'kpi-badge-neutral'}">
            Değişim: %${kpis.spendChangePercentage || 0}
          </span>
        </div>

        <div class="kpi-card" style="border-top: 3px solid #059669;">
          <div class="kpi-title">Toplam Kazanılan Tasarruf</div>
          <div class="kpi-amount" style="color: #059669;">${formatRuble(kpis.totalDiscount)}</div>
          <span class="kpi-badge kpi-badge-positive">
            Tasarruf: %${kpis.discountChangePercentage || 0}
          </span>
        </div>

        <div class="kpi-card" style="border-top: 3px solid #0284c7;">
          <div class="kpi-title">Ortalama Tasarruf Oranı</div>
          <div class="kpi-amount" style="color: #0284c7;">%${Number(kpis.avgDiscountRate || 0).toFixed(2)}</div>
          <span class="kpi-badge kpi-badge-positive">
            İskonto Başarısı
          </span>
        </div>

        <div class="kpi-card" style="border-top: 3px solid #d97706;">
          <div class="kpi-title">Aktif Şantiye & Şef</div>
          <div class="kpi-amount">${kpis.activeJobsitesCount || 0} Şantiye</div>
          <span class="kpi-badge kpi-badge-neutral">
            ${kpis.supervisorsCount || 0} Satınalma Şefi
          </span>
        </div>

        <div class="kpi-card" style="border-top: 3px solid #8b5cf6;">
          <div class="kpi-title">Toplam İşlem Adedi</div>
          <div class="kpi-amount">${kpis.totalTransactionsCount || 0}</div>
          <span class="kpi-badge kpi-badge-neutral">
            ${kpis.invoicesCount || 0} Fatura + ${kpis.discountsCount || 0} İndirim
          </span>
        </div>
      </div>

      <!-- Two column section: Category Spending & Jobsite Spending -->
      <div class="two-col-grid">
        <!-- Categories -->
        <div>
          <div class="section-title">
            <span>🏷️ Kategori Bazlı Harcama Dağılımı</span>
            <span style="font-size: 11px; font-weight: 600; color: #64748b;">(Özel İnşaat Demiri, Donatı, Çelik vb.)</span>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Kategori</th>
                  <th style="text-align: right;">Harcama (₽)</th>
                  <th style="text-align: right;">Pay (%)</th>
                  <th style="text-align: center;">Kalem</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRows || '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #94a3b8;">Veri bulunamadı</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Jobsites -->
        <div>
          <div class="section-title">
            <span>🏗️ Şantiye Bazlı Harcama ve Bütçe Durumu</span>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Şantiye</th>
                  <th style="text-align: right;">Harcama (₽)</th>
                  <th style="text-align: right;">Pay (%)</th>
                  <th style="text-align: center;">Fatura</th>
                  <th style="text-align: right;">Bütçe</th>
                  <th style="text-align: center;">Kullanım</th>
                </tr>
              </thead>
              <tbody>
                ${jobsiteRows || '<tr><td colspan="6" style="padding: 16px; text-align: center; color: #94a3b8;">Veri bulunamadı</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Supervisors Table -->
      <div style="margin-bottom: 36px;">
        <div class="section-title">
          <span>🏆 Satınalma Şefleri Tasarruf Performansı & Rekabet Sıralaması</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Sıra / Şef Adı</th>
                <th style="text-align: right;">Kazanılan Toplam İndirim (₽)</th>
                <th style="text-align: right;">Yapılan Satınalma (₽)</th>
                <th style="text-align: center;">Ortalama İskonto</th>
                <th style="text-align: center;">İşlem Adedi</th>
              </tr>
            </thead>
            <tbody>
              ${supervisorRows || '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #94a3b8;">Veri bulunamadı</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Recent Transactions (Sample) -->
      <div>
        <div class="section-title">
          <span>📋 Son İşlemler ve Kayıtlar (Fatura ve Müzakereler - İlk 40 Kayıt)</span>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Tarih</th>
                <th style="text-align: center;">Tür</th>
                <th>Tedarikçi</th>
                <th>Kategori</th>
                <th>Şantiye</th>
                <th>Yetkili Şef</th>
                <th style="text-align: right;">Tutar (₽)</th>
                <th style="text-align: right;">İndirim (₽)</th>
                <th style="text-align: center;">İskonto</th>
              </tr>
            </thead>
            <tbody>
              ${transactionRows || '<tr><td colspan="9" style="padding: 16px; text-align: center; color: #94a3b8;">Kayıt bulunamadı</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer-bar">
        <div>GES CONSTRUCTION & INVESTMENT • SATINALMA DİREKTÖRLÜĞÜ</div>
        <div>Gizlilik Derecesi: Şirket İçi / Yönetim İcra Raporu • ${dateStr}</div>
      </div>

    </div>
  </div>

</body>
</html>`;
}

export function exportDashboardToHtml(data: DashboardHtmlReportParams): void {
  const htmlContent = generateDashboardHtmlReport(data);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `GESCONS_Genel_Bakis_Raporu_${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
