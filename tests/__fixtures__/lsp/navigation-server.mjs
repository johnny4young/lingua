/** Real stdio fixture; never opens or executes a target file. */
const language = process.argv[2] ?? 'go';
if (process.argv.includes('version') || process.argv.includes('--version')) {
  console.log(
    language === 'go' ? 'golang.org/x/tools/gopls v0.0.0-fixture' : 'rust-analyzer 0.0.0-fixture'
  );
  process.exit(0);
}
let pending = Buffer.alloc(0);
let rootUri;
const documents = new Map();
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } };
function answer(id, result) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
function message(request) {
  if (request.method === 'initialize') {
    rootUri = request.params.rootUri;
    return answer(request.id, {
      capabilities: { definitionProvider: true, referencesProvider: true },
    });
  }
  if (request.method === 'textDocument/didOpen')
    documents.set(request.params.textDocument.uri, request.params.textDocument.text);
  if (request.method === 'textDocument/didChange')
    documents.set(request.params.textDocument.uri, request.params.contentChanges[0].text);
  if (request.method === 'textDocument/didClose') documents.delete(request.params.textDocument.uri);
  if (
    request.method === 'textDocument/definition' ||
    request.method === 'textDocument/references'
  ) {
    if (!rootUri || !documents.has(request.params.textDocument.uri))
      return answer(request.id, null);
    const position = request.params.position;
    const sourceLine = documents.get(request.params.textDocument.uri).split('\n')[position?.line];
    if (!sourceLine || !/[A-Za-z_]/.test(sourceLine[position.character] ?? ''))
      return answer(request.id, null);
    const uri = new URL(
      `helper.${language === 'go' ? 'go' : 'rs'}`,
      rootUri.endsWith('/') ? rootUri : `${rootUri}/`
    ).href;
    const symbol = language === 'go' ? 'Hello' : 'hello';
    const occurrences = (content, targetUri) =>
      content.split('\n').flatMap((line, lineIndex) => {
        const found = [];
        for (let from = 0; ;) {
          const character = line.indexOf(symbol, from);
          if (character < 0) break;
          found.push({
            uri: targetUri,
            range: {
              start: { line: lineIndex, character },
              end: { line: lineIndex, character: character + symbol.length },
            },
          });
          from = character + symbol.length;
        }
        return found;
      });
    const declaration = occurrences(documents.get(uri) ?? '', uri)[0] ?? { uri, range };
    return answer(
      request.id,
      request.method.endsWith('definition')
        ? [
            {
              targetUri: uri,
              targetRange: declaration.range,
              targetSelectionRange: declaration.range,
            },
          ]
        : [
            declaration,
            ...occurrences(
              documents.get(request.params.textDocument.uri),
              request.params.textDocument.uri
            ),
          ]
    );
  }
  if (request.method === 'shutdown') return answer(request.id, null);
  if (request.method === 'exit') process.exit(0);
  if (request.id !== undefined) answer(request.id, null);
}
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  for (;;) {
    const headerEnd = pending.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(
      /Content-Length:\s*(\d+)/i.exec(pending.subarray(0, headerEnd).toString())?.[1]
    );
    if (!Number.isSafeInteger(length) || length < 0 || length > 1024 * 1024) process.exit(1);
    if (pending.length < headerEnd + 4 + length) return;
    const payload = pending.subarray(headerEnd + 4, headerEnd + 4 + length);
    pending = pending.subarray(headerEnd + 4 + length);
    message(JSON.parse(payload.toString()));
  }
});
process.stdin.on('end', () => process.exit(0));
