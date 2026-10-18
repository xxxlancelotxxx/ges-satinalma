import path from 'path';
import fs from 'fs';
import os from 'os';
import { prizmaService } from './prizmaService';
import { normalizeVendorName } from '../src/utils/vendorNormalizer';
import { normalizeCategoryName, translateRussianMaterialToTurkish, ensureRussianOriginalName } from '../src/utils/categoryClassifier';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import {
  InvoiceLineCheck,
  DocumentLinesResult,
  CURRENT_DOC_LINES_PARSER_VERSION,
  buildLineCheck,
  extractPdfText,
  readInvoiceDocumentText,
  readInvoiceDocumentWithGemini
} from './invoiceDocumentLines';

let defaultDb: any = null;
try {
  const configRaw = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
  const firebaseConfig = JSON.parse(configRaw);
  const fbApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  defaultDb = getFirestore(fbApp, firebaseConfig.firestoreDatabaseId || '(default)');
} catch (e: any) {
  // handled gracefully
}

export interface PrizmaInvoiceRecord {
  id: string;
  invoiceNumber: string;
  date: string;
  supplier: string;
  vendorName: string;
  supplierInn?: string;
  totalAmount: number;
  currency: string;
  jobsiteName: string;
  category: string;
  description?: string;
  prizmaDemandId: number;
  prizmaRequestCode: string;
  prizmaOrderCode?: string;
  prizmaOrderDemandId?: number;
  prizmaUserProcessId?: number;
  prizmaStatus?: string;
  prizmaCreatedBy?: string;
  prizmaUrl: string;
  prizmaBtfUrl: string;
  prizmaStfUrl?: string;
  invoiceFileId?: number;
  excludedFreightAmount?: number;
  excludedFreightGrossAmount?: number;
  /** Kalemlerin kaynağı: fatura belgesi (doğrulanmış) veya STF sipariş satırları */
  linesSource?: 'invoice_pdf' | 'stf_order';
  lineCheck?: InvoiceLineCheck;
  items: Array<{
    id: string;
    materialName: string;
    originalName?: string;
    materialCode?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    unitPriceNet?: number;
    grossUnitPrice?: number;
    totalPrice: number;
    grossTotalPrice?: number;
    vatPercentage?: number;
     isNetNormalized?: boolean;
    activityName?: string;
    category?: string;
    lineSource?: string;
    [key: string]: any;
  }>;
  isDeleted: boolean;
  prizmaSource: boolean;
  syncedAt: string;
}

const BACKUP_DIR = path.join(os.tmpdir(), 'data_backup');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export function cleanRawMaterialName(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim();

  // 1. Remove Jobsite prefixes e.g. "НИИДАР-2 /ФАКТ /", "NIDAR-2/", "AFI MALL/AVANS/", "SBER-2/FAKT/"
  s = s.replace(/^(?:[A-Z0-9А-ЯЁa-z0-9ğüşıöçĞÜŞİÖÇ_.-]+\s*[/|\\-]\s*)+(?:ФАКТ|FAKT|ПЛАН|PLAN|АВАНС|AVANS|STF|BTF|СЧЕТ|SCHET)?\s*[/|\\-]?\s*/i, '');
  
  // 2. Remove isolated jobsite tags e.g. "НИИДАР-2", "NIDAR-2", "AFI", "SBER" if at beginning
  s = s.replace(/^(?:НИИДАР(?:-2)?|NIDAR(?:-2)?|AFI\s*MALL|SBER(?:BANK)?|БАУМАН|ШЕЛЕПИХА|ПРАВДА|КРАСНОСЕЛЬСКАЯ)\s*[/|:\s\\-]\s*/i, '');

  // 3. Remove accounting tags like "/ФАКТ/", "/FAKT/", "/АВАНС/", "/AVANS/"
  s = s.replace(/\s*[/|\\-]\s*(?:ФАКТ|FAKT|ПЛАН|PLAN|АВАНС|AVANS)\s*[/|\\-]?\s*/gi, ' ');

  // 4. Remove Prizma administrative instructions in parentheses
  s = s.replace(/\(\s*(?:excel\s*dosyas[ıi]n[ae]\s*g[öo]re[^)]*|ad[ıi]na\s+[^)]*|adet|saha\s*genel[^)]*|ofis\s*i[çc]in[^)]*|fatura\s*i[çc]in[^)]*|it\s*sipari[şs][^)]*|kamp\s*ofis[^)]*|villa\s*i[çc]in[^)]*)\s*\)/gi, ' ');

  // 5. Clean extra punctuation at start/end
  s = s.replace(/^[\s/|:;,\\-]+|[\s/|:;,\\-]+$/g, '').replace(/\s{2,}/g, ' ').trim();

  return s;
}

const isReadyMixConcreteText = (text: string): boolean => {
  const t = text.toLowerCase();
  if (/газобетон|gazbeton|пескобетон|peskobeton|бетоноконтакт|betonokontakt|бетоносмесител|бетоновод|бетонолом|бур\s+по|диск|круг|алмазн|коронка|пика|зубило|keski|matkap|пила|testere|саморез|дюбель|анкер|гвозд|крепеж|краск|грунт|растворител|tiner|solvent/i.test(t)) {
    return false;
  }
  return /бетон\s*(?:в\s*\d|b\s*\d|м\s*\d|m\s*\d|товарн|бсг|бст|мелкозерн|гидротехнич)|товарный\s*бетон|hazır\s*beton|hazir\s*beton|\bbeton\s+c\d|\bc\d{2}\/\d{2}\s*beton|grobeton|гробетон|керамзитобетон|бетолюкс|betolux|eurobeton|евробетон|мосбетон|раствор\s+(?:м\s*\d|кладочн|штукатурн|товарн|монтажн|цементн)/i.test(t);
};

const isAuthenticRussianText = (s?: string): boolean => {
  const t = (s || '').trim();
  if (!t || t.length < 4) return false;
  if (/\[[^\]]+\]$/.test(t) && /Гидроизоляция рулонная наплавляемая|Утеплитель теплоизоляционный|Хозяйственно-бытовое обеспечение|Диск отрезной \/ круг шлифовальный|Труба полипропиленовая \/ ПВХ/i.test(t)) {
    return false;
  }
  if (/^(?:demir\s+nervurlu|inşaat\s+demir|insaat\s+demir|kosebent|köşebent|membran|gaz\s*beton|kontrplak|kereste|profil\s+demir|boru\s+demir|hasir\s+celik|cimento|çimento|ugolok|kutu\s+profil|is\s+elbisesi|ayakabi|cizme|eldiven|baret)\b/i.test(t)) {
    return false;
  }
  const stripped = t
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/(?:гост|ту)\s*[\d.-]*/gi, ' ')
    .replace(/[аa]400|[аa]500[сc]?|[аa]240/gi, ' ');
  return /[а-яА-ЯёЁ]{4,}/.test(stripped);
};

const isShortNoteOrSpecFragment = (s: string): boolean => {
  const t = (s || '').trim();
  if (!t || t.length < 4) return true;
  if (/^(?:\d+(?:[.,]\d+)?\s*(?:шт|м|мм|см|кг|г|л|мл|уп|упак|кор|рул|пл|мпа|м2|м3)\.?|\d+\s*[xх*×]\s*\d+.*)$/i.test(t)) return true;
  if (/^(?:кж\s*[\d.,-]|к\d\b|корпус|стилобат|блок|вжк|офис|склад|этаж|секция|ось|оси|отм\.|схем|арт\.?\s*\d|спайка|осина|гсп(?:-df)?|тип\s*\d|вид\s*\d|сорт\s*\d|мешок|однодверный|съемный|стандартный|etap|blok|kat)\b/i.test(t)) return true;
  if (!isAuthenticRussianText(t)) return true;
  return false;
};

const extractShortSpecNote = (s?: string): string => {
  const t = (s || '').trim();
  if (!t || t.length > 35) return '';
  if (/^(?:[aа]500[cс]?|[aа]240|[aа]400|[dд]\s*(?:300|350|400|500|600)|\d+(?:[.,]\d+)?\s*(?:мм|mm|м|m|кг|kg|л|l)|эпп|экп|ткп|хпп|epp|ekp)$/i.test(t)) {
    return t;
  }
  return '';
};

/** Kayıttaki kalemlerin tamamı fatura belgesinden mi okunmuş? */
export function hasDocumentLines(rec: any): boolean {
  return Boolean(
    rec && rec.linesSource === 'invoice_pdf' && Array.isArray(rec.items) && rec.items.length > 0 &&
    rec.items.every((it: any) => it?.lineSource === 'invoice_pdf')
  );
}

