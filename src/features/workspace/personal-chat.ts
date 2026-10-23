import { ChannelType, type PrivchatClient } from '@privchat/sdk';
import type { WorkspaceApi } from './api';

export interface PersonalAssistantChat {
  channelId: string;
  assistantUid: string;
  name: string;
  avatarUrl?: string;
}

export type SelectPersonalChat = (channelId: string, channelType: number, peer: {uid: string; name: string}) => void;

/** The platform selects the owned Direct; the SDK and existing chat UI own its messages. */
export async function openPersonalAssistantChat(
  api: Pick<WorkspaceApi, 'post'>,
  client: Pick<PrivchatClient, 'bootstrapChannels'>,
  select: SelectPersonalChat,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  const chat = await api.post<PersonalAssistantChat>('/assistant/personal/open-chat', {});
  if (!isCurrent()) return;
  if (!chat || typeof chat.channelId !== 'string' || !chat.channelId.trim()
    || typeof chat.assistantUid !== 'string' || !chat.assistantUid.trim()
    || typeof chat.name !== 'string' || !chat.name.trim()) {
    throw new Error('Invalid personal assistant chat');
  }
  await client.bootstrapChannels();
  if (!isCurrent()) return;
  // ConversationPanel/useConversation loads history and sends through the ordinary SDK path.
  select(chat.channelId, ChannelType.Direct, {uid: chat.assistantUid, name: chat.name});
}
