# Issue: Keyboard accessibility for `frontend/hooks/useEscrow.js`

## Summary

`frontend/hooks/useEscrow.js` is a data-fetching hook module (SWR-based) and
does not itself render any DOM/JSX — it has no buttons, links, or click
handlers of its own. To satisfy the accessibility requirement in a way that's
actually usable by the components that *do* render escrow controls
(approve/release/dispute/cancel buttons elsewhere in the app), this file now
also exports a small set of reusable keyboard-accessibility helpers that
those components can adopt.

## What changed

- Added `useKeyboardActivation(onActivate, onCancel)` — returns an
  `onKeyDown` handler that treats `Enter`/`Space` as activation (mirroring
  `onClick`) and `Escape` as cancel. `Tab` is deliberately left alone so the
  browser's native focus order is preserved.
- Added `useFocusRingClass(extra)` — returns Tailwind `focus-visible:*`
  classes so keyboard focus is always visibly indicated, without changing
  mouse/touch appearance.
- Added `useAccessibleControlProps({ onActivate, onCancel, label, disabled })`
  — a convenience wrapper that bundles `role="button"`, `tabIndex`,
  `aria-label`, `aria-disabled`, the keyboard handler, and the focus-ring
  class into one props object for non-native interactive elements (e.g. a
  `<div>` styled as a button).

## Why this approach

The existing exports (`useEscrow`, `useUserEscrows`, `useEscrowList`) were
left untouched — no regression to existing behavior. The new hooks are
additive and opt-in: any component that currently only has an `onClick`
handler can adopt `useKeyboardActivation`/`useAccessibleControlProps` without
changing its click behavior.

## Acceptance criteria mapping

- **Component is fully operable via keyboard** — components adopting
  `useAccessibleControlProps`/`useKeyboardActivation` get Enter/Escape
  handling for free; native `<button>`/`<a>` elements already support this
  in browsers and don't need the helper.
- **Focus states are visible** — `useFocusRingClass` provides a visible
  `focus-visible` ring.
- **No regression to existing click handlers** — all new code is additive;
  nothing in the existing hook exports was modified or removed.
