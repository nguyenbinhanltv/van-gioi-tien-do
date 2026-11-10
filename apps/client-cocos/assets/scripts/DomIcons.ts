/**
 * Icons for the DOM panels (friends, party frames, sect, chat): small `<img>` elements made from the Gemini atlas frames (HUD icons,
 * item icons). Engine-free: `PropArt` installs the provider once its art is loaded, and every caller falls back to its text glyph when
 * there is none (`domIcon` returns null), so a build without the art loses nothing. The images are decoration: no alt text, no pointer
 * events, not draggable, and they never change a button's `textContent` (smoke tests find buttons by their label).
 */
export type DomIconKind = 'hud' | 'item';
export type DomIconProvider = (kind: DomIconKind, id: string) => string | null;

let provider: DomIconProvider | null = null;

export function setDomIconProvider(p: DomIconProvider | null): void {
  provider = p;
}

/** A square `<img>` of `size` CSS px for the icon, or null when the art is not available. */
export function domIcon(kind: DomIconKind, id: string, size: number): HTMLImageElement | null {
  const src = provider?.(kind, id);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.width = size;
  img.height = size;
  img.draggable = false;
  img.dataset.icon = `${kind}:${id}`;
  Object.assign(img.style, {
    width: `${size}px`,
    height: `${size}px`,
    verticalAlign: 'middle',
    marginRight: '4px',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  return img;
}
