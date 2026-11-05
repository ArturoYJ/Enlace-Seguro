export interface Tokens { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number }
export interface Profile { user: { id: string; email: string; role: 'admin' | 'usuario' } }
export interface Metrics { dateRange: { startDate: string; endDate: string }; totalAttempts: number; byStatus: Record<string, number>; byVerdict: Record<string, number> }
export interface AuditEvent { id: string; occurredAt: string; eventType: string; actorType?: string; actorId?: string; action?: string; outcome?: string; resourceType?: string; resourceId?: string; requestId?: string; metadata?: Record<string, string | number> }
export interface AuditPage { items: AuditEvent[]; hasMore: boolean; nextCursor: string | null }
export interface DateRange { startDate: string; endDate: string }

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) { super('No se pudo completar la solicitud.'); this.status = status; }
}

export function apiBaseUrl(value: string | undefined, production: boolean): string {
  if (!value) throw new Error('Configura VITE_API_BASE_URL antes de iniciar la consola.');
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !production))) {
    throw new Error('La URL de API debe usar HTTPS; HTTP solo se permite en loopback durante desarrollo.');
  }
  return url.toString().replace(/\/$/, '');
}

/** Credentials live only in this instance; a page reload discards them. */
export class AdminApi {
  private tokens: Tokens | null = null;
  private refreshing: Promise<boolean> | null = null;
  private epoch = 0;
  private readonly base: string;
  private readonly onExpired: () => void;
  private readonly transport: typeof fetch;
  constructor(base: string, onExpired: () => void, transport: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.base = base; this.onExpired = onExpired; this.transport = transport;
  }

  clear(): void { this.tokens = null; this.epoch += 1; }

  async login(email: string, password: string): Promise<Profile> {
    this.clear();
    const epoch = this.epoch;
    const response = await this.transport(`${this.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), credentials: 'omit' });
    if (!response.ok) throw new ApiError(response.status);
    const tokens = await response.json() as Tokens;
    if (epoch !== this.epoch) throw new ApiError(401);
    if (typeof tokens.accessToken !== 'string' || !tokens.accessToken || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken) throw new ApiError(502);
    this.tokens = tokens;
    try {
      const profile = await this.request<Profile>('/auth/me');
      if (!profile.user || profile.user.role !== 'admin') { this.clear(); throw new ApiError(403); }
      return profile;
    } catch (error) { this.clear(); throw error; }
  }

  async logout(): Promise<void> {
    const refreshToken = this.tokens?.refreshToken;
    this.clear();
    if (refreshToken) {
      try { await this.transport(`${this.base}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), credentials: 'omit' }); } catch { /* local logout is immediate */ }
    }
  }

  async metrics(range: DateRange, signal?: AbortSignal): Promise<Metrics> {
    const result = await this.request<Metrics>(`/admin/metrics?${new URLSearchParams({ ...range })}`, signal);
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    const statuses = ['received', 'validation_failed', 'processing', 'completed', 'inconclusive', 'failed'];
    const verdicts = ['peligroso', 'sospechoso', 'sin_amenazas_detectadas'];
    if (!result || !count(result.totalAttempts) || !result.byStatus || !result.byVerdict ||
      !statuses.every(key => count(result.byStatus[key])) || !verdicts.every(key => count(result.byVerdict[key])) ||
      result.dateRange?.startDate !== range.startDate || result.dateRange?.endDate !== range.endDate) throw new ApiError(502);
    return result;
  }

  async audit(range: DateRange, eventType: string, cursor?: string, signal?: AbortSignal): Promise<AuditPage> {
    const params = new URLSearchParams({ ...range, limit: '20' });
    if (eventType) params.set('eventType', eventType);
    if (cursor) params.set('cursor', cursor);
    const result = await this.request<AuditPage>(`/admin/audit-events?${params}`, signal);
    if (!result || !Array.isArray(result.items) || typeof result.hasMore !== 'boolean' ||
      !(result.nextCursor === null || typeof result.nextCursor === 'string') ||
      (result.hasMore && !result.nextCursor) || result.items.some(item => !item || typeof item.id !== 'string' ||
        typeof item.eventType !== 'string' || typeof item.occurredAt !== 'string' || Number.isNaN(Date.parse(item.occurredAt)))) throw new ApiError(502);
    return result;
  }

  private async refresh(epoch: number): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) return false;
    this.refreshing = (async () => {
      const response = await this.transport(`${this.base}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), credentials: 'omit' });
      if (!response.ok) return false;
      const tokens = await response.json() as Tokens;
      if (epoch !== this.epoch || typeof tokens.accessToken !== 'string' || !tokens.accessToken ||
        typeof tokens.refreshToken !== 'string' || !tokens.refreshToken) return false;
      this.tokens = tokens;
      return true;
    })();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const epoch = this.epoch;
    if (!this.tokens) throw new ApiError(401);
    const send = () => this.transport(`${this.base}${path}`, { headers: { Authorization: `Bearer ${this.tokens!.accessToken}` }, credentials: 'omit', signal });
    let response = await send();
    if (response.status === 401 && epoch === this.epoch) {
      let refreshed = false;
      try { refreshed = await this.refresh(epoch); } catch { /* fail closed when refresh cannot complete */ }
      if (!refreshed || epoch !== this.epoch) {
        if (epoch === this.epoch) { this.clear(); this.onExpired(); }
        throw new ApiError(401);
      }
      response = await send();
    }
    if (epoch !== this.epoch) throw new ApiError(401);
    if (response.status === 401) { this.clear(); this.onExpired(); }
    if (!response.ok) throw new ApiError(response.status);
    return response.json() as Promise<T>;
  }
}
