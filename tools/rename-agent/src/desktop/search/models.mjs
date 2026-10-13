export const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:8b";
export const EMBEDDING_MODELS = [
  {
    model: "qwen3-embedding:8b",
    dimensions: 4096,
    label: "8B · высокая якасць · каля 4,7 ГБ",
  },
  { model: "qwen3-embedding:4b", dimensions: 2560, label: "4B · каля 2,5 ГБ" },
  {
    model: "qwen3-embedding:0.6b",
    dimensions: 1024,
    label: "0.6B · хуткая · каля 639 МБ",
  },
];
export function embeddingDimensions(model = DEFAULT_EMBEDDING_MODEL) {
  if (/^qwen3-embedding(?::(?:latest|8b(?:-.*)?))?$/.test(model)) return 4096;
  if (/^qwen3-embedding:4b(?:-.*)?$/.test(model)) return 2560;
  return 1024;
}
