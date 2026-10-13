import https from 'https';

export interface PrizmaDemandSummary {
  id: number;
  requestCode: string;
  orderCode?: string;
  documentNo?: string;
  documentDate?: string;
  supplier?: string;
  inn?: string;
  invoiceAmount?: number;
  paidAmount?: number;
  currency?: string;
  jobsite?: string;
  workPlaceId?: number;
  status?: string;
  description?: string;
  lastAttachedFileName?: string;
  createdOn?: string;
  createdBy?: string;
  prizmaUrl: string;
}

export interface PrizmaStatus {
  connected: boolean;
  userName: string;
  expiresInMS?: number;
  expiresAt?: string;
  error?: string;
}

class PrizmaService {
  private baseUrl: string = process.env.PRIZMA_BASE_URL || 'https://pm.gescons.ru';
  private userName: string = process.env.PRIZMA_USERNAME || 'berkant.senturk';
  private password: string = process.env.PRIZMA_PASSWORD || 'Ber3255';
  private cachedCookie: string | null = null;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private isAuthenticating: boolean = false;

  private async rawRequest(
    path: string, 
    options: { method?: string; body?: any; headers?: Record<string, string>; timeout?: number } = {},
    retries = 2
  ): Promise<{ status: number; headers: any; body: string }> {
    const url = new URL(path, this.baseUrl);
    const method = options.method || 'GET';
    const payload = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
    const timeoutMs = options.timeout || 45000;

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Gescons-Applet/1.0',
      ...(options.headers || {})
    };

    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    try {
      return await new Promise<{ status: number; headers: any; body: string }>((resolve, reject) => {
        const req = https.request(url, { method, headers, timeout: timeoutMs }, res => {
          let responseBody = '';
          res.on('data', chunk => responseBody += chunk);
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: responseBody
            });
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error(`Prizma bağlantı zaman aşımı (${Math.round(timeoutMs / 1000)}s)`));
        });
        req.on('error', err => reject(err));
        if (payload) req.write(payload);
        req.end();
      });
    } catch (err: any) {
      if (retries > 0 && (err.message?.includes('zaman aşımı') || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        console.warn(`[PRIZMA RETRY] ${path} için istek yeniden deneniyor (${retries} deneme kaldı)... Hata:`, err.message);
        await new Promise(r => setTimeout(r, 1200));
        return this.rawRequest(path, options, retries - 1);
      }
      throw err;
    }
  }

  public async authenticate(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && this.cachedCookie && this.cachedToken && this.tokenExpiresAt > now + 300000) {
      return true;
    }

    if (this.isAuthenticating) {
      await new Promise(r => setTimeout(r, 800));
      return !!this.cachedToken;
    }

    this.isAuthenticating = true;
    try {
      const loginPayload = {
        userName: this.userName,
        password: this.password
      };

      const res = await this.rawRequest('/api/user/login', {
        method: 'POST',
        body: loginPayload
      });

      if (res.status !== 200) {
        console.error('[PRIZMA AUTH FAILED]: Status', res.status, res.body);
        return false;
      }

      const rawCookies: string[] = Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie']
        : (res.headers['set-cookie'] ? [res.headers['set-cookie']] : []);

      const bpmCookie = rawCookies.find(c => c.startsWith('bpmBearer='));
      if (!bpmCookie) {
        console.error('[PRIZMA AUTH FAILED]: No bpmBearer cookie returned');
        return false;
      }

      this.cachedCookie = bpmCookie.split(';')[0];
      this.cachedToken = this.cachedCookie.replace('bpmBearer=', '').trim();

      try {
        const parsed = JSON.parse(res.body);
        if (parsed.expiresInMS) {
          this.tokenExpiresAt = Number(parsed.expiresInMS);
        } else {
          this.tokenExpiresAt = now + (11 * 3600 * 1000); // 11 hours default
        }
      } catch {
        this.tokenExpiresAt = now + (11 * 3600 * 1000);
      }

      return true;
    } catch (err: any) {
      console.error('[PRIZMA AUTH ERROR]:', err.message);
      return false;
    } finally {
      this.isAuthenticating = false;
    }
  }

  public async getStatus(): Promise<PrizmaStatus> {
    try {
      const ok = await this.authenticate();
      if (!ok) {
        return {
          connected: false,
          userName: this.userName,
          error: 'Prizma oturumu açılamadı (Kullanıcı adı veya şifre geçersiz).'
        };
      }

      return {
        connected: true,
        userName: this.userName,
        expiresInMS: this.tokenExpiresAt,
        expiresAt: new Date(this.tokenExpiresAt).toISOString()
      };
    } catch (err: any) {
      return {
        connected: false,
        userName: this.userName,
        error: err.message
      };
    }
  }

  private async authorizedGet(path: string): Promise<any> {
    const authOk = await this.authenticate();
    if (!authOk) throw new Error('Prizma oturumu sağlanamadı');

    let res = await this.rawRequest(path, {
      method: 'GET',
      headers: {
        'Cookie': this.cachedCookie || '',
        'Authorization': `Bearer ${this.cachedToken}`
      }
    });

    // If token expired on server side, retry once
    if (res.status === 412 || res.status === 401) {
      const reauth = await this.authenticate(true);
      if (reauth) {
        res = await this.rawRequest(path, {
          method: 'GET',
          headers: {
            'Cookie': this.cachedCookie || '',
            'Authorization': `Bearer ${this.cachedToken}`
          }
        });
      }
    }

    if (res.status !== 200) {
      throw new Error(`Prizma API Hatası: HTTP ${res.status} (${res.body.slice(0, 150)})`);
    }

    return JSON.parse(res.body);
  }

  public async downloadFile(path: string): Promise<{ status: number; contentType: string; data: Buffer }> {
    const authOk = await this.authenticate();
    if (!authOk) throw new Error('Prizma oturumu açılamadı');

    const url = new URL(path, this.baseUrl);
    const headers = {
      'User-Agent': 'Gescons-Applet/1.0',
      'Cookie': this.cachedCookie || '',
      'Authorization': `Bearer ${this.cachedToken}`
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'GET', headers, timeout: 60000 }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            contentType: (res.headers['content-type'] as string) || 'application/pdf',
            data: Buffer.concat(chunks)
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Prizma dosya indirme zaman aşımı (60s)')));
      req.on('error', reject);
      req.end();
    });
  }

  public async getPaymentDemands(options: { take?: number; skip?: number; search?: string } = {}): Promise<{ total: number; items: PrizmaDemandSummary[] }> {
    const take = options.take || 100;
    const skip = options.skip || 0;
    const path = `/api/payment-demand/list-filter?take=${take}&skip=${skip}`;

    const data = await this.authorizedGet(path);
    const rawList: any[] = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

    let items: PrizmaDemandSummary[] = rawList.map(p => ({
      id: p.id,
      requestCode: p.requestCode || '',
      orderCode: p.orderCode || undefined,
      documentNo: p.documentNo || undefined,
      documentDate: p.documentDate || undefined,
      supplier: p.accountingPlanName || undefined,
      inn: p.accountingPlanInn || undefined,
      invoiceAmount: p.invoiceAmount !== undefined ? Number(p.invoiceAmount) : undefined,
      paidAmount: p.paidAmount !== undefined ? Number(p.paidAmount) : undefined,
      currency: p.currencySign || p.currencyTypeNameTR || '₽',
      jobsite: p.workPlaceNameTR || p.workPlaceNameRU || undefined,
      workPlaceId: p.workPlaceId !== undefined ? Number(p.workPlaceId) : undefined,
      status: p.userProcessPositionNameTR || (p.completed ? 'Tamamlandı' : 'İşlemde'),
      description: p.description || undefined,
      lastAttachedFileName: p.lastAttachedFileName || undefined,
      createdOn: p.createdOn || undefined,
      createdBy: p.createdByFullName || p.createdBy || undefined,
      prizmaUrl: `${this.baseUrl}/process`
    }));

    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      items = items.filter(i =>
        (i.requestCode && i.requestCode.toLowerCase().includes(q)) ||
        (i.orderCode && i.orderCode.toLowerCase().includes(q)) ||
        (i.documentNo && i.documentNo.toLowerCase().includes(q)) ||
        (i.supplier && i.supplier.toLowerCase().includes(q)) ||
        (i.inn && i.inn.includes(q)) ||
        (i.jobsite && i.jobsite.toLowerCase().includes(q)) ||
        (i.description && i.description.toLowerCase().includes(q))
      );
    }

    return {
      total: data.totalCount || items.length,
      items
    };
  }

  public async getWorkplaces(): Promise<Array<{ id: number; name: string }>> {
    const data = await this.authorizedGet('/api/report/on-going-orders/list');
    const raw: any[] = data.workplaces || [];
    return raw.map(w => ({
      id: w.id,
      name: w.nameTR || w.nameRU || w.name || String(w.id)
    }));
  }

  public async searchMatchingDemands(criteria: {
    invoiceNo?: string;
    supplierName?: string;
    inn?: string;
    amount?: number;
    jobsiteName?: string;
  }): Promise<Array<PrizmaDemandSummary & { matchScore: number; matchReasons: string[] }>> {
    const { items } = await this.getPaymentDemands({ take: 250, skip: 0 });
    const cleanInv = (criteria.invoiceNo || '').toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
    const cleanSupplier = (criteria.supplierName || '').toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
    const cleanJobsite = (criteria.jobsiteName || '').toLowerCase().replace(/[^a-z0-9а-я]/gi, '');

    const scored = items.map(item => {
      let score = 0;
      const reasons: string[] = [];

      // 1. Invoice No Match
      if (cleanInv && item.documentNo) {
        const itemDoc = item.documentNo.toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
        if (itemDoc === cleanInv) {
          score += 50;
          reasons.push(`Birebir Fatura No Eşleşmesi (${item.documentNo})`);
        } else if (itemDoc.includes(cleanInv) || cleanInv.includes(itemDoc)) {
          score += 35;
          reasons.push(`Kısmi Fatura No Eşleşmesi (${item.documentNo})`);
        }
      }

      // 2. INN Match (very strong identity)
      if (criteria.inn && item.inn && criteria.inn.trim() === item.inn.trim()) {
        score += 35;
        reasons.push(`Tedarikçi INN Eşleşmesi (${item.inn})`);
      }

      // 3. Supplier Name Match
      if (cleanSupplier && item.supplier) {
        const itemSup = item.supplier.toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
        if (itemSup.includes(cleanSupplier) || cleanSupplier.includes(itemSup)) {
          score += 25;
          reasons.push(`Tedarikçi Adı Eşleşmesi (${item.supplier})`);
        }
      }

      // 4. Amount Match
      if (criteria.amount && item.invoiceAmount && Math.abs(criteria.amount - item.invoiceAmount) < 1.0) {
        score += 30;
        reasons.push(`Kuruşuna Kadar Fatura Tutarı Eşleşmesi (${item.invoiceAmount} ₽)`);
      } else if (criteria.amount && item.invoiceAmount && Math.abs(criteria.amount - item.invoiceAmount) / criteria.amount < 0.05) {
        score += 15;
        reasons.push(`Yakın Tutar Eşleşmesi (${item.invoiceAmount} ₽)`);
      }

      // 5. Jobsite Match
      if (cleanJobsite && item.jobsite) {
        const itemJob = item.jobsite.toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
        if (itemJob.includes(cleanJobsite) || cleanJobsite.includes(itemJob)) {
          score += 10;
          reasons.push(`Şantiye Eşleşmesi (${item.jobsite})`);
        }
      }

      return {
        ...item,
        matchScore: score,
        matchReasons: reasons
      };
    });

    return scored
      .filter(s => s.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 10);
  }
}

export const prizmaService = new PrizmaService();
