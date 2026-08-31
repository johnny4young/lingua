# Lingua CLI

The Lingua CLI is the headless, offline command-line surface for Lingua. It
shares the desktop app's utility adapters, Run Capsule schema, and local
execution contract without loading Electron, React, or renderer code.

## Install

On macOS, Homebrew installs the release-owned CLI archive and its Node 24
runtime without invoking npm:

```bash
brew install johnny4young/tap/lingua-cli
lingua --version
```

Homebrew also installs Bash, Zsh, and Fish completion files automatically.

The npm package remains available on every Node-supported platform and
requires Node.js 24.x:

```bash
pnpm add --global @linguacode/cli
lingua --version
```

Release pages also carry standalone Windows and Linux x64 archives. Those
archives embed the matching Node.js runtime for the CLI itself, so utilities
and Capsule validation do not require a separate Node installation. Running or
replaying JavaScript and TypeScript still requires Node.js 24 on `PATH`; other
languages need their own command-line toolchains. Extract the archive, place
`lingua` or `lingua.exe` on `PATH`, and verify it against the release
`SHA256SUMS.txt` before use.

## Examples

```bash
lingua list utilities
printf 'hello' | lingua utility base64-encode
lingua run ./script.ts -- --name Ada
lingua capsule validate ./run.capsule.json
lingua capsule replay ./run.capsule.json --json
lingua completion                 # detect shells and offer to install completions
```

See the complete command, output, and exit-code contract in
[`docs/CLI_USAGE.md`](https://github.com/johnny4young/lingua/blob/main/docs/CLI_USAGE.md).

## License

Lingua is commercial software made publicly inspectable for evaluation,
security review, and contribution. The package and standalone executables are
distributed under the terms in `LICENSE`; production or commercial use needs
the appropriate Lingua license.
