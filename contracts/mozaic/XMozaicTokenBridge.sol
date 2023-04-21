// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@layerzerolabs/solidity-examples/contracts/token/oft/v2/BaseOFTV2.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./XMozaicToken.sol";

contract XMozaicTokenBridge is BaseOFTV2 {
    using SafeERC20 for IERC20;

    XMozaicToken internal immutable innerToken;
    uint internal immutable ld2sdRate;

    constructor(address _token, uint8 _sharedDecimals, address _lzEndpoint) BaseOFTV2(_sharedDecimals, _lzEndpoint) {
        innerToken = XMozaicToken(_token);

        (bool success, bytes memory data) = _token.staticcall(
            abi.encodeWithSignature("decimals()")
        );
        require(success, "Failed to get token decimals");
        uint8 _decimals = abi.decode(data, (uint8));

        require(_sharedDecimals <= _decimals, "SharedDecimals must be <= decimals");
        ld2sdRate = 10 ** (_decimals - _sharedDecimals);
    }

    /************************************************************************
    * public functions
    ************************************************************************/
    function circulatingSupply() public view virtual override returns (uint) {
        return innerToken.totalSupply();
    }

    function token() public view virtual override returns (address) {
        return address(innerToken);
    }

    /************************************************************************
    * internal functions
    ************************************************************************/
    function _debitFrom(address _from, uint16, bytes32, uint _amount) internal virtual override returns (uint) {
        require(_from == _msgSender(), "owner is not send caller");
        uint cap = _sd2ld(type(uint64).max);
        require(_amount <= cap, "amount overflow");

        innerToken.burn(_from, _amount);
        return _amount;
    }

    function _creditTo(uint16, address _toAddress, uint _amount) internal virtual override returns (uint) {
        innerToken.mint(_toAddress, _amount);
        return _amount;
    }

    function _transferFrom(address _from, address _to, uint _amount) internal virtual override returns (uint) {
        uint before = innerToken.balanceOf(_to);
        if (_from == address(this)) {
            IERC20(innerToken).safeTransfer(_to, _amount);
        } else {
            IERC20(innerToken).safeTransferFrom(_from, _to, _amount);
        }
        return innerToken.balanceOf(_to) - before;
    }

    function _ld2sdRate() internal view virtual override returns (uint) {
        return ld2sdRate;
    }
}
