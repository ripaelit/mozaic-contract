import { ethers, run } from 'hardhat';
import { deployMozaicTokenV2, deployXMozaicToken } from '../util/deployUtils';
const fs = require('fs');

async function main() {
  let chainName = 'arbitrum';
  const treasury = '';
  const mozaicTokenV2 = await deployMozaicTokenV2(
    chainName, 
    treasury, 
    ethers.utils.parseEther("1000000000"),
    ethers.utils.parseEther("1000"),
    ethers.utils.parseEther("0.01"),
    18
  );
  const xMozaicToken = await deployXMozaicToken(
    chainName, 
    mozaicTokenV2,
    ethers.utils.parseEther("1000"),
    18
  );
  
  let res = JSON.stringify({
      chainName: chainName,
      mozaicTokenV2: mozaicTokenV2,
      xMozaicToken: xMozaicToken,
  });
  fs.writeFileSync("deployTokensResult.json", res);
}
  
main()
  .then(() => process.exit(0))
  .catch((error) => {
      console.error(error);
      process.exit(1);
  });