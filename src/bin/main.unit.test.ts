import { describe, expect, test } from "vitest";

import { parseArgs } from "./main.js";

describe("parseArgs", () => {
  test("parses every option into run args", () => {
    expect(
      parseArgs([
        "--port",
        "8080",
        "--token",
        "t",
        "--name",
        "n",
        "--home",
        "/h",
        "--no-token",
      ]),
    ).toEqual({
      kind: "run",
      args: {
        port: 8080,
        token: "t",
        name: "n",
        home: "/h",
        noToken: true,
      },
    });
  });

  test("no arguments runs with defaults", () => {
    expect(parseArgs([])).toEqual({ kind: "run", args: { noToken: false } });
  });

  test.each([["--help"], ["-h"]])("%s requests help", (flag) => {
    expect(parseArgs([flag])).toEqual({ kind: "help" });
  });

  test("help wins over other arguments, including unknown ones", () => {
    expect(parseArgs(["--port", "1", "--bogus", "--help"])).toEqual({
      kind: "help",
    });
  });

  test("rejects an unknown argument", () => {
    expect(parseArgs(["--bogus"])).toEqual({
      kind: "error",
      message: "unknown argument: --bogus",
    });
  });

  test.each([["--port"], ["--token"], ["--name"], ["--home"]])(
    "rejects %s with no value",
    (flag) => {
      expect(parseArgs([flag])).toEqual({
        kind: "error",
        message: `${flag} requires a value`,
      });
    },
  );

  test.each([["abc"], ["1.5"], ["-1"], ["65536"], [""]])(
    "rejects invalid port %j",
    (port) => {
      expect(parseArgs(["--port", port])).toEqual({
        kind: "error",
        message: `invalid --port: ${port}`,
      });
    },
  );
});
