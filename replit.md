# Yuwa Mart on Replit

## Runtime

- Node.js 22
- Express server with a SQLite database
- Static frontend served by the Express server

## Run

The Replit web workflow runs:

```bash
cd server && PORT=5000 npm start
```

The app must use port 5000 so it is available in Replit's web preview.

## Configuration

Runtime settings are loaded from `server/.env`. Keep that file private.

- Change `ADMIN_PASSWORD` before sharing or publishing the app.
- `SPARROW_TOKEN` is optional. Without it, OTP codes are displayed in the app instead of sent by SMS.
- SQLite data and uploaded product images are stored locally in `server/data` and `server/uploads`.