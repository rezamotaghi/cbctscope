// Which home page a device gets (docs/web-build.md, section 7): the phone page, or the viewer.
// The device decides, not the width of a window: a primary pointer that is coarse and cannot
// hover (a finger), on a screen under 600 CSS px in width or in height, so the answer holds in
// both orientations of a phone (phones end near 440 px on the shorter side) and every tablet
// (from 600 px, the iPad mini's 744 by 1133 included) gets the viewer. A mouse,
// a trackpad or anything that hovers never gets the phone page, whatever the window's width or
// zoom. app/globals.css carries this same expression for the first paint, and
// tests/phone.test.ts holds the two together. A comma list rather than `or`, which older
// engines do not parse.

export const PHONE_MEDIA =
  '(pointer: coarse) and (hover: none) and (max-width: 599px), (pointer: coarse) and (hover: none) and (max-height: 599px)';
