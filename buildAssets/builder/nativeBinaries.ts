import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/*
 * The binary of `darudb` for the platform an installer is made for.
 *
 * `darudb` loads a native binary from a package of its own for each platform,
 * which npm installs for the machine it runs on and no other. An installer for
 * another platform or architecture, a universal macOS app included, would ship
 * without the binary it needs and fail to open any file. So before electron-
 * builder packs the app for a platform, the binary's package for it is fetched
 * from the registry at the version of `darudb` installed, if it is missing.
 * */

// The package of the binary for each platform and architecture an installer is made for
const BINARY_PACKAGES: Record<string, Record<string, string>> = {
  darwin: { x64: 'darwin-x64', arm64: 'darwin-arm64' },
  win32: { x64: 'win32-x64-msvc', ia32: 'win32-ia32-msvc', arm64: 'win32-arm64-msvc' },
  linux: { x64: 'linux-x64-gnu', arm64: 'linux-arm64-gnu', armv7l: 'linux-arm-gnueabihf' },
};

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const installedVersion = (projectRoot: string): string =>
  JSON.parse(readFileSync(join(projectRoot, 'node_modules/darudb/package.json'), 'utf8')).version;

/* Fetches `@darudb/darudb-<suffix>` into `node_modules`, unless it is there */
const ensurePackage = (projectRoot: string, suffix: string): void => {
  const name = `@darudb/darudb-${suffix}`;
  const target = join(projectRoot, 'node_modules', name);

  if (existsSync(join(target, 'package.json'))) {
    return;
  }

  const version = installedVersion(projectRoot);
  const scratch = mkdtempSync(join(tmpdir(), 'darudb-binary-'));

  try {
    // `npm pack` checks the tarball against the registry's integrity hash
    execFileSync(npm, ['pack', `${name}@${version}`, '--pack-destination', scratch, '--silent'], {
      cwd: projectRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
      shell: process.platform === 'win32',
    });

    const [tarball] = readdirSync(scratch).filter((file) => file.endsWith('.tgz'));

    mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', join(scratch, tarball), '-C', target, '--strip-components=1']);
    console.log(`  • fetched ${name}@${version} for the installer`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/*
 * Makes sure the binary for `platform` and `arch`, as electron-builder names
 * them, is installed in the project at `projectRoot`. A universal macOS app
 * needs both of its architectures.
 * */
export const ensureNativeBinary = (projectRoot: string, platform: string, arch: string): void => {
  const packages = BINARY_PACKAGES[platform];

  if (!packages) {
    throw new Error(`darudb has no binary for the platform ${platform}`);
  }

  const archs = arch === 'universal' ? ['x64', 'arm64'] : [arch];

  for (const each of archs) {
    const suffix = packages[each];

    if (!suffix) {
      throw new Error(`darudb has no binary for ${platform} on ${each}`);
    }

    ensurePackage(projectRoot, suffix);
  }
};

/*
 * The `files` patterns that leave out the binaries of every other platform,
 * which a build machine may hold for the installers it made before. A macOS
 * app keeps both of its architectures: a universal app is merged from two
 * builds whose files have to be the same.
 * */
export const otherBinaries = (platform: string): string[] =>
  Object.keys(BINARY_PACKAGES)
    .filter((each) => each !== platform)
    .concat(['android', 'freebsd'])
    .map((each) => `!node_modules/@darudb/darudb-${each}-*{,/**/*}`);
