import {expect} from 'chai';
import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {OrderTaker, OrderTaker__factory} from '../types/typechain';
import {ERC20, ERC20__factory} from '../types/typechain';

import consts from '../constants';
import { deployStablecoins } from './TestUtils';

describe('OrderTaker', () => {
  let orderTaker: OrderTaker;
  let owner: SignerWithAddress;
  let coinContracts: ERC20[];

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    // Deploy Stablecoins
    coinContracts = await deployStablecoins(owner);
    // Deploy Stargate
    
    // Deploy OrderTaker
    const orderTakerFactory = (await ethers.getContractFactory('OrderTaker', owner)) as OrderTaker__factory;
    orderTaker = await orderTakerFactory.deploy(10, '0x0', '0x0', '0x0');
    await orderTaker.deployed();
  });

  describe('deployment', async () => {
    expect(await orderTaker.owner()).to.eq(owner.address);
  });
});
