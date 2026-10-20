/**
 * TDF ticari şartları: yapılandırılmış alanlar (avans % / vade gün, şantiye / fabrika teslim, gün sayıları)
 * ve belge metninden bunları çıkaran yerel ayrıştırıcı.
 *
 * Kutu değeri (`value`) her zaman yapılandırılmış alandan üretilen kısa Türkçe metindir; belgede yazan
 * asıl ifade `raw` alanında saklanır (ekranda "teklifte: …" olarak görünür).
 */

export type TdfPaymentMode = 'advance' | 'deferred';
export type TdfDeliveryPlace = 'site' | 'factory';

export interface TdfTermFields {
  /** payment: advance | deferred; delivery: stock | days; deliveryPlace: site | factory; validity: days */
  mode?: string;
  /** payment: avans yüzdesi veya vade günü; delivery / validity: gün */
  num?: number;
}

const toNum = (s: string) => parseFloat(s.replace(',', '.'));

/** Ödeme metni → avans % / vade gün. */
export function parsePaymentText(text?: string): TdfTermFields {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  if (!s.trim()) return {};
  const pctM = s.match(/(\d{1,3}(?:[.,]\d+)?)\s?%/);
  const daysM = s.match(/(\d{1,3})\s?(?:-?х\s?)?(?:к\.?\s?|календарн[а-яё]*\s?|банковск[а-яё]*\s?|рабоч[а-яё]*\s?|iş\s?|banka\s?)?(?:дн|день|дня|дней|gün|gun|day)/);
  // "по факту прихода денег", "срок оплаты счёта N дней" = sevkiyattan önce ödeme (avans)
  const prepayInvoice = /по факту (?:прихода|поступления) (?:денег|денежных|оплаты)|срок оплаты[а-яё ]*сч[её]т|оплатить сч[её]т|сч[её]т[а-яё ]*(?:оплатить|подлежит оплате|действителен)/.test(s);
  const advance = /предоплат|аванс|avans|ön ?ödeme|peşin|prepay|100\s?%\s?оплат/.test(s) || prepayInvoice;
  const deferred = /отсрочк|постоплат|по факту (?:поставки|отгрузки|получения|приемки)|после (?:поставки|отгрузки|получения|приемки)|(?:с|от) (?:даты|момента) (?:поставки|отгрузки|получения|подписания упд)|vade|vadeli|deferred|кредит/.test(s);
  if (advance && !(deferred && !pctM && !/предоплат|аванс|avans/.test(s))) {
    const pct = pctM ? toNum(pctM[1]) : 100;
    return { mode: 'advance', num: pct > 0 && pct <= 100 ? pct : 100 };
  }
  if (deferred || daysM) return { mode: 'deferred', num: daysM ? parseInt(daysM[1], 10) : 0 };
  return {};
}

/** Teslim süresi metni → stokta / gün. */
export function parseDeliveryText(text?: string): TdfTermFields {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return {};
  if (/налич|stok|stock|со склада|склад(?:е|ской)/.test(s) && !/под заказ/.test(s)) return { mode: 'stock', num: 0 };
  const m = s.match(/(\d{1,3})\s?(?:-\s?\d{1,3}\s?)?(?:раб[а-яё]*\.?\s?|банк[а-яё]*\.?\s?|календ[а-яё]*\.?\s?|iş\s?)?(?:дн|день|дня|дней|gün|gun|day)/);
  if (m) return { mode: 'days', num: parseInt(m[1], 10) };
  const w = s.match(/(\d{1,2})\s?(?:нед|hafta|week)/);
  if (w) return { mode: 'days', num: parseInt(w[1], 10) * 7 };
  if (/^\s*\d{1,3}\s*$/.test(s)) return { mode: 'days', num: parseInt(s, 10) };
  return {};
}

/** Teslim yeri metni → şantiye / fabrika (depo) teslim. */
export function parseDeliveryPlaceText(text?: string): TdfTermFields {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return {};
  if (/самовывоз|франко[- ]?склад|со склада|exw|fabrika|depo(?:dan)?\s?teslim|завод[а-яё]* поставщ|склад[а-яё]* поставщ|pickup/.test(s)) return { mode: 'factory' };
  if (/объект|площадк|şantiye|santiye|до адреса|с доставкой|доставк[а-яё]* (?:до|на|включ)|включая доставку|site|адрес/.test(s)) return { mode: 'site' };
  if (/фабрик|завод|склад/.test(s)) return { mode: 'factory' };
  if (/доставк/.test(s)) return { mode: 'site' };
  return {};
}

/** Geçerlilik metni → gün. */
export function parseValidityText(text?: string): TdfTermFields {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return {};
  const m = s.match(/(\d{1,3})\s?(?:банк[а-яё]*\.?\s?|раб[а-яё]*\.?\s?|календ[а-яё]*\.?\s?|iş\s?|banka\s?)?(?:дн|день|дня|дней|gün|gun|day)/);
  if (m) return { mode: /банк|раб|iş|banka/.test(s) ? 'workdays' : 'days', num: parseInt(m[1], 10) };
  if (/^\s*\d{1,3}\s*$/.test(s)) return { mode: 'days', num: parseInt(s, 10) };
  return {};
}

