import {test, expect} from '@playwright/test';
import {isNodeOnline, latestNodeContact} from '../../src/features/workspace/node-connection';

const now = 1_000_000;
const active = {state: 'active'};

test('a paired node needs recent contact before showing online', () => {
  expect(isNodeOnline(active, now)).toBe(false);
  expect(isNodeOnline({...active, lastReportAt: now - 45_000}, now)).toBe(true);
  expect(isNodeOnline({...active, lastReportAt: now - 45_001}, now)).toBe(false);
});

test('disconnect wins over contact, until a later authenticated contact', () => {
  const disconnected = {...active, lastReportAt: now - 1000, disconnectedAt: now - 500};
  expect(isNodeOnline(disconnected, now)).toBe(false);
  expect(isNodeOnline({...disconnected, lastSeenAt: now - 500}, now)).toBe(false);
  const reconnected = {...disconnected, lastSeenAt: now - 100};
  expect(latestNodeContact(reconnected)).toBe(now - 100);
  expect(isNodeOnline(reconnected, now)).toBe(true);
  expect(isNodeOnline({...reconnected, revokedAt: now}, now)).toBe(false);
});
