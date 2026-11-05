// Headless Cocos Creator build (web-mobile, debug). Not part of CI.
// Editor path: env COCOS_CREATOR_PATH (full path to the CocosCreator executable).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editor = process.env.COCOS_CREATOR_PATH || 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe';
if (!existsSync(editor)) {
  console.error(`Cocos Creator not found at ${editor}\nSet COCOS_CREATOR_PATH to your CocosCreator executable.`);
  process.exit(2);
}
const prep = spawnSync(process.execPath, [resolve(root, 'scripts/prepare.mjs')], { stdio: 'inherit' });
if (prep.status !== 0) process.exit(prep.status ?? 1);

// Options come from build-config.json (the inline "k=v;k=v" form cannot express booleans: debug=true is parsed as a string).
const cfg = JSON.parse(readFileSync(resolve(root, 'build-config.json'), 'utf8'));
if (process.argv.includes('--release')) cfg.debug = false;
const cfgPath = join(tmpdir(), `vgtd-cocos-build-${process.pid}.json`);
writeFileSync(cfgPath, JSON.stringify(cfg));
// remove the previous artifact so the success check below cannot be satisfied by a stale build
rmSync(resolve(root, 'build/web-mobile/index.html'), { force: true });
const r = spawnSync(editor, ['--project', root, '--build', `configPath=${cfgPath}`], { stdio: 'inherit' });
// CocosCreator's exit code is unreliable (0 even on errors); trust the produced artifact instead.
console.log(`CocosCreator exit code: ${r.status}`);
if (!existsSync(resolve(root, 'build/web-mobile/index.html'))) {
  console.error('Build failed: build/web-mobile/index.html is missing - check the log above.');
  process.exit(1);
}
console.log('OK -> build/web-mobile');
