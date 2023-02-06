const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const os = require('node:os');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// RAR exits with a zero code (0) in case of successful operation.
// Non-zero exit code indicates some kind of error:

const ERROS_CODES = {
	1: 'Non fatal error(s) occurred.',
	2: 'A fatal error occurred.',
	3: 'Invalid checksum. Data is damaged.',
	4: 'Attempt to modify an archive locked by "k" command.',
	5: 'Write error.',
	6: 'File open error.',
	7: 'Wrong command line option.',
	8: 'Not enough memory.',
	9: 'File create error',
	10: 'No files matching the specified mask and options were found.',
	11: 'Wrong password.',
	12: 'Read error.',
	255: 'User stopped the process.'
};

const rarAPI = $args => new Promise(async resolve => {
		let $stdout = ""
		let $stderr = ""
		// we use spawn not exec cause he has no buffer limit so we can make huge operations ;)
		const child = spawn('Rar.exe', $args, {cwd: path.resolve('./libs'), windowsHide: true, windowsVerbatimArguments: true})
		// improve performance in large operations;
		child.once('spawn', () => os.setPriority(child.pid, -8));
		child.stdout.on('data', async $data => {
			$stdout += $data.toString();
		});
		child.stderr.on('data', async $data => {
			// child will ask for password so we need close manually
			if ($data.toString().includes('Enter password (will not be echoed)')) {
				child.removeAllListeners();
				resolve({$error: new Error(`RAR ERROR: MISSING PASSWORD!`), $stdout: $stdout, $stderr: $stderr});
				return process.kill(child.pid);
			};
			$stderr += $data.toString(); 
		});
		child.once('error', async $err => {
			child.removeAllListeners();
			resolve({$error: new Error('Failed to spawn rar binary!'), $stdout: $stdout, $stderr: $stderr});
		});
		child.once('exit', async $code => {
			if ($code !== 0) return resolve({$error: new Error(`RAR ERROR: ${ERROS_CODES[$code]}`), $stdout: $stdout, $stderr: $stderr});
			child.removeAllListeners();
			resolve({$error: null, $stdout: $stdout, $stderr: $stderr});
		});
});

// Cli response to array of json objects parser
const simpleFileListing = $stdout => {
	try {
		if ($stdout.includes(' Attributes      Size     Date    Time   Name')) {
	    	$stdout = $stdout.split(' ').join('|');
	    	for (;;) {
	    		if (!$stdout.includes('||')) break;
	    		$stdout = $stdout.split('||').join('|');
	    	};
	    	$stdout = $stdout.split('|----\r\n')[1].split('\n-----------|')[0].split('\r').filter(cdata => cdata.includes('|') && cdata.split('|').length >= 6);
	    	if ($stdout.length !== 0) {
	    		$stdout = $stdout.map(cdata => {
	    			let cdataData = {
	    				path: cdata.split('|').slice(5, cdata.split('|').length).join(''),
	    				isDirectory: (cdata.split('|')[1] === '...D...'),
	    			    modified: new Date(`${cdata.split('|')[3]}T${cdata.split('|')[4]}:00`)
	    			}
	    			if (!cdataData.isDirectory) {
	    				cdataData['size'] = Number(cdata.split('|')[2])
	    			}
	    			return cdataData
	    	    });
	    	}
	    	return $stdout;
	    } else {
	    	return [];
	    };
	} catch (e) {
		return [];
	};
};

