# Strava → Mistral Connector

Pull your Strava activities and turn them into AI coaching insights with the Mistral API. Ships with an **MCP server** so it can be added as a connector in Mistral Vibe (left-hand Connectors menu).

## What it does

1. **Activities pull** — `StravaClient` talks to the Strava API v3: fetches recent activities (single, paginated, date-filtered), handles OAuth token refresh automatically (proactive refresh before expiry, retry on 401).
2. **Coaching** — `MistralClient` calls Mistral's chat completions API; `connector.ts` turns activities into coach prompts and weekly stats.
3. **MCP server** — `mcp-server.ts` exposes the connector as tools over Streamable HTTP JSON-RPC, so any MCP client (including Vibe) can call it.

## MCP tools exposed

| Tool | What it does |
| --- | --- |
| `strava_list_activities` | Recent activities with km, time, pace, HR |
| `strava_get_activity` | Full detail of one activity by id |
| `strava_weekly_stats` | Aggregated stats for the last N days (by sport) |
| `strava_coaching_report` | AI weekly report: this week vs last week, progression check, next-week plan |

## Use it as a connector in Mistral Vibe

1. **Deploy the server** somewhere public, e.g. Railway, Fly.io or Render:
   ```bash
   npm install && npm run build
   MCP_TOKEN=<a-long-random-string> PORT=8080 npm run start:mcp
   ```
   Set the same env vars as below (Strava credentials, `MISTRAL_API_KEY`, `MCP_TOKEN`).
2. **Add it in Vibe**: Settings → Connectors → **+ Add Connector** → **Custom MCP Connector** tab.
   - Connector name: `strava-mistral`
   - Server URL: `https://your-deployment.example.com/mcp`
   - The platform auto-detects the bearer-token auth; paste `MCP_TOKEN` when prompted.
3. The four tools appear in the Connectors menu; toggle "Always allow" per function if you want pre-authorization.

## Local CLI usage

```bash
npm install && npm run build
cp .env.example .env  # fill in the values
node dist/cli.js
```

Programmatic use:

```ts
import { StravaClient, MistralClient, coachOnRecentActivities, weeklyCoachingReport } from 'strava-mistral-connector';

const strava = new StravaClient({ clientId, clientSecret, auth });
const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY!, model: 'mistral-medium-latest' });

const { insights, stats } = await coachOnRecentActivities(strava, mistral, { perPage: 30 });
const { report, thisWeek, lastWeek, deltaKm } = await weeklyCoachingReport(strava, mistral);
```

## Tests

```bash
npm test
```

Offline tests against mocked Strava/Mistral HTTP responses: token refresh and retry, pagination, week splitting, MCP protocol handling (initialize, tools/list, tools/call, errors, auth), prompt/stats formatting.

## Environment variables

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava app credentials |
| `STRAVA_ACCESS_TOKEN` / `STRAVA_REFRESH_TOKEN` | Tokens from the OAuth flow |
| `STRAVA_EXPIRES_AT` | Access token expiry (epoch seconds) |
| `MISTRAL_API_KEY` | Mistral API key |
| `MCP_TOKEN` | Bearer token MCP clients must send (recommended in production) |
| `PORT` | MCP server port (default 8080) |

CI runs build + tests on every push via GitHub Actions (`.github/workflows/ci.yml`).
