// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal IIdentityRegistry mock for JobEscrow tests.
///      Supports:
///        - register(agentId, owner)         — sets an owner
///        - transferOwnership(agentId, addr) — moves owner to new address
///        - setRevertOnOwnerOf(bool)         — makes ownerOf revert (for UnknownAgent tests)
///        - setReturnZeroFor(agentId, bool)  — makes ownerOf return address(0) for that id
contract MockIdentityRegistry {
    mapping(uint256 => address) private _owners;
    bool private _revertAll;
    mapping(uint256 => bool) private _returnZero;

    // ── registration helpers ─────────────────────────────────────────────────

    /// Register agentId → owner (non-zero).
    function register(uint256 agentId, address owner) external {
        _owners[agentId] = owner;
    }

    /// Transfer ownership of an agentId to a new address.
    function transferOwnership(uint256 agentId, address newOwner) external {
        _owners[agentId] = newOwner;
    }

    /// When true, every ownerOf call reverts (simulates an unregistered agent).
    function setRevertOnOwnerOf(bool shouldRevert) external {
        _revertAll = shouldRevert;
    }

    /// When true, ownerOf(agentId) returns address(0) instead of reverting.
    function setReturnZeroFor(uint256 agentId, bool returnZero) external {
        _returnZero[agentId] = returnZero;
    }

    // ── IIdentityRegistry surface ────────────────────────────────────────────

    function ownerOf(uint256 agentId) external view returns (address owner) {
        require(!_revertAll, "MockIdentityRegistry: unknown agent");
        if (_returnZero[agentId]) return address(0);
        owner = _owners[agentId];
        require(owner != address(0), "MockIdentityRegistry: unknown agent");
    }
}
