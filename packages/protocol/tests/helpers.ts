import type {
  ColdMessage,
  AoiEnterMsg,
  AoiLeaveMsg,
  EnterEntity,
  ErrorMsg,
  InputMsg,
  Message,
  PingMsg,
  PongMsg,
  SelfState,
  SkillCastMsg,
  SkillResultMsg,
  SnapshotEntity,
  SnapshotMsg,
} from '../src/index.js';

/** Deterministic test RNG. */
export function lcg(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Object.assign(next, {
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    bool: (p = 0.5) => next() < p,
  });
}
export type Rng = ReturnType<typeof lcg>;

export function randSelf(r: Rng): SelfState {
  return {
    lastSeq: r.int(0, 65535),
    i: Math.fround(r() * 2000),
    j: Math.fround(r() * 2000),
    layer: r.int(0, 4),
    flying: r.bool(),
    qinggong: r.bool(),
    facing: r.int(0, 254),
    dashLeftMs: r.int(0, 250),
    dashCdMs: r.int(0, 1500),
    invulnMs: r.int(0, 150),
  };
}

export function randEntity(r: Rng, index: number, qi = r.int(0, 65535), qj = r.int(0, 65535)): SnapshotEntity {
  return { index, qi, qj, anim: r.int(0, 63), dir: r.int(0, 7), hpPct: r.bool(0.2) ? r.int(0, 127) : null };
}

/** Hot-family message types (the cold progression family has its own tests). */
export type HotType = Exclude<Message['type'], ColdMessage['type']>;

export function randMessage(r: Rng, type?: HotType): Message {
  const types: HotType[] = [
    'input',
    'snapshot',
    'aoi_enter',
    'aoi_leave',
    'skill_cast',
    'skill_result',
    'error',
    'ping',
    'pong',
  ];
  const t = type ?? types[r.int(0, types.length - 1)]!;
  switch (t) {
    case 'input': {
      const m: InputMsg = {
        type: 'input',
        ack: r.int(0, 65535),
        inputs: Array.from({ length: r.int(1, 3) }, () => ({
          seq: r.int(0, 65535),
          dtMs: r.int(0, 255),
          dir: r.int(0, 255),
          mag: r.int(0, 15),
          flags: r.int(0, 15),
        })),
      };
      return m;
    }
    case 'snapshot': {
      const n = r.int(0, 60);
      const indices = new Set<number>();
      while (indices.size < n) indices.add(r.int(0, 1023));
      const m: SnapshotMsg = {
        type: 'snapshot',
        seq: r.int(0, 65535),
        baselineSeq: null,
        tick: r.int(0, 2 ** 32 - 1),
        self: r.bool() ? randSelf(r) : null,
        entities: [...indices].map((i) => randEntity(r, i)),
      };
      return m;
    }
    case 'aoi_enter': {
      const m: AoiEnterMsg = {
        type: 'aoi_enter',
        entities: Array.from({ length: r.int(0, 40) }, (_, k): EnterEntity => ({
          index: k,
          entityId: r.int(0, 2 ** 32 - 1),
          kind: r.int(0, 255),
          defId: r.int(0, 65535),
          qi: r.int(0, 65535),
          qj: r.int(0, 65535),
          anim: r.int(0, 255),
          dir: r.int(0, 7),
          hpPct: r.int(0, 255),
          maxHp: r.int(0, 2 ** 32 - 1),
        })),
      };
      return m;
    }
    case 'aoi_leave': {
      const m: AoiLeaveMsg = { type: 'aoi_leave', indices: Array.from({ length: r.int(0, 80) }, () => r.int(0, 1023)) };
      return m;
    }
    case 'skill_cast': {
      const m: SkillCastMsg = {
        type: 'skill_cast',
        seq: r.int(0, 65535),
        skillId: r.int(0, 65535),
        targetId: r.int(0, 2 ** 32 - 1),
      };
      return m;
    }
    case 'skill_result': {
      const m: SkillResultMsg = {
        type: 'skill_result',
        seq: r.int(0, 65535),
        reason: r.int(0, 8),
        skillId: r.int(0, 65535),
        readyAtMs: r.int(0, 2 ** 32 - 1),
        casterIndex: r.int(0, 1023),
        hits: Array.from({ length: r.int(0, 20) }, () => ({
          targetIndex: r.int(0, 1023),
          damage: r.int(0, 2 ** 32 - 1),
          flags: r.int(0, 255),
        })),
      };
      return m;
    }
    case 'error': {
      const pool = ['', 'bad version', 'Phiên hết hạn – vui lòng đăng nhập lại', '涅槃', 'x'.repeat(80)];
      const m: ErrorMsg = { type: 'error', code: r.int(0, 65535), text: pool[r.int(0, pool.length - 1)]! };
      return m;
    }
    case 'ping': {
      const m: PingMsg = { type: 'ping', clientTimeMs: r.int(0, 2 ** 32 - 1) };
      return m;
    }
    case 'pong': {
      const m: PongMsg = { type: 'pong', clientTimeMs: r.int(0, 2 ** 32 - 1), serverTimeMs: r.int(0, 2 ** 32 - 1) };
      return m;
    }
  }
}
