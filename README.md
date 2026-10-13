<img src="buildAssets/installer/icon.png" alt="" width="128" height="128">

# DaruDB Studio

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jooy2/darudb-studio/blob/main/LICENSE) [![app-test](https://github.com/jooy2/darudb-studio/actions/workflows/app-test.yml/badge.svg)](https://github.com/jooy2/darudb-studio/actions/workflows/app-test.yml)

**A desktop app to open, browse and edit [DaruDB](https://darudb.cdget.com) database files.**

DaruDB keeps an application's data in one local file. DaruDB Studio is the app for looking inside that file: open it, read its collections and objects, and change them, without writing a program to do it. It runs on Windows, macOS and Linux, and reads the same file whichever language wrote it.

> DaruDB Studio is in early development, and not released yet.

## What it does

- **Projects.** A project gives a database file a name, and remembers its path and, if you ask, its encryption key, which the operating system's keystore keeps encrypted. A file of any extension can be picked; the app checks that it is a DaruDB database before keeping it.
- **Opening a file.** An encrypted file asks for its encryption key when none is remembered or the remembered one no longer opens it. A file in an older format version is opened on a copy the app makes and raises, or raised in place, as you choose.
- **A sample.** The project list opens a sample database of a small shop, with objects of every kind of field, to try the app on. Each one is a new file in the app's own folder, deleted with its project when the app quits.
- **The schema.** The sidebar lists the collections the file holds, with how many objects each has, their fields and types, the key and the indexes. The app reads the schema from the file itself, so it opens a file whatever program wrote it.
- **The objects.** Each collection opens in a grid that reads its objects a page at a time, so a large collection scrolls as fast as a small one. Columns sort and resize, a filter takes the query language, and rows are selected with the mouse and the keyboard as in a desktop table. Values are coloured by type, and lists and embedded objects open in place or in a dialog.
- **Editing.** A field of one value is edited in its cell, as in a spreadsheet, and a whole object in a dialog. Edits are written at once, or held until you submit them from the toolbar, as the settings say.
- **Queries and tools.** A query tab runs a query written whole, sort and limit included. The tools tab checks the file's integrity, compacts it and writes a backup.
- **Tabs and windows.** Tabs split into groups side by side, move between them and merge again. Each window opens one project, and a project opens in one window at a time. The app runs once: starting it again opens another window in the one already running. When the settings ask, the app opens the windows, projects and tabs it had open when it last quit.
- **Menus.** The macOS menu bar and a menu bar in every window list the same menus. The app draws each window's title bar itself, and its menu bar shows every menu in a row, or folds behind one button at the top right.
- **Startup.** When the settings ask, the system opens the app as you log in. The app draws with hardware acceleration unless the settings turn it off.

## How it is built

The app is an [Electron](https://www.electronjs.org) app with a [React](https://react.dev) interface drawn with [Plass UI](https://plass.cdget.com). Databases are opened with the [`darudb`](https://www.npmjs.com/package/darudb) package in the main process, since a renderer is sandboxed and cannot load a native addon. The app keeps its own settings in a DaruDB file as well, `studio.darudb` in the user data folder.

| Path           | What it is                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `src/main`     | The main process: windows, menus, IPC, and the files the app opens         |
| `src/preload`  | The bridge the renderer reaches the main process through, `window.mainApi` |
| `src/renderer` | The interface, in React                                                    |
| `src/common`   | What every process shares: the IPC contract, types and the translations    |
| `tests`        | Tests that drive the built app with Playwright, and tests of plain modules |
| `buildAssets`  | The electron-builder configuration and the app icons                       |

## Development

Node.js 22.12 or later.

```bash
npm install
npm run dev
```

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | Starts the app with hot reloading                                  |
| `npm test`          | Builds the app and runs the end-to-end tests                       |
| `npm run lint`      | Checks the code with ESLint                                        |
| `npm run format`    | Checks the formatting with Prettier                                |
| `npm run build`     | Packages the app for the current platform into `release/<version>` |
| `npm run build:dir` | Packages the app without an installer, which is faster to check    |

The tests keep every window off the screen and the app out of the macOS Dock, so they can run while you work. Each run uses a user data folder of its own and removes it afterwards.

## Contributing

Bug reports, feature requests and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) is the conduct this project holds itself to. For anything with a security impact, do **not** open an issue; [SECURITY.md](SECURITY.md) has the private route.

## License

[MIT](LICENSE) © [CDGet](https://cdget.com)

The licenses of the open source packages the app ships are written to `THIRD_PARTY_NOTICES.txt` when it is built, which the app shows from its `Help` menu.
