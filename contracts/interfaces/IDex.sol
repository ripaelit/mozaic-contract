// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

interface IDex {


    function stgToStablecoin(uint256 stgAmount) external;

    
    function getStablecoinAmount() external view returns(uint256);

    function getStgAmount() external view returns(uint256);
}