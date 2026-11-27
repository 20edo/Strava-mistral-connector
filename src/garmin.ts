/**
 * Garmin Health (Wellness REST) API client with OAuth 1.0a HMAC-SHA1 signing.
 *
 * Requires access to the Garmin Connect Developer Program:
 *   1. Apply at https://developer.garmin.com/garmin-connect-api/ (Health API)
 *   2. Get your consumer key/secret
 *   3. Exchange your user approval for a user access token/secret
 *      (Garmin provides a token-exchange endpoint once you are approved)
 *
 * Env: GARMIN_CONSUMER_KEY, GARMIN_CONSUMER_SECRET,
 *      GARMIN_USER_ACCESS_TOKEN, GARMIN_USER_ACCESS_TOKEN_SECRET
 */
import crypto from 'node:crypto';
import type { FetchLike } from './strava';

const BASE = 'https://apis.garmin.com';

export interface GarminSleepSession {
  summaryId: string;
  calendarDate: string;
  sleepTimeSeconds?: number;
  unmeasurableSleepSeconds?: number;
  deepSleepSeconds?: number;
  lightSleepSeconds?: number;
  remSleepSeconds?: number;
  awakeSleepSeconds?: number;
  overallSleepScore?: { value: number | null };
  sleepStartTimestampGMT?: number;
  sleepEndTimestampGMT?: number;
}

export interface GarminHrv {
  summaryId: string;
  calendarDate: string;
  hrvValue?: number;
  hrvStatus?: string;
  weeklyAvg?: number;
  lastNightAvg?: number;
  lastNight5MinHigh?: number;
  baseline?: string;
}

export interface GarminDailyStress {
  summaryId?: string;
  calendarDate?: string;
  overallStressLevel?: number | null;
  restingStressLevel?: number | null;
  bodyBatteryMostRecentValue?: number | null;
  bodyBatteryHighestValue?: number | null;
  bodyBatteryLowestValue?: number | null;
}

export interface GarminClientOptions {
  consumerKey: string;
  consumerSecret: string;
  userAccessToken: string;
  userAccessTokenSecret: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Build the OAuth 1.0a Authorization header for a signed GET request. */
export function buildOAuthHeader(options: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  userAccessToken: string;
  userAccessTokenSecret: string;
  nonce: string;
  timestamp: number;
  extraParams?: Record<string, string>;
}): string {
  const { method, url, consumerKey, consumerSecret, userAccessToken, userAccessTokenSecret, nonce, timestamp } = options;
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: userAccessToken,
    oauth_version: '1.0',
    ...options.extraParams,
  };

  const [baseUrl, query = ''] = url.split('?');
  const allParams: Record<string, string> = { ...oauthParams };
  for (const [k, v] of new URLSearchParams(query).entries()) allParams[k] = v;

  const encoded = Object.keys(allParams)
    .map((k) => [percentEncode(k), percentEncode(allParams[k])] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const baseString = [method.toUpperCase(), percentEncode(baseUrl), percentEncode(encoded)].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(userAccessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  const headerParams = { ...oauthParams, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.entries(headerParams)
      .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
      .join(', ')
  );
}

export class GarminClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly opts: GarminClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? (() => {
      throw new Error('No fetch implementation provided. Pass fetchImpl in GarminClientOptions.');
    });
    this.baseUrl = (opts.baseUrl ?? BASE).replace(/\/$/, '');
  }

  private async request<T>(path: string, attempt = 0): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const header = buildOAuthHeader({
      method: 'GET',
      url,
      consumerKey: this.opts.consumerKey,
      consumerSecret: this.opts.consumerSecret,
      userAccessToken: this.opts.userAccessToken,
      userAccessTokenSecret: this.opts.userAccessTokenSecret,
      nonce: crypto.randomBytes(16).toString('hex'),
      timestamp: Math.floor(Date.now() / 1000),
    });
    const res = await this.fetchImpl(url, { headers: { Authorization: header } });
    // Garmin user tokens expire after one year and are refreshed via the
    // token-exchange endpoint; surface a clear error when that time comes.
    if (res.status === 401 && attempt === 0) {
      throw new Error('Garmin API returned 401: the user access token may have expired. Re-run the token exchange.');
    }
    if (res.status === 204) return [] as unknown as T; // "no data for this period"
    if (!res.ok) throw new Error(`Garmin API error on ${path} (${res.status}): ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Sleep sessions, including stages and sleep score. */
  async getSleeps(startEpochSeconds: number, endEpochSeconds: number): Promise<GarminSleepSession[]> {
    return this.request<GarminSleepSession[]>(
      `/wellness-api/rest/sleeps?uploadStartTimeInSeconds=${startEpochSeconds}&uploadEndTimeInSeconds=${endEpochSeconds}`,
    );
  }

  /** Heart-rate-variability summary for an epoch-seconds day start. */
  async getHrv(dateEpochSeconds: number): Promise<GarminHrv[]> {
    return this.request<GarminHrv[]>(`/wellness-api/rest/hrv/${dateEpochSeconds}`);
  }

  /** Daily stress and body-battery data for an epoch-seconds day start. */
  async getDailyStress(dateEpochSeconds: number): Promise<GarminDailyStress[]> {
    return this.request<GarminDailyStress[]>(`/wellness-api/rest/dailyStress/${dateEpochSeconds}`);
  }

  /** Convenience: HRV, sleep and stress for a calendar date (YYYY-MM-DD, UTC). */
  async getDailyWellness(calendarDate: string): Promise<{ hrv: GarminHrv[]; sleep: GarminSleepSession[]; stress: GarminDailyStress[] }> {
    const ts = Math.floor(Date.parse(`${calendarDate}T00:00:00Z`) / 1000);
    const [hrv, sleep, stress] = await Promise.all([
      this.getHrv(ts),
      this.getSleeps(ts, ts + 86400),
      this.getDailyStress(ts),
    ]);
    return { hrv, sleep, stress };
  }
}
