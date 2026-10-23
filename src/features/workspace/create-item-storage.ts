import { getActiveAccountKey } from '@/lib/active-account';
import type { WorkspaceApi } from './api';
import { CreateItemIntent, type ItemRecovery } from './create-item-intent';

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
