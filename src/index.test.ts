// Bun provides this module at runtime, but TypeScript may not have Bun's type declarations installed.
// @ts-expect-error bun:test is resolved by the Bun test runner.
import { test, expect, describe, beforeAll } from "bun:test";
import axios, { AxiosError } from "axios";

const BACKEND_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Helper: create a fresh user and return { username, password, token }
// ---------------------------------------------------------------------------
async function createUserAndSignin(
    username?: string,
    password = "testpassword123"
) {
    const uname = username ?? "user_" + Math.random().toString(36).slice(2);
    await axios.post(`${BACKEND_URL}/signup`, {
        username: uname,
        password,
    });
    const signinRes = await axios.post(`${BACKEND_URL}/signin`, {
        username: uname,
        password,
    });
    return { username: uname, password, token: signinRes.data.token as string };
}

function authHeader(token: string) {
    return { headers: { Authorization: `Bearer ${token}` } };
}

// ===========================================================================
//  POST /signup
// ===========================================================================
describe("POST /signup", () => {
    test("should sign up a new user successfully", async () => {
        const username = "signup_test_" + Math.random();
        const res = await axios.post(`${BACKEND_URL}/signup`, {
            username,
            password: "123123",
        });

        expect(res.status).toBe(200);
        expect(res.data.message).toBe("Successfully signed up");
    });

    test("should reject duplicate username with 401", async () => {
        const username = "dup_user_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, {
            username,
            password: "pass1",
        });

        try {
            await axios.post(`${BACKEND_URL}/signup`, {
                username,
                password: "pass2",
            });
            // If we reach here the test should fail
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(401);
            expect(error.response?.data?.message).toBe("User already");
        }
    });

    test("multiple different users can sign up independently", async () => {
        const res1 = await axios.post(`${BACKEND_URL}/signup`, {
            username: "multi_a_" + Math.random(),
            password: "abc",
        });
        const res2 = await axios.post(`${BACKEND_URL}/signup`, {
            username: "multi_b_" + Math.random(),
            password: "abc",
        });
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
    });
});

// ===========================================================================
//  POST /signin
// ===========================================================================
describe("POST /signin", () => {
    test("should return a JWT token on valid credentials", async () => {
        const username = "signin_ok_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, {
            username,
            password: "mypass",
        });

        const res = await axios.post(`${BACKEND_URL}/signin`, {
            username,
            password: "mypass",
        });

        expect(res.status).toBe(200);
        expect(typeof res.data.token).toBe("string");
        expect(res.data.token.length).toBeGreaterThan(0);
    });

    test("should reject wrong password with 401", async () => {
        const username = "signin_bad_pass_" + Math.random();
        await axios.post(`${BACKEND_URL}/signup`, {
            username,
            password: "correct",
        });

        try {
            await axios.post(`${BACKEND_URL}/signin`, {
                username,
                password: "wrong",
            });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(401);
            expect(error.response?.data?.message).toBe("Incorrect credentials");
        }
    });

    test("should reject non-existent user with 401", async () => {
        try {
            await axios.post(`${BACKEND_URL}/signin`, {
                username: "does_not_exist_" + Math.random(),
                password: "anything",
            });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(401);
            expect(error.response?.data?.message).toBe("Incorrect credentials");
        }
    });
});

// ===========================================================================
//  Auth Middleware
// ===========================================================================
describe("Auth Middleware", () => {
    test("should reject requests without Authorization header", async () => {
        try {
            await axios.get(`${BACKEND_URL}/balance`);
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(400);
            expect(error.response?.data?.message).toBe(
                "Invalid or missing token"
            );
        }
    });

    test("should reject requests with an invalid token", async () => {
        try {
            await axios.get(`${BACKEND_URL}/balance`, {
                headers: { Authorization: "Bearer invalidtokenxyz" },
            });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(400);
            expect(error.response?.data?.message).toBe(
                "Invalid or missing token"
            );
        }
    });

    test("should reject requests with empty Bearer token", async () => {
        try {
            await axios.get(`${BACKEND_URL}/balance`, {
                headers: { Authorization: "Bearer " },
            });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError<{ message: string }>;
            expect(error.response?.status).toBe(400);
        }
    });
});

