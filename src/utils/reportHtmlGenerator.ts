import { formatRuble } from './format';

export interface ExecutiveReportParams {
  performances: any[];
  discounts: any[];
  supervisors: any[];
  jobsites: any[];
  personnel: any[];
  totalDiscount: number;
  totalListPrice: number;
  totalAgreedPrice: number;
  overallAvgDiscountPct: number;
  topSupervisor?: any;
  generatedBy?: string;
}

export function generateExecutiveHtmlReport(params: ExecutiveReportParams): string {
  const {
    performances = [],
    discounts = [],
    totalDiscount = 0,
    totalListPrice = 0,
    totalAgreedPrice = 0,
    overallAvgDiscountPct = 0,
    topSupervisor,
    generatedBy = 'GES Satınalma Direktörlüğü'
  } = params;

  const dateStr = new Date().toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const perfRows = performances.map((p, idx) => `
    <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
      <td style="padding: 10px 12px; font-weight: bold; color: #1e293b;">${idx + 1}. ${p.supervisorName || '-'}</td>
      <td style="padding: 10px 12px; text-align: center; color: #475569;">${p.totalTransactions || 0}</td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #059669; font-weight: bold;">${formatRuble(p.totalDiscountAmount)}</td>
      <td style="padding: 10px 12px; text-align: right; font-family: monospace; color: #475569;">${formatRuble(p.totalAgreedPrice)}</td>
      <td style="padding: 10px 12px; text-align: center; font-weight: bold; color: #2563eb;">%${(p.avgDiscountPercentage || 0).toFixed(1)}</td>
      <td style="padding: 10px 12px; text-align: center; color: #d97706; font-weight: bold;">${p.negotiationEffortScore || 0}/100</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>GES Construction - Satınalma İcra Raporu</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 30px; background-color: #f8fafc; }
    .container { max-width: 900px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { font-size: 24px; font-weight: 900; letter-spacing: -0.5px; color: #0f172a; }
    .sub-brand { font-size: 12px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .kpi-card { background: #f1f5f9; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .kpi-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 6px; }
    .kpi-value { font-size: 20px; font-weight: 900; font-family: monospace; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 28px; }
    th { background: #0f172a; color: #ffffff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 12px; text-align: left; }
    .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="brand">GES CONSTRUCTION</div>
        <div class="sub-brand">Satınalma & Müzakere İcra Raporu</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 13px; font-weight: bold; color: #334155;">Tarih: ${dateStr}</div>
        <div style="font-size: 11px; color: #64748b;">Hazırlayan: ${generatedBy}</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Toplam Tasarruf</div>
        <div class="kpi-value" style="color: #059669;">${formatRuble(totalDiscount)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Toplam Liste Tutarı</div>
        <div class="kpi-value">${formatRuble(totalListPrice)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Anlaşılan Tutar</div>
        <div class="kpi-value">${formatRuble(totalAgreedPrice)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Ort. İskonto Oranı</div>
        <div class="kpi-value" style="color: #2563eb;">%${Number(overallAvgDiscountPct || 0).toFixed(1)}</div>
      </div>
    </div>

    <div style="font-size: 14px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin-bottom: 8px;">
      Şef Bazlı Performans & Müzakere Özeti
    </div>

    <table>
      <thead>
        <tr>
          <th>Şef Adı</th>
          <th style="text-align: center;">İşlem Adedi</th>
          <th style="text-align: right;">Toplam Tasarruf (₽)</th>
          <th style="text-align: right;">Anlaşılan Tutar (₽)</th>
          <th style="text-align: center;">Ort. İskonto</th>
          <th style="text-align: center;">Efor Skoru</th>
        </tr>
      </thead>
      <tbody>
        ${perfRows}
      </tbody>
    </table>

    <div class="footer">
      <span>GES Construction Otomasyon Sistemi tarafından üretilmiştir.</span>
      <span>Gizli & Şirket İçi Belge</span>
    </div>
  </div>
</body>
</html>
  `;
}
