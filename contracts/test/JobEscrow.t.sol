// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {JobEscrow} from "../JobEscrow.sol";
import {MockUSDC} from "../test-helpers/MockUSDC.sol";
import {MockIdentityRegistry} from "../test-helpers/MockIdentityRegistry.sol";

// ═════════════════════════════════════════════════════════════════════════════
//  Shared base — deploy once per test in setUp()
// ═════════════════════════════════════════════════════════════════════════════
contract JobEscrowBase is Test {
    MockUSDC             internal usdc;
    MockIdentityRegistry internal registry;
    JobEscrow            internal escrow;

    address internal client     = makeAddr("client");
    address internal agentOwner = makeAddr("agentOwner");
    address internal stranger   = makeAddr("stranger");

    uint256 internal constant AGENT_ID  = 1;
    uint256 internal constant AMOUNT    = 1_000e6;      // 1 000 USDC (6 dp)
    uint64  internal constant DEADLINE  = 7 days;       // relative offset added in setUp
    bytes32 internal constant SPEC_HASH = keccak256("spec");
    bytes32 internal constant RESULT_HASH = keccak256("result");

    uint64 internal deadline; // absolute timestamp set in setUp

    function setUp() public virtual {
        usdc     = new MockUSDC();
        registry = new MockIdentityRegistry();
        escrow   = new JobEscrow(address(usdc), address(registry));

        registry.register(AGENT_ID, agentOwner);

        deadline = uint64(block.timestamp + DEADLINE);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// Fund client and create a job; returns jobId.
    function _createJob() internal returns (uint256 jobId) {
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);
        vm.prank(client);
        jobId = escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);
    }

    /// Create job then have agentOwner submit a result; returns jobId.
    function _submitJob() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(agentOwner);
        escrow.submitResult(jobId, RESULT_HASH);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  createJob
