import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { buildSite, publishableFiles } from '../scripts/site-build.mjs';
import { checkSite } from '../scripts/site-check.mjs';
import { siteServer } from '../scripts/site-server.mjs';
import { createGallery } from '../scripts/site-evidence.mjs';

const sha = 'a'.repeat(40);
const html = '<!doctype html><html lang="en"><head><title>Fixture</title><link rel="stylesheet" href="assets/site.css"></head><body><h1 id="features">Echo</h1><a href="#features">Features</a><a href="https://github.com/worxbend/echo">Source</a><script src="assets/site.js"></script></body></html>';
const css = '@font-face{font-family:Manrope;src:url("fonts/manrope-latin.woff2") format("woff2")}body{background:url("icon.svg#mark")}';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'echo-site-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const output = path.join(directory, 'output');
  async function put(file, content, root = source) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  await put('index.html', html);
  await put('assets/site.css', css);
  await put('assets/site.js', '// fixture');
  await put('assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark"/></svg>');
  await put('assets/fonts/manrope-latin.woff2', Buffer.from([0, 1, 2]));
  await put('assets/fonts/OFL.txt', 'Fixture license');
  const build = () => buildSite({ source, output, commit: sha, builtAt: '2026-01-01T00:00:00.000Z' });
  return { directory, source, output, put, build };
}

test('build copies only publishable assets, includes font/license and records exact provenance', async t => {
  const f = await fixture(t);
  for (const file of ['README.md', '.env', 'assets/.hidden.css', 'assets/font.ttf', 'assets/notes.txt', 'assets/fonts/other.woff2', 'assets/fonts/secret.js']) await f.put(file, 'private');
  await mkdir(f.output);
  await f.put('stale.txt', 'stale', f.output);
  const provenance = await f.build();
  assert.deepEqual(provenance.files, ['assets/fonts/OFL.txt', 'assets/fonts/manrope-latin.woff2', 'assets/icon.svg', 'assets/site.css', 'assets/site.js', 'index.html']);
  assert.equal(provenance.commit, sha);
  assert.equal(provenance.builtAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(await readFile(path.join(f.output, 'build.json'), 'utf8')), provenance);
  await assert.rejects(readFile(path.join(f.output, 'stale.txt')), /ENOENT/);
  assert.deepEqual(await checkSite(f.output), { files: 7, references: 6 });
});

test('builder refuses invalid commit before deleting existing output', async t => {
  const f = await fixture(t);
  await f.put('sentinel.txt', 'keep', f.output);
  await assert.rejects(buildSite({ source: f.source, output: f.output, commit: 'main' }), /Invalid provenance/);
  assert.equal(await readFile(path.join(f.output, 'sentinel.txt'), 'utf8'), 'keep');
});

test('builder refuses overlapping source/output paths', async t => {
  const f = await fixture(t);
  for (const output of [f.source, f.directory, path.join(f.source, 'built')]) await assert.rejects(buildSite({ source: f.source, output, commit: sha }), /must not overlap/);
});

for (const entry of ['index.html', 'assets', 'assets/link.css', 'assets/.hidden-link']) {
  test(`builder rejects source symlink: ${entry}`, async t => {
    const f = await fixture(t);
    const target = path.join(f.source, entry);
    await rm(target, { recursive: true, force: true });
    await symlink(entry === 'assets' ? f.directory : path.join(f.source, 'assets/site.js'), target);
    await assert.rejects(publishableFiles(f.source), /Symlink/);
  });
}

