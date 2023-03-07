import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory } from '../../types/typechain';
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
    let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
    let primaryVault = primaryvaultFactory.attach(json.mozaicVault);  // Because primaryChain is goerli now.
    mozaicDeployment = {
        mozaicLp: mozLp,
        mozaicVault: primaryVault
    }
    mozaicDeployments.set(json.chainId, mozaicDeployment);

    // Parse fantom deploy info
    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
    mozLp = mozaicLpFactory.attach(json.mozaicLP);
    let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
    let secondaryVault = secondaryVaultFactory.attach(json.mozaicVault);
    mozaicDeployment = {
        mozaicLp: mozLp,
        mozaicVault: secondaryVault
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