import { expect, test } from '@playwright/test';
import { RpcError } from '@privchat/sdk';
import { RequestTimeoutError, TransportError } from '@msgtrans/client';
import { groupIntroductionErrorText } from '../../src/features/chat/group-introduction-error';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { vi } from '../../src/i18n/locales/vi';

for (const [locale, copy] of Object.entries({ en, 'zh-CN': zhCN, vi })) {
  test(`introduction errors use existing localized copy (${locale}), never raw diagnostics`, () => {
    const translations: Record<string, string> = {
      'server_error.permission_denied': copy.server_error.permission_denied,
      'server_error.service_unavailable': copy.server_error.service_unavailable,
      'groups.settings_save_failed': copy.groups.settings_save_failed,
    };
    const t = (key: string) => {
      expect(translations[key]).toBeTruthy();
      return translations[key]!;
    };
    const rpc = (code: number) => new RpcError('group/group/update', { code, message: 'PRIVATE SERVER DIAGNOSTICS' });
    for (const code of [10004, 10008]) {
      expect(groupIntroductionErrorText(rpc(code), t)).toBe(copy.server_error.permission_denied);
    }
    for (const error of [rpc(3), rpc(5), rpc(9), new TransportError('PRIVATE TRANSPORT DIAGNOSTICS'), new RequestTimeoutError(1, 1000)]) {
      expect(groupIntroductionErrorText(error, t)).toBe(copy.server_error.service_unavailable);
    }
    for (const error of [rpc(4), rpc(10100), new Error('PRIVATE EXCEPTION'), { message: 'PRIVATE VALUE' }, null, undefined]) {
      expect(groupIntroductionErrorText(error, t)).toBe(copy.groups.settings_save_failed);
    }
  });
}
