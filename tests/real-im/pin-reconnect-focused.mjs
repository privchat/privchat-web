export default async function pinReconnectFocused(page, fixture) {
  const browser = page.context().browser();
  const contexts = [];
  const timeline = [];
  const started = Date.now();
  const record = (client, event, data) => timeline.push({ ms: Date.now() - started, client, event, ...data });
  const watch = (peer, name) => peer.on('websocket', socket => {
    record(name, 'socket-created', {});
    socket.on('close', () => record(name, 'socket-closed', {}));
    socket.on('framesent', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8');
      const route = text.match(/message\/pin\/[a-z_]+/)?.[0];
      if (route) record(name, 'rpc-sent', { route });
    });
    socket.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString('utf8');
      if (!text.includes('"items"') || !text.includes('"message_id"')) return;
      try {
        const body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (Array.isArray(body.items)) record(name, 'pin-list-response', { ids: [...text.matchAll(/"message_id"\s*:\s*"?(\d+)/g)].map(match => match[1]) });
      } catch { /* Only record positively identified pin-list JSON, never raw frames. */ }
    });
  });
  const newPeer = async (role, h5 = false) => {
    const context = await browser.newContext(h5 ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
    contexts.push(context);
    const peer = await context.newPage(); watch(peer, h5 ? 'h5-reader' : role === 'owner' ? 'web-reader' : 'writer');
    await peer.addInitScript(() => {
      localStorage.setItem('privchat.web.lang', 'en'); localStorage.setItem('privchat.h5.locale', 'en');
      const NativeSocket = window.WebSocket;
      window.__acceptanceSockets = [];
      window.__acceptanceSocketCloses = [];
      window.__acceptanceSocketTrafficAt = Date.now();
      window.WebSocket = class extends NativeSocket {
        constructor(...args) {
          super(...args); window.__acceptanceSockets.push(this);
          this.addEventListener('close', event => window.__acceptanceSocketCloses.push({ code: event.code, reason: event.reason, clean: event.wasClean }));
          this.addEventListener('message', () => { window.__acceptanceSocketTrafficAt = Date.now(); });
        }
        send(...args) { window.__acceptanceSocketTrafficAt = Date.now(); return super.send(...args); }
      };
    });
    await peer.goto(h5 ? 'http://127.0.0.1:10086/' : 'http://127.0.0.1:5186/');
    if (h5) {
      await peer.locator('input[placeholder="Username"]').fill('');
      await peer.locator('input[placeholder="Username"]').pressSequentially(fixture.accounts[role].username);
      await peer.locator('input[placeholder="Password"]').fill('');
      await peer.locator('input[placeholder="Password"]').pressSequentially(fixture.accounts[role].password);
      await peer.locator('input[placeholder="Password"]').blur();
      await peer.getByText('Sign in', { exact: true }).click();
      try { await peer.locator('input[placeholder="Username"]').waitFor({ state: 'hidden', timeout: 15000 }); }
      catch { await peer.getByText('Sign in', { exact: true }).click(); }
      await peer.locator('.conv-item__title').filter({ hasText: fixture.group.name }).click({ timeout: 30000 });
    } else {
      await peer.locator('#username').fill(fixture.accounts[role].username);
      await peer.locator('#password').fill(fixture.accounts[role].password);
      await peer.getByRole('button', { name: 'Login', exact: true }).click();
      await peer.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 30000 });
    }
    if (await peer.locator('script[src*="@vite/client"]').count()) throw Error('Static production builds required');
    record(h5 ? 'h5-reader' : role === 'owner' ? 'web-reader' : 'writer', 'compiled-cohort', { scripts: await peer.locator('script[src]').evaluateAll(elements => elements.map(element => element.src)) });
    return peer;
  };
  let owner, h5, writer;
  let checkpoint = 'login';
  const authoritative = async () => {
    const response = await writer.evaluate(async groupId => window.__privchat.messagePinList(Number(groupId)), fixture.group.groupId);
    const ids = response.items.map(item => String(item.message_id)).sort(); record('server', 'authoritative', { ids }); return ids;
  };
  const pinOwn = async pinned => {
    const own = fixture.group.messages[1];
    const current = await authoritative();
    if (current.includes(own.messageId) === pinned) return;
    const anchor = writer.getByRole('button').filter({ hasText: 'Pinned message' }).first();
    if (await writer.locator(`[data-message-id="${own.messageId}"]`).count() === 0) await anchor.click();
    const row = writer.locator(`[data-message-id="${own.messageId}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row.getByRole('button', { name: 'actions', exact: true }).click();
    await writer.getByRole('menuitem', { name: pinned ? 'Pin' : 'Unpin', exact: true }).click();
    await writer.waitForFunction(pinned => document.querySelectorAll('button[aria-label="Unpin"]').length === (pinned ? 1 : 0), pinned, { timeout: 10000 });
    const ids = await authoritative();
    if (ids.includes(own.messageId) !== pinned) throw Error('UI mutation did not reach authoritative pin list');
  };
  const waitPins = async ids => {
    await owner.waitForFunction(ids => JSON.stringify([...document.querySelectorAll('[data-pinned-message-id]')].filter(el => el.getClientRects().length).map(el => el.dataset.pinnedMessageId).sort()) === JSON.stringify(ids), ids, { timeout: 15000 });
    await h5.waitForFunction(ids => [...document.querySelectorAll('[data-pinned-message-ids]')].filter(el => el.getClientRects().length).some(el => JSON.stringify(el.dataset.pinnedMessageIds.split(',').sort()) === JSON.stringify(ids)), ids, { timeout: 15000 });
    record('both', 'visible-authoritative-pins', { ids });
  };
  const waitTransportSettled = async () => {
    for (const peer of [owner, h5]) await peer.waitForFunction(() => window.__acceptanceSockets.some(socket => socket.readyState === WebSocket.OPEN) && Date.now() - window.__acceptanceSocketTrafficAt > 1000, undefined, { timeout: 15000 });
    record('both', 'real-transport-settled', {});
  };
  try {
    owner = await newPeer('owner'); h5 = await newPeer('member', true); writer = await newPeer('admin');
    checkpoint = 'two-pin baseline';
    await pinOwn(true); await waitPins(await authoritative());
    await waitTransportSettled();
    for (const pinned of [false, true]) {
      checkpoint = `disconnect readers and ${pinned ? 'pin' : 'unpin'} remotely`;
      for (const peer of [owner, h5]) {
        await peer.context().setOffline(true);
        await peer.evaluate(() => window.__acceptanceSockets.forEach(socket => socket.close(4000, 'Acceptance disconnect')));
      }
      const stale = await h5.locator('[data-pinned-message-ids]:visible').getAttribute('data-pinned-message-ids');
      const staleWeb = await owner.locator('[data-pinned-message-id]:visible').evaluateAll(elements => elements.map(element => element.dataset.pinnedMessageId).sort());
      if (!await owner.getByRole('button', { name: 'Group info', exact: true }).isVisible()) throw Error('Web workspace unmounted during transient disconnect');
      await pinOwn(pinned);
      const expected = await authoritative();
      if (expected.length !== (pinned ? 2 : 1)) throw Error('Unexpected authoritative list after remote mutation');
      if (await h5.locator('[data-pinned-message-ids]:visible').getAttribute('data-pinned-message-ids') !== stale) throw Error('Offline reader unexpectedly received the mutation');
      const offlineWeb = await owner.locator('[data-pinned-message-id]:visible').evaluateAll(elements => elements.map(element => element.dataset.pinnedMessageId).sort());
      if (JSON.stringify(offlineWeb) !== JSON.stringify(staleWeb)) throw Error('Web offline pin list changed or was unmounted');
      checkpoint = `reconnect readers after ${pinned ? 'pin' : 'unpin'}`;
      for (const peer of [owner, h5]) await peer.context().setOffline(false);
      // No reselect/reload: the signed-in Web workspace must survive transient loss.
      await owner.getByRole('button', { name: 'Group info', exact: true }).waitFor({ timeout: 15000 });
      await waitPins(expected);
      await waitTransportSettled();
    }
    checkpoint = 'online unpin and repin after two reconnects';
    await pinOwn(false); await waitPins(await authoritative());
    await pinOwn(true); await waitPins(await authoritative());
    checkpoint = 'reload persistence';
    await owner.reload();
    await owner.getByText(fixture.group.name, { exact: true }).first().click({ timeout: 15000 });
    await h5.reload();
    await waitPins(await authoritative());
    await owner.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/pin-reconnect-web.png' });
    await h5.screenshot({ path: '/tmp/privchat-web-four-feature-20261024/pin-reconnect-h5.png' });
    return { stage: 'REAL_FOCUSED_PIN_RECONNECT', groupId: fixture.group.groupId, authoritativeFinal: await authoritative(), timeline };
  } catch (error) {
    const visible = [];
    for (const [name, peer] of [['web', owner], ['h5', h5], ['writer', writer]]) if (peer) visible.push({ name, url: peer.url(), sockets: await peer.evaluate(() => ({ states: window.__acceptanceSockets.map(socket => socket.readyState), closes: window.__acceptanceSocketCloses })), menu: await peer.getByRole('menuitem').allTextContents(), pins: await peer.locator('.chat__pinned-text').evaluateAll(elements => elements.map(el => ({ text: el.textContent, visible: !!el.getClientRects().length }))), body: (await peer.locator('body').innerText()).slice(0, 1000) });
    throw Error(JSON.stringify({ checkpoint, error: error.message, timeline, visible }));
  } finally {
    for (const context of contexts) { await context.setOffline(false); await context.close(); }
  }
}
