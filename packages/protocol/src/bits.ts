import { ProtocolError } from './errors.js';

/**
 * MSB-first bit writer used for snapshot entity records (docs/08 §8 "Bản ghi một thực thể").
 * Chunked: up to 7 pending bits are kept in `acc` and whole bytes are flushed into a growable `Uint8Array` (this runs once per entity
 * record per client per tick, so it is on the server's hot path). The output is bit-for-bit what a bit-at-a-time writer produces
 * (see tests/bits.test.ts, which checks it against exactly that).
 */
export class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private acc = 0;
  private nbits = 0;

  /** `capacityBytes`: expected output size (a hint; the buffer grows as needed). */
  constructor(capacityBytes = 64) {
    this.buf = new Uint8Array(Math.max(8, capacityBytes));
  }

  /** Start over, keeping the allocated buffer (a scratch writer reused across messages). */
  reset(): void {
    this.len = 0;
    this.acc = 0;
    this.nbits = 0;
  }

  private grow(): void {
    const nb = new Uint8Array(this.buf.length * 2);
    nb.set(this.buf);
    this.buf = nb;
  }

  /** Write the low `bits` (0..24) bits of `value`; throws if the value does not fit. */
  write(value: number, bits: number): void {
    // for widths 0..24: `(value | 0) !== value` rejects fractions, NaN and anything beyond int32, then the range check (no Math.pow here:
    // this runs a few hundred thousand times per tick on the server)
    if ((value | 0) !== value || value < 0 || value >= 1 << bits) {
      throw new ProtocolError('range', `value ${value} does not fit in ${bits} bits`);
    }
    // at most 7 pending bits + 24 new ones = 31 bits: fits a non-negative int32
    this.acc = (this.acc << bits) | value;
    this.nbits += bits;
    while (this.nbits >= 8) {
      this.nbits -= 8;
      if (this.len === this.buf.length) this.grow();
      this.buf[this.len++] = (this.acc >>> this.nbits) & 0xff;
      this.acc &= (1 << this.nbits) - 1;
    }
  }

  /** Pad the last byte with zero bits and return the bytes. */
  finish(): Uint8Array {
    if (this.nbits > 0) {
      if (this.len === this.buf.length) this.grow();
      this.buf[this.len++] = (this.acc << (8 - this.nbits)) & 0xff;
      this.acc = 0;
      this.nbits = 0;
    }
    return this.buf.slice(0, this.len);
  }
}

export class BitReader {
  private pos = 0; // bit position
  constructor(
    private readonly buf: Uint8Array,
    private readonly start = 0,
  ) {}

  read(bits: number): number {
    let v = 0;
    for (let k = 0; k < bits; k++) {
      const byteIdx = this.start + (this.pos >> 3);
      if (byteIdx >= this.buf.length) throw new ProtocolError('truncated', 'bit stream ended early');
      v = (v << 1) | ((this.buf[byteIdx]! >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v >>> 0;
  }

  /** Bytes consumed so far, rounded up. Padding bits in the last byte must be zero (canonical encoding). */
  finish(): number {
    const pad = (8 - (this.pos & 7)) & 7;
    if (pad > 0) {
      const last = this.buf[this.start + (this.pos >> 3)];
      if (last === undefined) throw new ProtocolError('truncated', 'bit stream ended early');
      if ((last & ((1 << pad) - 1)) !== 0) throw new ProtocolError('malformed', 'non-zero padding bits');
    }
    return (this.pos + 7) >> 3;
  }
}
