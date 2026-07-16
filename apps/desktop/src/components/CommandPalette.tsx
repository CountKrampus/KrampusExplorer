import { useEffect, useMemo, useRef, useState } from "react";
import { builtinCommands } from "../commands/builtinCommands";
import { useCommandPaletteStore } from "../stores/useCommandPaletteStore";
import { usePluginStore } from "../stores/usePluginStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./CommandPalette.css";

export interface CommandPaletteEntry {
  id: string;
  label: string;
  run: () => void;
  /** "core" for a built-in command, otherwise the contributing plugin's id — shown as a small
   * tag so it's clear where a command came from when several plugins are installed. */
  source: string;
}

/** Case-insensitive substring match on label, ranked by match position (earlier = more
 * relevant) then alphabetically. Empty query returns every command, unranked. */
export function filterCommands(commands: CommandPaletteEntry[], query: string): CommandPaletteEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return commands;
  return commands
    .map((command) => ({ command, index: command.label.toLowerCase().indexOf(trimmed) }))
    .filter(({ index }) => index !== -1)
    .sort((a, b) => a.index - b.index || a.command.label.localeCompare(b.command.label))
    .map(({ command }) => command);
}

// A separate component that only mounts while the palette is open, so useFocusTrap's mount
// effect (auto-focus, restore focus on unmount) and the query/selection state fire fresh on
// every open — same reasoning as SettingsPanel's SettingsPanelBody split.
function CommandPaletteBody() {
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const pluginCommands = usePluginStore((state) => state.commands);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const allCommands = useMemo<CommandPaletteEntry[]>(
    () => [
      ...builtinCommands.map((command) => ({ ...command, source: "core" })),
      ...pluginCommands.map((command) => ({
        id: command.id,
        label: command.label,
        run: command.run,
        source: command.pluginId,
      })),
    ],
    [pluginCommands],
  );

  const filtered = useMemo(() => filterCommands(allCommands, query), [allCommands, query]);

  // Keep the selection in range as filtering shrinks the list out from under it.
  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  function runAndClose(entry: CommandPaletteEntry) {
    setOpen(false);
    entry.run();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filtered[selectedIndex];
      if (entry) runAndClose(entry);
    }
  }

  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, () => setOpen(false));

  return (
    <div className="command-palette-backdrop" onClick={() => setOpen(false)}>
      <div
        className="command-palette"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          type="text"
          className="command-palette__input"
          placeholder="Type a command…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <ul className="command-palette__list" role="listbox">
          {filtered.length === 0 ? (
            <li className="command-palette__empty">No matching commands.</li>
          ) : (
            filtered.map((entry, index) => (
              <li key={`${entry.source}:${entry.id}`}>
                <button
                  type="button"
                  className={`command-palette__item ${index === selectedIndex ? "command-palette__item--selected" : ""}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => runAndClose(entry)}
                >
                  <span>{entry.label}</span>
                  {entry.source !== "core" && (
                    <span className="command-palette__source">{entry.source}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function CommandPalette() {
  const open = useCommandPaletteStore((state) => state.open);

  if (!open) return null;

  return <CommandPaletteBody />;
}

export default CommandPalette;
