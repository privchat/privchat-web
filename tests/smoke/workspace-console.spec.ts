import { test, expect } from '@playwright/test';

// Production observer and component, not a duplicate reducer or handwritten HTTP controller.
test.beforeEach(async ({page}) => { await page.goto('/'); });

test('subscribes before snapshot, fences late responses, reconciles versions and clears revoked data', async ({page}) => {
  const result=await page.evaluate(async()=>{
    const {WorkspaceRoomObserver}=await import('/src/features/workspace/room-observer.ts');
    const calls:string[]=[];const updates:Array<{state:string;version?:number;count:number}>=[];
    let version=4, deny=false, joins=0;
    const transport={subscribeChannel:async()=>{calls.push('subscribe');},unsubscribeChannel:async()=>{calls.push('leave');}};
    const o=new WorkspaceRoomObserver('ws',transport,async()=>{joins++;return {channelId:'123',channelType:3,ticket:'x',expiresAt:Date.now()+60000,eventProtocolVersion:1};},async()=>{calls.push('snapshot');if(deny)throw {code:10201};return [{id:'1',workspaceId:'ws',title:'Item',description:'',status:'open',version}];},(state,items)=>updates.push({state,version:items[0]?.version,count:items.length}));
    await o.refresh();version=2;await o.refresh();
    const older=updates.at(-1)?.version;
    version=5;o.publish('123','workspace.event',JSON.stringify({protocolVersion:1,workspaceId:'ws',kind:'work_item.changed',resourceId:'1',resourceVersion:5}));await o.refresh();
    const afterEvent=updates.at(-1)?.version;
    await o.refresh(true);deny=true;await o.refresh();const revoked=updates.at(-1);await o.refresh();const stoppedJoins=joins;
    await o.stop();return {calls,older,afterEvent,revoked,stoppedJoins};
  });
  expect(result.calls.slice(0,2)).toEqual(['subscribe','snapshot']);
  expect(result.older).toBe(4);expect(result.afterEvent).toBe(5);
  expect(result.revoked).toEqual({state:'denied',count:0});expect(result.stoppedJoins).toBe(2);
  expect(result.calls).toContain('leave');
});

test('unmount during subscribe removes the late subscription and never displays its snapshot',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {WorkspaceRoomObserver,roomFailure}=await import('/src/features/workspace/room-observer.ts');
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);let leaves=0,views=0;
    const o=new WorkspaceRoomObserver('ws',{subscribeChannel:()=>gate,unsubscribeChannel:async()=>{leaves++;}},async()=>({channelId:'8',channelType:3,ticket:'x',expiresAt:Date.now()+60000,eventProtocolVersion:1}),async()=>[],()=>{views++;});
    const run=o.refresh();await Promise.resolve();await Promise.resolve();await o.stop();release();await run;
    return {leaves,views,capacity:roomFailure({response:{reason_code:8}}),expired:roomFailure({response:{reason_code:11}})};
  });
  expect(result.leaves).toBeGreaterThanOrEqual(1);expect(result.views).toBe(0);
  expect(result.capacity).toBe('capacity');expect(result.expired).toBe('stale');
});

test('lost HTTP response reuses command identity and forbids a changed operation',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {ConsoleIntent}=await import('/src/features/workspace/console.tsx');
   const ids:string[]=[];let fail=true;const api={post:async(_path:string,body:{commandId:string})=>{ids.push(body.commandId);if(fail)throw new Error('lost');return {status:'pending'};}};
   const intent=new ConsoleIntent();try{await intent.run(api as never,'/agent/sessions/send',{text:'one'});}catch{}
   let changed=false;try{await intent.run(api as never,'/agent/sessions/send',{text:'two'});}catch{changed=true;}
   fail=false;await intent.run(api as never,'/agent/sessions/send',{text:'one'});return {ids,changed};
 });
 expect(result.changed).toBe(true);expect(result.ids).toHaveLength(2);expect(result.ids[0]).toBe(result.ids[1]);
 expect(result.ids[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
});

