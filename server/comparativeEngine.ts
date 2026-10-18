import crypto from 'crypto';
import {
  ComparativeAnalysisRecord,
  ComparativeDocument,
  ComparativeDocumentRole,
  CanonicalMaterial,
  CanonicalLineMatch,
  ComparativeDocumentItem,
  MaterialSynonym,
  ComparativeAnalysisConfig
} from '../src/types';
import {
  calculateComparativeSavings,
  calculateMatchScore,
  extractTechnicalSpecs,
  detectMaterialType,
  normalizeQuantityAndPrice,
  normalizeUnit,
  normalizeVatPrice,
  generateAnalysisCode
} from '../src/utils/comparativeCalculation';
import { processInvoiceTwoStages } from './aiTwoStageOcr';
import { getGenAI, generateContentWithResilience, robustParseJSON } from './aiOcrEngine';

// In-memory cache for fast responsive queries in development/sandbox
export const comparativeAnalysesStore = new Map<string, ComparativeAnalysisRecord>();
export const materialSynonymsStore = new Map<string, MaterialSynonym>();
export let comparativeConfig: ComparativeAnalysisConfig = {
  thresholdRub: 1000000,
  isMandatoryOverThreshold: false,
  allowNegativeImpactInTotal: true,
  requirePinForExclusion: false,
  updatedAt: new Date().toISOString()
};

export function updateComparativeConfig(newConfig: Partial<ComparativeAnalysisConfig>): ComparativeAnalysisConfig {
  comparativeConfig = {
    ...comparativeConfig,
    ...newConfig,
    updatedAt: new Date().toISOString()
  };
  return comparativeConfig;
}

/**
 * Classifies document role based on extracted metadata, filenames, and text content
 */
export function classifyDocumentRole(
  fileName: string,
  supplier: string,
  docNumber: string,
  rawText: string,
  totalAmount: number,
  allDocsContext: Array<{ supplier: string; totalAmount: number; fileName: string; role?: string }>
): { role: ComparativeDocumentRole; confidence: number; reason: string } {
  const lowerName = (fileName || '').toLowerCase();
  const lowerText = (rawText || '').toLowerCase();

  // Explicit Final Invoice indicators (Russian & Turkish)
  const isInvoiceKeyword =
    lowerName.includes('fatura') ||
    lowerName.includes('счет') ||
    lowerName.includes('упд') ||
    lowerName.includes('upd') ||
    lowerName.includes('акт') ||
    lowerName.includes('son') ||
    lowerName.includes('final') ||
    lowerText.includes('универсальный передаточный документ') ||
    lowerText.includes('счет-фактура') ||
    lowerText.includes('счет на оплату');

  // Explicit Offer indicators
  const isOfferKeyword =
    lowerName.includes('teklif') ||
    lowerName.includes('кп') ||
    lowerName.includes('коммерческое') ||
    lowerName.includes('offer') ||
    lowerName.includes('kp') ||
    lowerText.includes('коммерческое предложение');

  // Competitor check: Does another supplier have this document?
  const sameSupplierDocs = allDocsContext.filter(d => d.supplier && supplier && d.supplier.toLowerCase() === supplier.toLowerCase());

  if (isInvoiceKeyword && !isOfferKeyword) {
    return {
      role: 'FINAL_INVOICE',
      confidence: 0.95,
      reason: 'Fatura/УПД/Счет içeriği ve dosya adı tespiti'
    };
  }

  if (lowerName.includes('son') || lowerName.includes('final')) {
    return {
      role: 'FINAL_OFFER',
      confidence: 0.92,
      reason: 'Son teklif dosya adı göstergesi'
    };
  }

  if (lowerName.includes('round') || lowerName.includes('tur') || lowerName.includes('indirim')) {
    return {
      role: 'DISCOUNT_ROUND_1',
      confidence: 0.88,
      reason: 'Pazarlık turu göstergesi'
    };
  }

  // If there are multiple documents for this supplier and this has a higher amount
  if (sameSupplierDocs.length > 1) {
    const minAmountSameSupplier = Math.min(...sameSupplierDocs.map(d => d.totalAmount).filter(a => a > 0));
    if (totalAmount > minAmountSameSupplier) {
      return {
        role: 'FIRST_OFFER',
        confidence: 0.90,
        reason: 'Aynı tedarikçinin daha yüksek tutarlı ilk teklifi'
      };
    } else {
      return {
        role: 'FINAL_OFFER',
        confidence: 0.88,
        reason: 'Aynı tedarikçinin daha düşük tutarlı nihai teklifi'
      };
    }
  }

  // Default initial offer classification
  return {
    role: 'FIRST_OFFER',
    confidence: 0.85,
    reason: 'İlk teklif / Teklif belgesi'
  };
}

/**
 * Detects whether VAT is included from raw extracted document texts and items
 */
