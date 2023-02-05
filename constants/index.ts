import {BigNumber} from 'ethers';
import {parseEther} from 'ethers/lib/utils';

const localTestConstants = {
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
