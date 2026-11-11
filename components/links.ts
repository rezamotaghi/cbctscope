// The viewer's links to the project (docs/web-build.md, section 7): links the reader clicks,
// never requests the page makes. tests/noAbsoluteUrls.test.ts lists these constants.

/** the source code: the Help menu and the About popover */
export const REPO_URL = 'https://github.com/rezamotaghi/cbctscope';

/** the desktop app's installers: the header's download button, plain browser only */
export const RELEASES_URL = 'https://github.com/rezamotaghi/cbctscope/releases/latest';

/** the consented, bone-only stills of a real scan: the first-run status line's link */
export const STILLS_URL = `${REPO_URL}#the-interface-at-a-glance`;
