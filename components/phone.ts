// Which home page a device gets (docs/web-build.md, section 7): the phone page, or the viewer.
// The device decides, not the width of a window: a primary pointer that is coarse and cannot
// hover (a finger), on a screen under 768 CSS px in width or in height, so the answer holds in
// both orientations of a phone and a tablet of 768 by 1024 or more gets the viewer. A mouse,
// a trackpad or anything that hovers never gets the phone page, whatever the window's width or
// zoom. app/globals.css carries this same expression for the first paint, and
// tests/phone.test.ts holds the two together. A comma list rather than `or`, which older
// engines do not parse.

export const PHONE_MEDIA =
  '(pointer: coarse) and (hover: none) and (max-width: 767px), (pointer: coarse) and (hover: none) and (max-height: 767px)';
