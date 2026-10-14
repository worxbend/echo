import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { repository } from './site-build.mjs';

export default async function resetEvidence() {
  const directory = path.join(repository, 'artifacts/site');
  for (const file of ['screenshots', 'manifest.json', 'gallery.html']) await rm(path.join(directory, file), { recursive: true, force: true });
  await mkdir(path.join(directory, 'screenshots'), { recursive: true });
}
