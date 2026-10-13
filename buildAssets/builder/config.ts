/* eslint-disable no-template-curly-in-string */
import { Arch, type Configuration } from 'electron-builder';
import dotenv from 'dotenv';
import packageJson from '../../package.json' with { type: 'json' };
import { ensureNativeBinary, otherBinaries } from './nativeBinaries';

dotenv.config();

// Whether the environment holds what signing and notarizing for macOS take.
// The values are read by electron-builder itself; this only checks they are set.
const signsMac = Boolean(process.env.CSC_LINK);
const notarizesMac =
  signsMac &&
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every((name) =>
    Boolean(process.env[name]),
  );

const config: Configuration = {
  productName: packageJson.productName,
  appId: packageJson.appId,
  asar: true,
  // The binary `darudb` loads, for the platform being packed, which npm may not have installed
  beforePack: async ({ packager, electronPlatformName, arch }) => {
    ensureNativeBinary(packager.projectDir, electronPlatformName, Arch[arch]);
  },
  extends: null,
  // Switches compiled into the Electron binary, flipped as the app is packed and
  // before it is signed, so a released app runs only its own code. It no longer
  // runs as plain Node.js (`ELECTRON_RUN_AS_NODE`), takes no `NODE_OPTIONS` or
  // `--inspect`, loads only `app.asar`, and checks that archive against the hash
  // packed with it on macOS and Windows. `--self-check` is how a packed build is
  // checked instead, see `src/main/selfCheck.ts`.
  //
  // The pages are still loaded from `file://`, whose module scripts need the
  // privileges that fuse keeps, so it stays on.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // An unsigned macOS build is signed ad hoc again once the binary changed,
    // which Apple silicon needs to run it at all
    resetAdHocDarwinSignature: !signsMac,
  },
  compression: 'maximum',
  artifactName: '${productName} ${version}_${arch}.${ext}',
  copyright: `ⓒ ${new Date().getFullYear()} ${packageJson.author}`,
  directories: {
    buildResources: './buildAssets/installer/',
    output: './release/${version}'
  },
  // The notices of the packages the app ships, on disk next to the licenses of
  // Electron and Chromium, as well as inside the app, where its Help menu shows them
  extraResources: [{ from: 'dist/THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }],
  files: [
    /* A list of files not to be included in the build. */
    /*
      (Required) The files and folders listed below should not be included in the build.
    */
    'dist/**/*',
    /* The development entry is emitted as a hashed chunk, so match it by prefix. */
    '!dist/main/index.dev*',
    '!dist/**/*.map',
    '!docs/**/*',
    '!tests/**/*',
    '!release/**/*'
  ],
  mac: {
    files: otherBinaries('darwin'),
    // Each darudb binary is for one architecture, and both are in both builds
    // a universal app is merged from, so the merge keeps them as they are
    x64ArchFiles: 'Contents/Resources/app.asar.unpacked/node_modules/@darudb/darudb-darwin-*/*.node',
    bundleVersion: '1.0',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    // Signed with the Developer ID certificate in `CSC_LINK` when there is one,
    // and notarized when Apple's credentials are there too, see CONTRIBUTING.md.
    // Without them the app is built unsigned, which macOS opens only after the
    // user allows it.
    ...(signsMac ? {} : { identity: null }),
    notarize: notarizesMac,
    icon: 'buildAssets/installer/icon.icns',
    type: 'distribution',
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64', 'universal']
      }
    ]
  },
  dmg: {
    contents: [
      {
        x: 410,
        y: 150,
        type: 'link',
        path: '/Applications'
      },
      {
        x: 130,
        y: 150,
        type: 'file'
      }
    ],
    sign: false
  },
  win: {
    files: otherBinaries('win32'),
    icon: './buildAssets/installer/icon.ico',
    target: [
      {
        target: 'appx',
        arch: 'x64'
      },
      {
        target: 'zip',
        arch: 'x64'
      },
      {
        target: 'portable',
        arch: 'x64'
      },
      {
        target: 'nsis',
        arch: 'x64'
      }
    ]
  },
  appx: {
    // A Store app's id takes letters and digits only
    applicationId: 'DaruDBStudio',
  },
  portable: {
    artifactName: '${productName} ${version}_${arch} Portable.${ext}'
  },
  nsis: {
    oneClick: true
  },
  linux: {
    files: otherBinaries('linux'),
    executableName: packageJson.name.toLowerCase(),
    icon: 'buildAssets/installer/icon.png',
    category: 'Utility',
    target: [
      {
        target: 'snap',
        arch: 'x64'
      },
      {
        target: 'deb',
        arch: 'x64'
      },
      {
        target: 'rpm',
        arch: 'x64'
      }
    ]
  }
};

export default config;
