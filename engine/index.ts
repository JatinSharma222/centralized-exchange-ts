import { createClient } from "redis";

const client = createClient();
const sendClient = createClient();
sendClient.connect();

const usdBalances: Map<
    number,
    { available: number; locked: number }
> = new Map();

const stockBalances: Map<
    number,
    Map<string, { available: number; locked: number }>
> = new Map();


client.connect()
    .then(async () => {
        while(1) {
            const value = await client.brPop("engine-queue", 1000);
            if(!value){
                continue;
            }

            const parsedData = JSON.parse(value.element);

            if(parsedData.type == "onramp"){
                const userId = parsedData.payload.userId;
                if(!usdBalances.get(userId)) {
                    usdBalances.set(userId, {
                        available: 0,
                        locked: 0
                    });
                }

                usdBalances.get(userId)!.available += parsedData.payload.amount;
            }

            if(parsedData.type == "Deposit"){
                const userId = parsedData.payload.userId;
                const ticker = parsedData.payload.ticker;
                const qty = parsedData.payload.qty;

                if(!stockBalances.get(userId)) {
                    stockBalances.set(userId, new Map());
                }
                
                if(!stockBalances.get(userId)!.get(ticker)) {
                    stockBalances.get(userId)!.set(ticker, {
                        available: 0,
                        locked: 0
                    });
                }

                stockBalances.get(userId)!.get(ticker)!.available += qty;
            }

            if(parsedData.type == "get_balance") {
                const userId = parsedData.payload.userId;
                const balance = usdBalances.get(userId) || { available: 0, locked: 0 };
                
                const returnQueue = parsedData.queue;

                sendClient.lPush( returnQueue, JSON.stringify({ balance: balance, callbackId: parsedData.callbackId}));
            }
        }
    });