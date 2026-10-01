import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// ── Supported providers ─────────────────────────────────────────────
export const Provider = {
  OPENAI: "openai",
  OLLAMA: "ollama",
  GOOGLE: "google",
  OPENROUTER: "openrouter",
};

// ── Allowed models per provider ────────────────────────────────────
export const ProviderModels = {
  [Provider.OPENAI]: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1-2025-04-14",
    "gpt-4.1-nano",
    "gpt-5",
    "gpt-5.1",
    "gpt-5-mini",
    "gpt-5-nano",
  ],
  [Provider.OLLAMA]: [
    "llama3.2",
    "mistral-small3.1",
    "llama3.3:latest",
    "gemma3:4b",
    "gemma3:12b",
    "gemma4:26b",
    "gpt-oss:20b",
  ],
  [Provider.GOOGLE]: ["gemini-2.5-pro"],
  [Provider.OPENROUTER]: [
    "openrouter/auto",
    "google/gemma-3-4b-it:free",
    "nvidia/llama-3.1-nemotron-70b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
  ],
};

// Flat set for quick lookups; also used by legacy callers
export const Model = {
  LLM3: "llama3.2",
  GPT4o: "gpt-4o",
  GPT4oMini: "gpt-4o-mini",
  GPT4_1: "gpt-4.1-2025-04-14",
  GPT4_1_NANO: "gpt-4.1-nano",
  GPT5: "gpt-5",
  GPT5_1: "gpt-5.1",
  GPT5_MINI: "gpt-5-mini",
  GPT5_NANO: "gpt-5-nano",
  MISTRAL: "mistral-small3.1",
  LLAMA3_3: "llama3.3:latest",
  GEMMA3_4: "gemma3:4b",
  GEMMA3_12: "gemma3:12b",
  GEMINI_PRO: "gemini-2.5-pro",
  GPT_OSS_20B: "gpt-oss:20b",
};

// ── Default models per provider ────────────────────────────────────
const DEFAULT_MODEL = {
  [Provider.OPENAI]: "gpt-4o-mini",
  [Provider.OLLAMA]: "gpt-oss:20b",
  [Provider.GOOGLE]: "gemini-2.5-pro",
  [Provider.OPENROUTER]: "openrouter/auto",
};

const VALID_PROVIDERS = new Set(Object.values(Provider));

// ── Provider-specific build options ────────────────────────────────
function openAiDefaultOptions() {
  return {
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 90000),
    maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 2),
  };
}

const OPENAI_MODEL_OPTIONS = {
  "gpt-4o": { temperature: 0.7 },
  "gpt-4o-mini": { temperature: 0.7 },
  "gpt-4.1-2025-04-14": { temperature: 0.7 },
  "gpt-4.1-nano": { temperature: 0.7 },
  "gpt-5": {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
  "gpt-5.1": {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "none" },
  },
  "gpt-5-mini": {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
  "gpt-5-nano": {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
};

// ── Validation ─────────────────────────────────────────────────────
function assertProviderModel(provider, model) {
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(
      `Unsupported provider: "${provider}". Choose one of: ${[...VALID_PROVIDERS].join(", ")}`,
    );
  }
  const allowed = ProviderModels[provider];
  if (!allowed.includes(model)) {
    throw new Error(
      `Model "${model}" is not supported by provider "${provider}". Allowed: ${allowed.join(", ")}`,
    );
  }
}

// ── Builders (one per provider) ────────────────────────────────────
function buildOpenAIModel(model) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI models");
  }
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    ...openAiDefaultOptions(),
    ...(OPENAI_MODEL_OPTIONS[model] || { temperature: 0 }),
  });
}

function buildGoogleModel(model) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GEMINI_API_KEY is required for Google models");
  }
  return new ChatGoogleGenerativeAI({
    model,
    temperature: 0.7,
    apiKey,
  });
}

function buildOllamaModel(model, ollamaBaseUrl) {
  return new ChatOllama({
    baseUrl: ollamaBaseUrl,
    model,
    temperature: 0,
  });
}

function buildOpenRouterModel(model) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter models");
  }
  return new ChatOpenAI({
    model,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
    temperature: 0.7,
  });
}

// ── Main entry point ───────────────────────────────────────────────
/**
 * Build a chat model based on explicit provider + model from config.
 *
 * @param {object} config
 * @param {string} config.provider  - one of Provider values
 * @param {string} [config.model]   - model name within the provider (uses default if omitted)
 * @param {string} [config.ollamaBaseUrl]
 */
export function buildChatModel(config) {
  const provider = config.provider;
  const model = config.model || DEFAULT_MODEL[provider];

  if (!provider) {
    throw new Error(
      "config.provider is required. Set LLM_PROVIDER in .env " +
        `(${[...VALID_PROVIDERS].join(", ")})`,
    );
  }

  assertProviderModel(provider, model);

  switch (provider) {
    case Provider.OPENAI:
      return buildOpenAIModel(model);
    case Provider.GOOGLE:
      return buildGoogleModel(model);
    case Provider.OPENROUTER:
      return buildOpenRouterModel(model);
    case Provider.OLLAMA:
      return buildOllamaModel(model, config.ollamaBaseUrl);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
