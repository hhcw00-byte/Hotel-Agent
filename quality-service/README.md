# Quality Service MVP

Standalone HTTP service for the Quality Task V1 workflow.

## Start

```bash
cd services/quality-service
npm install
npm run build
npm start
```

## Environment

Copy `.env.example` to `.env` and update the MySQL settings.

`PUBLIC_BASE_URL` is used to generate submit links. If it is empty, the service uses `http://localhost:${PORT}`.

## API

- `GET /health`
- `POST /api/quality/tasks`
- `GET /api/quality/tasks`
- `GET /api/quality/tasks/:taskId/result`
- `GET /quality/submit?taskId=xxx&submitToken=xxx`
- `GET /api/quality/submit-task?taskId=xxx&submitToken=xxx`
- `POST /api/quality/submit`
- `POST /api/quality/tasks/:taskId/approve`
- `POST /api/quality/tasks/:taskId/reject`
- `GET /uploads/quality/*`

Multipart submit expects:

- `taskId`
- `submitToken`
- `items`: JSON string, for example `[{"itemId":"...","remark":"..."}]`
- files with field name `file:<itemId>`

This MVP has no login/auth, notification, scoring, reports, Docker, or Electron integration changes.
