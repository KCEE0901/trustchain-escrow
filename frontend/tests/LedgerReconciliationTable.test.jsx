import React from 'react';
import { render, screen } from '@testing-library/react';
import LedgerReconciliationTable, {
  formatReconciliationStatus,
  calculateDiscrepancyAmount,
  filterLedgerEntries,
} from '../components/LedgerReconciliationTable';

describe('LedgerReconciliationTable Utilities', () => {
  it('formats status values into badge props', () => {
    expect(formatReconciliationStatus('matched').label).toBe('Matched');
    expect(formatReconciliationStatus('discrepancy').label).toBe('Discrepancy');
    expect(formatReconciliationStatus('pending').label).toBe('Pending');
  });

  it('calculates discrepancy amounts', () => {
    expect(calculateDiscrepancyAmount(100, 100)).toBe(0);
    expect(calculateDiscrepancyAmount(100.5, 90.2)).toBe(10.3);
  });

  it('filters entries by status', () => {
    const data = [
      { id: '1', status: 'matched' },
      { id: '2', status: 'discrepancy' },
    ];
    expect(filterLedgerEntries(data, 'all')).toHaveLength(2);
    expect(filterLedgerEntries(data, 'discrepancy')).toHaveLength(1);
    expect(filterLedgerEntries(data, 'discrepancy')[0].id).toBe('2');
  });
});

describe('LedgerReconciliationTable Component', () => {
  it('renders loading state', () => {
    render(<LedgerReconciliationTable isLoading={true} />);
    expect(screen.getByText(/Loading ledger reconciliation data/i)).toBeInTheDocument();
  });

  it('renders table headers and entries', () => {
    const data = [
      {
        id: '1',
        transactionHash: '0x1234567890abcdef',
        dbAmount: 100,
        ledgerAmount: 100,
        status: 'matched',
      },
    ];
    render(<LedgerReconciliationTable entries={data} />);
    expect(screen.getByText('Ledger Reconciliation')).toBeInTheDocument();
    expect(screen.getByText('Matched')).toBeInTheDocument();
  });
});
