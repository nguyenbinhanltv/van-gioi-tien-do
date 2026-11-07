import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { formatSkillSimReport } from '../src/index.js';

it('prints the D49 sim report when VGTD_SIM_REPORT is set', () => {
  const md = formatSkillSimReport();
  expect(md).toContain('Solo rotation DPS');
  if (process.env.VGTD_SIM_REPORT) writeFileSync(process.env.VGTD_SIM_REPORT, md);
});
