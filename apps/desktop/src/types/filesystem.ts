export interface DriveInfo {
  name: string;
  path: string;
  mountPoint: string;
}

export interface EntryInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number | null;
  modified: string | null;
}

export interface DirectoryListing {
  entries: EntryInfo[];
  parent: string | null;
}
