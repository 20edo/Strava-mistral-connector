# Strava → Mistral Connector

Pull your Strava activities and turn them into AI coaching insights with the Mistral API.

## What it does

1. **StravaClient** talks to the Strava API v3: fetches recent activities, handles OAuth token refresh automatically (proactive refresh before expiry, retry on 401).
2. **MistralClient** calls Mistral's chat completions API.
3. **connector.ts** formats activities into a coach prompt, runs the exchange, and computes training stats (km, time, elevation, breakdown by sport).

## Setup

```bash
npm install
npm run build
```

Create a Strava app at https://www.strava.com/settings/developer (callback domain can be `localhost`), get a Mistral API key at https://console.mistral.ai.

```bash
cp .env.example .env  # then fill in the values
```

## Usage

```bash
node dist/cli.js
```

Programmatic use:

```ts
import { StravaClient, MistralClient, coachOnRecentActivities } from 'strava-mistral-connector';

const strava = new StravaClient({ clientId, clientSecret, auth });
const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY! });
const { insights, stats } = await coachOnRecentActivities(strava, mistral, { perPage: 30 });
console.log(stats.totalKm, 'km this week\n', insights);
```

## Tests

```bash
npm test
```

Tests run fully offline against mocked Strava/Mistral HTTP responses: token refresh and retry, pagination, prompt/stats formatting, error handling.

## Environment variables

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava app credentials |
| `STRAVA_ACCESS_TOKEN` / `STRAVA_REFRESH_TOKEN` | Tokens from the OAuth flow |
| `STRAVA_EXPIRES_AT` | Access token expiry (epoch seconds) |
| `MISTRAL_API_KEY` | Mistral API key |

CI runs build + tests on every push via GitHub Actions (`.github/workflows/ci.yml`).
