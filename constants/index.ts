import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

// define constants and types

const localTestConstants = {
  chainIds: [
    101,
    102,
  ],
  stablecoins: new Map<number, Array<string>>([
    [101, new Array<string>('USDC', 'USDT')],
    [102, new Array<string>('USDC', 'BUSD')],
  ]),
  poolIds: new Map<string, number>([
    ['USDC', 1],
    ['USDT', 2],
    ['BUSD', 5],
  ]),
  stgMainChain: 101, // main chain ID of Stargate Token
};

const contractConstants = {};

const exportData = {
  localTestConstants,
  contractConstants,
};

export default exportData as Readonly<typeof exportData>;
