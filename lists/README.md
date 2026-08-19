# Shared lists

Every `*.json` file here becomes a route. `crit.json` is served at `/crit`.

To publish your own list, add a file and open a pull request — no code changes
needed.

## Format

```json
{
  "name": "CRIT",
  "description": "Runners the CRIT crew follows",
  "runners": [
    { "name": "Kilian Jornet", "itraRunnerId": 2704, "utmbId": 2704 }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Shown as the page heading. |
| `description` | no | Subtitle. |
| `runners[].name` | yes | Also used as the upstream search term. |
| `runners[].itraRunnerId` | no | Pins the ITRA profile. |
| `runners[].utmbId` | no | Pins the UTMB profile. |

The filename must be lowercase letters, digits, and hyphens — that string is
the URL.

## Why pin the IDs

Neither source lets us look a runner up by ID directly (ITRA's per-runner
endpoints return 401), so refreshing means searching the name again. Without an
ID, two runners sharing a name are indistinguishable and the app may show the
wrong person's index. With an ID, the match is exact.

The easiest way to find the IDs is to search for the runner in the app and add
them — the resolved IDs are stored with the entry, and the list can be exported
from the list screen.

## Editing someone else's list

Opening `/crit` shows the roster committed here. The moment you add or remove a
runner, the app copies the list into your browser's local storage and uses that
copy instead. The committed file is never modified, and "Reset to original"
discards your copy and returns to it.
