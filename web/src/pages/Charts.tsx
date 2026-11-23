/**
 * AstrologyStudio ·
 * web/src/pages/Charts.tsx
 *
 * Your charts:
 *
 * search, folders, tags, and adding new or shared charts.
 *
 * Copyright (c) 2026 Gavin Melhuish
 * MIT License; see LICENSE in the project root.
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { onFindChart } from '../frame/layout';
import { api, ApiError, type ChartSummary, type Folder } from '../api';
import { Link, navigate } from '../router';
import { Button, describe, EmptyState, Field, Loading, Notice, PageHeader, useDebounced, useLoad, useSubmit } from '../ui';
import { date as fmtDate, time as fmtTime } from '../fmt';
import { plainWording } from '../hosted';

interface ChartList {
  data: ChartSummary[];
  tags: string[];
}

export function Charts() {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string>('');
  const [tag, setTag] = useState<string>('');
  const [importing, setImporting] = useState(() => new URLSearchParams(location.search).get('add') === 'shared');
  const [limit, setLimit] = useState(200);
  const search = useDebounced(q, 250);
  // Ctrl+K and File → Open chart land here with the cursor in the search.
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => onFindChart(() => { searchBox.current?.focus(); searchBox.current?.select(); }), []);
  const params = new URLSearchParams();
  if (search.trim()) params.set('q', search.trim());
  if (folder) params.set('folder', folder);
  if (tag) params.set('tag', tag);
  const [list, reload] = useLoad(() => api<ChartList>(`/charts?${params.toString()}`), [search, folder, tag]);
  const [folders, reloadFolders] = useLoad(() => api<{ data: Folder[] }>('/folders'));
  const refresh = () => { reload(); reloadFolders(); };

  const needsSetup = list.state === 'error' && /API key|ephemeralREST isn't set up/i.test(list.error);

  return (
    <>
      <PageHeader
        title="Charts"
        actions={
          <>
            <Button onClick={() => setImporting(!importing)}>Add a shared chart</Button>
            <Link href="/charts/new" class="btn btn--primary">New chart</Link>
          </>
        }
      />
      {importing && <ImportChart onDone={(id) => navigate(`/charts/${id}`)} onCancel={() => setImporting(false)} />}
      {needsSetup ? (
        plainWording() ? (
          <EmptyState title="Your account isn't quite ready">
            <p>Log out and log in again to finish setting it up. If that doesn't help, contact us.</p>
          </EmptyState>
        ) : (
          <EmptyState title="Almost ready">
            <p>Connect to ephemeralREST and add your API key first. <Link href="/start">Getting started</Link></p>
          </EmptyState>
        )
      ) : (
        <div class="library">
          <aside class="library__side">
            <FolderList folders={folders.state === 'ready' ? folders.data.data : []} current={folder} onPick={setFolder}
                        onChanged={refresh} />
            {list.state === 'ready' && list.data.tags.length > 0 && (
              <div class="side-group">
                <h3>Tags</h3>
                <div class="tag-cloud">
                  {list.data.tags.map((t) => (
                    <button key={t} type="button" class={`tag${tag === t ? ' is-active' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
          <section class="library__main">
            <div class="toolbar">
              <input ref={searchBox} class="search" type="search" placeholder="Search by name, date (1985-06), place, tag or notes" value={q}
                     onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search charts" />
            </div>
            <Loading result={list}>
              {() => list.state === 'ready' && (
                list.data.data.length === 0 ? (
                  search || folder || tag ? <EmptyState title="No charts match" /> : (
                    <div class="welcome card">
                      <h2>Welcome to AstrologyStudio</h2>
                      <p class="muted">Start with a chart: a name, and the date, time and place of birth. You can add more charts,
                        and transits, returns and other charts worked out from them, whenever you like.</p>
                      <div class="actions"><Link href="/charts/new" class="btn btn--primary">Add your first chart</Link></div>
                    </div>
                  )
                ) : (
                  <table class="table table--rows">
                    <thead>
                      <tr><th>Name</th><th>Born</th><th class="hide-sm">Place</th><th class="hide-sm">Rating</th><th /></tr>
                    </thead>
                    <tbody>
                      {list.data.data.slice(0, limit).map((c) => (
                        <tr key={c.id} onClick={() => navigate(`/charts/${c.id}`)}>
                          <td>
                            <Link href={`/charts/${c.id}`}>{c.name}</Link>
                            {c.tags.map((t) => <span key={t} class="badge">{t}</span>)}
                          </td>
                          <td class="nowrap">{c.date ? fmtDate(c.date) : '—'} {c.time_unknown ? <span class="muted">time unknown</span> : fmtTime(c.time)}</td>
                          <td class="hide-sm">{c.place ?? '—'}</td>
                          <td class="hide-sm">{c.rating || <span class="muted">—</span>}</td>
                          <td class="num">
                            <span onClick={(e) => e.stopPropagation()}><Link href={`/charts/${c.id}/edit`}>Edit</Link></span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </Loading>
            {list.state === 'ready' && list.data.data.length > limit && (
              <div class="more">
                <Button onClick={() => setLimit(limit + 500)}>Show more ({list.data.data.length - limit} more)</Button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function FolderList({ folders, current, onPick, onChanged }: {
  folders: Folder[]; current: string; onPick: (id: string) => void; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (e: Event) => {
    e.preventDefault();
    api('/folders', 'POST', { name }).then(() => { setName(''); setAdding(false); onChanged(); })
      .catch((err: unknown) => setError(describe(err)));
  };
  const rename = (f: Folder) => {
    const next = prompt('Rename folder', f.name);
    if (next && next !== f.name) api(`/folders/${f.id}`, 'PATCH', { name: next }).then(onChanged).catch((err: unknown) => setError(describe(err)));
  };
  const remove = (f: Folder) => {
    if (!confirm(`Remove the folder "${f.name}"? Its charts stay in your list.`)) return;
    api(`/folders/${f.id}`, 'DELETE').then(() => { if (current === f.id) onPick(''); onChanged(); })
      .catch((err: unknown) => setError(describe(err)));
  };
  const item = (id: string, label: string, count?: number) => (
    <button type="button" class={`side-link${current === id ? ' is-active' : ''}`} onClick={() => onPick(id)}>
      <span>{label}</span>{count !== undefined && <small>{count}</small>}
    </button>
  );
  return (
    <div class="side-group">
      <h3>Folders</h3>
      {item('', 'All charts')}
      {folders.map((f) => (
        <div key={f.id} class="side-row">
          {item(f.id, f.name, f.charts)}
          {current === f.id && (
            <span class="side-row__actions">
              <button type="button" class="link-button" onClick={() => rename(f)}>Rename</button>
              <button type="button" class="link-button link-button--danger" onClick={() => remove(f)}>Remove</button>
            </span>
          )}
        </div>
      ))}
      {item('none', 'Not in a folder')}
      {error && <Notice tone="error">{error}</Notice>}
      {adding ? (
        <form class="side-form" onSubmit={add}>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Folder name" aria-label="Folder name" required />
          <Button type="submit" variant="primary">Add</Button>
        </form>
      ) : (
        <button type="button" class="link-button" onClick={() => setAdding(true)}>+ New folder</button>
      )}
    </div>
  );
}

function ImportChart({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const [chart, setChart] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    try {
      const added = await api<{ id: string }>('/charts/import', 'POST', { chart });
      onDone(added.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw new ApiError(404, { title: 'No chart with that id' });
      throw e;
    }
  });
  return (
    <form class="card form-card" onSubmit={onSubmit}>
      <h2>Add a shared chart</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Chart id or link" value={chart} onValue={setChart} placeholder="a3f2c1d4-7e8b-…"
             hint={plainWording() ? 'A chart someone has shared with you, by its id or the link they sent.' : 'Anyone using ephemeralREST (AstrologyStudio, MindForce, cosmobiology.online) can share a chart this way.'} required />
      <div class="actions">
        <Button type="submit" variant="primary" busy={busy}>Add to my charts</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
