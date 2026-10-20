import React, { useState, useMemo } from 'react';
import {
  Trophy,
  Award,
  Zap,
  Flame,
  Users,
  Building2,
  Coins,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Info,
  ShieldCheck,
  ArrowUpRight,
  Eye,
  RotateCcw,
  FileQuestion
} from 'lucide-react';
import {
  calculateLeaderboardScores,
  DEFAULT_LEADERBOARD_WEIGHTS,
  LeaderboardCategory,
  LeaderboardWeightConfig,
  SupervisorGamificationProfile
} from '../utils/leaderboardGamification';
import { DiscountRecord, PurchasingSupervisor, Personnel, InvoiceRecord } from '../types';
import { formatRuble } from '../utils/format';
import { SupervisorGamificationDetailModal } from './SupervisorGamificationDetailModal';

// Kolayca değiştirilebilir başlangıç ağırlık konfigürasyonu (Toplam %100)
const INITIAL_LEADERBOARD_WEIGHTS: LeaderboardWeightConfig = {
  individualGoals: 0.25,   // %25 Bireysel GOL Sayısı (Doğrudan masada kazanılan doğrudan indirimler)
  teamAssists: 0.20,       // %20 Ekip Asistleri (Organizasyonel yönlendirme ve asist hacmi)
  financialSavings: 0.25,  // %25 Alınan İndirim Oranı ve Finansal Verimlilik (İskonto %60, Hacim %25, İstikrar %15)
  negotiationRounds: 0.15, // %15 Müzakere Tur Sayısı (Pazarlık azmi ve çok turlu çetin görüşmeler)
  networkExpansion: 0.15   // %15 Yeni Tedarikçi Katkısı (Alternatif tedarikçi portföyü ve tekel kırma)
};

interface Props {
  discounts: DiscountRecord[];
  supervisors: PurchasingSupervisor[];
  personnel?: Personnel[];
  invoices?: InvoiceRecord[];
  onNavigateToTab?: (tabId: string) => void;
}

