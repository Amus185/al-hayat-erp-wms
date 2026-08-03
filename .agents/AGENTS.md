# Project Guidelines & Rules

## Deployment Workflows
- **Frontend Changes (`web/`)**: Deploy directly to Cloudflare Pages using `npm run deploy:web`. Do not trigger unnecessary backend rebuilds or worry about Railway for frontend-only updates (Railway has path filtering watching `/backend/**` and skips frontend commits automatically).
- **Backend Changes (`backend/`)**: Commit and push to `origin main` to trigger Railway backend deployment.
