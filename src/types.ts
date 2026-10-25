export interface PurchasingSupervisor {
  id: string;
  name: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  pin?: string;
  avatar?: string;
  items?: any[];
  firstOfferFileUrl?: string | null;
  finalOfferFileUrl?: string | null;
  fileUrl?: string | null;
  [key: string]: any;
}

export type Supervisor = PurchasingSupervisor;

export interface Personnel {
  id: string;
  name: string;
  title: string;
  department?: string;
  supervisorId: string;
  supervisorName: string;
  email?: string;
  phone?: string;
  active: boolean;
  avatar?: string;
  created_at?: string;
  items?: any[];
  firstOfferFileUrl?: string | null;
  finalOfferFileUrl?: string | null;
  fileUrl?: string | null;
  [key: string]: any;
}

export interface Jobsite {
  id: string;
  name: string;
  code: string;
  projectManager: string;
  location?: string;
  status: string;
  budget: number;
  [key: string]: any;
}

export interface InvoiceItem {
  id: string;
  materialName: string;
  originalName?: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  unitPriceNet?: number;
  grossUnitPrice?: number;
  totalPrice: number;
  grossTotalPrice?: number;
  vatPercentage?: number;
  discountAmount?: number;
  brand?: string;
  model?: string;
  dimensions?: string;
  diameter?: string;
  color?: string;
  quality?: string;
  productCode?: string;
  confidence?: number;
  description?: string;
  [key: string]: any;
}

export interface InvoiceRecord {
  id: string;
  invoiceNo?: string;
  invoiceNumber?: string;
  discountId?: string;
  date: string;
  supplier: string;
  totalAmount: number;
  netSubtotalAmount?: number;
  vatTotalAmount?: number;
  vatRate?: number;
  excludedFreightAmount?: number;
  excludedFreightGrossAmount?: number;
  excludedFreightItems?: InvoiceItem[];
  jobsiteId?: string;
  jobsiteName?: string;
  uploadedBySupervisorId?: string;
  uploadedBySupervisorName?: string;
  rawFileName?: string;
  fileUrl?: string;
  driveFileId?: string;
  category?: string;
  notes?: string;
  items: InvoiceItem[];
  isDeleted?: boolean;
  deletedAt?: string;
  created_at?: string;
  status?: string;
  prizmaProcessId?: number;
  prizmaRequestCode?: string;
  prizmaOrderCode?: string;
  prizmaDocumentNo?: string;
  prizmaSupplier?: string;
  prizmaJobsite?: string;
  prizmaStatus?: string;
  prizmaAmount?: number;
  prizmaLinkedAt?: string;
  [key: string]: any;
}

export interface StageDocument {
  stageNumber: number;
  title: string;
  amount: number;
  supplier?: string;
  documentNumber?: string;
  isLowestInitial?: boolean;
  isVatIncluded?: boolean;
  fileUrl?: string;
  fileName?: string;
  driveFileId?: string;
  isFinal?: boolean;
  date?: string;
  roundIndex?: number;
  [key: string]: any;
}

export interface NegotiationRound {
  id: string;
  roundNumber: number;
  date: string;
  vendorName: string;
  quotedPrice: number;
  previousPrice?: number;
  discountThisRound?: number;
  documentName?: string;
  documentUrl?: string;
  note?: string;
  [key: string]: any;
}

export type AuditRiskStatus = 'NORMAL' | 'EXCESSIVE_DISCOUNT' | 'SUSPICIOUS_PRICE' | 'FLAGGED_BOTH' | 'EXECUTIVE_APPROVED';

export type CalculationMethod = 'LEGACY_FIRST_TO_FINAL' | 'MARKET_BASELINE_TO_FINAL';

