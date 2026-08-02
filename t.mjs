import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--no-proxy-server'] });
const p = await b.newPage();
await p.goto('https://web.fflunp.cn/', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(3000);
const ins = await p.locator('input').all();
await ins[0].fill('songqichao'); await ins[1].fill('songqichao123');
await p.getByRole('button', { name: /^Login$|登录/ }).first().click();
await p.waitForTimeout(20000);
const r = await p.evaluate(async () => {
  const c = window.__privchat;
  const out = [];
  for (const gid of [513, 513, 513]) {
    const t0 = performance.now();
    try {
      const m = await c.groupMemberList(gid);
      const bytes = new TextEncoder().encode(JSON.stringify(m)).length;
      out.push({ gid, ms: Math.round(performance.now() - t0), total: m.total, kb: Math.round(bytes/1024) });
    } catch (e) { out.push({ gid, err: String(e).slice(0,90), ms: Math.round(performance.now()-t0) }); }
  }
  // 小群对照
  const t0 = performance.now();
  const s = await c.groupMemberList(42);
  out.push({ gid: 42, ms: Math.round(performance.now()-t0), total: s.total });
  return out;
});
console.log(JSON.stringify(r, null, 1));
await b.close();
