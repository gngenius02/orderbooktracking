let findDifferenceOf

const { StreamClient } = require('cw-sdk-node')

const client = new StreamClient({
	creds: { apiKey: '', secretKey: '' },
	subscriptions: ['markets:579:book:deltas', 'markets:579:book:snapshots'],
	logLevel: 'none'
})

const getTime = (_) => new Date().toLocaleTimeString()

const myData = { bids: new Map(), asks: new Map(), seqNum: 0 }

const getDifference = (current, newvalue) => Math.abs(Number(current) - Number(newvalue))

const checkRetraction = (current, newvalue) => Number(newvalue) < Number(current)

const getTwoDigitPrice = (price) => Number(price).toFixed(2)

const logdata = {
	bids: [],
	asks: []
}

const logprep = () => {
	console.clear()
	const objs = Object.entries(logdata);
	let [key, data] = objs;

	data = data.splice(0,10)
	const transformed = data.reduce((acc, { time, ...x }) => {
			acc[time] = x
			return acc
		}, {})
	console.log(key.toUpperCase())
	console.table(transformed)
	}
}

function shouldReport(curValue, newValue, type, price) {
	if ((diff = getDifference(curValue, newValue)) > findDifferenceOf) {
		const op = checkRetraction(curValue, newValue) ? '\u25BC' : '\u25B2'
		const volume = `${op}${diff.toFixed(8).padStart(14)}`
		price = `${Number(price).toFixed(2)}`
		logdata[type].unshift({ time: getTime(), volume, price })
		logprep()
	}
	console.gr
}

const processRemoval = (type, price) => {
	entry = getTwoDigitPrice(price)
	if ((diff = Number(myData[type].get(entry))) > findDifferenceOf) {
		const op = 'X'
		const volume = `${op}${diff.toFixed(8).padStart(14)}`
		price = `${Number(price).toFixed(2)}`
		logdata[type].unshift({ time: getTime(), volume, price })
		logprep()
	}
	myData[type].delete(entry)
}

const processEntryBasedOnVolumeAmount = (type, entry) => {
	let { price, amount: newValue } = entry
	price = getTwoDigitPrice(price)
	const curValue = myData[type].get(price) || 0
	shouldReport(curValue, newValue, type, price)
	return myData[type].set(price, newValue)
}

const handleNewDelta = (orderBookDelta) => {
	const { seqNum } = orderBookDelta
	if (seqNum === myData['seqNum']) {
		console.log('this seqNum was the same as last one so droping this packet.')
		return
	}
	;['bids', 'asks'].forEach((key) => {
		const { remove, set } = orderBookDelta[key]
		remove.forEach((entry) => processRemoval(key, entry))
		set.forEach((entry) => processEntryBasedOnVolumeAmount(key, entry))
	})
}

const handleNewSnapshot = (orderBookSnapshot) => {
	const { seqNum } = orderBookSnapshot
	if (seqNum === myData['seqNum']) {
		console.log('this seqNum was the same as last one so droping this packet.')
		return
	}
	;['bids', 'asks'].forEach((key) => {
		for (let { price, amount } of orderBookSnapshot[key]) {
			if (myData[key].has(price)) {
				let curValue = myData[key].get(price)
				if (getDifference(curValue, amount) > findDifferenceOf) {
					shouldReport(curValue, amount, 'key', price)
				}
			}
			myData[key].set(price, amount)
		}
	})
	console.log('Snapshot Processed.')
}

// Handlers for market and pair data
client.onMarketUpdate((marketData) => {
	;(snapshot = marketData?.orderBookSnapshot) ? handleNewSnapshot(snapshot) : null
	;(delta = marketData?.orderBookDelta) ? handleNewDelta(delta) : null
})

// Error handling
client.onError((err) => {
	console.error(err)
})

const fetch = require('node-fetch')
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })

rl.question('ENTER THRESHOLD VALUE: (Default = 5) ', (threshold) => {
	if (!threshold || threshold === '') threshold = 5
	findDifferenceOf = threshold

	fetch('https://api.cryptowat.ch/markets/binance/BTCUSDT/orderbook?limit=5000')
		.then((r) => r.json())
		.then((data) => {
			// console.log(data.result)
			const { bids, asks, seqNum } = data.result

			for (let [price, amount] of bids) {
				myData['bids'].set(price.toFixed(2), amount.toFixed(8))
			}
			for (let [price, amount] of asks) {
				myData['asks'].set(price.toFixed(2), amount.toFixed(8))
			}
			myData['seqNum'] = seqNum
			console.log('\nBIDS SIZE:', myData.bids.size, '\nASKS SIZE:', myData.asks.size)
			// console.log('starting websocket', myData)
			client.connect()
		})
})
