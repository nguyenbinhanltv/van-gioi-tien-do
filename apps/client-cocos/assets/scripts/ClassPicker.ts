/**
 * Class picker (D82): a small DOM overlay shown before the first online login of an account. The class is a character property the
 * SERVER keeps (the first login that names one creates the character; later logins ignore what the client asks for), so this
 * only decides what we ask for. The choice is remembered per server + account so the picker does not appear again.
 */
import { shared } from './vendor/vgtd.mjs';
import type { KeyArtUrls } from './PropArt';

/** Display data of the six classes, in wire order (`shared.PATHS`): name and element (docs/11 §4). */
const CLASS_INFO: Readonly<Record<string, { name: string; hint: string }>> = {
  kiem: { name: 'Kiếm tu', hint: 'kiếm · Kim' },
  phap: { name: 'Pháp tu', hint: 'quạt · Hỏa / Thủy' },
  the: { name: 'Thể tu', hint: 'quyền sáo · Thổ' },
  dan_phu: { name: 'Đan / Phù tu', hint: 'phất trần + phù · Mộc / Kim' },
  thuong: { name: 'Thương tu', hint: 'trường thương · Lôi' },
  dao: { name: 'Đao tu', hint: 'trảm đao · Phong' },
};

export function classLabel(path: string): string {
  return CLASS_INFO[path]?.name ?? path;
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
    title.textContent = 'Chọn Đạo Lộ (không đổi được sau khi tạo nhân vật)';
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
      b.textContent = `${k + 1}. ${classLabel(path)} — ${CLASS_INFO[path]?.hint ?? ''}`;
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
