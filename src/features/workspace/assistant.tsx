import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PrivchatClient } from '@privchat/sdk';
import { Button } from '@/components/ui/button';
import { getActiveAccountKey } from '@/lib/active-account';
import { PlatformApiError, PlatformHttpError } from '@/lib/platform-errors';
import type { WorkspaceApi } from './api';
import { assistantErrorLabel, type AssistantIdentity } from './assistant-api';
import { openPersonalAssistantChat, type SelectPersonalChat } from './personal-chat';
import { roomFailure } from './room-observer';

// Only a claim/open gate, never a separate conversation or message composer.
export function AssistantPage({api, client, onBack, onSelect}: {
  api: WorkspaceApi;
  client: PrivchatClient;
  onBack: () => void;
  onSelect: SelectPersonalChat;
}) {
  const {t} = useTranslation();
  const label = (key: string) => t(`agentWorkspace.${key}`);
  const [identity, setIdentity] = useState<AssistantIdentity>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState({version: 0, claim: false});

  useEffect(() => {
    let cancelled = false;
    const account = getActiveAccountKey();
    const uid = client.sessionSnapshot().user_id;
    const route = window.location.hash;
    const current = () => !cancelled && window.location.hash === route
      && getActiveAccountKey() === account && client.sessionSnapshot().user_id === uid;
    setBusy(true); setError(''); setIdentity(undefined);
    void (async () => {
      let result: AssistantIdentity;
      if (attempt.claim) {
        const assistant = await api.post<NonNullable<AssistantIdentity['assistant']>>('/assistant/personal/claim', {confirmed: true});
        result = {available: true, claimed: true, assistant};
      } else {
        result = await api.get<AssistantIdentity>('/assistant/personal');
      }
      if (!current()) return;
      setIdentity(result);
      if (result.claimed) await openPersonalAssistantChat(api, client, onSelect, current);
    })().catch(e => {
      if (!current()) return;
      setError(roomFailure(e) === 'denied' ? 'denied'
        : e instanceof PlatformApiError ? assistantErrorLabel(e.machineCode ?? '', 'failed')
        : e instanceof PlatformHttpError && [404, 405, 501].includes(e.status) ? 'unsupported' : 'error');
    }).finally(() => {if (current()) setBusy(false);});
    return () => {cancelled = true;};
  }, [api, client, onSelect, attempt]);

  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" data-testid="assistant-page">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{label('assistantTitle')}</h1>
      <Button variant="outline" onClick={onBack}>{label('back')}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{label('assistantChatHint')}</p>
    {busy && <p role="status">{label('loading')}</p>}
    {error && <p role="alert">{label(error)}</p>}
    {!busy && identity && !identity.claimed && <section>
      <p>{label(identity.available ? 'assistantUnclaimed' : 'unsupported')}</p>
      {identity.available && <Button onClick={() => {
        if (window.confirm(label('claimAssistant'))) setAttempt(old => ({version: old.version + 1, claim: true}));
      }}>{label('claimAssistant')}</Button>}
    </section>}
    {!busy && error && <Button onClick={() => setAttempt(old => ({version: old.version + 1, claim: false}))}>{label('refresh')}</Button>}
  </main>;
}
