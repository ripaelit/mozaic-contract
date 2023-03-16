import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PrimaryVault__factory, SecondaryVault__factory } from '../../types/typechain';
import { BigNumber } from 'ethers';
const fs = require('fs');
const hre = require('hardhat');

export const returnBalance = async () => {
    console.log("returnBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let primaryVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let secondaryVaultAddr = json.mozaicVault;

    let owner: SignerWithAddress;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
    let primaryVault = primaryvaultFactory.attach(primaryVaultAddr);
    console.log("bsc vault balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());
    let tx = await primaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("bsc vault returned balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
    let secondaryVault = secondaryVaultFactory.attach(secondaryVaultAddr);
    console.log("fantom vault balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString().toString());
    tx = await secondaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("fantom vault returned balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString().toString());
}

export const sendBalance = async (amounts: BigNumber[]) => {
    console.log("sendBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let primaryVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let secondaryVaultAddr = json.mozaicVault;

    let owner: SignerWithAddress;
        
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    console.log("bsc vault balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());
    let tx = await owner.sendTransaction({
        to: primaryVaultAddr,
        value: amounts[0]
    });
    await tx.wait();
    console.log("after send, bsc vault balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    console.log("fantom vault balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString());
    tx = await owner.sendTransaction({
        to: secondaryVaultAddr,
        value: amounts[1]
    });
    await tx.wait();
    console.log("after send, fantom vault balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString());
}
