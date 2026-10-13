import { digest } from "./chunks.mjs";
import { DEFAULT_EMBEDDING_MODEL, embeddingDimensions } from "./models.mjs";
export class OllamaEmbeddings {
  constructor({
    baseUrl = "http://localhost:11434",
    model = DEFAULT_EMBEDDING_MODEL,
    size = 2000,
    overlap = 400,
    fetchImpl = fetch,
  } = {}) {
    Object.assign(this, {
      baseUrl: baseUrl.replace(/\/$/, ""),
      model,
      size,
      overlap,
      fetchImpl,
      dimensions: embeddingDimensions(model),
    });
  }
  async request(endpoint, body, signal) {
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + endpoint, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: signal
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(endpoint === "/api/pull" ? 3600000 : 120000),
            ])
          : AbortSignal.timeout(endpoint === "/api/pull" ? 3600000 : 120000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "Няма злучэння з Ollama. Запусці Ollama і правер URL у наладах пошуку.",
      );
    }
    if (!response.ok)
      throw new Error(
        `Ollama: ${(await response.json().catch(() => ({}))).error || response.status}`,
      );
    return response;
  }
  async ready(signal) {
    const { models = [] } = await (
      await this.request("/api/tags", null, signal)
    ).json();
    const entry = models.find(
      (m) => m.name === this.model || m.model === this.model,
    );
    if (!entry)
      throw new Error(
        `Embedding-мадэль ${this.model} не ўсталяваная. Спампуй яе ў наладах пошуку.`,
      );
    this.profile = digest([
      "ollama",
      this.baseUrl,
      this.model,
      entry.digest,
      this.dimensions,
      this.size,
      this.overlap,
      "chunks-v1",
      "query-v1",
    ]);
    return this.profile;
  }
  async embedDocuments(texts, signal) {
    const data = await (
      await this.request(
        "/api/embed",
        {
          model: this.model,
          input: texts,
          truncate: false,
          dimensions: this.dimensions,
        },
        signal,
      )
    ).json();
    if (
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== texts.length ||
      data.embeddings.some(
        (v) =>
          v.length !== this.dimensions ||
          v.some((n) => !Number.isFinite(n)) ||
          !v.some((n) => n !== 0),
      )
    )
      throw new Error(
        `Embedding-мадэль вярнула няправільныя вектары (патрэбна ${this.dimensions} вымярэнняў)`,
      );
    return data.embeddings;
  }
  async embedQuery(query, signal) {
    const input = this.model.startsWith("qwen3-embedding")
      ? `Instruct: Given a document search query, retrieve relevant document passages.\nQuery: ${query}`
      : query;
    return (await this.embedDocuments([input], signal))[0];
  }
  async pull(signal, onProgress) {
    const response = await this.request(
      "/api/pull",
      { model: this.model, stream: true },
      signal,
    );
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const data = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (data.error) throw new Error(data.error);
        onProgress(data);
      }
    }
  }
}
export class SqliteVectorStore {
  constructor(catalog) {
    this.catalog = catalog;
  }
  upsert(profile, chunks, vectors) {
    this.catalog.putVectors(profile, chunks, vectors);
  }
  search(options) {
    return this.catalog.search(options);
  }
}
