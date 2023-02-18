import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';

export const testnetTestConstants = {
    chainIds: [
        10121,  // Goerli (Ethereum Testnet)
        10102,  // BNB Chain (Testnet)
    ],
    stgRouter: "0x7612aE2a34E5A363E137De748801FB4c86499152",
    stgBridge: "0xE6612eB143e4B350d55aA2E229c80b15CA336413",
    stgMainChainId: 10121,
    USDC: "0xDf0360Ad8C5ccf25095Aa97ee5F2785c8d848620",
    USDT: "0x5BCc22abEC37337630C0E0dd41D64fd86CaeE951",
    // amountInitialSTG: BigNumber.from("4000000000000"),                // 4e12
    // amountSwapSTG: BigNumber.from("1000000000000"),                   // 1e12
    // amountUSDC: BigNumber.from("2000000000000"),         // 1e12
    pancakeSwapSmartRouter: "0xC6665d98Efd81f47B03801187eB46cbC63F328B0",
}