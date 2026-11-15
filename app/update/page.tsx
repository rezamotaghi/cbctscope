// /update: the page the desktop app's Check for Updates item opens in the browser, with the
// installed version after the # sign (desktop/native.mjs updateUrl). The newest version is
// read from package.json at build time; the release job deploys the site with every release,
// and a site update between releases deploys only while the latest release is that version
// (scripts/release-assets.mjs --site-update), so the site always knows it. The app contacts nothing: the browser loads this page, and the
// part after the # never reaches a server. Not indexed and not in the sitemap
// (scripts/sitemap.mjs NOINDEX_PAGES).
import SitePage from '@/components/SitePage';
import UpdateStatus from '@/components/UpdateStatus';
import { pageMetadata } from '@/components/siteMeta';
import { UPDATE_DESCRIPTION, UPDATE_TITLE } from '@/components/sitePages';
import pkg from '@/package.json';

export const metadata = {
  ...pageMetadata({ title: UPDATE_TITLE, description: UPDATE_DESCRIPTION, path: '/update' }),
  robots: { index: false, follow: true },
};

export default function Update() {
  return (
    <SitePage>
      <h1>Check for updates</h1>
      <UpdateStatus newest={pkg.version} />
    </SitePage>
  );
}
