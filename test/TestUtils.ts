import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {ERC20, ERC20__factory} from '../types/typechain';

import consts from '../constants';


export const deployStablecoins = async (owner: SignerWithAddress) => {
  let coinContracts : ERC20[] = [];
  for (const stablecoin of consts.localTestConstants.stablecoins) {
    const coinFactory = (await ethers.getContractFactory('ERC20', owner)) as ERC20__factory;
    const coin = await coinFactory.deploy(stablecoin.name, stablecoin.name);
    await coin.deployed();
    coinContracts.push(coin);
  }
  return coinContracts;
}
