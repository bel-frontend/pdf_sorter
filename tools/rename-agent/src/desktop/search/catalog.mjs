import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { getLoadablePath } from "sqlite-vec";
import { splitChunks, digest } from "./chunks.mjs";

export class Catalog {
  constructor(file, vectorLibrary) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file, { allowExtension: true });
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.loadExtension(
      vectorLibrary ||
        getLoadablePath().replace(/app\.asar([\\/])/, "app.asar.unpacked$1"),
    );
    this.db.enableLoadExtension(false);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents(hash TEXT PRIMARY KEY, metadata TEXT NOT NULL DEFAULT '{}', legacy TEXT NOT NULL DEFAULT '', coverage TEXT NOT NULL DEFAULT 'partial', total INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locations(path TEXT PRIMARY KEY, hash TEXT NOT NULL REFERENCES documents(hash), size INTEGER NOT NULL, mtime REAL NOT NULL, missing INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'local', origin TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS locations_hash ON locations(hash);
      CREATE TABLE IF NOT EXISTS pages(hash TEXT NOT NULL REFERENCES documents(hash), number INTEGER NOT NULL, text TEXT NOT NULL, method TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', PRIMARY KEY(hash,number));
      CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, hash TEXT NOT NULL REFERENCES documents(hash), text TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, pageStart INTEGER, pageEnd INTEGER, kind TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chunks_hash ON chunks(hash);
      CREATE TABLE IF NOT EXISTS vectors(profile TEXT NOT NULL, chunk TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE, embedding BLOB NOT NULL, PRIMARY KEY(profile,chunk));
      CREATE TABLE IF NOT EXISTS jobs(hash TEXT NOT NULL REFERENCES documents(hash), kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', PRIMARY KEY(hash,kind));
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(hash UNINDEXED,names,summary,body,person,category,date,tokenize='unicode61');
      PRAGMA user_version=1;
      UPDATE jobs SET state='pending' WHERE state='running';`);
  }
  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  document(hash, withPages = true) {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE hash=?")
      .get(hash);
    return (
      row && {
        ...row,
        metadata: JSON.parse(row.metadata),
        locations: this.locations(hash),
        pages: withPages ? this.pages(hash) : [],
      }
    );
  }
  locations(hash) {
    return this.db
      .prepare("SELECT * FROM locations WHERE hash=?")
      .all(hash)
      .map((row) => ({ ...row, origin: JSON.parse(row.origin) }));
  }
  pages(hash) {
    return this.db
      .prepare("SELECT * FROM pages WHERE hash=? ORDER BY number")
      .all(hash);
  }
  locate(file) {
    return this.db.prepare("SELECT * FROM locations WHERE path=?").get(file);
  }
  track(hash, file, stat, origin = {}) {
    this.transaction(() => this.trackLocation(hash, file, stat, origin));
  }
  trackLocation(hash, file, stat, origin = {}) {
    this.db
      .prepare("INSERT OR IGNORE INTO documents(hash,updated) VALUES(?,?)")
      .run(hash, new Date().toISOString());
    const old = this.locate(file);
    this.db
      .prepare(
        `INSERT INTO locations(path,hash,size,mtime,source,origin) VALUES(?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash,size=excluded.size,mtime=excluded.mtime,missing=0,source=excluded.source,origin=excluded.origin`,
      )
      .run(
        file,
        hash,
        stat.size,
        stat.mtimeMs,
        origin.driveId ? "drive" : old?.source || "local",
        JSON.stringify(
          Object.keys(origin).length ? origin : JSON.parse(old?.origin || "{}"),
        ),
      );
    if (old && old.hash !== hash) this.refreshFts(old.hash);
    this.refreshFts(hash);
  }
  applyResync(verified) {
    return this.transaction(() => {
      const result = {
        checked: verified.length,
        pathsRemoved: 0,
        documentsRemoved: 0,
        vectorsRemoved: 0,
        changed: 0,
        restored: 0,
        unavailable: 0,
        finishedAt: new Date().toISOString(),
        errors: [],
      };
      for (const item of verified) {
        const current = this.locate(item.path);
        if (!current || current.hash !== item.hash) continue;
        if (item.kind === "missing") {
          result.pathsRemoved += Number(
            this.db
              .prepare("DELETE FROM locations WHERE path=? AND hash=?")
              .run(item.path, item.hash).changes,
          );
          this.refreshFts(item.hash);
        } else if (item.kind === "unavailable") {
          this.missing(item.path);
          result.unavailable++;
        } else {
          const hash = item.actualHash || item.hash;
          this.trackLocation(hash, item.path, item.stat, item.origin);
          if (current.missing) result.restored++;
          if (item.kind === "changed") {
            result.changed++;
            if (this.document(hash, false).coverage !== "full")
              this.enqueue(hash, "read");
          }
        }
      }
      const removed = this.db
        .prepare(
          "SELECT hash FROM documents WHERE NOT EXISTS(SELECT 1 FROM locations l WHERE l.hash=documents.hash)",
        )
        .all();
      for (const { hash } of removed) {
        result.vectorsRemoved += this.db
          .prepare(
            "SELECT count(*) n FROM vectors JOIN chunks ON chunks.id=vectors.chunk WHERE chunks.hash=?",
          )
          .get(hash).n;
        this.db.prepare("DELETE FROM catalog_fts WHERE hash=?").run(hash);
        this.db.prepare("DELETE FROM chunks WHERE hash=?").run(hash);
        this.db.prepare("DELETE FROM pages WHERE hash=?").run(hash);
        this.db.prepare("DELETE FROM jobs WHERE hash=?").run(hash);
        this.db
          .prepare("DELETE FROM state WHERE key=? OR key LIKE ?")
          .run("legacy:" + hash, "move:" + hash + ":%");
        this.db.prepare("DELETE FROM documents WHERE hash=?").run(hash);
      }
      result.documentsRemoved = removed.length;
      this.state("cacheCleanup", [
        ...new Set([
          ...(this.state("cacheCleanup") || []),
          ...removed.map((row) => row.hash),
        ]),
      ]);
      this.state("lastResync", result);
      return result;
    });
  }
  metadata(hash, metadata) {
    const appliedCategory = this.document(hash, false)?.metadata
      .appliedCategory;
    if (appliedCategory) metadata = { ...metadata, appliedCategory };
    this.db
      .prepare(
        "UPDATE documents SET metadata=?,legacy=CASE WHEN ? != '' THEN ? ELSE legacy END,updated=? WHERE hash=?",
      )
      .run(
        JSON.stringify(metadata),
        metadata.extractedText || "",
        metadata.extractedText || "",
        new Date().toISOString(),
        hash,
      );
    this.rebuild(hash);
    this.enqueue(hash, "embed");
  }
  page(hash, page) {
    this.db
      .prepare(
        `INSERT INTO pages(hash,number,text,method,error) VALUES(?,?,?,?,?) ON CONFLICT(hash,number) DO UPDATE SET text=excluded.text,method=excluded.method,error=excluded.error`,
      )
      .run(
        hash,
        page.number,
        page.text || "",
        page.method || "text",
        page.error || "",
      );
  }
  coverage(hash, total) {
    const pages = this.pages(hash);
    const successful = pages.filter((p) => !p.error).length;
    const coverage =
      total > 0 && successful === total
        ? "full"
        : pages.some((p) => p.text.trim())
          ? "partial"
          : "error";
    this.db
      .prepare(
        "UPDATE documents SET total=?,coverage=?,error=?,updated=? WHERE hash=?",
      )
      .run(
        total,
        coverage,
        pages
          .filter((p) => p.error)
          .map((p) => `Старонка ${p.number}: ${p.error}`)
          .join("\n"),
        new Date().toISOString(),
        hash,
      );
    this.rebuild(hash);
    this.enqueue(hash, "embed");
    return coverage;
  }
  rebuild(hash, options = this.chunkOptions || {}) {
    const doc = this.document(hash);
    if (!doc) return;
    const pages = doc.pages.length
      ? doc.pages.filter((page) => !page.error)
      : [{ number: 0, text: doc.legacy }];
    const parts = splitChunks(pages, options);
    const rename = doc.metadata.rename;
    const classes = Object.values(doc.metadata.classifications || {});
    const description = [
      rename?.summary,
      rename?.topic,
      rename?.person,
      rename?.date,
      ...classes.map((c) => c.reason),
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4000);
    if (description.trim())
      parts.unshift({
        text: description,
        start: 0,
        end: description.length,
        pageStart: null,
        pageEnd: null,
        kind: "description",
      });
    const next = parts.map((part) => ({
      ...part,
      id: digest([hash, part.kind, part.start, part.end, part.text]),
    }));
    this.transaction(() => {
      const keep = new Set(next.map((p) => p.id));
      for (const row of this.db
        .prepare("SELECT id FROM chunks WHERE hash=?")
        .all(hash))
        if (!keep.has(row.id))
          this.db.prepare("DELETE FROM chunks WHERE id=?").run(row.id);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO chunks(id,hash,text,start,end,pageStart,pageEnd,kind) VALUES(?,?,?,?,?,?,?,?)",
      );
      for (const part of next)
        insert.run(
          part.id,
          hash,
          part.text,
          part.start,
          part.end,
          part.pageStart,
          part.pageEnd,
          part.kind,
        );
      this.refreshFts(hash);
    });
  }
  refreshFts(hash) {
    const row = this.db
      .prepare("SELECT metadata,legacy FROM documents WHERE hash=?")
      .get(hash);
    if (!row) return;
    const metadata = JSON.parse(row.metadata),
      rename = metadata.rename || {},
      classes = Object.values(metadata.classifications || {});
    const body =
      this.pages(hash)
        .filter((page) => !page.error)
        .map((p) => p.text)
        .join("\n\n") || row.legacy;
    const names = this.locations(hash)
      .filter((l) => !l.missing)
      .map((l) => path.basename(l.path))
      .join("\n");
    this.db.prepare("DELETE FROM catalog_fts WHERE hash=?").run(hash);
    this.db
      .prepare(
        "INSERT INTO catalog_fts(hash,names,summary,body,person,category,date) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        hash,
        names,
        rename.summary || classes.at(-1)?.reason || "",
        body,
        rename.person || "",
        metadata.appliedCategory ||
          metadata.catalogCategory ||
          rename.sortingCategory ||
          classes.at(-1)?.category ||
          rename.category ||
          "",
        rename.date || "",
      );
  }
  enqueue(hash, kind) {
    this.db
      .prepare(
        "INSERT INTO jobs(hash,kind) VALUES(?,?) ON CONFLICT(hash,kind) DO UPDATE SET state=CASE WHEN jobs.state='running' THEN jobs.state ELSE 'pending' END,error=''",
      )
      .run(hash, kind);
  }
  job(kind) {
    return this.db
      .prepare(
        "SELECT * FROM jobs WHERE state='pending' AND kind=? AND EXISTS(SELECT 1 FROM locations l WHERE l.hash=jobs.hash AND l.missing=0) LIMIT 1",
      )
      .get(kind);
  }
  jobState(hash, kind, state, error = "") {
    this.db
      .prepare("UPDATE jobs SET state=?,error=? WHERE hash=? AND kind=?")
      .run(state, error, hash, kind);
  }
  pendingVectors(hash, profile) {
    return this.db
      .prepare(
        "SELECT * FROM chunks WHERE hash=? AND NOT EXISTS(SELECT 1 FROM vectors WHERE chunk=chunks.id AND profile=?)",
      )
      .all(hash, profile);
  }
  putVectors(profile, chunks, vectors) {
    this.transaction(() => {
      const statement = this.db.prepare(
        "INSERT OR REPLACE INTO vectors(profile,chunk,embedding) VALUES(?,?,?)",
      );
      for (let i = 0; i < chunks.length; i++)
        statement.run(
          profile,
          chunks[i].id,
          new Uint8Array(new Float32Array(vectors[i]).buffer),
        );
    });
  }
  move(from, to, category) {
    const row = this.locate(from);
    if (!row) return;
    const doc = this.document(row.hash, false);
    const reverse = this.state("move:" + row.hash + ":" + from);
    if (reverse?.from === to) {
      if (reverse.category) doc.metadata.appliedCategory = reverse.category;
      else delete doc.metadata.appliedCategory;
    } else {
      this.state("move:" + row.hash + ":" + to, {
        from,
        category: doc.metadata.appliedCategory || null,
      });
      if (category) doc.metadata.appliedCategory = category;
    }
    this.transaction(() => {
      // A stale entry for a file that used to live at the target path is replaced.
      const stale = to !== from && this.locate(to);
      if (stale) {
        this.db.prepare("DELETE FROM locations WHERE path=?").run(to);
        if (stale.hash !== row.hash) this.refreshFts(stale.hash);
      }
      this.db
        .prepare("UPDATE locations SET path=?,missing=0 WHERE path=?")
        .run(to, from);
      this.db
        .prepare("UPDATE documents SET metadata=? WHERE hash=?")
        .run(JSON.stringify(doc.metadata), row.hash);
      this.refreshFts(row.hash);
    });
  }
  missing(file) {
    const row = this.locate(file);
    if (row) {
      this.db.prepare("UPDATE locations SET missing=1 WHERE path=?").run(file);
      this.refreshFts(row.hash);
    }
  }
  state(key, value) {
    if (value !== undefined)
      this.db
        .prepare("INSERT OR REPLACE INTO state VALUES(?,?)")
        .run(key, JSON.stringify(value));
    return JSON.parse(
      this.db.prepare("SELECT value FROM state WHERE key=?").get(key)?.value ||
        "null",
    );
  }
  status(profile) {
    const count = (sql) => this.db.prepare(sql).get().n;
    return {
      documents: count("SELECT count(*) n FROM documents"),
      locations: count("SELECT count(*) n FROM locations WHERE missing=0"),
      full: count("SELECT count(*) n FROM documents WHERE coverage='full'"),
      partial: count(
        "SELECT count(*) n FROM documents WHERE coverage='partial'",
      ),
      missing: count("SELECT count(*) n FROM locations WHERE missing=1"),
      chunks: count("SELECT count(*) n FROM chunks"),
      vectors: this.db
        .prepare("SELECT count(*) n FROM vectors WHERE profile=?")
        .get(profile || "").n,
      jobs: this.db
        .prepare(
          "SELECT kind,state,count(*) count FROM jobs GROUP BY kind,state",
        )
        .all(),
      errors: this.db
        .prepare(
          "SELECT jobs.*, (SELECT path FROM locations WHERE hash=jobs.hash LIMIT 1) filePath FROM jobs WHERE state='error' LIMIT 20",
        )
        .all(),
    };
  }
  search({
    query = "",
    mode = "semantic",
    vector,
    profile,
    limit = 20,
    filters = {},
  }) {
    const values = [],
      clauses = [
        "EXISTS(SELECT 1 FROM locations l WHERE l.hash=d.hash AND l.missing=0)",
      ];
    if (filters.source) {
      clauses.push(
        "EXISTS(SELECT 1 FROM locations l WHERE l.hash=d.hash AND l.missing=0 AND l.source=?)",
      );
      values.push(filters.source);
    }
    if (filters.category) {
      clauses.push(
        "coalesce(json_extract(d.metadata,'$.appliedCategory'),json_extract(d.metadata,'$.catalogCategory'),json_extract(d.metadata,'$.rename.sortingCategory'),(SELECT json_extract(j.value,'$.category') FROM json_each(json_extract(d.metadata,'$.classifications')) j ORDER BY j.id DESC LIMIT 1))=?",
      );
      values.push(filters.category);
    }
    if (filters.dateFrom || filters.dateTo)
      clauses.push(
        "coalesce(json_extract(d.metadata,'$.rename.date'),'') != ''",
      );
    for (const [key, operator] of [
      ["dateFrom", ">="],
      ["dateTo", "<="],
    ])
      if (filters[key]) {
        clauses.push(
          `(CASE length(json_extract(d.metadata,'$.rename.date')) WHEN 4 THEN json_extract(d.metadata,'$.rename.date') || '${key === "dateFrom" ? "-12-31" : "-01-01"}' WHEN 7 THEN ${key === "dateFrom" ? "date(json_extract(d.metadata,'$.rename.date') || '-01','+1 month','-1 day')" : "json_extract(d.metadata,'$.rename.date') || '-01'"} ELSE coalesce(json_extract(d.metadata,'$.rename.date'),'') END) ${operator} ?`,
        );
        values.push(filters[key]);
      }
    let hits;
    if (mode === "semantic" && query.trim()) {
      const bytes = new Uint8Array(new Float32Array(vector).buffer);
      // Rank documents by their best chunk, then keep up to three chunks per document.
      hits = this.db
        .prepare(
          `WITH ranked AS MATERIALIZED (SELECT c.*,1-vec_distance_cosine(v.embedding,?) score FROM vectors v JOIN chunks c ON c.id=v.chunk JOIN documents d ON d.hash=c.hash WHERE v.profile=? AND ${clauses.join(" AND ")}), positioned AS (SELECT *,row_number() OVER(PARTITION BY hash ORDER BY score DESC) position FROM ranked) SELECT * FROM positioned WHERE position<=3 AND hash IN (SELECT hash FROM positioned WHERE position=1 ORDER BY score DESC LIMIT ?) ORDER BY score DESC`,
        )
        .all(bytes, profile, ...values, limit);
    } else if (query.trim()) {
      const terms = query.match(/[\p{L}\p{N}_]+/gu) || [];
      if (!terms.length) return [];
      const match = terms
        .map((t) => '"' + t.replaceAll('"', '""') + '"*')
        .join(" AND ");
      hits = this.db
        .prepare(
          `SELECT d.hash,snippet(catalog_fts,-1,'','', '…',40) text,-bm25(catalog_fts) score FROM catalog_fts JOIN documents d ON d.hash=catalog_fts.hash WHERE catalog_fts MATCH ? AND ${clauses.join(" AND ")} ORDER BY score DESC LIMIT ?`,
        )
        .all(match, ...values, limit);
    } else
      hits = this.db
        .prepare(
          `SELECT d.hash,'' text,0 score FROM documents d WHERE ${clauses.join(" AND ")} ORDER BY d.updated DESC LIMIT ?`,
        )
        .all(...values, limit);
    const grouped = new Map();
    for (const hit of hits) {
      if (!grouped.has(hit.hash)) grouped.set(hit.hash, []);
      const list = grouped.get(hit.hash);
      if (
        !list.some(
          (other) =>
            other.kind === hit.kind &&
            other.start !== undefined &&
            Math.abs(other.start - hit.start) < 400,
        )
      )
        list.push(hit);
    }
    return [...grouped].slice(0, limit).map(([hash, matches]) => {
      const doc = this.document(hash, false);
      return {
        id: hash,
        summary:
          doc.metadata.rename?.summary ||
          Object.values(doc.metadata.classifications || {}).at(-1)?.reason ||
          "",
        category:
          doc.metadata.appliedCategory ||
          doc.metadata.catalogCategory ||
          doc.metadata.rename?.sortingCategory ||
          Object.values(doc.metadata.classifications || {}).at(-1)?.category ||
          "",
        person: doc.metadata.rename?.person || "",
        date: doc.metadata.rename?.date || "",
        coverage: doc.coverage,
        totalPages: doc.total,
        locations: doc.locations.filter(
          (l) => !l.missing && (!filters.source || l.source === filters.source),
        ),
        score: matches[0].score,
        matches: matches.slice(0, 3).map((m) => ({
          text: m.text,
          kind: m.kind,
          pageStart: m.pageStart,
          pageEnd: m.pageEnd,
          score: m.score,
        })),
      };
    });
  }
  close() {
    this.db.close();
  }
}
