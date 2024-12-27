#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "execa";

await yargs(hideBin(process.argv))
  .command(
    "dev <file>",
    "Start a development server",
    (yargs) => {
      return yargs.positional("file", {
        type: "string",
        describe: "The path to the server file",
        demandOption: true,
      });
    },
    async (argv) => {
      const command = argv.file.endsWith(".ts")
        ? ["npx", "tsx", argv.file]
        : ["node", argv.file];

      await $({
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })`npx @wong2/mcp-cli ${command}`;
    },
  )
  .command(
    "inspect <file>",
    "Inspect a server file",
    (yargs) => {
      return yargs.positional("file", {
        type: "string",
        describe: "The path to the server file",
        demandOption: true,
      });
    },
    async (argv) => {
      await $({
        stdout: "inherit",
        stderr: "inherit",
      })`npx @modelcontextprotocol/inspector node ${argv.file}`;
    },
  )
  .help()
  .parseAsync();
