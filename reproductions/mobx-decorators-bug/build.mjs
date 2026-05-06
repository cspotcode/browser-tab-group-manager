import esbuild from 'esbuild';
import babelPlugin from 'esbuild-plugin-babel';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['main.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/main.js',
  sourcemap: 'linked',
  plugins: [
    babelPlugin(),
  ],
});

if (watch) {
  await ctx.watch();
  console.log('Watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
