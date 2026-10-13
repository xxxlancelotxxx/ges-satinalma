import React from 'react';
import {
  X,
  Trophy,
  Award,
  Zap,
  Flame,
  Users,
  Building2,
  ShieldCheck,
  Layers,
  FileText
} from 'lucide-react';
import { SupervisorGamificationProfile } from '../utils/leaderboardGamification';
import { formatRuble } from '../utils/format';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

interface Props {
  profile: SupervisorGamificationProfile | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SupervisorGamificationDetailModal: React.FC<Props> = ({
  profile,
  isOpen,
  onClose
}) => {
  useModalBackHandler(isOpen, onClose);

  if (!isOpen || !profile) return null;

  const raw = profile.rawMetrics;
  const norm = profile.normalizedScores;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/75 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Resimsiz, Sade ve Kurumsal */}
        <div className="relative bg-slate-900 text-white p-6 sm:p-7 border-b border-slate-800">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Kapat"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Metin Tabanlı Kurumsal Harf Rozeti */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-indigo-900/90 text-indigo-200 border-2 border-indigo-700/60 flex items-center justify-center font-black text-xl sm:text-2xl font-mono tracking-wider shadow-inner shrink-0">
              {profile.initials}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                  {profile.supervisorName}
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                  {profile.title}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-medium">
                  {profile.department}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-2">
                <span>Ekip: <strong className="text-slate-200">{profile.teamSize} Personel</strong></span>
                <span>•</span>
                <span>Toplam İşlem: <strong className="text-slate-200">{raw.totalTransactions}</strong></span>
                <span>•</span>
                <span>Toplam Harcama: <strong className="text-slate-200">{formatRuble(raw.totalSpend || Math.max(0, raw.totalListPrice - raw.totalSavings))}</strong></span>
                <span>•</span>
                <span>Kazanılan İndirim: <strong className="text-emerald-400">{formatRuble(raw.totalSavings)}</strong></span>
                <span>•</span>
                <span>Genel Sıralama: <strong className="text-amber-400">#{profile.mvpRank} MVP</strong></span>
              </div>
            </div>

            {/* Bileşik MVP Skoru */}
            <div className="w-full sm:w-auto bg-slate-800/90 rounded-xl p-4 border border-slate-700 text-center sm:text-right shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Bileşik MVP Skoru
              </div>
              <div className="text-3xl sm:text-4xl font-black text-amber-400 font-mono mt-0.5">
                {profile.mvpScore}
                <span className="text-xs text-slate-400 font-sans font-normal ml-1">/ 100</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Tüm Metriklerin Normalize Ağırlığı
              </div>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8 space-y-7 max-h-[calc(85vh-160px)] overflow-y-auto">
          {/* 5 Boyutlu Gerçek Efor & Katkı Skor Kartları */}
          <div>
            <div className="flex items-center justify-between mb-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <span>5 Boyutlu Normalize Efor ve Katkı Metrikleri</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">0 - 100 Min-Max Puanı</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
              {/* 1. Finansal İndirim Oranı & Tasarruf */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                    <span>İndirim Oranı & Tasarruf</span>
                    <span className="text-[10px] text-emerald-700 font-extrabold bg-emerald-100/80 px-1.5 py-0.5 rounded">
                      %{raw.savingsRatePct}
                    </span>
                  </div>

                  {/* Kazanılan İndirim */}
                  <div className="mt-1.5">
                    <span className="text-[10px] text-slate-400 block font-semibold">Kazanılan İndirim</span>
                    <div className="text-base font-black text-emerald-600 font-mono truncate" title={formatRuble(raw.totalSavings)}>
                      {formatRuble(raw.totalSavings)}
                    </div>
                  </div>

                  {/* Toplam Harcama (Sipariş Tutarı) */}
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">Toplam Harcama</span>
                    <div className="text-xs font-bold text-slate-800 font-mono truncate" title={formatRuble(raw.totalSpend || Math.max(0, raw.totalListPrice - raw.totalSavings))}>
                      {formatRuble(raw.totalSpend || Math.max(0, raw.totalListPrice - raw.totalSavings))}
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
                      Liste: {formatRuble(raw.totalListPrice)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold" title="Alınan indirim oranı yüzdesi (%85) odaklı, toplam harcama tutarından bağımsız adil finansal verimlilik skoru">
                      ADİL SKOR
                    </span>
                    <span className="text-xs font-black font-mono text-emerald-700">{norm.financialScore}/100</span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                    <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${norm.financialScore}%` }} />
                  </div>
                </div>
              </div>

              {/* 2. Gol (Bireysel İşlem) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Bireysel İşlem</div>
                <div className="text-base font-black text-slate-900 font-mono mt-1">
                  {raw.directGoalsCount} <span className="text-xs font-normal text-slate-500">İşlem</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  Katkı: {formatRuble(raw.directGoalsSavings)}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold">SKOR</span>
                  <span className="text-xs font-black font-mono text-indigo-700">{norm.goalsScore}/100</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${norm.goalsScore}%` }} />
                </div>
              </div>

