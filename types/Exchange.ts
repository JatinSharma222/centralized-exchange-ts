const ASSETS = ["USD", "BTC", "ETH", "SOL"] as const;
type Asset = typeof ASSETS[number];

type Balance = { available: number, locked: number};

type User = { id: number; username: string; password: string };

export {
    ASSETS,
    type Asset,
    type Balance,
    type User,
}