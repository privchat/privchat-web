// Mutates `document.title` to "(N) {original}" so the OS task bar /
// browser tab carries an unread badge. Restores the original title on
// unmount. Single-component-per-app contract — mounting in multiple
// places will fight for the title; ChatWorkspace owns it.

import { useEffect, useRef } from 'react';

export function useTabBadge(unreadTotal: number) {
  const originalRef = useRef<string | null>(null);

  useEffect(() => {
    if (originalRef.current === null) originalRef.current = document.title;
    return () => {
      if (originalRef.current !== null) document.title = originalRef.current;
    };
  }, []);

  useEffect(() => {
    const original = originalRef.current ?? document.title;
    if (unreadTotal > 0) {
      const n = unreadTotal > 99 ? '99+' : String(unreadTotal);
      document.title = `(${n}) ${original}`;
    } else {
      document.title = original;
    }
  }, [unreadTotal]);
}
