/**
 * Gameplay bot for the P5 soak / load test (docs/10 §12, docs/28 §6): the REAL client netcode (`NetClient` from client-core: login,
 * prediction, reconciliation, interpolation, reconnect) driven by a small behaviour script with human-ish pacing. It picks a class at
 * creation, walks, hunts monsters with its class skills, claims loot and drinks a heal pill when hurt, meditates, chats in the World channel,
 * invites / accepts party members and leaves again. No browser, no rendering; everything goes through the real gateway and world node.
 *
 * Deterministic behaviour stream per bot (`seed`), a shared 30 Hz driver (`GameBot.update`), counters for the report. A bot never lies about
 * time or position (anti-cheat honest): the cheater kinds of the P2 harness stay in bot.ts.
 */
import { WebSocket } from 'ws';
import { ChatChannel, PartyOp, type SkillResultMsg } from '@vgtd/protocol';
import { HIT_FLAG_KILL, PATHS, skillDefinitions, skillsOf, type PathId } from '@vgtd/shared';
import { TileGrid, compileSkills } from '@vgtd/sim';
import { NetClient, type MoveIntent, type NetDeps } from '@vgtd/client-core/src/net/index.js';
import { encodeDir } from '@vgtd/client-core/src/core/IsoMath.js';
import { LOADTEST_PASSWORD } from './bot.js';

/** Mob entities carry `kind` 1 on the wire (docs/24 `EnterEntity.kind`). */
const KIND_MONSTER = 1;
/** Hunting stops this close to the monster (skills reach 2.5 tiles and more). */
const ENGAGE_TILES = 1.8;
/** Look for monsters this far (tiles). */
const SIGHT_TILES = 24;
const MAG_FULL = 15;
const GCD_MS = skillDefinitions.global?.gcd_ms ?? 800;

export interface GameBotOptions {
  baseUrl: string;
  name: string;
  /** class asked for on the first login (a path id); the server keeps it for the character */
  path: PathId;
  seed: number;
  /** bots wander inside this square (tile coordinates) */
  area: { i0: number; j0: number; side: number };
  /** names of every bot of the run (party invites pick one of them) */
  roster: readonly string[];
  /** behaviour weights and pacing; default = `REALISTIC` */
  profile?: Profile;
}

/** Activity mix and pacing in ms (docs/28 S1/S2: hunting with some social traffic). */
export interface Profile {
  /** relative weights of the next activity */
  weights: { hunt: number; wander: number; idle: number; meditate: number };
  idleMs: [number, number];
  wanderLegMs: [number, number];
  huntMaxMs: number;
  meditateMs: [number, number];
  chatEveryMs: [number, number];
  partyEveryMs: [number, number];
  bagEveryMs: [number, number];
}

export const REALISTIC: Profile = {
  weights: { hunt: 55, wander: 25, idle: 12, meditate: 8 },
  idleMs: [2000, 8000],
  wanderLegMs: [3000, 9000],
  huntMaxMs: 35_000,
  meditateMs: [15_000, 45_000],
  chatEveryMs: [40_000, 120_000],
  partyEveryMs: [120_000, 300_000],
  bagEveryMs: [20_000, 45_000],
};

/** The profile with the social cadence (chat, party, bag) divided by `factor`: a short run (CI smoke) still exercises those paths. */
export function socialPaced(factor: number, base: Profile = REALISTIC): Profile {
  const k = (r: [number, number]): [number, number] => [r[0] * factor, r[1] * factor];
  return {
    ...base,
    chatEveryMs: k(base.chatEveryMs),
    partyEveryMs: k(base.partyEveryMs),
    bagEveryMs: k(base.bagEveryMs),
  };
}

export interface GameBotStats {
  name: string;
  path: PathId;
  /** NetClient status at the time of the report ('online' = fine) */
  status: string;
  entityId: number;
  /** reconnects that succeeded / the session ended for good (kicked, closed) */
  reconnects: number;
  ended: boolean;
  lastError: string;
  snapshots: number;
  casts: number;
  castsAccepted: number;
  castsRefused: number;
  kills: number;
  deaths: number;
  chatSent: number;
  chatDelivered: number;
  partyInvitesSent: number;
  partyJoins: number;
  partyLeaves: number;
  bagClaims: number;
  pillsUsed: number;
  meditations: number;
  /** distance walked (tiles, from the predicted position) */
  walked: number;
  rttMs: number;
}

