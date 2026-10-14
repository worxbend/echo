import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { isPublishableAsset, repository } from './site-build.mjs';

export async function checkSite(root = path.join(repository, '_site')) {
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Artifact root symlinks are forbidden');
  const errors = [];
  const files = [];
  const documents = new Map();
  const references = [];
  const fail = message => errors.push(message);
  async function walk(directory = '') {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`${file}: symlinks are forbidden`);
      else if (entry.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  await walk();
  if (!files.includes('index.html')) fail('Missing index.html');
  for (const file of files) {
    if (file !== 'index.html' && file !== 'build.json' && !isPublishableAsset(file)) {
      fail(`${file}: not on the publishing allowlist`);
    }
    if (/\.(?:html|svg)$/.test(file)) {
      const document = parse(await readFile(path.join(root, file), 'utf8'));
      const ids = new Set();
      function visit(node) {
        const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]));
        if (attrs.id) {
          if (ids.has(attrs.id)) fail(`${file}: duplicate id ${attrs.id}`);
          ids.add(attrs.id);
        }
        if (node.tagName === 'base') fail(`${file}: base elements are forbidden`);
        if (attrs.style !== undefined || Object.keys(attrs).some(name => /^on/i.test(name))) fail(`${file}: inline styles or handlers are forbidden`);
        if (node.tagName === 'style' || (node.tagName === 'script' && !attrs.src)) fail(`${file}: inline scripts or styles are forbidden`);
        if (attrs.srcdoc !== undefined) fail(`${file}: embedded HTML is forbidden`);
        if (node.tagName === 'object' && attrs.data) references.push({ file, value: attrs.data, resource: true });
        for (const name of ['href', 'src', 'poster', 'xlink:href']) {
          if (attrs[name] !== undefined) references.push({ file, value: attrs[name], resource: name !== 'href' || (node.tagName !== 'a' && !(node.tagName === 'link' && attrs.rel === 'canonical')) });
        }
        if (attrs.srcset) {
          for (const candidate of attrs.srcset.split(',')) references.push({ file, value: candidate.trim().split(/\s+/)[0], resource: true });
        }
        if (attrs.style) collectCSS(file, attrs.style, true);
        if (node.tagName === 'style') collectCSS(file, (node.childNodes ?? []).map(child => child.value ?? '').join(''));
        for (const child of node.childNodes ?? []) visit(child);
        if (node.content) visit(node.content);
      }
      visit(document);
      documents.set(file, ids);
    } else if (file.endsWith('.css')) collectCSS(file, await readFile(path.join(root, file), 'utf8'));
  }
  function collectCSS(file, text, inline = false) {
    try {
      const tree = postcss.parse(inline ? `x{${text}}` : text);
      const collect = value => valueParser(value).walk(node => {
        if (node.type === 'function' && node.value.toLowerCase() === 'url') {
          references.push({ file, value: valueParser.stringify(node.nodes).trim().replace(/^(['"])(.*)\1$/, '$2'), resource: true });
          return false;
        }
      });
      tree.walkDecls(declaration => collect(declaration.value));
      tree.walkAtRules(rule => {
        collect(rule.params);
        if (rule.name.toLowerCase() === 'import') {
          const first = valueParser(rule.params).nodes[0];
          if (first?.type === 'string') references.push({ file, value: first.value, resource: true });
        }
      });
    } catch (error) { fail(`${file}: invalid CSS: ${error.message}`); }
  }
  for (const { file, value, resource } of references) {
    if (!value) { fail(`${file}: empty reference`); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      if (resource || !/^(https?:|mailto:)/i.test(value)) fail(`${file}: forbidden external reference ${value}`);
      continue;
    }
    const [beforeHash, rawFragment] = value.split('#');
    let pathname, fragment;
    try {
      pathname = decodeURIComponent(beforeHash.split('?')[0]);
      fragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
    }
    catch { fail(`${file}: invalid URL encoding ${value}`); continue; }
    if (pathname.startsWith('/') || pathname.includes('\\') || pathname.split('/').some(part => part === '..') || /[\u0000-\u0020]/.test(pathname)) {
      fail(`${file}: root-relative, traversal or unsafe reference ${value}`);
      continue;
    }
    let target = pathname ? path.posix.join(path.posix.dirname(file), pathname) : file;
    if (pathname.endsWith('/')) target = path.posix.join(target, 'index.html');
    if (!files.includes(target)) { fail(`${file}: missing local target ${value} (${target})`); continue; }
    if (fragment && (!documents.has(target) || !documents.get(target).has(fragment))) fail(`${file}: missing fragment ${value}`);
  }
  if (errors.length) throw new Error(`Site artifact validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
  return { files: files.length, references: references.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkSite(process.argv[2]);
  console.log(`Validated ${result.files} files and ${result.references} references; project-subpath safe.`);
}
