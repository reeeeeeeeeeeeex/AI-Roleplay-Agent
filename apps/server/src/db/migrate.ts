import { createDatabase } from './database.js';

const database = createDatabase();
database.sqlite.close();
console.log(`Database ready: ${database.path}`);

