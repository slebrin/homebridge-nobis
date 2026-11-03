import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publishedDocuments = [
  'package.json', 'config.schema.json', 'README.md', 'CHANGELOG.md',
  'LICENSE', 'NOTICE', 'docs/ETUDE-API.md', 'docs/HISTORIQUE-DEVELOPPEMENT.md',
];

export function validatePack(result, manifest, expectedFiles) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Expected exactly one npm package.');
  }
  const pack = result[0];
  if (!pack || pack.name !== manifest.name || pack.version !== manifest.version
    || !Array.isArray(pack.files)) {
    throw new Error('Invalid npm package metadata or version.');
  }
  const expected = new Set(expectedFiles);
  const found = new Set();
  for (const file of pack.files) {
    if (!file || typeof file.path !== 'string' || !expected.has(file.path)) {
      throw new Error('Unexpected file in npm package.');
    }
    if (found.has(file.path) || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error('Duplicate or empty file in npm package.');
    }
    found.add(file.path);
  }
  for (const file of expected) {
    if (!found.has(file)) {
      throw new Error(`Missing required package file: ${file}`);
    }
  }
  if (!found.has(manifest.main) || !found.has(manifest.types)) {
    throw new Error('Package entry points are not included.');
  }
  return found.size;
}

async function compiledFiles(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await compiledFiles(path.join(directory, entry.name), name));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const stem = `dist/${name.slice(0, -3)}`;
      files.push(`${stem}.js`, `${stem}.d.ts`, `${stem}.js.map`);
    } else {
      throw new Error('Unexpected source file type; review package validation.');
    }
  }
  return files;
}

async function checkPackage() {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (lock.name !== manifest.name || lock.version !== manifest.version
    || lock.packages?.['']?.version !== manifest.version) {
    throw new Error('Package and lockfile versions are not synchronized.');
  }
  const expected = [...publishedDocuments, ...await compiledFiles(path.join(root, 'src'))];
  // Ignore lifecycle scripts here to avoid recursion from prepublishOnly.
  const output = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const count = validatePack(JSON.parse(output), manifest, expected);
  console.info(`Package verified: ${manifest.name}@${manifest.version}, ${count} expected files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkPackage();
}
