import { ImageAsset, Rect, SpriteFrame, Texture2D } from 'cc';

/**
 * Placeholder art drawn at runtime into ONE canvas atlas (so player, props, shadow, markers and HUD
 * quads all batch into a single draw call). Replaced by real Spine / atlas art in a later task.
 * Web-only (uses a DOM canvas) - fine for this Web-first slice.
 */
export interface ArtFrames {
  player: SpriteFrame;
  tree: SpriteFrame;
  rock: SpriteFrame;
  marker: SpriteFrame;
  shadow: SpriteFrame;
  joyBase: SpriteFrame;
  joyKnob: SpriteFrame;
  pixel: SpriteFrame;
  texture: Texture2D;
}

const ATLAS = 256;

export function makeTexture(image: ImageAsset): Texture2D {
  const tex = new Texture2D();
  tex.image = image;
  tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
  tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
  return tex;
}

export function makeFrame(tex: Texture2D, x: number, y: number, w: number, h: number): SpriteFrame {
  const sf = new SpriteFrame();
  sf.texture = tex;
  sf.rect = new Rect(x, y, w, h);
  return sf;
}

export function buildPlaceholderArt(): ArtFrames {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d')!;

  // player 48x72 @ (0,0): capsule body + head
  g.fillStyle = '#3b6fd8';
  g.beginPath();
  g.roundRect(8, 24, 32, 44, 12);
  g.fill();
  g.fillStyle = '#f2d3a8';
  g.beginPath();
  g.arc(24, 16, 12, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(8, 24, 32, 44, 12);
  g.stroke();

  // tree 80x112 @ (48,0)
  g.fillStyle = '#6b4a2b';
  g.fillRect(48 + 34, 64, 12, 44);
  g.fillStyle = '#2f8f46';
  g.beginPath();
  g.arc(48 + 40, 42, 36, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3fae5a';
  g.beginPath();
  g.arc(48 + 30, 32, 18, 0, Math.PI * 2);
  g.fill();

  // rock 56x40 @ (128,0)
  g.fillStyle = '#8a8f98';
  g.beginPath();
  g.ellipse(128 + 28, 24, 26, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b5bac2';
  g.beginPath();
  g.ellipse(128 + 20, 18, 12, 7, 0, 0, Math.PI * 2);
  g.fill();

  // shadow 48x24 @ (192,0)
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.beginPath();
  g.ellipse(192 + 24, 12, 22, 10, 0, 0, Math.PI * 2);
  g.fill();

  // marker 64x32 @ (0,112): diamond ring (iso footprint of one tile)
  g.strokeStyle = '#ffe36b';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(32, 114);
  g.lineTo(61, 128);
  g.lineTo(32, 142);
  g.lineTo(3, 128);
  g.closePath();
  g.stroke();

  // joystick base 96x96 @ (0,144), knob 48x48 @ (96,144)
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.arc(48, 192, 46, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.beginPath();
  g.arc(96 + 24, 144 + 24, 22, 0, Math.PI * 2);
  g.fill();

  // white pixel block 8x8 @ (192,32) for tinted quads (HUD background)
  g.fillStyle = '#ffffff';
  g.fillRect(192, 32, 8, 8);

  const texture = makeTexture(new ImageAsset(canvas));
  return {
    player: makeFrame(texture, 0, 0, 48, 72),
    tree: makeFrame(texture, 48, 0, 80, 112),
    rock: makeFrame(texture, 128, 0, 56, 40),
    shadow: makeFrame(texture, 192, 0, 48, 24),
    marker: makeFrame(texture, 0, 112, 64, 32),
    joyBase: makeFrame(texture, 0, 144, 96, 96),
    joyKnob: makeFrame(texture, 96, 144, 48, 48),
    pixel: makeFrame(texture, 194, 34, 4, 4),
    texture,
  };
}
