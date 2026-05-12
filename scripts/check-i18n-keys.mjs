// i18n coverage gate.
//
// Loads the three locale modules and computes the set of leaf paths
// (`a.b.c` style) for each. `en` is the source of truth; `zh-CN` and
// `vi` MUST cover every leaf or this script exits non-zero.
//
// Plain ESM `.mjs` to avoid pulling in `tsx` / `ts-node` for one
// gate script. Vite + tsc still typecheck the source files
// themselves; this script only inspects the structure at runtime.
//
// Implementation note: the locale files are TypeScript, so we can't
// `import` them directly in a node script without a transform. We
// use `vite` programmatically (already installed) to evaluate the
// modules — that way we get the same module-resolution semantics as
// the app itself, including TS path aliases and `import type` strip.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** Recursively flatten an object into `a.b.c` leaf paths. Stops
 *  recursing at strings (or anything non-plain-object). */
function flattenLeaves(obj, prefix = '', out = new Set()) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix !== '') out.add(prefix);
    return out;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0 && prefix !== '') {
    out.add(prefix);
    return out;
  }
  for (const k of keys) {
    flattenLeaves(obj[k], prefix === '' ? k : `${prefix}.${k}`, out);
  }
  return out;
}

async function main() {
  // ssrLoadModule lets us evaluate the .ts files without a build
  // step. `appType: 'custom'` keeps Vite from spinning up a full
  // dev server / middleware chain; we just need the module loader.
  const server = await createServer({
    root: ROOT,
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
    // Plain JSDOM-free environment — the locale files don't touch
    // browser APIs, so no shim required.
  });
  let exitCode = 0;
  try {
    const en = await server.ssrLoadModule('/src/i18n/locales/en.ts');
    const zh = await server.ssrLoadModule('/src/i18n/locales/zh-CN.ts');
    const vi = await server.ssrLoadModule('/src/i18n/locales/vi.ts');

    const enKeys = flattenLeaves(en.en);
    const zhKeys = flattenLeaves(zh.zhCN);
    const viKeys = flattenLeaves(vi.vi);

    const reportMissing = (label, keys) => {
      const missing = [...enKeys].filter((k) => !keys.has(k)).sort();
      if (missing.length > 0) {
        console.error(`✗ ${label} missing ${missing.length} key(s):`);
        for (const k of missing) console.error(`    - ${k}`);
        exitCode = 1;
      } else {
        console.log(`✓ ${label}: ${keys.size} keys (matches en)`);
      }
    };

    const reportExtra = (label, keys) => {
      const extra = [...keys].filter((k) => !enKeys.has(k)).sort();
      if (extra.length > 0) {
        // Extras are warnings — the schema typecheck would have
        // caught a true type mismatch; extras here usually mean
        // dead translations after an en key was removed. Worth
        // surfacing but not a hard fail.
        console.warn(`! ${label} has ${extra.length} extra key(s):`);
        for (const k of extra) console.warn(`    + ${k}`);
      }
    };

    console.log(`en source: ${enKeys.size} keys`);
    reportMissing('zh-CN', zhKeys);
    reportMissing('vi', viKeys);
    reportExtra('zh-CN', zhKeys);
    reportExtra('vi', viKeys);
  } finally {
    await server.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('check-i18n-keys: unexpected error', err);
  process.exit(2);
});
