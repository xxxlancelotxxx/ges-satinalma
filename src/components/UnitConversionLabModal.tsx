import React, { useState, useMemo } from 'react';
import {
  X,
  Calculator,
  Scale,
  Sparkles,
  ArrowRight,
  Info,
  CheckCircle2,
  BookOpen,
  Layers,
  Package,
  Building2
} from 'lucide-react';
import {
  convertMaterialUnit,
  extractRebarDiameter,
  getRebarWeightPerMeter,
  extractRollAreaM2,
  extractBoardAreaM2,
  normalizeStandardUnit
} from '../utils/constructionUnitConverter';
import { formatRuble } from '../utils/format';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialMaterialName?: string;
  initialUnit?: string;
}

const PRESETS = [
  {
    title: 'Ø12 İnşaat Demiri (Metre -> Ton)',
    materialName: 'Арматура А500С ф12 мм L=11.7м',
    fromUnit: 'metre',
    toUnit: 'ton',
    unitPrice: 58,
    quantity: 4500,
    category: 'İnşaat Demiri',
    description: 'Metre ile alınan inşaat demirini toptan piyasa ton fiyatına çevirme'
  },
  {
    title: 'Ø16 İnşaat Demiri (Metre -> Ton)',
    materialName: 'Арматура А500С Ø16 ГОСТ 34028',
    fromUnit: 'metre',
    toUnit: 'ton',
    unitPrice: 102,
    quantity: 3000,
    category: 'İnşaat Demiri',
    description: 'Ø16 demir için metre tül ağırlığı (1.578 kg/m) ile ton çevrimi'
  },
  {
    title: 'Su Yalıtım Membranı (Rulo -> m²)',
    materialName: 'Изопласт ЭПП-4.0 (10м2)',
    fromUnit: 'rulo',
    toUnit: 'm²',
    unitPrice: 2500,
    quantity: 50,
    category: 'Yalıtım & Alçıpan',
    description: '1 rulo (10 m²) fiyatından metrekare birim fiyatına normalize etme'
  },
  {
    title: 'Jeotekstil Keçe (Rulo -> m²)',
    materialName: 'Геотекстиль Дорнит 300 г/м2 (2х50м)',
    fromUnit: 'rulo',
    toUnit: 'm²',
    unitPrice: 5800,
    quantity: 20,
    category: 'Yalıtım & Alçıpan',
    description: '100 m² (2m x 50m) rulo alanından m² birim fiyatına çevrim'
  },
  {
    title: 'Knauf Alçıpan 12.5mm (Plaka -> m²)',
    materialName: 'Гипсокартон Knauf ГСП-А 12.5мм 1200х2500',
    fromUnit: 'plaka',
    toUnit: 'm²',
    unitPrice: 450,
    quantity: 200,
    category: 'Yalıtım & Alçıpan',
    description: '1.2m x 2.5m = 3 m² plaka ebadından m² fiyatına normalize etme'
  },
  {
    title: 'Hazır Beton B25 (m³ -> Ton)',
    materialName: 'Товарный бетон B25 W6 F150',
    fromUnit: 'm³',
    toUnit: 'ton',
    unitPrice: 6200,
    quantity: 15,
    category: 'Hazır Beton & Çimento',
    description: '1 m³ betonun ~2.4 ton yoğunluğu üzerinden ton fiyatı hesabı'
  },
  {
    title: 'Çimento Torbası 50 kg (Torba -> Ton)',
    materialName: 'Портландцемент ЦЕМ II/A-Ш 42.5Н (50 кг)',
    fromUnit: 'torba',
    toUnit: 'ton',
    unitPrice: 460,
    quantity: 100,
    category: 'Hazır Beton & Çimento',
    description: '50 kg torbadan toptan ton fiyatına (1 Ton = 20 Torba) çevrim'
  }
];

