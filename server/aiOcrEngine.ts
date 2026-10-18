// AI OCR Helper Engine for Invoice & Document Processing
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import crypto from 'crypto';
import * as XLSX from 'xlsx';

export const extractStringSafe = (val: any, fallback: string = ''): string => {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'object') {
    return (val.value !== undefined && val.value !== null) ? String(val.value) : fallback;
  }
  return String(val);
};

export function getGenAI() {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY veya API_KEY ortam değişkeni tanımlı değil!");
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

const SUPPORTED_VISION_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

export interface NormalizedDocumentInput {
  cleanBase64?: string;
  mimeType: string;
  isSupportedVision: boolean;
  isExcel: boolean;
  isPdf: boolean;
  extractedExcelCsv?: string;
}

/**
 * Inspects base64 magic bytes, data URL headers, declared MIME type, and file extension
 * to guarantee we never send Excel binaries or application/octet-stream into Gemini inlineData.
 */
export function inspectAndNormalizeDocumentInput(
  base64Input?: string,
  declaredMimeType?: string,
  fileName?: string
): NormalizedDocumentInput {
  const lowerName = (fileName || '').toLowerCase().trim();
  let embeddedMime = '';
  let cleanBase64 = base64Input ? base64Input.trim() : undefined;

  if (cleanBase64 && cleanBase64.startsWith('data:')) {
    const commaIdx = cleanBase64.indexOf(',');
    if (commaIdx !== -1) {
      const header = cleanBase64.slice(5, commaIdx);
      const semiIdx = header.indexOf(';');
      embeddedMime = (semiIdx !== -1 ? header.slice(0, semiIdx) : header).trim().toLowerCase();
      cleanBase64 = cleanBase64.slice(commaIdx + 1).trim();
    }
  } else if (cleanBase64 && cleanBase64.includes(',')) {
    cleanBase64 = cleanBase64.split(',')[1].trim();
  }

  let detectedMime = (declaredMimeType || embeddedMime || '').toLowerCase().trim();
  let isExcel = false;
  let isPdf = false;
  let extractedExcelCsv: string | undefined = undefined;

  // Check file extension hints first for Excel/CSV
  if (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.csv') ||
    detectedMime.includes('spreadsheet') ||
    detectedMime.includes('excel') ||
    detectedMime.includes('csv')
  ) {
    isExcel = true;
  }

  // Inspect magic bytes from buffer if base64 is present
  if (cleanBase64 && cleanBase64.length > 16) {
    try {
      const headBuf = Buffer.from(cleanBase64.slice(0, 64), 'base64');
      if (headBuf.length >= 4) {
        // %PDF (25 50 44 46)
        if (headBuf[0] === 0x25 && headBuf[1] === 0x50 && headBuf[2] === 0x44 && headBuf[3] === 0x46) {
          detectedMime = 'application/pdf';
          isPdf = true;
          isExcel = false;
        }
        // JPEG (FF D8 FF)
        else if (headBuf[0] === 0xff && headBuf[1] === 0xd8 && headBuf[2] === 0xff) {
          detectedMime = 'image/jpeg';
          isExcel = false;
        }
        // PNG (89 50 4E 47)
        else if (headBuf[0] === 0x89 && headBuf[1] === 0x50 && headBuf[2] === 0x4e && headBuf[3] === 0x47) {
          detectedMime = 'image/png';
          isExcel = false;
        }
        // WEBP (RIFF....WEBP)
        else if (
          headBuf.length >= 12 &&
          headBuf[0] === 0x52 && headBuf[1] === 0x49 && headBuf[2] === 0x46 && headBuf[3] === 0x46 &&
          headBuf[8] === 0x57 && headBuf[9] === 0x45 && headBuf[10] === 0x42 && headBuf[11] === 0x50
        ) {
          detectedMime = 'image/webp';
          isExcel = false;
        }
        // ZIP / XLSX (50 4B 03 04) or OLE2 XLS (D0 CF 11 E0)
        else if (
          (headBuf[0] === 0x50 && headBuf[1] === 0x4b && headBuf[2] === 0x03 && headBuf[3] === 0x04) ||
          (headBuf[0] === 0xd0 && headBuf[1] === 0xcf && headBuf[2] === 0x11 && headBuf[3] === 0xe0)
        ) {
          isExcel = true;
          detectedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
      }
    } catch (_) {}
  }

  // Fallback by extension if mime is still generic or octet-stream
  if (!isExcel && (!detectedMime || detectedMime === 'application/octet-stream' || !SUPPORTED_VISION_MIMES.has(detectedMime))) {
    if (lowerName.endsWith('.pdf')) {
      detectedMime = 'application/pdf';
      isPdf = true;
    } else if (lowerName.endsWith('.png')) {
      detectedMime = 'image/png';
    } else if (lowerName.endsWith('.webp')) {
      detectedMime = 'image/webp';
    } else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
      detectedMime = 'image/jpeg';
    }
  }

  if (detectedMime === 'application/pdf') {
    isPdf = true;
  }

  // If it's an Excel/CSV file and we have cleanBase64, parse it into CSV text on the server
  if (isExcel && cleanBase64) {
    try {
      const fullBuf = Buffer.from(cleanBase64, 'base64');
      const workbook = XLSX.read(fullBuf, { type: 'buffer' });
      const sheetTexts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
        if (csv) {
          sheetTexts.push(`--- Sayfa: ${sheetName} ---\n${csv}`);
        }
      }
      if (sheetTexts.length > 0) {
        extractedExcelCsv = sheetTexts.join('\n\n');
      } else {
        const rawUtf8 = fullBuf.toString('utf8').trim();
        if (rawUtf8 && !rawUtf8.includes('\u0000')) {
          extractedExcelCsv = rawUtf8;
        }
      }
    } catch (excelErr: any) {
      console.warn('[AI OCR] Server-side Excel parse warning:', excelErr?.message);
    }
  }

  const isSupportedVision = !isExcel && SUPPORTED_VISION_MIMES.has(detectedMime);

  return {
    cleanBase64,
    mimeType: detectedMime || 'application/pdf',
    isSupportedVision,
    isExcel,
    isPdf,
    extractedExcelCsv
  };
}

