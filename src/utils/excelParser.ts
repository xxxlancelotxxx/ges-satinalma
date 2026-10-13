import * as XLSX from 'xlsx';

export interface ParsedExcelSheetInfo {
  name: string;
  nonEmptyRowCount: number;
}

export interface ParsedExcelInvoice {
  sheetName: string;
  cleanCsv: string;
  headerRowIndex: number;
  allSheets: ParsedExcelSheetInfo[];
  items: any[];
  summaryRowsFiltered: number;
  detectedColumns: Record<string, string>;
  unmappedColumns: string[];
}

export function parseExcelWorkbookComprehensive(
  workbook: XLSX.WorkBook,
  targetSheetName?: string
): ParsedExcelInvoice {
  const sheetNames = workbook.SheetNames || [];
  const activeSheetName = targetSheetName && sheetNames.includes(targetSheetName)
    ? targetSheetName
    : sheetNames[0] || 'Sheet1';

  const allSheets: ParsedExcelSheetInfo[] = sheetNames.map(name => {
    const ws = workbook.Sheets[name];
    let count = 0;
    if (ws) {
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      count = data.filter(row => row && row.some(cell => cell != null && String(cell).trim() !== '')).length;
    }
    return { name, nonEmptyRowCount: count };
  });

  const worksheet = workbook.Sheets[activeSheetName];
  if (!worksheet) {
    return {
      sheetName: activeSheetName,
      cleanCsv: '',
      headerRowIndex: 0,
      allSheets,
      items: [],
      summaryRowsFiltered: 0,
      detectedColumns: {},
      unmappedColumns: []
    };
  }

  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
  const cleanCsv = XLSX.utils.sheet_to_csv(worksheet);

  let headerRowIndex = 0;
  let maxCols = 0;
  for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
    const row = rawRows[i] || [];
    const filledCells = row.filter(c => c != null && String(c).trim() !== '').length;
    if (filledCells > maxCols) {
      maxCols = filledCells;
      headerRowIndex = i;
    }
  }

  const detectedColumns: Record<string, string> = {};
  const unmappedColumns: string[] = [];
  const headerRow = rawRows[headerRowIndex] || [];

  headerRow.forEach((colName, idx) => {
    const str = String(colName || '').trim();
    if (!str) return;
    const lower = str.toLowerCase();
    if (lower.includes('malzeme') || lower.includes('ürün') || lower.includes('tovar') || lower.includes('наименование') || lower.includes('name') || lower.includes('desc')) {
      detectedColumns['materialName'] = str;
    } else if (lower.includes('miktar') || lower.includes('kol-vo') || lower.includes('кол-во') || lower.includes('qty') || lower.includes('quantity')) {
      detectedColumns['quantity'] = str;
    } else if (lower.includes('fiyat') || lower.includes('цена') || lower.includes('price') || lower.includes('rate')) {
      detectedColumns['unitPrice'] = str;
    } else if (lower.includes('tutar') || lower.includes('сумма') || lower.includes('total') || lower.includes('amount')) {
      detectedColumns['totalPrice'] = str;
    } else if (lower.includes('birim') || lower.includes('ед') || lower.includes('unit')) {
      detectedColumns['unit'] = str;
    } else {
      unmappedColumns.push(str);
    }
  });

  const items: any[] = [];
  let summaryRowsFiltered = 0;

  for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.every(c => c == null || String(c).trim() === '')) continue;
    const rowStr = row.map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('итого') || rowStr.includes('всего') || rowStr.includes('toplam') || rowStr.includes('subtotal') || rowStr.includes('kdv') || rowStr.includes('ндс')) {
      summaryRowsFiltered++;
      continue;
    }
    items.push({
      rowIndex: i,
      data: row
    });
  }

  return {
    sheetName: activeSheetName,
    cleanCsv,
    headerRowIndex,
    allSheets,
    items,
    summaryRowsFiltered,
    detectedColumns,
    unmappedColumns
  };
}
