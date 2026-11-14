import { test, expect } from '@playwright/test';

const employee = {agentId: 'employee-1', name: 'Alex', title: 'Reviewer', roleDescription: 'Review carefully', nodeId: 'remote-1', executor: 'codex', model: 'configured-model', workdirBindingId: 'repo', config: {}, createdAt: 1};
const execution = {executionId: 'session-1', nodeId: 'remote-1', capability: 'agent.codex', scope: {kind: 'private', ref: ''}, state: 'succeeded', stateVersion: 1, nativeSessionId: 'native-1', updatedAt: 1, createdAt: 1, params: {model: 'configured-model', workdirBindingId: 'repo', title: 'Existing review'}};
const nodes = [{nodeId: 'remote-1', name: 'Remote laptop', state: 'active', granted: ['agent.codex', 'agent.claude', 'code.codex', 'workspace_events_read', 'unknown'], capabilities: [{name: 'agent.codex', available: true}, {name: 'agent.claude', available: true}, {name: 'code.codex', available: true}], workdirs: [{id: 'repo', label: 'Project'}], sessionDiscovery: {external: false, reason: 'executor_discovery_unverified'}}, {nodeId: 'offline', name: 'Offline laptop', state: 'offline', granted: ['agent.codex'], workdirs: []}];

test('employee HTTP adapters keep platform auth, paths and encoded node IDs', async ({page}) => {
  const requests: {path: string; auth: string | undefined; body: unknown}[] = [];
  await page.goto('/');
  await page.route('**/__adapter/app/**', async route => {
    requests.push({path: new URL(route.request().url()).pathname + new URL(route.request().url()).search, auth: route.request().headers().authorization, body: route.request().method() === 'POST' ? route.request().postDataJSON() : null});
    await route.fulfill({json: {code: 0, data: []}});
  });
  await page.evaluate(async () => {
    const {WorkspaceApi} = await import('/src/features/workspace/api.ts');
    const api = new WorkspaceApi(`${location.origin}/__adapter/app`, () => 'token');
    const config = {requestId: 'request-123', name: 'Name', title: 'Title', roleDescription: 'Role', nodeId: 'remote', executor: 'codex', model: 'model', workdirBindingId: 'repo'};
    await api.employees(); await api.createEmployee(config); await api.updateEmployee({...config, agentId: 'a'}); await api.sendEmployee({agentId: 'a', requestId: 'request-456', text: 'hello'}); await api.executions('node/a b');
  });
  expect(requests.map(r => r.path)).toEqual(['/__adapter/app/agent/agents', '/__adapter/app/agent/agents', '/__adapter/app/agent/agents/update', '/__adapter/app/agent/agents/send', '/__adapter/app/agent/executions/list?nodeId=node%2Fa%20b']);
  expect(requests.every(r => r.auth === 'Bearer token')).toBe(true);
});

test('only verified agent capabilities map to executor names', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {employeeExecutor, executorDisplay} = await import('/src/features/workspace/employees.tsx');
    return {
      mapped: ['agent.claude', 'agent.codex', 'agent.qoder', 'code.claude', 'code.codex', 'code.qoder', 'agent.paseo', 'coding'].map(c => employeeExecutor(c) ?? null),
      display: ['codex', 'claude', 'qoder', 'unknown', ''].map(executorDisplay),
    };
  });
  expect(result.mapped).toEqual(['claude', 'codex', 'qoder', null, null, null, null, null]);
  expect(result.display).toEqual(['Codex', 'Claude Code', 'Qoder', 'unknown', '—']);
});

