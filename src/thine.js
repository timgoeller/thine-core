const path = require('path')
const os = require('os')
const fse = require('fs-extra')
const Package = require('./package')
const glob = require('glob')
const { Walk } = require('node-fse-walk')
const ignore = require('ignore')
const dft = require('diff-file-tree')
const lexVer = require('./lex-ver')

class Thine {
  async publish (sourceFolder, opts) {
    opts = opts || {}

    if (!await fse.pathExists(sourceFolder)) {
      throw new Error('Source folder does not exist.')
    }

    const packageJSON = await this._readPackageJSON(sourceFolder)

    const pack = new Package(opts.corestore)
    pack.createNew(packageJSON.name)
    await pack.ready()

    packageJSON.thineKey = pack.taggedDrive.getKey().toString('hex')
    this._writePackageJSON(sourceFolder, packageJSON)

    let changes = await dft.diff(sourceFolder, { path: '/', fs: pack.fs })

    if (opts.filterPatterns !== null && opts.filterPatterns !== undefined) {
      changes = this._filterChanges(sourceFolder, changes, opts.filterPatterns)
    }

    await dft.applyRight(sourceFolder, { path: '/', fs: pack.fs }, changes)

    await pack.createVersion(packageJSON.version)

    return pack
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
}

module.exports = Thine