// Cli response to array of json objects parser
const advancedFileListing = $stdout => {
	try {
		if ($stdout.includes('Name: ') && $stdout.includes('Compression: ')) {
	    	$stdout = $stdout.split('Name: ').filter($childs => $childs.includes('Compression: '))
			if ($stdout.length !== 0) {
				$stdout = $stdout.map(cdata => {
					let isDir = (cdata.includes('Type: Directory'));
					let cdataData = {
					    path: cdata.split('\r')[0],
					    isDirectory: (cdata.includes('Type: Directory')),
					    modified: new Date(`${cdata.split('Modified: ')[1].split(' ')[0]}T${cdata.split('Modified: ')[1].split(' ')[1].split(',')[0]}`),
					    compression: cdata.split('Compression: ')[1].split('\r')[0]
				    };
				    if (!isDir) {
				    	cdataData['size'] = Number(cdata.split('Size: ')[1].split('\r')[0]);
				    	cdataData['packedSize'] = Number(cdata.split('Packed size: ')[1].split('\r')[0]);
				    	cdataData['ratio'] = cdata.split('Ratio: ')[1].split('\r')[0];
				    	cdataData['CRC32'] = cdata.split('CRC32: ')[1].split('\r')[0];
				    };
					return cdataData;
			    });
			};
	    	return $stdout;
	    } else {
	    	return [];
	    };
	} catch (e) {
		return [];
	};
};

class Rar {
	constructor (rarPath) {
		this._event = new EventEmitter();
		if (os.platform() !== 'win32' || os.arch() !== 'x64') {
			// async timeout to have enought time for listening error event ;)
			setTimeout(() => {this._event.emit('error', new Error('OS not supported yet, currently we only support Windows x64!'));}, 10);
			return this;
		}
		if (typeof rarPath !== 'string' || rarPath.length <= 0) {
			// async timeout to have enought time for listening error event ;)
			setTimeout(() => {this._event.emit('error', new Error('Received path is not a valid string!'));}, 10);
		} else {
			this._rarPath = path.resolve(path.normalize(rarPath)).replaceAll('/', '\\');
			const $ext = path.extname(this._rarPath.toLowerCase())
			if ($ext !== '.rar') {
				setTimeout(() => {this._event.emit('error', new Error(`Received path file extension is not supported! (RECEIVED EXTENSION: ${$ext}) | SUPPORTED EXTENSIONS: .rar`));}, 10);
			    return this;
			};
		    this._promise = new Promise(resolve => {
		    	fs.exists(this._rarPath, $rarExists => {
                    if (!$rarExists) {
                    	this.passwordRequired = false
		        		this._stream = fs.createWriteStream(this._rarPath);
		        		resolve(true);
		        		return this._event.emit('ready', true);
		        		//resolve(true);
		        		//return this._event.emit('error', new Error(`Rar file not found in specified path! (${this._rarPath})`));
		        	};
		        	fs.stat(this._rarPath, async ($err, $stats) => {
		        		if ($err) {resolve(true);return this._event.emit('error', new Error($err));};
		        		if ($stats.isDirectory()) {resolve(true);return this._event.emit('error', new Error(`Received path is a directory, not a .rar file! (${this._rarPath})`));};
		        	    // Check if file need password otherwise is ready ;)
		        	    let $verification = await rarAPI(['l', `"${this._rarPath}"`]);
		        	    if ($verification.$error && $verification.$error.message === 'RAR ERROR: MISSING PASSWORD!') {
		        	    	this.passwordRequired = true;
		        	    	resolve(true);
		        	    	return this._event.emit('password', true);
		        	    } else {
		        	    	const files = simpleFileListing($verification.$stdout);
		        	    	if (files.length > 0) {
		        	    		let { $error, $stdout, $stderr } = await rarAPI(['t', `"${this._rarPath}"`, `"${files[0].path}"`]);
		        	    	    if ($error && $error.message === 'RAR ERROR: MISSING PASSWORD!') {
		        	    	    	this.passwordRequired = true;
		        	    	        resolve(true);
		        	    	        return this._event.emit('password', true);
		        	    	    }
		        	    	}
		        	    }
		        	    resolve(true);
		        	    this._event.emit('ready', true);
		        	});
		        });
		    }).catch(async $err => {
		    	this._event.emit('error', new Error($err));
		    });
		};
		return this;
	};

	// intermediate eventEmiitter..
	on (name, fn) {
        return this._event.on(name, fn);
    };

    // intermediate eventEmiitter..
    once (name, fn) {
        return this._event.once(name, fn);
    };

