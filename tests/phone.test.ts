// The phone page's decision (components/phone.ts, docs/web-build.md section 7): the stylesheet
// that paints the first frame and the script that decides whether the viewer mounts read the
// same media expression, and the phone's picture is the size the page says it is.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHONE_MEDIA } from '../components/phone';
import { PHONE_STILL } from '../components/sitePages';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

describe('the phone page', () => {
  it('app/globals.css switches on PHONE_MEDIA character for character, once', () => {
    const css = read('app/globals.css');
    expect(css.split(`@media ${PHONE_MEDIA} {`)).toHaveLength(2);
  });

  it('decides by the device in both orientations: a coarse pointer that cannot hover, under 768 px in width or height', () => {
    const parts = PHONE_MEDIA.split(',').map((q) => q.trim());
    expect(parts).toEqual([
      '(pointer: coarse) and (hover: none) and (max-width: 767px)',
      '(pointer: coarse) and (hover: none) and (max-height: 767px)',
    ]);
  });

  it('the viewer and the intro read the same constant, and the viewer never switches on a width alone', () => {
    const viewer = read('components/HomeViewer.tsx');
    expect(viewer).toContain('matchMedia(PHONE_MEDIA)');
    expect(viewer).not.toMatch(/min-width|max-width/);
  });

  it('the phone picture is the 1200 px derivative, with its true width and height', () => {
    const buf = readFileSync(path.join(root, 'public', PHONE_STILL.src));
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 12, 16)).toBe('VP8 ');
    // a lossy WebP: the frame's width and height are 14-bit fields after the start code
    expect([buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]).toEqual([PHONE_STILL.width, PHONE_STILL.height]);
    expect(buf.length).toBeLessThan(120_000);
  });
});
