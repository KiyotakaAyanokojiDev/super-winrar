# Super WinRAR

***Get super powers with nodejs+winrar***

This is a rar cli Api implementation in JavaScript. It uses `0 depencies` ;)

Create or read an existing rar file and do anything you want with his content like extract, read, rename, remove or even append more content!

## Installation

Install with npm

```sh
npm i super-winrar
```

## Usage

Create a Rar object and do stuffs..

```javascript
const Rar = require('super-winrar');

// create a rar constructor with file path! (created if not exists)
const rar = new Rar('package.rar');

// handle erros, otherwise will throw an exception!
rar.on('error', err => console.log(err.message));

// will be fired on rar start and every method if password is not set so u can use once to listen for only "start" fire!
rar.once('password', async () => {
	console.log('Rar requested password!');
	// every method works with async/await or callback methods!
	const isCorrect = await rar.setPassword('abc'); // rar.setPassword('abc', isCorrect => {..})
    if (!isCorrect) {
    	console.log('wrong password!');
    	return rar.close(); // unique sync method without any callback, clearing all events and structure
    };
    console.log('password match!');
});

// will be fired only once after succesfull read the document (not fired if password is required but is fired once after correct password is set!)
rar.once('ready', async () => {
	rar.list((err, files) => {  // const files = await rar.list()
		if (err) return console.log(err.message);
		console.log('files', files);
	});

    try {
    	// Read file contents inside rar as Buffer!
    	const buffer = await rar.getFileBuffer('package.json'); // rar.getFileBuffer('New folder/index.js', (err, buffer) => {..})
    	console.log(buffer.length); //271
    	console.log(typeof buffer === 'object'); //true
    } catch (e) {
    	console.log(e.message);
    }
});

// Every method automatically waits for "ready" fired and also got an err if password is required
// will extract "package.json" file to "extractionfolder", if files os not specified will extract everything!
rar.extract({path: './extractionfolder', files: ['package.json']}, err => { // await rar.extract({path: './extractionfolder'})
	if (err) return console.log('extraction error', err.message);
	console.log('extraction completed successfully..');
});

// Read file contents insided rar as Buffer With ReadableStream (good for avoiding memory leaks with large files)
rar.getFileBufferStream('package.json', (err, bufferStream) => {
	if (err) return console.log(err.message);
	let buffer = new Buffer.from([])
    bufferStream.on('data', data => {
    	buffer = new Buffer.concat([buffer, data])
    });
    bufferStream.on('error', error => {
    	console.log('streaming err', error.message)
    	// handle streaming error
    });
    bufferStream.once('end', () => console.log('buffer size', buffer.length)); //271
});
```

## Constructor

***```Rar```***

#### Create a new rar document if not exists or read and return the rar document;

* `path`: the path of destination ".rar" file. **required**

```ts
new Rar (path: string)
```

**Exemple**:

```javascript
const rar = new Rar('myRar.rar');
```

## Events

***`ready`***

#### Will be fired only once after succesfull read the document (not fired if password is required but fired after correct password set!)

**Exemple**:

```javascript
rar.on('ready', async () => {
	// do something..
});
```

***

***`password`***

#### Will be fired on rar start and every method if password is not set so u can use once to listen for only "start" fire;

**Exemple**:

```javascript
rar.on('password', async () => {
	console.log('document has requested password!')
});
```

***

***`error`***

#### Will be fired case got any error while opening or creating the rar;

**Exemple**:

```ts
rar.on('error', async (error: object) => {
	console.log(error.message);
});
```

## Methods

***`setPassword()`***

#### Set the document password, if password is correct then all next methods will use the same password;

*parameters:*

* `password` *required*
* `callback` *optional* (isCorrect)

```ts
setPassword(password: string, callback(isCorrect: boolean): function => {});
```

**Exemple**:

```ts
rar.setPassword('abc', async (isCorrect) => {
	if (!isCorrect) return console.log('Password is not correct :(');
	console.log('Password correct!');
});

// or async/await

(async () => {
	const isCorrect = await rar.setPassword('abc');
	if (isCorrect) console.log('Correct password!');
})();
```
***

***`list()`***

#### List all document folders and files recursively;

*parameters:*

* `opts` *optional*
* `callback` *optional* (isCorrect)


```ts
list(opts: object = {}, callback(err: error, files: object): function => {});
```

**Exemple**:

