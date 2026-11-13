'use client';
// The update page's body (app/update/page.tsx). The desktop app's Check for Updates item opens
// the website's /update with the installed version after the # sign, which the browser keeps to
// itself; this component reads it from the address, compares it with the version the site was
// built with (components/updateCheck.ts) and says which is newer. The exported HTML is the
// state with no version, so a browser without JavaScript still shows the newest version and the
// downloads. Inside the desktop app the page gives no verdict: the app's own copy of the site
// knows only the app's own version.
import React, { useSyncExternalStore } from 'react';
import { downloadEntries } from './downloads';
import { IS_DESKTOP } from './cbct/shell';
import { updatePageUrl, updateVerdict, versionFromHash } from './updateCheck';

const noSubscribe = () => () => {};
const onHashChange = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

/** the sentence the page learned the version from the address: shown only when it did */
export const UPDATE_HASH_NOTE =
  'This page read your version from the part of its address after the # sign, which browsers do not send to any server.';

/** the desktop app's own copy of the page */
export const UPDATE_IN_APP =
  'This copy of the page is inside the app and cannot tell whether a newer version exists. Choose Check for Updates… in the CBCTScope menu on macOS or the Help menu on Windows: it opens the update page of the website in your browser.';

export const UPDATE_INSTALL_MAC =
  'On a Mac, quit CBCTScope, open the new disk image and drag CBCTScope onto Applications, replacing the old copy.';
export const UPDATE_INSTALL_WINDOWS =
  'On Windows, quit CBCTScope and run the new setup file; with the portable build, replace the old portable file with the new one.';
export const UPDATE_INSTALL_PROFILE =
  "Your marks and settings are kept in the app's profile, not inside the app, and the installed and the portable build share that profile, so the new version keeps them.";

export default function UpdateStatus({ newest }: { newest: string }) {
  const inShell = useSyncExternalStore(noSubscribe, () => IS_DESKTOP, () => false);
  const hash = useSyncExternalStore(onHashChange, () => window.location.hash, () => '');
  const userAgent = useSyncExternalStore(noSubscribe, () => navigator.userAgent, () => '');

  if (inShell) {
    return (
      <div data-testid="update-status" data-state="in-app">
        <p>{UPDATE_IN_APP}</p>
        <p>
          <a href={updatePageUrl(newest)} target="_blank" rel="noopener noreferrer">
            Open the update page on cbctscope.com
          </a>
        </p>
      </div>
    );
  }

  const installed = versionFromHash(hash);
  const v = updateVerdict(installed, newest);
  const offer = v.kind === 'older' || v.kind === 'unknown';
  const entries = downloadEntries(userAgent);
  return (
    <div data-testid="update-status" data-state={v.kind}>
      <p data-testid="update-verdict">
        {v.kind === 'older'
          ? `You have CBCTScope ${v.installed}. The newest version is ${v.newest}.`
          : v.kind === 'same'
            ? `You have the newest version of CBCTScope, ${v.newest}.`
            : v.kind === 'newer'
              ? `You have CBCTScope ${v.installed}. This page knows ${v.newest} as the newest release.`
              : `The newest version of CBCTScope is ${v.newest}.`}
      </p>
      {v.kind !== 'unknown' && <p>{UPDATE_HASH_NOTE}</p>}
      {offer && (
        <>
          <h2>Download</h2>
          <ul>
            {entries.map((e) =>
              e.kind === 'note' ? (
                <li key="note">{e.text}</li>
              ) : (
                <li key={e.href}>
                  <a href={e.href} target="_blank" rel="noopener noreferrer" title={e.title}>
                    {e.label}
                  </a>
                </li>
              ),
            )}
          </ul>
          <h2>Installing over the old version</h2>
          <p>
            {UPDATE_INSTALL_MAC} {UPDATE_INSTALL_WINDOWS} {UPDATE_INSTALL_PROFILE}
          </p>
        </>
      )}
    </div>
  );
}
