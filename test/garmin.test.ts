import { describe, expect, it } from 'vitest';
import { percentEncode, buildOAuthHeader } from '../src/garmin';
import { handleRpc, type McpContext } from '../src/mcp-server';
import type { StravaActivity } from '../src/strava';

describe('OAuth 1.0a', () => {
  it('encodes reserved characters', () => {
    expect(percentEncode('a b')).toBe('a%20b');
    expect(percentEncode("a!'()*")).toBe('a%21%27%28%29%2A');
    expect(percentEncode('plain')).toBe('plain');
  });

  it('builds a signed Authorization header', () => {
    const header = buildOAuthHeader({
      method: 'GET',
      url: 'https://apis.garmin.com/wellness-api/rest/hrv/1700000000',
      consumerKey: 'ck',
      consumerSecret: 'cs',
      userAccessToken: 'ut',
      userAccessTokenSecret: 'uts',
      nonce: 'nonce1',
      timestamp: 1700000000,
    });
    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain('oauth_token="ut"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toMatch(/oauth_signature="[A-Za-z0-9+/=]+"/);
    // Deterministic: same inputs, same signature
    const again = buildOAuthHeader({
      method: 'GET',
      url: 'https://apis.garmin.com/wellness-api/rest/hrv/1700000000',
      consumerKey: 'ck', consumerSecret: 'cs', userAccessToken: 'ut', userAccessTokenSecret: 'uts',
      nonce: 'nonce1', timestamp: 1700000000,
    });
    expect(again).toBe(header);
    // Different secret -> different signature
    const other = buildOAuthHeader({
      method: 'GET',
      url: 'https://apis.garmin.com/wellness-api/rest/hrv/1700000000',
      consumerKey: 'ck', consumerSecret: 'other', userAccessToken: 'ut', userAccessTokenSecret: 'uts',
      nonce: 'nonce1', timestamp: 1700000000,
    });
    expect(other).not.toBe(header);
  });
});

const garminStub = {
  getHrv: async (ts: number) => [{ summaryId: 'h1', calendarDate: new Date(ts * 1000).toISOString().slice(0, 10), hrvValue: 58, hrvStatus: 'BALANCED' }],
  getSleeps: async () => [{ summaryId: 's1', sleepTimeSeconds: 27000, deepSleepSeconds: 4500, remSleepSeconds: 5400, overallSleepScore: { value: 82 } }],
  getDailyStress: async () => [{ overallStressLevel: 35, bodyBatteryMostRecentValue: 70 }],
};

const activity: StravaActivity = {
  id: 42, name: 'Run', type: 'Run', sport_type: 'Run', start_date: '2026-11-26T07:00:00Z',
  distance: 10234, moving_time: 3060, elapsed_time: 3150, total_elevation_gain: 120,
};

const ctx = {
  strava: { getActivities: async () => [activity] },
  mistral: { chat: async () => 'Readiness: medium.' },
  garmin: garminStub,
} as unknown as McpContext;

describe('Garmin MCP tools', () => {
  it('returns HRV data', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'garmin_hrv', arguments: { date: '2026-11-26' } } }, ctx)) as any;
    const data = JSON.parse(res.result.content[0].text);
    expect(data[0].hrvValue).toBe(58);
  });

  it('returns sleep data', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'garmin_sleep', arguments: { date: '2026-11-26' } } }, ctx)) as any;
    expect(JSON.parse(res.result.content[0].text)[0].sleepTimeSeconds).toBe(27000);
  });

  it('builds a readiness briefing across days', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'garmin_readiness_briefing', arguments: { days: 2 } } }, ctx)) as any;
    const data = JSON.parse(res.result.content[0].text);
    expect(data.wellness).toHaveLength(2);
    expect(data.briefing).toContain('Readiness');
  });

  it('errors clearly when Garmin is not configured', async () => {
    const bare = { strava: ctx.strava, mistral: ctx.mistral } as McpContext;
    const res = (await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'garmin_hrv', arguments: { date: '2026-11-26' } } }, bare)) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('GARMIN_*');
  });
});