export function detectVatStatus(rawText: string, items: any[]): boolean {
  const lower = (rawText || '').toLowerCase();
  if (lower.includes('без ндс') || lower.includes('без налога') || lower.includes('kdv hariç')) {
    return false;
  }
  if (lower.includes('в т.ч. ндс') || lower.includes('в том числе ндс') || lower.includes('с ндс') || lower.includes('kdv dahil') || lower.includes('ндс 20%')) {
    return true;
  }
  // Standard in Russian commercial B2B invoicing is VAT included (20%)
  return true;
}

export interface ProcessComparativeAnalysisInput {
  files: Array<{
    fileName: string;
    fileUrl?: string;
    buffer?: Buffer;
    base64?: string;
    mimeType?: string;
    documentRole?: string;
    supplierName?: string;
    totalAmount?: number;
    documentNumber?: string;
    date?: string;
  }>;
  jobsiteId: string;
  jobsiteName: string;
  supervisorId: string;
  supervisorName: string;
  performedByPersonnelId?: string | null;
  performedByPersonnelName?: string | null;
  currency?: string;
  existingAnalysisId?: string;
  thresholdRub?: number;
}

/**
 * End-to-end processing of multiple vendor offer and invoice files
 */
export async function processComparativeAnalysisBatch(
  input: ProcessComparativeAnalysisInput
): Promise<ComparativeAnalysisRecord> {
  const { files, jobsiteId, jobsiteName, supervisorId, supervisorName } = input;

  if (!files || files.length === 0) {
    throw new Error('En az 1 adet teklif veya fatura belgesi yüklenmelidir.');
  }

  const analysisId = input.existingAnalysisId || `ANL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const analysisCode = generateAnalysisCode(comparativeAnalysesStore.size);

  const processedDocuments: ComparativeDocument[] = [];
  const rawItemsByDoc: Array<{ docId: string; supplier: string; role: ComparativeDocumentRole; items: ComparativeDocumentItem[] }> = [];

  // Step 1: Process each document with two-stage OCR
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const docId = `doc_${Date.now()}_${i}`;
    let extractedData: any = null;

    try {
      const b64 = f.buffer ? f.buffer.toString('base64') : f.base64;
      if (b64) {
        extractedData = await processInvoiceTwoStages({
          base64Input: b64,
          fileName: f.fileName,
          mimeType: f.mimeType,
          scanMode: 'full' // MUST extract all item lines for comparative matching!
        });
      }
    } catch (err: any) {
      console.warn(`[ComparativeEngine] Document ${f.fileName} OCR extraction error:`, err?.message);
    }

    // User explicitly provided supplier name takes precedence
    const userSupplier = (f.supplierName || '').trim();
    const supplier = userSupplier ||
                     extractedData?.extracted?.supplier ||
                     extractedData?.extracted?.vendorName ||
                     `Tedarikçi ${i + 1}`;
    const userTotalAmount = (typeof f.totalAmount === 'number' && !isNaN(f.totalAmount) && f.totalAmount > 0)
      ? f.totalAmount
      : (typeof f.totalAmount === 'string' && parseFloat(f.totalAmount) > 0 ? parseFloat(f.totalAmount) : undefined);
    const totalAmount = userTotalAmount ?? (extractedData?.extracted?.totalAmount || 0);
    const documentNumber = (f.documentNumber || '').trim() || (extractedData?.extracted?.invoiceNumber || '');
    const date = (f.date || '').trim() || (extractedData?.extracted?.date || new Date().toISOString().split('T')[0]);
    const rawItems: any[] = extractedData?.extracted?.items || [];
    const isVatIncluded = detectVatStatus(extractedData?.extracted?.summary || f.fileName, rawItems);

    const docItems: ComparativeDocumentItem[] = rawItems.map((it, idx) => {
      const origName = it.originalName || it.name || it.description || `Malzeme ${idx + 1}`;
      const specs = extractTechnicalSpecs(origName);
      return {
        id: `item_${docId}_${idx}`,
        originalName: origName,
        materialName: it.materialName || origName,
        category: it.category || detectMaterialType(origName),
        quantity: Number(it.quantity) || 1,
        unit: it.unit || 'adet',
        unitPrice: Number(it.unitPrice) || (Number(it.totalPrice) / (Number(it.quantity) || 1)) || 0,
        totalPrice: Number(it.totalPrice) || (Number(it.quantity) * Number(it.unitPrice)) || 0,
        diameter: specs.diameter,
        quality: specs.grade,
        standard: specs.standard,
        dimensions: specs.dimensions,
        confidence: it.confidence ?? 0.95
      };
    });

    processedDocuments.push({
      id: docId,
      fileName: f.fileName,
      fileUrl: f.fileUrl || `/api/files/download/${f.fileName}`,
      fileHash: extractedData?.fileHash,
      fileType: f.fileName.split('.').pop() || 'pdf',
      supplier,
      taxId: extractedData?.extracted?.taxId,
      documentNumber,
      date,
      documentRole: 'FIRST_OFFER', // Temporary, adjusted in Step 2
      roleConfidence: 0.85,
      totalAmount,
      currency: extractedData?.extracted?.currency || 'RUB',
      isVatIncluded,
      isShippingIncluded: true,
      isExcluded: false,
      items: docItems,
      sourceDocumentIndex: i,
      rawTextPreview: extractedData?.extracted?.summary
    });

    rawItemsByDoc.push({
      docId,
      supplier,
      role: 'FIRST_OFFER',
      items: docItems
    });
  }

  // Step 2: Refine document roles with cross-document context or user explicit overrides
  const docSummaries = processedDocuments.map(d => ({
    supplier: d.supplier,
    totalAmount: d.totalAmount,
    fileName: d.fileName
  }));

  let intermediateRoundSeq = 1;
  for (let i = 0; i < processedDocuments.length; i++) {
    const doc = processedDocuments[i];
    const userRole = files[i]?.documentRole;

    if (userRole) {
      // User explicitly set role in UI modal
      if (userRole === 'FINAL_INVOICE') doc.documentRole = 'FINAL_INVOICE';
      else if (userRole === 'FINAL_OFFER') doc.documentRole = 'FINAL_OFFER';
      else if (userRole === 'INTERMEDIATE_ROUND' || (userRole && userRole.startsWith('DISCOUNT_ROUND_'))) {
        doc.documentRole = `DISCOUNT_ROUND_${intermediateRoundSeq}` as ComparativeDocumentRole;
        intermediateRoundSeq++;
      } else if (userRole === 'INITIAL_OFFER' || userRole === 'FIRST_OFFER') {
        doc.documentRole = 'FIRST_OFFER';
      }
      doc.roleConfidence = 1.0;
    } else {
      const classification = classifyDocumentRole(
        doc.fileName,
        doc.supplier,
        doc.documentNumber || '',
        doc.rawTextPreview || '',
        doc.totalAmount,
        docSummaries
      );
      doc.documentRole = classification.role;
      doc.roleConfidence = classification.confidence;
    }
    rawItemsByDoc[i].role = doc.documentRole;
  }

  // Identify winning supplier: The one that has FINAL_INVOICE or FINAL_OFFER (preferably user selected)
  const finalDoc = processedDocuments.find(d => d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER') ||
                   processedDocuments[processedDocuments.length - 1];
  const winningSupplierName = finalDoc ? finalDoc.supplier : processedDocuments[0]?.supplier || '';

  // Classify other suppliers' first offers as COMPETITOR_FIRST_OFFER
  for (const doc of processedDocuments) {
    if (doc.id !== finalDoc?.id && doc.supplier !== winningSupplierName && (doc.documentRole === 'FIRST_OFFER' || !doc.documentRole)) {
      doc.documentRole = 'COMPETITOR_FIRST_OFFER';
    }
  }

  // Step 3: Canonical Material Construction
  // Priority: Use the AGREED OFFER (finalDoc / FINAL_INVOICE / FINAL_OFFER) items as the primary baseline.
  // The user explicitly requires that the agreed offer's items, quantities, and tonnages are the basis
  // of comparison, against which the initial offers are evaluated.
  const canonicalMaterials: CanonicalMaterial[] = [];
  const finalDocs = processedDocuments.filter(d => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'));
  const agreedDoc = finalDocs[0] || finalDoc;
  const hasAgreedItems = agreedDoc && Array.isArray(agreedDoc.items) && agreedDoc.items.length > 0;

  if (hasAgreedItems) {
    const otherDocs = processedDocuments.filter(d => !d.isExcluded && d.id !== agreedDoc.id);
    const docUsedItemIndices = new Map<string, Set<number>>();
    otherDocs.forEach(d => docUsedItemIndices.set(d.id, new Set<number>()));

    agreedDoc.items.forEach((agreedItem, idx) => {
      const agreedSpecs = (agreedItem.diameter || agreedItem.quality || agreedItem.standard || agreedItem.dimensions)
        ? { diameter: agreedItem.diameter, grade: agreedItem.quality, standard: agreedItem.standard, dimensions: agreedItem.dimensions }
        : extractTechnicalSpecs(agreedItem.originalName);
      const agreedType = agreedItem.category || detectMaterialType(agreedItem.originalName);
      const standardUnit = normalizeUnit(agreedItem.unit);

      // Check synonym dictionary
      let canonicalName = '';
      const normKey = agreedItem.originalName.toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
      const foundSynonym = Array.from(materialSynonymsStore.values()).find(s => s.normalizedKey === normKey);
      if (foundSynonym) {
        canonicalName = foundSynonym.canonicalName;
      }
      if (!canonicalName) {
        const parts = [agreedType];
        if (agreedSpecs.grade) parts.push(agreedSpecs.grade);
        if (agreedSpecs.diameter) parts.push(agreedSpecs.diameter);
        if (agreedSpecs.dimensions) parts.push(agreedSpecs.dimensions);
        if (agreedSpecs.standard) parts.push(agreedSpecs.standard);
        canonicalName = parts.length > 1 ? parts.join(' ') : (agreedItem.materialName || agreedItem.originalName);
      }

      const { normalizedQty: agreedNormQty, normalizedUnitPrice: agreedNormUnitPrice } = normalizeQuantityAndPrice(
        agreedItem.quantity,
        agreedItem.unitPrice,
        agreedItem.unit,
        standardUnit
      );

      const { normalizedPrice: agreedVatNormPrice } = normalizeVatPrice(
        agreedNormUnitPrice,
        agreedDoc.isVatIncluded,
        true
      );

      const agreedLineMatch: CanonicalLineMatch = {
        documentId: agreedDoc.id,
        documentRole: agreedDoc.documentRole,
        supplierName: agreedDoc.supplier,
        originalDescription: agreedItem.originalName,
        quantity: agreedItem.quantity,
        unit: agreedItem.unit,
        normalizedQuantity: agreedNormQty,
        normalizedUnit: standardUnit,
        rawUnitPrice: agreedItem.unitPrice,
        normalizedUnitPrice: agreedVatNormPrice,
        totalPrice: agreedItem.totalPrice || (agreedNormQty * agreedVatNormPrice),
        isVatIncluded: agreedDoc.isVatIncluded,
        matchConfidence: 1.0,
        matchReason: 'Anlaşılan nihai fatura/teklif satırı (Satınalma Bazı)',
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: false,
        isInitialOffer: false
      };

      const clusterLines: CanonicalLineMatch[] = [agreedLineMatch];
      let minMatchScore = 1.0;
      let clusterReason = 'Anlaşılan nihai fatura kalemi';

      // Find matching candidate items in each other document (initial offers, competitor offers, intermediate rounds)
      otherDocs.forEach(otherDoc => {
        const usedIndices = docUsedItemIndices.get(otherDoc.id) || new Set<number>();
        let bestCand: ComparativeDocumentItem | null = null;
        let bestCandIdx = -1;
        let bestScore = -1;
        let bestReason = '';

        otherDoc.items.forEach((cand, candIdx) => {
          if (usedIndices.has(candIdx)) return;
          const candSpecs = (cand.diameter || cand.quality || cand.standard || cand.dimensions)
            ? { diameter: cand.diameter, grade: cand.quality, standard: cand.standard, dimensions: cand.dimensions }
            : extractTechnicalSpecs(cand.originalName);
          const matchResult = calculateMatchScore(
            { description: agreedItem.originalName, specs: agreedSpecs },
            { description: cand.originalName, specs: candSpecs }
          );

          const effectiveScore = (agreedDoc.items.length === 1 && otherDoc.items.length === 1 && matchResult.score >= 0.40)
            ? Math.max(matchResult.score, 0.88)
            : matchResult.score;

          if (effectiveScore > bestScore) {
            bestScore = effectiveScore;
            bestCand = cand;
            bestCandIdx = candIdx;
            bestReason = matchResult.reason;
          }
        });

        // Threshold for match: >= 0.55
        if (bestCand && bestScore >= 0.55 && bestCandIdx >= 0) {
          usedIndices.add(bestCandIdx);
          const cand = bestCand as ComparativeDocumentItem;
          const candNorm = normalizeQuantityAndPrice(
            cand.quantity,
            cand.unitPrice,
            cand.unit,
            standardUnit,
            `${cand.originalName || ''} ${agreedItem.originalName || ''}`.trim(),
            cand.category || agreedType
          );
          const { normalizedPrice: candVatNorm } = normalizeVatPrice(
            candNorm.normalizedUnitPrice,
            otherDoc.isVatIncluded,
            true
          );

          clusterLines.push({
            documentId: otherDoc.id,
            documentRole: otherDoc.documentRole,
            supplierName: otherDoc.supplier,
            originalDescription: cand.originalName,
            quantity: cand.quantity,
            unit: cand.unit,
            normalizedQuantity: candNorm.normalizedQty,
            normalizedUnit: standardUnit,
            rawUnitPrice: cand.unitPrice,
            normalizedUnitPrice: candVatNorm,
            totalPrice: cand.totalPrice,
            isVatIncluded: otherDoc.isVatIncluded,
            matchConfidence: bestScore,
            matchReason: bestReason,
            isApprovedByUser: bestScore >= 0.85,
            lineIndex: clusterLines.length,
            isCompetitor: otherDoc.supplier !== winningSupplierName,
            isInitialOffer: otherDoc.documentRole === 'FIRST_OFFER' || otherDoc.documentRole === 'COMPETITOR_FIRST_OFFER'
          });

          if (bestScore < minMatchScore) minMatchScore = bestScore;
          clusterReason = bestReason;
        }
      });

      // Find initial offer lines to determine marketReferenceUnitPrice
      const initialOfferLines = clusterLines.filter(l => l.isInitialOffer || l.documentRole === 'FIRST_OFFER' || l.documentRole === 'COMPETITOR_FIRST_OFFER');
      let marketReferenceUnitPrice = 0;
      let marketReferenceSupplier = '';
      if (initialOfferLines.length > 0) {
        let minPrice = Infinity;
        let minSup = '';
        initialOfferLines.forEach(l => {
          const p = l.normalizedUnitPrice || l.rawUnitPrice;
          if (p > 0 && p < minPrice) {
            minPrice = p;
            minSup = l.supplierName;
          }
        });
        if (minPrice !== Infinity) {
          marketReferenceUnitPrice = minPrice;
          marketReferenceSupplier = minSup;
        }
      }

      const winningFirstLine = clusterLines.find(l => l.supplierName === winningSupplierName && (l.documentRole === 'FIRST_OFFER' || l.isInitialOffer));
      const winningFirstUnitPrice = winningFirstLine ? (winningFirstLine.normalizedUnitPrice || winningFirstLine.rawUnitPrice) : (marketReferenceUnitPrice || agreedVatNormPrice);

      const realUnitSavings = marketReferenceUnitPrice > 0 ? (marketReferenceUnitPrice - agreedVatNormPrice) : 0;
      const realTotalSavings = realUnitSavings * agreedNormQty;
      const realSavingsPercentage = marketReferenceUnitPrice > 0 ? Number(((realUnitSavings / marketReferenceUnitPrice) * 100).toFixed(2)) : 0;

      canonicalMaterials.push({
        id: `can_mat_${Date.now()}_${idx}`,
        commonName: canonicalName,
        canonicalName: canonicalName,
        materialType: agreedType,
        standardUnit,
        specs: agreedSpecs,
        purchasedQuantity: agreedNormQty,
        quantity: agreedNormQty,
        purchasedUnitPrice: agreedVatNormPrice,
        purchasedSupplier: winningSupplierName,
        marketReferenceUnitPrice,
        marketReferenceSupplier,
        winningFirstUnitPrice,
        realUnitSavings,
        realTotalSavings,
        realSavingsAmount: realTotalSavings,
        realSavingsPercentage,
        realSavingsRate: realSavingsPercentage,
        internalVendorUnitDiscount: Math.max(0, winningFirstUnitPrice - agreedVatNormPrice),
        internalVendorTotalDiscount: Math.max(0, winningFirstUnitPrice - agreedVatNormPrice) * agreedNormQty,
        isAboveBestOffer: agreedVatNormPrice > marketReferenceUnitPrice && marketReferenceUnitPrice > 0,
        aboveBestOfferDiff: (agreedVatNormPrice > marketReferenceUnitPrice && marketReferenceUnitPrice > 0) ? (agreedVatNormPrice - marketReferenceUnitPrice) : 0,
        status: minMatchScore < 0.80 ? 'needs_confirmation' : 'auto_matched',
        matchConfidence: minMatchScore,
        matchReason: clusterReason,
        lowestInitialOffer: {
          vendorName: marketReferenceSupplier || 'En Düşük İlk Teklif',
          normalizedUnitPrice: marketReferenceUnitPrice,
          totalPrice: marketReferenceUnitPrice * agreedNormQty
        },
        finalPurchased: {
          vendorName: winningSupplierName,
          normalizedUnitPrice: agreedVatNormPrice,
          totalPrice: agreedVatNormPrice * agreedNormQty
        },
        lines: clusterLines
      });
    });
  } else {
    // Fallback: If no agreed items extracted from finalDoc, process all items into canonical clusters
    const unassignedItems: Array<{ docId: string; supplier: string; role: ComparativeDocumentRole; isVatIncluded: boolean; item: ComparativeDocumentItem }> = [];

    for (const doc of processedDocuments) {
      for (const it of doc.items) {
        unassignedItems.push({
          docId: doc.id,
          supplier: doc.supplier,
          role: doc.documentRole,
          isVatIncluded: doc.isVatIncluded,
          item: it
        });
      }
    }

    while (unassignedItems.length > 0) {
      const current = unassignedItems.shift()!;
      const currentSpecs = extractTechnicalSpecs(current.item.originalName);
      const currentType = detectMaterialType(current.item.originalName);
      const standardUnit = normalizeUnit(current.item.unit);

      // Check synonym dictionary first for instant 100% confidence
      let canonicalName = '';
      const normKey = current.item.originalName.toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
      const foundSynonym = Array.from(materialSynonymsStore.values()).find(s => s.normalizedKey === normKey);
      if (foundSynonym) {
        canonicalName = foundSynonym.canonicalName;
      }

      const { normalizedQty, normalizedUnitPrice } = normalizeQuantityAndPrice(
        current.item.quantity,
        current.item.unitPrice,
        current.item.unit,
        standardUnit
      );

      const { normalizedPrice: vatNormalizedPrice } = normalizeVatPrice(
        normalizedUnitPrice,
        current.isVatIncluded,
        true
      );

      const initialLineMatch: CanonicalLineMatch = {
        documentId: current.docId,
        documentRole: current.role,
        supplierName: current.supplier,
        originalDescription: current.item.originalName,
        quantity: current.item.quantity,
        unit: current.item.unit,
        normalizedQuantity: normalizedQty,
        normalizedUnit: standardUnit,
        rawUnitPrice: current.item.unitPrice,
        normalizedUnitPrice: vatNormalizedPrice,
        totalPrice: current.item.totalPrice,
        isVatIncluded: current.isVatIncluded,
        matchConfidence: 1.0,
        matchReason: 'Orijinal kaynak satır',
        isApprovedByUser: true,
        lineIndex: 0,
        isCompetitor: current.supplier !== winningSupplierName,
        isInitialOffer: current.role === 'FIRST_OFFER' || current.role === 'COMPETITOR_FIRST_OFFER'
      };

      const clusterLines: CanonicalLineMatch[] = [initialLineMatch];
      let clusterSpecs: any = { ...currentSpecs };
      let minMatchScore = 1.0;
      let clusterReason = 'İlk satır';

      // Search for matches among remaining items
      const remainingUnassigned: typeof unassignedItems = [];

      for (const candidate of unassignedItems) {
        const isSameDoc = candidate.docId === current.docId;
        const match = calculateMatchScore(
          { description: current.item.originalName, specs: currentSpecs },
          { description: candidate.item.originalName }
        );

        if (!isSameDoc && match.score >= 0.75) {
          const candNorm = normalizeQuantityAndPrice(
            candidate.item.quantity,
            candidate.item.unitPrice,
            candidate.item.unit,
            standardUnit
          );
          const { normalizedPrice: candVatNorm } = normalizeVatPrice(
            candNorm.normalizedUnitPrice,
            candidate.isVatIncluded,
            true
          );

          clusterLines.push({
            documentId: candidate.docId,
            documentRole: candidate.role,
            supplierName: candidate.supplier,
            originalDescription: candidate.item.originalName,
            quantity: candidate.item.quantity,
            unit: candidate.item.unit,
            normalizedQuantity: candNorm.normalizedQty,
            normalizedUnit: standardUnit,
            rawUnitPrice: candidate.item.unitPrice,
            normalizedUnitPrice: candVatNorm,
            totalPrice: candidate.item.totalPrice,
            isVatIncluded: candidate.isVatIncluded,
            matchConfidence: match.score,
            matchReason: match.reason,
            isApprovedByUser: match.score >= 0.85,
            lineIndex: clusterLines.length,
            isCompetitor: candidate.supplier !== winningSupplierName,
            isInitialOffer: candidate.role === 'FIRST_OFFER' || candidate.role === 'COMPETITOR_FIRST_OFFER'
          });

          if (match.score < minMatchScore) minMatchScore = match.score;
          clusterReason = match.reason;
          if (!canonicalName) canonicalName = match.commonName;
        } else {
          remainingUnassigned.push(candidate);
        }
      }

      unassignedItems.length = 0;
      unassignedItems.push(...remainingUnassigned);

      if (!canonicalName) {
        const parts = [currentType];
        if (clusterSpecs.grade) parts.push(clusterSpecs.grade);
        if (clusterSpecs.diameter) parts.push(clusterSpecs.diameter);
        if (clusterSpecs.standard) parts.push(clusterSpecs.standard);
        canonicalName = parts.join(' ');
      }

      const needsConfirmation = minMatchScore < 0.85;

      canonicalMaterials.push({
        id: `can_mat_${Date.now()}_${canonicalMaterials.length}`,
        commonName: canonicalName,
        materialType: currentType,
        standardUnit,
        specs: clusterSpecs,
        purchasedQuantity: normalizedQty,
        purchasedUnitPrice: vatNormalizedPrice,
        purchasedSupplier: winningSupplierName,
        marketReferenceUnitPrice: 0,
        marketReferenceSupplier: '',
        realUnitSavings: 0,
        realTotalSavings: 0,
        realSavingsPercentage: 0,
        internalVendorUnitDiscount: 0,
        internalVendorTotalDiscount: 0,
        isAboveBestOffer: false,
        status: needsConfirmation ? 'needs_confirmation' : 'auto_matched',
        matchConfidence: minMatchScore,
        matchReason: clusterReason,
        lines: clusterLines
      });
    }
  }

  // Step 4: Calculate final savings & metrics using core calculation utility
  const calcOutput = calculateComparativeSavings({
    canonicalMaterials,
    documents: processedDocuments,
    winningSupplier: winningSupplierName,
    thresholdRub: input.thresholdRub ?? comparativeConfig.thresholdRub
  });

  const auditLog = [
    {
      timestamp: new Date().toISOString(),
      userId: input.performedByPersonnelId || supervisorId,
      userName: input.performedByPersonnelName || supervisorName,
      action: 'ANALYSIS_INITIATED',
      details: `${files.length} belge işlendi, ${calcOutput.canonicalMaterials.length} kanonik malzeme eşleştirildi.`
    },
    ...calcOutput.auditLogEntries.map(entry => ({
      timestamp: new Date().toISOString(),
      action: 'CALCULATION_STEP',
      details: entry
    }))
  ];

  const record: ComparativeAnalysisRecord = {
    id: analysisId,
    analysisCode,
    jobsiteId,
    jobsiteName,
    supervisorId,
    supervisorName,
    performedByPersonnelId: input.performedByPersonnelId || null,
    performedByPersonnelName: input.performedByPersonnelName || null,
    currency: input.currency || 'RUB',
    date: new Date().toISOString().split('T')[0],
    status: calcOutput.summary.pendingApprovalsCount > 0 ? 'needs_approval' : 'completed',
    calculationMethod: 'MARKET_BASELINE_TO_FINAL',
    winningSupplier: calcOutput.winningSupplier,
    isSingleVendor: calcOutput.isSingleVendor,
    totalFinalPurchase: calcOutput.summary.totalFinalPurchase,
    totalInitialLowestOffer: calcOutput.summary.totalInitialLowestOffer,
    realMarketSavings: calcOutput.summary.realMarketSavings,
    realSavingsRate: calcOutput.summary.realSavingsRate,
    internalVendorSavings: calcOutput.summary.internalVendorSavings,
    isAboveBestOffer: calcOutput.summary.isAboveBestOfferCount > 0,
    negotiationRoundsCount: calcOutput.summary.negotiationRoundsCount || 0,
    negotiationStages: calcOutput.summary.intermediateRoundsList || [],
    initialOffersComparison: calcOutput.summary.initialOffersList || [],
    finalInvoiceDetails: {
      supplier: calcOutput.winningSupplier,
      amount: calcOutput.summary.finalPurchaseAmount || calcOutput.summary.totalFinalPurchase,
      invoiceNumber: calcOutput.summary.finalInvoiceNumber || finalDoc?.documentNumber || '',
      date: calcOutput.summary.finalInvoiceDate || finalDoc?.date || '',
      fileName: finalDoc?.fileName,
      fileUrl: finalDoc?.fileUrl
    },
    thresholdApplied: calcOutput.thresholdApplied,
    summary: calcOutput.summary,
    documents: processedDocuments,
    canonicalMaterials: calcOutput.canonicalMaterials,
    auditLog,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Cache in memory store
  comparativeAnalysesStore.set(analysisId, record);

  return record;
}

/**
 * Saves or learns user approved synonyms into dictionary
 */
export function learnApprovedSynonyms(materials: CanonicalMaterial[], approvedBy?: string) {
  for (const mat of materials) {
    if (mat.status === 'confirmed' || mat.status === 'auto_matched') {
      for (const line of mat.lines) {
        const rawText = line.originalDescription;
        const normKey = rawText.toLowerCase().trim().replace(/[^a-zа-я0-9]/g, '');
        if (normKey && !materialSynonymsStore.has(normKey)) {
          materialSynonymsStore.set(normKey, {
            id: `syn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            rawText,
            normalizedKey: normKey,
            canonicalName: mat.commonName,
            materialType: mat.materialType,
            standardUnit: mat.standardUnit,
            specs: mat.specs,
            approvedBy,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
  }
}

