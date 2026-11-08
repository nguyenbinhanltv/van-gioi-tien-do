/** esbuild entry for assets/scripts/vendor/vgtd.js. Namespaced because both packages export iso helpers. */
export * as shared from './shared-subset.js';
export * as core from '../../../packages/client-core/src/index.js';
export * as character from './character-subset.js';
export * as world from '../../../packages/client-world/src/index.js';
