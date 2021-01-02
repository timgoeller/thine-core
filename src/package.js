const RangeParser = require('leveldown-semver-range-parser')
const TreeTaggedHyperdrive = require('tree-tagged-hyperdrive')
const events = require('events')
const lexVer = require('./lex-ver')

class Package extends events.EventEmitter {
  constructor (corestore) {
    super()
    this._corestore = corestore

    const self = this
    this._ready = new Promise((resolve, reject) => {
      self.on('ready', () => {
        resolve()
      })
    })
  }

  async loadExisting (key) {
    if (this.taggedDrive) {
      throw new Error('Package is already initialized.')
    }
    const opts = {
      corestore: this._corestore
    }
    this.taggedDrive = new TreeTaggedHyperdrive(key, opts)
    await this.taggedDrive.ready()
    this.emit('ready')
  }

  async createNew (name) {
    if (this.taggedDrive) {
      throw new Error('Package is already initialized.')
    }
    this.name = name
    const opts = {
      corestore: this._corestore,
      userData: JSON.stringify({ thine: { name, storageVersion: 1 } })
    }
    this.taggedDrive = new TreeTaggedHyperdrive(null, opts)
    await this.taggedDrive.ready()
    this.emit('ready')
  }

  get key () {
    return this.taggedDrive.getKey()
  }

  get readableKey () {
    return this.key.toString('hex')
  }

  get corestore () {
    return this.taggedDrive.corestore
  }

  async ready () {
    return this._ready
  }

  get fs () {
    return this.taggedDrive.drive
  }

  async createVersion (version) {
    await this.taggedDrive.put(lexVer.encode(version))
  }
}

module.exports = Package
