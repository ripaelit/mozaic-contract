import {Bridge, Factory, LPStaking, Pool, Router, StargateToken, LZEndpointMock, MozaicLP, MozaicVault, MozaicBridge } from '../../types/typechain';

export type StargateChainPath = {
  sourceChainId: number,
  sourcePoolId: number,
  destinationChainId: number,
  destinationPoolId: number,
  weight: number,
};

export interface StargateDeploymentOnchain {
  lzEndpoint: LZEndpointMock,
  routerContract: Router,
  factoryContract: Factory,
  bridgeContract: Bridge,
  lpStakingContract: LPStaking,
  pools: Map<number, Pool>,
  stargateToken: StargateToken,
};

export type MozaicDeployment = {
  mozaicLp: MozaicLP,
  mozaicVault: MozaicVault,
  mozaicBridge: MozaicBridge
};

export type StargateDeployments = Map<number, StargateDeploymentOnchain>; // Map<chainId, StargateDeploymentOnchain>

export type LayerZeroDeployments = Map<number, LZEndpointMock>;           // Map<chainId, ILayerZeroEndpoint>

export type StableCoinDeployments = Map<number, Map<string, string>>;      // Map<chainId, Map<coinName, coinAddress>>

export type MozaicDeployments = Map<number, MozaicDeployment>;

export enum ActionTypeEnum {
    Swap = 0,
    SwapRemote = 1,
    GetPriceMil = 2,
    StargateStake = 3,
    StargateUnstake = 4,
    GetStakedAmountLD = 5,
    GetTotalAssetsMD = 6,
}

export enum ProtocolStatus {
  IDLE = 0,
  SNAPSHOTTING = 1,
  OPTIMIZING = 2,
  SETTLING = 3,
}
