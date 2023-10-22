/*
 Copyright 2013 Daniel Wirtz <dcode@dcode.io>

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

/**
 * SourceCon (c) 2014 Daniel Wirtz <dcode@dcode.io>
 * Released under the Apache License, Version 2.0
 * see: https://github.com/dcodeIO/SourceCon for details
 */

import net from 'net';
import { EventEmitter } from 'node:events';
import { SourceConType } from '../types/SourceConType';

/**
 * Constructs a new SourceCon.
 * @param {string} host Server hostname
 * @param {number} port Server RCON port
 * @extends EventEmitter
 */
class SourceCon extends EventEmitter{
  /**
   * Server hostname.
   * @type {string}
   */
  host: string;

  /**
   * Server RCON port.
   * @type {number}
   */
  port: number;

  /**
   * Next packet id.
   * @type {number}
   */
  packetId: number = 1;

  /**
   * Callback store.
   * @type {Object.<number,Object>}
   */
  callbackStore: any = {}

  /**
   * RCON connection.
   * @type {net.Socket}
   */
  socket: net.Socket | undefined;

  /**
   * Receive buffer.
   * @type {!Buffer}
   */
  buffer: Buffer = new Buffer(0);

  /**
   * Enables debug output to console.
   * @type {boolean}
   */
  debug: boolean = false;

  event;

  constructor(host: string, port: number) {
      super();
      this.host = host;
      this.port = port;
      this.event = new EventEmitter();
  }

  /**
   * Connects to the server.
   * @returns {Promise<boolean>} `true` if now connecting, `false` if already connecting or connected
   */
  async connect(): Promise<boolean> {
    if (this.socket) {
      return false;
    }

    this.socket = new net.Socket();

    this.socket.on('error', (err: any) => {
      this.event.emit('error', err);
      this.disconnect();
      throw err;
    });

    this.socket.on('end', () => {
      this.disconnect();
    });

    return new Promise((resolve) => {
      if (!this.socket) {
        return resolve(false);
      }

      this.socket.connect(this.port, this.host, () => {
        if (!this.socket) {
          return resolve(false);
        }

        this.socket.on('data', (data: any) => {
          // Collect all incoming chunks
          this.buffer = Buffer.concat([this.buffer, data]);
          // And process what we have as soon as enough data is available
          this._process();
        });
        this.event.emit('connect');
      });
      return resolve(true);
    });
  }

  /**
   * Processes all buffered messages.
   * @private
   */
  _process(): any {
    while (this.buffer.length >= 12) {
      const size = this.buffer.readInt32LE(0);
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);

      if (this.buffer.length < 4 + size) {
        break; // Need more data
      }
      const body = this.buffer.slice(12, 4 + size - 2);

      if (this.debug)
        console.log(
          '>>> size=' +
            size +
            ', id=' +
            id +
            ', type=' +
            type +
            ' : ' +
            body.toString('ascii')
        );

      if (this.callbackStore.hasOwnProperty(id)) {
        let cbs = this.callbackStore[id]; // {cb, id, type, buffer} OR {finId}
        if (typeof cbs.finId === 'number') {
          delete this.callbackStore[id];
          const finId = cbs.finId;
          if (this.callbackStore.hasOwnProperty(finId)) {
            cbs = this.callbackStore[finId];
            delete this.callbackStore[finId];
            if (cbs.cb) cbs.cb(null, cbs.buffer);
          }
        } else {
          if (cbs.type === SourceConType.SERVERDATA_AUTH) {
            // In this case all we need to know is the AUTH_RESPONSE
            if (type === SourceConType.SERVERDATA_AUTH_RESPONSE) {
              delete this.callbackStore[id];
                this.event.emit('response', {});
            }
          } else if (
            cbs.type === SourceConType.SERVERDATA_RESPONSE_VALUE ||
            cbs.type === SourceConType.SERVERDATA_EXECCOMMAND
          ) {
            // Collect everything, even multiple packets
            if (cbs.buffer.length === 0) {
              cbs.buffer = body;
              this.event.emit('response', body.toString('ascii'));
            } else {
              cbs.buffer = Buffer.concat([cbs.buffer, body]);
            }
          }
        }
      }
      this.event.emit('message', {
        size: size,
        id: id,
        type: type,
        body: body,
      });
        this.buffer = this.buffer.slice(4 + size, this.buffer.length);
    }
  }

  /**
   * Disconnects from the server.
   * @returns {boolean} `true` if disconnected, `false` if already disconnected
   */
  disconnect() {
    if (!this.socket) return false;
    this.socket.removeAllListeners();
    this.socket.end();
    this.socket = undefined;
    this.event.emit('disconnect');
    return true;
  }

  /**
   * Generates the next id value.
   * @param {number} id Current id value
   * @returns {number} Next id value
   */
  nextId(id: number): number {
    id = ((id + 1) & 0xffffffff) | 0;
    if (id === -1) id++; // Do not use -1
    if (id === 0) id++; // Do not use 0
    return id;
  }

  /**
   * Creates a request packet.
   * @param {number} id Request id
   * @param {number} type Request type
   * @param {!Buffer} body Request data
   * @returns {!Buffer}
   */
  pack(id: number, type: number, body: Buffer): Buffer {
    var buf = new Buffer(body.length + 14);
    buf.writeInt32LE(body.length + 10, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    body.copy(buf, 12);
    buf[buf.length - 2] = 0;
    buf[buf.length - 1] = 0;
    return buf;
  }

  /**
   * Sends a command to the server.
   * @param {!Buffer|string} cmd Command to execute
   * @param {number|function(Error, Buffer=)} type Message type (omittable)
   */
  async send(
    cmd: Buffer | string,
    type: SourceConType = SourceConType.SERVERDATA_EXECCOMMAND
  ) {
    if (typeof type !== 'number') {
      type = SourceConType.SERVERDATA_EXECCOMMAND;
    }
    if (!this.socket) {
      process.nextTick(() => {
        var err = new Error('Not connected');
        this.event.emit('error', err);
        throw err;
      });
      return;
    }
    if (!Buffer.isBuffer(cmd)) {
      cmd = new Buffer(cmd, 'ascii');
    }
    const req = this.pack(this.packetId, type, cmd),
      next_id = this.nextId(this.packetId);
    this.callbackStore[this.packetId] = {
      // Actual request
      id: this.packetId,
      type: type,
      buffer: new Buffer(0),
    };
    this.callbackStore[next_id] = {
      // Pseudo SRV
      finId: this.packetId,
    };
    if (this.debug)
      console.log(
        '<<< size=' +
          (req.length - 4) +
          ', id=' +
          this.packetId +
          ', type=' +
          type +
          ' : ' +
          cmd.toString('ascii')
      );
    // Write the actual request
    this.socket.write(req);
    this.packetId = this.nextId(this.packetId);

    // Write an empty SRV to reliably find the end of the previous response
    if (type !== SourceConType.SERVERDATA_AUTH) {
      this.socket.write(
        this.pack(
          this.packetId,
          SourceConType.SERVERDATA_RESPONSE_VALUE,
          new Buffer(0)
        )
      );
      this.packetId = this.nextId(this.packetId);
    }

      return new Promise(async (resolve) => {
          this.event.addListener('response', (value) => {
              return resolve(value)
          })
      });

  }

  /**
   * Authenticates with the server.
   * @param {string} pass RCON password
   */
  async auth(pass: string) {
    return new Promise(async (resolve) => {
      const data = await this.send(pass, SourceConType.SERVERDATA_AUTH);
      this.event.emit('auth');
      return resolve(data);
    });
  }
}

export default SourceCon;
