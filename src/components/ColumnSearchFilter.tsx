import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  align?: 'left' | 'right';
  dark?: boolean;
}

export const ColumnSearchFilter: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  className = '',
  align = 'left',
  dark = false
}) => {
  const { language } = useLanguage();
  const isRu = language === 'RU';
  const effectivePlaceholder = placeholder || (isRu ? 'Поиск в фильтре...' : 'Filtrede ara...');
  const [isOpen, setIsOpen] = useState(false);
  const [tempVal, setTempVal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTempVal(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const hasValue = Boolean(value.trim());

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onChange(tempVal.trim());
    setIsOpen(false);
  };

  const handleClear = () => {
    setTempVal('');
    onChange('');
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer select-none max-w-full truncate ${
          hasValue
            ? dark
              ? 'bg-indigo-950/80 border-indigo-500/60 text-indigo-200 ring-1 ring-indigo-500/30'
              : 'bg-indigo-50 border-indigo-300 text-indigo-900 ring-1 ring-indigo-200'
            : dark
              ? 'bg-slate-800/90 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-2xs'
        }`}
        title={`${label}: ${hasValue ? value : (isRu ? 'Все' : 'Tümü')}`}
      >
        <Search className={`w-3 h-3 shrink-0 ${hasValue ? 'text-indigo-500' : 'text-slate-400'}`} />
        <span className="truncate max-w-[100px]">
          {hasValue ? value : label}
        </span>
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 mt-1 w-64 rounded-xl shadow-2xl border p-2.5 transition-all animate-in fade-in zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${
            dark
              ? 'bg-slate-900 border-slate-700 text-slate-200'
              : 'bg-white border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {isRu ? `Фильтр: ${label}` : `${label} Filtrele`}
            </span>
            {hasValue && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] font-bold text-indigo-500 hover:underline cursor-pointer"
              >
                {isRu ? 'Очистить' : 'Temizle'}
              </button>
            )}
          </div>

          <form onSubmit={handleApply} className="space-y-2">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={tempVal}
                onChange={(e) => setTempVal(e.target.value)}
                placeholder={effectivePlaceholder}
                className={`w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-sans ${
                  dark
                    ? 'bg-slate-950 border-slate-700 focus:border-indigo-500 text-white placeholder-slate-500'
                    : 'bg-white border-slate-300 focus:border-indigo-500 text-slate-900 placeholder-slate-400'
                }`}
              />
              {tempVal && (
                <button
                  type="button"
                  onClick={() => setTempVal('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                type="submit"
                className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {isRu ? 'Применить' : 'Filtrele'}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600"
              >
                {isRu ? 'Отмена' : 'İptal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
