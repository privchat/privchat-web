import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getActiveAccessToken } from '@/lib/active-access-token';
import { loadSession } from '@/lib/session-storage';
import { getPlatformBaseUrl } from '@/lib/account-mode';
import { WorkspaceApi, type Binding, type Command, type Execution, type Node, type NodeEvent, type Permission, type WorkExecution, type WorkItem, type WorkNote, type Workspace } from './api';
import { WorkspaceRoomObserver, roomFailure, type RoomState } from './room-observer';
import { permissionDetails } from './permission-details';
import { PlatformApiError, PlatformHttpError } from '@/lib/platform-errors';

const field = 'block min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm';
/** Keep the same ID and body until a response is received. A lost response is not permission to create new work. */
/** System-range envelope codes (busy / timeout / database …), network loss and protocol errors leave the outcome unknown. */
function definiteRejection(e: unknown): boolean {
  if (e instanceof PlatformApiError) return e.code === 401 || e.code === 403 || e.code >= 1000;
  return e instanceof PlatformHttpError && (e.status === 401 || e.status === 403);
}
export class ConsoleIntent {
  private pending?: {path: string; body: Record<string, unknown>};
  async run<T>(api: WorkspaceApi, path: string, body: Record<string, unknown>, idKey = 'commandId'): Promise<T> {
    this.pending ??= {path, body: {...body, [idKey]: crypto.randomUUID()}};
    if (this.pending.path !== path || Object.keys(this.pending.body).length !== Object.keys(body).length+1 || Object.entries(body).some(([k,v]) => JSON.stringify(this.pending!.body[k]) !== JSON.stringify(v))) throw new Error('Retry the original request');
    let result: T;
    try { result = await api.post<T>(this.pending.path, this.pending.body); }
    catch (e) {
      // A definite rejection created nothing, so the user may correct the input; unknown outcomes keep the key.
      if (definiteRejection(e)) this.pending = undefined;
      throw e;
    }
    this.pending = undefined;
    return result;
  }
  get hasPending(): boolean { return this.pending !== undefined; }
}

export function WorkspaceConsole({client, open, onOpenChange, api}: {client: PrivchatClient; open: boolean; onOpenChange: (open: boolean) => void; api?: WorkspaceApi}) {
  const {t} = useTranslation();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92dvh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-3xl">
      <DialogTitle>{t('agentWorkspace.title')}</DialogTitle>
      <DialogDescription>{t('agentWorkspace.permissionHint')}</DialogDescription>
      {open && <ConsoleBody key={client.sessionSnapshot().user_id} client={client} providedApi={api} />}
    </DialogContent>
  </Dialog>;
}

