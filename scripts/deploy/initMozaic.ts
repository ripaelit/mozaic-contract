import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, MozaicVault__factory, MozaicBridge__factory } from '../../types/typechain';
import { MozaicDeployment } from '../constants/types';
import { initMozaics } from '../util/deployUtils';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    let mozaicDeployment = {} as MozaicDeployment;
    let mozaicDeployments: Map<number, MozaicDeployment>;
    mozaicDeployments = new Map<number, MozaicDeployment>();
        
    // Parse bsctest deploy info
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
    let mozLp = mozaicLpFactory.attach(json.mozaicLP);
    let mozaicVaultFactory = (await ethers.getContractFactory('MozaicVault', owner)) as MozaicVault__factory;
    let mozaicVault = mozaicVaultFactory.attach(json.mozaicVault);
    let mozaicBridgeFactory = (await ethers.getContractFactory('MozaicBridge', owner)) as MozaicBridge__factory;
    let mozaicBridge = mozaicBridgeFactory.attach(json.mozaicBridge);
    mozaicDeployment = {
        mozaicLp: mozLp,
        mozaicVault: mozaicVault,
        mozaicBridge: mozaicBridge
    }
    mozaicDeployments.set(json.chainId, mozaicDeployment);

    // Parse fantom deploy info
    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
    mozLp = mozaicLpFactory.attach(json.mozaicLP);
    mozaicVaultFactory = (await ethers.getContractFactory('MozaicVault', owner)) as MozaicVault__factory;
    mozaicVault = mozaicVaultFactory.attach(json.mozaicVault);
    mozaicBridgeFactory = (await ethers.getContractFactory('MozaicBridge', owner)) as MozaicBridge__factory;
    mozaicBridge = mozaicBridgeFactory.attach(json.mozaicBridge);
    mozaicDeployment = {
        mozaicLp: mozLp,
        mozaicVault: mozaicVault,
        mozaicBridge: mozaicBridge
    }
    mozaicDeployments.set(json.chainId, mozaicDeployment);
    
    await initMozaics(mozaicDeployments);
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });