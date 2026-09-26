# Tenant Resolution Deployment Guide

Tenant resolution decides which tenant context is attached to each request. The
behavior differs slightly across local, staging, and production deployments.

## Local

- Use the configured default tenant for seed data and local demos.
- Allow localhost hostnames and explicit tenant headers for development tools.
- Log the selected tenant id at debug level.
- Do not use production tenant slugs in local `.env` files.

## Staging

- Resolve by staging hostname first.
- Allow explicit tenant headers only for authenticated internal tooling.
- Keep a default tenant for smoke tests, but require it to be marked as staging.
- Alert when a request falls back to the default tenant unexpectedly.

## Production

- Resolve by verified hostname or signed integration metadata.
- Disable unauthenticated tenant override headers.
- Reject requests that cannot be mapped to an active tenant.
- Treat default tenant fallback as a deployment error unless the route is a
  public health check.

## Guardrails

- Tenant id must be attached before authentication side effects run.
- Audit logs must include the resolved tenant id and resolution source.
- Background jobs should carry tenant id in the job payload, not infer it later.
- Cache keys must include tenant id for tenant-scoped resources.

## Rollout Checklist

- Verify hostnames are registered before deployment.
- Confirm default tenant behavior in the target environment.
- Run a smoke request for each tenant host.
- Check logs for unexpected fallback resolution.