export const GamifiedSupervisorLeaderboard: React.FC<Props> = ({
  discounts = [],
  supervisors = [],
  personnel = [],
  invoices = [],
  onNavigateToTab
}) => {
  const [activeCategory, setActiveCategory] = useState<LeaderboardCategory>('MVP');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProfile, setSelectedProfile] = useState<SupervisorGamificationProfile | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [showWeightConfig, setShowWeightConfig] = useState(false);
  const [weights, setWeights] = useState<LeaderboardWeightConfig>(INITIAL_LEADERBOARD_WEIGHTS);

  // Dışarıdan gelen gerçek veri kayıtları üzerinden anlık dinamik hesaplama
  const allProfiles = useMemo(() => {
    return calculateLeaderboardScores(
      discounts,
      supervisors,
      personnel,
      invoices,
      weights,
      activeCategory
    );
  }, [discounts, supervisors, personnel, invoices, weights, activeCategory]);

  // Arama filtresi
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return allProfiles;
    const q = searchQuery.toLowerCase().trim();
    return allProfiles.filter(p =>
      p.supervisorName.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.department.toLowerCase().includes(q)
    );
  }, [allProfiles, searchQuery]);

  // Tablo ve kartların ortak tek veri kaynağı (filtrelenmiş ve sıralanmış liste)
  const leaderboard = filteredProfiles;

  const handleInspect = (profile: SupervisorGamificationProfile) => {
    setSelectedProfile(profile);
    setIsDetailModalOpen(true);
  };

  const handleResetWeights = () => {
    setWeights(INITIAL_LEADERBOARD_WEIGHTS);
  };

  const categoryTabs: Array<{ id: LeaderboardCategory; label: string; icon: any; desc: string }> = [
    { id: 'MVP', label: 'Genel MVP', icon: Trophy, desc: 'Tüm metriklerin 0-100 normalize ağırlıklı toplamı' },
    { id: 'FINANCIAL_SAVINGS', label: 'İndirim Oranı & Tasarruf', icon: Coins, desc: 'Alınan indirim oranı yüzdesi (%85) ve istikrarlı reel nakit tasarrufu (%15)' },
    { id: 'GOL', label: 'Bireysel GOL Krallığı', icon: Zap, desc: 'Şefin bizzat masaya oturup kopardığı indirim sayısı ve azmi' },
    { id: 'ASIST', label: 'Asist Krallığı', icon: Users, desc: 'Ekip uzmanlarının kazandırdığı indirim işlemleri' },
    { id: 'NEGOTIATION_ROUNDS', label: 'Müzakere Turu', icon: Flame, desc: 'İşlem başına düşen ortalama pazarlık tur sayısı' },
    { id: 'NETWORK_EXPANSION', label: 'Tedarik Ağı', icon: Building2, desc: 'Sisteme kazandırılan yeni onaylı firma sayısı' },
  ];

  // Eğer sistemde şef veya fatura kaydı hiç yoksa Empty State göster
  const hasAnyData = supervisors.length > 0 && discounts.length > 0;

  return (
    <div className="w-full bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
      {/* 1. Üst Başlık ve Filtre Seçenekleri */}
      <div className="p-5 sm:p-6 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-slate-900 text-amber-400 shadow-xs">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
                  <span>Şefler Arası Tasarruf & Rekabet Sıralaması</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-bold">
                    Dinamik Efor Motoru
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  İşlem adedi, ortalama müzakere turu, ekip asisti, yeni tedarikçi ve tasarruf hacminin normalize analizi
                </p>
              </div>
            </div>
          </div>

          {/* Kontrol Butonları */}
          <div className="flex items-center space-x-2 self-start lg:self-auto">
            <button
              onClick={() => setShowWeightConfig(!showWeightConfig)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors flex items-center space-x-1.5 cursor-pointer ${
                showWeightConfig
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
              <span>Ağırlık Katsayıları</span>
            </button>

            {onNavigateToTab && (
              <button
                onClick={() => onNavigateToTab('performance')}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>Detaylı Karne</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Canlı Ağırlık Katsayı Paneli */}
        {showWeightConfig && (
          <div className="mt-4 p-4 bg-slate-900 text-white rounded-xl border border-slate-800 shadow-sm animate-in fade-in duration-100">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-slate-200">MVP Puanlama Ağırlıkları (Toplam %100)</span>
              </div>
              <button
                onClick={handleResetWeights}
                className="text-[11px] text-slate-400 hover:text-white flex items-center space-x-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Varsayılana Sıfırla</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Bireysel Gol Krallığı</div>
                <div className="text-base font-black text-indigo-400 font-mono mt-0.5">
                  %{Math.round((weights.individualGoals ?? 0.25) * 100)}
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.50"
                  step="0.05"
                  value={weights.individualGoals}
                  onChange={(e) => setWeights({ ...weights, individualGoals: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500 mt-1 cursor-pointer"
                />
              </div>

              <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Ekip Asisti & Liderlik</div>
                <div className="text-base font-black text-sky-400 font-mono mt-0.5">
                  %{Math.round((weights.teamAssists ?? 0.20) * 100)}
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.40"
                  step="0.05"
                  value={weights.teamAssists}
                  onChange={(e) => setWeights({ ...weights, teamAssists: parseFloat(e.target.value) })}
                  className="w-full accent-sky-500 mt-1 cursor-pointer"
                />
              </div>

              <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700">
                <div className="text-[10px] text-slate-400 font-bold uppercase">İndirim Oranı & Finansal</div>
                <div className="text-base font-black text-emerald-400 font-mono mt-0.5">
                  %{Math.round((weights.financialSavings ?? 0.25) * 100)}
                </div>
                <input
                  type="range"
                  min="0.10"
                  max="0.60"
                  step="0.05"
                  value={weights.financialSavings}
                  onChange={(e) => setWeights({ ...weights, financialSavings: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500 mt-1 cursor-pointer"
                />
              </div>

              <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Müzakere Turları & Azim</div>
                <div className="text-base font-black text-amber-400 font-mono mt-0.5">
                  %{Math.round((weights.negotiationRounds ?? 0.15) * 100)}
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.35"
                  step="0.05"
                  value={weights.negotiationRounds}
                  onChange={(e) => setWeights({ ...weights, negotiationRounds: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500 mt-1 cursor-pointer"
                />
              </div>

              <div className="bg-slate-800 p-2.5 rounded-lg border border-slate-700">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Yeni Tedarikçi Portföyü</div>
                <div className="text-base font-black text-purple-400 font-mono mt-0.5">
                  %{Math.round((weights.networkExpansion ?? 0.15) * 100)}
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.35"
                  step="0.05"
                  value={weights.networkExpansion ?? 0.15}
                  onChange={(e) => setWeights({ ...weights, networkExpansion: parseFloat(e.target.value) })}
                  className="w-full accent-purple-500 mt-1 cursor-pointer"
                />
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
              <div>
                * MVP Puanlama Sistemi; Bireysel masada kopardığı doğrudan indirimler (%25), yönettiği ekibin kazandırdığı asist hacmi (%20), alınan indirim oranı ve finansal verimlilik (%25), çok turlu çetin müzakere azmi (%15) ve portföye kazandırılan yeni tedarikçiler (%15) ile hem operasyonel eforu hem de iskonto başarısını adil ve dengeli şekilde ödüllendirir.
              </div>
              <div className="shrink-0 font-mono font-bold text-slate-300">
                Toplam Ağırlık: %{Math.round(((weights.financialSavings ?? 0) + (weights.individualGoals ?? 0) + (weights.negotiationRounds ?? 0) + (weights.teamAssists ?? 0) + (weights.networkExpansion ?? 0)) * 100)}
              </div>
            </div>
          </div>
        )}

        {/* Kategori Filtre Butonları */}
        <div className="flex items-center gap-1.5 mt-4 overflow-x-auto pb-1 scrollbar-none">
          {categoryTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeCategory === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                title={tab.desc}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center space-x-1.5 cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Veri Yoksa Profesyonel Empty State */}
      {!hasAnyData ? (
        <div className="p-12 text-center flex flex-col items-center justify-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
            <FileQuestion className="w-7 h-7" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">Henüz Veri Kaydı Bulunmuyor</h3>
          <p className="text-xs text-slate-500 max-w-md mt-1">
            Sisteme eklenen gerçek fatura ve indirim kayıtları doğrultusunda şef performans, müzakere azmi ve rekabet skorları anlık olarak burada listelenecektir.
          </p>
        </div>
      ) : (
        <>
          {/* 2. Resimsiz, Sade Podyum Vitrini (İlk 3 Sıra) */}
          <div className="p-5 sm:p-6 bg-white border-b border-slate-200/80">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>{categoryTabs.find(t => t.id === activeCategory)?.label} Zirve Sıralaması</span>
              </span>
              <span className="text-[11px] text-slate-400">
                Gerçekleşen kayıtlardan canlı hesaplanmıştır
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
              {/* 1. Sıra (Zirve Lideri) */}
              {leaderboard[0] && (
                <div
                  onClick={() => handleInspect(leaderboard[0])}
                  className="bg-amber-50/40 rounded-xl p-4 sm:p-5 border-2 border-amber-300 shadow-xs hover:border-amber-400 hover:bg-amber-50/60 transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-xl bg-amber-400 text-amber-950 border border-amber-500 flex items-center justify-center font-black text-base font-mono shrink-0 shadow-2xs">
                        {leaderboard[0].initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase font-bold text-amber-700 flex items-center gap-1">
                          <Trophy className="w-3.5 h-3.5 text-amber-600 inline" />
                          <span>#{leaderboard[0].categoryRank} {activeCategory === 'MVP' ? 'GENEL MVP ZİRVE LİDERİ' : 'ZİRVE LİDERİ'}</span>
                        </div>
                        <h4 className="text-base font-black text-slate-900 truncate">
                          {leaderboard[0].supervisorName}
                        </h4>
                        <p className="text-xs text-slate-600 truncate">{leaderboard[0].title}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-amber-200 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-amber-800 uppercase font-bold">Kategori Başarısı</div>
                      <div className="text-base font-black text-slate-900 font-mono">
                        {leaderboard[0].categoryDisplayValue}
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium mt-1">
                        İndirimli Alım: <strong className="text-slate-900 font-mono">{formatRuble(leaderboard[0].rawMetrics.totalSpend || Math.max(0, leaderboard[0].rawMetrics.totalListPrice - leaderboard[0].rawMetrics.totalSavings))}</strong>
                      </div>
                      <div className="text-[10px] text-emerald-800 font-bold flex items-center gap-1 mt-0.5">
                        <span>Tasarruf: +{formatRuble(leaderboard[0].rawMetrics.totalSavings)}</span>
                        <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-850 rounded font-mono font-bold">%{leaderboard[0].rawMetrics.savingsRatePct} İndirim</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-amber-800 uppercase font-bold">Genel MVP</div>
                      <div className="text-base font-black text-amber-900 font-mono">
                        {leaderboard[0].mvpScore}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Sıra */}
              {leaderboard[1] && (
                <div
                  onClick={() => handleInspect(leaderboard[1])}
                  className="bg-slate-50/70 rounded-xl p-4 border border-slate-200 hover:border-slate-300 hover:bg-slate-100/60 transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-11 h-11 rounded-xl bg-slate-200 text-slate-700 border border-slate-300 flex items-center justify-center font-bold text-sm font-mono shrink-0">
                        {leaderboard[1].initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase font-bold text-slate-400">#{leaderboard[1].categoryRank} Sıra</div>
                        <h4 className="text-sm font-bold text-slate-900 truncate">
                          {leaderboard[1].supervisorName}
                        </h4>
                        <p className="text-[11px] text-slate-500 truncate">{leaderboard[1].title}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Kategori Değeri</div>
                      <div className="text-sm font-black text-slate-900 font-mono">
                        {leaderboard[1].categoryDisplayValue}
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium mt-1">
                        İndirimli Alım: <strong className="text-slate-900 font-mono">{formatRuble(leaderboard[1].rawMetrics.totalSpend || Math.max(0, leaderboard[1].rawMetrics.totalListPrice - leaderboard[1].rawMetrics.totalSavings))}</strong>
                      </div>
                      <div className="text-[10px] text-emerald-800 font-bold flex items-center gap-1 mt-0.5">
                        <span>Tasarruf: +{formatRuble(leaderboard[1].rawMetrics.totalSavings)}</span>
                        <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-850 rounded font-mono font-bold">%{leaderboard[1].rawMetrics.savingsRatePct} İndirim</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Genel MVP</div>
                      <div className="text-sm font-black text-indigo-600 font-mono">
                        {leaderboard[1].mvpScore}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Sıra */}
              {leaderboard[2] && (
                <div
                  onClick={() => handleInspect(leaderboard[2])}
                  className="bg-slate-50/70 rounded-xl p-4 border border-slate-200 hover:border-slate-300 hover:bg-slate-100/60 transition-colors cursor-pointer flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-900 border border-amber-200 flex items-center justify-center font-bold text-sm font-mono shrink-0">
                        {leaderboard[2].initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase font-bold text-slate-400">#{leaderboard[2].categoryRank} Sıra</div>
                        <h4 className="text-sm font-bold text-slate-900 truncate">
                          {leaderboard[2].supervisorName}
                        </h4>
                        <p className="text-[11px] text-slate-500 truncate">{leaderboard[2].title}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Kategori Değeri</div>
                      <div className="text-sm font-black text-slate-900 font-mono">
                        {leaderboard[2].categoryDisplayValue}
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium mt-1">
                        İndirimli Alım: <strong className="text-slate-900 font-mono">{formatRuble(leaderboard[2].rawMetrics.totalSpend || Math.max(0, leaderboard[2].rawMetrics.totalListPrice - leaderboard[2].rawMetrics.totalSavings))}</strong>
                      </div>
                      <div className="text-[10px] text-emerald-800 font-bold flex items-center gap-1 mt-0.5">
                        <span>Tasarruf: +{formatRuble(leaderboard[2].rawMetrics.totalSavings)}</span>
                        <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-850 rounded font-mono font-bold">%{leaderboard[2].rawMetrics.savingsRatePct} İndirim</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Genel MVP</div>
                      <div className="text-sm font-black text-indigo-600 font-mono">
                        {leaderboard[2].mvpScore}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Detaylı Kurumsal Tablo */}
          <div className="p-5 sm:p-6 flex-1 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Şef Performans ve Efor Matrisi
                </h3>
                <p className="text-xs text-slate-500">
                  Sistemdeki tüm kayıtların gerçek dökümü ({leaderboard.length} Şef)
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Şef veya unvan ara..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 bg-white"
                />
              </div>
            </div>

            {/* Tablo */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <th className="py-3 px-3 w-12 text-center">Sıra</th>
                    <th className="py-3 px-3 min-w-[180px]">Şef & Unvan</th>
                    <th className="py-3 px-3 text-center min-w-[90px]">
                      <span className="flex items-center justify-center space-x-1">
                        <Trophy className="w-3.5 h-3.5 text-amber-500" />
                        <span>MVP</span>
                      </span>
                    </th>
                    <th className="py-3 px-3 text-right min-w-[170px]">
                      <div className="flex flex-col items-end">
                        <span>İndirimli Alım & Tasarruf (₽)</span>
                        <span className="text-[10px] font-normal text-slate-400">İndirimli Faturalar & Alınan İskonto</span>
                      </div>
                    </th>
                    <th className="py-3 px-3 text-center min-w-[95px]">Bireysel Gol</th>
                    <th className="py-3 px-3 text-center min-w-[90px]">Ekip Asisti</th>
                    <th className="py-3 px-3 text-center min-w-[95px]">Pazarlık Turu</th>
                    <th className="py-3 px-3 text-center min-w-[90px]">Yeni Firma</th>
                    <th className="py-3 px-3 text-right w-16">Detay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {leaderboard.map((p) => (
                    <tr
                      key={p.supervisorId}
                      onClick={() => handleInspect(p)}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                        p.categoryRank === 1 ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Sıra Numarası */}
                      <td className="py-3 px-3 text-center font-bold">
                        <span className="font-mono text-slate-700">#{p.categoryRank}</span>
                      </td>

                      {/* Şef Bilgisi (Resimsiz, Metin Tabanlı Harf Rozeti) */}
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-center font-bold text-xs font-mono shrink-0">
                            {p.initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 truncate">
                              {p.supervisorName}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate flex items-center space-x-1">
                              <span>{p.title}</span>
                              <span>•</span>
                              <span>{p.teamSize} Personel</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* MVP Skor Barı */}
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className="font-mono font-black text-sm text-slate-900">
                            {p.mvpScore}
                          </span>
                          <div className="w-14 bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-indigo-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, p.mvpScore)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Toplam Tasarruf & İndirimli Alım */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-mono font-black text-emerald-700">
                          +{formatRuble(p.rawMetrics.totalSavings)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium truncate">
                          İndirimli Alım: <span className="font-mono text-slate-800 font-semibold">{formatRuble(p.rawMetrics.totalSpend || Math.max(0, p.rawMetrics.totalListPrice - p.rawMetrics.totalSavings))}</span>
                        </div>
                        <div className="mt-0.5">
                          <span className="text-[10px] font-bold inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            %{p.rawMetrics.savingsRatePct} İskonto
                          </span>
                        </div>
                      </td>

                      {/* Bireysel Gol */}
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono font-bold">
                          {p.rawMetrics.directGoalsCount}
                        </span>
                      </td>

                      {/* Ekip Asisti */}
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded bg-sky-50 text-sky-800 font-mono font-bold border border-sky-100">
                          {p.rawMetrics.teamAssistsCount}
                        </span>
                      </td>

                      {/* Pazarlık Turu */}
                      <td className="py-3 px-3 text-center">
                        <div className="font-mono font-bold text-amber-800">
                          {p.rawMetrics.totalNegotiationRounds > 0 ? `${p.rawMetrics.totalNegotiationRounds} Tur` : '0 Tur'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.rawMetrics.negotiatedDealsCount > 0
                            ? `${p.rawMetrics.negotiatedDealsCount} işlemde`
                            : 'Doğrudan'}
                        </div>
                      </td>

                      {/* Yeni Tedarikçi */}
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2.5 py-0.5 rounded bg-purple-50 text-purple-800 font-mono font-bold border border-purple-100">
                          +{p.rawMetrics.newVendorsCount}
                        </span>
                      </td>

                      {/* İşlem İncele Butonu */}
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInspect(p);
                          }}
                          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-600 transition-colors cursor-pointer"
                          title="Tüm efor dökümünü incele"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bilgilendirme */}
            <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Sıralama ve efor skorları, dışarıdan aktarılan gerçek fatura kayıtları ve alt personel eşleşmelerinden canlı olarak hesaplanmaktadır.
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 shrink-0 ml-3">
                0-100 Min-Max Puanlama
              </span>
            </div>
          </div>
        </>
      )}

      {/* Şef Efor Detay Modalı */}
      <SupervisorGamificationDetailModal
        profile={selectedProfile}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedProfile(null);
        }}
      />
    </div>
  );
};
