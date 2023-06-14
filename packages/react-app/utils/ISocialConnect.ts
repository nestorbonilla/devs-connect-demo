import { ethers } from "ethers";
import { AuthSigner } from "@celo/identity/lib/odis/query";
import { BlsBlindingClient } from "./bls-blinding-client";

interface ServiceContext {
    odisUrl: string;
    odisPubKey: string;
}

export interface ISocialConnect {
    children?: React.ReactNode

    //general
    issuerAddress: string;
    authSigner: AuthSigner;
    serviceContext: ServiceContext;
    quotaFee: ethers.BigNumber;
    blindingClient: BlsBlindingClient

    //contract
    federatedAttestationsContract: ethers.Contract;
    odisPaymentsContract: ethers.Contract;
    stableTokenContract: ethers.Contract;
}