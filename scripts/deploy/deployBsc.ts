import { ethers, run } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import { getLzChainIdFromChainName } from '../util/utils'
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    
    hre.changeNetwork("bsctest");
    [owner] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    // deploy
    const chainId = getLzChainIdFromChainName('bsctest');
    const mozaicDeployment = await deployAllToTestNet(owner, chainId);
    console.log("Completed deploy");

    // write deploy result
    const mozaicVault = mozaicDeployment.mozaicVault.address;
    const mozaicBridge = mozaicDeployment.mozaicBridge.address;
    const mozaicLP = mozaicDeployment.mozaicLp.address;
    const stargateDriver = await mozaicDeployment.mozaicVault.protocolDrivers(1);
    const pancakeSwapDriver = await mozaicDeployment.mozaicVault.protocolDrivers(2);
    let res = JSON.stringify({
        chainId: chainId,
        mozaicVault: mozaicVault,
        mozaicBridge: mozaicBridge,
        mozaicLP: mozaicLP,
        stargateDriver: stargateDriver,
        pancakeSwapDriver: pancakeSwapDriver,
    });
    fs.writeFileSync("deployBscResult.json", res);

    // verify mozaicVault
    await run(`verify:verify`, {
        address: mozaicVault,
        constructorArguments: [],
    });
    console.log("Completed verify mozaicVault");

    // verify mozaicBridge
    const lzEndpoint = await mozaicDeployment.mozaicBridge.lzEndpoint();
    await run(`verify:verify`, {
        address: mozaicBridge,
        constructorArguments: [lzEndpoint],
    });
    console.log("Completed verify mozaicBridge");

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
        constructorArguments: [],
    });
    console.log("Completed verify stargateDriver");
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });