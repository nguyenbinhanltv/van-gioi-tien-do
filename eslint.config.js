import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'apps/client-cocos/**',
      'apps/server/scripts/**', // plain Node launcher (.mjs)
      'scripts/**', // plain Node launcher (`npm run play`)
      'tools/procgen/**',
      'tools/dragonbones-testrig/scripts/**', // plain Node CLI (.mjs), like the procgen scripts
      'tools/rig/scripts/**/*.mjs', // plain Node launcher (.mjs); the TypeScript scripts there are linted
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
