#!/usr/bin/env node
// The user manual as static pages (docs/web-build.md, section 13). One source: the markdown
// under docs/manual/ and docs/reading-modes/, in the order of docs/manual/manifest.json. This
// script renders it, at build time, into plain HTML that nothing commits:
//
//   node scripts/manual-html.mjs [--out <dir>]     (default public/manual)
//
// npm run build, npm run dev (predev), npm run demo and scripts/build-web.mjs run it, so the
// local app, the web build and the desktop app all serve manual/ from their own origin.
//
// What a page is: one per manifest entry (named after its markdown file), plus index.html with
// the manifest as the table of contents; headings carry GitHub-style ids, so an anchor that
// works on GitHub works here; links between chapters point at the generated pages, links to
// other repo files at the project page (a new tab, never a request), and the stills are copied
// into media/. `?theme=dark` (the viewer's help drawer) forces the dark theme on every page it
// reaches; without it a page follows the system setting. The bar links back to the viewer, one
// level up (manual/ sits beside it, under any base path); in the drawer the viewer is already
// beside the page, so manual.js drops that link there. Every page carries a meta description and
// a title from its manifest entry (pageTitle, description: the question the page answers; the
// headings in the markdown stay as they are), the canonical production address, and a footer
// with the author line (to the About page), the viewer and the legal page. No inline script and no remote asset: manual.js and manual.css sit next to the
// pages, so the web build's CSP (written into every exported page by build-web.mjs) holds.
// Markdown rendering: marked (devDependency, exact version, no dependencies of its own).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { canonicalUrl } from '../components/siteAddress.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
/** where links to repo files outside the manual go: the project page, main branch */
export const REPO_BLOB = 'https://github.com/rezamotaghi/cbctscope/blob/main/';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's heading anchor: lowercase, punctuation dropped, each space a hyphen, repeats numbered */
export function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** markdown inline syntax reduced to its words, for the search index and plain titles */
export function plain(md) {
  return String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** the footer's author line, linking to the About page (the manual's front page names him the same way) */
export const AUTHOR_LINE = 'By Dr. Reza Motaghi, oral and maxillofacial radiologist';

/** the page file a manifest entry becomes: its markdown file's name, .html */
export const pageName = (file) => path.posix.basename(file).replace(/\.md$/, '.html');

/**
 * Read the manifest, the version and the revision, and render every entry.
 * @param {string} [root]
 */
