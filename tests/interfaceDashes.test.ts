// No em dash in anything a reader or an agent host sees: every string literal, template text
// and piece of JSX text under components/, app/, lib/ and desktop/ is checked through the
// TypeScript parser, so comments stay exempt and a label, title, tooltip, aria-label, option
// text, error message or refusal cannot carry one. The check reads each value as it runs, not
// as it is spelled: a string's escapes are cooked (a unicode escape counts) and JSX text and
// attribute values have their HTML entities decoded (&mdash; and &#8212; count). Restructure
// with a colon, a comma or a full stop instead.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const EM_DASH = '\u2014';

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx?|mjs|js)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const NAMED: Record<string, string> = {
  mdash: EM_DASH,
  ndash: '\u2013',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/** HTML character references as JSX reads them: named, decimal and hexadecimal */
export function decodeEntities(t: string): string {
  return t.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (m, dec?: string, hex?: string, name?: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED[name ?? ''] ?? m;
  });
}

/** the value a string, a template part or a JSX text node holds at run time, else null */
function cooked(node: ts.Node): string | null {
  if (ts.isJsxText(node)) return decodeEntities(node.text);
  // a JSX attribute's string is not escape-processed; its entities are decoded instead
  if (ts.isStringLiteral(node)) return ts.isJsxAttribute(node.parent) ? decodeEntities(node.text) : node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  return null;
}

/** every em dash inside a string, a template's text or JSX text, as file:line and the text */
export function dashesIn(file: string, text: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const value = cooked(node);
    if (value !== null && value.includes(EM_DASH)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      found.push(`${path.relative(root, file)}:${line}: ${node.getText(sf).trim().slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('interface strings carry no em dash', () => {
  it('the check sees strings and JSX text, and skips comments', () => {
    const sample = `// a comment \u2014 exempt\nconst a = 'one \u2014 two';\nconst b = <p>three \u2014 four</p>;\nconst c = \`x \u2014 \${a}\`;\n`;
    expect(dashesIn('sample.tsx', sample)).toHaveLength(3);
  });

  it('the check reads values, not spellings: escapes and entities count', () => {
    const bs = '\\'; // one backslash in the checked source text
    const cases: [string, string][] = [
      ['a unicode escape in a string', `const a = 'one ${bs}u2014 two';`],
      ['a braced unicode escape in a string', `const a = "one ${bs}u{2014} two";`],
      ['a unicode escape in a template', `const a = \`one ${bs}u2014 \${x} two\`;`],
      ['a unicode escape in a template tail', `const a = \`\${x} one ${bs}u2014 two\`;`],
      ['a unicode escape in a plain template', `const a = \`one ${bs}u2014 two\`;`],
      ['a named entity in JSX text', 'const b = <p>three &mdash; four</p>;'],
      ['a decimal entity in JSX text', 'const b = <p>three &#8212; four</p>;'],
      ['a hexadecimal entity in JSX text', 'const b = <p>three &#x2014; four</p>;'],
      ['a named entity in an attribute', 'const b = <button title="three &mdash; four">x</button>;'],
      ['a decimal entity in an attribute', "const b = <button aria-label='three &#8212; four'>x</button>;"],
    ];
    for (const [what, src] of cases) expect(dashesIn('sample.tsx', src), what).toHaveLength(1);
    // the same spellings where nothing decodes them at run time, and comments, stay clear
    expect(dashesIn('sample.tsx', "const a = 'three &mdash; four';"), 'an entity in a plain string is literal text').toEqual([]);
    expect(dashesIn('sample.tsx', `// ${bs}u2014 and &mdash; in a comment\nconst a = 1;`), 'comments stay exempt').toEqual([]);
    expect(dashesIn('sample.tsx', 'const b = <p>an en dash &ndash; is fine</p>;')).toEqual([]);
  });

  it('no string literal or JSX text under components/, app/, lib/ and desktop/ contains one', () => {
    const offenders = ['components', 'app', 'lib', 'desktop']
      .flatMap((d) => files(path.join(root, d)))
      .flatMap((f) => dashesIn(f, readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