```ts
rar.list( callback(err: error, files: object) => {
	if (err) return console.log(err.message);
	console.log('files', files);
});

// or async/await

(async () => {
	const files = await rar.list();
	console.log('files', files);
})();
```
***

***`extract()`***

#### Extract specified files/folders or if not specified all document got extract to destination path;

*parameters:*

* `opts` *optional*
* `callback` *optional* (err)


```ts
extract(opts: object = {}, callback(err: error): function => {});
```

**Exemple**:

```ts
rar.extract({path: './extractToThisFolder', files: ['fileInsideRar.txt', 'folderInsideRar']}, async (err) => {
	if (err) return console.log(err.message);
	console.log('extraction completed!');
});

// or async/await

(async () => {
	try {
		await rar.extract({path: './extractToThisFolder'});
		console.log('Extracted all files!');
	} catch (e) {
		console.log(e.message);
	};
})();
```
***

***`getFileBuffer()`***

#### Read file content inside rar as Buffer;

*parameters:*

* `pathInsideRar` *required*
* `callback` *optional* (err, buffer)


```ts
getFileBuffer(pathInsideRar: string, callback(err: error, buffer: object): function => {});
```

**Exemple**:

```ts
rar.getFileBuffer('fileInsideRar.txt', async (err, buffer) => {
	if (err) return console.log(err.message);
	console.log('File size is', buffer.length);
	console.log('File data', buffer.toString());
});

// or async/await

(async () => {
	try {
		const buffer = await rar.getFileBuffer('fileInsideRar.txt');
	} catch (e) {
		console.log(e.message);
	};
})();
```
***

***`getFileBufferStream()`***

#### Read file content inside rar as Buffer but the Buffer "data" is sent as Readable stream;

*parameters:*

* `pathInsideRar` *required*
* `callback` *optional* (err, stream)


```ts
getFileBufferStream(pathInsideRar: string, callback(err: error, stream: object): function => {});
```

**Exemple**:

```ts
rar.getFileBufferStream('fileInsideRar.txt', async (err, bufferStream) => {
	if (err) return console.log(err.message);
    let buffer = new Buffer.from([])
    bufferStream.on('data', data => {
    	buffer = new Buffer.concat([buffer, data])
    });
    // handle streaming error
    bufferStream.on('error', error => {
    	console.log('streaming err', error.message)
    });
    bufferStream.once('end', () => {
    	console.log('File size is', buffer.length);
    	console.log('File data', buffer.toString());
    });
});

// or async/await

(async () => {
	try {
		const stream = await rar.getFileBufferStream('fileInsideRar.txt');
		bufferStream.on('data', data => {
			// do something
		})
	} catch (e) {
		console.log(e.message);
	};
})();
```
***

***`append()`***

#### Append a file/folder to rar document, if is a folder then all his subdirectories and files will be append to document;

*parameters:*

* `files` *required*
* `callback` *optional* (err)


```ts
append(files: object, callback(err: error): function => {});
```

**Exemple**:

```ts
rar.append(['package.json', 'node_modules'], async (err) => {
	if (err) return console.log(err.message);
    console.log('Items append to document!');
});

// or async/await

(async () => {
	try {
		await rar.append(['index.js'])
	} catch (e) {
		console.log(e.message);
	};
})();
```
***

***`remove()`***

#### Remove a file/folder from rar document, if is a folder then all his subdirectories and files will be removed from document, if all document files got removed then he got deleted;

*parameters:*

* `files` *required*
* `callback` *optional* (err)


```ts
remove(files: object, callback(err: error): function => {});
```

**Exemple**:

```ts
rar.remove(['package.json', 'node_modules'], async (err) => {
	if (err) return console.log(err.message);
    console.log('Items removed from document!');
});

// or async/await

(async () => {
	try {
		await rar.remove(['index.js'])
	} catch (e) {
		console.log(e.message);
	};
})();
```
***

***`rename()`***

#### Rename a file/folder inside the rar document;

*parameters:*

* `oldpath` *required*
* `newPath` *required*
* `callback` *optional* (err)


```ts
rename(oldpath: string, newPath: string, callback(err: error): function => {});
```

**Exemple**:

```ts
rar.rename(['package.json', 'package.txt'], async (err) => {
	if (err) return console.log(err.message);
    console.log('File inside rar package.json renamed to package.txt!');
});

// or async/await

(async () => {
	try {
		await rar.rename(['index.js', 'index.ts'])
	} catch (e) {
		console.log(e.message);
	};
})();
```