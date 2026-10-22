import { useTranslation } from 'react-i18next';
import type { Binding, Employee, Node, WorkExecution, WorkNote } from './api';
import { availableEmployeeExecutors } from './employees';

export function matchingEmployeeBindings(employee: Employee | undefined, bindings: Binding[], nodes: Node[]) {
  if (!employee) return [];
  return bindings.filter(b => b.revoked === 0 && b.nodeId === employee.nodeId
    && b.capability === `agent.${employee.executor}`
    && availableEmployeeExecutors(nodes.find(n => n.nodeId === b.nodeId && n.state === 'active')).includes(employee.executor));
}

export function ReviewEvidenceFields({links, notes, source, onSource, description, onDescription, evidence, onEvidence, maxDescription = 8000}: {links: WorkExecution[]; notes: WorkNote[]; source: string; onSource: (id: string) => void; description: string; onDescription: (s: string) => void; evidence: string[]; onEvidence: (ids: string[]) => void; maxDescription?: number}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';
  return <>
    <label className="block">{label('reviewSource')}<select className={field} value={source} onChange={e => onSource(e.target.value)}><option value="">{label('reviewSource')}</option>{links.filter(l => l.state === 'succeeded' && l.executionId).map(l => <option key={l.id} value={l.id}>{l.id} · {l.executionId} · {l.state}</option>)}</select></label>
    <p className="text-sm">{label('reviewEvidenceHint')}</p>
    <label className="block">{label('evidenceDescription')}<textarea className={field} maxLength={maxDescription} value={description} onChange={e => onDescription(e.target.value)}/></label>
    {notes.map(n => <label key={n.id} className="flex items-start gap-2"><input type="checkbox" checked={evidence.includes(n.id)} disabled={!evidence.includes(n.id) && evidence.length >= 32} onChange={e => onEvidence(e.target.checked ? [...evidence, n.id] : evidence.filter(id => id !== n.id))}/><span className="min-w-0 break-words">{n.kind} · {n.id} · {n.artifactRef ?? n.body.slice(0, 120)}</span></label>)}
  </>;
}
