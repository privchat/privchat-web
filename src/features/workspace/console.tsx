import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { WorkspaceApi, type Command, type Execution, type NodeEvent, type Permission } from './api';
import { roomFailure } from './room-observer';
import { permissionDetails } from './permission-details';
import { ConsoleIntent } from './console-intent';
import { SessionRecords } from './session-records';
import { publicRecords } from './public-records';
export { ConsoleIntent } from './console-intent';

const field = 'block min-w-0 w-full rounded-md border bg-background px-3 py-2 text-sm';

export function SessionConsole({api,executionId,onContinue,employeeManaged=false}: {api: WorkspaceApi; executionId: string; onContinue?: (id: string) => void; employeeManaged?: boolean}) {
  return <SessionConsoleBody key={executionId} api={api} executionId={executionId} onContinue={onContinue} employeeManaged={employeeManaged}/>;
}

function SessionConsoleBody({api,executionId,onContinue,employeeManaged=false}: {api: WorkspaceApi; executionId: string; onContinue?: (id: string) => void; employeeManaged?: boolean}) {
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
  function denyAccess() {
    setDenied(true); setError(true); setExecution(undefined); setPermissions([]); setHistory([]); setEvents([]); setChildren([]); setCommands([]); setNextExecution(undefined); pending.current.clear(); live.current = false;
  }
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
    }catch(e){if(!live.current)return;setError(true);if(roomFailure(e)==='denied')denyAccess();}
    finally{running=false;}};
    void poll();const timer=setInterval(()=>void poll(),2000);
    return()=>{live.current=false;clearInterval(timer);const w=currentWatch.current;if(w)void api.post('/agent/sessions/unwatch',{executionId,commandId:crypto.randomUUID(),subscriptionId:w.subscriptionId}).catch(()=>{});};
  },[api,executionId]);
  async function command(path:string,body:Record<string,unknown>={}){if(busy||denied)return;setBusy(true);setError(false);try{accept(await intent.current.run<Command>(api,`/agent/${path}`,path==='sessions/send'?body:{executionId,...body}));}catch{if(live.current)setError(true);}finally{if(live.current)setBusy(false);}}
  const controls=busy||denied;
  return <section className="space-y-3 border-t pt-3" data-testid="session-console">
    <p role="status">{execution?.state??t('agentWorkspace.pending')}</p>
    {(()=>{const f=(execution?.result as {failure?:{code?:string;retryable?:boolean;summary?:string}}|undefined)?.failure;if(!f)return null;
      const known=['executor_not_logged_in','executor_version_unsupported','executor_quota_exhausted','executor_unavailable'];
      return <p role="alert" data-testid="execution-failure">{t(`agentWorkspace.failure_${known.includes(f.code??'')?f.code:'executor_error'}`)}{f.retryable?` · ${t('agentWorkspace.failureRetryable')}`:''}{f.summary&&<span className="block text-xs text-muted-foreground">{f.summary}</span>}</p>;})()}
    {error&&<p role="alert">{t(denied?'agentWorkspace.denied':'agentWorkspace.error')}</p>}
    {!denied && <SessionRecords key={executionId} api={api} executionId={executionId} onDenied={denyAccess}/>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={controls} onClick={()=>void command('sessions/inspect')}>{t('agentWorkspace.inspect')}</Button>
      <Button disabled={controls} onClick={()=>void command('sessions/history',{limit:50})}>{t('agentWorkspace.history')}</Button>
      {cursor&&<Button disabled={controls} onClick={()=>void command('sessions/history',{limit:50,cursor})}>{t('agentWorkspace.more')}</Button>}
      <Button disabled={controls} onClick={()=>void command(watch?'sessions/unwatch':'sessions/watch',watch?{subscriptionId:watch.subscriptionId}:{afterSeq:seq.current,leaseMs:60000})}>{t(watch?'agentWorkspace.unwatch':'agentWorkspace.watch')}</Button>
      <Button disabled={controls} variant="destructive" onClick={()=>{if(window.confirm(t('agentWorkspace.confirm')))void api.post<Execution>('/agent/executions/cancel',{executionId}).then(e=>{if(live.current)setExecution(e);}).catch(()=>{if(live.current)setError(true);});}}>{t('agentWorkspace.stop')}</Button>
    </div>
    {!employeeManaged&&<><textarea className={field} aria-label={t('agentWorkspace.followup')} value={text} disabled={intent.current.hasPending} onChange={e=>setText(e.target.value)}/>
    <Button disabled={controls||!text.trim()||commands.some(c=>c.kind==='session.send'&&(c.status==='pending'||c.status==='unknown'))} onClick={()=>void command('sessions/send',{continueFromExecutionId:executionId,text})}>{t('agentWorkspace.followup')}</Button></>}
    {commands.map(c=><div key={c.commandId}><p>{c.kind} · {c.status==='unknown'?t('agentWorkspace.unknown'):c.status==='pending'?t('agentWorkspace.pending'):c.status}</p>{c.result?.data&&c.kind==='session.inspect'&&<pre className="whitespace-pre-wrap break-all">{JSON.stringify(c.result.data,null,2)}</pre>}</div>)}
    {history.map((h,i)=><pre key={String(h.id??i)} className="whitespace-pre-wrap break-words text-sm">{String(h.text??h.toolName??h.kind??'')}</pre>)}
    {events.map(e => <div key={e.seq}>{publicRecords(e).map((record, index) => <p key={index} className="whitespace-pre-wrap break-words text-sm">{record.text ?? t(`agentWorkspace.${record.state ? `execution_${record.state}` : `record_${record.kind}`}`)}</p>)}</div>)}
    {permissions.filter(p=>p.status==='pending').map(p=><div key={p.permissionId} className="rounded border p-3"><pre className="whitespace-pre-wrap break-all">{permissionDetails(p.summary)??p.summary}</pre><p>{t('agentWorkspace.permissionHint')}</p>{(['allow_once','deny'] as const).map(decision=><Button key={decision} disabled={controls||p.expiresAt<=Date.now()||(decision==='allow_once'&&!permissionDetails(p.summary))} onClick={()=>{if(window.confirm(t('agentWorkspace.confirm')))void command('permissions/resolve',{permissionId:p.permissionId,requestDigest:p.requestDigest,decision});}}>{t(decision==='allow_once'?'agentWorkspace.approve':'agentWorkspace.deny')}</Button>)}{p.expiresAt<=Date.now()&&<p>{t('agentWorkspace.expired')}</p>}</div>)}
    {nextExecution&&nextExecution!==executionId&&<Button onClick={()=>onContinue?.(nextExecution)} disabled={!onContinue}>{t('agentWorkspace.executions')} · {nextExecution}</Button>}
    {children.length>0&&<section><h3>{t('agentWorkspace.delegation')}</h3>{children.map(c=><Button key={c.childExecutionId} variant="outline" disabled={controls||!onContinue} onClick={()=>onContinue?.(c.childExecutionId)}>{c.childExecutionId} · {c.state}</Button>)}{childCursor&&<Button disabled={controls} onClick={()=>void api.get<{items:{childExecutionId:string;state:string}[];nextCursor?:string}>(`/agent/executions/children?executionId=${encodeURIComponent(executionId)}&limit=100&cursor=${encodeURIComponent(childCursor)}`).then(p=>{if(live.current){setChildren(old=>[...old,...p.items].filter((x,i,a)=>a.findIndex(y=>y.childExecutionId===x.childExecutionId)===i));childrenExpanded.current=true;setChildCursor(p.nextCursor);}}).catch(()=>setError(true))}>{t('agentWorkspace.more')}</Button>}</section>}
  </section>;
}