const badReferences = [
  ['missing image', '<img src="assets/missing.png" alt="missing">', /missing local target/],
  ['missing fragment', '<a href="#not-here">Missing</a>', /missing fragment/],
  ['cross-file fragment', '<a href="assets/icon.svg#missing">Missing</a>', /missing fragment/],
  ['root-relative asset', '<img src="/assets/icon.svg" alt="bad">', /root-relative/],
  ['protocol-relative asset', '<img src="//cdn.example/image.svg" alt="bad">', /root-relative/],
  ['traversal', '<img src="assets/../index.html" alt="bad">', /traversal/],
  ['encoded traversal', '<img src="assets/%2e%2e/index.html" alt="bad">', /traversal/],
  ['encoded root', '<img src="%2Fassets/icon.svg" alt="bad">', /root-relative/],
  ['backslash', '<img src="assets\\icon.svg" alt="bad">', /unsafe reference/],
  ['invalid encoding', '<a href="#%ZZ">Bad</a>', /invalid URL encoding/],
  ['external resource', '<script src="https://cdn.example/app.js"></script>', /forbidden external/],
  ['data image', '<img src="data:image/png;base64,AA==" alt="bad">', /forbidden external/],
  ['javascript link', '<a href="javascript:alert(1)">Bad</a>', /forbidden external/],
  ['duplicate id', '<p id="features">Duplicate</p>', /duplicate id/],
  ['base element', '<base href="https://example.com/">', /base elements/],
  ['inline script', '<script>alert(1)</script>', /inline scripts/],
  ['inline style', '<p style="color:red">Bad</p>', /inline styles/],
  ['inline event', '<button onclick="alert(1)">Bad</button>', /inline styles or handlers/],
  ['srcset', '<img src="assets/icon.svg" srcset="assets/missing.png 2x" alt="bad">', /missing local target/],
  ['object resource', '<object data="https://example.com/file.svg"></object>', /forbidden external/],
];
for (const [name, markup, expected] of badReferences) {
  test(`checker rejects ${name}`, async t => {
    const f = await fixture(t);
    await f.put('index.html', html.replace('</body>', `${markup}</body>`));
    await f.build();
    await assert.rejects(checkSite(f.output), expected);
  });
}

for (const [name, extra, expected] of [
  ['missing font', 'a{background:url("fonts/missing.woff2")}', /missing local target/],
  ['external import', '@import "https://example.com/style.css";', /forbidden external/],
  ['root CSS url', 'a{background:url(/echo/assets/icon.svg)}', /root-relative/],
  ['malformed CSS', 'a{', /invalid CSS/],
]) {
  test(`checker rejects ${name}`, async t => {
    const f = await fixture(t);
    await f.put('assets/site.css', css + extra);
    await f.build();
    await assert.rejects(checkSite(f.output), expected);
  });
}

test('checker rejects unexpected artifact files and font variants', async t => {
  const f = await fixture(t);
  await f.build();
  for (const file of ['README.md', 'assets/.hidden.css', 'assets/nested/.hidden.js', 'assets/fonts/extra.woff2', 'assets/fonts/secret.js']) await f.put(file, 'bad', f.output);
  await assert.rejects(checkSite(f.output), /not on the publishing allowlist/);
});

test('checker rejects file and directory symlinks without following them', async t => {
  const f = await fixture(t);
  await f.build();
  await symlink(path.join(f.source, 'index.html'), path.join(f.output, 'assets/link.html'));
  await symlink(f.source, path.join(f.output, 'assets/linked'));
  await assert.rejects(checkSite(f.output), /symlinks are forbidden/);
});

test('checker rejects missing HTML entrypoint', async t => {
  const f = await fixture(t);
  await f.build();
  await rm(path.join(f.output, 'index.html'));
  await assert.rejects(checkSite(f.output), /Missing index.html/);
});

