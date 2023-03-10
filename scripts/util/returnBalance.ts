import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PrimaryVault__factory, SecondaryVault__factory } from '../../types/typechain';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
        
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
    let primaryVaultAddr = "0x07422cB6F07D8d60B6fCe181773A7Beb9a168545";
    let primaryVault = primaryvaultFactory.attach(primaryVaultAddr);
    let tx = await primaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("primaryVault returned balance");

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
    let secondaryVaultAddr = "0x1C62107DdbeDeE8564e68162624e6A994e6379D3";
    let secondaryVault = secondaryVaultFactory.attach(secondaryVaultAddr);
    tx = await secondaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("secondaryVault returned balance");
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });