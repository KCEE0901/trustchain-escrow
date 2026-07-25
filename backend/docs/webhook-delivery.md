# Webhook Delivery Guide

> **Moved.** The webhook reference now lives at
> **[docs/webhooks.md](../../docs/webhooks.md)** and covers subscription
> management, the delivery envelope, every deliverable event type with its
> payload schema, signature verification, and retry semantics.
>
> This stub remains so existing links keep working. Update bookmarks to the new
> location — this file is no longer maintained.

## Implementation entry points

| Concern                      | File                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| Subscription CRUD, signing   | [`backend/services/webhookService.js`](../services/webhookService.js)     |
| HTTP routes and validation   | [`backend/api/controllers/webhookController.js`](../api/controllers/webhookController.js) |
| Queueing and retry options   | [`backend/queues/webhookQueue.js`](../queues/webhookQueue.js)             |
| Delivery worker              | [`backend/workers/webhookWorker.js`](../workers/webhookWorker.js)         |
| Event → webhook dispatch     | [`backend/services/eventIndexer.js`](../services/eventIndexer.js)         |
| Storage schema               | [`backend/database/migrations/20260528000000_webhooks.js`](../database/migrations/20260528000000_webhooks.js) |
