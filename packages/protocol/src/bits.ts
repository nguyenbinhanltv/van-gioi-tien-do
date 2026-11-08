import { ProtocolError } from './errors.js';

/** MSB-first bit writer used for snapshot entity records (docs/08 §8 "Bản ghi một thực thể"). */
export class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  /** Write the low `bits` (1..24) bits of `value`; throws if the value does not fit. */
  write(value: number, bits: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) {
      throw new ProtocolError('range', `value ${value} does not fit in ${bits} bits`);
    }
    for (let b = bits - 1; b >= 0; b--) {
      this.cur = (this.cur << 1) | ((value >>> b) & 1);
      if (++this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /** Pad the last byte with zero bits and return the bytes. */
  finish(): Uint8Array {
    if (this.nbits > 0) {
      this.bytes.push(this.cur << (8 - this.nbits));
      this.cur = 0;
      this.nbits = 0;
    }
    return Uint8Array.from(this.bytes);
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
