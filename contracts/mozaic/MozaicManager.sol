pragma solidity ^0.8.9;

import "../libraries/lzApp/NonblockingLzApp.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

import "./ProtocolDriver.sol";

contract MozaicManager is NonblockingLzApp {
    using SafeMath for uint256;

//--------------------------------------------------------------------------
    // CONSTANTS
    uint16 public constant PT_REPORTSNAPSHOT = 10001;
    uint16 public constant PT_SETTLE_REQUESTS = 10002;
    uint16 public constant PT_SETTLED_REQUESTS = 10003;

    uint16 public constant STG_DRIVER_ID = 1;
    uint16 public constant PANCAKE_DRIVER_ID = 2;

    enum VaultStatus {
        // No staged requests. Neutral status.
        IDLE,

        // (Primary Vault vision) Primary Vault thinks Secondary Vault is snapshotting. But haven't got report yet.
        SNAPSHOTTING,

        // (Secondary Vault vision) Secondary Vault knows it staged requests and made snapshot. It sent snapshot report, but doesn't care the rest.
        // (Primary Vault vision) Primary Vault got snapshot report from the Secondary Vault.
        SNAPSHOTTED,

        // (Primary Vault vision) Primary Vault sent "settle" message to Secondary Vault. Thinks it is settling requests now.
        SETTLING
    }

    enum ProtocolStatus {
        IDLE,
        OPTIMIZING
    }

    //---------------------------------------------------------------------------
    // STRUCTS
    struct Action {
        uint16 driverId;
        ProtocolDriver.ActionType actionType;
        bytes payload;
    }

    struct VaultInfo {
        address vaultAddress;
        VaultStatus vaultStatus;
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
    uint16[] public protocolDriverIds;
    mapping (uint16 => ProtocolDriver) public protocolDrivers;
    uint16[] public chainIds;
    mapping(uint16 => VaultInfo) public vaultInfos;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    ProtocolStatus public protocolStatus;
    uint16 public chainId;
    uint256 public mozaicLpPerStablecoinMil = 0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL = 1000000;

    //---------------------------------------------------------------------------
    // Constructor and Public Functions
    constructor(
        address _lzEndpoint
    ) NonblockingLzApp(_lzEndpoint) {
        protocolStatus = ProtocolStatus.IDLE;
    }

    function setProtocolDriver(uint16 _driverId, ProtocolDriver _driver, bytes calldata _config) external onlyOwner {
        bool isNew = true;
        for (uint i = 0; i < protocolDriverIds.length; ++i) {
            if (protocolDriverIds[i] == _driverId) {
                isNew = false;
                break;
            }
        }
        if (isNew) {
            protocolDriverIds.push(_driverId);
        }
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool _success, ) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(_success, "Failed to delegate");
    }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        for (uint i = 0; i < _actions.length ; i++) {
            Action calldata _action = _actions[i];
            ProtocolDriver _driver = protocolDrivers[_action.driverId];
            (bool success, bytes memory response) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", _action.actionType, _action.payload));
            (string memory errorMessage) = abi.decode(response, (string));
            require(success, errorMessage);
        }
    }

    function registerVault(uint16 _chainId, address _vaultAddress) external onlyOwner {
        bool isNew = true;
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (chainIds[i] == _chainId) {
                isNew = false;
                break;
            }
        }
        if (isNew) {
            chainIds.push(_chainId);
        } 
        vaultInfos[_chainId] = VaultInfo(_vaultAddress, VaultStatus.IDLE);

        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("registerVault(uint16,address)", _chainId, _vaultAddress));
        require(success, "Failed to register vault");

    }

    function getVaultsCount() external view returns (uint256) {
        return chainIds.length;
    }

    // Primary
    function initOptimizationSession() external onlyOwner {
        require(protocolStatus == ProtocolStatus.IDLE, "idle before optimizing");
        // reset
        mozaicLpPerStablecoinMil = 0;
        protocolStatus = ProtocolStatus.OPTIMIZING;
        for (uint i = 0; i < chainIds.length; i++) {
            vaultInfos[chainIds[i]].vaultStatus = VaultStatus.SNAPSHOTTING;
        }
    }

    function _acceptSnapshot(uint16 _srcChainId, Snapshot memory _newSnapshot) internal {
        require(vaultInfos[_srcChainId].vaultStatus == VaultStatus.SNAPSHOTTING, "Expect: prevStatus=SNAPSHOTTING");
        snapshotReported[_srcChainId] = _newSnapshot;
        vaultInfos[_srcChainId].vaultStatus = VaultStatus.SNAPSHOTTED;
        if (allVaultsSnapshotted()) {
            calculateMozLpPerStablecoinMil();
        }
    }

    function allVaultsSnapshotted() public view returns (bool) {
        for (uint i = 0; i < chainIds.length ; i++) {
            if (vaultInfos[chainIds[i]].vaultStatus != VaultStatus.SNAPSHOTTED) {
                return false;
            }
        }
        return true;
    }

    function calculateMozLpPerStablecoinMil() public {
        require(allVaultsSnapshotted(), "Some Snapshots not reached");
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinValue = 0;
        uint256 _mintedMozLp = 0;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i = 0; i < chainIds.length ; i++) {
            Snapshot memory report = snapshotReported[chainIds[i]];
            _totalStablecoinValue = _totalStablecoinValue.add(report.totalStablecoin + _stargatePriceMil.mul(report.totalStargate).div(1000000));
            _mintedMozLp = _mintedMozLp.add(report.totalMozaicLp);
        }
        if (_totalStablecoinValue > 0) {
            mozaicLpPerStablecoinMil = _mintedMozLp.mul(1000000).div(_totalStablecoinValue);
        }
        else {
            mozaicLpPerStablecoinMil = INITIAL_MLP_PER_COIN_MIL;
        }
    }

    function _allVaultsSettled() internal view returns (bool) {
        for (uint i = 0; i < chainIds.length; i++) {
            if (vaultInfos[chainIds[i]].vaultStatus != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(allVaultsSnapshotted(), "Not all snapshotted yet");
        require(mozaicLpPerStablecoinMil != 0, "MozaicLP ratio not ready");
        
        for (uint256 i = 0; i < chainIds.length; i++) {
            vaultInfos[chainIds[i]].vaultStatus = VaultStatus.SETTLING;
            bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, mozaicLpPerStablecoinMil);
            _lzSend(chainIds[i], lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    function _getStargatePriceMil() internal returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        // KEVIN-TODO:
        return 1000000;
    }

    function _nonblockingLzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_REPORTSNAPSHOT) {   // For primary
            (, Snapshot memory _newSnapshot) = abi.decode(_payload, (uint16, Snapshot));
            _acceptSnapshot(_srcChainId, _newSnapshot);
        } else if (packetType == PT_SETTLED_REQUESTS) { // For primary
            vaultInfos[_srcChainId].vaultStatus = VaultStatus.IDLE;
            if (_allVaultsSettled()) {
                protocolStatus = ProtocolStatus.IDLE;
            }
        } else {
            emit MessageFailed(_srcChainId, _srcAddress, _nonce, _payload, "Invalid packetType");
        }
    }
}