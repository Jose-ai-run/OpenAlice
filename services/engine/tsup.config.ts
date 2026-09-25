import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { engine: 'src/main.ts' },
  format: ['cjs'],
  outDir: 'dist',
  target: 'es2023',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Bundle dependencies the same way services/connector does, so Docker
  // and Electron packaging do not depend on pnpm workspace symlinks
  // surviving prune/package collection (see services/connector/tsup.config.ts).
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions: (options) => {
    options.conditions = ['openalice-source', ...(options.conditions ?? [])]
  },
})
