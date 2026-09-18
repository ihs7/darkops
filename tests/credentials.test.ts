import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API_KEY_ENV,
  configDir,
  loadCredentials,
  maskKey,
  missingCredentialsMessage,
  requireCredentials,
  sourceLabel,
  userEnvFile,
  writeUserApiKey,
} from "../src/util/credentials";
import { DarkopsError } from "../src/util/errors";

const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "darkops-credentials-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe("configDir", () => {
  test("honors DARKOPS_CONFIG_DIR", () => {
    expect(configDir({ DARKOPS_CONFIG_DIR: "/custom" })).toBe("/custom");
  });

  test("honors XDG_CONFIG_HOME", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" })).toBe(join("/xdg", "darkops"));
  });
});

describe("loadCredentials", () => {
  test("prefers the environment over files", () => {
    const root = tempDir();
    const config = tempDir();
    writeFileSync(join(root, ".env"), `${API_KEY_ENV}=from-repo\n`);
    writeFileSync(join(config, ".env"), `${API_KEY_ENV}=from-user\n`);
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config, [API_KEY_ENV]: "from-env" };

    expect(loadCredentials(root, env)).toEqual({ source: "environment", key: "from-env" });
    expect(env[API_KEY_ENV]).toBe("from-env");
  });

  test("prefers the repository .env over the user config", () => {
    const root = tempDir();
    const config = tempDir();
    writeFileSync(join(root, ".env"), `${API_KEY_ENV}=from-repo\n`);
    writeFileSync(join(config, ".env"), `${API_KEY_ENV}=from-user\n`);
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };

    expect(loadCredentials(root, env)).toEqual({ source: "repository", key: "from-repo" });
    expect(env[API_KEY_ENV]).toBe("from-repo");
  });

  test("falls back to the user config", () => {
    const root = tempDir();
    const config = tempDir();
    writeFileSync(join(config, ".env"), `${API_KEY_ENV}=from-user\n`);
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };

    expect(loadCredentials(root, env)).toEqual({ source: "user", key: "from-user" });
  });

  test("treats an empty environment variable as unset", () => {
    const root = tempDir();
    const config = tempDir();
    writeFileSync(join(root, ".env"), `${API_KEY_ENV}=from-repo\n`);
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config, [API_KEY_ENV]: "" };

    expect(loadCredentials(root, env)).toEqual({ source: "repository", key: "from-repo" });
    expect(env[API_KEY_ENV]).toBe("from-repo");
  });

  test("applies other variables without overriding the environment", () => {
    const root = tempDir();
    const config = tempDir();
    writeFileSync(join(root, ".env"), "TYPESAFE_DEFAULT_MODEL=repo-model\nSHARED=repo\n");
    writeFileSync(join(config, ".env"), "SHARED=user\nEXTRA=user-only\n");
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config, SHARED: "env" };

    loadCredentials(root, env);
    expect(env.TYPESAFE_DEFAULT_MODEL).toBe("repo-model");
    expect(env.SHARED).toBe("env");
    expect(env.EXTRA).toBe("user-only");
  });

  test("returns undefined when nothing is configured", () => {
    const root = tempDir();
    const config = tempDir();
    expect(loadCredentials(root, { DARKOPS_CONFIG_DIR: config })).toBeUndefined();
  });

  test("reports every source it checked when nothing resolves", () => {
    const root = tempDir();
    const config = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };

    expect(missingCredentialsMessage(root, env)).toContain(join(root, ".env"));
    expect(missingCredentialsMessage(root, env)).toContain(join(config, ".env"));
  });
});

describe("requireCredentials", () => {
  test("returns the resolved credential", () => {
    const root = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: tempDir(), [API_KEY_ENV]: "from-env" };
    expect(requireCredentials(root, env)).toEqual({ source: "environment", key: "from-env" });
  });

  test("throws an AUTH error when nothing resolves", () => {
    const root = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: tempDir() };

    try {
      requireCredentials(root, env);
      throw new Error("expected requireCredentials to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DarkopsError);
      expect((error as DarkopsError).code).toBe("AUTH");
      expect((error as DarkopsError).exitCode).toBe(3);
    }
  });
});

describe("writeUserApiKey", () => {
  test("creates the user config with restrictive permissions", () => {
    const config = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };
    const file = writeUserApiKey("ts_secret", env);

    expect(file).toBe(userEnvFile(env));
    expect(readFileSync(file, "utf8")).toContain(`${API_KEY_ENV}=ts_secret`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("preserves existing variables and updates the key in place", () => {
    const config = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };
    writeFileSync(join(config, ".env"), `${API_KEY_ENV}=old\nTYPESAFE_DEFAULT_MODEL=jev-1.13.0\n`);

    writeUserApiKey("new", env);
    const text = readFileSync(join(config, ".env"), "utf8");
    expect(text).toBe(`${API_KEY_ENV}=new\nTYPESAFE_DEFAULT_MODEL=jev-1.13.0\n`);
  });

  test("replaces an exported assignment in place", () => {
    const config = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };
    writeFileSync(join(config, ".env"), `export ${API_KEY_ENV}=old\nexport OTHER=keep\n`);

    writeUserApiKey("new", env);
    const text = readFileSync(join(config, ".env"), "utf8");
    expect(text).toBe(`${API_KEY_ENV}=new\nexport OTHER=keep\n`);
  });

  test("rejects empty and multi-line keys", () => {
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: tempDir() };
    expect(() => writeUserApiKey("   ", env)).toThrow("empty");
    expect(() => writeUserApiKey("a\nb", env)).toThrow("single line");
  });
});

describe("sourceLabel", () => {
  test("names the environment or the resolved file path", () => {
    const root = tempDir();
    const config = tempDir();
    const env: NodeJS.ProcessEnv = { DARKOPS_CONFIG_DIR: config };
    expect(sourceLabel("environment", root, env)).toBe("the environment");
    expect(sourceLabel("repository", root, env)).toBe(join(root, ".env"));
    expect(sourceLabel("user", root, env)).toBe(join(config, ".env"));
  });
});

describe("maskKey", () => {
  test("shows only the tail of a long key", () => {
    expect(maskKey("ts_abcdefghijkl")).toBe("***ijkl");
    expect(maskKey("short")).toBe("********");
  });
});
