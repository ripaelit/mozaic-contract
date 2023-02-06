import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {contracts, ERC20, ERC20__factory} from '../types/typechain';
import { LZEndpointMock, LZEndpointMock__factory } from '../types/typechain';

import consts from '../constants';


export const deployStablecoins = async (owner: SignerWithAddress) => {
  let coinContracts = new Map<number, Map<string, ERC20>>([]);

  for (const chainId of consts.localTestConstants.stablecoins.keys()) {
    let contractsInChain = new Map<string, ERC20>([]);
    for (const stablecoinname of consts.localTestConstants.stablecoins.get(chainId) || []) {
      const coinFactory = (await ethers.getContractFactory('ERC20', owner)) as ERC20__factory;
      const coin = await coinFactory.deploy(stablecoinname, stablecoinname);
      await coin.deployed();
      contractsInChain.set(stablecoinname, coin);
    }
    coinContracts.set(chainId, contractsInChain);
  }
  return coinContracts;
}

export const deployLzEndpoints = async (owner: SignerWithAddress, chainIds: number[]) => {
  let lzEndpointMocks = new Map<number, LZEndpointMock>();
  for (const chainId of chainIds) {
    const lzEndpointMockFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
    const lzEndpointMock = await lzEndpointMockFactory.deploy(chainId);
    await lzEndpointMock.deployed();
    lzEndpointMocks.set(chainId, lzEndpointMock);
  }
  return lzEndpointMocks;
}
