#!/usr/bin/env node
/**
 * CLI: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_ACCESS_TOKEN,
 * STRAVA_REFRESH_TOKEN, STRAVA_EXPIRES_AT, MISTRAL_API_KEY
 */
import { StravaClient } from './strava';
import { MistralClient } from './mistral';
import { coachOnRecentActivities } from './connector';

async function main() {
  const required = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_ACCESS_TOKEN', 'STRAVA_REFRESH_TOKEN', 'STRAVA_EXPIRES_AT', 'MISTRAL_API_KEY'];
  for (const name of required) {
    if (!process.env[name]) {
      console.error(`Missing required env var: ${name}`);
      process.exit(1);
    }
  }
  const strava = new StravaClient({
    clientId: process.env.STRAVA_CLIENT_ID!,
    clientSecret: process.env.STRAVA_CLIENT_SECRET!,
    auth: {
      accessToken: process.env.STRAVA_ACCESS_TOKEN!,
      refreshToken: process.env.STRAVA_REFRESH_TOKEN!,
      expiresAt: Number(process.env.STRAVA_EXPIRES_AT!),
    },
    onAuthUpdate: (auth) => {
      // Persist rotated tokens so the next run stays authenticated.
      console.error(`[auth] token rotated, new expires_at=${auth.expiresAt} (save it to your env/secret store)`);
    },
  });
  const mistral = new MistralClient({ apiKey: process.env.MISTRAL_API_KEY! });

  const { insights, stats } = await coachOnRecentActivities(strava, mistral);
  console.log(`Activities: ${stats.count} | Total: ${stats.totalKm} km | Time: ${stats.totalTime} | Elev: ${stats.elevation} m`);
  console.log('\n--- Coach insights (Mistral) ---\n');
  console.log(insights);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
