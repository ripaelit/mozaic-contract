import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import { MozaicDeployment } from '../constants/types'
import exportData from '../constants/index';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    const mozaicDeployments = new Map<number, MozaicDeployment>();
    let mozaicDeployment: MozaicDeployment;
    
    hre.changeNetwork('goerli');
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    let chainId = exportData.testnetTestConstants.chainIds[0];
    await deployAllToTestNet(owner, chainId, mozaicDeployments);
    mozaicDeployment = mozaicDeployments.get(chainId)!;
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

    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    chainId = exportData.testnetTestConstants.chainIds[1];
    await deployAllToTestNet(owner, chainId, mozaicDeployments);
    mozaicDeployment = mozaicDeployments.get(chainId)!;
    res = JSON.stringify({
        mozaicVault: mozaicDeployment.mozaicVault.address,
        lzEndpoint: await mozaicDeployment.mozaicVault.lzEndpoint(),
        chainId: await mozaicDeployment.mozaicVault.chainId(),
        primaryChainId: await mozaicDeployment.mozaicVault.primaryChainId(),
        lpStaking: await mozaicDeployment.mozaicVault.stargateLpStaking(),
        stgToken: await mozaicDeployment.mozaicVault.stargateToken(),
        mozaicLP: mozaicDeployment.mozaicLp.address
    });
    fs.writeFileSync("deployBscResult.json", res);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });