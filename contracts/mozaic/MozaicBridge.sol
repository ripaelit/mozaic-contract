// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "./MozaicVault.sol";

contract MozaicBridge is NonblockingLzApp {
    using SafeMath for uint256;

    //---------------------------------------------------------------------------
    // CONSTANTS
    uint16 internal constant PT_TAKE_SNAPSHOT = 1;
    uint16 internal constant PT_SNAPSHOT_REPORT = 2;
    uint16 internal constant PT_PRE_SETTLE = 3;
    uint16 internal constant PT_SETTLED_REPORT = 4;

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
    MozaicVault public vault;

    //---------------------------------------------------------------------------
    // MODIFIERS
    modifier onlyVault() {
        require(msg.sender == address(vault), "Only vault");
        _;
    }

    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint
    ) NonblockingLzApp(_lzEndpoint) {
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

    //---------------------------------------------------------------------------
    // Functions for configuration
    function setVault(address payable _vault) external onlyOwner {
        require(_vault != address(0x0), "Vault cannot be 0x0");
        vault = MozaicVault(_vault);
    }

    //---------------------------------------------------------------------------
    // Functions for vault
    function requestSnapshot(uint16 _dstChainId) external onlyVault {
        bytes memory lzPayload = abi.encode(PT_TAKE_SNAPSHOT);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function reportSnapshot(uint16 _dstChainId, MozaicVault.Snapshot memory snapshot) external onlyVault {
        bytes memory lzPayload = abi.encode(PT_SNAPSHOT_REPORT, snapshot);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_SNAPSHOT_REPORT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SNAPSHOT_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function requestPreSettle(uint16 _dstChainId, uint256 _totalCoinMD, uint256 _totalMLP) external onlyVault {
        bytes memory lzPayload = abi.encode(PT_PRE_SETTLE, _totalCoinMD, _totalMLP);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_PRE_SETTLE, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_PRE_SETTLE, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function reportSettled(uint16 _dstChainId) external onlyVault {
        bytes memory lzPayload = abi.encode(PT_SETTLED_REPORT);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(_dstChainId, PT_SETTLED_REPORT, LzTxObj(0, 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SETTLED_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    //---------------------------------------------------------------------------
    // INTERNAL
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
            vault.takeSnapshot();
        } 
        else if (packetType == PT_SNAPSHOT_REPORT) {
            (, MozaicVault.Snapshot memory snapshot) = abi.decode(_payload, (uint16, MozaicVault.Snapshot));
            vault.receiveSnapshotReport(snapshot, _srcChainId);
        } 
        else if (packetType == PT_PRE_SETTLE) {
            (, uint256 _totalCoinMD, uint256 _totalMLP) = abi.decode(_payload, (uint16, uint256, uint256));
            vault.preSettle(_totalCoinMD, _totalMLP);
        } 
        else if (packetType == PT_SETTLED_REPORT) {
            vault.receiveSettledReport(_srcChainId);
        } 
        else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
}
