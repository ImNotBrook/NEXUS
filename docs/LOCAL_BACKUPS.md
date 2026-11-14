# NEXUS local backup and restore

## Scope

NEXUS stores its decision journal and paper account in browser IndexedDB on the current device. This feature creates two independent, downloadable JSON backups:

1. **Decision journal backup** — every immutable decision record and every linked event, including shadow plans, replay registrations, replay completions, detected breakouts and appended outcomes.
2. **Paper account backup** — the simulated account snapshot, including balances, positions, fills, configuration and open paper orders.

The files are generated in the browser and downloaded by the user. No cloud service, paid API, account connection or remote backup is used.

## Backup procedure

On the **Decision journal** workspace page:

1. Select **Download full decision journal backup**.
2. Save the downloaded JSON file somewhere outside the browser's site storage (for example, the phone's Downloads folder, then copy it to a separate safe location).
3. Select **Download separate paper account backup** and save that file separately.
4. Repeat after meaningful research or paper-account changes.

The decision journal export is not capped at the 100 records displayed in the UI. It exports all decision records and all linked events in one IndexedDB read transaction.

## Restore procedure

1. Open the Decision journal page on the target NEXUS installation/device.
2. Select the matching backup file under its own restore section. A decision journal file cannot be restored as a paper-account file, or vice versa.
3. NEXUS verifies the backup format, schema version and SHA-256 checksum, then validates the data and shows a read-only preview.
4. Review the counts and any conflicts.
5. Press the relevant **Confirm** button only if the preview is correct.

### Decision journal restore rules

- Records and events are validated before import.
- Event parent references and event timestamps are checked.
- Identical IDs with identical content are treated as unchanged duplicates.
- An existing ID with different content is a conflict and blocks the restore.
- The write uses one IndexedDB read-write transaction across both journal stores. A failed write aborts the transaction; no partial journal import is accepted.
- Restore is additive. Existing records and events are never updated or deleted.

### Paper account restore rules

- The paper-account file is separate from decision evidence.
- A restore is permitted into an empty account store.
- The automatically-created starter account may be replaced only while it is pristine: no fills, no open orders, no positions, unchanged initial cash, zero realised P&L and zero fees.
- Any paper account with trading activity is protected. There is no force-overwrite option.
- The restore validates account balances, configuration, positions, fills and open orders before writing.

## Integrity and limitations

- Each backup envelope records a schema version, backup type, creation timestamp and SHA-256 checksum over canonical JSON content.
- The checksum detects accidental or deliberate content changes; it is not a digital signature and does not prove who created a file.
- Backup files are unencrypted JSON. They contain research and paper-account data, not exchange credentials. Store them somewhere private.
- The current importer has a 25 MB file-size safety limit.
- Backups are device-local downloads. NEXUS does not automatically sync them, upload them or schedule them.
- Clearing browser data can still erase the local working copy. Keep downloaded backups outside the browser.
- A backup should be treated as untrusted input until checksum and structural validation complete. Do not edit the JSON by hand.

## Safety

Restore never sends exchange orders, changes live trading permissions or connects to an exchange. Paper account restoration only changes the local simulation state.
