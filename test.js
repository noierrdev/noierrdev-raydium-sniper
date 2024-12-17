require("dotenv").config()
const { Connection, Transaction, SystemProgram, Keypair, PublicKey, ComputeBudgetProgram, TransactionInstruction } = require("@solana/web3.js")
const {QUICClient}=require("@matrixai/quic")
const Logger=require('@matrixai/logger');
const peculiarWebcrypto =require('@peculiar/webcrypto');
const selfsigned=require("selfsigned")
const pems = selfsigned.generate([{name: 'commonName', value: 'Solana node'}, { name: "subjectAltName", value: [{ type: 7, value: "0.0.0.0" }]}], { days: 365, algorithm: 'ed25519', keySize: 2048 });
const connection=new Connection(process.env.RPC_API)
const PRIVATE_KEY =new  Uint8Array(JSON.parse(process.env.PRIVATE_KEY));
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);
const bs58=require("bs58")
const Client=require("@triton-one/yellowstone-grpc");
const { swapPumpfunWalletFastest } = require("./swap");
const { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } = require("@solana/spl-token");

const PUMPFUN_RAYDIUM_MIGRATION="39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"
const RAYDIUM_OPENBOOK_AMM="675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
const PUMPFUN_BONDINGCURVE="6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const RAYDIUM_AUTHORITY="5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const BSD_CONTRACT="BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW"
const MINT_CONTRACT="minTcHYRLVPubRK8nt6sqe2ZpWrGDLQoNLipDJCGocY"

const localConnection=new Connection('http://localhost:8899')

var test=true;

var quicClient;

var writeStream;

