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
  stgMainChainId: 101, // main chain ID of Stargate Token
  mozaicPrimaryChainId: 101,
  coinTotal:      ethers.BigNumber.from("1000000000000000000000"),        // 1000*1e18
  coinEachPool:   ethers.BigNumber.from("50000000000000000000"),          // 50*1e18
  coinOrderTaker: ethers.BigNumber.from("20000000000000000000"),          // 20*1e18
  coinStake:      ethers.BigNumber.from("3000000000000000000"),           // 3*1e18
  coinSwap:       ethers.BigNumber.from("1000000000000000000"),           // 1*1e18
  stargateDriverId:     1,
  pancakeSwapDriverId:  2,
};

const contractConstants = {};

const exportData = {
  localTestConstants,
  contractConstants,
};

export default exportData as Readonly<typeof exportData>;
