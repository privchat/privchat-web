// `useLazyMount(open)` — defers a child component's mount until the
// first time `open` flips true, then keeps it mounted thereafter.
//
// Used with `<Suspense>` + `lazy(() => import(...))` so the chunk
// loads on demand BUT the close animation isn't truncated by an
// abrupt unmount (Radix Dialog's data-state="closed" transition
// gets cut if we unmount synchronously when `open` flips false).
//
// Returns a boolean: render the lazy component when this is true.

import { useEffect, useState } from 'react';

export function useLazyMount(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open && !mounted) setMounted(true);
  }, [open, mounted]);
  return mounted;
}
