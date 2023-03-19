import { ethers, run } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import exportData from '../constants/index';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    
    hre.changeNetwork("bsctest");
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    // deploy
    const chainId = exportData.testnetTestConstants.chainIds[1];
    const mozaicDeployment = await deployAllToTestNet(owner, chainId);
    console.log("Completed deploy");

    // verify mozaicVault
    const mozaicVault = mozaicDeployment.mozaicVault.address;
    const lzEndpoint = await mozaicDeployment.mozaicVault.lzEndpoint();
    const primaryChainId = await mozaicDeployment.mozaicVault.primaryChainId();
    const lpStaking = await mozaicDeployment.mozaicVault.stargateLpStaking();
    const stgToken = await mozaicDeployment.mozaicVault.stargateToken();
    const mozaicLP = mozaicDeployment.mozaicLp.address;
    const stargateDriver = await mozaicDeployment.mozaicVault.protocolDrivers(1);
    const pancakeSwapDriver = await mozaicDeployment.mozaicVault.protocolDrivers(2);
    await run(`verify:verify`, {
        address: mozaicVault,
        constructorArguments: [lzEndpoint, chainId, primaryChainId, lpStaking, stgToken, mozaicLP],
    });
    console.log("Completed verify mozaicVault");

    // verify mozaicLP
    const mozaicLPName = await mozaicDeployment.mozaicLp.name();
    const mozaicLPSymbol = await mozaicDeployment.mozaicLp.symbol();
    const mozaicLPLzEndpoint = await mozaicDeployment.mozaicLp.lzEndpoint();
    await run(`verify:verify`, {
        address: mozaicLP,
        constructorArguments: [mozaicLPName, mozaicLPSymbol, mozaicLPLzEndpoint],
    });
    console.log("Completed verify mozaicLP");

    // verify stargateDriver
    await run(`verify:verify`, {
        address: stargateDriver,
    });
    console.log("Completed verify stargateDriver");

    // write deploy result
    let res = JSON.stringify({
        mozaicVault: mozaicVault,
        lzEndpoint: lzEndpoint,
        chainId: chainId,
        primaryChainId: primaryChainId,
        lpStaking: lpStaking,
        stgToken: stgToken,
        mozaicLP: mozaicLP,
        stargateDriver: stargateDriver,
        pancakeSwapDriver: pancakeSwapDriver,
    });
    fs.writeFileSync("deployBscResult.json", res);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });