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
    { "name": "Kilian Jornet", "alias": "Kilian", "itraRunnerId": 2704, "utmbId": 2704 }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Shown as the page heading. |
| `description` | no | Subtitle. |
| `runners[].name` | yes | The name the sources know them by; also the search term. |
| `runners[].alias` | no | Nickname shown instead of the name. Display only. |
| `runners[].itraRunnerId` | no | Pins the ITRA profile. |
| `runners[].utmbId` | no | Pins the UTMB profile. |

The filename must be lowercase letters, digits, and hyphens — that string is
the URL.

## Why pin the IDs

A refresh searches the name again, and without an ID two runners sharing a name
are indistinguishable — the app may show the wrong person's index. With an ID
the match is exact, and an ITRA ID goes further: it resolves off the runner's
own profile page, so somebody search would bury hundreds of rows down is still
found.

The easiest way to get the IDs is to add the runner in the app — either search
for them or paste their profile links — and export the list from the list
screen. The IDs are stored with the entry.

## Editing someone else's list

Opening `/crit` shows the roster committed here. The moment you add or remove a
runner, the app copies the list into your browser's local storage and uses that
copy instead. The committed file is never modified, and "Reset to original"
discards your copy and returns to it.
