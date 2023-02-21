# Demo version Algorithm as Story

## Disclaimer

The terminology maybe different from official architectural doc, which aims for product quality.
The terminology here stick to the original terminology we coined for quick-and-dirty demo coding.

Terminology Update:
INMOZ --> MozaicLP = mLP

## Features

User can Book Deposit.
User can Book Withdraw.
Control Center (as the owner of contract) run Optimization Session.
NOTE: Demo Limitation - In product version, the user should have choice to run Optimization Session to have his deposits/withdrawals accepted early at the cost of paying the gas fee.

### Advanced Features (Skip Now)

- User can cancel request (possible when the request is in pending status)
  Skipping because the secondary chain should send snapshot LZ message again. (Avoiding LZ messages as much as possible.)

## Story

### 1. User Books Deposit

- User call `addDepositRequest(amountLD, depositTokenAddr, destChainId)`
  - `poolInfos[poolIndex].coinAddress` indicates the stablecoin address
  - `amountLD` indicates the amount.

This adds to pending deposit requests buffer.

### 2. User Books Withdraw

- User call `addWithdrawRequest(amountMLP, dstTokenAddr, dstChainId)`
  - `amountMLP` - returning mLP amount to get back stable coin.
  - `dstTokenAddr` - the stable coin token address to get.
  - `dstChainId` - the destination chain ID of stable coin to get.

This adds to pending withdraw requests buffer.
Guard condition: overburning should be prevented. Meaning pending mLP to return <= owned mLP

### 3. Optimization Session

#### 3-1. Session Start (Protocol Status: Idle -> Optimizing)

Control Center calls `PrimaryVault.initOptimizationSession()`

- PrimaryVault.initOptimizationSession():
  - Guard condition: Check if current protocol status is idle. Otherwise reject.
  - Set protocol status as `Optimizing`
  - PrimaryVault trigger `self.snapshotAndReport()`

#### 3-2. Take Snapshot and Report

Control Center calls `Vault.snapshotAndReport()` on each (Secondary) Vault

Each (Secondary Vault) does the following:

- Take snapshot of the asset amounts
    This means turn pending deposits/Withdraws into `staged state`.

- Prepare snapshot report.
  ```sol
      struct Snapshot {
        uint256 depositRequestAmountSD;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }
  ```

- Send snapshot report to primary vault (LayerZero communication)

#### 3-3. Determine MLP per Stablecoin Rate

When all sync responses reach to primary vault, it determines the following
mozaicLpPerStablecoin = totalMozLp / (totalStablecoin + totalStargate*stargatePrice)

This means that we want to give out mLP in a fair way to new depositors.
(And also be fair to Withdrawers)

Initial Rate of mLP per staked USD : 1.000

#### 4. Execute Asset Transition

Asset Transition decision depends on snapshot reports.
And thus Asset Transision Subsession starts after all snapshot reports arrive primary vault.
Asset Transision Subsession runs before settling requests for two purposes:

- Have enough stablecoin to return, in order to satisfy Withdraw request
- Update Staking Assets to maximize profit rate

The control center call each vault's `executeActions()` method with proposed actions to execute (=order).

Each asset transition action should guarantee that no value slip out of Mozaic.

#### Special Note: The deposit/withdraw requests made while syncing are booked as `pending requests`.

Every deposit/withdraw request goes through the following lifecycle.
Pending --> Staged --> Accepted

#### 5. Settle Requests

Control Center calls primaryVault.settleRequestsAllVaults()

primaryVault.settleRequestsAllVaults() send LayerZero message to secondary vaults with mozaicLpPerStablecoin value, which will in turn,
call secondaryVault.settleRequests(mozaicLpPerStablecoin)

secondaryVault.settleRequests(mozaicLpPerStablecoin) settle deposit and withdraw requests

- Settle deposit request by giving mLP as mozaicLpPerStablecoin rate.
- Settle withdraw request by burning the mLP and giving the stablecoin as mozaicLpPerStablecoin rate.
- When there's not enough stablecoin to give for a withdraw request, we accept/burn partial amount of mLP. 
- When all requests are handled the sum of staged requests becomes zero.
- PoC: The control center awaits till all requests are handled and call `secondaryVault.reportSettled()`
- secondaryVault.reportSettled() sends simple LayerZero message to primary vault, saying all requests for the vault are settled.

As a result:
The staged requests are now settled. And the users mLP amount gets updated.
The primary vault will get notified via LayerZero message that all requests are settled

#### 6. Session Closes

Happens when: primary vault received REQUESTS_SETTLED messages from all secondary vaults.

- Set protocol status as `Idle`
- Clear snapshotReported. (flags) Getting ready to accept new Snapshots.

# At every moment, User state is composed of

- pending deposit requests (amount in USDC, USDT, ...)
- pending withdraw requests (amount in mLP)
- staged deposit requests (amount in USDC, USDT, ...)
- staged withdraw requests (amount in mLP)
- owned amount in mLP (=mLP balance)
- the owned mLP assessed as stablecoin (USDC)
