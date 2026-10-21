import { MaterialComparison } from '../types';
import { formatRuble } from './format';
import { isExemptFromBenchmarkAudit } from './auditRiskEngine';
import { ensureRussianOriginalName } from './categoryClassifier';
import { areMaterialSegmentsCompatible } from './materialSegmentIntelligence';
import { clusterSameProductRows, isSameProductForPriceAlert } from './sameMaterialGuard';
import { extractTechnicalStandardAndGrade, formatTechnicalVariantBadges } from './materialGroupIntegrity';

export interface AnomalyAlert {
  id: string;
  type:
    | 'SAME_VENDOR_INFLATION'
    | 'JOBSITE_PRICE_GAP'
    | 'ZERO_DISCOUNT_HIGH_VALUE'
    | 'CROSS_JOBSITE_ARBITRAGE'
    | 'SPLIT_INVOICE_SMURFING'
    | 'PRICE_CREEP'
    | 'BASKET_SHRINKAGE';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  materialName: string;
  category: string;
  vendorName: string;
  jobsiteName?: string;
  previousPrice?: number;
  currentPrice?: number;
  percentageChange: number;
  financialImpact: number;
  dateStr: string;
  description: string;
  recommendation: string;
  invoiceNo?: string;
  quantity?: number;
  unit?: string;
  russianSubtitle?: string;
  minUnitPrice?: number;
  maxUnitPrice?: number;
  avgUnitPrice?: number;
  historyRows?: Array<{
    date: string;
    invoiceNo: string;
    supplier: string;
    jobsiteName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    netUnitPrice?: number;
    grossUnitPrice?: number;
    vatPercentage?: number;
    originalName?: string;
    conversionFormula?: string;
  }>;
  marketCluster?: 'STEEL_REBAR' | 'CONCRETE_CEMENT' | 'COPPER_CABLE' | 'LOGISTICS_GAP' | 'GENERAL';
}

// Filter out services/transport
export const isServiceItem = (name: string, category: string) => {
  const n = (name || '').toLowerCase();
  const c = (category || '').toLowerCase();
  return (
    c.includes('hizmet') || c.includes('lojistik') || c.includes('nakliye') || c.includes('taşıma') || c.includes('tasima') ||
    n.includes('доставк') || n.includes('транспорт') || n.includes('услуг') ||
    n.includes('погрузк') || n.includes('разгрузк') || n.includes('перевозк') ||
    n.includes('nakliye') || n.includes('taşıma') || n.includes('tasima') || n.includes('kargo')
  );
};

