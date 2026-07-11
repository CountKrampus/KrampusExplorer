export interface DriveInfo {
  name: string;
  path: string;
  mountPoint: string;
  totalBytes: number | null;
  freeBytes: number | null;
}

export interface EntryInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  /** Unix epoch seconds as a string, or null if the OS didn't report a modified time. */
  modified: string | null;
  /** Unix epoch seconds as a string, or null if the OS didn't report a creation time. */
  created: string | null;
}

export interface DirectoryListing {
  entries: EntryInfo[];
  parent: string | null;
}
