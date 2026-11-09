import { Node } from 'cc';
import { combat as cb, core, shared, sim } from './vendor/vgtd.mjs';
import { RemotePlayer, type TilePos } from './Actors';
import { CHIBI_CLASSES, chibiIdOfPath } from './ChibiBody';
import type { ArtFrames } from './PlaceholderArt';
import type { YSortLayer } from './YSortLayer';
import { TelegraphLayer } from './TelegraphLayer';

type InputFrame = ReturnType<InstanceType<typeof core.InputManager>['poll']>;

const KIND_PLAYER = 0;
const KIND_MONSTER = 1;

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function stored(storage: Storage | undefined, key: string, make: () => string): string {
  try {
    const have = storage?.getItem(key);
    if (have) return have;
    const v = make();
    storage?.setItem(key, v);
    return v;
  } catch {
    return make();
  }
}

/**
 * Online mode is opt-in: `?online=1`. Optional: `&server=host:port` (default <page host>:8080) and `&name=alice`
 * (default: a per-tab guest). Passwords are generated per browser and never typed or hard-coded; the server is local-only
 * for now (D27), so these are throw-away dev accounts.
 */
export function onlineRequested(): boolean {
  return new URLSearchParams(location.search).get('online') === '1';
}

/** closed beta (D111): `?invite=CODE` is sent with the first registration only; once the server accepted the character it is not sent again */
const invitedKey = (accountKey: string): string => `vgtd.invited.${accountKey}`;
export function markInviteUsed(accountKey: string): void {
  try {
    localStorage.setItem(invitedKey(accountKey), '1');
  } catch {
    /* private mode: the code is simply sent again, which costs one counted attempt */
  }
}

export function onlineCredentials(): { baseUrl: string; username: string; password: string; inviteCode?: string } {
  const q = new URLSearchParams(location.search);
  const srv = core.resolveServer(q.get('server'), location.hostname);
  if (srv.ignored)
    console.warn(`[vgtd] ignoring ?server=${q.get('server')}: only this page's host or localhost is allowed`);
  const baseUrl = srv.origin;
  const asked = (q.get('name') ?? '').toLowerCase();
  const named = /^[a-z0-9_]{3,20}$/.test(asked) ? asked : '';
  const username = named || stored(sessionStorage, 'vgtd.guest', () => `guest_${randomHex(3)}`);
  // named accounts keep their password in localStorage (so a reload / server restart can log in again); guests per tab.
  // Keyed by server origin too: a password is only ever sent to the origin it was generated for.
  const password = stored(named ? localStorage : sessionStorage, `vgtd.pw.${baseUrl}|${username}`, () => randomHex(16));
  const invite = (q.get('invite') ?? '').trim().slice(0, 64);
  let used = false;
  try {
    used = localStorage.getItem(invitedKey(`${baseUrl}|${username}`)) === '1';
  } catch {
    /* ignore */
  }
  return { baseUrl, username, password, ...(invite && !used ? { inviteCode: invite } : {}) };
}

/** Remote players have no class on the wire yet: pick one deterministically from the entity id. */
export function classForEntity(entityId: number): string {
  return CHIBI_CLASSES[entityId % CHIBI_CLASSES.length]!.id;
}

/**
 * Glue between client-core's NetClient (prediction, reconciliation, interpolation; engine-free, unit-tested) and the
 * scene: converts the InputFrame to an input intent, and owns the RemotePlayer actors.
 */
export class OnlineSession {
  readonly net: InstanceType<typeof core.NetClient>;
  readonly username: string;
  /** `<server origin>|<username>`: key of per-account browser storage (the remembered class) */
  readonly accountKey: string;
  private readonly actors = new Map<number, RemotePlayer>();
  /** mob attack danger areas (D89): ground decals under the actors */
  private readonly telegraphs: TelegraphLayer;
  private failed = '';
  /** server-authoritative combat backend (`?online=1&combat=1`); null = no combat HUD */
  private serverCombat: InstanceType<typeof cb.ServerCombat> | null = null;
  /** A boss in view entered a new phase (D91, `boss_phase`): the HUD / standee layer reacts (announcement, flash, skin swap). */
  onBossPhase: ((entityId: number, phase: number, transformMs: number) => void) | null = null;
  /** name / max HP of monsters in view (from `aoi_enter`; later snapshots only carry hpPct) */
  private readonly mobMeta = new Map<number, { name: string; defId: number; hpMax: number }>();

