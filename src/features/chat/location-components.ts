import { ComponentConfigClient, MapError } from '@privchat/location-web';
import type { ComponentConfig } from '@privchat/location-web';
import { loadSession } from '../../lib/session-storage';
import { activePlatform } from '../../lib/platform-session';
import { getEnvelope, requireData } from '../../lib/platform-envelope';

// Reuses the active session and authenticated envelope transport; no map-specific token storage.
export const locationComponents = new ComponentConfigClient(() => {
  const session = loadSession();
  if (!session || session.account_mode !== 'platform' || !session.platform_base_url) return undefined;
  return { baseUrl: activePlatform().baseUrl, account: session.user_id,
    epoch: session.saved_at, platform: 'web' };
}, async url => {
  const { baseUrl, token } = activePlatform();
  if (url !== `${baseUrl}/config/components?platform=web`) throw new MapError('CANCELLED');
  return requireData(await getEnvelope<ComponentConfig>(url, token), 'component config');
});
