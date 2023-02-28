# Skip Now & Check Later

## PoC Attitude

Upto Now: We focused on speed to make the first deployment quickly and run with control center, proving technical feasibility and exposing technical risks.
We focus on speed.
We put less focus on perfectionism.
But we leave logs for future improvements that we skip now.

We should stop implementing new changes. Make current stats work.
This is not the first deployment.

## Improvemental Points

### Coding Structure

- @types.ts : LzEndpointMock --> string

- Considering:
overall, avoid using contract types directly, instead use address type, and use typecase in test cases.

- "TestUtils" -> "DeployUtils"

### Business Logic

#### SecondaryVault should check if sourceChain, sourceAddress are of the PrimaryVault.

#### PoC treats all stable coins with same rate. Each stable coin should have price. The standard token = ?

#### Performance Fee Collection
...
#### Cancel Pending Request

#### Probably Issue New Token for Pending and Staged Assets?

#### Emergency Feature

Please add your ideas ...

#### Overflow Considerations

We cover divide by zero cases.
But we also need to pay attention to overflow cases.

#### Remove Dependency on specific Protocol (esp. Stargate, Layerzero)

- Currently the chainId used in Vaults are LayerZero chain id, instead of the chain id in chainlist.
- swapRemote action to StargateDriver contains destPoolId

#### Guard condition on removeToken

Make sure there's no asset left as that token.


