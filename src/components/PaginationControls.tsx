import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
  className?: string;
  dark?: boolean;
}

const RU_ITEM_LABELS: Record<string, string> = {
  fatura: 'счетов',
  indirim: 'скидок',
  kalem: 'позиций',
  kayıt: 'записей',
  malzeme: 'материалов',
  belge: 'документов',
  teklif: 'предложений',
  anomali: 'аномалий'
};

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  itemLabel = 'fatura',
  className = '',
  dark = false
}) => {
  const { language } = useLanguage();
  if (totalItems === 0) return null;

  const isRu = language === 'RU';
  const ruItemLabel = RU_ITEM_LABELS[itemLabel.toLowerCase()] || 'записей';

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // Generate page numbers with smart ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (currentPage > 3) {
        pages.push('dots-prev');
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) {
          pages.push(i);
        }
      }

      if (currentPage < totalPages - 2) {
        pages.push('dots-next');
      }

      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }
    return pages;
  };

  const pages = getPageNumbers();

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t text-xs select-none ${dark ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-600'} ${className}`}>
      {/* Information & Page Size Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {isRu ? (
          <>
            <span>Всего <strong className={dark ? 'text-white' : 'text-slate-900'}>{totalItems}</strong> {ruItemLabel}, показано</span>
            <span className={`font-mono font-bold px-2 py-0.5 rounded-lg ${dark ? 'text-indigo-300 bg-slate-900 border border-slate-700' : 'text-slate-900 bg-slate-100 border border-slate-200'}`}>
              {startItem} - {endItem}
            </span>
          </>
        ) : (
          <>
            <span>Toplam <strong className={dark ? 'text-white' : 'text-slate-900'}>{totalItems}</strong> {itemLabel} arasından</span>
            <span className={`font-mono font-bold px-2 py-0.5 rounded-lg ${dark ? 'text-indigo-300 bg-slate-900 border border-slate-700' : 'text-slate-900 bg-slate-100 border border-slate-200'}`}>
              {startItem} - {endItem}
            </span>
            <span>gösteriliyor</span>
          </>
        )}

        {onPageSizeChange && (
          <div className={`flex items-center space-x-1.5 ml-2 border-l pl-3 ${dark ? 'border-slate-800' : 'border-slate-200'}`}>
            <span className={dark ? 'text-slate-400' : 'text-slate-500'}>{isRu ? 'На странице:' : 'Sayfa Başına:'}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className={`font-bold rounded-lg px-2 py-1 text-xs focus:outline-none cursor-pointer shadow-2xs ${
                dark
                  ? 'bg-slate-900 border border-slate-700 text-slate-200 focus:ring-2 focus:ring-indigo-500/40'
                  : 'bg-white border border-slate-200 text-slate-800 focus:ring-2 focus:ring-indigo-500/20'
              }`}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pagination Buttons */}
      <div className="flex items-center space-x-1 overflow-x-auto max-w-full py-1">
        {/* First Page */}
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={currentPage <= 1}
          className={`p-1.5 rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-2xs ${
            dark
              ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
          }`}
          title={isRu ? 'Первая страница (Стр. 1)' : 'İlk Sayfaya Git (Sayfa 1)'}
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>

        {/* Previous Page */}
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className={`px-2.5 py-1 rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed font-semibold transition-all flex items-center space-x-1 cursor-pointer shadow-2xs ${
            dark
              ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          }`}
          title={isRu ? 'Предыдущая страница' : 'Önceki Sayfa'}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{isRu ? 'Назад' : 'Önceki'}</span>
        </button>

        {/* Page Numbers */}
        <div className="flex items-center space-x-1 px-1">
          {pages.map((p, idx) => {
            if (typeof p === 'string') {
              return (
                <span key={`dots-${idx}`} className={`px-1.5 font-mono font-bold ${dark ? 'text-slate-600' : 'text-slate-400'}`}>
                  ...
                </span>
              );
            }

            const isActive = p === currentPage;
            return (
              <button
                key={`page-${p}`}
                type="button"
                onClick={() => onPageChange(p)}
                className={`min-w-[28px] h-7 px-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                  isActive
                    ? 'bg-indigo-600 text-white border border-indigo-600 shadow-xs ring-2 ring-indigo-600/20'
                    : dark
                    ? 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
                }`}
                title={isRu ? `Страница ${p}` : `Sayfa ${p}`}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Next Page */}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className={`px-2.5 py-1 rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed font-semibold transition-all flex items-center space-x-1 cursor-pointer shadow-2xs ${
            dark
              ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          }`}
          title={isRu ? 'Следующая страница' : 'Sonraki Sayfa'}
        >
          <span className="hidden md:inline">{isRu ? 'Далее' : 'Sonraki'}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* Last Page */}
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage >= totalPages}
          className={`p-1.5 rounded-lg border disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer shadow-2xs ${
            dark
              ? 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
          }`}
          title={isRu ? `Последняя страница (Стр. ${totalPages})` : `Son Sayfaya Git (Sayfa ${totalPages})`}
        >
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
