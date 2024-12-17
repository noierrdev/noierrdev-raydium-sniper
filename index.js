require("dotenv").config()

const {Connection, PublicKey, Keypair}=require("@solana/js")
const fs=require('fs')
const path=require('path')
const WebSocket = require('ws');
const { pumpfunSwapTransactionFaster, swapTokenAccounts, swapPumpfunFaster, swapTokenFastest, swapTokenFastestWallet, pumpfunSwapTransactionFasterWallet, swapTokenAccountsWallet, swapPumpfunFasterWallet, swapPumpfunFasterWalletStaked, swapPumpfunWalletFastest, swapPumpfunWalletFastestPercent, swapPumpfunWalletTokenFastest } = require("./swap");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const { getSwapMarket, getSwapMarketFaster } = require("./utils");
const Client=require("@triton-one/yellowstone-grpc");
const bs58=require("bs58")


const connection=new Connection(process.env.RPC_API);
const stakedConnection=new Connection(process.env.STAKED_RPC)

const PUMPFUN_RAYDIUM_MIGRATION="39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"
const RAYDIUM_OPENBOOK_AMM="675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
const PUMPFUN_BONDINGCURVE="6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const RAYDIUM_AUTHORITY="5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const BSD_CONTRACT="BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW"
const MINT_CONTRACT="minTcHYRLVPubRK8nt6sqe2ZpWrGDLQoNLipDJCGocY"

const PRIVATE_KEY =new  Uint8Array(JSON.parse(process.env.PRIVATE_KEY));
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

var allTrades={}

// var testing=true;