type Mode = 'idle' | 'wander' | 'hunt' | 'meditate';

function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deps: NetDeps = {
  fetch: (url, init) => fetch(url, init),
  WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
  now: () => performance.now(),
};

const CHAT_LINES = [
  'ai di san quai khong?',
  'tim to doi',
  'vua dot pha xong',
  'quai o day ro qua',
  'co ai ban dan hoi mau khong',
  'hello moi nguoi',
  'dang tu luyen, ghe qua',
  'dao huu nao o gan day',
];

export class GameBot {
  readonly net: NetClient;
  readonly stats: GameBotStats;
  private readonly rnd: () => number;
  private readonly profile: Profile;
  private readonly castable: Array<{ wireId: number; cooldownMs: number; castMs: number }>;
  private readonly cdReadyAt: number[];
  private mode: Mode = 'idle';
  private modeUntilMs = 0;
  private target: { i: number; j: number } | null = null;
  private huntId = 0;
  private gcdReadyAt = 0;
  private castSeq = 0;
  private chatId = 0;
  private partyId = 0;
  private nextChatMs: number;
  private nextPartyMs: number;
  private nextBagMs: number;
  private acceptAtMs = -1;
  private inParty = false;
  private hp = 1;
  private hpMax = 1;
  private reqSeq = 0;
  private lastPos: { i: number; j: number } | null = null;
  private clock = 0;
  private started = false;

  constructor(private readonly o: GameBotOptions) {
    this.rnd = rngOf(o.seed);
    this.profile = o.profile ?? REALISTIC;
    const compiled = compileSkills();
    this.castable = skillsOf(o.path)
      .filter((s) => s.kind === 'active' && s.timing.cast_ms >= 0)
      .flatMap((s) => {
        const c = compiled.find((k) => k.key === s.id);
        return c ? [{ wireId: c.id, cooldownMs: s.timing.cooldown_ms ?? 0, castMs: s.timing.cast_ms }] : [];
      });
    this.cdReadyAt = this.castable.map(() => 0);
    this.nextChatMs = this.between(this.profile.chatEveryMs);
    this.nextPartyMs = this.between(this.profile.partyEveryMs);
    this.nextBagMs = this.between(this.profile.bagEveryMs);
    this.stats = {
      name: o.name,
      path: o.path,
      status: 'idle',
      entityId: 0,
      reconnects: 0,
      ended: false,
      lastError: '',
      snapshots: 0,
      casts: 0,
      castsAccepted: 0,
      castsRefused: 0,
      kills: 0,
      deaths: 0,
      chatSent: 0,
      chatDelivered: 0,
      partyInvitesSent: 0,
      partyJoins: 0,
      partyLeaves: 0,
      bagClaims: 0,
      pillsUsed: 0,
      meditations: 0,
      walked: 0,
      rttMs: 0,
    };
    this.net = new NetClient({
      baseUrl: o.baseUrl,
      username: o.name,
      password: LOADTEST_PASSWORD,
      classId: o.path,
      deps,
      makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
      events: {
        onSkillResult: (m) => this.onSkillResult(m),
        onSnapshot: (_tick, _e, self) => {
          if (self?.vitals) {
            if (this.hp > 0 && self.vitals.hp <= 0) this.stats.deaths++;
            this.hp = self.vitals.hp;
            this.hpMax = self.vitals.hpMax;
          }
        },
      },
    });
    this.net.chatEvents = {
      onChatResult: (m) => {
        if (m.reason === 0) this.stats.chatDelivered++;
      },
    };
    this.net.partyEvents = {
      onPartyInvite: () => {
        this.acceptAtMs = this.clock + 1000 + this.rnd() * 2000; // a human reads it first
      },
      onPartyState: (m) => {
        const now = m.members.length > 1;
        if (now && !this.inParty) this.stats.partyJoins++;
        this.inParty = now;
      },
    };
  }

  private between(r: [number, number]): number {
    return r[0] + this.rnd() * (r[1] - r[0]);
  }
  private requestId(): string {
    return (++this.reqSeq).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
  }

