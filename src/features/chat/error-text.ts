// Best-effort human-readable error text. Server's structured RPC error
// carries the server-side message under `response.message` (e.g. "Cannot
// add yourself as friend"); we prefer that over the wrapper error
// message which embeds the route + code in front. Falls back to
// generic Error / String coercion for non-RPC failures.

import { RpcError } from '@privchat/sdk';

export function errorText(e: unknown): string {
  if (e instanceof RpcError) {
    const msg = e.response.message;
    if (msg !== undefined && msg !== '') return msg;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
