import {expect} from 'chai';
import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {LZEndpointMock, OrderTaker, OrderTaker__factory} from '../types/typechain';
import {ERC20, ERC20__factory} from '../types/typechain';

import consts from '../constants';
import { deployStablecoins, deployLzEndpoints, deployStargate, StargateDeployments, LayerZeroDeployments, StableCoinDeployments } from './TestUtils';

describe('OrderTaker', () => {
  let owner: SignerWithAddress;
  let stablecoinDeployments: StableCoinDeployments;
  let layerzeroDeployments: LayerZeroDeployments;
  let stargateDeployments: StargateDeployments;
  let orderTakerDeployments = new Map<number, OrderTaker>();

  beforeEach(async () => {
    [owner] = await ethers.getSigners();
    // Deploy Stablecoins
    stablecoinDeployments = await deployStablecoins(owner);


    // Deploy LzEndpoints
    layerzeroDeployments = await deployLzEndpoints(owner, consts.localTestConstants.chainIds);
    for (const chainId of consts.localTestConstants.chainIds) {
      expect(await layerzeroDeployments.get(chainId)?.getChainId()).to.equal(chainId);
    }

    // Deploy Stargate
    stargateDeployments = await deployStargate(owner, stablecoinDeployments, layerzeroDeployments, consts.localTestConstants.poolIds, consts.localTestConstants.stgMainChain);
    
    // Deploy OrderTaker
    for (const chainId of consts.localTestConstants.chainIds) {
      const orderTakerFactory = (await ethers.getContractFactory('OrderTaker', owner)) as OrderTaker__factory;
      const orderTaker = await orderTakerFactory.deploy(
        chainId,
        stargateDeployments.get(chainId)!.routerContract.address,
        stargateDeployments.get(chainId)!.lpStakingContract.address,
        stargateDeployments.get(chainId)!.stargateToken.address
      );
      await orderTaker.deployed();
      orderTakerDeployments.set(chainId, orderTaker);
    }
  });

  describe('deployment', async () => {
    it ('set owner correctly', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        expect(await orderTaker.owner()).to.eq(owner.address);
      }
    })
  });
  describe('stake', async () => {
    it ('reverts when staking zero amount', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = consts.localTestConstants.poolIds.get(firstPoolCoinname);
        // const stakeOrder = new OrderTaker.OrderStruct()
        let order: OrderTaker.OrderStruct = {
          orderType: ethers.BigNumber.from("0"), // OrderType.Swap
          amount: ethers.BigNumber.from("0"),
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        await expect(orderTaker.connect(owner).executeOrders([order])).to.be.revertedWith("Cannot stake zero amount");
      }
    });
    it ('fails when asked by other than owner', async () => {

    })
    it ('succeeds when possitive amount by owner', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = consts.localTestConstants.poolIds.get(firstPoolCoinname);
        // const stakeOrder = new OrderTaker.OrderStruct()
        let order: OrderTaker.OrderStruct = {
          orderType: ethers.BigNumber.from("0"), // OrderType.Swap
          amount: ethers.BigNumber.from("100000000000000000000"),
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        await orderTaker.connect(owner).executeOrders([order]);
      }
    })
  })
});
