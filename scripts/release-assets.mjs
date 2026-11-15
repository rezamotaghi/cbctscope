#!/usr/bin/env node
// The guard before the site goes live (docs/web-build.md, section 9), in two modes. The site's
// download menu links to the installers through /releases/latest/download/<name>, so a
// prerelease, or a release published without "Set as latest", would leave the links on another
// release. Both modes read the release's own asset list, so files attached by the release
// job's publish job and files the owner attached by hand count the same. Each runs once and
// never waits. Fail-closed: any problem below, a network error, or any answer but 200 (a 404 for
// the latest release included) exits 1.
//
// The release mode (release.yml): the release that started the run must be GitHub's latest
// release and carry the three installers.
//
//   RELEASE_ID=<id> GITHUB_TOKEN=<token> node scripts/release-assets.mjs
//
// The site update mode (site-update.yml): the site carries the version in package.json on its
// update page, and its download menu leads to the latest release, so GitHub's latest release
// must have the tag v<package.json version> and carry the three installers. A bumped version
// that was never released, or a release without its installers, stops the site update.
//
//   GITHUB_TOKEN=<token> node scripts/release-assets.mjs --site-update
//
// GITHUB_REPOSITORY and GITHUB_API_URL are set on every Actions runner. The names below are
// the ones in components/downloads.ts (INSTALLER_NAMES); tests/downloads.test.ts fails when
// they differ.
import { readFileSync } from 'node:fs';
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
  const have = new Set(assets.filter((a) => a.state === 'uploaded').map((a) => a.name));
  return required.filter((name) => !have.has(name));
}

/**
 * Why the release of this run is not the one the menu's links reach, or null when it is.
 * @param {number} status the HTTP status of GET /repos/{repo}/releases/latest
 * @param {number | null} latestId the id in that answer, when it was 200
 * @param {string} releaseId this run's release id
 */
export function latestProblem(status, latestId, releaseId) {
  const fix = 'publish it as the latest release, not as a prerelease, with "Set as latest release" ticked';
  if (status === 404) {
    return `release-assets: GitHub has no latest release (only prereleases or drafts), so the download menu's links lead nowhere; ${fix}`;
  }
  if (status !== 200) return `release-assets: GitHub answered ${status} for the latest release`;
  if (String(latestId) !== releaseId) {
    return `release-assets: release ${releaseId} is not GitHub's latest release (that is ${latestId}), so the download menu's links would reach another release; ${fix}`;
  }
  return null;
}

/** the release tag a version is published under */
export const tagFor = (/** @type {string} */ version) => `v${version}`;

/**
 * Why GitHub's latest release is not the release of this version, or null when it is.
 * @param {number} status the HTTP status of GET /repos/{repo}/releases/latest
 * @param {string | null} latestTag the tag_name in that answer, when it was 200
 * @param {string} version the version in package.json
 */
export function siteUpdateProblem(status, latestTag, version) {
  const tag = tagFor(version);
  if (status === 404) {
    return `release-assets: GitHub has no latest release (only prereleases or drafts), so the site's download menu would lead nowhere; publish ${tag} as the latest release with the release workflow, which deploys the site itself`;
  }
  if (status !== 200) return `release-assets: GitHub answered ${status} for the latest release; run the site update again later`;
  if (latestTag !== tag) {
    return `release-assets: the latest release is ${latestTag}, but package.json on this commit says ${version}, so the site would name a version whose installers are not published; publish ${tag} as a release instead (it deploys the site), or run the site update from a commit whose version is the latest release's`;
  }
  return null;
}

/**
 * The lines that refuse a site update for installers the latest release lacks, or [] when none
 * is missing.
 * @param {string[]} missing
 * @param {string} tag
 */
