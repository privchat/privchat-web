// R5.2 feature flag for the virtualized timeline. Default OFF — the
// plain MessageList path remains the production code path. Flip the
// flag with `VITE_PRIVCHAT_VIRTUAL_TIMELINE=1` at build / dev time
// to opt in.
//
// This is a pure read of `import.meta.env`, evaluated at build time
// by Vite — no runtime config wiring, no React state. Tree-shakers
// can drop the disabled branch from the bundle when the flag is
// resolved at build time, so leaving the flag off has near-zero
// bundle cost.

export function isVirtualTimelineEnabled(): boolean {
  return import.meta.env.VITE_PRIVCHAT_VIRTUAL_TIMELINE === '1';
}
