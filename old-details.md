# Old details (pre-2026-11-23 refresh)

Archived on 2026-11-23 before the repo-details refresh. Current details are in
README.md and the repo metadata.

## About description (before)

Local-first invoice tracker: invoices, due dates, partial/full payment records, file exports. Offline Android app, no bank connection.

## Website field (before)

(none)

## README.md (before)

```markdown
# tagih

Local-first invoice tracker for freelancers. Create invoices, track due
dates, record partial and full payments, and export your records — all on
your own device.

tagih is not a wallet and not connected to anything: no account, no server,
no bank or payment service integration, and no money is held or moved by
this app. It only keeps the records you type into it.

Status: early prototype.

## What it does

- **Invoices**: client name, numbered invoices (`2026-001`, …), line items
  with quantity and unit price, issue and due dates, notes.
- **Statuses**: draft → sent → partially paid → paid, derived from the
  payments you record; overdue invoices show how many days they are late.
- **Payments**: record partial or full payments with a date and a note;
  each invoice shows paid vs outstanding.
- **Archive, not delete**: finished or cancelled invoices move to a
  recoverable archive instead of being erased.
- **Exports**: a full JSON backup (re-importable), an invoices CSV and a
  payments CSV. On Android the files land in `Download/tagih/`.
- **Currencies**: IDR, USD, SGD, EUR, JPY; amounts are stored as exact
  integer minor units.

The app works fully offline. Data lives in the app's local storage on the
device; the JSON backup is how you move it.

## Repository layout

- `web/` — the whole app as a dependency-free web page (`index.html` UI +
  `tagih.js` core). Open it in any browser to try tagih; nothing is
  uploaded anywhere.
- `android/` — an offline WebView shell around the same `web/` assets, so
  the invoice logic is a single shared implementation. The shell adds a
  small bridge that saves exports into `Download/tagih/`.
- `tests/` — node unit tests for the core (`node tests/test_tagih.js`):
  totals, statuses, overdue math, import/export round-trips, CSV shape,
  archive behavior.
- `tools/badge_icon.py` — deterministic launcher icon generator (family
  rules: rounded square, picture, numbers-only version strip).

The demo-data button in the app adds clearly fictional invoices
("PT Contoh Jaya (fiktif)", …) for trying the app out; this repository and
its release artifacts contain no real client or payment records.

## Android

Package `com.vanipy.tagih`, launcher name `tagih`, no permissions (not even
INTERNET). Signed release APKs are on the
[releases page](https://github.com/irvan-putra/tagih/releases) as
`tagih-v<version>.apk` with a `.sha256` sidecar. The release workflow runs
the family consistency gate ([patuh](https://github.com/irvan-putra/patuh))
on the source and on the actual candidate APK bytes before publishing, and
verifies the live release afterwards.

## License

[AGPL-3.0](LICENSE)

```
