// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

import "./MozaicVault.sol";
import "./MozaicBridge.sol";

contract MozaicManager is Ownable {
    using SafeMath for uint256;

    //--------------------------------------------------------------------------
    // ENUMS
    enum ProtocolStatus {
        IDLE,
        SNAPSHOTTING,
        OPTIMIZING,
        SETTLING
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    MozaicBridge public bridge;
    MozaicVault public vault;
    uint16 public chainId;
    uint16[] public chainIds;
    uint16 public mainChainId;
    ProtocolStatus public protocolStatus;
    mapping (uint16 => IMozaic.Snapshot) public snapshotReported; // chainId -> Snapshot
    uint256 public numWaiting;
    uint256 public totalCoinMD;
    uint256 public totalMLP;
    bool public settleAllowed;

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

    function setBridgeAndVault(address _bridge, address payable _vault) public onlyOwner {
        require(_bridge != address(0x0), "Bridge cant be 0x0");
        require(_vault != address(0x0), "Vault cant be 0x0");
        bridge = MozaicBridge(_bridge);
        vault = MozaicVault(_vault);
    }

    function _updateStats() internal {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        // totalMLP - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        totalCoinMD = 0;
        totalMLP = 0;
        for (uint i; i < chainIds.length ; ++i) {
            IMozaic.Snapshot storage report = snapshotReported[chainIds[i]];
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

    function initOptimizationSession() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.IDLE, "Protocol must be idle");
        
        numWaiting = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];

            if (_chainId == chainId) {
                snapshotReported[_chainId] = vault.takeSnapshot();
                --numWaiting;
            } else {
                bridge.takeSnapshot(_chainId);
            }
        }

        protocolStatus = ProtocolStatus.SNAPSHOTTING;
    }

    function preSettleAllVaults() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.OPTIMIZING, "Protocol must be optimizing");

        numWaiting = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            IMozaic.Snapshot storage report = snapshotReported[_chainId];

            if (report.depositRequestAmount == 0 && report.withdrawRequestAmountMLP == 0) {
                --numWaiting;
                continue;
            }

            if (_chainId == mainChainId) {
                settleAllowed = true;
            } else {
                bridge.preSettle(_chainId, totalCoinMD, totalMLP);
            }
        }

        if (numWaiting > 0) {
            protocolStatus = ProtocolStatus.SETTLING;
        }
        else {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    function acceptSnapshotReport(IMozaic.Snapshot memory snapshot, uint16 _srcChainId) external onlyBridge onlyMain {
        snapshotReported[_srcChainId] = snapshot;
        if (--numWaiting == 0) {
            _updateStats();
            protocolStatus = ProtocolStatus.OPTIMIZING;
        }
    }

    function acceptSettledReport(uint16 _srcChainId) external onlyBridge onlyMain {
        if (--numWaiting == 0) {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    // Control center calls this function periodically
    function settleRequests() external onlyOwner {
        if (settleAllowed == true) {
            vault.settleRequests(totalCoinMD, totalMLP);
            bridge.reportSettled(mainChainId);
            settleAllowed = false;
        }
    }

    function takeSnapshot() external onlyBridge {
        bridge.reportSnapshot(mainChainId, vault.takeSnapshot());
    }

    function preSettle(uint256 _totalCoinMD, uint256 _totalMLP) external onlyBridge {
        settleAllowed = true;
        totalCoinMD = _totalCoinMD;
        totalMLP = _totalMLP;
    }
}
