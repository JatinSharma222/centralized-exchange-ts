import express from "express";

import { type Asset, type Balance, type User, ASSETS } from "./types/Exchange";

const app = express();
app.use(express.json());

let USER_INDEX = 0;

const USERS_BY_USERNAME = new Map<string, User>();
const USERS_BY_ID = new Map<number, User>();

const BALANCES = new Map<number, Map<Asset, Balance>>();

app.post("/signup", (req, res) => {
  const { username, password } = req.body;

  if (USERS_BY_USERNAME.has(username)) {
    return res.status(403).json({ message: "User already exists" });
  }

  const user: User = { id: USER_INDEX++, username, password };
  USERS_BY_USERNAME.set(username, user);
  USERS_BY_ID.set(user.id, user);

  res.status(201).json({ message: "Successfully signed up" });
});

app.post("/signin", (req, res) => {
  const { username, password } = req.body;

  const user = USERS_BY_USERNAME.get(username);

  if (!user) {
    return res.status(403).json({ message: "User does not exist" });
  }

  if (user.password !== password) {
    return res.status(403).json({ message: "Invalid credentials" });
  }

  return res
    .status(200)
    .json({ message: "User logged in successfully", userId: user.id });
});

app.post("/balance/deposit", (req, res) => {
  const { userId, amount, asset } = req.body;

  if (
    typeof userId !== "number" ||
    typeof amount !== "number" ||
    typeof asset !== "string"
  ) {
    return res
      .status(400)
      .json({ message: "UserId, amount and asset are required" });
  }

  if (amount <= 0) {
    return res.status(400).json({ message: "Amount must be positive" });
  }

  const user = USERS_BY_ID.get(userId);

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (!ASSETS.includes(asset as Asset)) {
    return res.status(400).json({ message: "Unsupported asset" });
  }

  let userBalances = BALANCES.get(userId);
  if (!userBalances) {
    userBalances = new Map();
    BALANCES.set(userId, userBalances);
  }

  let balance = userBalances.get(asset as Asset);
  if (!balance) {
    balance = { available: 0, locked: 0 };
    userBalances.set(asset as Asset, balance);
  }

  balance.available += amount;

  res.status(200).json({
    message: "Deposit successful",
    balance,
  });
});


app.listen(3000);
