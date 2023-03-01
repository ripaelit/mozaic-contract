import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import exportData from '../constants/index';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    
    hre.changeNetwork("goerli");
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    const chainId = exportData.testnetTestConstants.chainIds[0];
    const mozaicDeployment = await deployAllToTestNet(owner, chainId);
    let res = JSON.stringify({
        mozaicVault: mozaicDeployment.mozaicVault.address,
        lzEndpoint: await mozaicDeployment.mozaicVault.lzEndpoint(),
        chainId: await mozaicDeployment.mozaicVault.chainId(),
        primaryChainId: await mozaicDeployment.mozaicVault.primaryChainId(),
        lpStaking: await mozaicDeployment.mozaicVault.stargateLpStaking(),
        stgToken: await mozaicDeployment.mozaicVault.stargateToken(),
        mozaicLP: mozaicDeployment.mozaicLp.address
    });
    fs.writeFileSync("deployGoerliResult.json", res);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });