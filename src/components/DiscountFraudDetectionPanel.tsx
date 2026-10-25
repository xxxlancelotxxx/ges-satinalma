import React, { useMemo, useState } from 'react';
import { DiscountRecord } from '../types';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import {
  FraudPortfolioResult,
  DiscountFraudReport,
  FraudFinding,
  FraudPatternCode,
  FraudSeverity,
  FRAUD_PATTERN_LABELS
} from '../utils/discountFraudEngine';
import { ShieldAlert, ChevronDown, ChevronRight, FileText, Users, Eye, CheckCircle2 } from 'lucide-react';

interface Props {
  result: FraudPortfolioResult;
  discounts: DiscountRecord[];
  onOpenRecord: (record: DiscountRecord) => void;
}

export const SEVERITY_STYLE: Record<FraudSeverity | 'CLEAN', { label: string; badge: string; dot: string }> = {
  CRITICAL: { label: 'Kritik', badge: 'bg-red-600 text-white border-red-700', dot: 'bg-red-600' },
  HIGH: { label: 'Yüksek', badge: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-500' },
  MEDIUM: { label: 'Kontrol et', badge: 'bg-amber-50 text-amber-800 border-amber-300', dot: 'bg-amber-400' },
  INFO: { label: 'Bilgi', badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-300' },
  CLEAN: { label: 'Temiz', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
};

const PATTERN_ORDER: FraudPatternCode[] = [
  'INFLATED_FIRST_OFFER',
  'PHANTOM_SAVINGS',
  'REPEAT_DISCOUNT_SAME_PRICE',
  'DUPLICATE_INVOICE',
  'STAGE_AMOUNT_MISMATCH',
  'INVOICE_TOTAL_MISMATCH',
  'EXCESSIVE_DISCOUNT'
];

const sourceLabel: Record<string, string> = {
  GES_ARCHIVE: 'GES Arşivi',
  PRIZMA_ERP: 'Prizma ERP',
  DISCOUNT: 'İndirim kaydı',
  DOCUMENT: 'Belge'
};

export const FraudFindingCard: React.FC<{ finding: FraudFinding; onOpenRelated?: (id: string) => void }> = ({ finding, onOpenRelated }) => {
  const style = SEVERITY_STYLE[finding.severity];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${style.badge}`}>{style.label}</span>
        <span className="text-xs font-black text-slate-900">{finding.title}</span>
        {finding.impactRub > 0 && (
          <span className="ml-auto text-xs font-black text-red-700">Şüpheli: {formatRuble(finding.impactRub)}</span>
        )}
      </div>
      <p className="text-xs text-slate-700 leading-relaxed">{finding.summary}</p>
      {finding.evidence.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="py-1 pr-2 font-bold">Kanıt</th>
                <th className="py-1 pr-2 font-bold">Değer</th>
                <th className="py-1 pr-2 font-bold">Belge / Tarih</th>
                <th className="py-1 pr-2 font-bold">Kaynak</th>
                <th className="py-1 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {finding.evidence.map((e, i) => (
                <tr key={i} className="border-b border-slate-50 align-top">
                  <td className="py-1 pr-2 text-slate-700 font-semibold max-w-[260px]">{e.label}</td>
                  <td className="py-1 pr-2 font-mono text-slate-900">{e.value}</td>
                  <td className="py-1 pr-2 text-slate-600">
                    {[e.docNo, e.date, e.supplier].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="py-1 pr-2 text-slate-500">{e.source ? sourceLabel[e.source] : '-'}</td>
                  <td className="py-1 whitespace-nowrap">
                    {e.fileUrl && (
                      <button
                        type="button"
                        onClick={() => openOriginalFileViewer(e.fileUrl!, e.docNo || 'belge.pdf')}
                        className="inline-flex items-center gap-1 text-indigo-700 hover:underline font-bold cursor-pointer"
                      >
                        <FileText className="w-3 h-3" /> Aç
                      </button>
                    )}
                    {!e.fileUrl && e.discountId && onOpenRelated && e.source === 'DISCOUNT' && (
                      <button
                        type="button"
                        onClick={() => onOpenRelated(e.discountId!)}
                        className="inline-flex items-center gap-1 text-indigo-700 hover:underline font-bold cursor-pointer"
                      >
                        <Eye className="w-3 h-3" /> Kayıt
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const DiscountFraudDetectionPanel: React.FC<Props> = ({ result, discounts, onOpenRecord }) => {
  const [patternFilter, setPatternFilter] = useState<FraudPatternCode | 'ALL'>('ALL');
  const [showReviewed, setShowReviewed] = useState(false);
  const [showMedium, setShowMedium] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showPeople, setShowPeople] = useState(false);

  const byId = useMemo(() => new Map(discounts.map(d => [d.id, d])), [discounts]);

  const rows = useMemo(() => {
    const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3, CLEAN: 4 };
    return result.reports
      .filter(r => r.riskLevel !== 'CLEAN' && r.riskLevel !== 'INFO')
      .filter(r => showMedium || r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH')
      .filter(r => showReviewed || !r.executiveReviewed)
      .filter(r => patternFilter === 'ALL' || r.findings.some(f => f.code === patternFilter))
      .sort((a, b) => rank[a.riskLevel] - rank[b.riskLevel] || b.suspiciousAmount - a.suspiciousAmount);
  }, [result, patternFilter, showReviewed, showMedium]);

  const openById = (id: string) => {
    const rec = byId.get(id);
    if (rec) onOpenRecord(rec);
  };

  const reviewedFlagged = result.reports.filter(r => r.executiveReviewed && (r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH')).length;
  const mediumCount = result.reports.filter(r => r.riskLevel === 'MEDIUM').length;
  const cleanCount = result.reports.filter(r => r.riskLevel === 'CLEAN').length;

  return (
    <div className="bg-white border-2 border-red-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Akıllı Hile Denetimi
          </h3>
          <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
            Her indirim kaydı 7 hile kalıbına göre taranır. Fiyat iddiaları yalnızca aynı marka, model ve özellikteki malzemenin
            kayıttan önceki gerçek (KDV dahil) alım fiyatlarına dayanır; tahmini fiyat üretilmez. Her bulgunun kanıt belgesi yanında gösterilir.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2">
            <div className="text-[10px] font-bold text-red-700 uppercase">Kritik</div>
            <div className="text-xl font-black text-red-700">{result.criticalCount}</div>
          </div>
          <div className="rounded-xl bg-orange-50 border border-orange-200 px-3 py-2">
            <div className="text-[10px] font-bold text-orange-700 uppercase">Yüksek</div>
            <div className="text-xl font-black text-orange-700">{result.highCount}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
            <div className="text-[10px] font-bold text-slate-600 uppercase">Şüpheli tutar</div>
            <div className="text-sm font-black text-slate-900 mt-1">{formatRuble(result.totalSuspiciousAmount)}</div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="text-[10px] font-bold text-emerald-700 uppercase">Temiz kayıt</div>
            <div className="text-xl font-black text-emerald-700">{cleanCount}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setPatternFilter('ALL')}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${patternFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          Tüm kalıplar
        </button>
        {PATTERN_ORDER.filter(c => result.patternCounts[c] > 0).map(code => (
          <button
            key={code}
            type="button"
            onClick={() => setPatternFilter(code)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${patternFilter === code ? 'bg-red-600 text-white border-red-700' : 'bg-white text-slate-700 border-slate-200 hover:border-red-300'}`}
          >
            {FRAUD_PATTERN_LABELS[code]} <span className="opacity-70">({result.patternCounts[code]})</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showMedium} onChange={e => setShowMedium(e.target.checked)} />
          "Kontrol et" seviyesini de göster ({mediumCount})
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={showReviewed} onChange={e => setShowReviewed(e.target.checked)} />
          Yöneticinin incelediği kayıtları da göster ({reviewedFlagged})
        </label>
        <button type="button" onClick={() => setShowPeople(p => !p)} className="inline-flex items-center gap-1 font-bold text-indigo-700 cursor-pointer">
          <Users className="w-3.5 h-3.5" /> {showPeople ? 'Kişi bazlı riski gizle' : 'Kişi bazlı risk'}
        </button>
      </div>

      {showPeople && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="py-2 px-3">Kişi</th>
                <th className="py-2 px-3">Kayıt</th>
                <th className="py-2 px-3">Şüpheli kayıt</th>
                <th className="py-2 px-3">Beyan edilen indirim</th>
                <th className="py-2 px-3">Şüpheli tutar</th>
                <th className="py-2 px-3">En sık kalıp</th>
                <th className="py-2 px-3">Yoğunlaştığı tedarikçi</th>
              </tr>
            </thead>
            <tbody>
              {result.people.filter(p => p.flaggedCount > 0).map(p => {
                const top = (Object.entries(p.patternCounts) as Array<[FraudPatternCode, number]>).sort((a, b) => b[1] - a[1])[0];
                return (
                  <tr key={p.personKey} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-bold text-slate-900">{p.personName} <span className="text-[10px] text-slate-400 font-normal">{p.role}</span></td>
                    <td className="py-2 px-3">{p.recordCount}</td>
                    <td className="py-2 px-3 font-bold text-red-700">{p.flaggedCount}{p.criticalCount > 0 ? ` (${p.criticalCount} kritik)` : ''}</td>
                    <td className="py-2 px-3">{formatRuble(p.claimedDiscount)}</td>
                    <td className="py-2 px-3 font-bold">{formatRuble(p.suspiciousAmount)}</td>
                    <td className="py-2 px-3">{top ? `${FRAUD_PATTERN_LABELS[top[0]]} (${top[1]})` : '-'}</td>
                    <td className="py-2 px-3">{p.topVendor ? `${p.topVendor} (%${Math.round((p.topVendorShare || 0) * 100)})` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
          <CheckCircle2 className="w-4 h-4" /> Bu filtrede şüpheli kayıt yok.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <FraudRecordRow
              key={r.discountId}
              report={r}
              record={byId.get(r.discountId)}
              open={Boolean(expanded[r.discountId])}
              onToggle={() => setExpanded(prev => ({ ...prev, [r.discountId]: !prev[r.discountId] }))}
              onOpenRecord={onOpenRecord}
              onOpenRelated={openById}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FraudRecordRow: React.FC<{
  report: DiscountFraudReport;
  record?: DiscountRecord;
  open: boolean;
  onToggle: () => void;
  onOpenRecord: (record: DiscountRecord) => void;
  onOpenRelated: (id: string) => void;
}> = ({ report, record, open, onToggle, onOpenRecord, onOpenRelated }) => {
  if (!record) return null;
  const style = SEVERITY_STYLE[report.riskLevel];
  const codes = Array.from(new Set<FraudPatternCode>(report.findings.filter(f => f.severity !== 'INFO').map(f => f.code)));
  return (
    <div className={`rounded-xl border ${report.riskLevel === 'CRITICAL' ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-slate-50/40'}`}>
      <button type="button" onClick={onToggle} className="w-full text-left p-3 flex flex-col md:flex-row md:items-center gap-2 cursor-pointer">
        <div className="flex items-center gap-2 shrink-0">
          {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${style.badge}`}>{style.label}</span>
          <span className="text-[10px] font-mono text-slate-500">{report.riskScore}/100</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-slate-900 truncate">
            {record.vendorName} · №{record.invoiceNo || '-'} · {record.orderDate}
          </div>
          <div className="text-[11px] text-slate-600 truncate">
            {record.performedByPersonnelName || record.supervisorName} · {record.jobsiteName} · {codes.map(c => FRAUD_PATTERN_LABELS[c]).join(' + ')}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-right">
          <div>
            <div className="text-[10px] text-slate-500">Beyan edilen indirim</div>
            <div className="text-xs font-bold text-slate-900">{formatRuble(report.claimedDiscount)}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Geçmişe göre gerçek</div>
            <div className="text-xs font-bold text-slate-900">{report.verifiedRealSaving === null ? '—' : formatRuble(Math.max(0, report.verifiedRealSaving))}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Şüpheli</div>
            <div className="text-xs font-black text-red-700">{formatRuble(report.suspiciousAmount)}</div>
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {report.findings.map((f, i) => (
            <FraudFindingCard key={i} finding={f} onOpenRelated={onOpenRelated} />
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onOpenRecord(record)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer hover:bg-slate-700"
            >
              Kaydı incele / karar ver
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiscountFraudDetectionPanel;
