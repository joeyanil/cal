import { defineConfig } from 'vitest/config'
import path from 'path'
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
  test: { include: ['tests-integration/**/*.test.{ts,tsx}'], root: path.resolve(__dirname, '..'), testTimeout: 120000, hookTimeout: 120000 },
})
