interface Fill {
  type: "fill";
  buyer: number;
  seller: number;
  price: number;
  qty: number;
}

interface OrderbookUpdate {
  type: "orderbook_update";
  userId: number;
  price: number;
  qty: number;
}

interface CancelResult {
  userId: number;
  side: "bid" | "ask";
  price: number;
  remainingQty: number;
}

export class Orderbook {
  private symbol: string;
  private orderbook: {
    bids: Map<
      string,
      {
        orders: {
          userId: number;
          qty: number;
          filledQty: number;
          orderId: number;
        }[];
      }
    >;
    asks: Map<
      string,
      {
        orders: {
          userId: number;
          qty: number;
          filledQty: number;
          orderId: number;
        }[];
      }
    >;
  };

  constructor(symbol: string) {
    this.symbol = symbol;
    this.orderbook = {
      bids: new Map(),
      asks: new Map(),
    };
  }

  addOrder(
    userId: number,
    type: "bid" | "ask",
    price: number,
    qty: number,
    orderId: number,
  ): (Fill | OrderbookUpdate)[] {
    let fills: (Fill | OrderbookUpdate)[] = [];
    if (type == "bid") {
      const askPrices = [...this.orderbook.asks.keys()].sort(
        (a: string, b: string) => Number(a) - Number(b),
      );

      let originalUserLeftQty = qty;
      for (let i = 0; i < askPrices.length; i++) {
        const bucketPrice = Number(askPrices[i]);
        if (price >= bucketPrice) {
          let individualOrders = this.orderbook.asks.get(
            bucketPrice.toString(),
          )!;
          const toRemove = new Set<number>();
          for (let j = 0; j < individualOrders?.orders.length; j++) {
            let sellerOrder = individualOrders?.orders[j]!;
            let leftQty = sellerOrder.qty - sellerOrder.filledQty;
            if (leftQty >= originalUserLeftQty) {
              const order = individualOrders.orders[j];
              if (!order) continue;
              order.filledQty += originalUserLeftQty;
              fills.push({
                type: "fill",
                buyer: userId,
                seller: individualOrders.orders[j]?.userId!,
                qty: originalUserLeftQty,
                price: bucketPrice,
              });

              originalUserLeftQty = 0;
              if (order.filledQty === order.qty) {
                individualOrders.orders = individualOrders.orders.filter(
                  (x) => x.orderId !== individualOrders?.orders[j]!.orderId,
                );
              }
              break;
            } else {
              fills.push({
                type: "fill",
                buyer: userId,
                seller: individualOrders.orders[j]?.userId!,
                qty: leftQty,
                price: bucketPrice,
              });
              originalUserLeftQty -= leftQty;
              toRemove.add(sellerOrder.orderId);
            }
          }

          if (toRemove.size > 0) {
            individualOrders.orders = individualOrders.orders.filter(
              (x) => !toRemove.has(x.orderId),
            );
          }

          if (individualOrders.orders.length === 0) {
            this.orderbook.asks.delete(bucketPrice.toString());
          }

          if (originalUserLeftQty == 0) {
            break;
          }
        } else {
          break;
        }
      }

      if (originalUserLeftQty) {
        if (!this.orderbook.bids.get(price.toString())) {
          // debuging
          console.log(price);
          console.log(price.toString());
          // debuging
          this.orderbook.bids.set(price.toString(), {
            orders: [],
          });
        }

        this.orderbook.bids.get(price.toString())?.orders.push({
          orderId,
          userId,
          qty,
          filledQty: qty - originalUserLeftQty,
        });

        fills.push({
          type: "orderbook_update",
          userId,
          price: price,
          qty: originalUserLeftQty,
        });
      }
    }

    if (type == "ask") {
      const bidPrices = [...this.orderbook.bids.keys()].sort(
        (a: string, b: string) => Number(b) - Number(a),
      );

      let originalUserLeftQty = qty;
      for (let i = 0; i < bidPrices.length; i++) {
        const bucketPrice = Number(bidPrices[i]);
        if (price <= bucketPrice) {
          let individualOrders = this.orderbook.bids.get(
            bucketPrice.toString(),
          )!;
          const toRemove = new Set<number>();
          for (let j = 0; j < individualOrders?.orders.length; j++) {
            let buyerOrder = individualOrders?.orders[j]!;
            let leftQty = buyerOrder.qty - buyerOrder.filledQty;
            if (leftQty >= originalUserLeftQty) {
              const order = individualOrders.orders[j];
              if (!order) continue;
              order.filledQty += originalUserLeftQty;
              fills.push({
                type: "fill",
                seller: userId,
                buyer: individualOrders.orders[j]?.userId!,
                qty: originalUserLeftQty,
                price: bucketPrice,
              });

              originalUserLeftQty = 0;
              if (order.filledQty === order.qty) {
                individualOrders.orders = individualOrders.orders.filter(
                  (x) => x.orderId !== individualOrders?.orders[j]!.orderId,
                );
              }
              break;
            } else {
              fills.push({
                type: "fill",
                seller: userId,
                buyer: individualOrders.orders[j]?.userId!,
                qty: leftQty,
                price: bucketPrice,
              });
              originalUserLeftQty -= leftQty;
              toRemove.add(buyerOrder.orderId);
            }
          }

          if (toRemove.size > 0) {
            individualOrders.orders = individualOrders.orders.filter(
              (x) => !toRemove.has(x.orderId),
            );
          }

          if (individualOrders.orders.length === 0) {
            this.orderbook.bids.delete(bucketPrice.toString());
          }

          if (originalUserLeftQty == 0) {
            break;
          }
        } else {
          break;
        }
      }

      if (originalUserLeftQty != 0) {
        if (!this.orderbook.asks.get(price.toString())) {
          this.orderbook.asks.set(price.toString(), {
            orders: [],
          });
        }

        this.orderbook.asks.get(price.toString())?.orders.push({
          orderId,
          userId,
          qty,
          filledQty: qty - originalUserLeftQty,
        });

        fills.push({
          type: "orderbook_update",
          userId,
          price: price,
          qty: originalUserLeftQty,
        });
      }
    }

    return fills;
  }

  cancelOrder(orderId: number, userId: number): CancelResult | null {
    for (const [priceKey, bucket] of this.orderbook.bids) {
      const order = bucket.orders.find((o) => o.orderId === orderId);
      if (order) {
        if (order.userId !== userId) return null;

        const remainingQty = order.qty - order.filledQty;
        bucket.orders = bucket.orders.filter((o) => o.orderId !== orderId);
        if (bucket.orders.length === 0) this.orderbook.bids.delete(priceKey);

        return {
          userId: order.userId,
          side: "bid",
          price: Number(priceKey),
          remainingQty,
        };
      }
    }

    for (const [priceKey, bucket] of this.orderbook.asks) {
      const order = bucket.orders.find((o) => o.orderId === orderId);
      if (order) {
        if (order.userId !== userId) return null;

        const remainingQty = order.qty - order.filledQty;
        bucket.orders = bucket.orders.filter((o) => o.orderId !== orderId);
        if (bucket.orders.length === 0) this.orderbook.asks.delete(priceKey);

        return {
          userId: order.userId,
          side: "ask",
          price: Number(priceKey),
          remainingQty,
        };
      }
    }

    return null;
  }
}