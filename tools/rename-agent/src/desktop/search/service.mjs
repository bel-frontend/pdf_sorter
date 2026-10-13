import { Worker } from "node:worker_threads";
export function createSearchService(directory, config, onEvent = () => {}) {
  const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    workerData: { directory, config },
  });
  let id = 0;
  const pending = new Map();
  let failure = null;
  let closing = false;
  worker.on("message", (message) => {
    if (message.event) {
      onEvent(message.event, message.data);
      return;
    }
    const promise = pending.get(message.id);
    if (!promise) return;
    pending.delete(message.id);
    message.error
      ? promise.reject(new Error(message.error))
      : promise.resolve(message.data);
  });
  const fail = (error) => {
    failure = error;
    for (const promise of pending.values()) promise.reject(error);
    pending.clear();
    if (!closing) onEvent("status", { error: error.message, unavailable: true });
  };
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (code) fail(new Error("Працэс каталога спыніўся"));
  });
  const service = {
    call(method, args) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        worker.postMessage({ id, method, args });
      });
    },
    async close(timeoutMs = 5000) {
      if (closing) return;
      closing = true;
      // A stuck OCR or embedding request must not block application exit.
      let timer;
      await Promise.race([
        service.call("shutdown").catch(() => {}),
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(timer);
      return worker.terminate();
    },
  };
  return service;
}
