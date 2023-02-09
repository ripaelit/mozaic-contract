import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { OrderTaker, OrderTaker__factory } from '../types/typechain';
import { deployStablecoins, deployLzEndpoints, deployStargate } from './TestUtils';
import { StargateDeployments, LayerZeroDeployments, StableCoinDeployments } from '../constants/types'
import exportData from '../constants/index';

describe('OrderTaker', () => {
  let owner: SignerWithAddress;
  let stablecoinDeployments: StableCoinDeployments;
  let layerzeroDeployments: LayerZeroDeployments;
  let stargateDeployments: StargateDeployments;
  let orderTakerDeployments = new Map<number, OrderTaker>();

  beforeEach(async () => {
    [owner] = await ethers.getSigners();  // owner is control center
    // Deploy Stablecoins
    stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);

    // Deploy LzEndpoints
    layerzeroDeployments = await deployLzEndpoints(owner, exportData.localTestConstants.chainIds);
    for (const chainId of exportData.localTestConstants.chainIds) {
      expect(await layerzeroDeployments.get(chainId)?.getChainId()).to.equal(chainId);
    }

    // Deploy Stargate
    stargateDeployments = await deployStargate(owner, stablecoinDeployments, layerzeroDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);
    
    // Deploy OrderTaker
    for (const chainId of exportData.localTestConstants.chainIds) {
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
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        // const stakeOrder = new OrderTaker.OrderStruct()
        let order: OrderTaker.OrderStruct = {
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
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
    it ('succeeds when positive amount by owner', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        let order: OrderTaker.OrderStruct = {   // Order to stake 10**2 * 10 ** 18 from OrderTaker to USDC pool
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
          amount: ethers.BigNumber.from("100000000000000000000"), // 10**2 * 10**18
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // give enough stablecoin to OrderTaker
        const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
        await usdcContract.connect(owner).transfer(orderTaker.address, ethers.BigNumber.from("100000000000000000000000"));  // 10**5 * 10**18
        
        await orderTaker.connect(owner).executeOrders([order]);

        // check amount that user has staked to LPStaking
        const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
        const userInfo = await lpStaking.userInfo(ethers.BigNumber.from("0"), orderTaker.address);
        expect(userInfo.amount).gt(0);
      }
    })
  })
});
