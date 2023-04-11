// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
// import "./MozaicVault.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MozaicVault.sol";

contract MozaicManager is Ownable {
    // using SafeMath for uint256;

    //---------------------------------------------------------------------------
    // CONSTANTS
    uint16 internal constant PT_TAKE_SNAPSHOT = 1;
    uint16 internal constant PT_SNAPSHOT_REPORT = 2;
    uint16 internal constant PT_SETTLE_REQUESTS = 3;
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

    struct Snapshot {
        uint256 depositRequestAmount;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    MozaicBridge public bridge;
    MozaicVault public vault;
    uint16 public chainId;
    uint16[] public chainIds;
    uint16 public mainChainId;
    ProtocolStatus public protocolStatus;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    uint8 public numWaiting;
    uint256 public totalCoinMD;
    uint256 public totalMLP;

    //---------------------------------------------------------------------------
    // MODIFIERS
    modifier onlyBridge() {
        require(msg.sender == address(bridge), "Caller must be Bridge.");
        _;
    }

    modifier onlyMain() {
        require(chainId == mainChainId, "Only main chain");
        _;
    }
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        uint16 _chainId,
        uint16 _mainChainId
    ) {
        chainId = _chainId;
        mainChainId = _mainChainId;
        protocolStatus = ProtocolStatus.IDLE;
    }

    function setBridgeAndVault(address _bridge, address _vault) public onlyOwner {
        require(address(_bridge) != address(0x0), "Bridge cant be 0x0");
        require(address(_vault) != address(0x0), "Vault cant be 0x0");
        bridge = MozaicBridge(_bridge);
        vault = MozaicVault(_vault);
    }

    function _updateStats() internal {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        // totalMLP - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        totalCoinMD = 0;
        totalMLP = 0;
        for (uint i; i < chainIds.length ; ++i) {
            Snapshot storage report = snapshotReported[chainIds[i]];
            totalCoinMD = totalCoinMD.add(report.totalStablecoin + (report.totalStargate).mul(_stargatePriceMil).div(1000000));
            totalMLP = totalMLP.add(report.totalMozaicLp);
        }
    }
   
    //---------------------------------------------------------------------------
    // INTERNAL

    /**
    * NOTE: PoC: need to move to StargateDriver in next phase of development.
     */
    function _getStargatePriceMil() internal pure returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        // KEVIN-TODO:
        return 1000000;
    }

    function takeSnapshot() external onlyBridge returns (Snapshot memory snapshot) {
        return vault.takeSnapshot();
    }

    function preSettle(uint256 _totalCoinMD, uint256 _totalMLP) external onlyBridge {
        settleAllowed = true;
        vault.preSettle(_totalCoinMD, _totalMLP);
    }

    function initOptimizationSession() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.IDLE, "Protocol must be idle");
        
        numWaiting = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];

            if (_chainId == chainId) {
                snapshotReported[_chainId] = vault.takeSnapshot();
                --numWaiting;
            } else {
                bytes memory lzPayload = abi.encode(PT_TAKE_SNAPSHOT);
                (uint256 _nativeFee, ) = quoteLayerZeroFee(_chainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
                bytes memory _adapterParams = _txParamBuilder(_chainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
                _lzSend(_chainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
            }
        }

        protocolStatus = ProtocolStatus.SNAPSHOTTING;
    }

    function preSettleAllVaults() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.OPTIMIZING, "Protocol must be optimizing");

        numWaiting = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            Snapshot storage report = snapshotReported[_chainId];

            if (report.depositRequestAmount == 0 && report.withdrawRequestAmountMLP == 0) {
                --numWaiting;
                continue;
            }

            if (_chainId == mainChainId) {
                vault.preSettle(totalCoinMD, totalMLP);
            } else {
                bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, totalCoinMD, totalMLP);
                (uint256 _nativeFee, ) = quoteLayerZeroFee(_chainId, PT_SETTLE_REQUESTS, LzTxObj(0, 0, "0x"));
                bytes memory _adapterParams = _txParamBuilder(_chainId, PT_SETTLE_REQUESTS, LzTxObj(0, 0, "0x"));
                _lzSend(_chainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
            }
        }

        if (numWaiting > 0) {
            protocolStatus = ProtocolStatus.SETTLING;
        }
        else {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    function settleRequests() external onlyOwner {
        if (settleAllowed == true) {
            vault.settleRequests();
            bridge.reportSettled();
            settleAllowd = false;
        }
    }

    function acceptSnapshotReport(Snapshot memory snapshot, uint256 _srcChainId) external onlyBridge onlyMain {
        snapshotReported[_srcChainId] = snapshot;
        if (--numWaiting == 0) {
            _updateStats();
            protocolStatus = ProtocolStatus.OPTIMIZING;
        }
    }

    function acceptSettledReport(uint256 _srcChainId) external onlyBridge onlyMain {
        if (--numWaiting == 0) {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    
    // function settleRequestsAllVaults() external onlyOwner {
    //     if (protocolStatus != ProtocolStatus.OPTIMIZING) {
    //         return;
    //     }

    //     numWaiting = chainIds.length;
    //     for (uint i; i < chainIds.length; ++i) {
    //         uint16 _chainId = chainIds[i];
    //         Snapshot storage report = snapshotReported[_chainId];

    //         if (report.depositRequestAmount == 0 && report.withdrawRequestAmountMLP == 0) {
    //             --numWaiting;
    //             continue;
    //         }

    //         if (_chainId == mainChainId) {
    //             vault.settleRequests();
    //             --numWaiting;
    //         } else {
    //             bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, totalCoinMD, totalMLP);
    //             (uint256 _nativeFee, ) = quoteLayerZeroFee(_chainId, PT_SETTLE_REQUESTS, LzTxObj(0, 0, "0x"));
    //             bytes memory _adapterParams = _txParamBuilder(_chainId, PT_SETTLE_REQUESTS, LzTxObj(0, 0, "0x"));
    //             _lzSend(_chainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    //         }
    //     }

    //     if (numWaiting > 0) {
    //         protocolStatus = ProtocolStatus.SETTLING;
    //     }
    //     else {
    //         protocolStatus = ProtocolStatus.IDLE;
    //     }
    // }
}
