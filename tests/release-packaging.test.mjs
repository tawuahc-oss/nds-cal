import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('release packaging refreshes changed assets and excludes private source files', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'nds-release-test-'));
  try {
    await mkdir(join(fixture, 'scripts'));
    await copyFile(new URL('../scripts/build-site.mjs', import.meta.url), join(fixture, 'scripts/build-site.mjs'));
    await copyFile(new URL('../offline-sw.mjs', import.meta.url), join(fixture, 'offline-sw.mjs'));
    await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
    await writeFile(join(fixture, 'index.html'),
      '<link rel="stylesheet" href="./assets/calendar.css?v=old"><script src="./assets/app.js?v=old"></script>');
    await writeFile(join(fixture, 'manifest.webmanifest'), '{}');
    await writeFile(join(fixture, '.dev.vars'), 'PRIVATE_TEST_VALUE');
    const assets = ['icons/calendar-180.png', 'icons/calendar-192.png', 'icons/calendar-512.png',
      'calendar.css', 'app.js', 'lunar-info.js', 'recurrence-form.js', 'pdf.js',
      'vendor/lunar.js', 'vendor/lunar.LICENSE', 'fonts/NotoSansTC.ttf', 'fonts/OFL.txt',
      'data/hk-holidays.json'];
    for (const name of assets) {
      const target = join(fixture, 'assets', name);
      await mkdir(resolve(target, '..'), {recursive: true});
      await writeFile(target, name === 'calendar.css' ? 'body { color: black; }' : 'test asset');
    }
    const build = () => execFileSync(process.execPath, ['scripts/build-site.mjs'], {cwd: fixture});
    build();
    const first = await readFile(join(fixture, 'dist/index.html'), 'utf8');
    const references = html => [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
    const [firstCss, firstScript] = references(first);
    assert.notEqual(firstCss, './assets/calendar.css?v=old');
    assert.notEqual(firstScript, './assets/app.js?v=old');
    await writeFile(join(fixture, 'assets/calendar.css'), 'body { color: white; }');
    build();
    const second = await readFile(join(fixture, 'dist/index.html'), 'utf8');
    const [secondCss, secondScript] = references(second);
    assert.notEqual(secondCss, firstCss);
    assert.equal(secondScript, firstScript);
    assert.deepEqual((await readdir(join(fixture, 'dist'))).sort(),
      ['_headers', 'assets', 'index.html', 'manifest.webmanifest', 'sw.js']);
    assert.match(await readFile(join(fixture, 'dist/_headers'), 'utf8'), /Cache-Control: no-store/);
  } finally {
    if (!resolve(fixture).startsWith(resolve(tmpdir()))) throw Error('Unsafe test cleanup path');
    await rm(fixture, {recursive: true, force: true});
  }
});