test('binding candidates dedupe native sessions and exclude every busy, unknown or owned session', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async ({execution, employee}) => {
    const {bindingCandidates} = await import('/src/features/workspace/employees.tsx');
    const candidate = (nativeSessionId: string, executionId: string, updatedAt: number, extra = {}) => ({...execution, nativeSessionId, executionId, updatedAt, ...extra});
    const rows = [
      candidate('deduped', 'old', 1), candidate('deduped', 'latest', 10),
      candidate('busy', 'busy-old', 1), candidate('busy', 'busy-new', 2, {state: 'running'}),
      candidate('unknown', 'unknown-old', 1), candidate('unknown', 'unknown-new', 2, {state: 'unknown'}),
      candidate('owned', 'owned-old', 1, {agentId: 'someone'}), candidate('owned', 'owned-new', 2),
      candidate('bound', 'bound-old', 1), candidate('bound', 'bound-new', 2),
      candidate('new-config', 'config-old', 1), candidate('new-config', 'config-new', 2, {params: {...execution.params, model: 'different'}}),
      candidate('unknown-older', 'unknown-before', 1, {state: 'unknown'}), candidate('unknown-older', 'unknown-after', 2),
    ];
    const ids = bindingCandidates(rows.reverse(), 'remote-1', 'codex', [{...employee, executionId: 'bound-old'}], 'configured-model', 'repo').map(e => e.executionId);
    return ids;
  }, {execution, employee});
  expect(result).toEqual(['latest']);
});

test('executor selection lists device-available executors regardless of grant, revoked ones included; unavailable and missing fail closed', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async node => {
    const {availableEmployeeExecutors} = await import('/src/features/workspace/employees.tsx');
    return [
      availableEmployeeExecutors(node),
      availableEmployeeExecutors({...node, granted: []}),
      availableEmployeeExecutors({...node, capabilities: [{name: 'agent.codex', available: false}, {name: 'agent.claude', available: true}]}),
      availableEmployeeExecutors({...node, revokedCapabilities: ['agent.codex']}),
      availableEmployeeExecutors({...node, capabilities: undefined}),
      // Real mac node: only Qoder is logged in; codex/claude report executor_not_logged_in.
      availableEmployeeExecutors({...node, granted: [], capabilities: [{name: 'agent.qoder', available: true, version: 'qoder-cli 1.1.79'}, {name: 'agent.codex', available: false}, {name: 'agent.claude', available: false}]}),
      availableEmployeeExecutors({...node, capabilities: [{name: 'agent.qoder', available: true}], revokedCapabilities: ['agent.qoder']}),
    ];
  }, nodes[0]);
  expect(result).toEqual([['codex', 'claude'], ['codex', 'claude'], ['claude'], ['codex', 'claude'], [], ['qoder'], ['qoder']]);
});

test('each executor carries its own model catalog and default; a missing catalog never invents one', async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async node => {
    const {executorModels, executorDefaultModel} = await import('/src/features/workspace/employees.tsx');
    const catalog = {...node, capabilities: [
      {name: 'agent.codex', available: true, models: [{id: 'gpt-5.6-terra', name: 'Terra'}, {id: 'gpt-6-luna'}], defaultModel: 'gpt-5.6-terra'},
      {name: 'agent.qoder', available: true, models: [{id: 'qoder-max'}], defaultModel: 'qoder-max'},
      {name: 'agent.claude', available: true},
      // Availability is a separate question: a logged-out executor still reports what it would offer.
      {name: 'agent.paseo', available: false, models: [{id: 'paseo-mini'}], defaultModel: 'paseo-mini'},
    ]};
    const read = (target: unknown, executor: string) => [executorModels(target as never, executor).map(m => m.id), executorDefaultModel(target as never, executor)];
    return [read(catalog, 'codex'), read(catalog, 'qoder'), read(catalog, 'claude'), read(catalog, 'paseo'), read(catalog, 'unknown'), read(node, 'codex'), read(undefined, 'codex')];
  }, nodes[0]);
  expect(result).toEqual([
    [['gpt-5.6-terra', 'gpt-6-luna'], 'gpt-5.6-terra'],
    [['qoder-max'], 'qoder-max'],
    [[], ''], [['paseo-mini'], 'paseo-mini'], [[], ''], [[], ''], [[], ''],
  ]);
});
