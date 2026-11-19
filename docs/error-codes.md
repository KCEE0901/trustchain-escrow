# Error Codes Reference

Public contract functions return `Result<T, EscrowError>`. `EscrowError` is a type alias for `EcErr` in `contracts/escrow_contract/src/errors.rs` — indexers and clients should match the `EcErr` variant names below.

Soroban surfaces the `EcErr` discriminant as a `u32` in the diagnostic stream when a call fails.

## Initialization (1-2)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 1    | `E1` | Contract setup was attempted more than once. |
| 2    | `E2` | A guarded function was called before initialization. |

## Authorization (3-6)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 3    | `E3` | Caller is not allowed to perform this action. |
| 4    | `E4` | Action requires the contract admin. |
| 5    | `E5` | Action requires the escrow client. |
| 6    | _(unused)_ | No current variant. |

## Escrow State (7-12)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 7    | `E7` | Contract error (see contract sources). |
| 8    | `E8` | No escrow exists for the requested `escrow_id`. |
| 9    | `E9` | Operation requires an active escrow. |
| 10   | `E10` | Operation requires a disputed escrow. |
| 11   | `E11` | Contract error (see contract sources). |
| 12   | `E12` | Cancellation is blocked because milestone funds are pending. |

## Milestones (13-17)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 13   | `E13` | No milestone exists for the requested `milestone_id`. |
| 14   | `E14` | Milestone is not in the expected state for this action. |
| 15   | `E15` | Milestone total would exceed the escrow amount. |
| 16   | `E16` | Maximum milestone count would be exceeded. |
| 17   | `E17` | Milestone amount is zero or negative. |

## Funds And Disputes (18-24)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 18   | _(unused)_ | No current variant. |
| 19   | `E19` | Escrow amount is invalid. |
| 20   | `E20` | Arithmetic or distribution amounts do not line up. |
| 21   | _(unused)_ | No current variant. |
| 22   | `E22` | Reentrant payout flow was blocked by the contract guard. |
| 23   | `E23` | Dispute timeout has not elapsed yet. |
| 24   | `E24` | Contract error (see contract sources). |

## Deadlines And Locking (25-31)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 25   | _(unused)_ | No current variant. |
| 26   | `E26` | Escrow deadline has already passed. |
| 27   | _(unused)_ | No current variant. |
| 28   | `E28` | Funds are still locked. |
| 29   | _(unused)_ | No current variant. |
| 30   | `E30` | Lock extension is invalid. |
| 31   | `E31` | Contract is paused. |

## Cancellations (32-37)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 32   | `E32` | No cancellation request exists. |
| 33   | `E33` | Cancellation request already exists. |
| 34   | `E34` | Cancellation request has already been disputed. |
| 35   | `E35` | Cancellation dispute window is still open. |
| 36   | `E36` | Cancellation dispute deadline has passed. |
| 37   | `E37` | Cancellation is blocked by an active dispute. |

## Slashing (38-41)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 38   | `E38` | No slash record exists. |
| 39   | `E39` | Slash has already been disputed. |
| 40   | `E40` | Slash dispute deadline has passed. |
| 41   | `E41` | A slash record already exists for this escrow. |

## Migration And Recurring (42-47)

| Code | Name | Meaning |
| ---- | ---- | ------- |
| 42   | `E42` | Storage migration failed. |
| 43   | `E43` | Recurring payment config was not found. |
| 44   | `E44` | Recurring schedule configuration is invalid. |
| 45   | `E45` | No recurring payment is currently due. |
| 46   | `E46` | Recurring schedule is paused. |
| 47   | `E47` | Recurring schedule has been cancelled. |
