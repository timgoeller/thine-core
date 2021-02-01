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
  constructor (opts) {
    super()

    opts = opts || {}
    this.seed = opts.seed || true

    const self = this

    this.rootStorage = path.join(os.homedir(), '.thine')
    fse.ensureDirSync(this.rootStorage)
    fse.ensureDirSync(this.publishedStoragePath)
    fse.ensureDirSync(this.cachedStoragePath)

    this.published = {
      db: level(self.publishedStorageDBPath),
      packageList: [],
      packagePath: self.publishedStoragePath,
      dbPath: self.publishedStorageDBPath
    }

    this.cached = {
      db: level(self.cachedStorageDBPath),
      packageList: [],
      packagePath: self.cachedStoragePath,
      dbPath: self.cachedStorageDBPath
    }

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

    const pack = new Package(new Corestore(path.join(
      this.publishedStoragePath,
      packUUID
    )))

    pack.createNew(packageJSON.name)
    await pack.ready()

    await this.published.db.put(pack.readableKey, packUUID)

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
      throw new Error('No key found in package.thine.json.')
    }

    const pack = this.published.packageList.find(pack => pack.key.toString('hex') === key)
    if (pack === undefined) {
      throw new Error('Package not found in database.')
    }

    if (await pack.versionExists(packageJSON.version)) {
      throw new Error('This version was already published.')
    }

    await pack.ready()

    let changes = await dft.diff(sourceFolder, { path: '/', fs: pack.fs })

    // TODO, doesn't delete newly ignored files
    if (opts.filterPatterns !== null && opts.filterPatterns !== undefined) {
      changes = this._filterChanges(sourceFolder, changes, opts.filterPatterns)
    }

    await dft.applyRight(sourceFolder, { path: '/', fs: pack.fs }, changes)

    await pack.createVersion(packageJSON.version)
  }

  async install (sourceFolder, opts) {
    opts = opts || {}

    if (!await fse.pathExists(sourceFolder)) {
      throw new Error('Source folder does not exist.')
    }

    const packageJSON = await this._readPackageJSON(sourceFolder)
    const topLevelDeps = packageJSON.dependencies

    const nodeModulesFolderPath = path.join(sourceFolder, 'node_modules')

    await fse.emptyDir(nodeModulesFolderPath)

    for (const [key, value] of Object.entries(topLevelDeps)) {
      const packageMetadata = {
        fullKey: key,
        key: key.split('/')[1],
        name: key.split('/')[0],
        range: value
      }
      const dep = await this._installPack(packageMetadata, nodeModulesFolderPath)
    }
  }

  async _installPack (metadata, packageRootPath) {
    const pack = await this._loadPack(metadata)
    const version = await pack.getLatestVersionInSemVerRange(metadata.range)
    const versionDrive = pack.checkoutDriveAtVersion(version.driveVersion)
    const packPath = path.join(packageRootPath, pack.name)
    await fse.emptyDir(packPath)
    const changes = await dft.diff({ path: '/', fs: versionDrive }, packPath)
    await dft.applyRight({ path: '/', fs: versionDrive }, packPath, changes)
    let depJSON
    try {
      depJSON = await this._readPackageJSON(packPath)
    } catch {
      return
    }
    if (depJSON.dependencies) {
      const depNodeModulesFolderPath = path.join(packPath, 'node_modules')
      await fse.emptyDir(depNodeModulesFolderPath)
      for (const [key, value] of Object.entries(depJSON.dependencies)) {
        const packageMetadata = {
          fullKey: key,
          key: key.split('/')[1],
          name: key.split('/')[0],
          range: value
        }
        await this._installPack(packageMetadata, depNodeModulesFolderPath)
      }
    }
  }

  async _loadPack (metadata) {
    const packLocal = this._tryGetPackageLocal(metadata.key)
    if (packLocal !== null) {
      return packLocal
    } else {
      const pack = new Package(new Corestore(path.join(
        this.cached.packagePath,
        metadata.key
      )))

      pack.loadExisting(metadata.key)

      await pack.initialized()
      this._replicate(pack)

      await this.cached.db.put(pack.readableKey, metadata.key)
      return Promise.race([
        new Promise((resolve, reject) => {
          pack.ready().then(() => {
            resolve(pack)
          })
        }),
        new Promise((resolve, reject) => setTimeout(() => {
          reject(new Error('Header retrieval timeout for ' + metadata.fullKey))
        }, 20000))
      ])
    }
  }

  _tryGetPackageLocal (key) {
    if (key in this.published.packageList) {
      return this.published.packageList[key]
    } else if (key in this.cached.packageList) {
      return this.cached.packageList[key]
    }
    return null
  }

  async ready () {
    await this._ready
  }

  async _initialize () {
    const published = await this._loadPackDBFromDisk(this.published)
    const cached = await this._loadPackDBFromDisk(this.cached)

    await Promise.all([published, cached])

    this.emit('ready')
  }

  async _loadPackDBFromDisk (dbData) {
    await new Promise((resolve, reject) => {
      dbData.db.createReadStream()
        .on('data', function (data) {
          const pack = new Package(new Corestore(path.join(
            dbData.packagePath,
            data.value
          )))
          dbData.packageList.push(pack)
          pack.loadExisting(data.key)
        })
        .on('error', function (err) {
          reject(err)
        })
        .on('close', function () {
          // ???
          resolve()
        })
        .on('end', function () {
          resolve()
        })
    })

    await Promise.all(dbData.packageList.map(pack => pack.ready()))

    dbData.packageList.forEach(pack => this._replicate(pack))
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
    if (this.seed) {
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
  }

  get publishedStoragePath () {
    return path.join(this.rootStorage, 'published')
  }

  get cachedStoragePath () {
    return path.join(this.rootStorage, 'cached')
  }

  get publishedStorageDBPath () {
    return path.join(this.publishedStoragePath, 'database')
  }

  get cachedStorageDBPath () {
    return path.join(this.cachedStoragePath, 'database')
  }
}

module.exports = Thine
