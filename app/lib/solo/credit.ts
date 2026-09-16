/**
 * A source's credit line, as the glass prints it (issue #220).
 *
 * Non-Windy sources write the attribution they require into
 * `webcams.urls->>'provider'` (source port, #215). Some of it is HTML — the
 * FAA's third-party attributions carry `<a>` tags and `<p>` notes — and the
 * glass shows text. Tags go, the few entities that appear are decoded, the
 * whitespace collapses, and an empty result is null so the caption draws
 * nothing rather than an empty line.
 */
export function creditText(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const text = provider
    .replace(/<br\s*\/?>|<\/?(?:p|div|li|ul|ol|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;|&#10;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}
