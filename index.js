const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { ERROS_CODES, rarAPI, simpleFileListing, advancedFileListing } = require('./libs/Rar.js');

// we cache every list file for force delete case close() has called.
let listFiles = [];

const createListFile = ($files, ID) => new Promise((resolve, reject) => {
	$files = $files.map($file => {
		if (typeof $file === 'string') {
			return $file.replaceAll('/', '\\');
		} else if (typeof $file === 'object') {
			return $file.path.replaceAll('/', '\\');
		};
	});
	const listPath = path.resolve(path.join(os.tmpdir(), `rar_tempListFile${new Date().getTime()}.lst`));
	fs.writeFile(listPath, $files.join('\r\n'), err => {
		if (err) return reject(err);
		listFiles.push({path: listPath, ID: ID});
		resolve(listPath);
	});
});

class Rar extends EventEmitter {
	constructor (rarPath) {
		super();
		this._ID = new Date().getTime().toString(36) + Math.random().toString(36).slice(2);
		this._password = false;
		if (os.platform() !== 'win32' || os.arch() !== 'x64') {
			process.nextTick(() => this.emit('error', new Error('OS not supported yet, currently we only support Windows x64!')));
			return this;
		}
		if (typeof rarPath !== 'string' || rarPath.length <= 0) {
			process.nextTick(() => this.emit('error', new Error('Received path is not a valid string!')));
		} else {
			this._rarPath = path.resolve(path.normalize(rarPath)).replaceAll('/', '\\');
			const $ext = path.extname(this._rarPath.toLowerCase())
			if ($ext !== '.rar') {
				process.nextTick(() => this.emit('error', new Error(`Received path file extension is not supported! (RECEIVED EXTENSION: ${$ext}) | SUPPORTED EXTENSIONS: .rar`)));
			    return this;
			};
		    this._promise = new Promise(resolve => {
		    	fs.exists(this._rarPath, $rarExists => {
                    if (!$rarExists) {
                    	this.passwordRequired = false
		        		//this._stream = fs.createWriteStream(this._rarPath);
		        		resolve(true);
		        		return process.nextTick(() => this.emit('ready', true))
		        	};
		        	fs.stat(this._rarPath, async ($err, $stats) => {
		        		if ($err) {resolve(true);return process.nextTick(() => this.emit('error', new Error($err)));};
		        		if ($stats.isDirectory()) {resolve(true);return process.nextTick(() => this.emit('error', new Error(`Received path is a directory, not a .rar file! (${this._rarPath})`)));};
		        	    
		        	    // We perform a listing for files operation to check for password error
		        	    let $verification = await rarAPI(['l', `"${this._rarPath}"`]);
		        	    if ($verification.$error && $verification.$error.message === 'RAR ERROR: MISSING PASSWORD!') {
		        	    	this.passwordRequired = true;
		        	    	resolve(true);
		        	    	return process.nextTick(() => this.emit('password', true));
		        	    } else {
		        	    	const files = simpleFileListing($verification.$stdout);
		        	    	if (files.length > 0) {
		        	    		// We test some random file to check if files is encrypted with password otherwhise document is ready ;)
		        	    		let { $error, $stdout, $stderr } = await rarAPI(['t', `"${this._rarPath}"`, `"${files[0].path}"`]);
		        	    	    if ($error && $error.message === 'RAR ERROR: MISSING PASSWORD!') {
		        	    	    	this.passwordRequired = true;
		        	    	        resolve(true);
		        	    	        return process.nextTick(() => this.emit('password', true));
		        	    	    }
		        	    	}
		        	    }
		        	    resolve(true);
		        	    this.emit('ready', true);
		        	});
		        });
		    }).catch(async $err => {
		    	this.emit('error', new Error($err));
		    });
		};
		return this;
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
					throw $err;
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
		    if ($error) {
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this.emit('password', true);
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
			if ($res === null) {
				return $res;
			} else {
				throw $res;
			}
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
	        let listFileRef = null
	        if (typeof opts === 'object' && opts.hasOwnProperty('files') && typeof opts.files === 'object' && opts.files.length > 0) {
	        	listFileRef = await createListFile(opts.files, this._ID);
	        	$args.push(`@"${listFileRef}"`);
	        };
	        $args.push(`-op"${opts.path}"`);
	        let { $error, $stdout, $stderr } = await rarAPI($args);
	        if (listFileRef !== null) fs.unlink(listFileRef, async () => {listFiles = listFiles.filter($listFile => $listFile.path !== listFileRef)});
	        if ($error) {
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this.emit('password', true);
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
					throw $err;
				};
			};
			if (!this._promise) return response(new Error('No rar file loaded!'));
			if (typeof pathInsideRar !== 'string' || pathInsideRar.length <= 0) return response(new Error('ERROR: Invalid or missing file path!'));
			pathInsideRar = pathInsideRar.replaceAll('/', '\\');
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
		    	if ($error.message === 'RAR ERROR: MISSING PASSWORD!') this.emit('password', true);
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
					throw $err;
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
			child.stdout.on('data', $data => process.nextTick(() => $stream.emit('data', $data)));
			child.stderr.on('data', $data => {
				if ($data.toString().includes('Enter password (will not be echoed)')) {
					child.removeAllListeners();
					$stream.emit('error', new Error(`RAR ERROR: MISSING PASSWORD!`));
					this.emit('password', true);
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
				if ($res === null) {
					return $res;
				} else {
					throw $res;
				}
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
		    let listFileRef = await createListFile(files, this._ID);
	        $args.push(`@"${listFileRef}"`);
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
		    fs.unlink(listFileRef, async () => {listFiles = listFiles.filter($listFile => $listFile.path !== listFileRef)});
	        return ($error) ? response($error) : ($stderr !== "") ? response(new Error($stderr)) : response(null);
		})();
	};

	remove (files, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			};
			const response = $res => {
				if (fn !== null) return fn($res);
				if ($res === null) {
					return $res;
				} else {
					throw $res;
				}
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
		    let listFileRef = await createListFile(files, this._ID);
	        $args.push(`@"${listFileRef}"`);
		    if (this._password) $args.push(`-p${this._password}`);
		    let { $error, $stdout, $stderr } = await rarAPI($args);
	        fs.unlink(listFileRef, async () => {listFiles = listFiles.filter($listFile => $listFile.path !== listFileRef)});
	        return ($error) ? response($error) : ($stderr !== "") ? response(new Error($stderr)) : response(null);
		})();
	};

	rename (oldpath, newPath, fn) {
		return (async () => {
			if (typeof fn === 'undefined') {
				fn = null;
			};
			const response = $res => {
				if (fn !== null) return fn($res);
				if ($res === null) {
					return $res;
				} else {
					throw $res;
				}
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
	        return ($error) ? response($error) : ($stderr !== "") ? response(new Error($stderr)) : response(null);
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
		    if ($error || $stderr !== "") return response(false);
		    this._password = password;
		    this.emit('ready', true);
		    return response(true);
		})();
	};

	close () {
		let filteredLists = listFiles.filter($listFile => $listFile.ID === this._ID);
		if (filteredLists.length > 0) filteredLists.forEach(async listFile => fs.unlink(listFile.path, async () => {
			listFiles = listFiles.filter($listFile => $listFile.path !== listFile.path);
		}));
		for (const $key of Object.keys(this)) delete this[$key];
	};
};

module.exports = Rar;