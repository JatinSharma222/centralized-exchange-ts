import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { createClient } from "redis";

import { db } from "../db";
import { users } from "../db/schema";

import { authMiddleware, JWT_SECRET, type AuthRequest } from "../middleware";

import type {
  CancelOrderRequest,
  Claims,
  DepositRequest,
  OnRampRequest,
  OrderRequest,
  SigninInput,
  SignupInput,
  SignupResponse,
} from "../types/user";

const client = createClient({ url: process.env.REDIS_URL });
client.connect();

const receiveClient = createClient({ url: process.env.REDIS_URL });

const QUEUE_NAME = "queue-" + crypto.randomUUID();
const CALLBACKS: Record<string, (data: unknown) => void> = {};

function waitForCallback<T>(callbackId: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete CALLBACKS[callbackId];
      reject(new Error("Engine did not respond in time"));
    }, timeoutMs);

    CALLBACKS[callbackId] = (data) => {
      clearTimeout(timer);
      resolve(data as T);
    };
  });
}

export const router = Router();

router.post("/signup", async (req, res) => {
  const body = req.body as SignupInput;

  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.username, body.username))
    .limit(1);

  if (existingUser.length > 0) {
    res.status(409).json({
      message: "User already exists",
    } satisfies SignupResponse);

    return;
  }

  const hashedPassword = await bcrypt.hash(body.password, 10);

  const [user] = await db
    .insert(users)
    .values({
      username: body.username,
      password: hashedPassword,
    })
    .returning();

  if (!user) {
    res.status(500).json({
      message: "Failed to create user",
    } satisfies SignupResponse);

    return;
  }

  res.status(201).json({
    message: "Successfully signed up",
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
      message: "Incorrect credentials",
    } satisfies SignupResponse);

    return;
  }

  const isMatch = await bcrypt.compare(body.password, user.password);

  if (!isMatch) {
    res.status(401).json({
      message: "Incorrect credentials",
    } satisfies SignupResponse);

    return;
  }

  const claims: Claims = {
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };

  const token = jwt.sign(claims, JWT_SECRET);

  res.json({
    token,
  });
});

function isValidOnRampRequest(body: any): body is OnRampRequest {
  return (
    body &&
    typeof body.qty === "number" && Number.isFinite(body.qty) && body.qty > 0
  );
}

router.post("/onramp", authMiddleware, async (req: AuthRequest, res) => {
  const body = req.body;

  if (!isValidOnRampRequest(body)) {
    res.status(400).json({ message: "Invalid onramp request" });
    return;
  }

  const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "onramp",
      payload: {
        userId: req.userId!,
        amount: body.qty,
      },
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    await waitForCallback(callbackId);
    res.json({ message: "Onramp successful" });
  } catch {
    res.status(504).json({ message: "Onramp request timed out" });
  }
});

function isValidDepositRequest(body: any): body is DepositRequest {
  return (
    body &&
    typeof body.asset === "string" && body.asset.length > 0 &&
    typeof body.qty === "number" && Number.isFinite(body.qty) && body.qty > 0
  );
}

router.post("/deposit", authMiddleware, async (req: AuthRequest, res) => {
  const body = req.body;

  if (!isValidDepositRequest(body)) {
    res.status(400).json({ message: "Invalid deposit request" });
    return;
  }

  const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "Deposit",
      payload: {
        userId: req.userId!,
        asset: body.asset,
        qty: body.qty,
      },
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    await waitForCallback(callbackId);
    res.json({ message: "Deposit successful" });
  } catch {
    res.status(504).json({ message: "Deposit request timed out" });
  }
});

function isValidOrderRequest(body: any): body is OrderRequest {
    return (
        body &&
        body.type === "limit" &&
        (body.side === "bid" || body.side === "ask") &&
        (body.asset === "sol" || body.asset === "eth") &&
        typeof body.qty === "number" &&
        Number.isFinite(body.qty) &&
        body.qty > 0 &&
        typeof body.price === "number" &&
        Number.isFinite(body.price) &&
        body.price > 0
    );
}

router.post("/order", authMiddleware, async (req: AuthRequest, res) => {
    const body = req.body;

    if (!isValidOrderRequest(body)) {
        res.status(400).json({
            message: "Invalid order request",
        });
        return;
    }

    const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "createOrder",
      payload: {
        userId: req.userId!,
        order: body,
      },
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    const result = await waitForCallback<{
      orderId?: number;
      updates?: unknown[];
      error?: string;
    }>(callbackId);

    if (result.error) {
      res.status(400).json({ message: result.error });
      return;
    }

    res.json({
      message: "Order placed",
      orderId: result.orderId,
      updates: result.updates,
    });
  } catch {
    res.status(504).json({ message: "Order processing timed out" });
  }
});

function isValidCancelOrderRequest(body: any): body is CancelOrderRequest {
  return (
    body &&
    typeof body.orderId === "number" && Number.isFinite(body.orderId) &&
    typeof body.asset === "string" && body.asset.length > 0
  );
}

router.post("/cancel_order", authMiddleware, async (req: AuthRequest, res) => {
  const body = req.body;

  if (!isValidCancelOrderRequest(body)) {
    res.status(400).json({ message: "Invalid cancel order request" });
    return;
  }

  const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "cancelOrder",
      payload: {
        userId: req.userId!,
        orderId: body.orderId,
        asset: body.asset,
      },
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    const result = await waitForCallback<{ canceled: boolean }>(callbackId);
    if (result.canceled) {
      res.json({ message: "Order canceled", canceled: true });
    } else {
      res.status(404).json({ message: "Order not found or not owned by you", canceled: false });
    }
  } catch {
    res.status(504).json({ message: "Cancel request timed out" });
  }
});

router.get("/balance", authMiddleware, async (req: AuthRequest, res) => {
  const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "get_balance",
      payload: {
        userId: req.userId!,
      },
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    const result = await waitForCallback<{ balance: unknown }>(callbackId);
    res.json(result.balance);
  } catch {
    res.status(504).json({ message: "Balance lookup timed out" });
  }
});

router.post("/reset", async (_req, res) => {
  const callbackId = crypto.randomUUID();

  await client.lPush(
    "engine-queue",
    JSON.stringify({
      type: "reset",
      payload: {},
      queue: QUEUE_NAME,
      callbackId,
    }),
  );

  try {
    await waitForCallback(callbackId);
    res.json({ message: "Engine state reset" });
  } catch {
    res.status(504).json({ message: "Reset timed out" });
  }
});


receiveClient.connect().then(async () => {
  while (1) {
    const res = await receiveClient.blPop(QUEUE_NAME, 1);
    if (!res) {
      continue;
    }
    const parsedData = JSON.parse(res.element);
    const callbackId = parsedData.callbackId;
    const callback = CALLBACKS[callbackId];
    if (callback) {
      callback(parsedData);
      delete CALLBACKS[callbackId];
    }
  }
});