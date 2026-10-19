import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Check, RotateCcw } from 'lucide-react';
import { DateFilterState, DATE_PRESETS, getDateFilterDisplayLabel } from '../utils/filterHelpers';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  value: DateFilterState;
  onChange: (filter: DateFilterState) => void;
  className?: string;
  align?: 'left' | 'right';
  dark?: boolean;
}

export const DateRangeFilterDropdown: React.FC<Props> = ({
  value,
  onChange,
  className = '',
  align = 'left',
  dark = false
}) => {
  const { language } = useLanguage();
  const isRu = language === 'RU';
  const [isOpen, setIsOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.startDate || '');
  const [customEnd, setCustomEnd] = useState(value.endDate || '');
  const popoverRef = useRef<HTMLDivElement>(null);

  const isFiltered = value.preset && value.preset !== 'all';
  const displayLabel = getDateFilterDisplayLabel(value, language);

  // Sync internal custom dates when prop changes
  useEffect(() => {
    setCustomStart(value.startDate || '');
    setCustomEnd(value.endDate || '');
  }, [value.startDate, value.endDate]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelectPreset = (presetKey: string) => {
    onChange({ preset: presetKey });
    setIsOpen(false);
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStart && !customEnd) {
      onChange({ preset: 'all' });
    } else {
      onChange({
        preset: 'custom',
        startDate: customStart || undefined,
        endDate: customEnd || undefined
      });
    }
    setIsOpen(false);
  };

  const handleReset = () => {
    onChange({ preset: 'all' });
    setCustomStart('');
    setCustomEnd('');
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center justify-between space-x-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer select-none max-w-full truncate ${
          isFiltered
            ? dark
              ? 'bg-indigo-950/80 border-indigo-500/60 text-indigo-200 ring-1 ring-indigo-500/30'
              : 'bg-indigo-50 border-indigo-300 text-indigo-900 ring-1 ring-indigo-200'
            : dark
              ? 'bg-slate-800/90 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-2xs'
        }`}
        title={`${isRu ? 'Дата' : 'Tarih'}: ${displayLabel}`}
      >
        <span className="flex items-center space-x-1 min-w-0 truncate">
          <Calendar className={`w-3 h-3 shrink-0 ${isFiltered ? 'text-indigo-500' : 'text-slate-400'}`} />
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-0.5">{isRu ? 'Дата:' : 'Tarih:'}</span>
          <span className="truncate max-w-[130px] font-bold">
            {displayLabel}
          </span>
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 mt-1 w-72 rounded-xl shadow-2xl border transition-all animate-in fade-in zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${
            dark
              ? 'bg-slate-900 border-slate-700 text-slate-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          {/* Header */}
          <div className={`p-2.5 border-b ${dark ? 'border-slate-800 bg-slate-900/90' : 'border-slate-100 bg-slate-50'} rounded-t-xl flex items-center justify-between`}>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {isRu ? 'Фильтр по дате' : 'Tarih Filtresi'}
            </span>
            {isFiltered && (
              <button
                type="button"
                onClick={handleReset}
                className="text-[10px] font-bold text-indigo-500 hover:text-indigo-400 hover:underline cursor-pointer flex items-center space-x-0.5"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>{isRu ? 'Сбросить' : 'Sıfırla'}</span>
              </button>
            )}
          </div>

          {/* Quick Presets */}
          <div className="p-1.5 space-y-0.5 border-b border-slate-100 dark:border-slate-800">
            {DATE_PRESETS.map((p) => {
              const isSelected = value.preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleSelectPreset(p.key)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? dark
                        ? 'bg-indigo-950/70 text-indigo-200 font-bold'
                        : 'bg-indigo-50 text-indigo-900 font-bold'
                      : dark
                        ? 'hover:bg-slate-800 text-slate-300'
                        : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span>{isRu ? p.labelRu : p.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-500" />}
                </button>
              );
            })}
          </div>

          {/* Custom Date Range Picker */}
          <form onSubmit={handleApplyCustom} className="p-2.5 space-y-2">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {isRu ? 'Период дат' : 'Özel Tarih Aralığı'}
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">{isRu ? 'Начало' : 'Başlangıç'}</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className={`w-full px-2 py-1 text-[11px] rounded border outline-none font-mono ${
                    dark
                      ? 'bg-slate-950 border-slate-700 text-white'
                      : 'bg-white border-slate-300 text-slate-800'
                  }`}
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">{isRu ? 'Конец' : 'Bitiş'}</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className={`w-full px-2 py-1 text-[11px] rounded border outline-none font-mono ${
                    dark
                      ? 'bg-slate-950 border-slate-700 text-white'
                      : 'bg-white border-slate-300 text-slate-800'
                  }`}
                />
              </div>
            </div>
            <div className="flex items-center space-x-1.5 pt-1">
              <button
                type="submit"
                className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {isRu ? 'Применить' : 'Aralığı Uygula'}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {isRu ? 'Закрыть' : 'Kapat'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
