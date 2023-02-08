// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract ERC20Mock is ERC20, Ownable {
    using SafeMath for uint256;
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        // _mint(msg.sender, (1000000).mul(10**decimals_));
    }

    bool paused;

    function mint(address _to, uint256 _amount) public onlyOwner {
        _mint(_to, _amount);
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        // need to mock some failed transfer events
        require(!paused, "Failed transfer due to pause");

        return super.transfer(recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        // need to mock some failed transfer events
        require(!paused, "Failed transfer due to pause");
        return super.transferFrom(sender, recipient, amount);
    }

    function pauseTransfers(bool _paused) external {
        paused = _paused;
    }
}
