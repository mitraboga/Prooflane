// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Prooflane — policy-scoped, signed execution receipt anchors
/// @notice Audits what an authorized agent signed. Does not prove a tool ran, an
/// output is correct, or a claimed cost corresponds to a real-world payment.
/// @dev No token, custody, transfers, upgrade authority, or external calls.
contract Prooflane {
    uint256 public constant MAX_BATCH_SIZE = 32;
    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 mandateId,bytes32 actionHash,bytes32 inputHash,bytes32 outputHash,uint256 cost,uint256 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("Prooflane");
    bytes32 private constant VERSION_HASH = keccak256("1");
    // EIP-2 canonical low-s bound: secp256k1 curve order / 2.
    uint256 private constant HALF_CURVE_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Receipt {
        bytes32 mandateId;
        bytes32 actionHash;
        bytes32 inputHash;
        bytes32 outputHash;
        uint256 cost;
        uint256 nonce;
    }

    struct Mandate {
        address owner;
        address agent;
        bytes32 actionRoot;
        uint256 budget;
        uint256 maxPerReceipt;
        uint256 spent;
        uint256 nextNonce;
        uint64 expiresAt;
        bool revoked;
        bytes32 latestRoot;
    }

    struct Batch {
        bytes32 mandateId;
        bytes32 previousRoot;
        uint256 totalCost;
        uint256 count;
        bool exists;
    }

    mapping(bytes32 => Mandate) public mandates;
    mapping(bytes32 => Batch) public batches;

    error InvalidMandate();
    error MandateAlreadyExists();
    error MandateNotFound();
    error Unauthorized();
    error MandateRevoked();
    error MandateExpired();
    error InvalidBatch();
    error MandateMismatch();
    error InvalidNonce();
    error InvalidSignature();
    error ActionNotAllowed();
    error ReceiptCapExceeded();
    error BudgetExceeded();
    error RootAlreadyAnchored();

    event MandateCreated(
        bytes32 indexed mandateId,
        address indexed owner,
        address indexed agent,
        bytes32 actionRoot,
        uint256 budget,
        uint256 maxPerReceipt,
        uint64 expiresAt
    );
    event MandateRevokedEvent(bytes32 indexed mandateId);
    event BatchAnchored(
        bytes32 indexed mandateId,
        bytes32 indexed root,
        bytes32 previousRoot,
        uint256 totalCost,
        uint256 count,
        address relayer
    );

    /// @notice Creates an immutable agent policy; only its owner can revoke it.
    /// @dev Use unpredictable, owner-scoped ids to avoid public-id front-running.
    /// Budget and cost are integer audit units, not an amount of custodied funds.
    function createMandate(
        bytes32 id,
        address agent,
        bytes32 actionRoot,
        uint256 budget,
        uint256 maxPerReceipt,
        uint64 expiresAt
    ) external {
        if (
            id == bytes32(0) || agent == address(0) || actionRoot == bytes32(0)
                || budget == 0 || maxPerReceipt == 0 || maxPerReceipt > budget
                || expiresAt <= block.timestamp
        ) revert InvalidMandate();
        if (mandates[id].owner != address(0)) revert MandateAlreadyExists();
        mandates[id] = Mandate({
            owner: msg.sender,
            agent: agent,
            actionRoot: actionRoot,
            budget: budget,
            maxPerReceipt: maxPerReceipt,
            spent: 0,
            nextNonce: 0,
            expiresAt: expiresAt,
            revoked: false,
            latestRoot: bytes32(0)
        });
        emit MandateCreated(id, msg.sender, agent, actionRoot, budget, maxPerReceipt, expiresAt);
    }

    function revokeMandate(bytes32 id) external {
        Mandate storage mandate = mandates[id];
        if (mandate.owner == address(0)) revert MandateNotFound();
        if (msg.sender != mandate.owner) revert Unauthorized();
        if (mandate.revoked) revert MandateRevoked();
        mandate.revoked = true;
        emit MandateRevokedEvent(id);
    }

    /// @notice Anybody may relay a batch. Every receipt must be signed by the
    /// mandate's agent, with consecutive nonces in submitted order.
    /// @dev Whole batch is atomic. Receipt leaves are EIP-712 digests; sorted-pair
    /// Merkle construction promotes an unpaired odd leaf without duplicating it.
    function settleBatch(
        bytes32 mandateId,
        Receipt[] calldata receipts,
        bytes[] calldata signatures,
        bytes32[][] calldata actionProofs
    ) external returns (bytes32 root) {
        Mandate storage mandate = mandates[mandateId];
        if (mandate.owner == address(0)) revert MandateNotFound();
        if (mandate.revoked) revert MandateRevoked();
        if (block.timestamp >= mandate.expiresAt) revert MandateExpired();
        uint256 count = receipts.length;
        if (
            count == 0 || count > MAX_BATCH_SIZE || signatures.length != count
                || actionProofs.length != count
        ) revert InvalidBatch();

        uint256 totalCost;
        uint256 nonce = mandate.nextNonce;
        uint256 remaining = mandate.budget - mandate.spent;
        bytes32[] memory leaves = new bytes32[](count);
        for (uint256 i; i < count; ++i) {
            Receipt calldata receipt = receipts[i];
            if (receipt.mandateId != mandateId) revert MandateMismatch();
            if (receipt.nonce != nonce) revert InvalidNonce();
            if (receipt.cost > mandate.maxPerReceipt) revert ReceiptCapExceeded();
            // Subtract first so even adversarial uint256 costs cannot overflow.
            if (receipt.cost > remaining - totalCost) revert BudgetExceeded();
            if (!_verify(mandate.actionRoot, receipt.actionHash, actionProofs[i])) {
                revert ActionNotAllowed();
            }
            bytes32 digest = hashReceipt(receipt);
            if (_recover(digest, signatures[i]) != mandate.agent) revert InvalidSignature();
            leaves[i] = digest;
            totalCost += receipt.cost;
            ++nonce;
        }

        root = _merkleRoot(leaves);
        if (batches[root].exists) revert RootAlreadyAnchored();
        bytes32 previousRoot = mandate.latestRoot;
        batches[root] = Batch(mandateId, previousRoot, totalCost, count, true);
        mandate.spent += totalCost;
        mandate.nextNonce = nonce;
        mandate.latestRoot = root;
        emit BatchAnchored(mandateId, root, previousRoot, totalCost, count, msg.sender);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashReceipt(Receipt calldata receipt) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            RECEIPT_TYPEHASH,
            receipt.mandateId,
            receipt.actionHash,
            receipt.inputHash,
            receipt.outputHash,
            receipt.cost,
            receipt.nonce
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Checks inclusion of an EIP-712 receipt digest in an anchored batch.
    /// @dev Inclusion says nothing about the truth of the underlying tool output.
    function verifyReceipt(bytes32 root, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        Batch storage batch = batches[root];
        if (!batch.exists || (batch.count > 1 && proof.length == 0)) return false;
        return _verify(root, leaf, proof);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > HALF_CURVE_ORDER || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) private pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i; i < proof.length; ++i) computed = _hashPair(computed, proof[i]);
        return computed == root;
    }

    function _merkleRoot(bytes32[] memory nodes) private pure returns (bytes32) {
        uint256 length = nodes.length;
        while (length > 1) {
            uint256 nextLength;
            for (uint256 i; i < length; i += 2) {
                nodes[nextLength++] = i + 1 < length ? _hashPair(nodes[i], nodes[i + 1]) : nodes[i];
            }
            length = nextLength;
        }
        return nodes[0];
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
