import {config as dotEnvConfig} from 'dotenv';
dotEnvConfig();

import type {HardhatUserConfig} from 'hardhat/types';

import '@typechain/hardhat';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-solhint';
import '@nomicfoundation/hardhat-chai-matchers';
import '@nomiclabs/hardhat-ethers';
import 'hardhat-contract-sizer';

const { mnemonic, bscscanApiKey } = require('./secrets.json');

// const ALCHEMY_API_KEY = "SdxE5xrDm_WJBQSMjcHb3qKh68T5ILxD";
const ALCHEMY_API_KEY = "N9yQH6XzETO5Mf5WIc9LRChcTvXdQNn_"; // App name: test


const GOERLI_PRIVATE_KEY_1 = "694602b4c1ec4c15e43b8fb7d897fe387536f93a771b9f33c5b01deab76623c9";    // acount1
const GOERLI_PRIVATE_KEY_2 = "3bcdb1523b4dae87e050231735b6c7f0464ef65b8487f61092b8fe6c5fb59f6a";    // acount2
const GOERLI_PRIVATE_KEY_3 = "c29075ed81f5cec37138e3474e90613ba5f1f2e97ee55824aa7a0702242a3711";    // acount3

// const INFURA_ID = 'e254d35aa64b4c16816163824d9d5b83'

const config: HardhatUserConfig = {
    defaultNetwork: 'hardhat',
    solidity: {
        compilers: [{
            version: '0.8.9', 
            settings: {
                optimizer: {
                    enabled:true, 
                    runs:1
                }
            }
        }],
    },
    // redirect typechain output for the frontend
    typechain: {
        outDir: './types/typechain',
    },
    networks: {
        hardhat: {
            gas: 30000000, //"auto", // 30000000
            gasPrice: "auto",// 8000000000
        },
        localhost: {
            url: "http://127.0.0.1:8545",
            gas: 30000000, //"auto", // 30000000
            gasPrice: 20000000000,
        },
        goerli: {
            url: "https://goerli.blockpi.network/v1/rpc/public",
            // url: "https://eth-goerli.g.alchemy.com/v2/" + ALCHEMY_API_KEY,
            // url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
            // url: "https://goerli.infura.io/v3/" + INFURA_ID,
            chainId: 5,
            // gasPrice: 20000000000,
            accounts: [GOERLI_PRIVATE_KEY_1, GOERLI_PRIVATE_KEY_2, GOERLI_PRIVATE_KEY_3],
        },
        bsctest: {
            url: `https://data-seed-prebsc-1-s3.binance.org:8545/`,
            chainId: 97,
            // gasPrice: 20000000000,
            accounts: {mnemonic: mnemonic}
        },
    },
    etherscan: {
        // Your API key for Etherscan
        // Obtain one at https://etherscan.io/

        // apiKey: goerliApiKey
        apiKey: bscscanApiKey
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 40000000000000
    }
};

export default config;
