/**
 * Tests for Escrow Export Cancellation (Issue #193)
 *
 * Verifies that users and admins can cancel queued/running escrow export jobs,
 * cancelled jobs stop execution before writing final output, and status is persisted.
 */

import exportService from '../services/exportService.js';

describe('Escrow Export Cancellation', () => {
  const testAddress = 'GBJTHW7P3GAK3ZTJNY27G3D56DZXK333Z44F5R7GKK3Z77P4Z44P4TEST';
  const tenantId = 'test-export-tenant';

  beforeEach(() => {
    exportService.__resetExportJobsForTests?.();
  });

  test('should create an export job with queued status', async () => {
    const job = exportService.createExportJob(testAddress, { tenantId, requestedBy: testAddress });

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.status).toBe('queued');
    expect(job.outputWritten).toBe(false);
    expect(job.address).toBe(testAddress);

    const fetched = await exportService.getExportJob(job.id);
    expect(fetched).toMatchObject({
      id: job.id,
      status: 'queued',
      outputWritten: false,
    });
  });

  test('cancelling a queued export job should persist status and halt before writing output', async () => {
    const job = exportService.createExportJob(testAddress, { tenantId, requestedBy: testAddress });
    expect(job.status).toBe('queued');

    // Cancel while queued
    const cancelledJob = await exportService.cancelExportJob(job.id, { cancelledBy: testAddress });

    expect(cancelledJob.status).toBe('cancelled');
    expect(cancelledJob.cancelledAt).toBeDefined();
    expect(cancelledJob.cancelledBy).toBe(testAddress);
    expect(cancelledJob.outputWritten).toBe(false);

    // Verify status was persisted in store
    const persisted = await exportService.getExportJob(job.id);
    expect(persisted.status).toBe('cancelled');
    expect(persisted.cancelledAt).toBe(cancelledJob.cancelledAt);

    // Attempting to run the cancelled job should immediately stop without producing output
    const executionResult = await exportService.runExportJob(job.id);
    expect(executionResult.status).toBe('cancelled');
    expect(executionResult.outputWritten).toBe(false);
    expect(executionResult.data).toBeNull();
  });

  test('cancelling a running export job should stop execution before writing final output', async () => {
    const job = exportService.createExportJob(testAddress, { tenantId, requestedBy: testAddress });

    // Transition job to running
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.progress = 30;

    // Simulate cancellation midway while job is running
    const cancelledJob = await exportService.cancelExportJob(job.id, { cancelledBy: 'admin' });

    expect(cancelledJob.status).toBe('cancelled');
    expect(cancelledJob.cancelledBy).toBe('admin');
    expect(cancelledJob.outputWritten).toBe(false);

    // When the pipeline continues, it verifies cancellation and exits before writing final output
    const result = await exportService.runExportJob(job.id);
    expect(result.status).toBe('cancelled');
    expect(result.outputWritten).toBe(false);
    expect(result.data).toBeNull();

    // Persisted record confirms cancelled state
    const persisted = await exportService.getExportJob(job.id);
    expect(persisted.status).toBe('cancelled');
    expect(persisted.outputWritten).toBe(false);
  });

  test('cancelling an already cancelled job is idempotent and preserves status', async () => {
    const job = exportService.createExportJob(testAddress, { tenantId });
    await exportService.cancelExportJob(job.id, { cancelledBy: 'user' });

    const secondCancel = await exportService.cancelExportJob(job.id, { cancelledBy: 'user' });
    expect(secondCancel.status).toBe('cancelled');
  });

  test('cancelling a completed export job should throw error', async () => {
    const job = exportService.createExportJob(testAddress, { tenantId });
    job.status = 'completed';
    job.outputWritten = true;

    await expect(
      exportService.cancelExportJob(job.id, { cancelledBy: 'user' }),
    ).rejects.toThrow(/Cannot cancel an already completed export job/);
  });

  test('cancelling an unknown job id should throw error', async () => {
    await expect(
      exportService.cancelExportJob('non_existent_export_id', { cancelledBy: 'user' }),
    ).rejects.toThrow(/not found/);
  });
});
