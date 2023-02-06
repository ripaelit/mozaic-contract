import {expect} from 'chai';
import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {LZEndpointMock, OrderTaker, OrderTaker__factory} from '../types/typechain';
import {ERC20, ERC20__factory} from '../types/typechain';

import consts from '../constants';
import { deployStablecoins, deployLzEndpoints } from './TestUtils';

describe('OrderTaker', () => {
  let orderTaker: OrderTaker;
  let owner: SignerWithAddress;
  let coinContracts: Map<number, Map<string, ERC20>>;
  let lzEndpoints = new Map<number, LZEndpointMock>();

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    // Deploy Stablecoins
    coinContracts = await deployStablecoins(owner);


    // Deploy LzEndpoints
    lzEndpoints = await deployLzEndpoints(owner, consts.localTestConstants.chainIds);
    for (const chainId of consts.localTestConstants.chainIds) {
      expect(await lzEndpoints.get(chainId)?.getChainId()).to.equal(chainId);
    }

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
