import { useTranslation } from 'react-i18next';
import type { Binding, WorkExecution, WorkNote } from './api';

/** The workspace authorizations an employee's own device and executor could run under; the server decides the rest. */
export function matchingEmployeeBindings(employee: {nodeId?: string; executor: string} | undefined, bindings: Binding[]) {
  if (!employee?.nodeId) return [];
  return bindings.filter(b => b.revoked === 0 && b.nodeId === employee.nodeId && b.capability === `agent.${employee.executor}`);
}

export function ReviewEvidenceFields({links, notes, employeeName, source, onSource, description, onDescription, evidence, onEvidence, maxDescription = 8000}: {links: WorkExecution[]; notes: WorkNote[]; employeeName: (id?: string | null) => string; source: string; onSource: (id: string) => void; description: string; onDescription: (s: string) => void; evidence: string[]; onEvidence: (ids: string[]) => void; maxDescription?: number}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const field = 'block w-full min-w-0 rounded border bg-background px-3 py-2 text-sm';
  return <>
    <label className="block">{label('reviewSource')}<select className={field} value={source} onChange={e => onSource(e.target.value)}><option value="">{label('reviewSource')}</option>{links.map(l => <option key={l.id} value={l.id}>{employeeName(l.employeeId)} · {l.createdAt ? new Date(l.createdAt).toLocaleString() : label('execution_succeeded')}</option>)}</select></label>
    <p className="text-sm">{label('reviewEvidenceHint')}</p>
    <label className="block">{label('evidenceDescription')}<textarea className={field} maxLength={maxDescription} value={description} onChange={e => onDescription(e.target.value)}/></label>
    {notes.map(n => <label key={n.id} className="flex items-start gap-2"><input type="checkbox" checked={evidence.includes(n.id)} disabled={!evidence.includes(n.id) && evidence.length >= 32} onChange={e => onEvidence(e.target.checked ? [...evidence, n.id] : evidence.filter(id => id !== n.id))}/><span className="min-w-0 break-words">{label(`note_${n.kind}`)} · {n.artifactRef ?? n.body.slice(0, 120)}</span></label>)}
  </>;
}
