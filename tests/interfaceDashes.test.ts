// No em dash in the interface: every string literal, template text and piece of JSX text under
// components/ and app/ is checked through the TypeScript parser, so comments stay exempt and a
// label, title, tooltip, aria-label or option text cannot carry one. Restructure with a colon,
// a comma or a full stop instead.
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

/** every em dash inside a string, a template's text or JSX text, as file:line and the text */
export function dashesIn(file: string, text: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const t = node.getText(sf);
      if (t.includes(EM_DASH)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.push(`${path.relative(root, file)}:${line}: ${t.trim().slice(0, 100)}`);
      }
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

  it('no string literal or JSX text under components/ and app/ contains one', () => {
    const offenders = ['components', 'app'].flatMap((d) => files(path.join(root, d))).flatMap((f) => dashesIn(f, readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
