module.exports.encode = (version) => {
  const versionSplit = version.split('.')
  return versionSplit[0].padStart(3, '0') +
  versionSplit[1].padStart(3, '0') +
  versionSplit[2].padStart(3, '0')
}

module.exports.decode = (encodedVersion) => {
  const chunks = encodedVersion.match(/.{1,3}/g)
  return `${+chunks[0].toString()}.${+chunks[1].toString()}.${+chunks[2].toString()}`
}
