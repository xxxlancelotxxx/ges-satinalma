import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, X, ShieldCheck } from 'lucide-react';

interface AdminPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminPinModal: React.FC<AdminPinModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
      setIsLoading(false);
      setShowPassword(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPin = pin.trim();
    if (!cleanPin) {
      setError('Lütfen yönetici şifresini giriniz.');
      return;
    }

    setIsLoading(true);
    setError('');

    // Check default report PIN (3255) and default admin PIN (1234)
    if (cleanPin === '3255' || cleanPin === '1234') {
      try {
        sessionStorage.setItem('report_pin_unlocked_3255', 'true');
        sessionStorage.setItem('admin_pin', cleanPin);
      } catch (_) {}
      setIsLoading(false);
      onSuccess();
      onClose();
      return;
    }

    // Verify against backend admin auth
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin, preferredRole: 'admin' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        try {
          sessionStorage.setItem('report_pin_unlocked_3255', 'true');
          sessionStorage.setItem('admin_pin', cleanPin);
        } catch (_) {}
        setIsLoading(false);
        onSuccess();
        onClose();
        return;
      }
    } catch (_) {}

    setIsLoading(false);
    setError('Hatalı şifre. Giriş reddedildi.');
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 text-white relative transition-transform ${isShaking ? 'animate-bounce' : ''}`}>
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white p-1 rounded-xl hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon */}
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center mb-4 shadow-inner">
          <Lock className="w-7 h-7 text-amber-400" />
        </div>

        <h3 className="text-xl font-black text-center text-slate-100 tracking-tight">
          Yönetici Özel Sekme 🔒
        </h3>
        <p className="text-xs sm:text-sm text-slate-400 text-center mt-2 leading-relaxed">
          Bu sekme Yöneticilere özeldir. Girmek için yönetici şifresini tuşlayın:
        </p>

        {/* PIN Entry Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoFocus
              maxLength={16}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError('');
              }}
              placeholder="Yönetici Şifresi..."
              className={`w-full text-center text-lg font-mono tracking-widest px-4 py-3 bg-slate-950 border ${
                error ? 'border-rose-500 ring-2 ring-rose-500/20' : 'border-slate-700 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30'
              } rounded-2xl text-white placeholder:text-slate-600 focus:outline-none transition-all`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="flex items-center space-x-2 text-xs text-rose-400 font-bold bg-rose-500/10 py-2.5 px-3.5 rounded-xl border border-rose-500/30">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => {
                  setPin(prev => prev + digit);
                  setError('');
                }}
                className="py-2.5 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold text-sm rounded-xl border border-slate-700/80 transition-colors cursor-pointer"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setPin('');
                setError('');
              }}
              className="py-2.5 bg-slate-800/40 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 font-bold text-xs rounded-xl border border-slate-800 transition-colors cursor-pointer"
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={() => {
                setPin(prev => prev + '0');
                setError('');
              }}
              className="py-2.5 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white font-mono font-bold text-sm rounded-xl border border-slate-700/80 transition-colors cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => {
                setPin(prev => prev.slice(0, -1));
                setError('');
              }}
              className="py-2.5 bg-slate-800/40 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-800 transition-colors cursor-pointer"
            >
              ← Sil
            </button>
          </div>

          <div className="flex space-x-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors cursor-pointer"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-900/30 transition-all cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isLoading ? 'Doğrulanıyor...' : 'Giriş Yap'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
