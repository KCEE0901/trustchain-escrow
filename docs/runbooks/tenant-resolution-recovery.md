# Tenant Resolution Recovery

## Detection

- Alert on increases in `Tenant identifier required`, `Tenant not found`, and inactive-tenant responses.
- Compare the supplied tenant ID, tenant slug, and forwarded hostname in that precedence order without logging their raw values.

## Mitigation

1. Disable default-tenant fallback in production.
2. Verify the tenant is active and that its configured domains match the normalized forwarded hostname.
3. Drain stale proxy configuration before retrying affected requests.

## Rollback

Restore the previous tenant-domain configuration and proxy headers. Do not bypass tenant middleware or substitute another tenant ID.

## Verification

Confirm explicit ID, explicit slug, and hostname resolution independently. Verify missing identifiers fail closed, inactive tenants remain forbidden, and operational records remain within the configured retention bound.
