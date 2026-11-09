import { Color, Label, Node, UITransform, director } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import { sharedAtlas } from './UiLabel';

/**
 * `?glyphs=1` (D104): draws every glyph the player-facing text may use (ASCII, the 146 Vietnamese letter forms, the symbols of
 * `core.SUPPORTED_SYMBOLS`) through the SAME shared label atlas the HUD uses (`sharedAtlas(label, 'dynamic')`, glyph by glyph), at three
 * font sizes, so a missing glyph (a box instead of a letter) or an atlas that cannot hold the set shows up on screen and in the batch
 * count. `scripts/glyph-smoke.mjs` opens it headless, screenshots it, and checks each glyph against the browser's own "missing glyph" box.
 * Debug aid only: nothing depends on it. The labels are developer output (the glyphs themselves), not player text.
 */
const PER_ROW = 40;
const SIZES: readonly number[] = [14, 20, 28];

export function installGlyphSheet(parent: Node): void {
  const all = Array.from(core.allSupportedGlyphs());
  const rows: string[] = [];
  for (let i = 0; i < all.length; i += PER_ROW) rows.push(all.slice(i, i + PER_ROW).join(''));
  const root = newNode('GlyphSheet', parent);
  let y = 340;
  let labels = 0;
  for (const size of SIZES) {
    for (const row of rows) {
      const n = newNode(`glyphs${labels}`, root);
      n.addComponent(UITransform).setAnchorPoint(0, 1);
      const l = n.addComponent(Label);
      l.fontSize = size;
      l.lineHeight = size + 4;
      l.overflow = Label.Overflow.NONE;
      l.horizontalAlign = Label.HorizontalAlign.LEFT;
      l.color = new Color(240, 240, 250, 255);
      l.string = row; // i18n-exempt: the glyph sheet itself
      sharedAtlas(l, 'dynamic');
      n.setPosition(-620, y, 0);
      y -= size + 8;
      labels++;
    }
    y -= 6;
  }
  (globalThis as unknown as Record<string, unknown>).__vgtdGlyphs = {
    glyphs: all.length,
    chars: all.join(''),
    rows: rows.length,
    sizes: SIZES,
    labels,
    drawCalls: (): number => director.root?.device?.numDrawCalls ?? -1,
  };
}
