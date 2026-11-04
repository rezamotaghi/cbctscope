import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Agent worktrees under .claude/ carry their own copies of the test files; vitest's default
// include would collect them too and run them against this tree's sources. tests/e2e/ is the
// Playwright suite (npm run test:e2e), never vitest's.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { exclude: [...configDefaults.exclude, '**/.claude/**', 'tests/e2e/**'] },
});
