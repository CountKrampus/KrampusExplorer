# MTG Collection Manager

Sidebar panel for tracking a personal Magic: The Gathering card collection.

- Search card names via the public [Scryfall](https://scryfall.com/docs/api) API.
- Click "Add" on a result to add it to your collection (or increment its quantity).
- Use +/- in the collection list to adjust quantities; a card is removed once its quantity
  reaches 0.
- The collection is stored in `localStorage` under `krampus-mtg-collection` — it persists
  between app restarts but is local to this machine/profile.

## Permissions

- `ui.sidebar` — registers the panel.

No other permissions are required: card lookup uses `fetch` directly against Scryfall, and
the collection is saved with `localStorage`, both available on the plugin's global scope.