export interface DiscountRecord {
  id: string;
  orderDate: string;
  supervisorId: string;
  supervisorName: string;
  jobsiteId: string;
  jobsiteName: string;
  category: string;
  vendorName: string;
  offerPrice: number;
  agreedPrice: number;
  discountAmount?: number;
  discountPercentage?: number;
  adjustedOfferPrice?: number;
  status: 'Onaylandı' | 'Beklemede' | 'İncelemede' | 'Reddedildi';
  notes?: string;
  invoiceNo?: string;
  invoiceNumber?: string;
  items?: InvoiceItem[];
  negotiationRounds?: NegotiationRound[];
  stageDocuments?: StageDocument[];
  initialOffersComparison?: InitialOfferDetail[];
  negotiationCount?: number;
  crossNegotiationApplied?: boolean;
  firstOfferFileUrl?: string;
  firstOfferFileName?: string;
  firstOfferDriveFileId?: string;
  finalOfferFileUrl?: string;
  finalOfferFileName?: string;
  finalOfferDriveFileId?: string;
  recordOriginType?: 'gol' | 'asist';
  performedByPersonnelId?: string | null;
  performedByPersonnelName?: string | null;
  isNewVendor?: boolean;
  distinctFirmsNegotiated?: number;
  isDeleted?: boolean;
  deletedAt?: string;
  created_at?: string;
  auditStatus?: AuditRiskStatus;
  auditFlags?: string[];
  auditReviewedBy?: string;
  auditReviewedAt?: string;
  executiveAuditNote?: string;
  isEffortScoreFrozen?: boolean;
  benchmarkComparison?: any;
  scopeDeductionAmount?: number;
  scopeDeductionReason?: string;
  procedureWarnings?: string[];
  finalNegotiationDate?: string;
  // Comparative Offer & Real Savings Extension
  calculationMethod?: CalculationMethod;
  kpiEligible?: boolean;
  calculationFlags?: string[];
  comparativeAnalysisId?: string;
  analysisCode?: string;
  internalVendorDiscount?: number;
  realMarketSavings?: number;
  marketReferencePrice?: number;
  realSavingsPercentage?: number;
  isSingleVendor?: boolean;
  isAboveBestOffer?: boolean;
  aboveBestOfferDiff?: number;
  competitorCount?: number;
  excludedOfferCount?: number;
  unapprovedItemCount?: number;
  prizmaProcessId?: number;
  prizmaRequestCode?: string;
  prizmaOrderCode?: string;
  prizmaDocumentNo?: string;
  prizmaSupplier?: string;
  prizmaJobsite?: string;
  prizmaStatus?: string;
  prizmaAmount?: number;
  prizmaLinkedAt?: string;
  [key: string]: any;
}

export interface PrizmaDemandSummary {
  id: number;
  requestCode: string;
  orderCode?: string;
  documentNo?: string;
  documentDate?: string;
  supplier?: string;
  inn?: string;
  invoiceAmount?: number;
  paidAmount?: number;
  currency?: string;
  jobsite?: string;
  workPlaceId?: number;
  status?: string;
  description?: string;
  lastAttachedFileName?: string;
  createdOn?: string;
  createdBy?: string;
  prizmaUrl: string;
  matchScore?: number;
  matchReasons?: string[];
}

export interface MaterialComparisonHistoryItem {
  date: string;
  supplier: string;
  unitPrice: number;
  unitPriceNet?: number;
  grossUnitPrice?: number;
  vatPercentage?: number;
  quantity: number;
  invoiceId?: string;
  invoiceNumber?: string;
  originalName?: string;
  comparisonMode?: 'COMMODITY_STANDARD' | 'BRAND_SEGMENTED';
  qualitySegment?: 'COMMODITY' | 'PREMIUM' | 'STANDARD' | 'ECONOMY';
  qualitySegmentLabel?: string;
  brand?: string;
  jobsiteId?: string;
  jobsiteName?: string;
  supervisorName?: string;
  fileUrl?: string;
  rawFileName?: string;
  [key: string]: any;
}

export interface MaterialComparison {
  materialName: string;
  /** Kalıcı katalog anahtarı (ad parmak izi) */
  catalogKey?: string;
  /** Kullanıcının elle birleştirdiği katalog kaydı (otomatik bölünmez) */
  catalogLocked?: boolean;
  category: string;
  unit: string;
  comparisonMode?: 'COMMODITY_STANDARD' | 'BRAND_SEGMENTED';
  comparisonModeLabel?: string;
  qualitySegment?: 'COMMODITY' | 'PREMIUM' | 'STANDARD' | 'ECONOMY';
  qualitySegmentLabel?: string;
  brand?: string;
  minUnitPrice: number;
  maxUnitPrice: number;
  avgPrice: number;
  avgUnitPrice?: number;
  minGrossUnitPrice?: number;
  maxGrossUnitPrice?: number;
  avgGrossUnitPrice?: number;
  minNetUnitPrice?: number;
  maxNetUnitPrice?: number;
  avgNetUnitPrice?: number;
  priceBasis?: 'VAT_INCLUSIVE_22';
  priceDifferencePercentage: number;
  cheapestJobsiteName?: string;
  priciestJobsiteName?: string;
  totalQuantityPurchased?: number;
  totalSpend?: number;
  history: MaterialComparisonHistoryItem[];
  [key: string]: any;
}

