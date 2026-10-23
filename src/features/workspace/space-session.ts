import type { WorkspaceEmployee } from './api';

/** Employee/private bindings are deliberately not inputs to a workspace session claim. */
export function spaceSession(employee: WorkspaceEmployee): {kind: 'unknown' | 'firstSend' | 'bound'; nativeSessionId?: string} {
  if (employee.workspaceSessionKnown !== true) return {kind: 'unknown'};
  if (employee.workspaceNativeSessionId) return {kind: 'bound', nativeSessionId: employee.workspaceNativeSessionId};
  if (employee.workspaceExecutionId) return {kind: 'unknown'};
  return {kind: 'firstSend'};
}
