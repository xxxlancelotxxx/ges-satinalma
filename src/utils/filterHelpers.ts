/**
 * Evrensel Filtreleme ve Tarih Yardımcıları
 * (Universal Filter & Date Preset Helpers)
 */

export interface DateFilterState {
  preset: string; // 'all' | 'today' | 'this_week' | 'this_month' | 'last_month' | 'last_30_days' | 'last_90_days' | 'year_2026' | 'year_2025' | 'custom';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export const DATE_PRESETS = [
  { key: 'all', label: 'Tüm Tarihler' },
  { key: 'this_month', label: 'Bu Ay' },
  { key: 'last_month', label: 'Geçen Ay' },
  { key: 'last_30_days', label: 'Son 30 Gün' },
  { key: 'last_90_days', label: 'Son 90 Gün' },
  { key: 'year_2026', label: '2026 Yılı' },
  { key: 'year_2025', label: '2025 Yılı' }
];

export function matchesDateFilter(rawDate?: string, filter?: DateFilterState): boolean {
  if (!filter || !filter.preset || filter.preset === 'all') return true;
  if (!rawDate) return false;

  // Extract YYYY-MM-DD from raw string
  const clean = String(rawDate).trim();
  let dateStr = clean;
  if (clean.includes('T')) {
    dateStr = clean.split('T')[0];
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('.');
    dateStr = `${y}-${m}-${d}`;
  }

  const recTime = new Date(dateStr).getTime();
  if (isNaN(recTime)) return true;

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth(); // 0-indexed

  switch (filter.preset) {
    case 'today': {
      const todayStr = now.toISOString().split('T')[0];
      return dateStr === todayStr;
    }
    case 'this_week': {
      const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
      return recTime >= sevenDaysAgo;
    }
    case 'this_month': {
      const curYearMonth = `${nowYear}-${String(nowMonth + 1).padStart(2, '0')}`;
      return dateStr.startsWith(curYearMonth);
    }
    case 'last_month': {
      const prevDate = new Date(nowYear, nowMonth - 1, 1);
      const prevYearMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
      return dateStr.startsWith(prevYearMonth);
    }
    case 'last_30_days': {
      const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
      return recTime >= thirtyDaysAgo;
    }
    case 'last_90_days': {
      const ninetyDaysAgo = now.getTime() - 90 * 24 * 60 * 60 * 1000;
      return recTime >= ninetyDaysAgo;
    }
    case 'year_2026': {
      return dateStr.startsWith('2026');
    }
    case 'year_2025': {
      return dateStr.startsWith('2025');
    }
    case 'custom': {
      if (filter.startDate && filter.endDate) {
        return dateStr >= filter.startDate && dateStr <= filter.endDate;
      }
      if (filter.startDate) {
        return dateStr >= filter.startDate;
      }
      if (filter.endDate) {
        return dateStr <= filter.endDate;
      }
      return true;
    }
    default:
      return true;
  }
}

export function getDateFilterDisplayLabel(filter?: DateFilterState): string {
  if (!filter || !filter.preset || filter.preset === 'all') return 'Tüm Tarihler';
  const preset = DATE_PRESETS.find(p => p.key === filter.preset);
  if (preset) return preset.label;
  if (filter.preset === 'custom') {
    if (filter.startDate && filter.endDate) return `${filter.startDate} - ${filter.endDate}`;
    if (filter.startDate) return `≥ ${filter.startDate}`;
    if (filter.endDate) return `≤ ${filter.endDate}`;
  }
  return 'Filtreli';
}
