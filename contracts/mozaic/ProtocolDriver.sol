pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract ProtocolDriver is Ownable {
    enum ActionType {
    // data types
        Swap,
        SwapRemote,
        GetPriceMil,
        Stake,
        Unstake,
        GetStakedAmount
    }

    function configDriver(bytes calldata params) public virtual onlyOwner returns (bytes memory) {
    }

    function execute(ActionType _actionType, bytes calldata _payload) public virtual returns (bytes memory) {
    }
}