export function recalculateComparativeAnalysis(
  record: ComparativeAnalysisRecord,
  userId = 'system',
  userName = 'Sistem',
  actionNote = 'Otomatik yeniden hesaplama ve birim normalizasyonu'
): ComparativeAnalysisRecord {
  const activeDocs = (record.documents || []).filter(d => !d.isExcluded);
  const finalDoc = activeDocs.find(d => d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER') || activeDocs[activeDocs.length - 1];
  const winningSupplierName = finalDoc?.supplier || record.winningSupplier || '';

  if (finalDoc && Array.isArray(record.canonicalMaterials) && record.canonicalMaterials.length > 0) {
    const otherDocs = activeDocs.filter(d => d.id !== finalDoc.id);
    record.canonicalMaterials = record.canonicalMaterials.map((mat, idx) => {
      const existingLines = Array.isArray(mat.lines) ? [...mat.lines] : [];
      const standardUnit = normalizeUnit(mat.standardUnit || finalDoc.items?.[idx]?.unit || 'adet');
      const agreedDesc = finalDoc.items?.[idx]?.originalName || mat.commonName || mat.canonicalName || '';
      const agreedSpecs = extractTechnicalSpecs(agreedDesc);
      const agreedType = mat.materialType || detectMaterialType(agreedDesc);

      otherDocs.forEach(otherDoc => {
        const alreadyHasDoc = existingLines.some(l => l.documentId === otherDoc.id);
        if (alreadyHasDoc || !Array.isArray(otherDoc.items) || otherDoc.items.length === 0) return;

        let bestCand: ComparativeDocumentItem | null = null;
        let bestScore = -1;
        let bestReason = '';

        otherDoc.items.forEach((cand) => {
          const candSpecs = extractTechnicalSpecs(cand.originalName);
          const matchResult = calculateMatchScore(
            { description: agreedDesc, specs: agreedSpecs },
            { description: cand.originalName, specs: candSpecs }
          );
          const effectiveScore = (record.canonicalMaterials.length === 1 && otherDoc.items.length === 1 && matchResult.score >= 0.40)
            ? Math.max(matchResult.score, 0.88)
            : matchResult.score;
          if (effectiveScore > bestScore) {
            bestScore = effectiveScore;
            bestCand = cand;
            bestReason = matchResult.reason;
          }
        });

        if (bestCand && bestScore >= 0.55) {
          const cand = bestCand as ComparativeDocumentItem;
          const candNorm = normalizeQuantityAndPrice(
            cand.quantity,
            cand.unitPrice,
            cand.unit,
            standardUnit,
            `${cand.originalName || ''} ${agreedDesc}`.trim(),
            cand.category || agreedType
          );
          const { normalizedPrice: candVatNorm } = normalizeVatPrice(
            candNorm.normalizedUnitPrice,
            otherDoc.isVatIncluded,
            true
          );
          existingLines.push({
            documentId: otherDoc.id,
            documentRole: otherDoc.documentRole,
            supplierName: otherDoc.supplier,
            originalDescription: cand.originalName,
            quantity: cand.quantity,
            unit: cand.unit,
            normalizedQuantity: candNorm.normalizedQty,
            normalizedUnit: standardUnit,
            rawUnitPrice: cand.unitPrice,
            normalizedUnitPrice: candVatNorm,
            totalPrice: cand.totalPrice,
            isVatIncluded: otherDoc.isVatIncluded,
            matchConfidence: bestScore,
            matchReason: bestReason,
            isApprovedByUser: bestScore >= 0.85,
            lineIndex: existingLines.length,
            isCompetitor: otherDoc.supplier !== winningSupplierName,
            isInitialOffer: otherDoc.documentRole === 'FIRST_OFFER' || otherDoc.documentRole === 'COMPETITOR_FIRST_OFFER'
          });
        }
      });

      return {
        ...mat,
        lines: existingLines
      };
    });
  }

  const calcOutput = calculateComparativeSavings({
    canonicalMaterials: record.canonicalMaterials,
    documents: record.documents,
    winningSupplier: winningSupplierName,
    thresholdRub: record.thresholdApplied?.thresholdRub || comparativeConfig.thresholdRub
  });

  const updated: ComparativeAnalysisRecord = {
    ...record,
    winningSupplier: calcOutput.winningSupplier,
    totalFinalPurchase: calcOutput.summary.totalFinalPurchase,
    totalInitialLowestOffer: calcOutput.summary.totalInitialLowestOffer,
    realMarketSavings: calcOutput.summary.realMarketSavings,
    realSavingsRate: calcOutput.summary.realSavingsRate,
    internalVendorSavings: calcOutput.summary.internalVendorSavings,
    isSingleVendor: calcOutput.isSingleVendor,
    isAboveBestOffer: calcOutput.summary.isAboveBestOfferCount > 0,
    negotiationRoundsCount: calcOutput.summary.negotiationRoundsCount || 0,
    negotiationStages: calcOutput.summary.intermediateRoundsList || [],
    initialOffersComparison: calcOutput.summary.initialOffersList || [],
    finalInvoiceDetails: {
      supplier: calcOutput.winningSupplier,
      amount: calcOutput.summary.finalPurchaseAmount || calcOutput.summary.totalFinalPurchase,
      invoiceNumber: calcOutput.summary.finalInvoiceNumber || finalDoc?.documentNumber || record.finalInvoiceDetails?.invoiceNumber || '',
      date: calcOutput.summary.finalInvoiceDate || finalDoc?.date || record.finalInvoiceDetails?.date || '',
      fileName: finalDoc?.fileName || record.finalInvoiceDetails?.fileName,
      fileUrl: finalDoc?.fileUrl || record.finalInvoiceDetails?.fileUrl
    },
    canonicalMaterials: calcOutput.canonicalMaterials,
    summary: calcOutput.summary,
    thresholdApplied: calcOutput.thresholdApplied,
    updated_at: new Date().toISOString()
  };

  comparativeAnalysesStore.set(updated.id, updated);
  return updated;
}

