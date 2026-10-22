// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUSDC {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract JobEscrow {
    // ─── Status ──────────────────────────────────────────────────────────────
    enum Status {
        Open,       // funded, awaiting result
        Submitted,  // result submitted, awaiting approval or 72h window
        Approved,   // client approved, agent paid
        Refunded,   // client refunded (only valid when Open after deadline)
        Released    // anyone triggered auto-release after REVIEW_WINDOW
    }

    // ─── Storage ─────────────────────────────────────────────────────────────
    struct Job {
        address client;
        uint256 agentId;
        uint256 amount;      // USDC 6-decimal raw
        uint64  deadline;
        bytes32 specHash;
        Status  status;
        bytes32 resultHash;
        address payee;
        uint64  submittedAt; // set when submitResult succeeds
    }

    uint64 public constant REVIEW_WINDOW = 72 hours;

    IUSDC public immutable usdc;
    IIdentityRegistry public immutable identityRegistry;

    mapping(uint256 => Job) public jobs;
    uint256 private _jobCounter;

    // ─── Errors ──────────────────────────────────────────────────────────────
    error ZeroAmount();
    error DeadlinePast();
    error UnknownAgent(uint256 agentId);
    error TransferFailed();
    error JobNotFound(uint256 jobId);
    error NotOpen();
    error DeadlineExpired();
    error NotAgentOwner();
    error ZeroResultHash();
    error NotClient();
    error NotSubmitted();
    error DeadlineNotExpired();
    error ReviewWindowNotElapsed();
    error ZeroAddress();

    // ─── Events ──────────────────────────────────────────────────────────────
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        uint256 agentId,
        uint256 amount,
        uint64  deadline,
        bytes32 specHash
    );
    event ResultSubmitted(uint256 indexed jobId, uint256 agentId, address indexed payee, bytes32 resultHash);
    event PayeeUpdated(uint256 indexed jobId, address indexed oldPayee, address indexed newPayee);
    event JobApproved(uint256 indexed jobId, address indexed payee, uint256 amount);
    event JobReleased(uint256 indexed jobId, address indexed payee, uint256 amount, address indexed caller);
    event JobRefunded(uint256 indexed jobId, address indexed client, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(address usdc_, address identityRegistry_) {
        usdc = IUSDC(usdc_);
        identityRegistry = IIdentityRegistry(identityRegistry_);
    }

    // ─── Functions ───────────────────────────────────────────────────────────

    /// @notice Client funds a job for a registered agent.
    function createJob(uint256 agentId, uint256 amountUSDC, uint64 deadline, bytes32 specHash)
        external
        returns (uint256 jobId)
    {
        if (amountUSDC == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlinePast();

        address agentOwner;
        try identityRegistry.ownerOf(agentId) returns (address owner) {
            agentOwner = owner;
        } catch {
            revert UnknownAgent(agentId);
        }
        if (agentOwner == address(0)) revert UnknownAgent(agentId);

        if (!usdc.transferFrom(msg.sender, address(this), amountUSDC)) revert TransferFailed();

        jobId = ++_jobCounter;
        jobs[jobId] = Job({
            client:      msg.sender,
            agentId:     agentId,
            amount:      amountUSDC,
            deadline:    deadline,
            specHash:    specHash,
            status:      Status.Open,
            resultHash:  bytes32(0),
            payee:       address(0),
            submittedAt: 0
        });

        emit JobCreated(jobId, msg.sender, agentId, amountUSDC, deadline, specHash);
    }

    /// @notice Current agent-NFT owner submits a result before the deadline.
    function submitResult(uint256 jobId, bytes32 resultHash) external {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound(jobId);
        if (job.status != Status.Open) revert NotOpen();
        if (block.timestamp > job.deadline) revert DeadlineExpired();
        if (resultHash == bytes32(0)) revert ZeroResultHash();

        address currentOwner;
        try identityRegistry.ownerOf(job.agentId) returns (address owner) {
            currentOwner = owner;
        } catch {
            revert UnknownAgent(job.agentId);
        }
        if (msg.sender != currentOwner) revert NotAgentOwner();

        job.resultHash  = resultHash;
        job.payee       = msg.sender;
        job.submittedAt = uint64(block.timestamp);
        job.status      = Status.Submitted;

        emit ResultSubmitted(jobId, job.agentId, msg.sender, resultHash);
    }

    /// @notice Current agent-NFT owner updates the payout address while Submitted.
    ///         Recovery path if the original payee cannot receive USDC (e.g. blocklisted).
    function updatePayee(uint256 jobId, address newPayee) external {
        if (newPayee == address(0)) revert ZeroAddress();
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound(jobId);
        if (job.status != Status.Submitted) revert NotSubmitted();

        address currentOwner;
        try identityRegistry.ownerOf(job.agentId) returns (address owner) {
            currentOwner = owner;
        } catch {
            revert UnknownAgent(job.agentId);
        }
        if (msg.sender != currentOwner) revert NotAgentOwner();

        address oldPayee = job.payee;
        job.payee = newPayee;

        emit PayeeUpdated(jobId, oldPayee, newPayee);
    }

    /// @notice Client approves the result and pays the agent immediately.
    function approve(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Submitted) revert NotSubmitted();

        address payee  = job.payee;
        uint256 amount = job.amount;
        job.status = Status.Approved;                          // CEI: state before transfer
        if (!usdc.transfer(payee, amount)) revert TransferFailed();

        emit JobApproved(jobId, payee, amount);
    }

    /// @notice Anyone may release payment once 72 h have elapsed since submission.
    function release(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (job.client == address(0)) revert JobNotFound(jobId);
        if (job.status != Status.Submitted) revert NotSubmitted();
        if (block.timestamp < job.submittedAt + REVIEW_WINDOW) revert ReviewWindowNotElapsed();

        address payee  = job.payee;
        uint256 amount = job.amount;
        job.status = Status.Released;                          // CEI: state before transfer
        if (!usdc.transfer(payee, amount)) revert TransferFailed();

        emit JobReleased(jobId, payee, amount, msg.sender);
    }

    /// @notice Client recovers funds only if no result was submitted and deadline passed.
    function refund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        if (msg.sender != job.client) revert NotClient();
        if (block.timestamp <= job.deadline) revert DeadlineNotExpired();
        if (job.status != Status.Open) revert NotOpen();

        uint256 amount = job.amount;
        job.status = Status.Refunded;                          // CEI: state before transfer
        if (!usdc.transfer(job.client, amount)) revert TransferFailed();

        emit JobRefunded(jobId, job.client, amount);
    }

    /// @notice Returns the full job struct.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
