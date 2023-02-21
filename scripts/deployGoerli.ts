import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Router__factory, Bridge__factory, MockDex__factory, StargateToken__factory, LPStaking__factory, PrimaryVault } from '../types/typechain';
import { deployAllToTestNet, deployMozaic } from '../test/TestUtils';
import { MozaicDeployment } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';

async function main() {
    let owner: SignerWithAddress;
    const mozaicDeployments = new Map<number, MozaicDeployment>();
    
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    const chainId = exportData.testnetTestConstants.chainIds[0];
    await deployAllToTestNet(owner, chainId, mozaicDeployments);
    console.log("Goerli: chainId %d, MozaicLP %s, PrimaryVault %s", chainId, mozaicDeployments.get(chainId)!.mozaicLp.address, mozaicDeployments.get(chainId)!.mozaicVault.address);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });