import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import express from "express";
import { createApp } from "./app.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
if (production && !origin.startsWith("https://"))
  throw Error("PUBLIC_ORIGIN must use HTTPS in production.");
const system = createApp({
  dbPath: process.env.DB_PATH || resolve("data/luqma.sqlite"),
  origin,
  allowedOrigins: production ? [origin] : [origin, `http://localhost:${port}`, `http://127.0.0.1:${port}`],
  secureCookies: production,
  allowSetup:
    process.env.ALLOW_LOCAL_SETUP === "true" ||
    (!production && process.env.ALLOW_LOCAL_SETUP !== "false"),
});
const server = createServer(system.app);
let vite;
if (!production) {
  const { createServer: createVite } = await import("vite");
  vite = await createVite({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  system.app.use(vite.middlewares);
} else {
  system.app.use(
    express.static(resolve("dist"), { index: false, maxAge: "1h" }),
  );
  system.app.get("/{*splat}", (req, res) =>
    res.sendFile(resolve("dist/index.html")),
  );
}
const job = setInterval(() => {
  try {
    system.sync();
  } catch (e) {
    console.error("Scheduler error:", e.message);
  }
}, 15000);
job.unref();
server.listen(port, host, () =>
  console.log(
    `سُفرة: ${origin} (${production ? "production" : "development"})`,
  ),
);
async function shutdown() {
  clearInterval(job);
  server.close();
  await vite?.close();
  system.close();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
