# @vgtd/protocol

Versioned messages (`PROTOCOL_VERSION = 1`) with a compact binary codec (`encode` / `decode`, DataView based, no dependencies) and a JSON debug codec
(`encodeJson` / `decodeJson`). Both run the same validation (`validateMessage`) and throw only `ProtocolError`.

All binary packets: `[version u8][type u8][body…]`, big-endian. Decoding is strict (trailing bytes, non-zero padding bits and unknown flags are rejected).

| Message (type id)       | Dir       | Body                                                                                         | Size                |
| ----------------------- | --------- | -------------------------------------------------------------------------------------------- | ------------------- |
| `input` (1)             | C→S       | `ack u16, count u8, count × { seq u16, dtMs u8, dir u8, mag:4·flags:4 }` (1–3 inputs)        | 5 + 5n B            |
| `snapshot` (2)          | S→C       | `flags u8, seq u16, [baselineSeq u16], tick u32, [self 19 B], count u16, bit-packed records` | ~13 B + ~5 B/entity |
| `aoi_enter` (3)         | S→C       | `count u16, count × 18 B` (index, entityId, kind, position, anim, dir, hp%, maxHp)           | 2 + 18n             |
| `aoi_leave` (4)         | S→C       | `count u16, count × index u16`                                                               | 2 + 2n              |
| `skill_cast` (5)        | C→S       | `seq u16, skillId u16, targetId u32`                                                         | 10 B                |
| `skill_result` (6)      | S→C       | `seq, reason (sim CastReason), skillId, readyAtMs, casterIndex, hits[]`                      | 14 + 7n             |
| `error` (7)             | S→C       | `code u16, len u8, utf-8 text`                                                               | 5 + len             |
| `ping` (8) / `pong` (9) | C→S / S→C | `clientTimeMs u32 [, serverTimeMs u32]`                                                      | 6 / 10 B            |

Snapshot entity record (MSB-first bits): `index 10 · absolute 1 · (absolute ? qi 16 + qj 16 : Δi s8 + Δj s8) · anim 6 · dir 3 · hasHp 1 · [hp% 7]`
= 37–44 bits. Positions are quantised to 1/32 tile; deltas are against the snapshot named by `baselineSeq` (the client's last ACK,
carried in every `input` packet); out-of-range deltas fall back to absolute. Pass `{ baseline }` to `encode`/`decode`.
The `self` block carries the owner's `lastSeq` plus the movement state needed to re-run pending inputs (positions as float32).

## Progression messages (cold family, D74)

`char_state` (60), `breakthrough_start` (61), `breakthrough_result` (62), `meditate_start` (63), `meditate_stop` (64) and
`meditate_result` (65) use the docs/24 cold envelope `[version][0x80][msgId u16][body]` (`src/progression.ts`). Bodies are fixed
big-endian layouts until the Protobuf pipeline exists (request ids are 16 bytes, shown as 32 lowercase hex characters;
`char_state` carries `tuVi`/`tuViReq` as float64). Decoding is strict and canonical like the hot family; adding a msgId is
additive, so `PROTOCOL_VERSION` stays 1. `ProgressionReason`, `BreakthroughOutcome`, `BreakthroughKind` and `CHAR_FLAG` are the wire enums.
