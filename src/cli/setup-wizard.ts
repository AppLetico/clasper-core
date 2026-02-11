import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline/promises";

export type SetupProfile = "core" | "openclaw";

export type SetupWizardOptions = {
  profile?: SetupProfile;
  nonInteractive?: boolean;
  port?: string;
  adapterSecret?: string;
  approvalMode?: "allow" | "block";
  skipOpenclaw?: boolean;
  link?: boolean;
};

const PROVIDER_KEY_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

function runCommand(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    values[key] = value;
  }
  return values;
}

function setEnvValue(text: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escaped}=.*$`, "m");
  if (matcher.test(text)) {
    return text.replace(matcher, `${key}=${value}`);
  }
  const suffix = text.endsWith("\n") ? "" : "\n";
  return `${text}${suffix}${key}=${value}\n`;
}

function commandExists(command: string): boolean {
  const check = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return check.status === 0;
}

function needsBuild(packageRoot: string): boolean {
  const distCliPath = join(packageRoot, "dist", "cli.js");
  if (!existsSync(distCliPath)) return true;

  const srcCliPath = join(packageRoot, "src", "cli.ts");
  const srcWizardPath = join(packageRoot, "src", "cli", "setup-wizard.ts");
  const distTime = statSync(distCliPath).mtimeMs;
  const srcTime = statSync(srcCliPath).mtimeMs;
  const wizardTime = existsSync(srcWizardPath) ? statSync(srcWizardPath).mtimeMs : 0;
  return Math.max(srcTime, wizardTime) > distTime;
}

async function askInput(
  rl: readline.Interface,
  prompt: string,
  defaultValue = "",
): Promise<string> {
  const answer = (await rl.question(prompt)).trim();
  if (!answer) return defaultValue;
  return answer;
}

async function askYesNo(
  rl: readline.Interface,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await rl.question(`${prompt}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function purgeStaleOpenClawPluginCopies(): string[] {
  const extensionsDir = join(homedir(), ".openclaw", "extensions");
  const removed: string[] = [];
  const candidates = [
    join(extensionsDir, "openclaw-plugin"),
    join(extensionsDir, "clasper-openclaw"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      rmSync(candidate, { recursive: true, force: true });
      removed.push(candidate);
    }
  }
  return removed;
}

function ensureOpenClawConfig(
  clasperUrl: string,
  adapterSecret: string,
): { path: string; created: boolean } {
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");
  ensureDir(configDir);

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8").trim();
    if (raw) {
      config = JSON.parse(raw) as Record<string, unknown>;
    }
  }

  const plugins =
    typeof config.plugins === "object" && config.plugins !== null
      ? (config.plugins as Record<string, unknown>)
      : {};
  const entries =
    typeof plugins.entries === "object" && plugins.entries !== null
      ? (plugins.entries as Record<string, unknown>)
      : {};
  // Remove stale entry from when package was named @clasper/openclaw-plugin (→ openclaw-plugin)
  delete entries["openclaw-plugin"];

  entries["clasper-openclaw"] = {
    enabled: true,
    config: {
      clasperUrl,
      adapterId: "openclaw-local",
      adapterSecret,
    },
  };
  plugins.entries = entries;
  config.plugins = plugins;

  const existed = existsSync(configPath);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: configPath, created: !existed };
}

function clearOpenClawPluginEntries(): { path: string; changed: boolean } {
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");
  ensureDir(configDir);

  if (!existsSync(configPath)) {
    return { path: configPath, changed: false };
  }

  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) {
    return { path: configPath, changed: false };
  }

  const config = JSON.parse(raw) as Record<string, unknown>;
  const plugins =
    typeof config.plugins === "object" && config.plugins !== null
      ? (config.plugins as Record<string, unknown>)
      : {};
  const entries =
    typeof plugins.entries === "object" && plugins.entries !== null
      ? (plugins.entries as Record<string, unknown>)
      : {};

  const hadLegacy = Object.prototype.hasOwnProperty.call(entries, "openclaw-plugin");
  const hadClasper = Object.prototype.hasOwnProperty.call(entries, "clasper-openclaw");

  if (!hadLegacy && !hadClasper) {
    return { path: configPath, changed: false };
  }

  delete entries["openclaw-plugin"];
  delete entries["clasper-openclaw"];
  plugins.entries = entries;
  config.plugins = plugins;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: configPath, changed: true };
}

