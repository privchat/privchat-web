import type { Employee, Execution, Node } from './api';
import { usePageLabels } from './page-labels';
import { wsField } from './shell';

const terminal = new Set(['succeeded', 'failed', 'cancelled']);

// Only verified executor names are selectable; arbitrary grants are not executor providers.
// codex / claude / qoder are peers (MODULE_AGENT_SPEC §176).
export function employeeExecutor(capability: string): string | undefined {
  if (capability === 'agent.claude') return 'claude';
  if (capability === 'agent.codex') return 'codex';
  if (capability === 'agent.qoder') return 'qoder';
  return undefined;
}
export function executorDisplay(value: string): string {
  if (value === 'codex') return 'Codex';
  if (value === 'claude') return 'Claude Code';
  if (value === 'qoder') return 'Qoder';
  return value || '—';
}
// Executors the device reports available, revoked ones included: choosing one grants its capability on save
// (WEEY_AGENT_SPEC §9.2.1), and a revoked one stays reachable so the owner can re-authorize it explicitly.
export function availableEmployeeExecutors(node?: Node): string[] {
  return [...new Set((node?.capabilities ?? []).flatMap(c => c.available === true ? employeeExecutor(c.name) ?? [] : []))];
}
/** The models this executor offers on this node now (§7.4); empty when the node reported no catalog. */
export function executorModels(node: Node | undefined, executor: string): {id: string; name?: string}[] {
  return node?.capabilities?.find(c => c.name === `agent.${executor}`)?.models ?? [];
}
export function executorDefaultModel(node: Node | undefined, executor: string): string {
  return node?.capabilities?.find(c => c.name === `agent.${executor}`)?.defaultModel ?? '';
}
/**
 * Choosing the executor chooses its model (WEEY_AGENT_PROTOCOL_SPEC §7.4): a reported catalog is a dropdown whose
 * first item keeps the executor's own default (`model:""`). Only a node without a catalog still takes a typed name.
 * A value the executor no longer offers stays visible as such, never silently turned into the default.
 */
export function ModelField({node, executor, value, disabled, reportedOnly, onChange}: {node?: Node; executor: string; value: string; disabled?: boolean; reportedOnly?: boolean; onChange: (model: string) => void}) {
  const l = usePageLabels();
  const models = executorModels(node, executor);
  const fallback = executorDefaultModel(node, executor);
  const keepDefault = fallback ? l('modelDefaultChoice').replace('{model}', fallback) : l('modelDefaultChoiceUnknown');
  return <label className="grid gap-1.5 text-sm font-medium">{l('modelLabel')}
    {models.length || reportedOnly
      ? <select data-testid="employee-model-select" className={wsField} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">{keepDefault}</option>
        {models.map(m => <option key={m.id} value={m.id}>{m.name && m.name !== m.id ? `${m.name} · ${m.id}` : m.id}</option>)}
        {!!value && !models.some(m => m.id === value) && <option value={value}>{`${value} · ${l('modelNotOffered')}`}</option>}
      </select>
      : <input data-testid="employee-model-input" className={wsField} value={value} maxLength={120} placeholder={l('modelDefault')} disabled={disabled} onChange={e => onChange(e.target.value)}/>}
  </label>;
}
export function bindingCandidates(rows: Execution[], nodeId: string, executor: string, employees: Employee[], model: string, workdirBindingId: string): Execution[] {
  const sessions = new Map<string, Execution[]>();
  for (const row of rows) {
    if (row.nodeId !== nodeId || !row.nativeSessionId?.trim()) continue;
    const turns = sessions.get(row.nativeSessionId) ?? [];
    turns.push(row); sessions.set(row.nativeSessionId, turns);
  }
  const bound = new Set(employees.flatMap(a => a.executionId ?? []));
  return [...sessions.values()].flatMap(turns => {
    // An older terminal turn does not make a busy or employee-owned native session bindable.
    if (turns.some(e => !terminal.has(e.state) || !!e.agentId || bound.has(e.executionId)
      || e.scope?.kind !== 'private' || e.scope.ref !== '')) return [];
    const latest = [...turns].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
    return latest ? [latest] : [];
  }).filter(e => terminal.has(e.state)
    && e.scope?.kind === 'private' && e.scope.ref === '' && !e.agentId
    && e.params?.model === model && e.params?.workdirBindingId === workdirBindingId
    && employeeExecutor(e.capability ?? '') === executor)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
