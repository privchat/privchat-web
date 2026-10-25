import {useState, type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import type {Project, TaskScope, WorkspaceActivity, WorkspaceApi} from './api';
import {TaskFeed} from './task-feed-view';
import {WorkDetails} from './work-details';
import {usePageLabels} from './page-labels';

/** History permissions are enforced per workspace by the read API, not project ownership. */
export function TaskHistory({api, scope, projects, onBack, renderSession = () => null}: {api: WorkspaceApi; scope: TaskScope; projects?: Project[]; onBack: () => void; renderSession?: (id: string) => ReactNode}) {
  const l = usePageLabels();
  const [detail, setDetail] = useState<WorkspaceActivity>();
  const [locked, setLocked] = useState(false);
  return <section className="space-y-3" data-testid="task-history">
    <header><Button variant="ghost" disabled={locked} onClick={onBack}>{l('back')}</Button><h2>{l('taskRecords')}</h2></header>
    <div hidden={!!detail}><TaskFeed api={api} {...scope} view="history" enabled={!detail} projects={projects} onOpen={setDetail}/></div>
    {detail && <WorkDetails key={detail.item.id} api={api} row={detail} readOnly onBack={() => setDetail(undefined)} renderSession={renderSession} onLockChange={setLocked}/>}
  </section>;
}
