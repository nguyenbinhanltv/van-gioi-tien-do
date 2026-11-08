#!/usr/bin/env -S npx tsx
/**
 * Asset budget gate CLI.
 *   npx tsx pipeline/budget_gate.mts --atlas build/atlas [--dist build/dist/web] [--platform web|mobile|pc]
 *                                    [--limitMb 25] [--reservedMb 9] [--no-pixels] [--chibi <dragonbones dir>|--no-chibi] [--summary path.md]
 * Prints a Markdown report; appends it to $GITHUB_STEP_SUMMARY when set (GitHub Actions job summary).
 * Exit codes: 0 pass (warnings allowed) · 20 budget violated · 1 usage / unexpected error.
 */
import fs from 'node:fs';
import { runBudget, renderMarkdown, type Platform } from '../src/budget/check.mjs';

function parse(argv: string[]): Record<string, string | true> {
  const o: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(argv[i]!);
    if (!m) continue;
    const key = m[1]!;
    if (m[2] !== undefined) o[key] = m[2];
    else if (key === 'no-pixels' || key === 'no-chibi') o[key] = true;
    else o[key] = argv[++i] ?? '';
  }
  return o;
}

try {
  const a = parse(process.argv.slice(2));
  const platform = String(a.platform ?? 'web') as Platform;
  if (!['web', 'mobile', 'pc'].includes(platform)) throw new Error(`--platform không hợp lệ: ${platform}`);
  const report = runBudget({
    atlasDir: String(a.atlas ?? 'build/atlas'),
    distDir: a.dist ? String(a.dist) : undefined,
    platform,
    limitMb: a.limitMb ? Number(a.limitMb) : undefined,
    reservedMb: a.reservedMb !== undefined ? Number(a.reservedMb) : undefined,
    checkPixels: a['no-pixels'] !== true,
    chibiDir: a['no-chibi'] === true ? undefined : String(a.chibi ?? '../../apps/client-cocos/assets/resources/dragonbones'),
  });
  const md = renderMarkdown(report);
  console.log(md);
  const summary = (a.summary as string | undefined) ?? process.env.GITHUB_STEP_SUMMARY;
  if (summary) fs.appendFileSync(summary, md + '\n');
  process.exit(report.ok ? 0 : 20);
} catch (e) {
  console.error('✖', (e as Error).message);
  process.exit(1);
}
