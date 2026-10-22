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

## Building the styles

```sh
npm run build
```

Compiles the Tailwind CSS build to `public/styles.css` (not committed, and
not yet linked from the page — this is build-tooling scaffolding, ahead of
the visual redesign). The Docker image runs this as part of its build, so a
deployed `todo-web` always serves the compiled stylesheet at `/styles.css`.

## Running the tests

```sh
npm test
```

The tests exercise the server's routing and `/api/*` proxying, and drive the
frontend's own script in a headless DOM (`jsdom`) against the real server
over a Unix socket — neither needs a browser or a deployed environment.

## Browser tests against a deployed product

`e2e/` holds Playwright tests that run only against a deployed product, via
the `test` step declared in `.factory/environment.json`: they read
`FACTORY_URL_TODO_WEB` and `FACTORY_URL_TODO_CLI` and check the web app and
the web terminal from a real browser. They need no browser or deployment in
this repository's own sandbox and are not run by `npm test`.