// ═════════════════════════════════════════════════════════════════════════════
contract CreateJobTest is JobEscrowBase {

    // ── happy path ────────────────────────────────────────────────────────────

    function test_CreateJob_HappyPath_StoresJob() public {
        uint256 jobId = _createJob();

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.client,   client,    "client mismatch");
        assertEq(job.agentId,  AGENT_ID,  "agentId mismatch");
        assertEq(job.amount,   AMOUNT,    "amount mismatch");
        assertEq(job.deadline, deadline,  "deadline mismatch");
        assertEq(job.specHash, SPEC_HASH, "specHash mismatch");
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Open), "status should be Open");
    }

    function test_CreateJob_HappyPath_EmitsJobCreated() public {
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit JobEscrow.JobCreated(1, client, AGENT_ID, AMOUNT, deadline, SPEC_HASH);

        vm.prank(client);
        escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);
    }

    function test_CreateJob_HappyPath_PullsUSDCFromClient() public {
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        assertEq(usdc.balanceOf(client), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        vm.prank(client);
        escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);

        assertEq(usdc.balanceOf(client), 0,      "client balance should be 0 after createJob");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow should hold the USDC");
    }

    // ── job IDs ───────────────────────────────────────────────────────────────

    function test_CreateJob_FirstJobIdIsOne() public {
        uint256 jobId = _createJob();
        assertEq(jobId, 1, "first job id should be 1");
    }

    function test_CreateJob_SecondJobIdIsTwo() public {
        _createJob();
        uint256 jobId2 = _createJob();
        assertEq(jobId2, 2, "second job id should be 2");
    }

    // ── reverts ───────────────────────────────────────────────────────────────

    function test_CreateJob_Reverts_ZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.ZeroAmount.selector);
        escrow.createJob(AGENT_ID, 0, deadline, SPEC_HASH);
    }

    function test_CreateJob_Reverts_DeadlinePast_EqualTimestamp() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.DeadlinePast.selector);
        escrow.createJob(AGENT_ID, AMOUNT, uint64(block.timestamp), SPEC_HASH);
    }

    function test_CreateJob_Reverts_DeadlinePast_PastTimestamp() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.DeadlinePast.selector);
        escrow.createJob(AGENT_ID, AMOUNT, uint64(block.timestamp - 1), SPEC_HASH);
    }

    function test_CreateJob_Reverts_UnknownAgent_OwnerOfReverts() public {
        registry.setRevertOnOwnerOf(true);
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.UnknownAgent.selector, AGENT_ID));
        escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);
    }

    function test_CreateJob_Reverts_UnknownAgent_OwnerOfReturnsZero() public {
        // Register with zero via setReturnZeroFor (ownerOf returns address(0))
        registry.setReturnZeroFor(AGENT_ID, true);
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.UnknownAgent.selector, AGENT_ID));
        escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);
    }

    function test_CreateJob_Reverts_TransferFailed() public {
        usdc.setTransferFromSucceeds(false);
        usdc.mint(client, AMOUNT);
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        vm.prank(client);
        vm.expectRevert(JobEscrow.TransferFailed.selector);
        escrow.createJob(AGENT_ID, AMOUNT, deadline, SPEC_HASH);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  submitResult
// ═════════════════════════════════════════════════════════════════════════════
contract SubmitResultTest is JobEscrowBase {

    // ── happy path ────────────────────────────────────────────────────────────

    function test_SubmitResult_HappyPath_EmitsResultSubmitted() public {
        uint256 jobId = _createJob();

        vm.expectEmit(true, false, true, true, address(escrow));
        emit JobEscrow.ResultSubmitted(jobId, AGENT_ID, agentOwner, RESULT_HASH);

        vm.prank(agentOwner);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    function test_SubmitResult_HappyPath_StatusIsSubmitted() public {
        uint256 jobId = _createJob();
        vm.prank(agentOwner);
        escrow.submitResult(jobId, RESULT_HASH);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Submitted), "status should be Submitted");
    }

    function test_SubmitResult_HappyPath_RecordsPayee() public {
        uint256 jobId = _createJob();
        vm.prank(agentOwner);
        escrow.submitResult(jobId, RESULT_HASH);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.payee, agentOwner, "payee should be agentOwner (msg.sender)");
    }

    function test_SubmitResult_HappyPath_SetsSubmittedAtToBlockTimestamp() public {
        uint256 jobId = _createJob();
        uint256 ts = block.timestamp;
        vm.prank(agentOwner);
        escrow.submitResult(jobId, RESULT_HASH);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint256(job.submittedAt), ts, "submittedAt should equal block.timestamp");
    }

    // ── JobNotFound ───────────────────────────────────────────────────────────

    function test_SubmitResult_Reverts_JobNotFound_ZeroId() public {
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotFound.selector, 0));
        escrow.submitResult(0, RESULT_HASH);
    }

    function test_SubmitResult_Reverts_JobNotFound_LargeUnknownId() public {
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotFound.selector, 999_999));
        escrow.submitResult(999_999, RESULT_HASH);
    }

    // ── NotOpen ───────────────────────────────────────────────────────────────

    function test_SubmitResult_Reverts_NotOpen_AlreadySubmitted() public {
        uint256 jobId = _submitJob();
        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    function test_SubmitResult_Reverts_NotOpen_AlreadyApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    function test_SubmitResult_Reverts_NotOpen_AlreadyRefunded() public {
        uint256 jobId = _createJob();
        // warp past deadline so refund is allowed
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    function test_SubmitResult_Reverts_NotOpen_AlreadyReleased() public {
        uint256 jobId = _submitJob();
        // warp past review window
        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    // ── DeadlineExpired ───────────────────────────────────────────────────────

    function test_SubmitResult_Reverts_DeadlineExpired() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.DeadlineExpired.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    // ── NotAgentOwner ─────────────────────────────────────────────────────────

    function test_SubmitResult_Reverts_NotAgentOwner() public {
        uint256 jobId = _createJob();

        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotAgentOwner.selector);
        escrow.submitResult(jobId, RESULT_HASH);
    }

    // ── ZeroResultHash ────────────────────────────────────────────────────────

    function test_SubmitResult_Reverts_ZeroResultHash() public {
        uint256 jobId = _createJob();

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.ZeroResultHash.selector);
        escrow.submitResult(jobId, bytes32(0));
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  updatePayee
// ═════════════════════════════════════════════════════════════════════════════
contract UpdatePayeeTest is JobEscrowBase {
    address internal newPayee = makeAddr("newPayee");

    // ── happy path ────────────────────────────────────────────────────────────

    function test_UpdatePayee_HappyPath_EmitsPayeeUpdated() public {
        uint256 jobId = _submitJob();

        vm.expectEmit(true, true, true, false, address(escrow));
        emit JobEscrow.PayeeUpdated(jobId, agentOwner, newPayee);

        vm.prank(agentOwner);
        escrow.updatePayee(jobId, newPayee);
    }

    function test_UpdatePayee_HappyPath_UpdatesJobPayee() public {
        uint256 jobId = _submitJob();

        vm.prank(agentOwner);
        escrow.updatePayee(jobId, newPayee);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.payee, newPayee, "job.payee should be updated to newPayee");
    }

    // ── ZeroAddress ───────────────────────────────────────────────────────────

    function test_UpdatePayee_Reverts_ZeroAddress() public {
        uint256 jobId = _submitJob();

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        escrow.updatePayee(jobId, address(0));
    }

    // ── JobNotFound ───────────────────────────────────────────────────────────

    function test_UpdatePayee_Reverts_JobNotFound() public {
        vm.prank(agentOwner);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotFound.selector, 9999));
        escrow.updatePayee(9999, newPayee);
    }

    // ── NotSubmitted (wrong status) ───────────────────────────────────────────

    function test_UpdatePayee_Reverts_NotSubmitted_WhenOpen() public {
        uint256 jobId = _createJob();

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    function test_UpdatePayee_Reverts_NotSubmitted_WhenApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    function test_UpdatePayee_Reverts_NotSubmitted_WhenRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    function test_UpdatePayee_Reverts_NotSubmitted_WhenReleased() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    // ── NotAgentOwner ─────────────────────────────────────────────────────────

    function test_UpdatePayee_Reverts_NotAgentOwner_Stranger() public {
        uint256 jobId = _submitJob();

        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotAgentOwner.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    function test_UpdatePayee_Reverts_NotAgentOwner_Client() public {
        uint256 jobId = _submitJob();

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotAgentOwner.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    // ── NFT ownership transfer ────────────────────────────────────────────────

    function test_UpdatePayee_AfterNFTTransfer_NewOwnerCanUpdate() public {
        uint256 jobId = _submitJob();

        address newOwner = makeAddr("newNFTOwner");
        // Simulate NFT transfer: registry now points agentId to newOwner
        registry.transferOwnership(AGENT_ID, newOwner);

        vm.prank(newOwner);
        escrow.updatePayee(jobId, newPayee);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.payee, newPayee, "new NFT owner should be able to update payee");
    }

    function test_UpdatePayee_AfterNFTTransfer_OldOwnerCannotUpdate() public {
        uint256 jobId = _submitJob();

        address newOwner = makeAddr("newNFTOwner");
        registry.transferOwnership(AGENT_ID, newOwner);

        // Original agentOwner is no longer the NFT owner — should revert
        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotAgentOwner.selector);
        escrow.updatePayee(jobId, newPayee);
    }

    // ── updatePayee then approve pays new payee ───────────────────────────────

    function test_UpdatePayee_ThenApprove_PaysNewPayee() public {
        uint256 jobId = _submitJob();

        vm.prank(agentOwner);
        escrow.updatePayee(jobId, newPayee);

        uint256 balBefore = usdc.balanceOf(newPayee);
        vm.prank(client);
        escrow.approve(jobId);

        assertEq(usdc.balanceOf(newPayee), balBefore + AMOUNT, "new payee should receive USDC on approve");
    }

    // ── updatePayee then release pays new payee ───────────────────────────────

    function test_UpdatePayee_ThenRelease_PaysNewPayee() public {
        uint256 jobId = _submitJob();

        vm.prank(agentOwner);
        escrow.updatePayee(jobId, newPayee);

        vm.warp(block.timestamp + 72 hours);

        uint256 balBefore = usdc.balanceOf(newPayee);
        escrow.release(jobId);

        assertEq(usdc.balanceOf(newPayee), balBefore + AMOUNT, "new payee should receive USDC on release");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  approve
// ═════════════════════════════════════════════════════════════════════════════
contract ApproveTest is JobEscrowBase {

    // ── happy path ────────────────────────────────────────────────────────────

    function test_Approve_HappyPath_EmitsJobApproved() public {
        uint256 jobId = _submitJob();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit JobEscrow.JobApproved(jobId, agentOwner, AMOUNT);

        vm.prank(client);
        escrow.approve(jobId);
    }

    function test_Approve_HappyPath_PaysPayee() public {
        uint256 jobId = _submitJob();

        uint256 balBefore = usdc.balanceOf(agentOwner);
        vm.prank(client);
        escrow.approve(jobId);

        assertEq(usdc.balanceOf(agentOwner), balBefore + AMOUNT, "agentOwner should receive USDC");
    }

    function test_Approve_HappyPath_StatusIsApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Approved), "status should be Approved");
    }

    // ── NotClient ─────────────────────────────────────────────────────────────

    function test_Approve_Reverts_NotClient_Stranger() public {
        uint256 jobId = _submitJob();
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotClient.selector);
        escrow.approve(jobId);
    }

    function test_Approve_Reverts_NotClient_AgentOwner() public {
        uint256 jobId = _submitJob();
        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotClient.selector);
        escrow.approve(jobId);
    }

    // ── NotSubmitted ──────────────────────────────────────────────────────────

    function test_Approve_Reverts_NotSubmitted_WhenOpen() public {
        uint256 jobId = _createJob();
        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }

    function test_Approve_Reverts_NotSubmitted_WhenAlreadyApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }

    function test_Approve_Reverts_NotSubmitted_WhenRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }

    function test_Approve_Reverts_NotSubmitted_WhenReleased() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }

    // ── pays exactly once ─────────────────────────────────────────────────────

    function test_Approve_PaysExactlyOnce_SecondCallReverts() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        // Second call reverts NotSubmitted
        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  release
