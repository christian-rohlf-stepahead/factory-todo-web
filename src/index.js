import { createServer } from './server.js';

const port = Number(process.env.PORT) || 3000;
const apiUrl = process.env.TODO_API_URL || 'http://localhost:3001';

const server = await createServer({ apiUrl });
server.listen(port, () => {
  console.log(`Todo Web listening on http://localhost:${port} (forwarding /api/* to ${apiUrl})`);
});
