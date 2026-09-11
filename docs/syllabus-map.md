# CSEN4031 syllabus coverage

This matrix maps Prooflane to the supplied GITAM B.Tech. CSE **Block Chain Technology (CSEN4031)** syllabus: the 2021–22 curriculum document approved in 2022. It distinguishes implemented mechanisms from educational demonstrations and topics that require further study. A deployed application on an EVM does not implement the underlying blockchain's consensus protocol.

**Implemented** means a mechanism is part of the working application. **Educational lab** means an intentionally limited simulation. **Discussion** means an architectural explanation or interview exercise. **Not implemented** means the project does not supply that feature.

## Unit 1 — Blockchain Fundamentals

| Syllabus topic | Coverage | Evidence and limits |
| --- | --- | --- |
| How blockchain works; sample blocks | Implemented + educational lab | Contract state changes, transaction receipts and events on a local EVM; the Bitcoin lab builds linked sample blocks |
| Double spending | Implemented analogue + educational lab | Exact contract nonces reject receipt replay and cumulative caps reject excess credit claims; a toy UTXO ledger rejects spending an output twice. Audit credits are not coins |
| Centralization and decentralization | Discussion | The architecture explains the centralized gateway/SQLite boundary and independently verifiable chain commitments |
| Byzantine generals; distributed consensus without identity | Discussion | Explain adversarial participants and why public consensus differs from trusting one server. Anvil does not exercise Byzantine consensus |
| Incentives, proof of work and mining | Educational lab + discussion | A bounded hash-puzzle demonstration shows nonce search and tampering; economic incentives and a real mining network are not implemented |
| Cryptocurrency and NFTs | Discussion / not implemented | The project uses integer audit credits and has no token, NFT mint or financial transfer |
| Public, private, semi-private chains and sidechains | Discussion | Compare deployment trust assumptions; a local development EVM is not a consortium chain or an Ethereum-secured sidechain |
| Blockchain vulnerabilities | Implemented defenses + discussion | Signature/domain checks, replay rejection, credit limits and revocation; explicit key-compromise, dishonest-input and local-centralization limitations |

## Unit 2 — Cryptography and types of consensus algorithms for Blockchain

| Syllabus topic | Coverage | Evidence and limits |
| --- | --- | --- |
| SHA-256 | Implemented | Deterministic input/output content commitments; the Bitcoin lab additionally demonstrates double SHA-256 |
| Hash pointers and blockchain data structures | Implemented + educational lab | Batch history records the previous root; the lab links sample blocks by hash |
| Merkle trees | Implemented | Tool allowlists, batched receipt roots, inclusion proofs, singleton and odd-size behavior, and tampering checks |
| Distributed ledger | Implemented application use + discussion | The application writes and queries EVM state. Its default chain is one local development instance |
| Hash and transaction laboratories | Implemented | Recompute content commitments, inspect signed receipts, submit batches and inspect transaction events |
| Proof of work | Educational lab | Bounded toy mining; no difficulty retargeting, mining pool or production consensus |
| Proof of stake, delegated proof of stake, proof of elapsed time | Discussion / not implemented | Compare validator selection, trust assumptions, energy cost and failure modes. The project does not implement these algorithms |
| Network laboratory | Partial | An HTTP API and local EVM RPC exercise client/server communication; blockchain peer discovery, gossip and distributed validation are not implemented |

## Unit 3 — Bitcoin Blockchain

| Syllabus topic | Coverage | Evidence and limits |
| --- | --- | --- |
| Structure, operations and features | Educational lab | Sample linked blocks, SHA-256d commitments, Merkle root construction and UTXO state transitions |
| Transactions, double spend, change and fees | Educational lab | A small transaction model demonstrates input consumption, output creation, change and a fee |
| Mining and consensus/incentive models | Educational lab + discussion | Toy hash search and tamper rejection; no real chain selection, miner economy or network consensus |
| Bitcoin scripts and network | Not implemented | No Script interpreter, signature authorization, real Bitcoin serialization, peer-to-peer protocol or node |
| Wallets: software, web and paper | Discussion / not implemented | Ethereum demonstration keys are not a Bitcoin wallet. Explain custody and key handling without representing a classroom key as secure storage |
| Explorer analysis and Electrum transaction laboratory | Not implemented | Optional supervised test-network exercises remain separate from this project; no real transaction has been submitted |
| Cryptocurrency regulations | Discussion only | Explain why jurisdiction and activity matter. The project does not provide current legal analysis; consult current official sources for any real deployment |

The Bitcoin lab is deliberately recognizable as a teaching model. It is not Bitcoin-compatible and cannot receive or send bitcoin.

## Unit 4 — Ethereum Blockchain and DApps

| Syllabus topic | Coverage | Evidence and limits |
| --- | --- | --- |
| Smart-contract definition, need and features | Implemented | The mandate and settlement contract defines deterministic acceptance rules independently of the gateway |
| Smart-contract life cycle | Implemented | Solidity source, compilation with solc 0.8.28, ABI use, local deployment, state-changing transactions, events and reads |
| Higher-level contract languages | Implemented | Solidity; Vyper is not required or implemented |
| Ethereum structure and operations | Implemented application use | Accounts, EIP-712 signatures, chain/contract domains, transaction execution and logs |
| Ethereum consensus and incentives | Discussion | The default EVM exercises contracts without reproducing Ethereum proof of stake or validator incentives |
| DApps | Implemented | Browser interface, HTTP service, storage, SDK, contract and independent proof verification form one end-to-end workflow |
| Solidity, solc, ABI, Remix or Vyper laboratory | Implemented | Solidity/solc/ABI provide the primary workflow. Remix can be used for manual exploration; it is not a required runtime dependency |

## Unit 5 — Open source Blockchains, Use cases of Blockchain

| Syllabus topic | Coverage | Evidence and limits |
| --- | --- | --- |
| Security challenges | Implemented defenses + analysis | Key ownership, authorization, replay, per-call and cumulative bounds, revocation, proof tampering, privacy and trust boundaries |
| Performance challenges | Implemented design + measurement opportunity | Batches of up to 32, off-chain content, SQLite WAL and compact proofs. Benchmark measured tradeoffs before making performance claims |
| Domain-specific smart contract | Implemented | Policy-controlled tool execution and verifiable receipt accounting are the chosen application domain |
| Hyperledger and permissioned alternatives | Comparative discussion | Consortium governance and organization identities may fit enterprise workflows; no Fabric network or chaincode is included |
| Solana, Flow, Avalanche, Cosmos and Polkadot | Comparative discussion / not implemented | Contrast execution models, ecosystem fit and interoperability as research topics; no multi-chain integration is claimed |
| Corda, Openchain and Multichain | Comparative discussion / not implemented | Relate platform choice to participants, privacy and operational trust; these systems are not deployed |
| NFTs | Not implemented | A receipt is a signed data record, not a minted NFT |
| Healthcare, government, finance, supply chain, food and water | Extension discussion | The receipt pattern can be studied for cross-organization evidence, but no regulated-data deployment or industry integration is supplied |

## Suggested presentation structure

Lead with Units 2 and 4, where the project implements the strongest material. Demonstrate content tampering, signature verification, a Merkle inclusion proof and an on-chain rejection. Use the Bitcoin lab to contrast SHA-256d/UTXOs with Ethereum's account-and-contract model. Finish by explaining consensus and platform tradeoffs honestly, rather than adding unused chains merely to increase the technology list.
