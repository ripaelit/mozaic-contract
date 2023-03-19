// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "./SecondaryVault.sol";

contract PrimaryVault is SecondaryVault {
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
    ProtocolStatus public protocolStatus;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        uint16 _primaryChainId,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) SecondaryVault(_lzEndpoint, _chainId, _primaryChainId, _stargateLpStaking, _stargateToken, _mozaicLp) {
        protocolStatus = ProtocolStatus.IDLE;
    }

    function _allVaultsSnapshotted() internal view returns (bool) {
        for (uint i; i < chainIds.length ; ++i) {
            if (vaults[chainIds[i]].status != VaultStatus.SNAPSHOTTED) {
                return false;
            }
        }
        return true;
    }

    function _allVaultsSettled() internal view returns (bool) {
        for (uint i; i < chainIds.length ; ++i) {
            if (vaults[chainIds[i]].status != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function _calculateMozLpPerStablecoinMil() internal {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinMD;
        uint256 _mintedMozLp;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i; i < chainIds.length ; ++i) {
            Snapshot storage report = snapshotReported[chainIds[i]];
            _totalStablecoinMD = _totalStablecoinMD.add(report.totalStablecoin + _stargatePriceMil.mul(report.totalStargate).div(1000000));
            _mintedMozLp = _mintedMozLp.add(report.totalMozaicLp);
        }
        if (_totalStablecoinMD > 0) {
            mlpPerStablecoinMil = _mintedMozLp.mul(1000000).div(_totalStablecoinMD);
        }
        else {
            mlpPerStablecoinMil = INITIAL_MLP_PER_COIN_MIL;
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

    function quoteLayerZeroFee(
        uint16 _chainId,
        uint16 _packetType,
        SecondaryVault.LzTxObj memory _lzTxParams
    ) public view virtual override returns (uint256 _nativeFee, uint256 _zroFee) {
        bytes memory payload = "";
        if (_packetType == PT_TAKE_SNAPSHOT) {
            payload = abi.encode(PT_TAKE_SNAPSHOT);
        } else if (_packetType == PT_SETTLE_REQUESTS) {
            payload = abi.encode(PT_SETTLE_REQUESTS, mlpPerStablecoinMil);
        } else {
            // revert("Unknown packet type");
        }

        bytes memory _adapterParams = _txParamBuilder(_chainId, _packetType, _lzTxParams);
        return lzEndpoint.estimateFees(_chainId, address(this), payload, false, _adapterParams);
    }

    function initOptimizationSession() external onlyOwner {
        if (protocolStatus != ProtocolStatus.IDLE) {
            return;
        }
        
        // Start snapshotting
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            if (_chainId == primaryChainId) {
                _takeSnapshot();
                snapshotReported[_chainId] = snapshot;
                vaults[_chainId].status = VaultStatus.SNAPSHOTTED;
            } else {
                bytes memory lzPayload = abi.encode(PT_TAKE_SNAPSHOT);
                (uint256 _nativeFee, ) = quoteLayerZeroFee(_chainId, PT_TAKE_SNAPSHOT, LzTxObj((10**7), 0, "0x"));
                bytes memory _adapterParams = _txParamBuilder(_chainId, PT_TAKE_SNAPSHOT, LzTxObj((10**7), 0, "0x"));
                _lzSend(_chainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
            }
        }

        mlpPerStablecoinMil = 0;
        protocolStatus = ProtocolStatus.SNAPSHOTTING;
    }

    function settleRequestsAllVaults() external onlyOwner {
        if (protocolStatus != ProtocolStatus.OPTIMIZING) {
            return;
        }
        // require(_allVaultsSnapshotted(), "Requires all reports");
        // require(mlpPerStablecoinMil > 0, "mozaiclp price not ready");

        // Start settling
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            Snapshot storage report = snapshotReported[_chainId];
            if (report.depositRequestAmount == 0 && report.withdrawRequestAmountMLP == 0) {
                continue;
            }

            if (_chainId == primaryChainId) {
                _settleRequests();
                vaults[_chainId].status = VaultStatus.IDLE;
            } else {
                bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, mlpPerStablecoinMil);
                (uint256 _nativeFee, ) = quoteLayerZeroFee(_chainId, PT_SETTLE_REQUESTS, LzTxObj((10**7), 0, "0x"));
                bytes memory _adapterParams = _txParamBuilder(_chainId, PT_SETTLE_REQUESTS, LzTxObj((10**7), 0, "0x"));
                _lzSend(_chainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
            }
        }
        protocolStatus = ProtocolStatus.SETTLING;
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

        if (packetType == PT_SNAPSHOT_REPORT) {
            (, snapshotReported[_srcChainId]) = abi.decode(_payload, (uint16, Snapshot));
            vaults[_srcChainId].status = VaultStatus.SNAPSHOTTED;

            if (_allVaultsSnapshotted()) {
                _calculateMozLpPerStablecoinMil();
                protocolStatus = ProtocolStatus.OPTIMIZING;
            }

        } 
        else if (packetType == PT_SETTLED_REPORT) {
            vaults[_srcChainId].status = VaultStatus.IDLE;

            if (_allVaultsSettled()) {
                protocolStatus = ProtocolStatus.IDLE;
            }

        }
        else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
}
