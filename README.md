# thine-core
TODO

Here be _a lot_ of dragons.
## API
#### `const thine = new Thine()`
Create a new package manager instance.

#### `await thine.ready()`
Wait for published and cached package databases to be loaded completely.

#### `thine.publish(sourceFolder, [opts])`
Publish your package. Requires a `package.thine.json` to be present in the directory. This file looks like a normal `package.json` with two differences:
* Dependencies have to be specified in the format `'{name}\{hash}: {version}'`
* After publish, a `thineKey` property is added to the file. Don't delete it! It's what allows the update function to identify the feed it should update. This is the hash corresponding to your published package.

#### `thine.update(sourceFolder, [opts])`
Update a package. This only works, if you published the package initially.

#### `thine.install(folder, [opts])`
Install dependencies listed in the `package.thine.json` in the given folder. 