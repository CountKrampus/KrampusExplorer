# Database Browser

Sidebar panel for browsing SQLite files and MongoDB servers, with a mode toggle between the two.

## SQLite mode

1. Enter a path to a `.sqlite`/`.db` file (pre-filled from your current selection).
2. Click "List Tables", pick a table from the dropdown.
3. Click "Load Rows" to view up to 50 rows.

## MongoDB mode

1. Enter a connection string (e.g. `mongodb://localhost:27017`).
2. Click "List Databases", pick one.
3. Click "List Collections", pick one.
4. Click "Load Documents" to view up to 20 documents as JSON.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the SQLite path from your current selection.
- `db.sqlite` — list tables and query rows in a local SQLite file.
- `db.mongo` — list databases/collections and query documents on a MongoDB server.
