#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $ } from "execa";

await yargs(hideBin(process.argv))
  .scriptName("fastmcp")
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
      await $({
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })`npx @wong2/mcp-cli npx tsx ${argv.file}`;
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
      })`npx @modelcontextprotocol/inspector npx tsx ${argv.file}`;
    },
  )
  .help()
  .parseAsync();
