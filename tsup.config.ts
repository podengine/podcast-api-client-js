import { defineConfig, type Options } from 'tsup';

export default defineConfig((options: Options) => ({
  entry: ['src/index.ts'],
  outDir: 'dist',
  clean: true,
  dts: true,
  bundle: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // Dual-publish ESM (.js) + CJS (.cjs) so the package works everywhere.
  format: ['esm', 'cjs'],
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  ...options,
}));
