// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// imports
import "@layerzerolabs/solidity-examples/contracts/token/oft/OFT.sol";

contract MozaicLP is OFT {
    address public vault;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) OFT(_name, _symbol, _lzEndpoint) {
    }

    modifier onlyVault() {
        require(vault == _msgSender(), "OnlyVault: caller is not the vault");
        _;
    }

    function setVault(address _vault) public onlyOwner {
        vault = _vault;
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

    function _checkVault() internal view virtual {
        require(vault == _msgSender(), "OnlyVault: caller is not the vault");
    }
}