test('definite rejection releases the key so input can be corrected; unknown outcome keeps it',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {ConsoleIntent}=await import('/src/features/workspace/console.tsx');
   const {PlatformApiError}=await import('/src/lib/platform-errors.ts');
   const ids:string[]=[];let reply:'reject'|'busy'|'ok'='reject';
   const api={post:async(_p:string,body:{requestId:string})=>{ids.push(body.requestId);if(reply==='reject')throw new PlatformApiError(10100,'WORKSPACE_INVALID');if(reply==='busy')throw new PlatformApiError(4,'INTERNAL');return {};}};
   const intent=new ConsoleIntent();
   try{await intent.run(api as never,'/workspace/work-execution/create',{text:'bad'},'requestId');}catch{}
   const afterReject=intent.hasPending;
   reply='busy';try{await intent.run(api as never,'/workspace/work-execution/create',{text:'fixed'},'requestId');}catch{}
   const afterBusy=intent.hasPending;
   reply='ok';await intent.run(api as never,'/workspace/work-execution/create',{text:'fixed'},'requestId');
   return {ids,afterReject,afterBusy};
 });
 expect(result.afterReject).toBe(false);expect(result.afterBusy).toBe(true);
 expect(result.ids).toHaveLength(3);expect(result.ids[0]).not.toBe(result.ids[1]);expect(result.ids[1]).toBe(result.ids[2]);
 expect(result.ids[1]).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
});

test('an auth error after an unknown outcome keeps the original key',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {ConsoleIntent}=await import('/src/features/workspace/console.tsx');
   const {PlatformApiError}=await import('/src/lib/platform-errors.ts');
   const ids:string[]=[];let step=0;
   const api={post:async(_p:string,body:{requestId:string})=>{ids.push(body.requestId);const s=step++;if(s===0)throw new Error('lost');if(s===1)throw new PlatformApiError(401,'NOT_AUTHENTICATED');if(s===2)throw new PlatformApiError(10100,'WORKSPACE_INVALID');return {};}};
   const intent=new ConsoleIntent();const pend:boolean[]=[];
   for(let i=0;i<3;i++){try{await intent.run(api as never,'/x',{text:'one'},'requestId');}catch{}pend.push(intent.hasPending);}
   await intent.run(api as never,'/x',{text:'one'},'requestId');
   return {ids,pend};
 });
 expect(result.pend).toEqual([true,true,true]);expect(new Set(result.ids).size).toBe(1);expect(result.ids).toHaveLength(4);
});

test('real session component polls commands, pages history and binds one-time approval digest',async({page})=>{
  const submitted:Array<{path:string;body:Record<string,unknown>}>=[];
  await page.route('**/__console/app/agent/**',async route=>{
    const url=new URL(route.request().url());const path=url.pathname.replace('/__console/app/agent/','');
    const body=route.request().method()==='POST'?route.request().postDataJSON():{};
    if(route.request().method()==='POST')submitted.push({path,body});
    let data:unknown;
    if(path==='executions/get')data={executionId:'1',nodeId:'2',state:'running',stateVersion:1};
    else if(path==='permissions/list')data=[{permissionId:'p1',requestDigest:'digest-bound',summary:JSON.stringify({tool:'write_file',kind:'tool',input:{path:'src/main.ts',content:'reviewed change'}}),expiresAt:Date.now()+60000,status:'pending'}];
    else if(path==='commands/get')data={commandId:url.searchParams.get('commandId'),executionId:'1',kind:'session.history',status:'applied',result:{data:{items:[{id:'h1',kind:'text',text:'History from device'}],nextCursor:'cursor-2'}}};
    else data={commandId:body.commandId,executionId:'1',kind:path.replaceAll('/','.'),status:path==='sessions/history'?'pending':'applied'};
    await route.fulfill({json:{code:0,data}});
  });
  await page.evaluate(async()=>{
    const {mountSessionConsole}=await import('/src/test-harness/workspace-console.tsx');
    mountSessionConsole(`${location.origin}/__console/app`);
  });
  const console=page.getByTestId('session-console');
  await console.getByRole('button',{name:/History|历史记录|Lịch sử/,exact:true}).click();
  await expect(console.getByText('History from device')).toBeVisible();
  await console.getByRole('button',{name:/Load more|加载更多|Tải thêm/}).click();
  page.once('dialog',d=>d.accept());
  await console.getByRole('button',{name:/Allow once|仅批准本次|Cho phép một lần/}).click();
  await expect.poll(()=>submitted.some(x=>x.path==='permissions/resolve')).toBe(true);
  expect(submitted.find(x=>x.path==='permissions/resolve')?.body).toMatchObject({executionId:'1',permissionId:'p1',requestDigest:'digest-bound',decision:'allow_once'});
  expect(submitted.filter(x=>x.path==='sessions/history')[1]?.body.cursor).toBe('cursor-2');
});