function ConsoleBody({client,providedApi}: {client: PrivchatClient; providedApi?: WorkspaceApi}) {
  const {t} = useTranslation();
  // Provider is scoped to this mounted account, not a global token that could switch owners.
  const api = useMemo(() => {
    if (providedApi) return providedApi;
    const uid = client.sessionSnapshot().user_id;
    return new WorkspaceApi(getPlatformBaseUrl() ?? '', () => client.sessionSnapshot().user_id === uid && loadSession()?.user_id === uid ? getActiveAccessToken() : null);
  }, [client,providedApi]);
  const [spaces,setSpaces] = useState<Workspace[]>([]);
  const [nodes,setNodes] = useState<Node[]>([]);
  const [space,setSpace] = useState('');
  const [node,setNode] = useState('');
  const [items,setItems] = useState<WorkItem[]>([]);
  const [bindings,setBindings] = useState<Binding[]>([]);
  const [executions,setExecutions] = useState<Execution[]>([]);
  const [notes,setNotes] = useState<WorkNote[]>([]);
  const [selected,setSelected] = useState('');
  const [item,setItem] = useState('');
  const [binding,setBinding] = useState('');
  const [bindingNode,setBindingNode] = useState('');
  const [bindingCapability,setBindingCapability] = useState('');
  const [name,setName] = useState('');
  const [prompt,setPrompt] = useState('');
  const [model,setModel] = useState('');
  const [workdir,setWorkdir] = useState('');
  const [capability,setCapability] = useState('');
  const [delegation,setDelegation] = useState<string[]>([]);
  const targets = (space ? bindings.filter(b=>b.revoked===0).map(b=>({nodeId:b.nodeId,capability:b.capability})) : nodes.filter(n=>n.state==='active').flatMap(n=>n.granted.map(capability=>({nodeId:n.nodeId,capability})))).filter(x=>x.capability!=='workspace_events_read');
  const targetKey = (x:{nodeId:string;capability:string}) => `${x.nodeId}:${x.capability}`;
  const [error,setError] = useState(false);
  const [busy,setBusy] = useState(false);
  const [roomState,setRoomState] = useState<RoomState>('joining');
  const observer = useRef<WorkspaceRoomObserver | undefined>(undefined);
  const intent = useRef(new ConsoleIntent());
  const completedStart = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; }; }, []);
  const reload = async () => { const [s,n] = await Promise.all([api.list(),api.nodes()]); if(mounted.current){setSpaces(s);setNodes(n);} };
  useEffect(() => { void reload().catch(() => setError(true)); }, [api]);
  useEffect(() => {
    setItems([]); setBindings([]); setItem(''); setBinding(''); setSelected(''); setDelegation([]);
    if(!space) return;
    let active=true;
    const watch = new WorkspaceRoomObserver(space,client,()=>api.join(space),()=>api.items(space),(state,rows)=>{if(active){setRoomState(state);setItems(rows);if(state==='denied'){setBindings([]);setItem('');setNotes([]);setExecutions([]);setDelegation([]);setSelected('');}}});
    observer.current=watch;
    const off=client.observeEvents(({event})=>{
      if(event.type==='channel_publish_received')watch.publish(event.channel_id,event.topic,event.payload_text);
      if(event.type==='connection_state_changed')void watch.refresh(true);
    });
    const refresh = () => { void watch.refresh(); void api.bindings(space).then(b=>{if(active)setBindings(b.filter(x=>x.revoked===0));}).catch(()=>{if(active)setBindings([]);}); };
    const foreground=()=>{if(document.visibilityState==='visible')void watch.refresh(true);};
    refresh(); const timer=setInterval(refresh,15_000); document.addEventListener('visibilitychange',foreground);
    return()=>{active=false;off();clearInterval(timer);document.removeEventListener('visibilitychange',foreground);void watch.stop();observer.current=undefined;};
  },[api,client,space]);
  useEffect(()=>{let active=true;setExecutions([]);setSelected('');if(node)void api.executions(node).then(x=>{if(active)setExecutions(x);}).catch(()=>setError(true));return()=>{active=false;};},[api,node]);
  useEffect(()=>{
    let active=true,running=false;setSelected('');setNotes([]);if(!item)return;
    const refresh=async()=>{if(running)return;running=true;try{
      const rows=await api.get<WorkExecution[]>(`/workspace/work-execution/list?workItemId=${encodeURIComponent(item)}`);
      const records=await api.get<WorkNote[]>(`/workspace/work-note/list?workItemId=${encodeURIComponent(item)}`);
      if(active)setNotes(records);
      if(active)setExecutions(rows.filter(x=>x.executionId).map(x=>({executionId:x.executionId!,nodeId:'',state:x.state??'unknown',stateVersion:0})));
    }catch(e){if(active){setError(true);if(roomFailure(e)==='denied'){setNotes([]);setExecutions([]);setSelected('');}}}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{active=false;clearInterval(timer);};
  },[api,item]);
  async function act(action:()=>Promise<void>) {if(busy)return;setBusy(true);setError(false);try{await action();}catch{if(mounted.current)setError(true);}finally{if(mounted.current)setBusy(false);}}
  async function start() {
    if (completedStart.current) return;
    if (!prompt.trim() || !model.trim() || !workdir.trim()) return;
    const params={prompt,model,workdirBindingId:workdir};
    const delegationTargets=targets.filter(x=>delegation.includes(targetKey(x))).filter((x,i,a)=>a.findIndex(y=>targetKey(y)===targetKey(x))===i);
    if(space){const r=await intent.current.run<WorkExecution>(api,'/workspace/work-execution/create',{workItemId:item,bindingId:binding,params,delegationTargets},'requestId');if(mounted.current)setSelected(r.executionId??'');}
    else {const r=await intent.current.run<Execution>(api,'/agent/executions',{nodeId:node,capability,scope:{kind:'private',ref:''},params,delegationTargets},'requestId');if(mounted.current)setSelected(r.executionId);}
    completedStart.current=true;
  }
  return <div className="min-w-0 space-y-3" data-testid="workspace-console">
    {error&&<p role="alert">{t('agentWorkspace.error')}</p>}
    <label className="block">{t('agentWorkspace.spaces')}<select className={field} value={space} onChange={e=>{setSpace(e.target.value);setNode('');}} disabled={busy||intent.current.hasPending}><option value="">{t('agentWorkspace.nodes')}</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="flex gap-2"><input aria-label={t('agentWorkspace.name')} className={field} value={name} onChange={e=>setName(e.target.value)}/><Button disabled={busy||!name.trim()} onClick={()=>void act(async()=>{if(space)await api.post('/workspace/work-item/create',{workspaceId:space,title:name});else await api.post('/workspace/create',{name});setName('');await reload();await observer.current?.refresh();})}>{t('agentWorkspace.create')}</Button></div>
    {space ? <>
      <p role="status">{t(`agentWorkspace.${roomState}`)}</p><Button onClick={()=>{if(roomState==='denied'||roomState==='capacity'){setSpace('');}else void observer.current?.refresh(true);}}>{t('agentWorkspace.refresh')}</Button>
      <label className="block">{t('agentWorkspace.work')}<select className={field} value={item} onChange={e=>setItem(e.target.value)}><option value="">{t('agentWorkspace.work')}</option>{items.map(i=><option key={i.id} value={i.id}>{i.title} · {i.status}</option>)}</select></label>
      <label className="block">{t('agentWorkspace.binding')}<select className={field} value={binding} onChange={e=>setBinding(e.target.value)}><option value="">{t('agentWorkspace.binding')}</option>{bindings.filter(b=>b.capability!=='workspace_events_read').map(b=><option key={b.id} value={b.id}>{b.nodeId} · {b.capability}</option>)}</select></label>
      <details><summary>{t('agentWorkspace.create')} · {t('agentWorkspace.binding')}</summary>
        <select className={field} aria-label={t('agentWorkspace.nodes')} value={bindingNode} onChange={e=>{setBindingNode(e.target.value);setBindingCapability('');}}><option value="">{t('agentWorkspace.nodes')}</option>{nodes.filter(n=>n.state==='active').map(n=><option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}</select>
        <select className={field} aria-label={t('agentWorkspace.binding')} value={bindingCapability} onChange={e=>setBindingCapability(e.target.value)}><option value="">{t('agentWorkspace.binding')}</option>{nodes.find(n=>n.nodeId===bindingNode)?.granted.filter(c=>c!=='workspace_events_read').map(c=><option key={c}>{c}</option>)}</select>
        <Button disabled={busy||!bindingNode||!bindingCapability} onClick={()=>{if(window.confirm(t('agentWorkspace.confirm')))void act(async()=>{await api.post('/workspace/agent-binding/create',{workspaceId:space,nodeId:bindingNode,capability:bindingCapability});setBindings((await api.bindings(space)).filter(b=>b.revoked===0));});}}>{t('agentWorkspace.create')}</Button>
      </details>
    </> : <>
      <label className="block">{t('agentWorkspace.nodes')}<select className={field} value={node} onChange={e=>{setNode(e.target.value);setCapability('');}}><option value="">{t('agentWorkspace.nodes')}</option>{nodes.filter(n=>n.state==='active').map(n=><option key={n.nodeId} value={n.nodeId}>{n.name}</option>)}</select></label>
      <select aria-label={t('agentWorkspace.binding')} className={field} value={capability} onChange={e=>setCapability(e.target.value)}><option value="">{t('agentWorkspace.binding')}</option>{nodes.find(n=>n.nodeId===node)?.granted.filter(c=>c!=='workspace_events_read').map(c=><option key={c}>{c}</option>)}</select>
    </>}
    <textarea aria-label={t('agentWorkspace.prompt')} className={field} value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={intent.current.hasPending}/>
    <input aria-label={t('agentWorkspace.model')} placeholder={t('agentWorkspace.model')} className={field} value={model} onChange={e=>setModel(e.target.value)} disabled={intent.current.hasPending}/>
    <input aria-label={t('agentWorkspace.workdir')} placeholder={t('agentWorkspace.workdir')} className={field} value={workdir} onChange={e=>setWorkdir(e.target.value)} disabled={intent.current.hasPending}/>
    <fieldset disabled={busy||intent.current.hasPending} className="space-y-2 rounded border p-3"><legend>{t('agentWorkspace.delegation')}</legend>{targets.filter((x,i,a)=>a.findIndex(y=>targetKey(y)===targetKey(x))===i).map(x=><label className="flex items-center gap-2" key={targetKey(x)}><input type="checkbox" disabled={delegation.length>=32&&!delegation.includes(targetKey(x))} checked={delegation.includes(targetKey(x))} onChange={e=>setDelegation(old=>e.target.checked?[...old,targetKey(x)]:old.filter(k=>k!==targetKey(x)))}/>{x.nodeId} · {x.capability}</label>)}</fieldset>
    <Button disabled={busy||completedStart.current||!prompt.trim()||!model.trim()||!workdir.trim()||(!space? !node||!capability : !item||!binding||roomState==='denied')} onClick={()=>void act(start)}>{t('agentWorkspace.run')}</Button>
    {completedStart.current&&<Button variant="outline" onClick={()=>{completedStart.current=false;setPrompt('');setSelected('');}}>{t('agentWorkspace.newRequest')}</Button>}
    <label className="block">{t('agentWorkspace.executions')}<select className={field} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{t('agentWorkspace.executions')}</option>{selected&&!executions.some(e=>e.executionId===selected)&&<option value={selected}>{selected}</option>}{executions.map(e=><option key={e.executionId} value={e.executionId}>{e.executionId} · {e.state}</option>)}</select></label>
    {selected&&<SessionConsole key={selected} api={api} executionId={selected} onContinue={setSelected} />}
    {notes.length>0&&<section><h3>{t('agentWorkspace.records')}</h3>{notes.map(n=><div className="rounded border p-2" key={n.id}><p className="whitespace-pre-wrap break-words">{n.body}</p>{n.artifactRef&&<code className="break-all">{n.artifactRef}</code>}</div>)}</section>}
  </div>;
}

export function SessionConsole({api,executionId,onContinue}: {api: WorkspaceApi; executionId: string; onContinue?: (id: string) => void}) {
  const {t}=useTranslation();
  const [execution,setExecution]=useState<Execution>();
  const [permissions,setPermissions]=useState<Permission[]>([]);
  const [commands,setCommands]=useState<Command[]>([]);
  const [text,setText]=useState('');
  const [history,setHistory]=useState<Record<string,unknown>[]>([]);
  const [cursor,setCursor]=useState<string>();
  const [watch,setWatch]=useState<{subscriptionId:string;expiresAt:number}>();
  const [events,setEvents]=useState<NodeEvent[]>([]);
  const [error,setError]=useState(false);
  const [denied,setDenied]=useState(false);
  const [busy,setBusy]=useState(false);
  const [nextExecution,setNextExecution]=useState<string>();
  const [children,setChildren]=useState<{childExecutionId:string;state:string}[]>([]);
  const [childCursor,setChildCursor]=useState<string>();
  const childrenExpanded=useRef(false);
  const pending=useRef(new Map<string,Command>());
  const applied=useRef(new Set<string>());
  const intent=useRef(new ConsoleIntent());
  const live=useRef(true);
  const seq=useRef(0);
  const renewal=useRef<{commandId:string;afterSeq:number} | undefined>(undefined);
  const recovery=useRef<string | undefined>(undefined);
  const currentWatch=useRef(watch); currentWatch.current=watch;
  function accept(c:Command) {
    if(!live.current)return;
    setCommands(old=>[...old.filter(x=>x.commandId!==c.commandId),c].slice(-20));
    if(c.status==='pending'||c.status==='unknown'){pending.current.set(c.commandId,c);return;}
    pending.current.delete(c.commandId);
    if(c.status!=='applied'||applied.current.has(c.commandId))return;
    applied.current.add(c.commandId);
    const data=c.result?.data;
    if(c.kind==='session.history'&&Array.isArray(data?.items)){setHistory(old=>{const rows=new Map(old.map(x=>[String(x.id),x]));for(const row of data.items as Record<string,unknown>[])rows.set(String(row.id),row);return [...rows.values()];});setCursor(typeof data.nextCursor==='string'?data.nextCursor:undefined);}
    if(c.kind==='session.watch'&&typeof data?.subscriptionId==='string')setWatch({subscriptionId:data.subscriptionId,expiresAt:Number(data.expiresAt)});
    if(c.kind==='session.unwatch')setWatch(undefined);
    if(c.kind==='session.send')setNextExecution(c.executionId);
  }
  useEffect(()=>{
    live.current=true;let running=false;
    const poll=async()=>{if(running||!live.current)return;running=true;try{
      const state=await api.execution(executionId);const perms=await api.permissions(executionId);
      if(!live.current)return;setExecution(state);setPermissions(perms);setError(false);
      const childPage=await api.get<{items:{childExecutionId:string;state:string}[];nextCursor?:string}>(`/agent/executions/children?executionId=${encodeURIComponent(executionId)}&limit=100`);
      if(!live.current)return;setChildren(old=>{const rows=new Map(old.map(x=>[x.childExecutionId,x]));for(const c of childPage.items??[])rows.set(c.childExecutionId,c);return [...rows.values()];});if(!childrenExpanded.current)setChildCursor(childPage.nextCursor);
      for(const c of pending.current.values()){const result=await api.command(c.executionId,c.commandId);if(!live.current)return;accept(result);}
      if(currentWatch.current){
        const page=await api.events(executionId,seq.current);if(!live.current)return;
        if(page.snapshotRequired){setEvents([]);setHistory([]);seq.current=0;setError(true);setWatch(undefined);recovery.current??=crypto.randomUUID();}
        else{setEvents(old=>[...old,...page.items.filter(e=>e.seq>seq.current)].slice(-200));for(const e of page.items)seq.current=Math.max(seq.current,e.seq);}
        if(!page.snapshotRequired&&currentWatch.current.expiresAt<=Date.now()+15_000&&!Array.from(pending.current.values()).some(c=>c.kind==='session.watch')){
          renewal.current??={commandId:crypto.randomUUID(),afterSeq:seq.current};
          const renewed=await api.post<Command>('/agent/sessions/watch',{executionId,...renewal.current,leaseMs:60000});
          if(!live.current)return;accept(renewed);renewal.current=undefined;
        }
      }
      if(recovery.current){const snapshot=await api.post<Command>('/agent/sessions/history',{executionId,commandId:recovery.current,limit:50});if(!live.current)return;accept(snapshot);recovery.current=undefined;}
    }catch(e){if(!live.current)return;setError(true);if(roomFailure(e)==='denied'){setDenied(true);setExecution(undefined);setPermissions([]);setHistory([]);setEvents([]);setChildren([]);pending.current.clear();live.current=false;}}
    finally{running=false;}};
    void poll();const timer=setInterval(()=>void poll(),2000);
    return()=>{live.current=false;clearInterval(timer);const w=currentWatch.current;if(w)void api.post('/agent/sessions/unwatch',{executionId,commandId:crypto.randomUUID(),subscriptionId:w.subscriptionId}).catch(()=>{});};
  },[api,executionId]);
  async function command(path:string,body:Record<string,unknown>={}){if(busy||denied)return;setBusy(true);setError(false);try{accept(await intent.current.run<Command>(api,`/agent/${path}`,path==='sessions/send'?body:{executionId,...body}));}catch{if(live.current)setError(true);}finally{if(live.current)setBusy(false);}}
  const controls=busy||denied;
  return <section className="space-y-3 border-t pt-3" data-testid="session-console">
    <p role="status">{execution?.state??t('agentWorkspace.pending')}</p>
    {error&&<p role="alert">{t(denied?'agentWorkspace.denied':'agentWorkspace.error')}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={controls} onClick={()=>void command('sessions/inspect')}>{t('agentWorkspace.inspect')}</Button>
      <Button disabled={controls} onClick={()=>void command('sessions/history',{limit:50})}>{t('agentWorkspace.history')}</Button>
      {cursor&&<Button disabled={controls} onClick={()=>void command('sessions/history',{limit:50,cursor})}>{t('agentWorkspace.more')}</Button>}
      <Button disabled={controls} onClick={()=>void command(watch?'sessions/unwatch':'sessions/watch',watch?{subscriptionId:watch.subscriptionId}:{afterSeq:seq.current,leaseMs:60000})}>{t(watch?'agentWorkspace.unwatch':'agentWorkspace.watch')}</Button>
      <Button disabled={controls} variant="destructive" onClick={()=>{if(window.confirm(t('agentWorkspace.confirm')))void api.post<Execution>('/agent/executions/cancel',{executionId}).then(e=>{if(live.current)setExecution(e);}).catch(()=>{if(live.current)setError(true);});}}>{t('agentWorkspace.stop')}</Button>
    </div>
    <textarea className={field} aria-label={t('agentWorkspace.followup')} value={text} disabled={intent.current.hasPending} onChange={e=>setText(e.target.value)}/>
    <Button disabled={controls||!text.trim()||commands.some(c=>c.kind==='session.send'&&(c.status==='pending'||c.status==='unknown'))} onClick={()=>void command('sessions/send',{continueFromExecutionId:executionId,text})}>{t('agentWorkspace.followup')}</Button>
    {commands.map(c=><div key={c.commandId}><p>{c.kind} · {c.status==='unknown'?t('agentWorkspace.unknown'):c.status==='pending'?t('agentWorkspace.pending'):c.status}</p>{c.result?.data&&c.kind==='session.inspect'&&<pre className="whitespace-pre-wrap break-all">{JSON.stringify(c.result.data,null,2)}</pre>}</div>)}
    {history.map((h,i)=><pre key={String(h.id??i)} className="whitespace-pre-wrap break-words text-sm">{String(h.text??h.toolName??h.kind??'')}</pre>)}
    {events.map((e,i)=><pre key={i} className="whitespace-pre-wrap break-all text-sm">{JSON.stringify(e)}</pre>)}
    {permissions.filter(p=>p.status==='pending').map(p=><div key={p.permissionId} className="rounded border p-3"><pre className="whitespace-pre-wrap break-all">{permissionDetails(p.summary)??p.summary}</pre><p>{t('agentWorkspace.permissionHint')}</p>{(['allow_once','deny'] as const).map(decision=><Button key={decision} disabled={controls||p.expiresAt<=Date.now()||(decision==='allow_once'&&!permissionDetails(p.summary))} onClick={()=>{if(window.confirm(t('agentWorkspace.confirm')))void command('permissions/resolve',{permissionId:p.permissionId,requestDigest:p.requestDigest,decision});}}>{t(decision==='allow_once'?'agentWorkspace.approve':'agentWorkspace.deny')}</Button>)}{p.expiresAt<=Date.now()&&<p>{t('agentWorkspace.expired')}</p>}</div>)}
    {nextExecution&&nextExecution!==executionId&&<Button onClick={()=>onContinue?.(nextExecution)} disabled={!onContinue}>{t('agentWorkspace.executions')} · {nextExecution}</Button>}
    {children.length>0&&<section><h3>{t('agentWorkspace.delegation')}</h3>{children.map(c=><Button key={c.childExecutionId} variant="outline" disabled={controls||!onContinue} onClick={()=>onContinue?.(c.childExecutionId)}>{c.childExecutionId} · {c.state}</Button>)}{childCursor&&<Button disabled={controls} onClick={()=>void api.get<{items:{childExecutionId:string;state:string}[];nextCursor?:string}>(`/agent/executions/children?executionId=${encodeURIComponent(executionId)}&limit=100&cursor=${encodeURIComponent(childCursor)}`).then(p=>{if(live.current){setChildren(old=>[...old,...p.items].filter((x,i,a)=>a.findIndex(y=>y.childExecutionId===x.childExecutionId)===i));childrenExpanded.current=true;setChildCursor(p.nextCursor);}}).catch(()=>setError(true))}>{t('agentWorkspace.more')}</Button>}</section>}
  </section>;
}
