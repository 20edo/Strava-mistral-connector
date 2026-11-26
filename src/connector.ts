import { StravaClient, type StravaActivity } from './strava';
import { MistralClient, type ChatMessage } from './mistral';

export function formatKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m${String(s).padStart(2, '0')}`;
}

export function pace(secPerKm: number | undefined): string {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return 'n/a';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

export function buildActivityPrompt(activities: StravaActivity[]): string {
  const lines = activities.map(
    (a) =>
      `- ${a.start_date.slice(0, 10)} | ${a.sport_type ?? a.type} | "${a.name}" | ` +
      `${formatKm(a.distance)} km | ${formatDuration(a.moving_time)} | ` +
      `elev ${Math.round(a.total_elevation_gain)} m` +
      (a.average_heartrate ? ` | avg HR ${Math.round(a.average_heartrate)}` : '') +
      (a.type === 'Run' && a.distance > 0
        ? ` | pace ${pace(a.moving_time / (a.distance / 1000))}`
        : ''),
  );
  return `Here are my recent Strava activities:\n${lines.join('\n')}\n\n` +
    'Act as a running/fitness coach. Give: 1) a summary of load and trends, ' +
    '2) two specific strengths, 3) two concrete improvement suggestions, 4) a suggested next week. Keep it under 250 words.';
}

export function buildWeeklySummary(activities: StravaActivity[]): {
  count: number;
  totalKm: number;
  totalTime: string;
  elevation: number;
  bySport: Record<string, number>;
} {
  const bySport: Record<string, number> = {};
  let meters = 0;
  let seconds = 0;
  for (const a of activities) {
    const sport = a.sport_type ?? a.type;
    bySport[sport] = (bySport[sport] ?? 0) + a.distance;
    meters += a.distance;
    seconds += a.moving_time;
  }
  return {
    count: activities.length,
    totalKm: formatKm(meters),
    totalTime: formatDuration(seconds),
    elevation: Math.round(meters === 0 ? 0 : activities.reduce((s, a) => s + a.total_elevation_gain, 0)),
    bySport: Object.fromEntries(Object.entries(bySport).map(([k, v]) => [k, formatKm(v)])),
  };
}

/** End-to-end: fetch recent Strava activities and ask Mistral for coaching insights. */
export async function coachOnRecentActivities(
  strava: StravaClient,
  mistral: MistralClient,
  options: { after?: number; perPage?: number; activities?: StravaActivity[] } = {},
): Promise<{ insights: string; stats: ReturnType<typeof buildWeeklySummary> }> {
  const activities = options.activities ?? (await strava.getActivities({ perPage: options.perPage ?? 30, after: options.after }));
  if (activities.length === 0) {
    return { insights: 'No activities found in the requested period.', stats: buildWeeklySummary([]) };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a concise, data-driven endurance coach.' },
    { role: 'user', content: buildActivityPrompt(activities) },
  ];
  const insights = await mistral.chat(messages);
  return { insights, stats: buildWeeklySummary(activities) };
}
