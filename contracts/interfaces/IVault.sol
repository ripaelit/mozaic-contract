// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

interface IVault{
    struct Order {
        uint16 srcPoolId;
        uint16 dstChainId;
        uint16 dstPoolId;
        uint256 swapValue;
        uint256 burnValue;
        uint256 sellValue;
        uint256 mintValue;
        uint256 poolIndex;
        address to;
    }
    function executeOrders(Order[] memory orders) external payable ;
    function executeSync() external;
    function getTotalPendingInvests(uint16 _index) external view returns (uint256);
    function getTotalPendingHarvests(uint16 _index) external view returns (uint256);
    function onSyncResponse(uint16 _chainId) external payable;
    function syncVaults() external;
    function onSyncRequest() external payable;
    function requestSyncIndex() external returns(uint256);
    function responseSyncIndex() external returns(uint256);
    function totalStableCoin() external returns(uint256);
    function totalInmoz() external returns(uint256);
    function syncStatus() external returns(bool);
    function vaultStatus() external returns(bool);
}