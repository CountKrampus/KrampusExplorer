// Entry point for the "Database Browser" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. The `api` parameter is the only thing this code should rely on; it's
// built by createPluginApi() and only contains methods this plugin's manifest.json declared
// permission for (registerSidebarPanel: "ui.sidebar", getSelectedPath: "nav.read",
// listSqliteTables/querySqliteTable: "db.sqlite", listMongoDatabases/listMongoCollections/
// queryMongoCollection: "db.mongo").
//
// Saved connections (SQLite paths and MongoDB URIs) are kept in localStorage — no backend
// permission needed, same as the MTG Collection Manager plugin's approach.

const STORAGE_KEY = "krampus-db-browser-connections";
const MAX_SAVED = 10;

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { sqlite: parsed.sqlite ?? [], mongo: parsed.mongo ?? [] };
  } catch {
    return { sqlite: [], mongo: [] };
  }
}

function saveSaved(saved) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function remember(list, value) {
  const next = [value, ...list.filter((item) => item !== value)];
  return next.slice(0, MAX_SAVED);
}

api.registerSidebarPanel({
  id: "database-browser",
  title: "Database Browser",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    let saved = loadSaved();

    const modeRow = document.createElement("div");
    modeRow.style.display = "flex";
    modeRow.style.gap = "10px";

    let mode = "sqlite";
    const sqliteRadio = document.createElement("label");
    const sqliteInput = document.createElement("input");
    sqliteInput.type = "radio";
    sqliteInput.name = "db-browser-mode";
    sqliteInput.checked = true;
    sqliteRadio.appendChild(sqliteInput);
    sqliteRadio.appendChild(document.createTextNode(" SQLite"));

    const mongoRadio = document.createElement("label");
    const mongoInput = document.createElement("input");
    mongoInput.type = "radio";
    mongoInput.name = "db-browser-mode";
    mongoRadio.appendChild(mongoInput);
    mongoRadio.appendChild(document.createTextNode(" MongoDB"));

    modeRow.appendChild(sqliteRadio);
    modeRow.appendChild(mongoRadio);

    function savedRow(list, onPick, onForget) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "6px";

      const select = document.createElement("select");
      select.style.flex = "1";
      select.style.padding = "4px 6px";

      function render() {
        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = list.length > 0 ? "Saved connections..." : "No saved connections yet";
        select.appendChild(placeholder);
        for (const item of list) {
          const option = document.createElement("option");
          option.value = item;
          option.textContent = item;
          select.appendChild(option);
        }
      }
      render();

      select.addEventListener("change", () => {
        if (select.value) onPick(select.value);
      });

      const forgetBtn = document.createElement("button");
      forgetBtn.textContent = "Forget";
      forgetBtn.style.cursor = "pointer";
      forgetBtn.addEventListener("click", () => {
        if (!select.value) return;
        onForget(select.value);
        render();
      });

      row.appendChild(select);
      row.appendChild(forgetBtn);
      return { row, refresh: render };
    }

    // --- SQLite controls ---
    const sqlitePanel = document.createElement("div");
    sqlitePanel.style.display = "flex";
    sqlitePanel.style.flexDirection = "column";
    sqlitePanel.style.gap = "6px";

    const sqlitePathInput = document.createElement("input");
    sqlitePathInput.type = "text";
    sqlitePathInput.placeholder = "Path to .sqlite/.db file";
    sqlitePathInput.value = api.getSelectedPath?.() ?? "";
    sqlitePathInput.style.padding = "4px 6px";

    const sqliteSavedRow = savedRow(
      saved.sqlite,
      (value) => {
        sqlitePathInput.value = value;
      },
      (value) => {
        saved.sqlite = saved.sqlite.filter((item) => item !== value);
        saveSaved(saved);
      },
    );

    const sqliteLoadBtn = document.createElement("button");
    sqliteLoadBtn.textContent = "List Tables";
    sqliteLoadBtn.style.cursor = "pointer";

    const sqliteTableSelect = document.createElement("select");
    sqliteTableSelect.style.padding = "4px 6px";

    const sqliteQueryBtn = document.createElement("button");
    sqliteQueryBtn.textContent = "Load Rows";
    sqliteQueryBtn.style.cursor = "pointer";

    sqlitePanel.appendChild(sqliteSavedRow.row);
    sqlitePanel.appendChild(sqlitePathInput);
    sqlitePanel.appendChild(sqliteLoadBtn);
    sqlitePanel.appendChild(sqliteTableSelect);
    sqlitePanel.appendChild(sqliteQueryBtn);

    // --- MongoDB controls ---
    const mongoPanel = document.createElement("div");
    mongoPanel.style.display = "none";
    mongoPanel.style.flexDirection = "column";
    mongoPanel.style.gap = "6px";

    const mongoUriInput = document.createElement("input");
    mongoUriInput.type = "text";
    mongoUriInput.placeholder = "mongodb://localhost:27017";
    mongoUriInput.style.padding = "4px 6px";

    const mongoSavedRow = savedRow(
      saved.mongo,
      (value) => {
        mongoUriInput.value = value;
      },
      (value) => {
        saved.mongo = saved.mongo.filter((item) => item !== value);
        saveSaved(saved);
      },
    );

    const mongoConnectBtn = document.createElement("button");
    mongoConnectBtn.textContent = "List Databases";
    mongoConnectBtn.style.cursor = "pointer";

    const mongoDbSelect = document.createElement("select");
    mongoDbSelect.style.padding = "4px 6px";

    const mongoDbLoadBtn = document.createElement("button");
    mongoDbLoadBtn.textContent = "List Collections";
    mongoDbLoadBtn.style.cursor = "pointer";

    const mongoCollectionSelect = document.createElement("select");
    mongoCollectionSelect.style.padding = "4px 6px";

    const mongoQueryBtn = document.createElement("button");
    mongoQueryBtn.textContent = "Load Documents";
    mongoQueryBtn.style.cursor = "pointer";

    mongoPanel.appendChild(mongoSavedRow.row);
    mongoPanel.appendChild(mongoUriInput);
    mongoPanel.appendChild(mongoConnectBtn);
    mongoPanel.appendChild(mongoDbSelect);
    mongoPanel.appendChild(mongoDbLoadBtn);
    mongoPanel.appendChild(mongoCollectionSelect);
    mongoPanel.appendChild(mongoQueryBtn);

    // --- Shared results area ---
    const status = document.createElement("p");
    status.style.color = "var(--fg-muted)";
    status.style.margin = "0";
    const setStatus = (text, isError) => {
      status.textContent = text;
      status.style.color = isError ? "var(--danger, #d33)" : "var(--fg-muted)";
    };

    const resultsTable = document.createElement("div");
    resultsTable.style.overflowX = "auto";
    resultsTable.style.fontFamily = "monospace";
    resultsTable.style.fontSize = "11px";
    resultsTable.style.whiteSpace = "pre";

    function renderSqliteRows(data) {
      resultsTable.textContent = [data.columns.join(" | "), ...data.rows.map((row) => row.map((v) => v ?? "NULL").join(" | "))].join("\n");
    }

    function renderMongoDocs(docs) {
      resultsTable.textContent = docs.join("\n\n");
    }

    sqliteInput.addEventListener("change", () => {
      mode = "sqlite";
      sqlitePanel.style.display = "flex";
      mongoPanel.style.display = "none";
    });
    mongoInput.addEventListener("change", () => {
      mode = "mongo";
      sqlitePanel.style.display = "none";
      mongoPanel.style.display = "flex";
    });

    sqliteLoadBtn.addEventListener("click", async () => {
      const dbPath = sqlitePathInput.value.trim();
      if (!dbPath) return setStatus("Enter a database path.", true);
      try {
        const tables = await api.listSqliteTables(dbPath);
        sqliteTableSelect.innerHTML = "";
        for (const table of tables) {
          const option = document.createElement("option");
          option.value = table;
          option.textContent = table;
          sqliteTableSelect.appendChild(option);
        }
        setStatus(`Found ${tables.length} table(s).`, false);
        saved.sqlite = remember(saved.sqlite, dbPath);
        saveSaved(saved);
        sqliteSavedRow.refresh();
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    sqliteQueryBtn.addEventListener("click", async () => {
      const dbPath = sqlitePathInput.value.trim();
      const table = sqliteTableSelect.value;
      if (!dbPath || !table) return setStatus("List tables and pick one first.", true);
      try {
        const data = await api.querySqliteTable(dbPath, table, 50, 0);
        renderSqliteRows(data);
        setStatus(`Loaded ${data.rows.length} row(s).`, false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    mongoConnectBtn.addEventListener("click", async () => {
      const uri = mongoUriInput.value.trim();
      if (!uri) return setStatus("Enter a connection string.", true);
      try {
        const databases = await api.listMongoDatabases(uri);
        mongoDbSelect.innerHTML = "";
        for (const db of databases) {
          const option = document.createElement("option");
          option.value = db;
          option.textContent = db;
          mongoDbSelect.appendChild(option);
        }
        setStatus(`Found ${databases.length} database(s).`, false);
        saved.mongo = remember(saved.mongo, uri);
        saveSaved(saved);
        mongoSavedRow.refresh();
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    mongoDbLoadBtn.addEventListener("click", async () => {
      const uri = mongoUriInput.value.trim();
      const dbName = mongoDbSelect.value;
      if (!uri || !dbName) return setStatus("List databases and pick one first.", true);
      try {
        const collections = await api.listMongoCollections(uri, dbName);
        mongoCollectionSelect.innerHTML = "";
        for (const collection of collections) {
          const option = document.createElement("option");
          option.value = collection;
          option.textContent = collection;
          mongoCollectionSelect.appendChild(option);
        }
        setStatus(`Found ${collections.length} collection(s).`, false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    mongoQueryBtn.addEventListener("click", async () => {
      const uri = mongoUriInput.value.trim();
      const dbName = mongoDbSelect.value;
      const collection = mongoCollectionSelect.value;
      if (!uri || !dbName || !collection) return setStatus("List collections and pick one first.", true);
      try {
        const docs = await api.queryMongoCollection(uri, dbName, collection, 20);
        renderMongoDocs(docs);
        setStatus(`Loaded ${docs.length} document(s).`, false);
      } catch (error) {
        setStatus(String(error), true);
      }
    });

    container.appendChild(modeRow);
    container.appendChild(sqlitePanel);
    container.appendChild(mongoPanel);
    container.appendChild(status);
    container.appendChild(resultsTable);
  },
});
