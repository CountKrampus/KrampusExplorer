/** Appends " (2)", " (3)", ... before the extension until the name doesn't collide. */
export function uniqueName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName;
  const dotIndex = baseName.lastIndexOf(".");
  const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const ext = dotIndex > 0 ? baseName.slice(dotIndex) : "";
  let counter = 2;
  let candidate = `${stem} (${counter})${ext}`;
  while (existingNames.has(candidate)) {
    counter++;
    candidate = `${stem} (${counter})${ext}`;
  }
  return candidate;
}
