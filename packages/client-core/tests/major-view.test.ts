import { describe, expect, it } from 'vitest';
import { ConsequenceTier, MajorPhase, MajorResult } from '@vgtd/shared';
import type { MajorEventMsg } from '@vgtd/protocol';
import { MajorEventView } from '@vgtd/client-core';

const ev = (o: Partial<MajorEventMsg>): MajorEventMsg => ({
  type: 'major_event',
  phase: MajorPhase.TamMa,
  wave: 0,
  waves: 3,
  remainingMs: 90_000,
  strengthPct: 120,
  result: MajorResult.Running,
  tier: 0,
  expLostPct: 0,
  lockMin: 0,
  tamMaId: 2_000_000,
  ...o,
});

describe('MajorEventView (D97)', () => {
  it('counts the Tâm Ma window down locally and names the phases', () => {
    let t = 1000;
    const v = new MajorEventView(() => t);
    expect(v.active).toBe(false);
    expect(v.title()).toBe('');
    v.apply(ev({}));
    expect(v.active).toBe(true);
    expect(v.title()).toBe('Tâm Ma (độ khó 120%): hạ bóng trong 90 giây');
    t += 30_400;
    expect(v.current()!.remainingMs).toBe(59_600);
    expect(v.title()).toContain('60 giây');
    t += 100_000;
    expect(v.current()!.remainingMs).toBe(0);
    v.apply(ev({ phase: MajorPhase.Destiny, remainingMs: 2000 }));
    expect(v.title()).toBe('Thiên Mệnh đang định đoạt…');
    v.apply(ev({ phase: MajorPhase.Tribulation, wave: 0 }));
    expect(v.title()).toBe('Mây kiếp đang tụ…');
    v.apply(ev({ phase: MajorPhase.Tribulation, wave: 2, remainingMs: 0 }));
    expect(v.title()).toBe('Lôi Kiếp: đạo 2/3');
  });

  it('keeps the newest bolt for a short while only', () => {
    let t = 0;
    const v = new MajorEventView(() => t);
    expect(v.recentStrike()).toBeNull();
    v.applyStrike({ type: 'tribulation_strike', wave: 1, waves: 3, strike: 0, qi: 960, qj: 1000, damage: 500 });
    expect(v.recentStrike()).toMatchObject({ qi: 960, damage: 500, wave: 1 });
    t += 800;
    expect(v.recentStrike()).toBeNull();
    t += 10;
    expect(v.recentStrike(2000)).not.toBeNull();
  });

  it('the result card says what happened, what was lost and for how long the breakthrough is locked, then expires', () => {
    let t = 0;
    const v = new MajorEventView(() => t);
    v.apply(ev({ phase: MajorPhase.Ended, result: MajorResult.Success }));
    expect(v.active).toBe(false);
    expect(v.resultCard()).toEqual({ lines: ['Đột phá đại cảnh thành công!'], tone: 'good' });
    v.apply(
      ev({
        phase: MajorPhase.Ended,
        result: MajorResult.Died,
        tier: ConsequenceTier.Heavy,
        expLostPct: 50,
        lockMin: 1440,
      }),
    );
    expect(v.resultCard()).toEqual({
      lines: ['Gục giữa Lôi Kiếp (hậu quả Nặng).', 'Mất 50% tu vi của nấc hiện tại.', 'Khóa đột phá đại cảnh 24 giờ.'],
      tone: 'bad',
    });
    v.apply(ev({ phase: MajorPhase.Ended, result: MajorResult.TamMaLost, lockMin: 30 }));
    expect(v.resultCard()!.lines).toEqual(['Bại trước Tâm Ma.', 'Khóa đột phá đại cảnh 30 phút.']);
    v.apply(ev({ phase: MajorPhase.Ended, result: MajorResult.RollFailed }));
    expect(v.resultCard()!.lines).toEqual(['Thiên Mệnh không chiếu cố: đột phá thất bại.']);
    t += 10_000;
    expect(v.resultCard()).toBeNull();
    // a new event replaces the card; reset clears everything
    v.apply(ev({ phase: MajorPhase.Ended, result: MajorResult.Success }));
    v.apply(ev({}));
    expect(v.resultCard()).toBeNull();
    v.reset();
    expect(v.active).toBe(false);
  });

  it('a reconnect forgets a running event (its final message may have been lost) and still runs the previous handler', () => {
    const v = new MajorEventView(() => 0);
    v.apply(ev({}));
    v.applyStrike({ type: 'tribulation_strike', wave: 1, waves: 3, strike: 0, qi: 0, qj: 0, damage: 5 });
    expect(v.active).toBe(true);
    const seen: boolean[] = [];
    const onReconnect = v.chainReconnect((info) => seen.push(info.resumed));
    onReconnect({ resumed: true });
    expect(seen).toEqual([true]);
    expect(v.active).toBe(false);
    expect(v.title()).toBe('');
    expect(v.current()).toBeNull();
    v.apply(ev({}));
    v.chainReconnect()({ resumed: false }); // no previous handler
    expect(v.active).toBe(false);
  });
});
