import type { WorkExecution, WorkItem, WorkspaceApi } from './api';
import { ConsoleIntent, type PendingConsoleRequest } from './console-intent';
import { retainBlockedDelivery, isBlocked } from './delivery-receipt';

export interface NewItemInput { workspaceId: string; title: string; description: string; acceptance: string; projectId: string | null }
export interface NewAssignment { bindingId: string; employeeId: string; text: string; projectTargetId?: string }
export interface ItemRecovery {
  input?: NewItemInput; assignment?: NewAssignment; item?: WorkItem;
  createPending?: PendingConsoleRequest; assignPending?: PendingConsoleRequest;
  completed?: boolean;
  assignmentReceipt?: WorkExecution;
}
export interface ItemJournal { load(): ItemRecovery | undefined; save(state: ItemRecovery | undefined): void; assertScope(api: WorkspaceApi): void }
/** Separate stable identities; persist the confirmed item before releasing its creation identity. */
export class CreateItemIntent {
  readonly create: ConsoleIntent;
  readonly assign: ConsoleIntent;
  private state: ItemRecovery;
  private recoveryError?: unknown;
  constructor(private journal?: ItemJournal) {
    this.state = {};
    try {this.state = journal?.load() ?? {};} catch (e) {this.recoveryError = e;}
    const store = (key: 'createPending' | 'assignPending') => journal ? {
      load: () => this.state[key],
      save: (pending: PendingConsoleRequest | undefined) => {this.state[key] = pending; this.persist();},
      assertScope: (api: WorkspaceApi) => journal.assertScope(api),
    } : undefined;
    this.create = new ConsoleIntent(store('createPending'));
    this.assign = new ConsoleIntent(store('assignPending'));
  }
  private persist() {this.journal?.save(this.state);}
  get item() {return this.state.item;}
  get input() {return this.state.input;}
  get assignment() {return this.state.assignment;}
  get assignmentReceipt() {return this.state.assignmentReceipt;}
  get locked() {return !!this.state.input || !!this.recoveryError;}
  async retry(api: WorkspaceApi) {
    if (!this.state.input) throw new Error('No saved work item request');
    return this.run(api, this.state.input, this.state.assignment);
  }
  async run(api: WorkspaceApi, input: NewItemInput, assignment?: NewAssignment) {
    if (this.recoveryError) throw this.recoveryError;
    this.journal?.assertScope(api);
    if (this.state.completed && this.state.item) {this.journal?.save(undefined); return this.state.item;}
    if (!this.state.input) {this.state.input = structuredClone(input); this.state.assignment = structuredClone(assignment);}
    if (JSON.stringify({input: this.state.input, assignment: this.state.assignment}) !== JSON.stringify({input, assignment})) throw new Error('Retry the original work item');
    this.persist();
    if (!this.state.item) {
      this.state.item = await this.create.run<WorkItem>(api, '/workspace/work-item/create', {...input}, 'requestId', item => {
        this.state.item = item; this.persist(); return false;
      });
      this.persist();
    }
    if (assignment) {
      await this.assign.run<WorkExecution>(api, '/workspace/work-execution/assign', {workItemId: this.state.item.id, version: this.state.item.version, ...assignment}, 'requestId', receipt => {
        this.state.assignmentReceipt = receipt;
        const blocked = retainBlockedDelivery(receipt);
        this.state.completed = !blocked; this.persist(); return blocked;
      });
      if (isBlocked(this.state.assignmentReceipt)) return this.state.item;
    }
    const item = this.state.item;
    this.journal?.save(undefined);
    return item;
  }
}
