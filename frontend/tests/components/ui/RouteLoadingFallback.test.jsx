import { render, screen } from '@testing-library/react';
import RouteLoadingFallback from '../../../components/ui/RouteLoadingFallback';

describe('RouteLoadingFallback', () => {
  it('renders an accessible route loading status', () => {
    render(<RouteLoadingFallback />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading page…')).toBeInTheDocument();
  });
});
