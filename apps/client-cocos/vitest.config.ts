import { defineConfig } from 'vitest/config';

// Engine-free unit tests only (test/*.test.ts). The project tsconfig extends the Cocos-generated temp/ file, which does not
// exist on CI, so esbuild gets an inline config instead.
export default defineConfig({
  esbuild: { tsconfigRaw: '{"compilerOptions":{"target":"ES2020"}}' },
  test: { include: ['test/**/*.test.ts'] },
});
