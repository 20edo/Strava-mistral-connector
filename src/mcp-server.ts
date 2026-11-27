/**
 * Minimal MCP (Model Context Protocol) server over Streamable HTTP.
 *
 * Exposes Strava + Garmin + Mistral coaching tools so the connector can be
 * added to Mistral Vibe (Settings -> Connectors -> + Add Connector ->
 * Custom MCP Connector) or any other MCP client.
 *
 * Env:
 *   MCP_TOKEN            bearer token clients must send (omit to allow all)
 *   STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_ACCESS_TOKEN /
 *   STRAVA_REFRESH_TOKEN / STRAVA_EXPIRES_AT            Strava credentials
 *   MISTRAL_API_KEY      Mistral API key
 *   GARMIN_CONSUMER_KEY / GARMIN_CONSUMER_SECRET /
 *   GARMIN_USER_ACCESS_TOKEN / GARMIN_USER_ACCESS_TOKEN_SECRET   optional Garmin (Health API)
 *   PORT                 listen port (default 8080)
 */
import http from 'node:http';
import { StravaClient, type StravaActivity } from './strava';
import { MistralClient } from './mistral';
import { GarminClient } from './garmin';
import { buildWeeklySummary, formatKm, formatDuration, pace } from './connector';

// ---------- JSON-RPC / MCP plumbing ----------

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface McpContext {
  strava: StravaClient;
  mistral: MistralClient;
  garmin?: GarminClient;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: McpContext) => Promise<JsonValue>;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'strava_list_activities',
    description: "List the authenticated athlete's recent Strava activities, newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        perPage: { type: 'number', description: 'How many activities to return (1-200, default 10)' },
        afterDays: { type: 'number', description: 'Only activities from the last N days' },
      },
    },
    handler: async (args, ctx) => {
      const perPage = Math.min(Number(args.perPage ?? 10) || 10, 200);
      const afterDays = Number(args.afterDays);
      const after = Number.isFinite(afterDays) && afterDays > 0
        ? Math.floor(Date.now() / 1000) - afterDays * 86400
        : undefined;
      const acts = await ctx.strava.getActivities({ perPage, after });
      return acts.map((a) => ({
        id: a.id,
        date: a.start_date.slice(0, 10),
        name: a.name,
        sport: a.sport_type ?? a.type,
        distance_km: formatKm(a.distance),
        moving_time: formatDuration(a.moving_time),
        elevation_m: Math.round(a.total_elevation_gain),
        avg_heartrate: a.average_heartrate ? Math.round(a.average_heartrate) : undefined,
        pace: a.type === 'Run' && a.distance > 0 ? pace(a.moving_time / (a.distance / 1000)) : undefined,
      }));
    },
  },
  {
    name: 'strava_get_activity',
    description: 'Get full details of one Strava activity by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Strava activity id' } },
      required: ['id'],
    },
    handler: async (args, ctx) => {
      const a = await ctx.strava.getActivity(Number(args.id));
      return {
        id: a.id,
        date: a.start_date,
        name: a.name,
        sport: a.sport_type ?? a.type,
        distance_km: formatKm(a.distance),
        moving_time: formatDuration(a.moving_time),
        elevation_m: Math.round(a.total_elevation_gain),
        avg_hr: a.average_heartrate,
        max_hr: a.max_heartrate,
        suffer_score: a.suffer_score ?? undefined,
        calories: a.kcal,
      };
    },
  },
  {
    name: 'strava_weekly_stats',
    description: 'Aggregate training stats (activities, km, time, elevation, by sport) for the last N days.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Window in days (default 7)' } },
    },
    handler: async (args, ctx) => {
      const days = Number(args.days ?? 7) || 7;
      const after = Math.floor(Date.now() / 1000) - days * 86400;
      const acts = await ctx.strava.getAllActivities(after);
      return buildWeeklySummary(acts);
    },
  },
  {
    name: 'strava_coaching_report',
    description:
      'Generate an AI weekly coaching report with Mistral: compares this week vs last week (load progression, what went well, adjustments, next-week plan).',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional extra instruction, e.g. "preparing for a marathon"' },
      },
    },
    handler: async (args, ctx) => {
      const now = Math.floor(Date.now() / 1000);
      const recent = await ctx.strava.getAllActivities(now - 14 * 86400);
      const thisWeek = recent.filter((a) => Date.parse(a.start_date) / 1000 >= now - 7 * 86400);
      const lastWeek = recent.filter((a) => Date.parse(a.start_date) / 1000 < now - 7 * 86400);
      const tw = buildWeeklySummary(thisWeek);
      const lw = buildWeeklySummary(lastWeek);
      const deltaKm = Math.round((tw.totalKm - lw.totalKm) * 10) / 10;
      const fmt = (acts: StravaActivity[]) =>
        acts
          .map(
            (a) =>
              `- ${a.start_date.slice(0, 10)} | ${a.sport_type ?? a.type} | "${a.name}" | ` +
              `${formatKm(a.distance)} km | ${formatDuration(a.moving_time)}` +
              (a.average_heartrate ? ` | avg HR ${Math.round(a.average_heartrate)}` : ''),
          )
          .join('\n') || '(none)';
      const focus = typeof args.focus === 'string' && args.focus.trim() ? `\n\nExtra context from the athlete: ${args.focus}` : '';
      const prompt =
        `This week's Strava activities:\n${fmt(thisWeek)}\n\nLast week's activities:\n${fmt(lastWeek)}\n\n` +
        `Week-over-week: this week ${tw.count} activities, ${tw.totalKm} km, ${tw.totalTime}, ${tw.elevation} m; ` +
        `last week ${lw.count}, ${lw.totalKm} km, ${lw.totalTime}, ${lw.elevation} m (delta ${deltaKm >= 0 ? '+' : ''}${deltaKm} km).${focus}\n\n` +
        'As my endurance coach, write a weekly report: 1) week-over-week load change and whether it is healthy progression (10% rule), ' +
        '2) what went well, 3) what to adjust, 4) a concrete plan for next week with suggested sessions and target volumes. Under 300 words.';
      const report = await ctx.mistral.chat([
        { role: 'system', content: 'You are a concise, data-driven endurance coach.' },
        { role: 'user', content: prompt },
      ]);
      return { thisWeek: tw, lastWeek: lw, deltaKm, report };
    },
  },
  {
    name: 'garmin_hrv',
    description: 'Heart-rate-variability summary from Garmin for a calendar date (YYYY-MM-DD). Requires the Garmin Health API.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Calendar date YYYY-MM-DD' } },
      required: ['date'],
    },
    handler: async (args, ctx) => {
      if (!ctx.garmin) throw new Error('Garmin is not configured: set GARMIN_* env vars');
      return ctx.garmin.getHrv(dayStartEpoch(String(args.date)));
    },
  },
  {
    name: 'garmin_sleep',
    description: 'Sleep sessions (stages, score) from Garmin for a calendar date (YYYY-MM-DD). Requires the Garmin Health API.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Calendar date YYYY-MM-DD' } },
      required: ['date'],
    },
    handler: async (args, ctx) => {
      if (!ctx.garmin) throw new Error('Garmin is not configured: set GARMIN_* env vars');
      const ts = dayStartEpoch(String(args.date));
      return ctx.garmin.getSleeps(ts, ts + 86400);
    },
  },
  {
    name: 'garmin_daily_stress',
    description: 'Daily stress and body battery from Garmin for a calendar date (YYYY-MM-DD). Requires the Garmin Health API.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Calendar date YYYY-MM-DD' } },
      required: ['date'],
    },
    handler: async (args, ctx) => {
      if (!ctx.garmin) throw new Error('Garmin is not configured: set GARMIN_* env vars');
      return ctx.garmin.getDailyStress(dayStartEpoch(String(args.date)));
    },
  },
  {
    name: 'garmin_readiness_briefing',
    description:
      'AI readiness briefing with Mistral: combines Garmin HRV, sleep and stress for the last N days with recent Strava load into training-readiness advice.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many days of wellness data (default 7)' } },
    },
    handler: async (args, ctx) => {
      if (!ctx.garmin) throw new Error('Garmin is not configured: set GARMIN_* env vars');
      const days = Math.min(Number(args.days ?? 7) || 7, 28);
      const now = Math.floor(Date.now() / 1000);
      const wellnessLines: string[] = [];
      for (let i = 0; i < days; i++) {
        const dayTs = startOfUtcDay(now) - i * 86400;
        const date = new Date(dayTs * 1000).toISOString().slice(0, 10);
        const [hrv, sleep, stress] = await Promise.all([
          ctx.garmin.getHrv(dayTs),
          ctx.garmin.getSleeps(dayTs, dayTs + 86400),
          ctx.garmin.getDailyStress(dayTs),
        ]);
        const h = hrv[0];
        const s = sleep[0];
        const st = stress[0];
        wellnessLines.push(
          `${date}: HRV ${h?.hrvValue ?? 'n/a'} (${h?.hrvStatus ?? 'n/a'})` +
            ` | sleep ${s?.sleepTimeSeconds ? formatDuration(s.sleepTimeSeconds) : 'n/a'}` +
            ` (deep ${s?.deepSleepSeconds ? formatDuration(s.deepSleepSeconds) : 'n/a'}, REM ${s?.remSleepSeconds ? formatDuration(s.remSleepSeconds) : 'n/a'}` +
            `${s?.overallSleepScore?.value != null ? `, score ${s.overallSleepScore.value}` : ''})` +
            ` | stress ${st?.overallStressLevel ?? 'n/a'}` +
            ` | body battery ${st?.bodyBatteryMostRecentValue ?? 'n/a'}`,
        );
      }
      const acts = await ctx.strava.getActivities({ perPage: 15 });
      const loadLines = acts
        .filter((a) => Date.parse(a.start_date) / 1000 >= now - days * 86400)
        .map((a) => `- ${a.start_date.slice(0, 10)} | ${a.sport_type ?? a.type} | ${formatKm(a.distance)} km | ${formatDuration(a.moving_time)}`)
        .join('\n') || '(none)';
      const prompt =
        `Wellness data for the last ${days} days:\n${wellnessLines.join('\n')}\n\n` +
        `Recent training load:\n${loadLines}\n\n` +
        'As my endurance coach, give a training-readiness briefing: 1) today\'s readiness (low/medium/high) with the main signals, ' +
        '2) recovery trends to watch, 3) what to train today (or rest), with intensity guidance. Under 200 words.';
      const briefing = await ctx.mistral.chat([
        { role: 'system', content: 'You are a concise, data-driven endurance coach.' },
        { role: 'user', content: prompt },
      ]);
      return { briefing, wellness: wellnessLines };
    },
  },
];