setTimeout(async () => {
    const leaderSchedule=await localConnection.getLeaderSchedule()
    var allNodes={};
    const clusterNodes=await localConnection.getClusterNodes();
    for(var oneNode of clusterNodes){
        if(leaderSchedule[oneNode.pubkey])
        allNodes[oneNode.pubkey]={...oneNode,slots : leaderSchedule[oneNode.pubkey]};
    }
    function connectSlotsGeyser(){
        const client =new Client.default("http://127.0.0.1:10000/",undefined,undefined);
        client.getVersion()
        .then(async version=>{
            try {
                console.log(version)
                const request =Client.SubscribeRequest.fromJSON({
                    accounts: {},
                    slots: {
                        new_slots:{
                            filterByCommitment:true
                        }
                    },
                    transactions: {},
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
                    
                    console.log(data)
                    const currentSlot=await localConnection.getSlotLeader("processed")
                    console.log(currentSlot)
                    const webscrypto=new peculiarWebcrypto.Crypto()
                    const logger=new Logger.default()
                    console.log(allNodes[currentSlot])
                    console.log("QUIC client initializing...")
                    QUICClient.createQUICClient({
                        logger:logger,
                        host:allNodes[currentSlot].tpuQuic.split(":")[0],
                        port:Number(allNodes[currentSlot].tpuQuic.split(":")[1]),
                        serverName:"server",
                        crypto: {
                            ops: {
                                randomBytes: async (data) => {
                                    webscrypto.getRandomValues(new Uint8Array(data));
                                },
                            },
                        },
                        config: {
                            key: pems.private,
                            cert: pems.cert,
                            verifyPeer: false,
                            applicationProtos: ['solana-tpu'],
                        },
                    }).then(async (client,signal)=>{
                        quicClient=client;

                        const clientStream = client.connection.newStream('uni');
                        const writer = clientStream.writable.getWriter();
                        writeStream=writer;
                        writer.write(Uint8Array.from([1,2,3,4]))
                        
                        await writer.close();
                        await client.destroy()
                        
                    })
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
    connectSlotsGeyser()
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
                            accountInclude: [PUMPFUN_BONDINGCURVE],
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
                        const transaction=data.transaction.transaction;
                        const sig=bs58.encode(data.transaction.transaction.signature)
                        const allAccounts=[];
                        var pumpfunProgramIndex
                        transaction.transaction.message.accountKeys.map((account,index)=>{
                            if(!account) return;
                            const accountID=bs58.encode(account);
                            if(accountID==PUMPFUN_BONDINGCURVE) pumpfunProgramIndex=index;
                            allAccounts.push(accountID);
                        })
                        const signers=[allAccounts[0]]
                        if(allAccounts.includes(PUMPFUN_BONDINGCURVE)){
                            if(transaction.meta.logMessages.includes("Program log: Instruction: InitializeMint2")){
                                if(!test) {
                                    console.log(`not testing!!!`)
                                    return;
                                }
                                test=false
                                var startTime=new Date();
                                const pumpfunInstructions=transaction.transaction.message.instructions.filter(instruction=>instruction.programIdIndex==pumpfunProgramIndex);
                                const createInstruction=pumpfunInstructions[0];
                                var buyInstruction;
                                if(pumpfunInstructions.length>1) buyInstruction=pumpfunInstructions[1];
                                const targetToken=allAccounts[createInstruction.accounts[0]];
                                const bondingCurve=allAccounts[createInstruction.accounts[2]];
                                const bondingCurveVault=allAccounts[createInstruction.accounts[3]];
                                // const bondingCurveSolBalance=await connection.getBalance(new PublicKey(bondingCurve));


                                const SOLBalanceChange=transaction.meta.postBalances[0]-transaction.meta.preBalances[0];

                                //extract Wrapped sol balance change
                                const userPreWSOLBalance=transaction.meta.preTokenBalances.find(ba=>((ba.mint==SOL_MINT_ADDRESS)&&(ba.owner==signers[0])));
                                const userPostWSOLBalance=transaction.meta.postTokenBalances.find(ba=>((ba.mint==SOL_MINT_ADDRESS)&&(ba.owner==signers[0])));
                                const WSOLBalChange=userPostWSOLBalance?(userPostWSOLBalance.uiTokenAmount.uiAmount-(userPreWSOLBalance?userPreWSOLBalance.uiTokenAmount.uiAmount:0)):(0-userPreWSOLBalance?userPreWSOLBalance.uiTokenAmount.uiAmount:0);

                                //Maybe not SOL token is spl meme token
                                const userPreTokenBalance=transaction.meta.preTokenBalances.find(ba=>((ba.mint!=SOL_MINT_ADDRESS)&&(ba.owner==signers[0])));
                                const userPostTokenBalance=transaction.meta.postTokenBalances.find(ba=>((ba.mint!=SOL_MINT_ADDRESS)&&(ba.owner==signers[0])));

                                if(!userPostTokenBalance) {
                                    console.log(`-------------------------------`)
                                    console.log(`DEV didn't buy his tokens!!!`)
                                    console.log(`-------------------------------`)
                                    return;
                                }
                                if(SOLBalanceChange<-3000000000){
                                    console.log(`-------------------------------`)
                                    console.log(`DEV bought too much!`)
                                    console.log(`-------------------------------`)
                                    return;
                                }
                                const nextLeaders=await localConnection.getSlotLeaders(Number(data.transaction.slot),2)
                                console.log(`https://solscan.io/tx/${sig}`)
                                
                                console.log({targetToken,bondingCurve,bondingCurveVault})
                                console.log(`https://solscan.io/account/${bondingCurve}`)
                                console.log(`https://photon-sol.tinyastro.io/en/lp/${bondingCurve}`)
                                // console.log(`${(bondingCurveSolBalance/(10**9)).toFixed(2)} Lamports`)
                                console.log(`${(SOLBalanceChange/(10**9)).toFixed(2)} SOLs wasted`)
                                console.log(`${(WSOLBalChange/(10**9)).toFixed(2)} WSOLs wasted`)
                                if(userPostTokenBalance) console.log(`${userPostTokenBalance.uiTokenAmount.uiAmount} Tokens bought`)


                                var buy=true
                                const MYTOKEN_MINT_ADDRESS = targetToken; // Replace with your token's mint address
                            
                                const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)
                                
                                const txObject = new Transaction(); 
                                txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000}));
                                const tokenATA = getAssociatedTokenAddressSync(
                                MYTOKEN_MINT_PUBKEY,
                                wallet.publicKey,
                                );
                                txObject.add(
                                createAssociatedTokenAccountInstruction(
                                    wallet.publicKey,
                                    tokenATA,
                                    wallet.publicKey,
                                    MYTOKEN_MINT_PUBKEY,
                                    TOKEN_PROGRAM_ID
                                ),
                                );
                                const amountbuffer = Buffer.alloc(8);
                                amountbuffer.writeBigInt64LE(BigInt(10000*(10**6)),0);
                            
                                const solAmountbuffer = Buffer.alloc(8);
                                solAmountbuffer.writeBigInt64LE(BigInt(10000000),0);                                
                                
                                const contractInstruction=new TransactionInstruction({
                                    keys:[
                                        //1
                                        {
                                        pubkey:new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),isSigner:false,isWritable:false
                                        },
                                        //2
                                        {
                                        pubkey:new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),isSigner:false,isWritable:true
                                        },
                                        //3
                                        {
                                        pubkey:MYTOKEN_MINT_PUBKEY,isSigner:false,isWritable:false
                                        },
                                        //4
                                        {
                                        pubkey:new PublicKey(bondingCurve),isSigner:false,isWritable:true
                                        }, 
                                        //5
                                        {
                                        pubkey:new PublicKey(bondingCurveVault),isSigner:false,isWritable:true
                                        }, 
                                        //6
                                        {
                                        pubkey:tokenATA,isSigner:false,isWritable:true
                                        },
                                        
                                        //7
                                        {
                                        pubkey:wallet.publicKey,isSigner:true,isWritable:true
                                        },
                                        
                                        //8
                                        {
                                        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
                                        },
                                        
                                        //9
                                        {
                                        pubkey:buy?TOKEN_PROGRAM_ID:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
                                        },
                                        
                                        //10
                                        {
                                        pubkey:buy?new PublicKey("SysvarRent111111111111111111111111111111111"):TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
                                        },
                                    
                                        //11
                                        {
                                        pubkey:new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),isSigner:false,isWritable:false
                                        },
                                        
                                        //12
                                        {
                                        pubkey:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),isSigner:false,isWritable:false
                                        },
                                
                                    ],
                                    programId:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
                                    data:buy?
                                    Buffer.from(`66063d1201daebea${amountbuffer.toString("hex")}${solAmountbuffer.toString("hex")}`,'hex')
                                    :
                                    Buffer.from(`33e685a4017f83ad${amountbuffer.toString("hex")}0000000000000000`,"hex")
                                });
                                txObject.add(contractInstruction);
                                txObject.feePayer = wallet.publicKey;
                                var latestBlock=await localConnection.getLatestBlockhash();
                                txObject.recentBlockhash=latestBlock.blockhash;
                                txObject.sign(wallet)
                                const rawTransaction=txObject.serialize();
                                
                                
                                for(var nextLeader of nextLeaders){
                                    console.log(allNodes[nextLeader.toBase58()])
                                    try {
                                        //Gossip communication
                                        const webscrypto=new peculiarWebcrypto.Crypto()
                                        const logger=new Logger.default()
                                        console.log(allNodes[nextLeader.toBase58()])
                                        console.log("QUIC client initializing...")
                                        
                                        QUICClient.createQUICClient({
                                            logger:logger,
                                            host:allNodes[nextLeader.toBase58()].tpuQuic.split(":")[0],
                                            port:Number(allNodes[nextLeader.toBase58()].tpuQuic.split(":")[1]),
                                            serverName:"server",
                                            crypto: {
                                                ops: {
                                                    randomBytes: async (data) => {
                                                        webscrypto.getRandomValues(new Uint8Array(data));
                                                    },
                                                },
                                            },
                                            config: {
                                                key: pems.private,
                                                cert: pems.cert,
                                                verifyPeer: false,
                                                applicationProtos: ['solana-tpu'],
                                            },
                                        }).then(async (client,signal)=>{
                                            // console.log(client)
                                            const clientStream = client.connection.newStream('uni');
                                            const writer = clientStream.writable.getWriter();
                                            
                                            
                                            writer.write(Uint8Array.from(rawTransaction ))
                                            .then(async ()=>{
                                                var endTime=new Date();
                                                console.log(`===========================`)
                                                console.log(`${endTime.getTime()-startTime.getTime()}`)
                                                console.log(`===========================`)
                                                await writer.close();
                                            })
                                            
                                        })
                                    } catch (error) {
                                        console.log(`=======ERROR=========`)
                                        console.log(error)
                                        console.log(`=====================`)
                                    }
                                }
                                
                            }
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
    // connectGeyser()
    
    
    
}, 0);