  constructor(
    private readonly ysort: YSortLayer,
    private readonly shadowLayer: Node,
    private readonly art: ArtFrames,
  ) {
    this.telegraphs = new TelegraphLayer(shadowLayer);
    const cred = onlineCredentials();
    this.username = cred.username;
    this.accountKey = `${cred.baseUrl}|${cred.username}`;
    this.net = new core.NetClient({
      ...cred,
      deps: {
        fetch: (url, init) => fetch(url, init),
        WebSocket: WebSocket as unknown as core.NetDeps['WebSocket'],
        now: () => performance.now(),
      },
      // the server announces its map size; its collision grid is open (D70), so the prediction grid is open too
      makeGrid: (n) => sim.TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    });
  }

  /**
   * Attach the combat backend: casts go out through `net.sendSkillCast`, and the NetClient hooks feed it `skill_result` (hits, cooldowns,
   * refusals), monsters entering / leaving view (`aoi_enter` carries max HP, snapshots only hpPct), the snapshot tick (server time) and the
   * own vitals (HP / MP / shield, wire v3). Create the backend with `send: (m) => online.sendCast(m)`.
   */
  attachCombat(sc: InstanceType<typeof cb.ServerCombat>): void {
    this.serverCombat = sc;
    this.net.events = {
      ...this.net.events, // keep hooks other HUD pieces chained (TribulationFx: onReconnect)
      onSkillResult: (msg) => sc.applySkillResult(msg, performance.now(), (i) => this.net.entityOfIndex(i)),
      onAoiEnter: (entities) => {
        for (const e of entities) {
          if (e.kind === KIND_MONSTER)
            this.mobMeta.set(e.entityId, { name: `Mob ${e.defId}`, defId: e.defId, hpMax: e.maxHp });
        }
      },
      onBossPhase: (msg) => this.onBossPhase?.(msg.mobEntityId, msg.phase, msg.transformMs),
      onAoiLeave: (indices) => {
        for (const i of indices) {
          const id = this.net.entityOfIndex(i); // the hook runs before removal: the index still resolves
          if (id === undefined) continue;
          this.mobMeta.delete(id);
          sc.removeEnemy(id);
        }
      },
      onSnapshot: (tick, _entities, self) => {
        sc.setServerTime(tick * shared.NETWORK.TICK_MS);
        const v = self?.vitals;
        if (v)
          sc.setSelfVitals({ hp: v.hp, hpMax: v.hpMax, mp: v.mp, mpMax: v.mpMax, shield: v.shield, alive: v.hp > 0 });
      },
    };
  }

  /** The last `skill_cast` handed to the transport (automation: scripts/touch-aim-smoke.mjs checks the aim that went out). */
  private lastCast: { seq: number; skillId: number; targetId: number; aim: { i: number; j: number } | null } | null =
    null;

  /** Transport hook for `cb.ServerCombat`: false when the socket is not open. */
  sendCast(m: { seq: number; skillId: number; targetId: number; aim: { i: number; j: number } | null }): boolean {
    this.lastCast = m;
    return this.net.sendSkillCast(m);
  }

  /** Debug hook for headless captures / the console: `window.__vgtdOnline()`. */
  private exposeDebug(): void {
    (window as unknown as Record<string, unknown>).__vgtdOnline = () => ({
      status: this.net.status,
      lastCast: this.lastCast,
      active: this.active,
      username: this.username,
      entityId: this.net.entityId,
      classId: this.net.classId,
      self: this.net.selfPosition(),
      predictionError: this.net.predictor?.lastError ?? null,
      pending: this.net.predictor?.pendingCount ?? null,
      rttMs: this.net.rttMs,
      snapshots: this.net.snapshots,
      reconnects: this.net.reconnects,
      telegraphs: this.net.telegraphs().map((t) => ({ id: t.id, shape: t.shape, progress: t.progress })),
      lastError: this.net.lastError,
      others: Array.from(this.actors.values()).map((a) => ({
        entityId: a.entityId,
        i: a.pos.i,
        j: a.pos.j,
        cls: a.classId,
      })),
    });
  }

