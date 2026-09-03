// scripts/migration-ledger.mjs
//
// The pure half of scripts/apply-migration.mjs: statement splitting and the
// applied-vs-pending reconciliation. Kept free of I/O so it can be tested
// without touching the one database this repo has.
//
// The ledger is a table in production, `schema_migrations`, one row per
// migration filename. It exists because until 2026-09-03 nothing recorded
// which of the 37 files in database/migrations/ had been applied: every PR
// re-derived it by probing information_schema, the "apply BEFORE deploying"
// rule was written into three specs as prose and never as a check, and a
// column shipped ahead of its migration cost a whole day of sweep telemetry
// silently. See docs/solutions/workflow-issues/migrations-need-a-ledger.md.

/** Strip `--` comments, then split on statement-terminating semicolons. */
export function statementsOf(sqlText) {
  return sqlText
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The ledger key for a migration: its basename, never its path. */
export function ledgerNameOf(path) {
  return path.split('/').pop();
}

/**
 * Reconcile the migration files on disk against the ledger rows.
 *
 * `files` are paths or basenames from database/migrations/; `applied` maps
 * basename -> { applied_at, note }. Returns every file in sorted order with
 * its state, plus `orphans`: ledger rows whose file no longer exists (a
 * renamed or deleted migration — worth a look, never auto-removed).
 */
export function statusOf(files, applied) {
  const names = [...new Set(files.map(ledgerNameOf))].sort();
  const rows = names.map((name) => {
    const row = applied.get(name);
    return row
      ? { name, state: 'applied', appliedAt: row.applied_at, note: row.note ?? null }
      : { name, state: 'pending', appliedAt: null, note: null };
  });
  const onDisk = new Set(names);
  const orphans = [...applied.keys()].filter((n) => !onDisk.has(n)).sort();
  return {
    rows,
    pending: rows.filter((r) => r.state === 'pending').map((r) => r.name),
    orphans,
  };
}

/** `2026-09-03 16:28` from a Date or ISO string; anything else is shown as-is. */
function shortStamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toISOString().slice(0, 16).replace('T', ' ');
}

/** One line per migration for the terminal, widest name first. */
export function formatStatus(status) {
  const width = Math.max(0, ...status.rows.map((r) => r.name.length));
  const lines = status.rows.map((r) =>
    r.state === 'applied'
      ? `  applied  ${r.name.padEnd(width)}  ${shortStamp(r.appliedAt)}${r.note ? '  ' + r.note : ''}`
      : `  PENDING  ${r.name}`,
  );
  for (const o of status.orphans) lines.push(`  orphan   ${o}  (in ledger, no file on disk)`);
  lines.push('');
  lines.push(
    status.pending.length === 0
      ? `All ${status.rows.length} migrations recorded as applied.`
      : `${status.pending.length} PENDING of ${status.rows.length}. Apply before deploying code that reads the new columns.`,
  );
  return lines.join('\n');
}
