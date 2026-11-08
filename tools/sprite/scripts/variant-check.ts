/** Fast pre-atlas gate: --project <project.json>. Prints provenance/metrics JSON; fails on a lock violation. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { auditProjectVariant, type Project } from '../src/index.js';

const args = process.argv.slice(2);
const index = args.indexOf('--project');
if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith('--'))
  throw new Error('usage: --project <project.json>');
const path = resolve(process.env.INIT_CWD ?? process.cwd(), args[index + 1]!);
const project = JSON.parse(readFileSync(path, 'utf8')) as Project;
const audit = auditProjectVariant(project, dirname(path));
if (!audit) throw new Error('project has no edit-from-master variant declaration');
console.log(JSON.stringify(audit, null, 2));
if (audit.findings.some((f) => f.severity === 'fail')) process.exitCode = 1;
