import { test, expect, describe, beforeEach } from "bun:test";
import axios, { AxiosError } from "axios";

const BACKEND_URL = "http://localhost:3000";

// Reset all engine in-memory state before each test to prevent orderbook
// contamination (e.g., a resting ask from test A matching a bid in test B).
beforeEach(async () => {
    await axios.post(`${BACKEND_URL}/reset`).catch(() => {});
});


async function createUserAndSignin(username?: string, password = "testpassword123") {
    const uname = username ?? "user_" + Math.random().toString(36).slice(2);
    await axios.post(`${BACKEND_URL}/signup`, { username: uname, password });
    const signinRes = await axios.post(`${BACKEND_URL}/signin`, { username: uname, password });
    return { username: uname, password, token: signinRes.data.token as string };
}

function authHeader(token: string) {
    return { headers: { Authorization: `Bearer ${token}` } };
}

async function deposit(token: string, asset: string, qty: number) {
    return axios.post(`${BACKEND_URL}/deposit`, { asset, qty }, authHeader(token));
}

async function onramp(token: string, qty: number) {
    return axios.post(`${BACKEND_URL}/onramp`, { qty }, authHeader(token));
}

async function getBalance(token: string) {
    return axios.get(`${BACKEND_URL}/balance`, authHeader(token));
}

type BalanceResponse = {
    data: {
        usd: { available: number; locked: number };
        assets: Record<string, { available: number; locked: number }>;
    };
};

async function placeOrder(
    token: string,
    order: { side: "bid" | "ask"; qty: number; price: number; asset: string }
) {
    return axios.post(
        `${BACKEND_URL}/order`,
        { type: "limit", ...order },
        authHeader(token)
    );
}

function expectStatus(err: unknown, status: number) {
    const error = err as AxiosError;
    expect(error.response?.status).toBe(status);
}

describe("POST /signup", () => {
    test("creates a new user", async () => {
        const res = await axios.post(`${BACKEND_URL}/signup`, {
            username: "signup_" + Math.random(),
            password: "123123",
        });

        expect(res.status).toBe(201);
        expect(res.data.message).toBe("Successfully signed up");
    });

    test("rejects a duplicate username", async () => {
        const username = "dup_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, { username, password: "pass1" });

        try {
            await axios.post(`${BACKEND_URL}/signup`, { username, password: "pass2" });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 409);
        }
    });

    test("allows independent users to sign up concurrently", async () => {
        const [res1, res2] = await Promise.all([
            axios.post(`${BACKEND_URL}/signup`, { username: "a_" + Math.random(), password: "abc" }),
            axios.post(`${BACKEND_URL}/signup`, { username: "b_" + Math.random(), password: "abc" }),
        ]);

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);
    });
});

describe("POST /signin", () => {
    test("returns a token for valid credentials", async () => {
        const username = "signin_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, { username, password: "mypass" });

        const res = await axios.post(`${BACKEND_URL}/signin`, { username, password: "mypass" });

        expect(res.status).toBe(200);
        expect(typeof res.data.token).toBe("string");
        expect(res.data.token.length).toBeGreaterThan(0);
    });

    test("rejects an incorrect password", async () => {
        const username = "badpass_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, { username, password: "correct" });

        try {
            await axios.post(`${BACKEND_URL}/signin`, { username, password: "wrong" });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 401);
        }
    });

    test("rejects a non-existent user", async () => {
        try {
            await axios.post(`${BACKEND_URL}/signin`, {
                username: "missing_" + Math.random(),
                password: "anything",
            });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 401);
        }
    });
});

