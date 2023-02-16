pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract ProtocolDriver is Ownable {
    enum ActionType {
    // data types
        Swap,
        SwapRemote,
        GetPriceMil,
        StargateStake,
        StargateUnstake
    }
    function execute(ActionType _actionType, bytes calldata _payload) virtual public onlyOwner returns (bytes memory) {
    }
}