// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "@layerzerolabs/solidity-examples/contracts/token/oft/OFT.sol";

contract MozaicLP is OFT {

    address public _vault;
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) OFT(_name, _symbol, _lzEndpoint) {
    }

    modifier onlyVault() {
        require(_vault == _msgSender(), "OnlyVault: caller is not the vault");
        _;
    }

    function _checkVault() internal view virtual {
        require(_vault == _msgSender(), "OnlyVault: caller is not the vault");
    }

    function setVault(address _vault__) public onlyOwner {
        _vault = _vault__;
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    function mint(address _account, uint256 _amount) public onlyVault {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) public onlyVault {
        _burn(_account, _amount);
    }
}
