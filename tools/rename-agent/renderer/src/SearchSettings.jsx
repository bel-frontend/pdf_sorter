import React, { useEffect, useState } from "react";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  embeddingDimensions,
} from "../../src/desktop/search/models.mjs";
const api = window.renameDesktop;
export default function SearchSettings({
  settings,
  updateSetting,
  save,
  busy,
}) {
  const [pulling, setPulling] = useState(false),
    [progress, setProgress] = useState(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    const off = api.onSearchModelProgress?.(setProgress);
    const statusOff = api.onCatalogStatus?.((value) =>
      setPulling(Boolean(value.pulling)),
    );
    api
      .catalogStatus?.()
      .then((value) => setPulling(Boolean(value.pulling)))
      .catch(() => {});
    return () => {
      off?.();
      statusOff?.();
    };
  }, []);
  async function pull() {
    setPulling(true);
    setMessage("");
    try {
      await save(false);
      await api.pullSearchModel();
      setMessage("Мадэль гатовая. Вектарная індэксацыя працягнецца ў фоне.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setPulling(false);
    }
  }
  return (
    <section className="settings-card settings-card-wide search-settings">
      <div className="settings-card-heading">
        <span>⌕</span>
        <div>
          <h3>Пошук па сэнсе</h3>
          <p>Лакальная мадэль і індэкс поўнага тэксту.</p>
        </div>
      </div>
      <div className="settings-fields three-columns">
        <label>
          Embedding-мадэль
          <input
            list="embedding-model-options"
            value={settings.searchModel || DEFAULT_EMBEDDING_MODEL}
            disabled={pulling}
            onChange={(event) =>
              updateSetting("searchModel", event.target.value)
            }
          />
          <datalist id="embedding-model-options">
            {EMBEDDING_MODELS.map((item) => (
              <option key={item.model} value={item.model}>
                {item.label}
              </option>
            ))}
          </datalist>
          <small>
            {embeddingDimensions(
              settings.searchModel || DEFAULT_EMBEDDING_MODEL,
            )}{" "}
            вымярэнняў
          </small>
        </label>
        <label>
          Ollama URL
          <input
            value={settings.searchBaseUrl || "http://localhost:11434"}
            disabled={pulling}
            onChange={(event) =>
              updateSetting("searchBaseUrl", event.target.value)
            }
          />
        </label>
        <label>
          Памер фрагмента, сімвалы
          <input
            type="number"
            min="500"
            max="8000"
            disabled={pulling}
            value={settings.searchChunkSize ?? 2000}
            onChange={(event) =>
              updateSetting("searchChunkSize", Number(event.target.value))
            }
          />
        </label>
        <label>
          Overlap, сімвалы
          <input
            type="number"
            min="0"
            max="2000"
            disabled={pulling}
            value={settings.searchOverlap ?? 400}
            onChange={(event) =>
              updateSetting("searchOverlap", Number(event.target.value))
            }
          />
        </label>
      </div>
      <p className="settings-note">
        Змена мадэлі або фрагментаў перабудоўвае вектары з захаванага тэксту.
        Паўторны OCR не патрабуецца. Асноўная мадэль аналізу наладжваецца
        асобна.
      </p>
      <div className="drive-actions">
        <button
          className="button secondary"
          disabled={Boolean(busy) || pulling}
          onClick={pull}
        >
          Спампаваць embedding-мадэль
        </button>
        {pulling && (
          <button
            className="button ghost"
            onClick={() => api.cancelSearchModel()}
          >
            Спыніць спампоўванне
          </button>
        )}
      </div>
      {pulling && (
        <div className="model-download-progress" role="status">
          <p>{progress?.status || "Падключаемся да Ollama…"}</p>
          {progress?.total > 0 && (
            <progress value={progress.completed || 0} max={progress.total} />
          )}
        </div>
      )}
      {message && (
        <p className="settings-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
