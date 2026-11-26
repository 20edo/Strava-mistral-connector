export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number;
  total_elevation_gain: number; // meters
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number | null;
  kcal?: number;
}

export interface StravaAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
}

export interface StravaClientOptions {
  clientId: string;
  clientSecret: string;
  auth: StravaAuth;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  onAuthUpdate?: (auth: StravaAuth) => void;
}

const DEFAULT_BASE = 'https://www.strava.com/api/v3';

/**
 * Strava API v3 client with automatic token refresh on 401.
 */
export class StravaClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  auth: StravaAuth;

  constructor(private readonly opts: StravaClientOptions) {
    this.auth = { ...opts.auth };
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  }

  /** Refresh the access token using the stored refresh token. */
  async refreshAccessToken(): Promise<void> {
    const res = await this.fetchImpl('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.auth.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Strava token refresh failed (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; refresh_token: string; expires_at: number };
    this.auth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
    };
    this.opts.onAuthUpdate?.(this.auth);
  }

  private async request<T>(path: string, attempt = 0): Promise<T> {
    if (this.auth.expiresAt <= Math.floor(Date.now() / 1000) + 60) {
      await this.refreshAccessToken();
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.auth.accessToken}` },
    });
    if (res.status === 401 && attempt === 0) {
      await this.refreshAccessToken();
      return this.request<T>(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`Strava API error on ${path} (${res.status}): ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Fetch the authenticated athlete's activities, newest first. */
  async getActivities(options: { perPage?: number; after?: number } = {}): Promise<StravaActivity[]> {
    const perPage = Math.min(options.perPage ?? 30, 200);
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (options.after) params.set('after', String(options.after));
    return this.request<StravaActivity[]>(`/athlete/activities?${params.toString()}`);
  }

  /** Fetch all pages of activities within an epoch-seconds window. */
  async getAllActivities(after?: number, maxPages = 10): Promise<StravaActivity[]> {
    const out: StravaActivity[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ per_page: '200', page: String(page) });
      if (after) params.set('after', String(after));
      const batch = await this.request<StravaActivity[]>(`/athlete/activities?${params.toString()}`);
      out.push(...batch);
      if (batch.length < 200) break;
    }
    return out;
  }

  /** Fetch a single activity with full detail. */
  async getActivity(id: number): Promise<StravaActivity> {
    return this.request<StravaActivity>(`/activities/${id}`);
  }
}

function defaultFetch(url: string, init?: Parameters<FetchLike>[1]): ReturnType<FetchLike> {
  throw new Error(
    `No fetch implementation provided for ${url}. Pass fetchImpl (e.g. globalThis.fetch in Node 18+) in StravaClientOptions.`,
  );
}
