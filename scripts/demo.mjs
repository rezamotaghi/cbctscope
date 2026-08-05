// Cross-platform `npm run demo`: set the demo flag, then start the same dev server as
// `npm run dev`. The flag used to be set with Unix shell syntax (`CBCTSCOPE_DEMO=1 next dev`),
// which the Windows shell rejects; setting it from Node works identically on every OS.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const nextPkg = require.resolve('next/package.json');
const nextBin = join(dirname(nextPkg), require('next/package.json').bin.next);

const child = spawn(
  process.execPath,
  [nextBin, 'dev', '-H', '127.0.0.1', '--port', '3810'],
  { stdio: 'inherit', env: { ...process.env, CBCTSCOPE_DEMO: '1' } },
);
child.on('exit', (code) => process.exit(code ?? 0));