  /** Log in (registers on first use) and start; resolves once the session is online. */
  async connect(): Promise<void> {
    await this.net.connect();
    this.started = true;
    this.stats.entityId = this.net.entityId;
  }

  private onSkillResult(m: SkillResultMsg): void {
    if (m.reason === 0) {
      this.stats.castsAccepted++;
      for (const h of m.hits) if (h.flags & HIT_FLAG_KILL) this.stats.kills++;
    } else this.stats.castsRefused++;
  }

  /** Advance the bot by `dtMs` (call at ~30 Hz); `nowMs` is a monotonic clock shared by the driver. */
  update(nowMs: number, dtMs: number): void {
    this.clock = nowMs;
    if (!this.started) return;
    const st = this.net.status;
    this.stats.status = st;
    if (st === 'closed') {
      this.stats.ended = true;
      this.stats.lastError = this.net.lastError;
      return;
    }
    let intent: MoveIntent = { dir: 255, mag: 0, flags: 0 };
    const pos = this.net.selfPosition();
    if (pos && st === 'online' && this.hp > 0) {
      if (this.lastPos) this.stats.walked += Math.hypot(pos.i - this.lastPos.i, pos.j - this.lastPos.j);
      this.lastPos = { ...pos };
      intent = this.behave(nowMs, pos);
    } else if (this.hp <= 0) {
      this.mode = 'idle'; // down: the server respawns the character after its timer
      this.target = null;
    }
    this.net.update(dtMs, intent);
    this.stats.snapshots = this.net.snapshots;
    this.stats.reconnects = this.net.reconnects;
    this.stats.rttMs = this.net.rttMs;
    if (this.net.lastError) this.stats.lastError = this.net.lastError;
  }

  // ------------------------------------------------------------------ behaviour
  private behave(now: number, pos: { i: number; j: number }): MoveIntent {
    this.social(now);
    if (now >= this.modeUntilMs) this.pickMode(now, pos);
    const idle: MoveIntent = { dir: 255, mag: 0, flags: 0 };
    switch (this.mode) {
      case 'idle':
      case 'meditate':
        return idle;
      case 'wander': {
        if (!this.target || Math.hypot(this.target.i - pos.i, this.target.j - pos.j) < 0.8) {
          this.target = this.waypoint();
        }
        return this.walkTo(pos, this.target!);
      }
      case 'hunt':
        return this.hunt(now, pos);
    }
  }

  private waypoint(): { i: number; j: number } {
    const a = this.o.area;
    return { i: a.i0 + this.rnd() * a.side, j: a.j0 + this.rnd() * a.side };
  }

  private walkTo(pos: { i: number; j: number }, to: { i: number; j: number }): MoveIntent {
    const di = to.i - pos.i;
    const dj = to.j - pos.j;
    if (Math.hypot(di, dj) < 0.2) return { dir: 255, mag: 0, flags: 0 };
    return { dir: encodeDir(di, dj), mag: MAG_FULL, flags: 0 };
  }

  private pickMode(now: number, pos: { i: number; j: number }): void {
    if (this.mode === 'meditate') {
      this.net.sendMeditate(false, this.requestId());
    }
    const w = this.profile.weights;
    let x = this.rnd() * (w.hunt + w.wander + w.idle + w.meditate);
    let next: Mode;
    if ((x -= w.hunt) < 0) next = 'hunt';
    else if ((x -= w.wander) < 0) next = 'wander';
    else if ((x -= w.idle) < 0) next = 'idle';
    else next = 'meditate';
    if (next === 'hunt' && !this.nearestMonster(pos)) next = 'wander'; // nothing in sight: look around
    this.mode = next;
    this.target = null;
    this.huntId = 0;
    if (next === 'hunt') {
      this.modeUntilMs = now + this.profile.huntMaxMs;
    } else if (next === 'idle') this.modeUntilMs = now + this.between(this.profile.idleMs);
    else if (next === 'wander') this.modeUntilMs = now + this.between(this.profile.wanderLegMs);
    else {
      this.modeUntilMs = now + this.between(this.profile.meditateMs);
      this.net.sendMeditate(true, this.requestId());
      this.stats.meditations++;
    }
  }