  connect(): void {
    this.exposeDebug();
    this.net.connect().catch((e: unknown) => {
      this.failed = e instanceof Error ? e.message : String(e);
      console.error('[vgtd] online connect failed:', this.failed);
    });
  }

  /** True while the server drives the local character (connected and the first self state has arrived). */
  get active(): boolean {
    return this.net.status === 'online' && !!this.net.predictor?.ready;
  }
  /** Connecting (or logged in, waiting for the first snapshot): the character stands still. */
  get waiting(): boolean {
    const st = this.net.status;
    return st === 'connecting' || st === 'reconnecting' || (st === 'online' && !this.net.predictor?.ready);
  }

  /** Per-frame: feed the input, step the prediction, and sync the remote actors. Returns where to draw the local player. */
  step(dt: number, frame: InputFrame, walkMode: boolean): TilePos | null {
    const f = walkMode ? { ...frame, magnitude: frame.magnitude * 0.5 } : frame;
    this.net.update(dt * 1000, core.InputManager.toPacket(f));
    this.syncRemotes(dt * 1000);
    this.syncMobs();
    this.telegraphs.update(this.net.telegraphs());
    return this.net.selfPosition();
  }

  /** Monsters in view -> the combat backend (interpolated position, hp percent from snapshots); the HUD draws them. */
  private syncMobs(): void {
    const sc = this.serverCombat;
    if (!sc) return;
    for (const v of this.net.remotes()) {
      if (v.kind !== KIND_MONSTER) continue;
      const meta = this.mobMeta.get(v.entityId);
      if (!meta) continue;
      if (sc.enemy(v.entityId)) sc.syncEnemy(v.entityId, { i: v.i, j: v.j }, v.hpPct);
      else
        sc.upsertEnemy({
          id: v.entityId,
          name: meta.name,
          defId: meta.defId,
          pos: { i: v.i, j: v.j },
          hpPct: v.hpPct,
          hpMax: meta.hpMax,
        });
    }
  }

  private syncRemotes(dtMs: number): void {
    const seen = new Set<number>();
    for (const v of this.net.remotes()) {
      if (v.kind !== KIND_PLAYER) continue; // monsters / NPCs get their own actors later
      seen.add(v.entityId);
      let a = this.actors.get(v.entityId);
      if (!a) {
        // D82: a player's class rides in EnterEntity.defId (wire id 1..6); 0 = an old server that never said: keep the id-based guess
        const path = shared.pathOfClassWireId(v.defId);
        const cls = (path && chibiIdOfPath(path)) || classForEntity(v.entityId);
        a = new RemotePlayer(this.ysort, this.shadowLayer, this.art, v.entityId, cls, v);
        this.actors.set(v.entityId, a);
      }
      a.update(v, v.dir, v.speed, v.hpPct, dtMs);
      a.setStatusText(core.statusMaskGlyphs(this.net.statusMaskOf(v.entityId)));
    }
    // Cocos transpiles scripts loosely: for-of / spread over a Map silently breaks, so use forEach
    const gone: number[] = [];
    this.actors.forEach((a, id) => {
      if (!seen.has(id)) {
        a.destroy();
        gone.push(id);
      }
    });
    for (const id of gone) this.actors.delete(id);
  }

  /** One-line HUD status. */
  note(): string {
    const n = this.net;
    if (this.failed) return `online: ${this.failed} (offline controls active)`;
    if (n.status === 'closed') return `online: disconnected${n.lastError ? ` (${n.lastError})` : ''}`;
    if (n.status === 'reconnecting')
      return `online: connection lost, reconnecting${n.lastError ? ` (${n.lastError})` : ''}...`;
    if (!this.active) return `online: ${n.status}...`;
    const p = n.predictor!;
    return `online ${this.username} | rtt ${n.rttMs.toFixed(0)} ms | pending ${p.pendingCount} | err ${p.lastError.toFixed(3)} | others ${this.actors.size}`;
  }

  destroy(): void {
    this.net.close();
    this.telegraphs.destroy();
    this.actors.forEach((a) => a.destroy());
    this.actors.clear();
  }
}
