#!/usr/bin/env node
'use strict';
// Gói này là JavaScript thuần (không có bước biên dịch): `build` / `typecheck` = kiểm tra cú pháp mọi file .js.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'out', 'build', 'reports', 'preview']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(root);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(r.stderr); }
}
console.log(bad ? `✖ ${bad} file lỗi cú pháp` : `✔ ${files.length} file .js hợp lệ`);
process.exit(bad ? 1 : 0);