// Helper: Verify that two history rows represent strictly the same "elma-elma" material in the original Russian invoice text AND belong to the same Brand/Quality Segment (unless it's a GOST/DIN Commodity)
export const areHistoryEntriesStrictlyEquivalent = (a: any, b: any, matName: string, category?: string): boolean => {
  if (!a || !b) return false;
  const pA = Number(a.normalizedUnitPrice || a.unitPrice || 0);
  const pB = Number(b.normalizedUnitPrice || b.unitPrice || 0);
  if (pA <= 0 || pB <= 0) return false;

  // 0. Smart Commodity vs. Brand/Quality Segment Gate ("Demir demirdir, ama Mercedes ile Lada kıyaslanmaz")
  if (!areMaterialSegmentsCompatible(a, b, matName, category)) {
    return false;
  }

  // 0b. Farklı marka / model / varyant (Knauf ⟷ Volma, SP-100 ⟷ SP-610G, GKL ⟷ GKLV) asla aynı malzeme sayılmaz
  if (!isSameProductForPriceAlert(a, b, matName, category).same) {
    return false;
  }

  const origA = String(a.originalName || '').toLowerCase().replace(/,/g, '.');
  const origB = String(b.originalName || '').toLowerCase().replace(/,/g, '.');
  const combA = `${origA} ${matName.toLowerCase()}`;
  const combB = `${origB} ${matName.toLowerCase()}`;

  // 1. Conflicting product sub-types in original Russian text must never be compared
  const incompatiblePairs: Array<[RegExp, RegExp]> = [
    [/тахеометр|leica|зарядн|трегер/i, /гипсокартон|гипрок|gyproc|гкл\b/i],
    [/лента|ультранеодил|бандажн/i, /рулон|эпп|экп|техноэласт|изопласт|виллатекс/i],
    [/шпонка|гидрошпонк|waterbar/i, /мембран|эпп|экп|техноэласт|изопласт|виллатекс/i],
    [/sikaplan|пвх.*мембран|мембран.*пвх/i, /эпп|экп|техноэласт|изопласт|виллатекс|битум/i],
    [/паста|финиш/i, /штукатурк.*30\s*кг|ротбанд\s*30/i],
    [/куртка/i, /костюм/i],
    [/жилет\s+сигнальн/i, /жилет(?:(?!сигнальн).)*\sс\s+соп/i],
    [/охран/i, /рабоч|итр/i],
    [/бетонн|кость/i, /звездочк|стульчик|пластик/i],
    [/связь|аренда/i, /элемент.*ригель|ригель/i],
    [/широкоформатн|плоттер|914\s*мм|610\s*мм/i, /а4|a4|а3|a3|500\s*л|светокопи|svetocopy/i],
    [/станция|перекачк|насос/i, /^дизельное\s*топливо|^mazot$/i],
  ];
  for (const [rx1, rx2] of incompatiblePairs) {
    if ((rx1.test(combA) && rx2.test(combB)) || (rx2.test(combA) && rx1.test(combB))) {
      return false;
    }
  }

  // 2. If both rows have genuine Russian descriptions, check metric / thickness / diameter consistency
  const cleanDescA = origA.replace(/к\.?\s*п\.?\s*\d+(?:\.\d+)?/gi, ' ');
  const cleanDescB = origB.replace(/к\.?\s*п\.?\s*\d+(?:\.\d+)?/gi, ' ');
  const metricA = cleanDescA.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(\d{1,2})(?![0-9])/i)?.[1];
  const metricB = cleanDescB.match(/(?:^|[^a-zа-яё0-9])[mм]\s*(\d{1,2})(?![0-9])/i)?.[1];
  if (metricA && metricB && metricA !== metricB) return false;

  // 3. Guard against residual pack-vs-piece or unit conversion artifacts (> 250% spread) unless Russian headwords match
  const ratio = Math.max(pA, pB) / Math.min(pA, pB);
  if (ratio > 3.5) {
    const cyrWordsA = (cleanDescA.match(/[а-яё]{4,}/gi) || []).map(w => w.slice(0, 5));
    const cyrWordsB = new Set((cleanDescB.match(/[а-яё]{4,}/gi) || []).map(w => w.slice(0, 5)));
    const sharedRoots = cyrWordsA.filter(w => cyrWordsB.has(w));
    if (sharedRoots.length === 0) return false;
  }

  return true;
};


export interface PriceAnomalyOptions {
  language: string;
  getMarketCluster: (materialName: string, category: string) => AnomalyAlert['marketCluster'];
}

const unitPriceOf = (h: any) => Number(h.normalizedUnitPrice || h.unitPrice || 0);
const quantityOf = (h: any) => Number(h.normalizedQuantity || h.quantity || 1);
const isVatRatio = (ratio: number) => Math.abs(ratio - 1.22) <= 0.006 || Math.abs(ratio - 1.20) <= 0.006;
// Sunucu her satırın KDV tabanını fatura toplamıyla doğruladıysa (vatBasisVerified) 1,20x / 1,22x fark gerçektir, KDV karışıklığı değildir.
const isUnverifiedVatGap = (ratio: number, a: any, b: any) => isVatRatio(ratio) && !(a?.vatBasisVerified && b?.vatBasisVerified);

function mapHistoryRows(comp: MaterialComparison, rows: any[], stdUnit: string): NonNullable<AnomalyAlert['historyRows']> {
  return rows.map((h: any) => {
    // unitPriceOf = kıyaslama fiyatı (sunucuda %22 KDV dahil); net yalnızca bilgi amaçlı gösterilir
    const grossUp = unitPriceOf(h);
    const vatPct = Number(h.vatPercentage) || 22;
    const netUp = Number(h.normalizedNetUnitPrice || h.unitPriceNet) || Number((grossUp / 1.22).toFixed(2));
    return {
      date: (h.date || '').split('T')[0],
      invoiceNo: h.invoiceNumber || 'Fatura',
      supplier: h.supplier || 'Tedarikçi',
      jobsiteName: h.jobsiteName || 'Genel Şantiye',
      quantity: quantityOf(h),
      unit: stdUnit,
      unitPrice: grossUp,
      netUnitPrice: netUp,
      grossUnitPrice: grossUp,
      vatPercentage: vatPct,
      originalName: ensureRussianOriginalName(comp.materialName, h.originalName),
      conversionFormula: h.conversionFormula
    };
  });
}

