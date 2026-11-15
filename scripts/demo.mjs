// Cross-platform `npm run demo`: set the demo flag, render the manual, then start the same dev server
// as `npm run dev`. Unix shell syntax (`CBCTSCOPE_DEMO=1 next dev`) would be rejected by the
// Windows shell; setting the flag from Node works identically on every OS.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { writeManual } from './manual-html.mjs';

const require = createRequire(import.meta.url);
const nextPkg = require.resolve('next/package.json');
const nextBin = join(dirname(nextPkg), require('next/package.json').bin.next);

// the help drawer's pages (public/manual/), as `npm run dev` renders them in its predev step
writeManual();

const child = spawn(
  process.execPath,
  [nextBin, 'dev', '-H', '127.0.0.1', '--port', '3810'],
  { stdio: 'inherit', env: { ...process.env, CBCTSCOPE_DEMO: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
