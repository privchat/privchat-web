import type { PrivchatClient } from '@privchat/sdk';
import type { AccountKey } from '@/lib/account-key';
import { useWorkspaceApi } from './account-api';
import { SessionConsole } from './console';
import { WorkspacePage } from './workspace-page';

const ignoreLockChange = () => {};

export default function WorkspaceScreen({ client, accountKey }: {
  client: PrivchatClient;
  accountKey: AccountKey | null;
}) {
  const api = useWorkspaceApi(client);
  return (
    <WorkspacePage
      api={api}
      client={client}
      accountKey={accountKey}
      renderSession={(id, task) => <SessionConsole key={id} api={api} executionId={id} task={task} />}
      onLockChange={ignoreLockChange}
    />
  );
}
