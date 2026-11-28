import { screen } from '@testing-library/react';
import MilestoneItem from '../../../components/escrow/MilestoneItem';
import { renderWithAppProviders } from '../../test-utils';

describe('MilestoneItem description hash', () => {
  const base = {
    id: 0,
    title: 'Deliverable',
    amount: '100',
    status: 'Pending',
  };

  it('renders hash and gateway link when a CID is present', () => {
    renderWithAppProviders(
      <MilestoneItem
        milestone={{ ...base, descriptionHash: 'QmTestCid123' }}
        index={0}
        role="observer"
        onApprove={jest.fn()}
        onReject={jest.fn()}
        onSubmit={jest.fn()}
        isLast
      />,
    );
    expect(screen.getByText('QmTestCid123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View published description/i })).toHaveAttribute(
      'href',
      expect.stringContaining('QmTestCid123'),
    );
  });

  it('shows unpublished message for zero hash', () => {
    renderWithAppProviders(
      <MilestoneItem
        milestone={{ ...base, descriptionHash: '0'.repeat(64) }}
        index={0}
        role="observer"
        onApprove={jest.fn()}
        onReject={jest.fn()}
        onSubmit={jest.fn()}
        isLast
      />,
    );
    expect(screen.getByText(/Description not published/i)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});