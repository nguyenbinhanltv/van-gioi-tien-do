import { describe, expect, it } from 'vitest';
import {
  PARTY,
  TUTORIAL,
  TUTORIAL_FLAG_COMPLETE,
  TUTORIAL_FLAG_SKIPPED,
  TUTORIAL_REQUIRED_COUNT,
  TUTORIAL_STEPS,
  tutorialBit,
  type TutorialStepId,
} from '@vgtd/shared';
import {
  AnchorLayout,
  DEFAULT_PROFILES,
  TUTORIAL_TEXT,
  TutorialModel,
  partyFramesPlacement,
  touchChatPlacement,
  tutorialHintPlacement,
} from '../src/index.js';

const mask = (...ids: TutorialStepId[]): number => ids.reduce((m, id) => m | tutorialBit(id), 0);
const REQUIRED = TUTORIAL_STEPS.slice(0, TUTORIAL_REQUIRED_COUNT);

describe('TutorialModel', () => {
  it('shows nothing until the server has spoken (a server without the module keeps the old loop)', () => {
    const m = new TutorialModel();
    expect(m.received).toBe(false);
    expect(m.view('pointer').visible).toBe(false);
  });

  it('points at the first unfinished required step, in order, with the hint of the input mode', () => {
    const m = new TutorialModel();
    m.applyState({ type: 'tutorial_state', done: 0, kills: 0, flags: 0 });
    let v = m.view('pointer');
    expect(v).toMatchObject({ visible: true, completed: 0, total: TUTORIAL_REQUIRED_COUNT, isTip: false });
    expect(v.current!.id).toBe('move');
    expect(v.hint).toBe(TUTORIAL_TEXT.move.hint.pointer);
    expect(m.view('touch').hint).toBe(TUTORIAL_TEXT.move.hint.touch);
    expect(m.view('touch').hint).not.toBe(m.view('pointer').hint);
    // steps may finish out of order: the card still points at the first one left
    m.applyState({ type: 'tutorial_state', done: mask('field', 'loot'), kills: 0, flags: 0 });
    v = m.view('pointer');
    expect(v.current!.id).toBe('move');
    expect(v.completed).toBe(2);
    m.applyState({ type: 'tutorial_state', done: mask('move', 'field', 'skill'), kills: 1, flags: 0 });
    v = m.view('pointer');
    expect(v.current!.id).toBe('kills');
    expect(v.progress).toBe(`1/${TUTORIAL.killTarget}`);
  });

  it('after the required steps the card offers the optional tips one at a time, then goes away', () => {
    const m = new TutorialModel();
    m.applyState({
      type: 'tutorial_state',
      done: mask(...REQUIRED),
      kills: TUTORIAL.killTarget,
      flags: TUTORIAL_FLAG_COMPLETE,
    });
    let v = m.view('pointer');
    expect(v).toMatchObject({ visible: true, complete: true, isTip: true, completed: TUTORIAL_REQUIRED_COUNT });
    expect(v.current!.id).toBe('item');
    m.applyState({ type: 'tutorial_state', done: mask(...REQUIRED, 'item', 'chat'), kills: 3, flags: TUTORIAL_FLAG_COMPLETE });
    expect(m.view('pointer').current!.id).toBe('party');
    m.applyState({ type: 'tutorial_state', done: mask(...TUTORIAL_STEPS), kills: 3, flags: TUTORIAL_FLAG_COMPLETE });
    v = m.view('pointer');
    expect(v).toMatchObject({ visible: false, current: null, hint: '' });
  });

  it('skip hides the card for good, even with steps left', () => {
    const m = new TutorialModel();
    m.applyState({ type: 'tutorial_state', done: 0, kills: 0, flags: TUTORIAL_FLAG_SKIPPED });
    expect(m.skipped).toBe(true);
    expect(m.view('touch')).toMatchObject({ visible: false, skipped: true });
  });

  it('every step has a title and a hint for both input modes (no empty card)', () => {
    for (const id of TUTORIAL_STEPS) {
      expect(TUTORIAL_TEXT[id].title.length, id).toBeGreaterThan(0);
      expect(TUTORIAL_TEXT[id].hint.pointer.length, id).toBeGreaterThan(0);
      expect(TUTORIAL_TEXT[id].hint.touch.length, id).toBeGreaterThan(0);
    }
  });

  it('version bumps on every state', () => {
    const m = new TutorialModel();
    const v0 = m.version;
    m.applyState({ type: 'tutorial_state', done: 1, kills: 0, flags: 0 });
    m.applyState({ type: 'tutorial_state', done: 1, kills: 0, flags: 0 });
    expect(m.version).toBe(v0 + 2);
  });
});

describe('tutorial hint placement (D105): the card never covers another widget of the layout', () => {
  const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const viewports: Array<[string, number, number, boolean]> = [
    ['pointer 1280x720', 1280, 720, false],
    ['pointer 1920x1080', 1920, 1080, false],
    ['touch landscape 1280x720', 1280, 720, true],
    ['touch landscape 844x390 phone', 844, 390, true],
    ['touch landscape 2400x1080', 2400, 1080, true],
    ['touch portrait 720x1280', 720, 1280, true],
    ['touch portrait 390x844 phone', 390, 844, true],
  ];
  for (const [name, w, h, touch] of viewports) {
    it(`${name}: on screen and clear of every shared widget, the party frames and the chat strip`, () => {
      const p = tutorialHintPlacement(w, h, touch);
      expect(p.w).toBeGreaterThan(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(w);
      expect(p.y + p.h).toBeLessThanOrEqual(h);
      const res = AnchorLayout.compute(
        w,
        h,
        { top: 0, right: 0, bottom: 0, left: 0 },
        touch ? 'touch' : 'pointer',
        DEFAULT_PROFILES,
        { refLandscape: [1280, 720], refPortrait: [720, 1280], userScale: 1, touchMargin: 16 },
      );
      for (const [id, r] of res.rects) {
        if (id === 'tutorial-hint') continue;
        expect(hit(p, r), `${id} ${JSON.stringify(r)} vs hint ${JSON.stringify(p)}`).toBe(false);
      }
      const f = partyFramesPlacement(w, h, touch);
      expect(hit(p, { x: f.x, y: f.y, w: f.w, h: f.rowH * (PARTY.MAX_SIZE - 1) })).toBe(false);
      if (touch) expect(hit(p, touchChatPlacement(w, h).strip)).toBe(false);
    });
  }
});
