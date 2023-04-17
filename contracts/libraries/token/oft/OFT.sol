// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../../interfaces/IOFT.sol";
import "./OFTCore.sol";

// override decimal() function is needed
contract OFT is OFTCore, ERC20, IOFT {
    bool isMain = false;
    address mainAddress = address(0xbfD2135BFfbb0B5378b56643c2Df8a87552Bfa23); // This is primary Vault lz endpoint address. For now it is goerli testnet address
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint _initialSupply
    ) ERC20(_name, _symbol) OFTCore(_lzEndpoint) {
        if (_lzEndpoint == mainAddress) {
            _mint(_msgSender(), _initialSupply);
            isMain = true;
        }
    }
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(OFTCore, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IOFT).interfaceId ||
            interfaceId == type(IERC20).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function token() public view virtual override returns (address) {
        return address(this);
    }

    function circulatingSupply()
        public
        view
        virtual
        override
        returns (uint256)
    {
        if (isMain) {
            return totalSupply() - balanceOf(address(this));
        } else {
            return totalSupply();
        }
    }

    function _debitFrom(
        address _from,
        uint16,
        bytes memory,
        uint256 _amount
    ) internal virtual override returns (uint256) {
        address spender = _msgSender();
        if (_from != spender) _spendAllowance(_from, spender, _amount);
        {
            if (isMain) _transfer(_from, address(this), _amount);
            else _burn(_from, _amount);
        }
        return _amount;
    }

    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal virtual override returns (uint256) {
        {
            if (isMain) _transfer(address(this), _toAddress, _amount);
            else _mint(_toAddress, _amount);
        }
        return _amount;
    }
}
