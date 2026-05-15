// DEPRECATED: this path is preserved as a thin re-export so any legacy
// caller (Vercel cron cache, external monitoring) keeps working during
// the transition. Remove after 2026-05-29 once Vercel logs confirm
// ≥48h of zero traffic to this path.
export { GET } from '../update-cameras/route';
