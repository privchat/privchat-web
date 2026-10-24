import { expect, test } from '@playwright/test';
import { mayUnpinGroupMessage } from '../../src/features/chat/pin-policy';

test('owner/admin/member unpin policy does not depend on message authorship', () => {
  expect(mayUnpinGroupMessage(true, 'owner', 'owner', 'admin')).toBe(true);
  expect(mayUnpinGroupMessage(true, 'owner', 'owner', 'owner')).toBe(true);
  expect(mayUnpinGroupMessage(true, 'admin', 'owner', 'admin')).toBe(true);
  expect(mayUnpinGroupMessage(true, 'admin2', 'owner', 'admin')).toBe(true);
  expect(mayUnpinGroupMessage(true, 'admin', 'owner', 'owner')).toBe(false);
  expect(mayUnpinGroupMessage(false, 'member', 'owner', 'admin')).toBe(false);
  expect(mayUnpinGroupMessage(true, 'admin', undefined, 'admin')).toBe(false);
  expect(mayUnpinGroupMessage(true, undefined, 'owner', 'admin')).toBe(false);
});
