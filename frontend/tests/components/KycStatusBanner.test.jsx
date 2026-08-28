import { render, screen } from '@testing-library/react';
import KycStatusBanner from '../../components/KycStatusBanner';

describe('KycStatusBanner', () => {
  it('shows the banner when status is undefined (field omitted by API)', () => {
    render(<KycStatusBanner status={undefined} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // Regression test: the KYC status API returns `status: null` (not undefined)
  // for a user who has never started verification. A previous version of this
  // component used `status === undefined` to decide whether to show the
  // prompt, which missed the explicit `null` case and hid the banner —
  // silently leaving unverified users with no call to action.
  it('shows the banner when status is explicitly null', () => {
    render(<KycStatusBanner status={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/complete identity verification/i)).toBeInTheDocument();
  });

  it('shows the banner when status is an empty string', () => {
    render(<KycStatusBanner status="" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a retry prompt when status is Declined', () => {
    render(<KycStatusBanner status="Declined" />);
    expect(screen.getByText(/retry verification/i)).toBeInTheDocument();
  });

  it('hides the banner when status is Approved', () => {
    render(<KycStatusBanner status="Approved" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the banner when explicitly dismissed', () => {
    render(<KycStatusBanner status={null} dismissed />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the banner when a verifiedAt timestamp is present despite a stale status', () => {
    render(<KycStatusBanner status="Pending" verifiedAt="2026-01-01T00:00:00Z" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
