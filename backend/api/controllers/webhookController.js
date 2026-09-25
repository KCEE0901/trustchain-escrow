import webhookService from '../../services/webhookService.js';

const MAX_EVENT_TYPES = 20;
const ALLOWED_SCHEMES = ['https:'];

function isValidWebhookUrl(raw) {
  try {
    const parsed = new URL(raw);
    return ALLOWED_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ── Subscribable event-type catalogue ─────────────────────────────────────────
// Must stay in sync with the indexer handler list documented in docs/webhooks.md.
// Each entry includes a stable name, a human-readable description, and a
// representative example payload so subscribers can build consumers without
// waiting for real traffic.

const EVENT_TYPES = [
  {
    name: 'esc_crt',
    description: 'Fired when an escrow is initialised and funds are locked on-chain.',
    examplePayload: {
      eventType: 'esc_crt',
      deliveryId: 'clx7f1m4k0001qzrm6c2h8w0p',
      timestamp: '2026-07-25T10:14:58.902Z',
      data: {
        eventType: 'esc_crt',
        ledger: '1284471',
        ledgerAt: '2026-07-25T10:14:55.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['esc_crt', '42'],
        data: [
          'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
          'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          '10000000000',
        ],
        txHash: 'b9d2f0c1a4e58d3b6f7290ac1d4e5f8b9c0a1d2e3f4a5b6c7d8e9f0a1b2c3d4e',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'mil_add',
    description: 'Fired when a milestone is appended to an escrow.',
    examplePayload: {
      eventType: 'mil_add',
      deliveryId: 'clx7f2p9x0002qzrm4b1t7k3d',
      timestamp: '2026-07-25T10:15:31.004Z',
      data: {
        eventType: 'mil_add',
        ledger: '1284478',
        ledgerAt: '2026-07-25T10:15:28.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['mil_add', '42'],
        data: [0, '4000000000'],
        txHash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'mil_sub',
    description: 'Fired when the contractor submits work for a milestone.',
    examplePayload: {
      eventType: 'mil_sub',
      deliveryId: 'clx7f3q0y0003qzrm5c2u8l4e',
      timestamp: '2026-07-25T10:30:14.120Z',
      data: {
        eventType: 'mil_sub',
        ledger: '1284520',
        ledgerAt: '2026-07-25T10:30:11.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['mil_sub', '42'],
        data: [0, 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'],
        txHash: '2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'mil_apr',
    description:
      'Fired when the client approves a milestone submission. A separate funds_rel event follows with the payment.',
    examplePayload: {
      eventType: 'mil_apr',
      deliveryId: 'clx7f4r1z0004qzrm6d3v9m5f',
      timestamp: '2026-07-25T10:45:22.300Z',
      data: {
        eventType: 'mil_apr',
        ledger: '1284600',
        ledgerAt: '2026-07-25T10:45:19.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['mil_apr', '42'],
        data: [0, '4000000000'],
        txHash: '3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'mil_rej',
    description: 'Fired when the client rejects a milestone submission.',
    examplePayload: {
      eventType: 'mil_rej',
      deliveryId: 'clx7f5s2a0005qzrm7e4w0n6g',
      timestamp: '2026-07-25T11:00:05.450Z',
      data: {
        eventType: 'mil_rej',
        ledger: '1284700',
        ledgerAt: '2026-07-25T11:00:02.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['mil_rej', '42'],
        data: [0, 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'],
        txHash: '4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'mil_dis',
    description:
      'Fired when a dispute is raised against a specific milestone. The milestone is stored as Rejected in the DB; use this event type to distinguish disputed from plainly rejected.',
    examplePayload: {
      eventType: 'mil_dis',
      deliveryId: 'clx7f6t3b0006qzrm8f5x1o7h',
      timestamp: '2026-07-25T11:05:10.600Z',
      data: {
        eventType: 'mil_dis',
        ledger: '1284750',
        ledgerAt: '2026-07-25T11:05:07.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['mil_dis', '42'],
        data: [0, 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'],
        txHash: '5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'funds_rel',
    description: 'Fired when funds move out of escrow to a recipient address.',
    examplePayload: {
      eventType: 'funds_rel',
      deliveryId: 'clx7f5r2m0004qzrm9d3v2j8h',
      timestamp: '2026-07-25T11:02:17.556Z',
      data: {
        eventType: 'funds_rel',
        ledger: '1284902',
        ledgerAt: '2026-07-25T11:02:14.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['funds_rel', '42'],
        data: ['GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H', '4000000000'],
        txHash: '9f8e7d6c5b4a39281706f5e4d3c2b1a09876543210fedcba9876543210fedcba',
        eventIndex: 1,
      },
    },
  },
  {
    name: 'esc_can',
    description:
      'Fired when an escrow is cancelled and the remaining balance is returned to the client.',
    examplePayload: {
      eventType: 'esc_can',
      deliveryId: 'clx7f7u4c0007qzrm9g6y2p8i',
      timestamp: '2026-07-26T09:10:00.000Z',
      data: {
        eventType: 'esc_can',
        ledger: '1290000',
        ledgerAt: '2026-07-26T09:09:57.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['esc_can', '42'],
        data: ['GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', '6000000000'],
        txHash: '6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'dis_rai',
    description: 'Fired when a dispute is opened on an escrow.',
    examplePayload: {
      eventType: 'dis_rai',
      deliveryId: 'clx7f8v5d0008qzrmah7z3q9j',
      timestamp: '2026-07-25T12:00:00.000Z',
      data: {
        eventType: 'dis_rai',
        ledger: '1285000',
        ledgerAt: '2026-07-25T11:59:57.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['dis_rai', '42'],
        data: ['GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'],
        txHash: '7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'dis_res',
    description:
      'Fired when an arbiter resolves a dispute, splitting the funds and closing the escrow.',
    examplePayload: {
      eventType: 'dis_res',
      deliveryId: 'clx7f9w6e0009qzrmbi8a4r0k',
      timestamp: '2026-07-26T14:00:00.000Z',
      data: {
        eventType: 'dis_res',
        ledger: '1295000',
        ledgerAt: '2026-07-26T13:59:57.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: '42',
        topics: ['dis_res', '42'],
        data: ['5000000000', '5000000000'],
        txHash: '8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c',
        eventIndex: 0,
      },
    },
  },
  {
    name: 'rep_upd',
    description:
      "Fired when a participant's on-chain reputation score changes. escrowId is null for this event type.",
    examplePayload: {
      eventType: 'rep_upd',
      deliveryId: 'clx7faw7f000aqzrmcj9b5s1l',
      timestamp: '2026-07-25T11:03:00.000Z',
      data: {
        eventType: 'rep_upd',
        ledger: '1284910',
        ledgerAt: '2026-07-25T11:02:57.000Z',
        contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        escrowId: null,
        topics: ['rep_upd'],
        data: ['GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H', '10'],
        txHash: '9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d',
        eventIndex: 0,
      },
    },
  },
];

const listEventTypes = (_req, res) => {
  res.json({ data: EVENT_TYPES });
};

const subscribe = async (req, res) => {
  try {
    const { url, eventTypes } = req.body;

    if (!url || !isValidWebhookUrl(url)) {
      return res.status(400).json({ error: 'url must be a valid HTTPS URL' });
    }

    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      return res.status(400).json({ error: 'eventTypes must be a non-empty array' });
    }

    if (eventTypes.length > MAX_EVENT_TYPES) {
      return res
        .status(400)
        .json({ error: `eventTypes may not exceed ${MAX_EVENT_TYPES} entries` });
    }

    const result = await webhookService.createSubscription({
      url,
      eventTypes: eventTypes.slice(0, MAX_EVENT_TYPES),
      createdBy: req.user?.address || null,
    });

    res.status(201).json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const listSubscriptions = async (req, res) => {
  try {
    const subscriptions = await webhookService.listSubscriptions({
      createdBy: req.user?.address || null,
    });
    res.json({ data: subscriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteSubscription = async (req, res) => {
  try {
    const deleted = await webhookService.deleteSubscription({
      id: req.params.id,
      createdBy: req.user?.address || null,
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Webhook subscription not found' });
    }

    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getDeliveries = async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Math.min(Number(req.query.limit || 30), 100);

    const result = await webhookService.getDeliveryHistory({
      subscriptionId: req.params.id,
      createdBy: req.user?.address || null,
      page,
      limit,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export default {
  listEventTypes,
  subscribe,
  listSubscriptions,
  deleteSubscription,
  getDeliveries,
};