/**
 * Aynı malzemenin (aynı katalog grubu + aynı marka/model/varyant) fiyat farklarını üretir.
 * Bir katalog grubunda farklı markalar/modeller varsa satırlar önce "aynı ürün" kümelerine
 * ayrılır ve her küme kendi içinde kıyaslanır; markalar arası fark asla alarm olmaz.
 */
export function buildSameMaterialPriceAlerts(mode1Comparisons: MaterialComparison[], { language, getMarketCluster }: PriceAnomalyOptions): AnomalyAlert[] {
  const list: AnomalyAlert[] = [];

  mode1Comparisons.forEach((comp, idx) => {
    if (!comp || !comp.materialName || !Array.isArray(comp.history) || comp.history.length < 2) return;
    if (isServiceItem(comp.materialName, comp.category)) return;
    if (isExemptFromBenchmarkAudit(comp.materialName, comp.category).isExempt) return;

    const stdUnit = comp.standardUnit || comp.unit || 'Adet';
    const pricedHistory = comp.history.filter((h: any) => unitPriceOf(h) > 0);
    const productClusters = clusterSameProductRows(pricedHistory, comp.materialName, comp.category)
      .filter(rows => rows.length >= 2);

    productClusters.forEach((rows, clusterIdx) => {
      const clusterSuffix = clusterIdx === 0 ? '' : `__urun${clusterIdx + 1}`;
      const mappedHistoryRows = mapHistoryRows(comp, rows, stdUnit);
      const sortedByPrice = [...rows].sort((a, b) => unitPriceOf(a) - unitPriceOf(b));
      const cheapestRec = sortedByPrice[0];
      const priciestRec = sortedByPrice[sortedByPrice.length - 1];
      const clusterTech = extractTechnicalStandardAndGrade(
        priciestRec?.originalName || cheapestRec?.originalName || '',
        comp.materialName
      );
      const clusterBadgeStr = formatTechnicalVariantBadges(clusterTech);
      const baseClusterMatName = comp.materialName.replace(/\s*\(1\.\s*Sınıf\s*GOST\)/gi, '').trim();
      const clusterMaterialName = clusterBadgeStr && !baseClusterMatName.includes(clusterBadgeStr)
        ? `${baseClusterMatName} ${clusterBadgeStr}`.trim()
        : baseClusterMatName;
      const minUnitPrice = unitPriceOf(cheapestRec);
      const maxUnitPrice = unitPriceOf(priciestRec);
      const avgUnitPrice = Number((rows.reduce((s: number, h: any) => s + unitPriceOf(h), 0) / rows.length).toFixed(2));

      // 1. Same Supplier Price Hike Detection (Canonical Elma-Elma Normalized Comparisons)
      const byVendor: Record<string, any[]> = {};
      rows.forEach((h: any) => {
        const sup = (h.supplier || '').trim();
        if (!sup) return;
        const vKey = sup.toLowerCase();
        if (!byVendor[vKey]) byVendor[vKey] = [];
        byVendor[vKey].push(h);
      });

      Object.values(byVendor).forEach((vHist) => {
        if (vHist.length < 2) return;
        const sorted = [...vHist].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const first = sorted[0];
        const latest = sorted[sorted.length - 1];
        if (!areHistoryEntriesStrictlyEquivalent(first, latest, comp.materialName, comp.category)) return;
        let prevPrice = unitPriceOf(first);
        let currPrice = unitPriceOf(latest);
        const currQty = quantityOf(latest);

        // Smart VAT Ratio Detector: doğrulanmamış satırlarda 1,20x / 1,22x oran KDV karışıklığı sayılır
        if (prevPrice > 0 && currPrice > 0) {
          const ratio = currPrice / prevPrice;
          if (isUnverifiedVatGap(ratio, first, latest)) {
            currPrice = prevPrice;
          } else if (isUnverifiedVatGap(1 / ratio, first, latest)) {
            prevPrice = currPrice;
          }
        }

        if (!(prevPrice > 0 && currPrice > prevPrice)) return;
        const priceDiff = currPrice - prevPrice;
        const pctIncrease = Number(((priceDiff / prevPrice) * 100).toFixed(1));
        const totalImpact = Math.round(priceDiff * currQty);
        if (pctIncrease < 5 || totalImpact < 500) return;

        list.push({
          id: `same_vendor_hike_${latest.invoiceNumber || 'inv'}_${comp.id || comp.materialName.replace(/\s+/g, '_')}${clusterSuffix}`,
          type: 'SAME_VENDOR_INFLATION',
          severity: pctIncrease >= 15 ? 'CRITICAL' : 'WARNING',
          title: language === 'RU'
            ? `Повышение цены у того же поставщика: ${latest.supplier} (+%${pctIncrease})`
            : `Aynı Firmadan Fiyat Artışı: ${latest.supplier} (+%${pctIncrease} Zam)`,
          materialName: clusterMaterialName,
          russianSubtitle: ensureRussianOriginalName(clusterMaterialName, latest.originalName || first.originalName),
          category: comp.category,
          vendorName: latest.supplier,
          jobsiteName: latest.jobsiteName,
          previousPrice: prevPrice,
          currentPrice: currPrice,
          minUnitPrice,
          maxUnitPrice,
          avgUnitPrice,
          percentageChange: pctIncrease,
          financialImpact: totalImpact,
          dateStr: (latest.date || '').split('T')[0],
          invoiceNo: latest.invoiceNumber,
          quantity: currQty,
          unit: stdUnit,
          historyRows: mappedHistoryRows,
          marketCluster: getMarketCluster(clusterMaterialName, comp.category),
          description: language === 'RU'
            ? `Цена за единицу (${stdUnit}) материала "${clusterMaterialName}" у поставщика "${latest.supplier}" выросла с ${formatRuble(prevPrice)} (${(first.date || '').split('T')[0]}) до ${formatRuble(currPrice)} (${(latest.date || '').split('T')[0]}) (+${pctIncrease}%).`
            : `"${latest.supplier}" firmasından alınan "${clusterMaterialName}" malzemesinin standart birim fiyatı (${stdUnit}) ${(first.date || '').split('T')[0]} tarihli alımda ${formatRuble(prevPrice)}/${stdUnit} iken, ${(latest.date || '').split('T')[0]} tarihli faturada ${formatRuble(currPrice)}/${stdUnit} seviyesine yükselmiştir (+%${pctIncrease} artış).`,
          recommendation: language === 'RU'
            ? `Проверьте рыночные котировки и потребуйте у поставщика возврата к прежней цене ${formatRuble(prevPrice)}/${stdUnit}.`
            : `Tedarikçi ile önceki anlaşma fiyatı olan ${formatRuble(prevPrice)}/${stdUnit} baz alınarak revize iskonto talep edilmelidir.`
        });
      });

      // 2. Elma-Elma Malzeme Fiyat Farkı & Şantiyeler / Tedarikçiler Arası Sapma Tespiti
      if (!(minUnitPrice > 0) || maxUnitPrice <= minUnitPrice) return;
      if (isUnverifiedVatGap(maxUnitPrice / minUnitPrice, cheapestRec, priciestRec)) return;
      const priceDiffPct = Number((((maxUnitPrice - minUnitPrice) / minUnitPrice) * 100).toFixed(1));
      if (priceDiffPct < 5) return;
      if (!areHistoryEntriesStrictlyEquivalent(cheapestRec, priciestRec, comp.materialName, comp.category)) return;

      // Calculate actual financial overpayment of purchases above the cheapest price of the same product
      const actualOverpayment = rows.reduce((sum: number, h: any) => {
        const uPrice = unitPriceOf(h);
        return uPrice > minUnitPrice ? sum + (uPrice - minUnitPrice) * quantityOf(h) : sum;
      }, 0);
      const totalImpact = Math.max(Math.round(actualOverpayment), Math.round((maxUnitPrice - minUnitPrice) * (priciestRec?.quantity || 1)));
      if (totalImpact < 300) return;

      const cleanMatName = comp.materialName.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇа-яА-Я]/g, '_');
      const alertId = (comp.id
        ? `jobsite_gap_${comp.id}_${idx}`
        : `jobsite_gap_${cleanMatName}_${stdUnit.replace(/\s+/g, '_')}_${idx}`) + clusterSuffix;

      list.push({
        id: alertId,
        type: 'JOBSITE_PRICE_GAP',
        severity: priceDiffPct >= 20 ? 'CRITICAL' : 'WARNING',
        title: language === 'RU'
          ? `Разница цен на один и тот же материал: +%${priceDiffPct}`
          : `Elma-Elma Malzeme Fiyat Farkı: +%${priceDiffPct} Sapma (${rows.length} Alım)`,
        materialName: clusterMaterialName,
        russianSubtitle: ensureRussianOriginalName(clusterMaterialName, priciestRec?.originalName || cheapestRec?.originalName),
        category: comp.category,
        vendorName: `${cheapestRec?.supplier || comp.cheapestJobsiteName} (${formatRuble(minUnitPrice)}) ⟷ ${priciestRec?.supplier || comp.priciestJobsiteName} (${formatRuble(maxUnitPrice)})`,
        jobsiteName: priciestRec?.jobsiteName || comp.priciestJobsiteName,
        previousPrice: minUnitPrice,
        currentPrice: maxUnitPrice,
        minUnitPrice,
        maxUnitPrice,
        avgUnitPrice,
        percentageChange: priceDiffPct,
        financialImpact: totalImpact,
        dateStr: (priciestRec?.date || new Date().toISOString()).split('T')[0],
        invoiceNo: priciestRec?.invoiceNumber,
        unit: stdUnit,
        historyRows: mappedHistoryRows,
        marketCluster: 'LOGISTICS_GAP',
        description: language === 'RU'
          ? `Материал "${clusterMaterialName}" (${stdUnit}) закупался на объекте "${cheapestRec?.jobsiteName || comp.cheapestJobsiteName}" у "${cheapestRec?.supplier || '-'}" по цене ${formatRuble(minUnitPrice)}/${stdUnit}, а на объекте "${priciestRec?.jobsiteName || comp.priciestJobsiteName}" у "${priciestRec?.supplier || '-'}" по цене ${formatRuble(maxUnitPrice)}/${stdUnit} (+%${priceDiffPct}).`
          : `Birebir aynı teknik özellikteki "${clusterMaterialName}" malzemesi (${stdUnit} bazında normalize edilmiş elma-elma kıyas) en uygun "${cheapestRec?.jobsiteName || comp.cheapestJobsiteName}" şantiyesinde "${cheapestRec?.supplier || '-'}" firmasından ${formatRuble(minUnitPrice)}/${stdUnit} fiyata alınmışken, "${priciestRec?.jobsiteName || comp.priciestJobsiteName}" şantiyesinde "${priciestRec?.supplier || '-'}" firmasından ${formatRuble(maxUnitPrice)}/${stdUnit} fiyata alınmıştır (+%${priceDiffPct} fiyat farkı).`,
        recommendation: language === 'RU'
          ? `Рекомендуется закупать данный материал через поставщика "${cheapestRec?.supplier || comp.cheapestJobsiteName}" по базовой цене ${formatRuble(minUnitPrice)}/${stdUnit}.`
          : `Sonraki siparişlerde en düşük birim fiyatı veren "${cheapestRec?.supplier || comp.cheapestJobsiteName}" (${formatRuble(minUnitPrice)}/${stdUnit}) referans alınarak alım yapılmalıdır.`
      });
    });
  });

  return list;
}

/** Bu tutarın altındaki fiyat farkı/artışı alarmları "küçük" sayılır ve varsayılan olarak gizlenir. */
export const SERIOUS_PRICE_IMPACT_RUB = 10000;

export function isMinorPriceAlert(alert: Pick<AnomalyAlert, 'type' | 'financialImpact'>): boolean {
  return (alert.type === 'SAME_VENDOR_INFLATION' || alert.type === 'JOBSITE_PRICE_GAP') &&
    (Number(alert.financialImpact) || 0) < SERIOUS_PRICE_IMPACT_RUB;
}
