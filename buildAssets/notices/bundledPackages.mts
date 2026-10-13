import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'vite';

/*
 * Records which packages a build bundled, for the third-party notices.
 *
 * Each of the three builds (the renderer, the main process and the preload
 * script) writes the folders of the packages its output holds code from to
 * `<listDir>/<build>.json`. `write.mjs` then reads every list, adds the
 * packages the app ships unbundled, and writes the notices. A module the
 * bundler shook out of the output is not in a chunk, so it is not listed.
 * */

/* The folder of the package a module id is in, or `null` for the app's own code */
export const packageFolderOf = (id: string): string | null => {
  // Virtual modules start with a NUL, and some ids carry a query
  const path = id.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/');
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);

  if (at < 0) {
    return null;
  }

  const [first, second] = path.slice(at + marker.length).split('/');
  const name = first.startsWith('@') && second ? `${first}/${second}` : first;

  return `${path.slice(0, at)}${marker}${name}`;
};

export default function bundledPackages(build: string, listDir: string): Plugin {
  return {
    name: 'darudb-studio-bundled-packages',
    apply: 'build',
    generateBundle(_options, bundle) {
      const folders = new Set<string>();

      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          for (const id of output.moduleIds) {
            const folder = packageFolderOf(id);

            if (folder) {
              folders.add(folder);
            }
          }
        }
      }

      mkdirSync(listDir, { recursive: true });
      writeFileSync(join(listDir, `${build}.json`), JSON.stringify([...folders].sort()));
    },
  };
}
