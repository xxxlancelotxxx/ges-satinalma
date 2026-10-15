export function formatRuble(e: any, t?: any): string {
  if (e == null || isNaN(Number(e))) return "0 ₽";
  const val = Number(e);
  const hasDecimals = Math.abs(val - Math.round(val)) >= 0.005;
  if (hasDecimals) {
    return `${val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
  }
  return `${Math.round(val).toLocaleString('tr-TR')} ₽`;
}

export function formatRubleWithDecimals(e: any): string {
  if (e == null || isNaN(Number(e))) return "0,00 ₽";
  const num = Number(e);
  return `${num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export function formatUploadDate(e?: string, t?: string): string {
  const a = e || t;
  if (!a) return "-";
  try {
    const i = new Date(a);
    if (isNaN(i.getTime())) return a;
    const r = String(i.getDate()).padStart(2, "0");
    const n = String(i.getMonth() + 1).padStart(2, "0");
    const s = i.getFullYear();
    const u = String(i.getHours()).padStart(2, "0");
    const c = String(i.getMinutes()).padStart(2, "0");
    return a.length <= 10 ? `${r}.${n}.${s}` : `${r}.${n}.${s} ${u}:${c}`;
  } catch {
    return a;
  }
}

export function getSafeFileUrl(e?: string): string {
  if (!e) return "";
  if (e.startsWith("http://") || e.startsWith("https://") || e.startsWith("/") || e.startsWith("data:")) {
    return e;
  }
  return `/api/files/${encodeURIComponent(e)}`;
}

export function resolveDocumentFileUrl(e?: string, t?: string): string {
  if (e) return getSafeFileUrl(e);
  if (t) return `/api/files/drive/${t}`;
  return "";
}

export function openOriginalFileViewer(fileUrl?: string, fileName?: string, metadata?: any): void {
  let targetUrl = fileUrl;
  const targetName = fileName || "Belge";
  const invoiceNo = metadata?.invoiceNo || metadata?.invoiceNumber;

  if (!targetUrl && invoiceNo) {
    targetUrl = `/api/files/Fatura_${invoiceNo}.pdf`;
  }
  if (!targetUrl) return;

  const resolvedUrl = getSafeFileUrl(targetUrl);
  if (typeof window !== "undefined") {
    const isExcel = /\.xlsx?($|\?)/i.test(resolvedUrl) || /\.xlsx?$/i.test(targetName);

    if (resolvedUrl.startsWith("data:") || isExcel) {
      const link = document.createElement("a");
      link.href = resolvedUrl;
      link.download = targetName.endsWith('.xlsx') || targetName.endsWith('.xls')
        ? targetName
        : (isExcel ? `${targetName}.xlsx` : targetName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const event = new CustomEvent("open-file-viewer", {
      detail: { url: resolvedUrl, fileName: targetName, metadata }
    });
    window.dispatchEvent(event);
    setTimeout(() => {
      window.open(resolvedUrl, "_blank", "noopener,noreferrer");
    }, 100);
  }
}
