import MilestoneItem from './MilestoneItem';
import { I18nProvider } from '../../i18n/index.jsx';
import { ToastProvider } from '../../contexts/ToastContext.jsx';

/**
 * MilestoneItem renders an escrow milestone item along with its
 * status badge, amount, description, timeline connector, and contextual
 * action buttons based on the user's role (client, freelancer, or observer).
 */
export default {
  title: 'Escrow/MilestoneItem',
  component: MilestoneItem,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <I18nProvider>
        <ToastProvider>
          <div className="w-full max-w-xl mx-auto p-4 bg-gray-950 text-white rounded-xl">
            <Story />
          </div>
        </ToastProvider>
      </I18nProvider>
    ),
  ],
  argTypes: {
    role: {
      control: 'select',
      options: ['client', 'freelancer', 'observer'],
      description: 'Role of the active viewer determining available actions',
    },
    isLast: {
      control: 'boolean',
      description: 'Whether this is the last milestone in the list (hides connector line)',
    },
    onApprove: { action: 'approved' },
    onReject: { action: 'rejected' },
    onSubmit: { action: 'submitted' },
  },
  args: {
    index: 0,
    isLast: false,
    role: 'client',
  },
};

// ── 1. Pending ───────────────────────────────────────────────────────────────

export const Pending = {
  args: {
    role: 'freelancer',
    index: 0,
    isLast: false,
    milestone: {
      id: 1,
      title: 'Frontend Architecture & UI Setup',
      amount: '2500000000',
      status: 'Pending',
      submittedAt: null,
      description:
        'Initial setup of Next.js application, Tailwind CSS design system, and foundational components.',
    },
  },
};

// ── 2. Submitted ─────────────────────────────────────────────────────────────

export const Submitted = {
  args: {
    role: 'client',
    index: 1,
    isLast: false,
    milestone: {
      id: 2,
      title: 'Smart Contract Integration',
      amount: '3500000000',
      status: 'Submitted',
      submittedAt: '2026-09-20T14:30:00Z',
      description:
        'Completed Stellar Soroban smart contract client bindings and end-to-end escrow lifecycle interactions.',
    },
  },
};

// ── 3. Approved ──────────────────────────────────────────────────────────────

export const Approved = {
  args: {
    role: 'client',
    index: 2,
    isLast: false,
    milestone: {
      id: 3,
      title: 'API Gateway & Real-Time WebSockets',
      amount: '1800000000',
      status: 'Approved',
      submittedAt: '2026-09-15T10:00:00Z',
      description:
        'REST endpoints and WebSocket service for real-time escrow notifications and state tracking.',
    },
  },
};

// ── 4. Released ──────────────────────────────────────────────────────────────

export const Released = {
  args: {
    role: 'client',
    index: 3,
    isLast: false,
    milestone: {
      id: 4,
      title: 'Security Audit & Vulnerability Remediation',
      amount: '5000000000',
      status: 'Released',
      submittedAt: '2026-09-10T09:00:00Z',
      description:
        'Passed external security audit with zero high-severity vulnerabilities. Funds released to freelancer.',
    },
  },
};

// ── 5. Disputed ──────────────────────────────────────────────────────────────

export const Disputed = {
  args: {
    role: 'client',
    index: 4,
    isLast: true,
    milestone: {
      id: 5,
      title: 'Cross-Browser Responsive Layouts',
      amount: '2200000000',
      status: 'Disputed',
      submittedAt: '2026-09-22T16:45:00Z',
      description:
        'Dispute raised regarding layout breaking on Safari iOS and missing tablet breakpoints.',
      evidence: [
        {
          name: 'ios_safari_layout_break_screenshot.png',
          url: 'https://example.com/evidence/screenshot-1.png',
        },
        {
          name: 'responsive_audit_discrepancy_report.pdf',
          url: 'https://example.com/evidence/report.pdf',
        },
      ],
    },
  },
};

// ── 6. Rejected ──────────────────────────────────────────────────────────────

export const Rejected = {
  args: {
    role: 'freelancer',
    index: 1,
    isLast: false,
    milestone: {
      id: 6,
      title: 'Design System Documentation',
      amount: '1200000000',
      status: 'Rejected',
      submittedAt: '2026-09-18T11:20:00Z',
      description:
        'Design token export lacked dark-mode contrast specifications. Please revise and resubmit.',
    },
  },
};
