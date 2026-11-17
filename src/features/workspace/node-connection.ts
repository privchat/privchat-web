import type { Node } from './api';

type NodeContact = Pick<Node, 'state' | 'lastSeenAt' | 'lastReportAt' | 'disconnectedAt' | 'revokedAt'>;

// Keep the App's three 15-second reconcile windows; an explicit disconnect wins immediately.
const ONLINE_WINDOW_MS = 45_000;

export function latestNodeContact(node: NodeContact): number | undefined {
  const seen = Math.max(node.lastSeenAt ?? 0, node.lastReportAt ?? 0);
  return seen > 0 ? seen : undefined;
}

export function isNodeOnline(node: NodeContact, now: number): boolean {
  const seen = latestNodeContact(node);
  return node.state === 'active' && node.revokedAt == null && seen !== undefined
    && (node.disconnectedAt == null || node.disconnectedAt < seen)
    && now - seen <= ONLINE_WINDOW_MS;
}

/** Missing contact telemetry alone does not override server-projected availability. */
export function isKnownNodeOffline(node: NodeContact | undefined): boolean {
  return !!node && (node.state !== 'active' || node.revokedAt != null ||
    node.disconnectedAt != null || latestNodeContact(node) !== undefined) && !isNodeOnline(node, Date.now());
}