async function listen(t, options) {
  const server = siteServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
function rawRequest(origin, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(origin, { path: pathname, method }, res => {
      const buffers = [];
      res.on('data', data => buffers.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(buffers).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

for (const base of ['/echo/', '/']) {
  test(`server handles ${base} with correct MIME, HEAD and route isolation`, async t => {
    const f = await fixture(t);
    await f.build();
    const origin = await listen(t, { root: f.output, base });
    assert.equal((await rawRequest(origin, base)).body, html);
    assert.equal((await rawRequest(origin, `${base}assets/fonts/manrope-latin.woff2`)).headers['content-type'], 'font/woff2');
    assert.match((await rawRequest(origin, `${base}assets/fonts/OFL.txt`)).headers['content-type'], /^text\/plain/);
    const head = await rawRequest(origin, base, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal((await rawRequest(origin, base, 'POST')).status, 405);
    assert.equal((await rawRequest(origin, `${base}missing`)).status, 404);
    for (const pathname of [`${base}../index.html`, `${base}%2e%2e/index.html`, `${base}assets%5csite.css`, `${base}%00`, `${base}%ZZ`]) assert.equal((await rawRequest(origin, pathname)).status, 404);
    if (base === '/echo/') {
      for (const pathname of ['/', '/assets/site.css', '/echo', '/echoing/']) assert.equal((await rawRequest(origin, pathname)).status, 404);
    }
  });
}

test('server refuses symlinks that escape the artifact', async t => {
  const f = await fixture(t);
  await f.build();
  await symlink(path.join(f.source, 'index.html'), path.join(f.output, 'leak.html'));
  const origin = await listen(t, { root: f.output });
  assert.equal((await rawRequest(origin, '/echo/leak.html')).status, 404);
});

test('server validates its configured base', () => {
  for (const base of ['echo/', '/echo', '//', '/../']) assert.throws(() => siteServer({ base }), /Base must/);
});


test('checker permits outbound navigation and canonical metadata, but not remote stylesheets', async t => {
  const f = await fixture(t);
  await f.put('index.html', html.replace('</head>', '<link rel="canonical" href="https://worxbend.github.io/echo/"></head>').replace('</body>', '<a href="mailto:hello@example.com">Email</a></body>'));
  await f.build();
  await checkSite(f.output);
  await f.put('index.html', html.replace('</head>', '<link rel="stylesheet" href="https://example.com/main.css"></head>'));
  await f.build();
  await assert.rejects(checkSite(f.output), /forbidden external/);
});

test('checker handles query strings and encoded fragments against exact local targets', async t => {
  const f = await fixture(t);
  await f.put('index.html', html.replace('#features', 'index.html?v=1#%66eatures'));
  await f.build();
  await checkSite(f.output);
});


async function galleryFixture(t, { file = 'screenshots/enhanced-320-light.png', includeImage = true } = {}) {
  const f = await fixture(t);
  await f.build();
  const directory = path.join(f.directory, 'evidence');
  await f.put('screenshots/enhanced-320-light.json', JSON.stringify({ name: 'enhanced-320-light', file, width: 320, theme: 'light', mode: 'enhanced', browser: 'fixture' }), directory);
  if (includeImage && file.startsWith('screenshots/')) {
    // Synthetic PNG header is a unit fixture, never browser evidence.
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(900, 20);
    await f.put(file, png, directory);
  }
  return { ...f, directory };
}

test('evidence manifest verifies count, dimensions, hashes and exact gallery image paths', async t => {
  const f = await galleryFixture(t);
  const manifest = await createGallery({ directory: f.directory, artifact: f.output });
  assert.equal(manifest.count, 1);
  assert.equal(manifest.expectedCount, 16);
  assert.equal(manifest.complete, false);
  assert.equal(manifest.missing.length, 15);
  assert.equal(manifest.screenshots[0].imageWidth, 320);
  assert.match(manifest.screenshots[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(manifest.assetSha256), (await f.build()).files);
  assert.match(await readFile(path.join(f.directory, 'gallery.html'), 'utf8'), /src="screenshots\/enhanced-320-light.png"/);
});

test('evidence generator rejects missing screenshots instead of claiming completeness', async t => {
  const f = await galleryFixture(t, { includeImage: false });
  await assert.rejects(createGallery({ directory: f.directory, artifact: f.output }), /ENOENT/);
});

test('evidence generator rejects screenshot path traversal', async t => {
  const f = await galleryFixture(t, { file: '../private.png', includeImage: false });
  await assert.rejects(createGallery({ directory: f.directory, artifact: f.output }), /Unsafe screenshot path/);
});
