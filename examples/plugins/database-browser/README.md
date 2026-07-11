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

## Saved connections

Each mode has its own "Saved connections" dropdown. Successfully listing tables (SQLite) or
databases (MongoDB) remembers that path/URI — up to 10 most recent, newest first — so you can
pick it again next time instead of retyping it. Select "Forget" with an entry chosen to remove
it. Saved connections are stored in `localStorage`, local to this machine/profile — MongoDB URIs
containing credentials are stored as plain text, same as anywhere else you'd paste one on this
machine.

## Permissions

- `ui.sidebar` — registers the panel.
- `nav.read` — pre-fills the SQLite path from your current selection.
- `db.sqlite` — list tables and query rows in a local SQLite file.
- `db.mongo` — list databases/collections and query documents on a MongoDB server.
