/**
 * İndirim (şef pazarlık / TDF teklif merkezi) kayıtlarını kendi PDF belgelerinden onarır.
 *
 * Neden: eski sürümlerde (1) ilk teklif ↔ nihai fatura kalemleri yanlış eşleştirildi ("Genel Malzeme"
 * kalemlerinin hepsi ilk teklifin aynı satırına bağlandı → başka malzemenin fiyatı "Piyasa Baz Birim"
 * göründü), (2) belge tarihi yerine sözleşme tarihi (Договор ... от 02.02.2023) kaydedildi,
 * (3) yapay zekâ bazı birim fiyatları yanlış okudu.
 *
 * Bu modül saf hesap yapar (veritabanına dokunmaz). Bir belge ancak katı ayrıştırıcıyla okunup kendi içinde
 * doğrulanırsa (her satırda miktar × fiyat = tutar, satırlar toplamı = belge toplamı) veri kaynağı sayılır.
 */
import {
  parseInvoiceText,
  verifyParsedInvoice,
  extractDocumentHeaderDate,
  extractContractDates,
  mapDocumentUnit,
  ParsedInvoiceLine
} from '../src/utils/invoiceLineParser';
import { matchLines } from '../src/utils/invoiceLineMatcher';
import { findUnreliableLegacyCanonicals, CURRENT_LINE_MATCH_VERSION } from '../src/utils/discountLineReference';
import { translateRussianMaterialToTurkish } from '../src/utils/categoryClassifier';

export const DISCOUNT_LINE_REPAIR_VERSION = 1;

export interface VerifiedDocument {
  lines: ParsedInvoiceLine[];
  total: number;
  pricesIncludeVat: boolean;
  headerDate: string | null;
  contractDates: string[];
}

const FREIGHT_RE = /доставк|грузоперевоз|перевозк|транспортн|автоуслуг|манипулятор|погрузо|разгруз/i;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function unitKey(raw: string | undefined): string {
  return mapDocumentUnit(String(raw || '')).toUpperCase();
}

/** Belge metnini katı ayrıştırıcıyla okur; doğrulanamazsa null döner (tahmin yapılmaz). */
export function readVerifiedDocument(text: string): VerifiedDocument | null {
  if (!text || text.trim().length < 50) return null;
  const parsed = parseInvoiceText(text);
  const total = Number(parsed.totalWithVat || 0);
  if (!(total > 0)) return null;
  const check = verifyParsedInvoice(parsed, total);
  if (!check.verified || parsed.pricesIncludeVat === null) return null;
  return {
    lines: parsed.lines,
    total,
    pricesIncludeVat: parsed.pricesIncludeVat,
    headerDate: extractDocumentHeaderDate(text),
    contractDates: extractContractDates(text)
  };
}

function grossUnitOf(doc: VerifiedDocument, l: ParsedInvoiceLine): number {
  return doc.pricesIncludeVat ? l.price : round2(l.grossAmount / (l.quantity || 1));
}

function goodsLines(doc: VerifiedDocument): ParsedInvoiceLine[] {
  return doc.lines.filter(l => !FREIGHT_RE.test(l.name));
}

export interface DiscountRepairPlan {
  changed: boolean;
  /** discounts/{id} için birleştirilecek alanlar */
  discountUpdate: Record<string, any>;
  /** invoices/inv_sync_{id} için birleştirilecek alanlar (yalnızca değişenler) */
  invoiceUpdate: Record<string, any>;
  notes: string[];
}

/**
 * finalDoc: nihai faturanın doğrulanmış okuması (yoksa null)
 * initialDocs: ilk teklif belgelerinin doğrulanmış okumaları (tedarikçi adıyla)
 */