describe("auth middleware", () => {
    test("rejects requests with no Authorization header", async () => {
        try {
            await axios.get(`${BACKEND_URL}/balance`);
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });

    test("rejects an invalid token", async () => {
        try {
            await axios.get(`${BACKEND_URL}/balance`, {
                headers: { Authorization: "Bearer invalidtoken" },
            });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });

    test("rejects a token signed with a different secret", async () => {
        const forged =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJzdWIiOjEsImV4cCI6OTk5OTk5OTk5OX0." +
            "invalidsignature";

        try {
            await axios.get(`${BACKEND_URL}/balance`, authHeader(forged));
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });

    test("rejects a malformed Authorization header", async () => {
        const { token } = await createUserAndSignin();

        try {
            await axios.get(`${BACKEND_URL}/balance`, {
                headers: { Authorization: token },
            });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });
});

describe("GET /balance", () => {
    test("a new user has zero balance and no assets", async () => {
        const { token } = await createUserAndSignin();
        const res = await getBalance(token);

        expect(res.status).toBe(200);
        expect(res.data.usd.available).toBe(0);
        expect(Object.keys(res.data.assets).length).toBe(0);
    });

    test("reflects onramp deposits", async () => {
        const { token } = await createUserAndSignin();
        await onramp(token, 250);

        const res = await getBalance(token);
        expect(res.data.usd.available).toBe(250);
    });

    test("reflects asset deposits", async () => {
        const { token } = await createUserAndSignin();
        await deposit(token, "sol", 10);

        const res = await getBalance(token);
        expect(res.data.assets.sol.available).toBe(10);
        expect(res.data.assets.sol.locked).toBe(0);
    });

    test("each user only sees their own balance", async () => {
        const user1 = await createUserAndSignin();
        const user2 = await createUserAndSignin();

        await onramp(user1.token, 500);
        await onramp(user2.token, 100);

        const bal1 = await getBalance(user1.token);
        const bal2 = await getBalance(user2.token);

        expect(bal1.data.usd.available).toBe(500);
        expect(bal2.data.usd.available).toBe(100);
    });
});

describe("POST /onramp", () => {
    test("adds USD to the user's balance", async () => {
        const { token } = await createUserAndSignin();
        const res = await onramp(token, 100);

        expect(res.status).toBe(200);
        const bal = await getBalance(token);
        expect(bal.data.usd.available).toBe(100);
    });

    test("accumulates across multiple calls", async () => {
        const { token } = await createUserAndSignin();
        await onramp(token, 50);
        await onramp(token, 75);
        await onramp(token, 25);

        const bal = await getBalance(token);
        expect(bal.data.usd.available).toBe(150);
    });

    test("rejects unauthenticated requests", async () => {
        try {
            await axios.post(`${BACKEND_URL}/onramp`, { qty: 100 });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });
});

describe("POST /deposit", () => {
    test("deposits an asset", async () => {
        const { token } = await createUserAndSignin();
        const res = await deposit(token, "sol", 5);

        expect(res.status).toBe(200);
        const bal = await getBalance(token);
        expect(bal.data.assets.sol.available).toBe(5);
        expect(bal.data.assets.sol.locked).toBe(0);
    });

    test("accumulates deposits of the same asset", async () => {
        const { token } = await createUserAndSignin();
        await deposit(token, "sol", 3);
        await deposit(token, "sol", 7);

        const bal = await getBalance(token);
        expect(bal.data.assets.sol.available).toBe(10);
    });

    test("tracks different assets separately", async () => {
        const { token } = await createUserAndSignin();
        await deposit(token, "sol", 4);
        await deposit(token, "eth", 6);

        const bal = await getBalance(token);
        expect(bal.data.assets.sol.available).toBe(4);
        expect(bal.data.assets.eth.available).toBe(6);
    });

    test("rejects unauthenticated requests", async () => {
        try {
            await axios.post(`${BACKEND_URL}/deposit`, { asset: "sol", qty: 1 });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });
});

describe("POST /order", () => {
    describe("bid orders", () => {
        test("rejects a bid with insufficient USD", async () => {
            const { token } = await createUserAndSignin();

            try {
                await placeOrder(token, { side: "bid", qty: 1, price: 100, asset: "sol" });
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });

        test("accepts a bid backed by exactly enough USD", async () => {
            const { token } = await createUserAndSignin();
            await onramp(token, 500);

            const res = await placeOrder(token, { side: "bid", qty: 5, price: 100, asset: "sol" });
            expect(res.status).toBe(200);
        });

        test("locks USD when a bid rests on an empty book", async () => {
            const { token } = await createUserAndSignin();
            await onramp(token, 1000);
            await placeOrder(token, { side: "bid", qty: 2, price: 50, asset: "sol" });

            const bal = await getBalance(token);
            expect(bal.data.usd.available).toBe(1000 - 2 * 50);
        });
    });

    describe("ask orders", () => {
        test("rejects an ask with insufficient stock", async () => {
            const { token } = await createUserAndSignin();

            try {
                await placeOrder(token, { side: "ask", qty: 1, price: 100, asset: "sol" });
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });

        test("accepts an ask backed by sufficient stock", async () => {
            const { token } = await createUserAndSignin();
            await deposit(token, "sol", 10);

            const res = await placeOrder(token, { side: "ask", qty: 5, price: 200, asset: "sol" });
            expect(res.status).toBe(200);
        });
    });

    describe("order matching", () => {
        test("a matching bid and ask transfer stock and USD between users", async () => {
            const seller = await createUserAndSignin();
            await deposit(seller.token, "sol", 10);
            await placeOrder(seller.token, { side: "ask", qty: 5, price: 100, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 1000);
            await placeOrder(buyer.token, { side: "bid", qty: 5, price: 100, asset: "sol" });

            const buyerBal = await getBalance(buyer.token);
            expect(buyerBal.data.usd.available).toBe(500);
            expect(buyerBal.data.assets.sol.available).toBe(5);

            const sellerBal = await getBalance(seller.token);
            expect(sellerBal.data.usd.available).toBe(500);
        });

        test("a smaller bid partially fills a larger resting ask", async () => {
            const seller = await createUserAndSignin();
            await deposit(seller.token, "sol", 20);
            await placeOrder(seller.token, { side: "ask", qty: 10, price: 50, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 500);
            await placeOrder(buyer.token, { side: "bid", qty: 3, price: 50, asset: "sol" });

            const buyerBal = await getBalance(buyer.token);
            expect(buyerBal.data.usd.available).toBe(500 - 3 * 50);
            expect(buyerBal.data.assets.sol.available).toBe(3);
        });

        test("a bid fills at the resting ask price, not its own limit price", async () => {
            const seller = await createUserAndSignin();
            await deposit(seller.token, "sol", 10);
            await placeOrder(seller.token, { side: "ask", qty: 2, price: 80, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 1000);
            await placeOrder(buyer.token, { side: "bid", qty: 2, price: 100, asset: "sol" });

            const buyerBal = await getBalance(buyer.token);
            expect(buyerBal.data.usd.available).toBe(1000 - 2 * 80);
            expect(buyerBal.data.assets.sol.available).toBe(2);
        });

        test("no match occurs when the bid price is below the ask price", async () => {
            const seller = await createUserAndSignin();
            await deposit(seller.token, "sol", 10);
            await placeOrder(seller.token, { side: "ask", qty: 5, price: 200, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 1000);
            await placeOrder(buyer.token, { side: "bid", qty: 2, price: 100, asset: "sol" });

            const buyerBal = await getBalance(buyer.token);
            expect(buyerBal.data.usd.available).toBe(800);
            expect(buyerBal.data.assets.sol).toBeUndefined();
        });

        test("a bid walks multiple ask price levels, cheapest first", async () => {
            const seller = await createUserAndSignin();
            await deposit(seller.token, "sol", 20);
            await placeOrder(seller.token, { side: "ask", qty: 5, price: 90, asset: "sol" });
            await placeOrder(seller.token, { side: "ask", qty: 5, price: 100, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 10000);
            await placeOrder(buyer.token, { side: "bid", qty: 8, price: 100, asset: "sol" });

            const buyerBal = await getBalance(buyer.token);
            expect(buyerBal.data.usd.available).toBe(10000 - (5 * 90 + 3 * 100));
            expect(buyerBal.data.assets.sol.available).toBe(8);
        });

        test("an ask walks multiple bid price levels, richest first", async () => {
            const buyer1 = await createUserAndSignin();
            await onramp(buyer1.token, 1000);
            await placeOrder(buyer1.token, { side: "bid", qty: 4, price: 110, asset: "eth" });

            const buyer2 = await createUserAndSignin();
            await onramp(buyer2.token, 1000);
            await placeOrder(buyer2.token, { side: "bid", qty: 4, price: 100, asset: "eth" });

            const seller = await createUserAndSignin();
            await deposit(seller.token, "eth", 6);
            await placeOrder(seller.token, { side: "ask", qty: 6, price: 90, asset: "eth" });

            const buyer1Bal = await getBalance(buyer1.token);
            const buyer2Bal = await getBalance(buyer2.token);

            expect(buyer1Bal.data.assets.eth.available).toBe(4);
            expect(buyer1Bal.data.usd.available).toBe(1000 - 4 * 110);

            expect(buyer2Bal.data.assets.eth.available).toBe(2);
            // buyer2 bid 4 ETH @ $100 ($400 locked); only 2 were filled → $200 spent,
            // but the remaining 2-ETH resting bid still locks $200.
            expect(buyer2Bal.data.usd.available).toBe(600); // 1000 - 400 (locked at bid time)
            expect(buyer2Bal.data.usd.locked).toBe(200);    // unfilled 2 ETH @ $100 still resting
        });

        test("resting orders at the same price fill in time priority", async () => {
            const sellerA = await createUserAndSignin();
            await deposit(sellerA.token, "sol", 5);
            await placeOrder(sellerA.token, { side: "ask", qty: 5, price: 50, asset: "sol" });

            const sellerB = await createUserAndSignin();
            await deposit(sellerB.token, "sol", 5);
            await placeOrder(sellerB.token, { side: "ask", qty: 5, price: 50, asset: "sol" });

            const buyer = await createUserAndSignin();
            await onramp(buyer.token, 1000);
            await placeOrder(buyer.token, { side: "bid", qty: 5, price: 50, asset: "sol" });

            const sellerABal = await getBalance(sellerA.token);
            const sellerBBal = await getBalance(sellerB.token);

            expect(sellerABal.data.usd.available).toBe(250);
            expect(sellerBBal.data.usd.available).toBe(0);
        });
    });

    describe("input validation", () => {
        test("rejects negative quantity", async () => {
            const { token } = await createUserAndSignin();
            await onramp(token, 1000);

            try {
                await placeOrder(token, { side: "bid", qty: -5, price: 100, asset: "sol" });
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });

        test("rejects zero quantity", async () => {
            const { token } = await createUserAndSignin();
            await onramp(token, 1000);

            try {
                await placeOrder(token, { side: "bid", qty: 0, price: 100, asset: "sol" });
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });

        test("rejects negative price", async () => {
            const { token } = await createUserAndSignin();
            await onramp(token, 1000);

            try {
                await placeOrder(token, { side: "bid", qty: 1, price: -10, asset: "sol" });
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });

        test("rejects missing required fields", async () => {
            const { token } = await createUserAndSignin();

            try {
                await axios.post(
                    `${BACKEND_URL}/order`,
                    { side: "bid", qty: 1 },
                    authHeader(token)
                );
                throw new Error("expected request to fail");
            } catch (err) {
                expectStatus(err, 400);
            }
        });
    });

    test("rejects unauthenticated requests", async () => {
        try {
            await axios.post(`${BACKEND_URL}/order`, {
                type: "limit",
                side: "bid",
                qty: 1,
                price: 100,
                asset: "sol",
            });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });
});

describe("POST /cancel_order", () => {
    test("cancels a resting bid and refunds locked USD", async () => {
        const { token } = await createUserAndSignin();
        await onramp(token, 1000);

        const order = await placeOrder(token, { side: "bid", qty: 5, price: 100, asset: "sol" });
        const before = await getBalance(token);
        expect(before.data.usd.available).toBe(500);

        const cancel = await axios.post(
            `${BACKEND_URL}/cancel_order`,
            { orderId: order.data.orderId, asset: "sol" },
            authHeader(token)
        );
        expect(cancel.status).toBe(200);

        const after = await getBalance(token);
        expect(after.data.usd.available).toBe(1000);
    });

    test("cancels a resting ask and refunds locked stock", async () => {
        const { token } = await createUserAndSignin();
        await deposit(token, "sol", 10);

        const order = await placeOrder(token, { side: "ask", qty: 6, price: 200, asset: "sol" });
        const before = await getBalance(token);
        expect(before.data.assets.sol.available).toBe(4);
        expect(before.data.assets.sol.locked).toBe(6);

        await axios.post(
            `${BACKEND_URL}/cancel_order`,
            { orderId: order.data.orderId, asset: "sol" },
            authHeader(token)
        );

        const after = await getBalance(token);
        expect(after.data.assets.sol.available).toBe(10);
        expect(after.data.assets.sol.locked).toBe(0);
    });

    test("refunds only the remaining quantity of a partially-filled order", async () => {
        const seller = await createUserAndSignin();
        await deposit(seller.token, "sol", 10);
        const order = await placeOrder(seller.token, { side: "ask", qty: 10, price: 100, asset: "sol" });

        const buyer = await createUserAndSignin();
        await onramp(buyer.token, 1000);
        await placeOrder(buyer.token, { side: "bid", qty: 4, price: 100, asset: "sol" });

        const mid = await getBalance(seller.token);
        expect(mid.data.assets.sol.available).toBe(0);
        expect(mid.data.assets.sol.locked).toBe(6);

        await axios.post(
            `${BACKEND_URL}/cancel_order`,
            { orderId: order.data.orderId, asset: "sol" },
            authHeader(seller.token)
        );

        const after = await getBalance(seller.token);
        expect(after.data.assets.sol.locked).toBe(0);
        expect(after.data.assets.sol.available).toBe(6);
    });

    test("returns 404 when canceling an already fully-filled order", async () => {
        const seller = await createUserAndSignin();
        await deposit(seller.token, "sol", 10);
        const order = await placeOrder(seller.token, { side: "ask", qty: 5, price: 100, asset: "sol" });

        const buyer = await createUserAndSignin();
        await onramp(buyer.token, 1000);
        await placeOrder(buyer.token, { side: "bid", qty: 5, price: 100, asset: "sol" });

        try {
            await axios.post(
                `${BACKEND_URL}/cancel_order`,
                { orderId: order.data.orderId, asset: "sol" },
                authHeader(seller.token)
            );
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 404);
        }
    });

    test("returns 404 when a different user attempts to cancel the order", async () => {
        const owner = await createUserAndSignin();
        await onramp(owner.token, 1000);
        const order = await placeOrder(owner.token, { side: "bid", qty: 5, price: 100, asset: "sol" });

        const attacker = await createUserAndSignin();

        try {
            await axios.post(
                `${BACKEND_URL}/cancel_order`,
                { orderId: order.data.orderId, asset: "sol" },
                authHeader(attacker.token)
            );
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 404);
        }

        const ownerBal = await getBalance(owner.token);
        expect(ownerBal.data.usd.available).toBe(500);
    });

    test("returns 404 for a non-existent orderId", async () => {
        const { token } = await createUserAndSignin();

        try {
            await axios.post(
                `${BACKEND_URL}/cancel_order`,
                { orderId: 999999999, asset: "sol" },
                authHeader(token)
            );
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 404);
        }
    });

    test("rejects unauthenticated requests", async () => {
        try {
            await axios.post(`${BACKEND_URL}/cancel_order`, { orderId: 1, asset: "sol" });
            throw new Error("expected request to fail");
        } catch (err) {
            expectStatus(err, 400);
        }
    });
});

describe("concurrency", () => {
    test("concurrent onramps for the same user are all applied", async () => {
        const { token } = await createUserAndSignin();

        await Promise.all(Array.from({ length: 10 }, () => onramp(token, 10)));

        const bal = await getBalance(token);
        expect(bal.data.usd.available).toBe(100);
    });

    test("concurrent bids for the same scarce ask never over-fill it", async () => {
        const seller = await createUserAndSignin();
        await deposit(seller.token, "sol", 5);
        await placeOrder(seller.token, { side: "ask", qty: 5, price: 100, asset: "sol" });

        const buyers = await Promise.all(Array.from({ length: 5 }, () => createUserAndSignin()));
        await Promise.all(buyers.map((b) => onramp(b.token, 1000)));
        await Promise.all(
            buyers.map((b) => placeOrder(b.token, { side: "bid", qty: 5, price: 100, asset: "sol" }))
        );

        const balances: BalanceResponse[] = await Promise.all(buyers.map((b) => getBalance(b.token)));
        const totalReceived = balances.reduce(
            (sum: number, b) => sum + (b.data.assets.sol?.available ?? 0),
            0
        );

        expect(totalReceived).toBeLessThanOrEqual(5);
    });
});