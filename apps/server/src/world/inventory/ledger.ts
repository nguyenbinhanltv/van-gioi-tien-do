/**
 * In-memory double-entry ledger for the in-game stone currencies (docs/26 §2-§4, D77).
 *
 * Rules enforced here, the same ones the PostgreSQL implementation must keep (docs/23 §4.4):
 *   I1  for every transaction and currency the entries sum to 0 (a drop moves value FAUCET -> WALLET, never mints it);
 *   I2  a player wallet never goes below 0 (the whole transaction is rejected, nothing is applied);
 *   I3  balance(account) = sum of its entries (`reconcile()` re-derives it);
 *   idempotency: a transaction is identified by its key; the same key with the same content replays the stored result
 *   without applying anything again, the same key with different content is an error (docs/26 §4.1).
 * Amounts are bigint in the smallest unit (no decimals). Entries are append-only. Deterministic: no clocks, no randomness;
 * transaction ids are a counter.
 *
 * Scope: in-game stone currencies only. There is deliberately no real-money, shop, price or entitlement logic here.
 */
import type { Currency } from './items.js';

export type AccountKind =
  'PLAYER_WALLET' | 'SYSTEM_FAUCET_DROP_MOB' | 'SYSTEM_FAUCET_DROP_ELITE' | 'SYSTEM_FAUCET_DROP_BOSS';
export type LedgerReason = 'DROP';

export interface AccountRef {
  kind: AccountKind;
  /** owner of a PLAYER_WALLET (account id); null for system accounts */
  ownerId: string | null;
  currency: Currency;
}
export interface LedgerEntryInput {
  account: AccountRef;
  /** signed, smallest unit */
  delta: bigint;
}
export interface LedgerTx {
  reason: LedgerReason;
  idempotencyKey: string;
  entries: readonly LedgerEntryInput[];
}
export interface LedgerEntry {
  txId: number;
  accountKey: string;
  delta: bigint;
}
export type LedgerErrorCode = 'EMPTY' | 'UNBALANCED' | 'INSUFFICIENT_FUNDS' | 'IDEMPOTENCY_MISMATCH' | 'BAD_AMOUNT';
export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
export interface LedgerResult {
  txId: number;
  /** true when the key had already been applied with identical content: nothing was applied now */
  replayed: boolean;
}

export const accountKey = (a: AccountRef): string => `${a.kind}|${a.ownerId ?? ''}|${a.currency}`;
const hashOf = (tx: LedgerTx): string =>
  `${tx.reason}|${tx.entries.map((e) => `${accountKey(e.account)}=${e.delta.toString()}`).join(',')}`;

export class Ledger {
  private readonly balances = new Map<string, bigint>();
  private readonly accountOf = new Map<string, AccountRef>();
  private readonly applied = new Map<string, { hash: string; txId: number }>();
  /** append-only */
  readonly entries: LedgerEntry[] = [];
  private nextTx = 1;

  balance(a: AccountRef): bigint {
    return this.balances.get(accountKey(a)) ?? 0n;
  }

  post(tx: LedgerTx): LedgerResult {
    const hash = hashOf(tx);
    const seen = this.applied.get(tx.idempotencyKey);
    if (seen) {
      if (seen.hash !== hash)
        throw new LedgerError('IDEMPOTENCY_MISMATCH', `key ${tx.idempotencyKey} reused with different content`);
      return { txId: seen.txId, replayed: true };
    }
    if (tx.entries.length === 0) throw new LedgerError('EMPTY', 'transaction without entries');
    const sums = new Map<Currency, bigint>();
    const next = new Map<string, bigint>();
    for (const e of tx.entries) {
      if (e.delta === 0n) throw new LedgerError('BAD_AMOUNT', 'zero-amount entry');
      sums.set(e.account.currency, (sums.get(e.account.currency) ?? 0n) + e.delta);
      const k = accountKey(e.account);
      next.set(k, (next.get(k) ?? this.balances.get(k) ?? 0n) + e.delta);
    }
    for (const [cur, s] of sums)
      if (s !== 0n) throw new LedgerError('UNBALANCED', `entries in ${cur} sum to ${s}, not 0`);
    for (const e of tx.entries) {
      if (e.account.kind === 'PLAYER_WALLET' && (next.get(accountKey(e.account)) ?? 0n) < 0n)
        throw new LedgerError('INSUFFICIENT_FUNDS', `wallet ${accountKey(e.account)} would go negative`);
    }
    // commit (nothing above mutated state)
    const txId = this.nextTx++;
    for (const [k, v] of next) this.balances.set(k, v);
    for (const e of tx.entries) {
      const k = accountKey(e.account);
      this.accountOf.set(k, e.account);
      this.entries.push({ txId, accountKey: k, delta: e.delta });
    }
    this.applied.set(tx.idempotencyKey, { hash, txId });
    return { txId, replayed: false };
  }

  /** Re-derive I1 and I3 from the entries. Empty list = consistent. */
  reconcile(): string[] {
    const problems: string[] = [];
    const byTx = new Map<string, bigint>();
    const byAccount = new Map<string, bigint>();
    for (const e of this.entries) {
      const cur = this.accountOf.get(e.accountKey)!.currency;
      const tk = `${e.txId}|${cur}`;
      byTx.set(tk, (byTx.get(tk) ?? 0n) + e.delta);
      byAccount.set(e.accountKey, (byAccount.get(e.accountKey) ?? 0n) + e.delta);
    }
    for (const [k, s] of byTx) if (s !== 0n) problems.push(`I1: tx/currency ${k} sums to ${s}`);
    for (const [k, b] of this.balances)
      if ((byAccount.get(k) ?? 0n) !== b) problems.push(`I3: ${k} balance ${b} != entries ${byAccount.get(k) ?? 0n}`);
    for (const [k, v] of this.balances)
      if (k.startsWith('PLAYER_WALLET') && v < 0n) problems.push(`I2: ${k} is negative`);
    return problems;
  }
}
