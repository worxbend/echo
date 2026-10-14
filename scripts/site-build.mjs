import { cp, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function isPublishableAsset(file) {
  if (!file.startsWith('assets/') || file.includes('\\') || file.split('/').some(segment => !segment || segment.startsWith('.'))) return false;
  if (file === 'assets/fonts/manrope-latin.woff2' || file === 'assets/fonts/OFL.txt') return true;
  if (file.startsWith('assets/fonts/')) return false;
  return /^assets\/[^?]+\.(?:css|js|svg|png|jpe?g|webp|avif|ico)$/.test(file);
}

export async function publishableFiles(source) {
  for (const relative of ['', 'index.html', 'assets']) {
    const info = await lstat(path.join(source, relative));
    if (info.isSymbolicLink()) throw new Error(`Symlink is not publishable: ${relative || 'source'}`);
    if (relative === 'index.html' ? !info.isFile() : !info.isDirectory()) throw new Error(`Invalid source entry: ${relative}`);
  }
  const files = ['index.html'];
  async function visit(directory) {
    for (const entry of await readdir(path.join(source, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink is not publishable: ${relative}`);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && isPublishableAsset(relative.split(path.sep).join('/'))) files.push(relative);
    }
  }
  await visit('assets');
  return files.sort();
}

export async function buildSite({ source = path.join(repository, 'site'), output = path.join(repository, '_site'), commit, builtAt = new Date().toISOString() } = {}) {
  const sourcePath = path.resolve(source);
  const outputPath = path.resolve(output);
  if (sourcePath === outputPath || sourcePath.startsWith(outputPath + path.sep) || outputPath.startsWith(sourcePath + path.sep)) {
    throw new Error('Build output and source directory must not overlap');
  }
  const files = await publishableFiles(source);
  let sha = commit ?? process.env.GITHUB_SHA;
  if (!sha) {
    try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(); }
    catch { sha = null; }
  }
  if (sha !== null && !/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error('Invalid provenance commit SHA');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const relative of files) {
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await cp(path.join(source, relative), path.join(output, relative), { dereference: false });
  }
  const provenance = { commit: sha, builtAt, files: files.map(file => file.split(path.sep).join('/')) };
  await writeFile(path.join(output, 'build.json'), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite();
  console.log(`Built ${result.files.length} publishable files in _site (commit ${result.commit ?? 'unknown'}).`);
}
