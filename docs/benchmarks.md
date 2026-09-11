# Reproducible local measurements

Generated 2026-09-11T16:54:22.246Z. Run `npm run benchmark` to reproduce.

3 fresh mandates per batch size; one allowed tool; cost=1; warm-up then 25 offline verifications per sample; no external services. Contract deployment and mandate creation gas excluded.

Environment: v24.14.1, win32/x64, 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz; Local EVM 31337 / Shanghai; Solidity 0.8.28, optimizer 200, viaIR.

| Receipts per batch | Mean batch gas | Mean gas / receipt | Inclusion proof bytes | Mean offline verification ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 206,437.333 | 206,437.333 | 0 | 23.781 |
| 2 | 216,510 | 108,255 | 32 | 17.361 |
| 8 | 276,932.333 | 34,616.542 | 96 | 13.059 |
| 16 | 357,387 | 22,336.688 | 128 | 13.136 |
| 32 | 518,555 | 16,204.844 | 160 | 15.213 |

A 32-receipt batch used **92.15% less gas per receipt** than a singleton under this specific workload. This compares separate fresh mandates and excludes creation/deployment gas. Every receipt still requires signature and policy validation; total batch gas grows with batch size.

Local measurements only. Settlement wall time includes local RPC behavior and is not public-chain latency. No throughput or finality claim.

Proof bytes count only Merkle siblings; full JSON bundle sizes and all raw samples are in [benchmark-results.json](benchmark-results.json). Synthetic transactions use a temporary local chain, removed after measurement. Hardware load affects timing. These are measurements, not service-level objectives or production scalability claims.
