/**
 * Load milestones. The "initial package" of the P1 exit criteria (docs/10 section 12, `npm run perf:p1`) is what the game has to FETCH
 * before the player can play; everything fetched later is the lazy set. A wall-clock cut made that number depend on how fast the machine
 * was (lazy pages and prefetches landed on either side of it: the same build measured 20 and 24 MB). Instead the page names the moment:
 *
 *   `first_world_frame`: the world is built and the local player's own body (D71: the class locomotion of the first direction) is on
 *   screen. Marked once by `markFirstWorldFrame()`.
 *
 * Anything that is NOT needed to play (background chibi queue, direction prefetch, particle textures) waits for it through
 * `afterFirstWorldFrame(fn)`, so nothing lazy can be requested before the cut. With `?milestone=1` the page also sends one marker request
 * (`__vgtd_milestone/first_world_frame?why=body|fallback`): a harness that logs requests in arrival order cuts the log exactly there. The
 * state is published on `window.__vgtdMilestones` for automation.
 *
 * The body may never arrive (no chibi art, a failed index or rig load): `armFirstWorldFrameFallback(ms)`, armed once the world is built,
 * marks the milestone after a bounded time so the deferred work (particle textures) still runs. The marker then carries `why=fallback` and
 * the harness reports `cutBy` accordingly.
 */
const waiters: Array<() => void> = [];
let reached = false;

/** How long after the world is built the milestone is forced when the player's body has not arrived (no chibi art, failed load). */
export const FIRST_WORLD_FRAME_FALLBACK_MS = 15_000;

function publish(): void {
  (globalThis as unknown as { __vgtdMilestones?: { firstWorldFrame: boolean } }).__vgtdMilestones = {
    firstWorldFrame: reached,
  };
}

export function firstWorldFrameReached(): boolean {
  return reached;
}

/** Mark the milestone (idempotent): sends the marker request when asked for, then runs the deferred work in registration order. */
export function markFirstWorldFrame(why: 'body' | 'fallback' = 'body'): void {
  if (reached) return;
  reached = true;
  publish();
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('milestone') === '1')
      void fetch(`__vgtd_milestone/first_world_frame?why=${why}`, { cache: 'no-store' }).catch(() => undefined);
  } catch {
    /* a marker that cannot be sent only costs the harness its cut */
  }
  for (const fn of waiters.splice(0)) fn();
}

/** Run `fn` once the milestone is reached (at once when it already was). */
export function afterFirstWorldFrame(fn: () => void): void {
  if (reached) fn();
  else waiters.push(fn);
}

/** Bounded fallback: mark the milestone `ms` after the world was built if the player's body has not arrived by then. Returns the timer handle. */
export function armFirstWorldFrameFallback(ms: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => markFirstWorldFrame('fallback'), ms);
}

/** Test hook: back to "not reached" with no waiters. */
export function resetMilestonesForTest(): void {
  reached = false;
  waiters.length = 0;
  publish();
}

publish();
