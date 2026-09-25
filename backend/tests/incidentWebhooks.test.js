/**
 * Tests for Incident Status Webhooks (Issue #190)
 *
 * Verifies webhook payload structure and event emission when incidents
 * are opened, updated, resolved, or linked to affected escrows.
 */

import incidentService, { Severity, Status } from '../services/incidentService.js';
import webhookService from '../services/webhookService.js';

describe('Incident Status Webhooks', () => {
  let webhookSpy;

  beforeEach(() => {
    incidentService.__resetForTests?.();
    webhookSpy = jest.spyOn(webhookService, 'queueEventWebhooks').mockResolvedValue({ queued: 1 });
  });

  afterEach(() => {
    webhookSpy.mockRestore();
  });

  test('should emit incident.opened webhook with incident id, status, severity, and affected scope', async () => {
    const incident = await incidentService.createIncident({
      title: 'Stellar RPC Latency Spike',
      description: 'Horizon node responding with 504 gateway timeouts',
      severity: Severity.SEV2,
      affectedServices: ['stellar-horizon', 'escrow-relayer'],
      affectedEscrowIds: ['1001', '1002'],
      commander: 'Alice Engineer',
      createdBy: 'monitoring-system',
    });

    expect(incident).toBeDefined();
    expect(incident.status).toBe(Status.OPEN);

    // Verify webhook was emitted
    expect(webhookSpy).toHaveBeenCalledWith(
      'incident.opened',
      expect.objectContaining({
        eventType: 'incident.opened',
        incidentId: incident.id,
        id: incident.id,
        status: Status.OPEN,
        severity: Severity.SEV2,
        affectedScope: {
          services: ['stellar-horizon', 'escrow-relayer'],
          escrows: ['1001', '1002'],
          escrowIds: ['1001', '1002'],
        },
        affectedServices: ['stellar-horizon', 'escrow-relayer'],
        affectedEscrowIds: ['1001', '1002'],
        title: 'Stellar RPC Latency Spike',
      }),
    );
  });

  test('should emit incident.updated webhook when transitioning incident status', async () => {
    const incident = await incidentService.createIncident({
      title: 'Database connection pool saturation',
      description: 'High active connection count on primary DB',
      severity: Severity.SEV3,
      affectedServices: ['database-main'],
    });

    webhookSpy.mockClear();

    // Transition to INVESTIGATING
    await incidentService.updateIncidentStatus(incident.id, Status.INVESTIGATING, {
      actor: 'oncall-lead',
      note: 'Investigating query patterns',
    });

    expect(webhookSpy).toHaveBeenCalledWith(
      'incident.updated',
      expect.objectContaining({
        eventType: 'incident.updated',
        incidentId: incident.id,
        status: Status.INVESTIGATING,
        severity: Severity.SEV3,
        affectedScope: expect.objectContaining({
          services: ['database-main'],
        }),
      }),
    );
  });

  test('should emit incident.resolved webhook when incident is resolved', async () => {
    const incident = await incidentService.createIncident({
      title: 'Dispute Webhook Ingestion Lag',
      description: 'Workers delayed by 15 minutes',
      severity: Severity.SEV3,
      affectedServices: ['webhook-worker'],
      affectedEscrowIds: ['5501'],
    });

    webhookSpy.mockClear();

    // Transition to RESOLVED
    await incidentService.updateIncidentStatus(incident.id, Status.RESOLVED, {
      actor: 'bob',
      note: 'Scaled worker pool, lag cleared',
    });

    expect(webhookSpy).toHaveBeenCalledWith(
      'incident.resolved',
      expect.objectContaining({
        eventType: 'incident.resolved',
        incidentId: incident.id,
        status: Status.RESOLVED,
        severity: Severity.SEV3,
        affectedScope: {
          services: ['webhook-worker'],
          escrows: ['5501'],
          escrowIds: ['5501'],
        },
        affectedEscrowIds: ['5501'],
      }),
    );
  });

  test('should emit incident.escrows_linked webhook when linking escrows to an incident', async () => {
    const incident = await incidentService.createIncident({
      title: 'Smart Contract Event Desync',
      description: 'Missed lock events on ledger 12345',
      severity: Severity.SEV2,
      affectedServices: ['indexer'],
    });

    webhookSpy.mockClear();

    // Link affected escrows
    const updatedIncident = await incidentService.linkEscrowsToIncident(
      incident.id,
      ['8801', '8802', '8803'],
      { actor: 'admin', note: 'Identified 3 affected escrows' },
    );

    expect(updatedIncident.affectedEscrowIds).toEqual(expect.arrayContaining(['8801', '8802', '8803']));

    expect(webhookSpy).toHaveBeenCalledWith(
      'incident.escrows_linked',
      expect.objectContaining({
        eventType: 'incident.escrows_linked',
        incidentId: incident.id,
        status: Status.OPEN,
        severity: Severity.SEV2,
        affectedScope: expect.objectContaining({
          escrows: expect.arrayContaining(['8801', '8802', '8803']),
        }),
        linkedEscrowIds: ['8801', '8802', '8803'],
      }),
    );
  });
});
