/**
 * HUD data for statuses (D94), engine-free: what the status row under / next to the HP bars shows, and the glyphs above another player.
 * Ids are stable (`getStatusIcon(id)` in the Cocos client maps them to art when it exists; until then `label` is drawn).
 */
import { StatusBit } from '@vgtd/protocol';

export interface StatusRowItem {
  /** stable id: 'root' | 'slow' | 'poison' | 'shield' */
  id: 'root' | 'slow' | 'poison' | 'shield';
  /** short text glyph (placeholder until the icons exist) */
  label: string;
  /** seconds left, rounded up; null = no timer (a shield has none) */
  secs: number | null;
  /** extra text (slow: "-50%") */
  note: string;
}

export interface OwnStatusView {
  rootMs: number;
  slowMs: number;
  slowPct: number;
  poisonMs: number;
}

/** The own status row, longest-lived first inside each kind in a fixed order: root, slow, poison, shield. */
export function statusRowItems(own: OwnStatusView, shield: number): StatusRowItem[] {
  const out: StatusRowItem[] = [];
  if (own.rootMs > 0) out.push({ id: 'root', label: 'TROI', secs: Math.ceil(own.rootMs / 1000), note: '' });
  if (own.slowMs > 0)
    out.push({ id: 'slow', label: 'CHAM', secs: Math.ceil(own.slowMs / 1000), note: `-${Math.max(0, 100 - own.slowPct)}%` });
  if (own.poisonMs > 0) out.push({ id: 'poison', label: 'DOC', secs: Math.ceil(own.poisonMs / 1000), note: '' });
  if (shield > 0) out.push({ id: 'shield', label: 'KHIEN', secs: null, note: String(Math.round(shield)) });
  return out;
}

/** Glyph string above another player for a `status_update` mask ('' = none). */
export function statusMaskGlyphs(mask: number): string {
  const parts: string[] = [];
  if (mask & StatusBit.Root) parts.push('TROI');
  if (mask & StatusBit.Slow) parts.push('CHAM');
  if (mask & StatusBit.Poison) parts.push('DOC');
  if (mask & StatusBit.Stun) parts.push('CHOANG');
  return parts.join(' ');
}
