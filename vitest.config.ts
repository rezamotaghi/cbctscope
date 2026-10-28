import { configDefaults, defineConfig } from 'vitest/config';

// Agent worktrees under .claude/ carry their own copies of the test files; vitest's default
// include would collect them too and run them against this tree's sources.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
});
