/**
 * Pre-bundle the Vercel serverless function into a single self-contained file.
 *
 * Problem this solves:
 *   @vercel/node compiles api/sync.ts but does NOT transpile/resolve the
 *   relative TypeScript imports under ../src/lib/ats/* at runtime, producing
 *   `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/lib/ats/sync'`.
 *
 * Fix:
 *   esbuild bundles api/_src/sync.ts and every src/lib dependency into one
 *   ESM file at api/sync.js. The handler source lives under api/_src (the
 *   underscore prefix makes Vercel ignore it as a function), so only the fully
 *   bundled api/sync.js is deployed as the function — no unresolved imports.
 *
 * node_modules deps (e.g. @supabase/supabase-js) are also bundled so the
 * function is hermetic.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  await build({
    entryPoints: [path.join(root, 'api/_src/sync.ts'), path.join(root, 'api/_src/reverify-jobs.ts')],
    outdir: path.join(root, 'api'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    // Keep the ESM default export intact for @vercel/node's handler detection.
    banner: {
      js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
    },
    logLevel: 'info',
    minify: false,
    sourcemap: false,
  });
  // eslint-disable-next-line no-console
  console.log('Bundled api/sync.js and api/reverify-jobs.js');
  const env = loadEnv('production', root, 'VITE_');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (anonKey && !anonKey.startsWith('sb_publishable_')) {
    try {
      if (JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString()).role !== 'anon') throw new Error();
    } catch { throw new Error('SEO rendering requires the public Supabase anon/publishable key, never a service key.'); }
  }
  await build({
    entryPoints: [path.join(root, 'api/_src/seo.ts')], outfile: path.join(root, 'api/seo.js'),
    bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: false, sourcemap: false,
    banner: { js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);" },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __SEO_SHELL__: JSON.stringify(await readFile(path.join(root, 'dist/index.html'), 'utf8')),
      __SEO_PUBLIC_CONFIG__: JSON.stringify({ url: process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL, anonKey }),
    }, logLevel: 'info',
  });
  console.log('Bundled api/seo.js with the current public-page HTML template');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