export interface SupervisorJobsiteBreakdown {
  jobsiteId: string;
  jobsiteName: string;
  discountAmount: number;
  listPrice: number;
  transactionCount: number;
  discountPercentage: number;
  [key: string]: any;
}

export interface SupervisorPerformance {
  supervisorId: string;
  supervisorName: string;
  totalTransactions: number;
  totalListPrice: number;
  totalAgreedPrice: number;
  totalDiscountAmount: number;
  avgDiscountPercentage: number;
  totalGol: number;
  totalAsist: number;
  golDiscountAmount: number;
  asistDiscountAmount: number;
  assistRatio: number;
  avgNegotiationRounds: number;
  totalNegotiationRounds: number;
  avgDistinctFirms: number;
  negotiationEffortScore: number;
  procedureViolationCount: number;
  personnelBreakdown?: any[];
  topJobsiteName?: string;
  jobsiteBreakdown?: SupervisorJobsiteBreakdown[];
  // Comparative Market Savings Extensions
  totalRealMarketSavings?: number;
  totalInternalVendorDiscount?: number;
  comparativeCount?: number;
  marketSavingsCount?: number;
  totalLegacySavings?: number;
  legacyCount?: number;
  singleVendorCount?: number;
  aboveBestOfferCount?: number;
  avgRealSavingsPercentage?: number;
  [key: string]: any;
}

export interface ValidationCheckResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  checks: {
    mathConsistency: 'valid' | 'warning' | 'error';
    dateValid: 'valid' | 'warning' | 'error';
    vendorPresent: 'valid' | 'warning' | 'error';
    itemsPresent: 'valid' | 'warning' | 'error';
    duplicateCheck: 'valid' | 'warning' | 'error';
  };
  [key: string]: any;
}

export interface DuplicateInvoiceMatch {
  isDuplicate: boolean;
  matchedInvoiceId?: string;
  invoiceNumber?: string;
  reason?: string;
  matchConfidence?: number;
  [key: string]: any;
}

export interface PersistenceStatus {
  recordId: string;
  firestoreStatus: 'success' | 'warning' | 'failed' | 'local_fallback';
  readBackVerified: boolean;
  backupStatus: 'success' | 'failed';
  fileStorageStatus: 'stored' | 'failed' | 'none';
  mathCheckStatus: 'valid' | 'warning' | 'failed';
  validationWarnings?: string[];
  [key: string]: any;
}

// ============================================================================
// COMPARATIVE OFFER & REAL SAVINGS ANALYSIS TYPES
// ============================================================================

export type ComparativeDocumentRole =
  | 'INITIAL_OFFER'
  | 'FIRST_OFFER'
  | 'COMPETITOR_FIRST_OFFER'
  | 'INTERMEDIATE_ROUND'
  | 'DISCOUNT_ROUND_1'
  | 'DISCOUNT_ROUND_2'
  | 'DISCOUNT_ROUND_N'
  | 'FINAL_OFFER'
  | 'FINAL_INVOICE'
  | 'UNCERTAIN';

export type DocumentRole = ComparativeDocumentRole;

export interface ComparativeDocumentItem {
  id: string;
  originalName: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  brand?: string;
  quality?: string;
  diameter?: string;
  dimensions?: string;
  standard?: string;
  confidence?: number;
  [key: string]: any;
}

export interface ComparativeDocument {
  id: string;
  fileName: string;
  fileUrl: string;
  fileHash?: string;
  fileType?: string;
  supplier: string;
  taxId?: string;
  documentNumber?: string;
  date?: string;
  documentRole: ComparativeDocumentRole;
  roleConfidence: number;
  totalAmount: number;
  currency: string;
  isVatIncluded: boolean;
  isShippingIncluded: boolean;
  isExcluded: boolean;
  exclusionReason?: string;
  items: ComparativeDocumentItem[];
  sourceDocumentIndex?: number;
  rawTextPreview?: string;
  [key: string]: any;
}

