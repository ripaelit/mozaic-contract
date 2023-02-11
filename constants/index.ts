import {StargateChainPath} from './types';
import { ethers } from 'hardhat';
// define constants and types

const localTestConstants = {
  chainIds: [
    101, // ETH
    102, // BSC
  ],
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
      weight: 500,
    },
    { // ETH.USDC => BSC.BUSD
      sourceChainId: 101,
      sourcePoolId: 1,
      destinationChainId: 102,
      destinationPoolId: 5,
      weight: 500,
    },
    { // ETH.USDT => BSC.USDT
      sourceChainId: 101,
      sourcePoolId: 2,
      destinationChainId: 102,
      destinationPoolId: 2,
      weight: 500,
    },
    { // ETH.USDT => BSC.BUSD
      sourceChainId: 101,
      sourcePoolId: 2,
      destinationChainId: 102,
      destinationPoolId: 5,
      weight: 500,
    },
    { // BSC.USDT => ETH.USDC
      sourceChainId: 102,
      sourcePoolId: 2,
      destinationChainId: 101,
      destinationPoolId: 1,
      weight: 500,
    },
    { // BSC.USDT => ETH.USDT
      sourceChainId: 102,
      sourcePoolId: 2,
      destinationChainId: 101,
      destinationPoolId: 2,
      weight: 500,
    },
    { // BSC.BUSD => ETH.USDC
      sourceChainId: 102,
      sourcePoolId: 5,
      destinationChainId: 101,
      destinationPoolId: 1,
      weight: 500,
    },
    { // BSC.BUSD => ETH.USDT
      sourceChainId: 102,
      sourcePoolId: 5,
      destinationChainId: 101,
      destinationPoolId: 2,
      weight: 500,
    },
  ),
  stgMainChain: 101, // main chain ID of Stargate Token
  coinTotal:      ethers.BigNumber.from("1000000000000000000000"),        // 1000*1e18
  coinEachPool:   ethers.BigNumber.from("50000000000000000000"),          // 50*1e18
  coinOrderTaker: ethers.BigNumber.from("20000000000000000000"),          // 20*1e18
  coinStake:      ethers.BigNumber.from("3000000000000000000"),           // 3*1e18
  STGs:           ethers.BigNumber.from("4000000000000000000000000000"),  // 4e9*1e18
};

const contractConstants = {};

const exportData = {
  localTestConstants,
  contractConstants,
};

export default exportData as Readonly<typeof exportData>;
