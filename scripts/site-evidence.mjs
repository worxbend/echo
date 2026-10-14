import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { repository } from './site-build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function createGallery({ directory = path.join(repository, 'artifacts/site'), artifact = path.join(repository, '_site') } = {}) {
  const screenshots = [];
  for (const file of (await readdir(path.join(directory, 'screenshots'))).filter(file => file.endsWith('.json')).sort()) {
    const record = JSON.parse(await readFile(path.join(directory, 'screenshots', file), 'utf8'));
    if (!/^screenshots\/(?:enhanced|nojs)-(?:320|390|768|1440)-(?:light|dark)\.png$/.test(record.file)) throw new Error(`Unsafe screenshot path: ${record.file}`);
    const bytes = await readFile(path.join(directory, record.file));
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG: ${record.file}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== record.width || height < 1) throw new Error(`Invalid screenshot dimensions: ${record.file}`);
    screenshots.push({ ...record, imageWidth: width, imageHeight: height, sha256: hash(bytes), bytes: bytes.length });
  }
  screenshots.sort((a, b) => a.mode.localeCompare(b.mode) || a.width - b.width || a.theme.localeCompare(b.theme));
  const expected = ['enhanced', 'nojs'].flatMap(mode => [320, 390, 768, 1440].flatMap(width => ['light', 'dark'].map(theme => `${mode}-${width}-${theme}`)));
  const names = screenshots.map(record => record.name);
  if (new Set(names).size !== names.length) throw new Error('Duplicate screenshot records');
  const missing = expected.filter(name => !names.includes(name));
  const build = JSON.parse(await readFile(path.join(artifact, 'build.json'), 'utf8'));
  const assets = {};
  for (const file of build.files) assets[file] = hash(await readFile(path.join(artifact, file)));
  const manifest = { expectedCount: expected.length, count: screenshots.length, complete: missing.length === 0, missing, build, assetSha256: assets, screenshots };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const cards = screenshots.map(record => `<article><h2>${escape(record.name)}</h2><p>${record.width}px · ${escape(record.theme)} · Chromium ${escape(record.browser)}</p><div class="preview"><a href="${escape(record.file)}"><img src="${escape(record.file)}" width="${record.imageWidth}" height="${record.imageHeight}" alt="Echo microsite, ${escape(record.mode)}, ${record.width}px, ${escape(record.theme)} theme" loading="lazy"></a></div></article>`).join('\n');
  await writeFile(path.join(directory, 'gallery.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Echo browser evidence</title><style>body{margin:32px;font:16px/1.5 system-ui;background:#eef1f6;color:#172b51}.captures{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}article{background:white;padding:16px;border-radius:12px}h2{font-size:18px}.preview{max-height:640px;overflow:auto}img{display:block;max-width:100%;height:auto}a{color:#1848c9}</style></head><body><h1>Echo browser evidence</h1><p>${screenshots.length}/${expected.length} captures. Commit: ${escape(build.commit ?? 'unknown')}. Generated from the built site, not hardware.</p><p><a href="manifest.json">Capture manifest and SHA-256 hashes</a></p>${missing.length ? `<p>Missing: ${escape(missing.join(', '))}</p>` : ''}<div class="captures">${cards}</div></body></html>\n`);
  console.log(`Browser evidence: ${screenshots.length}/${expected.length} screenshots; artifacts/site/gallery.html and manifest.json.`);
  return manifest;
}

export default async function finishEvidence() {
  await createGallery();
}
