#!/usr/bin/env node
import { createDemoBackend } from "../demo/backend.ts";
import { serveStdio } from "../stdio.ts";

await serveStdio(createDemoBackend(), {
  name: "heim-mcp-demo",
  version: "0.1.0",
});
