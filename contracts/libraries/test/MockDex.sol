// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./MockToken.sol";
import "hardhat/console.sol";

contract MockDex {
    using SafeMath for uint256; 

    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
    ) {
    }

    function swap(address _srcToken, address _dstToken, uint256 _amountLD, uint256 minReturn, uint8 flag) public returns (bool, bytes memory) {
        require(_srcToken != _dstToken, "Cannot swap between the same token");
        console.log("MockDex.swap: msg.sender:", msg.sender);
        MockToken srcToken = MockToken(_srcToken);
        MockToken dstToken = MockToken(_dstToken);
        console.log("MockDex.swap 1");
        srcToken.transferFrom(msg.sender, address(this), _amountLD);
        // srcToken.transfer(address(this), _amountLD);
        console.log("MockDex.swap 2");
        uint256 amountDstToken = _amountLD;
        console.log("MockDex.swap 3");
        dstToken.mint(msg.sender, amountDstToken);
        console.log("MockDex.swap 4");
        return (true, "");
    }
}
