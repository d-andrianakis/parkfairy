// The map's worker must come from our own origin: the strict CSP refuses `blob:` workers, and
// the CDN copy would be a third-party script. So the file ships with the app, copied from the
// installed package at build time, which keeps it the same version as the library using it.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = join(dirname(require.resolve('mapbox-gl/package.json')), 'dist');
const target = fileURLToPath(new URL('../public/vendor/', import.meta.url));

await mkdir(target, { recursive: true });
await copyFile(join(source, 'mapbox-gl-csp-worker.js'), join(target, 'mapbox-gl-csp-worker.js'));
