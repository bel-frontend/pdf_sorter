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

const OPENAI_MODELS = new Set([
  Model.GPT4o,
  Model.GPT4oMini,
  Model.GPT4_1,
  Model.GPT4_1_NANO,
  Model.GPT5,
  Model.GPT5_1,
  Model.GPT5_MINI,
  Model.GPT5_NANO,
]);

const GOOGLE_MODELS = new Set([Model.GEMINI_PRO]);

function inferProvider(model, provider) {
  if (provider && provider !== "auto") return provider;
  if (OPENAI_MODELS.has(model) || model.startsWith("gpt-")) return "openai";
  if (GOOGLE_MODELS.has(model) || model.startsWith("gemini-")) return "google";
  return "ollama";
}

export function buildChatModel(config) {
  const model = config.model || process.env.OPENAI_MODEL || Model.GPT4oMini;
  const provider = inferProvider(model, config.provider);

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for provider=openai");
    }

    const openAiOptions = {
      apiKey: process.env.OPENAI_API_KEY,
      model,
    };

    if (!model.startsWith("gpt-5")) {
      openAiOptions.temperature = 0;
    }

    if (model.startsWith("gpt-5")) {
      openAiOptions.useResponsesApi = true;
      openAiOptions.reasoning = { effort: "minimal" };
    }

    return new ChatOpenAI(openAiOptions);
  }

  if (provider === "google") {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_GEMINI_API_KEY is required for provider=google");
    }

    return new ChatGoogleGenerativeAI({
      model,
      temperature: 0,
      apiKey,
    });
  }

  return new ChatOllama({
    baseUrl: config.ollamaBaseUrl,
    model: config.model || process.env.OLLAMA_MODEL || Model.GPT_OSS_20B,
    temperature: 0,
  });
}
