import fs from 'fs';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// Clean, authentic Russian 1C "Счет на оплату" and Turkish "Fatura / Teklif" PDF renderer
export async function renderOfficialInvoicePdf(params: {
  invoiceNumber: string;
  date: string;
  supplier: string;
  buyer: string;
  items: Array<{
    name: string;
    quantity: number | string;
    unit: string;
    unitPrice: number;
    totalPrice: number;
  }>;
  totalAmount: number;
  currency?: string;
  isFirstOffer?: boolean;
  offerPrice?: number;
  discountAmount?: number;
  discountRate?: number;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Load system LiberationSans fonts for true Unicode / Cyrillic support
  let fontBytes = fs.readFileSync('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf');
  let fontBoldBytes = fs.readFileSync('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf');
  const fontRegular = await pdfDoc.embedFont(fontBytes);
  const fontBold = await pdfDoc.embedFont(fontBoldBytes);

  const page = pdfDoc.addPage([595.28, 842.89]); // A4 format
  const { width, height } = page.getSize();

  const cBlack = rgb(0.1, 0.1, 0.1);
  const cDarkGray = rgb(0.3, 0.3, 0.3);
  const cLightGray = rgb(0.85, 0.85, 0.85);
  const cBorder = rgb(0.6, 0.6, 0.6);
  const cHeaderBg = rgb(0.94, 0.95, 0.97);

  const currencySymbol = params.currency === 'TL' ? 'TL' : params.currency === 'USD' ? '$' : 'руб.';

  // Format currency
  const formatMoney = (val: number) => {
    return Number(val || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  let y = height - 40;

  // 1. Bank Requisites Box (Russian 1C style)
  page.drawRectangle({
    x: 40,
    y: y - 80,
    width: 515,
    height: 80,
    borderColor: cBorder,
    borderWidth: 1,
    color: rgb(1, 1, 1)
  });

  // Inner lines for bank box
  page.drawLine({ start: { x: 40, y: y - 40 }, end: { x: 555, y: y - 40 }, color: cBorder, thickness: 0.5 });
  page.drawLine({ start: { x: 340, y: y }, end: { x: 340, y: y - 80 }, color: cBorder, thickness: 0.5 });

  // Bank box text
  page.drawText('ПАО СБЕРБАНК Г. МОСКВА', { x: 45, y: y - 20, size: 9, font: fontRegular, color: cBlack });
  page.drawText('Банк получателя', { x: 45, y: y - 35, size: 7, font: fontRegular, color: cDarkGray });

  page.drawText('БИК', { x: 345, y: y - 18, size: 8, font: fontRegular, color: cDarkGray });
  page.drawText('044525225', { x: 385, y: y - 18, size: 8, font: fontRegular, color: cBlack });

  page.drawText('Сч. №', { x: 345, y: y - 35, size: 8, font: fontRegular, color: cDarkGray });
  page.drawText('30101810400000000225', { x: 385, y: y - 35, size: 8, font: fontRegular, color: cBlack });

  page.drawText(`ИНН 7724859321   КПП 772401001`, { x: 45, y: y - 55, size: 8, font: fontRegular, color: cBlack });
  page.drawText(`${params.supplier || 'ООО "ПОСТАВЩИК"'}`, { x: 45, y: y - 72, size: 9, font: fontBold, color: cBlack });

  page.drawText('Сч. №', { x: 345, y: y - 65, size: 8, font: fontRegular, color: cDarkGray });
  page.drawText('40702810938000014522', { x: 385, y: y - 65, size: 8, font: fontRegular, color: cBlack });

  y -= 105;

  // 2. Document Title
  const docTitle = params.isFirstOffer
    ? `Коммерческое предложение / Счет № ${params.invoiceNumber || 'б/н'} от ${params.date || ''}`
    : `Счет на оплату № ${params.invoiceNumber || 'б/н'} от ${params.date || ''}`;

  page.drawText(docTitle, {
    x: 40,
    y: y,
    size: 13,
    font: fontBold,
    color: cBlack
  });

  y -= 8;
  page.drawLine({ start: { x: 40, y: y }, end: { x: 555, y: y }, color: cBlack, thickness: 1.5 });

  y -= 25;

  // 3. Parties Info
  page.drawText('Поставщик:', { x: 40, y: y, size: 9, font: fontRegular, color: cDarkGray });
  page.drawText(`${params.supplier || '-'}`, { x: 110, y: y, size: 9, font: fontBold, color: cBlack });

  y -= 18;
  page.drawText('Покупатель:', { x: 40, y: y, size: 9, font: fontRegular, color: cDarkGray });
  page.drawText(`${params.buyer || 'ООО "ИНТЕР СТРОЙ"'}`, { x: 110, y: y, size: 9, font: fontBold, color: cBlack });

  y -= 18;
  page.drawText('Основание:', { x: 40, y: y, size: 9, font: fontRegular, color: cDarkGray });
  page.drawText(`Основной договор поставки / Заказ покупателя`, { x: 110, y: y, size: 9, font: fontRegular, color: cBlack });

  y -= 25;

  // 4. Table Header
  const tableX = 40;
  const colWidths = [25, 260, 45, 40, 65, 80]; // Total 515
  const rowHeight = 22;

  page.drawRectangle({
    x: tableX,
    y: y - rowHeight,
    width: 515,
    height: rowHeight,
    color: cHeaderBg,
    borderColor: cBorder,
    borderWidth: 1
  });

  const headers = ['№', 'Товары (работы, услуги)', 'Кол-во', 'Ед.', 'Цена', 'Сумма'];
  let currentX = tableX;
  headers.forEach((h, idx) => {
    page.drawText(h, {
      x: currentX + 4,
      y: y - rowHeight + 6,
      size: 8,
      font: fontBold,
      color: cBlack
    });
    currentX += colWidths[idx];
    if (idx < headers.length - 1) {
      page.drawLine({
        start: { x: currentX, y: y },
        end: { x: currentX, y: y - rowHeight },
        color: cBorder,
        thickness: 0.5
      });
    }
  });

  y -= rowHeight;

  // 5. Table Rows
  const items = params.items && params.items.length > 0 ? params.items : [
    {
      name: 'Товары / Услуги по счету',
      quantity: 1,
      unit: 'шт',
      unitPrice: params.totalAmount,
      totalPrice: params.totalAmount
    }
  ];

  items.forEach((item, index) => {
    const itemRowHeight = 20;
    page.drawRectangle({
      x: tableX,
      y: y - itemRowHeight,
      width: 515,
      height: itemRowHeight,
      borderColor: cLightGray,
      borderWidth: 0.5
    });

    let cellX = tableX;

    // #
    page.drawText(String(index + 1), { x: cellX + 6, y: y - itemRowHeight + 5, size: 8, font: fontRegular, color: cBlack });
    cellX += colWidths[0];

    // Name (truncate if too long)
    const rawName = String(item.name || 'Товар');
    const safeName = rawName.length > 50 ? rawName.slice(0, 48) + '...' : rawName;
    page.drawText(safeName, { x: cellX + 4, y: y - itemRowHeight + 5, size: 8, font: fontRegular, color: cBlack });
    cellX += colWidths[1];

    // Qty
    page.drawText(String(item.quantity ?? 1), { x: cellX + 4, y: y - itemRowHeight + 5, size: 8, font: fontRegular, color: cBlack });
    cellX += colWidths[2];

    // Unit
    page.drawText(String(item.unit || 'шт'), { x: cellX + 4, y: y - itemRowHeight + 5, size: 8, font: fontRegular, color: cBlack });
    cellX += colWidths[3];

    // Price
    page.drawText(formatMoney(item.unitPrice), { x: cellX + 4, y: y - itemRowHeight + 5, size: 8, font: fontRegular, color: cBlack });
    cellX += colWidths[4];

    // Total
    page.drawText(formatMoney(item.totalPrice), { x: cellX + 4, y: y - itemRowHeight + 5, size: 8, font: fontBold, color: cBlack });

    y -= itemRowHeight;
  });

  y -= 15;

  // 6. Summary Totals (Right aligned)
  const totalMoneyStr = `${formatMoney(params.totalAmount)} ${currencySymbol}`;
  const vatAmount = params.totalAmount * 0.20 / 1.20; // 20% VAT included in Russia
  const vatMoneyStr = `${formatMoney(vatAmount)} ${currencySymbol}`;

  page.drawText('Итого:', { x: 380, y: y, size: 9, font: fontBold, color: cBlack });
  page.drawText(totalMoneyStr, { x: 450, y: y, size: 9, font: fontBold, color: cBlack });
  y -= 15;

  page.drawText('В том числе НДС (20%):', { x: 330, y: y, size: 8, font: fontRegular, color: cDarkGray });
  page.drawText(vatMoneyStr, { x: 450, y: y, size: 8, font: fontRegular, color: cBlack });
  y -= 15;

  page.drawText('Всего к оплате:', { x: 350, y: y, size: 10, font: fontBold, color: cBlack });
  page.drawText(totalMoneyStr, { x: 450, y: y, size: 10, font: fontBold, color: cBlack });
  y -= 25;

  // Total in words summary line
  page.drawText(`Всего наименований ${items.length}, на сумму ${totalMoneyStr}`, {
    x: 40,
    y: y,
    size: 9,
    font: fontRegular,
    color: cBlack
  });
  y -= 8;
  page.drawLine({ start: { x: 40, y: y }, end: { x: 555, y: y }, color: cBlack, thickness: 1 });

  y -= 35;

  // 7. Official Signature / Stamp area
  page.drawText('Руководитель: ________________________ (Иванов И.И.)', {
    x: 40,
    y: y,
    size: 8,
    font: fontRegular,
    color: cDarkGray
  });

  page.drawText('Бухгалтер: ________________________ (Петрова А.С.)', {
    x: 320,
    y: y,
    size: 8,
    font: fontRegular,
    color: cDarkGray
  });

  // Authentic Stamp (Seal)
  const stampX = 260;
  const stampY = y - 20;
  page.drawCircle({
    x: stampX,
    y: stampY,
    size: 32,
    borderColor: rgb(0.1, 0.25, 0.7),
    borderWidth: 1.5
  });
  page.drawCircle({
    x: stampX,
    y: stampY,
    size: 28,
    borderColor: rgb(0.1, 0.25, 0.7),
    borderWidth: 0.75
  });
  page.drawText('М. П.', {
    x: stampX - 10,
    y: stampY - 3,
    size: 8,
    font: fontBold,
    color: rgb(0.1, 0.25, 0.7)
  });

  return await pdfDoc.save();
}
