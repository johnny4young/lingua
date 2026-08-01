# Importing external work

Lingua keeps imports confirm-first: external data is parsed into a read-only
preview, warnings describe any lossy conversion, and no workspace state changes
until you choose **Import**.

## HTTP requests and collections

The Import overlay accepts:

- cURL commands;
- Postman Collection v2.1 JSON, optionally paired with environment or globals
  exports;
- individual Bruno requests in classic `.bru` or OpenCollection YAML; and
- Bruno collection folders containing `bruno.json` or `opencollection.yml` at
  the root.

For Bruno folders, Lingua supports classic and OpenCollection request files in
the same collection. Folder names prefix request names in the flat HTTP request
list. The importer reads through the capability-scoped filesystem bridge,
limits a collection to 500 candidate files, 4 MiB of source, and 100 imported
requests, and releases the temporary folder capability after every attempt.

Lingua does not read Bruno `environments/` files or hidden files. It does not
execute imported scripts, tests, or assertions; the preview warns when these
are omitted. Unsupported auth helpers, multipart bodies, and request settings
also remain explicit warnings rather than silently changing a request. Review
unresolved variables and warnings before confirming.

Bruno documents the current folder layouts and migration-compatible mixed
formats in its [OpenCollection overview](https://docs.usebruno.com/opencollection-yaml/overview).

## Notebooks

The overlay imports Jupyter `.ipynb` v4 documents and Lingua `.linguanb`
documents. Jupyter imports may be lossy where the source contains unsupported
raw cells or rich outputs; `.linguanb` is Lingua's lossless notebook format.

## Playground share URLs

The Import overlay accepts share links from two providers with documented,
closed source contracts:

- **TypeScript Playground** (`typescriptlang.org/play`): Lingua decodes the
  [`#code/` or legacy `#src=` fragment](https://www.typescriptlang.org/play/handbook/URLs.html)
  locally. Its decoder stops before materializing output beyond the import
  ceiling, then verifies the exact UTF-8 byte length. The URL and source never
  leave the device.
- **Go Playground** (`go.dev/play/p/...` or `play.golang.org/p/...`): Lingua
  extracts only the opaque snippet id and requests
  `https://play.golang.org/p/{id}.go`, the official plain-text endpoint defined
  by the [Go Playground server](https://github.com/golang/playground/blob/master/edit.go).

Both paths stop at a read-only preview. Lingua creates one code tab only after
confirmation and never includes the URL or source in telemetry. Go requests
omit credentials and referrers, reject redirects, time out after seven seconds,
require a plain-text response, and enforce the 512 KiB limit both from
`Content-Length` and while streaming the body.

CodePen and JSFiddle project URLs are not accepted. Neither provider exposes a
stable public read API that fits this fixed-origin browser contract; use the
provider's export flow and import the resulting files instead. Lingua does not
route playground URLs through a generic server proxy.

## Run Capsules and Capsule Workspaces

The Capsule import overlay accepts both the stable single-source
`RunCapsuleV1` JSON and the additive `CapsuleWorkspaceV1` JSON. Both stop at a
read-only preview. The primary source opens only after confirmation; a Capsule
Workspace's supplemental files appear in a separate Files tab and open one at
a time without execution.

Capsule Workspaces are assembled locally from open code tabs selected by the
exporter. They contain portable relative paths only, never filesystem
capability identifiers or absolute host paths. The shared parser enforces 24
supplemental files, 256 KiB per file, 2 MiB total supplemental source, and a
6 MiB artifact cap. See [`CAPSULE_WORKSPACES.md`](./CAPSULE_WORKSPACES.md) for
the privacy review, integrity, and CLI boundaries.

## Browser and desktop behavior

Desktop selection uses Electron's capability-scoped filesystem bridge. The web
app uses the browser directory-picker API when it is available. A browser that
does not expose that API keeps single-file and paste import available and shows
an explanatory notice for folder selection.