	list (opts = {}, fn) {
		return (async () => {
			if (typeof fn === 'undefined' && typeof opts === 'function') {
				fn = opts;
				opts = {};
			} else if (typeof fn === 'undefined' && typeof opts === 'undefined') {
				fn = null;
				opts = {};
			} else if (typeof fn === 'undefined' && typeof opts === 'object') {
				fn = null;
			}
			if (!opts.hasOwnProperty('advanced')) {
				opts['advanced'] = true
			}
			const response = ($err, $res) => {
				if ($err === null) {
					if (fn !== null) return fn($err, $res);
					return $res;
				} else {
					if (fn !== null) return fn($err);
					return $err;
				};
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $args = [
		    	(opts.advanced) ? 'lt' : 'l',
		    	`"${this._rarPath}"`
		    ];
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
		    //await new Promise(async resolve => exec(`Rar.exe ${$args.join(' ')}`, {cwd: path.resolve('./libs'), windowsHide: true, windowsVerbatimArguments: true}, async ($err, $std, $serr) => resolve($err, $std, $serr)))
		    if ($error) {
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this._event.emit('password', true);
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	let $response = (opts.advanced) ? advancedFileListing($stdout) : simpleFileListing($stdout);
		    	return response(null, $response);
		    };
		})();
	};

	extract (opts, fn) {
		if (typeof fn === 'undefined') {
			fn = null;
		}
		const response = $res => {
			if (fn !== null) return fn($res);
			return $res;
		};
		return (async () => {
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof opts !== 'object' || !opts.hasOwnProperty('path') || typeof opts.path !== 'string') return response(new Error('Invalid options, send key "path" as json object at least!'));
			opts.path = path.resolve(opts.path);
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
		    let $args = [
		    	'x',
		    	'-o+',
		    	'-kb',
		    	'-r',
		    	`"${this._rarPath}"`
		    ];
		    if (this._password) $args.push(`-p${this._password}`);
	        if (typeof opts === 'object' && opts.hasOwnProperty('files') && typeof opts.files === 'object' && opts.files.length > 0) {
	        	$args.push('[');
	        	for (let $file of opts.files) $args.push(`"${(typeof $file === 'object') ? $file.path : $file}"`);
	        	$args.push(']');
	        };
	        $args.push(`-op"${opts.path}"`);
	        let { $error, $stdout, $stderr } = await rarAPI($args);
	        if ($error) {
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this._event.emit('password', true);
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	return response(null);
		    };
		})();
	};

