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
        console.log("MockDex.swap: this", address(this));
        MockToken srcToken = MockToken(_srcToken);
        MockToken dstToken = MockToken(_dstToken);
        console.log("SrcToken before msg.sender, mockDex", srcToken.balanceOf(msg.sender), srcToken.balanceOf(address(this)));
        srcToken.transferFrom(msg.sender, address(this), _amountLD);
        console.log("SrcToken after msg.sender, mockDex", srcToken.balanceOf(msg.sender), srcToken.balanceOf(address(this)));
        uint256 amountDstToken = _amountLD;
        console.log("DstToken before msg.sender, mockDex", dstToken.balanceOf(msg.sender), dstToken.balanceOf(address(this)));
        dstToken.mint(msg.sender, amountDstToken);
        console.log("DstToken after msg.sender, mockDex", dstToken.balanceOf(msg.sender), dstToken.balanceOf(address(this)));
        return (true, "");
    }
}
