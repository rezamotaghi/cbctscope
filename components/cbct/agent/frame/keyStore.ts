// The clinician's provider key, in this module's memory and nowhere else: never in
// localStorage, sessionStorage, IndexedDB or a cookie (tests/agentPolicy.test.ts scans
// components/cbct/agent/** for those APIs). Closing or reloading the tab forgets it;
// Switch off forgets it at once.

let key = '';

export const getKey = (): string => key;

export function setKey(value: string): void {
  key = value.trim();
}

export function forgetKey(): void {
  key = '';
}
