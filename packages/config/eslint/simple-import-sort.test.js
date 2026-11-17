import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import { baseConfig } from './base.js';
import { nextConfig } from './next.js';

const webDirectory = resolve(import.meta.dirname, '..', '..', '..', 'apps', 'web');
const configs = [
  ['base', baseConfig(import.meta.dirname)],
  ['Next.js', nextConfig],
];

for (const [name, config] of configs) {
  test(`${name} config enforces import and export sorting`, async () => {
    const eslint = new ESLint({
      cwd: webDirectory,
      overrideConfigFile: true,
      overrideConfig:
        name === 'Next.js'
          ? [...config, { rules: { '@next/next/no-html-link-for-pages': 'off' } }]
          : config,
    });

    const [unsorted] = await eslint.lintText(
      [
        "import { z } from 'z';",
        "import { a } from 'a';",
        'void [a, z];',
        "export { z } from 'z';",
        "export { a } from 'a';",
      ].join('\n'),
      { filePath: 'fixture.js' },
    );
    assert.deepEqual(
      unsorted.messages
        .filter(({ ruleId }) => ruleId?.startsWith('simple-import-sort/'))
        .map(({ ruleId }) => ruleId)
        .sort(),
      ['simple-import-sort/exports', 'simple-import-sort/imports'],
    );

    const [sorted] = await eslint.lintText(
      [
        "import { a } from 'a';",
        "import { z } from 'z';",
        'void [a, z];',
        "export { a } from 'a';",
        "export { z } from 'z';",
      ].join('\n'),
      { filePath: 'fixture.js' },
    );
    assert.equal(
      sorted.messages.some(({ ruleId }) => ruleId?.startsWith('simple-import-sort/')),
      false,
    );
  });
}
