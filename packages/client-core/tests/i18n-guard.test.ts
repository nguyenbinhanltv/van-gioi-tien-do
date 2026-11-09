import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { placeholdersOf, sourceStrings, unsupportedGlyphs, VIETNAMESE_LETTERS } from '../src/index.js';

/**
 * i18n guard (D104, docs/19 §2): player-facing text lives in `src/i18n/vi-VN.json` behind `t(key, params)`. This test reads the client
 * sources (TypeScript AST, no engine needed) and fails on
 *   - a hard-coded player-facing string (rules below),
 *   - a `t('key')` whose key is not in the table, a table key nothing uses, a placeholder without a parameter,
 *   - a table value with a character outside the supported glyph set, or not in NFC.
 * A line that must keep a literal (a diagnostic overlay, a node name that looks like text) says why with `// i18n-exempt: <reason>`
 * on the same or the previous line.
 */

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOTS = ['packages/client-core/src', 'packages/client-combat/src', 'packages/client-world/src', 'apps/client-cocos/assets/scripts'];
/** Never player-facing: the vendored bundle, the animation viewer (a developer tool), the table itself. */
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'viewer', 'i18n']);
/** Developer overlays (frame stats, batch-break report): English by design, not part of the game UI. */
const SKIP_FILES = new Set(['PerfHud.ts', 'DrawDebug.ts']);

const VIET = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;
/** `x.string = ...` (Cocos Label), DOM text properties. */
const SINKS = new Set(['string', 'textContent', 'innerText', 'placeholder']);
/** Object properties that hold text shown to the player. */
const TEXT_PROPS = new Set(['label', 'text', 'caption', 'title', 'hint', 'message', 'note', 'placeholder', 'tooltip', 'toast', 'name']);
const TEXTY_CONST = /(TEXT|LABEL|CAPTION|MESSAGES?|TITLES?|NAMES)$/;
const KEY_SHAPE = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

const table = sourceStrings();
const keys = new Set(Object.keys(table));
const letters = (s: string): number => (s.match(/[A-Za-zÀ-ỹ]/g) ?? []).length;

function listFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !SKIP_FILES.has(e.name)) out.push(p);
    }
  };
  for (const r of ROOTS) walk(path.join(repo, r));
  return out;
}

const isStr = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);

interface Scan {
  violations: string[];
  /** t('key') calls: key, parameter names (null = not an object literal) */
  calls: Array<{ where: string; key: string; params: string[] | null }>;
  /** every string literal that is exactly a table key (a key referenced through a map, e.g. CLASS_KEYS) */
  keyLiterals: Set<string>;
}

