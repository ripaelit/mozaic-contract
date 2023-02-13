# Demo version Algorithm as Story

## Disclaimer

The terminology maybe different from official architectural doc, which aims for product quality.
The terminology here stick to the original terminology we coined for quick-and-dirty demo coding.

Terminology Update:
INMOZ --> MozaicLP = mLP

## Features

User can Book Deposit.
User can Book Withdraw.
Control Center (as the owner of contract) run Sync Session.
Control Center (as the owner of contract) run Asset Transition Session.
NOTE: Demo Limitation - In product version, the user should have choice to run Sync Session to have his deposits/withdrawals accepted early at the cost of paying the gas fee.

## Book Deposit

User call `requestDeposit(poolIndex, amountSD)`
`poolInfos[poolIndex].coinAddress` indicates the stablecoin address
`amountSD` indicates the amount.

This adds to `totalDeposits` and `pendingDeposits[depositeraddress]`

## Book Withdraw

User call `addWithdrawRequest(amountIM, poolIndex)`
`amountIM` - INMOZ amount to return to get back stable coin.
`poolInfos[poolIndex].coinAddress` indicates the stablecoin he wants to receive

This adds to `totalPendingWithdraws` and `pendingWithdraws[Withdraworaddress][poolIndex]` and `totalPendingWithdrawPerUser`
Guard condition: overburning should be prevented. Meaning pending INMOZ to return <= owned INMOZ

## Sync Session

### 1. Sync Start

Control Center calls PrimaryVault.initSyncSession()

PrimaryVault.initSyncSession()
- Check if current protocol status is idle. Otherwise reject.
- Clear snapshotReports. (flag and struct values) Getting ready to accept new SnapshotReports.

### 2. Sync Snapshot

Control Center calls `Vault.snapshotAndReport()` on each (Secondary) Vault

Each (Secondary Vault) does the following:

- Take snapshot of the asset amounts (YOU CAN SKIP NOW)
    This means turn pending deposits/Withdraws into `staged state`.
- Prepare snapshot report, which basically says
    How much stable coin assets are there (in stable coin) - `syncResponse.totalStablecoin`
    How much pending rewards (in STG) - `syncResponse.totalInmoz`
    How many pending depositements (in stable Coin)  - `syncResponse.totalPendingDeposits`
    <!-- How mnay pending Withdraws (in INMOZ)  -->
- Send snapshot report to primary vault

### 3. Sync Determine

When all sync responses reach to primary vault, it determines the following
mozaicLpPerStablecoin = totalMozLp / (totalStablecoin + totalStargate*stargatePrice)
(Check out onSyncResponse() and _syncVaults() in psudocode)

This means that we want to give out mLP in a fair way to new depositors.
(And also be fair to Withdrawors)

### 4. Execute Asset Transition Orders

Asset Transition decision depends on snapshot reports.
And thus Asset Transision Subsession starts after all snapshot reports arrive primary vault.
Asset Transision Subsession runs before Sync execution for two purposes:

- Have enough stablecoin to return, in order to satisfy Withdraw request
- Update Staking Assets to maximize profit rate

The control center call each vault's `executeOrders()` method with asset transition orders.

Each asset transition order should guarantee that no value slip out of Mozaic.

### Special Note: The deposit/withdraw requests made while syncing are booked as `pending requests`.

Every deposit/withdraw request goes through the following lifecycle.
Pending --> Staged --> Accepted

### 5. Accept Requests

Control Center calls primaryVault.acceptRequestsAllVaults()

primaryVault.acceptRequestsAllVaults() send LayerZero message to secondary vaults with mozaicLpPerStablecoin value, which will in turn,
call secondaryVault.acceptRequests(mozaicLpPerStablecoin)

secondaryVault.acceptRequests(mozaicLpPerStablecoin) accept deposit and withdraw requests

- Accept deposit request by giving mLP as mozaicLpPerStablecoin rate.
- Accept withdraw request by burning the mLP and giving the stablecoin as mozaicLpPerStablecoin rate.

----
And thus
The requests are accepted. And the users mLP amount gets updated.

# At every moment, User state is composed of

- pending deposit requests (amount in USDC, USDT, ...)
- pending withdraw requests (amount in mLP)
- staged deposit requests (amount in USDC, USDT, ...)
- staged withdraw requests (amount in mLP)
- owned amount in mLP (=mLP balance)
- the owned mLP assessed as stablecoin (USDC)
