/*
 * Writes `dist/THIRD_PARTY_NOTICES.txt`: every package the app ships, with
 * its version, its license and the license text and notices the package
 * itself carries, as the MIT, ISC and similar licenses ask a copy to.
 *
 * It runs after `vite build`, from the lists `bundledPackages.mts` left in
 * `dist/.packages`, and adds the runtime dependencies electron-builder copies
 * into the app as they are, with the dependencies they bring. Electron and
 * Chromium are not listed: their licenses ship with Electron, as `LICENSE`
 * and `LICENSES.chromium.html` next to the app.
 *
 * A package that declares no license, or one under a license that asks more
 * of the app than a notice, is reported on the console for a person to look
 * at. It does not stop the build.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = join(projectRoot, 'dist');
const listDir = join(distDir, '.packages');
const outputFile = join(distDir, 'THIRD_PARTY_NOTICES.txt');

// The files a package keeps its license and notices in
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

// Licenses that ask for more than a notice, so a person decides on them
const NEEDS_REVIEW = /\b(a?gpl|lgpl|mpl|epl|cddl|sspl|busl|cc-by-nc)/i;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const licenseOf = (manifest) => {
  const { license, licenses } = manifest;

  if (typeof license === 'string') {
    return license;
  }

  if (license && typeof license.type === 'string') {
    return license.type;
  }

  if (Array.isArray(licenses)) {
    return licenses.map((each) => each.type ?? each).join(' OR ');
  }

  return null;
};

const homeOf = (manifest) => {
  const { homepage, repository } = manifest;

  if (typeof homepage === 'string') {
    return homepage;
  }

  const url = typeof repository === 'string' ? repository : repository?.url;

  return typeof url === 'string' ? url.replace(/^git\+/, '').replace(/\.git$/, '') : null;
};

/* The folders the builds listed, as their real paths, since a linked package is listed once */
const bundledFolders = () => {
  if (!existsSync(listDir)) {
    throw new Error(`${listDir} is missing: run \`vite build\` first`);
  }

  return readdirSync(listDir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => readJson(join(listDir, name)))
    .filter((folder) => existsSync(folder))
    .map((folder) => realpathSync(folder));
};

/*
 * The runtime dependencies of the app and the ones they bring, which
 * electron-builder copies as they are. An optional dependency that is not
 * installed, as a binary for another platform, is skipped.
 */
const runtimeFolders = () => {
  const found = new Set();
  const visit = (name, from) => {
    let manifestPath;

    try {
      manifestPath = createRequire(join(from, 'package.json')).resolve(`${name}/package.json`);
    } catch {
      return;
    }

    const folder = realpathSync(dirname(manifestPath));

    if (found.has(folder)) {
      return;
    }

    found.add(folder);

    const manifest = readJson(manifestPath);

    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      visit(dependency, folder);
    }
  };

  for (const name of Object.keys(readJson(join(projectRoot, 'package.json')).dependencies ?? {})) {
    visit(name, projectRoot);
  }

  return [...found];
};

const entryOf = (folder) => {
  const manifest = readJson(join(folder, 'package.json'));
  const files = readdirSync(folder)
    .filter((name) => LICENSE_FILE.test(name))
    .sort();

  return {
    name: manifest.name,
    version: manifest.version,
    license: licenseOf(manifest),
    home: homeOf(manifest),
    texts: files.map((name) => readFileSync(join(folder, name), 'utf8').trim()),
  };
};

const appName = readJson(join(projectRoot, 'package.json')).name;
const entries = new Map();

for (const folder of [...bundledFolders(), ...runtimeFolders()]) {
  const entry = entryOf(folder);

  if (entry.name && entry.name !== appName) {
    entries.set(`${entry.name}@${entry.version}`, entry);
  }
}

const sorted = [...entries.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const rule = '='.repeat(78);
const sections = sorted.map((entry) =>
  [
    rule,
    `${entry.name} ${entry.version}`,
    `License: ${entry.license ?? 'not declared'}`,
    ...(entry.home ? [entry.home] : []),
    '',
    entry.texts.length > 0
      ? entry.texts.join('\n\n')
      : `The package ships no license file. Its package.json declares: ${entry.license ?? 'nothing'}.`,
  ].join('\n'),
);

writeFileSync(
  outputFile,
  [
    'DaruDB Studio includes the open source packages listed below. Each one is',
    'given with its version, its license and the license text and notices it',
    'carries. The licenses of Electron and Chromium ship with the app as',
    'LICENSE and LICENSES.chromium.html.',
    '',
    ...sections,
    '',
  ].join('\n'),
);
rmSync(listDir, { recursive: true, force: true });

const unlicensed = sorted.filter((entry) => !entry.license);
const review = sorted.filter((entry) => entry.license && NEEDS_REVIEW.test(entry.license));
const textless = sorted.filter((entry) => entry.texts.length === 0);

console.log(`Wrote the notices of ${sorted.length} packages to ${outputFile}`);

for (const [label, list] of [
  ['declares no license', unlicensed],
  ['has a license to review', review],
  ['ships no license file', textless],
]) {
  for (const entry of list) {
    console.warn(`  ${entry.name} ${entry.version} ${label}: ${entry.license ?? '-'}`);
  }
}
