
pragma solidity ^0.8.0;

// imports
import "../interfaces/IOFT.sol";
import "../libraries/oft/OFTCore.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract MozaicLP is Ownable, OFTCore, ERC20, IOFT {

    address private _vault;
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint
    ) ERC20(_name, _symbol) OFTCore(_lzEndpoint) {
    }

    modifier onlyVault() {
        _checkVault();
        _;
    }

    function vault() public view virtual returns (address) {
        return _vault;
    }

    function _checkVault() internal view virtual {
        require(vault() == _msgSender(), "OnlyVault: caller is not the vault");
    }

    function setVault(address _vault__) public onlyOwner {
        _vault = _vault__;
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
        return totalSupply();
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
            _burn(_from, _amount);
        }
        return _amount;
    }

    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal virtual override returns (uint256) {
        {
            _mint(_toAddress, _amount);
        }
        return _amount;
    }

    function mint(address _account, uint256 _amount) public onlyVault {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) public onlyVault {
        _burn(_account, _amount);
    }
}
