// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "./ProtocolDriver.sol";
import "./MozaicLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract MozaicVault is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    //--------------------------------------------------------------------------
    // EVENTS
    event UnexpectedLzMessage(uint16 packetType, bytes payload);

    event DepositRequestAdded (
        address indexed depositor,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountLD
    );

    event WithdrawRequestAdded (
        address indexed withdrawer,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountMLP
    );

    //--------------------------------------------------------------------------
    // CONSTANTS
    uint16 public constant STG_DRIVER_ID = 1;
    uint16 public constant PANCAKE_DRIVER_ID = 2;
    uint8 public constant MOZAIC_DECIMALS = 6;    // set to shared decimals

    bytes4 public constant SELECTOR_CONVERTSDTOLD = 0xdef46aa8;
    bytes4 public constant SELECTOR_CONVERTLDTOSD = 0xb53cf239;
    
    //---------------------------------------------------------------------------
    // STRUCTS
    struct Action {
        uint256 driverId;
        ProtocolDriver.ActionType actionType;
        bytes payload;
    }

    struct DepositRequest {
        address user;
        address token;
        uint16 chainId; // chain to receive mLP
    }

    struct WithdrawRequest {
        address user;
        uint16 chainId; // chain to receive stablecoin
        address token; // stablecoin token address
    }

    struct RequestBuffer {
        // deposit
        mapping (address => mapping (address => mapping (uint16 => uint256))) depositRequestLookup; // [user][token][chainId] = amountSD
        DepositRequest[] depositRequestList;
        mapping (address => uint256) depositAmountPerToken; // [token] = amountLD
        uint256 totalDepositAmount;
        // withdraw
        mapping (address => mapping (uint16 => mapping (address => uint256))) withdrawRequestLookup; // [user][chainId][token] = amountMLP
        WithdrawRequest[] withdrawRequestList;
        mapping (address => uint256) withdrawAmountPerUser; // [user] = amountMLP
        mapping (address => uint256) withdrawAmountPerToken; // [token] = amountMLP
        uint256 totalWithdrawAmount;
    }

    struct Snapshot {
        uint256 depositRequestAmount;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    mapping (uint256=>ProtocolDriver) public protocolDrivers;
    address public stargateLpStaking;
    address public stargateToken;
    MozaicLP public mozaicLp;
    uint16 public chainId;
    address[] public acceptingTokens;
    mapping(address => bool) tokenMap;

    bool public bufferFlag = false; // false ==> Left=pending Right=staged; true ==> Left=staged Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;
    // uint16[] public chainIds;
    // mapping (uint16 => VaultDescriptor) public vaultLookup;
    uint256 public totalCoinMD;
    uint256 public totalMLP;
    address public coordinator;

    //---------------------------------------------------------------------------
    // MODIFIERS
    modifier onlyCoordinator() {
        require(msg.sender == address(coordinator), "Caller must be Coordinator.");
        _;
    }

    function _requests(bool staged) internal view returns (RequestBuffer storage) {
        return staged ? (bufferFlag ? rightBuffer : leftBuffer) : (bufferFlag ? leftBuffer : rightBuffer);
    }

    function getDepositAmount(bool _staged, address _user, address _token, uint16 _chainId) public view returns (uint256) {
        return _requests(_staged).depositRequestLookup[_user][_token][_chainId];
    }

    function getWithdrawAmount(bool _staged, address _user, uint16 _chainId, address _token) public view returns (uint256) {
        return _requests(_staged).withdrawRequestLookup[_user][_chainId][_token];
    }

    function getDepositRequest(bool _staged, uint256 _index) public view returns (DepositRequest memory) {
        return _requests(_staged).depositRequestList[_index];
    }

    function getWithdrawRequest(bool _staged, uint256 _index) public view returns (WithdrawRequest memory) {
        return _requests(_staged).withdrawRequestList[_index];
    }

    function getTotalDepositAmount(bool _staged) public view returns (uint256) {
        return _requests(_staged).totalDepositAmount;
    }

    function getTotalWithdrawAmount(bool _staged) public view returns (uint256) {
        return _requests(_staged).totalWithdrawAmount;
    }

    function getDepositRequestListLength(bool _staged) public view returns (uint256) {
        return _requests(_staged).depositRequestList.length;
    }

    function getWithdrawRequestListLength(bool _staged) public view returns (uint256) {
        return _requests(_staged).withdrawRequestList.length;
    }

    function getDepositAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        return _requests(_staged).depositAmountPerToken[_token];
    }

    function getWithdrawAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        return _requests(_staged).withdrawAmountPerToken[_token];
    }

    function convertLDtoMD(address _token, uint256 _amountLD) public view returns (uint256) {
        uint8 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountLD.mul(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountLD.div(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function convertMDtoLD(address _token, uint256 _amountMD) public view returns (uint256) {
        uint8 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountMD.div(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountMD.mul(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function amountMDtoMLP(uint256 _amountMD) public view returns (uint256) {
        if (totalCoinMD == 0) {
            return _amountMD;
        } else {
            return _amountMD.mul(totalMLP).div(totalCoinMD);
        }
    }

    function amountMLPtoMD(uint256 _amountMLP) public view returns (uint256) {
        if (totalMLP == 0) {
            return _amountMLP;
        } else {
            return _amountMLP.mul(totalCoinMD).div(totalMLP);
        }
    }

    function isAcceptingToken(address _token) public view returns (bool) {
        return tokenMap[_token];
    }

    // Use this function to receive an amount of native token equals to msg.value from msg.sender
    receive () external payable {}

    // Use this function to return balance to msg.sender
    function returnBalance() public onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) {
            return;
        }
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Return balance failed");
    }

    //---------------------------------------------------------------------------
    // Constructor and Public Functions
    constructor(
        uint16 _chainId,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp,
        address _coordinator
    ) {
        chainId = _chainId;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
        mozaicLp = MozaicLP(_mozaicLp);
        coordinator = _coordinator;
    }

    function setProtocolDriver(uint256 _driverId, ProtocolDriver _driver, bytes calldata _config) external onlyOwner {
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(success, "set driver failed");
    }

    function addToken(address _token) external onlyOwner {
        if (tokenMap[_token] == false) {
            tokenMap[_token] = true;
            acceptingTokens.push(_token);
        }
    }

    function removeToken(address _token) external onlyOwner {
        if (tokenMap[_token] == true) {
            tokenMap[_token] = false;
            for (uint i; i < acceptingTokens.length; ++i) {
                if (acceptingTokens[i] == _token) {
                    acceptingTokens[i] = acceptingTokens[acceptingTokens.length - 1];
                    acceptingTokens.pop();
                    return;
                }
            }
        }
    }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        for (uint i; i < _actions.length ; ++i) {
            Action calldata _action = _actions[i];
            ProtocolDriver _driver = protocolDrivers[_action.driverId];
            (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
            require(success, "delegatecall failed");
        }
    }

    function addDepositRequest(uint256 _amountLD, address _token, uint16 _chainId) external {
        require(_chainId == chainId, "only onchain mint in PoC");
        require(isAcceptingToken(_token), "should be accepting token");

        address _depositor = msg.sender;
        // Minimum unit of acceptance 1 USD - to easy the following staking
        // uint256 _amountLDAccept = _amountLD.div(IERC20Metadata(_token).decimals()).mul(IERC20Metadata(_token).decimals());
        uint256 _amountLDAccept = _amountLD;

        // transfer stablecoin from depositor to this vault
        _safeTransferFrom(_token, _depositor, address(this), _amountLDAccept);

        // add deposit request to pending buffer
        RequestBuffer storage _pendingBuffer = _requests(false);
        bool exists = false;
        for (uint i; i < _pendingBuffer.depositRequestList.length; ++i) {
            DepositRequest storage _req = _pendingBuffer.depositRequestList[i];
            if (_req.user == _depositor && _req.token == _token) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            DepositRequest memory _req;
            _req.user = _depositor;
            _req.token = _token;
            _req.chainId = _chainId;
            _pendingBuffer.depositRequestList.push(_req);
        }
        uint256 _amountMD = convertLDtoMD(_token, _amountLDAccept);
        _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId] = _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId].add(_amountMD);
        _pendingBuffer.totalDepositAmount = _pendingBuffer.totalDepositAmount.add(_amountMD);
        _pendingBuffer.depositAmountPerToken[_token] = _pendingBuffer.depositAmountPerToken[_token].add(_amountMD);

        emit DepositRequestAdded(_depositor, _token, _chainId, _amountMD);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) external {
        require(_chainId == chainId, "withdraw onchain on PoC");
        require(isAcceptingToken(_token), "should be accepting token");

        address _withdrawer = msg.sender;
        RequestBuffer storage _pendingBuffer = _requests(false);
        RequestBuffer storage _stagedBuffer = _requests(true);

        // check amount MLP user has, if not enough, revert
        uint256 _bookedAmountMLP = _pendingBuffer.withdrawAmountPerUser[_withdrawer] + _stagedBuffer.withdrawAmountPerUser[_withdrawer];
        require(_amountMLP.add(_bookedAmountMLP) <= mozaicLp.balanceOf(_withdrawer), "Withdraw amount > owned mLP");

        // add new withdraw amount to pending buffer
        _pendingBuffer.withdrawAmountPerUser[_withdrawer] = _pendingBuffer.withdrawAmountPerUser[_withdrawer].add(_amountMLP);

        // add withdraw request to pending buffer
        bool _exists = false;
        for (uint i; i < _pendingBuffer.withdrawRequestList.length; ++i) {
            WithdrawRequest storage _req = _pendingBuffer.withdrawRequestList[i];
            if (_req.user == _withdrawer && _req.token == _token && _req.chainId == _chainId) {
                _exists = true;
                break;
            }
        }
        if (!_exists) {
            WithdrawRequest memory _req;
            _req.user = _withdrawer;
            _req.token = _token;
            _req.chainId = _chainId;
            _pendingBuffer.withdrawRequestList.push(_req);
        }

        _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token] = _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token].add(_amountMLP);
        _pendingBuffer.totalWithdrawAmount = _pendingBuffer.totalWithdrawAmount.add(_amountMLP);
        _pendingBuffer.withdrawAmountPerToken[_token] = _pendingBuffer.withdrawAmountPerToken[_token].add(_amountMLP);

        emit WithdrawRequestAdded(_withdrawer, _token, _chainId, _amountMLP);
    }

    function takeSnapshot() external onlyCoordinator returns (Snapshot memory snapshot) {
        require(_requests(true).totalDepositAmount==0, "Still processing requests");
        require(_requests(true).totalWithdrawAmount==0, "Still processing requests");

        // Stage Requests: Pending --> Processing
        bufferFlag = !bufferFlag;

        // Get total assets as MD
        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        ProtocolDriver.ActionType _actionType = ProtocolDriver.ActionType.GetTotalAssetsMD;
        bytes memory _payload = abi.encode(acceptingTokens);
        (bool success, bytes memory response) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_actionType), _payload));
        require(success, "get assets failed");
        (uint256 _totalStablecoinMD) = abi.decode(abi.decode(response, (bytes)), (uint256));

        // TODO: Protocol-Specific Logic. Move to StargateDriver
        snapshot.totalStargate = IERC20(stargateToken).balanceOf(address(this));

        // Right now we don't consider that the vault keep stablecoin as staked asset before the session.
        snapshot.totalStablecoin = _totalStablecoinMD.sub(_requests(true).totalDepositAmount);
        snapshot.depositRequestAmount = _requests(true).totalDepositAmount;
        snapshot.withdrawRequestAmountMLP = _requests(true).totalWithdrawAmount;
        snapshot.totalMozaicLp = mozaicLp.totalSupply();
    }

    function settleRequests(uint256 _totalCoinMD, uint256 _totalMLP) external onlyCoordinator {
        // for all deposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        totalCoinMD = _totalCoinMD;
        totalMLP = _totalMLP;
        RequestBuffer storage _reqs = _requests(true);
        for (uint i; i < _reqs.depositRequestList.length; ++i) {
            DepositRequest storage request = _reqs.depositRequestList[i];
            uint256 _depositAmountMD = _reqs.depositRequestLookup[request.user][request.token][request.chainId];
            if (_depositAmountMD == 0) {
                continue;
            }
            uint256 _amountMLPToMint = amountMDtoMLP(_depositAmountMD);
            mozaicLp.mint(request.user, _amountMLPToMint);
            // Reduce Handled Amount from Buffer
            _reqs.totalDepositAmount = _reqs.totalDepositAmount.sub(_depositAmountMD);
            _reqs.depositAmountPerToken[request.token] = _reqs.depositAmountPerToken[request.token].sub(_depositAmountMD);
            _reqs.depositRequestLookup[request.user][request.token][request.chainId] = _reqs.depositRequestLookup[request.user][request.token][request.chainId].sub(_depositAmountMD);
        }
        require(_reqs.totalDepositAmount == 0, "Has unsettled deposit amount.");

        // for all withdraw requests, give tokens
        for (uint i; i < _reqs.withdrawRequestList.length; ++i) {
            WithdrawRequest storage request = _reqs.withdrawRequestList[i];
            uint256 _withdrawAmountMLP = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token];
            if (_withdrawAmountMLP == 0) {
                continue;
            }
            uint256 _coinAmountMDtoGive = amountMLPtoMD(_withdrawAmountMLP);
            uint256 _coinAmountLDtoGive = convertMDtoLD(request.token, _coinAmountMDtoGive);
            uint256 _vaultBalanceLD = IERC20(request.token).balanceOf(address(this));
            uint256 _mlpToBurn = _withdrawAmountMLP;
            if (_vaultBalanceLD < _coinAmountLDtoGive) {
                // The vault does not have enough balance. Only give as much as it has.
                _mlpToBurn = _withdrawAmountMLP.mul(_vaultBalanceLD).div(_coinAmountLDtoGive);
                _coinAmountLDtoGive = _vaultBalanceLD;
            }
            mozaicLp.burn(request.user, _mlpToBurn);
            _safeTransfer(request.user, request.token, _coinAmountLDtoGive);
            // Reduce Handled Amount from Buffer
            _reqs.totalWithdrawAmount = _reqs.totalWithdrawAmount.sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerToken[request.token] = _reqs.withdrawAmountPerToken[request.token].sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerUser[request.user] = _reqs.withdrawAmountPerUser[request.user].sub(_withdrawAmountMLP);
            _reqs.withdrawRequestLookup[request.user][request.chainId][request.token] = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token].sub(_withdrawAmountMLP);
            
        }
        require(_reqs.totalWithdrawAmount == 0, "Has unsettled withdrawal amount.");
    }

    function registerVaults(uint16[] calldata _chainIds, address[] calldata _addrs) external onlyOwner {
        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("registerVaults(uint16[],address[])", _chainIds, _addrs));
        require(success, "register vault failed");

    }

    //---------------------------------------------------------------------------
    // INTERNAL
    function _safeTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _value
    ) internal {
        IERC20(_token).transferFrom(_from, _to, _value);
    }

    function _safeTransfer(address _user, address _token, uint256 _amountLD) internal {
        IERC20(_token).transfer(_user, _amountLD);
    }
}