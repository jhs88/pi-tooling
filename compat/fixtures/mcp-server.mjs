// Deterministic stdio MCP server. No sockets, credentials, SDK, or external services.
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  appendFileSync(process.env.COMPAT_MCP_LOG, `${JSON.stringify(request)}\n`);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case 'initialize':
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'compat-fixture', version: '1.0.0' },
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = { tools: [{
        name: 'ping', description: 'Return a deterministic local pong.',
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
      }, {
        name: 'mutate', description: 'Perform a local fixture mutation; must never run outside selected scope.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }] };
      break;
    case 'tools/call':
      if (!['ping', 'mutate'].includes(request.params.name)) throw new Error('Unexpected fixture tool');
      result = { content: [{ type: 'text', text: request.params.name === 'ping' ? `pong:${request.params.arguments.message}` : 'mutation-executed' }] };
      break;
    default:
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })}\n`);
      return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
