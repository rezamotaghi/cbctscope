#!/usr/bin/env node
// The release job's guard before the site goes live (docs/web-build.md, section 9): the deploy
// job runs it first and stops unless the release that started the run carries the three
// installers the site's download menu links to by fixed name. It reads the release's own asset
// list, so files attached by the publish job and files the owner attached by hand before
// publishing count the same. Fail-closed: a missing file, a missing release id, a network error
// or any answer but 200 exits 1.
//
//   RELEASE_ID=<id> GITHUB_TOKEN=<token> node scripts/release-assets.mjs
//
// GITHUB_REPOSITORY and GITHUB_API_URL are set on every Actions runner. The names below are
// the ones in components/downloads.ts (INSTALLER_NAMES); tests/downloads.test.ts fails when
// they differ.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** the installers' fixed asset names, as INSTALLER_NAMES in components/downloads.ts */
export const REQUIRED_ASSETS = Object.freeze(['CBCTScope-mac-arm64.dmg', 'CBCTScope-mac-x64.dmg', 'CBCTScope-windows-setup.exe']);

const REQUEST_TIMEOUT_MS = 20_000;
// a release here carries about ten assets; the page loop still follows GitHub's Link header
const PER_PAGE = 100;
const MAX_PAGES = 10;

/**
 * The required names the release does not carry as finished uploads, in the order given. An
 * asset still uploading (state "open") does not count.
 * @param {{ name: string, state?: string }[]} assets
 * @param {readonly string[]} required
 */
export function missingAssets(assets, required = REQUIRED_ASSETS) {
  const have = new Set(assets.filter((a) => (a.state ?? 'uploaded') === 'uploaded').map((a) => a.name));
  return required.filter((name) => !have.has(name));
}

/**
 * The address of the next page from a Link header, or null on the last page.
 * @param {string | null} link
 */
export function nextPage(link) {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Every asset of one release, page by page.
 * @param {string} api
 * @param {string} repository owner/name
 * @param {string} releaseId
 * @param {string} token
 */
async function listAssets(api, repository, releaseId, token) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  /** @type {{ name: string, state?: string }[]} */
  const assets = [];
  /** @type {string | null} */
  let url = `${api}/repos/${repository}/releases/${releaseId}/assets?per_page=${PER_PAGE}`;
  for (let page = 0; url; page += 1) {
    if (page >= MAX_PAGES) throw new Error(`release-assets: more than ${MAX_PAGES} pages of assets`);
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`release-assets: could not read the release's assets (${url}): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status !== 200) throw new Error(`release-assets: GitHub answered ${res.status} for ${url}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`release-assets: the answer for ${url} is not a list`);
    assets.push(...body);
    url = nextPage(res.headers.get('link'));
  }
  return assets;
}

async function main() {
  const releaseId = process.env.RELEASE_ID ?? '';
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  if (!/^\d+$/.test(releaseId)) throw new Error('release-assets: no release id in RELEASE_ID: this run was not started by a published release');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('release-assets: GITHUB_REPOSITORY is not owner/name');
  const assets = await listAssets(api, repository, releaseId, process.env.GITHUB_TOKEN ?? '');
  const missing = missingAssets(assets);
  if (missing.length) {
    console.error(`release-assets: the release lacks ${missing.length} of the ${REQUIRED_ASSETS.length} installers the download menu links to, so the site is not deployed:`);
    for (const name of missing) console.error(`  ${name}`);
    process.exit(1);
  }
  console.log(`release-assets: the release carries all ${REQUIRED_ASSETS.length} installers: ${REQUIRED_ASSETS.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