export interface CanonicalLineMatch {
  documentId: string;
  documentRole: ComparativeDocumentRole;
  supplierName: string;
  documentNumber?: string;
  originalDescription: string;
  quantity: number;
  unit: string;
  normalizedQuantity: number;
  normalizedUnit: string;
  rawUnitPrice: number;
  normalizedUnitPrice: number; // Normalized for comparison (e.g. VAT included & standard unit)
  totalPrice: number;
  isVatIncluded: boolean;
  matchConfidence: number;
  matchReason?: string;
  isApprovedByUser: boolean;
  lineIndex: number;
  isCompetitor: boolean;
  isInitialOffer: boolean;
  [key: string]: any;
}

export interface TechnicalSpecs {
  diameter?: string;
  grade?: string;
  standard?: string;
  dimensions?: string;
  brand?: string;
  thickness?: string;
  density?: string;
  [key: string]: any;
}

export interface CanonicalMaterial {
  id: string;
  commonName: string;
  /** Belgedeki özgün (Rusça) kalem adı */
  originalName?: string;
  /** Nihai faturadaki satır sırası (0'dan) */
  sourceLineIndex?: number;
  /** false: bu kalem ilk teklifte bulunamadı, referans fiyat yok */
  referenceFound?: boolean;
  /** 2 = bire bir ad/artikel eşleştirmesi (invoiceLineMatcher) */
  lineMatchVersion?: number;
  materialType: string;
  standardUnit: string;
  specs: TechnicalSpecs;
  purchasedQuantity: number;
  purchasedUnitPrice: number;
  purchasedSupplier: string;
  marketReferenceUnitPrice: number; // MIN of valid initial offers
  marketReferenceSupplier: string;
  winningFirstUnitPrice?: number; // Satın alınan firmanın ilk teklif fiyatı
  realUnitSavings: number; // marketReferenceUnitPrice - purchasedUnitPrice
  realTotalSavings: number; // realUnitSavings * purchasedQuantity
  realSavingsPercentage: number; // (realUnitSavings / marketReferenceUnitPrice) * 100
  internalVendorUnitDiscount: number; // winningFirstUnitPrice - purchasedUnitPrice
  internalVendorTotalDiscount: number;
  isAboveBestOffer: boolean; // purchasedUnitPrice > marketReferenceUnitPrice
  aboveBestOfferDiff?: number;
  status: 'auto_matched' | 'needs_confirmation' | 'confirmed' | 'rejected';
  matchConfidence: number;
  matchReason?: string;
  warningMessage?: string;
  lines: CanonicalLineMatch[];
  [key: string]: any;
}

export interface AnalysisAuditEntry {
  timestamp: string;
  userId?: string;
  userName?: string;
  action: string;
  details: string;
  previousValue?: any;
  newValue?: any;
}

export interface NegotiationRoundDetail {
  roundNumber: number;
  documentId?: string;
  documentRole: string;
  supplier: string;
  amount: number;
  documentNumber?: string;
  date?: string;
  fileName?: string;
  note?: string;
}

export interface InitialOfferDetail {
  documentId?: string;
  supplier: string;
  amount: number;
  isLowest: boolean;
  documentNumber?: string;
  date?: string;
  fileName?: string;
  fileUrl?: string;
  driveFileId?: string;
  isVatIncluded?: boolean;
  itemsCount?: number;
  priceDiffFromLowest?: number;
  priceDiffPercentage?: number;
  notes?: string;
}

export interface ComparativeAnalysisSummary {
  totalInitialLowestOffer: number;
  totalFinalPurchase: number;
  realMarketSavings: number;
  realSavingsRate: number;
  internalVendorSavings: number;
  isAboveBestOfferCount: number;
  isSingleVendor: boolean;
  excludedOffersCount: number;
  pendingApprovalsCount: number;
  totalVendors: number;
  totalDocuments: number;
  totalMaterials: number;
  overallConfidence: number;
  lowestInitialOfferAmount?: number;
  lowestInitialOfferSupplier?: string;
  finalPurchaseAmount?: number;
  finalPurchaseSupplier?: string;
  finalInvoiceNumber?: string;
  finalInvoiceDate?: string;
  negotiationRoundsCount?: number;
  internalVendorRate?: number;
  initialOffersList?: InitialOfferDetail[];
  intermediateRoundsList?: NegotiationRoundDetail[];
}

