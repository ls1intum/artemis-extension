"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions2, generateMask) {
        this._extensions = extensions2 || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions2) {
      return Object.keys(extensions2).map((extension) => {
        let configurations = extensions2[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var closeTimeout = 30 * 1e3;
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket3 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket3, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket3.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket3.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket3.prototype.addEventListener = addEventListener;
    WebSocket3.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket3;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket3.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions2;
          try {
            extensions2 = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions2);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions2[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket3.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket3.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket3.CLOSED) return;
      if (websocket.readyState === WebSocket3.OPEN) {
        websocket._readyState = WebSocket3.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket3.CLOSING;
      let chunk;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && (chunk = websocket._socket.read()) !== null) {
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket3.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket3.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket3 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket3 = require_websocket();
    var { GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket3,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions2 = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions2[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions2,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions2, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions2, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions2[PerMessageDeflate.extensionName]) {
          const params = extensions2[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions2;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode17 = __toESM(require("vscode"));

// src/utils/recommendedExtensions.ts
var RECOMMENDED_EXTENSION_CATEGORIES = [
  {
    id: "java",
    name: "Java Development",
    description: "Core tooling that supports Java-based Artemis programming exercises.",
    extensions: [
      {
        id: "vscjava.vscode-java-pack",
        name: "Extension Pack for Java",
        publisher: "Microsoft",
        description: "Bundles language support, debugger, project manager, test runner, and Maven tooling for Java.",
        reason: "Baseline toolkit for Java programming exercises in Artemis."
      },
      {
        id: "vscjava.vscode-gradle",
        name: "Gradle for Java",
        publisher: "Microsoft",
        description: "Adds Gradle Tasks explorer, build integration, and dependency insights.",
        reason: "Required to work with the Gradle build scripts used in many Artemis templates."
      },
      {
        id: "k--kato.intellij-idea-keybindings",
        name: "IntelliJ IDEA Keybindings",
        publisher: "Kei Kato",
        description: "Replicates IntelliJ IDEA shortcuts inside VS Code.",
        reason: "Helpful if you are accustomed to IntelliJ shortcuts from Artemis courses."
      },
      {
        id: "maptz.regionfolder",
        name: "#region folding for VS Code",
        publisher: "Maptz",
        description: "Enables custom folding regions using #region and #endregion comments in any language.",
        reason: "Optional: helps organize and collapse code sections for better readability.",
        optional: true
      }
    ]
  }
];
function getRecommendedExtensionsByCategory() {
  return RECOMMENDED_EXTENSION_CATEGORIES.map((category) => ({
    ...category,
    extensions: category.extensions.map((extension) => ({ ...extension }))
  }));
}

// src/views/app/appStateManager.ts
var AppStateManager = class {
  constructor(_artemisApi) {
    this._artemisApi = _artemisApi;
  }
  _currentState = "login";
  _userInfo;
  _coursesData;
  _archivedCoursesData;
  _currentCourseData;
  _currentExerciseData;
  _aiExtensions;
  _recommendedExtensions;
  // State getters
  get currentState() {
    return this._currentState;
  }
  get userInfo() {
    return this._userInfo;
  }
  get coursesData() {
    return this._coursesData;
  }
  get archivedCoursesData() {
    return this._archivedCoursesData;
  }
  get currentCourseData() {
    return this._currentCourseData;
  }
  get currentExerciseData() {
    return this._currentExerciseData;
  }
  get aiExtensions() {
    return this._aiExtensions;
  }
  get recommendedExtensions() {
    return this._recommendedExtensions;
  }
  // State transitions
  async showDashboard(userInfo) {
    this._userInfo = userInfo;
    this._currentState = "dashboard";
    try {
      if (!this._coursesData) {
        this._coursesData = await this._artemisApi.getCoursesForDashboard();
      }
    } catch (error) {
      console.error("Error loading courses for dashboard:", error);
    }
  }
  showLogin() {
    this._currentState = "login";
    this._userInfo = void 0;
    this._coursesData = void 0;
    this._archivedCoursesData = void 0;
    this._currentCourseData = void 0;
    this._currentExerciseData = void 0;
    this._recommendedExtensions = void 0;
  }
  async showCourseList() {
    try {
      if (!this._coursesData) {
        this._coursesData = await this._artemisApi.getCoursesForDashboard();
      }
      this._currentState = "course-list";
    } catch (error) {
      console.error("Error loading courses:", error);
      throw error;
    }
  }
  showCourseDetail(courseData) {
    this._currentCourseData = courseData;
    this._currentState = "course-detail";
  }
  async showArchivedCourseDetail(courseId) {
    try {
      const courseDetails = await this._artemisApi.getCourseDetails(courseId);
      const archivedCourseData = {
        course: {
          ...courseDetails,
          exercises: [],
          // Empty exercises array for archived courses
          isArchived: true
          // Mark this as archived for potential UI differences
        }
      };
      this._currentCourseData = archivedCourseData;
      this._currentState = "course-detail";
    } catch (error) {
      console.error("Error loading archived course details:", error);
      throw error;
    }
  }
  async showExerciseDetail(exerciseId) {
    try {
      const exerciseDetails = await this._artemisApi.getExerciseDetails(exerciseId);
      this._currentExerciseData = exerciseDetails;
      this._currentState = "exercise-detail";
    } catch (error) {
      console.error("Error loading exercise details:", error);
      throw error;
    }
  }
  backToCourseDetails() {
    this._currentState = "course-detail";
  }
  // Data management
  clearCoursesData() {
    this._coursesData = void 0;
  }
  setCoursesData(data) {
    this._coursesData = data;
  }
  async loadArchivedCourses() {
    try {
      this._archivedCoursesData = await this._artemisApi.getArchivedCourses();
    } catch (error) {
      console.error("Error loading archived courses:", error);
      throw error;
    }
  }
  showAiConfig(aiExtensions) {
    this._aiExtensions = aiExtensions;
    this._currentState = "ai-config";
  }
  showServiceStatus() {
    this._currentState = "service-status";
  }
  showRecommendedExtensions(recommendedExtensions) {
    if (recommendedExtensions) {
      this._recommendedExtensions = recommendedExtensions.map((category) => ({
        ...category,
        extensions: category.extensions.map((extension) => ({ ...extension }))
      }));
    } else {
      this._recommendedExtensions = getRecommendedExtensionsByCategory();
    }
    this._currentState = "recommended-extensions";
  }
  isLoggedIn() {
    return this._userInfo !== void 0;
  }
  requiresAuth() {
    return this._currentState !== "login" && !this.isLoggedIn();
  }
  // State validation
  canShowDashboard() {
    return this.isLoggedIn();
  }
  canShowCourseList() {
    return this.isLoggedIn();
  }
  canShowCourseDetail() {
    return this.isLoggedIn() && this._currentCourseData !== void 0;
  }
  canShowExerciseDetail() {
    return this.isLoggedIn() && this._currentExerciseData !== void 0;
  }
};

// src/views/app/viewRouter.ts
var vscode4 = __toESM(require("vscode"));

// src/themes/index.ts
var vscode = __toESM(require("vscode"));

// src/themes/themes/vscode.ts
var vscodeTheme = {
  // Colors using authentic VS Code CSS variables
  background: "var(--vscode-sideBar-background)",
  foreground: "var(--vscode-sideBar-foreground)",
  cardBackground: "var(--vscode-editor-background)",
  border: "var(--vscode-sideBar-border)",
  // Interactive elements - use primary button styling
  buttonBackground: "var(--vscode-button-background)",
  buttonForeground: "var(--vscode-button-foreground)",
  buttonHover: "var(--vscode-button-hoverBackground)",
  buttonActive: "var(--vscode-button-hoverBackground)",
  // Input elements - match VSCode input styling
  inputBackground: "var(--vscode-input-background)",
  inputForeground: "var(--vscode-input-foreground)",
  inputBorder: "var(--vscode-input-border)",
  inputFocus: "var(--vscode-focusBorder)",
  // Status colors - use semantic VSCode colors
  successColor: "var(--vscode-terminal-ansiGreen)",
  errorColor: "var(--vscode-errorForeground)",
  infoColor: "var(--vscode-terminal-ansiBlue)",
  // Layout - VSCode native spacing and sizing
  containerPadding: "12px",
  containerBorderRadius: "3px",
  elementSpacing: "12px",
  formSpacing: "8px",
  // Visual effects - VSCode flat design
  boxShadow: "none",
  backdrop: "none",
  transition: "none",
  // Typography - VSCode native font styling
  fontFamily: "var(--vscode-font-family)",
  fontSize: "var(--vscode-font-size)",
  fontWeight: "400",
  lineHeight: "1.4"
};
var vscodeThemeConfig = {
  name: "vscode",
  displayName: "VS Code",
  theme: vscodeTheme
};

// src/themes/themes/modern.ts
var modernTheme = {
  // Colors - clean, professional palette that adapts to VS Code theme
  background: "var(--vscode-editor-background)",
  foreground: "var(--vscode-foreground)",
  cardBackground: "var(--vscode-sideBar-background)",
  border: "var(--vscode-sideBar-border)",
  // Interactive elements - use VS Code button tokens
  buttonBackground: "var(--vscode-button-background)",
  buttonForeground: "var(--vscode-button-foreground)",
  buttonHover: "var(--vscode-button-hoverBackground)",
  buttonActive: "var(--vscode-button-hoverBackground)",
  // Input elements - VS Code-aligned
  inputBackground: "var(--vscode-input-background)",
  inputForeground: "var(--vscode-input-foreground)",
  inputBorder: "var(--vscode-input-border)",
  inputFocus: "var(--vscode-focusBorder)",
  // Status colors - VS Code semantic colors
  successColor: "var(--vscode-terminal-ansiGreen)",
  errorColor: "var(--vscode-errorForeground)",
  infoColor: "var(--vscode-terminal-ansiBlue)",
  // Layout - spacious, card-focused
  containerPadding: "28px",
  containerBorderRadius: "12px",
  elementSpacing: "24px",
  formSpacing: "18px",
  // Visual effects - subtle, professional (flat in VS Code)
  boxShadow: "none",
  backdrop: "none",
  transition: "all 0.15s ease-in-out",
  // Typography - clean, readable
  fontFamily: "var(--vscode-font-family)",
  fontSize: "14px",
  fontWeight: "500",
  lineHeight: "1.5"
};
var modernThemeConfig = {
  name: "modern",
  displayName: "Modern",
  theme: modernTheme
};

// src/themes/themes/synthwave.ts
var synthwaveTheme = {
  // Colors - dark synthwave with neon gradients
  background: "linear-gradient(135deg, #0f0c29 0%, #302b63 35%, #24243e 100%)",
  foreground: "#ff006e",
  cardBackground: "rgba(15, 12, 41, 0.9)",
  border: "#ff006e",
  // Interactive elements - neon glow effects
  buttonBackground: "linear-gradient(135deg, #ff006e 0%, #8338ec 100%)",
  buttonForeground: "#ffffff",
  buttonHover: "linear-gradient(135deg, #ff1f8f 0%, #9d4edd 100%)",
  buttonActive: "linear-gradient(135deg, #d90459 0%, #7209b7 100%)",
  // Input elements - synthwave neon styling
  inputBackground: "rgba(15, 12, 41, 0.8)",
  inputForeground: "#00f5ff",
  inputBorder: "#00f5ff",
  inputFocus: "#ff006e",
  // Status colors - vibrant synthwave palette
  successColor: "#39ff14",
  errorColor: "#ff073a",
  infoColor: "#00f5ff",
  // Layout - retro spacing with sharp edges
  containerPadding: "24px",
  containerBorderRadius: "8px",
  elementSpacing: "20px",
  formSpacing: "16px",
  // Visual effects - neon glow and retro styling
  boxShadow: "0 0 20px rgba(255, 0, 110, 0.4), inset 0 0 20px rgba(0, 245, 255, 0.1)",
  backdrop: "blur(8px)",
  transition: "all 0.3s ease-in-out",
  // Typography - retro-futuristic font
  fontFamily: '"Courier New", Consolas, "SF Mono", Monaco, monospace',
  fontSize: "14px",
  fontWeight: "500",
  lineHeight: "1.6"
};
var synthwaveThemeConfig = {
  name: "synthwave",
  displayName: "Synthwave",
  theme: synthwaveTheme
};

// src/utils/constants.ts
var CONFIG = {
  ARTEMIS_SERVER_URL_DEFAULT: "https://artemis.tum.de",
  AUTH_COOKIE_NAME: "jwt",
  SECRET_KEYS: {
    AUTH_COOKIE: "artemis-auth-cookie",
    ARTEMIS_TOKEN: "artemis-auth-token",
    ARTEMIS_SERVER_URL: "artemis-server-url"
  },
  WEBVIEW: {
    VIEW_TYPE: "artemis.loginView",
    TITLE: "Artemis Login"
  },
  API: {
    ENDPOINTS: {
      AUTHENTICATE: "/api/core/public/authenticate",
      ACCOUNT: "/api/core/public/account",
      COURSES: "/api/core/courses",
      EXERCISES: "/api/core/courses/{courseId}/exercises",
      PARTICIPATIONS: "/api/core/participations",
      RESULTS: "/api/core/participations/{participationId}/results",
      VCS_TOKEN: "/api/core/account/participation-vcs-access-token",
      START_PARTICIPATION: "/api/exercise/exercises/{exerciseId}/participations"
    },
    USER_AGENT: "VS Code Extension - Iris Thaumantias"
  }
};
var VSCODE_CONFIG = {
  ARTEMIS_SECTION: "artemis",
  SERVER_URL_KEY: "serverUrl",
  THEME_KEY: "theme",
  SHOW_IRIS_EXPLANATION_KEY: "showIrisExplanation",
  DEFAULT_COMMIT_MESSAGE_KEY: "defaultCommitMessage"
};

// src/utils/iconDefinitions.ts
var IconDefinitions = class {
  /**
   * All exercise type icons as SVG strings
   */
  static icons = {
    "default": `<svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8V12L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "programming": `<svg viewBox="0 0 576 512" fill="none">
            <path fill="currentColor" d="M64 64C28.7 64 0 92.7 0 128L0 384c0 35.3 28.7 64 64 64l448 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64L64 64zm16 64l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM64 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zM176 128l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM160 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l224 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-224 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-176c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16z"/>
        </svg>`,
    "quiz": `<svg viewBox="0 0 24 24" fill="none">
            <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2"/>
        </svg>`,
    "file-upload": `<svg viewBox="0 0 24 24" fill="none">
            <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 10L12 5L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 5V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "modeling": `<svg viewBox="0 0 24 24" fill="none">
            <path d="M21 16V8C20.9996 7.64928 20.9071 7.30481 20.7315 7.00116C20.556 6.69751 20.3037 6.44536 20 6.27L13 2.27C12.696 2.09446 12.3511 2.00205 12 2.00205C11.6489 2.00205 11.304 2.09446 11 2.27L4 6.27C3.69626 6.44536 3.44398 6.69751 3.26846 7.00116C3.09294 7.30481 3.00036 7.64928 3 8V16C3.00036 16.3507 3.09294 16.6952 3.26846 16.9988C3.44398 17.3025 3.69626 17.5546 4 17.73L11 21.73C11.304 21.9055 11.6489 21.9979 12 21.9979C12.3511 21.9979 12.696 21.9055 13 21.73L20 17.73C20.3037 17.5546 20.556 17.3025 20.7315 16.9988C20.9071 16.6952 20.9996 16.3507 21 16Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3.27002 6.96L12 12.01L20.73 6.96" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 22.08V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "text": `<svg viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 13H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 17H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 9H9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "course": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 19V6.2C4 5.0799 4 4.51984 4.21799 4.09202C4.40973 3.71569 4.71569 3.40973 5.09202 3.21799C5.51984 3 6.0799 3 7.2 3H16.8C17.9201 3 18.4802 3 18.908 3.21799C19.2843 3.40973 19.5903 3.71569 19.782 4.09202C20 4.51984 20 5.0799 20 6.2V17H6C4.89543 17 4 17.8954 4 19ZM4 19C4 20.1046 4.89543 21 6 21H20M9 7H15M9 11H15M19 17V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "exercise": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 6L21 6.00072M11 12L21 12.0007M11 18L21 18.0007M3 11.9444L4.53846 13.5L8 10M3 5.94444L4.53846 7.5L8 4M4.5 18H4.51M5 18C5 18.2761 4.77614 18.5 4.5 18.5C4.22386 18.5 4 18.2761 4 18C4 17.7239 4.22386 17.5 4.5 17.5C4.77614 17.5 5 17.7239 5 18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "refresh": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 12C21 16.9706 16.9706 21 12 21C9.69494 21 7.59227 20.1334 6 18.7083L3 16M3 12C3 7.02944 7.02944 3 12 3C14.3051 3 16.4077 3.86656 18 5.29168L21 8M3 21V16M3 16H8M21 3V8M21 8H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "trash": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 12L14 16M14 12L10 16M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.523 3 12.6936 3H11.3064C10.477 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6M18 6V16.2C18 17.8802 18 18.7202 17.673 19.362C17.3854 19.9265 16.9265 20.3854 16.362 20.673C15.7202 21 14.8802 21 13.2 21H10.8C9.11984 21 8.27976 21 7.63803 20.673C7.07354 20.3854 6.6146 19.9265 6.32698 19.362C6 18.7202 6 17.8802 6 16.2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "stethoscope": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M6.75 8.25V6V4.5H8.25H9.75V6L8.25 6L8.25 8.25C8.25 10.3211 9.92893 12 12 12C14.0711 12 15.75 10.3211 15.75 8.25V6H14.25V4.5H15.75H17.25V6V8.25C17.25 10.8949 15.2942 13.0829 12.75 13.4468V16.5C12.75 17.7426 13.7574 18.75 15 18.75C16.0376 18.75 16.9112 18.0476 17.1712 17.0924C16.3387 16.7624 15.75 15.95 15.75 15C15.75 13.7574 16.7574 12.75 18 12.75C19.2426 12.75 20.25 13.7574 20.25 15C20.25 15.9999 19.5978 16.8475 18.6955 17.1404C18.3916 18.9064 16.8527 20.25 15 20.25C12.9289 20.25 11.25 18.5711 11.25 16.5V13.4468C8.70578 13.0829 6.75 10.8949 6.75 8.25ZM18.75 15C18.75 15.4142 18.4142 15.75 18 15.75C17.5858 15.75 17.25 15.4142 17.25 15C17.25 14.5858 17.5858 14.25 18 14.25C18.4142 14.25 18.75 14.5858 18.75 15Z" fill="currentColor"/>
        </svg>`,
    "star": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.245 4.174C11.4765 3.50808 11.5922 3.17513 11.7634 3.08285C11.9115 3.00298 12.0898 3.00298 12.238 3.08285C12.4091 3.17513 12.5248 3.50808 12.7563 4.174L14.2866 8.57639C14.3525 8.76592 14.3854 8.86068 14.4448 8.93125C14.4972 8.99359 14.5641 9.04218 14.6396 9.07278C14.725 9.10743 14.8253 9.10947 15.0259 9.11356L19.6857 9.20852C20.3906 9.22288 20.743 9.23007 20.8837 9.36432C21.0054 9.48051 21.0605 9.65014 21.0303 9.81569C20.9955 10.007 20.7146 10.2199 20.1528 10.6459L16.4387 13.4616C16.2788 13.5829 16.1989 13.6435 16.1501 13.7217C16.107 13.7909 16.0815 13.8695 16.0757 13.9507C16.0692 14.0427 16.0982 14.1387 16.1563 14.3308L17.506 18.7919C17.7101 19.4667 17.8122 19.8041 17.728 19.9793C17.6551 20.131 17.5108 20.2358 17.344 20.2583C17.1513 20.2842 16.862 20.0829 16.2833 19.6802L12.4576 17.0181C12.2929 16.9035 12.2106 16.8462 12.1211 16.8239C12.042 16.8043 11.9593 16.8043 11.8803 16.8239C11.7908 16.8462 11.7084 16.9035 11.5437 17.0181L7.71805 19.6802C7.13937 20.0829 6.85003 20.2842 6.65733 20.2583C6.49056 20.2358 6.34626 20.131 6.27337 19.9793C6.18915 19.8041 6.29123 19.4667 6.49538 18.7919L7.84503 14.3308C7.90313 14.1387 7.93218 14.0427 7.92564 13.9507C7.91986 13.8695 7.89432 13.7909 7.85123 13.7217C7.80246 13.6435 7.72251 13.5829 7.56262 13.4616L3.84858 10.6459C3.28678 10.2199 3.00588 10.007 2.97101 9.81569C2.94082 9.65014 2.99594 9.48051 3.11767 9.36432C3.25831 9.23007 3.61074 9.22289 4.31559 9.20852L8.9754 9.11356C9.176 9.10947 9.27631 9.10743 9.36177 9.07278C9.43726 9.04218 9.50414 8.99359 9.55657 8.93125C9.61593 8.86068 9.64887 8.76592 9.71475 8.57639L11.245 4.174Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "star-4-edges": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3L13.4302 8.31181C13.6047 8.96 13.692 9.28409 13.8642 9.54905C14.0166 9.78349 14.2165 9.98336 14.451 10.1358C14.7159 10.308 15.04 10.3953 15.6882 10.5698L21 12L15.6882 13.4302C15.04 13.6047 14.7159 13.692 14.451 13.8642C14.2165 14.0166 14.0166 14.2165 13.8642 14.451C13.692 14.7159 13.6047 15.04 13.4302 15.6882L12 21L10.5698 15.6882C10.3953 15.04 10.308 14.7159 10.1358 14.451C9.98336 14.2165 9.78349 14.0166 9.54905 13.8642C9.28409 13.692 8.96 13.6047 8.31181 13.4302L3 12L8.31181 10.5698C8.96 10.3953 9.28409 10.308 9.54905 10.1358C9.78349 9.98336 9.98336 9.78349 10.1358 9.54905C10.308 9.28409 10.3953 8.96 10.5698 8.31181L12 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "cursor": `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
            <svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.2607 12.4008C19.3774 11.2626 20.4357 10.6935 20.7035 10.0084C20.9359 9.41393 20.8705 8.74423 20.5276 8.20587C20.1324 7.58551 18.984 7.23176 16.6872 6.52425L8.00612 3.85014C6.06819 3.25318 5.09923 2.95471 4.45846 3.19669C3.90068 3.40733 3.46597 3.85584 3.27285 4.41993C3.051 5.06794 3.3796 6.02711 4.03681 7.94545L6.94793 16.4429C7.75632 18.8025 8.16052 19.9824 8.80519 20.3574C9.36428 20.6826 10.0461 20.7174 10.6354 20.4507C11.3149 20.1432 11.837 19.0106 12.8813 16.7454L13.6528 15.0719C13.819 14.7113 13.9021 14.531 14.0159 14.3736C14.1168 14.2338 14.2354 14.1078 14.3686 13.9984C14.5188 13.8752 14.6936 13.7812 15.0433 13.5932L17.2607 12.4008Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "gear": `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "puzzle": `<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L15.6 5.6C18 -0.7 24.7 6 18.4 8.4L22 12L18.4 15.6C16 9.3 9.3 16 15.6 18.4L12 22L8.4 18.4C6 24.7 -0.7 18 5.6 15.6L2 12L5.6 8.4C8 14.7 14.7 8 8.4 5.6L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "web": `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M12 2C14.5013 4.73835 15.9228 8.29203 16 12C15.9228 15.708 14.5013 19.2616 12 22C9.49872 19.2616 8.07725 15.708 8 12C8.07725 8.29203 9.49872 4.73835 12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "logout": `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3.651 16.989h17.326c0.553 0 1-0.448 1-1s-0.447-1-1-1h-17.264l3.617-3.617c0.391-0.39 0.391-1.024 0-1.414s-1.024-0.39-1.414 0l-5.907 6.062 5.907 6.063c0.196 0.195 0.451 0.293 0.707 0.293s0.511-0.098 0.707-0.293c0.391-0.39 0.391-1.023 0-1.414zM29.989 0h-17c-1.105 0-2 0.895-2 2v9h2.013v-7.78c0-0.668 0.542-1.21 1.21-1.21h14.523c0.669 0 1.21 0.542 1.21 1.21l0.032 25.572c0 0.668-0.541 1.21-1.21 1.21h-14.553c-0.668 0-1.21-0.542-1.21-1.21v-7.824l-2.013 0.003v9.030c0 1.105 0.895 2 2 2h16.999c1.105 0 2.001-0.895 2.001-2v-28c-0-1.105-0.896-2-2-2z" fill="currentColor"/>
        </svg>`,
    "uploadmessage": `<svg viewBox="0 0 512 512" width="512" height="512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Chat bubble outline -->
            <path d="M288 80h-40c-110 0-200 90-200 200 0 42 13 82 36 116 15 23 16 43 1 74-10 20-7 26 16 26 37 0 61-7 93-31 8-6 14-8 24-5 23 8 47 12 72 12h8c110 0 200-90 200-200v-8"
                    stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
            
            <!-- Ellipsis dots -->
            <circle cx="176" cy="272" r="20" fill="currentColor"/>
            <circle cx="256" cy="272" r="20" fill="currentColor"/>
            <circle cx="336" cy="272" r="20" fill="currentColor"/>

            <!-- Up arrow (curved tail to vertical shaft + head) -->
            <path d="M352 96c16-20 34-42 48-58 10-12 26-12 36 0 14 16 32 38 48 58"
                    stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M416 224V96" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    "artemis-logo": `<svg xmlns="http://www.w3.org/2000/svg" width="232" height="204" viewBox="0 0 232 204" fill="none">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M151 66L112 99.8764L229 201L151 66Z" stroke="currentColor" stroke-width="6"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M0 198.5L153.5 65L115.5 0L0 198.5Z" fill="currentColor"/>
        </svg>`
  };
  /**
   * Get an icon by type
   * @param type The icon type (programming, quiz, modeling, text, file-upload, default)
   * @returns The SVG string for the icon
   */
  static getIcon(type) {
    const normalizedType = type?.toLowerCase().replace(/_/g, "-") || "default";
    return this.icons[normalizedType] || this.icons["default"];
  }
  /**
   * Get all available icon types
   * @returns Array of available icon type names
   */
  static getAvailableTypes() {
    return Object.keys(this.icons);
  }
  /**
   * Check if an icon type exists
   * @param type The icon type to check
   * @returns True if the icon type exists
   */
  static hasIcon(type) {
    const normalizedType = type?.toLowerCase().replace(/_/g, "-") || "default";
    return normalizedType in this.icons;
  }
};

// src/utils/aiExtensionsBlocklist.ts
var AI_EXTENSIONS_BLOCKLIST = {
  "GitHub": {
    "color": "#181717",
    "extensions": [
      {
        "id": "GitHub.copilot",
        "name": "GitHub Copilot",
        "description": "AI code completion and inline suggestions."
      },
      {
        "id": "GitHub.copilot-chat",
        "name": "GitHub Copilot Chat",
        "description": "Chat-based AI assistant for explanations, edits, and queries."
      }
    ]
  },
  "Microsoft": {
    "color": "#0078D4",
    "extensions": [
      {
        "id": "VisualStudioExptTeam.vscodeintellicode",
        "name": "IntelliCode",
        "description": "AI-enhanced IntelliSense from Microsoft."
      }
    ]
  },
  "Google": {
    "color": "#4285F4",
    "extensions": [
      {
        "id": "Google.geminicodeassist",
        "name": "Gemini Code Assist",
        "description": "Gemini-powered AI coding assistant."
      },
      {
        "id": "Bini.vscode-gemini-assistant",
        "name": "Gemini Assistant (community)",
        "description": "Community Gemini chat/coding helper."
      }
    ]
  },
  "Amazon": {
    "color": "#FF9900",
    "extensions": [
      {
        "id": "AmazonWebServices.amazon-q-vscode",
        "name": "Amazon Q Developer",
        "description": "AI assistant replacing CodeWhisperer, integrated with AWS."
      },
      {
        "id": "AmazonWebServices.aws-toolkit-vscode",
        "name": "AWS Toolkit",
        "description": "Toolkit that includes CodeWhisperer/Q AI hooks."
      }
    ]
  },
  "OpenAI_ChatGPT": {
    "color": "#74AA9C",
    "extensions": [
      {
        "id": "openai.chatgpt",
        "name": "ChatGPT (official/3rd party)",
        "description": "ChatGPT IDE integration."
      },
      {
        "id": "genieai.chatgpt-vscode",
        "name": "ChatGPT \u2013 Genie AI",
        "description": "Popular ChatGPT extension for VS Code."
      },
      {
        "id": "DanielSanMedium.dscodegpt",
        "name": "CodeGPT",
        "description": "Multi-model AI assistant (supports OpenAI and others)."
      }
    ]
  },
  "Tabnine": {
    "color": "#FF7F50",
    "extensions": [
      {
        "id": "TabNine.tabnine-vscode",
        "name": "Tabnine",
        "description": "Proprietary AI autocomplete for code."
      },
      {
        "id": "TabNine.tabnine-vscode-self-hosted-updater",
        "name": "Tabnine Enterprise",
        "description": "Enterprise/self-hosted version of Tabnine."
      }
    ]
  },
  "Codeium": {
    "color": "#4C51BF",
    "extensions": [
      {
        "id": "Codeium.codeium",
        "name": "Codeium",
        "description": "Free AI coding assistant with autocomplete and chat."
      }
    ]
  },
  "Sourcegraph": {
    "color": "#FF3366",
    "extensions": [
      {
        "id": "sourcegraph.cody-ai",
        "name": "Cody AI",
        "description": "Sourcegraph's AI chat and code agent."
      }
    ]
  },
  "Blackbox": {
    "color": "#000000",
    "extensions": [
      {
        "id": "Blackboxapp.blackbox",
        "name": "Blackbox AI",
        "description": "AI completions and coding agent."
      }
    ]
  },
  "Pieces": {
    "color": "#6E56CF",
    "extensions": [
      {
        "id": "MeshIntelligentTechnologiesInc.pieces-vscode",
        "name": "Pieces Copilot",
        "description": "AI copilot for snippets, chat, and reuse."
      }
    ]
  },
  "Agents": {
    "color": "#FF6F61",
    "extensions": [
      {
        "id": "Continue.continue",
        "name": "Continue",
        "description": "Open-source AI copilot supporting multiple LLMs."
      },
      {
        "id": "saoudrizwan.claude-dev",
        "name": "Cline (Claude Dev)",
        "description": "Autonomous AI coding agent powered by Claude."
      },
      {
        "id": "RooVeterinaryInc.roo-cline",
        "name": "Roo Code",
        "description": "Cline variant by Roo."
      }
    ]
  },
  "Other": {
    "color": "#9CA3AF",
    "extensions": [
      {
        "id": "aminer.codegeex",
        "name": "CodeGeeX",
        "description": "AI coding assistant from IDEA Research."
      },
      {
        "id": "Bito.Bito",
        "name": "Bito",
        "description": "AI tool for reviews, tests, and explanations."
      },
      {
        "id": "mintlify.document",
        "name": "Mintlify Doc Writer",
        "description": "Generates documentation using AI."
      },
      {
        "id": "rjmacarthy.twinny",
        "name": "Twinny",
        "description": "Community AI completion/chat tool."
      }
    ]
  }
};

// src/utils/plantUmlProcessor.ts
var testsColorRegex = /testsColor\([^)]*(?:\([^)]*\)[^)]*)*\)/g;
function processPlantUml(plantUml) {
  return plantUml.replace(testsColorRegex, "green");
}

// src/themes/index.ts
var ThemeManager = class _ThemeManager {
  static themes = {
    vscode: vscodeThemeConfig,
    modern: modernThemeConfig,
    synthwave: synthwaveThemeConfig
  };
  /**
   * Get the current theme from VS Code settings
   */
  getCurrentTheme() {
    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    return config.get("theme", "vscode");
  }
  /**
   * Get the theme configuration for a specific theme
   */
  getThemeConfig(themeType) {
    const theme = themeType || this.getCurrentTheme();
    return _ThemeManager.themes[theme];
  }
  /**
   * Get the theme object for a specific theme
   */
  getTheme(themeType) {
    return this.getThemeConfig(themeType).theme;
  }
  /**
   * Generate CSS custom properties for the current theme
   */
  getThemeCSS(themeType) {
    const theme = this.getTheme(themeType);
    return `
            :root {
                /* Color scheme */
                --theme-background: ${theme.background};
                --theme-foreground: ${theme.foreground};
                --theme-card-background: ${theme.cardBackground};
                --theme-border: ${theme.border};
                
                /* Interactive elements */
                --theme-button-background: ${theme.buttonBackground};
                --theme-button-foreground: ${theme.buttonForeground};
                --theme-button-hover: ${theme.buttonHover};
                --theme-button-active: ${theme.buttonActive};
                
                /* Input elements */
                --theme-input-background: ${theme.inputBackground};
                --theme-input-foreground: ${theme.inputForeground};
                --theme-input-border: ${theme.inputBorder};
                --theme-input-focus: ${theme.inputFocus};
                
                /* Status colors */
                --theme-success: ${theme.successColor};
                --theme-error: ${theme.errorColor};
                --theme-info: ${theme.infoColor};
                
                /* Layout properties */
                --theme-container-padding: ${theme.containerPadding};
                --theme-container-radius: ${theme.containerBorderRadius};
                --theme-element-spacing: ${theme.elementSpacing};
                --theme-form-spacing: ${theme.formSpacing};
                
                /* Visual effects */
                --theme-box-shadow: ${theme.boxShadow};
                --theme-backdrop: ${theme.backdrop};
                --theme-transition: ${theme.transition};
                
                /* Typography */
                --theme-font-family: ${theme.fontFamily};
                --theme-font-size: ${theme.fontSize};
                --theme-font-weight: ${theme.fontWeight};
                --theme-line-height: ${theme.lineHeight};
            }
        `;
  }
  /**
   * Get all available themes
   */
  getAvailableThemes() {
    return Object.values(_ThemeManager.themes);
  }
  /**
   * Check if a theme exists
   */
  themeExists(themeType) {
    return themeType in _ThemeManager.themes;
  }
};

// src/views/templates/aiCheckerView.ts
var AiCheckerView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  generateHtml(aiExtensions) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/ai-checker.css"
    ]);
    const groupedExtensions = this._groupExtensionsByProvider(aiExtensions);
    return this._getAiCheckerHtml(groupedExtensions, themeCSS, currentTheme, styles);
  }
  _getAiCheckerHtml(groups, themeCSS, currentTheme, styles) {
    const providerOptions = groups.map((group) => `<option value="${group.provider.toLowerCase()}">${group.provider}</option>`).join("");
    const groupsMarkup = groups.map((group) => {
      const extensionsMarkup = group.extensions.map((ext) => {
        const statusClass = ext.isInstalled ? "status-installed" : "status-missing";
        const statusValue = ext.isInstalled ? "installed" : "missing";
        const statusLabel = ext.isInstalled ? "\u25CF Installed" : "\u2716 Not installed";
        return `
                        <div class="extension-item" data-provider="${group.provider.toLowerCase()}" data-status="${statusValue}" data-installed="${ext.isInstalled}" data-name="${ext.name.toLowerCase()}" data-ext-id="${ext.id}">
                            <div class="extension-content">
                                <div class="extension-top">
                                    <h3 class="extension-name">${ext.name}</h3>
                                    <span class="status-badge ${statusClass}">
                                        ${statusLabel}
                                    </span>
                                </div>
                                ${ext.isInstalled ? `
                                <div class="extension-details">
                                    <p class="extension-publisher">${ext.publisher}${ext.version !== "\u2014" ? ` \u2022 v${ext.version}` : ""}</p>
                                    <p class="extension-description">${ext.description}</p>
                                    <button class="marketplace-btn" onclick="searchMarketplace('${ext.id}')">
                                        View in Marketplace
                                    </button>
                                </div>
                                ` : `
                                <div class="extension-details">
                                    <p class="extension-description">${ext.description}</p>
                                    <button class="marketplace-btn" onclick="searchMarketplace('${ext.id}')">
                                        View in Marketplace
                                    </button>
                                </div>
                                `}
                            </div>
                        </div>
                    `;
      }).join("");
      return `
                    <section class="provider-group" data-provider="${group.provider.toLowerCase()}">
                        <header class="provider-header">
                            <span class="provider-chip" style="background-color: ${group.color};">${group.provider}</span>
                            <span class="provider-count">${group.extensions.length} extension${group.extensions.length !== 1 ? "s" : ""}</span>
                        </header>
                        ${extensionsMarkup}
                    </section>
                `;
    }).join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Checker</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="ai-checker-container">
        <div class="back-link-container">
            <div class="back-link" onclick="backToDashboard()">\u2190 Back to Dashboard</div>
        </div>
        
        <div class="header">
            <div class="header-content">
                <h1>AI Checker</h1>
                <p>Check and manage your AI-powered learning assistants</p>
            </div>
        </div>
        
        <div class="content">
            <div class="status-view">
                <h3>Installed AI Extensions</h3>
                ${groups.length > 0 ? `
                    <div class="filter-bar">
                        <div class="filter-field">
                            <label for="aiFilterSearch">Search</label>
                            <input id="aiFilterSearch" type="search" placeholder="Search AI tools by name" />
                        </div>
                        <div class="filter-field">
                            <label for="aiFilterProvider">Provider</label>
                            <select id="aiFilterProvider">
                                <option value="all" selected>All providers</option>
                                ${providerOptions}
                            </select>
                        </div>
                        <div class="filter-field">
                            <label for="aiFilterStatus">Status</label>
                            <select id="aiFilterStatus">
                                <option value="all" selected>All statuses</option>
                                <option value="installed">Installed</option>
                                <option value="missing">Not installed</option>
                            </select>
                        </div>
                        <div class="refresh-btn-wrapper">
                            <button class="refresh-btn" onclick="refreshExtensions()">
                                <span>\u21BB</span>
                                Refresh
                            </button>
                        </div>
                    </div>
                    <div class="extensions-list" id="extensionsList">
                        ${groupsMarkup}
                    </div>
                    <p class="no-extensions hidden" id="noExtensionsFiltered">No extensions match your filters.</p>
                ` : `
                    <p class="no-extensions">No AI extensions detected</p>
                `}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function backToDashboard() {
            vscode.postMessage({ command: 'backToDashboard' });
        }

        function refreshExtensions() {
            vscode.postMessage({ command: 'showAiConfig' });
        }

        function searchMarketplace(extensionId) {
            vscode.postMessage({ 
                command: 'searchMarketplace',
                extensionId: extensionId
            });
        }

        const searchInput = document.getElementById('aiFilterSearch');
        const statusSelect = document.getElementById('aiFilterStatus');
        const providerSelect = document.getElementById('aiFilterProvider');
        const extensionItems = Array.from(document.querySelectorAll('.extension-item'));
        const providerGroups = Array.from(document.querySelectorAll('.provider-group'));
        const noExtensionsMsg = document.getElementById('noExtensionsFiltered');

        function applyFilters() {
            const searchTerm = (searchInput?.value || '').trim().toLowerCase();
            const statusFilter = statusSelect?.value || 'all';
            const providerFilter = providerSelect?.value || 'all';

            let visibleCount = 0;

            extensionItems.forEach(item => {
                const matchesSearch = !searchTerm || (item.dataset.name || '').includes(searchTerm);
                const matchesStatus = statusFilter === 'all' || item.dataset.status === statusFilter;
                const matchesProvider = providerFilter === 'all' || item.dataset.provider === providerFilter;

                const shouldShow = matchesSearch && matchesStatus && matchesProvider;
                item.classList.toggle('hidden', !shouldShow);
                if (shouldShow) {
                    visibleCount += 1;
                }
            });

            providerGroups.forEach(group => {
                const hasVisible = group.querySelector('.extension-item:not(.hidden)') !== null;
                group.classList.toggle('hidden', !hasVisible);
            });

            if (noExtensionsMsg) {
                noExtensionsMsg.classList.toggle('hidden', visibleCount !== 0);
            }
        }

        [
            { element: searchInput, event: 'input' },
            { element: statusSelect, event: 'change' },
            { element: providerSelect, event: 'change' }
        ].forEach(({ element, event }) => {
            element?.addEventListener(event, applyFilters);
        });

        applyFilters();
    </script>
</body>
</html>`;
  }
  _groupExtensionsByProvider(aiExtensions) {
    const groupsMap = /* @__PURE__ */ new Map();
    aiExtensions.forEach((ext) => {
      const providerKey = ext.provider || "Other";
      const existing = groupsMap.get(providerKey);
      if (existing) {
        existing.extensions.push(ext);
      } else {
        groupsMap.set(providerKey, {
          provider: providerKey,
          color: ext.providerColor,
          extensions: [ext]
        });
      }
    });
    return Array.from(groupsMap.values()).map((group) => ({
      ...group,
      extensions: [...group.extensions].sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.provider.localeCompare(b.provider));
  }
};

// src/views/templates/courseDetailView.ts
var CourseDetailView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  _getExerciseIcon(type) {
    return IconDefinitions.getIcon(type);
  }
  generateHtml(courseData, hideDeveloperTools = false, webview) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/course-detail.css"
    ]);
    if (!courseData) {
      return this._getEmptyStateHtml(themeCSS, currentTheme, styles);
    }
    return this._getCourseDetailHtml(courseData, themeCSS, currentTheme, hideDeveloperTools, styles, webview);
  }
  _getEmptyStateHtml(themeCSS, currentTheme, styles) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Course Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="empty-state">
        <h2>Course Details</h2>
        <p>Select a course to view its details</p>
    <div class="back-link" onclick="backToDashboard()">\u2190 Back to Dashboard</div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        window.backToDashboard = function() {
            vscode.postMessage({ command: 'backToDashboard' });
        };
    </script>
</body>
</html>`;
  }
  _getCourseDetailHtml(courseData, themeCSS, currentTheme, hideDeveloperTools, styles, webview) {
    const course = courseData?.course;
    const courseTitle = course?.title || "Unknown Course";
    const courseDescription = course?.description || "No description available";
    const semester = course?.semester || "No semester";
    const exerciseCount = course?.exercises?.length || 0;
    const instructorGroup = course?.instructorGroupName || "Unknown";
    const studentCount = course?.numberOfStudents || 0;
    const courseColor = course?.color || "#6c757d";
    const starAssistIcon = IconDefinitions.getIcon("star_4_edges");
    let exercisesHtml = "";
    let allExercisesJson = "[]";
    if (course?.exercises && course.exercises.length > 0) {
      allExercisesJson = JSON.stringify(course.exercises);
      exercisesHtml = course.exercises.map((exercise) => {
        const dueDate = exercise.dueDate ? new Date(exercise.dueDate).toLocaleDateString() : "No due date";
        const releaseDate = exercise.releaseDate ? new Date(exercise.releaseDate).toLocaleDateString() : "No release date";
        const exerciseIcon = this._getExerciseIcon(exercise.type);
        const dueDateTimestamp = exercise.dueDate ? new Date(exercise.dueDate).getTime() : 0;
        const points = exercise.maxPoints || 0;
        return `
                    <div class="exercise-item" 
                         data-title="${exercise.title?.toLowerCase() || ""}" 
                         data-type="${exercise.type?.toLowerCase() || ""}" 
                         data-exercise-id="${exercise.id}"
                         data-due-date="${dueDateTimestamp}"
                         data-points="${points}"
                         data-id="${exercise.id}"
                         onclick="openExerciseDetails(${exercise.id})">
                        <div class="exercise-header">
                            <span class="exercise-title">${exercise.title}</span>
                            <span class="exercise-type-icon">${exerciseIcon}</span>
                        </div>
                        <div class="exercise-info">
                            <span>Due: ${dueDate}</span>
                            <span>Released: ${releaseDate}</span>
                            <span>${points} ${points === 1 ? "point" : "points"}</span>
                        </div>
                    </div>
                `;
      }).join("");
    } else {
      const isArchived = course?.isArchived;
      const noExercisesMessage = isArchived ? "No exercises available for this archived course" : "No exercises available";
      exercisesHtml = `<div class="no-exercises">${noExercisesMessage}</div>`;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Course Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>
</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToDashboard()">\u2190 Back to Dashboard</div>
        <button class="fullscreen-btn" id="fullscreenBtn" onclick="toggleFullscreen()" title="Open course in new editor tab">
            \u26F6
        </button>
    </div>
    
    <div class="course-header">
        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
        <div class="course-header-content">
            <div class="course-title">${courseTitle}</div>
            <div class="course-semester">${semester}</div>
            <div class="course-description">${courseDescription}</div>
            <div class="course-stats">
                <div class="stat-item">${exerciseCount} exercises</div>
                <div class="stat-item">${studentCount} students</div>
                <div class="stat-item">${instructorGroup}</div>
                <div class="stat-item">ID: ${course?.id || "Unknown"}</div>
            </div>
        </div>
    </div>
    
    <div class="section iris-assist-cell">
        <div class="iris-assist-content">
            <div class="iris-assist-title">Ask Iris about this course</div>
            <p class="iris-assist-description">Open the Iris chat to discuss this course or its exercises.</p>
        </div>
        <button class="iris-assist-button" id="askIrisAboutCourseBtn">
            <span class="iris-assist-button-icon">${starAssistIcon}</span>
            Ask Iris
        </button>
    </div>
    
    <div class="section">
        <div class="section-title">Exercises</div>
        <div class="exercise-search">
            <input type="text" class="search-input" placeholder="Search exercises..." oninput="filterExercises(this.value)">
            <select class="sort-select" onchange="sortExercises(this.value)">
                <option value="id-desc" selected>Latest Added</option>
                <option value="id-asc">Oldest Added</option>
                <option value="title-asc">Title (A-Z)</option>
                <option value="title-desc">Title (Z-A)</option>
                <option value="due-asc">Due Date (Earliest)</option>
                <option value="due-desc">Due Date (Latest)</option>
                <option value="points-asc">Points (Low-High)</option>
                <option value="points-desc">Points (High-Low)</option>
            </select>
        </div>
        <div class="exercises-container">
            <div class="exercises-list">
                ${exercisesHtml}
                <div class="no-exercises-found">No exercises found matching your search.</div>
            </div>
        </div>
    </div>
    
    ${!hideDeveloperTools ? `
    <div class="action-buttons">
        <button class="btn btn-primary" onclick="openInEditor()">Open Raw JSON</button>
        <button class="btn" onclick="copyToClipboard()">Copy Course Data</button>
    </div>
    ` : ""}

    <script>
        const vscode = acquireVsCodeApi();
        const courseData = ${JSON.stringify(courseData)};
        const askIrisButton = document.getElementById('askIrisAboutCourseBtn');
        
        window.backToDashboard = function() {
            vscode.postMessage({ command: 'backToDashboard' });
        };
        
        if (askIrisButton) {
            askIrisButton.addEventListener('click', () => {
                const course = (courseData && (courseData.course || courseData)) || {};
                if (!course.id) {
                    vscode.postMessage({ command: 'alert', text: 'Course information is unavailable for Iris.' });
                    return;
                }
                
                vscode.postMessage({
                    command: 'askIrisAboutCourse',
                    courseId: course.id,
                    courseTitle: course.title || 'Course',
                    courseShortName: course.shortName || ''
                });
            });
        }
        
        window.filterExercises = function(searchTerm) {
            const exercises = document.querySelectorAll('.exercise-item');
            const noExercisesFound = document.querySelector('.no-exercises-found');
            const term = searchTerm.toLowerCase();
            let visibleCount = 0;
            
            exercises.forEach(exercise => {
                const title = exercise.getAttribute('data-title') || '';
                const type = exercise.getAttribute('data-type') || '';
                
                if (title.includes(term) || type.includes(term)) {
                    exercise.style.display = '';
                    visibleCount++;
                } else {
                    exercise.style.display = 'none';
                }
            });
            
            // Show/hide "no exercises found" message
            if (visibleCount === 0 && exercises.length > 0 && term.trim() !== '') {
                noExercisesFound.style.display = 'block';
            } else {
                noExercisesFound.style.display = 'none';
            }
        };
        
        window.sortExercises = function(sortBy) {
            const exercisesList = document.querySelector('.exercises-list');
            const exercises = Array.from(document.querySelectorAll('.exercise-item'));
            const noExercisesFound = document.querySelector('.no-exercises-found');
            
            // Remove all exercises from the list
            exercises.forEach(exercise => exercise.remove());
            
            // Sort exercises based on the selected option
            let sortedExercises = [...exercises];
            
            switch(sortBy) {
                case 'id-asc':
                    sortedExercises.sort((a, b) => {
                        const idA = parseInt(a.getAttribute('data-id') || '0');
                        const idB = parseInt(b.getAttribute('data-id') || '0');
                        return idA - idB;
                    });
                    break;
                case 'id-desc':
                    sortedExercises.sort((a, b) => {
                        const idA = parseInt(a.getAttribute('data-id') || '0');
                        const idB = parseInt(b.getAttribute('data-id') || '0');
                        return idB - idA;
                    });
                    break;
                case 'title-asc':
                    sortedExercises.sort((a, b) => {
                        const titleA = a.getAttribute('data-title') || '';
                        const titleB = b.getAttribute('data-title') || '';
                        return titleA.localeCompare(titleB);
                    });
                    break;
                case 'title-desc':
                    sortedExercises.sort((a, b) => {
                        const titleA = a.getAttribute('data-title') || '';
                        const titleB = b.getAttribute('data-title') || '';
                        return titleB.localeCompare(titleA);
                    });
                    break;
                case 'due-asc':
                    sortedExercises.sort((a, b) => {
                        const dateA = parseInt(a.getAttribute('data-due-date') || '0');
                        const dateB = parseInt(b.getAttribute('data-due-date') || '0');
                        // Put exercises with no due date at the end
                        if (dateA === 0) return 1;
                        if (dateB === 0) return -1;
                        return dateA - dateB;
                    });
                    break;
                case 'due-desc':
                    sortedExercises.sort((a, b) => {
                        const dateA = parseInt(a.getAttribute('data-due-date') || '0');
                        const dateB = parseInt(b.getAttribute('data-due-date') || '0');
                        // Put exercises with no due date at the end
                        if (dateA === 0) return 1;
                        if (dateB === 0) return -1;
                        return dateB - dateA;
                    });
                    break;
                case 'points-asc':
                    sortedExercises.sort((a, b) => {
                        const pointsA = parseInt(a.getAttribute('data-points') || '0');
                        const pointsB = parseInt(b.getAttribute('data-points') || '0');
                        return pointsA - pointsB;
                    });
                    break;
                case 'points-desc':
                    sortedExercises.sort((a, b) => {
                        const pointsA = parseInt(a.getAttribute('data-points') || '0');
                        const pointsB = parseInt(b.getAttribute('data-points') || '0');
                        return pointsB - pointsA;
                    });
                    break;
            }
            
            // Re-add exercises in the sorted order
            sortedExercises.forEach(exercise => {
                exercisesList.insertBefore(exercise, noExercisesFound);
            });
        };
        
        // Sort by latest added on initial load
        if (document.querySelectorAll('.exercise-item').length > 0) {
            sortExercises('id-desc');
        }
        
        window.openExerciseDetails = function(exerciseId) {
            vscode.postMessage({ 
                command: 'openExerciseDetails',
                exerciseId: exerciseId
            });
        };
        
        window.openInEditor = function() {
            vscode.postMessage({ 
                command: 'openInEditor',
                data: courseData
            });
        };
        
        window.copyToClipboard = function() {
            vscode.postMessage({ 
                command: 'copyToClipboard',
                text: JSON.stringify(courseData, null, 2)
            });
        };

        window.toggleFullscreen = function() {
            vscode.postMessage({ 
                command: 'toggleCourseFullscreen'
            });
        };
    </script>
</body>
</html>`;
  }
};

// src/views/templates/courseListView.ts
var CourseListView = class {
  _themeManager;
  _styleManager;
  constructor(styleManager) {
    this._themeManager = new ThemeManager();
    this._styleManager = styleManager;
  }
  generateHtml(coursesData, archivedCoursesData) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/course-list.css"
    ]);
    return this._getCourseListHtml(coursesData, archivedCoursesData, currentTheme, styles, themeCSS);
  }
  _getCourseListHtml(coursesData, archivedCoursesData, currentTheme, styles, themeCSS) {
    let coursesHtml = "";
    if (coursesData?.courses) {
      coursesHtml = coursesData.courses.map((courseData) => {
        const course = courseData.course;
        const exerciseCount = course.exercises ? course.exercises.length : 0;
        const semester = course.semester || "No semester";
        const description = course.description || "No description available";
        const courseColor = course.color || "#6c757d";
        return `
                    <div class="course-item" onclick="viewCourseDetails(${JSON.stringify(courseData).replace(/"/g, "&quot;")})">
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                <div class="course-semester">${semester}</div>
                            </div>
                            <div class="course-description">${description}</div>
                            <div class="course-stats">
                                <span>${exerciseCount} exercises</span>
                                <span>ID: ${course.id}</span>
                            </div>
                        </div>
                    </div>
                `;
      }).join("");
    } else {
      coursesHtml = '<div class="no-courses">No courses available</div>';
    }
    let loadArchivedButton = "";
    if (!archivedCoursesData) {
      loadArchivedButton = `
                <div class="load-archived-section">
                    <button class="load-archived-btn" onclick="loadArchivedCourses()">
                        Load Archived Courses
                    </button>
                </div>
            `;
    }
    let archivedCoursesHtml = "";
    if (archivedCoursesData && archivedCoursesData.length > 0) {
      const archivedItemsHtml = archivedCoursesData.map((course) => {
        const courseColor = course.color || "#6c757d";
        const semester = course.semester || "No semester";
        return `
                    <div class="course-item archived-course" onclick="viewArchivedCourse(${course.id})">
                        <div class="course-color-indicator" style="background-color: ${courseColor};"></div>
                        <div class="course-content">
                            <div class="course-header">
                                <div class="course-title">${course.title}</div>
                                <div class="course-semester archived">${semester}</div>
                            </div>
                            <div class="course-stats">
                                <span>ID: ${course.id}</span>
                                <span class="archived-label">Archived</span>
                            </div>
                        </div>
                    </div>
                `;
      }).join("");
      archivedCoursesHtml = `
                <div class="archived-section">
                    <div class="section-separator">
                        <div class="separator-line"></div>
                        <div class="separator-text">Archived Courses</div>
                        <div class="separator-line"></div>
                    </div>
                    <div class="archived-courses-container">
                        ${archivedItemsHtml}
                    </div>
                </div>
            `;
    } else if (archivedCoursesData && archivedCoursesData.length === 0) {
      archivedCoursesHtml = `
                <div class="archived-section">
                    <div class="section-separator">
                        <div class="separator-line"></div>
                        <div class="separator-text">Archived Courses</div>
                        <div class="separator-line"></div>
                    </div>
                    <div class="no-courses">No archived courses available</div>
                </div>
            `;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Courses</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

    
</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToDashboard()">\u2190 Back to Dashboard</div>
    </div>
    
    <div class="header">
        <h1>All Courses</h1>
        <div class="search-container">
            <input type="text" class="search-input" id="courseSearch" placeholder="Search courses by title, semester, or description..." oninput="handleSearch(this.value)">
            <button class="reload-courses-btn" onclick="reloadCourses()" title="Reload courses">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"/>
                </svg>
                Reload Courses
            </button>
        </div>
            <div class="controls-container" id="controlsContainer">
                <div class="controls-header" onclick="toggleControls()">
                    <h3 class="controls-header-title">Filter & Sort Options</h3>
                    <div class="controls-toggle">\u25BC</div>
                </div>
                <div class="controls-content">
                    <div class="controls-grid">
                        <div class="control-section filter-section">
                            <h3 class="control-section-title">Filter</h3>
                            <div class="control-row">
                                <div class="control-group">
                                    <label class="control-label" for="typeFilter">Type</label>
                                    <select class="control-select" id="typeFilter" onchange="handleFiltersChange()">
                                        <option value="all">All Courses</option>
                                        <option value="active">Active Only</option>
                                        <option value="archived">Archived Only</option>
                                    </select>
                                </div>
                                <div class="control-group">
                                    <label class="control-label" for="semesterFilter">Semester</label>
                                    <select class="control-select" id="semesterFilter" onchange="handleFiltersChange()">
                                        <option value="all">All Semesters</option>
                                        <!-- Options will be populated dynamically -->
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="control-section sort-section">
                            <h3 class="control-section-title">Sort</h3>
                            <div class="control-group">
                                <label class="control-label" for="sortBy">Order by</label>
                                <select class="control-select" id="sortBy" onchange="handleFiltersChange()">
                                    <option value="title-asc">Title (A-Z)</option>
                                    <option value="title-desc">Title (Z-A)</option>
                                    <option value="semester-desc">Newest First</option>
                                    <option value="semester-asc">Oldest First</option>
                                    <option value="exercises-desc">Most Exercises</option>
                                    <option value="exercises-asc">Least Exercises</option>
                                </select>
                            </div>
                        </div>
                        <div class="clear-section">
                            <button class="clear-filters-btn" id="clearFiltersBtn" onclick="clearAllFilters()" disabled>
                                Clear Filters
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <div id="searchResults" class="search-results-info" style="display: none;"></div>
    
    <div class="courses-container">
        ${coursesHtml}
        ${loadArchivedButton}
        ${archivedCoursesHtml}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        window.backToDashboard = function() {
            vscode.postMessage({ command: 'backToDashboard' });
        };
        
        window.reloadCourses = function() {
            vscode.postMessage({ command: 'reloadCourses' });
        };
        
        window.viewCourseDetails = function(courseData) {
            vscode.postMessage({ 
                command: 'viewCourseDetails',
                courseData: courseData
            });
        };

        window.loadArchivedCourses = function() {
            vscode.postMessage({ command: 'loadArchivedCourses' });
        };

        window.viewArchivedCourse = function(courseId) {
            vscode.postMessage({ 
                command: 'viewArchivedCourse',
                courseId: courseId
            });
        };

        // Search functionality
        window.handleSearch = function(searchTerm) {
            handleFiltersChange();
        };

        // Main filter and sort function
        window.handleFiltersChange = function() {
            const searchTerm = document.getElementById('courseSearch')?.value?.toLowerCase().trim() || '';
            const typeFilter = document.getElementById('typeFilter')?.value || 'all';
            const semesterFilter = document.getElementById('semesterFilter')?.value || 'all';
            const sortBy = document.getElementById('sortBy')?.value || 'title-asc';
            
            const courseItems = Array.from(document.querySelectorAll('.course-item'));
            const archivedSection = document.querySelector('.archived-section');
            const archivedSeparator = document.querySelector('.section-separator');
            const searchResults = document.getElementById('searchResults');
            const clearFiltersBtn = document.getElementById('clearFiltersBtn');
            
            // Check if any filters are active
            const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all' || sortBy !== 'title-asc';
            if (clearFiltersBtn) {
                clearFiltersBtn.disabled = !hasActiveFilters;
            }

            let visibleCourses = 0;
            let visibleActiveCourses = 0;
            let visibleArchivedCourses = 0;
            let totalActiveCourses = 0;
            let totalArchivedCourses = 0;

            // Count total courses and filter
            const filteredCourses = courseItems.filter(item => {
                const title = item.querySelector('.course-title')?.textContent?.toLowerCase() || '';
                const semester = item.querySelector('.course-semester')?.textContent?.toLowerCase() || '';
                const description = item.querySelector('.course-description')?.textContent?.toLowerCase() || '';
                const isArchived = item.classList.contains('archived-course');
                
                if (isArchived) {
                    totalArchivedCourses++;
                } else {
                    totalActiveCourses++;
                }

                // Apply filters
                let isVisible = true;

                // Search filter
                if (searchTerm && !title.includes(searchTerm) && !semester.includes(searchTerm) && !description.includes(searchTerm)) {
                    isVisible = false;
                }

                // Type filter
                if (typeFilter === 'active' && isArchived) {
                    isVisible = false;
                } else if (typeFilter === 'archived' && !isArchived) {
                    isVisible = false;
                }

                // Semester filter
                if (semesterFilter !== 'all' && semester !== semesterFilter.toLowerCase()) {
                    isVisible = false;
                }

                return isVisible;
            });

            // Sort courses
            filteredCourses.sort((a, b) => {
                const aTitleEl = a.querySelector('.course-title');
                const bTitleEl = b.querySelector('.course-title');
                const aSemesterEl = a.querySelector('.course-semester');
                const bSemesterEl = b.querySelector('.course-semester');
                
                const aTitle = aTitleEl?.textContent || '';
                const bTitle = bTitleEl?.textContent || '';
                const aSemester = aSemesterEl?.textContent || '';
                const bSemester = bSemesterEl?.textContent || '';
                
                // Get exercise count for active courses
                const getExerciseCount = (item) => {
                    const statsText = item.querySelector('.course-stats')?.textContent || '';
                    const match = statsText.match(/(\\d+)\\s+exercises?/);
                    return match ? parseInt(match[1]) : 0;
                };

                switch (sortBy) {
                    case 'title-desc':
                        return bTitle.localeCompare(aTitle);
                    case 'title-asc':
                        return aTitle.localeCompare(bTitle);
                    case 'semester-desc':
                        return compareSemesters(bSemester, aSemester); // newest first
                    case 'semester-asc':
                        return compareSemesters(aSemester, bSemester); // oldest first
                    case 'exercises-desc':
                        return getExerciseCount(b) - getExerciseCount(a);
                    case 'exercises-asc':
                        return getExerciseCount(a) - getExerciseCount(b);
                    default:
                        return aTitle.localeCompare(bTitle);
                }
            });

            // Apply visibility and reorder
            courseItems.forEach(item => item.classList.add('hidden'));
            
            const coursesContainer = document.querySelector('.courses-container');
            const loadArchivedSection = document.querySelector('.load-archived-section');
            
            // Get insertion point (before archived section or load button)
            const insertionPoint = archivedSection || loadArchivedSection || null;
            
            filteredCourses.forEach((item, index) => {
                item.classList.remove('hidden');
                visibleCourses++;
                
                if (item.classList.contains('archived-course')) {
                    visibleArchivedCourses++;
                } else {
                    visibleActiveCourses++;
                    // Reorder active courses
                    if (coursesContainer && insertionPoint) {
                        coursesContainer.insertBefore(item, insertionPoint);
                    }
                }
            });

            // Handle archived section visibility
            if (archivedSection) {
                const showArchivedSection = (typeFilter !== 'active') && 
                    (visibleArchivedCourses > 0 || (typeFilter === 'all' && totalArchivedCourses > 0));
                
                archivedSection.style.display = showArchivedSection ? 'block' : 'none';
                if (archivedSeparator) archivedSeparator.style.display = showArchivedSection ? 'flex' : 'none';
            }

            // Update search results info
            updateSearchResultsInfo(searchResults, searchTerm, typeFilter, semesterFilter, 
                visibleCourses, visibleActiveCourses, visibleArchivedCourses, 
                totalActiveCourses, totalArchivedCourses);

            // Handle no courses message
            handleNoCoursesMessage(searchTerm, typeFilter, visibleActiveCourses, totalActiveCourses);
        };

        function updateSearchResultsInfo(searchResults, searchTerm, typeFilter, semesterFilter, 
            visibleCourses, visibleActiveCourses, visibleArchivedCourses, totalActiveCourses, totalArchivedCourses) {
            
            if (!searchResults) return;

            const hasFilters = searchTerm !== '' || typeFilter !== 'all' || semesterFilter !== 'all';
            
            if (!hasFilters) {
                searchResults.style.display = 'none';
                return;
            }

            searchResults.style.display = 'block';
            let resultsText = '';
            
            if (visibleCourses === 0) {
                resultsText = 'No courses found matching your criteria.';
            } else {
                const parts = [];
                if (typeFilter !== 'archived' && visibleActiveCourses > 0) {
                    parts.push(\`\${visibleActiveCourses} active course\${visibleActiveCourses === 1 ? '' : 's'}\`);
                }
                if (typeFilter !== 'active' && visibleArchivedCourses > 0) {
                    parts.push(\`\${visibleArchivedCourses} archived course\${visibleArchivedCourses === 1 ? '' : 's'}\`);
                }
                
                let filterDesc = '';
                const filters = [];
                if (searchTerm) filters.push(\`"\${searchTerm}"\`);
                if (typeFilter !== 'all') filters.push(typeFilter + ' courses');
                if (semesterFilter !== 'all') filters.push(semesterFilter);
                if (filters.length > 0) filterDesc = \` matching \${filters.join(', ')}\`;
                
                resultsText = \`Found \${parts.join(' and ')}\${filterDesc}\`;
            }
            
            searchResults.textContent = resultsText;
        }

        function handleNoCoursesMessage(searchTerm, typeFilter, visibleActiveCourses, totalActiveCourses) {
            const noCoursesMsg = document.querySelector('.courses-container .no-courses');
            if (!noCoursesMsg) return;

            const hasActiveFilters = searchTerm !== '' || typeFilter !== 'all';
            
            if (hasActiveFilters && visibleActiveCourses === 0 && totalActiveCourses > 0) {
                noCoursesMsg.style.display = 'block';
                noCoursesMsg.textContent = 'No active courses match your criteria.';
            } else if (!hasActiveFilters || totalActiveCourses === 0) {
                noCoursesMsg.style.display = totalActiveCourses === 0 ? 'block' : 'none';
                noCoursesMsg.textContent = 'No courses available';
            } else {
                noCoursesMsg.style.display = 'none';
            }
        }

        // Clear all filters function
        window.clearAllFilters = function() {
            document.getElementById('courseSearch').value = '';
            document.getElementById('typeFilter').value = 'all';
            document.getElementById('semesterFilter').value = 'all';
            document.getElementById('sortBy').value = 'title-asc';
            handleFiltersChange();
        };

        // Toggle controls visibility
        window.toggleControls = function() {
            const container = document.getElementById('controlsContainer');
            if (container) {
                container.classList.toggle('expanded');
            }
        };

        // Populate semester filter options
        function populateSemesterFilter() {
            const semesterFilter = document.getElementById('semesterFilter');
            if (!semesterFilter) return;

            const semesters = new Set();
            const semesterElements = document.querySelectorAll('.course-semester');
            
            semesterElements.forEach(el => {
                const semester = el.textContent?.trim();
                if (semester && semester !== 'No semester') {
                    semesters.add(semester);
                }
            });

            // Sort semesters properly (newest first)
            const sortedSemesters = Array.from(semesters).sort((a, b) => {
                return compareSemesters(b, a); // b, a for descending order (newest first)
            });
            
            // Clear existing options except "All Semesters"
            while (semesterFilter.children.length > 1) {
                semesterFilter.removeChild(semesterFilter.lastChild);
            }
            
            // Add semester options
            sortedSemesters.forEach(semester => {
                const option = document.createElement('option');
                option.value = semester.toLowerCase();
                option.textContent = semester;
                semesterFilter.appendChild(option);
            });
        }

        // Function to properly compare semesters
        function compareSemesters(a, b) {
            // Parse semester format: WS24/25, SS25, etc.
            function parseSemester(semester) {
                const cleanSemester = semester.toUpperCase().trim();
                
                // Match patterns like WS24/25, WS2024/2025, SS25, SS2025
                const wsMatch = cleanSemester.match(/^WS(\\d{2,4})(?:\\/(\\d{2,4}))?$/);
                const ssMatch = cleanSemester.match(/^SS(\\d{2,4})$/);
                
                if (wsMatch) {
                    // Winter semester: WS24/25 or WS24
                    let year = parseInt(wsMatch[1]);
                    // Convert 2-digit years to 4-digit (24 -> 2024)
                    if (year < 100) year += 2000;
                    // Winter semester starts in fall, so it's the later year
                    return { type: 'WS', year: year, sortKey: year * 10 + 1 }; // +1 to make WS slightly later than SS of same year
                } else if (ssMatch) {
                    // Summer semester: SS25
                    let year = parseInt(ssMatch[1]);
                    // Convert 2-digit years to 4-digit (25 -> 2025)
                    if (year < 100) year += 2000;
                    return { type: 'SS', year: year, sortKey: year * 10 };
                }
                
                // Fallback for unknown formats
                return { type: 'UNKNOWN', year: 0, sortKey: 0 };
            }
            
            const semesterA = parseSemester(a);
            const semesterB = parseSemester(b);
            
            // Compare by sortKey (higher = newer)
            return semesterA.sortKey - semesterB.sortKey;
        }

        // Focus search input on page load
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('courseSearch');
            if (searchInput) {
                // Don't auto-focus as it might interfere with webview
                // searchInput.focus();
            }
            
            // Populate semester filter options
            populateSemesterFilter();
            
            // Initialize filters
            handleFiltersChange();
        });
    </script>
</body>
</html>`;
  }
};

// src/views/styles/styleManager.ts
var fs = __toESM(require("fs"));
var vscode2 = __toESM(require("vscode"));
var StyleManager = class {
  constructor(_extensionUri) {
    this._extensionUri = _extensionUri;
  }
  getStyles(theme, additionalPaths = []) {
    const defaultPaths = [
      "base.css",
      `themes/theme-${theme}.css`
    ];
    const uniquePaths = Array.from(/* @__PURE__ */ new Set([...defaultPaths, ...additionalPaths]));
    return uniquePaths.map((path2) => this._readStyles(path2)).filter(Boolean).join("\n");
  }
  _readStyles(relativePath) {
    const fileUri = vscode2.Uri.joinPath(this._extensionUri, "media", "styles", ...relativePath.split("/"));
    try {
      return fs.readFileSync(fileUri.fsPath, "utf-8");
    } catch (error) {
      console.error(`[StyleManager] Failed to load stylesheet: ${relativePath}`, error);
      return "";
    }
  }
};

// src/views/templates/dashboardView.ts
var vscode3 = __toESM(require("vscode"));
var DashboardView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  generateHtml(userInfo, coursesData, webview) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/dashboard.css"
    ]);
    const config = vscode3.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    const showIrisExplanation = config.get(VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY, true);
    return this._getDashboardHtml(userInfo, coursesData, currentTheme, webview, showIrisExplanation, styles, themeCSS);
  }
  _getDashboardHtml(userInfo, coursesData, currentTheme, webview, showIrisExplanation, styles, themeCSS) {
    const username = userInfo?.username || "Unknown";
    const serverUrl = userInfo?.serverUrl || "Unknown";
    const courseIcon = IconDefinitions.getIcon("course");
    const webIcon = IconDefinitions.getIcon("artemis-logo");
    const gearIcon = IconDefinitions.getIcon("gear");
    const star4Icon = IconDefinitions.getIcon("star-4-edges");
    const stethoscopeIcon = IconDefinitions.getIcon("stethoscope");
    const logoutIcon = IconDefinitions.getIcon("logout");
    const puzzleIcon = IconDefinitions.getIcon("puzzle");
    const exerciseIcon = IconDefinitions.getIcon("exercise");
    let irisLogoSrc = "";
    if (webview) {
      const irisLogoUri = vscode3.Uri.file(
        this._extensionContext.asAbsolutePath("media/iris-logo-big-left.png")
      );
      irisLogoSrc = webview.asWebviewUri(irisLogoUri).toString();
    } else {
      irisLogoSrc = "";
    }
    let recentCoursesHtml = "";
    let coursesDataJson = "null";
    let sortedCoursesJson = "null";
    if (coursesData?.courses) {
      coursesDataJson = JSON.stringify(coursesData.courses);
      const sortedCourses = [...coursesData.courses].sort((a, b) => {
        const getLatestReleaseDate = (courseData) => {
          const course = courseData.course;
          if (!course.exercises || course.exercises.length === 0) {
            return 0;
          }
          const latestDate = course.exercises.reduce((latest, exercise) => {
            const releaseDate = exercise.releaseDate || exercise.startDate;
            if (releaseDate) {
              const timestamp = new Date(releaseDate).getTime();
              return timestamp > latest ? timestamp : latest;
            }
            return latest;
          }, 0);
          return latestDate;
        };
        const aLatest = getLatestReleaseDate(a);
        const bLatest = getLatestReleaseDate(b);
        return bLatest - aLatest;
      });
      sortedCoursesJson = JSON.stringify(sortedCourses);
      const recentCourses = sortedCourses.slice(0, 3);
      recentCoursesHtml = recentCourses.map((courseData, index) => {
        const course = courseData.course;
        const exerciseCount = course.exercises ? course.exercises.length : 0;
        return `
                    <div class="recent-course-item" onclick="viewRecentCourseDetails(${index})">
                        <div class="course-title">${course.title}</div>
                        <div class="course-info">${exerciseCount} exercises</div>
                    </div>
                `;
      }).join("");
    } else {
      recentCoursesHtml = '<div class="no-courses">Loading courses...</div>';
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artemis Dashboard</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

    
</head>
<body class="theme-${currentTheme}">
    <div class="dashboard">
        <div class="dashboard-header">
            <h1 class="dashboard-title">
                Welcome to Artemis
            </h1>
            <p class="dashboard-subtitle">Your programming learning companion</p>
        </div>
        
        ${showIrisExplanation ? `
        <div class="iris-info-cell">
            <div class="iris-header">
                <div class="iris-icon">
                    ${irisLogoSrc ? `<img src="${irisLogoSrc}" alt="Iris Logo" />` : "I"}
                </div>
                <div class="iris-info">
                    <h3 class="iris-title">Chat with Iris</h3>
                    <p class="iris-subtitle">Your AI programming assistant</p>
                </div>
            </div>
            <div class="iris-usage-explanation">
                <h4>How to use Iris in this extension:</h4>
                <ol>
                    <li><strong>Access Iris anywhere:</strong> Find the Iris chat icon in the Activity Bar (left sidebar) for quick access, or start a chat directly from course and exercise views</li>
                    <li><strong>Smart context detection:</strong> Iris automatically detects your current exercise and course context to provide relevant, personalized assistance</li>
                    <li><strong>Configure your experience:</strong> Enable/disable Iris, select your preferred AI model, and manage privacy settings through the extension settings</li>
                    <li><strong>Control context sharing:</strong> Choose whether to share your code and exercise context with Iris for more accurate help</li>
                    <li><strong>Get instant help:</strong> Ask programming questions, receive debugging support, and get guidance tailored to your specific exercises</li>
                </ol>
                <p class="iris-note">
                    <strong>Tip:</strong> You can hide this explanation by disabling "Show Iris Explanation" in the Artemis extension settings.
                </p>
            </div>
        </div>
        ` : ""}
        
        <div class="recent-courses">
            <h3>
                Recent Courses
                <div class="recent-courses-controls">
                    <select class="sort-dropdown" id="recentCoursesSort" onchange="handleRecentCoursesSort(this.value)">
                        <option value="latest-exercise">Latest Exercise</option>
                        <option value="newest-course">Newest Course</option>
                        <option value="most-exercises">Most Exercises</option>
                        <option value="title-asc">Title (A-Z)</option>
                        <option value="title-desc">Title (Z-A)</option>
                    </select>
                    <span class="show-all-link" onclick="showAllCourses()">Show All</span>
                </div>
            </h3>
            <div class="recent-courses-list" id="recentCoursesList">
                ${recentCoursesHtml}
            </div>
        </div>
        
        <div class="quick-actions">
            <h3>Quick Actions</h3>
            <div id="workspaceExerciseBtn" class="workspace-exercise-container" style="display: none;">
                <button class="workspace-exercise-btn" onclick="goToWorkspaceExercise()">
                    <div class="workspace-exercise-content">
                        <div class="workspace-exercise-icon">${exerciseIcon}</div>
                        <div class="workspace-exercise-text">
                            <div class="workspace-exercise-title">Current Workspace Exercise</div>
                            <div class="workspace-exercise-name" id="workspaceExerciseName">Loading...</div>
                        </div>
                        <div class="workspace-exercise-arrow">\u2192</div>
                    </div>
                </button>
            </div>
            <div class="action-buttons">
                <button class="action-btn" id="browseCoursesBtn">
                    <span class="action-btn-icon">${courseIcon}</span>
                    Browse Courses
                </button>
                <button class="action-btn" id="checkAiConfigBtn">
                    <span class="action-btn-icon">${star4Icon}</span>
                    AI Checker
                </button>
                <button class="action-btn" id="checkServiceStatusBtn">
                    <span class="action-btn-icon">${stethoscopeIcon}</span>
                    Service Status
                </button>
                <button class="action-btn" id="recommendedExtensionsBtn">
                    <span class="action-btn-icon">${puzzleIcon}</span>
                    Recommended Extensions
                </button>
                <button class="action-btn" id="openWebsiteBtn">
                    <span class="action-btn-icon">${webIcon}</span>
                    Open Artemis in browser
                </button>
                <button class="action-btn" id="openSettingsBtn">
                    <span class="action-btn-icon">${gearIcon}</span>
                    Open Settings
                </button>
                <button class="action-btn logout-btn" id="logoutBtn">
                    <span class="action-btn-icon">${logoutIcon}</span>
                    Logout from Artemis
                </button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Dashboard action buttons
        const browseCoursesBtn = document.getElementById('browseCoursesBtn');
        const checkAiConfigBtn = document.getElementById('checkAiConfigBtn');
        const checkServiceStatusBtn = document.getElementById('checkServiceStatusBtn');
        const recommendedExtensionsBtn = document.getElementById('recommendedExtensionsBtn');
        const openWebsiteBtn = document.getElementById('openWebsiteBtn');
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        
        // Workspace exercise detection
        let workspaceExerciseId = null;
        let workspaceExerciseTitle = null;
        
        window.goToWorkspaceExercise = function() {
            if (workspaceExerciseId) {
                vscode.postMessage({ 
                    command: 'openExercise',
                    exerciseId: workspaceExerciseId,
                    courseId: null // Will be looked up from the exercise
                });
            }
        };
        
        // Request workspace exercise detection
        vscode.postMessage({ command: 'detectWorkspaceExercise' });
        
        // Event listeners
        if (browseCoursesBtn) {
            browseCoursesBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showAllCourses' });
            });
        }
        
        if (checkAiConfigBtn) {
            checkAiConfigBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showAiConfig' });
            });
        }
        
        if (checkServiceStatusBtn) {
            checkServiceStatusBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showServiceStatus' });
            });
        }

        if (recommendedExtensionsBtn) {
            recommendedExtensionsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'showRecommendedExtensions' });
            });
        }
        
        if (openWebsiteBtn) {
            openWebsiteBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openWebsite' });
            });
        }
        
        if (openSettingsBtn) {
            openSettingsBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openSettings' });
            });
        }
        
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'logout' });
            });
        }
        
        // Recent courses functionality
        window.showAllCourses = function() {
            vscode.postMessage({ command: 'showAllCourses' });
        };

        window.viewCourseDetails = function(courseIndex) {
            const coursesData = ${coursesDataJson};
            if (coursesData && coursesData[courseIndex]) {
                vscode.postMessage({ 
                    command: 'viewCourseDetails',
                    courseData: coursesData[courseIndex]
                });
            }
        };

        window.viewRecentCourseDetails = function(courseIndex) {
            const sortedCourses = ${sortedCoursesJson};
            if (sortedCourses && sortedCourses[courseIndex]) {
                vscode.postMessage({
                    command: 'viewCourseDetails',
                    courseData: sortedCourses[courseIndex]
                });
            }
        };

        // Sort recent courses functionality
        window.handleRecentCoursesSort = function(sortOption) {
            const coursesData = ${coursesDataJson};
            if (!coursesData) return;

            // Store preference in localStorage
            try {
                localStorage.setItem('recentCoursesSortPreference', sortOption);
            } catch (e) {
                console.log('Could not save sort preference:', e);
            }

            // Helper function to get latest release date
            const getLatestReleaseDate = (courseData) => {
                const course = courseData.course;
                if (!course.exercises || course.exercises.length === 0) {
                    return 0;
                }

                const latestDate = course.exercises.reduce((latest, exercise) => {
                    const releaseDate = exercise.releaseDate || exercise.startDate;
                    if (releaseDate) {
                        const timestamp = new Date(releaseDate).getTime();
                        return timestamp > latest ? timestamp : latest;
                    }
                    return latest;
                }, 0);

                return latestDate;
            };

            // Helper function to get course start date
            const getCourseStartDate = (courseData) => {
                const course = courseData.course;
                const startDate = course.startDate || course.creationDate;
                return startDate ? new Date(startDate).getTime() : 0;
            };

            // Helper function to get exercise count
            const getExerciseCount = (courseData) => {
                const course = courseData.course;
                return course.exercises ? course.exercises.length : 0;
            };

            // Sort courses based on selected option
            let sorted = [...coursesData];
            switch (sortOption) {
                case 'latest-exercise':
                    sorted.sort((a, b) => getLatestReleaseDate(b) - getLatestReleaseDate(a));
                    break;
                case 'newest-course':
                    sorted.sort((a, b) => getCourseStartDate(b) - getCourseStartDate(a));
                    break;
                case 'most-exercises':
                    sorted.sort((a, b) => getExerciseCount(b) - getExerciseCount(a));
                    break;
                case 'title-asc':
                    sorted.sort((a, b) => a.course.title.localeCompare(b.course.title));
                    break;
                case 'title-desc':
                    sorted.sort((a, b) => b.course.title.localeCompare(a.course.title));
                    break;
            }

            // Take top 3 and render
            const recentCourses = sorted.slice(0, 3);
            const listContainer = document.getElementById('recentCoursesList');
            if (listContainer) {
                listContainer.innerHTML = recentCourses.map((courseData, index) => {
                    const course = courseData.course;
                    const exerciseCount = course.exercises ? course.exercises.length : 0;
                    return \`
                        <div class="recent-course-item" onclick="viewCourseDetails(\${coursesData.indexOf(courseData)})">
                            <div class="course-title">\${course.title}</div>
                            <div class="course-info">\${exerciseCount} exercises</div>
                        </div>
                    \`;
                }).join('');
            }
        };
        
        // Listen for workspace exercise detection results
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'workspaceExerciseDetected') {
                const workspaceBtn = document.getElementById('workspaceExerciseBtn');
                const workspaceNameEl = document.getElementById('workspaceExerciseName');
                
                if (message.exerciseId && message.exerciseTitle) {
                    workspaceExerciseId = message.exerciseId;
                    workspaceExerciseTitle = message.exerciseTitle;
                    
                    if (workspaceNameEl) {
                        workspaceNameEl.textContent = message.exerciseTitle;
                    }
                    if (workspaceBtn) {
                        workspaceBtn.style.display = 'block';
                    }
                } else {
                    if (workspaceBtn) {
                        workspaceBtn.style.display = 'none';
                    }
                }
            }
        });

        // Initialize sort dropdown with saved preference
        document.addEventListener('DOMContentLoaded', function() {
            try {
                const savedSort = localStorage.getItem('recentCoursesSortPreference');
                const sortDropdown = document.getElementById('recentCoursesSort');
                if (savedSort && sortDropdown) {
                    sortDropdown.value = savedSort;
                    // Apply the saved sort
                    handleRecentCoursesSort(savedSort);
                }
            } catch (e) {
                console.log('Could not load sort preference:', e);
            }
        });
    </script>
</body>
</html>`;
  }
};

// src/views/templates/exerciseDetailView.ts
var ExerciseDetailView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  _getExerciseIcon(type) {
    return IconDefinitions.getIcon(type);
  }
  _getUploadMessageIcon() {
    return IconDefinitions.getIcon("uploadMessage");
  }
  generateHtml(exerciseData, hideDeveloperTools = false) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/exercise-detail.css"
    ]);
    if (!exerciseData) {
      return this._getEmptyStateHtml(themeCSS, currentTheme, styles);
    }
    return this._getExerciseDetailHtml(exerciseData, themeCSS, currentTheme, hideDeveloperTools, styles);
  }
  _getEmptyStateHtml(themeCSS, currentTheme, styles) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToCourseDetails()">\u2190 Back to Course</div>
    </div>
    
    <div class="empty-state">
        <h2>Exercise Details</h2>
        <p>Select an exercise to view its details</p>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        window.backToCourseDetails = function() {
            vscode.postMessage({ command: 'backToCourseDetails' });
        };
    </script>
</body>
</html>`;
  }
  _getExerciseDetailHtml(exerciseData, themeCSS, currentTheme, hideDeveloperTools, styles) {
    const exercise = exerciseData?.exercise;
    if (!exercise) {
      return this._getEmptyStateHtml(themeCSS, currentTheme, styles);
    }
    const exerciseTitle = exercise.title || "Unknown Exercise";
    const exerciseType = exercise.type?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || "Unknown";
    const exerciseIcon = this._getExerciseIcon(exercise.type);
    const uploadMessageIcon = this._getUploadMessageIcon();
    const starAssistIcon = IconDefinitions.getIcon("star_4_edges");
    const maxPoints = exercise.maxPoints || 0;
    const bonusPoints = exercise.bonusPoints || 0;
    const releaseDate = exercise.releaseDate ? new Date(exercise.releaseDate).toLocaleString() : "No release date";
    const mode = exercise.mode?.toLowerCase().replace("_", " ") || "Unknown";
    const includedInScore = exercise.includedInOverallScore === "NOT_INCLUDED" ? "Not included in overall score" : exercise.includedInOverallScore === "INCLUDED_COMPLETELY" ? "Included in overall score" : "Partially included in score";
    const filePattern = exercise.filePattern ? exercise.filePattern.split(",").map((ext) => ext.trim().toUpperCase()).join(", ") : "";
    let problemStatement = exercise.problemStatement || "No description available";
    const downloadLinks = [];
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = markdownLinkRegex.exec(problemStatement)) !== null) {
      if (match[2].includes("/api/core/files/") || match[1].includes(".pdf") || match[1].includes(".png")) {
        downloadLinks.push({
          text: match[1],
          url: match[2]
        });
      }
    }
    problemStatement = problemStatement.replace(markdownLinkRegex, "$1");
    const plantUmlRegex = /@startuml([^@]*)@enduml/g;
    const plantUmlDiagrams = [];
    let plantUmlIndex = 0;
    problemStatement = problemStatement.replace(plantUmlRegex, (match2) => {
      plantUmlDiagrams.push(match2);
      const placeholder = `<div class="plantuml-placeholder" data-index="${plantUmlIndex}" data-plantuml="${encodeURIComponent(match2)}">Loading PlantUML diagram...</div>`;
      plantUmlIndex++;
      return placeholder;
    });
    const codeBlocks = [];
    problemStatement = problemStatement.replace(/```(\w+)?\n([\s\S]*?)```/g, (_fullMatch, language, codeContent) => {
      const index = codeBlocks.length;
      const placeholder = `__CODE_BLOCK_${index}__`;
      const escapedCode = codeContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const classAttr = language ? ` class="language-${language}"` : "";
      codeBlocks.push({
        placeholder,
        html: `<pre class="code-block"><code${classAttr}>${escapedCode.trimEnd()}</code></pre>`
      });
      return placeholder;
    });
    problemStatement = problemStatement.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
    problemStatement = problemStatement.replace(
      /(^|\n)\s*(\d+)\.\s*\[task\](?:\[([^\]]+)\])?(?:\(([^)]*)\))?\s*([^\n]*)/g,
      (_match, prefix, index, explicitTitle, testsBlock, remainder) => {
        const stripTaskMetadata = (text) => {
          if (!text) {
            return "";
          }
          let cleaned = text.replace(/<testid>\s*\d+\s*<\/testid>/gi, " ").replace(/\btest[A-Za-z0-9_]*\s*\(\s*\)/gi, " ").replace(/\b\d{4,}\b/g, " ").replace(/\s*,\s*/g, " ");
          cleaned = cleaned.replace(/\(\s*\)/g, " ").replace(/\s{2,}/g, " ").replace(/^\s+|\s+$/g, "").replace(/^[,;:]+/, "").replace(/[,;:]+$/, "").replace(/[()]+$/, "").replace(/^[()]+/, "").trim();
          return cleaned;
        };
        const normalizedRemainder = remainder?.trim() || "";
        let headerText = explicitTitle?.trim() || "";
        let bodyText = "";
        if (!headerText && normalizedRemainder) {
          const firstSentenceMatch = normalizedRemainder.match(/^(.{1,120}?[.!?])(\s+.*)?$/);
          if (firstSentenceMatch) {
            headerText = firstSentenceMatch[1].trim();
            bodyText = (firstSentenceMatch[2] || "").trim();
          } else {
            headerText = normalizedRemainder;
          }
        } else {
          bodyText = normalizedRemainder;
        }
        if (testsBlock) {
          headerText = headerText.replace(testsBlock, "");
          bodyText = bodyText.replace(testsBlock, "");
        }
        headerText = stripTaskMetadata(headerText);
        bodyText = stripTaskMetadata(bodyText);
        if (!headerText) {
          headerText = `Task ${index}`;
        }
        const descriptionHtml = bodyText ? `<div class="task-body">${bodyText}</div>` : "";
        const headerHtml = `<div class="task-header">Task ${index}${headerText ? `: ${headerText}` : ""}</div>`;
        return `${prefix}<div class="task-container">${headerHtml}${descriptionHtml}</div>`;
      }
    );
    problemStatement = problemStatement.replace(/`([^`]+)`/g, "<code>$1</code>");
    problemStatement = problemStatement.replace(/^###### (.*$)/gm, "<h6>$1</h6>").replace(/^##### (.*$)/gm, "<h5>$1</h5>").replace(/^#### (.*$)/gm, "<h4>$1</h4>").replace(/^### (.*$)/gm, "<h3>$1</h3>").replace(/^## (.*$)/gm, "<h2>$1</h2>").replace(/^# (.*$)/gm, "<h1>$1</h1>");
    problemStatement = problemStatement.replace(/^---$/gm, "<hr>");
    problemStatement = problemStatement.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    problemStatement = problemStatement.replace(/^- (.+)$/gm, "<li>$1</li>");
    problemStatement = problemStatement.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, "<ul>$1</ul>");
    problemStatement = problemStatement.replace(/\n\n/g, "</p><p>");
    problemStatement = "<p>" + problemStatement + "</p>";
    problemStatement = problemStatement.replace(/<p><\/p>/g, "").replace(/<p>(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)<\/p>/g, "$1").replace(/<p>(<ul>)/g, "$1").replace(/(<\/ul>)<\/p>/g, "$1").replace(/<p>(<div class="task-container">)/g, "$1").replace(/(<\/div>)<\/p>/g, "$1").replace(/<p>(<pre class="code-block">)/g, "$1").replace(/(<\/pre>)<\/p>/g, "$1");
    for (const block of codeBlocks) {
      problemStatement = problemStatement.replace(block.placeholder, block.html);
    }
    const course = exercise.course;
    const courseName = course?.title || "Unknown Course";
    const semester = course?.semester || "No semester";
    const exerciseId = exercise.id || 0;
    const exerciseShortName = exercise.shortName || "";
    const releaseDateRaw = exercise.releaseDate || exercise.startDate || "";
    const dueDateRaw = exercise.dueDate || "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exercise Details</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>
</head>
<body class="theme-${currentTheme}">
    <div class="back-link-container">
        <div class="back-link" onclick="backToCourseDetails()">\u2190 Back to Course</div>
        <button class="fullscreen-btn" id="fullscreenBtn" onclick="toggleFullscreen()" title="Open exercise in new editor tab">
            \u26F6
        </button>
    </div>
    
    <details class="exercise-card">
        <summary>
            <div class="summary-content">
                <div class="summary-text">
                    <div class="exercise-title">${exerciseTitle}</div>
                    <div class="exercise-meta">
                        <div class="exercise-type-icon">${exerciseIcon}</div>
                        <div class="points-badge">${maxPoints} ${maxPoints === 1 ? "point" : "points"}${bonusPoints > 0 ? ` + ${bonusPoints} bonus` : ""}</div>
                        <button class="repo-status-icon unknown" id="repoStatusIcon" onclick="checkRepositoryStatus(true)" title="Check repository status">
                            ?
                        </button>
                    </div>
                </div>
                <span class="toggle-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                        <path d="M3 6l5 4 5-4" />
                    </svg>
                </span>
            </div>
        </summary>
        <div class="expanded-content">
            <div class="exercise-info-grid">
                <div class="info-item">
                    <div class="info-label">Release Date</div>
                    <div class="info-value">${releaseDate}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Mode</div>
                    <div class="info-value">${mode}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Grading</div>
                    <div class="info-value">${includedInScore}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Course</div>
                    <div class="info-value course-pill">
                        <span>${courseName}</span>
                        <span class="course-semester">${semester}</span>
                    </div>
                </div>
                ${filePattern ? `
                <div class="info-item">
                    <div class="info-label">File Formats</div>
                    <div class="info-value">${filePattern}</div>
                </div>
                ` : ""}
            </div>
        </div>
    </details>
    

    ${(() => {
      const hasParticipation = Array.isArray(exercise.studentParticipations) && exercise.studentParticipations.length > 0;
      const firstParticipation = hasParticipation ? exercise.studentParticipations[0] : void 0;
      const participationId = firstParticipation?.id;
      const rawExerciseType = exercise.type || exercise.exerciseType || "";
      const normalizedExerciseType = typeof rawExerciseType === "string" ? rawExerciseType.toLowerCase() : "";
      const isProgrammingExercise = normalizedExerciseType === "programming";
      const isQuizExercise = normalizedExerciseType === "quiz";
      let buildStatusHtml = "";
      if (hasParticipation && firstParticipation?.submissions && firstParticipation.submissions.length > 0) {
        const latestSubmission = firstParticipation.submissions.reduce((latest, current) => {
          const latestDate = new Date(latest.submissionDate);
          const currentDate = new Date(current.submissionDate);
          return currentDate > latestDate ? current : latest;
        });
        const latestResult = latestSubmission.results && latestSubmission.results.length > 0 ? latestSubmission.results[latestSubmission.results.length - 1] : null;
        if (isProgrammingExercise) {
          const buildFailed = latestSubmission.buildFailed;
          const scorePercentage = latestResult ? latestResult.score : 0;
          const maxPoints2 = exercise.maxPoints || 0;
          const scorePoints = Math.round(scorePercentage / 100 * maxPoints2 * 100) / 100;
          const successful = latestResult ? latestResult.successful : false;
          const totalTests = latestResult?.testCaseCount || 0;
          const passedTests = latestResult?.passedTestCaseCount || 0;
          const hasTestInfo = totalTests > 0;
          let statusBadge = "";
          if (buildFailed) {
            statusBadge = '<span class="status-badge failed">Build Failed</span>';
          } else if (hasTestInfo) {
            const passPercentage = passedTests / totalTests * 100;
            const badgeClass = passPercentage >= 90 ? "success" : passPercentage >= 75 ? "partial" : "failed";
            statusBadge = `<span class="status-badge ${badgeClass}">${passedTests}/${totalTests} tests passed</span>`;
          } else {
            statusBadge = successful ? '<span class="status-badge success">Build Success</span>' : '<span class="status-badge failed">Tests Failed</span>';
          }
          buildStatusHtml = `
                    <div class="build-status">
                        <div class="build-status-title">Latest Build Status</div>
                        <div class="build-status-info">
                            ${statusBadge}
                            <div class="score-info">
                                Score: <span class="score-points">${scorePoints}/${maxPoints2} (${scorePercentage.toFixed(2)}%)</span> ${maxPoints2 === 1 ? "point" : "points"}
                            </div>
                        </div>
                        ${hasTestInfo ? `<div class="test-results-toggle-container">
                            <a href="#" class="test-results-toggle" onclick="toggleTestResults(event)" id="testResultsToggle">
                                See test results
                            </a>
                        </div>
                        <div class="test-results-modal" id="testResultsModal" aria-hidden="true" onclick="handleTestResultsBackdrop(event)">
                            <div class="test-results-modal-content">
                                <div class="test-results-modal-header">
                                    <div class="test-results-modal-title">Test Results</div>
                                    <button class="test-results-modal-close" onclick="closeTestResultsModal()" aria-label="Close test results">&times;</button>
                                </div>
                                <div class="test-results-modal-body">
                                    <div class="test-results-container" id="testResultsContainer">
                                        <div class="test-results-loading">Loading test results...</div>
                                    </div>
                                </div>
                            </div>
                        </div>` : ""}
                    </div>
                `;
        } else if (!isQuizExercise) {
          const submitted = latestSubmission.submitted;
          const empty = latestSubmission.empty;
          const scorePercentage = latestResult ? latestResult.score : 0;
          const maxPoints2 = exercise.maxPoints || 0;
          const scorePoints = Math.round(scorePercentage / 100 * maxPoints2 * 100) / 100;
          let statusBadge = "";
          let statusText = "";
          if (submitted && !empty) {
            statusBadge = '<span class="status-badge success">Submitted</span>';
            statusText = "Latest Submission Status";
          } else if (!empty) {
            statusBadge = '<span class="status-badge building">Draft Saved</span>';
            statusText = "Current Status";
          } else {
            statusBadge = '<span class="status-badge failed">No Submission</span>';
            statusText = "Submission Status";
          }
          let scoreDisplay = "";
          if (latestResult) {
            scoreDisplay = `
                        <div class="score-info">
                            Score: <span class="score-points">${scorePoints}/${maxPoints2} (${scorePercentage.toFixed(2)}%)</span> ${maxPoints2 === 1 ? "point" : "points"}
                        </div>
                    `;
          }
          buildStatusHtml = `
                    <div class="build-status">
                        <div class="build-status-title">${statusText}</div>
                        <div class="build-status-info">
                            ${statusBadge}
                            ${scoreDisplay}
                        </div>
                    </div>
                `;
        }
      }
      if (hasParticipation && isProgrammingExercise && !buildStatusHtml) {
        buildStatusHtml = `
                <div class="build-status build-status--empty">
                    <div class="build-status-title">Latest Build Status</div>
                    <div class="build-status-info">
                        <div class="build-status-placeholder">No submissions yet. Submit to see build results.</div>
                    </div>
                </div>
            `;
      }
      const changeStatusHtml = hasParticipation && isProgrammingExercise ? `
            <div class="changes-status" id="changesStatus" data-state="checking">
                <span class="changes-status-indicator"></span>
                <span id="changesStatusText">Checking workspace status...</span>
            </div>
        ` : "";
      const actionsHtml = hasParticipation ? isProgrammingExercise ? `<div class="participation-actions">
                    ${changeStatusHtml}
                    <div class="cloned-repo-notice" id="clonedRepoNotice" style="display: none;">
                        <span id="clonedRepoMessage">Repository recently cloned.</span> <a href="#" class="open-repo-link" onclick="openClonedRepository(); return false;">Open now</a>
                    </div>
                    <div class="unsaved-changes-banner" id="unsavedChangesBanner" style="display: none;">
                        <span class="unsaved-changes-icon">\u26A0\uFE0F</span>
                        <span class="unsaved-changes-text">
                            <strong>Unsaved changes detected.</strong> Please save your files before submitting.
                            <a href="#" class="unsaved-changes-link" onclick="openAutoSaveSettings(); return false;">Configure auto-save</a>
                        </span>
                    </div>
                    <div class="submit-button-group" id="submitBtnGroup" style="display: none;">
                        <button class="participate-btn" id="submitBtn" onclick="submitExercise()" title="Submit solution with automatic commit message">Submit</button>
                        <button class="upload-message-btn" id="uploadMessageBtn" onclick="toggleCommitMessageInput()" title="Submit solution with custom commit message">
                            ${uploadMessageIcon}
                        </button>
                    </div>
                    <div class="commit-message-input-container" id="commitMessageContainer" style="display: none;">
                        <input type="text" id="commitMessageInput" class="commit-message-input" placeholder="Enter commit message..." />
                    </div>
                    <div class="action-button-row">
                        <button class="participate-btn" id="cloneBtn" onclick="cloneRepository()">Clone Repository</button>
                        <div class="more-menu" id="moreMenu">
                            <button class="more-toggle" onclick="toggleMoreMenu()">
                                More options
                            </button>
                            <div class="more-dropdown">
                                <button class="dropdown-item" id="cloneDropdownItem" onclick="cloneRepository()" style="display: none;">Clone Repository</button>
                                <button class="dropdown-item" id="pullChangesItem" onclick="pullChanges()" style="display: none;">Pull Changes</button>
                                <button class="dropdown-item" onclick="copyCloneUrl()">Copy Clone URL</button>
                                <button class="dropdown-item" onclick="openExerciseInBrowser()">Open in browser</button>
                            </div>
                        </div>
                    </div>
                </div>` : `<div class="participation-actions">
                    <div class="action-button-row">
                        <button class="participate-btn" onclick="openExerciseInBrowser()">Open in browser</button>
                    </div>
                </div>` : isProgrammingExercise ? `<div class="participation-actions not-participated">
                    <div class="action-button-row">
                        <button class="participate-btn" onclick="participateInExercise()">Participate</button>
                        <button class="participate-btn secondary" onclick="openExerciseInBrowser()">Open in browser</button>
                    </div>
                </div>` : `<div class="participation-actions not-participated">
                    <div class="action-button-row">
                        <button class="participate-btn" onclick="openExerciseInBrowser()">Open in browser</button>
                    </div>
                </div>`;
      let participationStatus = "";
      let participationMessage = "";
      if (isProgrammingExercise) {
        participationStatus = hasParticipation ? "Repository Ready" : "Not Participating Yet";
        participationMessage = hasParticipation ? "You have already started this exercise." : "You have not started this exercise yet.";
      } else {
        const cleanedType = normalizedExerciseType.replace(/_/g, " ").replace(/-/g, " ");
        const exerciseTypeDisplay = cleanedType ? cleanedType.charAt(0).toUpperCase() + cleanedType.slice(1) : "Course";
        const exerciseTypePlain = cleanedType || "course";
        participationStatus = `${exerciseTypeDisplay} Exercise`;
        participationMessage = `This is a ${exerciseTypePlain} exercise. Complete it in the browser.`;
      }
      return `<div class="participation-section" data-has-participation="${hasParticipation}" data-participation-id="${participationId || ""}">
        <div class="participation-info">
            <div class="participation-status">${participationStatus}</div>
            <div class="participation-message">${participationMessage}</div>
        </div>
        ${actionsHtml}
        ${buildStatusHtml}
    </div>`;
    })()}

    <div class="content-section iris-assist-section">
        <div class="iris-assist-content">
            <div class="iris-assist-title">Ask Iris about this exercise</div>
            <p class="iris-assist-description">Open the Iris chat to discuss this exercise or get guidance.</p>
        </div>
        <button class="iris-assist-button" id="askIrisAboutExerciseBtn">
            <span class="iris-assist-button-icon">${starAssistIcon}</span>
            Ask Iris
        </button>
    </div>

    <div class="content-section">
        <div class="section-title">Exercise Description</div>
        <div class="problem-statement">${problemStatement}</div>
        
        ${downloadLinks.length > 0 ? `
        <div class="downloads-section">
            <div class="section-title">Downloads</div>
            <div class="download-links">
                ${downloadLinks.map((link) => `
                    <a href="#" class="download-link" onclick="downloadFile('${link.url}', '${link.text}')">
                        <span class="download-icon">\u{1F4C4}</span>
                        ${link.text}
                    </a>
                `).join("")}
            </div>
        </div>
        ` : ""}
    </div>
    
    ${!hideDeveloperTools ? `
    <div class="action-buttons">
        <button class="btn btn-primary" onclick="openInEditor()">Open Raw JSON</button>
        <button class="btn" onclick="copyToClipboard()">Copy Exercise Data</button>
        <button class="btn" onclick="showSubmissionDetails()">Submission Details</button>
    </div>
    ` : ""}

    <script>
        const vscode = acquireVsCodeApi();
        const exerciseData = ${JSON.stringify(exerciseData)};
        
        // Make exercise data available globally for WebSocket handlers
        window.exerciseData = exerciseData;
        
        // Store PlantUML diagrams for rendering
        const plantUmlDiagrams = ${JSON.stringify(plantUmlDiagrams)};
        
        // Auto-render PlantUML diagrams
        function renderPlantUmlDiagram(index, plantUml) {
            const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${index}"]\`);
            if (!placeholder) {
                console.error('PlantUML placeholder not found for index:', index);
                return;
            }
            
            console.log(\`\u{1F3A8} Auto-rendering PlantUML diagram \${index + 1}/\${plantUmlDiagrams.length}\`);
            
            // Request rendering from VS Code
            vscode.postMessage({
                command: 'renderPlantUmlInline',
                plantUml: plantUml,
                index: index
            });
        }
        
        // Listen for rendered PlantUML responses
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'plantUmlRendered') {
                const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${message.index}"]\`);
                if (placeholder) {
                    const container = document.createElement('div');
                    container.className = 'plantuml-rendered';
                    container.innerHTML = message.svg;
                    container.setAttribute('data-plantuml', placeholder.getAttribute('data-plantuml'));
                    container.setAttribute('data-index', message.index);
                    container.style.cursor = 'pointer';
                    container.title = 'Click to open in new tab';
                    
                    // Make it clickable to open in new tab
                    container.addEventListener('click', () => {
                        const plantUml = decodeURIComponent(container.getAttribute('data-plantuml'));
                        vscode.postMessage({
                            command: 'openPlantUmlInNewTab',
                            plantUml: plantUml,
                            index: message.index
                        });
                    });
                    
                    placeholder.parentNode.replaceChild(container, placeholder);
                    console.log(\`\u2705 PlantUML diagram \${message.index + 1} rendered successfully\`);
                }
            } else if (message.command === 'plantUmlError') {
                const placeholder = document.querySelector(\`.plantuml-placeholder[data-index="\${message.index}"]\`);
                if (placeholder) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'plantuml-error';
                    errorDiv.textContent = \`Error rendering PlantUML: \${message.error}\`;
                    placeholder.parentNode.replaceChild(errorDiv, placeholder);
                    console.error(\`\u274C PlantUML diagram \${message.index + 1} failed to render:\`, message.error);
                }
            }
        });
        
        // Auto-render all PlantUML diagrams on page load
        if (plantUmlDiagrams.length > 0) {
            console.log(\`\u{1F4CA} Found \${plantUmlDiagrams.length} PlantUML diagram(s), auto-rendering...\`);
            plantUmlDiagrams.forEach((diagram, index) => {
                renderPlantUmlDiagram(index, diagram);
            });
        }
        
        const askIrisExerciseBtn = document.getElementById('askIrisAboutExerciseBtn');
        
        if (askIrisExerciseBtn) {
            askIrisExerciseBtn.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'askIrisAboutExercise',
                    exerciseId: ${exerciseId},
                    exerciseTitle: ${JSON.stringify(exerciseTitle)},
                    exerciseShortName: ${JSON.stringify(exerciseShortName)},
                    releaseDate: ${JSON.stringify(releaseDateRaw)},
                    dueDate: ${JSON.stringify(dueDateRaw)}
                });
            });
        }
        
        window.backToCourseDetails = function() {
            vscode.postMessage({ command: 'backToCourseDetails' });
        };
        
        // PlantUML render function
        window.renderPlantUmlDiagrams = function() {
            if (plantUmlDiagrams.length > 0) {
                console.log('\u{1F3A8} Rendering PlantUML diagrams:', plantUmlDiagrams);
                vscode.postMessage({
                    command: 'renderPlantUml',
                    plantUmlDiagrams: plantUmlDiagrams,
                    exerciseTitle: ${JSON.stringify(exerciseTitle)}
                });
            }
        };
        
        window.downloadFile = function(url, filename) {
            vscode.postMessage({ 
                command: 'downloadFile',
                url: url,
                filename: filename
            });
        };
        
        window.openInEditor = function() {
            vscode.postMessage({ 
                command: 'openInEditor',
                data: exerciseData
            });
        };
        
        window.copyToClipboard = function() {
            vscode.postMessage({
                command: 'copyToClipboard',
                text: JSON.stringify(exerciseData, null, 2)
            });
        };

        window.showSubmissionDetails = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];

                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }

                const participation = participations[0];
                const submissions = participation.submissions || [];

                if (!submissions.length) {
                    vscode.postMessage({ command: 'alert', text: 'No submissions found yet.' });
                    return;
                }

                // Find the latest submission by date
                const latestSubmission = submissions.reduce((latest, current) => {
                    const latestDate = new Date(latest.submissionDate);
                    const currentDate = new Date(current.submissionDate);
                    return currentDate > latestDate ? current : latest;
                });

                const results = latestSubmission.results || [];

                if (!results.length) {
                    vscode.postMessage({ command: 'alert', text: 'No results found for the latest submission.' });
                    return;
                }

                // Get the latest result
                const latestResult = results[results.length - 1];

                vscode.postMessage({
                    command: 'showSubmissionDetails',
                    participationId: participation.id,
                    resultId: latestResult.id
                });
            } catch (e) {
                console.error('Error preparing submission details:', e);
                vscode.postMessage({ command: 'alert', text: 'Error preparing submission details operation.' });
            }
        };

        window.toggleTestResults = function(event) {
            if (event) {
                event.preventDefault();
            }

            const modal = document.getElementById('testResultsModal');

            if (!modal) {
                return;
            }

            if (modal.classList.contains('open')) {
                closeTestResultsModal();
            } else {
                openTestResultsModal();
            }
        };

        window.openTestResultsModal = function() {
            const modal = document.getElementById('testResultsModal');
            const container = document.getElementById('testResultsContainer');
            const toggle = document.getElementById('testResultsToggle');

            if (!modal || !container) {
                return;
            }

            if (modal.parentElement && modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }

            if (!modal.classList.contains('open')) {
                modal.classList.add('open');
                modal.setAttribute('aria-hidden', 'false');
                document.body.classList.add('test-results-modal-open');

                if (toggle) {
                    toggle.textContent = 'Hide test results';
                }

                if (!container.dataset.loaded) {
                    fetchTestResults();
                }
            }
        };

        window.closeTestResultsModal = function() {
            const modal = document.getElementById('testResultsModal');
            const toggle = document.getElementById('testResultsToggle');

            if (!modal) {
                return;
            }

            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('test-results-modal-open');

            if (toggle) {
                toggle.textContent = 'See test results';
            }
        };

        window.handleTestResultsBackdrop = function(event) {
            if (event && event.target && event.target.id === 'testResultsModal') {
                closeTestResultsModal();
            }
        };

        window.fetchTestResults = function() {
            const container = document.getElementById('testResultsContainer');
            if (!container) {
                return;
            }

            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];

                if (!participations.length) {
                    container.innerHTML = '<div class="test-results-loading">No participation found</div>';
                    return;
                }

                const participation = participations[0];
                const submissions = participation.submissions || [];

                if (!submissions.length) {
                    container.innerHTML = '<div class="test-results-loading">No submissions found</div>';
                    return;
                }

                // Find the latest submission by date
                const latestSubmission = submissions.reduce((latest, current) => {
                    const latestDate = new Date(latest.submissionDate);
                    const currentDate = new Date(current.submissionDate);
                    return currentDate > latestDate ? current : latest;
                });

                const results = latestSubmission.results || [];

                if (!results.length) {
                    container.innerHTML = '<div class="test-results-loading">No results found</div>';
                    return;
                }

                // Get the latest result
                const latestResult = results[results.length - 1];

                vscode.postMessage({
                    command: 'fetchTestResults',
                    participationId: participation.id,
                    resultId: latestResult.id
                });
            } catch (e) {
                console.error('Error fetching test results:', e);
                container.innerHTML = '<div class="test-results-loading">Error loading test results</div>';
            }
        };

        window.renderTestResults = function(testCases) {
            const container = document.getElementById('testResultsContainer');
            if (!container) {
                return;
            }

            console.log('Rendering test results:', testCases);

            if (!testCases || !testCases.length) {
                container.innerHTML = '<div class="test-results-loading">No test results available</div>';
                container.dataset.loaded = 'true';
                return;
            }

            // Store original test cases for filtering
            window.allTestCases = testCases;

            // Sort test cases: failed first, then passed
            const sortedTests = [...testCases].sort((a, b) => {
                const aSuccessful = a.successful === true;
                const bSuccessful = b.successful === true;
                if (aSuccessful === bSuccessful) {
                    return 0;
                }
                return aSuccessful ? 1 : -1;
            });

            const failedCount = testCases.filter(t => !t.successful).length;
            const passedCount = testCases.filter(t => t.successful).length;

            const testItemsHtml = sortedTests.map((test, index) => {
                const passed = test.successful === true;
                const statusClass = passed ? 'passed' : 'failed';
                const icon = passed ? '\u2713' : '\u2717';
                const testName = test.testName || 'Unnamed Test';
                const message = test.detailText || test.message || (passed ? 'Test passed' : 'Test failed');
                const testType = test.type || 'BEHAVIORAL';

                // HTML escape the message to prevent HTML injection and display special characters
                const escapeHtml = (str) => {
                    const div = document.createElement('div');
                    div.textContent = str;
                    return div.innerHTML;
                };
                const escapedMessage = escapeHtml(message);

                // Format test type for display
                const typeLabel = testType === 'STRUCTURAL' ? 'Structural' :
                                testType === 'BEHAVIORAL' ? 'Behavioral' : testType;

                const typeBadgeHtml = \`<span class="test-type-badge test-type-\${testType.toLowerCase()}">\${typeLabel}</span>\`;

                return \`
                    <div class="test-result-item \${statusClass}" data-test-index="\${index}" data-test-name="\${testName.toLowerCase()}" data-test-type="\${testType}" data-test-status="\${statusClass}">
                        <div class="test-result-icon \${statusClass}">\${icon}</div>
                        <div class="test-result-content">
                            <div class="test-result-header">
                                <div class="test-result-name">\${testName}</div>
                                \${typeBadgeHtml}
                            </div>
                            <div class="test-result-message">\${escapedMessage}</div>
                        </div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = \`
                <div class="test-results-controls">
                    <input type="text" class="test-results-search" id="testSearch" placeholder="Search tests..." oninput="filterTests()">
                    <div class="test-results-filters">
                        <button class="test-filter-btn active" data-filter="all" onclick="setTestFilter('all')">All (\${testCases.length})</button>
                        <button class="test-filter-btn" data-filter="failed" onclick="setTestFilter('failed')">Failed (\${failedCount})</button>
                        <button class="test-filter-btn" data-filter="passed" onclick="setTestFilter('passed')">Passed (\${passedCount})</button>
                        <button class="test-filter-btn" data-filter="structural" onclick="setTestFilter('structural')">Structural</button>
                        <button class="test-filter-btn" data-filter="behavioral" onclick="setTestFilter('behavioral')">Behavioral</button>
                    </div>
                </div>
                <div class="test-results-count" id="testResultsCount">Showing \${testCases.length} of \${testCases.length} tests</div>
                <div class="test-results-list" id="testResultsList">\${testItemsHtml}</div>
            \`;
            container.dataset.loaded = 'true';
            updateTestCount();
        };

        window.currentTestFilter = 'all';

        window.updateTestCount = function() {
            const list = document.getElementById('testResultsList');
            const countElement = document.getElementById('testResultsCount');

            if (!list || !countElement) {
                return;
            }

            const allItems = list.querySelectorAll('.test-result-item');
            const visibleItems = list.querySelectorAll('.test-result-item:not(.hidden)');

            countElement.textContent = \`Showing \${visibleItems.length} of \${allItems.length} tests\`;
        };

        window.setTestFilter = function(filter) {
            window.currentTestFilter = filter;

            // Update button states
            const buttons = document.querySelectorAll('.test-filter-btn');
            buttons.forEach(btn => {
                if (btn.getAttribute('data-filter') === filter) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            filterTests();
        };

        window.filterTests = function() {
            const searchInput = document.getElementById('testSearch');
            const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
            const filter = window.currentTestFilter || 'all';
            const testItems = document.querySelectorAll('.test-result-item');

            testItems.forEach(item => {
                const testName = item.getAttribute('data-test-name') || '';
                const testType = item.getAttribute('data-test-type') || '';
                const testStatus = item.getAttribute('data-test-status') || '';

                // Check search term
                const matchesSearch = !searchTerm || testName.includes(searchTerm);

                // Check filter
                let matchesFilter = true;
                if (filter === 'failed') {
                    matchesFilter = testStatus === 'failed';
                } else if (filter === 'passed') {
                    matchesFilter = testStatus === 'passed';
                } else if (filter === 'structural') {
                    matchesFilter = testType === 'STRUCTURAL';
                } else if (filter === 'behavioral') {
                    matchesFilter = testType === 'BEHAVIORAL';
                }

                // Show or hide item
                if (matchesSearch && matchesFilter) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });

            // Update count using the central function
            updateTestCount();
        };

        window.participateInExercise = function() {
            vscode.postMessage({
                command: 'participateInExercise',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                exerciseTitle: exerciseData.exercise?.title || exerciseData.title,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.openExerciseInBrowser = function() {
            vscode.postMessage({ 
                command: 'openExerciseInBrowser',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.openExercise = function() {
            vscode.postMessage({ 
                command: 'openExercise',
                exerciseId: exerciseData.exercise?.id || exerciseData.id,
                courseId: exerciseData.exercise?.course?.id || exerciseData.course?.id
            });
        };

        window.toggleMoreMenu = function() {
            const moreMenu = document.getElementById('moreMenu');
            if (moreMenu) {
                moreMenu.classList.toggle('expanded');
            }
        };

        // Close more menu when clicking outside
        document.addEventListener('click', function(event) {
            const moreMenu = document.getElementById('moreMenu');
            if (moreMenu && !moreMenu.contains(event.target)) {
                moreMenu.classList.remove('expanded');
            }
        });

        // Repository status checking
        window.checkRepositoryStatus = function(showChecking = false) {
            const participation = exerciseData.exercise?.studentParticipations?.[0] || exerciseData.studentParticipations?.[0];
            const repoUrl = participation?.repositoryUri;
            
            if (!repoUrl) {
                updateRepoStatusIcon('unknown', '!', 'Open the exercise repository.', false);
                updateChangeStatus('disconnected');
                updateButtonsForWorkspace(false);
                return;
            }

            if (showChecking) {
                updateRepoStatusIcon('checking', '\u27F3', 'Checking repository connection... Click to rerun check', false);
                updateChangeStatus('checking');
            }
            
            // Send message to extension to check repository status
            vscode.postMessage({ 
                command: 'checkRepositoryStatus',
                expectedRepoUrl: repoUrl,
                exerciseId: exerciseData.exercise?.id || exerciseData.id
            });
        };

        function updateRepoStatusIcon(status, icon, tooltip, hasChanges = false) {
            const iconElement = document.getElementById('repoStatusIcon');
            if (!iconElement) {
                return;
            }
            iconElement.className = 'repo-status-icon ' + status + (hasChanges ? ' has-changes' : '');
            iconElement.textContent = icon;
            iconElement.title = tooltip;
            iconElement.setAttribute('aria-label', tooltip);
        }

        function updateChangeStatus(state, textOverride) {
            const statusElement = document.getElementById('changesStatus');
            const textElement = document.getElementById('changesStatusText');
            if (!statusElement || !textElement) {
                return;
            }
            statusElement.style.display = 'flex';
            statusElement.dataset.state = state;
            let text = textOverride;
            if (!text) {
                switch (state) {
                    case 'dirty':
                        text = 'Local changes detected. Ready to submit.';
                        break;
                    case 'clean':
                        text = 'No local changes detected.';
                        break;
                    case 'checking':
                        text = 'Checking workspace status...';
                        break;
                    case 'disconnected':
                    default:
                        text = 'Open the exercise repository.';
                        break;
                }
            }
            textElement.textContent = text;
        }

        function updateButtonsForWorkspace(isWorkspace, hasChanges = false) {
            const submitBtnGroup = document.getElementById('submitBtnGroup');
            const cloneBtn = document.getElementById('cloneBtn');
            const cloneDropdownItem = document.getElementById('cloneDropdownItem');
            const submitBtn = document.getElementById('submitBtn');
            const uploadBtn = document.getElementById('uploadMessageBtn');
            const commitContainer = document.getElementById('commitMessageContainer');
            const commitInput = document.getElementById('commitMessageInput');
            
            // Check both the loading class AND if progress is actively shown
            const isLoading = submitBtnGroup?.classList.contains('loading');
            const buildSection = document.querySelector('.build-status');
            const hasActiveProgress = buildSection?.dataset.progressMode != null;
            const shouldLock = isLoading || hasActiveProgress;
            
            const canSubmit = isWorkspace && hasChanges && !shouldLock;

            if (submitBtnGroup) {
                submitBtnGroup.style.display = isWorkspace ? 'flex' : 'none';
            }

            if (cloneBtn) {
                cloneBtn.style.display = isWorkspace ? 'none' : 'inline-block';
            }

            if (cloneDropdownItem) {
                cloneDropdownItem.style.display = isWorkspace ? 'block' : 'none';
            }

            const pullChangesItem = document.getElementById('pullChangesItem');
            if (pullChangesItem) {
                pullChangesItem.style.display = isWorkspace ? 'block' : 'none';
            }

            if (submitBtn) {
                if (shouldLock) {
                    submitBtn.disabled = true;
                    submitBtn.title = 'Build in progress, please wait...';
                } else {
                    submitBtn.disabled = !canSubmit;
                    submitBtn.title = !isWorkspace
                        ? 'Connect the exercise repository to enable submissions'
                        : canSubmit
                            ? 'Submit solution with automatic commit message'
                            : 'No local changes detected yet';
                }
            }

            if (uploadBtn) {
                if (shouldLock) {
                    uploadBtn.disabled = true;
                    uploadBtn.title = 'Build in progress, please wait...';
                } else {
                    uploadBtn.disabled = !canSubmit;
                    uploadBtn.title = !isWorkspace
                        ? 'Connect the exercise repository to enable submissions'
                        : canSubmit
                            ? 'Submit solution with custom commit message'
                            : 'No local changes detected yet';
                }
            }

            if (commitContainer) {
                if (shouldLock) {
                    commitContainer.style.display = 'none';
                } else if (!canSubmit) {
                    commitContainer.style.display = 'none';
                    if (commitInput) {
                        commitInput.value = '';
                    }
                }
            }

            updateChangeStatus(!isWorkspace ? 'disconnected' : hasChanges ? 'dirty' : 'clean');
        }

        function setSubmitLoading(isLoading) {
            const submitBtn = document.getElementById('submitBtn');
            const uploadBtn = document.getElementById('uploadMessageBtn');
            const submitBtnGroup = document.getElementById('submitBtnGroup');

            if (submitBtn) {
                if (isLoading) {
                    submitBtn.dataset.prevDisabled = submitBtn.disabled ? 'true' : 'false';
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Submitting...';
                } else {
                    const wasDisabled = submitBtn.dataset.prevDisabled === 'true';
                    submitBtn.disabled = wasDisabled;
                    submitBtn.textContent = 'Submit';
                    delete submitBtn.dataset.prevDisabled;
                }
            }

            if (uploadBtn) {
                if (isLoading) {
                    uploadBtn.dataset.prevDisabled = uploadBtn.disabled ? 'true' : 'false';
                    uploadBtn.disabled = true;
                } else {
                    const wasDisabled = uploadBtn.dataset.prevDisabled === 'true';
                    uploadBtn.disabled = wasDisabled;
                    delete uploadBtn.dataset.prevDisabled;
                }
            }

            if (submitBtnGroup) {
                submitBtnGroup.classList.toggle('loading', isLoading);
            }
        }

        function ensureBuildStatusSection() {
            let section = document.querySelector('.build-status');
            if (!section) {
                const participationInfo = document.querySelector('.participation-info');
                if (participationInfo) {
                    section = document.createElement('div');
                    section.className = 'build-status';
                    participationInfo.appendChild(section);
                }
            }
            return section;
        }

        function generateStatusBadge(buildFailed, hasTestInfo, passedTests, totalTests, successful) {
            if (buildFailed) {
                return '<span class="status-badge failed">Build Failed<' + '/span>';
            }
            
            if (hasTestInfo) {
                const passPercentage = (passedTests / totalTests) * 100;
                let badgeClass = 'failed';
                
                if (passPercentage >= 90) {
                    badgeClass = 'success';
                } else if (passPercentage >= 75) {
                    badgeClass = 'partial';
                }
                
                return '<span class="status-badge ' + badgeClass + '">' + passedTests + '/' + totalTests + ' tests passed<' + '/span>';
            }
            
            return successful 
                ? '<span class="status-badge success">Build Success<' + '/span>'
                : '<span class="status-badge failed">Tests Failed<' + '/span>';
        }

        function renderBuildProgress(section, messageText, progressPercent, isIndeterminate = false) {
            if (!section) {
                return;
            }

            section.classList.remove('build-status--empty');
            section.innerHTML = '';

            const title = document.createElement('div');
            title.className = 'build-status-title';
            title.textContent = 'Build in Progress';

            const info = document.createElement('div');
            info.className = 'build-status-info';

            const messageEl = document.createElement('div');
            messageEl.className = 'build-status-message';
            messageEl.textContent = messageText;

            const track = document.createElement('div');
            track.className = 'build-progress-track';

            const bar = document.createElement('div');
            bar.className = 'build-progress-bar';
            if (isIndeterminate) {
                bar.classList.add('indeterminate');
            } else {
                const width = Math.max(5, Math.min(100, progressPercent || 0));
                bar.style.width = width + '%';
            }

            track.appendChild(bar);
            info.appendChild(messageEl);
            info.appendChild(track);

            section.appendChild(title);
            section.appendChild(info);

            section.dataset.progressMode = isIndeterminate ? 'indeterminate' : 'determinate';
        }

        // Listen for messages from the extension
        window.addEventListener('message', function(event) {
            const message = event.data;
            switch (message.command) {
                case 'updateRepoStatus':
                    if (message.isConnected) {
                        const hasChanges = !!message.hasChanges;
                        const iconChar = '\u2713';
                        const tooltip = hasChanges
                            ? 'Connected to the exercise repository. Local changes detected. Click to rerun check.'
                            : 'Connected to the exercise repository. No local changes detected. Click to rerun check.';
                        updateRepoStatusIcon('connected', iconChar, tooltip, hasChanges);
                        updateButtonsForWorkspace(true, hasChanges);
                    } else {
                        updateRepoStatusIcon('disconnected', '!', 'Open the exercise repository to enable submissions. Click to rerun check.', false);
                        updateButtonsForWorkspace(false);
                    }
                    break;
                case 'submissionResult':
                    setSubmitLoading(false);
                    if (message.success) {
                        const input = document.getElementById('commitMessageInput');
                        const container = document.getElementById('commitMessageContainer');
                        if (input) {
                            input.value = '';
                        }
                        if (container) {
                            container.style.display = 'none';
                        }
                        checkRepositoryStatus(true);
                    } else if (message.error) {
                        console.warn('Submission failed:', message.error);
                    }
                    break;
                case 'newResult':
                    // Real-time result update from WebSocket
                    handleNewResult(message.result);
                    break;
                case 'newSubmission':
                    // Real-time submission update from WebSocket
                    handleNewSubmission(message.submission);
                    break;
                case 'submissionProcessing':
                    // Real-time build status update from WebSocket
                    handleSubmissionProcessing(message.state, message.buildTimingInfo);
                    break;
                case 'testResultsData':
                    // Received test results data
                    console.log('Received testResultsData message:', message);
                    if (message.testCases) {
                        renderTestResults(message.testCases);
                    } else {
                        console.log('No testCases in message, showing error');
                        const container = document.getElementById('testResultsContainer');
                        if (container) {
                            container.innerHTML = '<div class="test-results-loading">Error: ' + (message.error || 'No test data received') + '</div>';
                            container.dataset.loaded = 'true';
                        }
                    }
                    break;
                case 'showClonedRepoNotice':
                    // Show the recently cloned repository notice and store flag
                    const clonedNotice = document.getElementById('clonedRepoNotice');
                    const clonedMessage = document.getElementById('clonedRepoMessage');
                    if (clonedNotice) {
                        clonedNotice.style.display = 'block';
                    }
                    if (clonedMessage && message.exerciseTitle) {
                        clonedMessage.textContent = '"' + message.exerciseTitle + '" recently cloned.';
                    }
                    try {
                        const ex = exerciseData.exercise || exerciseData;
                        const storageKey = 'recentlyCloned_' + ex.id;
                        const storageData = JSON.stringify({
                            timestamp: Date.now(),
                            title: message.exerciseTitle || ex.title
                        });
                        localStorage.setItem(storageKey, storageData);
                    } catch (e) {
                        // Ignore storage errors
                    }
                    break;
                case 'updateDirtyPagesStatus':
                    // Update the unsaved changes banner visibility
                    // Only show if there are dirty pages AND auto-save is disabled
                    const unsavedBanner = document.getElementById('unsavedChangesBanner');
                    if (unsavedBanner) {
                        if (message.hasDirtyPages && !message.autoSaveEnabled) {
                            unsavedBanner.style.display = 'flex';
                        } else {
                            unsavedBanner.style.display = 'none';
                        }
                    }
                    break;
            }
        });

        // Check repository status on page load and poll periodically
        setTimeout(() => {
            checkRepositoryStatus(true);
        }, 500);

        if (window.repoStatusPollTimer) {
            clearInterval(window.repoStatusPollTimer);
        }
        window.repoStatusPollTimer = setInterval(() => {
            checkRepositoryStatus();
        }, 15000);

        // Check if this exercise was recently cloned and show notice
        try {
            const ex = exerciseData.exercise || exerciseData;
            const storageKey = 'recentlyCloned_' + ex.id;
            const clonedData = localStorage.getItem(storageKey);
            if (clonedData) {
                try {
                    const data = JSON.parse(clonedData);
                    const timeSinceClone = Date.now() - data.timestamp;
                    // Show notice if cloned within last 10 minutes
                    if (timeSinceClone < 10 * 60 * 1000) {
                        const clonedNotice = document.getElementById('clonedRepoNotice');
                        const clonedMessage = document.getElementById('clonedRepoMessage');
                        if (clonedNotice) {
                            clonedNotice.style.display = 'block';
                        }
                        if (clonedMessage && data.title) {
                            clonedMessage.textContent = '"' + data.title + '" recently cloned.';
                        }
                    } else {
                        // Clear old flag
                        localStorage.removeItem(storageKey);
                    }
                } catch (parseError) {
                    // Handle old format (just timestamp) or invalid JSON
                    const timestamp = parseInt(clonedData);
                    if (!isNaN(timestamp)) {
                        const timeSinceClone = Date.now() - timestamp;
                        if (timeSinceClone < 10 * 60 * 1000) {
                            const clonedNotice = document.getElementById('clonedRepoNotice');
                            if (clonedNotice) {
                                clonedNotice.style.display = 'block';
                            }
                        } else {
                            localStorage.removeItem(storageKey);
                        }
                    } else {
                        localStorage.removeItem(storageKey);
                    }
                }
            }
        } catch (e) {
            // Ignore storage errors
        }

        window.cloneRepository = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];
                vscode.postMessage({
                    command: 'cloneRepository',
                    participationId: participation.id,
                    repositoryUri: participation.repositoryUri,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error preparing clone operation.' });
            }
        };

        window.openClonedRepository = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                vscode.postMessage({
                    command: 'openClonedRepository',
                    exerciseId: ex.id
                });
                // Hide the notice after clicking
                const clonedNotice = document.getElementById('clonedRepoNotice');
                if (clonedNotice) {
                    clonedNotice.style.display = 'none';
                }
                // Clear the flag from storage
                try {
                    const storageKey = 'recentlyCloned_' + ex.id;
                    localStorage.removeItem(storageKey);
                } catch (e) {
                    // Ignore storage errors
                }
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error opening cloned repository.' });
            }
        };

        window.copyCloneUrl = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];
                vscode.postMessage({
                    command: 'copyCloneUrl',
                    participationId: participation.id,
                    repositoryUri: participation.repositoryUri,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error preparing copy clone URL operation.' });
            }
        };

        window.openAutoSaveSettings = function() {
            vscode.postMessage({
                command: 'openSettings',
                settingId: 'files.autoSave'
            });
        };

        window.pullChanges = function() {
            try {
                const ex = exerciseData.exercise || exerciseData;
                vscode.postMessage({
                    command: 'pullChanges',
                    exerciseId: ex.id,
                    exerciseTitle: ex.title
                });
            } catch (e) {
                vscode.postMessage({ command: 'alert', text: 'Error pulling changes from remote.' });
            }
        };

        function dispatchSubmission(commitMessage) {
            const submitBtn = document.getElementById('submitBtn');
            const uploadBtn = document.getElementById('uploadMessageBtn');

            const isSubmitDisabled = submitBtn ? submitBtn.disabled : false;
            const isUploadDisabled = uploadBtn ? uploadBtn.disabled : false;
            if (isSubmitDisabled || isUploadDisabled) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected to submit.' });
                return;
            }

            try {
                const ex = exerciseData.exercise || exerciseData;
                const participations = ex.studentParticipations || [];
                if (!participations.length) {
                    vscode.postMessage({ command: 'alert', text: 'No participation found. Start the exercise first.' });
                    return;
                }
                const participation = participations[0];

                setSubmitLoading(true);
                vscode.postMessage({
                    command: 'submitExercise',
                    participationId: participation.id,
                    exerciseId: ex.id,
                    exerciseTitle: ex.title,
                    commitMessage: commitMessage
                });
            } catch (e) {
                setSubmitLoading(false);
                vscode.postMessage({ command: 'alert', text: 'Error preparing submit operation.' });
            }
        }

        window.submitExercise = function() {
            const commitInput = document.getElementById('commitMessageInput');
            const commitContainer = document.getElementById('commitMessageContainer');
            const commitMessage = commitContainer && commitContainer.style.display !== 'none'
                ? (commitInput?.value.trim() || undefined)
                : undefined;
            dispatchSubmission(commitMessage);
        };

        window.toggleCommitMessageInput = function() {
            const uploadBtn = document.getElementById('uploadMessageBtn');
            const inputContainer = document.getElementById('commitMessageContainer');
            const input = document.getElementById('commitMessageInput');

            if (!uploadBtn || !inputContainer || !input) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected.' });
                return;
            }

            if (uploadBtn.disabled) {
                vscode.postMessage({ command: 'alert', text: 'No local changes detected to submit.' });
                return;
            }
            
            if (inputContainer.style.display === 'none') {
                // First click: Show input field
                inputContainer.style.display = 'block';
                input.focus();
                uploadBtn.title = 'Enter a commit message and click again to submit';
            } else {
                // Second click: Try submitting with the custom message
                const message = input.value.trim();
                if (message) {
                    dispatchSubmission(message);
                } else {
                    vscode.postMessage({ command: 'alert', text: 'Please enter a commit message.' });
                }
            }
        };

        // Fullscreen toggle functionality
        window.toggleFullscreen = function() {
            vscode.postMessage({ command: 'toggleFullscreen' });
        };

        // WebSocket real-time update handlers
        function handleNewResult(result) {
            console.log('\u{1F4CA} Received new result from WebSocket:', result);

            // Update exerciseData with the new result
            if (result && window.exerciseData) {
                const ex = window.exerciseData.exercise || window.exerciseData;
                const participations = ex.studentParticipations || [];
                
                if (participations.length > 0) {
                    const participation = participations[0];
                    const submissions = participation.submissions || [];
                    
                    if (submissions.length > 0) {
                        // Find the submission this result belongs to
                        let targetSubmission = null;
                        
                        // If result has a submission reference, find it by ID
                        if (result.submission && result.submission.id) {
                            targetSubmission = submissions.find(s => s.id === result.submission.id);
                        }
                        
                        // If not found or no submission reference, use the latest submission
                        if (!targetSubmission) {
                            targetSubmission = submissions.reduce((latest, current) => {
                                const latestDate = new Date(latest.submissionDate);
                                const currentDate = new Date(current.submissionDate);
                                return currentDate > latestDate ? current : latest;
                            });
                        }
                        
                        if (targetSubmission) {
                            // Initialize results array if it doesn't exist
                            if (!targetSubmission.results) {
                                targetSubmission.results = [];
                            }
                            
                            // Check if this result already exists (by ID)
                            const existingIndex = targetSubmission.results.findIndex(r => r.id === result.id);
                            
                            if (existingIndex >= 0) {
                                // Update existing result
                                targetSubmission.results[existingIndex] = result;
                            } else {
                                // Add new result
                                targetSubmission.results.push(result);
                            }
                            
                            console.log('\u2705 Updated exerciseData with new result. Submission results:', targetSubmission.results.length);
                        }
                    }
                }
            }

            const scorePercentage = result.score !== undefined && result.score !== null ? result.score : 0;
            const successful = result.successful === true;
            const maxPoints = window.exerciseData?.maxPoints || 1;
            const scorePoints = Math.round((scorePercentage / 100) * maxPoints * 100) / 100;

            const totalTests = result.testCaseCount || 0;
            const passedTests = result.passedTestCaseCount || 0;
            const hasTestInfo = totalTests > 0;
            const buildFailed = result.submission?.buildFailed || false;

            const buildStatusSection = ensureBuildStatusSection();
            if (buildStatusSection) {
                buildStatusSection.classList.remove('build-status--empty');
                delete buildStatusSection.dataset.progressMode;

                const statusBadge = generateStatusBadge(buildFailed, hasTestInfo, passedTests, totalTests, successful);

                const testResultsToggle = hasTestInfo ?
                    '<div class="test-results-toggle-container">' +
                        '<a href="#" class="test-results-toggle" onclick="toggleTestResults(event)" id="testResultsToggle">' +
                            'See test results' +
                        '<' + '/a>' +
                    '<' + '/div>' +
                    '<div class="test-results-modal" id="testResultsModal" aria-hidden="true" onclick="handleTestResultsBackdrop(event)">' +
                        '<div class="test-results-modal-content">' +
                            '<div class="test-results-modal-header">' +
                                '<div class="test-results-modal-title">Test Results<' + '/div>' +
                                '<button class="test-results-modal-close" onclick="closeTestResultsModal()" aria-label="Close test results">&times;<' + '/button>' +
                            '<' + '/div>' +
                            '<div class="test-results-modal-body">' +
                                '<div class="test-results-container" id="testResultsContainer">' +
                                    '<div class="test-results-loading">Loading test results...<' + '/div>' +
                                '<' + '/div>' +
                            '<' + '/div>' +
                        '<' + '/div>' +
                    '<' + '/div>' : '';

                const resultHtml =
                    '<div class="build-status-title">Latest Build Status<' + '/div>' +
                    '<div class="build-status-info">' +
                        statusBadge +
                        '<div class="score-info">' +
                            'Score: <span class="score-points">' + scorePoints + '/' + maxPoints + ' (' + scorePercentage.toFixed(2) + '%)<' + '/span> ' + (maxPoints === 1 ? 'point' : 'points') +
                        '<' + '/div>' +
                    '<' + '/div>' +
                    testResultsToggle;

                buildStatusSection.innerHTML = resultHtml;
            }

            setSubmitLoading(false);

            if (window.buildProgressInterval) {
                clearInterval(window.buildProgressInterval);
                window.buildProgressInterval = null;
            }

            checkRepositoryStatus();
        }

        function handleNewSubmission(submission) {
            console.log('\u{1F4E4} Received new submission from WebSocket:', submission);
            setSubmitLoading(true);
            
            // Update exerciseData with the new submission
            if (submission && window.exerciseData) {
                const ex = window.exerciseData.exercise || window.exerciseData;
                const participations = ex.studentParticipations || [];
                
                if (participations.length > 0) {
                    const participation = participations[0];
                    
                    // Initialize submissions array if it doesn't exist
                    if (!participation.submissions) {
                        participation.submissions = [];
                    }
                    
                    // Check if this submission already exists (by ID)
                    const existingIndex = participation.submissions.findIndex(s => s.id === submission.id);
                    
                    if (existingIndex >= 0) {
                        // Update existing submission
                        participation.submissions[existingIndex] = submission;
                    } else {
                        // Add new submission
                        participation.submissions.push(submission);
                    }
                    
                    console.log('\u2705 Updated exerciseData with new submission. Total submissions:', participation.submissions.length);
                }
            }
            
            const buildStatusSection = ensureBuildStatusSection();
            renderBuildProgress(buildStatusSection, '\u{1F504} Submission received, queuing build...', 5, true);
        }

        function handleSubmissionProcessing(state, buildTimingInfo) {
            console.log('\u2699\uFE0F Received submission processing update:', state, buildTimingInfo);
            
            let message = '';
            let progressPercent = 0;
            let isIndeterminate = false;
            let isBuilding = false;
            
            switch (state) {
                case 'BUILDING':
                    message = 'Building your submission...';
                    isBuilding = true;
                    if (buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate) {
                        const eta = new Date(buildTimingInfo.estimatedCompletionDate);
                        const startDate = new Date(buildTimingInfo.buildStartDate);
                        const now = new Date();
                        const totalTime = eta - startDate;
                        const elapsed = now - startDate;
                        progressPercent = Math.min(100, Math.max(0, (elapsed / totalTime) * 100));
                        
                        const seconds = Math.max(0, Math.floor((eta - now) / 1000));
                        if (seconds > 0) {
                            message = 'Building your submission... (ETA: ' + seconds + 's)';
                        }
                    }
                    isIndeterminate = !buildTimingInfo || !buildTimingInfo.estimatedCompletionDate || !buildTimingInfo.buildStartDate;
                    break;
                case 'QUEUED':
                    message = '\u23F3 Build queued, waiting for resources...';
                    isBuilding = true;
                    progressPercent = 5;
                    isIndeterminate = true;
                    break;
            }
            
            if (isBuilding) {
                updateBuildStatusWithProgress(message, progressPercent, buildTimingInfo, isIndeterminate);
                setSubmitLoading(true);
            }
        }
        
        function updateBuildStatusWithProgress(message, progressPercent, buildTimingInfo, isIndeterminate = false) {
            const buildStatusSection = ensureBuildStatusSection();
            if (!buildStatusSection) return;
            renderBuildProgress(buildStatusSection, message, progressPercent, isIndeterminate);
            
            // Update progress bar periodically
            if (buildTimingInfo?.estimatedCompletionDate && buildTimingInfo?.buildStartDate) {
                if (window.buildProgressInterval) {
                    clearInterval(window.buildProgressInterval);
                }
                
                window.buildProgressInterval = setInterval(() => {
                    const eta = new Date(buildTimingInfo.estimatedCompletionDate);
                    const startDate = new Date(buildTimingInfo.buildStartDate);
                    const now = new Date();
                    const totalTime = eta - startDate;
                    const elapsed = now - startDate;
                    const percent = Math.min(100, Math.max(5, (elapsed / totalTime) * 100));
                    
                    const progressBar = document.querySelector('.build-progress-bar');
                    const messageEl = buildStatusSection.querySelector('.build-status-message');
                    
                    if (progressBar) {
                        // If past ETA, switch to indeterminate progress bar
                        if (now >= eta) {
                            progressBar.style.width = '100%';
                            progressBar.classList.add('indeterminate');
                        } else {
                            progressBar.style.width = percent + '%';
                            progressBar.classList.remove('indeterminate');
                        }
                    }
                    
                    // Update ETA message
                    const seconds = Math.max(0, Math.floor((eta - now) / 1000));
                    if (messageEl) {
                        if (seconds > 0) {
                            messageEl.textContent = 'Building your submission... (ETA: ' + seconds + 's)';
                        } else {
                            // After ETA expires, show indefinite loading message
                            messageEl.textContent = 'Building your submission...';
                        }
                    }
                }, 500); // Update every 500ms
            }
        }
    </script>
</body>
</html>`;
  }
};

// src/views/components/serviceHealthComponent.ts
var ServiceHealthComponent = class {
  /**
   * Generate the HTML for the service health component
   * @param options Configuration options for the component
   * @returns HTML string for the health check component
   */
  static generateHtml(options = {}) {
    const {
      showTitle = true,
      compact = false,
      autoCheck = false
    } = options;
    const refreshIcon = IconDefinitions.getIcon("refresh");
    const titleSection = showTitle ? `
            <h3 class="health-checks-title">
                \u{1F50D} Service Health Checks
            </h3>
        ` : "";
    const compactClass = compact ? "health-compact" : "";
    return `
        <div class="service-health-component ${compactClass}" data-auto-check="${autoCheck}">
            ${titleSection}
            
            <div class="health-status-item" data-service="serverReachability">
                <div class="health-status-main">
                    <span class="health-label">Server Reachability</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-serverReachability"></span>
                        <span id="health-serverReachabilityText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-serverReachability">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-serverReachability">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-serverReachability">-</span><br>
                        <strong>Response:</strong> <span id="response-serverReachability">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="authService">
                <div class="health-status-main">
                    <span class="health-label">Authentication Service</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-authService"></span>
                        <span id="health-authServiceText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-authService">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-authService">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-authService">-</span><br>
                        <strong>Response:</strong> <span id="response-authService">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="apiAvailability">
                <div class="health-status-main">
                    <span class="health-label">API Availability</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-apiAvailability"></span>
                        <span id="health-apiAvailabilityText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-apiAvailability">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-apiAvailability">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-apiAvailability">-</span><br>
                        <strong>Response:</strong> <span id="response-apiAvailability">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="websocket">
                <div class="health-status-main">
                    <span class="health-label">WebSocket Connection</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-websocket"></span>
                        <span id="health-websocketText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-websocket">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-websocket">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-websocket">-</span><br>
                        <strong>Response:</strong> <span id="response-websocket">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-status-item" data-service="irisService">
                <div class="health-status-main">
                    <span class="health-label">Iris AI Service</span>
                    <span class="health-value">
                        <span class="health-indicator unknown" id="health-irisService"></span>
                        <span id="health-irisServiceText">Not checked</span>
                    </span>
                </div>
                <div class="health-tooltip" id="tooltip-irisService">
                    <div class="tooltip-content">
                        <strong>Endpoint:</strong> <code id="endpoint-irisService">-</code><br>
                        <strong>HTTP Status:</strong> <span id="httpStatus-irisService">-</span><br>
                        <strong>Response:</strong> <span id="response-irisService">-</span>
                    </div>
                </div>
            </div>
            
            <div class="health-last-check" id="health-lastCheckTime">Last checked: Never</div>
            
            <button class="health-check-btn" id="health-checkBtn">
                <span class="health-btn-icon">${refreshIcon}</span>
                Check Status
            </button>
        </div>`;
  }
  /**
   * Generate the JavaScript code for the service health component
   * This handles the health check logic and UI updates
   * @returns JavaScript code as a string
   */
  static generateScript() {
    return `
        // Service Health Component Script
        (function() {
            const healthComponent = document.querySelector('.service-health-component');
            if (!healthComponent) return;
            
            const autoCheck = healthComponent.dataset.autoCheck === 'true';
            const checkBtn = document.getElementById('health-checkBtn');
            
            // DOM element references
            const elements = {
                serverReachability: {
                    indicator: document.getElementById('health-serverReachability'),
                    text: document.getElementById('health-serverReachabilityText')
                },
                authService: {
                    indicator: document.getElementById('health-authService'),
                    text: document.getElementById('health-authServiceText')
                },
                apiAvailability: {
                    indicator: document.getElementById('health-apiAvailability'),
                    text: document.getElementById('health-apiAvailabilityText')
                },
                websocket: {
                    indicator: document.getElementById('health-websocket'),
                    text: document.getElementById('health-websocketText')
                },
                irisService: {
                    indicator: document.getElementById('health-irisService'),
                    text: document.getElementById('health-irisServiceText')
                },
                lastCheckTime: document.getElementById('health-lastCheckTime')
            };
            
            // Helper function to update status indicators
            function updateStatusIndicator(key, status, message) {
                const element = elements[key];
                if (element && element.indicator) {
                    element.indicator.className = 'health-indicator ' + status;
                }
                if (element && element.text) {
                    element.text.textContent = message;
                }
            }
            
            // Helper function to update tooltip information
            function updateTooltip(key, endpoint, httpStatus, response) {
                const endpointEl = document.getElementById('endpoint-' + key);
                const httpStatusEl = document.getElementById('httpStatus-' + key);
                const responseEl = document.getElementById('response-' + key);
                
                if (endpointEl) {
                    endpointEl.textContent = endpoint || '-';
                }
                if (httpStatusEl) {
                    httpStatusEl.textContent = httpStatus || '-';
                    // Color code the HTTP status
                    if (httpStatus) {
                        const statusCode = parseInt(httpStatus);
                        if (statusCode >= 200 && statusCode < 300) {
                            httpStatusEl.style.color = 'var(--theme-success)';
                        } else if (statusCode >= 400 && statusCode < 500) {
                            httpStatusEl.style.color = 'var(--theme-warning, #f59e0b)';
                        } else if (statusCode >= 500) {
                            httpStatusEl.style.color = 'var(--theme-error)';
                        }
                    }
                }
                if (responseEl) {
                    responseEl.textContent = response || '-';
                }
            }
            
            // Perform health checks
            function performHealthChecks() {
                // Get server URL from vscode configuration
                const serverUrl = document.getElementById('serverUrl')?.value || 
                                 document.querySelector('.server-url')?.textContent || 
                                 'https://artemis.tum.de';
                
                if (!serverUrl) {
                    Object.keys(elements).forEach(key => {
                        if (key !== 'lastCheckTime') {
                            updateStatusIndicator(key, 'unknown', 'No server URL');
                        }
                    });
                    return;
                }
                
                // Disable button during check
                if (checkBtn) {
                    checkBtn.disabled = true;
                    const btnText = checkBtn.querySelector('.health-btn-icon')?.nextSibling;
                    if (btnText) {
                        btnText.textContent = ' Checking...';
                    }
                }
                
                // Set all to checking state
                Object.keys(elements).forEach(key => {
                    if (key !== 'lastCheckTime') {
                        updateStatusIndicator(key, 'checking', 'Checking...');
                    }
                });
                
                // Request health checks from extension backend
                vscode.postMessage({ 
                    command: 'performHealthChecks',
                    serverUrl: serverUrl 
                });
            }
            
            // Handle health check results
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'healthCheckResults') {
                    const results = message.results;
                    
                    // Update each indicator with results and tooltip data
                    if (results.serverReachability) {
                        updateStatusIndicator(
                            'serverReachability',
                            results.serverReachability.status,
                            results.serverReachability.message
                        );
                        updateTooltip(
                            'serverReachability',
                            results.serverReachability.endpoint || 'Server Root (HEAD)',
                            results.serverReachability.httpStatus,
                            results.serverReachability.response || results.serverReachability.message
                        );
                    }
                    
                    if (results.authService) {
                        updateStatusIndicator(
                            'authService',
                            results.authService.status,
                            results.authService.message
                        );
                        updateTooltip(
                            'authService',
                            results.authService.endpoint || '/api/core/public/authenticate',
                            results.authService.httpStatus,
                            results.authService.response || results.authService.message
                        );
                    }
                    
                    if (results.apiAvailability) {
                        updateStatusIndicator(
                            'apiAvailability',
                            results.apiAvailability.status,
                            results.apiAvailability.message
                        );
                        updateTooltip(
                            'apiAvailability',
                            results.apiAvailability.endpoint || '/management/health',
                            results.apiAvailability.httpStatus,
                            results.apiAvailability.response || results.apiAvailability.message
                        );
                    }
                    
                    if (results.websocket) {
                        updateStatusIndicator(
                            'websocket',
                            results.websocket.status,
                            results.websocket.message
                        );
                        updateTooltip(
                            'websocket',
                            results.websocket.endpoint || '/websocket/tracker',
                            results.websocket.httpStatus || 'N/A',
                            results.websocket.response || results.websocket.message
                        );
                    }
                    
                    if (results.irisService) {
                        updateStatusIndicator(
                            'irisService',
                            results.irisService.status,
                            results.irisService.message
                        );
                        updateTooltip(
                            'irisService',
                            results.irisService.endpoint || '/api/iris/status',
                            results.irisService.httpStatus,
                            results.irisService.response || results.irisService.message
                        );
                    }
                    
                    // Update last check time
                    const now = new Date();
                    if (elements.lastCheckTime) {
                        elements.lastCheckTime.textContent = 'Last checked: ' + now.toLocaleTimeString();
                    }
                    
                    // Re-enable button
                    if (checkBtn) {
                        checkBtn.disabled = false;
                        const btnText = checkBtn.querySelector('.health-btn-icon')?.nextSibling;
                        if (btnText) {
                            btnText.textContent = ' Check Status';
                        }
                    }
                }
            });
            
            // Event listeners
            if (checkBtn) {
                checkBtn.addEventListener('click', performHealthChecks);
            }
            
            // Auto-check on load if enabled
            if (autoCheck) {
                setTimeout(performHealthChecks, 500);
            }
        })();`;
  }
};

// src/views/templates/loginView.ts
var LoginView = class {
  _themeManager;
  _styleManager;
  constructor(styleManager) {
    this._themeManager = new ThemeManager();
    this._styleManager = styleManager;
  }
  generateHtml() {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/login.css",
      "components/service-health.css"
    ]);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Artemis Login</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="header">
        <div class="logo">
            <h1>Artemis Login</h1>
            <p>VS Code Extension for the Artemis Learning Platform</p>
        </div>
    </div>

    <div id="loadingIndicator" class="loading-indicator">
        <div class="loading-spinner"></div>
        <div class="loading-content">
            <div class="loading-text">Checking authentication<span class="loading-dots"></span></div>
            <div class="loading-subtext">Please wait while we verify your credentials</div>
        </div>
    </div>

    <div class="login-container" id="loginSection">
        <form id="loginForm">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" placeholder="Enter your TUM username" required />
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="Enter your password" required />
            </div>
            <div class="checkbox-group">
                <input type="checkbox" id="rememberMe" name="rememberMe" checked />
                <label for="rememberMe">Remember me on this device</label>
            </div>
            <button type="submit" class="btn" id="loginButton">Login to Artemis</button>
            <div id="statusMessage" class="status"></div>
        </form>
        
        <!-- Server Health Status Component -->
        <div id="serverStatus" class="server-status">
            ${ServiceHealthComponent.generateHtml({ showTitle: true, compact: true, autoCheck: false })}
        </div>
        
        <div class="quick-links">
            <a class="quick-link" id="openWebsiteLink">Open Artemis in Browser \u2192</a>
            <a class="quick-link" id="openSettingsLink">Open Artemis Settings \u2192</a>
        </div>
    </div>

    <div class="login-container" id="loggedInSection" style="display: none;">
        <div class="logged-in">
            <h2>You're already logged in! \u2705</h2>
            <div class="user-info">
                <div>
                    <div class="label">Username</div>
                    <div class="value" id="loggedInUsername">-</div>
                </div>
                <div>
                    <div class="label">Server URL</div>
                    <div class="value" id="loggedInServerUrl">-</div>
                </div>
            </div>
            <button class="btn" id="viewDashboardButton">Go to Dashboard</button>
            <button class="logout-btn" id="openLogoutButton">Logout from Artemis</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const loginForm = document.getElementById('loginForm');
        const statusMessage = document.getElementById('statusMessage');
        const loginButton = document.getElementById('loginButton');
        const loginSection = document.getElementById('loginSection');
        const loggedInSection = document.getElementById('loggedInSection');
        const loginInputs = loginForm.querySelectorAll('input');
        const openWebsiteLink = document.getElementById('openWebsiteLink');
        const openSettingsLink = document.getElementById('openSettingsLink');
        const openLogoutButton = document.getElementById('openLogoutButton');
        const viewDashboardButton = document.getElementById('viewDashboardButton');
        const loggedInUsername = document.getElementById('loggedInUsername');
        const loggedInServerUrl = document.getElementById('loggedInServerUrl');
        const loadingIndicator = document.getElementById('loadingIndicator');
        const loadingText = document.querySelector('.loading-text');
        const loadingSubtext = document.querySelector('.loading-subtext');
        
        // Server status elements
        const serverStatus = document.getElementById('serverStatus');
        const recheckServerBtn = document.getElementById('recheckServerBtn');
        const serverReachabilityIndicator = document.getElementById('serverReachabilityIndicator');
        const serverReachabilityText = document.getElementById('serverReachabilityText');
        const authServiceIndicator = document.getElementById('authServiceIndicator');
        const authServiceText = document.getElementById('authServiceText');
        const apiAvailabilityIndicator = document.getElementById('apiAvailabilityIndicator');
        const apiAvailabilityText = document.getElementById('apiAvailabilityText');

        const loadingMessages = {
            'Initializing...': 'Setting up your Artemis workspace',
            'Checking stored credentials...': 'Looking for saved authentication data',
            'Validating authentication...': 'Verifying your login credentials',
            'Loading user information...': 'Fetching your profile and preferences',
            'Connecting to Artemis...': 'Establishing secure connection'
        };

        function showLoadingIndicator(message = 'Checking authentication...') {
            if (loadingText) {
                loadingText.innerHTML = message.replace(/...$/, '') + '<span class="loading-dots"></span>';
            }
            if (loadingSubtext) {
                loadingSubtext.textContent = loadingMessages[message] || 'Please wait while we process your request';
            }
            if (loadingIndicator) {
                loadingIndicator.classList.add('show');
            }
        }

        function hideLoadingIndicator() {
            if (loadingIndicator && loadingIndicator.classList.contains('show')) {
                loadingIndicator.classList.add('hide');
                setTimeout(() => {
                    loadingIndicator.classList.remove('show', 'hide');
                }, 300);
            }
        }

        function updateLoadingMessage(message) {
            if (loadingText) {
                loadingText.innerHTML = message.replace(/...$/, '') + '<span class="loading-dots"></span>';
            }
            if (loadingSubtext) {
                loadingSubtext.textContent = loadingMessages[message] || 'Please wait while we process your request';
            }
        }

        // Server Status Checking Functions
        function getArtemisServerUrl() {
            // Try to get server URL from VS Code configuration
            // This will be set by the extension when the page loads
            return window.artemisServerUrl || 'https://artemis.tum.de';
        }

        function updateStatusIndicator(indicator, text, status, message) {
            if (indicator) {
                indicator.className = \`status-indicator \${status}\`;
            }
            if (text) {
                text.textContent = message;
            }
        }

        async function checkServerReachability(serverUrl) {
            try {
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'checking', 'Checking...');
                
                // First try a simple fetch to see if the server responds
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const response = await fetch(serverUrl, {
                    method: 'HEAD',
                    signal: controller.signal,
                    mode: 'no-cors' // This allows us to check reachability even with CORS issues
                });
                
                clearTimeout(timeoutId);
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'online', 'Reachable');
                return true;
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'offline', 'Unreachable');
                }
                return false;
            }
        }

        async function checkAuthenticationService(serverUrl) {
            try {
                updateStatusIndicator(authServiceIndicator, authServiceText, 'checking', 'Checking...');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                
                // Try to access the authentication endpoint
                const response = await fetch(\`\${serverUrl}/api/core/public/authenticate\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        username: '',
                        password: '',
                        rememberMe: false
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                // Even if auth fails (400/401), if we get a response, the service is available
                if (response.status === 400 || response.status === 401) {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'online', 'Available');
                    return true;
                } else if (response.status === 200) {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'online', 'Available');
                    return true;
                } else {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', \`Error \${response.status}\`);
                    return false;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(authServiceIndicator, authServiceText, 'offline', 'Unavailable');
                }
                return false;
            }
        }

        async function checkApiAvailability(serverUrl) {
            try {
                updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'checking', 'Checking...');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
                
                // Try to access a public API endpoint
                const response = await fetch(\`\${serverUrl}/api/core/public/health\`, {
                    method: 'GET',
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'online', 'Available');
                    return true;
                } else {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', \`Error \${response.status}\`);
                    return false;
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', 'Timeout');
                } else {
                    updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'offline', 'Unavailable');
                }
                return false;
            }
        }

        async function performServerStatusCheck() {
            const serverUrl = getArtemisServerUrl();
            
            if (!serverUrl) {
                updateStatusIndicator(serverReachabilityIndicator, serverReachabilityText, 'unknown', 'No server URL');
                updateStatusIndicator(authServiceIndicator, authServiceText, 'unknown', 'No server URL');
                updateStatusIndicator(apiAvailabilityIndicator, apiAvailabilityText, 'unknown', 'No server URL');
                return;
            }

            // Show the server status section
            if (serverStatus) {
                serverStatus.classList.add('show');
            }

            // Disable recheck button during check
            if (recheckServerBtn) {
                recheckServerBtn.disabled = true;
                recheckServerBtn.textContent = 'Checking...';
            }

            // Run all checks in parallel
            await Promise.all([
                checkServerReachability(serverUrl),
                checkAuthenticationService(serverUrl),
                checkApiAvailability(serverUrl)
            ]);

            // Re-enable recheck button
            if (recheckServerBtn) {
                recheckServerBtn.disabled = false;
                recheckServerBtn.textContent = 'Recheck Server Status';
            }
        }

        function showServerStatus() {
            performServerStatusCheck();
        }

        function hideServerStatus() {
            if (serverStatus) {
                serverStatus.classList.remove('show');
            }
        }

        // Event listener for recheck button
        if (recheckServerBtn) {
            recheckServerBtn.addEventListener('click', () => {
                performServerStatusCheck();
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'showLoading':
                    showLoadingIndicator(message.message || 'Checking authentication...');
                    break;
                case 'hideLoading':
                    hideLoadingIndicator();
                    break;
                case 'updateLoading':
                    updateLoadingMessage(message.message || 'Processing...');
                    break;
                case 'loginSuccess':
                    hideLoadingIndicator();
                    setStatus('success', \`Successfully logged in as \${message.username}\`);
                    hideServerStatus();
                    break;
                case 'loginError':
                    hideLoadingIndicator();
                    setStatus('error', message.error || 'Login failed. Please try again.');
                    enableInputs();
                    // Show server status check after login error
                    showServerStatus();
                    break;
                case 'logoutSuccess':
                    hideLoadingIndicator();
                    showLoginForm();
                    setStatus('info', 'You have been logged out.');
                    enableInputs();
                    break;
                case 'showLoggedIn':
                    hideLoadingIndicator();
                    showLoggedInState(message.userInfo);
                    hideServerStatus();
                    break;
                case 'setServerUrl':
                    // Store the server URL for status checking
                    window.artemisServerUrl = message.serverUrl;
                    break;
            }
        });

        loginForm.addEventListener('submit', event => {
            event.preventDefault();
            const username = loginForm.username.value.trim();
            const password = loginForm.password.value;
            const rememberMe = loginForm.rememberMe.checked;

            if (!username || !password) {
                setStatus('error', 'Please enter both username and password.');
                return;
            }

            setStatus('info', 'Logging in to Artemis...');
            disableInputs();

            vscode.postMessage({
                command: 'login',
                username,
                password,
                rememberMe
            });
        });

        if (openWebsiteLink) {
            openWebsiteLink.addEventListener('click', () => {
                vscode.postMessage({ command: 'openWebsite' });
            });
        }

        if (openSettingsLink) {
            openSettingsLink.addEventListener('click', () => {
                vscode.postMessage({ command: 'openSettings' });
            });
        }

        if (openLogoutButton) {
            openLogoutButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'logout' });
            });
        }

        if (viewDashboardButton) {
            viewDashboardButton.addEventListener('click', () => {
                vscode.postMessage({ command: 'browseCourses' });
            });
        }

        function disableInputs() {
            loginInputs.forEach(input => input.disabled = true);
            loginButton.disabled = true;
        }

        function enableInputs() {
            loginInputs.forEach(input => input.disabled = false);
            loginButton.disabled = false;
        }

        function setStatus(type, message) {
            statusMessage.className = \`status \${type}\`;
            statusMessage.textContent = message;
            statusMessage.style.display = 'block';
        }

        function showLoggedInState(userInfo) {
            loginSection.style.display = 'none';
            loggedInSection.style.display = 'block';
            loggedInUsername.textContent = userInfo?.username || 'Unknown';
            loggedInServerUrl.textContent = userInfo?.serverUrl || 'Unknown';
        }

        function showLoginForm() {
            loginSection.style.display = 'block';
            loggedInSection.style.display = 'none';
            hideServerStatus();
        }

        // No need to show loading indicator by default - it will be shown only during auto-login
        
        // Initialize Service Health Component
        ${ServiceHealthComponent.generateScript()}
    </script>
</body>
</html>`;
  }
};

// src/views/templates/serviceStatusView.ts
var ServiceStatusView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  generateHtml(serverUrl, webview) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/service-status.css",
      "components/service-health.css"
    ]);
    return this._getServiceStatusHtml(themeCSS, currentTheme, styles, serverUrl);
  }
  _getServiceStatusHtml(themeCSS, currentTheme, styles, serverUrl) {
    const stethoscopeIcon = IconDefinitions.getIcon("stethoscope");
    const refreshIcon = IconDefinitions.getIcon("refresh");
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Service Status</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="service-status-container">
        <div class="back-link-container">
            <div class="back-link" onclick="backToDashboard()">\u2190 Back to Dashboard</div>
        </div>
        
        <div class="header">
            <h1 class="header-title">
                <span class="header-icon">${stethoscopeIcon}</span>
                Service Status
            </h1>
            <p class="header-subtitle">Real-time monitoring of Artemis services</p>
        </div>
        
        <div class="server-info">
            <h3 class="server-info-title">Connected Server</h3>
            <div class="server-url" id="serverUrl">${serverUrl || "https://artemis.tum.de"}</div>
        </div>
        
        ${ServiceHealthComponent.generateHtml({ showTitle: true, compact: false, autoCheck: true })}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Initialize Service Health Component
        ${ServiceHealthComponent.generateScript()}
        
        // Back to dashboard handler
        window.backToDashboard = function() {
            vscode.postMessage({ command: 'backToDashboard' });
        };
    </script>
</body>
</html>`;
  }
};

// src/views/templates/recommendedExtensionsView.ts
var RecommendedExtensionsView = class {
  _themeManager;
  _styleManager;
  constructor(styleManager) {
    this._themeManager = new ThemeManager();
    this._styleManager = styleManager;
  }
  generateHtml(categories = []) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/recommended-extensions.css"
    ]);
    const hasCategories = Array.isArray(categories) && categories.length > 0;
    const categorySections = hasCategories ? categories.map((category) => this._renderCategory(category)).join("") : this._renderEmptyState();
    const filterControls = hasCategories ? this._renderFilterControls(categories) : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recommended Extensions</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="recommended-container">
        <div class="back-link-container">
            <div class="back-link" id="backToDashboardLink">\u2190 Back to Dashboard</div>
        </div>
        <div class="view-header">
            <h1 class="view-title">Recommended Extensions</h1>
            <p class="view-subtitle">Improve your Artemis workflow with curated VS Code extensions.</p>
        </div>
        ${filterControls}
        ${categorySections}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        const backLink = document.getElementById('backToDashboardLink');
        if (backLink) {
            backLink.addEventListener('click', () => {
                vscode.postMessage({ command: 'backToDashboard' });
            });
        }

        document.querySelectorAll('.marketplace-button').forEach(button => {
            button.addEventListener('click', event => {
                const extensionId = event.currentTarget.getAttribute('data-extension-id');
                if (extensionId) {
                    vscode.postMessage({ command: 'searchMarketplace', extensionId });
                }
            });
        });

        const filterButtons = Array.from(document.querySelectorAll('.filter-button'));
        if (filterButtons.length > 0) {
            const categorySections = Array.from(document.querySelectorAll('.category-section'));

            const applyFilter = (categoryId) => {
                categorySections.forEach(section => {
                    const sectionId = section.getAttribute('data-category-id');
                    const shouldShow = categoryId === 'all' || categoryId === sectionId;
                    section.style.display = shouldShow ? '' : 'none';
                });
            };

            filterButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const selectedCategory = button.getAttribute('data-category');
                    filterButtons.forEach(btn => btn.classList.toggle('active', btn === button));
                    applyFilter(selectedCategory || 'all');
                });
            });
        }
    </script>
</body>
</html>`;
  }
  _renderCategory(category) {
    const extensionsHtml = category.extensions.map((extension) => this._renderExtensionCard(extension)).join("");
    return `
        <section class="category-section" data-category-id="${category.id}">
            <header class="category-header">
                <h2 class="category-name">${category.name}</h2>
                <p class="category-description">${category.description}</p>
            </header>
            <div class="extensions-grid">
                ${extensionsHtml}
            </div>
        </section>`;
  }
  _renderExtensionCard(extension) {
    const isInstalled = extension.isInstalled === true;
    const optionalPill = extension.optional ? `<span class="optional-pill">Optional</span>` : "";
    const statusPill = `<span class="status-pill ${isInstalled ? "installed" : "missing"}">${isInstalled ? "Installed" : "Not installed"}</span>`;
    const publisherLine = extension.version ? `${extension.publisher} \u2022 v${extension.version}` : extension.publisher;
    return `
                <article class="extension-card" data-extension-id="${extension.id}" data-installed="${isInstalled}">
                    <div class="extension-header">
                        <div class="extension-header-details">
                            <h3 class="extension-name">${extension.name}</h3>
                            <p class="extension-publisher">${publisherLine}</p>
                        </div>
                        <div class="extension-pill-group">
                            ${statusPill}
                            ${optionalPill}
                        </div>
                    </div>
                    <p class="extension-description">${extension.description}</p>
                    <div class="extension-reason-block">
                        <div class="extension-reason-label">Why we recommend it</div>
                        <p class="extension-reason">${extension.reason}</p>
                    </div>
                    <button class="marketplace-button" data-extension-id="${extension.id}">View in Marketplace</button>
                </article>`;
  }
  _renderFilterControls(categories) {
    const categoryButtons = categories.map((category) => `
                <button class="filter-button" data-category="${category.id}">
                    ${category.name}
                </button>
        `).join("");
    return `
        <div class="filter-bar">
            <div class="filter-label">Filter</div>
            <div class="filter-controls">
                <button class="filter-button active" data-category="all">All categories</button>
                ${categoryButtons}
            </div>
        </div>`;
  }
  _renderEmptyState() {
    return `<div class="empty-state">
            No recommended extensions available right now. Check back soon!
        </div>`;
  }
};

// src/views/app/viewRouter.ts
var ViewRouter = class {
  constructor(_appStateManager, _extensionContext, _webview) {
    this._appStateManager = _appStateManager;
    this._extensionContext = _extensionContext;
    this._webview = _webview;
    this._styleManager = new StyleManager(this._extensionContext.extensionUri);
    this._loginView = new LoginView(this._styleManager);
    this._dashboardView = new DashboardView(this._extensionContext, this._styleManager);
    this._courseListView = new CourseListView(this._styleManager);
    this._courseDetailView = new CourseDetailView(this._extensionContext, this._styleManager);
    this._exerciseDetailView = new ExerciseDetailView(this._extensionContext, this._styleManager);
    this._aiCheckerView = new AiCheckerView(this._extensionContext, this._styleManager);
    this._serviceStatusView = new ServiceStatusView(this._extensionContext, this._styleManager);
    this._recommendedExtensionsView = new RecommendedExtensionsView(this._styleManager);
  }
  _loginView;
  _styleManager;
  _dashboardView;
  _courseListView;
  _courseDetailView;
  _exerciseDetailView;
  _aiCheckerView;
  _serviceStatusView;
  _recommendedExtensionsView;
  getHtml() {
    const webview = this._webview;
    if (!webview) {
      throw new Error("Webview is not initialized");
    }
    const state = this._appStateManager.currentState;
    const config = vscode4.workspace.getConfiguration("artemis");
    const hideDeveloperTools = config.get("hideDeveloperTools", false);
    switch (state) {
      case "dashboard": {
        const userInfo = this._appStateManager.userInfo;
        if (userInfo) {
          return this._dashboardView.generateHtml(userInfo, this._appStateManager.coursesData, webview);
        }
        break;
      }
      case "course-list":
        return this._courseListView.generateHtml(
          this._appStateManager.coursesData,
          this._appStateManager.archivedCoursesData
        );
      case "course-detail":
        return this._courseDetailView.generateHtml(this._appStateManager.currentCourseData, hideDeveloperTools, webview);
      case "exercise-detail":
        return this._exerciseDetailView.generateHtml(this._appStateManager.currentExerciseData, hideDeveloperTools);
      case "ai-config":
        return this._aiCheckerView.generateHtml(this._appStateManager.aiExtensions || []);
      case "service-status": {
        const serverUrl = this._appStateManager.userInfo?.serverUrl;
        return this._serviceStatusView.generateHtml(serverUrl, webview);
      }
      case "recommended-extensions": {
        const categories = this._appStateManager.recommendedExtensions || [];
        return this._recommendedExtensionsView.generateHtml(categories);
      }
      case "login":
      default:
        break;
    }
    return this._loginView.generateHtml();
  }
};

// src/views/app/viewActionService.ts
var vscode5 = __toESM(require("vscode"));
var ViewActionService = class {
  constructor(_appStateManager) {
    this._appStateManager = _appStateManager;
  }
  async openJsonInEditor(data) {
    try {
      const jsonContent = JSON.stringify(data, null, 2);
      const document = await vscode5.workspace.openTextDocument({
        content: jsonContent,
        language: "json"
      });
      await vscode5.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode5.ViewColumn.One
      });
    } catch (error) {
      console.error("Error opening JSON in editor:", error);
      vscode5.window.showErrorMessage("Failed to open JSON in editor");
    }
  }
  /**
   * Returns true when the exercise view was updated and the caller should re-render.
   */
  async openExerciseDetails(exerciseId) {
    try {
      await this._appStateManager.showExerciseDetail(exerciseId);
      return true;
    } catch (error) {
      console.error("Error fetching exercise details:", error);
      vscode5.window.showErrorMessage("Failed to fetch exercise details");
      return false;
    }
  }
};

// src/views/app/webViewMessageHandler.ts
var vscode13 = __toESM(require("vscode"));

// src/views/app/commands/authCommands.ts
var vscode6 = __toESM(require("vscode"));
var AuthCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      login: this.handleLogin,
      logout: this.handleLogout
    };
  }
  handleLogin = async (message) => {
    const username = message.username;
    const password = message.password;
    const rememberMe = message.rememberMe || false;
    const config = vscode6.workspace.getConfiguration("artemis");
    const serverUrl = config.get("serverUrl", "https://artemis.tum.de");
    try {
      await this.context.artemisApi.authenticate(username, password, rememberMe);
      const user = await this.context.artemisApi.getCurrentUser();
      await this.context.updateAuthContext(true);
      vscode6.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || username}`);
      await this.context.actionHandler.showDashboard({
        username: user.login || username,
        serverUrl,
        user
      });
    } catch (error) {
      console.error("Login error:", error);
      const friendlyError = this.formatLoginError(error);
      vscode6.window.showErrorMessage(friendlyError);
      this.context.sendMessage({
        command: "loginError",
        error: friendlyError
      });
    }
  };
  handleLogout = async () => {
    try {
      await this.context.authManager.clear();
      await this.context.updateAuthContext(false);
      vscode6.window.showInformationMessage("Successfully logged out of Artemis");
      this.context.appStateManager.showLogin();
      this.context.actionHandler.render();
    } catch (error) {
      console.error("Logout error:", error);
      vscode6.window.showErrorMessage("Error during logout");
    }
  };
  formatLoginError(error) {
    const defaultMessage = "Login failed: An unexpected error occurred. Please try again.";
    if (!(error instanceof Error)) {
      return defaultMessage;
    }
    const rawMessage = (error.message || "").trim();
    if (!rawMessage) {
      return defaultMessage;
    }
    const normalized = rawMessage.replace(/^login failed[:]?\s*/i, "").trim();
    if (!normalized) {
      return defaultMessage;
    }
    if (/invalid username or password/i.test(normalized) || /method argument not valid/i.test(normalized) || /\b400\b/.test(normalized) || /\b401\b/.test(normalized)) {
      return "Login failed: Invalid username or password. Please verify your credentials and try again.";
    }
    if (/not activated/i.test(normalized) || /forbidden/i.test(normalized) || /\b403\b/.test(normalized)) {
      return "Login failed: Your account is not activated or access is forbidden.";
    }
    if (/failed to fetch/i.test(normalized) || /enotfound/i.test(normalized) || /econnrefused/i.test(normalized)) {
      return "Login failed: Could not reach the Artemis server. Check your network connection or server URL.";
    }
    return `Login failed: ${normalized}`;
  }
};

// src/views/app/commands/navigationCommands.ts
var vscode8 = __toESM(require("vscode"));

// src/views/provider/chatWebviewProvider.ts
var vscode7 = __toESM(require("vscode"));

// src/views/templates/irisChatView.ts
var IrisChatView = class {
  _themeManager;
  _extensionContext;
  _styleManager;
  constructor(extensionContext, styleManager) {
    this._themeManager = new ThemeManager();
    this._extensionContext = extensionContext;
    this._styleManager = styleManager;
  }
  generateHtml(webview, showDiagnostics = false) {
    const themeCSS = this._themeManager.getThemeCSS();
    const currentTheme = this._themeManager.getCurrentTheme();
    const styles = this._styleManager.getStyles(currentTheme, [
      "views/iris-chat.css"
    ]);
    const exerciseIcon = IconDefinitions.getIcon("exercise");
    const courseIcon = IconDefinitions.getIcon("course");
    const refreshIcon = IconDefinitions.getIcon("refresh");
    const trashIcon = IconDefinitions.getIcon("trash");
    const stethoscopeIcon = IconDefinitions.getIcon("stethoscope");
    const starIcon = IconDefinitions.getIcon("star");
    const cursorIcon = IconDefinitions.getIcon("cursor");
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat with Iris</title>
    <style>
        ${styles}
        ${themeCSS}
    </style>

</head>
<body class="theme-${currentTheme}">
    <div class="coming-soon-overlay">
        <div class="coming-soon-content">
            <div class="coming-soon-icon">\u{1F680}</div>
            <h1 class="coming-soon-title">Iris Chat - Coming Soon!</h1>
            <p class="coming-soon-message">
                This feature is currently under development and will be available in a future update.
            </p>
            <p class="coming-soon-submessage">
                Iris will provide AI-powered assistance for your programming exercises and courses.
            </p>
        </div>
    </div>
    
    <div class="chat-container" style="display: none;">
        <div class="chat-header">
            <h1 class="chat-title">Chat with Iris</h1>
            <button class="burger-menu" onclick="toggleSideMenu()" title="Menu">
                <div class="burger-icon">
                    <div class="burger-line"></div>
                    <div class="burger-line"></div>
                    <div class="burger-line"></div>
                </div>
            </button>
        </div>
        
        <!-- Context Detection Bean -->
        <div class="exercise-detection-bean-container" id="exerciseBeanContainer">
            <div class="exercise-detection-bean" id="exerciseBean" onclick="toggleSideMenu()">
                <span class="bean-icon" id="exerciseBeanIcon"></span>
                <span class="bean-text" id="exerciseBeanText">NO CONTEXT</span>
            </div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            <div class="welcome-message">
                <p class="welcome-text">
                    Welcome to Iris Chat!<br>
                    <strong>Note: Iris is currently disabled and will be enabled later.</strong><br>
                    Please select a chat context from the menu (\u2630) to get started.
                </p>
            </div>
        </div>
        
        <div class="chat-input-container">
            <div class="chat-input-wrapper">
                <textarea 
                    class="chat-input" 
                    id="chatInput" 
                    placeholder="Chat input is currently disabled"
                    rows="1"
                    disabled
                    readonly
                ></textarea>
                <button class="send-button" id="sendButton" disabled>
                    Send
                </button>
            </div>
        </div>
    </div>

    <!-- Help Popup -->
    <div class="help-overlay" id="helpOverlay" onclick="closeHelpPopup()"></div>
    <div class="help-popup" id="helpPopup">
        <div class="help-popup-header">
            <h2 class="help-popup-title">Chat Context Guide</h2>
            <button class="close-help-btn" onclick="closeHelpPopup()" title="Close Help">\xD7</button>
        </div>
        <div class="help-popup-content">
            <p class="help-intro">
                Choose the right chat context to get the most relevant help from Iris. Each context is designed for specific types of questions and learning scenarios.
            </p>
            
            <div class="help-sections">
                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">\u{1F4DA}</span>
                        <h3>Course Chat</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> General course questions, understanding course structure, and getting clarification on course topics.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Understand course objectives and requirements</li>
                            <li>Get an overview of course topics</li>
                            <li>Learn how different concepts connect</li>
                            <li>Ask about course policies or structure</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "What are the main topics in this computer science course?"
                        </div>
                    </div>
                </div>

                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">\u{1F4BB}</span>
                        <h3>Exercise Chat</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Programming exercises, coding problems, and hands-on assignments.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Debug your code or fix errors</li>
                            <li>Understand programming concepts</li>
                            <li>Get hints for solving coding problems</li>
                            <li>Learn best practices and syntax</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "I'm getting a NullPointerException in my Java code. Can you help me understand why?"
                        </div>
                        <div class="help-note">
                            <strong>Note:</strong> Iris provides guidance and hints rather than complete solutions to encourage learning.
                        </div>
                    </div>
                </div>

                <div class="help-section">
                    <div class="help-section-header">
                        <span class="help-icon">\u{1F468}\u200D\u{1F3EB}</span>
                        <h3>Tutor Suggestions</h3>
                    </div>
                    <div class="help-section-content">
                        <p><strong>Best for:</strong> Personalized learning guidance, study strategies, and academic advice.</p>
                        <p><strong>Use when you want to:</strong></p>
                        <ul>
                            <li>Get study recommendations</li>
                            <li>Find practice problems</li>
                            <li>Improve learning strategies</li>
                            <li>Overcome specific learning challenges</li>
                        </ul>
                        <div class="help-example">
                            <strong>Example:</strong> "What's the best way to study for my algorithms exam?"
                        </div>
                        <div class="help-note">
                            <strong>Special:</strong> Provides tailored suggestions based on your progress and learning patterns.
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="help-footer">
                <p><strong>\u{1F4A1} Tip:</strong> You can switch between contexts anytime using the dropdown menu in the sidebar. Each context maintains its own conversation history.</p>
            </div>
        </div>
    </div>

    <!-- Side Menu -->
    <div class="menu-overlay" id="menuOverlay" onclick="closeSideMenu()"></div>
    <div class="side-menu" id="sideMenu">
        <div class="side-menu-header">
            <h3 class="side-menu-title">Menu</h3>
            <button class="close-menu-btn" onclick="closeSideMenu()" title="Close Menu">
                \xD7
            </button>
        </div>
        <div class="side-menu-content">
            <div class="menu-section">
                <h4 class="menu-section-title">Chat Context</h4>
                
                <!-- Selection Mode Button -->
                <button class="selection-mode-button is-auto" onclick="toggleSelectionMode(event)" id="selectionModeButton">
                    <span class="selection-mode-icon" id="selectionModeIcon">${refreshIcon}</span>
                    <div class="selection-mode-content">
                        <div class="selection-mode-title" id="selectionModeText">Auto Selection</div>
                        <div class="selection-mode-description" id="selectionModeDescription">System automatically selects context</div>
                    </div>
                </button>
                
                <!-- Search Input (Only in Manual Mode) -->
                <div class="search-container" id="searchContainer" style="display: none;">
                    <input 
                        type="text" 
                        class="search-input" 
                        id="contextSearchInput" 
                        placeholder="Search exercises and courses..."
                        oninput="filterContextLists()"
                    />
                </div>
                
                <!-- Quick Select Section (Only in Auto Mode) -->
                <div class="quick-select-section" id="quickSelectSection">
                    <div class="quick-select-header">Quick Select</div>
                    
                    <!-- Top Exercise -->
                    <div class="quick-select-item" id="quickExercise" style="display: none;" onclick="quickSelectExercise()">
                        <div class="quick-select-icon">${exerciseIcon}</div>
                        <div class="quick-select-content">
                            <div class="quick-select-label">Top Exercise</div>
                            <div class="quick-select-title" id="quickExerciseTitle">Loading...</div>
                        </div>
                    </div>
                    
                    <!-- Top Course -->
                    <div class="quick-select-item" id="quickCourse" style="display: none;" onclick="quickSelectCourse()">
                        <div class="quick-select-icon">${courseIcon}</div>
                        <div class="quick-select-content">
                            <div class="quick-select-label">Top Course</div>
                            <div class="quick-select-title" id="quickCourseTitle">Loading...</div>
                        </div>
                    </div>
                    
                    <div class="quick-select-empty" id="quickSelectEmpty">
                        Open a course or exercise from Artemis to see quick options
                    </div>
                </div>
                
                <!-- All Exercises List (Only in Manual Mode) -->
                <div class="context-list-section" id="exercisesListSection" style="display: none;">
                    <div class="context-list-header">${exerciseIcon} All Exercises</div>
                    <div class="context-list-container" id="exercisesList">
                        <!-- Populated dynamically -->
                    </div>
                </div>
                
                <!-- All Courses List (Only in Manual Mode) -->
                <div class="context-list-section" id="coursesListSection" style="display: none;">
                    <div class="context-list-header">${courseIcon} All Courses</div>
                    <div class="context-list-container" id="coursesList">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>
            
            <div class="menu-section">
                <h4 class="menu-section-title">Chat Options</h4>
                <div class="menu-item" onclick="newConversation()" id="newConversationBtn" style="opacity: 0.5; pointer-events: none;">
                    ${refreshIcon}
                    <div>
                        <div>New Conversation</div>
                        <div class="menu-item-description">Start fresh in the same context</div>
                    </div>
                </div>
                <div class="menu-item" onclick="clearHistory()">
                    ${trashIcon}
                    <div>
                        <div>Clear History</div>
                        <div class="menu-item-description">Reset everything and choose new context</div>
                    </div>
                </div>
                ${showDiagnostics ? `
                <div class="menu-item" onclick="openDiagnostics()">
                    ${stethoscopeIcon}
                    <div>
                        <div>Diagnostics</div>
                        <div class="menu-item-description">Log current context and state to console</div>
                    </div>
                </div>
                ` : ""}
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // SVG Icon Definitions
        const ICONS = {
            refresh: \`${refreshIcon}\`,
            cursor: \`${cursorIcon}\`,
            star: \`${starIcon}\`,
            programming: \`<svg viewBox="0 0 576 512" fill="none">
                <path fill="currentColor" d="M64 64C28.7 64 0 92.7 0 128L0 384c0 35.3 28.7 64 64 64l448 0c35.3 0 64-28.7 64-64l0-256c0-35.3-28.7-64-64-64L64 64zm16 64l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM64 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zM176 128l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zM160 240c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l224 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-224 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-176c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16zm80-80c0-8.8 7.2-16 16-16l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32zm16 80l32 0c8.8 0 16 7.2 16 16l0 32c0 8.8-7.2 16-16 16l-32 0c-8.8 0-16-7.2-16-16l0-32c0-8.8 7.2-16 16-16z"/>
            </svg>\`
        };
        
        // Side menu functionality
        function toggleSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            const isOpen = sideMenu.classList.contains('open');
            
            if (isOpen) {
                closeSideMenu();
            } else {
                openSideMenu();
            }
        }
        
        function openSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            sideMenu.classList.add('open');
            menuOverlay.classList.add('open');
            burgerMenu.classList.add('active');
            
            // Auto-select top exercise if in auto mode and nothing is selected yet
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
            
            // Update visual selection after a short delay to ensure DOM is ready
            setTimeout(updateSelectedVisuals, 50);
        }
        
        function closeSideMenu() {
            const sideMenu = document.getElementById('sideMenu');
            const menuOverlay = document.getElementById('menuOverlay');
            const burgerMenu = document.querySelector('.burger-menu');
            
            sideMenu.classList.remove('open');
            menuOverlay.classList.remove('open');
            burgerMenu.classList.remove('active');
        }

        // Exercise popup toggle functionality
        
        // Icon definitions for course vs exercise (matching iconDefinitions.ts)
        const CONTEXT_ICONS = {
            'course': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19V6.2C4 5.0799 4 4.51984 4.21799 4.09202C4.40973 3.71569 4.71569 3.40973 5.09202 3.21799C5.51984 3 6.0799 3 7.2 3H16.8C17.9201 3 18.4802 3 18.908 3.21799C19.2843 3.40973 19.5903 3.71569 19.782 4.09202C20 4.51984 20 5.0799 20 6.2V17H6C4.89543 17 4 17.8954 4 19ZM4 19C4 20.1046 4.89543 21 6 21H20M9 7H15M9 11H15M19 17V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            'exercise': '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 6L21 6.00072M11 12L21 12.0007M11 18L21 18.0007M3 11.9444L4.53846 13.5L8 10M3 5.94444L4.53846 7.5L8 4M4.5 18H4.51M5 18C5 18.2761 4.77614 18.5 4.5 18.5C4.22386 18.5 4 18.2761 4 18C4 17.7239 4.22386 17.5 4.5 17.5C4.77614 17.5 5 17.7239 5 18Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        };
        
        function getContextIcon(contextType) {
            return CONTEXT_ICONS[contextType] || CONTEXT_ICONS['exercise'];
        }
        
        // Global state - must be declared before any functions that use them
        let selectedContext = null;
        let selectedItemId = null;
        let selectedItemName = null;
        let selectedItemShortName = null; // Store the shortName for bean display
        let selectionMode = 'auto'; // 'auto' or 'manual'
        let detectedExercises = [];
        let detectedCourses = [];
        
        // Restore state from previous session
        const previousState = vscode.getState();
        if (previousState) {
            if (previousState.selectionMode) {
                selectionMode = previousState.selectionMode;
            }
            if (previousState.selectedContext) {
                selectedContext = previousState.selectedContext;
                selectedItemId = previousState.selectedItemId;
                selectedItemName = previousState.selectedItemName;
                selectedItemShortName = previousState.selectedItemShortName;
            }
        }
        
        // Save state helper function
        function saveState() {
            vscode.setState({
                selectionMode: selectionMode,
                selectedContext: selectedContext,
                selectedItemId: selectedItemId,
                selectedItemName: selectedItemName,
                selectedItemShortName: selectedItemShortName
            });
        }
        
        // Update detected exercises from extension  
        function updateDetectedExercises(exercises) {
            detectedExercises = exercises || [];
            // Update bean text based on current selected context
            updateBeanText();
            // Update quick select and lists
            updateQuickSelectAndLists();
            
            // If in auto mode and no context selected, auto-select
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
        }

        // Update detected courses from extension
        function updateDetectedCourses(courses) {
            detectedCourses = courses || [];
            // Update bean text based on current selected context
            updateBeanText();
            // Update quick select and lists
            updateQuickSelectAndLists();
            
            // If in auto mode and no context selected, auto-select
            if (selectionMode === 'auto' && !selectedContext) {
                autoSelectContext();
            }
        }

        // Calculate exercise priority (same as in chatWebviewProvider.ts)
        function calculateExercisePriority(exercise) {
            let priority = 0;
            const now = Date.now();
            const msPerDay = 24 * 60 * 60 * 1000;

            // Workspace bonus: +1000
            if (exercise.title && exercise.title.includes('(Workspace)')) {
                priority += 1000;
            }

            // Released in last 7 days: +100
            if (exercise.releaseDate) {
                const releaseTime = new Date(exercise.releaseDate).getTime();
                const daysSinceRelease = (now - releaseTime) / msPerDay;
                if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
                    priority += 100;
                }
            }

            // Due in next 7 days: +170 to +200
            if (exercise.dueDate) {
                const dueTime = new Date(exercise.dueDate).getTime();
                const daysUntilDue = (dueTime - now) / msPerDay;
                if (daysUntilDue >= 0 && daysUntilDue <= 7) {
                    priority += Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
                }
            }

            // Base score: Release date
            if (exercise.releaseDate) {
                const releaseTime = new Date(exercise.releaseDate).getTime();
                priority += Math.floor(releaseTime / msPerDay / 1000);
            }

            return priority;
        }

        // Update quick select and lists
        function updateQuickSelectAndLists() {
            const quickExercise = document.getElementById('quickExercise');
            const quickCourse = document.getElementById('quickCourse');
            const quickEmpty = document.getElementById('quickSelectEmpty');
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');

            // Sort exercises by priority
            const sortedExercises = [...detectedExercises].sort((a, b) => {
                return calculateExercisePriority(b) - calculateExercisePriority(a);
            });

            // Sort courses by most recently viewed
            const sortedCourses = [...detectedCourses];

            // Update quick select for top exercise
            if (sortedExercises.length > 0) {
                const topExercise = sortedExercises[0];
                document.getElementById('quickExerciseTitle').textContent = topExercise.title;
                quickExercise.setAttribute('data-exercise-id', topExercise.id);
                quickExercise.style.display = 'flex';
                quickEmpty.style.display = 'none';
            } else {
                quickExercise.style.display = 'none';
            }

            // Update quick select for top course
            if (sortedCourses.length > 0) {
                const topCourse = sortedCourses[0];
                document.getElementById('quickCourseTitle').textContent = topCourse.title;
                quickCourse.setAttribute('data-course-id', topCourse.id);
                quickCourse.style.display = 'flex';
                quickEmpty.style.display = 'none';
            } else {
                quickCourse.style.display = 'none';
            }

            // Show empty state if no exercises or courses
            if (sortedExercises.length === 0 && sortedCourses.length === 0) {
                quickEmpty.style.display = 'block';
            }

            // Populate all exercises list
            if (sortedExercises.length > 0) {
                const exercisesList = document.getElementById('exercisesList');
                exercisesList.innerHTML = '';
                
                sortedExercises.forEach((exercise, index) => {
                    const item = document.createElement('div');
                    item.className = 'context-list-item';
                    item.setAttribute('data-exercise-id', exercise.id);
                    item.onclick = function() { selectExerciseFromList(exercise.id, exercise.title); };
                    
                    const isWorkspace = exercise.title.includes('(Workspace)');
                    const badge = isWorkspace ? '<span class="workspace-badge">' + ICONS.star + '</span> ' : '';
                    
                    item.innerHTML = \`
                        <div class="context-list-item-title">\${badge}\${exercise.title}</div>
                        <div class="context-list-item-meta">ID: \${exercise.id}</div>
                    \`;
                    
                    exercisesList.appendChild(item);
                });
                
                // Only show if in manual mode
                exercisesSection.style.display = selectionMode === 'manual' ? 'block' : 'none';
            } else {
                exercisesSection.style.display = 'none';
            }

            // Populate all courses list
            if (sortedCourses.length > 0) {
                const coursesList = document.getElementById('coursesList');
                coursesList.innerHTML = '';
                
                sortedCourses.forEach((course, index) => {
                    const item = document.createElement('div');
                    item.className = 'context-list-item';
                    item.setAttribute('data-course-id', course.id);
                    item.onclick = function() { selectCourseFromList(course.id, course.title); };
                    
                    item.innerHTML = \`
                        <div class="context-list-item-title">\${course.title}</div>
                        <div class="context-list-item-meta">ID: \${course.id}</div>
                    \`;
                    
                    coursesList.appendChild(item);
                });
                
                // Only show if in manual mode
                coursesSection.style.display = selectionMode === 'manual' ? 'block' : 'none';
            } else {
                coursesSection.style.display = 'none';
            }
            
            // Update search and quick select visibility based on mode
            if (selectionMode === 'manual') {
                searchContainer.style.display = 'block';
                quickSelectSection.style.display = 'none';
            } else {
                searchContainer.style.display = 'none';
                quickSelectSection.style.display = 'block';
            }
            
            // Update visual selection state after lists are populated
            setTimeout(updateSelectedVisuals, 50);
        }

        // Quick select handlers
        function quickSelectExercise() {
            const quickExercise = document.getElementById('quickExercise');
            const exerciseId = parseInt(quickExercise.getAttribute('data-exercise-id'));
            
            if (exerciseId) {
                // Switch to manual mode if in auto mode
                if (selectionMode === 'auto') {
                    selectionMode = 'manual';
                    updateSelectionModeUI();
                    updateManualListsVisibility();
                }
                
                // Find the full exercise object to get shortName
                const exercise = detectedExercises.find(ex => ex.id === exerciseId);
                if (exercise) {
                    selectChatContext('exercise', exercise.id, exercise.title, exercise.shortName);
                    updateSelectedVisuals();
                }
            }
        }

        function quickSelectCourse() {
            const quickCourse = document.getElementById('quickCourse');
            const courseId = parseInt(quickCourse.getAttribute('data-course-id'));
            
            if (courseId) {
                // Switch to manual mode if in auto mode
                if (selectionMode === 'auto') {
                    selectionMode = 'manual';
                    updateSelectionModeUI();
                    updateManualListsVisibility();
                }
                
                // Find the full course object to get shortName
                const course = detectedCourses.find(c => c.id === courseId);
                if (course) {
                    selectChatContext('course', course.id, course.title, course.shortName);
                    updateSelectedVisuals();
                }
            }
        }

        // List select handlers
        function selectExerciseFromList(exerciseId, exerciseTitle) {
            // Find the full exercise object to get shortName
            const exercise = detectedExercises.find(ex => ex.id === exerciseId);
            if (exercise) {
                selectChatContext('exercise', exercise.id, exercise.title, exercise.shortName);
                updateSelectedVisuals();
            }
        }

        function selectCourseFromList(courseId, courseTitle) {
            // Find the full course object to get shortName
            const course = detectedCourses.find(c => c.id === courseId);
            if (course) {
                selectChatContext('course', course.id, course.title, course.shortName);
                updateSelectedVisuals();
            }
        }
        
        // Filter context lists based on search input
        function filterContextLists() {
            const searchInput = document.getElementById('contextSearchInput');
            const searchTerm = searchInput.value.toLowerCase().trim();
            
            // Filter exercises list
            const exerciseItems = document.querySelectorAll('#exercisesList .context-list-item');
            let visibleExercises = 0;
            exerciseItems.forEach(item => {
                const titleElement = item.querySelector('.context-list-item-title');
                const title = titleElement ? titleElement.textContent.toLowerCase() : '';
                
                if (title.includes(searchTerm)) {
                    item.style.display = '';
                    visibleExercises++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Filter courses list
            const courseItems = document.querySelectorAll('#coursesList .context-list-item');
            let visibleCourses = 0;
            courseItems.forEach(item => {
                const titleElement = item.querySelector('.context-list-item-title');
                const title = titleElement ? titleElement.textContent.toLowerCase() : '';
                
                if (title.includes(searchTerm)) {
                    item.style.display = '';
                    visibleCourses++;
                } else {
                    item.style.display = 'none';
                }
            });
            
            // Optionally hide sections if no results
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            
            if (exercisesSection && visibleExercises === 0 && searchTerm !== '') {
                exercisesSection.style.opacity = '0.5';
            } else if (exercisesSection) {
                exercisesSection.style.opacity = '1';
            }
            
            if (coursesSection && visibleCourses === 0 && searchTerm !== '') {
                coursesSection.style.opacity = '0.5';
            } else if (coursesSection) {
                coursesSection.style.opacity = '1';
            }
        }
        
        // Update visual selection state
        function updateSelectedVisuals() {
            // Remove all selected classes
            document.querySelectorAll('.quick-select-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            document.querySelectorAll('.context-list-item.selected').forEach(item => {
                item.classList.remove('selected');
            });
            
            if (!selectedContext || !selectedItemId) {
                return;
            }
            
            // Add selected class to matching items
            if (selectedContext === 'exercise') {
                // Quick select
                const quickExercise = document.getElementById('quickExercise');
                if (quickExercise && quickExercise.getAttribute('data-exercise-id') == selectedItemId) {
                    quickExercise.classList.add('selected');
                }
                
                // List items
                const exerciseItem = document.querySelector(\`[data-exercise-id="\${selectedItemId}"]\`);
                if (exerciseItem && exerciseItem.classList.contains('context-list-item')) {
                    exerciseItem.classList.add('selected');
                }
            } else if (selectedContext === 'course') {
                // Quick select
                const quickCourse = document.getElementById('quickCourse');
                if (quickCourse && quickCourse.getAttribute('data-course-id') == selectedItemId) {
                    quickCourse.classList.add('selected');
                }
                
                // List items
                const courseItem = document.querySelector(\`[data-course-id="\${selectedItemId}"]\`);
                if (courseItem && courseItem.classList.contains('context-list-item')) {
                    courseItem.classList.add('selected');
                }
            }
        }

        // Update bean text based on selected context
        function updateBeanText() {
            const bean = document.getElementById('exerciseBean');
            const beanText = document.getElementById('exerciseBeanText');
            const beanIcon = document.getElementById('exerciseBeanIcon');
            
            if (bean && beanText && beanIcon) {
                if (!selectedContext || !selectedItemName) {
                    bean.classList.add('no-exercise');
                    beanText.textContent = 'NO CONTEXT';
                    beanIcon.innerHTML = '';
                } else {
                    bean.classList.remove('no-exercise');
                    
                    // Use the shortName if available, otherwise fallback to extraction from title
                    let shortName = selectedItemShortName;
                    
                    if (!shortName) {
                        // Fallback: Extract from title
                        // Try to extract number prefix (e.g., "11 - Title" -> "11")
                        const numberMatch = selectedItemName.match(/^(d+)s*[-\u2013\u2014]/);
                        if (numberMatch) {
                            shortName = numberMatch[1];
                        } else {
                            // Use first word or abbreviation
                            const firstWord = selectedItemName.split(/[s-]/)[0];
                            shortName = firstWord;
                        }
                    }
                    
                    beanText.textContent = shortName.toUpperCase();
                    
                    // Set icon based on context type (course vs exercise)
                    beanIcon.innerHTML = getContextIcon(selectedContext);
                }
            }
        }

        // Initialize bean text
        (function() {
            updateBeanText();
            // Initialize selection mode UI to match the current mode
            updateSelectionModeUI();
            // Initialize search/quick select visibility based on initial selection mode
            updateManualListsVisibility();
        })();

        // Chat input is permanently disabled - event handlers commented out
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        
        // Permanently disable input
        chatInput.disabled = true;
        sendButton.disabled = true;
        
        /* Disabled: Auto-resize textarea
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            
            // Enable/disable send button based on content and context
            sendButton.disabled = !this.value.trim() || !selectedContext;
        });
        */
        
        /* Disabled: Handle Enter key (Shift+Enter for new line, Enter to send)
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!chatInput.disabled && chatInput.value.trim()) {
                    sendMessage();
                }
            }
        });
        */
        
        // Dropdown selection handler
        function selectChatContextFromDropdown() {
            const dropdown = document.getElementById('contextDropdown');
            const selectedValue = dropdown.value;
            
            // Hide all secondary selections first
            document.getElementById('courseSelection').style.display = 'none';
            document.getElementById('exerciseSelection').style.display = 'none';
            
            if (selectedValue === 'course') {
                // Show course selection
                document.getElementById('courseSelection').style.display = 'block';
                populateCourses();
                selectedContext = 'course';
                selectedItemId = null;
                selectedItemName = null;
            } else if (selectedValue === 'exercise') {
                // Show exercise selection
                document.getElementById('exerciseSelection').style.display = 'block';
                populateExercises();
                selectedContext = 'exercise';
                selectedItemId = null;
                selectedItemName = null;
            } else if (selectedValue === 'tutor') {
                // Tutor suggestions don't need specific selection
                selectChatContext('tutor', null, 'General Tutoring');
            } else {
                // Reset everything if no selection
                selectedContext = null;
                selectedItemId = null;
                selectedItemName = null;
            }
        }
        
        // Handle specific item selection (course or exercise)
        function selectSpecificItem() {
            const courseDropdown = document.getElementById('courseDropdown');
            const exerciseDropdown = document.getElementById('exerciseDropdown');
            
            if (selectedContext === 'course' && courseDropdown.value) {
                const selectedOption = courseDropdown.options[courseDropdown.selectedIndex];
                selectedItemId = courseDropdown.value;
                selectedItemName = selectedOption.text;
                selectChatContext('course', selectedItemId, selectedItemName);
            } else if (selectedContext === 'exercise' && exerciseDropdown.value) {
                const selectedOption = exerciseDropdown.options[exerciseDropdown.selectedIndex];
                selectedItemId = exerciseDropdown.value;
                selectedItemName = selectedOption.text;
                selectChatContext('exercise', selectedItemId, selectedItemName);
            }
        }
        
        // Populate courses dropdown
        function populateCourses() {
            const dropdown = document.getElementById('courseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose a course --</option>';
            
            // Use detected courses if available
            if (detectedCourses && detectedCourses.length > 0) {
                detectedCourses.forEach(course => {
                    const option = document.createElement('option');
                    option.value = course.id;
                    option.textContent = course.title;
                    dropdown.appendChild(option);
                });
            } else {
                // Show placeholder if no courses detected
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'No courses detected. Open a course from Artemis view.';
                dropdown.appendChild(option);
            }
        }
        
        // Populate exercises dropdown (mock data for now)
        function populateExercises() {
            const dropdown = document.getElementById('exerciseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose an exercise --</option>';
            
            // Use detected exercises if available
            if (detectedExercises && detectedExercises.length > 0) {
                detectedExercises.forEach(exercise => {
                    const option = document.createElement('option');
                    option.value = exercise.id;
                    option.textContent = exercise.title;
                    dropdown.appendChild(option);
                });
            } else {
                // Show placeholder if no exercises detected
                const option = document.createElement('option');
                option.disabled = true;
                option.textContent = 'No exercises detected. Open a course first.';
                dropdown.appendChild(option);
            }
        }
        
        // Context selection functions
        function selectChatContext(contextType, itemId = null, itemName = null, itemShortName = null, skipModeChange = false) {
            selectedContext = contextType;
            selectedItemId = itemId;
            selectedItemName = itemName;
            selectedItemShortName = itemShortName;
            
            // Set to manual mode unless this is an auto-selection
            if (!skipModeChange) {
                selectionMode = 'manual';
                updateSelectionModeUI();
                // Save state when explicitly switching to manual
                saveState();
            } else {
                // For auto-selection, just save the context without changing mode
                // Only update the context fields in state, preserve the mode
                const currentState = vscode.getState() || {};
                vscode.setState({
                    ...currentState,
                    selectedContext: selectedContext,
                    selectedItemId: selectedItemId,
                    selectedItemName: selectedItemName,
                    selectedItemShortName: selectedItemShortName
                });
            }
            
            // Update bean text
            updateBeanText();
            
            // Update dropdown to match selection (if it exists)
            const dropdown = document.getElementById('contextDropdown');
            if (dropdown) {
                dropdown.value = contextType;
            }
            
            // Show context confirmation message
            const welcomeText = document.querySelector('.welcome-text');
            if (welcomeText) {
                const contextNames = {
                    'course': 'Course Chat',
                    'exercise': 'Exercise Chat',
                    'tutor': 'Tutor Suggestions'
                };
                
                let message = \`Selected: <strong>\${contextNames[contextType]}</strong>\`;
                if (itemName) {
                    message += \` \u2022 <strong>\${itemName}</strong>\`;
                }
                message += '<br><strong>Note: Iris is currently disabled and will be enabled later.</strong>';
                
                welcomeText.innerHTML = message;
            }
            
            // Chat input is permanently disabled
            const chatInput = document.getElementById('chatInput');
            const sendButton = document.getElementById('sendButton');
            const newConversationBtn = document.getElementById('newConversationBtn');
            
            // chatInput.disabled = false; // Disabled permanently
            chatInput.placeholder = 'Chat input is currently disabled';
            // chatInput.focus();
            
            // Keep send button disabled
            sendButton.disabled = true;
            
            // Enable new conversation button
            if (newConversationBtn) {
                newConversationBtn.style.opacity = '1';
                newConversationBtn.style.pointerEvents = 'auto';
            }
            
            // Send context selection to extension
            vscode.postMessage({
                command: 'selectChatContext',
                context: contextType,
                itemId: itemId,
                itemName: itemName,
                itemShortName: itemShortName
            });
        }
        
        function newConversation() {
            if (selectedContext) {
                // Reset the conversation but keep the same context
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.innerHTML = \`
                    <div class="welcome-message">
                        <div class="welcome-icon">\u{1F916}</div>
                        <p class="welcome-text">New conversation started! How can I help you today?</p>
                    </div>
                \`;
                
                vscode.postMessage({
                    command: 'newConversation',
                    context: selectedContext
                });
            }
        }
        
        function clearHistory() {
            if (confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
                selectedContext = null;
                selectedItemId = null;
                selectedItemName = null;
                const chatInput = document.getElementById('chatInput');
                const sendButton = document.getElementById('sendButton');
                const dropdown = document.getElementById('contextDropdown');
                const courseDropdown = document.getElementById('courseDropdown');
                const exerciseDropdown = document.getElementById('exerciseDropdown');
                const newConversationBtn = document.getElementById('newConversationBtn');
                
                // Reset to initial state
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.innerHTML = \`
                    <div class="welcome-message">
                        <p class="welcome-text">
                            Welcome to Iris Chat!<br>
                            <strong>Note: Iris is currently disabled and will be enabled later.</strong><br>
                            Please select a chat context from the menu (\u2630) to get started.
                        </p>
                    </div>
                \`;
                
                // Disable chat input
                chatInput.disabled = true;
                chatInput.placeholder = 'Select a chat context first...';
                chatInput.value = '';
                sendButton.disabled = true;
                
                // Reset all dropdowns
                dropdown.value = '';
                courseDropdown.value = '';
                exerciseDropdown.value = '';
                
                // Hide secondary selections
                document.getElementById('courseSelection').style.display = 'none';
                document.getElementById('exerciseSelection').style.display = 'none';
                
                // Disable new conversation button
                if (newConversationBtn) {
                    newConversationBtn.style.opacity = '0.5';
                    newConversationBtn.style.pointerEvents = 'none';
                }
                
                vscode.postMessage({
                    command: 'clearHistory'
                });
            }
        }

        function openDiagnostics() {
            // Gather selection mode state information
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const modeButton = document.getElementById('selectionModeButton');
            const modeText = document.getElementById('selectionModeText');
            const currentState = vscode.getState();
            
            // Send message to extension to log diagnostics with selection mode info
            vscode.postMessage({
                command: 'openDiagnostics',
                selectionModeInfo: {
                    currentMode: selectionMode,
                    savedStateMode: currentState ? currentState.selectionMode : 'none',
                    uiButtonText: modeText ? modeText.textContent : 'unknown',
                    uiButtonClass: modeButton ? modeButton.className : 'unknown',
                    searchContainerDisplay: searchContainer ? searchContainer.style.display : 'unknown',
                    quickSelectDisplay: quickSelectSection ? quickSelectSection.style.display : 'unknown',
                    exercisesSectionDisplay: exercisesSection ? exercisesSection.style.display : 'unknown',
                    coursesSectionDisplay: coursesSection ? coursesSection.style.display : 'unknown'
                }
            });
        }

        function toggleSelectionMode(event) {
            // Stop event propagation to prevent closing the menu
            if (event) {
                event.stopPropagation();
            }
            
            // Toggle between auto and manual
            selectionMode = selectionMode === 'auto' ? 'manual' : 'auto';
            
            // Clear search input when switching modes
            const searchInput = document.getElementById('contextSearchInput');
            if (searchInput) {
                searchInput.value = '';
                // Reset filter by calling the filter function
                filterContextLists();
            }
            
            // Update UI
            updateSelectionModeUI();
            
            // Show/hide manual lists
            updateManualListsVisibility();
            
            // If switching to auto, trigger auto-selection
            if (selectionMode === 'auto') {
                autoSelectContext();
            }
            
            // Save state to persist across webview reloads
            saveState();
        }

        function updateSelectionModeUI() {
            const icon = document.getElementById('selectionModeIcon');
            const text = document.getElementById('selectionModeText');
            const description = document.getElementById('selectionModeDescription');
            const button = document.getElementById('selectionModeButton');
            
            if (selectionMode === 'auto') {
                icon.innerHTML = ICONS.refresh;
                text.textContent = 'Auto Selection';
                description.textContent = 'System automatically selects context';
                if (button) {
                    button.classList.add('is-auto');
                    button.classList.remove('is-manual');
                }
            } else {
                icon.innerHTML = ICONS.cursor;
                text.textContent = 'Manual Selection';
                description.textContent = 'You choose the context manually';
                if (button) {
                    button.classList.add('is-manual');
                    button.classList.remove('is-auto');
                }
            }
        }

        function updateManualListsVisibility() {
            const exercisesSection = document.getElementById('exercisesListSection');
            const coursesSection = document.getElementById('coursesListSection');
            const searchContainer = document.getElementById('searchContainer');
            const quickSelectSection = document.getElementById('quickSelectSection');
            
            if (selectionMode === 'manual') {
                // Show search input in manual mode
                searchContainer.style.display = 'block';
                // Hide quick select in manual mode
                quickSelectSection.style.display = 'none';
                
                // Show lists if they have content
                if (detectedExercises && detectedExercises.length > 0) {
                    exercisesSection.style.display = 'block';
                }
                if (detectedCourses && detectedCourses.length > 0) {
                    coursesSection.style.display = 'block';
                }
            } else {
                // Hide search input in auto mode
                searchContainer.style.display = 'none';
                // Show quick select in auto mode
                quickSelectSection.style.display = 'block';
                
                // Hide lists in auto mode
                exercisesSection.style.display = 'none';
                coursesSection.style.display = 'none';
            }
        }

        function autoSelectContext() {
            // Auto-select top exercise or course based on priority
            if (detectedExercises && detectedExercises.length > 0) {
                // Sort exercises by priority to get the top one
                const sortedExercises = [...detectedExercises].sort((a, b) => {
                    return calculateExercisePriority(b) - calculateExercisePriority(a);
                });
                
                if (sortedExercises.length > 0) {
                    const topExercise = sortedExercises[0];
                    selectChatContext('exercise', topExercise.id, topExercise.title, topExercise.shortName, true); // true = skip setting to manual
                    updateSelectedVisuals();
                }
            } else if (detectedCourses && detectedCourses.length > 0) {
                // If no exercises but we have courses, select top course
                const topCourse = detectedCourses[0];
                selectChatContext('course', topCourse.id, topCourse.title, topCourse.shortName, true); // true = skip setting to manual
                updateSelectedVisuals();
            }
        }
        
        function sendMessage() {
            const messageText = chatInput.value.trim();
            if (!messageText || !selectedContext) return;
            
            // Add user message to chat
            addMessage(messageText, 'user');
            
            // Clear input
            chatInput.value = '';
            chatInput.style.height = 'auto';
            
            // Show typing indicator
            showTypingIndicator();
            
            // Send to extension
            vscode.postMessage({
                command: 'sendMessage',
                message: messageText,
                context: selectedContext
            });
        }
        
        function addMessage(text, sender) {
            const chatMessages = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${sender}\`;
            messageDiv.textContent = text;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function showTypingIndicator() {
            const chatMessages = document.getElementById('chatMessages');
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message iris typing';
            typingDiv.id = 'typingIndicator';
            typingDiv.textContent = 'Iris is thinking...';
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        function hideTypingIndicator() {
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }
        
        // Send button functionality
        document.getElementById('sendButton').addEventListener('click', function() {
            sendMessage();
        });
        
        // Help popup functions
        function showHelpPopup() {
            const helpOverlay = document.getElementById('helpOverlay');
            const helpPopup = document.getElementById('helpPopup');
            
            helpOverlay.classList.add('open');
            helpPopup.classList.add('open');
            
            // Close side menu if it's open
            closeSideMenu();
            
            // Prevent body scroll
            document.body.style.overflow = 'hidden';
        }
        
        function closeHelpPopup() {
            const helpOverlay = document.getElementById('helpOverlay');
            const helpPopup = document.getElementById('helpPopup');
            
            helpOverlay.classList.remove('open');
            helpPopup.classList.remove('open');
            
            // Re-enable body scroll
            document.body.style.overflow = '';
        }
        
                // Close help popup when pressing Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const helpPopup = document.getElementById('helpPopup');
                if (helpPopup.classList.contains('open')) {
                    closeHelpPopup();
                } else {
                    closeSideMenu();
                }
            }
        });
        
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'irisResponse':
                    hideTypingIndicator();
                    addMessage(message.response, 'iris');
                    break;
                case 'irisError':
                    hideTypingIndicator();
                    addMessage('Sorry, I encountered an error. Please try again later.', 'iris');
                    break;
                case 'coursesData':
                    updateCoursesDropdown(message.courses);
                    break;
                case 'exercisesData':
                    updateExercisesDropdown(message.exercises);
                    break;
                case 'updateDetectedExercises':
                    updateDetectedExercises(message.exercises);
                    break;
                case 'updateDetectedCourses':
                    updateDetectedCourses(message.courses);
                    break;
                case 'autoSelectContext':
                    // Auto-select context from extension
                    handleAutoSelectContext(message.context);
                    break;
            }
        });
        
        // Handle auto-selected context from extension
        function handleAutoSelectContext(context) {
            if (context && context.type && context.id && context.title) {
                // Use skipModeChange=true to preserve the current selection mode
                selectChatContext(context.type, context.id, context.title, context.shortName, true);
                console.log('[Auto-Select] Context set: ' + context.type + ' - ' + context.title);
            }
        }
        
        // Update courses dropdown with real data
        function updateCoursesDropdown(courses) {
            const dropdown = document.getElementById('courseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose a course --</option>';
            
            if (courses && courses.length > 0) {
                courses.forEach(course => {
                    const option = document.createElement('option');
                    option.value = course.id;
                    option.textContent = course.title || course.name;
                    dropdown.appendChild(option);
                });
            }
        }
        
        // Update exercises dropdown with real data
        function updateExercisesDropdown(exercises) {
            const dropdown = document.getElementById('exerciseDropdown');
            dropdown.innerHTML = '<option value="">-- Choose an exercise --</option>';
            
            if (exercises && exercises.length > 0) {
                exercises.forEach(exercise => {
                    const option = document.createElement('option');
                    option.value = exercise.id;
                    option.textContent = exercise.title || exercise.name;
                    dropdown.appendChild(option);
                });
            }
        }
    </script>
</body>
</html>`;
  }
};

// src/views/provider/chatWebviewProvider.ts
var ExerciseRegistry = class _ExerciseRegistry {
  static instance;
  exercises = /* @__PURE__ */ new Map();
  static getInstance() {
    if (!_ExerciseRegistry.instance) {
      _ExerciseRegistry.instance = new _ExerciseRegistry();
    }
    return _ExerciseRegistry.instance;
  }
  registerExercise(id, title, repositoryUri, shortName) {
    this.exercises.set(id, { id, title, repositoryUri, shortName });
  }
  registerFromCourseData(courseData) {
    const exercises = courseData?.course?.exercises || courseData?.exercises || [];
    let registeredCount = 0;
    const registered = [];
    const skipped = [];
    for (const exercise of exercises) {
      const participations = exercise.studentParticipations || [];
      if (participations.length > 0 && participations[0].repositoryUri) {
        this.registerExercise(
          exercise.id,
          exercise.title,
          participations[0].repositoryUri,
          exercise.shortName
        );
        registeredCount++;
        registered.push(`${exercise.id}: ${exercise.title}`);
      } else {
        skipped.push(`${exercise.id}: ${exercise.title} (no repo URI)`);
      }
    }
    console.log(`\u{1F4DA} [Exercise Registry] Processed ${exercises.length} exercises: ${registeredCount} registered, ${skipped.length} skipped. Total in registry: ${this.exercises.size}`);
    if (registered.length > 0) {
      console.log(`   \u2705 Registered: ${registered.join(", ")}`);
    }
    if (skipped.length > 0 && skipped.length <= 3) {
      console.log(`   \u23ED\uFE0F  Skipped: ${skipped.join(", ")}`);
    } else if (skipped.length > 3) {
      console.log(`   \u23ED\uFE0F  Skipped ${skipped.length} exercises (no repository URIs)`);
    }
  }
  findByRepositoryUrl(repoUrl) {
    const normalizeUrl = (url) => {
      return url.replace(/^git@([^:]+):/, "https://$1/").replace(/^https?:\/\/[^@]*@/, "https://").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
    };
    const normalizedSearchUrl = normalizeUrl(repoUrl);
    for (const exercise of this.exercises.values()) {
      if (normalizeUrl(exercise.repositoryUri) === normalizedSearchUrl) {
        return exercise;
      }
    }
    return null;
  }
  getAllExercises() {
    return Array.from(this.exercises.values());
  }
  clear() {
    this.exercises.clear();
  }
};
var ChatWebviewProvider = class {
  constructor(_extensionUri, _extensionContext) {
    this._extensionUri = _extensionUri;
    this._extensionContext = _extensionContext;
    this._styleManager = new StyleManager(this._extensionUri);
  }
  static viewType = "iris.chatView";
  _view;
  _irisChatView;
  _openExercises = /* @__PURE__ */ new Map();
  _openCourses = /* @__PURE__ */ new Map();
  _exerciseQueue = [];
  _courseQueue = [];
  MAX_EXERCISES = 5;
  MAX_COURSES = 3;
  _selectedContext;
  // Store the currently selected chat context
  _styleManager;
  _getOrCreateIrisChatView() {
    if (!this._irisChatView) {
      this._irisChatView = new IrisChatView(this._extensionContext, this._styleManager);
    }
    return this._irisChatView;
  }
  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        this._handleMessage(message);
      },
      void 0,
      []
    );
    const config = vscode7.workspace.getConfiguration("artemis");
    const showDeveloperTools = !config.get("hideDeveloperTools", true);
    webviewView.webview.html = this._getOrCreateIrisChatView().generateHtml(webviewView.webview, showDeveloperTools);
    setTimeout(() => {
      this._detectAndSendExercises();
      this._sendCourses();
    }, 150);
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._detectAndSendExercises();
        this._sendCourses();
      }
    });
    vscode7.workspace.onDidChangeWorkspaceFolders(() => {
      this._detectAndSendExercises();
    });
    vscode7.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("artemis.hideDeveloperTools") || event.affectsConfiguration("artemis.theme")) {
        this.refreshTheme();
      }
    });
  }
  async _detectAndSendExercises() {
    await this._detectWorkspaceExercise();
    this._sendExercises();
  }
  _addExerciseToQueue(exerciseId, exerciseTitle, releaseDate, dueDate, shortName) {
    if (!this._openExercises.has(exerciseId)) {
      this._exerciseQueue.push(exerciseId);
      if (this._exerciseQueue.length > this.MAX_EXERCISES) {
        const oldestId = this._exerciseQueue.shift();
        if (oldestId !== void 0) {
          this._openExercises.delete(oldestId);
        }
      }
    }
    this._openExercises.set(exerciseId, {
      title: exerciseTitle,
      id: exerciseId,
      shortName,
      releaseDate,
      dueDate,
      lastViewed: Date.now()
      // Set view timestamp
    });
    this._sortExerciseQueue();
  }
  _addCourseToQueue(courseId, courseTitle, shortName) {
    if (!this._openCourses.has(courseId)) {
      this._courseQueue.push(courseId);
      if (this._courseQueue.length > this.MAX_COURSES) {
        const oldestId = this._courseQueue.shift();
        if (oldestId !== void 0) {
          this._openCourses.delete(oldestId);
        }
      }
    }
    this._openCourses.set(courseId, {
      title: courseTitle,
      id: courseId,
      shortName,
      lastViewed: Date.now()
      // Set view timestamp
    });
    this._sortCourseQueue();
  }
  /**
   * Calculate priority score for an exercise
   * Higher score = higher priority
   */
  _calculateExercisePriority(exerciseId) {
    const exercise = this._openExercises.get(exerciseId);
    if (!exercise) {
      return 0;
    }
    let priority = 0;
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1e3;
    if (exercise.title.includes("(Workspace)")) {
      priority += 1e3;
    }
    if (exercise.releaseDate) {
      const releaseTime = new Date(exercise.releaseDate).getTime();
      const daysSinceRelease = (now - releaseTime) / msPerDay;
      if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
        priority += 100;
      }
    }
    if (exercise.dueDate) {
      const dueTime = new Date(exercise.dueDate).getTime();
      const daysUntilDue = (dueTime - now) / msPerDay;
      if (daysUntilDue >= 0 && daysUntilDue <= 7) {
        priority += Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
      }
    }
    if (exercise.lastViewed) {
      const hoursSinceView = (now - exercise.lastViewed) / (60 * 60 * 1e3);
      if (hoursSinceView <= 24) {
        priority += 50;
      }
    }
    if (exercise.releaseDate) {
      const releaseTime = new Date(exercise.releaseDate).getTime();
      priority += Math.floor(releaseTime / msPerDay / 1e3);
    }
    if (exercise.score === 100) {
      priority -= 100;
    }
    return priority;
  }
  /**
   * Calculate priority score for a course
   * Higher score = higher priority
   */
  _calculateCoursePriority(courseId) {
    const course = this._openCourses.get(courseId);
    if (!course) {
      return 0;
    }
    let priority = 0;
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1e3;
    const hasWorkspaceExercise = Array.from(this._openExercises.values()).some((ex) => ex.title.includes("(Workspace)"));
    if (hasWorkspaceExercise) {
      priority += 800;
    }
    if (course.lastViewed) {
      const hoursSinceView = (now - course.lastViewed) / (60 * 60 * 1e3);
      if (hoursSinceView <= 24) {
        priority += 100;
      }
    }
    if (course.lastViewed) {
      priority += Math.floor(course.lastViewed / msPerDay / 1e3);
    }
    return priority;
  }
  /**
   * Get detailed breakdown of exercise priority score for diagnostics
   */
  _getExercisePriorityBreakdown(exercise) {
    const breakdown = [];
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1e3;
    if (exercise.title.includes("(Workspace)")) {
      breakdown.push("+1000 (Workspace exercise)");
    }
    if (exercise.releaseDate) {
      const releaseTime = new Date(exercise.releaseDate).getTime();
      const daysSinceRelease = (now - releaseTime) / msPerDay;
      if (daysSinceRelease >= 0 && daysSinceRelease <= 7) {
        breakdown.push(`+100 (Released ${Math.floor(daysSinceRelease)} days ago)`);
      }
    }
    if (exercise.dueDate) {
      const dueTime = new Date(exercise.dueDate).getTime();
      const daysUntilDue = (dueTime - now) / msPerDay;
      if (daysUntilDue >= 0 && daysUntilDue <= 7) {
        const points = Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170);
        breakdown.push(`+${points} (Due in ${Math.floor(daysUntilDue)} days)`);
      }
    }
    if (exercise.lastViewed) {
      const hoursSinceView = (now - exercise.lastViewed) / (60 * 60 * 1e3);
      if (hoursSinceView <= 24) {
        breakdown.push(`+50 (Viewed ${Math.floor(hoursSinceView)} hours ago)`);
      }
    }
    if (exercise.releaseDate) {
      const releaseTime = new Date(exercise.releaseDate).getTime();
      const baseScore = Math.floor(releaseTime / msPerDay / 1e3);
      breakdown.push(`+${baseScore} (Base score from release date)`);
    }
    if (exercise.score === 100) {
      breakdown.push("-100 (Already completed)");
    }
    return breakdown;
  }
  /**
   * Get detailed breakdown of course priority score for diagnostics
   */
  _getCoursePriorityBreakdown(course) {
    const breakdown = [];
    const now = Date.now();
    const hasWorkspaceExercise = Array.from(this._openExercises.values()).some((ex) => ex.title.includes("(Workspace)"));
    if (hasWorkspaceExercise) {
      breakdown.push("+800 (Has workspace exercise)");
    }
    if (course.lastViewed) {
      const hoursSinceView = (now - course.lastViewed) / (60 * 60 * 1e3);
      if (hoursSinceView <= 24) {
        breakdown.push(`+100 (Viewed ${Math.floor(hoursSinceView)} hours ago)`);
      }
    }
    if (course.lastViewed) {
      const msPerDay = 24 * 60 * 60 * 1e3;
      const baseScore = Math.floor(course.lastViewed / msPerDay / 1e3);
      breakdown.push(`+${baseScore} (Base score from last view)`);
    }
    return breakdown;
  }
  /**
   * Sort exercise queue by priority (highest first)
   */
  _sortExerciseQueue() {
    this._exerciseQueue.sort((a, b) => {
      const priorityA = this._calculateExercisePriority(a);
      const priorityB = this._calculateExercisePriority(b);
      return priorityB - priorityA;
    });
  }
  /**
   * Sort course queue by priority (highest first)
   */
  _sortCourseQueue() {
    this._courseQueue.sort((a, b) => {
      const priorityA = this._calculateCoursePriority(a);
      const priorityB = this._calculateCoursePriority(b);
      return priorityB - priorityA;
    });
  }
  async _detectWorkspaceExercise() {
    const workspaceFolder = vscode7.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }
    try {
      const { exec } = require("child_process");
      const { promisify: promisify2 } = require("util");
      const execAsync = promisify2(exec);
      const { stdout } = await execAsync("git remote get-url origin", {
        cwd: workspaceFolder.uri.fsPath
      });
      const repoUrl = stdout.trim();
      const registry = ExerciseRegistry.getInstance();
      const matchedExercise = registry.findByRepositoryUrl(repoUrl);
      if (matchedExercise) {
        console.log("\u2705 [Workspace] Matched:", matchedExercise.title);
        const existingEntry = this._openExercises.get(matchedExercise.id);
        if (existingEntry) {
          const baseTitle = existingEntry.title.replace(" (Workspace)", "");
          this._openExercises.set(matchedExercise.id, {
            title: `${baseTitle} (Workspace)`,
            id: matchedExercise.id,
            shortName: existingEntry.shortName,
            releaseDate: existingEntry.releaseDate,
            dueDate: existingEntry.dueDate
          });
        } else {
          this._addExerciseToQueue(matchedExercise.id, `${matchedExercise.title} (Workspace)`, void 0, void 0, matchedExercise.shortName);
        }
      } else {
        console.log("\u26A0\uFE0F  [Workspace] No match found. Ensure course is loaded first.");
      }
    } catch (error) {
    }
  }
  _sendExercises() {
    if (this._view) {
      const exercises = Array.from(this._openExercises.values()).map((ex) => ({
        ...ex,
        isWorkspace: ex.title.includes("(Workspace)")
      }));
      let contextToSend = null;
      if (!this._selectedContext && exercises.length > 0) {
        const workspaceExercise = exercises.find((ex) => ex.isWorkspace);
        if (workspaceExercise) {
          this._setContext("exercise", workspaceExercise.id, workspaceExercise.title, "auto-workspace");
          contextToSend = {
            type: "exercise",
            id: workspaceExercise.id,
            title: workspaceExercise.title,
            shortName: workspaceExercise.shortName
          };
          console.log(`\u{1F4CC} [Iris Chat] Auto-selected workspace exercise: ${workspaceExercise.title}`);
        } else {
          this._setContext("exercise", exercises[0].id, exercises[0].title, "auto-first");
          contextToSend = {
            type: "exercise",
            id: exercises[0].id,
            title: exercises[0].title,
            shortName: exercises[0].shortName
          };
          console.log(`\u{1F4CC} [Iris Chat] Auto-selected first exercise: ${exercises[0].title}`);
        }
      } else if (this._selectedContext && this._selectedContext.type === "exercise") {
        const selectedExercise = exercises.find((ex) => ex.id === this._selectedContext.id);
        if (selectedExercise) {
          contextToSend = {
            type: "exercise",
            id: selectedExercise.id,
            title: selectedExercise.title,
            shortName: selectedExercise.shortName
          };
          console.log(`\u{1F4CC} [Iris Chat] Sending existing context to webview: ${selectedExercise.title}`);
        }
      }
      setTimeout(() => {
        if (this._view) {
          this._view.webview.postMessage({
            command: "updateDetectedExercises",
            exercises
          });
          if (contextToSend) {
            this._view.webview.postMessage({
              command: "autoSelectContext",
              context: contextToSend
            });
          }
        }
      }, 100);
    }
  }
  _sendCourses() {
    if (this._view) {
      const courses = Array.from(this._openCourses.values());
      console.log(`\u{1F4DA} [Iris Chat] Sending ${courses.length} tracked courses to webview`);
      let contextToSend = null;
      if (this._selectedContext && this._selectedContext.type === "course") {
        const selectedCourse = courses.find((c) => c.id === this._selectedContext.id);
        if (selectedCourse) {
          contextToSend = {
            type: "course",
            id: selectedCourse.id,
            title: selectedCourse.title,
            shortName: selectedCourse.shortName
          };
          console.log(`\u{1F4CC} [Iris Chat] Sending existing course context to webview: ${selectedCourse.title}`);
        }
      }
      if (courses.length > 0) {
        setTimeout(() => {
          if (this._view) {
            this._view.webview.postMessage({
              command: "updateDetectedCourses",
              courses
            });
            if (contextToSend) {
              this._view.webview.postMessage({
                command: "autoSelectContext",
                context: contextToSend
              });
            }
          }
        }, 100);
      }
    }
  }
  refreshTheme() {
    if (this._view) {
      const config = vscode7.workspace.getConfiguration("artemis");
      const showDeveloperTools = !config.get("hideDeveloperTools", true);
      this._view.webview.html = this._getOrCreateIrisChatView().generateHtml(this._view.webview, showDeveloperTools);
    }
  }
  updateDetectedExercise(exerciseTitle, exerciseId, releaseDate, dueDate, shortName) {
    this._addExerciseToQueue(exerciseId, exerciseTitle, releaseDate, dueDate, shortName);
    if (this._view) {
      setTimeout(() => {
        if (this._view) {
          this._view.webview.postMessage({
            command: "updateDetectedExercises",
            exercises: Array.from(this._openExercises.values())
          });
        }
      }, 50);
    }
  }
  removeDetectedExercise(exerciseId) {
    this._openExercises.delete(exerciseId);
    const index = this._exerciseQueue.indexOf(exerciseId);
    if (index > -1) {
      this._exerciseQueue.splice(index, 1);
    }
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateDetectedExercises",
        exercises: Array.from(this._openExercises.values())
      });
    }
  }
  updateDetectedCourse(courseTitle, courseId, shortName) {
    this._addCourseToQueue(courseId, courseTitle, shortName);
    console.log(`\u{1F4DA} [Iris Chat] Course detected: ${courseTitle} (ID: ${courseId})`);
    console.log(`\u{1F4DA} [Iris Chat] Total courses tracked: ${this._openCourses.size}`);
    console.log(`\u{1F4DA} [Iris Chat] View exists: ${!!this._view}`);
    if (!this._selectedContext && this._openCourses.size === 1) {
      this._setContext("course", courseId, courseTitle, "auto-first");
      console.log(`\u{1F4CC} [Iris Chat] Auto-selected first course: ${courseTitle}`);
    }
    if (this._view) {
      const coursesArray = Array.from(this._openCourses.values());
      console.log(`\u{1F4DA} [Iris Chat] Sending ${coursesArray.length} courses to webview:`, coursesArray);
      setTimeout(() => {
        if (this._view) {
          this._view.webview.postMessage({
            command: "updateDetectedCourses",
            courses: coursesArray
          });
        }
      }, 50);
    } else {
      console.warn("\u{1F4DA} [Iris Chat] Cannot send courses - view not initialized yet");
    }
  }
  removeDetectedCourse(courseId) {
    this._openCourses.delete(courseId);
    const index = this._courseQueue.indexOf(courseId);
    if (index > -1) {
      this._courseQueue.splice(index, 1);
    }
    if (this._selectedContext?.type === "course" && this._selectedContext.id === courseId) {
      this.clearContext();
    }
    if (this._view) {
      this._view.webview.postMessage({
        command: "updateDetectedCourses",
        courses: Array.from(this._openCourses.values())
      });
    }
  }
  _handleMessage(message) {
    switch (message.command) {
      case "sendMessage":
        this._handleChatMessage(message);
        break;
      case "clearHistory":
        this._handleClearHistory();
        break;
      case "selectChatContext":
        this._handleContextSelection(message.context, message.itemId, message.itemName, message.itemShortName);
        break;
      case "selectExerciseContext":
        this._handleExerciseSelection(message.exerciseId);
        break;
      case "selectCourseContext":
        this._handleCourseSelection(message.courseId);
        break;
      case "openDiagnostics":
        this._handleOpenDiagnostics(message.selectionModeInfo).catch((err) => {
          console.error("Error opening diagnostics:", err);
          vscode7.window.showErrorMessage("Failed to open diagnostics report");
        });
        break;
      default:
        console.log("Unhandled message in chat view:", message);
        break;
    }
  }
  _handleContextSelection(contextType, itemId, itemName, itemShortName) {
    this._setContext(contextType, itemId, itemName, "user-selected");
    console.log(`\u{1F4CC} [Iris Chat] User selected ${contextType} context: ${itemName} (ID: ${itemId}, Short: ${itemShortName || "N/A"})`);
    const contextTypeLabel = contextType === "exercise" ? "Exercise" : contextType === "course" ? "Course" : "Context";
    vscode7.window.showInformationMessage(`${contextTypeLabel} context set to: ${itemName}`);
  }
  _handleCourseSelection(courseId) {
    const course = this._openCourses.get(courseId);
    const courseTitle = course ? course.title : `Course ${courseId}`;
    this._setContext("course", courseId, courseTitle, "user-selected");
    console.log(`\u{1F4CC} [Iris Chat] User selected course context: ${courseTitle} (ID: ${courseId})`);
  }
  _handleExerciseSelection(exerciseId) {
    const exercise = this._openExercises.get(exerciseId);
    const exerciseTitle = exercise ? exercise.title : `Exercise ${exerciseId}`;
    this._setContext("exercise", exerciseId, exerciseTitle, "user-selected");
    console.log(`\u{1F4CC} [Iris Chat] User selected exercise context: ${exerciseTitle} (ID: ${exerciseId})`);
    vscode7.window.showInformationMessage(`Exercise context set to: ${exerciseTitle}`);
  }
  /**
   * Set the chat context with type, ID, title, and reason
   */
  _setContext(type, id, title, reason) {
    this._selectedContext = {
      type,
      id,
      title,
      reason,
      timestamp: Date.now()
    };
  }
  /**
   * Get the currently selected chat context
   */
  getSelectedContext() {
    return this._selectedContext;
  }
  /**
   * Get the currently selected exercise ID (for backward compatibility)
   */
  getSelectedExerciseId() {
    return this._selectedContext?.type === "exercise" ? this._selectedContext.id : void 0;
  }
  /**
   * Get the currently selected exercise details (for backward compatibility)
   */
  getSelectedExercise() {
    if (this._selectedContext?.type === "exercise") {
      return {
        id: this._selectedContext.id,
        title: this._selectedContext.title
      };
    }
    return void 0;
  }
  /**
   * Set context to a course
   */
  setCourseContext(courseId, courseTitle, reason = "user-selected", shortName) {
    this._addCourseToQueue(courseId, courseTitle, shortName);
    this._setContext("course", courseId, courseTitle, reason);
    console.log(`\u{1F4CC} [Iris Chat] Course context set: ${courseTitle} (ID: ${courseId}, reason: ${reason})`);
    if (this._view) {
      this._view.webview.postMessage({
        command: "autoSelectContext",
        context: {
          type: "course",
          id: courseId,
          title: courseTitle,
          shortName
        }
      });
    }
  }
  /**
   * Set context to an exercise (public method for external use)
   */
  setExerciseContext(exerciseId, exerciseTitle, reason = "user-selected", shortName) {
    this._addExerciseToQueue(exerciseId, exerciseTitle, void 0, void 0, shortName);
    this._setContext("exercise", exerciseId, exerciseTitle, reason);
    console.log(`\u{1F4CC} [Iris Chat] Exercise context set: ${exerciseTitle} (ID: ${exerciseId}, reason: ${reason})`);
    if (this._view) {
      this._view.webview.postMessage({
        command: "autoSelectContext",
        context: {
          type: "exercise",
          id: exerciseId,
          title: exerciseTitle,
          shortName
        }
      });
    }
  }
  /**
   * Clear the current context
   */
  clearContext() {
    this._selectedContext = void 0;
    console.log(`\u{1F4CC} [Iris Chat] Context cleared`);
  }
  async _handleOpenDiagnostics(selectionModeInfo) {
    let report = "=".repeat(80) + "\n";
    report += "\u{1F41B} IRIS CHAT DIAGNOSTICS\n";
    report += "Generated at: " + (/* @__PURE__ */ new Date()).toISOString() + "\n";
    report += "=".repeat(80) + "\n";
    report += "\n\u{1F4CC} SELECTED CONTEXT:\n";
    if (this._selectedContext) {
      report += `  Type: ${this._selectedContext.type}
`;
      report += `  ID: ${this._selectedContext.id}
`;
      report += `  Title: ${this._selectedContext.title}
`;
      report += `  Reason: ${this._selectedContext.reason}
`;
      report += `  Selected at: ${new Date(this._selectedContext.timestamp).toISOString()}
`;
    } else {
      report += "  No context selected\n";
    }
    if (selectionModeInfo) {
      report += "\n\u{1F39B}\uFE0F  SELECTION MODE STATE:\n";
      report += `  Current Mode: ${selectionModeInfo.currentMode}
`;
      report += `  Saved State Mode: ${selectionModeInfo.savedStateMode}
`;
      report += `  UI Button Text: ${selectionModeInfo.uiButtonText}
`;
      report += `  UI Button Class: ${selectionModeInfo.uiButtonClass}
`;
      report += "\n  UI Element Visibility:\n";
      report += `    Search Container: ${selectionModeInfo.searchContainerDisplay}
`;
      report += `    Quick Select: ${selectionModeInfo.quickSelectDisplay}
`;
      report += `    Exercises Section: ${selectionModeInfo.exercisesSectionDisplay}
`;
      report += `    Courses Section: ${selectionModeInfo.coursesSectionDisplay}
`;
    }
    report += `
\u{1F3AF} TRACKED EXERCISES (${this._openExercises.size}):
`;
    if (this._openExercises.size > 0) {
      const exercisesWithPriority = Array.from(this._openExercises.values()).map((ex) => ({
        exercise: ex,
        priority: this._calculateExercisePriority(ex.id),
        scoreBreakdown: this._getExercisePriorityBreakdown(ex)
      })).sort((a, b) => b.priority - a.priority);
      exercisesWithPriority.forEach((item, idx) => {
        const ex = item.exercise;
        const isWorkspace = ex.title.includes("(Workspace)");
        report += `  ${idx + 1}. [${ex.id}] ${ex.title}${isWorkspace ? " \u2B50" : ""}
`;
        report += `     Priority Score: ${item.priority}
`;
        if (item.scoreBreakdown.length > 0) {
          report += `     Score Breakdown:
`;
          item.scoreBreakdown.forEach((reason) => {
            report += `       ${reason}
`;
          });
        }
        if (ex.shortName) {
          report += `     Short Name: ${ex.shortName}
`;
        }
        if (ex.releaseDate) {
          report += `     Release: ${ex.releaseDate}
`;
        }
        if (ex.dueDate) {
          report += `     Due: ${ex.dueDate}
`;
        }
        if (ex.score !== void 0) {
          report += `     Completion: ${ex.score}%
`;
        }
        if (ex.lastViewed) {
          report += `     Last Viewed: ${new Date(ex.lastViewed).toISOString()}
`;
        }
        report += "\n";
      });
      report += `  Queue order: [${this._exerciseQueue.join(", ")}]
`;
    } else {
      report += "  No exercises detected\n";
    }
    report += `
\u{1F4DA} TRACKED COURSES (${this._openCourses.size}):
`;
    if (this._openCourses.size > 0) {
      const coursesWithPriority = Array.from(this._openCourses.values()).map((course) => ({
        course,
        priority: this._calculateCoursePriority(course.id),
        scoreBreakdown: this._getCoursePriorityBreakdown(course)
      })).sort((a, b) => b.priority - a.priority);
      coursesWithPriority.forEach((item, idx) => {
        const course = item.course;
        report += `  ${idx + 1}. [${course.id}] ${course.title}
`;
        report += `     Priority Score: ${item.priority}
`;
        if (item.scoreBreakdown.length > 0) {
          report += `     Score Breakdown:
`;
          item.scoreBreakdown.forEach((reason) => {
            report += `       ${reason}
`;
          });
        }
        if (course.shortName) {
          report += `     Short Name: ${course.shortName}
`;
        }
        if (course.lastViewed) {
          report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}
`;
        }
        report += "\n";
      });
      report += `  Queue order: [${this._courseQueue.join(", ")}]
`;
    } else {
      report += "  No courses detected\n";
    }
    const registry = ExerciseRegistry.getInstance();
    const allExercises = registry.getAllExercises();
    report += `
\u{1F4DA} EXERCISE REGISTRY (${allExercises.length} total):
`;
    if (allExercises.length > 0) {
      allExercises.forEach((ex, idx) => {
        report += `  ${idx + 1}. [${ex.id}] ${ex.title}
`;
        report += `     Repository: ${ex.repositoryUri}
`;
      });
    } else {
      report += "  Registry is empty\n";
    }
    report += "\n\u{1F5BC}\uFE0F  VIEW STATE:\n";
    report += `  View initialized: ${!!this._view}
`;
    report += `  View visible: ${this._view?.visible ?? "N/A"}
`;
    report += "\n" + "=".repeat(80) + "\n";
    report += "\nThis report can be shared for debugging purposes.\n";
    report += "Please remove any sensitive information before sharing.\n";
    const document = await vscode7.workspace.openTextDocument({
      content: report,
      language: "plaintext"
    });
    await vscode7.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode7.ViewColumn.Active
    });
  }
  _handleChatMessage(message) {
    vscode7.window.showInformationMessage(`Chat message: ${message.text}`);
  }
  _handleClearHistory() {
    vscode7.window.showInformationMessage("Chat history cleared");
  }
};

// src/views/app/commands/navigationCommands.ts
var NavigationCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      browseCourses: this.handleBrowseCourses,
      viewExercises: this.handleViewExercises,
      checkGrades: this.handleCheckGrades,
      showAllCourses: this.handleShowAllCourses,
      viewCourseDetails: this.handleViewCourseDetails,
      backToDashboard: this.handleBackToDashboard,
      openExerciseDetails: this.handleOpenExerciseDetails,
      backToCourseDetails: this.handleBackToCourseDetails,
      showAiConfig: this.handleShowAiConfig,
      showServiceStatus: this.handleShowServiceStatus,
      showRecommendedExtensions: this.handleShowRecommendedExtensions,
      loadArchivedCourses: this.handleLoadArchivedCourses,
      reloadCourses: this.handleReloadCourses,
      viewArchivedCourse: this.handleViewArchivedCourse,
      openExercise: this.handleOpenExercise,
      toggleFullscreen: this.handleToggleFullscreen,
      toggleCourseFullscreen: this.handleToggleCourseFullscreen
    };
  }
  handleBrowseCourses = async () => {
    try {
      vscode8.window.showInformationMessage("Loading courses...");
      const dashboardData = await this.context.artemisApi.getCoursesForDashboard();
      if (dashboardData?.courses && dashboardData.courses.length > 0) {
        const quickPickItems = dashboardData.courses.map((courseData) => {
          const course = courseData.course;
          const exerciseCount = course.exercises ? course.exercises.length : 0;
          const semester = course.semester || "No semester";
          return {
            label: course.title,
            description: `${semester} \u2022 ${exerciseCount} exercises`,
            detail: course.description || "No description available",
            courseData
          };
        });
        const selectedItem = await vscode8.window.showQuickPick(quickPickItems, {
          placeHolder: "Select a course to view details",
          matchOnDescription: true,
          matchOnDetail: true
        });
        if (selectedItem) {
          await this.processCourseDetails(selectedItem.courseData);
        }
      } else {
        vscode8.window.showWarningMessage("No courses found or you don't have access to any courses.");
      }
    } catch (error) {
      console.error("Browse courses error:", error);
      vscode8.window.showErrorMessage("Error loading courses");
    }
  };
  handleViewExercises = async () => {
    try {
      vscode8.window.showInformationMessage("This feature will show exercises in a future update.");
    } catch (error) {
      console.error("View exercises error:", error);
      vscode8.window.showErrorMessage("Error accessing exercises");
    }
  };
  handleCheckGrades = async () => {
    try {
      vscode8.window.showInformationMessage("This feature will show grades in a future update.");
    } catch (error) {
      console.error("Check grades error:", error);
      vscode8.window.showErrorMessage("Error accessing grades");
    }
  };
  handleShowAllCourses = async () => {
    await this.context.actionHandler.showCourseList();
  };
  handleViewCourseDetails = async (message) => {
    await this.processCourseDetails(message.courseData);
  };
  async processCourseDetails(courseData) {
    try {
      this.context.appStateManager.showCourseDetail(courseData);
      const registry = ExerciseRegistry.getInstance();
      registry.registerFromCourseData(courseData);
      const chatProvider = global.chatWebviewProvider;
      const course = courseData?.course || courseData;
      if (course) {
        const courseTitle = course.title || "Untitled Course";
        const courseId = course.id || 0;
        const shortName = course.shortName;
        if (chatProvider && typeof chatProvider.updateDetectedCourse === "function") {
          chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
          console.log("\u{1F4DA} [Course Detection] Notified chat about course:", courseTitle);
        }
        if (course.exercises && Array.isArray(course.exercises) && chatProvider && typeof chatProvider.updateDetectedExercise === "function") {
          course.exercises.forEach((exercise) => {
            if (exercise.studentParticipations && exercise.studentParticipations.length > 0) {
              const exerciseTitle = exercise.title || "Untitled Exercise";
              const exerciseId = exercise.id;
              const releaseDate = exercise.releaseDate || exercise.startDate;
              const dueDate = exercise.dueDate;
              const shortName2 = exercise.shortName;
              chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, releaseDate, dueDate, shortName2);
              console.log(`\u{1F4DA} [Course Exercises] Updated exercise from course: ${exerciseTitle} (ID: ${exerciseId})`);
            }
          });
        }
      }
      this.context.actionHandler.render();
    } catch (error) {
      console.error("View course details error:", error);
      vscode8.window.showErrorMessage("Error viewing course details");
    }
  }
  handleBackToDashboard = async () => {
    const userInfo = this.context.appStateManager.userInfo;
    if (userInfo) {
      await this.context.actionHandler.showDashboard(userInfo);
    }
  };
  handleOpenExerciseDetails = async (message) => {
    await this.context.actionHandler.openExerciseDetails(message.exerciseId);
  };
  handleBackToCourseDetails = async () => {
    this.context.appStateManager.backToCourseDetails();
    this.context.actionHandler.render();
  };
  handleShowAiConfig = async () => {
    this.context.actionHandler.showAiConfig();
  };
  handleShowServiceStatus = async () => {
    this.context.actionHandler.showServiceStatus();
  };
  handleShowRecommendedExtensions = async () => {
    this.context.actionHandler.showRecommendedExtensions();
  };
  handleLoadArchivedCourses = async () => {
    try {
      vscode8.window.showInformationMessage("Loading archived courses...");
      await this.context.appStateManager.loadArchivedCourses();
      this.context.actionHandler.render();
      const archivedCount = this.context.appStateManager.archivedCoursesData?.length || 0;
      if (archivedCount > 0) {
        vscode8.window.showInformationMessage(`Loaded ${archivedCount} archived course${archivedCount === 1 ? "" : "s"}`);
      } else {
        vscode8.window.showInformationMessage("No archived courses found");
      }
    } catch (error) {
      console.error("Load archived courses error:", error);
      vscode8.window.showErrorMessage("Error loading archived courses");
    }
  };
  handleReloadCourses = async () => {
    try {
      this.context.appStateManager.clearCoursesData();
      await this.context.actionHandler.showCourseList();
    } catch (error) {
      console.error("Reload courses error:", error);
      vscode8.window.showErrorMessage("Error reloading courses");
    }
  };
  handleViewArchivedCourse = async (message) => {
    const courseId = message.courseId;
    try {
      vscode8.window.showInformationMessage("Loading archived course details...");
      await this.context.appStateManager.showArchivedCourseDetail(courseId);
      this.context.actionHandler.render();
    } catch (error) {
      console.error("View archived course error:", error);
      vscode8.window.showErrorMessage("Error viewing archived course details");
    }
  };
  handleOpenExercise = async (message) => {
    const exerciseId = message.exerciseId;
    try {
      const coursesData = this.context.appStateManager.coursesData;
      let parentCourseData = null;
      if (coursesData?.courses) {
        for (const courseData of coursesData.courses) {
          const exercises = courseData?.course?.exercises || courseData?.exercises || [];
          const foundExercise = exercises.find((ex) => ex.id === exerciseId);
          if (foundExercise) {
            parentCourseData = courseData;
            console.log(`\u{1F4DA} Found parent course for exercise ${exerciseId}: ${courseData.course?.title}`);
            break;
          }
        }
      }
      if (parentCourseData) {
        this.context.appStateManager.showCourseDetail(parentCourseData);
      } else {
        console.warn(`\u26A0\uFE0F  Could not find parent course for exercise ${exerciseId}`);
      }
      await this.context.actionHandler.openExerciseDetails(exerciseId);
    } catch (error) {
      console.error("Open exercise error:", error);
      vscode8.window.showErrorMessage("Failed to open exercise details.");
    }
  };
  handleToggleFullscreen = async () => {
    try {
      const exerciseData = this.context.appStateManager.currentExerciseData;
      if (!exerciseData) {
        vscode8.window.showErrorMessage("No exercise data available to open in fullscreen");
        return;
      }
      await this.context.actionHandler.openExerciseFullscreen(exerciseData);
    } catch (error) {
      console.error("Error opening exercise in fullscreen:", error);
      vscode8.window.showErrorMessage("Failed to open exercise in fullscreen mode");
    }
  };
  handleToggleCourseFullscreen = async () => {
    try {
      const courseData = this.context.appStateManager.currentCourseData;
      if (!courseData) {
        vscode8.window.showErrorMessage("No course data available to open in fullscreen");
        return;
      }
      await this.context.actionHandler.openCourseFullscreen(courseData);
    } catch (error) {
      console.error("Error opening course in fullscreen:", error);
      vscode8.window.showErrorMessage("Failed to open course in fullscreen mode");
    }
  };
};

// src/views/app/commands/repositoryCommands.ts
var vscode9 = __toESM(require("vscode"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var RepositoryCommandModule = class {
  constructor(context) {
    this.context = context;
    this.registerWorkspaceListeners();
  }
  currentRepoContext;
  currentWorkspacePath;
  workspaceChangeDebounce;
  workspaceListenersRegistered = false;
  clonedRepositories = /* @__PURE__ */ new Map();
  dirtyPagesCheckDebounce;
  textDocumentChangeListener;
  getHandlers() {
    return {
      detectWorkspaceExercise: this.handleDetectWorkspaceExercise,
      participateInExercise: this.handleParticipateInExercise,
      checkRepositoryStatus: this.handleCheckRepositoryStatus,
      cloneRepository: this.handleCloneRepository,
      openClonedRepository: this.handleOpenClonedRepository,
      copyCloneUrl: this.handleCopyCloneUrl,
      pullChanges: this.handlePullChanges,
      submitExercise: this.handleSubmitExercise
    };
  }
  hasRecentlyClonedRepo(exerciseId) {
    return this.clonedRepositories.has(exerciseId);
  }
  handleDetectWorkspaceExercise = async () => {
    try {
      const workspaceFolder = vscode9.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        this.context.sendMessage({
          command: "workspaceExerciseDetected",
          exerciseId: null,
          exerciseTitle: null
        });
        return;
      }
      try {
        const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
          cwd: workspaceFolder.uri.fsPath
        });
        const repoUrl = stdout.trim();
        const coursesData = this.context.appStateManager.coursesData;
        let matchedExercise = null;
        if (coursesData?.courses) {
          const normalizeUrl = (url) => {
            return url.replace(/^git@([^:]+):/, "https://$1/").replace(/^https?:\/\/[^@]*@/, "https://").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
          };
          const normalizedRepoUrl = normalizeUrl(repoUrl);
          for (const courseData of coursesData.courses) {
            const exercises = courseData?.course?.exercises || courseData?.exercises || [];
            for (const exercise of exercises) {
              const participations = exercise.studentParticipations || [];
              if (participations.length > 0 && participations[0].repositoryUri) {
                const exerciseRepoUrl = normalizeUrl(participations[0].repositoryUri);
                if (exerciseRepoUrl === normalizedRepoUrl) {
                  matchedExercise = {
                    id: exercise.id,
                    title: exercise.title
                  };
                  break;
                }
              }
            }
            if (matchedExercise) {
              break;
            }
          }
        }
        this.context.sendMessage({
          command: "workspaceExerciseDetected",
          exerciseId: matchedExercise ? matchedExercise.id : null,
          exerciseTitle: matchedExercise ? matchedExercise.title : null
        });
      } catch (gitError) {
        this.context.sendMessage({
          command: "workspaceExerciseDetected",
          exerciseId: null,
          exerciseTitle: null
        });
      }
    } catch (error) {
      console.error("Error detecting workspace exercise:", error);
      this.context.sendMessage({
        command: "workspaceExerciseDetected",
        exerciseId: null,
        exerciseTitle: null
      });
    }
  };
  handleParticipateInExercise = async (message) => {
    const exerciseId = message.exerciseId;
    const exerciseTitle = message.exerciseTitle;
    try {
      vscode9.window.showInformationMessage("Starting exercise participation...");
      const participation = await this.context.artemisApi.startExerciseParticipation(exerciseId);
      if (participation) {
        vscode9.window.showInformationMessage(
          `Successfully started participation in "${exerciseTitle}". Your repository is being prepared.`
        );
        await this.context.actionHandler.openExerciseDetails(exerciseId);
      }
    } catch (error) {
      console.error("Failed to start exercise participation:", error);
      vscode9.window.showErrorMessage(
        `Failed to start participation in "${exerciseTitle}": ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };
  handleCheckRepositoryStatus = async (message) => {
    try {
      const expectedRepoUrl = message.expectedRepoUrl;
      const exerciseId = message.exerciseId;
      const workspaceFolder = vscode9.workspace.workspaceFolders?.[0];
      let isConnected = false;
      let hasChanges = false;
      this.currentRepoContext = { expectedRepoUrl, exerciseId };
      this.currentWorkspacePath = workspaceFolder?.uri.fsPath;
      if (workspaceFolder) {
        try {
          const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
            cwd: workspaceFolder.uri.fsPath
          });
          const currentRepoUrl = stdout.trim();
          const normalizeUrl = (url) => {
            return url.replace(/^git@([^:]+):/, "https://$1/").replace(/^https?:\/\/[^@]*@/, "https://").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
          };
          const normalizedCurrent = normalizeUrl(currentRepoUrl);
          const normalizedExpected = normalizeUrl(expectedRepoUrl);
          isConnected = normalizedCurrent === normalizedExpected;
          if (isConnected) {
            try {
              const { stdout: statusStdout } = await execFileAsync("git", ["status", "--porcelain"], {
                cwd: workspaceFolder.uri.fsPath
              });
              hasChanges = statusStdout.trim().length > 0;
            } catch (statusError) {
              console.warn("Failed to determine repository changes:", statusError);
              hasChanges = false;
            }
          }
        } catch (gitError) {
          isConnected = false;
          hasChanges = false;
        }
      }
      this.context.sendMessage({
        command: "updateRepoStatus",
        isConnected,
        hasChanges
      });
    } catch (error) {
      console.error("Check repository status error:", error);
      vscode9.window.showErrorMessage("Error checking repository status");
    }
  };
  handleCloneRepository = async (message) => {
    const { participationId, repositoryUri, exerciseId, exerciseTitle } = message;
    try {
      if (!participationId || !repositoryUri) {
        vscode9.window.showErrorMessage("Cannot clone: missing participation or repository URL.");
        return;
      }
      try {
        await execFileAsync("git", ["--version"]);
      } catch {
        vscode9.window.showErrorMessage("Git not found in PATH. Please install Git to clone repositories.");
        return;
      }
      const folderUri = await vscode9.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Clone Destination",
        title: `Choose where to clone ${exerciseTitle}`
      });
      if (!folderUri || !folderUri[0]) {
        vscode9.window.showInformationMessage("Clone cancelled - no destination selected.");
        return;
      }
      const selectedPath = folderUri[0].fsPath;
      let vcsToken;
      try {
        vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
      } catch (tokenErr) {
        console.error("Failed to get participation token:", tokenErr);
        vscode9.window.showErrorMessage("Failed to obtain VCS access token for cloning.");
        return;
      }
      let username = "user";
      try {
        const currentUser = await this.context.artemisApi.getCurrentUser();
        if (currentUser?.login) {
          username = currentUser.login;
        }
      } catch (userErr) {
        console.warn("Could not fetch current user, defaulting username:", userErr);
      }
      let cloneUrl;
      try {
        const url = new URL(repositoryUri);
        url.username = username;
        url.password = vcsToken;
        cloneUrl = url.toString();
      } catch (e) {
        vscode9.window.showErrorMessage("Invalid repository URL received from server.");
        return;
      }
      const terminal = vscode9.window.createTerminal(`Exercise ${exerciseId}`);
      terminal.show();
      terminal.sendText(`cd "${selectedPath}"`);
      terminal.sendText(`git clone ${cloneUrl}`);
      vscode9.window.showInformationMessage(`Cloning repository for "${exerciseTitle}" to ${selectedPath} using participation token...`);
      const repoName = path.basename(repositoryUri).replace(/\.git$/, "");
      const repoPath = path.join(selectedPath, repoName);
      if (this.clonedRepositories.size >= 10 && !this.clonedRepositories.has(exerciseId)) {
        const firstKey = this.clonedRepositories.keys().next().value;
        if (firstKey !== void 0) {
          this.clonedRepositories.delete(firstKey);
        }
      }
      this.clonedRepositories.set(exerciseId, { path: repoPath, title: exerciseTitle });
      setTimeout(() => {
        this.context.sendMessage({
          command: "showClonedRepoNotice",
          exerciseTitle
        });
      }, 2e3);
      const openAction = await vscode9.window.showInformationMessage("Open the cloned repository when ready?", "Open Folder", "Skip");
      if (openAction === "Open Folder") {
        setTimeout(() => {
          const repoUri = vscode9.Uri.file(repoPath);
          void vscode9.commands.executeCommand("vscode.openFolder", repoUri, true);
        }, 3e3);
      }
    } catch (error) {
      console.error("Clone repository error:", error);
      vscode9.window.showErrorMessage("Failed to clone repository.");
    }
  };
  handleOpenClonedRepository = async (message) => {
    const exerciseId = message.exerciseId;
    try {
      const repoInfo = this.clonedRepositories.get(exerciseId);
      if (!repoInfo) {
        vscode9.window.showWarningMessage("No cloned repository found for this exercise. Please clone it first.");
        return;
      }
      const repoUri = vscode9.Uri.file(repoInfo.path);
      await vscode9.commands.executeCommand("vscode.openFolder", repoUri, true);
      this.clonedRepositories.delete(exerciseId);
    } catch (error) {
      console.error("Open cloned repository error:", error);
      vscode9.window.showErrorMessage("Failed to open cloned repository.");
    }
  };
  handleCopyCloneUrl = async (message) => {
    const { participationId, repositoryUri } = message;
    try {
      if (!participationId || !repositoryUri) {
        vscode9.window.showErrorMessage("Cannot copy URL: missing participation or repository URL.");
        return;
      }
      let vcsToken;
      try {
        vcsToken = await this.context.artemisApi.getOrCreateVcsAccessToken(participationId);
      } catch (tokenErr) {
        console.error("Failed to get participation token:", tokenErr);
        vscode9.window.showErrorMessage("Failed to obtain VCS access token.");
        return;
      }
      let username = "user";
      try {
        const currentUser = await this.context.artemisApi.getCurrentUser();
        if (currentUser?.login) {
          username = currentUser.login;
        }
      } catch {
      }
      try {
        const url = new URL(repositoryUri);
        url.username = username;
        url.password = vcsToken;
        await vscode9.env.clipboard.writeText(url.toString());
        vscode9.window.showInformationMessage("Clone URL (token) copied to clipboard.");
      } catch {
        vscode9.window.showErrorMessage("Failed to construct clone URL.");
      }
    } catch (error) {
      console.error("Copy clone URL error:", error);
      vscode9.window.showErrorMessage("Failed to copy clone URL.");
    }
  };
  handlePullChanges = async (message) => {
    const exerciseTitle = message.exerciseTitle;
    try {
      const workspaceFolder = vscode9.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode9.window.showErrorMessage("No workspace folder open. Please open the exercise repository first.");
        return;
      }
      const cwd = workspaceFolder.uri.fsPath;
      await vscode9.window.withProgress({
        location: vscode9.ProgressLocation.Notification,
        title: `Pulling changes for "${exerciseTitle}"...`,
        cancellable: false
      }, async () => {
        try {
          await execFileAsync("git", ["pull", "--rebase"], { cwd });
          vscode9.window.showInformationMessage(`Successfully pulled changes for "${exerciseTitle}".`);
          if (this.currentRepoContext) {
            await this.handleCheckRepositoryStatus(this.currentRepoContext);
          }
        } catch (pullError) {
          if (pullError.message && pullError.message.includes("CONFLICT")) {
            throw new Error("Merge conflict detected. Please resolve conflicts manually.");
          } else if (pullError.message && pullError.message.includes("Already up to date")) {
            vscode9.window.showInformationMessage("Repository is already up to date.");
          } else {
            throw pullError;
          }
        }
      });
    } catch (error) {
      console.error("Pull changes error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to pull changes.";
      vscode9.window.showErrorMessage(errorMessage);
    }
  };
  handleSubmitExercise = async (message) => {
    const { participationId, exerciseId, exerciseTitle, commitMessage } = message;
    const workspaceFolder = vscode9.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      const errorText = "Open the exercise repository in VS Code before submitting.";
      vscode9.window.showErrorMessage(errorText);
      this.context.sendMessage({ command: "submissionResult", success: false, error: errorText });
      return;
    }
    this.currentWorkspacePath = workspaceFolder.uri.fsPath;
    const cwd = workspaceFolder.uri.fsPath;
    try {
      await vscode9.window.withProgress({
        location: vscode9.ProgressLocation.Notification,
        title: `Submitting "${exerciseTitle}"...`,
        cancellable: false
      }, async (progress) => {
        progress.report({ message: "Preparing repository..." });
        const { stdout: statusStdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
        if (!statusStdout.trim()) {
          throw new Error("No local changes detected to submit.");
        }
        progress.report({ message: "Staging changes..." });
        await execFileAsync("git", ["add", "-A"], { cwd });
        const config = vscode9.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const configuredDefault = config.get(
          VSCODE_CONFIG.DEFAULT_COMMIT_MESSAGE_KEY,
          "Solution submission via Iris extension"
        );
        const messageText = commitMessage && commitMessage.trim() || configuredDefault;
        progress.report({ message: "Committing changes..." });
        await execFileAsync("git", ["commit", "-m", messageText], { cwd });
        progress.report({ message: "Syncing with remote..." });
        try {
          await execFileAsync("git", ["pull", "--rebase"], { cwd });
        } catch (pullError) {
          if (pullError.message && pullError.message.includes("CONFLICT")) {
            throw new Error("Merge conflict detected. Please resolve conflicts manually using git and try again.");
          }
          console.warn("Pull failed, but continuing with push:", pullError.message);
        }
        progress.report({ message: "Pushing to Artemis..." });
        await execFileAsync("git", ["push"], { cwd });
      });
      vscode9.window.showInformationMessage(`Successfully submitted "${exerciseTitle}".`);
      this.context.sendMessage({ command: "submissionResult", success: true });
    } catch (error) {
      console.error("Submit exercise error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to submit exercise.";
      vscode9.window.showErrorMessage(errorMessage);
      this.context.sendMessage({ command: "submissionResult", success: false, error: errorMessage });
    }
  };
  registerWorkspaceListeners() {
    if (this.workspaceListenersRegistered) {
      return;
    }
    const handleUri = (uri) => {
      this.scheduleWorkspaceStatusCheck(uri);
    };
    vscode9.workspace.onDidSaveTextDocument((document) => {
      handleUri(document.uri);
      this.scheduleDirtyPagesCheck();
    });
    vscode9.workspace.onDidCreateFiles((event) => {
      if (event.files && event.files.length > 0) {
        handleUri(event.files[0]);
      } else {
        handleUri();
      }
    });
    vscode9.workspace.onDidDeleteFiles((event) => {
      if (event.files && event.files.length > 0) {
        handleUri(event.files[0]);
      } else {
        handleUri();
      }
    });
    vscode9.workspace.onDidRenameFiles((event) => {
      if (event.files && event.files.length > 0) {
        handleUri(event.files[0].newUri);
      } else {
        handleUri();
      }
    });
    this.textDocumentChangeListener = vscode9.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme === "file") {
        this.scheduleDirtyPagesCheck();
      }
    });
    this.workspaceListenersRegistered = true;
  }
  scheduleWorkspaceStatusCheck(uri) {
    if (!this.currentRepoContext || !this.currentWorkspacePath) {
      return;
    }
    if (uri) {
      const relative2 = path.relative(this.currentWorkspacePath, uri.fsPath);
      if (relative2.startsWith("..")) {
        return;
      }
    }
    if (this.workspaceChangeDebounce) {
      clearTimeout(this.workspaceChangeDebounce);
    }
    this.workspaceChangeDebounce = setTimeout(() => {
      void this.handleCheckRepositoryStatus(this.currentRepoContext);
    }, 500);
  }
  scheduleDirtyPagesCheck() {
    if (this.dirtyPagesCheckDebounce) {
      clearTimeout(this.dirtyPagesCheckDebounce);
    }
    this.dirtyPagesCheckDebounce = setTimeout(() => {
      this.checkDirtyPages();
    }, 300);
  }
  checkDirtyPages() {
    const artemisConfig = vscode9.workspace.getConfiguration("artemis");
    const showWarning = artemisConfig.get("showUnsavedChangesWarning", true);
    if (!showWarning) {
      this.context.sendMessage({
        command: "updateDirtyPagesStatus",
        hasDirtyPages: false,
        dirtyFileCount: 0,
        autoSaveEnabled: false
      });
      return;
    }
    const workspaceFolder = vscode9.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }
    const dirtyDocuments = vscode9.workspace.textDocuments.filter((doc) => {
      if (doc.uri.scheme !== "file") {
        return false;
      }
      const docPath = doc.uri.fsPath;
      const workspacePath = workspaceFolder.uri.fsPath;
      const relative2 = path.relative(workspacePath, docPath);
      if (relative2.startsWith("..")) {
        return false;
      }
      return doc.isDirty;
    });
    const hasDirtyPages = dirtyDocuments.length > 0;
    const config = vscode9.workspace.getConfiguration("files");
    const autoSave = config.get("autoSave", "off");
    this.context.sendMessage({
      command: "updateDirtyPagesStatus",
      hasDirtyPages,
      dirtyFileCount: dirtyDocuments.length,
      autoSaveEnabled: autoSave !== "off"
    });
  }
};

// src/views/app/commands/irisCommands.ts
var vscode10 = __toESM(require("vscode"));
var IrisCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      askIrisAboutExercise: this.handleAskIrisAboutExercise,
      askIrisAboutCourse: this.handleAskIrisAboutCourse
    };
  }
  handleAskIrisAboutExercise = async (message) => {
    const exerciseId = message.exerciseId;
    const exerciseTitle = message.exerciseTitle;
    const exerciseShortName = message.exerciseShortName;
    const releaseDate = message.releaseDate;
    const dueDate = message.dueDate;
    if (!exerciseId) {
      vscode10.window.showWarningMessage("Unable to open Iris chat: missing exercise information.");
      return;
    }
    await vscode10.commands.executeCommand("iris.chatView.focus");
    const chatProvider = global.chatWebviewProvider;
    const title = exerciseTitle || `Exercise ${exerciseId}`;
    if (chatProvider && typeof chatProvider.updateDetectedExercise === "function") {
      chatProvider.updateDetectedExercise(title, exerciseId, releaseDate, dueDate, exerciseShortName);
    }
    if (chatProvider && typeof chatProvider.setExerciseContext === "function") {
      chatProvider.setExerciseContext(exerciseId, title, "user-selected", exerciseShortName);
    } else {
      console.warn("Iris chat provider is unavailable or does not support exercise context selection.");
    }
  };
  handleAskIrisAboutCourse = async (message) => {
    const courseId = message.courseId;
    const courseTitle = message.courseTitle;
    const courseShortName = message.courseShortName;
    if (!courseId) {
      vscode10.window.showWarningMessage("Unable to open Iris chat: missing course information.");
      return;
    }
    await vscode10.commands.executeCommand("iris.chatView.focus");
    const chatProvider = global.chatWebviewProvider;
    if (chatProvider && typeof chatProvider.setCourseContext === "function") {
      chatProvider.setCourseContext(courseId, courseTitle || `Course ${courseId}`, "user-selected", courseShortName);
    } else {
      console.warn("Iris chat provider is unavailable or does not support course context selection.");
    }
  };
};

// src/views/app/commands/plantUmlCommands.ts
var vscode11 = __toESM(require("vscode"));
var PlantUmlCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      renderPlantUml: this.handleRenderPlantUml,
      renderPlantUmlInline: this.handleRenderPlantUmlInline,
      openPlantUmlInNewTab: this.handleOpenPlantUmlInNewTab
    };
  }
  handleRenderPlantUml = async (message) => {
    const plantUmlDiagrams = message.plantUmlDiagrams;
    const exerciseTitle = message.exerciseTitle;
    if (!plantUmlDiagrams || plantUmlDiagrams.length === 0) {
      vscode11.window.showWarningMessage("No PlantUML diagrams found to render.");
      return;
    }
    try {
      console.log("\u{1F3A8} Rendering PlantUML diagrams from exercise:", exerciseTitle);
      console.log("\u{1F4CA} PlantUML content:", plantUmlDiagrams);
      const combinedPlantUml = plantUmlDiagrams.join("\n\n");
      await vscode11.window.withProgress({
        location: vscode11.ProgressLocation.Notification,
        title: `Rendering ${plantUmlDiagrams.length} PlantUML diagram${plantUmlDiagrams.length > 1 ? "s" : ""}...`,
        cancellable: false
      }, async () => {
        await vscode11.commands.executeCommand("artemis.renderPlantUmlFromWebview", combinedPlantUml, exerciseTitle);
      });
    } catch (error) {
      console.error("Render PlantUML error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode11.window.showErrorMessage(`Failed to render PlantUML: ${errorMsg}`);
    }
  };
  handleRenderPlantUmlInline = async (message) => {
    const plantUml = message.plantUml;
    const index = message.index;
    if (!plantUml) {
      this.context.sendMessage({
        command: "plantUmlError",
        index,
        error: "No PlantUML content provided"
      });
      return;
    }
    try {
      console.log(`\u{1F3A8} Rendering inline PlantUML diagram ${index + 1}`);
      const processedPlantUml = processPlantUml(plantUml);
      const isDarkTheme = vscode11.window.activeColorTheme.kind === vscode11.ColorThemeKind.Dark;
      const svg = await this.context.artemisApi.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);
      this.context.sendMessage({
        command: "plantUmlRendered",
        index,
        svg
      });
      console.log(`\u2705 Inline PlantUML diagram ${index + 1} rendered successfully`);
    } catch (error) {
      console.error(`Render inline PlantUML error for diagram ${index + 1}:`, error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      this.context.sendMessage({
        command: "plantUmlError",
        index,
        error: errorMsg
      });
    }
  };
  handleOpenPlantUmlInNewTab = async (message) => {
    const plantUml = message.plantUml;
    const index = message.index;
    if (!plantUml) {
      vscode11.window.showWarningMessage("No PlantUML content to open.");
      return;
    }
    try {
      console.log(`\u{1F3A8} Opening PlantUML diagram ${index + 1} in new tab`);
      const processedPlantUml = processPlantUml(plantUml);
      await vscode11.commands.executeCommand("artemis.renderPlantUmlFromWebview", processedPlantUml, `Diagram ${index + 1}`);
    } catch (error) {
      console.error(`Open PlantUML in new tab error for diagram ${index + 1}:`, error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      vscode11.window.showErrorMessage(`Failed to open PlantUML diagram: ${errorMsg}`);
    }
  };
};

// src/views/app/commands/healthCommands.ts
var HealthCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      performHealthChecks: this.handlePerformHealthChecks
    };
  }
  handlePerformHealthChecks = async (message) => {
    const serverUrl = message.serverUrl;
    const results = {
      serverReachability: { status: "unknown", message: "Not checked", endpoint: serverUrl, httpStatus: null, response: null },
      authService: { status: "unknown", message: "Not checked", endpoint: `${serverUrl}/api/core/public/authenticate`, httpStatus: null, response: null },
      apiAvailability: { status: "unknown", message: "Not checked", endpoint: `${serverUrl}/management/health`, httpStatus: null, response: null },
      websocket: { status: "unknown", message: "Not checked", endpoint: `${serverUrl}/websocket`, httpStatus: null, response: null },
      irisService: { status: "unknown", message: "Not checked", endpoint: `${serverUrl}/api/iris/status`, httpStatus: null, response: null }
    };
    let cookieHeader;
    try {
      cookieHeader = await this.context.authManager.getCookieHeader();
    } catch (error) {
      console.log("No authentication cookie available for health checks");
    }
    try {
      try {
        const reachabilityResponse = await fetch(serverUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(5e3)
        });
        results.serverReachability = {
          status: "online",
          message: "Available",
          endpoint: serverUrl,
          httpStatus: reachabilityResponse.status,
          response: `${reachabilityResponse.status} ${reachabilityResponse.statusText}`
        };
      } catch (error) {
        results.serverReachability = {
          status: "offline",
          message: error.name === "TimeoutError" ? "Timeout" : "Unreachable",
          endpoint: serverUrl,
          httpStatus: null,
          response: error.message || "Network error"
        };
      }
      try {
        const authResponse = await fetch(`${serverUrl}/api/core/public/authenticate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "", password: "", rememberMe: false }),
          signal: AbortSignal.timeout(8e3)
        });
        if (authResponse.status === 400 || authResponse.status === 401 || authResponse.status === 200) {
          results.authService = {
            status: "online",
            message: "Available",
            endpoint: `${serverUrl}/api/core/public/authenticate`,
            httpStatus: authResponse.status,
            response: `${authResponse.status} ${authResponse.statusText} (Expected - requires credentials)`
          };
        } else {
          results.authService = {
            status: "offline",
            message: `Error ${authResponse.status}`,
            endpoint: `${serverUrl}/api/core/public/authenticate`,
            httpStatus: authResponse.status,
            response: `${authResponse.status} ${authResponse.statusText}`
          };
        }
      } catch (error) {
        results.authService = {
          status: "offline",
          message: error.name === "TimeoutError" ? "Timeout" : "Unavailable",
          endpoint: `${serverUrl}/api/core/public/authenticate`,
          httpStatus: null,
          response: error.message || "Network error"
        };
      }
      try {
        const healthResponse = await fetch(`${serverUrl}/management/health`, {
          method: "GET",
          signal: AbortSignal.timeout(8e3)
        });
        const healthText = healthResponse.ok ? await healthResponse.text() : null;
        if (healthResponse.ok) {
          results.apiAvailability = {
            status: "online",
            message: "Available",
            endpoint: `${serverUrl}/management/health`,
            httpStatus: healthResponse.status,
            response: healthText ? healthText.substring(0, 100) : `${healthResponse.status} ${healthResponse.statusText}`
          };
        } else {
          results.apiAvailability = {
            status: "offline",
            message: `Error ${healthResponse.status}`,
            endpoint: `${serverUrl}/management/health`,
            httpStatus: healthResponse.status,
            response: `${healthResponse.status} ${healthResponse.statusText}`
          };
        }
      } catch (error) {
        results.apiAvailability = {
          status: "offline",
          message: error.name === "TimeoutError" ? "Timeout" : "Unavailable",
          endpoint: `${serverUrl}/management/health`,
          httpStatus: null,
          response: error.message || "Network error"
        };
      }
      try {
        const websocketUrl = new URL(serverUrl);
        websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
        websocketUrl.pathname = "/websocket";
        const websocketResponse = await fetch(websocketUrl.toString(), {
          method: "HEAD",
          signal: AbortSignal.timeout(5e3)
        });
        results.websocket = {
          status: websocketResponse.ok ? "online" : "offline",
          message: websocketResponse.ok ? "Available" : `Error ${websocketResponse.status}`,
          endpoint: `${serverUrl}/websocket`,
          httpStatus: websocketResponse.status,
          response: `${websocketResponse.status} ${websocketResponse.statusText}`
        };
      } catch (error) {
        if (results.serverReachability.status === "online") {
          results.websocket = {
            status: "unknown",
            message: error.name === "TimeoutError" ? "Timeout" : "Cannot check",
            endpoint: `${serverUrl}/websocket`,
            httpStatus: null,
            response: error.message || "Network error"
          };
        } else {
          results.websocket = {
            status: "offline",
            message: "Server unreachable",
            endpoint: `${serverUrl}/websocket`,
            httpStatus: "N/A",
            response: "Cannot connect - server unreachable"
          };
        }
      }
      try {
        const irisHeaders = {};
        if (cookieHeader) {
          irisHeaders["Cookie"] = cookieHeader;
        }
        const irisResponse = await fetch(`${serverUrl}/api/iris/status`, {
          method: "GET",
          headers: irisHeaders,
          signal: AbortSignal.timeout(8e3)
        });
        if (irisResponse.ok) {
          try {
            const irisData = await irisResponse.json();
            const isActive = irisData.active === true;
            const rateLimit = irisData.rateLimitInfo ? `Rate limit: ${irisData.rateLimitInfo.currentMessageCount}/${irisData.rateLimitInfo.rateLimit}` : "No rate limit info";
            results.irisService = {
              status: isActive ? "online" : "offline",
              message: isActive ? "Active" : "Inactive",
              endpoint: `${serverUrl}/api/iris/status`,
              httpStatus: irisResponse.status,
              response: `${irisResponse.status} ${irisResponse.statusText} - ${isActive ? "Active" : "Inactive"} (${rateLimit})`
            };
          } catch (parseError) {
            results.irisService = {
              status: "online",
              message: "Available",
              endpoint: `${serverUrl}/api/iris/status`,
              httpStatus: irisResponse.status,
              response: `${irisResponse.status} ${irisResponse.statusText} (Authenticated)`
            };
          }
        } else if (irisResponse.status === 401) {
          results.irisService = {
            status: "online",
            message: "Available",
            endpoint: `${serverUrl}/api/iris/status`,
            httpStatus: irisResponse.status,
            response: `${irisResponse.status} ${irisResponse.statusText} (Requires authentication)`
          };
        } else if (irisResponse.status === 403) {
          results.irisService = {
            status: "online",
            message: "Available",
            endpoint: `${serverUrl}/api/iris/status`,
            httpStatus: irisResponse.status,
            response: `${irisResponse.status} ${irisResponse.statusText} (Requires permission)`
          };
        } else if (irisResponse.status === 404) {
          results.irisService = {
            status: "unknown",
            message: "Not configured",
            endpoint: `${serverUrl}/api/iris/status`,
            httpStatus: irisResponse.status,
            response: `${irisResponse.status} ${irisResponse.statusText} (Iris not enabled)`
          };
        } else {
          results.irisService = {
            status: "offline",
            message: `Error ${irisResponse.status}`,
            endpoint: `${serverUrl}/api/iris/status`,
            httpStatus: irisResponse.status,
            response: `${irisResponse.status} ${irisResponse.statusText}`
          };
        }
      } catch (error) {
        results.irisService = {
          status: "unknown",
          message: error.name === "TimeoutError" ? "Timeout" : "Cannot check",
          endpoint: `${serverUrl}/api/iris/status`,
          httpStatus: null,
          response: error.message || "Network error"
        };
      }
    } catch (error) {
      console.error("Error performing health checks:", error);
    }
    this.context.sendMessage({
      command: "healthCheckResults",
      results
    });
  };
};

// src/views/app/commands/utilityCommands.ts
var vscode12 = __toESM(require("vscode"));
var UtilityCommandModule = class {
  constructor(context) {
    this.context = context;
  }
  getHandlers() {
    return {
      alert: this.handleAlert,
      openSettings: this.handleOpenSettings,
      openWebsite: this.handleOpenWebsite,
      openInEditor: this.handleOpenInEditor,
      copyToClipboard: this.handleCopyToClipboard,
      searchMarketplace: this.handleSearchMarketplace,
      showSubmissionDetails: this.handleShowSubmissionDetails,
      fetchTestResults: this.handleFetchTestResults,
      openExerciseInBrowser: this.handleOpenExerciseInBrowser
    };
  }
  handleAlert = async (message) => {
    if (message?.text) {
      vscode12.window.showErrorMessage(message.text);
    }
  };
  handleOpenSettings = async (message) => {
    const settingId = message?.settingId || "Artemis";
    await vscode12.commands.executeCommand("workbench.action.openSettings", settingId);
  };
  handleOpenWebsite = async () => {
    await vscode12.env.openExternal(vscode12.Uri.parse("https://artemis.tum.de/courses"));
  };
  handleOpenInEditor = async (message) => {
    await this.context.actionHandler.openJsonInEditor(message.data);
  };
  handleCopyToClipboard = async (message) => {
    if (typeof message.text === "string") {
      await vscode12.env.clipboard.writeText(message.text);
      vscode12.window.showInformationMessage("Copied to clipboard");
    }
  };
  handleSearchMarketplace = async (message) => {
    if (message.extensionId) {
      await vscode12.commands.executeCommand("workbench.extensions.search", `@id:${message.extensionId}`);
    }
  };
  handleShowSubmissionDetails = async (message) => {
    const participationId = message.participationId;
    const resultId = message.resultId;
    try {
      if (!participationId || !resultId) {
        vscode12.window.showErrorMessage("Cannot fetch submission details: missing participation or result ID.");
        return;
      }
      vscode12.window.showInformationMessage("Loading submission details...");
      const resultDetails = await this.context.artemisApi.getResultDetails(participationId, resultId);
      if (resultDetails) {
        await this.context.actionHandler.openJsonInEditor(resultDetails);
        vscode12.window.showInformationMessage("Submission details opened in editor");
      } else {
        vscode12.window.showErrorMessage("No submission details found");
      }
    } catch (error) {
      console.error("Show submission details error:", error);
      vscode12.window.showErrorMessage(`Failed to fetch submission details: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };
  handleFetchTestResults = async (message) => {
    const participationId = message.participationId;
    const resultId = message.resultId;
    try {
      if (!participationId || !resultId) {
        this.context.sendMessage({
          command: "testResultsData",
          testCases: [],
          error: "Missing participation or result ID"
        });
        return;
      }
      const resultDetails = await this.context.artemisApi.getResultDetails(participationId, resultId);
      console.log("Result details received:", JSON.stringify(resultDetails, null, 2));
      let feedbacks = [];
      if (Array.isArray(resultDetails)) {
        feedbacks = resultDetails;
      } else if (resultDetails && resultDetails.feedbacks) {
        feedbacks = resultDetails.feedbacks;
      }
      console.log("Feedbacks array:", feedbacks.length, "items");
      if (feedbacks.length > 0) {
        const testCases = feedbacks.filter((feedback) => feedback.testCase).map((feedback) => ({
          testName: feedback.testCase?.testName || "Unnamed Test",
          successful: feedback.positive === true,
          message: feedback.detailText || "",
          type: feedback.testCase?.type || feedback.type,
          credits: feedback.credits,
          visibility: feedback.testCase?.visibility
        }));
        console.log("Mapped test cases:", testCases.length, "items");
        this.context.sendMessage({
          command: "testResultsData",
          testCases
        });
      } else {
        console.log("No feedbacks found in result details");
        this.context.sendMessage({
          command: "testResultsData",
          testCases: []
        });
      }
    } catch (error) {
      console.error("Fetch test results error:", error);
      this.context.sendMessage({
        command: "testResultsData",
        testCases: [],
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  };
  handleOpenExerciseInBrowser = async (message) => {
    const exerciseId = message.exerciseId;
    const courseId = message.courseId;
    if (!exerciseId) {
      vscode12.window.showErrorMessage("Cannot open exercise: missing exercise ID");
      return;
    }
    try {
      const config = vscode12.workspace.getConfiguration("artemis");
      const serverUrl = config.get("serverUrl", "https://artemis.cit.tum.de");
      let exerciseUrl;
      if (courseId) {
        exerciseUrl = `${serverUrl}/courses/${courseId}/exercises/${exerciseId}`;
      } else {
        exerciseUrl = `${serverUrl}/courses/exercises/${exerciseId}`;
      }
      await vscode12.env.openExternal(vscode12.Uri.parse(exerciseUrl));
    } catch (error) {
      console.error("Open exercise in browser error:", error);
      vscode12.window.showErrorMessage(`Failed to open exercise in browser: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };
};

// src/views/app/webViewMessageHandler.ts
var WebViewMessageHandler = class {
  constructor(authManager, artemisApi, appStateManager, actionHandler) {
    this.authManager = authManager;
    this.artemisApi = artemisApi;
    this.appStateManager = appStateManager;
    this.actionHandler = actionHandler;
    const context = {
      authManager: this.authManager,
      artemisApi: this.artemisApi,
      appStateManager: this.appStateManager,
      actionHandler: this.actionHandler,
      sendMessage: (message) => this._sendMessage(message),
      updateAuthContext: (isAuthenticated) => this.updateAuthContext(isAuthenticated)
    };
    const modules = [
      new AuthCommandModule(context),
      new NavigationCommandModule(context),
      this.repositoryModule = new RepositoryCommandModule(context),
      new IrisCommandModule(context),
      new PlantUmlCommandModule(context),
      new HealthCommandModule(context),
      new UtilityCommandModule(context)
    ];
    modules.forEach((module2) => {
      const handlers = module2.getHandlers();
      Object.entries(handlers).forEach(([command, handler]) => {
        if (this.commandHandlers.has(command)) {
          console.warn(`Duplicate handler registered for command "${command}". Overwriting existing handler.`);
        }
        this.commandHandlers.set(command, handler);
      });
    });
  }
  _authContextUpdater;
  _sendMessage = (message) => {
    console.log("Message to send to webview:", message);
  };
  commandHandlers = /* @__PURE__ */ new Map();
  repositoryModule;
  /**
   * Process a message received from the webview, temporarily overriding the message sender.
   */
  async handleMessageWithSender(message, sendResponse) {
    const originalSender = this._sendMessage;
    this._sendMessage = sendResponse;
    try {
      await this.handleMessage(message);
    } finally {
      this._sendMessage = originalSender;
    }
  }
  /**
   * Process a message received from the webview.
   */
  async handleMessage(message) {
    try {
      const handler = this.commandHandlers.get(message.command);
      if (!handler) {
        console.warn("Unknown message command:", message.command);
        return;
      }
      await handler(message);
    } catch (error) {
      console.error("Error handling message:", error);
      vscode13.window.showErrorMessage(`Error processing command: ${message.command}`);
    }
  }
  /**
   * Set the authentication context updater function.
   */
  setAuthContextUpdater(updater) {
    this._authContextUpdater = updater;
  }
  /**
   * Set the method for sending messages to the webview.
   */
  setMessageSender(sendMessage) {
    this._sendMessage = sendMessage;
  }
  /**
   * Check if an exercise has a recently cloned repository.
   */
  hasRecentlyClonedRepo(exerciseId) {
    return this.repositoryModule.hasRecentlyClonedRepo(exerciseId);
  }
  async updateAuthContext(isAuthenticated) {
    if (this._authContextUpdater) {
      await this._authContextUpdater(isAuthenticated);
    }
  }
};

// src/views/provider/artemisWebviewProvider.ts
var vscode14 = __toESM(require("vscode"));
var ArtemisWebviewProvider = class {
  constructor(_extensionUri, _extensionContext, _authManager, _artemisApi) {
    this._extensionUri = _extensionUri;
    this._extensionContext = _extensionContext;
    this._authManager = _authManager;
    this._artemisApi = _artemisApi;
    this._appStateManager = new AppStateManager(this._artemisApi);
    this._viewActionService = new ViewActionService(this._appStateManager);
    this._messageHandler = new WebViewMessageHandler(
      this._authManager,
      this._artemisApi,
      this._appStateManager,
      this
    );
    this._styleManager = new StyleManager(this._extensionUri);
  }
  static viewType = CONFIG.WEBVIEW.VIEW_TYPE;
  _view;
  _appStateManager;
  _messageHandler;
  _viewRouter;
  _viewActionService;
  _authContextUpdater;
  _websocketService;
  _websocketHandler;
  _styleManager;
  /**
   * Set the authentication context updater function
   */
  setAuthContextUpdater(updater) {
    this._authContextUpdater = updater;
    this._messageHandler.setAuthContextUpdater(updater);
  }
  /**
   * Set the WebSocket service for real-time updates
   */
  setWebsocketService(websocketService) {
    this._websocketService = websocketService;
    this._websocketHandler = {
      onNewResult: (result) => {
        this._handleNewResult(result);
      },
      onNewSubmission: (submission) => {
        this._handleNewSubmission(submission);
      },
      onSubmissionProcessing: (message) => {
        this._handleSubmissionProcessing(message);
      }
    };
    this._websocketService.registerMessageHandler(this._websocketHandler);
  }
  /**
   * Helper method to render the webview HTML
   */
  render() {
    if (this._view) {
      this._view.webview.html = this._viewRouter.getHtml();
    }
  }
  // WebViewActionHandler interface implementation
  async openJsonInEditor(data) {
    await this._viewActionService.openJsonInEditor(data);
  }
  async openExerciseDetails(exerciseId) {
    const didUpdate = await this._viewActionService.openExerciseDetails(exerciseId);
    if (didUpdate) {
      this.render();
      const exerciseData = this._appStateManager.currentExerciseData;
      if (exerciseData) {
        const exerciseTitle = exerciseData.exercise?.title || exerciseData.title || "Untitled";
        const exerciseIdFromData = exerciseData.exercise?.id || exerciseData.id || exerciseId;
        const exercise = exerciseData.exercise || exerciseData;
        const participations = exercise.studentParticipations || [];
        if (participations.length > 0 && participations[0].repositoryUri) {
          const registry = ExerciseRegistry.getInstance();
          registry.registerExercise(
            exerciseIdFromData,
            exerciseTitle,
            participations[0].repositoryUri
          );
          console.log("\u{1F4DA} [Exercise Registry] Registered individual exercise:", exerciseTitle);
        }
        const chatProvider = global.chatWebviewProvider;
        if (chatProvider && typeof chatProvider.updateDetectedExercise === "function") {
          const releaseDate = exercise.releaseDate || exercise.startDate;
          const dueDate = exercise.dueDate;
          const shortName = exercise.shortName;
          chatProvider.updateDetectedExercise(exerciseTitle, exerciseIdFromData, releaseDate, dueDate, shortName);
        }
      }
    }
  }
  resolveWebviewView(webviewView, context, _token) {
    this._view = webviewView;
    this._viewRouter = new ViewRouter(this._appStateManager, this._extensionContext, webviewView.webview);
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };
    webviewView.webview.html = this._viewRouter.getHtml();
    this._messageHandler.setMessageSender((message) => {
      if (this._view) {
        this._view.webview.postMessage(message);
      }
    });
    this._checkServerUrlChange();
    this._checkExistingAuthentication();
    webviewView.webview.onDidReceiveMessage(
      (message) => {
        this._messageHandler.handleMessage(message);
      },
      void 0,
      []
    );
    vscode14.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("artemis.hideDeveloperTools") || event.affectsConfiguration("artemis.theme")) {
        this.render();
      }
    });
  }
  notifyLogout() {
    if (this._view) {
      this._view.webview.postMessage({
        command: "logoutSuccess"
      });
    }
  }
  refreshTheme() {
    if (this._view) {
      this.render();
    }
  }
  async showDashboard(userInfo) {
    await this._appStateManager.showDashboard(userInfo);
    if (this._view) {
      this.render();
    }
  }
  showLogin() {
    this._appStateManager.showLogin();
    if (this._view) {
      this.render();
      const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
      const serverUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
      this._view.webview.postMessage({
        command: "setServerUrl",
        serverUrl
      });
    }
  }
  async showCourseList() {
    try {
      await this._appStateManager.showCourseList();
      if (this._view) {
        this.render();
      }
    } catch (error) {
      console.error("Error loading courses:", error);
      vscode14.window.showErrorMessage("Failed to load courses");
    }
  }
  showAiConfig() {
    const installedExtensions = /* @__PURE__ */ new Map();
    for (const ext of vscode14.extensions.all) {
      installedExtensions.set(ext.id.toLowerCase(), ext);
    }
    const aiExtensions = Object.entries(AI_EXTENSIONS_BLOCKLIST).flatMap(([providerName, providerData]) => {
      return providerData.extensions.map((blocklistExt) => {
        const installedExt = installedExtensions.get(blocklistExt.id.toLowerCase());
        const packageJson = installedExt?.packageJSON ?? {};
        return {
          id: blocklistExt.id,
          name: blocklistExt.name,
          publisher: packageJson.publisher ?? "Not installed",
          version: packageJson.version ?? "\u2014",
          description: blocklistExt.description,
          isInstalled: installedExt !== void 0,
          provider: providerName,
          providerColor: providerData.color
        };
      });
    });
    this._appStateManager.showAiConfig(aiExtensions);
    if (this._view) {
      this.render();
    }
  }
  showRecommendedExtensions() {
    const installedExtensions = /* @__PURE__ */ new Map();
    for (const ext of vscode14.extensions.all) {
      installedExtensions.set(ext.id.toLowerCase(), ext);
    }
    const recommendedCategories = getRecommendedExtensionsByCategory().map((category) => ({
      ...category,
      extensions: category.extensions.map((extension) => {
        const installedExt = installedExtensions.get(extension.id.toLowerCase());
        const packageJson = installedExt?.packageJSON ?? {};
        return {
          ...extension,
          isInstalled: installedExt !== void 0,
          version: packageJson.version ?? extension.version
        };
      })
    }));
    this._appStateManager.showRecommendedExtensions(recommendedCategories);
    if (this._view) {
      this.render();
    }
  }
  showServiceStatus() {
    this._appStateManager.showServiceStatus();
    if (this._view) {
      this.render();
    }
  }
  showCourseDetail(courseData) {
    this._appStateManager.showCourseDetail(courseData);
    const registry = ExerciseRegistry.getInstance();
    const courseName = courseData?.course?.title || "Unknown Course";
    console.log(`\u{1F4DA} [Course Detail] Loading course: ${courseName}`);
    registry.registerFromCourseData(courseData);
    const allExercises = registry.getAllExercises();
    console.log(`\u{1F4DA} [Course Detail] Registry now contains ${allExercises.length} exercises total`);
    if (allExercises.length > 0) {
      console.log("\u{1F4DA} [Course Detail] Exercises in registry:");
      allExercises.forEach((ex) => {
        console.log(`   - ${ex.id}: ${ex.title}`);
        console.log(`     Repository: ${ex.repositoryUri}`);
      });
    }
    if (this._view) {
      this.render();
    }
  }
  async _checkServerUrlChange() {
    try {
      const hasAuth = await this._authManager.hasAuthCookie();
      if (hasAuth) {
        const isServerUrlChanged = await this._artemisApi.isServerUrlChanged();
        if (isServerUrlChanged) {
          const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
          const currentServerUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
          vscode14.window.showWarningMessage(
            `The Artemis server URL has changed to ${currentServerUrl}. Your stored credentials may no longer be valid.`,
            "Clear Credentials",
            "Keep Credentials"
          ).then((selection) => {
            if (selection === "Clear Credentials") {
              this.showLogin();
            }
          });
        }
      }
    } catch (error) {
      console.error("Error checking server URL change:", error);
    }
  }
  async _checkExistingAuthentication() {
    try {
      const hasAuth = await this._authManager.hasAuthCookie();
      if (hasAuth) {
        if (this._view) {
          this._view.webview.postMessage({ command: "showLoading", message: "Checking stored credentials..." });
        }
        if (this._view) {
          this._view.webview.postMessage({ command: "updateLoading", message: "Loading user information..." });
        }
        try {
          const user = await this._artemisApi.getCurrentUser();
          const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
          const serverUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
          console.log(`Auto-authenticated user: ${user.login}`);
          await this.showDashboard({
            username: user.login || "User",
            serverUrl,
            user
          });
        } catch (userError) {
          console.log("Stored credentials are invalid, clearing...");
          await this._authManager.clear();
          if (this._authContextUpdater) {
            await this._authContextUpdater(false);
          }
          if (this._view) {
            this._view.webview.postMessage({ command: "hideLoading" });
            const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
            this._view.webview.postMessage({
              command: "setServerUrl",
              serverUrl
            });
          }
        }
      } else {
        if (this._view) {
          this._view.webview.postMessage({ command: "hideLoading" });
          const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
          const serverUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
          this._view.webview.postMessage({
            command: "setServerUrl",
            serverUrl
          });
        }
      }
    } catch (error) {
      console.error("Error checking existing authentication:", error);
      await this._authManager.clear();
      if (this._authContextUpdater) {
        await this._authContextUpdater(false);
      }
      if (this._view) {
        this._view.webview.postMessage({ command: "hideLoading" });
        const config = vscode14.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const serverUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
        this._view.webview.postMessage({
          command: "setServerUrl",
          serverUrl
        });
      }
    }
  }
  async openExerciseFullscreen(exerciseData) {
    try {
      const config = vscode14.workspace.getConfiguration("artemis");
      const hideDeveloperTools = config.get("hideDeveloperTools", false);
      const panel = vscode14.window.createWebviewPanel(
        "exerciseFullscreen",
        `Exercise: ${exerciseData.exercise?.title || exerciseData.title || "Untitled"}`,
        vscode14.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this._extensionUri]
        }
      );
      const exerciseDetailView = new ExerciseDetailView(this._extensionContext, this._styleManager);
      let fullscreenHtml = exerciseDetailView.generateHtml(exerciseData, hideDeveloperTools);
      const hideButtonsCSS = `
                <style>
                    .back-link,
                    .fullscreen-btn {
                        display: none !important;
                    }
                </style>
            `;
      fullscreenHtml = fullscreenHtml.replace("</head>", hideButtonsCSS + "</head>");
      panel.webview.html = fullscreenHtml;
      const exerciseTitle = exerciseData.exercise?.title || exerciseData.title || "Untitled";
      const exerciseId = exerciseData.exercise?.id || exerciseData.id || 0;
      const shortName = exerciseData.exercise?.shortName || exerciseData.shortName;
      const chatProvider = global.chatWebviewProvider;
      if (chatProvider && typeof chatProvider.updateDetectedExercise === "function") {
        chatProvider.updateDetectedExercise(exerciseTitle, exerciseId, void 0, void 0, shortName);
      }
      panel.onDidDispose(() => {
        const chatProvider2 = global.chatWebviewProvider;
        if (chatProvider2 && typeof chatProvider2.removeDetectedExercise === "function") {
          chatProvider2.removeDetectedExercise(exerciseId);
        }
      });
      panel.webview.onDidReceiveMessage(
        (message) => {
          this._messageHandler.handleMessageWithSender(message, (responseMessage) => {
            panel.webview.postMessage(responseMessage);
          });
        },
        void 0,
        []
      );
    } catch (error) {
      console.error("Error opening exercise in fullscreen:", error);
      vscode14.window.showErrorMessage("Failed to open exercise in fullscreen mode");
    }
  }
  async openCourseFullscreen(courseData) {
    try {
      const config = vscode14.workspace.getConfiguration("artemis");
      const hideDeveloperTools = config.get("hideDeveloperTools", false);
      const panel = vscode14.window.createWebviewPanel(
        "courseFullscreen",
        `Course: ${courseData.course?.title || courseData.title || "Untitled"}`,
        vscode14.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this._extensionUri]
        }
      );
      const courseDetailView = new CourseDetailView(this._extensionContext, this._styleManager);
      let fullscreenHtml = courseDetailView.generateHtml(courseData, hideDeveloperTools);
      const hideButtonsCSS = `
                <style>
                    .back-link,
                    .fullscreen-btn {
                        display: none !important;
                    }
                    .course-header {
                        margin-top: 0 !important;
                    }
                </style>
            `;
      fullscreenHtml = fullscreenHtml.replace("</head>", hideButtonsCSS + "</head>");
      panel.webview.html = fullscreenHtml;
      const course = courseData?.course || courseData;
      if (course) {
        const courseTitle = course.title || "Untitled Course";
        const courseId = course.id || 0;
        const shortName = course.shortName;
        const chatProvider = global.chatWebviewProvider;
        if (chatProvider && typeof chatProvider.updateDetectedCourse === "function") {
          chatProvider.updateDetectedCourse(courseTitle, courseId, shortName);
        }
      }
      panel.onDidDispose(() => {
        if (course) {
          const chatProvider = global.chatWebviewProvider;
          if (chatProvider && typeof chatProvider.removeDetectedCourse === "function") {
            chatProvider.removeDetectedCourse(course.id);
          }
        }
      });
      panel.webview.onDidReceiveMessage(
        (message) => {
          this._messageHandler.handleMessageWithSender(message, (responseMessage) => {
            panel.webview.postMessage(responseMessage);
          });
        },
        void 0,
        []
      );
    } catch (error) {
      console.error("Error opening course in fullscreen:", error);
      vscode14.window.showErrorMessage("Failed to open course in fullscreen mode");
    }
  }
  // WebSocket message handlers
  _handleNewResult(result) {
    if (this._view) {
      this._view.webview.postMessage({
        command: "newResult",
        result
      });
    }
  }
  _handleNewSubmission(submission) {
    if (this._view) {
      this._view.webview.postMessage({
        command: "newSubmission",
        submission
      });
    }
  }
  _handleSubmissionProcessing(message) {
    let state = message.submissionState;
    if (!state && (message.buildStartDate || message.estimatedCompletionDate)) {
      state = "BUILDING";
    }
    const buildTimingInfo = message.buildTimingInfo || {
      buildStartDate: message.buildStartDate,
      estimatedCompletionDate: message.estimatedCompletionDate,
      submissionDate: message.submissionDate
    };
    if (this._view) {
      this._view.webview.postMessage({
        command: "submissionProcessing",
        state: state || "BUILDING",
        participationId: message.participationId,
        buildTimingInfo
      });
    }
  }
};

// src/auth/auth.ts
var AuthManager = class _AuthManager {
  static SECRET_KEY = CONFIG.SECRET_KEYS.AUTH_COOKIE;
  memoryCookie;
  context;
  constructor(context) {
    this.context = context;
  }
  // Extracts the Cookie header string ("name=value; name2=value2") from Set-Cookie header(s)
  static extractCookieHeader(setCookie) {
    if (!setCookie) {
      return void 0;
    }
    const entries = Array.isArray(setCookie) ? setCookie : [setCookie];
    const pairs = entries.map((h) => (h || "").split(";")[0]?.trim()).filter(Boolean);
    if (pairs.length === 0) {
      return void 0;
    }
    return pairs.join("; ");
  }
  // Persist cookie if requested, and always keep it in memory for current session
  async setAuthCookie(cookieHeader, persist) {
    this.memoryCookie = cookieHeader;
    if (persist) {
      await this.context.secrets.store(_AuthManager.SECRET_KEY, cookieHeader);
    }
  }
  async hasAuthCookie() {
    if (this.memoryCookie) {
      return true;
    }
    const stored = await this.context.secrets.get(_AuthManager.SECRET_KEY);
    const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
    return !!stored || !!artemisToken;
  }
  async hasArtemisToken() {
    const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
    return !!artemisToken;
  }
  async getArtemisServerUrl() {
    return await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
  }
  // Capture Set-Cookie from a fetch Response and store it
  async setFromResponse(response, persist) {
    try {
      let setCookies;
      const anyHeaders = response?.headers;
      if (anyHeaders && typeof anyHeaders.getSetCookie === "function") {
        setCookies = anyHeaders.getSetCookie();
      } else if (response?.headers?.get) {
        const single = response.headers.get("set-cookie");
        setCookies = single ? [single] : void 0;
      }
      const cookieHeader = _AuthManager.extractCookieHeader(setCookies);
      if (cookieHeader) {
        await this.setAuthCookie(cookieHeader, persist);
      }
    } catch (err) {
      console.error("Failed to capture auth cookie:", err);
    }
  }
  async getCookieHeader() {
    if (this.memoryCookie) {
      return this.memoryCookie;
    }
    const artemisToken = await this.context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
    if (artemisToken) {
      return artemisToken;
    }
    const stored = await this.context.secrets.get(_AuthManager.SECRET_KEY);
    return stored || void 0;
  }
  async getAuthHeaders() {
    const cookie = await this.getCookieHeader();
    if (cookie) {
      return { "Cookie": cookie };
    } else {
      return {};
    }
  }
  async storeArtemisCredentials(jwtCookie, serverUrl, persist) {
    this.memoryCookie = jwtCookie;
    if (persist) {
      await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, jwtCookie);
      await this.context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL, serverUrl);
    }
  }
  async clear() {
    this.memoryCookie = void 0;
    try {
      await this.context.secrets.delete(_AuthManager.SECRET_KEY);
      await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
      await this.context.secrets.delete(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);
    } catch (err) {
      console.error("Failed to clear auth credentials from secrets:", err);
    }
  }
};

// src/api/artemisApi.ts
var vscode15 = __toESM(require("vscode"));
var ArtemisApiService = class {
  authManager;
  constructor(authManager) {
    this.authManager = authManager;
  }
  getServerUrl() {
    const config = vscode15.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    return config.get(VSCODE_CONFIG.SERVER_URL_KEY) || CONFIG.ARTEMIS_SERVER_URL_DEFAULT;
  }
  async makeRequest(endpoint, options = {}) {
    const headers = await this.authManager.getAuthHeaders();
    const url = `${this.getServerUrl()}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        ...options.headers
      }
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Authentication failed. Please log in again.");
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    return response;
  }
  // Get current user information
  async getCurrentUser() {
    const response = await this.makeRequest("/api/core/public/account");
    return response.json();
  }
  // Get all courses for the current user
  async getCourses() {
    const response = await this.makeRequest("/api/core/courses");
    return response.json();
  }
  // Get archived courses (inactive courses from previous semesters)
  async getArchivedCourses() {
    const response = await this.makeRequest("/api/core/courses/for-archive");
    return response.json();
  }
  // Get courses with comprehensive dashboard data (exercises, participations, scores)
  async getCoursesForDashboard() {
    const response = await this.makeRequest("/api/core/courses/for-dashboard");
    return response.json();
  }
  // Get exercises for a specific course
  async getExercises(courseId) {
    const response = await this.makeRequest(`/api/core/courses/${courseId}/exercises`);
    return response.json();
  }
  // Get detailed course information for a specific course
  async getCourseDetails(courseId) {
    const response = await this.makeRequest(`/api/core/courses/${courseId}`);
    return response.json();
  }
  // Get exercise details for a specific exercise
  async getExerciseDetails(exerciseId) {
    const response = await this.makeRequest(`/api/exercise/exercises/${exerciseId}/details`);
    return response.json();
  }
  // Get participations for the current user
  async getParticipations() {
    const response = await this.makeRequest("/api/core/participations");
    return response.json();
  }
  // Get results for a participation
  async getResults(participationId) {
    const response = await this.makeRequest(`/api/core/participations/${participationId}/results`);
    return response.json();
  }
  // Get detailed result information including test cases and feedback
  async getResultDetails(participationId, resultId) {
    const response = await this.makeRequest(`/api/assessment/participations/${participationId}/results/${resultId}/details`);
    return response.json();
  }
  // Check if user is authenticated
  async isAuthenticated() {
    try {
      await this.getCurrentUser();
      return true;
    } catch (error) {
      return false;
    }
  }
  // Get VCS access token for a specific participation (per-exercise token)
  async getVcsAccessToken(participationId) {
    const response = await this.makeRequest(
      `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
      { method: "GET" }
    );
    return response.text();
  }
  // Create VCS access token (if one does not already exist)
  async createVcsAccessToken(participationId) {
    const response = await this.makeRequest(
      `/api/core/account/participation-vcs-access-token?participationId=${participationId}`,
      { method: "PUT" }
    );
    return response.text();
  }
  // Get or create VCS access token helper
  async getOrCreateVcsAccessToken(participationId) {
    try {
      return await this.getVcsAccessToken(participationId);
    } catch (err) {
      return await this.createVcsAccessToken(participationId);
    }
  }
  // Start participation in an exercise (create a new participation)
  async startExerciseParticipation(exerciseId) {
    const response = await this.makeRequest(
      `/api/exercise/exercises/${exerciseId}/participations`,
      { method: "POST" }
    );
    return response.json();
  }
  // Authenticate user with username and password
  async authenticate(username, password, rememberMe = false) {
    const url = `${this.getServerUrl()}${CONFIG.API.ENDPOINTS.AUTHENTICATE}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": CONFIG.API.USER_AGENT
      },
      body: JSON.stringify({
        username,
        password,
        rememberMe
      })
    });
    if (!response.ok) {
      const rawError = await response.text();
      let parsedMessage = rawError.trim();
      if (parsedMessage) {
        try {
          const parsed = JSON.parse(rawError);
          parsedMessage = parsed?.title || parsed?.message || parsed?.detail || parsed?.error || parsedMessage;
        } catch (parseError) {
        }
      }
      if (response.status === 400 || response.status === 401) {
        if (!parsedMessage || /method argument not valid/i.test(parsedMessage)) {
          throw new Error("Invalid username or password.");
        }
        throw new Error(parsedMessage);
      } else if (response.status === 403) {
        throw new Error(parsedMessage || "Account is not activated or access is forbidden.");
      } else {
        const statusText = response.statusText || "Unexpected error";
        const detail = parsedMessage && parsedMessage !== statusText ? ` - ${parsedMessage}` : "";
        throw new Error(`${response.status} ${statusText}${detail}`.trim());
      }
    }
    const data = await response.json();
    const setCookieHeader = response.headers.get("set-cookie");
    let jwtCookie = "";
    if (setCookieHeader) {
      const jwtMatch = setCookieHeader.match(new RegExp(`${CONFIG.AUTH_COOKIE_NAME}=([^;]+)`));
      if (jwtMatch) {
        jwtCookie = `${CONFIG.AUTH_COOKIE_NAME}=${jwtMatch[1]}`;
      }
    }
    if (!jwtCookie) {
      throw new Error("Authentication succeeded but no JWT token received");
    }
    await this.authManager.storeArtemisCredentials(jwtCookie, this.getServerUrl(), rememberMe);
    return {
      success: true,
      token: data.access_token,
      cookie: jwtCookie
    };
  }
  // Validate the current authentication by calling the user endpoint
  async validateAuthentication() {
    try {
      const user = await this.getCurrentUser();
      return !!user;
    } catch (error) {
      console.error("Authentication validation failed:", error);
      return false;
    }
  }
  // Check if the stored server URL matches the current configuration
  async isServerUrlChanged() {
    const storedServerUrl = await this.authManager.getArtemisServerUrl();
    const currentServerUrl = this.getServerUrl();
    return storedServerUrl !== currentServerUrl;
  }
  // Check Iris health status
  async checkIrisHealth() {
    const response = await this.makeRequest("/api/iris/status");
    return response.json();
  }
  // Render PlantUML diagram to SVG
  async renderPlantUmlToSvg(plantUml, useDarkTheme = false) {
    const encodedPlantUml = encodeURIComponent(plantUml);
    const endpoint = `/api/programming/plantuml/svg?plantuml=${encodedPlantUml}&useDarkTheme=${useDarkTheme}`;
    const response = await this.makeRequest(endpoint);
    return response.text();
  }
};

// node_modules/@stomp/stompjs/esm6/augment-websocket.js
function augmentWebsocket(webSocket, debug) {
  webSocket.terminate = function() {
    const noOp = () => {
    };
    this.onerror = noOp;
    this.onmessage = noOp;
    this.onopen = noOp;
    const ts = /* @__PURE__ */ new Date();
    const id = Math.random().toString().substring(2, 8);
    const origOnClose = this.onclose;
    this.onclose = (closeEvent) => {
      const delay = (/* @__PURE__ */ new Date()).getTime() - ts.getTime();
      debug(`Discarded socket (#${id})  closed after ${delay}ms, with code/reason: ${closeEvent.code}/${closeEvent.reason}`);
    };
    this.close();
    origOnClose?.call(webSocket, {
      code: 4001,
      reason: `Quick discarding socket (#${id}) without waiting for the shutdown sequence.`,
      wasClean: false
    });
  };
}

// node_modules/@stomp/stompjs/esm6/byte.js
var BYTE = {
  // LINEFEED byte (octet 10)
  LF: "\n",
  // NULL byte (octet 0)
  NULL: "\0"
};

// node_modules/@stomp/stompjs/esm6/frame-impl.js
var FrameImpl = class _FrameImpl {
  /**
   * body of the frame
   */
  get body() {
    if (!this._body && this.isBinaryBody) {
      this._body = new TextDecoder().decode(this._binaryBody);
    }
    return this._body || "";
  }
  /**
   * body as Uint8Array
   */
  get binaryBody() {
    if (!this._binaryBody && !this.isBinaryBody) {
      this._binaryBody = new TextEncoder().encode(this._body);
    }
    return this._binaryBody;
  }
  /**
   * Frame constructor. `command`, `headers` and `body` are available as properties.
   *
   * @internal
   */
  constructor(params) {
    const { command, headers, body, binaryBody, escapeHeaderValues, skipContentLengthHeader } = params;
    this.command = command;
    this.headers = Object.assign({}, headers || {});
    if (binaryBody) {
      this._binaryBody = binaryBody;
      this.isBinaryBody = true;
    } else {
      this._body = body || "";
      this.isBinaryBody = false;
    }
    this.escapeHeaderValues = escapeHeaderValues || false;
    this.skipContentLengthHeader = skipContentLengthHeader || false;
  }
  /**
   * deserialize a STOMP Frame from raw data.
   *
   * @internal
   */
  static fromRawFrame(rawFrame, escapeHeaderValues) {
    const headers = {};
    const trim = (str) => str.replace(/^\s+|\s+$/g, "");
    for (const header of rawFrame.headers.reverse()) {
      const idx = header.indexOf(":");
      const key = trim(header[0]);
      let value = trim(header[1]);
      if (escapeHeaderValues && rawFrame.command !== "CONNECT" && rawFrame.command !== "CONNECTED") {
        value = _FrameImpl.hdrValueUnEscape(value);
      }
      headers[key] = value;
    }
    return new _FrameImpl({
      command: rawFrame.command,
      headers,
      binaryBody: rawFrame.binaryBody,
      escapeHeaderValues
    });
  }
  /**
   * @internal
   */
  toString() {
    return this.serializeCmdAndHeaders();
  }
  /**
   * serialize this Frame in a format suitable to be passed to WebSocket.
   * If the body is string the output will be string.
   * If the body is binary (i.e. of type Unit8Array) it will be serialized to ArrayBuffer.
   *
   * @internal
   */
  serialize() {
    const cmdAndHeaders = this.serializeCmdAndHeaders();
    if (this.isBinaryBody) {
      return _FrameImpl.toUnit8Array(cmdAndHeaders, this._binaryBody).buffer;
    } else {
      return cmdAndHeaders + this._body + BYTE.NULL;
    }
  }
  serializeCmdAndHeaders() {
    const lines = [this.command];
    if (this.skipContentLengthHeader) {
      delete this.headers["content-length"];
    }
    for (const name of Object.keys(this.headers || {})) {
      const value = this.headers[name];
      if (this.escapeHeaderValues && this.command !== "CONNECT" && this.command !== "CONNECTED") {
        lines.push(`${name}:${_FrameImpl.hdrValueEscape(`${value}`)}`);
      } else {
        lines.push(`${name}:${value}`);
      }
    }
    if (this.isBinaryBody || !this.isBodyEmpty() && !this.skipContentLengthHeader) {
      lines.push(`content-length:${this.bodyLength()}`);
    }
    return lines.join(BYTE.LF) + BYTE.LF + BYTE.LF;
  }
  isBodyEmpty() {
    return this.bodyLength() === 0;
  }
  bodyLength() {
    const binaryBody = this.binaryBody;
    return binaryBody ? binaryBody.length : 0;
  }
  /**
   * Compute the size of a UTF-8 string by counting its number of bytes
   * (and not the number of characters composing the string)
   */
  static sizeOfUTF8(s) {
    return s ? new TextEncoder().encode(s).length : 0;
  }
  static toUnit8Array(cmdAndHeaders, binaryBody) {
    const uint8CmdAndHeaders = new TextEncoder().encode(cmdAndHeaders);
    const nullTerminator = new Uint8Array([0]);
    const uint8Frame = new Uint8Array(uint8CmdAndHeaders.length + binaryBody.length + nullTerminator.length);
    uint8Frame.set(uint8CmdAndHeaders);
    uint8Frame.set(binaryBody, uint8CmdAndHeaders.length);
    uint8Frame.set(nullTerminator, uint8CmdAndHeaders.length + binaryBody.length);
    return uint8Frame;
  }
  /**
   * Serialize a STOMP frame as per STOMP standards, suitable to be sent to the STOMP broker.
   *
   * @internal
   */
  static marshall(params) {
    const frame = new _FrameImpl(params);
    return frame.serialize();
  }
  /**
   *  Escape header values
   */
  static hdrValueEscape(str) {
    return str.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/:/g, "\\c");
  }
  /**
   * UnEscape header values
   */
  static hdrValueUnEscape(str) {
    return str.replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\c/g, ":").replace(/\\\\/g, "\\");
  }
};

// node_modules/@stomp/stompjs/esm6/parser.js
var NULL = 0;
var LF = 10;
var CR = 13;
var COLON = 58;
var Parser = class {
  constructor(onFrame, onIncomingPing) {
    this.onFrame = onFrame;
    this.onIncomingPing = onIncomingPing;
    this._encoder = new TextEncoder();
    this._decoder = new TextDecoder();
    this._token = [];
    this._initState();
  }
  parseChunk(segment, appendMissingNULLonIncoming = false) {
    let chunk;
    if (typeof segment === "string") {
      chunk = this._encoder.encode(segment);
    } else {
      chunk = new Uint8Array(segment);
    }
    if (appendMissingNULLonIncoming && chunk[chunk.length - 1] !== 0) {
      const chunkWithNull = new Uint8Array(chunk.length + 1);
      chunkWithNull.set(chunk, 0);
      chunkWithNull[chunk.length] = 0;
      chunk = chunkWithNull;
    }
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      this._onByte(byte);
    }
  }
  // The following implements a simple Rec Descent Parser.
  // The grammar is simple and just one byte tells what should be the next state
  _collectFrame(byte) {
    if (byte === NULL) {
      return;
    }
    if (byte === CR) {
      return;
    }
    if (byte === LF) {
      this.onIncomingPing();
      return;
    }
    this._onByte = this._collectCommand;
    this._reinjectByte(byte);
  }
  _collectCommand(byte) {
    if (byte === CR) {
      return;
    }
    if (byte === LF) {
      this._results.command = this._consumeTokenAsUTF8();
      this._onByte = this._collectHeaders;
      return;
    }
    this._consumeByte(byte);
  }
  _collectHeaders(byte) {
    if (byte === CR) {
      return;
    }
    if (byte === LF) {
      this._setupCollectBody();
      return;
    }
    this._onByte = this._collectHeaderKey;
    this._reinjectByte(byte);
  }
  _reinjectByte(byte) {
    this._onByte(byte);
  }
  _collectHeaderKey(byte) {
    if (byte === COLON) {
      this._headerKey = this._consumeTokenAsUTF8();
      this._onByte = this._collectHeaderValue;
      return;
    }
    this._consumeByte(byte);
  }
  _collectHeaderValue(byte) {
    if (byte === CR) {
      return;
    }
    if (byte === LF) {
      this._results.headers.push([
        this._headerKey,
        this._consumeTokenAsUTF8()
      ]);
      this._headerKey = void 0;
      this._onByte = this._collectHeaders;
      return;
    }
    this._consumeByte(byte);
  }
  _setupCollectBody() {
    const contentLengthHeader = this._results.headers.filter((header) => {
      return header[0] === "content-length";
    })[0];
    if (contentLengthHeader) {
      this._bodyBytesRemaining = parseInt(contentLengthHeader[1], 10);
      this._onByte = this._collectBodyFixedSize;
    } else {
      this._onByte = this._collectBodyNullTerminated;
    }
  }
  _collectBodyNullTerminated(byte) {
    if (byte === NULL) {
      this._retrievedBody();
      return;
    }
    this._consumeByte(byte);
  }
  _collectBodyFixedSize(byte) {
    if (this._bodyBytesRemaining-- === 0) {
      this._retrievedBody();
      return;
    }
    this._consumeByte(byte);
  }
  _retrievedBody() {
    this._results.binaryBody = this._consumeTokenAsRaw();
    try {
      this.onFrame(this._results);
    } catch (e) {
      console.log(`Ignoring an exception thrown by a frame handler. Original exception: `, e);
    }
    this._initState();
  }
  // Rec Descent Parser helpers
  _consumeByte(byte) {
    this._token.push(byte);
  }
  _consumeTokenAsUTF8() {
    return this._decoder.decode(this._consumeTokenAsRaw());
  }
  _consumeTokenAsRaw() {
    const rawResult = new Uint8Array(this._token);
    this._token = [];
    return rawResult;
  }
  _initState() {
    this._results = {
      command: void 0,
      headers: [],
      binaryBody: void 0
    };
    this._token = [];
    this._headerKey = void 0;
    this._onByte = this._collectFrame;
  }
};

// node_modules/@stomp/stompjs/esm6/types.js
var StompSocketState;
(function(StompSocketState2) {
  StompSocketState2[StompSocketState2["CONNECTING"] = 0] = "CONNECTING";
  StompSocketState2[StompSocketState2["OPEN"] = 1] = "OPEN";
  StompSocketState2[StompSocketState2["CLOSING"] = 2] = "CLOSING";
  StompSocketState2[StompSocketState2["CLOSED"] = 3] = "CLOSED";
})(StompSocketState || (StompSocketState = {}));
var ActivationState;
(function(ActivationState2) {
  ActivationState2[ActivationState2["ACTIVE"] = 0] = "ACTIVE";
  ActivationState2[ActivationState2["DEACTIVATING"] = 1] = "DEACTIVATING";
  ActivationState2[ActivationState2["INACTIVE"] = 2] = "INACTIVE";
})(ActivationState || (ActivationState = {}));
var ReconnectionTimeMode;
(function(ReconnectionTimeMode2) {
  ReconnectionTimeMode2[ReconnectionTimeMode2["LINEAR"] = 0] = "LINEAR";
  ReconnectionTimeMode2[ReconnectionTimeMode2["EXPONENTIAL"] = 1] = "EXPONENTIAL";
})(ReconnectionTimeMode || (ReconnectionTimeMode = {}));
var TickerStrategy;
(function(TickerStrategy2) {
  TickerStrategy2["Interval"] = "interval";
  TickerStrategy2["Worker"] = "worker";
})(TickerStrategy || (TickerStrategy = {}));

// node_modules/@stomp/stompjs/esm6/ticker.js
var Ticker = class {
  constructor(_interval, _strategy = TickerStrategy.Interval, _debug) {
    this._interval = _interval;
    this._strategy = _strategy;
    this._debug = _debug;
    this._workerScript = `
    var startTime = Date.now();
    setInterval(function() {
        self.postMessage(Date.now() - startTime);
    }, ${this._interval});
  `;
  }
  start(tick) {
    this.stop();
    if (this.shouldUseWorker()) {
      this.runWorker(tick);
    } else {
      this.runInterval(tick);
    }
  }
  stop() {
    this.disposeWorker();
    this.disposeInterval();
  }
  shouldUseWorker() {
    return typeof Worker !== "undefined" && this._strategy === TickerStrategy.Worker;
  }
  runWorker(tick) {
    this._debug("Using runWorker for outgoing pings");
    if (!this._worker) {
      this._worker = new Worker(URL.createObjectURL(new Blob([this._workerScript], { type: "text/javascript" })));
      this._worker.onmessage = (message) => tick(message.data);
    }
  }
  runInterval(tick) {
    this._debug("Using runInterval for outgoing pings");
    if (!this._timer) {
      const startTime = Date.now();
      this._timer = setInterval(() => {
        tick(Date.now() - startTime);
      }, this._interval);
    }
  }
  disposeWorker() {
    if (this._worker) {
      this._worker.terminate();
      delete this._worker;
      this._debug("Outgoing ping disposeWorker");
    }
  }
  disposeInterval() {
    if (this._timer) {
      clearInterval(this._timer);
      delete this._timer;
      this._debug("Outgoing ping disposeInterval");
    }
  }
};

// node_modules/@stomp/stompjs/esm6/versions.js
var Versions = class {
  /**
   * Takes an array of versions, typical elements '1.2', '1.1', or '1.0'
   *
   * You will be creating an instance of this class if you want to override
   * supported versions to be declared during STOMP handshake.
   */
  constructor(versions) {
    this.versions = versions;
  }
  /**
   * Used as part of CONNECT STOMP Frame
   */
  supportedVersions() {
    return this.versions.join(",");
  }
  /**
   * Used while creating a WebSocket
   */
  protocolVersions() {
    return this.versions.map((x) => `v${x.replace(".", "")}.stomp`);
  }
};
Versions.V1_0 = "1.0";
Versions.V1_1 = "1.1";
Versions.V1_2 = "1.2";
Versions.default = new Versions([
  Versions.V1_2,
  Versions.V1_1,
  Versions.V1_0
]);

// node_modules/@stomp/stompjs/esm6/stomp-handler.js
var StompHandler = class {
  get connectedVersion() {
    return this._connectedVersion;
  }
  get connected() {
    return this._connected;
  }
  constructor(_client, _webSocket, config) {
    this._client = _client;
    this._webSocket = _webSocket;
    this._connected = false;
    this._serverFrameHandlers = {
      // [CONNECTED Frame](https://stomp.github.com/stomp-specification-1.2.html#CONNECTED_Frame)
      CONNECTED: (frame) => {
        this.debug(`connected to server ${frame.headers.server}`);
        this._connected = true;
        this._connectedVersion = frame.headers.version;
        if (this._connectedVersion === Versions.V1_2) {
          this._escapeHeaderValues = true;
        }
        this._setupHeartbeat(frame.headers);
        this.onConnect(frame);
      },
      // [MESSAGE Frame](https://stomp.github.com/stomp-specification-1.2.html#MESSAGE)
      MESSAGE: (frame) => {
        const subscription = frame.headers.subscription;
        const onReceive = this._subscriptions[subscription] || this.onUnhandledMessage;
        const message = frame;
        const client = this;
        const messageId = this._connectedVersion === Versions.V1_2 ? message.headers.ack : message.headers["message-id"];
        message.ack = (headers = {}) => {
          return client.ack(messageId, subscription, headers);
        };
        message.nack = (headers = {}) => {
          return client.nack(messageId, subscription, headers);
        };
        onReceive(message);
      },
      // [RECEIPT Frame](https://stomp.github.com/stomp-specification-1.2.html#RECEIPT)
      RECEIPT: (frame) => {
        const callback = this._receiptWatchers[frame.headers["receipt-id"]];
        if (callback) {
          callback(frame);
          delete this._receiptWatchers[frame.headers["receipt-id"]];
        } else {
          this.onUnhandledReceipt(frame);
        }
      },
      // [ERROR Frame](https://stomp.github.com/stomp-specification-1.2.html#ERROR)
      ERROR: (frame) => {
        this.onStompError(frame);
      }
    };
    this._counter = 0;
    this._subscriptions = {};
    this._receiptWatchers = {};
    this._partialData = "";
    this._escapeHeaderValues = false;
    this._lastServerActivityTS = Date.now();
    this.debug = config.debug;
    this.stompVersions = config.stompVersions;
    this.connectHeaders = config.connectHeaders;
    this.disconnectHeaders = config.disconnectHeaders;
    this.heartbeatIncoming = config.heartbeatIncoming;
    this.heartbeatToleranceMultiplier = config.heartbeatGracePeriods;
    this.heartbeatOutgoing = config.heartbeatOutgoing;
    this.splitLargeFrames = config.splitLargeFrames;
    this.maxWebSocketChunkSize = config.maxWebSocketChunkSize;
    this.forceBinaryWSFrames = config.forceBinaryWSFrames;
    this.logRawCommunication = config.logRawCommunication;
    this.appendMissingNULLonIncoming = config.appendMissingNULLonIncoming;
    this.discardWebsocketOnCommFailure = config.discardWebsocketOnCommFailure;
    this.onConnect = config.onConnect;
    this.onDisconnect = config.onDisconnect;
    this.onStompError = config.onStompError;
    this.onWebSocketClose = config.onWebSocketClose;
    this.onWebSocketError = config.onWebSocketError;
    this.onUnhandledMessage = config.onUnhandledMessage;
    this.onUnhandledReceipt = config.onUnhandledReceipt;
    this.onUnhandledFrame = config.onUnhandledFrame;
    this.onHeartbeatReceived = config.onHeartbeatReceived;
    this.onHeartbeatLost = config.onHeartbeatLost;
  }
  start() {
    const parser = new Parser(
      // On Frame
      (rawFrame) => {
        const frame = FrameImpl.fromRawFrame(rawFrame, this._escapeHeaderValues);
        if (!this.logRawCommunication) {
          this.debug(`<<< ${frame}`);
        }
        const serverFrameHandler = this._serverFrameHandlers[frame.command] || this.onUnhandledFrame;
        serverFrameHandler(frame);
      },
      // On Incoming Ping
      () => {
        this.debug("<<< PONG");
        this.onHeartbeatReceived();
      }
    );
    this._webSocket.onmessage = (evt) => {
      this.debug("Received data");
      this._lastServerActivityTS = Date.now();
      if (this.logRawCommunication) {
        const rawChunkAsString = evt.data instanceof ArrayBuffer ? new TextDecoder().decode(evt.data) : evt.data;
        this.debug(`<<< ${rawChunkAsString}`);
      }
      parser.parseChunk(evt.data, this.appendMissingNULLonIncoming);
    };
    this._webSocket.onclose = (closeEvent) => {
      this.debug(`Connection closed to ${this._webSocket.url}`);
      this._cleanUp();
      this.onWebSocketClose(closeEvent);
    };
    this._webSocket.onerror = (errorEvent) => {
      this.onWebSocketError(errorEvent);
    };
    this._webSocket.onopen = () => {
      const connectHeaders = Object.assign({}, this.connectHeaders);
      this.debug("Web Socket Opened...");
      connectHeaders["accept-version"] = this.stompVersions.supportedVersions();
      connectHeaders["heart-beat"] = [
        this.heartbeatOutgoing,
        this.heartbeatIncoming
      ].join(",");
      this._transmit({ command: "CONNECT", headers: connectHeaders });
    };
  }
  _setupHeartbeat(headers) {
    if (headers.version !== Versions.V1_1 && headers.version !== Versions.V1_2) {
      return;
    }
    if (!headers["heart-beat"]) {
      return;
    }
    const [serverOutgoing, serverIncoming] = headers["heart-beat"].split(",").map((v) => parseInt(v, 10));
    if (this.heartbeatOutgoing !== 0 && serverIncoming !== 0) {
      const ttl = Math.max(this.heartbeatOutgoing, serverIncoming);
      this.debug(`send PING every ${ttl}ms`);
      this._pinger = new Ticker(ttl, this._client.heartbeatStrategy, this.debug);
      this._pinger.start(() => {
        if (this._webSocket.readyState === StompSocketState.OPEN) {
          this._webSocket.send(BYTE.LF);
          this.debug(">>> PING");
        }
      });
    }
    if (this.heartbeatIncoming !== 0 && serverOutgoing !== 0) {
      const ttl = Math.max(this.heartbeatIncoming, serverOutgoing);
      this.debug(`check PONG every ${ttl}ms`);
      this._ponger = setInterval(() => {
        const delta = Date.now() - this._lastServerActivityTS;
        if (delta > ttl * this.heartbeatToleranceMultiplier) {
          this.debug(`did not receive server activity for the last ${delta}ms`);
          this.onHeartbeatLost();
          this._closeOrDiscardWebsocket();
        }
      }, ttl);
    }
  }
  _closeOrDiscardWebsocket() {
    if (this.discardWebsocketOnCommFailure) {
      this.debug("Discarding websocket, the underlying socket may linger for a while");
      this.discardWebsocket();
    } else {
      this.debug("Issuing close on the websocket");
      this._closeWebsocket();
    }
  }
  forceDisconnect() {
    if (this._webSocket) {
      if (this._webSocket.readyState === StompSocketState.CONNECTING || this._webSocket.readyState === StompSocketState.OPEN) {
        this._closeOrDiscardWebsocket();
      }
    }
  }
  _closeWebsocket() {
    this._webSocket.onmessage = () => {
    };
    this._webSocket.close();
  }
  discardWebsocket() {
    if (typeof this._webSocket.terminate !== "function") {
      augmentWebsocket(this._webSocket, (msg) => this.debug(msg));
    }
    this._webSocket.terminate();
  }
  _transmit(params) {
    const { command, headers, body, binaryBody, skipContentLengthHeader } = params;
    const frame = new FrameImpl({
      command,
      headers,
      body,
      binaryBody,
      escapeHeaderValues: this._escapeHeaderValues,
      skipContentLengthHeader
    });
    let rawChunk = frame.serialize();
    if (this.logRawCommunication) {
      this.debug(`>>> ${rawChunk}`);
    } else {
      this.debug(`>>> ${frame}`);
    }
    if (this.forceBinaryWSFrames && typeof rawChunk === "string") {
      rawChunk = new TextEncoder().encode(rawChunk);
    }
    if (typeof rawChunk !== "string" || !this.splitLargeFrames) {
      this._webSocket.send(rawChunk);
    } else {
      let out = rawChunk;
      while (out.length > 0) {
        const chunk = out.substring(0, this.maxWebSocketChunkSize);
        out = out.substring(this.maxWebSocketChunkSize);
        this._webSocket.send(chunk);
        this.debug(`chunk sent = ${chunk.length}, remaining = ${out.length}`);
      }
    }
  }
  dispose() {
    if (this.connected) {
      try {
        const disconnectHeaders = Object.assign({}, this.disconnectHeaders);
        if (!disconnectHeaders.receipt) {
          disconnectHeaders.receipt = `close-${this._counter++}`;
        }
        this.watchForReceipt(disconnectHeaders.receipt, (frame) => {
          this._closeWebsocket();
          this._cleanUp();
          this.onDisconnect(frame);
        });
        this._transmit({ command: "DISCONNECT", headers: disconnectHeaders });
      } catch (error) {
        this.debug(`Ignoring error during disconnect ${error}`);
      }
    } else {
      if (this._webSocket.readyState === StompSocketState.CONNECTING || this._webSocket.readyState === StompSocketState.OPEN) {
        this._closeWebsocket();
      }
    }
  }
  _cleanUp() {
    this._connected = false;
    if (this._pinger) {
      this._pinger.stop();
      this._pinger = void 0;
    }
    if (this._ponger) {
      clearInterval(this._ponger);
      this._ponger = void 0;
    }
  }
  publish(params) {
    const { destination, headers, body, binaryBody, skipContentLengthHeader } = params;
    const hdrs = Object.assign({ destination }, headers);
    this._transmit({
      command: "SEND",
      headers: hdrs,
      body,
      binaryBody,
      skipContentLengthHeader
    });
  }
  watchForReceipt(receiptId, callback) {
    this._receiptWatchers[receiptId] = callback;
  }
  subscribe(destination, callback, headers = {}) {
    headers = Object.assign({}, headers);
    if (!headers.id) {
      headers.id = `sub-${this._counter++}`;
    }
    headers.destination = destination;
    this._subscriptions[headers.id] = callback;
    this._transmit({ command: "SUBSCRIBE", headers });
    const client = this;
    return {
      id: headers.id,
      unsubscribe(hdrs) {
        return client.unsubscribe(headers.id, hdrs);
      }
    };
  }
  unsubscribe(id, headers = {}) {
    headers = Object.assign({}, headers);
    delete this._subscriptions[id];
    headers.id = id;
    this._transmit({ command: "UNSUBSCRIBE", headers });
  }
  begin(transactionId) {
    const txId = transactionId || `tx-${this._counter++}`;
    this._transmit({
      command: "BEGIN",
      headers: {
        transaction: txId
      }
    });
    const client = this;
    return {
      id: txId,
      commit() {
        client.commit(txId);
      },
      abort() {
        client.abort(txId);
      }
    };
  }
  commit(transactionId) {
    this._transmit({
      command: "COMMIT",
      headers: {
        transaction: transactionId
      }
    });
  }
  abort(transactionId) {
    this._transmit({
      command: "ABORT",
      headers: {
        transaction: transactionId
      }
    });
  }
  ack(messageId, subscriptionId, headers = {}) {
    headers = Object.assign({}, headers);
    if (this._connectedVersion === Versions.V1_2) {
      headers.id = messageId;
    } else {
      headers["message-id"] = messageId;
    }
    headers.subscription = subscriptionId;
    this._transmit({ command: "ACK", headers });
  }
  nack(messageId, subscriptionId, headers = {}) {
    headers = Object.assign({}, headers);
    if (this._connectedVersion === Versions.V1_2) {
      headers.id = messageId;
    } else {
      headers["message-id"] = messageId;
    }
    headers.subscription = subscriptionId;
    return this._transmit({ command: "NACK", headers });
  }
};

// node_modules/@stomp/stompjs/esm6/client.js
var Client = class {
  /**
   * Provides access to the underlying WebSocket instance.
   * This property is **read-only**.
   *
   * Example:
   * ```javascript
   * const webSocket = client.webSocket;
   * if (webSocket) {
   *   console.log('WebSocket is connected:', webSocket.readyState === WebSocket.OPEN);
   * }
   * ```
   *
   * **Caution:**
   * Directly interacting with the WebSocket instance (e.g., sending or receiving frames)
   * can interfere with the proper functioning of this library. Such actions may cause
   * unexpected behavior, disconnections, or invalid state in the library's internal mechanisms.
   *
   * Instead, use the library's provided methods to manage STOMP communication.
   *
   * @returns The WebSocket instance used by the STOMP handler, or `undefined` if not connected.
   */
  get webSocket() {
    return this._stompHandler?._webSocket;
  }
  /**
   * Allows customization of the disconnection headers.
   *
   * Any changes made during an active session will also be applied immediately.
   *
   * Example:
   * ```javascript
   * client.disconnectHeaders = {
   *   receipt: 'custom-receipt-id'
   * };
   * ```
   */
  get disconnectHeaders() {
    return this._disconnectHeaders;
  }
  set disconnectHeaders(value) {
    this._disconnectHeaders = value;
    if (this._stompHandler) {
      this._stompHandler.disconnectHeaders = this._disconnectHeaders;
    }
  }
  /**
   * Indicates whether there is an active connection to the STOMP broker.
   *
   * Usage:
   * ```javascript
   * if (client.connected) {
   *   console.log('Client is connected to the broker.');
   * } else {
   *   console.log('No connection to the broker.');
   * }
   * ```
   *
   * @returns `true` if the client is currently connected, `false` otherwise.
   */
  get connected() {
    return !!this._stompHandler && this._stompHandler.connected;
  }
  /**
   * The version of the STOMP protocol negotiated with the server during connection.
   *
   * This is a **read-only** property and reflects the negotiated protocol version after
   * a successful connection.
   *
   * Example:
   * ```javascript
   * console.log('Connected STOMP version:', client.connectedVersion);
   * ```
   *
   * @returns The negotiated STOMP protocol version or `undefined` if not connected.
   */
  get connectedVersion() {
    return this._stompHandler ? this._stompHandler.connectedVersion : void 0;
  }
  /**
   * Indicates whether the client is currently active.
   *
   * A client is considered active if it is connected or actively attempting to reconnect.
   *
   * Example:
   * ```javascript
   * if (client.active) {
   *   console.log('The client is active.');
   * } else {
   *   console.log('The client is inactive.');
   * }
   * ```
   *
   * @returns `true` if the client is active, otherwise `false`.
   */
  get active() {
    return this.state === ActivationState.ACTIVE;
  }
  _changeState(state) {
    this.state = state;
    this.onChangeState(state);
  }
  /**
   * Constructs a new STOMP client instance.
   *
   * The constructor initializes default values and sets up no-op callbacks for all events.
   * Configuration can be passed during construction, or updated later using `configure`.
   *
   * Example:
   * ```javascript
   * const client = new Client({
   *   brokerURL: 'wss://broker.example.com',
   *   reconnectDelay: 5000
   * });
   * ```
   *
   * @param conf Optional configuration object to initialize the client with.
   */
  constructor(conf = {}) {
    this.stompVersions = Versions.default;
    this.connectionTimeout = 0;
    this.reconnectDelay = 5e3;
    this._nextReconnectDelay = 0;
    this.maxReconnectDelay = 15 * 60 * 1e3;
    this.reconnectTimeMode = ReconnectionTimeMode.LINEAR;
    this.heartbeatIncoming = 1e4;
    this.heartbeatToleranceMultiplier = 2;
    this.heartbeatOutgoing = 1e4;
    this.heartbeatStrategy = TickerStrategy.Interval;
    this.splitLargeFrames = false;
    this.maxWebSocketChunkSize = 8 * 1024;
    this.forceBinaryWSFrames = false;
    this.appendMissingNULLonIncoming = false;
    this.discardWebsocketOnCommFailure = false;
    this.state = ActivationState.INACTIVE;
    const noOp = () => {
    };
    this.debug = noOp;
    this.beforeConnect = noOp;
    this.onConnect = noOp;
    this.onDisconnect = noOp;
    this.onUnhandledMessage = noOp;
    this.onUnhandledReceipt = noOp;
    this.onUnhandledFrame = noOp;
    this.onHeartbeatReceived = noOp;
    this.onHeartbeatLost = noOp;
    this.onStompError = noOp;
    this.onWebSocketClose = noOp;
    this.onWebSocketError = noOp;
    this.logRawCommunication = false;
    this.onChangeState = noOp;
    this.connectHeaders = {};
    this._disconnectHeaders = {};
    this.configure(conf);
  }
  /**
   * Updates the client's configuration.
   *
   * All properties in the provided configuration object will override the current settings.
   *
   * Additionally, a warning is logged if `maxReconnectDelay` is configured to a
   * value lower than `reconnectDelay`, and `maxReconnectDelay` is adjusted to match `reconnectDelay`.
   *
   * Example:
   * ```javascript
   * client.configure({
   *   reconnectDelay: 3000,
   *   maxReconnectDelay: 10000
   * });
   * ```
   *
   * @param conf Configuration object containing the new settings.
   */
  configure(conf) {
    Object.assign(this, conf);
    if (this.maxReconnectDelay > 0 && this.maxReconnectDelay < this.reconnectDelay) {
      this.debug(`Warning: maxReconnectDelay (${this.maxReconnectDelay}ms) is less than reconnectDelay (${this.reconnectDelay}ms). Using reconnectDelay as the maxReconnectDelay delay.`);
      this.maxReconnectDelay = this.reconnectDelay;
    }
  }
  /**
   * Activates the client, initiating a connection to the STOMP broker.
   *
   * On activation, the client attempts to connect and sets its state to `ACTIVE`. If the connection
   * is lost, it will automatically retry based on `reconnectDelay` or `maxReconnectDelay`. If
   * `reconnectTimeMode` is set to `EXPONENTIAL`, the reconnect delay increases exponentially.
   *
   * To stop reconnection attempts and disconnect, call [Client#deactivate]{@link Client#deactivate}.
   *
   * Example:
   * ```javascript
   * client.activate(); // Connect to the broker
   * ```
   *
   * If the client is currently `DEACTIVATING`, connection is delayed until the deactivation process completes.
   */
  activate() {
    const _activate = () => {
      if (this.active) {
        this.debug("Already ACTIVE, ignoring request to activate");
        return;
      }
      this._changeState(ActivationState.ACTIVE);
      this._nextReconnectDelay = this.reconnectDelay;
      this._connect();
    };
    if (this.state === ActivationState.DEACTIVATING) {
      this.debug("Waiting for deactivation to finish before activating");
      this.deactivate().then(() => {
        _activate();
      });
    } else {
      _activate();
    }
  }
  async _connect() {
    await this.beforeConnect(this);
    if (this._stompHandler) {
      this.debug("There is already a stompHandler, skipping the call to connect");
      return;
    }
    if (!this.active) {
      this.debug("Client has been marked inactive, will not attempt to connect");
      return;
    }
    if (this.connectionTimeout > 0) {
      if (this._connectionWatcher) {
        clearTimeout(this._connectionWatcher);
      }
      this._connectionWatcher = setTimeout(() => {
        if (this.connected) {
          return;
        }
        this.debug(`Connection not established in ${this.connectionTimeout}ms, closing socket`);
        this.forceDisconnect();
      }, this.connectionTimeout);
    }
    this.debug("Opening Web Socket...");
    const webSocket = this._createWebSocket();
    this._stompHandler = new StompHandler(this, webSocket, {
      debug: this.debug,
      stompVersions: this.stompVersions,
      connectHeaders: this.connectHeaders,
      disconnectHeaders: this._disconnectHeaders,
      heartbeatIncoming: this.heartbeatIncoming,
      heartbeatGracePeriods: this.heartbeatToleranceMultiplier,
      heartbeatOutgoing: this.heartbeatOutgoing,
      heartbeatStrategy: this.heartbeatStrategy,
      splitLargeFrames: this.splitLargeFrames,
      maxWebSocketChunkSize: this.maxWebSocketChunkSize,
      forceBinaryWSFrames: this.forceBinaryWSFrames,
      logRawCommunication: this.logRawCommunication,
      appendMissingNULLonIncoming: this.appendMissingNULLonIncoming,
      discardWebsocketOnCommFailure: this.discardWebsocketOnCommFailure,
      onConnect: (frame) => {
        if (this._connectionWatcher) {
          clearTimeout(this._connectionWatcher);
          this._connectionWatcher = void 0;
        }
        this._nextReconnectDelay = this.reconnectDelay;
        if (!this.active) {
          this.debug("STOMP got connected while deactivate was issued, will disconnect now");
          this._disposeStompHandler();
          return;
        }
        this.onConnect(frame);
      },
      onDisconnect: (frame) => {
        this.onDisconnect(frame);
      },
      onStompError: (frame) => {
        this.onStompError(frame);
      },
      onWebSocketClose: (evt) => {
        this._stompHandler = void 0;
        if (this.state === ActivationState.DEACTIVATING) {
          this._changeState(ActivationState.INACTIVE);
        }
        this.onWebSocketClose(evt);
        if (this.active) {
          this._schedule_reconnect();
        }
      },
      onWebSocketError: (evt) => {
        this.onWebSocketError(evt);
      },
      onUnhandledMessage: (message) => {
        this.onUnhandledMessage(message);
      },
      onUnhandledReceipt: (frame) => {
        this.onUnhandledReceipt(frame);
      },
      onUnhandledFrame: (frame) => {
        this.onUnhandledFrame(frame);
      },
      onHeartbeatReceived: () => {
        this.onHeartbeatReceived();
      },
      onHeartbeatLost: () => {
        this.onHeartbeatLost();
      }
    });
    this._stompHandler.start();
  }
  _createWebSocket() {
    let webSocket;
    if (this.webSocketFactory) {
      webSocket = this.webSocketFactory();
    } else if (this.brokerURL) {
      webSocket = new WebSocket(this.brokerURL, this.stompVersions.protocolVersions());
    } else {
      throw new Error("Either brokerURL or webSocketFactory must be provided");
    }
    webSocket.binaryType = "arraybuffer";
    return webSocket;
  }
  _schedule_reconnect() {
    if (this._nextReconnectDelay > 0) {
      this.debug(`STOMP: scheduling reconnection in ${this._nextReconnectDelay}ms`);
      this._reconnector = setTimeout(() => {
        if (this.reconnectTimeMode === ReconnectionTimeMode.EXPONENTIAL) {
          this._nextReconnectDelay = this._nextReconnectDelay * 2;
          if (this.maxReconnectDelay !== 0) {
            this._nextReconnectDelay = Math.min(this._nextReconnectDelay, this.maxReconnectDelay);
          }
        }
        this._connect();
      }, this._nextReconnectDelay);
    }
  }
  /**
   * Disconnects the client and stops the automatic reconnection loop.
   *
   * If there is an active STOMP connection at the time of invocation, the appropriate callbacks
   * will be triggered during the shutdown sequence. Once deactivated, the client will enter the
   * `INACTIVE` state, and no further reconnection attempts will be made.
   *
   * **Behavior**:
   * - If there is no active WebSocket connection, this method resolves immediately.
   * - If there is an active connection, the method waits for the underlying WebSocket
   *   to properly close before resolving.
   * - Multiple calls to this method are safe. Each invocation resolves upon completion.
   * - To reactivate, call [Client#activate]{@link Client#activate}.
   *
   * **Experimental Option:**
   * - By specifying the `force: true` option, the WebSocket connection is discarded immediately,
   *   bypassing both the STOMP and WebSocket shutdown sequences.
   * - **Caution:** Using `force: true` may leave the WebSocket in an inconsistent state,
   *   and brokers may not immediately detect the termination.
   *
   * Example:
   * ```javascript
   * // Graceful disconnect
   * await client.deactivate();
   *
   * // Forced disconnect to speed up shutdown when the connection is stale
   * await client.deactivate({ force: true });
   * ```
   *
   * @param options Configuration options for deactivation. Use `force: true` for immediate shutdown.
   * @returns A Promise that resolves when the deactivation process completes.
   */
  async deactivate(options = {}) {
    const force = options.force || false;
    const needToDispose = this.active;
    let retPromise;
    if (this.state === ActivationState.INACTIVE) {
      this.debug(`Already INACTIVE, nothing more to do`);
      return Promise.resolve();
    }
    this._changeState(ActivationState.DEACTIVATING);
    this._nextReconnectDelay = 0;
    if (this._reconnector) {
      clearTimeout(this._reconnector);
      this._reconnector = void 0;
    }
    if (this._stompHandler && // @ts-ignore - if there is a _stompHandler, there is the webSocket
    this.webSocket.readyState !== StompSocketState.CLOSED) {
      const origOnWebSocketClose = this._stompHandler.onWebSocketClose;
      retPromise = new Promise((resolve, reject) => {
        this._stompHandler.onWebSocketClose = (evt) => {
          origOnWebSocketClose(evt);
          resolve();
        };
      });
    } else {
      this._changeState(ActivationState.INACTIVE);
      return Promise.resolve();
    }
    if (force) {
      this._stompHandler?.discardWebsocket();
    } else if (needToDispose) {
      this._disposeStompHandler();
    }
    return retPromise;
  }
  /**
   * Forces a disconnect by directly closing the WebSocket.
   *
   * Unlike a normal disconnect, this does not send a DISCONNECT sequence to the broker but
   * instead closes the WebSocket connection directly. After forcing a disconnect, the client
   * will automatically attempt to reconnect based on its `reconnectDelay` configuration.
   *
   * **Note:** To prevent further reconnect attempts, call [Client#deactivate]{@link Client#deactivate}.
   *
   * Example:
   * ```javascript
   * client.forceDisconnect();
   * ```
   */
  forceDisconnect() {
    if (this._stompHandler) {
      this._stompHandler.forceDisconnect();
    }
  }
  _disposeStompHandler() {
    if (this._stompHandler) {
      this._stompHandler.dispose();
    }
  }
  /**
   * Sends a message to the specified destination on the STOMP broker.
   *
   * The `body` must be a `string`. For non-string payloads (e.g., JSON), encode it as a string before sending.
   * If sending binary data, use the `binaryBody` parameter as a [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array).
   *
   * **Content-Length Behavior**:
   * - For non-binary messages, the `content-length` header is added by default.
   * - The `content-length` header can be skipped for text frames by setting `skipContentLengthHeader: true` in the parameters.
   * - For binary messages, the `content-length` header is always included.
   *
   * **Notes**:
   * - Ensure that brokers support binary frames before using `binaryBody`.
   * - Sending messages with NULL octets and missing `content-length` headers can cause brokers to disconnect and throw errors.
   *
   * Example:
   * ```javascript
   * // Basic text message
   * client.publish({ destination: "/queue/test", body: "Hello, STOMP" });
   *
   * // Text message with additional headers
   * client.publish({ destination: "/queue/test", headers: { priority: 9 }, body: "Hello, STOMP" });
   *
   * // Skip content-length header
   * client.publish({ destination: "/queue/test", body: "Hello, STOMP", skipContentLengthHeader: true });
   *
   * // Binary message
   * const binaryData = new Uint8Array([1, 2, 3, 4]);
   * client.publish({
   *   destination: '/topic/special',
   *   binaryBody: binaryData,
   *   headers: { 'content-type': 'application/octet-stream' }
   * });
   * ```
   */
  publish(params) {
    this._checkConnection();
    this._stompHandler.publish(params);
  }
  _checkConnection() {
    if (!this.connected) {
      throw new TypeError("There is no underlying STOMP connection");
    }
  }
  /**
   * Monitors for a receipt acknowledgment from the broker for specific operations.
   *
   * Add a `receipt` header to the operation (like subscribe or publish), and use this method with
   * the same receipt ID to detect when the broker has acknowledged the operation's completion.
   *
   * The callback is invoked with the corresponding {@link IFrame} when the receipt is received.
   *
   * Example:
   * ```javascript
   * const receiptId = "unique-receipt-id";
   *
   * client.watchForReceipt(receiptId, (frame) => {
   *   console.log("Operation acknowledged by the broker:", frame);
   * });
   *
   * // Attach the receipt header to an operation
   * client.publish({ destination: "/queue/test", headers: { receipt: receiptId }, body: "Hello" });
   * ```
   *
   * @param receiptId Unique identifier for the receipt.
   * @param callback Callback function invoked on receiving the RECEIPT frame.
   */
  watchForReceipt(receiptId, callback) {
    this._checkConnection();
    this._stompHandler.watchForReceipt(receiptId, callback);
  }
  /**
   * Subscribes to a destination on the STOMP broker.
   *
   * The callback is triggered for each message received from the subscribed destination. The message
   * is passed as an {@link IMessage} instance.
   *
   * **Subscription ID**:
   * - If no `id` is provided in `headers`, the library generates a unique subscription ID automatically.
   * - Provide an explicit `id` in `headers` if you wish to manage the subscription ID manually.
   *
   * Example:
   * ```javascript
   * const callback = (message) => {
   *   console.log("Received message:", message.body);
   * };
   *
   * // Auto-generated subscription ID
   * const subscription = client.subscribe("/queue/test", callback);
   *
   * // Explicit subscription ID
   * const mySubId = "my-subscription-id";
   * const subscription = client.subscribe("/queue/test", callback, { id: mySubId });
   * ```
   *
   * @param destination Destination to subscribe to.
   * @param callback Function invoked for each received message.
   * @param headers Optional headers for subscription, such as `id`.
   * @returns A {@link StompSubscription} which can be used to manage the subscription.
   */
  subscribe(destination, callback, headers = {}) {
    this._checkConnection();
    return this._stompHandler.subscribe(destination, callback, headers);
  }
  /**
   * Unsubscribes from a subscription on the STOMP broker.
   *
   * Prefer using the `unsubscribe` method directly on the {@link StompSubscription} returned from `subscribe` for cleaner management:
   * ```javascript
   * const subscription = client.subscribe("/queue/test", callback);
   * // Unsubscribe using the subscription object
   * subscription.unsubscribe();
   * ```
   *
   * This method can also be used directly with the subscription ID.
   *
   * Example:
   * ```javascript
   * client.unsubscribe("my-subscription-id");
   * ```
   *
   * @param id Subscription ID to unsubscribe.
   * @param headers Optional headers to pass for the UNSUBSCRIBE frame.
   */
  unsubscribe(id, headers = {}) {
    this._checkConnection();
    this._stompHandler.unsubscribe(id, headers);
  }
  /**
   * Starts a new transaction. The returned {@link ITransaction} object provides
   * methods for [commit]{@link ITransaction#commit} and [abort]{@link ITransaction#abort}.
   *
   * If `transactionId` is not provided, the library generates a unique ID internally.
   *
   * Example:
   * ```javascript
   * const tx = client.begin(); // Auto-generated ID
   *
   * // Or explicitly specify a transaction ID
   * const tx = client.begin("my-transaction-id");
   * ```
   *
   * @param transactionId Optional transaction ID.
   * @returns An instance of {@link ITransaction}.
   */
  begin(transactionId) {
    this._checkConnection();
    return this._stompHandler.begin(transactionId);
  }
  /**
   * Commits a transaction.
   *
   * It is strongly recommended to call [commit]{@link ITransaction#commit} on
   * the transaction object returned by [client#begin]{@link Client#begin}.
   *
   * Example:
   * ```javascript
   * const tx = client.begin();
   * // Perform operations under this transaction
   * tx.commit();
   * ```
   *
   * @param transactionId The ID of the transaction to commit.
   */
  commit(transactionId) {
    this._checkConnection();
    this._stompHandler.commit(transactionId);
  }
  /**
   * Aborts a transaction.
   *
   * It is strongly recommended to call [abort]{@link ITransaction#abort} directly
   * on the transaction object returned by [client#begin]{@link Client#begin}.
   *
   * Example:
   * ```javascript
   * const tx = client.begin();
   * // Perform operations under this transaction
   * tx.abort(); // Abort the transaction
   * ```
   *
   * @param transactionId The ID of the transaction to abort.
   */
  abort(transactionId) {
    this._checkConnection();
    this._stompHandler.abort(transactionId);
  }
  /**
   * Acknowledges receipt of a message. Typically, this should be done by calling
   * [ack]{@link IMessage#ack} directly on the {@link IMessage} instance passed
   * to the subscription callback.
   *
   * Example:
   * ```javascript
   * const callback = (message) => {
   *   // Process the message
   *   message.ack(); // Acknowledge the message
   * };
   *
   * client.subscribe("/queue/example", callback, { ack: "client" });
   * ```
   *
   * @param messageId The ID of the message to acknowledge.
   * @param subscriptionId The ID of the subscription.
   * @param headers Optional headers for the acknowledgment frame.
   */
  ack(messageId, subscriptionId, headers = {}) {
    this._checkConnection();
    this._stompHandler.ack(messageId, subscriptionId, headers);
  }
  /**
   * Rejects a message (negative acknowledgment). Like acknowledgments, this should
   * typically be done by calling [nack]{@link IMessage#nack} directly on the {@link IMessage}
   * instance passed to the subscription callback.
   *
   * Example:
   * ```javascript
   * const callback = (message) => {
   *   // Process the message
   *   if (isError(message)) {
   *     message.nack(); // Reject the message
   *   }
   * };
   *
   * client.subscribe("/queue/example", callback, { ack: "client" });
   * ```
   *
   * @param messageId The ID of the message to negatively acknowledge.
   * @param subscriptionId The ID of the subscription.
   * @param headers Optional headers for the NACK frame.
   */
  nack(messageId, subscriptionId, headers = {}) {
    this._checkConnection();
    this._stompHandler.nack(messageId, subscriptionId, headers);
  }
};

// node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// src/services/artemisWebsocketService.ts
var vscode16 = __toESM(require("vscode"));
var ArtemisWebsocketService = class {
  _client;
  _authManager;
  _isConnected = false;
  _reconnectAttempts = 0;
  _maxReconnectAttempts = 10;
  _reconnectDelay = 3e3;
  // 3 seconds
  _subscriptions = /* @__PURE__ */ new Map();
  _messageHandlers = [];
  constructor(authManager) {
    this._authManager = authManager;
  }
  /**
   * Register a message handler for WebSocket events
   */
  registerMessageHandler(handler) {
    this._messageHandlers.push(handler);
    this._log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
  }
  /**
   * Connect to the Artemis WebSocket server
   */
  async connect() {
    if (this._isConnected && this._client?.connected) {
      this._log("Already connected to Artemis WebSocket");
      return;
    }
    try {
      const serverUrl = this._getServerUrl();
      this._log(`Connecting to Artemis WebSocket...`);
      const cookie = await this._authManager.getCookieHeader();
      if (!cookie) {
        const errorMsg = "No authentication cookie available. Please log in first.";
        this._log(`\u26A0\uFE0F ${errorMsg}`);
        throw new Error(errorMsg);
      }
      const jwtToken = this._extractJwtFromCookie(cookie);
      if (!jwtToken) {
        const errorMsg = "Failed to extract JWT token from cookie";
        this._log(`\u26A0\uFE0F ${errorMsg}`);
        throw new Error(errorMsg);
      }
      const wsUrl = this._buildWebSocketUrl(serverUrl);
      this._log(`Connecting to ${wsUrl}`);
      const stompConfig = {
        brokerURL: wsUrl,
        connectHeaders: {},
        reconnectDelay: this._reconnectDelay,
        heartbeatIncoming: 1e4,
        heartbeatOutgoing: 1e4,
        webSocketFactory: () => {
          const ws = new wrapper_default(wsUrl, {
            headers: {
              "Cookie": cookie
            }
          });
          ws.on("error", (err) => {
            this._log(`WebSocket error: ${err.message}`);
          });
          return ws;
        },
        onConnect: () => {
          this._onConnected();
        },
        onStompError: (frame) => {
          this._onError(`STOMP error: ${frame.headers["message"]}`);
        },
        onWebSocketError: (event) => {
          this._onError(`WebSocket error`);
        },
        onDisconnect: () => {
          this._onDisconnected();
        }
      };
      this._client = new Client(stompConfig);
      this._client.activate();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this._onError(`Failed to connect to WebSocket: ${errorMessage}`);
      throw error;
    }
  }
  /**
   * Disconnect from the WebSocket server
   */
  async disconnect() {
    if (this._client) {
      this._log("Disconnecting from Artemis WebSocket");
      this._subscriptions.forEach((subscription, topic) => {
        subscription.unsubscribe();
        this._log(`Unsubscribed from ${topic}`);
      });
      this._subscriptions.clear();
      await this._client.deactivate();
      this._client = void 0;
      this._isConnected = false;
    }
  }
  /**
   * Subscribe to personal result updates for the authenticated user
   */
  subscribeToPersonalResults() {
    if (!this._isConnected || !this._client) {
      this._log("Cannot subscribe: not connected");
      return;
    }
    const topic = "/user/topic/newResults";
    if (this._subscriptions.has(topic)) {
      this._log(`Already subscribed to ${topic}`);
      return;
    }
    const subscription = this._client.subscribe(topic, (message) => {
      try {
        const result = JSON.parse(message.body);
        this._log(`Received new result: score=${result.score}, successful=${result.successful}`);
        this._messageHandlers.forEach((handler) => {
          if (handler.onNewResult) {
            handler.onNewResult(result);
          }
        });
      } catch (error) {
        this._log(`Error processing result message: ${error}`);
      }
    });
    this._subscriptions.set(topic, subscription);
    this._log(`Subscribed to ${topic}`);
  }
  /**
   * Subscribe to personal submission updates
   */
  subscribeToPersonalSubmissions() {
    if (!this._isConnected || !this._client) {
      this._log("Cannot subscribe: not connected");
      return;
    }
    const topic = "/user/topic/newSubmissions";
    if (this._subscriptions.has(topic)) {
      this._log(`Already subscribed to ${topic}`);
      return;
    }
    const subscription = this._client.subscribe(topic, (message) => {
      try {
        const submission = JSON.parse(message.body);
        this._log(`Received new submission: ${submission.id}`);
        this._messageHandlers.forEach((handler) => {
          if (handler.onNewSubmission) {
            handler.onNewSubmission(submission);
          }
        });
      } catch (error) {
        this._log(`Error processing submission message: ${error}`);
      }
    });
    this._subscriptions.set(topic, subscription);
    this._log(`Subscribed to ${topic}`);
  }
  /**
   * Subscribe to submission processing updates (build status)
   */
  subscribeToSubmissionProcessing() {
    if (!this._isConnected || !this._client) {
      this._log("Cannot subscribe: not connected");
      return;
    }
    const topic = "/user/topic/submissionProcessing";
    if (this._subscriptions.has(topic)) {
      this._log(`Already subscribed to ${topic}`);
      return;
    }
    const subscription = this._client.subscribe(topic, (message) => {
      try {
        const processingMsg = JSON.parse(message.body);
        this._log(`Received submission processing update: participationId=${processingMsg.participationId}`);
        this._messageHandlers.forEach((handler) => {
          if (handler.onSubmissionProcessing) {
            handler.onSubmissionProcessing(processingMsg);
          }
        });
      } catch (error) {
        this._log(`Error processing submission processing message: ${error}`);
      }
    });
    this._subscriptions.set(topic, subscription);
    this._log(`Subscribed to ${topic}`);
  }
  /**
   * Check if currently connected
   */
  isConnected() {
    return this._isConnected && this._client?.connected === true;
  }
  /**
   * Get connection status
   */
  getStatus() {
    if (this._isConnected && this._client?.connected) {
      return `Connected (${this._subscriptions.size} subscriptions)`;
    } else if (this._reconnectAttempts > 0) {
      return `Reconnecting (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})`;
    } else {
      return "Disconnected";
    }
  }
  /**
   * Get detailed debugging information with async cookie check
   */
  async getDebugInfoAsync() {
    const serverUrl = this._getServerUrl();
    const wsUrl = this._buildWebSocketUrl(serverUrl);
    const info = {
      isConnected: this._isConnected,
      clientConnected: this._client?.connected || false,
      clientActive: this._client?.active || false,
      subscriptionCount: this._subscriptions.size,
      subscriptions: Array.from(this._subscriptions.keys()),
      reconnectAttempts: this._reconnectAttempts,
      maxReconnectAttempts: this._maxReconnectAttempts,
      serverUrl,
      websocketUrl: wsUrl,
      hasCookie: false,
      hasJwtToken: false,
      cookiePreview: void 0
    };
    try {
      const cookie = await this._authManager.getCookieHeader();
      info.hasCookie = !!cookie;
      if (cookie) {
        const jwtToken = this._extractJwtFromCookie(cookie);
        info.hasJwtToken = !!jwtToken;
        info.cookiePreview = cookie.substring(0, 20) + "...";
      }
    } catch (error) {
      info.hasCookie = false;
      info.hasJwtToken = false;
    }
    return info;
  }
  /**
   * Dispose and cleanup
   */
  dispose() {
    this.disconnect();
  }
  // Private helper methods
  _onConnected() {
    this._isConnected = true;
    this._reconnectAttempts = 0;
    this._log("\u2705 Connected to Artemis WebSocket");
    this.subscribeToPersonalResults();
    this.subscribeToPersonalSubmissions();
    this.subscribeToSubmissionProcessing();
  }
  _onDisconnected() {
    this._isConnected = false;
    this._subscriptions.clear();
    this._log("Disconnected from Artemis WebSocket");
    if (this._reconnectAttempts < this._maxReconnectAttempts) {
      this._reconnectAttempts++;
      this._log(`Will attempt reconnection (${this._reconnectAttempts}/${this._maxReconnectAttempts})`);
    }
  }
  _onError(message) {
    this._log(`\u274C ${message}`);
    console.error(`[Artemis WebSocket] ${message}`);
  }
  _getServerUrl() {
    const config = vscode16.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
    return config.get(VSCODE_CONFIG.SERVER_URL_KEY) || "https://artemis.tum.de";
  }
  _buildWebSocketUrl(serverUrl) {
    const url = new URL(serverUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const wsEndpoint = `${protocol}//${url.host}/websocket/websocket`;
    this._log(`Using direct STOMP endpoint (no SockJS): ${wsEndpoint}`);
    return wsEndpoint;
  }
  _extractJwtFromCookie(cookieHeader) {
    const jwtMatch = cookieHeader.match(/jwt=([^;]+)/);
    return jwtMatch ? jwtMatch[1] : void 0;
  }
  _log(message) {
    console.log(`[Artemis WebSocket] ${message}`);
  }
};

// src/extension.ts
async function activate(context) {
  console.log('Congratulations, your extension "iris-thaumantias" is now active!');
  const authManager = new AuthManager(context);
  const artemisApiService = new ArtemisApiService(authManager);
  const artemisWebsocketService = new ArtemisWebsocketService(authManager);
  const updateAuthContext = async (isAuthenticated) => {
    await vscode17.commands.executeCommand("setContext", "iris:authenticated", isAuthenticated);
    if (isAuthenticated) {
      setTimeout(async () => {
        try {
          await artemisWebsocketService.connect();
        } catch (error) {
          console.error("Failed to connect to Artemis WebSocket:", error);
        }
      }, 500);
    } else {
      await artemisWebsocketService.disconnect();
    }
  };
  const initializeAuthContext = async () => {
    try {
      const isAuthenticated = await authManager.hasArtemisToken();
      await vscode17.commands.executeCommand("setContext", "iris:authenticated", isAuthenticated);
      if (isAuthenticated) {
        const cookie = await authManager.getCookieHeader();
        if (cookie) {
          setTimeout(async () => {
            try {
              await artemisWebsocketService.connect();
            } catch (error) {
              console.error("Failed to connect to Artemis WebSocket on startup:", error);
            }
          }, 1e3);
        }
      }
    } catch (error) {
      console.error("Error checking initial auth state:", error);
      await vscode17.commands.executeCommand("setContext", "iris:authenticated", false);
    }
  };
  await initializeAuthContext();
  const artemisWebviewProvider = new ArtemisWebviewProvider(context.extensionUri, context, authManager, artemisApiService);
  artemisWebviewProvider.setAuthContextUpdater(updateAuthContext);
  artemisWebviewProvider.setWebsocketService(artemisWebsocketService);
  context.subscriptions.push(
    vscode17.window.registerWebviewViewProvider(ArtemisWebviewProvider.viewType, artemisWebviewProvider)
  );
  const chatWebviewProvider = new ChatWebviewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode17.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatWebviewProvider)
  );
  global.artemisWebviewProvider = artemisWebviewProvider;
  global.chatWebviewProvider = chatWebviewProvider;
  const loginCommand = vscode17.commands.registerCommand("artemis.login", () => {
    vscode17.commands.executeCommand("artemis.loginView.focus");
  });
  const logoutCommand = vscode17.commands.registerCommand("artemis.logout", async () => {
    try {
      await authManager.clear();
      await updateAuthContext(false);
      vscode17.window.showInformationMessage("Successfully logged out of Artemis");
      artemisWebviewProvider.showLogin();
    } catch (error) {
      console.error("Logout error:", error);
      vscode17.window.showErrorMessage("Error during logout");
    }
  });
  const checkIrisHealthCommand = vscode17.commands.registerCommand("artemis.checkIrisHealth", async () => {
    try {
      if (!await authManager.hasArtemisToken()) {
        vscode17.window.showWarningMessage("Please log in to Artemis first before checking Iris health status.");
        return;
      }
      await vscode17.window.withProgress({
        location: vscode17.ProgressLocation.Notification,
        title: "Checking Iris Health Status...",
        cancellable: false
      }, async (progress) => {
        try {
          const healthStatus = await artemisApiService.checkIrisHealth();
          if (healthStatus.active === true) {
            const rateLimitInfo = healthStatus.rateLimitInfo;
            let message = "\u2705 Iris is active and healthy!";
            if (rateLimitInfo) {
              const currentMessages = rateLimitInfo.currentMessageCount || 0;
              const rateLimit = rateLimitInfo.rateLimit || 0;
              const timeframeHours = rateLimitInfo.rateLimitTimeframeHours || 0;
              if (rateLimit > 0) {
                message += `
\u{1F4CA} Rate Limit: ${currentMessages}/${rateLimit} messages`;
                if (timeframeHours > 0) {
                  message += ` (${timeframeHours}h window)`;
                }
              }
            }
            vscode17.window.showInformationMessage(message);
          } else {
            vscode17.window.showWarningMessage("\u26A0\uFE0F Iris is currently inactive or unavailable.");
          }
        } catch (error) {
          console.error("Iris health check failed:", error);
          let errorMessage = "\u274C Failed to check Iris health status.";
          if (error instanceof Error) {
            if (error.message.includes("Authentication failed")) {
              errorMessage += " Please log in again.";
            } else if (error.message.includes("404")) {
              errorMessage += " Iris might not be available on this server.";
            } else {
              errorMessage += ` Error: ${error.message}`;
            }
          }
          vscode17.window.showErrorMessage(errorMessage);
        }
      });
    } catch (error) {
      console.error("Error executing Iris health check command:", error);
      vscode17.window.showErrorMessage("Failed to execute Iris health check command.");
    }
  });
  const checkWebSocketStatusCommand = vscode17.commands.registerCommand("artemis.checkWebSocketStatus", async () => {
    try {
      const debugInfo = await artemisWebsocketService.getDebugInfoAsync();
      const isConnected = artemisWebsocketService.isConnected();
      const icon = isConnected ? "\u{1F7E2}" : "\u{1F534}";
      const statusLines = [
        `${icon} **WebSocket Status**`,
        ``,
        `**Connection:**`,
        `\u2022 Connected: ${debugInfo.isConnected ? "Yes \u2705" : "No \u274C"}`,
        `\u2022 Client Active: ${debugInfo.clientActive ? "Yes \u2705" : "No \u274C"}`,
        `\u2022 Client Connected: ${debugInfo.clientConnected ? "Yes \u2705" : "No \u274C"}`,
        ``,
        `**Subscriptions (${debugInfo.subscriptionCount}):**`,
        ...debugInfo.subscriptions.map((sub) => `\u2022 ${sub}`)
      ];
      if (!isConnected && !debugInfo.hasCookie) {
        statusLines.push(``, `\u26A0\uFE0F **Not connected - Please log in to Artemis first**`);
      }
      statusLines.push(
        ``,
        `**Configuration:**`,
        `\u2022 Server URL: ${debugInfo.serverUrl}`,
        `\u2022 WebSocket URL: ${debugInfo.websocketUrl}`,
        ``,
        `**Authentication:**`,
        `\u2022 Has Cookie: ${debugInfo.hasCookie ? "Yes \u2705" : "No \u274C"}`,
        `\u2022 Has JWT Token: ${debugInfo.hasJwtToken ? "Yes \u2705" : "No \u274C"}`
      );
      if (debugInfo.cookiePreview) {
        statusLines.push(`\u2022 Cookie Preview: ${debugInfo.cookiePreview}`);
      }
      statusLines.push(
        ``,
        `**Reconnection:**`,
        `\u2022 Attempts: ${debugInfo.reconnectAttempts}/${debugInfo.maxReconnectAttempts}`
      );
      const message = statusLines.join("\n");
      let actions;
      if (!debugInfo.hasCookie) {
        actions = ["Login to Artemis", "Show Details", "Copy to Clipboard"];
      } else if (!isConnected) {
        actions = ["Retry Connection", "Show Details", "Copy to Clipboard"];
      } else {
        actions = ["Show Details", "Copy to Clipboard"];
      }
      const action = await vscode17.window.showInformationMessage(
        `${icon} WebSocket: ${isConnected ? "Connected" : "Disconnected"}${!debugInfo.hasCookie ? " (Not logged in)" : ""}`,
        { modal: false },
        ...actions
      );
      if (action === "Login to Artemis") {
        await vscode17.commands.executeCommand("artemis.loginView.focus");
      } else if (action === "Retry Connection") {
        try {
          await artemisWebsocketService.connect();
          vscode17.window.showInformationMessage("WebSocket connection attempt started...");
        } catch (error) {
          vscode17.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      } else if (action === "Show Details") {
        const doc = await vscode17.workspace.openTextDocument({
          content: message,
          language: "markdown"
        });
        await vscode17.window.showTextDocument(doc, { preview: true });
      } else if (action === "Copy to Clipboard") {
        await vscode17.env.clipboard.writeText(message);
        vscode17.window.showInformationMessage("WebSocket status copied to clipboard");
      }
    } catch (error) {
      console.error("Error checking WebSocket status:", error);
      vscode17.window.showErrorMessage(`Failed to check WebSocket status: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  });
  const connectWebSocketCommand = vscode17.commands.registerCommand("artemis.connectWebSocket", async () => {
    try {
      const isAuthenticated = await authManager.hasArtemisToken();
      if (!isAuthenticated) {
        const action = await vscode17.window.showWarningMessage(
          "Please log in to Artemis before connecting to WebSocket",
          "Open Login"
        );
        if (action === "Open Login") {
          await vscode17.commands.executeCommand("artemis.loginView.focus");
        }
        return;
      }
      await vscode17.window.withProgress({
        location: vscode17.ProgressLocation.Notification,
        title: "Connecting to Artemis WebSocket...",
        cancellable: false
      }, async () => {
        try {
          await artemisWebsocketService.connect();
          vscode17.window.showInformationMessage("\u2705 Successfully connected to Artemis WebSocket");
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          vscode17.window.showErrorMessage(`\u274C Failed to connect to WebSocket: ${errorMsg}`);
          const action = await vscode17.window.showErrorMessage(
            "WebSocket connection failed. Check the Developer Console for details.",
            "Check Status"
          );
          if (action === "Check Status") {
            vscode17.commands.executeCommand("artemis.checkWebSocketStatus");
          }
        }
      });
    } catch (error) {
      console.error("Error in connect WebSocket command:", error);
      vscode17.window.showErrorMessage("Failed to execute connect command");
    }
  });
  const renderPlantUmlFromWebviewCommand = vscode17.commands.registerCommand(
    "artemis.renderPlantUmlFromWebview",
    async (plantUmlText, exerciseTitle) => {
      try {
        console.log("\u{1F3A8} Rendering PlantUML from webview");
        console.log("\u{1F4CA} PlantUML content:", plantUmlText);
        const processedPlantUml = processPlantUml(plantUmlText);
        console.log("\u2705 Processed PlantUML:", processedPlantUml);
        const isDarkTheme = vscode17.window.activeColorTheme.kind === vscode17.ColorThemeKind.Dark;
        const svgContent = await artemisApiService.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);
        const htmlContent = `
					<!DOCTYPE html>
					<html lang="en">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>PlantUML - ${exerciseTitle || "Diagram"}</title>
						<style>
							body {
								margin: 0;
								padding: 20px;
								display: flex;
								justify-content: center;
								align-items: center;
								min-height: 100vh;
								background-color: var(--vscode-editor-background);
								overflow: auto;
							}
							.diagram-container {
								display: inline-block;
								max-width: 100%;
								max-height: 100%;
							}
							svg {
								display: block;
								max-width: 100%;
								max-height: 100%;
								width: auto !important;
								height: auto !important;
							}
						</style>
					</head>
					<body>
						<div class="diagram-container">
							${svgContent}
						</div>
					</body>
					</html>
				`;
        const panel = vscode17.window.createWebviewPanel(
          "plantUmlRenderer",
          `PlantUML - ${exerciseTitle || "Diagram"}`,
          vscode17.ViewColumn.One,
          {
            enableScripts: false,
            retainContextWhenHidden: true
          }
        );
        panel.webview.html = htmlContent;
        vscode17.window.showInformationMessage("\u2705 PlantUML diagram rendered successfully!");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        vscode17.window.showErrorMessage(`\u274C Failed to render PlantUML: ${errorMsg}`);
        console.error("PlantUML rendering error:", error);
      }
    }
  );
  const configChangeListener = vscode17.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SERVER_URL_KEY}`)) {
      console.log("Artemis server URL configuration changed");
      const config = vscode17.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
      const newServerUrl = config.get(VSCODE_CONFIG.SERVER_URL_KEY);
      if (newServerUrl) {
        vscode17.window.showInformationMessage(
          `Artemis server URL updated to: ${newServerUrl}. You may need to log in again if you were authenticated to a different server.`,
          "Clear Credentials"
        ).then((selection) => {
          if (selection === "Clear Credentials") {
            authManager.clear().then(async () => {
              await updateAuthContext(false);
              vscode17.window.showInformationMessage("Stored credentials cleared. Please log in again.");
              artemisWebviewProvider.showLogin();
            });
          }
        });
      }
    }
    if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.THEME_KEY}`)) {
      console.log("Artemis theme configuration changed");
      artemisWebviewProvider.refreshTheme();
      chatWebviewProvider.refreshTheme();
    }
    if (event.affectsConfiguration(`${VSCODE_CONFIG.ARTEMIS_SECTION}.${VSCODE_CONFIG.SHOW_IRIS_EXPLANATION_KEY}`)) {
      console.log("Artemis showIrisExplanation configuration changed");
      artemisWebviewProvider.refreshTheme();
    }
  });
  context.subscriptions.push(loginCommand);
  context.subscriptions.push(logoutCommand);
  context.subscriptions.push(checkIrisHealthCommand);
  context.subscriptions.push(checkWebSocketStatusCommand);
  context.subscriptions.push(connectWebSocketCommand);
  context.subscriptions.push(renderPlantUmlFromWebviewCommand);
  context.subscriptions.push(configChangeListener);
  context.subscriptions.push(artemisWebsocketService);
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
