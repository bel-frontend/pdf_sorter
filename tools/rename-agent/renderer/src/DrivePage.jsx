import React, { useEffect, useRef, useState } from 'react';
const api = window.renameDesktop;
const FOLDER = 'application/vnd.google-apps.folder';
const formatSize = value => !value ? '—' : Number(value) < 1048576 ? `${Math.ceil(Number(value) / 1024)} КБ` : `${(Number(value) / 1048576).toFixed(1)} МБ`;

export default function DrivePage({ active, config, settings, busy, message, connect, setBusy, setMessage, setProgress, importFiles, uploadResults, canUploadResults, saveConfiguration }) {
  const [trail, setTrail] = useState([{ id: 'root', name: 'Мой дыск' }]);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState({});
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [nextPageToken, setNextPageToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [downloadFailures, setDownloadFailures] = useState([]);
  const [savedImports, setSavedImports] = useState([]);
  const requestNumber = useRef(0);
  const parentId = trail[trail.length - 1].id;
  const connected = config.secretStatus.googleDriveConnected;
  const canBrowse = config.secretStatus.googleDriveCanBrowse;

  useEffect(() => {
    requestNumber.current++;
    setSelected({}); setFiles([]); setTrail([{ id: 'root', name: 'Мой дыск' }]); setSearch(''); setDraft(''); setError(''); setDownloadFailures([]);
  }, [settings.googleDriveAccount?.emailAddress, connected]);

  async function load(more = false) {
    const request = ++requestNumber.current;
    setLoading(true); setError('');
    if (!more) { setFiles([]); setNextPageToken(''); }
    try {
      const result = await api.listGoogleDrive({ parentId, search, pageToken: more ? nextPageToken : '' });
      if (request !== requestNumber.current) return;
      setFiles(current => more ? [...new Map([...current, ...result.files].map(file => [file.id, file])).values()] : result.files);
      setNextPageToken(result.nextPageToken);
    } catch (failure) { if (request === requestNumber.current) setError(failure.message || String(failure)); }
    finally { if (request === requestNumber.current) setLoading(false); }
  }
  useEffect(() => {
    if (active && connected && canBrowse) load();
    return () => { requestNumber.current++; };
  }, [active, connected, canBrowse, parentId, search, refresh]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    api.getDriveImports().then(imports => { if (current) setSavedImports(imports); }).catch(() => {});
    return () => { current = false; };
  }, [active, refresh, settings.googleDriveAccount?.emailAddress]);

  function enterFolder(file) { setTrail(current => [...current, { id: file.id, name: file.name }]); setDraft(''); setSearch(''); }
  function toggle(file) { setSelected(current => { const next = { ...current }; if (next[file.id]) delete next[file.id]; else next[file.id] = file; return next; }); }
  async function download() {
    const ids = Object.keys(selected);
    setBusy('drive-download'); setProgress({ current: 0, total: ids.length }); setDownloadFailures([]);
    try {
      const result = await api.downloadGoogleDrive(ids);
      setDownloadFailures(result.failures);
      if (result.files.length) {
        setSelected(current => { const next = { ...current }; for (const file of result.files) delete next[file.driveId]; return next; });
        importFiles(result.files.map(file => file.localPath));
      }
      setMessage(`Google Drive: спампавана ${result.files.length}; памылак ${result.failures.length}${result.canceled ? '. Спампоўванне спынена' : ''}. Копіі даступныя ў раздзеле «Файлы».`);
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(''); }
  }
  async function upload() {
    setBusy('drive'); setProgress({ current: 0, total: 0 }); setError('');
    try {
      await saveConfiguration();
      const result = await api.uploadFilesToGoogleDrive();
      if (result.canceled) return;
      const skipped = result.completed.filter(file => file.driveFile?.skipped).length;
      setMessage(`Google Drive: скапіравана ${result.completed.length - skipped}; прапушчана ${skipped}; памылак ${result.failures.length}`);
      setDownloadFailures(result.failures.map(file => ({ name: file.to, error: file.error })));
      setRefresh(current => current + 1);
    } catch (failure) { setError(failure.message || String(failure)); }
    finally { setBusy(''); }
  }
  if (!active) return null;
  return <main className="drive-page">
    <div className="drive-title"><div><span className="eyebrow">GOOGLE DRIVE</span><h2>Файлы з твайго дыску</h2><p>{connected ? settings.googleDriveAccount?.emailAddress || 'Акаўнт падключаны' : 'Падключы акаўнт, каб капіраваць і аналізаваць файлы.'}</p></div>
      {connected && <div className="drive-top-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={upload}>↑ Загрузіць файлы</button>{canUploadResults && <button className="button secondary" disabled={Boolean(busy)} onClick={uploadResults}>↑ Вынікі сартавання</button>}</div>}
    </div>
    {!connected || !canBrowse ? <section className="drive-connect-card card"><h3>{connected ? 'Дазвол на чытанне файлаў' : 'Падключэнне Google Drive'}</h3>
      <p>Для прагляду дыску і спампоўвання копій дазволь File Garden чытаць файлы. Зыходныя файлы ў Google Drive застануцца без зменаў.</p>
      <button className="button primary" disabled={Boolean(busy) || !config.googleDrive?.available} onClick={() => connect({ browse: true })}>{busy === 'google-connect' ? 'Чакаем Google…' : connected ? 'Дазволіць чытанне файлаў' : 'Падключыць Google Drive'}</button>
      {busy === 'google-connect' && <button className="button ghost" onClick={() => api.cancelGoogleDrive()}>Скасаваць уваход</button>}
      {!config.googleDrive?.available && <p>Падключэнне Google Drive недаступнае ў гэтай зборцы.</p>}
    </section> : <section className="drive-browser card">
      <div className="drive-toolbar"><nav className="drive-breadcrumbs" aria-label="Папка Google Drive">{trail.map((folder, index) => <React.Fragment key={folder.id}>{index > 0 && <span>›</span>}<button disabled={Boolean(busy) || loading} title={folder.name} onClick={() => { setTrail(trail.slice(0, index + 1)); setDraft(''); setSearch(''); }}>{folder.name}</button></React.Fragment>)}</nav>
        <button className="button ghost" disabled={Boolean(busy) || loading} onClick={() => setRefresh(current => current + 1)}>↻ Абнавіць</button></div>
      <form className="drive-search" onSubmit={event => { event.preventDefault(); setSearch(draft); }}><input aria-label="Пошук у папцы Google Drive" placeholder="Знайсці па назве ў гэтай папцы…" value={draft} disabled={Boolean(busy)} onChange={event => setDraft(event.target.value)} /><button className="button secondary" disabled={Boolean(busy) || loading}>Знайсці</button></form>
      <div className="drive-list" aria-busy={loading}>
        <div className="drive-list-heading"><span></span><strong>Назва</strong><span>Памер</span></div>
        {files.map(file => <div className="drive-file" key={file.id}>
          {file.mimeType === FOLDER ? <span className="drive-folder-icon" aria-hidden="true">▱</span> : <input type="checkbox" aria-label={`Выбраць ${file.name}`} checked={Boolean(selected[file.id])} disabled={Boolean(busy) || !file.downloadable} onChange={() => toggle(file)} />}
          {file.mimeType === FOLDER ? <button className="drive-folder-name" disabled={Boolean(busy) || loading} title={file.name} onClick={() => enterFolder(file)}>{file.name}</button> : <div className="drive-file-name"><strong title={file.name}>{file.name}</strong><small>{file.exportPdf ? 'Google-дакумент · копія PDF' : !file.downloadable ? file.capabilities?.canDownload === false ? 'Спампоўванне забаронена' : 'Фармат не падтрымліваецца' : file.mimeType}</small></div>}
          <span>{file.mimeType === FOLDER ? 'Папка' : formatSize(file.size)}</span>
        </div>)}
        {loading && <p className="drive-empty" role="status">Чытаем спіс файлаў…</p>}
        {!loading && !files.length && !error && <p className="drive-empty">{search ? 'Па гэтай назве нічога не знойдзена.' : 'У гэтай папцы няма файлаў.'}</p>}
        {nextPageToken && <button className="button ghost drive-more" disabled={loading || Boolean(busy)} onClick={() => load(true)}>Паказаць яшчэ</button>}
      </div>
      <div className="drive-footer"><div><strong>Выбрана: {Object.keys(selected).length}</strong><small>Спампуюцца працоўныя копіі для OCR і аналізу.</small></div><div className="drive-footer-actions"><button className="button ghost" disabled={Boolean(busy)} onClick={() => setSelected({})}>Ачысціць выбар</button><button className="button primary" disabled={Boolean(busy) || !Object.keys(selected).length} onClick={download}>↓ Спампаваць для аналізу</button></div></div>
    </section>}
    {!!savedImports.length && <details className="drive-saved-imports"><summary>Захаваныя працоўныя копіі: {savedImports.reduce((count, item) => count + item.files.length, 0)}</summary>{savedImports.map(item => <div key={item.sessionId}><span>{new Date(item.createdAt).toLocaleString()} · {item.files.length} файлаў{item.canceled ? ' · спампоўванне спынена' : ''}</span><button className="button ghost" disabled={Boolean(busy)} onClick={() => { importFiles(item.files.map(file => file.localPath)); setMessage(`Дададзены захаваныя копіі: ${item.files.length}. Існуючы план захаваны.`); }}>Дадаць у «Файлы»</button></div>)}</details>}
    {(error || message) && <p className={`drive-message ${error ? 'row-error' : ''}`} role="status">{error || message}</p>}
    {!!downloadFailures.length && <details className="drive-failures"><summary>Памылак: {downloadFailures.length}</summary>{downloadFailures.map((failure, index) => <p key={index}>{failure.name} — {failure.error}</p>)}</details>}
  </main>;
}
