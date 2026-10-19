import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X, Filter } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export interface FilterOption {
  key: string;
  label: string;
  count?: number;
  subtext?: string;
}

interface Props {
  label: string;
  selectedKey: string;
  options: FilterOption[];
  onSelect: (key: string) => void;
  placeholder?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  align?: 'left' | 'right';
  dark?: boolean;
}

export const SearchableFilterDropdown: React.FC<Props> = ({
  label,
  selectedKey,
  options,
  onSelect,
  placeholder,
  icon: Icon = Filter,
  className = '',
  align = 'left',
  dark = false
}) => {
  const { language } = useLanguage();
  const isRu = language === 'RU';
  const effectivePlaceholder = placeholder || (isRu ? 'Поиск в фильтре...' : 'Filtrede ara...');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => {
    return options.find(o => o.key === selectedKey);
  }, [options, selectedKey]);

  const regularOptions = useMemo(() => {
    return options.filter(o => o.key !== 'all');
  }, [options]);

  const allOption = useMemo(() => {
    return options.find(o => o.key === 'all');
  }, [options]);

  const totalAllCount = useMemo(() => {
    if (allOption && allOption.count !== undefined) return allOption.count;
    return regularOptions.reduce((sum, o) => sum + (o.count || 0), 0);
  }, [allOption, regularOptions]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return regularOptions;
    return regularOptions.filter(o => 
      o.label.toLowerCase().includes(q) || 
      (o.subtext && o.subtext.toLowerCase().includes(q))
    );
  }, [regularOptions, search]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto-focus search input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const isFiltered = selectedKey && selectedKey !== 'all';
  const allText = isRu ? 'Все' : 'Tümü';

  return (
    <div className={`relative inline-block text-left ${className}`} ref={popoverRef}>
      {/* Trigger Button */}
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
        title={`${label}: ${isFiltered ? (selectedOption?.label || selectedKey) : allText}`}
      >
        <span className="flex items-center space-x-1 min-w-0 truncate">
          <Icon className={`w-3 h-3 shrink-0 ${isFiltered ? 'text-indigo-500' : 'text-slate-400'}`} />
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mr-0.5">{label}:</span>
          <span className="truncate max-w-[130px] font-bold">
            {isFiltered ? (selectedOption?.label || selectedKey) : allText}
          </span>
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div
          className={`absolute z-50 mt-1 w-72 sm:w-80 rounded-xl shadow-2xl border transition-all animate-in fade-in zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${
            dark
              ? 'bg-slate-900 border-slate-700 text-slate-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          {/* Header & Search Input */}
          <div className={`p-2.5 border-b ${dark ? 'border-slate-800 bg-slate-900/90' : 'border-slate-100 bg-slate-50'} rounded-t-xl`}>
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                {isRu ? `Фильтр: ${label}` : `${label} Filtrele`}
              </span>
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect('all');
                    setIsOpen(false);
                  }}
                  className="text-[10px] font-bold text-indigo-500 hover:text-indigo-400 hover:underline cursor-pointer flex items-center space-x-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                  <span>{isRu ? 'Сбросить (Все)' : 'Sıfırla (Tümü)'}</span>
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={effectivePlaceholder}
                className={`w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border outline-none font-sans ${
                  dark
                    ? 'bg-slate-950 border-slate-700 focus:border-indigo-500 text-white placeholder-slate-500'
                    : 'bg-white border-slate-300 focus:border-indigo-500 text-slate-900 placeholder-slate-400'
                }`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto py-1 divide-y divide-slate-100 dark:divide-slate-800/60 font-sans text-xs">
            {/* "Tümü" option */}
            <button
              type="button"
              onClick={() => {
                onSelect('all');
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                !isFiltered
                  ? dark
                    ? 'bg-indigo-950/70 text-indigo-200 font-bold'
                    : 'bg-indigo-50 text-indigo-900 font-bold'
                  : dark
                    ? 'hover:bg-slate-800 text-slate-300'
                    : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span>{allText} ({totalAllCount})</span>
              {!isFiltered && <Check className="w-3.5 h-3.5 text-indigo-500" />}
            </button>

            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = selectedKey === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      onSelect(opt.key);
                      setIsOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer group ${
                      isSelected
                        ? dark
                          ? 'bg-indigo-950/70 text-indigo-200 font-bold'
                          : 'bg-indigo-50 text-indigo-900 font-bold'
                        : dark
                          ? 'hover:bg-slate-800 text-slate-200'
                          : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate font-semibold">{opt.label}</div>
                      {opt.subtext && (
                        <div className={`text-[10px] truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                          {opt.subtext}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-1.5 shrink-0">
                      {opt.count !== undefined && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                            isSelected
                              ? dark
                                ? 'bg-indigo-900/60 text-indigo-200 border-indigo-700/60'
                                : 'bg-indigo-100 text-indigo-800 border-indigo-200'
                              : dark
                                ? 'bg-slate-800 text-slate-400 border-slate-700 group-hover:border-slate-600'
                                : 'bg-slate-100 text-slate-600 border-slate-200 group-hover:border-slate-300'
                          }`}
                        >
                          {opt.count}
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-center text-slate-400 italic text-xs">
                {isRu
                  ? `По запросу "${search}" ничего не найдено.`
                  : `"${search}" ile eşleşen ${label.toLowerCase()} bulunamadı.`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
