import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployAllToTestNet } from '../util/deployUtils';
import exportData from '../constants/index';
import { IStargateRouter__factory, IStargateRouter, Bridge__factory, Bridge, PrimaryVault__factory } from '../../types/typechain';
const fs = require('fs');
const hre = require('hardhat');

async function main() {
    let owner: SignerWithAddress;
    
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    
    let vaultFactory = await ethers.getContractFactory('PrimaryVault', owner) as PrimaryVault__factory;
    let vault = await vaultFactory.attach('0xC1585bDDAd92e3B20Ce850Da4D15513a8618DCDF');
    let tx = await vault.connect(owner).returnBalance();
    await tx.wait();
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });