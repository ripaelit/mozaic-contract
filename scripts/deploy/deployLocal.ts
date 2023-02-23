import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToLocalNets } from '../util/deployUtils';
import { MozaicDeployment, StargateDeploymentOnchain } from '../constants/types'
import exportData from '../constants/index';
const fs = require('fs');

async function main() {
    let owner: SignerWithAddress;
    const stablecoinDeployments = new Map<number, Map<string, string>>();
    const stargateDeployments = new Map<number, StargateDeploymentOnchain>();
    const mozaicDeployments = new Map<number, MozaicDeployment>();
    const primaryChainId = exportData.localTestConstants.mozaicMainChainId;
    
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    await deployAllToLocalNets(owner, primaryChainId, stablecoinDeployments, stargateDeployments, mozaicDeployments);

    let allDeployments = [];
    for (const chainId of exportData.localTestConstants.chainIds) {
        // stablecoin
        let coinDeployment = stablecoinDeployments.get(chainId)!;
        let stargateDeployment = stargateDeployments.get(chainId)!;
        let mozaicDeployment = mozaicDeployments.get(chainId)!;
        let coins = [];
        for (const [name, token] of coinDeployment) {
            coins.push({name: name, token: token});
        }
        // stargate
        let router = stargateDeployment.routerContract.address;
        let bridge = stargateDeployment.bridgeContract.address;
        let lpStaking = stargateDeployment.lpStakingContract.address;
        let factory = stargateDeployment.factoryContract.address;
        let stgToken = stargateDeployment.stargateToken.address;
        let lzEndpoint = stargateDeployment.lzEndpoint.address;
        let pools = [];
        for (const [poolId, pool] of stargateDeployment.pools) {
            pools.push({poolId: poolId, pool: pool.address})
        }
        // mozaic
        let mozaicLp = mozaicDeployment.mozaicLp.address;
        let mozaicVault = mozaicDeployment.mozaicVault.address;

        allDeployments.push({
            chainId: chainId,
            primaryChainId: primaryChainId,
            coins: coins,
            router: router,
            bridge: bridge,
            lpStaking: lpStaking,
            factory: factory,
            stgToken: stgToken,
            lzEndpoint: lzEndpoint,
            pools: pools,
            mozaicLp: mozaicLp,
            mozaicVault: mozaicVault
        });
    }
    let res = JSON.stringify(allDeployments);
    
    fs.writeFileSync("deployLocalResult.json", res);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });