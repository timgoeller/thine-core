const path = require('path')
const os = require('os')
const fse = require('fs-extra')
const Package = require('./package')
const glob = require('glob')
const { Walk } = require('node-fse-walk')
const ignore = require('ignore')
const dft = require('diff-file-tree')
const lexVer = require('./lex-ver')
const hyperswarm = require('hyperswarm')
const pump = require('pump')
const events = require('events')
const Corestore = require('corestore')
const level = require('level')
const { v4: uuidv4 } = require('uuid')

class Thine extends events.EventEmitter {
  constructor () {
    super()
    this.rootStorage = path.join(os.homedir(), '.thine')
    fse.ensureDirSync(this.rootStorage)
    fse.ensureDirSync(this.publishedStoragePath)
    this.publishedDB = level(this.publishedStorageDBPath)
    this.publishedPackages = []
    const self = this
    this._ready = new Promise((resolve, reject) => {
      self.on('ready', () => {
        resolve()
      })
    })

    this._initialize()
  }

  async publish (sourceFolder, opts) {
    opts = opts || {}

    if (!await fse.pathExists(sourceFolder)) {
      throw new Error('Source folder does not exist.')
    }

    const packageJSON = await this._readPackageJSON(sourceFolder)

    const packUUID = uuidv4()

    // how to give same path???
    const pack = new Package(new Corestore(path.join(
      this.publishedStoragePath,
      packUUID
    )))

    pack.createNew(packageJSON.name)
    await pack.ready()

    await this.publishedDB.put(pack.readableKey, packUUID)

    packageJSON.thineKey = pack.readableKey
    this._writePackageJSON(sourceFolder, packageJSON)

    let changes = await dft.diff(sourceFolder, { path: '/', fs: pack.fs })

    if (opts.filterPatterns !== null && opts.filterPatterns !== undefined) {
      changes = this._filterChanges(sourceFolder, changes, opts.filterPatterns)
    }

    await dft.applyRight(sourceFolder, { path: '/', fs: pack.fs }, changes)

    await pack.createVersion(packageJSON.version)

    this._replicate(pack)

    return pack
  }

  async update (sourceFolder, opts) {
    opts = opts || {}

    if (!await fse.pathExists(sourceFolder)) {
      throw new Error('Source folder does not exist.')
    }

    const packageJSON = await this._readPackageJSON(sourceFolder)
    const key = packageJSON.thineKey

    if (key === null || key === undefined) {
      throw new Error('No key found in package.thine.json')
    }

    const pack = new Package(opts.corestore)
    pack.loadExisting(packageJSON.name)
    await pack.ready()
  }

  async ready () {
    await this._ready
  }

  async _initialize () {
    const self = this
    await new Promise((resolve, reject) => {
      this.publishedDB.createReadStream()
        .on('data', async function (data) {
          const pack = new Package(new Corestore(path.join(
            self.publishedStoragePath,
            data.value
          )))
          self.publishedPackages[data.key] = pack
          pack.loadExisting(data.key)
        })
        .on('error', function (err) {
          reject(err)
        })
        .on('close', function () {
          // ???
        })
        .on('end', function () {
          resolve()
        })
    })

    await Promise.all(this.publishedPackages.map(pack => pack.ready()))
    this.publishedPackages.forEach(pack => this._replicate(pack))
    this.emit('ready')
  }

  async _readPackageJSON (sourceFolder) {
    return fse.readJson(path.join(sourceFolder, '/package.thine.json'))
      .then(packageObj => {
        if (packageObj.version === null || packageObj.version === undefined) {
          throw new Error('version in package.thine.json must be set.')
        } else if (packageObj.name === null || packageObj.name === undefined) {
          throw new Error('name in package.thine.json must be set.')
        }
        return packageObj
      })
      .catch(err => {
        throw new Error('Error while trying to load package.thine.json: ' + err)
      })
  }

  async _writePackageJSON (sourceFolder, data) {
    return fse.writeJSON(path.join(sourceFolder, '/package.thine.json'), data, { spaces: 2 })
      .catch(err => {
        throw new Error('Error while trying to write package.thine.json: ' + err)
      })
  }

  _filterChanges (sourceFolder, changes, filterPatterns) {
    const filter = ignore().add(filterPatterns)

    return changes.filter(change =>
      !filter.ignores(path.join(sourceFolder, change.path))
    )
  }

  _replicate (pack) {
    const swarm = hyperswarm()

    swarm.on('connection', (connection, info) => {
      pump(
        connection,
        pack.corestore.replicate(info.client),
        connection
      )
    })

    swarm.join(pack.key, {
      announce: true,
      lookup: true
    })
  }

  get publishedStoragePath () {
    return path.join(this.rootStorage, 'published')
  }

  get publishedStorageDBPath () {
    return path.join(this.publishedStoragePath, 'database')
  }

  get cachedStoragePath () {
    return path.join(this.rootStorage, 'cached')
  }
}

module.exports = Thine
