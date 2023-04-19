import exportData from '../constants';
const hre = require('hardhat');

export const getLzChainIdFromChainName = (chainName: string) => {
    let chains = exportData.testnetTestConstants.chains;
    let chainId = 0;
    for (const [_chainId, _chainName] of chains) {
        if (_chainName === chainName) {
            chainId = _chainId;
            break;
        }
    }
    return chainId;
}

export const globalChainIdFromLzChainId = (lzChainId: number) => {
    let chainId = exportData.testnetTestConstants.lzToGlobalChainIds.get(lzChainId)!;
    return chainId;
}

export const networkNameFromGlobalChainId = (globalChainId: number) => {
    let networkName = "";
    const networks = hre.config.networks;
    for (const network in networks) {
        if (networks[network].chainId == globalChainId) {
            networkName = network;
        }
    }
    return networkName;
}

export const switchNetwork = (chainId: number) => {
    // run the following code on the relevent network of chainId.
    // LayerZero chain id ---> global chain id
    const globalChainId = globalChainIdFromLzChainId(chainId);
    if (globalChainId) {
        // global chain id --> network name (by using hre.config.networks)
        const networkName = networkNameFromGlobalChainId(globalChainId);
        // switch to use the provider of the network
        hre.changeNetwork(networkName);
    }
}