export function siteUpdateMissingLines(missing, tag) {
  if (!missing.length) return [];
  return [
    `release-assets: release ${tag} lacks ${missing.length} of the ${REQUIRED_ASSETS.length} installers the download menu links to, so the site is not deployed:`,
    ...missing.map((name) => `  ${name}`),
    `release-assets: attach them to release ${tag}, then run the site update again`,
  ];
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
 * @param {typeof fetch} [fetchImpl]
 */
export async function listAssets(api, repository, releaseId, token, fetchImpl = fetch) {
  const headers = apiHeaders(token);
  /** @type {{ name: string, state?: string }[]} */
  const assets = [];
  /** @type {string | null} */
  let url = `${api}/repos/${repository}/releases/${releaseId}/assets?per_page=${PER_PAGE}`;
  for (let page = 0; url; page += 1) {
    if (page >= MAX_PAGES) throw new Error(`release-assets: more than ${MAX_PAGES} pages of assets`);
    let res;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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

/**
 * The status, id and tag of GitHub's latest release.
 * @param {string} api
 * @param {string} repository
 * @param {Record<string, string>} headers
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ status: number, id: number | null, tag: string | null }>}
 */
export async function readLatest(api, repository, headers, fetchImpl = fetch) {
  const url = `${api}/repos/${repository}/releases/latest`;
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`release-assets: could not read the latest release (${url}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status !== 200) return { status: res.status, id: null, tag: null };
  const body = await res.json();
  if (typeof body?.id !== 'number') throw new Error(`release-assets: the answer for ${url} carries no release id`);
  return { status: 200, id: body.id, tag: typeof body.tag_name === 'string' ? body.tag_name : null };
}

/**
 * The site update mode: the lines that refuse the deploy, or [] when GitHub's latest release
 * is the release of this version and carries the three installers. Any answer but 200 for the
 * latest release is a refusing line; a network error, an answer without a release id, or any
 * answer but 200 for the asset list throws, and the caller refuses with that message.
 * @param {{ api: string, repository: string, token: string, version: string, fetchImpl?: typeof fetch }} o
 */
export async function checkSiteUpdate({ api, repository, token, version, fetchImpl = fetch }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return [`release-assets: package.json's version "${version}" is not major.minor.patch; set a release version there`];
  const latest = await readLatest(api, repository, apiHeaders(token), fetchImpl);
  const problem = siteUpdateProblem(latest.status, latest.tag, version);
  if (problem) return [problem];
  const assets = await listAssets(api, repository, String(latest.id), token, fetchImpl);
  return siteUpdateMissingLines(missingAssets(assets), tagFor(version));
}

/** @param {string} token */
export function apiHeaders(token) {
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  if (process.argv.includes('--site-update')) return siteUpdateMain(api, repository);
  const releaseId = process.env.RELEASE_ID ?? '';
  if (!/^\d+$/.test(releaseId)) throw new Error('release-assets: no release id in RELEASE_ID: this run was not started by a published release');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('release-assets: GITHUB_REPOSITORY is not owner/name');
  const token = process.env.GITHUB_TOKEN ?? '';
  const latest = await readLatest(api, repository, apiHeaders(token));
  const notLatest = latestProblem(latest.status, latest.id, releaseId);
  if (notLatest) {
    console.error(notLatest);
    process.exit(1);
  }
  const assets = await listAssets(api, repository, releaseId, token);
  const missing = missingAssets(assets);
  if (missing.length) {
    console.error(`release-assets: the release lacks ${missing.length} of the ${REQUIRED_ASSETS.length} installers the download menu links to, so the site is not deployed:`);
    for (const name of missing) console.error(`  ${name}`);
    console.error('release-assets: attach them to the release, then use "Re-run failed jobs" on this workflow run');
    process.exit(1);
  }
  console.log(`release-assets: release ${releaseId} is the latest release and carries all ${REQUIRED_ASSETS.length} installers: ${REQUIRED_ASSETS.join(', ')}`);
}

/**
 * @param {string} api
 * @param {string} repository
 */
async function siteUpdateMain(api, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('release-assets: GITHUB_REPOSITORY is not owner/name');
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const version = String(pkg.version ?? '');
  let lines;
  try {
    lines = await checkSiteUpdate({ api, repository, token: process.env.GITHUB_TOKEN ?? '', version });
  } catch (err) {
    lines = [`${err instanceof Error ? err.message : String(err)}; the site is not deployed: run the site update again once GitHub answers`];
  }
  if (lines.length) {
    for (const line of lines) console.error(line);
    process.exit(1);
  }
  console.log(`release-assets: the latest release is ${tagFor(version)}, the version in package.json, and carries all ${REQUIRED_ASSETS.length} installers: ${REQUIRED_ASSETS.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
