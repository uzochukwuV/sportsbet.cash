import { ElectrumNetworkProvider, Output, SignatureTemplate, TransactionBuilder } from "cashscript";
import { hexToBin, vmNumberToBigInt } from "@bitauth/libauth";
import { Wallet, TestNetWallet } from "mainnet-js";
import { tokenId, collectionSize, payoutAddress, network } from "./mintingParams.ts";
import { generateContract } from "./generateContract.js";
import 'dotenv/config';

// Get seedphrase + addressDerivationPath for invoke-payout from .env file
const seedphrasePayout = process.env.SEEDPHRASE_PAYOUT as string;
const addressDerivationPath = process.env.DERIVATIONPATH_PAYOUT;

// Instantiate wallet
const walletClass = network == "mainnet" ? Wallet : TestNetWallet;
const wallet = await walletClass.fromSeed(seedphrasePayout, addressDerivationPath);
const signatureTemplate = new SignatureTemplate(wallet.privateKeyWif);

// Check if the right wallet is configured to invoke payouts
if (wallet.cashaddr != payoutAddress) throw new Error("Provided wallet does not match Payout wallet (addresses don't match)")

const contract = generateContract();
console.log('Total balance contracts:', await contract.getBalance());

const contractUtxos = await contract.getUtxos();

// Initialise a network provider for network operations
const provider = new ElectrumNetworkProvider(network);

for (const contractUtxo of contractUtxos) {
  // Filter UTXOs on smart contract address
  const isMintingUtxo = contractUtxo?.token?.category == tokenId && contractUtxo?.token?.nft?.capability == "minting";
  if (!isMintingUtxo) continue

  const payoutAmount = contractUtxo.satoshis - 2000n;
  if (payoutAmount < 1000) continue

  const contractCommitment = contractUtxo.token?.nft?.commitment as string
  const contractMintingState = vmNumberToBigInt(hexToBin(contractCommitment))
  if(typeof contractMintingState == "string") throw new Error("Error in vmNumberToBigInt")

  let newContractOutput: Output | undefined
  // Check commitment to see minting contract is ongoing
  if (contractMintingState < BigInt(collectionSize)){
    newContractOutput = {
      to: contract.address,
      amount: 1000n,
      token: contractUtxo.token
    };
  }

  const payoutOutput = { to: payoutAddress, amount: payoutAmount };

  try {
    const transactionBuilder = new TransactionBuilder({ provider })
    transactionBuilder.addInput(contractUtxo, contract.unlock.payout(signatureTemplate, signatureTemplate.getPublicKey()))
    // If mint is ongoing, need to recreate minting contract at payout
    if(newContractOutput) transactionBuilder.addOutput(newContractOutput);
    transactionBuilder.addOutput(payoutOutput);
    const { txid } = await transactionBuilder.send();
    console.log(`Payout transaction of ${payoutAmount} satoshis succesfully sent! \ntxid: ${txid}`);
  } catch (error) { console.log(error) }
}