export function loadManual(root = ROOT) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8'));
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const front = readFileSync(path.join(root, 'docs/manual/00-front.md'), 'utf8');
  const revision = /\|\s*Manual revision\s*\|\s*([^|]+?)\s*\|/.exec(front)?.[1] ?? '';
  const byFile = new Map(manifest.chapters.map((c) => [c.file, pageName(c.file)]));
  /** stills to copy: repo path -> media/<name> */
  const media = new Map();

  const chapters = manifest.chapters.map((entry, index) => {
    const md = readFileSync(path.join(root, entry.file), 'utf8');
    const dir = path.posix.dirname(entry.file);
    const slug = slugger();
    const headings = [];
    const links = [];

    /** a markdown href, relative to this chapter, as the generated page addresses it */
    const rewrite = (href, image) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { href, external: true };
      if (href.startsWith('#')) return { href, external: false };
      const [rel, hash] = href.split('#');
      const repoPath = path.posix.normalize(path.posix.join(dir, rel)).replace(/\/$/, '');
      const anchor = hash ? `#${hash}` : '';
      if (byFile.has(repoPath)) return { href: byFile.get(repoPath) + anchor, external: false };
      if (repoPath === 'docs/manual' || repoPath === 'docs/manual/README.md') return { href: 'index.html' + anchor, external: false };
      if (image || repoPath.startsWith('docs/media/')) {
        const target = `media/${path.posix.basename(repoPath)}`;
        media.set(repoPath, target);
        return { href: target, external: false };
      }
      return { href: REPO_BLOB + repoPath + anchor, external: true };
    };

    const marked = new Marked({
      gfm: true,
      renderer: {
        heading({ tokens, depth, text }) {
          const id = slug(plain(text));
          headings.push({ depth, id, text: plain(text) });
          return `<h${depth} id="${esc(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
      },
    });
    const tokens = marked.lexer(md);
    // lexer + parser skip the walkTokens option, so the links are rewritten by an explicit walk
    marked.walkTokens(tokens, (token) => {
      if (token.type === 'link' || token.type === 'image') {
        const r = rewrite(token.href, token.type === 'image');
        token.href = r.href;
        if (!r.external) links.push(r.href);
      }
    });

    // the search index: each heading with the words under it, up to the next heading
    const sections = [];
    let current = null;
    const textOf = (t) => (t.type === 'space' || t.type === 'image' ? '' : plain(t.raw));
    for (const t of tokens) {
      if (t.type === 'heading') {
        current = { h: plain(t.text), x: '' };
        sections.push(current);
      } else if (current) {
        const words = textOf(t);
        if (words) current.x += (current.x ? ' ' : '') + words;
      }
    }

    let html = marked.parser(tokens);
    html = html
      .replace(/<a href="((?:https?:)?\/\/[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"')
      .replace(/<table>/g, '<div class="table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
    // the ids the headings got, in order, joined to the index sections
    if (sections.length !== headings.length) throw new Error(`manual: ${entry.file} has a heading outside the top level`);
    sections.forEach((s, i) => (s.id = headings[i]?.id ?? ''));
    return { ...entry, index, page: pageName(entry.file), html, headings, sections, links };
  });

  return { title: manifest.title, description: manifest.description ?? '', version, revision, chapters, media };
}

// ---------------------------------------------------------------- the page template
function tocList(manual, currentPage) {
  const items = manual.chapters
    .map((c) => {
      const sub = /^8\.\d/.test(c.title) ? ' class="sub"' : '';
      const cur = c.page === currentPage ? ' aria-current="page"' : '';
      return `<li${sub}><a href="${esc(c.page)}"${cur}>${esc(c.title)}</a></li>`;
    })
    .join('\n');
  return `<ol class="toc-list">\n${items}\n</ol>`;
}

function shell(manual, { page, title, description, body }) {
  // the canonical address: always the production one (components/siteAddress.mjs); the index
  // is the folder, as the sitemap lists it
  const canonical = canonicalUrl(page === 'index.html' ? '/manual/' : `/manual/${page}`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="Reza Motaghi">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="manual.css">
<script src="manual.js"></script>
</head>
<body>
<header class="bar">
<a class="brand" href="index.html">${esc(manual.title)}</a>
<span class="chip">v${esc(manual.version)}</span>
<span class="posture">Research use only. Not a medical device.</span>
<a class="viewer" href="../">Open the viewer</a>
<form class="search" role="search" action="#">
<label for="q">Search</label>
<input id="q" type="search" placeholder="Search the manual" autocomplete="off">
</form>
</header>
<div class="layout">
<nav class="toc" aria-label="Table of contents">
<p class="toc-title">Contents</p>
<button class="toc-toggle" type="button" aria-expanded="false" aria-controls="toc-list">Contents</button>
${tocList(manual, page).replace('<ol class="toc-list">', '<ol class="toc-list" id="toc-list">')}
</nav>
<main>
<section id="results" class="results" aria-live="polite" hidden></section>
${body}
<footer class="foot">
<p><a href="../about">${esc(AUTHOR_LINE)}</a>. Research use only. Not a medical device.</p>
<p><a class="viewer-link" href="../">Open the viewer</a> <a href="../legal">Legal notice and privacy</a></p>
</footer>
</main>
</div>
</body>
</html>
`;
}

function chapterPage(manual, c) {
  const prev = manual.chapters[c.index - 1];
  const next = manual.chapters[c.index + 1];
  const pager = `<nav class="pager" aria-label="Previous and next chapter">
${prev ? `<a class="prev" href="${esc(prev.page)}" rel="prev"><span>Previous</span>${esc(prev.title)}</a>` : `<a class="prev" href="index.html" rel="prev"><span>Previous</span>Contents</a>`}
${next ? `<a class="next" href="${esc(next.page)}" rel="next"><span>Next</span>${esc(next.title)}</a>` : '<span></span>'}
</nav>`;
  if (!c.pageTitle || !c.description) throw new Error(`manual: ${c.file} has no pageTitle or description in manifest.json`);
  return shell(manual, {
    page: c.page,
    title: `${c.pageTitle} · CBCTScope manual`,
    description: c.description,
    body: `<article class="doc">\n${c.html}</article>\n${pager}`,
  });
}

function indexPage(manual) {
  const first = manual.chapters[0];
  return shell(manual, {
    page: 'index.html',
    title: manual.title,
    description: manual.description,
    body: `<article class="doc">
<h1 id="top">${esc(manual.title)}</h1>
<p class="meta">Software version <strong>${esc(manual.version)}</strong> · Manual revision <strong>${esc(manual.revision)}</strong></p>
<p>CBCTScope is research software for visualizing and navigating cone-beam CT volumes and 2D dental radiographs on your own computer. It is not a medical device: it produces no findings and no diagnoses, and the reading is yours alone.</p>
<p>Chapters 1 to 7 cover the application as a whole, chapter 8 the eight reading modes with one guide each, and chapters 9 to 12 AI-agent control, data handling, troubleshooting, and the keyboard and mouse reference. Use the search box to find a control, a key, or a term.</p>
<h2 id="contents">Contents</h2>
${tocList(manual, '')}
</article>
<nav class="pager" aria-label="Next chapter"><span></span><a class="next" href="${esc(first.page)}" rel="next"><span>Next</span>${esc(first.title)}</a></nav>`,
  });
}

/** the search index: page titles plus every heading with the words under it */
export function searchIndex(manual) {
  return {
    pages: manual.chapters.map((c) => ({ p: c.page, t: c.title })),
    entries: manual.chapters.flatMap((c, i) => c.sections.map((s) => ({ i, id: s.id, h: s.h, x: s.x }))),
  };
}

// ---------------------------------------------------------------- writing it out
/**
 * Render the manual into `outDir` (replaced): the pages, index.html, the search index, the
 * stylesheet, the script, and the stills.
 * @param {{ root?: string, outDir?: string }} [opts]
 */
export function writeManual({ root = ROOT, outDir = path.join(ROOT, 'public', 'manual') } = {}) {
  const manual = loadManual(root);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'media'), { recursive: true });
  for (const c of manual.chapters) writeFileSync(path.join(outDir, c.page), chapterPage(manual, c));
  writeFileSync(path.join(outDir, 'index.html'), indexPage(manual));
  writeFileSync(path.join(outDir, 'search-index.json'), JSON.stringify(searchIndex(manual)));
  for (const asset of ['manual.css', 'manual.js']) copyFileSync(path.join(here, 'manual', asset), path.join(outDir, asset));
  for (const [from, to] of manual.media) {
    const src = path.join(root, from);
    if (!existsSync(src)) throw new Error(`manual: the still ${from} is referenced but missing`);
    copyFileSync(src, path.join(outDir, to));
  }
  return { manual, outDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const outDir = at >= 0 ? path.resolve(args[at + 1] ?? '') : undefined;
  const { manual, outDir: dir } = writeManual(outDir ? { outDir } : {});
  console.log(`manual: ${manual.chapters.length} pages and the index in ${path.relative(process.cwd(), dir) || dir}/`);
}
