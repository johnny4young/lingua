#!/usr/bin/env node
/* global Buffer, process */
import net from 'node:net';

if (process.argv[2] === 'version') {
  process.stdout.write('Delve Debugger\nVersion: 0.0.0-lingua-fixture\n');
  process.exit(0);
}
if (process.argv[2] !== 'dap') process.exit(2);

const server = net.createServer(socket => {
  let buffer = Buffer.alloc(0);
  let sequence = 1;
  let launchRequest = null;
  let sourcePath = '';
  let currentLine = 4;

  const send = message => {
    const payload = JSON.stringify({ seq: sequence++, ...message });
    socket.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  };
  const respond = (request, body = {}) =>
    send({
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: true,
      body,
    });
  const stopped = reason =>
    send({ type: 'event', event: 'stopped', body: { reason, threadId: 1 } });

  const dispatch = request => {
    switch (request.command) {
      case 'initialize':
        respond(request, { supportsConfigurationDoneRequest: true });
        break;
      case 'launch':
        launchRequest = request;
        send({ type: 'event', event: 'initialized', body: {} });
        break;
      case 'setBreakpoints': {
        sourcePath = request.arguments?.source?.path ?? sourcePath;
        const requested = request.arguments?.breakpoints ?? [];
        if (Number.isInteger(requested[0]?.line)) currentLine = requested[0].line;
        respond(request, {
          breakpoints: requested.map(item => ({ verified: true, line: item.line })),
        });
        break;
      }
      case 'configurationDone':
        respond(request);
        if (launchRequest) respond(launchRequest);
        stopped('breakpoint');
        break;
      case 'stackTrace':
        respond(request, {
          stackFrames: [
            { id: 7, name: 'main.main', line: currentLine, source: { path: sourcePath } },
          ],
        });
        break;
      case 'scopes':
        respond(request, {
          scopes: [
            { name: 'Locals', presentationHint: 'locals', variablesReference: 10 },
            { name: 'Arguments', presentationHint: 'arguments', variablesReference: 11 },
          ],
        });
        break;
      case 'variables':
        respond(request, {
          variables:
            request.arguments?.variablesReference === 10
              ? [{ name: 'value', value: '2' }]
              : [],
        });
        break;
      case 'evaluate':
        respond(request, { result: '4', variablesReference: 0 });
        break;
      case 'next':
      case 'stepIn':
      case 'stepOut':
        currentLine += 1;
        respond(request);
        stopped('step');
        break;
      case 'continue':
        respond(request, { allThreadsContinued: true });
        send({ type: 'event', event: 'output', body: { category: 'stdout', output: 'result 2\n' } });
        send({ type: 'event', event: 'terminated', body: {} });
        break;
      case 'terminate':
        respond(request);
        socket.end();
        server.close(() => process.exit(0));
        break;
      default:
        send({
          type: 'response',
          request_seq: request.seq,
          command: request.command,
          success: false,
          message: `Unsupported fixture command: ${request.command}`,
        });
    }
  };

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match) process.exit(3);
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const request = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
      buffer = buffer.subarray(start + length);
      dispatch(request);
    }
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') process.exit(4);
  process.stdout.write(`DAP server listening at: 127.0.0.1:${address.port}\n`);
});
