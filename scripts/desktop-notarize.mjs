#!/usr/bin/env node
// The dmg's own notarisation (docs/web-build.md, section 12). electron-builder 26.18.0 signs the
// dmg (`dmg.sign: true`, the same Developer ID identity as the app) but notarises and staples
// only the app inside it, so scripts/desktop.mjs calls notariseDmgs() on every dmg it built:
//
//   xcrun notarytool submit <dmg> <credentials> --wait --output-format json   (status Accepted)
//   xcrun stapler staple <dmg>
//   xcrun stapler validate <dmg>
//
// The credentials follow electron-builder's own choice, in its order: APPLE_ID +
// APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, then APPLE_API_KEY (the path of the .p8) +
// APPLE_API_KEY_ID + APPLE_API_ISSUER, then APPLE_KEYCHAIN_PROFILE (with APPLE_KEYCHAIN when
// set). An unsigned build skips all of it with one line.
//
//   node scripts/desktop-notarize.mjs --dry-run <file.dmg>...   prints the commands, runs none
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SKIP_UNSIGNED = 'desktop: unsigned build, so the dmg is not signed, notarised or stapled';
export const SKIP_NO_IDENTITY = 'desktop: no Developer ID identity signed the dmg, so it is not notarised or stapled';

/** why the dmg step is skipped before anything runs, or null when it goes ahead */
export function dmgNotarySkip(env, platform) {
  if (platform !== 'darwin') return 'desktop: not macOS, no dmg to notarise';
  // electron-builder finds no identity without auto discovery unless one is named
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !env.CSC_NAME) return SKIP_UNSIGNED;
  return null;
}

/** the notarytool credential arguments electron-builder would choose, or null when none are set */
export function notaryAuth(env) {
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`notarisation: ${missing.join(', ')} not set (the Apple ID route needs all three)`);
    return { route: 'apple-id', args: ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID] };
  }
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    const missing = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`notarisation: ${missing.join(', ')} not set (the API key route needs all three)`);
    return { route: 'api-key', args: ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID, '--issuer', env.APPLE_API_ISSUER] };
  }
  if (env.APPLE_KEYCHAIN_PROFILE) {
    const keychain = env.APPLE_KEYCHAIN ? ['--keychain', env.APPLE_KEYCHAIN] : [];
    return { route: 'keychain-profile', args: [...keychain, '--keychain-profile', env.APPLE_KEYCHAIN_PROFILE] };
  }
  return null;
}

/**
 * the three commands for one dmg, as [command, args] pairs
 * @param {string} dmg
 * @param {string[]} authArgs
 * @returns {Array<[string, string[]]>}
 */
export function dmgCommands(dmg, authArgs) {
  return [
    ['xcrun', ['notarytool', 'submit', dmg, ...authArgs, '--wait', '--output-format', 'json']],
    ['xcrun', ['stapler', 'staple', dmg]],
    ['xcrun', ['stapler', 'validate', dmg]],
  ];
}

/**
 * a command as one printable line, the app-specific password hidden
 * @param {[string, string[]]} command
 */
export function showCommand([cmd, args]) {
  const shown = args.map((a, i) => (args[i - 1] === '--password' ? '********' : a));
  return [cmd, ...shown].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

const exec = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
};

/** true when the dmg carries a Developer ID Application signature */
export function isDeveloperIdSigned(dmg, run = exec) {
  const r = run('codesign', ['-dv', '--verbose=2', dmg]);
  return r.status === 0 && /Authority=Developer ID Application:/.test(r.stderr + r.stdout);
}

/**
 * Notarise, staple and validate each dmg. Throws with a plain message when a step fails, so the
 * build fails. `run` and `log` are injectable for the tests.
 */
export function notariseDmgs(dmgs, env, { platform = process.platform, run = exec, log = console.log } = {}) {
  if (!dmgs.length) return 'none';
  const skip = dmgNotarySkip(env, platform);
  if (skip) {
    log(skip);
    return 'skipped';
  }
  const signed = dmgs.filter((d) => isDeveloperIdSigned(d, run));
  if (!signed.length) {
    log(SKIP_NO_IDENTITY);
    return 'skipped';
  }
  if (signed.length !== dmgs.length) {
    const unsigned = dmgs.filter((d) => !signed.includes(d));
    throw new Error(`notarisation: ${unsigned.join(', ')} is not signed while the other dmg is; rebuild`);
  }
  const auth = notaryAuth(env);
  if (!auth) {
    throw new Error(
      'notarisation: the dmg is signed but no credentials are set (APPLE_KEYCHAIN_PROFILE, or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID)',
    );
  }
  for (const dmg of dmgs) {
    const [submit, staple, validate] = dmgCommands(dmg, auth.args);
    log(`desktop: notarising ${dmg} (${auth.route}), this waits for Apple`);
    const s = run(...submit);
    let result = null;
    try {
      result = JSON.parse(s.stdout);
    } catch {
      /* reported below */
    }
    if (s.status !== 0 || result?.status !== 'Accepted') {
      const id = result?.id ? ` Submission ${result.id}; its log: ${showCommand(['xcrun', ['notarytool', 'log', result.id, ...auth.args]])}` : '';
      throw new Error(`notarisation: Apple did not accept ${dmg} (status ${result?.status ?? 'unknown'}, exit ${s.status}).${id}\n${s.stderr.trim()}`);
    }
    for (const [step, cmd] of [
      ['stapling', staple],
      ['validating the staple of', validate],
    ]) {
      const r = run(...cmd);
      if (r.status !== 0) throw new Error(`notarisation: ${step} ${dmg} failed (exit ${r.status}): ${showCommand(cmd)}\n${(r.stderr || r.stdout).trim()}`);
    }
    log(`desktop: ${dmg} notarised, stapled and validated`);
  }
  return 'notarised';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [flag, ...dmgs] = process.argv.slice(2);
  if (flag !== '--dry-run' || !dmgs.length) {
    console.error('usage: node scripts/desktop-notarize.mjs --dry-run <file.dmg>...');
    process.exit(2);
  }
  const skip = dmgNotarySkip(process.env, 'darwin');
  if (skip) {
    console.log(skip);
    process.exit(0);
  }
  const auth = notaryAuth(process.env);
  if (!auth) {
    console.log('desktop: no notarisation credentials in the environment');
    process.exit(0);
  }
  console.log(`route: ${auth.route}`);
  for (const dmg of dmgs) for (const c of dmgCommands(dmg, auth.args)) console.log(showCommand(c));
}
