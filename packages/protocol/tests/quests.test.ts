import { describe, expect, it } from 'vitest';
import { QUESTS } from '@vgtd/shared';
import {
  COLD_ENVELOPE,
  PROTOCOL_VERSION,
  ProtocolError,
  QUEST_WIRE_LIMITS,
  QuestOp,
  QuestReason,
  decode,
  decodeJson,
  encode,
  encodeJson,
  peekHeader,
  type ColdMessage,
} from '../src/index.js';
import { lcg } from './helpers.js';

const samples: ColdMessage[] = [
  { type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 65535, questId: 'q_c1_nhap_mon', npc: '' },
  { type: 'quest_cmd', op: QuestOp.Claim, clientMsgId: 1, questId: 'q_daily_san_quai', npc: '' },
  { type: 'quest_cmd', op: QuestOp.Abandon, clientMsgId: 2, questId: 'q_x', npc: '' },
  { type: 'quest_cmd', op: QuestOp.Talk, clientMsgId: 3, questId: '', npc: 'npc_su_huynh' },
  { type: 'quest_result', clientMsgId: 9, reason: QuestReason.TooFar },
  { type: 'quest_state', dailyResetIn: 0, weeklyResetIn: 0, quests: [] },
  {
    type: 'quest_state',
    dailyResetIn: 3600,
    weeklyResetIn: 4_294_967_295,
    quests: [
      { id: 'q_c1_nhap_mon', status: 4, progress: [1] },
      { id: 'q_c1_san_doc_tho', status: 2, progress: [3] },
      { id: 'q_x', status: 0, progress: [] },
      { id: 'q_many', status: 3, progress: [65535, 0, 7, 8] },
    ],
  },
];
const bytesOf = (n: number) => 'a'.repeat(n);