/**
 * High-Speed Resilient Gemini content generation with multi-model fallback:
 * gemini-3.8-flash -> gemini-3-flash-preview -> gemini-flash-latest -> gemini-3.1-flash-lite -> gemini-4-argon (for hard/complex cases)
 */
export async function generateContentWithResilience(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    primaryModel?: string;
    validateText?: (text: string) => boolean;
  }
): Promise<{ text: string; usedModel: string }> {
  const defaultChain = [
    params.primaryModel || 'gemini-3.8-flash',
    'gemini-3.8-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
    'gemini-4-argon'
  ];
  const candidateModels = defaultChain.filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx);

  let lastError: any = null;
  const startTime = Date.now();

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentModel = candidateModels[mIdx];
    const isPrimary = mIdx === 0;
    const isArgon = currentModel.includes('argon');
    const maxAttemptsForModel = isPrimary ? 2 : 1;

    // Build configuration suitable for the model
    const requestConfig: any = { ...params.config };
    if (params.config?.thinkingConfig) {
      requestConfig.thinkingConfig = { ...params.config.thinkingConfig };
    } else if (
      currentModel.includes('3.8') ||
      currentModel.includes('3-') ||
      currentModel.includes('argon') ||
      currentModel.includes('thinking')
    ) {
      requestConfig.thinkingConfig = {
        thinkingLevel: ThinkingLevel.LOW
      };
    } else {
      delete requestConfig.thinkingConfig;
    }

    const timeoutMs = isArgon ? 45000 : 25000;

    for (let attempt = 1; attempt <= maxAttemptsForModel; attempt++) {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: currentModel,
            contents: params.contents,
            config: requestConfig
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Model yanıt zaman aşımı (${timeoutMs}ms)`)), timeoutMs)
          )
        ]);

        const outText = (response?.text || '').trim();
        if (!outText) {
          throw new Error(`${currentModel} boş yanıt döndürdü.`);
        }

        if (params.validateText && !params.validateText(outText)) {
          throw new Error(`${currentModel} yanıtı doğrulama kontrolünü geçemedi.`);
        }

        const elapsed = Date.now() - startTime;
        console.log(`[Gemini AI OCR] ${currentModel} başarıyla tamamlandı (${elapsed}ms${!isPrimary ? ', yedek/üst model kullanıldı' : ''})`);
        return {
          text: outText,
          usedModel: currentModel
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isTransient =
          errMsg.includes('503') ||
          errMsg.includes('429') ||
          errMsg.includes('high demand') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Overloaded') ||
          errMsg.includes('zaman aşımı');

        console.warn(`[Gemini AI OCR] ${currentModel} (deneme ${attempt}/${maxAttemptsForModel}) hata:`, errMsg.slice(0, 200));

        if (attempt < maxAttemptsForModel && isTransient) {
          const delayMs = 450 + Math.floor(Math.random() * 200);
          console.log(`[Gemini AI OCR] ${currentModel} geçici yoğunluk nedeniyle ${delayMs}ms sonra tekrar deneniyor...`);
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          if (mIdx < candidateModels.length - 1) {
            console.log(`[Gemini AI OCR] ${currentModel} başarısız oldu, sıradaki modele (${candidateModels[mIdx + 1]}) geçiliyor...`);
          }
          break; // Switch to next fallback model immediately on any persistent error
        }
      }
    }
  }

  throw lastError || new Error(`Yapay zeka servisleri şu anda yoğunluk nedeniyle yanıt veremedi. Lütfen birkaç saniye sonra tekrar deneyin.`);
}

/**
 * Repairs unescaped inner quotes, trailing commas, and truncated JSON arrays/objects
 * so multi-item invoices never fail with JSON parse errors.
 */
function repairMalformedOrTruncatedJson(input: string): string {
  let s = input.trim();
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) {
    s = s.slice(firstBrace);
  }

  // 1. Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // 2. Replace unescaped inner quotes in Russian/Turkish company names like: "ООО "ТСК ДИПЛОМАТ"" -> "ООО «ТСК ДИПЛОМАТ»"
  s = s.replace(/:\s*"([^"\n]*?)"([^"\n,:}\]]+?)"([^"\n]*?)"(\s*[,}\]])/g, ': "$1«$2»$3"$4');

  // 3. Check if JSON is truncated (doesn't end with })
  const lastBrace = s.lastIndexOf('}');
  if (!s.endsWith('}')) {
    // Check if truncated inside "items": [ ...
    const itemsIdx = s.indexOf('"items"');
    if (itemsIdx !== -1 && lastBrace > itemsIdx) {
      // Cut right after the last completed object inside items array
      const candidate = s.slice(0, lastBrace + 1);
      // Count open brackets/braces outside strings
      let openBraces = 0;
      let openBrackets = 0;
      let inStr = false;
      let escaped = false;
      for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (!inStr) {
          if (ch === '{') openBraces++;
          else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
          else if (ch === '[') openBrackets++;
          else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
        }
      }
      let repaired = candidate.replace(/,\s*$/, '');
      while (openBrackets > 0) {
        repaired += ']';
        openBrackets--;
      }
      while (openBraces > 0) {
        repaired += '}';
        openBraces--;
      }
      return repaired;
    }
  }

  return s;
}

export function robustParseJSON(rawText: string): any {
  if (!rawText) return {};
  let cleanText = rawText.replace(/^[\s\S]*?```(?:json)?/gi, '').replace(/```[\s\S]*$/gi, '').trim();
  try { return JSON.parse(cleanText); } catch (_) {}

  const startObj = cleanText.indexOf('{');
  const endObj = cleanText.lastIndexOf('}');
  if (startObj !== -1 && endObj > startObj) {
    const sub = cleanText.substring(startObj, endObj + 1);
    try { return JSON.parse(sub); } catch (_) {}
    try {
      const fixedSub = repairMalformedOrTruncatedJson(sub);
      return JSON.parse(fixedSub);
    } catch (_) {}
  }

  if (startObj !== -1) {
    try {
      const repaired = repairMalformedOrTruncatedJson(cleanText.substring(startObj));
      return JSON.parse(repaired);
    } catch (_) {}
  }

  throw new Error('Yapay zeka yanıtı geçerli JSON formatında değil.');
}

export function calculateFileHash(buffer: Buffer | string): string {
  const buf = typeof buffer === 'string' ? Buffer.from(buffer, 'base64') : buffer;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Levenshtein similarity for fuzzy matching
export function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  const track = Array(s2.length + 1).fill(null).map(() =>
    Array(s1.length + 1).fill(null));
  for (let i = 0; i <= s1.length; i += 1) {
    track[0][i] = i;
  }
  for (let j = 0; j <= s2.length; j += 1) {
    track[j][0] = j;
  }
  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  const distance = track[s2.length][s1.length];
  const maxLen = Math.max(s1.length, s2.length);
  return Math.max(0, 1 - distance / maxLen);
}

// Mathematical and Semantic Validation of Extracted Invoice Data
export function validateInvoiceData(data: any): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    itemTotals: 'pass' | 'warning' | 'fail';
    invoiceTotal: 'pass' | 'warning' | 'fail';
    requiredFields: 'pass' | 'warning' | 'fail';
    duplicateCheck: 'pass' | 'warning' | 'fail';
  };
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let itemTotalsCheck: 'pass' | 'warning' | 'fail' = 'pass';
  let invoiceTotalCheck: 'pass' | 'warning' | 'fail' = 'pass';
  let requiredFieldsCheck: 'pass' | 'warning' | 'fail' = 'pass';

  // 1. Required Fields Validation
  const supplier = extractStringSafe(data.supplier) || extractStringSafe(data.vendorName);
  const invoiceNumber = extractStringSafe(data.invoiceNumber);
  const date = extractStringSafe(data.date);
  const totalAmount = Number(data.totalAmount?.value ?? data.totalAmount ?? 0);

  if (!supplier || supplier.trim() === '' || supplier === 'Bilinmeyen Tedarikçi') {
    warnings.push('Tedarikçi adı net okunamadı veya eksik.');
    requiredFieldsCheck = 'warning';
  }
  if (!invoiceNumber || invoiceNumber.trim() === '') {
    warnings.push('Fatura/Teklif numarası tespit edilemedi.');
    if (requiredFieldsCheck === 'pass') requiredFieldsCheck = 'warning';
  }
  if (!date || date.trim() === '') {
    warnings.push('Belge tarihi tespit edilemedi.');
    if (requiredFieldsCheck === 'pass') requiredFieldsCheck = 'warning';
  }

  // 2. Line Items Check
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) {
    warnings.push('Belgede kalem detayı bulunamadı, genel toplam tek kalem olarak değerlendirilecek.');
  }

  let calculatedItemsSum = 0;
  items.forEach((item: any, idx: number) => {
    const qty = Number(item.quantity || 0);
    const unitP = Number(item.unitPrice || 0);
    const totalP = Number(item.totalPrice || 0);

    if (qty <= 0) {
      warnings.push(`Kalem #${idx + 1} (${item.materialName || 'Malzeme'}): Miktar 0 veya negatif.`);
      itemTotalsCheck = 'warning';
    }
    if (unitP <= 0) {
      warnings.push(`Kalem #${idx + 1} (${item.materialName || 'Malzeme'}): Birim fiyat 0 veya negatif.`);
      itemTotalsCheck = 'warning';
    }

    if (qty > 0 && unitP > 0) {
      const lineMath = qty * unitP;
      calculatedItemsSum += (totalP > 0 ? totalP : lineMath);
      if (totalP > 0 && Math.abs(lineMath - totalP) > 1.0) {
        // Tolerans 1 TL/Ruble (kuruş/yuvarlama)
        warnings.push(`Kalem #${idx + 1}: ${qty} x ${unitP} = ${lineMath.toFixed(2)}, faturadaki satır tutarı ${totalP.toFixed(2)} ile uyuşmuyor.`);
        itemTotalsCheck = 'warning';
      }
    } else if (totalP > 0) {
      calculatedItemsSum += totalP;
    }
  });

  // 3. Invoice Total Match Check
  const subtotal = Number(data.subtotal?.value ?? data.subtotal ?? 0);
  const tax = Number(data.tax?.value ?? data.tax ?? 0);
  const discount = Number(data.discount?.value ?? data.discount ?? 0);

  if (totalAmount <= 0 && calculatedItemsSum <= 0) {
    errors.push('Faturanın genel toplam tutarı 0 veya negatif!');
    invoiceTotalCheck = 'fail';
  } else if (totalAmount > 0 && calculatedItemsSum > 0) {
    const diff = Math.abs(calculatedItemsSum - totalAmount);
    // Vergi ve iskonto hesaba katılınca uyumlu mu?
    if (subtotal > 0 && tax > 0) {
      const calculatedGrandTotal = subtotal + tax - discount;
      if (Math.abs(calculatedGrandTotal - totalAmount) > 2.0) {
        warnings.push(`Ara toplam (${subtotal}) + KDV (${tax}) - İskonto (${discount}) = ${calculatedGrandTotal.toFixed(2)}, genel toplam (${totalAmount}) ile tam örtüşmüyor.`);
        invoiceTotalCheck = 'warning';
      }
    } else if (diff > 5.0 && Math.abs(diff - tax) > 5.0) {
      // Kalem toplamı ile genel toplam arasındaki fark KDV'den kaynaklanmıyorsa uyar
      warnings.push(`Kalemler toplamı (${calculatedItemsSum.toFixed(2)}), genel toplam (${totalAmount.toFixed(2)}) ile ${diff.toFixed(2)} fark gösteriyor.`);
      invoiceTotalCheck = 'warning';
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    checks: {
      itemTotals: itemTotalsCheck,
      invoiceTotal: invoiceTotalCheck,
      requiredFields: requiredFieldsCheck,
      duplicateCheck: 'pass'
    }
  };
}

