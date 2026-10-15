import React from 'react';
import {
  X,
  FileSpreadsheet,
  Building2,
  UserCheck,
  Calendar,
  Scale,
  TrendingDown,
  FileText,
  Layers,
  CheckCircle2,
  ExternalLink,
  Boxes,
  Edit3,
  Award
} from 'lucide-react';
import { ComparativeAnalysisRecord } from '../types';
import { formatRuble, openOriginalFileViewer } from '../utils/format';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  analysis: ComparativeAnalysisRecord | null;
  onEdit?: (analysis: ComparativeAnalysisRecord) => void;
  onDelete?: (id: string) => void;
}

export const ComparativeAnalysisDetailModal: React.FC<Props> = ({
  isOpen,
  onClose,
  analysis,
  onEdit,
  onDelete
}) => {
  const { language } = useLanguage();
  const isRu = language === 'ru';

  if (!isOpen || !analysis) return null;

  const sav = Number(analysis.realMarketSavings ?? analysis.summary?.realMarketSavings ?? 0);
  const fin = Number(analysis.totalFinalPurchase ?? analysis.summary?.finalPurchaseAmount ?? 0);
  const init = Number(analysis.totalInitialLowestOffer ?? analysis.summary?.lowestInitialOfferAmount ?? (fin + sav));
  const rate = Number(analysis.realSavingsRate ?? analysis.summary?.realSavingsPercentage ?? (init > 0 ? (sav / init) * 100 : 0));
  const rounds = analysis.negotiationRoundsCount || (analysis.negotiationStages ? analysis.negotiationStages.length : 1);

  const finalDoc = (analysis.documents || []).find(d => !d.isExcluded && (d.documentRole === 'FINAL_INVOICE' || d.documentRole === 'FINAL_OFFER'));
  const invNo =
    analysis.finalInvoice?.documentNumber ||
    analysis.finalInvoiceDetails?.invoiceNumber ||
    analysis.summary?.finalInvoiceNumber ||
    finalDoc?.documentNumber ||
    analysis.invoiceNo ||
    'TDF';
  const dt = (
    analysis.date ||
    analysis.finalInvoice?.date ||
    analysis.finalInvoiceDetails?.date ||
    finalDoc?.date ||
    analysis.created_at ||
    ''
  ).split('T')[0];

  const lowestSupplier =
    analysis.lowestInitialOfferSupplier ||
    analysis.summary?.lowestInitialOfferSupplier ||
    (analysis.initialOffers && analysis.initialOffers.length > 0 ? analysis.initialOffers[0]?.supplier : '-');

  const materials = analysis.canonicalMaterials || [];
  const documents = (analysis.documents || []).filter(d => !d.isExcluded);
  const stages = analysis.negotiationStages || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-6xl my-auto overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 font-bold shrink-0">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold bg-indigo-500/30 text-indigo-200 px-2.5 py-0.5 rounded-full border border-indigo-400/40">
                  {isRu ? 'TDF Детальная Оценка КП' : 'TDF Karşılaştırmalı Teklif Değerlendirme Detayı'}
                </span>
                {dt && (
                  <span className="text-xs text-slate-300 font-mono">
                    • {dt}
                  </span>
                )}
              </div>
              <h2 className="text-lg sm:text-xl font-black text-white mt-0.5 flex flex-wrap items-center gap-2">
                <span>{analysis.winningSupplier || finalDoc?.supplier || 'Seçilen Tedarikçi Firma'}</span>
                {invNo && invNo !== 'TDF' && (
                  <span className="text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-lg border border-emerald-400/30">
                    Fatura No: {invNo}
                  </span>
                )}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(analysis);
                }}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isRu ? 'Редактировать TDF' : 'Analizi Düzenle'}</span>
              </button>
            )}

            <a
              href={`/api/comparative-analyses/${analysis.id}/excel`}
              download
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{isRu ? 'Скачать Excel' : 'Excel İndir'}</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 transition cursor-pointer"
              title={isRu ? 'Закрыть' : 'Kapat'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 bg-slate-50/50">
          {/* Top Metadata + Financial KPI Ribbon */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-xs flex items-center space-x-3">
              <Building2 className="w-8 h-8 text-indigo-600 shrink-0 bg-indigo-50 p-1.5 rounded-xl border border-indigo-100" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {isRu ? 'Объект' : 'Şantiye / Proje'}
                </div>
                <div className="text-xs font-extrabold text-slate-800 truncate" title={analysis.jobsiteName}>
                  {analysis.jobsiteName || 'Genel Şantiye'}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-slate-200/90 shadow-xs flex items-center space-x-3">
              <UserCheck className="w-8 h-8 text-indigo-600 shrink-0 bg-indigo-50 p-1.5 rounded-xl border border-indigo-100" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {isRu ? 'Шеф закупок' : 'Sorumlu Şef'}
                </div>
                <div className="text-xs font-extrabold text-slate-800 truncate">
                  {analysis.supervisorName || '-'}
                </div>
                {analysis.performedByPersonnelName && (
                  <div className="text-[10px] font-semibold text-indigo-600 truncate">
                    {analysis.performedByPersonnelName}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-indigo-200 shadow-xs">
              <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                {isRu ? 'База первых КП (Dip Fiyat)' : 'En Düşük İlk Teklif (Dip Fiyat)'}
              </div>
              <div className="text-base sm:text-lg font-black text-indigo-950 font-mono mt-0.5">
                {formatRuble(init)}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {lowestSupplier}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                {isRu ? 'Окончательный счет' : 'Nihai Anlaşılan Fatura'}
              </div>
              <div className="text-base sm:text-lg font-black text-slate-900 font-mono mt-0.5">
                {formatRuble(fin)}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {analysis.winningSupplier || '-'}
              </div>
            </div>

            <div className="bg-emerald-50 rounded-2xl p-3.5 border border-emerald-200 shadow-xs">
              <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                {isRu ? 'Чистая экономия' : 'Net Dip Fiyat Tasarrufu'}
              </div>
              <div className="text-base sm:text-lg font-black text-emerald-700 font-mono mt-0.5">
                {formatRuble(sav)}
              </div>
              <div className="text-[10px] text-emerald-700 font-semibold">
                {rounds} {isRu ? 'тур переговоров' : 'Pazarlık Turu'}
              </div>
            </div>

            <div className="bg-indigo-50 rounded-2xl p-3.5 border border-indigo-200 shadow-xs">
              <div className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">
                {isRu ? 'Процент скидки' : 'Dip Fiyattan İndirim %'}
              </div>
              <div className="text-base sm:text-lg font-black text-indigo-700 font-mono mt-0.5">
                %{rate.toFixed(2)}
              </div>
              <div className="text-[10px] text-indigo-700 font-semibold">
                {isRu ? 'Реальный эффект' : 'Gerçek pazarlık başarısı'}
              </div>
            </div>
          </div>

          {/* 1. Uploaded Documents & Offers Breakdown */}
          {documents.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  <span>{isRu ? '1. Загруженные КП, раунды торга и финальный счет' : '1. Yüklenen Teklifler & Fatura Belgeleri (İlk Teklifler, Ara Pazarlık ve Son Fatura)'}</span>
                </h4>
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                  {documents.length} {isRu ? 'документов' : 'Belge'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {documents.map((doc, idx) => {
                  const isFinal = doc.documentRole === 'FINAL_INVOICE' || doc.documentRole === 'FINAL_OFFER';
                  const isRevision = doc.documentRole === 'REVISION_OFFER';
                  const isLowestInitial =
                    !isFinal &&
                    !isRevision &&
                    Math.abs(Number(doc.totalAmount || 0) - init) < 5;

                  return (
                    <div
                      key={doc.id || idx}
                      className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all ${
                        isFinal
                          ? 'bg-emerald-50/70 border-emerald-300 shadow-xs'
                          : isLowestInitial
                          ? 'bg-indigo-50/70 border-indigo-300 shadow-xs'
                          : isRevision
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-slate-50/70 border-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                              isFinal
                                ? 'bg-emerald-600 text-white'
                                : isLowestInitial
                                ? 'bg-indigo-600 text-white'
                                : isRevision
                                ? 'bg-amber-500 text-white'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isFinal
                              ? (isRu ? 'ФИНАЛЬНЫЙ СЧЕТ (ПОБЕДИТЕЛЬ)' : 'SON ANLAŞILAN FATURA (KAZANAN)')
                              : isLowestInitial
                              ? (isRu ? 'МИН. ПЕРВОЕ КП (DIP FIYAT)' : 'İLK TEKLİF (DİP FİYAT REFERANSI)')
                              : isRevision
                              ? (isRu ? `РАУНД ТОРГА #${doc.roundNumber || 2}` : `ARA PAZARLIK TEKLİFİ (TUR #${doc.roundNumber || 2})`)
                              : (isRu ? 'ПЕРВОЕ КП' : 'RAKİP İLK TEKLİF')}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {doc.date || dt}
                          </span>
                        </div>

                        <div className="font-extrabold text-slate-900 text-sm truncate" title={doc.supplier}>
                          {doc.supplier || 'Tedarikçi Firma'}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                          Belge No: {doc.documentNumber || '-'} • {(doc.items || []).length} Kalem
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/70">
                        <div className="font-mono font-black text-base text-slate-900">
                          {formatRuble(Number(doc.totalAmount || 0))}
                        </div>
                        {doc.fileUrl && (
                          <button
                            type="button"
                            onClick={() => openOriginalFileViewer(doc.fileUrl!, doc.fileName || doc.supplier || 'Belge')}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold shadow-2xs cursor-pointer transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>{isRu ? 'Открыть документ' : 'Belgeyi Aç'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Negotiation Stages Timeline */}
          {stages.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
              <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center space-x-2">
                <TrendingDown className="w-4 h-4 text-emerald-600" />
                <span>{isRu ? '2. Хронология раундов переговоров' : '2. Pazarlık Turları & Fiyat Düşüş Zaman Çizelgesi'}</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {stages.map((st, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold text-indigo-600 uppercase">
                        {st.stageNumber}. Aşama — {st.label}
                      </div>
                      <div className="text-xs font-bold text-slate-800 truncate max-w-[180px]" title={st.supplier}>
                        {st.supplier}
                      </div>
                      {st.dropFromPreviousAmount && st.dropFromPreviousAmount > 0 ? (
                        <div className="text-[10px] font-bold text-emerald-600 mt-0.5">
                          ↓ -{formatRuble(st.dropFromPreviousAmount)} (%{Number(st.dropFromPreviousRate || 0).toFixed(1)})
                        </div>
                      ) : null}
                    </div>
                    <div className="font-mono font-black text-sm text-slate-900">
                      {formatRuble(st.totalAmount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Canonical Material Unit Price Comparison Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Boxes className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
                  {isRu ? '3. Матрица сопоставления единичных цен по позициям' : '3. Birim Fiyat & Birim Eşdeğerlik Matrisi (Kalem Bazlı Dip Fiyat Kıyaslaması)'}
                </h4>
              </div>
              <span className="text-xs font-bold text-slate-600 bg-slate-200/80 px-2.5 py-0.5 rounded-full">
                {materials.length} {isRu ? 'позиций' : 'Kalem'}
              </span>
            </div>

            {materials.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                      <th className="py-2.5 px-4">{isRu ? 'Материал' : 'Standart Malzeme Adı'}</th>
                      <th className="py-2.5 px-3 text-center">{isRu ? 'Ед.' : 'Birim'}</th>
                      <th className="py-2.5 px-3 text-right">{isRu ? 'Кол-во' : 'Alınan Miktar'}</th>
                      <th className="py-2.5 px-3 text-right">{isRu ? 'Мин. КП (Dip Birim)' : 'En Düşük İlk Teklif (Dip Birim)'}</th>
                      <th className="py-2.5 px-3 text-right">{isRu ? 'Финальная цена' : 'Son Anlaşılan Birim Fiyat'}</th>
                      <th className="py-2.5 px-3 text-right">{isRu ? 'Чистая экономия' : 'Kalem Net Tasarrufu'}</th>
                      <th className="py-2.5 px-4">{isRu ? 'Предложения поставщиков' : 'Tedarikçi Birim Fiyat Dağılımı'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {materials.map((m, mIdx) => {
                      const refUnit = Number(m.marketReferenceUnitPrice || 0);
                      const finUnit = Number(m.purchasedUnitPrice || 0);
                      const qty = Number(m.purchasedQuantity || m.quantity || 0);
                      const rowSav = Number(m.realSavingsAmount ?? Math.max(0, (refUnit - finUnit) * qty));

                      return (
                        <tr key={m.materialKey || mIdx} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-4 font-bold text-slate-800">
                            <div>{m.canonicalName || m.commonName}</div>
                            {m.specificationNote && (
                              <div className="text-[10px] text-indigo-600 font-normal">{m.specificationNote}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                            {m.standardUnit || 'Adet'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-800">
                            {qty.toLocaleString('tr-TR')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            <div className="font-bold text-indigo-900">{formatRuble(refUnit)}</div>
                            <div className="text-[10px] text-slate-500">{m.marketReferenceSupplier || lowestSupplier}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            <div className="font-bold text-slate-900">{formatRuble(finUnit)}</div>
                            <div className="text-[10px] text-emerald-700">{m.purchasedSupplier || analysis.winningSupplier}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-600">
                            {formatRuble(rowSav)}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex flex-wrap gap-1.5">
                              {(m.lines || []).map((ln, lIdx) => (
                                <span
                                  key={lIdx}
                                  className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] text-slate-700 font-mono"
                                  title={ln.conversionFormula || ln.originalName}
                                >
                                  <strong>{ln.supplier}:</strong> {formatRuble(ln.standardUnitPrice || ln.unitPrice)}/{m.standardUnit}
                                  {ln.conversionApplied && ln.conversionFormula ? ` (${ln.conversionFormula})` : ''}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                {isRu ? 'Нет детализации по отдельным позициям' : 'Detaylı malzeme kalemi bulunamadı.'}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2">
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  onDelete(analysis.id);
                  onClose();
                }}
                className="px-4 py-2 bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                {isRu ? 'Удалить запись' : 'Analizi Sil'}
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2.5">
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(analysis);
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isRu ? 'Редактировать' : 'Düzenle'}</span>
              </button>
            )}
            <a
              href={`/api/comparative-analyses/${analysis.id}/excel`}
              download
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isRu ? 'Скачать Excel' : 'Excel İndir'}</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              {isRu ? 'Закрыть' : 'Kapat'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

