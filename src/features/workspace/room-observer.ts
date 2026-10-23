import type { RoomTicket, WorkItem } from './api';
import { PlatformApiError } from '../../lib/platform-errors';

export interface RoomTransport {
  subscribeChannel(id: string, type: number, ticket?: string): Promise<unknown>;
  unsubscribeChannel(id: string, type: number): Promise<unknown>;
}
export type RoomState = 'joining' | 'live' | 'stale' | 'denied' | 'capacity';
export function roomFailure(error: unknown): RoomState {
  const e = error as {code?: number; status?: number; machineCode?: string; response?: {reason_code?: number}};
  const reason = e?.response?.reason_code;
  if (reason === 3 || reason === 8) return 'capacity';
  const revoked = error instanceof PlatformApiError && ['AGENT_NODE_REVOKED', 'AGENT_CAPABILITY_NOT_GRANTED', 'AGENT_ACTOR_FORBIDDEN', 'WORKSPACE_FORBIDDEN'].includes(error.machineCode ?? '');
  if (revoked || [4, 6, 7, 9, 10, 12, 13].includes(reason ?? -1) || [401, 403, 10004, 10201].includes(e?.code ?? e?.status ?? -1)) return 'denied';
  return 'stale';
}

/** One viewed space, one serialized refresh. Events are hints, never execution inputs. */
export class WorkspaceRoomObserver {
  private stopped = false;
  private ticket?: RoomTicket;
  private running?: Promise<void>;
  private dirty = false;
  private renew = false;
  private generation = 0;
  private versions = new Map<string, number>();
  private rows: WorkItem[] = [];
  private mode: RoomState = 'joining';
  constructor(
    private workspaceId: string,
    private transport: RoomTransport,
    private join: () => Promise<RoomTicket>,
    private snapshot: () => Promise<WorkItem[]>,
    private update: (state: RoomState, items: WorkItem[]) => void,
    private now = Date.now,
  ) {}
  refresh(reconnect = false): Promise<void> {
    if (this.stopped || this.mode === 'denied' || this.mode === 'capacity') return Promise.resolve();
    this.dirty = true;
    this.renew ||= reconnect;
    if (!this.running) this.running = this.drain().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async drain(): Promise<void> {
    while (this.dirty && !this.stopped) {
      this.dirty = false;
      const generation = this.generation;
      try {
        if (!this.ticket || this.renew || this.ticket.expiresAt <= this.now() + 15_000) {
          this.renew = false;
          const next = await this.join();
          if (this.stopped || generation !== this.generation) return;
          if (next.channelType !== 3 || next.eventProtocolVersion !== 1 || next.expiresAt <= this.now()) throw new Error('Unsupported room ticket');
          // Set before Subscribe so replay arriving with its response is buffered.
          this.ticket = next;
          try {
            await this.transport.subscribeChannel(next.channelId, next.channelType, next.ticket);
          } catch (error) {
            // A ticket is not proof of an active subscription, including an ambiguous lost ACK.
            await this.leave();
            throw error;
          }
          if (this.stopped) { await this.transport.unsubscribeChannel(next.channelId, next.channelType).catch(() => {}); return; }
        }
        const fresh = await this.snapshot();
        if (this.stopped || generation !== this.generation) return;
        const previous = new Map(this.rows.map(row => [row.id, row]));
        this.rows = fresh.map(row => (previous.get(row.id)?.version ?? -1) > row.version ? previous.get(row.id)! : row);
        // A notification during the query may describe a later version.
        const behind = this.rows.some(row => (this.versions.get(row.id) ?? 0) > row.version);
        this.mode = behind ? 'stale' : 'live';
        this.update(this.mode, this.rows);
      } catch (error) {
        if (this.stopped || generation !== this.generation) return;
        this.mode = roomFailure(error);
        if (this.mode === 'denied' || this.mode === 'capacity') {
          this.rows = []; this.dirty = false; this.versions.clear(); await this.leave();
        } else if (this.ticket && this.ticket.expiresAt <= this.now()) {
          this.rows = []; await this.leave();
        }
        this.update(this.mode, this.rows);
      }
    }
  }
  publish(channelId: string, topic: string | undefined, payload: string): void {
    if (this.stopped || channelId !== this.ticket?.channelId || topic !== 'workspace.event') return;
    try {
      const event = JSON.parse(payload) as {workspaceId: string; protocolVersion: number; kind: string; resourceId: string; resourceVersion: number};
      if (event.workspaceId !== this.workspaceId) return;
      if (event.protocolVersion === 1 && event.kind === 'work_item.changed' && Number.isSafeInteger(event.resourceVersion)) {
        this.versions.set(event.resourceId, Math.max(event.resourceVersion, this.versions.get(event.resourceId) ?? 0));
      }
    } catch { /* Malformed/unknown notification: recover from the authorized snapshot. */ }
    void this.refresh();
  }
  private async leave(): Promise<void> {
    const ticket = this.ticket; this.ticket = undefined;
    if (ticket) await this.transport.unsubscribeChannel(ticket.channelId, ticket.channelType).catch(() => {});
  }
  async stop(): Promise<void> {
    this.stopped = true; this.generation++; this.rows = []; this.versions.clear();
    await this.leave();
  }
}
