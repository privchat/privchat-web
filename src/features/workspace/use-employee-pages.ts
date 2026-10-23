import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceApi } from './api';
import { EmployeePages } from './employee-pages';

export function useEmployeePages(api: WorkspaceApi, workspaceId: string, projectId?: string) {
  const pages = useMemo(() => new EmployeePages(api, workspaceId, projectId), [api, workspaceId, projectId]);
  const state = useSyncExternalStore(pages.subscribe, pages.getSnapshot);
  useEffect(() => {void pages.refresh(); return () => pages.dispose();}, [pages]);
  return {...state, more: pages.more, refresh: pages.refresh};
}
