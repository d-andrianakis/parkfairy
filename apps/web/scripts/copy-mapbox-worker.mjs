// The map's worker must come from our own origin: the strict CSP refuses `blob:` workers, and
// the CDN copy would be a third-party script. So the file ships with the app, copied from the
// installed package at build time, which keeps it the same version as the library using it.
// Its name carries that version (`workerUrlFor` in lib/mapbox.ts builds the same name), so it
// can be cached for a year and an upgrade can never pair the library with an older worker.
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const manifest = require.resolve('mapbox-gl/package.json');
const { version } = JSON.parse(await readFile(manifest, 'utf8'));
const source = join(dirname(manifest), 'dist');
const target = fileURLToPath(new URL('../public/vendor/', import.meta.url));

await mkdir(target, { recursive: true });
// Workers of other versions go: nothing asks for them any more.
for (const name of await readdir(target)) {
  if (name.startsWith('mapbox-gl-csp-worker')) await rm(join(target, name));
}
await copyFile(
  join(source, 'mapbox-gl-csp-worker.js'),
  join(target, `mapbox-gl-csp-worker-${version}.js`),
);
