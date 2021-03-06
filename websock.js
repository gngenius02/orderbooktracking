'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const tslib_1 = require('tslib')
const crypto_1 = tslib_1.__importDefault(require('crypto'))
const events_1 = require('events')
const ws_1 = tslib_1.__importDefault(require('ws'))
const constants_1 = require('./constants')
const proto_1 = require('./modules/proto')
const helpers_1 = require('../util/helpers')
const logger_1 = tslib_1.__importDefault(require('../util/logger'))
const version_1 = tslib_1.__importDefault(require('../version'))
const errors_1 = require('./errors')
// These will be overwritten by the opts object passed to the constructor
const defaultReconnectOpts = {
	enabled: true,
	backoff: true,
	timeout: 0,
	maxTimeout: 3
}
// Amount to increase backoff every unsuccessful reconnect attempt
const backoffIncrementSecs = 0.5
// Generate a nonce for api authentication
function getNonce() {
	return String(new Date().getTime() * 1000 * 1000)
}
// Generate a token for api authentication
function getToken(key, secret, nonce) {
	const hmac = crypto_1.default.createHmac('sha512', Buffer.from(secret, 'base64'))
	hmac.update(`stream_access;access_key_id=${key};nonce=${nonce};`)
	return hmac.digest('base64')
}
class WebSocketClient extends events_1.EventEmitter {
	// Default to defaultOptions
	constructor(opts) {
		super()
		logger_1.default.setLevel(opts.logLevel)
		if (!opts.creds.apiKey) {
			// throw new Error('Missing credential apiKey')
		}
		if (!opts.creds.secretKey) {
			// throw new Error('Missing credential secretKey')
		}
		// This code merges the supplied reconnect options with the default reconnect options,
		// then sets opts.reconnect to a copy (to avoid modifying defaultReconnectOpts)
		opts.reconnect = Object.assign({}, defaultReconnectOpts, opts.reconnect || {})
		// Minimum reconnect timeout without backoff is 1s
		if (!opts.reconnect.backoff && opts.reconnect.timeout < 1) {
			opts.reconnect.timeout = 1
		}
		logger_1.default.debug('new ws conn %o', opts)
		this.on(constants_1.EventWSAuthResult, (res) => this.authResultHandler(res))
		this.opts = opts
		this.conn = null
		this.reconnectDisabled = false
		this.reconnectTimeout = opts.reconnect.timeout
		this.connState = constants_1.StateDisconnected
		this.subscriptions = {}
	}
	connect() {
		logger_1.default.debug('connecting to %s', this.opts.creds.url)
		this.changeState(constants_1.StateConnecting)
		this.reconnectDisabled = false
		this.conn = new ws_1.default(this.opts.creds.url)
		this.conn.once('open', () => {
			this.authenticate()
		})
		this.conn.on('message', (data) => {
			// Heartbeat
			// const bytes = new Uint8Array(data);
			if (data.length === 1 && data[0] === 1) {
				return
			}
			// Emit protobuf data internally
			this.emit(constants_1.EventWSData, data)
		})
		this.conn.once('error', () => {
			this.error('Connection failed')
		})
		this.conn.once('close', () => {
			this.changeState(constants_1.StateDisconnected)
			if (this.opts.reconnect.enabled && !this.reconnectDisabled) {
				this.reconnect()
			}
		})
	}
	error(e) {
		logger_1.default.error(e)
		this.emit(constants_1.EventClientError, e)
	}
	onConnect(fn) {
		this.on(constants_1.StateConnected, () => fn())
	}
	onDisconnect(fn) {
		this.on(constants_1.StateDisconnected, () => fn())
	}
	onStateChange(fn) {
		this.on(constants_1.EventStateChange, (newState) => fn(newState))
	}
	onError(fn) {
		this.on(constants_1.EventClientError, (err) => fn(err))
	}
	send(data) {
		if (!this.conn) {
			throw errors_1.errConnNotReady
		}
		this.conn.send(data)
	}
	disconnect() {
		if (!this.conn) {
			throw errors_1.errConnNotReady
		}
		this.reconnectDisabled = true
		this.conn.close()
	}
	state() {
		return this.connState
	}
	getSubscriptions() {
		const subs = []
		Object.keys(this.subscriptions).forEach((key) => {
			subs.push(this.subscriptions[key])
		})
		return subs
	}
	authenticate() {
		// The client should never supply its own nonce, this is just for tests
		const nonce = this.opts.nonce ? this.opts.nonce : getNonce()
		const authMsg = proto_1.ProtobufClient.ClientMessage.create({
			apiAuthentication: proto_1.ProtobufClient.APIAuthenticationMessage.create({
				apiKey: this.opts.creds.apiKey,
				clientSubscriptions: this.getSubscriptions(),
				nonce,
				source: proto_1.ProtobufClient.APIAuthenticationMessage.Source.NODE_SDK,
				token: getToken(this.opts.creds.apiKey, this.opts.creds.secretKey, nonce),
				version: version_1.default
			})
		})
		logger_1.default.debug('sending auth message')
		this.send(proto_1.ProtobufClient.ClientMessage.encode(authMsg).finish())
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	changeState(newState, extra) {
		this.connState = newState
		if (typeof extra !== 'undefined') {
			logger_1.default.debug(helpers_1.symbolString(newState), extra)
			this.emit(newState, extra)
		} else {
			logger_1.default.debug('State change: %s', helpers_1.symbolString(newState))
			this.emit(newState)
		}
		this.emit(constants_1.EventStateChange, newState)
	}
	authResultHandler(authResult) {
		switch (authResult.status) {
			case proto_1.ProtobufStream.AuthenticationResult.Status.AUTHENTICATED:
				logger_1.default.debug('authenticated')
				this.changeState(constants_1.StateConnected)
				break
			case proto_1.ProtobufStream.AuthenticationResult.Status.TOKEN_EXPIRED:
				this.error('Authentication failed: token is expired')
				this.disconnect()
				break
			case proto_1.ProtobufStream.AuthenticationResult.Status.BAD_NONCE:
				this.error('Authentication failed: invalid nonce')
				this.disconnect()
				break
			case proto_1.ProtobufStream.AuthenticationResult.Status.BAD_TOKEN:
				this.error('Authentication failed: invalid token')
				this.disconnect()
				break
			case proto_1.ProtobufStream.AuthenticationResult.Status.UNKNOWN:
				this.error('Authentication failed: internal error')
				this.disconnect()
				break
			default:
				break
		}
	}
	reconnect() {
		setTimeout(() => {
			if (this.opts.reconnect.backoff) {
				this.reconnectTimeout += backoffIncrementSecs
				if (this.reconnectTimeout > this.opts.reconnect.maxTimeout) {
					this.reconnectTimeout = this.opts.reconnect.maxTimeout
				}
			}
			this.connect()
		}, this.reconnectTimeout * 1000)
		// This needs to be after setTimeout so tests work. This is because jest needs to run
		// the mocked timers in the state change callback.
		this.changeState(constants_1.StateWaitingToReconnect, this.reconnectTimeout)
	}
}
exports.default = WebSocketClient
//# sourceMappingURL=WebSocketClient.js.map
