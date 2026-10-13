import React, { useEffect, useRef, useState } from "react";
const api = window.renameDesktop;
const basename = (value) => value.split(/[\\/]/).pop();
function Result({ item, mode, busy, onAction }) {
  const [location, setLocation] = useState(0);
  const file = item.locations[location] || item.locations[0];
  return (
    <article className="search-result">
      <div className="search-result-heading">
        <div>
          <h3 title={file.path}>{basename(file.path)}</h3>
          <small>
            {item.category || "Без катэгорыі"}
            {item.date ? " · " + item.date : ""} ·{" "}
            {file.source === "drive" ? "Google Drive" : "Лакальны файл"} ·{" "}
            {item.coverage === "full"
              ? "Поўны тэкст"
              : item.coverage === "error"
                ? "Памылка чытання"
                : "Частковы тэкст"}
          </small>
        </div>
        <div className="search-result-actions">
          <span
            className="search-score"
            title={
              mode === "semantic"
                ? "Cosine similarity. Большае значэнне — бліжэйшае супадзенне па сэнсе. Гэта не працэнт упэўненасці."
                : "Score дакладнага пошуку: −BM25. Большае значэнне — вышэйшы ранг. Шкала адрозніваецца ад пошуку па сэнсе."
            }
          >
            {mode === "semantic" ? "Score" : "Score (−BM25)"}:{" "}
            {Number.isFinite(item.score)
              ? mode === "semantic"
                ? item.score.toFixed(3)
                : item.score.toPrecision(3)
              : "—"}
          </span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => onAction(item.id, file.path, "open")}
          >
            Адкрыць
          </button>
        </div>
      </div>
      {item.summary && <p className="search-summary">{item.summary}</p>}
      {item.matches.map(
        (match, index) =>
          match.text && (
            <details className="search-match" key={index} open={index === 0}>
              <summary>
                {match.kind === "description"
                  ? "Апісанне файла"
                  : match.pageStart
                    ? `Старонка ${match.pageStart}${match.pageEnd !== match.pageStart ? "–" + match.pageEnd : ""}`
                    : "Знойдзены ўрывак"}
              </summary>
              <p>{match.text}</p>
            </details>
          ),
      )}
      <div className="search-result-footer">
        {item.locations.length > 1 ? (
          <select
            aria-label="Размяшчэнне копіі"
            value={location}
            onChange={(event) => setLocation(Number(event.target.value))}
          >
            {item.locations.map((loc, index) => (
              <option value={index} key={loc.path}>
                {loc.path}
              </option>
            ))}
          </select>
        ) : (
          <span title={file.path}>{file.path}</span>
        )}
        <button
          className="button ghost"
          disabled={busy}
          onClick={() => onAction(item.id, file.path, "reveal")}
        >
          У папцы
        </button>
        <button
          className="button ghost"
          disabled={busy}
          onClick={() => onAction(item.id, file.path, "add")}
        >
          У «Файлы»
        </button>
      </div>
    </article>
  );
}
export default function SearchPage({
  active,
  busy,
  categories,
  importFiles,
  openSettings,
}) {
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("semantic"),
    [filters, setFilters] = useState({
      source: "",
      category: "",
      dateFrom: "",
      dateTo: "",
    }),
    [results, setResults] = useState([]),
    [resultMode, setResultMode] = useState("semantic"),
    [status, setStatus] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false);
  const request = useRef(0);
  const lastResync = useRef(null);
  useEffect(() => {
    const off = api.onCatalogStatus?.(setStatus);
    return () => off?.();
  }, []);
  useEffect(() => {
    if (active) {
      setLoading(false);
      api
        .catalogStatus?.()
        .then(setStatus)
        .catch((failure) => setError(failure.message));
    }
    return () => {
      request.current++;
    };
  }, [active]);
  useEffect(() => {
    const finished = status?.lastResync?.finishedAt;
    if (!finished || finished === lastResync.current) return;
    lastResync.current = finished;
    if (!status.lastResync.cancelled && (searched || loading)) {
      request.current++;
      setResults([]);
      setSearched(false);
      setLoading(false);
      if (active && query.trim()) search();
    }
  }, [status?.lastResync?.finishedAt]);
  async function search(text = query) {
    const id = ++request.current;
    text = text.trim();
    if (!text) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.searchCatalog({
        query: text,
        mode,
        filters,
        limit: 20,
      });
      if (id === request.current) {
        setResults(result);
        setResultMode(mode);
        setSearched(true);
      }
    } catch (failure) {
      if (id === request.current) {
        setError(failure.message || String(failure));
        setResults([]);
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  function changeQuery(value) {
    request.current++;
    setQuery(value);
    setResults([]);
    setSearched(false);
    setLoading(false);
    setError("");
  }
  async function control(method, value) {
    setError("");
    try {
      setStatus(await api[method](value));
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function action(id, location, type) {
    setError("");
    try {
      const result = await api.catalogFile({ id, location, action: type });
      if (type === "add") importFiles([result]);
    } catch (failure) {
      setError(failure.message);
    }
  }
  if (!active) return null;
  const running = status?.current,
    pending =
      status?.jobs
        ?.filter((job) => job.state === "pending" || job.state === "running")
        .reduce((total, job) => total + job.count, 0) || 0;
  return (
    <main className="search-page">
      <div className="search-title">
        <div>
          <span className="eyebrow">КАТАЛОГ</span>
          <h2>Знайдзі файл па змесціве</h2>
          <p>
            Апісанні і распазнаны тэкст захоўваюцца разам з размяшчэннем файлаў.
          </p>
        </div>
        <button className="button secondary" onClick={openSettings}>
          Налады пошуку
        </button>
      </div>
      <form
        className="catalog-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <input
          aria-label="Пошукавы запыт"
          placeholder="Напрыклад: дамова на бухгалтарскія паслугі…"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
        />
        <select
          aria-label="Рэжым пошуку"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="semantic">Па сэнсе</option>
          <option value="exact">Па словах і нумарах</option>
        </select>
        <button className="button primary" disabled={loading || !query.trim()}>
          Знайсці
        </button>
      </form>
      <div className="search-filters">
        <label>
          Крыніца
          <select
            value={filters.source}
            onChange={(event) =>
              setFilters({ ...filters, source: event.target.value })
            }
          >
            <option value="">Усе</option>
            <option value="local">Лакальныя файлы</option>
            <option value="drive">Google Drive</option>
          </select>
        </label>
        <label>
          Катэгорыя
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters({ ...filters, category: event.target.value })
            }
          >
            <option value="">Усе</option>
            {categories.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          Дата ад
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) =>
              setFilters({ ...filters, dateFrom: event.target.value })
            }
          />
        </label>
        <label>
          Дата да
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) =>
              setFilters({ ...filters, dateTo: event.target.value })
            }
          />
        </label>
      </div>
      <div className="catalog-status">
        <div>
          <strong>
            {status?.documents || 0} дакументаў · {status?.vectors || 0}{" "}
            вектараў
          </strong>
          <small>
            Поўны тэкст: {status?.full || 0} · частковы: {status?.partial || 0}{" "}
            · недаступных шляхоў: {status?.missing || 0}
          </small>
          {status?.model && (
            <small>
              {status.model} · {status.dimensions || 1024} вымярэнняў
            </small>
          )}
        </div>
        <div className="catalog-controls">
          <button
            className="button ghost"
            disabled={Boolean(
              busy || status?.migration || status?.resync?.phase === "cleanup",
            )}
            onClick={() =>
              control(status?.resync ? "cancelCatalogResync" : "resyncCatalog")
            }
          >
            {status?.resync ? "Спыніць рэсінк" : "Рэсінк каталога"}
          </button>
          <button
            className="button ghost"
            disabled={Boolean(busy || status?.resync)}
            onClick={() => control("indexCatalog")}
          >
            Дачытаць і індэксаваць
          </button>
          <button
            className="button ghost"
            onClick={() => control("pauseCatalog", !status?.paused)}
          >
            {status?.paused ? "Працягнуць" : "Паўза"}
          </button>
          <button
            className="button ghost"
            disabled={Boolean(status?.resync)}
            onClick={() => control("retryCatalog")}
          >
            Паўтарыць памылкі
          </button>
        </div>
      </div>
      {(status?.resync || status?.migration || running || pending > 0) && (
        <p className="catalog-progress" role="status">
          {status?.resync
            ? status.resync.phase === "cleanup"
              ? "Ачышчэнне кэша аналізу…"
              : `Рэсінк: ${status.resync.current} / ${status.resync.total}${status.resync.filePath ? " · " + basename(status.resync.filePath) : ""}`
            : status?.migration
              ? `Перанос кэша: ${status.migration.current} / ${status.migration.total}`
              : status?.foreground
                ? "Індэксацыя чакае заканчэння аналізу."
                : status?.paused
                  ? "Індэксацыя прыпынена."
                  : running
                    ? `${running.phase === "read" ? "Чытанне" : "Embeddings"}: ${basename(running.filePath || "")}${running.totalPages ? " · старонка " + running.page + " / " + running.totalPages : ""}${running.total ? " · " + running.current + " / " + running.total : ""}`
                    : `У чарзе: ${pending}`}
        </p>
      )}
      {!status?.resync && status?.lastResync && (
        <p className="catalog-progress" role="status">
          {status.lastResync.cancelled
            ? "Рэсінк спынены; ачышчэнне не выконвалася."
            : `Рэсінк завершаны: прыбрана ${status.lastResync.documentsRemoved} дакументаў, ${status.lastResync.pathsRemoved} шляхоў і ${status.lastResync.vectorsRemoved} вектараў усіх версій. Недаступных шляхоў захавана: ${status.lastResync.unavailable}.`}
        </p>
      )}
      {!!status?.lastResync?.errors?.length && (
        <p className="catalog-error" role="alert">
          Не ўдалося ачысціць кэш: {status.lastResync.errors.length}. Паўтары
          рэсінк. {status.lastResync.errors[0].error}
        </p>
      )}
      {(error || status?.error) && (
        <p className="catalog-error" role="alert">
          {error || status.error}
        </p>
      )}
      {!!status?.errors?.length && (
        <details className="catalog-errors">
          <summary>Памылкі індэксацыі: {status.errors.length}</summary>
          {status.errors.map((failure, index) => (
            <p key={index}>
              <strong>{basename(failure.filePath || failure.hash)}</strong> —{" "}
              {failure.error}
            </p>
          ))}
        </details>
      )}
      <div className="search-results" aria-busy={loading}>
        {loading ? (
          <p className="search-empty">Шукаем…</p>
        ) : (
          results.map((item) => (
            <Result
              item={item}
              mode={resultMode}
              key={item.id}
              busy={Boolean(busy)}
              onAction={action}
            />
          ))
        )}
        {!loading && !results.length && !error && (
          <p className="search-empty">
            {searched && query.trim()
              ? "Нічога не знойдзена. Паспрабуй іншы запыт або правер ахоп індэксацыі."
              : "Увядзі запыт і націсні «Знайсці»."}
          </p>
        )}
      </div>
      <footer className="search-footer">
        Паказана: {results.length} дакументаў
        <button
          className="button ghost"
          disabled={loading || !query.trim()}
          onClick={() => search()}
        >
          Абнавіць вынікі
        </button>
      </footer>
    </main>
  );
}