export function planDiscountRepair(
  discount: any,
  finalDoc: VerifiedDocument | null,
  initialDocs: Array<{ doc: VerifiedDocument; supplier?: string }>
): DiscountRepairPlan {
  const notes: string[] = [];
  const discountUpdate: Record<string, any> = {};
  const invoiceUpdate: Record<string, any> = {};
  const storedItems: any[] = Array.isArray(discount.items) ? discount.items : [];
  let items: any[] = storedItems;

  // Belge tutarı kayıttan çok farklıysa (yanlış dosya bağlanmış olabilir) hiçbir şeye dokunulmaz.
  const recordAgreed = Number(discount.agreedPrice) || 0;
  if (finalDoc && recordAgreed > 0 && Math.abs(recordAgreed - finalDoc.total) / finalDoc.total > 0.25) {
    notes.push(`Nihai belge tutarı (${finalDoc.total}) kayıttan (${recordAgreed}) çok farklı; elle kontrol gerekir, dokunulmadı.`);
    finalDoc = null;
  }
  const finalRef = finalDoc?.total || recordAgreed;
  initialDocs = initialDocs.filter(d => {
    if (finalRef > 0 && (d.doc.total < finalRef * 0.5 || d.doc.total > finalRef * 2.5)) {
      notes.push(`İlk teklif belgesi tutarı (${d.doc.total}) nihai tutara (${finalRef}) göre makul değil; kullanılmadı.`);
      return false;
    }
    return true;
  });

  // 1) Kalemler: nihai fatura doğrulandıysa satırlar belgeden alınır.
  if (finalDoc) {
    const lines = goodsLines(finalDoc);
    const assign = matchLines(
      lines.map(l => ({ originalName: l.name, article: l.article })),
      storedItems.map(it => ({ originalName: it.originalName, materialName: it.materialName, article: it.article, productCode: it.productCode }))
    );
    const rebuilt = lines.map((l, idx) => {
      const base = assign[idx] >= 0 ? storedItems[assign[idx]] : null;
      const grossUnit = grossUnitOf(finalDoc, l);
      const vatPct = l.vatPct ?? 22;
      const trName = /[А-Яа-яЁё]/.test(l.name) ? (translateRussianMaterialToTurkish(l.name) || l.name) : l.name;
      return {
        ...(base || {}),
        materialName: base?.materialName || trName,
        originalName: l.name,
        category: base?.category || discount.category || 'Genel Malzeme',
        quantity: l.quantity,
        unit: base?.unit || unitKey(l.unitRaw),
        unitPrice: grossUnit,
        grossUnitPrice: grossUnit,
        unitPriceNet: vatPct > 0 ? round2(grossUnit / (1 + vatPct / 100)) : grossUnit,
        totalPrice: round2(l.grossAmount),
        grossTotalPrice: round2(l.grossAmount),
        netTotalPrice: round2(l.netAmount),
        vatPercentage: vatPct,
        discountAmount: 0,
        isGrossInvoicePrice: true,
        isNetNormalized: true,
        lineSource: 'invoice_pdf',
        lineVerified: true,
        ...(l.article ? { article: l.article } : {})
      };
    });
    const differs = rebuilt.length !== storedItems.length || rebuilt.some((it, idx) => {
      const old = assign[idx] >= 0 ? storedItems[assign[idx]] : null;
      return !old ||
        Math.abs((Number(old.quantity) || 0) - it.quantity) > 0.0001 ||
        Math.abs((Number(old.unitPrice) || 0) - it.unitPrice) > 0.01 ||
        Math.abs((Number(old.totalPrice) || 0) - it.totalPrice) > 0.01;
    });
    if (differs) {
      items = rebuilt;
      discountUpdate.items = rebuilt;
      invoiceUpdate.items = rebuilt;
      notes.push(`Kalemler nihai faturadan yeniden okundu (${rebuilt.length} satır).`);
    } else {
      items = storedItems;
    }

    // 2) Tarih: kayıtlı tarih belgedeki sözleşme tarihiyse belge başlığındaki tarihle değiştirilir.
    const orderDate = String(discount.orderDate || '');
    if (finalDoc.headerDate && orderDate !== finalDoc.headerDate &&
        (!orderDate || finalDoc.contractDates.includes(orderDate))) {
      discountUpdate.orderDate = finalDoc.headerDate;
      invoiceUpdate.date = finalDoc.headerDate;
      notes.push(`Tarih düzeltildi: ${orderDate || '-'} (sözleşme tarihi) → ${finalDoc.headerDate} (fatura tarihi).`);
    }

    // 3) Nihai tutar
    const agreed = Number(discount.agreedPrice) || 0;
    if (Math.abs(agreed - finalDoc.total) > 1) {
      discountUpdate.agreedPrice = finalDoc.total;
      invoiceUpdate.totalAmount = finalDoc.total;
      notes.push(`Nihai fatura tutarı düzeltildi: ${agreed} → ${finalDoc.total}.`);
    }
  }

  // 4) İlk teklif tutarı (birden fazla ilk teklifte: nihai tutarın üstündeki en düşük teklif baz alınır)
  const finalTotal = Number(discountUpdate.agreedPrice ?? discount.agreedPrice) || 0;
  if (initialDocs.length > 0) {
    const totals = initialDocs.map(d => d.doc.total).sort((a, b) => a - b);
    const above = totals.filter(t => t > finalTotal + 0.01);
    const baseline = above.length > 0 ? above[0] : totals[totals.length - 1];
    const offer = Number(discount.offerPrice) || 0;
    if (Math.abs(offer - baseline) > 1) {
      discountUpdate.offerPrice = baseline;
      notes.push(`İlk teklif tutarı düzeltildi: ${offer} → ${baseline}.`);
    }
  }

  // 5) İndirim tutarlarını yeni tutarlarla yeniden hesapla
  if (discountUpdate.agreedPrice !== undefined || discountUpdate.offerPrice !== undefined) {
    const offer = Number(discountUpdate.offerPrice ?? discount.offerPrice) || 0;
    const deduction = Number(discount.scopeDeductionAmount) || 0;
    const baseline = Math.max(0, offer - deduction);
    const amount = round2(Math.max(0, baseline - finalTotal));
    const pct = baseline > 0 ? Number(((amount / baseline) * 100).toFixed(2)) : 0;
    discountUpdate.adjustedOfferPrice = deduction > 0 ? baseline : offer;
    discountUpdate.discountAmount = amount;
    discountUpdate.discountPercentage = pct;
    if (discount.calculationMethod === 'MARKET_BASELINE_TO_FINAL') {
      discountUpdate.marketReferencePrice = offer;
      discountUpdate.realMarketSavings = amount;
      discountUpdate.realSavingsPercentage = pct;
    }
  }

  // 6) Kalem bazlı ilk teklif referansları (tüm kayıtlar için ilk teklif PDF'inden satır eşleştirme)
  const storedCanonicals: any[] = Array.isArray(discount.canonicalMaterials) ? discount.canonicalMaterials : [];
  const hasLegacyCanonicals = storedCanonicals.some(c => (c?.lineMatchVersion || 0) < CURRENT_LINE_MATCH_VERSION);
  if (finalDoc && initialDocs.length > 0) {
    const finalLines = goodsLines(finalDoc);
    const perInitial = initialDocs.map(d => {
      const lines = goodsLines(d.doc);
      return {
        d,
        lines,
        map: matchLines(
          finalLines.map(l => ({ originalName: l.name, article: l.article })),
          lines.map(l => ({ originalName: l.name, article: l.article }))
        )
      };
    });
    const supplierFallback = discount.vendorName || 'İlk teklif';
    const canonicals = finalLines.map((l, idx) => {
      const finUp = grossUnitOf(finalDoc, l);
      let ref = 0;
      let refSupplier = '';
      for (const p of perInitial) {
        const m = p.map[idx];
        if (m < 0) continue;
        const il = p.lines[m];
        if (unitKey(il.unitRaw) !== unitKey(l.unitRaw)) continue;
        const up = grossUnitOf(p.d.doc, il);
        if (up > 0 && (ref === 0 || up < ref)) {
          ref = up;
          refSupplier = p.d.supplier || supplierFallback;
        }
      }
      const referenceFound = ref > 0;
      const refPrice = referenceFound ? ref : finUp;
      const qty = l.quantity || 1;
      const unitSaving = round2(refPrice - finUp);
      const itemSaving = round2(Math.max(0, unitSaving * qty));
      const old = storedCanonicals[idx] || {};
      return {
        ...old,
        id: old.id || `can_mat_${idx + 1}_${discount.id || 'rep'}`,
        commonName: items[idx]?.materialName || l.name,
        originalName: l.name,
        sourceLineIndex: idx,
        referenceFound,
        lineMatchVersion: CURRENT_LINE_MATCH_VERSION,
        standardUnit: items[idx]?.unit || unitKey(l.unitRaw),
        purchasedQuantity: qty,
        quantity: qty,
        purchasedUnitPrice: finUp,
        purchasedSupplier: discount.vendorName || old.purchasedSupplier || '',
        marketReferenceUnitPrice: refPrice,
        marketReferenceSupplier: referenceFound ? refSupplier : (discount.vendorName || ''),
        winningFirstUnitPrice: refPrice,
        realUnitSavings: unitSaving,
        realTotalSavings: round2(unitSaving * qty),
        realSavingsAmount: itemSaving,
        realSavingsPercentage: refPrice > 0 ? Number(((Math.max(0, unitSaving) / refPrice) * 100).toFixed(2)) : 0,
        realSavingsRate: refPrice > 0 ? Number(((Math.max(0, unitSaving) / refPrice) * 100).toFixed(2)) : 0,
        internalVendorUnitDiscount: Math.max(0, unitSaving),
        internalVendorTotalDiscount: itemSaving,
        isAboveBestOffer: referenceFound && finUp > refPrice + 0.01,
        aboveBestOfferDiff: referenceFound && finUp > refPrice ? round2(finUp - refPrice) : 0,
        matchReason: referenceFound ? 'Belgelerden bire bir kalem eşleştirmesi (onarım)' : 'İlk teklifte bu kalem yok',
        matchConfidence: referenceFound ? 0.99 : 0
      };
    });
    const before = JSON.stringify(storedCanonicals.map(c => [c?.marketReferenceUnitPrice, c?.purchasedUnitPrice, c?.referenceFound]));
    const after = JSON.stringify(canonicals.map(c => [c.marketReferenceUnitPrice, c.purchasedUnitPrice, c.referenceFound]));
    if (before !== after || hasLegacyCanonicals) {
      discountUpdate.canonicalMaterials = canonicals;
      notes.push(`Kalem bazlı ilk teklif referansları belgelerden yeniden kuruldu (${canonicals.filter(c => c.referenceFound).length}/${canonicals.length} kalemde ilk teklif bulundu).`);
    }
  } else if (hasLegacyCanonicals) {
    // Belgeler doğrulanamadı: eski eşleştiricinin bilinen hata imzasını taşıyan referanslar kaldırılır.
    const unreliable = findUnreliableLegacyCanonicals(storedCanonicals);
    if (unreliable.size > 0) {
      discountUpdate.canonicalMaterials = storedCanonicals.map((c, i) => unreliable.has(i)
        ? { ...c, referenceFound: false, lineMatchVersion: CURRENT_LINE_MATCH_VERSION, matchReason: 'Eski eşleştirme hatası: referans kaldırıldı (belge doğrulanamadı)' }
        : c);
      notes.push(`${unreliable.size} kalemde yanlış eşleşmiş ilk teklif referansı kaldırıldı (ilk teklif belgesi okunamadı).`);
    }
  }

  const changed = Object.keys(discountUpdate).length > 0;
  return { changed, discountUpdate, invoiceUpdate, notes };
}
