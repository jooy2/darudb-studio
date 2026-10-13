<img src="buildAssets/installer/icon.png" alt="" width="128" height="128">

# DaruDB Studio

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/jooy2/darudb-studio/blob/main/LICENSE) [![app-test](https://github.com/jooy2/darudb-studio/actions/workflows/app-test.yml/badge.svg)](https://github.com/jooy2/darudb-studio/actions/workflows/app-test.yml)

**A desktop app to open, browse and edit [DaruDB](https://darudb.cdget.com) database files.**

DaruDB keeps an application's data in one local file. DaruDB Studio is the app for looking inside that file: open it, read its collections and objects, and change them, without writing a program to do it. It runs on Windows, macOS and Linux, and reads the same file whichever language wrote it.

> DaruDB Studio is in early development. The app starts and keeps its own settings, but it does not open a database file yet.

## How it is built

The app is an [Electron](https://www.electronjs.org) app with a [React](https://react.dev) interface drawn with [Plass UI](https://plass.cdget.com). Databases are opened with the [`darudb`](https://www.npmjs.com/package/darudb) package in the main process, since a renderer is sandboxed and cannot load a native addon. The app keeps its own settings in a DaruDB file as well, `studio.darudb` in the user data folder.

| Path           | What it is                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `src/main`     | The main process: windows, IPC handlers and the app's settings file        |
| `src/preload`  | The bridge the renderer reaches the main process through, `window.mainApi` |
| `src/renderer` | The interface, in React                                                    |
| `src/common`   | What every process shares: the IPC contract, types and the translations    |
| `tests`        | End-to-end tests that drive the built app with Playwright                  |
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