function connectGeyser(){
    const client =new Client.default("http://127.0.0.1:10000/",undefined,undefined);
    client.getVersion()
    .then(async version=>{
        try {
            console.log(version)
            const request =Client.SubscribeRequest.fromJSON({
                accounts: {},
                slots: {},
                transactions: {
                    pumpfun: {
                        vote: false,
                        failed: false,
                        signature: undefined,
                        accountInclude: [RAYDIUM_OPENBOOK_AMM],
                        accountExclude: [],
                        accountRequired: [],
                    },
                },
                transactionsStatus: {},
                entry: {},
                blocks: {},
                blocksMeta: {},
                accountsDataSlice: [],
                ping: undefined,
                commitment: Client.CommitmentLevel.PROCESSED
            })
        
            const stream =await client.subscribe();
            stream.on("data", async (data) => {
                if(data.transaction&&data.transaction.transaction&&data.transaction.transaction.signature) {
                    const sig=bs58.encode(data.transaction.transaction.signature)
                    const transaction=data.transaction.transaction;
                    if(transaction.meta.logMessages.some(log=>log.includes("InitializeMint")||log.includes("initialize2"))){
                        console.log("Initialized!!!")
                        console.log(`https://solscan.io/tx/${sig}`)
                        var raydiumPoolProgramIndex=0;
                        const allAccounts=[];
                        transaction.transaction.message.accountKeys.map((account,index)=>{
                            if(!account) return;
                            const accountID=bs58.encode(account);
                            allAccounts.push(accountID);
                            if(accountID==RAYDIUM_OPENBOOK_AMM){
                                raydiumPoolProgramIndex=index;
                            }
                        })
                        const swapInstruction = (transaction?.transaction.message.instructions).find(instruction =>instruction.programIdIndex==raydiumPoolProgramIndex);
                        if(!swapInstruction){
                            console.log("NO_SWAP_INSTRUCTION");
                            return;
                        }
                        const accounts=swapInstruction.accounts;
                        if (!accounts) {
                            console.log("No accounts found in the transaction.");
                            return;
                        }
                        console.log(`https://solscan.io/tx/${sig}`)
                        const tokenAIndex = 8;
                        const tokenBIndex = 9;
                        const lpMintIndex = 7;
                        const marketKeyIndex = 16;
                        if(!transaction.transaction.message.accountKeys[accounts[tokenAIndex]]) return;
                        if(!transaction.transaction.message.accountKeys[accounts[tokenBIndex]]) return;
                        if(!transaction.transaction.message.accountKeys[accounts[marketKeyIndex]]) return;
                        const tokenAAccount = bs58.encode(transaction.transaction.message.accountKeys[accounts[tokenAIndex]]);
                        const tokenBAccount = bs58.encode(transaction.transaction.message.accountKeys[accounts[tokenBIndex]]);
                        const marketAccountKey= bs58.encode(transaction.transaction.message.accountKeys[accounts[marketKeyIndex]]);
                        const targetToken=(tokenAAccount==SOL_MINT_ADDRESS)?tokenBAccount:tokenAAccount;
                        const quoted=(tokenAAccount==SOL_MINT_ADDRESS)?true:false;
                        var tokenInfoData=await connection.getParsedAccountInfo(new PublicKey(targetToken),"processed");
                        var timer=0;
                        if(!tokenInfoData.value) while(!tokenInfoData.value){
                            console.log(`NO TOKENINFO!!!`)
                            tokenInfoData=await connection.getParsedAccountInfo(new PublicKey(targetToken),"processed");;
                            timer++;
                            if(timer>100) break;
                        }
                        if(!tokenInfoData.value){
                            console.log("NO TOKEN INFO!!!");
                            return;
                        }
                        const tokenInfo=tokenInfoData.value.data.parsed.info;
                        if(tokenInfo.freezeAuthority) {
                            console.log("FROZEN From GEYSER!!!")
                            return;
                        }
                        if(tokenInfo.mintAuthority) {
                            console.log("NOT RENOUNCED FROM GEYSER!!!")
                            return;
                        }
                        console.log(tokenInfo)
                        console.log({targetToken,quoted})
                        var largestHoldersData=await connection.getTokenLargestAccounts(new PublicKey(targetToken),"processed");

                        const theLargestHolder=await connection.getParsedAccountInfo(largestHoldersData.value[0].address,"processed");
                        const theLargestOwner=theLargestHolder?.value?.data?.parsed?.info?.owner;
                        var dangerous=false;
                        if((theLargestOwner!="39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg")&&(theLargestOwner!="5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1")){
                            dangerous=true;
                            console.log("DANGEROUS!!!")
                            for(var oneHolder of largestHoldersData.value){
                                console.log(`${oneHolder.address.toBase58()} ${(oneHolder.uiAmount/(Number(tokenInfo.supply)/(10**(tokenInfo.decimals+2)))).toFixed(2)}%`)
                            }
                            // return;
                        }
                        
                        poolsFromPumpfun[bs58.encode(transaction.transaction.message.accountKeys[accounts[4]])]=targetToken;
                        var [baseMintAccount, quoteMintAccount,marketAccount] = await connection.getMultipleAccountsInfo([
                            new PublicKey(tokenAAccount),
                            new PublicKey(tokenBAccount),
                            new PublicKey(marketAccountKey),
                        ],"processed");
                        timer=0;
                        if(!baseMintAccount) while (!baseMintAccount) {
                            console.log("NO BASEMINT ACCOUNT!!!!")
                            baseMintAccount=await connection.getAccountInfo(new PublicKey(tokenAAccount));
                            timer++;
                            if(timer>100) break;
                        }
                        if(!baseMintAccount) return;
                        timer=0;
                        if(!quoteMintAccount) while (!quoteMintAccount) {
                            console.log("NO QUOTEMINT ACCOUNT!!!!")
                            quoteMintAccount=await connection.getAccountInfo(new PublicKey(tokenBAccount));
                            timer++;
                            if(timer>100) break;
                        }
                        if(!quoteMintAccount) return;
                        timer=0;
                        
                        if(!marketAccount) while (!marketAccount) {
                            console.log("NO MARKET ACCOUNT!!!!")
                            marketAccount=await connection.getAccountInfo(new PublicKey(marketAccountKey));
                            timer++;
                            if(timer>10000) break;
                        }
                        
                        var poolInfos;
                        if(marketAccount){
                            const baseMintInfo = SPL_MINT_LAYOUT.decode(baseMintAccount.data)
                            const quoteMintInfo = SPL_MINT_LAYOUT.decode(quoteMintAccount.data)
                            const marketInfo = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data)
                            poolInfos={
                                id: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[4]])),
                                baseMint: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[8]])),
                                quoteMint: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[9]])),
                                lpMint: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[7]])),
                                baseDecimals: baseMintInfo.decimals,
                                quoteDecimals: quoteMintInfo.decimals,
                                lpDecimals: baseMintInfo.decimals,
                                version: 4,
                                programId: new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",""),
                                authority: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[5]])),
                                openOrders: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[6]])),
                                targetOrders: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[12]])),
                                baseVault: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[10]])),
                                quoteVault: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[11]])),
                                withdrawQueue: PublicKey.default,
                                lpVault: PublicKey.default,
                                marketVersion: 3,
                                marketProgramId: marketAccount.owner,
                                marketId: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[16]])),
                                marketAuthority: Market.getAssociatedAuthority({ programId: marketAccount.owner, marketId: new PublicKey(bs58.encode(transaction.transaction.message.accountKeys[accounts[16]])) }).publicKey,
                                marketBaseVault: marketInfo.baseVault,
                                marketQuoteVault: marketInfo.quoteVault,
                                marketBids: marketInfo.bids,
                                marketAsks: marketInfo.asks,
                                marketEventQueue: marketInfo.eventQueue,
                            };
                        }
                        if(!poolInfos) {
                            console.log("NO_POOLINFO")
                            console.log({targetToken,quoted})
                            console.log(`https://solscan.io/tx/${sig}`)
                            return;
                        }
                        const solVault=(poolInfos.baseMint.toString()==SOL_MINT_ADDRESS)?poolInfos.baseVault:poolInfos.quoteVault;
                        var solAmount=0;
                        var solAmountTimer=0;
                        var solAmountData;
                        timer=0;
                        if(!solAmountData)
                        while(!solAmountData){
                            try {
                                solAmountData=await connection.getTokenAccountBalance(solVault,"processed");
                            } catch (error) {
                                
                            }
                            
                            timer++;
                            if(timer>100) break;
                        }
                        if(!solAmountData){
                            console.log("FAILED TO FETCH SOL AMOUNT");
                            return;
                        }
                        solAmount=solAmountData.value.uiAmount;
                        console.log({solAmount})
                    }

                }
            });
            await new Promise((resolve, reject) => {
                stream.write(request, (err) => {
                    if (err === null || err === undefined) {
                    resolve();
                    } else {
                    reject(err);
                    }
                });
            }).catch((reason) => {
                console.error(reason);
                throw reason;
            });
        } catch (error) {
            console.log(error)
            console.log("RECONNECTING!!!")
            setTimeout(() => {
                connectGeyser()
            }, 2000);
            
        }

    });
}
connectGeyser()