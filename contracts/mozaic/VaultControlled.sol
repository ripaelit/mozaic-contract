pragma solidity ^0.8.9;

abstract contract VaultControlled {
    address public vault;
    modifier onlyVault() {
        require(vault == msg.sender, "OnlyVault: caller is not vault");
        _;
    }
    constructor (address _vault) {
        vault = _vault;
    }
}