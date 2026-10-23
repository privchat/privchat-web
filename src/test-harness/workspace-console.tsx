import { createRoot } from 'react-dom/client';
import { SessionConsole } from '@/features/workspace/console';
import { WorkspaceApi } from '@/features/workspace/api';
import '@/i18n';

/** Browser component fixture. Uses the production component and HTTP adapter. */
export function mountSessionConsole(baseUrl: string) {
  const host=document.createElement('div'); document.body.append(host);
  const root=createRoot(host);
  root.render(<SessionConsole api={new WorkspaceApi(baseUrl,()=> 'test')} executionId="1"/>);
  return ()=>{root.unmount();host.remove();};
}

/** Re-render the same exported component to exercise execution-switch response fencing. */
export function mountRecordsConsole(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  const root = createRoot(host);
  const api = new WorkspaceApi(baseUrl, () => 'test');
  const select = (executionId: string) => root.render(<SessionConsole api={api} executionId={executionId}/>);
  select('1');
  return select;
}

import { WorkspaceConsole } from '@/features/workspace/console';
import type { PrivchatClient } from '@privchat/sdk';
import { DevicePage } from '@/features/workspace/devices';
import { AssistantPage } from '@/features/workspace/assistant';
import { WorkItemPanel } from '@/features/workspace/work-item';
import { WorkflowPanel } from '@/features/workspace/workflow';
import type { Binding, Node, WorkItem, WorkNote } from '@/features/workspace/api';

export const workspaceSubscriptions: string[] = [];
export function mountWorkspaceConsole(baseUrl: string) {
  const host=document.createElement('div');document.body.append(host);
  const client={
    sessionSnapshot:()=>({user_id:'fixture'}),
    observeEvents:()=>()=>{},
    subscribeChannel:async(id:string)=>{workspaceSubscriptions.push(`join:${id}`);},
    unsubscribeChannel:async(id:string)=>{workspaceSubscriptions.push(`leave:${id}`);},
  } as unknown as PrivchatClient;
  const root=createRoot(host);
  root.render(<WorkspaceConsole client={client} api={new WorkspaceApi(baseUrl,()=> 'test')} open onOpenChange={()=>{root.unmount();host.remove();}}/>);
}

export function mountDevicePage(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<DevicePage api={new WorkspaceApi(baseUrl, () => 'test')} onBack={() => {}}/>);
}
export function mountAssistantPage(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<AssistantPage api={new WorkspaceApi(baseUrl, () => 'test')} onBack={() => {}} onConsole={reference => {host.dataset.reference = JSON.stringify(reference);}} onLockChange={locked => {host.dataset.locked = String(locked);}}/>);
}
export function mountWorkItem(baseUrl: string, item: WorkItem, notes: WorkNote[]) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<WorkItemPanel api={new WorkspaceApi(baseUrl, () => 'test')} item={item} notes={notes} readOnly={false} refresh={async () => {}}/>);
}
export function mountWorkflow(baseUrl: string, item: WorkItem, nodes: Node[], bindings: Binding[], notes: WorkNote[]) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<WorkflowPanel api={new WorkspaceApi(baseUrl, () => 'test')} item={item} nodes={nodes} bindings={bindings} notes={notes} readOnly={false} onLockChange={locked => {host.dataset.locked = String(locked);}} onExecution={id => {host.dataset.execution = id;}}/>);
}
