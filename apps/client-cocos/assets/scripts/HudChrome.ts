/**
 * Shared look + placement helpers of the DOM HUD widgets (player frame, menu bar, character / settings panels, and the framed minimap,
 * quest tracker and chat). Engine-free. The jade-and-gold frame is plain CSS (no draw call in the scene, no extra download): a double
 * gold rule, a dark jade gradient and an inset shadow, the same palette as the owner's `panel_jade` frame used by the Cocos panels.
 *
 * Placement: the layout contract (client-core `computeHudLayout`) is in design units; `placeDesign` puts an element of exactly the rect's
 * design size at its spot and scales it by `f` CSS px per design unit (`transform`), so a widget keeps its look at every window size.
 */
export const GOLD = '#c9a24a';
export const GOLD_LIGHT = '#f0d98a';
export const INK = '#f0ecdf';

/** The framed panel look: assign onto an element's style. */
export function frameStyle(opacity = 0.92): Partial<CSSStyleDeclaration> {
  return {
    background: `linear-gradient(180deg, rgba(26,40,36,${opacity}) 0%, rgba(10,16,18,${opacity}) 100%)`,
    border: `2px solid ${GOLD}`,
    borderRadius: '8px',
    boxShadow: 'inset 0 0 0 1px rgba(255,236,170,0.28), inset 0 0 14px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.6)',
    color: INK,
    boxSizing: 'border-box',
    textAlign: 'left', // the page CSS centres text
  };
}

/** Put `el` (position: fixed) at design rect `r`, scaled by `f` CSS px per design unit. */
export function placeDesign(el: HTMLElement, r: { x: number; y: number; w: number; h: number }, f: number): void {
  Object.assign(el.style, {
    left: `${r.x * f}px`,
    top: `${r.y * f}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${r.w}px`,
    height: `${r.h}px`,
    transform: `scale(${f})`,
    transformOrigin: '0 0',
  } as Partial<CSSStyleDeclaration>);
}

/** A typing field has the keyboard: hotkeys must stay out of it. */
export function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** A glossy resource bar inside a dark track: returns the track and a setter. */
export function makeBar(
  fill: string,
  height: number,
): { track: HTMLDivElement; set: (frac: number, text: string, shield?: number) => void } {
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    height: `${height}px`,
    background: 'rgba(0,0,0,0.65)',
    border: '1px solid rgba(201,162,74,0.7)',
    borderRadius: '5px',
    overflow: 'hidden',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
  } as Partial<CSSStyleDeclaration>);
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    bottom: '0',
    width: '0%',
    background: fill,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
  } as Partial<CSSStyleDeclaration>);
  const shield = document.createElement('div');
  Object.assign(shield.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    height: '3px',
    width: '0%',
    background: '#eef2ff',
  } as Partial<CSSStyleDeclaration>);
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'absolute',
    inset: '0',
    textAlign: 'center',
    font: `bold ${Math.max(9, height - 4)}px/${height - 2}px sans-serif`,
    textShadow: '0 1px 2px #000',
  } as Partial<CSSStyleDeclaration>);
  track.append(bar, shield, label);
  return {
    track,
    set: (frac, text, sh = 0) => {
      bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      shield.style.width = `${Math.max(0, Math.min(1, sh)) * 100}%`;
      if (label.textContent !== text) label.textContent = text;
    },
  };
}
