// Posture drift test (docs/posture.md, rules 2 and 4). CBCTScope is a viewer first; the agent
// is an optional way to move its camera. The first sentence of every surface that says what
// the software is must name the viewer, never AI; and "first" as a priority claim appears at
// most once, hedged, in body text. These words crept in over several releases, so a test holds
// the line instead of a reread before each one. CITATION.cff feeds the Zenodo record, so its
// title carries no claim and its abstract at most the one hedged sentence.
//
// app/layout.tsx is read as text, not imported: its metadata may name a literal, a constant
// from components/site.ts, or a target ternary, and each form is resolved here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const AI_WORDS: RegExp[] = [
  /\bAI\b/,
  /\b(?:agents?|agentic|models?|LLMs?|MCP)\b/i,
  /\b(?:Anthropic|Claude|OpenAI|ChatGPT|GPT(?:-\w+)?|Gemini|Google|Llama|Ollama|Mistral|Qwen|DeepSeek|Copilot|Microsoft)\b/i,
];

/** "first" claiming priority: "the first ... viewer", "first-ever", "world's first", "first of its kind" */
const PRIORITY = [/(?<![\w-])first\s+(?:(?!(?:the|a|an)\s)[\w-]+\s+){0,4}(?:viewer|instrument|tool|software)\b(?!['’])/i, /\b(?:first-ever|world'?s first|first of its kind)\b/i];

/** markdown inline syntax reduced to words, line breaks joined */
const plain = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const sentences = (text: string) => plain(text).split(/(?<=[.!?])\s+/).filter(Boolean);
const firstSentence = (text: string) => sentences(text)[0] ?? '';
const aiWordsIn = (s: string) => AI_WORDS.map((re) => re.exec(s)?.[0]).filter((w): w is string => Boolean(w));
const isPriorityClaim = (s: string) => PRIORITY.some((re) => re.test(s));
/** every priority claim in a text, counted where it stands, so two in one sentence count twice */
const priorityClaims = (text: string) => PRIORITY.flatMap((re) => [...plain(text).matchAll(new RegExp(re.source, 'gi'))].map((m) => m[0]));

/** a CITATION.cff field: a quoted one-line value, or a folded block (`>-`) of indented lines */
function cffField(cff: string, key: string): string {
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(cff);
  if (!line) return '';
  const head = line[1].trim();
  if (!/^[>|]/.test(head)) return head.replace(/^"(.*)"$/, '$1');
  const rest = cff.slice(line.index + line[0].length + 1).split('\n');
  const block: string[] = [];
  for (const l of rest) {
    if (l.trim() !== '' && !/^\s/.test(l)) break;
    block.push(l.trim());
  }
  return block.join(' ').replace(/\s+/g, ' ').trim();
}

/** the first paragraph after a markdown file's H1 */
function leadParagraph(md: string): string {
  const body = md.replace(/^#\s[^\n]*\n+/, '');
  return body.split(/\n\s*\n/)[0] ?? '';
}

// ---------------------------------------------------------------- app/layout.tsx, as text
const layout = read('app/layout.tsx');
const site = read('components/site.ts');

/** read a JS string literal starting at src[i] (a quote); returns its value and end index */
function readLiteral(src: string, i: number): { value: string; end: number } {
  const q = src[i];
  let value = '';
  let j = i + 1;
  for (; j < src.length && src[j] !== q; j++) {
    if (src[j] === '\\') j++;
    value += src[j];
  }
  return { value, end: j + 1 };
}

/** the string a constant declared in layout.tsx or components/site.ts holds */
function resolveConst(name: string): string | undefined {
  for (const src of [layout, site]) {
    const m = new RegExp(`const\\s+${name}\\b[^=]*=\\s*`).exec(src);
    if (m && /['"`]/.test(src[m.index + m[0].length])) return readLiteral(src, m.index + m[0].length).value;
  }
  return undefined;
}

type Value = { strings: string[]; end: number };

/**
 * The strings a metadata value can take, starting at src[i]: a literal, a constant, an object
 * with `default:`, or a target ternary (only the web branch counts: the web build and the
 * desktop app ship it; the repository dev server's page is not a published surface).
 */
function readValue(src: string, i: number): Value {
  while (/\s/.test(src[i])) i++;
  if (/['"`]/.test(src[i])) {
    const { value, end } = readLiteral(src, i);
    return { strings: [value], end };
  }
  if (src[i] === '{') {
    const at = src.indexOf('default:', i);
    expect(at, 'a metadata object value without default: update this test').toBeGreaterThan(i);
    return readValue(src, at + 'default:'.length);
  }
  const id = /^[\w.]+/.exec(src.slice(i))?.[0] ?? '';
  expect(id, `unreadable metadata value at: ${src.slice(i, i + 40)}`).not.toBe('');
  let j = i + id.length;
  const rest = src.slice(j);
  const cond = /^\s*(===|!==)\s*(['"])(\w+)\2\s*\?/.exec(rest);
  if (cond) {
    const a = readValue(src, j + cond[0].length);
    let k = a.end;
    while (/\s/.test(src[k])) k++;
    expect(src[k], 'a metadata ternary this test cannot read').toBe(':');
    const b = readValue(src, k + 1);
    const webFirst = (cond[1] === '===') === (cond[3] === 'web');
    return { strings: webFirst ? a.strings : b.strings, end: b.end };
  }
  const resolved = resolveConst(id.split('.').pop() ?? id);
  expect(resolved, `metadata names ${id}, which this test cannot resolve to a string`).toBeDefined();
  return { strings: [resolved!], end: j };
}

function metadataStrings(key: 'title' | 'description'): string[] {
  const start = layout.indexOf('export const metadata');
  expect(start, 'app/layout.tsx no longer exports metadata: update this test').toBeGreaterThanOrEqual(0);
  const end = layout.indexOf('\n};', start);
  expect(end, 'the metadata block in app/layout.tsx has no closing line: update this test').toBeGreaterThan(start);
  const out: string[] = [];
  const re = new RegExp(`\\b${key}\\s*:`, 'g');
  re.lastIndex = start;
  for (let m = re.exec(layout); m && m.index < end; m = re.exec(layout)) out.push(...readValue(layout, m.index + m[0].length).strings);
  return out;
}

// ---------------------------------------------------------------- the surfaces
function surfaces(): [string, string][] {
  const cff = cffField(read('CITATION.cff'), 'title');
  const pkg = (JSON.parse(read('package.json')) as { description?: string }).description ?? '';
  const bundle = (JSON.parse(read('mcp/manifest.json')) as { description?: string }).description ?? '';
  return [
    ...metadataStrings('title').map((t, i): [string, string] => [`app/layout.tsx title #${i + 1}`, t]),
    ...metadataStrings('description').map((d, i): [string, string] => [`app/layout.tsx description #${i + 1}`, d]),
    ['README.md bold line', leadParagraph(read('README.md'))],
    ['docs/manual/00-front.md first line', leadParagraph(read('docs/manual/00-front.md'))],
    ['CITATION.cff title', cff],
    ['package.json description', pkg],
    ['mcp/manifest.json description', bundle],
  ];
}

describe('posture: the viewer comes first (docs/posture.md)', () => {
  it('the checks recognise the wording they guard against', () => {
    const old = 'A complete, local-first CBCT viewer. The first CBCT reading viewer with native AI-agent control.';
    expect(aiWordsIn('Local-first CBCT viewer with native AI-agent control (MCP).')).not.toEqual([]);
    expect(aiWordsIn('Navigation-only control for Claude Desktop.')).not.toEqual([]);
    expect(aiWordsIn('A complete, local-first CBCT and 2D radiograph viewer, built by a radiologist.')).toEqual([]);
    expect(sentences(old).filter(isPriorityClaim)).toHaveLength(1);
    expect(isPriorityClaim('The first benchmark of agents operating a radiology viewer found ...')).toBe(false);
    expect(isPriorityClaim('On first launch both modes show the phantom.')).toBe(false);
    expect(isPriorityClaim('A complete, local-first CBCT and 2D radiograph viewer.')).toBe(false);
    expect(isPriorityClaim("The first start downloads the viewer's components once.")).toBe(false);
    expect(isPriorityClaim('To our knowledge, CBCTScope is the first purpose-built CBCT reading viewer.')).toBe(true);
    expect(priorityClaims('The first CBCT viewer. Also the first agent-driven reading viewer.')).toHaveLength(2);
    const cff = 'title: "A viewer"\nabstract: >-\n  One line\n  and the next.\nversion: 1.0.0\n';
    expect(cffField(cff, 'title')).toBe('A viewer');
    expect(cffField(cff, 'abstract')).toBe('One line and the next.');
  });

  it('every surface was found and read', () => {
    for (const [name, text] of surfaces()) expect(text.trim(), `${name} is empty or was not found`).not.toBe('');
    expect(metadataStrings('title').length).toBeGreaterThanOrEqual(1);
    expect(metadataStrings('description').length).toBeGreaterThanOrEqual(1);
  });

  it('no first sentence names AI, an agent, a model, MCP or a vendor', () => {
    const bad = surfaces()
      .map(([name, text]) => [name, firstSentence(text), aiWordsIn(firstSentence(text))] as const)
      .filter(([, , words]) => words.length > 0)
      .map(([name, s, words]) => `${name}: "${s}" (${words.join(', ')})`);
    expect(bad, 'a first sentence says what the software is, with no AI word').toEqual([]);
  });

  it('"first" as a priority claim appears at most once, hedged, in README body text', () => {
    const claims: string[] = [];
    for (const file of ['README.md', 'docs/manual/00-front.md']) {
      const md = read(file);
      // the bold line and every other bold run are not body text
      for (const bold of md.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
        expect(sentences(bold[1]).filter(isPriorityClaim), `${file}: a priority claim in bold`).toEqual([]);
      }
      for (const para of md.split(/\n\s*\n/)) {
        for (const s of sentences(para).filter(isPriorityClaim)) {
          claims.push(`${file}: ${s}`);
          expect(s, `${file}: a priority claim must be hedged`).toMatch(/to our knowledge/i);
          expect(para, `${file}: the priority claim must link to the comparison`).toContain('(#why-this-exists)');
        }
      }
    }
    expect(claims.length, `more than one priority claim:\n${claims.join('\n')}`).toBeLessThanOrEqual(1);
  });

  it('CITATION.cff: the title carries no claim; the abstract at most one, hedged', () => {
    const cff = read('CITATION.cff');
    const title = cffField(cff, 'title');
    const abstract = cffField(cff, 'abstract');
    expect(title, 'CITATION.cff title not found').not.toBe('');
    expect(abstract, 'CITATION.cff abstract not found').not.toBe('');
    expect(priorityClaims(title), 'a priority claim in the CITATION.cff title').toEqual([]);
    expect(title, 'the CITATION.cff title says "first"').not.toMatch(/(?<![\w-])first(?![\w-])/i);
    const claims = priorityClaims(abstract);
    expect(claims.length, `more than one priority claim in the abstract: ${claims.join(' | ')}`).toBeLessThanOrEqual(1);
    for (const s of sentences(abstract).filter(isPriorityClaim)) {
      expect(s, 'the abstract\'s priority claim must be hedged').toMatch(/to our knowledge/i);
    }
  });
});
