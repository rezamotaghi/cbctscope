// The viewer's single-letter keys leave every Cmd, Ctrl and Alt chord to the browser and the
// desktop app's menu, in every handler that listens on the window. The handlers are run, not
// read: each window keydown handler is lifted out of its component, every name it would reach
// outside itself is a recorder, and a chord must come back having touched nothing but the
// event's target and modifier keys, while the same key without a modifier is seen to act.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { isChord, modalOpen } from '@/components/cbct/keys';

const none = { metaKey: false, ctrlKey: false, altKey: false };

type Handler = (e: KeyboardEvent) => void;

/** what a run of a handler touched: names from its component's scope, and event members */
interface Trace {
  names: string[];
  event: string[];
}

/** a stand-in for anything outside the handler: callable, readable, always itself */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything),
  apply: () => anything,
});

/**
 * Every `window.addEventListener('keydown', name)` in a file, with the handler `name` declares,
 * compiled so each free name resolves through a recording scope at run time.
 */
function windowKeyHandlers(file: string, modal = false): { name: string; run: (e: Partial<KeyboardEvent>) => Trace }[] {
  const src = readFileSync(path.join(process.cwd(), file), 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const decls = new Map<string, ts.Expression>();
  const listened: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      decls.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === 'window.addEventListener' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'keydown' &&
      ts.isIdentifier(node.arguments[1])
    ) {
      listened.push(node.arguments[1].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return listened.map((name) => {
    const fn = decls.get(name);
    if (!fn) throw new Error(`${file}: the keydown handler ${name} is not an arrow function this test can lift`);
    const js = ts
      .transpileModule(`(${fn.getText(sf)})`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } })
      .outputText.trim()
      .replace(/;$/, '');
    return {
      name,
      run: (init) => {
        const trace: Trace = { names: [], event: [] };
        const scope = new Proxy(
          {},
          {
            has: () => true,
            get: (_t, k) => {
              if (k === Symbol.unscopables) return undefined;
              if (k === 'isChord') return isChord;
              if (k === 'modalOpen') return () => modal;
              trace.names.push(String(k));
              return anything;
            },
          },
        );
        const event = new Proxy(init, {
          get: (t, k) => {
            trace.event.push(String(k));
            if (k === 'preventDefault' || k === 'stopPropagation') return () => {};
            return (t as Record<string | symbol, unknown>)[k];
          },
        });
        // sloppy-mode `with` resolves the handler's free names through the recording scope
        const handler = new Function('scope', `with (scope) { return ${js}; }`)(scope) as Handler;
        handler(event as KeyboardEvent);
        return trace;
      },
    };
  });
}

const target = { tagName: 'DIV', isContentEditable: false };
const MODIFIERS = new Set(['target', 'metaKey', 'ctrlKey', 'altKey']);

describe('chords are not viewer keys', () => {
  it('isChord is true for Cmd, Ctrl and Alt, false for a bare key', () => {
    expect(isChord(none)).toBe(false);
    expect(isChord({ ...none, metaKey: true })).toBe(true);
    expect(isChord({ ...none, ctrlKey: true })).toBe(true);
    expect(isChord({ ...none, altKey: true })).toBe(true);
  });

  const cases: [string, string[]][] = [
    ['components/cbct/CbctApp.tsx', ['n', 'p', 'r', 'c', 'o', 'w', '1', '0']],
    ['components/cbct/CbctViewport.tsx', ['Delete', 'Backspace', 'v', 'V']],
  ];
  for (const [file, keys] of cases) {
    it(`${file}: every window key handler returns on a chord before it acts`, () => {
      const handlers = windowKeyHandlers(file);
      expect(handlers.length, `${file} listens for keydown on the window`).toBeGreaterThanOrEqual(1);
      for (const h of handlers) {
        // the harness sees acting: some bare key reaches past the handler or claims the event
        const acted = keys.some((key) => {
          const t = h.run({ ...none, key, target: target as unknown as EventTarget });
          return t.names.length > 0 || t.event.includes('preventDefault');
        });
        expect(acted, `${h.name}: no bare key acted, so this test cannot see the handler work`).toBe(true);
        for (const key of keys) {
          for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
            const t = h.run({ ...none, [mod]: true, key, target: target as unknown as EventTarget });
            expect(t.names, `${h.name}: ${mod} + ${key} reached ${t.names.join(', ')}`).toEqual([]);
            expect(t.event.filter((k) => !MODIFIERS.has(k)), `${h.name}: ${mod} + ${key} read the event`).toEqual([]);
          }
        }
      }
    });
  }
});

describe('a modal dialogue holds the keyboard', () => {
  it('modalOpen sees an aria-modal dialogue, and nothing else', () => {
    const doc = (hit: boolean) => ({ querySelector: (q: string) => (hit && q === '[aria-modal="true"]' ? ({} as Element) : null) });
    expect(modalOpen(doc(true))).toBe(true);
    expect(modalOpen(doc(false))).toBe(false);
    expect(modalOpen(null)).toBe(false);
  });
  const cases: [string, string[]][] = [
    ['components/cbct/CbctApp.tsx', ['n', 'p', 'N', 'P', 'r', 'c', 'o', 'w', '1', '0']],
    ['components/cbct/CbctViewport.tsx', ['Delete', 'Backspace', 'v', 'V']],
  ];
  for (const [file, keys] of cases) {
    it(`${file}: with a modal dialogue open, no bare key acts (N and P switch no volume)`, () => {
      for (const h of windowKeyHandlers(file, true)) {
        for (const key of keys) {
          const t = h.run({ ...none, key, target: target as unknown as EventTarget });
          expect(t.names, `${h.name}: ${key} reached ${t.names.join(', ')} behind a dialogue`).toEqual([]);
          expect(t.event, `${h.name}: ${key} claimed the event behind a dialogue`).not.toContain('preventDefault');
        }
      }
    });
  }
});
