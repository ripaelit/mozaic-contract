import exportData from '../constants';

export const getChainIdFromChainName = (chainName: string) => {
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