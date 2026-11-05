/**
 * Validators for character / monster definition files: JSON Schema (Ajv 2020) + the cross-field rules a schema
 * cannot express (canvas ↔ footprint, hit volumes, rig limits, animation table, direction scheme, part-break,
 * phases, repack draw-call rule).
 */
import * as Ajv2020Module from 'ajv/dist/2020.js';
import { ANIMATION_IDS, ANIMATIONS, getAnimation, type AnimationId } from './animations.js';
import { PRERENDER_MAX_BREAKABLE_PARTS, RIG_LIMITS, type RigKind } from './boss.js';
import type { CharacterDefinition, MonsterDefinition, RigStats } from './definition.js';
import { getDirectionPolicy } from './direction.js';
import { canvasSizeFor, footprintSize, getHitboxes, usesHudHpBar } from './footprint.js';
import { checkRepackAllDirections } from './paperdoll.js';
import { characterDefinitionSchema, monsterDefinitionSchema } from './schema.js';

type AjvError = { instancePath: string; message?: string };
type AjvValidate = ((data: unknown) => boolean) & { errors?: AjvError[] | null };
type AjvCtor = new (opts?: Record<string, unknown>) => { compile(schema: unknown): AjvValidate };

// Ajv is CJS; under ESM the constructor may be on `.default` or the namespace itself.
const Ajv: AjvCtor = ((Ajv2020Module as unknown as { default?: { default?: AjvCtor } & AjvCtor }).default?.default ??
  (Ajv2020Module as unknown as { default?: AjvCtor }).default ??
  (Ajv2020Module as unknown as AjvCtor)) as AjvCtor;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const validateCharacterSchemaFn = ajv.compile(characterDefinitionSchema);
const validateMonsterSchemaFn = ajv.compile(monsterDefinitionSchema);

