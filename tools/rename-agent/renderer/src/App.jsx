import React, { useEffect, useMemo, useState } from "react";
import SettingsPage from "./SettingsPage.jsx";

const api = window.renameDesktop;

const basename = (value) => value?.split(/[\\/]/).pop() || value;
const dirname = (value) => value?.slice(0, Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))) || "";

function App() {
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState("rename");
  const [page, setPage] = useState("workspace");
  const [files, setFiles] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [destination, setDestination] = useState("");
  const [settings, setSettings] = useState({});
  const [categories, setCategories] = useState([]);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [planId, setPlanId] = useState("");
  const [rows, setRows] = useState([]);
  const [failures, setFailures] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [credentials, setCredentials] = useState({
    openai: "",
    google: "",
    openrouter: "",
  });

  useEffect(() => {
    api.getConfig().then((data) => {
      setConfig(data);
      setSettings(data.settings);
      setCategories(data.settings.categories || []);
      setDestination(data.settings.lastDestination || "");
      setCanUndo(data.canUndo);
    });
    const offAnalysis = api.onAnalysisProgress(setProgress);
    const offApply = api.onApplyProgress(setProgress);
    const offUndo = api.onUndoProgress(setProgress);
    return () => {
      offAnalysis();
      offApply();
      offUndo();
    };
  }, []);

  const selectedCount = rows.filter((row) => row.selected !== false).length;
  const providerReady =
    config?.secretStatus?.providers?.[settings.provider] ?? true;

  const resetPlan = () => {
    setPlanId("");
    setRows([]);
    setFailures([]);
    setErrors({});
  };

  async function addPaths(paths) {
    if (!paths?.length) return;
    setBusy("inputs");
    try {
      const result = await api.expandInputs(paths);
      setFiles((current) => [...new Set([...current, ...result.files])]);
      setRejected((current) => [...current, ...result.rejected]);
      resetPlan();
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  }

  async function chooseFiles() {
    await addPaths(await api.pickFiles());
  }

  async function chooseFolders() {
    await addPaths(await api.pickFolders());
  }

  function clearFiles() {
    setFiles([]);
    setRejected([]);
    resetPlan();
    setMessage("Спіс файлаў ачышчаны");
  }

  async function chooseDestination() {
    const picked = await api.pickDestination();
    if (!picked) return;
    setDestination(picked);
    const existing = await api.existingCategories(picked);
    setCategories((current) => [...new Set([...current, ...existing, "other"])]);
    resetPlan();
  }

  async function choosePython() {
    const pythonPath = await api.pickPython();
    if (pythonPath) updateSetting("readerPython", pythonPath);
  }

  async function persistConfiguration(showMessage = true) {
    const normalized = {
      ...settings,
      categories,
      lastDestination: destination,
      openaiTimeoutMs: Number(settings.openaiTimeoutMs || 90000),
      openaiMaxRetries: Number(settings.openaiMaxRetries || 0),
    };
    const savedSettings = await api.saveSettings(normalized);
    setSettings(savedSettings);

    const values = Object.fromEntries(
      Object.entries(credentials).filter(([, value]) => value.trim()),
    );
    if (Object.keys(values).length > 0) {
      const secretStatus = await api.saveSecrets({ values, clear: [] });
      setConfig((current) => ({ ...current, secretStatus }));
      setCredentials({ openai: "", google: "", openrouter: "" });
    }
    if (showMessage) setMessage("Налады захаваныя");
  }

  async function clearCredential(provider) {
    const secretStatus = await api.saveSecrets({ values: {}, clear: [provider] });
    setConfig((current) => ({ ...current, secretStatus }));
    setCredentials((current) => ({ ...current, [provider]: "" }));
    setMessage("Ключ выдалены з бяспечнага сховішча");
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    resetPlan();
  }

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    resetPlan();
  }

  const instructionKey =
    mode === "rename" ? "renameInstructions" : "organizeInstructions";

  function updateProvider(provider) {
    const models = config.modelOptions[provider] || [];
    setSettings((current) => ({
      ...current,
      provider,
      model: models.includes(current.model) ? current.model : models[0] || "",
    }));
    resetPlan();
  }

  function updateVisionProvider(visionProvider) {
    const models = config.modelOptions[visionProvider] || [];
    setSettings((current) => ({
      ...current,
      visionProvider,
      visionModel: models.includes(current.visionModel)
        ? current.visionModel
        : models[0] || "",
    }));
    resetPlan();
  }

  function addCategory() {
    const value = categoryDraft
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (value) setCategories((current) => [...new Set([...current, value])]);
    setCategoryDraft("");
    resetPlan();
  }

  function removeCategory(category) {
    if (category === "other") return;
    setCategories((current) => current.filter((item) => item !== category));
    resetPlan();
  }

  async function analyze() {
    if (!files.length) return setMessage("Спачатку дадай файлы або папку");
    if (mode === "organize" && !destination) return setMessage("Выберы папку выніку");
    if (!providerReady) {
      setMessage(`Для ${settings.provider} трэба захаваць API-ключ`);
      setPage("settings");
      return;
    }
    setBusy("analysis");
    setMessage("");
    setProgress({ current: 0, total: files.length });
    setErrors({});
    setRows([]);
    setFailures([]);
    try {
      await persistConfiguration(false);
      const result = await api.analyze({
        mode,
        files,
        destination,
        provider: settings.provider,
        model: settings.model,
        visionProvider: settings.visionProvider,
        visionModel: settings.visionModel,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        language: settings.language,
        pattern: settings.pattern,
        categories,
        instructions: settings[instructionKey] || "",
      });
      setPlanId(result.planId);
      setRows(result.rows.map((row) => ({ ...row, selected: true, status: "ready" })));
      setFailures(result.failures || []);
      setCategories(result.categories || categories);
      setMessage(
        result.rows.length === 0 && result.failures.length > 0
          ? `Не атрымалася стварыць план: памылак ${result.failures.length}`
          : result.cancelled
          ? `Аналіз спынены. У плане засталося ${result.rows.length} файлаў`
          : `План гатовы: ${result.rows.length} файлаў`,
      );
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  }

  function editRow(id, patch) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch, status: "ready" } : row)),
    );
    setErrors((current) => ({ ...current, [id]: undefined }));
  }

  async function openPreviewFile(rowId) {
    try {
      await api.openFile({ planId, rowId });
    } catch (error) {
      setMessage(`Не атрымалася адкрыць файл: ${error.message || error}`);
    }
  }

  const payload = useMemo(
    () => ({
      planId,
      rows: rows.map((row) => ({
        id: row.id,
        selected: row.selected !== false,
        proposedName: row.proposedName,
        category: row.category,
      })),
    }),
    [planId, rows],
  );

  async function prepareApply() {
    if (!selectedCount) return;
    try {
      const result = await api.validatePlan(payload);
      if (!result.valid) {
        setErrors(Object.fromEntries(result.errors.map((item) => [item.id, item.message])));
        setMessage("Выпраў памылкі ў плане перад ужываннем");
        return;
      }
      setConfirming(true);
    } catch (error) {
      setMessage(error.message || String(error));
    }
  }

  async function applyPlan() {
    setConfirming(false);
    setBusy("apply");
    setProgress({ current: 0, total: selectedCount });
    try {
      const result = await api.applyPlan(payload);
      if (!result.valid) {
        setErrors(Object.fromEntries(result.errors.map((item) => [item.id, item.message])));
        return;
      }
      const completed = new Set(result.completed.map((item) => item.id));
      const failed = new Map(result.failures.map((item) => [item.id, item.error]));
      setRows((current) =>
        current.map((row) => ({
          ...row,
          status: completed.has(row.id) ? "completed" : failed.has(row.id) ? "failed" : row.status,
        })),
      );
      setErrors(Object.fromEntries(failed));
      setCanUndo(result.completed.length > 0);
      setMessage(
        `Гатова: ${result.completed.length}; памылак: ${result.failures.length}`,
      );
    } catch (error) {
      setMessage(error.message || String(error));
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    setBusy("undo");
    setProgress({ current: 0, total: 0 });
    try {
      const result = await api.undo();
      if (result.error) setMessage(result.error);
      else if (result.failures.length) setMessage(`Адмена спынена: ${result.failures[0].error}`);
      else {
        setMessage(`Вернута файлаў: ${result.completed.length}`);
        setCanUndo(false);
        resetPlan();
      }
    } finally {
      setBusy("");
    }
  }

  async function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => api.pathForFile(file))
      .filter(Boolean);
    await addPaths(paths);
  }

  if (!config) return <div className="loading">Адкрываем File Garden…</div>;

  return (
    <div className={`app-shell platform-${api.platform}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">FG</div>
          <div>
            <h1>File Garden</h1>
            <p>Парадак у дакументах, які можна праверыць</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={`provider-dot ${providerReady ? "ready" : "missing"}`} />
          <span className="provider-summary">{settings.provider} · {settings.model}</span>
          <nav className="app-nav">
            <button className={page === "workspace" ? "active" : ""} onClick={() => setPage("workspace")}>Файлы</button>
            <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>Налады</button>
          </nav>
          <button className="button ghost" disabled={!canUndo || busy} onClick={undo}>
            ↶ Адмяніць апошні запуск
          </button>
        </div>
      </header>

      {page === "settings" ? (
        <SettingsPage
          config={config}
          settings={settings}
          credentials={credentials}
          setCredentials={setCredentials}
          updateSetting={updateSetting}
          updateProvider={updateProvider}
          updateVisionProvider={updateVisionProvider}
          choosePython={choosePython}
          clearCredential={clearCredential}
          save={persistConfiguration}
          message={message}
        />
      ) : (
      <main>
        <section className="hero-row">
          <div className="mode-switch" role="tablist">
            <button className={mode === "rename" ? "active" : ""} onClick={() => changeMode("rename")}>Перайменаваць</button>
            <button className={mode === "organize" ? "active" : ""} onClick={() => changeMode("organize")}>Сартаваць</button>
          </div>
          <div className="step-copy">
            <span className="eyebrow">{mode === "rename" ? "Разумныя назвы" : "Разумныя катэгорыі"}</span>
            <h2>{mode === "rename" ? "Зразумелыя назвы замест выпадковых кодаў" : "Раскладзі файлы па патрэбных папках"}</h2>
          </div>
        </section>

        <div className="workspace-grid">
          <aside className="control-column">
            <section className="card">
              <div className="section-heading"><span>01</span><h3>Файлы</h3><em>{files.length}</em></div>
              <div
                className={`dropzone ${dragging ? "dragging" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div className="drop-icon">⇩</div>
                <strong>Перацягні сюды файлы або папкі</strong>
                <small>PDF, выявы, DOC, DOCX і XML</small>
                <div className="picker-row">
                  <button className="button secondary" onClick={chooseFiles}>+ Файлы</button>
                  <button className="button secondary" onClick={chooseFolders}>+ Папкі</button>
                </div>
              </div>
              {files.length > 0 && (
                <div className="source-list">
                  <div className="source-list-toolbar">
                    <span>Выбрана: {files.length}</span>
                    <button onClick={clearFiles}>Ачысціць усе</button>
                  </div>
                  <div className="source-list-items">
                    {files.slice(0, 6).map((file) => (
                      <div key={file}><span>◇</span><div><strong>{basename(file)}</strong><small>{dirname(file)}</small></div><button aria-label={`Прыбраць ${basename(file)}`} onClick={() => { setFiles((current) => current.filter((item) => item !== file)); resetPlan(); }}>×</button></div>
                    ))}
                    {files.length > 6 && <p>і яшчэ {files.length - 6}…</p>}
                  </div>
                </div>
              )}
              {rejected.length > 0 && <p className="hint warning">Прапушчана непадтрымліваемых: {rejected.length}</p>}
            </section>

            {mode === "organize" && (
              <section className="card">
                <div className="section-heading"><span>02</span><h3>Папка выніку</h3></div>
                <button className="path-picker" onClick={chooseDestination}>
                  <span>◎</span><div><strong>{destination ? basename(destination) : "Выбраць папку"}</strong><small>{destination || "Файлы будуць перанесены сюды"}</small></div>
                </button>
              </section>
            )}

            <section className="card">
              <div className="section-heading"><span>{mode === "organize" ? "03" : "02"}</span><h3>Правілы</h3></div>
              {mode === "rename" && (
                <>
                  <label>Мова назваў<select value={settings.language} onChange={(e) => updateSetting("language", e.target.value)}><option value="en">English</option><option value="pl">Polski</option><option value="be">Беларуская (лацінка)</option><option value="ru">Русская (лацінка)</option></select></label>
                  <label>Шаблон назвы<input value={settings.pattern} onChange={(e) => updateSetting("pattern", e.target.value)} /></label>
                  <p className="hint">Палі: {`{category} {topic} {person} {date}`}</p>
                </>
              )}
              {mode === "organize" && (
                <div className="categories">
                  {categories.map((category) => <span key={category}>{category}<button disabled={category === "other"} onClick={() => removeCategory(category)}>×</button></span>)}
                  <div className="category-add"><input placeholder="новая_катэгорыя" value={categoryDraft} onChange={(e) => setCategoryDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} /><button onClick={addCategory}>+</button></div>
                </div>
              )}
              <label>Дадатковая інструкцыя<textarea rows="4" placeholder={mode === "rename" ? "Напрыклад: для рахункаў заўсёды ўказвай кампанію…" : "Напрыклад: усе дакументы ZUS складвай у taxes_and_social…"} value={settings[instructionKey] || ""} onChange={(e) => updateSetting(instructionKey, e.target.value)} /></label>
            </section>

            <button className="button primary analyze" disabled={Boolean(busy) || !files.length} onClick={analyze}>
              {busy === "analysis" ? "Аналізуем…" : "Стварыць план →"}
            </button>
            {busy === "analysis" && <button className="button ghost full" onClick={() => api.cancelAnalysis()}>Спыніць аналіз</button>}
          </aside>

          <section className="preview-column card">
            <div className="preview-header">
              <div><span className="eyebrow">Preview</span><h3>Правер вынік перад зменамі</h3></div>
              {rows.length > 0 && <span className="selection-count">Выбрана {selectedCount} з {rows.length}</span>}
            </div>

            {busy && progress.total > 0 && (
              <div className="progress-wrap">
                <div>
                  <span>{busy === "analysis" ? "Аналіз" : busy === "undo" ? "Адмена" : "Змяненне файлаў"}</span>
                  <span className="progress-actions"><strong>{progress.current}/{progress.total}</strong>{busy === "analysis" && <button className="stop-analysis" onClick={() => api.cancelAnalysis()}>■ Спыніць аналіз</button>}</span>
                </div>
                <progress value={progress.current} max={progress.total} />
              </div>
            )}

            {rows.length === 0 ? (
              <div className="empty-preview"><div>⌁</div><h4>Тут з’явіцца план</h4><p>Дадай файлы, апішы правілы і запусці аналіз. Нічога не зменіцца без твайго пацвярджэння.</p></div>
            ) : (
              <div className="plan-table-wrap">
                <table className="plan-table">
                  <thead><tr><th></th><th>Зыходны файл</th><th>{mode === "rename" ? "Новая назва" : "Катэгорыя"}</th><th>Упэўненасць</th></tr></thead>
                  <tbody>{rows.map((row) => (
                    <tr key={row.id} className={`${row.selected === false ? "disabled-row" : ""} ${row.status || ""}`}>
                      <td><input type="checkbox" checked={row.selected !== false} onChange={(e) => editRow(row.id, { selected: e.target.checked })} /></td>
                      <td><button className="file-open" onClick={() => openPreviewFile(row.id)} title="Адкрыць зыходны файл"><span>↗</span><strong>{basename(row.sourcePath)}</strong></button><small>{dirname(row.sourcePath)}</small>{row.summary && <p>{row.summary}</p>}</td>
                      <td>{mode === "rename" ? <input className={errors[row.id] ? "invalid" : ""} value={row.proposedName} onChange={(e) => editRow(row.id, { proposedName: e.target.value })} /> : <select className={errors[row.id] ? "invalid" : ""} value={row.category} onChange={(e) => editRow(row.id, { category: e.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select>}{errors[row.id] && <span className="row-error">{errors[row.id]}</span>}{row.status === "completed" && <span className="row-success">Гатова</span>}</td>
                      <td><span className="confidence"><i style={{ width: `${Math.round((row.confidence || 0) * 100)}%` }} /></span><small>{Math.round((row.confidence || 0) * 100)}%</small></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {failures.length > 0 && <div className="failure-box"><strong>Не атрымалася прааналізаваць: {failures.length} з {files.length}</strong>{[...new Map(failures.map((failure) => [failure.error, failure])).values()].slice(0, 3).map((failure) => <p key={`${failure.sourcePath}-${failure.error}`}>{failure.error}</p>)}{failures.length > 3 && <small>Памылкі згрупаваныя; праграма знайшла ўсе {files.length} файлаў.</small>}</div>}
            <div className="preview-footer">
              <p>{message || "Змены будуць выкананы толькі пасля пацвярджэння."}</p>
              {busy === "analysis" ? (
                <button className="button danger" onClick={() => api.cancelAnalysis()}>■ Спыніць аналіз</button>
              ) : (
                <button className="button primary" disabled={!planId || !selectedCount || Boolean(busy)} onClick={prepareApply}>{mode === "rename" ? "Перайменаваць" : "Перамясціць"} {selectedCount || ""} файлаў</button>
              )}
            </div>
          </section>
        </div>
      </main>
      )}

      {confirming && <div className="modal-backdrop"><div className="modal"><span className="modal-icon">!</span><h3>Пацвердзіць змены?</h3><p>{mode === "rename" ? "Будуць перайменаваны" : "Будуць перамешчаны"} {selectedCount} файлаў. Апошні запуск можна будзе адмяніць.</p><div><button className="button ghost" onClick={() => setConfirming(false)}>Назад</button><button className="button primary" onClick={applyPlan}>Так, выканаць</button></div></div></div>}
    </div>
  );
}

export default App;
