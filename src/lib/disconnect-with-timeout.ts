// R7.4 — bounded `disconnect()` helper.
//
// `client.disconnect()` does a clean WebSocket close handshake;
// usually < 100ms but a wedged server / a network drop / a stuck
// retry timer can make it hang. We don't want a hung disconnect
// to lock the user out of switching accounts, so we wrap it in a
// timeout: if the handle hasn't reported "closed" inside `ms`,
// we move on. The caller still owns whichever follow-up cleanup
// they need (typically `dispose()`); this helper only races the
// graceful close.
//
// Outcome enum lets the caller log which path was hit without
// promoting "timed out" to an error throw — timeouts are an
// expected operating mode under flaky networks, not bugs.

export type DisconnectOutcome = 'closed' | 'timeout' | 'error';

export async function disconnectWithTimeout(
  disconnect: () => Promise<unknown>,
  ms: number = 1000,
): Promise<DisconnectOutcome> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<DisconnectOutcome>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), ms);
  });
  const closePromise: Promise<DisconnectOutcome> = (async () => {
    try {
      await disconnect();
      return 'closed';
    } catch {
      return 'error';
    }
  })();
  const outcome = await Promise.race([closePromise, timeoutPromise]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  return outcome;
}
