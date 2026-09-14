import { createClient } from "redis";
import { Orderbook as OrderBook } from "./orderbook";

const client = createClient({ url: process.env.REDIS_URL });
const sendClient = createClient({ url: process.env.REDIS_URL });
sendClient.connect();

const usdBalances: Map<number, { available: number; locked: number }> =
  new Map();

const stockBalances: Map<number, Map<string, { available: number; locked: number }>> = new Map();

const orderbooks: Map<string, OrderBook> = new Map();
let nextOrderId = 1;

async function respond(queue: string | undefined, callbackId: string | undefined, payload: object) {
  if (!queue || !callbackId) return;
  await sendClient.lPush(queue, JSON.stringify({ callbackId, ...payload }));
}

client.connect().then(async () => {
  while (1) {
    const value = await client.brPop("engine-queue", 1);
    if (!value) {
      continue;
    }

    let parsedData;
    try {
    parsedData = JSON.parse(value.element);

    if (parsedData.type == "onramp") {
      const userId = parsedData.payload.userId;
      if (!usdBalances.get(userId)) {
        usdBalances.set(userId, {
          available: 0,
          locked: 0,
        });
      }

      usdBalances.get(userId)!.available += parsedData.payload.amount;

      await respond(parsedData.queue, parsedData.callbackId, { success: true });
    }

    if (parsedData.type == "Deposit") {
      const userId = parsedData.payload.userId;
      const asset = parsedData.payload.asset;
      const qty = parsedData.payload.qty;

      if (!stockBalances.get(userId)) {
        stockBalances.set(userId, new Map());
      }

      if (!stockBalances.get(userId)!.get(asset)) {
        stockBalances.get(userId)!.set(asset, {
          available: 0,
          locked: 0,
        });
      }

      stockBalances.get(userId)!.get(asset)!.available += qty;

      await respond(parsedData.queue, parsedData.callbackId, { success: true });
    }

    if (parsedData.type === "createOrder") {
      const { userId, order } = parsedData.payload;
      const { asset, side, price, qty } = order;

      const orderId = nextOrderId++;

      if (!orderbooks.has(asset)) {
        orderbooks.set(asset, new OrderBook(asset));
      }

      if (side === "bid") {
        const balance = usdBalances.get(userId) ?? {
          available: 0,
          locked: 0,
        };

        const requiredUsd = price * qty;

        if (balance.available < requiredUsd) {
          await respond(parsedData.queue, parsedData.callbackId, {
            error: "Insufficient USD balance",
          });
          continue;
        }

        balance.available -= requiredUsd;
        balance.locked += requiredUsd;
        usdBalances.set(userId, balance);
      } else {
        if (!stockBalances.has(userId)) {
          stockBalances.set(userId, new Map());
        }

        const userStocks = stockBalances.get(userId)!;
        const balance = userStocks.get(asset) ?? {
          available: 0,
          locked: 0,
        };

        if (balance.available < qty) {
          await respond(parsedData.queue, parsedData.callbackId, {
            error: "Insufficient asset balance",
          });
          continue;
        }

        balance.available -= qty;
        balance.locked += qty;
        userStocks.set(asset, balance);
      }

      const book = orderbooks.get(asset)!;
      const updates = book.addOrder(userId, side, price, qty, orderId);

      for (const update of updates) {
        if (update.type !== "fill") {
          continue;
        }

        const buyerUsd = usdBalances.get(update.buyer)!;
        const sellerUsd = usdBalances.get(update.seller) ?? {
          available: 0,
          locked: 0,
        };

        const buyerStocks = stockBalances.get(update.buyer) ?? new Map();
        const sellerStocks = stockBalances.get(update.seller) ?? new Map();

        const buyerStock = buyerStocks.get(asset) ?? {
          available: 0,
          locked: 0,
        };

        const sellerStock = sellerStocks.get(asset) ?? {
          available: 0,
          locked: 0,
        };

        const tradedValue = update.price * update.qty;

        buyerUsd.locked -= tradedValue;

        if (side === "bid") {
            const reservedValue = price * update.qty;
            buyerUsd.available += reservedValue - tradedValue;
        }

        buyerStocks.set(asset, {
            ...buyerStock,
            available: buyerStock.available + update.qty,
        });

        sellerStock.locked -= update.qty;
        sellerStocks.set(asset, sellerStock);

        sellerUsd.available += tradedValue;

        usdBalances.set(update.buyer, buyerUsd);
        usdBalances.set(update.seller, sellerUsd);
        stockBalances.set(update.buyer, buyerStocks);
        stockBalances.set(update.seller, sellerStocks);
      }

      await respond(parsedData.queue, parsedData.callbackId, { orderId, updates });
    }

    if (parsedData.type === "cancelOrder") {
      const { userId, orderId, asset } = parsedData.payload;

      let result = null;

      if (orderbooks.has(asset)) {
        const book = orderbooks.get(asset)!;
        result = book.cancelOrder(orderId, userId);

        if (result) {
          if (result.side === "bid") {
            const balance = usdBalances.get(result.userId);
            if (balance) {
              const refund = result.price * result.remainingQty;
              balance.locked -= refund;
              balance.available += refund;
            }
          } else {
            const stock = stockBalances.get(result.userId)?.get(asset);
            if (stock) {
              stock.locked -= result.remainingQty;
              stock.available += result.remainingQty;
            }
          }
        }
      }

      await respond(parsedData.queue, parsedData.callbackId, { canceled: !!result });
    }

    if (parsedData.type == "get_balance") {
      const userId = parsedData.payload.userId;
      const usd = usdBalances.get(userId) ?? { available: 0, locked: 0 };

      const stocksMap = stockBalances.get(userId) ?? new Map();
      const assets: Record<string, { available: number; locked: number }> = {};
      for (const [asset, bal] of stocksMap) {
        assets[asset] = bal;
      }

      const balance = { usd, assets };
      await respond(parsedData.queue, parsedData.callbackId, { balance });
    }
  } catch (err) {
    console.error("Failed to process message:", err);
    if (parsedData?.queue && parsedData?.callbackId) {
      await respond(parsedData.queue, parsedData.callbackId, {
        error: "Internal engine error",
      });
    }
  }
  }
});