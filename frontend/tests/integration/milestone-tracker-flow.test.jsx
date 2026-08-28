import { screen } from '@testing-library/react';
import MilestoneTracker from '../../../components/MilestoneTracker';
import { renderWithAppProviders } from '../test-utils';

jest.mock('../../../components/escrow/MilestoneList', () => function MilestoneList({ milestones }) {
  return <div data-testid="milestone-list">{milestones.length} milestones</div>;
});

const mockMilestones = [
  { id: 1, title: 'Design', status: 'Approved', amount: '500' },
  { id: 2, title: 'Development', status: 'Submitted', amount: '1000' },
  { id: 3, title: 'Testing', status: 'Pending', amount: '500' },
];

describe('MilestoneTracker integration flow', () => {
  it('renders stats cards and progress bar with milestones', () => {
    renderWithAppProviders(
      <MilestoneTracker milestones={mockMilestones} role="client" />,
    );

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
    expect(screen.getByTestId('milestone-list')).toHaveTextContent('3 milestones');
  });

  it('renders empty state when no milestones', () => {
    renderWithAppProviders(<MilestoneTracker milestones={[]} role="client" />);

    expect(screen.getByText('No milestones yet')).toBeInTheDocument();
    expect(screen.queryByTestId('milestone-list')).not.toBeInTheDocument();
  });

  it('computes progress correctly for fully approved milestones', () => {
    const allApproved = mockMilestones.map((m) => ({ ...m, status: 'Approved' }));
    renderWithAppProviders(
      <MilestoneTracker milestones={allApproved} role="client" />,
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
