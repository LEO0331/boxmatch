# Environment Matrix

## Flutter Client

- `BOXMATCH_API_BASE_URL`
  - Optional override for backend URL
  - Example: `https://boxmatch-api.onrender.com`

## Render Server Environment Variables

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
  - Keep escaped new lines (`\\n`) in Render env var value

## Local Development

- Flutter web run:
  - `flutter run -d chrome --dart-define=BOXMATCH_API_BASE_URL=http://localhost:8080`
- Server run:
  - `cd server && npm start`

## GitHub Secrets

- `RENDER_DEPLOY_HOOK_URL`
