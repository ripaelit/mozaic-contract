import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import exportData from '../constants/index';
import { BigNumber } from 'ethers';

// Constants in Goerli(Ethereum Testnet)
const ETHEREUM_CHAINID = 10121;
const STARGATE_ROUTER = "0x7612aE2a34E5A363E137De748801FB4c86499152";
const STARGATE_BRIDGE = "0xE6612eB143e4B350d55aA2E229c80b15CA336413";

async function main() {
  let owner: SignerWithAddress;
  
  [owner] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", owner.address);
  console.log("Account balance:", (await owner.getBalance()).toString());

  const chainId = ETHEREUM_CHAINID;
  const stargateRouter = STARGATE_ROUTER;
  const bridgeFactory = (await ethers.getContractFactory('Bridge', owner));
  const bridge = bridgeFactory.attach(STARGATE_BRIDGE);
  const lzEndpoint = await bridge.layerZeroEndpoint();
  const stgMainChainId = ETHEREUM_CHAINID;
  
  // Deploy Stargate Token
  const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner));
  const stargateToken = await stargateTokenFactory.deploy(
    'Stargate Token', 
    'STG', 
    lzEndpoint, 
    stgMainChainId, 
    exportData.localTestConstants.STGs // 4*1e12
  );
  await stargateToken.deployed();
  console.log("Deployed StargateToken: chainId, address, totalSupply:", chainId, stargateToken.address, await stargateToken.totalSupply());

  // Deploy LPStaking contract
  const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner));
  const latestBlockNumber = await ethers.provider.getBlockNumber();
  const lpStaking = await lpStakingFactory.deploy(stargateToken.address, BigNumber.from("100000"), latestBlockNumber + 3, latestBlockNumber + 3);
  await lpStaking.deployed();
  console.log("Deployed LPStaking: chainId, address, totalAllocPoint:", chainId, lpStaking.address, await lpStaking.totalAllocPoint());
  
  // Deploy OrderTaker to ethereum goerli testnet
  const orderTakerFactory = await ethers.getContractFactory('OrderTaker', owner);
  const orderTaker = await orderTakerFactory.deploy(
    chainId,
    stargateRouter,
    lpStaking.address,
    stargateToken.address
  );
  await orderTaker.deployed();
  console.log("deploy:main: Deployed OrderTakers: chainId, address", chainId, orderTaker.address);

  // // Set deltaparam
  // for (const chainId of stargateDeployments.keys()) {
  //   for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
  //     let router = stargateDeployments.get(chainId)!.routerContract;
  //     console.log("deploy.main: Set deltaparam: chainId, poolId, router.address:", chainId, poolId, router.address);
  //     await router.setFees(poolId, 2);
  //     await router.setDeltaParam(
  //       poolId,
  //       true,
  //       500, // 5%
  //       500, // 5%
  //       true, //default
  //       true //default
  //     );
  //   }
  // }
  
  // // update the chain path balances
  // await equalize(owner, stargateDeployments);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });