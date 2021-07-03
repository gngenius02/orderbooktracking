const findDifferenceOf = 5 // <~~~~~ this is the threshold that its comparing to see if its bigger then.

const { StreamClient } = require('cw-sdk-node')

const client = new StreamClient({
	creds: { apiKey: '', secretKey: '' },
	subscriptions: ['markets:579:book:deltas'],
	logLevel: 'debug'
})

const myData = { bids: new Map(), asks: new Map(), seqNum: 0 }

const processRemoval = (type, price) => {
	entry = getTwoDigitPrice(price)
	if (Number(myData[type].get(entry)) > findDifferenceOf) {
		console.log('DELETED::::\t', Number(myData[type].get(entry)), '\tat Price of:::', Number(entry))
	}
	myData[type].delete(entry)
}

const getDifference = (current, newvalue) => Math.abs(Number(current) - Number(newvalue))

const checkRetraction = (current, newvalue) => Number(newvalue) < Number(current)

const getTwoDigitPrice = (price) => Number(price).toFixed(2)

const processEntryBasedOnVolumeAmount = (type, entry) => {
	let { price, amount: newValue } = entry
	price = getTwoDigitPrice(price)
	const curValue = myData[type].get(price) || 0
	if (getDifference(curValue, newValue) > findDifferenceOf) {
		if (checkRetraction(curValue, newValue)) {
			console.log(
				'RETRACTED:::\t',
				getDifference(curValue, newValue),
				'\tat Price of :::',
				Number(price)
			)
		} else {
			console.log(
				'NEW ORDER ::::\t',
				getDifference(curValue, newValue),
				'\tat Price of :::',
				Number(price)
			)
		}
	}
	return myData[type].set(price, newValue)
}

const handleNewInstructions = (type, ops) => {
	const { remove, set } = ops
	for (let entry of remove) {
		processRemoval(type, entry)
	}
	for (let entry of set) {
		processEntryBasedOnVolumeAmount(type, entry)
	}
}

const handleNewDelta = (orderBookDelta) => {
	if (!orderBookDelta) return
	const keys = Object.keys(orderBookDelta)
	for (let key of keys) {
		if (key === 'seqNum') {
			if (orderBookDelta[key] === myData[key]) {
				console.log('this seqNum was the same as last one so droping this packet.')
				break
			}
			myData[key] = orderBookDelta[key]
			continue
		}
		handleNewInstructions(key, orderBookDelta[key])
	}
}

// Handlers for market and pair data
client.onMarketUpdate((marketData) => {
	handleNewDelta(marketData.orderBookDelta)
})

// Error handling
client.onError((err) => {
	console.error(err)
})

const fetch = require('node-fetch')

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
		console.log('starting websocket', myData)
		client.connect()
	})
