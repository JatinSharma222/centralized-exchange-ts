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
        }
    })
