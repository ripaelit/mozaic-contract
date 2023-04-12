// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

interface IMozaic {

    struct Snapshot {
        uint256 depositRequestAmount;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }
    
}