import { defineConfig } from 'vitest/config'
import path from 'path'
export default defineConfig({
  resolve: { alias: { '@': path.resolve('/home/claude/repo/src') } },
  test: { include: ['tests-integration/**/*.test.ts'], root: '/home/claude/repo', testTimeout: 120000, hookTimeout: 120000 },
})
