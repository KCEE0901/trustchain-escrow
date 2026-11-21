import {
  REPUTATION_GATE_REASONS as R,
  getEscrowRole,
  getReputationActionGates,
} from '../../hooks/useReputation';

// Built at runtime so no wallet-like literal lives in the repo.
const CLIENT = `G${'C'.repeat(55)}`;
const FREELANCER = `G${'F'.repeat(55)}`;
const OUTSIDER = `G${'O'.repeat(55)}`;

const escrow = (status = 'Completed') => ({
  status,
  clientAddress: CLIENT,
  freelancerAddress: FREELANCER,
});

const ALLOWED = { visible: true, enabled: true, reason: null };

describe('getEscrowRole', () => {
  it('derives the role from the escrow record', () => {
    expect(getEscrowRole(CLIENT, escrow())).toBe('client');
    expect(getEscrowRole(FREELANCER, escrow())).toBe('freelancer');
    expect(getEscrowRole(CLIENT.toLowerCase(), escrow())).toBe('client');
    expect(getEscrowRole(OUTSIDER, escrow())).toBe('observer');
    expect(getEscrowRole(null, escrow())).toBe('observer');
    expect(getEscrowRole(CLIENT, null)).toBe('observer');
  });

  it('does not match empty or missing party addresses', () => {
    expect(getEscrowRole('', { clientAddress: '' })).toBe('observer');
    expect(getEscrowRole(CLIENT, { status: 'Completed' })).toBe('observer');
  });
});

describe('getReputationActionGates', () => {
  it('enables rating the counterparty on a completed escrow', () => {
    expect(
      getReputationActionGates({
        viewerAddress: CLIENT,
        subjectAddress: FREELANCER,
        escrow: escrow(),
      }),
    ).toEqual({ role: 'client', refresh: ALLOWED, rate: ALLOWED });

    expect(
      getReputationActionGates({
        viewerAddress: FREELANCER,
        subjectAddress: CLIENT,
        escrow: escrow(),
      }).rate,
    ).toEqual(ALLOWED);
  });

  it.each(['Active', 'Disputed', 'Cancelled', undefined])(
    'disables rating while the escrow is %s',
    (status) => {
      const { rate } = getReputationActionGates({
        viewerAddress: CLIENT,
        subjectAddress: FREELANCER,
        escrow: escrow(status),
      });
      expect(rate).toEqual({ visible: true, enabled: false, reason: R.ESCROW_NOT_COMPLETED });
    },
  );

  it('disables rating twice', () => {
    const { rate } = getReputationActionGates({
      viewerAddress: CLIENT,
      subjectAddress: FREELANCER,
      escrow: escrow(),
      hasRated: true,
    });
    expect(rate).toEqual({ visible: true, enabled: false, reason: R.ALREADY_RATED });
  });

  it.each([
    ['an observer', { viewerAddress: OUTSIDER, subjectAddress: FREELANCER }, R.NOT_A_PARTY],
    ['a party rating themselves', { viewerAddress: CLIENT, subjectAddress: CLIENT }, R.SELF],
    [
      'a party rating a non-party',
      { viewerAddress: CLIENT, subjectAddress: OUTSIDER },
      R.NOT_A_PARTY,
    ],
    ['a disconnected wallet', { viewerAddress: null, subjectAddress: FREELANCER }, R.NOT_CONNECTED],
  ])('hides rating from %s', (_, input, reason) => {
    const { rate } = getReputationActionGates({ escrow: escrow(), ...input });
    expect(rate).toEqual({ visible: false, enabled: false, reason });
  });

  it('hides rating without an escrow but still allows refresh', () => {
    const gates = getReputationActionGates({ viewerAddress: CLIENT, subjectAddress: FREELANCER });
    expect(gates.rate).toEqual({ visible: false, enabled: false, reason: R.ESCROW_UNKNOWN });
    expect(gates.refresh).toEqual(ALLOWED);
  });

  it('cannot be widened by a role passed in by the caller', () => {
    const { rate } = getReputationActionGates({
      viewerAddress: OUTSIDER,
      subjectAddress: FREELANCER,
      escrow: escrow(),
      role: 'client',
    });
    expect(rate.visible).toBe(false);
  });

  it('disables refresh while loading', () => {
    const { refresh } = getReputationActionGates({ subjectAddress: FREELANCER, isLoading: true });
    expect(refresh).toEqual({ visible: true, enabled: false, reason: R.LOADING });
  });

  it('hides everything without a subject', () => {
    const gates = getReputationActionGates({ viewerAddress: CLIENT, escrow: escrow() });
    expect(gates.refresh.visible).toBe(false);
    expect(gates.rate).toEqual({ visible: false, enabled: false, reason: R.NO_SUBJECT });
    expect(getReputationActionGates()).toMatchObject({ role: 'observer' });
  });

  it('never includes addresses in the result', () => {
    const json = JSON.stringify(
      getReputationActionGates({
        viewerAddress: CLIENT,
        subjectAddress: FREELANCER,
        escrow: escrow(),
      }),
    );
    expect(json).not.toContain(CLIENT);
    expect(json).not.toContain(FREELANCER);
  });
});
