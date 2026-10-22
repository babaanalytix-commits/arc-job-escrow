// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal ERC-20 mock for JobEscrow tests.
///      transferFrom and transfer return `_succeed` so failure paths can be tested.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool public transferFromSucceeds = true;
    bool public transferSucceeds = true;

    // ── configuration helpers ────────────────────────────────────────────────

    function setTransferFromSucceeds(bool ok) external {
        transferFromSucceeds = ok;
    }

    function setTransferSucceeds(bool ok) external {
        transferSucceeds = ok;
    }

    // ── mint helper ──────────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    // ── ERC-20-like surface (only what IUSDC needs) ──────────────────────────

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (!transferFromSucceeds) return false;
        require(balanceOf[from] >= amount, "MockUSDC: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (!transferSucceeds) return false;
        require(balanceOf[msg.sender] >= amount, "MockUSDC: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
