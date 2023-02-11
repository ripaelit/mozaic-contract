import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, OrderTaker, OrderTaker__factory } from '../types/typechain';
import { deployStablecoins, deployLzEndpoints, deployStargate, registerLzApp } from './TestUtils';
import { StargateDeployments, LayerZeroDeployments, StableCoinDeployments } from '../constants/types'
import exportData from '../constants/index';

describe('OrderTaker', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let stablecoinDeployments: StableCoinDeployments;
  let layerzeroDeployments: LayerZeroDeployments;
  let stargateDeployments: StargateDeployments;
  let orderTakerDeployments = new Map<number, OrderTaker>();

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();  // owner is control center
    // Deploy Stablecoins
    stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);

    // Deploy LzEndpoints
    layerzeroDeployments = await deployLzEndpoints(owner, exportData.localTestConstants.chainIds);
    for (const chainId of exportData.localTestConstants.chainIds) {
      expect(await layerzeroDeployments.get(chainId)?.getChainId()).to.equal(chainId);
    }

    // Deploy Stargate
    // 1. Deploy contracts
    stargateDeployments = await deployStargate(owner, stablecoinDeployments, layerzeroDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);
    // 2. Register Bridge LzApp
    for (const chainId of stargateDeployments.keys()!) {
      const bridgeLzApp = stargateDeployments.get(chainId)!.bridgeContract;
      await registerLzApp(owner, layerzeroDeployments, chainId, bridgeLzApp.address);
    }
    // 3. Add enough liquidity to each pool on each chain
    for (const chainId of stargateDeployments.keys()!) {
      for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
        const erc20Factory = await ethers.getContractFactory('ERC20', owner) as ERC20__factory;
        const coinContract = erc20Factory.attach(await pool.token());
        coinContract.connect(owner).approve(stargateDeployments.get(chainId)!.routerContract.address, exportData.localTestConstants.coinEachPool);
        await stargateDeployments.get(chainId)!.routerContract.addLiquidity(poolId, exportData.localTestConstants.coinEachPool, pool.address);
      }
    }

    // 4. Update every chainPath (which means each Pool know the status of other counterpart Pools)
    // recommend call Router.sendCredits()
    for (const chainId of stargateDeployments.keys()!) {
      for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
        const chainPathsLength = await pool.getChainPathsLength();
        for (let i = 0; i < chainPathsLength.toNumber(); i++) {
          let cp = await pool.chainPaths(i);
          stargateDeployments.get(chainId)!.routerContract.connect(owner).sendCredits(cp.dstChainId, poolId, cp.dstPoolId, owner.address, {value: ethers.utils.parseEther("0.01")});
        }
      }
      
    }
    
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

  // describe('deployment', async () => {
  //   it ('set owner correctly', async () => {
  //     for (const chainId of orderTakerDeployments.keys()) {
  //       const orderTaker = orderTakerDeployments.get(chainId)!;
  //       expect(await orderTaker.owner()).to.eq(owner.address);
  //     }
  //   })
  // });
  // describe('stake', async () => {
  //   it ('reverts when staking zero amount', async () => {
  //     for (const chainId of orderTakerDeployments.keys()) {
  //       const orderTaker = orderTakerDeployments.get(chainId)!;
  //       const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
  //       const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
  //       let order: OrderTaker.OrderStruct = {
  //         orderType: ethers.BigNumber.from("0"), // OrderType.Stake
  //         amount: ethers.BigNumber.from("0"),
  //         arg1: ethers.BigNumber.from(""+firstPoolId),
  //         arg2: ethers.BigNumber.from("0"),
  //         arg3: ethers.BigNumber.from("0"),
  //       };
  //       await expect(orderTaker.connect(owner).executeOrders([order])).to.be.revertedWith("Cannot stake zero amount");
  //     }
  //   })
  //   it ('fails when asked by other than owner', async () => {
  //     for (const chainId of orderTakerDeployments.keys()) {
  //       const orderTaker = orderTakerDeployments.get(chainId)!;
  //       const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
  //       const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
  //       let order: OrderTaker.OrderStruct = {   // Order to stake 10**2 * 10 ** 18
  //         orderType: ethers.BigNumber.from("0"), // OrderType.Stake
  //         amount: exportData.localTestConstants.coinStake, // 10**2 * 10**18
  //         arg1: ethers.BigNumber.from(""+firstPoolId),
  //         arg2: ethers.BigNumber.from("0"),
  //         arg3: ethers.BigNumber.from("0"),
  //       };
  //       // give enough stablecoin to OrderTaker
  //       const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
  //       await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
        
  //       await expect(orderTaker.connect(alice).executeOrders([order])).to.be.revertedWith("Ownable: caller is not the owner");
  //     }
  //   })
  //   it ('succeeds when positive amount by owner', async () => {
  //     for (const chainId of orderTakerDeployments.keys()) {
  //       const orderTaker = orderTakerDeployments.get(chainId)!;
  //       const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
  //       const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
  //       let order: OrderTaker.OrderStruct = {   // Order to stake
  //         orderType: ethers.BigNumber.from("0"), // OrderType.Stake
  //         amount: exportData.localTestConstants.coinStake,
  //         arg1: ethers.BigNumber.from(""+firstPoolId),
  //         arg2: ethers.BigNumber.from("0"),
  //         arg3: ethers.BigNumber.from("0"),
  //       };
  //       // give enough stablecoin to OrderTaker
  //       const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
  //       await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
        
  //       await orderTaker.connect(owner).executeOrders([order]);

  //       // check amount that user has staked to LPStaking
  //       const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
  //       const userInfo = await lpStaking.userInfo(ethers.BigNumber.from("0"), orderTaker.address);
  //       expect(userInfo.amount).gt(0);
  //     }
  //   })
  // })
  describe('unstake', async () => {
    it ('reverts when unstaking zero amount', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        let order: OrderTaker.OrderStruct = {
          orderType: ethers.BigNumber.from("1"), // OrderType.Unstake
          amount: ethers.BigNumber.from("0"),
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        await expect(orderTaker.connect(owner).executeOrders([order])).to.be.revertedWith("Cannot unstake zero amount");
      }
    })
    it ('fails when asked by other than owner', async () => {
      // for (const chainId of orderTakerDeployments.keys()) {
      //   const orderTaker = orderTakerDeployments.get(chainId)!;
      //   const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
      //   const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
      //   // 1. stake
      //   let orderStake: OrderTaker.OrderStruct = {   // Order to stake
      //     orderType: ethers.BigNumber.from("0"), // OrderType.Stake
      //     amount: exportData.localTestConstants.coinStake, // 10**2 * 10**18
      //     arg1: ethers.BigNumber.from(""+firstPoolId),
      //     arg2: ethers.BigNumber.from("0"),
      //     arg3: ethers.BigNumber.from("0"),
      //   };
      //   // give enough stablecoin to OrderTaker
      //   const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
      //   await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);  // 10**5 * 10**18
      //   // execute orderStake
      //   await orderTaker.connect(owner).executeOrders([orderStake]);
      //   // check amount that user has staked to LPStaking
      //   const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
      //   const userInfo = await lpStaking.userInfo(ethers.BigNumber.from("0"), orderTaker.address);
      //   let amountLPToken = userInfo.amount.toNumber();
      //   expect(amountLPToken).gt(0);
      //   console.log("LPToken amount staked to LPStaking:", amountLPToken);//kevin
      //   // 2. unstake
      //   let orderUnstake: OrderTaker.OrderStruct = {   // Order to unstake
      //     orderType: ethers.BigNumber.from("1"), // OrderType.Unstake
      //     amount: amountLPToken,
      //     arg1: ethers.BigNumber.from(""+firstPoolId),
      //     arg2: ethers.BigNumber.from("0"),
      //     arg3: ethers.BigNumber.from("0"),
      //   };
      //   // execute orderUnstake
      //   await orderTaker.connect(alice).executeOrders([orderUnstake]);
      //   // check coin amount that user has unstaked
      //   expect(await usdcContract.balanceOf(orderTaker.address)).to.eq(exportData.localTestConstants.coinOrderTaker);// 10**5 ** 18 (decimals)
      // }
    })
    it ('succeeds when positive amount by owner', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        // 1. stake
        let orderStake: OrderTaker.OrderStruct = {   // Order to stake
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
          amount: exportData.localTestConstants.coinStake, // 10**2 * 10**18
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // give enough stablecoin to OrderTaker
        const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
        await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);  // 10**5 * 10**18
        // execute orderStake
        await orderTaker.connect(owner).executeOrders([orderStake]);
        // check amount that user has staked to LPStaking
        const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
        const userInfo = await lpStaking.userInfo(ethers.BigNumber.from("0"), orderTaker.address);
        let amountLPToken = userInfo.amount.toNumber();
        expect(amountLPToken).gt(0);
        console.log("LPToken amount staked to LPStaking:", amountLPToken);//kevin
        // 2. unstake
        let orderUnstake: OrderTaker.OrderStruct = {   // Order to unstake
          orderType: ethers.BigNumber.from("1"), // OrderType.Unstake
          amount: amountLPToken,
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // execute orderUnstake
        await orderTaker.connect(owner).executeOrders([orderUnstake]);
        // check coin amount that user has unstaked
        expect(await usdcContract.balanceOf(orderTaker.address)).to.eq(exportData.localTestConstants.coinOrderTaker);// 10**5 ** 18 (decimals)
      }
    })
  })
});