function scan(): Scan {
  const res: Scan = { violations: [], calls: [], keyLiterals: new Set() };
  for (const file of listFiles()) {
    const rel = path.relative(repo, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
    const exempt = (line: number): boolean => /i18n-exempt/.test(lines[line - 1] ?? '') || /i18n-exempt/.test(lines[line - 2] ?? '');
    const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const report = (n: ts.Node, rule: string, text: string): void => {
      const line = lineOf(n);
      if (!exempt(line)) res.violations.push(`${rel}:${line} [${rule}] ${JSON.stringify(text).slice(0, 90)}`);
    };
    const insideT = (n: ts.Node): boolean => {
      for (let p = n.parent; p; p = p.parent) {
        if (ts.isCallExpression(p) && /^(t|core\.t)$/.test(p.expression.getText())) return true;
      }
      return false;
    };
    const literalsIn = (n: ts.Node, acc: ts.Node[] = []): ts.Node[] => {
      if (isStr(n)) acc.push(n);
      ts.forEachChild(n, (c) => void literalsIn(c, acc));
      return acc;
    };
    const textOf = (n: ts.Node): string => (isStr(n) ? n.text : '');
    /** A literal compared with === / !== / case is a value, not text. */
    const compared = (lit: ts.Node): boolean => {
      const p = lit.parent;
      return (
        !!p &&
        ((ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText())) || ts.isCaseClause(p) || ts.isElementAccessExpression(p))
      );
    };
    /** A literal is fine when it is a table key (a reference, not text), has <2 letters (a glyph, a unit), is compared, or sits inside t(). */
    const flag = (lit: ts.Node, rule: string, propName = ''): void => {
      const text = textOf(lit);
      if (keys.has(text) || letters(text) < 2 || insideT(lit) || compared(lit)) return;
      // `name` is mostly an id (snake_case): only prose-looking values count (a space or a capital)
      if (propName === 'name' && !/[\sA-Z]/.test(text)) return;
      report(lit, rule, text);
    };
    const visit = (n: ts.Node): void => {
      if (isStr(n)) {
        if (keys.has(n.text)) res.keyLiterals.add(n.text);
        if (VIET.test(n.text) && !insideT(n)) report(n, 'diacritics', n.text);
      }
      if (ts.isCallExpression(n) && /^(t|core\.t)$/.test(n.expression.getText())) {
        const [k, p] = n.arguments;
        if (k && isStr(k)) {
          const params = p && ts.isObjectLiteralExpression(p) && !p.properties.some((x) => ts.isSpreadAssignment(x))
            ? p.properties.map((x) => (x.name && (ts.isIdentifier(x.name) || ts.isStringLiteral(x.name)) ? x.name.text : '?'))
            : p ? null : [];
          res.calls.push({ where: `${rel}:${lineOf(n)}`, key: k.text, params });
        }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && SINKS.has(n.left.name.text)) {
        for (const lit of literalsIn(n.right)) flag(lit, 'sink');
      }
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && TEXT_PROPS.has(n.name.text)) {
        for (const lit of literalsIn(n.initializer)) flag(lit, 'prop', n.name.text);
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && TEXTY_CONST.test(n.name.text) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const lit of literalsIn(n.initializer)) flag(lit, 'text-table');
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return res;
}

const result = scan();

describe('i18n guard (D104)', () => {
  it('no hard-coded player-facing string in client-core, client-combat, client-world and the Cocos client', () => {
    expect(result.violations, `Move these into src/i18n/vi-VN.json and use t(key), or add "// i18n-exempt: <reason>":\n${result.violations.join('\n')}`).toEqual([]);
  });

  it('every t() key exists in the table and gets all its placeholders', () => {
    const problems: string[] = [];
    for (const c of result.calls) {
      const template = table[c.key];
      if (template === undefined) {
        problems.push(`${c.where}: unknown key ${c.key}`);
        continue;
      }
      if (c.params === null) continue; // spread / variable: cannot be checked here
      for (const name of placeholdersOf(template)) if (!c.params.includes(name)) problems.push(`${c.where}: ${c.key} needs {${name}}`);
    }
    expect(problems).toEqual([]);
  });

  it('every table key is used: by a t() call or as a key literal (maps such as CLASS_KEYS)', () => {
    const used = new Set([...result.calls.map((c) => c.key), ...result.keyLiterals]);
    expect(Object.keys(table).filter((k) => !used.has(k))).toEqual([]);
  });

  it('keys are domain.sub.name (lower case, dots), values are non-empty NFC text', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(table)) {
      if (!KEY_SHAPE.test(k)) bad.push(`${k}: not domain.sub.name`);
      if (v.trim() === '') bad.push(`${k}: empty`);
      if (v !== v.normalize('NFC')) bad.push(`${k}: not NFC`);
    }
    expect(bad).toEqual([]);
  });

  it('every character of the table is in the supported glyph set (ASCII, Vietnamese letters, a few symbols)', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(table)) {
      const u = unsupportedGlyphs(v);
      if (u.length) bad.push(`${k}: ${u.join(' ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('the glyph set holds all 146 Vietnamese letter forms', () => {
    expect(new Set(VIETNAMESE_LETTERS).size).toBe(146);
    for (const ch of 'ấầẩẫậắằẳẵặếềểễệốồổỗộớờởỡợứừửữựỳỷỹỵđĐẤỒỞỮỰ') expect(VIETNAMESE_LETTERS).toContain(ch);
  });
});
