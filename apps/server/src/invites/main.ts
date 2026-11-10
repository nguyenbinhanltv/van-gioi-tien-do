import { runInviteCli } from './cli.js';

process.exit(
  runInviteCli(process.argv.slice(2), process.env, {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  }),
);
