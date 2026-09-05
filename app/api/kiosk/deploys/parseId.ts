/**
 * A deploy id from the URL: a positive integer, or null. Route files may only
 * export handler fields, so this lives beside them.
 */
export function parseDeployId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