test('revoked Room access clears and stops until explicitly reauthorized',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {WorkspaceRoomObserver}=await import('/src/features/workspace/room-observer.ts');let joins=0,subscribe=0;const states:string[]=[];
   const o=new WorkspaceRoomObserver('w',{subscribeChannel:async()=>{if(++subscribe===1)throw{response:{reason_code:13}};},unsubscribeChannel:async()=>{}},async()=>{joins++;return{channelId:'1',channelType:3,ticket:'t'+joins,expiresAt:Date.now()+60000,eventProtocolVersion:1};},async()=>[],s=>states.push(s));
   await o.refresh();await o.refresh();await o.stop();return{joins,states};
 });
 expect(result.joins).toBe(1);expect(result.states).toEqual(['denied']);
});

test('approval requires actual structured action details, not a tool name',async({page})=>{
 const result=await page.evaluate(async()=>{
   const {permissionDetails}=await import('/src/features/workspace/permission-details.ts');
   return {bare:permissionDetails('write_file'),local:permissionDetails('LOCAL_APPROVAL_REQUIRED: {"tool":"shell","kind":"tool","input":{}}'),valid:permissionDetails(JSON.stringify({tool:'write_file',kind:'tool',input:{path:'src/a.ts',content:'one'}}))};
 });
 expect(result.bare).toBeNull();expect(result.local).toBeNull();expect(result.valid).toContain('src/a.ts');
});

test('network failure during subscribe never becomes live without a successful resubscribe',async({page})=>{
 const result=await page.evaluate(async()=>{
  const {WorkspaceRoomObserver}=await import('/src/features/workspace/room-observer.ts');let fail=true;const calls:string[]=[];const states:string[]=[];
  const o=new WorkspaceRoomObserver('w',{subscribeChannel:async()=>{calls.push('subscribe');if(fail)throw Error('network');},unsubscribeChannel:async()=>{calls.push('leave');}},async()=>{calls.push('join');return{channelId:'1',channelType:3,ticket:'t',expiresAt:Date.now()+60000,eventProtocolVersion:1};},async()=>{calls.push('snapshot');return[];},s=>states.push(s));
  await o.refresh();const first=[...calls];calls.length=0;fail=false;await o.refresh();return{first,second:calls,states};
 });
 expect(result.first).not.toContain('snapshot');expect(result.second).toEqual(['join','subscribe','snapshot']);expect(result.states).toEqual(['stale','live']);
});

