# Staff sign-in with Better Auth

Better Auth handles **who you are**: email and password, sessions, sign-out,
and disabling users. The ERP still decides **what you may do**: roles,
permissions and branch, from its own tables, checked on every request.

| | Where |
|---|---|
| Server setup | `backend/src/auth.ts` (`betterAuth()` on the request's pg pool) |
| Handler | `/api/auth/*` (mounted in `backend/src/index.ts`) |
| Browser client | `web/src/lib/auth-client.ts` (`createAuthClient` + `adminClient`) |
| Sign-in screen | `web/src/contexts/AuthContext.tsx`: `authClient.signIn.email`, `authClient.signOut` |
| Request check | `backend/src/middleware/auth.ts`: Better Auth session, then ERP roles and branch |
| ERP users ↔ Better Auth | `backend/src/services/identity.ts` |
| Tables | `user`, `session`, `account`, `verification`, created by Better Auth's own migration (`npm --workspace backend run db:migrate`) |

## How it fits the ERP

- **One id.** An ERP user (`users.id`) and their Better Auth user (`"user".id`)
  share the same id. The Users page and branch accounts write both in one
  transaction, including the password (bcrypt, in `account.password`).
- **Existing passwords keep working.** The migration gives every ERP user a
  Better Auth identity and carries their bcrypt hash over. Everyone signs in
  once after the switch, because old sessions are not carried over.
- **No self sign-up.** `disableSignUp: true`: this is a staff system, so only
  administrators create accounts (ERP → Users). `authClient.signUp.email` is
  therefore refused by the server.
- **Browsers** get an HttpOnly, Secure, SameSite=Strict session cookie on the
  staff app's origin (the API is served there through the Pages proxy). The
  session token never appears in a response a page script can read. Every
  cookie-authenticated API request must also carry `X-CSRF-Protection: 1` and
  come from an allowed origin.
- **Mobile** signs in with `X-Client-Type: native`, reads the token from the
  `set-auth-token` header, and sends `Authorization: Bearer <token>` (bearer
  plugin).

## Layerbase dashboard

- **Disable user** sets `banned` on `"user"`. Banned users cannot sign in, and
  their open sessions are refused on the next request. An expired
  `banExpires` lifts the ban.
- **Roles** in Layerbase are Better Auth's `role` field (`admin` / `user`). The
  ERP sets it to `admin` for ERP administrators, for display. It grants
  **nothing** in the ERP: ERP roles and permissions are managed in ERP → Users.
- Better Auth's own admin API (`/api/auth/admin/*`) is limited to listing users,
  banning and ending sessions. Creating users, setting passwords or emails,
  changing roles, deleting and impersonating are not allowed there, so the ERP
  tables cannot drift and every change is audited in the ERP.

## Settings

| Name | Where | Value |
|---|---|---|
| `DATABASE_URL` | `backend/.env` (scripts) | Layerbase connection string |
| `BETTER_AUTH_SECRET` | Worker secret; `backend/.env` | `openssl rand -base64 32`. Required in production: without it every request answers 503. |
| `BETTER_AUTH_URL` | `backend/wrangler.jsonc` vars; `backend/.env` | The staff app's address, `https://al-hayat-erp.pages.dev` |

Changing `BETTER_AUTH_SECRET` signs everyone out.

## What changed for users

- Sign-in looks the same. Everyone signs in once after deploying.
- Sessions last 7 days and are extended while in use (at most once a day).
- Password change, deactivation, disabling in Layerbase and "sign out
  everywhere" end sessions immediately on every server.
- Failed sign-ins are still throttled in the database: 10 per email and IP,
  50 per email, per 15 minutes.

## Not done

- Persisting the mobile token in the device keystore (`expo-secure-store`):
  the app still asks for the password again after it is closed.
- Email verification and password reset by email: no mail service is set up.
  Administrators reset passwords in ERP → Users.
- The old tables `auth_sessions` and `refresh_tokens` are left in place (unused)
  for rollback. They can be dropped later.