describe('quest messages (cold family ids 120-122)', () => {
  it.each(samples.map((m, i) => [`${m.type} #${i}`, m] as const))(
    '%s round-trips and re-encodes canonically',
    (_n, m) => {
      const b = encode(m);
      expect(decode(b)).toEqual(m);
      expect(Array.from(encode(decode(b)))).toEqual(Array.from(b));
      expect(decodeJson(encodeJson(m))).toEqual(m);
    },
  );

  it('uses ids 120 quest_cmd, 121 quest_result, 122 quest_state on the cold envelope, protocol version unchanged', () => {
    const ids: Record<string, number> = { quest_cmd: 120, quest_result: 121, quest_state: 122 };
    for (const m of samples) {
      const b = encode(m);
      expect([b[0], b[1], (b[2]! << 8) | b[3]!]).toEqual([PROTOCOL_VERSION, COLD_ENVELOPE, ids[m.type]]);
      expect(peekHeader(b).type).toBe(m.type);
    }
    expect(PROTOCOL_VERSION).toBe(5);
  });

  it('golden bytes: quest_cmd and quest_state', () => {
    const v = PROTOCOL_VERSION.toString(16).padStart(2, '0');
    // op 1, clientMsgId 0x0102, questId 'ab', npc ''
    expect(
      Buffer.from(encode({ type: 'quest_cmd', op: 1, clientMsgId: 0x0102, questId: 'ab', npc: '' })).toString('hex'),
    ).toBe(`${v}800078` + '01' + '0102' + '02' + '6162' + '00');
    // daily 0x0100, weekly 2, one quest 'a', status 2, 2 objectives (3, 0x0102)
    expect(
      Buffer.from(
        encode({
          type: 'quest_state',
          dailyResetIn: 0x100,
          weeklyResetIn: 2,
          quests: [{ id: 'a', status: 2, progress: [3, 0x102] }],
        }),
      ).toString('hex'),
    ).toBe(`${v}80007a` + '00000100' + '00000002' + '01' + '01' + '61' + '02' + '02' + '0003' + '0102');
  });

  it('validates ops, ids, sizes and counts', () => {
    const bad = (m: unknown) => expect(() => encode(m as ColdMessage)).toThrow(ProtocolError);
    bad({ type: 'quest_cmd', op: 0, clientMsgId: 0, questId: 'q', npc: '' });
    bad({ type: 'quest_cmd', op: 5, clientMsgId: 0, questId: 'q', npc: '' });
    bad({ type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 0, questId: '', npc: '' }); // needs an id
    bad({ type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 0, questId: 'q', npc: 'n' }); // no npc on accept
    bad({ type: 'quest_cmd', op: QuestOp.Talk, clientMsgId: 0, questId: '', npc: '' }); // talk needs an npc
    bad({ type: 'quest_cmd', op: QuestOp.Talk, clientMsgId: 0, questId: 'q', npc: 'n' }); // and no quest id
    bad({ type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 65536, questId: 'q', npc: '' });
    bad({
      type: 'quest_cmd',
      op: QuestOp.Accept,
      clientMsgId: 0,
      questId: bytesOf(QUEST_WIRE_LIMITS.MAX_ID_BYTES + 1),
      npc: '',
    });
    bad({
      type: 'quest_cmd',
      op: QuestOp.Talk,
      clientMsgId: 0,
      questId: '',
      npc: bytesOf(QUEST_WIRE_LIMITS.MAX_NPC_BYTES + 1),
    });
    bad({ type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 0, questId: '\ud800', npc: '' });
    bad({ type: 'quest_result', clientMsgId: 0, reason: 256 });
    bad({ type: 'quest_state', dailyResetIn: -1, weeklyResetIn: 0, quests: [] });
    bad({ type: 'quest_state', dailyResetIn: 0, weeklyResetIn: 4_294_967_296, quests: [] });
    bad({ type: 'quest_state', dailyResetIn: 0, weeklyResetIn: 0, quests: [{ id: 'a', status: 5, progress: [] }] });
    bad({
      type: 'quest_state',
      dailyResetIn: 0,
      weeklyResetIn: 0,
      quests: [{ id: 'a', status: 1, progress: [65536] }],
    });
    bad({
      type: 'quest_state',
      dailyResetIn: 0,
      weeklyResetIn: 0,
      quests: [{ id: 'a', status: 1, progress: Array(QUESTS.MAX_OBJECTIVES + 1).fill(0) }],
    });
    bad({
      type: 'quest_state',
      dailyResetIn: 0,
      weeklyResetIn: 0,
      quests: Array.from({ length: QUESTS.MAX_ENTRIES + 1 }, (_, i) => ({ id: `q${i}`, status: 1, progress: [] })),
    });
    bad({ type: 'quest_state', dailyResetIn: 0, weeklyResetIn: 0, quests: [null] });
    const full = {
      type: 'quest_state' as const,
      dailyResetIn: 1,
      weeklyResetIn: 2,
      quests: Array.from({ length: QUESTS.MAX_ENTRIES }, (_, i) => ({
        id: `q_${bytesOf(30)}${i}`,
        status: 2,
        progress: Array(QUESTS.MAX_OBJECTIVES).fill(i),
      })),
    };
    expect(decode(encode(full))).toEqual(full);
    expect(encode(full).length).toBeLessThan(4200); // a full log is a few kilobytes at the very most
  });

  it('decoder: truncation at every length, trailing bytes, invalid UTF-8, counts above the limits', () => {
    for (const m of samples) {
      const b = encode(m);
      for (let n = 0; n < b.length; n++)
        expect(() => decode(b.subarray(0, n)), `${m.type} len ${n}`).toThrow(ProtocolError);
      expect(() => decode(Uint8Array.from([...b, 0])), m.type).toThrowError(/trailing/);
    }
    const c = Uint8Array.from(encode({ type: 'quest_cmd', op: 1, clientMsgId: 0, questId: 'ab', npc: '' }));
    c[c.length - 2] = 0xff; // last byte of the quest id
    expect(() => decode(c)).toThrowError(/not valid UTF-8/);
    const s = Uint8Array.from(encode({ type: 'quest_state', dailyResetIn: 0, weeklyResetIn: 0, quests: [] }));
    s[4 + 8] = QUESTS.MAX_ENTRIES + 1; // entry count
    expect(() => decode(s)).toThrow(ProtocolError);
    const o = Uint8Array.from(
      encode({
        type: 'quest_state',
        dailyResetIn: 0,
        weeklyResetIn: 0,
        quests: [{ id: 'a', status: 1, progress: [] }],
      }),
    );
    o[o.length - 1] = QUESTS.MAX_OBJECTIVES + 1; // objective count
    expect(() => decode(o)).toThrow(ProtocolError);
  });

  it('random bytes never crash the decoder (only ProtocolError) and anything that decodes re-encodes identically', () => {
    const r = lcg(7011);
    for (let k = 0; k < 4000; k++) {
      const n = r.int(2, 60);
      const buf = Uint8Array.from({ length: n }, () => r.int(0, 255));
      buf[0] = PROTOCOL_VERSION;
      buf[1] = COLD_ENVELOPE;
      buf[2] = 0;
      buf[3] = 120 + r.int(0, 2);
      let m;
      try {
        m = decode(buf);
      } catch (e) {
        expect(e).toBeInstanceOf(ProtocolError);
        continue;
      }
      expect(Array.from(encode(m))).toEqual(Array.from(buf));
    }
  });
});
