import { spawn } from "child_process";
import { JSONRPCClient } from "json-rpc-2.0";
import * as fs from "fs/promises";
import * as path from "path";

async function runTest(args: string[] = []) {
  const child = spawn("node", ["./index.js", ...args], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const client = new JSONRPCClient((request) => {
    child.stdin.write(JSON.stringify(request) + "\n");
    return Promise.resolve();
  });

  child.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        client.receive(response);
      } catch (e) {
      }
    }
  });

  return { client, child };
}

async function test() {
  const testFile = path.resolve("./test.resx");
  const isSingle = process.argv.includes("--single");

  console.log(`Running tests (Single Mode: ${isSingle})...`);
  const { client, child } = await runTest(isSingle ? ["--single-tool"] : []);

  try {
    if (isSingle) {
      console.log("Creating test resx file (via single tool)...");
      await client.request("tools/call", { name: "resx", arguments: { tool: "create_resx_file", args: { path: testFile } } });

      console.log("Testing resx file validity...");
      const testRes = await client.request("tools/call", { name: "resx", arguments: { tool: "test_resx_file", args: { path: testFile } } });
      console.log("Test Result:", JSON.stringify(testRes, null, 2));

      console.log("Writing string entry (via single tool)...");
      await client.request("tools/call", {
        name: "resx",
        arguments: { tool: "write_resx_entry", args: { path: testFile, key: "Hello", value: "SingleMode" } }
      });
    } else {
      console.log("Creating test resx file...");
      await client.request("tools/call", { name: "create_resx_file", arguments: { path: testFile } });

      console.log("Testing resx file validity...");
      const testRes = await client.request("tools/call", { name: "test_resx_file", arguments: { path: testFile } });
      console.log("Test Result:", JSON.stringify(testRes, null, 2));

      console.log("Writing string entry...");
      await client.request("tools/call", {
        name: "write_resx_entry",
        arguments: { path: testFile, key: "Hello", value: "NormalMode" }
      });
    }

    console.log("Verification finished successfully!");
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    child.kill();
    await fs.unlink(testFile).catch(() => {});
  }
}

test();
