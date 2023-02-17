import { ethers } from 'hardhat';

export const deployNew = async (contractName: string, params: any[] = []) => {
  const C = await ethers.getContractFactory(contractName);
  return await C.deploy(...params)
}