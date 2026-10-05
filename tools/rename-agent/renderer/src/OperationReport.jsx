import React, { useState } from 'react';

const labels = { completed: 'Гатова', failed: 'Памылка', skipped: 'Без змен', pending: 'Не выканана', processing: 'Выконваецца' };

export default function OperationReport({ report, busy, exportReport }) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  if (!report) return null;
  const count = status => report.entries.filter(entry => entry.status === status).length;
  const entries = onlyErrors ? report.entries.filter(entry => entry.status === 'failed') : report.entries;
  return <section className="card operation-report">
    <div className="report-heading"><div><span className="eyebrow">Вынік аперацыі</span><h3>{report.mode === 'rename' ? 'Перайменаванне' : 'Перамяшчэнне'}{report.status === 'running' ? ' перарвана або яшчэ не завершана' : ' завершана'}</h3></div>
      <div className="report-buttons"><button className="button secondary" disabled={busy} onClick={() => exportReport('csv')}>Захаваць CSV</button><button className="button ghost" disabled={busy} onClick={() => exportReport('json')}>JSON</button></div></div>
    <p className="report-summary" role="status">Гатова: <strong>{count('completed')}</strong> · Памылак: <strong>{count('failed')}</strong> · Без змен: {count('skipped')} · Не завершана: {count('pending') + count('processing')}</p>
    {report.destination && <p className="report-destination">Папка выніку: <strong>{report.destination}</strong></p>}
    {report.legacy && <p className="hint">Справаздача са старога журнала: захаваныя толькі паспяховыя перамяшчэнні.</p>}
    <details><summary>Паказаць усе шляхі ({report.entries.length})</summary>
      <label className="report-filter"><input type="checkbox" checked={onlyErrors} onChange={event => setOnlyErrors(event.target.checked)} /> Толькі памылкі</label>
      <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Вынік</th><th>Адкуль</th><th>Куды</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className={entry.status}><td>{labels[entry.status]}{entry.error && <p>{entry.error}</p>}</td><td>{entry.from}</td><td>{entry.to}</td></tr>)}</tbody></table>{!entries.length && <p>Памылак няма</p>}</div>
    </details>
  </section>;
}