export function isCleanMaterialRecord(inv: any): boolean {
  if (!inv || inv.isDeleted) return false;
  // Kesinlikle STF'si olmalı (kullanıcı isteği: doğrudan fatura kalemleri olan onaylı siparişler)
  if (!inv.prizmaOrderDemandId) return false;

  const allText = (
    (inv.category || '') + ' ' +
    (inv.description || '') + ' ' +
    (inv.supplier || '') + ' ' +
    (inv.items || []).map((i: any) => (i.materialName || '') + ' ' + (i.originalName || '')).join(' ')
  ).toLowerCase();

  // 1. Beton Eleme (Yalnızca hazır beton / grobeton; пескобетон, растворитель, бетоноконтакт vb. korunur)
  if (isReadyMixConcreteText(allText)) {
    return false;
  }

  // 2. Taşeron / Hizmet / İşçilik / Kira / Nakliye Eleme
  if (/taseron|tasaron|субподряд|subcontract|hakedis|hakediş|акт\s*выполнен|hizmet|услуг|service|iscilik|işçilik|labor|шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|nakliye|лоджистик|питани|yemek|проживани|otel|охран|guvenlik|клининг|уборк|виза|vize|перевод|tercüme|нотариус|noter|страхов|sigorta|аванс/i.test(allText) && !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|страховочн.*привяз|саморез|крепеж|светильник|прожектор|кабель|труба|арматур|фанер|доска|брус|утеплител|гипсокартон/i.test(allText)) {
    return false;
  }

  // 3. Durum Kontrolü (Yalnızca Kesinleşmiş / Onaylanmış Faturalar)
  const status = (inv.prizmaStatus || '').toLowerCase();
  const isApprovedStatus =
    status.includes('ödeme bekliyor') ||
    status.includes('odeme bekliyor') ||
    status.includes('1c') ||
    status.includes('1с') ||
    status.includes('onaylandı') ||
    status.includes('onaylandi') ||
    status.includes('tamamlandı') ||
    status.includes('tamamlandi') ||
    status.includes('ödendi') ||
    status.includes('odendi');

  if (!isApprovedStatus) return false;

  // 4. En az bir geçerli malzeme kalemi olmalı
  if (!inv.items || !Array.isArray(inv.items) || inv.items.length === 0) return false;

  return true;
}

class PrizmaSyncService {
  private dbInstance: any = defaultDb;
  private memoryCache: PrizmaInvoiceRecord[] | null = null;
  private cleanListCache: PrizmaInvoiceRecord[] | null = null;
  private cacheTimestamp: number = 0;
  private isSyncing: boolean = false;
  private syncProgress: { percent: number; message: string } = { percent: 0, message: '' };
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private orderRowsCache = new Map<number, any[]>();
  /** demandId → fatura belgesi okuma sonucu (aynı dosya her gece yeniden indirilmesin) */
  private docLinesCache = new Map<number, DocumentLinesResult & { invoiceTotal: number }>();

  constructor() {
    this.loadInitialFromDisk();
    this.loadOrderRowsFromDisk();
    this.loadDocLinesFromDisk();
  }

  private healInvoicePdfItemVat(it: any, defaultVat = 22): any {
    if (!it || typeof it !== 'object') return it;
    const vatPct = Number(it.vatPercentage ?? defaultVat);
    const grossUnit = Number(it.grossUnitPrice) || 0;
    const netUnit = Number(it.unitPriceNet ?? it.unitPrice) || 0;
    const qty = Number(it.quantity) || 1;
    const grossTot = Number(it.grossTotalPrice) || Number((grossUnit * qty).toFixed(2));
    if (vatPct > 0 && grossUnit > 0 && Math.abs(grossUnit - netUnit) < 0.01) {
      const fixedNetTot = Number((grossTot / (1 + vatPct / 100)).toFixed(2));
      const fixedNetUnit = Number((fixedNetTot / qty).toFixed(2));
      return {
        ...it,
        unitPrice: fixedNetUnit,
        unitPriceNet: fixedNetUnit,
        totalPrice: fixedNetTot,
        grossTotalPrice: grossTot,
        isNetNormalized: true
      };
    }
    return it;
  }

