/**
 * Class picker (D82): a small DOM overlay shown before the first online login of an account. The class is a character property the
 * SERVER keeps (the first login that names one creates the character; later logins ignore what the client asks for), so this
 * only decides what we ask for. The choice is remembered per server + account so the picker does not appear again.
 */
import { core, shared } from './vendor/vgtd.mjs';
import type { KeyArtUrls } from './PropArt';

/** The class name text of a path id (`'kiem'` -> Kiếm tu), '' for an unknown path. */
export function classNameOfPath(path: string | undefined): string {
  const k = path ? CLASS_KEYS[path] : undefined;
  return k ? core.t(k.name) : '';
}

/** String keys of the six classes, by `shared.PATHS` id: name and weapon / element hint (docs/11 §4). */
const CLASS_KEYS: Readonly<Record<string, { name: core.StringKey; hint: core.StringKey }>> = {
  kiem: { name: 'class.kiem.name', hint: 'class.kiem.hint' },
  phap: { name: 'class.phap.name', hint: 'class.phap.hint' },
  the: { name: 'class.the.name', hint: 'class.the.hint' },
  dan_phu: { name: 'class.dan_phu.name', hint: 'class.dan_phu.hint' },
  thuong: { name: 'class.thuong.name', hint: 'class.thuong.hint' },
  dao: { name: 'class.dao.name', hint: 'class.dao.hint' },
};

/** Display name of a class path id in the installed language (the id itself for anything unknown). */
export function classLabel(path: string): string {
  const k = CLASS_KEYS[path];
  return k ? core.t(k.name) : path;
}

const storageKey = (account: string): string => `vgtd.class.${account}`;

/** The class this browser last used for `account` (`<server origin>|<username>`), if it is still a valid class. */
export function rememberedClass(account: string): shared.PathId | null {
  try {
    return shared.parseClass(localStorage.getItem(storageKey(account)));
  } catch {
    return null;
  }
}
export function rememberClass(account: string, path: string): void {
  try {
    localStorage.setItem(storageKey(account), path);
  } catch {
    /* private mode: the picker simply shows again next time */
  }
}

/** Show the picker and resolve with the chosen class (buttons, or keys 1-6). Resolves at once with `fallback` when there is no DOM. */
export function pickClass(
  fallback: shared.PathId = shared.DEFAULT_CLASS,
  art: KeyArtUrls | null = null,
): Promise<shared.PathId> {
  if (typeof document === 'undefined') return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.id = 'vgtd-class-picker';
    Object.assign(box.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      // Gemini login backdrop (PART 2) under a dark veil so the buttons stay readable; plain dark panel without the art
      background: art
        ? `linear-gradient(rgba(8,10,18,0.55), rgba(8,10,18,0.78)), url("${art.backdrop}") center / cover no-repeat`
        : 'rgba(8,10,18,0.82)',
      color: '#f0f0f5',
      font: '16px sans-serif',
      zIndex: '1000',
    } as Partial<CSSStyleDeclaration>);
    if (art) {
      const emblem = document.createElement('img');
      emblem.id = 'vgtd-class-emblem';
      emblem.src = art.emblem;
      emblem.alt = '';
      Object.assign(emblem.style, {
        width: '160px',
        height: '160px',
        objectFit: 'contain',
        pointerEvents: 'none',
      } as Partial<CSSStyleDeclaration>);
      box.appendChild(emblem);
    }
    const title = document.createElement('div');
    title.textContent = core.t('class_picker.title');
    title.style.fontSize = '20px';
    box.appendChild(title);
    const done = (path: shared.PathId): void => {
      window.removeEventListener('keydown', onKey);
      box.remove();
      resolve(path);
    };
    const onKey = (e: KeyboardEvent): void => {
      const n = /^[1-6]$/.test(e.key) ? Number(e.key) : 0;
      const path = n ? shared.pathOfClassWireId(n) : null;
      if (path) done(path);
    };
    shared.PATHS.forEach((path, k) => {
      const b = document.createElement('button');
      b.id = `vgtd-class-${path}`;
      const keys = CLASS_KEYS[path];
      b.textContent = core.t('class_picker.option', {
        n: k + 1,
        name: classLabel(path),
        hint: keys ? core.t(keys.hint) : '',
      });
      Object.assign(b.style, {
        width: '320px',
        padding: '10px 14px',
        font: '16px sans-serif',
        cursor: 'pointer',
        borderRadius: '6px',
        border: '1px solid #667',
        background: '#243049',
        color: '#f0f0f5',
      } as Partial<CSSStyleDeclaration>);
      b.addEventListener('click', () => done(path));
      box.appendChild(b);
    });
    window.addEventListener('keydown', onKey);
    document.body.appendChild(box);
  });
}
