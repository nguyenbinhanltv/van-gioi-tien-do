/** Measurement-window helpers shared by the load-test CLI and the P2 scenarios (apps/server/src/loadtest/scenarios.ts). */
import type { RunningServer } from '../server.js';
import { TICK_PHASES } from '../world/node.js';
import type { ServerClientStats, ServerSample } from './runner.js';

/** Copy the cumulative per-client counters so the window can be computed as a difference. */
export function copyStats(srv: RunningServer): Map<number, ServerClientStats> {
  const m = new Map<number, ServerClientStats>();
  for (const c of srv.world.clients.values()) m.set(c.id, { entityId: c.id, ...c.stats });
  return m;
}

export function windowSample(
  srv: RunningServer,
  base: Map<number, ServerClientStats>,
  durationS: number,
  cpu: NodeJS.CpuUsage,
): ServerSample {
  const clients: ServerClientStats[] = [];
  for (const c of srv.world.clients.values()) {
    const b = base.get(c.id);
    const s = c.stats;
    clients.push({
      entityId: c.id,
      bytesOut: s.bytesOut - (b?.bytesOut ?? 0),
      wireBytesOut: s.wireBytesOut - (b?.wireBytesOut ?? 0),
      framesOut: s.framesOut - (b?.framesOut ?? 0),
      bytesIn: s.bytesIn - (b?.bytesIn ?? 0),
      packetsIn: s.packetsIn - (b?.packetsIn ?? 0),
      snapshots: s.snapshots - (b?.snapshots ?? 0),
      snapshotsSkipped: s.snapshotsSkipped - (b?.snapshotsSkipped ?? 0),
      aoiEnter: s.aoiEnter - (b?.aoiEnter ?? 0),
      aoiLeave: s.aoiLeave - (b?.aoiLeave ?? 0),
      visibleSum: s.visibleSum - (b?.visibleSum ?? 0),
      visibleSamples: s.visibleSamples - (b?.visibleSamples ?? 0),
      visibleMax: s.visibleMax,
    });
  }
  return {
    tickMs: [...srv.world.tickMs],
    profile: {
      samples: Object.fromEntries(TICK_PHASES.map((k) => [k, [...srv.world.profile.samples[k]]])),
      slowTicks: srv.world.profile.slowTicks,
      slowBy: { ...srv.world.profile.slowBy },
    },
    tickIntervalMs: [...srv.world.tickIntervalMs],
    clients,
    durationS,
    phases: { ...srv.world.phases },
    metrics: { ...srv.world.metrics, violations: { ...srv.world.metrics.violations } },
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    rssMb: process.memoryUsage().rss / 1048576,
  };
}

/** Zero the tick samples and phase counters so the next sample covers only the measured window. */
export function resetWindow(srv: RunningServer): void {
  srv.world.tickMs.length = 0;
  srv.world.tickIntervalMs.length = 0;
  for (const k of TICK_PHASES) srv.world.profile.samples[k].length = 0;
  srv.world.profile.slowTicks = 0;
  for (const k of TICK_PHASES) srv.world.profile.slowBy[k] = 0;
  Object.assign(srv.world.phases, {
    stepMs: 0,
    aoiMs: 0,
    snapMs: 0,
    aoiTicks: 0,
    maxStepMs: 0,
    maxAoiMs: 0,
    maxSnapMs: 0,
  });
}
