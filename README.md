# Medirecord

## Password protection

Configure these environment variables on the backend host before starting the server:

- `APP_PASSWORD`: the password used to unlock the website (at least 12 characters).
- `SESSION_SECRET`: a private random string of at least 32 characters used to sign login sessions. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `APP_ORIGIN`: optional. Set this to the exact HTTPS origin serving the website only if the frontend is hosted on a different origin from the backend. Leave it unset when the Express server serves both the page and API.

Do not commit these values to the repository. Login sessions use an HttpOnly cookie and expire after 12 hours or when the browser session ends. The Lock button ends the current session.