// ===========================================================================
//  GET /balance
// ===========================================================================
describe("GET /balance", () => {
    test("new user should have 0 usdBalance and empty stockBalances", async () => {
        const { token } = await createUserAndSignin();

        const res = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));

        expect(res.status).toBe(200);
        expect(res.data.usdBalance).toBe(0);
        expect(res.data.stockBalances).toBeDefined();
        expect(Object.keys(res.data.stockBalances).length).toBe(0);
    });

    test("balance should reflect onramp deposits", async () => {
        const { token } = await createUserAndSignin();

        await axios.post(`${BACKEND_URL}/onramp`, { qty: 250 }, authHeader(token));

        const res = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));

        expect(res.data.usdBalance).toBe(250);
    });

    test("balance should reflect stock deposits", async () => {
        const { token } = await createUserAndSignin();

        await axios.post(
            `${BACKEND_URL}/deposit/sol`,
            { qty: 10 },
            authHeader(token)
        );

        const res = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));

        expect(res.data.stockBalances["sol"]).toBeDefined();
        expect(res.data.stockBalances["sol"].available).toBe(10);
        expect(res.data.stockBalances["sol"].locked).toBe(0);
    });

    test("each user should see their own balance only", async () => {
        const user1 = await createUserAndSignin();
        const user2 = await createUserAndSignin();

        await axios.post(`${BACKEND_URL}/onramp`, { qty: 500 }, authHeader(user1.token));
        await axios.post(`${BACKEND_URL}/onramp`, { qty: 100 }, authHeader(user2.token));

        const bal1 = await axios.get(`${BACKEND_URL}/balance`, authHeader(user1.token));
        const bal2 = await axios.get(`${BACKEND_URL}/balance`, authHeader(user2.token));

        expect(bal1.data.usdBalance).toBe(500);
        expect(bal2.data.usdBalance).toBe(100);
    });
});

// ===========================================================================
//  POST /onramp
// ===========================================================================
describe("POST /onramp", () => {
    test("should add USD to user balance", async () => {
        const { token } = await createUserAndSignin();

        const res = await axios.post(
            `${BACKEND_URL}/onramp`,
            { qty: 100 },
            authHeader(token)
        );

        expect(res.status).toBe(200);

        const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
        expect(balRes.data.usdBalance).toBe(100);
    });

    test("multiple onramps should accumulate", async () => {
        const { token } = await createUserAndSignin();

        await axios.post(`${BACKEND_URL}/onramp`, { qty: 50 }, authHeader(token));
        await axios.post(`${BACKEND_URL}/onramp`, { qty: 75 }, authHeader(token));
        await axios.post(`${BACKEND_URL}/onramp`, { qty: 25 }, authHeader(token));

        const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
        expect(balRes.data.usdBalance).toBe(150);
    });

    test("should reject unauthenticated onramp", async () => {
        try {
            await axios.post(`${BACKEND_URL}/onramp`, { qty: 100 });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError;
            expect(error.response?.status).toBe(400);
        }
    });
});

// ===========================================================================
//  POST /deposit/:asset_symbol
// ===========================================================================
describe("POST /deposit/:asset_symbol", () => {
    test("should deposit a stock asset", async () => {
        const { token } = await createUserAndSignin();

        const res = await axios.post(
            `${BACKEND_URL}/deposit/sol`,
            { qty: 5 },
            authHeader(token)
        );

        expect(res.status).toBe(200);
        expect(res.data.message).toBe("Successfully deposited");

        const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
        expect(balRes.data.stockBalances["sol"].available).toBe(5);
        expect(balRes.data.stockBalances["sol"].locked).toBe(0);
    });

    test("multiple deposits to the same asset should accumulate", async () => {
        const { token } = await createUserAndSignin();

        await axios.post(`${BACKEND_URL}/deposit/sol`, { qty: 3 }, authHeader(token));
        await axios.post(`${BACKEND_URL}/deposit/sol`, { qty: 7 }, authHeader(token));

        const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
        expect(balRes.data.stockBalances["sol"].available).toBe(10);
    });

    test("deposits to different assets should be tracked separately", async () => {
        const { token } = await createUserAndSignin();

        await axios.post(`${BACKEND_URL}/deposit/sol`, { qty: 4 }, authHeader(token));
        await axios.post(`${BACKEND_URL}/deposit/eth`, { qty: 6 }, authHeader(token));

        const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
        expect(balRes.data.stockBalances["sol"].available).toBe(4);
        expect(balRes.data.stockBalances["eth"].available).toBe(6);
    });

    test("should reject unauthenticated deposit", async () => {
        try {
            await axios.post(`${BACKEND_URL}/deposit/sol`, { qty: 1 });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError;
            expect(error.response?.status).toBe(400);
        }
    });
});

