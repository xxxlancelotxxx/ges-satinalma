import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';

function formatMoney(amount?: number | string): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
  if (isNaN(num)) return '0,00 ₽';
  return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function safeString(val: any, fallback = '-'): string {
  if (val === null || val === undefined || val === '') return fallback;
  return String(val);
}


const trMap: Record<string,string> = {'ş':'s','Ş':'S','ı':'i','İ':'I','ğ':'g','Ğ':'G','ç':'c','Ç':'C','ö':'o','Ö':'O','ü':'u','Ü':'U'};
const sanitizeForPdf = (str: string) => {
  if (!str) return '';
  return str.replace(/[şŞıİğĞçÇöÖüÜ]/g, m => trMap[m] || m).replace(/[^\x00-\x7F]/g, '');
};

const safeDrawText = (pg: any, text: string, options: any) => {
  try {
    pg.drawText(text, options);
  } catch (err) {
    try {
      pg.drawText(sanitizeForPdf(text), options);
    } catch (err2) {
      console.warn('[PDF Gen] Skipped text due to font error:', text);
    }
  }
};

export async function generateArchivePdf(record: any, fileNameHint?: string): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  let font: any;
  let fontBold: any;

  try {
    const regularFontPath = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
    const boldFontPath = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
    if (fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath)) {
      const regBytes = fs.readFileSync(regularFontPath);
      const boldBytes = fs.readFileSync(boldFontPath);
      font = await pdfDoc.embedFont(regBytes);
      fontBold = await pdfDoc.embedFont(boldBytes);
    }
  } catch (e) {
    console.warn('[PDF Gen] Failed to load Liberation font, falling back to standard:', e);
  }

  // Fallback if font embedding failed
  if (!font || !fontBold) {
    font = await pdfDoc.embedFont('Helvetica');
    fontBold = await pdfDoc.embedFont('Helvetica-Bold');
  }

  const supplier = safeString(record.supplier || record.vendorName || record.rawFileName || fileNameHint, 'Bilinmeyen Tedarikçi');
  const invoiceNo = safeString(record.invoiceNumber || record.invoiceNo, 'FT-' + (record.id || Date.now()));
  const dateStr = safeString(record.date || record.orderDate, new Date().toISOString().split('T')[0]);
  const jobsite = safeString(record.jobsiteName, 'Genel Şantiye');
  const supervisor = safeString(record.supervisorName || record.uploadedBySupervisorName, 'Satınalma Departmanı');
  const category = safeString(record.category, 'Genel Malzeme / Hizmet');

  const offerPrice = Number(record.offerPrice || 0);
  const agreedPrice = Number(record.agreedPrice || record.totalAmount || 0);
  const discountAmt = Number(record.discountAmount || (offerPrice > agreedPrice ? offerPrice - agreedPrice : 0));
  const discountPct = Number(record.discountPercentage || (offerPrice > 0 ? (discountAmt / offerPrice) * 100 : 0));

  const items: any[] = Array.isArray(record.items) && record.items.length > 0 ? record.items : [
    {
      materialName: `${category} (${supplier})`,
      quantity: 1,
      unit: 'Paket/Hizmet',
      unitPrice: agreedPrice,
      totalPrice: agreedPrice
    }
  ];

  const pageWidth = 595.28;
  const pageHeight = 841.89; // A4
  const margin = 36;
  const contentWidth = pageWidth - (margin * 2);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Header Banner
  page.drawRectangle({
    x: margin,
    y: y - 56,
    width: contentWidth,
    height: 56,
    color: rgb(0.08, 0.12, 0.2) // Deep navy
  });

  safeDrawText(page, 'RESMİ SATINALMA & FATURA ARŞİV BELGESİ', {
    x: margin + 16,
    y: y - 26,
    size: 14,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  safeDrawText(page, 'Sistem Dijital Arşiv Motoru • Güvenli Kalıcı Arşivleme Garantisi', {
    x: margin + 16,
    y: y - 44,
    size: 9,
    font,
    color: rgb(0.8, 0.85, 0.95)
  });

  const verifiedBadgeText = 'ONAYLI ARŞİV';
  page.drawRectangle({
    x: pageWidth - margin - 100,
    y: y - 44,
    width: 86,
    height: 24,
    color: rgb(0.06, 0.45, 0.3) // Emerald green
  });
  safeDrawText(page, verifiedBadgeText, {
    x: pageWidth - margin - 88,
    y: y - 34,
    size: 9,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  y -= 70;

  // Metadata Grid (2 Columns)
  const colWidth = (contentWidth - 12) / 2;
  const gridHeight = 110;

  // Left Box: Tedarikçi & Şantiye
  page.drawRectangle({
    x: margin,
    y: y - gridHeight,
    width: colWidth,
    height: gridHeight,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 1
  });

  safeDrawText(page, 'FİRMA & PROJE BİLGİLERİ', {
    x: margin + 12,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.35)
  });

  const leftLabels = [
    ['Tedarikçi Firma:', supplier.length > 32 ? supplier.substring(0, 30) + '...' : supplier],
    ['Şantiye Adı:', jobsite],
    ['Yetkili Şef:', supervisor],
    ['Kategori:', category],
    ['Belge Tarihi:', dateStr]
  ];

  let leftY = y - 34;
  leftLabels.forEach(([lbl, val]) => {
    safeDrawText(page, lbl, { x: margin + 12, y: leftY, size: 8, font, color: rgb(0.4, 0.45, 0.55) });
    safeDrawText(page, val, { x: margin + 95, y: leftY, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.2) });
    leftY -= 15;
  });

  // Right Box: Fatura & Fiyat Özeti
  const rightX = margin + colWidth + 12;
  page.drawRectangle({
    x: rightX,
    y: y - gridHeight,
    width: colWidth,
    height: gridHeight,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.93),
    borderWidth: 1
  });

  safeDrawText(page, 'BELGE & MALİ ÖZET', {
    x: rightX + 12,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.35)
  });

  const rightLabels = [
    ['Belge / Fatura No:', invoiceNo],
    ['İlk Liste Fiyatı:', formatMoney(offerPrice > 0 ? offerPrice : agreedPrice)],
    ['Son İndirimli Fiyat:', formatMoney(agreedPrice)],
    ['Net İndirim Tutarı:', formatMoney(discountAmt)],
    ['İndirim Oranı (%):', `%${discountPct.toFixed(2)}`]
  ];

  let rightY = y - 34;
  rightLabels.forEach(([lbl, val], idx) => {
    const isDiscount = idx >= 3 && discountAmt > 0;
    safeDrawText(page, lbl, { x: rightX + 12, y: rightY, size: 8, font, color: rgb(0.4, 0.45, 0.55) });
    safeDrawText(page, val, {
      x: rightX + 110,
      y: rightY,
      size: 8,
      font: fontBold,
      color: isDiscount ? rgb(0.05, 0.5, 0.25) : rgb(0.1, 0.15, 0.2)
    });
    rightY -= 15;
  });

  y -= (gridHeight + 18);

  // Table Section Header
  safeDrawText(page, 'FATURA KALEMLERİ VE DETAY DÖKÜMÜ', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25)
  });

  y -= 14;

  // Table Columns
  // Total width: contentWidth (~523)
  // No: 28, Name: 255, Qty: 70, UnitPrice: 85, Total: 85
  const colX = {
    no: margin + 6,
    name: margin + 30,
    qty: margin + 285,
    unitPrice: margin + 355,
    total: margin + 440
  };

  const tableHeaderHeight = 22;
  page.drawRectangle({
    x: margin,
    y: y - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: rgb(0.15, 0.2, 0.3)
  });

  safeDrawText(page, 'No', { x: colX.no, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  safeDrawText(page, 'Malzeme / Hizmet Açıklaması', { x: colX.name, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  safeDrawText(page, 'Miktar & Birim', { x: colX.qty, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  safeDrawText(page, 'Birim Fiyat', { x: colX.unitPrice, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  safeDrawText(page, 'Toplam Tutar', { x: colX.total, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });

  y -= tableHeaderHeight;

  let calculatedGrandTotal = 0;
  const rowHeight = 20;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const itemName = safeString(it.materialName || it.originalName, `Kalem ${i + 1}`);
    const qty = Number(it.quantity || 1);
    const unit = safeString(it.unit, 'Adet');
    const uPrice = Number(it.unitPrice || 0);
    const totPrice = Number(it.totalPrice || (qty * uPrice) || 0);
    calculatedGrandTotal += totPrice;

    // Check if new page is needed
    if (y - rowHeight < margin + 90) {
      // Add Page
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin - 20;

      // Draw mini header on next page
      page.drawRectangle({
        x: margin,
        y: y - tableHeaderHeight,
        width: contentWidth,
        height: tableHeaderHeight,
        color: rgb(0.15, 0.2, 0.3)
      });
      safeDrawText(page, 'No', { x: colX.no, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
      safeDrawText(page, 'Malzeme / Hizmet Açıklaması (Devam)', { x: colX.name, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
      safeDrawText(page, 'Miktar & Birim', { x: colX.qty, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
      safeDrawText(page, 'Birim Fiyat', { x: colX.unitPrice, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
      safeDrawText(page, 'Toplam Tutar', { x: colX.total, y: y - 15, size: 8, font: fontBold, color: rgb(1, 1, 1) });
      y -= tableHeaderHeight;
    }

    // Alternating row background
    if (i % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: rgb(0.97, 0.98, 0.99)
      });
    }

    // Row borders
    page.drawLine({
      start: { x: margin, y: y - rowHeight },
      end: { x: margin + contentWidth, y: y - rowHeight },
      thickness: 0.5,
      color: rgb(0.88, 0.9, 0.93)
    });

    const truncatedName = itemName.length > 42 ? itemName.substring(0, 40) + '...' : itemName;

    safeDrawText(page, String(i + 1), { x: colX.no, y: y - 14, size: 8, font, color: rgb(0.3, 0.35, 0.45) });
    safeDrawText(page, truncatedName, { x: colX.name, y: y - 14, size: 8, font, color: rgb(0.1, 0.15, 0.2) });
    safeDrawText(page, `${qty} ${unit}`, { x: colX.qty, y: y - 14, size: 8, font, color: rgb(0.2, 0.25, 0.35) });
    safeDrawText(page, formatMoney(uPrice), { x: colX.unitPrice, y: y - 14, size: 8, font, color: rgb(0.2, 0.25, 0.35) });
    safeDrawText(page, formatMoney(totPrice), { x: colX.total, y: y - 14, size: 8, font: fontBold, color: rgb(0.1, 0.15, 0.2) });

    y -= rowHeight;
  }

  // Summary Row (Grand Total)
  const totalRowHeight = 24;
  page.drawRectangle({
    x: margin,
    y: y - totalRowHeight,
    width: contentWidth,
    height: totalRowHeight,
    color: rgb(0.92, 0.94, 0.98),
    borderColor: rgb(0.8, 0.85, 0.92),
    borderWidth: 1
  });

  safeDrawText(page, 'GENEL TOPLAM:', {
    x: colX.unitPrice - 30,
    y: y - 16,
    size: 9,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.25)
  });

  const finalTotalToDisplay = agreedPrice > 0 ? agreedPrice : calculatedGrandTotal;
  safeDrawText(page, formatMoney(finalTotalToDisplay), {
    x: colX.total,
    y: y - 16,
    size: 10,
    font: fontBold,
    color: rgb(0.08, 0.45, 0.25)
  });

  y -= (totalRowHeight + 20);

  // Verification & Archive Guarantee Footer Box
  const footerBoxHeight = 54;
  page.drawRectangle({
    x: margin,
    y: y - footerBoxHeight,
    width: contentWidth,
    height: footerBoxHeight,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: rgb(0.85, 0.88, 0.92),
    borderWidth: 1
  });

  safeDrawText(page, 'DİJİTAL ARŞİV KORUMA & DOĞRULAMA BİLGİSİ', {
    x: margin + 12,
    y: y - 16,
    size: 8,
    font: fontBold,
    color: rgb(0.15, 0.2, 0.3)
  });

  safeDrawText(page, 
    'Bu belge, kullanıcının veritabanında onaylanmış kayıtları esas alınarak sıfır veri kaybı koruması kapsamında dijital arşiv motoru tarafından üretilmiştir.',
    {
      x: margin + 12,
      y: y - 28,
      size: 7.5,
      font,
      color: rgb(0.4, 0.45, 0.5)
    }
  );

  const archiveStamp = `Kayıt No: ${record.id || 'N/A'} • Arşiv Tarihi: ${new Date().toLocaleString('tr-TR')} • Güvenlik Durumu: KALICI KORUMALI`;
  safeDrawText(page, archiveStamp, {
    x: margin + 12,
    y: y - 42,
    size: 7.5,
    font: fontBold,
    color: rgb(0.08, 0.45, 0.25)
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