test('workspace component joins before authorized snapshot and fits a phone viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const paths:string[]=[];
 const starts:Record<string,unknown>[]=[];
 await page.route('**/__workspace/app/**',async route=>{
  const path=new URL(route.request().url()).pathname;paths.push(path);
  let data:unknown=[];
  if(path.endsWith('/workspace/list'))data=[{id:'21',name:'Example workspace',description:'',archived:0,myRole:'owner'}];
  if(path.endsWith('/agent/nodes'))data=[{nodeId:'8',name:'Work laptop',state:'active',granted:['agent.codex']},{nodeId:'10',name:'Unbound laptop',state:'active',granted:['agent.codex']}];
  if(path.endsWith('/room/join'))data={channelId:'400',channelType:3,ticket:'fixture',expiresAt:Date.now()+60000,eventProtocolVersion:1};
  if(path.endsWith('/work-item/list'))data=[{id:'31',workspaceId:'21',title:'Review change',description:'',status:'open',version:2}];
  if(path.endsWith('/work-note/list'))data=[{id:'71',workItemId:'31',kind:'artifact',body:'Authorized artifact record',artifactRef:'repo@commit:report.md'}];
  if(path.endsWith('/agent-binding/list'))data=[{id:'41',nodeId:'8',capability:'agent.codex',revoked:0},{id:'42',nodeId:'9',capability:'agent.claude',revoked:0},{id:'43',nodeId:'11',capability:'agent.codex',revoked:1}];
  if(path.endsWith('/work-execution/create')){starts.push(route.request().postDataJSON());data={id:'51',executionId:null,state:null};}
  await route.fulfill({json:{code:0,data}});
 });
 await page.evaluate(async()=>{const {mountWorkspaceConsole}=await import('/src/test-harness/workspace-console.tsx');mountWorkspaceConsole(`${location.origin}/__workspace/app`);});
 const c=page.getByTestId('workspace-console');
 await c.locator('select').first().selectOption('21');
 await expect(c.getByRole('option',{name:'Review change · open'})).toBeAttached();
 await expect(c.getByRole('status')).toHaveText(/Up to date|已对账|Đã cập nhật/);
 await c.getByLabel(/Work items|工作事项|Công việc/).selectOption('31');
 await c.locator('label').filter({hasText:/Authorized capability|已授权能力|Năng lực/}).locator('select').last().selectOption('41');
 await c.getByRole('textbox',{name:/Request|工作要求|Yêu cầu/,exact:true}).fill('Review this change');
 await c.getByRole('textbox',{name:/Work directory binding|工作目录绑定|Thư mục/}).fill('repo');
 const run=c.getByRole('button',{name:/Start work|开始执行|Bắt đầu/});
 await expect(run).toBeDisabled();
 await c.getByRole('textbox',{name:/Model|模型|Mô hình/,exact:true}).first().fill('   ');
 await expect(run).toBeDisabled();
 await c.getByRole('textbox',{name:/Model|模型|Mô hình/,exact:true}).first().fill('configured-model');
 await expect(run).toBeEnabled();
 await expect(c.getByText('Authorized artifact record')).toBeVisible();
 await expect(c.getByRole('group',{name:/Optional delegation|可选委托|Thiết bị được/}).getByRole('checkbox')).toHaveCount(2);
 await expect(c.getByRole('group',{name:/Optional delegation|可选委托|Thiết bị được/}).getByRole('checkbox').first()).not.toBeChecked();
 await expect(c.getByRole('group',{name:/Optional delegation|可选委托|Thiết bị được/}).getByRole('checkbox').last()).not.toBeChecked();
 expect(paths.findIndex(p=>p.endsWith('/room/join'))).toBeLessThan(paths.findIndex(p=>p.endsWith('/work-item/list')));
 await expect.poll(async()=>{const box=await page.getByRole('dialog').boundingBox();return !!box&&box.x>=0&&box.x+box.width<=390;}).toBe(true);
 await page.screenshot({path:'/tmp/weey-workspace-console.png'});
 await run.click();await expect.poll(()=>starts.length).toBe(1);
 expect(starts[0].delegationTargets).toEqual([]);
 await c.getByRole('button',{name:/New request|新请求|Yêu cầu mới/}).click();
 await c.getByRole('textbox',{name:/Request|工作要求|Yêu cầu/,exact:true}).fill('Review again');
 await c.getByRole('checkbox',{name:'9 · agent.claude'}).check();
 await run.click();await expect.poll(()=>starts.length).toBe(2);
 expect(starts[1].delegationTargets).toEqual([{nodeId:'9',capability:'agent.claude'}]);
});
