/** Public shape of a rate-limit decision. Kept in a tiny dependency-free
 *  module so `src/lib/errors.ts` can reference it without dragging Redis
 *  into the import graph. */
export interface RateResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
  resetSeconds: number;
}
