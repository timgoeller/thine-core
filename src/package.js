const RangeParser = require('leveldown-semver-range-parser')
const TreeTaggedHyperdrive = require('tree-tagged-hyperdrive')
const events = require('events')
const lexVer = require('./lex-ver')

class Package extends events.EventEmitter {
  constructor (corestore) {
    super()
    this._corestore = corestore
  }

  async loadExisting (key) {

  }

  async createNew (name) {
    if (this.taggedDrive) {
      throw new Error('Package is already initialized.')
    }
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

  get corestore () {
    return this.taggedDrive.corestore
  }

  async ready () {
    const self = this
    return new Promise((resolve, reject) => {
      self.on('ready', () => {
        resolve()
      })
    })
  }

  get fs () {
    return this.taggedDrive.drive
  }

  async createVersion (version) {
    await this.taggedDrive.put(lexVer.encode(version))
  }
}

module.exports = Package
