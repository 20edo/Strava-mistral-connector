# Strava → Mistral Connector

Pull your Strava activities and turn them into AI coaching insights with the Mistral API.

## What it does

1. **Activities pull** — `StravaClient` talks to the Strava API v3: fetches recent activities (single, paginated with `getAllActivities`, date-filtered with `after`), and handles OAuth token refresh automatically (proactive refresh before expiry, retry on 401).
2. **Coaching** — `MistralClient` calls Mistral's chat completions API, and `connector.ts` turns activities into coach prompts.
3. **Training stats** — weekly summaries: km, time, elevation, breakdown by sport.

## Two coaching modes

- `coachOnRecentActivities` — analyzes the most recent activities: load summary, strengths, improvement suggestions, next-week suggestion.
- `weeklyCoachingReport` — pulls the last 14 days, splits them into this week vs last week, computes the week-over-week distance delta, and produces a full weekly report (load progression vs the 10% rule, what went well, what to adjust, a concrete plan for next week).

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
import { StravaClient, MistralClient, coachOnRecentActivities, weeklyCoachingReport } from 'strava-mistral-connector';

const strava = new StravaClient({ clientId, clientSecret, auth });
const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY!, model: 'mistral-medium-latest' });

// Quick insights on recent activities
const { insights, stats } = await coachOnRecentActivities(strava, mistral, { perPage: 30 });

// Full weekly report with week-over-week comparison
const { report, thisWeek, lastWeek, deltaKm } = await weeklyCoachingReport(strava, mistral);
console.log(`${thisWeek.totalKm} km this week (${deltaKm >= 0 ? '+' : ''}${deltaKm} km vs last week)\n`, report);
```

## Tests

```bash
npm test
```

Tests run fully offline against mocked Strava/Mistral HTTP responses: token refresh and retry, pagination, week splitting, prompt/stats formatting, error handling.

## Environment variables

| Variable | Description |
| --- | --- |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava app credentials |
| `STRAVA_ACCESS_TOKEN` / `STRAVA_REFRESH_TOKEN` | Tokens from the OAuth flow |
| `STRAVA_EXPIRES_AT` | Access token expiry (epoch seconds) |
| `MISTRAL_API_KEY` | Mistral API key |

CI runs build + tests on every push via GitHub Actions (`.github/workflows/ci.yml`).
