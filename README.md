# Strava → Garmin → Mistral Connector

Pull your Strava activities and Garmin wellness data (HRV, sleep, stress, body battery) and turn them into AI coaching insights with the Mistral API. Ships with an **MCP server** so it can be added as a connector in Mistral Vibe (left-hand Connectors menu).

## What it does

1. **Strava** (`strava.ts`): activities pull (single, paginated, date-filtered) with automatic OAuth token refresh (proactive refresh before expiry, retry on 401).
2. **Garmin** (`garmin.ts`): Health/Wellness REST API client with OAuth 1.0a HMAC-SHA1 signing — HRV, sleep sessions, daily stress, body battery.
3. **Coaching** (`connector.ts`): coach prompts and weekly stats (km, time, elevation, by sport); week-over-week reports.
4. **MCP server** (`mcp-server.ts`): exposes everything as tools over Streamable HTTP JSON-RPC for Vibe or any MCP client.

## MCP tools exposed

| Tool | Source | What it does |
| --- | --- | --- |
| `strava_list_activities` | Strava | Recent activities with km, time, pace, HR |
| `strava_get_activity` | Strava | Full detail of one activity by id |
| `strava_weekly_stats` | Strava | Aggregated stats for the last N days (by sport) |
| `strava_coaching_report` | Strava + Mistral | AI weekly report: week-over-week progression, next-week plan |
| `garmin_hrv` | Garmin | HRV summary for a date |
| `garmin_sleep` | Garmin | Sleep sessions, stages and score for a date |
| `garmin_daily_stress` | Garmin | Daily stress and body battery for a date |
| `garmin_readiness_briefing` | Garmin + Strava + Mistral | AI training-readiness briefing combining HRV, sleep, stress and training load |

Garmin tools are automatically available only when the `GARMIN_*` env vars are set; otherwise they return a clear configuration error.

## Getting Garmin Health API access

1. Apply to the Garmin Connect Developer Program (Health/Wellness API) at https://developer.garmin.com/garmin-connect-api/
2. Once approved, get your consumer key/secret
3. Complete the user OAuth 1.0a flow (Garmin's token exchange) to get a user access token/secret
4. Set `GARMIN_CONSUMER_KEY`, `GARMIN_CONSUMER_SECRET`, `GARMIN_USER_ACCESS_TOKEN`, `GARMIN_USER_ACCESS_TOKEN_SECRET`

## Use it as a connector in Mistral Vibe

1. **Deploy the server** somewhere public, e.g. Railway, Fly.io or Render:
   ```bash
   npm install && npm run build
   MCP_TOKEN=<a-long-random-string> PORT=8080 npm run start:mcp
   ```
2. **Add it in Vibe**: Settings → Connectors → **+ Add Connector** → **Custom MCP Connector** tab.
   - Connector name: `strava-mistral`
   - Server URL: `https://your-deployment.example.com/mcp`
   - Paste `MCP_TOKEN` when prompted for the bearer token.
3. The tools appear in the Connectors menu; toggle "Always allow" per function to pre-authorize.

## Local CLI usage

```bash
npm install && npm run build
cp .env.example .env  # fill in the values
node dist/cli.js
```

## Tests

```bash
npm test
```

Offline tests against mocked HTTP responses: token refresh and retry, pagination, week splitting, OAuth 1.0a signing (deterministic signatures, reserved-character encoding), MCP protocol handling (initialize, tools/list, tools/call, errors, auth), Garmin tools with and without configuration.

## Environment variables

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava app credentials |
| `STRAVA_ACCESS_TOKEN` / `STRAVA_REFRESH_TOKEN` | Tokens from the OAuth flow |
| `STRAVA_EXPIRES_AT` | Access token expiry (epoch seconds) |
| `MISTRAL_API_KEY` | Mistral API key |
| `MCP_TOKEN` | Bearer token MCP clients must send (recommended in production) |
| `PORT` | MCP server port (default 8080) |
| `GARMIN_CONSUMER_KEY` / `GARMIN_CONSUMER_SECRET` | Garmin app credentials (optional) |
| `GARMIN_USER_ACCESS_TOKEN` / `GARMIN_USER_ACCESS_TOKEN_SECRET` | Garmin user tokens (optional) |

CI runs build + tests on every push via GitHub Actions (`.github/workflows/ci.yml`).
