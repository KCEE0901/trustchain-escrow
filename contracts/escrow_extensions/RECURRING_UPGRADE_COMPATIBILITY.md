# Recurring Schedule Upgrade Compatibility

Recurring schedule execution must preserve the public entry-point names, field order, and encoded values for payment counts, next execution time, pause state, cancellation state, and final-payment remainder.

Upgrade regression coverage must exercise an active schedule, a paused schedule, and a completed schedule. Each fixture is written before upgrade, read after upgrade, processed once where eligible, and compared with the original payment total. Unknown future fields must not change existing field meanings.
