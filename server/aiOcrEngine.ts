// AI OCR Helper Engine for Invoice & Document Processing
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import crypto from 'crypto';

export const extractStringSafe = (val: any, fallback: string = ''): string => {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'object') {
    return (val.value !== undefined && val.value !== null) ? String(val.value) : fallback;
  }
  return String(val);
};

export function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY ortam değişkeni tanımlı değil!");
  return new GoogleGenAI({ 
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

/**
 * High-Speed Resilient Gemini content generation with multi-model fallback (gemini-3.7-flash -> gemini-flash-latest)
 * Handles temporary 503/429 high demand spikes smoothly without failing user requests.
 */
export async function generateContentWithResilience(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    primaryModel?: string;
  }
): Promise<{ text: string; usedModel: string }> {
  // Ultra-fast default: 'gemini-flash-latest' processes images/PDFs in 1-2 seconds with zero thinking overhead
  const candidateModels = [
    params.primaryModel || 'gemini-flash-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash'
  ].filter((v, idx, arr) => arr.indexOf(v) === idx); // unique list

  let lastError: any = null;
  const startTime = Date.now();

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentModel = candidateModels[mIdx];
    const isPrimary = mIdx === 0;
    const maxAttemptsForModel = isPrimary ? 2 : 1; // 2 fast attempts on primary, 1 on fallback

    // Build configuration suitable for the model
    const requestConfig: any = { ...params.config };
    if (params.config?.thinkingConfig) {
      requestConfig.thinkingConfig = { ...params.config.thinkingConfig };
    } else if (currentModel.includes('3.7') || currentModel.includes('3.8') || currentModel.includes('thinking')) {
      requestConfig.thinkingConfig = {
        thinkingLevel: ThinkingLevel.LOW
      };
    } else {
      delete requestConfig.thinkingConfig;
    }

    for (let attempt = 1; attempt <= maxAttemptsForModel; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: currentModel,
          contents: params.contents,
          config: requestConfig
        });
        const elapsed = Date.now() - startTime;
        console.log(`[Gemini AI OCR] ${currentModel} başarıyla tamamlandı (${elapsed}ms${!isPrimary ? ', yedek model kullanıldı' : ''})`);
        return {
          text: response.text || '',
          usedModel: currentModel
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isHighDemandOrTransient =
          errMsg.includes('503') ||
          errMsg.includes('429') ||
          errMsg.includes('high demand') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Overloaded');

        console.warn(`[Gemini AI OCR] ${currentModel} (deneme ${attempt}/${maxAttemptsForModel}) hata:`, errMsg);

        if (attempt < maxAttemptsForModel && isHighDemandOrTransient) {
          const delayMs = attempt * 600 + Math.floor(Math.random() * 200);
          console.log(`[Gemini AI OCR] ${currentModel} geçici yoğunluk nedeniyle ${delayMs}ms sonra tekrar deneniyor...`);
          await new Promise((r) => setTimeout(r, delayMs));
        } else if (isHighDemandOrTransient && mIdx < candidateModels.length - 1) {
          console.log(`[Gemini AI OCR] ${currentModel} yoğunlukta, yedek modele (${candidateModels[mIdx + 1]}) geçiliyor...`);
          break; // Switch to next fallback model immediately
        }
      }
    }
  }

  throw lastError || new Error(`Yapay zeka servisleri şu anda yoğunluk nedeniyle yanıt veremedi. Lütfen birkaç saniye sonra tekrar deneyin.`);
}

export function robustParseJSON(rawText: string): any {
  if (!rawText) return {};
  let cleanText = rawText.replace(/^[\s\S]*?```(?:json)?/gi, '').replace(/```[\s\S]*$/gi, '').trim();
  try { return JSON.parse(cleanText); } catch (_) {}
  
  const startObj = rawText.indexOf('{');
  const endObj = rawText.lastIndexOf('}');
  if (startObj !== -1 && endObj > startObj) {
    try { return JSON.parse(rawText.substring(startObj, endObj + 1)); } catch (_) {}
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

  const cleanNum = String(newInvoice.invoiceNumber || '').trim().toLowerCase();
  const cleanSupplier = String(newInvoice.supplier || '').trim().toLowerCase();

  for (const existing of existingInvoices) {
    if (existing.isDeleted) continue;

    // 1. Exact File Hash match (Aynı dosya tekrar yüklenmişse)
    if (newInvoice.fileHash && existing.fileHash && newInvoice.fileHash === existing.fileHash) {
      return {
        isDuplicate: true,
        matchType: 'hash_size',
        existingInvoice: existing,
        similarityScore: 1.0,
        message: `Bu dosya daha önce "${existing.supplier}" (${existing.invoiceNumber}) olarak sisteme kaydedilmiş (Dosya parmak izi SHA-256 birebir aynı).`
      };
    }

    // 2. Exact Vendor + Invoice Number match
    const existNum = String(existing.invoiceNumber || '').trim().toLowerCase();
    const existSupplier = String(existing.supplier || '').trim().toLowerCase();

    if (cleanNum && existNum && cleanNum === existNum) {
      const vendorSim = calculateStringSimilarity(cleanSupplier, existSupplier);
      if (vendorSim > 0.6 || cleanSupplier.includes(existSupplier) || existSupplier.includes(cleanSupplier)) {
        return {
          isDuplicate: true,
          matchType: 'exact',
          existingInvoice: existing,
          similarityScore: 1.0,
          message: `Bu fatura numarası (${existing.invoiceNumber}) ve tedarikçi (${existing.supplier}) ile daha önce ${existing.date || ''} tarihinde (${existing.jobsiteName || 'Şantiye'}) kaydı oluşturulmuş.`
        };
      }
    }

    // 3. Similar Supplier + Same Date + Same Amount
    if (newInvoice.totalAmount > 0 && Math.abs(newInvoice.totalAmount - (existing.totalAmount || 0)) < 0.01) {
      const vendorSim = calculateStringSimilarity(cleanSupplier, existSupplier);
      const isSameDate = newInvoice.date && existing.date && newInvoice.date === existing.date;

      if (vendorSim > 0.75 && isSameDate) {
        return {
          isDuplicate: true,
          matchType: 'content_similar',
          existingInvoice: existing,
          similarityScore: vendorSim,
          message: `Benzer tedarikçi ("${existing.supplier}"), aynı tarih (${existing.date}) ve birebir aynı tutarda (${existing.totalAmount} ₽) bir fatura zaten kayıtlı.`
        };
      }
    }
  }

  return { isDuplicate: false };
}
