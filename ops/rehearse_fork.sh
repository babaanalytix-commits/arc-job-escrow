#!/bin/bash
# Rehearsal of the 5-step mainnet sequence on an arc-anvil fork of Arc mainnet.
# Same commands as mainnet except: --rpc-url $RPC (the fork) and --unlocked --from <wallet> instead of --browser.
set -euo pipefail
RPC=${RPC:-http://127.0.0.1:8547}
C=~/.local/bin/arc-cast; F=~/.local/bin/arc-forge
USDC=0x3600000000000000000000000000000000000000
REG=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
BUILDER=0xcCf8f9e4c7Ce491f379a3Fe26718b036AC752De8
CLIENT=0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A
AGENT=135; AMOUNT=1500000
SPEC=$($C keccak 0x$(xxd -p job1_spec.md | tr -d '\n'))
RESULT=$($C keccak 0x$(xxd -p ${RESULT_FILE:-rehearsal_report.json} | tr -d '\n'))
bal() { $C call $USDC "balanceOf(address)(uint256)" $1 --rpc-url $RPC | awk '{print $1}'; }
show() { echo "    builder USDC=$(bal $BUILDER) nonce=$($C nonce $BUILDER --rpc-url $RPC) | client USDC=$(bal $CLIENT) nonce=$($C nonce $CLIENT --rpc-url $RPC)${ESCROW:+ | escrow USDC=$(bal $ESCROW)}"; }
echo "fork chainId $($C chain-id --rpc-url $RPC) head $($C block-number --rpc-url $RPC)"; show
NB=$($C nonce $BUILDER --rpc-url $RPC); PRED=$($C compute-address $BUILDER --nonce $NB | awk '{print $NF}')
echo "STEP 1 deploy from builder (nonce $NB, predicted $PRED)"
cd .. && OUT=$($F create contracts/JobEscrow.sol:JobEscrow --rpc-url $RPC --from $BUILDER --unlocked --broadcast --constructor-args $USDC $REG 2>&1) && cd ops
ESCROW=$(echo "$OUT" | awk '/Deployed to:/{print $3}'); [ -n "$ESCROW" ] || { echo "$OUT" | tail -8; exit 1; }; echo "    deployed to $ESCROW (== predicted: $([ "$(echo $ESCROW | tr A-F a-f)" = "$(echo $PRED | tr A-F a-f)" ] && echo yes || echo NO)) tx $(echo "$OUT" | awk '/Transaction hash:/{print $3}')"
echo "    usdc()=$($C call $ESCROW 'usdc()(address)' --rpc-url $RPC) identityRegistry()=$($C call $ESCROW 'identityRegistry()(address)' --rpc-url $RPC) REVIEW_WINDOW=$($C call $ESCROW 'REVIEW_WINDOW()(uint64)' --rpc-url $RPC | awk '{print $1}')"; show
echo "STEP 2 client approves $AMOUNT to the escrow (nonce 0)"
$C send $USDC "approve(address,uint256)" $ESCROW $AMOUNT --rpc-url $RPC --from $CLIENT --unlocked >/dev/null
echo "    allowance=$($C call $USDC 'allowance(address,address)(uint256)' $CLIENT $ESCROW --rpc-url $RPC | awk '{print $1}')"; show
NOW=$($C block --rpc-url $RPC -f timestamp); DEADLINE=$((NOW + 7*86400))
echo "STEP 3 client createJob(agent $AGENT, $AMOUNT, deadline $DEADLINE, spec $SPEC) (nonce 1)"
TX3=$($C send $ESCROW "createJob(uint256,uint256,uint64,bytes32)" $AGENT $AMOUNT $DEADLINE $SPEC --rpc-url $RPC --from $CLIENT --unlocked --json | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "    JobCreated logs in tx: $($C receipt $TX3 logs --rpc-url $RPC | grep -c topics)"; echo "    job 1 = $($C call $ESCROW 'getJob(uint256)((address,uint256,uint256,uint64,bytes32,uint8,bytes32,address,uint64))' 1 --rpc-url $RPC)"; show
echo "STEP 4 builder (agent 135 owner) submitResult(1, $RESULT)"
$C send $ESCROW "submitResult(uint256,bytes32)" 1 $RESULT --rpc-url $RPC --from $BUILDER --unlocked >/dev/null
echo "    job 1 = $($C call $ESCROW 'getJob(uint256)((address,uint256,uint256,uint64,bytes32,uint8,bytes32,address,uint64))' 1 --rpc-url $RPC)"; show
echo "STEP 5 client approve(1)"
$C send $ESCROW "approve(uint256)" 1 --rpc-url $RPC --from $CLIENT --unlocked >/dev/null
echo "    job 1 status=$($C call $ESCROW 'getJob(uint256)((address,uint256,uint256,uint64,bytes32,uint8,bytes32,address,uint64))' 1 --rpc-url $RPC | python3 -c "import sys; print(sys.stdin.read().split(',')[5].strip())") (2 = Approved)"; show
echo "ESCROW=$ESCROW"
