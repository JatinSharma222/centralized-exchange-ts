import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";

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

import { Ordebook } from "../orderbook";
import { db } from "../db";
import { users } from "../db/schema";

export const router = Router();

const usdBalances: Map<
    number,
    { available: number; locked: number }
> = new Map();

const stockBalances: Map<
    number,
    Map<string, { available: number; locked: number }>
> = new Map();

const SOL_ORDERBOOK = new Ordebook("sol");

function getStockBalance(userId: number, asset: string) {
    return stockBalances.get(userId)!.get(asset) ?? {
        available: 0,
        locked: 0
    };
}



router.post("/signup", async (req, res) => {
    const body = req.body as SignupInput;

    // Check if username already exists
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

    // Insert user into PostgreSQL
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

    // Initialize balances in memory for now
    usdBalances.set(user.id, {
        available: 0,
        locked: 0
    });

    stockBalances.set(user.id, new Map());

    res.status(201).json({
        message: "Successfully signed up"
    } satisfies SignupResponse);
});



router.post("/signin", async (req, res) => {
    const body = req.body as SigninInput;

    // Find user by username
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