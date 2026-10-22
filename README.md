# Todo Web

A small Node server and plain, vanilla-JS frontend for the todo list. The
browser only ever talks to this server's own host; the server forwards
`/api/*` requests to the todo API.

## Running locally

```sh
npm install
TODO_API_URL=http://localhost:3000 npm start
```

The server listens on `http://localhost:3000` by default and serves the
frontend from `public/`.

Configure these with environment variables:

- `PORT` — port to listen on (default `3000`)
- `TODO_API_URL` — base URL of the todo API to forward `/api/*` requests to
  (default `http://localhost:3001`)

Any request to `/api/<rest>` is forwarded to `${TODO_API_URL}/<rest>`
(method, body, and status passed through unchanged); every other request is
served from the static frontend.

## Running the tests

```sh
npm test
```

The tests exercise the server's routing and `/api/*` proxying, and drive the
frontend's own script in a headless DOM (`jsdom`) against the real server
over a Unix socket — neither needs a browser or a deployed environment.
