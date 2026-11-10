/** Entry of the operator commands (bundled and run by scripts/ops.mjs): `node ops.mjs backup|verify|restore|list ...`. */
import { runCli } from './cli.js';

process.exit(runCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l) }));
