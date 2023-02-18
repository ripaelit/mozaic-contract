# Skip Now & Check Later

## PoC Attitude

Upto Now: We focused on speed to make the first deployment quickly and run with control center, proving technical feasibility and exposing technical risks.
We focus on speed.
We put less focus on perfectionism.
But we leave logs for future improvements that we skip now.

## Improvemental Points

### Coding Structure

- @types.ts : LzEndpointMock --> string

- Considering:
overall, avoid using contract types directly, instead use address type, and use typecase in test cases.

- "TestUtils" -> "DeployUtils"

### Business Logic

#### SecondaryVault should check if sourceChain, sourceAddress are of the PrimaryVault.