function pickProviderKey(provider: string): string | undefined {
  return PROVIDER_KEY_MAP[provider];
}

function selectProfileFromInput(answer: string): SetupProfile | null {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "1" || normalized === "core" || normalized === "clasper-core") {
    return "core";
  }
  if (
    normalized === "2" ||
    normalized === "openclaw" ||
    normalized === "clasper-core-openclaw" ||
    normalized === "core-openclaw"
  ) {
    return "openclaw";
  }
  return null;
}

function coerceProfile(profile: string | undefined): SetupProfile | null {
  if (!profile) return null;
  const normalized = profile.trim().toLowerCase();
  if (normalized === "core" || normalized === "clasper-core") return "core";
  if (
    normalized === "openclaw" ||
    normalized === "clasper-core-openclaw" ||
    normalized === "core-openclaw"
  ) {
    return "openclaw";
  }
  return null;
}

export async function runSetupWizard(
  packageRoot: string,
  copyWorkspaceTemplate: (targetDir: string, force: boolean) => { created: string[]; skipped: string[] },
  options: SetupWizardOptions,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("Welcome to Clasper Core setup.");
    console.log("");

    const profileFromFlag = coerceProfile(options.profile);
    if (options.profile && !profileFromFlag) {
      throw new Error(`Unknown profile "${options.profile}". Use "core" or "openclaw".`);
    }

    let profile: SetupProfile = profileFromFlag ?? "core";
    if (!options.profile && !options.nonInteractive) {
      console.log("What would you like to install?");
      console.log("  1) Clasper Core");
      console.log("  2) Clasper Core + OpenClaw");
      const profileAnswer = await askInput(rl, "Select profile [1/2]: ", "2");
      profile = selectProfileFromInput(profileAnswer) ?? "openclaw";
      console.log("");
    } else if (!options.profile && options.nonInteractive) {
      profile = "openclaw";
    }

    const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
    if (!Number.isFinite(major) || major < 22) {
      throw new Error(`Node.js 22+ is required (found ${process.versions.node}).`);
    }

    const nodeModulesPath = join(packageRoot, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      const shouldInstall =
        options.nonInteractive === true
          ? true
          : await askYesNo(rl, "Dependencies are missing. Run npm install now?", true);
      if (shouldInstall) {
        const installCode = await runCommand("npm", ["install"], packageRoot);
        if (installCode !== 0) {
          throw new Error("npm install failed.");
        }
      }
    }

    const envExamplePath = join(packageRoot, ".env.example");
    const envPath = join(packageRoot, ".env");
    if (!existsSync(envPath)) {
      copyFileSync(envExamplePath, envPath);
      console.log("Created .env from .env.example");
    }

    let envText = readFileSync(envPath, "utf8");
    const envValues = parseEnv(envText);

    const defaultPort = options.port ?? envValues.CLASPER_PORT ?? "8081";
    const defaultSecret =
      options.adapterSecret ?? envValues.ADAPTER_JWT_SECRET ?? randomBytes(16).toString("hex");
    const defaultApproval = options.approvalMode ?? (envValues.CLASPER_REQUIRE_APPROVAL_IN_CORE === "allow" ? "allow" : "block");
    const defaultProvider = envValues.LLM_PROVIDER || "openai";

    const port =
      options.nonInteractive === true
        ? defaultPort
        : await askInput(rl, `CLASPER_PORT [${defaultPort}]: `, defaultPort);

    const adapterSecret =
      options.nonInteractive === true
        ? defaultSecret
        : await askInput(
            rl,
            `ADAPTER_JWT_SECRET [${defaultSecret.slice(0, 8)}...]: `,
            defaultSecret,
          );

    const approvalMode =
      options.nonInteractive === true
        ? defaultApproval
        : await askInput(
            rl,
            `CLASPER_REQUIRE_APPROVAL_IN_CORE [${defaultApproval}] (block/allow): `,
            defaultApproval,
          );

    const provider =
      options.nonInteractive === true
        ? defaultProvider
        : await askInput(rl, `LLM_PROVIDER [${defaultProvider}] (blank to keep): `, defaultProvider);

    const providerKey = pickProviderKey(provider);
    let providerApiKey = "";
    if (providerKey && !options.nonInteractive) {
      providerApiKey = await askInput(
        rl,
        `${providerKey} (leave blank to keep current value): `,
        "",
      );
    }

    envText = setEnvValue(envText, "CLASPER_PORT", port);
    envText = setEnvValue(envText, "ADAPTER_JWT_SECRET", adapterSecret);
    envText = setEnvValue(
      envText,
      "CLASPER_REQUIRE_APPROVAL_IN_CORE",
      approvalMode === "allow" ? "allow" : "block",
    );
    envText = setEnvValue(envText, "LLM_PROVIDER", provider);
    envText = setEnvValue(envText, "AGENT_DAEMON_URL", `http://localhost:${port}`);
    if (providerKey && providerApiKey) {
      envText = setEnvValue(envText, providerKey, providerApiKey);
    }
    writeFileSync(envPath, envText, "utf8");
    console.log("Updated .env");

    if (needsBuild(packageRoot)) {
      console.log("Building project...");
      const buildCode = await runCommand("npm", ["run", "build"], packageRoot);
      if (buildCode !== 0) {
        throw new Error("npm run build failed.");
      }
    } else {
      console.log("Build artifacts are up to date.");
    }

    const workspacePath = join(packageRoot, "workspace");
    if (!existsSync(workspacePath)) {
      copyWorkspaceTemplate(workspacePath, false);
      console.log(`Initialized workspace at ${workspacePath}`);
    }

    const shouldRunOpenClaw = profile === "openclaw" && options.skipOpenclaw !== true;
    if (shouldRunOpenClaw) {
      if (!commandExists("openclaw")) {
        console.log("");
        console.log("OpenClaw was not found in PATH.");
        console.log("Install OpenClaw, then run `clasper-core setup --profile openclaw` again.");
      } else {
        const pluginPath = join(packageRoot, "integrations", "openclaw");
        // Old plugin copies may crash OpenClaw CLI before install starts.
        const removedPluginCopies = purgeStaleOpenClawPluginCopies();
        if (removedPluginCopies.length > 0) {
          console.log(`Removed stale OpenClaw plugin copies: ${removedPluginCopies.join(", ")}`);
        }
        // Clear stale entries so strict OpenClaw validation doesn't fail before install.
        const { path: preflightConfigPath, changed } = clearOpenClawPluginEntries();
        if (changed) {
          console.log(`Cleaned existing OpenClaw plugin entries: ${preflightConfigPath}`);
        }

        console.log("Installing OpenClaw plugin...");
        const pluginCode = await runCommand(
          "openclaw",
          ["plugins", "install", pluginPath],
          packageRoot,
        );
        if (pluginCode !== 0) {
          throw new Error("Failed to install OpenClaw plugin.");
        }
        const { path: openclawConfigPath } = ensureOpenClawConfig(
          `http://localhost:${port}`,
          adapterSecret,
        );
        console.log(`Updated OpenClaw config: ${openclawConfigPath}`);

        console.log("Seeding OpenClaw policies...");
        const seedCode = await runCommand("npm", ["run", "seed:openclaw-policies"], packageRoot);
        if (seedCode !== 0) {
          console.log("Policy seeding did not complete. Start Clasper Core (`clasper-core dev`) and re-run `clasper-core seed openclaw`.");
        }
      }
    }

    let shouldLink = options.link === true;
    if (!options.nonInteractive && options.link !== true) {
      shouldLink = await askYesNo(rl, "Run npm link so clasper-core is globally available?", true);
    }
    if (shouldLink) {
      const linkCode = await runCommand("npm", ["link"], packageRoot);
      if (linkCode !== 0) {
        throw new Error("npm link failed.");
      }
    }

    console.log("");
    console.log("Setup complete.");
    console.log("");
    console.log("Next steps:");
    console.log("  1) Run: clasper-core dev");
    if (shouldRunOpenClaw) {
      console.log("  2) Run: openclaw gateway start");
    }
    console.log("  3) Run: clasper-core dashboard");
    console.log(`     (opens http://localhost:${port}/)`);
  } finally {
    rl.close();
  }
}
