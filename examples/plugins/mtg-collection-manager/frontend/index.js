// Entry point for the "MTG Collection Manager" example plugin.
//
// This file runs via `new Function("api", code)` — it is NOT an ES module, so it cannot use
// `import`/`export`. No backend permissions are needed beyond "ui.sidebar": card lookup uses
// the public Scryfall API directly (`fetch`), and the collection itself is stored in
// `localStorage`, both of which are available on the global scope the plugin already runs in.

const STORAGE_KEY = "krampus-mtg-collection";

function loadCollection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCollection(cards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

api.registerSidebarPanel({
  id: "mtg-collection-manager",
  title: "MTG Collection",
  render(container) {
    container.style.padding = "8px 12px";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "8px";
    container.style.fontSize = "12px";

    let collection = loadCollection();

    const searchRow = document.createElement("div");
    searchRow.style.display = "flex";
    searchRow.style.gap = "6px";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search card name...";
    searchInput.style.flex = "1";
    searchInput.style.padding = "4px 6px";
    searchInput.style.fontSize = "12px";

    const searchBtn = document.createElement("button");
    searchBtn.textContent = "Search";
    searchBtn.style.padding = "4px 10px";
    searchBtn.style.cursor = "pointer";

    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchBtn);

    const searchResults = document.createElement("div");
    searchResults.style.display = "flex";
    searchResults.style.flexDirection = "column";
    searchResults.style.gap = "4px";

    const collectionHeading = document.createElement("h4");
    collectionHeading.textContent = "Your Collection";
    collectionHeading.style.margin = "8px 0 0 0";

    const collectionList = document.createElement("div");
    collectionList.style.display = "flex";
    collectionList.style.flexDirection = "column";
    collectionList.style.gap = "4px";

    function renderCollection() {
      collectionList.innerHTML = "";
      if (collection.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No cards added yet.";
        empty.style.color = "var(--fg-muted)";
        empty.style.margin = "0";
        collectionList.appendChild(empty);
        return;
      }
      for (const card of collection) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.gap = "6px";

        const name = document.createElement("span");
        name.textContent = `${card.name} x${card.quantity}`;
        name.title = card.setName ? `${card.setName} (${card.setCode})` : "";

        const controls = document.createElement("div");
        controls.style.display = "flex";
        controls.style.gap = "4px";

        const minusBtn = document.createElement("button");
        minusBtn.textContent = "-";
        minusBtn.style.cursor = "pointer";
        minusBtn.addEventListener("click", () => {
          card.quantity -= 1;
          collection = card.quantity <= 0 ? collection.filter((c) => c !== card) : collection;
          saveCollection(collection);
          renderCollection();
        });

        const plusBtn = document.createElement("button");
        plusBtn.textContent = "+";
        plusBtn.style.cursor = "pointer";
        plusBtn.addEventListener("click", () => {
          card.quantity += 1;
          saveCollection(collection);
          renderCollection();
        });

        controls.appendChild(minusBtn);
        controls.appendChild(plusBtn);
        row.appendChild(name);
        row.appendChild(controls);
        collectionList.appendChild(row);
      }
    }

    async function runSearch() {
      const query = searchInput.value.trim();
      searchResults.innerHTML = "";
      if (!query) return;

      const loading = document.createElement("p");
      loading.textContent = "Searching...";
      loading.style.color = "var(--fg-muted)";
      loading.style.margin = "0";
      searchResults.appendChild(loading);

      try {
        const response = await fetch(
          `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}`,
        );
        if (!response.ok) {
          throw new Error(`Scryfall returned ${response.status}`);
        }
        const data = await response.json();
        searchResults.innerHTML = "";
        for (const card of (data.data ?? []).slice(0, 8)) {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.justifyContent = "space-between";
          row.style.alignItems = "center";
          row.style.gap = "6px";

          const name = document.createElement("span");
          name.textContent = `${card.name} (${card.set_name ?? card.set})`;

          const addBtn = document.createElement("button");
          addBtn.textContent = "Add";
          addBtn.style.cursor = "pointer";
          addBtn.addEventListener("click", () => {
            const existing = collection.find(
              (c) => c.name === card.name && c.setCode === card.set,
            );
            if (existing) {
              existing.quantity += 1;
            } else {
              collection.push({
                name: card.name,
                setCode: card.set,
                setName: card.set_name,
                quantity: 1,
              });
            }
            saveCollection(collection);
            renderCollection();
          });

          row.appendChild(name);
          row.appendChild(addBtn);
          searchResults.appendChild(row);
        }
        if ((data.data ?? []).length === 0) {
          searchResults.innerHTML = "";
          const none = document.createElement("p");
          none.textContent = "No cards found.";
          none.style.color = "var(--fg-muted)";
          none.style.margin = "0";
          searchResults.appendChild(none);
        }
      } catch (error) {
        searchResults.innerHTML = "";
        const err = document.createElement("p");
        err.textContent = String(error);
        err.style.color = "var(--danger, #d33)";
        err.style.margin = "0";
        searchResults.appendChild(err);
      }
    }

    searchBtn.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") runSearch();
    });

    container.appendChild(searchRow);
    container.appendChild(searchResults);
    container.appendChild(collectionHeading);
    container.appendChild(collectionList);

    renderCollection();
  },
});