              {/* 3. Müzakere Azmi */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Ort. Müzakere Turu</div>
                <div className="text-base font-black text-slate-900 font-mono mt-1">
                  {raw.avgNegotiationRounds.toFixed(1)} <span className="text-xs font-normal text-slate-500">Tur/İşlem</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {raw.totalNegotiationRounds > 0 ? `${raw.totalNegotiationRounds} Toplam Tur` : 'Pazarlık Turu Yok'}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold">SKOR</span>
                  <span className="text-xs font-black font-mono text-amber-700">{norm.roundsScore}/100</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div className="bg-amber-600 h-full rounded-full" style={{ width: `${norm.roundsScore}%` }} />
                </div>
              </div>

              {/* 4. Ekip Asisti */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Ekip Asisti</div>
                <div className="text-base font-black text-slate-900 font-mono mt-1">
                  {raw.teamAssistsCount} <span className="text-xs font-normal text-slate-500">Asist</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                  Katkı: {formatRuble(raw.teamAssistsSavings)}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold">SKOR</span>
                  <span className="text-xs font-black font-mono text-sky-700">{norm.assistsScore}/100</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div className="bg-sky-600 h-full rounded-full" style={{ width: `${norm.assistsScore}%` }} />
                </div>
              </div>

              {/* 5. Ağ Genişletme */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase">Yeni Tedarikçi</div>
                <div className="text-base font-black text-slate-900 font-mono mt-1">
                  {raw.newVendorsCount} <span className="text-xs font-normal text-slate-500">Firma</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Portföy Genişlemesi
                </div>
                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-bold">SKOR</span>
                  <span className="text-xs font-black font-mono text-purple-700">{norm.networkScore}/100</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div className="bg-purple-600 h-full rounded-full" style={{ width: `${norm.networkScore}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Gerçek İşlem Kayıtları & Ekip Dağılımı Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Gerçek En Yüksek İndirimli İşlemler (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  <span>En Yüksek İndirim Alınan İşlemler</span>
                </h4>
                <span className="text-[11px] text-slate-400">Gerçek Sistem Kayıtları</span>
              </div>

              {profile.flagshipDeals.length > 0 ? (
                <div className="space-y-2.5 flex-1">
                  {profile.flagshipDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {deal.vendorName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-medium">
                            {deal.category}
                          </span>
                          {deal.orderOrigin === 'asist' && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-100 text-sky-800 font-bold">
                              Asist: {deal.performedByName || 'Ekip'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                          <span>{deal.jobsiteName}</span>
                          <span>•</span>
                          <span className="font-medium text-amber-800">
                            {deal.roundsCount > 0 ? `${deal.roundsCount} Tur Görüşme` : 'Doğrudan Teklif (0 Tur)'}
                          </span>
                          {deal.date && (
                            <>
                              <span>•</span>
                              <span>{deal.date}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs sm:text-sm font-black text-emerald-700 font-mono">
                          {formatRuble(deal.discountAmount)}
                        </div>
                        <div className="text-[10px] font-bold text-slate-500">
                          %{deal.discountPercentage.toFixed(1)} İndirim
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
                  <FileText className="w-8 h-8 text-slate-300 mb-1.5" />
                  <span>Bu şefe ait sisteme girilmiş indirimli işlem kaydı bulunmuyor.</span>
                </div>
              )}
            </div>

            {/* Ekip Personel Katkısı (5 cols) */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-600" />
                  <span>Bağlı Satınalma Personeli ({profile.teamMembers.length})</span>
                </h4>
              </div>

              {profile.teamMembers.length > 0 ? (
                <div className="space-y-2 flex-1 overflow-y-auto max-h-64 pr-1">
                  {profile.teamMembers.map((member) => (
                    <div
                      key={member.id}
                      className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {member.name}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {member.title}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="inline-block px-2 py-0.5 rounded bg-sky-50 text-sky-700 text-xs font-mono font-bold border border-sky-200">
                          {member.assistsCount} Asist
                        </span>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {formatRuble(member.savingsContributed)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
                  <Users className="w-8 h-8 text-slate-300 mb-1.5" />
                  <span>Bu şefe bağlı atanmış satınalma personeli bulunmuyor.</span>
                </div>
              )}

              {/* Yeni Eklenen Tedarikçiler */}
              {raw.newVendorNames.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-[11px] font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-purple-600" />
                    <span>Sisteme Kazandırılan Tedarikçiler ({raw.newVendorNames.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {raw.newVendorNames.map((v, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 font-medium"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Gerçek işlem kayıtları üzerinden anlık olarak doğrulanmıştır.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
