import { describe, expect, it } from 'vitest';
import { handleRpc, isAuthorized, toolCatalog, rpcError, type McpContext } from '../src/mcp-server';
import type { StravaActivity } from '../src/strava';

const activity: StravaActivity = {
  id: 42,
  name: 'Morning run',
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-11-26T07:00:00Z',
  distance: 10234,
  moving_time: 3060,
  elapsed_time: 3150,
  total_elevation_gain: 120,
  average_heartrate: 150,
};

const ctx: McpContext = {
  strava: {
    getActivities: async () => [activity],
    getAllActivities: async () => [activity],
    getActivity: async (id: number) => {
      if (id !== 42) throw new Error('not found');
      return activity;
    },
  },
  mistral: { chat: async () => 'Great progression this week.' },
} as unknown as McpContext;

describe('MCP server', () => {
  it('initializes and reports capabilities', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx)) as any;
    expect(res.result.serverInfo.name).toBe('strava-mistral-connector');
    expect(res.result.protocolVersion).toBe('2025-03-26');
    expect(res.result.capabilities.tools).toEqual({});
  });

  it('returns null for notifications', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
  });

  it('lists the four tools', async () => {
    expect(toolCatalog()).toHaveLength(4);
    const res = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)) as any;
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'strava_list_activities',
      'strava_get_activity',
      'strava_weekly_stats',
      'strava_coaching_report',
    ]);
  });

  it('calls strava_list_activities and returns parsed activity data', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'strava_list_activities', arguments: {} } }, ctx)) as any;
    const data = JSON.parse(res.result.content[0].text);
    expect(data[0]).toMatchObject({ id: 42, distance_km: 10.2, pace: '4:59/km' });
  });

  it('calls strava_coaching_report end to end', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'strava_coaching_report', arguments: {} } }, ctx)) as any;
    const data = JSON.parse(res.result.content[0].text);
    expect(data.report).toContain('Great progression');
    expect(data.thisWeek.count).toBe(1);
  });

  it('returns -32602 for unknown tools and -32601 for unknown methods', async () => {
    const t = (await handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, ctx)) as any;
    expect(t.error.code).toBe(-32602);
    const m = (await handleRpc({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, ctx)) as any;
    expect(m.error.code).toBe(-32601);
  });

  it('wraps handler failures as isError results', async () => {
    const res = (await handleRpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'strava_get_activity', arguments: { id: 999 } } }, ctx)) as any;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('Tool error');
  });

  it('checks bearer authorization', () => {
    expect(isAuthorized('Bearer tok', 'tok')).toBe(true);
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized(undefined, 'tok')).toBe(false);
    expect(isAuthorized('Bearer wrong', 'tok')).toBe(false);
    expect(rpcError(null, -32001, 'x').error.code).toBe(-32001);
  });
});
