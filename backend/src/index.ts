import express from "express";

import { router as userRouter } from "./routes/users";

const app = express();
app.use(express.json());

app.use(userRouter);

app.listen(3000);