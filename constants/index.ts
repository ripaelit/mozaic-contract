import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

const localTestConstants = {
  chainIds: [
    101,
    102,
  ],
  stablecoins: [
    {
      name: 'USDC',
    },
  ],
};

const contractConstants = {};

const exportData = {
  localTestConstants,
  contractConstants,
};

export default exportData as Readonly<typeof exportData>;
