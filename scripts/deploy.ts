import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, OrderTaker, OrderTaker__factory } from '../types/typechain';
import { deployStablecoins, deployStargate, equalize } from '../test/TestUtils';
import { StargateDeployments, StableCoinDeployments } from '../constants/types'
import exportData from '../constants/index';

async function main() {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let stablecoinDeployments: StableCoinDeployments;
  let stargateDeployments: StargateDeployments;
  let orderTakerDeployments = new Map<number, OrderTaker>();
  
  [owner, alice] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", owner.address);

  console.log("Account balance:", (await owner.getBalance()).toString());

  // Deploy Stablecoins
  stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);

  // Deploy Stargate
  stargateDeployments = await deployStargate(owner, stablecoinDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);
  
  // Deploy OrderTaker
  for (const chainId of exportData.localTestConstants.chainIds) {
    const orderTakerFactory = (await ethers.getContractFactory('OrderTaker', owner));
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
  for (const chainId of stargateDeployments.keys()) {
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
  console.log("deploy.main: Add enough liquidity to each pool on each chain:");
  for (const chainId of stargateDeployments.keys()) {
    const router = stargateDeployments.get(chainId)!.routerContract;
    for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
      const erc20Factory = await ethers.getContractFactory('ERC20', owner);
      const token = erc20Factory.attach(await pool.token());
      // token.connect(owner).approve(stargateDeployments.get(chainId)!.routerContract.address, exportData.localTestConstants.coinEachPool);
      await token.connect(owner).increaseAllowance(router.address, exportData.localTestConstants.coinEachPool);
      await router.connect(owner).addLiquidity(poolId, exportData.localTestConstants.coinEachPool, pool.address);
      console.log("deploy.main: addLiquidity: chainId, poolId, amount:", chainId, poolId, await pool.balanceOf(owner.address));
    }
  }

  // update the chain path balances
  await equalize(owner, stargateDeployments);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });