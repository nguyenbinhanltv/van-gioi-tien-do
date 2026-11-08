// Doc link check (no dependencies). Run from the repo root: `npm run docs:links`.
// 1. Every relative Markdown link `[text](path#anchor)` in a tracked .md file must point at an existing file.
// 2. Every `docs/<path>` mentioned in a code span in the agent-facing files (CLAUDE.md, AGENTS.md, .claude/**)
//    must exist (placeholders such as `docs/NN-name.md` or globs are skipped).
// External links (http, https, mailto) and ao:// links are ignored; anchors are not validated.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const tracked = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

for (const file of tracked) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\]\((?!https?:|mailto:|ao:|#)([^)\s#]+)(?:#[^)]*)?\)/g)) {
    let target = m[1];
    try {
      target = decodeURIComponent(target);
    } catch {
      /* keep raw */
    }
    if (!existsSync(join(dirname(file), target))) problems.push(`${file}: broken link -> ${m[1]}`);
  }
}

const agentFiles = tracked.filter((f) => f === 'CLAUDE.md' || f === 'AGENTS.md' || f.startsWith('.claude/'));
for (const file of agentFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/`(docs\/[A-Za-z0-9_./-]+\.(?:md|json|svg))`/g)) {
    if (/NN|<|\*/.test(m[1])) continue;
    if (!existsSync(m[1])) problems.push(`${file}: missing doc path ${m[1]}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n${problems.length} doc link problem(s)\n`);
  process.exit(1);
}
process.stdout.write(`doc links ok (${tracked.length} Markdown files)\n`);
