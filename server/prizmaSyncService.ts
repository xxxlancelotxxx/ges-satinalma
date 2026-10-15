import path from 'path';
import fs from 'fs';
import os from 'os';
import { prizmaService } from './prizmaService';
import { normalizeVendorName } from '../src/utils/vendorNormalizer';
import { normalizeCategoryName, translateRussianMaterialToTurkish, ensureRussianOriginalName } from '../src/utils/categoryClassifier';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

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
  items: Array<{
    id: string;
    materialName: string;
    originalName?: string;
    materialCode?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    vatPercentage?: number;
    activityName?: string;
    category?: string;
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

const isShortNoteOrSpecFragment = (s: string): boolean => {
  const t = (s || '').trim();
  if (!t || t.length < 4) return true;
  if (/^(?:\d+(?:[.,]\d+)?\s*(?:шт|м|мм|см|кг|г|л|мл|уп|упак|кор|рул|пл|мпа|м2|м3)\.?|\d+\s*[xх*×]\s*\d+.*)$/i.test(t)) return true;
  if (/^(?:кж\s*[\d.,-]|к\d\b|корпус|стилобат|блок|вжк|офис|склад|этаж|секция|ось|оси|отм\.|схем|арт\.?\s*\d|спайка|осина|гсп(?:-df)?|тип\s*\d|вид\s*\d|сорт\s*\d|мешок|однодверный|съемный|стандартный|etap|blok|kat)\b/i.test(t)) return true;
  if (!/[а-яА-ЯёЁ]{4,}/.test(t)) return true;
  return false;
};

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
  private cacheTimestamp: number = 0;
  private isSyncing: boolean = false;
  private syncProgress: { percent: number; message: string } = { percent: 0, message: '' };
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private orderRowsCache = new Map<number, any[]>();

  constructor() {
    this.loadInitialFromDisk();
    this.loadOrderRowsFromDisk();
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

  public async getInvoicesCached(): Promise<PrizmaInvoiceRecord[]> {
    const now = Date.now();
    let rawList: PrizmaInvoiceRecord[] = [];

    if (this.memoryCache && (now - this.cacheTimestamp < 300000)) { // 5 mins cache
      rawList = this.memoryCache;
    } else if (this.dbInstance) {
      try {
        const snap = await getDocs(collection(this.dbInstance, 'prizma_invoices'));
        if (snap.size > 0) {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as PrizmaInvoiceRecord));
          list.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
          this.memoryCache = list;
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
      const mappedItems = (inv.items || [])
        .map((it, idx) => {
          const matchedRow = Array.isArray(cachedOrderRows)
            ? (cachedOrderRows.find((r: any) => `prizma_row_${r.id}` === it.id) || cachedOrderRows[idx])
            : undefined;
          const pdfDesc = matchedRow?.pdfExtractedName ? cleanRawMaterialName(matchedRow.pdfExtractedName) : '';
          const rowDesc = matchedRow?.description ? cleanRawMaterialName(matchedRow.description) : '';
          const rowMatRu = matchedRow?.materialName2 ? cleanRawMaterialName(matchedRow.materialName2) : '';
          const origRaw = cleanRawMaterialName(it.originalName || it.materialName || '');
          const matRaw = cleanRawMaterialName(it.materialName || origRaw);
          const isGenericStockCard = /muhtelif|diğer|diger|sarf\s*malzemeler.*ozel/i.test(matRaw);

          const parenMatch = isGenericStockCard ? origRaw.match(/\(([^()]{4,})\)\s*$/) : null;
          const fallbackParenDesc = (parenMatch && !/saha\s*genel|excel\s*dosya|fatura\s*icin|it\s*siparis|villa\s*icin|mokr[ıi]y\s*facad|kenar\s*koruma|^https?:/i.test(parenMatch[1]))
            ? parenMatch[1].trim()
            : '';
          const effectiveRowDesc = pdfDesc || rowDesc || fallbackParenDesc;
          const hasMeaningfulRowDesc = !isShortNoteOrSpecFragment(effectiveRowDesc);
          const isFullRussianRowDesc = Boolean(pdfDesc) || (hasMeaningfulRowDesc && effectiveRowDesc.length >= 12 && /[а-яА-ЯёЁ]{4,}/.test(effectiveRowDesc));

          let russianOrig = '';
          if (isFullRussianRowDesc) {
            russianOrig = effectiveRowDesc;
          } else if (!isShortNoteOrSpecFragment(origRaw) && origRaw.length >= 12 && !origRaw.includes('[') && !/^Строительно-монтажный материал/i.test(origRaw)) {
            russianOrig = origRaw;
          } else if (rowMatRu && !isShortNoteOrSpecFragment(rowMatRu)) {
            russianOrig = hasMeaningfulRowDesc && !effectiveRowDesc.toLowerCase().includes(rowMatRu.toLowerCase().slice(0, 6))
              ? `${rowMatRu} (${effectiveRowDesc})`
              : rowMatRu;
          } else if (isGenericStockCard && hasMeaningfulRowDesc) {
            russianOrig = effectiveRowDesc;
          } else if (!isShortNoteOrSpecFragment(origRaw) && origRaw.length >= 10) {
            russianOrig = origRaw;
          } else if (hasMeaningfulRowDesc && effectiveRowDesc.length >= 15) {
            russianOrig = effectiveRowDesc;
          } else {
            russianOrig = ensureRussianOriginalName(matRaw || origRaw, !isShortNoteOrSpecFragment(origRaw) ? origRaw : '');
          }

          let effectiveTrSource = matRaw || origRaw;
          if (isFullRussianRowDesc) {
            effectiveTrSource = translateRussianMaterialToTurkish(effectiveRowDesc) || matRaw;
          } else if (isGenericStockCard && hasMeaningfulRowDesc) {
            effectiveTrSource = translateRussianMaterialToTurkish(effectiveRowDesc) || `${matRaw} (${effectiveRowDesc})`;
          } else if (/[а-яА-ЯёЁ]/.test(matRaw)) {
            effectiveTrSource = translateRussianMaterialToTurkish(origRaw || matRaw);
          }

          const itemCat = normalizeCategoryName(
            it.category && it.category !== 'MALZEME' && !isGenericStockCard && !isFullRussianRowDesc ? it.category : '',
            `${russianOrig} ${effectiveTrSource}`
          );
          return {
            ...it,
            materialName: effectiveTrSource || origRaw || 'Malzeme',
            originalName: russianOrig || origRaw || matRaw,
            category: itemCat
          };
        })
        .filter(it => {
          const m = `${it.materialName || ''} ${it.originalName || ''}`.toLowerCase();
          if (isReadyMixConcreteText(m)) return false;
          if (/шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|\bnakliye\b|услуги|лаборатор|оплата\s*гу\b|_факт_расходные\s*материалы|korpus.*reviziyon\s*projesi/i.test(m) && !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел/i.test(m)) return false;
          return true;
        });

      const dominantCategory = mappedItems[0]?.category || normalizeCategoryName(inv.category, inv.description || '');

      return {
        ...inv,
        category: dominantCategory,
        prizmaUrl: fixedBtf,
        prizmaBtfUrl: fixedBtf,
        prizmaStfUrl: fixedStf,
        items: mappedItems
      };
    }).filter(inv => inv.items && inv.items.length > 0);

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
        let items: PrizmaInvoiceRecord['items'] = [];

        // If it has orderDemandId, fetch material rows
        if (d.orderDemandId) {
          const rows = await this.fetchOrderMaterialRows(d.orderDemandId);
          if (rows && rows.length > 0) {
            for (let idx = 0; idx < rows.length; idx++) {
              const r = rows[idx];
              const rawName = r.materialName || d.description || '';
              const rawRu = cleanRawMaterialName(r.materialName2 || '');
              const rawDesc = cleanRawMaterialName(r.description || '');
              const cleaned = cleanRawMaterialName(rawName);

              // Beton kalemlerini filtrele (Yalnızca hazır beton / grobeton)
              if (isReadyMixConcreteText(`${cleaned} ${rawDesc}`)) {
                continue;
              }
              // Hizmet ve işçilik kalemlerini filtrele (Taşlama makinesi, disk ve montaj malzemeleri hariç)
              if (/шлифователь|шлифовка|аренда|kiralama|монтаж|демонтаж|ремонт|доставка|перевозк|nakliye/i.test(`${cleaned} ${rawDesc}`) && !/шлифмашин|диск|круг|лента|шкурка|ремонтн.*состав|монтажн.*пен|монтажн.*пистолет|монтажн.*коробк|монтажн.*лент|монтажн.*клин|монтажн.*дюбел/i.test(`${cleaned} ${rawDesc}`)) {
                continue;
              }

              const isGenericCard = /muhtelif|diğer|diger|sarf\s*malzemeler.*ozel/i.test(cleaned);
              const pdfDesc = r.pdfExtractedName ? cleanRawMaterialName(r.pdfExtractedName) : '';
              const effectiveDesc = pdfDesc || rawDesc;
              const hasUsefulDesc = !isShortNoteOrSpecFragment(effectiveDesc);
              const isFullRuDesc = Boolean(pdfDesc) || (hasUsefulDesc && effectiveDesc.length >= 12 && /[а-яА-ЯёЁ]{4,}/.test(effectiveDesc));

              const translatedTr = isFullRuDesc
                ? (translateRussianMaterialToTurkish(effectiveDesc) || cleaned)
                : (isGenericCard && hasUsefulDesc)
                  ? (translateRussianMaterialToTurkish(effectiveDesc) || `${cleaned} (${effectiveDesc})`)
                  : translateRussianMaterialToTurkish(cleaned || effectiveDesc || rawName);

              let russianOrig = '';
              if (isFullRuDesc) {
                russianOrig = effectiveDesc;
              } else if (rawRu && !isShortNoteOrSpecFragment(rawRu)) {
                russianOrig = hasUsefulDesc && !effectiveDesc.toLowerCase().includes(rawRu.toLowerCase().slice(0, 6))
                  ? `${rawRu} (${effectiveDesc})`
                  : rawRu;
              } else if (isGenericCard && hasUsefulDesc) {
                russianOrig = effectiveDesc;
              } else if (!isShortNoteOrSpecFragment(cleaned) && cleaned.length >= 10) {
                russianOrig = cleaned;
              } else if (hasUsefulDesc && effectiveDesc.length >= 15) {
                russianOrig = effectiveDesc;
              } else {
                russianOrig = ensureRussianOriginalName(translatedTr || cleaned, !isShortNoteOrSpecFragment(effectiveDesc) ? effectiveDesc : '');
              }

              const itemCategory = normalizeCategoryName('', `${russianOrig} ${cleaned} ${translatedTr}`);

              items.push({
                id: `prizma_row_${r.id || idx + 1}`,
                materialName: translatedTr || cleaned || 'Prizma Malzemesi',
                originalName: russianOrig || cleaned || rawName || 'Prizma Malzemesi',
                materialCode: r.materialCode || undefined,
                quantity: Number(r.quantity) || 1,
                unit: r.unitNameTR || r.unitNameRU || 'Adet',
                unitPrice: Number(r.price) || 0,
                totalPrice: Number(r.amount) || Number(r.totalWithVat) || 0,
                vatPercentage: r.vatPercentage !== undefined ? Number(r.vatPercentage) : undefined,
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

      this.syncProgress = { percent: 95, message: 'Veriler güvenle kaydediliyor...' };

      // Persist to memory & disk
      this.memoryCache = syncedInvoices;
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
