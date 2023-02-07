import {config as dotEnvConfig} from 'dotenv';
dotEnvConfig();

import type {HardhatUserConfig} from 'hardhat/types';

import '@typechain/hardhat';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-solhint';
import '@nomicfoundation/hardhat-chai-matchers';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    compilers: [{version: '0.8.9', settings: {optimizer: {enabled:true, runs:200}}}],
  },
  // redirect typechain output for the frontend
  typechain: {
    outDir: './types/typechain',
  },
  networks: {
    hardhat: {
      gas: 30000000,
      gasPrice: 8000000000
    },
    localhost: {},
  },
};

export default config;
