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

## Browser and desktop behavior

Desktop selection uses Electron's capability-scoped filesystem bridge. The web
app uses the browser directory-picker API when it is available. A browser that
does not expose that API keeps single-file and paste import available and shows
an explanatory notice for folder selection.
