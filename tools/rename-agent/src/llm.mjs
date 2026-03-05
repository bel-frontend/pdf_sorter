import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

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
  GEMMA3_12: "gemma3:12b",
  GEMINI_PRO: "gemini-2.5-pro",
  GPT_OSS_20B: "gpt-oss:20b",
};

const OPENAI_DEFAULT_OPTIONS = {
  timeout: Number(process.env.OPENAI_TIMEOUT_MS || 90000),
  maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 2),
};

const OPENAI_MODEL_OPTIONS = {
  [Model.GPT4o]: { temperature: 0.7 },
  [Model.GPT4oMini]: { temperature: 0.7 },
  [Model.GPT4_1]: { temperature: 0.7 },
  [Model.GPT4_1_NANO]: { temperature: 0.7 },
  [Model.GPT5]: {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
  [Model.GPT5_1]: {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "none" },
  },
  [Model.GPT5_MINI]: {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
  [Model.GPT5_NANO]: {
    temperature: 1,
    useResponsesApi: true,
    reasoning: { effort: "minimal" },
  },
};

const SUPPORTED_MODELS = new Set(Object.values(Model));

function assertSupportedModel(model) {
  if (SUPPORTED_MODELS.has(model)) return;

  const supported = Object.values(Model).join(", ");
  throw new Error(
    `Unsupported model: ${model}. Supported models: ${supported}`,
  );
}

function buildOpenAIModel(model) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for OpenAI models");
  }

  const options = {
    apiKey: process.env.OPENAI_API_KEY,
    model,
    ...OPENAI_DEFAULT_OPTIONS,
    ...(OPENAI_MODEL_OPTIONS[model] || { temperature: 0 }),
  };

  return new ChatOpenAI(options);
}

function buildGoogleModel(model) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GEMINI_API_KEY is required for Gemini models");
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
    model: model || process.env.OLLAMA_MODEL || Model.GPT_OSS_20B,
    temperature: 0,
  });
}

export function buildChatModel(config) {
  const model = config.model || process.env.OPENAI_MODEL || Model.GPT4oMini;
  assertSupportedModel(model);

  switch (model) {
    case Model.GPT4o:
    case Model.GPT4oMini:
    case Model.GPT4_1:
    case Model.GPT4_1_NANO:
    case Model.GPT5:
    case Model.GPT5_1:
    case Model.GPT5_MINI:
    case Model.GPT5_NANO:
      return buildOpenAIModel(model);
    case Model.GEMINI_PRO:
      return buildGoogleModel(model);
    case Model.LLM3:
    case Model.MISTRAL:
    case Model.LLAMA3_3:
    case Model.GEMMA3_12:
    case Model.GPT_OSS_20B:
      return buildOllamaModel(model, config.ollamaBaseUrl);
    default:
      throw new Error(`Unsupported model: ${model}`);
  }
}