function dayStartEpoch(calendarDate: string): number {
  return Math.floor(Date.parse(`${calendarDate}T00:00:00Z`) / 1000);
}

function startOfUtcDay(epochSeconds: number): number {
  return Math.floor(epochSeconds / 86400) * 86400;
}

export function rpcResult(id: RpcRequest['id'], result: JsonValue) {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id: RpcRequest['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function toolCatalog() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Handle a single JSON-RPC request. Returns null for notifications. */
export async function handleRpc(req: RpcRequest, ctx: McpContext): Promise<Record<string, unknown> | null> {
  switch (req.method) {
    case 'initialize':
      return rpcResult(req.id, {
        protocolVersion: String(req.params?.protocolVersion ?? '2025-06-18'),
        capabilities: { tools: {} },
        serverInfo: { name: 'strava-mistral-connector', version: '0.3.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(req.id, {});
    case 'tools/list':
      return rpcResult(req.id, { tools: toolCatalog() });
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const data = await tool.handler(args, ctx);
        return rpcResult(req.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (err) {
        return rpcResult(req.id, {
          content: [{ type: 'text', text: `Tool error: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export function isAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  return header === `Bearer ${token}`;
}

export function createContextFromEnv(): McpContext {
  const required = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_ACCESS_TOKEN', 'STRAVA_REFRESH_TOKEN', 'STRAVA_EXPIRES_AT', 'MISTRAL_API_KEY'];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing required env var: ${name}`);
  }
  const strava = new StravaClient({
    clientId: process.env.STRAVA_CLIENT_ID!,
    clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    auth: {
      accessToken: process.env.STRAVA_ACCESS_TOKEN!,
      refreshToken: process.env.STRAVA_REFRESH_TOKEN!,
      expiresAt: Number(process.env.STRAVA_EXPIRES_AT!),
    },
  });
  const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY! });
  const garmin =
    process.env.GARMIN_CONSUMER_KEY && process.env.GARMIN_CONSUMER_SECRET &&
    process.env.GARMIN_USER_ACCESS_TOKEN && process.env.GARMIN_USER_ACCESS_TOKEN_SECRET
      ? new GarminClient({
          consumerKey: process.env.GARMIN_CONSUMER_KEY,
          consumerSecret: process.env.GARMIN_CONSUMER_SECRET,
          userAccessToken: process.env.GARMIN_USER_ACCESS_TOKEN,
          userAccessTokenSecret: process.env.GARMIN_USER_ACCESS_TOKEN_SECRET,
        })
      : undefined;
  return { strava, mistral, garmin };
}

export function startServer(port = Number(process.env.PORT ?? 8080)): http.Server {
  const ctx = createContextFromEnv();
  const token = process.env.MCP_TOKEN;
  const server = http.createServer((req, res) => {
    // Health check endpoint for hosting platforms (Render, etc.)
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: TOOLS.length }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end('MCP server: POST JSON-RPC to /mcp');
      return;
    }
    if (!isAuthorized(req.headers.authorization, token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rpcError(null, -32001, 'Unauthorized')));
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => { body += c; });
    req.on('end', () => {
      void (async () => {
        let parsed: RpcRequest | RpcRequest[];
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rpcError(null, -32700, 'Parse error')));
          return;
        }
        const batch = Array.isArray(parsed) ? parsed : [parsed];
        const responses: Record<string, unknown>[] = [];
        for (const item of batch) {
          const out = await handleRpc(item, ctx);
          if (out) responses.push(out);
        }
        if (responses.length === 0) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
      })();
    });
  });
  server.listen(port, () => console.error(`Strava-Garmin-Mistral MCP server listening on :${port}`));
  return server;
}

if (process.env.RUN_MCP_SERVER === '1') {
  startServer();
}
