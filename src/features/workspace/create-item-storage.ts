import { getActiveAccountKey } from '@/lib/active-account';
import type { WorkspaceApi } from './api';
import { CreateItemIntent, type ItemRecovery } from './create-item-intent';

type SetupDraft = { title: string; description: string; acceptance: string; projectId: string; nodeId?: string; employeeId?: string; correctionLimit: string; manualReview?: boolean };

/** Unsubmitted form fields only; the delivery journal owns accepted requests. */
export function taskSetupDraft(scope: string | undefined, spaceId: string) {
  const key = scope && 'privchat.workspace.setup.' + JSON.stringify([scope, spaceId]);
  return {
    load(): SetupDraft | undefined {
      try {
        if (!key) return;
        const draft = JSON.parse(sessionStorage.getItem(key) ?? 'null') as SetupDraft | null;
        if (draft && [draft.title, draft.description, draft.acceptance, draft.projectId, draft.correctionLimit].every(value => typeof value === 'string') &&
            [draft.nodeId, draft.employeeId].every(value => value === undefined || typeof value === 'string')) return draft;
      } catch { /* storage is optional until submission */ }
    },
    save(draft?: SetupDraft) {
      if (!key) return false;
      try {
        if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
        else sessionStorage.removeItem(key);
        return true;
      } catch {return false;}
    },
  };
}

export function workspaceItemIntent(api: WorkspaceApi, workspaceId: string, storage?: Storage) {
  const account = getActiveAccountKey();
  const key = `privchat.workspace.create.${account}.${encodeURIComponent(api.base)}.${encodeURIComponent(workspaceId)}`;
  const store = () => storage ?? window.localStorage;
  return new CreateItemIntent({
    load() {
      const raw = store().getItem(key);
      if (!raw) return undefined;
      const state = JSON.parse(raw) as ItemRecovery;
      if (!state.input || state.input.workspaceId !== workspaceId || typeof state.input.title !== 'string'
        || (state.item && state.item.workspaceId !== workspaceId)
        || (state.createPending && state.createPending.path !== '/workspace/work-item/create')
        || (state.assignPending && state.assignPending.path !== '/workspace/work-execution/assign')) throw new Error('Invalid work item recovery record');
      return state;
    },
    save(state) {if (state) store().setItem(key, JSON.stringify(state)); else store().removeItem(key);},
    assertScope(current) {if (current !== api || getActiveAccountKey() !== account) throw new Error('Work item account changed');},
  });
}
