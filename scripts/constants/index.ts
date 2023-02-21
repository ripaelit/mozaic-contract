import {StargateChainPath} from './types';
// define constants and types

const localTestConstants = {
    chainIds: [
        101, // ETH
        102, // BSC
    ],
    mozaicMainChainId: 101,
    stgMainChainId: 101, // main chain ID of Stargate Token
    stablecoins: new Map<number, Array<string>>([
        [101, new Array<string>('USDC', 'USDT')],
        [102, new Array<string>('USDT', 'BUSD')],
    ]),
    poolIds: new Map<string, number>([
        ['USDC', 1],
        ['USDT', 2],
        ['BUSD', 5],
    ]),
    stargateChainPaths: new Array<StargateChainPath> (
        { // ETH.USDC => BSC.USDT
            sourceChainId: 101,
            sourcePoolId: 1,
            destinationChainId: 102,
            destinationPoolId: 2,
            weight: 1,
        },
        { // ETH.USDC => BSC.BUSD
            sourceChainId: 101,
            sourcePoolId: 1,
            destinationChainId: 102,
            destinationPoolId: 5,
            weight: 1,
        },
        { // ETH.USDT => BSC.USDT
            sourceChainId: 101,
            sourcePoolId: 2,
            destinationChainId: 102,
            destinationPoolId: 2,
            weight: 1,
        },
        { // ETH.USDT => BSC.BUSD
            sourceChainId: 101,
            sourcePoolId: 2,
            destinationChainId: 102,
            destinationPoolId: 5,
            weight: 1,
        },
        { // BSC.USDT => ETH.USDC
            sourceChainId: 102,
            sourcePoolId: 2,
            destinationChainId: 101,
            destinationPoolId: 1,
            weight: 1,
        },
        { // BSC.USDT => ETH.USDT
            sourceChainId: 102,
            sourcePoolId: 2,
            destinationChainId: 101,
            destinationPoolId: 2,
            weight: 1,
        },
        { // BSC.BUSD => ETH.USDC
            sourceChainId: 102,
            sourcePoolId: 5,
            destinationChainId: 101,
            destinationPoolId: 1,
            weight: 1,
        },
        { // BSC.BUSD => ETH.USDT
            sourceChainId: 102,
            sourcePoolId: 5,
            destinationChainId: 101,
            destinationPoolId: 2,
            weight: 1,
        },
    ),
    stargateDriverId:     1,
    pancakeSwapDriverId:  2,
};

const testnetTestConstants = {
    chainIds: [
        10121,  // Goerli(Ethereum Testnet)
        10102,  // BNB Chain(Testnet)
    ],
    stgMainChainId: 10121,  // BNB Chain(Testnet)
    mozaicMainChainId: 10121,
    routers: new Map<number, string>([
        [10121, "0x7612aE2a34E5A363E137De748801FB4c86499152"],
        [10102, "0xbB0f1be1E9CE9cB27EA5b0c3a85B7cc3381d8176"],
    ]),
    bridges: new Map<number, string>([
        [10121, "0xE6612eB143e4B350d55aA2E229c80b15CA336413"],
        [10102, "0xa1E105511416aEc3200CcE7069548cF332c6DCA2"],
    ]),
    factories: new Map<number, string>([
        [10121, "0xB30300c11FF54f8F674a9AA0777D8D5e9fefd652"],
        [10102, "0x407210a67cDAe7Aa09E4426109329cd3E90aFe47"],
    ]),
    stablecoins: new Map<number, Map<string, string>>([
        [10121, new Map<string, string>([
            ["USDC", "0xDf0360Ad8C5ccf25095Aa97ee5F2785c8d848620"],
            ["USDT", "0x5BCc22abEC37337630C0E0dd41D64fd86CaeE951"],
        ])],
        [10102, new Map<string, string>([
            ["BUSD", "0x1010Bb1b9Dff29e6233E7947e045e0ba58f6E92e"],
            ["USDT", "0xF49E250aEB5abDf660d643583AdFd0be41464EfD"],
        ])],
    ]),
    pancakeSwapSmartRouter: "0xC6665d98Efd81f47B03801187eB46cbC63F328B0",
}

const exportData = {
    localTestConstants,
    testnetTestConstants,
};

export default exportData as Readonly<typeof exportData>;