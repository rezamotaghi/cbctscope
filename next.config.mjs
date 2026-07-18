/** @type {import('next').NextConfig} */
// Cornerstone3D touches WebGL / Web Workers / WASM and cannot run on the server.
// - `fs: false` resolves a node-only dependency reached by the dicom-image-loader in the browser bundle.
// - `.wasm` as asset/resource serves the cornerstone codec WASM in dev + build.
// We intentionally use the default webpack builder (NOT `next dev --turbopack`): Turbopack ignores the
// `webpack` key, so the WASM/fs config below would be silently dropped.
const nextConfig = {
  // The floating ⓃNext.js dev badge sits bottom-left where it covers viewer controls
  // (e.g. the CBCT pano "Clear arch" button) — and the dev server runs permanently here.
  devIndicators: false,
  webpack: (config) => {
    config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false };
    config.module.rules.push({ test: /\.wasm$/, type: 'asset/resource' });
    return config;
  },
};

export default nextConfig;
