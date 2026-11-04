/** @type {import('next').NextConfig} */
// Cornerstone3D touches WebGL / Web Workers / WASM and cannot run on the server.
// - `fs: false` resolves a node-only dependency reached by the dicom-image-loader in the browser bundle.
// - `.wasm` as asset/resource serves the cornerstone codec WASM in dev + build.
// We intentionally use the default webpack builder (NOT `next dev --turbopack`): Turbopack ignores the
// `webpack` key, so the WASM/fs config below would be silently dropped.
//
// The web target (docs/web-build.md, section 3): `npm run build:web` sets CBCTSCOPE_TARGET=web
// and writes a static export. Route handlers (route.ts) and middleware.ts are left out of that
// target by `pageExtensions` (no `ts`); static export supports neither. `npm run build` and
// `npm run dev` never set the variable, so the local app's config is the base object unchanged.
const base = {
  // The floating Next.js dev badge sits bottom-left where it covers viewer controls
  // (e.g. the CBCT pano "Clear arch" button), and the dev server runs permanently here.
  devIndicators: false,
  webpack: (config) => {
    config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false };
    config.module.rules.push({ test: /\.wasm$/, type: 'asset/resource' });
    return config;
  },
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig =
  process.env.CBCTSCOPE_TARGET === 'web'
    ? {
        ...base,
        output: 'export',
        images: { unoptimized: true },
        basePath,
        assetPrefix: basePath || undefined,
        // tsx keeps page.tsx and layout.tsx; route.ts and middleware.ts fall out. js and jsx stay
        // because Next resolves its own built-in app pages (.js) through this list: with tsx
        // alone the build fails with "Can't resolve private-next-app-dir/page". app/ holds no
        // .js or .jsx files, so nothing of ours rides in on them.
        pageExtensions: ['tsx', 'jsx', 'js'],
        // a second export directory (the end-to-end suite's low-threshold build) without
        // touching out/: Next exports into distDir when one is set alongside output: 'export'
        ...(process.env.CBCTSCOPE_OUT_DIR ? { distDir: process.env.CBCTSCOPE_OUT_DIR } : {}),
      }
    : base;

export default nextConfig;