// ═════════════════════════════════════════════════════════════════════════════
contract ReleaseTest is JobEscrowBase {

    // ── happy path ────────────────────────────────────────────────────────────

    function test_Release_HappyPath_EmitsJobReleased() public {
        uint256 jobId = _submitJob();
        uint256 ts = block.timestamp;
        vm.warp(ts + 72 hours);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit JobEscrow.JobReleased(jobId, agentOwner, AMOUNT, address(this));

        escrow.release(jobId);
    }

    function test_Release_HappyPath_StatusIsReleased() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Released), "status should be Released");
    }

    function test_Release_HappyPath_PaysPayee() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);

        uint256 balBefore = usdc.balanceOf(agentOwner);
        escrow.release(jobId);

        assertEq(usdc.balanceOf(agentOwner), balBefore + AMOUNT, "agentOwner should receive USDC on release");
    }

    // ── JobNotFound ───────────────────────────────────────────────────────────

    function test_Release_Reverts_JobNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.JobNotFound.selector, 42));
        escrow.release(42);
    }

    // ── NotSubmitted ──────────────────────────────────────────────────────────

    function test_Release_Reverts_NotSubmitted_WhenOpen() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.release(jobId);
    }

    function test_Release_Reverts_NotSubmitted_WhenApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.release(jobId);
    }

    function test_Release_Reverts_NotSubmitted_WhenRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.release(jobId);
    }

    // ── ReviewWindowNotElapsed ────────────────────────────────────────────────

    function test_Release_Reverts_ReviewWindowNotElapsed_BeforeWindow() public {
        uint256 jobId = _submitJob();
        // Do NOT warp — still within review window
        vm.expectRevert(JobEscrow.ReviewWindowNotElapsed.selector);
        escrow.release(jobId);
    }

    function test_Release_Reverts_ReviewWindowNotElapsed_OneSecondBefore() public {
        uint256 jobId = _submitJob();
        uint256 submittedAt = block.timestamp;
        vm.warp(submittedAt + 72 hours - 1);
        vm.expectRevert(JobEscrow.ReviewWindowNotElapsed.selector);
        escrow.release(jobId);
    }

    // ── exact boundary: submittedAt + 72 hours succeeds ──────────────────────

    function test_Release_SucceedsAtExactBoundary() public {
        uint256 jobId = _submitJob();
        uint256 submittedAt = block.timestamp;
        vm.warp(submittedAt + 72 hours);
        // Should NOT revert
        escrow.release(jobId);
        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Released));
    }

    // ── release and approve cannot both pay ───────────────────────────────────

    function test_Release_AfterApprove_SecondCallReverts() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);

        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.release(jobId);
    }

    function test_Approve_AfterRelease_SecondCallReverts() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotSubmitted.selector);
        escrow.approve(jobId);
    }

    // ── third party can release ───────────────────────────────────────────────

    function test_Release_ThirdParty_CanCallRelease() public {
        uint256 jobId = _submitJob();
        vm.warp(block.timestamp + 72 hours);

        // stranger is neither client nor agentOwner
        vm.prank(stranger);
        escrow.release(jobId);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Released), "third party should be able to release");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  refund
