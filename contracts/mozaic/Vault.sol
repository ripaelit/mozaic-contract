pragma solidity ^0.8.0;

// imports
import "../libraries/oft/OFT.sol";
import "./OrderTaker.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract Vault is OFT, OrderTaker {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint _initialSupply,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) OFT(_name, _symbol, _lzEndpoint, _initialSupply) OrderTaker(_chainId, _stargateRouter, _stargateLpStaking, _stargateToken) {

    }
}