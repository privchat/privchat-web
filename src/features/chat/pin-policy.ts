/** Owners may unpin anything; admins may not remove an owner's pin. Server still authorizes writes. */
export function mayUnpinGroupMessage(manager: boolean, selfId: string | undefined, ownerId: string | undefined, pinnedBy: string): boolean {
  return manager && !!selfId && !!ownerId && (selfId === ownerId || pinnedBy !== ownerId);
}
