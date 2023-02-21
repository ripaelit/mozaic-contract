import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import { MozaicDeployment } from '../constants/types'
import exportData from '../constants/index';

async function main() {
    let owner: SignerWithAddress;
    const mozaicDeployments = new Map<number, MozaicDeployment>();
    
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    const chainId = exportData.testnetTestConstants.chainIds[1];
    await deployAllToTestNet(owner, chainId, mozaicDeployments);
    console.log("BSC: chainId %d, MozaicLP %s, SecondaryVault %s", chainId, mozaicDeployments.get(chainId)!.mozaicLp.address, mozaicDeployments.get(chainId)!.mozaicVault.address);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });