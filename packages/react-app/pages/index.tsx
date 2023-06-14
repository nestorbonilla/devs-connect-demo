import { signIn, useSession, signOut} from "next-auth/react"
import Link from "next/link";
import { 
  ALFAJORES_CUSD_ADDRESS,
  ALFAJORES_RPC,
  FA_PROXY_ADDRESS,
  FA_CONTRACT,
  ODIS_PAYMENTS_PROXY_ADDRESS,
  ODIS_PAYMENTS_CONTRACT,
  STABLE_TOKEN_CONTRACT,
  ISSUER_PRIVATE_KEY,
  DEK_PRIVATE_KEY,
} from "@/utils/constants";
import { OdisUtils } from "@celo/identity";
import { AuthenticationMethod, AuthSigner, OdisContextName } from "@celo/identity/lib/odis/query";
import { ethers, Wallet } from "ethers";
import WebBlsBlindingClient, { BlsBlindingClient } from "@/utils/bls-blinding-client";
import { parseEther } from "viem";
import { LockOpenIcon, LockClosedIcon } from "@heroicons/react/24/outline";
import { useAccount, useSendTransaction } from "wagmi";
import { ISocialConnect } from "@/utils/ISocialConnect";
import { isMounted } from "@/hooks/useIsMounted";
import { useEffect, useState } from "react";
import { getObfuscatedIdentifier } from "@celo/identity/lib/odis/identifier";


export default function Home() {

    let iMounted = isMounted();

    let [sc, setSc] = useState<ISocialConnect>();

    //step 1- get the connected wallet address
    let {address} = useAccount();

    //step 2- session fro github and resolution of social identifier
    const { data: session } = useSession();
    let [socialIdentifier, setSocialIdentifier] = useState('');

    //step 3- identifier and address to send value
    let [identifierToSendTo, setIdentifierToSendTo] = useState("");
    let [addressToSendTo, setAddressToSendTo] = useState("");

    useEffect(() => {
      let provider = new ethers.providers.JsonRpcProvider(ALFAJORES_RPC);
      let issuer = new Wallet(ISSUER_PRIVATE_KEY!, provider);
      let serviceContext = OdisUtils.Query.getServiceContext(OdisContextName.ALFAJORES);
      let blindingClient = new WebBlsBlindingClient(serviceContext.odisPubKey);
      let quotaFee = ethers.utils.parseEther('0.01');
      let authSigner: AuthSigner = {
        authenticationMethod: AuthenticationMethod.ENCRYPTION_KEY,
        rawKey: DEK_PRIVATE_KEY!
      }; 
      let federatedAttestationsContract = new ethers.Contract(
        FA_PROXY_ADDRESS!,
        FA_CONTRACT.abi,
        issuer
      );
      let odisPaymentsContract = new ethers.Contract(
        ODIS_PAYMENTS_PROXY_ADDRESS!,
        ODIS_PAYMENTS_CONTRACT.abi,
        issuer
      );
      let stableTokenContract = new ethers.Contract(
        ALFAJORES_CUSD_ADDRESS!,
        STABLE_TOKEN_CONTRACT.abi,
        issuer
      );
      let sCVars: ISocialConnect = {
        issuerAddress: issuer.address,
        federatedAttestationsContract,
        odisPaymentsContract,
        stableTokenContract,
        authSigner,
        serviceContext,
        quotaFee,
        blindingClient
      };
      setSc(sCVars);
    }, [])

    useEffect(() => {
      // @ts-ignore: session was customized
      session && session?.user?.name && setSocialIdentifier(session?.user.name);
    }, [session]);

    let {sendTransaction} = useSendTransaction({
      to: addressToSendTo,
      value: parseEther("0.05", "wei")
    });

    async function checkAndTopUpODISQuota() {
      const { remainingQuota } = await OdisUtils.Quota.getPnpQuotaStatus(
        sc!.issuerAddress,
        sc!.authSigner,
        sc!.serviceContext
      );
  
      console.log("remaining ODIS quota", remainingQuota);
      if (remainingQuota < 1) {
        // give odis payment contract permission to use cUSD
        const currentAllowance = await sc!.stableTokenContract.allowance(
          sc!.issuerAddress,
          sc!.odisPaymentsContract.address
        );
        console.log("current allowance:", currentAllowance.toString());
        let enoughAllowance: boolean = false;
  
        if (sc!.quotaFee.gt(currentAllowance)) {
          const approvalTxReceipt = await sc!.stableTokenContract
            .increaseAllowance(
              sc!.odisPaymentsContract.address,
              sc!.quotaFee
            )
            .sendAndWaitForReceipt();
          console.log("approval status", approvalTxReceipt.status);
          enoughAllowance = approvalTxReceipt.status;
        } else {
          enoughAllowance = true;
        }
  
        // increase quota
        if (enoughAllowance) {
          const odisPayment = await sc!.odisPaymentsContract
            .payInCUSD(sc!.issuerAddress, sc!.quotaFee)
            .sendAndWaitForReceipt();
          console.log("odis payment tx status:", odisPayment.status);
          console.log("odis payment tx hash:", odisPayment.transactionHash);
        } else {
          throw "cUSD approval failed";
        }
      }
    }

    async function getObfuscatedIdentifier(identifier: string){
      let obfuscatedIdentifier = (
        await OdisUtils.Identifier.getObfuscatedIdentifier(
          identifier,
          OdisUtils.Identifier.IdentifierPrefix.TWITTER,
          sc!.issuerAddress,
          sc!.authSigner,
          sc!.serviceContext,
          undefined,
          undefined,
          sc!.blindingClient
        )
      ).obfuscatedIdentifier;
      return obfuscatedIdentifier;
    }

    async function registerAttestation(identifier: string, account: string) {
      await checkAndTopUpODISQuota();

      let nowTimeStamp = Math.floor(new Date().getTime() / 1000);
  
      // get identifier from phone number using ODIS
      let obfuscatedIdentifier = getObfuscatedIdentifier(identifier);
  
      // upload identifier <-> address mapping to onchain registry
      await sc!.federatedAttestationsContract.registerAttestationAsIssuer(
        obfuscatedIdentifier,
        account,
        nowTimeStamp
      );
    }

    async function lookupAddresses() {
      
      const obfuscatedIdentifier = getObfuscatedIdentifier(socialIdentifier);
  
      // query onchain mappings
      let attestations =
        await sc!.federatedAttestationsContract.lookupAttestations(obfuscatedIdentifier, [
          sc!.issuerAddress,
        ]);
        let [latestAddress] = attestations.accounts;
        setAddressToSendTo(latestAddress);
      return attestations.accounts;
    }

    async function deregisterIdentifier(identifier: string){
      try{
        let obfuscatedIdentifier = getObfuscatedIdentifier(identifier);
        await sc!.federatedAttestationsContract.revokeAttestation(obfuscatedIdentifier, sc!.issuerAddress, address);
      }catch(err){

      }
    }

    if(!iMounted) return null;
    
  
    let steps = [
      {
        id: 1,
        content: "User connection",
        active: !!address
      },
      {
        id: 2,
        content: "Verify identifier ownership",
        active: !!session
      },
      {
        id: 3,
        content: "Map identifier with connection address",
        active: !!address && !!session
      },
      {
        id: 4,
        content: "Send value through identifier",
        active: !!address && !!addressToSendTo
      },
      {
        id: 5,
        content: "De-register identifier from address",
        active: !!address && !!session
      }
    ]

    if (session) {
        return (
            <div>
              <section className='w-full flex-center flex-col'>
                <h1 className='head_text text-center'>
                    Discover & Reward Developers
                    <br className='max-md:hidden' />
                    <span className='orange_gradient text-center'>With SBT Tokens & Celo</span>
                </h1>
                <p className='desc text-center'>
                    Devs Connect is an ecosystem for developers to get discovered through Github and get rewarded with tokens after mapping github account with celo wallet address
                </p>
                <div className="mx-auto mt-5 flex max-w-fit space-x-4" >
                  <a href="" className="rounded-full border border-black bg-black px-5 py-2 text-sm text-white shadow-lg transition-all hover:bg-white hover:text-black">
                    Users
                  </a>
                  <Link href="/profile" className="flex items-center justify-center space-x-2 rounded-full border border-gray-300 bg-white px-5 py-2 shadow-lg transition-all hover:border-gray-800" target="_blank" rel="noreferrer">
                    
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24" className="h-5 w-5 text-black">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path>
                    </svg>
                    <p className="text-sm">{session?.user?.name}</p>
                    
                  </Link>
                 <button onClick={()=> signOut()}>sign out</button>
                  
                </div>
            </section>
            </div>
          )
    }
  
  return (
    <div>
      <section className='w-full flex-center flex-col'>
        <h1 className='head_text text-center'>
            Discover & Reward Developers
            <br className='max-md:hidden' />
            <span className='orange_gradient text-center'>With SBT Tokens & Celo</span>
        </h1>
        <p className='desc text-center'>
            Devs Connect is an ecosystem for developers to get discovered through Github and get rewarded with tokens after mapping github account with celo wallet address
        </p>
        <div className="mx-auto mt-5 flex max-w-fit space-x-4" >
          <a href="" className="rounded-full border border-black bg-black px-5 py-2 text-sm text-white shadow-lg transition-all hover:bg-white hover:text-black">
            Users
          </a>
          
          <button onClick={() => signIn()}>
          <a href="" className="flex items-center justify-center space-x-2 rounded-full border border-gray-300 bg-white px-5 py-2 shadow-lg transition-all hover:border-gray-800" target="_blank" rel="noreferrer" >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 24 24" className="h-5 w-5 text-black">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"></path>
          </svg>
          <p className="text-sm">Connect Github</p>
          </a>
          </button>
        </div>
    </section>
    </div>
  )
}
