// Types for verbs.mjs (plain ESM, shared by the Node MCP server and the browser bundle).
import type { z } from 'zod';

export type VerbRoute =
  | { kind: 'bridge'; verb: string; args?: Record<string, unknown> }
  | { kind: 'catalog' }
  | { kind: 'open' };

export interface Annotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface Verb {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodObject;
  annotations: Annotations;
  route: VerbRoute;
}

export const VIEW_MODES: string[];
export const WL_PRESETS: string[];
export const STYLES_3D: string[];
export const PANES: string[];
export const READ: Annotations;
export const NAV: Annotations;
export const ADD: Annotations;
export const VERBS: Verb[];
export function verb(name: string): Verb;
export function toolConfig(name: string): Omit<Verb, 'name' | 'route'>;
export function inputJsonSchema(name: string): Record<string, unknown> & { type: 'object' };
export const FENCE: string;
export function describe(state: unknown): string;
