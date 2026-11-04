// The one volume source the viewer talks to, chosen once at module level by the build target
// (docs/web-build.md, sections 3 and 4). NEXT_PUBLIC_ variables are inlined at build time, so
// each target's bundle carries the branch it uses.
import type { OpenResult, VolumeSource } from '@/lib/browser/volumeSource';
import { browserSource } from '@/lib/browser/browserSource';
import { serverSource } from './serverSource';

/** the web build (cbctscope.com and the packaged app): static files, no server */
export const IS_WEB = process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web';

export const source: VolumeSource = IS_WEB ? browserSource : serverSource;

/** an open the reader dismissed (the native chooser's cancel): not an error, show nothing */
export const isCanceled = (r: OpenResult): boolean => !r.ok && r.error === '';
