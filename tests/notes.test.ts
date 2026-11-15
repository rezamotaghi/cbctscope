// A note does not look like an entry (docs/web-build.md, section 6): explanatory text among a
// menu's, card's, strip's or dialogue's choosable entries takes the one `note` class of
// app/globals.css, never an inline colour. The flattening this guards against was an inline
// `color: var(--text)` that drew a hint exactly like the links around it. The sources are parsed
// as TSX, so a reformatted style object is still found.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const TEXT_TAGS = new Set(['div', 'p', 'span', 'li']);
const TEXT_COLOURS = new Set(['var(--text)', 'var(--text-dim)']);

/** whole files: every text element in them sits in a popover, strip, dialogue or list of entries */
const WHOLE = [
  'components/cbct/agent/AgentPanel.tsx',
  'components/cbct/WebDialogs.tsx',
  'components/cbct/CiteDialog.tsx',
  'components/CitationBlock.tsx',
  'components/UpdateStatus.tsx',
];
/** files with a header or page around their menus: only what is inside a menu panel counts */
const PANELS_ONLY = ['components/cbct/CbctApp.tsx', 'components/cbct/ExportMenu.tsx', 'components/AboutBadge.tsx'];

const attr = (el: ts.JsxOpeningLikeElement, name: string) =>
  el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);

const isMenuPanel = (el: ts.JsxOpeningLikeElement) => {
  const init = attr(el, 'className')?.initializer;
  return !!init && ts.isStringLiteral(init) && init.text.split(/\s+/).includes('menu-panel');
};

/** the text colour an element's inline style literal sets, if any */
function inlineTextColour(el: ts.JsxOpeningLikeElement): string | null {
  const init = attr(el, 'style')?.initializer;
  if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isObjectLiteralExpression(init.expression)) return null;
  for (const p of init.expression.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'color' && ts.isStringLiteral(p.initializer) && TEXT_COLOURS.has(p.initializer.text)) {
      return p.initializer.text;
    }
  }
  return null;
}

/** text elements given an inline text colour in a TSX source, as "file:line <tag> colour" */
function offendersIn(file: string, src: string, panelsOnly: boolean): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node, inPanel: boolean) => {
    let here = inPanel;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      if (isMenuPanel(open)) here = true;
      const tag = open.tagName.getText();
      const colour = inlineTextColour(open);
      if ((here || !panelsOnly) && TEXT_TAGS.has(tag) && colour) {
        out.push(`${file}:${sf.getLineAndCharacterOfPosition(open.getStart()).line + 1} <${tag}> ${colour}`);
      }
    }
    ts.forEachChild(node, (c) => visit(c, here));
  };
  visit(sf, false);
  return out;
}

const offenders = (file: string, panelsOnly: boolean) => offendersIn(file, readFileSync(path.join(root, file), 'utf8'), panelsOnly);

describe('notes in menus, cards, strips and dialogues', () => {
  it('no text among entries is coloured inline: a note takes the note class', () => {
    const found = [...WHOLE.map((f) => offenders(f, false)), ...PANELS_ONLY.map((f) => offenders(f, true))].flat();
    expect(found).toEqual([]);
  });

  it('the note class is defined once, with the meta size, the secondary colour and regular weight', () => {
    const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
    const rules = [...css.matchAll(/(^|\n)\.note\s*\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    const body = rules[0][2];
    expect(body).toMatch(/font-size:\s*var\(--fs-meta\)/);
    expect(body).toMatch(/color:\s*var\(--text-dim\)/);
    expect(body).toMatch(/font-weight:\s*var\(--fw-regular\)/);
  });

  it('the download and Open menus draw their hints with the note class', () => {
    const app = readFileSync(path.join(root, 'components/cbct/CbctApp.tsx'), 'utf8');
    expect(app).toMatch(/className="note" data-testid="download-note"/);
    expect(app).toMatch(/className="note" data-testid="open-note"/);
  });

  it('finds the flattening it guards against, inside a menu panel and only there', () => {
    const sample = [
      `export const X = () => (`,
      `  <div>`,
      `    <span style={{ color: 'var(--text-dim)' }}>a subtitle beside the header, outside any menu</span>`,
      `    <div className="menu-panel" role="menu">`,
      `      <a className="menu-item">A</a>`,
      `      <div style={{ padding: 4, color: 'var(--text)' }}>hint</div>`,
      `    </div>`,
      `  </div>`,
      `);`,
    ].join('\n');
    expect(offendersIn('x.tsx', sample, true)).toEqual(["x.tsx:6 <div> var(--text)"]);
    expect(offendersIn('x.tsx', sample, false)).toEqual(["x.tsx:3 <span> var(--text-dim)", "x.tsx:6 <div> var(--text)"]);
  });
});
