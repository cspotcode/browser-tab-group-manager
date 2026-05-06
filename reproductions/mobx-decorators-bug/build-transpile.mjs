import esbuild from 'esbuild';
import babelPlugin from 'esbuild-plugin-babel';

const ctx = await esbuild.context({
  entryPoints: ['transpile-decorators-test.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outdir: 'dist/transpile-esbuild-babel',
  sourcemap: 'linked',
  plugins: [
    babelPlugin(),
  ],
});

await ctx.rebuild();
await ctx.dispose();
