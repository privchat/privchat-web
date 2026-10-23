import { WorkspaceApi } from './api';

export type AssistantActionKind = 'help' | 'status' | 'send_employee' | 'assign' | 'review' | 'cancel';
export interface AssistantContext {
  workspaceId?: string; workItemId?: string; bindingId?: string; agentId?: string;
  executionId?: string; workExecutionId?: string; workItemVersion?: number;
  evidenceNoteIds?: string[]; evidenceDescription?: string;
}
export interface AssistantReference {workspaceId?: string; workItemId?: string; agentId?: string; executionId?: string; workExecutionId?: string}
export interface AssistantWorkResult {outcome: string; summary: string; reference?: AssistantReference; state?: string; stateVersion?: number; errorCode?: string; replyKind?: string | null; detail?: string | null}
export interface AssistantMessage {id: string; requestId: string; role: string; text: string; kind: string; result?: AssistantWorkResult; createdAt: number}
export interface ConversationPage {items: AssistantMessage[]; nextAfterId: string; hasMore: boolean}
export interface ConversationSendResult {requestId: string; status: string; messages: AssistantMessage[]; reference?: AssistantReference}
export interface AssistantIdentity {available: boolean; claimed: boolean; assistant?: {assistantUid: string; name: string} | null}

export function isAssistantTask(result?: AssistantWorkResult): boolean {
  return !!result && (result.replyKind === 'task' || (result.replyKind == null && !!(result.state || result.reference)));
}

// Optional report fields are not a license to stringify arbitrary backend objects.
export function assistantReplyText(message: AssistantMessage): string[] {
  const result = message.result;
  const text = isAssistantTask(result) ? [result?.detail] : [message.text, result?.summary, result?.detail];
  return [...new Set(text
    .filter((value): value is string => typeof value === 'string' && !!value.trim()))];
}

export function assistantErrorLabel(code: string, outcome: string): string {
  const known: Record<string, string> = {
    ASSISTANT_WORK_UNAVAILABLE: 'unknown',
    ASSISTANT_PERSONAL_UNAVAILABLE: 'unsupported',
    ASSISTANT_PERSONAL_NOT_CLAIMED: 'assistantUnclaimed',
    ASSISTANT_CONVERSATION_CONFLICT: 'itemError',
    WORKSPACE_CONFLICT: 'itemError',
    WORKSPACE_EXECUTION_CONFLICT: 'itemError',
    WORKSPACE_FORBIDDEN: 'denied',
    WORKSPACE_NOT_FOUND: 'denied',
    WORKSPACE_BINDING_FORBIDDEN: 'denied',
    WORKSPACE_BINDING_NOT_FOUND: 'denied',
    AGENT_NODE_REVOKED: 'denied',
  };
  return known[code] ?? (outcome === 'unknown' ? 'unknown' : 'actionRejected');
}

export function conversationPage(api: WorkspaceApi, afterId: string) {
  return api.get<ConversationPage>(`/assistant/conversation/list?afterId=${encodeURIComponent(afterId)}&limit=50&refresh=true`);
}
