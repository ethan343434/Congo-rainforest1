// Node module hooks: resolve the bare specifiers the browser gets from the
// import map ('three', 'astronomy-engine') to the vendored files.
import { register } from 'node:module';
register(new URL('./resolve-hooks.mjs', import.meta.url));
