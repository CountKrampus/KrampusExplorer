# Disk Partition Manager

Sidebar panel showing a proportional visual map of every physical disk and its partitions (like
Windows' own Disk Management), with the ability to create, delete, resize, format, and relabel
partitions.

**The entire physical disk holding Windows is read-only** — every destructive action is disabled
for all of its partitions, including EFI/Recovery partitions, not just the Windows partition
itself. The backend independently refuses every mutating call against that disk too, re-checked
fresh on every call rather than trusting this frontend's own button-disabling.

Delete, Resize, and Format each require typing the partition's drive letter (or "DELETE" if it
has none) before the action enables — the same friction level the Secure Wipe plugin uses, since
there's no native OS dialog acting as a second safety gate. Creating a partition or changing a
drive letter uses a normal Confirm/Cancel dialog instead, since neither can destroy existing data.

Every mutating action (New Partition, Delete, Resize, Format, Change Letter) triggers a separate
Windows UAC elevation prompt — partition-table operations require Administrator, and each action
elevates independently rather than sharing one elevated session.

## Permissions

- `ui.sidebar` — registers the panel.
- `ui.confirm` — the Confirm/Cancel dialog for New Partition and Change Drive Letter.
- `system.partitions` — lists disks and performs all five partition operations.
