import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { createClient } from "redis";

const QUEUE_NAME = "queue-" + Math.random().toString().substring(0, 5);

const client = createClient();
client.connect();

const receiveClient = createClient();

import {
    authMiddleware,
    JWT_SECRET,
    type AuthRequest
} from "../middleware";

import type {
    Claims,
    DepositRequest,
    OnRampRequest,
    OrderRequest,
    SigninInput,
    SignupInput,
    SignupResponse,
} from "../types/user";

import { db } from "../db";
import { users } from "../db/schema";

export const router = Router();


// const SOL_ORDERBOOK = new Ordebook("sol");

// function getStockBalance(userId: number, asset: string) {
//     return stockBalances.get(userId)!.get(asset) ?? {
//         available: 0,
//         locked: 0
//     };
// }



router.post("/signup", async (req, res) => {
    const body = req.body as SignupInput;

    const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1);

    if (existingUser.length > 0) {
        res.status(409).json({
            message: "User already exists"
        } satisfies SignupResponse);

        return;
    }

    const [user] = await db
        .insert(users)
        .values({
            username: body.username,
            password: body.password
        })
        .returning();

    if (!user) {
        res.status(500).json({
            message: "Failed to create user"
        } satisfies SignupResponse);

        return;
    }

    res.status(201).json({
        message: "Successfully signed up"
    } satisfies SignupResponse);
});



router.post("/signin", async (req, res) => {
    const body = req.body as SigninInput;

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, body.username))
        .limit(1);

    if (!user) {
        res.status(401).json({
            message: "Incorrect credentials"
        } satisfies SignupResponse);

        return;
    }

    if (user.password !== body.password) {
        res.status(401).json({
            message: "Incorrect credentials"
        } satisfies SignupResponse);

        return;
    }

    const claims: Claims = {
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
    };

    const token = jwt.sign(claims, JWT_SECRET);

    res.json({
        token
    });
});

router.post("/onramp", authMiddleware, async (req: AuthRequest, res) => {
    const body = req.body as OnRampRequest;

    await client.lPush("engine-queue", JSON.stringify({
        type: "onramp",
        payload: {
            userId: req.userId!,
            amount: body.qty
        }
    }))

    res.json({
        message: "Onramp request received"
    });

});

router.post("/deposit", authMiddleware, async (req: AuthRequest, res) => {
    const body = req.body as DepositRequest;

    await client.lPush("engine-queue", JSON.stringify({
        type: "Deposit",
        payload: {
            userId: req.userId!,
            ticker: body.ticker,
            qty: body.qty
        }
    }))

    res.json({
        message: "Deposit request received"
    });

});