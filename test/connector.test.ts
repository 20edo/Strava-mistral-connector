import { describe, expect, it, vi } from 'vitest';
import { StravaClient, type StravaActivity, type FetchLike } from '../src/strava';
import { MistralClient } from '../src/mistral';
import { coachOnRecentActivities, buildWeeklySummary, formatDuration, pace, formatKm } from '../src/connector';

function jsonResponse(status: number, body: unknown): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

const futureAuth = {
  accessToken: 'tok',
  refreshToken: 'ref',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
};

const activity: StravaActivity = {
  id: 1,
  name: 'Morning run',
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-11-25T07:00:00Z',
  distance: 10234,
  moving_time: 3060,
  elapsed_time: 3150,
  total_elevation_gain: 120,
  average_heartrate: 150,
};

describe('helpers', () => {
  it('formats km, duration and pace', () => {
    expect(formatKm(activity.distance)).toBe(10.2);
    expect(formatDuration(3661)).toBe('1h01');
    expect(formatDuration(593)).toBe('9m53');
    expect(pace(3060 / 10.234)).toBe('4:59/km');
    expect(pace(0)).toBe('n/a');
  });
});

describe('weekly summary', () => {
  it('aggregates by sport', () => {
    const stats = buildWeeklySummary([
      activity,
      { ...activity, id: 2, sport_type: 'Ride', moving_time: 600, distance: 20000 },
    ]);
    expect(stats.count).toBe(2);
    expect(stats.totalKm).toBe(30.2);
    expect(stats.totalTime).toBe('1h01');
    expect(stats.elevation).toBe(240);
    expect(stats.bySport['Run']).toBe(10.2);
    expect(stats.bySport['Ride']).toBe(20);
    expect(buildWeeklySummary([])).toEqual({ count: 0, totalKm: 0, totalTime: '0m00', elevation: 0, bySport: {} });
  });
});

describe('StravaClient', () => {
  it('fetches activities with bearer token', async () => {
    const fetchMock = vi.fn(jsonResponse(200, [activity]));
    const client = new StravaClient({
      clientId: 'id',
      clientSecret: 'secret',
      auth: futureAuth,
      fetchImpl: fetchMock,
    });
    const result = await client.getActivities({ perPage: 5 });
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.strava.com/api/v3/athlete/activities?per_page=5');
    expect(init?.headers?.['Authorization']).toBe('Bearer tok');
  });

  it('refreshes the token on 401 and retries', async () => {
    const fetchMock: FetchLike = async (url, init) => {
      const auth = init?.headers?.['Authorization'];
      if (url.includes('/oauth/token')) {
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'new', refresh_token: 'ref2', expires_at: futureAuth.expiresAt + 3600 }),
          text: async () => '',
        };
      }
      if (auth === 'Bearer new') return jsonResponse(200, [activity])(url, init);
      return jsonResponse(401, { message: 'Unauthorized' })(url, init);
    };
    const client = new StravaClient({
      clientId: 'id',
      clientSecret: 'secret',
      auth: futureAuth,
      fetchImpl: fetchMock,
    });
    const result = await client.getActivities();
    expect(result).toHaveLength(1);
    expect(client.auth.refreshToken).toBe('ref2');
  });

  it('refreshes proactively when the token is about to expire', async () => {
    let refreshed = false;
    const fetchMock: FetchLike = async (url) => {
      if (url.includes('/oauth/token')) {
        refreshed = true;
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'fresh', refresh_token: 'ref', expires_at: futureAuth.expiresAt + 3600 }),
          text: async () => '',
        };
      }
      return jsonResponse(200, [activity])(url);
    };
    const client = new StravaClient({
      clientId: 'id',
      clientSecret: 'secret',
      auth: { ...futureAuth, expiresAt: Math.floor(Date.now() / 1000) + 10 },
      fetchImpl: fetchMock,
    });
    await client.getActivities();
    expect(refreshed).toBe(true);
  });

  it('surfaces API errors with the status code', async () => {
    const client = new StravaClient({
      clientId: 'id', clientSecret: 'secret', auth: futureAuth,
      fetchImpl: jsonResponse(403, { message: 'Forbidden' }),
    });
    await expect(client.getActivity(9)).rejects.toThrow(/403/);
  });

  it('paginates until a short page', async () => {
    const fetchMock: FetchLike = async (url) => {
      const page = Number(url.match(/[?&]page=(\d+)/)?.[1] ?? 1);
      return jsonResponse(200, page < 3 ? Array.from({ length: 200 }, (_, i) => ({ ...activity, id: i })) : [])(url);
    };
    const client = new StravaClient({
      clientId: 'id', clientSecret: 'secret', auth: futureAuth, fetchImpl: fetchMock,
    });
    expect(await client.getAllActivities()).toHaveLength(400);
    expect(await client.getAllActivities(undefined, 4)).toHaveLength(800);
  });

  it('forwards the after filter', async () => {
    let seen = '';
    const fetchMock: FetchLike = async (url) => { seen = url; return jsonResponse(200, [])(url); };
    const client = new StravaClient({
      clientId: 'id', clientSecret: 'secret', auth: futureAuth, fetchImpl: fetchMock,
    });
    await client.getAllActivities(1700000000);
    expect(seen).toContain('after=1700000000');
  });
});

describe('MistralClient', () => {
  it('sends chat completions with the API key', async () => {
    const fetchMock = vi.fn(jsonResponse(200, { choices: [{ message: { content: 'Great week!' } }] }));
    const client = new MistralClient({ apiKey: 'key', fetchImpl: fetchMock });
    const reply = await client.chat([{ role: 'user', content: 'hi' }]);
    expect(reply).toBe('Great week!');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init?.headers?.['Authorization']).toBe('Bearer key');
    expect(init?.body).toContain('mistral-small-latest');
  });

  it('throws on API errors and on missing content', async () => {
    const client = new MistralClient({ apiKey: 'key', fetchImpl: jsonResponse(429, { message: 'rate limit' }) });
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429/);
    const empty = new MistralClient({ apiKey: 'key', fetchImpl: jsonResponse(200, { choices: [] }) });
    await expect(empty.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no message content/);
  });
});

describe('coachOnRecentActivities', () => {
  it('runs end to end with fake APIs', async () => {
    const strava = new StravaClient({
      clientId: 'id', clientSecret: 'secret', auth: futureAuth,
      fetchImpl: jsonResponse(200, [activity]),
    });
    const mistral = new MistralClient({
      apiKey: 'key', fetchImpl: jsonResponse(200, { choices: [{ message: { content: 'Nice consistency.' } }] }),
    });
    const { insights, stats } = await coachOnRecentActivities(strava, mistral, { perPage: 10 });
    expect(insights).toBe('Nice consistency.');
    expect(stats.count).toBe(1);
    expect(stats.totalKm).toBe(10.2);
  });

  it('handles an empty activity list without calling Mistral', async () => {
    const strava = new StravaClient({
      clientId: 'id', clientSecret: 'secret', auth: futureAuth,
      fetchImpl: jsonResponse(200, []),
    });
    const mistral = new MistralClient({
      apiKey: 'key', fetchImpl: jsonResponse(500, {}),
    });
    const { insights } = await coachOnRecentActivities(strava, mistral);
    expect(insights).toContain('No activities');
  });
});