export function formatPayment(f: TdfTermFields): string {
  if (f.mode === 'advance') return `Avans %${Math.round((f.num ?? 100) * 10) / 10}`;
  if (f.mode === 'deferred') return f.num ? `Vadeli ${f.num} gün` : 'Vadeli';
  return '';
}
export function formatDelivery(f: TdfTermFields): string {
  if (f.mode === 'stock') return 'Stokta';
  if (f.mode === 'days' && Number.isFinite(f.num)) return `${f.num} gün`;
  return '';
}
export function formatDeliveryPlace(f: TdfTermFields): string {
  if (f.mode === 'site') return 'Şantiye teslim';
  if (f.mode === 'factory') return 'Fabrika / depo teslim';
  return '';
}
export function formatValidity(f: TdfTermFields): string {
  if (Number.isFinite(f.num) && f.num! > 0) return f.mode === 'workdays' ? `${f.num} iş günü` : `${f.num} gün`;
  return '';
}

/**
 * Belge metninden (PDF metin katmanı / Excel) ticari şart cümlelerini bulan yerel ayrıştırıcı.
 * Yapay zekâ kullanılamadığında kutuları boş bırakmamak için kullanılır; yalnızca açıkça yazanı alır.
 */
export function localTermsFromText(text?: string): { payment?: string; delivery?: string; deliveryPlace?: string; validity?: string; warranty?: string } {
  const src = String(text || '').replace(/\r/g, '');
  if (!src.trim()) return {};
  const sentences = src.split(/\n+|(?<=[.;])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 3 && s.length < 260);
  const pick = (re: RegExp, reject?: RegExp) => sentences.find(s => re.test(s.toLowerCase()) && !(reject && reject.test(s.toLowerCase())));
  const out: ReturnType<typeof localTermsFromText> = {};
  const pay = pick(/предоплат|аванс|отсрочк|постоплат|условия оплаты|срок оплаты|по факту (?:прихода|поступления)|оплата (?:по факту|в течение|после)/, /означает согласие|назначение платежа/);
  if (pay) out.payment = pay;
  const val = pick(/(?:сч[её]т|предложение|кп|цены?)[а-яё ]{0,25}(?:действител|актуальн)[а-яё]* (?:в течение|до)|срок действия/);
  if (val) out.validity = val;
  const del = pick(/срок (?:поставки|отгрузки|изготовления)|в наличии|отгрузка (?:в течение|через)|поставка (?:в течение|через)/);
  if (del) out.delivery = del;
  const place = pick(/самовывоз|франко|доставка (?:до|на|включ|осуществл)|с доставкой|склад[а-яё]* поставщика|включая доставку/);
  if (place) out.deliveryPlace = place;
  const war = pick(/гарантийн[а-яё]* (?:срок|обязательств)|гаранти[яи] (?:на |составляет|\d|производителя)/, /не гарантир/);
  if (war) out.warranty = war;
  return out;
}

/**
 * Gemini / ağ hatalarını kullanıcıya gösterilecek kısa Türkçe cümleye çevirir.
 * Ham JSON veya İngilizce hata metni asla ekrana çıkmaz.
 */
export function friendlyAiError(err: unknown): string {
  const raw = String((err as any)?.message || err || '').trim();
  const s = raw.toLowerCase();
  if (!s) return 'Yapay zekâ yanıt vermedi.';
  if (/spending cap|monthly spending|billing|exceeded its monthly/.test(s)) {
    return 'Gemini aylık harcama limiti dolmuş; AI Studio\'da Billing bölümünden harcama limiti artırılmalı';
  }
  if (/api[_ ]?key|ortam değişkeni tanımlı değil|permission_denied|unauthenticated|401|403/.test(s)) {
    return 'Gemini API anahtarı tanımlı değil veya geçersiz; AI Studio ayarlarında GEMINI_API_KEY kontrol edilmeli';
  }
  if (/429|resource_exhausted|quota|rate limit|too many requests/.test(s)) {
    return 'Gemini şu an istek sınırında; birkaç dakika sonra tekrar deneyin';
  }
  if (/zaman aşımı|timeout|timed out|deadline/.test(s)) return 'Yapay zekâ zamanında yanıt vermedi; tekrar deneyin';
  if (/503|unavailable|overloaded|high demand|yoğunluk/.test(s)) return 'Gemini şu an yoğun; birkaç dakika sonra tekrar deneyin';
  if (/fetch failed|enotfound|econnreset|network|socket/.test(s)) return 'Yapay zekâ servisine bağlanılamadı; ağ bağlantısı yok';
  if (/json|parse|doğrulama/.test(s)) return 'Yapay zekâ yanıtı okunamadı; tekrar deneyin';
  if (/^[\x20-\x7E]+$/.test(raw) || raw.startsWith('{') || raw.length > 160) return 'Yapay zekâ beklenmeyen bir hata verdi; tekrar deneyin';
  return raw.slice(0, 160);
}

/** Kayıtlı eski uyarılarda kalmış ham hata metinlerini (ör. {"error":{"code":429…}) temiz cümleye çevirir. */
export function cleanReadWarning(w: string): string {
  const text = String(w || '');
  if (!/\{"error"|spending cap|resource_exhausted|api key|"code"\s*:/i.test(text)) return text;
  const head = text.split('(')[0].trim().replace(/[:;,.]+$/, '');
  return `${head || 'Yapay zekâ hatası'}: ${friendlyAiError(text)}.`;
}
