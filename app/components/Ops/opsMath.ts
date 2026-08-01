import type { ProviderUsageRow } from '@/app/lib/opsTypes';

export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// provider_usage_daily stores Neon's month-to-date counters (that is all the
// non-Scale API exposes), so per-day usage is the day-over-day delta. A
// negative delta means the month rolled over and the counter reset — the raw
// value IS that day's usage.
export function deriveDailyDeltas(
  rows: ProviderUsageRow[],
): { day: string; project_id: string; computeHours: number }[] {
  const byProject = new Map<string, ProviderUsageRow[]>();
  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(row);
    byProject.set(row.project_id, list);
  }
  const out: { day: string; project_id: string; computeHours: number }[] = [];
  for (const list of byProject.values()) {
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    for (let i = 1; i < sorted.length; i++) {
      const delta = sorted[i].compute_time_s - sorted[i - 1].compute_time_s;
      const seconds = delta < 0 ? sorted[i].compute_time_s : delta;
      out.push({
        day: sorted[i].day,
        project_id: sorted[i].project_id,
        computeHours: Math.round((seconds / 3600) * 100) / 100,
      });
    }
  }
  return out.sort(
    (a, b) => a.day.localeCompare(b.day) || a.project_id.localeCompare(b.project_id),
  );
}
