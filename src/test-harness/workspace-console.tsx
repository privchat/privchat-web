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

import { WorkspaceConsole } from '@/features/workspace/console';
import type { PrivchatClient } from '@privchat/sdk';

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
