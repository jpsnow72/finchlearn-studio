// Test-only Gemini stub: serves one canned generateContent response
// (a real PNG in Gemini response shape), logs every hit, and returns
// 500 while the FAIL flag file exists. Never deployed in production.
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const canned = readFileSync(new URL("./stub-response.json", import.meta.url), "utf8");
const hitsLog = new URL("./stub-hits.log", import.meta.url);
const failFlag = "/opt/finch-generate/test/FAIL";

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    appendFileSync(hitsLog, `${new Date().toISOString()} ${req.method} ${req.url} bytes=${body.length}\n`);
    if (existsSync(failFlag)) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stub forced failure", status: "INTERNAL" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(canned);
  });
}).listen(8899, "127.0.0.1", () => console.log("stub listening on 8899"));