function runSchema(fn: AjvValidate, data: unknown): ValidationResult {
  const ok = fn(data);
  return {
    valid: ok,
    errors: ok ? [] : (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`),
  };
}

export function validateCharacterSchema(data: unknown): ValidationResult {
  return runSchema(validateCharacterSchemaFn, data);
}
export function validateMonsterSchema(data: unknown): ValidationResult {
  return runSchema(validateMonsterSchemaFn, data);
}

const result = (errors: string[]): ValidationResult => ({ valid: errors.length === 0, errors });
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function checkRig(rig: RigStats | undefined, kind: RigKind, where: string, errors: string[]): void {
  if (!rig) return;
  const lim = RIG_LIMITS[kind];
  (Object.keys(lim) as (keyof RigStats)[]).forEach((k) => {
    if (rig[k] > lim[k]) errors.push(`${where}: ${k} ${rig[k]} > ${lim[k]} (${kind} rig limit)`);
  });
}

function checkUnique(values: readonly string[], what: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) errors.push(`duplicate ${what} '${v}'`);
    seen.add(v);
  }
}

/** Schema + cross-field checks for a player / npc / pet. */
export function validateCharacterDefinition(data: unknown): ValidationResult {
  const s = validateCharacterSchema(data);
  if (!s.valid) return s;
  const d = data as CharacterDefinition;
  const errors: string[] = [];

  const expectedCanvas = canvasSizeFor(d.footprint);
  if (d.canvas !== expectedCanvas)
    errors.push(`canvas ${d.canvas} ≠ ${expectedCanvas} required by footprint ${d.footprint}`);

  const hit = getHitboxes(d.footprint);
  if (!hit.multiPart) {
    const c = d.collision;
    if (!c.multiPart && !approx(c.colliderRadius, hit.colliderRadius)) {
      errors.push(`collision.colliderRadius ${c.colliderRadius} ≠ ${hit.colliderRadius}`);
    }
    if (!c.multiPart && !approx(c.hurtboxRadius, hit.hurtboxRadius)) {
      errors.push(`collision.hurtboxRadius ${c.hurtboxRadius} ≠ ${hit.hurtboxRadius}`);
    }
    if (!c.multiPart && (c.pickBox.width !== hit.pickBox.width || c.pickBox.height !== hit.pickBox.height)) {
      errors.push(
        `collision.pickBox ${c.pickBox.width}×${c.pickBox.height} ≠ ${hit.pickBox.width}×${hit.pickBox.height}`,
      );
    }
  }
  if (d.collision.multiPart !== false) errors.push('collision.multiPart must be false for characters');

  checkRig(d.rig, d.kind === 'pet' ? 'pet' : 'player', 'rig', errors); // NPCs use the Player rig

  const ids = d.animations.map((a) => a.id);
  checkUnique(ids, 'animation', errors);
  const policy = getDirectionPolicy(d.kind);
  for (const a of d.animations) {
    const spec = getAnimation(a.id as AnimationId);
    if (a.frames !== spec.frames || a.fps !== spec.fps || a.loop !== spec.loop) {
      errors.push(
        `animation '${a.id}': frames/fps/loop ${a.frames}/${a.fps}/${a.loop} ≠ spec ${spec.frames}/${spec.fps}/${spec.loop}`,
      );
    }
    if (a.drawnInEight && !policy.allowFullEight) {
      errors.push(`animation '${a.id}': ${d.kind} cannot draw animations in 8 directions`);
    }
  }
  if (d.kind === 'player') {
    for (const id of ANIMATION_IDS) if (!ids.includes(id)) errors.push(`player is missing animation '${id}'`);
  }

  if (d.kind === 'pet' && d.paperdoll) errors.push('pets have no paperdoll');
  if (d.kind === 'player' && !d.paperdoll) errors.push('player requires paperdoll');
  if (d.paperdoll?.attachments) {
    const r = checkRepackAllDirections(d.paperdoll.attachments);
    for (const e of r.errors) errors.push(`paperdoll repack: ${e}`);
  }
  return result(errors);
}

const MOB_FOOTPRINTS = ['1x1', '2x2'];

/** Schema + cross-field checks for a mob / elite / boss. */
export interface MonsterValidationOptions {
  /** Rig class capping non-boss Spine monsters; null = uncapped. Default 'pet' (docs/31 F-05). */
  readonly nonBossSpineRig?: RigKind | null;
}
export const DEFAULT_NON_BOSS_SPINE_RIG: RigKind = 'pet';

export function validateMonsterDefinition(data: unknown, options: MonsterValidationOptions = {}): ValidationResult {
  const s = validateMonsterSchema(data);
  if (!s.valid) return s;
  const d = data as MonsterDefinition;
  const errors: string[] = [];
  const size = footprintSize(d.footprint);
  const pieced = d.footprint === '8x8';

  // kind ↔ footprint ↔ render
  if (d.kind === 'boss' && size < 2) errors.push('boss footprint must be 2x2, 4x4 or 8x8');
  if (d.kind === 'elite' && d.footprint !== 'elite') errors.push("elite monsters use footprint 'elite' (canvas 192)");
  if (d.kind === 'mob' && !MOB_FOOTPRINTS.includes(d.footprint)) errors.push('mob footprint must be 1x1 or 2x2');
  if (pieced && d.kind !== 'boss') errors.push('only bosses use the pieced 8x8 footprint');
  if (pieced !== (d.render === 'spine_pieced')) errors.push("render 'spine_pieced' is required for (and only for) 8x8");
  if (d.footprint === '4x4' && d.render !== 'spine') errors.push('4x4 and above must be Spine (atlas ceiling)');
  if (d.kind === 'boss' && d.footprint === '2x2' && d.render !== 'spine' && d.render !== 'prerender3d') {
    errors.push('2x2 boss is Spine or pre-render');
  }
  if (d.kind !== 'boss' && d.render === 'spine_pieced') errors.push('only bosses are pieced');

  const expectedCanvas = canvasSizeFor(d.footprint);
  if (d.canvas !== expectedCanvas)
    errors.push(`canvas ${d.canvas} ≠ ${expectedCanvas} required by footprint ${d.footprint}`);

  // directions
  const kind = d.kind === 'boss' ? 'boss' : 'mob';
  const policy = getDirectionPolicy(kind, d.footprint);
  if (d.directions.scheme !== policy.scheme) errors.push(`directions.scheme must be '${policy.scheme}'`);
  if (policy.scheme === 'parts_1_3') {
    if (!d.directions.drawn) errors.push('pieced boss requires directions.drawn (1–3)');
  } else if (d.directions.drawn) errors.push("directions.drawn is only for the pieced boss ('parts_1_3')");
  if (!policy.allowFullEight) {
    d.animations.forEach((a) => {
      if (a.drawnInEight) errors.push(`animation '${a.id}': ${kind} cannot draw animations in 8 directions`);
    });
  }
  checkUnique(
    d.animations.map((a) => a.id),
    'animation',
    errors,
  );
  for (const a of d.animations) {
    const std = ANIMATIONS.find((x) => x.id === a.id);
    if (std && (a.frames !== std.frames || a.fps !== std.fps || a.loop !== std.loop)) {
      errors.push(`animation '${a.id}' redefines a standard animation with different frames/fps/loop`);
    }
  }

  // hit volumes
  const hit = getHitboxes(d.footprint);
  if (hit.multiPart) {
    if (!d.collision.multiPart) errors.push('8x8 boss: collision.multiPart must be true');
    if (!d.parts || d.parts.length === 0) errors.push('8x8 boss requires parts[] (own collider/hurtbox each)');
  } else if (d.collision.multiPart) {
    errors.push('collision.multiPart must be false below 8x8');
  } else {
    const c = d.collision;
    if (!approx(c.colliderRadius, hit.colliderRadius))
      errors.push(`collision.colliderRadius ${c.colliderRadius} ≠ ${hit.colliderRadius}`);
    if (!approx(c.hurtboxRadius, hit.hurtboxRadius))
      errors.push(`collision.hurtboxRadius ${c.hurtboxRadius} ≠ ${hit.hurtboxRadius}`);
    if (c.pickBox.width !== hit.pickBox.width || c.pickBox.height !== hit.pickBox.height) {
      errors.push(
        `collision.pickBox ${c.pickBox.width}×${c.pickBox.height} ≠ ${hit.pickBox.width}×${hit.pickBox.height}`,
      );
    }
  }
  if (d.parts) {
    checkUnique(
      d.parts.map((p) => p.id),
      'part',
      errors,
    );
    if (!pieced) errors.push('parts[] is only for the pieced 8x8 boss');
    else if (!d.parts.some((p) => p.role === 'body')) errors.push('pieced boss needs a body part');
  }

  // rig
  if (d.render === 'spine') {
    if (!d.rig) errors.push('spine monsters require rig stats');
    // Boss → boss limits. Other Spine monsters (xà, giao): docs/29 A.0 #8 / docs/31 F-05 default = Linh thú limits
    // until the art owner sets their own; pass `nonBossSpineRig: null` to leave them uncapped.
    const nonBoss = options.nonBossSpineRig === undefined ? DEFAULT_NON_BOSS_SPINE_RIG : options.nonBossSpineRig;
    if (d.kind === 'boss') checkRig(d.rig, 'boss', 'rig', errors);
    else if (nonBoss) checkRig(d.rig, nonBoss, 'rig', errors);
  }

  // HP bar
  const wantHud = usesHudHpBar(d.footprint);
  if (wantHud && d.hpBar !== 'hud') errors.push('multi-tile monsters show their HP bar on the HUD');

  // part-break
  if (d.partBreak) {
    checkUnique(
      d.partBreak.map((p) => p.slot),
      'partBreak slot',
      errors,
    );
    if (d.render === 'prerender3d' && d.partBreak.length > PRERENDER_MAX_BREAKABLE_PARTS) {
      errors.push(`pre-render monsters may break at most ${PRERENDER_MAX_BREAKABLE_PARTS} part`);
    }
    if (d.render === 'spritesheet' && d.partBreak.length > PRERENDER_MAX_BREAKABLE_PARTS) {
      errors.push(`sprite-sheet monsters may break at most ${PRERENDER_MAX_BREAKABLE_PARTS} part`);
    }
  }

  // phases / variants (bosses only)
  if (d.phases && d.phases.length > 0) {
    if (d.kind !== 'boss') errors.push('phases are for bosses only');
    if (d.render === 'prerender3d' || d.render === 'spritesheet') errors.push('phase-by-skin needs a Spine boss');
    checkUnique(
      d.phases.map((p) => p.id),
      'phase',
      errors,
    );
    checkUnique(
      d.phases.map((p) => String(p.hpThreshold)),
      'phase hpThreshold',
      errors,
    );
    checkUnique(
      d.phases.map((p) => p.skin),
      'phase skin',
      errors,
    );
  }
  if (d.variants && d.variants.length > 0) {
    if (d.kind !== 'boss') errors.push('mutation variants are for bosses only');
    checkUnique(
      d.variants.map((v) => v.id),
      'variant',
      errors,
    );
  }
  return result(errors);
}