  private nearestMonster(pos: { i: number; j: number }): { id: number; i: number; j: number } | null {
    let best: { id: number; i: number; j: number } | null = null;
    let bd = SIGHT_TILES;
    for (const r of this.net.remotes()) {
      if (r.kind !== KIND_MONSTER || r.hpPct <= 0) continue;
      const d = Math.hypot(r.i - pos.i, r.j - pos.j);
      if (d < bd) {
        bd = d;
        best = { id: r.entityId, i: r.i, j: r.j };
      }
    }
    return best;
  }

  private hunt(now: number, pos: { i: number; j: number }): MoveIntent {
    let m = this.huntId ? this.net.remotes().find((r) => r.entityId === this.huntId && r.hpPct > 0) : undefined;
    if (!m) {
      const n = this.nearestMonster(pos);
      if (!n) {
        this.modeUntilMs = now; // it died (or none in sight): choose again
        return { dir: 255, mag: 0, flags: 0 };
      }
      this.huntId = n.id;
      m = this.net.remotes().find((r) => r.entityId === n.id)!;
    }
    const d = Math.hypot(m.i - pos.i, m.j - pos.j);
    if (d > ENGAGE_TILES) return this.walkTo(pos, { i: m.i, j: m.j });
    this.cast(now, m.entityId, { dir: encodeDir(m.i - pos.i, m.j - pos.j) });
    // stand still while casting but keep facing the monster
    return { dir: encodeDir(m.i - pos.i, m.j - pos.j), mag: 0, flags: 0 };
  }

  /** One skill of the class's kit per GCD, honouring each skill's own cooldown like a real client would. */
  private cast(now: number, targetId: number, _face: { dir: number }): void {
    if (now < this.gcdReadyAt || this.castable.length === 0) return;
    for (let k = 0; k < this.castable.length; k++) {
      if (now < this.cdReadyAt[k]!) continue;
      const s = this.castable[k]!;
      if (!this.net.sendSkillCast({ seq: ++this.castSeq & 0xffff, skillId: s.wireId, targetId, aim: null })) return;
      this.stats.casts++;
      // margins like a real client that waits for the server's readyAtMs: the server starts the cooldown when it processes the cast, a tick later
      this.cdReadyAt[k] = now + s.cooldownMs + 150;
      this.gcdReadyAt = now + Math.max(GCD_MS, s.castMs) + 120;
      return;
    }
  }

  // ------------------------------------------------------------------ social + items
  private social(now: number): void {
    if (this.acceptAtMs >= 0 && now >= this.acceptAtMs) {
      this.acceptAtMs = -1;
      this.net.sendParty({ op: PartyOp.Accept, clientMsgId: ++this.partyId & 0xffff });
    }
    if (now >= this.nextChatMs) {
      this.nextChatMs = now + this.between(this.profile.chatEveryMs);
      const text = CHAT_LINES[Math.floor(this.rnd() * CHAT_LINES.length)]!;
      if (this.net.sendChat({ channel: ChatChannel.World, text, clientMsgId: ++this.chatId & 0xffff }))
        this.stats.chatSent++;
    }
    if (now >= this.nextPartyMs) {
      this.nextPartyMs = now + this.between(this.profile.partyEveryMs);
      if (this.inParty && this.rnd() < 0.5) {
        if (this.net.sendParty({ op: PartyOp.Leave, clientMsgId: ++this.partyId & 0xffff })) this.stats.partyLeaves++;
      } else if (!this.inParty) {
        const others = this.o.roster.filter((n) => n !== this.o.name);
        const name = others[Math.floor(this.rnd() * others.length)];
        if (name && this.net.sendParty({ op: PartyOp.Invite, name, clientMsgId: ++this.partyId & 0xffff }))
          this.stats.partyInvitesSent++;
      }
    }
    if (now >= this.nextBagMs) {
      this.nextBagMs = now + this.between(this.profile.bagEveryMs);
      if (this.net.sendBagClaim()) this.stats.bagClaims++;
      if (this.hpMax > 0 && this.hp / this.hpMax < 0.4 && this.net.sendBagQuickUse('heal_pill')) this.stats.pillsUsed++;
    }
  }

  close(): void {
    this.net.close();
  }
}

/** Class of bot number `n`: the six paths in turn, so every class is exercised equally. */
export const pathOfBot = (n: number): PathId => PATHS[n % PATHS.length]!;