export type AnalysisStatus =
  | 'draft'
  | 'uploading'
  | 'processing_ocr'
  | 'classifying'
  | 'matching_materials'
  | 'needs_approval'
  | 'completed'
  | 'error';

export interface ComparativeAnalysisRecord {
  id: string;
  analysisCode: string; // e.g. ANL-2026-000184
  jobsiteId: string;
  jobsiteName: string;
  supervisorId: string;
  supervisorName: string;
  performedByPersonnelId?: string | null;
  performedByPersonnelName?: string | null;
  currency: string;
  date: string;
  status: AnalysisStatus;
  calculationMethod: CalculationMethod; // 'MARKET_BASELINE_TO_FINAL'
  winningSupplier: string;
  isSingleVendor: boolean;
  totalFinalPurchase: number;
  totalInitialLowestOffer: number;
  realMarketSavings: number;
  realSavingsRate: number;
  internalVendorSavings: number;
  isAboveBestOffer: boolean;
  negotiationRoundsCount?: number;
  negotiationStages?: NegotiationRoundDetail[];
  initialOffersComparison?: InitialOfferDetail[];
  finalInvoiceDetails?: {
    supplier: string;
    amount: number;
    invoiceNumber?: string;
    date?: string;
    fileName?: string;
    fileUrl?: string;
  };
  thresholdApplied: {
    thresholdRub: number;
    isOverThreshold: boolean;
    isMandatory: boolean;
  };
  summary: ComparativeAnalysisSummary;
  documents: ComparativeDocument[];
  canonicalMaterials: CanonicalMaterial[];
  auditLog: AnalysisAuditEntry[];
  associatedDiscountId?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  isDeleted?: boolean;
  [key: string]: any;
}

export interface MaterialSynonym {
  id: string;
  rawText: string;
  normalizedKey: string;
  canonicalName: string;
  materialType: string;
  standardUnit: string;
  specs: TechnicalSpecs;
  approvedBy?: string;
  updatedAt: string;
}

export interface ComparativeAnalysisConfig {
  thresholdRub: number;
  isMandatoryOverThreshold: boolean;
  allowNegativeImpactInTotal: boolean;
  requirePinForExclusion: boolean;
  updatedAt?: string;
}

export interface CheaperHistoricalBenchmark {
  lineIndex: number;
  materialName: string;
  originalName?: string;
  historicalOriginalName?: string;
  brand?: string;
  unit: string;
  quantity: number;
  currentUnitPrice: number;
  historicalBestUnitPrice: number;
  historicalAvgUnitPrice: number;
  historicalSupplier: string;
  historicalJobsiteName: string;
  historicalDate: string;
  historicalInvoiceNo: string;
  historicalInvoiceId?: string;
  historicalFileUrl?: string;
  historicalPrizmaDemandId?: number | string;
  historicalPrizmaUrl?: string;
  historicalSource: 'GES_ARCHIVE' | 'PRIZMA_ERP';
  /** Aynı malzemenin bulunan (kayıttan önceki, belgeyle doğrulanmış) geçmiş alım sayısı */
  historicalPurchasesCount?: number;
  unitOverpayment: number;
  totalLineOverpayment: number;
  overpaymentPercentage: number;
  matchReason: string;
}

export interface DiscountHistoricalAnomalyRecord {
  discountId: string;
  invoiceId?: string;
  recordSource?: 'DISCOUNT_CENTER' | 'DIRECT_INVOICE';
  invoiceNo: string;
  orderDate: string;
  vendorName: string;
  jobsiteName: string;
  supervisorId: string;
  supervisorName: string;
  offerPrice: number;
  agreedPrice: number;
  claimedDiscountAmount: number;
  totalPotentialExtraSavings: number;
  buyerNotifiedBeforeSave: boolean;
  notifiedAt?: string;
  firstOfferFileUrl?: string;
  finalOfferFileUrl?: string;
  affectedLines: CheaperHistoricalBenchmark[];
}



