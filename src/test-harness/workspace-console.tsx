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

import { WorkspacePage } from '@/features/workspace/workspace-page';
import { EmployeePanel } from '@/features/workspace/employees';
import type { PrivchatClient } from '@privchat/sdk';
import { DevicePage } from '@/features/workspace/devices';
import { AssistantPage } from '@/features/workspace/assistant';
import { WorkItemPanel } from '@/features/workspace/work-item';
import { WorkflowPanel } from '@/features/workspace/workflow';
import type { Binding, Node, WorkItem, WorkNote } from '@/features/workspace/api';

/** Full module fixture. The hash is set before render, exactly like a deep link or refresh. */
export function mountWorkspacePage(baseUrl: string, hash = '#/workspace', client?: PrivchatClient, accountKey?: string | null) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  host.className = 'mx-auto max-w-3xl p-3';
  location.hash = hash;
  const root = createRoot(host);
  root.render(<WorkspacePage api={new WorkspaceApi(baseUrl, () => 'test')} client={client} accountKey={accountKey} renderSession={id => <p data-testid="focused-session">{id}</p>} onLockChange={locked => {host.dataset.locked = String(locked);}}/>);
  return () => {root.unmount(); host.remove();};
}

/** Standalone employee panel fixture with the production node refresh and managed session console. */
export function mountEmployeePanel(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  host.className = 'mx-auto max-w-3xl p-3';
  const api = new WorkspaceApi(baseUrl, () => 'test');
  const root = createRoot(host);
  const render = (nodes: Node[]) => root.render(<EmployeePanel api={api} nodes={nodes} refreshNodes={async () => {render(await api.nodes());}} renderSession={id => <SessionConsole key={id} api={api} executionId={id} employeeManaged/>} onRequestLockChange={locked => {host.dataset.locked = String(locked);}}/>);
  render([]);
  void api.nodes().then(render).catch(() => {});
  return () => {root.unmount(); host.remove();};
}

export const normalRoomCalls: string[] = [];
let normalRoomListener: Parameters<PrivchatClient['observeEvents']>[0] | undefined;
let normalRoomUnmount: (() => void) | undefined;
export function emitNormalRoomEvent(event: unknown) {normalRoomListener?.({event} as never);}
export function unmountNormalWorkspaceConsole() {normalRoomUnmount?.(); normalRoomUnmount = undefined;}
/** The production page with a recording room transport, so tests observe real subscribe/snapshot ordering. */
export function mountNormalWorkspaceConsole(baseUrl: string) {
  unmountNormalWorkspaceConsole(); normalRoomCalls.length = 0;
  const client = {
    sessionSnapshot: () => ({user_id: 'fixture'}),
    subscribeChannel: async (id: string) => {normalRoomCalls.push(`subscribe:${id}`);},
    unsubscribeChannel: async (id: string) => {normalRoomCalls.push(`unsubscribe:${id}`);},
    observeEvents: (listener: Parameters<PrivchatClient['observeEvents']>[0]) => {
      normalRoomCalls.push('observe'); normalRoomListener = listener;
      return () => {normalRoomCalls.push('off'); if (normalRoomListener === listener) normalRoomListener = undefined;};
    },
  } as unknown as PrivchatClient;
  normalRoomUnmount = mountWorkspacePage(baseUrl, '#/workspace', client);
}

export function mountDevicePage(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<DevicePage api={new WorkspaceApi(baseUrl, () => 'test')} onBack={() => {}}/>);
}
export function mountAssistantPage(baseUrl: string) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  const client = {
    sessionSnapshot: () => ({user_id: 'fixture'}),
    bootstrapChannels: async () => {host.dataset.sdkLoaded = 'true'; return [];},
  } as unknown as PrivchatClient;
  createRoot(host).render(<AssistantPage api={new WorkspaceApi(baseUrl, () => 'test')} client={client} onBack={() => {}}
    onSelect={(channelId, channelType, peer) => {host.dataset.chat = JSON.stringify({channelId, channelType, peer});}}/>);
}
export function mountWorkItem(baseUrl: string, item: WorkItem, notes: WorkNote[]) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<WorkItemPanel api={new WorkspaceApi(baseUrl, () => 'test')} item={item} notes={notes} readOnly={false} refresh={async () => {}}/>);
}
export function mountWorkflow(baseUrl: string, item: WorkItem, nodes: Node[], bindings: Binding[], notes: WorkNote[]) {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  createRoot(host).render(<WorkflowPanel api={new WorkspaceApi(baseUrl, () => 'test')} item={item} nodes={nodes} bindings={bindings} notes={notes} readOnly={false} onLockChange={locked => {host.dataset.locked = String(locked);}} onExecution={id => {host.dataset.execution = id;}}/>);
}
