export type ProtocolErrorCode = 'version' | 'type' | 'truncated' | 'malformed' | 'range' | 'trailing' | 'baseline';

/** The only exception the codecs throw for bad input (so servers can drop the packet and score the sender). */
export class ProtocolError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}
