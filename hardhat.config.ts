import {config as dotEnvConfig} from 'dotenv';
dotEnvConfig();

import type {HardhatUserConfig} from 'hardhat/types';

import '@typechain/hardhat';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-solhint';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomiclabs/hardhat-ethers';

const ALCHEMY_API_KEY = "SdxE5xrDm_WJBQSMjcHb3qKh68T5ILxD";

const GOERLI_PRIVATE_KEY = "3bcdb1523b4dae87e050231735b6c7f0464ef65b8487f61092b8fe6c5fb59f6a";

const INFURA_ID = 'e254d35aa64b4c16816163824d9d5b83'

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
    goerli: {
        // url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
        url: "https://goerli.infura.io/v3/" + INFURA_ID,
        chainId: 5,
        gasPrice: 20000000000,
        accounts: [GOERLI_PRIVATE_KEY]
    }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: "S1VH5HN4RW22314GI9APVKVFIJ36IH5SXV"
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

export default config;
