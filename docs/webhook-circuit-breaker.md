# Webhook Circuit Breaker

TrustFi pauses webhook delivery when repeated failures indicate that an
integrator endpoint is unavailable or rejecting signed payloads. The circuit
breaker protects the delivery queue from retry storms while giving integrators a
clear restore path.

## Pause Conditions

Delivery is paused for a subscription when one of these conditions is met:

- consecutive delivery failures exceed the configured threshold
- the endpoint returns repeated `429`, `500`, `502`, `503`, or `504` responses
- TLS validation fails for the endpoint
- signature verification is rejected by the receiver for multiple attempts
- delivery latency exceeds the timeout window for consecutive jobs

## Probe Behavior

Paused subscriptions are not treated as permanently disabled. The worker should
schedule lightweight probes using the subscription URL and signing secret.

Probe outcomes:

- `2xx`: mark the subscription as recovering and resume normal delivery
- `401` or `403`: keep paused and require secret or allowlist review
- `404` or `410`: keep paused and ask the integrator to update the endpoint
- `5xx` or timeout: keep paused and retry on the next probe interval

## Restoring Delivery

Integrators should:

1. Fix endpoint availability or signature handling.
2. Confirm the endpoint accepts a signed probe request.
3. Use the dashboard or support channel to request delivery resume.
4. Replay missed events from the delivery history when available.

## Operator Checks

- Verify the subscription owner and tenant before resuming.
- Confirm the destination URL still matches the registered integration.
- Resume only one subscription at a time for high-volume tenants.
- Watch queue depth and delivery error rate for at least one probe interval.
