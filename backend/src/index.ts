import express from "express";

import { router as userRouter } from "./routes/users";
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
const db = drizzle(process.env.DATABASE_URL!);

const app = express();
app.use(express.json());

app.use(userRouter);

app.listen(3000);