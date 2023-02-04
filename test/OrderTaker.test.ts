import {expect} from 'chai';
import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {OrderTaker, OrderTaker__factory} from '../types/typechain';

describe('OrderTaker', () => {
  let orderTaker: OrderTaker;
  let owner: SignerWithAddress;

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    const orderTakerFactory = (await ethers.getContractFactory('OrderTaker', owner)) as OrderTaker__factory;
    orderTaker = await orderTakerFactory.deploy(10, '0x0', '0x0', '0x0');
    await orderTaker.deployed();
  });

  describe('deployment', async () => {
    expect(await orderTaker.owner()).to.eq(owner.address);
  });
});
