import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

const localTestConstants = {
  chainIds: [
    101,
    102,
  ],
  stablecoins: new Map<number, Array<string>>([
    [101, new Array<string>('USDC', 'USDT')],
    [101, new Array<string>('USDC', 'USDT')],
  ])
};

const contractConstants = {};

const exportData = {
  localTestConstants,
  contractConstants,
};

export default exportData as Readonly<typeof exportData>;