export const UnitConversionLabModal: React.FC<Props> = ({
  isOpen,
  onClose,
  initialMaterialName = 'Арматура А500С ф12 мм',
  initialUnit = 'metre'
}) => {
  useModalBackHandler(isOpen, onClose);

  const [materialName, setMaterialName] = useState(initialMaterialName);
  const [fromUnit, setFromUnit] = useState(initialUnit);
  const [toUnit, setToUnit] = useState('ton');
  const [unitPrice, setUnitPrice] = useState<number>(58);
  const [quantity, setQuantity] = useState<number>(1000);
  const [category, setCategory] = useState<string>('İnşaat Demiri');

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setMaterialName(preset.materialName);
    setFromUnit(preset.fromUnit);
    setToUnit(preset.toUnit);
    setUnitPrice(preset.unitPrice);
    setQuantity(preset.quantity);
    setCategory(preset.category);
  };

  const conversionResult = useMemo(() => {
    return convertMaterialUnit({
      materialName,
      category,
      fromUnit,
      toUnit,
      unitPrice: Number(unitPrice) || 0,
      quantity: Number(quantity) || 1
    });
  }, [materialName, category, fromUnit, toUnit, unitPrice, quantity]);

  const originalTotalSpend = (Number(unitPrice) || 0) * (Number(quantity) || 0);
  const convertedTotalSpend = conversionResult.convertedUnitPrice * conversionResult.convertedQuantity;

  // Extracted specs
  const detectedDiameter = extractRebarDiameter(materialName);
  const detectedRollArea = extractRollAreaM2(materialName);
  const detectedBoardArea = extractBoardAreaM2(materialName);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-700/80 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950/50 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 rounded-xl">
              <Calculator className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-black text-white">
                  Şantiye Birim Dönüşüm & Eşdeğerlik Laboratuvarı
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  GOST 5781 / TS 708
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Farklı birimlerde (Ton, Metre, Rulo, m², m³) faturalandırılan malzemelerin ortak piyasa emsaline adil çevrimi
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-200 text-xs">
          {/* Quick Presets Carousel */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Hazır Şantiye Senaryoları (Hızlı Test)</span>
              </span>
              <span className="text-[10px] text-slate-500">Tıklayarak formülü deneyin</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESETS.slice(0, 4).map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => applyPreset(p)}
                  className="p-2.5 rounded-xl border border-slate-800 bg-slate-800/50 hover:bg-indigo-900/40 hover:border-indigo-500/40 text-left transition-all group cursor-pointer"
                >
                  <div className="font-bold text-slate-200 group-hover:text-indigo-300 text-xs truncate">
                    {p.title}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                    {p.fromUnit} ➔ {p.toUnit}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Calculator Inputs */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Malzeme Adı / Teknik Yazım
                </label>
                <input
                  type="text"
                  value={materialName}
                  onChange={e => setMaterialName(e.target.value)}
                  placeholder="Örn: Арматура А500С ф12 мм L=11.7м"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Kategori
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="İnşaat Demiri">İnşaat Demiri</option>
                  <option value="Çelik Malzemeler">Çelik Malzemeler</option>
                  <option value="Yalıtım & Alçıpan">Yalıtım & Alçıpan</option>
                  <option value="Hazır Beton & Çimento">Hazır Beton & Çimento</option>
                  <option value="Kimyasallar & Boya">Kimyasallar & Boya</option>
                  <option value="Diğer Malzeme">Diğer Malzeme</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Kaynak Birim (Fatura)
                </label>
                <select
                  value={fromUnit}
                  onChange={e => setFromUnit(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-300 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="metre">Metre (m / m.tül)</option>
                  <option value="ton">Ton (t / tn)</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="rulo">Rulo (Roll)</option>
                  <option value="m²">Metrekare (m²)</option>
                  <option value="plaka">Plaka / Adet (Board)</option>
                  <option value="m³">Metreküp (m³)</option>
                  <option value="torba">Torba (50kg / 25kg)</option>
                  <option value="kova">Kova (Teneke / Kutu)</option>
                  <option value="adet">Adet (Boy / Pcs)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Hedef Birim (Kıyaslama)
                </label>
                <select
                  value={toUnit}
                  onChange={e => setToUnit(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-300 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ton">Ton (Piyasa Standardı)</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="m²">Metrekare (m²)</option>
                  <option value="metre">Metre (m.tül)</option>
                  <option value="m³">Metreküp (m³)</option>
                  <option value="rulo">Rulo</option>
                  <option value="plaka">Plaka</option>
                  <option value="torba">Torba</option>
                  <option value="adet">Adet</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Birim Fiyat (₽)
                </label>
                <input
                  type="number"
                  value={unitPrice}
                  onChange={e => setUnitPrice(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Alınan Miktar
                </label>
                <input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Result Card */}
          <div className="bg-gradient-to-br from-indigo-950/60 to-slate-950 border border-indigo-500/40 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center space-x-1.5">
                <Scale className="w-4 h-4 text-indigo-300" />
                <span>Dönüşüm ve Eşdeğerlik Sonucu</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                conversionResult.conversionApplied ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
              }`}>
                {conversionResult.conversionApplied ? '✓ Başarıyla Normalize Edildi' : 'Doğrudan Eşleşti'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left: Original Purchase */}
              <div className="bg-slate-900/80 border border-slate-800 p-4 rounded-xl space-y-2">
                <div className="text-[10px] uppercase font-bold text-amber-400 flex items-center justify-between">
                  <span>Orijinal Fatura Kaydı</span>
                  <span className="font-mono">{fromUnit}</span>
                </div>
                <div className="text-2xl font-black font-mono text-white">
                  {formatRuble(unitPrice)}{' '}
                  <span className="text-xs font-normal text-slate-400">/{fromUnit}</span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  Miktar: <strong className="text-slate-200">{quantity} {fromUnit}</strong> | Tutar:{' '}
                  <strong className="text-slate-200">{formatRuble(originalTotalSpend)}</strong>
                </div>
              </div>

              {/* Right: Normalized Result */}
              <div className="bg-emerald-950/40 border border-emerald-500/30 p-4 rounded-xl space-y-2">
                <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center justify-between">
                  <span>Piyasa Eşdeğer Fiyatı (Normalize)</span>
                  <span className="font-mono">{toUnit}</span>
                </div>
                <div className="text-2xl font-black font-mono text-emerald-300">
                  {formatRuble(conversionResult.convertedUnitPrice)}{' '}
                  <span className="text-xs font-normal text-emerald-400">/{toUnit}</span>
                </div>
                <div className="text-xs text-emerald-200/80 font-mono">
                  Eşdeğer Hacim: <strong className="text-white">{conversionResult.convertedQuantity} {toUnit}</strong> | Toplam Tutar:{' '}
                  <strong className="text-white">{formatRuble(convertedTotalSpend)}</strong>
                </div>
              </div>
            </div>

            {/* Formula & Engineering Explanation */}
            <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-start space-x-3 text-xs">
              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold text-slate-200">
                  Kullanılan Mühendislik Formülü: <span className="text-amber-300 font-mono">{conversionResult.formula}</span>
                </div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  {conversionResult.notes || 'İnşaat standardı normlarına göre matematiksel ve fiziksel denklem birebir uygulanmıştır.'}
                </p>
                {detectedDiameter && (
                  <div className="text-[10px] text-indigo-300 font-mono">
                    ✓ Tespit Edilen Donatı Çapı: Ø{detectedDiameter} mm | Metre Tül Ağırlığı: {getRebarWeightPerMeter(detectedDiameter)} kg/m
                  </div>
                )}
                {detectedRollArea && (
                  <div className="text-[10px] text-indigo-300 font-mono">
                    ✓ Tespit Edilen Rulo Alanı: {detectedRollArea} m²
                  </div>
                )}
                {detectedBoardArea && (
                  <div className="text-[10px] text-indigo-300 font-mono">
                    ✓ Tespit Edilen Plaka Alanı: {detectedBoardArea} m²
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="text-[11px] text-slate-400">
            GES Satınalma ve Hakediş Denetimi Sistemi • Akıllı Normalizasyon Motoru
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Anladım, Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
