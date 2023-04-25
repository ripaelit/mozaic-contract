// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./MozaicVault.sol";
import "@layerzerolabs/solidity-examples/contracts/lzApp/NonblockingLzApp.sol";

contract MozaicBridge is NonblockingLzApp {
	/********************************************/
	/**************** CONSTANTS *****************/
	/********************************************/
    uint16 internal constant PT_TAKE_SNAPSHOT = 11;
    uint16 internal constant PT_SNAPSHOT_REPORT = 12;
    uint16 internal constant PT_PRE_SETTLE = 13;
    uint16 internal constant PT_SETTLED_REPORT = 14;

	/********************************************/
	/**************** VARIABLES *****************/
	/********************************************/
    MozaicVault public vault;

	/********************************************/
	/***************** STRUCTS ******************/
	/********************************************/
    struct LzTxObj {
        uint256 dstGasForCall;
        uint256 dstNativeAmount;
        bytes dstNativeAddr;
    }


	/********************************************/
	/***************** EVENTS *******************/
	/********************************************/
    event UnexpectedLzMessage(uint16 packetType, bytes payload);

	/********************************************/
	/**************** MODIFIERS *****************/
	/********************************************/
    modifier onlyVault() {
        require(msg.sender == address(vault), "Only vault");
        _;
    }

	/********************************************/
	/*************** CONSTRUCTOR ****************/
	/********************************************/
    constructor(address _lzEndpoint) NonblockingLzApp(_lzEndpoint) {
    }

	/********************************************/
	/*********** EXTERNAL FUNCTIONS *************/
	/********************************************/
    // Functions for configuration
    function setVault(address payable _vault) external onlyOwner {
        require(_vault != address(0x0), "Vault cannot be zero address");
        vault = MozaicVault(_vault);
    }

    // Functions for vault
    function requestSnapshot(uint16 _dstChainId) external payable onlyVault {
        bytes memory lzPayload = abi.encode(PT_TAKE_SNAPSHOT);
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_TAKE_SNAPSHOT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, msg.value);
    }

    function reportSnapshot(
        uint16 _dstChainId,
        MozaicVault.Snapshot memory snapshot
    ) external payable onlyVault {
        bytes memory lzPayload = abi.encode(PT_SNAPSHOT_REPORT, snapshot);
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SNAPSHOT_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, msg.value);
    }

    function requestPreSettle(
        uint16 _dstChainId,
        uint256 _totalCoinMD,
        uint256 _totalMLP
    ) external payable onlyVault {
        bytes memory lzPayload = abi.encode(PT_PRE_SETTLE, _totalCoinMD, _totalMLP);
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_PRE_SETTLE, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, msg.value);
    }

    function reportSettled(uint16 _dstChainId) external payable onlyVault {
        bytes memory lzPayload = abi.encode(PT_SETTLED_REPORT);
        bytes memory _adapterParams = _txParamBuilder(_dstChainId, PT_SETTLED_REPORT, LzTxObj(0, 0, "0x"));
        _lzSend(_dstChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, msg.value);
    }

	/********************************************/
	/************ PUBLIC FUNCTIONS **************/
	/********************************************/
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

	/********************************************/
	/*********** INTERNAL FUNCTIONS *************/
	/********************************************/
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
        uint256 totalGas = minDstGasLookup[_chainId][_packetType] + _lzTxParams.dstGasForCall;
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
            vault.takeAndReportSnapshot();
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
