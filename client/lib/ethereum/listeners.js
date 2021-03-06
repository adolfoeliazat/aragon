// @flow
import { _ } from 'meteor/underscore'

import StockWatcher from '/client/lib/ethereum/stocks'
const Stocks = StockWatcher.Stocks

import { NotificationsListener as Listener } from '/client/lib/notifications'
import Identity from '/client/lib/identity'
import utils from 'ethereumjs-util'

import { Company } from './deployed'
import { Stock, Voting, StockSale } from './contracts'

const flatten = (array) => [].concat(...array)

class Listeners {
  static async all() {
    const stocks = await this.allStocks()

    return [this.issueStockListener, this.newPollListener, this.executedVotingListener, this.newSaleListener, this.bylawChangedListener]
            .concat(await this.shareTransfers(stocks))
  }

  static get issueStockListener() {
    const body = async args => {
      const symbol = await Stock.at(args.stockAddress).symbol.call()
      return `${args.amount} ${symbol} shares have been issued`
    }

    return new Listener(
      Company().IssuedStock,
      'Stock issued',
      body,
      () => '/ownership',
    )
  }

  static async shareTransfers(stocks) {
    const address = Identity.current(true).ethereumAddress

    const parentStocks = stocks.map(s => s.parentToken).filter(x => x)

    const sharesTransfers = stocks.concat(parentStocks).map(stock =>
      ([this.sharesSent(stock, address), this.sharesReceived(stock, address)]),
    )

    return await Promise.all(flatten(sharesTransfers))
  }

  static async sharesSent(stock, address) {
    return await this.sharesTransferred(stock, { from: address }, 'sent')
  }

  static async sharesReceived(stock, address) {
    return await this.sharesTransferred(stock, { to: address }, 'received')
  }

  static async sharesTransferred(stock, predicate, verb) {
    const body = async args => `You just ${verb} ${args.value} ${stock.symbol}`

    return new Listener(
      Stock.at(stock.address).Transfer,
      'Transfer',
      body,
      () => '/ownership',
      '',
      predicate,
    )
  }

  static get newPollListener() {
    const body = async () => 'New voting was created. You can now vote.'

    return new Listener(
      Company().NewVoting,
      'Voting started',
      body,
      args => `/voting/${args.id.valueOf()}`,
      'Vote now',
      {},
      args => utils.bufferToHex(utils.sha3(args.id.valueOf() + args.closes.valueOf()))
    )
  }

  static get bylawChangedListener() {
    const body = args => `Signature: ${args.functionSignature}`
    return new Listener(
      Company().BylawChanged,
      'Bylaw changed',
      body,
      args => `/bylaws/${args.functionSignature}`,
    )
  }

  static get newSaleListener() {
    const body = async args => `New fundraising started shares at ${await StockSale.at(args.saleAddress).getBuyingPrice.call(1).then(x => web3.fromWei(x.toNumber()), 'ether')} ETH price`
    return new Listener(
      Company().NewStockSale,
      'New sale',
      body,
      args => `/fundraising/${args.saleIndex.valueOf()}`,
      'See sale',
    )
  }

  static get executedVotingListener() {
    const body = async args => {
      const winner = await Voting.at(args.votingAddress).options.call(args.outcome)
      return `Voting outcome was '${winner}'`
    }

    return new Listener(
      Company().VoteExecuted,
      'Voting finished',
      body,
      (args) => `/voting/${args.id.valueOf()}`,
    )
  }

  static async allStocks() {
    return Stocks.find().fetch()
  }
}

export default Listeners
