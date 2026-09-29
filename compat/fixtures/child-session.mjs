// Run in a fresh process: runner reads getAgentDir(), and upstream's agent registry is global.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

async function main() {
  const [packageDir, workspace, scenario] = process.argv.slice(2);
  process.env.PI_CODING_AGENT_DIR = join(workspace, 'agent');
  const require = createRequire(import.meta.url);
  const hostPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const host = await import(pathToFileURL(hostPath).href);
  const ai = await import('@earendil-works/pi-ai');
  // Resolve jiti from the host's dependencies, not a separately installed test runtime.
  const hostRequire = createRequire(hostPath);
  const { createJiti } = await import(pathToFileURL(hostRequire.resolve('jiti')).href);
  const jiti = createJiti(import.meta.url, {
    moduleCache: true,
    alias: {
      '@earendil-works/pi-coding-agent': hostPath,
      '@earendil-works/pi-ai': fileURLToPath(import.meta.resolve('@earendil-works/pi-ai')),
      '@earendil-works/pi-tui': fileURLToPath(import.meta.resolve('@earendil-works/pi-tui')),
      'typebox': require.resolve('typebox'),
    },
  });
  const runner = await jiti.import(join(packageDir, 'src/agent-runner.ts'));
  const types = await jiti.import(join(packageDir, 'src/agent-types.ts'));
  const cwd = join(workspace, 'project');
  await mkdir(cwd, { recursive: true });
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
  const logPath = join(workspace, 'mcp-requests.log');
  const exposure = scenario === 'nested-native-scope' ? 'codemode'
    : ['hidden', 'deferred', 'codemode', 'codemode-deferred'].includes(scenario) ? scenario : 'direct';
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, 'mcp.json'), JSON.stringify({
    mcpServers: { fixture: {
      command: process.execPath,
      args: [join(dirname(fileURLToPath(import.meta.url)), 'mcp-server.mjs')],
      exposure,
      env: { COMPAT_MCP_LOG: logPath },
    } },
  }));
  if (scenario === 'builtin-disabled') {
    await writeFile(join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({
      extensions: ['-builtin:mcp'],
    }));
  }
  // Test orchestration exclusion with a real discovered extension, not a mocked registry.
  await mkdir(join(process.env.PI_CODING_AGENT_DIR, 'extensions'), { recursive: true });
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, 'extensions', 'scope-fixture.ts'), `
  export default function(pi) {
    for (const name of ['Agent', 'SubagentWorkflow', 'get_subagent_result', 'steer_subagent', 'outside_scope']) {
      pi.registerTool({ name, label: name, description: name,
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{ type: 'text', text: 'should-not-run' }], details: {} }) });
    }
  }
  `);
  const ping = 'mcp__fixture__ping';
  const plain = scenario === 'plain-name';
  const config = {
    name: 'compat-test', description: 'No-model compatibility test',
    builtinToolNames: plain ? ['read', ping] : ['read'],
    extSelectors: plain ? ['ext:builtin:codemode/codemode'] : [
      `ext:builtin:mcp/${ping}`,
      'ext:builtin:codemode/codemode',
      'ext:builtin:tool-search/tool_search',
    ],
    disallowedTools: scenario === 'denylist' ? [ping] : undefined,
    extensions: scenario === 'no-extensions' ? false : true,
    skills: false, persistSession: false,
    systemPrompt: 'Never call a model.', promptMode: 'replace',
  };
  types.registerAgents(new Map([[config.name, config]]));
  runner.setRememberAgents(false);
  const runtime = await host.ModelRuntime.create({
    credentials: new ai.InMemoryCredentialStore(),
    allowModelNetwork: false,
  });
  const model = runtime.getModel('anthropic', 'claude-sonnet-4-5');
  assert.ok(model, 'local model catalog entry must exist; it will never be called');
  const registry = { runtime, find: () => model, getAvailable: () => [model] };
  const sentinel = new Error('STOP_BEFORE_PROMPT');
  const activities = [];
  let session;
  try {
    await assert.rejects(runner.runAgent({
      cwd, model, modelRegistry: registry, getSystemPrompt: () => '',
    }, config.name, 'This prompt must never run', {
      pi: { exec: async () => ({ code: 1, stdout: '', stderr: '', killed: false }) },
      isolated: scenario === 'isolated',
      onToolActivity: (activity) => activities.push(activity),
      onSessionCreated: (child) => {
        session = child;
        // Synchronous throw stops actual runAgent before its first session.prompt().
        throw sentinel;
      },
    }), (error) => error === sentinel);
    assert.ok(session, 'actual upstream runner must create an SDK child session');
    assert.equal(session.messages.length, 0, 'capture must happen before any prompt or model request');
    if (scenario === 'builtin-disabled') {
      assert.equal(session.getToolDefinition(ping), undefined, 'settings exclusion must disable native MCP');
      assert.ok(session.getActiveToolNames().includes('read'));
      await assert.rejects(access(logPath), { code: 'ENOENT' }, 'disabled built-in must not start an MCP server');
      return;
    }
    if (scenario === 'isolated' || scenario === 'no-extensions') {
      assert.deepEqual(session.getActiveToolNames(), ['read']);
      assert.equal(session.getToolDefinition(ping), undefined);
      assert.equal(session.getToolDefinition('codemode'), undefined);
      await assert.rejects(access(logPath), { code: 'ENOENT' }, 'disabled extensions must not start an MCP server');
      return;
    }
    // Execute only extension startup hooks. Native MCP's bounded startup barrier awaits
    // registrations; this does not construct a provider request or invoke prompt().
    await session.extensionRunner.emitBeforeAgentStart('', undefined, { cwd, selectedTools: ['read'] });
    assert.match(await readFile(logPath, 'utf8'), /tools\/list/, 'native MCP must complete fixture discovery');
    // Deliver a turn_end to the real runner-installed scope subscriber without a model turn.
    // This is the sole private SDK seam in the harness; scope/loader/registry are not replaced.
    session._emit({ type: 'turn_end', message: {}, toolResults: [] });
    const active = session.getActiveToolNames();
    const callable = session.getCallableToolNames();
    assert.ok(active.includes('read'), 'selected plain builtin must remain active');
    assert.ok(!active.includes('bash'), 'unselected plain builtin must stay inactive');
    for (const name of ['Agent', 'SubagentWorkflow', 'get_subagent_result', 'steer_subagent', 'outside_scope']) {
      assert.ok(!active.includes(name), `${name} must not be declared in child scope`);
      const guard = await session.agent.beforeToolCall({ toolCall: { name, arguments: {}, id: 'scope-check' } });
      assert.equal(guard?.block, true, `${name} must be blocked at call time`);
    }
    if (scenario === 'denylist') {
      assert.equal(session.getToolDefinition(ping), undefined, 'denylist must gate native late registration');
      assert.ok(!callable.includes(ping));
    } else if (plain) {
      assert.ok(activities.some(({ toolName }) => toolName.includes('not a known built-in') && toolName.includes(ping)), 'plain MCP name must be diagnosed as an invalid builtin');
      assert.ok(!active.includes(ping), 'plain names do not select native MCP tools');
      const guard = await session.agent.beforeToolCall({ toolCall: { name: ping, arguments: {}, id: 'plain-check' } });
      assert.equal(guard?.block, true);
    } else if (scenario === 'hidden') {
      assert.ok(!active.includes(ping), 'hidden tools must not be declared');
      assert.ok(!callable.includes(ping), 'hidden tools must not be callable');
      const search = await session.getToolDefinition('tool_search').execute('hidden-search', { query: 'ping', limit: 1 });
      assert.deepEqual(search.details.loaded, [], 'hidden tools must not be discoverable through tool_search');
    } else {
      assert.ok(session.getToolDefinition(ping), 'native MCP must register the real fixture tool');
      assert.equal(active.includes(ping), exposure === 'direct', `${exposure} exposure must survive runner renarrow`);
      assert.ok(callable.includes(ping), `${exposure} MCP tool must remain callable`);
      if (exposure.startsWith('codemode')) assert.ok(active.includes('codemode'));
      if (exposure === 'deferred') assert.ok(active.includes('tool_search'));
      const guard = await session.agent.beforeToolCall({ toolCall: { name: ping, arguments: { message: scenario }, id: 'compat-call' } });
      assert.ok(!guard?.block, 'native MCP invocation must be in child scope');
      const context = session.extensionRunner.createToolContext('compat-call', undefined);
      // Invoke the SDK's actual registered native tool. Nested ctx.executeTool requires
      // an assistant-issued call; direct definition invocation avoids fabricating a model turn.
      const result = await session.getToolDefinition(ping).execute('compat-call', { message: scenario }, undefined, undefined, context);
      assert.deepEqual(result.content, [{ type: 'text', text: `pong:${scenario}` }]);
      if (exposure === 'deferred') {
        const search = await session.getToolDefinition('tool_search').execute('deferred-search', { query: 'ping', limit: 1 });
        assert.deepEqual(search.details.loaded, [ping], 'native search must discover the deferred fixture tool');
        assert.ok(session.getActiveToolNames().includes(ping), 'explicitly searched deferred tool must become declared');
        session._emit({ type: 'turn_end', message: {}, toolResults: [] });
        assert.ok(session.getActiveToolNames().includes(ping), 'scope renarrow must preserve authorized native search activation');
      }
    }
    assert.equal(session.messages.some((message) => message.role === 'assistant'), false, 'no model response must exist');
    if (scenario === 'nested-native-scope') {
      const mutation = 'mcp__fixture__mutate';
      assert.ok(session.getToolDefinition(mutation), 'unselected mutation must be genuinely registered by native MCP');
      assert.ok(session.getCallableToolNames().includes(mutation), 'codemode exposure must reach the native nested-call permission pipeline');
      assert.ok(!session.getActiveToolNames().includes(mutation), 'unselected mutation must not be model-declared');
      assert.ok(session.getActiveToolNames().includes('codemode'), 'parent codemode tool must be selected');
      let providerRequests = 0;
      session.agent.streamFunction = () => {
        providerRequests++;
        throw new Error('Fixture must never request a model');
      };
      // Public session/agent APIs supply fixture transcript data, not a provider response.
      // Native nested calls need an assistant-issued parent toolCall in the current transcript.
      const parentId = 'fixture-codemode-parent';
      const assistant = {
        role: 'assistant', content: [{ type: 'toolCall', id: parentId, name: 'codemode', arguments: {} }],
        api: model.api, provider: model.provider, model: model.id, stopReason: 'toolUse', timestamp: 0,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      session.sessionManager.appendMessage(assistant);
      session.agent.state.messages = [...session.agent.state.messages, assistant];
      const context = session.extensionRunner.createToolContext(parentId, undefined);
      // This is the real SDK nested runner, not a manual beforeToolCall guard invocation.
      const allowed = await context.executeTool(ping, { message: 'nested-scope' });
      assert.equal(allowed.isError, false, 'selected native ping must execute through the same nested pipeline');
      assert.deepEqual(allowed.result.content, [{ type: 'text', text: 'pong:nested-scope' }]);
      const blocked = await context.executeTool(mutation, {});
      assert.equal(blocked.isError, true, 'native nested mutation must be denied despite codemode callable exposure');
      assert.match(JSON.stringify(blocked.result.content), /not available to this subagent/, 'scope guard, not missing assistant context or unknown tool, must deny mutation');
      const calls = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
        .filter((request) => request.method === 'tools/call');
      assert.ok(calls.some((request) => request.params.name === 'ping' && request.params.arguments.message === 'nested-scope'), 'selected nested ping must reach MCP transport');
      assert.equal(calls.filter((request) => request.params.name === 'mutate').length, 0, 'blocked mutation must send no MCP tools/call request');
      assert.equal(providerRequests, 0, 'synthetic parent context must never trigger a provider request');
      assert.deepEqual(session.messages, [assistant], 'only the synthetic assistant fixture may enter the transcript');
    }
  } finally {
    if (session) {
      await session.extensionRunner?.emit({ type: 'session_shutdown' });
      session.dispose();
    }
  }
}
await main();