// ===========================================================================
//  POST /order
// ===========================================================================
describe("POST /order", () => {
    // ----- BID ORDERS -----
    describe("bid orders", () => {
        test("bid with insufficient USD should return 411", async () => {
            const { token } = await createUserAndSignin();
            // User has 0 USD, tries to place a bid

            try {
                await axios.post(
                    `${BACKEND_URL}/order`,
                    { type: "limit", side: "bid", qty: 1, price: 100, asset: "sol" },
                    authHeader(token)
                );
                expect(true).toBe(false);
            } catch (err) {
                const error = err as AxiosError<{ message: string }>;
                expect(error.response?.status).toBe(411);
                expect(error.response?.data?.message).toBe(
                    "You have insufficient funds"
                );
            }
        });

        test("bid with exact sufficient USD should succeed (order goes to orderbook)", async () => {
            const { token } = await createUserAndSignin();
            await axios.post(`${BACKEND_URL}/onramp`, { qty: 500 }, authHeader(token));

            const res = await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 5, price: 100, asset: "sol" },
                authHeader(token)
            );

            // Should succeed – 5 * 100 = 500, user has exactly 500
            expect(res.status).toBe(200);
        });

        test("bid order placed on empty book should lock USD (orderbook_update)", async () => {
            const { token } = await createUserAndSignin();
            await axios.post(`${BACKEND_URL}/onramp`, { qty: 1000 }, authHeader(token));

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 2, price: 50, asset: "sol" },
                authHeader(token)
            );

            const balRes = await axios.get(`${BACKEND_URL}/balance`, authHeader(token));
            // 2 * 50 = 100 should be moved from available to locked
            expect(balRes.data.usdBalance).toBe(1000 - 2 * 50);
        });
    });

    // ----- ASK ORDERS -----
    describe("ask orders", () => {
        test("ask with insufficient stock should return 411", async () => {
            const { token } = await createUserAndSignin();
            // No stock deposited

            try {
                await axios.post(
                    `${BACKEND_URL}/order`,
                    { type: "limit", side: "ask", qty: 1, price: 100, asset: "sol" },
                    authHeader(token)
                );
                expect(true).toBe(false);
            } catch (err) {
                const error = err as AxiosError<{ message: string }>;
                expect(error.response?.status).toBe(411);
                expect(error.response?.data?.message).toBe(
                    "You have insufficient stocks"
                );
            }
        });

        test("ask order with sufficient stock should succeed", async () => {
            const { token } = await createUserAndSignin();
            await axios.post(`${BACKEND_URL}/deposit/sol`, { qty: 10 }, authHeader(token));

            const res = await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "ask", qty: 5, price: 200, asset: "sol" },
                authHeader(token)
            );

            expect(res.status).toBe(200);
        });
    });

    // ----- ORDER MATCHING -----
    describe("order matching (bid + ask)", () => {
        test("matching bid and ask should transfer stock and USD between users", async () => {
            // Seller: has SOL, places an ask
            const seller = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/deposit/sol`,
                { qty: 10 },
                authHeader(seller.token)
            );

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "ask", qty: 5, price: 100, asset: "sol" },
                authHeader(seller.token)
            );

            // Buyer: has USD, places a matching bid
            const buyer = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/onramp`,
                { qty: 1000 },
                authHeader(buyer.token)
            );

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 5, price: 100, asset: "sol" },
                authHeader(buyer.token)
            );

            // Buyer should now have 5 SOL and 1000 - 500 = 500 USD
            const buyerBal = await axios.get(
                `${BACKEND_URL}/balance`,
                authHeader(buyer.token)
            );
            expect(buyerBal.data.usdBalance).toBe(500);
            expect(buyerBal.data.stockBalances["sol"]?.available).toBe(5);

            // Seller should have received 500 USD
            const sellerBal = await axios.get(
                `${BACKEND_URL}/balance`,
                authHeader(seller.token)
            );
            expect(sellerBal.data.usdBalance).toBe(500);
        });

        test("partial fill: bid qty < ask qty should partially fill", async () => {
            const seller = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/deposit/sol`,
                { qty: 20 },
                authHeader(seller.token)
            );

            // Seller offers 10 SOL at $50
            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "ask", qty: 10, price: 50, asset: "sol" },
                authHeader(seller.token)
            );

            // Buyer bids for only 3 SOL at $50
            const buyer = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/onramp`,
                { qty: 500 },
                authHeader(buyer.token)
            );

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 3, price: 50, asset: "sol" },
                authHeader(buyer.token)
            );

            const buyerBal = await axios.get(
                `${BACKEND_URL}/balance`,
                authHeader(buyer.token)
            );
            // Spent 3 * 50 = 150, so 500 - 150 = 350
            expect(buyerBal.data.usdBalance).toBe(350);
            expect(buyerBal.data.stockBalances["sol"]?.available).toBe(3);
        });

        test("bid at higher price than ask should still match at ask price", async () => {
            const seller = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/deposit/sol`,
                { qty: 10 },
                authHeader(seller.token)
            );

            // Sell at 80
            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "ask", qty: 2, price: 80, asset: "sol" },
                authHeader(seller.token)
            );

            // Buy at 100 (willing to pay more)
            const buyer = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/onramp`,
                { qty: 1000 },
                authHeader(buyer.token)
            );

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 2, price: 100, asset: "sol" },
                authHeader(buyer.token)
            );

            const buyerBal = await axios.get(
                `${BACKEND_URL}/balance`,
                authHeader(buyer.token)
            );
            // Should match at ask price (80), so 2 * 80 = 160 spent
            expect(buyerBal.data.usdBalance).toBe(1000 - 2 * 80);
            expect(buyerBal.data.stockBalances["sol"]?.available).toBe(2);
        });

        test("no match when bid price < ask price", async () => {
            const seller = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/deposit/sol`,
                { qty: 10 },
                authHeader(seller.token)
            );

            // Sell at 200
            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "ask", qty: 5, price: 200, asset: "sol" },
                authHeader(seller.token)
            );

            // Buy at 100 (below ask → no match, order goes to book)
            const buyer = await createUserAndSignin();
            await axios.post(
                `${BACKEND_URL}/onramp`,
                { qty: 1000 },
                authHeader(buyer.token)
            );

            await axios.post(
                `${BACKEND_URL}/order`,
                { type: "limit", side: "bid", qty: 2, price: 100, asset: "sol" },
                authHeader(buyer.token)
            );

            const buyerBal = await axios.get(
                `${BACKEND_URL}/balance`,
                authHeader(buyer.token)
            );
            // 2 * 100 = 200 locked, 800 available
            expect(buyerBal.data.usdBalance).toBe(800);
            // No SOL received
            expect(buyerBal.data.stockBalances["sol"]).toBeUndefined();
        });
    });

    // ----- AUTH GUARD -----
    test("order endpoint should reject unauthenticated requests", async () => {
        try {
            await axios.post(`${BACKEND_URL}/order`, {
                type: "limit",
                side: "bid",
                qty: 1,
                price: 100,
                asset: "sol",
            });
            expect(true).toBe(false);
        } catch (err) {
            const error = err as AxiosError;
            expect(error.response?.status).toBe(400);
        }
    });
});