function extractShaFromUrl(url?: string): string {
  if (!url || typeof url !== 'string') return '';
  try {
    const lastPart = decodeURIComponent(url.split('/').pop() || '');
    const shaCandidate = lastPart.split('.')[0] || '';
    return /^[a-f0-9]{64}$/i.test(shaCandidate) ? shaCandidate.toLowerCase() : '';
  } catch {
    return '';
  }
}

// Duplicate Detection Logic
export function checkDuplicateInvoice(
  newInvoice: {
    supplier: string;
    invoiceNumber: string;
    date?: string;
    totalAmount: number;
    fileHash?: string;
    fileSizeBytes?: number;
  },
  existingInvoices: any[]
): {
  isDuplicate: boolean;
  matchType?: 'exact' | 'hash_size' | 'content_similar';
  existingInvoice?: any;
  similarityScore?: number;
  message?: string;
} {
  if (!existingInvoices || existingInvoices.length === 0) {
    return { isDuplicate: false };
  }

  const rawNum = String(newInvoice.invoiceNumber || '').trim();
  const cleanNum = rawNum.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
  const isGenericGeneratedNum =
    !rawNum ||
    rawNum.startsWith('FT-') ||
    rawNum.startsWith('TKF-') ||
    rawNum.startsWith('ARCH-') ||
    rawNum.startsWith('BLG-');

  const cleanSupplier = String(newInvoice.supplier || '').trim().toLowerCase();
  const newHash = (newInvoice.fileHash || '').toLowerCase();

  for (const existing of existingInvoices) {
    if (existing.isDeleted) continue;

    const existSupplierRaw = String(existing.supplier || existing.vendorName || '').trim();
    const existSupplier = existSupplierRaw.toLowerCase();
    const existNumRaw = String(existing.invoiceNumber || existing.invoiceNo || '').trim();
    const existNum = existNumRaw.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
    const existAmount = Number(existing.totalAmount || existing.agreedPrice || existing.offerPrice || 0);
    const existDate = String(existing.date || existing.orderDate || '').trim();
    const existJobsite = String(existing.jobsiteName || '').trim();

    // 1. Exact File Hash match (Aynı dosya tekrar yüklenmişse - fileHash veya fileUrl içindeki SHA-256)
    const existHashes = [
      (existing.fileHash || '').toLowerCase(),
      extractShaFromUrl(existing.fileUrl),
      extractShaFromUrl(existing.finalOfferFileUrl),
      extractShaFromUrl(existing.firstOfferFileUrl)
    ].filter(Boolean);

    if (newHash && existHashes.includes(newHash)) {
      return {
        isDuplicate: true,
        matchType: 'hash_size',
        existingInvoice: existing,
        similarityScore: 1.0,
        message: `Bu fatura sistemde kayıtlı! Yüklediğiniz belge daha önce "${existSupplierRaw || 'Tedarikçi'}" (Fatura No: ${existNumRaw || '-'}, Tarih: ${existDate || '-'}, Tutar: ${existAmount.toLocaleString('tr-TR')} ₽${existJobsite ? `, Şantiye: ${existJobsite}` : ''}) olarak sisteme yüklenmiş.`
      };
    }

    // 2. Exact Vendor + Invoice Number match (veya özgün fatura numarası + aynı tutar)
    const isExistGeneric =
      !existNumRaw ||
      existNumRaw.startsWith('FT-EXCEL-') ||
      existNumRaw.startsWith('TKF-') ||
      existNumRaw.startsWith('ARCH-') ||
      existNumRaw.startsWith('BLG-');

    if (!isGenericGeneratedNum && !isExistGeneric && cleanNum && existNum && cleanNum === existNum) {
      const vendorSim = calculateStringSimilarity(cleanSupplier, existSupplier);
      const isSameAmount = newInvoice.totalAmount > 0 && existAmount > 0 && Math.abs(newInvoice.totalAmount - existAmount) < 5;
      if (
        vendorSim > 0.5 ||
        (cleanSupplier && existSupplier && (cleanSupplier.includes(existSupplier) || existSupplier.includes(cleanSupplier))) ||
        (cleanNum.length >= 3 && isSameAmount)
      ) {
        return {
          isDuplicate: true,
          matchType: 'exact',
          existingInvoice: existing,
          similarityScore: 1.0,
          message: `Bu fatura sistemde kayıtlı! "${existNumRaw}" numaralı ve "${existSupplierRaw}" tedarikçili fatura daha önce ${existDate || 'sistemde'} tarihinde (${existJobsite || 'Şantiye'} - ${existAmount.toLocaleString('tr-TR')} ₽) kaydedilmiş.`
        };
      }
    }

    // 3. Similar Supplier + Same Date + Same Amount
    if (newInvoice.totalAmount > 0 && existAmount > 0 && Math.abs(newInvoice.totalAmount - existAmount) < 1.0) {
      const vendorSim = calculateStringSimilarity(cleanSupplier, existSupplier);
      const isSameDate = newInvoice.date && existDate && newInvoice.date === existDate;

      if (vendorSim > 0.72 && isSameDate) {
        return {
          isDuplicate: true,
          matchType: 'content_similar',
          existingInvoice: existing,
          similarityScore: vendorSim,
          message: `Bu fatura sistemde kayıtlı! "${existSupplierRaw}" tedarikçisine ait aynı tarih (${existDate}) ve birebir aynı tutarda (${existAmount.toLocaleString('tr-TR')} ₽) bir fatura zaten sistemde mevcut (Fatura No: ${existNumRaw || '-'}).`
        };
      }
    }
  }

  return { isDuplicate: false };
}

