// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IStargateLpStaking {

    function deposit(uint256 _pid, uint256 _amount) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    function balanceOf(address _owner) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function totalLiquidity() external view returns (uint256);

}
