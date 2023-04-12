// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "./MozaicVault.sol";

contract MozaicCoordinator is NonblockingLzApp {
    using SafeMath for uint256;

    //---------------------------------------------------------------------------
    // CONSTANTS
    uint16 internal constant PT_TAKE_SNAPSHOT = 1;
    uint16 internal constant PT_SNAPSHOT_REPORT = 2;
    uint16 internal constant PT_PRE_SETTLE = 3;
    uint16 internal constant PT_SETTLED_REPORT = 4;

    //--------------------------------------------------------------------------
    // ENUMS
    enum ProtocolStatus {
        IDLE,
        SNAPSHOTTING,
        OPTIMIZING,
        SETTLING
    }

    //--------------------------------------------------------------------------
    // EVENTS
    event UnexpectedLzMessage(uint16 packetType, bytes payload);

    //---------------------------------------------------------------------------
    // STRUCTS
    struct LzTxObj {
        uint256 dstGasForCall;
        uint256 dstNativeAmount;
        bytes dstNativeAddr;
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    ProtocolStatus public protocolStatus;
    MozaicVault public vault;
    uint16 public chainId;
    uint16 public mainChainId;
    uint16[] public chainIds;
    
    mapping (uint16 => MozaicVault.Snapshot) public snapshotReported; // chainId -> Snapshot
    uint256 public numLzPending;
    uint256 public totalCoinMD;
    uint256 public totalMLP;
    bool public settleAllowed;

    //---------------------------------------------------------------------------
    // MODIFIERS
    modifier onlyMain() {
        require(chainId == mainChainId, "Only main chain");
        _;
    }
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint
    ) NonblockingLzApp(_lzEndpoint) {
        protocolStatus = ProtocolStatus.IDLE;
    }

    function quoteLayerZeroFee(
        uint16 _chainId,
        uint16 _packetType,
        LzTxObj memory _lzTxParams
    ) public view returns (uint256 _nativeFee, uint256 _zroFee) {
        bytes memory payload = "";
        if (_packetType == PT_TAKE_SNAPSHOT) {
            payload = abi.encode(PT_TAKE_SNAPSHOT);
        } 
        else if (_packetType == PT_SNAPSHOT_REPORT) {
            payload = abi.encode(PT_SNAPSHOT_REPORT, MozaicVault.Snapshot(1, 1, 1, 1, 1));
        } 
        else if (_packetType == PT_PRE_SETTLE) {
            payload = abi.encode(PT_PRE_SETTLE, 1, 1);
        } 
        else if (_packetType == PT_SETTLED_REPORT) {
            payload = abi.encode(PT_SETTLED_REPORT);
        } 
        else {
            revert("Unknown packet type");
        }

        bytes memory _adapterParams = _txParamBuilder(_chainId, _packetType, _lzTxParams);
        return lzEndpoint.estimateFees(_chainId, address(this), payload, false, _adapterParams);
    }

    // Use this function to receive an amount of native token equals to msg.value from msg.sender
    receive () external payable {}

    //---------------------------------------------------------------------------
    // EXTERNAL for Control Center
    function setVault(address payable _vault) external onlyOwner {
        require(_vault != address(0x0), "Vault cannot be 0x0");
        vault = MozaicVault(_vault);
    }

    function setChainId(uint16 _chainId) external onlyOwner {
        require(_chainId > 0, "Invalid chainId");
        chainId = _chainId;
    }

    function setMainChainId(uint16 _mainChainId) external onlyOwner {
        require(_mainChainId > 0, "Invalid main chainId");
        mainChainId = _mainChainId;
    }

    function setChainIds(uint16[] memory _chainIds) external onlyOwner onlyMain {
        require(_chainIds.length > 0, "Empty chainIds");
        chainIds = _chainIds;
    }

    function initOptimizationSession() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.IDLE, "Protocol must be idle");
        require(address(vault) != address(0x0), "Zero address vault");
        
        numLzPending = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];

            if (_chainId == chainId) {
                snapshotReported[_chainId] = vault.takeSnapshot();
                --numLzPending;
            } 
            else {
                _requestSnapshot(_chainId);
            }
        }

        protocolStatus = ProtocolStatus.SNAPSHOTTING;
    }

    function preSettleAllVaults() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.OPTIMIZING, "Protocol must be optimizing");

        numLzPending = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            MozaicVault.Snapshot storage report = snapshotReported[_chainId];

            if (report.depositRequestAmount == 0 && report.withdrawRequestAmountMLP == 0) {
                --numLzPending;
                continue;
            }

            if (_chainId == mainChainId) {
                settleAllowed = true;
                --numLzPending;
            } 
            else {
                _requestPreSettle(_chainId, totalCoinMD, totalMLP);
            }
        }

        protocolStatus = ProtocolStatus.SETTLING;
    }

    function settleRequests() external onlyOwner {
        if (settleAllowed == true) {
            require(address(vault) != address(0x0), "Vault cannot be 0x0");
            vault.settleRequests(totalCoinMD, totalMLP);
            if (chainId != mainChainId) {
                _reportSettled(mainChainId);
            }
            settleAllowed = false;
        }
    }

    //---------------------------------------------------------------------------
    // INTERNAL
    function _requestSnapshot(uint16 _dstChainId) internal {
        bytes memory lzPayload = abi.encode(PT_TAKE_SNAPSHOT);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function _reportSnapshot(uint16 _dstChainId, MozaicVault.Snapshot memory snapshot) internal {
        bytes memory lzPayload = abi.encode(PT_SNAPSHOT_REPORT, snapshot);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_SNAPSHOT_REPORT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SNAPSHOT_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function _requestPreSettle(uint16 _dstChainId, uint256 _totalCoinMD, uint256 _totalMLP) internal {
        bytes memory lzPayload = abi.encode(PT_PRE_SETTLE, _totalCoinMD, _totalMLP);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_PRE_SETTLE, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_PRE_SETTLE, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function _reportSettled(uint16 _dstChainId) internal {
        bytes memory lzPayload = abi.encode(PT_SETTLED_REPORT);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_SETTLED_REPORT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SETTLED_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function _receiveSnapshotReport(MozaicVault.Snapshot memory snapshot, uint16 _srcChainId) internal {
        snapshotReported[_srcChainId] = snapshot;
        if (--numLzPending == 0) {
            _updateStats();
            protocolStatus = ProtocolStatus.OPTIMIZING;
        }
    }

    function _receiveSettledReport(uint16 _srcChainId) internal {
        if (--numLzPending == 0) {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    /**
    * NOTE: PoC: need to move to StargateDriver in next phase of development.
     */
    function _getStargatePriceMil() internal pure returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        // KEVIN-TODO:
        return 1000000;
    }

    function _updateStats() internal {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        // totalMLP - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        totalCoinMD = 0;
        totalMLP = 0;
        for (uint i; i < chainIds.length ; ++i) {
            MozaicVault.Snapshot storage report = snapshotReported[chainIds[i]];
            totalCoinMD = totalCoinMD.add(report.totalStablecoin + (report.totalStargate).mul(_stargatePriceMil).div(1000000));
            totalMLP = totalMLP.add(report.totalMozaicLp);
        }
    }

    function _txParamBuilderType1(uint256 _gasAmount) internal pure returns (bytes memory) {
        uint16 txType = 1;
        return abi.encodePacked(txType, _gasAmount);
    }

    function _txParamBuilderType2(
        uint256 _gasAmount,
        uint256 _dstNativeAmount,
        bytes memory _dstNativeAddr
    ) internal pure returns (bytes memory) {
        uint16 txType = 2;
        return abi.encodePacked(txType, _gasAmount, _dstNativeAmount, _dstNativeAddr);
    }

    function _txParamBuilder(
        uint16 _chainId,
        uint16 _packetType,
        LzTxObj memory _lzTxParams
    ) internal view returns (bytes memory) {
        bytes memory lzTxParam;
        address dstNativeAddr;
        {
            bytes memory dstNativeAddrBytes = _lzTxParams.dstNativeAddr;
            assembly {
                dstNativeAddr := mload(add(dstNativeAddrBytes, 20))
            }
        }

        uint256 totalGas = minDstGasLookup[_chainId][_packetType].add(_lzTxParams.dstGasForCall);
        if (_lzTxParams.dstNativeAmount > 0 && dstNativeAddr != address(0x0)) {
            lzTxParam = _txParamBuilderType2(totalGas, _lzTxParams.dstNativeAmount, _lzTxParams.dstNativeAddr);
        } else {
            lzTxParam = _txParamBuilderType1(totalGas);
        }

        return lzTxParam;
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId, 
        bytes memory _srcAddress, 
        uint64 _nonce, 
        bytes memory _payload
    ) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_TAKE_SNAPSHOT) {
            MozaicVault.Snapshot memory snapshot = vault.takeSnapshot();
            _reportSnapshot(mainChainId, snapshot);
        } 
        else if (packetType == PT_SNAPSHOT_REPORT) {
            (, MozaicVault.Snapshot memory snapshot) = abi.decode(_payload, (uint16, MozaicVault.Snapshot));
            _receiveSnapshotReport(snapshot, _srcChainId);
        } 
        else if (packetType == PT_PRE_SETTLE) {
            (, uint256 _totalCoinMD, uint256 _totalMLP) = abi.decode(_payload, (uint16, uint256, uint256));
            settleAllowed = true;
            totalCoinMD = _totalCoinMD;
            totalMLP = _totalMLP;
        } 
        else if (packetType == PT_SETTLED_REPORT) {
            _receiveSettledReport(_srcChainId);
        } 
        else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
}
