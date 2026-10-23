import { test, expect } from '@playwright/test';
import { publicRecords } from '../../src/features/workspace/public-records';
import { enWorkspace, zhWorkspace, zhTWWorkspace, viWorkspace } from '../../src/i18n/workspace';

test('renders only normalized public output and enumerated state, never native reasoning or arbitrary payloads', () => {
  expect(publicRecords({seq: 1, kind: 'output', payload: {items: [
    {kind: 'assistant_text', text: 'public commentary'},
    {kind: 'tool_summary', text: '<script>untrusted plain text</script>', input: {token: 'secret'}},
    {kind: 'reasoning', text: 'private thinking'},
    {kind: 'assistant_text', nativeKind: 'reasoning', text: 'hidden native chain'},
    {kind: 'unknown', text: 'unsupported content'},
    {kind: 'artifact', artifactRef: 'file:///private/path'},
  ], token: 'secret'}})).toEqual([
    {kind: 'assistant_text', text: 'public commentary'},
    {kind: 'tool_summary', text: '<script>untrusted plain text</script>'},
  ]);
  expect(publicRecords({seq: 2, kind: 'state', payload: {state: 'running', nativeSessionId: 'private'}})).toEqual([{kind: 'state', state: 'running'}]);
  expect(publicRecords({seq: 3, kind: 'state', payload: {state: 'made_up'}})).toEqual([]);
  expect(publicRecords({seq: 4, kind: 'native', payload: {text: 'do not expose'}})).toEqual([]);
  expect(publicRecords({seq: 5, kind: 'permission_requested', payload: {summary: 'secret params'}})).toEqual([{kind: 'permission_requested'}]);
  expect(publicRecords({seq: 6, kind: 'permission_resolved', payload: {input: 'secret params'}})).toEqual([{kind: 'permission_resolved'}]);
  expect(publicRecords({seq: 6, kind: 'gap', payload: {}})).toEqual([{kind: 'gap'}]);
});

for (const [locale, copy] of Object.entries({en: enWorkspace, 'zh-CN': zhWorkspace, 'zh-TW': zhTWWorkspace, vi: viWorkspace})) {
  test(`WF-05 keys and partial-coverage copy exist in ${locale}`, () => {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(enWorkspace).sort());
    for (const key of ['activity', 'activityHint', 'activityUnsupported', 'itemStatus', 'latestExecution', 'notExecuted', 'noFinalResult', 'executionDetailsHint', 'openWorkDetails', 'archivedRecords', 'archiveCoverage', 'archiveUnsupported', 'archiveEmpty', 'archiveGap', 'lastArchivedSeq', 'record_state', 'record_tool_summary', 'record_permission_requested', 'record_permission_resolved', 'record_permission_hint'] as const) {
      expect(copy[key].trim()).not.toBe('');
    }
  });
}

import { validateSessionRecordsPage } from '../../src/features/workspace/public-records';
const archived = (seq: number) => ({protocolVersion: 1, executionId: 'e1', eventId: `event-${seq}`, seq, kind: 'output', payload: {items: [{kind: 'assistant_text', text: 'public'}]}});
const archivePage = () => ({items: [archived(2), archived(3)], nextCursor: '3', snapshotRequired: false, lastArchivedSeq: 3, coverage: 'normalized_events_only'});

test('accepts scoped ascending archive pages and explicit empty archives', () => {
  const page = archivePage();
  expect(validateSessionRecordsPage(page, 'e1', '1')).toBe(page);
  expect(validateSessionRecordsPage({...page, items: [], nextCursor: null}, 'e1', '3').items).toEqual([]);
});

for (const [name, change] of Object.entries<(page: any) => void>({
  'missing protocol version': p => {delete p.items[0].protocolVersion;},
  'wrong protocol version': p => {p.items[0].protocolVersion = 2;},
  'missing execution ownership': p => {delete p.items[0].executionId;},
  'cross execution': p => {p.items[0].executionId = 'e2';},
  'sequence at afterSeq': p => {p.items[0].seq = 1;},
  'sequence beyond archive boundary': p => {p.lastArchivedSeq = 2;},
  'descending sequence': p => {p.items.reverse();},
  'duplicate sequence': p => {p.items[1].seq = 2;},
  'noninteger sequence': p => {p.items[0].seq = 2.5;},
  'cursor not last sequence': p => {p.nextCursor = '2';},
  'nonprogressing cursor': p => {p.nextCursor = '1';},
  'opaque cursor': p => {p.nextCursor = 'opaque';},
  'cursor on empty page': p => {p.items = [];},
  'unsafe archive boundary': p => {p.lastArchivedSeq = Number.MAX_SAFE_INTEGER + 1;},
  'unknown coverage': p => {p.coverage = 'complete';},
})) {
  test(`rejects archive page: ${name}`, () => {
    const page = archivePage(); change(page);
    expect(() => validateSessionRecordsPage(page, 'e1', '1')).toThrow('Invalid records page');
  });
}

import { roomFailure } from '../../src/features/workspace/room-observer';
import { PlatformApiError } from '../../src/lib/platform-errors';

test('permission machine codes deny access precisely; ordinary 10200 business failures are not revocations', () => {
  for (const code of ['AGENT_NODE_REVOKED', 'AGENT_CAPABILITY_NOT_GRANTED', 'AGENT_ACTOR_FORBIDDEN', 'WORKSPACE_FORBIDDEN']) {
    expect(roomFailure(new PlatformApiError(10200, code))).toBe('denied');
  }
  for (const code of ['AGENT_SESSION_BUSY', 'AGENT_PERMISSION_STALE', 'AGENT_COMMAND_EXPIRED', 'WORKSPACE_ARCHIVED', 'OPERATION_NOT_ALLOWED']) {
    expect(roomFailure(new PlatformApiError(10200, code))).toBe('stale');
  }
  expect(roomFailure({response: {reason_code: 13}})).toBe('denied');
  expect(roomFailure({response: {reason_code: 11}})).toBe('stale');
  expect(roomFailure({code: 10200, message: 'AGENT_NODE_REVOKED'})).toBe('stale');
});