  private loadDocLinesFromDisk() {
    try {
      const filePath = path.join(BACKUP_DIR, 'prizma_invoice_doc_lines.json');
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const [k, v] of Object.entries(parsed || {})) {
          const entry = v as any;
          if (entry && entry.verified && Array.isArray(entry.items)) {
            entry.items = entry.items.map((it: any) => this.healInvoicePdfItemVat(it));
          }
          this.docLinesCache.set(Number(k), entry);
        }
      }
    } catch (_) {}
  }

  private saveDocLinesToDisk() {
    try {
      const obj: Record<number, any> = {};
      this.docLinesCache.forEach((v, k) => { obj[k] = v; });
      fs.writeFileSync(path.join(BACKUP_DIR, 'prizma_invoice_doc_lines.json'), JSON.stringify(obj), 'utf-8');
    } catch (_) {}
  }

  /** Talebin "Счет на оплату" dosyasını Prizma'dan bulur ve PDF metnini + ham verisini döndürür. */
  private async fetchInvoiceDocumentText(demandId: number, knownFileId?: number): Promise<{ fileId?: number; text?: string; buffer?: Buffer; mimeType?: string; note?: string }> {
    let fileId = knownFileId;
    if (!fileId) {
      const files = await (prizmaService as any).authorizedGet(`/api/process/list-files/BTF/${demandId}`);
      if (Array.isArray(files)) {
        const schet = files.find((f: any) =>
          Number(f.doctype) === 2 || /счет/i.test(f.docTypeNameRU || '') || /счет/i.test(f.docTypeNameTR || '') ||
          /proforma/i.test(f.docTypeNameEN || '') || /schet/i.test(f.fileName || ''));
        fileId = schet?.id;
      }
    }
    if (!fileId) return { note: 'Prizma talebinde "Счет на оплату" belgesi yok' };
    const res = await prizmaService.downloadFile(`/api/process/get-file/BTF/${demandId}/${fileId}/fatura.pdf`);
    if (res.status === 404 || (res.status === 200 && !res.data?.length)) return { fileId, note: `Belge Prizma'da bulunamadı (HTTP ${res.status})` };
    // Geçici hatalar (5xx, yetki) kalıcı sonuç sayılmaz: üst katman "Belge okunamadı" der ve tekrar dener
    if (res.status !== 200) throw new Error(`Prizma dosya servisi HTTP ${res.status}`);
    if (res.data.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return { fileId, buffer: res.data, mimeType: res.contentType, note: `Belge PDF değil (${res.contentType}); metin katmanı okunamıyor` };
    }
    const text = await extractPdfText(res.data);
    if (!text || text.replace(/\s+/g, '').length < 50) return { fileId, buffer: res.data, mimeType: 'application/pdf', note: 'PDF taranmış görüntü; metin katmanı yok' };
    return { fileId, text, buffer: res.data, mimeType: 'application/pdf' };
  }

  /**
   * Bir Prizma faturasının kalemlerini belirler: fatura belgesi okunup tutarı tutuyorsa belgedeki
   * kalemler, aksi halde STF satırları (lineCheck ile "doğrulanmadı" işaretli). Fark asla nakliyeye yazılmaz.
   */
  public async resolveInvoiceLines(params: {
    demandId: number;
    fileId?: number;
    invoiceTotal: number;
    docYear: string;
    stfItems: any[];
    stfFreightNet: number;
    stfFreightGross: number;
    previous?: Partial<PrizmaInvoiceRecord> | null;
    allowDownload?: boolean;
  }): Promise<{ items: any[]; freightNet: number; freightGross: number; linesSource: 'invoice_pdf' | 'stf_order'; lineCheck: InvoiceLineCheck }> {
    const { demandId, invoiceTotal, previous } = params;
    const defaultVat = params.docYear === '2025' ? 20 : 22;
    const prevCheck = previous?.lineCheck;
    if (
      prevCheck?.status === 'verified' && hasDocumentLines(previous) &&
      Math.abs((prevCheck.invoiceTotal || 0) - invoiceTotal) < 0.01 &&
      (!params.fileId || !prevCheck.fileId || prevCheck.fileId === params.fileId)
    ) {
      const healedPrevItems = (previous.items || []).map((it: any) => this.healInvoicePdfItemVat(it, defaultVat));
      return {
        items: healedPrevItems,
        freightNet: Number(previous.excludedFreightAmount) || 0,
        freightGross: Number(previous.excludedFreightGrossAmount) || 0,
        linesSource: 'invoice_pdf',
        lineCheck: prevCheck
      };
    }

    let docResult: DocumentLinesResult | undefined;
    const cached = this.docLinesCache.get(demandId);
    const isCacheUsable = cached &&
      Math.abs(cached.invoiceTotal - invoiceTotal) < 0.01 &&
      (!params.fileId || cached.fileId === params.fileId) &&
      (cached.verified || cached.parserVersion === CURRENT_DOC_LINES_PARSER_VERSION);

    if (isCacheUsable) {
      docResult = cached;
    } else if (params.allowDownload !== false) {
      try {
        const fetched = await this.fetchInvoiceDocumentText(demandId, params.fileId);
        if (fetched.text) {
          docResult = readInvoiceDocumentText(fetched.text, { invoiceTotal, docYear: params.docYear, stfItems: params.stfItems, fileId: fetched.fileId });
        }
        // Metin tabanlı ayrıştırıcı doğrulayamadıysa veya PDF taranmış resimse Gemini AI ile oku
        if ((!docResult || !docResult.verified) && fetched.buffer) {
          const aiResult = await readInvoiceDocumentWithGemini(fetched.buffer, {
            invoiceTotal,
            docYear: params.docYear,
            stfItems: params.stfItems,
            fileId: fetched.fileId,
            mimeType: fetched.mimeType
          });
          if (aiResult.verified) {
            docResult = aiResult;
          } else if (!docResult) {
            docResult = aiResult;
          }
        }
        if (!docResult) {
          docResult = { fileId: fetched.fileId, verified: false, note: fetched.note || 'Belge okunamadı', parserVersion: CURRENT_DOC_LINES_PARSER_VERSION };
        }
        this.docLinesCache.set(demandId, { ...docResult, invoiceTotal });
      } catch (err: any) {
        // Ağ hatası kalıcı sonuç sayılmaz, önbelleğe yazılmaz
        docResult = { verified: false, note: `Belge okunamadı: ${err.message}` };
      }
    }

    if (docResult?.verified && docResult.items?.length) {
      const healedDocItems = docResult.items.map((it: any) => this.healInvoicePdfItemVat(it, defaultVat));
      return {
        items: healedDocItems,
        freightNet: docResult.freightNet || 0,
        freightGross: docResult.freightGross || 0,
        linesSource: 'invoice_pdf',
        lineCheck: buildLineCheck({
          items: docResult.items,
          freightGross: docResult.freightGross || 0,
          invoiceTotal,
          source: 'invoice_pdf',
          fileId: docResult.fileId,
          documentNote: docResult.note
        })
      };
    }

    return {
      items: params.stfItems,
      freightNet: params.stfFreightNet,
      freightGross: params.stfFreightGross,
      linesSource: 'stf_order',
      lineCheck: buildLineCheck({
        items: params.stfItems,
        freightGross: params.stfFreightGross,
        invoiceTotal,
        source: 'stf_order',
        fileId: docResult?.fileId,
        documentNote: docResult?.note
      })
    };
  }

  public setDb(d: any) {
    if (d) this.dbInstance = d;
  }

  private loadOrderRowsFromDisk() {
    try {
      const filePath = path.join(BACKUP_DIR, 'prizma_order_rows.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) this.orderRowsCache.set(Number(k), v);
          }
        }
      }
    } catch (_) {}
  }

  private saveOrderRowsToDisk() {
    try {
      const filePath = path.join(BACKUP_DIR, 'prizma_order_rows.json');
      const obj: Record<number, any[]> = {};
      this.orderRowsCache.forEach((v, k) => { obj[k] = v; });
      fs.writeFileSync(filePath, JSON.stringify(obj), 'utf-8');
    } catch (_) {}
  }

  private loadInitialFromDisk() {
    try {
      const filePath = path.join(BACKUP_DIR, 'prizma_invoices.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.memoryCache = parsed;
          this.cleanListCache = null;
          this.cacheTimestamp = Date.now();
          if (parsed[0]?.syncedAt) {
            this.lastSyncAt = parsed[0].syncedAt;
          }
        }
      }
    } catch (err: any) {
      console.warn('[PRIZMA SYNC] Disk cache read warn:', err.message);
    }
  }

  private saveToDisk(invoices: PrizmaInvoiceRecord[]) {
    try {
      const filePath = path.join(BACKUP_DIR, 'prizma_invoices.json');
      fs.writeFileSync(filePath, JSON.stringify(invoices, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[PRIZMA SYNC] Disk cache write error:', err.message);
    }
  }

  public markAsDeleted(idOrDemandId: string | number) {
    if (!idOrDemandId) return;
    const strId = String(idOrDemandId);
    if (this.memoryCache) {
      this.memoryCache = this.memoryCache.map(inv => {
        if (
          inv.id === strId ||
          `prizma_${inv.prizmaDemandId}` === strId ||
          `inv_prizma_${inv.prizmaDemandId}` === strId ||
          String(inv.prizmaDemandId) === strId
        ) {
          return { ...inv, isDeleted: true };
        }
        return inv;
      });
      this.cleanListCache = null;
      this.saveToDisk(this.memoryCache);
    }
  }

  public async getInvoicesCached(): Promise<PrizmaInvoiceRecord[]> {
    const now = Date.now();
    let rawList: PrizmaInvoiceRecord[] = [];

    if (this.memoryCache && (now - this.cacheTimestamp < 300000)) { // 5 mins cache
      if (this.cleanListCache) {
        return this.cleanListCache;
      }
      rawList = this.memoryCache;
    } else if (this.dbInstance) {
      try {
        const snap = await getDocs(collection(this.dbInstance, 'prizma_invoices'));
        if (snap.size > 0) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as PrizmaInvoiceRecord));
          list.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
          this.memoryCache = list;
          this.cleanListCache = null;
          this.cacheTimestamp = now;
          this.saveToDisk(list);
          rawList = list;
        }
      } catch (err: any) {
        console.warn('[PRIZMA SYNC] Firestore fetch warn:', err.message);
      }
    }

    if (!rawList.length && this.memoryCache) rawList = this.memoryCache;
    if (!rawList.length) {
      this.loadInitialFromDisk();
      rawList = this.memoryCache || [];
    }

    // Doğrudan temizlenmiş, beton/taşeron/hizmet/onaysız olmayan kayıtları döndür
    const cleanList = rawList.filter(isCleanMaterialRecord).map(inv => {
      const fixedBtf = inv.prizmaDemandId
        ? `https://pm.gescons.ru/process/payment-demand/2100/detail/-1/${inv.prizmaDemandId}`
        : (inv.prizmaBtfUrl || inv.prizmaUrl || '').replace(/\/detail\/[^\/]+\//, '/detail/-1/');
      const fixedStf = inv.prizmaOrderDemandId
        ? `https://pm.gescons.ru/process/order-demand/1725/detail/-1/${inv.prizmaOrderDemandId}`
        : (inv.prizmaStfUrl ? inv.prizmaStfUrl.replace(/\/detail\/[^\/]+\//, '/detail/-1/') : undefined);

      const cachedOrderRows = inv.prizmaOrderDemandId ? this.orderRowsCache.get(inv.prizmaOrderDemandId) : undefined;
      const cachedDoc = inv.prizmaDemandId ? this.docLinesCache.get(inv.prizmaDemandId) : undefined;
      const docYear = String(inv.date || '').slice(0, 4);
      const defaultVatForDoc = docYear === '2025' ? 20 : 22;
      const rawItemsList = (cachedDoc?.verified && Array.isArray(cachedDoc.items) && cachedDoc.items.length > 0)
        ? cachedDoc.items
        : (inv.items || []);
      const isIpMalyavin = /(^|[\s"«])ип\s*["«]?малявин/i.test(inv.supplier || inv.vendorName || '');
      const hasVat20Or22OnInvoice = rawItemsList.some(x => Number(x.vatPercentage) === 20 || Number(x.vatPercentage) === 22);
      const rawSumUnitQty = rawItemsList.reduce((s, x) => s + (Number(x.unitPrice) || 0) * (Number(x.quantity) || 1), 0);
      const invTot = Number(inv.totalAmount) || 0;
      const isInvoiceAlreadyNet = invTot > 0 && rawSumUnitQty > 0 && (invTot / rawSumUnitQty >= 1.12 && invTot / rawSumUnitQty <= 1.40);

      let excludedFreightNetSum = cachedDoc?.verified ? (Number(cachedDoc.freightNet) || 0) : (Number(inv.excludedFreightAmount) || 0);
      let excludedFreightGrossSum = cachedDoc?.verified ? (Number(cachedDoc.freightGross) || 0) : (Number(inv.excludedFreightGrossAmount) || 0);
      let trackedFreightHere = false;

      const mappedItems = rawItemsList
        .map((it, idx) => {
          // Fatura belgesinden okunmuş kalem: isim, birim ve fiyat belgeden gelir; STF satırıyla ezilmez.
          if (it.lineSource === 'invoice_pdf') return this.healInvoicePdfItemVat({ ...it }, defaultVatForDoc);
          const matchedRow = Array.isArray(cachedOrderRows)
            ? (cachedOrderRows.find((r: any) => `prizma_row_${r.id}` === it.id) || cachedOrderRows[idx])
            : undefined;
          const pdfDesc = matchedRow?.pdfExtractedName ? cleanRawMaterialName(matchedRow.pdfExtractedName) : '';
          const rowDesc = matchedRow?.description ? cleanRawMaterialName(matchedRow.description) : '';
          const rowMat1 = matchedRow?.materialName ? cleanRawMaterialName(matchedRow.materialName) : '';
          const rowMat2 = matchedRow?.materialName2 ? cleanRawMaterialName(matchedRow.materialName2) : '';
          // Bazı Prizma stok kartlarında Rusça isim materialName alanında, Türkçe isim materialName2 alanında olabiliyor
          const rowMatRu = isAuthenticRussianText(rowMat2) ? rowMat2 : (isAuthenticRussianText(rowMat1) ? rowMat1 : '');
          const shortSpec = extractShortSpecNote(rowDesc);
          const origRaw = cleanRawMaterialName(it.originalName || it.materialName || '');
          const matRaw = cleanRawMaterialName(it.materialName || origRaw);
          const isGenericStockCard = /muhtelif|diğer|diger|sarf\s*malzemeler.*ozel/i.test(matRaw);

          const parenMatch = isGenericStockCard ? origRaw.match(/\(([^()]{4,})\)\s*$/) : null;
          const fallbackParenDesc = (parenMatch && !/saha\s*genel|excel\s*dosya|fatura\s*icin|it\s*siparis|villa\s*icin|mokr[ıi]y\s*facad|kenar\s*koruma|^https?:/i.test(parenMatch[1]))
            ? parenMatch[1].trim()
            : '';
          const effectiveRowDesc = pdfDesc || rowDesc || fallbackParenDesc;
          const hasMeaningfulRowDesc = !isShortNoteOrSpecFragment(effectiveRowDesc);
          const isFullRussianRowDesc = Boolean(pdfDesc) || (hasMeaningfulRowDesc && effectiveRowDesc.length >= 10 && isAuthenticRussianText(effectiveRowDesc));

          let russianOrig = '';
          if (isFullRussianRowDesc) {
            russianOrig = effectiveRowDesc;
          } else if (rowMatRu && !isShortNoteOrSpecFragment(rowMatRu)) {
            if (hasMeaningfulRowDesc && !effectiveRowDesc.toLowerCase().includes(rowMatRu.toLowerCase().slice(0, 6))) {
              russianOrig = `${rowMatRu} (${effectiveRowDesc})`;
            } else if (shortSpec && !rowMatRu.toLowerCase().includes(shortSpec.toLowerCase())) {
              russianOrig = `${rowMatRu} (${shortSpec.toUpperCase()})`;
            } else {
              russianOrig = rowMatRu;
            }
          } else if (!isShortNoteOrSpecFragment(origRaw) && origRaw.length >= 10 && !origRaw.includes('[') && !/^Строительно-монтажный материал/i.test(origRaw)) {
            russianOrig = origRaw;
          } else if (isGenericStockCard && hasMeaningfulRowDesc) {
            russianOrig = effectiveRowDesc;
          } else {
            russianOrig = ensureRussianOriginalName(matRaw || origRaw, !isShortNoteOrSpecFragment(origRaw) ? origRaw : '');
          }

          let effectiveTrSource = matRaw || origRaw;
          if (isFullRussianRowDesc) {
            effectiveTrSource = translateRussianMaterialToTurkish(effectiveRowDesc) || matRaw;
          } else if (rowMatRu) {
            const translatedRu = translateRussianMaterialToTurkish(russianOrig);
            effectiveTrSource = isGenericStockCard
              ? (translatedRu || `${matRaw} (${russianOrig})`)
              : (shortSpec ? `${matRaw} (${shortSpec.toUpperCase()})` : (translatedRu || matRaw));
          } else if (isGenericStockCard && hasMeaningfulRowDesc) {
            effectiveTrSource = translateRussianMaterialToTurkish(effectiveRowDesc) || `${matRaw} (${effectiveRowDesc})`;
          } else if (/[а-яА-ЯёЁ]/.test(matRaw)) {
            effectiveTrSource = translateRussianMaterialToTurkish(russianOrig || origRaw || matRaw);
          }

          const itemCat = normalizeCategoryName(
            it.category && it.category !== 'MALZEME' && !isGenericStockCard && !isFullRussianRowDesc ? it.category : '',
            `${russianOrig} ${effectiveTrSource}`
          );

          const rowQty = Number(it.quantity) || 1;
          const combinedItemText = `${effectiveTrSource} ${russianOrig}`.toLowerCase();
          const isMedicalExempt = /медицин|термометр|тонометр|носилки|жгут|бинт|аптечк|анализатор|кушетк|шины|шприц|параван|muayene/i.test(combinedItemText);
          const rawVatVal = matchedRow?.vatPercentage !== undefined && matchedRow?.vatPercentage !== null
            ? Number(matchedRow.vatPercentage)
            : (it.vatPercentage !== undefined && it.vatPercentage !== null ? Number(it.vatPercentage) : 22);

          let effectiveVatPct = 22;
          if (isIpMalyavin) {
            effectiveVatPct = 0;
          } else if (rawVatVal === 10) {
            effectiveVatPct = 10;
          } else if (rawVatVal === 0) {
            effectiveVatPct = (hasVat20Or22OnInvoice && !isMedicalExempt) ? (docYear === '2025' ? 20 : 22) : 0;
          } else {
            effectiveVatPct = docYear === '2025' ? 20 : 22;
          }

          let unitPriceNet = Number(it.unitPrice) || 0;
          let grossUnitPrice = Number(it.grossUnitPrice) || 0;

          if (it.isNetNormalized && it.unitPriceNet && it.grossUnitPrice && !isIpMalyavin) {
            unitPriceNet = Number(Number(it.unitPriceNet).toFixed(2));
            grossUnitPrice = Number(Number(it.grossUnitPrice).toFixed(2));
          } else if (isInvoiceAlreadyNet) {
            unitPriceNet = Number((Number(it.unitPrice) || 0).toFixed(2));
            grossUnitPrice = effectiveVatPct > 0
              ? Number((unitPriceNet * (1 + effectiveVatPct / 100)).toFixed(2))
              : unitPriceNet;
          } else {
            const rawGross = Number(it.grossUnitPrice || matchedRow?.price || it.unitPrice) || 0;
            grossUnitPrice = Number(rawGross.toFixed(2));
            unitPriceNet = effectiveVatPct > 0
              ? Number((rawGross / (1 + effectiveVatPct / 100)).toFixed(2))
              : grossUnitPrice;
          }

          const netTotalPrice = Number((unitPriceNet * rowQty).toFixed(2));
          const grossTotalPrice = Number((grossUnitPrice * rowQty).toFixed(2));

          return {
            ...it,
            materialName: effectiveTrSource || origRaw || 'Malzeme',
            originalName: russianOrig || origRaw || matRaw,
            category: itemCat,
            unitPrice: unitPriceNet,
            unitPriceNet,
            grossUnitPrice,
            totalPrice: netTotalPrice,
            grossTotalPrice,
            vatPercentage: effectiveVatPct,
            isNetNormalized: true
          };
        })
        .filter(it => {
          const m = `${it.materialName || ''} ${it.originalName || ''}`.toLowerCase();
          if (isReadyMixConcreteText(m)) return false;
          if (/шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|\bnakliye\b|teslimat\s*hizmet|kargo|услуги|лаборатор|оплата\s*гу\b|_факт_расходные\s*материалы|korpus.*reviziyon\s*projesi/i.test(m) && !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер/i.test(m)) {
            if (!inv.excludedFreightAmount) {
              trackedFreightHere = true;
              excludedFreightNetSum += Number(it.totalPrice) || 0;
              excludedFreightGrossSum += Number(it.grossTotalPrice) || Number(it.totalPrice) || 0;
            }
            return false;
          }
          return true;
        });

      const dominantCategory = mappedItems[0]?.category || normalizeCategoryName(inv.category, inv.description || '');

      return {
        ...inv,
        category: dominantCategory,
        prizmaUrl: fixedBtf,
        prizmaBtfUrl: fixedBtf,
        prizmaStfUrl: fixedStf,
        ...(trackedFreightHere || excludedFreightNetSum > 0 ? {
          excludedFreightAmount: Number(excludedFreightNetSum.toFixed(2)),
          excludedFreightGrossAmount: Number(excludedFreightGrossSum.toFixed(2))
        } : {}),
        items: mappedItems
      };
    }).filter(inv => inv.items && inv.items.length > 0);

    this.cleanListCache = cleanList;
    return cleanList;
  }

  private async fetchOrderMaterialRows(orderDemandId: number): Promise<any[]> {
    if (this.orderRowsCache.has(orderDemandId)) {
      return this.orderRowsCache.get(orderDemandId)!;
    }

    try {
      const detail = await (prizmaService as any).authorizedGet(`/api/order-demand/detail/${orderDemandId}`);
      const upId = detail?.userProcessId;
      const uspId = detail?.userSubProcessId || 0;
      if (!upId) return [];

      const ep = `/api/order-demand/material-row/list/${upId}/${uspId}/${orderDemandId}`;
      const res = await (prizmaService as any).authorizedGet(ep);
      const rows = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
      this.orderRowsCache.set(orderDemandId, rows);
      return rows;
    } catch (err: any) {
      return [];
    }
  }

  public async syncLast3Months(options: { maxItems?: number } = {}): Promise<{
    success: boolean;
    syncedCount: number;
    totalDemandsScanned: number;
    message: string;
    timestamp: string;
  }> {
    if (this.isSyncing) {
      return {
        success: false,
        syncedCount: this.memoryCache?.length || 0,
        totalDemandsScanned: 0,
        message: 'Senkronizasyon işlemi zaten arka planda çalışıyor.',
        timestamp: new Date().toISOString()
      };
    }

    this.isSyncing = true;
    this.lastError = null;

    try {
      this.syncProgress = { percent: 5, message: 'Prizma ERP bağlantısı kuruluyor ve son 3 ay talepleri sorgulanıyor...' };

      // 90 days ago
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const filter = JSON.stringify([
        ['documentDate', '>=', threeMonthsAgo],
        'or',
        ['createdOn', '>=', threeMonthsAgo]
      ]);

      const targetLimit = Math.min(options.maxItems || 1500, 6000);
      let allRawDemands: any[] = [];
      let skip = 0;

      while (allRawDemands.length < targetLimit) {
        const take = Math.min(200, targetLimit - allRawDemands.length);
        const url = `/api/payment-demand/list-filter?take=${take}&skip=${skip}&sort=` +
          encodeURIComponent(JSON.stringify([{ selector: 'id', desc: true }])) +
          '&filter=' + encodeURIComponent(filter);

        try {
          const pageRes = await (prizmaService as any).authorizedGet(url);
          const pageItems: any[] = pageRes.data || (Array.isArray(pageRes) ? pageRes : []);
          if (!pageItems.length) break;
          allRawDemands.push(...pageItems);
          skip += pageItems.length;

          const pVal = Math.min(40, Math.round(5 + (allRawDemands.length / targetLimit) * 35));
          this.syncProgress = { percent: pVal, message: `${allRawDemands.length} adet Prizma ödeme talebi indirildi...` };

          if (pageItems.length < take) break;
        } catch (pageErr: any) {
          console.warn(`[PRIZMA SYNC] Sayfa ${skip} çekilirken uyarı:`, pageErr.message);
          // Wait 1.5s and retry this page once
          try {
            await new Promise(r => setTimeout(r, 1500));
            const pageRes = await (prizmaService as any).authorizedGet(url);
            const pageItems: any[] = pageRes.data || (Array.isArray(pageRes) ? pageRes : []);
            if (!pageItems.length) break;
            allRawDemands.push(...pageItems);
            skip += pageItems.length;
            if (pageItems.length < take) break;
          } catch (retryErr: any) {
            console.error(`[PRIZMA SYNC] Sayfa ${skip} tekrarında hata, mevcut indirilenlerle devam ediliyor:`, retryErr.message);
            break;
          }
        }
      }

      // 1. Akıllı Fatura Filtreleme:
      // - Beton kesinlikle elenir ("ilave olarak betonlarida etmeyelim, sistem siser cunku betona gerek yok")
      // - Taşeron, Hizmet, İşçilik ve Nakliye kesinlikle elenir
      // - Sadece onaylanmış, ödeme bekleyen veya tamamlanmış faturalar kabul edilir (kullanıcı onayı bekleyenler elenir)
      // - Sadece STF'si (orderDemandId) olan gerçek sipariş faturaları kabul edilir
      const isDefinitiveMaterialInvoice = (d: any): boolean => {
        if (!d || d.canceled || d.deleted) return false;
        if (!d.documentNo && !(Number(d.invoiceAmount) > 0)) return false;

        // Yalnızca STF (Sipariş Takip Formu) olan onaylı malzeme alımları
        if (!d.orderDemandId) {
          return false;
        }

        // Taşeron ve Alt Sözleşme Eleme
        if (d.subContractId || d.subContractNo || d.progressPaymentId || d.progressPaymentCode) {
          return false;
        }

        const paymentType = (
          (d.paymentTypeNameTR || '') + ' ' +
          (d.paymentTypeNameRU || '') + ' ' +
          (d.paymentTypeNameEN || '')
        ).toLowerCase();

        const desc = (d.description || '').toLowerCase();
        const vendor = (d.accountingPlanName || '').toLowerCase();
        const costCenter = (d.costCenterNameTR || '').toLowerCase();
        const allText = `${paymentType} ${desc} ${vendor} ${costCenter}`;

        // 1. Beton Eleme: Hazır beton, grobeton, harç, şap ve beton santrali faturaları
        if (/beton|бетон|раствор|grobeton|гробетон|бсг|бст|керамзитобетон|бетолюкс|betolux|eurobeton|евробетон|мосбетон/i.test(allText)) {
          return false;
        }

        // 2. Taşeron / Hakediş / Subcontractor Eleme
        if (/taseron|tasaron|субподряд|subcontract|hakedis|hakediş|акт\s*выполнен/i.test(allText)) {
          return false;
        }

        // 3. Hizmet / İşçilik / Nakliye / Vinç / Kira / Güvenlik / Yemek Eleme
        if (/hizmet|услуг|service|iscilik|işçilik|labor|шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|nakliye|лоджистик|питани|yemek|проживани|otel|охран|guvenlik|клининг|уборк|виза|vize|перевод|tercüme|нотариус|noter|страхов|sigorta|аванс|avans\s*talep/i.test(allText)) {
          return false;
        }

        // 4. Durum Kontrolü (Yalnızca Kesinleşmiş / Onaylanmış Faturalar):
        if (d.lastTransactionType === 'rejected' || d.lastTransactionType === 'inprocess' || d.lastTransactionType === 'new') {
          return false;
        }

        const isCompleted = d.completed === true || (Number(d.paidAmount) > 0 && Number(d.paidAmount) >= Number(d.invoiceAmount));
        const isPaid = Number(d.paidAmount) > 0;
        const isApproved = d.lastTransactionType === 'approved';
        const isStep2OrHigher = typeof d.step === 'number' && d.step >= 2;

        // Daha onay aşamasındaki (kullanıcıda bekleyen / step 0 veya 1) faturalar elenir
        return isCompleted || isPaid || isApproved || isStep2OrHigher;
      };

      const getPrizmaStatusText = (d: any): string => {
        if (d.completed === true || (Number(d.paidAmount) > 0 && Number(d.paidAmount) >= Number(d.invoiceAmount))) {
          return 'Tamamlandı (Ödendi)';
        }
        if (Number(d.paidAmount) > 0) {
          return 'Kısmi Ödendi';
        }
        if (typeof d.step === 'number' && d.step >= 3) {
          return 'Ödeme Bekliyor';
        }
        if (typeof d.step === 'number' && d.step === 2) {
          return "1C'ye Eklendi / Onaylandı";
        }
        if (d.lastTransactionType === 'approved') {
          return 'Onaylandı';
        }
        if (d.userProcessPositionNameTR && d.userProcessPositionNameTR !== 'İşlemde') {
          return `${d.userProcessPositionNameTR} (Onayda)`;
        }
        return 'Ödeme Bekliyor';
      };

      // Anti-Hortlama Koruması: Önceden silinmiş Prizma faturalarının kaydını tut
      const previouslyDeletedIds = new Set<string>();
      (this.memoryCache || []).forEach(oldInv => {
        if (oldInv && oldInv.isDeleted) {
          previouslyDeletedIds.add(oldInv.id);
        }
      });

      // GES Arşiv / Portal Önceliği: Satınalma personeli ve şeflerinin daha önce portala yüklediği faturaları tespit et
      const existingPortalByVendorAndNo = new Set<string>();
      const existingPortalByDemandId = new Set<number>();
      try {
        if (this.dbInstance) {
          const invSnap = await getDocs(collection(this.dbInstance, 'invoices'));
          invSnap.docs.forEach(docSnap => {
            const data = docSnap.data() as any;
            const docId = String(docSnap.id || '');
            const isPrizma = Boolean(docId.startsWith('inv_prizma_') || docId.startsWith('prizma_') || (data.prizmaSource && !docId.startsWith('inv_cmp_') && !docId.startsWith('inv_sync_')));
            if (!data.isDeleted && !isPrizma) {
              const cleanNo = String(data.invoiceNumber || data.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
              const cleanVen = normalizeVendorName(data.supplier || data.vendorName || '');
              if (cleanNo && cleanVen) {
                existingPortalByVendorAndNo.add(`${cleanVen}___${cleanNo}`);
              }
              if (data.prizmaDemandId) {
                existingPortalByDemandId.add(Number(data.prizmaDemandId));
              }
            }
          });
        }
      } catch (err: any) {
        console.warn('[PRIZMA SYNC] Portal faturaları okunurken uyarı:', err.message);
      }

      const invoiceDemands = allRawDemands.filter(d => isDefinitiveMaterialInvoice(d));

      this.syncProgress = { 
        percent: 45, 
        message: `${invoiceDemands.length} adet kesinleşmiş malzeme faturası tespit edildi (Taşeron/Hizmet elendi). Sipariş satırları taranıyor...` 
      };

      // Pre-fetch uncached order material rows in controlled concurrent batches of 5 to avoid socket saturation
      const uniqueOrderIds = Array.from(new Set(invoiceDemands.map(d => d.orderDemandId).filter(Boolean)));
      const uncachedOrderIds = uniqueOrderIds.filter(id => !this.orderRowsCache.has(id));
      
      for (let i = 0; i < uncachedOrderIds.length; i += 5) {
        const chunk = uncachedOrderIds.slice(i, i + 5);
        await Promise.all(chunk.map(id => this.fetchOrderMaterialRows(id).catch(() => [])));
        const orderPVal = Math.min(80, Math.round(45 + ((i + chunk.length) / Math.max(1, uncachedOrderIds.length)) * 35));
        this.syncProgress = { 
          percent: orderPVal, 
          message: `Sipariş kalemleri analiz ediliyor (${Math.min(i + chunk.length, uncachedOrderIds.length)}/${uncachedOrderIds.length})...` 
        };
        await new Promise(r => setTimeout(r, 50));
      }
      this.saveOrderRowsToDisk();

      // Pre-fetch file lists for demands to select exact 'Счет на оплату' (doctype 2) invoice files in batches of 5
      const demandFileMap = new Map<number, number>();
      this.syncProgress = { percent: 85, message: 'Prizma fatura belgeleri (Счет на оплату) doğrulanıyor...' };

      const fileBatchSize = 5;
      for (let i = 0; i < invoiceDemands.length; i += fileBatchSize) {
        const chunk = invoiceDemands.slice(i, i + fileBatchSize);
        await Promise.all(chunk.map(async (d) => {
          try {
            const files = await (prizmaService as any).authorizedGet(`/api/process/list-files/BTF/${d.id}`);
            if (Array.isArray(files) && files.length > 0) {
              const invFile = files.find((f: any) => 
                Number(f.doctype) === 2 || 
                /счет/i.test(f.docTypeNameRU || '') || 
                /счет/i.test(f.docTypeNameTR || '') || 
                /proforma/i.test(f.docTypeNameEN || '') ||
                /schet/i.test(f.fileName || '')
              );
              if (invFile) {
                demandFileMap.set(d.id, invFile.id);
              } else {
                const nonUpd = files.find((f: any) => Number(f.doctype) !== 7 && !/упд/i.test(f.docTypeNameRU || ''));
                if (nonUpd) demandFileMap.set(d.id, nonUpd.id);
              }
            }
          } catch (_) {}
        }));
        await new Promise(r => setTimeout(r, 50));
      }

      this.syncProgress = { percent: 90, message: 'Malzeme birim fiyatları ve faturalar birleştiriliyor...' };

      const syncedInvoices: PrizmaInvoiceRecord[] = [];

      for (const d of invoiceDemands) {
        const dCleanNo = String(d.documentNo || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
        const dCleanVendor = normalizeVendorName(d.accountingPlanName || '');
        const dDemandId = Number(d.id);

        // Satınalma personeli daha önce yüklediyse Prizma'dan mükerrer çekilmesini engelle (Portal Önceliği)
        if (
          existingPortalByDemandId.has(dDemandId) ||
          (dCleanNo && dCleanVendor && existingPortalByVendorAndNo.has(`${dCleanVendor}___${dCleanNo}`))
        ) {
          console.log(`[PRIZMA SYNC SKIP] Fatura No: ${d.documentNo}, Tedarikçi: ${d.accountingPlanName} (BTF #${d.id}) zaten satınalma personeli tarafından portal arşivine yüklendiği için Prizma kopyası engellendi.`);
          continue;
        }

        let items: PrizmaInvoiceRecord['items'] = [];
        let excludedFreightNetSum = 0;
        let excludedFreightGrossSum = 0;

        // If it has orderDemandId, fetch material rows
        if (d.orderDemandId) {
          const rows = await this.fetchOrderMaterialRows(d.orderDemandId);
          if (rows && rows.length > 0) {
            for (let idx = 0; idx < rows.length; idx++) {
              const r = rows[idx];
              const rawName = r.materialName || d.description || '';
              const rawMat1 = cleanRawMaterialName(r.materialName || '');
              const rawMat2 = cleanRawMaterialName(r.materialName2 || '');
              const rawRu = isAuthenticRussianText(rawMat2) ? rawMat2 : (isAuthenticRussianText(rawMat1) ? rawMat1 : '');
              const rawDesc = cleanRawMaterialName(r.description || '');
              const shortSpec = extractShortSpecNote(rawDesc);
              const cleaned = cleanRawMaterialName(rawName);
              const combinedRowText = `${cleaned} ${rawDesc} ${rawMat1} ${rawMat2}`;

              // Beton kalemlerini filtrele (Yalnızca hazır beton / grobeton)
              if (isReadyMixConcreteText(combinedRowText)) {
                continue;
              }
              // Nakliye, lojistik, kesim, yükleme/boşaltma ve hizmet kalemlerini sıfır toleransla ayrıştır
              const isFreightOrServiceRow =
                (/шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставк|организация\s*доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|логистик|погруз|разгруз|услуг[аи]\s+по|nakliye|teslimat\s*hizmet|kargo/i.test(combinedRowText) &&
                 !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел|швеллер|угол|труба|арматур|лист|балка|сетка|кабель|провод|доска|брус|фанер/i.test(combinedRowText));
              if (isFreightOrServiceRow) {
                const fQty = Number(r.quantity) || 1;
                const fGross = Number(r.totalWithVat) || Number(r.amount) || (Number(r.price || 0) * fQty);
                const fVat = r.vatPercentage !== undefined && r.vatPercentage !== null ? Number(r.vatPercentage) : 22;
                const fNet = fVat > 0 ? fGross / (1 + fVat / 100) : fGross;
                excludedFreightNetSum += fNet;
                excludedFreightGrossSum += fGross;
                continue;
              }

              const isGenericCard = /muhtelif|diğer|diger|sarf\s*malzemeler.*ozel/i.test(cleaned);
              const pdfDesc = r.pdfExtractedName ? cleanRawMaterialName(r.pdfExtractedName) : '';
              const effectiveDesc = pdfDesc || rawDesc;
              const hasUsefulDesc = !isShortNoteOrSpecFragment(effectiveDesc);
              const isFullRuDesc = Boolean(pdfDesc) || (hasUsefulDesc && effectiveDesc.length >= 10 && isAuthenticRussianText(effectiveDesc));

              let russianOrig = '';
              if (isFullRuDesc) {
                russianOrig = effectiveDesc;
              } else if (rawRu && !isShortNoteOrSpecFragment(rawRu)) {
                if (hasUsefulDesc && !effectiveDesc.toLowerCase().includes(rawRu.toLowerCase().slice(0, 6))) {
                  russianOrig = `${rawRu} (${effectiveDesc})`;
                } else if (shortSpec && !rawRu.toLowerCase().includes(shortSpec.toLowerCase())) {
                  russianOrig = `${rawRu} (${shortSpec.toUpperCase()})`;
                } else {
                  russianOrig = rawRu;
                }
              } else if (isGenericCard && hasUsefulDesc) {
                russianOrig = effectiveDesc;
              } else if (!isShortNoteOrSpecFragment(cleaned) && cleaned.length >= 10) {
                russianOrig = cleaned;
              } else if (hasUsefulDesc && effectiveDesc.length >= 15) {
                russianOrig = effectiveDesc;
              } else {
                russianOrig = ensureRussianOriginalName(cleaned, !isShortNoteOrSpecFragment(effectiveDesc) ? effectiveDesc : '');
              }

              const translatedTr = isFullRuDesc
                ? (translateRussianMaterialToTurkish(effectiveDesc) || cleaned)
                : rawRu
                  ? (isGenericCard ? (translateRussianMaterialToTurkish(russianOrig) || `${cleaned} (${russianOrig})`) : (shortSpec ? `${cleaned} (${shortSpec.toUpperCase()})` : (translateRussianMaterialToTurkish(russianOrig) || cleaned)))
                  : (isGenericCard && hasUsefulDesc)
                    ? (translateRussianMaterialToTurkish(effectiveDesc) || `${cleaned} (${effectiveDesc})`)
                    : translateRussianMaterialToTurkish(cleaned || effectiveDesc || rawName);

              const itemCategory = normalizeCategoryName('', `${russianOrig} ${cleaned} ${translatedTr}`);
              const rowQty = Number(r.quantity) || 1;
              const rawPrice = Number(r.price) || 0;
              const rawVatPct = r.vatPercentage !== undefined && r.vatPercentage !== null ? Number(r.vatPercentage) : 22;
              const docYear = String(d.documentDate || d.createdOn || '').slice(0, 4);
              const effectiveVatPct = rawVatPct === 0 ? 0 : (docYear === '2025' ? 20 : 22);
              const grossUnitPrice = Number(rawPrice.toFixed(2));
              const unitPriceNet = effectiveVatPct > 0
                ? Number((rawPrice / (1 + effectiveVatPct / 100)).toFixed(2))
                : grossUnitPrice;
              const netTotalPrice = Number((unitPriceNet * rowQty).toFixed(2));
              const grossTotalPrice = Number(r.totalWithVat) || Number(r.amount) || Number((grossUnitPrice * rowQty).toFixed(2));

              items.push({
                id: `prizma_row_${r.id || idx + 1}`,
                materialName: translatedTr || cleaned || 'Prizma Malzemesi',
                originalName: russianOrig || cleaned || rawName || 'Prizma Malzemesi',
                materialCode: r.materialCode || undefined,
                quantity: rowQty,
                unit: r.unitNameTR || r.unitNameRU || 'Adet',
                unitPrice: unitPriceNet,
                unitPriceNet,
                grossUnitPrice,
                totalPrice: netTotalPrice,
                grossTotalPrice: Number(grossTotalPrice.toFixed(2)),
                vatPercentage: effectiveVatPct,
                isNetNormalized: true,
                activityName: r.activityName || undefined,
                category: itemCategory
              });
            }
          }
        }

        // Filtreleme sonrası satır kalmadıysa bu faturayı malzeme kıyaslamasına alma
        if (items.length === 0) {
          continue;
        }

        const cleanSupplier = normalizeVendorName(d.accountingPlanName || 'Prizma Tedarikçi');
        const docDate = d.documentDate
          ? String(d.documentDate).split('T')[0]
          : (d.createdOn ? String(d.createdOn).split('T')[0] : new Date().toISOString().split('T')[0]);

        // Prizma direct detail routes for user berkant.senturk
        // Using detail/-1 triggers Prizma's automatic subprocess resolution to prevent 404s
        const btfUrl = `https://pm.gescons.ru/process/payment-demand/2100/detail/-1/${d.id}`;
        const stfUrl = d.orderDemandId ? `https://pm.gescons.ru/process/order-demand/1725/detail/-1/${d.orderDemandId}` : undefined;
        const selectedInvoiceFileId = demandFileMap.get(d.id) || d.invoiceFileId || undefined;

        const record: PrizmaInvoiceRecord = {
          id: `prizma_${d.id}`,
          invoiceNumber: d.documentNo || d.requestCode,
          date: docDate,
          supplier: cleanSupplier,
          vendorName: cleanSupplier,
          supplierInn: d.accountingPlanInn || undefined,
          totalAmount: Number(d.invoiceAmount) || 0,
          excludedFreightAmount: excludedFreightNetSum > 0 ? Number(excludedFreightNetSum.toFixed(2)) : undefined,
          excludedFreightGrossAmount: excludedFreightGrossSum > 0 ? Number(excludedFreightGrossSum.toFixed(2)) : undefined,
          currency: d.currencySign || '₽',
          jobsiteName: d.workPlaceNameTR || d.workPlaceNameRU || 'Genel Şantiye',
          category: items[0]?.category || normalizeCategoryName(d.paymentTypeNameTR, d.description || ''),
          description: d.description || undefined,
          prizmaDemandId: d.id,
          prizmaRequestCode: d.requestCode,
          prizmaOrderCode: d.orderCode || undefined,
          prizmaOrderDemandId: d.orderDemandId || undefined,
          prizmaUserProcessId: 2100,
          prizmaStatus: getPrizmaStatusText(d),
          prizmaCreatedBy: d.createdByFullName || d.createdBy || undefined,
          prizmaUrl: btfUrl,
          prizmaBtfUrl: btfUrl,
          prizmaStfUrl: stfUrl,
          invoiceFileId: selectedInvoiceFileId,
          items,
          isDeleted: previouslyDeletedIds.has(`prizma_${d.id}`),
          prizmaSource: true,
          syncedAt: new Date().toISOString()
        };

        syncedInvoices.push(record);
      }

      // STF sipariş satırları faturanın kendisi değildir: her faturanın kalemlerini "Счет на оплату"
      // belgesinden doğrula. Belge okunamazsa STF satırları kalır ama fatura "doğrulanmadı" işaretlenir.
      const previousById = new Map<string, PrizmaInvoiceRecord>();
      (await this.loadPreviousRecords()).forEach(r => previousById.set(r.id, r));
      let verifiedFromDocument = 0;
      for (let i = 0; i < syncedInvoices.length; i += 4) {
        const chunk = syncedInvoices.slice(i, i + 4);
        await Promise.all(chunk.map(async rec => {
          const resolved = await this.resolveInvoiceLines({
            demandId: rec.prizmaDemandId,
            fileId: rec.invoiceFileId,
            invoiceTotal: Number(rec.totalAmount) || 0,
            docYear: String(rec.date || '').slice(0, 4),
            stfItems: rec.items,
            stfFreightNet: Number(rec.excludedFreightAmount) || 0,
            stfFreightGross: Number(rec.excludedFreightGrossAmount) || 0,
            previous: previousById.get(rec.id)
          });
          rec.items = resolved.items;
          rec.linesSource = resolved.linesSource;
          rec.lineCheck = resolved.lineCheck;
          rec.excludedFreightAmount = resolved.freightNet > 0 ? Number(resolved.freightNet.toFixed(2)) : 0;
          rec.excludedFreightGrossAmount = resolved.freightGross > 0 ? Number(resolved.freightGross.toFixed(2)) : 0;
          if (resolved.linesSource === 'invoice_pdf') verifiedFromDocument++;
        }));
        this.syncProgress = {
          percent: Math.min(94, 90 + Math.round(((i + chunk.length) / Math.max(1, syncedInvoices.length)) * 4)),
          message: `Fatura belgeleri okunuyor (${Math.min(i + chunk.length, syncedInvoices.length)}/${syncedInvoices.length}), ${verifiedFromDocument} fatura belgeden doğrulandı...`
        };
      }
      this.saveDocLinesToDisk();

      this.syncProgress = { percent: 95, message: 'Veriler güvenle kaydediliyor...' };

      // Persist to memory & disk
      this.memoryCache = syncedInvoices;
      this.cleanListCache = null;
      this.cacheTimestamp = Date.now();
      this.lastSyncAt = new Date().toISOString();
      this.saveToDisk(syncedInvoices);

      // Persist to Firestore collection `prizma_invoices` in batches
      if (this.dbInstance) {
        try {
          const cleanFirestoreDoc = (obj: any): any => {
            if (obj === undefined) return null;
            if (obj === null || typeof obj !== 'object') return obj;
            if (Array.isArray(obj)) return obj.map(cleanFirestoreDoc);
            return Object.fromEntries(
              Object.entries(obj)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, cleanFirestoreDoc(v)])
            );
          };

          const batchSize = 100;
          for (let i = 0; i < syncedInvoices.length; i += batchSize) {
            const batch = writeBatch(this.dbInstance);
            const chunk = syncedInvoices.slice(i, i + batchSize);
            for (const inv of chunk) {
              const docRef = doc(this.dbInstance, 'prizma_invoices', inv.id);
              batch.set(docRef, cleanFirestoreDoc(inv), { merge: true });
            }
            await batch.commit();
          }
        } catch (dbErr: any) {
          console.warn('[PRIZMA SYNC] Firestore batch save warn:', dbErr.message);
        }
      }

      this.syncProgress = { percent: 100, message: 'Senkronizasyon tamamlandı!' };

      return {
        success: true,
        syncedCount: syncedInvoices.length,
        totalDemandsScanned: invoiceDemands.length,
        message: `Prizma'dan son 3 aya ait ${syncedInvoices.length} adet fatura ve malzeme kalemleri başarıyla aktarıldı.`,
        timestamp: this.lastSyncAt
      };
    } catch (err: any) {
      this.lastError = err.message;
      this.syncProgress = { percent: 0, message: `Hata: ${err.message}` };
      console.error('[PRIZMA SYNC ERROR]:', err);
      return {
        success: false,
        syncedCount: this.memoryCache?.length || 0,
        totalDemandsScanned: 0,
        message: `Senkronizasyon hatası: ${err.message}`,
        timestamp: new Date().toISOString()
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /** Senkron öncesi kayıtlar (önceki doğrulanmış fatura kalemlerini korumak için) */
  private async loadPreviousRecords(): Promise<PrizmaInvoiceRecord[]> {
    if (this.memoryCache && this.memoryCache.length > 0) return this.memoryCache;
    if (this.dbInstance) {
      try {
        const snap = await getDocs(collection(this.dbInstance, 'prizma_invoices'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as PrizmaInvoiceRecord));
      } catch (_) {}
    }
    return [];
  }

  /**
   * Daha önce senkronlanmış (90 günden eski olanlar dahil) Prizma faturalarının kalemlerini fatura
   * belgesiyle doğrular. apply=false iken hiçbir şey yazmaz, yalnızca rapor döner.
   * apply=true iken değişen her kaydın önceki hali `invoice_line_backups` koleksiyonuna yedeklenir.
   */
  public async reconcileStoredInvoiceLines(options: { apply?: boolean; limit?: number; recheck?: boolean } = {}): Promise<{
    scanned: number;
    verifiedFromDocument: number;
    stfMatchesTotal: number;
    mismatch: number;
    errors: number;
    changedIds: string[];
    backups: number;
    samples: Array<{ id: string; invoiceNumber: string; supplier: string; status: string; diff: number; note?: string }>;
  }> {
    // Yalnızca uygulamada kullanılan (onaylı, STF'li malzeme) faturalar; beton/hizmet vb. elenenler indirilmez
    const all = (await this.loadPreviousRecords()).filter(r => r && !r.isDeleted && r.prizmaDemandId && isCleanMaterialRecord(r));
    const todo = all
      // lineCheck'i olmayan veya "belgeden doğrulandı" deyip kalemleri başka bir yazımla (eski sürüm senkronu) ezilmiş kayıtlar
      .filter(r => options.recheck || !r.lineCheck || (r.linesSource === 'invoice_pdf' && !hasDocumentLines(r)))
      .slice(0, options.limit && options.limit > 0 ? options.limit : undefined);

    const report = { scanned: todo.length, verifiedFromDocument: 0, stfMatchesTotal: 0, mismatch: 0, errors: 0, changedIds: [] as string[], backups: 0, samples: [] as any[] };
    const updated: PrizmaInvoiceRecord[] = [];

    for (let i = 0; i < todo.length; i += 4) {
      const chunk = todo.slice(i, i + 4);
      await Promise.all(chunk.map(async rec => {
        const stfItems = (rec.items || []).filter((it: any) => it?.lineSource !== 'invoice_pdf');
        const resolved = await this.resolveInvoiceLines({
          demandId: rec.prizmaDemandId,
          fileId: rec.invoiceFileId,
          invoiceTotal: Number(rec.totalAmount) || 0,
          docYear: String(rec.date || '').slice(0, 4),
          stfItems: stfItems.length ? stfItems : (rec.items || []),
          stfFreightNet: Number(rec.excludedFreightAmount) || 0,
          stfFreightGross: Number(rec.excludedFreightGrossAmount) || 0,
          previous: options.recheck ? null : rec
        });
        if (resolved.linesSource !== 'invoice_pdf' && /^Belge okunamadı:/.test(resolved.lineCheck.documentNote || '')) {
          // Prizma'ya ulaşılamadı: sonuç kalıcı sayılmaz, kayıt değiştirilmez (bir sonraki çalıştırmada yeniden denenir)
          report.errors++;
          return;
        }
        if (resolved.lineCheck.status === 'verified') report.verifiedFromDocument++;
        else if (resolved.lineCheck.status === 'stf_matches_total') report.stfMatchesTotal++;
        else report.mismatch++;
        if (report.samples.length < 400 && resolved.lineCheck.status !== 'stf_matches_total') {
          report.samples.push({
            id: rec.id, invoiceNumber: rec.invoiceNumber, supplier: rec.supplier,
            status: resolved.lineCheck.status, diff: resolved.lineCheck.diff, note: resolved.lineCheck.documentNote
          });
        }
        updated.push({
          ...rec,
          items: resolved.items as any,
          linesSource: resolved.linesSource,
          lineCheck: resolved.lineCheck,
          excludedFreightAmount: resolved.freightNet > 0 ? Number(resolved.freightNet.toFixed(2)) : 0,
          excludedFreightGrossAmount: resolved.freightGross > 0 ? Number(resolved.freightGross.toFixed(2)) : 0
        });
      }));
      this.syncProgress = { percent: Math.round(((i + chunk.length) / Math.max(1, todo.length)) * 100), message: `Fatura belgeleri doğrulanıyor (${Math.min(i + chunk.length, todo.length)}/${todo.length})...` };
    }
    this.saveDocLinesToDisk();
    report.changedIds = updated.map(u => u.id);

    if (options.apply && this.dbInstance && updated.length > 0) {
      const cleanDoc = (obj: any): any => {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(cleanDoc);
        return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, cleanDoc(v)]));
      };
      const originals = new Map(all.map(r => [r.id, r]));
      const stamp = new Date().toISOString();
      for (let i = 0; i < updated.length; i += 50) {
        const batch = writeBatch(this.dbInstance);
        for (const rec of updated.slice(i, i + 50)) {
          const original = originals.get(rec.id);
          if (original) {
            batch.set(doc(this.dbInstance, 'invoice_line_backups', `${rec.id}__${stamp.replace(/[:.]/g, '-')}`), cleanDoc({
              collection: 'prizma_invoices', docId: rec.id, backedUpAt: stamp, reason: 'invoice_line_reconcile', data: original
            }));
            report.backups++;
          }
          batch.set(doc(this.dbInstance, 'prizma_invoices', rec.id), cleanDoc({
            items: rec.items,
            linesSource: rec.linesSource,
            lineCheck: rec.lineCheck,
            excludedFreightAmount: rec.excludedFreightAmount,
            excludedFreightGrossAmount: rec.excludedFreightGrossAmount
          }), { merge: true });
        }
        await batch.commit();
      }
      const byId = new Map(updated.map(u => [u.id, u]));
      if (this.memoryCache) this.memoryCache = this.memoryCache.map(r => byId.get(r.id) || r);
      this.cleanListCache = null;
      this.cacheTimestamp = 0;
      if (this.memoryCache) this.saveToDisk(this.memoryCache);
    }
    return report;
  }

  public getSyncStatus() {
    const cache = this.memoryCache || [];
    const totalAmount = cache.reduce((acc, cur) => acc + (cur.totalAmount || 0), 0);
    const uniqueSuppliers = new Set(cache.map(c => c.supplier).filter(Boolean)).size;
    const uniqueJobsites = new Set(cache.map(c => c.jobsiteName).filter(Boolean)).size;
    const totalItems = cache.reduce((acc, cur) => acc + (cur.items?.length || 0), 0);

    return {
      isSyncing: this.isSyncing,
      progressPercent: this.syncProgress.percent,
      progressMessage: this.syncProgress.message,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      totalSynced: cache.length,
      totalAmount,
      uniqueSuppliers,
      uniqueJobsites,
      totalItems,
      dateRange: 'Son 3 Ay (90 Gün)',
      autoSchedule: 'Her Akşam 21:00 & Gece 02:30 (TSİ / Moskova)',
      sampleItems: cache.slice(0, 5)
    };
  }
}

export const prizmaSyncService = new PrizmaSyncService();
