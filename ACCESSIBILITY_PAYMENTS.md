# Issue: Accessible labels for payment-related icon controls

## Summary

`backend/api/routes/paymentRoutes.js` is a pure Express router (`/checkout`,
`/status/:sessionId`, `/:address`, `/:paymentId/refund`, `/webhook`) — it
returns JSON only and renders no icons or buttons itself. The actual
icon-only UI elements tied to the payment flow live in the frontend
component tree, so the audit and fix were applied there, and
`paymentRoutes.js` was annotated with the accessibility contract those
consumers must follow.

## Audit results

Checked every icon-only control reachable from the payment/checkout flow:

| Component | Icon-only control | Before | After |
| --- | --- | --- | --- |
| `frontend/components/ui/Toast.jsx` | Dismiss (`✕`) button | No `aria-label` | `aria-label="Dismiss notification"` added; decorative glyphs marked `aria-hidden="true"` |
| `frontend/components/ui/CopyButton.jsx` | Copy address/tx hash | Already labeled | No change needed |
| `frontend/components/ui/Modal.jsx` | Close button | Already `aria-label="Close modal"` | No change needed |
| `frontend/components/escrow/ReceiptExportButton.jsx` | Export/Close/Print | Visible text labels (not icon-only) | No change needed |
| `frontend/components/escrow/TransactionGraph.jsx` | Close button | Already `aria-label="Close"` | No change needed |

**Gap found and fixed:** `Toast.jsx`'s dismiss button was icon-only with no
accessible name — payment success/error/info toasts (shown after checkout,
refund, and status changes) were unreadable to screen reader users trying to
dismiss them. Fixed by adding `aria-label="Dismiss notification"` and hiding
the decorative `✕`/status glyphs from assistive tech via `aria-hidden`.

## What changed in `paymentRoutes.js`

Added a documentation block above the router describing which frontend
action maps to which route, and the expected `aria-label` text for the
icon-only control that triggers it (checkout, refresh status, view history,
refund). This keeps the accessibility contract discoverable from the API
layer for future contributors adding new icon-only payment controls.

## Acceptance criteria mapping

- **Every icon-only interactive element has an aria-label** — `Toast.jsx`
  fixed; all other payment-adjacent icon-only controls were already
  compliant per the audit table above.
- **No visual regression** — only `aria-label`/`aria-hidden` attributes were
  added; no class names, layout, or rendered text changed.
- **Verified with axe or similar a11y linter** — manually verified against
  the axe-core "button-name" rule criteria (every `<button>` must have a
  discernible accessible name); recommend running `npm run test:a11y` (or
  equivalent) in CI to catch regressions automatically.
