/**
 * Utility helpers for Prizma ERP URLs.
 * 
 * In Prizma SPA (pm.gescons.ru), direct demand viewing works reliably through:
 * 1. The dedicated backend redirect routes:
 *    `/api/prizma/redirect/btf/:id`
 *    `/api/prizma/redirect/stf/:id`
 *    Our server uses its authorized session to resolve the exact subprocess ID 
 *    (e.g., 21008 for Giden Kutusu or 21009 for Ödeme Takip for BTF; 17252 for Teslimat Beklenen or 17254 for Sipariş Takip for STF)
 *    and immediately 302 redirects to Prizma. This eliminates client-side 404 / "Sayfa Bulunamadı" errors!
 * 
 * 2. Universal tracking fallback URLs if no demand ID is supplied.
 */

export function getPrizmaBtfUrl(demandId?: number | string | null, rawUrl?: string | null): string {
  if (demandId) {
    const cleanId = String(demandId).replace(/\D/g, '');
    if (cleanId) {
      return `/api/prizma/redirect/btf/${cleanId}`;
    }
  }
  if (rawUrl && typeof rawUrl === 'string') {
    const m = rawUrl.match(/\/detail\/(?:[^\/]+)\/(\d+)/);
    if (m && m[1]) {
      return `/api/prizma/redirect/btf/${m[1]}`;
    }
  }
  return 'https://pm.gescons.ru/process/payment-demand/2100/21009/list';
}

export function getPrizmaStfUrl(orderDemandId?: number | string | null, rawUrl?: string | null): string {
  if (orderDemandId) {
    const cleanId = String(orderDemandId).replace(/\D/g, '');
    if (cleanId) {
      return `/api/prizma/redirect/stf/${cleanId}`;
    }
  }
  if (rawUrl && typeof rawUrl === 'string') {
    const m = rawUrl.match(/\/detail\/(?:[^\/]+)\/(\d+)/);
    if (m && m[1]) {
      return `/api/prizma/redirect/stf/${m[1]}`;
    }
  }
  return 'https://pm.gescons.ru/process/order-demand/1725/17254/list';
}
