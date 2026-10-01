import React from "react";

const PROVIDER_LABELS = {
  openai: "OpenAI",
  ollama: "Ollama",
  google: "Google Gemini",
  openrouter: "OpenRouter",
};

function SettingsPage({
  config,
  settings,
  credentials,
  setCredentials,
  updateSetting,
  updateProvider,
  updateVisionProvider,
  choosePython,
  clearCredential,
  save,
  message,
}) {
  const providerModels = config.modelOptions[settings.provider] || [];
  const visionModels = config.modelOptions[settings.visionProvider] || [];
  const providerReady = config.secretStatus.providers[settings.provider];

  return (
    <main className="settings-page">
      <div className="settings-title">
        <div>
          <span className="eyebrow">Канфігурацыя</span>
          <h2>Налады File Garden</h2>
          <p>Мадэлі, ключы і распазнаванне захоўваюцца для наступных запускаў.</p>
        </div>
        <button className="button primary settings-save-top" onClick={() => save(true)}>
          Захаваць налады
        </button>
      </div>

      <div className="settings-grid">
        <section className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <span>AI</span>
            <div><h3>Асноўная мадэль</h3><p>Выкарыстоўваецца для назваў і тэкставай класіфікацыі.</p></div>
            <i className={providerReady ? "status-ready" : "status-missing"}>
              {settings.provider === "ollama" ? "лакальна" : providerReady ? "гатова" : "няма ключа"}
            </i>
          </div>
          <div className="settings-fields three-columns">
            <label>Правайдар<select value={settings.provider} onChange={(event) => updateProvider(event.target.value)}>{Object.keys(config.modelOptions).map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}</select></label>
            <label>Мадэль<select value={settings.model} onChange={(event) => updateSetting("model", event.target.value)}>{providerModels.map((model) => <option key={model}>{model}</option>)}</select></label>
            <label>Ollama URL<input value={settings.ollamaBaseUrl} onChange={(event) => updateSetting("ollamaBaseUrl", event.target.value)} disabled={settings.provider !== "ollama" && settings.visionProvider !== "ollama"} /></label>
          </div>
        </section>

        <section className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <span>🔑</span>
            <div><h3>API-ключы</h3><p>Зашыфраваныя праз сістэмнае бяспечнае сховішча.</p></div>
            <i className={config.secretStatus.encryptionAvailable ? "status-ready" : "status-missing"}>{config.secretStatus.encryptionAvailable ? "шыфраванне ўключана" : "шыфраванне недаступнае"}</i>
          </div>
          <div className="secret-settings-grid">
            {["openai", "google", "openrouter"].map((provider) => {
              const saved = config.secretStatus.providers[provider];
              return (
                <label key={provider} className="secret-setting">
                  <span>{PROVIDER_LABELS[provider]}<em className={saved ? "saved" : "empty"}>{saved ? "захаваны" : "не зададзены"}</em></span>
                  <div className="secret-row">
                    <input type="password" autoComplete="off" placeholder={saved ? "Увядзі новы ключ для замены" : "Увядзі API-ключ"} value={credentials[provider] || ""} onChange={(event) => setCredentials((current) => ({ ...current, [provider]: event.target.value }))} />
                    {saved && <button className="button ghost" onClick={() => clearCredential(provider)}>Выдаліць</button>}
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <span>◉</span>
            <div><h3>Vision</h3><p>Аналіз фатаграфій і сканаў.</p></div>
          </div>
          <div className="settings-fields">
            <label>Vision-правайдар<select value={settings.visionProvider} onChange={(event) => updateVisionProvider(event.target.value)}>{Object.keys(config.modelOptions).map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}</select></label>
            <label>Vision-мадэль<select value={settings.visionModel} onChange={(event) => updateSetting("visionModel", event.target.value)}>{visionModels.map((model) => <option key={model}>{model}</option>)}</select></label>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <span>OCR</span>
            <div><h3>Распазнаванне тэксту</h3><p>Python і мовы для PDF ды выяў.</p></div>
          </div>
          <label>Python executable<div className="path-input"><input value={settings.readerPython} onChange={(event) => updateSetting("readerPython", event.target.value)} /><button className="button secondary" onClick={choosePython}>Выбраць</button></div></label>
          <label>Мовы OCR<input value={settings.ocrLang} onChange={(event) => updateSetting("ocrLang", event.target.value)} placeholder="en,ru,be,uk" /></label>
        </section>

        <section className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <span>↻</span>
            <div><h3>Сетка і паўторныя спробы</h3><p>Параметры запытаў да OpenAI-сумяшчальных сэрвісаў.</p></div>
          </div>
          <div className="settings-fields two-columns compact-fields">
            <label>Timeout, мс<input type="number" min="1000" max="600000" value={settings.openaiTimeoutMs} onChange={(event) => updateSetting("openaiTimeoutMs", Number(event.target.value))} /></label>
            <label>Паўторныя спробы<input type="number" min="0" max="10" value={settings.openaiMaxRetries} onChange={(event) => updateSetting("openaiMaxRetries", Number(event.target.value))} /></label>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <span>{message || "Змены пачнуць дзейнічаць пасля захавання."}</span>
        <button className="button primary" onClick={() => save(true)}>Захаваць налады</button>
      </div>
    </main>
  );
}

export default SettingsPage;