	getFileBuffer (pathInsideRar, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			}
			const response = ($err, $res) => {
				if ($err === null) {
					if (fn !== null) return fn($err, $res);
					return $res;
				} else {
					if (fn !== null) return fn($err);
					return $err;
				};
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof pathInsideRar !== 'string' || pathInsideRar.length <= 0) return response(new Error('ERROR: Invalid or missing file path!'));
			pathInsideRar = pathInsideRar.replaceAll('/', '\\')
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $args = [
		    	'p',
		    	`"${this._rarPath}"`,
		    	`"${pathInsideRar}"`
		    ];
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
	        if ($error) {
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this._event.emit('password', true);
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	return response(null, new Buffer.from($stdout));
		    };
		})();
	};

	getFileBufferStream (pathInsideRar, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			}
			const response = ($err, $res) => {
				if ($err === null) {
					if (fn !== null) return fn($err, $res);
					return $res;
				} else {
					if (fn !== null) return fn($err);
					return $err;
				};
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof pathInsideRar !== 'string' || pathInsideRar.length <= 0) return response(new Error('ERROR: Invalid or missing file path!'));
			pathInsideRar = pathInsideRar.replaceAll('/', '\\')
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $stream = new EventEmitter()
			let $args = [
		    	'p',
		    	`"${this._rarPath}"`,
		    	`"${pathInsideRar}"`
		    ];
		    if (this._password) $args.push(`-p${this._password}`);
		    const child = spawn('Rar.exe', $args, {cwd: path.resolve('./libs'), windowsHide: true, windowsVerbatimArguments: true});
		    child.once('error', $err => {
				child.removeAllListeners();
				$stream.emit('error', new Error('Failed to spawn rar binary!'));
			});
		    child.once('spawn', () => os.setPriority(child.pid, -8));
			child.stdout.on('data', $data => $stream.emit('data', $data));
			child.stderr.on('data', $data => {
				if ($data.toString().includes('Enter password (will not be echoed)')) {
					child.removeAllListeners();
					$stream.emit('error', new Error(`RAR ERROR: MISSING PASSWORD!`));
					this._event.emit('password', true);
					return process.kill(child.pid);
				}
				$stream.emit('error', new Error($data.toString()))
			});
			child.once('exit', async $code => {
				child.removeAllListeners();
				if ($code !== 0) $stream.emit('error', new Error(`RAR ERROR: ${ERROS_CODES[$code]}`));
				$stream.emit('end', true);
			});
			return response(null, $stream);
		})();
	};

	append (files, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			};
			const response = $res => {
				if (fn !== null) return fn($res);
				return $res;
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof files !== 'object' || files.length <= 0) return response(new Error('ERROR: Invalid or missing files to append!'));
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $args = [
		    	'u',
		    	'-r',
		    	'-ep1',
		    	'-ap',
		    	`"${this._rarPath}"`
		    ];
		    $args.push('[');
		    for (let $file of files) $args.push(`"${path.resolve($file)}"`);
		    $args.push(']');
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
	        if ($error) {
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	return response(null);
		    };
		})();
	};

	remove (files, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			};
			const response = $res => {
				if (fn !== null) return fn($res);
				return $res;
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof files !== 'object' || files.length <= 0) return response(new Error('ERROR: Invalid or missing files to append!'));
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $args = [
		    	'd',
		    	'-r',
		    	`"${this._rarPath}"`
		    ];
		    $args.push('[');
		    for (let $file of files) {
		    	if (typeof $file === 'string') {
		    		$args.push(`"${path.normalize($file)}"`);
		    	} else {
		    		$args.push(`"${path.normalize($file.path)}"`);
		    	}
		    }
		    $args.push(']');
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
	        if ($error) {
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	return response(null);
		    };
		})();
	};

	rename (oldpath, newPath, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			};
			const response = $res => {
				if (fn !== null) return fn($res);
				return $res;
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof oldpath !== 'string' || oldpath.length <= 0) return response(new Error('ERROR: Invalid or missing file path!'));
			if (typeof newPath !== 'string' || newPath.length <= 0) return response(new Error('ERROR: Invalid or missing file new path!'));
			await this._promise;
			if (this.passwordRequired && !this._password) return response(new Error('Rar file requires password, use "setPassword" instead!'));
			let $args = [
		    	'rn',
		    	`"${this._rarPath}"`
		    ];
		    $args.push(`"${path.normalize(oldpath)}"`);
		    $args.push(`"${path.normalize(newPath)}"`);
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
	        if ($error) {
		    	return response($error);
		    } else if ($stderr !== "") {
		    	return response(new Error($stderr));
		    } else {
		    	return response(null);
		    };
		})();
	};

	setPassword (password, fn) {
		return (async () => {
		    if (typeof fn === 'undefined') {
		    	fn = null;
		    };
		    const response = $res => {
		    	if (fn !== null) return fn($res);
		    	return $res;
		    };
		    if (typeof password !== 'string' || password.length <= 0 || password.length > 128) return response(false);
		    if (this._password && password === this._password) return response(true);
		    if (this._password && password !== this._password) return response(false);
		    let $args = [
		    	't',
		    	`"${this._rarPath}"`,
		    	`-p${password}`
		    ];
		    let { $error, $stdout, $stderr } = await rarAPI($args);
		    if ($error || $stderr !== "") {
		    	return response(false);
		    } else {
		    	this._password = password;
		    	this._event.emit('ready', true);
		    	return response(true);
		    }
		})();
	};

	close () {
		this._event.removeAllListeners();
		for (const $key of Object.keys(this)) delete this[$key];
	};
};

module.exports = Rar;