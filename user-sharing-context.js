'use strict';
// app.js keeps DB in the global lexical environment rather than as a window
// property. Export only the already-loaded client-side snapshot so the isolated
// anti-sharing asset can enrich the Users table without modifying app.js.
if(typeof DB!=='undefined')globalThis.DB=DB;
