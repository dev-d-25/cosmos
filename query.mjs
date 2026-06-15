import { conn } from './src/server/db/index.ts';

const rows = await conn`SELECT entity_type, entity_id, data FROM corsair_entities WHERE entity_type = 'messages' LIMIT 1;`;
console.log(JSON.stringify(rows, null, 2));