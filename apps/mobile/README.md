# VibefyCode mobile

Expo (React Native) app. Read-and-monitor first, per PART 2 of the build brief: submit an
application, track it, read a report, receive alerts, approve a re-test. It is deliberately not
the console.

## What it cannot do, on purpose

Ownership verification, badge licence acceptance, billing and workspace administration are all
console-only. Each is a decision with a legal or financial consequence, and the app says so on the
Account tab rather than letting somebody discover it halfway through.

## Running it

```bash
cp .env.example .env.local          # at the repo root
EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... pnpm -F @vibefycode/mobile start
```

Both values are public by design — the anon key is meant to be shipped, because row-level
security is the guard, exactly as in the web app. **No service-role key ever reaches a phone**, and there is no
mobile API: the app reads the same tables through the same policies as the console, so an
authorisation rule cannot be right in one place and wrong in the other.

## Push notifications

`expo-notifications`, with the token stored in `public.device_tokens` against the signed-in user.
The worker's `sweepAlertPush` delivers `warning` and `critical` alerts only; an informational one
waits in the app. A token Expo reports as `DeviceNotRegistered` is disabled rather than retried
for ever.

Signing out deletes this device's tokens. One left behind would push the next person's alerts to
this handset.

## Icons

`pnpm brand:build` writes `icon.png`, `adaptive-icon.png` and `splash.png` into `assets/` from the
same masters the web favicon and the badge come from. Do not hand-edit them — see PART 11 of the
brief.
