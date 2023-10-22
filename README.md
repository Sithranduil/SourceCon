SourceCon - Simple SRCDS RCON for node.js
=========================================

Features
--------
* ***This fork use async await, with node 20***
* Executes arbitrary RCON commands
* Properly handles multi-part responses
* Emits push messages / server log, like sent by Rust
* Includes a command line RCON console

Usage
-----
`npm install sourcecon`

```js
import SourceRcon from '@hellz.fr/sourcecon';
const client = new SourceRcon.default("127.0.0.1", 25080);
await client.connect();
await client.auth("rconpass");
const status = await client.send("status");
console.log(status);
```

Command line
------------
* `npm install @hellz/sourcecon`
* Run `sourcecon` on the command line to start the RCON console

License: Apache License, Version 2.0
