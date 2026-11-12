// The metadata of the site's text pages (/about, /legal): their own title, description and
// canonical address, and the share card with the same picture as the home page.
import type { Metadata } from 'next';
import { OG_IMAGE, SITE_NAME, canonicalUrl } from './site';

export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const url = canonicalUrl(path);
  const images = [{ url: OG_IMAGE.path, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: SITE_NAME }];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, siteName: SITE_NAME, images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}
