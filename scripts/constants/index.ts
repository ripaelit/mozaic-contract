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
        [102, new Array<string>('BUSD', 'USDT')],
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
        // 10121,  // Goerli
        10102,  // BNB
        10112,  // Fantom
    ],
    chains: new Map<number, string>([
        [10102, 'bsctest'],
        [10112, 'fantom'],
    ]),
    stgMainChainId: 10121,  // Goerli
    mozaicMainChainId: 10102,   // BNB
    routers: new Map<number, string>([
        // [10121, "0x7612aE2a34E5A363E137De748801FB4c86499152"],
        [10102, "0xbB0f1be1E9CE9cB27EA5b0c3a85B7cc3381d8176"],
        [10112, "0xa73b0a56B29aD790595763e71505FCa2c1abb77f"],
    ]),
    bridges: new Map<number, string>([
        // [10121, "0xE6612eB143e4B350d55aA2E229c80b15CA336413"],
        [10102, "0xa1E105511416aEc3200CcE7069548cF332c6DCA2"],
        [10112, "0xb97948ad8805174e0CB27cAf0115e5eA5e02F3A7"],
    ]),
    factories: new Map<number, string>([
        // [10121, "0xB30300c11FF54f8F674a9AA0777D8D5e9fefd652"],
        [10102, "0x407210a67cDAe7Aa09E4426109329cd3E90aFe47"],
        [10112, "0xEa2aC81591de47ab33408D48c22b10D24AAD6F0F"],
    ]),
    stablecoins: new Map<number, Map<string, string>>([
        // [10121, new Map<string, string>([
        //     ["USDC", "0xDf0360Ad8C5ccf25095Aa97ee5F2785c8d848620"],
        //     ["USDT", "0x5BCc22abEC37337630C0E0dd41D64fd86CaeE951"],
        // ])],
        [10102, new Map<string, string>([
            ["BUSD", "0x1010Bb1b9Dff29e6233E7947e045e0ba58f6E92e"],
            ["USDT", "0xF49E250aEB5abDf660d643583AdFd0be41464EfD"],
        ])],
        [10112, new Map<string, string>([
            ["USDC", "0x076488D244A73DA4Fa843f5A8Cd91F655CA81a1e"],
        ])],
    ]),
    poolIds: new Map<string, number>([
        ['USDC', 1],
        ['USDT', 2],
        ['BUSD', 5],
    ]), 
    lzToGlobalChainIds: new Map<number, number>([
        // [10121, 5],
        [10102, 97],
        [10112, 4002],
    ]),
    signers: [
        '0x5525631e49D781d5d6ee368c82B72ff7485C5B1F',
        '0xBc1bE99E95593169C80C475D114d385c0940b573',
        '0xEe4F53e29F7b06a6DFC9B9C22d626E32d992066D',
    ],
    
    lpStakingPoolIndex: new Map<string, Map<string, number>>([
        [
            'bsctest', new Map<string, number>([
                ['BUSD', 0],
                ['USDT', 1],
            ])
        ],
        [
            'fantom', new Map<string, number>([
                ['USDC', 0],
            ])
        ],
    ]),
    pancakeSwapSmartRouter: "0xC6665d98Efd81f47B03801187eB46cbC63F328B0",
    stargateDriverId:     1,
    pancakeSwapDriverId:  2,
    MOZAIC_DECIMALS: 6,
}

const exportData = {
    localTestConstants,
    testnetTestConstants,
};

export default exportData as Readonly<typeof exportData>;
