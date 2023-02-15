import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, OrderTaker, OrderTaker__factory } from '../types/typechain';
import { deployStablecoins, deployStargate, equalize } from './TestUtils';
import { StargateDeployments, StableCoinDeployments } from '../constants/types'
import exportData from '../constants/index';

describe('OrderTaker', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let stablecoinDeployments: StableCoinDeployments;
  let stargateDeployments: StargateDeployments;
  let orderTakerDeployments = new Map<number, OrderTaker>();

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();  // owner is control center
    // Deploy Stablecoins
    stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);

    // Deploy Stargate
    stargateDeployments = await deployStargate(owner, stablecoinDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);

    // Deploy OrderTaker
    for (const chainId of exportData.localTestConstants.chainIds) {
      const orderTakerFactory = (await ethers.getContractFactory('OrderTaker', owner)) as OrderTaker__factory;
      const orderTaker = await orderTakerFactory.deploy(
        chainId,
        stargateDeployments.get(chainId)!.routerContract.address,
        stargateDeployments.get(chainId)!.lpStakingContract.address,
        stargateDeployments.get(chainId)!.stargateToken.address,
      );
      await orderTaker.deployed();
      orderTakerDeployments.set(chainId, orderTaker);
    }

    // Set deltaparam
    for (const chainId of stargateDeployments.keys()!) {
      for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
        let router = stargateDeployments.get(chainId)!.routerContract;
        await router.setFees(poolId, 2);
        await router.setDeltaParam(
          poolId,
          true,
          500, // 5%
          500, // 5%
          true, //default
          true //default
        );
      }
    }

    // Add enough liquidity to each pool on each chain
    for (const chainId of stargateDeployments.keys()!) {
      const router = stargateDeployments.get(chainId)!.routerContract;
      for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
        const erc20Factory = await ethers.getContractFactory('ERC20', owner) as ERC20__factory;
        const coinContract = erc20Factory.attach(await pool.token());
        // coinContract.connect(owner).approve(stargateDeployments.get(chainId)!.routerContract.address, exportData.localTestConstants.coinEachPool);
        await coinContract.connect(owner).increaseAllowance(router.address, exportData.localTestConstants.coinEachPool);
        await router.connect(owner).addLiquidity(poolId, exportData.localTestConstants.coinEachPool, pool.address);
      }
    }

    // update the chain path balances
    await equalize(owner, stargateDeployments);
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
        let order: OrderTaker.OrderStruct = {
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
          amount: ethers.BigNumber.from("0"),
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        await expect(orderTaker.connect(owner).executeOrders([order])).to.be.revertedWith("Cannot stake zero amount");
      }
    })
    it ('fails when asked by other than owner', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        let order: OrderTaker.OrderStruct = {   // Order to stake 10**2 * 10 ** 18
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
          amount: exportData.localTestConstants.coinStake, // 10**2 * 10**18
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // give enough stablecoin to OrderTaker
        const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
        await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
        
        await expect(orderTaker.connect(alice).executeOrders([order])).to.be.revertedWith("Ownable: caller is not the owner");
      }
    })
    it ('succeeds when positive amount by owner', async () => {
      for (const chainId of orderTakerDeployments.keys()) {
        const orderTaker = orderTakerDeployments.get(chainId)!;
        const firstPoolCoinname = stablecoinDeployments.get(chainId)!.keys().next().value;
        const firstPoolId = exportData.localTestConstants.poolIds.get(firstPoolCoinname);
        let order: OrderTaker.OrderStruct = {   // Order to stake
          orderType: ethers.BigNumber.from("0"), // OrderType.Stake
          amount: exportData.localTestConstants.coinStake,
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // give enough stablecoin to OrderTaker
        const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
        await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
        
        await orderTaker.connect(owner).executeOrders([order]);

        // check amount that user has staked to LPStaking
        const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
        const userInfo = await lpStaking.userInfo(ethers.BigNumber.from("0"), orderTaker.address);
        expect(userInfo.amount).gt(0);
      }
    })
  })
  describe.only('unstake', async () => {
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
          amount: exportData.localTestConstants.coinOrderTaker,
          arg1: ethers.BigNumber.from(""+firstPoolId),
          arg2: ethers.BigNumber.from("0"),
          arg3: ethers.BigNumber.from("0"),
        };
        // give enough stablecoin to OrderTaker
        const usdcContract = stablecoinDeployments.get(chainId)!.get(firstPoolCoinname)!;
        await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
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
        expect(await usdcContract.balanceOf(orderTaker.address)).gt(0);
      }
    })
  })
  describe('swapRemote', async () => {
    // it ('reverts when swap zero amount', async () => {
  
    // })
    it ('succeeds when positive amount by owner', async () => {
      const srcChainId = 101;
      const dstChainId = 102;
      const srcPoolId = 1;
      const dstPoolId = 2;
      const srcPoolName = "USDC";
      const dstPoolName = "USDT";
      let orderSwapRemote: OrderTaker.OrderStruct = {   // Order to swapRemote
        orderType: ethers.BigNumber.from("3"), // OrderType.SwapRemote
        amount: exportData.localTestConstants.coinSwap,
        arg1: srcPoolId,
        arg2: dstChainId,
        arg3: dstPoolId,
      };
      const orderTaker = orderTakerDeployments.get(srcChainId)!;

      // give enough stablecoin to OrderTaker
      const usdcContract = stablecoinDeployments.get(srcChainId)!.get(srcPoolName)!;
      await usdcContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);
      const usdtContract = stablecoinDeployments.get(dstChainId)!.get(dstPoolName)!;
      await usdtContract.connect(owner).transfer(orderTaker.address, exportData.localTestConstants.coinOrderTaker);

      await orderTaker.connect(owner).executeOrders([orderSwapRemote]);
    })

  });
});