// ═════════════════════════════════════════════════════════════════════════════
contract RefundTest is JobEscrowBase {

    // ── happy path ────────────────────────────────────────────────────────────

    function test_Refund_HappyPath_EmitsJobRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit JobEscrow.JobRefunded(jobId, client, AMOUNT);

        vm.prank(client);
        escrow.refund(jobId);
    }

    function test_Refund_HappyPath_ReturnsUSDCToClient() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);

        uint256 balBefore = usdc.balanceOf(client);
        vm.prank(client);
        escrow.refund(jobId);

        assertEq(usdc.balanceOf(client), balBefore + AMOUNT, "client should receive USDC back");
    }

    function test_Refund_HappyPath_StatusIsRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        JobEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(JobEscrow.Status.Refunded), "status should be Refunded");
    }

    // ── NotClient ─────────────────────────────────────────────────────────────

    function test_Refund_Reverts_NotClient_Stranger() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);

        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotClient.selector);
        escrow.refund(jobId);
    }

    function test_Refund_Reverts_NotClient_AgentOwner() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);

        vm.prank(agentOwner);
        vm.expectRevert(JobEscrow.NotClient.selector);
        escrow.refund(jobId);
    }

    // ── DeadlineNotExpired ────────────────────────────────────────────────────

    function test_Refund_Reverts_DeadlineNotExpired_BeforeDeadline() public {
        uint256 jobId = _createJob();
        // Still before deadline — no warp

        vm.prank(client);
        vm.expectRevert(JobEscrow.DeadlineNotExpired.selector);
        escrow.refund(jobId);
    }

    function test_Refund_Reverts_DeadlineNotExpired_AtDeadline() public {
        uint256 jobId = _createJob();
        vm.warp(deadline);  // at exactly deadline, condition is block.timestamp <= deadline

        vm.prank(client);
        vm.expectRevert(JobEscrow.DeadlineNotExpired.selector);
        escrow.refund(jobId);
    }

    // ── NotOpen ───────────────────────────────────────────────────────────────

    function test_Refund_Reverts_NotOpen_WhenSubmitted() public {
        uint256 jobId = _submitJob();
        vm.warp(deadline + 1);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.refund(jobId);
    }

    function test_Refund_Reverts_NotOpen_WhenApproved() public {
        uint256 jobId = _submitJob();
        vm.prank(client);
        escrow.approve(jobId);
        vm.warp(deadline + 1);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.refund(jobId);
    }

    function test_Refund_Reverts_NotOpen_WhenReleased() public {
        uint256 jobId = _submitJob();
        // Warp past both the review window AND the job deadline so the refund's
        // DeadlineNotExpired guard passes; the NotOpen guard should then fire.
        vm.warp(deadline + 1);
        // Release requires status == Submitted and window elapsed; deadline is 7 days,
        // 72 hours < 7 days so the review window has elapsed too.
        escrow.release(jobId);

        // Now status == Released and deadline has passed → NotOpen fires.
        vm.prank(client);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.refund(jobId);
    }

    // ── refund returns exactly once ───────────────────────────────────────────

    function test_Refund_RefundsExactlyOnce_SecondCallReverts() public {
        uint256 jobId = _createJob();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(jobId);

        vm.prank(client);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.refund(jobId);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Exploit prevention
// ═════════════════════════════════════════════════════════════════════════════
contract ExploitPreventionTest is JobEscrowBase {

    // ── client cannot refund after submission (before or after deadline) ──────

    function test_Exploit_ClientCannotRefundAfterSubmit_BeforeDeadline() public {
        uint256 jobId = _submitJob(); // status = Submitted

        // Deadline has not passed — but refund should revert NotOpen (not DeadlineNotExpired)
        // because the status check (NotOpen) comes after the deadline check in refund.
        // Actually the contract checks: NotClient → DeadlineNotExpired → NotOpen.
        // block.timestamp <= deadline → revert DeadlineNotExpired, but the status would
        // also block it. Either way client is blocked — assert the actual first revert.
        vm.prank(client);
        vm.expectRevert(JobEscrow.DeadlineNotExpired.selector);
        escrow.refund(jobId);
    }

    function test_Exploit_ClientCannotRefundAfterSubmit_AfterDeadline() public {
        uint256 jobId = _submitJob(); // status = Submitted
        vm.warp(deadline + 1);       // past deadline

        // status is Submitted (not Open) → NotOpen
        vm.prank(client);
        vm.expectRevert(JobEscrow.NotOpen.selector);
        escrow.refund(jobId);
    }

    // ── cancelSubmission does not exist ───────────────────────────────────────

    function test_Exploit_CancelSubmissionDoesNotExist() public {
        uint256 jobId = _submitJob();

        // Craft the selector for a hypothetical cancelSubmission(uint256)
        bytes4 sel = bytes4(keccak256("cancelSubmission(uint256)"));
        (bool ok, ) = address(escrow).call(abi.encodeWithSelector(sel, jobId));
        assertFalse(ok, "cancelSubmission should not exist and call should fail");
    }

    // ── agent paid via release; client gets nothing ───────────────────────────

    function test_Exploit_ReleaseAfter72h_AgentPaid_ClientGetsNothing() public {
        uint256 jobId = _submitJob();

        uint256 clientBalBefore = usdc.balanceOf(client);
        uint256 agentBalBefore  = usdc.balanceOf(agentOwner);

        vm.warp(block.timestamp + 72 hours);
        escrow.release(jobId);

        assertEq(usdc.balanceOf(agentOwner), agentBalBefore + AMOUNT, "agent should be paid");
        assertEq(usdc.balanceOf(client), clientBalBefore,             "client should get nothing");
        assertEq(usdc.balanceOf(address(escrow)), 0,                  "escrow should be empty");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Invariant: escrow USDC balance == sum(amount) for Open + Submitted jobs
// ═════════════════════════════════════════════════════════════════════════════

contract JobEscrowHandler is Test {
    JobEscrow            public escrow;
    MockUSDC             public usdc;
    MockIdentityRegistry public registry;

    address internal client     = makeAddr("invariant_client");
    address internal agentOwner = makeAddr("invariant_agentOwner");
    uint256 internal constant AGENT_ID = 99;

    // Tracks all job IDs ever created and their current amounts.
    uint256[] public allJobIds;

    constructor(JobEscrow escrow_, MockUSDC usdc_, MockIdentityRegistry registry_) {
        escrow   = escrow_;
        usdc     = usdc_;
        registry = registry_;
        registry.register(AGENT_ID, agentOwner);
    }

    // ── handler: createJob ────────────────────────────────────────────────────

    function createJob(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        uint64 dl = uint64(block.timestamp + 1 days);

        usdc.mint(client, amount);
        vm.prank(client);
        usdc.approve(address(escrow), amount);

        vm.prank(client);
        try escrow.createJob(AGENT_ID, amount, dl, keccak256("spec")) returns (uint256 jobId) {
            allJobIds.push(jobId);
        } catch {}
    }

    // ── handler: submitResult ─────────────────────────────────────────────────

    function submitResult(uint256 seed) external {
        if (allJobIds.length == 0) return;
        uint256 idx   = seed % allJobIds.length;
        uint256 jobId = allJobIds[idx];
        JobEscrow.Job memory job = escrow.getJob(jobId);
        if (job.status != JobEscrow.Status.Open) return;
        if (block.timestamp > job.deadline) return;

        vm.prank(agentOwner);
        try escrow.submitResult(jobId, keccak256("result")) {} catch {}
    }

    // ── handler: approve ──────────────────────────────────────────────────────

    function approve(uint256 seed) external {
        if (allJobIds.length == 0) return;
        uint256 idx   = seed % allJobIds.length;
        uint256 jobId = allJobIds[idx];
        JobEscrow.Job memory job = escrow.getJob(jobId);
        if (job.status != JobEscrow.Status.Submitted) return;

        vm.prank(client);
        try escrow.approve(jobId) {} catch {}
    }

    // ── handler: release ──────────────────────────────────────────────────────

    function release(uint256 seed) external {
        if (allJobIds.length == 0) return;
        uint256 idx   = seed % allJobIds.length;
        uint256 jobId = allJobIds[idx];
        JobEscrow.Job memory job = escrow.getJob(jobId);
        if (job.status != JobEscrow.Status.Submitted) return;
        if (block.timestamp < job.submittedAt + 72 hours) return;

        try escrow.release(jobId) {} catch {}
    }

    // ── handler: refund ───────────────────────────────────────────────────────

    function refund(uint256 seed) external {
        if (allJobIds.length == 0) return;
        uint256 idx   = seed % allJobIds.length;
        uint256 jobId = allJobIds[idx];
        JobEscrow.Job memory job = escrow.getJob(jobId);
        if (job.status != JobEscrow.Status.Open) return;
        if (block.timestamp <= job.deadline) return;

        vm.prank(client);
        try escrow.refund(jobId) {} catch {}
    }

    // ── sum helper ────────────────────────────────────────────────────────────

    /// Returns the sum of amounts for all Open + Submitted jobs.
    function sumOpenAndSubmitted() external view returns (uint256 total) {
        for (uint256 i = 0; i < allJobIds.length; i++) {
            JobEscrow.Job memory job = escrow.getJob(allJobIds[i]);
            if (job.status == JobEscrow.Status.Open || job.status == JobEscrow.Status.Submitted) {
                total += job.amount;
            }
        }
    }
}

contract JobEscrowInvariantTest is Test {
    MockUSDC             internal usdc;
    MockIdentityRegistry internal registry;
    JobEscrow            internal escrow;
    JobEscrowHandler     internal handler;

    function setUp() public {
        usdc     = new MockUSDC();
        registry = new MockIdentityRegistry();
        escrow   = new JobEscrow(address(usdc), address(registry));
        handler  = new JobEscrowHandler(escrow, usdc, registry);

        // Scope fuzzer to only call handler functions
        targetContract(address(handler));
    }

    /// @notice Escrow USDC balance must always equal the sum of amounts for Open + Submitted jobs.
    function invariant_EscrowBalanceMatchesOpenAndSubmitted() public view {
        uint256 expected = handler.sumOpenAndSubmitted();
        uint256 actual   = usdc.balanceOf(address(escrow));
        assertEq(actual, expected, "Invariant violated: escrow balance != sum of Open+Submitted amounts");
    }
}
