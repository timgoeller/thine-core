const RangeParser = require('leveldown-semver-range-parser')
const TreeTaggedHyperdrive = require('tree-tagged-hyperdrive')
const events = require('events')
const lexVer = require('./lex-ver')

class Package extends events.EventEmitter {
  constructor (corestore) {
    super()
    this._corestore = corestore
    this.rangeParser = new RangeParser()

    const self = this
    this._ready = new Promise((resolve, reject) => {
      self.on('ready', () => {
        resolve()
      })
    })
    this._initialized = new Promise((resolve, reject) => {
      self.on('initialized', () => {
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
    await this.taggedDrive.initialized()
    this.emit('initialized')
    await this.taggedDrive.ready()
    this.name = JSON.parse(this.taggedDrive.userData).thine.name
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
    await this.taggedDrive.initialized()
    this.emit('initialized')
    await this.taggedDrive.ready()
    this.name = JSON.parse(this.taggedDrive.userData).thine.name
    this.emit('ready')
  }

  async getLatestVersionInSemVerRange (range) {
    const query = this.rangeParser.parse(range)
    query.reverse = true
    query.limit = 1
    const queryResult = await new Promise((resolve, reject) => { // add timeout
      this.taggedDrive.tree.createReadStream(query)
        .on('data', function (data) {
          resolve(data)
        })
    })
    return {
      version: lexVer.decode(queryResult.key),
      driveVersion: queryResult.value
    }
  }

  checkoutDriveAtVersion (version) {
    return this.taggedDrive.drive.checkout(version)
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

  async initialized () {
    return this._initialized
  }

  get fs () {
    return this.taggedDrive.drive
  }

  async createVersion (version) {
    await this.taggedDrive.put(lexVer.encode(version))
  }

  async versionExists (version) {
    const ver = await this.taggedDrive.getVersionAtTag(lexVer.encode(version))
    return ver !== null && ver !== undefined
  }
}

module.exports = Package
