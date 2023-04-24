import { ethers, run } from 'hardhat';
import { deployMozaicTokenV2, deployXMozaicToken, deployXMozaicTokenBridge, getLzEndpoint } from '../util/deployUtils';
import { BigNumber } from 'ethers';
const fs = require('fs');

async function main() {
  let chainName = 'arbitrumGoerli';
  const treasury = '0x5525631e49D781d5d6ee368c82B72ff7485C5B1F';

  const mozaicTokenV2 = await deployMozaicTokenV2(
    chainName, 
    treasury, 
    ethers.utils.parseEther("1000000000"),
    ethers.utils.parseEther("1000"),
    ethers.utils.parseEther("0.01"),
    BigNumber.from("6")
  );

  const xMozaicToken = await deployXMozaicToken(
    chainName, 
    mozaicTokenV2
  );

  const xMozaicTokenBridge = await deployXMozaicTokenBridge(
    chainName, 
    xMozaicToken,
    BigNumber.from("6")
  );
  
  let res = JSON.stringify({
      chainName: chainName,
      mozaicTokenV2: mozaicTokenV2,
      xMozaicToken: xMozaicToken,
      xMozaicTokenBridge: xMozaicTokenBridge
  });
  fs.writeFileSync("deployTokensResult.json", res);

  // verify mozaicTokenV2
  const lzEndpoint = await getLzEndpoint(chainName);
  // const mozaicTokenV2 = '0x2B4Ee4511d52b8e2b261f43d20695D2770816BB2';
  await run(`verify:verify`, {
    address: mozaicTokenV2,
    constructorArguments: [
      lzEndpoint,
      treasury,
      ethers.utils.parseEther("1000000000"),
      ethers.utils.parseEther("1000"),
      ethers.utils.parseEther("0.01"),
      BigNumber.from("6")
    ],
  });
  console.log("Completed verify mozaicTokenV2");

  // verify xMozaicToken
  // const xMozaicToken = '0xD5AA6Fe4C9002468bFbDB19951b13f396007D0C9';
  await run(`verify:verify`, {
    address: xMozaicToken,
    constructorArguments: [
      mozaicTokenV2
    ],
  });
  console.log("Completed verify xMozaicToken");

  // verify xMozaicTokenBridge
  // const xMozaicTokenBridge = '0xF5aE203eA31fc91539e04D449E70A80F65C9043c';
  await run(`verify:verify`, {
    address: xMozaicTokenBridge,
    constructorArguments: [
      xMozaicToken,
      BigNumber.from("6"),
      lzEndpoint
    ],
  });
  console.log("Completed verify xMozaicTokenBridge");
}
  
main()
  .then(() => process.exit(0))
  .catch((error) => {
      console.error(error);
      process.exit(1);
  });