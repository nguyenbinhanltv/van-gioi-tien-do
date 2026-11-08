/** Access tokens: JWT signed EdDSA (Ed25519) with node:crypto, 10 min lifetime (docs/25 §3.1). No third-party JWT library. */
import { createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { AUTH_CONFIG } from '../config.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
  ver: number;
  aud: string;
  iss: string;
}

export class TokenError extends Error {
  constructor(
    readonly code: 'malformed' | 'signature' | 'expired' | 'claims',
    message: string,
  ) {
    super(message);
  }
}

const b64u = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

export class TokenService {
  readonly kid: string;
  private readonly priv: KeyObject;
  readonly pub: KeyObject;

  constructor(
    private readonly now: () => number = () => Date.now(),
    keys?: { privateKey: KeyObject; kid?: string },
    private readonly aud = 'vgtd-world',
    private readonly iss = 'vgtd-auth',
  ) {
    if (keys) {
      this.priv = keys.privateKey;
      this.kid = keys.kid ?? 'k1';
    } else {
      // dev/loadtest: ephemeral key. Production loads a persisted key from the environment (docs/25 §3.1, not committed).
      this.priv = generateKeyPairSync('ed25519').privateKey;
      this.kid = 'ephemeral';
    }
    this.pub = createPublicKey(this.priv);
  }

  issue(accountId: string, sessionId: string, tokenVersion = 0): { token: string; claims: AccessClaims } {
    const iat = Math.floor(this.now() / 1000);
    const claims: AccessClaims = {
      sub: accountId,
      sid: sessionId,
      jti: randomUUID(),
      iat,
      exp: iat + AUTH_CONFIG.ACCESS_TOKEN_TTL_S,
      ver: tokenVersion,
      aud: this.aud,
      iss: this.iss,
    };
    const head = b64u(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: this.kid }));
    const body = b64u(JSON.stringify(claims));
    const sig = sign(null, Buffer.from(`${head}.${body}`), this.priv);
    return { token: `${head}.${body}.${b64u(sig)}`, claims };
  }

  verify(token: string): AccessClaims {
    if (typeof token !== 'string' || token.length > 1024) throw new TokenError('malformed', 'token too long');
    const parts = token.split('.');
    if (parts.length !== 3) throw new TokenError('malformed', 'expected 3 parts');
    let header: { alg?: unknown };
    let claims: Partial<AccessClaims>;
    try {
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { alg?: unknown };
      claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Partial<AccessClaims>;
    } catch {
      throw new TokenError('malformed', 'bad json');
    }
    if (header.alg !== 'EdDSA') throw new TokenError('malformed', 'unsupported alg');
    const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), this.pub, Buffer.from(parts[2]!, 'base64url'));
    if (!ok) throw new TokenError('signature', 'bad signature');
    const nowS = Math.floor(this.now() / 1000);
    if (typeof claims.exp !== 'number' || nowS > claims.exp + AUTH_CONFIG.CLOCK_SKEW_S)
      throw new TokenError('expired', 'token expired');
    if (typeof claims.iat !== 'number' || claims.iat > nowS + AUTH_CONFIG.CLOCK_SKEW_S)
      throw new TokenError('claims', 'iat in the future');
    if (claims.aud !== this.aud || claims.iss !== this.iss) throw new TokenError('claims', 'wrong aud/iss');
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string')
      throw new TokenError('claims', 'missing sub/sid');
    return claims as AccessClaims;
  }
}
