/**
 * @openapi
 * /api/events:
 *   get:
 *     tags: [Events]
 *     summary: List all indexed Stellar contract events (paginated)
 *     parameters:
 *       - name: eventType
 *         in: query
 *         description: Filter by event type
 *         schema:
 *           type: string
 *           example: "escrow_created"
 *       - name: escrowId
 *         in: query
 *         description: Filter by escrow ID
 *         schema:
 *           type: integer
 *           example: 1
 *       - name: fromLedger
 *         in: query
 *         description: Filter events from this ledger sequence number
 *         schema:
 *           type: integer
 *       - name: toLedger
 *         in: query
 *         description: Filter events up to this ledger sequence number
 *         schema:
 *           type: integer
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/Limit'
 *     responses:
 *       200:
 *         description: Paginated list of events
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ContractEvent'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * /api/events/types:
 *   get:
 *     tags: [Events]
 *     summary: List distinct event types present in the index
 *     responses:
 *       200:
 *         description: Array of event type strings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *             example: ["escrow_created", "milestone_approved", "dispute_raised"]
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * /api/events/stats:
 *   get:
 *     tags: [Events]
 *     summary: Aggregate event counts per type
 *     responses:
 *       200:
 *         description: Event counts keyed by type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: integer
 *             example:
 *               escrow_created: 120
 *               milestone_approved: 85
 *               dispute_raised: 7
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * /api/events/escrow/{escrowId}:
 *   get:
 *     tags: [Events]
 *     summary: List all indexed events for a specific escrow (chronological)
 *     parameters:
 *       - name: escrowId
 *         in: path
 *         required: true
 *         description: Escrow ID
 *         schema:
 *           type: integer
 *           example: 1
 *       - name: eventType
 *         in: query
 *         description: Filter by event type
 *         schema:
 *           type: string
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/Limit'
 *     responses:
 *       200:
 *         description: Paginated events for the escrow
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * /api/events/{id}:
 *   get:
 *     tags: [Events]
 *     summary: Get a single indexed event by database ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Event database ID
 *         schema:
 *           type: integer
 *           example: 42
 *     responses:
 *       200:
 *         description: Event details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ContractEvent'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * /api/events/webhooks/delivery-status:
 *   get:
 *     tags: [Events]
 *     summary: Inspect webhook delivery status and latency SLA state
 *     description: >
 *       Returns the current webhook delivery state for the caller's subscriptions,
 *       including the latency SLA state, retry backoff schedule, and circuit breaker
 *       status. Use this endpoint to verify whether deliveries are meeting the
 *       documented latency SLA and to diagnose degraded or paused delivery.
 *
 *       **Delivery states**
 *
 *       - `normal` — Deliveries are succeeding within the latency SLA. Expected
 *         end-to-end delivery latency is **p95 < 5s** and **p99 < 15s** from the
 *         moment an event is indexed. Retries are not expected in this state.
 *       - `degraded` — One or more deliveries are failing or exceeding the SLA.
 *         The endpoint is still accepting events, but deliveries may be delayed
 *         while retries are in progress. Latency may exceed the normal SLA until
 *         the backlog clears.
 *       - `paused` — The circuit breaker is open and delivery attempts are
 *         suspended. No new deliveries are attempted until the breaker transitions
 *         to half-open. Events are retained and delivered once delivery resumes.
 *
 *       **Retry backoff**
 *
 *       Failed deliveries are retried with exponential backoff. The delay before
 *       attempt `n` (1-indexed) is `min(base * 2^(n-1), max)`, where `base` is 1s
 *       and `max` is 5 minutes. A delivery is abandoned after the configured
 *       maximum number of attempts (default 5).
 *
 *       **Circuit breaker**
 *
 *       The breaker starts `closed` (deliveries flow normally). After the failure
 *       threshold is reached it transitions to `open` (delivery paused). After the
 *       cooldown elapses it moves to `half-open`, allowing a single probe delivery;
 *       a success closes the breaker, a failure reopens it.
 *     responses:
 *       200:
 *         description: Current webhook delivery status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookDeliveryStatus'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 *
 * components:
 *   schemas:
 *     ContractEvent:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 42
 *         eventType:
 *           type: string
 *           example: "escrow_created"
 *         escrowId:
 *           type: integer
 *           nullable: true
 *           example: 1
 *         ledger:
 *           type: integer
 *           example: 1234567
 *         txHash:
 *           type: string
 *           example: "abc123..."
 *         payload:
 *           type: object
 *           description: Event-specific data
 *         indexedAt:
 *           type: string
 *           format: date-time
 *     WebhookDeliveryStatus:
 *       type: object
 *       description: Webhook delivery state, latency SLA, retry backoff, and circuit breaker status.
 *       properties:
 *         state:
 *           type: string
 *           enum: [normal, degraded, paused]
 *           description: >
 *             Overall delivery state. `normal` meets the latency SLA, `degraded`
 *             indicates failing or slow deliveries with retries in progress, and
 *             `paused` indicates the circuit breaker is open and delivery is suspended.
 *           example: normal
 *         latencySla:
 *           type: object
 *           description: Expected end-to-end delivery latency for the normal state.
 *           properties:
 *             p95Seconds:
 *               type: number
 *               example: 5
 *             p99Seconds:
 *               type: number
 *               example: 15
 *         retryBackoff:
 *           type: object
 *           description: Exponential backoff applied to failed deliveries.
 *           properties:
 *             baseSeconds:
 *               type: number
 *               example: 1
 *             maxSeconds:
 *               type: number
 *               example: 300
 *             maxAttempts:
 *               type: integer
 *               example: 5
 *         circuitBreaker:
 *           type: object
 *           description: Circuit breaker state governing delivery attempts.
 *           properties:
 *             state:
 *               type: string
 *               enum: [closed, open, half-open]
 *               example: closed
 *             failureThreshold:
 *               type: integer
 *               example: 5
 *             cooldownSeconds:
 *               type: number
 *               example: 60
 *         pendingDeliveries:
 *           type: integer
 *           description: Number of deliveries awaiting an attempt or retry.
 *           example: 0
 *         lastDeliveryAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Timestamp of the most recent successful delivery.
 */
