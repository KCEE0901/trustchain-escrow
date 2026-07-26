# Frontend Component Library and Design Tokens

This document describes Trustchain Escrow's frontend component library and the design
tokens that govern its visual language. It is aimed at contributors extending the UI
and at integrators building on top of the Trustchain design system.

All components live in `frontend/components/` and are written as React Server / Client
Components for Next.js 14 App Router. The design system is built with Tailwind CSS and
assumes a dark-first palette with light-mode overrides via `dark:` variants.

---

## Table of Contents

1. [Design Tokens](#design-tokens)
   - [Colour Palette](#colour-palette)
   - [Typography](#typography)
   - [Spacing and Sizing](#spacing-and-sizing)
   - [Border Radius and Shadow](#border-radius-and-shadow)
2. [Component Catalogue](#component-catalogue)
   - [Primitives](#primitives)
   - [Feedback and Status](#feedback-and-status)
   - [Forms and Inputs](#forms-and-inputs)
   - [Layout and Navigation](#layout-and-navigation)
   - [Escrow-Specific Components](#escrow-specific-components)
3. [Component Usage Patterns](#component-usage-patterns)
4. [Accessibility Guidelines](#accessibility-guidelines)
5. [Adding a New Component](#adding-a-new-component)
6. [Cross-References](#cross-references)

---

## Design Tokens

Design tokens are Tailwind utility classes drawn from a consistent palette. They are
not extracted into a separate token file; instead they are applied directly in JSX
using the `cn()` utility from `frontend/lib/utils.js` (a thin `clsx` + `tailwind-merge`
wrapper).

### Colour Palette

Trustchain's UI uses Tailwind's default palette constrained to the following semantic
roles:

| Role              | Light token (class)         | Dark token (class)           | Example use                  |
|-------------------|-----------------------------|------------------------------|------------------------------|
| Brand / primary   | `indigo-600`                | `indigo-500`                 | Primary buttons, links       |
| Surface / base    | `white`                     | `gray-900`                   | Page background              |
| Surface / raised  | `gray-50`                   | `gray-800`                   | Cards, panels                |
| Surface / overlay | `gray-100`                  | `gray-700`                   | Modals, dropdowns            |
| Border            | `gray-200`                  | `gray-700`                   | Card borders, dividers       |
| Text / primary    | `gray-900`                  | `gray-100`                   | Headings, body copy          |
| Text / secondary  | `gray-600`                  | `gray-400`                   | Labels, helper text          |
| Text / muted      | `gray-400`                  | `gray-600`                   | Placeholders, disabled text  |
| Success           | `green-600` / `green-400`   | `green-500/20` bg            | Active status, approvals     |
| Warning           | `yellow-600` / `yellow-400` | `yellow-500/20` bg           | Pending actions              |
| Danger            | `red-600` / `red-400`       | `red-900/30` bg              | Disputes, errors             |
| Info              | `blue-600` / `blue-400`     | `blue-500/20` bg             | Completed, informational     |

Status-specific badge colours map directly to escrow and milestone states:

```js
// frontend/components/ui/Badge.jsx
const STATUS_STYLES = {
  Active:    'bg-green-500/20 text-green-400 border-green-500/30',
  Completed: 'bg-blue-500/20  text-blue-400  border-blue-500/30',
  Disputed:  'bg-red-500/20   text-red-400   border-red-500/30',
  Cancelled: 'bg-gray-700/50  text-gray-400  border-gray-600/30',
  Pending:   'bg-gray-700/50  text-gray-400  border-gray-600/30',
  Submitted: 'bg-blue-500/20  text-blue-400  border-blue-500/30',
  Approved:  'bg-green-500/20 text-green-400 border-green-500/30',
  Rejected:  'bg-red-500/20   text-red-400   border-red-500/30',
};
```

### Typography

| Scale    | Tailwind class             | Use                          |
|----------|----------------------------|------------------------------|
| `xs`     | `text-xs` (12px)           | Captions, metadata           |
| `sm`     | `text-sm` (14px)           | Body text, button labels     |
| `base`   | `text-base` (16px)         | Default prose                |
| `lg`     | `text-lg` (18px)           | Card headings                |
| `xl`     | `text-xl` (20px)           | Section headings             |
| `2xl`    | `text-2xl` (24px)          | Page headings                |

Font weights in use: `font-medium` (500) for labels and button text; `font-semibold`
(600) for headings; `font-normal` (400) for body copy.

### Spacing and Sizing

Trustchain follows Tailwind's 4px base grid. The most common spacing steps are:

| Token | Value  | Typical use                         |
|-------|--------|-------------------------------------|
| `1`   | 4 px   | Icon-to-label gap                   |
| `2`   | 8 px   | Inner padding (compact elements)    |
| `3`   | 12 px  | Button padding (sm)                 |
| `4`   | 16 px  | Card inner padding, button gap      |
| `6`   | 24 px  | Section gap                         |
| `8`   | 32 px  | Page section spacing                |

### Border Radius and Shadow

- Rounded corners: `rounded` (4 px) on inputs; `rounded-lg` (8 px) on cards and modals;
  `rounded-full` on badges and avatars.
- Shadows: `shadow-sm` for raised cards; `shadow-lg` for modals.
- Borders: `border border-gray-700` (dark) / `border border-gray-200` (light) on all
  card surfaces.

---

## Component Catalogue

### Primitives

#### `Button`
**File:** `frontend/components/ui/Button.jsx`

Reusable button with four variants and three sizes. Renders as a Next.js `<Link>` when
`href` is provided.

| Prop        | Type                                        | Default     | Description                              |
|-------------|---------------------------------------------|-------------|------------------------------------------|
| `variant`   | `'primary' \| 'secondary' \| 'danger' \| 'ghost'` | `'primary'` | Visual style                             |
| `size`      | `'sm' \| 'md' \| 'lg'`                     | `'md'`      | Padding and font size                    |
| `isLoading` | `boolean`                                   | `false`     | Shows spinner and disables the button    |
| `disabled`  | `boolean`                                   | `false`     | Disables the button                      |
| `href`      | `string`                                    | —           | Renders as `<Link>` when provided        |
| `asChild`   | `boolean`                                   | `false`     | Wraps a single child with button styles  |

```jsx
import Button from '@/components/ui/Button';

<Button variant="primary" size="md" onClick={handleSubmit}>
  Create Escrow
</Button>

<Button variant="danger" isLoading={isSubmitting}>
  Raise Dispute
</Button>
```

---

#### `Badge`
**File:** `frontend/components/ui/Badge.jsx`

Coloured status pill for escrow and milestone states.

| Prop       | Type             | Default | Description                                    |
|------------|------------------|---------|------------------------------------------------|
| `status`   | `EscrowStatus`   | —       | Maps to a pre-defined colour style             |
| `variant`  | `string`         | —       | Alias for `status`; accepts `'success'` etc.   |
| `size`     | `'sm' \| 'md'`   | `'md'`  | Controls padding and font size                 |
| `children` | `ReactNode`      | —       | Label override                                 |

```jsx
import Badge from '@/components/ui/Badge';

<Badge status="Active" />
<Badge status="Disputed" size="sm" />
```

---

#### `Modal`
**File:** `frontend/components/ui/Modal.jsx`

Full-screen overlay dialog with header, body, and footer slots. Traps focus and closes
on Escape or backdrop click.

| Prop        | Type        | Default | Description                          |
|-------------|-------------|---------|--------------------------------------|
| `isOpen`    | `boolean`   | —       | Controls visibility                  |
| `onClose`   | `function`  | —       | Called on Escape or backdrop click   |
| `title`     | `string`    | —       | Modal heading                        |
| `children`  | `ReactNode` | —       | Modal body content                   |

---

#### `Spinner`
**File:** `frontend/components/ui/Spinner.jsx`

Inline SVG spinner that inherits the current text colour. Used inside `Button` and
standalone loading states.

| Prop    | Type             | Default | Description              |
|---------|------------------|---------|--------------------------|
| `size`  | `'sm' \| 'md' \| 'lg'` | `'md'` | Controls `w` and `h` classes |

---

#### `Skeleton` / `CardSkeleton` / `EscrowCardSkeleton` / `PageSkeleton`
**Files:** `frontend/components/ui/Skeleton.jsx`, `CardSkeleton.jsx`, etc.

Animated placeholder elements shown during data loading. Use these instead of
spinners for list-level loading to avoid layout shift.

```jsx
import { CardSkeleton } from '@/components/ui/CardSkeleton';

{isLoading ? <CardSkeleton /> : <EscrowCard escrow={data} />}
```

---

#### `Toast`
**File:** `frontend/components/ui/Toast.jsx`

Transient notification rendered at the bottom of the viewport. Call via the
`useToast` hook from `frontend/hooks/useToast.js`.

```jsx
const { toast } = useToast();
toast({ type: 'success', message: 'Milestone approved.' });
toast({ type: 'error',   message: 'Transaction failed.' });
```

---

#### `Tooltip`
**File:** `frontend/components/ui/Tooltip.jsx`

Hover/focus tooltip using a `title`-style popover. Wrap any element as `children`.

```jsx
<Tooltip content="Stellar address of the contract">
  <span>{truncateAddress(contractId)}</span>
</Tooltip>
```

---

### Feedback and Status

#### `ErrorAlert`
**File:** `frontend/components/ui/ErrorAlert.jsx`

Inline error banner. Accepts a `message` string or an `Error` object.

#### `ErrorBoundary`
**File:** `frontend/components/ui/ErrorBoundary.jsx`

React class error boundary. Wrap top-level routes or expensive subtrees.

#### `OfflineBanner` / `OfflineIndicator`
**Files:** `frontend/components/ui/OfflineBanner.jsx`, `OfflineIndicator.jsx`

Renders a banner or small icon when the browser is offline. Relies on the
`navigator.onLine` API and `online`/`offline` window events.

#### `RetryButton`
**File:** `frontend/components/ui/RetryButton.jsx`

A button pre-wired for retry semantics. Accepts an `onRetry` callback and shows a
spinner during the retry attempt.

---

### Forms and Inputs

#### `StellarAddressInput`
**File:** `frontend/components/ui/StellarAddressInput.jsx`

Text input that validates Stellar address format (G… or C… prefix, 56 characters) on
blur. Displays an inline error on invalid input.

```jsx
<StellarAddressInput
  label="Contractor address"
  value={contractor}
  onChange={setContractor}
/>
```

#### `XLMAmountInput`
**File:** `frontend/components/ui/XLMAmountInput.jsx`

Numeric input that restricts entry to valid XLM amounts (up to 7 decimal places) and
shows the current USD equivalent via the `PriceConverter` hook.

#### `FileDropZone`
**File:** `frontend/components/ui/FileDropZone.jsx`

Drag-and-drop file upload area. Emits file objects via `onFilesSelected`. Used in the
dispute evidence upload flow.

#### `CurrencySelector` / `CurrencyConverter` / `CurrencySwapper`
**Files:** `frontend/components/ui/CurrencySelector.jsx`, etc.

Controls for selecting and converting between Stellar assets. `CurrencySwapper`
combines selector and amount fields into a two-asset swap widget.

---

### Layout and Navigation

#### `StatCard`
**File:** `frontend/components/ui/StatCard.jsx`

KPI tile showing a label, a primary value, and an optional delta indicator (up/down
arrow with colour). Used in the dashboard overview.

| Prop      | Type     | Default | Description                   |
|-----------|----------|---------|-------------------------------|
| `label`   | `string` | —       | Metric name                   |
| `value`   | `string` | —       | Primary displayed value       |
| `delta`   | `number` | —       | Optional % change             |
| `trend`   | `'up' \| 'down'` | — | Arrow direction and colour |

#### `EmptyState`
**File:** `frontend/components/ui/EmptyState.jsx`

Centred placeholder shown when a list has no items. Accepts `title`, `description`,
and an optional action `Button`.

#### `BackToTop`
**File:** `frontend/components/ui/BackToTop.jsx`

Floating button that scrolls the window back to the top. Appears after the user
scrolls more than 400 px down.

---

### Escrow-Specific Components

#### `EscrowCard`
**File:** `frontend/components/escrow/EscrowCard.jsx`

Summary card displayed in the escrow list. Shows status badge, participants, total
amount, and milestone progress bar.

#### `MilestoneItem` / `MilestoneList`
**Files:** `frontend/components/escrow/MilestoneItem.jsx`, `MilestoneList.jsx`

`MilestoneList` renders an ordered list of `MilestoneItem` rows. Each row shows the
milestone description, amount, status badge, and contextual action buttons
(submit / approve / dispute).

#### `MilestonePlanner`
**File:** `frontend/components/escrow/MilestonePlanner.jsx`

Interactive canvas-based graph editor for visually defining milestone dependency order
during escrow creation. Nodes are draggable; edges are drawn between nodes to define
sequencing. Validates for cycles before committing.

#### `DisputeModal`
**File:** `frontend/components/escrow/DisputeModal.jsx`

Modal for raising a dispute. Accepts evidence IPFS CIDs via `FileDropZone` and calls
the dispute API endpoint on confirmation.

#### `CancelEscrowModal`
**File:** `frontend/components/escrow/CancelEscrowModal.jsx`

Confirmation modal for mutual cancellation. Requires both-party consent message.

#### `ReputationBadge`
**File:** `frontend/components/ui/ReputationBadge.jsx`

Displays a user's reputation tier (`NEW`, `TRUSTED`, `VERIFIED`, `EXPERT`) as a
colour-coded badge. Fetches score from the reputation API on mount.

#### `WalletStatus`
**File:** `frontend/components/ui/WalletStatus.jsx`

Shows the connected Freighter wallet address (truncated) and network indicator
(Testnet / Mainnet). Provides a "Connect Wallet" button when no wallet is connected.

---

## Component Usage Patterns

### Composing a Card

```jsx
import { cn } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

export function EscrowSummaryCard({ escrow }) {
  return (
    <div className={cn(
      'rounded-lg border border-gray-700 bg-gray-800 p-4',
      'flex flex-col gap-3'
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-100">{escrow.title}</span>
        <Badge status={escrow.status} size="sm" />
      </div>
      <Button variant="secondary" size="sm" href={`/escrows/${escrow.id}`}>
        View details
      </Button>
    </div>
  );
}
```

### Loading State Pattern

```jsx
import { EscrowCardSkeleton } from '@/components/ui/EscrowCardSkeleton';
import { EscrowCard } from '@/components/escrow/EscrowCard';

function EscrowList({ escrows, isLoading }) {
  if (isLoading) {
    return Array.from({ length: 3 }).map((_, i) => <EscrowCardSkeleton key={i} />);
  }
  return escrows.map(e => <EscrowCard key={e.id} escrow={e} />);
}
```

### Error Handling Pattern

```jsx
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { ErrorAlert } from '@/components/ui/ErrorAlert';

<ErrorBoundary fallback={<ErrorAlert message="Failed to load escrow." />}>
  <EscrowDetailView escrowId={id} />
</ErrorBoundary>
```

---

## Accessibility Guidelines

- All interactive elements must be keyboard reachable and show a visible `:focus-visible`
  ring (`ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-900`).
- Buttons must have a discernible text label or `aria-label` when icon-only.
- Modals must trap focus within the overlay and restore focus to the trigger element
  on close.
- Status badges use colour and a text label simultaneously — colour alone is not
  used to convey meaning.
- Screen reader text for truncated Stellar addresses is provided by `TruncatedAddress`
  which renders the full address in a `<span className="sr-only">` alongside the
  visible truncated form.
- All form inputs have associated `<label>` elements or `aria-label` attributes.

---

## Adding a New Component

1. Create the file in the appropriate subdirectory:
   - Generic UI primitives → `frontend/components/ui/`
   - Escrow-domain components → `frontend/components/escrow/`
   - Layout elements → `frontend/components/layout/`

2. Follow the JSDoc header pattern used in existing components (see `Button.jsx`).

3. Apply design tokens (colours, spacing, radius) from the [Colour Palette](#colour-palette)
   table above using Tailwind utilities.

4. Add a Storybook story in the same directory as `<ComponentName>.stories.jsx` if the
   component has multiple variants or interactive states.

5. Ensure the component passes the accessibility checklist in the section above.

6. Export from the appropriate barrel file if one exists, or import directly from the
   file path in consumers.

---

## Cross-References

- [Frontend Guide](frontend-guide.md)
- [Frontend State Management](frontend-state-management.md)
- [Frontend Testing](frontend-testing.md)
- [Glossary](glossary.md)
- [Architecture Overview](architecture-overview.md)
